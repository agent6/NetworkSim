import type {Simulator} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import {isIPv4} from './ip.ts';
import {tunnelNbma,tunnelSignature} from './tunnel.ts';

export type GREIPsecCriterion=
 | {kind:'gip-ike';device:string;peer:string}
 | {kind:'gip-profile';device:string;interface:string;profile:string;transform:string}
 | {kind:'gip-saved';device:string;peer:string;profile:string;transform:string}
 | {kind:'gip-traffic';device:string;target:string;address:string;localRouter:string;remoteRouter:string;transit:string;interface:string;profile:string}
 | {kind:'gip-carrier';device:string;source:string;target:string;address:string;localRouter:string;remoteRouter:string;interface:string;profile:string;transform:string};
export function validGREIPsecCriterion(c:any):boolean{
 const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
 if(c.kind==='gip-ike')return typeof c.peer==='string'&&isIPv4(c.peer);
 if(!name(c.profile))return false;
 if(c.kind==='gip-saved')return name(c.transform)&&typeof c.peer==='string'&&isIPv4(c.peer);
 if(!name(c.interface))return false;
 if(c.kind==='gip-profile')return name(c.transform);
 return ['gip-traffic','gip-carrier'].includes(c.kind)&&name(c.target)&&typeof c.address==='string'&&isIPv4(c.address)&&name(c.localRouter)&&name(c.remoteRouter)&&(c.kind==='gip-traffic'?name(c.transit):name(c.source)&&name(c.transform));
}
const find=(s:Simulator,id:string)=>s.lab.devices.find(d=>d.id===id||d.config.hostname===id);
const own=(map:any,key:string)=>map&&Object.hasOwn(map,key)?map[key]:undefined;
const policy=(p:any)=>p?.encryption==='aes'&&p.keyLength===256&&p.hash==='sha'&&p.authentication==='pre-share'&&p.group===14;
function cryptoProjection(cfg:DeviceConfig,peer:string,profile:string,transform:string){
 const c=cfg.features.crypto,p=own(c?.profiles,profile),t=own(c?.transformSets,transform),key=c?.isakmpKeys?.find((k:any)=>k.peer===peer)?.key;if(!p||!t||!key)return undefined;
 return JSON.stringify([(c.isakmpPolicies??[]).map((p:any)=>[p.priority,p.encryption,p.keyLength??128,p.hash,p.authentication??'pre-share',p.group,p.lifetime??86400]).sort((a:any,b:any)=>a[0]-b[0]),key,[t.encryption,t.keyLength??128,t.integrity,t.mode??'tunnel'],[p.transformSet,p.pfs,p.lifetime??3600]]);
}
function active(s:Simulator,d:Device,peer:Device,iface:string,profile:string,transform:string):any[]{
 const a=d.config.interfaces[iface],b=peer.config.interfaces[iface];if(!a||!b||!s.interfaceUp(d.id,iface)||a.features.tunnelProtection!==profile)return [];
 return [...(d.runtime.features.ipsecSAs??[])].reverse().filter(sa=>sa.ready&&sa.expires>s.clock.now()&&sa.local===tunnelNbma(d,a)&&sa.peer===tunnelNbma(peer,b)&&sa.tunnel===iface&&sa.profile===profile&&sa.transform===transform&&sa.protocol==='gre'&&sa.encryption==='esp-aes'&&sa.keyLength===256&&sa.integrity==='esp-sha-hmac'&&sa.mode==='transport'&&sa.signature===tunnelSignature(d,iface)&&(d.runtime.features.isakmpSAs??[]).some((ike:any)=>ike.id===sa.id&&ike.state==='QM_IDLE'&&(d.config.features.crypto?.isakmpPolicies??[]).some((p:any)=>p.priority===ike.policy&&policy(p))));
}
function protectedLeg(s:Simulator,local:Device,remote:Device,transit:Device,iface:string,profile:string,innerId:string,spi?:number):boolean{
 const a=local.config.interfaces[iface],b=remote.config.interfaces[iface];if(!a||!b||a.features.tunnelProtection!==profile||b.features.tunnelProtection!==profile)return false;
 return s.events.some(gre=>gre.nodeId===remote.id&&gre.port===iface&&gre.label==='GRE decapsulation'&&gre.packet?.parentId===innerId&&gre.packet.source===tunnelNbma(local,a)&&gre.packet.destination===tunnelNbma(remote,b)&&s.events.some(wire=>wire.nodeId===transit.id&&wire.label==='Frame sent'&&wire.packet?.protocol==='ESP'&&wire.packet.parentId===gre.packet?.id&&typeof wire.packet.espSpi==='number'&&Number(wire.packet.espSequence)>0&&(spi===undefined||wire.packet.espSpi===spi)&&s.events.some(sent=>sent.nodeId===local.id&&sent.label==='Frame sent'&&sent.packet?.id===wire.packet?.id)&&s.events.some(received=>received.nodeId===remote.id&&received.label==='Frame received'&&received.packet?.id===wire.packet?.id)));
}
function protectedEcho(s:Simulator,source:Device,target:Device,address:string,local:Device,remote:Device,transit:Device,iface:string,profile:string,spis?:[number,number]):boolean{
 return s.events.some(request=>request.nodeId===target.id&&request.label==='Echo request accepted'&&request.packet?.destination===address&&s.events.some(reply=>reply.nodeId===source.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===request.packet?.id&&protectedLeg(s,local,remote,transit,iface,profile,request.packet!.id,spis?.[0])&&protectedLeg(s,remote,local,transit,iface,profile,reply.packet!.id,spis?.[1])));
}
export function matchesGREIPsecCriterion(s:Simulator,d:Device,c:GREIPsecCriterion):boolean{
 const crypto=d.config.features.crypto;
 if(c.kind==='gip-ike')return (crypto?.isakmpPolicies??[]).some(policy)&&(crypto?.isakmpKeys??[]).some((k:any)=>k.peer===c.peer&&typeof k.key==='string'&&k.key.length>0);
 if(c.kind==='gip-profile'){const t=own(crypto?.transformSets,c.transform),p=own(crypto?.profiles,c.profile);return !!t&&!!p&&t.encryption==='esp-aes'&&t.keyLength===256&&t.integrity==='esp-sha-hmac'&&t.mode==='transport'&&p.transformSet===c.transform&&p.pfs===14&&(p.lifetime??3600)===3600&&d.config.interfaces[c.interface]?.features.tunnelProtection===c.profile;}
 if(c.kind==='gip-saved'){const running=cryptoProjection(d.config,c.peer,c.profile,c.transform);return !!d.startupConfig&&running!==undefined&&running===cryptoProjection(d.startupConfig,c.peer,c.profile,c.transform);}
 const local=find(s,c.localRouter),remote=find(s,c.remoteRouter),target=find(s,c.target);if(!local||!remote||!target)return false;
 if(c.kind==='gip-traffic'){const transit=find(s,c.transit);return !!transit&&protectedEcho(s,d,target,c.address,local,remote,transit,c.interface,c.profile);}
 const source=find(s,c.source),sourceAddress=source&&Object.values(source.config.interfaces).find(p=>p.ip)?.ip;if(!source||!sourceAddress||!s.devicePowered(d.id)||s.cefLookup(d.id,sourceAddress)||s.cefLookup(d.id,c.address))return false;
 const a=active(s,local,remote,c.interface,c.profile,c.transform),b=active(s,remote,local,c.interface,c.profile,c.transform),outboundA=a.filter(sa=>sa.encaps>0&&b.some(peer=>peer.decaps>0&&peer.inboundSpi===sa.outboundSpi)),outboundB=b.filter(sa=>sa.encaps>0&&a.some(peer=>peer.decaps>0&&peer.inboundSpi===sa.outboundSpi));
 return outboundA.some(left=>outboundB.some(right=>protectedEcho(s,source,target,c.address,local,remote,d,c.interface,c.profile,[left.outboundSpi,right.outboundSpi])));
}
