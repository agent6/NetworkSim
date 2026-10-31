import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
export const vrfLiteLabId = (name: string) => 'device-vl-' + name.toLowerCase();
const live = ['definitions', 'access', 'trunks', 'routes', 'healthy', 'saved'] as const;
const observed = ['traffic', 'router', 'http', 'arp', 'isolation', 'global', 'tag', 'route', 'binding'] as const;
type Live = typeof live[number]; type Observed = typeof observed[number]; type VRF = 'BLUE' | 'RED';
export type VRFLiteCriterion = {kind: 'vl-live'; device: string; check: Live} | {kind: 'vl-observe'; device: string; check: Observed};
export function validVRFLiteCriterion(c: any) {
  return !!c && typeof c.device === 'string' && c.device.length > 0 && c.device.length <= 128 &&
    (c.kind === 'vl-live' ? (live as readonly string[]).includes(c.check) : c.kind === 'vl-observe' && (observed as readonly string[]).includes(c.check));
}
const id = vrfLiteLabId, g = (n: number) => 'GigabitEthernet0/' + n, get = (s: Simulator, n: string) => s.getDevice(id(n))!;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b), vrfs: VRF[] = ['BLUE', 'RED'];
const tag = (v: VRF) => v === 'BLUE' ? 110 : 120, sub = (v: VRF) => g(1) + '.' + tag(v), lan = (v: VRF) => g(v === 'BLUE' ? 0 : 2), diag = (v: VRF) => '198.51.100.' + tag(v);
const client = '192.168.10.10', server = '192.168.20.10';
function shape(s: Simulator) {
  return s.lab.devices.length === 6 && ['PE1', 'PE2'].every(n => get(s, n)?.kind === 'router' && [0, 1, 2].every(i => !!get(s, n)?.config.interfaces[g(i)])) &&
    vrfs.every(v => get(s, 'PC-' + v)?.kind === 'pc' && !!get(s, 'PC-' + v)?.config.interfaces.GigabitEthernet0 && get(s, 'SRV-' + v)?.kind === 'server' && !!get(s, 'SRV-' + v)?.config.interfaces.GigabitEthernet0);
}
function base(s: Simulator) {
  const pair = (a: string, ap: string, b: string, bp: string) => [id(a) + ':' + ap, id(b) + ':' + bp].sort().join('|');
  const expected = [pair('PC-BLUE', 'GigabitEthernet0', 'PE1', g(0)), pair('PC-RED', 'GigabitEthernet0', 'PE1', g(2)), pair('PE1', g(1), 'PE2', g(1)), pair('PE2', g(0), 'SRV-BLUE', 'GigabitEthernet0'), pair('PE2', g(2), 'SRV-RED', 'GigabitEthernet0')].sort();
  return s.lab.links.length === 5 && s.lab.links.every(l => l.enabled && !l.loss) && eq(s.lab.links.map(l => [l.a.deviceId + ':' + l.a.port, l.b.deviceId + ':' + l.b.port].sort().join('|')).sort(), expected) &&
    s.lab.devices.every(d => d.powered && Object.values(d.config.interfaces).every(p => !p.features.aclIn && !p.features.aclOut && !p.features.routeMap && !p.features.servicePolicyIn && !p.features.servicePolicyOut)) &&
    ['PE1', 'PE2'].every(n => {const d = get(s, n), p = d.config.interfaces[g(1)]; return d.config.ipRouting && !Object.keys(d.config.protocols).length && !Object.keys(d.config.features.routeMaps ?? {}).length && !Object.keys(d.config.features.acls ?? {}).length && !d.config.features.localPolicy && p.adminUp && !p.ip && !p.vrf && !p.switchport && s.interfaceUp(d.id, p.name);}) &&
    vrfs.every(v => ['PC-', 'SRV-'].every(prefix => {const d = get(s, prefix + v), p = d.config.interfaces.GigabitEthernet0, srv = prefix === 'SRV-'; return p.adminUp && !p.features.dhcp && p.ip === (srv ? server : client) && p.mask === '255.255.255.0' && d.config.defaultGateway === (srv ? '192.168.20.1' : '192.168.10.1');}));
}
function definitions(s: Simulator) {return ['PE1', 'PE2'].every(n => {const a = get(s, n).config.features.vrfs ?? {}; return Object.keys(a).length === 2 && vrfs.every(v => eq(a[v], {addressFamilies: {ipv4: {}}}));});}
function access(s: Simulator, unboundBlue = false) {
  return ['PE1', 'PE2'].every((n, i) => vrfs.every(v => {
    const d = get(s, n), p = d.config.interfaces[lan(v)];
    if (unboundBlue && n === 'PE1' && v === 'BLUE') return p.adminUp && !p.switchport && p.vrf === undefined && p.ip === undefined;
    return p.adminUp && !p.switchport && p.vrf === v && p.ip === `192.168.${i ? 20 : 10}.1` && p.mask === '255.255.255.0' && s.interfaceUp(d.id, p.name);
  }));
}
function trunks(s: Simulator, badTag = false) {
  return ['PE1', 'PE2'].every((n, i) => vrfs.every(v => {const d = get(s, n), p = d.config.interfaces[sub(v)]; return !!p && p.adminUp && !p.switchport && p.vrf === v && p.ip === `10.0.0.${i + 1}` && p.mask === '255.255.255.252' && p.features.dot1q === (badTag && n === 'PE2' && v === 'BLUE' ? 111 : tag(v)) && !p.features.dot1qNative && s.interfaceUp(d.id, p.name); }));
}
function loopbacks(s: Simulator) {
  const d = get(s, 'PE2'); return vrfs.every(v => {const p = d.config.interfaces['Loopback' + tag(v)]; return !!p && p.vrf === v && p.ip === diag(v) && p.mask === '255.255.255.255' && p.adminUp && s.interfaceUp(d.id, p.name);});
}
function routeConfig(s: Simulator, missingBlue = false) {
  return ['PE1', 'PE2'].every((n, i) => {const d = get(s, n), rows = d.config.staticRoutes;
    const expected = vrfs.flatMap(v => [...(!(missingBlue && !i && v === 'BLUE') ? [{vrf: v, network: i ? '192.168.10.0' : '192.168.20.0', prefix: 24}] : []), ...(!i ? [{vrf: v, network: diag(v), prefix: 32}] : [])]);
    return rows.length === expected.length && expected.every(a => rows.some(r => r.vrf === a.vrf && r.network === a.network && r.prefix === a.prefix && r.interface === sub(a.vrf) && r.nextHop === `10.0.0.${i ? 1 : 2}` && (r.ad ?? 1) === 1 && r.track === undefined && !r.permanent));
  });
}
function scoped(s: Simulator) {
  return routeConfig(s) && ['PE1', 'PE2'].every((n, i) => {
    const d = get(s, n); return d.runtime.routes.length > 0 && d.runtime.routes.every(r => r.vrf === 'BLUE' || r.vrf === 'RED') && !s.cefLookup(d.id, i ? client : server) && vrfs.every(v => {const r = s.cefLookup(d.id, i ? client : server, v); return r?.port === sub(v) && r.target === `10.0.0.${i ? 1 : 2}` && r.route.protocol === 'static' && r.route.prefix === 24 && r.route.vrf === v;});
  });
}
function healthy(s: Simulator) {
  return base(s) && definitions(s) && access(s) && trunks(s) && loopbacks(s) && scoped(s) && ['PE1', 'PE2'].every(n => Object.values(get(s, n).config.interfaces).every(p => !p.ip || p.vrf === 'BLUE' || p.vrf === 'RED')) &&
    vrfs.every(v => {const h = get(s, 'SRV-' + v).config.services.http; return h?.enabled && (h.port ?? 80) === 80 && (h.authentication ?? 'none') === 'none' && !!h.content?.includes(`VRF-Lite ${v}: tenant server reached`);});
}
type Attempt = {lab: object; epochs: Map<string, {signature: string; since: number}>; marks: Map<string, number>; earned: Set<Observed>};
const attempts = new WeakMap<Simulator, Attempt>();
function attempt(s: Simulator) {
  let a = attempts.get(s);
  if (!a || a.lab !== s.lab) {
    a = {lab: s.lab, epochs: new Map(), marks: new Map(), earned: new Set()}; attempts.set(s, a);
    const current = a, unsubscribe = s.subscribe(() => {if (s.lab !== current.lab) {unsubscribe(); return;} if (shape(s)) for (const check of observed) matchesVRFLiteCriterion(s, get(s, 'PE1'), {kind: 'vl-observe', device: id('PE1'), check});});
  }
  return a;
}
function since(s: Simulator, key: string, ok: boolean) {
  const a = attempt(s); if (!ok) {a.epochs.delete(key); return;}
  const signature = JSON.stringify(s.lab.devices.map(d => [d.id, d.config]));
  const old = a.epochs.get(key); if (!old || old.signature !== signature) {const v = {signature, since: s.clock.now()}; a.epochs.set(key, v); return v.since;} return old.since;
}
function traffic(s: Simulator, at: number, v: VRF, reverse = false, router = false, target = server) {
  const from = router ? 'PE1' : reverse ? 'SRV-' + v : 'PC-' + v, to = target === server ? 'SRV-' + v : target === client ? 'PC-' + v : 'PE2', source = router ? '10.0.0.1' : reverse ? server : client, requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet; if (e.time <= at || e.nodeId !== id(from) || e.label !== 'Echo reply received' || p?.source !== target || p.destination !== source || !p.parentId || router && p.vrf !== v) continue;
    const req = p.parentId;
    if (!s.events.some(x => x.time > at && x.nodeId === id(to) && x.label === 'Echo request accepted' && x.packet?.id === req && (to !== 'PE2' || x.packet.vrf === v))) continue;
    if (s.events.some(x => x.time > at && x.nodeId === id(target === client ? 'PC-' + (v === 'BLUE' ? 'RED' : 'BLUE') : 'SRV-' + (v === 'BLUE' ? 'RED' : 'BLUE')) && x.label === 'Echo request accepted' && x.packet?.id === req)) continue;
    const tx = reverse ? 'PE2' : 'PE1', rx = reverse ? 'PE1' : 'PE2';
    if (!s.events.some(x => x.time > at && x.nodeId === id(tx) && x.port === g(1) && x.label === 'Frame sent' && x.packet?.id === req && x.packet.vrf === v && x.packet.vlan === tag(v)) || !s.events.some(x => x.time > at && x.nodeId === id(rx) && x.port === g(1) && x.label === 'Frame received' && x.packet?.id === req && x.packet.vlan === tag(v))) continue;
    requests.add(req);
  }
  return requests.size >= 3;
}
function drops(s: Simulator, at: number, v: VRF, target: string, binding = false, neighbor = false) {
  const requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet; if (e.time <= at || e.disposition !== 'drop' || p?.messageType !== 'echo-request' || p.source !== client || p.destination !== target) continue;
    const gateway = e.nodeId === id('PE1') && e.label === 'No route' && p.vrf === (binding ? undefined : v);
    const unresolved = e.label === 'Neighbor unresolved' && e.nodeId === id(binding ? 'PC-' + v : 'PE1') && (binding || p.vrf === v);
    if (!(neighbor ? unresolved : binding ? gateway || unresolved : gateway)) continue;
    if (!binding && !s.events.some(x => x.time > at && x.nodeId === id('PC-' + v) && x.label === 'Frame sent' && x.packet?.id === p.id)) continue;
    if (s.events.some(x => x.time > at && x.nodeId === id('SRV-' + v) && x.label === 'Echo request accepted' && x.packet?.id === p.id)) continue;
    requests.add(p.id);
  }
  return requests.size >= 3;
}
function tagARP(s: Simulator, at: number) {
  return s.events.some(e => e.time > at && e.nodeId === id('PE1') && e.port === g(1) && e.label === 'Frame sent' && e.packet?.arpOperation === 'request' && e.packet.source === '10.0.0.1' && e.packet.destination === '10.0.0.2' && e.packet.vlan === 110 &&
    s.events.some(x => x.time > at && x.nodeId === id('PE2') && x.label === 'Frame received' && x.packet?.id === e.packet!.id && x.packet.vlan === 110));
}
function neighbors(s: Simulator, at: number) {
  return ['PE1', 'PE2'].every((n, i) => vrfs.every(v => {
    const row = Object.values(get(s, n).runtime.arp).find(a => a.ip === `10.0.0.${i ? 1 : 2}` && a.port === sub(v) && a.vrf === v && !a.static && a.expires > s.clock.now());
    return !!row && s.events.some(e => e.time > at && e.nodeId === id(n) && e.port === g(1) && e.label === 'Frame received' && !!e.packet?.arpOperation && e.packet.source === row.ip && e.packet.sourceMac === row.mac && e.packet.vlan === tag(v));
  }));
}
function web(s: Simulator, at: number, v: VRF) {
  return Object.entries<any>(get(s, 'PC-' + v).runtime.features.tcpConnections ?? {}).some(([t, c]) => {
    if (c.remoteAddress !== server || c.remotePort !== 80 || c.payload?.application !== 'http' || c.payload.path !== '/' || !Number.isInteger(c.expected) || c.expected < 1 || c.expected > 2048 || c.received !== c.expected) return false;
    const r = get(s, 'SRV-' + v).runtime.features.tcpConnections?.[t]; if (r?.source !== client || r.response?.statusCode !== 200 || get(s, 'SRV-' + (v === 'BLUE' ? 'RED' : 'BLUE')).runtime.features.tcpConnections?.[t]) return false;
    try {const b = JSON.parse(Array.from({length: c.expected}, (_, i) => c.segments[i]).join('')); if (b.statusCode !== 200 || b.content !== r.response.content || !b.content.includes(`VRF-Lite ${v}: tenant server reached`)) return false;} catch {return false;}
    return s.events.some(e => e.time > at && e.nodeId === id('PE1') && e.port === g(1) && e.label === 'Frame sent' && e.packet?.serviceTransaction === t && e.packet.source === client && e.packet.vrf === v && e.packet.vlan === tag(v));
  });
}
function evaluate(s: Simulator, d: Device, c: VRFLiteCriterion): boolean {
  if (d.id !== id('PE1') || !shape(s)) return false;
  if (c.kind === 'vl-live') switch (c.check) {
    case 'definitions': return definitions(s);
    case 'access': return definitions(s) && access(s);
    case 'trunks': return base(s) && definitions(s) && trunks(s);
    case 'routes': return base(s) && definitions(s) && access(s) && trunks(s) && loopbacks(s) && scoped(s);
    case 'healthy': return healthy(s);
    case 'saved': return healthy(s) && ['PE1', 'PE2'].every(n => eq(get(s, n).config, get(s, n).startupConfig));
  }
  const a = attempt(s), ready = a.earned.has('traffic'), normal = healthy(s), core = base(s) && definitions(s) && loopbacks(s);
  const track = (key: string, ok: boolean, proof: (at: number) => boolean) => {const at = since(s, key, ok); if (at !== undefined && proof(at)) a.marks.set(key, s.clock.now());};
  track('tag', ready && core && access(s) && trunks(s, true) && routeConfig(s), at => tagARP(s, at) && drops(s, at, 'BLUE', server, false, true) && traffic(s, at, 'RED'));
  track('route', ready && core && access(s) && trunks(s) && routeConfig(s, true), at => drops(s, at, 'BLUE', server) && traffic(s, at, 'RED'));
  track('binding', ready && core && access(s, true) && trunks(s) && routeConfig(s), at => drops(s, at, 'BLUE', server, true) && traffic(s, at, 'RED'));
  const at = since(s, 'normal', normal); if (at === undefined) return false;
  if (c.check === 'traffic') return vrfs.every(v => traffic(s, at, v) && traffic(s, at, v, true, false, client));
  if (c.check === 'router') return vrfs.every(v => traffic(s, at, v, false, true));
  if (c.check === 'http') return vrfs.every(v => web(s, at, v));
  if (c.check === 'arp') return neighbors(s, at);
  if (c.check === 'isolation') return vrfs.every(v => traffic(s, at, v, false, false, diag(v)) && drops(s, at, v, diag(v === 'BLUE' ? 'RED' : 'BLUE')));
  if (c.check === 'global') return new Set(s.events.filter(e => e.time > at && e.nodeId === id('PE1') && e.label === 'No route' && e.disposition === 'drop' && e.packet?.messageType === 'echo-request' && e.packet.destination === server && e.packet.vrf === undefined).map(e => e.packet!.id)).size >= 3 && ready;
  const mark = a.marks.get(c.check); return mark !== undefined && at >= mark && vrfs.every(v => traffic(s, Math.max(at, mark), v));
}
export function matchesVRFLiteCriterion(s: Simulator, d: Device, c: VRFLiteCriterion): boolean {
  if (!validVRFLiteCriterion(c) || d.id !== c.device || !shape(s)) return false;
  if (c.kind === 'vl-live') return evaluate(s, d, c);
  const a = attempt(s); if (a.earned.has(c.check)) return true; if (evaluate(s, d, c)) a.earned.add(c.check); return a.earned.has(c.check);
}
