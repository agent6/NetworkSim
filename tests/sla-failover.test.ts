import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import { parseDocument, parseLabFile, serializeLabFile } from '../src/persistence.ts';
import { defaultInterface, type Device } from '../src/model.ts';
import type { SLAResult } from '../src/sla-config.ts';

const g = (n: number) => `GigabitEthernet0/${n}`;
function result(device:Device,id=1):SLAResult{const value:SLAResult|undefined=device.runtime.features.ipSla?.[id];assert.ok(value);return value;}
function run(cli: IOSSession, ...commands: string[]) {
  for (const command of commands) assert.ok(!cli.execute(command).some(line => line.startsWith('%')), command);
}
function pair() {
  const sim = new Simulator(4301), a = sim.addDevice('router'), b = sim.addDevice('router');
  const link = sim.connect({ deviceId: a.id, port: g(0) }, { deviceId: b.id, port: g(0) });
  const ca = new IOSSession(sim, a.id), cb = new IOSSession(sim, b.id);
  for (const [cli, ip] of [[ca, '10.0.0.1'], [cb, '10.0.0.2']] as const) run(cli, 'enable', 'conf t', 'int g0/0', `ip address ${ip} 255.255.255.0`, 'no shutdown', 'end');
  return { sim, a, b, ca, cb, link };
}
function echo(cli: IOSSession, id = 1, extra: string[] = []) {
  run(cli, 'conf t', `ip sla ${id}`, 'icmp-echo 10.0.0.2', 'frequency 1', 'timeout 500', ...extra, 'exit');
}

test('SLA state differs from reachability on OverThreshold and preserves the aspect in help, show and config', () => {
  const { sim, a, ca, link } = pair(); link.delay = 40;
  echo(ca, 1, ['threshold 10']);
  run(ca, 'ip sla schedule 1 life forever start-time now', 'track 1 ip sla 1 reachability', 'exit', 'track 2 ip sla 1 state', 'exit', 'ip route 203.0.113.0 255.255.255.0 10.0.0.2 track 2', 'end');
  sim.advance(300);
  assert.equal(a.runtime.features.ipSla[1].returnCode, 'Over threshold');
  assert.equal(a.runtime.features.tracks[1].up, true);
  assert.equal(a.runtime.features.tracks[2].up, false);
  assert.ok(!a.runtime.routes.some(r => r.network === '203.0.113.0'));
  assert.match(renderConfig(a).join('\n'), /track 2 ip sla 1 state/);
  const show = ca.execute('show track 2').join('\n');
  assert.match(show, /IP SLA 1 state/); assert.match(show, /Over threshold/);
  assert.match(show, /Latest RTT \(millisecs\) \d/); assert.match(show, /IP static route 203.0.113.0\/24/);
  run(ca, 'conf t');
  const before = JSON.stringify(a.config), now = sim.clock.now();
  assert.match(ca.execute('track 3 ip sla 1 ?').join('\n'), /reachability[\s\S]*state/);
  assert.equal(JSON.stringify(a.config), before); assert.equal(sim.clock.now(), now);
});

test('SLA unschedule during an echo clears pending and rescheduling starts a fresh result generation', () => {
  const { sim, a, ca, link } = pair(); link.delay = 40;
  echo(ca); run(ca, 'ip sla schedule 1 life forever start-time now', 'track 1 ip sla 1 reachability', 'end');
  sim.advance(1); assert.equal(a.runtime.features.ipSla[1].pending, true);
  run(ca, 'conf t', 'no ip sla schedule 1', 'end');
  assert.equal(a.runtime.features.ipSla[1].pending, false);
  assert.equal(a.runtime.features.tracks[1].up, false);
  sim.advance(100); assert.equal(a.runtime.features.ipSla[1].returnCode, 'Cancelled');
  run(ca, 'conf t', 'ip sla schedule 1 life forever start-time now', 'end');
  sim.advance(1200);
  assert.equal(a.runtime.features.ipSla[1].pending, false);
  assert.equal(a.runtime.features.ipSla[1].returnCode, 'OK');
  assert.equal(a.runtime.features.ipSla[1].runs, 3);
  assert.equal(a.runtime.features.tracks[1].up, true);
});

test('deleting a successful or pending SLA removes stale tracking and late replies cannot update a replacement', () => {
  const { sim, a, ca, link } = pair(); link.delay = 40;
  echo(ca); run(ca, 'ip sla schedule 1 life forever start-time now', 'track 1 ip sla 1 reachability', 'exit', 'ip route 203.0.113.0 255.255.255.0 10.0.0.2 track 1', 'end');
  sim.advance(300); assert.equal(a.runtime.features.tracks[1].up, true);
  run(ca, 'conf t', 'no ip sla 1', 'end');
  assert.equal(a.runtime.features.ipSla[1], undefined);
  assert.equal(a.runtime.features.tracks[1].up, false);
  assert.ok(!a.runtime.routes.some(r => r.network === '203.0.113.0'));
  echo(ca); run(ca, 'ip sla schedule 1 life forever start-time now', 'end'); sim.advance(1);
  assert.equal(result(a).pending, true);
  run(ca, 'conf t', 'no ip sla 1', 'ip sla 1', 'icmp-echo 10.0.0.99', 'frequency 1', 'timeout 100', 'exit', 'ip sla schedule 1 life forever start-time now', 'end');
  sim.advance(300);
  assert.equal(result(a).success, false);
  assert.equal(result(a).returnCode, 'Timeout');
  assert.equal(result(a).runs, 1);
  assert.equal(a.runtime.features.tracks[1].up, false);
});

test('SLA frequency and finite lifetime survive unrelated EEM, archive and other-operation edits', () => {
  const { sim, a, ca } = pair();
  echo(ca); run(ca, 'ip sla schedule 1 life 2 start-time now', 'end');
  sim.advance(400);
  run(ca, 'conf t', 'event manager applet UNRELATED', 'event none', 'exit', 'archive', 'maximum 5', 'exit', 'end');
  echo(ca, 2); run(ca, 'ip sla schedule 2 life forever start-time now', 'end');
  sim.advance(700);
  assert.equal(a.runtime.features.ipSla[1].lastRun, 1000);
  assert.equal(a.runtime.features.ipSla[1].runs, 2);
  run(ca, 'conf t', 'no ip sla 2', 'end');
  sim.advance(2400);
  assert.equal(a.runtime.features.ipSlaScheduleState[1].status, 'expired');
  const result = JSON.stringify(a.runtime.features.ipSla[1]);
  run(ca, 'conf t', 'event manager applet ANOTHER', 'event none', 'end');
  sim.advance(2500);
  assert.equal(JSON.stringify(a.runtime.features.ipSla[1]), result);
  assert.match(ca.execute('show ip sla statistics 1').join('\n'), /time to live: expired/);
});

test('SLA scheduling defaults are pending and one hour; delayed starts, finite expiry and syntax are deterministic', () => {
  const { sim, a, ca } = pair();
  echo(ca); run(ca, 'ip sla schedule 1', 'end'); sim.advance(1000);
  assert.deepEqual(a.config.features.ipSlaSchedules[1], { start: 'pending', life: 3600 });
  assert.equal(a.runtime.features.ipSla?.[1], undefined);
  assert.match(ca.execute('show ip sla configuration 1').join('\n'), /start pending, life 3600 seconds/);
  run(ca, 'conf t', 'no ip sla schedule 1', 'ip sla schedule 1 start-time after 00:00:02 life 2', 'end');
  sim.advance(1999); assert.equal(a.runtime.features.ipSla?.[1], undefined);
  sim.advance(301); assert.equal(result(a).lastRun, 3000);
  sim.advance(2000); assert.equal(result(a).runs, 2);
  assert.equal(a.runtime.features.ipSlaScheduleState[1].status, 'expired');
  run(ca, 'conf t', 'no ip sla schedule 1');
  for (const command of ['ip sla schedule 1 start-time after 24:00:00', 'ip sla schedule 1 life 0', 'ip sla schedule 1 life forever life 5', 'ip sla schedule 1 start-time now start-time pending']) {
    const before = JSON.stringify(a.config); assert.match(ca.execute(command).join('\n'), /%/); assert.equal(JSON.stringify(a.config), before);
  }
  run(ca, 'ip sla schedule 1 start-time now', 'end');
  assert.equal(a.config.features.ipSlaSchedules[1].life, 3600);
});

test('SLA modes expose operation parameters only after a type, reject type changes and scheduled edits atomically', () => {
  const { sim, a, ca } = pair(); run(ca, 'conf t', 'ip sla 1');
  assert.match(ca.prompt, /\(config-ip-sla\)#$/);
  assert.match(ca.execute('?').join('\n'), /IP SLAs entry configuration commands:/);
  assert.match(ca.execute('frequency 1').join('\n'), /Invalid/);
  assert.doesNotMatch(ca.execute('?').join('\n'), /\bfrequency\b/);
  const help = ca.execute('icmp-echo 10.0.0.2 ?').join('\n');
  assert.match(help, /source-interface/); assert.match(help, /source-ip/);
  assert.equal(ca.complete('icmp-echo 10.0.0.2 source-int'), 'icmp-echo 10.0.0.2 source-interface ');
  run(ca, 'icmp-echo 10.0.0.2', 'frequency 1', 'no frequency');
  assert.match(ca.prompt, /\(config-ip-sla-echo\)#$/);
  assert.equal(a.config.features.ipSla[1].frequency, 60);
  assert.match(ca.execute('?').join('\n'), /\bfrequency\b/);
  const before = JSON.stringify(a.config); assert.match(ca.execute('http get http://10.0.0.2/').join('\n'), /Invalid/); assert.equal(JSON.stringify(a.config), before);
  run(ca, 'exit', 'ip sla schedule 1 life forever start-time now');
  assert.match(ca.execute('ip sla 1').join('\n'), /already scheduled/);
  const other = new IOSSession(sim, a.id); run(other, 'enable', 'conf t', 'ip sla 2', 'icmp-echo 10.0.0.2');
  run(ca, 'ip sla schedule 2 start-time now');
  assert.match(other.execute('timeout 10').join('\n'), /already scheduled/);
  assert.equal(a.config.features.ipSla[2].timeout, 5000);
});

test('SLA rejects unavailable source interfaces and unassigned source IPs instead of silently changing source', () => {
  const { sim, a, ca } = pair();
  run(ca, 'conf t', 'ip sla 1', 'icmp-echo 10.0.0.2 source-interface g0/1', 'exit', 'ip sla 2', 'icmp-echo 10.0.0.2 source-ip 192.0.2.99', 'exit', 'ip sla schedule 1 start-time now', 'ip sla schedule 2 start-time now', 'track 1 ip sla 1 reachability', 'end');
  sim.advance(300);
  for (const id of [1, 2]) {
    assert.equal(a.runtime.features.ipSla[id].returnCode, 'Source unavailable');
    assert.equal(a.runtime.features.ipSla[id].packetsSent, 0);
  }
  assert.equal(a.runtime.features.tracks[1].up, false);
});

test('SLA source-interface selects a valid source without forcing egress and dotted interface names round-trip', () => {
  const { sim, a, ca, cb } = pair();
  run(cb, 'conf t', 'ip route 192.0.2.1 255.255.255.255 10.0.0.1', 'end');
  run(ca, 'conf t', 'int Loopback0', 'ip address 192.0.2.1 255.255.255.255', 'exit', 'int g0/0.10', 'encapsulation dot1q 10', 'ip address 198.51.100.1 255.255.255.0', 'exit', 'ip sla 1', 'icmp-echo 10.0.0.2 source-interface Loopback0', 'exit', 'ip sla 2', 'icmp-echo 10.0.0.2 source-interface g0/0.10', 'exit', 'ip sla schedule 1 start-time now', 'end');
  sim.advance(300); assert.equal(a.runtime.features.ipSla[1].success, true);
  assert.ok(sim.events.some(e => e.nodeId === a.id && e.port === g(0) && e.packet?.source === '192.0.2.1' && e.packet?.destination === '10.0.0.2'));
  const text = renderConfig(a).join('\n'); assert.match(text, /source-interface GigabitEthernet0\/0\.10/);
  const copy = sim.addDevice('router'), cli = new IOSSession(sim, copy.id); copy.config.features.files = { snapshot: text };
  run(cli, 'enable', 'copy flash:snapshot running-config');
  assert.deepEqual(copy.config.features.ipSla, a.config.features.ipSla);
});

test('recursive tracked-route withdrawal removes dependent primaries before floating selection and actual forwarding', () => {
  const { sim, a, ca, cb } = pair();
  run(cb, 'conf t', 'int Loopback0', 'ip address 203.0.113.9 255.255.255.255', 'end');
  run(ca, 'conf t', 'track 1 interface g0/1 line-protocol', 'exit',
    'ip route 203.0.113.0 255.255.255.0 198.18.0.1', 'ip route 198.18.0.1 255.255.255.255 192.0.2.2',
    'ip route 192.0.2.2 255.255.255.255 10.0.0.2 track 1', 'ip route 203.0.113.0 255.255.255.0 10.0.0.2 200', 'end');
  const assertPath = (ad: number) => {
    assert.deepEqual(a.runtime.routes.filter(r => r.network === '203.0.113.0').map(r => r.ad), [ad]);
    assert.equal(sim.cefLookup(a.id, '203.0.113.9')?.port, g(0));
    const ping = sim.ping(a.id, '203.0.113.9', { count: 1, timeout: 200 }); sim.advance(300); assert.equal(ping.received, 1);
  };
  assertPath(200);
  assert.ok(!a.runtime.routes.some(r => ['192.0.2.2', '198.18.0.1'].includes(r.network)));
  run(ca, 'conf t', 'track 1 interface g0/0 line-protocol', 'end'); assertPath(1);
  run(ca, 'conf t', 'track 1 interface g0/1 line-protocol', 'end'); assertPath(200);
});

test('recursive cycles, AD255 and a mismatched explicit egress do not suppress usable backups', () => {
  const { sim, a, ca } = pair();
  run(ca, 'conf t', 'ip route 203.0.113.0 255.255.255.0 192.0.2.1', 'ip route 192.0.2.1 255.255.255.255 203.0.113.9',
    'ip route 203.0.113.0 255.255.255.0 10.0.0.2 200', 'ip route 198.51.100.0 255.255.255.0 10.0.0.2 255',
    'int Loopback0', 'ip address 198.18.0.1 255.255.255.255', 'exit',
    'ip route 198.51.100.0 255.255.255.0 Loopback0 10.0.0.2', 'ip route 198.51.100.0 255.255.255.0 10.0.0.2 200', 'end');
  // A cycle with a real backup can legitimately resolve through that backup.
  assert.ok(sim.cefLookup(a.id, '203.0.113.9'));
  assert.deepEqual(a.runtime.routes.filter(r => r.network === '198.51.100.0').map(r => r.ad), [200]);
  assert.equal(sim.cefLookup(a.id, '198.51.100.9')?.port, g(0));
});

test('legacy SLA schedules and reachability tracks persist; malformed imported SLA features reject transactionally', () => {
  const { sim, a, ca } = pair();
  echo(ca); run(ca, 'ip sla schedule 1 life forever start-time now', 'track 1 ip sla 1 reachability', 'end', 'write memory');
  delete a.config.features.tracks[1].aspect;
  const doc = parseLabFile(serializeLabFile(sim.serialize()));
  const fresh = new Simulator(); fresh.load(doc); fresh.advance(300);
  const restored = fresh.getDevice(a.id)!;
  assert.equal(restored.runtime.features.tracks[1].up, true);
  assert.match(renderConfig(restored).join('\n'), /track 1 ip sla 1 reachability/);
  assert.deepEqual(restored.config.features.ipSlaSchedules[1], { start: 'now', life: 0 });
  fresh.reload(a.id); fresh.advance(300); assert.equal(restored.runtime.features.tracks[1].up, true);
  for (const bad of [
    (d: Device) => { d.config.features.ipSla[1].frequency = 0; },
    (d: Device) => { d.config.features.ipSlaSchedules[1].start = 'invalid'; },
    (d: Device) => { d.config.features.tracks[1].aspect = 'invalid'; },
    (d: Device) => { d.config.features.tracks[1].aspect = ['state']; },
    (d: Device) => { d.config.features.ipSla[1].type = ['icmp-echo']; },
    (d: Device) => { delete d.config.features.ipSla[1].type; },
    (d: Device) => { d.config.features.ipSla['01'] = d.config.features.ipSla[1]; },
    (d: Device) => { d.config.features.ipSlaSchedules[1].start = ['now']; },
    (d: Device) => { d.config.features.ipSlaResponder = { enabled:true,ports:[{port:53}] }; },
    (d: Device) => { d.startupConfig!.features.ipSla[1].timeout = -1; },
  ]) {
    const invalid = sim.serialize(); bad(invalid.lab.devices.find(d => d.id === a.id)!);
    const before = JSON.stringify(fresh.serialize());
    assert.throws(() => parseDocument(JSON.stringify(invalid)), /Invalid IP SLA/);
    assert.throws(() => fresh.load(invalid), /Invalid IP SLA/);
    assert.equal(JSON.stringify(fresh.serialize()), before);
  }
});

test('HTTP and UDP in-flight cancellation, lifetime expiry and device removal cannot wedge or revive probes', () => {
  const { sim, a, ca, cb, link } = pair(); link.delay = 40;
  run(cb,'conf t','ip http server','ip sla responder','end');
  run(ca,'conf t','ip sla 1','http get http://10.0.0.2/','timeout 500','frequency 1','exit',
    'ip sla 2','udp-jitter 10.0.0.2 20000 num-packets 20 interval 100 control enable','timeout 500','frequency 3','exit',
    'ip sla schedule 1 life forever start-time now','ip sla schedule 2 life 1 start-time now','end');
  sim.advance(1); assert.equal(result(a).pending,true); assert.equal(result(a,2).pending,true);
  run(ca,'conf t','no ip sla schedule 1','end');
  sim.advance(1100); assert.equal(result(a).pending,false); assert.equal(result(a,2).pending,false);
  assert.equal(a.runtime.features.ipSlaScheduleState[2].status,'expired');
  const sent=result(a,2).packetsSent;
  run(ca,'conf t','ip sla schedule 1 life forever start-time now','end');
  sim.advance(800); assert.equal(result(a).returnCode,'OK'); assert.equal(result(a,2).packetsSent,sent);
  sim.removeDevice(a.id); const before=JSON.stringify(a.runtime.features.ipSla);
  sim.advance(4000); assert.equal(JSON.stringify(a.runtime.features.ipSla),before);
});

test('UDP SLA responder refuses reserved service ports and duplicate options without affecting DNS', () => {
  const { sim, a, b, ca, cb } = pair();
  run(cb,'conf t','ip sla responder','end');
  b.config.services.dns={enabled:true,records:{'host.lab':'192.0.2.1'}};a.config.dnsServers=['10.0.0.2'];sim.changed();
  for(const [id,port] of [[1,53],[2,1813]]) {
    run(ca,'conf t',`ip sla ${id}`,`udp-jitter 10.0.0.2 ${port} num-packets 1`,'timeout 200','exit',`ip sla schedule ${id} start-time now`,'end');
    sim.advance(300);assert.equal(result(a,id).returnCode,'Responder unavailable');
  }
  run(cb,'conf t');
  for(const command of ['ip sla responder udp-echo port 1813','ip sla responder udp-echo port 9000 port 9001','ip sla responder udp-echo port 9000 ipaddress 10.0.0.2 ipaddress 10.0.0.1']){
    const before=JSON.stringify(b.config);assert.match(cb.execute(command).join('\n'),/%/);assert.equal(JSON.stringify(b.config),before);
  }
  run(cb,'end');
  const query=sim.resolveName(a.id,'host.lab');sim.advance(300);
  assert.equal(query.status,'success');assert.equal(query.address,'192.0.2.1');
});

test('IOS boot and runtime reset restart saved SLA schedules without an open console or stale completions', () => {
  const { sim, a, ca, link } = pair(); link.delay=40;
  echo(ca); run(ca,'ip sla schedule 1 life forever start-time now','track 1 ip sla 1 reachability','end','write memory');
  sim.advance(1); sim.reloadIOS(a.id);
  sim.advance(6000); assert.equal(a.runtime.features.ipSla?.[1],undefined);
  sim.advance(1000); assert.equal(result(a).runs,1); assert.equal(a.runtime.features.tracks[1].up,true);
  sim.resetRuntime(); sim.advance(300);
  assert.equal(result(a).runs,1); assert.equal(a.runtime.features.tracks[1].up,true);
});

test('IPv6 SLA validates source address families and measures a real reply with portable rendering', () => {
  const { sim, a, ca, cb } = pair();
  for(const [cli,ip]of [[ca,'2001:db8::1/64'],[cb,'2001:db8::2/64']]as const)run(cli,'conf t','ipv6 unicast-routing','int g0/0','ipv6 address '+ip,'end');
  sim.advance(1200);
  run(ca,'conf t','ip sla 1');
  assert.match(ca.execute('icmp-echo 2001:db8::2 source-ip 10.0.0.1').join('\n'),/families must match/);
  run(ca,'icmp-echo 2001:db8::2 source-ip 2001:db8::1','exit','ip sla schedule 1 life forever start-time now','track 1 ip sla 1 state','end');
  sim.advance(300); assert.equal(result(a).returnCode,'OK'); assert.equal(a.runtime.features.tracks[1].up,true);
  assert.match(renderConfig(a).join('\n'),/icmp-echo 2001:db8::2 source-ip 2001:db8::1/);
});

test('floating statics compete with actual OSPF at the same prefix while preserving longest-prefix forwarding', () => {
  const { sim, a, ca, cb } = pair();
  run(cb,'conf t','int Loopback0','ip address 203.0.113.9 255.255.255.255','ip ospf 1 area 0','int g0/0','ip ospf 1 area 0','ip ospf hello-interval 1','ip ospf dead-interval 3','router ospf 1','router-id 2.2.2.2','end');
  run(ca,'conf t','int g0/0','ip ospf 1 area 0','ip ospf hello-interval 1','ip ospf dead-interval 3','router ospf 1','router-id 1.1.1.1','exit',
    'ip route 203.0.113.9 255.255.255.255 10.0.0.2 200','ip route 0.0.0.0 0.0.0.0 Null0','end');
  sim.advance(3500);
  const route=()=>a.runtime.routes.find(r=>r.network==='203.0.113.9'&&r.prefix===32);
  assert.equal(route()?.protocol,'O'); assert.equal(route()?.ad,110);
  assert.equal(sim.cefLookup(a.id,'203.0.113.9')?.port,g(0));
  run(cb,'conf t','router ospf 1','passive-interface g0/0','end'); sim.advance(4000);
  assert.equal(route()?.protocol,'static'); assert.equal(route()?.ad,200);
  const ping=sim.ping(a.id,'203.0.113.9',{count:1,timeout:200});sim.advance(300);assert.equal(ping.received,1);
  run(cb,'conf t','router ospf 1','no passive-interface g0/0','end');sim.advance(4000);assert.equal(route()?.protocol,'O');
});

function failoverLab() {
  const sim = new Simulator(4302), edge = sim.addDevice('router'), primary = sim.addDevice('router'), backup = sim.addDevice('router'), target = sim.addDevice('router');
  const connect = (a: Device, ap: number, b: Device, bp: number, subnet: number) => {
    Object.assign(a.config.interfaces[g(ap)], { ip: `10.${subnet}.0.1`, mask: '255.255.255.0', adminUp: true });
    Object.assign(b.config.interfaces[g(bp)], { ip: `10.${subnet}.0.2`, mask: '255.255.255.0', adminUp: true });
    return sim.connect({ deviceId: a.id, port: g(ap) }, { deviceId: b.id, port: g(bp) });
  };
  connect(edge, 0, primary, 0, 0); connect(edge, 1, backup, 0, 1);
  const upstream = connect(primary, 1, target, 0, 2); connect(backup, 1, target, 1, 3);
  for (const [name, ip] of [['Loopback0', '203.0.113.1'], ['Loopback1', '192.0.2.1']]) Object.assign(target.config.interfaces[name] = defaultInterface(name), { ip, mask: '255.255.255.255' });
  primary.config.staticRoutes = [{ network: '0.0.0.0', prefix: 0, nextHop: '10.2.0.2' }];
  backup.config.staticRoutes = [{ network: '0.0.0.0', prefix: 0, nextHop: '10.3.0.2' }];
  target.config.staticRoutes = [{ network: '10.0.0.0', prefix: 24, nextHop: '10.2.0.1' }, { network: '10.1.0.0', prefix: 24, nextHop: '10.3.0.1' }];
  const cli = new IOSSession(sim, edge.id);
  run(cli, 'enable', 'conf t', 'ip route 192.0.2.1 255.255.255.255 g0/0 10.0.0.2',
    'ip sla 1', 'icmp-echo 192.0.2.1 source-interface g0/0', 'frequency 1', 'timeout 200', 'exit',
    'ip sla schedule 1 life forever start-time now', 'track 1 ip sla 1 reachability', 'delay down 1 up 2', 'exit',
    'ip route 0.0.0.0 0.0.0.0 g0/0 10.0.0.2 track 1', 'ip route 0.0.0.0 0.0.0.0 g0/1 10.1.0.2 200', 'end');
  return { sim, edge, upstream };
}

test('upstream blackholes with carrier still up fail over delivered traffic, debounce flaps and restore the primary', () => {
  const { sim, edge, upstream } = failoverLab();
  const path = (ad: number, port: string) => {
    assert.deepEqual(edge.runtime.routes.filter(r => r.prefix === 0).map(r => r.ad), [ad]);
    assert.equal(sim.cefLookup(edge.id, '203.0.113.1')?.port, port);
    const ping = sim.ping(edge.id, '203.0.113.1', { count: 1, timeout: 200 }); sim.advance(300); assert.equal(ping.received, 1);
  };
  sim.advance(2500); path(1, g(0));
  upstream.loss = 1; assert.equal(sim.interfaceUp(edge.id, g(0)), true);
  sim.advance(500); assert.equal(edge.runtime.features.tracks[1].up, true);
  sim.advance(1600); path(200, g(1));
  assert.equal(edge.runtime.features.ipSla[1].returnCode, 'Timeout');
  assert.equal(sim.cefLookup(edge.id, '192.0.2.1')?.port, g(0), 'The monitoring /32 never escapes through the backup');
  upstream.loss = 0; sim.advance(1300);
  assert.equal(edge.runtime.features.tracks[1].up, false);
  upstream.loss = 1; sim.advance(1200);
  assert.equal(edge.runtime.features.tracks[1].up, false);
  upstream.loss = 0; sim.advance(3500); path(1, g(0));
});
