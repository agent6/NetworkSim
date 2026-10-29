import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,L3_INTERFACE_COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const load=(mode:'practice'|'completed'='practice')=>{const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('layer-3-routed-interfaces',mode))));sim.advance(1500);return sim;};
const run=(sim:Simulator,commands:readonly string[])=>{const cli=new IOSSession(sim,sim.getDevice('DSW1')!.id);for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}return cli;};
const ping=(sim:Simulator,name='PC1',target?:string)=>{const result=sim.ping(name,target??(name==='PC1'||name==='device-l3-pc1'?'192.168.20.10':'192.168.10.10'),{count:2});sim.advance(5000);return result.received;};
const goal=(sim:Simulator,id:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===id)!.complete;

test('Layer 3 lab starts with Layer 2 ports down, routing disabled and pre-addressed hosts',()=>{
 const a=createCatalogLab('layer-3-routed-interfaces'),b=createCatalogLab('layer-3-routed-interfaces');assert.notEqual(a.lab.id,b.lab.id);const sim=load(),sw=sim.getDevice('DSW1')!;assert.equal(sw.kind,'l3switch');assert.equal(sw.config.ipRouting,false);assert.equal(sim.lab.devices.length,3);assert.equal(sim.lab.links.length,2);validateLesson((sim.lab as CatalogLab).lesson);assert.equal(lessonProgress(sim)!.complete,0);assert.equal(ping(sim),0);
 for(const[n,subnet]of [[1,10],[2,20]]as const){const p=sw.config.interfaces[`GigabitEthernet0/${n}`];assert.equal(p.switchport,true);assert.equal(p.adminUp,false);assert.equal(p.ip,undefined);const pc=sim.getDevice('PC'+n)!;assert.equal(pc.config.interfaces.GigabitEthernet0.features.dhcp,false);assert.equal(pc.config.defaultGateway,`192.168.${subnet}.1`);}
});
test('a physical switch port rejects IPv4 addressing until no switchport is configured',()=>{
 const sim=load(),sw=sim.getDevice('DSW1')!,cli=run(sim,['enable','configure terminal','interface GigabitEthernet0/1']);assert.ok(cli.execute('ip address 192.168.10.1 255.255.255.0').some(iosRejected));assert.equal(sw.config.interfaces['GigabitEthernet0/1'].ip,undefined);assert.equal(sw.config.interfaces['GigabitEthernet0/1'].switchport,true);
});
test('published commands create routed ports and connected routes; inter-subnet traffic requires global IP routing',()=>{
 const sim=load();run(sim,L3_INTERFACE_COMMANDS.DSW1.filter(line=>line!=='ip routing'));sim.advance(1500);assert.equal(goal(sim,'pc1-port'),true);assert.equal(goal(sim,'pc2-port'),true);assert.equal(goal(sim,'ip-routing'),false);assert.equal(ping(sim,'PC1','192.168.10.1'),2,'local gateway can answer with transit routing disabled');assert.equal(ping(sim),0);assert.equal(ping(sim,'PC2'),0);
 run(sim,['enable','configure terminal','ip routing','end','write memory']);sim.advance(1500);assert.equal(lessonProgress(sim)!.complete,4);assert.equal(goal(sim,'connected-routes'),true);assert.equal(ping(sim),2);assert.equal(ping(sim,'PC2'),2);assert.equal(lessonProgress(sim)!.complete,6);const sw=sim.getDevice('DSW1')!;assert.equal(sw.config.staticRoutes.length,0);assert.equal(sw.startupConfig!.ipRouting,true);assert.equal(sw.startupConfig!.interfaces['GigabitEthernet0/1'].switchport,false);
});
test('disabled routing, shutdown and conversion back to a switchport each stop routed forwarding and recover after repair',()=>{
 const sim=load('completed');assert.equal(ping(sim),2);run(sim,['enable','configure terminal','no ip routing','end']);assert.equal(goal(sim,'ip-routing'),false);assert.equal(ping(sim),0);run(sim,['enable','configure terminal','ip routing','interface GigabitEthernet0/2','shutdown','end']);assert.equal(ping(sim),0);assert.equal(goal(sim,'pc2-port'),false);assert.equal(goal(sim,'connected-routes'),false);
 run(sim,['enable','configure terminal','interface GigabitEthernet0/2','no shutdown','switchport','end']);assert.equal(sim.getDevice('DSW1')!.config.interfaces['GigabitEthernet0/2'].ip,undefined);assert.equal(goal(sim,'pc2-port'),false);assert.equal(ping(sim),0);run(sim,L3_INTERFACE_COMMANDS.DSW1);sim.advance(1500);assert.equal(ping(sim),2);assert.equal(ping(sim,'PC2'),2);assert.equal(lessonProgress(sim)!.complete,6);
});
test('wrong masks fail the planned-port and connected-route goals; wrong host gateways break the return path',()=>{
 const sim=load('completed');run(sim,['enable','configure terminal','interface GigabitEthernet0/2','ip address 192.168.20.1 255.255.255.128','end']);assert.equal(goal(sim,'pc2-port'),false);assert.equal(goal(sim,'connected-routes'),false);run(sim,['enable','configure terminal','interface GigabitEthernet0/2','ip address 192.168.20.1 255.255.255.0','end']);sim.getDevice('PC1')!.config.defaultGateway='192.168.10.254';sim.changed();assert.equal(ping(sim),0);assert.equal(ping(sim,'PC2'),0);sim.getDevice('PC1')!.config.defaultGateway='192.168.10.1';sim.changed();assert.equal(ping(sim),2);assert.equal(ping(sim,'PC2'),2);
});
test('connected-route goals reject static substitutes and every published verification command works',()=>{
 const sim=load();run(sim,['enable','configure terminal','ip routing','ip route 192.168.10.0 255.255.255.0 Null0','ip route 192.168.20.0 255.255.255.0 Null0','end']);assert.equal(goal(sim,'connected-routes'),false);run(sim,L3_INTERFACE_COMMANDS.DSW1);sim.advance(1500);assert.equal(goal(sim,'connected-routes'),true);
 for(const[name,commands]of Object.entries(catalogGuideResources('layer-3-routed-interfaces')!.verification)){const cli=new IOSSession(sim,sim.getDevice(name)!.id);if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command);assert.ok(!/not recognized|not implemented/i.test(out.join('\n')),command);if(command.startsWith('ping'))assert.match(out.join('\n'),/Received = 3/);if(command.includes(' switchport'))assert.match(out.join('\n'),/Switchport: Disabled/);}}
});
test('routed configuration, guide and stable IDs survive portable saves and power cycles; imported routing predicates are bounded data',()=>{
 const sim=load('completed');sim.getDevice('DSW1')!.config.hostname='Core';sim.getDevice('PC1')!.config.hostname='Workstation';assert.equal(ping(sim,'device-l3-pc1'),2);assert.equal(ping(sim,'PC2'),2);assert.equal(lessonProgress(sim)!.complete,6);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));restored.advance(1500);assert.equal((restored.lab as CatalogLab).catalogId,'layer-3-routed-interfaces');assert.equal(lessonProgress(restored)!.complete,6);for(const d of restored.lab.devices){restored.power(d.id,false);restored.power(d.id,true);}restored.advance(1500);assert.equal(ping(restored,'device-l3-pc1'),2);assert.equal(restored.getDevice('device-l3-dsw1')!.config.ipRouting,true);
 const lesson=(createCatalogLab('layer-3-routed-interfaces').lab as CatalogLab).lesson!;for(const enabled of ['true',1,{},()=>true])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion:{kind:'ip-routing',device:'DSW1',enabled}}]}),/invalid/);assert.equal(matches(load(),{kind:'ip-routing',device:'DSW1',enabled:false}),true);assert.equal(matches(load(),{kind:'ip-routing',device:'missing',enabled:true}),false);
});
