import type {Device} from './model.ts';
/** VRRPv2 (RFC3768): Skew_Time is in seconds, independent of the advertisement interval. */
export const vrrpMasterDown=(advertisement:number,priority:number)=>3*advertisement+(256-priority)/256*1000;
export function vrrpPriority(d:Device,cfg:any):number{if(d.config.interfaces[cfg.interface]?.ip===cfg.virtualIp)return 255;let p=Number(cfg.priority??100);for(const t of Array.isArray(cfg.track)?cfg.track:[])if(!d.runtime.features.tracks?.[t.id]?.up)p-=Number(t.decrement??10);return Math.max(0,p);}
/** Keep bounded protocol observations independent of the general 5000-packet trace. */
export function recordVRRP(d:Device,key:'vrrpTransitions'|'vrrpExpirations'|'vrrpIgnored',row:Record<string,unknown>):void{const rows=d.runtime.features[key]??=[];rows.push(row);if(rows.length>64)rows.splice(0,rows.length-64);}
