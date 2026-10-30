import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,MULTI_AREA_OSPFV2_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG,catalogSections,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {ospfLiveDetail} from '../src/ospf-packets.ts';
const slug='multi-area-ospfv2',id=(n:string)=>'device-mao-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(15000);return s;}
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!;
const row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!;
function cli(s:Simulator,n:string){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,...lines:string[]){run(cli(s,n),'conf t',...lines,'end');s.advance(15000);lessonProgress(s);}
function configure(s:Simulator,save=true){for(const[n,lines]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...lines.filter(l=>save||l!=='write memory'));s.advance(15000);}
function ping(s:Simulator,n:string,target:string){const p=s.ping(id(n),target,{count:3});s.advance(5000);lessonProgress(s);return p.received;}
function pairs(s:Simulator){for(const[n,address]of [['PC1','192.168.20.10'],['PC1','192.168.30.10'],['SRV1','192.168.10.10'],['PC2','192.168.30.10']])assert.equal(ping(s,n,address),3);}
function backbone(s:Simulator){change(s,'R2','interface g0/2','shutdown');assert.equal(row(s,'backbone-recovery').complete,false);assert.ok((s.lab as CatalogLab).lesson!.observations!.includes('"backbone-recovery"/0'));assert.equal(ping(s,'PC1','192.168.20.10'),3);assert.equal(ping(s,'PC1','192.168.30.10'),0);assert.equal(ping(s,'PC2','192.168.30.10'),0);change(s,'R2','interface g0/2','no shutdown');assert.equal(row(s,'backbone-recovery').complete,true);pairs(s);}
function finish(s:Simulator){pairs(s);assert.equal(lessonProgress(s)!.complete,15);backbone(s);assert.equal(lessonProgress(s)!.complete,16);}
const learned=(s:Simulator,name:string,network:string)=>d(s,name).runtime.routes.find(r=>r.network===network&&r.prefix===24)!;

test('ENCOR has a Layer3 section with four labs and an independent seven-node sixteen-task multi-area OSPF lab',()=>{
 assert.deepEqual(catalogSections('CCNP ENCOR'),['Virtualization','Layer 2','Layer 3']);assert.equal(LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR'&&e.section==='Layer 3').length,4);const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const s=load('practice');validateLesson((s.lab as CatalogLab).lesson);assert.equal(s.lab.devices.length,7);assert.equal(s.lab.links.length,6);assert.equal(lessonProgress(s)!.rows.length,16);assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,4);assert.equal(ping(s,'PC1','192.168.30.10'),0);
});
test('published four-router IOS configuration yields eleven live tasks, real traffic and restored backbone achieve sixteen',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,11);for(const n of ['R1','R2','R3','R4'])assert.deepEqual(JSON.parse(JSON.stringify(d(s,n).config)),d(s,n).startupConfig);finish(s);
});
test('completed reference has saved configuration only, no invented incidents or packets and empty runtime',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(JSON.parse(JSON.stringify(node.config)),node.startupConfig);}const s=load();assert.equal(lessonProgress(s)!.complete,11);for(const n of ['backbone-recovery','pc1-server','server-pc1'])assert.equal(row(s,n).complete,false);finish(s);
});
test('received Full point-to-point neighbors and both area memberships identify R2/R3 as ABRs',()=>{
 const s=load();for(const[n,count,areas]of [['R1',1,[10]],['R2',2,[0,10]],['R3',2,[0,20]],['R4',1,[20]]] as const){const live=ospfLiveDetail(s,id(n),'ospf')!;assert.equal(live.neighbors.filter(n=>n.state==='FULL').length,count);assert.deepEqual([...new Set(live.interfaces.map(p=>Number(p.area)))].sort((a,b)=>a-b),areas);const out=cli(s,n).execute('show ip ospf').join('\n');if(count===2)assert.match(out,/It is an area border router/);else assert.doesNotMatch(out,/It is an area border router/);assert.match(cli(s,n).execute('show ip ospf neighbor').join('\n'),/FULL\/\s*-/);}
});
test('O and O IA routes use the correct source area, next hop, AD and accumulated metrics',()=>{
 const s=load();for(const[n,net,code,metric]of [['R2','192.168.10.0','O',11],['R3','192.168.20.0','O',11],['R3','192.168.30.0','O',11],['R1','192.168.20.0','O IA',11],['R1','192.168.30.0','O IA',31],['R2','192.168.30.0','O IA',21],['R3','192.168.10.0','O IA',21],['R4','192.168.10.0','O IA',31],['R4','192.168.20.0','O IA',21]] as const){const r=learned(s,n,net);assert.equal(r.protocol,code);assert.equal(r.metric,metric);assert.equal(r.ad,110);assert.ok(r.nextHop);}pairs(s);
});
test('Type3 summaries into a non-backbone area include the transit cost through Area0 instead of inventing metric1',()=>{
 const s=load();for(const[n,network,adv,area,metric]of [['R2','192.168.30.0','2.2.2.2',10,21],['R1','192.168.30.0','2.2.2.2',10,21],['R3','192.168.10.0','3.3.3.3',20,21],['R4','192.168.10.0','3.3.3.3',20,21]] as const){const out=cli(s,n).execute(`show ip ospf database summary ${network} adv-router ${adv}`).join('\n');assert.match(out,new RegExp('Summary Net Link States \\(Area '+area+'\\)'));assert.match(out,new RegExp('Advertising Router: '+adv.replaceAll('.','\\.')));assert.match(out,new RegExp('Metric: '+metric+'\\b'));assert.doesNotMatch(out,/Metric: 1\s/);}const backboneView=cli(s,'R2').execute('show ip ospf database summary 192.168.30.0 adv-router 3.3.3.3').join('\n');assert.match(backboneView,/Area 0/);assert.match(backboneView,/Metric: 11\b/);
});
test('local Router-LSA display sections stay area-scoped and P2P transits do not create network LSAs',()=>{
 const s=load();const a=cli(s,'R1').execute('show ip ospf database router').join('\n');assert.match(a,/Router Link States \(Area 10\)/);assert.doesNotMatch(a,/Area 0\)|Area 20\)|Link State ID: (?:3\.3\.3\.3|4\.4\.4\.4)/);const b=cli(s,'R4').execute('show ip ospf database router').join('\n');assert.match(b,/Router Link States \(Area 20\)/);assert.doesNotMatch(b,/Area 10\)|Area 0\)/);for(const n of ['R1','R2','R3','R4'])assert.doesNotMatch(cli(s,n).execute('show ip ospf database network').join('\n'),/Net Link States/);
});
test('dropping actual OSPF control packets prevents Full neighbors, ABRs, learned routes and traffic credit',()=>{
 const s=new Simulator(),send=s.sendControlDatagram.bind(s);let block=true;s.sendControlDatagram=(node,source,dest,port,body,options)=>{if(block&&port===89)return;send(node,source,dest,port,body,options);};s.load(createCatalogLab(slug,'completed'));s.advance(15000);for(const n of ['full-neighbors','backbone-abrs','intra-routes','inter-routes','pc1-server'])assert.equal(row(s,n).complete,false);block=false;s.advance(15000);assert.equal(row(s,'full-neighbors').complete,true);pairs(s);
});
test('one-sided area mismatch and transit passive state remove adjacency and dependent routes until corrected',()=>{
 const s=load();change(s,'R2','interface g0/2','ip ospf 10 area 10');assert.equal(row(s,'full-neighbors').complete,false);assert.equal(row(s,'backbone-abrs').complete,false);assert.equal(learned(s,'R1','192.168.30.0'),undefined);change(s,'R2','interface g0/2','no ip ospf 10 area 10');assert.equal(row(s,'full-neighbors').complete,true);change(s,'R3','router ospf 10','passive-interface g0/1');assert.equal(row(s,'interface-policy').complete,false);assert.equal(row(s,'backbone-abrs').complete,false);change(s,'R3','router ospf 10','no passive-interface g0/1');pairs(s);
});
test('the backbone must remain Area0 even when both ends can form Full neighbors in the same wrong area',()=>{
 const s=load();for(const n of ['R2','R3'])change(s,n,'interface '+g(n==='R2'?2:1),'ip ospf 10 area 30');assert.equal(row(s,'full-neighbors').complete,true);assert.equal(row(s,'backbone-abrs').complete,false);assert.equal(row(s,'normal-domain').complete,false);assert.equal(row(s,'inter-routes').complete,false);for(const n of ['R2','R3'])change(s,n,'interface '+g(n==='R2'?2:1),'no ip ospf 10 area 30');assert.equal(row(s,'backbone-abrs').complete,true);pairs(s);
});
test('shutting the backbone withdraws remote routes but keeps local Area10 traffic; recovery requires prior real Full state',()=>{
 const s=load();finish(s);const before=lessonProgress(s)!.complete;assert.equal(before,16);const fresh=load('practice');change(fresh,'R2','interface g0/2','shutdown');assert.equal((fresh.lab as CatalogLab).lesson!.observations!.includes('"backbone-recovery"/0'),false);configure(fresh);assert.equal(row(fresh,'backbone-recovery').complete,false);pairs(fresh);
});
test('a passive LAN advertisement is still required and its removal withdraws only that LAN, not transit adjacencies',()=>{
 const s=load();change(s,'R4','router ospf 10','no network 192.168.30.0 0.0.0.255 area 20');assert.equal(row(s,'full-neighbors').complete,true);assert.equal(row(s,'inter-routes').complete,false);assert.equal(learned(s,'R1','192.168.30.0'),undefined);assert.equal(ping(s,'PC1','192.168.20.10'),3);change(s,'R4','router ospf 10','network 192.168.30.0 0.0.0.255 area 20');pairs(s);
});
test('changing one transit cost updates O IA routes and Type3 summary metrics without losing adjacency',()=>{
 const s=load();change(s,'R2','interface g0/2','ip ospf cost 25');assert.equal(row(s,'full-neighbors').complete,true);assert.equal(row(s,'interface-policy').complete,false);assert.equal(learned(s,'R1','192.168.30.0').metric,46);assert.equal(learned(s,'R2','192.168.30.0').metric,36);const out=cli(s,'R1').execute('show ip ospf database summary 192.168.30.0').join('\n');assert.match(out,/Metric: 36\b/);pairs(s);change(s,'R2','interface g0/2','ip ospf cost 10');assert.equal(row(s,'inter-routes').complete,true);
});
test('static routes cannot hide an OSPF fault or satisfy the normal OSPF-only domain and traffic criteria',()=>{
 const s=load();change(s,'R1','ip route 192.168.30.0 255.255.255.0 10.0.12.2');assert.equal(row(s,'normal-domain').complete,false);assert.equal(row(s,'inter-routes').complete,false);assert.equal(ping(s,'PC1','192.168.30.10'),3);assert.equal(matches(s,row(s,'pc1-server').objective.criterion),false);change(s,'R1','no ip route 192.168.30.0 255.255.255.0 10.0.12.2');assert.equal(row(s,'normal-domain').complete,true);
});
test('traffic matches both ICMP identities and every actual routed forwarding hop and receive event',()=>{
 const s=load();pairs(s);const c=row(s,'pc1-server').objective.criterion,events=structuredClone(s.events);for(const e of s.events)if(e.label==='Echo reply received'&&e.packet)e.packet.parentId='wrong';assert.equal(matches(s,c),false);s.events.splice(0,s.events.length,...structuredClone(events));s.events.splice(0,s.events.length,...s.events.filter(e=>!(e.nodeId===id('R3')&&e.label==='Frame sent'&&e.packet?.protocol==='ICMP')));assert.equal(matches(s,c),false);s.events.splice(0,s.events.length,...structuredClone(events));for(const e of s.events)if(e.nodeId===id('SRV1')&&e.label==='Echo request accepted'&&e.packet)e.packet.destination='192.168.30.99';assert.equal(matches(s,c),false);
});
test('write memory is required after repairs and IOS reload restores the saved area assignment',()=>{
 const s=load('practice');configure(s,false);assert.equal(row(s,'saved').complete,false);for(const n of ['R1','R2','R3','R4'])run(cli(s,n),'write memory');assert.equal(row(s,'saved').complete,true);change(s,'R2','interface g0/2','ip ospf 10 area 30');assert.equal(row(s,'saved').complete,false);s.reloadIOS(id('R2'));s.advance(30000);assert.equal(row(s,'saved').complete,true);pairs(s);
});
test('portable reopening retains traffic and a genuine backbone exercise but rebuilds all live adjacencies and routes',()=>{
 const s=load();finish(s);d(s,'R2').config.hostname='West ABR';const f=new Simulator();f.load(parseLabFile(serializeLabFile(s.serialize())));assert.equal(row(f,'full-neighbors').complete,false);assert.equal(row(f,'pc1-server').complete,true);assert.equal(row(f,'backbone-recovery').complete,false);f.advance(15000);assert.equal(lessonProgress(f)!.complete,16);pairs(f);
});
test('all published IOS/Windows verification commands expose correct neighbor, area, route and summary results',()=>{
 const s=load();pairs(s);const r=catalogGuideResources(slug)!;assert.equal(r.rows.length,6);for(const a of r.rows)assert.equal(a.length,r.columns.length);for(const[n,lines]of Object.entries(r.verification))for(const line of lines){const out=cli(s,n).execute(line).join('\n');assert.doesNotMatch(out,/% (?:Invalid|Incomplete)|not implemented|not recognized/);if(line.startsWith('ping'))assert.match(out,/Received = 3/);if(line.startsWith('tracert'))assert.match(out,/Trace complete/);}assert.match(cli(s,'R1').execute('show ip route ospf').join('\n'),/O IA\s+192\.168\.30\.0.*\[110\/31\]/);assert.match(cli(s,'R4').execute('show ip route ospf').join('\n'),/O IA\s+192\.168\.10\.0.*\[110\/31\]/);
});
test('new imported criteria are bounded and reject invalid areas, ambiguous paths and missing endpoints',()=>{
 const s=load(),lesson=(s.lab as CatalogLab).lesson!;for(const criterion of [{kind:'mao-abr',device:id('R2'),areas:[10]},{kind:'mao-domain',device:id('R1'),areas:[-1]},{kind:'mao-domain',device:id('R1'),areas:[10,10]},{kind:'mao-saved',device:id('R1'),interfaces:[]},{kind:'mao-echo',device:id('PC1'),target:id('SRV1'),address:'x',path:[id('R1'),id('R4')]},{kind:'mao-echo',device:id('PC1'),target:id('SRV1'),address:'192.168.30.10',path:[id('R1'),id('R1')]},{kind:'mao-outage',device:id('R2'),interface:'',peer:id('R3'),network:'192.168.30.0',localNetwork:'192.168.10.0'}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));assert.equal(matches(s,{kind:'mao-echo',device:id('PC1'),target:'missing',address:'192.168.30.10',path:[id('R1'),id('R2')]}),false);
});

test('backbone recovery still records a genuine Full-to-Down transition after older Full events leave the packet history',()=>{
 const s=load();pairs(s);s.events.splice(0,s.events.length,...s.events.filter(e=>e.label!=='OSPF neighbor FULL'));assert.equal(s.events.some(e=>e.label==='OSPF neighbor FULL'),false);backbone(s);assert.equal(lessonProgress(s)!.complete,16);
});
