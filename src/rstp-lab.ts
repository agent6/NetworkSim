import {stpRegion} from './stp-ports.ts';
import type {Simulator} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import {isIPv4} from './ip.ts';

type Segment={aDevice:string;aPort:string;bDevice:string;bPort:string};
export type RSTPCriterion=
 | {kind:'rstp-saved';device:string;interfaces:string[];vlans:number[]}
 | {kind:'rstp-edge';device:string;interface:string;vlan:number;protocol?:"rapid-pvst"|"mst"}
 | {kind:'rstp-echo';protocol?:'rapid-pvst'|'mst';device:string;target:string;address:string;vlan:number;root:string;bridges:string[];path:Segment[];failed?:{device:string;interface:string;survivor:string}};
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const vlan=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=1&&Number(v)<=4094;
const list=(v:any,max:number,item:(x:any)=>boolean)=>Array.isArray(v)&&v.length>0&&v.length<=max&&v.every(item)&&new Set(v).size===v.length;
export function validRSTPCriterion(c:any):boolean{
 if(!name(c.device)||c.protocol!==undefined&&!["rapid-pvst","mst"].includes(c.protocol))return false;
 if(c.kind==='rstp-saved')return list(c.interfaces,32,name)&&list(c.vlans,64,vlan);
 if(!vlan(c.vlan))return false;
 if(c.kind==='rstp-edge')return name(c.interface);
 return c.kind==='rstp-echo'&&name(c.target)&&name(c.root)&&list(c.bridges,8,name)&&c.bridges.includes(c.root)&&typeof c.address==='string'&&isIPv4(c.address)&&Array.isArray(c.path)&&c.path.length>0&&c.path.length<=4&&c.path.every((p:any)=>p&&['aDevice','aPort','bDevice','bPort'].every(k=>name(p[k]))&&c.bridges.includes(p.aDevice)&&c.bridges.includes(p.bDevice)&&p.aDevice!==p.bDevice)&&(c.failed===undefined||c.failed&&name(c.failed.device)&&c.bridges.includes(c.failed.device)&&name(c.failed.interface)&&name(c.failed.survivor)&&c.failed.interface!==c.failed.survivor);
}
function projection(c:DeviceConfig,interfaces:string[],vlans:number[]):string|undefined{
 if(interfaces.some(p=>!Object.hasOwn(c.interfaces,p))||vlans.some(v=>!Object.hasOwn(c.vlans,v)))return;
 return JSON.stringify([c.features.stp,c.features.errdisable?.detect?.bpduguard!==false,(c.features.errdisable?.causes??[]).some((cause:string)=>cause==='all'||cause==='bpduguard'),c.features.errdisable?.interval??300,interfaces.map(p=>{const i=c.interfaces[p];return[i.adminUp,i.switchport,i.mode,i.vlan,i.nativeVlan,i.allowedVlans===null?null:[...i.allowedVlans].sort((a,b)=>a-b),i.speed,i.duplex,i.features.speedAuto,!!i.features.portfast,!!i.features.nonegotiate,!!i.features.rootGuard,!!i.features.loopGuard,i.features.bpduguard??null,i.features.bpdufilter,i.features.stpLinkType];}),vlans.map(v=>c.vlans[v].active)]);
}
export function matchesRSTPCriterion(s:Simulator,d:Device,c:RSTPCriterion):boolean{
 const protocol='protocol' in c?c.protocol??'rapid-pvst':'rapid-pvst';
 if(c.kind==='rstp-saved'){const current=projection(d.config,c.interfaces,c.vlans);return !!d.startupConfig&&current!==undefined&&current===projection(d.startupConfig,c.interfaces,c.vlans);}
 if(c.kind==='rstp-edge'){const p=d.config.interfaces[c.interface],state=d.runtime.stp[c.vlan]?.ports[c.interface];return d.config.features.stp?.mode===protocol&&!!p?.switchport&&p.mode==='access'&&p.vlan===c.vlan&&p.features.portfast===true&&s.interfaceUp(d.id,c.interface)&&state?.edge===true&&state.state==='forwarding';}
 const target=s.getDevice(c.target),bridges=c.bridges.map(id=>s.getDevice(id));if(!target||bridges.some(b=>!b||!s.devicePowered(b.id)||b.config.features.stp?.mode!==protocol||b.runtime.stp[c.vlan]?.rootId!==c.root))return false;
 if(protocol==='mst'&&bridges.some(b=>stpRegion(b!)!==stpRegion(bridges[0]!)||b!.runtime.stp[c.vlan]?.boundary))return false;
 let floor=-1;
 if(c.failed){const b=s.getDevice(c.failed.device),p=b?.runtime.stp[c.vlan]?.ports[c.failed.survivor];if(!b||b.config.interfaces[c.failed.interface]?.adminUp!==false||!s.interfaceUp(b.id,c.failed.survivor)||p?.role!=='root'||p.state!=='forwarding')return false;floor=(b.runtime.features.logEntries??[]).reduce((at:number,e:any)=>e.message===`%LINK-3-UPDOWN: Interface ${c.failed!.interface}, changed state to down`?Math.max(at,e.time):at,-1);if(floor<0)return false;}
 const bpduBefore=(bridge:Device,port:string,time:number)=>{
  const latest=s.events.filter(e=>e.nodeId===bridge.id&&e.port===port&&e.label==='Frame received'&&e.protocol==='STP'&&e.time<=time&&e.packet?.stpBpdus?.some(b=>b.vlan===c.vlan)).at(-1);
  return latest?.packet?.stpBpdus?.some(b=>b.vlan===c.vlan&&b.mode===protocol&&b.version===(protocol==='mst'?3:2)&&b.rootBridgeId===bridge.runtime.stp[c.vlan]?.rootBridgeId&&(protocol!=='mst'||b.region===stpRegion(bridge)&&b.instance===(bridge.config.features.stp?.mst?.instances?.find((i:any)=>i.vlans.includes(c.vlan))?.id??0)))??false;
 };
 const leg=(packetId:string,reverse:boolean)=>c.path.every(p=>{
  const a=s.getDevice(reverse?p.bDevice:p.aDevice),b=s.getDevice(reverse?p.aDevice:p.bDevice),ap=reverse?p.bPort:p.aPort,bp=reverse?p.aPort:p.bPort;if(!a||!b)return false;
  for(const[sw,port]of [[a,ap],[b,bp]] as const){const state=sw.runtime.stp[c.vlan]?.ports[port];if(!s.interfaceUp(sw.id,port)||state?.state!=='forwarding'||state.linkType!=='point-to-point'||state.edge||sw.runtime.features.stpLegacy?.[port])return false;}
  if(!s.lab.links.some(l=>l.enabled&&((l.a.deviceId===a.id&&l.a.port===ap&&l.b.deviceId===b.id&&l.b.port===bp)||(l.b.deviceId===a.id&&l.b.port===ap&&l.a.deviceId===b.id&&l.a.port===bp))))return false;
  return s.events.some(sent=>sent.nodeId===a.id&&sent.port===ap&&sent.label==='Frame sent'&&sent.time>floor&&sent.packet?.id===packetId&&sent.packet.vlan===c.vlan&&bpduBefore(a,ap,sent.time)&&s.events.some(received=>received.nodeId===b.id&&received.port===bp&&received.label==='Frame received'&&received.packet?.id===packetId&&received.packet.vlan===c.vlan&&bpduBefore(b,bp,received.time)));
 });
 return s.events.some(request=>request.nodeId===target.id&&request.label==='Echo request accepted'&&request.time>floor&&request.packet?.destination===c.address&&leg(request.packet.id,false)&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===request.packet!.id&&reply.packet.source===c.address&&leg(reply.packet.id,true)));
}
