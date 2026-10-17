import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { defaultInterface, type Device } from '../src/model.ts';
import { applyRouteMap, prefixListPermits, virtualArpReply } from '../src/control-plane.ts';

const rp=(n:number)=>`GigabitEthernet0/${n}`;
const sp=(n:number)=>`GigabitEthernet0/${n}`;
function address(d:Device,name:string,ip:string,mask='255.255.255.0') {
  const i=d.config.interfaces[name]??=defaultInterface(name,false);
  i.adminUp=true;i.switchport=false;i.ip=ip;i.mask=mask;return i;
}
function link(s:Simulator,a:Device,ap:string,b:Device,bp:string) {
  a.config.interfaces[ap].adminUp=true;b.config.interfaces[bp].adminUp=true;
  return s.connect({deviceId:a.id,port:ap},{deviceId:b.id,port:bp});
}
function igp(d:Device,protocol='ospf',extra:Record<string,any>={}) {
  d.config.protocols[protocol]={processId:1,asn:100,version:2,networks:[{network:'0.0.0.0',prefix:0,area:0}],...extra};
}
function trunk(d:Device,name:string,vlans=[1,10,20]) {
  const i=d.config.interfaces[name];i.mode='trunk';i.allowedVlans=vlans;
  for(const id of vlans)d.config.vlans[id]={id,name:`VLAN${id}`,active:true};
}
function neighbors(d:Device,p:string) {return d.runtime.neighbors.filter(n=>n.protocol===p);}
function route(d:Device,network:string,protocol?:string) {return d.runtime.routes.find(r=>r.network===network&&(!protocol||r.protocol.startsWith(protocol)));}

test('rapid spanning tree blocks one triangle edge and converges after link failure',()=>{
  const s=new Simulator(1),a=s.addDevice('switch'),b=s.addDevice('switch'),c=s.addDevice('switch');
  a.config.features.stp={priority:0};b.config.features.stp={priority:4096};c.config.features.stp={priority:8192};
  const ab=link(s,a,sp(1),b,sp(1));link(s,b,sp(2),c,sp(1));link(s,c,sp(2),a,sp(2));
  s.changed();s.advance(31000);
  for(const d of[a,b,c])assert.equal(d.runtime.stp['1'].rootId,a.id);
  const ports=[a,b,c].flatMap(d=>Object.values(d.runtime.stp['1'].ports));
  assert.equal(ports.filter(p=>p.role==='alternate').length,1);
  assert.equal(ports.filter(p=>p.state==='forwarding').length,5);
  s.disconnect(ab.id);s.advance(1001);
  assert.equal(b.runtime.stp['1'].ports[sp(2)].role,'root');
  assert.equal(b.runtime.stp['1'].ports[sp(2)].state,'forwarding');
  assert.equal(c.runtime.stp['1'].ports[sp(1)].state,'forwarding');
});

test('classic PVST observes listening and learning timers, with PortFast on host edge',()=>{
  const s=new Simulator(2),a=s.addDevice('switch'),b=s.addDevice('switch'),pc=s.addDevice('pc');
  a.config.features.stp={mode:'pvst'};b.config.features.stp={mode:'pvst'};
  a.config.interfaces[sp(2)].features.portfast=true;
  link(s,a,sp(1),b,sp(1));link(s,a,sp(2),pc,'GigabitEthernet0');s.changed();
  assert.equal(a.runtime.stp['1'].ports[sp(1)].state,'listening');
  assert.equal(a.runtime.stp['1'].ports[sp(2)].state,'forwarding');
  s.advance(15000);assert.equal(a.runtime.stp['1'].ports[sp(1)].state,'learning');
  s.advance(15000);assert.equal(a.runtime.stp['1'].ports[sp(1)].state,'forwarding');
});

test('matching MST regions elect independently configured instance roots',()=>{
  const s=new Simulator(3),a=s.addDevice('switch'),b=s.addDevice('switch');
  trunk(a,sp(1));trunk(b,sp(1));
  a.config.features.stp={mode:'mst',mst:{name:'campus',revision:1,instances:[{id:1,vlans:[10],priority:0},{id:2,vlans:[20],priority:8192}]}};
  b.config.features.stp={mode:'mst',mst:{name:'campus',revision:1,instances:[{id:1,vlans:[10],priority:8192},{id:2,vlans:[20],priority:0}]}};
  link(s,a,sp(1),b,sp(1));s.advance(1001);
  assert.equal(a.runtime.stp['10'].rootId,a.id);assert.equal(a.runtime.stp['20'].rootId,b.id);
});

test('BPDU guard prevents a PortFast link to another switch from forwarding',()=>{
  const s=new Simulator(4),a=s.addDevice('switch'),b=s.addDevice('switch');
  a.config.interfaces[sp(1)].features={portfast:true,bpduguard:true};
  link(s,a,sp(1),b,sp(1));s.advance(35000);
  assert.equal(a.runtime.stp['1'].ports[sp(1)].state,'disabled');
  assert.equal(a.runtime.stp['1'].ports[sp(1)].role,'bpdu-inconsistent');
});

test('DTP negotiates desirable/auto, while auto/auto stays access',()=>{
  const s=new Simulator(5),a=s.addDevice('switch'),b=s.addDevice('switch');
  a.config.interfaces[sp(1)].mode='dynamic-desirable';b.config.interfaces[sp(1)].mode='dynamic-auto';
  link(s,a,sp(1),b,sp(1));s.advance(20);
  assert.equal(a.runtime.features.trunks[sp(1)].operational,true);assert.equal(b.runtime.features.trunks[sp(1)].operational,true);
  a.config.interfaces[sp(1)].mode='dynamic-auto';s.changed();s.advance(20);
  assert.equal(a.runtime.features.trunks[sp(1)].operational,false);assert.equal(b.runtime.features.trunks[sp(1)].operational,false);
});

test('LACP active/passive bundles members and passive/passive cannot form a bundle',()=>{
  const s=new Simulator(6),a=s.addDevice('switch'),b=s.addDevice('switch');
  for(const n of[1,2]) {
    a.config.interfaces[sp(n)].features={channelGroup:1,channelMode:'active'};
    b.config.interfaces[sp(n)].features={channelGroup:7,channelMode:'passive'};
    link(s,a,sp(n),b,sp(n));
  }
  s.changed();s.advance(1001);
  assert.deepEqual(a.runtime.features.portChannels[1].activeMembers,[sp(1),sp(2)]);
  assert.equal(a.runtime.stp['1'].ports[sp(1)].role,a.runtime.stp['1'].ports[sp(2)].role);
  for(const n of[1,2])a.config.interfaces[sp(n)].features.channelMode='passive';s.changed();s.advance(20);
  assert.equal(a.runtime.features.portChannels[1].state,'down');assert.equal(b.runtime.features.portChannels[7].state,'down');
});

test('VTP client accepts matching-domain revision and rejects another password',()=>{
  const s=new Simulator(7),a=s.addDevice('switch'),b=s.addDevice('switch');
  trunk(a,sp(1));trunk(b,sp(1));
  a.config.features.vtp={mode:'server',domain:'campus',version:2,password:'lab',revision:1};
  b.config.features.vtp={mode:'client',domain:'campus',version:2,password:'lab',revision:0};
  a.config.vlans[99]={id:99,name:'management',active:true};link(s,a,sp(1),b,sp(1));s.advance(20);
  assert.equal(b.config.vlans[99]?.name,'management');
  a.config.features.vtp.password='different';a.config.features.vtp.revision=2;a.config.vlans[100]={id:100,name:'other',active:true};s.changed();
  assert.equal(b.config.vlans[100],undefined);
});

test('OSPF learns across a forwarding switched segment, and a VLAN mismatch removes adjacency',()=>{
  const s=new Simulator(8),a=s.addDevice('router'),b=s.addDevice('router'),sw=s.addDevice('switch');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','192.0.2.2','255.255.255.255');igp(a);igp(b);
  link(s,a,rp(0),sw,sp(1));s.advance(12000);link(s,b,rp(0),sw,sp(2));s.advance(12000);s.advance(1001);
  assert.equal(neighbors(a,'OSPF')[0]?.state,'FULL');assert.equal(route(a,'192.0.2.2','O')?.nextHop,'10.0.0.2');
  sw.config.vlans[10]={id:10,name:'isolated',active:true};sw.config.interfaces[sp(2)].vlan=10;s.changed();s.advance(45000);s.advance(1001);
  assert.equal(neighbors(a,'OSPF').length,0);assert.equal(route(a,'192.0.2.2','O'),undefined);
});

test('OSPF enforces area/timer/MTU eligibility, and passive interfaces still advertise their network',()=>{
  const s=new Simulator(9),a=s.addDevice('router'),b=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','192.0.2.2','255.255.255.255');
  igp(a);igp(b,'ospf',{passiveInterfaces:['Loopback0']});link(s,a,rp(0),b,rp(0));s.advance(12000);
  assert.ok(route(a,'192.0.2.2','O'));
  b.config.interfaces[rp(0)].mtu=1400;s.changed();s.advance(12000);assert.equal(neighbors(a,'OSPF')[0]?.state,'EXSTART');assert.equal(route(a,'192.0.2.2','O'),undefined);
  b.config.interfaces[rp(0)].mtu=1500;b.config.interfaces[rp(0)].features.ospf={area:1};s.changed();s.advance(12000);assert.equal(neighbors(a,'OSPF').length,0);
  b.config.interfaces[rp(0)].features.ospf={area:0,helloInterval:30};s.changed();s.advance(12000);assert.equal(neighbors(a,'OSPF').length,0);
});

test('OSPF inter-area paths require the backbone',()=>{
  const s=new Simulator(10),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  address(a,rp(0),'10.1.0.1');address(b,rp(0),'10.1.0.2');address(b,rp(1),'10.2.0.1');address(c,rp(0),'10.2.0.2');address(c,'Loopback0','192.0.2.3','255.255.255.255');
  for(const d of[a,b,c])igp(d);
  a.config.interfaces[rp(0)].features.ospf={area:1};b.config.interfaces[rp(0)].features.ospf={area:1};
  b.config.interfaces[rp(1)].features.ospf={area:2};c.config.interfaces[rp(0)].features.ospf={area:2};c.config.interfaces.Loopback0.features.ospf={area:2};
  link(s,a,rp(0),b,rp(0));s.advance(12000);link(s,b,rp(1),c,rp(0));s.advance(12000);
  assert.equal(route(a,'192.0.2.3','O'),undefined);
  b.config.interfaces[rp(1)].features.ospf.area=0;c.config.interfaces[rp(0)].features.ospf.area=0;s.changed();s.advance(12000);
  assert.equal(route(a,'192.0.2.3','O')?.protocol,'O IA');assert.equal(route(a,'192.0.2.3','O')?.nextHop,'10.1.0.2');
});

test('EIGRP requires matching ASN and installs the classic bandwidth/delay metric',()=>{
  const s=new Simulator(11),a=s.addDevice('router'),b=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','192.0.2.2','255.255.255.255');
  igp(a,'eigrp',{asn:100});igp(b,'eigrp',{asn:200});link(s,a,rp(0),b,rp(0));assert.equal(neighbors(a,'EIGRP').length,0);
  b.config.protocols.eigrp.asn=100;s.changed();s.advance(100);
  assert.equal(route(a,'192.0.2.2','D')?.metric,256*(10+20));assert.equal(route(a,'192.0.2.2','D')?.nextHop,'10.0.0.2');
});

test('RIPv2 increments hop count and withdraws routes after adjacency loss',()=>{
  const s=new Simulator(12),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,rp(1),'10.0.1.1');address(c,rp(0),'10.0.1.2');address(c,'Loopback0','192.0.2.3','255.255.255.255');
  for(const d of[a,b,c])igp(d,'rip');link(s,a,rp(0),b,rp(0));const bc=link(s,b,rp(1),c,rp(0));s.advance(3500);
  assert.equal(route(a,'192.0.2.3','R')?.metric,2);s.disconnect(bc.id);s.advance(1500);assert.equal(route(a,'192.0.2.3','R'),undefined);
});

test('eBGP uses reciprocal peers and advertises AS paths with exact-prefix origination',()=>{
  const s=new Simulator(13),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,rp(1),'10.0.1.1');address(c,rp(0),'10.0.1.2');address(c,'Loopback0','192.0.2.3','255.255.255.255');
  a.config.protocols.bgp={asn:65001,neighbors:[{address:'10.0.0.2',remoteAs:65002}],networks:[]};
  b.config.protocols.bgp={asn:65002,neighbors:[{address:'10.0.0.1',remoteAs:65001},{address:'10.0.1.2',remoteAs:65003}],networks:[]};
  c.config.protocols.bgp={asn:65003,neighbors:[{address:'10.0.1.1',remoteAs:65002}],networks:[{network:'192.0.2.3',prefix:32},{network:'198.51.100.0',prefix:24}]};
  link(s,a,rp(0),b,rp(0));link(s,b,rp(1),c,rp(0));s.advance(1500);
  assert.equal(neighbors(a,'BGP')[0]?.state,'ESTABLISHED');assert.deepEqual(route(a,'192.0.2.3','B')?.asPath,[65002,65003]);
  assert.equal(route(a,'192.0.2.3','B')?.nextHop,'10.0.0.2');assert.equal(route(a,'198.51.100.0','B'),undefined);
  b.config.protocols.bgp.neighbors[0].remoteAs=999;s.changed();s.advance(500);assert.equal(neighbors(a,'BGP')[0]?.state,'ACTIVE');assert.equal(route(a,'192.0.2.3','B'),undefined);
});

test('iBGP does not relay routes learned from another iBGP neighbor',()=>{
  const s=new Simulator(14),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,rp(1),'10.0.1.1');address(c,rp(0),'10.0.1.2');address(c,'Loopback0','192.0.2.3','255.255.255.255');
  a.config.protocols.bgp={asn:65000,neighbors:[{address:'10.0.0.2',remoteAs:65000}],networks:[]};
  b.config.protocols.bgp={asn:65000,neighbors:[{address:'10.0.0.1',remoteAs:65000,nextHopSelf:true},{address:'10.0.1.2',remoteAs:65000}],networks:[]};
  c.config.protocols.bgp={asn:65000,neighbors:[{address:'10.0.1.1',remoteAs:65000}],networks:[{network:'192.0.2.3',prefix:32}]};
  link(s,a,rp(0),b,rp(0));link(s,b,rp(1),c,rp(0));s.advance(1500);
  assert.ok(route(b,'192.0.2.3','B'));assert.equal(route(a,'192.0.2.3','B'),undefined);
});

test('HSRP fails over and honors non-preemption on restoration',()=>{
  const s=new Simulator(15),a=s.addDevice('router'),b=s.addDevice('router'),sw=s.addDevice('switch');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');
  for(const [d,priority]of [[a,120],[b,100]] as [Device,number][])d.config.features.fhrp=[{protocol:'hsrp',group:1,interface:rp(0),virtualIp:'10.0.0.254',priority,preempt:false}];
  link(s,a,rp(0),sw,sp(1));link(s,b,rp(0),sw,sp(2));s.advance(3500);
  assert.equal(a.runtime.features.virtualIps[0].role,'active');assert.equal(b.runtime.features.virtualIps[0].role,'standby');
  a.startupConfig=structuredClone(a.config);
  s.power(a.id,false);assert.equal(b.runtime.features.virtualIps[0].role,'standby');s.advance(11000);assert.equal(b.runtime.features.virtualIps[0].role,'active');
  s.power(a.id,true);s.advance(3500);assert.equal(b.runtime.features.virtualIps[0].role,'active');
  a.config.features.fhrp[0].preempt=true;s.changed();s.advance(100);assert.equal(a.runtime.features.virtualIps[0].role,'active');
});

test('OSPF-installed routes carry real echo requests and require a reverse route',()=>{
  const s=new Simulator(16),a=s.addDevice('router'),b=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(a,'Loopback0','192.0.2.1','255.255.255.255');address(b,'Loopback0','192.0.2.2','255.255.255.255');
  igp(a);igp(b);link(s,a,rp(0),b,rp(0));s.advance(12000);
  const good=s.ping(a.id,'192.0.2.2',{count:1,source:'192.0.2.1'});s.advance(5000);assert.equal(good.received,1);
  a.config.protocols.ospf.networks=[{network:'10.0.0.0',prefix:24,area:0}];s.changed();s.advance(12000);
  const fail=s.ping(a.id,'192.0.2.2',{count:1,source:'192.0.2.1'});s.advance(5000);assert.equal(fail.received,0);
});

function address6(d:Device,name:string,ip:string,area=0) {
  const i=d.config.interfaces[name]??=defaultInterface(name,false);i.adminUp=true;i.switchport=false;i.ipv6=[ip];i.features.ospfv3={area};d.config.ipv6Routing=true;return i;
}
test('OSPFv3 establishes per-link IPv6 neighbors and forwards through link-local next hops',()=>{
  const s=new Simulator(17),a=s.addDevice('router'),b=s.addDevice('router');
  address6(a,rp(0),'2001:db8:1::1/64');address6(b,rp(0),'2001:db8:2::2/64');
  address6(a,'Loopback0','2001:db8:aa::1/128');address6(b,'Loopback0','2001:db8:bb::1/128');
  a.config.protocols.ospfv3={processId:1,routerId:'1.1.1.1'};b.config.protocols.ospfv3={processId:2,routerId:'2.2.2.2'};
  link(s,a,rp(0),b,rp(0));s.advance(12000);
  assert.equal(neighbors(a,'OSPFV3')[0]?.state,'FULL');assert.match(route(a,'2001:db8:bb::1','O')?.nextHop??'',/^fe80:/);
  const ping=s.ping(a.id,'2001:db8:bb::1',{count:1,source:'2001:db8:aa::1'});s.advance(5000);assert.equal(ping.received,1);
  b.config.interfaces[rp(0)].features.ospfv3.instanceId=1;s.changed();s.advance(12000);assert.equal(neighbors(a,'OSPFV3').length,0);
});

test('RIPng forwards IPv6 learned prefixes and excludes link-local prefixes from advertisement',()=>{
  const s=new Simulator(18),a=s.addDevice('router'),b=s.addDevice('router');
  address6(a,rp(0),'2001:db8:1::1/64');address6(b,rp(0),'2001:db8:1::2/64');address6(b,'Loopback0','2001:db8:bb::1/128');
  for(const d of[a,b]){d.config.protocols.ripng={};for(const i of Object.values(d.config.interfaces))if(i.ipv6.length)i.features.ripng={enabled:true};}
  link(s,a,rp(0),b,rp(0));s.advance(1500);
  assert.equal(route(a,'2001:db8:bb::1','R')?.metric,1);assert.equal(a.runtime.routes.some(r=>r.protocol==='R'&&r.network.startsWith('fe80')),false);
  const ping=s.ping(a.id,'2001:db8:bb::1',{count:1});s.advance(5000);assert.equal(ping.received,1);
});

test('prefix-list ranges and route-map ordered deny/set clauses affect exported routes',()=>{
  const s=new Simulator(19),a=s.addDevice('router');
  a.config.features.prefixLists={PERMITTED:[{sequence:10,action:'permit',network:'172.16.0.0',prefix:16,ge:24,le:28}]};
  assert.equal(prefixListPermits(a,'PERMITTED',{network:'172.16.10.0',prefix:24}),true);
  assert.equal(prefixListPermits(a,'PERMITTED',{network:'172.16.10.1',prefix:32}),false);
  a.config.features.routeMaps={'FILTER deny 5':{name:'FILTER',action:'deny',sequence:5,match:['tag 99'],set:[]},'FILTER permit 10':{name:'FILTER',action:'permit',sequence:10,match:['ip address prefix-list PERMITTED'],set:['metric 50','tag 7','metric-type type-1']}};
  const r={network:'172.16.10.0',prefix:24,interface:'Null0',protocol:'static',ad:1,metric:0};
  assert.equal(applyRouteMap(a,'FILTER',{...r,tag:99}),undefined);
  assert.equal(applyRouteMap(a,'FILTER',r)?.metric,50);assert.equal(applyRouteMap(a,'FILTER',r)?.tag,7);
  assert.equal(applyRouteMap(a,'FILTER',{...r,network:'192.0.2.0'}),undefined);
});

test('OSPF redistribution honors prefix-list policy, tags and external metric type',()=>{
  const s=new Simulator(20),a=s.addDevice('router'),b=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');igp(a);igp(b);
  b.config.staticRoutes=[{network:'172.16.1.0',prefix:24,interface:'Null0'},{network:'192.0.2.0',prefix:24,interface:'Null0'},{network:'198.51.100.0',prefix:24,nextHop:'203.0.113.254'}];
  b.config.features.prefixLists={EXPORT:[{sequence:10,action:'permit',network:'172.16.0.0',prefix:16,ge:24,le:24}]};
  b.config.features.routeMaps={'EXPORT permit 10':{name:'EXPORT',action:'permit',sequence:10,match:['ip address prefix-list EXPORT'],set:['tag 100','metric 25','metric-type type-1']}};
  b.config.protocols.ospf.redistribute=[{protocol:'static',routeMap:'EXPORT'}];link(s,a,rp(0),b,rp(0));s.advance(12000);
  const learned=route(a,'172.16.1.0','O');assert.equal(learned?.protocol,'O E1');assert.equal(learned?.metric,26);assert.equal(learned?.tag,100);
  assert.equal(route(a,'192.0.2.0','O'),undefined);assert.equal(route(a,'198.51.100.0','O'),undefined);
});

test('mutual IGP redistribution produces a routed path with independent return traffic',()=>{
  const s=new Simulator(21),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  address(a,rp(0),'10.1.0.1');address(b,rp(0),'10.1.0.2');address(b,rp(1),'10.2.0.1');address(c,rp(0),'10.2.0.2');address(a,'Loopback0','192.0.2.1','255.255.255.255');address(c,'Loopback0','192.0.2.3','255.255.255.255');
  igp(a);igp(b);igp(b,'eigrp');igp(c,'eigrp');
  b.config.protocols.ospf.networks=[{network:'10.1.0.0',prefix:24,area:0}];b.config.protocols.eigrp.networks=[{network:'10.2.0.0',prefix:24}];
  b.config.protocols.ospf.redistribute=[{protocol:'eigrp',metric:20}];b.config.protocols.eigrp.redistribute=[{protocol:'ospf',metric:10000}];
  link(s,a,rp(0),b,rp(0));s.advance(12000);link(s,b,rp(1),c,rp(0));s.advance(12000);
  assert.equal(route(a,'192.0.2.3','O')?.protocol,'O E2');assert.equal(route(c,'192.0.2.1','D')?.protocol,'D EX');
  const ping=s.ping(a.id,'192.0.2.3',{count:1,source:'192.0.2.1'});s.advance(5000);assert.equal(ping.received,1);
});

test('totally stubby OSPF area receives a default while suppressing inter-area specifics',()=>{
  const s=new Simulator(22),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  address(a,rp(0),'10.1.0.1');address(b,rp(0),'10.1.0.2');address(b,rp(1),'10.0.0.1');address(c,rp(0),'10.0.0.2');address(c,'Loopback0','192.0.2.3','255.255.255.255');
  for(const d of[a,b,c])igp(d);
  a.config.interfaces[rp(0)].features.ospf={area:1};b.config.interfaces[rp(0)].features.ospf={area:1};
  a.config.protocols.ospf.areas={'1':{type:'stub'}};b.config.protocols.ospf.areas={'1':{type:'stub',noSummary:true}};
  link(s,a,rp(0),b,rp(0));s.advance(12000);link(s,b,rp(1),c,rp(0));s.advance(12000);
  assert.equal(route(a,'192.0.2.3','O'),undefined);assert.equal(route(a,'0.0.0.0','O')?.protocol,'O IA');
  delete b.config.protocols.ospf.areas['1'];s.changed();s.advance(12000);assert.equal(neighbors(a,'OSPF').length,0);
});

test('EIGRP variance admits only feasible alternates and stub routers cannot become transit',()=>{
  const s=new Simulator(23),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router'),d=s.addDevice('router');
  address(a,rp(0),'10.1.0.1');address(b,rp(0),'10.1.0.2');address(a,rp(1),'10.2.0.1').features.delay=20;address(c,rp(0),'10.2.0.2');
  address(b,rp(1),'10.3.0.1');address(d,rp(0),'10.3.0.2');address(c,rp(1),'10.4.0.1');address(d,rp(1),'10.4.0.2');address(d,'Loopback0','192.0.2.4','255.255.255.255');
  for(const r of[a,b,c,d])igp(r,'eigrp');
  link(s,a,rp(0),b,rp(0));link(s,a,rp(1),c,rp(0));link(s,b,rp(1),d,rp(0));const cd=link(s,c,rp(1),d,rp(1));
  s.advance(100);const routes=()=>a.runtime.routes.filter(r=>r.protocol==='D'&&r.network==='192.0.2.4');assert.equal(routes().length,1);
  a.config.protocols.eigrp.variance=2;s.changed();assert.equal(routes().length,2);
  c.config.interfaces[rp(1)].features.delay=100;s.changed();s.advance(100);assert.equal(routes().length,1);
  b.config.protocols.eigrp.stub=['connected','summary'];s.disconnect(cd.id);s.advance(100);assert.equal(routes().length,0);
});

test('EIGRP interface summaries replace specifics and install a conditional discard route',()=>{
  const s=new Simulator(24),a=s.addDevice('router'),b=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2').features.eigrp={summaries:[{network:'172.16.0.0',prefix:16}]};
  address(b,'Loopback1','172.16.1.1');address(b,'Loopback2','172.16.2.1');igp(a,'eigrp');igp(b,'eigrp');link(s,a,rp(0),b,rp(0));s.advance(100);
  assert.equal(route(a,'172.16.0.0','D')?.prefix,16);assert.equal(route(a,'172.16.1.0','D'),undefined);
  assert.equal(route(b,'172.16.0.0','D')?.interface,'Null0');
  b.config.interfaces.Loopback1.adminUp=false;b.config.interfaces.Loopback2.adminUp=false;s.changed();s.advance(100);assert.equal(route(a,'172.16.0.0','D'),undefined);
});

test('BGP inbound/outbound route maps filter prefixes and change path/local preference',()=>{
  const s=new Simulator(25),a=s.addDevice('router'),b=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','192.0.2.2','255.255.255.255');address(b,'Loopback1','198.51.100.2','255.255.255.255');
  a.config.protocols.bgp={asn:65001,neighbors:[{address:'10.0.0.2',remoteAs:65002,routeMapIn:'IN'}],networks:[]};
  b.config.protocols.bgp={asn:65002,neighbors:[{address:'10.0.0.1',remoteAs:65001,prefixListOut:'OUT',routeMapOut:'PREPEND'}],networks:[{network:'192.0.2.2',prefix:32},{network:'198.51.100.2',prefix:32}]};
  b.config.features.prefixLists={OUT:[{sequence:10,action:'permit',network:'192.0.2.0',prefix:24,le:32}]};
  b.config.features.routeMaps={'PREPEND permit 10':{name:'PREPEND',action:'permit',sequence:10,match:[],set:['as-path prepend 65002 65002']}};
  a.config.features.routeMaps={'IN permit 10':{name:'IN',action:'permit',sequence:10,match:[],set:['local-preference 250']}};
  link(s,a,rp(0),b,rp(0));s.advance(1500);assert.deepEqual(route(a,'192.0.2.2','B')?.asPath,[65002,65002,65002]);assert.equal(route(a,'198.51.100.2','B'),undefined);
  assert.equal(a.runtime.features.bgpTable.find((r:any)=>r.network==='192.0.2.2').localPreference,250);
});

test('BFD packets establish a session and packet loss withdraws dependent OSPF routes',()=>{
  const s=new Simulator(26),a=s.addDevice('router'),b=s.addDevice('router');
  for(const [d,ip]of [[a,'10.0.0.1'],[b,'10.0.0.2']] as const){address(d,rp(0),ip).features.bfd={enabled:true,minTx:100,minRx:100,multiplier:3};igp(d,'ospf',{bfd:true});}
  address(b,'Loopback0','192.0.2.2','255.255.255.255');
  a.config.features.tracks={'1':{type:'bfd',interface:rp(0),peer:'10.0.0.2'}};
  const wire=link(s,a,rp(0),b,rp(0));assert.equal(route(a,'192.0.2.2','O'),undefined);
  s.advance(12000);assert.equal(a.runtime.features.bfd[0].state,'UP');assert.ok(route(a,'192.0.2.2','O'));assert.equal(a.runtime.features.tracks['1'].up,true);
  const probe=s.ping(a.id,'192.0.2.2',{count:1});s.advance(200);assert.equal(probe.received,1);
  wire.loss=1;s.advance(500);assert.equal(a.runtime.features.bfd[0].state,'DOWN');assert.equal(route(a,'192.0.2.2','O'),undefined);assert.equal(a.runtime.features.tracks['1'].up,false);
  wire.loss=0;s.advance(12000);assert.equal(a.runtime.features.bfd[0].state,'UP');assert.ok(route(a,'192.0.2.2','O'));
});

test('GLBP AVG assigns clients distinct forwarders and failed forwarder MACs transfer',()=>{
  const s=new Simulator(27),sw=s.addDevice('switch'),a=s.addDevice('router'),b=s.addDevice('router'),p=s.addDevice('pc'),q=s.addDevice('pc');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(p,'GigabitEthernet0','10.0.0.10');address(q,'GigabitEthernet0','10.0.0.11');
  for(const d of[a,b])d.config.features.fhrp=[{protocol:'glbp',group:1,interface:rp(0),virtualIp:'10.0.0.254',priority:d===a?110:100}];
  link(s,a,rp(0),sw,sp(1));link(s,b,rp(0),sw,sp(2));link(s,p,'GigabitEthernet0',sw,sp(3));link(s,q,'GigabitEthernet0',sw,sp(4));s.advance(3500);
  assert.equal(a.runtime.features.glbpGroups[0].role,'active');assert.deepEqual(virtualArpReply(s,b,rp(0),'10.0.0.254','00:11:22:33:44:55'),{handled:true});
  const x=s.ping(p.id,'10.0.0.254',{count:1}),y=s.ping(q.id,'10.0.0.254',{count:1});s.advance(3000);
  assert.equal(x.received,1);assert.equal(y.received,1);
  const pm=p.runtime.arp['GigabitEthernet0|10.0.0.254'].mac,qm=q.runtime.arp['GigabitEthernet0|10.0.0.254'].mac;assert.notEqual(pm,qm);
  s.power(a.id,false);s.advance(11000);
  assert.equal(b.runtime.features.glbpGroups[0].role,'active');assert.ok(b.runtime.features.virtualIps.some((v:any)=>v.mac===pm));assert.ok(b.runtime.features.virtualIps.some((v:any)=>v.mac===qm));
  const z=s.ping(p.id,'10.0.0.254',{count:1});s.advance(3000);assert.equal(z.received,1);
});

test('NHRP registers spokes over the underlay and resolves an on-demand direct mGRE next hop',()=>{
  const s=new Simulator(28),sw=s.addDevice('switch'),hub=s.addDevice('router'),a=s.addDevice('router'),b=s.addDevice('router');
  for(const[d,n]of[[hub,1],[a,2],[b,3]] as const){
    address(d,rp(0),`192.0.2.${n}`);const t=address(d,'Tunnel0',`10.0.0.${n}`);
    t.features={eigrp:{splitHorizon:d===hub?false:true},tunnelSource:rp(0),tunnelMode:'gre multipoint',tunnelKey:100,nhrp:{networkId:100+n,authentication:'lab',holdtime:6,multicast:d===hub?'dynamic':['192.0.2.1'],nhs:d===hub?[]:[{address:'10.0.0.1',nbma:'192.0.2.1'}]}};
    address(d,'Loopback0',`172.16.${n}.1`);igp(d,'eigrp',{networks:[{network:'10.0.0.0',prefix:24},{network:'172.16.0.0',prefix:16}]});link(s,d,rp(0),sw,sp(n));
  }
  s.advance(6500);assert.equal(hub.runtime.features.nhrp.Tunnel0.cache.filter((m:any)=>m.type==='dynamic').length,2);
  assert.equal(a.runtime.features.nhrp.Tunnel0.registrations[0].state,'UP');assert.ok(route(a,'172.16.3.0','D'));
  hub.config.interfaces.Tunnel0.features.eigrp.nextHopSelf=false;s.changed();s.advance(100);assert.equal(route(a,'172.16.3.0','D')?.nextHop,'10.0.0.3');
  a.config.staticRoutes.push({network:'172.16.3.0',prefix:24,nextHop:'10.0.0.3',interface:'Tunnel0',ad:1});s.changed();
  const ping=s.ping(a.id,'172.16.3.1',{count:1,source:'172.16.2.1'});s.advance(3000);assert.equal(ping.received,1);
  assert.equal(a.runtime.features.nhrp.Tunnel0.cache.find((m:any)=>m.address==='10.0.0.3')?.nbma,'192.0.2.3');
  assert.ok(s.events.some(e=>e.protocol==='NHRP'&&e.label==='Resolution complete'));
  b.config.interfaces.Tunnel0.features.nhrp.authentication='wrong';s.changed();s.advance(7000);
  assert.equal(hub.runtime.features.nhrp.Tunnel0.cache.some((m:any)=>m.address==='10.0.0.3'),false);assert.equal(route(hub,'172.16.3.0','D'),undefined);
});

test('IGMP reports create a PIM receiver tree; real multicast honors membership, TTL and RPF',()=>{
  const s=new Simulator(29),a=s.addDevice('router'),b=s.addDevice('router'),src=s.addDevice('pc'),dst=s.addDevice('pc'),other=s.addDevice('pc'),sw=s.addDevice('switch');
  address(a,rp(0),'10.1.0.1');address(src,'GigabitEthernet0','10.1.0.2');address(a,rp(1),'10.12.0.1');address(b,rp(0),'10.12.0.2');address(b,rp(1),'10.2.0.1');address(dst,'GigabitEthernet0','10.2.0.2');address(other,'GigabitEthernet0','10.2.0.3');
  for(const d of[a,b]){igp(d);d.config.features.multicastRouting=true;for(const i of Object.values(d.config.interfaces))i.features.pim='dense-mode';}
  dst.config.interfaces.GigabitEthernet0.features.igmpGroups=[{group:'239.1.1.1'}];
  link(s,src,'GigabitEthernet0',a,rp(0));link(s,a,rp(1),b,rp(0));link(s,b,rp(1),sw,sp(1));link(s,dst,'GigabitEthernet0',sw,sp(2));link(s,other,'GigabitEthernet0',sw,sp(3));s.advance(1001);
  // Initial report can precede STP convergence; a second host report is real link traffic.
  s.sendControlDatagram(dst.id,'10.2.0.2','224.0.0.22',0,{protocol:'igmp',operation:'report',group:'239.1.1.1'},{interface:'GigabitEthernet0',ttl:1,protocol:'igmp'});s.advance(100);
  assert.ok(b.runtime.features.igmpGroups.some((m:any)=>m.group==='239.1.1.1'));
  s.sendMulticast(src.id,'239.1.1.1',{interface:'GigabitEthernet0',ttl:5,payload:'hello'});s.advance(100);
  assert.equal(dst.runtime.features.multicastReceived.length,1);assert.equal(dst.runtime.features.multicastReceived[0].ttl,3);assert.equal(other.runtime.features.multicastReceived,undefined);
  assert.deepEqual(a.runtime.features.mroutes[0].outgoing,[rp(1)]);assert.deepEqual(b.runtime.features.mroutes[0].outgoing,[rp(1)]);
  s.sendMulticast(src.id,'239.1.1.1',{interface:'GigabitEthernet0',ttl:1,payload:'expired'});s.advance(100);assert.equal(dst.runtime.features.multicastReceived.length,1);
  b.config.staticRoutes.push({network:'10.1.0.2',prefix:32,nextHop:'10.2.0.9',interface:rp(1),ad:1});s.changed();
  s.sendMulticast(src.id,'239.1.1.1',{interface:'GigabitEthernet0',ttl:5,payload:'wrong-rpf'});s.advance(100);assert.equal(dst.runtime.features.multicastReceived.length,1);
  // Inject on the upstream segment to exercise the receiver's RPF check directly.
  s.sendMulticast(a.id,'239.1.1.1',{source:'10.1.0.2',interface:rp(1),ttl:4});s.advance(100);
  assert.ok(s.events.some(e=>e.detail.includes('RPF failed')));
  b.config.staticRoutes=[];for(const d of[a,b])for(const i of Object.values(d.config.interfaces))i.features.pim='sparse-mode';s.changed();
  s.sendMulticast(src.id,'239.1.1.1',{interface:'GigabitEthernet0',ttl:5});s.advance(100);assert.equal(dst.runtime.features.multicastReceived.length,1);
  for(const d of[a,b])d.config.features.pim={rpAddress:'10.12.0.1'};s.changed();s.sendMulticast(src.id,'239.1.1.1',{interface:'GigabitEthernet0',ttl:5});s.advance(100);assert.equal(dst.runtime.features.multicastReceived.length,2);
});

test('UDLD detects a one-way physical fault and aggressive mode disables the unsafe port',()=>{
  const s=new Simulator(30),a=s.addDevice('switch'),b=s.addDevice('switch');
  for(const d of[a,b])d.config.interfaces[sp(1)].features.udld={mode:'aggressive',messageTime:1};
  const wire=link(s,a,sp(1),b,sp(1));s.advance(100);
  assert.equal(a.runtime.features.udld[sp(1)].state,'BIDIRECTIONAL');assert.equal(b.runtime.features.udld[sp(1)].state,'BIDIRECTIONAL');
  wire.lossAB=1;s.advance(12000);
  assert.ok(a.config.interfaces[sp(1)].features.errDisabled||b.config.interfaces[sp(1)].features.errDisabled);
  assert.equal(s.interfaceUp(a.id,sp(1)),false);assert.ok(s.events.some(e=>e.protocol==='UDLD'&&e.label.includes('err-disabled')));
  wire.lossAB=0;for(const d of[a,b]){delete d.config.interfaces[sp(1)].features.errDisabled;delete d.config.interfaces[sp(1)].features.errDisabledReason;}s.changed();s.advance(100);
  assert.equal(a.runtime.features.udld[sp(1)].state,'BIDIRECTIONAL');
});

test('PTP BMCA elects by priority within a domain and labels synchronization as unmodeled',()=>{
  const s=new Simulator(31),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  a.config.features.ptp={mode:'ordinary',domain:1,priority1:10};b.config.features.ptp={mode:'boundary',domain:1,priority1:100};c.config.features.ptp={mode:'ordinary',domain:1,priority1:200};
  link(s,a,rp(0),b,rp(0));link(s,b,rp(1),c,rp(0));
  assert.equal(c.runtime.features.ptp.grandmasterId,a.id);assert.equal(b.runtime.features.ptp.role,'BOUNDARY');assert.equal(c.runtime.features.ptp.synchronized,false);
  a.config.features.ptp.domain=2;s.changed();assert.equal(c.runtime.features.ptp.grandmasterId,b.id);assert.equal(a.runtime.features.ptp.grandmasterId,a.id);
});

test('OSPF ABR range summarizes only outside its source area and honors not-advertise',()=>{
  const s=new Simulator(32),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  address(a,rp(0),'10.1.0.1');address(b,rp(0),'10.1.0.2');address(b,rp(1),'10.0.0.1');address(c,rp(0),'10.0.0.2');address(a,'Loopback0','172.16.1.1');address(a,'Loopback1','172.16.2.1');
  for(const d of[a,b,c])igp(d);
  for(const i of Object.values(a.config.interfaces))i.features.ospf={area:1};b.config.interfaces[rp(0)].features.ospf={area:1};b.config.protocols.ospf.areas={'1':{ranges:[{network:'172.16.0.0',prefix:16,cost:50}]}};
  link(s,a,rp(0),b,rp(0));s.advance(12000);link(s,b,rp(1),c,rp(0));s.advance(12000);
  assert.equal(route(c,'172.16.1.0','O'),undefined);assert.equal(route(c,'172.16.0.0','O')?.metric,51);assert.ok(route(b,'172.16.1.0','O'));assert.equal(route(b,'172.16.0.0','O')?.interface,'Null0');
  const probe=s.ping(c.id,'172.16.1.1',{count:1});s.advance(3000);assert.equal(probe.received,1);
  b.config.protocols.ospf.areas['1'].ranges[0].notAdvertise=true;s.changed();s.advance(12000);assert.equal(route(c,'172.16.0.0','O'),undefined);
});

test('BGP reflection carries originator/cluster attributes and communities control external export',()=>{
  const s=new Simulator(33),sw=s.addDevice('switch'),a=s.addDevice('router'),rr=s.addDevice('router'),c=s.addDevice('router'),d=s.addDevice('router');
  for(const[r,n]of[[a,1],[rr,2],[c,3],[d,4]] as const){address(r,rp(0),`10.0.0.${n}`);address(r,'Loopback0',`192.0.2.${n}`,'255.255.255.255');r.config.protocols.bgp={asn:r===d?65100:65000,routerId:`${n}.${n}.${n}.${n}`,networks:[{network:`192.0.2.${n}`,prefix:32}],neighbors:[]};link(s,r,rp(0),sw,sp(n));}
  const peer=(r:Device,ip:string,remoteAs:number,extra:any={})=>r.config.protocols.bgp.neighbors.push({address:ip,remoteAs,sendCommunity:true,...extra});
  peer(a,'10.0.0.2',65000,{routeMapOut:'TAG'});peer(rr,'10.0.0.1',65000,{routeReflectorClient:true});peer(rr,'10.0.0.3',65000,{routeReflectorClient:true});peer(c,'10.0.0.2',65000);peer(c,'10.0.0.4',65100);peer(d,'10.0.0.3',65000);
  rr.config.protocols.bgp.clusterId='2.2.2.2';a.config.features.routeMaps={'TAG permit 10':{name:'TAG',action:'permit',sequence:10,match:[],set:['community 65000:77 no-export']}};
  s.changed();s.advance(4000);
  assert.ok(route(a,'192.0.2.4','B'));const reflected=a.runtime.features.bgpTable.find((r:any)=>r.network==='192.0.2.4');assert.equal(reflected.originatorId,'3.3.3.3');assert.deepEqual(reflected.clusterList,['2.2.2.2']);
  assert.ok(route(c,'192.0.2.1','B'));assert.equal(route(d,'192.0.2.1','B'),undefined);
  c.config.features.communityLists={TAGGED:[{action:'permit',communities:['65000:77']}]};c.config.features.routeMaps={'POLICY permit 10':{name:'POLICY',action:'permit',sequence:10,match:['community TAGGED'],set:['local-preference 222']}};c.config.protocols.bgp.neighbors[0].routeMapIn='POLICY';s.changed();assert.equal(c.runtime.features.bgpTable.find((r:any)=>r.network==='192.0.2.1').localPreference,222);
  a.config.protocols.bgp.neighbors[0].maximumPrefix=1;s.changed();s.advance(35000);assert.equal(neighbors(a,'BGP')[0].state,'IDLE (MAX-PREFIX)');assert.equal(route(a,'192.0.2.4','B'),undefined);
});

test('keychain send/accept lifetimes gate authenticated routing and trigger timed rollover',()=>{
  const s=new Simulator(34),a=s.addDevice('router'),b=s.addDevice('router');
  for(const[d,n,name]of[[a,1,'LOCAL-A'],[b,2,'LOCAL-B']] as const){
    address(d,rp(0),`10.0.0.${n}`).features.eigrp={authenticationMode:'md5',authenticationKeyChain:name};address(d,'Loopback0',`192.0.2.${n}`,'255.255.255.255');igp(d,'eigrp');d.config.features.clockEpoch=0;
    d.config.features.keychains={[name]:{keys:{'1':{keyString:'first',sendLifetime:{end:1000},acceptLifetime:{end:3000}},'2':{keyString:d===a?'second':'mismatch',sendLifetime:{start:1001},acceptLifetime:{start:500}}}}};
  }
  link(s,a,rp(0),b,rp(0));s.advance(100);assert.ok(route(a,'192.0.2.2','D'));assert.equal(a.runtime.features.keychains['LOCAL-A'].sendKeyId,'1');
  s.advance(1001);assert.equal(a.runtime.features.keychains['LOCAL-A'].sendKeyId,'2');assert.equal(route(a,'192.0.2.2','D'),undefined);assert.equal(neighbors(a,'EIGRP')[0].state,'AUTH-FAILED');
  b.config.features.keychains['LOCAL-B'].keys['2'].keyString='second';s.changed();s.advance(100);assert.ok(route(a,'192.0.2.2','D'));
  b.config.features.keychains['LOCAL-B'].keys['3']=b.config.features.keychains['LOCAL-B'].keys['2'];delete b.config.features.keychains['LOCAL-B'].keys['2'];s.changed();assert.equal(route(a,'192.0.2.2','D'),undefined);
});

test('OSPF simple and message-digest authentication require matching effective keys',()=>{
  const s=new Simulator(35),a=s.addDevice('router'),b=s.addDevice('router');
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','192.0.2.2','255.255.255.255');igp(a);igp(b);link(s,a,rp(0),b,rp(0));s.advance(12000);
  a.config.interfaces[rp(0)].features.ospf={authentication:'simple',authenticationKey:'hello'};b.config.interfaces[rp(0)].features.ospf={authentication:'simple',authenticationKey:'wrong'};s.changed();s.advance(12000);assert.equal(route(a,'192.0.2.2','O'),undefined);
  b.config.interfaces[rp(0)].features.ospf.authenticationKey='hello';s.changed();s.advance(12000);assert.ok(route(a,'192.0.2.2','O'));
  for(const d of[a,b])d.config.interfaces[rp(0)].features.ospf={authentication:'message-digest',messageDigestKeys:{'7':'same'}};s.changed();s.advance(12000);assert.ok(route(a,'192.0.2.2','O'));
  b.config.interfaces[rp(0)].features.ospf.messageDigestKeys={'8':'same'};s.changed();s.advance(12000);assert.equal(route(a,'192.0.2.2','O'),undefined);
});

test('EIGRP IPv6 uses explicit interface membership and link-local next hops for real traffic',()=>{
  const s=new Simulator(36),a=s.addDevice('router'),b=s.addDevice('router');
  for(const[d,n]of[[a,1],[b,2]] as const){
    d.config.ipv6Routing=true;d.config.protocols.eigrp6={asn:100,name:'CAMPUS',routerId:`${n}.${n}.${n}.${n}`,networks:[]};
    const physical=d.config.interfaces[rp(0)];physical.adminUp=true;physical.ipv6=[`2001:db8:${n}::1/64`];physical.features.eigrp6={asn:100};
    const loop=d.config.interfaces.Loopback0=defaultInterface('Loopback0',false);loop.adminUp=true;loop.ipv6=[`2001:db8:${n+10}::1/128`];loop.features.eigrp6={asn:100};
  }
  link(s,a,rp(0),b,rp(0));s.advance(100);assert.equal(neighbors(a,'EIGRP6')[0].state,'UP');assert.match(route(a,'2001:db8:12::1','D')?.nextHop??'',/^fe80:/);
  const probe=s.ping(a.id,'2001:db8:12::1',{count:1,source:'2001:db8:11::1'});s.advance(3000);assert.equal(probe.received,1);
  b.config.protocols.eigrp6.asn=200;s.changed();assert.equal(route(a,'2001:db8:12::1','D'),undefined);
});

test('OSPF broadcast election preserves the DR, promotes BDR and leaves DROTHER pairs 2WAY',()=>{
  const s=new Simulator(70),sw=s.addDevice('switch'),rs=[1,2,3,4].map(n=>{const d=s.addDevice('router');address(d,rp(0),`10.0.0.${n}`);address(d,'Loopback0',`192.0.2.${n}`,'255.255.255.255');igp(d,'ospf',{routerId:`1.1.1.${n}`});return d;});
  for(const [i,d]of rs.entries())link(s,d,rp(0),sw,sp(i+1));s.advance(12000);s.advance(1500);
  const roles=rs.map(d=>d.runtime.features.ospfInterfaces[rp(0)]);assert.equal(roles.filter(r=>r.role==='DR').length,1);assert.equal(roles.filter(r=>r.role==='BDR').length,1);
  const dr=rs.find(d=>d.runtime.features.ospfInterfaces[rp(0)].role==='DR')!,bdr=rs.find(d=>d.runtime.features.ospfInterfaces[rp(0)].role==='BDR')!;
  const others=rs.filter(d=>![dr,bdr].includes(d));assert.equal(neighbors(others[0],'OSPF').find(n=>n.deviceId===others[1].id)?.state,'2WAY');assert.ok(route(others[0],others[1].config.interfaces.Loopback0.ip!,'O'));
  others[0].config.interfaces[rp(0)].features.ospf={priority:255};s.changed();s.advance(12000);assert.equal(dr.runtime.features.ospfInterfaces[rp(0)].role,'DR');
  dr.config.interfaces[rp(0)].features.ospf={priority:0};s.changed();s.advance(12000);assert.equal(bdr.runtime.features.ospfInterfaces[rp(0)].role,'DR');
  for(const d of rs)d.config.interfaces[rp(0)].features.ospf={priority:0};s.changed();s.advance(12000);assert.ok(rs.every(d=>d.runtime.features.ospfInterfaces[rp(0)].role==='DROTHER'));assert.ok(!route(rs[0],'192.0.2.4','O'));
});

test('OSPF reciprocal virtual links restore a remote area through a normal transit area and physical next hops',()=>{
  const s=new Simulator(71),rs=Array.from({length:5},()=>s.addDevice('router'));
  for(const [i,d]of rs.entries()){address(d,'Loopback0',`192.0.2.${i+1}`,'255.255.255.255');igp(d,'ospf',{routerId:`1.1.1.${i+1}`,networks:[]});}
  for(let i=0;i<4;i++){const area=[0,1,1,2][i];address(rs[i],rp(1),`10.0.${i}.1`);address(rs[i+1],rp(0),`10.0.${i}.2`);rs[i].config.interfaces[rp(1)].features.ospf={area};rs[i+1].config.interfaces[rp(0)].features.ospf={area};link(s,rs[i],rp(1),rs[i+1],rp(0));s.advance(12000);}
  rs[0].config.interfaces.Loopback0.features.ospf={area:0};rs[4].config.interfaces.Loopback0.features.ospf={area:2};s.changed();s.advance(12000);assert.ok(!route(rs[0],'192.0.2.5','O'));
  rs[1].config.protocols.ospf.virtualLinks=[{transitArea:'1',routerId:'1.1.1.4'}];rs[3].config.protocols.ospf.virtualLinks=[{transitArea:'1',routerId:'1.1.1.2'}];s.changed();s.advance(12000);
  assert.equal(rs[1].runtime.features.ospfVirtualLinks[0].state,'UP');assert.equal(route(rs[1],'192.0.2.5','O')?.nextHop,'10.0.1.2');const ping=s.ping(rs[0].id,'192.0.2.5',{count:1,source:'192.0.2.1'});s.advance(3000);assert.equal(ping.received,1);
  rs[3].config.protocols.ospf.virtualLinks[0].helloInterval=20;s.changed();s.advance(12000);assert.equal(rs[1].runtime.features.ospfVirtualLinks[0].state,'DOWN');assert.ok(!route(rs[0],'192.0.2.5','O'));
  rs[3].config.protocols.ospf.virtualLinks[0].helloInterval=10;rs[1].config.protocols.ospf.areas={'1':{type:'nssa'}};rs[2].config.protocols.ospf.areas={'1':{type:'nssa'}};rs[3].config.protocols.ospf.areas={'1':{type:'nssa'}};s.changed();s.advance(12000);assert.equal(rs[1].runtime.features.ospfVirtualLinks[0].state,'DOWN');
});

test('NSSA imports local externals as Type 7, translates outward and rejects outside Type 5',()=>{
  const s=new Simulator(72),outside=s.addDevice('router'),abr=s.addDevice('router'),asbr=s.addDevice('router'),inside=s.addDevice('router');
  for(const [i,d]of[outside,abr,asbr,inside].entries())igp(d,'ospf',{routerId:`1.1.1.${i+1}`,networks:[],areas:i?{'1':{type:'nssa'}}:{}});
  address(outside,rp(0),'10.0.0.1').features.ospf={area:0};address(abr,rp(0),'10.0.0.2').features.ospf={area:0};link(s,outside,rp(0),abr,rp(0));s.advance(12000);
  address(abr,rp(1),'10.0.1.1').features.ospf={area:1};address(asbr,rp(0),'10.0.1.2').features.ospf={area:1};link(s,abr,rp(1),asbr,rp(0));s.advance(12000);
  address(asbr,rp(1),'10.0.2.1').features.ospf={area:1};address(inside,rp(0),'10.0.2.2').features.ospf={area:1};link(s,asbr,rp(1),inside,rp(0));s.advance(12000);
  address(asbr,'Loopback0','172.16.1.1');address(outside,'Loopback0','198.51.100.1');asbr.config.protocols.ospf.redistribute=[{protocol:'connected',metric:30}];outside.config.protocols.ospf.redistribute=[{protocol:'connected',metric:40}];s.changed();s.advance(12000);
  assert.equal(route(inside,'172.16.1.0','O')?.protocol,'O N2');assert.equal(route(outside,'172.16.1.0','O')?.protocol,'O E2');assert.ok(!route(inside,'198.51.100.0','O'));assert.equal(abr.runtime.features.ospfNssa['1'].role,'TRANSLATOR');
  abr.config.protocols.ospf.areas['1'].defaultOriginate=true;s.changed();s.advance(12000);assert.equal(route(inside,'0.0.0.0','O')?.protocol,'O N2');
  address(abr,'Loopback0','203.0.113.1');abr.config.protocols.ospf.redistribute=[{protocol:'connected'}];s.changed();s.advance(12000);assert.ok(route(inside,'203.0.113.0','O'));abr.config.protocols.ospf.areas['1'].noRedistribution=true;s.changed();s.advance(12000);assert.ok(!route(inside,'203.0.113.0','O'));assert.ok(route(outside,'203.0.113.0','O'));
});

test('RIP filters apply at intermediate advertisements and offsets can make a route unreachable',()=>{
  const s=new Simulator(73),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');
  for(const d of[a,b,c])igp(d,'rip');address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,rp(1),'10.0.1.1');address(c,rp(0),'10.0.1.2');address(c,'Loopback0','192.0.2.1');link(s,a,rp(0),b,rp(0));link(s,b,rp(1),c,rp(0));s.advance(3500);
  assert.equal(route(a,'192.0.2.0','R')?.metric,2);
  (b.config.features.prefixLists??={}).BLOCK=[{sequence:10,action:'deny',network:'192.0.2.0',prefix:24},{sequence:20,action:'permit',network:'0.0.0.0',prefix:0,le:32}];b.config.protocols.rip.distributeLists=[{direction:'out',interface:rp(0),prefixList:'BLOCK'}];s.changed();s.advance(2500);assert.ok(!route(a,'192.0.2.0','R'));assert.ok(route(b,'192.0.2.0','R'));
  b.config.protocols.rip.distributeLists=[];(b.config.features.acls??={}).SELECT={type:'standard',entries:[{sequence:10,action:'permit',source:'192.0.2.0',wildcard:'0.0.0.255'}]};b.config.protocols.rip.offsetLists=[{direction:'out',interface:rp(0),acl:'SELECT',offset:5}];s.changed();s.advance(2500);assert.equal(route(a,'192.0.2.0','R')?.metric,7);assert.equal(route(b,'192.0.2.0','R')?.metric,1);
  b.config.protocols.rip.offsetLists[0].offset=14;s.changed();s.advance(2500);assert.ok(!route(a,'192.0.2.0','R'));
});

test('LACP chooses at most eight matching members using controlling system and port priority',()=>{
  const s=new Simulator(74),a=s.addDevice('switch'),b=s.addDevice('switch');a.config.features.lacpSystemPriority=1;b.config.features.lacpSystemPriority=100;
  for(let n=1;n<=9;n++){a.config.interfaces[sp(n)]??=defaultInterface(sp(n),true);b.config.interfaces[sp(n)]??=defaultInterface(sp(n),true);a.config.interfaces[sp(n)].features={channelGroup:1,channelMode:'active',lacpPortPriority:n===9?1:32768};b.config.interfaces[sp(n)].features={channelGroup:2,channelMode:'passive'};link(s,a,sp(n),b,sp(n));}
  s.advance(100);const ca=a.runtime.features.portChannels[1],cb=b.runtime.features.portChannels[2];assert.equal(ca.activeMembers.length,8);assert.ok(ca.activeMembers.includes(sp(9)));assert.deepEqual(ca.standbyMembers,[sp(8)]);assert.deepEqual(ca.activeMembers,cb.activeMembers);assert.equal(ca.controllingSystem,a.id);
  a.config.interfaces[sp(9)].adminUp=false;s.changed();assert.equal(a.runtime.features.portChannels[1].activeMembers.length,8);assert.ok(a.runtime.features.portChannels[1].activeMembers.includes(sp(8)));
});

test('STP root guard rejects a superior bridge and recovers when the peer becomes inferior',()=>{
  const s=new Simulator(75),a=s.addDevice('switch'),b=s.addDevice('switch');a.config.features.stp={priority:8192};b.config.features.stp={priority:0};a.config.interfaces[sp(1)].features.rootGuard=true;link(s,a,sp(1),b,sp(1));s.advance(3000);
  assert.equal(a.runtime.stp['1'].rootId,a.id);assert.equal(a.runtime.stp['1'].ports[sp(1)].role,'root-inconsistent');assert.equal(a.runtime.stp['1'].ports[sp(1)].state,'blocking');
  b.config.features.stp.priority=16384;s.changed();s.advance(1001);assert.equal(a.runtime.stp['1'].ports[sp(1)].state,'forwarding');assert.equal(b.runtime.stp['1'].rootId,a.id);
});

test('STP loop guard blocks on actual one-way BPDU loss and restores forwarding after reception returns',()=>{
  const s=new Simulator(76),a=s.addDevice('switch'),b=s.addDevice('switch'),p=s.addDevice('pc'),q=s.addDevice('pc');a.config.features.stp={priority:0};b.config.features.stp={priority:8192,maxAge:6};b.config.interfaces[sp(1)].features.loopGuard=true;const wire=link(s,a,sp(1),b,sp(1));address(p,'GigabitEthernet0','10.0.0.1');address(q,'GigabitEthernet0','10.0.0.2');link(s,a,sp(2),p,'GigabitEthernet0');link(s,b,sp(2),q,'GigabitEthernet0');s.advance(3000);
  assert.equal(b.runtime.stp['1'].ports[sp(1)].state,'forwarding');const good=s.ping(p.id,'10.0.0.2',{count:1});s.advance(1000);assert.equal(good.received,1);
  wire.lossAB=1;s.advance(7000);assert.equal(b.runtime.stp['1'].ports[sp(1)].role,'loop-inconsistent');assert.equal(b.runtime.stp['1'].ports[sp(1)].state,'blocking');assert.ok(s.events.some(e=>e.protocol==='STP'&&e.label.includes('loop-inconsistent')));
  wire.lossAB=0;s.advance(4000);assert.equal(b.runtime.stp['1'].ports[sp(1)].role,'root');assert.equal(b.runtime.stp['1'].ports[sp(1)].state,'forwarding');const recovered=s.ping(q.id,'10.0.0.1',{count:1});s.advance(1000);assert.equal(recovered.received,1);
});

test('interface BPDU filtering isolates STP elections while leaving the port forwarding',()=>{
  const s=new Simulator(77),a=s.addDevice('switch'),b=s.addDevice('switch');a.config.features.stp={priority:0};b.config.features.stp={priority:8192};b.config.interfaces[sp(1)].features={bpdufilter:true,loopGuard:true};link(s,a,sp(1),b,sp(1));s.advance(8000);
  assert.equal(a.runtime.stp['1'].rootId,a.id);assert.equal(b.runtime.stp['1'].rootId,b.id);assert.equal(b.runtime.stp['1'].ports[sp(1)].state,'forwarding');
});

function dualDiamond(seed:number){
  const s=new Simulator(seed),[a,b,c,d]=Array.from({length:4},()=>s.addDevice('router'));
  for(const[n,r]of[a,b,c,d].entries()){igp(r,'eigrp',{asn:100,activeTime:2000});address(r,'Loopback0',`192.0.2.${n+1}`,'255.255.255.255');}
  const pair=(x:Device,xp:string,y:Device,yp:string,n:number)=>{address(x,xp,`10.0.${n}.1`);address(y,yp,`10.0.${n}.2`);return link(s,x,xp,y,yp);};
  const ab=pair(a,rp(0),b,rp(0),1),bd=pair(b,rp(1),d,rp(0),2),ac=pair(a,rp(1),c,rp(0),3),cd=pair(c,rp(1),d,rp(1),4);
  c.config.interfaces[rp(1)].features.delay=1000;d.config.interfaces[rp(1)].features.delay=1000;s.changed();s.advance(100);return{s,a,b,c,d,ab,bd,ac,cd};
}
function dualRow(d:Device,network:string){return d.runtime.features.eigrpTopology.find((r:any)=>r.network===network);}

test('EIGRP diffusing queries hold a non-feasible replacement ACTIVE until actual replies converge',()=>{
  const{s,a,b,c,d,ab}=dualDiamond(80);assert.equal(route(a,'192.0.2.4','D')?.nextHop,'10.0.1.2');
  s.disconnect(ab.id);assert.equal(dualRow(a,'192.0.2.4').state,'ACTIVE');assert.ok(!route(a,'192.0.2.4','D'));s.advance(2500);
  assert.equal(dualRow(a,'192.0.2.4').state,'PASSIVE');assert.equal(route(a,'192.0.2.4','D')?.nextHop,'10.0.3.2');assert.ok(s.events.some(e=>e.protocol==='EIGRP'&&e.label==='DUAL ACTIVE'));
  const ping=s.ping(a.id,'192.0.2.4',{source:'192.0.2.1',count:1});s.advance(1500);assert.equal(ping.received,1);assert.equal(dualRow(c,'192.0.2.4').pendingReplies.length,0);
});

test('EIGRP SIA probes detect missing replies, reset the neighbor and recover only over bidirectional traffic',()=>{
  const{s,a,c,ab,ac}=dualDiamond(81);ac.lossBA=1;s.disconnect(ab.id);s.advance(2200);
  assert.ok(s.events.some(e=>e.nodeId===a.id&&e.label==='SIA neighbor reset'));assert.equal(neighbors(a,'EIGRP').find(n=>n.deviceId===c.id)?.state,'SIA-DOWN');assert.ok(!route(a,'192.0.2.4','D'));
  ac.lossBA=0;s.advance(2500);assert.equal(neighbors(a,'EIGRP').find(n=>n.deviceId===c.id)?.state,'UP');assert.ok(route(a,'192.0.2.4','D'));assert.ok(s.events.some(e=>e.nodeId===a.id&&e.label==='Neighbor recovered'));
});

test('EIGRP reliable query exchange retries transient loss without declaring false convergence',()=>{
  const{s,a,ab,ac}=dualDiamond(82);ac.loss=1;s.disconnect(ab.id);s.advance(400);assert.equal(dualRow(a,'192.0.2.4').state,'ACTIVE');assert.ok(!route(a,'192.0.2.4','D'));ac.loss=0;s.advance(1200);
  assert.equal(dualRow(a,'192.0.2.4').state,'PASSIVE');assert.ok(route(a,'192.0.2.4','D'));assert.ok(!s.events.some(e=>e.nodeId===a.id&&e.label==='SIA neighbor reset'));
});

test('RIP periodic packets age a route through invalid, hold-down and flush when only update traffic is lost',()=>{
  const s=new Simulator(83),a=s.addDevice('router'),b=s.addDevice('router');for(const d of[a,b])igp(d,'rip',{timers:{update:1,invalid:3,holddown:3,flush:6}});
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','192.0.2.1');const wire=link(s,a,rp(0),b,rp(0));s.advance(1500);assert.equal(route(a,'192.0.2.0','R')?.metric,1);
  const before=a.runtime.features.ripStats.updatesReceived;wire.lossBA=1;s.advance(2000);assert.ok(route(a,'192.0.2.0','R'));s.advance(700);assert.ok(!route(a,'192.0.2.0','R'));const invalid=a.runtime.features.ripDatabase.find((r:any)=>r.network==='192.0.2.0');assert.equal(invalid.status,'invalid');assert.equal(invalid.metric,16);assert.ok(invalid.holdUntil>s.clock.now());assert.equal(a.runtime.features.ripStats.updatesReceived,before);
  s.advance(3000);assert.ok(!a.runtime.features.ripDatabase.some((r:any)=>r.network==='192.0.2.0'));wire.lossBA=0;s.advance(1500);assert.equal(route(a,'192.0.2.0','R')?.metric,1);
});

test('RIP split horizon omits the incoming-interface prefix and poison reverse advertises infinity',()=>{
  const s=new Simulator(84),a=s.addDevice('router'),b=s.addDevice('router');for(const d of[a,b])igp(d,'rip',{timers:{update:1,invalid:5,holddown:3,flush:8}});address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','192.0.2.1');
  const sent:any[]=[],original=s.sendControlDatagram.bind(s);s.sendControlDatagram=(...args:Parameters<Simulator['sendControlDatagram']>)=>{if(args[0]===a.id&&args[4]?.protocol==='rip-update')sent.push(structuredClone(args[4]));original(...args);};link(s,a,rp(0),b,rp(0));s.advance(2000);assert.ok(route(a,'192.0.2.0','R'));assert.ok(sent.every(p=>!p.records.some((r:any)=>r.network==='192.0.2.0')));
  a.config.interfaces[rp(0)].features.rip={splitHorizon:false};s.changed();sent.length=0;s.advance(1500);assert.ok(sent.some(p=>p.records.some((r:any)=>r.network==='192.0.2.0'&&r.metric===2)));
  a.config.interfaces[rp(0)].features.rip={splitHorizon:true,poisonReverse:true};s.changed();sent.length=0;s.advance(1500);assert.ok(sent.some(p=>p.records.some((r:any)=>r.network==='192.0.2.0'&&r.metric===16)));
});

test('RIP hold-down rejects an inferior alternate but accepts recovery from the original advertiser',()=>{
  const s=new Simulator(85),a=s.addDevice('router'),b=s.addDevice('router'),c=s.addDevice('router');for(const d of[a,b,c])igp(d,'rip',{timers:{update:1,invalid:3,holddown:6,flush:10}});
  address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(a,rp(1),'10.0.1.1');address(c,rp(0),'10.0.1.2');address(b,'Loopback0','192.0.2.1');address(c,'Loopback0','192.0.2.2');c.config.protocols.rip.offsetLists=[{direction:'out',interface:rp(0),acl:'0',offset:2}];link(s,a,rp(0),b,rp(0));link(s,a,rp(1),c,rp(0));s.advance(2500);assert.equal(route(a,'192.0.2.0','R')?.nextHop,'10.0.0.2');
  b.config.interfaces.Loopback0.adminUp=false;s.changed();s.advance(1800);assert.ok(!route(a,'192.0.2.0','R'));assert.equal(a.runtime.features.ripDatabase.find((r:any)=>r.network==='192.0.2.0').status,'invalid');
  b.config.interfaces.Loopback0.adminUp=true;s.changed();s.advance(1500);assert.equal(route(a,'192.0.2.0','R')?.nextHop,'10.0.0.2');
});

test('EIGRP promotes a feasible successor without starting a diffusing computation',()=>{
  const{s,a,c,d,ab}=dualDiamond(86);c.config.interfaces[rp(1)].features.delay=10;d.config.interfaces[rp(1)].features.delay=10;s.changed();s.advance(1500);const before=s.events.length;s.disconnect(ab.id);
  assert.equal(dualRow(a,'192.0.2.4').state,'PASSIVE');assert.equal(route(a,'192.0.2.4','D')?.nextHop,'10.0.3.2');assert.ok(!s.events.slice(before).some(e=>e.nodeId===a.id&&e.label==='DUAL ACTIVE'&&e.detail.includes('192.0.2.4/32')));
});

test('EIGRP SIA busy replies extend ACTIVE processing but three extensions cannot mask a stuck computation',()=>{
  const{s,a,c,d,ab}=dualDiamond(87);c.config.protocols.eigrp.activeTime=10000;c.config.protocols.eigrp.enabled=false;s.changed();c.config.protocols.eigrp.enabled=true;s.changed();s.advance(5500);const seen:any[]=[],original=s.sendControlDatagram.bind(s);
  s.sendControlDatagram=(...args:Parameters<Simulator['sendControlDatagram']>)=>{const body=args[4];if(body?.protocol==='eigrp-dual'&&body.network==='192.0.2.4'){if(args[0]===d.id&&body.operation==='REPLY')return;if(args[0]===c.id&&body.operation==='SIA-REPLY')seen.push(structuredClone(body));}original(...args);};
  d.config.interfaces.Loopback0.features.delay=1000;s.disconnect(ab.id);s.advance(3200);assert.equal(dualRow(a,'192.0.2.4').state,'ACTIVE');assert.ok(seen.length>=3);assert.ok(seen.every(p=>p.active));assert.ok(!s.events.some(e=>e.nodeId===a.id&&e.label==='SIA neighbor reset'));
  s.advance(1200);assert.ok(s.events.some(e=>e.nodeId===a.id&&e.label==='SIA neighbor reset'&&e.detail.includes('Three SIA')));assert.ok(!route(a,'192.0.2.4','D'));
});

test('configured PVST forward timers and UplinkFast alternate promotion change convergence time',()=>{
  const s=new Simulator(88),a=s.addDevice('switch'),b=s.addDevice('switch'),c=s.addDevice('switch');a.config.features.stp={mode:'pvst',priority:0,forwardTime:4};b.config.features.stp={mode:'pvst',priority:4096,forwardTime:4};c.config.features.stp={mode:'pvst',uplinkFast:true,forwardTime:4};
  link(s,a,sp(1),b,sp(1));const ac=link(s,a,sp(2),c,sp(1));link(s,b,sp(2),c,sp(2));s.advance(3999);assert.equal(c.runtime.stp['1'].ports[sp(1)].state,'listening');s.advance(20);assert.equal(c.runtime.stp['1'].ports[sp(1)].state,'learning');s.advance(4000);assert.equal(c.runtime.stp['1'].ports[sp(1)].state,'forwarding');assert.equal(c.runtime.stp['1'].ports[sp(2)].role,'alternate');
  s.disconnect(ac.id);assert.equal(c.runtime.stp['1'].ports[sp(2)].role,'root');assert.equal(c.runtime.stp['1'].ports[sp(2)].state,'forwarding');s.changed();assert.equal(c.runtime.stp['1'].ports[sp(2)].state,'forwarding');assert.ok(s.events.some(e=>e.label==='UplinkFast failover'));
});

test('RIPv2 interface summaries suppress specifics, install a discard route and poison on last-component withdrawal',()=>{
  const s=new Simulator(60),a=s.addDevice('router'),b=s.addDevice('router');address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','172.16.1.1');address(b,'Loopback1','172.16.2.1');igp(a,'rip');igp(b,'rip');b.config.interfaces[rp(0)].features.rip={summaries:[{network:'172.16.0.0',prefix:16}]};link(s,a,rp(0),b,rp(0));s.advance(1500);
  assert.equal(route(a,'172.16.0.0','R')?.prefix,16);assert.equal(route(a,'172.16.1.0','R'),undefined);assert.equal(route(b,'172.16.0.0','R')?.interface,'Null0');b.config.interfaces.Loopback0.adminUp=false;b.config.interfaces.Loopback1.adminUp=false;s.changed();s.advance(1500);assert.equal(route(a,'172.16.0.0','R'),undefined);assert.equal(route(b,'172.16.0.0','R'),undefined);
});

test('RIPv1 emits maskless broadcasts and classful summaries while per-interface version acceptance is independent',()=>{
  const s=new Simulator(61),a=s.addDevice('router'),b=s.addDevice('router');address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');address(b,'Loopback0','172.16.9.1');igp(a,'rip',{version:1});igp(b,'rip',{version:1});const messages:any[]=[],send=s.sendControlDatagram.bind(s);s.sendControlDatagram=(id,src,dst,p,body,opts)=>{if(body.protocol==='rip-update')messages.push({id,dst,body});send(id,src,dst,p,body,opts);};link(s,a,rp(0),b,rp(0));s.advance(1500);assert.equal(route(a,'172.16.0.0','R')?.prefix,16);assert.equal(route(a,'172.16.9.0','R'),undefined);const wire=messages.find(m=>m.id===b.id&&m.body.records.some((r:any)=>r.network==='172.16.0.0'));assert.equal(wire.dst,'255.255.255.255');assert.equal(wire.body.records[0].prefix,undefined);assert.equal(wire.body.records[0].tag,undefined);
  a.config.protocols.rip.version=2;a.config.protocols.rip.timers={update:1,invalid:2,holddown:1,flush:3};s.changed();s.advance(2500);assert.equal(route(a,'172.16.0.0','R'),undefined);a.config.interfaces[rp(0)].features.rip={receiveVersion:[1,2]};b.config.protocols.rip.timers={update:1,invalid:10,holddown:1,flush:15};s.changed();s.advance(1500);assert.equal(route(a,'172.16.0.0','R')?.prefix,16);
});


test('EIGRP ordinary Hello loss expires the advertised hold timer while data traffic and physical link remain usable',()=>{
  const s=new Simulator(95),a=s.addDevice('router'),b=s.addDevice('router');for(const[d,n]of[[a,1],[b,2]] as const){address(d,rp(0),`10.0.0.${n}`);address(d,'Loopback0',`192.0.2.${n}`,'255.255.255.255');igp(d,'eigrp');}
  let drop=false;const send=s.sendControlDatagram.bind(s);s.sendControlDatagram=(...args:Parameters<Simulator['sendControlDatagram']>)=>{if(drop&&args[0]===b.id&&args[4]?.protocol==='eigrp-hello')return;send(...args);};link(s,a,rp(0),b,rp(0));assert.equal(route(a,'192.0.2.2','D'),undefined);s.advance(100);assert.ok(route(a,'192.0.2.2','D'));drop=true;s.advance(9000);assert.ok(route(a,'192.0.2.2','D'));const ping=s.ping(a.id,'192.0.2.2',{count:1});s.advance(1000);assert.equal(ping.received,1);s.advance(5100);assert.equal(route(a,'192.0.2.2','D'),undefined);assert.equal(s.interfaceUp(a.id,rp(0)),true);assert.ok(s.events.some(e=>e.nodeId===a.id&&e.label==='Hold timer expired'));drop=false;s.advance(5000);assert.ok(route(a,'192.0.2.2','D'));
});

test('EIGRP uses the remote advertised hold time and permits unequal local hello intervals',()=>{
  const s=new Simulator(96),a=s.addDevice('router'),b=s.addDevice('router');address(a,rp(0),'10.0.0.1').features.eigrp={helloInterval:1,holdTime:9};address(b,rp(0),'10.0.0.2').features.eigrp={helloInterval:1,holdTime:3};address(b,'Loopback0','192.0.2.2','255.255.255.255');igp(a,'eigrp');igp(b,'eigrp');const wire=link(s,a,rp(0),b,rp(0));s.advance(100);assert.ok(route(a,'192.0.2.2','D'));assert.equal(a.runtime.features.eigrpHelloNeighbors[0].holdTime,3);wire.lossBA=1;s.advance(3100);assert.equal(route(a,'192.0.2.2','D'),undefined);assert.equal(neighbors(b,'EIGRP')[0].state,'UP');wire.lossBA=0;s.advance(1100);assert.ok(route(a,'192.0.2.2','D'));
});

test('Named EIGRP keeps wide feasible distance separate from configurable RIB scaling',()=>{
  const s=new Simulator(97),a=s.addDevice('router'),b=s.addDevice('router');for(const d of[a,b])igp(d,'eigrp',{name:'CAMPUS',asn:77});address(a,rp(0),'10.0.0.1').features={bandwidth:100000,delay:20};address(b,rp(0),'10.0.0.2').features={bandwidth:100000,delay:20};address(b,'Loopback0','192.0.2.2','255.255.255.255').features={bandwidth:40000,delay:50};link(s,a,rp(0),b,rp(0));s.advance(100);
  const expectedWide=65536*(10000000/40000+(200+500)/10);assert.equal(dualRow(a,'192.0.2.2').feasibleDistance,expectedWide);assert.equal(dualRow(a,'192.0.2.2').metricMode,'wide');assert.equal(route(a,'192.0.2.2','D')?.metric,expectedWide/128);a.config.protocols.eigrp.ribScale=64;s.changed();assert.equal(route(a,'192.0.2.2','D')?.metric,expectedWide/64);assert.equal(dualRow(a,'192.0.2.2').feasibleDistance,expectedWide);
  a.config.interfaces[rp(0)].features.bandwidth=10000000;b.config.interfaces.Loopback0.features.bandwidth=10000000;s.changed();s.advance(100);const highSpeed=Math.floor(65536*(10000000/10000000)+2*(10000000*65536/10/10000000));assert.equal(dualRow(a,'192.0.2.2').successors[0].metric,highSpeed);assert.equal(route(a,'192.0.2.2','D')?.metric,Math.floor(highSpeed/64));
});

test('HSRP hold expiry follows each observer and preemption waits its configured delay',()=>{
  const s=new Simulator(98),a=s.addDevice('router'),b=s.addDevice('router');address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');for(const d of[a,b])d.config.features.fhrp=[{protocol:'hsrp',group:7,interface:rp(0),virtualIp:'10.0.0.254',version:2,priority:d===a?100:110,helloTime:200,holdTime:900}];const wire=link(s,a,rp(0),b,rp(0));s.advance(300);assert.equal(a.runtime.features.virtualIps[0].role,'standby');assert.equal(b.runtime.features.virtualIps[0].role,'active');assert.equal(a.runtime.features.virtualIps[0].mac,'00:00:0c:9f:f0:07');
  wire.lossBA=1;s.advance(500);assert.equal(a.runtime.features.virtualIps[0].role,'standby');s.advance(500);assert.equal(a.runtime.features.virtualIps[0].role,'active','one-way Hello loss expires only the observer that missed advertisements');assert.equal(b.runtime.features.virtualIps[0].role,'active');wire.lossBA=0;s.advance(300);assert.equal(a.runtime.features.virtualIps[0].role,'standby');
  Object.assign(a.config.features.fhrp[0],{priority:200,preempt:true,preemptDelay:2});s.changed();s.advance(1900);assert.equal(a.runtime.features.virtualIps[0].role,'standby');s.advance(300);assert.equal(a.runtime.features.virtualIps[0].role,'active');assert.equal(b.runtime.features.virtualIps[0].role,'standby');
});

test('HSRP incompatible version or authentication isolates elections until compatible packets arrive',()=>{
  const s=new Simulator(99),a=s.addDevice('router'),b=s.addDevice('router');address(a,rp(0),'10.0.0.1');address(b,rp(0),'10.0.0.2');for(const d of[a,b])d.config.features.fhrp=[{protocol:'hsrp',group:1,interface:rp(0),virtualIp:'10.0.0.254',version:d===a?1:2,priority:d===a?110:100,helloTime:100,holdTime:400,authentication:{mode:'text',key:'shared'}}];link(s,a,rp(0),b,rp(0));s.advance(600);assert.equal(a.runtime.features.virtualIps[0].role,'active');assert.equal(b.runtime.features.virtualIps[0].role,'active');assert.equal(a.runtime.features.fhrpPeers.length,0);b.config.features.fhrp[0].version=1;b.config.features.fhrp[0].authentication.key='wrong';s.changed();s.advance(200);assert.equal(a.runtime.features.fhrpPeers.length,0);b.config.features.fhrp[0].authentication.key='shared';s.changed();s.advance(300);assert.equal(a.runtime.features.virtualIps[0].role,'active');assert.equal(b.runtime.features.virtualIps[0].role,'standby');assert.equal(b.runtime.features.fhrpPeers.length,1);
});
