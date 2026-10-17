import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { defaultInterface, type Device } from '../src/model.ts';
import { resetBgpSessions } from '../src/bgp-session.ts';
const port='GigabitEthernet0/0';
function address(d:Device,name:string,ip:string,mask='255.255.255.0'){const i=d.config.interfaces[name]??=defaultInterface(name,false);Object.assign(i,{adminUp:true,switchport:false,ip,mask});return i;}
function route(d:Device){return d.runtime.routes.find(r=>r.protocol==='B'&&r.network==='192.0.2.2');}
function session(d:Device){return d.runtime.features.bgpSessions[0];}
function pair(seed=300){const s=new Simulator(seed),a=s.addDevice('router'),b=s.addDevice('router');address(a,port,'10.0.0.1');address(b,port,'10.0.0.2');address(b,'Loopback0','192.0.2.2','255.255.255.255');a.config.protocols.bgp={asn:65001,routerId:'1.1.1.1',timers:{keepalive:1,hold:3,connectRetry:1},neighbors:[{address:'10.0.0.2',remoteAs:65002}],networks:[]};b.config.protocols.bgp={asn:65002,routerId:'2.2.2.2',timers:{keepalive:2,hold:6,connectRetry:1},neighbors:[{address:'10.0.0.1',remoteAs:65001}],networks:[{network:'192.0.2.2',prefix:32}]};const wire=s.connect({deviceId:a.id,port},{deviceId:b.id,port});return{s,a,b,wire};}

test('BGP requires delivered OPEN and KEEPALIVE then keeps updates on one persistent TCP channel',()=>{
  const{s,a,b}=pair();assert.equal(route(a),undefined);assert.notEqual(session(a).state,'ESTABLISHED');s.advance(1000);assert.equal(session(a).state,'ESTABLISHED');assert.equal(session(a).negotiatedHold,3);assert.deepEqual(route(a)?.asPath,[65002]);const first=session(a).channelId;
  s.advance(7000);s.changed();assert.equal(session(a).channelId,first);assert.equal(session(a).state,'ESTABLISHED');assert.ok(session(a).messagesReceived>=8);
  b.config.protocols.bgp.networks=[];s.changed();assert.ok(route(a),'remote routes persist until an actual UPDATE arrives');s.advance(100);assert.equal(route(a),undefined);assert.equal(session(a).channelId,first);
  b.config.protocols.bgp.networks=[{network:'192.0.2.2',prefix:32}];s.changed();s.advance(100);assert.ok(route(a));assert.equal(session(a).channelId,first);
});

test('BGP hold expiry withdraws traffic-learned routes under loss without a link-down and reconnects',()=>{
  const{s,a,b,wire}=pair(301);s.advance(1000);const first=session(a).channelId;assert.ok(route(a));wire.loss=1;s.advance(3200);assert.equal(wire.enabled,true);assert.equal(route(a),undefined);assert.notEqual(session(a).state,'ESTABLISHED');assert.ok(s.events.some(e=>e.protocol==='BGP'&&e.detail.includes('Hold timer expired')));
  wire.loss=0;s.advance(5000);assert.ok(route(a));assert.equal(session(a).state,'ESTABLISHED');assert.notEqual(session(a).channelId,first);assert.ok(session(b).connects>=2);
});

test('BGP maximum-prefix failure persists until explicit clear and corrected policy',()=>{
  const{s,a,b}=pair(302);address(b,'Loopback1','198.51.100.2','255.255.255.255');b.config.protocols.bgp.networks.push({network:'198.51.100.2',prefix:32});a.config.protocols.bgp.neighbors[0].maximumPrefix=1;s.changed();s.advance(1000);assert.equal(session(a).state,'IDLE (MAX-PREFIX)');assert.equal(route(a),undefined);
  b.config.protocols.bgp.networks=[{network:'192.0.2.2',prefix:32}];s.changed();s.advance(4000);assert.equal(session(a).state,'IDLE (MAX-PREFIX)');resetBgpSessions(s,a.id,'10.0.0.2');s.advance(3000);assert.equal(session(a).state,'ESTABLISHED');assert.ok(route(a));
});

test('BGP loopback peers need actual return routing and eBGP multihop TTL on both TCP directions',()=>{
  const s=new Simulator(303),a=s.addDevice('router'),r=s.addDevice('router'),b=s.addDevice('router');address(a,port,'10.0.12.1');address(r,port,'10.0.12.2');address(r,'GigabitEthernet0/1','10.0.23.2');address(b,port,'10.0.23.3');address(a,'Loopback0','192.0.2.1','255.255.255.255');address(b,'Loopback0','192.0.2.2','255.255.255.255');
  a.config.staticRoutes=[{network:'192.0.2.2',prefix:32,nextHop:'10.0.12.2',ad:1}];r.config.staticRoutes=[{network:'192.0.2.1',prefix:32,nextHop:'10.0.12.1',ad:1},{network:'192.0.2.2',prefix:32,nextHop:'10.0.23.3',ad:1}];
  for(const[d,asn,peer,remoteAs,rid]of[[a,65001,'192.0.2.2',65002,'1.1.1.1'],[b,65002,'192.0.2.1',65001,'2.2.2.2']] as const)d.config.protocols.bgp={asn,routerId:rid,timers:{connectRetry:1},neighbors:[{address:peer,remoteAs,updateSource:'Loopback0',ebgpMultihop:2}],networks:[]};
  s.connect({deviceId:a.id,port},{deviceId:r.id,port});s.connect({deviceId:r.id,port:'GigabitEthernet0/1'},{deviceId:b.id,port});s.advance(12000);assert.notEqual(session(a).state,'ESTABLISHED');assert.notEqual(session(b).state,'ESTABLISHED');
  b.config.staticRoutes=[{network:'192.0.2.1',prefix:32,nextHop:'10.0.23.2',ad:1}];a.config.protocols.bgp.neighbors[0].ebgpMultihop=1;s.changed();s.advance(12000);assert.notEqual(session(a).state,'ESTABLISHED');
  a.config.protocols.bgp.neighbors[0].ebgpMultihop=2;s.changed();s.advance(12000);assert.equal(session(a).state,'ESTABLISHED');assert.equal(session(b).state,'ESTABLISHED');
});

test('BGP AS-path policy matches anchored AS boundaries and filters received advertisements',()=>{
  const{s,a}=pair(304);a.config.features.asPathLists={ORIGIN:[{sequence:10,action:'permit',pattern:'^65002$'}]};a.config.features.routeMaps={'PATH permit 10':{name:'PATH',action:'permit',sequence:10,match:['as-path ORIGIN'],set:['local-preference 220']}};a.config.protocols.bgp.neighbors[0].routeMapIn='PATH';s.changed();s.advance(1000);assert.equal(a.runtime.features.bgpTable[0].localPreference,220);
  a.config.features.asPathLists.ORIGIN[0].pattern='_6500_';s.changed();assert.equal(route(a),undefined);a.config.features.asPathLists.ORIGIN[0].pattern='^6500.*$';s.changed();assert.ok(route(a));
});

test('BFD templates start real control sessions and BGP fall-over withdraws before its long hold timer',()=>{
  const{s,a,b}=pair(305);for(const d of[a,b]){d.config.protocols.bgp.timers={keepalive:30,hold:90,connectRetry:1};d.config.protocols.bgp.neighbors[0].bfd=true;d.config.features.bfdTemplates={FAST:{minTx:100,minRx:100,multiplier:3}};d.config.interfaces[port].features.bfdTemplate='FAST';}s.changed();s.advance(2000);assert.ok(route(a));assert.equal(a.runtime.features.bfd[0].state,'UP');assert.equal(a.runtime.features.bfd[0].detectionTime,300);
  const original=s.sendControlDatagram.bind(s);s.sendControlDatagram=(id,source,destination,p,body,options)=>{if(body.protocol!=='bfd')original(id,source,destination,p,body,options);};s.advance(500);assert.equal(route(a),undefined);assert.equal(session(a).state,'IDLE');assert.equal(a.runtime.features.bfd[0].state,'DOWN');
  s.sendControlDatagram=original;s.advance(3000);assert.ok(route(a));
});

test('BGP conditional aggregate advertises a summary and withdraws it after the last component disappears',()=>{
  const{s,a,b}=pair(306);b.config.protocols.bgp.aggregates=[{network:'192.0.2.0',prefix:24,summaryOnly:true}];s.changed();s.advance(1000);assert.equal(route(a),undefined);assert.ok(a.runtime.routes.some(r=>r.protocol==='B'&&r.network==='192.0.2.0'&&r.prefix===24));assert.ok(b.runtime.routes.some(r=>r.protocol==='B'&&r.network==='192.0.2.0'&&r.interface==='Null0'));assert.equal(a.runtime.features.bgpTable.find((r:any)=>r.network==='192.0.2.0').atomicAggregate,true);
  b.config.protocols.bgp.aggregates[0].summaryOnly=false;s.changed();s.advance(100);assert.ok(route(a));b.config.protocols.bgp.networks=[];s.changed();s.advance(100);assert.equal(a.runtime.routes.some(r=>r.protocol==='B'),false);assert.equal(b.runtime.routes.some(r=>r.interface==='Null0'),false);
});

test('BGP TTL-security rejects low-TTL connection packets until both peers transmit the protected hop limit',()=>{
  const{s,a,b}=pair(307);a.config.protocols.bgp.neighbors[0].ttlSecurityHops=1;s.changed();s.advance(10000);assert.notEqual(session(a).state,'ESTABLISHED');assert.equal(route(a),undefined);assert.ok(a.runtime.features.tcpTTLDrop>0);
  b.config.protocols.bgp.neighbors[0].ttlSecurityHops=1;s.changed();s.advance(3000);assert.equal(session(a).state,'ESTABLISHED');assert.ok(route(a));
});
