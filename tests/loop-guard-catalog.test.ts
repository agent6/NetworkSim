import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,LOOP_GUARD_COMMANDS,LOOP_GUARD_FAULTS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='loop-guard',g=(n:number)=>`GigabitEthernet0/${n}`,id=(name:string)=>'device-loop-guard-'+name.toLowerCase();
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(4000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function setup(sim:Simulator){run(sim,'SW3',LOOP_GUARD_COMMANDS.SW3);sim.advance(4000);}
function change(sim:Simulator,lines:readonly string[]){run(sim,'SW3',['enable','configure terminal',...lines,'end']);sim.advance(4000);}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const tree=(sim:Simulator,vlan=10)=>sim.getDevice(id('SW3'))!.runtime.stp[String(vlan)];
const port=(sim:Simulator,n:number)=>sim.getDevice(id('SW3'))!.config.interfaces[g(n)];
const wire=(sim:Simulator,n:number)=>sim.lab.links.find(l=>l.id===LOOP_GUARD_FAULTS.find(f=>f.port===n)!.link)!;
function loss(sim:Simulator,n:number,value:number,time=9000){wire(sim,n).lossAB=value;sim.changed();sim.advance(time);}
function pairs(sim:Simulator){for(const[name,target]of [['PC1','192.168.10.20'],['PC2','192.168.10.10']]){const p=sim.ping(id(name),target,{count:2});sim.advance(4000);assert.equal(p.received,2);}lessonProgress(sim);}
function recover(sim:Simulator,n:number){loss(sim,n,0,4000);}

test('Loop Guard practice starts safely disconnected with zero tasks and independent pre-addressed portable attempts',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'SW1');const sim=load();assert.equal(sim.lab.devices.length,5);assert.equal(sim.lab.links.length,5);assert.equal(lessonProgress(sim)!.complete,0);for(const n of [23,24]){assert.equal(port(sim,n).adminUp,false);assert.equal(port(sim,n).features.loopGuard,false);assert.equal(wire(sim,n).a.deviceId,id(n===23?'SW1':'SW2'));assert.equal(wire(sim,n).b.deviceId,id('SW3'));}for(const name of ['PC1','PC2']){const pc=sim.getDevice(id(name))!;assert.equal(pc.config.interfaces.GigabitEthernet0.features.dhcp,false);assert.equal(pc.config.defaultGateway,undefined);}
});
test('published setup protects both non-designated uplinks and establishes real root and alternate roles in VLANs 10 and 99',()=>{
 const sim=load();setup(sim);assert.equal(lessonProgress(sim)!.complete,2);for(const vlan of [10,99]){assert.equal(tree(sim,vlan).rootId,id('SW1'));assert.equal(tree(sim,vlan).ports[g(23)].role,'root');assert.equal(tree(sim,vlan).ports[g(23)].state,'forwarding');assert.equal(tree(sim,vlan).ports[g(24)].role,'alternate');assert.equal(tree(sim,vlan).ports[g(24)].state,'blocking');}for(const n of [23,24]){assert.equal(port(sim,n).features.loopGuard,true);for(const key of ['rootGuard','bpduguard','portfast'])assert.equal(port(sim,n).features[key],false);}pairs(sim);assert.equal(lessonProgress(sim)!.complete,4);assert.deepEqual(sim.getDevice(id('SW3'))!.startupConfig,sim.getDevice(id('SW3'))!.config);
});
test('root-port one-way loss waits for BPDU expiry then blocks both carried VLANs while the former alternate becomes the forwarding root path',()=>{
 const sim=load();setup(sim);loss(sim,23,1,1000);assert.equal(goal(sim,'root-incident'),false);assert.equal(tree(sim).ports[g(23)].role,'root');sim.advance(8000);assert.equal(goal(sim,'root-incident'),true);for(const vlan of [10,99]){assert.equal(tree(sim,vlan).ports[g(23)].role,'loop-inconsistent');assert.equal(tree(sim,vlan).ports[g(23)].state,'blocking');assert.equal(tree(sim,vlan).ports[g(24)].role,'root');assert.equal(tree(sim,vlan).ports[g(24)].state,'forwarding');assert.equal(tree(sim,vlan).rootId,id('SW1'));}assert.equal(sim.interfaceUp(id('SW3'),g(23)),true);assert.notEqual(port(sim,23).features.errDisabled,true);const before=sim.events.length;pairs(sim);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('SW3')&&e.port===g(24)&&e.protocol==='ICMP'&&e.disposition==='send'&&e.packet?.vlan===10));assert.equal(goal(sim,'root-recovery'),false);
});
test('alternate-port BPDU loss stays loop-inconsistent without interrupting the healthy direct root path or either PC direction',()=>{
 const sim=load();setup(sim);loss(sim,24,1);assert.equal(goal(sim,'alternate-incident'),true);for(const vlan of [10,99]){assert.equal(tree(sim,vlan).ports[g(24)].role,'loop-inconsistent');assert.equal(tree(sim,vlan).ports[g(23)].role,'root');assert.equal(tree(sim,vlan).ports[g(23)].state,'forwarding');}assert.equal(sim.interfaceUp(id('SW3'),g(24)),true);assert.notEqual(port(sim,24).features.errDisabled,true);pairs(sim);assert.equal(goal(sim,'alternate-recovery'),false);
});
test('sequential repairs restore reception and normal roles automatically while preserving both earned incident observations',()=>{
 const sim=load();setup(sim);for(const f of LOOP_GUARD_FAULTS){loss(sim,f.port,1);assert.equal(goal(sim,f.incident),true);pairs(sim);recover(sim,f.port);assert.equal(goal(sim,f.recovery),true);assert.equal(port(sim,f.port).adminUp,true);assert.equal(port(sim,f.port).features.loopGuard,true);}assert.equal(lessonProgress(sim)!.complete,8);assert.equal(tree(sim).ports[g(23)].role,'root');assert.equal(tree(sim).ports[g(24)].role,'alternate');assert.equal(sim.getDevice(id('SW3'))!.config.features.errdisable?.causes,undefined);pairs(sim);
});
test('without Loop Guard a formerly alternate port can become designated instead of loop-inconsistent after BPDU loss',()=>{
 const sim=load();setup(sim);change(sim,['interface g0/24','no spanning-tree guard']);loss(sim,24,1);sim.advance(31000);assert.equal(tree(sim).ports[g(24)].role,'designated');assert.equal(tree(sim).ports[g(24)].state,'forwarding');assert.equal(goal(sim,'alternate-incident'),false);assert.equal(goal(sim,'uplink-protection'),false);
});
test('a link that never received BPDUs cannot fabricate Loop Guard protection or incident credit',()=>{
 const doc=createCatalogLab(catalog);doc.lab.links.find(l=>l.id===LOOP_GUARD_FAULTS[0].link)!.lossAB=1;const sim=new Simulator();sim.load(doc);setup(sim);sim.advance(12000);assert.equal(tree(sim).ports[g(23)].role,'designated');assert.equal(goal(sim,'root-incident'),false);assert.equal(goal(sim,'root-recovery'),false);
});
test('an administratively shut link does not impersonate a physically up one-way failure',()=>{
 const sim=load();setup(sim);change(sim,['interface g0/23','shutdown']);sim.advance(9000);assert.equal(sim.interfaceUp(id('SW3'),g(23)),false);assert.equal(goal(sim,'root-incident'),false);assert.equal(goal(sim,'root-recovery'),false);change(sim,['interface g0/23','no shutdown']);assert.equal(goal(sim,'normal-roles'),true);pairs(sim);
});
test('restored STP reception cannot earn repair credit while the opposite traffic direction still has loss',()=>{
 const sim=load('completed');assert.equal(goal(sim,'root-recovery'),true);const w=wire(sim,23);w.lossBA=1;sim.changed();sim.advance(50);assert.equal(tree(sim).ports[g(23)].role,'root');assert.equal(goal(sim,'root-recovery'),false);w.lossBA=0;sim.changed();sim.advance(1000);assert.equal(goal(sim,'root-recovery'),true);delete w.lossAB;delete w.lossBA;w.loss=.25;sim.changed();assert.equal(goal(sim,'root-recovery'),false);w.loss=0;sim.changed();sim.advance(4000);assert.equal(goal(sim,'root-recovery'),true);w.enabled=false;sim.changed();assert.equal(goal(sim,'root-recovery'),false);
});
test('simultaneous one-way faults isolate the access switch until one path is repaired, without false normal-topology credit',()=>{
 const sim=load();setup(sim);wire(sim,23).lossAB=1;wire(sim,24).lossAB=1;sim.changed();sim.advance(9000);for(const n of [23,24])assert.equal(tree(sim).ports[g(n)].role,'loop-inconsistent');assert.equal(goal(sim,'root-incident'),true);assert.equal(goal(sim,'alternate-incident'),true);const p=sim.ping(id('PC1'),'192.168.10.20',{count:2});sim.advance(4000);assert.equal(p.received,0);recover(sim,24);assert.equal(tree(sim).ports[g(24)].role,'root');assert.equal(goal(sim,'normal-roles'),false);pairs(sim);recover(sim,23);assert.equal(goal(sim,'normal-roles'),true);assert.equal(lessonProgress(sim)!.complete,8);
});
test('Root Guard and Loop Guard are mutually exclusive and removing protection cannot satisfy recovery goals',()=>{
 const sim=load('completed');change(sim,['interface g0/23','spanning-tree guard root']);assert.equal(port(sim,23).features.rootGuard,true);assert.equal(port(sim,23).features.loopGuard,false);assert.equal(goal(sim,'root-recovery'),false);assert.equal(goal(sim,'uplink-protection'),false);change(sim,['interface g0/23','spanning-tree guard loop']);assert.equal(port(sim,23).features.rootGuard,false);assert.equal(goal(sim,'root-recovery'),true);pairs(sim);
});
test('published IOS verification shows LOOP_Inc and a physically connected non-errdisabled interface, then clean inconsistency output after repair',()=>{
 const sim=load();setup(sim);loss(sim,23,1);const cli=run(sim,'SW3',['enable']);assert.match(cli.execute('show spanning-tree vlan 10').join('\n'),/Gi0\/23\s+Desg\s+BKN\*.*LOOP_Inc/);assert.match(cli.execute('show spanning-tree inconsistentports').join('\n'),/VLAN0010\s+GigabitEthernet0\/23\s+Loop Inconsistent/);assert.match(cli.execute('show spanning-tree interface g0/23 detail').join('\n'),/Loop guard is enabled on the port/);assert.doesNotMatch(cli.execute('show interfaces status err-disabled').join('\n'),/Gi0\/23/);recover(sim,23);assert.match(cli.execute('show spanning-tree inconsistentports').join('\n'),/system : 0/);const resources=catalogGuideResources(catalog)!;for(const row of resources.rows)assert.equal(row.length,resources.columns.length);assert.equal(resources.setup?.length,2);for(const[name,commands]of Object.entries(resources.verification)){const c=new IOSSession(sim,id(name));if(!c.windowsMode)c.execute('enable');for(const command of commands){const out=c.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));assert.ok(!out.some(x=>/not implemented|not recognized/i.test(x)),command);if(command.startsWith('ping'))assert.match(out.join('\n'),/Received = 3/);}}
});
test('completed references and saved reloads retain actually observed incidents, rebuild STP and keep protection through startup power cycles',()=>{
 const sim=load('completed');assert.equal(lessonProgress(sim)!.complete,6);pairs(sim);assert.equal(lessonProgress(sim)!.complete,8);const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));assert.equal(goal(fresh,'root-incident'),true);assert.equal(goal(fresh,'alternate-incident'),true);assert.equal(goal(fresh,'normal-roles'),false);fresh.advance(4000);assert.equal(lessonProgress(fresh)!.complete,8);change(fresh,['interface g0/24','no spanning-tree guard']);assert.equal(goal(fresh,'alternate-recovery'),false);fresh.power(id('SW3'),false);fresh.power(id('SW3'),true);fresh.advance(4000);assert.equal(port(fresh,24).features.loopGuard,true);assert.equal(lessonProgress(fresh)!.complete,8);pairs(fresh);
});
test('imported Loop Guard observations and directional-loss goals accept only bounded plain networking values',()=>{
 const lesson=(createCatalogLab(catalog).lab as CatalogLab).lesson!;validateLesson(lesson);for(const criterion of [{kind:'loop-guard-block',device:'SW3',interface:'',vlan:10},{kind:'loop-guard-block',device:'SW3',interface:g(23),vlan:4095},{kind:'interface',device:'SW3',interface:g(23),property:'loopGuard',value:'true'},...[-.1,1.1,NaN,Infinity,'0',null].map(receive=>({kind:'link-loss',device:'SW3',interface:g(23),receive,transmit:0}))])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));
});
