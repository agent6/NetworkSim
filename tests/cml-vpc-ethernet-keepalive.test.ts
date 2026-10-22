import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {replayScenario} from '../scripts/cml/replay.ts';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {parseLabFile} from '../src/persistence.ts';
import {nsosConfig,vpcRuntime} from '../src/datacenter.ts';
import {iosRejected} from '../src/ios-help.ts';

test('reviewed native contracts retain exact scenario provenance, negative CLI cases and packet evidence',()=>{
 const fixture=JSON.parse(readFileSync('scripts/cml/fixtures/nxos-vpc-ethernet-keepalive-observations.json','utf8'));
 const source=readFileSync('scripts/cml/scenarios/nxos-vpc-ethernet-keepalive.json'),spec=JSON.parse(source.toString());
 const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
 assert.equal(fixture.status,'validated-selected-contracts');assert.equal(fixture.images.nxosVersion,'10.6(2)');
 assert.equal(fixture.scenarioSha256,digest(source));assert.match(fixture.captureSha256,/^[0-9a-f]{64}$/);
 assert.equal(fixture.baseline,'running-owned-lab-after-expectation-failure');assert.equal(fixture.labStopped,true);assert.deepEqual(fixture.cleanupErrors,[]);
 assert.equal(fixture.steps.length,68);assert.equal(fixture.observations.length,8);
 for(const [i,row] of fixture.steps.entries()){
  const expected=spec.steps[i];assert.equal(row.id,expected.id);assert.equal(row.command,expected.command);assert.equal(row.node,expected.node);
  assert.equal(row.passed,true);assert.equal(row.timedOut,false);assert.equal(row.rawSha256,digest(row.raw));
  for(const pattern of expected.expect??[])assert.match(row.raw,new RegExp(pattern,'m'));
  for(const pattern of expected.absent??[])assert.doesNotMatch(row.raw,new RegExp(pattern,'m'));
 }
 assert.ok(fixture.observations.every((o:any)=>o.accepted&&!o.timedOut&&o.rawSha256===digest(o.raw)));
 const extra=fixture.supplementaryObservations;
 assert.ok(extra.every((o:any)=>!o.timedOut&&o.rawSha256===digest(o.raw)));
 assert.ok(extra.some((o:any)=>o.command==='show interface port-channel100'&&/admin state is up/.test(o.raw)));
 assert.ok(extra.some((o:any)=>o.command==='show interface port-channel101'&&/admin state is up/.test(o.raw)));
 assert.ok(extra.some((o:any)=>o.command==='no switchport'&&!o.accepted&&/Invalid command/.test(o.raw)));
 assert.ok(extra.some((o:any)=>o.command==='no switchport'&&o.accepted&&/config-if-range/.test(o.raw)));
 assert.ok(extra.some((o:any)=>o.command==='switchport'&&!o.accepted&&/port already in a port-channel/.test(o.raw)));
 const defaults=extra.filter((o:any)=>o.job==='10-physical-defaults.json'&&o.command==='show interface Ethernet1/4');
 assert.deepEqual(defaults.map((o:any)=>/admin state is up/.test(o.raw)),[true,false,true]);
 const explicit=extra.filter((o:any)=>o.job==='11-explicit-admin.json'&&o.command==='show interface Ethernet1/4');
 assert.deepEqual(explicit.map((o:any)=>/admin state is up/.test(o.raw)),[false,true,true]);
 assert.equal(fixture.captureEvidence.length,3);assert.ok(fixture.captureEvidence.every((c:any)=>c.bytes>24&&c.protocolCounts.packets>0&&/^[0-9a-f]{64}$/.test(c.sha256)));
 assert.ok(fixture.captureEvidence.some((c:any)=>c.keepaliveTosTtl.some((k:any)=>k.tos===192&&k.ttl===64&&k.count>0)));
 assert.ok(fixture.retainedExpectations.some((a:any)=>a.failedStep==='eth-ka-023'&&/Incomplete command/.test(a.observation.raw)));
 for(const attempt of fixture.retainedExpectations)assert.equal(attempt.observation.accepted,attempt.observation.command.startsWith('show '));
 assert.ok(fixture.boundaries.some((line:string)=>/remains unresolved/.test(line)));
});

test('the Ethernet keepalive scenario replays VRF failure, repair, bundled-port reapplication and named VRF migration',()=>{
 const source=readFileSync('scripts/cml/scenarios/nxos-vpc-ethernet-keepalive.json'),spec=JSON.parse(source.toString());
 const result=replayScenario(spec,createHash('sha256').update(source).digest('hex'));
 assert.equal(result.status,'replayed',JSON.stringify(result.steps.at(-1)));
 assert.equal(result.steps.length,68);assert.ok(result.steps.every(s=>s.passed));
 assert.equal(result.observations.length,8);assert.ok(result.observations.every(o=>o.accepted));
 assert.ok(result.events.some(e=>e.packet?.destinationPort===3200&&e.packet.dscp===48));
 for(const node of spec.nodes){
  assert.deepEqual(node.portMap,{'Ethernet1/1':'Ethernet1/27','Ethernet1/2':'Ethernet1/28','Ethernet1/3':'Ethernet1/29'});
 }
});

test('the offline two-node lab forms without downstream vPC members, but a fresh pair cannot bypass the keepalive VRF',()=>{
 const lab=parseLabFile(readFileSync('examples/datacenter-vpc-ethernet-keepalive.netsim.yaml','utf8'));
 for(const wrongVRF of [false,true]){
  const sim=new Simulator();sim.load(structuredClone(lab));
  assert.equal(sim.lab.devices.length,2);assert.equal(sim.lab.links.length,3);
  if(wrongVRF)for(const d of sim.lab.devices)nsosConfig(d).vpc!.keepalive!.vrf='management';
  sim.changed();assert.equal(sim.advance(45000,300000).targetReached,true);
  for(const d of sim.lab.devices){
   const state=vpcRuntime(d)!;
   assert.equal(state.peerLinkUp,true);assert.equal(state.peerAlive,!wrongVRF);assert.equal(state.adjacency,!wrongVRF);
   assert.deepEqual(state.members,{});assert.equal(d.config.interfaces['Ethernet1/29'].vrf??'default','default');
   assert.equal(d.runtime.features.portChannels[1].activeMembers.length,2);
   if(wrongVRF)assert.equal(state.rxKeepalives,0);else assert.ok(state.rxKeepalives>20);
   const cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true}),summary=cli.execute('show vpc').join('\n');
   assert.doesNotMatch(summary,/^vPC status|^Id\s+Port/m);
   assert.match(summary,wrongVRF?/vPC role\s+: none established/:/vPC role\s+: (?:primary|secondary)/);
   assert.match(summary,wrongVRF?/^1\s+Po1\s+up\s+-/m:/^1\s+Po1\s+up\s+1\s*$/m);
   if(wrongVRF){
    assert.match(summary,/Configuration consistency status\s+: failed/);
    assert.match(summary,/Configuration inconsistency reason\s*: Consistency Check Not Performed/);
   }
  }
  if(wrongVRF){
   for(const [i,d] of sim.lab.devices.entries()){
    const cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
    for(const command of ['configure terminal','vpc domain 1',`peer-keepalive destination 192.168.100.${2-i} source 192.168.100.${i+1} vrf default`,'end']){
     assert.ok(!cli.execute(command).some(iosRejected),command);
    }
   }
   assert.equal(sim.advance(45000,300000).targetReached,true);
   for(const d of sim.lab.devices){assert.equal(vpcRuntime(d)!.peerAlive,true);assert.equal(vpcRuntime(d)!.adjacency,true);}
  }
 }
});
