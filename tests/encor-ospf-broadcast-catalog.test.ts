import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {ospfLiveDetail} from '../src/ospf-packets.ts';
import {createCatalogLab,ENCOR_OSPF_BROADCAST_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const slug='ospf-broadcast-network',id=(n:string)=>'device-obc-'+n.toLowerCase(),g='GigabitEthernet0/1',names=['R1','R2','R3','R4'];
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(15000);return s;}
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!,row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!,state=(s:Simulator,n:string)=>d(s,n).runtime.features.ospfInterfaces[g],route=(s:Simulator,n:string,net:number)=>d(s,n).runtime.routes.find(r=>r.network===`192.168.${net}.0`&&r.prefix===24);
function cli(s:Simulator,n:string){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,lines:string[],wait=15000){run(cli(s,n),'conf t',...lines,'end');s.advance(wait);lessonProgress(s);}
function configure(s:Simulator,save=true,order=names){for(const n of order)run(new IOSSession(s,id(n)),...COMMANDS[n].filter(l=>save||l!=='write memory'));s.advance(15000);}
function ping(s:Simulator,n:string,address:string){const p=s.ping(id(n),address,{count:3});s.advance(4000);lessonProgress(s);return p.received;}
function pairs(s:Simulator){assert.equal(ping(s,'PC1','192.168.40.10'),3);assert.equal(ping(s,'PC2','192.168.30.10'),3);}
function roles(s:Simulator,dr='R1',bdr:string|null='R2',members=names){for(const n of members){assert.equal(state(s,n).role,n===dr?'DR':n===bdr?'BDR':'DROTHER');assert.equal(state(s,n).drDeviceId,id(dr));assert.equal(state(s,n).bdrDeviceId,bdr?id(bdr):undefined);}}
function reset(s:Simulator){for(const n of names)change(s,n,['interface g0/1','shutdown'],100);for(const n of names)change(s,n,['interface g0/1','no shutdown']);roles(s);}
function nonpreempt(s:Simulator){change(s,'R2',['interface g0/1','ip ospf priority 200']);roles(s);assert.equal(row(s,'non-preemption').complete,false);assert.ok((s.lab as CatalogLab).lesson!.observations!.includes('"non-preemption"/0'));change(s,'R2',['interface g0/1','ip ospf priority 50']);assert.equal(row(s,'non-preemption').complete,true);}
function promotion(s:Simulator){change(s,'R1',['interface g0/1','shutdown']);roles(s,'R2',null,['R2','R3','R4']);assert.equal(row(s,'dr-promotion').complete,false);pairs(s);assert.ok((s.lab as CatalogLab).lesson!.observations!.includes('"dr-promotion"/0'));change(s,'R1',['interface g0/1','no shutdown']);roles(s,'R2','R1');assert.equal(row(s,'dr-promotion').complete,false);pairs(s);reset(s);assert.equal(row(s,'dr-promotion').complete,true);}
function finish(s:Simulator){pairs(s);assert.equal(lessonProgress(s)!.complete,13);nonpreempt(s);assert.equal(lessonProgress(s)!.complete,14);promotion(s);assert.equal(lessonProgress(s)!.complete,15);pairs(s);}
function networkOutput(s:Simulator,n='R3'){return cli(s,n).execute('show ip ospf database network').join('\n');}

test('independent ENCOR shared Ethernet practice has seven nodes, six links and fifteen zero-credit tasks',()=>{
 const entry=LAB_CATALOG.find(e=>e.id===slug)!;assert.equal(entry.group,'CCNP ENCOR');assert.equal(entry.section,'Layer 3');assert.equal(LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR'&&e.section==='Layer 3').length,6);assert.equal((createCatalogLab('ospf-dr-bdr-election').lab as CatalogLab).catalogId,'ospf-dr-bdr-election');const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const s=load('practice');validateLesson((s.lab as CatalogLab).lesson);assert.equal(s.lab.devices.length,7);assert.equal(s.lab.links.length,6);assert.equal(lessonProgress(s)!.rows.length,15);assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,2);for(const n of names){assert.deepEqual(d(s,n).config.protocols,{});assert.deepEqual(d(s,n).config.staticRoutes,[]);}assert.equal(ping(s,'PC1','192.168.30.1'),3);assert.equal(ping(s,'PC1','192.168.40.10'),0);
});
test('all four published IOS configurations earn eleven live tasks and real traffic/experiments complete fifteen',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,11);for(const n of names)assert.deepEqual(JSON.parse(JSON.stringify(d(s,n).config)),d(s,n).startupConfig);finish(s);
});
test('completed reference saves actual configurations with empty runtime and no fabricated experiment or packet credit',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(JSON.parse(JSON.stringify(node.config)),node.startupConfig);}const s=load();assert.equal(lessonProgress(s)!.complete,11);for(const goal of ['pc1-pc2','pc2-pc1','non-preemption','dr-promotion'])assert.equal(row(s,goal).complete,false);finish(s);
});
test('received broadcast roles form ten directed Full relationships and a normal DROTHER 2WAY pair',()=>{
 const s=load();roles(s);let full=0,two=0;for(const n of names){const live=ospfLiveDetail(s,id(n),'ospf')!;assert.equal(live.neighbors.length,3);full+=live.neighbors.filter(n=>n.state==='FULL').length;two+=live.neighbors.filter(n=>n.state==='2WAY').length;const out=cli(s,n).execute('show ip ospf interface '+g).join('\n');assert.match(out,/Network Type BROADCAST/);assert.match(out,/Hello 10, Dead 40/);if(n==='R3'||n==='R4'){const peers=cli(s,n).execute('show ip ospf neighbor').join('\n');assert.match(peers,/FULL\/\s*DR/);assert.match(peers,/FULL\/\s*BDR/);assert.match(peers,/2WAY\/\s*DROTHER/);}}assert.equal(full,10);assert.equal(two,2);pairs(s);
});
test('all four views project the received DR Network LSA with shared interface LSID and four attached router IDs',()=>{
 const s=load();for(const n of names){const out=networkOutput(s,n);assert.match(out,/Link State ID: 10\.0\.123\.1 \(address of Designated Router\)/);assert.match(out,/Advertising Router: 1\.1\.1\.1/);assert.match(out,/Length: 40\b/);assert.equal((out.match(/Attached Router:/g)??[]).length,4);for(const rid of ['1.1.1.1','2.2.2.2','3.3.3.3','4.4.4.4'])assert.ok(out.includes('Attached Router: '+rid));assert.equal(ospfLiveDetail(s,id(n),'ospf')!.lsas.length,4);}assert.equal(row(s,'network-lsa').complete,true);
});
test('BDR promotion flushes stale disconnected attachment instead of unioning old other-router records into the new Network LSA',()=>{
 const s=load();change(s,'R1',['interface g0/1','shutdown']);roles(s,'R2',null,['R2','R3','R4']);for(const n of ['R2','R3','R4']){const out=networkOutput(s,n);assert.match(out,/Link State ID: 10\.0\.123\.2/);assert.match(out,/Advertising Router: 2\.2\.2\.2/);assert.match(out,/Length: 36\b/);assert.equal((out.match(/Attached Router:/g)??[]).length,3);assert.doesNotMatch(out,/Attached Router: 1\.1\.1\.1/);}pairs(s);change(s,'R1',['interface g0/1','no shutdown']);assert.equal((networkOutput(s).match(/Attached Router:/g)??[]).length,4);assert.match(networkOutput(s),/Advertising Router: 2\.2\.2\.2/);
});
test('learned intra-area O routes use the destination DROTHER directly with exact next hop, AD110 and metric11',()=>{
 const s=load();for(const n of names)for(const net of [30,40]){if(n==='R'+net/10)continue;const r=route(s,n,net)!;assert.equal(r.protocol,'O');assert.equal(r.ad,110);assert.equal(r.metric,11);assert.equal(r.nextHop,'10.0.123.'+net/10);assert.equal(r.interface,g);}pairs(s);const packets=s.events.filter(e=>e.label==='Frame sent'&&e.packet?.protocol==='ICMP');assert.equal(packets.some(e=>[id('R1'),id('R2')].includes(e.nodeId??'')),false);assert.ok(packets.some(e=>e.nodeId===id('SW1')));
});
test('passive LANs advertise cost1 prefixes without OSPF Hellos while the broadcast interfaces exchange real control packets',()=>{
 const s=load();s.advance(15000);for(const n of ['R3','R4']){assert.equal(ospfLiveDetail(s,id(n),'ospf')!.interfaces.find(p=>p.name==='GigabitEthernet0/0')!.passive,true);assert.equal(s.events.some(e=>e.nodeId===id(n)&&e.port==='GigabitEthernet0/0'&&e.packet?.protocol==='OSPF'&&e.disposition==='send'),false);assert.ok(s.events.some(e=>e.nodeId===id(n)&&e.port===g&&e.packet?.protocol==='OSPF'&&e.disposition==='send'));}pairs(s);
});
test('blocking actual OSPF datagrams prevents adjacency and received Network-LSA credit despite configured priorities',()=>{
 const s=new Simulator(),send=s.sendControlDatagram.bind(s);let block=true;s.sendControlDatagram=(node,src,dest,port,body,options)=>{if(block&&port===89)return;send(node,src,dest,port,body,options);};s.load(createCatalogLab(slug,'completed'));s.advance(15000);assert.equal(row(s,'neighbor-states').complete,false);assert.equal(row(s,'network-lsa').complete,false);assert.equal(row(s,'learned-lans').complete,false);assert.equal(ping(s,'PC1','192.168.40.10'),0);block=false;s.advance(15000);assert.equal(row(s,'network-lsa').complete,true);pairs(s);
});
test('non-preemption observation waits for a received higher-priority R2 Hello instead of configuration alone',()=>{
 const s=load(),send=s.sendControlDatagram.bind(s);let block=true;s.sendControlDatagram=(node,src,dest,port,body,options)=>{if(block&&node===id('R2')&&port===89)return;send(node,src,dest,port,body,options);};change(s,'R2',['interface g0/1','ip ospf priority 200'],1000);roles(s);assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"non-preemption"/0'),false);block=false;s.advance(15000);lessonProgress(s);assert.ok((s.lab as CatalogLab).lesson!.observations!.includes('"non-preemption"/0'));change(s,'R2',['interface g0/1','ip ospf priority 50']);assert.equal(row(s,'non-preemption').complete,true);
});
test('promotion needs new successful requests in both directions during the matching post-shutdown incident and healthy recovery',()=>{
 const s=load();pairs(s);change(s,'R1',['interface g0/1','shutdown']);assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"dr-promotion"/0'),false);assert.equal(ping(s,'PC1','192.168.40.10'),3);assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"dr-promotion"/0'),false);assert.equal(ping(s,'PC2','192.168.30.10'),3);assert.ok((s.lab as CatalogLab).lesson!.observations!.includes('"dr-promotion"/0'));assert.equal(row(s,'dr-promotion').complete,false);change(s,'R1',['interface g0/1','no shutdown']);roles(s,'R2','R1');assert.equal(row(s,'dr-promotion').complete,false);reset(s);assert.equal(row(s,'dr-promotion').complete,true);
});
test('a never-formed R1 cannot fabricate promotion achievement from a working R2 DR domain',()=>{
 const doc=createCatalogLab(slug,'completed');doc.lab.devices.find(d=>d.id===id('R1'))!.config.interfaces[g].adminUp=false;const s=new Simulator();s.load(doc);s.advance(15000);roles(s,'R2',null,['R2','R3','R4']);pairs(s);assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"dr-promotion"/0'),false);reset(s);assert.equal(row(s,'dr-promotion').complete,false);
});
test('eviction of older Full events still permits genuine later Full-to-Down promotion proof',()=>{
 const s=load();pairs(s);s.events.splice(0,s.events.length,...s.events.filter(e=>e.label!=='OSPF neighbor FULL'));nonpreempt(s);promotion(s);assert.equal(lessonProgress(s)!.complete,15);
});
test('a higher-priority router that joins later cannot preempt the incumbent and a controlled reset restores intended roles',()=>{
 const s=load('practice');configure(s,true,['R3','R4','R2','R1']);roles(s,'R2','R1');assert.equal(row(s,'elected-roles').complete,false);pairs(s);reset(s);roles(s);assert.equal(row(s,'elected-roles').complete,true);pairs(s);
});
test('equal-priority fresh election uses the higher router ID, while priority0 DROTHERs are ineligible',()=>{
 const doc=createCatalogLab(slug,'completed');doc.lab.devices.find(d=>d.id===id('R2'))!.config.interfaces[g].features.ospf.priority=100;const s=new Simulator();s.load(doc);s.advance(15000);roles(s,'R2','R1');assert.equal(row(s,'elected-roles').complete,false);pairs(s);
});
test('a passive DROTHER, area mismatch and timer mismatch lose intended neighbors or routes until restored',()=>{
 const s=load();for(const[fault,repair]of [[['router ospf 10','passive-interface g0/1'],['router ospf 10','no passive-interface g0/1']],[['interface g0/1','ip ospf 10 area 1'],['interface g0/1','ip ospf 10 area 0']],[['interface g0/1','ip ospf hello-interval 5','ip ospf dead-interval 20'],['interface g0/1','no ip ospf hello-interval','no ip ospf dead-interval']]]){change(s,'R4',fault,45000);assert.equal(row(s,'neighbor-states').complete,false);assert.equal(row(s,'network-lsa').complete,false);assert.equal(ping(s,'PC1','192.168.40.10'),0);change(s,'R4',repair);assert.equal(row(s,'neighbor-states').complete,true);assert.equal(row(s,'network-lsa').complete,true);pairs(s);}
});
test('loss on a physically up DR link waits for Dead expiry and promotes BDR without fabricating the explicit shutdown exercise',()=>{
 const s=load(),wire=s.lab.links.find(l=>l.id==='link-obc-r1')!;wire.loss=1;s.changed();s.advance(1000);assert.equal(s.interfaceUp(id('R1'),g),true);assert.equal(state(s,'R2').role,'BDR');s.advance(45000);roles(s,'R2',null,['R2','R3','R4']);pairs(s);assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"dr-promotion"/0'),false);wire.loss=0;s.changed();s.advance(15000);roles(s,'R2','R1');reset(s);pairs(s);
});
test('withdrawing a passive LAN keeps all neighbor states but breaks its route and actual return traffic',()=>{
 const s=load();change(s,'R4',['interface g0/0','no ip ospf 10 area 0']);assert.equal(row(s,'neighbor-states').complete,true);assert.equal(row(s,'network-lsa').complete,true);assert.equal(route(s,'R3',40),undefined);assert.equal(ping(s,'PC1','192.168.40.10'),0);assert.equal(ping(s,'PC2','192.168.30.10'),0);change(s,'R4',['interface g0/0','ip ospf 10 area 0']);pairs(s);
});
test('outbound cost change affects real route metrics in that direction while the election stays healthy',()=>{
 const s=load();change(s,'R3',['interface g0/1','ip ospf cost 20']);roles(s);assert.equal(route(s,'R3',40)!.metric,21);assert.equal(route(s,'R4',30)!.metric,11);assert.equal(row(s,'learned-lans').complete,false);pairs(s);change(s,'R3',['interface g0/1','ip ospf cost 10']);assert.equal(row(s,'learned-lans').complete,true);
});
test('static routes cannot substitute for OSPF-only routing or the observed direct DROTHER packet path',()=>{
 const s=load();change(s,'R3',['ip route 192.168.40.0 255.255.255.0 10.0.123.4']);pairs(s);assert.equal(row(s,'normal-domain').complete,false);assert.equal(row(s,'learned-lans').complete,false);assert.equal(matches(s,row(s,'pc1-pc2').objective.criterion),false);change(s,'R3',['no ip route 192.168.40.0 255.255.255.0 10.0.123.4']);pairs(s);
});
test('packet identities, bridge forwarding, actual receive ports, IPv4 family and absence of DR relay are required',()=>{
 const s=load();pairs(s);const criterion=row(s,'pc1-pc2').objective.criterion,events=structuredClone(s.events);for(const mutate of [(e:any)=>{if(e.label==='Echo reply received'&&e.packet)e.packet.parentId='wrong';},(e:any)=>{if(e.packet?.protocol==='ICMP')e.packet.ipVersion=6;},(e:any)=>{if(e.nodeId===id('SW1')&&e.label==='Frame received'&&e.packet?.protocol==='ICMP')e.port='wrong';},(e:any)=>{if(e.label==='Echo request accepted'&&e.packet)e.packet.destination='192.168.40.99';}]){s.events.splice(0,s.events.length,...structuredClone(events));for(const e of s.events)mutate(e);assert.equal(matches(s,criterion),false);}s.events.splice(0,s.events.length,...structuredClone(events).filter(e=>!(e.nodeId===id('SW1')&&e.label==='Frame sent'&&e.packet?.protocol==='ICMP')));assert.equal(matches(s,criterion),false);s.events.splice(0,s.events.length,...structuredClone(events));const sends=s.events.filter(e=>e.nodeId===id('R3')&&e.label==='Frame sent'&&e.packet?.protocol==='ICMP');s.events.push(...sends.map(e=>({...structuredClone(e),nodeId:id('R1')})));assert.equal(matches(s,criterion),false);
});
test('all published IOS and Windows commands expose actual broadcast states, Network LSA ownership, O routes and traces',()=>{
 const s=load(),res=catalogGuideResources(slug)!;assert.equal(res.rows.length,8);for(const r of res.rows)assert.equal(r.length,res.columns.length);pairs(s);for(const[n,lines]of Object.entries(res.verification))for(const line of lines){const out=cli(s,n).execute(line);assert.ok(!out.some(iosRejected),n+' '+line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);if(line.startsWith('ping'))assert.match(out.join('\n'),/Received = 3/);if(line.startsWith('tracert')){assert.match(out.join('\n'),/Trace complete/);assert.ok(out.join('\n').includes(n==='PC1'?'10.0.123.4':'10.0.123.3'));assert.doesNotMatch(out.join('\n'),/10\.0\.123\.[12](?:\s|$)/);}}
});
test('write memory, saved reopening and IOS restart restore policy while elections and received databases are rebuilt',()=>{
 const s=load('practice');configure(s,false);assert.equal(row(s,'saved').complete,false);for(const n of names)run(cli(s,n),'write memory');finish(s);change(s,'R3',['interface g0/1','ip ospf cost 20']);s.reloadIOS(id('R3'));s.advance(30000);assert.equal(lessonProgress(s)!.complete,15);d(s,'R3').config.hostname='User LAN';const f=new Simulator();f.load(parseLabFile(serializeLabFile(s.serialize())));assert.equal(row(f,'neighbor-states').complete,false);assert.equal(row(f,'pc1-pc2').complete,true);assert.equal(row(f,'dr-promotion').complete,false);f.advance(15000);roles(f);assert.equal(lessonProgress(f)!.complete,15);pairs(f);
});
test('bounded imported criteria reject invalid priorities, identities, bridge/path combinations and members',()=>{
 const s=load(),lesson=(s.lab as CatalogLab).lesson!,echo={kind:'obc-echo',device:id('PC1'),target:id('PC2'),address:'192.168.40.10',routers:[id('R3'),id('R4')],bridge:id('SW1')};for(const criterion of [{...echo,address:'::1'},{...echo,routers:[id('R3'),id('R3')]},{...echo,bridge:id('R3')},{...echo,routers:[id('PC1'),id('R4')]},{kind:'obc-network',device:id('R3'),dr:id('R1'),interface:g,members:[id('R1')]},{kind:'obc-nonpreempt',device:id('R1'),peer:id('R2'),interface:g,incumbentPriority:100,priority:50},{kind:'obc-nonpreempt',device:id('R1'),peer:id('R2'),interface:g,incumbentPriority:100,priority:256}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));assert.equal(matches(s,{...echo,target:'missing'} as any),false);assert.equal(matches(s,{...echo,bridge:'missing'} as any),false);assert.equal(matches(s,{kind:'obc-network',device:id('R3'),dr:'missing',interface:g,members:[id('R1'),id('R3')]}),false);
});

test('a physically-up failed BDR expires without displacing a live DR, and rejoins as BDR after packet reception returns',()=>{
 const s=load(),wire=s.lab.links.find(l=>l.id==='link-obc-r2')!;wire.loss=1;s.changed();s.advance(1000);assert.equal(state(s,'R1').bdrDeviceId,id('R2'));s.advance(45000);roles(s,'R1',null,['R1','R3','R4']);pairs(s);assert.equal(row(s,'dr-promotion').complete,false);wire.loss=0;s.changed();s.advance(15000);roles(s);pairs(s);
});
