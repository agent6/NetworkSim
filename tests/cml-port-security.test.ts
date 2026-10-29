import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {replayScenario} from '../scripts/cml/replay.ts';
import {parseLabFile} from '../src/persistence.ts';
import {Simulator} from '../src/engine.ts';

const source=readFileSync('scripts/cml/scenarios/port-security.json'),spec=JSON.parse(source.toString());
test('CML port-security scenario proves authorized forwarding before third-source denial on both platforms',()=>{
 const result=replayScenario(spec,createHash('sha256').update(source).digest('hex'));
 assert.equal(result.status,'replayed',JSON.stringify(result.steps.at(-1)));assert.equal(result.steps.length,spec.steps.length);assert.equal(spec.steps.length,98);
 for(const target of ['10.42.0.1','10.42.0.99']){
  const probes=result.steps.filter(s=>s.command.startsWith('ping '+target));assert.ok(probes.some(s=>s.node==='H1'&&/Success rate is 100 percent/.test(s.raw)));assert.ok(probes.some(s=>s.node==='H2'&&/Success rate is 100 percent/.test(s.raw)));assert.ok(probes.some(s=>s.node==='H3'&&/Success rate is 0 percent/.test(s.raw)));
 }
 assert.ok(result.events.some(e=>e.label==='Port security violation'));assert.ok(result.steps.some(s=>s.node==='NX'&&/secViolErrDis/.test(s.raw)));
});

test('portable port-security examples forward two distinct clients and reject a third after import',()=>{
 for(const platform of ['ios','nxos']){
  const doc=parseLabFile(readFileSync('examples/'+platform+'-port-security.netsim.yaml','utf8')),sim=new Simulator(doc.seed);sim.load(doc);sim.advance(2000);
  const client=(name:string)=>sim.lab.devices.find(d=>d.config.hostname===name)!;
  for(const [name,count] of [['PC1',1],['PC2',1],['PC3',0],['PC1',1]] as const){const r=sim.ping(client(name).id,'10.42.0.99',{count:1});sim.advance(1000);assert.equal(r.received,count,platform+': '+name);}
 }
});

test('reviewed CML evidence preserves the Nexus data-plane failures instead of certifying accepted CLI',()=>{
 const f=JSON.parse(readFileSync('scripts/cml/fixtures/port-security-observations.json','utf8'));
 assert.equal(f.scenarioSha256,createHash('sha256').update(source).digest('hex'));assert.equal(f.strictRunStatus,'failed');assert.equal(f.comparisonStatus,'blocked');assert.equal(f.strictPassedSteps,67);assert.equal(f.failedStep.id,'s068');assert.equal(f.failedStep.passed,false);assert.match(f.failedStep.raw,/Success rate is 66 percent/);
 assert.equal(f.contracts.length,30);for(const c of f.contracts){assert.equal(c.observedSha256,createHash('sha256').update(c.observed).digest('hex'));assert.match(c.rawSha256,/^[0-9a-f]{64}$/);for(const p of c.patterns)assert.match(c.observed,new RegExp(p));}
 assert.equal(f.packetEvidence.length,12);assert.ok(f.unauthorizedTransitProof.requests>0);assert.ok(f.unauthorizedTransitProof.replies>0);assert.equal(f.labStopped,true);assert.equal(f.userLabState,'STARTED');
 assert.ok(f.contracts.some((c:any)=>c.id==='nx-protect-unauthorized-still-forwards'));assert.ok(f.contracts.some((c:any)=>c.id==='nx-shutdown-row'));assert.ok(f.contracts.some((c:any)=>c.id==='nx-recovered-forwarding'));
});
