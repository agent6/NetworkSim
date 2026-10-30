import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,sameAddress} from './ip.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
type Traffic={target:string;address:string;routers:string[];bridge:string};
export type OSPFBroadcastCriterion=
 | {kind:'obc-network';device:string;dr:string;interface:string;members:string[]}
 | {kind:'obc-nonpreempt';device:string;peer:string;interface:string;incumbentPriority:number;priority:number}
 | ({kind:'obc-echo';device:string}&Traffic)
 | ({kind:'obc-promote';device:string;peer:string;interface:string;source:string}&Traffic);
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const list=(v:any,min:number,max:number)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(name)&&new Set(v).size===v.length;
export function validOSPFBroadcastCriterion(c:any):boolean{
 if(!c||!name(c.device))return false;
 if(c.kind==='obc-network')return name(c.dr)&&name(c.interface)&&list(c.members,2,8)&&c.members.includes(c.device)&&c.members.includes(c.dr);
 if(c.kind==='obc-nonpreempt')return name(c.peer)&&c.peer!==c.device&&name(c.interface)&&Number.isInteger(c.incumbentPriority)&&c.incumbentPriority>=1&&Number.isInteger(c.priority)&&c.priority>c.incumbentPriority&&c.priority<=255;
 if(!name(c.target)||!name(c.bridge)||!isIPv4(typeof c.address==='string'?c.address:'')||!list(c.routers,2,2)||c.routers.includes(c.target)||c.routers.includes(c.bridge)||c.target===c.bridge)return false;
 if(c.kind==='obc-echo')return c.device!==c.target&&c.device!==c.bridge&&!c.routers.includes(c.device);
 return c.kind==='obc-promote'&&name(c.source)&&name(c.peer)&&name(c.interface)&&c.source!==c.target&&c.source!==c.device&&c.peer!==c.device&&c.bridge!==c.source&&![c.device,c.peer,c.source].some(v=>c.routers.includes(v))&&c.target!==c.device&&c.target!==c.peer&&new Set([c.device,c.peer,c.source,c.target,c.bridge,...c.routers]).size===7;
}
const state=(s:Simulator,id:string,port:string)=>s.getDevice(id)?.runtime.features.ospfInterfaces?.[port];
/** The existing received logical LSDB supports the simulator's Type-2 display projection. */
function network(s:Simulator,observer:string,dr:string,port:string,members:string[]):boolean{
 const owner=s.getDevice(dr),view=ospfLiveDetail(s,observer,'ospf'),drView=ospfLiveDetail(s,dr,'ospf');if(!owner||!view||!drView||state(s,dr,port)?.role!=='DR'||state(s,observer,port)?.drDeviceId!==dr)return false;
 const ids=members.map(id=>s.getDevice(id)?.config.protocols.ospf?.routerId);if(ids.some(v=>!v))return false;
 const iface=view.interfaces.find(p=>p.name===port);if(!iface||iface.networkType!=='broadcast'||iface.passive||!s.interfaceUp(observer,port))return false;
 if(!ids.every(rid=>view.lsas.some(l=>l.routerId===rid)))return false;
 const lsa=view.lsas.find(l=>l.routerId===owner.config.protocols.ospf?.routerId);if(!lsa)return false;
 const attached=new Set(lsa.links.filter(k=>k.from.deviceId===dr&&k.from.name===port&&k.from.snapshot?.interfaceConfig?.features?.ospf?.networkType==='broadcast').map(k=>k.to.deviceId)),expected=members.filter(id=>id!==dr);
 return attached.size===expected.length&&expected.every(id=>attached.has(id)&&drView.neighbors.some(n=>n.deviceId===id&&n.interface===port&&n.state==='FULL'));
}
function echo(s:Simulator,source:Device,c:Traffic,since=0):boolean{
 const target=s.getDevice(c.target),routers=c.routers.map(id=>s.getDevice(id)),bridge=s.getDevice(c.bridge),ip=(d:Device)=>d.config.interfaces.GigabitEthernet0?.ip,from=ip(source);
 if(!target||!bridge||!['switch','l3switch','poeswitch'].includes(bridge.kind)||routers.some(d=>!d||d.kind!=='router')||!from||!sameAddress(ip(target)??'',c.address)||![source,target,bridge,...routers as Device[]].every(d=>s.devicePowered(d.id)))return false;
 const [left,right]=routers as Device[];
 // Both edge routers must select each other as the OSPF next hop across the shared switch.
 for(const[a,b,dest]of [[left,right,c.address],[right,left,from]] as const){const r=s.cefLookup(a.id,dest);if(r?.route.protocol!=='O'||r.route.ad!==110||r.port!=='GigabitEthernet0/1'||!r.route.nextHop||!sameAddress(r.route.nextHop,b.config.interfaces['GigabitEthernet0/1']?.ip??''))return false;}
 const leg=(packetId:string,dest:string,nodes:Device[])=>{
  let time=since;
  for(let i=0;i<nodes.length-1;i++){
   const a=nodes[i],b=nodes[i+1],wire=s.lab.links.find(l=>l.enabled&&((l.a.deviceId===a.id&&l.b.deviceId===b.id)||(l.b.deviceId===a.id&&l.a.deviceId===b.id)));if(!wire)return false;
   const port=wire.a.deviceId===a.id?wire.a.port:wire.b.port,peerPort=wire.a.deviceId===b.id?wire.a.port:wire.b.port;
   if(a.kind==='router'&&s.cefLookup(a.id,dest)?.port!==port)return false;
   const sent=s.events.find(e=>e.time>=time&&e.nodeId===a.id&&e.port===port&&e.label==='Frame sent'&&e.packet?.id===packetId&&e.packet.protocol==='ICMP'&&e.packet.ipVersion===4&&sameAddress(e.packet.destination,dest));
   if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===b.id&&e.port===peerPort&&e.label==='Frame received'&&e.packet?.id===packetId))return false;time=sent.time;
  }
  return !s.events.some(e=>e.time>=since&&e.label==='Frame sent'&&e.packet?.id===packetId&&s.getDevice(e.nodeId??'')?.kind==='router'&&e.nodeId!==left.id&&e.nodeId!==right.id);
 };
 return s.events.some(e=>e.time>=since&&e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet?.protocol==='ICMP'&&e.packet.ipVersion===4&&sameAddress(e.packet.source,from)&&sameAddress(e.packet.destination,c.address)&&leg(e.packet.id,c.address,[source,left,bridge,right,target])&&s.events.some(r=>r.time>=e.time&&r.nodeId===source.id&&r.label==='Echo reply received'&&r.disposition==='success'&&r.packet?.parentId===e.packet!.id&&sameAddress(r.packet.source,c.address)&&sameAddress(r.packet.destination,from)&&leg(r.packet.id,from,[target,right,bridge,left,source])));
}
export function matchesOSPFBroadcastCriterion(s:Simulator,d:Device,c:OSPFBroadcastCriterion):boolean{
 if(c.kind==='obc-network')return network(s,d.id,c.dr,c.interface,c.members);
 if(c.kind==='obc-nonpreempt'){
  const peer=s.getDevice(c.peer),live=ospfLiveDetail(s,d.id,'ospf');return !!peer&&s.devicePowered(d.id)&&s.devicePowered(peer.id)&&d.config.interfaces[c.interface]?.features.ospf?.priority===c.incumbentPriority&&peer.config.interfaces[c.interface]?.features.ospf?.priority===c.priority&&state(s,d.id,c.interface)?.role==='DR'&&state(s,peer.id,c.interface)?.role==='BDR'&&state(s,peer.id,c.interface)?.drDeviceId===d.id&&!!live?.neighbors.some(n=>n.interface===c.interface&&n.deviceId===peer.id&&n.state==='FULL'&&n.priority===c.priority);
 }
 if(c.kind==='obc-echo')return echo(s,d,c);
 const source=s.getDevice(c.source),peer=s.getDevice(c.peer);if(!source||!peer||d.config.interfaces[c.interface]?.adminUp!==false||s.interfaceUp(d.id,c.interface)||state(s,peer.id,c.interface)?.role!=='DR'||state(s,peer.id,c.interface)?.bdrDeviceId)return false;
 const since=(d.runtime.features.logEntries??[]).reduce((t:number,e:any)=>e.message===`%LINK-3-UPDOWN: Interface ${c.interface}, changed state to down`?Math.max(t,e.time):t,-1);if(since<0||!s.events.some(e=>e.time>=since&&e.protocol==='OSPF'&&e.label==='OSPF neighbor DOWN'&&e.detail.includes(': FULL → DOWN.')&&((e.nodeId===d.id&&e.peerId===peer.id)||(e.nodeId===peer.id&&e.peerId===d.id))))return false;
 const members=[peer.id,...c.routers];if(!members.every(id=>network(s,id,peer.id,c.interface,members)))return false;
 const from=source.config.interfaces.GigabitEthernet0?.ip;if(!from)return false;
 return echo(s,source,c,since)&&echo(s,s.getDevice(c.target)!,{...c,target:source.id,address:from,routers:[...c.routers].reverse()},since);
}
