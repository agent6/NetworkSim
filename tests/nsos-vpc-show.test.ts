import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {renderNSOSConfig} from '../src/nsos-config.ts';
import {iosRejected} from '../src/ios-help.ts';
import {nsosConfig,vpcRuntime} from '../src/datacenter.ts';
import {datacenterTopology as topology,advanceSimulation as advance} from './helpers/datacenter.ts';
function run(c:NSOSSession,...commands:string[]){for(const command of commands)assert.ok(!c.execute(command).some(iosRejected),command);}
const show=(c:NSOSSession,command:string)=>c.execute(command).join('\n');

test('vPC summary distinguishes global, member and type-2 consistency and retains the last check after peer-link loss',()=>{
  const {s,a,b,peerLinks}=topology(),c=new NSOSSession(s,b.id,{skipConsoleLogin:true});
  assert.match(show(c,'show vpc'),/Peer status\s+: peer adjacency formed ok/);
  assert.match(show(c,'show vpc'),/^10\s+Po20\s+up\s+success\s+success\s+1,20/m);
  run(c,'conf t','interface po20','spanning-tree port type normal','end');advance(s,4000);
  assert.match(show(c,'show vpc'),/Configuration consistency status\s+: success/);
  assert.match(show(c,'show vpc'),/^10\s+Po20\s+down\*\s+failed\s+vPC type-1/m);
  assert.match(show(c,'show vpc consistency-parameters interface po 20'),/STP Port Type\s+1\s+Normal Port\s+Default/);
  run(c,'conf t','interface po20','no spanning-tree port type','end');advance(s,4000);
  for(const link of peerLinks)s.disconnect(link.id);advance(s,10000);
  assert.equal(vpcRuntime(a)!.members[10].up,true);assert.equal(vpcRuntime(b)!.members[10].up,false);
  assert.match(show(c,'show vpc'),/Peer status\s+: peer link is down/);
  assert.match(show(c,'show vpc'),/Configuration consistency status\s+: success/);
  assert.match(show(c,'show vpc'),/^10\s+Po20\s+down\s+failed\s+Peer-link is down/m);
});

test('vPC consistency interface selectors, scoped configuration, role and orphan views report received and local state',()=>{
  const {s,a,b}=topology(),c=new NSOSSession(s,a.id,{skipConsoleLogin:true});
  for(const command of ['show vpc consistency-parameters vpc 10','show vpc consistency-parameters interface port-channel10','show vpc consistency-parameters interface po 10']){
    const output=show(c,command);assert.match(output,/STP Port Type\s+1\s+Default\s+Default/);assert.match(output,/Allowed VLANs\s+-\s+1,20,30\s+1,20,30/);
  }
  const config=show(c,'show running-config vpc');assert.match(config,/feature vpc/);assert.match(config,/vpc domain 42/);assert.match(config,/interface port-channel10\n  vpc 10/);assert.doesNotMatch(config,/switchport|username|spanning-tree/);
  assert.match(show(c,'show vpc role'),/vPC peer role-priority\s+: 200/);
  // A peer configuration edit cannot appear in the local view before a CFS packet arrives.
  nsosConfig(b).vpc!.rolePriority=555;s.changed();assert.doesNotMatch(show(c,'show vpc role'),/: 555/);advance(s,2000);assert.match(show(c,'show vpc role'),/vPC peer role-priority\s+: 555/);
  assert.match(show(c,'show vpc orphan-ports'),/^20\s+Eth1\/2/m);
  assert.doesNotMatch(show(c,'show vpc orphan-ports'),/Eth1\/29|Po10/);
  assert.match(show(c,'show port-channel summary'),/^1\s+Po1\(SU\)\s+Eth\s+LACP\s+Eth1\/29\(P\) Eth1\/30\(P\)/m);
  assert.match(show(c,'show vpc peer-keepalive'),/--Keepalive tos\s+: 192/);
  s.disconnect(s.linkAt(a.id,'mgmt0')!.id);advance(s,6000);assert.match(show(c,'show vpc peer-keepalive'),/--Receive status\s+: Failed/);
});

test('native L2 MTU constraints and implicit peer-link jumbo profile preserve configuration replay',()=>{
  const sim=new Simulator(),d=sim.addDevice('datacenter'),c=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
  run(c,'conf t','feature vpc','feature lacp','vpc domain 1','interface po1','switchport mode trunk','vpc peer-link','interface e1/1-2','switchport mode trunk','channel-group 1 mode active','no shutdown','end');
  for(const port of ['Port-channel1','Ethernet1/1','Ethernet1/2']){
    assert.match(show(c,'show interface '+port),/MTU 9216 bytes/);assert.equal(d.config.interfaces[port].mtu,1500);
  }
  run(c,'conf t','interface e1/3');const before=JSON.stringify(d.config);
  const error=c.execute('mtu 1600');assert.deepEqual(error,['ERROR: MTU can only be default or system jumbo MTU']);assert.ok(error.some(iosRejected));assert.equal(JSON.stringify(d.config),before);
  run(c,'mtu 9216','interface e1/4','no switchport','mtu 1600','end');assert.match(show(c,'show interface e1/4'),/MTU 1600 bytes/);
  const rendered=renderNSOSConfig(d).join('\n'),other=sim.addDevice('datacenter'),replay=new NSOSSession(sim,other.id,{skipConsoleLogin:true});other.config.features.files={saved:rendered};run(replay,'copy bootflash:saved running-config');assert.equal(renderNSOSConfig(other).join('\n'),rendered);
  d.config.features.files={bad:'interface Ethernet1/3\nmtu 1600\ndescription should-not-apply'};
  const description=d.config.interfaces['Ethernet1/3'].description;
  assert.ok(c.execute('copy bootflash:bad running-config').some(iosRejected));assert.equal(d.config.interfaces['Ethernet1/3'].description,description);
});

test('keepalive detail distinguishes a missing route in its VRF from a reachable subnet with no received peer messages',()=>{
  const {s,a,b}=topology(),c=new NSOSSession(s,a.id,{skipConsoleLogin:true});
  run(c,'conf t','vpc domain 42','peer-keepalive destination 10.255.0.2 source 10.255.0.1 vrf default','end');
  const output=show(c,'show vpc peer-keepalive');
  assert.match(output,/vPC keep-alive status\s+: Suspended \(Destination IP not reachable\)/);
  assert.match(output,/--Receive status\s+: Failed/);assert.match(output,/Keepalive vrf\s+: default/);
  assert.doesNotMatch(output,/--Last update from peer/);
  run(c,'conf t','vpc domain 42','peer-keepalive destination 10.255.0.2 source 10.255.0.1 vrf management','end');advance(s,2000);
  assert.match(show(c,'show vpc peer-keepalive'),/vPC keep-alive status\s+: peer is alive/);
  delete nsosConfig(b).vpc!.keepalive;s.changed();advance(s,6000);
  const timedOut=show(c,'show vpc peer-keepalive');
  assert.match(timedOut,/vPC keep-alive status\s+: peer is not reachable through peer-keepalive/);
  assert.match(timedOut,/--Receive status\s+: Failed/);assert.doesNotMatch(timedOut,/Suspended/);
  assert.equal(vpcRuntime(a)!.adjacency,true);
});
