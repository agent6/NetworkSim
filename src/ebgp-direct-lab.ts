import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,networkAddress,sameAddress} from './ip.ts';
type Peer={device:string;peer:string;asn:number;remoteAs:number;routerId:string;localAddress:string;peerAddress:string;interface:string};
type Prefix={network:string;prefix:number};
export type EBGPDirectCriterion=
 | {kind:'ed-local';device:string;asn:number;routerId:string}
 | ({kind:'ed-neighbor'|'ed-session'}&Peer)
 | ({kind:'ed-origin';device:string}&Prefix)
 | ({kind:'ed-path'|'ed-advertised'}&Peer&Prefix)
 | {kind:'ed-saved';device:string}
 | {kind:'ed-echo';device:string;target:string;address:string;path:string[]};
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const asn=(v:unknown)=>Number.isInteger(v)&&Number(v)>=1&&Number(v)<=4294967295;
const ip=(v:unknown):v is string=>typeof v==='string'&&isIPv4(v);
const prefix=(c:any)=>ip(c.network)&&Number.isInteger(c.prefix)&&c.prefix>=0&&c.prefix<=32&&networkAddress(c.network,c.prefix)===c.network;
export function validEBGPDirectCriterion(c:any):boolean{
 if(!c||!name(c.device))return false;
 if(c.kind==='ed-saved')return true;
 if(c.kind==='ed-local')return asn(c.asn)&&ip(c.routerId);
 if(c.kind==='ed-origin')return prefix(c);
 if(c.kind==='ed-echo')return name(c.target)&&c.target!==c.device&&ip(c.address)&&Array.isArray(c.path)&&c.path.length>=2&&c.path.length<=6&&c.path.every(name)&&new Set(c.path).size===c.path.length&&!c.path.includes(c.device)&&!c.path.includes(c.target);
 return ['ed-neighbor','ed-session','ed-path','ed-advertised'].includes(c.kind)&&name(c.peer)&&c.peer!==c.device&&asn(c.asn)&&asn(c.remoteAs)&&c.asn!==c.remoteAs&&ip(c.routerId)&&ip(c.localAddress)&&ip(c.peerAddress)&&c.localAddress!==c.peerAddress&&name(c.interface)&&(!['ed-path','ed-advertised'].includes(c.kind)||prefix(c));
}
const session=(d:Device,address?:string)=>(d.runtime.features.bgpSessions??[]).find((p:any)=>!p.vrf&&p.family===4&&(!address||p.neighbor===address));
function basic(d:Device):boolean{
 const p=d.config.protocols.bgp;
 return !!p&&d.config.ipRouting&&Object.keys(d.config.protocols).every(k=>k==='bgp')&&!d.config.staticRoutes.length&&!(p.redistribute??[]).length&&!(p.aggregates??[]).length&&p.defaultIPv4Unicast!==false;
}
export function matchesEBGPDirectCriterion(s:Simulator,d:Device,c:EBGPDirectCriterion):boolean{
 if(!s.devicePowered(d.id))return false;
 const cfg=d.config.protocols.bgp;
 if(c.kind==='ed-saved')return !!d.startupConfig&&JSON.stringify(d.config)===JSON.stringify(d.startupConfig);
 if(c.kind==='ed-local')return basic(d)&&cfg.asn===c.asn&&cfg.routerId===c.routerId;
 if(c.kind==='ed-origin')return !!cfg&&(cfg.networks??[]).length===1&&cfg.networks[0].network===c.network&&cfg.networks[0].prefix===c.prefix&&d.runtime.routes.some(r=>r.protocol==='connected'&&r.network===c.network&&r.prefix===c.prefix)&&(d.runtime.features.bgpTable??[]).some((p:any)=>p.network===c.network&&p.prefix===c.prefix&&!p.learnedVia&&p.nextHop==='0.0.0.0'&&p.originCode==='i'&&p.weight===32768&&p.best&&p.asPath?.length===0);
 if(c.kind==='ed-echo'){
  const target=s.getDevice(c.target),from=d.config.interfaces.GigabitEthernet0?.ip,to=target?.config.interfaces.GigabitEthernet0?.ip,path=c.path.map(id=>s.getDevice(id));if(!target||!from||!to||!sameAddress(to,c.address)||!s.devicePowered(target.id)||path.some(r=>!r||r.kind!=='router'||!s.devicePowered(r.id)||session(r)?.state!=='ESTABLISHED'))return false;
  const since=Math.max(...path.map(r=>session(r!)?.establishedAt??Infinity));
  const leg=(packetId:string,address:string,routers:Device[],end:Device)=>{let time=since;for(let i=0;i<routers.length;i++){const r=routers[i],next=routers[i+1]??end,lookup=s.cefLookup(r.id,address),wire=lookup&&s.linkAt(r.id,lookup.port);if(!lookup||!['connected','B'].includes(lookup.route.protocol)||lookup.route.protocol==='B'&&lookup.route.ad!==20||!wire?.enabled||![wire.a.deviceId,wire.b.deviceId].includes(next.id))return false;const sent=s.events.find(e=>e.time>=time&&e.nodeId===r.id&&e.port===lookup.port&&e.label==='Frame sent'&&e.packet?.id===packetId&&e.packet.protocol==='ICMP'&&e.packet.ipVersion===4&&sameAddress(e.packet.destination,address));if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===next.id&&e.label==='Frame received'&&e.packet?.id===packetId))return false;time=sent.time;}return true;};
  return s.events.some(e=>e.time>=since&&e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet?.protocol==='ICMP'&&e.packet.ipVersion===4&&sameAddress(e.packet.source,from)&&sameAddress(e.packet.destination,c.address)&&s.events.some(sent=>sent.time>=since&&sent.nodeId===d.id&&sent.label==='Frame sent'&&sent.packet?.id===e.packet!.id)&&leg(e.packet.id,c.address,path as Device[],target)&&s.events.some(reply=>reply.time>=e.time&&reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet!.id&&sameAddress(reply.packet.source,c.address)&&sameAddress(reply.packet.destination,from)&&leg(reply.packet.id,from,[...path].reverse() as Device[],d)));
 }
 const peer=s.getDevice(c.peer),n=cfg?.neighbors?.find((n:any)=>n.address===c.peerAddress),port=d.config.interfaces[c.interface],link=s.linkAt(d.id,c.interface);
 if(!peer||!s.devicePowered(peer.id)||!port||port.ip!==c.localAddress||!s.interfaceUp(d.id,c.interface)||!link?.enabled||![link.a.deviceId,link.b.deviceId].includes(c.peer)||!Object.values(peer.config.interfaces).some(p=>p.ip===c.peerAddress)||!n)return false;
 if(c.kind==='ed-neighbor')return basic(d)&&cfg.asn===c.asn&&cfg.routerId===c.routerId&&cfg.neighbors.length===1&&n.remoteAs===c.remoteAs&&!n.shutdown&&n.activated!==false&&!n.updateSource&&(n.ebgpMultihop??1)===1&&!n.ttlSecurityHops&&!n.routeMapIn&&!n.routeMapOut&&!n.prefixListIn&&!n.prefixListOut&&!n.defaultOriginate;
 const live=session(d,c.peerAddress);
 if(!live||live.state!=='ESTABLISHED'||!live.channelId||!live.negotiatedFamilies?.includes(4)||live.negotiatedHold!==180||!(live.stats?.received?.OPEN>0)||!(live.stats?.received?.KEEPALIVE>0)||live.transport?.localAddress!==c.localAddress||![live.transport?.localPort,live.transport?.peerPort].includes(179))return false;
 if(c.kind==='ed-session')return true;
 if(c.kind==='ed-path')return live.stats?.received?.UPDATE>0&&(d.runtime.features.bgpTable??[]).some((p:any)=>p.network===c.network&&p.prefix===c.prefix&&p.best&&p.learnedVia==='ebgp'&&p.nextHop===c.peerAddress&&p.asPath?.length===1&&p.asPath[0]===c.remoteAs&&p.originCode==='i'&&p.localPreference===100&&p.weight===0&&(p.med??0)===0);
 if(c.kind==='ed-advertised')return live.stats?.sent?.UPDATE>0&&(d.runtime.features.bgpAdjRibOut?.[c.peerAddress]??[]).some((p:any)=>p.network===c.network&&p.prefix===c.prefix&&p.asPath?.length===1&&p.asPath[0]===c.asn&&p.nextHop===c.localAddress&&p.originCode==='i');
 return false;
}
