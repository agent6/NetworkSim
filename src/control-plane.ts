import {activeIOSOSPFRouterId,syncIOSOSPFRouterIds} from './ospf-router-id.ts';
import {stpInterfaces, stpMembers, stpPortName, stpPortState, stpMemberActive, stpPortNumber, stpDefaultCost,stpRegion as mstRegion} from './stp-ports.ts';
import {switchVoiceVlan} from './endpoint.ts';
import { syncSwitchingMessages, switchingPeer, receiveSwitchingMessage } from './switching-messages.ts';
import { interfaceSpeed, interfaceBandwidth, interfaceDuplex } from './ethernet.ts';
import {syncMsdp,observeMsdpSource,msdpSourceAvailable,msdpRemoteSource} from './msdp.ts';
import { bgpPathSuppressed } from './bgp-dampening.ts';
import { disableInterface, errdisableDetectionEnabled, reconcileErrdisable } from './ios-errdisable.ts';
import { resolveForwardingPaths } from './route-resolver.ts';
import {routingDevice,routingConfig} from './routing-scope.ts';
import {eigrpUpdateEpoch,invalidateEigrpUpdateEpoch,synchronizeEigrpUpdatePeers,advertiseEigrpUpdates,receivedEigrpUpdates,eigrpUpdateReady,receiveEigrpUpdate,type EigrpFamily,type EigrpUpdatePeer,type EigrpAdvertisement,type EigrpVector} from './eigrp-updates.ts';
import { communityListMatches, canonicalCommunity, matchIOSExpression } from './bgp-policy.ts';
import { selectBgpCandidate, removePrivateAS, scopedBgpConfig, bgpAddressFamily, bgpMultipathEligible } from './bgp-compat.ts';
import { syncFhrpPackets, receiveFhrpControl, fhrpPeerView } from './fhrp-packets.ts';
import { syncOSPF, configuredOSPFNeighbors, verifiedOSPFAdjacency, ospfDatabaseView, ospfLiveDetail, receiveOSPFControl, type OSPFProtocol, type OSPFEndpoint, type OSPFOrigin, type OSPFSnapshot } from './ospf-packets.ts';
import { synchronizeBgpSessions, sendBgpAdvertisements, rejectBgpMaximumPrefix, type BgpPeerConfig } from './bgp-session.ts';
import type { TCPChannel, TCPChannelOptions } from './tcp-channel.ts';
import { slaTrackUp } from './sla-config.ts';
import { settleTrackStates } from './tracking.ts';
import { syncDiscovery, receiveDiscoveryControl } from './discovery.ts';
import { defaultInterface, type Device, type InterfaceConfig, type Lab, type Link, type NewSimEvent, type Route, type StpPortState } from './model.ts';
import type { SimulationClock } from './clock.ts';
import { isIPv6, ipv6Network, ipv6ToBigInt, prefixContains, sameAddress } from './ip.ts';
import { refreshTrackingBindings } from './fhs-tracking.ts';
import { portfastConfigured, loopguardEnabled, bpduguardEnabled } from './ios-switching-compat.ts';
import { configuredDistance, routePolicyMatches } from './ios-routing-compat.ts';
import { nhrpRuntime, nhrpMapping, nhrpServers, synchronizeNhrp, type NhrpMessage } from './nhrp.ts';
import { tunnelNbma } from './tunnel.ts';
import {isDatacenter,nsosFeature,syncVPC,receiveVPCCFS,receiveVPCKeepalive,vpcActor,vpcAggregationSuspended,vpcMemberId,vpcPortReason,vpcSTP,applyVPCSpanningTree,vpcEgressAllowed,vpcRuntime,nsosConfig} from './datacenter.ts';
export { resolveTunnelDestination, tunnelAccepts } from './nhrp.ts';

/** Structural interface keeps the protocol module independently testable. */
export interface ControlPlaneHost {
  registerTCPChannelService?(port:number,accepts:(d:Device,peer:string,local:string)=>boolean|{ttl?:number;minimumTTL?:number},connected:(channel:TCPChannel)=>void):()=>void;
  connectTCPChannel?(id:string,address:string,port:number,options?:TCPChannelOptions):TCPChannel;
  lab: Lab;
  clock: SimulationClock;
  getDevice(id: string): Device | undefined;
  macOf?(id:string,port:string):string;
  interfaceUp(id: string, port: string): boolean;
  operationalIPv6Addresses?(id: string, port: string): string[];
  ipv6AddressUsable?(id: string, port: string, address: string): boolean;
  emit(event: NewSimEvent): unknown;
  log?(deviceId:string,message:string,severity?:number):unknown;
  recompute(): void;
  notify(): void;
  sendControlDatagram?(deviceId:string,source:string,destination:string,destinationPort:number,body:any,options?:{interface?:string;vrf?:string;ttl?:number;protocol?:string;dscp?:number}):void;
  sendNhrpDatagram?(deviceId:string,port:string,nbma:string,message:NhrpMessage):void;
  cefLookup?(deviceId:string,target:string,vrf?:string):{route:Route;port:string;target:string}|undefined;
  sendBfdEcho?(deviceId:string,port:string,source:string,peer:string,body:any):void;
  receiveRegisteredMulticast?(deviceId:string,packet:any):void;
  sendGratuitousARP?(deviceId:string,port:string,ip:string,mac?:string):void;
  sendLinkControl?(deviceId:string,port:string,message:{kind:'link-control';protocol:string;body:any}):void;
}
type Simulator = ControlPlaneHost;

/** Original educational models; computed convergence and transmitted control messages are distinguished. */
export const CONTROL_PLANE_CAPABILITIES = {
  stp: 'EtherChannels are single logical STP ports with logical cost/priority/guards, one member-carried BPDU session and shared member forwarding. Delivered per-VLAN BPDU vectors elect roots, root/designated/alternate ports and path costs. Received proposals/agreements, root-port synchronization, hello/max-age/forward timers, rapid three-Hello expiry, root/BPDU/loop guards, transmit hold count, topology-change MAC flushing and UplinkFast alternate promotion affect forwarding. Matching MST region instances and remaining-hop budgets are modeled; region boundaries use a conservative per-VLAN boundary tree. Logical envelopes; no complete CIST/M-record encoding, every IEEE event transition or UplinkFast station-update frames. Non-PortFast endpoint links use a bounded one-second silent-neighbor transition.',
  dtpVtp: 'Delivered DTP advertisements, 30-second transmission and 300-second neighbor expiry drive dynamic trunks. Delivered periodic/triggered VTP database messages enforce domain/password/version/revision and normal-range VLAN propagation, preserving local extended VLANs. Transparent forwarding and per-port controls operate. Logical snapshots rather than binary summary/subset/request fragments; no VTPv3 primary server or pruning.',
  etherchannel: 'Delivered LACP/PAgP actor/partner advertisements and synchronization gate dynamic membership. Slow/fast LACP receive timeouts, passive negotiation, local member consistency, advertised system/port priorities, eight IOS or 32 Datacenter active members and standby promotion drive actual switched/routed hashing and failure. NS-OS rejects PAgP/DTP. vPC shares actor system/key while retaining physical sender/partner identity. Static on/on uses physical compatibility. Logical PDUs and bounded state model; no complete IEEE mux/marker machine or independent aggregate throughput model.',
  vpc: 'Independent NS-OS peers exchange delivered, reciprocal peer-link snapshots and routed VRF-aware UDP3200 keepalives. Shared LACP identity, sticky roles, type-1/type-2/per-VLAN consistency, MAC/optional ARP synchronization, peer-gateway, peer-switch, delay-restore, opt-in auto-recovery, secondary/orphan suspension and peer-link split-horizon affect actual forwarding. Network ports use reciprocal Bridge Assurance with three-Hello expiry. Both-path loss can expose dual-active risk; no omniscient peer-failure guarantee. Logical CFS envelopes, not binary Cisco CFS, full NX-OS FSM or layer3 peer-router support.',
  ospf: 'Actual OSPFv2/v3 Hello/dead, database description/request/update/ack, reliable flooding and received LSDB aging drive per-router SPF. Computed DR/BDR, areas/stubs/NSSA, summaries and virtual links. Logical segmented router records rather than full scoped binary LSA types; no complete NSSA forwarding-address/translator FSM.',
  eigrp: 'Delivered IPv4/IPv6 Hello, INIT/UPDATE/ACK vectors and hold timers drive per-neighbor topology/RIB state. Ordered deltas/withdrawals, duplicate/stale suppression, restart refresh and retry limits operate through protocol88. Reliable QUERY/REPLY/SIA gates ACTIVE/PASSIVE; local policy, feasibility/variance, summaries, stubs and redistribution remain operational. Named wide metrics and RIB scaling use default K1/K3. Logical stop-and-wait model with fixed retries; no binary TLVs, unified complete DUAL/RTP matrix, adaptive RTO, control-bandwidth pacing or all K-values.',
  rip: 'Actual RIPv1 broadcast and RIPv2/RIPng multicast updates, periodic/triggered timers, invalid/hold-down/flush, split horizon and poison reverse. Version controls, classful auto-summary, manual summaries, filters, offsets and redistribution affect real advertisements. Single selected path; no ECMP, binary encoding or request/full-table exchange.',
  msdp: 'Persistent TCP639 peers, actual KEEPALIVE/Source-Active delivery, keepalive/hold/reconnect timers, source observation at the RP, source-cache aging and inter-RP PIM receiver trees. Configured connect-source/originator-id and real peer/cache counters. Logical envelopes; bounded single-peer/unicast-next-hop RPF, no binary TLVs, mesh groups, SA filters/request/response, MD5 or optional encapsulated first data packet.',
  bgp: 'Actual persistent TCP179, OPEN/KEEPALIVE/UPDATE/NOTIFICATION, negotiated hold expiry, reconnect and advertised-prefix withdrawals. IPv4/IPv6 unicast capabilities are negotiated on each shared transport; per-AF activation, policy, VRF isolation, origination and withdrawals drive real forwarding. Eligible eBGP/iBGP maximum-paths install actual ECMP and IGP next-hop cost precedes router-ID selection. Received paths drive IPv4/IPv6 policy, weight/local preference, deterministic/cross-AS MED, administrative distance, per-neighbor defaults, private-AS removal, allowas-in, soft policy refresh and retained inbound/outbound views. Conditional aggregates, recursive next hops, reflection and maximum-prefix shutdown remain operational. GTSM checks actual TTL; single-hop BFD and modeled TCP key equality can gate sessions. Neighbor logging follows configuration. Delivered eBGP withdrawal history drives configurable dampening, decay/reuse and administrative history clears. Logical message encoding and authentication tokens, not real TCP-MD5; no complete RFC event matrix, MRAI, graceful restart, confederations, VPN families or complete IOS policy language.',
  fhrp: 'Actual HSRP/VRRP/GLBP advertisements, per-observer hold expiry, auth/version compatibility and delayed preemption drive elections. Actual virtual ARP, GLBP client assignment and MAC takeover. Logical teaching state model; no cryptographic digest, full coup/resign FSM or GLBP redirect/secondary-forwarder timers.',
  bfd: 'Actual simulated UDP3784 control messages, Down/Init/Up progression, negotiated intervals and expiry. Independent IPv4 and IPv6 link-local sessions gate IGP/BGP adjacency and BFD tracks; optional actual forwarding echo detects echo-only loss. Single-hop asynchronous model; no authentication, demand mode or multihop BFD.',
  nhrp: 'GRE-carried NHRP registration/resolution, NHS retry/hold states, refresh/purge and cache expiry; attached IPsec profiles protect control and data. Single-hub Phase2 direct resolution and Phase3 redirect, hub-relayed requests, direct destination replies and prefix-aware CEF overrides. Logical envelopes, not binary NHRP or native VPN interoperability.',
  multicast: 'Actual IGMP reports/leaves/query responses, membership expiry, PIM Register/Register-Stop data, RPT/SPT copies and dense flood/Prune/Graft/Ack with timers. Computed DR and shared joins, source keepalive and SSM filtering. Switch snooping/querier use actual IGMP traffic. No complete PIM Hello/Join-Prune/Assert/BSR/Auto-RP FSM or IGMP include/exclude matrix.',
  udld: 'Actual physical-link advertisements/echo, neighbor expiry, aggressive one-second retries and err-disable/recovery; honors directional link loss. Simplified discovery/recovery state model.',
  ptp: 'Computed BMCA priority/domain election and ordinary/boundary/transparent roles. synchronized=false: no timestamp packets, oscillator servo, clock-offset precision or hardware synchronization.',
  tracking: 'Interface, route, BFD and actual ICMP, HTTP and UDP-jitter IP-SLA tracking; boolean, weighted and percentage lists with hysteresis/cycle checks; delayed up/down transitions consumed by FHRP. No complete IOS tracking/IP-SLA operation catalog.',
  discovery: 'Actual physical CDP/LLDP advertisements and advertised holdtime expiration; global/per-interface transmit/receive controls. Logical envelopes rather than binary TLVs; no TLV customization.',
  authentication: 'Computed OSPF/EIGRP/RIP key compatibility with matching key ID/string and active send/accept lifetimes; timed rollover changes adjacency. No wire digest generation or cryptographic security claim.',
} as const;

export interface NetworkStatement { network: string; prefix: number; area?: number | string }
export interface RoutingConfig {
  processId?: number; asn?: number; routerId?: string; version?: number;
  networks?: NetworkStatement[]; passiveInterfaces?: string[]; passiveDefault?: boolean;
  activeInterfaces?: string[]; defaultOriginate?: boolean; defaultAlways?: boolean;
  redistribute?: (string | {protocol:string;metric?:number;metricType?:1|2;routeMap?:string;tag?:number})[]; [key: string]: any;
}

type Port = { device: Device; iface: InterfaceConfig; name: string };
type Wire = { link: Link; a: Port; b: Port };
type RoutedPort = Port & { ip: string; prefix: number; node: string; family: 4 | 6 };
type Adj = { from: RoutedPort; to: RoutedPort; area?: string; cost: number; bandwidth: number; delay: number };
type Path = { node: string; edges: Adj[]; cost: number; bandwidth: number; delay: number; areas: string[]; visited: Set<string> };
type BgpRoute = { network: string; prefix: number; origin: string; asPath: number[]; nextHop: string; localPreference: number; med: number; learnedVia?: 'ebgp' | 'ibgp'; from?: string; routerId: string;communities?:string[];originatorId?:string;clusterList?:string[];learnedFromClient?:boolean;aggregate?:boolean;atomicAggregate?:boolean;weight?:number;originCode?:'i'|'e'|'?';arrivalOrder?:number;igpMetric?:number };
const state = new WeakMap<Simulator, { timer?: any; transitions: Map<string, { signature: string; start: number }> }>();
const vtpDatabases = new WeakMap<Simulator, Map<string, { domain: string; version: number; database: string; revision: number }>>();
type BfdSession={key:string;deviceId:string;interface:string;peer:string;source:string;peerDeviceId:string;status:'Down'|'Init'|'Up';minTx:number;minRx:number;multiplier:number;peerMinTx:number;peerMinRx:number;peerMultiplier:number;lastReceived?:number;tx?:any;detect?:any;echoDetect?:any;echoSequence?:number;lastEchoReceived?:number;echoReceivedSequence?:number;peerEcho?:boolean;runtime:Device['runtime'];vrf?:string};
const bfdSessions=new WeakMap<Simulator,Map<string,BfdSession>>();
const glbpAssignments=new WeakMap<Simulator,Map<string,Map<string,number>>>();
const igmpTimers=new WeakMap<Simulator,Map<string,{timer:any;runtime:Device['runtime'];signature:string;deviceId:string;port:string;groups:{group:string;source?:string}[];version:number}>>();
const multicastFlows=new WeakMap<Simulator,Map<string,{source:string;group:string;expires:number;timer?:any}>>();
type UdldSession={deviceId:string;port:string;mode:string;messageTime:number;state:string;neighborDeviceId?:string;neighborPort?:string;lastReceived?:number;retries:number;tx?:any;expiry?:any;retry?:any;runtime:Device['runtime']};
const udldSessions=new WeakMap<Simulator,Map<string,UdldSession>>();
type StpBPDU={vlan:string;rootId:string;rootBridgeId:string;bridgeId:string;cost:number;portId:string;mode:string;region:string;age:number;maxAge:number;helloTime:number;forwardTime:number;received:number;role:string;proposal?:boolean;agreement?:string;tc?:string;hops?:number;bridgeAssurance?:boolean};
type StpHeartbeat={deviceId:string;port:string;attachment:string;member?:string;runtime:Device['runtime'];created:number;received:Map<string,StpBPDU>;blocked:Set<string>;lastSent:Map<string,number>;sent:Map<string,string>;agreements:Map<string,string>;accepted:Map<string,string>;lost:Set<string>;nonDesignated?:Set<string>;window?:number;sentCount?:number;triggerSignature?:string;trigger?:any;tx?:any;expiry?:any};
const stpHeartbeats=new WeakMap<Simulator,Map<string,StpHeartbeat>>();

type EigrpHelloPort={endpoint:RoutedPort;protocol:string;runtime:Device['runtime'];signature:string;timer:any;send?:()=>void};
type EigrpHelloPeer={edge:Adj;runtime:Device['runtime'];lastReceived:number;holdTime:number;expiry:any;updateEpoch?:string;since?:number};
const eigrpHellos=new WeakMap<Simulator,{ports:Map<string,EigrpHelloPort>;peers:Map<string,EigrpHelloPeer>;candidates:Map<string,Adj[]>}>();
function helloContext(engine:Simulator){let c=eigrpHellos.get(engine);if(!c){c={ports:new Map(),peers:new Map(),candidates:new Map()};eigrpHellos.set(engine,c);}return c;}
function synchronizeEigrpHellos(engine:Simulator,endpoints:RoutedPort[],candidates:Adj[],protocol:string):Adj[]{
  const c=helloContext(engine);c.candidates.set(protocol,candidates);const wanted=new Set<string>();
  for(const ep of endpoints.filter(p=>p.family===protocolFamily(protocol)&&networkMatch(p,protocol)&&!passive(p,protocol)&&!/^loopback/i.test(p.name))){
    const key=`${ep.device.id}|${protocol}|${ep.name}`;if(wanted.has(key))continue;wanted.add(key);const f=ep.iface.features[protocol]??{},hello=Math.max(.1,Number(f.helloInterval??5)),hold=Math.max(.1,Number(f.holdTime??15)),signature=JSON.stringify([ep.ip,config(ep.device,protocol)?.asn,hello,hold,config(ep.device,protocol)?.metricWeights,config(ep.device,protocol)?.neighbors,protocolAuthentication(engine,ep,protocol)]),old=c.ports.get(key);if(old?.runtime===ep.device.runtime&&old.signature===signature){old.endpoint=ep;continue;}if(old){engine.clock.cancel(old.timer);for(const[peerKey,p]of c.peers)if(peerKey.startsWith(key+'|')){engine.clock.cancel(p.expiry);c.peers.delete(peerKey);}}
    const row:EigrpHelloPort={endpoint:ep,protocol,runtime:ep.device.runtime,signature,timer:undefined};const send=()=>{if(row.runtime!==ep.device.runtime||!engine.interfaceUp(ep.device.id,ep.name))return;const neighbors=(config(ep.device,protocol)?.neighbors??[]).filter((n:any)=>n.interface===ep.name),destinations=neighbors.length?neighbors.map((n:any)=>n.address):[ep.family===6?'ff02::a':'224.0.0.10'];for(const destination of destinations){eigrpTraffic(ep.device,protocol,'sent','hello',ep.iface.vrf);engine.sendControlDatagram?.(ep.device.id,ep.ip,destination,0,{protocol:'eigrp-hello',family:protocol,sender:ep.device.id,port:ep.name,asn:config(ep.device,protocol)?.asn,holdTime:hold,updateEpoch:eigrpUpdateEpoch(engine,key,ep.device.runtime,signature),metricWeights:config(ep.device,protocol)?.metricWeights??[1,0,1,0,0]},{interface:ep.name,vrf:ep.iface.vrf,ttl:1,protocol:'eigrp'});}};row.send=send;row.timer=engine.clock.schedule(0,send,{owner:ep.device.id,repeat:hello*1000,label:'EIGRP Hello'});c.ports.set(key,row);
  }
  for(const[key,p]of c.ports)if(p.protocol===protocol&&!wanted.has(key)){engine.clock.cancel(p.timer);c.ports.delete(key);}
  for(const[key,p]of c.peers)if(p.edge.from.family===protocolFamily(protocol)&&(p.runtime!==p.edge.from.device.runtime||!wanted.has(`${p.edge.from.device.id}|${protocol}|${p.edge.from.name}`))){engine.clock.cancel(p.expiry);c.peers.delete(key);}
  for(const d of engine.lab.devices){const rows=[...c.peers.values()].filter(p=>p.edge.from.device.id===d.id&&p.edge.from.family===protocolFamily(protocol)&&p.runtime===d.runtime).map(p=>({interface:p.edge.from.name,vrf:p.edge.from.iface.vrf,address:p.edge.to.ip,lastReceived:p.lastReceived,holdTime:p.holdTime,expires:p.lastReceived+p.holdTime*1000,since:p.since}));d.runtime.features[`${protocol}HelloNeighbors`]=rows;for(const n of d.runtime.neighbors)if(n.protocol===protocol.toUpperCase()&&n.state==='UP'&&!rows.some(r=>r.interface===n.interface&&sameAddress(r.address,n.address??'')))n.state='INIT (HELLO)';}
  return candidates.filter(edge=>c.peers.has(dualPeerKey(edge,protocol)));
}
function eigrpTraffic(d:Device|undefined,protocol:string,direction:string,type:string,vrf?:string):void{if(!d)return;const scoped=d.runtime.features[protocol+'TrafficByVrf']??={};for(const stats of[d.runtime.features[`${protocol}Traffic`]??={},scoped[vrf??'']??={}]){stats[direction]??={};stats[direction][type]=(stats[direction][type]??0)+1;}}
function refreshEigrpHold(engine:Simulator,key:string):void{
  const c=helloContext(engine),peer=c.peers.get(key);if(!peer)return;const edge=peer.edge,protocol=key.split('|')[1];engine.clock.cancel(peer.expiry);peer.lastReceived=engine.clock.now();peer.expiry=engine.clock.schedule(peer.holdTime*1000,()=>{if(c.peers.get(key)!==peer)return;c.peers.delete(key);event(engine,edge.from.device,protocol.toUpperCase(),'Hold timer expired',`${edge.to.ip} on ${edge.from.name}: no EIGRP packet received.`,true);engine.recompute();engine.notify();},{owner:edge.from.device.id,label:'EIGRP neighbor hold'});const row=(edge.from.device.runtime.features[`${protocol}HelloNeighbors`]??[]).find((r:any)=>r.interface===edge.from.name&&sameAddress(r.address,edge.to.ip));if(row){row.lastReceived=peer.lastReceived;row.expires=peer.lastReceived+peer.holdTime*1000;}
}
function receiveEigrpHello(engine:Simulator,deviceId:string,source:string,p:any,ttl:number,input?:string):void {
  if(eigrpProtocol(p.family))eigrpTraffic(engine.getDevice(deviceId),p.family,'received','hello',input?engine.getDevice(deviceId)?.config.interfaces[input]?.vrf:undefined);
  if(ttl!==1||!eigrpProtocol(p.family)||!Number.isFinite(p.holdTime)||p.holdTime<=0||p.holdTime>65535)return;const c=helloContext(engine),edge=c.candidates.get(p.family)?.find(e=>e.from.device.id===deviceId&&(!input||e.from.name===input)&&sameAddress(e.to.ip,source)&&e.to.device.id===p.sender&&e.to.name===p.port&&config(e.from.device,p.family)?.asn===p.asn);if(!edge||JSON.stringify(p.metricWeights??[1,0,1,0,0])!==JSON.stringify(config(edge.from.device,p.family)?.metricWeights??[1,0,1,0,0]))return;
  const key=dualPeerKey(edge,p.family),old=c.peers.get(key),fresh=!old||old.runtime!==edge.from.device.runtime||old.updateEpoch!==p.updateEpoch;engine.clock.cancel(old?.expiry);const peer:EigrpHelloPeer={edge,runtime:edge.from.device.runtime,lastReceived:engine.clock.now(),holdTime:p.holdTime,expiry:undefined,updateEpoch:typeof p.updateEpoch==='string'?p.updateEpoch:undefined,since:fresh?engine.clock.now():old!.since??engine.clock.now()};c.peers.set(key,peer);refreshEigrpHold(engine,key);if(fresh){c.ports.get(`${edge.from.device.id}|${p.family}|${edge.from.name}`)?.send?.();event(engine,edge.from.device,p.family.toUpperCase(),'Hello neighbor up',`${source} on ${edge.from.name}.`);engine.recompute();}else{const rows=edge.from.device.runtime.features[`${p.family}HelloNeighbors`]??[],row=rows.find((r:any)=>r.interface===edge.from.name&&r.address===source);if(row){row.lastReceived=peer.lastReceived;row.expires=peer.lastReceived+p.holdTime*1000;}}engine.notify();
}
type DualRoute=Route&{reportedDistance?:number;dependencyNodes?:string[];eigrpUpdate?:EigrpAdvertisement};
type DualEntry={key:string;deviceId:string;protocol:string;vrf?:string;network:string;prefix:number;runtime:Device['runtime'];state:'PASSIVE'|'ACTIVE';fd:number;successors:DualRoute[];candidates:DualRoute[];pending:Map<string,{edge:Adj;siaSent:number;siaAnswered:boolean}>;upstream:Map<string,{edge:Adj;token:string}>;replies:Map<string,number>;token:string;activeSince?:number;timer?:any;lastReason?:string;signature?:string};
type DualContext={entries:Map<string,DualEntry>;candidates:Map<string,DualRoute[]>;graphs:Map<string,Adj[]>;sequence:number;received:Set<string>;inflight:Map<string,{edge:Adj;body:any;attempts:number;runtime:Device['runtime'];timer?:any}>;blocked:Map<string,{edge:Adj;timer?:any;runtime:Device['runtime']}>};
const dualContexts=new WeakMap<Simulator,DualContext>();
function dualContext(engine:Simulator):DualContext {let c=dualContexts.get(engine);if(!c){c={entries:new Map(),candidates:new Map(),graphs:new Map(),sequence:0,received:new Set(),inflight:new Map(),blocked:new Map()};dualContexts.set(engine,c);}return c;}
function dualKey(d:Device,protocol:string,network:string,prefix:number,vrf?:string):string{return`${d.id}|${protocol}|${vrf??''}|${network}/${prefix}`;}
function dualPeerKey(edge:Adj,protocol:string):string{return`${edge.from.device.id}|${protocol}|${edge.from.name}|${edge.to.ip}`;}
function dualPeer(engine:Simulator,deviceId:string,source:string,destination:string,protocol:string,input?:string):Adj|undefined {
  const original=engine.getDevice(deviceId);if(!original)return;const d=routingDevice(original,input?original.config.interfaces[input]?.vrf:undefined);
  const n=d.runtime.neighbors.find(n=>(!input||n.interface===input)&&n.protocol===protocol.toUpperCase()&&sameAddress(n.address??'',source)&&['UP','SIA-DOWN'].includes(n.state));if(!n)return;
  const rawPeer=engine.getDevice(n.deviceId),peer=rawPeer?routingDevice(rawPeer,rawPeer.config.interfaces[n.peerInterface!]?.vrf):undefined,iface=d.config.interfaces[n.interface],other=peer?.config.interfaces[n.peerInterface!];if(!peer||!iface||!other||!engine.interfaceUp(d.id,n.interface))return;
  const own=[iface.ip,...(engine.operationalIPv6Addresses?.(d.id,n.interface)??iface.ipv6).map(v=>v.split('/')[0]),d.runtime.features.linkLocalAddresses?.[n.interface]].filter(Boolean);if(!own.some(v=>sameAddress(v,destination))||isIPv6(destination)&&engine.ipv6AddressUsable?.(d.id,n.interface,destination)===false)return;
  const from:RoutedPort={device:d,iface,name:n.interface,ip:destination,prefix:protocolFamily(protocol)===6?64:prefixOf(iface.mask),node:nodeOf(d,iface.vrf),family:protocolFamily(protocol)};
  const to:RoutedPort={device:peer,iface:other,name:n.peerInterface!,ip:source,prefix:protocolFamily(protocol)===6?64:prefixOf(other.mask),node:nodeOf(peer,other.vrf),family:protocolFamily(protocol)};
  return{from,to,cost:1,bandwidth:interfaceBandwidth(d,iface),delay:Number(iface.features.delay??10)*10};
}
function dualTransmit(engine:Simulator,edge:Adj,body:any):void {
  eigrpTraffic(edge.from.device,body.family,'sent',String(body.operation??'unknown').toLowerCase(),edge.from.iface.vrf);
  engine.sendControlDatagram?.(edge.from.device.id,edge.from.ip,edge.to.ip,0,body,{interface:edge.from.name,vrf:edge.from.iface.vrf,ttl:1,protocol:'eigrp'});
}
function dualSend(engine:Simulator,edge:Adj,protocol:string,message:any,reliable=true):void {
  const c=dualContext(engine),id=++c.sequence,body={protocol:'eigrp-dual',family:protocol,asn:config(edge.from.device,protocol)?.asn,sender:edge.from.device.id,id,...message};
  if(!reliable){dualTransmit(engine,edge,body);return;}
  const key=`${edge.from.device.id}|${protocol}|${id}`,pending={edge,body,attempts:0,runtime:edge.from.device.runtime,timer:undefined as any};c.inflight.set(key,pending);
  const send=()=>{if(!c.inflight.has(key))return;if(pending.runtime!==edge.from.device.runtime||!config(edge.from.device,protocol)||!edge.from.device.powered){c.inflight.delete(key);return;}pending.attempts++;dualTransmit(engine,edge,body);
    pending.timer=engine.clock.schedule(500,()=>{if(pending.attempts>=16){c.inflight.delete(key);dualResetPeer(engine,edge,protocol,'Reliable query/reply delivery retry limit exceeded.');}else send();},{owner:edge.from.device.id,label:'EIGRP reliable control retry'});
  };send();
}
export function dualOwnDistance(d:Device,protocol:string,network:string,prefix:number,vrf?:string):number|undefined {
  for(const[name,iface]of Object.entries(d.config.interfaces)){
    if((iface.vrf??'')!==(vrf??''))continue;if(!iface.adminUp||!d.runtime.routes.some(r=>r.protocol==='connected'&&r.network===network&&r.prefix===prefix&&(r.vrf??'')===(vrf??'')))continue;const ips=protocolFamily(protocol)===6?iface.ipv6.map(v=>({ip:v.split('/')[0],prefix:Number(v.split('/')[1]??64)})):iface.ip?[{ip:iface.ip,prefix:prefixOf(iface.mask)}]:[];
    for(const ip of ips){const p:RoutedPort={device:d,iface,name,...ip,node:nodeOf(d,vrf),family:protocolFamily(protocol)};if(networkMatch(p,protocol)&&subnet(ip.ip,ip.prefix)===network&&ip.prefix===prefix)return eigrpVectorMetric(d,protocol,[{bandwidth:Math.max(1,interfaceBandwidth(d,iface)),delay:Number(iface.features.delay??10)*10}]);}
  }
  const summary=d.runtime.routes.find(r=>r.protocol==='D summary'&&r.network===network&&r.prefix===prefix&&(r.vrf??'')===(vrf??''));if(summary)return (summary as any).wideMetric??summary.metric;
  for(const raw of config(d,protocol)?.redistribute??[]){const rule=typeof raw==='string'?{protocol:raw}:raw;const r=selectedRoutes(d).find(r=>r.network===network&&r.prefix===prefix&&(r.vrf??'')===(vrf??'')&&protocolOf(r)===rule.protocol);if(!r)continue;if(r.protocol==='static'&&!/^null/i.test(r.interface)&&!resolveEgress(d,r.network,r.vrf))continue;const advertised=applyRouteMap(d,rule.routeMap,{...r,metric:rule.metric??defaultSeedMetric(d,protocol,25600)??25600});if(advertised)return advertised.metric;}
}
function dualPublish(engine:Simulator,entry:DualEntry):void {
  const original=engine.getDevice(entry.deviceId),d=original?routingDevice(original,entry.vrf):undefined;if(!d)return;const field=entry.protocol==='eigrp6'?'eigrp6Topology':'eigrpTopology';
  const rows:any[]=d.runtime.features[field]??=[];let row=rows.find(r=>r.network===entry.network&&r.prefix===entry.prefix&&(r.vrf??'')===(entry.vrf??''));
  if(!row){row={network:entry.network,prefix:entry.prefix,vrf:entry.vrf};rows.push(row);}
  Object.assign(row,{state:entry.state,feasibleDistance:entry.fd,ribMetric:eigrpRibMetric(d,entry.protocol,entry.successors[0]?.metric??entry.fd),metricMode:config(d,entry.protocol)?.name?'wide':'classic',activeSince:entry.activeSince,successors:entry.successors.map(r=>({nextHop:r.nextHop,interface:r.interface,metric:r.metric,reportedDistance:r.reportedDistance})),pendingReplies:[...entry.pending.values()].map(p=>({address:p.edge.to.ip,interface:p.edge.from.name,siaQueries:p.siaSent})),reason:entry.lastReason});
}
function dualInstall(engine:Simulator,entry:DualEntry,candidates:DualRoute[]):void {
  const original=engine.getDevice(entry.deviceId),d=original?routingDevice(original,entry.vrf):undefined;if(!d)return;
  d.runtime.routes=d.runtime.routes.filter(r=>!(r.protocol.startsWith('D')&&r.protocol!=='D summary'&&r.network===entry.network&&r.prefix===entry.prefix&&(r.vrf??'')===(entry.vrf??'')));
  if(entry.state==='ACTIVE'){dualPublish(engine,entry);return;}
  candidates.sort((a,b)=>a.ad-b.ad||a.metric-b.metric||natural(a.nextHop??'',b.nextHop??''));const best=candidates[0],cfg=config(d,entry.protocol)!;
  const eligible=best?candidates.filter(r=>r.ad===best.ad&&r.metric<=best.metric*(cfg.trafficShare==='min'?1:Math.max(1,Number(cfg.variance??1)))&&(r.metric===best.metric||(r.reportedDistance??Infinity)<entry.fd)):[];
  const chosen=eligible.filter((r,i)=>eligible.findIndex(p=>p.nextHop===r.nextHop&&p.interface===r.interface)===i).slice(0,Number(cfg.maximumPaths??4));
  entry.successors=chosen.map(r=>({...r}));for(const r of chosen)d.runtime.routes.push({...r,metric:eigrpRibMetric(d,entry.protocol,r.metric),...(config(d,entry.protocol)?.name?{wideMetric:r.metric}:{}),loadShare:chosen.length>1});dualPublish(engine,entry);
}
function dualComplete(engine:Simulator,entry:DualEntry):void {
  if(entry.state!=='ACTIVE'||entry.pending.size)return;engine.clock.cancel(entry.timer);entry.timer=undefined;
  const excluded=new Set([...entry.upstream.values()].map(v=>v.edge.to.device.id));
  const candidates=entry.candidates.filter(r=>!(r.dependencyNodes??[]).some(id=>excluded.has(id))&&(!entry.replies.has(`${r.interface}|${r.nextHop}`)||Number.isFinite(entry.replies.get(`${r.interface}|${r.nextHop}`))));
  for(const up of entry.upstream.values())entry.replies.set(`${up.edge.from.name}|${up.edge.to.ip}`,Infinity);
  entry.state='PASSIVE';entry.fd=candidates.length?Math.min(...candidates.map(r=>r.metric)):Infinity;entry.activeSince=undefined;dualInstall(engine,entry,candidates);
  const original=engine.getDevice(entry.deviceId),d=original?routingDevice(original,entry.vrf):undefined;if(d)event(engine,d,entry.protocol.toUpperCase(),'DUAL PASSIVE',`${entry.network}/${entry.prefix}: all query replies received; ${entry.successors.length} successor(s).`);
  const distance=entry.successors[0]?.metric??null;for(const up of entry.upstream.values())dualSend(engine,up.edge,entry.protocol,{operation:'REPLY',network:entry.network,prefix:entry.prefix,token:up.token,distance});entry.upstream.clear();
}
function dualSiaTick(engine:Simulator,entry:DualEntry):void {
  if(entry.state!=='ACTIVE')return;
  for(const[pkey,pending]of [...entry.pending]){
    if(pending.siaSent&&(!pending.siaAnswered||pending.siaSent>=3)){dualResetPeer(engine,pending.edge,entry.protocol,pending.siaSent>=3?'Three SIA busy responses without a final reply.':'No reply to the SIA query.');continue;}
    pending.siaSent++;pending.siaAnswered=false;dualSend(engine,pending.edge,entry.protocol,{operation:'SIA-QUERY',network:entry.network,prefix:entry.prefix,token:entry.token});
  }
  if(entry.state==='ACTIVE'){const original=engine.getDevice(entry.deviceId),d=original?routingDevice(original,entry.vrf):undefined;const interval=Number((d&&config(d,entry.protocol)?.activeTime)??180000)/2;if(interval>0)entry.timer=engine.clock.schedule(Math.max(100,interval),()=>dualSiaTick(engine,entry),{owner:entry.deviceId,label:'EIGRP SIA progress check'});dualPublish(engine,entry);engine.notify();}
}
function dualActivate(engine:Simulator,entry:DualEntry,reason:string,upstream?:{edge:Adj;token:string}):void {
  const c=dualContext(engine),original=engine.getDevice(entry.deviceId),d=original?routingDevice(original,entry.vrf):undefined;if(!d)return;
  entry.state='ACTIVE';entry.activeSince=engine.clock.now();entry.token=`${entry.deviceId}:${++c.sequence}`;entry.lastReason=reason;entry.pending.clear();entry.replies.clear();if(upstream)entry.upstream.set(`${upstream.edge.to.device.id}|${upstream.token}`,upstream);
  const peers=(c.graphs.get(entry.protocol)??[]).filter(e=>e.from.device.id===d.id&&(e.from.iface.vrf??'')===(entry.vrf??'')&&!config(e.to.device,entry.protocol)?.stub&&e.to.device.id!==upstream?.edge.to.device.id);
  for(const edge of peers){const key=`${edge.from.name}|${edge.to.ip}`;if(entry.pending.has(key))continue;entry.pending.set(key,{edge,siaSent:0,siaAnswered:false});dualSend(engine,edge,entry.protocol,{operation:'QUERY',network:entry.network,prefix:entry.prefix,token:entry.token,distance:null});}
  event(engine,d,entry.protocol.toUpperCase(),'DUAL ACTIVE',`${entry.network}/${entry.prefix}: ${reason} Waiting for ${entry.pending.size} neighbor reply/replies.`);
  dualInstall(engine,entry,[]);const activeTime=Number(config(d,entry.protocol)?.activeTime??180000);if(activeTime>0)entry.timer=engine.clock.schedule(Math.max(100,activeTime/2),()=>dualSiaTick(engine,entry),{owner:d.id,label:'EIGRP SIA progress check'});dualComplete(engine,entry);
}
function dualResetPeer(engine:Simulator,edge:Adj,protocol:string,reason:string):void {
  const c=dualContext(engine),key=dualPeerKey(edge,protocol);if(c.blocked.has(key))return;
  const blocked={edge,runtime:edge.from.device.runtime,timer:undefined as any};c.blocked.set(key,blocked);
  event(engine,edge.from.device,protocol.toUpperCase(),'SIA neighbor reset',`${edge.to.ip}: ${reason}`,true);
  for(const[id,p]of c.inflight)if(dualPeerKey(p.edge,protocol)===key){engine.clock.cancel(p.timer);c.inflight.delete(id);}
  for(const entry of c.entries.values())if(entry.deviceId===edge.from.device.id&&entry.protocol===protocol){const pkey=`${edge.from.name}|${edge.to.ip}`;if(entry.pending.delete(pkey))entry.replies.set(pkey,Infinity);entry.candidates=entry.candidates.filter(r=>r.interface!==edge.from.name||r.nextHop!==edge.to.ip);dualComplete(engine,entry);}
  blocked.timer=engine.clock.schedule(1000,()=>dualSend(engine,edge,protocol,{operation:'HELLO'},false),{owner:edge.from.device.id,repeat:1000,label:'EIGRP adjacency recovery hello'});engine.recompute();engine.notify();
}
function reconcileDual(engine:Simulator,graphs:Map<string,Adj[]>):void {
  const c=dualContext(engine);c.graphs=graphs;const wanted=new Set<string>();
  for(const d of engine.lab.devices)for(const protocol of ['eigrp','eigrp6']){
    if(!routing(d)||!d.config.protocols[protocol])continue;
    const entries=new Map<string,DualRoute[]>();for(const[key,routes]of c.candidates)if(key.startsWith(`${d.id}|${protocol}|`))entries.set(key,routes);
    for(const r of d.runtime.routes.filter(r=>r.protocol==='D EX'&&protocolOf(r)===protocol)){const key=dualKey(d,protocol,r.network,r.prefix,r.vrf);entries.set(key,[...(entries.get(key)??[]),{...r,metric:(r as any).wideMetric??r.metric,reportedDistance:Math.max(0,((r as any).wideMetric??r.metric)-256)}]);}
    for(const entry of c.entries.values())if(entry.deviceId===d.id&&entry.protocol===protocol&&!entries.has(entry.key))entries.set(entry.key,[]);
    for(const[key,raw]of entries){let entry=c.entries.get(key);const vrf=entry?.vrf??raw[0]?.vrf,scoped=routingDevice(d,vrf);if(!config(scoped,protocol)){engine.clock.cancel(entry?.timer);c.entries.delete(key);continue;}wanted.add(key);let candidates=raw.filter(r=>!(c.blocked.has(`${d.id}|${protocol}|${r.interface}|${r.nextHop}`)));
      if(entry?.runtime!==d.runtime){engine.clock.cancel(entry?.timer);c.entries.delete(key);entry=undefined;}
      if(!entry){const r=candidates[0];if(!r)continue;entry={key,deviceId:d.id,protocol,vrf:r.vrf,network:r.network,prefix:r.prefix,runtime:d.runtime,state:'PASSIVE',fd:Math.min(...candidates.map(r=>r.metric)),successors:[],candidates,pending:new Map(),upstream:new Map(),replies:new Map(),token:''};c.entries.set(key,entry);dualInstall(engine,entry,candidates);continue;}
      const signature=JSON.stringify(candidates.map(r=>[r.nextHop,r.interface,r.metric,r.reportedDistance,r.dependencyNodes]));if(entry.signature&&entry.signature!==signature&&entry.state==='PASSIVE')entry.replies.clear();entry.signature=signature;
      if(entry.state==='PASSIVE')candidates=candidates.filter(r=>!entry!.replies.has(`${r.interface}|${r.nextHop}`)||Number.isFinite(entry!.replies.get(`${r.interface}|${r.nextHop}`)));
      entry.candidates=candidates;
      if(entry.state==='ACTIVE'){
        const available=new Set((graphs.get(protocol)??[]).filter(e=>e.from.device.id===d.id).map(e=>`${e.from.name}|${e.to.ip}`));for(const pkey of entry.pending.keys())if(!available.has(pkey)){entry.pending.delete(pkey);entry.replies.set(pkey,Infinity);}dualInstall(engine,entry,[]);dualComplete(engine,entry);continue;
      }
      const best=candidates.length?Math.min(...candidates.map(r=>r.metric)):Infinity;
      const feasible=candidates.filter(r=>(r.reportedDistance??Math.max(0,r.metric-256))<entry!.fd);
      if(entry.successors.length&&(!candidates.length||!feasible.length)){dualActivate(engine,entry,'The previous feasible condition no longer holds.');continue;}
      entry.fd=Math.min(entry.fd,best);if(!entry.successors.length&&Number.isFinite(best))entry.fd=best;dualInstall(engine,entry,feasible.length?feasible:candidates);
    }
  }
  for(const[key,entry]of c.entries)if(!wanted.has(key)){engine.clock.cancel(entry.timer);c.entries.delete(key);}
  for(const[key,p]of c.inflight)if(p.runtime!==p.edge.from.device.runtime||!p.edge.from.device.runtime.neighbors.some(n=>n.protocol===p.body.family.toUpperCase()&&n.interface===p.edge.from.name&&sameAddress(n.address??'',p.edge.to.ip)&&n.state==='UP')){engine.clock.cancel(p.timer);c.inflight.delete(key);}
  for(const[key,b]of c.blocked)if(b.runtime!==b.edge.from.device.runtime||!config(b.edge.from.device,key.split('|')[1])){engine.clock.cancel(b.timer);c.blocked.delete(key);}
}
function receiveDual(engine:Simulator,deviceId:string,source:string,destination:string,payload:any,ttl:number,input?:string):void {
  if(eigrpProtocol(payload.family))eigrpTraffic(engine.getDevice(deviceId),payload.family,'received',String(payload.operation??'unknown').toLowerCase(),input?engine.getDevice(deviceId)?.config.interfaces[input]?.vrf:undefined);
  const protocol=payload.family;if(ttl!==1||!eigrpProtocol(protocol))return;const edge=dualPeer(engine,deviceId,source,destination,protocol,input);if(!edge||payload.asn!==config(edge.from.device,protocol)?.asn||payload.sender!==edge.to.device.id)return;
  const c=dualContext(engine),operation=payload.operation;if(!['ACK','HELLO','HELLO-ACK','QUERY','REPLY','SIA-QUERY','SIA-REPLY'].includes(operation)||!Number.isSafeInteger(payload.id)||payload.id<1)return;if(!['HELLO','HELLO-ACK'].includes(operation)&&!eigrpUpdateReady(engine,dualPeerKey(edge,protocol)))return;refreshEigrpHold(engine,dualPeerKey(edge,protocol));
  if(operation==='ACK'){const key=`${deviceId}|${protocol}|${payload.ack}`,pending=c.inflight.get(key);if(pending&&sameAddress(pending.edge.to.ip,source)){engine.clock.cancel(pending.timer);c.inflight.delete(key);}return;}
  if(operation==='HELLO'){dualSend(engine,edge,protocol,{operation:'HELLO-ACK'},false);return;}
  if(operation==='HELLO-ACK'){const key=dualPeerKey(edge,protocol),blocked=c.blocked.get(key);if(blocked){engine.clock.cancel(blocked.timer);c.blocked.delete(key);event(engine,edge.from.device,protocol.toUpperCase(),'Neighbor recovered',`${source}: bidirectional recovery hello completed.`);engine.recompute();engine.notify();}return;}
  dualSend(engine,edge,protocol,{operation:'ACK',ack:payload.id},false);
  const received=`${deviceId}|${payload.sender}|${payload.id}`;if(c.received.has(received))return;c.received.add(received);if(c.received.size>4000)c.received.delete(c.received.values().next().value!);
  if(typeof payload.network!=='string'||!Number.isInteger(payload.prefix))return;const key=dualKey(edge.from.device,protocol,payload.network,payload.prefix,edge.from.iface.vrf);let entry=c.entries.get(key);
  if(operation==='REPLY'||operation==='SIA-REPLY'){
    if(!entry||entry.state!=='ACTIVE'||entry.token!==payload.token)return;const pkey=`${edge.from.name}|${source}`,pending=entry.pending.get(pkey);if(!pending)return;
    if(operation==='SIA-REPLY'&&payload.active){pending.siaAnswered=true;dualPublish(engine,entry);engine.notify();return;}
    entry.pending.delete(pkey);entry.replies.set(pkey,typeof payload.distance==='number'?payload.distance:Infinity);dualComplete(engine,entry);engine.recompute();engine.notify();return;
  }
  if(operation!=='QUERY'&&operation!=='SIA-QUERY')return;
  const own=dualOwnDistance(edge.from.device,protocol,payload.network,payload.prefix,edge.from.iface.vrf);
  if(own!==undefined){dualSend(engine,edge,protocol,{operation:'REPLY',network:payload.network,prefix:payload.prefix,token:payload.token,distance:own});return;}
  if(!entry){dualSend(engine,edge,protocol,{operation:'REPLY',network:payload.network,prefix:payload.prefix,token:payload.token,distance:null});return;}
  const dependency=entry.successors.some(r=>r.interface===edge.from.name&&sameAddress(r.nextHop??'',source));
  if(entry.state==='ACTIVE'){
    if(operation==='SIA-QUERY'){dualSend(engine,edge,protocol,{operation:'SIA-REPLY',network:payload.network,prefix:payload.prefix,token:payload.token,active:true,distance:null});return;}
    if(dependency){entry.upstream.set(`${payload.sender}|${payload.token}`,{edge,token:payload.token});entry.pending.delete(`${edge.from.name}|${source}`);dualComplete(engine,entry);}
    else dualSend(engine,edge,protocol,{operation:'REPLY',network:payload.network,prefix:payload.prefix,token:payload.token,distance:null});return;
  }
  const independent=entry.candidates.filter(r=>!(r.dependencyNodes??[]).includes(payload.sender));
  const feasible=independent.filter(r=>(r.reportedDistance??Infinity)<entry!.fd);
  if(!dependency||feasible.length){const chosen=feasible[0]??independent[0];dualSend(engine,edge,protocol,{operation:'REPLY',network:payload.network,prefix:payload.prefix,token:payload.token,distance:chosen?.metric??null});return;}
  dualActivate(engine,entry,'The successor queried this destination.',{edge,token:payload.token});engine.notify();
}

type RipRoute={network:string;prefix:number;metric:number;tag?:number;redistributionHistory?:string[];origin:'local'|'learned';status:'valid'|'invalid';source?:string;interface?:string;learnedFrom?:string;lastUpdate:number;invalidAt:number;flushAt:number;holdUntil:number;previousMetric:number};
type RipProcess={key:string;deviceId:string;protocol:string;vrf?:string;runtime:Device['runtime'];routes:Map<string,RipRoute>;ports:RoutedPort[];signature:string;timerSignature:string;periodic?:any;trigger?:any;aging?:any;advertised:Map<string,Map<string,number>>;updatesSent:number;updatesReceived:number;periodicOrigin?:number};
type RipContext={processes:Map<string,RipProcess>;peers:Map<string,RoutedPort[]>};
const ripContexts=new WeakMap<Simulator,RipContext>();
function ripContext(engine:Simulator):RipContext {let c=ripContexts.get(engine);if(!c){c={processes:new Map(),peers:new Map()};ripContexts.set(engine,c);}return c;}
function ripTimers(d:Device,protocol:string):{update:number;invalid:number;holddown:number;flush:number}{const t=config(d,protocol)?.timers??{};return{update:Math.max(1,Number(t.update??30))*1000,invalid:Math.max(1,Number(t.invalid??180))*1000,holddown:Math.max(0,Number(t.holddown??(protocol==='ripng'?0:180)))*1000,flush:Math.max(1,Number(t.flush??(protocol==='ripng'?300:240)))*1000};}
function ripPortMetric(p:RoutedPort,protocol:string,direction:string,route:Pick<Route,'network'|'prefix'>,metric:number):number|undefined {
  const cfg=config(p.device,protocol);if(!cfg)return;
  for(const rule of cfg.distributeLists??[]){if(rule.direction!==direction||rule.interface&&rule.interface!==p.name)continue;if(rule.prefixList?!prefixListPermits(p.device,rule.prefixList,route):rule.acl?!routeAclPermits(p.device,rule.acl,route):false)return;}
  const offsets=(cfg.offsetLists??[]).filter((r:any)=>r.direction===direction&&(!r.interface||r.interface===p.name));const applicable=offsets.some((r:any)=>r.interface)?offsets.filter((r:any)=>r.interface):offsets;
  for(const rule of applicable)if(!rule.acl||routeAclPermits(p.device,rule.acl,route))metric+=Number(rule.offset??0);return Math.min(16,metric);
}
function publishRip(engine:Simulator,p:RipProcess):void {
  const original=engine.getDevice(p.deviceId),d=original?routingDevice(original,p.vrf):undefined;if(!d)return;const field=p.protocol==='ripng'?'ripngDatabase':'ripDatabase';
  d.runtime.features[field]=[...(d.runtime.features[field]??[]).filter((r:any)=>(r.vrf??'')!==(p.vrf??'')),...[...p.routes.values()].map(r=>({...r,vrf:p.vrf}))];const stats={updatesSent:p.updatesSent,updatesReceived:p.updatesReceived,timers:ripTimers(d,p.protocol),periodicOrigin:p.periodicOrigin};(d.runtime.features[`${p.protocol}StatsByVrf`]??={})[p.vrf??'']=stats;if(!p.vrf)d.runtime.features[`${p.protocol}Stats`]=stats;
}
function ripInvalidate(engine:Simulator,p:RipProcess,r:RipRoute,reason:string):void {
  if(r.status==='invalid')return;const d=routingDevice(engine.getDevice(p.deviceId)!,p.vrf);r.previousMetric=r.metric;r.metric=16;r.status='invalid';r.holdUntil=engine.clock.now()+ripTimers(d,p.protocol).holddown;
  event(engine,d,p.protocol.toUpperCase(),'Route invalid',`${r.network}/${r.prefix}: ${reason}; metric 16, hold-down until ${r.holdUntil} ms.`);ripTrigger(engine,p);
}
function ripAging(engine:Simulator,p:RipProcess):void {
  engine.clock.cancel(p.aging);p.aging=undefined;const original=engine.getDevice(p.deviceId),d=original?routingDevice(original,p.vrf):undefined;if(!d||!config(d,p.protocol))return;let next=Infinity,changed=false;
  for(const[key,r]of p.routes){
    if(r.origin==='local'&&r.status==='valid')continue;
    if(r.status==='valid'&&r.invalidAt<=engine.clock.now()){ripInvalidate(engine,p,r,'The invalid timer expired without an update');changed=true;}
    if(r.status==='invalid'&&r.flushAt<=engine.clock.now()){p.routes.delete(key);changed=true;event(engine,d,p.protocol.toUpperCase(),'Route flushed',`${r.network}/${r.prefix}: the flush timer expired.`);continue;}
    next=Math.min(next,r.status==='valid'?r.invalidAt:r.flushAt);
  }
  if(Number.isFinite(next))p.aging=engine.clock.schedule(Math.max(1,next-engine.clock.now()),()=>{ripAging(engine,p);engine.recompute();engine.notify();},{owner:p.deviceId,label:`${p.protocol.toUpperCase()} route aging`});
  publishRip(engine,p);if(changed)ripTrigger(engine,p);
}
function ripTrigger(engine:Simulator,p:RipProcess):void {
  if(p.trigger)return;p.trigger=engine.clock.schedule(1000,()=>{p.trigger=undefined;sendRipUpdate(engine,p,true);},{owner:p.deviceId,label:`${p.protocol.toUpperCase()} triggered update`});
}
function classfulPrefix(ip:string):number {const first=Number(ip.split('.')[0]);return first<128?8:first<192?16:24;}
function ripVersions(port:RoutedPort,direction:'send'|'receive'):number[]{return port.iface.features.rip?.[`${direction}Version`]??[Number(config(port.device,'rip')?.version??2)];}
function sendRipUpdate(engine:Simulator,p:RipProcess,triggered=false):void {
  const original=engine.getDevice(p.deviceId),d=original?routingDevice(original,p.vrf):undefined;if(!d?.powered||d.runtime!==p.runtime||!config(d,p.protocol))return;
  for(const port of p.ports){
    if(!engine.interfaceUp(d.id,port.name)||/^loopback/i.test(port.name))continue;
    const cfg={...config(d,p.protocol),...port.iface.features[p.protocol]},neighbors:string[]=(config(d,p.protocol)?.neighbors??[]).filter((ip:string)=>contains(port.ip,port.prefix,ip));if(passive(port,p.protocol)&&!neighbors.length)continue;
    for(const version of p.protocol==='rip'?ripVersions(port,'send'):[2]){
      const records:any[]=[],current=new Map<string,number>(),advertisedKey=`${port.name}|${version}`,previous=p.advertised.get(advertisedKey)??new Map(),summarized=new Map<string,any>();
      for(const r of p.routes.values()){
        let metric=Math.min(16,r.metric+1);if(r.origin==='learned'&&r.interface===port.name&&cfg.splitHorizon!==false){if(cfg.poisonReverse)metric=16;else continue;}
        let network=r.network,prefix=r.prefix;
        if(p.protocol==='rip'&&prefix>0){
          const major=classfulPrefix(network),outside=subnet(port.ip,classfulPrefix(port.ip))!==subnet(network,major);
          if((version===1||config(d,'rip')?.autoSummary)&&outside&&prefix>major){network=subnet(network,major);prefix=major;}
          else if(version===1&&!outside&&prefix!==port.prefix&&prefix!==32)continue;
          const summary=version===2?(cfg.summaries??[]).filter((q:any)=>prefix>q.prefix&&contains(q.network,q.prefix,network)).sort((a:any,b:any)=>b.prefix-a.prefix)[0]:undefined;if(summary){network=subnet(summary.network,summary.prefix);prefix=summary.prefix;}
        }
        const key=`${network}/${prefix}`,old=summarized.get(key);if(!old||metric<old.metric)summarized.set(key,{network,prefix,metric,tag:r.tag,redistributionHistory:r.redistributionHistory});
      }
      for(const[key,record]of summarized){const metric=ripPortMetric(port,p.protocol,'out',record,record.metric);if(metric===undefined)continue;records.push({...record,metric});current.set(key,metric);}
      for(const[key,metric]of previous)if(!current.has(key)&&metric<16){const cut=key.lastIndexOf('/');records.push({network:key.slice(0,cut),prefix:Number(key.slice(cut+1)),metric:16});current.set(key,16);}
      p.advertised.set(advertisedKey,current);
      for(let start=0;start<records.length;start+=8){const entries=records.slice(start,start+8).map(r=>version===1?{network:r.network,metric:r.metric}:r),destinations=[...neighbors,...passive(port,p.protocol)?[]:[p.protocol==='ripng'?'ff02::9':version===1?'255.255.255.255':'224.0.0.9']],transmit=()=>{if(d.runtime!==p.runtime||!engine.interfaceUp(d.id,port.name))return;for(const destination of destinations){engine.sendControlDatagram?.(d.id,port.ip,destination,p.protocol==='ripng'?521:520,{protocol:'rip-update',family:p.protocol,sender:d.id,interface:port.name,version,triggered,records:entries},{interface:port.name,vrf:p.vrf,ttl:p.protocol==='ripng'?255:1,protocol:'udp'});p.updatesSent++;}publishRip(engine,p);};const delay=start/8*Number(config(d,p.protocol)?.outputDelay??0);if(delay)engine.clock.schedule(delay,transmit,{owner:d.id,label:'RIP output pacing'});else transmit();}
    }
  }
  publishRip(engine,p);engine.notify();
}

function ripLocalSeeds(engine:Simulator,p:RipProcess):Map<string,{network:string;prefix:number;metric:number;tag?:number;interface?:string;redistributionHistory?:string[]}> {
  const d=routingDevice(engine.getDevice(p.deviceId)!,p.vrf),cfg=config(d,p.protocol)!,seeds=new Map<string,{network:string;prefix:number;metric:number;tag?:number;interface?:string;redistributionHistory?:string[]}>();
  for(const port of p.ports){if(port.ip.toLowerCase().startsWith('fe80:'))continue;const network=subnet(port.ip,port.prefix);seeds.set(`${network}/${port.prefix}`,{network,prefix:port.prefix,metric:0,interface:port.name});}
  for(const raw of cfg.redistribute??[]){const rule=typeof raw==='string'?{protocol:raw}:raw;
    for(const r of selectedRoutes(d)){
      if(protocolOf(r)!==rule.protocol||rule.protocol===p.protocol||(r.vrf??'')!==(p.vrf??'')||(isIPv6(r.network)?6:4)!==protocolFamily(p.protocol)||r.network.startsWith('fe80:'))continue;
      if(r.protocol==='static'&&!/^null/i.test(r.interface)&&!resolveEgress(d,r.network,r.vrf))continue;
      const history=(r as PolicyRoute).redistributionHistory??[],stamp=`${nodeOf(d,p.vrf)}|${p.protocol}`;if(history.includes(stamp))continue;const exported=applyRouteMap(d,rule.routeMap,{...r,metric:rule.metric??defaultSeedMetric(d,p.protocol,1)??1,tag:rule.tag??r.tag,redistributionHistory:[...history,stamp]});if(!exported||exported.metric>=16)continue;
      const key=`${r.network}/${r.prefix}`;if(!seeds.has(key))seeds.set(key,{network:r.network,prefix:r.prefix,metric:Math.max(0,exported.metric-1),tag:exported.tag,redistributionHistory:exported.redistributionHistory});
    }
  }
  if(cfg.defaultOriginate&&(cfg.defaultAlways||d.runtime.routes.some(r=>r.prefix===0&&(r.vrf??'')===(p.vrf??'')&&(isIPv6(r.network)?6:4)===protocolFamily(p.protocol)))){const network=p.protocol==='ripng'?'::':'0.0.0.0';seeds.set(`${network}/0`,{network,prefix:0,metric:0});}
  return seeds;
}
function synchronizeRip(engine:Simulator,endpoints:RoutedPort[],peers:Map<string,RoutedPort[]>):void {
  const c=ripContext(engine);c.peers=peers;const wanted=new Set<string>();
  for(const d of engine.lab.devices)for(const protocol of ['rip','ripng']){
    if(!routing(d)||!d.config.protocols[protocol])continue;
    const groups=new Map<string,RoutedPort[]>();for(const port of endpoints.filter(p=>p.device.id===d.id&&networkMatch(p,protocol))){const key=port.iface.vrf??'';const group=groups.get(key)??[];if(protocol==='ripng'&&port.ip.startsWith('fe80:'))group.unshift(port);else group.push(port);groups.set(key,group);}
    for(const[vrf,allPorts]of groups){
      const key=`${d.id}|${protocol}|${vrf}`;wanted.add(key);let p=c.processes.get(key);
      if(p&&p.runtime!==d.runtime){engine.clock.cancel(p.periodic);engine.clock.cancel(p.trigger);engine.clock.cancel(p.aging);c.processes.delete(key);p=undefined;}
      if(!p){p={key,deviceId:d.id,protocol,vrf:vrf||undefined,runtime:d.runtime,routes:new Map(),ports:[],signature:'',timerSignature:'',advertised:new Map(),updatesSent:0,updatesReceived:0};c.processes.set(key,p);}
      const current=p;p.ports=allPorts;
      const processDevice=routingDevice(d,vrf||undefined),timers=ripTimers(processDevice,protocol),timerSignature=JSON.stringify(timers);if(p.timerSignature!==timerSignature){p.timerSignature=timerSignature;engine.clock.cancel(p.periodic);p.periodicOrigin=engine.clock.now();p.periodic=engine.clock.schedule(0,()=>sendRipUpdate(engine,current),{owner:d.id,repeat:timers.update,label:`${protocol.toUpperCase()} periodic update`});for(const r of p.routes.values())if(r.origin==='learned'){r.invalidAt=r.lastUpdate+timers.invalid;r.flushAt=r.lastUpdate+timers.flush;}}
      const seeds=ripLocalSeeds(engine,p),signature=JSON.stringify([[...seeds],allPorts.map(q=>[q.name,q.ip,q.iface.features[protocol]]),config(processDevice,protocol),d.config.features.prefixLists,d.config.features.acls]);let changed=p.signature!==signature;p.signature=signature;
      for(const[rkey,r]of p.routes){
        if(r.origin==='local'&&r.status==='valid'&&!seeds.has(rkey)){r.invalidAt=engine.clock.now();r.flushAt=engine.clock.now()+timers.flush;ripInvalidate(engine,p,r,'The originating network or policy was removed');changed=true;}
        else if(r.origin==='learned'&&r.status==='valid'){
          const input=allPorts.find(q=>q.name===r.interface);if(!input||!engine.interfaceUp(d.id,r.interface!)){ripInvalidate(engine,p,r,'The incoming interface is down');changed=true;}
          else if(ripPortMetric(input,protocol,'in',r,r.metric)===undefined){ripInvalidate(engine,p,r,'The inbound distribute list denied the prefix');changed=true;}
        }
      }
      for(const[rkey,seed]of seeds){const old=p.routes.get(rkey);if(!old||old.origin!=='local'||old.status!=='valid'||old.metric!==seed.metric||old.tag!==seed.tag){p.routes.set(rkey,{...seed,origin:'local',status:'valid',lastUpdate:engine.clock.now(),invalidAt:Infinity,flushAt:Infinity,holdUntil:0,previousMetric:seed.metric});changed=true;}}
      ripAging(engine,p);
      d.runtime.routes=d.runtime.routes.filter(r=>!(r.protocol==='R'&&protocolOf(r)===protocol&&(r.vrf??'')===vrf));
      for(const r of p.routes.values())if(r.origin==='learned'&&r.status==='valid'&&r.metric<16&&r.interface&&engine.interfaceUp(d.id,r.interface))addProtocolRoute(routingDevice(d,p.vrf),{network:r.network,prefix:r.prefix,nextHop:r.source,interface:r.interface,protocol:'R',ad:120,metric:r.metric,tag:r.tag,vrf:p.vrf,learnedFrom:r.learnedFrom,...(r.redistributionHistory?{redistributionHistory:r.redistributionHistory}:{})});
      if(protocol==='rip')for(const port of allPorts)for(const summary of port.iface.features.rip?.summaries??[]){const components=[...p.routes.values()].filter(r=>r.status==='valid'&&r.metric<16&&r.prefix>summary.prefix&&contains(summary.network,summary.prefix,r.network)&&r.interface!==port.name);if(components.length)addProtocolRoute(routingDevice(d,p.vrf),{network:subnet(summary.network,summary.prefix),prefix:summary.prefix,interface:'Null0',protocol:'R summary',ad:120,metric:Math.min(...components.map(r=>r.metric)),vrf:p.vrf});}
      if(changed)ripTrigger(engine,p);
      // One source address per outgoing interface; keep link-local first for RIPng.
      p.ports=allPorts.filter((port,index)=>allPorts.findIndex(q=>q.name===port.name)===index);
    }
  }
  for(const[key,p]of c.processes)if(!wanted.has(key)){engine.clock.cancel(p.periodic);engine.clock.cancel(p.trigger);engine.clock.cancel(p.aging);c.processes.delete(key);const d=engine.getDevice(p.deviceId);if(d){const field=p.protocol==='ripng'?'ripngDatabase':'ripDatabase';d.runtime.features[field]=(d.runtime.features[field]??[]).filter((r:any)=>(r.vrf??'')!==(p.vrf??''));delete d.runtime.features[`${p.protocol}StatsByVrf`]?.[p.vrf??''];}}
}
function receiveRip(engine:Simulator,deviceId:string,source:string,payload:any,ttl:number,inputName?:string):void {
  const protocol=payload.family;if(!ripProtocol(protocol)||!Array.isArray(payload.records)||![1,2].includes(payload.version)||protocol==='ripng'&&(ttl!==255||payload.version!==2))return;
  const c=ripContext(engine),d=engine.getDevice(deviceId);if(!d)return;
  for(const p of c.processes.values()){
    if(p.deviceId!==deviceId||p.protocol!==protocol)continue;
    let input:RoutedPort|undefined,remote:RoutedPort|undefined;
    for(const port of p.ports){if(inputName&&port.name!==inputName)continue;const peer=(c.peers.get(endpointKey(port))??[]).find(q=>q.device.id===payload.sender&&q.name===payload.interface&&sameAddress(q.ip,source));if(peer&&(protocol!=='rip'||ripVersions(port,'receive').includes(payload.version))&&networkMatch(peer,protocol)&&authenticationCompatible(engine,port,peer,protocol)){input=port;remote=peer;break;}}
    if(!input||!remote)continue;if(protocol==='rip'&&config(input.device,protocol)?.validateSource!==false&&!contains(input.ip,input.prefix,source)&&!(input.iface.features.secondaryIps??[]).some((p:any)=>contains(p.ip,prefixOf(p.mask),source)))continue;p.updatesReceived++;let changed=false;const timers=ripTimers(input.device,protocol),now=engine.clock.now();
    for(const rawRecord of payload.records){
      const record={...rawRecord};if(protocol==='rip'&&payload.version===1&&typeof record.network==='string'){const major=classfulPrefix(record.network),sameMajor=subnet(record.network,major)===subnet(input.ip,classfulPrefix(input.ip));record.prefix=record.network==='0.0.0.0'?0:sameMajor?subnet(record.network,input.prefix)===record.network?input.prefix:32:major;record.tag=undefined;record.redistributionHistory=undefined;}
      if(typeof record.network!=='string'||!Number.isInteger(record.prefix)||record.prefix<0||record.prefix>(protocol==='ripng'?128:32)||!Number.isFinite(record.metric)||record.metric<1||record.metric>16||(isIPv6(record.network)?6:4)!==protocolFamily(protocol))continue;
      let network:string;try{network=subnet(record.network,record.prefix);}catch{continue;}if(network.startsWith('fe80:'))continue;
      const key=`${network}/${record.prefix}`,metric=ripPortMetric(input,protocol,'in',{network,prefix:record.prefix},record.metric);if(metric===undefined)continue;const old=p.routes.get(key);if(old?.origin==='local'&&old.status==='valid')continue;
      const same=old?.source===source&&old?.interface===input.name;
      if(metric>=16){if(old&&same&&old.status==='valid'){ripInvalidate(engine,p,old,'The neighbor poisoned the route');changed=true;}continue;}
      if(old?.status==='invalid'&&now<old.holdUntil&&!same&&metric>=old.previousMetric)continue;
      if(!old||same||old.status==='invalid'||metric<old.metric){
        const update:RipRoute={network,prefix:record.prefix,metric,tag:record.tag,redistributionHistory:Array.isArray(record.redistributionHistory)?record.redistributionHistory.filter((s:any)=>typeof s==='string').slice(0,16):undefined,origin:'learned',status:'valid',source,interface:input.name,learnedFrom:payload.sender,lastUpdate:now,invalidAt:now+timers.invalid,flushAt:now+timers.flush,holdUntil:0,previousMetric:metric};
        if(!old||old.metric!==metric||old.status!=='valid'||old.source!==source||old.interface!==input.name||old.tag!==record.tag)changed=true;p.routes.set(key,update);
      }
    }
    if(changed)ripTrigger(engine,p);ripAging(engine,p);publishRip(engine,p);engine.recompute();engine.notify();break;
  }
}

function ipNumber(ip: string): number {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return NaN;
  return ((p[0] * 0x1000000) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}
function numberIp(n: number): string { return [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.'); }
function mask(prefix: number): number { return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; }
function prefixOf(value?: string): number {
  if (!value) return 24;
  if (/^\d{1,2}$/.test(value)) return Math.min(32, Math.max(0, Number(value)));
  const n = ipNumber(value); if (!Number.isFinite(n)) return 24;
  let p = 0; for (let bit = 31; bit >= 0 && ((n >>> bit) & 1); bit--) p++;
  return p;
}
function contains(network: string, prefix: number, ip: string): boolean {
  return prefixContains(network,prefix,ip);
}
function subnet(ip: string, prefix: number): string { return isIPv6(ip)?ipv6Network(ip,prefix):numberIp((ipNumber(ip) & mask(prefix)) >>> 0); }
function switching(d: Device): boolean { return d.kind === 'switch' || d.kind === 'poeswitch' || d.kind === 'l3switch' || isDatacenter(d); }
function routing(d: Device): boolean { return d.powered && (d.kind === 'router' || ((d.kind === 'l3switch'||isDatacenter(d)) && d.config.ipRouting)); }
function nodeOf(d: Device, vrf?: string): string { return `${d.id}\u0000${vrf ?? ''}`; }
function portKey(p: Port): string { return `${p.device.id}\u0000${p.name}`; }
function endpointKey(p:RoutedPort):string { return `${portKey(p)}|${p.ip}`; }
function ospfProtocol(protocol:string):boolean {return protocol==='ospf'||protocol==='ospfv3'||protocol==='ospfv3ipv4';}
function eigrpProtocol(protocol:string):boolean {return protocol==='eigrp'||protocol==='eigrp6';}
function ripProtocol(protocol:string):boolean {return protocol==='rip'||protocol==='ripng';}
function protocolFamily(protocol:string):4|6 {return protocol==='ospfv3'||protocol==='ripng'||protocol==='eigrp6'?6:4;}
function areaId(value:any):string {return typeof value==='string'&&value.includes('.')?String(ipNumber(value)):String(value??0);}
function natural(a: string, b: string): number { return a.localeCompare(b, 'en', { numeric: true }); }
export function bridgeMac(d: Device): string {
  if (d.config.features.bridgeMac) return String(d.config.features.bridgeMac).replace(/[:.]/g, '').toLowerCase();
  let h = 2166136261; for (const c of d.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `0200${(h >>> 0).toString(16).padStart(8, '0')}`;
}
function config(d: Device, protocol: string): RoutingConfig | undefined {
  const c = d.config.protocols[protocol]; return c && !c.placeholder && c.enabled !== false ? c : undefined;
}
function routerId(d: Device, protocol: string): string {
  return (protocol==='ospf'?activeIOSOSPFRouterId(d):undefined) || config(d, protocol)?.routerId || Object.values(d.config.interfaces).filter(i => i.ip).sort((a,b) => Number(/^loopback/i.test(b.name))-Number(/^loopback/i.test(a.name))||ipNumber(b.ip!) - ipNumber(a.ip!))[0]?.ip || '0.0.0.0';
}
function port(engine: Simulator, id: string, name: string): Port | undefined {
  const device = engine.getDevice(id), iface = device?.config.interfaces[name];
  return device && iface ? { device, iface, name } : undefined;
}
function wires(engine: Simulator): Wire[] {
  return engine.lab.links.flatMap(link => {
    const a = port(engine, link.a.deviceId, link.a.port), b = port(engine, link.b.deviceId, link.b.port);
    return link.enabled && a && b && engine.interfaceUp(a.device.id,a.name) && engine.interfaceUp(b.device.id,b.name) ? [{ link, a, b }] : [];
  });
}
function event(engine: Simulator, d: Device, protocol: string, label: string, detail: string, warning = false): void {
  if(protocol==='EIGRP'||protocol==='EIGRP6'){const key=protocol.toLowerCase(),cfg=config(d,key),rows=d.runtime.features[`${key}Events`]??=[];rows.push({time:engine.clock.now(),label,detail});rows.splice(0,Math.max(0,rows.length-Number(cfg?.eventLogSize??500)));if(cfg?.logNeighborChanges!==false&&/neighbor|hold|clear/i.test(label))engine.log?.(d.id,`%DUAL-5-NBRCHANGE: ${label}: ${detail}`,warning?4:5);}
  engine.emit({ nodeId: d.id, protocol, label, detail, disposition: warning ? 'warning' : 'info' });
}
function effectiveTrunk(p: Port): boolean { return !!p.device.runtime.features.trunks?.[p.name]?.operational; }
function carries(p: Port, vlan: number): boolean {
  return !vpcPortReason(p.device,p.name,vlan)&&p.iface.switchport && (effectiveTrunk(p) ? p.iface.allowedVlans === null || p.iface.allowedVlans.includes(vlan) : p.iface.vlan === vlan || switchVoiceVlan(p.device,p.iface) === vlan);
}
function channelActive(p: Port): boolean {
  const group = p.iface.features.channelGroup;
  return !group || !!p.device.runtime.features.portChannels?.[group]?.activeMembers.includes(p.name);
}
function vlanActive(d: Device, vlan: number): boolean { return d.config.vlans[vlan]?.active !== false && (!!d.config.vlans[vlan] || vlan === 1); }

function negotiateTrunks(engine:Simulator,_ws:Wire[]):void{
  for(const d of engine.lab.devices){d.runtime.features.trunks={};for(const[name,iface]of Object.entries(d.config.interfaces))if(iface.switchport){const peer=switchingPeer(engine,d.id,name,'DTP'),m=iface.mode,negotiation=!iface.features.nonegotiate&&peer&&peer.domain===(d.config.features.vtp?.domain??'');const operational=m==='trunk'||!!negotiation&&(m==='dynamic-desirable'&&peer.mode!=='access'||m==='dynamic-auto'&&['trunk','dynamic-desirable'].includes(peer.mode));d.runtime.features.trunks[name]={operational,nativeVlan:iface.nativeVlan,allowedVlans:iface.allowedVlans,partner:peer};}}
}
function synchronizeVtp(_engine:Simulator,_ws:Wire[]):void{/* VLAN databases change only on a delivered VTP message. */}

function channelProtocol(a: string, b: string): string | undefined {
  if (a === 'on' && b === 'on') return 'static';
  if (['active','passive'].includes(a) && ['active','passive'].includes(b) && (a === 'active' || b === 'active')) return 'lacp';
  if (['desirable','auto'].includes(a) && ['desirable','auto'].includes(b) && (a === 'desirable' || b === 'desirable')) return 'pagp';
}
function channelSignature(p: Port, wire = false): string {
  // LACP actor/partner keys are locally significant. VLAN policy is checked
  // among local members, not compared with the neighbor's allowed VLAN list.
  // PAgP and static compatibility retain their existing wire checks.
  if(wire&&['active','passive'].includes(p.iface.features.channelMode))return JSON.stringify([interfaceSpeed(p.device,p.iface),interfaceDuplex(p.device,p.iface)]);
  // VRF names are locally significant. Local members must agree, but the
  // neighboring router may use a different VRF name for the same routed link.
  const layer2=p.iface.switchport?[effectiveTrunk(p),p.iface.vlan,p.iface.nativeVlan,p.iface.allowedVlans===null?null:[...p.iface.allowedVlans].sort((a,b)=>a-b)]:[];
  return JSON.stringify([p.iface.switchport,...layer2,interfaceSpeed(p.device,p.iface),interfaceDuplex(p.device,p.iface),wire?'':p.iface.vrf??'',wire?'':p.iface.mtu]);
}
function negotiateChannels(engine:Simulator,ws:Wire[]):void{
 for(const d of engine.lab.devices){d.runtime.features.portChannels={};for(const[name,iface]of Object.entries(d.config.interfaces)){const group=iface.features.channelGroup;if(!group)continue;const c=d.runtime.features.portChannels[group]??={protocol:iface.features.channelMode==='on'?'static':['active','passive'].includes(iface.features.channelMode)?'lacp':'pagp',members:[],activeMembers:[],standbyMembers:[],state:'down'};c.members.push(name);}
  for(const[group,c]of Object.entries<any>(d.runtime.features.portChannels)){const first=d.config.interfaces[c.members[0]];d.config.interfaces['Port-channel'+group]??={...defaultInterface('Port-channel'+group,first.switchport),mode:first.mode,vlan:first.vlan,nativeVlan:first.nativeVlan,allowedVlans:first.allowedVlans?.slice()??null};const logical=d.config.interfaces['Port-channel'+group];if(!logical.adminUp||logical.features.errDisabled)continue;const configured=c.members.filter((name:string)=>engine.interfaceUp(d.id,name));if(configured.some((name:string)=>channelSignature({device:d,iface:d.config.interfaces[name],name})!==channelSignature({device:d,iface:d.config.interfaces[configured[0]],name:configured[0]}))){c.state='suspended';c.inconsistent=true;continue;}
   for(const name of configured){const iface=d.config.interfaces[name],local={device:d,iface,name},mode=iface.features.channelMode??'on';let peer:any;
    if(mode==='on'){const w=ws.find(w=>w.a.device.id===d.id&&w.a.name===name||w.b.device.id===d.id&&w.b.name===name),remote=w&&(w.a.device.id===d.id?w.b:w.a);if(remote&&remote.iface.features.channelGroup&&(remote.iface.features.channelMode??'on')==='on'&&channelSignature(local,true)===channelSignature(remote,true)){const actor=vpcActor(remote.device,remote.name);peer={deviceId:remote.device.id,port:remote.name,group:remote.iface.features.channelGroup,actorSystem:actor?.systemMac??remote.device.id,actorKey:actor?.key??remote.iface.features.channelGroup,vpcSuspended:vpcAggregationSuspended(remote.device,remote.name)};}}
    else{const protocol=c.protocol==='lacp'?'LACP':'PAGP',received=switchingPeer(engine,d.id,name,protocol);if((!isDatacenter(d)||c.protocol==='lacp'&&nsosFeature(d,'lacp'))&&received&&channelProtocol(mode,received.mode)===c.protocol&&received.signature===channelSignature(local,true)&&received.partner?.deviceId===d.id&&received.partner?.port===name&&received.partner?.group===Number(group)&&received.synchronized&&interfaceDuplex(d,iface)==='full')peer=received;}
    if(!peer||peer.vpcSuspended)continue;const actor=peer.actorSystem??peer.deviceId,actorKey=peer.actorKey??peer.group;if(c.peerActorSystem&&(c.peerActorSystem!==actor||c.peerActorKey!==actorKey)){c.state='suspended';c.inconsistent=true;c.activeMembers=[];break;}c.peerActorSystem=actor;c.peerActorKey=actorKey;c.peerDeviceId=peer.deviceId;c.peerGroup=peer.group;c.activeMembers.push(name);c.state='up';
   }
   if(c.protocol==='lacp'&&c.activeMembers.length){const first=switchingPeer(engine,d.id,c.activeMembers[0],'LACP'),actor=vpcActor(d,c.activeMembers[0]),localSystem=[Number(actor?.systemPriority??d.config.features.lacpSystemPriority??32768),actor?.systemMac??bridgeMac(d)],remoteSystem=[Number(first?.systemPriority??32768),first?.systemMac??''],localControls=Number(localSystem[0])-Number(remoteSystem[0])<0||localSystem[0]===remoteSystem[0]&&natural(String(localSystem[1]),String(remoteSystem[1]))<=0;c.controllingSystem=localControls?d.id:first?.deviceId;c.activeMembers.sort((a:string,b:string)=>{const pa=d.config.interfaces[a],pb=d.config.interfaces[b],ra=switchingPeer(engine,d.id,a,'LACP'),rb=switchingPeer(engine,d.id,b,'LACP');return Number(localControls?pa.features.lacpPortPriority??32768:ra?.portPriority??32768)-Number(localControls?pb.features.lacpPortPriority??32768:rb?.portPriority??32768)||natural(localControls?a:ra?.port??a,localControls?b:rb?.port??b);});const cap=isDatacenter(d)?32:8;c.standbyMembers=c.activeMembers.slice(cap);c.activeMembers=c.activeMembers.slice(0,cap);}
  }
 }
}

function stpPriority(d: Device, vlan: number, boundary: boolean): number {
  const c = d.config.features.stp ?? {};
  if (c.mode === 'mst') {
    const instance = boundary ? undefined : c.mst?.instances?.find((i:any)=>i.vlans.includes(vlan));
    const id=instance?.id??0;return (c.mst?.priorities?.[id] ?? instance?.priority ?? c.priority ?? 32768) + id;
  }
  return (c.vlanPriorities?.[vlan] ?? c.priority ?? (c.uplinkFast?49152:32768)) + vlan;
}
function treePortSetting(p:Port,vlan:number,field:string):number|undefined{const stp=p.device.config.features.stp,instance=stp?.mode==='mst'?(stp.mst?.instances?.find((i:any)=>i.vlans.includes(vlan))?.id??0):vlan;return p.iface.features[stp?.mode==='mst'?'stpMst':'stpVlan']?.[instance]?.[field];}
function portPriority(p:Port,vlan:number):number{return treePortSetting(p,vlan,'port-priority')??p.iface.features.stpPortPriority??128;}
function portCost(p: Port,vlan=1): number {
  const configured=treePortSetting(p,vlan,'cost');if(configured!==undefined)return configured;
  if (p.iface.features.stpCost) return Number(p.iface.features.stpCost);
  const speed = interfaceSpeed(p.device,p.iface);
  const cost = stpDefaultCost(speed,p.device.config.features.stp?.pathcostMethod);
  return cost+(p.device.config.features.stp?.uplinkFast?3000:0);
}
function stpTimer(d:Device,vlan:string|number,name:string,fallback:number):number {return Math.max(1,Number(d.config.features.stp?.vlanTimers?.[vlan]?.[name]??d.config.features.stp?.[name]??fallback))*1000;}
/** Election uses only locally delivered BPDU vectors. No remote configuration or graph SPF. */
function stpVector(root:string,cost:number,bridge:string,port:string):[string,number,string,string]{return[root,cost,bridge,port];}
function compareStp(a:[string,number,string,string],b:[string,number,string,string]):number{return natural(a[0],b[0])||a[1]-b[1]||natural(a[2],b[2])||natural(a[3],b[3]);}
function stpPortId(p:Port,vlan:number):string{return String(portPriority(p,vlan)).padStart(3,'0')+'.'+String(stpPortNumber(p.device,p.name)).padStart(5,'0');}
function stpProposal(tree:any,p:Port,vlan:number):string{return JSON.stringify([tree.rootBridgeId,tree.cost,tree.bridgeId,stpPortId(p,vlan)]);}
function flushStpMac(d:Device,vlan:number,except?:string):void{for(const[key,row]of Object.entries(d.runtime.mac))if(!row.static&&row.vlan===vlan&&(!except||stpPortName(d,row.port)!==stpPortName(d,except)))delete d.runtime.mac[key];}
function stpCarries(p:Port,vlan:number):boolean {
  return /^Port-channel/i.test(p.name)?stpMembers(p.device,p.name).some(name=>carries({device:p.device,iface:p.device.config.interfaces[name],name},vlan)):carries(p,vlan);
}
function stpAttachment(engine:Simulator,p:Port):string {
  if(/^Port-channel/i.test(p.name)){const c=p.device.runtime.features.portChannels?.[p.name.slice(12)];return JSON.stringify([c?.peerActorSystem??c?.peerDeviceId,c?.peerActorKey??c?.peerGroup]);}
  const link=engine.lab.links.find(l=>l.enabled&&(l.a.deviceId===p.device.id&&l.a.port===p.name||l.b.deviceId===p.device.id&&l.b.port===p.name));
  return JSON.stringify(link&&[link.id,link.a,link.b]);
}
function spanningTree(engine: Simulator): number | undefined {
  const session=state.get(engine)!,now=engine.clock.now();let next:number|undefined;
  for(const d of engine.lab.devices.filter(switching)){
    const old=d.runtime.stp;d.runtime.stp={};if(!d.powered)continue;
    const vlans=new Set([1,...Object.values(d.config.vlans).filter(v=>v.active).map(v=>v.id),...Object.values(d.config.interfaces).filter(i=>i.switchport).flatMap(i=>[i.vlan,i.nativeVlan])]);
    for(const vlan of [...vlans].sort((a,b)=>a-b)){
      if(!vlanActive(d,vlan))continue;
      const localPorts=stpInterfaces(d).map(iface=>({device:d,iface,name:iface.name})).filter(p=>stpCarries(p,vlan));
      const valid=(p:Port)=>{const s=stpHeartbeats.get(engine)?.get(`${d.id}|${p.name}`),rx=s&&s.attachment===stpAttachment(engine,p)?s.received.get(String(vlan)):undefined;return rx&&engine.interfaceUp(d.id,p.name)&&channelActive(p)&&!p.iface.features.bpdufilter&&rx.received+stpLifetime(rx)>now&&(rx.mode!=='mst'||(rx.hops??20)>0)?rx:undefined;};
      const boundary=localPorts.some(p=>{const rx=valid(p);return rx&&(d.config.features.stp?.mode==='mst'||rx.mode==='mst')&&(rx.mode!==(d.config.features.stp?.mode??'rapid-pvst')||rx.region!==mstRegion(d));});
      const sharedMac=nsosConfig(d).vpc?.peerSwitch&&vpcRuntime(d)?.adjacency?vpcRuntime(d)!.systemMac:bridgeMac(d);
      const bridgeId=`${String(stpPriority(d,vlan,boundary)).padStart(6,'0')}.${sharedMac}`;
      let rootId=d.id,rootBridgeId=bridgeId,cost=0,rootPort:Port|undefined,rootRx:StpBPDU|undefined;
      let best=stpVector(bridgeId,0,bridgeId,'');
      for(const p of localPorts){const rx=valid(p),guard=stpHeartbeats.get(engine)?.get(`${d.id}|${p.name}`)?.blocked.has(String(vlan));if(!rx||guard||p.iface.features.rootGuard||rx.rootId===d.id||rx.role!=='designated')continue;
        const candidate=stpVector(rx.rootBridgeId,rx.cost+portCost(p,vlan),rx.bridgeId,rx.portId);
        const cmp=compareStp(candidate,best);if(cmp<0||cmp===0&&rootPort&&natural(stpPortId(p,vlan),stpPortId(rootPort,vlan))<0){best=candidate;rootId=rx.rootId;rootBridgeId=rx.rootBridgeId;cost=candidate[1];rootPort=p;rootRx=rx;}
      }
      const tree=d.runtime.stp[String(vlan)]={rootId,bridgeId,rootBridgeId,cost,mode:d.config.features.stp?.mode??'rapid-pvst',boundary,hops:rootRx?.mode==='mst'&&rootRx.region===mstRegion(d)?Math.max(0,(rootRx.hops??20)-1):d.config.features.stp?.mst?.maxHops??20,rootPort:rootPort?.name,ports:{} as Record<string,StpPortState>,messageAge:rootRx?rootRx.age+1000+now-rootRx.received:0,maxAge:rootRx?.maxAge??stpTimer(d,vlan,'maxAge',20),helloTime:rootRx?.helloTime??stpTimer(d,vlan,'helloTime',2),forwardTime:rootRx?.forwardTime??stpTimer(d,vlan,'forwardTime',15)};
      const rootChanged=old[String(vlan)]?.rootBridgeId!==rootBridgeId||old[String(vlan)]?.cost!==cost;
      let topologyChanged=false;
      const portChanges:{name:string;previous?:StpPortState;classic:boolean}[]=[];
      for(const p of localPorts){const{name,iface}=p,previous=old[String(vlan)]?.ports[name],rx=valid(p),heartbeat=stpHeartbeats.get(engine)?.get(`${d.id}|${name}`);
        let role=rootPort?.name===name?'root':'designated';
        if(role!=='root'&&rx&&rx.role==='designated'&&compareStp(stpVector(rx.rootBridgeId,rx.cost,rx.bridgeId,rx.portId),stpVector(rootBridgeId,cost,bridgeId,stpPortId(p,vlan)))<0)role=rx.bridgeId===bridgeId?'backup':'alternate';
        const up=engine.interfaceUp(d.id,name)&&channelActive(p),rootGuard=!!iface.features.rootGuard&&!!rx&&compareStp(stpVector(rx.rootBridgeId,rx.cost,rx.bridgeId,rx.portId),stpVector(rootBridgeId,cost,bridgeId,stpPortId(p,vlan)))<0;
        const loopGuard=loopguardEnabled(d,iface)&&!iface.features.bpdufilter&&!!(heartbeat?.blocked.has(String(vlan))||heartbeat?.lost.has(String(vlan)));
        const bpduGuard=!!iface.features.errDisabled&&d.runtime.features.errdisableCauses?.[name]==='bpduguard';
        const bridgeAssurance=iface.features.stpPortType==='network'&&d.config.features.stp?.bridgeAssurance!==false&&!iface.features.bpdufilter&&(!rx||!rx.bridgeAssurance||now-rx.received>=3*tree.helloTime);
        const edge=!!iface.features.bpdufilter||portfastConfigured(d,iface)&&!rx;
        const physical=stpMembers(d,name)[0],shared=iface.features.stpLinkType==='shared'||iface.features.stpLinkType!=='point-to-point'&&interfaceDuplex(d,d.config.interfaces[physical]??iface)==='half';
        const classic=d.config.features.stp?.mode==='pvst'||!!d.runtime.features.stpLegacy?.[name]||shared;
        const signature=JSON.stringify([rootBridgeId,role,up,rootGuard,loopGuard,bpduGuard,bridgeAssurance,edge,classic,iface.features.bpdufilter,stpAttachment(engine,p)]);
        const key=`${d.id}|${vlan}|${name}`;let transition=session.transitions.get(key);
        if(!transition||transition.signature!==signature||transition.start>now||!previous){transition={signature,start:now};session.transitions.set(key,transition);}
        if(classic&&d.config.features.stp?.uplinkFast&&role==='root'&&previous?.role==='alternate'&&Object.entries(old[String(vlan)]?.ports??{}).some(([n,p])=>p.role==='root'&&!engine.interfaceUp(d.id,n))){transition.start=now-2*tree.forwardTime;event(engine,d,'STP','UplinkFast failover',`VLAN ${vlan}: alternate ${name} becomes the forwarding root port.`);}
        const elapsed=now-transition.start,blocked=['alternate','backup'].includes(role)||!up||rootGuard||loopGuard||bpduGuard||bridgeAssurance;
        // A delivered proposal synchronizes this bridge before the root-port agreement.
        const receivedProposal=rx&&JSON.stringify([rx.rootBridgeId,rx.cost,rx.bridgeId,rx.portId]);
        if(role==='root'&&rx?.proposal&&!classic)heartbeat?.accepted.set(String(vlan),receivedProposal!);
        const proposed=role==='root'&&!classic&&!!receivedProposal&&heartbeat?.accepted.get(String(vlan))===receivedProposal;
        const agreed=heartbeat?.agreements.get(String(vlan))===stpProposal(tree,p,vlan);
        const readyRapid=role==='root'&&!!rx||proposed||agreed||!rx&&elapsed>=1000;
        let status:StpPortState['state']=blocked?(up?'blocking':'disabled'):edge?'forwarding':classic?(elapsed<tree.forwardTime?'listening':elapsed<2*tree.forwardTime?'learning':'forwarding'):readyRapid?'forwarding':elapsed<2*tree.forwardTime?'discarding':'forwarding';
        if(rootChanged&&role==='designated'&&!edge&&!classic&&!agreed)status='discarding';
        if(bpduGuard){status='disabled';role='bpdu-inconsistent';}else if(rootGuard){status='blocking';role='root-inconsistent';}else if(loopGuard){status='blocking';role='loop-inconsistent';}else if(bridgeAssurance&&up){status='blocking';role='bridge-assurance-inconsistent';}
        // Remember eligibility while the received vector is valid. Another port's
        // expiry can recompute this port as designated before its own timer fires.
        if(heartbeat&&rx){const eligible=heartbeat.nonDesignated??=new Set<string>();if(['root','alternate','backup'].includes(role))eligible.add(String(vlan));else eligible.delete(String(vlan));}
        if(!blocked&&!edge&&status!=='forwarding'){const ready=transition.start+(classic?(elapsed<tree.forwardTime?tree.forwardTime:2*tree.forwardTime):!rx?1000:2*tree.forwardTime);if(ready>now)next=next===undefined?ready:Math.min(next,ready);}
        tree.ports[name]={state:status,role,rootId,cost:portCost(p,vlan),edge,bpduGuard,proposal:!classic&&role==='designated'&&!agreed,agreement:proposed?JSON.stringify([rx!.rootBridgeId,rx!.cost,rx!.bridgeId,rx!.portId]):undefined,portPriority:portPriority(p,vlan),portNumber:stpPortNumber(d,name),linkType:shared?'shared':'point-to-point',members:/^Port-channel/i.test(name)?stpMembers(d,name).slice():undefined};
        portChanges.push({name,previous,classic});
      }
      applyVPCSpanningTree(engine,d,vlan);
      // Events and CAM aging must reflect the final coordinated port state,
      // including guards received over the vPC peer-link.
      for(const {name,previous,classic}of portChanges){
        const current=tree.ports[name];
        if(previous?.state!==current.state||previous?.role!==current.role){
          event(engine,d,'STP',`${name} ${current.state}`,`VLAN ${vlan}: ${current.role} port; root ${rootId}.`,!!current.bpduGuard);
          if(previous&&!current.edge&&(current.state==='forwarding'||classic&&previous.state==='forwarding'))topologyChanged=true;
        }
      }
      if(topologyChanged){flushStpMac(d,vlan);const changes=d.runtime.features.stpTopology??={};changes[String(vlan)]={count:(changes[String(vlan)]?.count??0)+1,time:now,id:`${d.id}:${vlan}:${now}`};}
    }
  }
  return next;
}
function stpLifetime(rx:StpBPDU):number{return Math.max(0,Math.min(rx.maxAge-rx.age,rx.mode==='pvst'?Infinity:3*rx.helloTime));}
function stpExpiry(engine:Simulator,s:StpHeartbeat):void{
  engine.clock.cancel(s.expiry);s.expiry=undefined;const d=engine.getDevice(s.deviceId),iface=d?.config.interfaces[s.port];if(!d||!iface)return;
  const now=engine.clock.now();let next=Infinity,changed=false;
  for(const[vlan,rx]of s.received){const at=rx.received+stpLifetime(rx);if(at<=now){const previous=d.runtime.stp[vlan]?.ports[s.port];if(['root','alternate','backup','loop-inconsistent'].includes(previous?.role??'')||s.nonDesignated?.has(vlan))s.lost.add(vlan);s.nonDesignated?.delete(vlan);if(loopguardEnabled(d,iface)&&s.lost.has(vlan)&&!iface.features.bpdufilter)s.blocked.add(vlan);s.received.delete(vlan);s.agreements.delete(vlan);s.accepted.delete(vlan);changed=true;}else next=Math.min(next,at);}
  if(Number.isFinite(next))s.expiry=engine.clock.schedule(next-now,()=>stpExpiry(engine,s),{owner:d.id,label:'STP received BPDU expiry'});
  if(changed){event(engine,d,'STP',s.blocked.size?`${s.port} loop-inconsistent`:`${s.port} BPDU expired`,'Received spanning-tree information aged out.',!!s.blocked.size);engine.recompute();engine.notify();}
}
function sendStp(engine:Simulator,s:StpHeartbeat):void{
  const d=engine.getDevice(s.deviceId),iface=d?.config.interfaces[s.port];if(!d||!iface||!engine.interfaceUp(d.id,s.port)||iface.features.bpdufilter)return;
  const now=engine.clock.now(),vlans:any[]=[];
  const window=Math.floor(now/1000);if(s.window!==window){s.window=window;s.sentCount=0;}if((s.sentCount??0)>=Number(d.config.features.stp?.transmitHoldCount??6))return;
  for(const[vlan,tree]of Object.entries(d.runtime.stp)){const p=tree.ports[s.port];if(!p||(!['designated','root'].includes(p.role??'')&&iface.features.stpPortType!=='network')||p.state==='disabled')continue;
    if(iface.features.bpdufilter!==false&&d.config.features.stp?.bpdufilterDefault&&p.edge&&now-s.created>3000)continue;
    const rootRx=tree.rootPort&&stpHeartbeats.get(engine)?.get(`${d.id}|${tree.rootPort}`)?.received.get(vlan),age=rootRx?rootRx.age+1000+now-rootRx.received:0;
    const port={device:d,iface,name:s.port},proposal=stpProposal(tree,port,Number(vlan)),tc=d.runtime.features.stpTopology?.[vlan],body={vlan,rootId:tree.rootId,rootBridgeId:tree.rootBridgeId,bridgeId:tree.bridgeId,cost:tree.cost,portId:stpPortId(port,Number(vlan)),mode:d.config.features.stp?.mode??'rapid-pvst',region:mstRegion(d),hops:tree.hops,age,maxAge:tree.maxAge,helloTime:tree.helloTime,forwardTime:tree.forwardTime,role:p.role,proposal:p.proposal,agreement:p.agreement,tc:tc&&now-tc.time<2*tree.helloTime?tc.id:undefined};
    const coordinated=vpcSTP(engine,d,s.port,Number(vlan));if(coordinated){Object.assign(body,coordinated);body.portId='128.'+String(vpcMemberId(d,s.port)).padStart(5,'0');body.role=coordinated.role;}
    Object.assign(body,{bridgeAssurance:iface.features.stpPortType==='network'&&d.config.features.stp?.bridgeAssurance!==false});
    const sig=JSON.stringify([proposal,body.role,body.proposal,body.agreement,body.mode,body.region,body.maxAge,body.helloTime,body.forwardTime,body.tc]);
    if(s.sent.get(vlan)===sig&&now-(s.lastSent.get(vlan)??-Infinity)<tree.helloTime)continue;
    s.sent.set(vlan,sig);s.lastSent.set(vlan,now);vlans.push(body);
  }
  if(vlans.length){s.sentCount=(s.sentCount??0)+1;const counters=(d.runtime.features.stpCounters??={})[s.port]??={sent:0,received:0};counters.sent++;engine.sendLinkControl?.(d.id,stpMembers(d,s.port).find(name=>engine.interfaceUp(d.id,name))!,{kind:'link-control',protocol:'STP',body:{deviceId:d.id,port:s.port,vlans}});}
}
function synchronizeStpHeartbeats(engine:Simulator):void{
  let sessions=stpHeartbeats.get(engine);if(!sessions){sessions=new Map();stpHeartbeats.set(engine,sessions);}const wanted=new Set<string>();
  for(const d of engine.lab.devices.filter(switching))for(const iface of stpInterfaces(d)){
    const name=iface.name,attachment=stpAttachment(engine,{device:d,iface,name});
    if(!engine.interfaceUp(d.id,name)||iface.features.bpdufilter)continue;
    const key=`${d.id}|${name}`;wanted.add(key);let s=sessions.get(key);
    if(s&&(s.runtime!==d.runtime||s.attachment!==attachment)){engine.clock.cancel(s.tx);engine.clock.cancel(s.trigger);engine.clock.cancel(s.expiry);sessions.delete(key);s=undefined;}
    if(!s){s={deviceId:d.id,port:name,attachment,runtime:d.runtime,created:engine.clock.now(),received:new Map(),blocked:new Set(),lastSent:new Map(),sent:new Map(),agreements:new Map(),accepted:new Map(),lost:new Set()};sessions.set(key,s);}
    const member=stpMembers(d,name).find(p=>engine.interfaceUp(d.id,p));if(s.member!==member){s.member=member;s.sent.clear();s.lastSent.clear();}
    if(!loopguardEnabled(d,iface))s.blocked.clear();else for(const vlan of s.lost)s.blocked.add(vlan);
    if(!s.tx)s.tx=engine.clock.schedule(0,()=>sendStp(engine,s!),{owner:d.id,repeat:1000,label:'STP received-vector BPDU'});
    // Changed information is sent immediately, independently of the periodic heartbeat.
    const triggerSignature=JSON.stringify([member,d.config.features.stp,mstRegion(d),Object.entries(d.runtime.stp).map(([v,t])=>[v,t.rootId,t.rootBridgeId,t.bridgeId,t.cost,t.helloTime,t.maxAge,t.forwardTime,t.hops,t.ports[name],d.runtime.features.stpTopology?.[v]?.id])]);
    if(s.triggerSignature!==triggerSignature){s.triggerSignature=triggerSignature;if(!s.trigger)s.trigger=engine.clock.schedule(0,()=>{s!.trigger=undefined;sendStp(engine,s!);},{owner:d.id,label:'STP triggered BPDU'});}
  }
  for(const[key,s]of sessions)if(!wanted.has(key)){engine.clock.cancel(s.tx);engine.clock.cancel(s.trigger);engine.clock.cancel(s.expiry);sessions.delete(key);}
}
function receiveStpHeartbeat(engine:Simulator,d:Device,port:string,payload:any):void{
  const physical=d.config.interfaces[port];if(!physical?.switchport||!stpMemberActive(d,port)||!Array.isArray(payload?.vlans))return;
  const name=stpPortName(d,port),iface=d.config.interfaces[name];if(!iface||!engine.interfaceUp(d.id,name)||iface.features.bpdufilter||physical.features.bpdufilter)return;
  const receivedPort=port;
  port=name;
  const counters=(d.runtime.features.stpCounters??={})[port]??={sent:0,received:0};counters.received++;
  if(errdisableDetectionEnabled(d,'bpduguard')&&bpduguardEnabled(d,iface)){for(const member of stpMembers(d,port))disableInterface(engine,d,member,'bpduguard');disableInterface(engine,d,port,'bpduguard');engine.recompute();engine.notify();return;}
  if(errdisableDetectionEnabled(d,'bpduguard')&&bpduguardEnabled(d,physical)){disableInterface(engine,d,receivedPort,'bpduguard');engine.recompute();engine.notify();return;}
  const s=stpHeartbeats.get(engine)?.get(`${d.id}|${port}`);if(!s)return;let changed=false;
  for(const body of payload.vlans){const vlan=String(body.vlan),tree=d.runtime.stp[vlan];if(!tree?.ports[port]||typeof body.rootId!=='string'||typeof body.rootBridgeId!=='string'||typeof body.bridgeId!=='string'||!Number.isFinite(body.cost)||body.cost<0||!Number.isFinite(body.maxAge)||body.maxAge<=0||body.age>=body.maxAge)continue;
    const rx={...body,vlan,received:engine.clock.now()} as StpBPDU,old=s.received.get(vlan);
    const fields=(r:StpBPDU|undefined)=>r&&JSON.stringify([r.rootId,r.rootBridgeId,r.cost,r.bridgeId,r.portId,r.mode,r.region,r.role,r.proposal,r.agreement,r.tc,r.maxAge,r.helloTime,r.forwardTime,r.bridgeAssurance]);
    if(fields(old)!==fields(rx))changed=true;s.received.set(vlan,rx);s.lost.delete(vlan);if(s.blocked.delete(vlan))changed=true;
    if(rx.mode==='pvst'&&d.config.features.stp?.mode!=='pvst'&&!d.runtime.features.stpLegacy?.[port]){(d.runtime.features.stpLegacy??={})[port]=true;changed=true;}
    if(rx.agreement&&rx.agreement===stpProposal(tree,{device:d,iface,name:port},Number(vlan))&&s.agreements.get(vlan)!==rx.agreement){s.agreements.set(vlan,rx.agreement);changed=true;}
    const seen=d.runtime.features.stpReceivedTC??={},tcKey=vlan+'|'+rx.tc;if(rx.tc&&!seen[tcKey]){seen[tcKey]=engine.clock.now()+60000;flushStpMac(d,Number(vlan),port);const changes=d.runtime.features.stpTopology??={};changes[vlan]={count:changes[vlan]?.count??0,time:engine.clock.now(),id:rx.tc};changed=true;}for(const[k,at]of Object.entries<number>(seen))if(at<engine.clock.now())delete seen[k];
  }
  stpExpiry(engine,s);if(changed){engine.recompute();engine.notify();}
}
function forwardAllowed(p: Port, vlan:number):boolean {
  return carries(p,vlan)&&vlanActive(p.device,vlan)&&channelActive(p)&&stpMemberActive(p.device,p.name)&&stpPortState(p.device,p.name,vlan)?.state==='forwarding';
}
function dot1q(p:Port):number|undefined {
  const f=p.iface.features;
  if(f.dot1qNative)return undefined;
  const v=f.dot1q??f.encapsulationVlan??(typeof f.encapsulation==='object'?f.encapsulation?.vlan:undefined);
  return v===undefined?undefined:Number(v);
}
function routedPorts(engine:Simulator):RoutedPort[] {
  return engine.lab.devices.filter(routing).flatMap(d=>Object.entries(d.config.interfaces).flatMap(([name,iface])=>{
    if(iface.switchport||isDatacenter(d)&&name==='mgmt0'||!engine.interfaceUp(d.id,name))return[];
    const view=routingDevice(d,iface.vrf),entries:RoutedPort[]=[];
    if(iface.ip&&Number.isFinite(ipNumber(iface.ip)))entries.push({device:view,iface,name,ip:iface.ip,prefix:prefixOf(iface.mask),node:nodeOf(d,iface.vrf),family:4});
    if(d.config.ipv6Routing) {
      const addresses=[...(engine.operationalIPv6Addresses?.(d.id,name)??iface.ipv6??[])];
      const linkLocal=d.runtime.features.linkLocalAddresses?.[name];if(linkLocal&&engine.ipv6AddressUsable?.(d.id,name,linkLocal)!==false&&!addresses.some(a=>sameAddress(a.split('/')[0],linkLocal)))addresses.unshift(`${linkLocal}/64`);
      for(const address of addresses){const[ip,prefix]=address.split('/');if(isIPv6(ip))entries.push({device:view,iface,name,ip,prefix:Number(prefix??64),node:nodeOf(d,iface.vrf),family:6});}
    }
    return entries;
  }));
}

/** Discover only interfaces reached by a frame's broadcast domain, never routed graph reachability. */
function broadcastPeers(engine:Simulator, ws:Wire[], source:RoutedPort, endpoints:RoutedPort[]):RoutedPort[] {
  endpoints=endpoints.filter(p=>p.family===source.family);
  if(/^Tunnel/i.test(source.name))return endpoints.filter(p=>p.device.id!==source.device.id&&/^Tunnel/i.test(p.name)&&tunnelNeighbors(engine,source,p));
  const found=new Map<string,RoutedPort>(), visited=new Set<string>();
  const queue:{port:Port;tag?:number;incoming:boolean}[]=[];
  const send=(p:Port,vlan:number)=>queue.push({port:p,tag:effectiveTrunk(p)&&p.iface.nativeVlan!==vlan?vlan:undefined,incoming:false});
  const svi=/^vlan(\d+)$/i.exec(source.name);
  if(svi) for(const [name,iface] of Object.entries(source.device.config.interfaces)) {const p={device:source.device,iface,name};if(forwardAllowed(p,Number(svi[1])))send(p,Number(svi[1]));}
  else if(/^port-channel/i.test(source.name)) {
    const group=source.name.replace(/^port-channel/i,'');
    for(const name of source.device.runtime.features.portChannels?.[group]?.activeMembers??[])queue.push({port:{device:source.device,iface:source.device.config.interfaces[name],name},incoming:false});
  }
  else if(!/^loopback/i.test(source.name)) {
    const physicalName=source.name.split('.')[0];
    const base=source.device.config.interfaces[physicalName]; if(base)queue.push({port:{device:source.device,iface:base,name:physicalName},tag:dot1q(source),incoming:false});
  }
  while(queue.length) {
    const item=queue.shift()!,p=item.port,key=`${portKey(p)}|${item.tag??'u'}|${item.incoming}`;
    if(visited.has(key))continue;visited.add(key);
    if(!item.incoming) {
      for(const w of ws) {const peer=portKey(w.a)===portKey(p)?w.b:portKey(w.b)===portKey(p)?w.a:undefined;if(peer)queue.push({port:peer,tag:item.tag,incoming:true});}
      continue;
    }
    if(p.iface.switchport&&switching(p.device)) {
      // Access ports reject foreign tags; trunks classify untagged data in their native VLAN.
      if(!effectiveTrunk(p)&&item.tag!==undefined&&item.tag!==p.iface.vlan)continue;
      const vlan=effectiveTrunk(p)?item.tag??p.iface.nativeVlan:p.iface.vlan;
      if(!forwardAllowed(p,vlan))continue;
      for(const ep of endpoints)if(ep.device.id===p.device.id&&ep.name.toLowerCase()===`vlan${vlan}`)found.set(endpointKey(ep),ep);
      for(const [name,iface]of Object.entries(p.device.config.interfaces)) {
        const out={device:p.device,iface,name};
        if(name!==p.name&&forwardAllowed(out,vlan)&&vpcEgressAllowed(p.device,p.name,name,vlan))send(out,vlan);
      }
    } else for(const ep of endpoints) {
      const channel=p.iface.features.channelGroup;
      const samePort=ep.name.split('.')[0]===p.name||channel&&ep.name.toLowerCase()===`port-channel${channel}`&&channelActive(p);
      if(ep.device.id!==p.device.id||!samePort)continue;
      if(dot1q(ep)===item.tag)found.set(endpointKey(ep),ep);
    }
  }
  return[...found.values()].filter(p=>portKey(p)!==portKey(source));
}

function networkMatch(p:RoutedPort, protocol:string):NetworkStatement|undefined {
  if(p.family!==protocolFamily(protocol))return;
  const c=config(p.device,protocol);if(!c)return;
  if(protocol==='ospfv3ipv4'){const ll=p.device.runtime.features.linkLocalAddresses?.[p.name];if(!ll||p.device.runtime.features.staticIPv6Dad?.[p.name]?.[ll]?.state&&p.device.runtime.features.staticIPv6Dad[p.name][ll].state!=='preferred')return;}
  const iface=p.iface.features[protocol];
  if(ospfProtocol(protocol)&&iface?.area!==undefined)return{network:subnet(p.ip,p.prefix),prefix:p.prefix,area:iface.area};
  if(protocol==='ripng'&&iface?.enabled)return{network:subnet(p.ip,p.prefix),prefix:p.prefix};
  if(protocol==='eigrp6'&&(iface?.asn===c.asn||c.name&&iface?.asn===undefined&&iface?.enabled!==false))return{network:subnet(p.ip,p.prefix),prefix:p.prefix};
  if(p.family===6&&p.ip.toLowerCase().startsWith('fe80:')) {
    return(c.networks??[]).find(n=>(p.iface.ipv6??[]).some(a=>contains(n.network,n.prefix,a.split('/')[0])));
  }
  return(c.networks??[]).find(n=>contains(n.network,Number(n.prefix),p.ip));
}
function passive(p:RoutedPort,protocol:string):boolean {
  const c=config(p.device,protocol)!;
  if(p.device.kind==='datacenter'&&protocol==='ospf'&&typeof p.iface.features.ospf?.passive==='boolean')return p.iface.features.ospf.passive;
  return(c.passiveInterfaces??[]).includes(p.name)||(c.passiveInterfaces??[]).includes('default')&&!c.activeInterfaces?.includes(p.name)||!!c.passiveDefault&&!c.activeInterfaces?.includes(p.name);
}
function ospfCost(p:RoutedPort,stub=false,protocol=p.family===6?'ospfv3':'ospf'):number {const c=config(p.device,protocol);if(c?.maxMetric&&(!stub||c.maxMetric.includeStub))return 65535;return Math.max(1,Math.min(65535,Number(p.iface.features[protocol]?.cost??(p.device.kind==='datacenter'&&/^Loopback/.test(p.name)?1:Math.floor(Number(c?.referenceBandwidth??(p.device.kind==='datacenter'?40000:100))/Math.max(interfaceBandwidth(p.device,p.iface)/1000,.001))))));}
function deviceTime(engine:Simulator,d:Device):number{return Number(d.config.features.clockEpoch??Date.UTC(2026,0,1))+engine.clock.now()+Number(d.config.features.clockOffset??d.runtime.features.clockOffset??0);}
function activeKeys(engine:Simulator,d:Device,name:string,direction:'send'|'accept'):{id:string;keyString:string;algorithm:string;sendEnd:number}[]{
  const now=deviceTime(engine,d),keys=d.config.features.keychains?.[name]?.keys??{};
  return Object.entries(keys).filter(([,raw])=>{const k=raw as any,l=k[`${direction}Lifetime`];return typeof k.keyString==='string'&&k.keyString.length>0&&(!l||(l.start===undefined||now>=l.start)&&(l.end===undefined||now<=l.end));}).map(([id,raw])=>({id,keyString:(raw as any).keyString,algorithm:(raw as any).algorithm??'md5',sendEnd:(raw as any).sendLifetime?.end??Infinity})).sort((a,b)=>Number(a.id)-Number(b.id));
}
function keychainStates(engine:Simulator):number|undefined {
  let next:number|undefined;
  for(const d of engine.lab.devices){
    d.runtime.features.keychains={};const now=deviceTime(engine,d);
    for(const[name,chain]of Object.entries(d.config.features.keychains??{}) as [string,any][]){
      d.runtime.features.keychains[name]={sendKeyId:activeKeys(engine,d,name,'send')[0]?.id,acceptKeyIds:activeKeys(engine,d,name,'accept').map(k=>k.id)};
      for(const k of Object.values(chain.keys??{}) as any[])for(const dir of['send','accept']){const life=k[`${dir}Lifetime`];if(!life)continue;for(const boundary of[life.start,life.end===undefined?undefined:Number(life.end)+1])if(boundary!==undefined&&boundary>now){const at=engine.clock.now()+boundary-now;next=next===undefined?at:Math.min(next,at);}}
    }
  }
  return next;
}
function protocolAuthentication(engine:Simulator,p:RoutedPort,protocol:string):{mode:string|boolean;send?:{id:string;keyString:string;algorithm?:string};accept:{id:string;keyString:string;algorithm?:string}[]} {
  const f=p.iface.features[protocol]??{},area:any=protocol==='ospf'?Object.entries(config(p.device,protocol)?.areas??{}).find(([id])=>areaId(id)===areaId(networkMatch(p,protocol)?.area))?.[1]:undefined,configured=f.authenticationMode??f.authentication??(f.authenticationKeyChain||f.keyChain?(ospfProtocol(protocol)?'message-digest':'md5'):area?.authentication??'none'),mode=configured==='null'?'none':configured;
  if(mode==='none'||mode===false)return{mode,accept:[]};if(mode==='simple'||mode==='text'){const key=typeof f.authenticationKey==='string'&&f.authenticationKey.length?{id:'0',keyString:f.authenticationKey}:undefined;return{mode,send:key,accept:key?[key]:[]};}
  const keys=(direction:'send'|'accept')=>{const name=f.authenticationKeyChain??f.keyChain;if(name){const list=activeKeys(engine,p.device,name,direction);return ospfProtocol(protocol)?list.sort((a,b)=>a.sendEnd===b.sendEnd?Number(b.id)-Number(a.id):a.sendEnd===Infinity?-1:b.sendEnd===Infinity?1:b.sendEnd-a.sendEnd).map(({id,keyString,algorithm})=>({id,keyString,algorithm})):list.map(({id,keyString})=>({id,keyString}));}return Object.entries(f.messageDigestKeys??{}).map(([id,k])=>({id,keyString:typeof k==='string'?k:(k as any).keyString})).filter(k=>typeof k.keyString==='string'&&k.keyString.length).sort((a,b)=>Number(a.id)-Number(b.id));};
  return{mode,send:keys('send')[0],accept:keys('accept')};
}
function authenticationCompatible(engine:Simulator,from:RoutedPort,to:RoutedPort,protocol:string):boolean {
  const a=protocolAuthentication(engine,from,protocol),b=protocolAuthentication(engine,to,protocol);if(a.mode!==b.mode)return false;if(a.mode==='none'||a.mode===false)return true;return!!a.send&&!!b.send&&a.accept.some(k=>k.id===b.send!.id&&k.keyString===b.send!.keyString&&(k.algorithm??'md5')===(b.send!.algorithm??'md5'))&&b.accept.some(k=>k.id===a.send!.id&&k.keyString===a.send!.keyString&&(k.algorithm??'md5')===(a.send!.algorithm??'md5'));
}
function ospfTimers(p:RoutedPort,protocol:string):{hello:number;dead:number}{const f=p.iface.features[protocol]??{},slow=String(f.networkType??'').includes('non-broadcast')||String(f.networkType??'').startsWith('point-to-multipoint');return{hello:f.helloInterval??(slow?30:10),dead:f.deadInterval??(slow?120:40)};}
function ospfElections(engine:Simulator,endpoints:RoutedPort[],peers:Map<string,RoutedPort[]>,protocol:string):void {
  const field=`${protocol}Interfaces`,old=new Map(engine.lab.devices.map(d=>[d.id,d.runtime.features[field]??{}]));for(const d of engine.lab.devices)d.runtime.features[field]={};
  const visited=new Set<string>();
  // Bootstrap previously unheard peers as before, but do not keep an expired
  // neighbor eligible merely because its Ethernet interface is physically up.
  const received=new Map(endpoints.map(p=>[portKey(p),ospfLiveDetail(engine,p.device.id,protocol as OSPFProtocol,p.iface.vrf)?.neighbors]));
  const alive=(a:RoutedPort,b:RoutedPort)=>{const n=received.get(portKey(a))?.find(n=>n.interface===a.name&&n.deviceId===b.device.id&&n.peerInterface===b.name);return !n||n.state!=='DOWN'&&n.deadAt>engine.clock.now();};
  const priority=(p:RoutedPort)=>Number(p.iface.features[protocol]?.priority??1);
  const order=(a:RoutedPort,b:RoutedPort)=>priority(b)-priority(a)||ipNumber(routerId(b.device,protocol))-ipNumber(routerId(a.device,protocol));
  for(const p of endpoints){
    const network=networkMatch(p,protocol);if(!network||passive(p,protocol)||visited.has(portKey(p)))continue;
    const pf=p.iface.features[protocol]??{};
    if(String(pf.networkType??'').startsWith('point-to-')){p.device.runtime.features[field][p.name]={role:'POINT-TO-POINT',area:areaId(network.area),authenticationMode:protocolAuthentication(engine,p,protocol).mode};visited.add(portKey(p));continue;}
    const members=[p,...(peers.get(endpointKey(p))??[]).filter(q=>{
      const qn=networkMatch(q,protocol),qf=q.iface.features[protocol]??{};
      return qn&&alive(p,q)&&alive(q,p)&&!passive(q,protocol)&&!String(qf.networkType??'').startsWith('point-to-')&&areaId(qn.area)===areaId(network.area)&&(p.family===6||q.prefix===p.prefix&&contains(p.ip,p.prefix,q.ip))&&ospfTimers(p,protocol).hello===ospfTimers(q,protocol).hello&&ospfTimers(p,protocol).dead===ospfTimers(q,protocol).dead&&authenticationCompatible(engine,p,q,protocol);
    })].filter((q,i,all)=>all.findIndex(x=>portKey(x)===portKey(q))===i);
    const eligible=members.filter(q=>priority(q)>0).sort(order);
    const prior=members.map(q=>old.get(q.device.id)?.[q.name]).filter(Boolean).sort((a,b)=>{
      const earlier=(b.members??1)-(a.members??1)||(a.electedAt??0)-(b.electedAt??0);if(earlier)return earlier;
      const ad=eligible.find(q=>q.device.id===a.drDeviceId),bd=eligible.find(q=>q.device.id===b.drDeviceId);return ad&&bd?order(ad,bd):ad?-1:bd?1:0;
    });
    let dr=prior.map(r=>eligible.find(q=>q.device.id===r.drDeviceId)).find(Boolean);
    if(!dr)dr=prior.map(r=>eligible.find(q=>q.device.id===r.bdrDeviceId)).find(Boolean)??eligible[0];
    const bdr=prior.map(r=>eligible.find(q=>q.device.id!==dr?.device.id&&q.device.id===r.bdrDeviceId)).find(Boolean)??eligible.find(q=>q.device.id!==dr?.device.id);
    for(const q of members){visited.add(portKey(q));q.device.runtime.features[field][q.name]={role:q.device.id===dr?.device.id?'DR':q.device.id===bdr?.device.id?'BDR':'DROTHER',drDeviceId:dr?.device.id,drRouterId:dr?routerId(dr.device,protocol):undefined,bdrDeviceId:bdr?.device.id,bdrRouterId:bdr?routerId(bdr.device,protocol):undefined,area:areaId(network.area),authenticationMode:protocolAuthentication(engine,q,protocol).mode,members:members.length,electedAt:prior.find(r=>r.drDeviceId===dr?.device.id)?.electedAt??engine.clock.now()};}
  }
}
function adjacency(engine:Simulator,endpoints:RoutedPort[],peers:Map<string,RoutedPort[]>,protocol:string):Adj[] {
  const edges:Adj[]=[],seen=new Set<string>();
  if(ospfProtocol(protocol))ospfElections(engine,endpoints,peers,protocol);
  for(const from of endpoints) {
    const statement=networkMatch(from,protocol);if(!statement||!ripProtocol(protocol)&&passive(from,protocol))continue;
    for(const to of peers.get(endpointKey(from))??[]) {
      if(to.device.id===from.device.id||to.family!==from.family||!networkMatch(to,protocol)||!ripProtocol(protocol)&&passive(to,protocol))continue;
      if(from.family===4&&(!contains(from.ip,from.prefix,to.ip)||!contains(to.ip,to.prefix,from.ip)))continue;
      const a=config(from.device,protocol)!,b=config(to.device,protocol)!;let area:string|undefined;let neighborState='UP';
      if(ospfProtocol(protocol)) {
        area=areaId(statement.area);if(area!==areaId(networkMatch(to,protocol)!.area)||from.family===4&&from.prefix!==to.prefix)continue;
        if((a.areas?.[area]?.type??'normal')!==(b.areas?.[area]?.type??'normal'))continue;
        const af=from.iface.features[protocol]??{},bf=to.iface.features[protocol]??{};
        if(ospfTimers(from,protocol).hello!==ospfTimers(to,protocol).hello||ospfTimers(from,protocol).dead!==ospfTimers(to,protocol).dead||(af.instanceId??0)!==(bf.instanceId??0)||routerId(from.device,protocol)===routerId(to.device,protocol))continue;
        neighborState=(from.iface.mtu>=to.iface.mtu||af.mtuIgnore)&&(to.iface.mtu>=from.iface.mtu||bf.mtuIgnore)?'FULL':'EXSTART';
        const election=from.device.runtime.features[`${protocol}Interfaces`]?.[from.name],other=to.device.runtime.features[`${protocol}Interfaces`]?.[to.name];
        if(neighborState==='FULL'&&election?.role!=='POINT-TO-POINT'&&other?.role!=='POINT-TO-POINT'&&!['DR','BDR'].includes(election?.role)&&!['DR','BDR'].includes(other?.role))neighborState='2WAY';
      }
      if(eigrpProtocol(protocol)){const an=(a.neighbors??[]).filter((n:any)=>n.interface===from.name),bn=(b.neighbors??[]).filter((n:any)=>n.interface===to.name);if(an.length&&!an.some((n:any)=>sameAddress(n.address,to.ip))||bn.length&&!bn.some((n:any)=>sameAddress(n.address,from.ip)))continue;}
      if(eigrpProtocol(protocol)&&(JSON.stringify(a.metricWeights??[1,0,1,0,0])!==JSON.stringify(b.metricWeights??[1,0,1,0,0])||a.asn!==b.asn||protocol==='eigrp6'&&(routerId(from.device,protocol)==='0.0.0.0'||routerId(to.device,protocol)==='0.0.0.0'||routerId(from.device,protocol)===routerId(to.device,protocol))))continue;
      if(protocol==='rip'&&!ripVersions(from,'receive').some(v=>ripVersions(to,'send').includes(v)))continue;
      if(!authenticationCompatible(engine,from,to,protocol))neighborState='AUTH-FAILED';
      if((a.bfd||from.iface.features[protocol]?.bfd)&&!bfdUp(engine,from,to.ip))neighborState='BFD-DOWN';
      const key=`${portKey(from)}|${portKey(to)}`;if(seen.has(key))continue;seen.add(key);
      from.device.runtime.neighbors.push({protocol:protocol.toUpperCase(),deviceId:to.device.id,interface:from.name,peerInterface:to.name,address:to.ip,state:neighborState,area,asn:b.asn,routerId:routerId(to.device,protocol)});
      if(eigrpProtocol(protocol)&&dualContext(engine).blocked.has(`${from.device.id}|${protocol}|${from.name}|${to.ip}`)){from.device.runtime.neighbors.at(-1)!.state='SIA-DOWN';continue;}
      if(neighborState==='EXSTART'||neighborState==='BFD-DOWN'||neighborState==='AUTH-FAILED')continue;
      if(ospfProtocol(protocol)&&neighborState==='2WAY'&&!from.device.runtime.features[`${protocol}Interfaces`]?.[from.name]?.drDeviceId)continue;
      edges.push({from,to,area,cost:ospfProtocol(protocol)?String(from.iface.features[protocol]?.networkType??'').startsWith('point-to-multipoint')?Number(configuredOSPFNeighbors(engine,from.device.id,protocol as OSPFProtocol,from.iface.vrf,from.name).find((n:any)=>sameAddress(n.address,to.ip))?.cost??ospfCost(from,false,protocol)):ospfCost(from,false,protocol):1,bandwidth:Math.max(1,interfaceBandwidth(from.device,from.iface)),delay:Math.max(1,Number(from.iface.features.delay??10))*10});
    }
  }
  return edges;
}

function areaSequence(existing:string[],area?:string):string[]|undefined {
  if(area===undefined||existing[existing.length-1]===area)return existing;
  const next=[...existing,area];
  if(next.length===2&&next[0]!=='0'&&next[1]!=='0')return;
  if(next.length>3||next.length===3&&(next[1]!=='0'||next[0]==='0'||next[2]==='0'))return;
  return next;
}
function areaViaAbr(existing:string[],area:string|undefined,node:string,edges:Adj[]):string[]|undefined {
  const direct=areaSequence(existing,area);if(direct)return direct;
  if(existing.length===1&&existing[0]!=='0'&&area!=='0'&&edges.some(e=>e.from.node===node&&e.area==='0'))return areaSequence([...existing,'0'],area);
}
function pathsFrom(node:string,edges:Adj[],protocol:string):Map<string,Path[]> {
  const initial:Path={node,edges:[],cost:0,bandwidth:Infinity,delay:0,areas:[],visited:new Set([node])};
  const result=new Map<string,Path[]>([[node,[initial]]]),queue=[initial];
  let count=0;
  while(queue.length&&count++<50000) {
    queue.sort((a,b)=>a.cost-b.cost||natural(a.node,b.node));const current=queue.shift()!;
    if(eigrpProtocol(protocol)&&current.edges.length&&config(current.edges[current.edges.length-1].to.device,protocol)?.stub)continue;
    for(const edge of edges.filter(e=>e.from.node===current.node)) {
      if(current.visited.has(edge.to.node))continue;
      const areas=areaViaAbr(current.areas,edge.area,current.node,edges);if(!areas)continue;
      const bandwidth=Math.min(current.bandwidth,edge.bandwidth),delay=current.delay+edge.delay;
      const cost=eigrpProtocol(protocol)?eigrpVectorMetric(current.edges[0]?.from.device??edge.from.device,protocol,[...current.edges,edge]):current.cost+edge.cost;
      if(ripProtocol(protocol)&&cost>=16)continue;
      const candidate:Path={node:edge.to.node,edges:[...current.edges,edge],cost,bandwidth,delay,areas,visited:new Set([...current.visited,edge.to.node])};
      const old=result.get(candidate.node)??[];
      const sameArea=(p:Path)=>JSON.stringify(p.areas)===JSON.stringify(candidate.areas)&&portKey(p.edges[0]?.to??edge.to)===portKey(candidate.edges[0].to);
      const dominates=(p:Path,q:Path)=>eigrpProtocol(protocol)?p.bandwidth>=q.bandwidth&&p.delay<=q.delay:p.cost<=q.cost;
      if(old.some(p=>sameArea(p)&&dominates(p,candidate)))continue;
      result.set(candidate.node,[...old.filter(p=>!sameArea(p)||!dominates(candidate,p)),candidate]);queue.push(candidate);
    }
  }
  return result;
}

function ospfVirtualLinks(engine:Simulator,endpoints:RoutedPort[],base:Adj[],protocol:string):Adj[] {
  if(protocol!=='ospf')return base;
  const virtual:Adj[]=[],nodes=new Map<string,RoutedPort>();for(const p of endpoints)if(p.family===4&&config(p.device,protocol))nodes.set(p.node,p);
  for(const d of engine.lab.devices)d.runtime.features.ospfVirtualLinks=[];
  for(const local of nodes.values())for(const cfg of config(local.device,protocol)?.virtualLinks??[]){
    const area=areaId(cfg.transitArea),remote=[...nodes.values()].find(p=>p.node!==local.node&&routerId(p.device,protocol)===cfg.routerId),rc=remote&&config(remote.device,protocol);
    const reverse=rc?.virtualLinks?.find((v:any)=>areaId(v.transitArea)===area&&v.routerId===routerId(local.device,protocol));
    const normal=area!=='0'&&(config(local.device,protocol)?.areas?.[area]?.type??'normal')==='normal'&&(rc?.areas?.[area]?.type??'normal')==='normal';
    const virtualEndpoint=(p:RoutedPort,link:any):RoutedPort=>({...p,iface:{...p.iface,features:{...p.iface.features,ospf:{...link,area:'0'}}}}),matching=reverse&&remote&&(cfg.helloInterval??10)===(reverse.helloInterval??10)&&(cfg.deadInterval??40)===(reverse.deadInterval??40)&&authenticationCompatible(engine,virtualEndpoint(local,cfg),virtualEndpoint(remote,reverse),protocol);
    const backbone=remote&&endpoints.some(p=>(p.node===local.node||p.node===remote.node)&&networkMatch(p,protocol)&&areaId(networkMatch(p,protocol)?.area)==='0');
    const path=remote&&normal&&matching&&backbone?(pathsFrom(local.node,base.filter(e=>e.area===area),protocol).get(remote.node)??[]).sort((a,b)=>a.cost-b.cost)[0]:undefined;
    const first=path?.edges[0],last=path?.edges.at(-1),up=!!first&&!!last;
    local.device.runtime.features.ospfVirtualLinks.push({routerId:cfg.routerId,transitArea:area,state:up?'UP':'DOWN',peerDeviceId:remote?.device.id,interface:first?.from.name,cost:path?.cost});
    if(!first||!last||!remote)continue;
    // The virtual backbone edge retains the first physical next hop for real forwarding.
    virtual.push({from:{...first.from,node:local.node},to:{...last.to,node:remote.node,ip:first.to.ip},area:'0',cost:path!.cost,bandwidth:path!.bandwidth,delay:path!.delay});
    local.device.runtime.neighbors.push({protocol:'OSPF',deviceId:remote.device.id,interface:`VirtualLink${area}`,peerInterface:`VirtualLink${area}`,address:last.to.ip,state:'FULL',area:'0',routerId:cfg.routerId,virtual:true});
  }
  return[...base,...virtual];
}

function eigrpVectorMetric(d:Device,protocol:string,components:{bandwidth:number;delay:number;wideLatency?:number;reliability?:number;load?:number}[]):number {
  const bandwidth=Math.min(...components.map(c=>Math.max(1,c.bandwidth)));if(!Number.isFinite(bandwidth))return 0;
  const [k1,k2,k3,k4,k5]=config(d,protocol)?.metricWeights??[1,0,1,0,0],load=Math.max(1,...components.map(c=>c.load??1)),reliability=Math.min(255,...components.map(c=>c.reliability??255)),factor=k5?k5/Math.max(1,reliability+k4):1;
  if(!config(d,protocol)?.name)return Math.floor(256*(k1*10000000/bandwidth+k2*10000000/bandwidth/Math.max(1,256-load)+k3*components.reduce((n,c)=>n+c.delay/10,0))*factor);
  // Default K1/K3 wide vectors use the documented 65536 scale. Links up to 1 Gbit/s use configured delay in microseconds; higher-speed latency derives from bandwidth.
  const latency=components.reduce((n,c)=>n+(c.wideLatency??(c.bandwidth>1000000?10000000*65536/10/c.bandwidth:c.delay*65536/10)),0);
  return Math.floor((k1*10000000*65536/bandwidth+k2*10000000*65536/bandwidth/Math.max(1,256-load)+k3*latency)*factor);
}
function defaultSeedMetric(d:Device,protocol:string,fallback:number|undefined):number|undefined {const m=config(d,protocol)?.defaultMetric;if(m===undefined)return fallback;return typeof m==='number'?m:eigrpVectorMetric(d,protocol,[{bandwidth:m.bandwidth,delay:m.delay*10,reliability:m.reliability,load:m.load}]);}
function eigrpRibMetric(d:Device,protocol:string,metric:number):number {return config(d,protocol)?.name?Math.min(0xffffffff,Math.max(1,Math.floor(metric/Math.max(1,Number(config(d,protocol)?.ribScale??128))))):metric;}
function igpMetric(path:Path,target:RoutedPort,protocol:string):number {
  return ospfProtocol(protocol)?path.cost+ospfCost(target,true,protocol):eigrpProtocol(protocol)?eigrpVectorMetric(path.edges[0]?.from.device??target.device,protocol,[...path.edges.map(e=>({bandwidth:e.bandwidth,delay:e.delay})),{bandwidth:interfaceBandwidth(target.device,target.iface),delay:Number(target.iface.features.delay??10)*10}]):path.cost;
}
function summaryVectorMetric(path:Path,prefix:{network:string;prefix:number},protocol:string,reported=false):number|undefined {
  for(let i=0;i<path.edges.length;i++){const edge=path.edges[i],summary=edge.to.iface.features[protocol]?.summaries?.find((r:any)=>subnet(r.network,r.prefix)===prefix.network&&r.prefix===prefix.prefix),vector=config(edge.to.device,protocol)?.summaryMetrics?.[`${prefix.network}/${prefix.prefix}`];if(!summary||vector?.bandwidth===undefined)continue;
    return eigrpVectorMetric(path.edges[0].from.device,protocol,[...path.edges.slice(reported?1:0,i+1).map(e=>({bandwidth:e.bandwidth,delay:e.delay})),{bandwidth:vector.bandwidth,delay:vector.delay*10,reliability:vector.reliability,load:vector.load}]);
  }
}
function reportedDistance(path:Path,target:RoutedPort,protocol:string):number {
  return eigrpVectorMetric(path.edges[0]?.from.device??target.device,protocol,[...path.edges.slice(1).map(e=>({bandwidth:e.bandwidth,delay:e.delay})),{bandwidth:interfaceBandwidth(target.device,target.iface),delay:Number(target.iface.features.delay??10)*10}]);
}
function eigrpComponents(d:Device,protocol:string,vrf?:string):(Route&{componentMetric:number;internal:boolean})[] {
  const components=d.runtime.routes.flatMap(r=>{
    if((r.vrf??'')!==(vrf??'')||(isIPv6(r.network)?6:4)!==protocolFamily(protocol))return[];
    if(r.protocol==='D'||r.protocol==='D EX')return[{...r,componentMetric:Number((r as any).wideMetric??r.metric),internal:r.protocol==='D'}];
    if(r.protocol!=='connected')return[];const iface=d.config.interfaces[r.interface];if(!iface)return[];
    const p:RoutedPort={device:d,iface,name:iface.name,ip:protocolFamily(protocol)===4?iface.ip??r.network:r.network,prefix:r.prefix,node:nodeOf(d,vrf),family:protocolFamily(protocol)};
    return networkMatch(p,protocol)?[{...r,componentMetric:eigrpVectorMetric(d,protocol,[{bandwidth:interfaceBandwidth(d,iface),delay:Number(iface.features.delay??10)*10}]),internal:true}]:[];
  });
  // A locally redistributed prefix remains a connected/static/etc. RIB route at
  // its origin. Include its permitted seed in the summary without inventing a
  // locally learned D EX route or overriding an EIGRP-enabled connected prefix.
  for(const r of redistributionExports(d,protocol,vrf))if(!components.some(c=>c.internal&&c.network===r.network&&c.prefix===r.prefix))components.push({...r,componentMetric:r.metric,internal:false});
  return components;
}
function automaticEigrpSummary(p:RoutedPort,network:string,prefix:number,external=false):{network:string;prefix:number}|undefined {
  if(p.family!==4||!config(p.device,'eigrp')?.autoSummary)return;
  const major=classfulPrefix(network),net=subnet(network,major);
  if(prefix<=major||contains(net,major,p.ip))return;
  if(external&&!eigrpComponents(p.device,'eigrp',p.iface.vrf).some(r=>r.internal&&r.prefix>major&&contains(net,major,r.network)))return;
  return{network:net,prefix:major};
}
function summarizeAlong(path:Path,network:string,prefix:number,protocol:string,external=false):{network:string;prefix:number} {
  for(const edge of [...path.edges].reverse()) {
    const summaries=edge.to.iface.features[protocol]?.summaries??[];
    const match=summaries.filter((s:any)=>s.prefix<prefix&&contains(s.network,s.prefix,network)).sort((a:any,b:any)=>a.prefix-b.prefix)[0];
    if(match){network=subnet(match.network,match.prefix);prefix=match.prefix;external=false;}
    else if(protocol==='eigrp'){const automatic=automaticEigrpSummary(edge.to,network,prefix,external);if(automatic){network=automatic.network;prefix=automatic.prefix;external=false;}}
  }
  return{network,prefix};
}
function installEigrpSummaries(engine:Simulator,endpoints:RoutedPort[],protocol:string):void {
  const scopes=new Map<string,RoutedPort>();for(const p of endpoints)if(networkMatch(p,protocol))scopes.set(p.node,p);
  for(const local of scopes.values()){
    const d=local.device,components=eigrpComponents(d,protocol,local.iface.vrf);
    for(const p of endpoints.filter(p=>p.node===local.node&&networkMatch(p,protocol)&&!passive(p,protocol)&&engine.interfaceUp(p.device.id,p.name))){
      const summaries:any[]=[...(p.iface.features[protocol]?.summaries??[])];
      if(protocol==='eigrp')for(const r of components.filter(r=>r.internal)){
        const automatic=automaticEigrpSummary(p,r.network,r.prefix);if(automatic&&!summaries.some(s=>s.network===automatic.network&&s.prefix===automatic.prefix))summaries.push({...automatic,ad:5,automatic:true});
      }
      for(const summary of summaries){
        const specific=components.filter(r=>r.prefix>summary.prefix&&contains(summary.network,summary.prefix,r.network)&&r.interface!==p.name);if(!specific.length)continue;
        const m=summary.automatic?undefined:config(d,protocol)?.summaryMetrics?.[`${summary.network}/${summary.prefix}`];
        const distance=m?.distance??(summary.automatic?5:summary.ad??5);if(distance===255)continue;
        const metric=m?.bandwidth!==undefined?eigrpVectorMetric(d,protocol,[{bandwidth:m.bandwidth,delay:m.delay*10,reliability:m.reliability,load:m.load}]):Math.min(...specific.map(r=>r.componentMetric));
        addProtocolRoute(d,{network:subnet(summary.network,summary.prefix),prefix:summary.prefix,interface:'Null0',protocol:'D summary',ad:distance,metric:eigrpRibMetric(d,protocol,metric),...(config(d,protocol)?.name?{wideMetric:metric}:{}),vrf:p.iface.vrf} as Route);
      }
    }
  }
}
function ospfSummary(path:Path,target:RoutedPort,protocol:string,endpoints:RoutedPort[],edges:Adj[]):{network:string;prefix:number;metric:number}|null {
  const area=areaId(networkMatch(target,protocol)?.area),network=subnet(target.ip,target.prefix);
  for(let i=path.edges.length-1;i>=0;i--){
    const edge=path.edges[i];if(edge.area===area)continue;
    const ranges=config(edge.to.device,protocol)?.areas?.[area]?.ranges??[];
    const range=ranges.filter((r:any)=>r.prefix<=target.prefix&&contains(r.network,r.prefix,network)).sort((a:any,b:any)=>b.prefix-a.prefix)[0];
    if(!range)break;if(range.notAdvertise)return null;
    const inside=pathsFrom(edge.to.node,edges.filter(e=>e.area===area),protocol),costs:number[]=[];
    for(const ep of endpoints){const n=networkMatch(ep,protocol);if(!n||areaId(n.area)!==area||ep.prefix<range.prefix||!contains(range.network,range.prefix,ep.ip))continue;
      for(const p of inside.get(ep.node)??[])costs.push(igpMetric(p,ep,protocol));
    }
    return{network:subnet(range.network,range.prefix),prefix:range.prefix,metric:path.edges.slice(0,i+1).reduce((n,e)=>n+e.cost,0)+Number(range.cost??Math.max(1,...costs))};
  }
  return{network,prefix:target.prefix,metric:igpMetric(path,target,protocol)};
}
function routeAclPermits(d:Device,name:string,route:Pick<Route,'network'|'prefix'>):boolean {
  if(name==='0')return true;
  const acl=d.config.features.acls?.[name];if(!acl)return false;
  for(const e of [...(acl.entries??[])].sort((a:any,b:any)=>(a.sequence??10)-(b.sequence??10))){
    if(e.remark||e.action==='remark')continue;
    const wildcard=ipNumber(e.wildcard??'0.0.0.0'),value=ipNumber(route.network),base=ipNumber(e.source??'0.0.0.0');
    if(!Number.isFinite(value)||!Number.isFinite(base)||!Number.isFinite(wildcard))continue;
    if((value&~wildcard)!==(base&~wildcard))continue;
    if(acl.type==='extended'){const target=ipNumber(e.destination??'0.0.0.0'),wc=ipNumber(e.destinationWildcard??'255.255.255.255');if((mask(route.prefix)&~wc)!==(target&~wc))continue;}
    return e.action==='permit';
  }
  return false;
}
function ripPolicyMetric(path:Path,route:Pick<Route,'network'|'prefix'>,metric:number,protocol:string):number|undefined {
  for(const e of [...path.edges].reverse())for(const[p,direction]of[[e.to,'out'],[e.from,'in']] as [RoutedPort,string][]){
    const cfg=config(p.device,protocol)!;
    for(const rule of cfg.distributeLists??[]){if(rule.direction!==direction||rule.interface&&rule.interface!==p.name)continue;
      if(rule.prefixList?!prefixListPermits(p.device,rule.prefixList,route):rule.acl?!routeAclPermits(p.device,rule.acl,route):false)return;
    }
    const offsets=(cfg.offsetLists??[]).filter((r:any)=>r.direction===direction&&(!r.interface||r.interface===p.name));
    const applicable=offsets.some((r:any)=>r.interface)?offsets.filter((r:any)=>r.interface):offsets;
    for(const r of applicable)if(!r.acl||routeAclPermits(p.device,r.acl,route))metric+=Number(r.offset??0);
  }
  return metric<16?metric:undefined;
}
function protocolPolicyPermits(d:Device,protocol:string,direction:string,port:string,route:Route,sourceProtocol?:string):boolean {
  if(eigrpProtocol(protocol)&&route.prefix===0&&config(d,protocol)?.[direction==='in'?'defaultInformationIn':'defaultInformationOut']===false)return false;
  return routePolicyMatches(d,protocol,direction,port,route,{prefix:name=>prefixListPermits(d,name,route),acl:name=>routeAclPermits(d,name,route),map:name=>!!applyRouteMap(d,name,route)},sourceProtocol);
}
function eigrpNextHop(path:Path,protocol:string):string {
  let next=path.edges.at(-1)?.to.ip??'';for(let i=path.edges.length-1;i>=0;i--){const edge=path.edges[i];if(edge.to.iface.features[protocol]?.nextHopSelf!==false||!contains(edge.from.ip,edge.from.prefix,next))next=edge.to.ip;}return next;
}
function eigrpCandidateDefault(path:Path,source:Device,route:Pick<Route,'network'|'prefix'>,protocol:string):boolean {
  return protocol==='eigrp'&&route.prefix===classfulPrefix(route.network)&&(source.config.features.defaultNetworks??[]).includes(route.network)&&path.edges.every(e=>config(e.to.device,protocol)?.defaultInformationOut!==false&&config(e.from.device,protocol)?.defaultInformationIn!==false);
}
function eigrpPolicyMetric(path:Path,route:Pick<Route,'network'|'prefix'>,metric:number,protocol:string):number|undefined {
  for(let index=path.edges.length-1;index>=0;index--){const edge=path.edges[index];
    if(index<path.edges.length-1&&edge.to.name===path.edges[index+1].from.name&&edge.to.iface.features[protocol]?.splitHorizon!==false)return;
    for(const [port,direction]of [[edge.to,'out'],[edge.from,'in']] as [RoutedPort,string][]){
      const candidate={...route,interface:port.name,protocol:'D',ad:90,metric} as Route;if(!protocolPolicyPermits(port.device,protocol,direction,port.name,candidate))return;
      const offsets=(config(port.device,protocol)?.offsetLists??[]).filter((r:any)=>r.direction===direction&&(!r.interface||r.interface===port.name)),rules=offsets.some((r:any)=>r.interface)?offsets.filter((r:any)=>r.interface):offsets;
      for(const rule of rules)if(!rule.acl||routeAclPermits(port.device,rule.acl,route))metric+=Number(rule.offset??0);
    }
  }
  return metric;
}

function eigrpLocalPolicy(d:Device,protocol:string,direction:'in'|'out',port:string,route:Pick<Route,'network'|'prefix'>,metric:number):number|undefined{
  if(!protocolPolicyPermits(d,protocol,direction,port,{...route,interface:port,protocol:'D',ad:90,metric} as Route))return;
  const all=(config(d,protocol)?.offsetLists??[]).filter((r:any)=>r.direction===direction&&(!r.interface||r.interface===port)),rules=all.some((r:any)=>r.interface)?all.filter((r:any)=>r.interface):all;
  for(const rule of rules)if(!rule.acl||routeAclPermits(d,rule.acl,route))metric+=Number(rule.offset??0);return metric;
}
function eigrpAdvertisementMetric(d:Device,protocol:string,r:EigrpAdvertisement):number{return eigrpVectorMetric(d,protocol,[r.vector])+Number(r.vector.offset??0)+Number(r.vector.seedMetric??0);}
function eigrpWideLatency(v:{bandwidth:number;delay:number;wideLatency?:number}):number{return v.wideLatency??(v.bandwidth>1000000?10000000*65536/10/v.bandwidth:v.delay*65536/10);}
function eigrpUpdatePeers(engine:Simulator,edges:Adj[],protocol:EigrpFamily):EigrpUpdatePeer[]{
  const c=helloContext(engine);return edges.flatMap(edge=>{const key=dualPeerKey(edge,protocol),hello=c.peers.get(key),portKey=`${edge.from.device.id}|${protocol}|${edge.from.name}`,port=c.ports.get(portKey);if(!hello?.updateEpoch||!port)return[];return[{key,protocol,deviceId:edge.from.device.id,peerDeviceId:edge.to.device.id,interface:edge.from.name,source:edge.from.ip,destination:edge.to.ip,vrf:edge.from.iface.vrf,asn:Number(config(edge.from.device,protocol)?.asn),localEpoch:eigrpUpdateEpoch(engine,portKey,edge.from.device.runtime,port.signature),remoteEpoch:hello.updateEpoch,runtime:edge.from.device.runtime}];});
}
function installReceivedEigrp(engine:Simulator,endpoints:RoutedPort[],edges:Adj[],protocol:EigrpFamily):void{
  const peers=eigrpUpdatePeers(engine,edges,protocol);synchronizeEigrpUpdatePeers(engine,protocol,peers,peer=>{const c=helloContext(engine),hello=c.peers.get(peer.key);engine.clock.cancel(hello?.expiry);c.peers.delete(peer.key);invalidateEigrpUpdateEpoch(engine,`${peer.deviceId}|${protocol}|${peer.interface}`);const d=engine.getDevice(peer.deviceId);if(d)event(engine,d,protocol.toUpperCase(),'UPDATE retry limit',`${peer.destination} on ${peer.interface}: reliable UPDATE acknowledgement was not received.`,true);engine.recompute();engine.notify();});
  for(const d of engine.lab.devices)d.runtime.features[protocol==='eigrp6'?'eigrp6Topology':'eigrpTopology']=[];
  for(const peer of peers){if(!eigrpUpdateReady(engine,peer.key))continue;const edge=edges.find(e=>dualPeerKey(e,protocol)===peer.key)!,d=edge.from.device,cfg=config(d,protocol)!;
    for(const received of receivedEigrpUpdates(engine,peer.key)){
      if(received.path.includes(edge.from.node)||received.hopCount+1>Number(cfg.maximumHops??100))continue;
      const vector={...received.vector,bandwidth:Math.min(received.vector.bandwidth,edge.bandwidth),delay:received.vector.delay+edge.delay,wideLatency:eigrpWideLatency(received.vector)+eigrpWideLatency(edge)},advertised={...received,vector,hopCount:received.hopCount+1,path:[...received.path,edge.from.node]},raw=eigrpAdvertisementMetric(d,protocol,advertised),metric=eigrpLocalPolicy(d,protocol,'in',peer.interface,received,raw);if(metric===undefined)continue;vector.offset=Number(vector.offset??0)+metric-raw;
      const nextHop=received.nextHop&&contains(edge.from.ip,edge.from.prefix,received.nextHop)?received.nextHop:peer.destination;advertised.nextHop=nextHop;const route:DualRoute={network:received.network,prefix:received.prefix,nextHop,interface:peer.interface,protocol:received.external?'D EX':'D',ad:received.external?170:90,metric,reportedDistance:eigrpAdvertisementMetric(d,protocol,received),dependencyNodes:received.path.map(node=>node.split('\0')[0]),vrf:peer.vrf,learnedFrom:received.origin,tag:received.tag,candidateDefault:received.candidateDefault&&cfg.defaultInformationIn!==false||undefined,eigrpUpdate:advertised};
      route.ad=configuredDistance(d,protocol,route,(name,r)=>routeAclPermits(d,name,r));if(route.ad===255)continue;const c=dualContext(engine),key=dualKey(d,protocol,route.network,route.prefix,peer.vrf),rows=c.candidates.get(key)??[];rows.push(route);c.candidates.set(key,rows);
    }
  }
}
function eigrpLocalOrigins(engine:Simulator,d:Device,vrf:string|undefined,protocol:EigrpFamily,endpoints:RoutedPort[]):EigrpAdvertisement[]{
  const own=endpoints.filter(p=>p.node===nodeOf(d,vrf)&&networkMatch(p,protocol)&&!p.ip.toLowerCase().startsWith('fe80:')),cfg=config(d,protocol)!,origins:EigrpAdvertisement[]=[];
  for(const p of own){const network=subnet(p.ip,p.prefix);if(origins.some(r=>r.network===network&&r.prefix===p.prefix))continue;origins.push({network,prefix:p.prefix,origin:d.id,path:[p.node],hopCount:0,vector:{bandwidth:interfaceBandwidth(d,p.iface),delay:Number(p.iface.features.delay??10)*10},candidateDefault:protocol==='eigrp'&&p.prefix===classfulPrefix(network)&&(d.config.features.defaultNetworks??[]).includes(network)||undefined});}
  for(const exported of redistributionExports(d,protocol,vrf)){
    if(origins.some(r=>r.network===exported.network&&r.prefix===exported.prefix))continue;
    const seed=cfg.defaultMetric,seedVector=seed&&typeof seed==='object'?{bandwidth:seed.bandwidth,delay:seed.delay*10,reliability:seed.reliability,load:seed.load}:undefined,vector:EigrpVector=seedVector&&eigrpVectorMetric(d,protocol,[seedVector])===exported.metric?seedVector:{bandwidth:Number.MAX_SAFE_INTEGER,delay:0,seedMetric:exported.metric};
    origins.push({network:exported.network,prefix:exported.prefix,origin:d.id,path:[nodeOf(d,vrf)],hopCount:0,vector,external:true,tag:exported.tag,redistributionHistory:exported.redistributionHistory});
  }
  if(cfg.defaultOriginate&&(cfg.defaultAlways||d.runtime.routes.some(r=>r.prefix===0&&(r.vrf??'')===(vrf??'')&&(isIPv6(r.network)?6:4)===protocolFamily(protocol))))origins.push({network:protocol==='eigrp6'?'::':'0.0.0.0',prefix:0,origin:d.id,path:[nodeOf(d,vrf)],hopCount:0,vector:{bandwidth:Number.MAX_SAFE_INTEGER,delay:0},external:true});
  return origins;
}
function advertiseSelectedEigrp(engine:Simulator,endpoints:RoutedPort[],protocol:EigrpFamily):void{
  advertiseEigrpUpdates(engine,protocol,peer=>{
    const original=engine.getDevice(peer.deviceId);if(!original)return[];const d=routingDevice(original,peer.vrf),cfg=config(d,protocol),iface=d.config.interfaces[peer.interface];if(!cfg||!iface)return[];
    const p:RoutedPort={device:d,iface,name:peer.interface,ip:peer.source,prefix:protocol==='eigrp'?prefixOf(iface.mask):64,node:nodeOf(d,peer.vrf),family:protocolFamily(protocol)},stub=cfg.stub;if(stub&&(!Array.isArray(stub)||stub.includes('receive-only')))return[];
    const routes=eigrpLocalOrigins(engine,d,peer.vrf,protocol,endpoints).map(r=>({r,input:undefined as string|undefined}));
    if(!stub)for(const route of d.runtime.routes.filter(r=>(r.vrf??'')===(peer.vrf??'')&&protocolOf(r)===protocol&&['D','D EX'].includes(r.protocol))){const r=(route as DualRoute).eigrpUpdate;if(r)routes.push({r:structuredClone(r),input:route.interface});}
    const output=new Map<string,EigrpAdvertisement>();
    for(const {r,input}of routes){
      if(input===peer.interface&&iface.features[protocol]?.splitHorizon!==false||r.path.some(node=>node.split('\0')[0]===peer.peerDeviceId))continue;
      const manual=(iface.features[protocol]?.summaries??[]).filter((s:any)=>s.prefix<r.prefix&&contains(s.network,s.prefix,r.network)).sort((a:any,b:any)=>a.prefix-b.prefix)[0],automatic=protocol==='eigrp'?automaticEigrpSummary(p,r.network,r.prefix,!!r.external):undefined,summary=manual??automatic;
      if(stub&&Array.isArray(stub)&&!(summary?stub.includes('summary'):r.external?stub.includes('redistributed')||stub.includes('static'):stub.includes('connected')))continue;
      let advertised:EigrpAdvertisement={...r,vector:{...r.vector},nextHop:iface.features[protocol]?.nextHopSelf===false&&r.nextHop&&contains(peer.source,p.prefix,r.nextHop)?r.nextHop:undefined,candidateDefault:r.candidateDefault&&cfg.defaultInformationOut!==false||undefined};
      if(summary){const metric=manual&&cfg.summaryMetrics?.[`${subnet(summary.network,summary.prefix)}/${summary.prefix}`];if((metric?.distance??summary.ad)===255)continue;advertised={...advertised,network:subnet(summary.network,summary.prefix),prefix:summary.prefix,origin:d.id,path:[p.node],hopCount:0,external:false,vector:metric?.bandwidth!==undefined?{bandwidth:metric.bandwidth,delay:metric.delay*10,reliability:metric.reliability,load:metric.load}:advertised.vector};}
      const raw=eigrpAdvertisementMetric(d,protocol,advertised),metric=eigrpLocalPolicy(d,protocol,'out',peer.interface,advertised,raw);if(metric===undefined)continue;advertised.vector.offset=Number(advertised.vector.offset??0)+metric-raw;
      const key=`${advertised.network}/${advertised.prefix}`,old=output.get(key);if(!old||Number(!!old.external)>Number(!!advertised.external)||!!old.external===!!advertised.external&&eigrpAdvertisementMetric(d,protocol,old)>metric)output.set(key,advertised);
    }
    return [...output.values()].sort((a,b)=>natural(a.network,b.network)||a.prefix-b.prefix);
  });
}
function installIgp(engine:Simulator,endpoints:RoutedPort[],edges:Adj[],protocol:string,observer?:string):void {
  const nodes=new Map<string,RoutedPort>();for(const p of endpoints)if(p.family===protocolFamily(protocol)&&config(p.device,protocol))nodes.set(p.node,p);
  const areasFor=(node:string)=>ospfAreas(node,endpoints,edges,protocol);
  for(const [node,local]of nodes) {
    if(observer&&local.device.id!==observer)continue;
    const paths=pathsFrom(node,edges,protocol),localConfig=config(local.device,protocol)!;
    const offers:(DualRoute&{loadShare?:boolean})[]=[];
    if(eigrpProtocol(protocol))local.device.runtime.features[protocol==='eigrp6'?'eigrp6Topology':'eigrpTopology']=(local.device.runtime.features[protocol==='eigrp6'?'eigrp6Topology':'eigrpTopology']??[]).filter((r:any)=>(r.vrf??'')!==(local.iface.vrf??''));
    for(const target of endpoints) {
      const statement=networkMatch(target,protocol);if(!statement||target.node===node||target.ip.toLowerCase().startsWith('fe80:'))continue;
      const stub=config(target.device,protocol)?.stub;
      if(eigrpProtocol(protocol)&&(Array.isArray(stub)?stub.includes('receive-only'):stub==='receive-only'))continue;
      const candidates=(paths.get(target.node)??[]).filter(p=>!ospfProtocol(protocol)||areaViaAbr(p.areas,areaId(statement.area),target.node,edges));
      for(const path of candidates) {
        const first=path.edges[0];if(!first)continue;
        const interArea=ospfProtocol(protocol)&&path.areas.some(a=>a!==areaId(statement.area));
        if(interArea&&areasFor(node).size===1&&engine.lab.devices.some(d=>config(d,protocol)?.areas?.[first.area!]?.noSummary))continue;
        const summary=ospfProtocol(protocol)&&interArea?ospfSummary(path,target,protocol,endpoints,edges):undefined;if(summary===null)continue;
        const prefix=eigrpProtocol(protocol)?summarizeAlong(path,subnet(target.ip,target.prefix),target.prefix,protocol):summary??{network:subnet(target.ip,target.prefix),prefix:target.prefix};
        if(eigrpProtocol(protocol)&&stub&&Array.isArray(stub)&&!stub.includes('connected')&&!(stub.includes('summary')&&prefix.prefix<target.prefix))continue;
        if(eigrpProtocol(protocol)&&path.edges.length>Number(localConfig.maximumHops??100))continue;
        let offeredMetric=ripProtocol(protocol)?ripPolicyMetric(path,prefix,igpMetric(path,target,protocol),protocol):eigrpProtocol(protocol)?eigrpPolicyMetric(path,prefix,summaryVectorMetric(path,prefix,protocol)??igpMetric(path,target,protocol),protocol):summary?.metric??igpMetric(path,target,protocol);if(offeredMetric===undefined)continue;
        if(interArea){for(let i=0;i<path.edges.length;i++){const edge=path.edges[i],nextArea=path.edges[i+1]?.area??areaId(statement.area);if(edge.area===nextArea)continue;const override=config(edge.to.device,protocol)?.maxMetric?.summary;if(override!==undefined){offeredMetric=path.edges.slice(0,i+1).reduce((sum,e)=>sum+e.cost,0)+Number(override);break;}}}
        offers.push({...prefix,candidateDefault:eigrpCandidateDefault(path,target.device,prefix,protocol)||undefined,nextHop:eigrpProtocol(protocol)?eigrpNextHop(path,protocol):first.to.ip,interface:first.from.name,protocol:ospfProtocol(protocol)?interArea?'O IA':'O':eigrpProtocol(protocol)?'D':'R',ad:ospfProtocol(protocol)?110:eigrpProtocol(protocol)?90:120,metric:offeredMetric,vrf:local.iface.vrf,learnedFrom:target.device.id,area:ospfProtocol(protocol)?areaId(statement.area):undefined,reportedDistance:eigrpProtocol(protocol)?summaryVectorMetric(path,prefix,protocol,true)??reportedDistance(path,target,protocol):undefined,dependencyNodes:eigrpProtocol(protocol)?path.edges.map(e=>e.to.device.id):undefined});
      }
    }
    // Stub ABRs originate a default into the stub; totally NSSA ABRs do so as well.
    if(ospfProtocol(protocol))for(const target of nodes.values()) {
      const areas=areasFor(target.node);if(!areas.has('0')||areas.size<2||target.node===node)continue;
      for(const path of paths.get(target.node)??[]) {
        const first=path.edges[0],area=first?.area,settings=area&&config(target.device,protocol)?.areas?.[area];
        if(!first||!settings||!path.edges.every(e=>e.area===area)||!(settings.type==='stub'||settings.type==='nssa'&&(settings.noSummary||settings.defaultOriginate)))continue;
        offers.push({network:protocolFamily(protocol)===6?'::':'0.0.0.0',prefix:0,nextHop:first.to.ip,interface:first.from.name,protocol:settings.type==='nssa'&&!settings.noSummary?'O N2':'O IA',ad:110,metric:settings.type==='nssa'&&!settings.noSummary?Number(settings.defaultCost??1):path.cost+Number(settings.defaultCost??1),vrf:local.iface.vrf,learnedFrom:target.device.id});
      }
    }
    // Default origination requires an installed default unless explicitly configured always.
    for(const target of nodes.values()) {
      if(ospfProtocol(protocol)&&observer)continue;
      const c=config(target.device,protocol)!;if(!c.defaultOriginate||target.node===node||!c.defaultAlways&&!target.device.runtime.routes.some(r=>r.prefix===0&&(isIPv6(r.network)?6:4)===protocolFamily(protocol)&&(r.vrf??'')===(target.iface.vrf??'')))continue;
      const best=(paths.get(target.node)??[]).sort((a,b)=>a.cost-b.cost)[0],first=best?.edges[0];if(!first)continue;
      const externalType=ospfProtocol(protocol)?ospfExternalType(engine,target,local,best,endpoints,edges,protocol):'E';if(!externalType)continue;
      const network=protocolFamily(protocol)===6?'::':'0.0.0.0',metric=ripProtocol(protocol)?ripPolicyMetric(best,{network,prefix:0},best.cost,protocol):ospfProtocol(protocol)?1:best.cost;if(metric===undefined)continue;
      offers.push({network,prefix:0,nextHop:first.to.ip,interface:first.from.name,protocol:ospfProtocol(protocol)?`O ${externalType}2`:eigrpProtocol(protocol)?'D EX':'R',ad:ospfProtocol(protocol)?110:eigrpProtocol(protocol)?170:120,metric,vrf:local.iface.vrf,learnedFrom:target.device.id});
    }
    const groups=new Map<string,typeof offers>();for(const r of offers){if(!protocolPolicyPermits(local.device,protocol,'in',r.interface,r))continue;r.ad=configuredDistance(local.device,protocol,r,(name,route)=>routeAclPermits(local.device,name,route));if(r.ad===255)continue;const key=`${r.network}/${r.prefix}`;groups.set(key,[...groups.get(key)??[],r]);}
    if(eigrpProtocol(protocol))for(const entries of groups.values())dualContext(engine).candidates.set(dualKey(local.device,protocol,entries[0].network,entries[0].prefix,local.iface.vrf),entries);
    for(const entries of groups.values()) {
      const rank=(r:Route)=>r.protocol==='O'?0:r.protocol==='O IA'?1:2;
      entries.sort((a,b)=>a.ad-b.ad||(ospfProtocol(protocol)?rank(a)-rank(b):0)||a.metric-b.metric||natural(a.nextHop??'',b.nextHop??''));
      const best=entries[0],fd=best.metric,variance=eigrpProtocol(protocol)&&localConfig.trafficShare!=='min'?Math.max(1,Number(localConfig.variance??1)):1;
      const eligible=entries.filter(r=>r.ad===best.ad&&(!ospfProtocol(protocol)||rank(r)===rank(best))&&r.metric<=fd*variance&&(!eigrpProtocol(protocol)||r.metric===fd||(r.reportedDistance??Infinity)<fd));
      const unique=eligible.filter((r,i)=>eligible.findIndex(x=>x.nextHop===r.nextHop&&x.interface===r.interface)===i).slice(0,Number(localConfig.maximumPaths??4));
      for(const r of unique){r.loadShare=unique.length>1;local.device.runtime.routes.push(r);}
      if(eigrpProtocol(protocol))local.device.runtime.features[protocol==='eigrp6'?'eigrp6Topology':'eigrpTopology'].push({network:best.network,prefix:best.prefix,vrf:local.iface.vrf,state:'PASSIVE',feasibleDistance:fd,successors:unique.map(r=>({nextHop:r.nextHop,interface:r.interface,metric:r.metric,reportedDistance:r.reportedDistance})),feasibleSuccessors:entries.filter(r=>(r.reportedDistance??Infinity)<fd&&r.metric>fd).map(r=>({nextHop:r.nextHop,metric:r.metric,reportedDistance:r.reportedDistance}))});
    }
  }
  if(eigrpProtocol(protocol))installEigrpSummaries(engine,endpoints,protocol);
  if(ospfProtocol(protocol))for(const local of nodes.values())for(const[area,settings]of Object.entries(config(local.device,protocol)?.areas??{}) as [string,any][])for(const summary of settings.ranges??[]){
    if(observer&&local.device.id!==observer||summary.notAdvertise||config(local.device,protocol)?.discardRoutes?.internal===false||areasFor(local.node).size<2)continue;
    const intra=pathsFrom(local.node,edges.filter(e=>e.area===areaId(area)),protocol);
    if(endpoints.some(p=>p.prefix>=summary.prefix&&contains(summary.network,summary.prefix,p.ip)&&areaId(networkMatch(p,protocol)?.area)===areaId(area)&&!!networkMatch(p,protocol)&&intra.has(p.node)))addProtocolRoute(local.device,{network:subnet(summary.network,summary.prefix),prefix:summary.prefix,interface:'Null0',protocol:'O summary',ad:110,metric:Number(summary.cost??0),vrf:local.iface.vrf});
  }
}

type PolicyRoute=Route&{localPreference?:number;med?:number;weight?:number;metricType?:number;redistributionHistory?:string[];communities?:string[]};
function communityPermits(d:Device,name:string,communities:string[],exact=false):boolean {return communityListMatches(d.config.features.communityLists?.[name]??[],communities,!!d.config.features.bgpCommunityNewFormat,exact);}
export function prefixListPermits(d:Device,name:string,route:Pick<Route,'network'|'prefix'>):boolean {
  const raw=d.config.features.prefixLists?.[name];
  const entries:any[]=Array.isArray(raw)?raw:raw?.entries??[];
  for(const entry of [...entries].sort((a,b)=>(a.sequence??10)-(b.sequence??10))) {
    const base=entry.network??entry.prefix?.split?.('/')[0],length=typeof entry.prefix==='number'?entry.prefix:Number(entry.prefix?.split?.('/')[1]);
    if(!base||!Number.isFinite(length)||!contains(base,length,route.network))continue;
    const min=entry.ge??length,max=entry.le??(entry.ge!==undefined?(isIPv6(base)?128:32):length);
    if(route.prefix>=min&&route.prefix<=max)return entry.action==='permit';
  }
  return false;
}
export function asPathMatches(pattern:string,path:number[]):boolean {return matchIOSExpression(pattern,path.slice(0,255).join(' '));}
function asPathPermits(d:Device,name:string,path:number[]):boolean {for(const rule of [...d.config.features.asPathLists?.[name]??[]].sort((a:any,b:any)=>(a.sequence??10)-(b.sequence??10)))if(asPathMatches(rule.pattern,path))return rule.action==='permit';return false;}
/** Route maps are ordered clauses, with AND across match types and implicit deny. */
export function applyRouteMap(d:Device,name:string|undefined,source:PolicyRoute,allowContinue=false):PolicyRoute|undefined {
  if(!name)return{...source,asPath:source.asPath?[...source.asPath]:undefined};
  const entries=Object.values(d.config.features.routeMaps??{}).flatMap((v:any)=>Array.isArray(v)?v:v?.entries??[v]).filter((v:any)=>v.name===name).sort((a:any,b:any)=>(a.sequence??10)-(b.sequence??10));
  const sets:string[]=[];let accepted=false;
  for(let index=0;index<entries.length;index++) {
    const entry:any=entries[index];
    let matches=true;
    for(const clause of entry.match??[]) {
      const t=String(clause).trim().split(/\s+/);
      if((t[0]==='ip'||t[0]==='ipv6')&&t[1]==='address'&&t[2]==='prefix-list')matches&&=t.slice(3).some(n=>prefixListPermits(d,n,source));
      else if(t[0]==='ip'&&t[1]==='address')matches&&=!isIPv6(source.network)&&t.slice(2).some(n=>routeAclPermits(d,n,source));
      else if(t[0]==='tag')matches&&=t.slice(1).map(Number).includes(source.tag??0);
      else if(t[0]==='interface')matches&&=t.slice(1).includes(source.interface);
      else if(t[0]==='metric')matches&&=source.metric===Number(t[1]);
      else if(t[0]==='as-path')matches&&=t.slice(1).some(n=>asPathPermits(d,n,source.asPath??[]));
      else if(t[0]==='community')matches&&=t.slice(1).filter(n=>n!=='exact-match').some(n=>communityPermits(d,n,source.communities??[],t.includes('exact-match')));
      else matches=false;
    }
    if(!matches)continue;if(entry.action==='deny')return;
    accepted=true;sets.push(...entry.set??[]);
    if(!allowContinue||entry.continue===undefined)break;
    const target=entry.continue===null?Number(entry.sequence)+1:Number(entry.continue);
    if(!Number.isFinite(target)||target<=Number(entry.sequence))break;
    while(index+1<entries.length&&Number((entries[index+1] as any).sequence)<target)index++;
  }
  if(!accepted)return;
  const route:PolicyRoute={...source,asPath:source.asPath?[...source.asPath]:undefined,communities:source.communities?[...source.communities]:undefined};
    for(const clause of sets) {
      const t=String(clause).trim().split(/\s+/);
      if(t[0]==='metric')route.metric=Number(t[1]);
      else if(t[0]==='tag')route.tag=Number(t[1]);
      else if(t[0]==='weight')route.weight=Number(t[1]);
      else if(t[0]==='local-preference')route.localPreference=Number(t[1]);
      else if(t[0]==='metric-type')route.metricType=t[1]==='type-1'?1:2;
      else if((t[0]==='ip'||t[0]==='ipv6')&&t[1]==='next-hop')route.nextHop=t[2];
      else if(t[0]==='as-path'&&t[1]==='prepend')route.asPath=[...t.slice(2).map(Number),...(route.asPath??[])];
      else if(t[0]==='community')route.communities=t[1]==='none'?[]:[...new Set([...(t.includes('additive')?route.communities??[]:[]),...t.slice(1).filter(s=>s!=='additive').map(s=>canonicalCommunity(s)??s.toLowerCase())])];
    }
    return route;
}
function protocolOf(r:Route):string {
  if(r.protocol.startsWith('O'))return isIPv6(r.network)?'ospfv3':'ospf';
  if(r.protocol.startsWith('D'))return isIPv6(r.network)?'eigrp6':'eigrp';if(r.protocol.startsWith('R'))return isIPv6(r.network)?'ripng':'rip';if(r.protocol==='B')return'bgp';return r.protocol;
}
function selectedRoutes(d:Device):Route[] {
  const best=new Map<string,Route>();
  for(const route of d.runtime.routes) {
    const key=`${route.vrf??''}|${route.network}/${route.prefix}`,old=best.get(key);
    if(!old||route.ad<old.ad||route.ad===old.ad&&route.metric<old.metric)best.set(key,route);
  }
  return[...best.values()];
}
function addProtocolRoute(d:Device,route:Route):boolean {
  const protocol=protocolOf(route);if(route.protocol!=='D summary'&&['ospf','ospfv3','eigrp','eigrp6','rip','ripng'].includes(protocol)){if(!protocolPolicyPermits(d,protocol,'in',route.interface,route))return false;route.ad=configuredDistance(d,protocol,route,(name,r)=>routeAclPermits(d,name,r));if(route.ad===255)return false;}
  const current=d.runtime.routes.find(r=>r.network===route.network&&r.prefix===route.prefix&&r.protocol===route.protocol&&(r.vrf??'')===(route.vrf??'')&&r.nextHop===route.nextHop&&r.interface===route.interface);
  if(!current){d.runtime.routes.push(route);return true;}
  if(route.metric<current.metric){Object.assign(current,route);return true;}return false;
}
function ospfAreas(node:string,endpoints:RoutedPort[],edges:Adj[],protocol:string):Set<string> {
  return new Set([...edges.filter(e=>e.from.node===node).map(e=>e.area!).filter(Boolean),...endpoints.filter(p=>p.node===node&&networkMatch(p,protocol)).map(p=>areaId(networkMatch(p,protocol)?.area))]);
}
function ospfExternalType(engine:Simulator,source:RoutedPort,local:RoutedPort,path:Path,endpoints:RoutedPort[],edges:Adj[],protocol:string):'N'|'E'|undefined {
  const firstArea=path.edges[0]?.area!,lastArea=path.edges.at(-1)?.area!;
  const areaType=(area:string)=>config(source.device,protocol)?.areas?.[area]?.type??config(local.device,protocol)?.areas?.[area]?.type??path.edges.filter(e=>e.area===area).flatMap(e=>[e.from,e.to]).map(p=>config(p.device,protocol)?.areas?.[area]?.type).find(Boolean)??'normal';
  if(path.areas.some(area=>areaType(area)==='stub'))return;
  const sourceAreas=ospfAreas(source.node,endpoints,edges,protocol);
  if(areaType(firstArea)==='nssa') {
    // Type 5 advertisements cannot enter an NSSA. An attached ASBR originates Type 7 locally.
    if(!path.areas.every(area=>area===firstArea)||!sourceAreas.has(firstArea))return;
    if(sourceAreas.has('0')&&config(source.device,protocol)?.areas?.[firstArea]?.noRedistribution)return;
    return'N';
  }
  if(areaType(lastArea)==='nssa'&&!sourceAreas.has('0')) {
    const candidates=[...new Map(endpoints.filter(p=>config(p.device,protocol)).map(p=>[p.node,p])).values()].filter(p=>{
      const areas=ospfAreas(p.node,endpoints,edges,protocol);return areas.has('0')&&areas.has(lastArea)&&pathsFrom(source.node,edges.filter(e=>e.area===lastArea),protocol).has(p.node);
    }).sort((a,b)=>ipNumber(routerId(b.device,protocol))-ipNumber(routerId(a.device,protocol)));
    const translator=candidates[0];if(!translator)return;
    for(const p of candidates){p.device.runtime.features[`${protocol}Nssa`]??={};p.device.runtime.features[`${protocol}Nssa`][lastArea]={translatorId:translator.device.id,translatorRouterId:routerId(translator.device,protocol),role:p===translator?'TRANSLATOR':'CANDIDATE'};}
  }
  return'E';
}
function redistributionExports(d:Device,protocol:string,vrf?:string,routes=selectedRoutes(d)):PolicyRoute[] {
  const exports:PolicyRoute[]=[];
  for(const raw of config(d,protocol)?.redistribute??[]) {
    const rule=typeof raw==='string'?{protocol:raw}:raw;
    for(const original of routes) {
        if(protocolOf(original)!==rule.protocol||(original.vrf??'')!==(vrf??'')||(isIPv6(original.network)?6:4)!==protocolFamily(protocol))continue;
        if(rule.protocol===protocol||original.protocol==='local'||original.network.toLowerCase().startsWith('fe80:'))continue;
        const history=(original as PolicyRoute).redistributionHistory??[],stamp=`${nodeOf(d,vrf)}|${protocol}`;
        if(history.includes(stamp))continue;
        // Unresolved static next hops must never become working advertisements.
        if(original.protocol==='static'&&!/^null/i.test(original.interface)&&!resolveEgress(d,original.network,vrf))continue;
        const metric=rule.metric??defaultSeedMetric(d,protocol,ospfProtocol(protocol)?20:eigrpProtocol(protocol)?['connected','static'].includes(rule.protocol)?25600:undefined:1);
        if(metric===undefined||!Number.isFinite(metric))continue;
        const exported=applyRouteMap(d,rule.routeMap,{...original,metric,metricType:rule.metricType??2,tag:rule.tag??original.tag,redistributionHistory:[...history,stamp]});
        if(exported)exports.push(exported);
    }
  }
  return exports;
}
function redistribute(engine:Simulator,endpoints:RoutedPort[],graphs:Map<string,Adj[]>):void {
  const snapshots=new Map(engine.lab.devices.map(d=>[d.id,selectedRoutes(d)]));
  for(const [protocol,edges]of graphs) {
    if(ripProtocol(protocol)||ospfProtocol(protocol)||eigrpProtocol(protocol))continue;
    const nodes=new Map<string,RoutedPort>();for(const p of endpoints)if(p.family===protocolFamily(protocol)&&config(p.device,protocol))nodes.set(p.node,p);
    const paths=new Map([...nodes.keys()].map(node=>[node,pathsFrom(node,edges,protocol)]));
    for(const source of nodes.values())for(const exported of redistributionExports(source.device,protocol,source.iface.vrf,snapshots.get(source.device.id)??[])) {
        for(const [node,local]of nodes) {
          if(node===source.node)continue;
          const best=(paths.get(node)?.get(source.node)??[]).sort((a,b)=>a.cost-b.cost)[0],first=best?.edges[0];if(!first)continue;
          const externalType=ospfProtocol(protocol)?ospfExternalType(engine,source,local,best,endpoints,edges,protocol):'E';
          if(!externalType)continue;
          const prefix=eigrpProtocol(protocol)?summarizeAlong(best,exported.network,exported.prefix,protocol,true):exported;
          const rawMetric=ospfProtocol(protocol)?exported.metric+(exported.metricType===1?best.cost:0):exported.metric+best.cost;
          const externalMetric=ripProtocol(protocol)?ripPolicyMetric(best,prefix,rawMetric,protocol):eigrpProtocol(protocol)?eigrpPolicyMetric(best,prefix,rawMetric,protocol):rawMetric;if(externalMetric===undefined)continue;
          const summarized=eigrpProtocol(protocol)&&(prefix.network!==exported.network||prefix.prefix!==exported.prefix),route:DualRoute={...exported,...prefix,candidateDefault:eigrpCandidateDefault(best,source.device,prefix,protocol)||undefined,nextHop:first.to.ip,interface:first.from.name,protocol:ospfProtocol(protocol)?`O ${externalType}${exported.metricType??2}`:eigrpProtocol(protocol)?summarized?'D':'D EX':'R',ad:ospfProtocol(protocol)?110:eigrpProtocol(protocol)?summarized?90:170:120,metric:externalMetric,vrf:local.iface.vrf,learnedFrom:source.device.id};
          if(!addProtocolRoute(local.device,route))continue;
          // Summaries of external components are internal advertisements. Merge
          // them with the internal offers so final DUAL selection retains the
          // minimum component instead of restoring a suppressed specific.
          if(summarized){route.reportedDistance=Math.max(0,externalMetric-256);route.dependencyNodes=best.edges.map(e=>e.to.device.id);const c=dualContext(engine),key=dualKey(local.device,protocol,route.network,route.prefix,route.vrf),entries=c.candidates.get(key)??[],same=entries.find(r=>r.nextHop===route.nextHop&&r.interface===route.interface&&r.protocol===route.protocol);if(!same)entries.push(route);else if(route.metric<same.metric)Object.assign(same,route);c.candidates.set(key,entries);}
        }
    }
  }
}

function bestRoute(d:Device,address:string,vrf?:string):Route|undefined {
  return d.runtime.routes.filter(r=>(r.vrf??'')===(vrf??'')&&contains(r.network,r.prefix,address)).sort((a,b)=>b.prefix-a.prefix||a.ad-b.ad||a.metric-b.metric)[0];
}
function resolveEgress(d:Device,address:string,vrf?:string,seen=new Set<string>()):{interface:string;adjacent:string}|undefined {
  if(seen.has(address)||seen.size>16)return;seen.add(address);
  const r=bestRoute(d,address,vrf);if(!r||/^null/i.test(r.interface))return;
  if(!r.nextHop)return{interface:r.interface,adjacent:address};
  const iface=d.config.interfaces[r.interface];
  if(iface?.ip&&contains(iface.ip,prefixOf(iface.mask),r.nextHop))return{interface:r.interface,adjacent:r.nextHop};
  return resolveEgress(d,r.nextHop,vrf,seen);
}
function peerReachable(start:Device,target:string,endpoints:RoutedPort[],peers:Map<string,RoutedPort[]>,maxHops:number,vrf?:string):boolean {
  let current=start,currentVrf=vrf,hops=0;const visited=new Set<string>();
  while(hops<=maxHops){if(endpoints.some(p=>p.device.id===current.id&&p.ip===target&&(p.iface.vrf??'')===(currentVrf??'')))return true;const key=nodeOf(current,currentVrf);if(visited.has(key))return false;visited.add(key);const resolution=resolveEgress(current,target,currentVrf);if(!resolution)return false;const source=endpoints.find(p=>p.device.id===current.id&&p.name===resolution.interface);const next=source&&(peers.get(endpointKey(source))??[]).find(p=>sameAddress(p.ip,resolution.adjacent));if(!next)return false;current=next.device;currentVrf=next.iface.vrf;hops++;}return false;
}
function bgpEgress(engine:Simulator,d:Device,address:string,vrf?:string):{interface:string;adjacent:string}|undefined {const path=resolveForwardingPaths(d,address,vrf,port=>engine.interfaceUp(d.id,port)).find(path=>!/^Null/i.test(path.port));return path?{interface:path.port,adjacent:path.target}:undefined;}
function bgpSource(engine:Simulator,d:Device,address:string,vrf?:string,sourcePort?:string):string|undefined {const name=sourcePort??bgpEgress(engine,d,address,vrf)?.interface,c=name&&d.config.interfaces[name];if(!c)return;return isIPv6(address)?(engine.operationalIPv6Addresses?.(d.id,name!)??c.ipv6).map(v=>v.split('/')[0]).find(v=>!v.toLowerCase().startsWith('fe80:')):c.ip;}
function compareBgpAddress(a:string,b:string):number {if(isIPv6(a)&&isIPv6(b))return ipv6ToBigInt(a)>ipv6ToBigInt(b)?1:ipv6ToBigInt(a)<ipv6ToBigInt(b)?-1:0;return ipNumber(a)-ipNumber(b);}
function bgpNextHop(engine:Simulator,d:Device,peer:string,local:string,family:4|6,vrf?:string):string|undefined {if(isIPv6(local)===(family===6))return local;const name=bgpEgress(engine,d,peer,vrf)?.interface,c=name&&d.config.interfaces[name];return !c?undefined:family===4?c.ip:(engine.operationalIPv6Addresses?.(d.id,name!)??c.ipv6).map(v=>v.split('/')[0]).find(v=>!v.toLowerCase().startsWith('fe80:'));}
function bgp(engine:Simulator,endpoints:RoutedPort[],_peers:Map<string,RoutedPort[]>):void {
  const baseDevices=engine.lab.devices.filter(d=>routing(d)&&config(d,'bgp')),scopeVrfs=new WeakMap<Device,string>(),scopeFamilies=new WeakMap<Device,4|6>(),devices=baseDevices.flatMap(d=>[undefined,...Object.keys(d.config.protocols.bgp.vrfs??{})].flatMap(vrf=>([4,6] as const).flatMap(family=>{const c=bgpAddressFamily(d,vrf,family);if(!c)return[];const view={...d,config:{...d.config,protocols:{...d.config.protocols,bgp:c}}};if(vrf)scopeVrfs.set(view,vrf);scopeFamilies.set(view,family);return[view];}))),configs:BgpPeerConfig[]=[],tables=new Map<string,Map<string,BgpRoute>>(),choices=new Map<string,Map<string,BgpRoute[]>>();
  const scopeKey=(d:Device)=>d.id+'|'+(scopeVrfs.get(d)??'')+'|'+scopeFamilies.get(d),peerKey=(address:string,vrf?:string)=>vrf?vrf+'|'+address:address;
  for(const d of baseDevices){d.runtime.features.bgpTable=[];d.runtime.features.bgpPaths=[];d.runtime.features.bgpAdjRibIn={};d.runtime.features.bgpAdjRibOut={};d.runtime.features.bgpMaximumPrefix=[];d.runtime.features.bgpSessions=[];}
  for(const d of devices){
    const c=config(d,'bgp')!,table=new Map<string,BgpRoute>();tables.set(scopeKey(d),table);choices.set(scopeKey(d),new Map());const vrf=scopeVrfs.get(d);
    for(const n of c.networks??[]){const network=subnet(n.network,n.prefix);if(d.runtime.routes.some(r=>r.network===network&&r.prefix===n.prefix&&(r.vrf??'')===(vrf??'')&&(/^null/i.test(r.interface)||bgpEgress(engine,d,network,vrf))))table.set(`${network}/${n.prefix}`,{network,prefix:n.prefix,origin:d.id,asPath:[],nextHop:scopeFamilies.get(d)===6?'::':'0.0.0.0',localPreference:Number(c.defaultLocalPreference??100),weight:32768,originCode:'i',med:0,routerId:routerId(d,'bgp')});}
    for(const raw of c.redistribute??[]){const rule=typeof raw==='string'?{protocol:raw}:raw;for(const route of selectedRoutes(d)){if(isIPv6(route.network)!==(scopeFamilies.get(d)===6)||route.protocol==='local'||protocolOf(route)!==rule.protocol||rule.protocol==='bgp'||(route.vrf??'')!==(vrf??''))continue;const changed=applyRouteMap(d,rule.routeMap,{...route,metric:rule.metric??route.metric});if(!changed)continue;const key=changed.network+'/'+changed.prefix;if(table.has(key))continue;table.set(key,{network:changed.network,prefix:changed.prefix,origin:d.id,asPath:[],nextHop:scopeFamilies.get(d)===6?'::':'0.0.0.0',localPreference:Number(c.defaultLocalPreference??100),weight:32768,originCode:'?',med:changed.metric,routerId:routerId(d,'bgp'),...((route as any).ospf?{ospf:(route as any).ospf}:{}),...(route.tag===undefined?{}:{tag:route.tag})});}}
    for(const n of c.neighbors??[]){
      const timers={keepalive:60,hold:180,connectRetry:30,...c.timers,...n.timers},rid=routerId(d,'bgp'),source=n.updateSource?(bgpSource(engine,d,n.address,vrf,n.updateSource)??n.updateSource):bgpSource(engine,d,n.address,vrf);
      const bfdPort=endpoints.find(p=>p.device.id===d.id&&p.family===(isIPv6(n.address)?6:4)&&p.name===bgpEgress(engine,d,n.address,scopeVrfs.get(d))?.interface&&contains(p.ip,p.prefix,n.address)),bfdPeer=bfdPort&&isIPv6(n.address)?(_peers.get(endpointKey(bfdPort))??[]).find(peer=>sameAddress(peer.ip,n.address)):undefined,bfdAddress=bfdPeer?bfdPeer.device.runtime.features.linkLocalAddresses?.[bfdPeer.name]:n.address;const bfdReady=!n.bfd||!!bfdPort&&contains(bfdPort.ip,bfdPort.prefix,n.address)&&!!bfdAddress&&bfdUp(engine,bfdPort,bfdAddress);
      configs.push({deviceId:d.id,peerAddress:n.address,localAs:Number(c.asn),remoteAs:Number(n.remoteAs),routerId:rid,source:n.updateSource,vrf,ttl:n.ttlSecurityHops?255:Number(n.remoteAs)===Number(c.asn)?64:Number(n.ebgpMultihop??1),minimumTTL:n.ttlSecurityHops?Math.max(1,256-Number(n.ttlSecurityHops)):undefined,initiate:!source||compareBgpAddress(source,n.address)>0,keepalive:Number(timers.keepalive),hold:Number(timers.hold),connectRetry:Number(timers.connectRetry),password:n.password,enabled:!n.shutdown&&bfdReady,families:[scopeFamilies.get(d)!]});
    }
  }
  const mergedConfigs=new Map<string,BgpPeerConfig>();for(const c of configs){const key=c.deviceId+'|'+(c.vrf??'')+'|'+c.peerAddress,previous=mergedConfigs.get(key);if(previous){previous.families=[...new Set([...previous.families!,...c.families!])];previous.enabled ||= c.enabled;}else mergedConfigs.set(key,c);}
  const sessions=synchronizeBgpSessions(engine,[...mergedConfigs.values()]);
  const sessionViews=(session:any)=>devices.filter(d=>d.id===session.config.deviceId&&(scopeVrfs.get(d)??'')===(session.config.vrf??'')&&(session.config.families??[4]).includes(scopeFamilies.get(d))&&config(d,'bgp')?.neighbors?.some((n:any)=>n.address===session.config.peerAddress));
  for(const session of sessions)for(const d of sessionViews(session)){
    const c=config(d,'bgp')!,n=c.neighbors.find((n:any)=>n.address===session.config.peerAddress),ibgp=Number(c.asn)===Number(n.remoteAs),table=tables.get(scopeKey(d))!,candidates=new Map<string,BgpRoute>();
    if(session.state==='ESTABLISHED'&&(session.negotiatedFamilies??[4]).includes(scopeFamilies.get(d)!))for(const[key,advertisement]of session.received){
      if(isIPv6(advertisement.network)!==(scopeFamilies.get(d)===6))continue;
      if(advertisement.asPath.filter((asn:number)=>asn===Number(c.asn)).length>Number(n.allowAsIn??0))continue;
      if(ibgp&&(advertisement.originatorId===routerId(d,'bgp')||(advertisement.clusterList??[]).includes(String(c.clusterId??routerId(d,'bgp')))))continue;
      if(n.prefixListIn&&!prefixListPermits(d,n.prefixListIn,advertisement))continue;
      const inbound=applyRouteMap(d,n.routeMapIn,{...advertisement,protocol:'B',interface:'',ad:ibgp?200:20,metric:advertisement.med,localPreference:Number(n.localPreference??(ibgp?advertisement.localPreference??c.defaultLocalPreference??100:c.defaultLocalPreference??100))},true);
      if(!inbound?.nextHop)continue;
      candidates.set(key,{...advertisement,asPath:inbound.asPath??[],nextHop:inbound.nextHop,learnedVia:ibgp?'ibgp':'ebgp',from:session.config.remoteDeviceId??session.config.peerAddress,localPreference:inbound.localPreference??100,med:inbound.metric,routerId:session.remoteRouterId??'0.0.0.0',communities:inbound.communities??[],learnedFromClient:!!n.routeReflectorClient,weight:Number(inbound.weight??n.weight??0),originCode:advertisement.originCode??'?',arrivalOrder:advertisement.arrivalOrder,igpMetric:bestRoute(d,inbound.nextHop,scopeVrfs.get(d))?.metric??0});
    }
    if(n.maximumPrefix&&candidates.size>Number(n.maximumPrefix))rejectBgpMaximumPrefix(engine,session,candidates.size);
    if(session.state==='ESTABLISHED')for(const[key,candidate]of candidates){if(bgpPathSuppressed(d,n.address,key))continue;if(!bgpEgress(engine,d,candidate.nextHop,scopeVrfs.get(d)))continue;const paths=choices.get(scopeKey(d))!.get(key)??[];paths.push(candidate);choices.get(scopeKey(d))!.set(key,paths);}
    if(n.softReconfigurationInbound)d.runtime.features.bgpAdjRibIn[peerKey(n.address,scopeVrfs.get(d))]=[...session.received.values()].map(r=>({...r}));
    d.runtime.neighbors.push({protocol:'BGP',deviceId:session.config.remoteDeviceId??session.config.peerAddress,interface:bgpEgress(engine,d,n.address,scopeVrfs.get(d))?.interface??'',address:n.address,state:session.state,asn:n.remoteAs,routerId:session.remoteRouterId??'0.0.0.0'});
    d.runtime.features.bgpSessions.push({neighbor:n.address,vrf:scopeVrfs.get(d),family:scopeFamilies.get(d),negotiatedFamilies:session.negotiatedFamilies,state:session.state,channelId:session.channel?.id,negotiatedHold:session.negotiatedHold,lastReceived:session.lastReceived,establishedAt:session.establishedAt,messagesSent:session.messagesSent,messagesReceived:session.messagesReceived,stats:session.stats,transport:session.channel?{localAddress:session.channel.localAddress,localPort:session.channel.localPort,peerPort:session.channel.peerPort}:undefined,connects:session.connects,lastError:session.lastError,receivedPrefixes:candidates.size,rawReceivedPrefixes:[...session.received.values()].filter(r=>isIPv6(r.network)===(scopeFamilies.get(d)===6)).length});
    if(session.blocked)d.runtime.features.bgpMaximumPrefix.push({neighbor:n.address,vrf:scopeVrfs.get(d),limit:n.maximumPrefix,state:session.state,reason:session.lastError});
  }
  for(const d of devices){const table=tables.get(scopeKey(d))!,all=choices.get(scopeKey(d))!;for(const[key,local]of table){const values=all.get(key)??[];values.push(local);all.set(key,values);}for(const[key,paths]of all){const chosen=selectBgpCandidate(paths,d.id,{alwaysCompareMed:config(d,'bgp')!.alwaysCompareMed,deterministicMed:config(d,'bgp')!.deterministicMed});if(chosen)table.set(key,chosen);d.runtime.features.bgpPaths.push(...paths.map(path=>({...path,vrf:scopeVrfs.get(d),best:path===chosen})));}}
  for(const d of devices){const table=tables.get(scopeKey(d))!;for(const aggregate of [...config(d,'bgp')!.aggregates??[]].sort((a:any,b:any)=>b.prefix-a.prefix)){const network=subnet(aggregate.network,aggregate.prefix);if(![...table.values()].some(r=>r.prefix>aggregate.prefix&&contains(network,aggregate.prefix,r.network)))continue;table.set(`${network}/${aggregate.prefix}`,{network,prefix:aggregate.prefix,origin:d.id,asPath:[],nextHop:scopeFamilies.get(d)===6?'::':'0.0.0.0',localPreference:Number(config(d,'bgp')!.defaultLocalPreference??100),weight:32768,originCode:'i',med:0,routerId:routerId(d,'bgp'),aggregate:true,atomicAggregate:true});d.runtime.routes.push({network,prefix:aggregate.prefix,interface:'Null0',vrf:scopeVrfs.get(d),protocol:'B',ad:Number(config(d,'bgp')!.bgpDistance?.local??200),metric:0,asPath:[]});}}
  for(const d of devices)for(const best of tables.get(scopeKey(d))!.values()){
    d.runtime.features.bgpTable.push({...best,vrf:scopeVrfs.get(d),family:scopeFamilies.get(d),best:true});if(best.origin===d.id)continue;
    const c=config(d,'bgp')!,limit=Number(best.learnedVia==='ibgp'?c.maximumPathsIbgp??1:c.maximumPaths??1),others=choices.get(scopeKey(d))!.get(best.network+'/'+best.prefix)??[];
    const selected=[best,...others.filter(route=>route!==best&&bgpMultipathEligible(best,route))].filter((route,index,all)=>all.findIndex(p=>p.nextHop===route.nextHop)===index).slice(0,limit);
    for(const route of selected){const egress=bgpEgress(engine,d,route.nextHop,scopeVrfs.get(d));if(!egress)continue;
      d.runtime.routes.push({network:route.network,prefix:route.prefix,nextHop:route.nextHop,interface:egress.interface,vrf:scopeVrfs.get(d),protocol:'B',ad:Number(route.learnedVia==='ibgp'?c.bgpDistance?.internal??200:c.bgpDistance?.external??20),metric:route.med,asPath:route.asPath,learnedFrom:route.from,...((route as any).ospf?{ospf:(route as any).ospf}:{}),...((route as any).tag===undefined?{}:{tag:(route as any).tag})});
      const row=d.runtime.features.bgpPaths.find((p:any)=>p.network===route.network&&p.prefix===route.prefix&&p.nextHop===route.nextHop&&(p.vrf??'')===(scopeVrfs.get(d)??''));if(row)row.multipath=selected.length>1;
    }
  }
  for(const session of sessions){
    if(session.state!=='ESTABLISHED')continue;const advertised=new Map<string,any>();
    for(const d of sessionViews(session)){if(!(session.negotiatedFamilies??[4]).includes(scopeFamilies.get(d)!))continue;const c=config(d,'bgp')!,n=c.neighbors.find((n:any)=>n.address===session.config.peerAddress),ibgp=Number(c.asn)===Number(n.remoteAs),family=scopeFamilies.get(d)!;
    for(const[key,route]of tables.get(scopeKey(d))??[]){
      if((c.aggregates??[]).some((a:any)=>a.summaryOnly&&route.prefix>a.prefix&&contains(a.network,a.prefix,route.network)&&tables.get(scopeKey(d))!.get(`${subnet(a.network,a.prefix)}/${a.prefix}`)?.aggregate))continue;
      const reflection=ibgp&&route.learnedVia==='ibgp';if(route.from===(session.config.remoteDeviceId??n.address)||reflection&&!route.learnedFromClient&&!n.routeReflectorClient)continue;
      if(route.communities?.some(v=>['no-advertise','65535:65282'].includes(v)||!ibgp&&['no-export','local-as','65535:65281','65535:65283'].includes(v)))continue;
      if(n.prefixListOut&&!prefixListPermits(d,n.prefixListOut,route))continue;
      const out=applyRouteMap(d,n.routeMapOut,{...route,protocol:'B',interface:'',ad:20,metric:route.med},true);if(!out)continue;
      const asPath=ibgp?[...out.asPath??[]]:[Number(c.asn),...removePrivateAS(out.asPath??[],Number(n.remoteAs),Number(c.asn),n.removePrivateAs)];
      let nextHop=!ibgp||n.nextHopSelf||route.origin===d.id?bgpNextHop(engine,d,n.address,session.channel!.localAddress,family,scopeVrfs.get(d)):route.nextHop;if(out.nextHop!==route.nextHop&&out.nextHop)nextHop=out.nextHop;if(!nextHop||isIPv6(nextHop)!==(family===6))continue;
      advertised.set(key,{network:route.network,prefix:route.prefix,atomicAggregate:route.atomicAggregate,origin:route.origin,...((route as any).ospf?{ospf:(route as any).ospf}:{}),...((route as any).tag===undefined?{}:{tag:(route as any).tag}),asPath,nextHop,originCode:route.originCode??'?',localPreference:ibgp?out.localPreference??100:undefined,med:Number(n.med??out.metric),communities:n.sendCommunity?out.communities??[]:[],originatorId:reflection?route.originatorId??route.routerId:route.originatorId,clusterList:reflection?[String(c.clusterId??routerId(d,'bgp')),...route.clusterList??[]]:route.clusterList??[]});
    }
    if(n.defaultOriginate){const eligible=!n.defaultOriginateRouteMap||selectedRoutes(d).filter(r=>(r.vrf??'')===(scopeVrfs.get(d)??'')&&isIPv6(r.network)===(family===6)).some(r=>applyRouteMap(d,n.defaultOriginateRouteMap,{...r}));if(eligible){const generated={network:family===6?'::':'0.0.0.0',prefix:0,origin:d.id,asPath:ibgp?[]:[Number(c.asn)],nextHop:bgpNextHop(engine,d,n.address,session.channel!.localAddress,family,scopeVrfs.get(d)),originCode:'i',localPreference:ibgp?Number(c.defaultLocalPreference??100):undefined,med:0,communities:[]};if(generated.nextHop)advertised.set(generated.network+'/0',generated);}}
    }
    const owner=engine.getDevice(session.config.deviceId)!;owner.runtime.features.bgpAdjRibOut[peerKey(session.config.peerAddress,session.config.vrf)]=[...advertised.values()].map(r=>({...r}));
    sendBgpAdvertisements(engine,session,advertised);
  }
}

function ospfEndpoint(p:RoutedPort,protocol:OSPFProtocol):OSPFEndpoint {
  const statement=networkMatch(p,protocol),c=config(p.device,protocol);
  return{deviceId:p.device.id,name:p.name,node:p.node,address:p.ip,...(protocol==='ospfv3ipv4'?{transportAddress:p.device.runtime.features.linkLocalAddresses?.[p.name]}:{}),prefix:p.prefix,family:p.family,routerId:routerId(p.device,protocol),area:areaId(statement?.area),vrf:p.iface.vrf,snapshot:{deviceConfig:{ipRouting:p.device.config.ipRouting,ipv6Routing:p.device.config.ipv6Routing,protocols:{[protocol]:{...structuredClone(c??{}),referenceBandwidth:c?.referenceBandwidth??(p.device.kind==='datacenter'?40000:100),routerId:routerId(p.device,protocol)}},features:{},interfaces:{}},interfaceConfig:{...structuredClone(p.iface),features:{...structuredClone(p.iface.features),bandwidth:interfaceBandwidth(p.device,p.iface)}}}};
}
function ospfPacketSnapshot(engine:Simulator,endpoints:RoutedPort[],edges:Adj[],protocol:OSPFProtocol):OSPFSnapshot {
  const active=endpoints.filter(p=>networkMatch(p,protocol)),interfaces=active.filter((p,i,all)=>all.findIndex(q=>q.device.id===p.device.id&&q.name===p.name)===i).map(p=>({...ospfEndpoint(p,protocol),helloInterval:ospfTimers(p,protocol).hello,deadInterval:ospfTimers(p,protocol).dead,networkType:p.iface.features[protocol]?.networkType,passive:passive(p,protocol)||/^loopback/i.test(p.name),mtu:p.iface.mtu,mtuIgnore:!!p.iface.features[protocol]?.mtuIgnore,instanceId:p.iface.features[protocol]?.instanceId??(protocol==='ospfv3ipv4'?64:0),authentication:protocolAuthentication(engine,p,protocol),role:p.device.runtime.features[`${protocol}Interfaces`]?.[p.name]?.role}));
  const origins:OSPFOrigin[]=active.filter(p=>!p.ip.toLowerCase().startsWith('fe80:')).map(p=>({endpoint:ospfEndpoint(p,protocol),kind:'prefix',network:subnet(p.ip,p.prefix),prefix:p.prefix,cost:ospfCost(p,true,protocol)}));
  const nodes=new Map(active.map(p=>[p.node,p]));
  for(const source of nodes.values()){
    const c=config(source.device,protocol)!;
    if(c.defaultOriginate&&(c.defaultAlways||source.device.runtime.routes.some(r=>r.prefix===0&&(r.vrf??'')===(source.iface.vrf??'')&&(isIPv6(r.network)?6:4)===protocolFamily(protocol))))origins.push({endpoint:ospfEndpoint(source,protocol),kind:'default',network:protocolFamily(protocol)===6?'::':'0.0.0.0',prefix:0,route:{metric:1,metricType:2}});
    for(const raw of c.redistribute??[]){const rule=typeof raw==='string'?{protocol:raw}:raw;for(const original of selectedRoutes(source.device)){
      if(protocolOf(original)!==rule.protocol||rule.protocol===protocol||original.protocol==='local'||(original.vrf??'')!==(source.iface.vrf??'')||(isIPv6(original.network)?6:4)!==protocolFamily(protocol)||original.network.toLowerCase().startsWith('fe80:'))continue;
      const history=(original as PolicyRoute).redistributionHistory??[],stamp=`${source.node}|${protocol}`;if(history.includes(stamp)||original.protocol==='static'&&!/^null/i.test(original.interface)&&!resolveEgress(source.device,original.network,source.iface.vrf))continue;
      const advertised=applyRouteMap(source.device,rule.routeMap,{...original,metric:rule.metric??defaultSeedMetric(source.device,protocol,20)??20,metricType:rule.metricType??2,tag:rule.tag??original.tag,redistributionHistory:[...history,stamp]});if(advertised)origins.push({endpoint:ospfEndpoint(source,protocol),kind:'external',network:original.network,prefix:original.prefix,route:advertised});
    }}
  }
  const summarized:OSPFOrigin[]=[];
  for(const origin of origins){
    if(origin.kind!=='external'){summarized.push(origin);continue;}
    const d=routingDevice(engine.getDevice(origin.endpoint.deviceId)!,origin.endpoint.vrf),c=config(d,protocol)!,route=origin.route as Route;
    if(!protocolPolicyPermits(d,protocol,'out',origin.endpoint.name,route,protocolOf(route)))continue;
    const summary=(c.externalSummaries??[]).filter((s:any)=>s.prefix<=origin.prefix&&contains(s.network,s.prefix,origin.network)).sort((a:any,b:any)=>b.prefix-a.prefix)[0];
    if(summary?.notAdvertise)continue;
    const result=summary?{...origin,network:summary.network,prefix:summary.prefix,route:{...route,network:summary.network,prefix:summary.prefix,tag:summary.tag??route.tag}}:origin;
    if(c.maxMetric?.external!==undefined)result.route={...result.route,metric:c.maxMetric.external};
    const prior=summarized.find(r=>r.kind==='external'&&r.endpoint.node===result.endpoint.node&&r.network===result.network&&r.prefix===result.prefix);
    if(prior&&summary)prior.route={...prior.route,metric:Math.max(Number(prior.route?.metric??0),Number(result.route?.metric??0))};else summarized.push(result);
    if(summary&&c.discardRoutes?.external!==false)addProtocolRoute(d,{network:summary.network,prefix:summary.prefix,interface:'Null0',protocol:'O summary',ad:110,metric:Number(result.route?.metric??0),vrf:origin.endpoint.vrf,tag:summary.tag});
  }
  const rawEdges=[...edges];for(const from of active)for(const n of from.device.runtime.neighbors.filter(n=>n.protocol===protocol.toUpperCase()&&n.interface===from.name&&n.state==='EXSTART')){const to=endpoints.find(p=>p.device.id===n.deviceId&&p.name===n.peerInterface&&sameAddress(p.ip,n.address??''));if(to)rawEdges.push({from,to,area:areaId(networkMatch(from,protocol)?.area),cost:ospfCost(from,false,protocol),bandwidth:interfaceBandwidth(from.device,from.iface),delay:100});}
  const candidates=rawEdges.filter(e=>e.from.family===protocolFamily(protocol)).map(e=>({...e,from:ospfEndpoint(e.from,protocol),to:ospfEndpoint(e.to,protocol),area:e.area!,fullDesired:['DR','BDR','POINT-TO-POINT'].includes(e.from.device.runtime.features[`${protocol}Interfaces`]?.[e.from.name]?.role)||['DR','BDR','POINT-TO-POINT'].includes(e.to.device.runtime.features[`${protocol}Interfaces`]?.[e.to.name]?.role)}));
  const invalidated=engine.lab.devices.flatMap(d=>d.runtime.neighbors.filter(n=>n.protocol===protocol.toUpperCase()&&n.state==='BFD-DOWN').map(n=>({fromDeviceId:d.id,fromPort:n.interface,toDeviceId:n.deviceId,toPort:n.peerInterface??'',reason:'Local BFD session down'})));return{protocol,interfaces,candidates,origins:summarized,invalidated};
}
function installOspfPackets(engine:Simulator,endpoints:RoutedPort[],protocol:OSPFProtocol):void {
  const observers=new Map(endpoints.filter(p=>networkMatch(p,protocol)).map(p=>[p.node,p]));
  for(const local of observers.values()){
    const view=ospfDatabaseView(engine,local.device.id,protocol,local.iface.vrf),devices=new Map<string,Device>([[local.device.id,local.device]]),decoded=new Map<string,RoutedPort>();
    const decode=(ep:OSPFEndpoint):RoutedPort=>{
      const key=`${ep.deviceId}|${ep.name}|${ep.address}`;let port=decoded.get(key);if(port)return port;
      let device=devices.get(ep.deviceId);if(!device){device={id:ep.deviceId,x:0,y:0,kind:'router',powered:true,config:structuredClone(ep.snapshot?.deviceConfig??{protocols:{},interfaces:{},features:{}}),runtime:{routes:[],neighbors:[],features:{},stp:{}}} as unknown as Device;devices.set(ep.deviceId,device);}
      if(ep.transportAddress)(device.runtime.features.linkLocalAddresses??={})[ep.name]=ep.transportAddress;
      const iface=structuredClone(ep.snapshot?.interfaceConfig??defaultOspfInterface(ep));iface.features??={};iface.features[protocol]={...iface.features[protocol],area:ep.area};port={device,iface,name:ep.name,ip:ep.address,prefix:ep.prefix,node:ep.node,family:ep.family};decoded.set(key,port);return port;
    };
    for(const p of endpoints.filter(p=>p.node===local.node&&networkMatch(p,protocol)))decoded.set(`${p.device.id}|${p.name}|${p.ip}`,p);
    for(const p of view.prefixes){
      const port=decode(p.endpoint);
      // A received prefix LSA carries its advertised metric. Recomputing it
      // with the decoded peer's generic interface defaults changes remote
      // costs (notably Nexus loopbacks) and ignores received max-metric state.
      if(p.kind==='prefix'&&p.cost!==undefined&&port.device.id!==local.device.id)port.iface.features[protocol].cost=p.cost;
    }
    let links:Adj[]=view.links.map(l=>({from:decode(l.from),to:decode(l.to),area:l.area,cost:l.cost,bandwidth:l.bandwidth,delay:l.delay}));
    // SPF requires reciprocal advertisements. A stale one-way edge cannot manufacture a path.
    links=links.filter(e=>links.some(other=>other.from.node===e.to.node&&other.to.node===e.from.node&&other.from.name===e.to.name&&other.to.name===e.from.name&&other.area===e.area));
    const known=[...decoded.values()],observerEngine={...engine,lab:{...engine.lab,devices:[...devices.values()]},getDevice:(id:string)=>devices.get(id)} as Simulator;
    links=ospfVirtualLinks(observerEngine,known,links,protocol);
    const localAreas=ospfAreas(local.node,known,links,protocol);
    for(const area of localAreas)if(area!=='0'&&localAreas.has('0')&&config(local.device,protocol)?.areas?.[area]?.type==='nssa'){
      const candidates=[...new Map(known.map(p=>[p.node,p])).values()].filter(p=>{const areas=ospfAreas(p.node,known,links,protocol);return areas.has('0')&&areas.has(area)&&pathsFrom(local.node,links.filter(e=>e.area===area),protocol).has(p.node);}).sort((a,b)=>ipNumber(routerId(b.device,protocol))-ipNumber(routerId(a.device,protocol)));
      const winner=candidates[0];if(winner)(local.device.runtime.features[`${protocol}Nssa`]??={})[area]={translatorId:winner.device.id,translatorRouterId:routerId(winner.device,protocol),role:winner.device.id===local.device.id?'TRANSLATOR':'CANDIDATE'};
    }

    const prefixes=new Set(view.prefixes.filter(p=>p.kind==='prefix').map(p=>`${p.endpoint.deviceId}|${p.endpoint.name}|${p.endpoint.address}`));
    const advertised=known.filter(p=>p.device.id===local.device.id||prefixes.has(`${p.device.id}|${p.name}|${p.ip}`));
    // Link-only endpoints remain useful to SPF, but only received prefix LSAs originate routes.
    for(const p of known)if(!advertised.includes(p)){p.iface.features[protocol].area=undefined;p.device.config.protocols[protocol].networks=[];}
    installIgp(observerEngine,advertised,links,protocol,local.device.id);
    const paths=pathsFrom(local.node,links,protocol);
    for(const origin of view.prefixes.filter(p=>p.kind!=='prefix'&&p.endpoint.node!==local.node)){
      const source=decode(origin.endpoint),best=(paths.get(source.node)??[]).sort((a,b)=>{const rank=(p:Path)=>p.areas.length===1?config(local.device,protocol)?.rfc1583Compatible===false&&p.areas[0]==='0'?1:0:2;return rank(a)-rank(b)||a.cost-b.cost;})[0],first=best?.edges[0];if(!first)continue;const externalType=ospfExternalType(observerEngine,source,local,best,known,links,protocol);if(!externalType)continue;const r=origin.route??{},metricType=Number(r.metricType??2);addProtocolRoute(local.device,{...r,network:origin.network,prefix:origin.prefix,nextHop:first.to.ip,interface:first.from.name,protocol:`O ${externalType}${metricType}`,ad:110,metric:Number(r.metric??20)+(metricType===1?best.cost:0),vrf:local.iface.vrf,learnedFrom:source.device.id});
    }
  }
}
function defaultOspfInterface(ep:OSPFEndpoint):any{return{name:ep.name,adminUp:true,switchport:false,ip:ep.family===4?ep.address:undefined,ipv6:ep.family===6?[`${ep.address}/${ep.prefix}`]:[],mtu:1500,speed:1000,features:{},vrf:ep.vrf};}

function bfdConfig(p:Port):any {const template=p.device.config.features.bfdTemplates?.[p.iface.features.bfdTemplate];return template||p.iface.features.bfd?{...template,...p.iface.features.bfd}:undefined;}
function bfdKey(deviceId:string,port:string,peer:string):string{return `${deviceId}|${port}|${peer}`;}
function bfdUp(engine:Simulator,p:Port,peer:string):boolean {
  return [...(bfdSessions.get(engine)?.values()??[])].some(s=>s.deviceId===p.device.id&&s.interface===p.name&&sameAddress(s.peer,peer)&&s.status==='Up');
}
function publishBfd(engine:Simulator):void {
  for(const d of engine.lab.devices)d.runtime.features.bfd=[];
  for(const s of bfdSessions.get(engine)?.values()??[])engine.getDevice(s.deviceId)?.runtime.features.bfd.push({interface:s.interface,peer:s.peer,peerDeviceId:s.peerDeviceId,state:s.status.toUpperCase(),minTx:s.minTx,minRx:s.minRx,multiplier:s.multiplier,negotiatedTx:Math.max(s.minTx,s.peerMinRx),detectionTime:s.peerMultiplier*Math.max(s.minRx,s.peerMinTx),lastReceived:s.lastReceived,echo:s.status==='Up'&&s.peerEcho&&engine.getDevice(s.deviceId)?.config.interfaces[s.interface]?.features.bfdEcho!==false,lastEchoReceived:s.lastEchoReceived});
}
function armBfdEcho(engine:Simulator,s:BfdSession):void {engine.clock.cancel(s.echoDetect);s.echoDetect=engine.clock.schedule(s.multiplier*Math.max(s.minTx,s.peerMinRx),()=>{s.echoDetect=undefined;if(bfdSessions.get(engine)?.get(s.key)!==s||s.status!=='Up')return;s.status='Down';s.lastEchoReceived=undefined;const d=engine.getDevice(s.deviceId);if(d)event(engine,d,'BFD','Echo detection expired',`${s.interface} peer ${s.peer}: forwarding echo was not returned.`,true);publishBfd(engine);scheduleBfd(engine,s,0);engine.recompute();engine.notify();},{owner:s.deviceId,label:'BFD echo detection'});}
function scheduleBfd(engine:Simulator,s:BfdSession,delay:number):void {
  engine.clock.cancel(s.tx);
  s.tx=engine.clock.schedule(delay,()=>{
    if(bfdSessions.get(engine)?.get(s.key)!==s)return;
    const d=engine.getDevice(s.deviceId);if(!d?.powered||!engine.interfaceUp(d.id,s.interface))return;
    engine.sendControlDatagram?.(s.deviceId,s.source,s.peer,3784,{protocol:'bfd',state:s.status,minTx:s.status==='Up'?s.minTx:Math.max(d.config.features.bfdSlowTimers??1000,s.minTx),minRx:s.minRx,multiplier:s.multiplier,echo:d.config.interfaces[s.interface]?.features.bfdEcho!==false},{interface:s.interface,vrf:s.vrf,ttl:255});
    if(s.status==='Up'&&d.config.interfaces[s.interface]?.features.bfdEcho!==false&&s.peerEcho&&engine.sendBfdEcho){s.echoSequence=(s.echoSequence??0)+1;engine.sendBfdEcho(d.id,s.interface,s.source,s.peer,{protocol:'bfd-echo',key:s.key,sequence:s.echoSequence});if(!s.echoDetect)armBfdEcho(engine,s);}
    else {engine.clock.cancel(s.echoDetect);s.echoDetect=undefined;s.lastEchoReceived=undefined;}
    scheduleBfd(engine,s,s.status==='Up'?Math.max(s.minTx,s.peerMinRx):Math.max(d.config.features.bfdSlowTimers??1000,s.minTx,s.peerMinRx));
  },{owner:s.deviceId,label:'BFD control transmit'});
}
/** BFD uses actual UDP delivery through the simulated links, ARP/NDP and ACLs. */
function synchronizeBfd(engine:Simulator,endpoints:RoutedPort[],peers:Map<string,RoutedPort[]>):void {
  let sessions=bfdSessions.get(engine);if(!sessions){sessions=new Map();bfdSessions.set(engine,sessions);}
  const wanted=new Set<string>(),seen=new Set<string>();
  for(const from of endpoints) {
    const cfg=bfdConfig(from);if(!cfg||cfg.enabled===false)continue;
    for(const to of peers.get(endpointKey(from))??[]) {
      if(!bfdConfig(to)||bfdConfig(to).enabled===false||to.family!==from.family||from.family===4&&(!contains(from.ip,from.prefix,to.ip)||!contains(to.ip,to.prefix,from.ip)))continue;
      if(from.family===6&&(!from.ip.toLowerCase().startsWith('fe80:')||!to.ip.toLowerCase().startsWith('fe80:')))continue;
      const pair=`${from.family}|${portKey(from)}|${portKey(to)}`;if(seen.has(pair))continue;seen.add(pair);
      const key=bfdKey(from.device.id,from.name,to.ip);wanted.add(key);
      let s=sessions.get(key);
      if(s&&s.runtime!==from.device.runtime){engine.clock.cancel(s.tx);engine.clock.cancel(s.detect);engine.clock.cancel(s.echoDetect);sessions.delete(key);s=undefined;}
      if(!s){s={key,deviceId:from.device.id,interface:from.name,peer:to.ip,source:from.ip,peerDeviceId:to.device.id,status:'Down',minTx:1000,minRx:1000,multiplier:3,peerMinTx:1000,peerMinRx:1000,peerMultiplier:3,runtime:from.device.runtime,vrf:from.iface.vrf};sessions.set(key,s);scheduleBfd(engine,s,0);}
      s.minTx=Math.max(10,Number(cfg.minTx??300));s.minRx=Math.max(10,Number(cfg.minRx??300));s.multiplier=Math.max(1,Number(cfg.multiplier??3));
    }
  }
  for(const[key,s]of sessions)if(!wanted.has(key)){engine.clock.cancel(s.tx);engine.clock.cancel(s.detect);engine.clock.cancel(s.echoDetect);sessions.delete(key);}
  publishBfd(engine);
}
export function receiveControlDatagram(engine:Simulator,deviceId:string,source:string,destination:string,payload:any,ttl:number,input?:string):void {
  const receiver=engine.getDevice(deviceId);if(receiver&&receiveVPCKeepalive(engine,receiver,source,destination,payload,input))return;
  if(receiveFhrpControl(engine,deviceId,source,destination,payload,ttl,input))return;
  if(payload?.protocol==='ospf-packets'){receiveOSPFControl(engine,deviceId,source,destination,payload,ttl,input);return;}
  if(payload?.protocol==='rip-update'){receiveRip(engine,deviceId,source,payload,ttl,input);return;}
  if(payload?.protocol==='eigrp-hello'){receiveEigrpHello(engine,deviceId,source,payload,ttl,input);return;}
  if(receiveEigrpUpdate(engine,deviceId,source,destination,payload,ttl,input,peer=>refreshEigrpHold(engine,peer.key)))return;
  if(payload?.protocol==='eigrp-dual'){receiveDual(engine,deviceId,source,destination,payload,ttl,input);return;}
  if(payload?.protocol==='nhrp'){const d=engine.getDevice(deviceId);if(d)event(engine,d,'NHRP','Unencapsulated NHRP rejected','NHRP control messages must arrive through the GRE tunnel.',true);return;}
  if(payload?.protocol==='pim'){receivePim(engine,deviceId,source,destination,payload,input);return;}
  if(payload?.protocol==='igmp'){receiveIgmp(engine,deviceId,source,payload,ttl,input);return;}
  if(payload?.protocol==='bfd-echo'){const session=bfdSessions.get(engine)?.get(payload.key);if(session&&session.deviceId===deviceId&&session.interface===input&&sameAddress(source,session.source)&&sameAddress(destination,session.source)&&ttl<255&&ttl>0&&Number.isInteger(payload.sequence)&&payload.sequence>(session.echoReceivedSequence??0)&&payload.sequence<=(session.echoSequence??0)&&session.status==='Up'){session.echoReceivedSequence=payload.sequence;session.lastEchoReceived=engine.clock.now();armBfdEcho(engine,session);publishBfd(engine);}return;}
  if(payload?.protocol!=='bfd')return;
  if(ttl!==255||!['Down','Init','Up'].includes(payload.state))return;
  const s=[...(bfdSessions.get(engine)?.values()??[])].find(s=>s.deviceId===deviceId&&sameAddress(s.source,destination)&&sameAddress(s.peer,source));if(!s)return;
  const previous=s.status;s.peerEcho=payload.echo===true;
  s.peerMinTx=Math.max(10,Number(payload.minTx)||1000);s.peerMinRx=Math.max(10,Number(payload.minRx)||1000);s.peerMultiplier=Math.max(1,Number(payload.multiplier)||3);s.lastReceived=engine.clock.now();
  if(s.status==='Down')s.status=payload.state==='Down'?'Init':payload.state==='Init'?'Up':'Down';
  else if(s.status==='Init'&&(payload.state==='Init'||payload.state==='Up'))s.status='Up';
  else if(s.status==='Up'&&payload.state==='Down')s.status='Down';
  engine.clock.cancel(s.detect);
  s.detect=engine.clock.schedule(s.peerMultiplier*Math.max(s.minRx,s.peerMinTx),()=>{
    if(bfdSessions.get(engine)?.get(s.key)!==s)return;
    s.status='Down';s.lastReceived=undefined;
    const d=engine.getDevice(s.deviceId);if(d)event(engine,d,'BFD','Detection time expired',`${s.interface} peer ${s.peer}; dependent adjacencies are withdrawn.`,true);
    publishBfd(engine);scheduleBfd(engine,s,0);engine.recompute();engine.notify();
  },{owner:deviceId,label:'BFD detection expiry'});
  if(previous!==s.status){const d=engine.getDevice(deviceId);if(d)event(engine,d,'BFD',`Session ${s.status}`,`${s.interface} peer ${s.peer}.`,s.status==='Down');scheduleBfd(engine,s,0);publishBfd(engine);engine.recompute();engine.notify();}
  else publishBfd(engine);
}

function tunnelNeighbors(engine:Simulator,a:RoutedPort,b:RoutedPort):boolean {
  if(a.iface.features.tunnelKey!==b.iface.features.tunnelKey||a.family!==b.family||!contains(a.ip,a.prefix,b.ip)||!contains(b.ip,b.prefix,a.ip))return false;
  const an=tunnelNbma(a.device,a.iface),bn=tunnelNbma(b.device,b.iface);if(!an||!bn)return false;
  const allows=(p:RoutedPort,remote:RoutedPort,nbma:string)=>{
    if(p.iface.features.tunnelMode!=='gre multipoint')return p.iface.features.tunnelDestination===nbma;
    const c=p.iface.features.nhrp,rt=nhrpRuntime(p.device,p.name),mapping=nhrpMapping(p.device,p.name,remote.ip,engine.clock.now());
    return mapping?.nbma===nbma&&(c?.multicast==='dynamic'&&mapping.registered||Array.isArray(c?.multicast)&&c.multicast.includes(nbma))&&(!nhrpServers(c).length||rt.registrations.some(r=>r.state==='UP'&&(r.expires??0)>engine.clock.now()));
  };
  return allows(a,b,bn)&&allows(b,a,an);
}

function groupAddress(ip:string):boolean{return contains('224.0.0.0',4,ip);}
function igmpMemberships(iface:InterfaceConfig):{group:string;source?:string}[]{return(iface.features.igmpGroups??[]).map((m:any)=>typeof m==='string'?{group:m}:{...m,source:Number(iface.features.igmpVersion??3)===3?m.source:undefined}).filter((m:any)=>groupAddress(m.group));}
function sendIgmpReport(engine:Simulator,d:Device,iface:InterfaceConfig,member:{group:string;source?:string}):void {const version=Number(iface.features.igmpVersion??3);engine.sendControlDatagram?.(d.id,iface.ip!,version===3?'224.0.0.22':member.group,0,{protocol:'igmp',operation:'report',version,group:member.group,source:version===3?member.source:undefined},{interface:iface.name,ttl:1,protocol:'igmp'});}
function sendIgmpLeave(engine:Simulator,t:{deviceId:string;port:string;version:number},member:{group:string;source?:string}):void {
  const d=engine.getDevice(t.deviceId),iface=d?.config.interfaces[t.port];if(!d||!iface?.ip||t.version===1||!engine.interfaceUp(d.id,t.port))return;
  engine.sendControlDatagram?.(d.id,iface.ip,t.version===3?'224.0.0.22':'224.0.0.2',0,{protocol:'igmp',operation:'leave',version:t.version,...member},{interface:t.port,ttl:1,protocol:'igmp'});
}
function pimElections(engine:Simulator):void {
  const endpoints=routedPorts(engine).filter(p=>p.family===4&&p.device.config.features.multicastRouting&&p.iface.features.pim),ws=wires(engine);
  for(const d of engine.lab.devices)d.runtime.features.pimInterfaces={};
  for(const p of endpoints){const candidates=[p,...broadcastPeers(engine,ws,p,endpoints)].filter(q=>q.family===4&&q.device.config.features.multicastRouting&&q.iface.features.pim&&contains(p.ip,p.prefix,q.ip));candidates.sort((a,b)=>Number(b.iface.features.pimDrPriority??1)-Number(a.iface.features.pimDrPriority??1)||ipNumber(b.ip)-ipNumber(a.ip));const dr=candidates[0]??p;p.device.runtime.features.pimInterfaces[p.name]={dr:dr.ip,drDeviceId:dr.device.id,drPriority:Number(p.iface.features.pimDrPriority??1),role:dr.device.id===p.device.id?'DR':'NON-DR',neighbors:candidates.filter(q=>q.device.id!==p.device.id).map(q=>({address:q.ip,deviceId:q.device.id}))};}
}
function synchronizeMulticast(engine:Simulator):void {
  let timers=igmpTimers.get(engine);if(!timers){timers=new Map();igmpTimers.set(engine,timers);}const wanted=new Set<string>();
  pimElections(engine);
  for(const d of engine.lab.devices){
    d.runtime.features.igmpGroups=(d.runtime.features.igmpGroups??[]).filter((m:any)=>m.expires>engine.clock.now()&&engine.interfaceUp(d.id,m.interface));
    for(const[port,iface]of Object.entries(d.config.interfaces)){
      if(!engine.interfaceUp(d.id,port)||!iface.ip)continue;const groups=igmpMemberships(iface);if(!groups.length)continue;
      const key=`${d.id}|${port}`,signature=JSON.stringify([groups,iface.features.igmpVersion]);wanted.add(key);const old=timers.get(key);if(old?.runtime===d.runtime&&old.signature===signature)continue;if(old){engine.clock.cancel(old.timer);if(old.runtime===d.runtime)for(const m of old.groups)if(!groups.some(g=>g.group===m.group&&g.source===m.source))sendIgmpLeave(engine,old,m);}
      const send=()=>{for(const m of groups)sendIgmpReport(engine,d,iface,m);};
      const timer=engine.clock.schedule(1,send,{owner:d.id,repeat:60000,label:'IGMP membership report'});timers.set(key,{timer,runtime:d.runtime,signature,deviceId:d.id,port,groups,version:Number(iface.features.igmpVersion??3)});
    }
  }
  for(const[key,t]of timers)if(!wanted.has(key)){engine.clock.cancel(t.timer);if(engine.getDevice(t.deviceId)?.runtime===t.runtime)for(const m of t.groups)sendIgmpLeave(engine,t,m);timers.delete(key);}
  for(const flow of multicastFlows.get(engine)?.values()??[]){buildMulticastTree(engine,flow.source,flow.group);synchronizeDenseDemand(engine,flow.source,flow.group);}
  buildSharedTrees(engine);
}
function receiveIgmp(engine:Simulator,deviceId:string,reporter:string,p:any,ttl:number,input?:string):void {
  const d=engine.getDevice(deviceId);if(!d||ttl!==1)return;
  if(p.operation==='query'){
    const ports=Object.entries(d.config.interfaces).filter(([name,iface])=>iface.ip&&engine.interfaceUp(d.id,name)&&(!input||name===input)&&contains(iface.ip,prefixOf(iface.mask),reporter));const runtime=d.runtime;
    for(const[port,iface]of ports)for(const member of igmpMemberships(iface))if(!p.group||p.group==='0.0.0.0'||p.group===member.group){const max=Math.max(0.1,Number(p.maxResponse??10))*1000,seed=[...`${d.id}|${port}|${member.group}`].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0),delay=1+seed%Math.max(1,Math.floor(max));engine.clock.schedule(delay,()=>{if(d.runtime!==runtime||!engine.interfaceUp(d.id,port)||!igmpMemberships(iface).some(g=>g.group===member.group&&g.source===member.source))return;sendIgmpReport(engine,d,iface,member);},{owner:d.id,label:'IGMP query response'});}
    d.runtime.features.igmpQueriesReceived=(d.runtime.features.igmpQueriesReceived??0)+1;return;
  }
  if(!d.config.features.multicastRouting||!groupAddress(p.group))return;
  const iface=Object.values(d.config.interfaces).find(i=>i.ip&&i.features.pim&&(!input||i.name===input)&&contains(i.ip,prefixOf(i.mask),reporter)&&engine.interfaceUp(d.id,i.name));if(!iface)return;
  const old=d.runtime.features.igmpGroups??=[];d.runtime.features.igmpGroups=old.filter((m:any)=>!(m.interface===iface.name&&m.group===p.group&&m.reporter===reporter&&m.source===p.source));
  if(p.operation==='report'){
    const entry={interface:iface.name,group:p.group,source:p.source,reporter,expires:engine.clock.now()+125000};d.runtime.features.igmpGroups.push(entry);
    engine.clock.schedule(125000,()=>{if(d.runtime.features.igmpGroups?.includes(entry)){d.runtime.features.igmpGroups=d.runtime.features.igmpGroups.filter((m:any)=>m!==entry);engine.recompute();engine.notify();}},{owner:d.id,label:'IGMP membership expiry'});
  }
  event(engine,d,'IGMP',p.operation==='report'?'Membership report':'Membership leave',`${reporter} ${p.group}${p.source?' source '+p.source:''} on ${iface.name}.`);engine.recompute();engine.notify();
}
function buildMulticastTree(engine:Simulator,source:string,group:string,rpt=false):void {
  const endpoints=routedPorts(engine).filter(p=>p.family===4),ws=wires(engine),peers=new Map(endpoints.map(p=>[endpointKey(p),broadcastPeers(engine,ws,p,endpoints)]));
  const routers=engine.lab.devices.filter(d=>routing(d)&&d.config.features.multicastRouting),routes=new Map<string,{deviceId:string;source:string;group:string;incoming:string;outgoing:Set<string>;mode:string;rp?:string}>();
  const ssm=(d:Device)=>(d.config.features.pim?.ssmRanges??[{network:'232.0.0.0',prefix:8}]).some((r:any)=>contains(r.network,r.prefix,group));
  const permits=(d:Device,port:string):boolean=>{
    const mode=d.config.interfaces[port]?.features.pim;if(!mode||!d.config.features.multicastRouting)return false;
    if(mode==='dense-mode'||ssm(d))return true;
    const rp=d.config.features.pim?.rpAddress;
    return mode==='sparse-dense-mode'&&!rp||!!rp&&peerReachable(d,rp,endpoints,peers,64);
  };
  for(const receiver of routers){
    const memberships=[...(receiver.runtime.features.igmpGroups??[]),...Object.values(receiver.config.interfaces).flatMap(i=>igmpMemberships(i).map(m=>({...m,interface:i.name})))];
    const lastHops=[...new Set<string>(memberships.filter((m:any)=>m.group===group&&(!m.source||sameAddress(m.source,source))&&(!ssm(receiver)||sameAddress(m.source??'',source))&&engine.interfaceUp(receiver.id,m.interface)&&permits(receiver,m.interface)).map((m:any)=>m.interface))];
    if(!lastHops.length)continue;
    const rp=receiver.config.features.pim?.rpAddress;if(!ssm(receiver)&&!msdpSourceAvailable(engine,rp,source,group))continue;const shared=!ssm(receiver)&&!!rp&&(rpt||receiver.config.features.pim?.sptThreshold==='infinity');let target=shared?rp:source;
    let current=receiver,outputs=lastHops;const seen=new Set<string>(),chain:{d:Device;incoming:string;outgoing:string[]}[]=[];let rooted=false;
    while(!seen.has(current.id)&&chain.length<64){
      seen.add(current.id);const local=Object.values(current.config.interfaces).some(i=>i.ip&&sameAddress(i.ip,target));
      const resolution=local?undefined:resolveEgress(current,target);if(!local&&!resolution)break;
      const remoteRoot=local&&shared&&msdpRemoteSource(engine,rp,source,group),registeredSource=target===source&&msdpRemoteSource(engine,rp,source,group)&&current.runtime.features.pimRegistrations?.[`${source}|${group}`]?.expires>engine.clock.now();
      const input=registeredSource?'register':local?shared?(current.runtime.features.pimRegistrations?.[`${source}|${group}`]?.expires>engine.clock.now()?'register':Object.values(current.config.interfaces).some(i=>i.ip===source)?'local':resolveEgress(current,source)?.interface??'register'):'local':resolution!.interface;if(!local&&!registeredSource&&!permits(current,input))break;
      const output=outputs.filter(p=>p!==input&&permits(current,p));chain.push({d:current,incoming:input,outgoing:output});
      if(registeredSource||local&&!remoteRoot){rooted=true;break;}if(remoteRoot)target=source;
      const onward=remoteRoot?resolveEgress(current,source):resolution;if(!onward)break;
      const ep=endpoints.find(p=>p.device.id===current.id&&p.name===input);if(!ep)break;
      const upstream=(peers.get(endpointKey(ep))??[]).find(p=>sameAddress(p.ip,onward.adjacent));
      if(!upstream){if(contains(ep.ip,ep.prefix,target)&&sameAddress(onward.adjacent,target))rooted=true;break;}
      if(!upstream.device.config.features.multicastRouting||!permits(upstream.device,upstream.name))break;
      outputs=[upstream.name];current=upstream.device;
    }
    if(!rooted)continue;
    for(const hop of chain){
      const rowKey=`${hop.d.id}|${hop.incoming}`;let row=routes.get(rowKey);if(!row){row={deviceId:hop.d.id,source,group,incoming:hop.incoming,outgoing:new Set(),mode:shared?'Shared tree (RP)':ssm(hop.d)?'SSM':hop.d.config.features.pim?.rpAddress?'SPT (RP eligible)':'Dense pruned',rp:hop.d.config.features.pim?.rpAddress};routes.set(rowKey,row);}
      for(const p of hop.outgoing)row.outgoing.add(p);
    }
  }
  for(const d of engine.lab.devices){
    const rows=(d.runtime.features.mroutes??[]).filter((r:any)=>r.source!==source||r.group!==group);for(const r of routes.values())if(r.deviceId===d.id)rows.push({...r,outgoing:[...r.outgoing]});d.runtime.features.mroutes=rows;
  }
}
type DenseState={source:string;group:string;incoming:string;created:number;lastData:number;expires:number;prunes:Record<string,number>;desired:string[];demand:boolean;received:number;forwarded:number;rpfDrops:number;timer?:any;graftTimer?:any;graftPending?:boolean};
function touchMulticastFlow(engine:Simulator,source:string,group:string):void {
  let flows=multicastFlows.get(engine);if(!flows){flows=new Map();multicastFlows.set(engine,flows);}const key=`${source}|${group}`,old=flows.get(key);engine.clock.cancel(old?.timer);
  const flow={source,group,expires:engine.clock.now()+300000,timer:undefined as any};flows.set(key,flow);flow.timer=engine.clock.schedule(300000,()=>{if(flows!.get(key)!==flow)return;flows!.delete(key);for(const d of engine.lab.devices){d.runtime.features.mroutes=(d.runtime.features.mroutes??[]).filter((r:any)=>r.source!==source||r.group!==group);delete d.runtime.features.pimRegisters?.[key];}buildSharedTrees(engine);engine.notify();},{label:'PIM source keepalive expiry'});
}
function localMembers(d:Device,source:string,group:string):any[]{return[...(d.runtime.features.igmpGroups??[]),...Object.values(d.config.interfaces).flatMap(i=>igmpMemberships(i).map(m=>({...m,interface:i.name})))].filter(m=>m.group===group&&(!m.source||m.source===source));}
function denseMode(d:Device,port:string):boolean {const mode=d.config.interfaces[port]?.features.pim;return mode==='dense-mode'||mode==='sparse-dense-mode'&&!d.config.features.pim?.rpAddress;}
function densePorts(engine:Simulator,d:Device):string[]{return Object.keys(d.config.interfaces).filter(port=>denseMode(d,port)&&engine.interfaceUp(d.id,port));}
function publishDense(engine:Simulator,d:Device,state:DenseState):void {
  const key=`${state.source}|${state.group}`,outgoing=densePorts(engine,d).filter(p=>p!==state.incoming&&(state.prunes[p]??0)<=engine.clock.now());
  // A host-facing interface has no downstream router to send a Prune. Its local membership controls it after the initial flood.
  const endpoints=routedPorts(engine),ws=wires(engine);for(const port of [...outgoing]){const ep=endpoints.find(p=>p.device.id===d.id&&p.name===port&&p.family===4),neighbor=ep&&broadcastPeers(engine,ws,ep,endpoints).some(p=>p.device.config.features.multicastRouting&&p.iface.features.pim);if(!neighbor&&!localMembers(d,state.source,state.group).some(m=>m.interface===port))outgoing.splice(outgoing.indexOf(port),1);}
  const row={deviceId:d.id,source:state.source,group:state.group,incoming:state.incoming,outgoing,mode:'Dense',flags:outgoing.length?'T':'PT',created:state.created,expires:state.expires,pruned:Object.entries(state.prunes).filter(([,expiry])=>expiry>engine.clock.now()).map(([interfaceName,expires])=>({interface:interfaceName,expires})),received:state.received,forwarded:state.forwarded,rpfDrops:state.rpfDrops};
  d.runtime.features.mroutes=(d.runtime.features.mroutes??[]).filter((r:any)=>`${r.source}|${r.group}`!==key);d.runtime.features.mroutes.push(row);
}
function denseSend(engine:Simulator,d:Device,state:DenseState,operation:'prune'|'graft'|'graft-ack',port=state.incoming,peer?:string):void {
  const iface=d.config.interfaces[port];if(!iface?.ip)return;const route=resolveEgress(d,state.source),target=peer??(route?.interface===port?route.adjacent:undefined);if(!target||target===state.source)return;
  engine.sendControlDatagram?.(d.id,iface.ip,target,103,{protocol:'pim',operation,source:state.source,group:state.group,holdtime:180},{interface:port,ttl:1,protocol:'pim'});event(engine,d,'PIM',operation==='graft'?'Graft sent':operation==='prune'?'Prune sent':'Graft-Ack sent',`${state.source}, ${state.group} on ${port}.`);
}
function receiveDenseControl(engine:Simulator,d:Device,reporter:string,p:any,input?:string):void {
  const port=input??Object.entries(d.config.interfaces).find(([,i])=>i.ip&&contains(i.ip,prefixOf(i.mask),reporter))?.[0],iface=port?d.config.interfaces[port]:undefined;if(!port||!iface?.ip||!denseMode(d,port)||!contains(iface.ip,prefixOf(iface.mask),reporter))return;
  const state:DenseState|undefined=d.runtime.features.pimDense?.[`${p.source}|${p.group}`];if(!state)return;
  if(p.operation==='graft-ack'){if(port===state.incoming){state.graftPending=false;engine.clock.cancel(state.graftTimer);}return;}
  if(p.operation==='prune'){state.prunes[port]=engine.clock.now()+Math.min(180,Math.max(1,Number(p.holdtime??180)))*1000;const expiry=state.prunes[port];engine.clock.schedule(expiry-engine.clock.now(),()=>{if(state.prunes[port]===expiry){delete state.prunes[port];publishDense(engine,d,state);engine.notify();}},{owner:d.id,label:'PIM prune expiry'});}
  else{delete state.prunes[port];denseSend(engine,d,state,'graft-ack',port,reporter);}
  publishDense(engine,d,state);engine.notify();
}
function synchronizeDenseDemand(engine:Simulator,source:string,group:string):void {
  for(const d of engine.lab.devices){const state:DenseState|undefined=d.runtime.features.pimDense?.[`${source}|${group}`];if(!state)continue;const computed=(d.runtime.features.mroutes??[]).filter((r:any)=>r.source===source&&r.group===group&&r.mode!=='Dense');const desired=[...new Set<string>(computed.flatMap((r:any)=>r.outgoing))],demand=desired.length>0;
    if(demand&&!state.demand){state.graftPending=true;let attempts=0;const send=()=>{if(!state.graftPending||++attempts>8)return;denseSend(engine,d,state,'graft');state.graftTimer=engine.clock.schedule(1000,send,{owner:d.id,label:'PIM graft retry'});};send();}
    else if(!demand&&state.demand)denseSend(engine,d,state,'prune');state.demand=demand;state.desired=desired;publishDense(engine,d,state);
  }
}
function denseForwarding(engine:Simulator,d:Device,input:string,source:string,group:string):{accept:boolean;outgoing:string[];reason?:string} {
  const reverse=resolveEgress(d,source),expected=Object.values(d.config.interfaces).some(i=>i.ip===source)?'local':reverse?.interface;
  const table=d.runtime.features.pimDense??={},key=`${source}|${group}`;let state:DenseState=table[key];if(!state){state=table[key]={source,group,incoming:expected??input,created:engine.clock.now(),lastData:engine.clock.now(),expires:0,prunes:{},desired:[],demand:false,received:0,forwarded:0,rpfDrops:0};}
  state.received++;state.incoming=expected??state.incoming;
  if(!expected||expected!==input){state.rpfDrops++;const endpoints=routedPorts(engine),ep=endpoints.find(p=>p.device.id===d.id&&p.name===input&&p.family===4),neighbor=ep&&broadcastPeers(engine,wires(engine),ep,endpoints).find(p=>p.device.config.features.multicastRouting&&p.iface.features.pim);if(neighbor)denseSend(engine,d,state,'prune',input,neighbor.ip);publishDense(engine,d,state);return{accept:false,outgoing:[],reason:`RPF failed: expected ${expected??'a source route'}, received ${input}.`};}
  buildMulticastTree(engine,source,group);const desired=(d.runtime.features.mroutes??[]).filter((r:any)=>r.source===source&&r.group===group).flatMap((r:any)=>r.outgoing);state.desired=desired;state.demand=desired.length>0;
  state.lastData=engine.clock.now();state.expires=state.lastData+180000;engine.clock.cancel(state.timer);state.timer=engine.clock.schedule(180000,()=>{if(table[key]!==state)return;delete table[key];d.runtime.features.mroutes=(d.runtime.features.mroutes??[]).filter((r:any)=>r.source!==source||r.group!==group);engine.notify();},{owner:d.id,label:'PIM dense state expiry'});
  const outgoing=densePorts(engine,d).filter(p=>p!==input&&(state.prunes[p]??0)<=engine.clock.now());if(outgoing.length)state.forwarded++;publishDense(engine,d,state);
  if(!state.demand)engine.clock.schedule(1,()=>denseSend(engine,d,state,'prune'),{owner:d.id,label:'PIM flood then prune'});
  return{accept:true,outgoing};
}
/** Membership maintains (*,G) independently of source keepalive state. Join propagation is computed along the unicast RP path. */
function buildSharedTrees(engine:Simulator):void {
  for(const d of engine.lab.devices)d.runtime.features.mroutes=(d.runtime.features.mroutes??[]).filter((r:any)=>r.source!=='*');
  const endpoints=routedPorts(engine).filter(p=>p.family===4),ws=wires(engine),groups=new Set<string>();for(const d of engine.lab.devices)for(const member of[...(d.runtime.features.igmpGroups??[]),...Object.values(d.config.interfaces).flatMap(i=>igmpMemberships(i))])groups.add(member.group);
  for(const group of groups)for(const receiver of engine.lab.devices){const rp=receiver.config.features.pim?.rpAddress;if(!rp||!receiver.config.features.multicastRouting||contains('232.0.0.0',8,group))continue;let current=receiver,outputs=localMembers(receiver,'',group).filter(m=>!m.source).map(m=>m.interface);if(!outputs.length)continue;const seen=new Set<string>();while(!seen.has(current.id)){seen.add(current.id);const own=Object.values(current.config.interfaces).find(i=>i.ip===rp),route=resolveEgress(current,rp),incoming=own?.name??route?.interface;if(!incoming)break;let row=current.runtime.features.mroutes.find((r:any)=>r.source==='*'&&r.group===group);if(!row){row={deviceId:current.id,source:'*',group,rp,incoming,outgoing:[],mode:'Shared join',flags:current.id===receiver.id?'SJC':'S'};current.runtime.features.mroutes.push(row);}row.outgoing=[...new Set([...row.outgoing,...outputs.filter(p=>p!==incoming)])];if(own)break;const ep=endpoints.find(p=>p.device.id===current.id&&p.name===incoming),upstream=ep&&broadcastPeers(engine,ws,ep,endpoints).find(p=>p.ip===route?.adjacent&&p.device.config.features.multicastRouting&&p.iface.features.pim);if(!upstream)break;current=upstream.device;outputs=[upstream.name];}}
}
function sharedReceivers(engine:Simulator,group:string,rp:string,shared=true):boolean {
  return engine.lab.devices.some(d=>d.config.features.multicastRouting&&d.config.features.pim?.rpAddress===rp&&(d.config.features.pim?.sptThreshold==='infinity')===shared&&[...(d.runtime.features.igmpGroups??[]),...Object.values(d.config.interfaces).flatMap(i=>igmpMemberships(i))].some((g:any)=>g.group===group));
}
/** Encapsulate real first-hop multicast data when a computed shared-tree join requires the RP. */
export function registerMulticast(engine:Simulator,d:Device,input:string,packet:any):boolean {
  if(input==='register'||!d.config.features.multicastRouting||!groupAddress(packet.destination)||contains('224.0.0.0',24,packet.destination))return false;
  const rp=d.config.features.pim?.rpAddress;if(!rp)return false;
  if((d.config.features.pim?.ssmRanges??[{network:'232.0.0.0',prefix:8}]).some((r:any)=>contains(r.network,r.prefix,packet.destination)))return false;
  const sourceRoute=bestRoute(d,packet.source),localSource=Object.values(d.config.interfaces).some(i=>i.ip===packet.source);if(input!=='local'&&!(sourceRoute?.protocol==='connected'&&sourceRoute.interface===input)||input==='local'&&!localSource)return false;
  const dr=d.runtime.features.pimInterfaces?.[input];if(dr&&dr.drDeviceId!==d.id)return true;if(Object.values(d.config.interfaces).some(i=>i.ip===rp)){observeMsdpSource(engine,d,packet.source,packet.destination);return false;}
  const key=`${packet.source}|${packet.destination}`,table=d.runtime.features.pimRegisters??={},old=table[key],shared=sharedReceivers(engine,packet.destination,rp);if(!shared&&old?.state==='SPT')return false;
  const egress=resolveEgress(d,rp),source=egress&&d.config.interfaces[egress.interface]?.ip;if(!source)return true;
  table[key]={source:packet.source,group:packet.destination,rp,state:'REGISTERING',lastSent:engine.clock.now(),packets:(old?.packets??0)+1};
  engine.sendControlDatagram?.(d.id,source,rp,103,{protocol:'pim',operation:'register',sender:d.id,source:packet.source,group:packet.destination,packet:structuredClone(packet)},{ttl:64,protocol:'pim'});event(engine,d,'PIM','Register sent',`${packet.source}, ${packet.destination} encapsulated to RP ${rp}.`);return !shared||!sharedReceivers(engine,packet.destination,rp,false);
}
function receivePim(engine:Simulator,deviceId:string,reporter:string,destination:string,p:any,input?:string):void {
  const d=engine.getDevice(deviceId);if(!d?.config.features.multicastRouting||!groupAddress(p.group))return;
  const key=`${p.source}|${p.group}`;
  if(['prune','graft','graft-ack'].includes(p.operation)){receiveDenseControl(engine,d,reporter,p,input);return;}
  if(p.operation==='register-stop'){
    const row=d.runtime.features.pimRegisters?.[key];if(!row||row.rp!==reporter)return;row.state='SPT';row.lastStop=engine.clock.now();event(engine,d,'PIM','Register-Stop received',`${p.source}, ${p.group}: subsequent packets use the source tree.`);engine.recompute();engine.notify();return;
  }
  if(p.operation!=='register'||d.config.features.pim?.rpAddress!==destination||!Object.values(d.config.interfaces).some(i=>i.ip===destination)||p.packet?.source!==p.source||p.packet?.destination!==p.group)return;
  const sender=engine.getDevice(p.sender);if(!sender?.config.features.multicastRouting||sender.config.features.pim?.rpAddress!==destination||!Object.values(sender.config.interfaces).some(i=>i.ip===reporter))return;
  const shared=sharedReceivers(engine,p.group,destination);if(!shared){engine.sendControlDatagram?.(d.id,destination,reporter,103,{protocol:'pim',operation:'register-stop',source:p.source,group:p.group},{ttl:64,protocol:'pim'});event(engine,d,'PIM','Register-Stop sent',`${p.source}, ${p.group}: source-tree transition.`);}
  const table=d.runtime.features.pimRegistrations??={},entry={source:p.source,group:p.group,designatedRouter:reporter,expires:engine.clock.now()+185000};table[key]=entry;
  engine.clock.schedule(185000,()=>{if(table[key]===entry){delete table[key];engine.recompute();engine.notify();}},{owner:d.id,label:'PIM register state expiry'});
  observeMsdpSource(engine,d,p.source,p.group);event(engine,d,'PIM','Register received',`${p.source}, ${p.group}: decapsulated at RP.`);engine.receiveRegisteredMulticast?.(d.id,{...structuredClone(p.packet),pimTree:shared?undefined:'rpt'});engine.notify();
}
/** Return a multicast output list only after unicast RPF and membership/policy checks. */
export function multicastForwarding(engine:Simulator,d:Device,input:string,source:string,group:string,packet?:any):{accept:boolean;outgoing:string[];reason?:string} {
  if(!groupAddress(group)||contains('224.0.0.0',24,group))return{accept:false,outgoing:[],reason:'Link-local multicast is not routed.'};
  if(!d.config.features.multicastRouting)return{accept:false,outgoing:[],reason:'Multicast routing is disabled.'};
  touchMulticastFlow(engine,source,group);
  if(denseMode(d,input))return denseForwarding(engine,d,input,source,group);
  buildMulticastTree(engine,source,group,packet?.pimTree==='rpt');
  const rows=(d.runtime.features.mroutes??[]).filter((r:any)=>r.source===source&&r.group===group),row=rows.find((r:any)=>r.incoming===input)??rows[0];
  if(!row)return{accept:false,outgoing:[],reason:'No joined receiver tree, eligible RP or reverse route.'};
  if(row.incoming!==input)return{accept:false,outgoing:[],reason:`RPF failed: expected ${row.incoming}, received ${input}.`};
  return{accept:true,outgoing:row.outgoing.filter((port:string)=>port!==input&&engine.interfaceUp(d.id,port))};
}

function udldConfig(d:Device,port:string):any {
  const local=d.config.interfaces[port]?.features.udld;return local===false?undefined:local??d.config.features.udld;
}
function publishUdld(engine:Simulator):void {
  for(const d of engine.lab.devices)d.runtime.features.udld={};
  for(const s of udldSessions.get(engine)?.values()??[]){const d=engine.getDevice(s.deviceId);if(d)d.runtime.features.udld[s.port]={state:s.state,neighborDeviceId:s.neighborDeviceId,neighborPort:s.neighborPort,lastReceived:s.lastReceived,retries:s.retries,mode:s.mode,messageTime:s.messageTime};}
}
function sendUdld(engine:Simulator,s:UdldSession):void {
  engine.sendLinkControl?.(s.deviceId,s.port,{kind:'link-control',protocol:'UDLD',body:{deviceId:s.deviceId,port:s.port,messageTime:s.messageTime,echo:s.state==='DETECTION'?undefined:s.neighborDeviceId?{deviceId:s.neighborDeviceId,port:s.neighborPort}:undefined}});
}
function disableUdld(engine:Simulator,s:UdldSession,reason:string):void {
  const d=engine.getDevice(s.deviceId),iface=d?.config.interfaces[s.port];if(!d||!iface)return;
  if(!disableInterface(engine,d,s.port,'udld'))return;iface.features.errDisabledReason='UDLD';s.state='ERR-DISABLED';engine.clock.cancel(s.tx);engine.clock.cancel(s.retry);engine.clock.cancel(s.expiry);
  event(engine,d,'UDLD',`${s.port} err-disabled`,reason,true);publishUdld(engine);engine.recompute();engine.notify();
}
function expireUdld(engine:Simulator,s:UdldSession):void {
  if(s.state==='ERR-DISABLED')return;
  if(s.mode!=='aggressive'){s.state='UNKNOWN';s.neighborDeviceId=undefined;s.neighborPort=undefined;publishUdld(engine);engine.notify();return;}
  s.state='DETECTION';s.retries=0;publishUdld(engine);
  const retry=()=>{
    if(s.state!=='DETECTION')return;
    if(s.retries>=8){disableUdld(engine,s,'No bidirectional echo after eight one-second retries.');return;}
    s.retries++;sendUdld(engine,s);publishUdld(engine);s.retry=engine.clock.schedule(1000,retry,{owner:s.deviceId,label:'UDLD aggressive retry'});
  };retry();
}
function synchronizeUdld(engine:Simulator):void {
  let sessions=udldSessions.get(engine);if(!sessions){sessions=new Map();udldSessions.set(engine,sessions);}const wanted=new Set<string>();
  for(const d of engine.lab.devices)for(const[port,iface]of Object.entries(d.config.interfaces)){
    const cfg=udldConfig(d,port);if(!cfg||!d.powered||!iface.adminUp||/^(Loopback|Vlan|Tunnel|Port-channel)/i.test(port)||port.includes('.'))continue;
    const key=`${d.id}|${port}`;wanted.add(key);let s=sessions.get(key);
    if(s&&(s.runtime!==d.runtime||s.state==='ERR-DISABLED'&&!iface.features.errDisabled)){engine.clock.cancel(s.tx);engine.clock.cancel(s.expiry);engine.clock.cancel(s.retry);sessions.delete(key);s=undefined;}
    if(!s){s={deviceId:d.id,port,mode:cfg.mode??'normal',messageTime:Math.max(1,Number(cfg.messageTime??15)),state:iface.features.errDisabledReason==='UDLD'&&iface.features.errDisabled?'ERR-DISABLED':'UNKNOWN',retries:0,runtime:d.runtime};sessions.set(key,s);}
    s.mode=cfg.mode??'normal';s.messageTime=Math.max(1,Number(cfg.messageTime??15));
    if(s.tx&&s.tx.repeat!==s.messageTime*1000){engine.clock.cancel(s.tx);s.tx=undefined;}
    if(s.state==='ERR-DISABLED')continue;
    if(!engine.interfaceUp(d.id,port)){engine.clock.cancel(s.tx);s.tx=undefined;engine.clock.cancel(s.expiry);engine.clock.cancel(s.retry);s.state='UNKNOWN';s.neighborDeviceId=undefined;s.neighborPort=undefined;continue;}
    if(!s.tx){const current=s;s.tx=engine.clock.schedule(0,()=>sendUdld(engine,current),{owner:d.id,repeat:s.messageTime*1000,label:'UDLD advertisement'});}
  }
  for(const[key,s]of sessions)if(!wanted.has(key)){engine.clock.cancel(s.tx);engine.clock.cancel(s.expiry);engine.clock.cancel(s.retry);sessions.delete(key);}
  publishUdld(engine);
}
/** UDLD PDUs terminate on the physical link before VLAN/STP data forwarding. */
export function receiveLinkControl(engine:Simulator,d:Device,port:string,message:{protocol:string;body:any}):boolean {
  if(message.protocol==='VPC-CFS'){receiveVPCCFS(engine,d,port,message.body);return true;}
  if(receiveDiscoveryControl(engine,d.id,port,message))return true;
  if(receiveSwitchingMessage(engine,d,port,message))return true;
  if(message.protocol==='STP'){receiveStpHeartbeat(engine,d,port,message.body);return true;}
  if(message.protocol!=='UDLD')return false;
  const s=udldSessions.get(engine)?.get(`${d.id}|${port}`);if(!s||s.state==='ERR-DISABLED')return true;
  const p=message.body;if(!p?.deviceId||!p.port)return true;
  const previous=s.state,first=s.neighborDeviceId!==p.deviceId||s.neighborPort!==p.port;
  s.neighborDeviceId=p.deviceId;s.neighborPort=p.port;s.lastReceived=engine.clock.now();
  const echoed=p.echo?.deviceId===d.id&&p.echo?.port===port;
  if(echoed){s.state='BIDIRECTIONAL';s.retries=0;engine.clock.cancel(s.retry);}
  else if(previous==='BIDIRECTIONAL'){disableUdld(engine,s,'Peer no longer echoes this device and port; the link is unidirectional.');return true;}
  engine.clock.cancel(s.expiry);s.expiry=engine.clock.schedule(3*Math.max(s.messageTime,Number(p.messageTime)||15)*1000,()=>expireUdld(engine,s),{owner:d.id,label:'UDLD neighbor expiry'});
  if(first)engine.clock.schedule(0,()=>sendUdld(engine,s),{owner:d.id,label:'UDLD echo'});
  if(previous!==s.state)event(engine,d,'UDLD',`${port} ${s.state.toLowerCase()}`,`Peer ${p.deviceId} ${p.port}.`);
  publishUdld(engine);engine.notify();return true;
}
/** A GLBP AVG answers ARP using one active virtual forwarder; other members remain silent. */
export function virtualArpReply(engine:Simulator,d:Device,port:string,ip:string,clientMac:string):{handled:boolean;mac?:string} {
  const groups=(d.runtime.features.glbpGroups??[]).filter((g:any)=>g.interface===port&&g.virtualIp===ip);
  if(!groups.length)return{handled:false};
  const g=groups.find((g:any)=>g.role==='active');if(!g)return{handled:true};
  const forwarders=g.forwarders.filter((f:any)=>f.eligible);if(!forwarders.length)return{handled:true};
  let all=glbpAssignments.get(engine);if(!all){all=new Map();glbpAssignments.set(engine,all);}
  let clients=all.get(g.id);if(!clients){clients=new Map();all.set(g.id,clients);}
  let selected=forwarders.find((f:any)=>f.id===clients!.get(clientMac));
  if(!selected){
    let index=clients.size;
    if(g.loadBalancing==='host-dependent'){index=0;for(const c of clientMac)index=(Math.imul(index,31)+c.charCodeAt(0))>>>0;}
    if(g.loadBalancing==='weighted'){
      const total=forwarders.reduce((n:number,f:any)=>n+Math.max(1,f.weight),0);let ticket=(index*73)%total;
      selected=forwarders.find((f:any)=>(ticket-=Math.max(1,f.weight))<0);
    }else selected=forwarders[index%forwarders.length];
    clients.set(clientMac,selected.id);
  }
  return{handled:true,mac:selected.mac};
}
function trackStates(engine:Simulator,d:Device):Record<string,{up:boolean;description:string}> {
  const result:Record<string,{up:boolean;description:string}>={};
  for(const [id,t]of Object.entries(d.config.features.tracks??{}) as [string,any][]) {
    if(t.type==='sla')result[id]={up:slaTrackUp(d,t.sla,t.aspect),description:`IP SLA ${t.sla} ${t.aspect??'reachability'}`};
    else if(t.type==='bfd')result[id]={up:(d.runtime.features.bfd??[]).some((s:any)=>s.interface===t.interface&&(!t.peer||sameAddress(s.peer,t.peer))&&s.state==='UP'),description:`BFD ${t.interface} ${t.peer??''}`};
    else if(t.type==='interface'||t.interface)result[id]={up:engine.interfaceUp(d.id,t.interface),description:`Interface ${t.interface}`};
    else if(t.type==='route'||t.network)result[id]={up:d.runtime.routes.some(r=>r.network===subnet(t.network,t.prefix??32)&&r.prefix===(t.prefix??32)&&(r.vrf??'')===(t.vrf??'')&&(/^null/i.test(r.interface)||!!resolveEgress(d,r.network,r.vrf))),description:`Route ${t.network}/${t.prefix??32}`};
    else result[id]={up:false,description:'Unsupported tracking object'};
  }
  return settleTrackStates(engine,d,result);
}
function lanReady(source:RoutedPort,ws:Wire[]):boolean {
  const svi=/^vlan(\d+)$/i.exec(source.name);
  if(svi)return Object.entries(source.device.config.interfaces).some(([name,iface])=>forwardAllowed({device:source.device,iface,name},Number(svi[1])));
  const members=/^port-channel/i.test(source.name)?source.device.runtime.features.portChannels?.[source.name.replace(/^port-channel/i,'')]?.activeMembers??[]:[source.name.split('.')[0]];
  return ws.some(w=>{
    const local=w.a.device.id===source.device.id&&members.includes(w.a.name)?w.a:w.b.device.id===source.device.id&&members.includes(w.b.name)?w.b:undefined;
    if(!local)return false;const peer=local===w.a?w.b:w.a;
    if(!peer.iface.switchport)return true;
    const tag=dot1q(source),vlan=effectiveTrunk(peer)?tag??peer.iface.nativeVlan:peer.iface.vlan;
    return (tag===undefined||effectiveTrunk(peer)||tag===peer.iface.vlan)&&forwardAllowed(peer,vlan);
  });
}
type GatewayCandidate={deviceId:string;interface:string;source:string;priority:number;role?:string;settings:any;weight?:number;eligible?:boolean};
const gatewayStartup=new WeakMap<Simulator,Map<string,{at:number;runtime:Device['runtime'];timer:any}>>();
const gatewayPreemption=new WeakMap<Simulator,Map<string,{target:string;since:number;timer:any;runtime:Device['runtime']}>>();
function electGateway(engine:Simulator,d:Device,local:GatewayCandidate,peers:GatewayCandidate[],protocol:string,groupKey:string):GatewayCandidate {
  const rank=(a:GatewayCandidate,b:GatewayCandidate)=>b.priority-a.priority||ipNumber(b.source)-ipNumber(a.source),all=[local,...peers].sort(rank),active=all.filter(c=>c.role==='active').sort(rank),incumbent=active[0],best=all[0];
  const timerKey=`${d.id}|${groupKey}`;let startups=gatewayStartup.get(engine);if(!startups){startups=new Map();gatewayStartup.set(engine,startups);}let startup=startups.get(timerKey);if(!startup||startup.runtime!==d.runtime){engine.clock.cancel(startup?.timer);startup={at:engine.clock.now(),runtime:d.runtime,timer:undefined};startups.set(timerKey,startup);const current=startup;startup.timer=engine.clock.schedule(Number(local.settings.holdTime??(protocol==='vrrp'?3000:10000)),()=>{if(d.runtime===current.runtime){engine.recompute();engine.notify();}},{owner:d.id,label:`${protocol.toUpperCase()} startup listen`});}
  if(!peers.length&&local.role!=='active'&&engine.clock.now()-startup.at<Number(local.settings.holdTime??(protocol==='vrrp'?3000:10000)))return{...local,deviceId:'',source:'pending advertisement',role:'listen'};
  const clearPending=()=>{const timers=gatewayPreemption.get(engine),row=timers?.get(timerKey);if(row){engine.clock.cancel(row.timer);timers!.delete(timerKey);}};
  if(!incumbent||best===incumbent||best.priority===255&&protocol==='vrrp'){clearPending();return best;}
  // Concurrent active advertisements resolve by priority/address. A standby only displaces an active peer after its own configured preemption delay.
  if(best.role==='active'){clearPending();return best;}if(best.deviceId!==d.id||!(best.settings.preempt??protocol==='vrrp')){clearPending();return incumbent;}
  const delay=Math.max(0,Number(best.settings.preemptDelay??0))*1000;if(!delay){clearPending();return best;}let timers=gatewayPreemption.get(engine);if(!timers){timers=new Map();gatewayPreemption.set(engine,timers);}const key=`${d.id}|${groupKey}`,target=`${incumbent.deviceId}|${best.priority}`,old=timers.get(key);
  let row=old;if(!row||row.target!==target||row.runtime!==d.runtime){engine.clock.cancel(row?.timer);row={target,since:engine.clock.now(),timer:undefined,runtime:d.runtime};timers.set(key,row);const current=row;row.timer=engine.clock.schedule(delay,()=>{if(timers!.get(key)===current&&d.runtime===current.runtime){engine.recompute();engine.notify();}},{owner:d.id,label:`${protocol.toUpperCase()} preemption delay`});}
  return engine.clock.now()-row.since>=delay?best:incumbent;
}
function fhrp(engine:Simulator,endpoints:RoutedPort[],_peers:Map<string,RoutedPort[]>,ws:Wire[]):void {
  for(const d of engine.lab.devices){const previous=d.runtime.features.virtualIps??[];d.runtime.features.virtualIps=[];const tracks=trackStates(engine,d);d.runtime.features.tracks=tracks;
    for(const raw of d.config.features.fhrp??[]){const protocol=String(raw.protocol??'hsrp').toLowerCase();if(!['hsrp','vrrp'].includes(protocol))continue;const settings={...raw,protocol},p=endpoints.find(p=>p.family===4&&p.device.id===d.id&&p.name===settings.interface);if(!p||!contains(p.ip,p.prefix,settings.virtualIp)||!lanReady(p,ws))continue;const old=previous.find((v:any)=>v.interface===p.name&&v.protocol===protocol&&v.group===Number(settings.group??0));let priority=Number(settings.priority??100);for(const t of Array.isArray(settings.track)?settings.track:settings.track!==undefined?[typeof settings.track==='object'?settings.track:{id:settings.track,decrement:10}]:[])if(!tracks[t.id]?.up)priority-=Number(t.decrement??10);priority=Math.max(0,priority);if(protocol==='vrrp'&&settings.virtualIp===p.ip)priority=255;
      const local:GatewayCandidate={deviceId:d.id,interface:p.name,source:p.ip,priority,role:old?.role,settings},others=fhrpPeerView(engine,d.id,p.name,settings).map(v=>({...v,settings:{...settings,...v.settings}})),active=electGateway(engine,d,local,others,protocol,`${protocol}|${p.name}|${settings.group}|${settings.virtualIp}`),standby=[local,...others].filter(c=>c.deviceId!==active.deviceId).sort((a,b)=>b.priority-a.priority||ipNumber(b.source)-ipNumber(a.source))[0],role=!active.deviceId?'listen':active.deviceId===d.id?'active':standby?.deviceId===d.id?'standby':'listen',n=Number(settings.group??0),hex=n.toString(16).padStart(4,'0'),mac=protocol==='vrrp'?`00:00:5e:00:01:${hex.slice(-2)}`:Number(settings.version??1)===2?`00:00:0c:9f:f${hex.slice(-3,-2)}:${hex.slice(-2)}`:`00:00:0c:07:ac:${hex.slice(-2)}`;
      d.runtime.features.virtualIps.push({interface:p.name,ip:settings.virtualIp,mac,protocol,group:n,role,activeDeviceId:active.deviceId,priority,version:settings.version??(protocol==='vrrp'?2:1)});
      if(role==='active'&&old?.role!=='active')engine.clock.schedule(1,()=>engine.sendGratuitousARP?.(d.id,p.name,settings.virtualIp,mac),{owner:d.id,label:'Virtual gateway announcement'});if(old?.role!==role)event(engine,d,protocol.toUpperCase(),`Group ${n} ${role}`,`Virtual address ${settings.virtualIp}; priority ${priority}; active peer ${active.source}.`);
    }
  }
}
function glbp(engine:Simulator,endpoints:RoutedPort[],_peers:Map<string,RoutedPort[]>,ws:Wire[]):void {
  for(const d of engine.lab.devices){const old=d.runtime.features.glbpGroups??[];d.runtime.features.glbpGroups=[];for(const cfg of d.config.features.fhrp??[]){if(cfg.protocol!=='glbp')continue;const p=endpoints.find(p=>p.family===4&&p.device.id===d.id&&p.name===cfg.interface);if(!p||!contains(p.ip,p.prefix,cfg.virtualIp)||!lanReady(p,ws))continue;const previous=old.find((g:any)=>g.group===Number(cfg.group??0)&&g.virtualIp===cfg.virtualIp&&g.interface===p.name);let weight=Number(cfg.weighting?.maximum??100);for(const t of Array.isArray(cfg.track)?cfg.track:[])if(!d.runtime.features.tracks?.[t.id]?.up)weight-=Number(t.decrement??10);weight=Math.max(0,weight);const lower=Number(cfg.weighting?.lower??1),upper=Number(cfg.weighting?.upper??cfg.weighting?.maximum??100),eligible=previous?.weightEligible===false?weight>=upper:weight>=lower;
      const local:GatewayCandidate={deviceId:d.id,interface:p.name,source:p.ip,priority:Number(cfg.priority??100),role:previous?.role,settings:cfg,weight,eligible},others:GatewayCandidate[]=fhrpPeerView(engine,d.id,p.name,cfg).map(v=>({...v,settings:{...cfg,...v.settings},weight:v.weight??100,eligible:v.weightEligible!==false})),all=[local,...others].sort((a,b)=>ipNumber(b.source)-ipNumber(a.source)),avg=electGateway(engine,d,local,others,'glbp',`glbp|${p.name}|${cfg.group}|${cfg.virtualIp}`),standby=[...all].filter(c=>c.deviceId!==avg.deviceId).sort((a,b)=>b.priority-a.priority||ipNumber(b.source)-ipNumber(a.source))[0],role=!avg.deviceId?'listen':avg.deviceId===d.id?'active':standby?.deviceId===d.id?'standby':'listen',id=`glbp|${cfg.group}|${cfg.virtualIp}|${p.iface.vrf??''}`,n=Number(cfg.group??0),hex=n.toString(16).padStart(4,'0');
      let forwarders:any[]=(previous?.forwarders??[]).map((f:any)=>({...f}));if(all.length>forwarders.length)forwarders=all.slice(0,4).map((member,index)=>({id:index+1,originalDeviceId:member.deviceId,mac:`00:07:b4:${hex.slice(-4,-2)}:${hex.slice(-2)}:${(index+1).toString(16).padStart(2,'0')}`}));
      for(const f of forwarders){const owner=all.find(c=>c.deviceId===f.originalDeviceId&&c.eligible)??all.find(c=>c.deviceId===f.deviceId&&c.eligible)??all.find(c=>c.eligible),previousOwner=f.deviceId;f.deviceId=owner?.deviceId;f.weight=owner?.weight??0;f.eligible=!!owner;if(owner?.deviceId===d.id){d.runtime.features.virtualIps.push({interface:p.name,ip:cfg.virtualIp,mac:f.mac,protocol:'glbp',group:n,role:'active',activeDeviceId:d.id,priority:local.priority,forwarderId:f.id});if(previousOwner&&previousOwner!==d.id)engine.clock.schedule(1,()=>engine.sendGratuitousARP?.(d.id,p.name,cfg.virtualIp,f.mac),{owner:d.id,label:'GLBP forwarder takeover'});}}
      d.runtime.features.glbpGroups.push({id,group:n,interface:p.name,virtualIp:cfg.virtualIp,role,activeDeviceId:avg.deviceId,priority:local.priority,weight,weightEligible:eligible,loadBalancing:avg.settings.loadBalancing??'round-robin',forwarders});if(previous?.role!==role)event(engine,d,'GLBP',`Group ${n} ${role}`,`${forwarders.filter(f=>f.eligible).length} virtual forwarder(s); AVG ${avg.source}.`);
    }}
}

/** BMCA election model only; no oscillator, timestamp servo or hardware accuracy claim. */
function ptpElection(engine:Simulator,ws:Wire[]):void {
  const clocks=engine.lab.devices.filter(d=>d.powered&&d.config.features.ptp&&d.config.features.ptp.mode!=='disabled'),choices=new Map<string,{master:Device;steps:number;input?:string}[]>();
  const rank=(d:Device)=>([d.config.features.ptp.priority1??128,d.config.features.ptp.clockClass??248,d.config.features.ptp.clockAccuracy??254,d.config.features.ptp.variance??65535,d.config.features.ptp.priority2??128]);
  const compare=(a:Device,b:Device)=>{const ar=rank(a),br=rank(b);for(let n=0;n<ar.length;n++)if(ar[n]!==br[n])return ar[n]-br[n];return natural(a.config.features.ptp.clockIdentity??bridgeMac(a),b.config.features.ptp.clockIdentity??bridgeMac(b));};
  for(const master of clocks.filter(d=>d.config.features.ptp.mode!=='transparent'&&!d.config.features.ptp.slaveOnly)){
    const domain=Number(master.config.features.ptp.domain??0),visited=new Set<string>(),queue=[{device:master,steps:0,input:undefined as string|undefined}];
    while(queue.length){
      const current=queue.shift()!;if(visited.has(current.device.id))continue;visited.add(current.device.id);
      const cfg=current.device.config.features.ptp;
      if(cfg&&Number(cfg.domain??0)===domain){const list=choices.get(current.device.id)??[];list.push({master,steps:current.steps,input:current.input});choices.set(current.device.id,list);}
      if(current.device!==master&&!switching(current.device)&&(!cfg||cfg.mode!=='boundary'||Number(cfg.domain??0)!==domain))continue;
      for(const w of ws){
        const local=w.a.device===current.device?w.a:w.b.device===current.device?w.b:undefined;if(!local||local.name===current.input)continue;const peer=local===w.a?w.b:w.a;
        const vlan=local.iface.switchport?(effectiveTrunk(local)?local.iface.nativeVlan:local.iface.vlan):1;
        if(local.iface.switchport&&!forwardAllowed(local,vlan)||peer.iface.switchport&&!forwardAllowed(peer,effectiveTrunk(peer)?peer.iface.nativeVlan:peer.iface.vlan))continue;
        queue.push({device:peer.device,steps:current.steps+(cfg?.mode==='boundary'?1:0),input:peer.name});
      }
    }
  }
  for(const d of engine.lab.devices){
    const cfg=d.config.features.ptp;if(!cfg){delete d.runtime.features.ptp;continue;}
    const best=(choices.get(d.id)??[]).sort((a,b)=>compare(a.master,b.master)||a.steps-b.steps||natural(a.input??'',b.input??''))[0],previous=d.runtime.features.ptp;
    const role=!d.powered||cfg.mode==='disabled'?'DISABLED':cfg.mode==='transparent'?'TRANSPARENT':!best?'LISTENING':best.master===d?'GRANDMASTER':cfg.mode==='boundary'?'BOUNDARY':'SLAVE';
    const ports:Record<string,string>={};for(const[name]of Object.entries(d.config.interfaces))if(engine.interfaceUp(d.id,name))ports[name]=best?.input===name?'SLAVE':role==='GRANDMASTER'||role==='BOUNDARY'?'MASTER':role==='TRANSPARENT'?'TRANSPARENT':'PASSIVE';
    d.runtime.features.ptp={mode:cfg.mode??'ordinary',domain:Number(cfg.domain??0),role,grandmasterId:best?.master.id,grandmasterIdentity:best?.master.config.features.ptp.clockIdentity??(best?bridgeMac(best.master):undefined),stepsRemoved:best?.steps,ports,synchronized:false,model:'BMCA election; oscillator/servo/timestamp synchronization is not modeled.'};
    if(previous?.grandmasterId!==best?.master.id||previous?.role!==role)event(engine,d,'PTP',`Clock ${role.toLowerCase()}`,best?`Elected ${best.master.config.hostname} in domain ${cfg.domain??0}; election model only.`:'No eligible grandmaster.');
  }
}

/** Prepare operational trunks and bundles before the core builds connected routes. */
export function prepareLinkState(engine:Simulator):void {
  const ws=wires(engine);negotiateTrunks(engine,ws);negotiateChannels(engine,ws);syncVPC(engine);syncSwitchingMessages(engine,(d,iface)=>channelSignature({device:d,iface,name:iface.name},true));
}

/** Core rebuilds connected/static routes before calling this function. */
export function recomputeControlPlane(engine:Simulator):void {
  let session=state.get(engine);
  if(!session){session={transitions:new Map()};state.set(engine,session);}
  engine.clock.cancel(session.timer);session.timer=undefined;
  const routingProtocols=['OSPF','OSPFV3','OSPFV3IPV4','EIGRP','EIGRP6','RIP','RIPNG','BGP'];
  const oldNeighbors=new Map(engine.lab.devices.map(d=>[d.id,JSON.stringify(d.runtime.neighbors.filter(n=>routingProtocols.includes(n.protocol)))]));
  for(const d of engine.lab.devices){refreshTrackingBindings(engine,d);reconcileErrdisable(engine,d);d.runtime.neighbors=[];d.runtime.features.capabilities=CONTROL_PLANE_CAPABILITIES;d.runtime.features.ospfNssa={};d.runtime.features.ospfv3Nssa={};}
  synchronizeUdld(engine);
  const ws=wires(engine);
  negotiateTrunks(engine,ws);negotiateChannels(engine,ws);syncVPC(engine);syncSwitchingMessages(engine,(d,iface)=>channelSignature({device:d,iface,name:iface.name},true));
  let next=spanningTree(engine);synchronizeStpHeartbeats(engine);const keyBoundary=keychainStates(engine);if(keyBoundary!==undefined)next=next===undefined?keyBoundary:Math.min(next,keyBoundary);
  ptpElection(engine,ws);
  syncDiscovery(engine);
  synchronizeNhrp(engine);
  const endpoints=routedPorts(engine);
  for(const d of engine.lab.devices)syncIOSOSPFRouterIds(d,p=>engine.interfaceUp(d.id,p.name));
  const peers=new Map(endpoints.map(p=>[endpointKey(p),broadcastPeers(engine,ws,p,endpoints)]));
  synchronizeBfd(engine,endpoints,peers);syncFhrpPackets(engine);
  const graphs=new Map<string,Adj[]>();dualContext(engine).candidates.clear();
  for(const protocol of ['ospf','eigrp','rip','ospfv3','ospfv3ipv4','eigrp6','ripng']) {
    let graph=adjacency(engine,endpoints,peers,protocol);if(eigrpProtocol(protocol))graph=synchronizeEigrpHellos(engine,endpoints,graph,protocol);graphs.set(protocol,graph);
    if(ospfProtocol(protocol)){for(const d of engine.lab.devices)for(const n of d.runtime.neighbors)if(n.protocol===protocol.toUpperCase()&&!['AUTH-FAILED','BFD-DOWN','EXSTART'].includes(n.state))n.state=verifiedOSPFAdjacency(engine,protocol as OSPFProtocol,d.id,n.interface,n.deviceId,n.peerInterface??'');installOspfPackets(engine,endpoints,protocol as OSPFProtocol);}
    else if(eigrpProtocol(protocol)){installReceivedEigrp(engine,endpoints,graph,protocol as EigrpFamily);graphs.set(protocol,graph.filter(edge=>eigrpUpdateReady(engine,dualPeerKey(edge,protocol))));for(const d of engine.lab.devices)for(const n of d.runtime.neighbors)if(n.protocol===protocol.toUpperCase()&&n.state==='UP'&&!eigrpUpdateReady(engine,`${d.id}|${protocol}|${n.interface}|${n.address}`))n.state='INIT (UPDATE)';}
    else if(!ripProtocol(protocol))installIgp(engine,endpoints,graph,protocol);
  }
  synchronizeRip(engine,endpoints,peers);
  for(let round=0;round<3;round++)redistribute(engine,endpoints,graphs);
  reconcileDual(engine,graphs);bgp(engine,endpoints,peers);redistribute(engine,endpoints,graphs);synchronizeRip(engine,endpoints,peers);reconcileDual(engine,graphs);
  // Learned external components and named wide metrics are now settled. Rebuild
  // conditional discards from the final RIB, retaining no stale minimum metric.
  for(const d of engine.lab.devices)d.runtime.routes=d.runtime.routes.filter(r=>r.protocol!=='D summary');
  for(const p of ['eigrp','eigrp6'])installEigrpSummaries(engine,endpoints,p);
  for(const p of ['eigrp','eigrp6'] as EigrpFamily[])advertiseSelectedEigrp(engine,endpoints,p);
  for(const p of ['ospf','ospfv3','ospfv3ipv4'] as OSPFProtocol[])syncOSPF(engine,ospfPacketSnapshot(engine,endpoints,graphs.get(p)??[],p));fhrp(engine,endpoints,peers,ws);glbp(engine,endpoints,peers,ws);syncMsdp(engine);synchronizeMulticast(engine);
  for(const d of engine.lab.devices) {
    const neighbors=d.runtime.neighbors.filter(n=>routingProtocols.includes(n.protocol));
    if(oldNeighbors.get(d.id)!==JSON.stringify(neighbors))event(engine,d,'CONTROL','Routing neighbors recomputed',`${neighbors.length} configured protocol relationship(s); inspect neighbor states for adjacency status.`);
  }
  if(next!==undefined)session.timer=engine.clock.schedule(Math.max(0,next-engine.clock.now()),()=>{engine.recompute();engine.notify();},{label:'Control-plane timed transition'});
}

/** Administrative neighbor reset preserves configuration and requires delivered Hello recovery. */
export function resetEigrpNeighbors(engine:ControlPlaneHost,deviceId:string,protocol='eigrp',selector?:string):number {
  const c=helloContext(engine);let count=0;for(const[key,peer]of c.peers){const edge=peer.edge;if(edge.from.device.id!==deviceId||!key.includes('|'+protocol+'|')||selector&&selector!==edge.to.ip&&selector!==edge.from.name)continue;engine.clock.cancel(peer.expiry);c.peers.delete(key);count++;}
  const dual=dualContext(engine);for(const[key,entry]of dual.entries)if(entry.deviceId===deviceId&&entry.protocol===protocol){engine.clock.cancel(entry.timer);dual.entries.delete(key);}
  for(const[key,p]of dual.inflight)if(p.edge.from.device.id===deviceId&&p.body.family===protocol){engine.clock.cancel(p.timer);dual.inflight.delete(key);}
  const d=engine.getDevice(deviceId);if(d)event(engine,d,protocol.toUpperCase(),'Neighbors cleared',`${count} neighbor(s) removed by administrative request.`);engine.recompute();engine.notify();return count;
}
