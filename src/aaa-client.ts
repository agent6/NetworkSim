import type {Simulator,ServiceResult} from './engine.ts';
import type {Device} from './model.ts';
import {ownRecordValue} from './record-map.ts';

export interface AAAAuthStep {method:string;outcome:'accept'|'reject'|'error';started:number;completed:number;server?:string;address?:string;transaction?:string;operation?:string;attempt?:number;serverEnabled?:boolean;serverPowered?:boolean;interfaceUp?:boolean;keyMatches?:boolean}
export interface AAAServerState {serverEnabled?:boolean;serverPowered?:boolean;interfaceUp?:boolean;keyMatches?:boolean}
export interface AAAAuthentication {steps?:AAAAuthStep[];accepted:boolean;unavailable?:boolean;privilege?:number;role?:string;errors?:string[];radius?:{server:string;authorized:boolean;privilege:number}}
export interface AAAServer {protocol:'radius'|'tacacs';address:string;port?:number;accountingPort?:number;key?:string;timeout?:number;retransmit?:number;vrf?:string;source?:string;name?:string}
export function aaaServerState(e:Simulator,server:AAAServer):AAAServerState {const target=e.lab.devices.find(n=>Object.values(n.config.interfaces).some(p=>p.ip===server.address)),port=target&&Object.values(target.config.interfaces).find(p=>p.ip===server.address);return {serverEnabled:target?!!target.config.services[server.protocol]?.enabled:undefined,serverPowered:target?e.devicePowered(target.id):undefined,interfaceUp:target&&port?e.interfaceUp(target.id,port.name):undefined,keyMatches:target?!!server.key&&server.key===target.config.services[server.protocol]?.secret:undefined};}
export interface AAAStats {requests:number;responses:number;accepts:number;rejects:number;errors:number;timeouts:number;retransmits:number;last?:number}
/** Client counters are separate from the simulated server's receiver log. Never retain credentials. */
export function aaaStats(d:Device,name:string,operation:string):AAAStats {
 const table=d.runtime.features.aaaClientStats??={},key=JSON.stringify([name,operation]);
 return table[key]??={requests:0,responses:0,accepts:0,rejects:0,errors:0,timeouts:0,retransmits:0};
}
export function aaaServers(d:Device,groupName:string):AAAServer[]{
 const aaa=d.config.features.aaa??{},group=ownRecordValue(aaa.groups,groupName),protocol=groupName==='tacacs+'?'tacacs':groupName;
 const names=Array.isArray(group?.servers)?group.servers:Object.keys(aaa.servers??{}).filter(key=>ownRecordValue(aaa.servers,key)?.protocol===protocol);
 return names.flatMap((name:string)=>{const s=ownRecordValue(aaa.servers,name);return s?.address&&['radius','tacacs'].includes(s.protocol)&&!(d.kind==='datacenter'&&s.protocol==='tacacs'&&!d.config.features.nsos?.enabled?.includes('tacacs+'))?[{...s,name,vrf:group?.vrf??s.vrf,source:group?.source??s.source}]:[];});
}
export function aaaRequest(e:Simulator,d:Device,server:AAAServer,payload:Record<string,unknown>,attempt=0):ServiceResult {
 const operation=String(payload.operation??'authenticate'),stats=aaaStats(d,server.name??server.address,operation),timeout=Math.max(100,Math.min(60000,(server.timeout??5)*1000));
 stats.requests++;if(attempt)stats.retransmits++;stats.last=e.clock.now();
 const options={timeout,vrf:server.vrf==='default'?undefined:server.vrf,source:server.source},data={...payload,key:server.key??''};
 return server.protocol==='radius'?e.udpRequest(d.id,server.address,operation==='accounting'?server.accountingPort??1813:server.port??1812,data,options):e.tcpRequest(d.id,server.address,server.port??49,data,options);
}
export function aaaResponse(e:Simulator,d:Device,server:AAAServer,operation:string,result:ServiceResult):'accept'|'reject'|'error'{
 const s=aaaStats(d,server.name??server.address,operation);s.last=e.clock.now();
 if(result.status==='success'&&!result.error&&typeof (operation==='accounting'?result.accounted:result.accepted)==='boolean'){
  s.responses++;const accepted=operation==='accounting'?result.accounted:result.accepted;if(accepted){s.accepts++;return 'accept';}s.rejects++;return 'reject';
 }
 s.errors++;if(/time(?:d out|out)/i.test(result.error??''))s.timeouts++;return 'error';
}
export function aaaExchange(e:Simulator,d:Device,server:AAAServer,payload:Record<string,unknown>,observe?:(step:AAAAuthStep)=>void):ServiceResult|undefined {
 const operation=String(payload.operation??'authenticate');
 for(let attempt=0;attempt<=(server.protocol==='radius'?server.retransmit??0:0);attempt++){
  const started=e.clock.now(),context=aaaServerState(e,server);
  const result=aaaRequest(e,d,server,payload,attempt),deadline=e.clock.now()+Math.max(100,Math.min(60000,(server.timeout??5)*1000));
  while(result.status==='running'&&e.clock.now()<deadline)e.clock.advance(Math.min(20,deadline-e.clock.now()));
  const outcome=aaaResponse(e,d,server,operation,result);observe?.({method:server.protocol,outcome,started,completed:e.clock.now(),server:server.name??server.address,address:server.address,transaction:result.id,operation,attempt,...context});if(outcome!=='error')return result;
 }
 return undefined;
}
