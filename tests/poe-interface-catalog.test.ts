import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,POE_INTERFACE_COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const g=(n:number)=>`GigabitEthernet0/${n}`,id=(name:string)=>'device-poe-'+name.toLowerCase();
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('poe-interface',mode))));sim.advance(2000);return sim;}
function run(sim:Simulator,lines:readonly string[]){const cli=new IOSSession(sim,id('PSW1'));for(const line of lines)assert.ok(!cli.execute(line).some(iosRejected),line);return cli;}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!;
const ping=(sim:Simulator,source:string)=>{const result=sim.ping(id(source),'192.168.10.10',{count:2});sim.advance(4000);return result.received;};

test('PoE practice opens independent portable attempts with a constrained budget, preconfigured data and no earned tasks',()=>{
 const a=createCatalogLab('poe-interface'),b=createCatalogLab('poe-interface');assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.features.poe.budget=60;assert.equal(b.lab.devices[0].config.features.poe.budget,40);
 const sim=load();validateLesson((sim.lab as CatalogLab).lesson);assert.equal(sim.lab.devices.length,5);assert.equal(sim.lab.links.length,4);assert.equal(lessonProgress(sim)!.complete,0);assert.equal(sim.devicePowered(id('AP1')),false);assert.equal(sim.devicePowered(id('PHONE1')),false);assert.equal(sim.getDevice('PC1')!.config.interfaces.GigabitEthernet0.ip,'192.168.10.11');assert.equal(sim.getDevice('PSW1')!.config.interfaces[g(3)].vlan,10);assert.equal(actionAvailable(sim,goal(sim,'phone-ping').objective),false);assert.equal(actionAvailable(sim,goal(sim,'pc-ping').objective),false);assert.equal(ping(sim,'PC1'),0);
});
test('published PoE commands allocate real supply and completed reference only earns connectivity after observed replies',()=>{
 const sim=load();const cli=run(sim,POE_INTERFACE_COMMANDS.PSW1);sim.advance(2000);assert.equal(lessonProgress(sim)!.complete,6);assert.equal(sim.getDevice('PSW1')!.runtime.features.poe.used,30.8);assert.equal(sim.getDevice('PSW1')!.runtime.features.poe.remaining,9.2);
 assert.match(cli.execute('show power inline').join('\n'),/Available:40.0\(w\).*Used:30.8\(w\).*Remaining:9.2\(w\)/);assert.match(cli.execute('show power inline g0/1 detail').join('\n'),/2x2 radios, USB disabled/);assert.match(cli.execute('show power inline priority g0/2').join('\n'),/high/);
 assert.equal(ping(sim,'PHONE1'),2);assert.equal(ping(sim,'PC1'),2);assert.equal(lessonProgress(sim)!.complete,8);assert.equal(sim.getDevice('PSW1')!.startupConfig!.interfaces[g(2)].features.powerPriority,'high');
 const completed=load('completed');assert.equal(lessonProgress(completed)!.complete,6);assert.equal(ping(completed,'PHONE1'),2);assert.equal(ping(completed,'PC1'),2);assert.equal(lessonProgress(completed)!.complete,8);
});
test('full AP allocation exceeds budget while high-priority phone retains power; reduced mode repairs both supplies',()=>{
 const sim=load('completed'),sw=sim.getDevice('PSW1')!;run(sim,['enable','conf t','interface g0/1','power inline auto max 30000','end']);assert.equal(sim.devicePowered(id('AP1')),false);assert.equal(sim.devicePowered(id('PHONE1')),true);assert.equal(sw.runtime.features.poe.used,15.4);assert.match(sim.getDevice('AP1')!.runtime.features.poePower.reason,/budget/);assert.equal(goal(sim,'ap-power').complete,false);assert.equal(goal(sim,'ap-config').complete,false);assert.equal(ping(sim,'PC1'),2);
 run(sim,['enable','conf t','interface g0/1','power inline auto max 15400','end']);sim.advance(1000);assert.equal(goal(sim,'ap-power').complete,true);assert.equal(sw.runtime.features.poe.used,30.8);
});
test('PoE removal takes down phone passthrough and live supply goals, then correct configuration restores packets',()=>{
 const sim=load('completed');assert.equal(ping(sim,'PC1'),2);run(sim,['enable','conf t','interface g0/2','power inline never','end']);assert.equal(sim.devicePowered(id('PHONE1')),false);assert.equal(sim.interfaceUp(id('PHONE1'),'PC'),false);assert.equal(goal(sim,'phone-power').complete,false);assert.equal(actionAvailable(sim,goal(sim,'pc-ping').objective),false);assert.equal(ping(sim,'PC1'),0);
 run(sim,POE_INTERFACE_COMMANDS.PSW1);sim.advance(2000);assert.equal(goal(sim,'phone-power').complete,true);assert.equal(ping(sim,'PC1'),2);
});
test('limits below PD minimum, shut interfaces, cable faults and wrong supply ports cannot satisfy operational goals',()=>{
 const sim=load('completed'),sw=sim.getDevice('PSW1')!;run(sim,['enable','conf t','interface g0/1','power inline auto max 10000','end']);assert.equal(goal(sim,'ap-power').complete,false);assert.match(sim.getDevice('AP1')!.runtime.features.poePower.reason,/minimum/);run(sim,POE_INTERFACE_COMMANDS.PSW1);
 run(sim,['enable','conf t','interface g0/1','shutdown','end']);assert.equal(goal(sim,'ports').complete,false);assert.equal(goal(sim,'ap-power').complete,false);run(sim,POE_INTERFACE_COMMANDS.PSW1);
 const link=sim.lab.links.find(l=>l.id==='link-poe-ap')!;link.enabled=false;sim.changed();assert.equal(goal(sim,'ap-config').complete,true);assert.equal(goal(sim,'ap-power').complete,false);link.enabled=true;sim.changed();assert.equal(goal(sim,'ap-power').complete,true);
 const criterion=goal(sim,'ap-power').objective.criterion;assert.equal(matches(sim,{...criterion,interface:g(2)} as Criterion),false);assert.equal(matches(sim,{...criterion,switch:'missing'} as Criterion),false);assert.equal(sw.runtime.features.poe.used,30.8);
});
test('power supply is independent of VLAN forwarding and unpowered endpoints cannot be manually bypassed',()=>{
 const sim=load('completed'),sw=sim.getDevice('PSW1')!;sw.config.vlans[10].active=false;sim.changed();assert.equal(goal(sim,'phone-power').complete,true);assert.equal(goal(sim,'ap-power').complete,true);assert.equal(ping(sim,'PC1'),0);sw.config.vlans[10].active=true;sim.changed();assert.equal(ping(sim,'PC1'),2);
 sim.power(sw.id,false);sim.power(id('AP1'),true);sim.power(id('PHONE1'),true);assert.equal(goal(sim,'phone-power').complete,false);assert.equal(goal(sim,'ap-power').complete,false);sim.power(sw.id,true);sim.advance(2000);assert.equal(goal(sim,'phone-power').complete,true);assert.equal(ping(sim,'PC1'),2);
});
test('unused port remains data-enabled and saved PoE configurations rebuild fresh supplies after reload',()=>{
 const sim=load('completed');run(sim,['enable','conf t','interface g0/4','shutdown','end']);assert.equal(goal(sim,'unused').complete,false);run(sim,POE_INTERFACE_COMMANDS.PSW1);assert.equal(goal(sim,'unused').complete,true);
 const saved=parseLabFile(serializeLabFile(sim.serialize())),fresh=new Simulator();fresh.load(saved);fresh.advance(2000);assert.equal(lessonProgress(fresh)!.complete,6);assert.equal(fresh.getDevice('PSW1')!.config.features.poe.budget,40);assert.equal(fresh.getDevice('PSW1')!.runtime.features.poe.used,30.8);fresh.reload(id('PSW1'));fresh.advance(2000);assert.equal(goal(fresh,'phone-config').complete,true);assert.equal(goal(fresh,'ap-power').complete,true);assert.equal(ping(fresh,'PC1'),2);
});
test('PoE guide validates bounded data and exposes only implemented configuration and verification',()=>{
 const sim=load(),lesson=(sim.lab as CatalogLab).lesson!,resources=catalogGuideResources('poe-interface')!;assert.equal(lesson.objectives.length,8);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);assert.match(resources.note,/30.8 W/);assert.match(resources.note,/controller joining.*outside/);
 const phoneCriterion=goal(sim,'phone-config').objective.criterion as unknown as Record<string,unknown>,apCriterion=goal(sim,'ap-power').objective.criterion as unknown as Record<string,unknown>;
 const invalidCriteria:unknown[] = [
  {...phoneCriterion,max:30001},{...phoneCriterion,mode:'static'},
  {...phoneCriterion,priority:'critical'},{...phoneCriterion,max:15400.1},
  {...apCriterion,watts:Infinity},{...apCriterion,watts:0},
  {...apCriterion,standard:'802.3bt'},{...apCriterion,class:8},
  {...apCriterion,spatialStreams:8},{...apCriterion,usb:'off'},
];
 for(const criterion of invalidCriteria)assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion}]}),/invalid/);
 const completed=load('completed'),cli=new IOSSession(completed,id('PSW1'));cli.execute('enable');for(const command of resources.verification.PSW1)assert.ok(!cli.execute(command).some(iosRejected),command);
 assert.equal(matches(sim,{kind:'poe-interface',device:'missing',interface:g(1),mode:'auto',max:15400,priority:'low'}),false);
});
