import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {sameAddress} from '../src/ip.ts';
import {createCatalogLab,DEFAULT_ROUTE_COMMANDS as COMMANDS,catalogGuideResources} from '../src/lab-catalog.ts';
import {lessonProgress} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';

const catalog='default-route',id=(name:string)=>'device-default-route-'+name.toLowerCase(),g=(n:number)=>`GigabitEthernet0/${n}`;
const traffic=[['PC1','203.0.113.10'],['PC1','2001:db8:20::10'],['SRV1','10.10.10.10'],['SRV1','2001:db8:10::10'],['PC1','198.51.100.1'],['PC1','2001:db8:100::1']];
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(4000);return sim;}
function run(sim:Simulator,name:string,lines:readonly string[]){const cli=new IOSSession(sim,id(name));for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}return cli;}
function change(sim:Simulator,name:string,lines:readonly string[]){run(sim,name,['enable','configure terminal',...lines,'end']);sim.advance(4000);}
function configure(sim:Simulator){for(const[name,lines]of Object.entries(COMMANDS))run(sim,name,lines);sim.advance(4000);}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const routes=(sim:Simulator,name:string,network:string)=>sim.getDevice(id(name))!.runtime.routes.filter(r=>sameAddress(r.network,network)&&r.protocol==='static');
const ping=(sim:Simulator,name:string,target:string)=>{const p=sim.ping(id(name),target,{count:2});sim.advance(4000);return p.received;};
function allTraffic(sim:Simulator){for(const[name,target]of traffic)assert.equal(ping(sim,name,target),2,`${name} → ${target}`);lessonProgress(sim);}

test('default-route practice is independent, dual-stack, zero-credit and ready only for local gateway traffic',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const sim=load();assert.equal(sim.lab.devices.length,4);assert.equal(sim.lab.links.length,3);assert.equal(lessonProgress(sim)!.complete,0);
 for(const name of ['R1','ISP1']){const d=sim.getDevice(id(name))!;assert.deepEqual(d.config.staticRoutes,[]);assert.deepEqual(d.config.protocols,{});assert.equal(d.config.ipv6Routing,false);assert.equal(d.config.ipRouting,true);assert.equal(d.config.interfaces[g(0)].features.proxyArp,false);}
 for(const name of ['PC1','SRV1']){const d=sim.getDevice(id(name))!;assert.equal(d.config.interfaces.GigabitEthernet0.features.dhcp,false);assert.equal(d.config.interfaces.GigabitEthernet0.features.ipv6Autoconfig,false);assert.equal(d.config.staticRoutes[0].interface,'GigabitEthernet0');}
 assert.equal(ping(sim,'PC1','10.10.10.1'),2);assert.equal(ping(sim,'PC1','2001:db8:10::1'),2);assert.equal(ping(sim,'PC1','203.0.113.10'),0);assert.equal(ping(sim,'PC1','2001:db8:20::10'),0);assert.equal(lessonProgress(sim)!.complete,0);
});
test('published commands and completed reference earn four configuration goals, then all ten through six real traffic tests',()=>{
 for(const mode of ['practice','completed'] as const){const sim=load(mode);if(mode==='practice')configure(sim);assert.equal(lessonProgress(sim)!.complete,4);for(const name of ['R1','ISP1']){const d=sim.getDevice(id(name))!;assert.deepEqual(d.startupConfig,d.config);assert.equal(d.config.staticRoutes.length,2);}allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);}
});
test('router ip default-gateway cannot substitute for an installed IPv4 default with IP routing enabled',()=>{
 const sim=load();change(sim,'R1',['ip default-gateway 192.0.2.2']);change(sim,'ISP1',['ip route 10.10.10.0 255.255.255.0 192.0.2.1']);assert.equal(routes(sim,'R1','0.0.0.0').length,0);assert.equal(goal(sim,'ipv4-default'),false);assert.equal(ping(sim,'PC1','203.0.113.10'),0);change(sim,'R1',['ip route 0.0.0.0 0.0.0.0 192.0.2.2']);assert.equal(goal(sim,'ipv4-default'),true);assert.equal(ping(sim,'PC1','203.0.113.10'),2);
});
test('removing the IPv4 default breaks both remote IPv4 networks while IPv6 and connected branch access continue',()=>{
 const sim=load('completed');change(sim,'R1',['no ip route 0.0.0.0 0.0.0.0 192.0.2.2']);assert.equal(goal(sim,'ipv4-default'),false);for(const target of ['203.0.113.10','198.51.100.1'])assert.equal(ping(sim,'PC1',target),0);for(const target of ['10.10.10.1','2001:db8:20::10','2001:db8:100::1'])assert.equal(ping(sim,'PC1',target),2);configure(sim);assert.equal(ping(sim,'PC1','203.0.113.10'),2);
});
test('removing the IPv6 default affects IPv6 remote networks without changing IPv4 or connected IPv6 access',()=>{
 const sim=load('completed');change(sim,'R1',['no ipv6 route ::/0 GigabitEthernet0/1 fe80::2']);assert.equal(goal(sim,'ipv6-default'),false);for(const target of ['2001:db8:20::10','2001:db8:100::1'])assert.equal(ping(sim,'PC1',target),0);for(const target of ['2001:db8:10::1','203.0.113.10','198.51.100.1'])assert.equal(ping(sim,'PC1',target),2);configure(sim);assert.equal(ping(sim,'PC1','2001:db8:20::10'),2);
});
test('each missing ISP1 return route prevents replies despite a correct installed R1 default and working forward path',()=>{
 for(const[v6,command,target,other]of [[false,'no ip route 10.10.10.0 255.255.255.0 192.0.2.1','203.0.113.10','2001:db8:20::10'],[true,'no ipv6 route 2001:db8:10::/64 GigabitEthernet0/1 fe80::1','2001:db8:20::10','203.0.113.10']] as const){const sim=load('completed');change(sim,'ISP1',[command]);assert.equal(goal(sim,'return-routes'),false);assert.equal(routes(sim,'R1',v6?'::':'0.0.0.0').length,1);const before=sim.events.length;assert.equal(ping(sim,'PC1',target),0);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('ISP1')&&e.disposition==='send'&&e.port===g(0)&&e.packet?.destination===target));assert.equal(ping(sim,'PC1',other),2);configure(sim);allTraffic(sim);}
});
test('disabling either router IPv6 forwarding interrupts transit without breaking IPv4',()=>{
 for(const name of ['R1','ISP1']){const sim=load('completed');change(sim,name,['no ipv6 unicast-routing']);assert.equal(goal(sim,'ipv6-forwarding'),false);assert.equal(ping(sim,'PC1','2001:db8:20::10'),0);assert.equal(ping(sim,'PC1','203.0.113.10'),2);change(sim,name,['ipv6 unicast-routing']);assert.equal(ping(sim,'PC1','2001:db8:20::10'),2);}
});
test('uplink shutdown withdraws both defaults, preserves connected gateway access, and restoration rebuilds routing and neighbors',()=>{
 const sim=load('completed');allTraffic(sim);change(sim,'R1',['interface g0/1','shutdown']);assert.equal(sim.interfaceUp(id('ISP1'),g(1)),false);for(const n of ['0.0.0.0','::'])assert.equal(routes(sim,'R1',n).length,0);assert.equal(goal(sim,'ipv4-default'),false);assert.equal(goal(sim,'ipv6-default'),false);assert.equal(goal(sim,'return-routes'),false);assert.equal(ping(sim,'PC1','203.0.113.10'),0);assert.equal(ping(sim,'PC1','2001:db8:20::10'),0);assert.equal(ping(sim,'PC1','10.10.10.1'),2);assert.equal(ping(sim,'PC1','2001:db8:10::1'),2);change(sim,'R1',['interface g0/1','no shutdown']);allTraffic(sim);assert.equal(lessonProgress(sim)!.complete,10);
});
test('connected LAN matches take precedence over defaults and multiple remote prefixes use the actual upstream interface',()=>{
 const sim=load('completed');for(const target of ['203.0.113.10','2001:db8:20::10','198.51.100.1','2001:db8:100::1']){const before=sim.events.length;assert.equal(ping(sim,'PC1',target),2);assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('R1')&&e.disposition==='send'&&e.port===g(1)&&e.packet?.destination===target));}
 const before=sim.events.length;assert.equal(ping(sim,'SRV1','10.10.10.10'),2);assert.equal(ping(sim,'SRV1','2001:db8:10::10'),2);for(const target of ['10.10.10.10','2001:db8:10::10'])assert.ok(sim.events.slice(before).some(e=>e.nodeId===id('R1')&&e.disposition==='send'&&e.port===g(0)&&e.packet?.destination===target));
});
test('unknown destinations stop at ISP1 rather than returning through a reciprocal default',()=>{
 for(const target of ['198.18.0.1','2001:db8:dead::1']){const sim=load('completed'),before=sim.events.length;assert.equal(ping(sim,'PC1',target),0);const sent=sim.events.slice(before).filter(e=>e.disposition==='send'&&e.packet?.destination===target);assert.equal(sent.filter(e=>e.nodeId===id('R1')).length,2);assert.equal(sent.filter(e=>e.nodeId===id('ISP1')).length,0);assert.equal(routes(sim,'ISP1','0.0.0.0').length,0);assert.equal(routes(sim,'ISP1','::').length,0);}
});
test('default credit requires the intended prefix, distance, next hop and usable interface rather than any successful ping',()=>{
 const sim=load('completed');change(sim,'R1',['no ip route 0.0.0.0 0.0.0.0 192.0.2.2','ip route 203.0.113.0 255.255.255.0 192.0.2.2']);assert.equal(ping(sim,'PC1','203.0.113.10'),2);assert.equal(goal(sim,'ipv4-default'),false);change(sim,'R1',['ip route 0.0.0.0 0.0.0.0 192.0.2.2 10']);assert.equal(ping(sim,'PC1','198.51.100.1'),2);assert.equal(goal(sim,'ipv4-default'),false);change(sim,'R1',['no ipv6 route ::/0 GigabitEthernet0/1 fe80::2','ipv6 route ::/0 GigabitEthernet0/0 fe80::2']);assert.equal(goal(sim,'ipv6-default'),false);assert.equal(ping(sim,'PC1','2001:db8:20::10'),0);
});
test('all published verification commands run and expose IPv4 S*, IPv6 S, scoped neighbors and genuine replies',()=>{
 const sim=load('completed'),resources=catalogGuideResources(catalog)!;assert.equal(resources.rows.length,7);for(const row of resources.rows)assert.equal(row.length,resources.columns.length);
 for(const[name,commands]of Object.entries(resources.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command),text=out.join('\n');assert.ok(!out.some(iosRejected),`${name}: ${command}\n${text}`);assert.doesNotMatch(text,/not implemented|not recognized/i);if(command==='show ip route'&&name==='R1'){assert.match(text,/Gateway of last resort is 192\.0\.2\.2/);assert.match(text,/S\*\s+0\.0\.0\.0\/0 \[1\/0\] via 192\.0\.2\.2/);}if(command==='show ipv6 route static'&&name==='R1'){assert.match(text,/S\s+::\/0 \[1\/0\]/);assert.match(text,/FE80::2, GigabitEthernet0\/1/);assert.doesNotMatch(text,/S\*/);}if(command.startsWith('ping'))assert.match(text,/Received = 3/);}}
});
test('saved reload and startup reboot preserve the manual host gateways, route plan and previously earned traffic',()=>{
 const sim=load('completed');allTraffic(sim);sim.getDevice(id('R1'))!.config.hostname='Branch';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(4000);assert.equal(lessonProgress(fresh)!.complete,10);change(fresh,'R1',['no ip route 0.0.0.0 0.0.0.0 192.0.2.2']);assert.equal(goal(fresh,'ipv4-default'),false);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(4000);assert.equal(goal(fresh,'ipv4-default'),true);allTraffic(fresh);assert.equal(lessonProgress(fresh)!.complete,10);
});
