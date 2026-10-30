import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {sameAddress} from '../src/ip.ts';
import {createCatalogLab,FLOATING_STATIC_ROUTE_COMMANDS as COMMANDS,catalogGuideResources} from '../src/lab-catalog.ts';
import {lessonProgress} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='floating-static-route',id=(name:string)=>'device-floating-static-'+name.toLowerCase(),g=(n:number)=>`GigabitEthernet0/${n}`;
const v4backup='ip route 192.168.30.0 255.255.255.0 GigabitEthernet0/1 10.0.12.2 10',v6backup='ipv6 route 2001:db8:30::/64 GigabitEthernet0/1 fe80::2 10';
const traffic=[['PC1','192.168.30.10'],['PC1','2001:db8:30::10'],['SRV1','192.168.10.10'],['SRV1','2001:db8:10::10']];
const expected=[['R1','192.168.30.0','10.0.13.2','10.0.12.2'],['R1','2001:db8:30::','fe80::3','fe80::2'],['R3','192.168.10.0','10.0.13.1','10.0.23.1'],['R3','2001:db8:10::','fe80::1','fe80::2']];
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(4000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function change(sim:Simulator,name:string,lines:readonly string[]){run(sim,name,['enable','configure terminal',...lines,'end']);sim.advance(4000);}
function configure(sim:Simulator){for(const[name,lines]of Object.entries(COMMANDS))run(sim,name,lines);sim.advance(4000);}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const routes=(sim:Simulator,name:string,network:string)=>sim.getDevice(id(name))!.runtime.routes.filter(r=>sameAddress(r.network,network)&&r.protocol==='static');
const ping=(sim:Simulator,name:string,target:string)=>{const p=sim.ping(id(name),target,{count:2});sim.advance(4000);return p.received;};
function allTraffic(sim:Simulator){for(const[name,target]of traffic)assert.equal(ping(sim,name,target),2,`${name} → ${target}`);lessonProgress(sim);}
function primary(sim:Simulator,up:boolean,name='R1'){change(sim,name,['interface g0/2',up?'no shutdown':'shutdown']);}
function assertRoutes(sim:Simulator,backup:boolean){for(const[name,network,primaryHop,backupHop]of expected){const rib=routes(sim,name,network);assert.equal(rib.length,1,`${name} ${network}`);assert.equal(rib[0].ad,backup?10:1);assert.equal(rib[0].interface,g(backup?1:2));assert.equal(rib[0].nextHop,backup?backupHop:primaryHop);}}
function assertPaths(sim:Simulator,backup:boolean){for(const[name,target]of traffic){const before=sim.events.length;assert.equal(ping(sim,name,target),2);const events=sim.events.slice(before).filter(e=>e.disposition==='send'&&e.packet?.destination===target);assert.ok(events.some(e=>e.nodeId===id(name==='PC1'?'R1':'R3')&&e.port===g(backup?1:2)));assert.equal(events.some(e=>e.nodeId===id('R2')),backup);}}

test('floating-static practice has independent zero-credit attempts, ready manual gateways and only preconfigured R2 transit routes',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const sim=load();assert.equal(sim.lab.devices.length,5);assert.equal(sim.lab.links.length,5);assert.equal(lessonProgress(sim)!.complete,0);for(const name of ['R1','R3'])assert.deepEqual(sim.getDevice(id(name))!.config.staticRoutes,[]);assert.equal(sim.getDevice(id('R2'))!.config.staticRoutes.length,4);
 for(const name of ['R1','R2','R3']){const d=sim.getDevice(id(name))!;assert.equal(d.config.ipv6Routing,true);assert.deepEqual(d.config.protocols,{});assert.ok(!d.config.staticRoutes.some(r=>r.prefix===0));}for(const name of ['PC1','SRV1']){const d=sim.getDevice(id(name))!,p=d.config.interfaces.GigabitEthernet0;assert.equal(p.features.dhcp,false);assert.equal(p.features.ipv6Autoconfig,false);assert.equal(d.config.staticRoutes[0].interface,'GigabitEthernet0');}
 assert.equal(ping(sim,'PC1','192.168.10.1'),2);assert.equal(ping(sim,'PC1','2001:db8:10::1'),2);assert.equal(ping(sim,'PC1','192.168.30.10'),0);assert.equal(lessonProgress(sim)!.complete,0);
});
test('published commands and completed reference earn four configuration goals, with real echo required for all eight tasks',()=>{
 for(const mode of ['practice','completed'] as const){const sim=load(mode);if(mode==='practice')configure(sim);assert.equal(lessonProgress(sim)!.complete,4);for(const name of ['R1','R3']){const d=sim.getDevice(id(name))!;assert.deepEqual(d.startupConfig,d.config);assert.equal(d.config.staticRoutes.length,4);}allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,8);}
});
test('matching-prefix AD 10 backups remain configured but inactive while all four AD 1 primaries forward directly',()=>{
 const sim=load('completed');assertRoutes(sim,false);for(const[name,network,,nextHop]of expected)assert.ok(sim.getDevice(id(name))!.config.staticRoutes.some(r=>sameAddress(r.network,network)&&r.ad===10&&r.interface===g(1)&&r.nextHop===nextHop));assert.equal(goal(sim,'ipv4-backup'),true);assert.equal(goal(sim,'ipv6-backup'),true);assertPaths(sim,false);
});
test('primary failure withdraws both directions, installs four AD 10 backups, carries real traffic through R2 and automatically recovers',()=>{
 const sim=load('completed');allTraffic(sim);primary(sim,false);assert.equal(sim.interfaceUp(id('R3'),g(2)),false);assertRoutes(sim,true);assertPaths(sim,true);assert.equal(goal(sim,'ipv4-primary'),false);assert.equal(goal(sim,'ipv6-primary'),false);assert.equal(goal(sim,'ipv4-backup'),true);assert.equal(goal(sim,'ipv6-backup'),true);assert.equal(lessonProgress(sim)!.complete,6);primary(sim,true);assertRoutes(sim,false);assertPaths(sim,false);assert.equal(lessonProgress(sim)!.complete,8);
});
test('shutting the far end of the primary link also drives real bidirectional IPv4 and IPv6 failover and restoration',()=>{
 const sim=load('completed');primary(sim,false,'R3');assert.equal(sim.interfaceUp(id('R1'),g(2)),false);assertRoutes(sim,true);assertPaths(sim,true);primary(sim,true,'R3');assertRoutes(sim,false);assertPaths(sim,false);
});
test('a missing return backup breaks only its address family during failure despite the correctly installed forward backup',()=>{
 for(const[command,target,other,task]of [['ip route 192.168.10.0 255.255.255.0 GigabitEthernet0/1 10.0.23.1 10','192.168.30.10','2001:db8:30::10','ipv4-backup'],['ipv6 route 2001:db8:10::/64 GigabitEthernet0/1 fe80::2 10','2001:db8:30::10','192.168.30.10','ipv6-backup']]){const sim=load('completed');change(sim,'R3',['no '+command]);assert.equal(ping(sim,'PC1',target),2);assert.equal(goal(sim,task),false);primary(sim,false);assert.equal(routes(sim,'R1',target.includes(':')?'2001:db8:30::':'192.168.30.0')[0].ad,10);const before=sim.events.length;assert.equal(ping(sim,'PC1',target),0);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('R3')&&e.port===g(0)&&e.disposition==='send'&&e.packet?.destination===target));assert.equal(ping(sim,'PC1',other),2);change(sim,'R3',[command]);assertPaths(sim,true);primary(sim,true);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,8);}
});
test('equal AD is not a floating backup, and AD 255 never supplies connectivity after the primary disappears',()=>{
 const sim=load('completed');change(sim,'R1',['no '+v4backup,v4backup.replace(/10$/,'1')]);assert.equal(goal(sim,'ipv4-backup'),false);assert.ok(routes(sim,'R1','192.168.30.0').every(r=>r.ad===1));change(sim,'R1',['no '+v4backup.replace(/10$/,'1'),v4backup.replace(/10$/,'255')]);primary(sim,false);assert.equal(routes(sim,'R1','192.168.30.0').length,0);assert.equal(ping(sim,'PC1','192.168.30.10'),0);assert.equal(ping(sim,'PC1','2001:db8:30::10'),2);change(sim,'R1',['no '+v4backup.replace(/10$/,'255'),v4backup]);assertRoutes(sim,true);allTraffic(sim);
});
test('a more-specific host route preempts the primary by prefix length and cannot earn the matching-network floating-route task',()=>{
 for(const[remove,wrong,target,task]of [[v4backup,'ip route 192.168.30.10 255.255.255.255 GigabitEthernet0/1 10.0.12.2 10','192.168.30.10','ipv4-backup'],[v6backup,'ipv6 route 2001:db8:30::10/128 GigabitEthernet0/1 fe80::2 10','2001:db8:30::10','ipv6-backup']]){const sim=load('completed');change(sim,'R1',['no '+remove,wrong]);assert.equal(goal(sim,task),false);assert.equal(sim.interfaceUp(id('R1'),g(2)),true);const before=sim.events.length;assert.equal(ping(sim,'PC1',target),2);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('R2')&&e.disposition==='send'&&e.packet?.destination===target));}
});
test('an incorrectly scoped IPv6 backup cannot earn credit or deliver after primary failure, while the IPv4 backup still works',()=>{
 const sim=load('completed'),wrong=v6backup.replace('GigabitEthernet0/1','GigabitEthernet0/2');change(sim,'R1',['no '+v6backup,wrong]);assert.equal(goal(sim,'ipv6-backup'),false);primary(sim,false);assert.equal(ping(sim,'PC1','2001:db8:30::10'),0);assert.equal(ping(sim,'PC1','192.168.30.10'),2);change(sim,'R1',['no '+wrong,v6backup]);assertRoutes(sim,true);assertPaths(sim,true);
});
test('losing both paths stops remote traffic; restoring the primary repairs it without inventing another backup',()=>{
 const sim=load('completed');primary(sim,false);change(sim,'R1',['interface g0/1','shutdown']);for(const network of ['192.168.30.0','2001:db8:30::'])assert.equal(routes(sim,'R1',network).length,0);assert.equal(ping(sim,'PC1','192.168.30.10'),0);assert.equal(ping(sim,'PC1','2001:db8:30::10'),0);primary(sim,true);assertRoutes(sim,false);assertPaths(sim,false);change(sim,'R1',['interface g0/1','no shutdown']);primary(sim,false);assertPaths(sim,true);primary(sim,true);
});
test('untracked static primaries do not withdraw merely because an otherwise-up direct link drops packets',()=>{
 const sim=load('completed'),wire=sim.lab.links.find(l=>l.id==='link-floating-static-primary')!;wire.loss=1;sim.changed();sim.advance(4000);assert.equal(sim.interfaceUp(id('R1'),g(2)),true);assertRoutes(sim,false);assert.equal(ping(sim,'PC1','192.168.30.10'),0);assert.equal(ping(sim,'PC1','2001:db8:30::10'),0);wire.loss=0;sim.changed();sim.advance(4000);assertPaths(sim,false);
});
test('all published verification commands work on primary and backup paths, including actual traceroutes and route/config distance differences',()=>{
 const sim=load('completed'),resources=catalogGuideResources(catalog)!;assert.equal(resources.rows.length,10);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);
 for(const backup of [false,true]){if(backup)primary(sim,false);allTraffic(sim);for(const[name,commands]of Object.entries(resources.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command),text=out.join('\n');assert.ok(!out.some(iosRejected),`${name}: ${command}\n${text}`);assert.doesNotMatch(text,/not implemented|not recognized/i);if(name==='R1'&&command==='show ip route 192.168.30.10'){assert.match(text,new RegExp(`distance ${backup?10:1},`));assert.match(text,backup?/10\.0\.12\.2/:/10\.0\.13\.2/);}if(name==='R1'&&command==='show ipv6 route static'){assert.match(text,backup?/\[10\/0\].*\n.*FE80::2, GigabitEthernet0\/1/:/\[1\/0\].*\n.*FE80::3, GigabitEthernet0\/2/);assert.ok(!text.includes(backup?'[1/0]':'[10/0]'));}if(command.startsWith('ping'))assert.match(text,/Received = 3/);if(command.startsWith('tracert')){assert.match(text,/Trace complete/);assert.equal(text.includes(command.includes('-6')?'2001:db8:12::2':'10.0.12.2'),backup);}}}}
});
test('saved reload rebuilds active floating routes during a failed primary, and startup reboot restores the saved preferred path and progress',()=>{
 const sim=load('completed');allTraffic(sim);primary(sim,false);sim.getDevice(id('R1'))!.config.hostname='Branch';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(4000);assertRoutes(fresh,true);assert.equal(lessonProgress(fresh)!.complete,6);assertPaths(fresh,true);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(4000);assertRoutes(fresh,false);assertPaths(fresh,false);assert.equal(lessonProgress(fresh)!.complete,8);
});
