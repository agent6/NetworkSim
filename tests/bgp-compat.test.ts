import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import { defaultInterface,type Device } from '../src/model.ts';
import { selectBgpCandidate,removePrivateAS,type BgpCandidate } from '../src/bgp-compat.ts';
const port='GigabitEthernet0/0';
function ip(d:Device,p:string,address:string,mask='255.255.255.0'){Object.assign(d.config.interfaces[p]??=defaultInterface(p,false),{adminUp:true,switchport:false,ip:address,mask});}
function commands(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(x=>x.startsWith('%')),line+': '+out.join('\n'));}}
function pair(){const s=new Simulator(1600),a=s.addDevice('router'),b=s.addDevice('router'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id);ip(a,port,'10.0.0.1');ip(b,port,'10.0.0.2');ip(b,'Loopback0','192.0.2.2','255.255.255.255');for(const[d,asn,rid,peer,remote]of[[a,65001,'1.1.1.1','10.0.0.2',65002],[b,65002,'2.2.2.2','10.0.0.1',65001]]as const)d.config.protocols.bgp={asn,routerId:rid,timers:{keepalive:1,hold:3,connectRetry:1},networks:d===b?[{network:'192.0.2.2',prefix:32}]:[],neighbors:[{address:peer,remoteAs:remote}]};const link=s.connect({deviceId:a.id,port},{deviceId:b.id,port});return{s,a,b,ca,cb,link};}
const bgpRoute=(d:Device,network='192.0.2.2')=>d.runtime.routes.find(r=>r.protocol==='B'&&r.network===network);
const session=(d:Device)=>d.runtime.features.bgpSessions[0];

test('BGP compatibility CLI validates, renders and restores operational settings',()=>{
 const{s,a,ca}=pair();commands(ca,'enable','conf t','router bgp 65001','bgp log-neighbor-changes','bgp default local-preference 175','bgp always-compare-med','bgp deterministic-med','distance bgp 30 210 220','neighbor 10.0.0.2 password 0 learning-key','neighbor 10.0.0.2 weight 50','neighbor 10.0.0.2 soft-reconfiguration inbound','neighbor 10.0.0.2 default-originate route-map DEFAULT','neighbor 10.0.0.2 remove-private-as all replace-as','neighbor 10.0.0.2 allowas-in 2','end');
 const text=renderConfig(a).join('\n');for(const term of['bgp default local-preference 175','distance bgp 30 210 220','soft-reconfiguration inbound','remove-private-as all replace-as','allowas-in 2'])assert.ok(text.includes(term),term);
 const copy=s.addDevice('router'),cc=new IOSSession(s,copy.id);copy.config.features.files={copy:text};commands(cc,'enable','copy flash:copy running-config');for(const field of ['asn','routerId','networks','neighbors','bgpLogNeighborChanges','alwaysCompareMed','deterministicMed','defaultLocalPreference','bgpDistance'])assert.deepEqual(copy.config.protocols.bgp[field],a.config.protocols.bgp[field],field);
 commands(ca,'conf t','router bgp 65001');const before=structuredClone(a.config.protocols.bgp);assert.match(ca.execute('neighbor 10.0.0.2 weight 65536').join('\n'),/between/);assert.match(ca.execute('neighbor 10.0.0.2 allowas-in 0').join('\n'),/between/);assert.deepEqual(a.config.protocols.bgp,before);commands(ca,'no bgp default local-preference','no distance bgp','no neighbor 10.0.0.2 weight','no neighbor 10.0.0.2 password','no neighbor 10.0.0.2 remove-private-as','end');assert.equal(a.config.protocols.bgp.defaultLocalPreference,undefined);
});

test('modeled TCP password admission blocks mismatches before OPEN and key changes withdraw established routes',()=>{
 const{s,a,b}=pair();a.config.protocols.bgp.neighbors[0].password='alpha';b.config.protocols.bgp.neighbors[0].password='wrong';s.changed();s.advance(1500);assert.notEqual(session(a).state,'ESTABLISHED');assert.equal(bgpRoute(a),undefined);assert.ok(a.runtime.features.tcpAuthenticationDrops||b.runtime.features.tcpAuthenticationDrops);
 b.config.protocols.bgp.neighbors[0].password='alpha';s.changed();s.advance(8000);assert.equal(session(a).state,'ESTABLISHED');assert.ok(bgpRoute(a));const old=session(a).channelId;
 a.config.protocols.bgp.neighbors[0].password='beta';s.changed();assert.equal(session(a).state,'ESTABLISHED');assert.equal(session(a).channelId,old);s.advance(4000);assert.equal(bgpRoute(a),undefined);assert.notEqual(session(b).state,'ESTABLISHED');assert.notEqual(session(a).channelId,old);
 assert.ok(!s.events.some(e=>e.detail.includes('alpha')||e.detail.includes('beta')),'Traffic errors must not disclose configured keys');
});

test('weight precedes default local preference and configured external distance changes the installed route',()=>{
 const{s,a,b}=pair(),c=s.addDevice('router');ip(a,'GigabitEthernet0/1','10.1.0.1');ip(c,port,'10.1.0.2');ip(c,'Loopback0','192.0.2.2','255.255.255.255');c.config.protocols.bgp={asn:65003,routerId:'3.3.3.3',neighbors:[{address:'10.1.0.1',remoteAs:65001}],networks:[{network:'192.0.2.2',prefix:32}]};a.config.protocols.bgp.neighbors.push({address:'10.1.0.2',remoteAs:65003,weight:50});a.config.protocols.bgp.defaultLocalPreference=200;s.connect({deviceId:a.id,port:'GigabitEthernet0/1'},{deviceId:c.id,port});s.advance(2000);assert.equal(bgpRoute(a)?.nextHop,'10.1.0.2');assert.equal(a.runtime.features.bgpTable.find((r:any)=>r.network==='192.0.2.2').localPreference,200);
 a.config.protocols.bgp.neighbors[0].weight=100;s.changed();assert.equal(bgpRoute(a)?.nextHop,'10.0.0.2');a.config.staticRoutes.push({network:'192.0.2.2',prefix:32,interface:'Null0',ad:25});s.changed();assert.ok(bgpRoute(a));a.config.protocols.bgp.bgpDistance={external:40,internal:210,local:220};s.changed();assert.equal(bgpRoute(a),undefined);assert.ok(a.runtime.routes.some(r=>r.network==='192.0.2.2'&&r.protocol==='static'));
});

test('deterministic MED groups same-AS paths before cross-AS comparison independently of arrival order',()=>{
 const make=(from:string,asn:number,med:number,routerId:string):BgpCandidate=>({network:'203.0.113.0',prefix:24,origin:'remote',nextHop:'10.0.0.2',localPreference:100,asPath:[asn],med,routerId,from,learnedVia:'ebgp'});
 const a=make('a',10,100,'1.1.1.1'),b=make('b',20,50,'2.2.2.2'),c=make('c',10,20,'3.3.3.3');
 const permutations=[[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]];for(const paths of permutations){assert.equal(selectBgpCandidate(paths,'local',{deterministicMed:true})?.from,'b');assert.equal(selectBgpCandidate(paths,'local',{deterministicMed:true,alwaysCompareMed:true})?.from,'c');}
 assert.equal(selectBgpCandidate([a,b,c],'local')?.from,'c');assert.equal(selectBgpCandidate([c,b,a],'local')?.from,'a');
});

test('per-neighbor default origination is independent of a local default and conditional policy withdraws on RIB change',()=>{
 const{s,a,b,ca}=pair();commands(ca,'enable','conf t','router bgp 65001','neighbor 10.0.0.2 default-originate','end');s.advance(1500);assert.ok(bgpRoute(b,'0.0.0.0'));assert.ok(!a.runtime.routes.some(r=>r.prefix===0));
 commands(ca,'conf t','ip prefix-list PRESENT permit 198.51.100.1/32','route-map DEFAULT permit 10','match ip address prefix-list PRESENT','router bgp 65001','neighbor 10.0.0.2 default-originate route-map DEFAULT','end');s.advance(100);assert.equal(bgpRoute(b,'0.0.0.0'),undefined);
 ip(a,'Loopback0','198.51.100.1','255.255.255.255');s.changed();s.advance(100);assert.ok(bgpRoute(b,'0.0.0.0'));delete a.config.interfaces.Loopback0;s.changed();s.advance(100);assert.equal(bgpRoute(b,'0.0.0.0'),undefined);
});

test('allowas-in receives a path containing its own ASN and removal restores loop rejection without dropping TCP',()=>{
 const{s,a,b,ca}=pair(),c=s.addDevice('router');ip(b,'GigabitEthernet0/1','10.2.0.1');ip(c,port,'10.2.0.2');ip(c,'Loopback0','203.0.113.3','255.255.255.255');c.config.protocols.bgp={asn:65001,routerId:'3.3.3.3',neighbors:[{address:'10.2.0.1',remoteAs:65002}],networks:[{network:'203.0.113.3',prefix:32}]};b.config.protocols.bgp.neighbors.push({address:'10.2.0.2',remoteAs:65001});s.connect({deviceId:b.id,port:'GigabitEthernet0/1'},{deviceId:c.id,port});s.advance(2000);assert.equal(bgpRoute(a,'203.0.113.3'),undefined);const channel=session(a).channelId;
 commands(ca,'enable','conf t','router bgp 65001','neighbor 10.0.0.2 allowas-in 1','end');assert.deepEqual(bgpRoute(a,'203.0.113.3')?.asPath,[65002,65001]);commands(ca,'conf t','router bgp 65001','no neighbor 10.0.0.2 allowas-in','end');assert.equal(bgpRoute(a,'203.0.113.3'),undefined);assert.equal(session(a).channelId,channel);assert.equal(session(a).state,'ESTABLISHED');
 assert.deepEqual(removePrivateAS([65001],200,100,true),[]);assert.deepEqual(removePrivateAS([300,65001],200,100,true),[300,65001]);assert.deepEqual(removePrivateAS([65001],65001,100,true),[65001]);assert.deepEqual(removePrivateAS([300,4200000000],200,100,'all'),[300]);assert.deepEqual(removePrivateAS([300,4200000000],200,100,'replace-as'),[300,100]);
});

test('soft inbound/outbound refresh and neighbor route views preserve the established channel and raw received routes',()=>{
 const{s,a,b,ca}=pair();commands(ca,'enable','conf t','ip prefix-list DENY deny 192.0.2.2/32','router bgp 65001','neighbor 10.0.0.2 prefix-list DENY in','neighbor 10.0.0.2 soft-reconfiguration inbound','bgp log-neighbor-changes','end');s.advance(1500);assert.equal(bgpRoute(a),undefined);assert.equal(session(a).receivedPrefixes,0);assert.equal(session(a).rawReceivedPrefixes,1);assert.match(ca.execute('show ip bgp neighbors 10.0.0.2 received-routes').join('\n'),/192\.0\.2\.2\/32/);const channel=session(a).channelId;
 commands(ca,'conf t','router bgp 65001','no neighbor 10.0.0.2 prefix-list DENY in','end','clear ip bgp 10.0.0.2 soft in');assert.ok(bgpRoute(a));assert.equal(session(a).channelId,channel);assert.match(ca.execute('show logging').join('\n'),/BGP-5-ADJCHANGE.*Up/);
 commands(ca,'conf t','router bgp 65001','neighbor 10.0.0.2 default-originate','end','clear ip bgp 10.0.0.2 soft out');s.advance(100);assert.ok(bgpRoute(b,'0.0.0.0'));assert.match(ca.execute('show ip bgp neighbors 10.0.0.2 advertised-routes').join('\n'),/0\.0\.0\.0\/0/);assert.equal(session(a).channelId,channel);
 commands(ca,'conf t','router bgp 65001','no neighbor 10.0.0.2 soft-reconfiguration inbound','end');assert.match(ca.execute('show ip bgp neighbors 10.0.0.2 received-routes').join('\n'),/not enabled/);
});

test('private AS removal changes delivered UPDATE paths, and always-compare-med changes the real selected next hop',()=>{
 const{s,a,b,ca,cb}=pair(),c=s.addDevice('router'),cc=new IOSSession(s,c.id);a.config.protocols.bgp.asn=100;b.config.protocols.bgp.neighbors[0].remoteAs=100;
 ip(a,'GigabitEthernet0/1','10.1.0.1');ip(c,port,'10.1.0.2');ip(c,'Loopback0','192.0.2.2','255.255.255.255');c.config.protocols.bgp={asn:300,routerId:'3.3.3.3',neighbors:[{address:'10.1.0.1',remoteAs:100}],networks:[{network:'192.0.2.2',prefix:32}]};a.config.protocols.bgp.neighbors.push({address:'10.1.0.2',remoteAs:300});s.connect({deviceId:a.id,port:'GigabitEthernet0/1'},{deviceId:c.id,port});
 commands(cb,'enable','conf t','route-map MED permit 10','set metric 100','router bgp 65002','neighbor 10.0.0.1 route-map MED out','end');commands(cc,'enable','conf t','route-map MED permit 10','set metric 10','router bgp 300','neighbor 10.1.0.1 route-map MED out','end');s.advance(2000);assert.equal(bgpRoute(a)?.nextHop,'10.0.0.2');commands(ca,'enable','conf t','router bgp 100','bgp always-compare-med','end');assert.equal(bgpRoute(a)?.nextHop,'10.1.0.2');commands(ca,'conf t','router bgp 100','no bgp always-compare-med','neighbor 10.1.0.2 remove-private-as','end');s.advance(100);assert.deepEqual(c.runtime.features.bgpAdjRibIn?.['10.1.0.1'],undefined);
 commands(cc,'conf t','router bgp 300','neighbor 10.1.0.1 soft-reconfiguration inbound','end');s.advance(100);assert.deepEqual((c.runtime.features.bgpAdjRibIn as Record<string,any[]> )['10.1.0.1']?.find((r:any)=>r.network==='192.0.2.2')?.asPath,[100]);commands(ca,'conf t','router bgp 100','no neighbor 10.1.0.2 remove-private-as','end');s.advance(100);assert.deepEqual((c.runtime.features.bgpAdjRibIn as Record<string,any[]> )['10.1.0.1']?.find((r:any)=>r.network==='192.0.2.2')?.asPath,[100,65002]);
});


test('TCP negotiates a transit-clamped MSS in both directions and keeps UTF-8 payloads intact',()=>{
 const s=new Simulator(1650),a=s.addDevice('router'),r=s.addDevice('router'),b=s.addDevice('router');ip(a,port,'10.0.0.1');ip(r,port,'10.0.0.2');ip(r,'GigabitEthernet0/1','10.1.0.1');ip(b,port,'10.1.0.2');a.config.staticRoutes.push({network:'10.1.0.0',prefix:24,nextHop:'10.0.0.2',interface:port});b.config.staticRoutes.push({network:'10.0.0.0',prefix:24,nextHop:'10.1.0.1',interface:port});r.config.interfaces[port].features.tcpMss=500;s.connect({deviceId:a.id,port},{deviceId:r.id,port});s.connect({deviceId:r.id,port:'GigabitEthernet0/1'},{deviceId:b.id,port});
 const lengths:number[]=[],payload={text:'route 🌐 '.repeat(300)},received:any[]=[],replies:any[]=[];const send=s.sendTCPChannelPacket.bind(s);s.sendTCPChannelPacket=(id,packet,input)=>{if(packet.body?.phase==='data')lengths.push(new TextEncoder().encode(packet.body.data).length);send(id,packet,input);};s.registerTCPChannelService(179,d=>d===b,channel=>channel.setHandlers({onMessage:value=>{received.push(value);channel.send(value);}}));const channel=s.connectTCPChannel(a.id,'10.1.0.2',179,{onOpen:c=>c.send(payload),onMessage:value=>replies.push(value)});s.advance(2000);
 assert.equal(channel.state,'OPEN');assert.deepEqual(received,[payload]);assert.deepEqual(replies,[payload]);assert.equal(a.runtime.features.tcpChannels[channel.id].peerMss,500);assert.equal(b.runtime.features.tcpChannels[channel.id].peerMss,500);assert.ok(lengths.length>10);assert.ok(lengths.every(n=>n<=500));
});

test('matching BGP key rollover before hold expiry preserves the established channel',()=>{
 const{s,a,b}=pair();a.config.protocols.bgp.neighbors[0].password='first';b.config.protocols.bgp.neighbors[0].password='first';s.changed();s.advance(2000);const channel=session(a).channelId;assert.equal(session(a).state,'ESTABLISHED');a.config.protocols.bgp.neighbors[0].password='second';s.changed();s.advance(500);b.config.protocols.bgp.neighbors[0].password='second';s.changed();s.advance(2000);assert.equal(session(a).state,'ESTABLISHED');assert.equal(session(a).channelId,channel);assert.ok(bgpRoute(a));
});
