import type {Device} from './model.ts';
import type {Simulator,IPPacket} from './engine.ts';
import type {WirelessPolicy} from './wireless-model.ts';
import {applyQos} from './packet-policy.ts';
import {queuePolicy} from './qos-scheduler.ts';

export function wirelessPolicyDependencies(d:Device):Record<string,any>{const f=d.config.features;return structuredClone({acls:f.acls??{},policyMaps:f.policyMaps??{},classMaps:f.classMaps??{},timeRanges:f.timeRanges??{}});}

/** The AP receives these definitions over CAPWAP. Runtime counters remain on
 * the real enforcement device; physical interface queues are not fabricated. */
export function applyWirelessPolicy(engine:Simulator,d:Device,dependencies:Record<string,any>,policy:WirelessPolicy,direction:'in'|'out',clientId:string,packet:IPPacket):boolean{
 const port='WirelessPolicy-'+policy.name,features={...d.config.features,...dependencies},view:Device={...d,config:{...d.config,features,interfaces:{...d.config.interfaces}}};
 const key=policy.name+':'+clientId+':'+direction,counter=(d.runtime.features.wirelessPolicyCounters??={})[key]??={received:0,permitted:0,dropped:0,bytes:0};counter.received++;counter.bytes+=packet.size;
 const drop=(reason:string)=>{counter.dropped++;engine.emit({nodeId:d.id,port,protocol:'WIRELESS-POLICY',label:'Wireless policy drop',detail:reason,disposition:'drop',packet:{...packet}});return false;};
 if(policy.ipv4Acl&&!packet.destination.includes(':')){if(!Object.hasOwn(features.acls??{},policy.ipv4Acl))return drop('Configured wireless IPv4 ACL is missing.');if(!engine.packetACLPermits(view,policy.ipv4Acl,packet))return drop('IPv4 ACL '+policy.ipv4Acl+' denied client '+direction+' traffic.');}
 const bindings=[{name:direction==='in'?policy.servicePolicyIn:policy.servicePolicyOut,port},{name:direction==='in'?policy.clientServicePolicyIn:policy.clientServicePolicyOut,port:'WirelessClient-'+clientId}];
 for(const binding of bindings){if(!binding.name)continue;const p=Object.hasOwn(features.policyMaps??{},binding.name)?features.policyMaps[binding.name]:undefined;if(!p)return drop('Configured wireless QoS policy is missing.');if(queuePolicy(p))return drop('Wireless policy supports policing/marking, not physical output queues.');view.config.interfaces[binding.port]={...d.config.interfaces[Object.keys(d.config.interfaces)[0]],name:binding.port,features:{[direction==='in'?'servicePolicyIn':'servicePolicyOut']:binding.name}};if(!applyQos(engine,view,binding.port,direction,packet,(name,candidate)=>engine.packetACLPermits(view,name,candidate)))return drop('QoS '+binding.name+' denied client '+direction+' traffic.');}
 counter.permitted++;return true;
}
