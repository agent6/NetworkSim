import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,IPV4_STATIC_ROUTING_COMMANDS as COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='ipv4-static-routing',id=(name:string)=>'device-ipv4-static-'+name.toLowerCase(),g=(n:number)=>`GigabitEthernet0/${n}`;
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(1500);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function change(sim:Simulator,name:string,lines:readonly string[]){run(sim,name,['enable','configure terminal',...lines,'end']);sim.advance(1500);}
function configure(sim:Simulator){for(const[name,lines]of Object.entries(COMMANDS))run(sim,name,lines);sim.advance(1500);}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const routes=(sim:Simulator,name:string,network:string)=>sim.getDevice(id(name))!.runtime.routes.filter(r=>r.network===network&&r.protocol==='static');
const ping=(sim:Simulator,name:string,target:string)=>{const p=sim.ping(id(name),target,{count:2});sim.advance(4000);return p.received;};
function allTraffic(sim:Simulator){for(const[name,target]of [['PC1','192.168.20.10'],['PC1','192.168.30.10'],['SRV1','192.168.10.10'],['PC1','198.51.100.3'],['PC1','203.0.113.33']])assert.equal(ping(sim,name,target),2);lessonProgress(sim);}

test('IPv4 static practice has independent valid attempts, ready addressing and gateways, no remote routes and zero earned tasks',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const sim=load();assert.equal(sim.lab.devices.length,6);assert.equal(sim.lab.links.length,6);assert.equal(lessonProgress(sim)!.complete,0);for(const n of ['R1','R2','R3']){assert.deepEqual(sim.getDevice(id(n))!.config.staticRoutes,[]);assert.deepEqual(sim.getDevice(id(n))!.config.protocols,{});for(const p of [0,1,2])assert.equal(sim.getDevice(id(n))!.config.interfaces[g(p)].features.proxyArp,false);}assert.equal(ping(sim,'PC1','192.168.10.1'),2);assert.equal(ping(sim,'PC1','192.168.20.10'),0);assert.equal(lessonProgress(sim)!.complete,0);
});
test('published commands install all required routes, save all three startup configurations and require real traffic to complete the guide',()=>{
 const sim=load();configure(sim);assert.equal(lessonProgress(sim)!.complete,5);for(const n of ['R1','R2','R3'])assert.deepEqual(sim.getDevice(id(n))!.startupConfig,sim.getDevice(id(n))!.config);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);assert.equal(ping(sim,'PC2','192.168.10.10'),2);assert.equal(ping(sim,'PC2','192.168.30.10'),2);const reference=load('completed');assert.equal(lessonProgress(reference)!.complete,5);allTraffic(reference);assert.equal(lessonProgress(reference)!.complete,10);
});
test('floating routes remain configured but inactive while the same-prefix AD 1 primary is installed',()=>{
 const sim=load('completed');for(const[name,network]of [['R1','192.168.30.0'],['R3','192.168.10.0']]){const rib=routes(sim,name,network);assert.equal(rib.length,1);assert.equal(rib[0].ad,1);assert.equal(rib[0].interface,g(2));assert.ok(sim.getDevice(id(name))!.config.staticRoutes.some(r=>r.network===network&&r.ad===10&&r.interface===g(1)));}assert.equal(goal(sim,'floating-backups'),true);
});
test('primary-link shutdown withdraws fully specified routes, installs both AD 10 backups and preserves actual bidirectional server traffic through R2',()=>{
 const sim=load('completed');change(sim,'R1',['interface g0/2','shutdown']);assert.equal(sim.interfaceUp(id('R3'),g(2)),false);for(const[name,network,nextHop]of [['R1','192.168.30.0','10.0.12.2'],['R3','192.168.10.0','10.0.23.1']]){const rib=routes(sim,name,network);assert.equal(rib.length,1);assert.equal(rib[0].ad,10);assert.equal(rib[0].nextHop,nextHop);assert.equal(rib[0].interface,g(1));}assert.equal(goal(sim,'r1-network-routes'),false);assert.equal(goal(sim,'return-routes'),false);assert.equal(goal(sim,'host-route'),false);const before=sim.events.length;assert.equal(ping(sim,'PC1','192.168.30.10'),2);assert.equal(ping(sim,'SRV1','192.168.10.10'),2);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('R2')&&e.disposition==='send'&&e.protocol==='ICMP'&&e.packet?.destination==='192.168.30.10'));change(sim,'R1',['interface g0/2','no shutdown']);assert.equal(routes(sim,'R1','192.168.30.0')[0].ad,1);assert.equal(routes(sim,'R3','192.168.10.0')[0].ad,1);assert.equal(goal(sim,'host-route'),true);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('the backup criterion checks the configured distance and cannot be earned by an ordinary AD 1 or incorrectly bound backup',()=>{
 const sim=load('completed');change(sim,'R1',['no ip route 192.168.30.0 255.255.255.0 GigabitEthernet0/1 10.0.12.2 10','ip route 192.168.30.0 255.255.255.0 GigabitEthernet0/1 10.0.12.2 1']);assert.equal(goal(sim,'floating-backups'),false);assert.equal(ping(sim,'PC1','192.168.30.10'),2);configure(sim);assert.equal(goal(sim,'floating-backups'),true);
});
test('a /32 with AD 200 uses the direct link while a destination covered only by AD 1 defaults actually traverses R2',()=>{
 const sim=load('completed');let before=sim.events.length;assert.equal(ping(sim,'PC1','203.0.113.33'),2);const host=sim.events.slice(before);assert.ok(host.some(e=>e.nodeId===id('R1')&&e.port===g(2)&&e.protocol==='ICMP'&&e.disposition==='send'&&e.packet?.destination==='203.0.113.33'));assert.ok(!host.some(e=>e.nodeId===id('R2')&&e.protocol==='ICMP'&&e.disposition==='send'&&e.packet?.destination==='203.0.113.33'));before=sim.events.length;assert.equal(ping(sim,'PC1','198.51.100.3'),2);const def=sim.events.slice(before);for(const[name,n]of [['R1',1],['R2',2]]as const)assert.ok(def.some(e=>e.nodeId===id(name)&&e.port===g(n)&&e.protocol==='ICMP'&&e.disposition==='send'&&e.packet?.destination==='198.51.100.3'));
});
test('removing the host route allows default forwarding but revokes host-route configuration credit',()=>{
 const sim=load('completed');change(sim,'R1',['no ip route 203.0.113.33 255.255.255.255 GigabitEthernet0/2 10.0.13.2 200']);assert.equal(goal(sim,'host-route'),false);const before=sim.events.length;assert.equal(ping(sim,'PC1','203.0.113.33'),2);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('R2')&&e.disposition==='send'&&e.packet?.destination==='203.0.113.33'));configure(sim);assert.equal(goal(sim,'host-route'),true);
});
test('removing a default breaks only destinations that depend on it while more-specific network and host routes remain usable',()=>{
 const sim=load('completed');change(sim,'R1',['no ip route 0.0.0.0 0.0.0.0 10.0.12.2']);assert.equal(goal(sim,'default-routes'),false);assert.equal(ping(sim,'PC1','198.51.100.3'),0);assert.equal(ping(sim,'PC1','203.0.113.33'),2);assert.equal(ping(sim,'PC1','192.168.20.10'),2);assert.equal(ping(sim,'PC1','192.168.30.10'),2);configure(sim);assert.equal(ping(sim,'PC1','198.51.100.3'),2);
});
test('a missing R3 return route breaks PC2-to-server echo even with the correct forward route, and repair restores both directions',()=>{
 const sim=load('completed');change(sim,'R3',['no ip route 192.168.20.0 255.255.255.0 10.0.23.1']);assert.equal(goal(sim,'return-routes'),false);assert.equal(routes(sim,'R2','192.168.30.0')[0].nextHop,'10.0.23.2');assert.equal(ping(sim,'PC2','192.168.30.10'),0);assert.equal(ping(sim,'PC1','192.168.30.10'),2);configure(sim);assert.equal(ping(sim,'PC2','192.168.30.10'),2);assert.equal(ping(sim,'SRV1','192.168.20.10'),2);
});
test('unknown destinations stop at R3 rather than circulating around a default-routing loop',()=>{
 const sim=load('completed'),before=sim.events.length;assert.equal(ping(sim,'PC1','198.51.100.250'),0);const sent=sim.events.slice(before).filter(e=>e.protocol==='ICMP'&&e.disposition==='send'&&e.packet?.destination==='198.51.100.250');assert.equal(sent.filter(e=>e.nodeId===id('R1')).length,2);assert.equal(sent.filter(e=>e.nodeId===id('R2')).length,2);assert.equal(sent.filter(e=>e.nodeId===id('R3')).length,0);assert.equal(routes(sim,'R3','0.0.0.0').length,0);
});
test('matching a destination and next hop is insufficient when the required exit interface or administrative distance is wrong',()=>{
 const sim=load('completed');change(sim,'R1',['no ip route 203.0.113.33 255.255.255.255 GigabitEthernet0/2 10.0.13.2 200','ip route 203.0.113.33 255.255.255.255 GigabitEthernet0/2 10.0.13.2 201']);assert.equal(ping(sim,'PC1','203.0.113.33'),2);assert.equal(goal(sim,'host-route'),false);configure(sim);assert.equal(goal(sim,'host-route'),true);
});
test('all published verification commands work and show S, S*, primary distance 1, host distance 200 and a real gateway of last resort',()=>{
 const sim=load('completed'),resources=catalogGuideResources(catalog)!;assert.equal(resources.rows.length,14);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);for(const[name,commands]of Object.entries(resources.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));assert.ok(!out.some(x=>/not implemented|not recognized/i.test(x)),command);if(command==='show ip route static'&&name==='R1'){const text=out.join('\n');assert.match(text,/Gateway of last resort is 10\.0\.12\.2/);assert.match(text,/S\*\s+0\.0\.0\.0\/0 \[1\/0\] via 10\.0\.12\.2/);assert.match(text,/192\.168\.30\.0\/24 \[1\/0\] via 10\.0\.13\.2, GigabitEthernet0\/2/);assert.match(text,/203\.0\.113\.33 \[200\/0\] via 10\.0\.13\.2/);assert.doesNotMatch(text,/\[10\/0\]/);}if(command.startsWith('ping'))assert.match(out.join('\n'),/Received = 3/);}}
});
test('saved reloads and startup power cycles preserve addressing, route intent and earned traffic while active routes are rebuilt',()=>{
 const sim=load('completed');allTraffic(sim);sim.getDevice(id('R1'))!.config.hostname='EdgeRouter';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(1500);assert.equal(lessonProgress(fresh)!.complete,10);change(fresh,'R1',['no ip route 0.0.0.0 0.0.0.0 10.0.12.2']);assert.equal(goal(fresh,'default-routes'),false);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(1500);assert.equal(goal(fresh,'default-routes'),true);allTraffic(fresh);assert.equal(lessonProgress(fresh)!.complete,10);
});
test('imported route distance/interface and static-configuration criteria reject malformed data and preserve existing route goals',()=>{
 const lesson=(createCatalogLab(catalog).lab as CatalogLab).lesson!;validateLesson(lesson);const base={kind:'route',device:'R1',network:'192.0.2.0',prefix:24,protocol:'static'};for(const criterion of [{...base,ad:-1},{...base,ad:256},{...base,ad:'1'},{...base,interface:''},{kind:'static-route',device:'R1',network:'bad',prefix:24,nextHop:'10.0.12.2',interface:g(1),ad:10},{kind:'static-route',device:'R1',network:'192.0.2.0',prefix:33,nextHop:'10.0.12.2',interface:g(1),ad:10},{kind:'static-route',device:'R1',network:'192.0.2.0',prefix:24,nextHop:'10.0.12.2',interface:g(1),ad:0}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));validateLesson({...lesson,objectives:[{id:'old',title:'Old route goal',criterion:base}]});
});
