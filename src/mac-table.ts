import type {Device,MacEntry} from './model.ts';
import {macAgingSeconds} from './mac-aging.ts';
export const C9300_MAC_CAPACITY=32000;
export const NS_DC_MAC_CAPACITY=32000;
/** Shared CAM budget for the selected C9300 profiles; not a TCAM partition model. */
export function macCapacity(d:Device):number{return d.kind==='datacenter'?NS_DC_MAC_CAPACITY:['switch','l3switch','poeswitch'].includes(d.kind)?C9300_MAC_CAPACITY:Infinity;}
export function learnMac(d:Device,port:string,vlan:number,mac:string,now:number):'learned'|'updated'|'full'|'ignored'{
 if(!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)||(parseInt(mac.slice(0,2),16)&1)||/^00(?::00){5}$/.test(mac))return'ignored';
 const key=vlan+'|'+mac.toLowerCase(),old=d.runtime.mac[key];if(old?.static)return'ignored';
 if(!old&&Number.isFinite(macCapacity(d))){for(const[k,row]of Object.entries(d.runtime.mac))if(!row.static&&row.expires<=now)delete d.runtime.mac[k];if(Object.keys(d.runtime.mac).length>=macCapacity(d)){d.runtime.features.macLearningFailures=(d.runtime.features.macLearningFailures??0)+1;return'full';}}
 const seconds=macAgingSeconds(d,vlan);d.runtime.mac[key]={mac:mac.toLowerCase(),port,vlan,lastSeen:now,expires:seconds===0?Number.MAX_SAFE_INTEGER:now+seconds*1000};return old?'updated':'learned';
}
/** Static entries reserve CAM slots before dynamic learning. */
export function installStaticMac(d:Device):void{
 for(const[k,row]of Object.entries(d.runtime.mac))if(row.static)delete d.runtime.mac[k];
 let failed=0,used=Object.keys(d.runtime.mac).length;for(const row of d.config.features.staticMac??[]){if(!d.config.interfaces[row.interface])continue;const key=row.vlan+'|'+row.mac.toLowerCase();if(!d.runtime.mac[key]&&used>=macCapacity(d)){const oldest=Object.entries(d.runtime.mac).filter(([,e])=>!e.static).sort((a,b)=>(a[1].lastSeen??0)-(b[1].lastSeen??0))[0];if(oldest){delete d.runtime.mac[oldest[0]];used--;}else{failed++;continue;}}if(!d.runtime.mac[key])used++;d.runtime.mac[key]={mac:row.mac.toLowerCase(),vlan:row.vlan,port:row.interface,expires:Number.MAX_SAFE_INTEGER,static:true};}
 d.runtime.features.macResources={capacity:macCapacity(d),used:Object.keys(d.runtime.mac).length,staticUninstalled:failed};
}
