import type {Simulator} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import {isIPv4,maskToPrefix} from './ip.ts';
import {tunnelNbma} from './tunnel.ts';

export type GRECriterion=
 | {kind:'gre-underlay';device:string;destination:string;interface:string}
 | {kind:'gre-tunnel';device:string;interface:string;sourceInterface:string;sourceAddress:string;destination:string;address:string;mask:string}
 | {kind:'gre-route';device:string;network:string;prefix:number;nextHop:string;interface:string}
 | {kind:'gre-saved';device:string;interface:string;network:string;prefix:number}
 | {kind:'gre-ping';device:string;target:string;address:string;interface:string}
 | {kind:'gre-traffic';device:string;target:string;address:string;localRouter:string;remoteRouter:string;interface:string;transit:string}
 | {kind:'gre-carrier';device:string;addresses:string[]};
export function validGRECriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128,ip=(v:unknown)=>typeof v==='string'&&isIPv4(v);
 if(c.kind==='gre-carrier')return Array.isArray(c.addresses)&&c.addresses.length>=1&&c.addresses.length<=16&&c.addresses.every(ip);
 if(!name(c.interface))return false;
 if(c.kind==='gre-underlay')return ip(c.destination);
 if(c.kind==='gre-ping')return name(c.target)&&ip(c.address);
 if(c.kind==='gre-traffic')return name(c.target)&&ip(c.address)&&name(c.localRouter)&&name(c.remoteRouter)&&name(c.transit);
 if(c.kind==='gre-tunnel'){if(!name(c.sourceInterface)||!ip(c.sourceAddress)||!ip(c.destination)||!ip(c.address)||typeof c.mask!=='string')return false;try{maskToPrefix(c.mask);return true;}catch{return false;}}
 return ['gre-route','gre-saved'].includes(c.kind)&&ip(c.network)&&Number.isInteger(c.prefix)&&c.prefix>=0&&c.prefix<=32&&(c.kind==='gre-saved'||ip(c.nextHop));
}
const find=(s:Simulator,id:string)=>s.lab.devices.find(d=>d.id===id||d.config.hostname===id);
function savedProjection(cfg:DeviceConfig,port:string,network:string,prefix:number){
 const p=cfg.interfaces[port];if(!p)return undefined;const f=p.features;
 return JSON.stringify([[p.adminUp,p.ip,p.mask,p.vrf??'',f.tunnelSource,f.tunnelDestination,f.tunnelMode??'gre',f.tunnelKey,f.tunnelProtection,p.mtu],cfg.staticRoutes.filter(r=>!r.vrf&&r.network===network&&r.prefix===prefix).map(r=>[r.network,r.prefix,r.nextHop,r.interface??'',r.ad??1]).sort()]);
}
function greLeg(s:Simulator,local:Device,remote:Device,tunnel:string,transit:Device,innerId:string):boolean{
 const a=local.config.interfaces[tunnel],b=remote.config.interfaces[tunnel];if(!a||!b)return false;
 const source=tunnelNbma(local,a),destination=tunnelNbma(remote,b);
 return s.events.some(e=>e.nodeId===local.id&&e.port===tunnel&&e.label==='GRE encapsulation'&&e.packet?.protocol==='GRE'&&e.packet.parentId===innerId&&e.packet.source===source&&e.packet.destination===destination&&s.events.some(decap=>decap.nodeId===remote.id&&decap.port===tunnel&&decap.label==='GRE decapsulation'&&decap.packet?.id===e.packet?.id)&&s.events.some(hop=>hop.nodeId===transit.id&&hop.label==='Frame sent'&&hop.packet?.id===e.packet?.id&&hop.packet?.protocol==='GRE'));
}
export function matchesGRECriterion(s:Simulator,d:Device,c:GRECriterion):boolean{
 if(c.kind==='gre-underlay'){const path=s.cefLookup(d.id,c.destination);return s.devicePowered(d.id)&&s.interfaceUp(d.id,c.interface)&&!!path&&path.port===c.interface&&!/^Tunnel/i.test(path.port);}
 if(c.kind==='gre-carrier')return s.devicePowered(d.id)&&c.addresses.every(address=>!s.cefLookup(d.id,address))&&!Object.keys(d.config.interfaces).some(p=>/^Tunnel/i.test(p));
 if(c.kind==='gre-tunnel'){const p=d.config.interfaces[c.interface],source=d.config.interfaces[c.sourceInterface];return !!p&&!!source&&/^Tunnel\d+$/.test(p.name)&&!p.vrf&&!p.switchport&&p.ip===c.address&&p.mask===c.mask&&s.interfaceUp(d.id,p.name)&&source.ip===c.sourceAddress&&s.interfaceUp(d.id,source.name)&&[c.sourceInterface,c.sourceAddress].includes(p.features.tunnelSource)&&p.features.tunnelDestination===c.destination&&['gre','gre ip','gre ipv4'].includes(p.features.tunnelMode??'gre');}
 if(c.kind==='gre-route')return d.config.staticRoutes.some(r=>!r.vrf&&r.network===c.network&&r.prefix===c.prefix&&r.nextHop===c.nextHop&&(r.ad??1)===1&&(!r.interface||r.interface===c.interface))&&d.runtime.routes.some(r=>!r.vrf&&r.network===c.network&&r.prefix===c.prefix&&r.protocol==='static')&&s.cefLookup(d.id,c.network)?.port===c.interface;
 if(c.kind==='gre-saved')return !!d.startupConfig&&!!d.config.interfaces[c.interface]&&d.config.staticRoutes.some(r=>!r.vrf&&r.network===c.network&&r.prefix===c.prefix)&&savedProjection(d.config,c.interface,c.network,c.prefix)===savedProjection(d.startupConfig,c.interface,c.network,c.prefix);
 const target=find(s,c.target);if(!target)return false;
 return s.events.some(request=>request.nodeId===target.id&&request.label==='Echo request accepted'&&request.packet?.destination===c.address&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===request.packet?.id&&(c.kind==='gre-ping'?s.events.some(sent=>sent.nodeId===d.id&&sent.port===c.interface&&sent.label==='Frame sent'&&sent.packet?.id===request.packet?.id&&sent.packet?.protocol==='ICMP'):(()=>{const local=find(s,c.localRouter),remote=find(s,c.remoteRouter),transit=find(s,c.transit);return !!local&&!!remote&&!!transit&&greLeg(s,local,remote,c.interface,transit,request.packet!.id)&&greLeg(s,remote,local,c.interface,transit,reply.packet!.id);})())));
}
