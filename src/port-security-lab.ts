import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {secureEntries,secureMac,securityEnabled} from './port-security.ts';
export type PortSecurityCriterion=
 | {kind:'ps-config';device:string;interface:string;vlan:number;field:'enabled'|'maximum'|'sticky'|'mode';value:boolean|number|string}
 | {kind:'ps-binding';device:string;interface:string;vlan:number;source:string;sourceInterface:string}
 | {kind:'ps-saved';device:string;interface:string;vlan:number;sources:string[];sourceInterface:string}
 | {kind:'ps-incident';device:string;interface:string;vlan:number;source:string;sourceInterface:string;mode:'protect'|'restrict'|'shutdown'}
 | {kind:'ps-ping';device:string;target:string;protection:string;interface:string;phase:'learned'|'unaffected'|'recovered'};
const find=(s:Simulator,id:string)=>s.lab.devices.find(d=>d.id===id||d.config.hostname===id);
export function validPortSecurityCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
 if(!name(c.interface))return false;
 if(c.kind==='ps-ping')return name(c.target)&&name(c.protection)&&['learned','unaffected','recovered'].includes(c.phase);
 if(!Number.isInteger(c.vlan)||c.vlan<1||c.vlan>4094)return false;
 if(c.kind==='ps-config')return ['enabled','sticky'].includes(c.field)?typeof c.value==='boolean':c.field==='maximum'?Number.isInteger(c.value)&&c.value>=1&&c.value<=1024:c.field==='mode'&&['protect','restrict','shutdown'].includes(c.value);
 if(!name(c.sourceInterface))return false;
 if(c.kind==='ps-saved')return Array.isArray(c.sources)&&c.sources.length===2&&new Set(c.sources).size===2&&c.sources.every(name);
 return ['ps-binding','ps-incident'].includes(c.kind)&&name(c.source)&&(c.kind!=='ps-incident'||['protect','restrict','shutdown'].includes(c.mode));
}
function binding(s:Simulator,d:Device,port:string,vlan:number,source:Device,sourceInterface:string):boolean{
 const p=d.config.interfaces[port];return !!p&&securityEnabled(d,p)&&p.vlan===vlan&&p.features.portSecurity.sticky===true&&secureEntries(d,p).some(r=>r.type==='SecureSticky'&&r.vlan===vlan&&r.mac===secureMac(s.macOf(source.id,sourceInterface)));
}
function incidents(s:Simulator,d:Device,port:string):any[]{return (d.runtime.features.portSecurityEvents??[]).filter((r:any)=>r.port===port&&!r.moved&&s.events.some(e=>e.nodeId===d.id&&e.port===port&&e.label==='Port security violation'&&e.disposition==='drop'&&e.packet?.id===r.packetId&&secureMac(e.packet?.sourceMac??'')===secureMac(r.sourceMac)));}
export function matchesPortSecurityCriterion(s:Simulator,d:Device,c:PortSecurityCriterion):boolean{
 if(c.kind==='ps-config'){
  const p=d.config.interfaces[c.interface],f=p?.features.portSecurity;if(!d.powered||!p?.switchport||p.mode!=='access'||p.vlan!==c.vlan||!p.adminUp||!d.config.vlans[c.vlan]?.active)return false;
  if(c.field==='enabled')return securityEnabled(d,p)===c.value;if(c.field==='maximum')return !!f&&(f.maximum??1)===c.value;if(c.field==='sticky')return !!f&&!!f.sticky===c.value;return !!f&&(f.violation??'shutdown')===c.value;
 }
 if(c.kind==='ps-binding'){const source=find(s,c.source);return !!source&&binding(s,d,c.interface,c.vlan,source,c.sourceInterface);}
 if(c.kind==='ps-saved'){
  const saved=d.startupConfig?.interfaces[c.interface],f=saved?.features.portSecurity;if(!saved?.switchport||saved.mode!=='access'||saved.vlan!==c.vlan||!f||f.enabled===false||f.maximum!==2||!f.sticky||f.violation!=='restrict')return false;
  const expected=c.sources.map(id=>find(s,id));return expected.every(source=>!!source&&binding(s,d,c.interface,c.vlan,source,c.sourceInterface))&&(f.stickyMacs??[]).length===2&&expected.every(source=>(f.stickyMacs??[]).some((m:string)=>secureMac(m)===secureMac(s.macOf(source!.id,c.sourceInterface))));
 }
 if(c.kind==='ps-incident'){
  const source=find(s,c.source);if(!source)return false;
  return incidents(s,d,c.interface).some(r=>r.mode===c.mode&&r.vlan===c.vlan&&secureMac(r.sourceMac)===secureMac(s.macOf(source.id,c.sourceInterface))&&(c.mode==='protect'?r.afterCount===r.beforeCount&&!r.logged&&!r.disabled:c.mode==='restrict'?r.afterCount>r.beforeCount&&r.logged&&!r.disabled:r.afterCount>r.beforeCount&&r.disabled&&r.reason==='psecure-violation'));
 }
 const target=find(s,c.target),sw=find(s,c.protection),port=sw?.config.interfaces[c.interface],source=Object.values(d.config.interfaces).find(p=>p.ip)?.ip,address=target&&Object.values(target.config.interfaces).find(p=>p.ip)?.ip;if(!target||!sw||!port||!source||!address)return false;
 let after=-Infinity;
 if(c.phase==='learned'){if(!binding(s,sw,c.interface,port.vlan,d,'GigabitEthernet0'))return false;}
 else{
  const trip=incidents(s,sw,c.interface).findLast(r=>r.mode==='shutdown'&&r.disabled&&r.reason==='psecure-violation');if(!trip)return false;after=trip.time;
  if(c.phase==='unaffected'&&(!port.features.errDisabled||sw.runtime.features.errdisableCauses?.[c.interface]!=='psecure-violation'))return false;
  if(c.phase==='recovered'&&(!s.interfaceUp(sw.id,c.interface)||port.features.portSecurity?.violation!=='restrict'||!binding(s,sw,c.interface,port.vlan,d,'GigabitEthernet0')))return false;
 }
 return s.events.some(e=>e.nodeId===target.id&&e.label==='Echo request accepted'&&e.time>after&&e.packet?.source===source&&e.packet?.destination===address&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet?.id));
}
