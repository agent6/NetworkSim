import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {IOSSession} from '../src/cli.ts';
import {ospfLiveDetail} from '../src/ospf-packets.ts';
import {iosRejected} from '../src/ios-help.ts';
const text=(cli:{execute(s:string):string[]},s:string)=>cli.execute(s).join('\n');
function run(cli:{execute(s:string):string[]},...commands:string[]){for(const s of commands)assert.ok(!cli.execute(s).some(iosRejected),s);}
function pair(){
  const sim=new Simulator(97201),a=sim.addDevice('datacenter'),b=sim.addDevice('datacenter'),ca=new NSOSSession(sim,a.id,{skipConsoleLogin:true}),cb=new NSOSSession(sim,b.id,{skipConsoleLogin:true});
  for(const [cli,rid,ip,v6]of [[ca,'1.1.1.1','10.0.0.1','2001:db8:1::1'],[cb,'2.2.2.2','10.0.0.2','2001:db8:1::2']] as const)
    run(cli,'conf t','feature ospf','feature lldp','router ospf LAB','router-id '+rid,'exit','interface Ethernet1/1','no switchport','ip address '+ip+'/30','ipv6 address '+v6+'/64','ip router ospf LAB area 0','no shutdown','end');
  const link=sim.connect({deviceId:a.id,port:'Ethernet1/1'},{deviceId:b.id,port:'Ethernet1/1'});sim.advance(45000);
  return {sim,a,b,ca,cb,link};
}
test('NX-style RIB, interface brief and OSPF display packet-derived state without advancing time',()=>{
  const {sim,a,b,ca,cb}=pair();
  run(cb,'conf t','interface Loopback0','ip address 192.0.2.9/32','ip router ospf LAB area 0','no shutdown','end');sim.advance(15000);
  const before=sim.clock.now(),full=ospfLiveDetail(sim,a.id,'ospf')!.neighbors.find(n=>n.state==='FULL')!;
  assert.ok(full.upSince!==undefined);assert.ok(full.upSince!<before);
  assert.match(text(ca,'show ip ospf neighbor'),/OSPF Process ID LAB VRF default[\s\S]*Total number of neighbors: 1[\s\S]*2\.2\.2\.2\s+1 FULL\/(?:DR|BDR|DROTHER)\s+00:00:\d\d\s+10\.0\.0\.2\s+Eth1\/1/);
  const rib=text(ca,'show ip route');assert.match(rib,/10\.0\.0\.0\/30, ubest\/mbest: 1\/0, attached/);assert.match(rib,/\*via 10\.0\.0\.1, Eth1\/1, \[0\/0\], \d\d:\d\d:\d\d, direct/);assert.match(rib,/192\.0\.2\.9\/32[\s\S]*ospf-LAB, intra/);
  assert.match(text(ca,'show ipv6 route'),/IPv6 Routing Table for VRF "default"[\s\S]*2001:db8:1::\/64, ubest\/mbest: 1\/0, attached/);
  assert.match(text(ca,'show ip interface brief'),/Eth1\/1\s+10\.0\.0\.1\s+protocol-up\/link-up\/admin-up/);
  assert.doesNotMatch(text(ca,'show ip interface brief'),/mgmt0|Eth1\/2\s/);
  assert.match(text(ca,'show ip route vrf missing'),/% VRF/);
  assert.equal(sim.clock.now(),before);
  run(cb,'conf t','interface Loopback0','shutdown','end');sim.advance(15000);assert.doesNotMatch(text(ca,'show ip route'),/192\.0\.2\.9/);
  // Up time belongs to this adjacency, even after its event history is discarded.
  a.runtime.features.ospfEvents=[];sim.events.length=0;sim.advance(5000);
  assert.equal(ospfLiveDetail(sim,a.id,'ospf')!.neighbors.find(n=>n.state==='FULL')!.upSince,full.upSince);
  run(cb,'conf t','interface Ethernet1/1','shutdown','end');sim.advance(45000);
  assert.ok(!ospfLiveDetail(sim,a.id,'ospf')?.neighbors.some(n=>n.state==='FULL'));
  run(cb,'conf t','interface Ethernet1/1','no shutdown','end');sim.advance(45000);
  assert.ok(ospfLiveDetail(sim,a.id,'ospf')!.neighbors.find(n=>n.state==='FULL')!.upSince!>full.upSince!);
});
test('NX RIB and IP brief isolate tenant and management VRFs',()=>{
  const {sim,a,ca}=pair();
  run(ca,'conf t','vrf context RED','exit','interface Loopback10','vrf member RED','ip address 192.0.2.10/32','no shutdown','end');
  assert.match(text(ca,'show ip route vrf RED'),/192\.0\.2\.10\/32/);assert.doesNotMatch(text(ca,'show ip route'),/192\.0\.2\.10/);
  assert.match(text(ca,'show ip interface brief vrf RED'),/Lo10\s+192\.0\.2\.10/);assert.doesNotMatch(text(ca,'show ip interface brief'),/Lo10/);
  const before=JSON.stringify(a.config);
  for(const command of ['show interfaces','show environment','show processes cpu','show processes memory','show memory statistics','show ip nat translations','show access-lists'])assert.ok(ca.execute(command).some(iosRejected),command);
  assert.equal(JSON.stringify(a.config),before);
});
test('NX STP shows real roots and native port names; MAC rows follow learning and aging',()=>{
  const sim=new Simulator(97202),a=sim.addDevice('datacenter'),b=sim.addDevice('datacenter'),ca=new NSOSSession(sim,a.id,{skipConsoleLogin:true}),cb=new NSOSSession(sim,b.id,{skipConsoleLogin:true});
  for(const cli of [ca,cb])run(cli,'conf t','vlan 10','exit','interface Ethernet1/1','switchport mode trunk','switchport trunk allowed vlan 10','no shutdown','interface Ethernet1/2','switchport mode trunk','switchport trunk allowed vlan 10','no shutdown','end');
  run(ca,'conf t','spanning-tree vlan 10 priority 4096','end');
  for(const port of ['Ethernet1/1','Ethernet1/2'])sim.connect({deviceId:a.id,port},{deviceId:b.id,port});sim.advance(45000);
  assert.match(text(ca,'show spanning-tree vlan 10'),/Root ID\s+Priority\s+4106[\s\S]*This bridge is the root[\s\S]*Eth1\/1\s+Desg FWD/);
  assert.match(text(cb,'show spanning-tree vlan 10'),/Eth1\/\d\s+Altn BLK/);assert.doesNotMatch(text(ca,'show spanning-tree'),/Aging Time|00000\.[a-f0-9]{12}/);
  const router=sim.addDevice('router'),rc=new IOSSession(sim,router.id);run(rc,'enable','conf t','interface g0/0','no shutdown','end');run(ca,'conf t','interface Ethernet1/3','switchport access vlan 10','spanning-tree port type edge','no shutdown','end');sim.connect({deviceId:router.id,port:'GigabitEthernet0/0'},{deviceId:a.id,port:'Ethernet1/3'});sim.advance(3000);
  // Inject actual Ethernet traffic rather than pre-populating the forwarding table.
  sim.ping(router.id,'10.0.0.99',{count:1});sim.advance(2000);
  const mac=sim.macOf(router.id,'GigabitEthernet0/0').replaceAll(':','').match(/.{4}/g)!.join('.');
  // ARP requires a configured local network.
  run(rc,'conf t','interface g0/0','ip address 10.0.0.2 255.255.255.0','end');sim.ping(router.id,'10.0.0.99',{count:1});sim.advance(2000);
  assert.ok(text(ca,'show mac address-table').includes(mac));assert.match(text(ca,'show mac address-table'),/dynamic\s+\d+\s+Eth1\/3/);
  sim.advance(301000);assert.ok(!text(ca,'show mac address-table').includes(mac));
  assert.ok(rc.execute('show mac address-table').some(iosRejected));
});
test('NX clock, logging and users expose available state and never invented Linux telemetry',()=>{
  const sim=new Simulator(97203),d=sim.addDevice('datacenter'),cli=new NSOSSession(sim,d.id);
  sim.log(d.id,'operational audit event',5);
  assert.match(text(cli,'show clock'),/Warning: Clock is not synchronized[\s\S]*Time source is unsynchronized/);
  d.config.features.clockEpoch=Date.UTC(2026,9,21);assert.doesNotMatch(text(cli,'show clock'),/Warning/);assert.match(text(cli,'show clock'),/Time source is user configuration/);
  assert.match(text(cli,'show logging'),/Logging logfile:\s+enabled[\s\S]*operational audit event/);
  assert.doesNotMatch(text(cli,'show logging'),/linecard|logflash|rate-limit/);
  assert.match(text(cli,'show users'),/NAME\s+LINE\s+TIME\s+IDLE\s+PID COMMENT[\s\S]*-\s+console\s+-\s+\.\s+- \*/);
});

test('NX show users includes authenticated SSH users and removes closed sessions',()=>{
  const sim=new Simulator(97204),d=sim.addDevice('datacenter'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true}),host=sim.addDevice('pc');
  run(cli,'conf t','username admin password LabAdmin42 role network-admin','interface mgmt0','ip address 192.0.2.1/24','end');
  const hp=host.config.interfaces.GigabitEthernet0;delete hp.features.dhcp;hp.ip='192.0.2.2';hp.mask='255.255.255.0';sim.connect({deviceId:d.id,port:'mgmt0'},{deviceId:host.id,port:'GigabitEthernet0'});sim.advance(1000);
  const client=new IOSSession(sim,host.id);run(client,'ssh admin@192.0.2.1','LabAdmin42');
  const users=text(client,'show users');assert.match(users,/admin\s+vty 0\s+-\s+00:00:00\s+- \*/);assert.doesNotMatch(users,/LabAdmin42/);
  run(client,'exit');assert.doesNotMatch(text(cli,'show users'),/admin\s+vty/);
});

test('NX short/long STP costs change actual tree costs and survive configuration replay',()=>{
  const {sim,a,b,ca,cb}=pair();
  for(const cli of [ca,cb])run(cli,'conf t','interface Ethernet1/2','switchport','no shutdown','end');
  sim.connect({deviceId:a.id,port:'Ethernet1/2'},{deviceId:b.id,port:'Ethernet1/2'});sim.advance(45000);
  assert.equal(a.runtime.stp[1].ports['Ethernet1/2'].cost,2);
  run(ca,'conf t','spanning-tree pathcost method long','end');sim.advance(100);
  assert.equal(a.runtime.stp[1].ports['Ethernet1/2'].cost,2000);
  assert.match(text(ca,'show spanning-tree pathcost method'),/long/);
  const config=text(ca,'show running-config'),copy=sim.addDevice('datacenter'),cc=new NSOSSession(sim,copy.id,{skipConsoleLogin:true});
  copy.config.features.files={snapshot:config};run(cc,'copy bootflash:snapshot running-config');assert.equal(copy.config.features.stp.pathcostMethod,'long');
  run(ca,'conf t','no spanning-tree pathcost method long','end');assert.equal(a.config.features.stp.pathcostMethod,'short');sim.advance(100);assert.equal(a.runtime.stp[1].ports['Ethernet1/2'].cost,2);
});
