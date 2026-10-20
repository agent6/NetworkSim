import type {Device,SimEvent} from './model.ts';
export interface DebugHost {device:Device;interfaceName(name:string):string;fail(message?:string):never}
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
 const add=(path:string,run:Spec['run'],args?:string)=>commands.push({words:path.split(' '),description:'Inspect actual simulation events',run,args});
 const word=(value:string,choices:string[])=>{const found=choices.includes(value.toLowerCase())?[value.toLowerCase()]:choices.filter(v=>v.startsWith(value.toLowerCase()));if(found.length!==1)h.fail(found.length?'% Ambiguous command.':undefined);return found[0];};
 for(const [path,choices]of Object.entries(options))for(const operation of ['debug','undebug','no debug'])add(operation+' '+path,(args,no)=>{
  if(required.has(path)&&!args.length)h.fail('% Incomplete command.');let selected:string[]=[];
  if(choices[0]==='*process'){if(args.length>1)h.fail();selected=args;}else if(path==='eigrp packets'){selected=args.map(value=>word(value,choices));}else if(path==='ip ospf'&&args[0]&&'packet'.startsWith(args[0].toLowerCase())){selected=['packet',...args.slice(1).map(value=>word(value,['hello','dd','request','update','ack']))];}else{if(args.length>(choices.length?1:0))h.fail();if(args.length)selected=[word(args[0],choices)];}
  const name=[path,...selected].join(' '),disable=operation!=='debug'||no;runtime.debug??={flags:[],conditions:[]};runtime.debug.flags=(runtime.debug.flags||[]).filter((flag:string)=>flag!==name);if(!disable)runtime.debug.flags.push(name);return [`${name.toUpperCase()} debugging is ${disable?'off':'on'}`];
 },choices.length?choices.join('|'):undefined);
 for(const operation of ['debug','undebug','no debug']){
  add(operation+' all',(_,no)=>{const enabled=operation==='debug'&&!no;runtime.debug??={conditions:[]};runtime.debug.flags=enabled?['all']:[];return [`All possible debugging has been turned ${enabled?'on':'off'}`];});
  for(const type of ['interface','ip'])add(operation+' condition '+type,(args,no)=>{if(!args.length)h.fail('% Incomplete command.');if(args.length!==1)h.fail();const value=type==='interface'?h.interfaceName(args[0]):args[0];if(type==='ip'&&!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value))h.fail();if(type==='ip'&&value.split('.').some(n=>+n>255))h.fail();runtime.debug??={flags:[],conditions:[]};runtime.debug.conditions=(runtime.debug.conditions||[]).filter((row:any)=>row.type!==type||row.value!==value);if(operation==='debug'&&!no)runtime.debug.conditions.push({type,value});return [`Condition ${type} ${value} ${operation==='debug'&&!no?'set':'removed'}`];},type==='interface'?'<interface>':'<address>');
 }
 for(const path of ['undebug interface','no debug interface'])add(path,(args)=>{if(args.length!==1)h.fail(args.length?'% Invalid input detected at \'^\' marker.':'% Incomplete command.');const name=h.interfaceName(args[0]);if(runtime.debug)runtime.debug.conditions=(runtime.debug.conditions||[]).filter((row:any)=>row.type!=='interface'||row.value!==name);},'<interface>');
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
  if(flag.startsWith('ip packet'))return event.packet?.ipVersion===4;
  const protocol=flag.startsWith('spanning-tree')?'stp':flag.startsWith('event manager')?'eem':flag.startsWith('crypto isakmp')?'ike':flag.startsWith('crypto ipsec')?'ipsec':flag.replace(/^(ip|ipv6) /,'').split(' ')[0];
  if(protocol==='nd')return /ndp|neighbor (solicitation|advertisement)|icmpv6.*(neighbor|router)/.test(text);
  if(!text.includes(protocol)&&!(protocol==='standby'&&text.includes('hsrp')))return false;
  if(/ (hello|keepalives)$/.test(flag))return /hello|keepalive/.test(text);
  if(/ updates?$/.test(flag))return /update|advertis/.test(text);
  return true;
 };
 if(!debug.flags.some(matches))return;
 const rows=device.runtime.features.debugEntries??=[];
 rows.push({id:event.id,time:event.time,message:`${event.protocol.toUpperCase()}: ${event.label}${event.port?' on '+event.port:''}${event.packet?.source?' s='+event.packet.source:''}${event.packet?.destination?', d='+event.packet.destination:''}${event.detail?' — '+event.detail:''}`,severity:7});if(rows.length>500)rows.splice(0,rows.length-500);
}
