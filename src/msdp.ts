import type {Device,Lab} from './model.ts';
import type {BgpTransportHost} from './bgp-session.ts';
import type {TCPChannel} from './tcp-channel.ts';
import {isIPv4,ipToInt,prefixContains,sameAddress} from './ip.ts';
import {resolveForwardingPaths} from './route-resolver.ts';
export interface MsdpHost extends BgpTransportHost {lab:Lab;interfaceUp(id:string,port:string):boolean}
type Peer={deviceId:string;address:string;source:string;runtime:Device['runtime'];signature:string;channel?:TCPChannel;state:string;wanted:boolean;lastReceived?:number;establishedAt?:number;lastError?:string;resets:number;sent:number;received:number;saSent:number;saReceived:number;retry?:any;keepalive?:any;hold?:any};
type Source={source:string;group:string;rp:string;expires:number;receivedAt:number;peer?:string;path?:string[]};
type Context={peers:Map<string,Peer>;dispose?:()=>void;refresh?:any};
const contexts=new WeakMap<MsdpHost,Context>();
function context(e:MsdpHost):Context{let c=contexts.get(e);if(!c){c={peers:new Map()};contexts.set(e,c);}return c;}
const cacheKey=(source:string,group:string)=>source+'|'+group;
const validGroup=(address:string)=>isIPv4(address)&&prefixContains('224.0.0.0',4,address)&&!prefixContains('224.0.0.0',24,address);
function selectedSource(e:MsdpHost,d:Device,peer:any):string|undefined{const port=peer.connectSource??resolveForwardingPaths(d,peer.address,undefined,p=>e.interfaceUp(d.id,p))[0]?.port,iface=d.config.interfaces[port??''];return iface?.ip&&e.interfaceUp(d.id,iface.name)?iface.ip:undefined;}
function origin(d:Device):string|undefined{const port=d.config.features.msdp?.originatorId;return port?d.config.interfaces[port]?.ip:d.config.features.pim?.rpAddress;}
function publish(e:MsdpHost):void{for(const d of e.lab.devices)d.runtime.features.msdpPeers=[];for(const p of context(e).peers.values()){if(e.getDevice(p.deviceId)?.runtime!==p.runtime)continue;p.runtime.features.msdpPeers.push({address:p.address,source:p.source,state:p.state,channelId:p.channel?.id,establishedAt:p.establishedAt,lastReceived:p.lastReceived,lastError:p.lastError,resets:p.resets,messagesSent:p.sent,messagesReceived:p.received,saSent:p.saSent,saReceived:p.saReceived});}}
function send(e:MsdpHost,p:Peer,message:any):void{if(p.channel?.send({protocol:'msdp',...message})!==undefined){p.sent++;if(message.type==='SA')p.saSent++;publish(e);}}
function retry(e:MsdpHost,p:Peer):void{e.clock.cancel(p.retry);p.retry=undefined;if(p.wanted&&ipToInt(p.source)<ipToInt(p.address))p.retry=e.clock.schedule(10000,()=>{p.retry=undefined;connect(e,p);},{owner:p.deviceId,label:'MSDP connection retry'});}
function down(e:MsdpHost,p:Peer,reason:string):void{const channel=p.channel;p.channel=undefined;e.clock.cancel(p.keepalive);e.clock.cancel(p.hold);p.keepalive=p.hold=undefined;if(p.state==='Established')p.resets++;p.state='Down';p.establishedAt=undefined;p.lastError=reason;channel?.close(reason);retry(e,p);publish(e);e.notify();}
function armHold(e:MsdpHost,p:Peer):void{e.clock.cancel(p.hold);p.lastReceived=e.clock.now();p.hold=e.clock.schedule(75000,()=>down(e,p,'MSDP hold timer expired'),{owner:p.deviceId,label:'MSDP hold timer'});}
function flood(e:MsdpHost,d:Device,source:Source,except?:string):void{for(const p of context(e).peers.values())if(p.deviceId===d.id&&p.state==='Established'&&p.address!==except)send(e,p,{type:'SA',source:source.source,group:source.group,rp:source.rp,path:source.path??[]});}
function sourceAccepted(e:MsdpHost,d:Device,peer:string,rp:string):boolean{if(sameAddress(peer,rp)||(d.config.features.msdp?.peers?.length??0)===1)return true;const originRoute=resolveForwardingPaths(d,rp,undefined,p=>e.interfaceUp(d.id,p))[0],peerRoute=resolveForwardingPaths(d,peer,undefined,p=>e.interfaceUp(d.id,p))[0];return !!originRoute&&!!peerRoute&&originRoute.port===peerRoute.port&&sameAddress(originRoute.target,peerRoute.target);}
function receive(e:MsdpHost,p:Peer,message:any,channel:TCPChannel):void{
 if(p.channel!==channel||message?.protocol!=='msdp'||!['KEEPALIVE','SA'].includes(message.type))return;const d=e.getDevice(p.deviceId);if(!d||d.runtime!==p.runtime)return;p.received++;armHold(e,p);
 if(message.type==='SA'){
  if(!isIPv4(message.source)||!validGroup(message.group)||!isIPv4(message.rp)||!Array.isArray(message.path)||message.path.length>16||message.path.some((v:any)=>typeof v!=='string')||message.path.includes(d.id)||!sourceAccepted(e,d,p.address,message.rp)){p.runtime.features.msdpRejected=(p.runtime.features.msdpRejected??0)+1;publish(e);return;}
  p.saReceived++;const key=cacheKey(message.source,message.group),cache=d.runtime.features.msdpCache??={},old:Source|undefined=cache[key],row:Source={source:message.source,group:message.group,rp:message.rp,peer:p.address,expires:e.clock.now()+210000,receivedAt:e.clock.now(),path:[...message.path,d.id]};cache[key]=row;
  e.clock.schedule(210000,()=>{if(d.runtime===p.runtime&&cache[key]===row){delete cache[key];e.recompute();e.notify();}},{owner:d.id,label:'MSDP source-active cache expiry'});
  if(!old||e.clock.now()-old.receivedAt>=59000)flood(e,d,row,p.address);
  e.emit({nodeId:d.id,protocol:'MSDP',label:'Source-Active received',detail:message.source+', '+message.group+' from RP '+message.rp,disposition:'info'});e.recompute();
 }
 publish(e);e.notify();
}
function attach(e:MsdpHost,p:Peer,channel:TCPChannel):void{
 if(p.channel&&p.channel!==channel){const old=p.channel;p.channel=undefined;old.close('MSDP collision');}e.clock.cancel(p.retry);p.retry=undefined;p.channel=channel;p.state='Connecting';
 channel.setHandlers({onOpen:ch=>{if(p.channel!==ch)return;p.state='Established';p.establishedAt=e.clock.now();p.lastError=undefined;armHold(e,p);send(e,p,{type:'KEEPALIVE'});p.keepalive=e.clock.schedule(60000,()=>send(e,p,{type:'KEEPALIVE'}),{owner:p.deviceId,repeat:60000,label:'MSDP keepalive'});const d=e.getDevice(p.deviceId)!;for(const row of Object.values<Source>(d.runtime.features.msdpLocalSources??{}))if(row.expires>e.clock.now())send(e,p,{type:'SA',source:row.source,group:row.group,rp:row.rp,path:[d.id]});publish(e);e.notify();},onMessage:(m,ch)=>receive(e,p,m,ch),onClose:(reason,ch)=>{if(p.channel===ch)down(e,p,reason);}});
}
function connect(e:MsdpHost,p:Peer):void{if(!p.wanted||p.channel&&p.channel.state!=='CLOSED'||!e.connectTCPChannel||!e.getDevice(p.deviceId)?.powered)return;try{attach(e,p,e.connectTCPChannel(p.deviceId,p.address,639,{source:p.source,ttl:64}));}catch(error){p.lastError=String(error);retry(e,p);}publish(e);}
export function syncMsdp(e:MsdpHost):void{
 const c=context(e);for(const p of c.peers.values())p.wanted=false;
 for(const d of e.lab.devices){if(!d.powered||!d.config.features.multicastRouting)continue;for(const cfg of d.config.features.msdp?.peers??[]){const source=selectedSource(e,d,cfg),key=d.id+'|'+cfg.address,signature=JSON.stringify([source,cfg.connectSource,cfg.remoteAs]);let p=c.peers.get(key);if(p&&(p.runtime!==d.runtime||p.signature!==signature)){if(p.runtime!==d.runtime){e.clock.cancel(c.refresh);c.refresh=undefined;}p.wanted=false;down(e,p,'MSDP local configuration changed');c.peers.delete(key);p=undefined;}if(!source)continue;if(!p){p={deviceId:d.id,address:cfg.address,source,runtime:d.runtime,signature,state:'Down',wanted:true,resets:0,sent:0,received:0,saSent:0,saReceived:0};c.peers.set(key,p);}p.wanted=true;if(!p.channel&&!p.retry&&ipToInt(source)<ipToInt(cfg.address)){const peer=p;p.retry=e.clock.schedule(0,()=>{peer.retry=undefined;connect(e,peer);},{owner:d.id,label:'MSDP connect'});}}}
 for(const[key,p]of c.peers)if(!p.wanted){down(e,p,'MSDP peer removed');c.peers.delete(key);}
 if(!c.dispose&&e.registerTCPChannelService)c.dispose=e.registerTCPChannelService(639,(d,peer,local)=>{const p=c.peers.get(d.id+'|'+peer);return !!p?.wanted&&sameAddress(p.source,local);},channel=>{const p=c.peers.get(channel.deviceId+'|'+channel.peerAddress);if(!p?.wanted){channel.close('MSDP peer not configured');return;}attach(e,p,channel);});
 if(!c.peers.size){e.clock.cancel(c.refresh);c.refresh=undefined;}if(c.peers.size&&!c.refresh)c.refresh=e.clock.schedule(60000,()=>{for(const d of e.lab.devices)for(const[key,row]of Object.entries<Source>(d.runtime.features.msdpLocalSources??{})){if(row.expires<=e.clock.now())delete d.runtime.features.msdpLocalSources[key];else flood(e,d,row);}},{repeat:60000,label:'MSDP Source-Active refresh'});
 publish(e);
}
/** Called only after actual local-source/RP Register validation, never from topology reachability. */
export function observeMsdpSource(e:MsdpHost,d:Device,source:string,group:string):void{
 const rp=origin(d);if(!rp||!isIPv4(source)||!validGroup(group)||!(d.config.features.msdp?.peers?.length))return;
 const cache=d.runtime.features.msdpLocalSources??={},key=cacheKey(source,group),previous:Source|undefined=cache[key],row:Source={source,group,rp,receivedAt:e.clock.now(),expires:e.clock.now()+185000,path:[d.id]};cache[key]=row;if(!previous||previous.expires<=e.clock.now())flood(e,d,row);
}
/** A receiver behind an MSDP RP needs either a locally observed source or a delivered SA. */
export function msdpSourceAvailable(e:MsdpHost,rpAddress:string|undefined,source:string,group:string):boolean{
 if(!rpAddress)return true;const rp=e.lab.devices.find(d=>Object.values(d.config.interfaces).some(i=>i.ip===rpAddress));if(!rp?.config.features.msdp?.peers?.length)return true;const key=cacheKey(source,group);return rp.runtime.features.msdpLocalSources?.[key]?.expires>e.clock.now()||rp.runtime.features.msdpCache?.[key]?.expires>e.clock.now();
}
export function msdpRemoteSource(e:MsdpHost,rpAddress:string|undefined,source:string,group:string):boolean{if(!rpAddress)return false;const rp=e.lab.devices.find(d=>Object.values(d.config.interfaces).some(i=>i.ip===rpAddress));return !!rp&&rp.runtime.features.msdpCache?.[cacheKey(source,group)]?.expires>e.clock.now();}
