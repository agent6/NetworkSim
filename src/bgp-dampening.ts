import type {Device} from './model.ts';
import type {BgpTransportHost} from './bgp-session.ts';
export interface DampeningRecord {peer:string;prefix:string;penalty:number;updatedAt:number;firstFlap:number;flaps:number;suppressed:boolean;suppressedAt?:number;withdrawn:boolean;route?:any}
const timers=new WeakMap<BgpTransportHost,Map<string,any>>();
const config=(d:Device)=>d.config.protocols.bgp?.dampening;
export function currentBgpPenalty(engine:BgpTransportHost,d:Device,row:DampeningRecord):number {const half=config(d)?.halfLife??15;return row.penalty*Math.pow(2,-Math.max(0,engine.clock.now()-row.updatedAt)/(half*60000));}
function key(peer:string,prefix:string){return peer+'|'+prefix;}
function schedule(engine:BgpTransportHost,d:Device,row:DampeningRecord):void{
 let map=timers.get(engine);if(!map){map=new Map();timers.set(engine,map);}const id=d.id+'|'+key(row.peer,row.prefix);engine.clock.cancel(map.get(id));map.delete(id);const settings=config(d);if(!settings)return;
 const penalty=currentBgpPenalty(engine,d,row),target=row.suppressed?settings.reuse:settings.reuse/2,decay=Math.max(1,settings.halfLife*60000*Math.log2(Math.max(1,penalty/target))+1),maximum=row.suppressed?Math.max(1,(row.suppressedAt??engine.clock.now())+settings.maxSuppress*60000-engine.clock.now()):Infinity,runtime=d.runtime;
 map.set(id,engine.clock.schedule(Math.min(decay,maximum),()=>{map!.delete(id);if(d.runtime!==runtime||runtime.features.bgpDampening?.[key(row.peer,row.prefix)]!==row)return;const c=config(d);if(!c)return;row.penalty=currentBgpPenalty(engine,d,row);row.updatedAt=engine.clock.now();if(row.suppressed&&(row.penalty<c.reuse||engine.clock.now()-(row.suppressedAt??0)>=c.maxSuppress*60000)){row.suppressed=false;row.suppressedAt=undefined;engine.emit({nodeId:d.id,protocol:'BGP',label:'Dampening reuse',detail:row.prefix+' from '+row.peer,disposition:'info'});}if(!row.suppressed&&row.penalty<c.reuse/2)delete runtime.features.bgpDampening[key(row.peer,row.prefix)];else schedule(engine,d,row);engine.recompute();engine.notify();},{owner:d.id,label:'BGP dampening decay'}));
}
/** A withdrawal is counted once, when the known path is actually removed from Adj-RIB-In. */
export function observeBgpDampening(engine:BgpTransportHost,deviceId:string,peer:string,prefix:string,route:any,withdrawn:boolean,external:boolean):void{
 const d=engine.getDevice(deviceId),settings=d&&config(d);if(!d||!settings||!external)return;const records=d.runtime.features.bgpDampening??={},id=key(peer,prefix);let row:DampeningRecord|undefined=records[id];
 if(!withdrawn){if(row){row.withdrawn=false;row.route=structuredClone(route);schedule(engine,d,row);}return;}
 if(row?.withdrawn)return;row??=records[id]={peer,prefix,penalty:0,updatedAt:engine.clock.now(),firstFlap:engine.clock.now(),flaps:0,suppressed:false,withdrawn:false};
 row.penalty=Math.min(settings.reuse*Math.pow(2,settings.maxSuppress/settings.halfLife),currentBgpPenalty(engine,d,row)+1000);row.updatedAt=engine.clock.now();row.flaps++;row.withdrawn=true;row.route=structuredClone(route);
 if(!row.suppressed&&row.penalty>=settings.suppress){row.suppressed=true;row.suppressedAt=engine.clock.now();engine.emit({nodeId:d.id,protocol:'BGP',label:'Route dampened',detail:prefix+' from '+peer,disposition:'warning'});}schedule(engine,d,row);
}
export function bgpPathSuppressed(d:Device,peer:string,prefix:string):boolean{return !!config(d)&&!!d.runtime.features.bgpDampening?.[key(peer,prefix)]?.suppressed;}
export function clearBgpDampening(engine:BgpTransportHost,deviceId:string,prefix?:string):void{const d=engine.getDevice(deviceId);if(!d)return;const records=d.runtime.features.bgpDampening??{};for(const[id,row]of Object.entries<DampeningRecord>(records))if(!prefix||row.prefix===prefix){engine.clock.cancel(timers.get(engine)?.get(d.id+'|'+id));timers.get(engine)?.delete(d.id+'|'+id);delete records[id];}engine.recompute();engine.notify();}
