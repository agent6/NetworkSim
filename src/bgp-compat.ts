import type {Device} from './model.ts';
import { ipToInt, isIPv6 } from './ip.ts';

export interface BgpCandidate {
 network:string;prefix:number;origin:string;asPath:number[];nextHop:string;localPreference:number;med:number;
 weight?:number;originCode?:'i'|'e'|'?';learnedVia?:'ebgp'|'ibgp';from?:string;routerId:string;arrivalOrder?:number;igpMetric?:number;
}
/** Cisco-style ordering for the modeled IPv4 path attributes; weight remains local. */
export function compareBgpCandidates(a:BgpCandidate,b:BgpCandidate,localId:string,alwaysCompareMed=false):number {
 const weight=(p:BgpCandidate)=>p.weight??(p.origin===localId?32768:0),origin=(p:BgpCandidate)=>({i:0,e:1,'?':2})[p.originCode??'?'];
 return weight(b)-weight(a)||b.localPreference-a.localPreference||Number(b.origin===localId)-Number(a.origin===localId)||a.asPath.length-b.asPath.length||origin(a)-origin(b)||
  (alwaysCompareMed||a.asPath[0]===b.asPath[0]?a.med-b.med:0)||Number(a.learnedVia==='ibgp')-Number(b.learnedVia==='ibgp')||(a.igpMetric??0)-(b.igpMetric??0)||ipToInt(a.routerId)-ipToInt(b.routerId)||String(a.from??'').localeCompare(String(b.from??''));
}
/** Deterministic MED chooses one winner per neighboring AS before comparing groups. */
export function selectBgpCandidate<T extends BgpCandidate>(paths:readonly T[],localId:string,settings:{alwaysCompareMed?:boolean;deterministicMed?:boolean}={}):T|undefined {
 const choose=(values:readonly T[])=>values.reduce<T|undefined>((best,path)=>!best||compareBgpCandidates(path,best,localId,!!settings.alwaysCompareMed)<0?path:best,undefined);
 const ordered=[...paths].sort((a,b)=>(b.arrivalOrder??0)-(a.arrivalOrder??0));
 if(!settings.deterministicMed)return choose(ordered);
 const groups=new Map<number,T[]>();for(const path of ordered){const key=path.asPath[0]??-1;const values=groups.get(key)??[];values.push(path);groups.set(key,values);}
 return choose([...groups].sort(([a],[b])=>a-b).map(([,values])=>choose(values)!));
}
export const privateASN=(asn:number)=>asn>=64512&&asn<=65534||asn>=4200000000&&asn<=4294967294;
/** The three standard eight-byte RD encodings; this is not a route target. */
export function canonicalRouteDistinguisher(value:string):string|undefined {
 const m=/^(\d+(?:\.\d+){3}|\d+):(\d+)$/.exec(value);if(!m)return;
 const assigned=Number(m[2]);if(m[1].includes('.')){const octets=m[1].split('.').map(Number);if(octets.some(v=>v>255)||assigned>65535)return;return octets.join('.')+':'+assigned;}
 const admin=Number(m[1]);if(admin>4294967295||assigned>(admin<=65535?4294967295:65535))return;
 return admin+':'+assigned;
}
/** The bare command follows classic IOS all-private behavior; all/replace-as are explicit modes. */
export function removePrivateAS(path:readonly number[],neighborAS:number,localAS:number,mode?:boolean|'all'|'replace-as'):number[]{
 if(!mode)return [...path];if(mode===true&&(path.some(as=>!privateASN(as))||path.includes(neighborAS)))return [...path];
 return path.flatMap(as=>privateASN(as)?mode==='replace-as'?[localAS]:[]:[as]);
}
/** Equality fingerprint for simulated TCP authentication, NOT a TCP-MD5 digest or security primitive. */
export function modeledTcpKey(key:string|undefined):string|undefined {
 if(key===undefined)return;let a=2166136261,b=0x9e3779b9;for(const byte of new TextEncoder().encode(key)){a=Math.imul(a^byte,16777619)>>>0;b=(Math.imul(b^byte,2246822519)+a)>>>0;}return 'modeled-key-'+a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
}

/** VRF unicast processes inherit BGP options, but keep independent neighbors and origination. */
export function scopedBgpConfig(d:Device,vrf?:string):any {const root=d.config.protocols.bgp;if(!root)return;if(!vrf)return root;const child=root.vrfs?.[vrf];return child?{...root,...child,rd:d.config.features.vrfs?.[vrf]?.rd,asn:root.asn,neighbors:child.neighbors??[],networks:child.networks??[],redistribute:child.redistribute??[],aggregates:child.aggregates??[],ipv6:child.ipv6,vrfs:undefined}:undefined;}

/** Address-family policy is independent; transport settings are inherited from the global neighbor. */
export function bgpAddressFamily(d:Device,vrf?:string,family:4|6=4):any {
 const root=scopedBgpConfig(d,vrf);if(!root)return;
 if(family===4)return{...root,neighbors:(root.neighbors??[]).filter((n:any)=>n.activated!==false&&(!isIPv6(n.address)||n.activated===true))};
 const child=root.ipv6;if(!child)return;
 return{...root,...child,asn:root.asn,networks:child.networks??[],redistribute:child.redistribute??[],aggregates:child.aggregates??[],maximumPaths:child.maximumPaths??1,maximumPathsIbgp:child.maximumPathsIbgp??1,neighbors:(child.neighbors??[]).filter((n:any)=>n.activated!==false).flatMap((n:any)=>{const peer=root.neighbors?.find((p:any)=>p.address===n.address);const common=peer?Object.fromEntries(['address','remoteAs','password','passwordType','description','shutdown','updateSource','ebgpMultihop','ttlSecurityHops','bfd','timers'].filter(key=>peer[key]!==undefined).map(key=>[key,peer[key]])):{};return peer?[{...common,...n,remoteAs:peer.remoteAs}]:[];})};
}

export function bgpMultipathEligible(a:BgpCandidate,b:BgpCandidate):boolean {
 return a.learnedVia===b.learnedVia&&a.weight===b.weight&&a.localPreference===b.localPreference&&JSON.stringify(a.asPath)===JSON.stringify(b.asPath)&&a.originCode===b.originCode&&a.med===b.med&&(a.igpMetric??0)===(b.igpMetric??0);
}
