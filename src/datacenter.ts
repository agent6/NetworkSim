import type {Device, DeviceConfig, InterfaceConfig} from './model.ts';
import type {ControlPlaneHost} from './control-plane.ts';
import type {TimerHandle,SimulationClock} from './clock.ts';
import {isIPv4, sameAddress} from './ip.ts';
import {learnMac} from './mac-table.ts';
import {stpRegion} from './stp-ports.ts';

export interface VPCKeepalive {
  destination:string; source?:string; vrf:string;
  interval:number; timeout:number; holdTimeout:number;
}
export interface VPCConfig {
  domain:number; rolePriority:number; systemPriority:number; systemMac?:string;
  peerLink?:string; keepalive?:VPCKeepalive;
  peerSwitch:boolean; peerGateway:boolean; arpSynchronize:boolean;
  autoRecovery:boolean; reloadDelay:number; delayRestore:number; delayRestoreSVI:number;
  gracefulConsistency:boolean;
}
export interface NSOSConfig {enabled:string[]; vpc?:VPCConfig}
export interface VPCConsistency {
  name:string; type:1|2; local:string; peer:string; vpc?:number; vlan?:number;
}
export interface VPCMember {
  port:string; peerPort?:string; up:boolean; suspended:boolean; reason:string;
  activeVlans:number[]; suspendedVlans:number[]; peerUp:boolean;
}
export interface VPCRuntime {
  peerId?:string; peerHostname?:string; peerAlive:boolean; adjacency:boolean;
  role:'primary'|'secondary'; configuredRole:'primary'|'secondary';
  state:string; reason:string; systemMac:string; peerLinkUp:boolean;
  consistency:VPCConsistency[]; members:Record<number,VPCMember>;
  rxKeepalives:number; txKeepalives:number; lastKeepalive?:number;
  dualActive:boolean; restoreUntil?:number; autoRecoveryUntil?:number;
  sviRestoreUntil?:number;
}
type MemberSnapshot = {
  id:number; port:string; up:boolean; mode:string; nativeVlan:number;
  vlans:number[]; mtu:number; protocol:string; forwarding:boolean; activeVlans:number[];
};
type TreeSnapshot = {rootId:string; rootBridgeId:string; bridgeId:string; cost:number; priority:number; rootPort?:string; protections?:Record<string,string>};
type PeerSnapshot = {
  protocol:'VPC-CFS'; sender:string; hostname:string; generation:number; sequence:number;
  domain:number; rolePriority:number; systemPriority:number; systemMac:string;
  localMac:string; survived:boolean; peerSwitch:boolean; peerGateway:boolean;
  stpMode:string; mst:string; bridgeAssurance:boolean; nativeTag:boolean;
  members:MemberSnapshot[]; peerVlans:number[];
  trees:Record<string,TreeSnapshot>;
  macs:{mac:string; vlan:number; port:string; vpc?:number; age:number; seen:number}[];
  arp:{ip:string; mac:string; port:string; vrf?:string; age:number}[];
  gateways:Record<string,string>;
  seen?:{sender:string;generation:number;age:number};
};
type Session = {
  runtime:Device['runtime']; configSignature:string; created:number; generation:number;
  timer?:TimerHandle; peer?:PeerSnapshot; received?:number; keepalive?:number;
  deadline?:TimerHandle; deadlineAt?:number; keepaliveSender?:string;
  peerGeneration?:number; keepaliveSequence:number; txSequence:number;
  sentKeepalive:number; sentCFS:number; everAdjacent:boolean; survived:boolean;
  suspended:boolean; lostAt?:number; restoring?:number; wasAdjacent:boolean;
  role?:'primary'|'secondary'; sviRestoring?:number;
  remoteMacs:Set<string>; remoteArp:Set<string>; logSignature?:string;
  clock:SimulationClock;
};
const sessions = new WeakMap<ControlPlaneHost,Map<string,Session>>();
let generation = 0;
export const NSOS_FEATURES = ['vpc','lacp','interface-vlan','ospf','lldp','vtp','ssh'] as const;
export function isDatacenter(d:Device):boolean {return d.kind === 'datacenter';}
export function nsosConfig(d:Device):NSOSConfig {
  if(!isDatacenter(d))return {enabled:[]};
  return d.config.features.nsos ??= {enabled:[]};
}
export function nsosFeature(d:Device,name:string):boolean {return isDatacenter(d)&&!!d.config.features.nsos?.enabled?.includes(name);}
export function vpcRuntime(d:Device):VPCRuntime|undefined {return d.runtime.features.vpc;}
export function defaultVPC(domain:number):VPCConfig {
  return {domain,rolePriority:32768,systemPriority:32667,peerSwitch:false,peerGateway:false,arpSynchronize:false,autoRecovery:false,reloadDelay:240000,delayRestore:30000,delayRestoreSVI:0,gracefulConsistency:true};
}
export function vpcMemberId(d:Device,port:string):number|undefined {
  const p=d.config.interfaces[port],logical=p?.features.channelGroup?'Port-channel'+p.features.channelGroup:port;
  return d.config.interfaces[logical]?.features.vpcId;
}
export function vpcLogicalPort(d:Device,port:string):string {
  const group=d.config.interfaces[port]?.features.channelGroup;return group?'Port-channel'+group:port;
}
export function vpcPeerLink(d:Device,port:string):boolean {
  return isDatacenter(d)&&nsosFeature(d,'vpc')&&nsosConfig(d).vpc?.peerLink===vpcLogicalPort(d,port);
}
function normalizedMac(mac:string):string {return mac.replace(/[:.]/g,'').toLowerCase();}
function keepaliveVRF(vrf:string|undefined):string|undefined {return vrf==='default'?undefined:vrf;}
const stpProtectionRoles=new Set(['root-inconsistent','loop-inconsistent','bpdu-inconsistent','bridge-assurance-inconsistent']);
export function datacenterBridgeMac(d:Device):string {
  if(d.config.features.bridgeMac)return normalizedMac(String(d.config.features.bridgeMac));
  let hash=2166136261;for(const c of d.id)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return '0200'+(hash>>>0).toString(16).padStart(8,'0');
}
function systemMac(d:Device,c:VPCConfig):string {return c.systemMac?normalizedMac(c.systemMac):'02234cee'+c.domain.toString(16).padStart(4,'0');}
export function vpcActor(d:Device,port:string):{systemMac:string;systemPriority:number;key:number}|undefined {
  const c=nsosConfig(d).vpc,id=vpcMemberId(d,port);
  return nsosFeature(d,'vpc')&&c&&id?{systemMac:systemMac(d,c),systemPriority:c.systemPriority,key:id}:undefined;
}
export function vpcAggregationSuspended(d:Device,port:string):boolean {
  // Carrier loss is not policy suspension: back-to-back vPCs must negotiate their bundles before either can forward.
  const id=vpcMemberId(d,port);return id===undefined?!!vpcPortReason(d,port):vpcRuntime(d)?.members[id]?.suspended??true;
}
function mapFor(e:ControlPlaneHost):Map<string,Session> {
  let map=sessions.get(e);if(!map){map=new Map();sessions.set(e,map);}return map;
}
function vlans(d:Device,p:InterfaceConfig|undefined):number[] {
  if(!p?.switchport)return [];
  return Object.values(d.config.vlans).filter(v=>v.active&&(p.mode==='trunk'?p.allowedVlans===null||p.allowedVlans.includes(v.id):p.vlan===v.id)).map(v=>v.id).sort((a,b)=>a-b);
}
function aggregateUp(d:Device,port:string|undefined):boolean {
  if(!port||!d.config.interfaces[port]?.adminUp)return false;
  const c=d.runtime.features.portChannels?.[port.slice(12)];
  return !!c&&c.state==='up'&&c.activeMembers.length>0;
}
function memberSnapshot(d:Device):MemberSnapshot[] {
  return Object.values(d.config.interfaces).filter(p=>/^Port-channel/.test(p.name)&&p.features.vpcId).map(p=>({
    id:p.features.vpcId,port:p.name,up:aggregateUp(d,p.name),mode:p.switchport?p.mode:'routed',
    nativeVlan:p.nativeVlan,vlans:vlans(d,p),mtu:p.mtu,
    protocol:d.runtime.features.portChannels?.[p.name.slice(12)]?.protocol??'none',
    forwarding:!!vpcRuntime(d)?.members[p.features.vpcId]?.up,
    activeVlans:vpcRuntime(d)?.members[p.features.vpcId]?.activeVlans??[],
  }));
}
function snapshot(e:ControlPlaneHost,d:Device,c:VPCConfig,s:Session):PeerSnapshot {
  const now=e.clock.now(),trees:Record<string,TreeSnapshot>={};
  for(const [v,t]of Object.entries(d.runtime.stp)){
    const protections:Record<string,string>={};
    for(const [port,p]of Object.entries(t.ports)){
      const member=vpcMemberId(d,port);
      if(member&&stpProtectionRoles.has(p.localProtection))protections[member]=p.localProtection;
    }
    trees[v]={rootId:t.rootId,rootBridgeId:t.rootBridgeId,bridgeId:t.bridgeId,cost:t.cost,priority:Number(t.bridgeId.split('.')[0]),rootPort:t.rootPort,protections};
  }
  return {protocol:'VPC-CFS',sender:d.id,hostname:d.config.hostname,generation:s.generation,sequence:++s.txSequence,
    domain:c.domain,rolePriority:c.rolePriority,systemPriority:c.systemPriority,systemMac:systemMac(d,c),localMac:datacenterBridgeMac(d),survived:s.survived,
    peerSwitch:c.peerSwitch,peerGateway:c.peerGateway,stpMode:d.config.features.stp?.mode??'rapid-pvst',
    mst:stpRegion(d),bridgeAssurance:d.config.features.stp?.bridgeAssurance!==false,nativeTag:!!d.config.features.tagNative,
    members:memberSnapshot(d),peerVlans:vlans(d,c.peerLink?d.config.interfaces[c.peerLink]:undefined),trees,
    macs:Object.entries(d.runtime.mac).filter(([key,r])=>!r.static&&!s.remoteMacs.has(key)&&r.expires>now&&!vpcPeerLink(d,r.port)).slice(0,32000).map(([,r])=>({mac:r.mac,vlan:r.vlan,port:r.port,vpc:vpcMemberId(d,r.port),age:r.expires-now,seen:r.lastSeen??0})),
    arp:c.arpSynchronize?Object.entries(d.runtime.arp).filter(([key,r])=>!r.static&&!s.remoteArp.has(key)&&r.expires>now&&/^Vlan/.test(r.port)).slice(0,32000).map(([,r])=>({ip:r.ip,mac:r.mac,port:r.port,vrf:r.vrf,age:r.expires-now})):[],
    gateways:Object.fromEntries(Object.keys(d.config.interfaces).filter(p=>/^Vlan/.test(p)).flatMap(p=>e.macOf?[[p,e.macOf(d.id,p)]]:[])),
    seen:s.peer&&s.received!==undefined?{sender:s.peer.sender,generation:s.peer.generation,age:now-s.received}:undefined,
  };
}
function logState(e:ControlPlaneHost,d:Device,r:VPCRuntime,s:Session):void {
  const signature=JSON.stringify([r.state,r.reason,r.role,r.dualActive,r.consistency,r.members]);
  if(signature===s.logSignature)return;s.logSignature=signature;
  e.log?.(d.id,'%VPC-'+(r.adjacency&&!r.consistency.length?'5':'3')+'-STATE: '+r.state+'; '+r.reason, r.adjacency&&!r.consistency.length?5:3);
  e.emit({nodeId:d.id,peerId:r.peerId,protocol:'vPC',label:r.state,detail:r.reason,disposition:r.adjacency&&!r.consistency.length?'info':'warning'});
}
function compareConfig(d:Device,c:VPCConfig,peer:PeerSnapshot):VPCConsistency[] {
  const rows:VPCConsistency[]=[];
  const check=(name:string,local:unknown,remote:unknown,type:1|2=1,vpc?:number,vlan?:number)=>{
    if(JSON.stringify(local)!==JSON.stringify(remote))rows.push({name,type,local:String(local),peer:String(remote),vpc,vlan});
  };
  check('vPC system priority',c.systemPriority,peer.systemPriority);
  check('vPC system MAC',systemMac(d,c),peer.systemMac);
  check('Spanning tree mode',d.config.features.stp?.mode??'rapid-pvst',peer.stpMode);
  if(peer.stpMode==='mst')check('MST region',stpRegion(d),peer.mst);
  check('Bridge Assurance',d.config.features.stp?.bridgeAssurance!==false,peer.bridgeAssurance);
  check('Native VLAN tagging',!!d.config.features.tagNative,peer.nativeTag);
  check('Peer-switch',c.peerSwitch,peer.peerSwitch);
  check('Peer-gateway',c.peerGateway,peer.peerGateway,2);
  for(const local of memberSnapshot(d)){
    const remote=peer.members.find(m=>m.id===local.id);
    if(!remote){rows.push({name:'vPC missing on peer',type:1,local:local.port,peer:'not configured',vpc:local.id});continue;}
    check('Port mode',local.mode,remote.mode,1,local.id);check('Native VLAN',local.nativeVlan,remote.nativeVlan,1,local.id);check('MTU',local.mtu,remote.mtu,1,local.id);check('Aggregation protocol',local.protocol,remote.protocol,1,local.id);
    for(const vlan of new Set([...local.vlans,...remote.vlans]))if(local.vlans.includes(vlan)!==remote.vlans.includes(vlan)||!peer.peerVlans.includes(vlan)||!vlans(d,c.peerLink?d.config.interfaces[c.peerLink]:undefined).includes(vlan))rows.push({name:'VLAN availability/allowed list',type:1,local:String(local.vlans.includes(vlan)),peer:String(remote.vlans.includes(vlan)),vpc:local.id,vlan});
  }
  if(c.peerSwitch)for(const[v,t]of Object.entries(peer.trees))check('Peer-switch STP priority',Number(d.runtime.stp[v]?.bridgeId.split('.')[0]),t.priority,1,undefined,Number(v));
  return rows;
}
function elect(d:Device,c:VPCConfig,peer:PeerSnapshot):'primary'|'secondary' {
  return c.rolePriority<peer.rolePriority||c.rolePriority===peer.rolePriority&&datacenterBridgeMac(d)<peer.localMac?'primary':'secondary';
}
function purgeRemote(d:Device,s:Session):void {
  for(const key of s.remoteMacs)if(!d.runtime.mac[key]?.static)delete d.runtime.mac[key];
  for(const key of s.remoteArp)if(!d.runtime.arp[key]?.static)delete d.runtime.arp[key];
  s.remoteMacs.clear();s.remoteArp.clear();
}
function synchronizeTables(e:ControlPlaneHost,d:Device,c:VPCConfig,s:Session,r:VPCRuntime):void {
  if(!r.adjacency||!s.peer||!c.peerLink){purgeRemote(d,s);return;}
  const now=e.clock.now(),next=new Set<string>();
  for(const row of s.peer.macs){
    if(!d.config.vlans[row.vlan]?.active||!vlans(d,d.config.interfaces[c.peerLink]).includes(row.vlan))continue;
    const key=row.vlan+'|'+row.mac,old=d.runtime.mac[key],member=row.vpc?r.members[row.vpc]:undefined;
    const port=member?.up&&member.activeVlans.includes(row.vlan)?member.port:c.peerLink;
    if(old?.static)continue;
    if(!old||s.remoteMacs.has(key)||vpcPeerLink(d,old.port)||row.seen>(old.lastSeen??-1)){
      learnMac(d,port,row.vlan,row.mac,now);
      const installed=d.runtime.mac[key];if(installed){installed.lastSeen=row.seen;installed.expires=(s.received??now)+Math.min(row.age,300000);next.add(key);}
    }
  }
  for(const key of s.remoteMacs)if(!next.has(key)&&!d.runtime.mac[key]?.static)delete d.runtime.mac[key];
  s.remoteMacs=next;
  const nextArp=new Set<string>();
  if(c.arpSynchronize)for(const row of s.peer.arp){
    const p=d.config.interfaces[row.port];if(!p||p.vrf!==row.vrf)continue;
    const key=row.port+'|'+row.ip;
    if(d.runtime.arp[key]?.static)continue;
    if(!d.runtime.arp[key]||s.remoteArp.has(key)){d.runtime.arp[key]={...row,expires:(s.received??now)+Math.min(row.age,300000)};nextArp.add(key);}
  }
  for(const key of s.remoteArp)if(!nextArp.has(key)&&!d.runtime.arp[key]?.static)delete d.runtime.arp[key];s.remoteArp=nextArp;
}
function update(e:ControlPlaneHost,d:Device,c:VPCConfig,s:Session):void {
  const now=e.clock.now(),old=vpcRuntime(d),peer=s.peer;
  const alive=s.keepalive!==undefined&&now-s.keepalive<(c.keepalive?.timeout??5000)&&(!peer||s.keepaliveSender===peer.sender);
  const rawLink=aggregateUp(d,c.peerLink),ba=!!c.peerLink&&Object.values(d.runtime.stp).some(t=>t.ports[c.peerLink!]?.role==='bridge-assurance-inconsistent');
  const link=rawLink&&!ba&&s.received!==undefined&&now-s.received<3000;
  const reciprocal=peer?.seen?.sender===d.id&&peer.seen.generation===s.generation&&s.received!==undefined&&peer.seen.age+now-s.received<3000;
  const adjacency=!!peer&&peer.domain===c.domain&&link&&reciprocal&&(alive||s.everAdjacent);
  const configured=peer?elect(d,c,peer):'primary';
  let role=s.role??configured;
  if(peer&&(s.survived!==peer.survived))role=s.survived?'primary':'secondary';
  if(adjacency&&!s.wasAdjacent&&s.survived&&peer?.survived)role=configured;
  if(adjacency){
    if(!s.wasAdjacent){s.restoring=now+c.delayRestore;s.sviRestoring=now+c.delayRestoreSVI;}
    s.everAdjacent=true;s.lostAt=undefined;s.suspended=false;
  }else if(s.wasAdjacent){s.lostAt=now;s.restoring=undefined;}
  if(!adjacency&&s.everAdjacent){
    const lost=s.lostAt??now,hold=c.keepalive?.holdTimeout??3000,timeout=c.keepalive?.timeout??5000;
    if(role==='secondary'&&!s.survived){
      if(now>=lost+hold&&s.keepalive!==undefined&&s.keepalive>=lost+hold)s.suspended=true;
      if(!alive&&now>=lost+hold+timeout&&(!s.suspended||c.autoRecovery)){s.survived=true;s.suspended=false;role='primary';}
    }else if(!alive&&now>=lost+hold+timeout){s.survived=true;role='primary';}
  }
  const autoAt=s.created+c.reloadDelay,solo=c.autoRecovery&&!s.everAdjacent&&!alive&&now>=autoAt;
  if(solo){role='primary';s.survived=true;}
  const restoring=adjacency&&s.restoring!==undefined&&now<s.restoring;
  const rows=peer&&adjacency?compareConfig(d,c,peer):[];
  const allowed=adjacency||solo||s.everAdjacent&&!s.suspended;
  let reason=adjacency?'Peer adjacency formed; configuration checked':solo?'Auto-recovery reload delay expired':!s.everAdjacent?'Waiting for peer-link and peer-keepalive adjacency':s.suspended?'Peer-link failed; peer is alive; secondary vPCs suspended':alive?'Peer-link unavailable; evaluating peer liveness':'Peer-link and peer-keepalive unavailable';
  if(restoring)reason='Delay-restore timer running';
  const r:VPCRuntime={peerId:peer?.sender,peerHostname:peer?.hostname,peerAlive:alive,adjacency,role,configuredRole:configured,state:adjacency?'peer adjacency formed':solo?'auto-recovery':s.suspended?'secondary suspended':!s.everAdjacent?'initializing':'peer adjacency lost',reason,systemMac:systemMac(d,c),peerLinkUp:rawLink,consistency:rows,members:{},rxKeepalives:old?.rxKeepalives??0,txKeepalives:old?.txKeepalives??0,lastKeepalive:s.keepalive,dualActive:!adjacency&&!alive&&s.everAdjacent&&!s.suspended,restoreUntil:restoring?s.restoring:undefined,autoRecoveryUntil:c.autoRecovery&&!s.everAdjacent&&!solo?autoAt:undefined};
  for(const local of memberSnapshot(d)){
    const remote=peer?.members.find(m=>m.id===local.id);
    const mismatches=rows.filter(row=>row.type===1&&(row.vpc===undefined||row.vpc===local.id));
    const fatal=mismatches.some(row=>row.vlan===undefined&&(row.name==='vPC missing on peer'||!c.gracefulConsistency||role==='secondary'));
    const suspended=[...new Set(mismatches.flatMap(row=>row.vlan===undefined?[]:[row.vlan]))].sort((a,b)=>a-b);
    const why=!allowed?reason:restoring?'Delay-restore timer running':fatal?'Type-1 configuration inconsistency':!local.up?'Local port-channel down':'success';
    r.members[local.id]={port:local.port,peerPort:remote?.port,up:allowed&&!restoring&&!fatal&&local.up,suspended:!allowed||restoring||fatal,reason:why,peerUp:!!remote?.forwarding&&adjacency,activeVlans:allowed&&!restoring&&!fatal&&local.up?local.vlans.filter(v=>!suspended.includes(v)):[],suspendedVlans:suspended};
  }
  r.sviRestoreUntil=s.sviRestoring!==undefined&&now<s.sviRestoring?s.sviRestoring:undefined;
  d.runtime.features.vpc=r;s.wasAdjacent=adjacency;if(adjacency||s.survived)s.role=role;
  synchronizeTables(e,d,c,s,r);logState(e,d,r,s);
  const deadlines=[
    s.keepalive!==undefined?s.keepalive+(c.keepalive?.timeout??5000):undefined,
    s.received!==undefined?s.received+3000:undefined,
    s.received!==undefined&&peer?.seen?s.received+3000-peer.seen.age:undefined,
    s.lostAt!==undefined?s.lostAt+(c.keepalive?.holdTimeout??3000):undefined,
    s.lostAt!==undefined?s.lostAt+(c.keepalive?.holdTimeout??3000)+(c.keepalive?.timeout??5000):undefined,
    r.restoreUntil,r.sviRestoreUntil,r.autoRecoveryUntil,
  ].filter((at):at is number=>at!==undefined&&at>now);
  const next=deadlines.length?Math.min(...deadlines):undefined;
  if(s.deadlineAt!==next){
    s.clock.cancel(s.deadline);s.deadline=undefined;s.deadlineAt=next;
    if(next!==undefined)s.deadline=e.clock.schedule(next-now,()=>{s.deadlineAt=undefined;if(mapFor(e).get(d.id)===s&&d.runtime===s.runtime){e.recompute();e.notify();}},{owner:d.id,label:'vPC state deadline'});
  }
}
function tick(e:ControlPlaneHost,d:Device,s:Session):void {
  if(d.runtime!==s.runtime||!d.powered||!nsosFeature(d,'vpc'))return;
  const c=nsosConfig(d).vpc;if(!c)return;const now=e.clock.now();
  if(c.keepalive&&now-s.sentKeepalive>=c.keepalive.interval){
    const k=c.keepalive,vrf=keepaliveVRF(k.vrf),source=k.source??Object.values(d.config.interfaces).find(p=>keepaliveVRF(p.vrf)===vrf&&p.ip&&e.interfaceUp(d.id,p.name))?.ip;
    if(source&&Object.values(d.config.interfaces).some(p=>keepaliveVRF(p.vrf)===vrf&&(p.ip===source||p.name===source)&&e.interfaceUp(d.id,p.name))){
      const ip=d.config.interfaces[source]?.ip??source;
      e.sendControlDatagram?.(d.id,ip,k.destination,3200,{protocol:'vpc-keepalive',sender:d.id,domain:c.domain,generation:s.generation,sequence:++s.txSequence},{vrf});
      const r=vpcRuntime(d);if(r)r.txKeepalives++;
    }
    s.sentKeepalive=now;
  }
  if(aggregateUp(d,c.peerLink)&&now-s.sentCFS>=1000){
    const members:string[]=d.runtime.features.portChannels?.[c.peerLink!.slice(12)]?.activeMembers??[];
    const port=members.find(p=>e.interfaceUp(d.id,p));
    if(port)e.sendLinkControl?.(d.id,port,{kind:'link-control',protocol:'VPC-CFS',body:snapshot(e,d,c,s)});
    s.sentCFS=now;
  }
  e.recompute();e.notify();
}
export function syncVPC(e:ControlPlaneHost):void {
  const map=mapFor(e),wanted=new Set<string>();
  for(const d of e.lab.devices){
    const c=isDatacenter(d)&&nsosFeature(d,'vpc')?nsosConfig(d).vpc:undefined;
    if(!c||!d.powered){delete d.runtime.features.vpc;continue;}
    wanted.add(d.id);const signature=JSON.stringify([c.domain,c.peerLink,c.keepalive,c.systemMac]),old=map.get(d.id);
    let s=old;
    if(!s||s.runtime!==d.runtime||s.configSignature!==signature){
      if(s){s.clock.cancel(s.timer);s.clock.cancel(s.deadline);if(s.runtime===d.runtime)purgeRemote(d,s);}
      delete d.runtime.features.vpc;
      s={runtime:d.runtime,clock:e.clock,configSignature:signature,created:e.clock.now(),generation:++generation,keepaliveSequence:0,txSequence:0,sentKeepalive:-Infinity,sentCFS:-Infinity,everAdjacent:false,survived:false,suspended:false,wasAdjacent:false,remoteMacs:new Set(),remoteArp:new Set()};
      map.set(d.id,s);const current=s;s.timer=e.clock.schedule(0,()=>tick(e,d,current),{owner:d.id,repeat:Math.min(1000,c.keepalive?.interval??1000),label:'vPC keepalive / peer state'});
    }
    update(e,d,c,s);
  }
  for(const[id,s]of map)if(!wanted.has(id)){s.clock.cancel(s.timer);s.clock.cancel(s.deadline);const d=e.getDevice(id);if(d&&s.runtime===d.runtime)purgeRemote(d,s);map.delete(id);}
}
export function receiveVPCKeepalive(e:ControlPlaneHost,d:Device,source:string,destination:string,body:unknown,input?:string):boolean {
  if(!body||typeof body!=='object'||!('protocol'in body)||body.protocol!=='vpc-keepalive')return false;
  const c=nsosConfig(d).vpc,s=mapFor(e).get(d.id),b=body as {sender?:unknown;domain?:unknown;generation?:unknown;sequence?:unknown};
  if(!c?.keepalive||!s||!input||!d.config.interfaces[input]||keepaliveVRF(d.config.interfaces[input].vrf)!==keepaliveVRF(c.keepalive.vrf)||!sameAddress(source,c.keepalive.destination)||c.keepalive.source&&!sameAddress(destination,d.config.interfaces[c.keepalive.source]?.ip??c.keepalive.source)||b.domain!==c.domain||typeof b.sender!=='string'||b.sender===d.id||typeof b.generation!=='number'||typeof b.sequence!=='number')return true;
  if(s.peer&&b.sender!==s.peer.sender)return true;
  if(s.peerGeneration===b.generation&&b.sequence<=s.keepaliveSequence)return true;
  s.peerGeneration=b.generation;s.keepaliveSequence=b.sequence;s.keepaliveSender=b.sender;s.keepalive=e.clock.now();
  const r=vpcRuntime(d);if(r)r.rxKeepalives++;
  e.recompute();e.notify();return true;
}
export function receiveVPCCFS(e:ControlPlaneHost,d:Device,port:string,body:unknown):void {
  const c=nsosConfig(d).vpc,s=mapFor(e).get(d.id);
  if(!c||!s||!vpcPeerLink(d,port)||!body||typeof body!=='object')return;
  const b=body as PeerSnapshot;
  if(b.protocol!=='VPC-CFS'||b.domain!==c.domain||typeof b.sender!=='string'||b.sender===d.id||!Number.isInteger(b.generation)||!Number.isInteger(b.sequence)||!Array.isArray(b.members)||!Array.isArray(b.peerVlans)||!Array.isArray(b.macs)||!Array.isArray(b.arp)||!b.trees||b.members.length>4096||b.macs.length>32000||b.arp.length>32000)return;
  if(s.peer?.generation===b.generation&&s.peer.sender===b.sender&&b.sequence<=s.peer.sequence)return;
  const link=e.lab.links.find(l=>l.enabled&&(l.a.deviceId===d.id&&l.a.port===port||l.b.deviceId===d.id&&l.b.port===port));
  const peer=link&&(link.a.deviceId===d.id?link.b:link.a);if(peer?.deviceId!==b.sender)return;
  s.peer=structuredClone(b);s.received=e.clock.now();e.recompute();e.notify();
}
export function vpcPortReason(d:Device,port:string,vlan?:number):string|undefined {
  if(!isDatacenter(d)||!nsosFeature(d,'vpc'))return;
  const id=vpcMemberId(d,port),r=vpcRuntime(d),c=nsosConfig(d).vpc;
  if(id){const m=r?.members[id];if(!m)return 'vPC peer adjacency has not formed';if(!m.up)return m.reason;if(vlan!==undefined&&!m.activeVlans.includes(vlan))return 'vPC VLAN suspended';}
  if(d.config.interfaces[vpcLogicalPort(d,port)]?.features.vpcOrphanSuspend&&r?.state==='secondary suspended')return 'vPC orphan port suspended';
  if(/^Vlan\d+/.test(port)&&c&&r?.state==='secondary suspended'&&vlans(d,c.peerLink?d.config.interfaces[c.peerLink]:undefined).includes(Number(port.slice(4))))return 'vPC peer-link failed; secondary SVI suspended';
  if(/^Vlan\d+/.test(port)&&r?.sviRestoreUntil!==undefined)return 'vPC SVI delay-restore timer running';
  return;
}
export function vpcEgressAllowed(d:Device,input:string|undefined,output:string,vlan:number):boolean {
  if(vpcPortReason(d,output,vlan))return false;
  if(!input||!vpcPeerLink(d,input)||vpcPeerLink(d,output))return true;
  const id=vpcMemberId(d,output),r=vpcRuntime(d);
  // A peer-link copy must not duplicate a frame already sent on the peer's
  // healthy vPC leg. A failed remote leg is the intentional exception.
  return !id||!r?.adjacency||r.members[id]?.peerUp===false;
}
export function vpcObserveMac(e:ControlPlaneHost,d:Device,port:string,vlan:number,mac:string):void {
  const s=sessions.get(e)?.get(d.id);if(!s)return;
  const key=vlan+'|'+mac.toLowerCase();
  if(vpcPeerLink(d,port))s.remoteMacs.add(key);else s.remoteMacs.delete(key);
}
export function vpcObserveArp(e:ControlPlaneHost,d:Device,port:string,ip:string):void {
  sessions.get(e)?.get(d.id)?.remoteArp.delete(port+'|'+ip);
}
export function vpcIngressAllowed(d:Device,input:string,vlan:number):boolean {
  return !vpcPortReason(d,input,vlan);
}
export function vpcForwardPort(d:Device,port:string,vlan:number):string {
  const id=vpcMemberId(d,port),r=vpcRuntime(d),c=nsosConfig(d).vpc;
  if(id&&c?.peerLink&&r?.adjacency&&(!r.members[id]?.up||!r.members[id]?.activeVlans.includes(vlan))&&r.members[id]?.peerUp)return c.peerLink;
  return port;
}
export function vpcSTP(e:ControlPlaneHost,d:Device,port:string,vlan:number):(TreeSnapshot&{role:string})|undefined {
  const c=nsosConfig(d).vpc,r=vpcRuntime(d),s=mapFor(e).get(d.id);
  if(!c||!r?.adjacency||!vpcMemberId(d,port))return;
  const t=r.role==='primary'?d.runtime.stp[String(vlan)]:s?.peer?.trees[String(vlan)];
  if(!t)return;
  const priority=Number(t.bridgeId.split('.')[0]),id=vpcMemberId(d,port);
  const rootMember=r.role==='primary'?port:s?.peer?.members.find(m=>m.id===id)?.port;
  return {rootId:t.rootId,rootBridgeId:t.rootBridgeId,bridgeId:String(priority).padStart(6,'0')+'.'+r.systemMac,cost:t.cost,priority,role:t.rootPort===rootMember?'root':'designated'};
}
export function applyVPCSpanningTree(e:ControlPlaneHost,d:Device,vlan:number):void {
  const r=vpcRuntime(d),tree=d.runtime.stp[String(vlan)];
  if(!r||!tree)return;
  for(const [name,p]of Object.entries(tree.ports)){
    // Advertise only locally detected protection, so a received peer decision
    // cannot echo back indefinitely and prevent recovery after the fault clears.
    p.localProtection=stpProtectionRoles.has(p.role??'')?p.role:undefined;
    const member=vpcMemberId(d,name),peerProtection=member&&r.adjacency?mapFor(e).get(d.id)?.peer?.trees[String(vlan)]?.protections?.[member]:undefined;
    const why=vpcPortReason(d,name,vlan);
    if(why){p.state='blocking';p.role='vpc-suspended';}
    else if(p.localProtection||p.state==='disabled')continue;
    else if(peerProtection&&stpProtectionRoles.has(peerProtection)){p.state='blocking';p.role=peerProtection;}
    else if(member&&r.adjacency){p.state='forwarding';p.role=vpcSTP(e,d,name,vlan)?.role??p.role;}
    else if(vpcPeerLink(d,name)&&r.adjacency&&e.interfaceUp(d.id,name)){p.state='forwarding';}
  }
}
export function vpcPeerGatewayMac(e:ControlPlaneHost,d:Device,logical:string,destinationMac:string):boolean {
  const r=vpcRuntime(d),c=nsosConfig(d).vpc;
  if(!r?.adjacency||!c?.peerGateway||!r.peerId||!/^Vlan/.test(logical))return false;
  return mapFor(e).get(d.id)?.peer?.gateways?.[logical]===destinationMac;
}
export function validateNSOSConfiguration(config:DeviceConfig,kind?:Device['kind']):void {
  const n:unknown=config.features.nsos;if(n===undefined){if(kind==='datacenter')throw Error('Datacenter Switch requires NS-OS configuration.');return;}
  if(!n||typeof n!=='object'||!('enabled'in n)||!Array.isArray(n.enabled)||n.enabled.some(f=>typeof f!=='string'||!NSOS_FEATURES.includes(f as typeof NSOS_FEATURES[number]))||new Set(n.enabled).size!==n.enabled.length)throw Error('Invalid NS-OS feature configuration.');
  const ns=n as NSOSConfig,c=ns.vpc;
  const integer=(v:number,min:number,max:number)=>Number.isInteger(v)&&v>=min&&v<=max;
  for(let port=1;port<=30;port++)if(!config.interfaces['Ethernet1/'+port])throw Error('Datacenter Switch requires Ethernet1/1 through Ethernet1/30.');
  if(!config.interfaces.mgmt0||config.interfaces.mgmt0.switchport||config.interfaces.mgmt0.vrf!=='management')throw Error('Datacenter Switch requires routed mgmt0 in the management VRF.');
  if(c!==undefined&&(!c||typeof c!=='object'))throw Error('Invalid vPC configuration.');
  if(c){
    if(!ns.enabled.includes('vpc')||!integer(c.domain,1,1000)||!integer(c.rolePriority,1,65535)||!integer(c.systemPriority,1,65535)||c.systemMac!==undefined&&(typeof c.systemMac!=='string'||!/^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2})$/i.test(c.systemMac)))throw Error('Invalid vPC domain or priority.');
    if(c.systemMac){const mac=normalizedMac(c.systemMac);if((parseInt(mac.slice(0,2),16)&1)||/^0+$/.test(mac))throw Error('vPC system MAC must be a nonzero unicast address.');}
    for(const key of ['peerSwitch','peerGateway','arpSynchronize','autoRecovery','gracefulConsistency'] as const)if(typeof c[key]!=='boolean')throw Error('Invalid vPC option '+key);
    if(!integer(c.reloadDelay,240000,3600000)||!integer(c.delayRestore,0,3600000)||!integer(c.delayRestoreSVI,0,3600000))throw Error('Invalid vPC recovery timer.');
    if(c.peerLink!==undefined&&(!/^Port-channel\d+$/.test(c.peerLink)||!config.interfaces[c.peerLink]?.switchport||config.interfaces[c.peerLink].mode!=='trunk'||config.interfaces[c.peerLink].features.vpcId))throw Error('Invalid vPC peer-link.');
    if(c.keepalive!==undefined){const k=c.keepalive;if(!k||typeof k!=='object'||typeof k.destination!=='string'||!isIPv4(k.destination)||k.source!==undefined&&(typeof k.source!=='string'||!isIPv4(k.source))||typeof k.vrf!=='string'||!integer(k.interval,400,10000)||!integer(k.timeout,3000,20000)||!integer(k.holdTimeout,3000,10000))throw Error('Invalid IPv4 vPC keepalive configuration.');}
  }
  const ids=new Set<number>();
  for(const p of Object.values(config.interfaces)){
    if(!/^(?:Ethernet1\/(?:[1-9]|[12]\d|30)|mgmt0|Port-channel\d+|Vlan\d+|Loopback\d+|Null0)$/.test(p.name))throw Error('Unsupported NS-OS interface '+p.name);
    if(/^Port-channel/.test(p.name)&&!integer(Number(p.name.slice(12)),1,4096)||/^Vlan/.test(p.name)&&!integer(Number(p.name.slice(4)),1,4094))throw Error('Invalid NS-OS logical interface number.');
    if(p.features.ethernetSpeeds!==undefined&&(!Array.isArray(p.features.ethernetSpeeds)||!p.features.ethernetSpeeds.length||p.features.ethernetSpeeds.some((n:unknown)=>typeof n!=='number'||![10,100,1000,10000,25000,40000,100000].includes(n))))throw Error('Invalid Ethernet speed capability.');
    if(p.features.vpcId!==undefined){const id=p.features.vpcId;if(!c||!integer(id,1,4096)||!/^Port-channel\d+$/.test(p.name)||!p.switchport||ids.has(id))throw Error('Invalid or duplicate vPC member.');ids.add(id);}
    if(p.features.vpcOrphanSuspend!==undefined&&typeof p.features.vpcOrphanSuspend!=='boolean')throw Error('Invalid vPC orphan suspension.');
    if(p.features.stpPortType!==undefined&&!['normal','edge','edge trunk','network'].includes(p.features.stpPortType))throw Error('Invalid NS-OS spanning-tree port type.');
    if(p.switchport&&!['access','trunk'].includes(p.mode))throw Error('NS-OS does not support dynamic trunk negotiation.');
    if(['auto','desirable'].includes(p.features.channelMode))throw Error('NS-OS does not support PAgP.');
  }
}
