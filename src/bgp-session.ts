import { observeBgpDampening } from './bgp-dampening.ts';
import type { Device, NewSimEvent } from './model.ts';
import type { SimulationClock } from './clock.ts';
import type { TCPChannel, TCPChannelOptions } from './tcp-channel.ts';
import { modeledTcpKey } from './bgp-compat.ts';
import { isIPv4, isIPv6, sameAddress } from './ip.ts';

export interface BgpTransportHost {
  clock:SimulationClock; getDevice(id:string):Device|undefined; recompute():void; notify():void; emit(event:NewSimEvent):unknown;
  registerTCPChannelService?(port:number,accepts:(d:Device,peer:string,local:string,vrf?:string)=>boolean|{ttl?:number;minimumTTL?:number;authentication?:string},connected:(channel:TCPChannel)=>void):()=>void;
  connectTCPChannel?(id:string,address:string,port:number,options?:TCPChannelOptions):TCPChannel;
}
export interface BgpPeerConfig {
  deviceId:string;peerAddress:string;remoteDeviceId?:string;localAs:number;remoteAs:number;routerId:string;source?:string;vrf?:string;ttl:number;minimumTTL?:number;initiate:boolean;
  keepalive:number;hold:number;connectRetry:number;maximumPrefix?:number;enabled:boolean;password?:string;families?:(4|6)[];
}
export interface BgpSession {
  key:string;config:BgpPeerConfig;runtime:Device['runtime'];state:string;channel?:TCPChannel;remoteRouterId?:string;negotiatedHold?:number;
  received:Map<string,any>;advertised:Map<string,string>;lastReceived?:number;establishedAt?:number;lastError?:string;blocked?:boolean;
  messagesSent:number;messagesReceived:number;connects:number;signature:string;keepaliveTimer?:any;holdTimer?:any;retryTimer?:any;wanted:boolean;negotiatedFamilies?:(4|6)[];
}
let advertisementOrder=0;
type Context={sessions:Map<string,BgpSession>;dispose?:()=>void};
const contexts=new WeakMap<BgpTransportHost,Context>();
function keyOf(d:string,address:string,vrf?:string):string{return`${d}|${vrf??''}|${address}`;}
function context(engine:BgpTransportHost):Context {let c=contexts.get(engine);if(!c){c={sessions:new Map()};contexts.set(engine,c);}return c;}
function event(engine:BgpTransportHost,s:BgpSession,label:string,detail:string,warning=false):void {engine.emit({nodeId:s.config.deviceId,protocol:'BGP',label,detail,disposition:warning?'warning':'info'});}
function cancelTimers(engine:BgpTransportHost,s:BgpSession):void {engine.clock.cancel(s.keepaliveTimer);engine.clock.cancel(s.holdTimer);engine.clock.cancel(s.retryTimer);s.keepaliveTimer=s.holdTimer=s.retryTimer=undefined;}
function refresh(engine:BgpTransportHost):void {engine.recompute();engine.notify();}
function publish(s:BgpSession):void {const row=s.runtime.features.bgpSessions?.find((r:any)=>r.neighbor===s.config.peerAddress&&(r.vrf??'')===(s.config.vrf??''));if(row)Object.assign(row,{state:s.state,channelId:s.channel?.id,lastReceived:s.lastReceived,messagesSent:s.messagesSent,messagesReceived:s.messagesReceived});}
function send(s:BgpSession,message:any):void {if(s.channel?.send({protocol:'bgp',...message})!==undefined)s.messagesSent++;publish(s);}
function scheduleRetry(engine:BgpTransportHost,s:BgpSession):void {
  engine.clock.cancel(s.retryTimer);s.retryTimer=undefined;
  if(!s.wanted||s.blocked||!s.config.enabled||!s.config.initiate||!engine.getDevice(s.config.deviceId)?.powered)return;
  s.retryTimer=engine.clock.schedule(Math.max(100,s.config.connectRetry*1000),()=>{s.retryTimer=undefined;connect(engine,s);},{owner:s.config.deviceId,label:'BGP ConnectRetry'});
}
function neighborLog(engine:BgpTransportHost,s:BgpSession,state:string):void {const d=engine.getDevice(s.config.deviceId);if(d?.config.protocols.bgp?.bgpLogNeighborChanges)(engine as any).log?.(d.id,`%BGP-5-ADJCHANGE: neighbor ${s.config.peerAddress} ${state}`,5);}
function fail(engine:BgpTransportHost,s:BgpSession,reason:string,blocked=false,notification=true):void {
  if(notification&&s.channel?.state==='OPEN')send(s,{type:'NOTIFICATION',reason});
  for(const[key,route]of s.received)observeBgpDampening(engine,s.config.deviceId,s.config.peerAddress,key,route,true,s.config.localAs!==s.config.remoteAs);
  const channel=s.channel;s.channel=undefined;cancelTimers(engine,s);s.received.clear();s.advertised.clear();s.establishedAt=undefined;s.negotiatedHold=undefined;s.blocked=blocked;s.lastError=reason;s.state=blocked?'IDLE (MAX-PREFIX)':'ACTIVE';channel?.close(reason);
  neighborLog(engine,s,'Down '+reason);event(engine,s,blocked?'Maximum-prefix exceeded':'Session down',`${s.config.peerAddress}: ${reason}`,true);scheduleRetry(engine,s);refresh(engine);
}
function armHold(engine:BgpTransportHost,s:BgpSession,seconds=s.negotiatedHold??240):void {
  engine.clock.cancel(s.holdTimer);s.holdTimer=undefined;s.lastReceived=engine.clock.now();publish(s);if(seconds===0)return;
  s.holdTimer=engine.clock.schedule(Math.max(100,seconds*1000),()=>fail(engine,s,'Hold timer expired'),{owner:s.config.deviceId,label:'BGP HoldTimer'});
}
function established(engine:BgpTransportHost,s:BgpSession):void {
  if(s.state==='ESTABLISHED')return;s.state='ESTABLISHED';s.establishedAt=engine.clock.now();s.lastError=undefined;s.advertised.clear();
  const hold=s.negotiatedHold??0,interval=hold?Math.max(0.1,Math.min(s.config.keepalive||hold/3,hold/3)):0;
  if(interval)s.keepaliveTimer=engine.clock.schedule(interval*1000,()=>send(s,{type:'KEEPALIVE'}),{owner:s.config.deviceId,repeat:interval*1000,label:'BGP KeepaliveTimer'});
  neighborLog(engine,s,'Up');event(engine,s,'Session established',`${s.config.peerAddress}: OPEN and KEEPALIVE received over one persistent TCP connection; hold ${hold}s.`);refresh(engine);
}
function receive(engine:BgpTransportHost,s:BgpSession,message:any,channel:TCPChannel):void {
  if(s.channel!==channel||message?.protocol!=='bgp')return;s.messagesReceived++;
  if(message.type==='NOTIFICATION'){fail(engine,s,String(message.reason??'Peer notification'),false,false);return;}
  if(message.type==='OPEN'){
    if(s.state!=='OPENSENT'||!Array.isArray(message.families??[4])||(message.families??[4]).some((f:any)=>![4,6].includes(f))||message.version!==4||message.asn!==s.config.remoteAs||!isIPv4(message.routerId)||message.routerId===s.config.routerId||!Number.isFinite(message.hold)||message.hold!==0&&message.hold<3){fail(engine,s,'OPEN parameters rejected');return;}
    s.negotiatedFamilies=(s.config.families??[4]).filter(family=>(message.families??[4]).includes(family));s.remoteRouterId=message.routerId;s.negotiatedHold=Math.min(s.config.hold,message.hold);s.state='OPENCONFIRM';armHold(engine,s);send(s,{type:'KEEPALIVE'});refresh(engine);return;
  }
  if(message.type==='KEEPALIVE'){
    if(!['OPENCONFIRM','ESTABLISHED'].includes(s.state)){fail(engine,s,'Unexpected KEEPALIVE');return;}armHold(engine,s);if(s.state==='OPENCONFIRM')established(engine,s);return;
  }
  if(message.type!=='UPDATE'||s.state!=='ESTABLISHED')return;
  if(!Array.isArray(message.routes)||!Array.isArray(message.withdrawn)||message.routes.length>10000||message.withdrawn.length>10000){fail(engine,s,'Malformed UPDATE');return;}
  armHold(engine,s);let changed=false;
  for(const key of message.withdrawn)if(typeof key==='string'&&s.received.has(key)){observeBgpDampening(engine,s.config.deviceId,s.config.peerAddress,key,s.received.get(key),true,s.config.localAs!==s.config.remoteAs);changed=s.received.delete(key)||changed;}
  for(const route of message.routes){
    const family=isIPv6(route?.network)?6:4;
    if(!(family===6?isIPv6(route?.network):isIPv4(route?.network))||!Number.isInteger(route.prefix)||route.prefix<0||route.prefix>(family===6?128:32)||!Array.isArray(route.asPath)||route.asPath.length>255||route.asPath.some((n:any)=>!Number.isInteger(n)||n<1||n>4294967295)||!(family===6?isIPv6(route.nextHop):isIPv4(route.nextHop))||!(s.negotiatedFamilies??[4]).includes(family)){fail(engine,s,'Malformed or unnegotiated UPDATE attributes');return;}
    const key=`${route.network}/${route.prefix}`,previous=s.received.get(key);if(JSON.stringify(previous&&{...previous,arrivalOrder:undefined})!==JSON.stringify(route)){s.received.set(key,{...structuredClone(route),arrivalOrder:previous?.arrivalOrder??++advertisementOrder});observeBgpDampening(engine,s.config.deviceId,s.config.peerAddress,key,route,false,s.config.localAs!==s.config.remoteAs);changed=true;}
  }
  if(changed)refresh(engine);else engine.notify();
}
function attach(engine:BgpTransportHost,s:BgpSession,channel:TCPChannel):void {
  if(s.channel&&s.channel!==channel){const old=s.channel;s.channel=undefined;old.close('Connection collision resolved');}
  cancelTimers(engine,s);s.channel=channel;s.state='CONNECT';s.received.clear();s.advertised.clear();channel.setTTL(s.config.ttl);
  channel.setHandlers({onOpen:opened=>{if(s.channel!==opened)return;s.state='OPENSENT';send(s,{type:'OPEN',version:4,asn:s.config.localAs,routerId:s.config.routerId,hold:s.config.hold,families:s.config.families??[4]});armHold(engine,s,240);refresh(engine);},onMessage:(message,connection)=>receive(engine,s,message,connection),onClose:(reason,closed)=>{if(s.channel!==closed)return;fail(engine,s,reason,false,false);}});
}
function connect(engine:BgpTransportHost,s:BgpSession):void {
  const d=engine.getDevice(s.config.deviceId);if(!s.wanted||s.blocked||!s.config.enabled||!s.config.initiate||!d?.powered||!engine.connectTCPChannel)return;
  if(s.channel&&s.channel.state!=='CLOSED')return;s.state='CONNECT';s.connects++;
  try{const channel=engine.connectTCPChannel(d.id,s.config.peerAddress,179,{source:s.config.source,vrf:s.config.vrf,ttl:s.config.ttl,minimumTTL:s.config.minimumTTL,authentication:modeledTcpKey(s.config.password)});attach(engine,s,channel);}catch(error){s.state='ACTIVE';s.lastError=String(error);scheduleRetry(engine,s);}engine.notify();
}
export function synchronizeBgpSessions(engine:BgpTransportHost,configs:BgpPeerConfig[]):BgpSession[] {
  const c=context(engine);for(const s of c.sessions.values())s.wanted=false;
  for(const cfg of configs){
    const d=engine.getDevice(cfg.deviceId);if(!d)continue;const key=keyOf(cfg.deviceId,cfg.peerAddress,cfg.vrf),signature=JSON.stringify([cfg.localAs,cfg.remoteAs,cfg.routerId,cfg.source,cfg.vrf,cfg.ttl,cfg.minimumTTL,cfg.keepalive,cfg.hold,cfg.connectRetry,cfg.maximumPrefix,cfg.enabled,cfg.families]);let s=c.sessions.get(key);
    if(s&&(s.runtime!==d.runtime||s.signature!==signature)){s.wanted=false;const channel=s.channel;s.channel=undefined;cancelTimers(engine,s);channel?.close('BGP configuration or device state changed');c.sessions.delete(key);s=undefined;}
    if(!s){s={key,config:cfg,runtime:d.runtime,state:'IDLE',received:new Map(),advertised:new Map(),messagesSent:0,messagesReceived:0,connects:0,signature,wanted:true};c.sessions.set(key,s);}
    if(s.config.password!==cfg.password)s.channel?.setAuthentication(modeledTcpKey(cfg.password));s.config=cfg;s.wanted=true;if(!cfg.enabled){s.state='IDLE';continue;}
    if(!s.channel&&!s.retryTimer&&!s.blocked&&cfg.initiate){const session=s;s.retryTimer=engine.clock.schedule(0,()=>{session.retryTimer=undefined;connect(engine,session);},{owner:d.id,label:'BGP connect start'});}
  }
  if(!c.dispose&&engine.registerTCPChannelService)c.dispose=engine.registerTCPChannelService(179,(d,peer,local,vrf)=>{
    const s=c.sessions.get(keyOf(d.id,peer,vrf));if(!s?.wanted||!s.config.enabled||s.blocked)return false;const source=s.config.source;if(source){const expected=d.config.interfaces[source]?.ip??source;if(!sameAddress(expected,local))return false;}
    return{ttl:s.config.ttl,minimumTTL:s.config.minimumTTL,authentication:modeledTcpKey(s.config.password)};
  },channel=>{const s=c.sessions.get(keyOf(channel.deviceId,channel.peerAddress,channel.vrf));if(!s?.wanted||!s.config.enabled||s.blocked){channel.close('BGP peer is not configured');return;}attach(engine,s,channel);});
  for(const[key,s]of c.sessions)if(!s.wanted){const channel=s.channel;s.channel=undefined;cancelTimers(engine,s);channel?.close('BGP peer removed');c.sessions.delete(key);}
  return[...c.sessions.values()];
}
export function sendBgpAdvertisements(engine:BgpTransportHost,s:BgpSession,routes:Map<string,any>):void {
  if(s.state!=='ESTABLISHED')return;const changed:any[]=[],withdrawn:string[]=[];
  for(const[key,route]of routes){const encoded=JSON.stringify(route);if(s.advertised.get(key)!==encoded){s.advertised.set(key,encoded);changed.push(route);}}
  for(const key of s.advertised.keys())if(!routes.has(key)){s.advertised.delete(key);withdrawn.push(key);}
  if(!changed.length&&!withdrawn.length)return;const chunks=Math.max(Math.ceil(changed.length/32),Math.ceil(withdrawn.length/32));
  for(let n=0;n<chunks;n++)send(s,{type:'UPDATE',routes:changed.slice(n*32,n*32+32),withdrawn:withdrawn.slice(n*32,n*32+32)});
}
export function rejectBgpMaximumPrefix(engine:BgpTransportHost,s:BgpSession,count:number):void {if(!s.blocked)fail(engine,s,`${count} accepted prefixes exceed maximum ${s.config.maximumPrefix}`,true);}
export function resetBgpSessions(engine:BgpTransportHost,deviceId:string,address?:string,vrf?:string):void {
  for(const s of context(engine).sessions.values())if(s.config.deviceId===deviceId&&(s.config.vrf??'')===(vrf??'')&&(!address||address==='*'||sameAddress(address,s.config.peerAddress))){s.blocked=false;fail(engine,s,'Administrative clear',false);}
}

/** Soft policy re-evaluation preserves the established TCP channel and retained advertisements. */
export function softResetBgpSessions(engine:BgpTransportHost,deviceId:string,address?:string,direction:'in'|'out'|'both'='both',vrf?:string):void {for(const s of context(engine).sessions.values())if(s.config.deviceId===deviceId&&(s.config.vrf??'')===(vrf??'')&&(!address||address==='*'||sameAddress(address,s.config.peerAddress))){if(direction!=='in')s.advertised.clear();}refresh(engine);}
