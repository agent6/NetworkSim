import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {ospfLiveDetail} from '../src/ospf-packets.ts';
import {renderNSOSConfig} from '../src/nsos-config.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';

function run(cli:{execute(s:string):string[]},...lines:string[]){for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}}
const text=(cli:{execute(s:string):string[]},line:string)=>cli.execute(line).join('\n');
function pair(){
 const sim=new Simulator(20261022),nx=sim.addDevice('datacenter'),ios=sim.addDevice('router'),cli=new NSOSSession(sim,nx.id,{skipConsoleLogin:true}),peer=new IOSSession(sim,ios.id);
 run(cli,'conf t','feature ospf','router ospf LAB','router-id 2.2.2.2','exit','interface Ethernet1/1','no switchport','ip address 198.51.100.1/30','ip router ospf LAB area 0','no shutdown','interface Loopback0','ip address 192.0.2.1/32','ip router ospf LAB area 0','end');
 run(peer,'enable','conf t','interface GigabitEthernet0/0','ip address 198.51.100.2 255.255.255.252','no shutdown','interface Loopback0','ip address 192.0.2.2 255.255.255.255','exit','router ospf 1','router-id 3.3.3.3','network 198.51.100.0 0.0.0.3 area 0','network 192.0.2.2 0.0.0.0 area 0','end');
 sim.connect({deviceId:nx.id,port:'Ethernet1/1'},{deviceId:ios.id,port:'GigabitEthernet0/0'});sim.advance(90000);
 return {sim,nx,ios,cli,peer};
}
function full(sim:Simulator,id:string,vrf?:string){return ospfLiveDetail(sim,id,'ospf',vrf)?.neighbors.some(n=>n.state==='FULL')??false;}
test('NX passive-interface precedence stops Hello delivery and routes, with actual packet recovery',()=>{
 const {sim,nx,ios,cli,peer}=pair();assert.ok(full(sim,nx.id));assert.ok(sim.routes(ios.id).some(r=>r.network==='192.0.2.1'&&r.prefix===32));
 const ping=()=>{const p=sim.ping(ios.id,'192.0.2.1',{count:3});sim.advance(10000);return p.received;};assert.equal(ping(),3);
 run(cli,'conf t','router ospf LAB','passive-interface default','end');sim.advance(50000);
 assert.match(text(cli,'show ip ospf LAB interface Ethernet1/1'),/State DR[\s\S]*Passive interface/);
 assert.equal(full(sim,nx.id),false);assert.equal(full(sim,ios.id),false);assert.ok(!sim.routes(ios.id).some(r=>r.network==='192.0.2.1'&&r.prefix===32));assert.equal(ping(),0);
 run(cli,'conf t','interface Ethernet1/1','no ip ospf passive-interface','end');sim.advance(90000);assert.ok(full(sim,nx.id));assert.equal(ping(),3);
 run(cli,'conf t','interface Ethernet1/1','default ip ospf passive-interface','end');sim.advance(50000);assert.equal(full(sim,nx.id),false);
 run(cli,'conf t','router ospf LAB','no passive-interface default','exit','interface Ethernet1/1','ip ospf passive-interface','end');sim.advance(50000);assert.equal(full(sim,nx.id),false);
 const start=sim.clock.now(),before=nx.runtime.features.ospfTraffic?.sent?.hello??0;sim.advance(15000);
 assert.equal(nx.runtime.features.ospfTraffic?.sent?.hello??0,before);assert.ok(sim.clock.now()>start);
 run(cli,'conf t','interface Ethernet1/1','default ip ospf passive-interface','end');sim.advance(90000);assert.ok(full(sim,nx.id));assert.equal(ping(),3);
 assert.ok((nx.runtime.features.ospfTraffic?.sent?.hello??0)>before);
});
test('NX creates an empty named OSPF process and loopbacks are up without no shutdown',()=>{
 const sim=new Simulator(20261023),d=sim.addDevice('datacenter'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
 run(cli,'conf t','feature ospf','router ospf EMPTY','end');assert.equal(d.config.protocols.ospf.nsosTag,'EMPTY');assert.match(renderNSOSConfig(d).join('\n'),/router ospf EMPTY/);
 run(cli,'conf t','interface Loopback9','ip address 192.0.2.9/32','end');sim.advance(100);
 assert.equal(sim.interfaceUp(d.id,'Loopback9'),true);assert.ok(sim.routes(d.id).some(r=>r.network==='192.0.2.9'));
 run(cli,'conf t','interface Loopback9','shutdown','end');sim.advance(100);assert.equal(sim.interfaceUp(d.id,'Loopback9'),false);assert.ok(!sim.routes(d.id).some(r=>r.network==='192.0.2.9'));
 run(cli,'conf t','router ospf EMPTY');const config=JSON.stringify(d.config);assert.ok(cli.execute('passive-interface Ethernet1/1').some(iosRejected));assert.equal(JSON.stringify(d.config),config);
});
test('NX interface passive overrides save, replay, reload and load with equivalent forwarding',()=>{
 const {sim,nx,cli}=pair();
 run(cli,'conf t','router ospf LAB','passive-interface default','exit','interface Ethernet1/1','no ip ospf passive-interface','interface Loopback0','ip ospf passive-interface','end');sim.advance(90000);assert.ok(full(sim,nx.id));
 const rendered=renderNSOSConfig(nx).join('\n');assert.match(rendered,/no ip ospf passive-interface/);assert.match(rendered,/\n passive-interface default/);
 const d=sim.addDevice('datacenter'),replay=new NSOSSession(sim,d.id,{skipConsoleLogin:true});d.config.features.files={replay:rendered};run(replay,'copy bootflash:replay running-config');assert.equal(renderNSOSConfig(d).join('\n'),rendered);
 assert.equal(d.config.interfaces['Ethernet1/1'].features.ospf.passive,false);assert.equal(d.config.interfaces.Loopback0.features.ospf.passive,true);
 run(cli,'copy running-config startup-config');sim.reload(nx.id);sim.advance(90000);assert.ok(full(sim,nx.id));
 const loaded=new Simulator(1);loaded.load(parseLabFile(serializeLabFile(sim.serialize())));loaded.advance(90000);assert.ok(full(loaded,nx.id));
});
test('NX legacy IOS-style passive lists export as native interface commands',()=>{
 const {sim,nx}=pair();nx.config.protocols.ospf.passiveInterfaces=['Loopback0'];nx.config.protocols.ospf.activeInterfaces=['Ethernet1/1'];nx.config.protocols.ospf.passiveDefault=true;
 const rendered=renderNSOSConfig(nx).join('\n');assert.doesNotMatch(rendered,/passive-interface (?:Loopback|Ethernet)/);assert.match(rendered,/interface Loopback0[\s\S]*?\n ip ospf passive-interface/);
 const copy=sim.addDevice('datacenter'),cli=new NSOSSession(sim,copy.id,{skipConsoleLogin:true});copy.config.features.files={legacy:rendered};run(cli,'copy bootflash:legacy running-config');assert.equal(copy.config.interfaces.Loopback0.features.ospf.passive,true);assert.equal(copy.config.interfaces['Ethernet1/1'].features.ospf.passive,false);
});
test('NX OSPF show selectors resolve the named instance, interface and default VRF',()=>{
 const {sim,nx,cli}=pair(),before=sim.clock.now(),config=JSON.stringify(nx.config);
 for(const command of ['show ip ospf LAB neighbors','show ip ospf LAB neighbors vrf default','show ip ospf neighbors vrf default','show ip ospf LAB neighbors vrf all'])assert.match(text(cli,command),/3\.3\.3\.3.*FULL/);
 const iface=text(cli,'show ip ospf LAB interface Ethernet1/1');assert.match(iface,/Ethernet1\/1/);assert.doesNotMatch(iface,/Loopback0/);
 assert.ok(cli.execute('show ip ospf MISSING neighbors').some(iosRejected));assert.equal(text(cli,'show ip ospf LAB neighbors vrf MISSING'),'');
 assert.match(cli.help('show ip ospf ').join('\n'),/LAB/);assert.equal(cli.complete('show ip ospf L'),'show ip ospf LAB ');
 assert.equal(sim.clock.now(),before);assert.equal(JSON.stringify(nx.config),config);
});
test('NX loopbacks advertise cost one, respect explicit cost and retain knobs when OSPF is detached',()=>{
 const {sim,nx,ios,cli}=pair();
 const route=()=>sim.routes(ios.id).find(r=>r.network==='192.0.2.1'&&r.protocol==='O')!;
 assert.equal(route().metric,2);assert.equal(nx.config.interfaces.Loopback0.features.bandwidth,8000000);
 assert.match(text(cli,'show interface Loopback0'),/Hardware: Loopback[\s\S]*BW 8000000 Kbit/);
 assert.match(text(cli,'show ip ospf LAB interface Loopback0'),/State LOOPBACK, Network type LOOPBACK, cost 1/);
 run(cli,'conf t','interface Loopback0','ip ospf cost 9','ip ospf passive-interface','end');sim.advance(15000);assert.equal(route().metric,10);
 run(cli,'conf t','interface Loopback0');const config=JSON.stringify(nx.config);
 assert.deepEqual(cli.execute('no ip router ospf WRONG area 0'),['Already not configured']);assert.equal(JSON.stringify(nx.config),config);
 assert.deepEqual(cli.execute('no ip router ospf LAB area 1'),['Area mismatch']);assert.equal(JSON.stringify(nx.config),config);
 run(cli,'no ip router ospf LAB area 0','end');sim.advance(15000);assert.equal(route(),undefined);
 assert.equal(nx.config.interfaces.Loopback0.features.ospf.cost,9);assert.equal(nx.config.interfaces.Loopback0.features.ospf.passive,true);
 run(cli,'conf t','interface Loopback0','ip router ospf LAB area 0','end');sim.advance(15000);assert.equal(route().metric,10);
 nx.config.features.files={bad:'interface Loopback0\ndescription must roll back\nno ip router ospf LAB area 1\nend'};
 const before=JSON.stringify(nx.config);assert.ok(cli.execute('copy bootflash:bad running-config').some(iosRejected));assert.equal(JSON.stringify(nx.config),before);
});
test('NX MTU ignore applies at the receiver of a larger DBD; high-side ignore cannot restore adjacency',()=>{
 const {sim,nx,ios,cli,peer}=pair();
 const reset=()=>{run(peer,'conf t','interface GigabitEthernet0/0','shutdown','end');sim.advance(100);run(peer,'conf t','interface GigabitEthernet0/0','no shutdown','end');sim.advance(90000);};
 run(cli,'conf t','interface Ethernet1/1','mtu 1600','ip ospf mtu-ignore','end');reset();
 assert.equal(full(sim,nx.id),false);assert.equal(full(sim,ios.id),false);assert.ok(!sim.routes(ios.id).some(r=>r.network==='192.0.2.1'));
 sim.advance(120000);assert.ok(ospfLiveDetail(sim,nx.id,'ospf')?.neighbors.some(n=>['EXSTART','EXCHANGE'].includes(n.state)));
 const dbds=nx.runtime.features.ospfTraffic.sent['database-description']??0;sim.advance(15000);assert.equal(nx.runtime.features.ospfTraffic.sent['database-description']-dbds,3);
 run(peer,'conf t','interface GigabitEthernet0/0','ip ospf mtu-ignore','end');reset();assert.ok(full(sim,nx.id));assert.ok(full(sim,ios.id));
 run(cli,'conf t','interface Ethernet1/1','no ip ospf mtu-ignore','end');reset();assert.ok(full(sim,nx.id));
 run(peer,'conf t','interface GigabitEthernet0/0','no ip ospf mtu-ignore','end');reset();assert.equal(full(sim,nx.id),false);
 run(cli,'conf t','interface Ethernet1/1','no mtu','end');reset();assert.ok(full(sim,nx.id));assert.ok(full(sim,ios.id));
 const p=sim.ping(ios.id,'192.0.2.1',{count:3});sim.advance(10000);assert.equal(p.received,3);
 // Exercise the new NS-OS control as the smaller receiving interface too.
 run(cli,'conf t','interface Ethernet1/1','mtu 1400','end');reset();assert.equal(full(sim,nx.id),false);
 run(cli,'conf t','interface Ethernet1/1','ip ospf mtu-ignore','end');reset();assert.ok(full(sim,nx.id));assert.ok(full(sim,ios.id));
 assert.match(text(cli,'ping 192.0.2.2 count 3'),/3 packets transmitted, 3 packets received/);
 assert.match(renderNSOSConfig(nx).join('\n'),/ip ospf mtu-ignore/);
 run(cli,'copy running-config startup-config');sim.reload(nx.id);sim.advance(90000);assert.equal(nx.config.interfaces['Ethernet1/1'].features.ospf.mtuIgnore,true);assert.ok(full(sim,nx.id));
});
test('NX loopback receive counters count delivered IP packets separately from physical ingress',()=>{
 const {sim,nx,ios,cli}=pair();
 const before=nx.runtime.counters.Loopback0?.rx??0,bytes=nx.runtime.counters.Loopback0?.rxBytes??0;
 const p=sim.ping(ios.id,'192.0.2.1',{count:3,size:100});sim.advance(10000);assert.equal(p.received,3);
 assert.equal(nx.runtime.counters.Loopback0.rx-before,3);assert.equal(nx.runtime.counters.Loopback0.rxBytes-bytes,300);assert.equal(nx.runtime.counters.Loopback0.tx,0);
 const time=sim.clock.now();assert.match(text(cli,'show interface Loopback0'),/3 packets input 300 bytes/);assert.equal(sim.clock.now(),time);
});
test('NX OSPF passive defaults stay scoped to each VRF and interface selectors infer that scope',()=>{
 const {sim,nx,ios,cli,peer}=pair();
 run(cli,'conf t','vrf context BLUE','exit','router ospf LAB','passive-interface default','vrf BLUE','router-id 2.2.2.22','exit','exit','interface Ethernet1/1','vrf member BLUE','ip address 198.51.100.1/30','ip router ospf LAB area 0','interface Loopback20','vrf member BLUE','ip address 192.0.2.10/32','ip router ospf LAB area 0','end');
 run(peer,'conf t','vrf definition BLUE','address-family ipv4','exit-address-family','exit','interface GigabitEthernet0/0','vrf forwarding BLUE','ip address 198.51.100.2 255.255.255.252','interface Loopback20','vrf forwarding BLUE','ip address 192.0.2.20 255.255.255.255','exit','router ospf 2 vrf BLUE','router-id 3.3.3.33','network 198.51.100.0 0.0.0.3 area 0','network 192.0.2.20 0.0.0.0 area 0','end');
 sim.advance(90000);assert.ok(full(sim,nx.id,'BLUE'));assert.equal(full(sim,nx.id),false);
 assert.match(text(cli,'show ip ospf LAB interface Ethernet1/1'),/VRF BLUE/);
 assert.ok(cli.execute('show ip ospf LAB interface Ethernet1/1 vrf BLUE').some(iosRejected));
 const ping=()=>text(cli,'ping 192.0.2.20 vrf BLUE count 3');assert.match(ping(),/3 packets transmitted, 3 packets received, 0.00% packet loss/);
 assert.ok(!sim.routes(nx.id).some(r=>r.network==='192.0.2.20'&&!r.vrf));
 run(cli,'conf t','router ospf LAB','vrf BLUE','passive-interface default','end');sim.advance(50000);assert.equal(full(sim,nx.id,'BLUE'),false);assert.match(ping(),/3 packets transmitted, 0 packets received/);
 run(cli,'conf t','interface Ethernet1/1','no ip ospf passive-interface','end');sim.advance(90000);assert.ok(full(sim,nx.id,'BLUE'));assert.match(ping(),/3 packets transmitted, 3 packets received/);
 run(cli,'conf t','interface Ethernet1/1','default ip ospf passive-interface','end');sim.advance(50000);assert.equal(full(sim,nx.id,'BLUE'),false);
 run(cli,'conf t','router ospf LAB','vrf BLUE','no passive-interface default','end');sim.advance(90000);assert.ok(full(sim,nx.id,'BLUE'));assert.match(ping(),/3 packets transmitted, 3 packets received/);
 assert.ok(full(sim,ios.id,'BLUE'));
});
test('NX ping count reports delivered replies and preserves actual unreachable errors',()=>{
 const {sim,nx,cli}=pair();
 const output=text(cli,'ping 192.0.2.2 count 3');assert.match(output,/icmp_seq=0[\s\S]*icmp_seq=2[\s\S]*3 packets transmitted, 3 packets received, 0.00% packet loss/);
 assert.match(text(cli,'ping 203.0.113.99 count 1'),/ping: sendto .*No route to host[\s\S]*1 packets transmitted, 0 packets received/);
 run(cli,'conf t','ip route 203.0.113.0/24 198.51.100.2','end');
 assert.match(text(cli,'ping 203.0.113.99 count 1'),/From 198.51.100.2: Destination network unreachable[\s\S]*100.00% packet loss/);
 const before=sim.clock.now(),config=JSON.stringify(nx.config);assert.ok(cli.execute('ping 192.0.2.2 count 21').some(iosRejected));assert.equal(sim.clock.now(),before);assert.equal(JSON.stringify(nx.config),config);
});
