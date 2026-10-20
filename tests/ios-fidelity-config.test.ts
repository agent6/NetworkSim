import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import { NETSIM_VERSION } from '../src/platform-identity.ts';

const run = (session: IOSSession, lines: string[]) => lines.flatMap(line => session.execute(line));
const block = (out: string[], head: string) => { const start = out.indexOf(head); assert.ok(start >= 0, `missing ${head}`); const end = out.findIndex((line, i) => i > start && !line.startsWith(' ')); return out.slice(start, end); };
const bytes = (lines: string[]) => new TextEncoder().encode(lines.join('\n') + '\n').byteLength;

function lab() {
  const sim = new Simulator(4242), r1 = sim.addDevice('router'), r2 = sim.addDevice('router'), sw = sim.addDevice('switch'), l3 = sim.addDevice('l3switch');
  sim.connect({ deviceId: r1.id, port: 'GigabitEthernet0/0' }, { deviceId: r2.id, port: 'GigabitEthernet0/0' });
  const c1 = new IOSSession(sim, r1.id), cs = new IOSSession(sim, sw.id), c3 = new IOSSession(sim, l3.id);
  const errors = [
    ...run(c1, ['enable', 'configure terminal', 'hostname Edge', 'interface g0/0', 'ip address 10.0.12.1 255.255.255.0', 'no shutdown', 'interface loopback0', 'ip address 1.1.1.1 255.255.255.255', 'interface g0/1.10', 'encapsulation dot1q 10', 'ip address 10.10.10.1 255.255.255.0', 'interface g0/2', 'speed 100', 'duplex full', 'no shutdown', 'exit', 'banner motd #Authorized only#', 'line vty 0 4', 'password cisco', 'login', 'transport input ssh', 'line con 0', 'logging synchronous', 'exec-timeout 0 0', 'exit', 'username admin privilege 15 secret pw', 'username bob password bobpw', 'router ospf 1', 'network 10.0.12.0 0.0.0.255 area 0', 'end']),
    ...run(cs, ['enable', 'configure terminal', 'hostname SW1', 'vlan 10', 'name USERS', 'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'interface g0/2', 'switchport mode trunk', 'interface g0/5', 'switchport access vlan 10', 'interface vlan 1', 'ip address 10.0.0.2 255.255.255.0', 'no shutdown', 'end']),
    ...run(c3, ['enable', 'configure terminal', 'ip routing', 'interface g0/1', 'no switchport', 'ip address 10.1.1.1 255.255.255.0', 'interface vlan 10', 'ip address 10.10.0.1 255.255.255.0', 'end']),
  ].filter(line => line.startsWith('%'));
  assert.deepEqual(errors, []);
  sim.advance(60000);
  return { sim, r1, r2, sw, l3, c1, cs, c3 };
}

test('show running-config uses the IOS header, byte count, boilerplate and trailing end', () => {
  const { c1, cs } = lab(), out = c1.execute('show running-config');
  assert.deepEqual(out.slice(0, 2), ['Building configuration...', '']);
  const count = /^Current configuration : (\d+) bytes$/.exec(out[2]);
  assert.ok(count, out[2]);
  assert.equal(Number(count[1]), bytes(out.slice(3)));
  assert.deepEqual(out.slice(3, 9), ['!', `version ${NETSIM_VERSION}`, 'no service password-encryption', '!', 'hostname Edge', '!']);
  for (const line of ['boot-start-marker', 'boot-end-marker', 'no aaa new-model', 'ip cef', 'no ipv6 cef', 'ip forward-protocol nd', 'no ip http server', 'control-plane', 'no scheduler allocate']) assert.ok(out.includes(line), line);
  assert.deepEqual(out.slice(-2), ['!', 'end']);
  assert.ok(out.indexOf('boot-start-marker') < out.indexOf('no aaa new-model') && out.indexOf('ip cef') < out.indexOf('interface Loopback0'));
  assert.ok(!out.some(line => /NetworkSim|educational|simulat/i.test(line)));
  assert.ok(!out.includes('ip routing'), 'routers never print the default ip routing');
  assert.ok(!out.some(line => /^ (no )?switchport$/.test(line) || line === ' no shutdown'));
  assert.equal(cs.execute('show running-config')[4], `version ${NETSIM_VERSION}`);
  assert.deepEqual(c1.execute('write terminal'), out);
});

test('router interface blocks follow IOSv defaults, hardware lines and ordering', () => {
  const { c1 } = lab(), out = c1.execute('show running-config');
  assert.deepEqual(block(out, 'interface GigabitEthernet0/0'), ['interface GigabitEthernet0/0', ' ip address 10.0.12.1 255.255.255.0', ' duplex auto', ' speed auto', ' media-type rj45']);
  assert.deepEqual(block(out, 'interface GigabitEthernet0/3'), ['interface GigabitEthernet0/3', ' no ip address', ' shutdown', ' duplex auto', ' speed auto', ' media-type rj45']);
  assert.deepEqual(block(out, 'interface GigabitEthernet0/2'), ['interface GigabitEthernet0/2', ' no ip address', ' duplex full', ' speed 100', ' media-type rj45']);
  assert.deepEqual(block(out, 'interface GigabitEthernet0/1.10'), ['interface GigabitEthernet0/1.10', ' encapsulation dot1Q 10', ' ip address 10.10.10.1 255.255.255.0']);
  assert.ok(out.indexOf('interface Loopback0') < out.indexOf('interface GigabitEthernet0/0'));
  assert.ok(out.indexOf('interface GigabitEthernet0/1') < out.indexOf('interface GigabitEthernet0/1.10') && out.indexOf('interface GigabitEthernet0/1.10') < out.indexOf('interface GigabitEthernet0/2'));
  assert.ok(out.indexOf('interface GigabitEthernet0/3') < out.indexOf('router ospf 1'));
  assert.ok(out.includes('username admin privilege 15 secret pw') && out.includes('username bob password 0 bobpw'));
  assert.ok(out.includes('banner motd ^CAuthorized only^C'));
});

test('line blocks show console, aux and vty with configured sub-lines only', () => {
  const { c1, cs } = lab(), out = c1.execute('show running-config'), start = out.indexOf('line con 0');
  assert.deepEqual(out.slice(start, out.indexOf('no scheduler allocate')), ['line con 0', ' exec-timeout 0 0', ' logging synchronous', 'line aux 0', 'line vty 0 4', ' password cisco', ' login', ' transport input ssh', '!']);
  const sw = cs.execute('show running-config');
  assert.deepEqual(sw.slice(sw.indexOf('line con 0'), -1), ['line con 0', 'line vty 0 4', ' login', ' transport input none', 'line vty 5 15', ' login', ' transport input none', '!']);
  assert.ok(!sw.includes('line aux 0'));
});

test('switch ports omit bare switchport lines and SVIs follow physical interfaces', () => {
  const { cs, c3 } = lab(), out = cs.execute('show running-config');
  assert.ok(!out.includes(' switchport'));
  assert.deepEqual(block(out, 'interface GigabitEthernet0/1'), ['interface GigabitEthernet0/1', ' switchport access vlan 10', ' switchport mode access']);
  assert.deepEqual(block(out, 'interface GigabitEthernet0/2'), ['interface GigabitEthernet0/2', ' switchport mode trunk']);
  assert.deepEqual(block(out, 'interface GigabitEthernet0/5'), ['interface GigabitEthernet0/5', ' switchport access vlan 10']);
  assert.deepEqual(block(out, 'interface GigabitEthernet0/6'), ['interface GigabitEthernet0/6']);
  assert.ok(out.indexOf('interface GigabitEthernet1/2') < out.indexOf('interface Vlan1'));
  assert.deepEqual(block(out, 'interface Vlan1'), ['interface Vlan1', ' ip address 10.0.0.2 255.255.255.0']);
  for (const line of ['spanning-tree mode rapid-pvst', 'spanning-tree extend system-id', 'vlan internal allocation policy ascending']) assert.ok(out.includes(line), line);
  const l3 = c3.execute('show running-config');
  assert.ok(l3.includes('ip routing'));
  assert.deepEqual(block(l3, 'interface GigabitEthernet0/1'), ['interface GigabitEthernet0/1', ' no switchport', ' ip address 10.1.1.1 255.255.255.0']);
});

test('show running-config interface prints the IOS slice header and end', () => {
  const { c1 } = lab(), out = c1.execute('show running-config interface g0/0');
  assert.deepEqual(out, ['Building configuration...', '', `Current configuration : ${bytes(out.slice(3))} bytes`, '!', 'interface GigabitEthernet0/0', ' ip address 10.0.12.1 255.255.255.0', ' duplex auto', ' speed auto', ' media-type rj45', 'end']);
});

test('copy running-config startup-config prompts for the destination and show startup-config reports NVRAM usage', () => {
  const { c1 } = lab();
  assert.deepEqual(c1.execute('show startup-config'), ['startup-config is not present']);
  assert.deepEqual(c1.execute('copy running-config startup-config'), []);
  assert.equal(c1.prompt, 'Destination filename [startup-config]?');
  assert.deepEqual(c1.execute(''), ['Building configuration...', '[OK]']);
  assert.equal(c1.prompt, 'Edge#');
  const startup = c1.execute('show startup-config'), body = startup.slice(1);
  assert.equal(startup[0], `Using ${bytes(body)} out of 262144 bytes`);
  assert.deepEqual(body, c1.execute('show running-config').slice(3));
  c1.execute('copy running-config startup-config');
  assert.match(c1.execute('bogus').join('\n'), /^%Error opening nvram:bogus/);
  assert.deepEqual(c1.execute('write memory'), ['Building configuration...', '[OK]']);
});

test('copy startup-config running-config prompts, restores saved state and reports bytes copied', () => {
  const { c1 } = lab();
  assert.match(c1.execute('copy startup-config running-config').join('\n'), /%Error opening nvram:startup-config/);
  c1.execute('write memory');
  run(c1, ['configure terminal', 'hostname Changed', 'end']);
  assert.deepEqual(c1.execute('copy startup-config running-config'), []);
  assert.equal(c1.prompt, 'Destination filename [running-config]?');
  const out = c1.execute('');
  assert.match(out.join('\n'), /^\d+ bytes copied in \d+\.\d{3} secs \(\d+ bytes\/sec\)$/);
  assert.equal(c1.prompt, 'Edge#');
  run(c1, ['configure terminal', 'hostname Again', 'end']);
  assert.deepEqual(c1.execute('configure memory'), []);
  assert.equal(c1.prompt, 'Edge#');
});

test('local and TFTP copies report IOS byte counts instead of simulator notes', () => {
  const { sim, r1, r2, c1 } = lab(), c2 = new IOSSession(sim, r2.id);
  run(c2, ['enable', 'configure terminal', 'interface g0/0', 'ip address 10.0.12.2 255.255.255.0', 'no shutdown', 'end']);
  r2.config.services.tftp = { enabled: true, files: {} };
  sim.advance(5000);
  const saved = c1.execute('copy running-config flash:backup.cfg'), size = new TextEncoder().encode(renderConfig(r1).join('\n')).byteLength;
  assert.equal(saved.length, 1);
  assert.match(saved[0], new RegExp(`^${size} bytes copied in \\d+\\.\\d{3} secs \\(\\d+ bytes/sec\\)$`));
  assert.match(c1.execute('copy flash:backup.cfg running-config').join('\n'), /^\d+ bytes copied in \d+\.\d{3} secs \(\d+ bytes\/sec\)$/);
  run(c1, ['copy running-config tftp:', '10.0.12.2']);
  assert.equal(c1.prompt, 'Destination filename [edge-confg]?');
  const put = c1.execute('');
  assert.equal(put[0], '!!');
  assert.match(put[1], /^\d+ bytes copied in 6\.000 secs \(\d+ bytes\/sec\)$/);
  assert.ok(r2.config.services.tftp.files['edge-confg'].includes('hostname Edge'));
  run(c1, ['copy tftp: flash:restored.cfg']);
  assert.equal(c1.prompt, 'Address or name of remote host []?');
  run(c1, ['10.0.12.2']);
  assert.equal(c1.prompt, 'Source filename [restored.cfg]?');
  const got = c1.execute('edge-confg');
  assert.deepEqual(got.slice(0, 2), ['Accessing tftp://10.0.12.2/edge-confg...', 'Loading edge-confg from 10.0.12.2: !']);
  assert.match(got.slice(2).join('\n'), /^\[OK - \d+ bytes\]\n\n\d+ bytes copied in 6\.000 secs \(\d+ bytes\/sec\)$/);
  run(c1, ['copy tftp: flash:absent', '10.0.12.2']);
  assert.deepEqual(c1.execute('missing.cfg'), ['%Error opening tftp://10.0.12.2/missing.cfg (No such file or directory)']);
  assert.ok(![...saved, ...put, ...got].some(line => /simulated|modeled|Configuration copied/.test(line)));
});

test('archive config is silent and show archive lists IOS archive slots', () => {
  const { c1 } = lab();
  assert.deepEqual(c1.execute('show archive'), [' Archive feature not enabled']);
  run(c1, ['configure terminal', 'archive', 'path flash:backup', 'maximum 3', 'end']);
  assert.deepEqual(c1.execute('archive config'), []);
  assert.deepEqual(c1.execute('archive config'), []);
  assert.deepEqual(c1.execute('show archive'), ['The maximum archive configurations allowed is 3.', 'There are currently 2 archive configurations saved.', 'The next archive file will be named flash:backup-3', ' Archive #  Name', '   1        flash:backup-1', '   2        flash:backup-2 <- Most Recent', '   3']);
});

test('rendered IOS boilerplate replays without errors and round-trips identically', () => {
  const { r1, sw, l3 } = lab();
  for (const device of [r1, sw, l3]) {
    const copy = new Simulator(1), target = copy.addDevice(device.kind), session = new IOSSession(copy, target.id);
    target.config.features.files = { ...target.config.features.files, snapshot: renderConfig(device).join('\n') };
    session.execute('enable');
    const out = session.execute('copy flash:snapshot running-config');
    assert.ok(!out.some(line => line.startsWith('%')), `${device.kind}: ${out.join('\n')}`);
    assert.deepEqual(renderConfig(target), renderConfig(device), device.kind);
    for (const [name, port] of Object.entries(device.config.interfaces)) assert.deepEqual(target.config.interfaces[name], port, `${device.kind} ${name}`);
  }
});
