import type {Device} from './model.ts';
import {errdisableDetectionEnabled} from './ios-errdisable.ts';
export type BPDUGuardCriterion={kind:'bpdu-guard-policy';device:string;enabled:boolean;manualRecovery:boolean;interfaces:{name:string;override:'inherit'|'enable'|'disable'}[]};
export function validBPDUGuardCriterion(c:any):boolean{
 return !!c&&typeof c==='object'&&c.kind==='bpdu-guard-policy'&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&typeof c.enabled==='boolean'&&typeof c.manualRecovery==='boolean'&&Array.isArray(c.interfaces)&&c.interfaces.length>0&&c.interfaces.length<=32&&c.interfaces.every((p:any)=>p&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=128&&['inherit','enable','disable'].includes(p.override))&&new Set(c.interfaces.map((p:any)=>p.name)).size===c.interfaces.length;
}
/** Keep inheritance distinct from an explicit disable, which overrides the global default. */
export function matchesBPDUGuardCriterion(d:Device,c:BPDUGuardCriterion):boolean{
 const stp=d.config.features.stp??{},causes:string[]=d.config.features.errdisable?.causes??[];
 return ['switch','poeswitch','l3switch'].includes(d.kind)&&!!stp.bpduguardDefault===c.enabled&&stp.bpdufilterDefault!==true&&errdisableDetectionEnabled(d,'bpduguard')&&(!c.manualRecovery||!causes.includes('all')&&!causes.includes('bpduguard'))&&c.interfaces.every(row=>{const p=d.config.interfaces[row.name];return !!p&&p.features.bpdufilter!==true&&p.features.bpduguard===(row.override==='inherit'?undefined:row.override==='enable');});
}
