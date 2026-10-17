import type { Device, NewSimEvent } from './model.ts';
import type { Frame, Simulator } from './engine.ts';
import { isIPv6, sameAddress } from './ip.ts';

type TrackingHost=Pick<Simulator,'clock'|'interfaceUp'>&{emit(event:NewSimEvent):unknown};
const seconds=(value:any,fallback:number)=>value==='infinite'?Infinity:Number(value??fallback);
export function trackingPolicy(device:Device,port:string,vlan:number):any|undefined{
  const name=device.config.interfaces[port]?.features.trackingPolicy??device.config.features.fhsVlanPolicies?.[vlan]?.trackingPolicy;
  return name===undefined?undefined:name==='default'?{}:device.config.features.trackingPolicies?.[name];
}
function schedule(engine:TrackingHost,device:Device,row:any):void{
  const now=engine.clock.now(),next=Math.min(row.expires,row.state==='reachable'?row.reachableUntil??Infinity:Infinity);
  if(Number.isFinite(next))engine.clock.schedule(Math.max(1,next-now),()=>refreshTrackingBindings(engine,device),{owner:device.id,label:'Device tracking binding lifecycle'});
}
export function setBindingLifetime(engine:TrackingHost,device:Device,row:any,policy:any):void{
  if(row.source==='static'||row.source==='DHCPv6')return;
  const settings=device.config.features.fhsBindingSettings??{},now=engine.clock.now(),enabled=policy.tracking!=='disable',reachable=seconds(enabled?policy.lifetime:undefined,seconds(settings.reachableLifetime,300)),stale=seconds(!enabled?policy.lifetime:undefined,seconds(settings.staleLifetime,86400));
  const tentative=row.state==='tentative';Object.assign(row,{state:tentative?'tentative':enabled?'reachable':'stale',reachableUntil:now+reachable*1000,expires:now+(tentative?5:enabled?reachable+stale:stale)*1000,tracking:true});schedule(engine,device,row);
}
/** Static bindings survive runtime reset; dynamic state follows the simulation clock and physical link. */
export function refreshTrackingBindings(engine:TrackingHost,device:Device):void{
  const f=device.config.features,state=device.runtime.features,settings=f.fhsBindingSettings??{},now=engine.clock.now(),configured:any[]=f.fhsStaticBindings||[];
  for(const key of ['ipv6Bindings','deviceBindings']){
    if(!state[key]&&!(key==='ipv6Bindings'&&configured.length))continue;
    let rows:any[]=state[key]??=[];rows=rows.filter(b=>b.source!=='static'||configured.some(c=>c.vlan===b.vlan&&sameAddress(c.ip,b.ip)));
    if(key==='ipv6Bindings')for(const binding of configured){const old=rows.find(b=>b.vlan===binding.vlan&&sameAddress(b.ip,binding.ip));const value={...binding,source:'static',state:'reachable',expires:Infinity,prefix:128};if(old)Object.assign(old,value);else rows.push(value);}
    for(const row of rows.filter(b=>b.tracking&&b.source!=='static')){
      if(!engine.interfaceUp(device.id,row.port)&&row.state!=='down'){row.state='down';row.expires=Math.min(row.expires,now+seconds(settings.downLifetime,86400)*1000);schedule(engine,device,row);}
      else if(row.state==='down'&&engine.interfaceUp(device.id,row.port))row.state='stale';
      if(row.state==='reachable'&&row.reachableUntil<=now){row.state='stale';schedule(engine,device,row);}
      if(row.expires<=now&&settings.logging)engine.emit({nodeId:device.id,port:row.port,protocol:'SISF',label:'Device tracking binding removed',detail:row.ip+' binding lifetime expired.',disposition:'info'});
    }
    state[key]=rows.filter(b=>b.expires>now);
  }
}
export function trackingCounters(device:Device,port:string,vlan:number):any[]{const f=device.runtime.features;f.trackingCounters??={};return [`interface:${port}`,`vlan:${vlan}`].map(key=>f.trackingCounters[key]??={received:0,learned:0,rejected:0,dropped:0});}

/** Learn from delivered address-control traffic; guard violations affect the actual ingress frame. */
export function inspectTracking(engine:Simulator,device:Device,port:string,vlan:number,frame:Frame):boolean{
  refreshTrackingBindings(engine,device);
  const policy=trackingPolicy(device,port,vlan);if(!policy)return true;
  const p=frame.payload;if(!('kind'in p)||p.kind!=='arp')return true;
  if(policy.form==='snooping'&&p.family!==6)return true;
  const address=p.source==='::'?p.target:p.source;if(!address||address==='0.0.0.0'||address==='::')return true;
  const state=device.runtime.features,settings=device.config.features.fhsBindingSettings??{},key=isIPv6(address)?'ipv6Bindings':'deviceBindings',now=engine.clock.now(),meters=trackingCounters(device,port,vlan);meters.forEach(c=>c.received++);
  const bindings:any[]=state[key]??=[];
  const clean=(value:string)=>value.replace(/[^a-f0-9]/gi,'').toLowerCase();
  const old=bindings.find(b=>b.vlan===vlan&&sameAddress(b.ip,address)),same=old&&old.port===port&&clean(old.mac)===clean(frame.sourceMac);
  const conflict=clean(p.mac)!==clean(frame.sourceMac)||old&&!same;
  const all=[...(state.ipv6Bindings||[]),...(state.deviceBindings||[])].filter(b=>b.expires>now),limit=!old&&(all.length>=(settings.maxEntries??200000)||policy.limit!==undefined&&all.filter(b=>b.port===port).length>=policy.limit);
  const level=policy.securityLevel??'guard';
  if((conflict||limit)&&(!policy.trusted||old?.source==='static')){
    state.trackingRejected=(state.trackingRejected??0)+1;meters.forEach(c=>c.rejected++);
    if(level==='guard'||old?.source==='static'){state.trackingDrops=(state.trackingDrops??0)+1;meters.forEach(c=>c.dropped++);engine.emit({nodeId:device.id,port,protocol:p.family===6?'NDP':'ARP',label:'Device tracking guard drop',detail:limit?'The configured binding limit was reached.':'The IP, MAC or attachment conflicts with the binding table.',disposition:'drop'});if(settings.logDrops)engine.emit({nodeId:device.id,port,protocol:'SISF',label:'%SISF-4-DROP',detail:address+' failed device tracking validation.',disposition:'warning'});return false;}
    if(limit||level==='inspect')return true;
  }
  if(policy.deviceRole==='switch'||old?.source==='static')return true;
  const enabled=policy.tracking==='enable',reachable=seconds(enabled?policy.lifetime:undefined,seconds(settings.reachableLifetime,300)),stale=seconds(!enabled?policy.lifetime:undefined,seconds(settings.staleLifetime,86400));
  const row={port,vlan,mac:frame.sourceMac,ip:address,prefix:isIPv6(address)?128:32,state:p.source==='::'?'tentative':enabled?'reachable':'stale',source:p.family===6?'NDP':'ARP',reachableUntil:now+reachable*1000,expires:now+(p.source==='::'?5:enabled?reachable+stale:stale)*1000,tracking:true};
  if(old)Object.assign(old,row);else{bindings.push(row);meters.forEach(c=>c.learned++);if(settings.logging)engine.emit({nodeId:device.id,port,protocol:'SISF',label:'Device tracking binding added',detail:address+' learned from '+row.source+'.',disposition:'info'});}
  schedule(engine,device,old??row);return true;
}
