/** Versioned, original wireless teaching model. No firmware or proprietary assets. */
export type WirelessSecurity = 'open' | 'wpa2-personal' | 'wpa2-enterprise' | 'wpa3-personal' | 'wpa2-wpa3-personal';
export type WirelessBand = '2.4' | '5';
export interface WirelessRadio { band: WirelessBand; enabled: boolean; channel: number; width: 20|40|80; power: number; maxClients: number }
export interface WLANProfile { name: string; id: number; ssid: string; enabled: boolean; security: WirelessSecurity; psk?: string; authenticationList?: string; broadcast: boolean; openAuthentication?:boolean;akmEnabled?:boolean; wpa2Enabled?:boolean;wpa3Enabled?:boolean;saeEnabled?:boolean;pmf?:'disabled'|'optional'|'required' }
export interface WirelessPolicy { name: string; enabled: boolean; vlan: number; centralSwitching: boolean; sessionTimeout: number;ipv4Acl?:string;servicePolicyIn?:string;servicePolicyOut?:string;clientServicePolicyIn?:string;clientServicePolicyOut?:string }
export interface WirelessConfiguration {
 apAuthorization?:{enabled:boolean;methodList:string;lists:Record<string,{method:'local'|'radius';group?:string}>;macs:string[]};
 profile: 'c9800-17.12'|'c9115-lightweight'|'generic-dual-band'|'generic-standalone'; managementInterface?: string;
 standalone?:{nativeVlan:number;bindings:Array<{band:WirelessBand;ssids:string[];aesVlans:number[]}>};
 wlans: Record<string,WLANProfile>; policies: Record<string,WirelessPolicy>; policyTags: Record<string,Record<string,string>>;
 siteTags: Record<string,{localSite:boolean;apProfile:string;flexProfile:string}>;
 rfTags: Record<string,{band24?:string;band5?:string}>;
 apProfiles: Record<string,{description?:string;echoInterval:number;deadInterval:number}>;
 flexProfiles: Record<string,{nativeVlan:number;vlans:Record<string,number>}>;
 rfProfiles: Record<string,{band:WirelessBand;enabled:boolean;power:number;channel:number;width:20|40|80}>;
 assignments: Record<string,{policyTag:string;siteTag:string;rfTag:string}>;
 controller?: string; controllerName?:string; radios: WirelessRadio[];
 adapter: {enabled:boolean;ssid:string;security:WirelessSecurity;passphrase:string;username:string;password:string;autoConnect:boolean;bands:WirelessBand[];roamHysteresis:number;minimumResidence:number;pmfCapable?:boolean};
 rf: {metersPerUnit:number;pathLossExponent:number;noiseFloor:number;attenuation:number;sensitivity:number;interference:boolean};
 dot1xLists:Record<string,string>;
}
export type WirelessState = 'ADAPTER_DISABLED'|'IDLE'|'SCANNING'|'NETWORK_FOUND'|'AUTHENTICATING'|'ASSOCIATING'|'KEY_NEGOTIATING'|'ASSOCIATED'|'OBTAINING_IP'|'CONNECTED'|'AUTH_FAILED'|'ASSOCIATION_FAILED'|'OUT_OF_RANGE'|'RETRY_WAIT'|'ROAMING'|'DISCONNECTED';
export interface WirelessAssociation {apId:string;controllerId:string;controllerAddress:string;wlan:string;ssid:string;policy:string;vlan:number;central:boolean;band:WirelessBand;channel:number;bssid:string;since:number;security:WirelessSecurity;authorized:boolean;signature:string;rssi:number;snr:number;rate:number;keyId?:string;pmf?:boolean}
export function negotiatedWirelessSecurity(profile:WirelessSecurity,client:WirelessSecurity):WirelessSecurity|undefined{if(profile==='wpa2-wpa3-personal')return client==='wpa2-personal'?'wpa2-personal':['wpa3-personal','wpa2-wpa3-personal'].includes(client)?'wpa3-personal':undefined;if(client==='wpa2-wpa3-personal'&&['wpa2-personal','wpa3-personal'].includes(profile))return profile;return profile===client?profile:undefined;}
export function defaultWireless(profile:WirelessConfiguration['profile']):WirelessConfiguration {
 return {profile,managementInterface:profile==='c9800-17.12'?'GigabitEthernet1':undefined,wlans:{},policies:{},policyTags:{'default-policy-tag':{}},siteTags:{'default-site-tag':{localSite:true,apProfile:'default-ap-profile',flexProfile:'default-flex-profile'}},rfTags:{'default-rf-tag':{}},apProfiles:{'default-ap-profile':{echoInterval:30,deadInterval:90}},flexProfiles:{'default-flex-profile':{nativeVlan:1,vlans:{}}},rfProfiles:{},assignments:{},radios:['c9115-lightweight','generic-standalone'].includes(profile)?[{band:'2.4',enabled:true,channel:1,width:20,power:17,maxClients:100},{band:'5',enabled:true,channel:36,width:20,power:17,maxClients:100}]:[],adapter:{enabled:true,ssid:'',security:'wpa2-personal',passphrase:'',username:'',password:'',autoConnect:true,bands:['2.4','5'],roamHysteresis:8,minimumResidence:5000},rf:{metersPerUnit:.2,pathLossExponent:3,noiseFloor:-95,attenuation:0,sensitivity:-82,interference:true},dot1xLists:{}};
}
export function wirelessConfig(device:{config:{features:Record<string,any>}}):WirelessConfiguration|undefined {return device.config.features.wireless;}
/** Profile names are user data, including legal names such as constructor.
 * Never mistake inherited JS members for configured objects or invoke the
 * __proto__ setter while creating an entry. */
export function wirelessEntry<T=any>(table:unknown,key:string|undefined):T|undefined{return table&&typeof table==='object'&&key!==undefined&&Object.hasOwn(table,key)?(table as Record<string,T>)[key]:undefined;}
export function setWirelessEntry(table:Record<string,any>,key:string,value:any):void{Object.defineProperty(table,key,{value,writable:true,enumerable:true,configurable:true});}
export const canonicalMAC=(value:string)=>value.replace(/[^a-f0-9]/gi,'').toLowerCase();
export const ciscoMAC=(value:string)=>canonicalMAC(value).match(/.{4}/g)?.join('.')??value;
/** Reject malformed saved wireless state before replacing a topology. Incomplete
 * but well-formed policy references are allowed and remain operationally inactive. */
export function validateWireless(kind:string,w:unknown):void{
 if(!['wlc','ap','laptop'].includes(kind))return;
 const fail=()=>{throw Error('The lab contains invalid wireless configuration.');},obj=(v:any)=>!!v&&typeof v==='object'&&!Array.isArray(v),dict=(v:any)=>obj(v)&&Object.keys(v).length<=512,text=(v:any,max=64)=>typeof v==='string'&&new TextEncoder().encode(v).length<=max,num=(v:any,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,integer=(v:any,min:number,max:number)=>Number.isInteger(v)&&num(v,min,max),bool=(v:any)=>typeof v==='boolean';
 const v=w as WirelessConfiguration;if(!obj(v)||!(kind==='ap'?['c9115-lightweight','generic-standalone'].includes(v.profile):v.profile===(kind==='wlc'?'c9800-17.12':'generic-dual-band')))fail();
 if(v.standalone){const s=v.standalone;if(!obj(s)||!integer(s.nativeVlan,1,4094)||!Array.isArray(s.bindings)||s.bindings.length!==2||new Set(s.bindings.map(b=>b?.band)).size!==2||s.bindings.some(b=>!obj(b)||!['2.4','5'].includes(b.band)||!Array.isArray(b.ssids)||b.ssids.length>16||b.ssids.some(n=>!text(n,32))||new Set(b.ssids).size!==b.ssids.length||!Array.isArray(b.aesVlans)||b.aesVlans.some(n=>!integer(n,1,4094))))fail();}
 for(const field of['wlans','policies','policyTags','siteTags','rfTags','apProfiles','flexProfiles','rfProfiles','assignments','dot1xLists']as const)if(!dict(v[field]))fail();
 if(v.apAuthorization){const a=v.apAuthorization;if(!obj(a)||!bool(a.enabled)||!text(a.methodList,32)||!dict(a.lists)||Object.values(a.lists).some(p=>!obj(p)||!['local','radius'].includes(p.method)||p.method==='radius'&&!text(p.group,32))||!Array.isArray(a.macs)||a.macs.length>512||new Set(a.macs).size!==a.macs.length||a.macs.some(mac=>typeof mac!=='string'||!/^[a-f0-9]{12}$/.test(mac)))fail();}
 const ids=new Set<number>();for(const[key,p]of Object.entries(v.wlans)){if(ids.has(p?.id))fail();ids.add(p?.id);if(!text(key,32)||!obj(p)||p.name!==key||!integer(p.id,1,512)||!text(p.ssid,32)||!p.ssid||!bool(p.enabled)||!bool(p.broadcast)||!['open','wpa2-personal','wpa2-enterprise','wpa3-personal','wpa2-wpa3-personal'].includes(p.security)||p.psk!==undefined&&!text(p.psk,64)||p.authenticationList!==undefined&&!text(p.authenticationList,32)||p.openAuthentication!==undefined&&!bool(p.openAuthentication)||p.akmEnabled!==undefined&&!bool(p.akmEnabled)||p.wpa2Enabled!==undefined&&!bool(p.wpa2Enabled)||p.wpa3Enabled!==undefined&&!bool(p.wpa3Enabled)||p.saeEnabled!==undefined&&!bool(p.saeEnabled)||p.pmf!==undefined&&!['disabled','optional','required'].includes(p.pmf))fail();}
 for(const p of Object.values(v.policies))if(!obj(p)||!bool(p.enabled)||!integer(p.vlan,1,4094)||!bool(p.centralSwitching)||!integer(p.sessionTimeout,1,86400)||[p.ipv4Acl,p.servicePolicyIn,p.servicePolicyOut,p.clientServicePolicyIn,p.clientServicePolicyOut].some(value=>value!==undefined&&(!text(value,64)||!value)))fail();
 for(const p of Object.values(v.policyTags))if(!dict(p)||Object.keys(p).length>16||Object.entries(p).some(([name,value])=>!text(name,32)||!text(value,32)))fail();
 for(const p of Object.values(v.siteTags))if(!obj(p)||!bool(p.localSite)||!text(p.apProfile,32)||!text(p.flexProfile,32))fail();
 for(const p of Object.values(v.apProfiles))if(!obj(p)||!integer(p.echoInterval,1,30)||!integer(p.deadInterval,1,3600))fail();
 for(const p of Object.values(v.flexProfiles))if(!obj(p)||!integer(p.nativeVlan,1,4094)||!dict(p.vlans))fail();
 for(const[mac,p]of Object.entries(v.assignments))if(!/^[a-f0-9]{12}$/.test(mac)||!obj(p)||!text(p.policyTag,32)||!text(p.siteTag,32)||!text(p.rfTag,32))fail();
 const radio=(p:any,profile=false)=>obj(p)&&['2.4','5'].includes(p.band)&&bool(p.enabled)&&(profile&&p.channel===0||(p.band==='2.4'?[1,6,11]:[36,40,44,48,149,153,157,161,165]).includes(p.channel))&&[20,40,80].includes(p.width)&&(p.band!=='2.4'||p.width===20)&&num(p.power,-10,30)&&(profile||integer(p.maxClients,1,200));
 if(!Array.isArray(v.radios)||v.radios.length>2||v.radios.some(p=>!radio(p)))fail();for(const p of Object.values(v.rfProfiles))if(!radio(p,true))fail();for(const p of Object.values(v.rfTags))if(!obj(p)||p.band24!==undefined&&(!text(p.band24,32)||wirelessEntry(v.rfProfiles,p.band24)&&wirelessEntry(v.rfProfiles,p.band24).band!=='2.4')||p.band5!==undefined&&(!text(p.band5,32)||wirelessEntry(v.rfProfiles,p.band5)&&wirelessEntry(v.rfProfiles,p.band5).band!=='5'))fail();
 const a=v.adapter,r=v.rf;if(!obj(a)||!bool(a.enabled)||!bool(a.autoConnect)||!text(a.ssid,32)||!['open','wpa2-personal','wpa2-enterprise','wpa3-personal','wpa2-wpa3-personal'].includes(a.security)||!text(a.passphrase,64)||!text(a.username,128)||!text(a.password,128)||!Array.isArray(a.bands)||!a.bands.length||a.bands.some(b=>!['2.4','5'].includes(b))||!num(a.roamHysteresis,1,30)||!num(a.minimumResidence,1000,300000)||a.pmfCapable!==undefined&&!bool(a.pmfCapable))fail();
 if(!obj(r)||!num(r.metersPerUnit,.01,10)||!num(r.pathLossExponent,1,6)||!num(r.noiseFloor,-120,-40)||!num(r.attenuation,0,80)||!num(r.sensitivity,-100,-30)||!bool(r.interference))fail();
 if(v.controller!==undefined&&(typeof v.controller!=='string'||!/^\d{1,3}(\.\d{1,3}){3}$/.test(v.controller)||v.controller.split('.').some(part=>+part>255))||v.controllerName!==undefined&&!text(v.controllerName,32)||v.managementInterface!==undefined&&!text(v.managementInterface,64))fail();
 for(const p of Object.values(v.dot1xLists))if(!text(p,32))fail();
}
