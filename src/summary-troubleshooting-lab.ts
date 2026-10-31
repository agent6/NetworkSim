import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';

export const summaryTroubleshootingLabId = (name: string) => 'device-sum-' + name.toLowerCase();
const live = ['policy', 'aggregate', 'healthy', 'saved'] as const;
const observed = ['baseline', 'traffic', 'hole', 'narrow', 'placement', 'broad', 'partial', 'withdrawal', 'http'] as const;
type Live = typeof live[number];
type Observed = typeof observed[number];
export type SummaryTroubleshootingCriterion = {kind: 'sum-live'; device: string; check: Live} | {kind: 'sum-observe'; device: string; check: Observed};
export function validSummaryTroubleshootingCriterion(c: any) {
  return !!c && typeof c.device === 'string' && c.device.length > 0 && c.device.length <= 128 &&
    (c.kind === 'sum-live' ? (live as readonly string[]).includes(c.check) : c.kind === 'sum-observe' && (observed as readonly string[]).includes(c.check));
}
const id = summaryTroubleshootingLabId, g = (n: number) => 'GigabitEthernet0/' + n;
const get = (s: Simulator, n: string) => s.getDevice(id(n))!;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const service = '192.168.30.10', pcIP = (n: number) => `172.16.${n - 1}.10`, hole = '172.16.2.10', outside = '172.16.8.10';
function shape(s: Simulator) {
  return s.lab.devices.length === 6 && ['R1', 'R2', 'R3'].every(n => get(s, n)?.kind === 'router' && [0, 1, 2].every(i => !!get(s, n)?.config.interfaces[g(i)])) &&
    ['PC1', 'PC2'].every(n => get(s, n)?.kind === 'pc' && !!get(s, n)?.config.interfaces.GigabitEthernet0) && get(s, 'SRV1')?.kind === 'server' && !!get(s, 'SRV1')?.config.interfaces.GigabitEthernet0;
}
const branch = (s: Simulator, n: string) => get(s, n).runtime.routes.filter(r => r.network.startsWith('172.16.') && !r.vrf);
const summary = (s: Simulator) => branch(s, 'R1').filter(r => r.protocol === 'D summary');
function entries(s: Simulator) {
  return ['R1', 'R2', 'R3'].flatMap(n => Object.values(get(s, n).config.interfaces).flatMap(p => (p.features.eigrp?.summaries ?? []).map((a: any) => [n, p.name, a.network, a.prefix, a.ad ?? 5]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function policy(s: Simulator, prefix = 22, port = 1) {return eq(entries(s), [['R1', g(port), '172.16.0.0', prefix, 5]]);}
function initial(s: Simulator) {return eq(entries(s), [['R1', g(0), '172.16.0.0', 22, 5], ['R1', g(1), '172.16.4.0', 22, 5]]);}
function adjacencies(s: Simulator) {
  return [['R1', 'R2', 1], ['R2', 'R3', 2]].every(([n, peer, port]) => get(s, n as string).runtime.neighbors.some(a => a.protocol === 'EIGRP' && a.deviceId === id(peer as string) && a.interface === g(port as number) && a.state === 'UP'));
}
function base(s: Simulator) {
  const pair = (a: string, ap: string, b: string, bp: string) => [id(a) + ':' + ap, id(b) + ':' + bp].sort().join('|');
  const expected = [pair('PC1', 'GigabitEthernet0', 'R1', g(0)), pair('PC2', 'GigabitEthernet0', 'R1', g(2)), pair('R1', g(1), 'R2', g(1)), pair('R2', g(2), 'R3', g(1)), pair('R3', g(0), 'SRV1', 'GigabitEthernet0')].sort();
  return s.lab.links.length === 5 && s.lab.links.every(l => l.enabled && !l.loss) && eq(s.lab.links.map(l => [l.a.deviceId + ':' + l.a.port, l.b.deviceId + ':' + l.b.port].sort().join('|')).sort(), expected) &&
    s.lab.devices.every(d => d.powered && !d.config.staticRoutes.length && Object.values(d.config.interfaces).every(p => !p.features.aclIn && !p.features.aclOut && !p.features.routeMap && !p.features.servicePolicyIn && !p.features.servicePolicyOut)) &&
    ['R1', 'R2', 'R3'].every((n, i) => {
      const d = get(s, n), p = d.config.protocols.eigrp, wanted = i === 0 ? ['10.0.12.0/30', '172.16.0.0/24', '172.16.1.0/24'] : i === 1 ? ['10.0.12.0/30', '10.0.23.0/30'] : ['10.0.23.0/30', '192.168.30.0/24'];
      return d.config.ipRouting && eq(Object.keys(d.config.protocols), ['eigrp']) && p?.asn === 100 && p.routerId === `${i + 1}.${i + 1}.${i + 1}.${i + 1}` && p.autoSummary === false &&
        eq((p.networks ?? []).map((a: any) => a.network + '/' + a.prefix).sort(), wanted) && eq(p.passiveInterfaces, ['default']) && eq(p.activeInterfaces, i === 1 ? [g(1), g(2)] : [g(1)]) &&
        !(p.redistribute ?? []).length && !(p.distributeLists ?? []).length && !Object.keys(p.summaryMetrics ?? {}).length && !p.defaultOriginate && !p.distance;
    }) && [[get(s, 'R1'), 0, '172.16.0.1'], [get(s, 'R1'), 2, '172.16.1.1'], [get(s, 'R1'), 1, '10.0.12.1'], [get(s, 'R2'), 1, '10.0.12.2'], [get(s, 'R2'), 2, '10.0.23.1'], [get(s, 'R3'), 1, '10.0.23.2'], [get(s, 'R3'), 0, '192.168.30.1']].every(([d, n, ip]) => {
      const a = d as Device, p = a.config.interfaces[g(n as number)]; return p.ip === ip && p.mask === ((ip as string).startsWith('10.') ? '255.255.255.252' : '255.255.255.0') && !p.switchport &&
        (a.id === id('R1') && n !== 1 || s.interfaceUp(a.id, p.name));
    }) && get(s, 'R1').config.interfaces[g(2)].features.delay === 30 && ['PC1', 'PC2', 'SRV1'].every((n, i) => {
      const d = get(s, n), p = d.config.interfaces.GigabitEthernet0, ip = i === 2 ? service : pcIP(i + 1), gw = i === 2 ? '192.168.30.1' : `172.16.${i}.1`;
      return p.adminUp && p.ip === ip && p.mask === '255.255.255.0' && !p.features.dhcp && d.config.defaultGateway === gw;
    }) && adjacencies(s);
}
function connected(s: Simulator, n: number) {return branch(s, 'R1').some(r => r.network === `172.16.${n - 1}.0` && r.prefix === 24 && r.protocol === 'connected' && r.interface === g(n === 1 ? 0 : 2));}
function discard(s: Simulator, prefix = 22, metric = 5120) {
  const a = summary(s); return a.length === 1 && a[0].network === '172.16.0.0' && a[0].prefix === prefix && a[0].interface === 'Null0' && a[0].ad === 5 && a[0].metric === metric;
}
function received(s: Simulator, prefix = 22, partial = false) {
  return ['R2', 'R3'].every((n, i) => {const a = branch(s, n); return a.length === 1 && a[0].network === '172.16.0.0' && a[0].prefix === prefix && a[0].protocol === 'D' && a[0].ad === 90 && a[0].metric === (partial ? i ? 15360 : 12800 : i ? 10240 : 7680) && a[0].interface === g(1) && a[0].nextHop === (i ? '10.0.23.1' : '10.0.12.1');});
}
function unsummarized(s: Simulator) {
  return ['R2', 'R3'].every((n, i) => {const a = branch(s, n); return a.length === 2 && [0, 1].every(k => a.some(r => r.network === `172.16.${k}.0` && r.prefix === 24 && r.protocol === 'D' && r.ad === 90 && r.metric === (i ? 10240 : 7680) + k * 5120));});
}
function healthy(s: Simulator) {
  const h = get(s, 'SRV1').config.services.http;
  return base(s) && policy(s) && connected(s, 1) && connected(s, 2) && discard(s) && received(s) && h?.enabled && (h.port ?? 80) === 80 && (h.authentication ?? 'none') === 'none' && !!h.content?.includes('ENARSI summarization: both branch LANs work');
}
type Attempt = {lab: object; epochs: Map<string, {signature: string; since: number}>; marks: Map<string, number>; earned: Set<Observed>};
const attempts = new WeakMap<Simulator, Attempt>();
function attempt(s: Simulator) {
  let a = attempts.get(s);
  if (!a || a.lab !== s.lab) {
    a = {lab: s.lab, epochs: new Map(), marks: new Map(), earned: new Set()}; attempts.set(s, a);
    const current = a, unsubscribe = s.subscribe(() => {
      if (s.lab !== current.lab) {unsubscribe(); return;}
      if (shape(s)) for (const check of observed) matchesSummaryTroubleshootingCriterion(s, get(s, 'R1'), {kind: 'sum-observe', device: id('R1'), check});
    });
  }
  return a;
}
function since(s: Simulator, key: string, ok: boolean) {
  const a = attempt(s); if (!ok) {a.epochs.delete(key); return;}
  const signature = JSON.stringify([s.lab.devices.map(d => [d.id, d.config]), ['R1', 'R2', 'R3'].map(n => branch(s, n).map(r => [r.network, r.prefix, r.protocol, r.ad, r.metric, r.interface]))]);
  const old = a.epochs.get(key); if (!old || old.signature !== signature) {const v = {signature, since: s.clock.now()}; a.epochs.set(key, v); return v.since;} return old.since;
}
function traffic(s: Simulator, at: number, n: number, reverse = false) {
  const from = reverse ? 'SRV1' : 'PC' + n, to = reverse ? 'PC' + n : 'SRV1', source = reverse ? service : pcIP(n), target = reverse ? pcIP(n) : service, requests = new Set<string>();
  const path = reverse ? [['R3', 1], ['R2', 1], ['R1', n === 1 ? 0 : 2]] : [['R1', 1], ['R2', 2], ['R3', 0]];
  for (const e of s.events) {
    const p = e.packet; if (e.time <= at || e.nodeId !== id(from) || e.label !== 'Echo reply received' || p?.source !== target || p.destination !== source || !p.parentId) continue;
    if (!s.events.some(x => x.time > at && x.nodeId === id(to) && x.label === 'Echo request accepted' && x.packet?.id === p.parentId)) continue;
    if (!path.every(([name, port]) => s.events.some(x => x.time > at && x.nodeId === id(name as string) && x.port === g(port as number) && x.label === 'Frame sent' && x.packet?.id === p.parentId))) continue;
    requests.add(p.parentId);
  }
  return requests.size >= 3;
}
const both = (s: Simulator, at: number) => traffic(s, at, 1) && traffic(s, at, 2);
function dropped(s: Simulator, at: number, target: string, atNull: boolean) {
  const requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet; if (e.time <= at || e.nodeId !== id(atNull ? 'R1' : 'R3') || e.label !== (atNull ? 'Null route' : 'No route') || e.disposition !== 'drop' || p?.messageType !== 'echo-request' || p.source !== service || p.destination !== target) continue;
    if (atNull && ![['R3', 1], ['R2', 1]].every(([n, port]) => s.events.some(x => x.time > at && x.nodeId === id(n as string) && x.port === g(port as number) && x.label === 'Frame sent' && x.packet?.id === p.id))) continue;
    if (s.events.some(x => x.time > at && x.packet?.id === p.id && x.label === 'TTL expired')) continue;
    requests.add(p.id);
  }
  return requests.size >= 3;
}
function web(s: Simulator, at: number, n: number) {
  return Object.entries<any>(get(s, 'PC' + n).runtime.features.tcpConnections ?? {}).some(([t, c]) => {
    if (c.remoteAddress !== service || c.remotePort !== 80 || c.payload?.application !== 'http' || c.payload.path !== '/' || !Number.isInteger(c.expected) || c.expected < 1 || c.expected > 2048 || c.received !== c.expected) return false;
    const r = get(s, 'SRV1').runtime.features.tcpConnections?.[t]; if (r?.source !== pcIP(n) || r.response?.statusCode !== 200) return false;
    try {const b = JSON.parse(Array.from({length: c.expected}, (_, i) => c.segments[i]).join('')); if (b.statusCode !== 200 || b.content !== r.response.content || !b.content.includes('ENARSI summarization: both branch LANs work')) return false;} catch {return false;}
    return s.events.some(e => e.time > at && e.nodeId === id('R2') && e.port === g(2) && e.label === 'Frame sent' && e.packet?.serviceTransaction === t && e.packet.source === pcIP(n));
  });
}
function evaluate(s: Simulator, d: Device, c: SummaryTroubleshootingCriterion): boolean {
  if (d.id !== id('R1') || !shape(s)) return false;
  if (c.kind === 'sum-live') switch (c.check) {
    case 'policy': return policy(s);
    case 'aggregate': return base(s) && policy(s) && connected(s, 1) && connected(s, 2) && discard(s) && received(s);
    case 'healthy': return healthy(s);
    case 'saved': return healthy(s) && ['R1', 'R2', 'R3'].every(n => eq(get(s, n).config, get(s, n).startupConfig));
  }
  const a = attempt(s), normal = healthy(s), core = base(s), configured = policy(s), ready = a.earned.has('traffic');
  const track = (key: string, ok: boolean, proof: (at: number) => boolean) => {const at = since(s, key, ok); if (at !== undefined && proof(at)) a.marks.set(key, s.clock.now()); return at;};
  const baseline = since(s, 'baseline', core && initial(s) && connected(s, 1) && connected(s, 2) && unsummarized(s) && !summary(s).some(r => r.network === '172.16.4.0'));
  track('narrow', ready && core && policy(s, 24) && connected(s, 1) && connected(s, 2) && unsummarized(s), at => both(s, at));
  track('placement', ready && core && policy(s, 22, 0) && connected(s, 1) && connected(s, 2) && unsummarized(s), at => both(s, at));
  track('broad', ready && core && policy(s, 16) && received(s, 16) && discard(s, 16), at => dropped(s, at, outside, true));
  track('partial', ready && core && configured && !get(s, 'R1').config.interfaces[g(0)].adminUp && get(s, 'R1').config.interfaces[g(2)].adminUp && !connected(s, 1) && connected(s, 2) && discard(s, 22, 10240) && received(s, 22, true), at => dropped(s, at, pcIP(1), true) && traffic(s, at, 2, true));
  track('withdrawal', ready && core && configured && !get(s, 'R1').config.interfaces[g(0)].adminUp && !get(s, 'R1').config.interfaces[g(2)].adminUp && !branch(s, 'R1').length && !branch(s, 'R2').length && !branch(s, 'R3').length, at => dropped(s, at, pcIP(1), false) && dropped(s, at, pcIP(2), false));
  const at = since(s, 'normal', normal);
  if (c.check === 'baseline') return baseline !== undefined && both(s, baseline);
  if (at === undefined) return false;
  if (c.check === 'traffic') return both(s, at) && traffic(s, at, 1, true) && traffic(s, at, 2, true);
  if (c.check === 'hole') return dropped(s, at, hole, true);
  if (c.check === 'http') return web(s, at, 1) && web(s, at, 2);
  const mark = a.marks.get(c.check); if (mark === undefined || at < mark) return false;
  const after = Math.max(at, mark);
  if (c.check === 'partial') return traffic(s, after, 1, true) && traffic(s, after, 2, true);
  return both(s, after) && (c.check !== 'broad' || dropped(s, after, outside, false));
}
export function matchesSummaryTroubleshootingCriterion(s: Simulator, d: Device, c: SummaryTroubleshootingCriterion): boolean {
  if (!validSummaryTroubleshootingCriterion(c) || d.id !== c.device || !shape(s)) return false;
  if (c.kind === 'sum-live') return evaluate(s, d, c);
  const a = attempt(s); if (a.earned.has(c.check)) return true; if (evaluate(s, d, c)) a.earned.add(c.check); return a.earned.has(c.check);
}
