import type {Simulator} from './engine.ts';
import type {Device,SimEvent} from './model.ts';
import {isIPv4} from './ip.ts';
import {ownRecordValue} from './record-map.ts';
import {natRuleKey} from './nat-state.ts';

type Endpoints={device:string;inside:string;outside:string;insideLocal:string;insideGlobal:string;outsideAddress:string};
type PATRule={device:string;acl:string;interface:string};
export type NATCriterion=
 | {kind:'nat-interface';device:string;interface:string;role:'inside'|'outside'}
 | {kind:'nat-static';device:string;insideLocal:string;insideGlobal:string}
 | {kind:'pat-acl';device:string;name:string;network:string;wildcard:string}
 | (PATRule & {kind:'pat-rule'})
 | (PATRule & {kind:'pat-sharing';inside:string[];outside:string;insideGlobal:string;outsideAddress:string})
 | (Endpoints & {kind:'nat-ping';direction:'inside-out'|'outside-in'})
 | (Endpoints & {kind:'nat-http'|'nat-outbound-http';content:string});

export function validNATCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
 if(c.kind==='nat-interface')return name(c.interface)&&['inside','outside'].includes(c.role);
 if(c.kind==='pat-acl')return name(c.name)&&isIPv4(c.network)&&isIPv4(c.wildcard);
 if(c.kind==='pat-rule')return name(c.acl)&&name(c.interface);
 if(c.kind==='pat-sharing')return name(c.acl)&&name(c.interface)&&name(c.outside)&&isIPv4(c.insideGlobal)&&isIPv4(c.outsideAddress)&&Array.isArray(c.inside)&&c.inside.length>=2&&c.inside.length<=8&&new Set(c.inside).size===c.inside.length&&c.inside.every(name);
 if(!isIPv4(c.insideLocal)||!isIPv4(c.insideGlobal))return false;
 if(c.kind==='nat-static')return true;
 return name(c.inside)&&name(c.outside)&&isIPv4(c.outsideAddress)&&(c.kind==='nat-ping'?['inside-out','outside-in'].includes(c.direction):['nat-http','nat-outbound-http'].includes(c.kind)&&typeof c.content==='string'&&c.content.length>0&&c.content.length<=1000);
}
const find=(sim:Simulator,id:string)=>sim.lab.devices.find(d=>d.id===id||d.config.hostname===id);
const natEvent=(d:Device,e:SimEvent,label:string)=>e.nodeId===d.id&&e.label===label&&e.disposition==='forward';
const overloadRule=(d:Device,c:PATRule)=>(d.config.features.nat?.rules??[]).find((r:any)=>r.acl===c.acl&&r.interface===c.interface&&r.overload===true&&!r.pool);

/** A successful return must belong to the translated request, not an unrelated probe or table row. */
function deliveredPing(sim:Simulator,d:Device,c:Endpoints,direction:'inside-out'|'outside-in',identifiers?:{inside:number;outside:number}):boolean{
 const inside=find(sim,c.inside),outside=find(sim,c.outside);if(!inside||!outside)return false;
 const events=sim.events,outbound=direction==='inside-out',sender=outbound?inside:outside,receiver=outbound?outside:inside;
 const translated=(label:string,packet:SimEvent['packet'])=>!!packet&&events.some(e=>natEvent(d,e,label)&&e.packet?.id===packet.id&&e.packet.source===packet.source&&e.packet.destination===packet.destination&&e.packet.icmpIdentifier===packet.icmpIdentifier);
 return events.some(reply=>{
  const packet=reply.packet;
  if(reply.nodeId!==sender.id||reply.label!=='Echo reply received'||reply.disposition!=='success'||packet?.icmpType!==0||packet.source!==(outbound?c.outsideAddress:c.insideGlobal)||packet.destination!==(outbound?c.insideLocal:c.outsideAddress)||identifiers&&packet.icmpIdentifier!==identifiers.inside)return false;
  const request=events.find(e=>e.nodeId===receiver.id&&e.label==='Echo request accepted'&&e.packet?.id===packet.parentId&&e.packet?.icmpType===8&&e.packet.source===(outbound?c.insideGlobal:c.outsideAddress)&&e.packet.destination===(outbound?c.outsideAddress:c.insideLocal)&&(!identifiers||e.packet.icmpIdentifier===identifiers.outside));
  return !!request&&translated(outbound?'Source NAT':'Destination NAT',request.packet)&&translated(outbound?'Destination NAT':'Source NAT',packet);
 });
}

export function matchesNATCriterion(sim:Simulator,d:Device,c:NATCriterion):boolean{
 if(c.kind==='nat-interface')return d.config.interfaces[c.interface]?.features.nat===c.role&&sim.interfaceUp(d.id,c.interface);
 if(c.kind==='nat-static')return (d.config.features.nat?.static??[]).some((row:any)=>row.inside===c.insideLocal&&row.outside===c.insideGlobal);
 if(c.kind==='pat-acl'){
  const acl=ownRecordValue(d.config.features.acls,c.name),entries=(acl?.entries??[]).filter((e:any)=>e.action!=='remark'&&e.remark===undefined);
  return acl?.type==='standard'&&entries.length===1&&entries[0].action==='permit'&&entries[0].source===c.network&&entries[0].wildcard===c.wildcard;
 }
 if(c.kind==='pat-rule')return !!overloadRule(d,c);
 if(c.kind==='pat-sharing'){
  const rule=overloadRule(d,c);if(!rule)return false;
  const rows:any[]=d.runtime.features.natTranslations??[],key=natRuleKey(rule);
  const choices=c.inside.map(name=>{const host=find(sim,name);return rows.filter(row=>host&&Object.values(host.config.interfaces).some(p=>p.ip===row.inside)&&row.overload===true&&row.rule===key&&row.protocol==='icmp'&&row.outside===c.insideGlobal&&row.remote===c.outsideAddress&&row.expires>sim.clock.now()&&deliveredPing(sim,d,{device:d.id,inside:host.id,outside:c.outside,insideLocal:row.inside,insideGlobal:c.insideGlobal,outsideAddress:c.outsideAddress},'inside-out',{inside:row.insidePort,outside:row.outsidePort}));});
  const distinct=(index:number,used:Set<number>):boolean=>index===choices.length||choices[index].some(row=>!used.has(row.outsidePort)&&distinct(index+1,new Set([...used,row.outsidePort])));
  return distinct(0,new Set());
 }
 if(c.kind==='nat-ping')return deliveredPing(sim,d,c,c.direction);
 const inside=find(sim,c.inside),outside=find(sim,c.outside);if(!inside||!outside)return false;
 const outbound=c.kind==='nat-outbound-http',client=outbound?inside:outside,server=outbound?outside:inside;
 const target=outbound?c.outsideAddress:c.insideGlobal,serverLocal=outbound?c.outsideAddress:c.insideLocal,remoteSource=outbound?c.insideGlobal:c.outsideAddress;
 for(const [transaction,conn]of Object.entries<any>(client.runtime.features.tcpConnections??{})){
  if(conn.remoteAddress!==target||conn.remotePort!==80||conn.payload?.application!=='http'||(conn.payload.method??'GET')!=='GET'||conn.payload.path!=='/'||!Number.isInteger(conn.expected)||conn.expected<1||conn.expected>2048||conn.received!==conn.expected)continue;
  const received=ownRecordValue(server.runtime.features.tcpConnections,transaction);
  if(received?.source!==remoteSource||received.localAddress!==serverLocal||received.destinationPort!==80||received.response?.statusCode!==200)continue;
  let response:any;try{response=JSON.parse(Array.from({length:conn.expected},(_,i)=>conn.segments[i]).join(''));}catch{continue;}
  if(response.error||response.statusCode!==200||typeof response.content!=='string'||!response.content.includes(c.content)||response.content!==received.response.content)continue;
  const binding=outbound?(d.runtime.features.natTranslations??[]).find((r:any)=>r.overload&&r.inside===c.insideLocal&&r.insidePort===conn.localPort&&r.outside===c.insideGlobal&&r.remote===c.outsideAddress&&r.remotePort===80&&r.protocol==='tcp'&&r.expires>sim.clock.now()):undefined;
  if(outbound&&!binding)continue;
  const sourcePort=outbound?binding.outsidePort:80;
  if(outbound){
   if(sim.events.some(e=>natEvent(d,e,'Source NAT')&&e.packet?.protocol==='TCP'&&e.packet.source===c.insideGlobal&&e.packet.destination===c.outsideAddress&&e.packet.sourcePort===sourcePort&&e.packet.destinationPort===80)&&sim.events.some(e=>natEvent(d,e,'Destination NAT')&&e.packet?.protocol==='TCP'&&e.packet.source===c.outsideAddress&&e.packet.destination===c.insideLocal&&e.packet.sourcePort===80&&e.packet.destinationPort===conn.localPort))return true;
  }else if(sim.events.some(e=>natEvent(d,e,'Destination NAT')&&e.packet?.protocol==='TCP'&&e.packet.source===c.outsideAddress&&e.packet.destination===c.insideLocal&&e.packet.sourcePort===conn.localPort&&e.packet.destinationPort===80)&&sim.events.some(e=>natEvent(d,e,'Source NAT')&&e.packet?.protocol==='TCP'&&e.packet.source===c.insideGlobal&&e.packet.destination===c.outsideAddress&&e.packet.sourcePort===80&&e.packet.destinationPort===conn.localPort))return true;
 }
 return false;
}
