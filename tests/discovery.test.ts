import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import {bridgeMac} from '../src/control-plane.ts';
import { renderConfig } from '../src/config-renderer.ts';
function command(cli:IOSSession,...commands:string[]){for(const line of commands){const out=cli.execute(line);assert.ok(!out.some(x=>x.startsWith('%')),`${line}: ${out.join('\n')}`);}}
function pair(){const engine=new Simulator(410),a=engine.addDevice('router'),b=engine.addDevice('router'),ca=new IOSSession(engine,a.id),cb=new IOSSession(engine,b.id),port='GigabitEthernet0/0';for(const[cli,address]of [[ca,'10.0.0.1'],[cb,'10.0.0.2']]as const)command(cli,'enable','configure terminal','cdp timer 5','cdp holdtime 12','lldp run','lldp timer 5','lldp holdtime 12','interface g0/0',`ip address ${address} 255.255.255.0`,'description connected neighbor','no shutdown','end');const wire=engine.connect({deviceId:a.id,port},{deviceId:b.id,port});return {engine,a,b,ca,cb,wire,port};}

test('CDP and LLDP discover only received physical advertisements and expire under directional loss',()=>{
  const {engine,a,b,ca,wire}=pair();assert.equal(a.runtime.neighbors.filter(n=>['CDP','LLDP'].includes(n.protocol)).length,0);engine.clock.advance(10);
  assert.equal(a.runtime.neighbors.filter(n=>['CDP','LLDP'].includes(n.protocol)).length,2);assert.equal(b.runtime.neighbors.filter(n=>['CDP','LLDP'].includes(n.protocol)).length,2);assert.match(ca.execute('show cdp neighbors detail').join('\n'),/Device ID: [\s\S]*IP address: 10\.0\.0\.2/);assert.match(ca.execute('show lldp neighbors detail').join('\n'),/Port Description: connected neighbor/);assert.match(ca.execute('show lldp neighbors').join('\n'),/Hold-time/);
  wire.lossAB=1;engine.clock.advance(13000);assert.equal(b.runtime.neighbors.filter(n=>['CDP','LLDP'].includes(n.protocol)).length,0);assert.equal(a.runtime.neighbors.filter(n=>['CDP','LLDP'].includes(n.protocol)).length,2);assert.ok(engine.events.some(e=>e.label==='Neighbor expired'&&e.nodeId===b.id));
  wire.lossAB=0;engine.clock.advance(5000);assert.equal(b.runtime.neighbors.filter(n=>['CDP','LLDP'].includes(n.protocol)).length,2);
});

test('per-interface discovery direction controls and timers persist in rendered configuration',()=>{
  const {engine,a,b,ca,cb}=pair();engine.clock.advance(10);command(ca,'configure terminal','interface g0/0','no cdp enable','no lldp transmit','end');engine.clock.advance(13000);
  assert.ok(!b.runtime.neighbors.some(n=>['CDP','LLDP'].includes(n.protocol)));assert.ok(a.runtime.neighbors.some(n=>n.protocol==='LLDP'));assert.ok(!a.runtime.neighbors.some(n=>n.protocol==='CDP'));
  command(ca,'configure terminal','interface g0/0','no lldp receive','end');assert.ok(!a.runtime.neighbors.some(n=>n.protocol==='LLDP'));
  const d=engine.addDevice('router'),cli=new IOSSession(engine,d.id);d.config.features.files={snapshot:renderConfig(a).join('\n')};command(cli,'enable','copy flash:snapshot running-config');assert.deepEqual(d.config.features.discovery,a.config.features.discovery);for(const key of ['cdp','lldpTransmit','lldpReceive'])assert.equal(d.config.interfaces['GigabitEthernet0/0'].features[key],a.config.interfaces['GigabitEthernet0/0'].features[key]);
  command(cb,'write memory');engine.power(b.id,false);engine.power(b.id,true);engine.clock.advance(20);assert.equal(b.runtime.features.discoveryNeighbors&&Object.keys(b.runtime.features.discoveryNeighbors).length,0);
});

test('discovery messages terminate on the physical link even before STP forwarding',()=>{
  const engine=new Simulator(411),a=engine.addDevice('router'),sw=engine.addDevice('switch'),b=engine.addDevice('router'),ca=new IOSSession(engine,a.id),cb=new IOSSession(engine,b.id);for(const cli of[ca,cb])command(cli,'enable','configure terminal','interface g0/0','no shutdown','end');engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:sw.id,port:'GigabitEthernet0/1'});engine.connect({deviceId:b.id,port:'GigabitEthernet0/0'},{deviceId:sw.id,port:'GigabitEthernet0/2'});engine.clock.advance(10);assert.ok(a.runtime.neighbors.some(n=>n.protocol==='CDP'&&n.deviceId===sw.id));assert.ok(!a.runtime.neighbors.some(n=>n.protocol==='CDP'&&n.deviceId===b.id));
});

test('discovery detail preserves the last received MAC, addresses and description under directional loss',()=>{
  const {engine,a,b,ca,cb,wire,port}=pair();
  command(cb,'configure terminal','ipv6 unicast-routing','interface g0/0','ipv6 address 2001:db8:1::2/64','end');engine.advance(20);
  const received=a.runtime.neighbors.find(n=>n.protocol==='LLDP')!;
  const cached=received.chassisMac;assert.equal(cached,bridgeMac(b).match(/.{2}/g)!.join(':'));assert.equal(received.portMac,engine.macOf(b.id,port));
  assert.match(ca.execute('show lldp neighbors detail').join('\n'),/IPV6: 2001:DB8:1::2/);
  wire.lossBA=1;
  command(cb,'configure terminal','hostname CHANGED','interface g0/0','mac-address 0200.0000.9999','ip address 10.0.0.22 255.255.255.0','description changed without reception','end');engine.advance(1000);
  const output=ca.execute('show lldp neighbors detail').join('\n');
  assert.ok(output.includes(cached.replaceAll(':','').match(/.{4}/g)!.join('.')));
  assert.match(output,/IP: 10\.0\.0\.2\b/);assert.match(output,/Port Description: connected neighbor/);
  assert.doesNotMatch(output,/CHANGED|0200\.0000\.9999|10\.0\.0\.22|changed without reception/);
  const cdp=ca.execute('show cdp neighbors detail').join('\n');assert.match(cdp,/IPv6 address: 2001:DB8:1::2/);assert.doesNotMatch(cdp,/CHANGED|10\.0\.0\.22/);
  wire.lossBA=0;engine.advance(5000);
  assert.match(ca.execute('show lldp neighbors detail').join('\n'),/changed without reception/);
  assert.equal(a.runtime.neighbors.find(n=>n.protocol==='LLDP')!.portMac,'02:00:00:00:99:99');
  assert.equal(a.runtime.neighbors.find(n=>n.protocol==='LLDP')!.chassisMac,cached);
});

test('discovery advertises SVI management, native VLAN, VTP and enabled routing as received TLVs',()=>{
 const engine=new Simulator(415),r=engine.addDevice('router'),sw=engine.addDevice('l3switch'),rc=new IOSSession(engine,r.id),sc=new IOSSession(engine,sw.id);
 command(rc,'enable','conf t','lldp run','lldp timer 5','interface g0/0','no shutdown','end');
 command(sc,'enable','conf t','lldp run','lldp timer 5','cdp timer 5','vlan 10','exit','vtp domain CAMPUS','interface g0/1','switchport mode access','switchport access vlan 10','interface Vlan10','ip address 10.10.10.4 255.255.255.0','no shutdown','end');
 const wire=engine.connect({deviceId:r.id,port:'GigabitEthernet0/0'},{deviceId:sw.id,port:'GigabitEthernet0/1'});engine.advance(45000);
 const cdp=rc.execute('show cdp neighbors detail').join('\n'),lldp=rc.execute('show lldp neighbors detail').join('\n');
 assert.match(cdp,/Management address\(es\):[\s\S]*IP address: 10\.10\.10\.4/);assert.match(cdp,/Native VLAN: 10/);assert.match(cdp,/VTP Management Domain: 'CAMPUS'/);
 assert.match(lldp,/Management Addresses:[\s\S]*IP: 10\.10\.10\.4/);assert.match(lldp,/Enabled Capabilities: B\b/);
 wire.lossBA=1;command(sc,'conf t','ip routing','vtp domain CHANGED','interface Vlan10','ip address 10.10.10.44 255.255.255.0','end');engine.advance(1000);
 assert.doesNotMatch(rc.execute('show cdp neighbors detail').join('\n'),/CHANGED|10\.10\.10\.44/);assert.match(rc.execute('show lldp neighbors detail').join('\n'),/Enabled Capabilities: B\b/);
 wire.lossBA=0;engine.advance(6000);assert.match(rc.execute('show cdp neighbors detail').join('\n'),/CHANGED|10\.10\.10\.44/);assert.match(rc.execute('show lldp neighbors detail').join('\n'),/Enabled Capabilities: B,R/);
});
