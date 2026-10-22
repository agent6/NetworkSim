import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';

function lab() {
  const sim = new Simulator(4242), r1 = sim.addDevice('router'), r2 = sim.addDevice('router'), sw = sim.addDevice('switch');
  sim.connect({ deviceId: r1.id, port: 'GigabitEthernet0/0' }, { deviceId: r2.id, port: 'GigabitEthernet0/0' });
  sim.connect({ deviceId: r1.id, port: 'GigabitEthernet0/1' }, { deviceId: sw.id, port: 'GigabitEthernet0/1' });
  const c1 = new IOSSession(sim, r1.id), c2 = new IOSSession(sim, r2.id);
  const run = (c: IOSSession, ...lines: string[]) => lines.forEach(line => assert.ok(!c.execute(line).some(x => x.startsWith('%')), line));
  run(c1, 'enable', 'configure terminal', 'hostname R1', 'lldp run', 'interface lo0', 'ip address 1.1.1.1 255.255.255.255', 'interface g0/0', 'ip address 10.0.12.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'router ospf 1', 'network 10.0.12.0 0.0.0.255 area 0', 'network 1.1.1.1 0.0.0.0 area 0', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.0.12.2', 'access-list 1 permit 10.0.0.0 0.0.0.255', 'access-list 1 deny any', 'ip access-list extended WEB', 'permit tcp any any eq 80', 'permit udp any host 10.0.12.2 eq 53', 'deny ip any any log', 'end');
  run(c2, 'enable', 'configure terminal', 'hostname R2', 'lldp run', 'interface lo0', 'ip address 2.2.2.2 255.255.255.255', 'interface g0/0', 'ip address 10.0.12.2 255.255.255.0', 'no shutdown', 'router ospf 1', 'network 10.0.12.0 0.0.0.255 area 0', 'network 2.2.2.2 0.0.0.0 area 0', 'end');
  sim.advance(90000);
  return { sim, r1, c1, show: (cmd: string) => c1.execute(cmd) };
}

const { show } = lab();
const has = (lines: string[], ...expected: string[]) => { for (const line of expected) assert.ok(lines.includes(line), `missing ${JSON.stringify(line)} in\n${lines.join('\n')}`); };

test('show interfaces uses the IOSv iGbE layout with real link state and counters', () => {
  const up = show('show interfaces g0/0');
  assert.equal(up[0], 'GigabitEthernet0/0 is up, line protocol is up ');
  assert.match(up[1], /^  Hardware is iGbE, address is [0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4} \(bia [0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\)$/);
  has(up, '  Internet address is 10.0.12.1/24', '  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec, ', '     reliability 255/255, txload 1/255, rxload 1/255', '  Encapsulation ARPA, loopback not set', '  Keepalive set (10 sec)', '  Full Duplex, 1000Mbps, link type is auto, media type is RJ45', '  Queueing strategy: fifo', '  Output queue: 0/40 (size/max)');
  assert.ok(up.some(line => /^     [1-9]\d* packets input, \d+ bytes, 0 no buffer$/.test(line)));
  assert.ok(up.some(line => /^     [1-9]\d* packets output, \d+ bytes, 0 underruns$/.test(line)));
  const down = show('show interfaces g0/2');
  assert.equal(down[0], 'GigabitEthernet0/2 is administratively down, line protocol is down ');
  has(down, '  Auto Duplex, Auto Speed, link type is auto, media type is RJ45');
  const loop = show('show interfaces lo0');
  assert.equal(loop[0], 'Loopback0 is up, line protocol is up ');
  has(loop, '  Hardware is Loopback', '  MTU 1514 bytes, BW 8000000 Kbit/sec, DLY 5000 usec, ', '  Encapsulation LOOPBACK, loopback not set');
});

test('interface summaries keep IOS column widths', () => {
  const brief = show('show ip interface brief');
  assert.equal(brief[0], 'Interface                  IP-Address      OK? Method Status                Protocol');
  has(brief.map(line => line.trimEnd()), 'GigabitEthernet0/0         10.0.12.1       YES manual up                    up', 'GigabitEthernet0/2         unassigned      YES unset  administratively down down', 'Loopback0                  1.1.1.1         YES manual up                    up');
  const description = show('show interfaces description');
  assert.equal(description[0], 'Interface                      Status         Protocol Description');
  assert.ok(description.some(line => line.startsWith('Gi0/2                          admin down     down')));
  const ip = show('show ip interface g0/0');
  assert.equal(ip[0], 'GigabitEthernet0/0 is up, line protocol is up');
  has(ip, '  Internet address is 10.0.12.1/24', '  Broadcast address is 255.255.255.255', '  Outgoing access list is not set', '  Inbound  access list is not set', '  Multicast reserved groups joined: 224.0.0.5 224.0.0.6');
});

test('show ip route prints the IOS 15 legend, classful parents and real route ages', () => {
  const route = show('show ip route');
  assert.equal(route[0], 'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP');
  has(route, 'Gateway of last resort is 10.0.12.2 to network 0.0.0.0', '      10.0.0.0/8 is variably subnetted, 2 subnets, 2 masks', 'C        10.0.12.0/24 is directly connected, GigabitEthernet0/0', 'L        10.0.12.1/32 is directly connected, GigabitEthernet0/0', 'C        1.1.1.1 is directly connected, Loopback0');
  assert.ok(route.some(line => line.startsWith('S*    0.0.0.0/0 [1/0] via 10.0.12.2')));
  assert.ok(route.some(line => /^O        2\.2\.2\.2 \[110\/2\] via 10\.0\.12\.2, \d\d:\d\d:\d\d, GigabitEthernet0\/0$/.test(line)));
  assert.ok(!route.some(line => line.startsWith('L        1.1.1.1/32')));
  assert.match(show('show ip route 2.2.2.2').join('\n'), /Known via "ospf 1", distance 110, metric 2, type intra area/);
});

test('show arp includes own addresses with a dash age and dynamic entries in minutes', () => {
  const arp = show('show arp');
  assert.equal(arp[0], 'Protocol  Address          Age (min)  Hardware Addr   Type   Interface');
  assert.ok(arp.some(line => line.startsWith('Internet  10.0.12.1               -   ')));
  assert.ok(arp.some(line => /^Internet  10\.0\.12\.2 +\d+   [0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}  ARPA   GigabitEthernet0\/0$/.test(line)));
});

test('CDP displays follow IOS 15 formats', () => {
  const neighbors = show('show cdp neighbors');
  has(neighbors, 'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge', 'Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID', 'Total cdp entries displayed : 2');
  assert.ok(neighbors.some(line => /^R2\s+Gig 0\/0\s+\d+\s+R B\s+NS-R4\s+Gig 0\/0$/.test(line)));
  const detail = show('show cdp neighbors detail');
  has(detail, '-------------------------', 'Device ID: R2', 'Platform: NetSim NS-R4,  Capabilities: Router Source-Route-Bridge ', 'Interface: GigabitEthernet0/0,  Port ID (outgoing port): GigabitEthernet0/0', 'advertisement version: 2');
  assert.deepEqual(show('show cdp'), ['Global CDP information:', '        Sending CDP packets every 60 seconds', '        Sending a holdtime value of 180 seconds', '        Sending CDPv2 advertisements is  enabled']);
  const iface = show('show cdp interface g0/0');
  assert.equal(iface[0], 'GigabitEthernet0/0 is up, line protocol is up');
  has(iface, '  Encapsulation ARPA');
  has(show('show cdp interface'), ' cdp enabled interfaces : 4');
  has(show('show cdp traffic'), 'CDP counters :');
  has(show('show cdp entry R2'), 'Device ID: R2');
  has(show('show cdp entry R2 protocol'), 'Protocol information for R2 :');
});

test('LLDP displays follow IOS 15 formats', () => {
  has(show('show lldp'), 'Global LLDP Information:');
  const neighbors = show('show lldp neighbors');
  has(neighbors, 'Device ID           Local Intf     Hold-time  Capability      Port ID', 'Total entries displayed: 1');
  assert.ok(show('show lldp traffic').some(line => line.startsWith('LLDP traffic statistics:')));
  const iface = show('show lldp interface g0/0');
  has(iface, 'GigabitEthernet0/0:', '    Tx: enabled', '    Rx: enabled');
});

test('controllers, CEF, NAT, DHCP and ACL displays use IOS layouts', () => {
  const controllers = show('show controllers g0/0');
  has(controllers, 'Interface GigabitEthernet0/0', 'Hardware is iGbE', ' network link is up');
  assert.match(show('show controllers bogus').join('\n'), /Invalid input/);
  const cef = show('show ip cef');
  has(cef, 'Prefix               Next Hop             Interface', '0.0.0.0/8            drop', '10.0.12.1/32         receive              GigabitEthernet0/0', '255.255.255.255/32   receive');
  assert.deepEqual(show('show ip cef 2.2.2.2'), ['2.2.2.2/32', '  nexthop 10.0.12.2 GigabitEthernet0/0']);
  assert.equal(show('show ip cef detail')[0], 'IPv4 CEF is enabled and running');
  assert.deepEqual(show('show ip nat translations'), []);
  assert.equal(show('show ip dhcp binding')[0], 'Bindings from all pools not associated with VRF:');
  const acl = show('show access-lists');
  has(acl, 'Standard IP access list 1', '    10 permit 10.0.0.0, wildcard bits 0.0.0.255', '    20 deny   any', 'Extended IP access list WEB', '    10 permit tcp any any eq www', '    20 permit udp any host 10.0.12.2 eq domain', '    30 deny ip any any log');
  const cefInterface = show('show cef interface g0/0');
  assert.match(cefInterface[0], /^GigabitEthernet0\/0 is up \(if_number \d+\)$/);
  has(cefInterface, '  IP CEF switching enabled');
});

test('interface and layer-3 displays carry no simulator commentary or placeholders', () => {
  for (const cmd of ['show interfaces', 'show ip interface', 'show ip interface brief', 'show interfaces description', 'show ip route', 'show arp', 'show cdp neighbors detail', 'show lldp neighbors detail', 'show controllers g0/0', 'show ip cef', 'show ip nat statistics', 'show access-lists', 'show protocols']) {
    const text = show(cmd).join('\n');
    assert.doesNotMatch(text, /simulat|not modeled|not retained|not tracked/i, cmd);
    assert.doesNotMatch(text, /(^|\s)\?(\s|$)/m, cmd);
  }
});
