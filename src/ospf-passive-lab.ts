import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,sameAddress} from './ip.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {matchesOSPFP2PCriterion} from './ospf-p2p-lab.ts';
export type OSPFPassiveCriterion=
 | {kind:'opi-policy';device:string;lan:string;transits:string[]}
 | {kind:'opi-quiet';device:string;lan:string;transits:string[];observer:string;network:string;prefix:number}
 | {kind:'opi-incident';device:string;interface:string;peer:string;network:string;localNetwork:string;source:string;target:string;address:string;localTarget:string;localAddress:string;localPath:string[]};
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const unique=(v:any,min:number,max:number)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(name)&&new Set(v).size===v.length;
const ipv4=(v:unknown)=>typeof v==='string'&&isIPv4(v);
export function validOSPFPassiveCriterion(c:any):boolean{
 if(!c||!name(c.device))return false;
 if(c.kind==='opi-policy'||c.kind==='opi-quiet')return name(c.lan)&&unique(c.transits,1,4)&&!c.transits.includes(c.lan)&&(c.kind!=='opi-quiet'||name(c.observer)&&c.observer!==c.device&&ipv4(c.network)&&Number.isInteger(c.prefix)&&c.prefix>=0&&c.prefix<=32);
 return c.kind==='opi-incident'&&[c.interface,c.peer,c.source,c.target,c.localTarget].every(name)&&[c.network,c.localNetwork,c.address,c.localAddress].every(ipv4)&&new Set([c.device,c.peer,c.source,c.target,c.localTarget]).size===5&&unique(c.localPath,2,6)&&c.localPath.includes(c.device)&&![c.peer,c.source,c.target,c.localTarget].some(v=>c.localPath.includes(v))&&c.network!==c.localNetwork;
}
export function matchesOSPFPassiveCriterion(s:Simulator,d:Device,c:OSPFPassiveCriterion):boolean{
 const live=ospfLiveDetail(s,d.id,'ospf'),cfg=d.config.protocols.ospf;if(!s.devicePowered(d.id)||!live||!cfg)return false;
 if(c.kind==='opi-policy'){
  const active:string[]=cfg.activeInterfaces??[];return (cfg.passiveInterfaces??[]).includes('default')&&active.length===c.transits.length&&c.transits.every(n=>active.includes(n)&&live.interfaces.some(p=>p.name===n&&!p.passive)&&s.interfaceUp(d.id,n))&&live.interfaces.some(p=>p.name===c.lan&&p.passive)&&!active.includes(c.lan);
 }
 if(c.kind==='opi-quiet'){
  if(!live.interfaces.some(p=>p.name===c.lan&&p.passive)||live.helloDue[c.lan]!==undefined||!s.interfaceUp(d.id,c.lan))return false;
  const peer=live.neighbors.find(n=>n.state==='FULL'&&c.transits.includes(n.interface)&&n.lastHello>=(live.started??Infinity)+10000);if(!peer)return false;
  const since=peer.lastHello-10000;
  if(s.events.some(e=>e.time>=since&&e.nodeId===d.id&&e.port===c.lan&&e.label==='Frame sent'&&e.packet?.protocol==='OSPF'))return false;
  if(!s.events.some(e=>e.time>=since&&e.nodeId===d.id&&c.transits.includes(e.port??'')&&e.label==='Frame sent'&&e.packet?.protocol==='OSPF'))return false;
  return !!ospfLiveDetail(s,c.observer,'ospf')?.lsas.find(l=>l.routerId===cfg.routerId)?.prefixes.some(p=>p.kind==='prefix'&&p.endpoint.deviceId===d.id&&p.endpoint.name===c.lan&&sameAddress(p.network,c.network)&&p.prefix===c.prefix);
 }
 if(d.config.interfaces[c.interface]?.adminUp!==true||!s.interfaceUp(d.id,c.interface)||!live.interfaces.some(p=>p.name===c.interface&&p.passive)||live.neighbors.some(n=>n.interface===c.interface&&n.state==='FULL')||d.runtime.routes.some(r=>sameAddress(r.network,c.network)&&r.prefix===24)||!d.runtime.routes.some(r=>sameAddress(r.network,c.localNetwork)&&r.prefix===24&&r.protocol==='O'))return false;
 const transition=s.events.filter(e=>e.nodeId===d.id&&e.port===c.interface&&e.peerId===c.peer&&e.protocol==='OSPF'&&e.label==='OSPF neighbor DOWN'&&e.detail.includes(': FULL → DOWN.')&&e.detail.includes('Local interface or protocol configuration changed')).at(-1);if(!transition)return false;
 if((d.runtime.features.logEntries??[]).some((e:any)=>e.time>=transition.time&&e.message.startsWith('%LINK-3-UPDOWN: Interface '+c.interface+',')))return false;
 const source=s.getDevice(c.source),target=s.getDevice(c.target),from=source?.config.interfaces.GigabitEthernet0?.ip;if(!source||!target||!from||!s.devicePowered(target.id)||!sameAddress(target.config.interfaces.GigabitEthernet0?.ip??'',c.address))return false;
 const failed=s.events.some(e=>e.time>=transition.time&&c.localPath.includes(e.nodeId)&&e.label==='No route'&&e.disposition==='drop'&&e.packet?.protocol==='ICMP'&&e.packet.ipVersion===4&&e.packet.messageType==='echo-request'&&sameAddress(e.packet.source,from)&&sameAddress(e.packet.destination,c.address)&&s.events.some(sent=>sent.time>=transition.time&&sent.nodeId===source.id&&sent.label==='Frame sent'&&sent.packet?.id===e.packet!.id)&&s.events.some(reply=>reply.time>=e.time&&reply.nodeId===source.id&&reply.label==='ICMP error received'&&reply.packet?.parentId===e.packet!.id&&reply.packet.icmpType===3&&reply.packet.icmpCode===0&&sameAddress(reply.packet.icmpQuoted?.source??'',from)&&sameAddress(reply.packet.icmpQuoted?.destination??'',c.address)));
 return failed&&matchesOSPFP2PCriterion(s,source,{kind:'op2p-echo',device:source.id,target:c.localTarget,address:c.localAddress,path:c.localPath},transition.time);
}
