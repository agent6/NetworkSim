import type {Simulator} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import {isIPv4,maskToPrefix} from './ip.ts';

export type VRFCriterion=
 | {kind:'vrf-definition';device:string;vrf:string}
 | {kind:'vrf-interface';device:string;vrf:string;interface:string;address:string;mask:string}
 | {kind:'vrf-static';device:string;vrf:string;network:string;prefix:number;nextHop:string;interface:string}
 | {kind:'vrf-isolation';device:string;vrfs:string[]}
 | {kind:'vrf-saved';device:string;vrfs:string[]}
 | {kind:'vrf-traffic';device:string;target:string;address:string;vrf?:string;interface?:string}
 | {kind:'vrf-global-drop';device:string;address:string;vrfs:string[]};
export function validVRFCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
 if(c.kind==='vrf-isolation'||c.kind==='vrf-saved')return Array.isArray(c.vrfs)&&c.vrfs.length>=2&&c.vrfs.length<=16&&new Set(c.vrfs).size===c.vrfs.length&&c.vrfs.every(name);
 if(c.kind==='vrf-global-drop')return typeof c.address==='string'&&isIPv4(c.address)&&Array.isArray(c.vrfs)&&c.vrfs.length>=2&&c.vrfs.length<=16&&new Set(c.vrfs).size===c.vrfs.length&&c.vrfs.every(name);
 if(c.kind==='vrf-traffic')return name(c.target)&&typeof c.address==='string'&&isIPv4(c.address)&&(c.interface===undefined||name(c.interface))&&(c.vrf===undefined||name(c.vrf)&&name(c.interface));
 if(!name(c.vrf))return false;
 if(c.kind==='vrf-definition')return true;
 if(!name(c.interface))return false;
 if(c.kind==='vrf-interface'){if(typeof c.address!=='string'||!isIPv4(c.address)||typeof c.mask!=='string')return false;try{maskToPrefix(c.mask);return true;}catch{return false;}}
 return c.kind==='vrf-static'&&typeof c.network==='string'&&isIPv4(c.network)&&Number.isInteger(c.prefix)&&c.prefix>=0&&c.prefix<=32&&typeof c.nextHop==='string'&&isIPv4(c.nextHop);
}
const ipv4=(cfg:DeviceConfig,vrf:string)=>Object.hasOwn(cfg.features.vrfs??{},vrf)&&!!cfg.features.vrfs[vrf]&&Object.hasOwn(cfg.features.vrfs[vrf].addressFamilies??{},'ipv4');
function projection(cfg:DeviceConfig,vrfs:string[]){
 const ports=Object.values(cfg.interfaces).filter(p=>p.vrf&&vrfs.includes(p.vrf)).map(p=>[p.name,p.vrf,p.ip,p.mask,p.adminUp]);
 const routes=cfg.staticRoutes.filter(r=>r.vrf&&vrfs.includes(r.vrf)).map(r=>[r.vrf,r.network,r.prefix,r.nextHop,r.interface??'',r.ad??1]);
 return JSON.stringify([ports.sort(),routes.sort()]);
}
export function matchesVRFCriterion(s:Simulator,d:Device,c:VRFCriterion):boolean{
 if(c.kind==='vrf-definition')return ipv4(d.config,c.vrf);
 if(c.kind==='vrf-interface'){const p=d.config.interfaces[c.interface];return !!p&&ipv4(d.config,c.vrf)&&p.vrf===c.vrf&&p.ip===c.address&&p.mask===c.mask&&!p.switchport&&s.interfaceUp(d.id,p.name);}
 if(c.kind==='vrf-static')return d.config.staticRoutes.some(r=>r.vrf===c.vrf&&r.network===c.network&&r.prefix===c.prefix&&r.nextHop===c.nextHop&&(r.ad??1)===1&&(!r.interface||r.interface===c.interface))&&d.runtime.routes.some(r=>r.vrf===c.vrf&&r.network===c.network&&r.prefix===c.prefix&&r.nextHop===c.nextHop&&r.protocol==='static')&&s.cefLookup(d.id,c.network,c.vrf)?.port===c.interface;
 if(c.kind==='vrf-isolation')return s.devicePowered(d.id)&&c.vrfs.every(vrf=>ipv4(d.config,vrf)&&d.runtime.routes.some(r=>r.vrf===vrf&&r.protocol==='static'))&&!d.runtime.routes.some(r=>!r.vrf&&!r.network.includes(':'));
 if(c.kind==='vrf-saved')return !!d.startupConfig&&c.vrfs.every(vrf=>ipv4(d.config,vrf)&&ipv4(d.startupConfig!,vrf)&&Object.values(d.config.interfaces).filter(p=>p.vrf===vrf&&p.ip&&p.adminUp).length>=2&&d.config.staticRoutes.some(r=>r.vrf===vrf))&&projection(d.config,c.vrfs)===projection(d.startupConfig,c.vrfs);
 if(c.kind==='vrf-global-drop')return s.events.some(e=>e.nodeId===d.id&&e.label==='No route'&&e.disposition==='drop'&&e.port===undefined&&e.packet?.vrf===undefined&&e.packet?.messageType==='echo-request'&&e.packet.destination===c.address&&c.vrfs.every(vrf=>ipv4(d.config,vrf)&&!!s.cefLookup(d.id,c.address,vrf)&&s.events.some(sent=>sent.nodeId===d.id&&sent.label==='Frame sent'&&sent.packet?.vrf===vrf&&sent.packet.destination===c.address&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.time<e.time&&reply.packet?.parentId===sent.packet?.id))));
 const target=s.lab.devices.find(q=>q.id===c.target||q.config.hostname===c.target);if(!target)return false;
 if(c.vrf&&d.config.interfaces[c.interface!]?.vrf!==c.vrf)return false;
 return s.events.some(e=>e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet?.destination===c.address&&(!c.vrf||s.events.some(sent=>sent.nodeId===d.id&&sent.port===c.interface&&sent.packet?.id===e.packet?.id&&sent.packet?.vrf===c.vrf&&sent.label==='Frame sent'))&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet?.id));
}
