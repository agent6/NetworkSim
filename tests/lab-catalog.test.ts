import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LAB_GROUPS,LAB_CATALOG,ROAS_COMMANDS,createCatalogLab,createRouterOnAStickLab,type CatalogLab} from '../src/lab-catalog.ts';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {lessonProgress,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const load=(mode:'practice'|'completed')=>{const sim=new Simulator();sim.load(createRouterOnAStickLab(mode));sim.advance(1500);return sim;};
const run=(cli:IOSSession,lines:readonly string[])=>{for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}};
const ping=(sim:Simulator,source:string,target:string)=>{const p=sim.ping(source,target,{count:2});sim.advance(5000);return p.received;};
test('catalog groups are ordered and each opening produces an independent valid portable lab',()=>{
 assert.deepEqual(LAB_GROUPS,['CCNA','CCNP ENCOR','CCNP ENARSI','Other']);assert.equal(LAB_CATALOG.find(l=>l.id==='router-on-a-stick')?.group,'CCNA');
 const a=createCatalogLab('router-on-a-stick'),b=createCatalogLab('router-on-a-stick');assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='changed';assert.equal(b.lab.devices[0].config.hostname,'R1');
 const restored=parseLabFile(serializeLabFile(b));assert.equal((restored.lab as CatalogLab).catalogId,'router-on-a-stick');validateLesson((restored.lab as CatalogLab).lesson);assert.equal(restored.lab.devices.length,4);assert.equal(restored.lab.links.length,3);assert.throws(()=>createCatalogLab('unknown'),/not in the catalog/);
});
test('practice begins unconfigured and the published IOS reference commands enable actual inter-VLAN forwarding',()=>{
 const sim=load('practice');assert.equal(sim.getDevice('PC1')!.config.defaultGateway,'192.168.10.1');assert.equal(sim.getDevice('PC2')!.config.interfaces.GigabitEthernet0.features.dhcp,false);assert.equal(lessonProgress(sim)?.complete,0);assert.equal(ping(sim,'PC1','192.168.20.10'),0);
 for(const[name,commands]of Object.entries(ROAS_COMMANDS))run(new IOSSession(sim,sim.getDevice(name)!.id),commands);sim.advance(1500);
 assert.equal(sim.getDevice('R1')!.config.interfaces['GigabitEthernet0/0'].ip,undefined);assert.equal(sim.getDevice('R1')!.config.interfaces['GigabitEthernet0/0.10'].features.dot1q,10);assert.equal(sim.getDevice('R1')!.config.interfaces['GigabitEthernet0/0.20'].features.dot1q,20);
 assert.equal(ping(sim,'PC1','192.168.20.10'),2);assert.equal(ping(sim,'PC2','192.168.10.10'),2);assert.equal(lessonProgress(sim)?.complete,6);assert.ok(sim.events.some(e=>e.packet?.vlan===10));assert.ok(sim.events.some(e=>e.packet?.vlan===20));
 assert.equal(sim.getDevice('R1')!.startupConfig!.interfaces['GigabitEthernet0/0.10'].ip,'192.168.10.1');
});
test('completed lab fails when a trunk VLAN is removed or the router parent is shut down, and recovers after correction',()=>{
 const sim=load('completed'),sw=new IOSSession(sim,sim.getDevice('SW1')!.id),r=new IOSSession(sim,sim.getDevice('R1')!.id);assert.equal(ping(sim,'PC1','192.168.20.10'),2);
 run(sw,['enable','configure terminal','interface GigabitEthernet0/1','switchport trunk allowed vlan 10','end']);assert.equal(ping(sim,'PC1','192.168.20.10'),0);run(sw,['configure terminal','interface GigabitEthernet0/1','switchport trunk allowed vlan 10,20','end']);assert.equal(ping(sim,'PC1','192.168.20.10'),2);
 run(r,['enable','configure terminal','interface GigabitEthernet0/0','shutdown','end']);assert.equal(ping(sim,'PC2','192.168.10.10'),0);run(r,['configure terminal','interface GigabitEthernet0/0','no shutdown','end']);sim.advance(1500);assert.equal(ping(sim,'PC2','192.168.10.10'),2);
});
test('completed configuration, guide and fresh traffic checks survive a YAML save and reload',()=>{
 const doc=parseLabFile(serializeLabFile(createCatalogLab('router-on-a-stick','completed'))),sim=new Simulator();sim.load(doc);sim.advance(1500);assert.equal(lessonProgress(sim)?.complete,4);assert.equal((sim.lab as CatalogLab).catalogId,'router-on-a-stick');
 sim.getDevice('PC1')!.config.hostname='Student PC';assert.equal(ping(sim,'device-pc1','192.168.20.10'),2);assert.equal(ping(sim,'PC2','192.168.10.10'),2);assert.equal(lessonProgress(sim)?.complete,6,'guide binds to stable device IDs rather than display names');
});
test('Other retains the existing datacenter vPC example with a fresh saved-lab identity',()=>{
 const a=createCatalogLab('datacenter-vpc','completed'),b=createCatalogLab('datacenter-vpc','completed');assert.notEqual(a.lab.id,b.lab.id);const sim=new Simulator();sim.load(a);assert.equal(sim.getDevice('DC1')?.kind,'datacenter');assert.equal((sim.lab as CatalogLab).catalogId,'datacenter-vpc');
});
