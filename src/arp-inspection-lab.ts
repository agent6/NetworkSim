import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4} from './ip.ts';

export type ARPInspectionCriterion=
 | {kind:'dai-vlan';device:string;vlan:number}
 | {kind:'dai-trust';device:string;interface:string}
 | {kind:'dai-rate';device:string;interfaces:string[];rate:number}
 | {kind:'dai-static-acl';device:string;vlan:number;acl:string;source:string;sourceInterface:string;interface:string;address:string}
 | {kind:'dai-frame';device:string;vlan:number;source:string;sourceInterface:string;interface:string;address:string;decision:'acl'|'deny';receiver:string}
 | {kind:'arp-neighbor';device:string;interface:string;address:string;owner:string;ownerInterface:string};
const mac=(s:string)=>s.replace(/[^a-f0-9]/gi,'').toLowerCase();
const exactRule=(r:any,address:string,sourceMac:string)=>r?.action==='permit'&&!r.kind&&r.ip===address&&(!r.ipWild||r.ipWild==='0.0.0.0')&&mac(r.mac)===mac(sourceMac)&&(!r.macWild||mac(r.macWild)==='000000000000');
const find=(sim:Simulator,id:string)=>sim.lab.devices.find(d=>d.id===id||d.config.hostname===id);
export function validARPInspectionCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
 const vlan=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<4095;
 if(c.kind==='dai-vlan')return vlan(c.vlan);
 if(c.kind==='dai-trust')return name(c.interface);
 if(c.kind==='dai-rate')return Array.isArray(c.interfaces)&&c.interfaces.length>0&&c.interfaces.length<=48&&new Set(c.interfaces).size===c.interfaces.length&&c.interfaces.every(name)&&Number.isInteger(c.rate)&&c.rate>=1&&c.rate<=2048;
 if(c.kind==='arp-neighbor')return name(c.interface)&&isIPv4(c.address)&&name(c.owner)&&name(c.ownerInterface);
 if(!['dai-static-acl','dai-frame'].includes(c.kind)||!vlan(c.vlan)||!name(c.source)||!name(c.sourceInterface)||!name(c.interface)||!isIPv4(c.address))return false;
 return c.kind==='dai-static-acl'?name(c.acl):['acl','deny'].includes(c.decision)&&name(c.receiver);
}
export function matchesARPInspectionCriterion(sim:Simulator,d:Device,c:ARPInspectionCriterion):boolean{
 const inspection=d.config.features.arpInspection;
 if(c.kind==='dai-vlan')return !!d.powered&&!!d.config.vlans[c.vlan]?.active&&inspection?.vlans?.includes(c.vlan)&&['sourceMac','destinationMac','ip'].every(k=>inspection.validations?.[k]===true);
 if(c.kind==='dai-trust')return sim.interfaceUp(d.id,c.interface)&&d.config.interfaces[c.interface]?.features.arpInspectionTrust===true&&Object.entries(d.config.interfaces).every(([name,p])=>name===c.interface||!p.features.arpInspectionTrust);
 if(c.kind==='dai-rate')return c.interfaces.every(name=>sim.interfaceUp(d.id,name)&&d.config.interfaces[name]?.features.arpInspectionRate===c.rate);
 if(c.kind==='arp-neighbor'){
  const owner=find(sim,c.owner),entry=d.runtime.arp[c.interface+'|'+c.address];
  return !!owner&&sim.interfaceUp(d.id,c.interface)&&sim.interfaceUp(owner.id,c.ownerInterface)&&owner.config.interfaces[c.ownerInterface]?.ip===c.address&&!!entry&&!entry.static&&entry.expires>sim.clock.now()&&mac(entry.mac)===mac(sim.macOf(owner.id,c.ownerInterface));
 }
 const source=find(sim,c.source);if(!source)return false;
 const sourceMac=sim.macOf(source.id,c.sourceInterface);if(!source.config.interfaces[c.sourceInterface])return false;
 if(c.kind==='dai-static-acl'){
  const filter=inspection?.filters?.find((f:any)=>f.vlans.includes(c.vlan));
  if(!inspection?.vlans?.includes(c.vlan)||filter?.acl!==c.acl||filter.static||d.config.interfaces[c.interface]?.features.arpInspectionTrust)return false;
  const rules=d.config.features.arpAcls?.[c.acl]??[];
  return source.config.interfaces[c.sourceInterface].ip===c.address&&rules.length===1&&exactRule(rules[0],c.address,sourceMac);
 }
 const receiver=find(sim,c.receiver);if(!receiver)return false;
 return (d.runtime.features.arpInspectionEvents??[]).some((r:any)=>r.port===c.interface&&r.vlan===c.vlan&&r.source===c.address&&mac(r.sourceMac)===mac(sourceMac)&&r.operation==='reply'&&(c.decision==='deny'
  ?r.action==='deny'&&sim.events.some(e=>e.nodeId===d.id&&e.port===c.interface&&e.disposition==='drop'&&e.packet?.id===r.frameId&&e.packet?.source===c.address&&e.packet?.arpOperation==='reply')
  :r.action==='permit'&&r.basis==='acl'&&exactRule(r.rule,c.address,sourceMac)&&sim.events.some(e=>e.nodeId===receiver.id&&e.label==='Frame received'&&e.packet?.id===r.frameId&&e.packet?.source===c.address)&&Object.values(receiver.runtime.arp).some(entry=>entry.ip===c.address&&entry.expires>sim.clock.now()&&mac(entry.mac)===mac(sourceMac))));
}
