import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import { defaultInterface } from '../src/model.ts';
import { negotiateEthernet } from '../src/ethernet.ts';

const g = 'GigabitEthernet0/0';
function run(cli: IOSSession, ...lines: string[]) { for (const line of lines) { const out = cli.execute(line); assert.ok(!out.some(row => row.startsWith('%')), line + ': ' + out.join('\n')); } }
function pair() {
  const sim = new Simulator(1987), a = sim.addDevice('router'), b = sim.addDevice('router'), ca = new IOSSession(sim, a.id), cb = new IOSSession(sim, b.id);
  for (const [cli, n] of [[ca, 1], [cb, 2]] as const) run(cli, 'enable', 'configure terminal', 'interface '+g, `ip address 192.0.2.${n} 255.255.255.0`, 'no shutdown', 'end');
  sim.connect({deviceId:a.id,port:g},{deviceId:b.id,port:g}); sim.advance(50);
  const ping = sim.ping(a.id,'192.0.2.2',{count:1}); sim.advance(50); assert.equal(ping.received,1);
  return {sim,a,b,ca,cb};
}
test('fixed Ethernet speed mismatch removes carrier and connected routes; matching speed restores actual ICMP', () => {
  const {sim,a,b,ca,cb}=pair();
  run(ca,'configure terminal','interface '+g,'speed 100','duplex full','end');
  run(cb,'configure terminal','interface '+g,'speed 1000','duplex full','end');
  assert.equal(sim.interfaceUp(a.id,g),false); assert.equal(sim.interfaceUp(b.id,g),false);
  assert.ok(!sim.routes(a.id).some(route=>route.network==='192.0.2.0'));
  const failed=sim.ping(a.id,'192.0.2.2',{count:1,timeout:100});sim.advance(150);assert.equal(failed.received,0);
  run(cb,'configure terminal','interface '+g,'speed 100','end');
  assert.equal(sim.interfaceUp(a.id,g),true);const good=sim.ping(a.id,'192.0.2.2',{count:1});sim.advance(100);assert.equal(good.received,1);
  assert.match(ca.execute('show interfaces '+g+' status').join('\n'),/full\s+100\s/);
});
test('parallel detection reports negotiated 100/half against fixed 100/full; explicit 1000 and auto survive config replay', () => {
  const {sim,a,ca,cb}=pair(); run(cb,'configure terminal','interface '+g,'speed 100','duplex full','end');
  assert.equal(sim.ethernetState(a.id,g)?.speed,100);assert.equal(sim.ethernetState(a.id,g)?.duplex,'half');
  assert.match(ca.execute('show interfaces '+g+' status').join('\n'),/a-half\s+a-100\s/);
  run(ca,'configure terminal','interface '+g,'speed 1000','duplex full','end');
  assert.match(renderConfig(a).join("\n"),/ speed 1000/);const fresh=new Simulator(1988),copy=fresh.addDevice('router'),cli=new IOSSession(fresh,copy.id);run(cli,'enable','configure terminal');for(const line of renderConfig(a)){if(!line.trim()||line.startsWith('!')||line==='end'||line.startsWith('Building')||line.startsWith('Current'))continue;run(cli,line.trim());}
  assert.equal(copy.config.interfaces[g].features.speedAuto,false);
  run(ca,'configure terminal','interface '+g,'default speed','default duplex','end');assert.equal(a.config.interfaces[g].features.speedAuto,true);assert.equal(a.config.interfaces[g].duplex,'auto');assert.doesNotMatch(renderConfig(a).join("\n"),/ speed 1000/);
  run(ca,'configure terminal','interface '+g,'speed 1000');assert.match(ca.execute('duplex half').join('\n'),/Half duplex is supported only/);assert.equal(a.config.interfaces[g].duplex,'auto');assert.match(ca.execute('speed 10000').join('\n'),/not supported/);
});
test('duplex mismatch causes actual traffic-driven loss, late collisions only on half side and CRC only on full side; correction restores traffic', () => {
  const {sim,a,b,ca,cb}=pair();run(ca,'configure terminal','interface '+g,'speed 10','duplex half','end');run(cb,'configure terminal','interface '+g,'speed 10','duplex full','end');sim.advance(10);
  const beforeA=structuredClone(a.runtime.counters[g]),beforeB=structuredClone(b.runtime.counters[g]);sim.advance(10);assert.equal(a.runtime.counters[g].collisions??0,beforeA.collisions??0,'Idle mismatch does not invent errors');
  const first=sim.ping(a.id,'192.0.2.2',{count:1,size:1400,timeout:100});sim.advance(.1);const second=sim.ping(b.id,'192.0.2.1',{count:1,size:1400,timeout:100});sim.advance(150);
  assert.equal(first.received,0);assert.equal(second.received,0);assert.ok((a.runtime.counters[g].lateCollisions??0)>(beforeA.lateCollisions??0));assert.equal(b.runtime.counters[g].collisions??0,0);assert.ok((b.runtime.counters[g].crc??0)>(beforeB.crc??0));
  assert.match(ca.execute('show interfaces '+g).join('\n'),/[1-9]\d* late collision/);assert.match(cb.execute('show interfaces '+g).join('\n'),/[1-9]\d* input errors, [1-9]\d* CRC/);assert.ok(sim.events.some(event=>event.label==='Ethernet duplex collision'&&event.disposition==='drop'));assert.match(ca.execute('show interfaces counters errors').join('\n'),/FCS-Err\s+Rcv-Err\s+Xmit-Err/);
  run(ca,'configure terminal','interface '+g,'duplex full','end');const third=sim.ping(a.id,'192.0.2.2',{count:1,size:1400}),fourth=sim.ping(b.id,'192.0.2.1',{count:1,size:1400});sim.advance(100);assert.equal(third.received,1);assert.equal(fourth.received,1);
});
test('both half duplex endpoints arbitrate the shared medium without invented full-duplex collisions', () => {
  const {sim,a,b,ca,cb}=pair();for(const cli of[ca,cb])run(cli,'configure terminal','interface '+g,'speed 10','duplex half','end');sim.advance(10);
  const first=sim.ping(a.id,'192.0.2.2',{count:1,size:1400}),second=sim.ping(b.id,'192.0.2.1',{count:1,size:1400});sim.advance(100);assert.equal(first.received,1);assert.equal(second.received,1);assert.equal(a.runtime.counters[g].collisions??0,0);assert.equal(b.runtime.counters[g].collisions??0,0);
  const left=defaultInterface(g),right=defaultInterface(g);left.duplex='half';assert.equal(negotiateEthernet(left,right).speed,100);assert.equal(negotiateEthernet(left,right).duplex,'half');
});
test('negotiated copper bandwidth is consumed by actual OSPF routes and IOS interface output', () => {
  const {sim,a,b,ca,cb}=pair();
  run(ca,'configure terminal','router ospf 1','auto-cost reference-bandwidth 1000','network 0.0.0.0 255.255.255.255 area 0','end');
  run(cb,'configure terminal','interface '+g,'speed 10','duplex half','interface Loopback0','ip address 198.51.100.2 255.255.255.255','router ospf 1','auto-cost reference-bandwidth 1000','network 0.0.0.0 255.255.255.255 area 0','end');sim.advance(2500);
  assert.equal(sim.ethernetState(a.id,g)?.speed,10);const route=sim.routes(a.id).find(route=>route.protocol==='O'&&route.network==='198.51.100.2');assert.ok(route);assert.equal(route.metric,101);
  assert.match(ca.execute('show interfaces '+g).join('\n'),/BW 10000 Kbit\/sec/);assert.match(ca.execute('show ip ospf interface '+g).join('\n'),/Cost: 100/);
  const ping=sim.ping(a.id,'198.51.100.2',{count:1});sim.advance(100);assert.equal(ping.received,1);
  run(ca,'configure terminal','interface '+g,'bandwidth 100000','end');assert.match(ca.execute('show interfaces '+g).join('\n'),/BW 100000 Kbit\/sec/);assert.equal(sim.ethernetState(a.id,g)?.speed,10,'Administrative bandwidth does not change wire speed');
});
test('EtherChannel compares actual negotiated speed/duplex and shared half-duplex RSTP uses legacy transition timing',()=>{
 const sim=new Simulator(1989),a=sim.addDevice('switch'),b=sim.addDevice('switch'),ca=new IOSSession(sim,a.id),cb=new IOSSession(sim,b.id),pc=sim.addDevice('pc'),server=sim.addDevice('server'),p=(n:number)=>'GigabitEthernet0/'+n;
 for(const[d,ip]of[[pc,'192.0.2.1'],[server,'192.0.2.2']]as const)Object.assign(d.config.interfaces.GigabitEthernet0,{ip,mask:'255.255.255.0'});
 for(const[cli,mode]of[[ca,'active'],[cb,'passive']]as const)run(cli,'enable','configure terminal','spanning-tree mode rapid-pvst','interface range g0/1 - 2','channel-group 1 mode '+mode,'end');run(cb,'configure terminal','interface range g0/1 - 2','speed 1000','duplex full','end');
 for(const n of[1,2])sim.connect({deviceId:a.id,port:p(n)},{deviceId:b.id,port:p(n)});sim.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:a.id,port:p(3)});sim.connect({deviceId:server.id,port:'GigabitEthernet0'},{deviceId:b.id,port:p(3)});sim.advance(1500);assert.equal(a.runtime.features.portChannels[1].activeMembers.length,2);const ping=sim.ping(pc.id,'192.0.2.2',{count:1});sim.advance(100);assert.equal(ping.received,1);
 run(cb,'configure terminal','interface range g0/1 - 2','speed 100','end');run(ca,'configure terminal','interface range g0/1 - 2','duplex full','end');sim.advance(1500);assert.equal(sim.ethernetState(a.id,p(1))?.speed,100);assert.equal(a.runtime.features.portChannels[1].activeMembers.length,2);const slower=sim.ping(pc.id,'192.0.2.2',{count:1});sim.advance(100);assert.equal(slower.received,1);
 const shared=new Simulator(1990),left=shared.addDevice('switch'),right=shared.addDevice('switch'),cl=new IOSSession(shared,left.id),cr=new IOSSession(shared,right.id);for(const cli of[cl,cr])run(cli,'enable','configure terminal','spanning-tree mode rapid-pvst','end');run(cr,'configure terminal','interface g0/1','speed 100','duplex half','end');shared.connect({deviceId:left.id,port:p(1)},{deviceId:right.id,port:p(1)});shared.advance(1500);assert.equal(shared.ethernetState(left.id,p(1))?.duplex,'half');assert.equal(left.runtime.stp[1].ports[p(1)].state,'listening');assert.match(cl.execute('show spanning-tree').join('\n'),/Shr/);shared.advance(30000);assert.equal(left.runtime.stp[1].ports[p(1)].state,'forwarding');
});
test('CDP reports received duplex and diagnoses mismatch only after an actual delivered advertisement',()=>{
 const{sim,a,b,ca,cb}=pair();const link=sim.lab.links[0];link.loss=1;sim.changed();run(ca,'configure terminal','interface '+g,'speed 10','duplex half','end');run(cb,'configure terminal','interface '+g,'speed 10','duplex full','end');sim.advance(5);assert.ok(!sim.events.some(event=>event.label==='Duplex mismatch discovered'),'Lost advertisements cannot diagnose remote state');
 link.loss=0;sim.changed();run(cb,'configure terminal','cdp timer 7','end');sim.advance(5);assert.ok(sim.events.some(event=>event.nodeId===a.id&&event.label==='Duplex mismatch discovered'));assert.match(ca.execute('show cdp neighbors detail').join('\n'),/Duplex: full/);assert.ok(a.runtime.logs.some(line=>line.includes('%CDP-4-DUPLEX_MISMATCH')));
 run(ca,'configure terminal','interface '+g,'duplex full','end');run(cb,'configure terminal','cdp timer 8','end');sim.advance(5);assert.equal(Object.keys(a.runtime.features.cdpDuplexWarnings).length,0);assert.equal(b.runtime.counters[g].collisions??0,0,'Full-duplex ports never acquire collision counters');
});
test('the first delivered LACP partner installs its connected route in the same recompute and unused down members do not suspend it',()=>{
 const sim=new Simulator(1995),a=sim.addDevice('l3switch'),b=sim.addDevice('l3switch');for(const[d,n]of[[a,1],[b,2]]as const){const cli=new IOSSession(sim,d.id);run(cli,'enable','configure terminal','ip routing','interface range g0/1 - 2','no switchport','channel-group 1 mode active','interface Port-channel1','no switchport',`ip address 192.0.2.${n} 255.255.255.0`,'no shutdown','end');}
 const link=sim.connect({deviceId:a.id,port:'GigabitEthernet0/1'},{deviceId:b.id,port:'GigabitEthernet0/1'});sim.advance(100);assert.equal(a.runtime.features.portChannels[1].activeMembers.length,1);assert.ok(sim.routes(a.id).some(route=>route.protocol==='connected'&&route.network==='192.0.2.0'),'No unrelated recompute is required to install the first connected route');const ping=sim.ping(a.id,'192.0.2.2',{count:1});sim.advance(100);assert.equal(ping.received,1);
 sim.disconnect(link.id);assert.ok(!sim.routes(a.id).some(route=>route.network==='192.0.2.0'));sim.connect(link.a,link.b);sim.advance(100);assert.ok(sim.routes(a.id).some(route=>route.network==='192.0.2.0'));const again=sim.ping(a.id,'192.0.2.2',{count:1});sim.advance(100);assert.equal(again.received,1);
});
