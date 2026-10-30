import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {createCatalogLab,PORTFAST_BPDU_GUARD_COMMANDS as SETUP,PORTFAST_BPDU_GUARD_TRIGGER as TRIGGER,PORTFAST_BPDU_GUARD_RECOVERY as RECOVERY,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='portfast-and-bpdu-guard',g=(n:number)=>`GigabitEthernet0/${n}`;
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(5000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,sim.getDevice(name)!.id);for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function phase(sim:Simulator,commands:Readonly<Record<string,readonly string[]>>){for(const[name,lines]of Object.entries(commands)){run(sim,name,lines);sim.advance(3000);}}
function change(sim:Simulator,name:string,lines:readonly string[]){run(sim,name,['enable','configure terminal',...lines,'end']);sim.advance(3000);}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(row=>row.objective.id===name)!.complete;
const port=(sim:Simulator,name='ASW1',n=3)=>sim.getDevice(name)!.config.interfaces[g(n)];
const incident=(sim:Simulator)=>sim.events.filter(e=>e.label==='BPDU guard err-disable');
function ping(sim:Simulator,name:string,target:string){const p=sim.ping(sim.getDevice(name)!.id,target,{count:2});sim.advance(4000);return p.received;}
function pairs(sim:Simulator){assert.equal(ping(sim,'PC1','192.168.10.20'),2);assert.equal(ping(sim,'PC2','192.168.10.10'),2);lessonProgress(sim);}
function trip(sim:Simulator){phase(sim,SETUP);phase(sim,TRIGGER);assert.equal(port(sim).features.errDisabled,true);assert.equal(goal(sim,'guard-incident'),true);}

test('practice is independent, safely staged and starts with zero earned tasks and pre-addressed clients',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'ASW1');const sim=load();assert.equal(sim.lab.devices.length,6);assert.equal(sim.lab.links.length,5);assert.equal(lessonProgress(sim)!.complete,0);assert.equal(port(sim,'ROGUE',1).adminUp,false);assert.equal(port(sim,'ASW1',1).adminUp,false);for(const name of ['PC1','PC2','PC3']){const pc=sim.getDevice(name)!;assert.equal(pc.config.interfaces.GigabitEthernet0.features.dhcp,false);assert.equal(pc.config.defaultGateway,undefined);}assert.equal(ping(sim,'PC1','192.168.10.20'),0);assert.equal(incident(sim).length,0);
});
test('published setup enables immediate host-edge forwarding without making the trusted trunk an edge or guarded port',()=>{
 const sim=load();run(sim,'ASW1',SETUP.ASW1);sim.advance(10);const tree=sim.getDevice('ASW1')!.runtime.stp['10'];assert.equal(tree.ports[g(1)].state,'forwarding');assert.equal(tree.ports[g(1)].edge,true);assert.equal(tree.ports[g(24)].edge,false);assert.equal(port(sim,'ASW1',24).features.bpduguard,false);assert.equal(lessonProgress(sim)!.complete,3);assert.equal(goal(sim,'guard-incident'),false);pairs(sim);assert.equal(lessonProgress(sim)!.complete,5);assert.deepEqual(sim.getDevice('ASW1')!.startupConfig,sim.getDevice('ASW1')!.config);
});
test('an actual superior BPDU err-disables only the rogue edge, logs once and preserves the root and legitimate traffic',()=>{
 const sim=load();trip(sim);const asw=sim.getDevice('ASW1')!;assert.equal(asw.runtime.features.errdisableCauses[g(3)],'bpduguard');assert.ok(asw.runtime.features.stpCounters[g(3)].received>0);assert.equal(sim.interfaceUp(asw.id,g(3)),false);assert.equal(port(sim).adminUp,true);assert.equal(port(sim,'ASW1',1).features.errDisabled,undefined);assert.equal(asw.runtime.stp['10'].rootId,sim.getDevice('DSW1')!.id);assert.equal(incident(sim).length,1);assert.equal(incident(sim)[0].port,g(3));pairs(sim);assert.equal(ping(sim,'PC3','192.168.10.10'),0);assert.equal(ping(sim,'PC1','192.168.10.30'),0);const cli=run(sim,'ASW1',['enable']);const logs=cli.execute('show logging').join('\n');assert.equal(logs.match(/BLOCK_BPDUGUARD/g)?.length,1);assert.equal(logs.match(/PM-4-ERR_DISABLE: bpduguard/g)?.length,1);assert.match(logs,/GigabitEthernet0\/3/);assert.equal(goal(sim,'remove-source'),false);assert.equal(goal(sim,'recover-port'),false);
});
test('BPDU Guard also shuts an edge on inferior BPDUs, not just an attempted root takeover',()=>{
 const sim=load();change(sim,'ROGUE',['spanning-tree vlan 10 priority 61440']);trip(sim);assert.equal(port(sim).features.errDisabled,true);assert.equal(sim.getDevice('ASW1')!.runtime.stp['10'].rootId,sim.getDevice('DSW1')!.id);pairs(sim);
});
test('PortFast by itself does not block BPDUs or stop a superior rogue from becoming root',()=>{
 const sim=load();phase(sim,SETUP);change(sim,'ASW1',['interface g0/3','spanning-tree bpduguard disable']);phase(sim,TRIGGER);sim.advance(5000);assert.equal(port(sim).features.errDisabled,undefined);assert.equal(goal(sim,'guard-incident'),false);assert.equal(goal(sim,'edge-guard'),false);assert.equal(goal(sim,'trusted-forwarding'),false);const tree=sim.getDevice('ASW1')!.runtime.stp['10'];assert.equal(tree.rootId,sim.getDevice('ROGUE')!.id);assert.equal(tree.ports[g(3)].edge,false);assert.equal(ping(sim,'PC3','192.168.10.10'),2);
});
test('configured protection without delivered BPDUs cannot earn the incident or recovery goals',()=>{
 const sim=load(),send=sim.sendLinkControl.bind(sim);let drop=true;sim.sendLinkControl=(device,port,message)=>{if(drop&&message.protocol==='STP'&&device===sim.getDevice('ROGUE')!.id)return;send(device,port,message);};phase(sim,SETUP);phase(sim,TRIGGER);assert.equal(goal(sim,'guard-incident'),false);assert.equal(goal(sim,'recover-port'),false);assert.equal(port(sim).features.errDisabled,undefined);drop=false;sim.advance(3000);assert.equal(goal(sim,'guard-incident'),true);assert.equal(port(sim).features.errDisabled,true);
});
test('a premature manual reset trips again while the rogue still sends BPDUs',()=>{
 const sim=load();trip(sim);change(sim,'ASW1',['interface g0/3','shutdown','no shutdown']);assert.equal(port(sim).features.errDisabled,true);assert.equal(incident(sim).length,2);assert.equal(goal(sim,'recover-port'),false);pairs(sim);
});
test('removing the source alone leaves err-disable latched; manual recovery retains protection and may correctly leave the link down',()=>{
 const sim=load();trip(sim);phase(sim,{ROGUE:RECOVERY.ROGUE});assert.equal(goal(sim,'remove-source'),true);assert.equal(port(sim).features.errDisabled,true);assert.equal(goal(sim,'recover-port'),false);phase(sim,{ASW1:RECOVERY.ASW1});assert.notEqual(port(sim).features.errDisabled,true);assert.equal(port(sim).adminUp,true);assert.equal(sim.interfaceUp(sim.getDevice('ASW1')!.id,g(3)),false);assert.equal(port(sim).features.portfast,true);assert.equal(port(sim).features.bpduguard,true);assert.equal(goal(sim,'guard-incident'),true);assert.equal(lessonProgress(sim)!.complete,6);pairs(sim);assert.equal(lessonProgress(sim)!.complete,8);for(const name of ['ASW1','ROGUE'])assert.deepEqual(sim.getDevice(name)!.startupConfig,sim.getDevice(name)!.config);
});
test('automatic recovery is disabled by default, including after the cause is removed',()=>{
 const sim=load();trip(sim);phase(sim,{ROGUE:RECOVERY.ROGUE});sim.advance(301000);assert.equal(port(sim).features.errDisabled,true);assert.equal(goal(sim,'recover-port'),false);assert.equal(sim.getDevice('ASW1')!.runtime.features.errdisableDeadline?.[g(3)],undefined);
});
test('optional configured timer recovery is real, retrips with an active source and recovers once it is removed',()=>{
 const sim=load();trip(sim);change(sim,'ASW1',['errdisable recovery cause bpduguard','errdisable recovery interval 30']);sim.advance(31000);assert.equal(port(sim).features.errDisabled,true);assert.ok(incident(sim).length>=2);assert.equal(goal(sim,'recover-port'),false);phase(sim,{ROGUE:RECOVERY.ROGUE});sim.advance(31000);assert.notEqual(port(sim).features.errDisabled,true);assert.equal(goal(sim,'recover-port'),true);assert.equal(port(sim).features.bpduguard,true);pairs(sim);
});
test('completed reference actually earns the BPDU incident and recovers safely, leaving real traffic tests for the learner',()=>{
 const sim=load('completed');assert.equal(lessonProgress(sim)!.complete,6);assert.equal(goal(sim,'guard-incident'),true);assert.notEqual(port(sim).features.errDisabled,true);assert.equal(port(sim,'ROGUE',1).adminUp,false);assert.equal(port(sim).features.bpduguard,true);pairs(sim);assert.equal(lessonProgress(sim)!.complete,8);assert.equal(ping(sim,'PC3','192.168.10.20'),0);assert.match(renderConfig(sim.getDevice('ASW1')!).join('\n'),/spanning-tree bpduguard enable/);
});
test('published verification commands show live err-disable reasons, BPDU Guard logs, recovery defaults, edge and normal trunk state',()=>{
 const sim=load();trip(sim);const resources=catalogGuideResources(catalog)!;assert.equal(resources.planTitle,'Edge protection and addressing');for(const row of resources.rows)assert.equal(row.length,resources.columns.length);for(const[name,commands]of Object.entries(resources.verification)){const cli=new IOSSession(sim,sim.getDevice(name)!.id);if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));assert.ok(!out.some(x=>/not recognized|not implemented/i.test(x)),command);const text=out.join('\n');if(command==='show interfaces status err-disabled')assert.match(text,/Gi0\/3\s+.*err-disabled\s+bpduguard/);if(command==='show logging')assert.match(text,/SPANTREE-2-BLOCK_BPDUGUARD/);if(command==='show errdisable recovery'){assert.match(text,/bpduguard\s+Disabled/);assert.match(text,/Timer interval: 300 seconds/);}if(command==='show spanning-tree interface GigabitEthernet0/1 detail'){assert.match(text,/portfast mode/);assert.match(text,/Bpdu guard is enabled/);}if(command==='show interfaces trunk')assert.match(text,/Gi0\/24/);if(command.startsWith('ping'))assert.match(text,/Received = 3/);}}
});
test('saved reload and startup power cycles preserve incident observations while live configuration and forwarding are re-evaluated',()=>{
 const sim=load('completed');pairs(sim);const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));assert.equal(goal(fresh,'guard-incident'),true);assert.equal(goal(fresh,'trusted-forwarding'),false);fresh.advance(5000);assert.equal(lessonProgress(fresh)!.complete,8);change(fresh,'ASW1',['interface g0/3','spanning-tree bpduguard disable']);assert.equal(goal(fresh,'edge-guard'),false);assert.equal(goal(fresh,'recover-port'),false);assert.equal(goal(fresh,'guard-incident'),true);fresh.power(fresh.getDevice('ASW1')!.id,false);fresh.power(fresh.getDevice('ASW1')!.id,true);fresh.advance(5000);assert.equal(port(fresh).features.bpduguard,true);assert.equal(goal(fresh,'recover-port'),true);pairs(fresh);assert.equal(lessonProgress(fresh)!.complete,8);
});
test('incident and interface criteria are bounded on import and an unrelated err-disable cannot earn BPDU observation credit',()=>{
 const doc=createCatalogLab(catalog),lesson=(doc.lab as CatalogLab).lesson!;validateLesson(lesson);for(const criterion of [{kind:'bpdu-guard-trip',device:'ASW1',interface:''},{kind:'bpdu-guard-trip',device:'ASW1',interface:'x'.repeat(129)},{kind:'interface',device:'ASW1',interface:g(3),property:'bpduguard',value:'true'},{kind:'interface',device:'ASW1',interface:g(3),property:'errDisabled',value:1}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));const sim=load();phase(sim,SETUP);port(sim).features.errDisabled=true;sim.getDevice('ASW1')!.runtime.features.errdisableCauses={[g(3)]:'psecure-violation'};assert.equal(goal(sim,'guard-incident'),false);assert.equal(goal(sim,'remove-source'),false);assert.equal(goal(sim,'recover-port'),false);
});
