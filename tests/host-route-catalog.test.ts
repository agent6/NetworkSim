import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {sameAddress} from '../src/ip.ts';
import {createCatalogLab,HOST_ROUTE_COMMANDS as COMMANDS,catalogGuideResources} from '../src/lab-catalog.ts';
import {lessonProgress} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='host-route',id=(name:string)=>'device-host-route-'+name.toLowerCase(),g=(n:number)=>`GigabitEthernet0/${n}`;
const v4host='ip route 203.0.113.10 255.255.255.255 GigabitEthernet0/2 10.0.13.2 200',v6host='ipv6 route 2001:db8:30::10/128 GigabitEthernet0/2 fe80::3 200';
const traffic=[['PC1','203.0.113.10'],['PC1','2001:db8:30::10'],['PC1','203.0.113.20'],['PC1','2001:db8:30::20'],['SRV1','192.168.10.10'],['SRV1','2001:db8:10::10']];
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(4000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function change(sim:Simulator,name:string,lines:readonly string[]){run(sim,name,['enable','configure terminal',...lines,'end']);sim.advance(4000);}
function configure(sim:Simulator){for(const[name,lines]of Object.entries(COMMANDS))run(sim,name,lines);sim.advance(4000);}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const routes=(sim:Simulator,name:string,network:string)=>sim.getDevice(id(name))!.runtime.routes.filter(r=>sameAddress(r.network,network)&&r.protocol==='static');
const ping=(sim:Simulator,name:string,target:string)=>{const p=sim.ping(id(name),target,{count:2});sim.advance(4000);return p.received;};
function allTraffic(sim:Simulator){for(const[name,target]of traffic)assert.equal(ping(sim,name,target),2,`${name} → ${target}`);lessonProgress(sim);}
function path(sim:Simulator,target:string,port:number,viaR2:boolean){const before=sim.events.length;assert.equal(ping(sim,'PC1',target),2);const events=sim.events.slice(before).filter(e=>e.disposition==='send'&&e.packet?.destination===target);assert.ok(events.some(e=>e.nodeId===id('R1')&&e.port===g(port)));assert.equal(events.some(e=>e.nodeId===id('R2')),viaR2);}

test('host-route practice is independent, zero-credit, dual-stack and ready for local branch and same-VLAN server traffic',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const sim=load();assert.equal(sim.lab.devices.length,7);assert.equal(sim.lab.links.length,7);assert.equal(lessonProgress(sim)!.complete,0);for(const name of ['R1','R3'])assert.deepEqual(sim.getDevice(id(name))!.config.staticRoutes,[]);assert.equal(sim.getDevice(id('R2'))!.config.staticRoutes.length,4);
 for(const name of ['R1','R2','R3']){const d=sim.getDevice(id(name))!;assert.equal(d.config.ipv6Routing,true);assert.deepEqual(d.config.protocols,{});assert.ok(!d.config.staticRoutes.some(r=>r.prefix===0));}
 for(const name of ['PC1','SRV1','SRV2']){const p=sim.getDevice(id(name))!.config.interfaces.GigabitEthernet0;assert.equal(p.features.dhcp,false);assert.equal(p.features.ipv6Autoconfig,false);}
 assert.equal(ping(sim,'PC1','192.168.10.1'),2);assert.equal(ping(sim,'PC1','2001:db8:10::1'),2);assert.equal(ping(sim,'SRV1','203.0.113.20'),2);assert.equal(ping(sim,'SRV1','2001:db8:30::20'),2);assert.equal(ping(sim,'PC1','203.0.113.10'),0);assert.equal(lessonProgress(sim)!.complete,0);
 assert.ok(sim.getDevice(id('R1'))!.runtime.routes.some(r=>r.protocol==='local'&&r.network==='192.168.10.1'&&r.prefix===32));assert.equal(goal(sim,'ipv4-host'),false);
});
test('published commands and completed reference earn four configuration goals and require six genuine echo tests for all ten tasks',()=>{
 for(const mode of ['practice','completed'] as const){const sim=load(mode);if(mode==='practice')configure(sim);assert.equal(lessonProgress(sim)!.complete,4);for(const name of ['R1','R3'])assert.deepEqual(sim.getDevice(id(name))!.startupConfig,sim.getDevice(id(name))!.config);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);}
});
test('AD 200 /32 and /128 routes actually use the direct link while adjacent servers use AD 1 broader routes through R2',()=>{
 const sim=load('completed');for(const[network,prefix]of [['203.0.113.10',32],['2001:db8:30::10',128]]as const){const r=routes(sim,'R1',network)[0];assert.equal(r.prefix,prefix);assert.equal(r.ad,200);assert.equal(r.interface,g(2));path(sim,network,2,false);}for(const[network,target]of [['203.0.113.0','203.0.113.20'],['2001:db8:30::','2001:db8:30::20']]){assert.equal(routes(sim,'R1',network)[0].ad,1);path(sim,target,1,true);}
});
test('removing only the /32 retains IPv4 replies through the network route, revokes host credit and leaves IPv6 direct',()=>{
 const sim=load('completed');change(sim,'R1',['no '+v4host]);assert.equal(goal(sim,'ipv4-host'),false);assert.equal(goal(sim,'ipv6-host'),true);path(sim,'203.0.113.10',1,true);path(sim,'2001:db8:30::10',2,false);path(sim,'203.0.113.20',1,true);change(sim,'R1',[v4host]);path(sim,'203.0.113.10',2,false);assert.equal(goal(sim,'ipv4-host'),true);
});
test('removing only the /128 retains IPv6 replies through R2 without changing the IPv4 host path or neighboring server',()=>{
 const sim=load('completed');change(sim,'R1',['no '+v6host]);assert.equal(goal(sim,'ipv6-host'),false);assert.equal(goal(sim,'ipv4-host'),true);path(sim,'2001:db8:30::10',1,true);path(sim,'203.0.113.10',2,false);path(sim,'2001:db8:30::20',1,true);change(sim,'R1',[v6host]);path(sim,'2001:db8:30::10',2,false);assert.equal(goal(sim,'ipv6-host'),true);
});
test('a working broader network route and echoes cannot stand in for configured remote host routes',()=>{
 const sim=load('completed');change(sim,'R1',['no '+v4host,'no '+v6host]);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,8);assert.equal(goal(sim,'ipv4-host'),false);assert.equal(goal(sim,'ipv6-host'),false);path(sim,'203.0.113.10',1,true);path(sim,'2001:db8:30::10',1,true);configure(sim);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('each missing R3 return route prevents replies despite the correctly installed direct host route',()=>{
 for(const[command,target,other]of [['no ip route 192.168.10.0 255.255.255.0 GigabitEthernet0/2 10.0.13.1','203.0.113.10','2001:db8:30::10'],['no ipv6 route 2001:db8:10::/64 GigabitEthernet0/2 fe80::1','2001:db8:30::10','203.0.113.10']]){const sim=load('completed');change(sim,'R3',[command]);assert.equal(goal(sim,'return-routes'),false);assert.equal(routes(sim,'R1',target)[0].ad,200);const before=sim.events.length;assert.equal(ping(sim,'PC1',target),0);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('R3')&&e.port===g(0)&&e.disposition==='send'&&e.packet?.destination===target));assert.equal(ping(sim,'PC1',other),2);configure(sim);allTraffic(sim);}
});
test('a wrong prefix or host administrative distance cannot earn a host-routing task even with successful replies',()=>{
 const sim=load('completed');change(sim,'R1',['no '+v4host,'no '+v6host,'ip route 203.0.113.0 255.255.255.0 GigabitEthernet0/2 10.0.13.2 200','ipv6 route 2001:db8:30::/64 GigabitEthernet0/2 fe80::3 200']);assert.equal(ping(sim,'PC1','203.0.113.10'),2);assert.equal(ping(sim,'PC1','2001:db8:30::10'),2);assert.equal(goal(sim,'ipv4-host'),false);assert.equal(goal(sim,'ipv6-host'),false);change(sim,'R1',[v4host.replace(/200$/,'201'),v6host.replace(/200$/,'201')]);path(sim,'203.0.113.10',2,false);path(sim,'2001:db8:30::10',2,false);assert.equal(goal(sim,'ipv4-host'),false);assert.equal(goal(sim,'ipv6-host'),false);
});
test('an incorrectly scoped link-local host next hop fails delivery and host credit rather than silently using the broader route',()=>{
 const sim=load('completed');change(sim,'R1',['no '+v6host,v6host.replace('GigabitEthernet0/2','GigabitEthernet0/1')]);assert.equal(goal(sim,'ipv6-host'),false);assert.equal(ping(sim,'PC1','2001:db8:30::10'),0);path(sim,'2001:db8:30::20',1,true);path(sim,'203.0.113.10',2,false);change(sim,'R1',['no '+v6host.replace('GigabitEthernet0/2','GigabitEthernet0/1'),v6host]);path(sim,'2001:db8:30::10',2,false);
});
test('R2 IPv6 forwarding controls only the indirect IPv6 path while both direct hosts and IPv4 transit remain usable',()=>{
 const sim=load('completed');change(sim,'R2',['no ipv6 unicast-routing']);assert.equal(ping(sim,'PC1','2001:db8:30::20'),0);path(sim,'2001:db8:30::10',2,false);path(sim,'203.0.113.20',1,true);change(sim,'R2',['ipv6 unicast-routing']);path(sim,'2001:db8:30::20',1,true);
});
test('failure of the broader-network uplink withdraws only that path while direct host routes keep forwarding in both families',()=>{
 const sim=load('completed');change(sim,'R1',['interface g0/1','shutdown']);assert.equal(goal(sim,'network-routes'),false);assert.equal(goal(sim,'ipv4-host'),true);assert.equal(goal(sim,'ipv6-host'),true);path(sim,'203.0.113.10',2,false);path(sim,'2001:db8:30::10',2,false);assert.equal(ping(sim,'PC1','203.0.113.20'),0);assert.equal(ping(sim,'PC1','2001:db8:30::20'),0);change(sim,'R1',['interface g0/1','no shutdown']);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('every published verification command works, distinguishing AD 200 host lookups from AD 1 network lookups and real traceroutes',()=>{
 const sim=load('completed'),resources=catalogGuideResources(catalog)!;assert.equal(resources.rows.length,11);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);allTraffic(sim);
 for(const[name,commands]of Object.entries(resources.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command),text=out.join('\n');assert.ok(!out.some(iosRejected),`${name}: ${command}\n${text}`);assert.doesNotMatch(text,/not implemented|not recognized/i);if(name==='R1'&&command==='show ip route 203.0.113.10'){assert.match(text,/203\.0\.113\.10\/32/);assert.match(text,/distance 200/);assert.match(text,/10\.0\.13\.2/);}if(name==='R1'&&command==='show ip route 203.0.113.20'){assert.match(text,/203\.0\.113\.0\/24/);assert.match(text,/distance 1/);assert.match(text,/10\.0\.12\.2/);}if(name==='R1'&&command==='show ipv6 route 2001:db8:30::10')assert.match(text,/2001:DB8:30::10\/128 \[200\/0\]/);if(name==='R1'&&command==='show ipv6 route 2001:db8:30::20')assert.match(text,/2001:DB8:30::\/64 \[1\/0\]/);if(command.startsWith('ping'))assert.match(text,/Received = 3/);if(command.startsWith('tracert'))assert.match(text,/Trace complete/);}}
});
test('portable reloads and startup power cycles preserve route intent, addressing and earned traffic while tables rebuild',()=>{
 const sim=load('completed');allTraffic(sim);sim.getDevice(id('R1'))!.config.hostname='Branch';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(4000);assert.equal(lessonProgress(fresh)!.complete,10);change(fresh,'R1',['no '+v4host]);assert.equal(goal(fresh,'ipv4-host'),false);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(4000);assert.equal(goal(fresh,'ipv4-host'),true);allTraffic(fresh);path(fresh,'203.0.113.10',2,false);path(fresh,'2001:db8:30::20',1,true);assert.equal(lessonProgress(fresh)!.complete,10);
});
