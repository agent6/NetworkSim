import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,parseCidr,prefixContains,sameAddress} from './ip.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
type Range={area:number;network:string;prefix:number};
export type OSPFSummaryCriterion=
 | {kind:'osum-domain';device:string;areas:number[];active:string[];range?:Range}
 | {kind:'osum-summary';device:string;abr:string;network:string;prefix:number;metric:number;nextHop:string;interface:string}
 | {kind:'osum-hole';device:string;abr:string;edge:string;network:string;prefix:number;address:string};
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const unique=(v:any,min:number,max:number,test:(v:any)=>boolean)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(test)&&new Set(v).size===v.length;
const area=(v:unknown)=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<=4294967295;
const ip=(v:unknown):v is string=>typeof v==='string'&&isIPv4(v);
const cidr=(c:any)=>ip(c.network)&&Number.isInteger(c.prefix)&&c.prefix>=0&&c.prefix<=32&&parseCidr(c.network+'/'+c.prefix).network===c.network;
export function validOSPFSummaryCriterion(c:any):boolean{
 if(!c||!name(c.device))return false;
 if(c.kind==='osum-domain')return unique(c.areas,1,8,area)&&unique(c.active,1,4,name)&&(c.range===undefined||c.range&&area(c.range.area)&&c.areas.includes(c.range.area)&&cidr(c.range));
 if(!name(c.abr)||c.abr===c.device||!cidr(c))return false;
 if(c.kind==='osum-summary')return ip(c.nextHop)&&name(c.interface)&&Number.isInteger(c.metric)&&c.metric>=0&&c.metric<=16777215;
 return c.kind==='osum-hole'&&name(c.edge)&&new Set([c.device,c.abr,c.edge]).size===3&&ip(c.address)&&prefixContains(c.network,c.prefix,c.address);
}
export function matchesOSPFSummaryCriterion(s:Simulator,d:Device,c:OSPFSummaryCriterion):boolean{
 if(!s.devicePowered(d.id))return false;
 if(c.kind==='osum-domain'){
  const cfg=d.config.protocols.ospf,live=ospfLiveDetail(s,d.id,'ospf');if(!cfg||!live||!d.config.ipRouting||d.config.staticRoutes.length||Object.keys(d.config.protocols).some(p=>p!=='ospf')||(cfg.redistribute??[]).length||cfg.defaultOriginate||cfg.discardRoutes?.internal===false)return false;
  const areas=[...new Set(live.interfaces.filter(p=>s.interfaceUp(d.id,p.name)).map(p=>Number(p.area)))].sort((a,b)=>a-b),active=cfg.activeInterfaces??[];
  if(JSON.stringify(areas)!==JSON.stringify([...c.areas].sort((a,b)=>a-b))||!(cfg.passiveInterfaces??[]).includes('default')||active.length!==c.active.length||!c.active.every(p=>active.includes(p)))return false;
  const ranges:any[]=[];for(const[a,v]of Object.entries<any>(cfg.areas??{})){if(!c.areas.includes(Number(a))||v.type&&v.type!=='normal'||v.noSummary)return false;for(const r of v.ranges??[])ranges.push({...r,area:Number(a)});}
  return c.range?ranges.length===1&&ranges[0].area===c.range.area&&ranges[0].network===c.range.network&&ranges[0].prefix===c.range.prefix&&!ranges[0].notAdvertise&&ranges[0].cost===undefined:!ranges.length;
 }
 const abr=s.getDevice(c.abr);if(!abr||!s.devicePowered(abr.id))return false;
 if(c.kind==='osum-summary'){
  const r=s.cefLookup(d.id,c.network)?.route;if(!r||r.network!==c.network||r.prefix!==c.prefix||r.protocol!=='O IA'||r.ad!==110||r.metric!==c.metric||r.nextHop!==c.nextHop||r.interface!==c.interface)return false;
  if(d.runtime.routes.some(r=>r.prefix>c.prefix&&prefixContains(c.network,c.prefix,r.network)))return false;
  // The remote observer must have received the ABR's policy snapshot. This is
  // the simulator's logical router record, not a claim of a binary Type-3 LSA.
  return !!ospfLiveDetail(s,d.id,'ospf')?.lsas.some(l=>[...l.links.map(k=>k.from),...l.prefixes.map(p=>p.endpoint)].some(p=>p.deviceId===c.abr&&Object.values<any>(p.snapshot?.deviceConfig?.protocols?.ospf?.areas??{}).some(a=>a.ranges?.some((r:any)=>r.network===c.network&&r.prefix===c.prefix&&!r.notAdvertise))));
 }
 const edge=s.getDevice(c.edge),from=d.config.interfaces.GigabitEthernet0?.ip;if(!edge||!from||!s.devicePowered(edge.id))return false;
 const selected=s.cefLookup(edge.id,c.address),discard=s.cefLookup(abr.id,c.address),wire=selected&&s.linkAt(edge.id,selected.port);
 if(!selected||selected.route.protocol!=='O IA'||selected.route.network!==c.network||selected.route.prefix!==c.prefix||selected.route.ad!==110||!wire?.enabled||![wire.a.deviceId,wire.b.deviceId].includes(abr.id)||discard?.route.protocol!=='O summary'||discard.route.network!==c.network||discard.route.prefix!==c.prefix||discard.port!=='Null0')return false;
 return s.events.some(drop=>drop.nodeId===abr.id&&drop.label==='Null route'&&drop.port==='Null0'&&drop.disposition==='drop'&&drop.packet?.protocol==='ICMP'&&drop.packet.ipVersion===4&&drop.packet.messageType==='echo-request'&&sameAddress(drop.packet.source,from)&&sameAddress(drop.packet.destination,c.address)&&s.events.some(e=>e.nodeId===d.id&&e.label==='Frame sent'&&e.packet?.id===drop.packet!.id)&&s.events.some(e=>e.nodeId===edge.id&&e.port===selected.port&&e.label==='Frame sent'&&e.packet?.id===drop.packet!.id)&&s.events.some(e=>e.nodeId===abr.id&&e.label==='Frame received'&&e.packet?.id===drop.packet!.id)&&s.events.some(reply=>reply.time>=drop.time&&reply.nodeId===d.id&&reply.label==='ICMP error received'&&reply.packet?.parentId===drop.packet!.id&&reply.packet.icmpType===3&&sameAddress(reply.packet.icmpQuoted?.source??'',from)&&sameAddress(reply.packet.icmpQuoted?.destination??'',c.address)));
}
