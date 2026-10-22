import type { ControlPlaneHost } from './control-plane.ts';
import type { Device, InterfaceConfig } from './model.ts';
import { interfaceDuplex } from './ethernet.ts';
import {isDatacenter,nsosFeature,vpcActor,vpcAggregationSuspended} from './datacenter.ts';

type Protocol='DTP'|'LACP'|'PAGP';
type Peer={body:any;at:number;expires:number};
type Session={deviceId:string;port:string;runtime:Device['runtime'];signature:string;peers:Map<Protocol,Peer>;sent:Map<string,string>;last:Map<string,number>;timer?:any;expiry?:any;vtpRequestSignature?:string};
type Context={ports:Map<string,Session>;databases:Map<string,{domain:string;version:number;database:string;revision:number}>;vtpSeen:Map<string,{at:number;runtime:Device['runtime']}>;vtpSequence:number};
const contexts=new WeakMap<ControlPlaneHost,Context>();
function context(e:ControlPlaneHost):Context{let c=contexts.get(e);if(!c){c={ports:new Map(),databases:new Map(),vtpSeen:new Map(),vtpSequence:0};contexts.set(e,c);}return c;}
const key=(id:string,port:string)=>id+'|'+port;
const switched=(d:Device)=>['switch','l3switch','poeswitch','datacenter'].includes(d.kind);
function mac(d:Device):string{if(d.config.features.bridgeMac)return String(d.config.features.bridgeMac).replace(/[:.]/g,'').toLowerCase();let h=2166136261;for(const c of d.id)h=Math.imul(h^c.charCodeAt(0),16777619);return '0200'+(h>>>0).toString(16).padStart(8,'0');}
function counter(d:Device,port:string,protocol:string):any{return((d.runtime.features.switchingMessages??={})[port]??={})[protocol]??= {sent:0,received:0,errors:0,expired:0};}
function compatible(a:string,b:string,p:Protocol):boolean{return p==='LACP'?['active','passive'].includes(a)&&['active','passive'].includes(b)&&(a==='active'||b==='active'):['desirable','auto'].includes(a)&&['desirable','auto'].includes(b)&&(a==='desirable'||b==='desirable');}
export function switchingPeer(e:ControlPlaneHost,id:string,port:string,protocol:Protocol):any|undefined{const peer=context(e).ports.get(key(id,port))?.peers.get(protocol);return peer&&peer.expires>e.clock.now()?{...peer.body,lastReceived:peer.at,expires:peer.expires}:undefined;}
function expire(e:ControlPlaneHost,s:Session):void{e.clock.cancel(s.expiry);s.expiry=undefined;const d=e.getDevice(s.deviceId);if(!d)return;let next=Infinity,changed=false;for(const[p,peer]of s.peers)if(peer.expires<=e.clock.now()){s.peers.delete(p);counter(d,s.port,p).expired++;changed=true;}else next=Math.min(next,peer.expires);if(next<Infinity)s.expiry=e.clock.schedule(next-e.clock.now(),()=>expire(e,s),{owner:d.id,label:'Switching partner expiry'});if(changed){e.recompute();e.notify();}}
function emit(e:ControlPlaneHost,d:Device,port:string,protocol:string,body:any):void{counter(d,port,protocol).sent++;if(protocol==='VTP'&&!body.messageId)body={...body,messageId:d.id+':'+ ++context(e).vtpSequence};e.sendLinkControl?.(d.id,port,{kind:'link-control',protocol,body});}
function vtpAdvertisement(d:Device):any{const c=d.config.features.vtp;return{operation:'advertisement',origin:d.id,hostname:d.config.hostname,domain:c.domain,version:c.version??1,password:c.password??'',revision:c.revision??0,vlans:Object.values(d.config.vlans).filter(v=>(c.version??1)===3||v.id<=1005).sort((a,b)=>a.id-b.id)};}
function transmit(e:ControlPlaneHost,s:Session,signature:(d:Device,p:InterfaceConfig)=>string):void{
 const d=e.getDevice(s.deviceId),p=d?.config.interfaces[s.port];if(!d||!p||!e.interfaceUp(d.id,p.name))return;
 const now=e.clock.now(),send=(protocol:string,body:any,period:number)=>{const sig=JSON.stringify(body);if(s.sent.get(protocol)===sig&&now-(s.last.get(protocol)??-Infinity)<period)return;s.sent.set(protocol,sig);s.last.set(protocol,now);emit(e,d,p.name,protocol,body);};
 if(!isDatacenter(d)&&p.switchport&&!p.features.nonegotiate)send('DTP',{deviceId:d.id,port:p.name,mode:p.mode,domain:d.config.features.vtp?.domain??''},30000);
 const mode=p.features.channelMode,protocol:Protocol|undefined=['active','passive'].includes(mode)?'LACP':['desirable','auto'].includes(mode)?'PAGP':undefined;
 if(protocol&&p.features.channelGroup&&(!isDatacenter(d)||protocol==='LACP'&&nsosFeature(d,'lacp'))){const peer=switchingPeer(e,d.id,p.name,protocol),active=mode==='active'||mode==='desirable',actor=vpcActor(d,p.name);if(active||peer){const synchronized=!!peer&&compatible(mode,peer.mode,protocol)&&peer.signature===signature(d,p)&&interfaceDuplex(d,p)==='full';send(protocol,{deviceId:d.id,port:p.name,group:p.features.channelGroup,actorKey:actor?.key??p.features.channelGroup,actorSystem:actor?.systemMac??mac(d),mode,signature:signature(d,p),systemPriority:actor?.systemPriority??d.config.features.lacpSystemPriority??32768,systemMac:actor?.systemMac??mac(d),portPriority:p.features.lacpPortPriority??32768,timeout:p.features.lacpRate==='fast'?3000:90000,partner:peer?{deviceId:peer.deviceId,port:peer.port,group:peer.group}:undefined,synchronized,vpcSuspended:vpcAggregationSuspended(d,p.name)},protocol==='LACP'&&peer?.timeout===3000?1000:30000);}}
 const vtp=d.config.features.vtp,eligible=switched(d)&&(!isDatacenter(d)||nsosFeature(d,'vtp'))&&p.switchport&&d.runtime.features.trunks?.[p.name]?.operational&&p.features.vtp!==false&&vtp&&['server','client'].includes(vtp.mode);
 if(eligible){const requestSignature=JSON.stringify([vtp.domain,vtp.version??1,vtp.password??'']);if(s.vtpRequestSignature!==requestSignature){s.vtpRequestSignature=requestSignature;emit(e,d,p.name,'VTP',{operation:'request',origin:d.id,domain:vtp.domain??'',version:vtp.version??1,password:vtp.password??''});}if(vtp.domain)send('VTP',vtpAdvertisement(d),300000);}else s.vtpRequestSignature=undefined;
}
/** Physical-link control messages are independent of STP data forwarding. */
export function syncSwitchingMessages(e:ControlPlaneHost,signature:(d:Device,p:InterfaceConfig)=>string):void{
 const c=context(e),wanted=new Set<string>();
 for(const d of e.lab.devices){if(switched(d)){const v=d.config.features.vtp;if(v){const version=v.version??1,database=JSON.stringify(Object.values(d.config.vlans).filter(row=>version===3||row.id<=1005).sort((a,b)=>a.id-b.id)),old=c.databases.get(d.id);if(version!==3&&v.mode==='server'&&old&&old.domain===v.domain&&old.version===version&&old.database!==database&&old.revision===(v.revision??0)){v.revision=((v.revision??0)+1)>>>0;d.runtime.features.vtpLastModified={hostname:d.config.hostname,at:e.clock.now()};}c.databases.set(d.id,{domain:v.domain,version,database,revision:v.revision??0});}}
  for(const[name,p]of Object.entries(d.config.interfaces)){if(/^(Vlan|Port-channel|Loopback|Tunnel|Null)/i.test(name)||!e.interfaceUp(d.id,name)||!p.switchport&&!p.features.channelGroup)continue;const k=key(d.id,name);wanted.add(k);let s=c.ports.get(k);if(s&&s.runtime!==d.runtime){e.clock.cancel(s.timer);e.clock.cancel(s.expiry);c.ports.delete(k);s=undefined;}if(!s){s={deviceId:d.id,port:name,runtime:d.runtime,signature:'',peers:new Map(),sent:new Map(),last:new Map()};c.ports.set(k,s);s.timer=e.clock.schedule(0,()=>transmit(e,s!,signature),{owner:d.id,repeat:1000,label:'DTP / EtherChannel / VTP control'});}const current=JSON.stringify([p.mode,p.features.nonegotiate,p.features.channelMode,p.features.channelGroup,p.features.lacpRate,p.features.lacpPortPriority,d.config.features.lacpSystemPriority,signature(d,p),p.features.vtp,d.runtime.features.trunks?.[name]?.operational,d.config.features.vtp,d.config.vlans]);if(s.signature!==current){s.signature=current;e.clock.schedule(0,()=>transmit(e,s!,signature),{owner:d.id,label:'Triggered switching control'});}}
 }
 for(const[k,s]of c.ports)if(!wanted.has(k)){e.clock.cancel(s.timer);e.clock.cancel(s.expiry);c.ports.delete(k);}
 for(const[k,row]of c.vtpSeen)if(row.at+300000<e.clock.now()||e.getDevice(k.split('|')[0])?.runtime!==row.runtime)c.vtpSeen.delete(k);
}
export function receiveSwitchingMessage(e:ControlPlaneHost,d:Device,port:string,message:{protocol:string;body:any}):boolean{
 if(!['DTP','LACP','PAGP','VTP'].includes(message.protocol))return false;
 const c=context(e),s=c.ports.get(key(d.id,port)),p=d.config.interfaces[port],body=message.body,stats=counter(d,port,message.protocol);stats.received++;if(!s||!p||!body){stats.errors++;return true;}
 if(message.protocol==='VTP'){
  const v=d.config.features.vtp,request=body.operation==='request';if(!switched(d)||isDatacenter(d)&&!nsosFeature(d,'vtp')||!v||!p.switchport||!d.runtime.features.trunks?.[port]?.operational||p.features.vtp===false||v.mode==='off'||typeof body.origin!=='string'||typeof body.domain!=='string'||![1,2,3].includes(body.version)||!request&&(!Array.isArray(body.vlans)||!Number.isInteger(body.revision)||body.revision<0||body.revision>4294967295)){stats.errors++;return true;}
  const id=d.id+'|'+(typeof body.messageId==='string'?body.origin+'|'+body.messageId:JSON.stringify(body)),seen=c.vtpSeen.get(id);if(seen?.runtime===d.runtime)return true;c.vtpSeen.set(id,{at:e.clock.now(),runtime:d.runtime});if(c.vtpSeen.size>8192)c.vtpSeen.delete(c.vtpSeen.keys().next().value!);
  const domainMatches=v.domain===body.domain,versionMatches=(v.version??1)===body.version,passwordMatches=(v.password??'')===(body.password??'');
  if(request){if(['server','client'].includes(v.mode)&&v.domain&&versionMatches&&passwordMatches&&(domainMatches||body.domain===''))emit(e,d,port,'VTP',vtpAdvertisement(d));}
  else if(['server','client'].includes(v.mode)&&versionMatches&&passwordMatches&&(domainMatches||!v.domain)&&body.vlans.every((r:any)=>Number.isInteger(r.id)&&r.id>=1&&r.id<=4094&&typeof r.name==='string'&&typeof r.active==='boolean')){
   const inherited=!v.domain&&!!body.domain;if(inherited)v.domain=body.domain;
   if(body.revision>(v.revision??0)){const allowed=body.vlans.filter((r:any)=>body.version===3||r.id<=1005),extended=Object.entries(d.config.vlans).filter(([id])=>body.version!==3&&Number(id)>1005);d.config.vlans=Object.fromEntries([...extended,...allowed.map((r:any)=>[r.id,structuredClone(r)])]);v.revision=body.revision;d.runtime.features.vtpSyncCount=(d.runtime.features.vtpSyncCount??0)+1;d.runtime.features.vtpLastSync={hostname:body.hostname,revision:body.revision,at:e.clock.now()};c.databases.set(d.id,{domain:v.domain,version:v.version??1,database:JSON.stringify(Object.values(d.config.vlans).filter(r=>body.version===3||r.id<=1005).sort((a,b)=>a.id-b.id)),revision:v.revision});e.recompute();e.notify();}else if(inherited){e.recompute();e.notify();}
  }
  // C9300 XE17.12 transparent relay checks domain in v2, and version+domain
  // in v1. It does not authenticate/adopt the relayed VLAN database.
  if(v.mode==='transparent'&&domainMatches&&((v.version??1)===2||versionMatches))for(const[name,iface]of Object.entries(d.config.interfaces))if(name!==port&&e.interfaceUp(d.id,name)&&iface.switchport&&iface.features.vtp!==false&&d.runtime.features.trunks?.[name]?.operational)emit(e,d,name,'VTP',body);
  return true;
 }
 const protocol=message.protocol as Protocol;if(typeof body.deviceId!=='string'||typeof body.port!=='string'||typeof body.mode!=='string'){stats.errors++;return true;}if(isDatacenter(d)&&(protocol==='DTP'||protocol==='PAGP'||protocol==='LACP'&&!nsosFeature(d,'lacp')))return true;if(protocol==='DTP'&&(!p.switchport||p.features.nonegotiate))return true;
 const old=s.peers.get(protocol),signature=(b:any)=>b&&JSON.stringify(b),changed=signature(old?.body)!==signature(body),timeout=protocol==='DTP'?300000:protocol==='LACP'&&p.features.lacpRate==='fast'?3000:90000;s.peers.set(protocol,{body:structuredClone(body),at:e.clock.now(),expires:e.clock.now()+timeout});expire(e,s);
 if(changed){s.sent.delete(protocol);s.signature='';e.recompute();e.notify();}return true;
}
