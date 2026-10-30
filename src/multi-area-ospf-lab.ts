import type {Simulator} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {isIPv4} from './ip.ts';
export type MultiAreaOSPFCriterion=
 | {kind:'mao-domain';device:string;areas:number[]}
 | {kind:'mao-abr';device:string;areas:number[]}
 | {kind:'mao-saved';device:string;interfaces:string[]}
 | {kind:'mao-outage';device:string;interface:string;peer:string;network:string;localNetwork:string}
 | {kind:'mao-echo';device:string;target:string;address:string;path:string[]};
const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
const list=(v:any,max:number,test:(x:any)=>boolean)=>Array.isArray(v)&&v.length>0&&v.length<=max&&v.every(test)&&new Set(v).size===v.length;
export function validMultiAreaOSPFCriterion(c:any):boolean{
 if(!c||!name(c.device))return false;
 if(c.kind==='mao-domain'||c.kind==='mao-abr')return list(c.areas,8,v=>Number.isInteger(v)&&v>=0&&v<=4294967295)&&(c.kind!=='mao-abr'||c.areas.length>1&&c.areas.includes(0));
 if(c.kind==='mao-saved')return list(c.interfaces,8,name);
 if(c.kind==='mao-outage')return name(c.interface)&&name(c.peer)&&c.peer!==c.device&&[c.network,c.localNetwork].every(v=>typeof v==='string'&&isIPv4(v))&&c.network!==c.localNetwork;
 return c.kind==='mao-echo'&&name(c.target)&&c.target!==c.device&&typeof c.address==='string'&&isIPv4(c.address)&&list(c.path,6,name)&&c.path.length>=2&&!c.path.includes(c.device)&&!c.path.includes(c.target);
}
function saved(c:DeviceConfig,ports:string[]):string|undefined{
 if(ports.some(p=>!c.interfaces[p]))return;
 return JSON.stringify([c.ipRouting,c.protocols.ospf,c.staticRoutes,ports.map(p=>{const i=c.interfaces[p];return[i.adminUp,i.ip,i.mask,i.switchport,i.vrf??'',i.features.ospf];})]);
}
export function matchesMultiAreaOSPFCriterion(s:Simulator,d:Device,c:MultiAreaOSPFCriterion):boolean{
 if(c.kind==='mao-saved'){const current=saved(d.config,c.interfaces);return current!==undefined&&!!d.startupConfig&&current===saved(d.startupConfig,c.interfaces);}
 if(c.kind==='mao-domain'||c.kind==='mao-abr'){
  const live=ospfLiveDetail(s,d.id,'ospf'),cfg=d.config.protocols.ospf;if(!s.devicePowered(d.id)||!cfg||!live)return false;
  const active=live.interfaces.filter(p=>s.interfaceUp(d.id,p.name)),areas=[...new Set(active.map(p=>Number(p.area)))].sort((a,b)=>a-b);
  if(JSON.stringify(areas)!==JSON.stringify([...c.areas].sort((a,b)=>a-b)))return false;
  if(c.kind==='mao-abr')return c.areas.every(area=>live.neighbors.some(n=>n.state==='FULL'&&active.some(p=>p.name===n.interface&&Number(p.area)===area)));
  return d.config.ipRouting&&d.config.staticRoutes.length===0&&Object.keys(d.config.protocols).every(p=>p==='ospf')&&!(cfg.redistribute??[]).length&&!cfg.defaultOriginate&&Object.values<any>(cfg.areas??{}).every(a=>(!a.type||a.type==='normal')&&!a.noSummary&&!(a.ranges??[]).length);
 }
 if(c.kind==='mao-outage'){
  if(d.config.interfaces[c.interface]?.adminUp!==false||!s.getDevice(c.peer)||d.runtime.routes.some(r=>r.network===c.network&&r.prefix===24)||!d.runtime.routes.some(r=>r.network===c.localNetwork&&r.prefix===24&&r.protocol==='O'))return false;
  const floor=(d.runtime.features.logEntries??[]).reduce((time:number,e:any)=>e.message===`%LINK-3-UPDOWN: Interface ${c.interface}, changed state to down`?Math.max(time,e.time):time,-1);
  const relation=(e:any)=>(e.nodeId===d.id&&e.peerId===c.peer)||(e.nodeId===c.peer&&e.peerId===d.id);
  return floor>=0&&s.events.some(e=>relation(e)&&e.label==='OSPF neighbor DOWN'&&e.time>=floor&&e.detail.includes(': FULL → DOWN.'));
 }
 const target=s.getDevice(c.target),source=d.config.interfaces.GigabitEthernet0?.ip;
 if(!target||!source||target.config.interfaces.GigabitEthernet0?.ip!==c.address||!s.devicePowered(d.id)||!s.devicePowered(target.id))return false;
 const routers=c.path.map(id=>s.getDevice(id));if(routers.some(r=>!r||r.kind!=='router'||!s.devicePowered(r.id)))return false;
 const leg=(packetId:string,address:string,path:Device[],requireInterArea=false)=>{
  let at=-Infinity,interArea=false;
  for(let i=0;i<path.length;i++){
   const router=path[i],route=s.cefLookup(router.id,address);if(!route||!['connected','O','O IA'].includes(route.route.protocol))return false;
   interArea||=route.route.protocol==='O IA';
   const next=i+1<path.length?path[i+1]:address===c.address?target:d,link=s.linkAt(router.id,route.port);
   if(!link?.enabled||![link.a.deviceId,link.b.deviceId].includes(next.id))return false;
   const sent=s.events.find(e=>e.time>=at&&e.nodeId===router.id&&e.port===route.port&&e.label==='Frame sent'&&e.packet?.id===packetId&&e.packet.protocol==='ICMP'&&e.packet.destination===address);
   if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===next.id&&e.label==='Frame received'&&e.packet?.id===packetId))return false;at=sent.time;
  }
  return !requireInterArea||interArea;
 };
 return s.events.some(req=>req.nodeId===target.id&&req.label==='Echo request accepted'&&req.packet?.source===source&&req.packet.destination===c.address&&req.packet.protocol==='ICMP'&&leg(req.packet.id,c.address,routers as Device[],true)&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===req.packet!.id&&reply.packet.source===c.address&&reply.packet.destination===source&&leg(reply.packet.id,source,[...routers].reverse() as Device[])));
}
