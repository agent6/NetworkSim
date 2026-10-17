import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { LinkActivity, portIndicator } from '../src/link-indicators.ts';

const g = (n: number) => 'GigabitEthernet0/' + n;
function configure(cli: IOSSession, ...commands: string[]) {
  for (const command of commands) {
    const output = cli.execute(command).join('\n');
    assert.ok(!/Invalid|Incomplete|^%/m.test(output), `${command}: ${output}`);
  }
}

test('endpoint indicator follows STP blocking and forwards after alternate-port failover', () => {
  const sim = new Simulator(131), a = sim.addDevice('switch'), b = sim.addDevice('switch');
  a.config.features.stp = { priority: 0 };
  b.config.features.stp = { priority: 8192 };
  const first = sim.connect({ deviceId: a.id, port: g(1) }, { deviceId: b.id, port: g(1) });
  const second = sim.connect({ deviceId: a.id, port: g(2) }, { deviceId: b.id, port: g(2) });
  sim.advance(3000);
  assert.equal(portIndicator(sim, b, g(1), first).state, 'up');
  assert.equal(portIndicator(sim, b, g(2), second).state, 'blocked');
  assert.match(portIndicator(sim, b, g(2), second).description, /STP blocking VLAN 1/);
  first.enabled = false;
  sim.changed();
  sim.advance(3000);
  assert.equal(portIndicator(sim, b, g(1), first).state, 'off');
  assert.equal(portIndicator(sim, b, g(2), second).state, 'up');
  b.config.interfaces[g(2)].adminUp = false;
  sim.changed();
  assert.equal(portIndicator(sim, b, g(2), second).state, 'down');
});

test('trunk indicator reports mixed per-VLAN STP forwarding without claiming the whole link is blocked', () => {
  const sim = new Simulator(132), a = sim.addDevice('switch'), b = sim.addDevice('switch');
  a.config.features.stp = { priority: 0 };
  b.config.features.stp = { priority: 8192 };
  const ca = new IOSSession(sim, a.id), cb = new IOSSession(sim, b.id);
  for (const cli of [ca, cb]) configure(cli, 'enable', 'configure terminal', 'vlan 20', 'exit', 'interface range g0/1 - 2', 'switchport mode trunk', 'end');
  const first = sim.connect({ deviceId: a.id, port: g(1) }, { deviceId: b.id, port: g(1) });
  sim.connect({ deviceId: a.id, port: g(2) }, { deviceId: b.id, port: g(2) });
  sim.advance(3000);
  configure(cb, 'configure terminal', 'interface g0/2', 'spanning-tree vlan 20 cost 1', 'end');
  sim.advance(2000);
  const state = portIndicator(sim, b, g(1), first);
  assert.equal(state.state, 'partial');
  assert.match(state.description, /blocking VLAN 20; forwarding VLAN 1/);
});

test('transmit and receive flashes use real independent counters, expire, and reset on power cycles', () => {
  const sim = new Simulator(133), a = sim.addDevice('router'), b = sim.addDevice('router');
  for (const [device, ip] of [[a, '10.0.0.1'], [b, '10.0.0.2']] as const)
    Object.assign(device.config.interfaces[g(0)], { adminUp: true, ip, mask: '255.255.255.0' });
  sim.connect({ deviceId: a.id, port: g(0) }, { deviceId: b.id, port: g(0) });
  const activity = new LinkActivity();
  assert.deepEqual(activity.sample(a, g(0), 100), { tx: false, rx: false });
  sim.ping(a.id, '10.0.0.2', { count: 1 });
  sim.advance(0);
  assert.deepEqual(activity.sample(a, g(0), 110), { tx: true, rx: false });
  sim.advance(100);
  assert.deepEqual(activity.sample(a, g(0), 150), { tx: true, rx: true });
  assert.equal(activity.needsPaint(), true);
  assert.deepEqual(activity.sample(a, g(0), 501), { tx: false, rx: false });
  assert.equal(activity.needsPaint(), false);
  sim.power(a.id, false);
  assert.deepEqual(activity.sample(a, g(0), 510), { tx: false, rx: false });
  activity.retain(new Set());
  assert.equal(activity.needsPaint(), false);
});
