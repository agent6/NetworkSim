import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,VLAN_ACCESS_COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const port='GigabitEthernet0';
const load=(mode:'practice'|'completed'='practice')=>{const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('vlan-and-access-ports',mode))));sim.advance(1500);return sim;};
const run=(sim:Simulator,commands:readonly string[])=>{const cli=new IOSSession(sim,sim.getDevice('SW1')!.id);for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}return cli;};
const ping=(sim:Simulator,source:string,target:string)=>{const result=sim.ping(source,target,{count:2});sim.advance(5000);return result.received;};
const learn=(sim:Simulator)=>{assert.equal(ping(sim,'device-vlan-pc1','192.168.10.12'),2);assert.equal(ping(sim,'device-vlan-pc3','192.168.20.12'),2);};
const goal=(sim:Simulator,id:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===id)!.complete;

test('VLAN access practice is independent, portable and begins with no VLAN connectivity or task credit',()=>{
 const a=createCatalogLab('vlan-and-access-ports'),b=createCatalogLab('vlan-and-access-ports');assert.notEqual(a.lab.id,b.lab.id);const sim=load();assert.equal(sim.lab.devices.length,5);assert.equal(sim.lab.links.length,4);validateLesson((sim.lab as CatalogLab).lesson);assert.equal(lessonProgress(sim)!.complete,0);assert.equal(ping(sim,'PC1','192.168.10.12'),0);assert.equal(ping(sim,'PC3','192.168.20.12'),0);
 for(const n of [1,2,3,4]){const pc=sim.getDevice('PC'+n)!;assert.equal(pc.config.interfaces[port].features.dhcp,false);assert.equal(pc.config.defaultGateway,undefined);assert.equal(sim.getDevice('SW1')!.config.interfaces[`GigabitEthernet0/${n}`].adminUp,false);}
});
test('published interface-range commands configure both access VLANs and actual same-VLAN forwarding',()=>{
 const sim=load();run(sim,VLAN_ACCESS_COMMANDS.SW1);sim.advance(1500);assert.equal(lessonProgress(sim)!.complete,4);const sw=sim.getDevice('SW1')!;assert.equal(sw.config.vlans[10].name,'USERS');assert.equal(sw.config.vlans[20].name,'GUESTS');assert.equal(sw.config.ipRouting,false);
 for(const n of [1,2,3,4]){const p=sw.config.interfaces[`GigabitEthernet0/${n}`];assert.equal(p.mode,'access');assert.equal(p.vlan,n<=2?10:20);assert.equal(p.features.portfast,true);assert.equal(p.ip,undefined);assert.equal(sw.startupConfig!.interfaces[p.name].vlan,p.vlan);}learn(sim);assert.equal(ping(sim,'PC2','192.168.10.11'),2);assert.equal(ping(sim,'PC4','192.168.20.11'),2);assert.equal(lessonProgress(sim)!.complete,7);
});
test('ARP broadcasts stay in the access VLAN instead of flooding the other PC pair',()=>{
 const sim=load('completed'),sw=sim.getDevice('SW1')!;
 for(const[source,target,allowed,forbidden]of [['PC1','192.168.10.12','GigabitEthernet0/2',['GigabitEthernet0/3','GigabitEthernet0/4']],['PC3','192.168.20.12','GigabitEthernet0/4',['GigabitEthernet0/1','GigabitEthernet0/2']]]as const){const before=sim.events.length;assert.equal(ping(sim,source,target),2);const flood=sim.events.slice(before).filter(e=>e.nodeId===sw.id&&e.protocol==='ARP'&&e.label==='Frame flooding');assert.ok(flood.some(e=>e.port===allowed),'the same-VLAN port receives the broadcast');assert.ok(!flood.some(e=>forbidden.some(port=>port===e.port)),'the other VLAN does not receive the broadcast');}
 assert.equal(ping(sim,'PC1','192.168.20.11'),0);assert.equal(ping(sim,'PC3','192.168.10.11'),0);
});
test('wrong access VLAN or shutdown breaks only the affected pair, and repair restores it',()=>{
 const sim=load('completed');learn(sim);run(sim,['enable','configure terminal','interface GigabitEthernet0/2','switchport access vlan 20','end']);assert.equal(goal(sim,'users-ports'),false);assert.equal(ping(sim,'PC1','192.168.10.12'),0);assert.equal(ping(sim,'PC3','192.168.20.12'),2);run(sim,['enable','configure terminal','interface GigabitEthernet0/2','switchport access vlan 10','interface GigabitEthernet0/4','shutdown','end']);assert.equal(goal(sim,'guests-ports'),false);assert.equal(ping(sim,'PC3','192.168.20.12'),0);assert.equal(ping(sim,'PC1','192.168.10.12'),2);run(sim,['enable','configure terminal','interface GigabitEthernet0/4','no shutdown','end']);sim.advance(1500);learn(sim);assert.equal(lessonProgress(sim)!.complete,7);
});
test('MAC goal requires all four dynamic entries with correct VLAN/port identities and fresh learning after clear',()=>{
 const sim=load('completed'),sw=sim.getDevice('SW1')!;assert.equal(ping(sim,'PC1','192.168.10.12'),2);assert.equal(goal(sim,'mac-learning'),false);assert.equal(ping(sim,'PC3','192.168.20.12'),2);assert.equal(goal(sim,'mac-learning'),true);
 for(const n of [1,2,3,4]){const vlan=n<=2?10:20,key=vlan+'|'+sim.macOf(sim.getDevice('PC'+n)!.id,port);assert.equal(sw.runtime.mac[key].port,`GigabitEthernet0/${n}`);assert.equal(sw.runtime.mac[key].static,undefined);assert.equal(sw.runtime.mac[(vlan===10?20:10)+'|'+sim.macOf(sim.getDevice('PC'+n)!.id,port)],undefined);}
 run(sim,['enable','clear mac address-table dynamic']);assert.equal(goal(sim,'mac-learning'),false);learn(sim);assert.equal(goal(sim,'mac-learning'),true);
});
test('published verification commands return expected success and expected cross-VLAN loss',()=>{
 const sim=load('completed');learn(sim);for(const[name,commands]of Object.entries(catalogGuideResources('vlan-and-access-ports')!.verification)){const cli=new IOSSession(sim,sim.getDevice(name)!.id);if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command).join('\n');assert.ok(!/not recognized|not implemented|% Invalid/i.test(out),command);if(command.startsWith('ping')){const cross=name==='PC1'?command.includes('192.168.20.11'):command.includes('192.168.10.11');assert.match(out,cross?/Received = 0/:/Received = 3/);}}}
});
test('VLAN configuration and progress survive portable saves and power cycles while MAC goals require relearning',()=>{
 const sim=load('completed');sim.getDevice('PC1')!.config.hostname='User';sim.getDevice('PC3')!.config.hostname='Guest';learn(sim);assert.equal(lessonProgress(sim)!.complete,7);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));restored.advance(1500);assert.equal((restored.lab as CatalogLab).catalogId,'vlan-and-access-ports');assert.equal(lessonProgress(restored)!.complete,6);learn(restored);assert.equal(lessonProgress(restored)!.complete,7);for(const d of restored.lab.devices){restored.power(d.id,false);restored.power(d.id,true);}restored.advance(1500);learn(restored);assert.equal(ping(restored,'device-vlan-pc1','192.168.20.11'),0);
});
