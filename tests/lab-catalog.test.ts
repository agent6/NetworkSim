import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LAB_GROUPS,CCNA_SECTIONS,LAB_CATALOG,ROAS_COMMANDS,IPV4_INTERFACE_COMMANDS,catalogGuideResources,createCatalogLab,createRouterOnAStickLab,type CatalogLab} from '../src/lab-catalog.ts';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {actionAvailable,lessonProgress,validateLesson} from '../src/lessons.ts';
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
test('CCNA subsections are ordered and both guided labs have section-specific resources',()=>{
 assert.deepEqual(CCNA_SECTIONS,['Fundamentals','Switching','Routing','Services & Security']);
 assert.deepEqual(LAB_CATALOG.filter(l=>l.group==='CCNA').map(l=>[l.id,l.section]),[['ipv4-interface-configuration','Fundamentals'],['router-on-a-stick','Routing']]);
 for(const entry of LAB_CATALOG.filter(l=>l.practice)){const resources=catalogGuideResources(entry.id)!;assert.ok(resources);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);}
 assert.deepEqual(catalogGuideResources('ipv4-interface-configuration')!.columns,['Device','Interface','IPv4 address','Subnet mask']);for(const id of ['datacenter-vpc','__proto__','constructor'])assert.equal(catalogGuideResources(id),undefined);
});
test('IPv4 practice uses actual IOS commands and earns each interface task independently of its peer',()=>{
 const doc=createCatalogLab('ipv4-interface-configuration'),other=createCatalogLab('ipv4-interface-configuration');assert.notEqual(doc.lab.id,other.lab.id);
 const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(doc)));sim.advance(1500);assert.equal(sim.lab.devices.length,2);assert.equal(sim.lab.links.length,1);assert.ok(sim.lab.devices.every(d=>d.kind==='router'));
 for(const d of sim.lab.devices){const port=d.config.interfaces['GigabitEthernet0/0'];assert.equal(port.ip,undefined);assert.equal(port.adminUp,false);}
 let progress=lessonProgress(sim)!;assert.equal(progress.complete,0);assert.equal(actionAvailable(sim,progress.rows[2].objective),false);assert.equal(ping(sim,'R1','192.0.2.2'),0);
 run(new IOSSession(sim,sim.getDevice('R1')!.id),IPV4_INTERFACE_COMMANDS.R1);progress=lessonProgress(sim)!;assert.equal(progress.complete,1);assert.equal(progress.rows[0].complete,true);assert.equal(actionAvailable(sim,progress.rows[2].objective),true);assert.equal(actionAvailable(sim,progress.rows[3].objective),false);assert.equal(ping(sim,'R1','192.0.2.2'),0);
 run(new IOSSession(sim,sim.getDevice('R2')!.id),IPV4_INTERFACE_COMMANDS.R2);sim.advance(1500);assert.equal(lessonProgress(sim)!.complete,2);
 assert.equal(ping(sim,'R1','192.0.2.2'),2);assert.equal(ping(sim,'R2','192.0.2.1'),2);assert.equal(lessonProgress(sim)!.complete,4);
 for(const d of sim.lab.devices){assert.equal(d.startupConfig!.interfaces['GigabitEthernet0/0'].mask,'255.255.255.0');assert.equal(d.startupConfig!.interfaces['GigabitEthernet0/0'].adminUp,true);}
});
test('IPv4 guide rejects a wrong mask and a shutdown interface, with real connectivity recovery',()=>{
 const sim=new Simulator();sim.load(createCatalogLab('ipv4-interface-configuration','completed'));sim.advance(1500);assert.equal(lessonProgress(sim)!.complete,2);const cli=new IOSSession(sim,sim.getDevice('R1')!.id);
 run(cli,['enable','configure terminal','interface GigabitEthernet0/0','ip address 192.0.2.1 255.255.255.128','end']);assert.equal(lessonProgress(sim)!.rows[0].complete,false,'a reachable address with the wrong subnet mask must not pass');assert.equal(ping(sim,'R1','192.0.2.2'),2);
 run(cli,['configure terminal','interface GigabitEthernet0/0','ip address 192.0.2.1 255.255.255.0','shutdown','end']);assert.equal(lessonProgress(sim)!.rows[0].complete,false);assert.equal(ping(sim,'R2','192.0.2.1'),0);
 run(cli,['configure terminal','interface GigabitEthernet0/0','no shutdown','end']);sim.advance(1500);assert.equal(lessonProgress(sim)!.rows[0].complete,true);assert.equal(ping(sim,'R2','192.0.2.1'),2);assert.equal(lessonProgress(sim)!.complete,4);
});
test('IPv4 completed lab keeps startup configuration, guide, stable IDs and progress through portable saves',()=>{
 const doc=parseLabFile(serializeLabFile(createCatalogLab('ipv4-interface-configuration','completed'))),sim=new Simulator();sim.load(doc);sim.advance(1500);assert.equal((sim.lab as CatalogLab).catalogId,'ipv4-interface-configuration');validateLesson((sim.lab as CatalogLab).lesson);assert.equal(lessonProgress(sim)!.complete,2);
 sim.getDevice('R1')!.config.hostname='Student-Router';assert.equal(ping(sim,'device-ipv4-r1','192.0.2.2'),2);assert.equal(ping(sim,'device-ipv4-r2','192.0.2.1'),2);assert.equal(lessonProgress(sim)!.complete,4);
 const saved=parseLabFile(serializeLabFile(sim.serialize())),restored=new Simulator();restored.load(saved);assert.equal(lessonProgress(restored)!.complete,4);assert.equal(restored.getDevice('device-ipv4-r1')!.startupConfig!.interfaces['GigabitEthernet0/0'].ip,'192.0.2.1');
});
test('imported interface IP and mask criteria accept valid values and reject malformed addresses and masks',()=>{
 const guide=()=>structuredClone((createCatalogLab('ipv4-interface-configuration').lab as CatalogLab).lesson!);
 for(const [property,value,valid]of [['ip','192.0.2.1',true],['ip','999.0.2.1',false],['ip',42,false],['mask','255.255.255.0',true],['mask','255.0.255.0',false],['mask','nonsense',false],['mask',24,false]]as const){const lesson=guide();lesson.objectives[0].criterion={kind:'interface',device:'device-ipv4-r1',interface:'GigabitEthernet0/0',property,value};if(valid)assert.doesNotThrow(()=>validateLesson(lesson));else assert.throws(()=>validateLesson(lesson),/invalid/);}
});
