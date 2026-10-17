import type{Device}from'./model.ts';
export function macAgingSeconds(d:Device,vlan:number):number{return d.config.features.macAgingVlans?.[vlan]??d.config.features.macAgingTime??300;}
/** Zero disables dynamic aging without converting an entry to STATIC. */
export function refreshMacAging(d:Device,now:number):void{for(const row of Object.values(d.runtime.mac)){if(row.static)continue;const seconds=macAgingSeconds(d,row.vlan),seen=row.lastSeen??now;row.lastSeen=seen;row.expires=seconds===0?Number.MAX_SAFE_INTEGER:seen+seconds*1000;if(row.expires<=now)delete d.runtime.mac[row.vlan+'|'+row.mac];}}
