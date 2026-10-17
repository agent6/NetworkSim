import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../src/clock.ts';
import { Simulator } from '../src/engine.ts';
import { defaultInterface, type Device } from '../src/model.ts';
import { maskToPrefix, prefixContains, parseCidr } from '../src/ip.ts';
import type { TCPChannel } from '../src/tcp-channel.ts';

const g = (n: number) => 'GigabitEthernet0/' + n;
function ip(d: Device, port: string, address: string, mask = '255.255.255.0') { const c = d.config.interfaces[port] ??= defaultInterface(port); c.ip = address; c.mask = mask; c.features.dhcp = false; c.adminUp = true; c.switchport = false; }
function pair() { const s = new Simulator(7), a = s.addDevice('router'), b = s.addDevice('router'); ip(a, g(0), '10.0.0.1'); ip(b, g(0), '10.0.0.2'); s.connect({ deviceId: a.id, port: g(0) }, { deviceId: b.id, port: g(0) }); return { s, a, b }; }
function routed() {
  const s = new Simulator(42), a = s.addDevice('pc'), r = s.addDevice('router'), b = s.addDevice('server');
  ip(a, 'GigabitEthernet0', '10.1.0.10'); a.config.defaultGateway = '10.1.0.1';
  ip(r, g(0), '10.1.0.1'); ip(r, g(1), '10.2.0.1');
  ip(b, 'GigabitEthernet0', '10.2.0.20'); b.config.defaultGateway = '10.2.0.1';
  s.connect({ deviceId: a.id, port: 'GigabitEthernet0' }, { deviceId: r.id, port: g(0) }); s.connect({ deviceId: r.id, port: g(1) }, { deviceId: b.id, port: 'GigabitEthernet0' }); s.changed(); return { s, a, r, b };
}

test('clock orders equal timestamps and bounds runaway ordinary work', () => {
  const c = new SimulationClock(10), seen: number[] = [];
  c.schedule(5, () => seen.push(1)); c.schedule(5, () => seen.push(2)); c.advance(5);
  assert.deepEqual(seen, [1, 2]); assert.equal(c.now(), 5);
  const repeat = () => c.schedule(0, repeat); c.schedule(0, repeat);
  const outcome = c.advance(10, 20); assert.equal(outcome.processed, 20); assert.equal(outcome.budgetExhausted, true); assert.equal(c.now(), 5);
});
test('clock cancellation/reset inside executing interval prevents resurrection', () => {
  const c = new SimulationClock(); let count = 0;
  c.schedule(1, () => { count++; c.cancelOwner('r1'); }, { owner: 'r1', repeat: 1 }); c.advance(10);
  assert.equal(count, 1); assert.equal(c.pending(), 0);
  c.schedule(1, () => { count++; c.reset(); }, { repeat: 1 }); c.advance(10);
  assert.equal(count, 2); assert.equal(c.pending(), 0); assert.equal(c.now(), 0);
});
test('seed reset is reproducible and invalid timers fail explicitly', () => {
  const c = new SimulationClock(44), first = [c.random(), c.random()]; c.reset(); assert.deepEqual([c.random(), c.random()], first);
  assert.throws(() => c.schedule(NaN, () => {})); assert.throws(() => c.advance(-1)); assert.throws(() => c.schedule(1, () => {}, { repeat: 0 }));
});
test('IP parsing validates contiguous masks and IPv6 canonical prefix matching', () => {
  assert.equal(maskToPrefix('255.255.255.252'), 30); assert.throws(() => maskToPrefix('255.0.255.0'));
  assert.equal(parseCidr('2001:db8:1::1/64').network, '2001:db8:1::'); assert.equal(prefixContains('2001:db8:1::', 64, '2001:0db8:0001::abcd'), true);
});
test('direct echo uses ARP and real bidirectional packet events', () => {
  const { s, a } = pair(); const result = s.ping(a.id, '10.0.0.2', { count: 2 }); s.advance(5000);
  assert.equal(result.received, 2); assert.ok(s.events.some(e => e.protocol === 'ARP')); assert.ok(s.events.some(e => e.label === 'Echo reply received'));
  assert.ok(Object.values(a.runtime.arp).some(e => e.ip === '10.0.0.2')); assert.ok(s.events.filter(e => e.packet).every(e => e.packet!.id));
  assert.ok(s.events.some(e => e.packet?.icmpType === 8 && e.packet.icmpCode === 0)); assert.ok(s.events.some(e => e.packet?.icmpType === 0 && e.packet.parentId));
});
test('routing requires a usable return path and respects TTL', () => {
  const { s, a, b } = routed(); let result = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(5000); assert.equal(result.received, 1);
  result = s.ping(a.id, '10.2.0.20', { count: 1, ttl: 1 }); s.advance(5000); assert.match(result.replies[0].error!, /Time exceeded/); assert.equal(result.replies[0].from, '10.1.0.1');
  b.config.defaultGateway = undefined; s.changed(); result = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(5000); assert.equal(result.received, 0); assert.equal(result.replies[0].error, 'Request timed out');
});
test('traceroute reports routed hops from actual ICMP return packets', () => {
  const { s, a } = routed(); const trace = s.traceroute(a.id, '10.2.0.20'); s.advance(15000);
  assert.equal(trace.status, 'success'); assert.deepEqual(trace.hops.map(h => h.address), ['10.1.0.1', '10.2.0.20']);
});
test('DF cannot cross smaller egress MTU and non-DF fragments reassemble', () => {
  const { s, a, r } = routed(); r.config.interfaces[g(1)].mtu = 600; s.changed();
  const blocked = s.ping(a.id, '10.2.0.20', { count: 1, size: 1400, df: true }); s.advance(5000); assert.equal(blocked.received, 0); assert.match(blocked.replies[0].error!, /Fragmentation needed.*600/);
  const succeeds = s.ping(a.id, '10.2.0.20', { count: 1, size: 1400 }); s.advance(5000); assert.equal(succeeds.received, 1); assert.ok(s.events.some(e => e.label === 'IPv4 reassembled')); assert.ok(s.events.some(e => e.label === 'IPv4 fragment'));
});
test('VLAN switching learns source MACs and isolates access VLANs', () => {
  const s = new Simulator(), a = s.addDevice('pc'), sw = s.addDevice('switch'), b = s.addDevice('pc');
  ip(a, 'GigabitEthernet0', '192.168.1.10'); ip(b, 'GigabitEthernet0', '192.168.1.20');
  s.connect({ deviceId: a.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(1) }); s.connect({ deviceId: b.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(2) }); s.advance(35000);
  let result = s.ping(a.id, '192.168.1.20', { count: 1 }); s.advance(5000); assert.equal(result.received, 1); assert.ok(Object.keys(sw.runtime.mac).length >= 2);
  sw.config.vlans[20] = { id: 20, name: 'isolated', active: true }; sw.config.interfaces[g(2)].vlan = 20; s.changed(); s.advance(35000);
  result = s.ping(a.id, '192.168.1.20', { count: 1 }); s.advance(5000); assert.equal(result.received, 0);
});
test('extended ACL enforces protocol/address matching on actual ingress', () => {
  const { s, a, r } = routed(); r.config.features.acls = { BLOCK: { type: 'extended', entries: [{ sequence: 10, action: 'deny', protocol: 'icmp', source: 'any', destination: '10.2.0.20' }, { sequence: 20, action: 'permit', protocol: 'ip', source: 'any', destination: 'any' }] } }; r.config.interfaces[g(0)].features.aclIn = 'BLOCK'; s.changed();
  const result = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(5000); assert.equal(result.received, 0); assert.match(result.replies[0].error!, /Administratively/); assert.equal(r.runtime.features.aclHits['BLOCK:10'], 1);
});
test('PAT supplies a return path without an upstream route to inside network', () => {
  const { s, a, r, b } = routed(); b.config.defaultGateway = undefined;
  r.config.interfaces[g(0)].features.nat = 'inside'; r.config.interfaces[g(1)].features.nat = 'outside';
  r.config.features.acls = { INSIDE: { type: 'standard', entries: [{ sequence: 10, action: 'permit', source: '10.1.0.0', wildcard: '0.0.0.255' }] } };
  r.config.features.nat = { rules: [{ acl: 'INSIDE', interface: g(1), overload: true }], static: [], pools: {} }; s.changed();
  const result = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(5000); assert.equal(result.received, 1); assert.equal(r.runtime.features.natTranslations.length, 1); assert.ok(s.events.some(e => e.label === 'Destination NAT'));
});
test('IPv6 neighbors, forwarding and Packet Too Big are modeled independently', () => {
  const { s, a, r, b } = routed();
  a.config.interfaces.GigabitEthernet0.ipv6 = ['2001:db8:1::10/64']; r.config.interfaces[g(0)].ipv6 = ['2001:db8:1::1/64']; r.config.interfaces[g(1)].ipv6 = ['2001:db8:2::1/64']; b.config.interfaces.GigabitEthernet0.ipv6 = ['2001:db8:2::20/64']; r.config.ipv6Routing = true;
  a.config.staticRoutes.push({ network: '::', prefix: 0, nextHop: '2001:db8:1::1' }); b.config.staticRoutes.push({ network: '::', prefix: 0, nextHop: '2001:db8:2::1' }); s.changed();s.advance(1100);
  const works = s.ping(a.id, '2001:db8:2::20', { count: 1 }); s.advance(5000); assert.equal(works.received, 1); assert.ok(s.events.some(e => e.protocol === 'NDP'));
  const large = s.ping(a.id, '2001:db8:2::20', { count: 1, size: 1800 }); s.advance(5000); assert.equal(large.received, 0); assert.match(large.replies[0].error!, /Packet too big/);
});
test('DHCP, DNS and HTTP traverse links instead of using a topology shortcut', () => {
  const s = new Simulator(), pc = s.addDevice('pc'), sw = s.addDevice('switch'), server = s.addDevice('server'); ip(server, 'GigabitEthernet0', '192.0.2.1');
  server.config.services.dhcp = { enabled: true, pools: [{ name: 'LAN', network: '192.0.2.0', prefix: 24, defaultRouter: '192.0.2.1', dnsServers: ['192.0.2.1'] }], excluded: [{ start: '192.0.2.1', end: '192.0.2.9' }] };
  server.config.services.dns = { enabled: true, records: { 'lab.example': '192.0.2.1' } }; server.config.services.http = { enabled: true, content: '<h1>Original lab</h1>', files: { '/about': 'About the lab' } };
  s.connect({ deviceId: pc.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(1) }); const wire = s.connect({ deviceId: server.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(2) }); s.advance(35000);
  const lease = s.requestDHCP(pc.id); s.advance(5000); assert.equal(lease.status, 'success'); assert.equal(pc.config.interfaces.GigabitEthernet0.ip, '192.0.2.10');
  const page = s.httpRequest(pc.id, 'http://lab.example/about'); s.advance(15000); assert.equal(page.status, 'success'); assert.equal(page.body, 'About the lab'); assert.ok(s.events.some(e => e.protocol === 'TCP')); assert.ok(s.events.some(e => e.protocol === 'UDP'));
  s.disconnect(wire.id); const failed = s.httpRequest(pc.id, 'http://lab.example'); s.advance(15000); assert.equal(failed.status, 'failure');
});
test('portable labs preserve configuration but rebuild runtime and avoid duplicate IDs', () => {
  const { s, a } = pair(); a.startupConfig = structuredClone(a.config); a.config.hostname = 'UNSAVED-RUNNING'; const doc = s.serialize(); const fresh = new Simulator(); fresh.load(doc);
  assert.equal(fresh.getDevice(a.id)!.config.hostname, 'UNSAVED-RUNNING'); assert.equal(fresh.getDevice(a.id)!.startupConfig!.hostname, 'R1'); assert.equal(Object.keys(fresh.getDevice(a.id)!.runtime.arp).length, 0); const added = fresh.addDevice('pc'); assert.equal(fresh.lab.devices.filter(d => d.id === added.id).length, 1); assert.equal(fresh.seed, s.seed);
});
test('local IP pings select a source and never need a physical path', () => {
  const { s, a } = pair(); const result = s.ping(a.id, '10.0.0.1', { count: 1 }); s.advance(1000); assert.equal(result.received, 1);
});
test('missing access VLAN does not carry frames and sender reboot cancels in-flight delivery', () => {
  const s = new Simulator(), sw = s.addDevice('switch'); sw.config.interfaces[g(1)].vlan = 99; assert.equal(s.carriesVlan(sw, g(1), 99), false);
  const { s: wire, a, b } = pair(); const ping = wire.ping(a.id, '10.0.0.2', { count: 1 }); wire.advance(0); wire.power(a.id, false); wire.power(a.id, true); wire.advance(5000); assert.equal(ping.received, 0); assert.equal(wire.events.filter(e => e.nodeId === b.id && e.label === 'Frame received').length, 0);
});
test('GRE carries routed traffic over an independently routed underlay', () => {
  const s = new Simulator(), a = s.addDevice('router'), b = s.addDevice('router'); ip(a, g(0), '192.0.2.1'); ip(b, g(0), '192.0.2.2');
  for (const [d, address, destination] of [[a, '172.16.0.1', '192.0.2.2'], [b, '172.16.0.2', '192.0.2.1']] as const) { ip(d, 'Tunnel0', address); d.config.interfaces.Tunnel0.features = { tunnelSource: g(0), tunnelDestination: destination, tunnelKey: 17 }; }
  ip(b, 'Loopback0', '10.9.9.9', '255.255.255.255'); a.config.staticRoutes.push({ network: '10.9.9.9', prefix: 32, nextHop: '172.16.0.2' });
  s.connect({ deviceId: a.id, port: g(0) }, { deviceId: b.id, port: g(0) });
  const result = s.ping(a.id, '10.9.9.9', { count: 1 }); s.advance(5000); assert.equal(result.received, 1); assert.ok(s.events.some(e => e.label === 'GRE encapsulation')); assert.ok(s.events.some(e => e.label === 'GRE decapsulation'));
});
test('DHCP relay reaches a remote server and returns the client-subnet lease', () => {
  const { s, a, r, b } = routed(); a.config.interfaces.GigabitEthernet0.ip = undefined; a.config.interfaces.GigabitEthernet0.mask = undefined; a.config.defaultGateway = undefined;
  r.config.interfaces[g(0)].features.helpers = ['10.2.0.20']; b.config.services.dhcp = { enabled: true, pools: [{ name: 'REMOTE', network: '10.1.0.0', prefix: 24, defaultRouter: '10.1.0.1', dnsServers: ['10.2.0.20'] }], excluded: [{ start: '10.1.0.1', end: '10.1.0.9' }] }; s.changed();
  const result = s.requestDHCP(a.id, 'GigabitEthernet0'); s.advance(5000); assert.equal(result.status, 'success', result.error); assert.equal(a.config.interfaces.GigabitEthernet0.ip, '10.1.0.10');
});
test('NTP, syslog and block-based TFTP use routed service packets', () => {
  const { s, a, r, b } = routed(); b.config.services.ntp = { enabled: true, stratum: 2 }; b.config.features.clockOffset = 5000; b.config.services.syslog = { enabled: true }; r.config.services.tftp = { enabled: true, files: { 'startup.cfg': 'hostname original\n' + 'x'.repeat(1300) } }; a.config.features.logging = { hosts: ['10.2.0.20'], trap: 6 };
  const time = s.requestNTP(a.id, '10.2.0.20'); s.advance(5000); assert.equal(time.status, 'success'); assert.ok(Math.abs(time.offset - 5000) < 10); assert.equal(a.runtime.features.ntp.stratum, 3);
  s.log(a.id, 'Interface changed', 5); s.advance(1000); assert.equal(b.runtime.features.syslogReceived[0].message, 'Interface changed');
  const get = s.tftpGet(a.id, '10.2.0.1', 'startup.cfg'); s.advance(5000); assert.equal(get.status, 'success', get.error); assert.equal(get.content, r.config.services.tftp.files['startup.cfg']);
  const put = s.tftpPut(a.id, '10.2.0.1', 'backup.cfg', 'y'.repeat(1024)); s.advance(5000); assert.equal(put.status, 'success', put.error); assert.equal(r.config.services.tftp.files['backup.cfg'], 'y'.repeat(1024));
  const missing = s.tftpGet(a.id, '10.2.0.1', 'missing.cfg'); s.advance(5000); assert.equal(missing.status, 'failure'); assert.match(missing.error!, /File not found/);
});
test('DHCP snooping trust, DAI and IP source guard enforce learned bindings', () => {
  const s = new Simulator(), client = s.addDevice('pc'), sw = s.addDevice('switch'), server = s.addDevice('server'); ip(server, 'GigabitEthernet0', '192.0.2.1');
  server.config.services.dhcp = { enabled: true, pools: [{ name: 'LAN', network: '192.0.2.0', prefix: 24, defaultRouter: '192.0.2.1', dnsServers: [] }], excluded: [{ start: '192.0.2.1', end: '192.0.2.9' }] };
  sw.config.features.dhcpSnooping = { enabled: true, vlans: [1] }; sw.config.features.arpInspection = { vlans: [1] }; sw.config.interfaces[g(1)].features.sourceGuard = true;
  s.connect({ deviceId: client.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(1) }); s.connect({ deviceId: server.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(2) }); s.advance(35000);
  const denied = s.requestDHCP(client.id); s.advance(5000); assert.equal(denied.status, 'failure'); assert.ok(sw.runtime.features.dhcpSnoopingDrops > 0);
  sw.config.interfaces[g(2)].features.dhcpSnoopingTrust = true; sw.config.interfaces[g(2)].features.arpInspectionTrust = true; s.changed();
  const allowed = s.requestDHCP(client.id); s.advance(5000); assert.equal(allowed.status, 'success'); assert.equal(sw.runtime.features.dhcpBindings[0].ip, '192.0.2.10');
  const ping = s.ping(client.id, '192.0.2.1', { count: 1 }); s.advance(5000); assert.equal(ping.received, 1);
  client.config.interfaces.GigabitEthernet0.ip = '192.0.2.99'; s.changed(); const spoof = s.ping(client.id, '192.0.2.1', { count: 1 }); s.advance(5000); assert.equal(spoof.received, 0); assert.ok(sw.runtime.features.sourceGuardDrops > 0);
  client.runtime.arp = {}; s.ping(client.id, '192.0.2.1', { count: 1 }); s.advance(5000); assert.ok(sw.runtime.features.arpInspectionDrops > 0);
});
test('QoS token bucket drops excess bytes and marks conforming traffic', () => {
  const { s, a, r } = routed(); r.config.features.policyMaps = { LIMIT: { classes: [{ name: 'class-default', dscp: 46, police: { rate: 8, burst: 100 } }] } }; r.config.interfaces[g(0)].features.servicePolicyIn = 'LIMIT'; s.changed();
  const result = s.ping(a.id, '10.2.0.20', { count: 3, interval: 0, size: 100 }); s.advance(5000); assert.equal(result.received, 1); const stats = r.runtime.features.qosCounters['LIMIT:class-default:' + g(0) + ':in']; assert.equal(stats.dropped, 2); assert.ok(s.events.some(e => e.packet?.dscp === 46));
});
test('SPAN creates real mirrored capture frames and NetFlow exports flow records', () => {
  const s = new Simulator(), a = s.addDevice('pc'), sw = s.addDevice('switch'), b = s.addDevice('pc'), monitor = s.addDevice('pc'); ip(a, 'GigabitEthernet0', '192.0.2.10'); ip(b, 'GigabitEthernet0', '192.0.2.20');
  for (const [d, p] of [[a, 1], [b, 2], [monitor, 3]] as const) s.connect({ deviceId: d.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(p) });
  sw.config.features.spanSessions = { '1': { sources: [{ interface: g(1), direction: 'rx' }], destination: g(3) } }; s.changed(); s.advance(35000); const ping = s.ping(a.id, '192.0.2.20', { count: 1 }); s.advance(5000); assert.equal(ping.received, 1); assert.ok(monitor.runtime.features.capturedFrames.some((p: any) => p.protocol === 'ICMP')); assert.ok(sw.runtime.features.spanStats['1'].frames >= 2);
  const lab = routed(); lab.r.config.interfaces[g(0)].features.netflowIn = true; lab.r.config.features.netflow = { destination: '10.2.0.20', port: 2055 }; lab.b.config.services.netflow = { enabled: true }; lab.s.changed(); lab.s.ping(lab.a.id, '10.2.0.20', { count: 2 }); lab.s.advance(5000); assert.ok(lab.r.runtime.features.netflowCache[0].packets >= 1); assert.ok(lab.b.runtime.features.netflowReceived.some((f: any) => f.source === '10.1.0.10' && f.destination === '10.2.0.20'));
});
test('storm-control shutdown recovers only through its configured timer', () => {
  const s = new Simulator(), a = s.addDevice('pc'), sw = s.addDevice('switch'); ip(a, 'GigabitEthernet0', '192.0.2.10'); sw.config.interfaces[g(1)].features.stormControl = { broadcast: { rising: 0, falling: 0 }, action: 'shutdown' }; sw.config.features.errdisable = { causes: ['storm-control'], interval: 5 }; s.connect({ deviceId: a.id, port: 'GigabitEthernet0' }, { deviceId: sw.id, port: g(1) }); s.advance(35000); s.ping(a.id, '192.0.2.99', { count: 1 }); s.advance(1000); assert.equal(sw.config.interfaces[g(1)].features.errDisabled, true); s.advance(5000); assert.equal(sw.config.interfaces[g(1)].features.errDisabled, false);
});
test('TCP retries lost traffic, reassembles UTF8 response segments and executes once', () => {
  const { s, a, b } = routed(); let calls = 0;
  s.registerTCPService(2323, d => d.id === b.id, (_d, request) => { calls++; return { output: request.text + '🌐'.repeat(1600) }; });
  const warm = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(5000); assert.equal(warm.received, 1);
  for (const link of s.lab.links) link.loss = 0.15;
  const result = s.tcpRequest(a.id, '10.2.0.20', 2323, { text: 'network:' }); s.advance(10000);
  assert.equal(result.status, 'success', result.error); assert.equal(result.output, 'network:' + '🌐'.repeat(1600)); assert.equal(calls, 1); assert.ok(s.events.some(e => e.label === 'Transport retransmission'));
});
test('PBR selects a configured reachable next hop instead of ordinary connected egress', () => {
  const s = new Simulator(), client = s.addDevice('pc'), r = s.addDevice('router'), next = s.addDevice('router'), server = s.addDevice('server');
  ip(client, 'GigabitEthernet0', '10.1.0.10'); client.config.defaultGateway = '10.1.0.1'; ip(r, g(0), '10.1.0.1'); ip(r, g(1), '10.2.0.1'); ip(r, g(2), '10.3.0.1'); ip(next, g(0), '10.3.0.2'); ip(server, 'GigabitEthernet0', '10.2.0.20'); server.config.defaultGateway = '10.2.0.1';
  next.config.staticRoutes.push({ network: '10.2.0.0', prefix: 24, nextHop: '10.3.0.1' }, { network: '10.1.0.0', prefix: 24, nextHop: '10.3.0.1' });
  r.config.features.acls = { CLIENT: { type: 'standard', entries: [{ sequence: 10, action: 'permit', source: '10.1.0.10' }] } }; r.config.features.routeMaps = { 'STEER permit 10': { name: 'STEER', action: 'permit', sequence: 10, match: ['ip address CLIENT'], set: ['ip next-hop 10.3.0.2'] } }; r.config.interfaces[g(0)].features.routeMap = 'STEER';
  s.connect({ deviceId: client.id, port: 'GigabitEthernet0' }, { deviceId: r.id, port: g(0) }); s.connect({ deviceId: r.id, port: g(1) }, { deviceId: server.id, port: 'GigabitEthernet0' }); s.connect({ deviceId: r.id, port: g(2) }, { deviceId: next.id, port: g(0) });
  const ping = s.ping(client.id, '10.2.0.20', { count: 1 }); s.advance(5000); assert.equal(ping.received, 1); assert.ok(s.events.some(e => e.label === 'Policy routing')); assert.ok(s.events.some(e => e.nodeId === next.id && e.label === 'IP forwarded'));
});

test('SLAAC performs packet-driven RS/RA, waits for DAD, and learns a link-local default router', () => {
  const s = new Simulator(71), pc = s.addDevice('pc'), r = s.addDevice('router'), server = s.addDevice('server');
  const p = 'GigabitEthernet0'; r.config.ipv6Routing = true;
  r.config.interfaces[g(0)].adminUp = true; r.config.interfaces[g(0)].ipv6 = ['2001:db8:a::1/64']; r.config.interfaces[g(0)].features.ipv6LinkLocal = 'fe80::1234';
  r.config.interfaces[g(1)].adminUp = true; r.config.interfaces[g(1)].ipv6 = ['2001:db8:b::1/64'];
  server.config.interfaces[p].ipv6 = ['2001:db8:b::10/64']; server.config.staticRoutes.push({ network: '::', prefix: 0, nextHop: '2001:db8:b::1' });
  s.connect({ deviceId: pc.id, port: p }, { deviceId: r.id, port: g(0) }); s.connect({ deviceId: r.id, port: g(1) }, { deviceId: server.id, port: p });
  s.advance(1100);const result = s.requestIPv6(pc.id); s.advance(500); assert.equal(pc.config.interfaces[p].ipv6.length, 0); assert.equal(result.status, 'running');
  s.advance(1500); assert.equal(result.status, 'success'); assert.equal(pc.config.staticRoutes[0].nextHop, s.linkLocalAddress(r.id, g(0)));
  assert.equal(s.linkLocalAddress(r.id, g(0)), 'fe80::1234');
  const ping = s.ping(pc.id, '2001:db8:b::10', { count: 1 }); s.advance(5000); assert.equal(ping.received, 1); assert.ok(s.events.some(e => e.protocol === 'ICMPV6'));
});
test('DAD rejects an existing address instead of silently installing a duplicate', () => {
  const s = new Simulator(72), pc = s.addDevice('pc'), r = s.addDevice('router'), p = 'GigabitEthernet0';
  const host = s.linkLocalAddress(pc.id, p).replace(/^fe80::/, '2001:db8:a::');
  r.config.ipv6Routing = true; r.config.interfaces[g(0)].adminUp = true; r.config.interfaces[g(0)].ipv6 = [host + '/64'];
  s.connect({ deviceId: pc.id, port: p }, { deviceId: r.id, port: g(0) });
  s.advance(1100);const result = s.requestIPv6(pc.id); s.advance(4000); assert.equal(result.status, 'failure'); assert.match(result.error!, /Duplicate/); assert.deepEqual(pc.config.interfaces[p].ipv6, []);
});
test('DHCPv6 relay obtains stateful address, DNS and a unique delegated prefix over routed packets', () => {
  const s = new Simulator(73), a = s.addDevice('pc'), b = s.addDevice('router'), server = s.addDevice('server'), p = 'GigabitEthernet0';
  b.config.ipv6Routing = true; b.config.interfaces[g(0)].adminUp = true; b.config.interfaces[g(0)].ipv6 = ['2001:db8:a::1/64']; b.config.interfaces[g(0)].features.dhcpv6Relay = [{ destination: '2001:db8:b::10' }];
  b.config.interfaces[g(1)].adminUp = true; b.config.interfaces[g(1)].ipv6 = ['2001:db8:b::1/64']; server.config.interfaces[p].ipv6 = ['2001:db8:b::10/64'];
  server.config.staticRoutes.push({ network: '2001:db8:a::', prefix: 64, nextHop: '2001:db8:b::1' });
  server.config.services.dhcpv6 = { enabled: true, pools: [{ name: 'CLIENT', prefix: '2001:db8:a::/64', dnsServers: ['2001:db8:b::10'], domain: 'lab.test', delegatedPrefix: '2001:db8:100::/48', delegatedLength: 64 }] };
  s.connect({ deviceId: a.id, port: p }, { deviceId: b.id, port: g(0) }); s.connect({ deviceId: b.id, port: g(1) }, { deviceId: server.id, port: p });
  const result = s.requestDHCPv6(a.id, p, 'DELEGATED'); s.advance(4000);
  assert.equal(result.status, 'success', result.error); assert.match(result.address, /^2001:db8:a:/); assert.equal(a.config.dnsServers[0], '2001:db8:b::10'); assert.equal(a.config.features.delegatedPrefixes.DELEGATED.prefix, '2001:db8:100::/64');
  assert.ok(s.events.some(e => e.protocol === 'UDP' && e.nodeId === server.id)); assert.equal(server.runtime.features.dhcpv6ServerLeases.length, 1);
});
test('IPv6 RA guard and source guard protect a switched access link after DAD learning', () => {
  const s = new Simulator(74), pc = s.addDevice('pc'), sw = s.addDevice('switch'), r = s.addDevice('router'), rogue = s.addDevice('router'), p = 'GigabitEthernet0';
  for (const n of [1, 2, 3]) sw.config.interfaces[g(n)].features.portfast = true;
  r.config.ipv6Routing = true; r.config.interfaces[g(0)].adminUp = true; r.config.interfaces[g(0)].ipv6 = ['2001:db8:a::1/64'];
  rogue.config.ipv6Routing = true; rogue.config.interfaces[g(0)].adminUp = true; rogue.config.interfaces[g(0)].ipv6 = ['2001:db8:bad::1/64'];
  sw.config.interfaces[g(1)].features.ipv6SourceGuard = true; sw.config.interfaces[g(1)].features.ndInspection = true; sw.config.interfaces[g(3)].features.raGuard = true;
  s.connect({ deviceId: pc.id, port: p }, { deviceId: sw.id, port: g(1) }); s.connect({ deviceId: r.id, port: g(0) }, { deviceId: sw.id, port: g(2) }); s.connect({ deviceId: rogue.id, port: g(0) }, { deviceId: sw.id, port: g(3) }); s.advance(1100);
  const result = s.requestIPv6(pc.id); s.advance(2500); assert.equal(result.status, 'success'); assert.ok(pc.config.interfaces[p].ipv6.every(a => a.startsWith('2001:db8:a:'))); assert.ok(sw.runtime.features.raGuardDrops > 0);
  let ping = s.ping(pc.id, '2001:db8:a::1', { count: 1 }); s.advance(4000); assert.equal(ping.received, 1);
  s.sendControlDatagram(pc.id,'2001:db8:a::bad','2001:db8:a::1',9999,{forged:true},{interface:p});s.advance(100);assert.ok(sw.runtime.features.ipv6SourceGuardDrops>0);
});

test('VRF lookups isolate overlapping connected networks and CEF resolves the selected table', () => {
  const s = new Simulator(80), r = s.addDevice('router'), red = s.addDevice('router'), blue = s.addDevice('router');
  ip(r, g(0), '10.0.0.1'); r.config.interfaces[g(0)].vrf = 'RED'; ip(r, g(1), '10.0.0.1'); r.config.interfaces[g(1)].vrf = 'BLUE'; ip(red, g(0), '10.0.0.2'); ip(blue, g(0), '10.0.0.2');
  s.connect({ deviceId: r.id, port: g(0) }, { deviceId: red.id, port: g(0) }); s.connect({ deviceId: r.id, port: g(1) }, { deviceId: blue.id, port: g(0) });
  const result = s.ping(r.id, '10.0.0.2', { count: 1, vrf: 'BLUE' }); s.advance(1000); assert.equal(result.received, 1); assert.ok(s.events.some(e => e.nodeId === blue.id && e.label === 'Echo request accepted')); assert.ok(!s.events.some(e => e.nodeId === red.id && e.label === 'Echo request accepted'));
  assert.equal(s.cefLookup(r.id, '10.0.0.2', 'RED')?.port, g(0)); assert.equal(s.cefLookup(r.id, '10.0.0.2'), undefined);
});
test('IPv6 ACL CIDRs and deterministic UTC time ranges affect actual packet admission', () => {
  const { s, a, b } = pair(); a.config.interfaces[g(0)].ipv6 = ['2001:db8:a::1/64']; b.config.interfaces[g(0)].ipv6 = ['2001:db8:a::2/64'];
  b.config.features.timeRanges = { OPEN: { absolute: { start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 1) + 2000 } } };
  b.config.features.acls = { V6: { type: 'ipv6', entries: [{ sequence: 10, action: 'permit', protocol: 'icmpv6', source: '2001:db8:a::/64', destination: 'host 2001:db8:a::2', timeRange: 'OPEN' }] } }; b.config.interfaces[g(0)].features.ipv6AclIn = 'V6'; s.changed();s.advance(1100);
  let ping = s.ping(a.id, '2001:db8:a::2', { count: 1 }); s.advance(500); assert.equal(ping.received, 1);
  s.advance(1200); ping = s.ping(a.id, '2001:db8:a::2', { count: 1 }); s.advance(3000); assert.equal(ping.received, 0); assert.match(ping.replies[0].error!, /Administratively/); assert.equal(s.aclPermits(b.id, 'V6', '2001:db8:a::1', '2001:db8:a::2', 'icmpv6'), false);
});
test('configured static ARP survives learning and removes discovery from the ping path', () => {
  const { s, a, b } = pair(); a.config.features.staticArp = [{ ip: '10.0.0.2', mac: s.macOf(b.id, g(0)), interface: g(0) }]; b.config.features.staticArp = [{ ip: '10.0.0.1', mac: s.macOf(a.id, g(0)), interface: g(0) }]; s.changed();
  const ping = s.ping(a.id, '10.0.0.2', { count: 1 }); s.advance(2000); assert.equal(ping.received, 1); assert.ok(!s.events.some(e => e.protocol === 'ARP')); assert.equal(a.runtime.arp[g(0) + '|10.0.0.2'].static, true);
  s.sendGratuitousARP(b.id, g(0), '10.0.0.2', '00:aa:bb:cc:dd:ee'); s.advance(1); assert.equal(a.runtime.arp[g(0) + '|10.0.0.2'].mac, s.macOf(b.id, g(0)));
});

test('TFTP retries lost request, data and acknowledgement blocks without resetting the transfer', () => {
  const { s, a, b } = pair(); b.config.services.tftp = { enabled: true, files: { 'config.txt': 'configuration-line\n'.repeat(100) } }; s.lab.links[0].loss = 0.15;
  let result = s.tftpGet(a.id, '10.0.0.2', 'config.txt'); s.advance(10000); assert.equal(result.status, 'success', result.error); assert.equal(result.content, b.config.services.tftp.files['config.txt']);
  result = s.tftpPut(a.id, '10.0.0.2', 'upload.txt', 'upload\n'.repeat(100)); s.advance(10000); assert.equal(result.status, 'success', result.error); assert.equal(b.config.services.tftp.files['upload.txt'], 'upload\n'.repeat(100)); assert.ok(s.events.some(e => e.label === 'Transport retransmission'));
});
test('dynamic NAT allocates one pool address per inside host and reports pool exhaustion', () => {
  const s = new Simulator(81), a = s.addDevice('pc'), b = s.addDevice('pc'), r = s.addDevice('router'), srv = s.addDevice('server'), p = 'GigabitEthernet0';
  ip(a, p, '10.1.0.10'); a.config.defaultGateway = '10.1.0.1'; ip(b, p, '10.2.0.10'); b.config.defaultGateway = '10.2.0.1'; ip(r, g(0), '10.1.0.1'); ip(r, g(1), '10.2.0.1'); ip(r, g(2), '203.0.113.1'); ip(srv, p, '203.0.113.2');
  r.config.interfaces[g(0)].features.nat = 'inside'; r.config.interfaces[g(1)].features.nat = 'inside'; r.config.interfaces[g(2)].features.nat = 'outside';
  r.config.features.acls = { INSIDE: { type: 'standard', entries: [{ sequence: 1, action: 'permit', source: '10.0.0.0', wildcard: '0.255.255.255' }] } };
  r.config.features.nat = { pools: { PUBLIC: { start: '203.0.113.10', end: '203.0.113.10', mask: '255.255.255.0' } }, rules: [{ acl: 'INSIDE', pool: 'PUBLIC', overload: false }] };
  s.connect({ deviceId: a.id, port: p }, { deviceId: r.id, port: g(0) }); s.connect({ deviceId: b.id, port: p }, { deviceId: r.id, port: g(1) }); s.connect({ deviceId: srv.id, port: p }, { deviceId: r.id, port: g(2) });
  let ping = s.ping(a.id, '203.0.113.2', { count: 1 }); s.advance(2000); assert.equal(ping.received, 1);
  ping = s.ping(b.id, '203.0.113.2', { count: 1 }); s.advance(2000); assert.equal(ping.received, 0); assert.match(ping.replies[0].error!, /NAT.*exhausted/);
  r.config.features.nat.pools.PUBLIC.end = '203.0.113.11'; s.changed(); ping = s.ping(b.id, '203.0.113.2', { count: 1 }); s.advance(2000); assert.equal(ping.received, 1); assert.deepEqual([...new Set(r.runtime.features.natTranslations.map((x: any) => x.outside))], ['203.0.113.10', '203.0.113.11']);
});

test('network devices boot factory or saved startup config; hosts retain their desktop addresses', () => {
  const { s, a } = pair(); a.config.hostname = 'UNSAVED'; s.power(a.id, false); s.power(a.id, true); assert.equal(a.config.hostname, 'R1'); assert.equal(a.config.interfaces[g(0)].ip, undefined); assert.equal(a.config.interfaces[g(0)].adminUp, false);
  ip(a, g(0), '10.0.0.1'); a.config.hostname = 'SAVED'; a.startupConfig = structuredClone(a.config); a.config.hostname = 'TEMPORARY'; s.power(a.id, false); s.power(a.id, true); assert.equal(a.config.hostname, 'SAVED'); assert.equal(a.config.interfaces[g(0)].ip, '10.0.0.1');
  const pc = s.addDevice('pc'); ip(pc, 'GigabitEthernet0', '192.0.2.10'); s.power(pc.id, false); s.power(pc.id, true); assert.equal(pc.config.interfaces.GigabitEthernet0.ip, '192.0.2.10');
});

test('modeled IKE/IPsec negotiates actual UDP, carries ESP both ways, rejects key mismatch and renews expired SAs', () => {
  const s = new Simulator(82), a = s.addDevice('pc'), r = s.addDevice('router'), q = s.addDevice('router'), b = s.addDevice('pc'), p = 'GigabitEthernet0';
  ip(a, p, '10.1.0.10'); a.config.defaultGateway = '10.1.0.1'; ip(r, g(0), '10.1.0.1'); ip(r, g(1), '198.51.100.1'); ip(q, g(0), '198.51.100.2'); ip(q, g(1), '10.2.0.1'); ip(b, p, '10.2.0.10'); b.config.defaultGateway = '10.2.0.1';
  r.config.staticRoutes.push({ network: '10.2.0.0', prefix: 24, nextHop: '198.51.100.2' }); q.config.staticRoutes.push({ network: '10.1.0.0', prefix: 24, nextHop: '198.51.100.1' });
  for (const [device, port, peer, source, destination] of [[r, g(1), '198.51.100.2', '10.1.0.0', '10.2.0.0'], [q, g(0), '198.51.100.1', '10.2.0.0', '10.1.0.0']] as [Device, string, string, string, string][]) {
    device.config.features.acls = { VPN: { type: 'extended', entries: [{ sequence: 10, action: 'permit', protocol: 'ip', source, wildcard: '0.0.0.255', destination, destinationWildcard: '0.0.0.255' }] } };
    device.config.features.crypto = { isakmpPolicies: [{ priority: 10, encryption: 'aes', hash: 'sha', authentication: 'pre-share', group: 14 }], isakmpKeys: [{ peer, key: 'lab-secret' }], transformSets: { TRANSFORM: { encryption: 'esp-aes', integrity: 'esp-sha-hmac', mode: 'tunnel' } }, maps: { VPNMAP: [{ sequence: 10, peer, acl: 'VPN', transformSets: ['TRANSFORM'], lifetime: 3 }] } };
    device.config.interfaces[port].features.cryptoMap = 'VPNMAP';
  }
  s.connect({ deviceId: a.id, port: p }, { deviceId: r.id, port: g(0) }); s.connect({ deviceId: r.id, port: g(1) }, { deviceId: q.id, port: g(0) }); s.connect({ deviceId: q.id, port: g(1) }, { deviceId: b.id, port: p });
  let ping = s.ping(a.id, '10.2.0.10', { count: 1 }); s.advance(2000); assert.equal(ping.received, 1); assert.ok(r.runtime.features.ipsecSAs[0].encaps > 0); assert.ok(r.runtime.features.ipsecSAs[0].decaps > 0); assert.ok(s.events.some(e => e.protocol === 'ESP')); assert.equal(r.runtime.features.isakmpSAs[0].state, 'QM_IDLE');
  s.advance(2000); ping = s.ping(a.id, '10.2.0.10', { count: 1 }); s.advance(2000); assert.equal(ping.received, 1); assert.equal(r.runtime.features.ipsecSAs.length, 2);
  s.clearCrypto(r.id); s.clearCrypto(q.id); q.config.features.crypto.isakmpKeys[0].key = 'wrong'; ping = s.ping(a.id, '10.2.0.10', { count: 1 }); s.advance(4000); assert.equal(ping.received, 0); assert.match(ping.replies[0].error!, /key mismatch/); assert.equal(r.runtime.features.ipsecSAs.length, 0);
  q.config.features.crypto.isakmpKeys[0].key = 'lab-secret'; q.config.features.crypto.transformSets.TRANSFORM.keyLength = 256; ping = s.ping(a.id, '10.2.0.10', { count: 1 }); s.advance(4000); assert.equal(ping.received, 0); assert.match(ping.replies[0].error!, /transform/);
});

test('GRE tunnel protection uses modeled ESP and missing protection cannot send clear traffic', () => {
  const { s, a, b } = pair();
  for (const [d, address, peer] of [[a, '172.16.0.1', '10.0.0.2'], [b, '172.16.0.2', '10.0.0.1']] as [Device, string, string][]) {
    ip(d, 'Tunnel0', address); d.config.interfaces.Tunnel0.features = { tunnelSource: g(0), tunnelDestination: peer, tunnelKey: 17, tunnelProtection: 'PROTECT' };
    d.config.features.crypto = { isakmpPolicies: [{ priority: 10, encryption: 'aes', hash: 'sha', authentication: 'pre-share', group: 14 }], isakmpKeys: [{ peer, key: 'shared' }], transformSets: { T: { encryption: 'esp-aes', integrity: 'esp-sha-hmac', mode: 'transport' } }, profiles: { PROTECT: { transformSet: 'T' } } };
  }
  s.changed(); let ping = s.ping(a.id, '172.16.0.2', { count: 1 }); s.advance(2000); assert.equal(ping.received, 1); assert.ok(s.events.some(e => e.label === 'ESP decapsulation')); assert.ok(s.events.some(e => e.label === 'GRE decapsulation'));
  s.clearCrypto(a.id); s.clearCrypto(b.id); delete a.config.features.crypto.profiles.PROTECT; ping = s.ping(a.id, '172.16.0.2', { count: 1 }); s.advance(4000); assert.equal(ping.received, 0); assert.match(ping.replies[0].error!, /Missing IPsec protection/);
});

test('DHCPv4 T1 renewal refreshes a lease, failed T2 removes it, and server recovery reacquires it', () => {
  const { s, a, r, b } = routed(); const p = a.config.interfaces.GigabitEthernet0; delete p.ip; delete p.mask; delete a.config.defaultGateway;
  r.config.interfaces[g(0)].features.helpers = ['10.2.0.20']; b.config.services.dhcp = { enabled: true, pools: [{ name: 'LEASES', network: '10.1.0.0', prefix: 24, defaultRouter: '10.1.0.1', dnsServers: ['10.2.0.20'], leaseSeconds: 6 }], excluded: [{ start: '10.1.0.1', end: '10.1.0.9' }] }; s.changed();
  const request = s.requestDHCP(a.id); s.advance(1000); assert.equal(request.status, 'success'); const firstExpiry = p.features.leaseExpires;
  s.advance(3500); assert.ok(p.features.leaseExpires > firstExpiry); assert.ok(s.events.some(e => e.label === 'Lease renewal'));
  b.config.services.dhcp.enabled = false; s.advance(6000); assert.equal(p.ip, undefined); assert.equal(a.config.defaultGateway, undefined); assert.equal(a.runtime.features.dhcpClientLeases.GigabitEthernet0.state, 'EXPIRED'); assert.ok(s.events.some(e => e.label === 'Lease rebinding'));
  b.config.services.dhcp.enabled = true; s.advance(6000); assert.ok(p.ip); assert.equal(a.runtime.features.dhcpClientLeases.GigabitEthernet0.state, 'BOUND');
});
test('DHCPv6 T1/T2 expire addresses and delegated prefixes, then recover through fresh packets', () => {
  const s = new Simulator(83), pc = s.addDevice('pc'), r = s.addDevice('router'), port = 'GigabitEthernet0'; r.config.interfaces[g(0)].adminUp = true; r.config.interfaces[g(0)].ipv6 = ['2001:db8:a::1/64']; r.config.interfaces[g(0)].features.dhcpv6Server = 'V6';
  r.config.services.dhcpv6 = { enabled: true, pools: [{ name: 'V6', prefix: '2001:db8:a::/64', dnsServers: ['2001:db8:a::1'], delegatedPrefix: '2001:db8:100::/48', delegatedLength: 64, leaseSeconds: 4 }] };
  s.connect({ deviceId: pc.id, port }, { deviceId: r.id, port: g(0) }); const result = s.requestDHCPv6(pc.id, port, 'PD'); s.advance(2000); assert.equal(result.status, 'success'); const firstExpiry = pc.runtime.features.dhcpv6Leases[port].expires;
  s.advance(2000); assert.ok(pc.runtime.features.dhcpv6Leases[port].expires > firstExpiry); r.config.services.dhcpv6.enabled = false; s.advance(5000);
  assert.equal(pc.config.interfaces[port].ipv6.length, 0); assert.equal(pc.config.features.delegatedPrefixes.PD, undefined); assert.equal(pc.runtime.features.dhcpv6Leases[port].state, 'EXPIRED');
  r.config.services.dhcpv6.enabled = true; s.advance(6000); assert.equal(pc.config.interfaces[port].ipv6.length, 1); assert.ok(pc.config.features.delegatedPrefixes.PD); assert.ok(s.events.some(e => e.protocol === 'DHCPV6' && e.label === 'Lease rebinding'));
});
test('NAT idle aging refreshes on return traffic and releases an unused pool allocation', () => {
  const { s, a, r, b } = routed(); delete b.config.defaultGateway; r.config.interfaces[g(0)].features.nat = 'inside'; r.config.interfaces[g(1)].features.nat = 'outside'; r.config.features.nat = { rules: [{ interface: g(1), overload: true }], timeouts: { icmp: 2 } }; s.changed();
  const ping = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(1000); assert.equal(ping.received, 1); assert.equal(r.runtime.features.natTranslations.length, 1); assert.ok(r.runtime.features.natTranslations[0].lastUsed > 0);
  s.advance(2000); assert.equal(r.runtime.features.natTranslations.length, 0); assert.ok(s.events.some(e => e.label === 'Translation expired'));
});

test('DHCP snooping learns unicast renewals and removes bindings after lease expiry', () => {
  const s = new Simulator(84), pc = s.addDevice('pc'), sw = s.addDevice('switch'), srv = s.addDevice('server'), p = 'GigabitEthernet0'; ip(srv, p, '192.0.2.1');
  srv.config.services.dhcp = { enabled: true, pools: [{ name: 'SHORT', network: '192.0.2.0', prefix: 24, defaultRouter: '192.0.2.1', dnsServers: [], leaseSeconds: 6 }], excluded: [] }; sw.config.features.dhcpSnooping = { enabled: true, vlans: [1] };
  sw.config.interfaces[g(1)].features = { portfast: true, sourceGuard: true }; sw.config.interfaces[g(2)].features = { portfast: true, dhcpSnoopingTrust: true };
  s.connect({ deviceId: pc.id, port: p }, { deviceId: sw.id, port: g(1) }); s.connect({ deviceId: srv.id, port: p }, { deviceId: sw.id, port: g(2) }); s.advance(1100); s.requestDHCP(pc.id); s.advance(7500);
  assert.equal(sw.runtime.features.dhcpBindings.length, 1); assert.ok(sw.runtime.features.dhcpBindings[0].expires > s.clock.now()); const ping = s.ping(pc.id, '192.0.2.1', { count: 1 }); s.advance(1000); assert.equal(ping.received, 1);
  srv.config.services.dhcp.enabled = false; s.advance(8000); assert.equal(sw.runtime.features.dhcpBindings.length, 0); assert.equal(pc.config.interfaces[p].ip, undefined);
});

test('DHCP Option82 is inserted, echoed into the server lease, and guarded on untrusted ingress', () => {
  const s = new Simulator(85), pc = s.addDevice('pc'), sw = s.addDevice('switch'), server = s.addDevice('server'), p = 'GigabitEthernet0'; ip(server, p, '192.0.2.1');
  server.config.services.dhcp = { enabled: true, pools: [{ name: 'OPT82', network: '192.0.2.0', prefix: 24, defaultRouter: '192.0.2.1', dnsServers: [] }], excluded: [] }; sw.config.features.dhcpSnooping = { enabled: true, vlans: [1], option82: true };
  sw.config.interfaces[g(1)].features.portfast = true; sw.config.interfaces[g(2)].features = { portfast: true, dhcpSnoopingTrust: true };
  s.connect({ deviceId: pc.id, port: p }, { deviceId: sw.id, port: g(1) }); s.connect({ deviceId: server.id, port: p }, { deviceId: sw.id, port: g(2) }); s.advance(1100);
  const result = s.requestDHCP(pc.id); s.advance(1000); assert.equal(result.status, 'success'); assert.deepEqual(server.runtime.features.dhcpLeases[0].option82, { circuitId: '1:' + g(1), remoteId: sw.id });
  assert.ok(s.events.some(e => e.packet?.dhcpOperation === 'ack' && e.packet.requestedAddress === result.address));
  (s as any).transmit(pc, p, 'ff:ff:ff:ff:ff:ff', { kind: 'dhcp', operation: 'discover', clientId: pc.id, transaction: 'forged-option', option82: { circuitId: 'spoofed', remoteId: 'rogue' } }); s.advance(1000); assert.equal(sw.runtime.features.dhcpSnoopingDrops, 1); assert.ok(s.events.some(e => e.label === 'DHCP Option82 drop'));
});
test('NTP selects a preferred valid source, uses the configured source interface, and expires failed peers', () => {
  const s = new Simulator(86), a = s.addDevice('router'), b = s.addDevice('router'), c = s.addDevice('router');
  ip(a, g(0), '10.0.0.1'); ip(a, g(1), '10.0.1.1'); ip(a, 'Loopback0', '192.0.2.10', '255.255.255.255'); ip(b, g(0), '10.0.0.2'); ip(c, g(0), '10.0.1.2');
  b.config.services.ntp = { enabled: true, stratum: 1 }; c.config.services.ntp = { enabled: true, stratum: 5 }; b.config.features.clockOffset = 5000; c.config.features.clockOffset = 7000;
  b.config.staticRoutes.push({ network: '192.0.2.10', prefix: 32, nextHop: '10.0.0.1' }); c.config.staticRoutes.push({ network: '192.0.2.10', prefix: 32, nextHop: '10.0.1.1' });
  a.config.features.ntp = { source: 'Loopback0', servers: [{ address: '10.0.0.2' }, { address: '10.0.1.2', prefer: true }], pollInterval: 1, holdoverSeconds: 2.5 };
  s.connect({ deviceId: a.id, port: g(0) }, { deviceId: b.id, port: g(0) }); s.connect({ deviceId: a.id, port: g(1) }, { deviceId: c.id, port: g(0) }); s.advance(2000);
  assert.equal(a.runtime.features.ntp.peer, '10.0.1.2'); assert.ok(Math.abs(a.runtime.features.clockOffset - 7000) < 1); assert.ok(s.events.some(e => e.nodeId === c.id && e.packet?.source === '192.0.2.10'));
  c.config.services.ntp.enabled = false; s.advance(4000); assert.equal(a.runtime.features.ntp.peer, '10.0.0.2'); assert.equal(a.runtime.features.ntpAssociations['10.0.1.2'].valid, false); assert.ok(a.runtime.features.ntpAssociations['10.0.0.2'].reach > 1); assert.ok(Math.abs(a.runtime.features.clockOffset - 5000) < 1);
  const servers = a.config.features.ntp.servers; a.config.features.ntp.servers = []; s.changed(); s.advance(2000); assert.equal(a.runtime.features.ntp.synchronized, false);
  const previousReply = a.runtime.features.ntpAssociations['10.0.0.2'].lastReply; a.config.features.ntp.servers = servers; s.changed(); s.advance(2000); assert.equal(a.runtime.features.ntp.synchronized, true); assert.ok(a.runtime.features.ntpAssociations['10.0.0.2'].lastReply > previousReply);
});
test('NTP rejects a timing source whose reference chain leads back to the client', () => {
  const { s, a, b } = pair(); a.config.features.ntp = { master: 1 }; a.config.services.ntp = { enabled: true, stratum: 1 }; b.config.features.ntp = { servers: [{ address: '10.0.0.1' }] }; s.changed(); s.advance(1000); assert.equal(b.runtime.features.ntp.synchronized, true);
  a.config.features.ntp.servers = [{ address: '10.0.0.2' }]; s.changed(); const result = s.requestNTP(a.id); s.advance(5000); assert.equal(result.status, 'failure'); assert.match(result.error!, /loop/); assert.equal(a.runtime.features.ntp.synchronized, true); assert.equal(a.runtime.features.ntp.localMaster, true); assert.equal(a.runtime.features.ntp.peer, '127.127.1.1');
});

test('proxy ARP routes an on-link host assumption only when enabled', () => {
  const { s, a, r } = routed(); a.config.interfaces.GigabitEthernet0.mask = '255.0.0.0'; delete a.config.defaultGateway; s.changed();
  let result = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(1000); assert.equal(result.received, 1); assert.equal(a.runtime.arp['GigabitEthernet0|10.2.0.20'].mac, s.macOf(r.id, g(0)));
  a.runtime.arp = {}; r.config.interfaces[g(0)].features.proxyArp = false; result = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(4000); assert.equal(result.received, 0);
});
test('ICMP errors are rate-limited without suppressing ordinary echo replies', () => {
  const { s, a, r } = routed(); const result = s.ping(a.id, '203.0.113.99', { count: 3, interval: 10 }); s.advance(4000); assert.equal(r.runtime.features.icmpRateDrops, 2); assert.equal(result.replies.filter(r => r.from === '10.1.0.1').length, 1);
  const valid = s.ping(a.id, '10.1.0.1', { count: 3, interval: 10 }); s.advance(1000); assert.equal(valid.received, 3);
});
test('port security rejects moves between secure ports and ages dynamic secure MACs', () => {
  const s = new Simulator(87), a = s.addDevice('pc'), b = s.addDevice('pc'), sw = s.addDevice('switch'), p = 'GigabitEthernet0'; ip(a, p, '192.0.2.10'); ip(b, p, '192.0.2.20');
  for (const n of [1, 2]) sw.config.interfaces[g(n)].features = { portfast: true, portSecurity: { enabled: true, maximum: 2, violation: 'restrict', agingTime: 1, agingType: 'absolute', macs: [] } };
  s.connect({ deviceId: a.id, port: p }, { deviceId: sw.id, port: g(1) }); s.connect({ deviceId: b.id, port: p }, { deviceId: sw.id, port: g(2) }); s.advance(1100); s.sendGratuitousARP(a.id, p, '192.0.2.10'); s.advance(100);
  assert.ok(sw.runtime.features.secureMacs[g(1)].includes(s.macOf(a.id, p))); s.sendGratuitousARP(b.id, p, '192.0.2.10', s.macOf(a.id, p)); s.advance(100); assert.equal(sw.runtime.features.portSecurityViolations, 1);
  s.advance(60000); assert.deepEqual(sw.runtime.features.secureMacs[g(1)], []);
});
test('static bindings and ARP ACLs control DAI while per-port DHCP and ARP rates disable floods', () => {
  const s = new Simulator(88), a = s.addDevice('pc'), b = s.addDevice('pc'), sw = s.addDevice('switch'), p = 'GigabitEthernet0'; ip(a, p, '192.0.2.10'); ip(b, p, '192.0.2.20');
  sw.config.features.arpInspection = { vlans: [1] }; sw.config.features.staticBindings = [{ ip: '192.0.2.10', mac: s.macOf(a.id, p), vlan: 1, interface: g(1) }]; sw.config.interfaces[g(1)].features = { portfast: true, sourceGuard: true }; sw.config.interfaces[g(2)].features = { portfast: true, arpInspectionTrust: true };
  s.connect({ deviceId: a.id, port: p }, { deviceId: sw.id, port: g(1) }); s.connect({ deviceId: b.id, port: p }, { deviceId: sw.id, port: g(2) }); s.advance(1100); const ping = s.ping(a.id, '192.0.2.20', { count: 1 }); s.advance(1000); assert.equal(ping.received, 1);
  sw.config.features.arpAcls = { FIXED: [{ action: 'deny', ip: '192.0.2.10', mac: 'any' }] }; sw.config.features.arpInspection.filters = [{ acl: 'FIXED', vlans: [1], static: true }]; s.sendGratuitousARP(a.id, p, '192.0.2.10'); s.advance(100); assert.equal(sw.runtime.features.arpInspectionDrops, 1);
  sw.config.features.arpInspection.filters = []; sw.config.interfaces[g(1)].features.arpInspectionRate = 1; s.sendGratuitousARP(a.id, p, '192.0.2.10'); s.sendGratuitousARP(a.id, p, '192.0.2.10'); s.advance(100); assert.equal(sw.config.interfaces[g(1)].features.errDisabled, true);
  sw.config.interfaces[g(1)].features.errDisabled = false; sw.config.features.dhcpSnooping = { enabled: true, vlans: [1] }; sw.config.interfaces[g(1)].features.dhcpSnoopingRate = 1; s.changed(); s.advance(1100);
  for (let i = 0; i < 2; i++) (s as any).transmit(a, p, 'ff:ff:ff:ff:ff:ff', { kind: 'dhcp', operation: 'discover', clientId: a.id, transaction: 'flood-' + i }); s.advance(100); assert.equal(sw.config.interfaces[g(1)].features.errDisabled, true); assert.equal(sw.runtime.features.errdisableCauses[g(1)], 'dhcp-rate-limit');
});
test('flexible NetFlow record keys aggregate matching traffic and exporter sends deltas', () => {
  const { s, a, r, b } = routed(); r.config.features.flowRecords = { SOURCE: { match: ['ipv4 source address'], collect: ['counter packets long', 'counter bytes long'] } }; r.config.features.flowExporters = { COLLECTOR: { destination: '10.2.0.20', port: 2055, version: 9 } }; r.config.features.flowMonitors = { MONITOR: { record: 'SOURCE', exporter: 'COLLECTOR', cacheTimeout: 1 } }; r.config.interfaces[g(0)].features.flowMonitorIn = 'MONITOR'; b.config.services.netflow = { enabled: true };
  s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(2000); s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(2000);
  assert.equal(r.runtime.features.flowMonitorCaches.MONITOR.length, 1); assert.equal(r.runtime.features.flowMonitorCaches.MONITOR[0].packets, 2); assert.equal(b.runtime.features.netflowReceived.reduce((n: number, flow: any) => n + flow.packets, 0), 2);
});
test('portable reload discards absolute DHCP timers and reacquires fresh v4/v6 leases', () => {
  const s = new Simulator(89), pc = s.addDevice('pc'), server = s.addDevice('server'), p = 'GigabitEthernet0'; ip(server, p, '192.0.2.1'); server.config.interfaces[p].ipv6 = ['2001:db8:a::1/64']; server.config.interfaces[p].features.dhcpv6Server = 'V6';
  server.config.services.dhcp = { enabled: true, pools: [{ name: 'V4', network: '192.0.2.0', prefix: 24, defaultRouter: '192.0.2.1', dnsServers: [], leaseSeconds: 6 }], excluded: [] }; server.config.services.dhcpv6 = { enabled: true, pools: [{ name: 'V6', prefix: '2001:db8:a::/64', dnsServers: [], leaseSeconds: 6 }] };
  s.connect({ deviceId: pc.id, port: p }, { deviceId: server.id, port: p }); s.advance(50000); s.requestDHCP(pc.id); s.requestDHCPv6(pc.id); s.advance(2000); const document = s.serialize(), loaded = new Simulator(); loaded.load(document); const client = loaded.getDevice(pc.id)!, service = loaded.getDevice(server.id)!;
  assert.equal(loaded.clock.now(), 0); assert.equal(client.config.interfaces[p].ip, undefined); assert.deepEqual(client.config.interfaces[p].ipv6, []); loaded.advance(2000); assert.ok(client.config.interfaces[p].ip); assert.equal(client.config.interfaces[p].ipv6.length, 1); assert.ok(client.config.interfaces[p].features.leaseExpires < 10000);
  service.config.services.dhcp.enabled = false; service.config.services.dhcpv6.enabled = false; loaded.advance(7000); assert.equal(client.config.interfaces[p].ip, undefined); assert.deepEqual(client.config.interfaces[p].ipv6, []);
});

test('switched EtherChannel hashes configured flow fields across active members and survives member loss', () => {
  const s = new Simulator(90), left = s.addDevice('switch'), right = s.addDevice('switch'), target = s.addDevice('server'), clients: Device[] = [], p = 'GigabitEthernet0';
  ip(target, p, '192.0.2.200');
  for (const n of [1, 2]) { for (const sw of [left, right]) sw.config.interfaces[g(n)].features = { channelGroup: 1, channelMode: 'active' }; s.connect({ deviceId: left.id, port: g(n) }, { deviceId: right.id, port: g(n) }); }
  right.config.interfaces[g(3)].features.portfast = true; s.connect({ deviceId: right.id, port: g(3) }, { deviceId: target.id, port: p });
  for (let n = 0; n < 8; n++) { const pc = s.addDevice('pc'); ip(pc, p, '192.0.2.' + (10 + n)); clients.push(pc); left.config.interfaces[g(3 + n)].features.portfast = true; s.connect({ deviceId: left.id, port: g(3 + n) }, { deviceId: pc.id, port: p }); }
  s.advance(2000);
  const flows = (mode: string) => { left.config.features.etherchannel = { loadBalance: mode }; s.changed(); s.events = []; for (const pc of clients) { const probe = s.ping(pc.id, '192.0.2.200', { count: 1 }); s.advance(100); assert.equal(probe.received, 1); } return s.events.filter(e => e.nodeId === left.id && e.label === 'Frame sent' && e.protocol === 'ICMP' && e.packet?.destination === '192.0.2.200').map(e => [e.packet!.source, e.port]); };
  const first = flows('src-ip'); assert.equal(first.length, 8); assert.equal(new Set(first.map(x => x[1])).size, 2); assert.deepEqual(flows('src-ip'), first);
  assert.equal(new Set(flows('dst-ip').map(x => x[1])).size, 1); assert.equal(new Set(flows('src-mac').map(x => x[1])).size, 2); assert.equal(new Set(flows('dst-mac').map(x => x[1])).size, 1);
  left.config.interfaces[g(1)].adminUp = false; s.changed(); s.advance(2000); assert.deepEqual([...new Set(flows('src-dst-ip').map(x => x[1]))], [g(2)]);
});

test('routed EtherChannel applies the same configurable hash after neighbor resolution', () => {
  const s = new Simulator(91), a = s.addDevice('router'), b = s.addDevice('router'); ip(a, 'Port-channel1', '10.0.0.1'); ip(b, 'Port-channel2', '10.0.0.2'); ip(b, 'Loopback0', '203.0.113.9', '255.255.255.255');
  for (const n of [0, 1]) { a.config.interfaces[g(n)].adminUp = b.config.interfaces[g(n)].adminUp = true; a.config.interfaces[g(n)].features = { channelGroup: 1, channelMode: 'active' }; b.config.interfaces[g(n)].features = { channelGroup: 2, channelMode: 'passive' }; s.connect({ deviceId: a.id, port: g(n) }, { deviceId: b.id, port: g(n) }); }
  for (let n = 0; n < 8; n++) ip(a, 'Loopback' + n, '198.51.100.' + (10 + n), '255.255.255.255'); a.config.staticRoutes.push({ network: '203.0.113.9', prefix: 32, nextHop: '10.0.0.2' }); b.config.staticRoutes.push({ network: '198.51.100.0', prefix: 24, nextHop: '10.0.0.1' }); s.changed();
  const flows = (mode: string) => { a.config.features.etherchannel = { loadBalance: mode }; s.events = []; for (let n = 0; n < 8; n++) { const probe = s.ping(a.id, '203.0.113.9', { count: 1, source: '198.51.100.' + (10 + n) }); s.advance(100); assert.equal(probe.received, 1); } return s.events.filter(e => e.nodeId === a.id && e.label === 'Frame sent' && e.protocol === 'ICMP' && e.packet?.destination === '203.0.113.9').map(e => e.port); };
  const first = flows('src-ip'); assert.equal(new Set(first).size, 2); assert.deepEqual(flows('src-ip'), first); assert.equal(new Set(flows('dst-ip')).size, 1);
});

test('DHCP detects a real ARP conflict, declines through a relay, and obtains another address', () => {
  const { s, a, r, b } = routed(), sw = s.addDevice('switch'), occupied = s.addDevice('pc'), p = 'GigabitEthernet0'; s.disconnect(s.linkAt(a.id, p)!.id); delete a.config.interfaces[p].ip; delete a.config.interfaces[p].mask; delete a.config.defaultGateway; ip(occupied, p, '10.1.0.10');
  for (const n of [1, 2, 3]) sw.config.interfaces[g(n)].features.portfast = true;
  s.connect({ deviceId: sw.id, port: g(1) }, { deviceId: r.id, port: g(0) }); s.connect({ deviceId: sw.id, port: g(2) }, { deviceId: a.id, port: p }); s.connect({ deviceId: sw.id, port: g(3) }, { deviceId: occupied.id, port: p });
  r.config.interfaces[g(0)].features.helpers = ['10.2.0.20']; b.config.services.dhcp = { enabled: true, pools: [{ name: 'CLIENTS', network: '10.1.0.0', prefix: 24, defaultRouter: '10.1.0.1', dnsServers: [] }], excluded: [{ start: '10.1.0.1', end: '10.1.0.9' }], conflictHoldSeconds: 3 }; s.changed(); s.advance(1100);
  const result = s.requestDHCP(a.id); s.advance(2000); assert.equal(result.status, 'success'); assert.equal(result.address, '10.1.0.11'); assert.equal(result.conflicts, 1); assert.equal(b.runtime.features.dhcpConflicts[0].address, '10.1.0.10'); assert.ok(!b.runtime.features.dhcpLeases.some((lease: any) => lease.address === '10.1.0.10'));
  assert.ok(s.events.some(e => e.nodeId === a.id && e.label === 'Address declined')); assert.ok(s.events.some(e => e.nodeId === b.id && e.label === 'DHCP conflict recorded')); assert.ok(s.events.some(e => e.protocol === 'ARP' && e.packet?.source === '10.1.0.10' && e.nodeId === a.id));
  const ping = s.ping(a.id, '10.2.0.20', { count: 1 }); s.advance(2000); assert.equal(ping.received, 1); assert.equal(b.runtime.features.dhcpConflicts.length, 0);
});

test('DHCP NAK withdraws an excluded renewed lease and refuses another client ownership', () => {
  const s = new Simulator(92), pc = s.addDevice('pc'), server = s.addDevice('server'), p = 'GigabitEthernet0'; ip(server, p, '192.0.2.1'); server.config.services.dhcp = { enabled: true, pools: [{ name: 'LAN', network: '192.0.2.0', prefix: 24, defaultRouter: '192.0.2.1', dnsServers: [], leaseSeconds: 6 }], excluded: [] }; s.connect({ deviceId: pc.id, port: p }, { deviceId: server.id, port: p });
  const first = s.requestDHCP(pc.id); s.advance(1000); assert.equal(first.address, '192.0.2.2'); server.config.services.dhcp.excluded.push({ start: '192.0.2.2', end: '192.0.2.2' }); s.advance(2500); assert.equal(pc.config.interfaces[p].ip, undefined); assert.equal(pc.runtime.features.dhcpClientLeases[p].state, 'NAK'); assert.ok(s.events.some(e => e.label === 'DHCP NAK received'));
  s.advance(1500); assert.equal(pc.config.interfaces[p].ip, '192.0.2.3'); const before = server.runtime.features.dhcpLeases.length;
  (s as any).transmit(pc, p, 'ff:ff:ff:ff:ff:ff', { kind: 'dhcp', operation: 'request', clientId: 'different-client', serverId: server.id, transaction: 'steal', address: '192.0.2.3' });
  (s as any).transmit(pc, p, 'ff:ff:ff:ff:ff:ff', { kind: 'dhcp', operation: 'request', clientId: 'different-client', serverId: server.id, transaction: 'wrong-subnet', address: '198.51.100.9' }); s.advance(100);
  assert.equal(server.runtime.features.dhcpLeases.length, before); assert.equal(server.runtime.features.dhcpLeases.some((lease: any) => lease.clientId === 'different-client'), false); assert.equal(s.events.filter(e => e.nodeId === server.id && e.label === 'DHCP NAK sent').length, 3);
});

test('DHCP does not treat an isolated duplicate address as an observed conflict', () => {
  const s = new Simulator(93), pc = s.addDevice('pc'), server = s.addDevice('server'), isolated = s.addDevice('pc'), p = 'GigabitEthernet0'; ip(server, p, '192.0.2.1'); ip(isolated, p, '192.0.2.2'); server.config.services.dhcp = { enabled: true, pools: [{ name: 'LAN', network: '192.0.2.0', prefix: 24, dnsServers: [] }], excluded: [] }; s.connect({ deviceId: pc.id, port: p }, { deviceId: server.id, port: p });
  const result = s.requestDHCP(pc.id); s.advance(1000); assert.equal(result.status, 'success'); assert.equal(result.address, '192.0.2.2'); assert.equal(server.runtime.features.dhcpConflicts.length, 0);
});

test('extended ping carries DSCP and a repeated payload pattern and detects altered replies', () => {
  const { s, a, b } = pair(); const valid = s.ping(a.id, '10.0.0.2', { count: 1, size: 100, tos: 184, dataPattern: 'ABCD', validateData: true }); s.advance(1000); assert.equal(valid.received, 1); assert.ok(s.events.some(e => e.nodeId === a.id && e.label === 'Frame sent' && e.packet?.dscp === 46));
  const wire = (s as any).sendWire.bind(s); (s as any).sendWire = (device: Device, port: string, frame: any) => { if (device === b && frame.payload.body?.kind === 'echo-reply') frame.payload.body.dataHex = '0000'; wire(device, port, frame); };
  const corrupt = s.ping(a.id, '10.0.0.2', { count: 1, dataPattern: '1234', validateData: true }); s.advance(1000); assert.equal(corrupt.received, 0); assert.equal(corrupt.status, 'failure'); assert.match(corrupt.replies[0].error!, /verification failed/); assert.ok(s.events.some(e => e.label === 'Echo data mismatch'));
});

test('manual IPv6 link-local addresses are scoped to the selected interface', () => {
  const s = new Simulator(94), a = s.addDevice('router'), b = s.addDevice('router'), c = s.addDevice('router');
  for (const [device, port, address] of [[a, g(0), 'fe80::1'], [a, g(1), 'fe80::1'], [b, g(0), 'fe80::2'], [c, g(0), 'fe80::2']] as [Device, string, string][]) { device.config.interfaces[port].adminUp = true; device.config.interfaces[port].features = { ipv6Enabled: true, ipv6LinkLocal: address }; }
  s.connect({ deviceId: a.id, port: g(0) }, { deviceId: b.id, port: g(0) }); s.connect({ deviceId: a.id, port: g(1) }, { deviceId: c.id, port: g(0) });
  s.advance(1100);const ambiguous = s.ping(a.id, 'fe80::2', { count: 1, source: 'fe80::1' }); s.advance(100); assert.equal(ambiguous.received, 0); assert.match(ambiguous.replies[0].error!, /unambiguous/);
  for (const port of [g(0), g(1)]) { const result = s.ping(a.id, 'fe80::2', { count: 1, source: 'fe80::1', interface: port }); s.advance(100); assert.equal(result.received, 1); }
  assert.equal(a.runtime.arp[g(0) + '|fe80::2'].mac, s.macOf(b.id, g(0))); assert.equal(a.runtime.arp[g(1) + '|fe80::2'].mac, s.macOf(c.id, g(0)));
});

test('packet inspector exposes transport state and provenance without application credentials', () => {
  const { s, a, b } = pair(); s.registerTCPService(2222, d => d.id === b.id, (_device, payload) => ({ accepted: payload.password === 'private-test-credential', content: 'private-test-response' })); const result = s.tcpRequest(a.id, '10.0.0.2', 2222, { username: 'learner', password: 'private-test-credential' }); s.advance(2000); assert.equal(result.status, 'success');
  const packets = s.events.flatMap(event => event.packet ? [event.packet] : []); assert.ok(packets.some(p => p.destinationPort === 2222 && p.tcpFlags === 'SYN')); assert.ok(packets.some(p => p.tcpFlags === 'SYN ACK' && p.parentId)); assert.ok(packets.some(p => p.tcpSegmentIndex === 0 && p.tcpSegmentCount === 1)); assert.ok(packets.some(p => p.tcpAckSegmentIndex === 0));
  const exposed = JSON.stringify(packets); assert.equal(exposed.includes('private-test-credential'), false); assert.equal(exposed.includes('private-test-response'), false); assert.equal(exposed.includes('learner'), false);
});

test('persistent TCP performs one handshake and exchanges multiple ordered messages before close', () => {
  const { s, a, b } = pair(), received: number[] = [], replies: number[] = []; let server: TCPChannel | undefined, opened = 0, closed = 0;
  s.registerTCPChannelService(179, d => d.id === b.id, channel => { server = channel; channel.setHandlers({ onMessage: payload => { received.push(payload.number); channel.send({ reply: payload.number }); } }); });
  const client = s.connectTCPChannel(a.id, '10.0.0.2', 179, { source: g(0), ttl: 1, onOpen: channel => { opened++; for (let n = 1; n <= 5; n++) channel.send({ number: n }); }, onMessage: payload => replies.push(payload.reply), onClose: () => closed++ }); s.advance(2000);
  assert.equal(client.state, 'OPEN'); assert.equal(server?.state, 'OPEN'); assert.equal(opened, 1); assert.deepEqual(received, [1, 2, 3, 4, 5]); assert.deepEqual(replies, received); assert.equal(s.events.filter(e => e.nodeId === a.id && e.label === 'Frame sent' && e.packet?.messageType === 'tcp-channel-syn').length, 1);
  client.send({ number: 6 }); client.close('Test finished'); s.advance(2000); assert.deepEqual(received, [1, 2, 3, 4, 5, 6]); assert.equal(client.state, 'CLOSED'); assert.equal(server?.state, 'CLOSED'); assert.equal(closed, 1); assert.equal(client.send({ number: 7 }), undefined);
});

test('persistent TCP retransmits lost handshake/data/ACK packets and delivers UTF-8 messages once in order', () => {
  const { s, a, b } = pair(), received: any[] = []; s.lab.links[0].loss = 0.15;
  s.registerTCPChannelService(179, d => d.id === b.id, channel => channel.setHandlers({ onMessage: payload => received.push(payload) }));
  let opens = 0; const payloads = [{ text: 'network 🌐 '.repeat(700) }, { text: 'second' }, { text: 'third' }];
  const client = s.connectTCPChannel(a.id, '10.0.0.2', 179, { onOpen: channel => { opens++; for (const payload of payloads) channel.send(payload); } }); s.advance(25000);
  assert.equal(client.state, 'OPEN'); assert.equal(opens, 1); assert.deepEqual(received, payloads); assert.ok(a.runtime.features.tcpChannels[client.id].retransmissions > 0); assert.equal(a.runtime.features.tcpChannels[client.id].pending, 0);
});

test('persistent TCP cannot establish without a return route and reports a bounded connection failure', () => {
  const { s, a, b } = routed(); delete b.config.defaultGateway; s.changed(); let accepted = 0, closes = 0;
  s.registerTCPChannelService(179, d => d.id === b.id, () => accepted++); const client = s.connectTCPChannel(a.id, '10.2.0.20', 179, { onClose: () => closes++ }); s.advance(10000);
  assert.equal(client.state, 'CLOSED'); assert.equal(accepted, 0); assert.equal(closes, 1); assert.ok(s.events.some(e => e.nodeId === b.id && e.label === 'No route')); s.advance(20000); assert.equal(closes, 1);
});

test('persistent TCP source and VRF selection keep overlapping peers separate', () => {
  const s = new Simulator(95), a = s.addDevice('router'), b = s.addDevice('router'), c = s.addDevice('router'); ip(a, g(0), '192.0.2.1'); ip(a, g(1), '192.0.2.1'); a.config.interfaces[g(0)].vrf = 'BLUE'; a.config.interfaces[g(1)].vrf = 'GOLD'; ip(b, g(0), '192.0.2.2'); ip(c, g(0), '192.0.2.2'); s.connect({ deviceId: a.id, port: g(0) }, { deviceId: b.id, port: g(0) }); s.connect({ deviceId: a.id, port: g(1) }, { deviceId: c.id, port: g(0) });
  const messages: Record<string, string[]> = {}; s.registerTCPChannelService(179, d => d !== a, channel => channel.setHandlers({ onMessage: payload => (messages[channel.deviceId] ??= []).push(payload.vrf) }));
  const blue = s.connectTCPChannel(a.id, '192.0.2.2', 179, { source: g(0), vrf: 'BLUE', onOpen: channel => channel.send({ vrf: 'BLUE' }) }), gold = s.connectTCPChannel(a.id, '192.0.2.2', 179, { source: g(1), vrf: 'GOLD', onOpen: channel => channel.send({ vrf: 'GOLD' }) }); s.advance(1000); assert.equal(blue.state, 'OPEN'); assert.equal(gold.state, 'OPEN'); assert.deepEqual(messages[b.id], ['BLUE']); assert.deepEqual(messages[c.id], ['GOLD']);
  const wrong = s.connectTCPChannel(a.id, '192.0.2.2', 179, { source: g(0), vrf: 'GOLD' }); s.advance(1); assert.equal(wrong.state, 'CLOSED');
});

test('persistent TCP loss, reboot and reset invalidate pending work without duplicate callbacks', () => {
  const { s, a, b } = pair(); let delivered = 0, closed = 0; s.registerTCPChannelService(179, d => d.id === b.id, channel => channel.setHandlers({ onMessage: () => delivered++ }));
  const client = s.connectTCPChannel(a.id, '10.0.0.2', 179, { onClose: () => closed++ }); s.advance(1000); s.lab.links[0].loss = 1; client.send({ data: 'lost' }); s.advance(10000); assert.equal(client.state, 'CLOSED'); assert.equal(delivered, 0); assert.equal(closed, 1);
  s.lab.links[0].loss = 0; const next = s.connectTCPChannel(a.id, '10.0.0.2', 179, { onClose: () => closed++ }); s.advance(1000); s.lab.links[0].delay = 500; next.send({ data: 'in flight' }); a.startupConfig = structuredClone(a.config); s.power(a.id, false); s.power(a.id, true); s.advance(1000); assert.equal(next.state, 'CLOSED'); assert.equal(delivered, 0); assert.equal(closed, 2);
  s.lab.links[0].delay = 0.1; const reset = s.connectTCPChannel(a.id, '10.0.0.2', 179, { onClose: () => closed++ }); s.advance(1000); reset.send({ data: 'discard on reset' }); s.resetRuntime(); s.advance(10000); assert.equal(reset.state, 'CLOSED'); assert.equal(delivered, 0); assert.equal(closed, 2);
});

test('persistent TCP honors configured single-hop and accepted reply TTLs', () => {
  const { s, a, b } = routed(); let serverTTL = 1, accepted = 0; s.registerTCPChannelService(179, d => d.id === b.id ? { ttl: serverTTL } : false, () => accepted++);
  const short = s.connectTCPChannel(a.id, '10.2.0.20', 179, { ttl: 1 }); s.advance(10000); assert.equal(short.state, 'CLOSED'); assert.equal(accepted, 0);
  const noReturn = s.connectTCPChannel(a.id, '10.2.0.20', 179, { ttl: 2 }); s.advance(10000); assert.equal(noReturn.state, 'CLOSED'); assert.equal(accepted, 0);
  serverTTL = 2; const valid = s.connectTCPChannel(a.id, '10.2.0.20', 179, { ttl: 2 }); s.advance(1000); assert.equal(valid.state, 'OPEN'); assert.equal(accepted, 1); assert.ok(s.events.some(e => e.label === 'TTL expired'));
});

test('logging independently controls local buffering, terminal records, remote source and facility', () => {
  const { s, a, b } = pair(); a.runtime.logs = []; a.runtime.features.logEntries = []; ip(a, 'Loopback0', '192.0.2.10', '255.255.255.255'); b.config.services.syslog = { enabled: true }; a.config.features.logging = { source: 'Loopback0', hosts: ['10.0.0.2'], facility: 20, trap: 5, buffered: true, bufferedLevel: 4, bufferSize: 160 }; s.changed();
  s.log(a.id, 'debug-only', 7); s.log(a.id, 'notice-to-remote', 5); s.log(a.id, 'warning-to-buffer', 4); s.advance(1000);
  assert.equal(a.runtime.features.logEntries.length, 3); assert.equal(a.runtime.logs.length, 1); assert.match(a.runtime.logs[0], /warning-to-buffer/); assert.deepEqual(b.runtime.features.syslogReceived.map((entry: any) => entry.message), ['notice-to-remote', 'warning-to-buffer']); assert.ok(b.runtime.features.syslogReceived.every((entry: any) => entry.source === '192.0.2.10' && entry.facility === 20));
  a.config.features.logging.buffered = false; s.log(a.id, 'monitor-unbuffered', 3); assert.equal(a.runtime.logs.length, 1); assert.equal(a.runtime.features.logEntries.at(-1).message, 'monitor-unbuffered'); a.config.features.logging.buffered = true;
  for (let n = 0; n < 10; n++) s.log(a.id, 'bounded-buffer-' + n, 4); assert.ok(a.runtime.features.logBufferBytes <= 160); assert.ok(a.runtime.logs.length < 10); assert.match(a.runtime.logs.at(-1)!, /bounded-buffer-9/);
});

test('local host records resolve without a DNS service while network-only lookup still requires DNS', () => {
  const { s, a } = pair(); a.config.services.dns = { enabled: false, records: { peer: '10.0.0.2', 'peer-v6': '2001:db8::2' } }; assert.equal(s.resolveName(a.id, 'PEER').address, '10.0.0.2'); assert.equal(s.resolveName(a.id, 'peer-v6').address, '2001:db8::2'); assert.equal(s.resolveDNS(a.id, 'peer').status, 'failure');
});

test('stopping automatic addressing preserves manual values beyond old renewal and expiry timers', () => {
  const s = new Simulator(96), pc = s.addDevice('pc'), server = s.addDevice('router'), p = 'GigabitEthernet0'; ip(server, g(0), '192.0.2.1'); server.config.ipv6Routing = true; server.config.interfaces[g(0)].ipv6 = ['2001:db8:a::1/64']; server.config.interfaces[g(0)].features.dhcpv6Server = 'V6';
  server.config.services.dhcp = { enabled: true, pools: [{ name: 'V4', network: '192.0.2.0', prefix: 24, dnsServers: [], leaseSeconds: 4 }], excluded: [] }; server.config.services.dhcpv6 = { enabled: true, pools: [{ name: 'V6', prefix: '2001:db8:a::/64', dnsServers: [], leaseSeconds: 4 }] }; s.connect({ deviceId: pc.id, port: p }, { deviceId: server.id, port: g(0) });
  s.requestDHCP(pc.id); s.requestDHCPv6(pc.id); s.advance(1500); assert.ok(pc.config.interfaces[p].features.dhcpLease); assert.ok(pc.config.interfaces[p].features.dhcpv6Lease);
  s.stopAutomaticAddressing(pc.id, p); pc.config.interfaces[p].ip = '192.0.2.99'; pc.config.interfaces[p].mask = '255.255.255.0'; pc.config.interfaces[p].ipv6 = ['2001:db8:a::99/64']; pc.config.defaultGateway = '192.0.2.1'; pc.config.dnsServers = ['192.0.2.53']; s.changed(); s.advance(12000);
  assert.equal(pc.config.interfaces[p].ip, '192.0.2.99'); assert.deepEqual(pc.config.interfaces[p].ipv6, ['2001:db8:a::99/64']); assert.deepEqual(pc.config.dnsServers, ['192.0.2.53']); assert.equal(pc.config.interfaces[p].features.dhcp, undefined);
  pc.config.interfaces[p].ipv6 = []; const pending = s.requestIPv6(pc.id); s.advance(100); s.stopAutomaticAddressing(pc.id, p, 'ipv6'); pc.config.interfaces[p].ipv6 = ['2001:db8:a::100/64']; s.advance(31000); assert.equal(pending.status, 'failure'); assert.deepEqual(pc.config.interfaces[p].ipv6, ['2001:db8:a::100/64']);
});

test('persistent TCP enforces minimum incoming TTL on SYN, SYNACK and established messages', () => {
  const { s, a, b } = pair(); let replyTTL = 255, delivered = 0; s.registerTCPChannelService(179, d => d.id === b.id ? { ttl: replyTTL, minimumTTL: 255 } : false, channel => channel.setHandlers({ onMessage: () => delivered++ }));
  const rejected = s.connectTCPChannel(a.id, '10.0.0.2', 179); s.advance(10000); assert.equal(rejected.state, 'CLOSED'); assert.ok(b.runtime.features.tcpTTLDrop > 0);
  replyTTL = 64; const rejectedReply = s.connectTCPChannel(a.id, '10.0.0.2', 179, { ttl: 255, minimumTTL: 255 }); s.advance(10000); assert.equal(rejectedReply.state, 'CLOSED'); assert.ok(a.runtime.features.tcpTTLDrop > 0);
  replyTTL = 255; const valid = s.connectTCPChannel(a.id, '10.0.0.2', 179, { ttl: 255, minimumTTL: 255 }); s.advance(1000); assert.equal(valid.state, 'OPEN'); valid.send({ sequence: 1 }); s.advance(1000); assert.equal(delivered, 1); valid.setTTL(64); valid.send({ sequence: 2 }); s.advance(10000); assert.equal(delivered, 1); assert.equal(valid.state, 'CLOSED');
});

test('interface operational changes emit edge-triggered LINK and LINEPROTO logs', () => {
 const {s,a}=pair();a.runtime.features.logEntries=[];s.lab.links[0].enabled=false;s.changed();assert.equal(a.runtime.features.logEntries.length,2);assert.match(a.runtime.features.logEntries[0].message,/%LINK-3-UPDOWN.*down/);s.changed();assert.equal(a.runtime.features.logEntries.length,2);s.lab.links[0].enabled=true;s.changed();assert.equal(a.runtime.features.logEntries.length,4);assert.match(a.runtime.features.logEntries[3].message,/%LINEPROTO-5-UPDOWN.*up/);
});

test('DHCPv6 selects the highest delivered server preference and ignores other server replies', () => {
 const s=new Simulator(97),pc=s.addDevice('pc'),sw=s.addDevice('switch'),low=s.addDevice('server'),high=s.addDevice('server'),p='GigabitEthernet0';
 for(const [index,d] of [pc,low,high].entries()){s.connect({deviceId:d.id,port:p},{deviceId:sw.id,port:'GigabitEthernet0/'+(index+1)});sw.config.interfaces['GigabitEthernet0/'+(index+1)].features.portfast=true;}
 for(const [d,address,preference] of [[low,'2001:db8:a::1',10],[high,'2001:db8:a::2',200]] as [Device,string,number][]){d.config.interfaces[p].ipv6=[address+'/64'];d.config.interfaces[p].features.dhcpv6Server='V6';d.config.interfaces[p].features.dhcpv6Preference=preference;d.config.services.dhcpv6={enabled:true,pools:[{name:'V6',prefix:'2001:db8:a::/64',dnsServers:[address],leaseSeconds:10}]};}
 s.changed();s.advance(31000);const result=s.requestDHCPv6(pc.id);s.advance(1500);assert.equal(result.status,'success');assert.equal(pc.runtime.features.dhcpv6Leases[p].serverId,high.id);assert.deepEqual(pc.config.dnsServers,['2001:db8:a::2']);assert.equal(pc.config.interfaces[p].ipv6.length,1);
});

test('DHCPv6 preferred and valid lifetimes deprecate addresses and expire address/PD independently', () => {
 const s=new Simulator(98),pc=s.addDevice('pc'),r=s.addDevice('router'),p='GigabitEthernet0';r.config.interfaces[g(0)].adminUp=true;r.config.interfaces[g(0)].ipv6=['2001:db8:a::1/64'];r.config.interfaces[g(0)].features.dhcpv6Server='V6';r.config.services.dhcpv6={enabled:true,pools:[{name:'V6',prefix:'2001:db8:a::/64',leaseSeconds:4,preferredLifetime:1,delegatedPrefix:'2001:db8:100::/48',delegatedLength:64,pdLeaseSeconds:8,pdPreferredLifetime:2}]};s.connect({deviceId:pc.id,port:p},{deviceId:r.id,port:g(0)});const result=s.requestDHCPv6(pc.id,p,'PD');s.advance(1500);assert.equal(result.status,'success');const address=result.address;pc.config.interfaces[p].ipv6.push('2001:db8:a::99/64');assert.equal(s.preferredIPv6Address(pc.id,p),address);r.config.services.dhcpv6.enabled=false;s.advance(1200);assert.equal(s.preferredIPv6Address(pc.id,p),'2001:db8:a::99');assert.ok(pc.runtime.features.deprecatedIPv6[p].includes(address));s.advance(1000);assert.equal(pc.config.features.delegatedPrefixes.PD.deprecated,true);s.advance(1800);assert.equal(pc.config.interfaces[p].ipv6.some(x=>x.startsWith(address+'/')),false);assert.ok(pc.config.features.delegatedPrefixes.PD);s.advance(4000);assert.equal(pc.config.features.delegatedPrefixes.PD,undefined);assert.deepEqual(pc.config.interfaces[p].ipv6,['2001:db8:a::99/64']);
});

test('configured CEF flow hashing changes actual equal-cost forwarding while keeping each flow stable', () => {
 const s=new Simulator(99),a=s.addDevice('router'),b=s.addDevice('router');for(let n=0;n<2;n++){ip(a,g(n),`10.${n}.0.1`);ip(b,g(n),`10.${n}.0.2`);s.connect({deviceId:a.id,port:g(n)},{deviceId:b.id,port:g(n)});}ip(b,'Loopback0','203.0.113.1','255.255.255.255');a.config.staticRoutes=[0,1].map(n=>({network:'203.0.113.1',prefix:32,nextHop:`10.${n}.0.2`,interface:g(n)}));s.registerUDPService(9000,d=>d.id===b.id,(_d,p)=>({number:p.number}));a.config.features.cefHash={algorithm:'original'};s.changed();
 const original=Array.from({length:12},(_,n)=>s.cefLookup(a.id,'203.0.113.1',undefined,{source:'192.0.2.1',sourcePort:20000+n,destinationPort:9000,protocol:'udp'})!.port);assert.equal(new Set(original).size,1);
 a.config.features.cefHash={algorithm:'include-ports',sourcePort:true,destinationPort:true,seed:1234};const flow={source:'192.0.2.1',sourcePort:20001,destinationPort:9000,protocol:'udp'};assert.equal(s.cefLookup(a.id,'203.0.113.1',undefined,flow)!.port,s.cefLookup(a.id,'203.0.113.1',undefined,flow)!.port);s.events=[];const requests=Array.from({length:20},(_,number)=>s.udpRequest(a.id,'203.0.113.1',9000,{number}));s.advance(1000);assert.ok(requests.every(r=>r.status==='success'));assert.equal(new Set(s.events.filter(e=>e.nodeId===a.id&&e.label==='Frame sent'&&e.packet?.destination==='203.0.113.1').map(e=>e.port)).size,2);
 const first=s.cefLookup(a.id,'203.0.113.1',undefined,flow)!.port;a.config.features.cefHash.seed=1235;assert.notEqual(s.cefLookup(a.id,'203.0.113.1',undefined,flow)!.port,first);
});

function ipv6GuardLab(seed:number){const s=new Simulator(seed),pc=s.addDevice('pc'),sw=s.addDevice('switch'),server=s.addDevice('server'),p='GigabitEthernet0';for(const n of [1,2])sw.config.interfaces[g(n)].features.portfast=true;pc.config.interfaces[p].features.ipv6Enabled=true;server.config.interfaces[p].ipv6=['2001:db8:a::1/64'];s.connect({deviceId:pc.id,port:p},{deviceId:sw.id,port:g(1)});s.connect({deviceId:server.id,port:p},{deviceId:sw.id,port:g(2)});s.advance(1100);return{s,pc,sw,server,p};}

test('named RA guard checks delivered flags, hop limit, preference, source ACL and prefixes',()=>{
 const {s,pc,sw,server,p}=ipv6GuardLab(100),source=s.linkLocalAddress(server.id,p);sw.config.interfaces[g(2)].features.raGuardPolicy='ROUTER';sw.config.features.ipv6Policies={raGuard:{ROUTER:{deviceRole:'router',hopLimitMin:32,hopLimitMax:128,managedFlag:'on',otherFlag:'off',routerPreferenceMaximum:'medium',sourceAcl:'RA-SOURCE',prefixList:'RA-PREFIX'}}};sw.config.features.acls={'RA-SOURCE':{type:'ipv6',entries:[{action:'permit',protocol:'ipv6',source:source+'/128',destination:'any'}]}};sw.config.features.prefixLists={'RA-PREFIX':[{sequence:10,action:'permit',network:'2001:db8:a::',prefix:64}]};pc.config.interfaces[p].features.ipv6Autoconfig=true;
 const valid={type:'ra',source,lifetime:10,managed:true,other:false,hopLimit:64,routerPreference:'medium',prefixes:[{network:'2001:db8:a::',prefix:64}]};for(const bad of [{hopLimit:1},{managed:false},{other:true},{routerPreference:'high'},{source:'fe80::bad'},{prefixes:[{network:'2001:db8:bad::',prefix:64}]}]){s.sendLinkControl(server.id,p,{kind:'link-control',protocol:'ICMPV6',body:{...valid,...bad}});s.advance(10);}assert.equal(sw.runtime.features.raGuardDrops,6);assert.equal(pc.runtime.features.ipv6DefaultRouters,undefined);s.sendLinkControl(server.id,p,{kind:'link-control',protocol:'ICMPV6',body:valid});s.advance(1100);assert.equal((pc.runtime.features.ipv6DefaultRouters as any)[p].address,source);assert.ok(pc.config.interfaces[p].ipv6.some(v=>v.startsWith('2001:db8:a:')));
});

test('named DHCPv6 guard rejects server preference, source ACL and leased prefix violations',()=>{
 const {s,pc,sw,server,p}=ipv6GuardLab(101),source=s.linkLocalAddress(server.id,p);sw.config.interfaces[g(2)].features.dhcpv6GuardPolicy='SERVER';sw.config.features.ipv6Policies={dhcpv6Guard:{SERVER:{deviceRole:'server',serverPreferenceMin:10,serverPreferenceMax:100,serverAcl:'SERVER',prefixList:'LEASE'}}};sw.config.features.acls={SERVER:{type:'ipv6',entries:[{action:'permit',protocol:'ipv6',source:source+'/128',destination:'any'}]}};sw.config.features.prefixLists={LEASE:[{action:'permit',network:'2001:db8:a::',prefix:64}]};const valid={type:'reply',source,clientId:pc.id,clientPort:p,address:'2001:db8:a::10',prefix:64,lifetime:60,preference:50};for(const bad of [{preference:1},{preference:200},{source:'fe80::bad'},{address:'2001:db8:bad::10'}]){s.sendLinkControl(server.id,p,{kind:'link-control',protocol:'DHCPV6',body:{...valid,...bad}});s.advance(10);}assert.equal(sw.runtime.features.dhcpv6GuardDrops,4);
 server.config.interfaces[p].features.dhcpv6Server='V6';server.config.interfaces[p].features.dhcpv6Preference=50;server.config.services.dhcpv6={enabled:true,pools:[{name:'V6',prefix:'2001:db8:a::/64',leaseSeconds:60}]};const result=s.requestDHCPv6(pc.id);s.advance(1500);assert.equal(result.status,'success');assert.equal(sw.runtime.features.dhcpv6GuardDrops,4);
});

test('ND monitor/trust controls and IPv6 source-prefix guard act on actual ingress frames',()=>{
 const {s,pc,sw,server,p}=ipv6GuardLab(102),mac=s.macOf(pc.id,p);pc.config.interfaces[p].ipv6=['2001:db8:a::20/64'];sw.config.interfaces[g(1)].features.ndInspectionPolicy='ND';sw.config.features.ipv6Policies={ndInspection:{ND:{validateSourceMac:true}}};const frame:any={id:'forged-nd',sourceMac:mac,destinationMac:'33:33:00:00:00:01',payload:{kind:'arp',operation:'reply',family:6,source:'2001:db8:a::20',target:'2001:db8:a::20',mac:'02:00:00:00:00:ff'},hops:64};(s as any).sendWire(pc,p,frame);s.advance(10);assert.equal(sw.runtime.features.ndInspectionDrops,1);sw.config.features.ipv6Policies.ndInspection.ND.monitor=true;(s as any).sendWire(pc,p,frame);s.advance(10);assert.equal(sw.runtime.features.ndInspectionMonitored,1);
 sw.config.features.ipv6Policies.ndInspection.ND={trusted:true};frame.payload.mac=mac;(s as any).sendWire(pc,p,frame);s.advance(10);sw.runtime.features.ipv6Bindings=[{port:g(1),vlan:1,mac,ip:'2001:db8:a::10',prefix:64,state:'reachable',source:'DHCPv6',expires:s.clock.now()+60000}];sw.config.interfaces[g(1)].features.ipv6SourceGuard={validateAddress:false,validatePrefix:true};s.changed();s.advance(1100);let ping=s.ping(pc.id,'2001:db8:a::1',{count:1});s.advance(1000);assert.equal(ping.received,1);sw.runtime.features.ipv6Bindings[0].source='NDP';sw.config.interfaces[g(1)].features.ipv6SourceGuard.denyGlobalAutoconf=true;ping=s.ping(pc.id,'2001:db8:a::1',{count:1});s.advance(1000);assert.equal(ping.received,0);assert.ok(sw.runtime.features.ipv6SourceGuardDrops>0);
});

test('UDP TCP and HTTP requests validate explicit local sources and preserve the selected address on wire',()=>{
 const {s,a,b}=pair();ip(a,'Loopback0','192.0.2.1','255.255.255.255');b.config.staticRoutes.push({network:'192.0.2.1',prefix:32,nextHop:'10.0.0.1'});s.registerUDPService(9001,d=>d===b,(_d,_p,source)=>({source}));s.registerTCPService(9002,d=>d===b,(_d,_p,source)=>({source}));b.config.services.http={enabled:true,content:'explicit-source'};s.changed();const udp=s.udpRequest(a.id,'10.0.0.2',9001,{}, {source:'Loopback0',sourcePort:12345}),tcp=s.tcpRequest(a.id,'10.0.0.2',9002,{}, {source:'192.0.2.1'}),http=s.httpRequest(a.id,'http://10.0.0.2/',{source:'Loopback0'});s.advance(2000);assert.equal(udp.source,'192.0.2.1');assert.ok(s.events.some(e=>e.packet?.destinationPort===9001&&e.packet?.sourcePort===12345));assert.equal(tcp.source,'192.0.2.1');assert.equal(http.content,'explicit-source');assert.ok(s.events.some(e=>e.nodeId===a.id&&e.label==='Frame sent'&&e.packet?.destinationPort===80&&e.packet?.source==='192.0.2.1'));const bad=s.udpRequest(a.id,'10.0.0.2',9001,{}, {source:'198.51.100.99'});assert.equal(bad.status,'failure');const wrong=s.tcpRequest(a.id,'10.0.0.2',9002,{}, {source:'Loopback0',vrf:'OTHER'});assert.equal(wrong.status,'failure');
});
