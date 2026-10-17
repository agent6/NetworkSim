import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import type { Device } from '../src/model.ts';

const g=(n:number)=>'GigabitEthernet0/'+n, host='GigabitEthernet0';
function run(cli:IOSSession,...commands:string[]){for(const command of commands){const result=cli.execute(command);assert.ok(!result.some(line=>/^%/.test(line)),command+'\n'+result.join('\n'));}}
function cli(s:Simulator,d:Device){const c=new IOSSession(s,d.id);run(c,'enable','configure terminal');return c;}
function link(s:Simulator,a:Device,ap:string,b:Device,bp:string){a.config.interfaces[ap].adminUp=true;b.config.interfaces[bp].adminUp=true;return s.connect({deviceId:a.id,port:ap},{deviceId:b.id,port:bp});}
function ip(d:Device,p:string,address:string){Object.assign(d.config.interfaces[p],{adminUp:true,switchport:false,ip:address,mask:'255.255.255.0'});}
function arp(s:Simulator,d:Device,address:string,family=4){(s as any).transmit(d,host,'ff:ff:ff:ff:ff:ff',{kind:'arp',family,operation:'request',source:address,target:family===4?'192.0.2.254':'2001:db8::ffff',mac:s.macOf(d.id,host)});s.advance(20);}

test('STP configured pathcost scales change actual root path metrics and survive configuration replay',()=>{
  const s=new Simulator(925),a=s.addDevice('switch'),b=s.addDevice('switch');a.config.features.stp={priority:0};b.config.features.stp={priority:8192};link(s,a,g(1),b,g(1));s.advance(1500);
  assert.equal(b.runtime.stp['1'].cost,4);const c=cli(s,b);run(c,'spanning-tree pathcost method long');assert.equal(b.runtime.stp['1'].cost,20000);run(c,'end');assert.match(c.execute('show spanning-tree pathcost method').join('\n'),/long/);
  const target=s.addDevice('switch'),other=new IOSSession(s,target.id);target.config.features.files={snapshot:renderConfig(b).join('\n')};run(other,'enable','copy flash:snapshot running-config');assert.equal(target.config.features.stp.pathcostMethod,'long');
  run(c,'configure terminal','no spanning-tree pathcost method');assert.equal(b.runtime.stp['1'].cost,4);
});

test('global PortFast applies to access hosts, BPDU guard protects switch links and interface disable overrides the default',()=>{
  const s=new Simulator(926),a=s.addDevice('switch'),b=s.addDevice('switch'),pc=s.addDevice('pc');const c=cli(s,a);run(c,'spanning-tree mode pvst','spanning-tree portfast edge default','spanning-tree portfast edge bpduguard default');link(s,a,g(1),pc,host);link(s,a,g(2),b,g(1));s.advance(20);
  assert.equal(a.runtime.stp['1'].ports[g(1)].state,'forwarding');assert.equal(a.runtime.stp['1'].ports[g(2)].role,'bpdu-inconsistent');
  run(c,'interface g0/2','spanning-tree bpduguard disable','shutdown','no shutdown');s.advance(31000);assert.equal(a.runtime.stp['1'].ports[g(2)].state,'forwarding');assert.equal(a.runtime.stp['1'].ports[g(2)].edge,false);
  run(c,'interface g0/1','switchport mode trunk');assert.equal(a.runtime.stp['1'].ports[g(1)].edge,false);
  run(c,'spanning-tree portfast edge trunk');assert.equal(a.runtime.stp['1'].ports[g(1)].edge,true);
});

test('global BPDU filtering yields to a switch peer and loop guard default responds to one-way BPDU loss',()=>{
  const s=new Simulator(927),a=s.addDevice('switch'),b=s.addDevice('switch');a.config.features.stp={priority:0};b.config.features.stp={priority:8192,maxAge:6};const c=cli(s,b);run(c,'spanning-tree portfast edge default','spanning-tree portfast edge bpdufilter default','spanning-tree loopguard default');const wire=link(s,a,g(1),b,g(1));s.advance(3000);
  assert.equal(b.runtime.stp['1'].rootId,a.id);assert.equal(b.runtime.stp['1'].ports[g(1)].edge,false);wire.lossAB=1;s.advance(7000);assert.equal(b.runtime.stp['1'].ports[g(1)].role,'loop-inconsistent');wire.lossAB=0;s.advance(4000);assert.equal(b.runtime.stp['1'].ports[g(1)].state,'forwarding');
  run(c,'interface g0/1','spanning-tree guard none');wire.lossAB=1;s.advance(7000);assert.notEqual(b.runtime.stp['1'].ports[g(1)].role,'loop-inconsistent');run(c,'no spanning-tree guard');s.advance(7000);assert.equal(b.runtime.stp['1'].ports[g(1)].role,'loop-inconsistent');
});

test('VLAN state suspend and active affect frame forwarding without deleting the configured VLAN',()=>{
  const s=new Simulator(928),a=s.addDevice('pc'),b=s.addDevice('pc'),sw=s.addDevice('switch');ip(a,host,'192.0.2.1');ip(b,host,'192.0.2.2');const c=cli(s,sw);run(c,'vlan 10','state active','exit','interface range g0/1 - 2','switchport access vlan 10','spanning-tree portfast','end');link(s,a,host,sw,g(1));link(s,b,host,sw,g(2));s.advance(1000);
  let p=s.ping(a.id,'192.0.2.2',{count:1});s.advance(1500);assert.equal(p.received,1);run(c,'configure terminal','vlan 10','state suspend');p=s.ping(a.id,'192.0.2.2',{count:1});s.advance(1500);assert.equal(p.received,0);assert.equal(sw.config.vlans[10].active,false);run(c,'state active');p=s.ping(a.id,'192.0.2.2',{count:1});s.advance(1500);assert.equal(p.received,1);
});

test('attached tracking policies learn delivered ARP, enforce address limits and reject conflicting attachments',()=>{
  const s=new Simulator(929),sw=s.addDevice('switch'),a=s.addDevice('pc'),b=s.addDevice('pc');const c=cli(s,sw);run(c,'device-tracking policy EDGE','security-level guard','limit address-count 1','tracking disable stale-lifetime 2','exit','vlan configuration 1','device-tracking attach-policy EDGE','exit','spanning-tree portfast default');link(s,a,host,sw,g(1));link(s,b,host,sw,g(2));
  arp(s,a,'192.0.2.1');assert.equal(sw.runtime.features.deviceBindings.length,1);assert.equal(sw.runtime.features.deviceBindings[0].state,'stale');arp(s,a,'192.0.2.2');assert.equal(sw.runtime.features.trackingDrops,1);assert.equal(sw.runtime.features.deviceBindings.length,1);arp(s,b,'192.0.2.1');assert.equal(sw.runtime.features.trackingDrops,2);assert.equal(sw.runtime.features.deviceBindings[0].port,g(1));
  run(c,'end');assert.match(c.execute('show device-tracking database').join('\n'),/192\.0\.2\.1/);s.advance(2100);assert.equal(sw.runtime.features.deviceBindings.length,0);arp(s,b,'192.0.2.1');assert.equal(sw.runtime.features.deviceBindings[0].port,g(2));
});

test('snooping learns IPv6 only and a trusted switch attachment bypasses guarding without creating host bindings',()=>{
  const s=new Simulator(930),sw=s.addDevice('switch'),a=s.addDevice('pc');const c=cli(s,sw);run(c,'ipv6 snooping policy V6','security-level glean','tracking enable reachable-lifetime infinite','exit','interface g0/1','ipv6 snooping attach-policy V6','spanning-tree portfast');link(s,a,host,sw,g(1));arp(s,a,'192.0.2.1');assert.equal(Boolean(sw.runtime.features.deviceBindings),false);arp(s,a,'2001:db8::1',6);assert.equal(sw.runtime.features.ipv6Bindings.length,1);assert.equal(sw.runtime.features.ipv6Bindings[0].expires,Infinity);
  run(c,'exit','device-tracking policy UPLINK','device-role switch','trusted-port','exit','interface g0/1','device-tracking attach-policy UPLINK');arp(s,a,'192.0.2.2');assert.equal(sw.runtime.features.deviceBindings?.length??0,0);assert.equal(sw.runtime.features.trackingDrops??0,0);
});

test('VLAN RA-guard attachment drops actual advertisements and an interface policy overrides it',()=>{
  const s=new Simulator(931),sw=s.addDevice('switch'),a=s.addDevice('router');const c=cli(s,sw);run(c,'ipv6 nd raguard policy HOST','device-role host','exit','ipv6 nd raguard policy ROUTER','device-role router','exit','vlan configuration 1','ipv6 nd raguard attach-policy HOST','exit','interface g0/1','spanning-tree portfast');link(s,a,g(0),sw,g(1));
  const advertise=()=>{s.sendLinkControl(a.id,g(0),{kind:'link-control',protocol:'ICMPV6',body:{type:'ra',source:'fe80::1',prefixes:[]}});s.advance(20);};advertise();assert.equal(sw.runtime.features.raGuardDrops,1);run(c,'ipv6 nd raguard attach-policy ROUTER');advertise();assert.equal(sw.runtime.features.raGuardDrops,1);
});

test('control-plane service policy polices locally addressed packets while routed traffic remains operational',()=>{
  const s=new Simulator(932),a=s.addDevice('pc'),r=s.addDevice('router'),b=s.addDevice('server');ip(a,host,'192.0.2.2');a.config.defaultGateway='192.0.2.1';ip(r,g(0),'192.0.2.1');ip(r,g(1),'198.51.100.1');ip(b,host,'198.51.100.2');b.config.defaultGateway='198.51.100.1';link(s,a,host,r,g(0));link(s,r,g(1),b,host);const c=cli(s,r);run(c,'policy-map COPP','class class-default','police 8 1','exit','exit','control-plane','service-policy input COPP','end');
  let p=s.ping(a.id,'192.0.2.1',{count:1});s.advance(1500);assert.equal(p.received,0);assert.ok(r.runtime.features.qosCounters['COPP:class-default:control-plane:in'].dropped>0);p=s.ping(a.id,'198.51.100.2',{count:1});s.advance(1500);assert.equal(p.received,1);assert.match(c.execute('show control-plane counters').join('\n'),/1 drops/);run(c,'configure terminal','control-plane','no service-policy input');p=s.ping(a.id,'192.0.2.1',{count:1});s.advance(1500);assert.equal(p.received,1);
});

test('FHS, VLAN attachments, STP overrides and control-plane policy roundtrip through IOS configuration',()=>{
  const s=new Simulator(933),d=s.addDevice('switch'),c=cli(s,d);run(c,'device-tracking policy EDGE','device-role node','security-level glean','limit address-count 2','tracking disable stale-lifetime 10','exit','vlan configuration 10-11','device-tracking attach-policy EDGE','exit','spanning-tree portfast normal default','spanning-tree loopguard default','interface g0/1','device-tracking attach-policy EDGE','spanning-tree portfast edge trunk','spanning-tree bpduguard disable','spanning-tree guard none','exit','policy-map COPP','class class-default','police 8000 100','exit','exit','control-plane','service-policy input COPP','end');
  const target=s.addDevice('switch'),other=new IOSSession(s,target.id);target.config.features.files={snapshot:renderConfig(d).join('\n')};run(other,'enable','copy flash:snapshot running-config');for(const key of ['trackingPolicies','fhsVlanPolicies','controlPlanePolicyIn'])assert.deepEqual(target.config.features[key],d.config.features[key],key);for(const key of ['portfastType','portfastTrunk','bpduguard','loopGuard','trackingPolicy'])assert.equal(target.config.interfaces[g(1)].features[key],d.config.interfaces[g(1)].features[key],key);
});

test('static IPv6 security bindings survive replay and authorize only their configured attachment',()=>{
  const s=new Simulator(934),sw=s.addDevice('switch'),a=s.addDevice('pc'),b=s.addDevice('pc'),c=cli(s,sw);const mac=s.macOf(a.id,host).replace(/:/g,'').match(/.{4}/g)!.join('.');run(c,'ipv6 neighbor binding vlan 1 2001:db8::1 interface g0/1 '+mac,'device-tracking policy EDGE','security-level guard','exit','interface range g0/1 - 2','spanning-tree portfast','device-tracking attach-policy EDGE','end');link(s,a,host,sw,g(1));link(s,b,host,sw,g(2));arp(s,a,'2001:db8::1',6);assert.equal(sw.runtime.features.trackingDrops??0,0);arp(s,b,'2001:db8::1',6);assert.equal(sw.runtime.features.trackingDrops,1);assert.equal(sw.runtime.features.ipv6Bindings[0].source,'static');assert.match(c.execute('show ipv6 neighbors binding').join('\n'),/2001:db8::1/);
  const target=s.addDevice('switch'),other=new IOSSession(s,target.id);target.config.features.files={snapshot:renderConfig(sw).join('\n')};run(other,'enable','copy flash:snapshot running-config');assert.deepEqual(target.config.features.fhsStaticBindings,sw.config.features.fhsStaticBindings);assert.equal(target.runtime.features.ipv6Bindings[0].source,'static');run(c,'configure terminal','no ipv6 neighbor binding vlan 1 2001:db8::1');assert.equal(sw.runtime.features.ipv6Bindings.length,0);
});

test('binding lifetimes transition through reachable, stale and down on simulation time with measured counters and logging',()=>{
  const s=new Simulator(935),sw=s.addDevice('switch'),a=s.addDevice('pc'),c=cli(s,sw);run(c,'ipv6 neighbor binding logging','ipv6 neighbor binding reachable-lifetime 1','ipv6 neighbor binding stale-lifetime 2','ipv6 neighbor binding down-lifetime 1','ipv6 neighbor binding max-entries 1','device-tracking logging packet drop','device-tracking policy EDGE','tracking enable','exit','interface g0/1','device-tracking attach-policy EDGE','spanning-tree portfast','end');link(s,a,host,sw,g(1));arp(s,a,'192.0.2.1');assert.equal(sw.runtime.features.deviceBindings[0].state,'reachable');s.advance(1100);assert.equal(sw.runtime.features.deviceBindings[0].state,'stale');arp(s,a,'192.0.2.2');assert.equal(sw.runtime.features.trackingDrops,1);assert.match(c.execute('show device-tracking counters interface g0/1').join('\n'),/Received messages: 2[\s\S]*Dropped messages: 1/);assert.match(c.execute('show device-tracking counters vlan 1').join('\n'),/Learned bindings: 1/);assert.ok(s.events.some(e=>e.label==='%SISF-4-DROP'));
  run(c,'configure terminal','interface g0/1','shutdown');assert.equal(sw.runtime.features.deviceBindings[0].state,'down');s.advance(1100);assert.equal(sw.runtime.features.deviceBindings.length,0);assert.ok(s.events.some(e=>e.label==='Device tracking binding removed'));
});

test('new security and switching syntax help matches accepted choices and invalid values preserve policy state',()=>{
  const s=new Simulator(936),d=s.addDevice('switch'),c=cli(s,d);assert.match(c.help('ipv6 neighbor binding ').join('\n'),/max-entries/);assert.match(c.help('ipv6 neighbor binding vlan 10 2001:db8::1 interface ').join('\n'),/INTERFACE/);run(c,'device-tracking policy EDGE');assert.match(c.help('tracking enable ').join('\n'),/reachable-lifetime/);assert.match(c.help('tracking disable stale-lifetime ').join('\n'),/infinite/);assert.equal(c.complete('tracking enable reach'),'tracking enable reachable-lifetime ');
  const before=JSON.stringify(d.config);for(const command of ['tracking enable stale-lifetime 10','limit address-count 32001','device-role router','security-level invalid']){assert.match(c.execute(command).join('\n'),/Invalid/);assert.equal(JSON.stringify(d.config),before,command);}run(c,'exit');assert.match(c.execute('ipv6 neighbor binding max-entries 0').join('\n'),/Invalid/);assert.equal(JSON.stringify(d.config),before);
});

test('ND inspection policy limits and tracking lifetimes govern learned neighbor state',()=>{
  const s=new Simulator(937),sw=s.addDevice('switch'),a=s.addDevice('pc'),c=cli(s,sw);run(c,'ipv6 nd inspection policy ND','limit address-count 1','tracking disable stale-lifetime 2','exit','interface g0/1','ipv6 nd inspection attach-policy ND','spanning-tree portfast');link(s,a,host,sw,g(1));s.sendDAD(a.id,host,'2001:db8::1');s.advance(20);s.sendNeighborAnnouncement(a.id,host,'2001:db8::1');s.advance(20);assert.equal(sw.runtime.features.ipv6Bindings[0].state,'stale');s.sendDAD(a.id,host,'2001:db8::2');s.advance(20);assert.equal(sw.runtime.features.ndInspectionDrops,1);assert.equal(sw.runtime.features.ipv6Bindings.length,1);s.advance(2100);assert.equal(sw.runtime.features.ipv6Bindings.length,0);
  run(c,'exit','ipv6 source-guard policy TRUST','trusted','end');const target=s.addDevice('switch'),other=new IOSSession(s,target.id);target.config.features.files={snapshot:renderConfig(sw).join('\n')};run(other,'enable','copy flash:snapshot running-config');assert.deepEqual(target.config.features.ipv6Policies,sw.config.features.ipv6Policies);
});

test('per-tree port costs and peer port identifiers select real STP root ports',()=>{
  const s=new Simulator(938),a=s.addDevice('switch'),b=s.addDevice('switch'),ca=cli(s,a),cb=cli(s,b);a.config.features.stp={priority:0};b.config.features.stp={priority:8192};for(const c of [ca,cb])run(c,'vlan 20','exit','interface range g0/1 - 2','switchport mode trunk','exit');link(s,a,g(1),b,g(1));link(s,a,g(2),b,g(2));s.advance(2000);assert.equal(b.runtime.stp['1'].ports[g(1)].role,'root');run(ca,'interface g0/2','spanning-tree port-priority 16');s.advance(1500);assert.equal(b.runtime.stp['1'].ports[g(2)].role,'root');run(cb,'interface g0/1','spanning-tree vlan 20 cost 1');s.advance(1500);assert.equal(b.runtime.stp['20'].ports[g(1)].role,'root');assert.equal(b.runtime.stp['20'].cost,1);assert.equal(b.runtime.stp['1'].ports[g(2)].role,'root');assert.match(cb.execute('spanning-tree port-priority 10').join('\n'),/multiple of 16/);run(cb,'no spanning-tree vlan 20 cost');s.advance(1500);assert.equal(b.runtime.stp['20'].ports[g(2)].role,'root');
});

test('shared STP links use listening and learning while point-to-point links converge rapidly',()=>{
  const s=new Simulator(939),a=s.addDevice('switch'),b=s.addDevice('switch'),c=cli(s,a);run(c,'interface g0/1','spanning-tree link-type shared');link(s,a,g(1),b,g(1));s.advance(2000);assert.equal(a.runtime.stp['1'].ports[g(1)].state,'listening');s.advance(14000);assert.equal(a.runtime.stp['1'].ports[g(1)].state,'learning');run(c,'spanning-tree link-type point-to-point');s.advance(1100);assert.equal(a.runtime.stp['1'].ports[g(1)].state,'forwarding');
});

test('voice VLAN carries tagged router subinterface traffic while autostate exclusion changes only the SVI state',()=>{
  const s=new Simulator(940),r=s.addDevice('router'),sw=s.addDevice('l3switch'),pc=s.addDevice('pc'),cr=cli(s,r),cs=cli(s,sw);ip(pc,host,'198.51.100.2');run(cr,'interface g0/0','no shutdown','interface g0/0.20','encapsulation dot1q 20','ip address 198.51.100.1 255.255.255.0','end');run(cs,'interface g0/1','switchport host','switchport voice vlan 20','exit','interface g0/2','switchport access vlan 20','spanning-tree portfast','exit','interface vlan20','ip address 198.51.100.3 255.255.255.0','no shutdown','end');link(s,r,g(0),sw,g(1));link(s,pc,host,sw,g(2));s.advance(1500);let p=s.ping(r.id,'198.51.100.2',{count:1});s.advance(1500);assert.equal(p.received,1);assert.equal(s.interfaceUp(sw.id,'Vlan20'),true);run(cs,'configure terminal','interface range g0/1 - 2','switchport autostate exclude','end');assert.equal(s.interfaceUp(sw.id,'Vlan20'),false);p=s.ping(r.id,'198.51.100.2',{count:1});s.advance(1500);assert.equal(p.received,1,'SVI autostate exclusion does not disable bridged traffic');run(cs,'configure terminal','interface g0/1','no switchport voice vlan','end');p=s.ping(r.id,'198.51.100.2',{count:1});s.advance(1500);assert.equal(p.received,0);
});
