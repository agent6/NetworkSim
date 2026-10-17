import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {applyRouteMap} from '../src/control-plane.ts';
import {renderConfig} from '../src/config-renderer.ts';
import type {Device} from '../src/model.ts';
function cmd(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(x=>x.startsWith('%')),line+': '+out.join('\n'));}}
function pair(){const s=new Simulator(1750),a=s.addDevice('router'),b=s.addDevice('router'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id);for(const[d,c,n]of[[a,ca,1],[b,cb,2]]as const)cmd(c,'enable','conf t','interface g0/0',`ip address 10.0.0.${n} 255.255.255.0`,'no shutdown','interface loopback0',`ip address 192.0.2.${n} 255.255.255.255`,'end');s.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});return{s,a,b,ca,cb};}
const bgp=(d:Device)=>d.runtime.features.bgpTable?.find((r:any)=>r.network==='192.0.2.2');

test('BGP continue jumps over a deny, accumulates set actions and applies the final scalar value',()=>{
 const{s,a,ca,cb}=pair();cmd(ca,'conf t','route-map IMPORT permit 10','set local-preference 150','set community 65000:1','continue 30','route-map IMPORT deny 20','route-map IMPORT permit 30','set local-preference 250','set community 65000:2 additive','continue','route-map IMPORT permit 40','set metric 42','router bgp 10','neighbor 10.0.0.2 remote-as 20','neighbor 10.0.0.2 route-map IMPORT in','end');cmd(cb,'conf t','router bgp 20','neighbor 10.0.0.1 remote-as 10','network 192.0.2.2 mask 255.255.255.255','end');s.advance(2500);assert.equal(bgp(a)?.localPreference,250);assert.equal(bgp(a)?.med,42);assert.deepEqual(bgp(a)?.communities,['65000:1','65000:2']);const channel=a.runtime.features.bgpSessions[0].channelId;
 cmd(ca,'conf t','route-map IMPORT permit 10','continue','end');assert.equal(bgp(a),undefined,'Delivered original advertisement reevaluates into deny 20');assert.equal(a.runtime.features.bgpSessions[0].channelId,channel);cmd(ca,'conf t','route-map IMPORT permit 10','no continue','end');assert.equal(bgp(a)?.localPreference,150);assert.deepEqual(bgp(a)?.communities,['65000:1']);
 cmd(ca,'conf t','route-map IMPORT permit 10');assert.match(ca.execute('continue 10').join('\n'),/greater than/);assert.equal(a.config.features.routeMaps['IMPORT permit 10'].continue,undefined);
});

test('continuation matches original route attributes and is ignored outside BGP contexts',()=>{
 const{s,a,ca}=pair();cmd(ca,'conf t','route-map M permit 10','match tag 1','set tag 2','continue','route-map M deny 20','match tag 2','route-map M permit 30','set local-preference 300','continue 99','end');const original={network:'198.51.100.0',prefix:24,interface:'GigabitEthernet0/0',protocol:'static',ad:1,metric:0,tag:1};const result=applyRouteMap(a,'M',original,true);assert.equal(result?.tag,2);assert.equal(result?.localPreference,300);assert.equal(original.tag,1);assert.equal(applyRouteMap(a,'M',original)?.localPreference,undefined,'Redistribution/distribute contexts stop on first permit');assert.match(ca.execute('show route-map M').join('\n'),/Continue: next entry/);
 const text=renderConfig(a).join('\n'),copy=s.addDevice('router'),cc=new IOSSession(s,copy.id);copy.config.features.files={snapshot:text};cmd(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(copy.config.features.routeMaps,a.config.features.routeMaps);
});

test('BGP outbound continuation produces a delivered modified UPDATE',()=>{
 const{s,a,ca,cb}=pair();cmd(ca,'conf t','router bgp 10','neighbor 10.0.0.2 remote-as 20','end');cmd(cb,'conf t','route-map EXPORT permit 10','set as-path prepend 30','continue','route-map EXPORT permit 20','set as-path prepend 40','set metric 77','router bgp 20','neighbor 10.0.0.1 remote-as 10','neighbor 10.0.0.1 route-map EXPORT out','network 192.0.2.2 mask 255.255.255.255','end');s.advance(2500);assert.deepEqual(bgp(a)?.asPath,[20,40,30]);assert.equal(bgp(a)?.med,77);
});

test('OSPF key-chain algorithm mismatch prevents packet adjacency and matching algorithm restores reachability',()=>{
 const{s,a,b,ca,cb}=pair();for(const[c,id,algorithm]of[[ca,'1.1.1.1','hmac-sha-256'],[cb,'2.2.2.2','hmac-sha-512']]as const)cmd(c,'conf t','key chain ROUTING','key 7','key-string shared-lab','cryptographic-algorithm '+algorithm,'exit','exit','interface g0/0','ip ospf authentication key-chain ROUTING','ip ospf hello-interval 1','ip ospf dead-interval 3','router ospf 1','router-id '+id,'network 0.0.0.0 255.255.255.255 area 0','end');s.advance(4500);assert.ok(!a.runtime.routes.some(r=>r.network==='192.0.2.2'));assert.ok(!a.runtime.features.ospfPackets?.ospf?.neighbors?.some((n:any)=>n.state==='FULL'));cmd(cb,'conf t','key chain ROUTING','key 7','cryptographic-algorithm hmac-sha-256','end');s.advance(4500);const ping=s.ping(a.id,'192.0.2.2',{count:1});s.advance(1000);assert.equal(ping.received,1);assert.match(ca.execute('show key chain ROUTING').join('\n'),/hmac-sha-256/);
 cmd(cb,'conf t','key chain ROUTING','key 7','cryptographic-algorithm md5','end');s.advance(4500);assert.ok(!a.runtime.routes.some(r=>r.network==='192.0.2.2'));
 const copy=s.addDevice('router'),cc=new IOSSession(s,copy.id);copy.config.features.files={snapshot:renderConfig(b).join('\n')};cmd(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(copy.config.features.keychains,b.config.features.keychains);
});

test('OSPF uses the valid send key with longest lifetime then highest ID, while EIGRP ignores chain algorithm',()=>{
 const{s,a,b,ca,cb}=pair();for(const[c,id]of[[ca,'1.1.1.1'],[cb,'2.2.2.2']]as const)cmd(c,'conf t','key chain K','key 7','key-string common','cryptographic-algorithm hmac-sha-384','exit','key 1','key-string '+id,'cryptographic-algorithm md5','send-lifetime 00:00:00 January 1 2026 duration 3600','exit','exit','interface g0/0','ip ospf authentication key-chain K','ip ospf hello-interval 1','router ospf 1','router-id '+id,'network 0.0.0.0 255.255.255.255 area 0','end');s.advance(4000);assert.ok(a.runtime.features.ospfPackets.ospf.neighbors.some((n:any)=>n.state==='FULL'),'Infinite common key7 wins over finite mismatched key1');
 for(const[c,id]of[[ca,'1.1.1.1'],[cb,'2.2.2.2']]as const)cmd(c,'conf t','no router ospf 1','key chain K','no key 1','key 7','cryptographic-algorithm '+(c===ca?'hmac-sha-256':'hmac-sha-512'),'exit','exit','interface g0/0','ip authentication mode eigrp 10 md5','ip authentication key-chain eigrp 10 K','router eigrp 10','router-id '+id,'network 10.0.0.0 0.0.0.255','network 192.0.2.0 0.0.0.255','end');s.advance(2500);assert.ok(a.runtime.neighbors.some(n=>n.protocol==='EIGRP'&&n.state==='UP'));
});
