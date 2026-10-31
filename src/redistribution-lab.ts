import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {ospfLiveDetail} from './ospf-packets.ts';

export const redistributionLabId = (name: string) => 'device-rd-' + name.toLowerCase();
const live = ['export', 'seed', 'external', 'healthy', 'saved'] as const;
const observed = ['diagnose', 'oneway', 'traffic', 'scope', 'seed-repair', 'filter-repair', 'source-repair', 'metric', 'http'] as const;
type Live = typeof live[number];
type Observed = typeof observed[number];
export type RedistributionCriterion = {kind: 'rd-live'; device: string; check: Live} | {kind: 'rd-observe'; device: string; check: Observed};
export function validRedistributionCriterion(c: any) {
  return !!c && typeof c.device === 'string' && c.device.length > 0 && c.device.length <= 128 &&
    (c.kind === 'rd-live' ? (live as readonly string[]).includes(c.check) : c.kind === 'rd-observe' && (observed as readonly string[]).includes(c.check));
}
const id = redistributionLabId, g = (n: number) => 'GigabitEthernet0/' + n;
const get = (s: Simulator, n: string) => s.getDevice(id(n))!;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const client = '192.168.10.10', service = '192.168.30.10', diagnostic = '198.51.100.1';
const routes = (s: Simulator, n: string, network: string, prefix = 24) => get(s, n).runtime.routes.filter(r => r.network === network && r.prefix === prefix && !r.vrf);
function shape(s: Simulator) {
  return s.lab.devices.length === 5 && ['R1', 'R2', 'R3'].every(n => get(s, n)?.kind === 'router' && [0, 1, 2].every(i => !!get(s, n)?.config.interfaces[g(i)])) &&
    get(s, 'PC1')?.kind === 'pc' && get(s, 'SRV1')?.kind === 'server' && ['PC1', 'SRV1'].every(n => !!get(s, n)?.config.interfaces.GigabitEthernet0) && !!get(s, 'R3')?.config.interfaces.Loopback0;
}
function policies(s: Simulator, clientAction = 'permit') {
  const d = get(s, 'R2'), f = d.config.features, maps = Object.values<any>(f.routeMaps ?? {});
  return Object.keys(f.prefixLists ?? {}).length === 2 && maps.length === 2 &&
    [['RD-SERVICE', '192.168.30.0', 'permit'], ['RD-CLIENT', '192.168.10.0', clientAction]].every(([name, network, action]) => {
      const a = f.prefixLists?.[name]; return a?.length === 1 && a[0].sequence === 5 && a[0].network === network && a[0].prefix === 24 && a[0].action === action && a[0].ge === undefined && a[0].le === undefined;
    }) && [['EIGRP-TO-OSPF', 'RD-SERVICE', 100], ['OSPF-TO-EIGRP', 'RD-CLIENT', 200]].every(([name, prefix, tag]) => {
      const a = maps.filter(m => m.name === name); return a.length === 1 && a[0].action === 'permit' && a[0].sequence === 10 && eq(a[0].match, ['ip address prefix-list ' + prefix]) && eq(a[0].set, ['tag ' + tag]) && a[0].continue === undefined;
    });
}
function exportBound(s: Simulator, type = 2, source = 'eigrp') {
  const a = get(s, 'R2').config.protocols.ospf?.redistribute;
  return a?.length === 1 && a[0].protocol === source && a[0].processId === (source === 'eigrp' ? 100 : undefined) && a[0].metric === 20 && a[0].metricType === type && a[0].routeMap === 'EIGRP-TO-OSPF' && a[0].tag === undefined;
}
function returnBound(s: Simulator) {
  const a = get(s, 'R2').config.protocols.eigrp?.redistribute;
  return a?.length === 1 && a[0].protocol === 'ospf' && a[0].processId === 10 && a[0].routeMap === 'OSPF-TO-EIGRP' && a[0].metric === undefined && a[0].tag === undefined;
}
function seeded(s: Simulator) {
  const m = get(s, 'R2').config.protocols.eigrp?.defaultMetric;
  return !!m && typeof m === 'object' && m.bandwidth === 100000 && m.delay === 100 && m.reliability === 255 && m.load === 1 && m.mtu === 1500;
}
const unseeded = (s: Simulator) => get(s, 'R2').config.protocols.eigrp?.defaultMetric === undefined;
function adjacencies(s: Simulator) {
  const a = get(s, 'R2').runtime.neighbors;
  return a.some(n => n.protocol === 'OSPF' && n.deviceId === id('R1') && n.interface === g(1) && n.state === 'FULL') && a.some(n => n.protocol === 'EIGRP' && n.deviceId === id('R3') && n.interface === g(2) && n.state === 'UP');
}
function sources(s: Simulator) {
  return adjacencies(s) && routes(s, 'R2', '192.168.10.0').some(r => r.protocol === 'O' && r.ad === 110 && r.nextHop === '10.0.12.1') &&
    routes(s, 'R2', '192.168.30.0').some(r => r.protocol === 'D' && r.ad === 90 && r.nextHop === '10.0.23.2') &&
    routes(s, 'R2', diagnostic, 32).some(r => r.protocol === 'D' && r.nextHop === '10.0.23.2');
}
const external = (s: Simulator) => ospfLiveDetail(s, id('R1'), 'ospf')?.lsas.flatMap(l => l.prefixes).filter(p => p.kind === 'external' && p.endpoint.deviceId === id('R2')) ?? [];
function forward(s: Simulator, type = 2) {
  const a = routes(s, 'R1', '192.168.30.0'), e = external(s);
  return exportBound(s, type) && e.length === 1 && e[0].network === '192.168.30.0' && e[0].prefix === 24 && e[0].route?.metric === 20 && e[0].route?.tag === 100 && (e[0].route?.metricType ?? 2) === type &&
    a.length === 1 && a[0].protocol === 'O E' + type && a[0].ad === 110 && a[0].metric === (type === 1 ? 21 : 20) && a[0].tag === 100 && a[0].nextHop === '10.0.12.2' && a[0].interface === g(1) && !routes(s, 'R1', diagnostic, 32).length;
}
function returned(s: Simulator) {
  const a = routes(s, 'R3', '192.168.10.0');
  return returnBound(s) && seeded(s) && a.length === 1 && a[0].protocol === 'D EX' && a[0].ad === 170 && a[0].metric === 53760 && a[0].tag === 200 && a[0].nextHop === '10.0.23.1' && a[0].interface === g(1);
}
function base(s: Simulator) {
  return s.lab.devices.every(d => d.powered && !d.config.staticRoutes.length && Object.values(d.config.interfaces).every(p => !p.features.aclIn && !p.features.aclOut && !p.features.routeMap && !p.features.servicePolicyIn && !p.features.servicePolicyOut)) &&
    s.lab.links.length === 4 && s.lab.links.every(l => l.enabled && !l.loss) &&
    ['R1', 'R2', 'R3'].every((n, i) => {
      const d = get(s, n), keys = Object.keys(d.config.protocols).sort(), expected = i === 0 ? ['ospf'] : i === 1 ? ['eigrp', 'ospf'] : ['eigrp'];
      if (!d.config.ipRouting || !eq(keys, expected)) return false;
      return expected.every(k => {
        const p = d.config.protocols[k], nets = p.networks ?? [], wanted = k === 'ospf' ? i === 0 ? ['10.0.12.0/30', '192.168.10.0/24'] : ['10.0.12.0/30'] : i === 1 ? ['10.0.23.0/30'] : ['10.0.23.0/30', '192.168.30.0/24', diagnostic + '/32'];
        return p.routerId === `${i + 1}.${i + 1}.${i + 1}.${i + 1}` && (k === 'ospf' ? p.processId === 10 && nets.every((a: any) => String(a.area) === '0') : p.asn === 100 && p.autoSummary === false) &&
          eq(nets.map((a: any) => a.network + '/' + a.prefix).sort(), wanted.sort()) && eq(p.passiveInterfaces, ['default']) && eq(p.activeInterfaces, [g(i === 1 && k === 'eigrp' ? 2 : 1)]) && !(p.distributeLists ?? []).length && !p.defaultOriginate && !p.distance && (i === 1 || !(p.redistribute ?? []).length);
      });
    }) && [[get(s, 'R1'), 0, '192.168.10.1'], [get(s, 'R1'), 1, '10.0.12.1'], [get(s, 'R2'), 1, '10.0.12.2'], [get(s, 'R2'), 2, '10.0.23.1'], [get(s, 'R3'), 1, '10.0.23.2'], [get(s, 'R3'), 0, '192.168.30.1']].every(([d, n, ip]) => {
      const a = d as Device, p = a.config.interfaces[g(n as number)]; return p.ip === ip && p.mask === ((ip as string).startsWith('192.') ? '255.255.255.0' : '255.255.255.252') && !p.switchport && (a.id === id('R3') && n === 0 || s.interfaceUp(a.id, p.name));
    }) && ['PC1', 'SRV1'].every((n, i) => {const d = get(s, n), p = d.config.interfaces.GigabitEthernet0, net = i ? 30 : 10; return p.ip === `192.168.${net}.10` && p.mask === '255.255.255.0' && !p.features.dhcp && d.config.defaultGateway === `192.168.${net}.1`;}) &&
    get(s, 'R3').config.interfaces.Loopback0.ip === diagnostic && get(s, 'R3').config.interfaces.Loopback0.mask === '255.255.255.255' && s.interfaceUp(id('R3'), 'Loopback0');
}
function healthy(s: Simulator, type = 2) {
  const h = get(s, 'SRV1').config.services.http;
  return base(s) && policies(s) && sources(s) && forward(s, type) && returned(s) && s.interfaceUp(id('R3'), g(0)) && s.interfaceUp(id('SRV1'), 'GigabitEthernet0') &&
    h?.enabled && (h.port ?? 80) === 80 && (h.authentication ?? 'none') === 'none' && !!h.content?.includes('ENARSI redistribution: both directions work');
}
type Attempt = {lab: object; epochs: Map<string, {signature: string; since: number}>; marks: Map<string, number>; earned: Set<Observed>};
const attempts = new WeakMap<Simulator, Attempt>();
function attempt(s: Simulator) {
  let a = attempts.get(s);
  if (!a || a.lab !== s.lab) {
    a = {lab: s.lab, epochs: new Map(), marks: new Map(), earned: new Set()}; attempts.set(s, a);
    const current = a, unsubscribe = s.subscribe(() => {
      if (s.lab !== current.lab) {unsubscribe(); return;}
      if (shape(s)) for (const check of observed) matchesRedistributionCriterion(s, get(s, 'R1'), {kind: 'rd-observe', device: id('R1'), check});
    });
  }
  return a;
}
function since(s: Simulator, key: string, ok: boolean) {
  const a = attempt(s); if (!ok) {a.epochs.delete(key); return;}
  const signature = JSON.stringify([s.lab.devices.map(d => [d.id, d.config]), external(s).map(p => [p.network, p.prefix, p.route?.tag, p.route?.metric, p.route?.metricType]), ['R1', 'R2', 'R3'].map(n => get(s, n).runtime.routes.filter(r => ['192.168.30.0', '192.168.10.0', diagnostic].includes(r.network)).map(r => [r.network, r.prefix, r.protocol, r.metric, r.tag]))]);
  const old = a.epochs.get(key); if (!old || old.signature !== signature) {const v = {signature, since: s.clock.now()}; a.epochs.set(key, v); return v.since;} return old.since;
}
function traffic(s: Simulator, at: number, reverse = false) {
  const from = reverse ? 'SRV1' : 'PC1', to = reverse ? 'PC1' : 'SRV1', source = reverse ? service : client, target = reverse ? client : service, requests = new Set<string>();
  const path = reverse ? [['R3', 1], ['R2', 1], ['R1', 0]] : [['R1', 1], ['R2', 2], ['R3', 0]];
  for (const e of s.events) {
    const p = e.packet;
    if (e.time <= at || e.nodeId !== id(from) || e.label !== 'Echo reply received' || p?.source !== target || p.destination !== source || !p.parentId) continue;
    if (!s.events.some(x => x.time > at && x.nodeId === id(to) && x.label === 'Echo request accepted' && x.packet?.id === p.parentId)) continue;
    if (!path.every(([n, port]) => s.events.some(x => x.time > at && x.nodeId === id(n as string) && x.port === g(port as number) && x.label === 'Frame sent' && x.packet?.id === p.parentId))) continue;
    requests.add(p.parentId);
  }
  return requests.size >= 3;
}
function dropped(s: Simulator, at: number, target = service) {
  return new Set(s.events.filter(e => e.time > at && e.nodeId === id('R1') && e.label === 'No route' && e.disposition === 'drop' && e.packet?.messageType === 'echo-request' && e.packet.source === client && e.packet.destination === target).map(e => e.packet!.id)).size >= 3;
}
function oneWay(s: Simulator, at: number) {
  const requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet;
    if (e.time <= at || e.nodeId !== id('R3') || e.label !== 'No route' || e.disposition !== 'drop' || p?.messageType !== 'echo-reply' || p.source !== service || p.destination !== client || !p.parentId) continue;
    if (s.events.some(x => x.time > at && x.nodeId === id('SRV1') && x.label === 'Echo request accepted' && x.packet?.id === p.parentId) && s.events.some(x => x.time > at && x.nodeId === id('R2') && x.port === g(2) && x.label === 'Frame sent' && x.packet?.id === p.parentId)) requests.add(p.parentId);
  }
  return requests.size >= 3;
}
function diagnosticReplies(s: Simulator, at: number) {
  return new Set(s.events.filter(e => e.time > at && e.nodeId === id('R2') && e.label === 'Echo reply received' && e.packet?.source === diagnostic && e.packet.destination === '10.0.23.1' && e.packet.parentId && s.events.some(x => x.time > at && x.nodeId === id('R3') && x.label === 'Echo request accepted' && x.packet?.id === e.packet?.parentId)).map(e => e.packet!.parentId)).size >= 3;
}
function web(s: Simulator, at: number) {
  return Object.entries<any>(get(s, 'PC1').runtime.features.tcpConnections ?? {}).some(([t, c]) => {
    if (c.remoteAddress !== service || c.remotePort !== 80 || c.payload?.application !== 'http' || c.payload.path !== '/' || !Number.isInteger(c.expected) || c.expected < 1 || c.expected > 2048 || c.received !== c.expected) return false;
    const r = get(s, 'SRV1').runtime.features.tcpConnections?.[t]; if (r?.source !== client || r.response?.statusCode !== 200) return false;
    try {const b = JSON.parse(Array.from({length: c.expected}, (_, i) => c.segments[i]).join('')); if (b.statusCode !== 200 || b.content !== r.response.content || !b.content.includes('ENARSI redistribution: both directions work')) return false;} catch {return false;}
    return s.events.some(e => e.time > at && e.nodeId === id('R2') && e.port === g(2) && e.label === 'Frame sent' && e.packet?.serviceTransaction === t && e.packet.source === client);
  });
}
function evaluate(s: Simulator, d: Device, c: RedistributionCriterion): boolean {
  if (d.id !== id('R1') || !shape(s)) return false;
  if (c.kind === 'rd-live') switch (c.check) {
    case 'export': return policies(s) && exportBound(s);
    case 'seed': return policies(s) && returnBound(s) && seeded(s);
    case 'external': return base(s) && policies(s) && sources(s) && forward(s) && returned(s);
    case 'healthy': return healthy(s);
    case 'saved': return healthy(s) && ['R1', 'R2', 'R3'].every(n => eq(get(s, n).config, get(s, n).startupConfig));
  }
  const a = attempt(s), normal = healthy(s), boundary = base(s) && sources(s) && returnBound(s), absentReturn = !routes(s, 'R3', '192.168.10.0').length;
  const track = (key: string, ok: boolean, proof: (at: number) => boolean) => {const at = since(s, key, ok); if (at !== undefined && proof(at)) a.marks.set(key, s.clock.now()); return at;};
  const initial = since(s, 'initial', boundary && policies(s) && exportBound(s, 2, 'static') && unseeded(s) && !external(s).length && !routes(s, 'R1', '192.168.30.0').length && absentReturn);
  const one = since(s, 'oneway', boundary && policies(s) && forward(s) && unseeded(s) && absentReturn);
  track('seed', boundary && policies(s) && forward(s) && unseeded(s) && absentReturn && a.earned.has('traffic'), at => oneWay(s, at));
  track('filter', boundary && policies(s, 'deny') && forward(s) && seeded(s) && absentReturn && a.earned.has('traffic'), at => oneWay(s, at));
  track('source', base(s) && policies(s) && adjacencies(s) && exportBound(s) && returned(s) && a.earned.has('traffic') && !get(s, 'R3').config.interfaces[g(0)].adminUp && !routes(s, 'R2', '192.168.30.0').length && !routes(s, 'R1', '192.168.30.0').length && !external(s).length, at => dropped(s, at));
  track('e1', a.earned.has('traffic') && healthy(s, 1), at => traffic(s, at));
  const at = since(s, 'normal', normal);
  if (c.check === 'diagnose') return initial !== undefined && dropped(s, initial);
  if (c.check === 'oneway') return one !== undefined && oneWay(s, one);
  if (at === undefined) return false;
  if (c.check === 'traffic') return traffic(s, at) && traffic(s, at, true);
  if (c.check === 'scope') return diagnosticReplies(s, at) && dropped(s, at, diagnostic);
  if (c.check === 'http') return web(s, at);
  const key = c.check === 'seed-repair' ? 'seed' : c.check === 'filter-repair' ? 'filter' : c.check === 'source-repair' ? 'source' : 'e1', mark = a.marks.get(key);
  return mark !== undefined && at >= mark && traffic(s, Math.max(at, mark)) && (key === 'source' || key === 'e1' || traffic(s, Math.max(at, mark), true));
}
export function matchesRedistributionCriterion(s: Simulator, d: Device, c: RedistributionCriterion): boolean {
  if (!validRedistributionCriterion(c) || d.id !== c.device || !shape(s)) return false;
  if (c.kind === 'rd-live') return evaluate(s, d, c);
  const a = attempt(s); if (a.earned.has(c.check)) return true; if (evaluate(s, d, c)) a.earned.add(c.check); return a.earned.has(c.check);
}
