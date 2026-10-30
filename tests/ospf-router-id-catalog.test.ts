import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {ospfLiveDetail} from '../src/ospf-packets.ts';
import {activeIOSOSPFRouterId} from '../src/ospf-router-id.ts';
import {routingDevice} from '../src/routing-scope.ts';
import {defaultInterface} from '../src/model.ts';
import {createCatalogLab,OSPF_ROUTER_ID_COMMANDS as COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,validateLesson,matches,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='ospf-router-id',id=(name:string)=>'device-ospf-rid-'+name.toLowerCase(),g=(n:number)=>`GigabitEthernet0/${n}`,expected={R1:'1.1.1.1',R2:'172.16.2.2',R3:'192.168.30.1'};
const traffic=[['PC1','192.168.30.10'],['PC2','192.168.10.10'],['PC1','192.168.20.10'],['SRV1','192.168.30.10']];
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(6000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function change(sim:Simulator,name:string,lines:readonly string[],wait=6000){run(sim,name,['enable','configure terminal',...lines,'end']);sim.advance(wait);}
function restart(sim:Simulator,name:string){const c=run(sim,name,['enable']);c.execute('clear ip ospf 10 process');assert.equal(c.prompt,'Reset OSPF process 10? [no]: ');c.execute('yes');sim.advance(15000);}
const active=(sim:Simulator,name:string)=>activeIOSOSPFRouterId(sim.getDevice(id(name))!);
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const route=(sim:Simulator,name:string,net:number)=>sim.getDevice(id(name))!.runtime.routes.find(r=>r.network===`192.168.${net}.0`&&r.protocol==='O');
const full=(sim:Simulator,name:string)=>sim.getDevice(id(name))!.runtime.neighbors.filter(n=>n.protocol==='OSPF'&&n.state==='FULL');
const ping=(sim:Simulator,name:string,target:string)=>{const p=sim.ping(id(name),target,{count:2});sim.advance(4000);return p.received;};
function allTraffic(sim:Simulator){for(const[name,target]of traffic)assert.equal(ping(sim,name,target),2);lessonProgress(sim);}
function assertIds(sim:Simulator,ids=expected){for(const[name,rid]of Object.entries(ids)){const d=sim.getDevice(id(name))!,live=ospfLiveDetail(sim,d.id,'ospf')!;assert.equal(active(sim,name),rid);assert.ok(live.interfaces.every(p=>p.routerId===rid));for(const peer of sim.lab.devices)for(const n of peer.runtime.neighbors.filter(n=>n.protocol==='OSPF'&&n.deviceId===d.id))assert.equal(n.routerId,rid);}}
function assertRoutes(sim:Simulator){for(const[name,subnet,hop,n,metric]of [['R1',20,'10.0.12.2',1,11],['R1',30,'10.0.12.2',1,21],['R2',10,'10.0.12.1',1,11],['R2',30,'10.0.23.3',2,11],['R3',10,'10.0.23.2',1,21],['R3',20,'10.0.23.2',1,11]]as const){const r=route(sim,name,subnet)!;assert.equal(r.ad,110);assert.equal(r.metric,metric);assert.equal(r.nextHop,hop);assert.equal(r.interface,g(n));}}
const fresh=(sim:Simulator)=>{const e=new Simulator();e.load(parseLabFile(serializeLabFile(sim.serialize())));e.advance(6000);return e;};

test('router-ID practice is independent, addressed and zero-credit with no OSPF or static routes',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const sim=load();assert.equal(sim.lab.devices.length,6);assert.equal(sim.lab.links.length,5);assert.equal(lessonProgress(sim)!.complete,0);for(const name of Object.keys(expected)){assert.deepEqual(sim.getDevice(id(name))!.config.protocols,{});assert.deepEqual(sim.getDevice(id(name))!.config.staticRoutes,[]);}assert.equal(ping(sim,'PC1','192.168.10.1'),2);assert.equal(ping(sim,'PC1','192.168.30.10'),0);assert.equal(lessonProgress(sim)!.complete,0);
});
test('published IOS commands and completed reference earn six live goals and require four real echo checks for ten tasks',()=>{
 for(const mode of ['practice','completed']as const){const sim=load(mode);if(mode==='practice'){for(const[name,lines]of Object.entries(COMMANDS))run(sim,name,lines);sim.advance(6000);}assert.equal(lessonProgress(sim)!.complete,6);assertIds(sim);assertRoutes(sim);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);}
});
test('selection honors manual precedence, highest active loopback and highest up/up physical address, excluding shut or unconnected candidates',()=>{
 const sim=load('completed');assertIds(sim);const r1=sim.getDevice(id('R1'))!,r2=sim.getDevice(id('R2'))!,r3=sim.getDevice(id('R3'))!;assert.ok(!Object.values(r1.config.interfaces).some(p=>p.ip==='1.1.1.1'));assert.equal(r2.config.protocols.ospf.routerId,undefined);assert.equal(r3.config.protocols.ospf.routerId,undefined);assert.equal(sim.interfaceUp(r2.id,'Loopback99'),false);assert.equal(r3.config.interfaces[g(2)].adminUp,true);assert.equal(sim.interfaceUp(r3.id,g(2)),false);assert.ok(!Object.keys(r3.config.interfaces).some(n=>n.startsWith('Loopback')));
});
test('received Hello/database packets form all intended Full peers and three router LSAs while IDs alone create no destination route',()=>{
 const sim=load('completed');for(const[name,count]of [['R1',1],['R2',2],['R3',1]]as const){assert.equal(full(sim,name).length,count);assert.equal(ospfLiveDetail(sim,id(name),'ospf')!.lsas.length,3);assert.ok(sim.events.some(e=>e.nodeId===id(name)&&e.packet?.protocol==='OSPF'&&e.disposition==='receive'));}assert.equal(ping(sim,'PC1','1.1.1.1'),0);assert.equal(ping(sim,'PC1','172.16.2.2'),0);allTraffic(sim);assertRoutes(sim);
});
test('passive LANs advertise their prefixes without sending Hellos toward PCs or the server',()=>{
 const sim=load('completed');sim.advance(15000);for(const name of Object.keys(expected))assert.ok(!sim.events.some(e=>e.nodeId===id(name)&&e.port===g(0)&&e.packet?.protocol==='OSPF'&&e.disposition==='send'));allTraffic(sim);
});
test('manual changes after neighbors form remain pending in running-config while process, interface, protocols and peer output retain the active ID',()=>{
 const sim=load('completed');change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);assert.equal(sim.getDevice(id('R1'))!.config.protocols.ospf.routerId,'9.9.9.9');assertIds(sim);assert.equal(goal(sim,'manual-id'),false);const c=run(sim,'R1',['enable']);for(const line of ['show ip ospf','show ip ospf interface g0/1','show ip protocols']){const text=c.execute(line).join('\n');assert.match(text,/1.1.1.1/);assert.doesNotMatch(text,/9.9.9.9/);}assert.match(c.execute('show running-config | section router ospf').join('\n'),/router-id 9.9.9.9/);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,9);
});
test('re-entering the process or replacing the running configuration object cannot apply a pending ID without restart',()=>{
 const sim=load('completed');change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);change(sim,'R1',['router ospf 10']);assertIds(sim);const d=sim.getDevice(id('R1'))!;d.config=structuredClone(d.config);sim.changed();sim.advance(6000);assertIds(sim);assertRoutes(sim);restart(sim,'R1');assertIds(sim,{...expected,R1:'9.9.9.9'});
});
test('empty, no and Ctrl-C answers cancel the default-no clear prompt without changing active ID or Full neighbors',()=>{
 const sim=load('completed');change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);const c=run(sim,'R1',['enable']);for(const answer of ['', 'no']){c.execute('clear ip ospf process');assert.equal(c.prompt,'Reset ALL OSPF processes? [no]: ');c.execute(answer);assert.equal(c.prompt,'R1#');assertIds(sim);assert.equal(full(sim,'R1').length,1);}c.execute('clear ip ospf 10 process');c.cancel();assert.equal(c.prompt,'R1#');assertIds(sim);
});
test('confirmed process restart applies the pending ID, restarts uptime, withdraws learned state and requires delivered exchange to recover',()=>{
 const sim=load('completed');change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);const c=run(sim,'R1',['enable']);c.execute('clear ip ospf 10 process');c.execute('maybe');assert.match(c.prompt,/Reset OSPF process 10/);assertIds(sim);const at=sim.clock.now();c.execute('yes');assert.equal(route(sim,'R1',30),undefined);assert.equal(ospfLiveDetail(sim,id('R1'),'ospf')!.started,at);sim.advance(15000);assertIds(sim,{...expected,R1:'9.9.9.9'});assertRoutes(sim);allTraffic(sim);change(sim,'R1',['router ospf 10','router-id 1.1.1.1']);restart(sim,'R1');assertIds(sim);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('a new loopback does not replace an established automatic physical ID until process restart',()=>{
 const sim=load('completed');change(sim,'R3',['interface Loopback1','ip address 3.3.3.3 255.255.255.255','no shutdown']);assertIds(sim);restart(sim,'R3');assertIds(sim,{...expected,R3:'3.3.3.3'});assert.equal(goal(sim,'physical-id'),false);allTraffic(sim);change(sim,'R3',['no interface Loopback1']);restart(sim,'R3');assertIds(sim);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('enabling a higher loopback keeps the selected ID until restart, and shutting it before another restart restores the lower eligible loopback',()=>{
 const sim=load('completed');change(sim,'R2',['interface Loopback99','no shutdown']);assertIds(sim);restart(sim,'R2');assertIds(sim,{...expected,R2:'203.0.113.254'});allTraffic(sim);change(sim,'R2',['interface Loopback99','shutdown']);restart(sim,'R2');assertIds(sim);allTraffic(sim);
});
test('a manual override equal to an automatic ID cannot earn the no-manual-override guide goal',()=>{
 const sim=load('completed');change(sim,'R2',['router ospf 10','router-id 172.16.2.2']);assertIds(sim);assert.equal(goal(sim,'loopback-id'),false);allTraffic(sim);change(sim,'R2',['router ospf 10','no router-id']);restart(sim,'R2');assertIds(sim);assert.equal(goal(sim,'loopback-id'),true);
});
test('a duplicate ID is pending first, then prevents the affected adjacency after restart until a unique ID is restored',()=>{
 const sim=load('completed');change(sim,'R1',['router ospf 10','router-id 172.16.2.2']);assertIds(sim);restart(sim,'R1');assert.equal(full(sim,'R1').length,0);assert.equal(full(sim,'R2').length,1);assert.equal(full(sim,'R3').length,1);assert.equal(goal(sim,'full-neighbors'),false);assert.equal(ping(sim,'PC1','192.168.30.10'),0);assert.equal(ping(sim,'PC2','192.168.20.10'),2);change(sim,'R1',['router ospf 10','router-id 1.1.1.1']);restart(sim,'R1');assertIds(sim);assertRoutes(sim);allTraffic(sim);
});
test('unknown process IDs and malformed clear commands do not clear a different process or install a pending ID',()=>{
 const sim=load('completed');change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);const c=run(sim,'R1',['enable']);c.execute('clear ip ospf 99 process');assert.equal(c.prompt,'R1#');for(const line of ['clear ip ospf 0 process','clear ip ospf 65536 process','clear ip ospf 10 process extra'])assert.ok(c.execute(line).some(iosRejected));assertIds(sim);assertRoutes(sim);
});
test('clearing counters, events or forcing SPF does not act as a process restart for pending router IDs',()=>{
 const sim=load('completed');change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);run(sim,'R1',['enable','clear ip ospf counters','clear ip ospf events','clear ip ospf force-spf']);sim.advance(6000);assertIds(sim);assertRoutes(sim);allTraffic(sim);
});
test('removing and recreating the process starts a fresh automatic selection rather than reusing deleted process identity',()=>{
 const sim=load('completed');change(sim,'R1',['no router ospf 10','router ospf 10']);assert.equal(active(sim,'R1'),'198.51.100.11');for(const[name,lines]of Object.entries(COMMANDS))run(sim,name,lines);restart(sim,'R1');sim.advance(6000);assertIds(sim);allTraffic(sim);
});
test('device reboot selects the startup configuration ID and rebuilds genuine adjacency and traffic',()=>{
 const sim=load('completed');allTraffic(sim);change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);restart(sim,'R1');assert.equal(active(sim,'R1'),'9.9.9.9');sim.power(id('R1'),false);sim.power(id('R1'),true);sim.advance(15000);assertIds(sim);assertRoutes(sim);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('portable reload reselects from saved configuration and does not serialize a stale active-ID cache',()=>{
 const sim=load('completed');allTraffic(sim);change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);assertIds(sim);const doc=sim.serialize();assert.ok(!JSON.stringify(doc).includes('established'));const copy=fresh(sim);assertIds(copy,{...expected,R1:'9.9.9.9'});assert.equal(goal(copy,'manual-id'),false);assertRoutes(copy);allTraffic(copy);change(copy,'R1',['router ospf 10','router-id 1.1.1.1']);restart(copy,'R1');allTraffic(copy);assert.equal(lessonProgress(copy)!.complete,10);
});
test('automatic identity selection is isolated across default and named VRFs even when process IDs are equal',()=>{
 const sim=new Simulator(),d=sim.addDevice('router');d.config.features.vrfs={BLUE:{}};d.config.interfaces.Loopback0={...defaultInterface('Loopback0'),adminUp:true,ip:'10.0.0.1',mask:'255.255.255.255'};d.config.interfaces.Loopback1={...defaultInterface('Loopback1'),adminUp:true,ip:'10.1.0.1',mask:'255.255.255.255',vrf:'BLUE'};d.config.protocols.ospf={processId:10,networks:[],vrfs:{BLUE:{processId:10,networks:[]}}};sim.changed();assert.equal(activeIOSOSPFRouterId(d),'10.0.0.1');assert.equal(activeIOSOSPFRouterId(routingDevice(d,'BLUE')),'10.1.0.1');delete d.config.protocols.ospf.vrfs.BLUE;sim.changed();d.config.protocols.ospf.vrfs.BLUE={processId:10,networks:[],routerId:'2.2.2.2'};sim.changed();assert.equal(activeIOSOSPFRouterId(d),'10.0.0.1');assert.equal(activeIOSOSPFRouterId(routingDevice(d,'BLUE')),'2.2.2.2');
});
test('an address on a down physical interface cannot supply an ID; a later eligible loopback allows selection',()=>{
 const sim=new Simulator(),d=sim.addDevice('router');Object.assign(d.config.interfaces[g(0)],{adminUp:true,ip:'203.0.113.1',mask:'255.255.255.0'});d.config.protocols.ospf={processId:10,networks:[]};sim.changed();assert.equal(sim.interfaceUp(d.id,g(0)),false);assert.equal(activeIOSOSPFRouterId(d),'0.0.0.0');d.config.interfaces.Loopback0={...defaultInterface('Loopback0'),adminUp:true,ip:'10.1.1.1',mask:'255.255.255.255'};sim.changed();assert.equal(activeIOSOSPFRouterId(d),'10.1.1.1');
});
test('invalid and zero manual IDs are rejected atomically without changing the active process',()=>{
 const sim=load('completed'),c=run(sim,'R1',['enable','configure terminal','router ospf 10']);const before=JSON.stringify(sim.getDevice(id('R1'))!.config);for(const line of ['router-id 0.0.0.0','router-id bad','router-id 2001:db8::1','router-id 9.9.9.9 extra','no router-id bad']){assert.ok(c.execute(line).some(iosRejected));assert.equal(JSON.stringify(sim.getDevice(id('R1'))!.config),before);}assertIds(sim);
});
test('configured-ID criteria validate bounded IPv4 or null and distinguish configured versus operational state',()=>{
 const lesson=(createCatalogLab(catalog).lab as CatalogLab).lesson!,base={kind:'ospf-interface',device:id('R1'),interface:g(1)};validateLesson(lesson);for(const configuredRouterId of ['',0,false,'0.0.0.0','2001:db8::1','x'.repeat(129)])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion:{...base,configuredRouterId}}]}));const sim=load('completed'),old:Criterion={kind:'ospf-interface',device:id('R1'),interface:g(1),routerId:'1.1.1.1'};assert.equal(matches(sim,old),true);assert.equal(matches(sim,{...old,configuredRouterId:'1.1.1.1'}),true);assert.equal(matches(sim,{...old,configuredRouterId:null}),false);change(sim,'R1',['router ospf 10','router-id 9.9.9.9']);assert.equal(matches(sim,old),true);assert.equal(matches(sim,{...old,configuredRouterId:'1.1.1.1'}),false);assert.equal(matches(sim,{...old,configuredRouterId:'9.9.9.9'}),true);
});
test('all published verification commands show active IDs, actual peers/routes and successful Windows traffic',()=>{
 const sim=load('completed'),resources=catalogGuideResources(catalog)!;assert.equal(resources.rows.length,12);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);allTraffic(sim);for(const[name,commands]of Object.entries(resources.verification)){const c=new IOSSession(sim,id(name));if(!c.windowsMode)c.execute('enable');for(const line of commands){const out=c.execute(line),text=out.join('\n');assert.ok(!out.some(iosRejected),name+': '+line+'\n'+text);assert.doesNotMatch(text,/not implemented|not recognized/i);if(['show ip ospf','show ip ospf interface GigabitEthernet0/1','show ip protocols'].includes(line))assert.ok(text.includes(expected[name as keyof typeof expected]));if(line.startsWith('ping'))assert.match(text,/Received = 3/);if(line.startsWith('tracert'))assert.match(text,/Trace complete/);}}
});
test('transit interface bounce cannot replace an automatic ID with a newly introduced higher loopback',()=>{
 const sim=load('completed');change(sim,'R2',['interface Loopback2','ip address 172.16.2.10 255.255.255.255','no shutdown','interface g0/1','shutdown','interface g0/2','shutdown']);assert.equal(active(sim,'R2'),'172.16.2.2');change(sim,'R2',['interface g0/1','no shutdown','interface g0/2','no shutdown'],15000);assertIds(sim);allTraffic(sim);restart(sim,'R2');assertIds(sim,{...expected,R2:'172.16.2.10'});
});
test('a manual ID configured before any neighbor exists becomes active without an unnecessary restart notice',()=>{
 const sim=load(),c=run(sim,'R1',['enable','configure terminal','router ospf 10']);const out=c.execute('router-id 1.1.1.1');assert.deepEqual(out,[]);assert.equal(active(sim,'R1'),'1.1.1.1');c.execute('no router-id 1.1.1.1');assert.equal(active(sim,'R1'),'198.51.100.11');
});
