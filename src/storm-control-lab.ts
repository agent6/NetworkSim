import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
export type StormTraffic='broadcast'|'multicast'|'unicast';
export type StormCriterion=
 | {kind:'storm-policy';device:string;interface:string;traffic:StormTraffic;rising:number;falling:number;action:'filter'|'shutdown'}
 | {kind:'storm-recovery';device:string;interval:number}
 | {kind:'storm-drop';device:string;interface:string;source:string;sourceInterface:string;traffic:StormTraffic;action:'filter'|'shutdown'}
 | {kind:'storm-ping';device:string;target:string;protection:string;interface:string;phase:'suppressed'|'isolated'|'recovered'};
const find=(sim:Simulator,id:string)=>sim.lab.devices.find(d=>d.id===id||d.config.hostname===id);
export function validStormCriterion(c:any):boolean{
 const name=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=128;
 if(c.kind==='storm-recovery')return Number.isInteger(c.interval)&&c.interval>=30&&c.interval<=86400;
 if(!name(c.interface))return false;
 if(c.kind==='storm-ping')return name(c.target)&&name(c.protection)&&['suppressed','isolated','recovered'].includes(c.phase);
 if(!['storm-policy','storm-drop'].includes(c.kind)||!['broadcast','multicast','unicast'].includes(c.traffic)||!['filter','shutdown'].includes(c.action))return false;
 if(c.kind==='storm-policy')return [c.rising,c.falling].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100)&&c.falling<=c.rising;
 return name(c.source)&&name(c.sourceInterface);
}
export function matchesStormCriterion(sim:Simulator,d:Device,c:StormCriterion):boolean{
 if(c.kind==='storm-policy'){
  const port=d.config.interfaces[c.interface],f=port?.features.stormControl,level=f?.[c.traffic];
  return !!d.powered&&!!port?.switchport&&port.adminUp&&level?.rising===c.rising&&level?.falling===c.falling&&(f.action??'filter')===c.action;
 }
 if(c.kind==='storm-recovery')return !!d.powered&&d.config.features.errdisable?.interval===c.interval&&(d.config.features.errdisable.causes??[]).some((x:string)=>x==='storm-control'||x==='all')&&d.config.features.errdisable.detect?.['storm-control']!==false;
 if(c.kind==='storm-drop'){
  const source=find(sim,c.source);if(!source?.config.interfaces[c.sourceInterface])return false;
  return (d.runtime.features.stormControlEvents??[]).some((r:any)=>r.port===c.interface&&r.kind===c.traffic&&r.source===source.config.interfaces[c.sourceInterface].ip&&r.sourceMac===sim.macOf(source.id,c.sourceInterface)&&r.action===c.action&&r.rising===.1&&r.falling===.05&&r.percent>r.rising&&(c.action!=='shutdown'||r.errDisabled)&&sim.events.some(e=>e.nodeId===d.id&&e.port===c.interface&&e.label==='Storm control drop'&&e.disposition==='drop'&&e.packet?.id===r.packetId));
 }
 const target=find(sim,c.target),sw=find(sim,c.protection);if(!target||!sw)return false;
 const source=Object.values(d.config.interfaces).find(p=>p.ip)?.ip,address=Object.values(target.config.interfaces).find(p=>p.ip)?.ip;if(!source||!address)return false;
 const drops=(sw.runtime.features.stormControlEvents??[]).filter((r:any)=>r.port===c.interface&&r.action===(c.phase==='suppressed'?'filter':'shutdown')&&(c.phase==='suppressed'||r.errDisabled));if(!drops.length)return false;
 let after=Math.max(...drops.map((r:any)=>r.time));
 if(c.phase==='isolated'&&(!sw.config.interfaces[c.interface]?.features.errDisabled||sw.runtime.features.errdisableCauses?.[c.interface]!=='storm-control'))return false;
 if(c.phase==='recovered'){
  const recovery=sim.events.findLast(e=>e.nodeId===sw.id&&e.port===c.interface&&e.label==='Errdisable recovery'&&e.detail==='storm-control recovery timer expired.'&&e.time>=after);if(!recovery)return false;after=recovery.time;
 }
 return sim.events.some(e=>e.nodeId===target.id&&e.label==='Echo request accepted'&&e.time>after&&e.packet?.source===source&&e.packet?.destination===address&&sim.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet?.id&&reply.packet?.destination===source));
}
