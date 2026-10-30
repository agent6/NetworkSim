import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {ospfLiveDetail} from '../src/ospf-packets.ts';
import {createCatalogLab,OSPF_DR_BDR_COMMANDS as COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,validateLesson,matches,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='ospf-dr-bdr-election',id=(name:string)=>'device-ospf-election-'+name.toLowerCase(),g=(n:number)=>`GigabitEthernet0/${n}`,names=['R1','R2','R3','R4'];
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(7000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function change(sim:Simulator,name:string,lines:readonly string[],wait=7000){run(sim,name,['enable','configure terminal',...lines,'end']);sim.advance(wait);}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const state=(sim:Simulator,name:string)=>sim.getDevice(id(name))!.runtime.features.ospfInterfaces[g(1)];
const route=(sim:Simulator,name:string,subnet= name==='R4'?30:40)=>sim.getDevice(id(name))!.runtime.routes.find(r=>r.network===`192.168.${subnet}.0`&&r.protocol==='O');
const ping=(sim:Simulator,name:string,target:string)=>{const p=sim.ping(id(name),target,{count:2});sim.advance(4000);return p.received;};
function allTraffic(sim:Simulator){assert.equal(ping(sim,'PC1','192.168.40.10'),2);assert.equal(ping(sim,'PC2','192.168.30.10'),2);lessonProgress(sim);}
function noTraffic(sim:Simulator){assert.equal(ping(sim,'PC1','192.168.40.10'),0);assert.equal(ping(sim,'PC2','192.168.30.10'),0);}
function roles(sim:Simulator,dr='R1',bdr:string|null='R2',members=names){for(const name of members){const row=state(sim,name);assert.equal(row.role,name===dr?'DR':name===bdr?'BDR':'DROTHER');assert.equal(row.drDeviceId,id(dr));assert.equal(row.bdrDeviceId,bdr?id(bdr):undefined);}}
function reset(sim:Simulator){for(const name of names)change(sim,name,['interface g0/1','shutdown'],100);for(const name of names)change(sim,name,['interface g0/1','no shutdown'],7000);}
function copied(sim:Simulator){const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(7000);return fresh;}
function assertRoutes(sim:Simulator){for(const name of names)for(const subnet of [30,40]){if(name===`R${subnet/10}`)continue;const r=route(sim,name,subnet)!;assert.equal(r.prefix,24);assert.equal(r.ad,110);assert.equal(r.metric,11);assert.equal(r.nextHop,`10.0.123.${subnet/10}`);assert.equal(r.interface,g(1));}}

test('election practice is an independent seven-node shared segment with no OSPF/static routes or completion credit',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const sim=load();assert.equal(sim.lab.devices.length,7);assert.equal(sim.lab.links.length,6);assert.equal(sim.lab.links.filter(l=>l.a.deviceId===id('SW1')||l.b.deviceId===id('SW1')).length,4);assert.equal(lessonProgress(sim)!.complete,0);for(const name of names){const d=sim.getDevice(id(name))!;assert.deepEqual(d.config.staticRoutes,[]);assert.deepEqual(d.config.protocols,{});}assert.equal(ping(sim,'PC1','192.168.30.1'),2);assert.equal(ping(sim,'PC2','192.168.40.1'),2);noTraffic(sim);assert.equal(lessonProgress(sim)!.complete,0);
});
test('published IOS configurations and completed reference earn eight live goals and require two real echo checks for ten tasks',()=>{
 for(const mode of ['practice','completed']as const){const sim=load(mode);if(mode==='practice'){for(const[name,lines]of Object.entries(COMMANDS))run(sim,name,lines);sim.advance(7000);}assert.equal(lessonProgress(sim)!.complete,8);roles(sim);assertRoutes(sim);for(const name of names){const d=sim.getDevice(id(name))!;assert.deepEqual(JSON.parse(JSON.stringify(d.startupConfig)),JSON.parse(JSON.stringify(d.config)));}allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);}
});
test('four router LSAs and actual OSPF exchanges produce ten Full directed peers and two normal DROTHER 2WAY relationships',()=>{
 const sim=load('completed');roles(sim);let full=0,two=0;for(const name of names){const live=ospfLiveDetail(sim,id(name),'ospf')!;assert.equal(live.lsas.length,4);for(const n of sim.getDevice(id(name))!.runtime.neighbors.filter(n=>n.protocol==='OSPF')){assert.equal(n.interface,g(1));const expected=['R3','R4'].includes(name)&&[id('R3'),id('R4')].includes(n.deviceId)?'2WAY':'FULL';assert.equal(n.state,expected);if(n.state==='FULL')full++;else two++;}assert.ok(sim.events.some(e=>e.nodeId===id(name)&&e.port===g(1)&&e.packet?.protocol==='OSPF'&&e.disposition==='receive'));}assert.equal(full,10);assert.equal(two,2);assert.equal(goal(sim,'neighbor-states'),true);const db=run(sim,'R3',['enable']).execute('show ip ospf database network').join('\n');assert.match(db,/Link State ID: 10.0.123.1/);assert.match(db,/Advertising Router: 1.1.1.1/);assert.equal((db.match(/Attached Router:/g)||[]).length,4);
});
test('DROTHER LANs stay passive and advertise their prefixes without sending Hellos toward either PC',()=>{
 const sim=load('completed');sim.advance(15000);for(const name of ['R3','R4']){assert.equal(ospfLiveDetail(sim,id(name),'ospf')!.interfaces.find(p=>p.name===g(0))!.passive,true);assert.ok(!sim.events.some(e=>e.nodeId===id(name)&&e.port===g(0)&&e.packet?.protocol==='OSPF'&&e.disposition==='send'));}allTraffic(sim);
});
test('raising BDR or DROTHER priority does not preempt an established DR, and planned-priority goals remain live',()=>{
 const sim=load('completed');change(sim,'R2',['interface g0/1','ip ospf priority 200']);roles(sim);assert.equal(goal(sim,'elected-roles'),true);assert.equal(goal(sim,'r2-area0'),false);change(sim,'R3',['interface g0/1','ip ospf priority 255']);roles(sim);assert.equal(goal(sim,'r3-area0'),false);allTraffic(sim);change(sim,'R2',['interface g0/1','ip ospf priority 50']);change(sim,'R3',['interface g0/1','ip ospf priority 0']);assert.equal(lessonProgress(sim)!.complete,10);
});
test('DR failure promotes the BDR, keeps DROTHER LAN traffic working and makes the returning higher-priority router BDR',()=>{
 const sim=load('completed');allTraffic(sim);change(sim,'R1',['interface g0/1','shutdown']);roles(sim,'R2',null,['R2','R3','R4']);assert.equal(goal(sim,'elected-roles'),false);allTraffic(sim);change(sim,'R1',['interface g0/1','no shutdown'],15000);roles(sim,'R2','R1');assertRoutes(sim);allTraffic(sim);assert.equal(goal(sim,'elected-roles'),false);reset(sim);roles(sim);assertRoutes(sim);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('BDR failure leaves the incumbent DR and both zero-priority DROTHERs operational without an eligible replacement BDR',()=>{
 const sim=load('completed');change(sim,'R2',['interface g0/1','shutdown']);roles(sim,'R1',null,['R1','R3','R4']);allTraffic(sim);change(sim,'R2',['interface g0/1','no shutdown'],15000);roles(sim);assertRoutes(sim);allTraffic(sim);
});
test('loss of both eligible routers leaves priority-zero DROTHERs 2WAY without remote routes until a DR returns',()=>{
 const sim=load('completed');change(sim,'R1',['interface g0/1','shutdown']);change(sim,'R2',['interface g0/1','shutdown']);sim.advance(45000);for(const name of ['R3','R4']){assert.equal(state(sim,name).role,'DROTHER');assert.equal(state(sim,name).drDeviceId,undefined);assert.equal(route(sim,name),undefined);assert.equal(sim.getDevice(id(name))!.runtime.neighbors.find(n=>n.protocol==='OSPF')!.state,'2WAY');}noTraffic(sim);assert.equal(ping(sim,'PC1','192.168.30.1'),2);change(sim,'R1',['interface g0/1','no shutdown'],15000);change(sim,'R2',['interface g0/1','no shutdown'],15000);roles(sim);assertRoutes(sim);allTraffic(sim);
});
test('a fresh equal-priority election uses the higher router ID while the existing election remains non-preemptive',()=>{
 const sim=load('completed');change(sim,'R2',['interface g0/1','ip ospf priority 100']);roles(sim);const fresh=copied(sim);roles(fresh,'R2','R1');assert.equal(goal(fresh,'elected-roles'),false);assertRoutes(fresh);allTraffic(fresh);change(fresh,'R2',['interface g0/1','ip ospf priority 50']);roles(fresh,'R2','R1');const repaired=copied(fresh);roles(repaired);assertRoutes(repaired);allTraffic(repaired);assert.equal(lessonProgress(repaired)!.complete,10);
});
test('fresh default-priority election selects the highest router IDs but cannot earn the prescribed roles and priorities',()=>{
 const sim=load('completed');for(const name of names)change(sim,name,['interface g0/1','no ip ospf priority']);const fresh=copied(sim);roles(fresh,'R4','R3');assert.equal(goal(fresh,'elected-roles'),false);for(const name of names)assert.equal(goal(fresh,name.toLowerCase()+'-area0'),false);assertRoutes(fresh);allTraffic(fresh);
});
test('a later higher-priority R1 does not displace R2 configured first, and the controlled shared-segment reset restores intended roles',()=>{
 const sim=load();for(const name of ['R3','R4','R2','R1'])run(sim,name,COMMANDS[name]);sim.advance(7000);roles(sim,'R2','R1');for(const name of names)assert.equal(goal(sim,name.toLowerCase()+'-area0'),true);assert.equal(goal(sim,'elected-roles'),false);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,9);reset(sim);roles(sim);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('a passive DROTHER transit loses its intended peers and remote traffic while the other election remains usable',()=>{
 const sim=load('completed');change(sim,'R3',['router ospf 10','passive-interface g0/1'],15000);assert.equal(goal(sim,'r3-area0'),false);assert.equal(goal(sim,'neighbor-states'),false);noTraffic(sim);change(sim,'R3',['router ospf 10','no passive-interface g0/1'],15000);roles(sim);assertRoutes(sim);allTraffic(sim);
});
test('withdrawing only R4 LAN membership leaves all twelve neighbor states intact but breaks both PC traffic directions',()=>{
 const sim=load('completed');change(sim,'R4',['interface g0/0','no ip ospf 10 area 0']);assert.equal(goal(sim,'neighbor-states'),true);assert.equal(goal(sim,'r4-area0'),false);assert.equal(goal(sim,'passive-lans'),false);assert.equal(route(sim,'R3'),undefined);assert.ok(route(sim,'R4'));noTraffic(sim);change(sim,'R4',['interface g0/0','ip ospf 10 area 0'],15000);roles(sim);assertRoutes(sim);allTraffic(sim);
});
test('one-sided transit area mismatch withdraws that LAN without destroying the independent DR/BDR roles',()=>{
 const sim=load('completed');change(sim,'R4',['interface g0/1','no ip ospf 10 area 0','ip ospf 10 area 1'],15000);assert.equal(goal(sim,'r4-area0'),false);assert.equal(goal(sim,'neighbor-states'),false);assert.equal(state(sim,'R1').role,'DR');assert.equal(state(sim,'R2').role,'BDR');noTraffic(sim);change(sim,'R4',['interface g0/1','no ip ospf 10 area 1','ip ospf 10 area 0'],15000);roles(sim);assertRoutes(sim);allTraffic(sim);
});
test('an asymmetric outbound cost changes the real metric despite a healthy election and successful traffic',()=>{
 const sim=load('completed');change(sim,'R3',['interface g0/1','ip ospf cost 20']);roles(sim);assert.equal(goal(sim,'neighbor-states'),true);assert.equal(goal(sim,'r3-area0'),false);assert.equal(goal(sim,'learned-lans'),false);assert.equal(route(sim,'R3')!.metric,21);assert.equal(route(sim,'R4')!.metric,11);allTraffic(sim);change(sim,'R3',['interface g0/1','ip ospf cost 10']);assertRoutes(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('published verification commands expose peer roles, Network LSA ownership and routed data that bypasses the DR',()=>{
 const sim=load('completed'),resources=catalogGuideResources(catalog)!;assert.equal(resources.rows.length,8);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);allTraffic(sim);for(const[name,commands]of Object.entries(resources.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command),text=out.join('\n');assert.ok(!out.some(iosRejected),name+': '+command+'\n'+text);assert.doesNotMatch(text,/not implemented|not recognized/i);if(command==='show ip ospf neighbor'&&['R3','R4'].includes(name)){assert.match(text,/FULL\/\s*DR/);assert.match(text,/FULL\/\s*BDR/);assert.match(text,/2WAY\/\s*DROTHER/);}if(command==='show ip ospf database network')assert.match(text,/Advertising Router: 1.1.1.1/);if(command.startsWith('show ip route 192.168.'))assert.match(text,/distance 110, metric 11, type intra area/);if(command.startsWith('ping'))assert.match(text,/Received = 3/);if(command.startsWith('tracert')){assert.match(text,/Trace complete/);assert.doesNotMatch(text,/10.0.123.[12](?:\s|$)/);}}}const since=sim.clock.now();assert.equal(ping(sim,'PC1','192.168.40.10'),2);const sends=sim.events.filter(e=>e.time>=since&&e.packet?.destination==='192.168.40.10'&&e.disposition==='send');assert.ok(sends.some(e=>e.nodeId===id('R3')&&e.port===g(1)));assert.ok(!sends.some(e=>[id('R1'),id('R2')].includes(e.nodeId)));
});
test('saved shared startup rebuilds elections and earned traffic while a returning individual router does not preempt',()=>{
 const sim=load('completed');allTraffic(sim);const fresh=copied(sim);roles(fresh);assert.equal(lessonProgress(fresh)!.complete,10);fresh.power(id('R1'),false);fresh.advance(7000);roles(fresh,'R2',null,['R2','R3','R4']);allTraffic(fresh);fresh.power(id('R1'),true);fresh.advance(15000);roles(fresh,'R2','R1');assert.equal(goal(fresh,'elected-roles'),false);allTraffic(fresh);const restarted=copied(fresh);roles(restarted);assertRoutes(restarted);allTraffic(restarted);assert.equal(lessonProgress(restarted)!.complete,10);
});
test('election role and configured-priority criteria are bounded and preserve older OSPFv2/OSPFv3 guide compatibility',()=>{
 const lesson=(createCatalogLab(catalog).lab as CatalogLab).lesson!,base={kind:'ospf-interface',device:id('R3'),interface:g(1)};validateLesson(lesson);for(const bad of [{...base,role:''},{...base,role:'dr'},{...base,role:null},{...base,role:'ROOT'},{...base,configuredPriority:-1},{...base,configuredPriority:256},{...base,configuredPriority:1.5},{...base,configuredPriority:'0'},{...base,configuredPriority:null}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion:bad}]}));const sim=load('completed');assert.equal(matches(sim,{...base,kind:'ospf-interface',role:'DROTHER',configuredPriority:0}),true);assert.equal(matches(sim,{...base,kind:'ospf-interface',role:'DR'}),false);const legacy=new Simulator();legacy.load(createCatalogLab('ospf-point-to-point','completed'));legacy.advance(7000);assert.equal(matches(legacy,{kind:'ospf-interface',device:'device-ospf-p2p-r1',interface:g(1),role:'POINT-TO-POINT'}),true);const six=new Simulator();six.load(createCatalogLab('single-area-ospfv3','completed'));six.advance(7000);const old:Criterion={kind:'ospf-interface',device:'device-ospfv3-r1',interface:g(1),protocol:'ospfv3',area:0};assert.equal(matches(six,old),true);assert.equal(matches(six,{...old,role:'POINT-TO-POINT'}),true);
});
