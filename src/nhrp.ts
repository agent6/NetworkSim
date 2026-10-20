import type { ControlPlaneHost } from './control-plane.ts';
import type { Device, Route } from './model.ts';
import type { TimerHandle } from './clock.ts';
import { isIPv4, maskToPrefix, networkAddress, prefixContains } from './ip.ts';
import { tunnelNbma, tunnelSignature } from './tunnel.ts';

type Operation = 'register' | 'register-reply' | 'resolve' | 'resolve-reply' | 'redirect' | 'purge';
export interface NhrpMessage {
  operation: Operation; id: string; authentication: string; tunnel: string; holdtime: number;
  server?: string; client?: string; target?: string; nbma?: string; nextHop?: string;
  network?: string; prefix?: number; phase3?: boolean; requester?: { address: string; nbma: string }; relayed?: boolean;
}
export interface NhrpMapping {
  address: string; nbma: string; type: 'static' | 'dynamic'; registered?: boolean;
  created: number; expires: number; holdtime: number; used?: number;
}
export interface NhrpRegistration {
  server: string; nbma?: string; state: 'REGISTERING' | 'UP' | 'DOWN'; id: string;
  attempts: number; requests: number; replies: number; created: number; expires?: number; lastReply?: number;
}
interface Request { id: string; target: string; phase3: boolean; attempts: number; route?: string; created: number }
export interface NhrpShortcut {
  network: string; prefix: number; nextHop: string; nbma: string; via: string; route: string;
  created: number; expires: number;
}
export interface NhrpRuntime {
  generation: number;
  cache: NhrpMapping[]; registrations: NhrpRegistration[]; requests: Record<string, Request>;
  shortcuts: NhrpShortcut[]; sent: Partial<Record<Operation, number>>; received: Partial<Record<Operation, number>>;
  rejected: number; expired: number;
}
interface Session {
  engine: ControlPlaneHost; device: Device; port: string; runtime: Device['runtime']; state: NhrpRuntime;
  signature: string; timers: Set<TimerHandle>; cacheTimers: Map<string, TimerHandle[]>;
  redirects: Map<string, number>;
}
const sessions = new WeakMap<ControlPlaneHost, Map<string, Session>>();
const owners = new WeakMap<Device, Map<string, Session>>();
const sequences = new WeakMap<ControlPlaneHost, number>();
const retrySeconds = [1, 2, 4, 8, 16, 32];
const routeKey = (r: Route) => JSON.stringify([r.network, r.prefix, r.nextHop, r.interface, r.vrf, r.protocol]);
const signature = (d: Device, port: string) => tunnelSignature(d, port) + JSON.stringify(d.config.interfaces[port]?.features.nhrp);
const nextId = (e: ControlPlaneHost) => { const n = (sequences.get(e) ?? 0) + 1; sequences.set(e, n); return 'nhrp-' + n; };

export function nhrpRuntime(d: Device, port: string): NhrpRuntime {
  return (d.runtime.features.nhrp ??= {})[port] ??= {
    generation: 0, cache: [], registrations: [], requests: {}, shortcuts: [], sent: {}, received: {}, rejected: 0, expired: 0,
  };
}
export function nhrpServers(config: { nhs?: (string | { address: string; nbma?: string })[] }): { address: string; nbma?: string }[] {
  return (config?.nhs ?? []).map(n => typeof n === 'string' ? { address: n } : n);
}
export function nhrpMapping(d: Device, port: string, ip: string, now: number): NhrpMapping | undefined {
  return nhrpRuntime(d, port).cache.find(m => m.address === ip && (m.type === 'static' || m.expires > now));
}
function valid(s: Session): boolean {
  return sessions.get(s.engine)?.get(s.device.id + '|' + s.port) === s &&
    s.engine.getDevice(s.device.id) === s.device && s.device.runtime === s.runtime && s.device.powered &&
    signature(s.device, s.port) === s.signature && s.engine.interfaceUp(s.device.id, s.port);
}
function schedule(s: Session, delay: number, work: () => void, label: string): TimerHandle {
  const timer = s.engine.clock.schedule(delay, () => { s.timers.delete(timer); if (valid(s)) work(); }, { owner: s.device.id, label });
  s.timers.add(timer); return timer;
}
function event(s: Session, label: string, detail: string, drop = false): void {
  s.engine.emit({ nodeId: s.device.id, port: s.port, protocol: 'NHRP', label, detail, disposition: drop ? 'drop' : 'info' });
}
function changed(s: Session): void { s.engine.recompute(); s.engine.notify(); }
function send(s: Session, nbma: string, body: Omit<NhrpMessage, 'authentication' | 'tunnel' | 'holdtime'>): void {
  if (!valid(s) || !isIPv4(nbma)) return;
  const iface = s.device.config.interfaces[s.port], config = iface.features.nhrp;
  const message: NhrpMessage = { authentication: config.authentication ?? '', tunnel: iface.ip!, holdtime: config.holdtime ?? 7200, ...body };
  s.state.sent[body.operation] = (s.state.sent[body.operation] ?? 0) + 1;
  s.engine.sendNhrpDatagram?.(s.device.id, s.port, nbma, message);
}
function cancelCacheTimers(s: Session, address: string): void {
  for (const timer of s.cacheTimers.get(address) ?? []) { s.engine.clock.cancel(timer); s.timers.delete(timer); }
  s.cacheTimers.delete(address);
}
function removeMapping(s: Session, mapping: NhrpMapping): void {
  cancelCacheTimers(s, mapping.address);
  const shortcuts = s.state.shortcuts.filter(c => c.nextHop === mapping.address);
  for (const target of Object.keys(s.state.requests)) if (target === mapping.address || shortcuts.some(c => prefixContains(c.network, c.prefix, target))) delete s.state.requests[target];
  s.state.cache = s.state.cache.filter(m => m !== mapping);
  s.state.shortcuts = s.state.shortcuts.filter(c => c.nextHop !== mapping.address);
}
function purgePeers(s: Session, mapping: NhrpMapping): void {
  for (const peer of s.state.cache.filter(m => m.registered && m.expires > s.engine.clock.now() && m.address !== mapping.address))
    send(s, peer.nbma, { operation: 'purge', id: nextId(s.engine), target: mapping.address, nbma: mapping.nbma });
}
function learn(s: Session, address: string, nbma: string, holdtime: number, type: NhrpMapping['type'] = 'dynamic', registered = false): void {
  if (!isIPv4(address) || !isIPv4(nbma)) return;
  const old = s.state.cache.find(m => m.address === address);
  if (old?.type === 'static') return;
  if (old) {
    if (old.nbma !== nbma) { purgePeers(s, old); removeMapping(s, old); }
    else cancelCacheTimers(s, address);
  }
  const now = s.engine.clock.now(), mapping: NhrpMapping = {
    address, nbma, type, registered, holdtime, created: old?.nbma === nbma ? old.created : now, expires: now + holdtime * 1000,
  };
  s.state.cache = s.state.cache.filter(m => m.address !== address); s.state.cache.push(mapping);
  const expire = schedule(s, holdtime * 1000, () => {
    if (!s.state.cache.includes(mapping)) return;
    removeMapping(s, mapping); s.state.expired++; if (mapping.registered) purgePeers(s, mapping);
    event(s, 'Mapping expired', `${address} on ${s.port}.`); changed(s);
  }, 'NHRP cache expiry');
  const refresh = schedule(s, holdtime * 2000 / 3, () => {
    if (mapping.type !== 'dynamic' || mapping.registered || mapping.used === undefined) return;
    const shortcut = s.state.shortcuts.find(c => c.nextHop === address);
    request(s, shortcut?.network ?? address, !!shortcut);
  }, 'NHRP active mapping refresh');
  s.cacheTimers.set(address, [expire, refresh]);
}
function registration(s: Session, row: NhrpRegistration): void {
  const nbma = row.nbma;
  if (!nbma) { row.state = 'DOWN'; event(s, 'NHS unresolved', `Configure an NBMA mapping for NHS ${row.server}.`, true); return; }
  row.id = nextId(s.engine); row.attempts = 0;
  const id = row.id;
  const attempt = () => {
    if (row.id !== id || !s.state.registrations.includes(row)) return;
    if (row.attempts >= retrySeconds.length) {
      row.state = 'DOWN'; event(s, 'NHS down', `No registration reply from ${row.server}.`, true); changed(s);
      schedule(s, Math.max(1000, Math.min(60000, (s.device.config.interfaces[s.port].features.nhrp.holdtime ?? 7200) * 1000 / 3)), () => registration(s, row), 'NHRP NHS recovery');
      return;
    }
    row.requests++;
    send(s, nbma, { operation: 'register', id, server: row.server });
    const delay = retrySeconds[row.attempts++] * 1000;
    schedule(s, delay, attempt, 'NHRP registration retry');
  };
  attempt();
}
function expireRegistration(s: Session, row: NhrpRegistration): void {
  const expiry = row.expires;
  if (expiry === undefined) return;
  schedule(s, Math.max(0, expiry - s.engine.clock.now()), () => {
    if (row.expires === expiry) { row.state = 'DOWN'; event(s, 'NHS registration expired', row.server, true); changed(s); }
  }, 'NHRP NHS hold expiry');
}
function serverNbma(s: Session, server: { address: string; nbma?: string }): string | undefined {
  return server.nbma ?? nhrpMapping(s.device, s.port, server.address, s.engine.clock.now())?.nbma;
}
function request(s: Session, target: string, phase3: boolean): void {
  if (s.state.requests[target] || Object.keys(s.state.requests).length >= 64) return;
  const route = phase3 ? s.engine.cefLookup?.(s.device.id, target, s.device.config.interfaces[s.port].vrf) : undefined;
  if (phase3 && (!route || route.port !== s.port)) return;
  const row: Request = { id: nextId(s.engine), target, phase3, attempts: 0, created: s.engine.clock.now(), route: route && routeKey(route.route) };
  s.state.requests[target] = row;
  const attempt = () => {
    if (s.state.requests[target] !== row) return;
    if (row.attempts >= retrySeconds.length) { delete s.state.requests[target]; event(s, 'Resolution failed', `No NHRP reply for ${target}.`, true); return; }
    for (const server of nhrpServers(s.device.config.interfaces[s.port].features.nhrp)) {
      const nbma = serverNbma(s, server);
      if (nbma) send(s, nbma, { operation: 'resolve', id: row.id, target, phase3 });
    }
    schedule(s, retrySeconds[row.attempts++] * 1000, attempt, 'NHRP resolution retry');
  };
  attempt();
}
export function synchronizeNhrp(engine: ControlPlaneHost): void {
  let table = sessions.get(engine); if (!table) { table = new Map(); sessions.set(engine, table); }
  const wanted = new Set<string>();
  for (const d of engine.lab.devices) for (const [port, iface] of Object.entries(d.config.interfaces)) {
    if (!/^Tunnel/i.test(port) || !d.powered || !iface.features.nhrp?.networkId || !iface.ip || !tunnelNbma(d, iface) || !engine.interfaceUp(d.id, port)) continue;
    const key = d.id + '|' + port; wanted.add(key); const old = table.get(key), sig = signature(d, port);
    if (old?.runtime === d.runtime && old.signature === sig) continue;
    if (old) { for (const timer of old.timers) engine.clock.cancel(timer); table.delete(key); }
    const prior = nhrpRuntime(d, port);
    const state: NhrpRuntime = { generation: prior.generation+1, cache: [], registrations: [], requests: {}, shortcuts: [], sent: prior.sent, received: prior.received, rejected: prior.rejected, expired: prior.expired };
    d.runtime.features.nhrp[port] = state;
    const s: Session = { engine, device: d, port, runtime: d.runtime, state, signature: sig, timers: new Set(), cacheTimers: new Map(), redirects: new Map() };
    table.set(key, s); let deviceSessions = owners.get(d); if (!deviceSessions) { deviceSessions = new Map(); owners.set(d, deviceSessions); } deviceSessions.set(port, s);
    for (const m of iface.features.nhrp.maps ?? []) state.cache.push({ address: m.address ?? m.protocolAddress, nbma: m.nbma, type: 'static', created: engine.clock.now(), expires: Infinity, holdtime: 0 });
    for (const server of nhrpServers(iface.features.nhrp)) {
      const nbma = serverNbma(s, server);
      if (nbma && !state.cache.some(m => m.address === server.address)) state.cache.push({ address: server.address, nbma, type: 'static', created: engine.clock.now(), expires: Infinity, holdtime: 0 });
      const row: NhrpRegistration = { server: server.address, nbma, state: 'REGISTERING', id: '', attempts: 0, requests: 0, replies: 0, created: engine.clock.now() };
      state.registrations.push(row); schedule(s, 0, () => registration(s, row), 'NHRP initial registration');
    }
  }
  for (const [key, s] of table) if (!wanted.has(key)) {
    for (const timer of s.timers) engine.clock.cancel(timer);
    table.delete(key); owners.get(s.device)?.delete(s.port);
    if (s.device.runtime === s.runtime) delete s.device.runtime.features.nhrp?.[s.port];
  }
}
export function receiveNhrp(engine: ControlPlaneHost, deviceId: string, port: string, source: string, p: NhrpMessage): void {
  const d = engine.getDevice(deviceId), s = d && owners.get(d)?.get(port); if (!s || !valid(s)) return;
  const iface = d!.config.interfaces[port], config = iface.features.nhrp, now = engine.clock.now();
  const reject = (reason: string) => { s.state.rejected++; event(s, 'NHRP rejected', reason, true); };
  if (!p || !['register', 'register-reply', 'resolve', 'resolve-reply', 'redirect', 'purge'].includes(p.operation) || typeof p.id !== 'string' || !isIPv4(p.tunnel) ||
    !prefixContains(iface.ip!, maskToPrefix(iface.mask!), p.tunnel) || p.authentication !== (config.authentication ?? '') ||
    !Number.isInteger(p.holdtime) || p.holdtime < 1 || p.holdtime > 65535) { reject('Authentication, address or message format mismatch.'); return; }
  s.state.received[p.operation] = (s.state.received[p.operation] ?? 0) + 1;
  const server = nhrpServers(config).some(n => n.address === p.tunnel && serverNbma(s, n) === source);
  if (p.operation === 'register' && p.server === iface.ip) {
    learn(s, p.tunnel, source, p.holdtime, 'dynamic', true);
    send(s, source, { operation: 'register-reply', id: p.id, client: p.tunnel });
    event(s, 'Spoke registered', `${p.tunnel} maps to NBMA ${source} on ${port}.`);
  } else if (p.operation === 'register-reply' && server && p.client === iface.ip) {
    const row = s.state.registrations.find(r => r.server === p.tunnel && r.id === p.id); if (!row) return;
    row.state = 'UP'; row.lastReply = now; row.replies++; row.expires = now + p.holdtime * 1000;
    row.id = '';
    expireRegistration(s, row);
    schedule(s, Math.max(1000, (config.registrationTimeout ?? (config.holdtime ?? 7200) / 3) * 1000), () => registration(s, row), 'NHRP registration refresh');
  } else if (p.operation === 'resolve' && isIPv4(p.target ?? '')) {
    const requester = nhrpMapping(d!, port, p.tunnel, now);
    if (requester?.nbma !== source && !server) { reject('Resolution request has no registered or configured ingress peer.'); return; }
    if (!p.phase3) {
      const found = p.target === iface.ip ? { address: iface.ip!, nbma: tunnelNbma(d!, iface)! } : nhrpMapping(d!, port, p.target!, now);
      if (found) send(s, source, { operation: 'resolve-reply', id: p.id, target: p.target, nbma: found.nbma, nextHop: found.address });
    } else {
      const origin = p.relayed ? (server ? p.requester : undefined) : { address: p.tunnel, nbma: source };
      if (!origin || !isIPv4(origin.address) || !isIPv4(origin.nbma)) { reject('Invalid Phase 3 requester.'); return; }
      const route = engine.cefLookup?.(deviceId, p.target!, iface.vrf);
      if (!route || /^Null/i.test(route.port)) return;
      if (route.port === port) {
        const next = nhrpMapping(d!, port, route.target, now);
        if (p.relayed || !next || next.nbma === source) return;
        send(s, next.nbma, { operation: 'resolve', id: p.id, target: p.target, phase3: true, relayed: true, requester: origin });
      } else if (route.route.protocol === 'connected' || route.route.protocol === 'local') {
        learn(s, origin.address, origin.nbma, p.holdtime);
        const advertised = d!.runtime.routes.filter(r => r.protocol === 'connected' && r.interface === route.port && prefixContains(r.network, r.prefix, p.target!)).sort((a,b)=>b.prefix-a.prefix)[0] ?? route.route;
        send(s, origin.nbma, { operation: 'resolve-reply', id: p.id, target: p.target, phase3: true, nbma: tunnelNbma(d!, iface), nextHop: iface.ip,
          network: advertised.network, prefix: advertised.prefix });
      }
    }
  } else if (p.operation === 'resolve-reply' && isIPv4(p.target ?? '') && isIPv4(p.nbma ?? '')) {
    const row = s.state.requests[p.target!]; if (!row || row.id !== p.id || !!p.phase3 !== row.phase3) return;
    if (row.phase3) {
      const route = engine.cefLookup?.(deviceId, p.target!, iface.vrf);
      if (!config.shortcut || !route || route.port !== port || row.route !== routeKey(route.route) || source !== p.nbma || p.nextHop !== p.tunnel ||
        !isIPv4(p.network ?? '') || !Number.isInteger(p.prefix) || p.prefix! < 0 || p.prefix! > 32 || !prefixContains(p.network!, p.prefix!, p.target!)) { reject('Phase 3 reply does not match the pending route or destination peer.'); return; }
      learn(s, p.tunnel, source, p.holdtime);
      const prefix = Math.max(p.prefix!,route.route.prefix);
      const shortcut: NhrpShortcut = { network: networkAddress(p.target!, prefix), prefix, nextHop: p.tunnel, nbma: source, via: route.route.nextHop??route.target, route: row.route!, created: now, expires: now + p.holdtime * 1000 };
      s.state.shortcuts = s.state.shortcuts.filter(c => c.network !== shortcut.network || c.prefix !== shortcut.prefix); s.state.shortcuts.push(shortcut);
      schedule(s, p.holdtime * 1000, () => { s.state.shortcuts = s.state.shortcuts.filter(c => c !== shortcut); changed(s); }, 'NHRP shortcut expiry');
      event(s, 'NHRP shortcut installed', `${shortcut.network}/${shortcut.prefix} via ${shortcut.nextHop}, NBMA ${shortcut.nbma}.`);
    } else {
      if (!server || !prefixContains(iface.ip!, maskToPrefix(iface.mask!), p.target!)) { reject('Resolution reply is not from the configured NHS.'); return; }
      learn(s, p.target!, p.nbma!, p.holdtime);
    }
    delete s.state.requests[p.target!]; event(s, 'Resolution complete', `${p.target} maps to NBMA ${p.nbma}.`);
  } else if (p.operation === 'redirect' && server && config.shortcut && isIPv4(p.target ?? '')) {
    const route = engine.cefLookup?.(deviceId, p.target!, iface.vrf);
    if (route?.port === port && route.target === p.tunnel) { event(s, 'NHRP redirect received', `Resolving ${p.target} through NHS ${p.tunnel}.`); request(s, p.target!, true); }
  } else if (p.operation === 'purge' && server) {
    s.state.requests = {};
    for (const mapping of [...s.state.cache]) if (mapping.type !== 'static' && mapping.address === p.target && (!p.nbma || mapping.nbma === p.nbma)) removeMapping(s, mapping);
    event(s, 'NHRP cache purged', `${p.target} withdrawn by NHS ${p.tunnel}.`);
  } else { reject('Message does not match the local NHS or an outstanding exchange.'); return; }
  changed(s);
}
export function resolveTunnelDestination(engine: ControlPlaneHost, d: Device, port: string, address: string): string | undefined {
  const iface = d.config.interfaces[port]; if (!iface) return;
  if (iface.features.tunnelMode !== 'gre multipoint') return iface.features.tunnelDestination;
  const cached = nhrpMapping(d, port, address, engine.clock.now());
  if (cached) return cached.nbma;
  const s = owners.get(d)?.get(port); if (s && valid(s) && isIPv4(address)) request(s, address, false);
  return;
}
export function touchNhrp(d: Device, port: string, address: string): void {
  const s = owners.get(d)?.get(port), mapping = s && nhrpMapping(d, port, address, s.engine.clock.now());
  if (mapping) mapping.used = s!.engine.clock.now();
}
export function tunnelAccepts(_engine: ControlPlaneHost, d: Device, port: string, source: string): boolean {
  const iface = d.config.interfaces[port];
  return iface?.features.tunnelMode === 'gre multipoint' ? !!iface.features.nhrp?.networkId : iface?.features.tunnelDestination === source;
}
export function nhrpForwardingOverride(d: Device, route: Route, target: string): NhrpShortcut | undefined {
  const s = owners.get(d)?.get(route.interface); if (!s || !valid(s) || !d.config.interfaces[s.port].features.nhrp?.shortcut) return;
  return s.state.shortcuts.filter(c => c.expires > s.engine.clock.now() && c.route === routeKey(route) &&
    prefixContains(c.network, c.prefix, target) && nhrpMapping(d, s.port, c.nextHop, s.engine.clock.now())?.nbma === c.nbma)
    .sort((a, b) => b.prefix - a.prefix)[0];
}
export function nhrpRouteShortcuts(d:Device,route:Route):NhrpShortcut[] {
  const s=owners.get(d)?.get(route.interface);
  return s?.state.shortcuts.filter(c=>c.route===routeKey(route)&&nhrpForwardingOverride(d,route,c.network)===c)??[];
}
export function sendNhrpRedirect(engine: ControlPlaneHost, d: Device, port: string, peer: string | undefined, target: string, nextHop: string): void {
  const s = owners.get(d)?.get(port); if (!s || !valid(s) || !d.config.interfaces[port].features.nhrp.redirect || !peer) return;
  const now = engine.clock.now(), origin = s.state.cache.find(m => m.nbma === peer && m.registered && m.expires > now);
  const destination = nhrpMapping(d, port, nextHop, now);
  if (!origin || !destination || origin.nbma === destination.nbma) return;
  const key = origin.address + '|' + target, last = s.redirects.get(key);
  if (last !== undefined && now - last < 1000) return;
  if (s.redirects.size >= 256) s.redirects.delete(s.redirects.keys().next().value!);
  s.redirects.set(key, now); send(s, origin.nbma, { operation: 'redirect', id: nextId(engine), target });
  event(s, 'NHRP redirect sent', `${origin.address}: destination ${target} is reachable through spoke ${nextHop}.`);
}
export function clearNhrp(engine: ControlPlaneHost, deviceId: string, port?: string, address?: string): void {
  const d = engine.getDevice(deviceId); if (!d) return;
  for (const [name, s] of owners.get(d) ?? []) if (!port || name === port) {
    for (const mapping of [...s.state.cache]) if (mapping.type !== 'static' && (!address || mapping.address === address)) { removeMapping(s, mapping); purgePeers(s, mapping); }
    if (address) { delete s.state.requests[address]; s.state.shortcuts = s.state.shortcuts.filter(c => c.nextHop !== address); }
    else {
      s.state.generation++;
      for (const timer of s.timers) engine.clock.cancel(timer);
      s.timers.clear(); s.cacheTimers.clear(); s.state.requests = {}; s.state.shortcuts = [];
      for (const row of s.state.registrations) { expireRegistration(s, row); registration(s, row); }
    }
  }
  engine.recompute(); engine.notify();
}
