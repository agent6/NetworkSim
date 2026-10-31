import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';

export const loopPreventionLabId = (name: string) => 'device-lp-' + name.toLowerCase();
const live = ['guard', 'forwarding', 'healthy', 'saved'] as const;
const observed = ['baseline', 'loop', 'discard', 'specific', 'outage', 'specific-repair', 'guard-repair', 'http'] as const;
type Live = typeof live[number];
type Observed = typeof observed[number];
export type LoopPreventionCriterion =
  | {kind: 'lp-live'; device: string; check: Live}
  | {kind: 'lp-observe'; device: string; check: Observed};
export function validLoopPreventionCriterion(c: any) {
  return !!c && typeof c.device === 'string' && c.device.length > 0 && c.device.length <= 128 &&
    (c.kind === 'lp-live' ? (live as readonly string[]).includes(c.check) : c.kind === 'lp-observe' && (observed as readonly string[]).includes(c.check));
}
const id = loopPreventionLabId, g = (n: number) => 'GigabitEthernet0/' + n;
const get = (s: Simulator, n: string) => s.getDevice(id(n))!;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const service = '192.168.32.10', hole = '192.168.35.10', client = '192.168.10.10';
const route = (d: Device, network: string, prefix: number, port: string, nextHop?: string, ad = 1) =>
  d.config.staticRoutes.some(r => r.network === network && r.prefix === prefix && r.interface === port && r.nextHop === nextHop && (r.ad ?? 1) === ad && !r.vrf && !r.track && !r.permanent);
const guard = (s: Simulator) => route(get(s, 'R2'), '192.168.32.0', 22, 'Null0', undefined, 250);
const wrong = (s: Simulator) => route(get(s, 'R2'), '192.168.32.0', 24, g(1), '10.0.12.1');
function shape(s: Simulator) {
  return s.lab.devices.length === 4 && ['R1', 'R2'].every(n => get(s, n)?.kind === 'router' && [0, 1].every(i => !!get(s, n)?.config.interfaces[g(i)])) &&
    get(s, 'PC1')?.kind === 'pc' && get(s, 'SRV1')?.kind === 'server' &&
    ['PC1', 'SRV1'].every(n => !!get(s, n)?.config.interfaces.GigabitEthernet0);
}
function base(s: Simulator) {
  return route(get(s, 'R1'), '192.168.32.0', 22, g(1), '10.0.12.2') &&
    route(get(s, 'R2'), '0.0.0.0', 0, g(1), '10.0.12.1') &&
    [get(s, 'R1'), get(s, 'R2')].every(d => d.config.ipRouting && !Object.keys(d.config.protocols).length) &&
    [[get(s, 'R1'), 0, '192.168.10.1'], [get(s, 'R1'), 1, '10.0.12.1'], [get(s, 'R2'), 1, '10.0.12.2']].every(([d, n, ip]) => {
      const a = d as Device, p = a.config.interfaces[g(n as number)];
      return p.ip === ip && p.mask === ((ip as string).startsWith('192.') ? '255.255.255.0' : '255.255.255.252') && !p.switchport && s.interfaceUp(a.id, p.name);
    }) && ['PC1', 'SRV1'].every((n, i) => {
      const d = get(s, n), p = d.config.interfaces.GigabitEthernet0, net = i ? 32 : 10;
      return d.powered && p.ip === `192.168.${net}.10` && p.mask === '255.255.255.0' && !p.features.dhcp && d.config.defaultGateway === `192.168.${net}.1`;
    }) && get(s, 'R2').config.interfaces[g(0)].ip === '192.168.32.1' &&
    get(s, 'R2').config.interfaces[g(0)].mask === '255.255.255.0' && !get(s, 'R2').config.interfaces[g(0)].switchport &&
    s.lab.links.length === 3 && s.lab.links.every(l => l.enabled && !l.loss) &&
    s.lab.devices.every(d => Object.values(d.config.interfaces).every(p => !p.features.aclIn && !p.features.aclOut && !p.features.routeMap && !p.features.servicePolicyIn && !p.features.servicePolicyOut));
}
function selected(s: Simulator, n: string, target: string, port: string, network: string, prefix: number) {
  const a = s.cefLookup(id(n), target);
  return a?.port === port && a.route.network === network && a.route.prefix === prefix;
}
function forwarding(s: Simulator) {
  return base(s) && guard(s) && selected(s, 'R1', service, g(1), '192.168.32.0', 22) &&
    selected(s, 'R1', hole, g(1), '192.168.32.0', 22) && selected(s, 'R2', service, g(0), '192.168.32.0', 24) &&
    selected(s, 'R2', hole, 'Null0', '192.168.32.0', 22) && selected(s, 'R2', client, g(1), '0.0.0.0', 0);
}
function healthy(s: Simulator) {
  const h = get(s, 'SRV1').config.services.http;
  return forwarding(s) && get(s, 'R1').config.staticRoutes.length === 1 && get(s, 'R2').config.staticRoutes.length === 2 &&
    s.lab.devices.every(d => d.powered) && s.interfaceUp(id('R2'), g(0)) && s.interfaceUp(id('SRV1'), 'GigabitEthernet0') &&
    h?.enabled && (h.port ?? 80) === 80 && (h.authentication ?? 'none') === 'none' && !!h.content?.includes('ENARSI loop prevention: service available');
}
type Attempt = {lab: object; epochs: Map<string, {signature: string; since: number}>; marks: Map<string, number>; earned: Set<Observed>};
const attempts = new WeakMap<Simulator, Attempt>();
function attempt(s: Simulator) {
  let a = attempts.get(s);
  if (!a || a.lab !== s.lab) {
    a = {lab: s.lab, epochs: new Map(), marks: new Map(), earned: new Set()}; attempts.set(s, a);
    const current = a, unsubscribe = s.subscribe(() => {
      if (s.lab !== current.lab) {unsubscribe(); return;}
      if (shape(s)) for (const check of observed) matchesLoopPreventionCriterion(s, get(s, 'R1'), {kind: 'lp-observe', device: id('R1'), check});
    });
  }
  return a;
}
function since(s: Simulator, key: string, ok: boolean) {
  const a = attempt(s);
  if (!ok) {a.epochs.delete(key); return;}
  const signature = JSON.stringify(s.lab.devices.map(d => [d.id, d.powered, d.config]));
  const old = a.epochs.get(key);
  if (!old || old.signature !== signature) {const v = {signature, since: s.clock.now()}; a.epochs.set(key, v); return v.since;}
  return old.since;
}
// Require the same real request to revisit both routers, expire, and return an error to its origin.
function looped(s: Simulator, at: number, target: string) {
  const requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet;
    if (e.time <= at || e.label !== 'TTL expired' || e.disposition !== 'drop' || ![id('R1'), id('R2')].includes(e.nodeId ?? '') || p?.messageType !== 'echo-request' || p.source !== client || p.destination !== target) continue;
    if (!['R1', 'R2'].every(n => s.events.filter(x => x.time > at && x.nodeId === id(n) && x.port === g(1) && x.label === 'Frame sent' && x.packet?.id === p.id).length >= 2)) continue;
    if (s.events.some(x => x.time > at && x.nodeId === id('PC1') && x.label === 'ICMP error received' && x.packet?.parentId === p.id && x.packet.icmpType === 11 && x.packet.icmpCode === 0)) requests.add(p.id);
  }
  return requests.size >= 3;
}
function discarded(s: Simulator, at: number, target: string) {
  const requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet;
    if (e.time <= at || e.nodeId !== id('R2') || e.label !== 'Null route' || e.disposition !== 'drop' || p?.messageType !== 'echo-request' || p.source !== client || p.destination !== target) continue;
    if (!s.events.some(x => x.time > at && x.nodeId === id('R1') && x.port === g(1) && x.label === 'Frame sent' && x.packet?.id === p.id)) continue;
    if (s.events.some(x => x.time > at && x.packet?.id === p.id && (x.label === 'TTL expired' || x.nodeId === id('R2') && x.port === g(1) && x.label === 'Frame sent'))) continue;
    requests.add(p.id);
  }
  return requests.size >= 3;
}
function delivered(s: Simulator, at: number) {
  const requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet;
    if (e.time <= at || e.nodeId !== id('PC1') || e.label !== 'Echo reply received' || p?.source !== service || p.destination !== client || !p.parentId) continue;
    if (!s.events.some(x => x.time > at && x.nodeId === id('SRV1') && x.label === 'Echo request accepted' && x.packet?.id === p.parentId)) continue;
    if (![['R1', 1], ['R2', 0]].every(([n, i]) => s.events.some(x => x.time > at && x.nodeId === id(n as string) && x.port === g(i as number) && x.label === 'Frame sent' && x.packet?.id === p.parentId))) continue;
    requests.add(p.parentId);
  }
  return requests.size >= 3;
}
function web(s: Simulator, at: number) {
  return Object.entries<any>(get(s, 'PC1').runtime.features.tcpConnections ?? {}).some(([t, c]) => {
    if (c.remoteAddress !== service || c.remotePort !== 80 || c.payload?.application !== 'http' || c.payload.path !== '/' || !Number.isInteger(c.expected) || c.expected < 1 || c.expected > 2048 || c.received !== c.expected) return false;
    const r = get(s, 'SRV1').runtime.features.tcpConnections?.[t];
    if (r?.source !== client || r.response?.statusCode !== 200) return false;
    try {const body = JSON.parse(Array.from({length: c.expected}, (_, i) => c.segments[i]).join('')); if (body.statusCode !== 200 || body.content !== r.response.content || !body.content.includes('ENARSI loop prevention: service available')) return false;} catch {return false;}
    return s.events.some(e => e.time > at && e.nodeId === id('R2') && e.port === g(0) && e.label === 'Frame sent' && e.packet?.serviceTransaction === t && e.packet.source === client);
  });
}
function evaluate(s: Simulator, d: Device, c: LoopPreventionCriterion): boolean {
  if (d.id !== id('R1') || !shape(s)) return false;
  if (c.kind === 'lp-live') switch (c.check) {
    case 'guard': return guard(s);
    case 'forwarding': return forwarding(s);
    case 'healthy': return healthy(s);
    case 'saved': return healthy(s) && ['R1', 'R2'].every(n => eq(get(s, n).config, get(s, n).startupConfig));
  }
  const a = attempt(s), normal = healthy(s), noGuard = base(s) && !guard(s) && !wrong(s) && get(s, 'R1').config.staticRoutes.length === 1 && get(s, 'R2').config.staticRoutes.length === 1 && s.interfaceUp(id('R2'), g(0));
  const track = (key: string, ok: boolean, proof: (at: number) => boolean) => {
    const at = since(s, key, ok); if (at !== undefined && proof(at)) a.marks.set(key, s.clock.now()); return at;
  };
  const initial = track('initial', noGuard && !a.earned.has('discard'), at => looped(s, at, hole));
  track('outage', base(s) && guard(s) && !wrong(s) && a.earned.has('specific') && !get(s, 'R2').config.interfaces[g(0)].adminUp && !s.interfaceUp(id('R2'), g(0)) && !get(s, 'R2').runtime.routes.some(r => r.network === '192.168.32.0' && r.prefix === 24) && selected(s, 'R2', service, 'Null0', '192.168.32.0', 22), at => discarded(s, at, service));
  track('bad-specific', base(s) && guard(s) && wrong(s) && a.earned.has('specific') && !get(s, 'R2').config.interfaces[g(0)].adminUp && !s.interfaceUp(id('R2'), g(0)) && selected(s, 'R2', service, g(1), '192.168.32.0', 24), at => looped(s, at, service));
  track('missing-guard', noGuard && a.earned.has('discard'), at => looped(s, at, hole));
  const at = since(s, 'normal', normal);
  if (c.check === 'baseline') return initial !== undefined && delivered(s, initial);
  if (c.check === 'loop') return a.marks.has('initial');
  if (at === undefined) return false;
  if (c.check === 'discard') return discarded(s, at, hole);
  if (c.check === 'specific') return delivered(s, at);
  if (c.check === 'http') return web(s, at);
  const key = c.check === 'outage' ? 'outage' : c.check === 'specific-repair' ? 'bad-specific' : 'missing-guard', mark = a.marks.get(key);
  return mark !== undefined && at >= mark && delivered(s, Math.max(at, mark)) && (c.check !== 'guard-repair' || discarded(s, Math.max(at, mark), hole));
}
export function matchesLoopPreventionCriterion(s: Simulator, d: Device, c: LoopPreventionCriterion): boolean {
  if (!validLoopPreventionCriterion(c) || d.id !== c.device || !shape(s)) return false;
  if (c.kind === 'lp-live') return evaluate(s, d, c);
  const a = attempt(s); if (evaluate(s, d, c)) a.earned.add(c.check); return a.earned.has(c.check);
}
