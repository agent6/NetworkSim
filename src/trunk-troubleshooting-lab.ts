import type {Simulator} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import {isIPv4} from './ip.ts';

type Segment={aDevice:string;aPort:string;bDevice:string;bPort:string};
export type TrunkTroubleshootingCriterion=
 | {kind:'trunk-saved';device:string;interfaces:string[];vlans:number[]}
 | {kind:'trunk-echo';device:string;target:string;address:string;vlan:number;nativeVlan:number;path:Segment[]};
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const vlan=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=1&&Number(v)<=4094;
export function validTrunkTroubleshootingCriterion(c:any):boolean{
 if(!name(c.device))return false;
 if(c.kind==='trunk-saved')return Array.isArray(c.interfaces)&&c.interfaces.length>0&&c.interfaces.length<=32&&c.interfaces.every(name)&&new Set(c.interfaces).size===c.interfaces.length&&Array.isArray(c.vlans)&&c.vlans.length>0&&c.vlans.length<=64&&c.vlans.every(vlan)&&new Set(c.vlans).size===c.vlans.length;
 return c.kind==='trunk-echo'&&name(c.target)&&typeof c.address==='string'&&isIPv4(c.address)&&vlan(c.vlan)&&vlan(c.nativeVlan)&&Array.isArray(c.path)&&c.path.length>0&&c.path.length<=8&&c.path.every((p:any)=>p&&['aDevice','aPort','bDevice','bPort'].every(k=>name(p[k])));
}
function projection(c:DeviceConfig,ports:string[],vlans:number[]):string|undefined{
 if(ports.some(p=>!Object.hasOwn(c.interfaces,p))||vlans.some(v=>!Object.hasOwn(c.vlans,v)))return;
 return JSON.stringify([ports.map(p=>{const i=c.interfaces[p];return [i.adminUp,i.switchport,i.mode,i.vlan,i.nativeVlan,i.allowedVlans===null?null:[...i.allowedVlans].sort((a,b)=>a-b),!!i.features.nonegotiate,!!i.features.portfast];}),vlans.map(v=>c.vlans[v].active)]);
}
export function matchesTrunkTroubleshootingCriterion(s:Simulator,d:Device,c:TrunkTroubleshootingCriterion):boolean{
 if(c.kind==='trunk-saved'){const running=projection(d.config,c.interfaces,c.vlans);return !!d.startupConfig&&running!==undefined&&running===projection(d.startupConfig,c.interfaces,c.vlans);}
 const target=s.lab.devices.find(d=>d.id===c.target);if(!target)return false;
 const tag=c.vlan===c.nativeVlan?undefined:c.vlan;
 const leg=(id:string,reverse:boolean)=>c.path.every(p=>{
  const a=reverse?p.bDevice:p.aDevice,b=reverse?p.aDevice:p.bDevice,ap=reverse?p.bPort:p.aPort,bp=reverse?p.aPort:p.bPort;
  return s.events.some(e=>e.nodeId===a&&e.port===ap&&e.label==='Frame sent'&&e.packet?.id===id&&e.packet.vlan===tag)&&s.events.some(e=>e.nodeId===b&&e.port===bp&&e.label==='Frame received'&&e.packet?.id===id&&e.packet.vlan===tag);
 });
 return s.events.some(request=>request.nodeId===target.id&&request.label==='Echo request accepted'&&request.packet?.destination===c.address&&leg(request.packet.id,false)&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===request.packet!.id&&reply.packet.source===c.address&&leg(reply.packet.id,true)));
}
