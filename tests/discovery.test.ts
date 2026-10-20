import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
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
