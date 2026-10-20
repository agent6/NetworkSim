import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';

function pair(seed = 4242) {
  const sim = new Simulator(seed), r1 = sim.addDevice('router'), r2 = sim.addDevice('router');
  sim.connect({ deviceId: r1.id, port: 'GigabitEthernet0/0' }, { deviceId: r2.id, port: 'GigabitEthernet0/0' });
  return { sim, r1, r2, c1: new IOSSession(sim, r1.id), c2: new IOSSession(sim, r2.id) };
}
const run = (c: IOSSession, ...lines: string[]) => { for (const line of lines) { const out = c.execute(line); assert.ok(!out.some(v => /^%/.test(v)), `${line}\n${out.join('\n')}`); } };
const base = (n: number) => ['enable', 'configure terminal', 'interface g0/0', `ip address 10.0.12.${n} 255.255.255.0`, 'no shutdown', 'interface loopback0', `ip address ${n}.${n}.${n}.${n} 255.255.255.255`];
const text = (c: IOSSession, command: string) => c.execute(command).join('\n');
const noSimulatorNotes = (output: string) => { assert.doesNotMatch(output, /logical|simulat|not tracked|\s\?\s/i); };
const invalidInput = (c: IOSSession, command: string) => assert.match(text(c, command), /% Invalid input detected at '\^' marker\./);

function ospfLab() {
  const lab = pair();
  run(lab.c1, ...base(1), 'router ospf 1', 'router-id 1.1.1.1', 'network 10.0.12.0 0.0.0.255 area 0', 'network 1.1.1.1 0.0.0.0 area 0', 'end');
  run(lab.c2, ...base(2), 'interface loopback1', 'ip address 172.16.1.1 255.255.255.0', 'router ospf 1', 'router-id 2.2.2.2', 'network 10.0.12.0 0.0.0.255 area 0', 'network 2.2.2.2 0.0.0.0 area 0', 'network 172.16.1.0 0.0.0.255 area 1', 'end');
  lab.sim.advance(90000);
  return lab;
}

test('show ip ospf neighbor matches the IOS column layout with real priority, role and dead time', () => {
  const { c1 } = ospfLab(), lines = c1.execute('show ip ospf neighbor');
  assert.equal(lines[0], '');
  assert.equal(lines[1], 'Neighbor ID     Pri   State           Dead Time   Address         Interface');
  assert.match(lines[2], /^2\.2\.2\.2 {11}1 {3}FULL\/(DR {9}|BDR {8})00:00:[0-3]\d {4}10\.0\.12\.2 {7}GigabitEthernet0\/0$/);
  const detail = text(c1, 'show ip ospf neighbor detail');
  assert.match(detail, /^ Neighbor 2\.2\.2\.2, interface address 10\.0\.12\.2$/m);
  assert.match(detail, /^    In the area 0 via interface GigabitEthernet0\/0$/m);
  assert.match(detail, /^    Neighbor priority is 1, State is FULL, \d+ state changes$/m);
  assert.match(detail, /^    Dead timer due in 00:00:[0-3]\d$/m);
  noSimulatorNotes(text(c1, 'show ip ospf neighbor'));
  invalidInput(c1, 'show ip ospf neighbor bogus');
});

test('show ip ospf interface brief and detail follow IOS fields', () => {
  const { c1 } = ospfLab(), brief = c1.execute('show ip ospf interface brief');
  assert.equal(brief[0], 'Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C');
  assert.ok(brief.some(l => /^Gi0\/0 {8}1 {5}0 {15}10\.0\.12\.1\/24 {7}1 {5}(DR |BDR) {3}1\/1$/.test(l)), brief.join('\n'));
  assert.ok(brief.includes('Lo0          1     0               1.1.1.1/32         1     LOOP  0/0'), brief.join('\n'));
  const detail = c1.execute('show ip ospf interface GigabitEthernet0/0');
  for (const line of ['GigabitEthernet0/0 is up, line protocol is up ', '  Internet Address 10.0.12.1/24, Area 0, Attached via Network Statement', '  Process ID 1, Router ID 1.1.1.1, Network Type BROADCAST, Cost: 1', '  Topology-MTID    Cost    Disabled    Shutdown      Topology Name', '        0           1         no          no            Base', '  Timer intervals configured, Hello 10, Dead 40, Wait 40, Retransmit 5', '    oob-resync timeout 40', '  Neighbor Count is 1, Adjacent neighbor count is 1 ', '  Suppress hello for 0 neighbor(s)']) assert.ok(detail.includes(line), `${line}\n${detail.join('\n')}`);
  assert.ok(detail.some(l => /^  Transmit Delay is 1 sec, State (DR|BDR), Priority 1$/.test(l)));
  assert.ok(detail.some(l => /^    Adjacent with neighbor 2\.2\.2\.2  \((Backup )?Designated Router\)$/.test(l)));
  assert.ok(detail.some(l => /^    Hello due in 00:00:\d\d$/.test(l)));
  assert.ok(c1.execute('show ip ospf interface loopback0').includes('  Loopback interface is treated as a stub Host'));
  invalidInput(c1, 'show ip ospf interface garbage');
});

test('show ip ospf prints the IOS process summary from actual areas and SPF runs', () => {
  const { c1, c2 } = ospfLab(), lines = c1.execute('show ip ospf');
  for (const line of [' Routing Process "ospf 1" with ID 1.1.1.1', ' Supports only single TOS(TOS0) routes', ' Supports opaque LSA', ' Supports Link-local Signaling (LLS)', ' Router is not originating router-LSAs with maximum metric', ' Initial SPF schedule delay 5000 msecs', ' Minimum hold time between two consecutive SPFs 10000 msecs', ' Maximum wait time between two consecutive SPFs 10000 msecs', ' Number of areas in this router is 1. 1 normal 0 stub 0 nssa', ' Reference bandwidth unit is 100 mbps', '    Area BACKBONE(0)', '        Number of interfaces in this area is 2 (1 loopback)', '\tArea has no authentication']) assert.ok(lines.includes(line), `${line}\n${lines.join('\n')}`);
  assert.ok(lines.some(l => /^\tSPF algorithm executed [1-9]\d* times$/.test(l)));
  const abr = c2.execute('show ip ospf');
  assert.ok(abr.includes(' It is an area border router'), abr.join('\n'));
  assert.ok(abr.includes(' Number of areas in this router is 2. 2 normal 0 stub 0 nssa'), abr.join('\n'));
  assert.ok(abr.includes('    Area 1'), abr.join('\n'));
});

test('show ip ospf database lists IOS LSA sections with sequence numbers and checksums', () => {
  const { c1 } = ospfLab(), lines = c1.execute('show ip ospf database'), output = lines.join('\n');
  assert.deepEqual(lines.slice(0, 6), ['', '            OSPF Router with ID (1.1.1.1) (Process ID 1)', '', '\t\tRouter Link States (Area 0)', '', 'Link ID         ADV Router      Age         Seq#       Checksum Link count']);
  assert.match(output, /^1\.1\.1\.1 {9}1\.1\.1\.1 {9}\d+ +0x8[0-9A-F]{7} 0x[0-9A-F]{6} 2$/m);
  assert.match(output, /^2\.2\.2\.2 {9}2\.2\.2\.2 {9}\d+ +0x8[0-9A-F]{7} 0x[0-9A-F]{6} \d+$/m);
  assert.match(output, /\t\tNet Link States \(Area 0\)\n\nLink ID         ADV Router      Age         Seq#       Checksum\n10\.0\.12\.\d/);
  assert.match(output, /\t\tSummary Net Link States \(Area 0\)\n\nLink ID         ADV Router      Age         Seq#       Checksum\n172\.16\.1\.0 {6}2\.2\.2\.2 /);
  noSimulatorNotes(output);
});

test('show ip ospf border-routers and traffic use IOS layouts with actual counters', () => {
  const { c1, r1 } = ospfLab(), border = c1.execute('show ip ospf border-routers');
  assert.deepEqual(border.slice(0, 9), ['', '            OSPF Router with ID (1.1.1.1) (Process ID 1)', '', '', '\t\tBase Topology (MTID 0)', '', 'Internal Router Routing Table', 'Codes: i - Intra-area route, I - Inter-area route', '']);
  assert.match(border[9], /^i 2\.2\.2\.2 \[1\] via 10\.0\.12\.2, GigabitEthernet0\/0, ABR, Area 0, SPF \d+$/);
  const traffic = c1.execute('show ip ospf traffic'), stats = r1.runtime.features.ospfTraffic;
  assert.ok(traffic.includes('OSPF statistics:'));
  assert.ok(traffic.includes(`  \t${stats.received.hello} hello, ${stats.received['database-description']} database desc, ${stats.received.request} link state req`), traffic.join('\n'));
  assert.ok(traffic.includes('    Interface GigabitEthernet0/0'));
  assert.ok(traffic.includes('  Type          Packets              Bytes'));
  assert.ok(traffic.some(l => l.startsWith('  RX Hello      ' + String(stats.interfaces['GigabitEthernet0/0'].received.hello.packets).padEnd(21))), traffic.join('\n'));
  assert.ok(traffic.includes('Summary traffic statistics for process ID 1:'));
  invalidInput(c1, 'show ip ospf traffic bogus');
});

test('show ip protocols prints IOS application and OSPF blocks', () => {
  const { c1 } = ospfLab(), lines = c1.execute('show ip protocols');
  assert.deepEqual(lines.slice(0, 13), ['*** IP Routing is NSF aware ***', '', 'Routing Protocol is "application"', '  Sending updates every 0 seconds', '  Invalid after 0 seconds, hold down 0, flushed after 0', '  Outgoing update filter list for all interfaces is not set', '  Incoming update filter list for all interfaces is not set', '  Maximum path: 32', '  Routing for Networks:', '  Routing Information Sources:', '    Gateway         Distance      Last Update', '  Distance: (default is 4)', '']);
  const start = lines.indexOf('Routing Protocol is "ospf 1"');
  assert.ok(start > 0, lines.join('\n'));
  const block = lines.slice(start);
  for (const line of ['  Router ID 1.1.1.1', '  Number of areas in this router is 1. 1 normal 0 stub 0 nssa', '  Maximum path: 4', '  Routing for Networks:', '    10.0.12.0 0.0.0.255 area 0', '    1.1.1.1 0.0.0.0 area 0', '  Distance: (default is 110)']) assert.ok(block.includes(line), `${line}\n${block.join('\n')}`);
  assert.ok(block.some(l => /^    2\.2\.2\.2 {14}110      \d\d:\d\d:\d\d$/.test(l)), block.join('\n'));
  invalidInput(c1, 'show ip protocols bogus');
});

test('EIGRP neighbors, topology, interfaces and protocols use IOS layouts', () => {
  const { sim, c1, c2 } = pair();
  run(c1, ...base(1), 'router eigrp 100', 'network 10.0.12.0 0.0.0.255', 'network 1.1.1.1 0.0.0.0', 'end');
  run(c2, ...base(2), 'router eigrp 100', 'network 10.0.12.0 0.0.0.255', 'network 2.2.2.2 0.0.0.0', 'end');
  sim.advance(60000);
  const neighbors = c1.execute('show ip eigrp neighbors');
  assert.deepEqual(neighbors.slice(0, 3), ['EIGRP-IPv4 Neighbors for AS(100)', 'H   Address                 Interface              Hold Uptime   SRTT   RTO  Q  Seq', '                                                   (sec)         (ms)       Cnt Num']);
  assert.match(neighbors[3], /^0 {3}10\.0\.12\.2 {15}Gi0\/0 +1[0-5] \d\d:\d\d:\d\d +\d+ +\d+ +0 +\d+$/);
  noSimulatorNotes(neighbors.join('\n'));
  assert.match(text(c1, 'show ip eigrp neighbors detail'), /Max Nbrs: 0, Current Nbrs: 1/);
  const topology = c1.execute('show ip eigrp topology');
  assert.deepEqual(topology.slice(0, 4), ['EIGRP-IPv4 Topology Table for AS(100)/ID(1.1.1.1)', '', 'Codes: P - Passive, A - Active, U - Update, Q - Query, R - Reply,', '       r - reply Status, s - sia Status ']);
  const topologyText = topology.join('\n');
  assert.match(topologyText, /^P 10\.0\.12\.0\/24, 1 successors, FD is \d+\n        via Connected, GigabitEthernet0\/0$/m);
  assert.match(topologyText, /^P 2\.2\.2\.2\/32, 1 successors, FD is \d+\n        via 10\.0\.12\.2 \(\d+\/\d+\), GigabitEthernet0\/0$/m);
  assert.doesNotMatch(topologyText, /Rlocal/);
  const interfaces = c1.execute('show ip eigrp interfaces');
  assert.deepEqual(interfaces.slice(0, 3), ['EIGRP-IPv4 Interfaces for AS(100)', '                              Xmit Queue   PeerQ        Mean   Pacing Time   Multicast    Pending', 'Interface              Peers  Un/Reliable  Un/Reliable  SRTT   Un/Reliable   Flow Timer   Routes']);
  assert.ok(interfaces.some(l => /^Gi0\/0 {18}1 /.test(l)), interfaces.join('\n'));
  const protocols = c1.execute('show ip protocols');
  for (const line of ['Routing Protocol is "eigrp 100"', '  EIGRP-IPv4 Protocol for AS(100)', '    Metric weight K1=1, K2=0, K3=1, K4=0, K5=0', '    Router-ID: 1.1.1.1', '    Topology : 0 (base)', '      Distance: internal 90 external 170', '      Maximum hopcount 100', '      Maximum metric variance 1', '  Automatic Summarization: disabled', '    10.0.12.0/24', '    1.1.1.1/32', '  Distance: internal 90 external 170']) assert.ok(protocols.includes(line), `${line}\n${protocols.join('\n')}`);
  assert.ok(protocols.some(l => /^    10\.0\.12\.2 {13}90      \d\d:\d\d:\d\d$/.test(l)), protocols.join('\n'));
  invalidInput(c1, 'show ip eigrp neighbors bogus');
});

test('BGP summary, table and neighbor views follow IOS 15 layouts', () => {
  const { sim, c1, c2 } = pair();
  run(c1, ...base(1), 'router bgp 65001', 'neighbor 10.0.12.2 remote-as 65002', 'network 1.1.1.1 mask 255.255.255.255', 'end');
  run(c2, ...base(2), 'router bgp 65002', 'neighbor 10.0.12.1 remote-as 65001', 'network 2.2.2.2 mask 255.255.255.255', 'end');
  sim.advance(120000);
  const summary = c1.execute('show ip bgp summary');
  assert.equal(summary[0], 'BGP router identifier 1.1.1.1, local AS number 65001');
  assert.match(summary[1], /^BGP table version is \d+, main routing table version \d+$/);
  assert.ok(summary.includes('Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd'), summary.join('\n'));
  assert.ok(summary.some(l => /^10\.0\.12\.2 {7}4 {8}65002 +\d+ +\d+ +\d+ +0 +0 \d\d:\d\d:\d\d +1$/.test(l)), summary.join('\n'));
  const table = c1.execute('show ip bgp');
  assert.match(table[0], /^BGP table version is \d+, local router ID is 1\.1\.1\.1$/);
  assert.deepEqual(table.slice(1, 9), ['Status codes: s suppressed, d damped, h history, * valid, > best, i - internal, ', '              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter, ', '              x best-external, a additional-path, c RIB-compressed, ', '              t secondary path, L long-lived-stale,', 'Origin codes: i - IGP, e - EGP, ? - incomplete', 'RPKI validation codes: V valid, I invalid, N Not found', '', '     Network          Next Hop            Metric LocPrf Weight Path']);
  assert.ok(table.includes(' *>  1.1.1.1/32       0.0.0.0                  0         32768 i'), table.join('\n'));
  assert.ok(table.includes(' *>  2.2.2.2/32       10.0.12.2                0             0 65002 i'), table.join('\n'));
  const neighbor = c1.execute('show ip bgp neighbors 10.0.12.2');
  assert.equal(neighbor[0], 'BGP neighbor is 10.0.12.2,  remote AS 65002, external link');
  assert.equal(neighbor[1], '  BGP version 4, remote router ID 2.2.2.2');
  assert.match(neighbor[2], /^  BGP state = Established, up for \d\d:\d\d:\d\d$/);
  assert.ok(neighbor.includes('  Address tracking is enabled, the RIB does have a route to 10.0.12.2'));
  assert.match(text(c1, 'show ip bgp neighbors 10.0.12.99'), /No such neighbor/);
  const entry = c1.execute('show ip bgp 2.2.2.2');
  assert.match(entry[0], /^BGP routing table entry for 2\.2\.2\.2\/32, version \d+$/);
  assert.ok(entry.includes('    10.0.12.2 from 10.0.12.2 (2.2.2.2)'), entry.join('\n'));
  assert.ok(entry.includes('      Origin IGP, metric 0, localpref 100, valid, external, best'), entry.join('\n'));
});

test('BGP neighbor output does not claim an unreachable peer has a route', () => {
  const sim = new Simulator(71), r = sim.addDevice('router'), cli = new IOSSession(sim, r.id);
  run(cli, 'enable', 'configure terminal', 'router bgp 65001', 'neighbor 192.0.2.2 remote-as 65002', 'end');
  const before = JSON.stringify(r.config), now = sim.clock.now();
  assert.match(text(cli, 'show ip bgp neighbors 192.0.2.2'), /the RIB does not have a route to 192\.0\.2\.2/);
  assert.equal(JSON.stringify(r.config), before);
  assert.equal(sim.clock.now(), now);
});

test('RIP database and protocols use IOS formats with actual sources', () => {
  const { sim, c1, c2 } = pair();
  run(c1, ...base(1), 'router rip', 'version 2', 'no auto-summary', 'network 10.0.0.0', 'network 1.0.0.0', 'end');
  run(c2, ...base(2), 'router rip', 'version 2', 'no auto-summary', 'network 10.0.0.0', 'network 2.0.0.0', 'end');
  sim.advance(90000);
  const database = c1.execute('show ip rip database');
  assert.ok(database.includes('10.0.12.0/24    directly connected, GigabitEthernet0/0'), database.join('\n'));
  const learned = database.indexOf('2.2.2.2/32');
  assert.ok(learned >= 0, database.join('\n'));
  assert.match(database[learned + 1], /^    \[1\] via 10\.0\.12\.2, \d\d:\d\d:\d\d, GigabitEthernet0\/0$/);
  const protocols = c1.execute('show ip protocols');
  for (const line of ['Routing Protocol is "rip"', '  Invalid after 180 seconds, hold down 180, flushed after 240', '  Redistributing: rip', '  Default version control: send version 2, receive version 2', '    Interface                           Send  Recv  Triggered RIP  Key-chain', '  Automatic network summarization is not in effect', '  Distance: (default is 120)']) assert.ok(protocols.includes(line), `${line}\n${protocols.join('\n')}`);
  assert.ok(protocols.some(l => /^  Sending updates every 30 seconds, next due in \d+ seconds$/.test(l)));
  assert.ok(protocols.some(l => /^    10\.0\.12\.2 {12}120      \d\d:\d\d:\d\d$/.test(l)), protocols.join('\n'));
  assert.deepEqual(c1.execute('show ipv6 protocols'), ['IPv6 Routing Protocol is "connected"', 'IPv6 Routing Protocol is "application"', 'IPv6 Routing Protocol is "ND"']);
  invalidInput(c1, 'show ip rip database bogus');
});

test('HSRP, VRRP and GLBP brief views use IOS headers and real peer addresses', () => {
  const { sim, c1, c2 } = pair();
  run(c1, 'enable', 'configure terminal', 'interface g0/0', 'ip address 10.0.12.1 255.255.255.0', 'standby 1 ip 10.0.12.254', 'standby 1 priority 110', 'standby 1 preempt', 'vrrp 2 ip 10.0.12.253', 'glbp 3 ip 10.0.12.252', 'no shutdown', 'end');
  run(c2, 'enable', 'configure terminal', 'interface g0/0', 'ip address 10.0.12.2 255.255.255.0', 'standby 1 ip 10.0.12.254', 'vrrp 2 ip 10.0.12.253', 'glbp 3 ip 10.0.12.252', 'no shutdown', 'end');
  sim.advance(90000);
  const standby = c1.execute('show standby brief');
  assert.deepEqual(standby.slice(0, 3), ['                     P indicates configured to preempt.', '                     |', 'Interface   Grp  Pri P State   Active          Standby         Virtual IP']);
  assert.match(standby[3], /^Gi0\/0 {7}1 {4}110 P Active  local {11}10\.0\.12\.2 {7}10\.0\.12\.254$/);
  const detail = c1.execute('show standby');
  for (const line of ['GigabitEthernet0/0 - Group 1', '  State is Active', '  Virtual IP address is 10.0.12.254', '  Active router is local', '  Priority 110 (configured 110)']) assert.ok(detail.includes(line), `${line}\n${detail.join('\n')}`);
  const vrrp = c1.execute('show vrrp brief');
  assert.equal(vrrp[0], 'Interface          Grp Pri Time  Own Pre State   Master addr     Group addr');
  assert.match(vrrp[1], /^Gi0\/0 {14}2 {3}100 \d{4} {7}Y  (Master|Backup) +10\.0\.12\.[12] +10\.0\.12\.253/);
  const glbp = c1.execute('show glbp brief');
  assert.equal(glbp[0], 'Interface   Grp  Fwd Pri State    Address         Active router   Standby router');
  assert.ok(glbp.some(l => /^Gi0\/0 {7}3 {4}- {3}100 (Active|Standby) +10\.0\.12\.252 /.test(l)), glbp.join('\n'));
  assert.ok(glbp.some(l => /^Gi0\/0 {7}3 {4}[12] {3}7 {3}(Active|Listen) +0007\.b400\.030[12] /.test(l)), glbp.join('\n'));
  for (const command of ['show standby brief', 'show vrrp brief', 'show glbp brief']) noSimulatorNotes(text(c1, command));
});
