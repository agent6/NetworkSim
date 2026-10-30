import {resetIOSOSPFRouterId} from './ospf-router-id.ts';
import {routingConfig} from './routing-scope.ts';
import {prefixContains,sameAddress,isIPv6} from './ip.ts';
import type { Device, NewSimEvent } from './model.ts';
import type { SimulationClock, TimerHandle } from './clock.ts';

export type OSPFProtocol = 'ospf' | 'ospfv3' | 'ospfv3ipv4';
export type OSPFNeighborState = 'DOWN' | 'INIT' | '2WAY' | 'EXSTART' | 'EXCHANGE' | 'LOADING' | 'FULL';
export interface OSPFEndpoint {
  deviceId: string; name: string; node: string; address: string; transportAddress?: string; prefix: number; family: 4 | 6;
  routerId: string; area: string; vrf?: string; snapshot?: { deviceConfig: any; interfaceConfig: any };
}
export interface OSPFInterface extends OSPFEndpoint { networkType?:string; helloInterval?: number; deadInterval?: number; passive?: boolean; mtu?: number; mtuIgnore?: boolean; instanceId?: number; role?: 'DR' | 'BDR' | 'DROTHER' | 'POINT-TO-POINT'; authentication?: { mode: string | boolean; send?: { id: string; keyString: string; algorithm?:string }; accept: { id: string; keyString: string; algorithm?:string }[] } }
export interface OSPFAdjacency { from: OSPFEndpoint; to: OSPFEndpoint; area: string; cost: number; bandwidth: number; delay: number; fullDesired?: boolean }
export interface OSPFOrigin { endpoint: OSPFEndpoint; kind: 'prefix' | 'external' | 'default'; network: string; prefix: number; cost?: number; route?: Record<string, any> }
export interface OSPFLink extends OSPFAdjacency { sequence?: number; age?: number }
export interface OSPFPrefix extends OSPFOrigin { sequence?: number; age?: number }
export interface OSPFSnapshot { protocol: OSPFProtocol; interfaces: OSPFInterface[]; candidates: OSPFAdjacency[]; origins: OSPFOrigin[]; refreshInterval?: number; maxAge?: number; invalidated?: { fromDeviceId: string; fromPort: string; toDeviceId: string; toPort: string; reason: string }[] }
export interface OSPFHost {
  clock: SimulationClock; getDevice(id: string): Device | undefined; interfaceUp(id: string, port: string): boolean;
  log?(deviceId:string,message:string,severity?:number):unknown;
  emit(event: NewSimEvent): unknown; recompute(): void; notify(): void;
  sendControlDatagram?(deviceId: string, source: string, destination: string, port: number, body: any, options?: { interface?: string; vrf?: string; ttl?: number; protocol?: string }): void;
}

interface LSA { origin: string; routerId: string; sequence: number; originatedAt: number; maxAge: number; links: OSPFLink[]; prefixes: OSPFPrefix[] }
interface Neighbor { key: string; local: OSPFInterface; peer: OSPFEndpoint; candidate: OSPFAdjacency; state: OSPFNeighborState; upSince?: number; lastHello: number; dead?: TimerHandle; exchange?: TimerHandle; exchangeId: string; peerExchangeId?: string; dbdReceived: boolean; initialReceived: boolean; initialAcknowledged: boolean; attempts: number; pending: Map<string, { lsa: LSA; attempt: number; timer?: TimerHandle }> }
interface NodeState { key: string; deviceId: string; protocol: OSPFProtocol; vrf?: string; runtime: Device['runtime']; interfaces: OSPFInterface[]; origins: OSPFOrigin[]; neighbors: Map<string, Neighbor>; database: Map<string, LSA>; floors: Map<string, number>; timers: TimerHandle[]; helloTimers: Map<string, TimerHandle>; sequence: number; signature: string; refresh?: TimerHandle; refreshInterval: number; maxAge: number; serial: number; spfTimer?:TimerHandle; spfDatabase?:Map<string,LSA>; lastSpf?:number; spfHold?:number; originTimer?:TimerHandle; lastOrigin?:number; originHold?:number; arrivals?:Map<string,number>; helloSent?:Map<string,number>; started?:number; spfRuns?:number }
interface Context { nodes: Map<string, NodeState>; candidates: Map<OSPFProtocol, OSPFAdjacency[]>; invalidated: Map<OSPFProtocol, NonNullable<OSPFSnapshot['invalidated']>>; fragments: Map<string, { parts: Map<number,string>; total: number; runtime: Device['runtime']; timer: TimerHandle }> }
const contexts = new WeakMap<object, Context>();
const copy = <T>(value: T): T => structuredClone(value);
const context = (engine: OSPFHost): Context => { let c = contexts.get(engine); if (!c) { c = { nodes: new Map(), candidates: new Map(), invalidated: new Map(), fragments: new Map() }; contexts.set(engine, c); } return c; };
const nodeKey = (protocol: OSPFProtocol, node: string): string => protocol + '|' + node;
const peerKey = (local: OSPFEndpoint, peer: OSPFEndpoint): string => local.name + '|' + peer.node + '|' + peer.name;
const endpointId = (endpoint: OSPFEndpoint): string => endpoint.node + '|' + endpoint.name;
const interval = (value: number | undefined, fallback: number): number => Math.max(0.05, Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback) * 1000;
const active = (engine: OSPFHost, node: NodeState): boolean => { const d = engine.getDevice(node.deviceId); return !!d?.powered && d.runtime === node.runtime && context(engine).nodes.get(node.key) === node; };
const authenticated = (local: OSPFInterface, remote: OSPFInterface): boolean => { const a = local.authentication, b = remote.authentication, mode = (v: OSPFInterface['authentication']) => !v?.mode || v.mode === 'none' ? 'none' : String(v.mode); return mode(a) === 'none' && mode(b) === 'none' || mode(a) === mode(b) && !!b?.send && !!a?.accept.some(key => key.id === b.send!.id && key.keyString === b.send!.keyString && (key.algorithm??'md5') === (b.send!.algorithm??'md5')); };
const wantsFull = (local: OSPFInterface, remote: OSPFInterface, fallback?: boolean): boolean => local.role && remote.role ? [local.role,remote.role].some(role => role === 'DR' || role === 'BDR' || role === 'POINT-TO-POINT') : fallback !== false;
const compatible = (a: OSPFInterface, b: OSPFInterface): boolean => a.area === b.area && (a.instanceId ?? 0) === (b.instanceId ?? 0) && interval(a.helloInterval, 10) === interval(b.helloInterval, 10) && interval(a.deadInterval, 40) === interval(b.deadInterval, 40);
function update(engine: OSPFHost, node: NodeState): void {
  publish(engine,node);if(node.spfTimer&&!node.spfTimer.canceled&&node.spfTimer.at>=engine.clock.now())return;
  const cfg=routingConfig(engine.getDevice(node.deviceId)!,node.protocol,node.vrf),timers=cfg?.throttle?.spf;
  const quiet=node.lastSpf===undefined||engine.clock.now()-node.lastSpf>Number(timers?.[2]??0),delay=timers?(quiet?Number(timers[0]):Number(node.spfHold??timers[1])):0;
  node.spfTimer=engine.clock.schedule(Math.max(0,delay),()=>{node.spfTimer=undefined;if(!active(engine,node))return;node.spfDatabase=new Map([...node.database].map(([key,lsa])=>[key,copy(lsa)]));node.lastSpf=engine.clock.now();node.spfRuns=(node.spfRuns??0)+1;node.spfHold=timers?Math.min(Number(timers[2]),quiet?Number(timers[1]):Math.max(Number(timers[1]),Number(node.spfHold??timers[1])*2)):undefined;engine.recompute();engine.notify();},{owner:node.deviceId,label:'OSPF database/SPF change'});
}
function publish(engine: OSPFHost, node: NodeState): void {
  const d = engine.getDevice(node.deviceId); if (!d || d.runtime !== node.runtime) return;
  const view = d.runtime.features.ospfPackets ??= {};
  view[node.protocol + (node.vrf ? ':' + node.vrf : '')] = { neighbors: [...node.neighbors.values()].map(n => ({ interface: n.local.name, address: n.peer.address, routerId: n.peer.routerId, deviceId: n.peer.deviceId, state: n.state, upSince: n.upSince, lastHello: n.lastHello, deadAt: n.lastHello + interval(n.local.deadInterval, 40), retransmissions: n.attempts, pendingLSAs: n.pending.size })), lsdb: [...node.database.values()].map(l => ({ origin: l.origin, routerId: l.routerId, sequence: l.sequence, age: (engine.clock.now() - l.originatedAt) / 1000, maxAge: l.maxAge / 1000, links: l.links.length, prefixes: l.prefixes.length })) };
}
const ospfWireLength = (type: string, data: any): number => { const count = (v: any) => Array.isArray(v) ? v.length : 0; return type === 'hello' ? 44 + 4 * count(data?.seen) : type === 'database-description' ? 32 + 20 * count(data?.summaries) : type === 'request' ? 24 + 12 * count(data?.origins) : type === 'update' ? 28 + 36 * count(data?.lsas) : type === 'ack' ? 24 + 20 * count(data?.acknowledged) : 24; };
function countInterfaceTraffic(stats: any, direction: 'sent' | 'received', name: string, type: string, bytes: number): void { const counter = (((stats.interfaces ??= {})[name] ??= { sent: {}, received: {} })[direction][type] ??= { packets: 0, bytes: 0 }); counter.packets++; counter.bytes += bytes; }
function send(engine: OSPFHost, node: NodeState, local: OSPFInterface, type: string, data: any = {}, peer?: OSPFEndpoint): void {
  if (!active(engine, node) || !engine.interfaceUp(node.deviceId, local.name) || local.passive) return;
  const d=engine.getDevice(node.deviceId)!,stats=d.runtime.features[`${node.protocol}Traffic`]??={};stats.sent??={};stats.sent[type]=(stats.sent[type]??0)+1;countInterfaceTraffic(stats,'sent',local.name,type,ospfWireLength(type,data)+20);
  const payload = { protocol: 'ospf-packets', version: node.protocol, type, endpoint: type === 'hello' ? copy(local) : { ...copy(local), snapshot: undefined }, ...copy(data) }, text = JSON.stringify(payload), transmit = (body: any) => engine.sendControlDatagram?.(node.deviceId, local.transportAddress ?? local.address, (peer?.transportAddress ?? peer?.address) ?? (local.transportAddress || local.family === 6 ? 'ff02::5' : '224.0.0.5'), 89, body, { interface: local.name, vrf: local.vrf, ttl: routingConfig(d,node.protocol,node.vrf)?.ttlSecurity?255:1, protocol: node.protocol });
  if (new TextEncoder().encode(text).length <= 900) { transmit(payload); return; }
  const chunks: string[] = []; let chunk = '', bytes = 0; for (const character of text) { const length = new TextEncoder().encode(character).length; if (bytes + length > 400) { chunks.push(chunk); chunk = ''; bytes = 0; } chunk += character; bytes += length; } if (chunk) chunks.push(chunk);
  const messageId = node.key + ':' + (++node.serial); for (let index = 0; index < chunks.length; index++) transmit({ protocol: 'ospf-packets', version: node.protocol, type: 'fragment', messageId, index, total: chunks.length, data: chunks[index], from: { node: local.node, name: local.name } });
}
export function configuredOSPFNeighbors(engine:OSPFHost,deviceId:string,protocol:OSPFProtocol,vrf:string|undefined,port:string):any[]{const d=engine.getDevice(deviceId);if(!d)return[];return [...(routingConfig(d,protocol,vrf)?.neighbors??[]).filter((n:any)=>!n.interface||n.interface===port),...(d.config.interfaces[port]?.features[protocol]?.neighbors??[])];}
function hello(engine: OSPFHost, node: NodeState, local: OSPFInterface): void {
  const body={seen:[...node.neighbors.values()].filter(n=>n.local.name===local.name&&n.lastHello+interval(local.deadInterval,40)>engine.clock.now()).map(n=>endpointId(n.peer))};
  if(!local.networkType?.includes('non-broadcast')){send(engine,node,local,'hello',body);return;}
  const configured=configuredOSPFNeighbors(engine,node.deviceId,node.protocol,node.vrf,local.name),received=[...node.neighbors.values()].filter(n=>local.networkType==='non-broadcast'&&n.local.name===local.name&&n.state!=='DOWN').map(n=>({address:n.peer.transportAddress??n.peer.address}));for(const cfg of [...configured,...received].filter((row,i,all)=>all.findIndex(r=>sameAddress(r.address,row.address))===i)){if(!isIPv6(cfg.address)&&!prefixContains(local.address,local.prefix,cfg.address))continue;const peer=[...node.neighbors.values()].find(n=>n.local.name===local.name&&sameAddress(n.peer.transportAddress??n.peer.address,cfg.address)),period=local.networkType?.startsWith('point-to-multipoint')||peer&&peer.state!=='DOWN'?interval(local.helloInterval,30):interval(cfg.pollInterval,120),key=local.name+'|'+cfg.address;node.helloSent??=new Map();if(engine.clock.now()-(node.helloSent.get(key)??-Infinity)<period)continue;node.helloSent.set(key,engine.clock.now());send(engine,node,local,'hello',body,{...local,address:cfg.address,transportAddress:undefined});}

}
function setState(engine: OSPFHost, node: NodeState, peer: Neighbor, state: OSPFNeighborState, reason: string): void {
  if (peer.state === state) return; const old = peer.state; peer.state = state; peer.upSince=state==='FULL'?engine.clock.now():undefined;
  const cfg=routingConfig(engine.getDevice(node.deviceId)!,node.protocol,node.vrf),events=node.runtime.features[`${node.protocol}Events`]??=[],eventCfg=cfg?.eventLog??{},limit=Number(eventCfg.size??1000);if(eventCfg.on!==false&&!eventCfg.pause&&(!eventCfg.oneShot||events.length<limit)){events.push({time:engine.clock.now(),interface:peer.local.name,routerId:peer.peer.routerId,from:old,to:state,reason});events.splice(0,Math.max(0,events.length-limit));}if(cfg?.logAdjacencyChanges!==false&&(cfg?.logAdjacencyChanges==='detail'||state==='FULL'||state==='DOWN'))engine.log?.(node.deviceId,`%OSPF-5-ADJCHG: Process ${cfg?.processId??1}, Nbr ${peer.peer.routerId} on ${peer.local.name} from ${old} to ${state}, ${reason}`,5);
  engine.emit({ nodeId: node.deviceId, peerId: peer.peer.deviceId, port: peer.local.name, protocol: node.protocol.toUpperCase(), label: 'OSPF neighbor ' + state, detail: peer.peer.routerId + ': ' + old + ' → ' + state + '. ' + reason, disposition: state === 'DOWN' ? 'warning' : state === 'FULL' ? 'success' : 'info' });
  originate(engine, node); update(engine, node);
}
function clearExchange(engine: OSPFHost, n: Neighbor): void { engine.clock.cancel(n.exchange); for (const pending of n.pending.values()) engine.clock.cancel(pending.timer); n.pending.clear(); n.dbdReceived = false; n.initialReceived = false; n.initialAcknowledged = false; }
function down(engine: OSPFHost, node: NodeState, n: Neighbor, reason: string): void { clearExchange(engine, n); n.lastHello = -Infinity; engine.clock.cancel(n.dead); setState(engine, node, n, 'DOWN', reason); }
function lsaToken(lsa: LSA): string { return lsa.origin + '@' + lsa.sequence; }
function liveLSAs(engine: OSPFHost, node: NodeState): LSA[] { return [...node.database.values()].filter(lsa => engine.clock.now() - lsa.originatedAt < lsa.maxAge); }
function sendUpdate(engine: OSPFHost, node: NodeState, n: Neighbor, lsas: LSA[], exchangeId?: string): void {
  send(engine, node, n.local, 'update', { lsas, exchangeId }, n.peer);
  for (const lsa of lsas) {
    const key = lsaToken(lsa); if (n.pending.has(key)) continue;
    const pending = { lsa: copy(lsa), attempt: 0, timer: undefined as TimerHandle | undefined }; n.pending.set(key, pending);
    const retry = () => { if (!active(engine, node) || n.pending.get(key) !== pending || n.state === 'DOWN') return; if (++pending.attempt > 6) { down(engine, node, n, 'Link-state acknowledgement retry limit exceeded'); return; } n.attempts++; send(engine, node, n.local, 'update', { lsas: [pending.lsa] }, n.peer); pending.timer = engine.clock.schedule(1000, retry, { owner: node.deviceId, label: 'OSPF LSU retransmission' }); publish(engine, node); };
    pending.timer = engine.clock.schedule(1000, retry, { owner: node.deviceId, label: 'OSPF LSU acknowledgement' });
  }
}
function flood(engine: OSPFHost, node: NodeState, lsa: LSA, except?: Neighbor): void { for (const n of node.neighbors.values()) if (n !== except && ['EXCHANGE', 'LOADING', 'FULL'].includes(n.state)) sendUpdate(engine, node, n, [lsa]); }
function expire(engine: OSPFHost, node: NodeState, lsa: LSA): void {
  const delay = Math.max(0, lsa.originatedAt + lsa.maxAge - engine.clock.now()); const timer = engine.clock.schedule(delay, () => {
    if (!active(engine, node) || node.database.get(lsa.origin) !== lsa) return;
    node.database.delete(lsa.origin); node.floors.set(lsa.origin, lsa.sequence); flood(engine, node, lsa); update(engine, node);
  }, { owner: node.deviceId, label: 'OSPF LSA MaxAge' }); node.timers.push(timer); if (node.timers.length > 1000) node.timers = node.timers.filter(t => !t.canceled && t.at >= engine.clock.now());
}
function originate(engine: OSPFHost, node: NodeState, refresh = false,scheduled=false): void {
  if (!active(engine, node) || !node.interfaces.length) return;
  const links: OSPFLink[] = [...node.neighbors.values()].filter(n => n.state === 'FULL' || (n.state === '2WAY' && n.candidate.fullDesired === false && [...node.neighbors.values()].some(other => other.local.name === n.local.name && other.state === 'FULL'))).map(n => ({ ...copy(n.candidate), from: copy(n.local), to: copy(n.peer) }));
  const signature = JSON.stringify({ links, prefixes: node.origins }); if (!refresh && signature === node.signature) return;
  const timers=routingConfig(engine.getDevice(node.deviceId)!,node.protocol,node.vrf)?.throttle?.lsa;
  if(timers&&!scheduled){if(!node.originTimer||node.originTimer.canceled){const quiet=node.lastOrigin===undefined||engine.clock.now()-node.lastOrigin>Number(timers[2]),delay=quiet?Number(timers[0]):Math.max(0,Number(node.originHold??timers[1])-(engine.clock.now()-node.lastOrigin!));node.originTimer=engine.clock.schedule(delay,()=>{node.originTimer=undefined;originate(engine,node,refresh,true);},{owner:node.deviceId,label:'OSPF LSA generation throttle'});node.originHold=Math.min(Number(timers[2]),quiet?Number(timers[1]):Math.max(Number(timers[1]),Number(node.originHold??timers[1])*2));}return;}
  node.signature = signature;node.lastOrigin=engine.clock.now();
  const lsa: LSA = { origin: node.interfaces[0].node, routerId: node.interfaces[0].routerId, sequence: ++node.sequence, originatedAt: engine.clock.now(), maxAge: node.maxAge, links, prefixes: copy(node.origins) };
  node.database.set(lsa.origin, lsa); expire(engine, node, lsa); flood(engine, node, lsa); publish(engine, node);if(routingConfig(engine.getDevice(node.deviceId)!,node.protocol,node.vrf)?.throttle?.spf)update(engine,node);
  engine.clock.cancel(node.refresh); node.refresh = engine.clock.schedule(node.refreshInterval, () => { if (active(engine, node)) { originate(engine, node, true); update(engine, node); } }, { owner: node.deviceId, label: 'OSPF LSA refresh' });
}
function complete(engine: OSPFHost, node: NodeState, n: Neighbor): void { if (n.dbdReceived && n.initialReceived && n.initialAcknowledged && n.state !== 'FULL') { engine.clock.cancel(n.exchange); setState(engine, node, n, 'FULL', 'Database exchange and acknowledgement completed'); } }
function startExchange(engine: OSPFHost, node: NodeState, n: Neighbor): void {
  if (!n.local.mtuIgnore && ((n.peer as OSPFInterface).mtu ?? 1500) > (n.local.mtu ?? 1500)) { clearExchange(engine, n); setState(engine, node, n, 'EXSTART', 'Peer database-description MTU exceeds local interface MTU'); return; }
  if (['EXCHANGE', 'LOADING', 'FULL'].includes(n.state)) return; setState(engine, node, n, 'EXSTART', 'Two-way Hello communication verified');
  clearExchange(engine, n); n.exchangeId = node.key + ':' + (++node.serial);
  // Valid Hellos keep the neighbor alive even when DBD exchange cannot finish.
  // The dead timer, interface teardown or a completed exchange stops retries.
  const exchange = () => { if (!active(engine, node) || n.state === 'DOWN' || n.state === 'FULL') return; send(engine, node, n.local, 'database-description', { exchangeId: n.exchangeId, summaries: liveLSAs(engine, node).map(l => ({ origin: l.origin, sequence: l.sequence })) }, n.peer); n.exchange = engine.clock.schedule(5000, exchange, { owner: node.deviceId, label: 'OSPF database-description retry' }); };
  setState(engine, node, n, 'EXCHANGE', 'MTU compatibility confirmed'); exchange();
}
function dispose(engine: OSPFHost, node: NodeState): void { engine.clock.cancel(node.spfTimer);engine.clock.cancel(node.originTimer); for (const timer of [...node.timers, ...node.helloTimers.values()]) engine.clock.cancel(timer); engine.clock.cancel(node.refresh); for (const n of node.neighbors.values()) { engine.clock.cancel(n.dead); clearExchange(engine, n); } }

/** Restart only this process's learned state; preserve the origin sequence so peers accept the new self record. */
export function resetOSPF(engine:OSPFHost,deviceId:string,protocol:OSPFProtocol='ospf'):void {
 const d=engine.getDevice(deviceId);if(d&&protocol==='ospf')resetIOSOSPFRouterId(d);
 const c=context(engine);for(const node of c.nodes.values())if(node.deviceId===deviceId&&node.protocol===protocol){dispose(engine,node);node.neighbors.clear();node.database.clear();node.floors.clear();node.helloTimers.clear();node.timers=[];node.signature='';node.refresh=undefined;node.serial++;node.spfTimer=undefined;node.spfDatabase=undefined;node.originTimer=undefined;node.arrivals=undefined;node.helloSent=undefined;node.started=engine.clock.now();delete node.runtime.features.ospfPackets?.[protocol+(node.vrf?':'+node.vrf:'')];}
 for(const[key,assembly]of c.fragments)if(key.startsWith(deviceId+'|')){engine.clock.cancel(assembly.timer);c.fragments.delete(key);}
 engine.emit({nodeId:deviceId,protocol:protocol.toUpperCase(),label:'OSPF process cleared',detail:'Neighbor and learned database state removed; local sequence retained for re-exchange.',disposition:'info'});engine.recompute();engine.notify();
}

/** Synchronizes only each router's local configuration. Remote state enters its LSDB solely through delivered updates. */
export function syncOSPF(engine: OSPFHost, snapshot: OSPFSnapshot): void {
  const c = context(engine); c.candidates.set(snapshot.protocol, copy(snapshot.candidates)); c.invalidated.set(snapshot.protocol, copy(snapshot.invalidated ?? [])); const groups = new Map<string, OSPFInterface[]>();
  for (const iface of snapshot.interfaces) { const d = engine.getDevice(iface.deviceId); if (!d?.powered || !engine.interfaceUp(iface.deviceId, iface.name)) continue; const key = nodeKey(snapshot.protocol, iface.node); const list = groups.get(key) ?? []; list.push(copy(iface)); groups.set(key, list); }
  for (const [key, node] of c.nodes) if (node.protocol === snapshot.protocol && (!groups.has(key) || !active(engine, node))) { dispose(engine, node); c.nodes.delete(key); }
  for (const [key, interfaces] of groups) {
    let node = c.nodes.get(key); if (!node) { node = { key, deviceId: interfaces[0].deviceId, protocol: snapshot.protocol, vrf: interfaces[0].vrf, runtime: engine.getDevice(interfaces[0].deviceId)!.runtime, interfaces: [], origins: [], neighbors: new Map(), database: new Map(), floors: new Map(), timers: [], helloTimers: new Map(), sequence: 0, signature: '', refreshInterval: interval(snapshot.refreshInterval, 1800), maxAge: interval(snapshot.maxAge, 3600), serial: 0, started: engine.clock.now() }; c.nodes.set(key, node); }
    node.interfaces = interfaces; node.origins = copy(snapshot.origins.filter(o => nodeKey(snapshot.protocol, o.endpoint.node) === key)); node.refreshInterval = interval(snapshot.refreshInterval, 1800); node.maxAge = interval(snapshot.maxAge, 3600);
    for (const n of node.neighbors.values()) { const local = interfaces.find(i => i.name === n.local.name), candidate = snapshot.candidates.find(a => endpointId(a.from) === endpointId(n.local) && endpointId(a.to) === endpointId(n.peer)); if (!local || local.passive || !compatible(local, n.local) || local.routerId !== n.local.routerId || JSON.stringify(local.authentication) !== JSON.stringify(n.local.authentication)) { down(engine, node, n, 'Local interface or protocol configuration changed'); node.neighbors.delete(n.key); } else { n.local = local; if (candidate) n.candidate = copy(candidate); n.candidate.fullDesired = wantsFull(local,n.peer as OSPFInterface,n.candidate.fullDesired); const blocked = snapshot.invalidated?.find(i => i.fromDeviceId === node.deviceId && i.fromPort === local.name && i.toDeviceId === n.peer.deviceId && i.toPort === n.peer.name); if (blocked) { down(engine,node,n,blocked.reason); continue; } if (n.candidate.fullDesired === false && !['DOWN','INIT','2WAY'].includes(n.state)) { clearExchange(engine, n); setState(engine, node, n, '2WAY', 'DROTHER transit relationship'); } else if (n.candidate.fullDesired !== false && !['DOWN','INIT'].includes(n.state)) startExchange(engine, node, n); } }
    for (const [name, timer] of node.helloTimers) if (!interfaces.some(i => i.name === name && !i.passive)) { engine.clock.cancel(timer); node.helloTimers.delete(name); }
    for (const iface of interfaces) if (!iface.passive) { const old = node.helloTimers.get(iface.name), milliseconds = iface.networkType==='non-broadcast'?Math.min(interval(iface.helloInterval,30),...configuredOSPFNeighbors(engine,node.deviceId,node.protocol,node.vrf,iface.name).map((n:any)=>interval(n.pollInterval,120))):interval(iface.helloInterval,10); if (!old || old.repeat !== milliseconds) { engine.clock.cancel(old); const current = node; node.helloTimers.set(iface.name, engine.clock.schedule(0, () => { const latest = current.interfaces.find(i => i.name === iface.name); if (active(engine, current) && latest) hello(engine, current, latest); }, { owner: node.deviceId, repeat: milliseconds, label: 'OSPF Hello' })); } }
    originate(engine, node); publish(engine, node);
  }
}
export function verifiedOSPFAdjacency(engine: OSPFHost, protocol: OSPFProtocol, fromDeviceId: string, fromPort: string, toDeviceId: string, toPort: string): OSPFNeighborState { for (const node of context(engine).nodes.values()) if (node.protocol === protocol && node.deviceId === fromDeviceId && active(engine, node)) { const n = [...node.neighbors.values()].find(n => n.local.name === fromPort && n.peer.deviceId === toDeviceId && n.peer.name === toPort); if (n) return n.state; } return 'DOWN'; }
export function ospfDatabaseView(engine: OSPFHost, deviceId: string, protocol: OSPFProtocol, vrf?: string): { links: OSPFLink[]; prefixes: OSPFPrefix[] } {
  const links: OSPFLink[] = [], prefixes: OSPFPrefix[] = []; for (const node of context(engine).nodes.values()) if (node.deviceId === deviceId && node.protocol === protocol && (node.vrf ?? '') === (vrf ?? '') && active(engine, node)) for (const lsa of (routingConfig(engine.getDevice(deviceId)!,protocol,node.vrf)?.throttle?.spf?[...(node.spfDatabase?.values()??[])].filter(l=>engine.clock.now()-l.originatedAt<l.maxAge):liveLSAs(engine,node))) { const metadata = { sequence: lsa.sequence, age: (engine.clock.now() - lsa.originatedAt) / 1000 }; links.push(...lsa.links.map(link => ({ ...copy(link), ...metadata }))); prefixes.push(...lsa.prefixes.map(prefix => ({ ...copy(prefix), ...metadata }))); } return { links, prefixes };
}
export function ospfLiveDetail(engine: OSPFHost, deviceId: string, protocol: OSPFProtocol, vrf?: string): { started?: number; lastSpf?: number; spfRuns: number; interfaces: OSPFInterface[]; helloDue: Record<string, number>; neighbors: { interface: string; routerId: string; deviceId: string; address: string; priority: number; peerInterface: string; peerRole?: string; state: OSPFNeighborState; upSince?: number; lastHello: number; deadAt: number; attempts: number; pending: number }[]; lsas: { origin: string; routerId: string; sequence: number; age: number; links: OSPFLink[]; prefixes: OSPFPrefix[] }[] } | undefined {
  const now = engine.clock.now();
  for (const node of context(engine).nodes.values()) if (node.deviceId === deviceId && node.protocol === protocol && (node.vrf ?? '') === (vrf ?? '') && active(engine, node)) {
    const helloDue: Record<string, number> = {}; for (const [name, timer] of node.helloTimers) if (!timer.canceled) helloDue[name] = Math.max(0, timer.at - now);
    const lsas = routingConfig(engine.getDevice(deviceId)!, protocol, node.vrf)?.throttle?.spf ? [...(node.spfDatabase?.values() ?? [])].filter(l => now - l.originatedAt < l.maxAge) : liveLSAs(engine, node);
    return { started: node.started, lastSpf: node.lastSpf, spfRuns: node.spfRuns ?? 0, interfaces: node.interfaces, helloDue, neighbors: [...node.neighbors.values()].map(n => ({ interface: n.local.name, routerId: n.peer.routerId, deviceId: n.peer.deviceId, address: n.peer.address, priority: Number(n.peer.snapshot?.interfaceConfig?.features?.[protocol]?.priority ?? 1), peerInterface: n.peer.name, peerRole: (n.peer as OSPFInterface).role, state: n.state, upSince: n.upSince, lastHello: n.lastHello, deadAt: n.lastHello + interval(n.local.deadInterval, 40), attempts: n.attempts, pending: n.pending.size })), lsas: lsas.map(l => ({ origin: l.origin, routerId: l.routerId, sequence: l.sequence, age: Math.max(0, Math.floor((now - l.originatedAt) / 1000)), links: l.links, prefixes: l.prefixes })) };
  }
  return undefined;
}
function rejectedHello(engine:OSPFHost,node:NodeState,local:OSPFInterface,remote:OSPFInterface,source:string):void{
 const reason=local.area!==remote.area?`mismatched area ID, from area ${remote.area}, expected ${local.area}`:!authenticated(local,remote)?'authentication mismatch':remote.routerId===local.routerId?'duplicate router ID':'mismatched Hello/dead timers or instance ID';
 engine.emit({nodeId:node.deviceId,port:local.name,protocol:node.protocol.toUpperCase(),label:'Hello rejected',detail:`Rcv pkt from ${source}: ${reason}`,disposition:'warning'});
}
export function receiveOSPFControl(engine: OSPFHost, deviceId: string, source: string, _destination: string, payload: any, ttl: number, input?: string): boolean {
  if (payload?.protocol !== 'ospf-packets') return false;
  if (payload.type === 'fragment') {
    if (ttl < 1 || ttl > 255 || !['ospf', 'ospfv3', 'ospfv3ipv4'].includes(payload.version) || typeof payload.messageId !== 'string' || typeof payload.data !== 'string' || !Number.isInteger(payload.total) || payload.total < 1 || payload.total > 4096 || !Number.isInteger(payload.index) || payload.index < 0 || payload.index >= payload.total || new TextEncoder().encode(payload.data).length > 400) return true;
    const c = context(engine), d = engine.getDevice(deviceId), allowed = c.candidates.get(payload.version)?.some(a => a.from.deviceId === deviceId && (!input || a.from.name === input) && (a.to.transportAddress ?? a.to.address) === source && a.to.node === payload.from?.node && a.to.name === payload.from?.name) || [...c.nodes.values()].some(node => node.deviceId === deviceId && node.protocol === payload.version && active(engine,node) && [...node.neighbors.values()].some(n => (!input || n.local.name === input) && (n.peer.transportAddress ?? n.peer.address) === source && n.peer.node === payload.from?.node && n.peer.name === payload.from?.name)); const remoteNode=c.nodes.get(nodeKey(payload.version,payload.from?.node)),knownSource=remoteNode&&active(engine,remoteNode)&&remoteNode.interfaces.some(i=>i.name===payload.from?.name&&(i.transportAddress??i.address)===source),localReceiver=[...c.nodes.values()].some(n=>n.deviceId===deviceId&&n.protocol===payload.version&&active(engine,n)&&n.interfaces.some(i=>i.name===input&&!i.passive));if (!d?.powered || !allowed&&!(knownSource&&localReceiver)) return true;
    const key = [deviceId, input, source, payload.messageId].join('|'); let assembly = c.fragments.get(key); if (!assembly || assembly.runtime !== d.runtime) { if (c.fragments.size >= 128) return true; assembly = { parts: new Map(), total: payload.total, runtime: d.runtime, timer: engine.clock.schedule(10000, () => c.fragments.delete(key), { owner: deviceId, label: 'OSPF logical update reassembly' }) }; c.fragments.set(key, assembly); }
    if (assembly.total !== payload.total) return true; assembly.parts.set(payload.index, payload.data); if (assembly.parts.size === assembly.total) { c.fragments.delete(key); engine.clock.cancel(assembly.timer); try { const message = JSON.parse(Array.from({length: assembly.total}, (_, i) => assembly!.parts.get(i)).join('')); if (message.type !== 'fragment') return receiveOSPFControl(engine, deviceId, source, _destination, message, ttl, input); } catch { /* Invalid logical OSPF records are discarded. */ } } return true;
  }
  if (ttl < 1 || ttl > 255 || !['ospf','ospfv3','ospfv3ipv4'].includes(payload.version) || !payload.endpoint || !['hello','database-description','request','update','ack'].includes(payload.type)) return true;
  const c = context(engine), protocol = payload.version as OSPFProtocol, remote = payload.endpoint as OSPFInterface;
  let candidate = c.candidates.get(protocol)?.find(a => a.from.deviceId === deviceId && (!input || a.from.name === input) && a.to.deviceId === remote.deviceId && a.to.name === remote.name && a.to.node === remote.node && (a.to.transportAddress ?? a.to.address) === source);
  if (!candidate) for (const node of c.nodes.values()) if (node.deviceId === deviceId && node.protocol === protocol && active(engine,node)) { const known = [...node.neighbors.values()].find(n => (!input || n.local.name === input) && (n.peer.transportAddress ?? n.peer.address) === source && n.peer.node === remote.node && n.peer.name === remote.name); if (known) { candidate = known.candidate; break; } }
  if (!candidate) {if(payload.type==='hello')for(const node of c.nodes.values())if(node.deviceId===deviceId&&node.protocol===protocol&&active(engine,node)){const local=node.interfaces.find(i=>i.name===input&&!i.passive);if(local&&(!compatible(local,remote)||!authenticated(local,remote)||remote.routerId===local.routerId))rejectedHello(engine,node,local,remote,source);}return true;} const node = c.nodes.get(nodeKey(protocol, candidate.from.node)); if (!node || !active(engine, node)) return true;
  const hops=routingConfig(engine.getDevice(deviceId)!,protocol,node.vrf)?.ttlSecurity?.hops;if(hops!==undefined&&ttl<256-Number(hops))return true;
  const local = node.interfaces.find(i => i.name === candidate!.from.name); if (!local || local.passive || (remote.transportAddress ?? remote.address) !== source) return true;
  const stats=node.runtime.features[`${protocol}Traffic`]??={};stats.received??={};stats.received[payload.type]=(stats.received[payload.type]??0)+1;countInterfaceTraffic(stats,'received',local.name,payload.type,ospfWireLength(payload.type,payload));
  const key = peerKey(local, remote); let n = node.neighbors.get(key);
  if (c.invalidated.get(protocol)?.some(i => i.fromDeviceId === deviceId && i.fromPort === local.name && i.toDeviceId === remote.deviceId && i.toPort === remote.name)) return true;
  if (!compatible(local,remote) || !authenticated(local,remote) || remote.routerId === local.routerId) { if(payload.type==='hello')rejectedHello(engine,node,local,remote,source);if (n && payload.type === 'hello') down(engine,node,n,'Delivered Hello has incompatible area, timers, instance, authentication or router ID'); return true; }
  if (payload.type === 'hello') {
    if (!Array.isArray(payload.seen)) return true; const fresh = !n || n.state === 'DOWN';
    if (!n) { n = { key, local, peer: copy(remote), candidate: copy(candidate), state: 'DOWN', lastHello: -Infinity, exchangeId: '', dbdReceived: false, initialReceived: false, initialAcknowledged: false, attempts: 0, pending: new Map() }; node.neighbors.set(key, n); }
    const oldPeer = JSON.stringify(n.peer); n.peer = copy(remote); n.candidate.fullDesired = wantsFull(local,remote,candidate.fullDesired); n.lastHello = engine.clock.now(); engine.clock.cancel(n.dead); const neighbor = n; n.dead = engine.clock.schedule(interval(local.deadInterval, 40), () => { if (active(engine, node) && node.neighbors.get(key) === neighbor) down(engine, node, neighbor, 'No Hello received within the dead interval'); }, { owner: deviceId, label: 'OSPF neighbor dead timer' });
    const twoWay = payload.seen.includes(endpointId(local)); if (!twoWay) { if (!['DOWN','INIT'].includes(n.state)) clearExchange(engine, n); setState(engine, node, n, 'INIT', 'Hello received; peer has not reported hearing this router'); } else if (n.candidate.fullDesired === false) { if (n.state !== '2WAY') clearExchange(engine,n); setState(engine, node, n, '2WAY', 'Broadcast DROTHER neighbor'); } else startExchange(engine, node, n);
    if (fresh) hello(engine, node, local); if (oldPeer !== JSON.stringify(n.peer)) { originate(engine, node); update(engine, node); } publish(engine, node); return true;
  }
  if (!n || ['DOWN','INIT','2WAY'].includes(n.state)) return true;
  if (payload.type === 'database-description') {
    if(!local.mtuIgnore&&(remote.mtu??1500)>(local.mtu??1500)){clearExchange(engine,n);setState(engine,node,n,'EXSTART','Received database-description MTU exceeds local interface MTU');return true;}
    if (!Array.isArray(payload.summaries) || typeof payload.exchangeId !== 'string') return true; if (n.state === 'FULL' && n.peerExchangeId !== payload.exchangeId) { clearExchange(engine, n); setState(engine, node, n, '2WAY', 'Peer restarted database exchange'); startExchange(engine, node, n); } n.peerExchangeId = payload.exchangeId; n.dbdReceived = true; if (!payload.response) send(engine, node, local, 'database-description', { exchangeId: n.exchangeId, response: true, summaries: liveLSAs(engine, node).map(l => ({ origin: l.origin, sequence: l.sequence })) }, n.peer); if (n.state !== 'FULL') setState(engine, node, n, 'LOADING', 'Database summaries received');
    send(engine, node, local, 'request', { exchangeId: payload.exchangeId, origins: payload.summaries.filter((s: any) => typeof s.origin === 'string' && Number(s.sequence) > (node.database.get(s.origin)?.sequence ?? 0)).map((s: any) => s.origin) }, n.peer); sendUpdate(engine, node, n, liveLSAs(engine, node), n.exchangeId); complete(engine, node, n);
  } else if (payload.type === 'request') { if (!Array.isArray(payload.origins)) return true; sendUpdate(engine, node, n, liveLSAs(engine, node).filter(l => payload.origins.includes(l.origin)), payload.exchangeId); }
  else if (payload.type === 'update') {
    if (!Array.isArray(payload.lsas) || payload.lsas.length > 4096) return true; const acknowledged: string[] = []; let changed = false;
    for (const raw of payload.lsas) {
      if (!raw || typeof raw.origin !== 'string' || !Number.isSafeInteger(raw.sequence) || raw.sequence < 1 || !Number.isFinite(raw.originatedAt) || raw.originatedAt > engine.clock.now() || !Number.isFinite(raw.maxAge) || raw.maxAge < 50 || !Array.isArray(raw.links) || !Array.isArray(raw.prefixes)) continue;
      const lsa = copy(raw) as LSA;const arrival=Number(routingConfig(engine.getDevice(deviceId)!,protocol,node.vrf)?.lsaArrival??0),previous=node.database.get(lsa.origin);node.arrivals??=new Map();if(previous&&lsa.sequence>previous.sequence&&node.arrivals.has(lsa.origin)&&engine.clock.now()-node.arrivals.get(lsa.origin)!<arrival)continue;acknowledged.push(lsaToken(lsa)); const ownOrigin = node.interfaces[0]?.node;
      if (lsa.origin === ownOrigin) { if (lsa.sequence > node.sequence) { node.sequence = lsa.sequence; originate(engine, node, true); changed = true; } continue; }
      const old = node.database.get(lsa.origin); if (lsa.sequence < Math.max(old?.sequence ?? 0, node.floors.get(lsa.origin) ?? 0)) continue;
      if (engine.clock.now() - lsa.originatedAt >= lsa.maxAge) { if (old && lsa.sequence >= old.sequence) { node.database.delete(lsa.origin); node.floors.set(lsa.origin, lsa.sequence); flood(engine, node, lsa, n); changed = true; } continue; }
      if (lsa.sequence <= Math.max(old?.sequence ?? 0, node.floors.get(lsa.origin) ?? 0)) continue;
      node.database.set(lsa.origin, lsa);node.arrivals.set(lsa.origin,engine.clock.now()); expire(engine, node, lsa); flood(engine, node, lsa, n); changed = true;
    }
    send(engine, node, local, 'ack', { acknowledged, exchangeId: payload.exchangeId }, n.peer); if (payload.exchangeId) n.initialReceived = true; if (changed) update(engine, node); complete(engine, node, n);
  } else if (payload.type === 'ack') { for (const key of payload.acknowledged ?? []) { const pending = n.pending.get(key); if (pending) { engine.clock.cancel(pending.timer); n.pending.delete(key); } } if (payload.exchangeId === n.exchangeId) n.initialAcknowledged = true; complete(engine, node, n); publish(engine, node); }
  return true;
}

/** Clear measured per-process state without manufacturing new neighbors or LSAs. */
export function clearOSPFState(engine:OSPFHost,deviceId:string,protocol:OSPFProtocol,action:'counters'|'traffic'|'events'|'force-spf'|'redistribution'|'rib'):void {
  const d=engine.getDevice(deviceId);if(!d)return;
  for(const node of context(engine).nodes.values())if(node.deviceId===deviceId&&node.protocol===protocol){
    if(action==='counters'||action==='traffic'){for(const n of node.neighbors.values())n.attempts=0;delete d.runtime.features[`${protocol}Traffic`];}
    if(action==='events')d.runtime.features[`${protocol}Events`]=[];
    if(action==='redistribution'){node.signature='';originate(engine,node,true);}
    publish(engine,node);
  }
  if(action==='force-spf'||action==='redistribution'||action==='rib')engine.recompute();engine.notify();
}
