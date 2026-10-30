import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,inSubnet,maskToPrefix} from './ip.ts';

type Binding={device:string;source:string;server:string;interface:string;clientInterface:string;vlan:number;network:string;prefix:number;gateway:string;dnsServer:string};
export type SnoopingCriterion=
 | {kind:'dhcp-snooping';device:string;vlan:number;option82:boolean}
 | {kind:'snooping-trust';device:string;interface:string;exclusive:boolean}
 | {kind:'snooping-rate';device:string;interfaces:string[];rate:number}
 | (Binding&{kind:'snooping-binding'})
 | (Binding&{kind:'snooping-option82'})
 | (Binding&{kind:'snooping-ping';target:string})
 | {kind:'snooping-rogue-drop';device:string;source:string;server:string;interface:string;vlan:number};

export function validSnoopingCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
 const vlan=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<4095;
 if(c.kind==='dhcp-snooping')return vlan(c.vlan)&&typeof c.option82==='boolean';
 if(c.kind==='snooping-trust')return name(c.interface)&&typeof c.exclusive==='boolean';
 if(c.kind==='snooping-rate')return Array.isArray(c.interfaces)&&c.interfaces.length>0&&c.interfaces.length<=48&&new Set(c.interfaces).size===c.interfaces.length&&c.interfaces.every(name)&&Number.isInteger(c.rate)&&c.rate>=1&&c.rate<=2048;
 if(!['snooping-binding','snooping-option82','snooping-ping','snooping-rogue-drop'].includes(c.kind)||!name(c.source)||!name(c.server)||!name(c.interface)||!vlan(c.vlan))return false;
 if(c.kind==='snooping-rogue-drop')return true;
 return name(c.clientInterface)&&isIPv4(c.network)&&Number.isInteger(c.prefix)&&c.prefix>=0&&c.prefix<=32&&isIPv4(c.gateway)&&isIPv4(c.dnsServer)&&(c.kind!=='snooping-ping'||name(c.target));
}
const find=(sim:Simulator,id:string)=>sim.lab.devices.find(d=>d.id===id||d.config.hostname===id);
const mac=(value:string)=>value.replace(/[^a-f0-9]/gi,'').toLowerCase();
function bindingProof(sim:Simulator,d:Device,c:Binding):{source:Device;server:Device;lease:any;binding:any;serverLease:any}|undefined{
 const source=find(sim,c.source),server=find(sim,c.server),port=d.config.interfaces[c.interface],settings=d.config.features.dhcpSnooping,now=sim.clock.now();
 if(!source||!server||!settings?.enabled||!settings.vlans?.includes(c.vlan)||!port?.switchport||port.vlan!==c.vlan||port.features.dhcpSnoopingTrust||!sim.interfaceUp(d.id,c.interface)||!sim.interfaceUp(source.id,c.clientInterface))return;
 const client=source.config.interfaces[c.clientInterface],lease=source.runtime.features.dhcpClientLeases?.[c.clientInterface];
 if(!client?.features.dhcp||!isIPv4(client.ip??'')||!client.mask||!lease||!['BOUND','RENEWING','REBINDING'].includes(lease.state)||lease.expires<=now||lease.serverId!==server.id||lease.address!==client.ip||source.config.defaultGateway!==c.gateway||!source.config.dnsServers.includes(c.dnsServer))return;
 try{if(!inSubnet(client.ip!,c.network,c.prefix)||maskToPrefix(client.mask)!==c.prefix)return;}catch{return;}
 const binding=(d.runtime.features.dhcpBindings??[]).find((b:any)=>b.port===c.interface&&b.vlan===c.vlan&&b.ip===client.ip&&mac(b.mac)===mac(sim.macOf(source.id,c.clientInterface))&&b.expires>now&&b.serverId===server.id&&b.transaction===lease.transaction);
 const serverLease=(server.runtime.features.dhcpLeases??[]).find((l:any)=>l.clientId===source.id&&l.address===client.ip&&l.state==='BOUND'&&l.expires>now);
 if(binding&&serverLease)return {source,server,lease,binding,serverLease};
}
export function matchesSnoopingCriterion(sim:Simulator,d:Device,c:SnoopingCriterion):boolean{
 if(c.kind==='dhcp-snooping'){const f=d.config.features.dhcpSnooping;return !!d.powered&&!!d.config.vlans[c.vlan]?.active&&f?.enabled===true&&f.vlans?.includes(c.vlan)&&!!f.option82===c.option82;}
 if(c.kind==='snooping-trust')return sim.interfaceUp(d.id,c.interface)&&d.config.interfaces[c.interface]?.features.dhcpSnoopingTrust===true&&(!c.exclusive||Object.entries(d.config.interfaces).every(([name,p])=>name===c.interface||!p.features.dhcpSnoopingTrust));
 if(c.kind==='snooping-rate')return c.interfaces.every(name=>sim.interfaceUp(d.id,name)&&d.config.interfaces[name]?.features.dhcpSnoopingRate===c.rate);
 if(c.kind==='snooping-rogue-drop'){
  const source=find(sim,c.source),server=find(sim,c.server);if(!source||!server)return false;
  return (d.runtime.features.dhcpSnoopingEvents??[]).some((r:any)=>r.reason==='untrusted-server'&&r.clientId===source.id&&r.serverId===server.id&&r.port===c.interface&&r.vlan===c.vlan&&['offer','ack','nak'].includes(r.operation)&&sim.events.some(e=>e.nodeId===d.id&&e.port===c.interface&&e.label==='DHCP snooping drop'&&e.disposition==='drop'&&e.packet?.id===r.frameId&&e.packet?.dhcpOperation===r.operation));
 }
 const proof=bindingProof(sim,d,c);if(!proof)return false;
 if(c.kind==='snooping-binding')return true;
 if(c.kind==='snooping-option82'){const expected={circuitId:c.vlan+':'+c.interface,remoteId:d.id};return d.config.features.dhcpSnooping.option82===true&&[proof.lease.option82,proof.serverLease.option82].every(v=>v?.circuitId===expected.circuitId&&v.remoteId===expected.remoteId);}
 const target=find(sim,c.target);if(!target)return false;const address=Object.values(target.config.interfaces).find(p=>p.ip)?.ip;if(!address)return false;
 return sim.events.some(e=>e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet?.source===proof.lease.address&&e.packet?.destination===address&&sim.events.some(reply=>reply.nodeId===proof.source.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet!.id&&reply.packet.source===address&&reply.packet.destination===proof.lease.address));
}
