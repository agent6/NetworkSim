import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,sameAddress} from './ip.ts';
type Path={target:string;address:string;path:string[]};
export type OSPFP2PCriterion=({kind:'op2p-echo';device:string}&Path)|({kind:'op2p-failover';device:string;interface:string;peer:string;source:string;metric:number}&Path);
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
export function validOSPFP2PCriterion(c:any):boolean{
 if(!c||!name(c.device)||!name(c.target)||!isIPv4(typeof c.address==='string'?c.address:'')||!Array.isArray(c.path)||c.path.length<2||c.path.length>6||!c.path.every(name)||new Set(c.path).size!==c.path.length||c.path.includes(c.target))return false;
 if(c.kind==='op2p-echo')return c.target!==c.device&&!c.path.includes(c.device);
 return c.kind==='op2p-failover'&&name(c.interface)&&name(c.peer)&&name(c.source)&&c.source!==c.target&&!c.path.includes(c.source)&&c.path.length>=3&&c.path[0]===c.device&&c.path.at(-1)===c.peer&&Number.isInteger(c.metric)&&c.metric>=1&&c.metric<=65535;
}
/** Correlate actual packets with both currently selected OSPF forwarding paths. */
function echo(s:Simulator,source:Device,target:Device,address:string,path:Device[],since=0):boolean{
 const ip=(d:Device)=>d.config.interfaces.GigabitEthernet0?.ip;
 const from=ip(source);if(!from||!sameAddress(ip(target)??'',address)||![source,target,...path].every(d=>s.devicePowered(d.id)))return false;
 const leg=(packetId:string,dest:string,routers:Device[],end:Device)=>{
  let time=since;
  for(let i=0;i<routers.length;i++){
   const r=routers[i],lookup=s.cefLookup(r.id,dest);if(!lookup||!['connected','O'].includes(lookup.route.protocol)||lookup.route.protocol==='O'&&lookup.route.ad!==110)return false;
   const next=routers[i+1]??end,wire=s.linkAt(r.id,lookup.port);if(!wire?.enabled||![wire.a.deviceId,wire.b.deviceId].includes(next.id))return false;
   const sent=s.events.find(e=>e.time>=time&&e.nodeId===r.id&&e.port===lookup.port&&e.label==='Frame sent'&&e.packet?.id===packetId&&e.packet.protocol==='ICMP'&&e.packet.ipVersion===4&&sameAddress(e.packet.destination,dest));
   if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===next.id&&e.label==='Frame received'&&e.packet?.id===packetId))return false;time=sent.time;
  }
  return true;
 };
 return s.events.some(e=>e.time>=since&&e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet?.protocol==='ICMP'&&e.packet.ipVersion===4&&sameAddress(e.packet.source,from)&&sameAddress(e.packet.destination,address)&&leg(e.packet.id,address,path,target)&&s.events.some(reply=>reply.time>=e.time&&reply.nodeId===source.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet!.id&&sameAddress(reply.packet.source,address)&&sameAddress(reply.packet.destination,from)&&leg(reply.packet.id,from,[...path].reverse(),source)));
}
export function matchesOSPFP2PCriterion(s:Simulator,d:Device,c:OSPFP2PCriterion,after=0):boolean{
 const target=s.getDevice(c.target),path=c.path.map(id=>s.getDevice(id));if(!target||path.some(d=>!d||d.kind!=='router'))return false;
 if(c.kind==='op2p-echo')return echo(s,d,target,c.address,path as Device[],after);
 const source=s.getDevice(c.source),peer=s.getDevice(c.peer);if(!source||!peer||d.config.interfaces[c.interface]?.adminUp!==false||s.interfaceUp(d.id,c.interface))return false;
 const since=(d.runtime.features.logEntries??[]).reduce((t:number,e:any)=>e.message===`%LINK-3-UPDOWN: Interface ${c.interface}, changed state to down`?Math.max(t,e.time):t,-1);if(since<0)return false;
 if(!s.events.some(e=>e.time>=since&&e.protocol==='OSPF'&&e.label==='OSPF neighbor DOWN'&&e.detail.includes(': FULL → DOWN.')&&((e.nodeId===d.id&&e.peerId===peer.id)||(e.nodeId===peer.id&&e.peerId===d.id))))return false;
 const from=source.config.interfaces.GigabitEthernet0?.ip;if(!from)return false;
 for(const[r,addr]of [[d,c.address],[peer,from]] as const){const lookup=s.cefLookup(r.id,addr);if(lookup?.route.protocol!=='O'||lookup.route.ad!==110||lookup.route.metric!==c.metric)return false;}
 return echo(s,source,target,c.address,path as Device[],since)&&echo(s,target,source,from,[...path].reverse() as Device[],since);
}
