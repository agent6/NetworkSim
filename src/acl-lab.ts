import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4} from './ip.ts';
import {ownRecordValue} from './record-map.ts';

type Rule={sequence:number;action:'permit'|'deny';source:string;wildcard:string};
type ExtendedRule=Rule&{protocol:'ip'|'tcp'|'udp'|'icmp';destination:string;destinationWildcard:string;sourcePort?:number;destinationPort?:number;icmpType?:'echo'|'echo-reply'};
type AppliedACL={device:string;name:string;interface:string;direction:'in'|'out'};
type Traffic=AppliedACL&{source:string;target:string;action:'permit'|'deny';sequence?:number;implicit?:boolean};
export type ACLLabCriterion=
 | {kind:'standard-acl';device:string;name:string;entries:Rule[]}
 | {kind:'extended-acl';device:string;name:string;entries:ExtendedRule[]}
 | (AppliedACL&{kind:'acl-binding';exclusive?:boolean})
 | (Traffic&{kind:'acl-ping'})
 | (Traffic&{kind:'acl-http';content?:string})
 | (Traffic&{kind:'acl-dns';query:string;answer:string});

export function validACLLabCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
 const sequence=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647;
 if(!name(c.name))return false;
 if(c.kind==='standard-acl'||c.kind==='extended-acl')return Array.isArray(c.entries)&&c.entries.length>0&&c.entries.length<=64&&new Set(c.entries.map((e:any)=>e?.sequence)).size===c.entries.length&&c.entries.every((e:any)=>{
  if(!e||!sequence(e.sequence)||!['permit','deny'].includes(e.action)||!isIPv4(e.source)||!isIPv4(e.wildcard))return false;
  if(c.kind==='standard-acl')return true;
  const port=(v:unknown)=>v===undefined||Number.isInteger(v)&&Number(v)>=0&&Number(v)<=65535;
  return ['ip','tcp','udp','icmp'].includes(e.protocol)&&isIPv4(e.destination)&&isIPv4(e.destinationWildcard)&&port(e.sourcePort)&&port(e.destinationPort)&&(['tcp','udp'].includes(e.protocol)||e.sourcePort===undefined&&e.destinationPort===undefined)&&(e.icmpType===undefined||e.protocol==='icmp'&&['echo','echo-reply'].includes(e.icmpType));
 });
 if(!name(c.interface)||!['in','out'].includes(c.direction))return false;
 if(c.kind==='acl-binding')return c.exclusive===undefined||typeof c.exclusive==='boolean';
 if(!['acl-ping','acl-http','acl-dns'].includes(c.kind)||!name(c.source)||!name(c.target)||!['permit','deny'].includes(c.action))return false;
 if(c.implicit!==undefined&&typeof c.implicit!=='boolean'||c.sequence!==undefined&&!sequence(c.sequence)||c.implicit===true&&(c.sequence!==undefined||c.action!=='deny'))return false;
 if(c.kind==='acl-dns')return c.action==='permit'&&typeof c.query==='string'&&c.query.length>0&&c.query.length<=253&&c.query.split('.').every((part:string)=>part.length>0&&part.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part))&&isIPv4(c.answer);
 return c.kind!=='acl-http'||(c.content===undefined||typeof c.content==='string'&&c.content.length>0&&c.content.length<=1000)&&(c.action==='deny'||typeof c.content==='string');
}
const find=(sim:Simulator,id:string)=>sim.lab.devices.find(d=>d.id===id||d.config.hostname===id);
const address=(d:Device)=>Object.values(d.config.interfaces).find(p=>!!p.ip)?.ip;

export function matchesACLLabCriterion(sim:Simulator,d:Device,c:ACLLabCriterion,after=-Infinity):boolean{
 if(c.kind==='standard-acl'||c.kind==='extended-acl'){
  const acl=ownRecordValue(d.config.features.acls,c.name),entries=(acl?.entries??[]).filter((e:any)=>e.action!=='remark'&&e.remark===undefined).sort((a:any,b:any)=>a.sequence-b.sequence);
  return acl?.type===(c.kind==='standard-acl'?'standard':'extended')&&entries.length===c.entries.length&&c.entries.every((expected,i)=>{const actual=entries[i];return actual.sequence===expected.sequence&&actual.action===expected.action&&actual.source===expected.source&&actual.wildcard===expected.wildcard&&!actual.timeRange&&(c.kind==='standard-acl'?!actual.sourcePort&&!actual.destinationPort:['protocol','destination','destinationWildcard','sourcePort','destinationPort','icmpType','icmpCode'].every(key=>actual[key]===(expected as any)[key]));});
 }
 if(c.kind==='acl-binding'){
  const field=c.direction==='in'?'aclIn':'aclOut';
  return d.config.interfaces[c.interface]?.features[field]===c.name&&sim.interfaceUp(d.id,c.interface)&&(!c.exclusive||Object.entries(d.config.interfaces).every(([port,p])=>['aclIn','aclOut'].every(key=>!p.features[key]||port===c.interface&&key===field&&p.features[key]===c.name)));
 }
 const source=find(sim,c.source),target=find(sim,c.target);if(!source||!target)return false;
 const src=address(source),dst=address(target);if(!src||!dst)return false;
 const decisions:any[]=(d.runtime.features.aclDecisions??[]).filter((row:any)=>row.time>after&&row.name===c.name&&row.port===c.interface&&row.direction===c.direction&&row.source===src&&row.destination===dst&&row.action===c.action&&(c.implicit===true?row.implicit===true:row.implicit===false&&(c.sequence===undefined||row.sequence===c.sequence)));
 const dropped=(row:any)=>sim.events.some(e=>e.nodeId===d.id&&e.port===c.interface&&e.label===(c.direction==='in'?'Ingress ACL denied':'Egress ACL denied')&&e.disposition==='drop'&&e.packet?.id===row.packetId);
 if(c.kind==='acl-ping')return decisions.some(row=>row.protocol==='icmp'&&row.kind==='echo-request'&&(c.action==='deny'?dropped(row):sim.events.some(e=>e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet?.id===row.packetId)&&sim.events.some(e=>e.nodeId===source.id&&e.label==='Echo reply received'&&e.disposition==='success'&&e.packet?.parentId===row.packetId&&e.packet?.source===dst&&e.packet.destination===src)));
 if(c.kind==='acl-dns')return decisions.some(row=>row.protocol==='udp'&&row.kind==='dns-query'&&row.destinationPort===53&&(target.runtime.features.dnsQueries??[]).some((query:any)=>query.packetId===row.packetId&&query.transaction===row.transaction&&query.source===src&&query.name===c.query.toLowerCase()&&query.type==='A'&&query.rcode==='NOERROR'&&query.address===c.answer)&&sim.events.some(e=>e.nodeId===source.id&&e.disposition==='receive'&&e.packet?.messageType==='dns-response'&&e.packet.parentId===row.packetId&&e.packet.source===dst&&e.packet.destination===src&&e.packet.sourcePort===53&&e.packet.destinationPort===row.sourcePort));
 for(const [transaction,conn]of Object.entries<any>(source.runtime.features.tcpConnections??{})){
  if(conn.remoteAddress!==dst||conn.remotePort!==80||conn.payload?.application!=='http'||(conn.payload.method??'GET')!=='GET'||conn.payload.path!=='/')continue;
  const applied=decisions.filter(row=>row.protocol==='tcp'&&row.transaction===transaction&&row.sourcePort===conn.localPort&&row.destinationPort===80);
  if(c.action==='deny'){if(!conn.received&&applied.some(row=>row.kind==='tcp-syn'&&dropped(row)))return true;continue;}
  if(!applied.some(row=>['tcp-request','tcp-request-segment'].includes(row.kind))||!Number.isInteger(conn.expected)||conn.expected<1||conn.expected>2048||conn.received!==conn.expected)continue;
  const received=ownRecordValue(target.runtime.features.tcpConnections,transaction);if(received?.source!==src||received.localAddress!==dst||received.response?.statusCode!==200)continue;
  let response:any;try{response=JSON.parse(Array.from({length:conn.expected},(_,i)=>conn.segments[i]).join(''));}catch{continue;}
  if(!response.error&&response.statusCode===200&&typeof response.content==='string'&&response.content.includes(c.content!)&&response.content===received.response.content)return true;
 }
 return false;
}
