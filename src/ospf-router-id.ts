import type {Device,InterfaceConfig} from './model.ts';
import {ipToInt,isIPv4} from './ip.ts';
import {routingDevice} from './routing-scope.ts';

// Process identity is operational state. Runtime-keyed maps survive configuration
// object replacement, but are never serialized and cannot survive device reboot.
interface Identity {runtime:Device['runtime'];scope:string;processId:number;id:string;configured?:string;established:boolean}
const processes=new WeakMap<Device['runtime'],Map<string,Identity>>(),aliases=new WeakMap<object,Identity>();
function identity(d:Device,c:any):Identity|undefined {
 if(d.kind==='datacenter'||!c)return;const entry=aliases.get(c);return entry?.runtime===d.runtime&&processes.get(d.runtime)?.get(entry.scope)===entry?entry:undefined;
}
export function activeIOSOSPFRouterId(d:Device,c=d.config.protocols.ospf):string|undefined {return identity(d,c)?.id;}
export function iosOSPFRouterIdEstablished(d:Device,c=d.config.protocols.ospf):boolean {return !!identity(d,c)?.established;}
export function syncIOSOSPFRouterIds(d:Device,up:(port:InterfaceConfig)=>boolean):void {
 if(d.kind==='datacenter')return;let slots=processes.get(d.runtime);if(!slots){slots=new Map();processes.set(d.runtime,slots);}
 const scopes=[undefined,...Object.keys(d.config.protocols.ospf?.vrfs??{})],wanted=new Set(scopes.map(v=>v??''));
 for(const key of slots.keys())if(!wanted.has(key))slots.delete(key);
 for(const vrf of scopes){
  const scope=vrf??'',c=routingDevice(d,vrf).config.protocols.ospf;if(!c||c.placeholder||c.enabled===false){slots.delete(scope);continue;}
  const select=()=>c.routerId||Object.values(d.config.interfaces).filter(p=>p.ip&&isIPv4(p.ip)&&p.ip!=='0.0.0.0'&&!p.switchport&&(p.vrf??'')===scope&&up(p)).sort((a,b)=>Number(/^Loopback/i.test(b.name))-Number(/^Loopback/i.test(a.name))||ipToInt(b.ip!)-ipToInt(a.ip!))[0]?.ip||'0.0.0.0';
  let entry=slots.get(scope);if(!entry||entry.processId!==Number(c.processId??1)){entry={runtime:d.runtime,scope,processId:Number(c.processId??1),id:select(),configured:c.routerId,established:false};slots.set(scope,entry);}
  aliases.set(c,entry);const peers=d.runtime.features.ospfPackets?.['ospf'+(vrf?':'+vrf:'')]?.neighbors??[];entry.established ||= peers.some((n:{state:string})=>n.state!=='DOWN');
  // A manual ID set before neighbors form is immediately usable. Once peers have
  // been heard, changing/removing the override takes effect at process restart.
  if(entry.id==='0.0.0.0'||!entry.established&&entry.configured!==c.routerId)entry.id=select();entry.configured=c.routerId;
 }
}
export function resetIOSOSPFRouterId(d:Device):void {processes.delete(d.runtime);}
