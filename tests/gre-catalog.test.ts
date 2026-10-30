import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,GRE_COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {actionAvailable,lessonProgress,matches,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {matchesProtocol} from '../src/packet-view.ts';
const slug='gre-tunnel-configuration-and-verification',id=(n:string)=>'device-gre-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(1000);return s;}
const d=(s:Simulator,name='R1')=>s.getDevice(id(name))!;
function cli(s:Simulator,name='R1'){const c=new IOSSession(s,id(name));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,name:string,...lines:string[]){run(cli(s,name),'configure terminal',...lines,'end');s.advance(100);}
const row=(s:Simulator,name:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===name)!;
function ping(s:Simulator,source:string,address:string){const r=s.ping(id(source),address,{count:3});s.advance(5000);lessonProgress(s);return r.received;}
function task(s:Simulator,name:string){const o=row(s,name).objective,a=o.action!;assert.equal(a.kind,'ping');assert.equal(actionAvailable(s,o),true);if(a.kind!=='ping')throw Error('Wrong action');const r=s.ping(a.device,a.target,{count:3});s.advance(5000);lessonProgress(s);return r.received;}
function configure(s:Simulator){for(const[name,commands]of Object.entries(GRE_COMMANDS))run(new IOSSession(s,id(name)),...commands);s.advance(1000);}
function finish(s:Simulator){for(const name of ['r1-underlay','r2-underlay','r1-overlay','r2-overlay','pc1-gre','pc2-gre'])assert.equal(task(s,name),3);assert.equal(lessonProgress(s)!.complete,12);}

test('GRE catalog has three ENCOR Virtualization labs and an independent five-node, twelve-task practice',()=>{
 assert.deepEqual(LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR'&&e.section==='Virtualization').map(e=>[e.id,e.section]),[['vrf-configuration-and-verification','Virtualization'],[slug,'Virtualization'],['gre-over-ipsec-tunnel-configuration-and-verification','Virtualization']]);const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);assert.equal(a.lab.devices.length,5);assert.equal(a.lab.links.length,4);assert.equal(catalogGuideResources(slug)!.rows.length,10);const s=load('practice');assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,12);assert.ok(!d(s).config.interfaces.Tunnel0);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,2);
});
test('practice has real bidirectional physical underlay reachability, without overlay connectivity or fabricated goals',()=>{
 const s=load('practice');assert.equal(task(s,'r1-underlay'),3);assert.equal(task(s,'r2-underlay'),3);assert.equal(lessonProgress(s)!.complete,2);assert.equal(ping(s,'PC1','192.168.20.10'),0);assert.equal(ping(s,'PC2','192.168.10.10'),0);assert.ok(!s.events.some(e=>e.label==='GRE encapsulation'));assert.equal(s.cefLookup(id('R1'),'198.51.100.2')?.port,g(0));assert.equal(s.cefLookup(id('R2'),'192.0.2.2')?.port,g(0));
});
test('completed reference supplies five configuration/save tasks and no prefilled packet observations',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(node.startupConfig,node.config);}const s=load();assert.equal(lessonProgress(s)!.complete,5);finish(s);
});
test('published IOS commands build both GRE endpoints from practice and carry all six real traffic tasks',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,5);finish(s);assert.equal(s.cefLookup(id('R1'),'192.168.20.10')?.port,'Tunnel0');assert.equal(s.cefLookup(id('R2'),'192.168.10.10')?.port,'Tunnel0');
});
test('GRE proof correlates inner request/reply IDs with outer packets, ISP forwarding and both endpoint decapsulations',()=>{
 const s=load();assert.equal(task(s,'pc1-gre'),3);assert.equal(row(s,'isp-carrier').complete,true);const request=s.events.find(e=>e.nodeId===id('PC2')&&e.label==='Echo request accepted')!,outer=s.events.find(e=>e.nodeId===id('R1')&&e.label==='GRE encapsulation'&&e.packet?.parentId===request.packet?.id)!;assert.equal(outer.packet!.source,'192.0.2.2');assert.equal(outer.packet!.destination,'198.51.100.2');assert.equal(outer.packet!.size,request.packet!.size!+24);assert.ok(s.events.some(e=>e.nodeId===id('ISP')&&e.label==='Frame sent'&&e.packet?.id===outer.packet!.id&&matchesProtocol(e,'GRE')));assert.equal(s.cefLookup(id('ISP'),'192.168.10.10'),undefined);assert.equal(s.cefLookup(id('ISP'),'192.168.20.10'),undefined);
});
test('an IP-valued tunnel source is equivalent to the prepared WAN interface source and remains operational',()=>{
 const s=load();change(s,'R1','interface Tunnel0','tunnel source 192.0.2.2');assert.equal(row(s,'r1-tunnel').complete,true);assert.equal(task(s,'r1-overlay'),3);change(s,'R1','interface '+g(0),'shutdown');assert.equal(s.interfaceUp(id('R1'),'Tunnel0'),false);assert.equal(row(s,'r1-tunnel').complete,false);change(s,'R1','interface '+g(0),'no shutdown');assert.equal(task(s,'r1-overlay'),3);
});
test('an incorrect destination leaves local GRE up without proving peer delivery; correction restores actual traffic',()=>{
 const s=load();change(s,'R1','interface Tunnel0','tunnel destination 198.51.100.1');assert.equal(s.interfaceUp(id('R1'),'Tunnel0'),true);assert.equal(ping(s,'R1','10.255.0.2'),0);assert.equal(row(s,'r1-overlay').complete,false);assert.ok(s.events.some(e=>e.label==='No matching GRE tunnel'));change(s,'R1','interface Tunnel0','tunnel destination 198.51.100.2');assert.equal(task(s,'r1-overlay'),3);
});
test('a missing peer tunnel does not force a local no-keepalive tunnel down or earn a false success',()=>{
 const s=load();change(s,'R2','no interface Tunnel0');assert.equal(s.interfaceUp(id('R1'),'Tunnel0'),true);assert.equal(ping(s,'R1','10.255.0.2'),0);assert.equal(row(s,'r1-overlay').complete,false);run(new IOSSession(s,id('R2')),...GRE_COMMANDS.R2);s.advance(100);assert.equal(task(s,'r1-overlay'),3);
});
test('a missing physical underlay route cannot carry GRE and its live underlay goal fails after prior success',()=>{
 const s=load();assert.equal(task(s,'r1-underlay'),3);change(s,'R1','no ip route 198.51.100.0 255.255.255.252 192.0.2.1');assert.equal(row(s,'r1-underlay').complete,false);assert.equal(ping(s,'R1','10.255.0.2'),0);assert.equal(row(s,'r1-overlay').complete,false);assert.ok(s.events.some(e=>e.label==='Tunnel underlay unavailable'));change(s,'R1','ip route 198.51.100.0 255.255.255.252 192.0.2.1');assert.equal(task(s,'r1-overlay'),3);
});
test('a more-specific recursive route back into Tunnel0 cannot carry the outer GRE packet',()=>{
 const s=load();change(s,'R1','ip route 198.51.100.2 255.255.255.255 10.255.0.2');assert.equal(s.cefLookup(id('R1'),'198.51.100.2')?.port,'Tunnel0');assert.equal(actionAvailable(s,row(s,'r1-underlay').objective),false);assert.equal(ping(s,'R1','10.255.0.2'),0);assert.ok(s.events.some(e=>e.label==='Tunnel underlay unavailable'));change(s,'R1','no ip route 198.51.100.2 255.255.255.255 10.255.0.2');assert.equal(task(s,'pc1-gre'),3);
});
test('a missing return LAN route allows tunnel-address pings but prevents a complete PC round trip',()=>{
 const s=load();change(s,'R2','no ip route 192.168.10.0 255.255.255.0 10.255.0.1');assert.equal(task(s,'r1-overlay'),3);assert.equal(ping(s,'PC1','192.168.20.10'),0);assert.equal(row(s,'pc1-gre').complete,false);assert.equal(row(s,'r2-route').complete,false);change(s,'R2','ip route 192.168.10.0 255.255.255.0 10.255.0.1');assert.equal(task(s,'pc1-gre'),3);
});
test('raw counters and unrelated or mismatched encapsulation identities cannot create GRE proof',()=>{
 const s=load();d(s).runtime.features.grePackets=999;s.emit({nodeId:id('R1'),port:'Tunnel0',protocol:'GRE',label:'GRE encapsulation',detail:'Unrelated',disposition:'forward'});assert.equal(row(s,'pc1-gre').complete,false);assert.equal(task(s,'pc1-gre'),3);const c=row(s,'pc1-gre').objective.criterion;assert.equal(matches(s,c),true);for(const e of s.events)if(e.label==='GRE encapsulation'&&e.packet)e.packet.parentId='wrong-inner';assert.equal(matches(s,c),false);
});
test('ordinary routed LAN traffic without GRE cannot satisfy overlay or carrier goals',()=>{
 const s=load();change(s,'R1','no ip route 192.168.20.0 255.255.255.0 10.255.0.2','ip route 192.168.20.0 255.255.255.0 192.0.2.1');change(s,'R2','no ip route 192.168.10.0 255.255.255.0 10.255.0.1','ip route 192.168.10.0 255.255.255.0 198.51.100.1');change(s,'ISP','ip route 192.168.10.0 255.255.255.0 192.0.2.2','ip route 192.168.20.0 255.255.255.0 198.51.100.2');assert.equal(ping(s,'PC1','192.168.20.10'),3);assert.equal(row(s,'pc1-gre').complete,false);assert.equal(row(s,'isp-carrier').complete,false);assert.equal(row(s,'r1-route').complete,false);
});
test('mismatched GRE keys reject actual packets despite local up/up; matching keys restore delivery',()=>{
 const s=load();change(s,'R1','interface Tunnel0','tunnel key 77');assert.equal(s.interfaceUp(id('R1'),'Tunnel0'),true);assert.equal(s.interfaceUp(id('R2'),'Tunnel0'),true);assert.equal(ping(s,'R1','10.255.0.2'),0);assert.equal(row(s,'r1-overlay').complete,false);change(s,'R2','interface Tunnel0','tunnel key 77');assert.equal(task(s,'r1-overlay'),3);assert.equal(task(s,'pc1-gre'),3);
});
test('shutting the overlay stops LAN delivery while independent underlay probes remain usable',()=>{
 const s=load();change(s,'R1','interface Tunnel0','shutdown');assert.equal(ping(s,'PC1','192.168.20.10'),0);assert.equal(row(s,'r1-tunnel').complete,false);assert.equal(task(s,'r1-underlay'),3);change(s,'R1','interface Tunnel0','no shutdown');assert.equal(task(s,'pc1-gre'),3);
});
test('both startup policies must be saved and IOS reload restores an unsaved broken endpoint',()=>{
 const s=load('practice');for(const[name,commands]of Object.entries(GRE_COMMANDS))run(new IOSSession(s,id(name)),...commands.filter(c=>c!=='write memory'));s.advance(100);assert.equal(row(s,'save-tunnels').complete,false);run(cli(s),'write memory');assert.equal(row(s,'save-tunnels').complete,false);run(cli(s,'R2'),'write memory');assert.equal(row(s,'save-tunnels').complete,true);change(s,'R1','interface Tunnel0','tunnel destination 198.51.100.1');assert.equal(row(s,'save-tunnels').complete,false);s.reloadIOS(id('R1'));s.advance(8000);assert.equal(row(s,'save-tunnels').complete,true);assert.equal(task(s,'pc1-gre'),3);
});
test('portable saves retain observations and startup separately while live goals and stable device IDs remain meaningful',()=>{
 const s=load();finish(s);d(s).config.hostname='Branch-A';const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(s.serialize())));restored.advance(1000);assert.equal(lessonProgress(restored)!.complete,12);assert.equal(task(restored,'pc1-gre'),3);change(restored,'R1','interface Tunnel0','shutdown');assert.equal(row(restored,'r1-tunnel').complete,false);assert.equal(row(restored,'pc1-gre').complete,true);
});
test('published verification commands report actual GRE/IP, overlay CEF, Windows connectivity and saved configuration',()=>{
 const s=load();for(const[name,commands]of Object.entries(catalogGuideResources(slug)!.verification))run(cli(s,name),...commands);const c=cli(s);assert.match(c.execute('show interfaces Tunnel0').join('\n'),/Tunnel0 is up, line protocol is up/);assert.match(c.execute('show interfaces Tunnel0').join('\n'),/Tunnel protocol\/transport GRE\/IP/);assert.match(c.execute('show ip cef 192.168.20.10').join('\n'),/Tunnel0/);assert.equal(row(s,'pc1-gre').complete,true);
});
test('imported GRE criteria are bounded data and reject malformed addresses, masks and identity fields',()=>{
 const s=load(),o=row(s,'pc1-gre').objective;validateLesson({title:'GRE',description:'',objectives:[o]});for(const criterion of [{...o.criterion,address:'999.1.1.1'},{...o.criterion,transit:''},{kind:'gre-tunnel',device:id('R1'),interface:'Tunnel0',sourceInterface:g(0),sourceAddress:'192.0.2.2',destination:'198.51.100.2',address:'10.255.0.1',mask:'255.0.255.0'},{kind:'gre-route',device:id('R1'),network:'192.168.20.0',prefix:33,nextHop:'10.255.0.2',interface:'Tunnel0'},{kind:'gre-carrier',device:id('ISP'),addresses:Array(17).fill('192.168.20.10')}])assert.throws(()=>validateLesson({title:'GRE',description:'',objectives:[{...o,criterion}]}));
});
