import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,networkAddress,sameAddress} from './ip.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {prefixListPermits} from './control-plane.ts';
type Spec={abr:string;list:string;area:number;allowedNetwork:string;deniedNetwork:string;prefix:number};
export type OSPFFilterCriterion=Spec&(
 | {kind:'ofl-policy';device:string;routers:string[]}
 | {kind:'ofl-remote';device:string}
 | {kind:'ofl-drop';device:string;target:string;at:string;path:string[];mode:'request'|'reply'});
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const unique=(v:any,min:number,max:number)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(name)&&new Set(v).size===v.length;
export function validOSPFFilterCriterion(c:any):boolean{
 if(!c||![c.device,c.abr,c.list].every(name)||!Number.isInteger(c.area)||c.area<0||c.area>4294967295||!Number.isInteger(c.prefix)||c.prefix<0||c.prefix>32||![c.allowedNetwork,c.deniedNetwork].every(v=>typeof v==='string'&&isIPv4(v)&&networkAddress(v,c.prefix)===v)||c.allowedNetwork===c.deniedNetwork)return false;
 if(c.kind==='ofl-policy')return c.device===c.abr&&unique(c.routers,2,6)&&c.routers.includes(c.abr);
 if(c.kind==='ofl-remote')return c.device!==c.abr;
 return c.kind==='ofl-drop'&&[c.target,c.at].every(name)&&unique(c.path,1,6)&&c.path.at(-1)===c.at&&![c.device,c.target].some(v=>c.path.includes(v))&&new Set([c.device,c.target,c.at,c.abr]).size===4&&['request','reply'].includes(c.mode);
}
function received(s:Simulator,observer:Device,c:Spec):boolean{
 const live=ospfLiveDetail(s,observer.id,'ospf');if(!live?.neighbors.some(n=>n.state==='FULL'))return false;
 return live.lsas.some(l=>[...l.links.map(k=>k.from),...l.prefixes.map(p=>p.endpoint)].some(p=>{
  const config=p.snapshot?.deviceConfig;if(p.deviceId!==c.abr||!config)return false;
  const area=Object.entries<any>(config.protocols?.ospf?.areas??{}).find(([a])=>(isIPv4(a)?Number(a.split('.').reduce((n,v)=>n*256+Number(v),0)):Number(a))===c.area)?.[1];
  if(area?.filterOut!==c.list||!config.features?.prefixLists?.[c.list]?.length)return false;
  const d={config} as Device;return prefixListPermits(d,c.list,{network:c.allowedNetwork,prefix:c.prefix})&&!prefixListPermits(d,c.list,{network:c.deniedNetwork,prefix:c.prefix});
 }));
}
function remote(s:Simulator,d:Device,c:Spec):boolean{
 const allowed=s.cefLookup(d.id,c.allowedNetwork)?.route;
 return s.devicePowered(d.id)&&allowed?.protocol==='O IA'&&allowed.ad===110&&allowed.network===c.allowedNetwork&&allowed.prefix===c.prefix&&!s.cefLookup(d.id,c.deniedNetwork)&&received(s,d,c);
}
export function matchesOSPFFilterCriterion(s:Simulator,d:Device,c:OSPFFilterCriterion):boolean{
 if(!s.devicePowered(d.id))return false;
 if(c.kind==='ofl-policy'){
  const routers=c.routers.map(id=>s.getDevice(id));if(routers.some(r=>!r||!s.devicePowered(r.id)))return false;
  const bindings:any[]=[];for(const r of routers as Device[]){const cfg=r.config.protocols.ospf;if(!cfg||(cfg.distributeLists??[]).length)return false;for(const[a,v]of Object.entries<any>(cfg.areas??{}))for(const field of ['filterIn','filterOut'])if(v[field])bindings.push({device:r.id,area:isIPv4(a)?a.split('.').reduce((n,v)=>n*256+Number(v),0):Number(a),field,list:v[field]});}
  const entries=d.config.features.prefixLists?.[c.list];
  return bindings.length===1&&bindings[0].device===c.abr&&bindings[0].area===c.area&&bindings[0].field==='filterOut'&&bindings[0].list===c.list&&Array.isArray(entries)&&entries.length===2&&entries[0].sequence===5&&entries[0].action==='deny'&&entries[0].network===c.deniedNetwork&&entries[0].prefix===c.prefix&&entries[0].ge===undefined&&entries[0].le===undefined&&entries[1].sequence===10&&entries[1].action==='permit'&&entries[1].network==='0.0.0.0'&&entries[1].prefix===0&&entries[1].ge===undefined&&entries[1].le===32;
 }
 if(c.kind==='ofl-remote')return remote(s,d,c);
 const at=s.getDevice(c.at),target=s.getDevice(c.target),from=d.config.interfaces.GigabitEthernet0?.ip,to=target?.config.interfaces.GigabitEthernet0?.ip;
 if(!at||!target||!from||!to||!s.devicePowered(target.id)||!remote(s,at,c))return false;
 if(networkAddress(c.mode==='request'?to:from,c.prefix)!==c.deniedNetwork)return false;
 const since=ospfLiveDetail(s,at.id,'ospf')?.lastSpf??Infinity;
 const frames=(packetId:string,path:string[],destination:string)=>{let time=since;for(let i=0;i<path.length;i++){const router=s.getDevice(path[i]),next=s.getDevice(path[i+1]??target.id);if(!router||!next)return false;const lookup=s.cefLookup(router.id,destination),link=lookup&&s.linkAt(router.id,lookup.port);if(!lookup||!['connected','O','O IA'].includes(lookup.route.protocol)||!link?.enabled||![link.a.deviceId,link.b.deviceId].includes(next.id))return false;const sent=s.events.find(e=>e.time>=time&&e.nodeId===router.id&&e.port===lookup.port&&e.label==='Frame sent'&&e.packet?.id===packetId);if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===next.id&&e.label==='Frame received'&&e.packet?.id===packetId))return false;time=sent.time;}return true;};
 return s.events.some(drop=>{
  const p=drop.packet;if(drop.time<since||drop.nodeId!==c.at||drop.label!=='No route'||drop.disposition!=='drop'||p?.protocol!=='ICMP'||p.ipVersion!==4||p.messageType!==(c.mode==='request'?'echo-request':'echo-reply')||!sameAddress(p.source,c.mode==='request'?from:to)||!sameAddress(p.destination,c.mode==='request'?to:from))return false;
  const sourceId=c.mode==='request'?d.id:target.id;
  if(!s.events.some(e=>e.time>=since&&e.nodeId===sourceId&&e.label==='Frame sent'&&e.packet?.id===p.id)||!s.events.some(e=>e.nodeId===c.at&&e.label==='Frame received'&&e.packet?.id===p.id))return false;
  if(c.mode==='reply'&&!s.events.some(e=>e.time>=since&&e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet!==undefined&&e.packet.id===p.parentId&&e.packet.protocol==='ICMP'&&sameAddress(e.packet.source,from)&&sameAddress(e.packet.destination,to)&&s.events.some(sent=>sent.nodeId===d.id&&sent.label==='Frame sent'&&sent.packet?.id===e.packet!.id)&&frames(e.packet!.id,c.path,to)))return false;
  return s.events.some(e=>e.time>=drop.time&&e.nodeId===sourceId&&e.label==='ICMP error received'&&e.packet?.parentId===p.id&&e.packet.icmpType===3&&e.packet.icmpCode===0&&sameAddress(e.packet.icmpQuoted?.source??'',p.source)&&sameAddress(e.packet.icmpQuoted?.destination??'',p.destination));
 });
}
