import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,L2_INTERFACE_COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const port='GigabitEthernet0';
const load=(mode:'practice'|'completed'='practice')=>{const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('layer-2-switching-interfaces',mode))));sim.advance(1500);return sim;};
const run=(sim:Simulator,commands:readonly string[])=>{const cli=new IOSSession(sim,sim.getDevice('SW1')!.id);for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}return cli;};
const ping=(sim:Simulator,name='PC1')=>{const result=sim.ping(name,name==='PC1'||name==='device-l2-pc1'?'192.168.10.20':'192.168.10.10',{count:2});sim.advance(5000);return result.received;};
const learned=(sim:Simulator)=>lessonProgress(sim)!.rows.find(r=>r.objective.id==='mac-learning')!.complete;

test('Layer 2 lab starts isolated with pre-addressed hosts and no routing dependency',()=>{
 const a=createCatalogLab('layer-2-switching-interfaces'),b=createCatalogLab('layer-2-switching-interfaces');assert.notEqual(a.lab.id,b.lab.id);const sim=load();assert.equal(sim.lab.devices.length,3);assert.equal(sim.lab.links.length,2);validateLesson((sim.lab as CatalogLab).lesson);assert.equal(lessonProgress(sim)!.complete,0);assert.equal(ping(sim),0);assert.equal(learned(sim),false);
 for(const name of ['PC1','PC2']){const d=sim.getDevice(name)!;assert.equal(d.config.interfaces[port].features.dhcp,false);assert.equal(d.config.defaultGateway,undefined);}assert.equal(sim.getDevice('SW1')!.config.ipRouting,false);
});
test('published IOS commands configure interfaces and enable actual same-VLAN traffic and dynamic MAC learning',()=>{
 const sim=load();run(sim,L2_INTERFACE_COMMANDS.SW1);sim.advance(1500);assert.equal(lessonProgress(sim)!.complete,4);assert.equal(learned(sim),false);assert.equal(ping(sim),2);assert.equal(ping(sim,'PC2'),2);assert.equal(lessonProgress(sim)!.complete,7);
 const sw=sim.getDevice('SW1')!;for(const[n,name]of [[1,'PC1'],[2,'PC2']]as const){const p=sw.config.interfaces[`GigabitEthernet0/${n}`];assert.equal(p.ip,undefined);assert.equal(p.description,'TO_'+name);assert.equal(p.features.speedAuto,true);assert.equal(p.duplex,'auto');assert.equal(sim.ethernetState(sw.id,p.name)?.speed,1000);assert.equal(sim.ethernetState(sw.id,p.name)?.duplex,'full');const mac=sim.macOf(sim.getDevice(name)!.id,port);assert.equal(sw.runtime.mac['10|'+mac].port,p.name);assert.equal(sw.runtime.mac['10|'+mac].static,undefined);}assert.equal(sw.startupConfig!.interfaces['GigabitEthernet0/3'].adminUp,false);
});
test('wrong VLAN and shutdown break forwarding, while bad descriptions and forced duplex fail their configuration tasks',()=>{
 const sim=load('completed');assert.equal(ping(sim),2);run(sim,['enable','configure terminal','interface GigabitEthernet0/2','switchport access vlan 1','end']);assert.equal(ping(sim),0);assert.equal(lessonProgress(sim)!.rows.find(r=>r.objective.id==='pc2-port')!.complete,false);
 run(sim,['enable','configure terminal','interface GigabitEthernet0/2','switchport access vlan 10','shutdown','end']);assert.equal(ping(sim),0);run(sim,['enable','configure terminal','interface GigabitEthernet0/2','no shutdown','description WRONG','duplex full','end']);sim.advance(1500);assert.equal(lessonProgress(sim)!.rows.find(r=>r.objective.id==='pc2-port')!.complete,false);run(sim,['enable','configure terminal','interface GigabitEthernet0/2','description TO_PC2','duplex auto','end']);assert.equal(ping(sim),2);assert.equal(lessonProgress(sim)!.rows.find(r=>r.objective.id==='pc2-port')!.complete,true);
});
test('MAC goal rejects static, wrong-port and expired entries and follows clear/relearn operations',()=>{
 const sim=load('completed'),sw=sim.getDevice('SW1')!;assert.equal(ping(sim),2);assert.equal(learned(sim),true);const key='10|'+sim.macOf(sim.getDevice('PC1')!.id,port),entry=structuredClone(sw.runtime.mac[key]);sw.runtime.mac[key].static=true;assert.equal(learned(sim),false);sw.runtime.mac[key]=structuredClone(entry);sw.runtime.mac[key].port='GigabitEthernet0/2';assert.equal(learned(sim),false);sw.runtime.mac[key]=structuredClone(entry);sw.runtime.mac[key].expires=sim.clock.now();assert.equal(learned(sim),false);sw.runtime.mac[key]=entry;
 run(sim,['enable','clear mac address-table dynamic']);assert.equal(learned(sim),false);assert.equal(ping(sim),2);assert.equal(learned(sim),true);
});
test('completed configuration and saved progress survive reload; MAC credit requires fresh received traffic',()=>{
 const sim=load('completed');sim.getDevice('PC1')!.config.hostname='Workstation';assert.equal(ping(sim,'device-l2-pc1'),2);assert.equal(ping(sim,'PC2'),2);assert.equal(lessonProgress(sim)!.complete,7);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));restored.advance(1500);assert.equal(learned(restored),false);assert.equal(lessonProgress(restored)!.complete,6,'echo accomplishments persist; runtime MAC entries do not');assert.equal(ping(restored,'device-l2-pc1'),2);assert.equal(lessonProgress(restored)!.complete,7);
 for(const d of restored.lab.devices){restored.power(d.id,false);restored.power(d.id,true);}restored.advance(1500);assert.equal(ping(restored,'device-l2-pc1'),2);assert.equal(restored.getDevice('SW1')!.config.interfaces['GigabitEthernet0/1'].description,'TO_PC1');
});
test('all published switch and PC verification commands inspect working operational state',()=>{
 const sim=load('completed');assert.equal(ping(sim),2);for(const[name,commands]of Object.entries(catalogGuideResources('layer-2-switching-interfaces')!.verification)){const cli=new IOSSession(sim,sim.getDevice(name)!.id);if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command);assert.ok(!/not recognized|not implemented/i.test(out.join('\n')),command);if(command.startsWith('ping'))assert.match(out.join('\n'),/Received = 3/);if(command==='show mac address-table dynamic')assert.match(out.join('\n'),/DYNAMIC/);}}
});
test('new interface and MAC criteria validate bounded data without evaluating imported expressions',()=>{
 const original=(createCatalogLab('layer-2-switching-interfaces').lab as CatalogLab).lesson!;
 const bad:any[]=[{kind:'mac-learned',device:'SW1',interface:port,source:'PC1',sourceInterface:port,vlan:4095},...['switchport','portfast','speedAuto'].map(property=>({kind:'interface',device:'SW1',interface:port,property,value:'true'})),{kind:'interface',device:'SW1',interface:port,property:'duplex',value:'anything'},{kind:'interface',device:'SW1',interface:port,property:'description',value:()=>true}];for(const criterion of bad)assert.throws(()=>validateLesson({...original,objectives:[{id:'x',title:'x',criterion}]}),/invalid/);
 const sim=load();assert.equal(matches(sim,{kind:'mac-learned',device:'SW1',interface:'missing',source:'PC1',sourceInterface:port,vlan:10}as Criterion),false);assert.equal(matches(sim,{kind:'interface',device:'SW1',interface:'missing',property:'speedAuto',value:true}),false);
});
