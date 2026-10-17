import type {Device,DeviceConfig,InterfaceConfig} from './model.ts';

/** Host profiles and the dedicated phone share the Ethernet/PoE/VLAN stack. */
export type EndpointRole='computer'|'phone'|'printer'|'iot';
export interface EndpointProfile {role:EndpointRole;power:'external'|'poe'}
export interface VoicePolicy {vlan:number|'dot1p'|'untagged'|'none';cos:number;dscp?:number}
export interface ReceivedVoicePolicy extends VoicePolicy {protocol:'CDP'|'LLDP';expires:number;interface:string}
export function endpointProfile(d:Pick<Device,'kind'|'config'>):EndpointProfile {
 if(d.kind==='phone')return{role:'phone',power:'poe'};
 const c=d.config.features.endpoint;return{role:c?.role??'computer',power:c?.power??(c?.role==='phone'?'poe':'external')};
}
export function endpointUsesPoE(d:Pick<Device,'kind'|'config'>):boolean{return d.kind==='phone'||d.kind==='pc'&&endpointProfile(d).power==='poe';}
export function endpointNetworkPort(d:Pick<Device,'kind'>):string{return d.kind==='phone'?'Network':'GigabitEthernet0';}
export function endpointPowerProfile(d:Pick<Device,'kind'|'config'>):{watts:15.4;standard:'802.3af';class:3}|undefined{return endpointUsesPoE(d)?{watts:15.4,standard:'802.3af',class:3}:undefined;}
export function validVoicePolicy(v:any):v is VoicePolicy{return !!v&&typeof v==='object'&&(Number.isInteger(v.vlan)&&v.vlan>=1&&v.vlan<=4094||['dot1p','untagged','none'].includes(v.vlan))&&Number.isInteger(v.cos)&&v.cos>=0&&v.cos<=7&&(v.dscp===undefined||Number.isInteger(v.dscp)&&v.dscp>=0&&v.dscp<=63);}
export function endpointVoicePolicy(d:Device,now:number):ReceivedVoicePolicy|undefined {
 if(!['pc','phone'].includes(d.kind)||endpointProfile(d).role!=='phone'||!d.powered)return;
 const rows=Object.values<any>(d.runtime.features.discoveryNeighbors??{}).filter(r=>r.interface===endpointNetworkPort(d)&&['CDP','LLDP'].includes(r.protocol)&&r.expires>now&&validVoicePolicy(r.voicePolicy)).sort((a,b)=>b.lastReceived-a.lastReceived||(a.protocol==='CDP'?-1:1));
 const row=rows[0];return row?{...row.voicePolicy,protocol:row.protocol,expires:row.expires,interface:row.interface}:undefined;
}
export function endpointEgressVlan(d:Device,now:number):number|undefined{const p=endpointVoicePolicy(d,now);return typeof p?.vlan==='number'?p.vlan:p?.vlan==='dot1p'?0:undefined;}
export function endpointIngressAllowed(d:Device,vlan:number|undefined,now:number):boolean {if(!['pc','phone'].includes(d.kind)||endpointProfile(d).role!=='phone')return true;const expected=endpointEgressVlan(d,now);return vlan===expected||expected===0&&vlan===undefined;}
export function validateEndpoint(kind:string,config:Pick<DeviceConfig,'features'|'interfaces'>):void {
 const p=config.features.endpoint;if(p!==undefined){if(!['pc','laptop'].includes(kind)||!p||typeof p!=='object'||Array.isArray(p)||!['computer','phone','printer','iot'].includes(p.role)||p.power!==undefined&&!['external','poe'].includes(p.power))throw Error('Invalid endpoint role or power profile.');const power=p.power??(p.role==='phone'?'poe':'external');if(p.role==='phone'&&(kind!=='pc'||power!=='poe')||power==='poe'&&(kind!=='pc'||!['phone','printer','iot'].includes(p.role)))throw Error('Phone and PoE endpoint roles require a wired PC node; phone power is PoE.');}
 const policies=config.features.networkPolicies;if(policies!==undefined){if(!['switch','l3switch','poeswitch'].includes(kind)||!policies||typeof policies!=='object'||Array.isArray(policies)||Object.entries<any>(policies).some(([id,row])=>!/^\d+$/.test(id)||+id<1||+id>4294967295||!row||typeof row!=='object'||Array.isArray(row)||row.voice!==undefined&&!validVoicePolicy(row.voice)||Object.keys(row).some(k=>k!=='voice')))throw Error('Invalid LLDP-MED voice network-policy profile.');}
 for(const port of Object.values<InterfaceConfig>(config.interfaces)){if(port.features.networkPolicy!==undefined&&(!['switch','l3switch','poeswitch'].includes(kind)||!port.switchport||!/^(?:Gigabit|TenGigabit|Fast)Ethernet/.test(port.name)||!Number.isInteger(port.features.networkPolicy)||port.features.networkPolicy<1||port.features.networkPolicy>4294967295))throw Error('Invalid LLDP-MED network-policy attachment.');if(port.features.lldpMedNetworkPolicy!==undefined&&typeof port.features.lldpMedNetworkPolicy!=='boolean')throw Error('Invalid LLDP-MED network-policy TLV selection.');}
}

/** An attached LLDP-MED policy supplies the access-port voice attachment. */
export function switchVoiceVlan(d:Pick<Device,'config'>,port:InterfaceConfig):VoicePolicy['vlan']|undefined {const policy=d.config.features.networkPolicies?.[port.features.networkPolicy]?.voice;return validVoicePolicy(policy)?policy.vlan:port.features.voiceVlan;}
