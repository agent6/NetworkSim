import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {NSOSSession} from '../src/nsos.ts';
import {iosRejected} from '../src/ios-help.ts';
import {replayScenario} from '../scripts/cml/replay.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {IOS_BOOT_DURATION} from '../src/ios-boot.ts';
import {interfaceRates} from '../src/interface-telemetry.ts';
const out=(cli:{execute(s:string):string[]},line:string)=>cli.execute(line).join('\n');
function run(cli:{execute(s:string):string[]},...lines:string[]){for(const line of lines)assert.ok(!cli.execute(line).some(iosRejected),line);}

test('CML: absent NAT entries and an uninitialized IPv6 stack produce no fabricated table',()=>{
 const sim=new Simulator(97301),d=sim.addDevice('router'),cli=new IOSSession(sim,d.id);run(cli,'enable');
 assert.deepEqual(cli.execute('show ip ospf neighbor'),[]);assert.deepEqual(cli.execute('show ip nat translations'),[]);assert.deepEqual(cli.execute('show ipv6 route'),[]);assert.ok(cli.execute('show ipv6 route gibberish').some(iosRejected));
 run(cli,'conf t','ipv6 unicast-routing','end');assert.match(out(cli,'show ipv6 route'),/IPv6 Routing Table - default - 0 entries/);
 assert.equal(out(cli,'show spanning-tree'),'No spanning tree instances exist.\n');
});

test('CML: a management default gateway forwards local switch traffic without becoming a routed default',()=>{
 const sim=new Simulator(97302),sw=sim.addDevice('l3switch'),router=sim.addDevice('router'),host=sim.addDevice('server'),sc=new IOSSession(sim,sw.id),rc=new IOSSession(sim,router.id);
 run(sc,'enable','conf t','vlan 10','exit','interface g0/1','switchport mode access','switchport access vlan 10','interface Vlan10','ip address 10.0.0.2 255.255.255.0','no shutdown','exit','ip default-gateway 10.0.0.1','end');
 run(rc,'enable','conf t','interface g0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','interface g0/1','ip address 192.0.2.1 255.255.255.0','no shutdown','end');
 host.config.interfaces.GigabitEthernet0.ip='192.0.2.2';host.config.interfaces.GigabitEthernet0.mask='255.255.255.0';delete host.config.interfaces.GigabitEthernet0.features.dhcp;host.config.defaultGateway='192.0.2.1';
 sim.connect({deviceId:sw.id,port:'GigabitEthernet0/1'},{deviceId:router.id,port:'GigabitEthernet0/0'});sim.connect({deviceId:router.id,port:'GigabitEthernet0/1'},{deviceId:host.id,port:'GigabitEthernet0'});sim.advance(45000);
 const ping=sim.ping(sw.id,'192.0.2.2',{count:1});sim.advance(3000);assert.equal(ping.received,1);
 assert.ok(sim.routes(sw.id).some(r=>r.management&&r.nextHop==='10.0.0.1'));
 assert.doesNotMatch(out(sc,'show ip route'),/S\*\s+0\.0\.0\.0|Gateway of last resort is 10\.0\.0\.1/);assert.match(out(sc,'show ip route'),/C\s+10\.0\.0\.0\/24/);
 run(sc,'conf t','ip routing','end');assert.ok(!sim.routes(sw.id).some(r=>r.management));assert.doesNotMatch(out(sc,'show ip route'),/S\*\s+0\.0\.0\.0/);
});

test('CML: SVI autostate follows forwarding members, including root-guard failure and recovery',()=>{
 const sim=new Simulator(97303),a=sim.addDevice('datacenter'),b=sim.addDevice('datacenter'),ca=new NSOSSession(sim,a.id,{skipConsoleLogin:true}),cb=new NSOSSession(sim,b.id,{skipConsoleLogin:true});
 for(const [cli,ip] of [[ca,'10.10.10.1'],[cb,'10.10.10.2']] as const)run(cli,'conf t','feature interface-vlan','vlan 10','exit','interface Vlan10','ip address '+ip+'/24','no shutdown','interface Ethernet1/1','switchport mode trunk','switchport trunk allowed vlan 10','no shutdown','interface Ethernet1/2','switchport mode trunk','switchport trunk allowed vlan 10','no shutdown','end');
 run(ca,'conf t','spanning-tree vlan 10 priority 4096','end');for(const port of ['Ethernet1/1','Ethernet1/2'])sim.connect({deviceId:a.id,port},{deviceId:b.id,port});sim.advance(45000);
 assert.ok(sim.interfaceUp(a.id,'Vlan10'));assert.match(out(ca,'show mac address-table'),/G\s+10\s+.*Vlan10\(R\)/);
 run(ca,'conf t','interface Ethernet1/1','spanning-tree guard root','interface Ethernet1/2','spanning-tree guard root','end');run(cb,'conf t','spanning-tree vlan 10 priority 0','end');sim.advance(15000);
 assert.ok(sim.interfaceUp(a.id,'Ethernet1/1'));assert.ok(!sim.interfaceUp(a.id,'Vlan10'));
 assert.match(out(ca,'show spanning-tree vlan 10'),/BKN\*/);assert.match(out(ca,'show interface Vlan10'),/down \(VLAN\/BD is down\), line protocol is down, autostate enabled/);
 assert.match(out(ca,'show ip interface brief'),/protocol-down\/link-down\/admin-up/);assert.doesNotMatch(out(ca,'show ip route'),/10\.10\.10\.0\/24/);assert.doesNotMatch(out(ca,'show mac address-table'),/Vlan10\(R\)/);
 run(cb,'conf t','spanning-tree vlan 10 priority 32768','end');run(ca,'conf t','interface Ethernet1/1','spanning-tree guard none','interface Ethernet1/2','spanning-tree guard none','end');sim.advance(45000);
 assert.ok(sim.interfaceUp(a.id,'Vlan10'));assert.match(out(ca,'show ip route'),/10\.10\.10\.0\/24/);const ping=sim.ping(b.id,'10.10.10.1',{count:1});sim.advance(3000);assert.equal(ping.received,1);
});

test('SVI autostate cannot activate a VLAN that does not exist',()=>{
 const sim=new Simulator(97304),d=sim.addDevice('datacenter'),peer=sim.addDevice('switch'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
 run(cli,'conf t','feature interface-vlan','interface Vlan99','ip address 10.99.0.1/24','no shutdown','interface Ethernet1/1','switchport mode trunk','no shutdown','end');peer.config.interfaces['GigabitEthernet0/1'].mode='trunk';
 sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:peer.id,port:'GigabitEthernet0/1'});sim.advance(45000);assert.ok(!sim.interfaceUp(d.id,'Vlan99'));
 run(cli,'conf t','vlan 99','end');sim.advance(45000);assert.ok(sim.interfaceUp(d.id,'Vlan99'));
 const legacy=sim.serialize();delete (legacy.lab.devices.find(v=>v.id===d.id)!.config.vlans[99] as any).active;const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(legacy)));restored.advance(45000);assert.ok(restored.interfaceUp(d.id,'Vlan99'),'legacy imported VLANs default to active');
 d.config.vlans[99].active=false;sim.changed();assert.ok(!sim.interfaceUp(d.id,'Vlan99'));
});

test('CML: OSPF reference bandwidth changes remote metrics and survives NS-OS save/replay',()=>{
 const spec=JSON.parse(readFileSync('scripts/cml/scenarios/operations.json','utf8'));
 spec.steps.push(...[
  ['nxos','configure terminal'],['nxos','router ospf LAB'],['nxos','auto-cost reference-bandwidth 10000 Mbps'],['nxos','end'],
  ['ios','show ip route 198.51.100.0 255.255.255.252','metric 11'],
  ['nxos','configure terminal'],['nxos','router ospf LAB'],['nxos','no auto-cost reference-bandwidth'],['nxos','end'],
  ['ios','show ip route 198.51.100.0 255.255.255.252','metric 41'],
 ].map(([node,command,expect],i)=>({id:'ref-'+i,node,command,waitSeconds:expect?10:0,...expect?{expect:[expect]}:{}})));
 const report=replayScenario(spec);assert.equal(report.status,'replayed',JSON.stringify(report.steps.at(-1)));
 const sim=new Simulator(97305),d=sim.addDevice('datacenter'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
 run(cli,'conf t','feature ospf','router ospf LAB','auto-cost reference-bandwidth 10 Gbps','end');assert.match(out(cli,'show ip ospf'),/Reference Bandwidth is 10000 Mbps/);
 const before=JSON.stringify(d.config);run(cli,'conf t','router ospf LAB');assert.match(out(cli,'no auto-cost reference-bandwidth bad Mbps'),/%/);assert.equal(JSON.stringify(d.config),before);run(cli,'end');
 const cfg=out(cli,'show running-config'),other=sim.addDevice('datacenter'),oc=new NSOSSession(sim,other.id,{skipConsoleLogin:true});other.config.features.files={cfg};run(oc,'copy bootflash:cfg running-config');assert.equal(other.config.protocols.ospf.referenceBandwidth,10000);
});

test('logging counts actual sinks independently and console delivery does not require terminal monitor',()=>{
 const sim=new Simulator(97306),d=sim.addDevice('router'),console=new IOSSession(sim,d.id),vty=new IOSSession(sim,d.id,{skipConsoleLogin:true});run(console,'enable');vty.setIdentity('admin',true,'vty 0 4');
 run(console,'conf t','logging buffered warnings','logging monitor errors','logging trap notifications','end');sim.log(d.id,'warning',4);sim.log(d.id,'debug',7);
 assert.deepEqual(d.runtime.features.logSinkCounts,{console:2,monitor:0,buffer:1,trap:1});assert.equal(console.pollOutput().length,2);assert.deepEqual(vty.pollOutput(),[]);
 run(vty,'terminal monitor');sim.log(d.id,'error',3);sim.log(d.id,'second debug',7);assert.match(vty.pollOutput().join('\n'),/error/);assert.equal(d.runtime.features.logSinkCounts.monitor,1);
 assert.match(out(console,'show logging'),/Monitor logging: level errors, 1 messages logged/);
 run(console,'conf t','no logging console','end');sim.log(d.id,'suppressed on console',3);assert.deepEqual(console.pollOutput(),[]);
});

test('NS-OS uses native log timestamps, severity defaults and a working terminal monitor',()=>{
 const sim=new Simulator(97307),d=sim.addDevice('datacenter'),local=new NSOSSession(sim,d.id),vty=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
 sim.log(d.id,'filtered console notice',5);assert.deepEqual(local.pollOutput(),[]);assert.deepEqual(vty.pollOutput(),[]);
 run(vty,'terminal monitor');sim.log(d.id,'monitored notice',5);assert.match(vty.pollOutput().join('\n'),/^2026 Jan 01 00:00:00 DC1 %SYS-5-USERLOG: monitored notice$/);assert.equal(d.runtime.features.logSinkCounts.monitor,1);
 sim.log(d.id,'critical console event',2);assert.match(local.pollOutput().join('\n'),/critical console event/);assert.doesNotMatch(local.pollOutput().join('\n'),/critical console event/);
 assert.match(out(vty,'show logging'),/Logging console:\s+enabled \(Severity: critical\)/);assert.match(out(vty,'show logging'),/Logging monitor:\s+enabled \(Severity: notifications\)/);
 run(vty,'terminal no monitor');sim.log(d.id,'no monitor copy',5);assert.deepEqual(vty.pollOutput(),[]);
});

test('native interface shows real short/long window rates and packet counters without fabricated ASIC fields',()=>{
 const sim=new Simulator(97308),d=sim.addDevice('datacenter'),peer=sim.addDevice('router'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true}),rc=new IOSSession(sim,peer.id);
 run(cli,'conf t','interface Ethernet1/1','no switchport','ip address 192.0.2.1/24','no shutdown','end');run(rc,'enable','conf t','no cdp run','interface g0/0','ip address 192.0.2.2 255.255.255.0','no shutdown','end');
 sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:peer.id,port:'GigabitEthernet0/0'});sim.advance(2000);const ping=sim.ping(peer.id,'192.0.2.1',{count:3});sim.advance(3000);assert.equal(ping.received,3);
 const rates=interfaceRates(d,'Ethernet1/1',sim.clock.now(),30),before=JSON.stringify(d.runtime.counters),at=sim.clock.now(),show=out(cli,'show interface Ethernet1/1');
 assert.match(show,/admin state is up, Dedicated Interface/);assert.match(show,new RegExp('30 seconds input rate '+rates.inputBits+' bits/sec'));assert.ok(show.includes(d.runtime.counters['Ethernet1/1'].rx+' input packets'));
 assert.doesNotMatch(show,/interface resets|Beacon|FEC mode|0 watchdog/);assert.equal(JSON.stringify(d.runtime.counters),before);assert.equal(sim.clock.now(),at);
});

test('CML: NS-OS outbound IPv4 ACL enforces transit packets, empty/deleted permit and counters report actual matches',()=>{
 const sim=new Simulator(97309),r=sim.addDevice('datacenter'),a=sim.addDevice('router'),b=sim.addDevice('router'),cli=new NSOSSession(sim,r.id,{skipConsoleLogin:true}),ac=new IOSSession(sim,a.id),bc=new IOSSession(sim,b.id);
 run(cli,'conf t','interface Ethernet1/1','no switchport','ip address 10.10.10.1/24','no shutdown','interface Ethernet1/3','no switchport','ip address 192.0.2.1/24','no shutdown','end');
 for(const [c,ip,gw]of [[ac,'10.10.10.10','10.10.10.1'],[bc,'192.0.2.9','192.0.2.1']]as const)run(c,'enable','conf t','interface g0/0','ip address '+ip+' 255.255.255.0','no shutdown','exit','ip route 0.0.0.0 0.0.0.0 '+gw,'end');
 sim.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:r.id,port:'Ethernet1/1'});sim.connect({deviceId:b.id,port:'GigabitEthernet0/0'},{deviceId:r.id,port:'Ethernet1/3'});sim.advance(3000);
 const ping=()=>{const result=sim.ping(a.id,'192.0.2.9',{count:3});sim.advance(10000);return result.received;};assert.equal(ping(),3);
 assert.deepEqual(cli.execute('show access-lists'),[]);
 run(cli,'conf t','ip access-list AUDIT','exit','interface Ethernet1/3','ip access-group AUDIT out','end');assert.equal(ping(),3);
 run(cli,'conf t','ip access-list AUDIT','statistics per-entry','10 deny icmp 10.10.10.0/24 host 192.0.2.9','20 permit ip any any','end');assert.equal(ping(),0);
 assert.match(out(cli,'show ip access-lists AUDIT'),/10 deny icmp 10\.10\.10\.0\/24 192\.0\.2\.9\/32 \[match=3\]/);
 run(cli,'copy running-config startup-config','reload','yes');sim.advance(IOS_BOOT_DURATION+1000);assert.equal(ping(),0);assert.match(out(cli,'show ip access-lists AUDIT'),/\[match=3\]/,'reloaded ACL is enforced with fresh runtime counters');
 const saved=out(cli,'show running-config');assert.match(saved,/ip access-list AUDIT[\s\S]*ip access-group AUDIT out/);
 const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));restored.advance(2000);const restoredPing=restored.ping(a.id,'192.0.2.9',{count:3});restored.advance(10000);assert.equal(restoredPing.received,0);assert.equal(restored.getDevice(r.id)!.runtime.features.aclHits['AUDIT:10'],3,'saved lab enforces the ACL with fresh counters');
 const clone=sim.addDevice('datacenter'),cc=new NSOSSession(sim,clone.id,{skipConsoleLogin:true});clone.config.features.files={saved};run(cc,'copy bootflash:saved running-config');assert.deepEqual(clone.config.features.acls,r.config.features.acls);assert.equal(clone.config.interfaces['Ethernet1/3'].features.aclOut,'AUDIT');
 assert.equal(sim.aclPermits(clone.id,'AUDIT','10.10.10.10','192.0.2.9','icmp'),false);assert.equal(sim.aclPermits(clone.id,'AUDIT','10.10.10.10','192.0.2.8','icmp'),true);
 run(cli,'conf t','ip access-list AUDIT');const before=JSON.stringify(r.config);assert.match(out(cli,'10 permit ip any any'),/Sequence number already exists/);assert.equal(JSON.stringify(r.config),before);
 run(cli,'no 10','10 permit ip any any','end');assert.equal(ping(),3);assert.doesNotMatch(out(cli,'show ip access-lists AUDIT'),/10 .*\[match=6\]/);
 run(cli,'conf t','no ip access-list AUDIT','end');assert.equal(r.config.interfaces['Ethernet1/3'].features.aclOut,'AUDIT');assert.equal(ping(),3);assert.deepEqual(cli.execute('show access-lists'),[]);
 run(cli,'conf t','interface Ethernet1/3','no ip access-group AUDIT out','end');assert.equal(r.config.interfaces['Ethernet1/3'].features.aclOut,undefined);
 run(cli,'conf t','ip access-list COUNT','10 permit icmp any any','exit','interface Ethernet1/3','ip access-group COUNT out','end');assert.equal(ping(),3);assert.equal(r.runtime.features.aclHits['COUNT:10'],undefined);
 run(cli,'conf t','ip access-list COUNT','statistics per-entry','end');assert.equal(ping(),3);assert.equal(r.runtime.features.aclHits['COUNT:10'],3);run(cli,'conf t','ip access-list COUNT','no statistics per-entry','end');assert.equal(ping(),3);assert.equal(r.runtime.features.aclHits['COUNT:10'],3,'disabled statistics stop collecting actual matches');
});

test('NS-OS ACL rejects unimplemented paths and malformed rules atomically; operators cannot change it',()=>{
 const sim=new Simulator(97310),d=sim.addDevice('datacenter'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
 run(cli,'conf t','ip access-list AUDIT');
 for(const command of ['10 permit tcp any any eq 22','10 permit icmp host nope any','10 permit icmp 10.0.0.0/33 any','10 permit ip any any log','4294967296 permit ip any any','10 permit ipv6 any any']){
  const before=JSON.stringify(d.config);assert.match(out(cli,command),/%/);assert.equal(JSON.stringify(d.config),before,command);
 }
 run(cli,'exit','interface Ethernet1/1');const before=JSON.stringify(d.config);assert.match(out(cli,'ip access-group AUDIT out'),/%/);assert.equal(JSON.stringify(d.config),before);
 run(cli,'no switchport');for(const command of ['ip access-group AUDIT in','ip access-group AUDIT sideways']){const before=JSON.stringify(d.config);assert.match(out(cli,command),/%/);assert.equal(JSON.stringify(d.config),before);}
 run(cli,'ip access-group AUDIT out');for(const command of ['switchport','channel-group 1 mode on']){const before=JSON.stringify(d.config);assert.match(out(cli,command),/%/);assert.equal(JSON.stringify(d.config),before);}
 run(cli,'end');const op=new NSOSSession(sim,d.id,{skipConsoleLogin:true});op.setIdentity('operator',true,'vty 0 15');run(op,'conf t');const snapshot=JSON.stringify(d.config);assert.match(out(op,'ip access-list OTHER'),/Permission denied/);assert.equal(JSON.stringify(d.config),snapshot);
});
