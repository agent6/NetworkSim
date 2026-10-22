import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import { parseDocument, parseLabFile, serializeLabFile } from '../src/persistence.ts';
import type { Device } from '../src/model.ts';
import type { NhrpRuntime } from '../src/nhrp.ts';
import { command, fixture } from './helpers/dmvpn.ts';
function state(d: Device): NhrpRuntime { return d.runtime.features.nhrp.Tunnel0; }
function ping(f: ReturnType<typeof fixture>, count = 2) {
  const result = f.sim.ping(f.nodes[1].device.id, '172.16.3.1', { source: '172.16.2.1', count });
  f.sim.advance(4500); return result;
}

test('protected NHRP registration itself establishes dynamic per-peer ESP without an IGP or data probe', () => {
  const f = fixture({ protectedTunnel: true, routing: false });
  assert.equal(state(f.nodes[0].device).cache.filter(c => c.registered).length, 2);
  for (const node of f.nodes.slice(1)) {
    assert.equal(state(node.device).registrations[0].state, 'UP');
    assert.ok(node.device.runtime.features.ipsecSAs.some((s: { peer: string; encaps: number }) => s.peer === f.nodes[0].nbma && s.encaps > 0));
  }
});
test('single-hub Phase 2 learns EIGRP LAN routes and carries direct protected spoke-to-spoke traffic', () => {
  const f = fixture({ protectedTunnel: true }), a = f.nodes[1].device;
  assert.equal(a.runtime.routes.find(r => r.network === '172.16.3.0')?.nextHop, '10.10.10.3');
  assert.equal(ping(f).received, 2);
  assert.ok(a.runtime.features.ipsecSAs.some((s: { peer: string; ready: boolean }) => s.peer === f.nodes[2].nbma && s.ready));
  assert.equal(a.runtime.neighbors.filter(n => n.protocol === 'EIGRP').length, 1);
  assert.ok(f.nodes.every(n => n.device.config.staticRoutes.every(r => r.prefix === 0)));
});
test('Phase 3 redirects through the hub then installs a prefix-aware CEF shortcut without rewriting the EIGRP RIB', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1].device, hub = f.nodes[0].device;
  assert.equal(f.sim.cefLookup(a.id, '172.16.3.1')?.target, '10.10.10.1');
  assert.equal(ping(f, 1).received, 1);
  assert.ok(f.sim.events.some(e => e.label === 'NHRP redirect sent'));
  assert.ok(state(a).shortcuts.some(c => c.network === '172.16.3.0' && c.prefix === 24));
  assert.equal(f.sim.cefLookup(a.id, '172.16.3.44')?.target, '10.10.10.3');
  assert.equal(a.runtime.routes.find(r => r.network === '172.16.3.0')?.nextHop, '10.10.10.1');
  assert.match(f.nodes[1].cli.execute('show ip route 172.16.3.1').join('\n'), /NHRP next-hop override: 172\.16\.3\.0\/24 via 10\.10\.10\.3/);
  assert.match(f.nodes[1].cli.execute('show ip cef 172.16.3.44').join('\n'), /10\.10\.10\.3/);
  assert.match(f.nodes[1].cli.execute('show ip cef exact-route 172.16.2.1 172.16.3.44').join('\n'), /next hop 10\.10\.10\.3/);
  const start = f.sim.events.length;
  assert.equal(ping(f).received, 2);
  assert.ok(!f.sim.events.slice(start).some(e => e.nodeId === hub.id && e.label === 'IP forwarded' && ['172.16.3.1', '172.16.2.1'].includes(e.packet?.destination ?? '')));
  assert.ok(a.runtime.features.ipsecSAs.some((s: { peer: string; ready: boolean }) => s.peer === f.nodes[2].nbma && s.ready));
});
test('wrong IPsec keys cannot register NHRP or manufacture routing neighbors', () => {
  const f = fixture({ protectedTunnel: true, wrongKey: true }), b = f.nodes[2].device;
  assert.notEqual(state(b).registrations[0].state, 'UP');
  assert.ok(!state(f.nodes[0].device).cache.some(c => c.address === '10.10.10.3'));
  assert.ok(!b.runtime.neighbors.some(n => n.protocol === 'EIGRP'));
  assert.equal(ping(f, 1).received, 0);
  assert.ok(f.sim.events.some(e => /Pre-shared key mismatch/.test(e.detail)));
});
test('a protected hub rejects plaintext GRE registration and routing packets', () => {
  const f = fixture({ hubOnly: true });
  assert.equal(state(f.nodes[0].device).cache.filter(c => c.registered).length, 0);
  assert.ok(f.sim.events.some(e => e.nodeId === f.nodes[0].device.id && e.label === 'Unprotected GRE rejected'));
  assert.ok(f.nodes.slice(1).every(n => state(n.device).registrations[0].state !== 'UP'));
});
test('loopback-sourced protected DMVPN preserves configured NBMA endpoints across a front-door VRF', () => {
  const f = fixture({ protectedTunnel: true, phase3: true, loopback: true, vrf: true });
  assert.equal(ping(f).received, 2);
  for (const n of f.nodes) for (const sa of n.device.runtime.features.ipsecSAs ?? []) {
    assert.equal(sa.local, n.nbma); assert.equal(sa.vrf, 'WAN'); assert.equal(sa.interface, 'Tunnel0');
  }
});
test('regression: protected loopback DMVPN keeps its SAs and delivers packets through WAN failover and recovery', () => {
  for (const vrf of [false, true]) {
    const f = fixture({ protectedTunnel: true, loopback: true, vrf }), spoke = f.nodes[1], hub = f.nodes[0];
    const transit = new IOSSession(f.sim, f.isp.id), routeScope = vrf ? 'vrf WAN ' : '';
    const probe = (from: typeof spoke, target: string, source: string) => {
      const result = f.sim.ping(from.device.id, target, { source, count: 2, timeout: 1000 });
      assert.equal(f.sim.advance(3000, 200000).targetReached, true);
      assert.equal(result.received, 2, JSON.stringify(result.replies));
    };
    probe(spoke, '172.16.1.1', '172.16.2.1');
    const sa = spoke.device.runtime.features.ipsecSAs.find((s: { peer: string; ready: boolean }) => s.peer === hub.nbma && s.ready);
    assert.ok(sa); const decaps = sa.decaps;
    command(transit, 'enable', 'conf t', 'interface g0/3');
    if (vrf) command(transit, 'vrf forwarding WAN');
    command(transit, 'ip address 198.20.0.1 255.255.255.252', 'no shutdown', 'exit',
      `ip route ${routeScope}${spoke.nbma} 255.255.255.255 198.20.0.2 200`, 'end');
    command(spoke.cli, 'conf t', 'interface g0/1');
    if (vrf) command(spoke.cli, 'vrf forwarding WAN');
    command(spoke.cli, 'ip address 198.20.0.2 255.255.255.252', 'no shutdown', 'exit',
      `ip route ${routeScope}0.0.0.0 0.0.0.0 198.20.0.1 200`, 'end');
    f.sim.connect({ deviceId: spoke.device.id, port: 'GigabitEthernet0/1' }, { deviceId: f.isp.id, port: 'GigabitEthernet0/3' });
    command(spoke.cli, 'conf t', 'interface g0/0', 'shutdown', 'end');
    assert.equal(f.sim.interfaceUp(spoke.device.id, 'Tunnel0'), true);
    assert.equal(f.sim.cefLookup(spoke.device.id, hub.nbma, vrf ? 'WAN' : undefined)?.port, 'GigabitEthernet0/1');
    probe(spoke, '172.16.1.1', '172.16.2.1');
    probe(hub, '172.16.2.1', '172.16.1.1');
    assert.ok(spoke.device.runtime.features.ipsecSAs.includes(sa));
    assert.equal(sa.ready, true); assert.ok(sa.decaps > decaps);
    command(spoke.cli, 'conf t', 'interface g0/0', 'no shutdown', 'end');
    assert.equal(f.sim.cefLookup(spoke.device.id, hub.nbma, vrf ? 'WAN' : undefined)?.port, 'GigabitEthernet0/0');
    probe(spoke, '172.16.1.1', '172.16.2.1');
    assert.ok(spoke.device.runtime.features.ipsecSAs.includes(sa));
  }
});
test('a third spoke dynamically joins without editing the hub configuration or peer keys', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), before = renderConfig(f.nodes[0].device).join('\n');
  const c = f.add(); f.sim.advance(8500);
  assert.equal(renderConfig(f.nodes[0].device).join('\n'), before);
  assert.equal(state(c.device).registrations[0].state, 'UP');
  const result = f.sim.ping(f.nodes[1].device.id, '172.16.4.1', { source: '172.16.2.1', count: 2 }); f.sim.advance(4500);
  assert.equal(result.received, 2);
  assert.equal(f.sim.cefLookup(f.nodes[1].device.id, '172.16.4.8')?.target, '10.10.10.4');
});
test('DMVPN verification exposes real state and counters without mutating runtime or exposing keys', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }); assert.equal(ping(f).received, 2);
  for (const n of f.nodes) {
    const before = JSON.stringify(n.device.runtime);
    for (const line of ['show dmvpn detail', 'show ip nhrp', 'show ip nhrp nhs detail', 'show ip nhrp traffic', 'show ip nhrp multicast', 'show crypto sockets', 'show crypto ipsec profile DM-IPSEC']) {
      const output = n.cli.execute(line).join('\n'); assert.doesNotMatch(output, /^%/m, line); assert.doesNotMatch(output, /dmvpn-lab|not tracked|created \?/);
    }
    assert.equal(JSON.stringify(n.device.runtime), before);
    const tunnel = n.cli.execute('show interfaces tunnel0').join('\n');
    assert.match(tunnel, /Key 0x0000007B \(123\)/);
    assert.match(tunnel, /Tunnel protection via IPSec \(profile "DM-IPSEC"\)/);
  }
});
test('clearing NHRP removes shortcuts, preserves static NHS mappings, and registers afresh', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1];
  assert.equal(ping(f).received, 2);
  command(a.cli, 'clear ip nhrp interface tunnel0');
  assert.equal(state(a.device).shortcuts.length, 0);
  assert.ok(state(a.device).cache.some(c => c.address === '10.10.10.1' && c.type === 'static'));
  assert.equal(f.sim.cefLookup(a.device.id, '172.16.3.1')?.target, '10.10.10.1');
  f.sim.advance(1000); assert.equal(state(a.device).registrations[0].state, 'UP');
  assert.equal(ping(f).received, 2);
});

test('unprotected Phase 2 and Phase 3 retain working direct GRE forwarding', () => {
  for (const phase3 of [false, true]) {
    const f = fixture({ phase3 });
    assert.equal(ping(f).received, 2);
    assert.equal(f.sim.cefLookup(f.nodes[1].device.id, '172.16.3.1')?.target, '10.10.10.3');
    assert.ok(f.sim.events.some(e => e.packet?.protocol === 'GRE'));
    assert.equal(f.nodes[1].device.runtime.features.ipsecSAs?.length ?? 0, 0);
  }
});
test('protected point-to-multipoint OSPF forms dynamic hub adjacencies and Phase 3 delivers direct spoke traffic', () => {
  const f = fixture({ protectedTunnel: true, routing: 'ospf', phase3: true }); f.sim.advance(35000);
  for (const n of f.nodes.slice(1)) assert.ok(n.device.runtime.neighbors.some(p => p.protocol === 'OSPF' && /FULL/i.test(p.state)));
  assert.equal(ping(f).received, 2);
  assert.ok(f.nodes[1].device.runtime.features.ipsecSAs.some((s: { peer: string; ready: boolean }) => s.peer === f.nodes[2].nbma && s.ready));
});
test('PFS, transform, GRE-key, NHRP-authentication and missing-profile failures isolate one peer and recover', () => {
  const faults = [
    ['crypto ipsec profile DM-IPSEC', 'set pfs group19', 'set pfs group14'],
    ['crypto ipsec transform-set DM-TS esp-aes 256 esp-sha-hmac', 'mode tunnel', 'mode transport'],
    ['interface tunnel0', 'tunnel key 999', 'tunnel key 123'],
    ['interface tunnel0', 'ip nhrp authentication wrong', 'ip nhrp authentication lesson'],
  ];
  for (const [context, bad, good] of faults) {
    const f = fixture({ protectedTunnel: true, routing: false }), b = f.nodes[2];
    command(b.cli, 'conf t', context, bad, 'end'); f.sim.advance(8500);
    assert.notEqual(state(b.device).registrations[0].state, 'UP', bad);
    assert.equal(state(f.nodes[1].device).registrations[0].state, 'UP', bad);
    assert.equal(f.sim.interfaceUp(f.nodes[0].device.id, 'Tunnel0'), true, bad);
    command(b.cli, 'conf t', context, good, 'end'); f.sim.advance(8500);
    assert.equal(state(b.device).registrations[0].state, 'UP', good);
  }
  const f = fixture({ protectedTunnel: true, routing: false }), b = f.nodes[2];
  command(b.cli, 'conf t', 'no crypto ipsec profile DM-IPSEC', 'end'); f.sim.advance(8500);
  assert.notEqual(state(b.device).registrations[0].state, 'UP');
  assert.ok(f.sim.events.some(e => e.detail.includes('Missing IPsec protection profile')));
});
test('idle shortcuts expire back to the hub and protected data triggers fresh resolution and expired-SA replacement', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1].device;
  assert.equal(ping(f).received, 2);
  const oldIds = new Set(a.runtime.features.ipsecSAs.map((s: { id: string }) => s.id));
  f.sim.advance(68000, 100000);
  assert.equal(state(a).shortcuts.length, 0);
  assert.equal(f.sim.cefLookup(a.id, '172.16.3.1')?.target, '10.10.10.1');
  assert.equal(a.runtime.routes.find(r => r.network === '172.16.3.0')?.nextHop, '10.10.10.1');
  assert.equal(ping(f).received, 2);
  assert.equal(f.sim.cefLookup(a.id, '172.16.3.1')?.target, '10.10.10.3');
  assert.ok(a.runtime.features.ipsecSAs.some((s: { id: string; peer: string; ready: boolean }) => s.peer === f.nodes[2].nbma && s.ready && !oldIds.has(s.id)));
});
test('used shortcuts refresh while traffic continues across the IPsec lifetime', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1].device;
  assert.equal(ping(f).received, 2);
  for (let i = 0; i < 14; i++) {
    const result = f.sim.ping(a.id, '172.16.3.1', { source: '172.16.2.1', count: 1 }); f.sim.advance(5000);
    assert.equal(result.received, 1);
    assert.equal(f.sim.cefLookup(a.id, '172.16.3.1')?.target, '10.10.10.3');
  }
  assert.ok((state(a).sent.resolve ?? 0) >= 3);
});
test('an NBMA address change purges old shortcuts and resolves the new protected endpoint', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1], b = f.nodes[2], isp = new IOSSession(f.sim, f.isp.id);
  assert.equal(ping(f).received, 2);
  command(isp, 'enable', 'conf t', 'interface g0/2', 'ip address 198.20.0.1 255.255.255.252', 'end');
  command(b.cli, 'conf t', 'interface g0/0', 'ip address 198.20.0.2 255.255.255.252', 'exit',
    'no ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'ip route 0.0.0.0 0.0.0.0 198.20.0.1', 'end');
  f.sim.advance(8500);
  assert.ok(!state(a.device).shortcuts.some(c => c.nbma === b.nbma));
  assert.equal(ping(f).received, 2);
  assert.ok(state(a.device).shortcuts.some(c => c.nbma === '198.20.0.2'));
});
test('NHS loss expires registration even after a clear, then recovery rebuilds dynamic routing', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1];
  const link = f.sim.lab.links.find(l => l.a.deviceId === f.nodes[0].device.id)!;
  link.lossAB = 1; f.sim.changed();
  command(a.cli, 'clear ip nhrp interface tunnel0');
  f.sim.advance(45000, 100000);
  assert.equal(state(a.device).registrations[0].state, 'DOWN');
  assert.ok(!a.device.runtime.neighbors.some(n => n.protocol === 'EIGRP'));
  link.lossAB = 0; f.sim.changed(); f.sim.advance(75000, 100000);
  assert.equal(state(a.device).registrations[0].state, 'UP');
  assert.equal(ping(f).received, 2);
});
test('an NHS without an NBMA mapping remains visible as incomplete rather than disappearing', () => {
  const f = fixture({ routing: false }), a = f.nodes[1];
  command(a.cli, 'conf t', 'interface tunnel0', 'no ip nhrp nhs 10.10.10.1', 'ip nhrp nhs 10.10.10.1', 'end');
  f.sim.advance(1000);
  assert.equal(state(a.device).registrations[0].state, 'DOWN');
  assert.match(a.cli.execute('show ip nhrp nhs detail').join('\n'), /10\.10\.10\.1, NBMA incomplete/);
  command(a.cli, 'conf t', 'interface tunnel0', 'ip nhrp map 10.10.10.1 198.51.100.2', 'end'); f.sim.advance(1000);
  assert.equal(state(a.device).registrations[0].state, 'UP');
});
test('GRE resolution queues are bounded and clearing NHRP cancels held data and stale replies', () => {
  const f = fixture(), a = f.nodes[1];
  const probes = Array.from({ length: 80 }, () => f.sim.ping(a.device.id, '172.16.3.1', { source: '172.16.2.1', count: 1 }));
  f.sim.advance(0);
  assert.equal(f.sim.events.filter(e => e.nodeId === a.device.id && e.label === 'NHRP queue full').length, 16);
  command(a.cli, 'clear ip nhrp interface tunnel0'); f.sim.advance(3000);
  assert.equal(probes.reduce((n, p) => n + p.received, 0), 0);
  assert.equal(f.sim.events.filter(e => e.nodeId === a.device.id && e.label === 'NHRP resolution cancelled').length, 64);
  assert.equal(ping(f).received, 2);
});
test('scoped IPsec and IKE clears preserve the other SA family and other peer sessions', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1];
  assert.equal(ping(f).received, 2);
  const ikeCount = a.device.runtime.features.isakmpSAs.length;
  command(a.cli, `clear crypto ipsec sa peer ${f.nodes[2].nbma}`);
  assert.equal(a.device.runtime.features.isakmpSAs.length, ikeCount);
  assert.ok(a.device.runtime.features.ipsecSAs.every((s: { peer: string }) => s.peer !== f.nodes[2].nbma));
  assert.ok(a.device.runtime.features.ipsecSAs.some((s: { peer: string }) => s.peer === f.nodes[0].nbma));
  assert.equal(ping(f).received, 2);
  const count = a.device.runtime.features.ipsecSAs.length;
  command(a.cli, `clear crypto isakmp sa peer ${f.nodes[2].nbma}`);
  assert.equal(a.device.runtime.features.ipsecSAs.length, count);
  assert.equal(ping(f).received, 2);
});
test('DMVPN running/startup settings survive YAML, JSON, rendered replay and reload without restored runtime', () => {
  const f = fixture({ protectedTunnel: true, phase3: true, vrf: true, loopback: true });
  for (const n of f.nodes) command(n.cli, 'write memory');
  f.isp.startupConfig = structuredClone(f.isp.config);
  const expected = renderConfig(f.nodes[1].device).join('\n');
  for (const document of [parseDocument(JSON.stringify(f.sim.serialize())), parseLabFile(serializeLabFile(f.sim.serialize()))]) {
    const sim = new Simulator(); sim.load(document); sim.advance(8500);
    const a = sim.getDevice(f.nodes[1].device.id)!;
    assert.equal(renderConfig(a).join('\n'), expected);
    assert.equal(state(a).registrations[0].state, 'UP');
    assert.equal(state(a).shortcuts.length, 0);
    sim.reload(a.id); sim.advance(8500);
    const result = sim.ping(a.id, '172.16.3.1', { source: '172.16.2.1', count: 2 }); sim.advance(4500);
    assert.equal(result.received, 2);
  }
  const replay = new Simulator(), d = replay.addDevice('router'), cli = new IOSSession(replay, d.id);
  d.config.features.files = { replay: expected };
  command(cli, 'enable', 'copy flash:replay running-config');
  assert.equal(renderConfig(d).join('\n'), expected);
});
test('malformed NHRP/IPsec running and startup imports reject before changing the live lab', () => {
  const f = fixture({ protectedTunnel: true }), document = f.sim.serialize();
  for (const n of document.lab.devices) n.startupConfig = structuredClone(n.config);
  const mutations = [
    (c: Device['config']) => { c.interfaces.Tunnel0.features.nhrp.holdtime = 0; },
    (c: Device['config']) => { c.interfaces.Tunnel0.features.nhrp.nhs = [{ address: '10.10.10.1', nbma: ['198.51.100.2'] }]; },
    (c: Device['config']) => { c.interfaces.Tunnel0.features.nhrp.maps = 'invalid'; },
    (c: Device['config']) => { c.features.crypto.profiles.DM = { lifetime: -1 }; },
    (c: Device['config']) => { c.features.crypto.transformSets['DM-TS'].keyLength = [256]; },
  ];
  for (const field of ['config', 'startupConfig'] as const) for (const mutate of mutations) {
    const bad = structuredClone(document); mutate(bad.lab.devices[2][field]!);
    assert.throws(() => parseDocument(JSON.stringify(bad)), /GRE\/NHRP\/IPsec/);
    const before = JSON.stringify(f.sim.serialize());
    assert.throws(() => f.sim.load(bad), /GRE\/NHRP\/IPsec/);
    assert.equal(JSON.stringify(f.sim.serialize()), before);
  }
});
test('Phase 3 projects a LAN-prefix CEF shortcut beneath a hub summary without inserting a static route', () => {
  const f = fixture({ protectedTunnel: true, phase3: true }), a = f.nodes[1], hub = f.nodes[0];
  command(hub.cli, 'conf t', 'interface tunnel0', 'ip summary-address eigrp 100 172.16.0.0 255.255.0.0', 'end'); f.sim.advance(8500);
  assert.equal(f.sim.cefLookup(a.device.id, '172.16.3.1')?.route.prefix, 16);
  assert.equal(ping(f).received, 2);
  assert.equal(f.sim.cefLookup(a.device.id, '172.16.3.44')?.target, '10.10.10.3');
  assert.equal(f.sim.cefLookup(a.device.id, '172.16.4.1')?.target, '10.10.10.1');
  assert.match(a.cli.execute('show ip cef 172.16.3.44').join('\n'), /172\.16\.3\.0\/24[\s\S]*10\.10\.10\.3/);
  assert.match(a.cli.execute('show ip route 172.16.3.44').join('\n'), /Routing entry for 172\.16\.0\.0\/16[\s\S]*NHRP next-hop override: 172\.16\.3\.0\/24/);
  assert.ok(a.device.config.staticRoutes.every(r => r.prefix === 0));
});
test('a changed overlay route is revalidated before pending GRE packets leave the resolution queue', () => {
  const f = fixture(), a = f.nodes[1];
  const result = f.sim.ping(a.device.id, '172.16.3.1', { source: '172.16.2.1', count: 1 }); f.sim.advance(0);
  command(a.cli, 'conf t', 'ip route 172.16.3.0 255.255.255.0 Null0', 'end');
  f.sim.advance(4500);
  assert.equal(result.received, 0);
  assert.ok(!f.sim.events.some(e => e.nodeId === f.nodes[2].device.id && e.label === 'ICMP echo reply sent' && e.packet?.destination === '172.16.2.1'));
});
test('legacy NHS strings and protocolAddress mappings can be replaced and removed through the CLI', () => {
  const f = fixture({ routing: false }), a = f.nodes[1], config = a.device.config.interfaces.Tunnel0.features.nhrp;
  config.nhs = ['10.10.10.1']; config.maps = [{ protocolAddress: '10.10.10.1', nbma: f.nodes[0].nbma }]; f.sim.changed();
  command(a.cli, 'conf t', 'interface tunnel0', 'no ip nhrp nhs 10.10.10.1', 'no ip nhrp map 10.10.10.1 198.51.100.2', 'end');
  assert.deepEqual(config.nhs, []); assert.deepEqual(config.maps, []);
});
