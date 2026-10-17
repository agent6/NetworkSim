import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import type { Device } from '../src/model.ts';
const g=(n:number)=>'GigabitEthernet0/'+n;
function run(cli:IOSSession,...lines:string[]){for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(value=>value.startsWith('%')),line+': '+out.join('\n'));}}
function pair(transport:4|6){
 const sim=new Simulator(1950+transport),a=sim.addDevice('router'),b=sim.addDevice('router'),ca=new IOSSession(sim,a.id),cb=new IOSSession(sim,b.id);
 for(const[cli,n,asn]of[[ca,1,65001],[cb,2,65002]] as const){const peer=transport===6?`2001:db8:1::${3-n}`:`10.0.0.${3-n}`;
  run(cli,'enable','configure terminal','ipv6 unicast-routing','interface '+g(0),`ip address 10.0.0.${n} 255.255.255.0`,`ipv6 address 2001:db8:1::${n}/64`,'no shutdown','interface Loopback0',`ip address 192.0.2.${n} 255.255.255.255`,`ipv6 address 2001:db8:${n}::1/128`,'router bgp '+asn,`bgp router-id ${n}.${n}.${n}.${n}`,`neighbor ${peer} remote-as ${asn===65001?65002:65001}`,`neighbor ${peer} timers connect 1`,`network 192.0.2.${n} mask 255.255.255.255`,'address-family ipv6 unicast',`neighbor ${peer} activate`,`network 2001:db8:${n}::1/128`,'end');
 }
 sim.connect({deviceId:a.id,port:g(0)},{deviceId:b.id,port:g(0)});sim.advance(4000);return{sim,a,b,ca,cb,peer:transport===6?'2001:db8:1::2':'10.0.0.2'};
}
const learned=(d:Device,network:string)=>d.runtime.routes.filter(route=>route.protocol==='B'&&route.network===network);
function echo(sim:Simulator,a:Device,b:Device,target:string,source:string){sim.registerUDPService(9000,d=>d.id===b.id,(_d,p)=>p);const q=sim.udpRequest(a.id,target,9000,{target},{source,timeout:1000});sim.advance(1500);return q;}

test('native IPv6 BGP negotiates IPv6 AF and carries actual IPv6 TCP UPDATEs, next-hop ND and routed UDP',()=>{
 const{sim,a,b,ca}=pair(6);const session=a.runtime.features.bgpSessions.find((r:any)=>r.family===6);assert.equal(session.state,'ESTABLISHED');assert.deepEqual(session.negotiatedFamilies,[6]);assert.equal(a.runtime.features.bgpSessions.some((r:any)=>r.family===4),false);
 assert.equal(learned(a,'2001:db8:2::1').length,1);assert.equal(learned(a,'192.0.2.2').length,0,'IPv4 NLRI is not automatically enabled for a new IPv6 transport neighbor');
 assert.equal(echo(sim,a,b,'2001:db8:2::1','2001:db8:1::1').status,'success');
 assert.ok(sim.events.some(event=>event.packet?.protocol==='TCP'&&event.packet.ipVersion===6&&event.packet.messageType==='tcp-channel-data'));
 assert.ok(Object.values(a.runtime.arp).some(row=>row.ip==='2001:db8:1::2'));
 assert.match(ca.execute('show bgp ipv6 unicast summary').join('\n'),/2001:db8:1::2.*1$/m);
 assert.match(ca.execute('show bgp ipv6 unicast 2001:db8:2::1/128').join('\n'),/BGP routing table entry for 2001:db8:2::1\/128/);
 assert.doesNotMatch(ca.execute('show ip bgp').join('\n'),/2001:db8:2::1/);
 run(ca,'configure terminal','router bgp 65001');assert.match(ca.help('neighbor ').join('\n'),/X:X:X:X::X/);run(ca,'end','write memory');sim.reload(a.id);sim.advance(65000);assert.equal(learned(a,'2001:db8:2::1').length,1);assert.equal(echo(sim,a,b,'2001:db8:2::1','2001:db8:1::1').status,'success');run(ca,'clear bgp ipv6 unicast '+ '2001:db8:1::2');sim.advance(4000);assert.equal(learned(a,'2001:db8:2::1').length,1);
});

test('IPv4 and IPv6 NLRI share one TCP transport but keep policies, activation, withdrawals and rendering independent',()=>{
 const{sim,a,b,ca,cb,peer}=pair(4);const rows=a.runtime.features.bgpSessions;assert.equal(new Set(rows.map((r:any)=>r.channelId)).size,1);assert.deepEqual(rows[0].negotiatedFamilies,[4,6]);
 assert.equal(learned(a,'192.0.2.2').length,1);assert.equal(learned(a,'2001:db8:2::1').length,1);const channel=rows[0].channelId;
 run(ca,'configure terminal','ipv6 prefix-list V6-BLOCK deny 2001:db8:2::1/128','router bgp 65001','address-family ipv6 unicast',`neighbor ${peer} prefix-list V6-BLOCK in`,'end');
 assert.equal(learned(a,'2001:db8:2::1').length,0);assert.equal(learned(a,'192.0.2.2').length,1);assert.equal(a.runtime.features.bgpSessions[0].channelId,channel);
 run(ca,'configure terminal','router bgp 65001','address-family ipv6 unicast',`no neighbor ${peer} prefix-list V6-BLOCK in`,'end');assert.equal(learned(a,'2001:db8:2::1').length,1);
 assert.equal(echo(sim,a,b,'2001:db8:2::1','2001:db8:1::1').status,'success');
 run(cb,'configure terminal','router bgp 65002','address-family ipv6 unicast','no network 2001:db8:2::1/128','end');sim.advance(100);assert.equal(learned(a,'2001:db8:2::1').length,0);assert.equal(learned(a,'192.0.2.2').length,1);
 run(cb,'configure terminal','router bgp 65002','address-family ipv6 unicast','network 2001:db8:2::1/128','end');sim.advance(100);assert.equal(learned(a,'2001:db8:2::1').length,1);
 const copy=sim.addDevice('router'),cc=new IOSSession(sim,copy.id);copy.config.features.files={snapshot:renderConfig(a).join('\n')};run(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(JSON.parse(JSON.stringify(copy.config.protocols.bgp)),JSON.parse(JSON.stringify(a.config.protocols.bgp)),'BGP address-family configuration replays without losing activation or networks');
 run(ca,'configure terminal','router bgp 65001','address-family ipv6 unicast',`no neighbor ${peer} activate`,'end');sim.advance(4000);assert.equal(learned(a,'2001:db8:2::1').length,0);assert.equal(learned(a,'192.0.2.2').length,1);
});

test('BGP maximum-paths installs equal eligible next hops and CEF sends real bidirectional flows over both',()=>{
 const sim=new Simulator(1960),a=sim.addDevice('router'),b=sim.addDevice('router'),c=sim.addDevice('router'),ca=new IOSSession(sim,a.id);
 run(ca,'enable','configure terminal','interface Loopback0','ip address 198.51.100.1 255.255.255.255','router bgp 65000','bgp router-id 1.1.1.1','network 198.51.100.1 mask 255.255.255.255','maximum-paths 2','end');
 for(const[d,n]of[[b,0],[c,1]] as const){const cli=new IOSSession(sim,d.id);run(ca,'configure terminal','interface '+g(n),`ip address 10.${n}.0.1 255.255.255.0`,'no shutdown','router bgp 65000',`neighbor 10.${n}.0.2 remote-as 65100`,'end');run(cli,'enable','configure terminal','interface '+g(0),`ip address 10.${n}.0.2 255.255.255.0`,'no shutdown','interface Loopback0','ip address 203.0.113.1 255.255.255.255','router bgp 65100',`bgp router-id ${n+2}.${n+2}.${n+2}.${n+2}`,`neighbor 10.${n}.0.1 remote-as 65000`,'network 203.0.113.1 mask 255.255.255.255','end');sim.connect({deviceId:a.id,port:g(n)},{deviceId:d.id,port:g(0)});}
 a.config.features.cefHash={algorithm:'include-ports',sourcePort:true,destinationPort:true,seed:17};sim.changed();sim.advance(2000);assert.equal(learned(a,'203.0.113.1').length,2);
 const received=new Map<string,number>();sim.registerUDPService(9000,d=>d===b||d===c,(d,p)=>{received.set(d.id,(received.get(d.id)??0)+1);return p;});
 for(let n=0;n<60;n++){const request=sim.udpRequest(a.id,'203.0.113.1',9000,{n},{source:'198.51.100.1',sourcePort:20000+n});sim.advance(20);assert.equal(request.status,'success');}
 assert.ok((received.get(b.id)??0)>10);assert.ok((received.get(c.id)??0)>10);assert.match(ca.execute('show ip bgp 203.0.113.1').join('\n'),/multipath/);
 a.config.interfaces[g(0)].adminUp=false;sim.changed();assert.equal(learned(a,'203.0.113.1').length,1);assert.equal(echo(sim,a,c,'203.0.113.1','198.51.100.1').status,'success');
});

test('IPv6 BGP VRF-Lite scopes overlapping neighbors, policy, NLRI, traffic and saved configuration',()=>{
 const sim=new Simulator(1961),a=sim.addDevice('router'),b=sim.addDevice('router'),c=sim.addDevice('router'),ca=new IOSSession(sim,a.id);
 run(ca,'enable','configure terminal','vrf definition BLUE','address-family ipv6','exit-address-family','exit','vrf definition RED','address-family ipv6','end','configure terminal','ipv6 unicast-routing','router bgp 65000','bgp router-id 1.1.1.1','end');
 for(const[d,index,vrf,asn]of[[b,0,'BLUE',65001],[c,1,'RED',65002]] as const){const cli=new IOSSession(sim,d.id);
  run(ca,'configure terminal','interface '+g(index),'vrf forwarding '+vrf,'ipv6 address 2001:db8:1::1/64','no shutdown','interface Loopback'+index,'vrf forwarding '+vrf,'ipv6 address 2001:db8:a::1/128','router bgp 65000','address-family ipv6 unicast vrf '+vrf,`neighbor 2001:db8:1::2 remote-as ${asn}`,'neighbor 2001:db8:1::2 timers connect 1','neighbor 2001:db8:1::2 activate','network 2001:db8:a::1/128','end');
  run(cli,'enable','configure terminal','ipv6 unicast-routing','interface '+g(0),'ipv6 address 2001:db8:1::2/64','no shutdown','interface Loopback0','ipv6 address 2001:db8:b::1/128','router bgp '+asn,`bgp router-id ${index+2}.${index+2}.${index+2}.${index+2}`,'neighbor 2001:db8:1::1 remote-as 65000','neighbor 2001:db8:1::1 timers connect 1','address-family ipv6 unicast','neighbor 2001:db8:1::1 activate','network 2001:db8:b::1/128','end');
  sim.connect({deviceId:a.id,port:g(index)},{deviceId:d.id,port:g(0)});
 }
 sim.advance(4000);const paths=learned(a,'2001:db8:b::1');assert.deepEqual(paths.map(route=>route.vrf).sort(),['BLUE','RED']);assert.equal(a.runtime.routes.some(route=>route.protocol==='B'&&!route.vrf),false);
 sim.registerUDPService(9000,d=>d===b||d===c,(d,p)=>({...p,receiver:d.id}));for(const[vrf,receiver]of[['BLUE',b],['RED',c]] as const){const q=sim.udpRequest(a.id,'2001:db8:b::1',9000,{vrf},{vrf,source:'2001:db8:a::1'});sim.advance(100);assert.equal(q.status,'success');assert.equal(q.receiver,receiver.id);}
 run(ca,'configure terminal','ipv6 prefix-list DENY deny 2001:db8:b::1/128','router bgp 65000','address-family ipv6 unicast vrf BLUE','neighbor 2001:db8:1::2 prefix-list DENY in','end');assert.deepEqual(learned(a,'2001:db8:b::1').map(route=>route.vrf),['RED']);
 assert.match(ca.execute('show bgp ipv6 unicast vrf RED summary').join('\n'),/2001:db8:1::2/);assert.doesNotMatch(ca.execute('show bgp ipv6 unicast').join('\n'),/2001:db8:b::1/);
 const copy=sim.addDevice('router'),cc=new IOSSession(sim,copy.id);copy.config.features.files={snapshot:renderConfig(a).join('\n')};run(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(JSON.parse(JSON.stringify(copy.config.protocols.bgp)),JSON.parse(JSON.stringify(a.config.protocols.bgp)));
});

test('BGP prefers the smaller real IGP next-hop metric before router ID and excludes unequal IGP paths from multipath',()=>{
 const sim=new Simulator(1962),a=sim.addDevice('router'),b=sim.addDevice('router'),c=sim.addDevice('router'),ca=new IOSSession(sim,a.id);
 run(ca,'enable','configure terminal','interface Loopback0','ip address 198.51.100.1 255.255.255.255','router ospf 1','router-id 1.1.1.1','network 0.0.0.0 255.255.255.255 area 0','router bgp 65000','bgp router-id 1.1.1.1','network 198.51.100.1 mask 255.255.255.255','maximum-paths 2','end');
 for(const[d,index,cost]of[[b,0,100],[c,1,10]] as const){const cli=new IOSSession(sim,d.id),loop=`198.18.0.${index+2}`;
  run(ca,'configure terminal','interface '+g(index),`ip address 10.${index}.0.1 255.255.255.0`,'ip ospf cost '+cost,'no shutdown','router bgp 65000',`neighbor 10.${index}.0.2 remote-as 65100`,'end');
  run(cli,'enable','configure terminal','interface '+g(0),`ip address 10.${index}.0.2 255.255.255.0`,'no shutdown','interface Loopback0',`ip address ${loop} 255.255.255.255`,'interface Loopback1','ip address 203.0.113.1 255.255.255.255','router ospf 1',`router-id ${index+2}.${index+2}.${index+2}.${index+2}`,'network 0.0.0.0 255.255.255.255 area 0','route-map NEXT permit 10','set ip next-hop '+loop,'router bgp 65100',`bgp router-id ${index+2}.${index+2}.${index+2}.${index+2}`,`neighbor 10.${index}.0.1 remote-as 65000`,`neighbor 10.${index}.0.1 route-map NEXT out`,'network 203.0.113.1 mask 255.255.255.255','end');
  sim.connect({deviceId:a.id,port:g(index)},{deviceId:d.id,port:g(0)});
 }
 sim.advance(5000);const route=learned(a,'203.0.113.1');assert.equal(route.length,1);assert.equal(route[0].nextHop,'198.18.0.3');assert.equal(echo(sim,a,c,'203.0.113.1','198.51.100.1').status,'success');
});

test('same-name IPv4 and IPv6 prefix-list sequence spaces remain separate through BGP policy, removal and replay',()=>{
 const{sim,a,ca,peer}=pair(4);
 run(ca,'configure terminal','ip prefix-list SHARED seq 5 permit 192.0.2.2/32','ipv6 prefix-list SHARED seq 5 deny 2001:db8:2::1/128','router bgp 65001',`neighbor ${peer} prefix-list SHARED in`,'address-family ipv6 unicast',`neighbor ${peer} prefix-list SHARED in`,'end');
 assert.equal(learned(a,'192.0.2.2').length,1);assert.equal(learned(a,'2001:db8:2::1').length,0);
 assert.equal(a.config.features.prefixLists.SHARED.length,2);assert.doesNotMatch(ca.execute('show ip prefix-list SHARED').join('\n'),/2001:db8/);assert.doesNotMatch(ca.execute('show ipv6 prefix-list SHARED').join('\n'),/192\.0\.2/);
 run(ca,'configure terminal','no ip prefix-list SHARED seq 5','end');assert.equal(a.config.features.prefixLists.SHARED.length,1);assert.equal(learned(a,'192.0.2.2').length,0);assert.equal(learned(a,'2001:db8:2::1').length,0);
 run(ca,'configure terminal','ip prefix-list SHARED seq 5 permit 192.0.2.2/32','ipv6 prefix-list SHARED seq 5 permit 2001:db8:2::1/128','end');assert.equal(learned(a,'192.0.2.2').length,1);assert.equal(learned(a,'2001:db8:2::1').length,1);
 const copy=sim.addDevice('router'),cc=new IOSSession(sim,copy.id);copy.config.features.files={snapshot:renderConfig(a).join('\n')};run(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(copy.config.features.prefixLists,a.config.features.prefixLists);
});

test('native IPv6 BGP fall-over follows the real link-local BFD session before the BGP hold timer',()=>{
 const{sim,a,b,ca,cb}=pair(6);
 for(const[cli,peer]of[[ca,'2001:db8:1::2'],[cb,'2001:db8:1::1']] as const)run(cli,'configure terminal','interface '+g(0),'bfd interval 50 min_rx 50 multiplier 3','no bfd echo','router bgp '+(cli===ca?65001:65002),`neighbor ${peer} fall-over bfd`,'end');
 sim.advance(4000);assert.ok(a.runtime.features.bfd.some((row:any)=>row.state==='UP'&&row.peer.startsWith('fe80:')));assert.equal(learned(a,'2001:db8:2::1').length,1);
 const send=sim.sendControlDatagram.bind(sim);let drop=true;sim.sendControlDatagram=(...args)=>{if(drop&&args[4]?.protocol==='bfd')return;send(...args);};sim.advance(300);
 assert.equal(learned(a,'2001:db8:2::1').length,0);const direct=sim.ping(a.id,'2001:db8:1::2',{count:1});sim.advance(500);assert.equal(direct.received,1);
 drop=false;sim.advance(4000);assert.equal(learned(a,'2001:db8:2::1').length,1);assert.equal(echo(sim,a,b,'2001:db8:2::1','2001:db8:1::1').status,'success');
});
