import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { defaultInterface, type Device } from '../src/model.ts';

const p = 'GigabitEthernet0';
const g = (n: number) => 'GigabitEthernet0/' + n;
function ip(d: Device, port: string, address: string) {
  const iface = d.config.interfaces[port] ??= defaultInterface(port);
  Object.assign(iface, { ip: address, mask: '255.255.255.0', adminUp: true, switchport: false });
}
function cable(s: Simulator, a: Device, ap: string, b: Device, bp: string) { return s.connect({ deviceId: a.id, port: ap }, { deviceId: b.id, port: bp }); }
function commands(cli: IOSSession, ...lines: string[]) {
  for (const line of lines) assert.ok(!cli.execute(line).some(value => value.startsWith('%')), line);
}
function routed() {
  const s = new Simulator(901), inside = s.addDevice('pc'), router = s.addDevice('router'), outside = s.addDevice('server');
  ip(inside, p, '10.1.0.10'); inside.config.defaultGateway = '10.1.0.1';
  ip(router, g(0), '10.1.0.1'); ip(router, g(1), '203.0.113.1');
  ip(outside, p, '203.0.113.2'); outside.config.defaultGateway = '203.0.113.1';
  cable(s, inside, p, router, g(0)); cable(s, router, g(1), outside, p); s.changed();
  return { s, inside, router, outside };
}

test('DAI validates request sender addresses and reply target addresses on actual frames', () => {
  const s = new Simulator(902), pc = s.addDevice('pc'), sw = s.addDevice('switch');
  ip(pc, p, '192.0.2.10'); sw.config.interfaces[g(1)].features.portfast = true;
  sw.config.features.arpInspection = { vlans: [1], validations: { ip: true } };
  sw.config.features.staticBindings = [{ interface: g(1), vlan: 1, ip: '192.0.2.10', mac: s.macOf(pc.id, p) }];
  cable(s, pc, p, sw, g(1)); s.advance(1100);
  const send = (operation: 'request' | 'reply', source: string, target: string) => {
    (s as any).transmit(pc, p, 'ff:ff:ff:ff:ff:ff', { kind: 'arp', family: 4, operation, source, target, mac: s.macOf(pc.id, p) }); s.advance(20);
  };
  send('request', '192.0.2.10', '255.255.255.255');
  assert.equal(sw.runtime.features.arpInspectionDrops ?? 0, 0, 'A request target is not an announced sender binding');
  send('reply', '192.0.2.10', '255.255.255.255'); assert.equal(sw.runtime.features.arpInspectionDrops, 1);
  send('request', '239.1.1.1', '192.0.2.20'); assert.equal(sw.runtime.features.arpInspectionDrops, 2);
  send('request', '192.0.2.99', '192.0.2.20'); assert.equal(sw.runtime.features.arpInspectionDrops, 3, 'Sender binding validation still applies');
});

test('router output ACLs count transit denials while locally originated echoes still use ingress checks', () => {
  const { s, inside, router, outside } = routed(), cli = new IOSSession(s, router.id);
  commands(cli, 'enable', 'configure terminal', 'ip access-list extended EGRESS', '10 deny icmp any any', '20 permit ip any any', 'exit', 'interface g0/1', 'ip access-group EGRESS out', 'end');
  const local = s.ping(router.id, outside.config.interfaces[p].ip!, { count: 1 }); s.advance(1000);
  assert.equal(local.received, 1); assert.equal(router.runtime.features.aclHits?.['EGRESS:10'] ?? 0, 0);
  const transit = s.ping(inside.id, outside.config.interfaces[p].ip!, { count: 1 }); s.advance(1500);
  assert.equal(transit.received, 0); assert.equal(router.runtime.features.aclHits['EGRESS:10'], 1);
  commands(cli, 'configure terminal', 'interface g0/1', 'ip access-group EGRESS in', 'end');
  const blockedReply = s.ping(router.id, outside.config.interfaces[p].ip!, { count: 1 }); s.advance(1500);
  assert.equal(blockedReply.received, 0); assert.ok(router.runtime.features.aclHits['EGRESS:10'] > 1, 'Ingress filtering still governs a router-addressed reply');
});

test('PBR default next hop overrides only a default route and falls back when its adjacent link is down', () => {
  const s = new Simulator(903), pc = s.addDevice('pc'), r = s.addDevice('router'), normal = s.addDevice('router'), policy = s.addDevice('router'), server = s.addDevice('server');
  ip(pc, p, '10.1.0.10'); pc.config.defaultGateway = '10.1.0.1'; ip(r, g(0), '10.1.0.1');
  ip(r, g(1), '10.12.0.1'); ip(normal, g(0), '10.12.0.2'); ip(r, g(2), '10.13.0.1'); ip(policy, g(0), '10.13.0.2');
  ip(normal, g(1), '10.23.0.1'); ip(policy, g(1), '10.23.0.2'); ip(normal, g(2), '198.51.100.1'); ip(server, p, '198.51.100.2'); server.config.defaultGateway = '198.51.100.1';
  cable(s, pc, p, r, g(0)); cable(s, r, g(1), normal, g(0)); cable(s, r, g(2), policy, g(0)); cable(s, normal, g(1), policy, g(1)); cable(s, normal, g(2), server, p);
  r.config.staticRoutes.push({ network: '0.0.0.0', prefix: 0, nextHop: '10.12.0.2' });
  normal.config.staticRoutes.push({ network: '10.1.0.0', prefix: 24, nextHop: '10.12.0.1' });
  policy.config.staticRoutes.push({ network: '198.51.100.0', prefix: 24, nextHop: '10.23.0.1' });
  const cli = new IOSSession(s, r.id);
  commands(cli, 'enable', 'configure terminal', 'ip access-list standard CLIENT', '10 permit host 10.1.0.10', 'exit', 'route-map DEFAULT-POLICY permit 10', 'match ip address CLIENT', 'set ip default next-hop 10.13.0.2', 'exit', 'interface g0/0', 'ip policy route-map DEFAULT-POLICY', 'end');
  const check = (port: string) => { const start = s.events.length, probe = s.ping(pc.id, '198.51.100.2', { count: 1 }); s.advance(1500); assert.equal(probe.received, 1); assert.ok(s.events.slice(start).some(e => e.nodeId === r.id && e.label === 'IP forwarded' && e.port === port && e.packet?.destination === '198.51.100.2')); };
  check(g(2)); assert.equal(r.runtime.features.pbrCounters['DEFAULT-POLICY'][10].selected, 1);
  r.config.staticRoutes.push({ network: '198.51.100.0', prefix: 24, nextHop: '10.12.0.2' }); s.changed(); check(g(1));
  assert.equal(r.runtime.features.pbrCounters['DEFAULT-POLICY'][10].selected, 1, 'An explicit usable prefix prevents default PBR');
  r.config.staticRoutes.pop(); r.config.interfaces[g(2)].adminUp = false; s.changed(); check(g(1));
  assert.equal(r.runtime.features.pbrCounters['DEFAULT-POLICY'][10].selected, 1, 'A default route cannot make a disconnected policy next hop adjacent');
  assert.match(cli.execute('show route-map DEFAULT-POLICY').join('\n'), /Policy routing matches: 3 packets/);
});

test('allocated basic dynamic NAT accepts fresh outside protocols and preserves their ports until idle expiry', () => {
  const { s, inside, router, outside } = routed(), cli = new IOSSession(s, router.id);
  delete outside.config.defaultGateway;
  commands(cli, 'enable', 'configure terminal', 'ip access-list extended ALLOCATE', '10 permit icmp host 10.1.0.10 any echo', 'exit', 'ip nat pool ONE 203.0.113.100 203.0.113.100 netmask 255.255.255.0', 'ip nat inside source list ALLOCATE pool ONE', 'interface g0/0', 'ip nat inside', 'exit', 'interface g0/1', 'ip nat outside', 'end');
  s.registerUDPService(9000, d => d.id === inside.id, (_d, payload, source) => ({ payload, source }));
  const premature = s.udpRequest(outside.id, '203.0.113.100', 9000, { before: true }); s.advance(11000); assert.equal(premature.status, 'failure');
  commands(cli,'configure terminal','ip nat translation timeout 5','ip nat translation icmp-timeout 5','ip nat translation udp-timeout 5','end');
  const allocate = s.ping(inside.id, '203.0.113.2', { count: 1 }); s.advance(1000); assert.equal(allocate.received, 1);
  assert.equal(router.runtime.features.natTranslations.length, 1); assert.equal(router.runtime.features.aclHits['ALLOCATE:10'], 1);
  const fresh = s.udpRequest(outside.id, '203.0.113.100', 9000, { fresh: true }, { sourcePort: 44000 }); s.advance(1000);
  assert.equal(fresh.status, 'success'); assert.deepEqual(fresh.payload, { fresh: true }); assert.equal(fresh.source, '203.0.113.2');
  assert.equal(router.runtime.features.natTranslations.length, 1, 'One basic address allocation serves both protocols');
  assert.equal(router.runtime.features.aclHits['ALLOCATE:10'], 1, 'The new UDP return flow does not need an allocation ACL match');
  assert.ok(s.events.some(e => e.nodeId === router.id && e.label === 'IP forwarded' && e.packet?.source === '203.0.113.100' && e.packet?.sourcePort === 9000 && e.packet?.destinationPort === 44000));
  const echo = s.ping(outside.id, '203.0.113.100', { count: 1 }); s.advance(1000); assert.equal(echo.received, 1, 'An independently originated echo also reaches the inside host');
  s.advance(5500); assert.equal(router.runtime.features.natTranslations.length, 0);
  const expired = s.udpRequest(outside.id, '203.0.113.100', 9000, { expired: true }); s.advance(11000); assert.equal(expired.status, 'failure');
});

test('PAT accepts the established remote transport tuple and rejects a fresh outside source port', () => {
  const { s, inside, router, outside } = routed(); delete outside.config.defaultGateway;
  router.config.interfaces[g(0)].features.nat = 'inside'; router.config.interfaces[g(1)].features.nat = 'outside';
  router.config.features.nat = { rules: [{ interface: g(1), overload: true }] }; s.changed();
  let delivered = 0;
  s.registerUDPService(9001, d => d.id === outside.id, () => ({ accepted: true }));
  s.registerUDPService(40000, d => d.id === inside.id, () => { delivered++; return { accepted: true }; });
  const initial = s.udpRequest(inside.id, '203.0.113.2', 9001, {}, { sourcePort: 40000 }); s.advance(1000); assert.equal(initial.status, 'success');
  const mapping = router.runtime.features.natTranslations[0]; assert.equal(mapping.remotePort, 9001);
  const newTuple = s.udpRequest(outside.id, mapping.outside, mapping.outsidePort, {}, { sourcePort: 9002 }); s.advance(11000);
  assert.equal(newTuple.status, 'failure'); assert.equal(delivered, 0, 'A nonmatching remote port cannot use a PAT pinhole');
});

test('ICMP ACL message selectors distinguish echo requests, replies and numeric error codes', () => {
  const { s, inside, router, outside } = routed(), cli = new IOSSession(s, router.id);
  commands(cli, 'enable', 'configure terminal', 'ip access-list extended MESSAGES', '10 deny icmp any any echo-reply', '20 permit ip any any', 'exit', 'interface g0/1', 'ip access-group MESSAGES in', 'end');
  const blockedReply = s.ping(inside.id, '203.0.113.2', { count: 1 }); s.advance(1500); assert.equal(blockedReply.received, 0);
  const permittedRequest = s.ping(outside.id, '10.1.0.10', { count: 1 }); s.advance(1500); assert.equal(permittedRequest.received, 1);
  assert.equal(router.runtime.features.aclHits['MESSAGES:10'], 1);
  commands(cli, 'configure terminal', 'ip access-list extended ERRORS', '10 permit icmp any any 3 3', '20 deny ip any any', 'exit', 'interface g0/1', 'ip access-group ERRORS in', 'end');
  const refused = s.udpRequest(inside.id, '203.0.113.2', 9999, {}); s.advance(1000); assert.equal(refused.status, 'failure'); assert.match(refused.error!, /Port unreachable/); assert.equal(router.runtime.features.aclHits['ERRORS:10'], 1);
  commands(cli, 'configure terminal', 'ip access-list extended ERRORS', '10 permit icmp any any 3 1', 'end');
  const unanswered = s.udpRequest(inside.id, '203.0.113.2', 9999, {}); s.advance(11000); assert.equal(unanswered.status, 'failure'); assert.match(unanswered.error!, /timed out/);
  assert.equal(router.runtime.features.aclHits['ERRORS:10'], 1, 'A different unreachable code cannot increment the permit counter');
});

test('classic NetFlow aggregates ICMP by packed message type/code and exports real echo/error flows', () => {
  const { s, inside, router, outside } = routed();
  router.config.interfaces[g(0)].features.netflowIn = true; router.config.interfaces[g(0)].features.netflowOut = true; router.config.interfaces[g(1)].features.netflowIn = true;
  router.config.features.netflow = { destination: '203.0.113.2', port: 2055 }; outside.config.services.netflow = { enabled: true };
  router.config.features.flowRecords = { PORTS: { match: ['ipv4 source address', 'ipv4 destination address', 'ip protocol', 'transport source-port', 'transport destination-port'] } };
  router.config.features.flowMonitors = { PORTS: { record: 'PORTS' } };
  router.config.interfaces[g(0)].features.flowMonitorIn = 'PORTS'; router.config.interfaces[g(0)].features.flowMonitorOut = 'PORTS'; router.config.interfaces[g(1)].features.flowMonitorIn = 'PORTS'; s.changed();
  const first = s.ping(inside.id, '203.0.113.2', { count: 1 }); s.advance(1000); assert.equal(first.received, 1);
  const second = s.ping(inside.id, '203.0.113.2', { count: 1 }); s.advance(1000); assert.equal(second.received, 1);
  const expired = s.ping(inside.id, '203.0.113.2', { count: 1, ttl: 1 }); s.advance(1000); assert.match(expired.replies[0].error!, /Time exceeded/);
  const unreachable = s.udpRequest(inside.id, '203.0.113.2', 9999, {}, { sourcePort: 44444 }); s.advance(2000); assert.match(unreachable.error!, /Port unreachable/);
  const classic: any[] = router.runtime.features.netflowCache;
  const echoRequests = classic.filter(flow => flow.protocol === 'icmp' && flow.source === '10.1.0.10' && flow.destinationPort === (8 << 8));
  assert.equal(echoRequests.length, 1, 'Different probe identifiers share the same classic ICMP message flow'); assert.equal(echoRequests[0].packets, 2);
  assert.ok(classic.filter(flow => flow.protocol === 'icmp').every(flow => flow.sourcePort === 0));
  assert.ok(classic.some(flow => flow.protocol === 'icmp' && flow.source === '203.0.113.2' && flow.destinationPort === 0 && flow.packets === 2));
  assert.ok(classic.some(flow => flow.protocol === 'icmp' && flow.source === '10.1.0.1' && flow.destinationPort === (11 << 8)));
  assert.ok(classic.some(flow => flow.protocol === 'icmp' && flow.destinationPort === ((3 << 8) | 3)));
  assert.ok(classic.some(flow => flow.protocol === 'udp' && flow.sourcePort === 44444 && flow.destinationPort === 9999));
  const received: any[] = outside.runtime.features.netflowReceived;
  assert.equal(received.filter(flow => flow.protocol === 'icmp' && flow.source === '10.1.0.10' && flow.destinationPort === (8 << 8)).reduce((sum, flow) => sum + flow.packets, 0), 2);
  assert.ok(received.some(flow => flow.protocol === 'icmp' && flow.sourcePort === 0 && flow.destinationPort === ((3 << 8) | 3)));
  const flexible: any[] = router.runtime.features.flowMonitorCaches.PORTS;
  assert.ok(flexible.filter(flow => flow.protocol === 'icmp').every(flow => flow.sourcePort === 0 && flow.destinationPort === 0), 'Flexible transport fields are zero for non-transport ICMP, without classic packing');
  assert.ok(flexible.some(flow => flow.protocol === 'udp' && flow.sourcePort === 44444 && flow.destinationPort === 9999));
});

test('validated DHCP RELEASE passes source guard, removes its binding, and rejects another port or client identity', () => {
  const s = new Simulator(904), pc = s.addDevice('pc'), attacker = s.addDevice('pc'), sw = s.addDevice('switch'), server = s.addDevice('server');
  attacker.config.interfaces[p].features.dhcp = false;
  ip(server, p, '192.0.2.1'); server.config.services.dhcp = { enabled: true, pools: [{ name: 'LAN', network: '192.0.2.0', prefix: 24, defaultRouter: '192.0.2.1', dnsServers: [] }], excluded: [] };
  sw.config.features.dhcpSnooping = { enabled: true, vlans: [1] };
  sw.config.interfaces[g(1)].features = { portfast: true, sourceGuard: true }; sw.config.interfaces[g(2)].features = { portfast: true, dhcpSnoopingTrust: true }; sw.config.interfaces[g(3)].features.portfast = true;
  cable(s, pc, p, sw, g(1)); cable(s, server, p, sw, g(2)); cable(s, attacker, p, sw, g(3)); s.advance(1100);
  const lease = s.requestDHCP(pc.id); s.advance(1000); assert.equal(lease.status, 'success'); const address = pc.config.interfaces[p].ip!;
  const warm = s.ping(pc.id, '192.0.2.1', { count: 1 }); s.advance(1000); assert.equal(warm.received, 1);
  const forge = (from: Device, clientId: string, requestedAddress = address) => { (s as any).transmit(from, p, 'ff:ff:ff:ff:ff:ff', { kind: 'dhcp', operation: 'release', clientId, transaction: 'forged-release', serverId: server.id, address: requestedAddress }); s.advance(20); };
  forge(attacker, pc.id); forge(pc, 'wrong-client'); forge(pc, pc.id, '192.0.2.99');
  assert.equal(sw.runtime.features.dhcpSnoopingDrops, 3); assert.equal(sw.runtime.features.dhcpBindings.length, 1); assert.equal(server.runtime.features.dhcpLeases.length, 1);
  s.releaseDHCP(pc.id); s.advance(1000);
  assert.equal(sw.runtime.features.sourceGuardDrops ?? 0, 0); assert.equal(sw.runtime.features.dhcpBindings.length, 0); assert.equal(server.runtime.features.dhcpLeases.length, 0);
  assert.ok(s.events.some(e => e.label === 'Snooping binding released'));
  ip(pc, p, address); pc.config.defaultGateway = '192.0.2.1'; s.changed();
  const stale = s.ping(pc.id, '192.0.2.1', { count: 1 }); s.advance(1500); assert.equal(stale.received, 0); assert.ok(sw.runtime.features.sourceGuardDrops > 0);
});
