import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
export type MSTCriterion=
 | {kind:'mst-region';device:string;name:string;revision:number;instances:{id:number;vlans:number[]}[]}
 | {kind:'mst-priority';device:string;instance:number;priority:number}
 | {kind:'mst-tree';device:string;instance:number;vlans:number[];root:string;ports?:{name:string;role:'root'|'designated'|'alternate';state:'forwarding'|'blocking'}[]};
const text=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=128;
const integer=(v:any,min:number,max:number)=>Number.isInteger(v)&&v>=min&&v<=max;
const vlans=(v:any)=>Array.isArray(v)&&v.length>0&&v.length<=64&&v.every(n=>integer(n,1,4094))&&new Set(v).size===v.length;
export function validMSTCriterion(c:any):boolean{
 if(!text(c.device))return false;
 if(c.kind==='mst-region')return text(c.name)&&c.name.length<=32&&integer(c.revision,0,65535)&&Array.isArray(c.instances)&&c.instances.length>0&&c.instances.length<=16&&c.instances.every((i:any)=>i&&integer(i.id,1,4094)&&vlans(i.vlans))&&new Set(c.instances.map((i:any)=>i.id)).size===c.instances.length&&new Set(c.instances.flatMap((i:any)=>i.vlans)).size===c.instances.reduce((n:number,i:any)=>n+i.vlans.length,0);
 if(!integer(c.instance,0,4094))return false;
 if(c.kind==='mst-priority')return integer(c.priority,0,61440)&&c.priority%4096===0;
 return c.kind==='mst-tree'&&vlans(c.vlans)&&text(c.root)&&(c.ports===undefined||Array.isArray(c.ports)&&c.ports.length>0&&c.ports.length<=32&&c.ports.every((p:any)=>p&&text(p.name)&&['root','designated','alternate'].includes(p.role)&&['forwarding','blocking'].includes(p.state))&&new Set(c.ports.map((p:any)=>p.name)).size===c.ports.length);
}
export function matchesMSTCriterion(s:Simulator,d:Device,c:MSTCriterion):boolean{
 const stp=d.config.features.stp,m=stp?.mst;if(stp?.mode!=='mst'||!m)return false;
 if(c.kind==='mst-region'){
  const canonical=(rows:any[])=>JSON.stringify(rows.map(i=>[i.id,[...i.vlans].sort((a,b)=>a-b)]).sort((a,b)=>a[0]-b[0]));
  return m.name===c.name&&(m.revision??0)===c.revision&&canonical(m.instances??[])===canonical(c.instances);
 }
 if(c.kind==='mst-priority')return (m.priorities?.[c.instance]??m.instances?.find((i:any)=>i.id===c.instance)?.priority??stp.priority??32768)===c.priority;
 if(!s.devicePowered(d.id)||!s.getDevice(c.root))return false;
 const first=d.runtime.stp[c.vlans[0]];
 return c.vlans.every(v=>{
  const instance=m.instances?.find((i:any)=>i.vlans.includes(v))?.id??0,t=d.runtime.stp[v];
  return !!d.config.vlans[v]?.active&&instance===c.instance&&t?.mode==='mst'&&!t.boundary&&t.rootId===c.root&&t.rootBridgeId===first?.rootBridgeId&&t.rootPort===first?.rootPort&&t.cost===first?.cost&&(c.ports??[]).every(p=>{const state=t.ports[p.name];return s.interfaceUp(d.id,p.name)&&state?.role===p.role&&state.state===p.state&&state.linkType==='point-to-point'&&!state.edge&&!d.runtime.features.stpLegacy?.[p.name];});
 });
}
