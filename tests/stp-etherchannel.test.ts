import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {portIndicator} from '../src/link-indicators.ts';
import {stpPortState} from '../src/stp-ports.ts';
import {renderConfig} from '../src/config-renderer.ts';
import type {Device} from '../src/model.ts';

const g=(n:number)=>'GigabitEthernet0/'+n;
function run(c:IOSSession,...commands:string[]) {
  for(const command of commands)assert.ok(!c.execute(command).some(line=>line.startsWith('%')),command);
}
function configure(s:Simulator,d:Device,...commands:string[]) {
  const c=new IOSSession(s,d.id);run(c,'enable','configure terminal',...commands,'end');return c;
}
function pair(protocol='lacp',mode='rapid-pvst') {
  const s=new Simulator(7010),a=s.addDevice('l3switch'),b=s.addDevice('poeswitch');
  const ca=configure(s,a,'spanning-tree mode '+mode,'spanning-tree vlan 1 priority 0');
  const cb=configure(s,b,'spanning-tree mode '+mode,'spanning-tree vlan 1 priority 8192');
  const wires=[];
  for(const n of [1,2]) {
    for(const [c,group,active] of [[ca,1,true],[cb,2,false]] as const) {
      const channelMode=protocol==='static'?'on':protocol==='pagp'?(active?'desirable':'auto'):(active?'active':'passive');
      run(c,'configure terminal','interface '+g(n),'switchport mode trunk',`channel-group ${group} mode ${channelMode}`,'end');
    }
    wires.push(s.connect({deviceId:a.id,port:g(n)},{deviceId:b.id,port:g(n)}));
  }
  return {s,a,b,ca,cb,wires};
}
function endpoint(s:Simulator,d:Device,n:number,address:string) {
  const pc=s.addDevice('pc'),port=pc.config.interfaces.GigabitEthernet0;
  delete port.features.dhcp;Object.assign(port,{ip:address,mask:'255.255.255.0'});
  configure(s,d,'interface '+g(n),'spanning-tree portfast');
  s.connect({deviceId:pc.id,port:port.name},{deviceId:d.id,port:g(n)});return pc;
}
function ping(s:Simulator,pc:Device,address:string,expected=1) {
  const result=s.ping(pc.id,address,{count:1});s.advance(2000);assert.equal(result.received,expected,JSON.stringify(result.replies));
}

for(const protocol of ['lacp','pagp','static'])test(`${protocol}: STP elects and transmits on one logical aggregate, with real data forwarding`,()=>{
  const {s,a,b,cb}=pair(protocol),pc=endpoint(s,a,3,'192.0.2.10');endpoint(s,b,3,'192.0.2.20');
  const sent:{id:string;port:string;time:number;body:any}[]=[],send=s.sendLinkControl.bind(s);
  s.sendLinkControl=(id,port,message)=>{if(message.protocol==='STP')sent.push({id,port,time:s.clock.now(),body:structuredClone(message.body)});send(id,port,message);};
  s.advance(35000);
  assert.equal(b.runtime.stp['1'].rootId,a.id);assert.equal(b.runtime.stp['1'].rootPort,'Port-channel2');
  assert.equal(b.runtime.stp['1'].cost,3);assert.equal(b.runtime.stp['1'].ports[g(1)],undefined);assert.equal(b.runtime.stp['1'].ports[g(2)],undefined);
  const out=cb.execute('show spanning-tree interface port-channel2').join('\n');
  assert.match(out,/VLAN0001\s+Root\s+FWD\s+3\s+128\.\d+\s+P2p/);assert.doesNotMatch(out,/Gi0\/[12]\s/);
  assert.match(cb.execute('show spanning-tree interface g0/2').join('\n'),/VLAN0001\s+Root\s+FWD\s+3\s+128\.\d+/);
  for(const d of [a,b]) {
    const stable=sent.filter(m=>m.id===d.id&&m.time>=30000&&m.time<35000&&m.body.port.startsWith('Port-channel'));
    assert.ok(stable.length>=2&&stable.length<=3,`one BPDU heartbeat per bundle: ${stable.length}`);
    assert.equal(new Set(stable.map(m=>m.port)).size,1);
    assert.equal(new Set(stable.map(m=>m.body.vlans[0].portId)).size,1);
  }
  assert.equal(stpPortState(b,g(1),1),stpPortState(b,g(2),1));ping(s,pc,'192.0.2.20');
});

test('logical path cost and per-VLAN overrides are operational and survive serialization',()=>{
  const {s,a,b,cb}=pair();for(const d of [a,b])configure(s,d,'vlan 20','exit');s.advance(5000);
  run(cb,'configure terminal','interface port-channel2','spanning-tree cost 100','spanning-tree port-priority 64','spanning-tree vlan 20 cost 17','spanning-tree vlan 20 port-priority 32','end');s.advance(3000);
  assert.equal(b.runtime.stp['1'].cost,100);assert.equal(b.runtime.stp['20'].cost,17);
  assert.match(cb.execute('show spanning-tree vlan 1 interface po2').join('\n'),/VLAN0001\s+Root\s+FWD\s+100\s+64\./);
  assert.match(cb.execute('show spanning-tree vlan 20 interface po2').join('\n'),/VLAN0020\s+Root\s+FWD\s+17\s+32\./);
  const summary=cb.execute('show spanning-tree vlan 1 summary').at(-1)!.trim().split(/\s+/);
  assert.equal(Number(summary.at(-1)),Object.values(b.runtime.stp['1'].ports).filter(p=>p.state!=='disabled').length);
  assert.match(renderConfig(b).join('\n'),/interface Port-channel2[\s\S]*spanning-tree cost 100/);
  const loaded=new Simulator();loaded.load(s.serialize());loaded.advance(5000);assert.equal(loaded.getDevice(b.id)!.runtime.stp['1'].cost,100);
  run(cb,'configure terminal','interface po2','no spanning-tree cost','no spanning-tree vlan 20 cost','end');s.advance(3000);
  assert.equal(b.runtime.stp['1'].cost,3);assert.equal(b.runtime.stp['20'].cost,3);
});

test('MST consumes logical per-instance cost/priority and displays one Po row',()=>{
  const {s,a,b,cb}=pair('lacp','mst');
  for(const d of [a,b])configure(s,d,'vlan 20','exit','spanning-tree mst configuration','name LAB','revision 1','instance 2 vlan 20','exit',`spanning-tree mst 2 priority ${d===a?0:8192}`);
  configure(s,b,'interface po2','spanning-tree mst 2 cost 77','spanning-tree mst 2 port-priority 16');s.advance(35000);
  assert.equal(b.runtime.stp['20'].rootId,a.id);assert.equal(b.runtime.stp['20'].cost,77);
  const out=cb.execute('show spanning-tree mst 2 interface po2 detail').join('\n');assert.match(out,/Port-channel2 of MST2 is root forwarding/);assert.match(out,/Port info\s+port id\s+16\.\d+\s+priority\s+16\s+cost\s+77/);assert.doesNotMatch(out,/Gi0\/[12]\s/);
});

test('member failure retains the logical port/BPDU identity, recalculates automatic cost, and preserves manual cost',()=>{
  const {s,a,b,cb,wires}=pair(),pc=endpoint(s,a,3,'192.0.2.10');endpoint(s,b,3,'192.0.2.20');s.advance(5000);
  const number=b.runtime.stp['1'].ports['Port-channel2'].portNumber;
  s.disconnect(wires[0].id);s.advance(100);
  assert.equal(b.runtime.stp['1'].rootId,a.id);assert.equal(b.runtime.stp['1'].rootPort,'Port-channel2');assert.equal(b.runtime.stp['1'].cost,4);
  assert.equal(b.runtime.stp['1'].ports['Port-channel2'].portNumber,number);assert.equal(b.runtime.stp['1'].ports['Port-channel2'].state,'forwarding');ping(s,pc,'192.0.2.20');
  run(cb,'configure terminal','interface po2','spanning-tree cost 100','end');
  s.connect({deviceId:a.id,port:g(1)},{deviceId:b.id,port:g(1)});s.advance(3000);assert.equal(b.runtime.stp['1'].cost,100);
  s.disconnect(wires[1].id);s.advance(100);assert.equal(b.runtime.stp['1'].cost,100);ping(s,pc,'192.0.2.20');
});

test('long costs follow active aggregate bandwidth, and Port-channel shutdown gates every member',()=>{
  const {s,a,b,cb,wires}=pair(),pc=endpoint(s,a,3,'192.0.2.10');endpoint(s,b,3,'192.0.2.20');
  configure(s,b,'spanning-tree pathcost method long');s.advance(5000);assert.equal(b.runtime.stp['1'].cost,10000);
  s.disconnect(wires[0].id);s.advance(100);assert.equal(b.runtime.stp['1'].cost,20000);
  run(cb,'configure terminal','interface po2','shutdown','end');s.advance(100);assert.equal(s.interfaceUp(b.id,'Port-channel2'),false);ping(s,pc,'192.0.2.20',0);
  assert.equal(b.runtime.features.portChannels[2].state,'down');assert.deepEqual(b.runtime.features.portChannels[2].activeMembers,[]);assert.match(cb.execute('show etherchannel summary').join('\n'),/Po2\(SD\)/);
  run(cb,'configure terminal','interface po2','no shutdown','end');s.advance(5000);ping(s,pc,'192.0.2.20');
});

test('redundant bundle blocks as one segment, shows both cables blocked, and forwards after uplink failure',()=>{
  const {s,a:b,b:c,ca,cb,wires}=pair(),root=s.addDevice('switch');
  configure(s,b,'spanning-tree vlan 1 priority 4096');configure(s,root,'spanning-tree vlan 1 priority 0','interface '+g(1),'switchport mode trunk','exit','interface '+g(2),'switchport mode trunk');
  for(const d of [b,c])configure(s,d,'interface '+g(3),'switchport mode trunk');
  s.connect({deviceId:root.id,port:g(1)},{deviceId:b.id,port:g(3)});const uplink=s.connect({deviceId:root.id,port:g(2)},{deviceId:c.id,port:g(3)});
  const pc=endpoint(s,b,4,'192.0.2.10');endpoint(s,c,4,'192.0.2.20');s.advance(35000);
  assert.equal(c.runtime.stp['1'].ports['Port-channel2'].role,'alternate');assert.equal(c.runtime.stp['1'].ports['Port-channel2'].state,'blocking');
  assert.match(cb.execute('show spanning-tree blockedports').join('\n'),/VLAN0001\s+Po2\n\nNumber of blocked ports \(segments\) in the system : 1/);
  for(const [i,wire] of wires.entries())assert.equal(portIndicator(s,c,g(i+1),wire).state,'blocked');
  s.events=[];ping(s,pc,'192.0.2.20');assert.ok(!s.events.some(e=>e.nodeId===c.id&&[g(1),g(2)].includes(e.port??'')&&e.protocol==='ICMP'&&e.label==='Frame sent'));
  s.disconnect(uplink.id);s.advance(10000);
  assert.equal(c.runtime.stp['1'].rootId,root.id);assert.equal(c.runtime.stp['1'].rootPort,'Port-channel2');assert.equal(c.runtime.stp['1'].cost,7);
  assert.match(cb.execute('show spanning-tree interface po2').join('\n'),/VLAN0001\s+Root\s+FWD\s+3/);ping(s,pc,'192.0.2.20');
  assert.match(ca.execute('show spanning-tree interface po1').join('\n'),/VLAN0001\s+Desg\s+FWD/);
});

test('logical root guard and loop guard block the whole bundle, with BPDU recovery',()=>{
  const {s,a,b,cb}=pair(),pc=endpoint(s,a,3,'192.0.2.10');endpoint(s,b,3,'192.0.2.20');s.advance(5000);
  run(cb,'configure terminal','interface po2','spanning-tree guard root','end');s.advance(100);
  assert.equal(b.runtime.stp['1'].ports['Port-channel2'].role,'root-inconsistent');assert.equal(b.runtime.stp['1'].rootId,b.id);
  ping(s,pc,'192.0.2.20',0);
  run(cb,'configure terminal','interface po2','spanning-tree guard loop','end');s.advance(3000);
  assert.equal(b.runtime.stp['1'].rootId,a.id);
  const send=s.sendLinkControl.bind(s);let lose=true;
  s.sendLinkControl=(id,port,message)=>{if(lose&&id===a.id&&message.protocol==='STP')return;send(id,port,message);};
  s.advance(7000);assert.equal(b.runtime.stp['1'].ports['Port-channel2'].role,'loop-inconsistent');
  assert.match(cb.execute('show spanning-tree inconsistentports').join('\n'),/VLAN0001\s+Port-channel2\s+Loop Inconsistent/);
  ping(s,pc,'192.0.2.20',0);
  lose=false;s.advance(3000);assert.equal(b.runtime.stp['1'].ports['Port-channel2'].state,'forwarding');assert.equal(b.runtime.stp['1'].rootId,a.id);ping(s,pc,'192.0.2.20');
});

test('BPDU guard configured on a logical channel error-disables all active members',()=>{
  const {s,b}=pair();configure(s,b,'interface po2','spanning-tree bpduguard enable');s.advance(3000);
  assert.equal(s.interfaceUp(b.id,'Port-channel2'),false);
  for(const name of [g(1),g(2),'Port-channel2'])assert.equal(b.runtime.features.errdisableCauses[name],'bpduguard');
});

test('classic PVST keeps one logical P2p port and observes forward-delay timers',()=>{
  const {s,b,cb}=pair('static','pvst');s.advance(5000);assert.notEqual(b.runtime.stp['1'].ports['Port-channel2'].state,'forwarding');
  s.advance(35000);assert.match(cb.execute('show spanning-tree interface po2').join('\n'),/VLAN0001\s+Root\s+FWD\s+3\s+128\.\d+\s+P2p/);
});

test('cost and advertised logical port priority select between parallel bundles',()=>{
  const {s,a,b,ca,cb}=pair();
  for(const n of [3,4]) {
    for(const [c,group] of [[ca,3],[cb,4]] as const)run(c,'configure terminal','interface '+g(n),'switchport mode trunk',`channel-group ${group} mode active`,'end');
    s.connect({deviceId:a.id,port:g(n)},{deviceId:b.id,port:g(n)});
  }
  s.advance(5000);assert.equal(b.runtime.stp['1'].rootPort,'Port-channel2');
  run(ca,'configure terminal','interface po3','spanning-tree port-priority 16','end');s.advance(3000);assert.equal(b.runtime.stp['1'].rootPort,'Port-channel4');
  run(cb,'configure terminal','interface po4','spanning-tree cost 100','end');s.advance(3000);assert.equal(b.runtime.stp['1'].rootPort,'Port-channel2');
  run(cb,'configure terminal','interface '+g(1),'spanning-tree cost 1000','end');s.advance(3000);assert.equal(b.runtime.stp['1'].cost,3,'member-only cost must not override the logical interface');
});

test('unnegotiated members cannot transmit STP or leak user traffic',()=>{
  const {s,a,b,ca}=pair(),pc=endpoint(s,a,3,'192.0.2.10');endpoint(s,b,3,'192.0.2.20');
  for(const n of [1,2])run(ca,'configure terminal','interface '+g(n),'channel-group 1 mode passive','end');
  const send=s.sendLinkControl.bind(s),stp:string[]=[];
  s.sendLinkControl=(id,port,message)=>{if(message.protocol==='STP'&&[g(1),g(2)].includes(port))stp.push(id+'|'+port);send(id,port,message);};
  s.advance(5000);assert.equal(a.runtime.features.portChannels[1].state,'down');assert.equal(b.runtime.features.portChannels[2].state,'down');
  assert.deepEqual(stp,[]);assert.equal(b.runtime.stp['1'].rootId,b.id);ping(s,pc,'192.0.2.20',0);
});

test('MST bridge priorities elect each instance and roundtrip through configuration with working help',()=>{
  const {s,a,b,ca,cb}=pair('lacp','mst');
  for(const d of [a,b])configure(s,d,'vlan 20','exit','spanning-tree mst configuration','name LAB','instance 2 vlan 20','exit');
  configure(s,a,'spanning-tree mst 0 priority 0','spanning-tree mst 2 priority 8192');
  configure(s,b,'spanning-tree mst 0 priority 8192','spanning-tree mst 2 priority 0');s.advance(5000);
  assert.equal(b.runtime.stp['1'].rootId,a.id);assert.equal(a.runtime.stp['20'].rootId,b.id);
  assert.match(ca.execute('show spanning-tree mst 2').join('\n'),/Po1\s+Root/);
  run(cb,'configure terminal');assert.match(cb.help('spanning-tree mst 2 ').join('\n'),/priority/);assert.equal(cb.complete('spanning-tree mst 2 pri'),'spanning-tree mst 2 priority ');
  assert.match(cb.execute('spanning-tree mst 2 priority 7').join('\n'),/multiple of 4096/);assert.equal(b.config.features.stp.mst.priorities[2],0);
  const copy=s.addDevice('l3switch'),cc=new IOSSession(s,copy.id);copy.config.features.files={stp:renderConfig(b).join('\n')};run(cc,'enable','copy flash:stp running-config');assert.deepEqual(copy.config.features.stp.mst.priorities,b.config.features.stp.mst.priorities);
  run(cb,'no spanning-tree mst 2 priority','end');s.advance(3000);assert.equal(a.runtime.stp['20'].rootId,a.id);
});

test('access PortFast defaults do not enable edge BPDU guard on a member-carried trunk',()=>{
  const {s,a,b}=pair();
  for(const d of [a,b])configure(s,d,'spanning-tree portfast default','spanning-tree portfast bpduguard default');
  s.advance(5000);assert.equal(b.runtime.stp['1'].rootId,a.id);assert.equal(b.runtime.stp['1'].ports['Port-channel2'].edge,false);
  assert.equal(s.interfaceUp(b.id,'Port-channel2'),true);assert.equal(b.config.interfaces['Port-channel2'].features.errDisabled,undefined);
});

test('removing a member restores a separate STP port without stale logical membership',()=>{
  const {s,a,b,ca,cb}=pair();s.advance(5000);
  for(const c of [ca,cb])run(c,'configure terminal','interface '+g(1),`no channel-group ${c===ca?1:2}`,'end');
  s.advance(35000);assert.equal(b.runtime.stp['1'].rootId,a.id);
  assert.ok(b.runtime.stp['1'].ports[g(1)]);assert.ok(b.runtime.stp['1'].ports['Port-channel2']);
  assert.equal(b.runtime.stp['1'].ports['Port-channel2'].cost,4);assert.equal(b.runtime.stp['1'].ports[g(2)],undefined);
  assert.notEqual(stpPortState(b,g(1),1),stpPortState(b,g(2),1));
});

test('changing the aggregate peer cannot reuse the old peer’s received root',()=>{
  const {s,a,b,wires}=pair(),other=s.addDevice('switch');
  configure(s,other,'spanning-tree vlan 1 priority 16384');
  for(const n of [1,2])configure(s,other,'interface '+g(n),'switchport mode trunk','channel-group 3 mode active');
  s.advance(5000);assert.equal(b.runtime.stp['1'].rootId,a.id);
  const send=s.sendLinkControl.bind(s);s.sendLinkControl=(id,port,message)=>{if(message.protocol!=='STP')send(id,port,message);};
  for(const wire of wires)s.disconnect(wire.id);
  for(const n of [1,2])s.connect({deviceId:b.id,port:g(n)},{deviceId:other.id,port:g(n)});
  s.advance(1000);assert.equal(b.runtime.features.portChannels[2].peerDeviceId,other.id);assert.equal(b.runtime.stp['1'].rootId,b.id);
});

for(const [speed,cost,single]of [[10,56,100],[100,12,19]] as const)test(`${speed} Mb/s: classic bundle cost follows negotiated bandwidth and member failure`,()=>{
  const {s,a,b,wires}=pair();
  for(const d of [a,b])for(const n of [1,2])configure(s,d,'interface '+g(n),'speed '+speed,'duplex full');
  s.advance(35000);assert.equal(b.runtime.stp['1'].rootId,a.id);assert.equal(b.runtime.stp['1'].cost,cost);
  s.disconnect(wires[0].id);s.advance(1000);assert.equal(b.runtime.stp['1'].cost,single);assert.equal(b.runtime.stp['1'].rootPort,'Port-channel2');
});
