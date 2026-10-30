import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv6,prefixContains,sameAddress} from './ip.ts';
export type RAGuardCriterion=
 | {kind:'ra-policy';device:string;policy:string;role:'host'|'router'}
 | {kind:'ra-attachment';device:string;policy:string;interfaces:string[];role:'host'|'router'}
 | {kind:'ra-block';device:string;interface:string;source:string;sourceInterface:string;network:string;prefix:number}
 | {kind:'ra-client'|'ra-ping'|'ra-protected-gateway'|'ra-neighbor';device:string;interface:string;router:string;routerInterface:string;network:string;prefix:number;rogueNetwork:string;roguePrefix:number;target?:string;protection?:string;rogue?:string};
const find=(s:Simulator,id:string)=>s.lab.devices.find(d=>d.id===id||d.config.hostname===id);
export function validRAGuardCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128,network=(n:unknown,p:unknown)=>typeof n==='string'&&isIPv6(n)&&Number.isInteger(p)&&Number(p)>=0&&Number(p)<=128;
 if(c.kind==='ra-policy')return name(c.policy)&&['host','router'].includes(c.role);
 if(c.kind==='ra-attachment')return name(c.policy)&&['host','router'].includes(c.role)&&Array.isArray(c.interfaces)&&c.interfaces.length>0&&c.interfaces.length<=48&&new Set(c.interfaces).size===c.interfaces.length&&c.interfaces.every(name);
 if(!name(c.interface)||!network(c.network,c.prefix))return false;
 if(c.kind==='ra-block')return name(c.source)&&name(c.sourceInterface);
 return ['ra-client','ra-ping','ra-protected-gateway','ra-neighbor'].includes(c.kind)&&name(c.router)&&name(c.routerInterface)&&network(c.rogueNetwork,c.roguePrefix)&&(c.kind!=='ra-ping'||name(c.target))&&(c.kind!=='ra-protected-gateway'||name(c.protection)&&name(c.rogue));
}
function cleanPolicy(d:Device,name:string,role:string):boolean{
 const p=d.config.features.ipv6Policies?.raGuard?.[name];return !!d.powered&&p?.deviceRole===role&&!p.trusted&&['sourceAcl','prefixList','hopLimitMin','hopLimitMax','managedFlag','otherFlag','routerPreferenceMaximum'].every(key=>p[key]===undefined);
}
export function matchesRAGuardCriterion(s:Simulator,d:Device,c:RAGuardCriterion):boolean{
 if(c.kind==='ra-policy')return cleanPolicy(d,c.policy,c.role);
 if(c.kind==='ra-attachment')return cleanPolicy(d,c.policy,c.role)&&c.interfaces.every(port=>s.interfaceUp(d.id,port)&&d.config.interfaces[port]?.switchport&&d.config.interfaces[port].features.raGuardPolicy===c.policy);
 if(c.kind==='ra-block'){
  const source=find(s,c.source);if(!source)return false;
  return (d.runtime.features.raGuardEvents??[]).some((r:any)=>r.port===c.interface&&r.sourceMac===s.macOf(source.id,c.sourceInterface)&&sameAddress(r.source,s.linkLocalAddress(source.id,c.sourceInterface))&&r.prefixes.some((p:any)=>p.prefix===c.prefix&&sameAddress(p.network,c.network))&&s.events.some(e=>e.nodeId===d.id&&e.port===c.interface&&e.disposition==='drop'&&e.packet?.id===r.frameId&&e.packet?.messageType==='ra'&&e.packet?.icmpType===134));
 }
 const router=find(s,c.router),port=d.config.interfaces[c.interface],now=s.clock.now();if(!router||!port?.features.ipv6Autoconfig||!s.interfaceUp(d.id,c.interface)||!s.interfaceUp(router.id,c.routerInterface))return false;
 const gateway=d.runtime.features.ipv6DefaultRouters?.[c.interface],owned:string[]=port.features.slaacAddresses??[],leases=d.runtime.features.slaacLeases??{},address=owned.find(a=>prefixContains(c.network,c.prefix,a)&&port.ipv6.some(p=>sameAddress(p.split('/')[0],a))&&leases[c.interface+'|'+a]?.expires>now);
 const learned=!!address&&gateway?.expires>now&&sameAddress(gateway.address,s.linkLocalAddress(router.id,c.routerInterface))&&!port.ipv6.some(a=>prefixContains(c.rogueNetwork,c.roguePrefix,a.split('/')[0]));if(!learned)return false;
 if(c.kind==='ra-client')return s.events.some(e=>e.nodeId===d.id&&e.label==='Frame received'&&e.packet?.messageType==='ra'&&e.packet?.sourceMac===s.macOf(router.id,c.routerInterface)&&sameAddress(e.packet?.source??'',gateway.address));
 if(c.kind==='ra-neighbor'){
  const entry=d.runtime.arp[c.interface+'|'+gateway.address];return !!entry&&entry.expires>now&&entry.mac===s.macOf(router.id,c.routerInterface)&&s.events.some(e=>e.nodeId===d.id&&e.label==='Frame received'&&e.packet?.protocol==='NDP'&&e.packet?.arpOperation==='reply'&&sameAddress(e.packet?.source??'',gateway.address));
 }
 if(c.kind==='ra-protected-gateway'){
  const sw=find(s,c.protection!),rogue=find(s,c.rogue!);return !!sw&&!!rogue&&s.interfaceUp(rogue.id,'GigabitEthernet0/0')&&(sw.runtime.features.raGuardEvents??[]).some((r:any)=>r.time>=gateway.receivedAt&&sameAddress(r.source,s.linkLocalAddress(rogue.id,'GigabitEthernet0/0'))&&r.sourceMac===s.macOf(rogue.id,'GigabitEthernet0/0')&&s.events.some(e=>e.nodeId===sw.id&&e.disposition==='drop'&&e.packet?.id===r.frameId&&e.packet?.messageType==='ra'));
 }
 const target=find(s,c.target!);if(!target)return false;const targetAddresses=Object.values(target.config.interfaces).flatMap(p=>p.ipv6.map(v=>v.split('/')[0]));
 return s.events.some(e=>e.nodeId===target.id&&e.label==='Echo request accepted'&&owned.some(a=>sameAddress(a,e.packet?.source??''))&&targetAddresses.some(a=>sameAddress(a,e.packet?.destination??''))&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet?.id));
}

/** IOS policy configuration and actual attachment inventory, with no invented counters. */
export function raGuardPolicyLines(d:Device,name?:string):string[]{
 const policies=d.config.features.ipv6Policies?.raGuard??{},names=name?[name]:Object.keys(policies).sort();
 if(name&&!Object.hasOwn(policies,name))return ['% RA guard policy '+name+' does not exist.'];
 return names.flatMap(key=>{const p=policies[key],ports=Object.values(d.config.interfaces).filter(i=>i.features.raGuardPolicy===key).sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}));return ['Policy '+key+' configuration:','  device-role '+(p.deviceRole??'host'),...p.trusted?['  trusted-port']:[],...Object.entries({hopLimitMin:'hop-limit minimum',hopLimitMax:'hop-limit maximum',managedFlag:'managed-config-flag',otherFlag:'other-config-flag',routerPreferenceMaximum:'router-preference maximum',sourceAcl:'match ipv6 access-list',prefixList:'match ra prefix-list'}).flatMap(([field,label])=>p[field]===undefined?[]:['  '+label+' '+p[field]]),'Policy applied on the following interfaces:',...ports.map(i=>'  '+i.name.replace('GigabitEthernet','Gi').padEnd(12)+' vlan all'),...Object.entries<any>(d.config.features.fhsVlanPolicies??{}).filter(([,p])=>p.raGuardPolicy===key).map(([vlan])=>'  VLAN '+vlan),''];});
}
