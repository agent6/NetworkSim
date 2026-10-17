import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {renderConfig} from '../src/config-renderer.ts';
import type {Device} from '../src/model.ts';

function run(cli:IOSSession,...lines:string[]){for(const line of lines){const output=cli.execute(line);assert.ok(!output.some(s=>/^%|Bad mask/.test(s)),`${line}: ${output.join('\n')}`);}}
function make(s:Simulator,n:number){const d=s.addDevice('router'),cli=new IOSSession(s,d.id);run(cli,'enable','configure terminal','interface g0/0',`ip address 10.0.0.${n} 255.255.255.0`,'no shutdown','exit','interface loopback0',`ip address 192.0.2.${n} 255.255.255.255`,'no shutdown','exit');return{d,cli};}
function link(s:Simulator,a:Device,b:Device){s.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});}

test('OSPF costs, administrative distance and inbound distribute-list affect installed routes without deleting LSAs',()=>{
  const s=new Simulator(401),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'router ospf 1','network 0.0.0.0 255.255.255.255 area 0','auto-cost reference-bandwidth 10000','end');link(s,a.d,b.d);s.advance(12000);
  let route=a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='O');assert.equal(route?.metric,20);
  run(a.cli,'configure terminal','router ospf 1','distance ospf intra-area 123','end');route=a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='O');assert.equal(route?.ad,123);
  run(a.cli,'configure terminal','ip prefix-list BLOCK deny 192.0.2.2/32','ip prefix-list BLOCK permit 0.0.0.0/0 le 32','router ospf 1','distribute-list prefix BLOCK in','end');assert.ok(!a.d.runtime.routes.some(r=>r.network==='192.0.2.2'&&r.protocol==='O'));assert.ok(a.d.runtime.features.ospfPackets.ospf.lsdb.some((r:any)=>r.origin.includes(b.d.id)));
  run(a.cli,'configure terminal','router ospf 1','no distribute-list prefix BLOCK in','distance 255','no distance ospf intra-area','end');assert.ok(!a.d.runtime.routes.some(r=>r.protocol==='O'));
  assert.match(renderConfig(a.d).join('\n'),/auto-cost reference-bandwidth 10000/);
});

test('OSPF redistribution seed and summary install a conditional discard and send one external prefix',()=>{
  const s=new Simulator(402),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'router ospf 1','network 10.0.0.0 0.0.0.255 area 0','exit');
  run(b.cli,'ip route 172.16.1.0 255.255.255.0 Null0','ip route 172.16.2.0 255.255.255.0 Null0','router ospf 1','default-metric 77','redistribute static','summary-address 172.16.0.0 255.255.0.0 tag 44','end');run(a.cli,'end');link(s,a.d,b.d);s.advance(12000);
  const route=a.d.runtime.routes.find(r=>r.network==='172.16.0.0'&&r.prefix===16);assert.equal(route?.metric,77);assert.equal(route?.tag,44);assert.ok(!a.d.runtime.routes.some(r=>r.network==='172.16.1.0'));assert.equal(b.d.runtime.routes.find(r=>r.network==='172.16.0.0')?.interface,'Null0');
  run(b.cli,'configure terminal','no ip route 172.16.1.0 255.255.255.0','no ip route 172.16.2.0 255.255.255.0','end');s.advance(12000);assert.ok(!a.d.runtime.routes.some(r=>r.network==='172.16.0.0'));assert.ok(!b.d.runtime.routes.some(r=>r.network==='172.16.0.0'));
});

test('EIGRP K-values gate actual Hello adjacency and filters, offsets, and distance change routes',()=>{
  const s=new Simulator(403),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'router eigrp 100','network 0.0.0.0 255.255.255.255','end');link(s,a.d,b.d);s.advance(100);
  const metric=a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='D')!.metric;
  run(a.cli,'configure terminal','router eigrp 100','metric weights 0 1 0 2 0 0','end');s.advance(100);assert.ok(!a.d.runtime.routes.some(r=>r.protocol==='D'));
  run(b.cli,'configure terminal','router eigrp 100','metric weights 0 1 0 2 0 0','end');s.advance(100);assert.ok(a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='D')!.metric>metric);
  run(a.cli,'configure terminal','access-list 10 permit 192.0.2.2','router eigrp 100','distance eigrp 95 175','offset-list 10 in 123','end');assert.equal(a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='D')?.ad,95);
  const increased=a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='D')!.metric;
  run(a.cli,'configure terminal','router eigrp 100','no offset-list 10 in 123','end');assert.equal(increased-a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='D')!.metric,123);
  run(b.cli,'configure terminal','ip prefix-list DROP deny 192.0.2.2/32','ip prefix-list DROP permit 0.0.0.0/0 le 32','router eigrp 100','distribute-list prefix DROP out g0/0','end');s.advance(1000);assert.ok(!a.d.runtime.routes.some(r=>r.network==='192.0.2.2'&&r.protocol==='D'));
});

test('RIP default seed and source-specific administrative distance consume configured values',()=>{
  const s=new Simulator(404),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'router rip','version 2','network 10.0.0.0','exit');
  run(b.cli,'ip route 172.16.0.0 255.255.0.0 Null0','router rip','default-metric 7','redistribute static','end');run(a.cli,'router rip','distance 130 10.0.0.2 0.0.0.0','end');link(s,a.d,b.d);s.advance(2500);
  const route=a.d.runtime.routes.find(r=>r.network==='172.16.0.0'&&r.protocol==='R');assert.equal(route?.metric,7);assert.equal(route?.ad,130);assert.match(renderConfig(b.d).join('\n'),/default-metric 7/);
});

test('modern OSPFv3 IPv6 address-family enters its mode and exchanges real routes',()=>{
  const s=new Simulator(405),a=make(s,1),b=make(s,2);for(const[r,n]of[[a,1],[b,2]] as const)run(r.cli,'ipv6 unicast-routing','router ospfv3 5',`router-id 1.1.1.${n}`,'address-family ipv6 unicast','distance 115','exit-address-family','exit','interface g0/0',`ipv6 address 2001:db8:1::${n}/64`,'ospfv3 5 ipv6 area 0','exit','interface loopback0',`ipv6 address 2001:db8:${n+1}::1/64`,'ospfv3 5 ipv6 area 0','end');link(s,a.d,b.d);s.advance(12000);
  assert.equal(a.d.runtime.routes.find(r=>r.network==='2001:db8:3::'&&r.protocol==='O')?.ad,115);assert.match(renderConfig(a.d).join('\n'),/router ospfv3 5\n address-family ipv6 unicast/);
});

test('OSPFv3 IPv4 AF carries IPv4 prefixes over actual IPv6 link-local control packets',()=>{
  const s=new Simulator(406),a=make(s,1),b=make(s,2);
  for(const[r,n]of[[a,1],[b,2]] as const)run(r.cli,'router ospfv3 7',`router-id 7.7.7.${n}`,'address-family ipv4 unicast','distance 116','exit-address-family','exit','interface g0/0','ipv6 enable','ospfv3 7 ipv4 area 0','exit','interface loopback0','ipv6 enable','ospfv3 7 ipv4 area 0','end');
  link(s,a.d,b.d);s.advance(12000);
  const route=a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='O');assert.equal(route?.ad,116);
  assert.ok(s.events.some(e=>e.packet?.protocol==='OSPFV3IPV4'&&e.packet.source.startsWith('fe80:')));
  const ping=s.ping(a.d.id,'192.0.2.2',{count:1});s.advance(1500);assert.equal(ping.received,1);
  assert.match(renderConfig(a.d).join('\n'),/address-family ipv4 unicast/);assert.match(renderConfig(a.d).join('\n'),/ospfv3 7 ipv4 area 0/);
});

test('routing clears reset measured state, require protocol recovery, and retain configuration',()=>{
  const s=new Simulator(407),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'router eigrp 100','network 0.0.0.0 255.255.255.255','end');link(s,a.d,b.d);s.advance(100);
  assert.ok(a.d.runtime.routes.some(r=>r.protocol==='D'));const before=renderConfig(a.d).join('\n');assert.ok(a.d.runtime.features.eigrpTraffic.received.hello>0);
  run(a.cli,'clear ip eigrp traffic');assert.deepEqual(a.d.runtime.features.eigrpTraffic,{});run(a.cli,'clear ip eigrp neighbors');assert.ok(!a.d.runtime.routes.some(r=>r.protocol==='D'));s.advance(5500);assert.ok(a.d.runtime.routes.some(r=>r.protocol==='D'));assert.equal(renderConfig(a.d).join('\n'),before);
  run(a.cli,'clear ip route 192.0.2.2 255.255.255.255');assert.ok(!a.d.runtime.routes.some(r=>r.network==='192.0.2.2'));s.advance(1);assert.ok(a.d.runtime.routes.some(r=>r.network==='192.0.2.2'));
  for(const r of[a,b])run(r.cli,'configure terminal','no router eigrp 100','router ospf 1','network 0.0.0.0 255.255.255.255 area 0','end');s.advance(12000);assert.ok(a.d.runtime.features.ospfTraffic.received.hello>0);run(a.cli,'clear ip ospf traffic');assert.equal(a.d.runtime.features.ospfTraffic,undefined);run(a.cli,'clear ip ospf events');assert.deepEqual(a.d.runtime.features.ospfEvents,[]);
  run(a.cli,'clear ip ospf 1 process');assert.ok(!a.d.runtime.routes.some(r=>r.protocol==='O'));s.advance(12000);assert.ok(a.d.runtime.routes.some(r=>r.protocol==='O'));
});

test('EIGRP stored bandwidth reservation imports without abort and persists explicitly',()=>{
  const s=new Simulator(408),a=make(s,1);run(a.cli,'interface g0/0');assert.match(a.cli.execute('ip bandwidth-percent eigrp 100 25').join('\n'),/configuration stored only/);run(a.cli,'end');
  const text=renderConfig(a.d).join('\n');assert.match(text,/ip bandwidth-percent eigrp 100 25/);
  const b=s.addDevice('router'),cli=new IOSSession(s,b.id);run(cli,'enable');b.config.features.files={'restore.cfg':text};const output=cli.execute('copy flash:restore.cfg running-config');assert.ok(!output.some(x=>x.startsWith('%')),output.join('\n'));assert.equal(b.config.interfaces['GigabitEthernet0/0'].features.eigrp?.bandwidthPercent,25);
});

test('RIP explicit neighbor transmits on a passive port and paced packets deliver successive prefixes',()=>{
  const s=new Simulator(409),a=make(s,1),b=make(s,2);
  run(a.cli,'router rip','network 10.0.0.0','passive-interface g0/0','neighbor 10.0.0.2','output-delay 50','redistribute static','exit');
  for(let n=1;n<=12;n++)run(a.cli,`ip route 172.16.${n}.0 255.255.255.0 Null0`);run(a.cli,'end');run(b.cli,'router rip','network 10.0.0.0','end');link(s,a.d,b.d);s.advance(20);
  const initial=b.d.runtime.routes.filter(r=>r.protocol==='R'&&r.network.startsWith('172.16.')).length;assert.ok(initial>0&&initial<12,`initial batch ${initial}`);s.advance(200);assert.equal(b.d.runtime.routes.filter(r=>r.protocol==='R'&&r.network.startsWith('172.16.')).length,12);assert.ok(s.events.some(e=>e.packet?.destination==='10.0.0.2'&&e.packet.destinationPort===520));
});

test('RIP validates the received source subnet until explicitly disabled',()=>{
  const s=new Simulator(410),a=make(s,1),b=make(s,2);run(b.cli,'interface g0/0','ip address 10.1.0.2 255.255.255.0','exit');for(const r of[a,b])run(r.cli,'router rip','network 10.0.0.0','network 192.0.2.0','end');link(s,a.d,b.d);s.advance(1500);assert.ok(!a.d.runtime.routes.some(r=>r.protocol==='R'&&r.network==='192.0.2.2'));
  run(a.cli,'configure terminal','router rip','no validate-update-source','end');s.advance(30000);assert.ok(a.d.runtime.routes.some(r=>r.protocol==='R'&&r.network==='192.0.2.2'));
});

test('EIGRP configured neighbors use unicast Hellos and default-information filters external defaults',()=>{
  const s=new Simulator(411),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'router eigrp 100','network 0.0.0.0 255.255.255.255','exit');run(a.cli,'router eigrp 100','neighbor 10.0.0.2 g0/0','end');run(b.cli,'ip route 0.0.0.0 0.0.0.0 Null0','router eigrp 100','redistribute static','end');link(s,a.d,b.d);s.advance(1000);
  assert.ok(s.events.some(e=>e.nodeId===a.d.id&&e.packet?.destination==='10.0.0.2'&&e.protocol==='EIGRP'));assert.ok(a.d.runtime.routes.some(r=>r.prefix===0&&r.protocol==='D EX'));
  run(b.cli,'configure terminal','router eigrp 100','no default-information out','end');assert.ok(!a.d.runtime.routes.some(r=>r.prefix===0&&r.protocol==='D EX'));run(b.cli,'configure terminal','router eigrp 100','default-information out','end');s.advance(1000);assert.ok(a.d.runtime.routes.some(r=>r.prefix===0&&r.protocol==='D EX'));
  run(a.cli,'configure terminal','router eigrp 100','no default-information in','eigrp upgrade-cli CAMPUS','end');assert.ok(!a.d.runtime.routes.some(r=>r.prefix===0&&r.protocol==='D EX'));assert.match(renderConfig(a.d).join('\n'),/router eigrp CAMPUS/);
});

test('OSPF configured SPF and LSA throttles defer measured route installation and origination',()=>{
  const s=new Simulator(412),a=make(s,1),b=make(s,2);for(const[r,n]of[[a,1],[b,2]] as const)run(r.cli,'router ospf 1',`router-id 1.1.1.${n}`,'network 0.0.0.0 255.255.255.255 area 0','end');link(s,a.d,b.d);s.advance(12000);
  run(a.cli,'configure terminal','router ospf 1','timers throttle spf 1000 1000 2000','end');
  run(b.cli,'configure terminal','interface loopback1','ip address 203.0.113.1 255.255.255.255','no shutdown','end');s.advance(100);assert.ok(!a.d.runtime.routes.some(r=>r.network==='203.0.113.1'));s.advance(2100);assert.ok(a.d.runtime.routes.some(r=>r.network==='203.0.113.1'));
  run(b.cli,'configure terminal','router ospf 1','timers throttle lsa 1000 1000 2000','end');s.advance(4000);const seq=()=>b.d.runtime.features.ospfPackets.ospf.lsdb.find((l:any)=>l.origin.startsWith(b.d.id)).sequence;const before=seq();run(b.cli,'configure terminal','interface loopback2','ip address 198.51.100.1 255.255.255.255','no shutdown','end');s.advance(500);assert.equal(seq(),before);s.advance(4000);assert.ok(seq()>before);assert.ok(a.d.runtime.routes.some(r=>r.network==='198.51.100.1'));
  assert.match(renderConfig(b.d).join('\n'),/timers throttle lsa 1000 1000 2000/);
});

test('OSPF TTL security verifies delivered hop limits and discard controls preserve external advertisements',()=>{
  const s=new Simulator(413),a=make(s,1),b=make(s,2);for(const[r,n]of[[a,1],[b,2]] as const)run(r.cli,'router ospf 1',`router-id 1.1.1.${n}`,'network 10.0.0.0 0.0.0.255 area 0','exit');
  run(a.cli,'router ospf 1','ttl-security all-interfaces','event-log size 1','end');run(b.cli,'ip route 172.16.1.0 255.255.255.0 Null0','router ospf 1','redistribute static','summary-address 172.16.0.0 255.255.0.0','end');link(s,a.d,b.d);s.advance(12000);assert.ok(!a.d.runtime.routes.some(r=>r.network==='172.16.0.0'));
  run(b.cli,'configure terminal','router ospf 1','ttl-security all-interfaces','end');s.advance(12000);assert.ok(a.d.runtime.routes.some(r=>r.network==='172.16.0.0'));assert.ok(s.events.some(e=>e.packet?.protocol==='OSPF'&&e.packet.ttl===255));assert.equal(a.d.runtime.features.ospfEvents.length,1);
  run(b.cli,'configure terminal','router ospf 1','no discard-route external','end');s.advance(100);assert.ok(!b.d.runtime.routes.some(r=>r.protocol==='O summary'));assert.ok(a.d.runtime.routes.some(r=>r.network==='172.16.0.0'));
  run(a.cli,'clear ip ospf events','configure terminal','router ospf 1','event-log pause','end','clear ip ospf process');s.advance(12000);assert.equal(a.d.runtime.features.ospfEvents.length,0);
});

test('EIGRP summary-metric changes the advertised vector and conditional local discard metric',()=>{
 const s=new Simulator(414),a=make(s,1),b=make(s,2);for(const q of[a,b])run(q.cli,'router eigrp 100','network 0.0.0.0 255.255.255.255','exit');run(b.cli,'interface g0/0','ip summary-address eigrp 100 192.0.2.0 255.255.255.0','exit','router eigrp 100','summary-metric 192.0.2.0/24 100000 10 255 1 1500','end');run(a.cli,'end');link(s,a.d,b.d);s.advance(1000);
 const learned=a.d.runtime.routes.find(r=>r.protocol==='D'&&r.network==='192.0.2.0');assert.equal(learned?.metric,30720);assert.equal(b.d.runtime.routes.find(r=>r.protocol==='D summary'&&r.network==='192.0.2.0')?.metric,28160);assert.match(renderConfig(b.d).join('\n'),/summary-metric 192.0.2.0\/24 100000 10 255 1 1500/);
 run(b.cli,'configure terminal','router eigrp 100','no summary-metric 192.0.2.0/24','end');s.advance(1000);assert.notEqual(a.d.runtime.routes.find(r=>r.protocol==='D'&&r.network==='192.0.2.0')?.metric,30720);
});

test('static BFD binding withdraws the route on control-packet loss and restores after recovery',()=>{
  const s=new Simulator(415),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'interface g0/0','bfd interval 100 min_rx 100 multiplier 3','end');
  run(a.cli,'configure terminal','ip route 203.0.113.0 255.255.255.0 10.0.0.2','ip route static bfd g0/0 10.0.0.2','end');link(s,a.d,b.d);assert.ok(!a.d.runtime.routes.some(r=>r.network==='203.0.113.0'));s.advance(3500);assert.ok(a.d.runtime.routes.some(r=>r.network==='203.0.113.0'));
  run(a.cli,'configure terminal','ip access-list extended DROP-BFD','deny udp any any eq 3784','permit ip any any','exit','interface g0/0','ip access-group DROP-BFD in','end');s.advance(500);assert.ok(!a.d.runtime.routes.some(r=>r.network==='203.0.113.0'));
  run(a.cli,'configure terminal','interface g0/0','no ip access-group DROP-BFD in','end');s.advance(3500);assert.ok(a.d.runtime.routes.some(r=>r.network==='203.0.113.0'));assert.match(renderConfig(a.d).join('\n'),/ip route static bfd GigabitEthernet0\/0 10.0.0.2/);
  run(a.cli,'configure terminal','no ip route static bfd g0/0 10.0.0.2','end');assert.equal(a.d.config.features.staticBfd.length,0);
});

test('EIGRP candidate default network forwards otherwise unknown destinations and respects suppression',()=>{
  const s=new Simulator(416),a=make(s,1),b=make(s,2);run(b.cli,'interface loopback0','ip address 192.0.2.2 255.255.255.0','exit','interface loopback1','ip address 203.0.113.1 255.255.255.255','exit','ip default-network 192.0.2.0');
  for(const r of[a,b])run(r.cli,'router eigrp 100','network 10.0.0.0 0.0.0.255','network 192.0.2.0 0.0.0.255','end');link(s,a.d,b.d);s.advance(500);
  assert.equal(a.d.runtime.routes.find(r=>r.network==='192.0.2.0')?.candidateDefault,true);assert.ok(!a.d.runtime.routes.some(r=>r.prefix===0));
  let probe=s.ping(a.d.id,'203.0.113.1',{count:1});s.advance(1000);assert.equal(probe.received,1);
  run(a.cli,'configure terminal','router eigrp 100','no default-information in','end');s.advance(100);assert.ok(!a.d.runtime.routes.find(r=>r.network==='192.0.2.0')?.candidateDefault);probe=s.ping(a.d.id,'203.0.113.1',{count:1});s.advance(1000);assert.equal(probe.received,0);
  run(a.cli,'configure terminal','router eigrp 100','default-information in','end');run(b.cli,'configure terminal','no ip default-network 192.0.2.0','end');assert.ok(!a.d.runtime.routes.find(r=>r.network==='192.0.2.0')?.candidateDefault);
});

test('RIPng process timers and split-horizon aliases change emitted updates and persist',()=>{
  const s=new Simulator(417),a=make(s,1),b=make(s,2);for(const[r,n]of[[a,1],[b,2]] as const)run(r.cli,'ipv6 unicast-routing','interface g0/0',`ipv6 address 2001:db8:1::${n}/64`,'ipv6 rip V6 enable','exit','interface loopback0',`ipv6 address 2001:db8:${n+1}::1/64`,'ipv6 rip V6 enable','exit','ipv6 router rip V6','timers 2 6 0 4','no split-horizon','poison-reverse','exit','ipv6 prefix-list ALL permit ::/0 le 128','ipv6 router rip V6','distribute-list prefix-list ALL in','end');link(s,a.d,b.d);s.advance(3500);
  assert.ok(a.d.runtime.routes.some(r=>r.protocol==='R'&&r.network==='2001:db8:3::'));assert.equal(a.d.runtime.features.ripngStats.timers.flush,10000);assert.match(renderConfig(a.d).join('\n'),/no split-horizon/);
  run(a.cli,'configure terminal','ipv6 router rip V6','no timers 2 6 0 4','no distribute-list prefix-list ALL in','end');assert.equal(a.d.config.protocols.ripng.timers,undefined);
});

test('nonbroadcast OSPF sends configured unicast Hellos and point-to-multipoint neighbor cost affects SPF',()=>{
  const s=new Simulator(418),a=make(s,1),b=make(s,2);for(const[r,n]of[[a,2],[b,1]] as const)run(r.cli,'interface g0/0','ip ospf network point-to-multipoint non-broadcast','ip ospf hello-interval 1','ip ospf dead-interval 4','exit','router ospf 1',`router-id 1.1.1.${3-n}`,'network 0.0.0.0 255.255.255.255 area 0',`neighbor 10.0.0.${n} poll-interval 1 cost 25`,'end');link(s,a.d,b.d);s.advance(3500);
  assert.equal(a.d.runtime.routes.find(r=>r.network==='192.0.2.2'&&r.protocol==='O')?.metric,26);assert.ok(s.events.some(e=>e.packet?.protocol==='OSPF'&&e.packet.destination==='10.0.0.2'));assert.ok(!s.events.some(e=>e.packet?.protocol==='OSPF'&&e.packet.destination==='224.0.0.5'));
  run(a.cli,'configure terminal','router ospf 1','no neighbor 10.0.0.2','end');s.advance(5000);assert.ok(!b.d.runtime.routes.some(r=>r.network==='192.0.2.1'&&r.protocol==='O'));
});

test('BFD echo traverses peer forwarding and detects echo-only loss despite healthy control packets',()=>{
  const s=new Simulator(419),a=make(s,1),b=make(s,2);for(const r of[a,b])run(r.cli,'interface g0/0','bfd interval 100 min_rx 100 multiplier 3','bfd echo','end');link(s,a.d,b.d);s.advance(3500);
  assert.ok(a.d.runtime.features.bfd[0].lastEchoReceived>0);assert.ok(s.events.some(e=>e.packet?.destinationPort===3785&&e.packet.source===e.packet.destination&&e.nodeId===b.d.id&&e.disposition==='forward'));
  run(b.cli,'configure terminal','ip access-list extended ECHO-BLOCK','deny udp any any eq 3785','permit ip any any','exit','interface g0/0','ip access-group ECHO-BLOCK in','end');s.advance(500);assert.ok(s.events.some(e=>e.label==='Echo detection expired'));assert.ok(s.events.some(e=>e.packet?.destinationPort===3784&&e.disposition==='receive'));
  run(a.cli,'configure terminal','interface g0/0','no bfd echo','end');run(b.cli,'configure terminal','interface g0/0','no bfd echo','end');s.advance(3500);assert.equal(a.d.runtime.features.bfd[0].state,'UP');assert.equal(a.d.runtime.features.bfd[0].echo,false);
});
