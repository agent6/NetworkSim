import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {claimLessonCelebration,lessonProgress,validateLesson,type GuidedLab} from '../src/lessons.ts';
import {createCatalogLab,type CatalogLab} from '../src/lab-catalog.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';

test('no guide, empty guides and partial progress cannot claim a celebration',()=>{
 const sim=new Simulator();assert.equal(claimLessonCelebration(sim),undefined);(sim.lab as GuidedLab).lesson={title:'Empty',description:'',objectives:[]};assert.equal(claimLessonCelebration(sim),undefined);assert.equal((sim.lab as GuidedLab).lesson!.celebrated,undefined);
 sim.load(createCatalogLab('ipv4-interface-configuration','completed'));sim.advance(1500);assert.equal(lessonProgress(sim)!.complete,2);assert.equal(claimLessonCelebration(sim),undefined);
});
test('a full guide celebrates once, including after repeated polling and a later repair',()=>{
 const sim=new Simulator(),pc=sim.addDevice('pc');(sim.lab as GuidedLab).lesson={title:'Power lab',description:'',objectives:[{id:'on',title:'Power on',criterion:{kind:'device',device:pc.id,powered:true}}]};
 assert.deepEqual(claimLessonCelebration(sim),{title:'Power lab',total:1});assert.equal((sim.lab as GuidedLab).lesson!.celebrated,true);for(let i=0;i<10;i++)assert.equal(claimLessonCelebration(sim),undefined);sim.power(pc.id,false);assert.equal(claimLessonCelebration(sim),undefined);sim.power(pc.id,true);assert.equal(claimLessonCelebration(sim),undefined);
});
test('traffic tasks must receive actual replies before celebration; observation never advances the engine',()=>{
 const sim=new Simulator();sim.load(createCatalogLab('ipv4-interface-configuration','completed'));sim.advance(1500);const a=sim.ping('R1','192.0.2.2',{count:1});sim.advance(3000);assert.equal(a.received,1);assert.equal(claimLessonCelebration(sim),undefined);const b=sim.ping('R2','192.0.2.1',{count:1});sim.advance(3000);assert.equal(b.received,1);
 const time=sim.clock.now(),events=sim.events.length,configs=sim.lab.devices.map(d=>structuredClone(d.config));assert.deepEqual(claimLessonCelebration(sim),{title:'IPv4 interface configuration',total:4});assert.equal(sim.clock.now(),time);assert.equal(sim.events.length,events);assert.deepEqual(sim.lab.devices.map(d=>d.config),configs);
});
test('a saved celebration survives YAML reload while a new catalog attempt can celebrate independently',()=>{
 const sim=new Simulator();sim.load(createCatalogLab('ipv4-interface-configuration','completed'));sim.advance(1500);for(const[source,target]of [['R1','192.0.2.2'],['R2','192.0.2.1']]){sim.ping(source,target,{count:1});sim.advance(3000);}assert.ok(claimLessonCelebration(sim));
 const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));restored.advance(1500);assert.equal(lessonProgress(restored)!.complete,4);assert.equal((restored.lab as CatalogLab).lesson!.celebrated,true);assert.equal(claimLessonCelebration(restored),undefined);const fresh=createCatalogLab('ipv4-interface-configuration','completed');assert.notEqual(fresh.lab.id,sim.lab.id);assert.equal((fresh.lab as CatalogLab).lesson!.celebrated,undefined);
});
test('imported celebration metadata accepts booleans and rejects executable or malformed values',()=>{
 const lesson=(createCatalogLab('ipv4-interface-configuration').lab as CatalogLab).lesson!;for(const celebrated of [true,false,undefined])assert.doesNotThrow(()=>validateLesson({...lesson,celebrated}));for(const celebrated of ['true',1,[],{},()=>true])assert.throws(()=>validateLesson({...lesson,celebrated}),/celebration record is invalid/);
});
