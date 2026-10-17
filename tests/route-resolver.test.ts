import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultInterface, emptyRuntime, factoryDeviceConfig, type Device, type Route } from '../src/model.ts';
import { resolveForwardingPaths } from '../src/route-resolver.ts';
import { Simulator } from '../src/engine.ts';

type WeightedRoute = Route & { share?: number; global?: boolean };
function router(): Device {
  return { id: 'recursive-router', kind: 'router', x: 0, y: 0, powered: true,
    config: factoryDeviceConfig('router', 'Recursive'), runtime: emptyRuntime() };
}
function port(d: Device, name: string, ip: string, vrf?: string) {
  d.config.interfaces[name] = { ...defaultInterface(name), ip, mask: '255.255.255.0', vrf };
}
function route(network: string, nextHop?: string, intf = '', more: Partial<WeightedRoute> = {}): WeightedRoute {
  return { network, prefix: 24, nextHop, interface: intf, protocol: 'static', ad: 1, metric: 0, ...more };
}
function fixture() {
  const d = router(); port(d, 'GigabitEthernet0/0', '192.0.2.1'); port(d, 'GigabitEthernet0/1', '198.51.100.1');
  d.runtime.routes = [route('192.0.2.0', undefined, 'GigabitEthernet0/0', { ad: 0, protocol: 'connected' }),
    route('198.51.100.0', undefined, 'GigabitEthernet0/1', { ad: 0, protocol: 'connected' })];
  return d;
}
const usable = (d: Device, address = '203.0.113.22', vrf?: string) => resolveForwardingPaths(d, address, vrf, p => !!d.config.interfaces[p]?.adminUp);

test('recursive fanout preserves the weights of independent parent routes', () => {
  const d = fixture();
  d.runtime.routes.push(route('10.20.30.0', '192.0.2.2'), route('10.20.30.0', '198.51.100.2'),
    route('203.0.113.0', '10.20.30.8', '', { share: 1 }), route('203.0.113.0', '192.0.2.3', '', { share: 1 }));
  const paths = usable(d);
  assert.deepEqual(paths.map(p => [p.target, p.weight]), [['192.0.2.2', 0.5], ['198.51.100.2', 0.5], ['192.0.2.3', 1]]);
  assert.ok(paths.every(p => p.route.network === '203.0.113.0'));
  d.runtime.routes = d.runtime.routes.filter(r => r.nextHop !== '198.51.100.2');
  assert.deepEqual(usable(d).map(p => [p.target, p.weight]), [['192.0.2.2', 1], ['192.0.2.3', 1]]);
});

test('zero shares are excluded and unequal-cost multipath requires load sharing', () => {
  const d = fixture();
  d.runtime.routes.push(route('203.0.113.0', '192.0.2.2', '', { share: 0 }),
    route('203.0.113.0', '192.0.2.3', '', { share: 1, metric: 10, loadShare: true }),
    route('203.0.113.0', '198.51.100.2', '', { share: 3, metric: 20, loadShare: true }));
  assert.deepEqual(usable(d).map(p => p.weight), [1, 3]);
  d.runtime.routes.at(-1)!.loadShare = false;
  assert.deepEqual(usable(d).map(p => p.target), ['192.0.2.3']);
});

test('recursive VRF lookup switches tables only at an explicit global route', () => {
  const d = fixture(); port(d, 'GigabitEthernet0/2', '192.0.2.1', 'BLUE');
  d.runtime.routes.push(route('192.0.2.0', undefined, 'GigabitEthernet0/2', { vrf: 'BLUE', ad: 0 }),
    route('10.20.30.0', '192.0.2.7', '', { vrf: 'BLUE', global: true }),
    route('203.0.113.0', '10.20.30.8', '', { vrf: 'BLUE' }),
    route('203.0.113.0', '198.51.100.7'));
  assert.equal(usable(d, undefined, 'BLUE')[0].port, 'GigabitEthernet0/0');
  assert.equal(usable(d)[0].port, 'GigabitEthernet0/1');
  (d.runtime.routes.find(r => r.network === '10.20.30.0') as WeightedRoute).global = false;
  assert.equal(usable(d, undefined, 'BLUE')[0].port, 'GigabitEthernet0/2');
  assert.deepEqual(usable(d, undefined, 'RED'), []);
});

test('cyclic recursion terminates and unavailable paths give way to usable alternatives', () => {
  const d = fixture();
  d.runtime.routes.push(route('203.0.113.0', '10.20.30.8'), route('10.20.30.0', '203.0.113.22'));
  assert.deepEqual(usable(d), []);
  d.runtime.routes.push(route('203.0.113.0', '198.51.100.2', 'GigabitEthernet0/1', { ad: 200 }));
  assert.equal(usable(d)[0].port, 'GigabitEthernet0/1');
  d.config.interfaces['GigabitEthernet0/1'].adminUp = false;
  assert.deepEqual(usable(d), []);
  d.runtime.routes.push(route('0.0.0.0', undefined, 'Null0', { prefix: 0, ad: 250 }));
  assert.equal(usable(d)[0].port, 'Null0');
});

test('secondary IPv4 and IPv6 on-link next hops resolve without recursive routes', () => {
  const d = fixture(), c = d.config.interfaces['GigabitEthernet0/0'];
  c.features.secondaryIps = [{ ip: '172.20.1.1', mask: '255.255.255.0' }]; c.ipv6 = ['2001:db8:1::1/64'];
  d.runtime.routes.push(route('203.0.113.0', '172.20.1.2', c.name),
    route('2001:db8:2::', 'fe80::2', c.name, { prefix: 64 }));
  assert.equal(usable(d)[0].target, '172.20.1.2');
  assert.equal(usable(d, '2001:db8:2::99')[0].target, 'fe80::2');
  c.ipv6 = [];
  assert.deepEqual(usable(d, '2001:db8:2::99'), []);
});

test('weighted recursive CEF choices match delivered UDP flows and redistribute after link failure', () => {
  const sim = new Simulator(412), a = sim.addDevice('router'), b = sim.addDevice('router');
  const g = (n: number) => `GigabitEthernet0/${n}`;
  for (let n = 0; n < 3; n++) {
    port(a, g(n), `10.${n}.0.1`); port(b, g(n), `10.${n}.0.2`);
    sim.connect({ deviceId: a.id, port: g(n) }, { deviceId: b.id, port: g(n) });
  }
  port(b, 'Loopback0', '203.0.113.1');
  a.config.staticRoutes = [
    { network: '198.18.0.1', prefix: 32, nextHop: '10.0.0.2' },
    { network: '198.18.0.1', prefix: 32, nextHop: '10.1.0.2' },
    { network: '203.0.113.1', prefix: 32, nextHop: '198.18.0.1', share: 1 },
    { network: '203.0.113.1', prefix: 32, nextHop: '10.2.0.2', share: 1 },
  ];
  a.config.features.cefHash = { algorithm: 'include-ports', sourcePort: true, destinationPort: true, seed: 73 };
  sim.registerUDPService(9000, device => device.id === b.id, (_device, payload) => ({ number: payload.number }));
  sim.changed();
  const deliver = (number: number) => {
    const flow = { source: '10.0.0.1', sourcePort: 20000 + number, destinationPort: 9000, protocol: 'udp' };
    const predicted = sim.cefLookup(a.id, '203.0.113.1', undefined, flow)!.port;
    sim.events = [];
    const request = sim.udpRequest(a.id, '203.0.113.1', 9000, { number }, { source: flow.source, sourcePort: flow.sourcePort });
    sim.advance(20);
    assert.equal(request.status, 'success', `UDP flow ${number} completes its return path`);
    assert.equal(request.number, number);
    const sent = sim.events.filter(event => event.nodeId === a.id && event.label === 'Frame sent' && event.packet?.destination === '203.0.113.1');
    assert.equal(sent.length, 1); assert.equal(sent[0].port, predicted);
    return sent[0].port!;
  };
  const counts = [0, 0, 0];
  for (let n = 0; n < 200; n++) counts[Number(deliver(n).split('/').at(-1))]++;
  assert.ok(counts[0] > 30 && counts[0] < 70, String(counts));
  assert.ok(counts[1] > 30 && counts[1] < 70, String(counts));
  assert.ok(counts[2] > 80 && counts[2] < 120, 'Direct parent keeps half the traffic: ' + counts);
  assert.equal(deliver(17), deliver(17), 'Repeated transport tuple keeps its path');
  a.config.interfaces[g(1)].adminUp = false; sim.changed();
  const after = [0, 0, 0];
  for (let n = 200; n < 300; n++) after[Number(deliver(n).split('/').at(-1))]++;
  assert.equal(after[1], 0); assert.ok(after[0] > 30 && after[2] > 30, String(after));
});
