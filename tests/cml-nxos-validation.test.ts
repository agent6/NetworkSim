import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {replayScenario} from '../scripts/cml/replay.ts';

test('CML NX-OS reference contracts replay with matching command availability and complete native evidence',()=>{
 const source=readFileSync('scripts/cml/scenarios/nxos-ospf.json'),scenario=JSON.parse(source.toString()),fixture=JSON.parse(readFileSync('scripts/cml/fixtures/nxos-ospf-observations.json','utf8'));
 const digest=createHash('sha256').update(source).digest('hex');
 assert.equal(fixture.scenarioSha256,digest);assert.equal(fixture.baseline,'fresh-owned-lab');assert.equal(fixture.status,'captured');assert.equal(fixture.labStopped,true);assert.deepEqual(fixture.problems,[]);
 for(const key of ['captureSha256','simulatorSourceSha256'])assert.match(fixture[key],/^[a-f0-9]{64}$/);
 assert.equal(fixture.stepCount,111);assert.equal(fixture.observationCount,12);
 assert.equal(fixture.images.nxos.image,'nxosv9300-10-6-2-f');assert.equal(fixture.images.iosxe.image,'iol-xe-17-18-02');
 assert.equal(fixture.packetEvidence.length,1);assert.ok(fixture.packetEvidence[0].OSPF>=20);assert.ok(fixture.packetEvidence[0].ICMP>=20);assert.match(fixture.packetEvidence[0].sha256,/^[a-f0-9]{64}$/);
 assert.ok(fixture.dbdMtuEvidence.some((d:any)=>d.source==='198.51.100.1'&&d.advertisedMtu===1600&&d.packets>0));
 assert.ok(fixture.dbdMtuEvidence.some((d:any)=>d.source==='198.51.100.2'&&d.advertisedMtu===1500&&d.packets>0));
 const replay=replayScenario(scenario,digest);assert.equal(replay.status,'replayed');assert.equal(replay.steps.length,111);assert.ok(replay.steps.every(s=>s.passed));
 assert.equal(replay.observations.length,12);
 for(const [index,availability]of fixture.commandAvailability.entries()){
  const observed=replay.observations[index];assert.equal(observed.command,availability.command);assert.equal(observed.accepted,availability.cmlAccepted,observed.command);
 }
 for(const contract of fixture.contracts){
  const step=replay.steps.find(s=>s.id===contract.id);assert.ok(step,contract.id);
  for(const check of contract.checks){assert.equal(check.passed,true);if(check.pattern){assert.match(check.observed,new RegExp(check.pattern));assert.match(step.raw,new RegExp(check.pattern),contract.id);}else assert.doesNotMatch(step.raw,new RegExp(check.absent),contract.id);}
 }
 assert.deepEqual(fixture.supplementalCLI.facts.map((f:any)=>f.classification),['explicit-loopback-cost','idempotent-no-change','rejected-no-change','matching-detach-preserves-cost']);
});
