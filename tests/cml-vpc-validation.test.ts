import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {replayScenario} from '../scripts/cml/replay.ts';
import {Simulator} from '../src/engine.ts';
import {parseLabFile} from '../src/persistence.ts';
import {vpcRuntime} from '../src/datacenter.ts';
type NativeFixture={
 status:string;baseline:string;labStopped:boolean;cleanupErrors:unknown[];
 replayScenarioSha256:string;captureSha256:string;images:{nxosVersion:string};
 captureEvidence:{bytes:number;packets:number;keepaliveTosTtl:{tos:number;ttl:number;count:number}[]}[];
 reviewedObservations:{rawSha256:string;job:string;excerpt:string[]}[];
 harnessTimeouts:unknown[];unresolved:{status:string;observation:string}[];
};

test('reviewed native evidence retains the unresolved dataplane difference and exact artifact provenance',()=>{
 const fixture=JSON.parse(readFileSync('scripts/cml/fixtures/nxos-vpc-pair-observations.json','utf8')) as NativeFixture;
 assert.equal(fixture.status,'observed-with-unresolved-difference');assert.equal(fixture.baseline,'restarted-owned-lab');assert.equal(fixture.labStopped,true);assert.deepEqual(fixture.cleanupErrors,[]);
 assert.equal(fixture.replayScenarioSha256,createHash('sha256').update(readFileSync('scripts/cml/scenarios/nxos-vpc-pair.json')).digest('hex'));
 assert.match(fixture.captureSha256,/^[0-9a-f]{64}$/);assert.equal(fixture.images.nxosVersion,'10.6(2)');
 assert.equal(fixture.captureEvidence.length,10);assert.ok(fixture.captureEvidence.every(c=>c.bytes>24&&c.packets>0));
 const ka=fixture.captureEvidence.flatMap(c=>c.keepaliveTosTtl);assert.ok(ka.some(k=>k.tos===192&&k.ttl===64&&k.count>0));
 assert.ok(fixture.reviewedObservations.every(o=>/^[0-9a-f]{64}$/.test(o.rawSha256)));
 assert.ok(fixture.reviewedObservations.some(o=>o.job==='89-guard-none-check.json'&&o.excerpt.some(line=>/STP Port Guard\s+1\s+None\s+Default/.test(line))));
 assert.ok(fixture.reviewedObservations.some(o=>o.job==='110-complete-restored-client.json'&&o.excerpt.some(line=>/100 percent \(5\/5\)/.test(line))));
 assert.ok(fixture.harnessTimeouts.length>0);assert.equal(fixture.unresolved[0].status,'unresolved');assert.match(fixture.unresolved[0].observation,/0\/5/);
});

test('the full CML vPC pair scenario replays configuration, real forwarding, consistency faults and recovery',()=>{
 const source=readFileSync('scripts/cml/scenarios/nxos-vpc-pair.json'),spec=JSON.parse(source.toString());
 const result=replayScenario(spec,createHash('sha256').update(source).digest('hex'));
 assert.equal(result.status,'replayed',JSON.stringify(result.steps.at(-1)));assert.equal(result.steps.length,117);
 assert.ok(result.steps.every(s=>s.passed));assert.equal(result.observations.length,20);assert.ok(result.observations.every(o=>o.accepted));
 assert.ok(result.events.some(e=>e.packet?.destinationPort===3200&&e.packet.dscp===48));
});

test('the distributable CML comparison lab loads offline with both vPC peers and two VLANs forwarding',()=>{
 const sim=new Simulator();sim.load(parseLabFile(readFileSync('examples/datacenter-vpc-cml.netsim.yaml','utf8')));
 assert.equal(sim.lab.devices.length,6);assert.equal(sim.lab.links.length,10);
 assert.equal(sim.advance(65000,300000).targetReached,true);
 for(const d of sim.lab.devices.filter(d=>d.kind==='datacenter')){
  assert.equal(vpcRuntime(d)!.adjacency,true);assert.equal(vpcRuntime(d)!.members[10].up,true);assert.deepEqual(vpcRuntime(d)!.members[10].activeVlans,[10,20]);
 }
 const client=sim.lab.devices.find(d=>d.config.hostname==='CLIENT')!;
 for(const address of ['10.10.10.11','10.10.10.12','10.10.20.12']){
  const ping=sim.ping(client.id,address,{count:5,interval:20,timeout:1000});sim.advance(6000,100000);assert.equal(ping.received,5,address);
 }
});
