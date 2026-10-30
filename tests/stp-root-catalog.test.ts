import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {bridgeMac} from '../src/control-plane.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {createCatalogLab,STP_ROOT_COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='stp-root-bridge-selection',id=(name:string)=>'device-stp-root-'+name.toLowerCase(),g=(n:number)=>`GigabitEthernet0/${n}`;
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(5000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const ping=(sim:Simulator,name:string,target:string)=>{const p=sim.ping(id(name),target,{count:2});sim.advance(4000);return p.received;};
function pairs(sim:Simulator){assert.equal(ping(sim,'PC1','192.168.10.20'),2);assert.equal(ping(sim,'PC2','192.168.10.10'),2);}
function configure(sim:Simulator){for(const[name,lines]of Object.entries(STP_ROOT_COMMANDS))run(sim,name,lines);sim.advance(5000);}
function change(sim:Simulator,name:string,lines:readonly string[]){run(sim,name,['enable','conf t',...lines,'end']);sim.advance(5000);}
const tree=(sim:Simulator,name:string)=>sim.getDevice(id(name))!.runtime.stp['10'];
function elected(sim:Simulator,root:string,names=['SW1','SW2','SW3']){for(const name of names)assert.equal(tree(sim,name).rootId,id(root));}

test('root selection practice has fixed identities, equal priorities, an unintended lowest-MAC root and working traffic that cannot complete the design',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='changed';assert.equal(b.lab.devices[0].config.hostname,'SW1');const sim=load();assert.equal(sim.lab.devices.length,5);assert.equal(sim.lab.links.length,5);assert.equal(lessonProgress(sim)!.complete,0);assert.deepEqual(['SW1','SW2','SW3'].map(name=>bridgeMac(sim.getDevice(name)!)),['020000000030','020000000020','020000000010']);elected(sim,'SW3');for(const name of ['SW1','SW2','SW3'])assert.equal(sim.getDevice(name)!.config.features.stp.vlanPriorities[10],32768);for(const name of ['PC1','PC2']){const pc=sim.getDevice(name)!;assert.equal(pc.config.defaultGateway,undefined);assert.equal(pc.config.interfaces.GigabitEthernet0.features.dhcp,false);}pairs(sim);assert.equal(lessonProgress(sim)!.complete,3);assert.equal(goal(sim,'root-agreement'),false);
});
test('published commands select the higher-MAC primary by priority and save the secondary/default roles before actual traffic earns completion',()=>{
 const sim=load();configure(sim);assert.equal(lessonProgress(sim)!.complete,5);elected(sim,'SW1');for(const[name,priority]of [['SW1',24576],['SW2',28672],['SW3',32768]]as const){const sw=sim.getDevice(name)!;assert.equal(sw.config.features.stp.vlanPriorities[10],priority);assert.deepEqual(sw.startupConfig,sw.config);}const config=renderConfig(sim.getDevice('SW1')!).join('\n');assert.match(config,/spanning-tree vlan 10 priority 24576/);assert.doesNotMatch(config,/root primary/);pairs(sim);assert.equal(lessonProgress(sim)!.complete,8);const reference=load('completed');assert.equal(lessonProgress(reference)!.complete,5);pairs(reference);assert.equal(lessonProgress(reference)!.complete,8);
});
test('equal bridge priorities are resolved by the lower bridge MAC at zero, primary and default priority values',()=>{
 for(const priority of [0,24576,32768]){const doc=createCatalogLab(catalog);for(const sw of doc.lab.devices.filter(d=>d.kind==='switch'))sw.config.features.stp.vlanPriorities[10]=priority;const sim=new Simulator();sim.load(doc);sim.advance(5000);elected(sim,'SW3');assert.equal(Number(tree(sim,'SW1').rootBridgeId.split('.')[0]),priority+10);pairs(sim);}
 const sim=load('completed');for(const name of ['SW1','SW2'])change(sim,name,['spanning-tree vlan 10 priority 32768']);elected(sim,'SW3');assert.equal(goal(sim,'root-agreement'),false);configure(sim);elected(sim,'SW1');pairs(sim);
});
test('bridge priority is compared before MAC and interface MAC or hostname changes cannot replace the fixed bridge identity',()=>{
 const sim=load('completed'),sw2=sim.getDevice('SW2')!;assert.ok(bridgeMac(sim.getDevice('SW1')!)>bridgeMac(sim.getDevice('SW3')!));elected(sim,'SW1');change(sim,'SW2',['hostname AAAAA','interface g0/24','mac-address 0200.0000.0001']);assert.equal(bridgeMac(sw2),'020000000020');elected(sim,'SW1');pairs(sim);
});
test('configured priorities cannot earn root agreement or expected non-root port roles without actual delivered BPDUs',()=>{
 const sim=new Simulator(),send=sim.sendLinkControl.bind(sim);let drop=true;sim.sendLinkControl=(device,port,message)=>{if(drop&&message.protocol==='STP')return;send(device,port,message);};sim.load(createCatalogLab(catalog,'completed'));sim.advance(5000);assert.equal(goal(sim,'primary-priority'),true);assert.equal(goal(sim,'secondary-priority'),true);for(const name of ['root-agreement','sw2-root-port','sw3-port-roles'])assert.equal(goal(sim,name),false);drop=false;sim.advance(5000);elected(sim,'SW1');for(const name of ['root-agreement','sw2-root-port','sw3-port-roles'])assert.equal(goal(sim,name),true);pairs(sim);
});
test('secondary takeover keeps both surviving PCs reachable when SW1 powers off and the saved primary reclaims the root after return',()=>{
 const sim=load('completed');sim.power(id('SW1'),false);sim.advance(10000);elected(sim,'SW2',['SW2','SW3']);assert.equal(tree(sim,'SW3').rootPort,g(24));assert.equal(goal(sim,'root-agreement'),false);pairs(sim);sim.power(id('SW1'),true);sim.advance(10000);elected(sim,'SW1');assert.equal(goal(sim,'sw2-root-port'),true);assert.equal(goal(sim,'sw3-port-roles'),true);pairs(sim);
});
test('isolating a powered primary produces separate components rather than a fictional single root, and trunk repair reunites the election',()=>{
 const sim=load('completed');change(sim,'SW1',['interface range g0/23 - 24','shutdown']);sim.advance(5000);elected(sim,'SW2',['SW2','SW3']);assert.equal(tree(sim,'SW1').rootId,id('SW1'));assert.equal(goal(sim,'root-agreement'),false);pairs(sim);change(sim,'SW1',['interface range g0/23 - 24','no shutdown']);elected(sim,'SW1');assert.equal(goal(sim,'sw3-port-roles'),true);pairs(sim);
});
test('an uplink failure changes the path through SW3 while preserving SW1 as the root and both PC directions',()=>{
 const sim=load('completed');change(sim,'SW2',['interface g0/24','shutdown']);sim.advance(5000);elected(sim,'SW1');assert.equal(tree(sim,'SW2').rootPort,g(23));assert.equal(goal(sim,'sw2-root-port'),false);assert.equal(tree(sim,'SW3').ports[g(24)].role,'designated');pairs(sim);change(sim,'SW2',['interface g0/24','no shutdown']);assert.equal(goal(sim,'sw2-root-port'),true);assert.equal(goal(sim,'sw3-port-roles'),true);pairs(sim);
});
test('per-interface path cost changes the root port without changing the elected bridge, then removing the override restores the intended roles',()=>{
 const sim=load('completed');change(sim,'SW3',['interface g0/23','spanning-tree vlan 10 cost 100']);elected(sim,'SW1');assert.equal(tree(sim,'SW3').rootPort,g(24));assert.equal(tree(sim,'SW3').cost,8);assert.equal(goal(sim,'root-agreement'),true);assert.equal(goal(sim,'sw3-port-roles'),false);pairs(sim);change(sim,'SW3',['interface g0/23','no spanning-tree vlan 10 cost']);assert.equal(tree(sim,'SW3').rootPort,g(23));assert.equal(goal(sim,'sw3-port-roles'),true);pairs(sim);
});
test('a later lower-priority bridge can take over because root macros are one-time settings; restoring its default recovers the saved primary',()=>{
 const sim=load('completed');change(sim,'SW3',['spanning-tree vlan 10 priority 8192']);elected(sim,'SW3');assert.equal(sim.getDevice('SW1')!.config.features.stp.vlanPriorities[10],24576);assert.equal(goal(sim,'primary-priority'),true);assert.equal(goal(sim,'root-agreement'),false);pairs(sim);change(sim,'SW3',['spanning-tree vlan 10 priority 32768']);elected(sim,'SW1');pairs(sim);
});
test('actual tagged Layer 2 frames follow the new tree without TTL loss, and dynamic MAC credit requires real learning after clear',()=>{
 const sim=load('completed'),before=sim.events.length;pairs(sim);const events=sim.events.slice(before),original=events.find(e=>e.nodeId===id('PC1')&&e.protocol==='ICMP'&&e.disposition==='send')!.packet!;assert.ok(events.some(e=>e.nodeId===id('SW1')&&e.protocol==='ICMP'&&e.disposition==='send'&&e.port===g(23)&&e.packet?.source==='192.168.10.10'&&e.packet.vlan===10&&e.packet.ttl===original.ttl));assert.ok(!events.some(e=>e.nodeId===id('SW3')&&e.protocol==='ICMP'&&e.disposition==='send'&&e.port===g(24)));assert.equal(goal(sim,'mac-learning'),true);for(const name of ['SW2','SW3'])run(sim,name,['enable','clear mac address-table dynamic']);assert.equal(goal(sim,'mac-learning'),false);pairs(sim);assert.equal(goal(sim,'mac-learning'),true);
});
test('all published show and ping commands work and compare actual root/bridge MACs, system-ID priorities and expected port roles',()=>{
 const sim=load('completed');pairs(sim);for(const[name,commands]of Object.entries(catalogGuideResources(catalog)!.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));assert.ok(!out.some(x=>/not recognized|not implemented/i.test(x)),command);const text=out.join('\n');if(command==='show spanning-tree vlan 10'){assert.match(text,/Root ID\s+Priority\s+24586/);assert.match(text,/Root ID[\s\S]*Address\s+0200\.0000\.0030/);if(name==='SW1')assert.match(text,/This bridge is the root/);if(name==='SW2')assert.match(text,/Bridge ID\s+Priority\s+28682/);if(name==='SW3'){assert.match(text,/Bridge ID\s+Priority\s+32778/);assert.match(text,/Address\s+0200\.0000\.0010/);assert.match(text,/Gi0\/23\s+Root\s+FWD/);assert.match(text,/Gi0\/24\s+Altn\s+BLK/);}}if(command.startsWith('ping'))assert.match(text,/Received = 3/);}}
 const resources=catalogGuideResources(catalog)!;assert.equal(resources.planTitle,'Bridge identities and addressing');for(const row of resources.rows)assert.equal(row.length,resources.columns.length);assert.equal((sim.lab as CatalogLab).lesson!.objectives.length,8);
});
test('portable saves and startup power cycles retain the fixed identities and priorities while elections and dynamic learning rebuild',()=>{
 const sim=load('completed');pairs(sim);assert.equal(lessonProgress(sim)!.complete,8);sim.getDevice('SW1')!.config.hostname='StudentPrimary';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));assert.equal(goal(fresh,'root-agreement'),false);fresh.advance(5000);assert.equal(lessonProgress(fresh)!.complete,7);assert.equal(goal(fresh,'mac-learning'),false);assert.equal(bridgeMac(fresh.getDevice(id('SW1'))!),'020000000030');pairs(fresh);assert.equal(lessonProgress(fresh)!.complete,8);for(const name of ['SW1','SW2','SW3']){fresh.power(id(name),false);fresh.power(id(name),true);}fresh.advance(5000);elected(fresh,'SW1');pairs(fresh);assert.equal(lessonProgress(fresh)!.complete,8);
});
