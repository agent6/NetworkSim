import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,DOT1Q_TRUNK_COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const port='GigabitEthernet0/24',host='GigabitEthernet0',id=(name:string)=>'device-dot1q-'+name.toLowerCase();
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('802-1q-trunking',mode))));sim.advance(3000);return sim;}
function run(sim:Simulator,name:string,commands:readonly string[]){const cli=new IOSSession(sim,id(name));for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}return cli;}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const ping=(sim:Simulator,source:string,target:string)=>{const result=sim.ping(id(source),target,{count:2});sim.advance(4000);return result.received;};
function pairs(sim:Simulator){for(const[vlan,n]of [[10,1],[20,3],[99,5]])assert.equal(ping(sim,'PC'+n,`192.168.${vlan}.12`),2);}
function configure(sim:Simulator){for(const[name,lines]of Object.entries(DOT1Q_TRUNK_COMMANDS))run(sim,name,lines);sim.advance(3000);}

test('802.1Q practice is an independent portable eight-node attempt with preconfigured access ports and no trunk credit',()=>{
 const a=createCatalogLab('802-1q-trunking'),b=createCatalogLab('802-1q-trunking');assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.interfaces[port].nativeVlan=100;assert.equal(b.lab.devices[0].config.interfaces[port].nativeVlan,1);
 const sim=load();validateLesson((sim.lab as CatalogLab).lesson);assert.equal(sim.lab.devices.length,8);assert.equal(sim.lab.links.length,7);assert.equal(lessonProgress(sim)!.complete,0);for(const name of ['SW1','SW2']){const sw=sim.getDevice(name)!;assert.equal(sw.config.interfaces[port].adminUp,false);assert.equal(sw.config.interfaces[port].mode,'access');assert.equal(sw.config.vlans[99],undefined);assert.equal(sw.config.interfaces['GigabitEthernet0/1'].vlan,10);assert.equal(sw.config.interfaces['GigabitEthernet0/2'].vlan,20);assert.equal(sw.config.interfaces['GigabitEthernet0/3'].vlan,99);}
 assert.equal(ping(sim,'PC1','192.168.10.12'),0);assert.equal(ping(sim,'PC5','192.168.99.12'),0);for(const d of sim.lab.devices.filter(d=>d.kind==='pc')){assert.equal(d.config.defaultGateway,undefined);assert.equal(d.config.interfaces[host].features.dhcp,false);}
});
test('published IOS commands configure both saved trunks and only delivered replies earn all nine tasks',()=>{
 const sim=load();configure(sim);assert.equal(lessonProgress(sim)!.complete,5);for(const name of ['SW1','SW2']){const sw=sim.getDevice(name)!,p=sw.config.interfaces[port];assert.equal(p.nativeVlan,99);assert.deepEqual(p.allowedVlans,[10,20,99]);assert.equal(p.features.nonegotiate,true);assert.notEqual(p.features.portfast,true);assert.deepEqual(sw.startupConfig!.interfaces[port],p);assert.equal(sw.runtime.features.trunks[port].operational,true);for(const v of [10,20,99])assert.equal(sw.runtime.stp[String(v)].ports[port].state,'forwarding');}
 pairs(sim);assert.equal(lessonProgress(sim)!.complete,9);for(const[v,n]of [[10,2],[20,4],[99,6]])assert.equal(ping(sim,'PC'+n,`192.168.${v}.11`),2);
 const completed=load('completed');assert.equal(lessonProgress(completed)!.complete,5);pairs(completed);assert.equal(lessonProgress(completed)!.complete,9);
});
test('real ICMP frames carry VLAN 10/20 tags and native VLAN 99 stays untagged, with untagged access delivery and unchanged TTL',()=>{
 const sim=load('completed');for(const[vlan,n]of [[10,1],[20,3],[99,5]]){const before=sim.events.length;assert.equal(ping(sim,'PC'+n,`192.168.${vlan}.12`),2);const events=sim.events.slice(before),sent=events.filter(e=>e.protocol==='ICMP'&&e.nodeId===id('SW1')&&e.port===port&&e.disposition==='send'&&e.packet?.source===`192.168.${vlan}.11`);assert.ok(sent.length);assert.ok(sent.every(e=>e.packet!.vlan===(vlan===99?undefined:vlan)));const original=events.find(e=>e.nodeId===id('PC'+n)&&e.protocol==='ICMP'&&e.disposition==='send')!.packet!;assert.ok(sent.every(e=>e.packet!.ttl===original.ttl));assert.ok(events.some(e=>e.nodeId===id('PC'+(n+1))&&e.protocol==='ICMP'&&e.disposition==='receive'&&e.packet?.vlan===undefined));}
});
test('pruning one trunk blocks only its VLAN; add restores packets and exact allowed-list checks reject all or extra VLANs',()=>{
 const sim=load('completed');run(sim,'SW2',['enable','conf t','interface '+port,'switchport trunk allowed vlan remove 20','end']);assert.equal(goal(sim,'allowed'),false);assert.equal(ping(sim,'PC3','192.168.20.12'),0);assert.equal(ping(sim,'PC1','192.168.10.12'),2);assert.equal(ping(sim,'PC5','192.168.99.12'),2);
 run(sim,'SW2',['enable','conf t','interface '+port,'switchport trunk allowed vlan add 20','end']);sim.advance(3000);assert.equal(goal(sim,'allowed'),true);assert.equal(ping(sim,'PC3','192.168.20.12'),2);
 for(const list of ['all','10,20,99,100']){run(sim,'SW2',['enable','conf t','interface '+port,'switchport trunk allowed vlan '+list,'end']);assert.equal(goal(sim,'allowed'),false);assert.equal(ping(sim,'PC3','192.168.20.12'),2);}run(sim,'SW2',['enable','conf t','interface '+port,'switchport trunk allowed vlan 99,20,10','end']);assert.equal(goal(sim,'allowed'),true);
});
test('native-VLAN mismatch breaks the native pair and matching native VLANs restore delivered connectivity',()=>{
 const sim=load('completed');run(sim,'SW2',['enable','conf t','interface '+port,'switchport trunk native vlan 1','end']);sim.advance(3000);assert.equal(goal(sim,'native-match'),false);assert.equal(ping(sim,'PC5','192.168.99.12'),0);assert.equal(ping(sim,'PC1','192.168.10.12'),2);assert.equal(ping(sim,'PC3','192.168.20.12'),2);
 run(sim,'SW2',['enable','conf t','interface '+port,'switchport trunk native vlan 99','end']);sim.advance(3000);assert.equal(goal(sim,'native-match'),true);assert.equal(ping(sim,'PC5','192.168.99.12'),2);
});
test('missing VLAN, shutdown and cable loss block actual traffic; data-only static trunk and normal STP are required',()=>{
 const sim=load('completed');run(sim,'SW2',['enable','conf t','no vlan 99','end']);assert.equal(goal(sim,'native-vlan'),false);assert.equal(ping(sim,'PC5','192.168.99.12'),0);assert.equal(ping(sim,'PC1','192.168.10.12'),2);configure(sim);
 run(sim,'SW1',['enable','conf t','interface '+port,'shutdown','end']);assert.equal(goal(sim,'sw1-trunk'),false);assert.equal(ping(sim,'PC1','192.168.10.12'),0);configure(sim);const link=sim.lab.links.find(l=>l.id==='link-dot1q-trunk')!;link.enabled=false;sim.changed();assert.equal(ping(sim,'PC1','192.168.10.12'),0);link.enabled=true;sim.changed();sim.advance(3000);pairs(sim);
 run(sim,'SW1',['enable','conf t','interface '+port,'spanning-tree portfast trunk','end']);assert.equal(goal(sim,'sw1-trunk'),false);run(sim,'SW1',['enable','conf t','interface '+port,'no spanning-tree portfast','no switchport nonegotiate','end']);assert.equal(goal(sim,'sw1-trunk'),false);configure(sim);assert.equal(goal(sim,'sw1-trunk'),true);
});
test('remote MAC goal needs all six remote dynamic entries and requires fresh learning after clear or reload',()=>{
 const sim=load('completed');assert.equal(ping(sim,'PC1','192.168.10.12'),2);assert.equal(goal(sim,'remote-macs'),false);pairs(sim);assert.equal(goal(sim,'remote-macs'),true);
 for(const[name,side]of [['SW1',0],['SW2',1]] as const)for(const[vlan,pair]of [[10,0],[20,1],[99,2]]){const sw=sim.getDevice(name)!,mac=sim.macOf(id('PC'+(2*pair+2-side)),host),entry=sw.runtime.mac[vlan+'|'+mac];assert.equal(entry.port,port);assert.equal(entry.static,undefined);}
 run(sim,'SW1',['enable','clear mac address-table dynamic']);assert.equal(goal(sim,'remote-macs'),false);pairs(sim);assert.equal(goal(sim,'remote-macs'),true);
});
test('published show commands reflect trunk and forwarding state, PC checks work and cross-VLAN traffic stays isolated',()=>{
 const sim=load('completed');pairs(sim);for(const[name,commands]of Object.entries(catalogGuideResources('802-1q-trunking')!.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command).join('\n');assert.ok(!/not recognized|not implemented|% Invalid/i.test(out),command);if(command==='show interfaces trunk'){assert.match(out,/Gi0\/24\s+on\s+802.1q\s+trunking\s+99/);assert.match(out,/10,20,99/);}if(command.startsWith('ping'))assert.match(out,command==='ping -n 3 192.168.20.12'&&name==='PC1'?/Received = 0/:/Received = 3/);}}
 assert.equal(ping(sim,'PC3','192.168.10.12'),0);assert.equal(ping(sim,'PC5','192.168.10.12'),0);
});
test('portable save and switch restart retain trunk configuration and earned echoes with stable device IDs',()=>{
 const sim=load('completed');pairs(sim);assert.equal(lessonProgress(sim)!.complete,9);sim.getDevice('PC1')!.config.hostname='User A';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(3000);assert.equal((fresh.lab as CatalogLab).catalogId,'802-1q-trunking');assert.equal(lessonProgress(fresh)!.complete,8);assert.equal(goal(fresh,'remote-macs'),false);pairs(fresh);assert.equal(lessonProgress(fresh)!.complete,9);for(const name of ['SW1','SW2']){fresh.power(id(name),false);fresh.power(id(name),true);}fresh.advance(3000);pairs(fresh);assert.equal(goal(fresh,'allowed'),true);assert.equal(goal(fresh,'native-match'),true);
});
test('imported trunk criteria are bounded data and invalid native VLANs, lists or negotiation values reject',()=>{
 const sim=load(),lesson=(sim.lab as CatalogLab).lesson!,base={kind:'trunk-allowed' as const,device:id('SW1'),interface:port};
 for(const vlans of [[],[0],[4095],[10,10],[1.5],['10'],Array.from({length:4095},(_,i)=>i+1)])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion:{...base,vlans}}]}),/invalid/);
 for(const value of [0,4095,'99'])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion:{kind:'interface',device:id('SW1'),interface:port,property:'nativeVlan',value}}]}),/invalid/);
 assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion:{kind:'interface',device:id('SW1'),interface:port,property:'nonegotiate',value:'true'}}]}),/invalid/);
 for(const criterion of [{...base,device:'missing',vlans:[10,20,99]},{...base,interface:'missing',vlans:[10,20,99]},{...base,vlans:[10,20,99]}])assert.equal(matches(sim,criterion as Criterion),false);
 const resources=catalogGuideResources('802-1q-trunking')!;for(const row of resources.rows)assert.equal(row.length,resources.columns.length);assert.match(resources.note,/Cross-VLAN pings receive zero replies/);assert.equal(lesson.objectives.length,9);
});
