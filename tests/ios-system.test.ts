import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
function fixture(kind: 'router' | 'l3switch' = 'router') {
  const engine = new Simulator(823), device = engine.addDevice(kind), cli = new IOSSession(engine,device.id);
  cli.execute('enable'); return { engine, device, cli };
}
function run(cli: IOSSession, ...commands: string[]) {
  for (const command of commands) assert.ok(!cli.execute(command).some(line => line.startsWith('%')),command);
}
test('IOS clock and calendar display real independent time and configured timezone', () => {
  const { engine,device,cli } = fixture();
  assert.match(cli.execute('show clock')[0], /^\*00:00:00\.000 UTC Thu Jan 1 2026$/);
  run(cli,'clock set 12:00:00 16 October 2026','clock update-calendar','configure terminal','clock timezone MST -7','end');
  engine.advance(2000);
  assert.deepEqual(cli.execute('show clock detail'),['05:00:02.000 MST Fri Oct 16 2026','Time source is user configuration']);
  assert.deepEqual(cli.execute('show calendar'),['05:00:02 MST Fri Oct 16 2026']);
  run(cli,'clock set 03:00:00 1 January 2027');
  assert.deepEqual(cli.execute('show calendar'),['05:00:02 MST Fri Oct 16 2026']);
  run(cli,'clock read-calendar'); assert.match(cli.execute('show clock')[0], /^\*05:00:02/);
  assert.equal(device.runtime.features.clockSource,'unsynchronized calendar');
});
test('show filters apply to all output and section retains configuration children', () => {
  const { cli }=fixture();
  run(cli,'configure terminal','hostname Edge','interface loopback0','ip address 192.0.2.1 255.255.255.255','description Campus','end');
  assert.deepEqual(cli.execute('show running-config | include ^hostname|^interface Loopback'),['hostname Edge','interface Loopback0']);
  const section=cli.execute('show running-config | section ^interface Loopback');
  assert.equal(section[0],'interface Loopback0');assert.ok(section.includes(' description Campus'));assert.ok(section.includes(' ip address 192.0.2.1 255.255.255.255'));
  assert.ok(!cli.execute('show clock detail | exclude Time source').some(line=>line.includes('Time source')));
  assert.equal(cli.execute('show running-config | begin hostname')[0],'hostname Edge');
  assert.match(cli.execute('show running-config | include [').join('\n'),/Invalid filter expression/);
  assert.match(cli.execute('show running-config interface loopback0').join('\n'),/Current configuration : \d+ bytes/);
  assert.ok(!cli.execute('show running-config interface loopback0').some(line=>line.includes('GigabitEthernet')));
  run(cli,'configure terminal');assert.deepEqual(cli.execute('do show running-config | include ^hostname'),['hostname Edge']);
});
test('system logs preserve severity, sequence, timestamps, buffer limits and actual delivery control', () => {
  const {engine,device,cli}=fixture();
  run(cli,'clock set 12:34:56 16 October 2026','configure terminal','clock timezone MST -7','service timestamps log datetime msec localtime show-timezone','service sequence-numbers','logging buffered 4096 warnings','logging host 192.0.2.10','end');
  engine.log(device.id,'Allowed warning',4); engine.log(device.id,'Hidden debug',7);
  assert.match(device.runtime.logs.at(-1)!,/^000001: Oct 16 05:34:56\.000 MST: %SYS-4-USERLOG: Allowed warning$/);
  assert.ok(!device.runtime.logs.some(line=>line.includes('Hidden debug')));
  assert.deepEqual(cli.execute('show logging | include Allowed warning'),[device.runtime.logs.at(-1)!]);
  run(cli,'clear logging');assert.equal(device.runtime.logs.length,0);
  run(cli,'configure terminal','no logging on','end');engine.log(device.id,'Suppressed',4);assert.equal(device.runtime.logs.length,0);
  assert.match(cli.execute('show logging').join('\n'),/Syslog logging: disabled/);
  const snapshot=renderConfig(device).join('\n');assert.match(snapshot,/service timestamps log datetime msec localtime show-timezone/);assert.match(snapshot,/no logging on/);
  run(cli,'configure terminal','logging on','no logging trap','logging monitor errors','end','terminal monitor');
  engine.log(device.id,'Visible error',3);engine.log(device.id,'Filtered warning',4);
  assert.ok(cli.pollOutput().some(line=>line.includes('Visible error')));assert.deepEqual(cli.pollOutput(),[]);
});
test('default restores device-specific forwarding and interface values rather than negating them', () => {
  const {device,cli}=fixture();
  run(cli,'configure terminal','no ip routing','default ip routing','interface g0/0','no shutdown','description changed','default shutdown','exit');
  assert.equal(device.config.ipRouting,true);assert.equal(device.config.interfaces['GigabitEthernet0/0'].adminUp,false);
  run(cli,'default interface g0/0');assert.equal(device.config.interfaces['GigabitEthernet0/0'].description,'');
  const sw=fixture('l3switch');run(sw.cli,'configure terminal','ip routing','default ip routing','interface g0/1','shutdown','default shutdown');
  assert.equal(sw.device.config.ipRouting,false);assert.equal(sw.device.config.interfaces['GigabitEthernet0/1'].adminUp,true);
});
