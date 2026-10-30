import {bufferIOSMessage,iosLogLine} from './ios-system.ts';
import type {Device,SimEvent} from './model.ts';
export interface DebugHost {device:Device;interfaceName(name:string):string;fail(message?:string):never;now?:()=>number;eventCursor?:()=>string|undefined}
type Spec={words:string[];description:string;args?:string;run(args:string[],no:boolean):string[]|void};
const options:Record<string,string[]>={
 'arp':[],'ipv6 nd':[],'ip packet':['detail'],'ip dhcp server':['events','packet'],
 'ip nat':['detailed'],'ip ospf':['adj','events','hello','packet','retransmission','spf','lsa-generation'],
 'ip bgp':['events','keepalives','updates'],'ip eigrp':['notifications','summary','neighbors','transactions'],
 'ip rip':['database','events','trigger'],'ipv6 rip':['*process'],
 'standby':['errors','events','packets'],'eigrp fsm':['events','actions'],'eigrp packets':['hello','update','query','reply','ack','siaquery','siareply','stub'],
 'crypto isakmp':[],'crypto ipsec':[],'nhrp':['packet','error'],'ip nhrp':[],'spanning-tree events':[],'spanning-tree bpdu':[],'event manager action':['cli']
};
const required=new Set(['ip dhcp server','ip ospf','event manager action']);
/** Debug subscriptions are runtime state, never configuration or invented protocol traffic. */
export function debugCommands(h:DebugHost):Spec[]{
 const runtime=h.device.runtime.features,commands:Spec[]=[];
 const audit=(action:string,flag:string)=>{const rows=runtime.debugActions??=[];rows.push({time:h.now?.()??0,eventCursor:h.eventCursor?.(),action,flag});if(rows.length>100)rows.splice(0,rows.length-100);};
 const add=(path:string,run:Spec['run'],args?:string)=>commands.push({words:path.split(' '),description:'Inspect actual simulation events',run,args});
 const word=(value:string,choices:string[])=>{const found=choices.includes(value.toLowerCase())?[value.toLowerCase()]:choices.filter(v=>v.startsWith(value.toLowerCase()));if(found.length!==1)h.fail(found.length?'% Ambiguous command.':undefined);return found[0];};
 for(const [path,choices]of Object.entries(options))for(const operation of ['debug','undebug','no debug'])add(operation+' '+path,(args,no)=>{
  if(required.has(path)&&!args.length)h.fail('% Incomplete command.');let selected:string[]=[];
  if(choices[0]==='*process'){if(args.length>1)h.fail();selected=args;}else if(path==='eigrp packets'){selected=args.map(value=>word(value,choices));}else if(path==='ip ospf'&&args[0]&&'packet'.startsWith(args[0].toLowerCase())){selected=['packet',...args.slice(1).map(value=>word(value,['hello','dd','request','update','ack']))];}else{if(args.length>(choices.length?1:0))h.fail();if(args.length)selected=[word(args[0],choices)];}
  const name=[path,...selected].join(' '),disable=operation!=='debug'||no;runtime.debug??={flags:[],conditions:[]};runtime.debug.flags=(runtime.debug.flags||[]).filter((flag:string)=>flag!==name);if(!disable)runtime.debug.flags.push(name);audit(disable?'off':'on',name);return [`${name.toUpperCase()} debugging is ${disable?'off':'on'}`];
 },choices.length?choices.join('|'):undefined);
 for(const operation of ['debug','undebug','no debug']){
  add(operation+' all',(_,no)=>{const enabled=operation==='debug'&&!no;runtime.debug??={conditions:[]};runtime.debug.flags=enabled?['all']:[];audit(enabled?'on':'off','all');return [`All possible debugging has been turned ${enabled?'on':'off'}`];});
  for(const type of ['interface','ip'])add(operation+' condition '+type,(args,no)=>{if(!args.length)h.fail('% Incomplete command.');if(args.length!==1)h.fail();const value=type==='interface'?h.interfaceName(args[0]):args[0];if(type==='ip'&&!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value))h.fail();if(type==='ip'&&value.split('.').some(n=>+n>255))h.fail();runtime.debug??={flags:[],conditions:[]};runtime.debug.conditions=(runtime.debug.conditions||[]).filter((row:any)=>row.type!==type||row.value!==value);if(operation==='debug'&&!no)runtime.debug.conditions.push({type,value});audit(operation==='debug'&&!no?'condition-on':'condition-off',type+' '+value);return [`Condition ${type} ${value} ${operation==='debug'&&!no?'set':'removed'}`];},type==='interface'?'<interface>':'<address>');
 }
 for(const path of ['undebug interface','no debug interface'])add(path,(args)=>{if(args.length!==1)h.fail(args.length?'% Invalid input detected at \'^\' marker.':'% Incomplete command.');const name=h.interfaceName(args[0]);if(runtime.debug)runtime.debug.conditions=(runtime.debug.conditions||[]).filter((row:any)=>row.type!=='interface'||row.value!==name);audit('condition-off','interface '+name);},'<interface>');
 add('show debugging',(args)=>{if(args.length>1)h.fail();if(args.length)word(args[0],['condition']);const value=runtime.debug||{};return [...(!args.length?(value.flags||[]).map((flag:string)=>`${flag.toUpperCase()} debugging is on`):[]),...(value.conditions||[]).map((row:any,index:number)=>`Condition ${index+1}: ${row.type} ${row.value}`)];},'[condition]');
 return commands;
}
export function captureDebugEvent(device:Device,event:SimEvent):void{
 const debug=device.runtime.features.debug;if(!debug?.flags?.length)return;
 const conditions:any[]=debug.conditions||[];
 if(conditions.length&&!conditions.some(condition=>condition.type==='interface'?event.port===condition.value:event.packet?.source===condition.value||event.packet?.destination===condition.value))return;
 const text=[event.protocol,event.label,event.detail,event.packet?.messageType].join(' ').toLowerCase();
 const matches=(flag:string)=>{
  if(flag==='all')return true;
  if(flag.startsWith('ip packet')){
   const p=event.packet;if(p?.ipVersion!==4||!['Frame sent','Frame received','No route','TTL expired'].includes(event.label))return false;
   const local=new Set([...Object.values(device.config.interfaces).flatMap(i=>[i.ip,...(i.features.secondaryIps??[]).map((r:any)=>r.ip)]),...(device.runtime.features.virtualIps??[]).filter((r:any)=>r.role==='active').map((r:any)=>r.ip)].filter(Boolean));
   // IOS packet debugging observes locally processed traffic; CEF transit is not a packet capture.
   return device.config.features.cef===false||local.has(p.source)||local.has(p.destination)||event.label==='No route'||event.label==='TTL expired';
  }
  const protocol=flag.startsWith('spanning-tree')?'stp':flag.startsWith('event manager')?'eem':flag.startsWith('crypto isakmp')?'ike':flag.startsWith('crypto ipsec')?'ipsec':flag.replace(/^(ip|ipv6) /,'').split(' ')[0];
  if(protocol==='nd')return /ndp|neighbor (solicitation|advertisement)|icmpv6.*(neighbor|router)/.test(text);
  if(!text.includes(protocol)&&!(protocol==='standby'&&text.includes('hsrp')))return false;
  if(/ (hello|keepalives)$/.test(flag))return /hello|keepalive/.test(text);
  if(/ updates?$/.test(flag))return /update|advertis/.test(text);
  return true;
 };
 const flags:string[]=debug.flags.filter(matches);if(!flags.length)return;
 const rows=device.runtime.features.debugEntries??=[];
 const addresses=/^(\S+) → (\S+)$/.exec(event.detail??''),nat=debug.flags.some((f:string)=>f==='all'||f.startsWith('ip nat'))&&addresses&&/^(Source|Destination) NAT$/.test(event.label);
 const native=nat?event.label==='Source NAT'?`NAT: s=${addresses[1]}->${addresses[2]}, d=${event.packet?.destination??''}`:`NAT: s=${event.packet?.source??''}, d=${addresses[1]}->${addresses[2]}`:undefined;
 const ipPacket=flags.some(f=>f.startsWith('ip packet')),p=event.packet;
 const localSource=Object.values(device.config.interfaces).some(i=>i.ip===p?.source),packetMessage=ipPacket&&p?`IP: s=${p.source} (${localSource?'local':event.port??'unknown'}), d=${p.destination}${event.label==='Frame sent'?' ('+(event.port??'unknown')+')':''}, len ${p.size??0}, ${event.label==='Frame sent'?'sending':event.label==='Frame received'?'rcvd 3':event.label.toLowerCase()}`:undefined;
 const base=native??packetMessage??`${event.protocol.toUpperCase()}: ${event.label}${event.port?' on '+event.port:''}${p?.source?' s='+p.source:''}${p?.destination?', d='+p.destination:''}${event.detail?' — '+event.detail:''}`;
 const messages=[base,...ipPacket&&flags.some(f=>f.includes('detail'))&&p?.icmpType!==undefined?[`    ICMP type=${p.icmpType}, code=${p.icmpCode??0}`]:[]];
 const logging=device.config.features.logging??{},consoleAvailable=logging.enabled!==false&&logging.console!==false&&(logging.consoleLevel??7)>=7,monitorAvailable=logging.enabled!==false&&logging.monitor!==false&&(logging.monitorLevel??7)>=7;
 for(const[index,message]of messages.entries()){
  const row={id:event.id+(index?':'+index:''),eventId:event.id,time:event.time,message,severity:7,sequence:device.runtime.features.logSequence=(device.runtime.features.logSequence??0)+1,flags:[...flags],conditions:structuredClone(conditions),event:{label:event.label,detail:event.detail,port:event.port,protocol:event.protocol,...p?{packet:structuredClone(p)}:{}},consoleAvailable,monitorAvailable,buffered:false,bufferedLine:''};
  row.buffered=bufferIOSMessage(device,row,'debug');if(row.buffered)row.bufferedLine=iosLogLine(device,row,'debug');rows.push(row);if(consoleAvailable)(device.runtime.features.logSinkCounts??={console:0,monitor:0,buffer:0,trap:0}).console++;
 }
 if(rows.length>500)rows.splice(0,rows.length-500);
}
