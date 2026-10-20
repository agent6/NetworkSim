import test from 'node:test';
import assert from 'node:assert/strict';
import metadata from '../package.json' with { type: 'json' };
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { IOS_BOOT_DURATION, iosBootStages } from '../src/ios-boot.ts';
import { iosSerial } from '../src/ios-system-show.ts';
import { renderConfig } from '../src/config-renderer.ts';
import { parseLabFile, serializeLabFile } from '../src/persistence.ts';
import { snmpMIB } from '../src/snmp.ts';
import { receiveDiscoveryControl } from '../src/discovery.ts';
import { NETSIM_VERSION, platformSoftware } from '../src/platform-identity.ts';

const profiles = [
  ['router', 'NS-R4', 4, 458752, 65536],
  ['switch', 'NS-S24-2G', 26, 458752, 65536],
  ['poeswitch', 'NS-S24P-2G', 26, 458752, 65536],
  ['l3switch', 'NS-L3S24-2G', 26, 983040, 65536],
  ['wlc', 'NS-WLC1', 1, 2031616, 65536],
  ['ap', 'NS-AP2', 1, 229376, 32768],
] as const;
function run(cli: IOSSession, ...commands: string[]) {
  for (const command of commands) assert.ok(!cli.execute(command).some(line => line.startsWith('%')), command);
}
const text = (cli: IOSSession, command: string) => cli.execute(command).join('\n');

for (const [kind, model, ports, processorKiB, ioKiB] of profiles) {
  test(`IDENTITY ${kind} reports its own NetSim model, software, memory and chassis without changing state`, () => {
    const sim = new Simulator(4401), device = sim.addDevice(kind), cli = new IOSSession(sim, device.id);
    if (kind === 'ap') {
      const supply = sim.addDevice('poeswitch');
      sim.connect({ deviceId: supply.id, port: 'GigabitEthernet0/1' }, { deviceId: device.id, port: 'GigabitEthernet0' });
    }
    const before = JSON.stringify(device.config), now = sim.clock.now(), events = sim.events.length;
    const version = text(cli, 'show version'), inventory = text(cli, 'show inventory');
    assert.equal(NETSIM_VERSION, metadata.version);
    assert.match(version, new RegExp(`^NetSim OS Software, .*\\(${model}\\), Version ${metadata.version.replaceAll('.', '\\.')}$`, 'm'));
    assert.match(version, new RegExp(`^Model number: ${model}$`, 'm'));
    assert.match(version, new RegExp(`with ${processorKiB}K/${ioKiB}K bytes of memory\\.`));
    assert.match(version, new RegExp(`^${ports} Gigabit Ethernet interface${ports === 1 ? '' : 's'}$`, 'm'));
    assert.match(version, /^Virtual platform \(simulated hardware\)$/m);
    assert.match(version, /^System restarted by Power-on$/m);
    assert.match(version, new RegExp(`^System image file is "embedded:netsim-${kind}-${metadata.version}"$`, 'm'));
    assert.match(inventory, /^NAME: "Chassis", DESCR: "NetSim /);
    assert.match(inventory, new RegExp(`^PID: ${model}\\s+, VID: V01, SN: NS[A-Z0-9]{13}$`, 'm'));
    const serial = /SN: (\w+)/.exec(inventory)![1];
    assert.match(version, new RegExp(`^Processor board ID ${serial}$`, 'm'));
    assert.equal((inventory.match(/^NAME:/gm) ?? []).length, 1, 'no invented modules, supplies or transceivers');
    assert.doesNotMatch(version + inventory, /Cisco|IOSv|vios_l2|CML_NIGHTLY|cisco\.com|CompactFlash|parity disabled|with  with/);
    if (kind === 'ap') assert.match(version, /^2 IEEE 802\.11 radios$/m);
    assert.equal(JSON.stringify(device.config), before);
    assert.equal(sim.clock.now(), now); assert.equal(sim.events.length, events);
    assert.match(cli.help('show version ').join('\n'), /<cr>/);
    assert.match(cli.help('show inventory ').join('\n'), /<cr>/);
    assert.match(text(cli, 'show version extra'), /%/);
    assert.match(text(cli, 'show inventory extra'), /%/);
  });
}

test('IDENTITY serials are per-device and stable across rename, save, reload and portable import', () => {
  const sim = new Simulator(4402), device = sim.addDevice('router'), cli = new IOSSession(sim, device.id);
  const inventory = text(cli, 'show inventory'), serial = iosSerial(device);
  const serials = new Set(Array.from({ length: 1000 }, (_, n) => iosSerial({ ...device, id: `device-${n}` })));
  assert.equal(serials.size, 1000);
  run(cli, 'enable', 'conf t', 'hostname Edge', 'end', 'write memory');
  sim.advance(61000);
  assert.match(text(cli, 'show version'), /Edge uptime is 1 minute/);
  assert.equal(text(cli, 'show inventory'), inventory);
  sim.reloadIOS(device.id, 'Identity regression');
  sim.advance(IOS_BOOT_DURATION);
  run(cli, '', 'enable');
  assert.match(text(cli, 'show version'), /Edge uptime is 0 minutes[\s\S]*Last reload reason: Identity regression/);
  assert.equal(text(cli, 'show inventory'), inventory);
  const restored = new Simulator();
  restored.load(parseLabFile(serializeLabFile(sim.serialize())));
  const copy = restored.getDevice(device.id)!;
  assert.equal(iosSerial(copy), serial);
  assert.equal(text(new IOSSession(restored, copy.id), 'show inventory'), inventory);
});

test('IDENTITY physical interface counts ignore subinterfaces and keep virtual interfaces separate', () => {
  const sim = new Simulator(4403), router = sim.addDevice('router'), cli = new IOSSession(sim, router.id);
  run(cli, 'enable', 'conf t', 'int g0/0.10', 'encapsulation dot1q 10', 'int Loopback0', 'int Tunnel0', 'end');
  const version = text(cli, 'show version');
  assert.match(version, /^4 Gigabit Ethernet interfaces$/m);
  assert.doesNotMatch(version, /^5 Gigabit Ethernet interfaces$/m);
  const sw = sim.addDevice('switch'), cs = new IOSSession(sim, sw.id);
  run(cs, 'enable', 'conf t', 'int Vlan10', 'int Port-channel1', 'end');
  assert.match(text(cs, 'show version'), /^26 Gigabit Ethernet interfaces$/m);
  assert.match(text(cs, 'show version'), /^1 Virtual Ethernet interface$/m);
});

test('IDENTITY version and memory views share profile capacities while flash reports the actual configured bytes', () => {
  const sim = new Simulator(4404);
  for (const [kind, , , processorKiB, ioKiB] of profiles.filter(([kind]) => kind !== 'ap')) {
    const device = sim.addDevice(kind), cli = new IOSSession(sim, device.id);
    run(cli, 'enable');
    const memory = text(cli, 'show memory statistics');
    const processor = /^Processor\s+\S+\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(memory)!;
    const io = /^\s+I\/O\s+\S+\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(memory)!;
    assert.equal(Number(processor[1]), processorKiB * 1024);
    assert.equal(Number(io[1]), ioKiB * 1024);
    assert.equal(Number(processor[2]) + Number(processor[3]), Number(processor[1]));
    assert.equal(Number(io[2]) + Number(io[3]), Number(io[1]));
    device.config.features.fileSystem = { capacityBytes: 2049 };
    device.config.features.files = { 'notes.txt': 'abc' };
    assert.match(text(cli, 'show version'), /^2049 bytes of flash storage \(Read\/Write, simulated\)\.$/m);
    assert.match(text(cli, 'dir'), /2049 bytes total \(2046 bytes free\)/);
  }
});

test('IDENTITY discovery advertises full models and software, uses received cache and agrees with SNMP', () => {
  const sim = new Simulator(4405), router = sim.addDevice('router'), sw = sim.addDevice('l3switch');
  router.config.interfaces['GigabitEthernet0/0'].adminUp = true;
  router.config.features.lldp = true; sw.config.features.lldp = true;
  sim.connect({ deviceId: router.id, port: 'GigabitEthernet0/0' }, { deviceId: sw.id, port: 'GigabitEthernet0/1' });
  sim.advance(100);
  const cli = new IOSSession(sim, router.id);
  assert.match(text(cli, 'show cdp neighbors'), /NS-L3S24-2G\s+Gig 0\/1/);
  assert.match(text(cli, 'show cdp neighbors detail'), /Platform: NetSim NS-L3S24-2G/);
  assert.ok(text(cli, 'show cdp entry DSW1 version').includes(platformSoftware('l3switch')));
  assert.ok(text(cli, 'show lldp neighbors detail').includes(platformSoftware('l3switch')));
  assert.equal(snmpMIB(sim, sw).find(row => row.oid === '1.3.6.1.2.1.1.1.0')?.value, `${platformSoftware('l3switch')}; virtual platform, read-only educational agent`);
  assert.equal(snmpMIB(sim, sw).find(row => row.oid === '1.3.6.1.2.1.1.2.0')?.value, '0.0');
  receiveDiscoveryControl(sim, router.id, 'GigabitEthernet0/0', { protocol: 'CDP', body: {
    deviceId: sw.id, port: 'GigabitEthernet0/1', hostname: 'Cached', platform: 'NetSim NS-REMOTE',
    software: 'Cached remote software version', capabilities: ['bridge'], holdtime: 180,
  } });
  sw.config.hostname = 'NotAdvertised';
  const cached = text(cli, 'show cdp neighbors detail');
  assert.match(cached, /Device ID: Cached[\s\S]*Platform: NetSim NS-REMOTE[\s\S]*Cached remote software version/);
  assert.doesNotMatch(cached, /NotAdvertised|NS-L3S24-2G/);
});

test('IDENTITY boot and configuration versions agree without inventing a writable flash image or rejecting legacy headers', () => {
  const sim = new Simulator(4406), router = sim.addDevice('router'), cli = new IOSSession(sim, router.id);
  const stages = iosBootStages(router).flatMap(stage => stage.lines).join('\n');
  assert.match(stages, new RegExp(`NetSim NS-R4, Version ${NETSIM_VERSION}`));
  assert.match(stages, new RegExp(`Loading "embedded:netsim-router-${NETSIM_VERSION}"`));
  assert.doesNotMatch(stages, /flash:packages\.conf/);
  assert.equal(renderConfig(router)[1], `version ${NETSIM_VERSION}`);
  run(cli, 'enable');
  router.config.features.files = { legacy: '!\nversion 15.9\nhostname Legacy\n!\ninterface Loopback0\n ip address 192.0.2.1 255.255.255.255\n!\nend\n' };
  run(cli, 'copy flash:legacy running-config');
  assert.equal(router.config.hostname, 'Legacy');
  assert.equal(router.config.interfaces.Loopback0.ip, '192.0.2.1');
  assert.match(text(cli, 'show version'), /Model number: NS-R4/);
  const rendered = renderConfig(router).join('\n');
  router.config.features.files.replay = rendered;
  run(cli, 'copy flash:replay running-config');
  assert.equal(router.config.hostname, 'Legacy');
  assert.equal(router.config.interfaces.Loopback0.ip, '192.0.2.1');
  assert.deepEqual(Object.keys(router.config.features.files).sort(), ['legacy', 'replay']);
});
