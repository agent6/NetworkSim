import type {Simulator,ServiceResult} from './engine.ts';
import type {Device} from './model.ts';
import {ownRecordValue} from './record-map.ts';

export interface AccountingContext {sessionId:string;username?:string;line:string;source:string;started:number;privilege:number}
export interface AccountingRecord extends AccountingContext {eventId:string;kind:'exec'|'commands';status:'start'|'stop';time:number;command?:string;elapsed?:number;reason?:string;taskId?:string}
export interface AccountingDelivery {eventId:string;kind:string;status:'pending'|'delivered'|'failed'|'disabled';time:number;server?:string;protocol?:string;error?:string;record:AccountingRecord}

/** Received records are committed before acknowledgement. Security is a logical shared-key model. */
export function receiveAccounting(engine:Simulator,device:Device,protocol:'radius'|'tacacs',payload:any,source:string):Record<string,any>|undefined {
 const service=device.config.services[protocol],record=payload?.record;
 const valid=service?.enabled&&service.accountingEnabled!==false&&typeof service.secret==='string'&&service.secret.length>0&&payload?.key===service.secret&&payload?.operation==='accounting'&&record&&typeof record.eventId==='string'&&record.eventId.length<=200&&typeof record.sessionId==='string'&&record.sessionId.length<=200&&typeof record.line==='string'&&typeof record.source==='string'&&['exec','commands'].includes(record.kind)&&['start','stop'].includes(record.status)&&typeof record.time==='number'&&Number.isFinite(record.time)&&!Object.hasOwn(payload,'password')&&!(protocol==='radius'&&record.kind==='commands');
 const stats=device.runtime.features.aaaAccountingReceiverStats??={received:0,duplicates:0,rejected:0};
 if(!valid){stats.rejected++;return protocol==='radius'?undefined:{accounted:false,error:'Accounting request rejected'};}
 const records:any[]=device.runtime.features.aaaAccountingReceived??=[];
 if(records.some(row=>row.protocol===protocol&&row.source===source&&row.eventId===record.eventId)){stats.duplicates++;return {accounted:true,eventId:record.eventId,duplicate:true};}
 // Explicit fields prevent unrecognized payload fields and credentials entering the accounting log.
 records.push({protocol,source,received:engine.clock.now(),eventId:record.eventId,sessionId:record.sessionId,username:typeof record.username==='string'?record.username:'',line:record.line,remoteSource:record.source,kind:record.kind,status:record.status,time:record.time,privilege:record.privilege,command:typeof record.command==='string'?redactAccountingCommand(record.command):undefined,taskId:typeof record.taskId==='string'?record.taskId:undefined,elapsed:typeof record.elapsed==='number'?record.elapsed:undefined,reason:typeof record.reason==='string'?record.reason:undefined});if(records.length>1000)records.shift();stats.received++;
 return {accounted:true,eventId:record.eventId};
}

function accountingList(device:Device,kind:'exec'|'commands',context:AccountingContext):{mode:string;methods:string[]}|undefined {
 if(!device.config.features.aaa?.enabled)return;
 const line=ownRecordValue(device.config.features.lines,context.line)??{},name=kind==='exec'?line.accountingExec??'default':ownRecordValue(line.accountingCommands,String(context.privilege))??'default',key=kind==='exec'?`exec ${name}`:`commands ${context.privilege} ${name}`,config=ownRecordValue(device.config.features.aaa.accounting,key);
 if(!Array.isArray(config)||!['start-stop','stop-only','none'].includes(config[0]))return;return {mode:config[0],methods:config.slice(1)};
}

/** IOS-style active actions followed by explicitly identified simulator delivery diagnostics. */
export function showAccounting(engine:Simulator,device:Device,contexts:AccountingContext[]=[]):string[]{
 const events:AccountingDelivery[]=device.runtime.features.aaaAccountingEvents??[],lines:string[]=[];
 for(const record of contexts){const selected=accountingList(device,'exec',record);if(!selected||selected.mode==='none')continue;const seconds=Math.max(0,Math.floor((engine.clock.now()-record.started)/1000)),elapsed=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');lines.push(`Active Accounted actions on ${record.line}, User ${record.username||'(line)'} Priv ${record.privilege}`,` Task ID ${record.sessionId}, EXEC Accounting record, ${elapsed} Elapsed`,` task_id=${record.sessionId} service=shell`);}
 if(!lines.length)lines.push('No active accounted actions.');
 lines.push('NetworkSim delivery telemetry (acknowledged records only count as delivered):',` Pending ${events.filter(e=>e.status==='pending').length}, Delivered ${events.filter(e=>e.status==='delivered').length}, Failed ${events.filter(e=>e.status==='failed').length}`);
 for(const event of events.slice(-10))lines.push(` ${event.eventId} ${event.kind} ${event.record.status} ${event.protocol||'-'} ${event.server||'-'} ${event.status}${event.error?' — '+event.error:''}`);
 lines.push('Scope: VTY EXEC and TACACS command accounting; local console/connection/network/system accounting is not operational.');return lines;
}

export function redactAccountingCommand(command:string):string {
 // IOS masks sensitive arguments by default. This subset redacts the whole secret-bearing command.
 return /(?:^|\s)(?:password|secret|community|authentication|(?:[\w-]+-)?key(?:-string|-chain)?|set-key)(?:\s|$)/i.test(command)||/^\s*(?:no\s+)?(?:username|snmp-server\s+(?:user|host)|test\s+aaa|crypto\s+(?:isakmp\s+key|key))/i.test(command)||/:\/\/[^\s/]*:[^\s/]*@/.test(command)?'[sensitive configuration command redacted]':command;
}

export class AAAAccountingClient {
 readonly engine:Simulator;
 private sequence=0;
 constructor(engine:Simulator){this.engine=engine;}
 exec(device:Device,context:AccountingContext,status:'start'|'stop',reason?:string):AccountingDelivery|undefined {
  const record:AccountingRecord={...context,eventId:`acct-${device.id}-${++this.sequence}`,kind:'exec',status,time:this.engine.clock.now(),elapsed:Math.max(0,Math.floor((this.engine.clock.now()-context.started)/1000)),reason};
  return this.send(device,context,record);
 }
 command(device:Device,context:AccountingContext,command:string,status:'start'|'stop',taskId:string):AccountingDelivery|undefined {
  return this.send(device,context,{...context,eventId:`acct-${device.id}-${++this.sequence}`,kind:'commands',status,time:this.engine.clock.now(),command:redactAccountingCommand(command),taskId});
 }
 private send(device:Device,context:AccountingContext,record:AccountingRecord):AccountingDelivery|undefined {
  const list=accountingList(device,record.kind,context);if(!list||list.mode==='none'||record.status==='start'&&list.mode==='stop-only')return;
  const delivery:AccountingDelivery={eventId:record.eventId,kind:record.kind,status:'pending',time:this.engine.clock.now(),record},events:AccountingDelivery[]=device.runtime.features.aaaAccountingEvents??=[];events.push(delivery);if(events.length>1000)events.shift();
  const aaa=device.config.features.aaa,servers:any[]=[];
  for(let i=0;i<list.methods.length;i++){if(list.methods[i]!=='group')continue;const name=list.methods[++i],group=ownRecordValue(aaa.groups,name),names=Array.isArray(group?.servers)?group.servers:Object.keys(aaa.servers??{}).filter(key=>ownRecordValue(aaa.servers,key)?.protocol===(name==='tacacs+'?'tacacs':name));for(const serverName of names){const server=ownRecordValue(aaa.servers,serverName);if(server?.address)servers.push(server);}}
  const run=(index:number,attempt=0):void=>{
   if(!this.engine.getDevice(device.id)||!device.powered){delivery.status='failed';delivery.error='Accounting source unavailable';return;}
   const server=servers[index];if(!server){delivery.status='failed';delivery.error=delivery.error??'No available accounting server';return;}
   if(record.kind==='commands'&&server.protocol==='radius'){delivery.error='Cisco RADIUS command accounting is unsupported';run(index+1);return;}
   if(!['radius','tacacs'].includes(server.protocol)){run(index+1);return;}
   delivery.protocol=server.protocol;delivery.server=server.address;
   const timeout=Math.max(100,Math.min(60000,(server.timeout??10)*1000)),payload={operation:'accounting',key:server.key??'',record},result:ServiceResult=server.protocol==='radius'?this.engine.udpRequest(device.id,server.address,server.accountingPort??1813,payload,{timeout}):this.engine.tcpRequest(device.id,server.address,server.port??49,payload,{timeout});
   const poll=()=>{if(result.status==='running'){this.engine.clock.schedule(50,poll,{owner:device.id,label:'AAA accounting response wait'});return;}if(result.status==='success'&&result.accounted===true&&result.eventId===record.eventId){delivery.status='delivered';delete delivery.error;return;}delivery.error=result.error??'Accounting server did not acknowledge the record';if(result.status==='success'||result.accounted===false){delivery.status='failed';return;}if(server.protocol==='radius'&&attempt<(server.retransmit??0))run(index,attempt+1);else run(index+1);};
   this.engine.clock.schedule(0,poll,{owner:device.id,label:'AAA accounting response'});
  };
  this.engine.clock.schedule(0,()=>run(0),{owner:device.id,label:'AAA accounting request'});return delivery;
 }
}
