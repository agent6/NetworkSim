import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { defaultInterface, type Device, type DeviceKind } from '../src/model.ts';

const host = 'GigabitEthernet0', g = (n: number) => 'GigabitEthernet0/' + n;
function commands(cli: IOSSession, ...lines: string[]) {
  for (const line of lines) {
    const result = cli.execute(line);
    assert.ok(!result.some(value => value.startsWith('%')), line + ': ' + result.join('\n'));
  }
}
function address(device: Device, port: string, ip: string) {
  const cfg = device.config.interfaces[port] ??= defaultInterface(port);
  Object.assign(cfg, { ip, mask: '255.255.255.0', adminUp: true, switchport: false });
  delete cfg.features.dhcp;
}
function cable(sim: Simulator, a: Device, ap: string, b: Device, bp: string) {
  sim.connect({ deviceId: a.id, port: ap }, { deviceId: b.id, port: bp });
}
function switched(kind: DeviceKind) {
  const sim = new Simulator(1901), a = sim.addDevice('pc'), sw = sim.addDevice(kind), b = sim.addDevice('server');
  address(a, host, '192.0.2.1'); address(b, host, '192.0.2.2');
  const cli = new IOSSession(sim, sw.id);
  commands(cli, 'enable', 'configure terminal', 'spanning-tree mode rapid-pvst', 'end');
  cable(sim, a, host, sw, g(1)); cable(sim, sw, g(2), b, host); sim.advance(1500);
  let received = 0;
  sim.registerUDPService(9000, device => device.id === b.id, (_device, payload) => { received++; return payload; });
  const send = () => { const request = sim.udpRequest(a.id, '192.0.2.2', 9000, { number: received + 1 }, { timeout: 1000 }); sim.advance(1500); return request; };
  return { sim, a, sw, b, cli, send, received: () => received };
}

test('L2, L3 and PoE switch physical input/output policies govern bridged traffic and removal restores delivery', () => {
  for (const kind of ['switch', 'l3switch', 'poeswitch'] as const) {
    const { sim, sw, cli, send, received } = switched(kind);
    assert.equal(send().status, 'success', kind + ' baseline');
    commands(cli, 'configure terminal', 'policy-map BLOCK', 'class class-default', 'drop', 'exit', 'exit', 'interface ' + g(1), 'service-policy input BLOCK', 'end');
    assert.equal(send().status, 'failure'); assert.equal(received(), 1);
    assert.equal(sw.runtime.features.qosCounters['BLOCK:class-default:' + g(1) + ':in'].dropped, 1);
    commands(cli, 'configure terminal', 'interface ' + g(1), 'no service-policy input BLOCK', 'exit', 'interface ' + g(2), 'service-policy output BLOCK', 'end');
    assert.equal(send().status, 'failure'); assert.equal(received(), 1);
    assert.equal(sw.runtime.features.qosCounters['BLOCK:class-default:' + g(2) + ':out'].dropped, 1);
    commands(cli, 'configure terminal', 'interface ' + g(2), 'no service-policy output BLOCK', 'end');
    assert.equal(send().status, 'success'); assert.equal(received(), 2);
    assert.ok(sim.events.some(event => event.nodeId === sw.id && event.label === 'QoS class drop'));
  }
});

test('Catalyst physical marking takes precedence over VLAN marking and SVI routing does not charge ingress twice', () => {
  const { sim, sw, b, cli, send } = switched('l3switch');
  commands(cli, 'configure terminal', 'policy-map VLAN-MARK', 'class class-default', 'set dscp af11', 'exit', 'exit', 'policy-map PORT-MARK', 'class class-default', 'set dscp ef', 'exit', 'exit', 'interface Vlan1', 'ip address 192.0.2.254 255.255.255.0', 'no shutdown', 'service-policy input VLAN-MARK', 'exit', 'interface ' + g(1), 'service-policy input PORT-MARK', 'end');
  assert.equal(send().status, 'success');
  assert.ok(sim.events.some(event => event.nodeId === b.id && event.label === 'Frame received' && event.packet?.destination === '192.0.2.2' && event.packet.dscp === 46));
  assert.equal(sw.runtime.features.qosCounters['PORT-MARK:class-default:' + g(1) + ':in'].matched, 1);
  assert.equal(sw.runtime.features.qosCounters['VLAN-MARK:class-default:Vlan1:in'].matched, 1, 'Only the response on the other physical port uses the VLAN policy');
  const local = sim.ping(sim.lab.devices.find(device => device.kind === 'pc')!.id, '192.0.2.254', { count: 1 });
  sim.advance(1500); assert.equal(local.received, 1);
  assert.equal(sw.runtime.features.qosCounters['PORT-MARK:class-default:' + g(1) + ':in'].matched, 2, 'One charge per arriving request, even when delivered through Vlan1');
  assert.equal(sw.runtime.features.qosCounters['VLAN-MARK:class-default:Vlan1:in'].matched, 1);
  commands(cli, 'configure terminal', 'interface ' + g(1), 'no service-policy input PORT-MARK', 'end');
  sim.events = []; assert.equal(send().status, 'success');
  assert.ok(sim.events.some(event => event.nodeId === b.id && event.label === 'Frame received' && event.packet?.destination === '192.0.2.2' && event.packet.dscp === 10));
});

test('LACP member input policies mark real hashed flows once on the receiving physical member', () => {
  const sim = new Simulator(1902), a = sim.addDevice('pc'), left = sim.addDevice('switch'), right = sim.addDevice('switch'), b = sim.addDevice('server');
  address(a, host, '192.0.2.1'); address(b, host, '192.0.2.2');
  for (const [sw, mode] of [[left, 'active'], [right, 'passive']] as const) {
    const cli = new IOSSession(sim, sw.id);
    commands(cli, 'enable', 'configure terminal', 'spanning-tree mode rapid-pvst', 'interface range ' + g(2) + ' - 3', 'channel-group 1 mode ' + mode, 'end');
    if (sw === right) commands(cli, 'configure terminal', 'policy-map MARK', 'class class-default', 'set dscp ef', 'exit', 'exit', 'interface range ' + g(2) + ' - 3', 'service-policy input MARK', 'end');
  }
  cable(sim, a, host, left, g(1)); cable(sim, left, g(2), right, g(2)); cable(sim, left, g(3), right, g(3)); cable(sim, right, g(1), b, host); sim.advance(2000);
  assert.equal(left.runtime.features.portChannels[1].activeMembers.length, 2);
  sim.registerUDPService(9000, device => device.id === b.id, (_device, payload) => payload);
  for (let n = 0; n < 8; n++) { const request = sim.udpRequest(a.id, '192.0.2.2', 9000, { n }, { sourcePort: 20000 + n }); sim.advance(30); assert.equal(request.status, 'success'); }
  const rows = Object.values<any>(right.runtime.features.qosCounters);
  assert.equal(rows.reduce((sum, row) => sum + row.matched, 0), 8);
  assert.ok(sim.events.filter(event => event.nodeId === b.id && event.label === 'Frame received' && event.packet?.protocol === 'UDP').every(event => event.packet?.dscp === 46));
});

test('standard and extended ACL route-map matches filter delivered BGP advertisements and real routed UDP', () => {
  const sim = new Simulator(1903), a = sim.addDevice('router'), b = sim.addDevice('router');
  const ca = new IOSSession(sim, a.id), cb = new IOSSession(sim, b.id);
  for (const [cli, ip, loop, asn, peer] of [
    [ca, '10.0.0.1', '198.51.100.1', 65001, '10.0.0.2'],
    [cb, '10.0.0.2', '203.0.113.2', 65002, '10.0.0.1'],
  ] as const) commands(cli, 'enable', 'configure terminal', 'interface ' + g(0), 'ip address ' + ip + ' 255.255.255.0', 'no shutdown', 'interface Loopback0', 'ip address ' + loop + ' 255.255.255.255', 'router bgp ' + asn, 'bgp router-id ' + ip, 'neighbor ' + peer + ' remote-as ' + (asn === 65001 ? 65002 : 65001), 'network ' + loop + ' mask 255.255.255.255', 'end');
  commands(cb, 'configure terminal', 'interface Loopback1', 'ip address 203.0.113.3 255.255.255.255', 'router bgp 65002', 'network 203.0.113.3 mask 255.255.255.255', 'end');
  cable(sim, a, g(0), b, g(0)); sim.advance(2000);
  const learned = (network: string) => a.runtime.routes.some(route => route.network === network && route.protocol === 'B');
  assert.ok(learned('203.0.113.2')); assert.ok(learned('203.0.113.3'));
  commands(cb, 'configure terminal', 'access-list 10 permit host 203.0.113.2', 'route-map FILTER permit 10', 'match ip address 10', 'router bgp 65002', 'neighbor 10.0.0.1 route-map FILTER out', 'end');
  sim.advance(100); assert.ok(learned('203.0.113.2')); assert.equal(learned('203.0.113.3'), false);
  sim.registerUDPService(9000, device => device.id === b.id, (_device, payload) => payload);
  let request = sim.udpRequest(a.id, '203.0.113.2', 9000, { acl: 'standard' }, { source: '198.51.100.1' }); sim.advance(100); assert.equal(request.status, 'success');
  commands(cb, 'configure terminal', 'access-list 101 permit ip host 203.0.113.3 host 255.255.255.255', 'route-map FILTER permit 10', 'no match ip address 10', 'match ip address 101', 'end');
  sim.advance(100); assert.equal(learned('203.0.113.2'), false); assert.ok(learned('203.0.113.3'));
  request = sim.udpRequest(a.id, '203.0.113.3', 9000, { acl: 'extended' }, { source: '198.51.100.1' }); sim.advance(100); assert.equal(request.status, 'success');
  commands(cb, 'configure terminal', 'router bgp 65002', 'no neighbor 10.0.0.1 route-map FILTER out', 'end');
  sim.advance(100); assert.ok(learned('203.0.113.2')); assert.ok(learned('203.0.113.3'));
});

test('VTPv1/v2 higher revisions propagate from clients and servers, preserve extended VLANs and change packet forwarding', () => {
  for (const version of [1, 2]) {
    const sim = new Simulator(1904 + version), left = sim.addDevice('switch'), right = sim.addDevice('poeswitch'), a = sim.addDevice('pc'), b = sim.addDevice('server');
    address(a, host, '192.0.2.1'); address(b, host, '192.0.2.2');
    left.config.features.vtp = { mode: 'server', version, domain: 'campus', password: 'shared', revision: 5 };
    right.config.features.vtp = { mode: 'client', version, domain: 'campus', password: 'shared', revision: 2 };
    left.config.vlans[20] = { id: 20, name: 'LAB', active: true };
    left.config.vlans[2001] = { id: 2001, name: 'SOURCE-LOCAL', active: true };
    right.config.vlans[2000] = { id: 2000, name: 'RECEIVER-LOCAL', active: true };
    for (const sw of [left, right]) {
      sw.config.features.stp = { mode: 'rapid-pvst' };
      sw.config.interfaces[g(1)].vlan = 20;
      sw.config.interfaces[g(24)].mode = 'trunk';
    }
    cable(sim, left, g(24), right, g(24)); cable(sim, a, host, left, g(1)); cable(sim, b, host, right, g(1)); sim.advance(2000);
    assert.equal(right.config.vlans[20]?.name, 'LAB'); assert.equal(right.config.features.vtp.revision, 5);
    assert.ok(right.config.vlans[2000]); assert.equal(right.config.vlans[2001], undefined, 'VTPv1/v2 does not distribute extended-range VLANs');
    sim.registerUDPService(9000, device => device.id === b.id, (_device, payload) => payload);
    const send = () => { const request = sim.udpRequest(a.id, '192.0.2.2', 9000, { version }, { timeout: 1000 }); sim.advance(1500); return request; };
    assert.equal(send().status, 'success');
    const cli = new IOSSession(sim, left.id);
    commands(cli, 'enable', 'configure terminal', 'vlan 20', 'name RENAMED', 'end');sim.advance(20);
    assert.equal(left.config.features.vtp.revision, 6); assert.equal(right.config.features.vtp.revision, 6); assert.equal(right.config.vlans[20]?.name, 'RENAMED');
    right.config.features.vtp.revision = 8; sim.changed();sim.advance(20);
    assert.equal(left.config.features.vtp.revision, 8, 'A server accepts a higher received client revision even if the VLAN payload is unchanged');
    right.config.vlans[30] = { id: 30, name: 'CONFLICT', active: true }; sim.changed();sim.advance(20);
    assert.equal(left.config.vlans[30], undefined, 'An equal-revision conflicting database must not overwrite its peer');
    assert.equal(left.config.features.vtp.revision, 8, 'Learned revisions do not increment on later recomputation');
    commands(cli, 'configure terminal', 'no vlan 20', 'end');sim.advance(20);
    assert.equal(left.config.features.vtp.revision, 9); assert.equal(right.config.features.vtp.revision, 9); assert.equal(right.config.vlans[20], undefined);
    assert.ok(right.config.vlans[2000]); assert.equal(send().status, 'failure', 'Removing the distributed VLAN removes its actual broadcast domain');
  }
});

test('routed LACP peers may use different local VRF names while their real packet paths stay isolated',()=>{
 const sim=new Simulator(1910),left=sim.addDevice('l3switch'),right=sim.addDevice('l3switch');
 for(const[d,vrf,group,ip]of[[left,'BLUE',1,'10.0.0.1'],[right,'RED',7,'10.0.0.2']] as const){const cli=new IOSSession(sim,d.id);commands(cli,'enable','configure terminal','ip routing','vrf definition '+vrf,'address-family ipv4','exit-address-family','exit','interface range '+g(1)+' - 2','no switchport','vrf forwarding '+vrf,'channel-group '+group+' mode active','interface Port-channel'+group,'no switchport','vrf forwarding '+vrf,'ip address '+ip+' 255.255.255.0','no shutdown','end');}
 cable(sim,left,g(1),right,g(1));cable(sim,left,g(2),right,g(2));sim.advance(50);
 assert.equal(left.runtime.features.portChannels[1].activeMembers.length,2);assert.equal(right.runtime.features.portChannels[7].activeMembers.length,2);
 sim.registerUDPService(9000,d=>d===right,(_d,p)=>p);const request=sim.udpRequest(left.id,'10.0.0.2',9000,{localVrf:true},{source:'10.0.0.1',vrf:'BLUE'});sim.advance(100);assert.equal(request.status,'success');
 const wrong=sim.udpRequest(left.id,'10.0.0.2',9000,{localVrf:false},{vrf:'RED',timeout:100});sim.advance(150);assert.equal(wrong.status,'failure');
});

test('CoPP and routed physical egress policies drop actual OSPF and EIGRP messages, withdraw routes and recover',()=>{
 for(const protocol of ['ospf','eigrp'] as const){const sim=new Simulator(1911),a=sim.addDevice('router'),b=sim.addDevice('router'),ca=new IOSSession(sim,a.id);
  for(const[d,n]of[[a,1],[b,2]] as const){const cli=d===a?ca:new IOSSession(sim,d.id);commands(cli,'enable','configure terminal','interface '+g(0),`ip address 10.0.0.${n} 255.255.255.0`,'no shutdown','interface Loopback0',`ip address 192.0.2.${n} 255.255.255.255`,'router '+protocol+' '+(protocol==='ospf'?1:100),...(protocol==='ospf'?['router-id '+`${n}.${n}.${n}.${n}`,'network 0.0.0.0 255.255.255.255 area 0']:['network 0.0.0.0 255.255.255.255']),'end');}
  cable(sim,a,g(0),b,g(0));sim.advance(2000);const route=(d:Device,address:string)=>d.runtime.routes.some(row=>row.network===address&&row.protocol.startsWith(protocol==='ospf'?'O':'D'));assert.ok(route(a,'192.0.2.2'));
  commands(ca,'configure terminal','ip access-list extended CONTROL','permit '+protocol+' any any','exit','class-map match-any CONTROL','match access-group name CONTROL','exit','policy-map DISCARD','class CONTROL','drop','exit','exit','control-plane','service-policy input DISCARD','end');
  sim.advance(protocol==='ospf'?41000:16000);assert.equal(route(a,'192.0.2.2'),false);assert.ok(a.runtime.features.qosCounters['DISCARD:CONTROL:control-plane:in'].dropped>0);
  let ping=sim.ping(a.id,'10.0.0.2',{count:1});sim.advance(500);assert.equal(ping.received,1,'CoPP classification leaves unrelated connected ICMP operational');
  commands(ca,'configure terminal','control-plane','no service-policy input DISCARD','end');sim.advance(12000);assert.ok(route(a,'192.0.2.2'));
  commands(ca,'configure terminal','interface '+g(0),'service-policy output DISCARD','end');sim.advance(protocol==='ospf'?41000:16000);assert.equal(route(b,'192.0.2.1'),false);assert.ok(a.runtime.features.qosCounters['DISCARD:CONTROL:'+g(0)+':out'].dropped>0,'Direct multicast transmission obeys its physical egress policy');
  commands(ca,'configure terminal','interface '+g(0),'no service-policy output DISCARD','end');sim.advance(12000);assert.ok(route(b,'192.0.2.1'));
  ping=sim.ping(a.id,'192.0.2.2',{source:'192.0.2.1',count:1});sim.advance(500);assert.equal(ping.received,1,'Routing recovers through real request and return packets');
 }
});
