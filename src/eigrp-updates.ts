import {parseCidr,sameAddress} from './ip.ts';
import type {Device} from './model.ts';
import type {ControlPlaneHost} from './control-plane.ts';

export type EigrpFamily='eigrp'|'eigrp6';
export interface EigrpVector {bandwidth:number;delay:number;wideLatency?:number;reliability?:number;load?:number;offset?:number;seedMetric?:number}
export interface EigrpAdvertisement {network:string;prefix:number;vector:EigrpVector;external?:boolean;origin:string;path:string[];hopCount:number;nextHop?:string;tag?:number;candidateDefault?:boolean;redistributionHistory?:string[]}
export interface EigrpUpdatePeer {key:string;protocol:EigrpFamily;deviceId:string;peerDeviceId:string;interface:string;source:string;destination:string;vrf?:string;asn:number;localEpoch:string;remoteEpoch:string;runtime:Device['runtime']}
type Change={network:string;prefix:number;withdraw?:boolean;route?:EigrpAdvertisement};
type Pending={sequence:number;init:boolean;snapshotStart:boolean;changes:Change[];attempts:number;timer?:any;endOfTable:boolean};
type Peer={config:EigrpUpdatePeer;desired:Map<string,EigrpAdvertisement>;acknowledged:Map<string,EigrpAdvertisement>;received:Map<string,EigrpAdvertisement>;stream:number;receivedStream?:number;snapshotNeeded:boolean;sequence:number;receivedSequence:number;initialized:boolean;remoteInitialized:boolean;pending?:Pending;sendTimer?:any;reset:()=>void};
type Context={peers:Map<string,Peer>;epochs:Map<string,{runtime:Device['runtime'];signature:string;value:string}>;floors:Map<string,{stream:number;sequence:number}>;serial:number};
const contexts=new WeakMap<object,Context>();
function context(engine:ControlPlaneHost):Context{let c=contexts.get(engine);if(!c){c={peers:new Map(),epochs:new Map(),floors:new Map(),serial:0};contexts.set(engine,c);}return c;}
const routeKey=(r:{network:string;prefix:number})=>`${r.network}/${r.prefix}`;
const copy=<T>(v:T):T=>structuredClone(v);
function traffic(engine:ControlPlaneHost,p:EigrpUpdatePeer,direction:string,type:string){const d=engine.getDevice(p.deviceId);if(!d)return;const scoped=d.runtime.features[p.protocol+'TrafficByVrf']??={};for(const s of[d.runtime.features[p.protocol+'Traffic']??={},scoped[p.vrf??'']??={}]){s[direction]??={};s[direction][type]=(s[direction][type]??0)+1;}}
export function eigrpUpdateEpoch(engine:ControlPlaneHost,key:string,runtime:Device['runtime'],signature:string):string{const c=context(engine),old=c.epochs.get(key);if(old?.runtime===runtime&&old.signature===signature)return old.value;const value=String(++c.serial);c.epochs.set(key,{runtime,signature,value});return value;}
export function invalidateEigrpUpdateEpoch(engine:ControlPlaneHost,key:string):void{const c=context(engine),old=c.epochs.get(key);if(old)old.value=String(++c.serial);}
function live(engine:ControlPlaneHost,p:Peer):boolean{return context(engine).peers.get(p.config.key)===p&&engine.getDevice(p.config.deviceId)?.runtime===p.config.runtime&&engine.interfaceUp(p.config.deviceId,p.config.interface);}
function transmit(engine:ControlPlaneHost,p:Peer,body:any):void{const c=p.config;traffic(engine,c,'sent',body.operation==='ACK'?'ack':'update');engine.sendControlDatagram?.(c.deviceId,c.source,c.destination,0,{protocol:'eigrp-update',family:c.protocol,asn:c.asn,sender:c.deviceId,session:c.localEpoch,stream:p.stream,...body},{interface:c.interface,vrf:c.vrf,ttl:1,protocol:'eigrp'});}
function publish(engine:ControlPlaneHost):void{for(const d of engine.lab.devices)for(const family of['eigrp','eigrp6'])d.runtime.features[family+'Updates']=[...context(engine).peers.values()].filter(p=>p.config.deviceId===d.id&&p.config.protocol===family).map(p=>({interface:p.config.interface,vrf:p.config.vrf,address:p.config.destination,initialized:p.initialized,remoteInitialized:p.remoteInitialized,sentSequence:p.sequence,receivedSequence:p.receivedSequence,pendingSequence:p.pending?.sequence,retries:Math.max(0,(p.pending?.attempts??1)-1),receivedPrefixes:p.received.size,acknowledgedPrefixes:p.acknowledged.size}));}
function differences(p:Peer):Change[]{return [...p.acknowledged.values()].filter(r=>!p.desired.has(routeKey(r))).map(r=>({network:r.network,prefix:r.prefix,withdraw:true} as Change)).concat([...p.desired.values()].filter(r=>JSON.stringify(p.acknowledged.get(routeKey(r)))!==JSON.stringify(r)).map(route=>({network:route.network,prefix:route.prefix,route})));}
function pump(engine:ControlPlaneHost,p:Peer):void{
  if(!live(engine,p)||p.pending)return;const all=p.initialized?differences(p):[],changes:Change[]=[];let bytes=0;
  for(const change of all){const size=new TextEncoder().encode(JSON.stringify(change)).length;if(changes.length&&bytes+size>750)break;changes.push(copy(change));bytes+=size;}
  if(p.initialized&&!changes.length&&!p.snapshotNeeded)return;
  const pending:Pending={sequence:++p.sequence,init:!p.initialized,snapshotStart:p.initialized&&p.snapshotNeeded,changes,attempts:0,endOfTable:p.initialized&&changes.length===all.length};p.snapshotNeeded=false;p.pending=pending;
  const send=()=>{if(!live(engine,p)||p.pending!==pending)return;pending.attempts++;transmit(engine,p,{operation:'UPDATE',sequence:pending.sequence,init:pending.init,snapshotStart:pending.snapshotStart,endOfTable:pending.endOfTable,changes:pending.changes});pending.timer=engine.clock.schedule(500,()=>{if(!live(engine,p)||p.pending!==pending)return;if(pending.attempts>=16){engine.clock.cancel(p.sendTimer);context(engine).peers.delete(p.config.key);publish(engine);p.reset();}else send();},{owner:p.config.deviceId,label:'EIGRP UPDATE reliable retry'});publish(engine);};send();
}
function schedule(engine:ControlPlaneHost,p:Peer):void{if(p.pending||p.sendTimer&&!p.sendTimer.canceled)return;p.sendTimer=engine.clock.schedule(0,()=>{p.sendTimer=undefined;pump(engine,p);},{owner:p.config.deviceId,label:'EIGRP triggered UPDATE'});}
export function synchronizeEigrpUpdatePeers(engine:ControlPlaneHost,protocol:EigrpFamily,peers:EigrpUpdatePeer[],reset:(peer:EigrpUpdatePeer)=>void):void{
  const c=context(engine),wanted=new Set(peers.map(p=>p.key));
  for(const[key,p]of c.peers)if(p.config.protocol===protocol&&!wanted.has(key)){engine.clock.cancel(p.pending?.timer);engine.clock.cancel(p.sendTimer);c.peers.delete(key);}
  for(const cfg of peers){const old=c.peers.get(cfg.key),same=old&&old.config.runtime===cfg.runtime&&old.config.localEpoch===cfg.localEpoch&&old.config.remoteEpoch===cfg.remoteEpoch&&old.config.asn===cfg.asn;
    if(same){old.config=cfg;continue;}if(old){engine.clock.cancel(old.pending?.timer);engine.clock.cancel(old.sendTimer);}
    c.peers.set(cfg.key,{config:cfg,desired:new Map(),acknowledged:new Map(),received:new Map(),stream:++c.serial,snapshotNeeded:true,sequence:0,receivedSequence:0,initialized:false,remoteInitialized:false,reset:()=>reset(cfg)});
  }publish(engine);
}
export function advertiseEigrpUpdates(engine:ControlPlaneHost,protocol:EigrpFamily,routes:(peer:EigrpUpdatePeer)=>EigrpAdvertisement[]):void{for(const p of context(engine).peers.values())if(p.config.protocol===protocol){p.desired=new Map(routes(p.config).map(r=>[routeKey(r),copy(r)]));schedule(engine,p);}}
export function receivedEigrpUpdates(engine:ControlPlaneHost,key:string):EigrpAdvertisement[]{return [...context(engine).peers.get(key)?.received.values()??[]].map(copy);}
export function eigrpUpdateReady(engine:ControlPlaneHost,key:string):boolean{const p=context(engine).peers.get(key);return !!p?.initialized&&p.remoteInitialized;}
function validChange(change:any,family:EigrpFamily):boolean{
  try{const n=parseCidr(`${change.network}/${change.prefix}`);if(n.network!==change.network||n.family!==(family==='eigrp'?4:6))return false;}catch{return false;}
  if(change.withdraw===true)return !change.route;const r=change.route,v=r?.vector;
  return !!r&&r.network===change.network&&r.prefix===change.prefix&&typeof r.origin==='string'&&Array.isArray(r.path)&&r.path.length<=128&&r.path.every((s:any)=>typeof s==='string')&&Number.isInteger(r.hopCount)&&r.hopCount>=0&&r.hopCount<=255&&!!v&&Number.isFinite(v.bandwidth)&&v.bandwidth>0&&Number.isFinite(v.delay)&&v.delay>=0&&['offset','seedMetric','reliability','load','wideLatency'].every(k=>v[k]===undefined||Number.isFinite(v[k])&&v[k]>=0);
}
export function receiveEigrpUpdate(engine:ControlPlaneHost,deviceId:string,source:string,destination:string,body:any,ttl:number,input?:string,heard?:(peer:EigrpUpdatePeer)=>void):boolean{
  if(body?.protocol!=='eigrp-update')return false;
  const p=[...context(engine).peers.values()].find(p=>p.config.deviceId===deviceId&&p.config.protocol===body.family&&(!input||p.config.interface===input)&&sameAddress(p.config.destination,source)&&sameAddress(p.config.source,destination)&&p.config.peerDeviceId===body.sender&&p.config.asn===body.asn&&p.config.remoteEpoch===body.session);if(!p||!live(engine,p)||ttl!==1)return true;
  traffic(engine,p.config,'received',body.operation==='ACK'?'ack':'update');
  if(body.operation==='ACK'){const pending=p.pending;if(!pending||body.ackSession!==p.config.localEpoch||body.ackStream!==p.stream||body.sequence!==pending.sequence)return true;heard?.(p.config);engine.clock.cancel(pending.timer);if(pending.init){p.initialized=true;p.snapshotNeeded=true;}if(!p.snapshotNeeded)for(const change of pending.changes){if(change.withdraw)p.acknowledged.delete(routeKey(change));else p.acknowledged.set(routeKey(change),copy(change.route!));}p.pending=undefined;schedule(engine,p);publish(engine);if(pending.init){engine.recompute();engine.notify();}return true;}
  if(body.operation!=='UPDATE'||!Number.isSafeInteger(body.sequence)||body.sequence<1||!Array.isArray(body.changes)||body.changes.length>256||!body.changes.every((change:any)=>validChange(change,p.config.protocol)))return true;
  if(!Number.isSafeInteger(body.stream)||body.stream<1)return true;const c=context(engine),floor=c.floors.get(p.config.key),ack=()=>transmit(engine,p,{operation:'ACK',sequence:body.sequence,ackSession:body.session,ackStream:body.stream});
  if(floor&&(body.stream<floor.stream||body.stream===floor.stream&&body.sequence<=floor.sequence)){if(body.stream===floor.stream)heard?.(p.config);ack();return true;}
  if(body.init){if(body.sequence!==1||body.changes.length)return true;p.received.clear();p.receivedSequence=0;p.receivedStream=body.stream;p.remoteInitialized=true;p.acknowledged.clear();p.snapshotNeeded=true;
    // A restarted receiver cannot ACK an old in-flight delta. Retire that
    // transaction and start a full snapshot at a newer sequence; retain our
    // INIT until its ACK when both directions are initializing together.
    if(p.pending&&!p.pending.init){engine.clock.cancel(p.pending.timer);p.pending=undefined;}schedule(engine,p);}
  else if(body.snapshotStart){if(p.receivedStream!==undefined&&p.receivedStream!==body.stream)return true;p.received.clear();p.receivedStream=body.stream;p.receivedSequence=body.sequence-1;p.remoteInitialized=true;}
  if(!p.remoteInitialized||p.receivedStream!==body.stream||body.sequence!==p.receivedSequence+1)return true;
  heard?.(p.config);
  for(const change of body.changes as Change[]){if(change.withdraw)p.received.delete(routeKey(change));else p.received.set(routeKey(change),copy(change.route!));}p.receivedSequence=body.sequence;c.floors.set(p.config.key,{stream:body.stream,sequence:body.sequence});
  ack();publish(engine);if(body.changes.length||body.init||body.snapshotStart){engine.recompute();engine.notify();}return true;
}
