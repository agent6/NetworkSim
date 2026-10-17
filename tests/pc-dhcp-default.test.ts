import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {factoryDeviceConfig} from '../src/model.ts';
import {WindowsSession} from '../src/windows-cli.ts';

function server(sim:Simulator){
  const device=sim.addDevice('server');
  Object.assign(device.config.interfaces.GigabitEthernet0,{ip:'192.0.2.1',mask:'255.255.255.0'});
  device.config.services.dhcp={enabled:true,pools:[{name:'LAN',network:'192.0.2.0',prefix:24,defaultRouter:'192.0.2.1',dnsServers:['192.0.2.1']}],excluded:[{start:'192.0.2.1',end:'192.0.2.9'}]};
  sim.changed();return device;
}
test('new PCs default to DHCP while servers retain manual IPv4 addressing',()=>{
  assert.equal(factoryDeviceConfig('pc','PC1').interfaces.GigabitEthernet0.features.dhcp,true);
  assert.equal(factoryDeviceConfig('server','SRV1').interfaces.GigabitEthernet0.features.dhcp,undefined);
});
test('a newly connected PC obtains its address, gateway and DNS using automatic DHCP packets',()=>{
  const sim=new Simulator(425),pc=sim.addDevice('pc'),dhcp=server(sim);
  sim.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:dhcp.id,port:'GigabitEthernet0'});sim.advance(7000);
  assert.equal(pc.config.interfaces.GigabitEthernet0.ip,'192.0.2.10');
  assert.equal(pc.config.defaultGateway,'192.0.2.1');assert.deepEqual(pc.config.dnsServers,['192.0.2.1']);
  assert.equal(pc.runtime.features.dhcpClientLeases.GigabitEthernet0.state,'BOUND');
  assert.ok(dhcp.runtime.features.dhcpServerStats.received.discover>0);assert.ok(dhcp.runtime.features.dhcpServerStats.sent.ack>0);
});
test('a PC added without a cable retries DHCP after its link becomes available',()=>{
  const sim=new Simulator(426),pc=sim.addDevice('pc');sim.advance(11000);
  assert.equal(pc.config.interfaces.GigabitEthernet0.ip,undefined);
  const dhcp=server(sim);sim.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:dhcp.id,port:'GigabitEthernet0'});sim.advance(7000);
  assert.equal(pc.config.interfaces.GigabitEthernet0.ip,'192.0.2.10');
});
test('choosing a static PC address stops automatic acquisition and preserves saved configuration',()=>{
  const sim=new Simulator(427),pc=sim.addDevice('pc'),dhcp=server(sim),cli=new WindowsSession(sim,pc.id);
  sim.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:dhcp.id,port:'GigabitEthernet0'});
  assert.doesNotMatch(cli.execute('netsh interface ipv4 set address Ethernet static 192.0.2.50 255.255.255.0 192.0.2.1').join('\n'),/error|invalid/i);
  sim.advance(7000);assert.equal(pc.config.interfaces.GigabitEthernet0.ip,'192.0.2.50');assert.ok(!pc.config.interfaces.GigabitEthernet0.features.dhcp);
  const loaded=new Simulator();loaded.load(sim.serialize());loaded.advance(7000);
  assert.equal(loaded.getDevice(pc.id)!.config.interfaces.GigabitEthernet0.ip,'192.0.2.50');assert.ok(!loaded.getDevice(pc.id)!.config.interfaces.GigabitEthernet0.features.dhcp);
});

test('automatic startup shares an in-flight DHCP request and does not undo a manual release',()=>{
  const sim=new Simulator(428),pc=sim.addDevice('pc'),dhcp=server(sim);
  sim.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:dhcp.id,port:'GigabitEthernet0'});
  const manual=sim.requestDHCP(pc.id,'GigabitEthernet0');sim.advance(1);
  assert.equal(sim.requestDHCP(pc.id,'GigabitEthernet0'),manual);sim.advance(1500);
  assert.equal(manual.status,'success');assert.equal(dhcp.runtime.features.dhcpServerStats.received.discover,1);
  sim.releaseDHCP(pc.id,'GigabitEthernet0');sim.advance(7000);
  assert.equal(pc.config.interfaces.GigabitEthernet0.ip,undefined);assert.equal(dhcp.runtime.features.dhcpLeases.length,0);
});
test('loading an existing static lab does not apply the new-PC DHCP default',()=>{
  const sim=new Simulator(429),pc=sim.addDevice('pc');
  delete pc.config.interfaces.GigabitEthernet0.features.dhcp;
  Object.assign(pc.config.interfaces.GigabitEthernet0,{ip:'198.51.100.10',mask:'255.255.255.0'});
  pc.config.defaultGateway='198.51.100.1';
  const loaded=new Simulator();loaded.load(sim.serialize());loaded.advance(7000);
  const saved=loaded.getDevice(pc.id)!;assert.equal(saved.config.interfaces.GigabitEthernet0.ip,'198.51.100.10');
  assert.equal(saved.config.defaultGateway,'198.51.100.1');assert.equal(saved.config.interfaces.GigabitEthernet0.features.dhcp,undefined);
});
