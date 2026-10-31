import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
export const pbrLabId = (name: string) => 'device-pbr-' + name.toLowerCase();
const live = ['classifiers', 'policy', 'healthy', 'saved'] as const;
const observed = ['baseline', 'steered', 'exempt', 'unmatched', 'http', 'binding', 'acl', 'fallback', 'default-hop', 'local'] as const;
type Live = typeof live[number]; type Observed = typeof observed[number];
export type PBRCriterion = {kind: 'pbr-live'; device: string; check: Live} | {kind: 'pbr-observe'; device: string; check: Observed};
export function validPBRCriterion(c: any) {
  return !!c && typeof c.device === 'string' && c.device.length > 0 && c.device.length <= 128 &&
    (c.kind === 'pbr-live' ? (live as readonly string[]).includes(c.check) : c.kind === 'pbr-observe' && (observed as readonly string[]).includes(c.check));
}
const id = pbrLabId, g = (n: number) => 'GigabitEthernet0/' + n, get = (s: Simulator, n: string) => s.getDevice(id(n))!;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const service = '192.168.30.10', diagnostic = '198.51.100.1', pc1 = '192.168.10.10', pc2 = '192.168.20.10', hop = '10.0.13.2';
function shape(s: Simulator) {
  return s.lab.devices.length === 7 && ['R1', 'R2', 'R3', 'R4'].every(n => get(s, n)?.kind === 'router' && [0, 1, 2, 3].every(i => !!get(s, n)?.config.interfaces[g(i)])) &&
    ['PC1', 'PC2'].every(n => get(s, n)?.kind === 'pc' && !!get(s, n)?.config.interfaces.GigabitEthernet0) && get(s, 'SRV1')?.kind === 'server' && !!get(s, 'SRV1')?.config.interfaces.GigabitEthernet0 && !!get(s, 'R4')?.config.interfaces.Loopback0;
}
function classifiers(s: Simulator, source = pc1) {
  const a = get(s, 'R1').config.features.acls ?? {};
  const row = (e: any, seq: number, action: string, from: string, target: string) => e.sequence === seq && e.action === action && e.protocol === 'ip' && e.source === from && e.wildcard === '0.0.0.0' && e.destination === target && e.destinationWildcard === '0.0.0.0' && Object.keys(e).every(k => ['sequence', 'action', 'text', 'protocol', 'source', 'wildcard', 'destination', 'destinationWildcard'].includes(k));
  return Object.keys(a).length === 2 && a['PBR-SERVICE']?.type === 'extended' && a['PBR-SERVICE'].entries.length === 2 && row(a['PBR-SERVICE'].entries[0], 10, 'deny', pc2, service) && row(a['PBR-SERVICE'].entries[1], 20, 'permit', source, service) &&
    a['PBR-EXEMPT']?.type === 'extended' && a['PBR-EXEMPT'].entries.length === 1 && row(a['PBR-EXEMPT'].entries[0], 10, 'permit', pc1, diagnostic);
}
function maps(s: Simulator, defaultHop = false, local = false) {
  const a = Object.values<any>(get(s, 'R1').config.features.routeMaps ?? {}), user = a.filter(m => m.name === 'USER-PBR').sort((a, b) => a.sequence - b.sequence), loc = a.filter(m => m.name === 'LOCAL-PBR');
  return a.length === (local ? 3 : 2) && user.length === 2 && user[0].action === 'deny' && user[0].sequence === 10 && eq(user[0].match, ['ip address PBR-EXEMPT']) && !user[0].set.length && user[0].continue === undefined &&
    user[1].action === 'permit' && user[1].sequence === 20 && eq(user[1].match, ['ip address PBR-SERVICE']) && eq(user[1].set, [(defaultHop ? 'ip default next-hop ' : 'ip next-hop ') + hop]) && user[1].continue === undefined &&
    (!local || loc.length === 1 && loc[0].action === 'permit' && loc[0].sequence === 10 && !loc[0].match.length && eq(loc[0].set, ['ip next-hop ' + hop]) && loc[0].continue === undefined);
}
function bindings(s: Simulator, unbound1 = false) {
  const d = get(s, 'R1'); return Object.values(d.config.interfaces).every(p => p.features.routeMap === (p.name === g(3) || p.name === g(0) && !unbound1 ? 'USER-PBR' : undefined));
}
type RouteRow = [string, number, number, string];
function staticRoutes(d: Device, rows: RouteRow[]) {
  return d.config.staticRoutes.length === rows.length && rows.every(([network, prefix, port, nextHop]) => d.config.staticRoutes.some(r => r.network === network && r.prefix === prefix && r.interface === g(port) && r.nextHop === nextHop && (r.ad ?? 1) === 1 && !r.vrf && r.track === undefined && !r.permanent));
}
function base(s: Simulator, defaultRib = false, down = false) {
  const pair = (a: string, ap: string, b: string, bp: string) => [id(a) + ':' + ap, id(b) + ':' + bp].sort().join('|');
  const expected = [pair('PC1', 'GigabitEthernet0', 'R1', g(0)), pair('PC2', 'GigabitEthernet0', 'R1', g(3)), pair('R1', g(1), 'R2', g(1)), pair('R1', g(2), 'R3', g(1)), pair('R2', g(2), 'R4', g(1)), pair('R3', g(2), 'R4', g(2)), pair('R4', g(0), 'SRV1', 'GigabitEthernet0')].sort();
  const r1 = get(s, 'R1'), r2 = get(s, 'R2'), r3 = get(s, 'R3'), r4 = get(s, 'R4');
  if (!s.lab.devices.every(d => d.powered && Object.values(d.config.interfaces).every(p => !p.features.aclIn && !p.features.aclOut && !p.features.servicePolicyIn && !p.features.servicePolicyOut)) || s.lab.links.length !== 7 || !s.lab.links.every(l => l.enabled && !l.loss) || !eq(s.lab.links.map(l => [l.a.deviceId + ':' + l.a.port, l.b.deviceId + ':' + l.b.port].sort().join('|')).sort(), expected)) return false;
  if (![r1, r2, r3, r4].every(d => d.config.ipRouting && !Object.keys(d.config.protocols).length) || ![r2, r3, r4].every(d => !Object.keys(d.config.features.acls ?? {}).length && !Object.keys(d.config.features.routeMaps ?? {}).length && !d.config.features.localPolicy && Object.values(d.config.interfaces).every(p => !p.features.routeMap))) return false;
  if (!staticRoutes(r1, [[defaultRib ? '0.0.0.0' : '192.168.30.0', defaultRib ? 0 : 24, 1, '10.0.12.2'], [diagnostic, 32, 1, '10.0.12.2']]) ||
    !staticRoutes(r2, [['192.168.30.0', 24, 2, '10.0.24.2'], [diagnostic, 32, 2, '10.0.24.2'], ['192.168.10.0', 24, 1, '10.0.12.1'], ['192.168.20.0', 24, 1, '10.0.12.1']]) ||
    !staticRoutes(r3, [['192.168.30.0', 24, 2, '10.0.34.2'], [diagnostic, 32, 2, '10.0.34.2'], ['192.168.10.0', 24, 1, '10.0.13.1'], ['192.168.20.0', 24, 1, '10.0.13.1']]) ||
    !staticRoutes(r4, [['192.168.10.0', 24, 1, '10.0.24.1'], ['192.168.20.0', 24, 1, '10.0.24.1'], ['10.0.12.0', 30, 1, '10.0.24.1'], ['10.0.13.0', 30, 2, '10.0.34.1']])) return false;
  if (![[r1, 0, '192.168.10.1'], [r1, 3, '192.168.20.1'], [r1, 1, '10.0.12.1'], [r1, 2, '10.0.13.1'], [r2, 1, '10.0.12.2'], [r2, 2, '10.0.24.1'], [r3, 1, '10.0.13.2'], [r3, 2, '10.0.34.1'], [r4, 1, '10.0.24.2'], [r4, 2, '10.0.34.2'], [r4, 0, '192.168.30.1']].every(([d, n, ip]) => {
    const a = d as Device, p = a.config.interfaces[g(n as number)], except = down && (a === r1 && n === 2 || a === r3 && n === 1);
    return p.ip === ip && p.mask === ((ip as string).startsWith('192.') ? '255.255.255.0' : '255.255.255.252') && !p.switchport && (except || s.interfaceUp(a.id, p.name));
  })) return false;
  const ordinary = s.cefLookup(r1.id, service);
  return ordinary?.port === g(1) && ordinary.route.prefix === (defaultRib ? 0 : 24) && ordinary.target === '10.0.12.2' && r4.config.interfaces.Loopback0.ip === diagnostic && r4.config.interfaces.Loopback0.mask === '255.255.255.255' && s.interfaceUp(r4.id, 'Loopback0') &&
    ['PC1', 'PC2', 'SRV1'].every((n, i) => {const d = get(s, n), p = d.config.interfaces.GigabitEthernet0, net = [10, 20, 30][i]; return p.adminUp && p.ip === `192.168.${net}.10` && p.mask === '255.255.255.0' && !p.features.dhcp && d.config.defaultGateway === `192.168.${net}.1`;});
}
function healthy(s: Simulator) {
  const d = get(s, 'R1'), h = get(s, 'SRV1').config.services.http;
  return base(s) && classifiers(s) && maps(s) && bindings(s) && !d.config.features.localPolicy && h?.enabled && (h.port ?? 80) === 80 && (h.authentication ?? 'none') === 'none' && !!h.content?.includes('ENARSI PBR: selected and ordinary paths work');
}
type Attempt = {lab: object; epochs: Map<string, {signature: string; since: number}>; marks: Map<string, number>; earned: Set<Observed>};
const attempts = new WeakMap<Simulator, Attempt>();
function attempt(s: Simulator) {
  let a = attempts.get(s);
  if (!a || a.lab !== s.lab) {
    a = {lab: s.lab, epochs: new Map(), marks: new Map(), earned: new Set()}; attempts.set(s, a);
    const current = a, unsubscribe = s.subscribe(() => {if (s.lab !== current.lab) {unsubscribe(); return;} if (shape(s)) for (const check of observed) matchesPBRCriterion(s, get(s, 'R1'), {kind: 'pbr-observe', device: id('R1'), check});});
  }
  return a;
}
function since(s: Simulator, key: string, ok: boolean) {
  const a = attempt(s); if (!ok) {a.epochs.delete(key); return;}
  const signature = JSON.stringify(s.lab.devices.map(d => [d.id, d.config]));
  const old = a.epochs.get(key); if (!old || old.signature !== signature) {const v = {signature, since: s.clock.now()}; a.epochs.set(key, v); return v.since;} return old.since;
}
function traffic(s: Simulator, at: number, from = 'PC1', target = service, policy = true) {
  const source = from === 'PC1' ? pc1 : from === 'PC2' ? pc2 : '10.0.12.1', dest = target === diagnostic ? 'R4' : 'SRV1', via = policy ? 'R3' : 'R2', requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet; if (e.time <= at || e.nodeId !== id(from) || e.label !== 'Echo reply received' || p?.source !== target || p.destination !== source || !p.parentId) continue;
    const req = p.parentId;
    if (!s.events.some(x => x.time > at && x.nodeId === id(dest) && x.label === 'Echo request accepted' && x.packet?.id === req)) continue;
    if (!s.events.some(x => x.time > at && x.nodeId === id('R1') && x.port === g(policy ? 2 : 1) && x.label === 'Frame sent' && x.packet?.id === req) || !s.events.some(x => x.time > at && x.nodeId === id(via) && x.port === g(2) && x.label === 'Frame sent' && x.packet?.id === req)) continue;
    const policies = s.events.filter(x => x.time > at && x.nodeId === id('R1') && x.label === 'Policy routing' && x.packet?.id === req);
    const input = from === 'R1' ? 'local' : from === 'PC1' ? g(0) : g(3), name = from === 'R1' ? 'LOCAL-PBR' : 'USER-PBR';
    if (policy ? !policies.some(x => x.port === input && x.detail.startsWith(name + ' selected ') && x.detail.includes('next hop ' + hop)) : policies.length > 0) continue;
    requests.add(req);
  }
  return requests.size >= 3;
}
function web(s: Simulator, at: number, n: number) {
  const source = n === 1 ? pc1 : pc2;
  return Object.entries<any>(get(s, 'PC' + n).runtime.features.tcpConnections ?? {}).some(([t, c]) => {
    if (c.remoteAddress !== service || c.remotePort !== 80 || c.payload?.application !== 'http' || c.payload.path !== '/' || !Number.isInteger(c.expected) || c.expected < 1 || c.expected > 2048 || c.received !== c.expected) return false;
    const r = get(s, 'SRV1').runtime.features.tcpConnections?.[t]; if (r?.source !== source || r.response?.statusCode !== 200) return false;
    try {const b = JSON.parse(Array.from({length: c.expected}, (_, i) => c.segments[i]).join('')); if (b.statusCode !== 200 || b.content !== r.response.content || !b.content.includes('ENARSI PBR: selected and ordinary paths work')) return false;} catch {return false;}
    return s.events.some(e => e.time > at && e.nodeId === id('R1') && e.port === g(n === 1 ? 2 : 1) && e.label === 'Frame sent' && e.packet?.serviceTransaction === t && e.packet.source === source &&
      (n === 1 ? s.events.some(x => x.nodeId === id('R1') && x.label === 'Policy routing' && x.packet?.id === e.packet!.id) : !s.events.some(x => x.nodeId === id('R1') && x.label === 'Policy routing' && x.packet?.id === e.packet!.id)));
  });
}
function evaluate(s: Simulator, d: Device, c: PBRCriterion): boolean {
  if (d.id !== id('R1') || !shape(s)) return false;
  if (c.kind === 'pbr-live') switch (c.check) {
    case 'classifiers': return classifiers(s);
    case 'policy': return maps(s) && bindings(s) && !d.config.features.localPolicy;
    case 'healthy': return healthy(s);
    case 'saved': return healthy(s) && ['R1', 'R2', 'R3', 'R4'].every(n => eq(get(s, n).config, get(s, n).startupConfig));
  }
  const a = attempt(s), normal = healthy(s), ready = a.earned.has('steered'), noLocal = !d.config.features.localPolicy;
  const track = (key: string, ok: boolean, proof: (at: number) => boolean) => {const at = since(s, key, ok); if (at !== undefined && proof(at)) a.marks.set(key, s.clock.now()); return at;};
  const initial = since(s, 'initial', base(s) && !Object.keys(d.config.features.acls ?? {}).length && !Object.keys(d.config.features.routeMaps ?? {}).length && Object.values(d.config.interfaces).every(p => !p.features.routeMap) && noLocal);
  track('binding', ready && base(s) && classifiers(s) && maps(s) && bindings(s, true) && noLocal, at => traffic(s, at, 'PC1', service, false));
  track('acl', ready && base(s) && classifiers(s, '192.168.10.99') && maps(s) && bindings(s) && noLocal, at => traffic(s, at, 'PC1', service, false));
  track('fallback', ready && base(s, false, true) && classifiers(s) && maps(s) && bindings(s) && noLocal && !d.config.interfaces[g(2)].adminUp, at => traffic(s, at, 'PC1', service, false));
  track('default-explicit', ready && base(s) && classifiers(s) && maps(s, true) && bindings(s) && noLocal, at => traffic(s, at, 'PC1', service, false));
  track('default-used', ready && a.marks.has('default-explicit') && base(s, true) && classifiers(s) && maps(s, true) && bindings(s) && noLocal, at => traffic(s, at));
  track('router-normal', ready && normal, at => traffic(s, at, 'R1', service, false));
  track('router-policy', ready && a.marks.has('router-normal') && base(s) && classifiers(s) && maps(s, false, true) && bindings(s) && d.config.features.localPolicy === 'LOCAL-PBR', at => traffic(s, at, 'R1'));
  const at = since(s, 'normal', normal);
  if (c.check === 'baseline') return initial !== undefined && traffic(s, initial, 'PC1', service, false) && traffic(s, initial, 'PC2', service, false);
  if (at === undefined) return false;
  if (c.check === 'steered') return traffic(s, at) && (d.runtime.features.pbrCounters?.['USER-PBR']?.[20]?.selected ?? 0) >= 3;
  if (c.check === 'exempt') return traffic(s, at, 'PC1', diagnostic, false) && (d.runtime.features.pbrCounters?.['USER-PBR']?.[10]?.matched ?? 0) >= 3;
  if (c.check === 'unmatched') return traffic(s, at, 'PC2', service, false);
  if (c.check === 'http') return web(s, at, 1) && web(s, at, 2);
  const key = c.check === 'default-hop' ? 'default-used' : c.check === 'local' ? 'router-policy' : c.check, mark = a.marks.get(key);
  return mark !== undefined && at >= mark && traffic(s, Math.max(at, mark));
}
export function matchesPBRCriterion(s: Simulator, d: Device, c: PBRCriterion): boolean {
  if (!validPBRCriterion(c) || d.id !== c.device || !shape(s)) return false;
  if (c.kind === 'pbr-live') return evaluate(s, d, c);
  const a = attempt(s); if (a.earned.has(c.check)) return true; if (evaluate(s, d, c)) a.earned.add(c.check); return a.earned.has(c.check);
}
