import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {ospfLiveDetail} from '../src/ospf-packets.ts';
import {createCatalogLab,ENCOR_OSPF_P2P_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const slug='ospf-point-to-point-network',id=(n:string)=>'device-encor-p2p-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(15000);return s;}
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!,row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!,route=(s:Simulator,n:string,net:number)=>d(s,n).runtime.routes.find(r=>r.network===`192.168.${net}.0`&&r.prefix===24);
function cli(s:Simulator,n:string){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,...lines:string[]){run(cli(s,n),'conf t',...lines,'end');s.advance(15000);lessonProgress(s);}
function configure(s:Simulator,save=true){for(const[n,lines]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...lines.filter(l=>save||l!=='write memory'));s.advance(15000);}
function ping(s:Simulator,n:string,target:string){const p=s.ping(id(n),target,{count:3});s.advance(4000);lessonProgress(s);return p.received;}
function pairs(s:Simulator){assert.equal(ping(s,'PC1','192.168.30.10'),3);assert.equal(ping(s,'PC2','192.168.10.10'),3);}
function alternate(s:Simulator){change(s,'R1','interface g0/2','shutdown');for(const[n,net,hop,port]of [['R1',30,'10.0.12.1',1],['R3',10,'10.0.23.0',1]] as const){const r=route(s,n,net)!;assert.equal(r.protocol,'O');assert.equal(r.metric,21);assert.equal(r.ad,110);assert.equal(r.nextHop,hop);assert.equal(r.interface,g(port));}assert.equal(row(s,'failover-recovery').complete,false);pairs(s);assert.ok((s.lab as CatalogLab).lesson!.observations!.includes('"failover-recovery"/0'));}
function finish(s:Simulator){pairs(s);assert.equal(lessonProgress(s)!.complete,11);alternate(s);change(s,'R1','interface g0/2','no shutdown');assert.equal(lessonProgress(s)!.complete,12);pairs(s);}

test('ENCOR point-to-point is independent from CCNA and adds a zero-credit five-node twelve-task Layer3 exercise',()=>{
 const entry=LAB_CATALOG.find(e=>e.id===slug)!;assert.equal(entry.group,'CCNP ENCOR');assert.equal(entry.section,'Layer 3');assert.equal(LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR'&&e.section==='Layer 3').length,9);assert.equal(createCatalogLab('ospf-point-to-point').lab.devices.length,4);const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const s=load('practice');assert.equal(s.lab.devices.length,5);assert.equal(s.lab.links.length,5);validateLesson((s.lab as CatalogLab).lesson);assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,12);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,2);for(const n of ['R1','R2','R3']){assert.deepEqual(d(s,n).config.protocols,{});assert.deepEqual(d(s,n).config.staticRoutes,[]);}assert.equal(ping(s,'PC1','192.168.10.1'),3);assert.equal(ping(s,'PC2','192.168.30.1'),3);assert.equal(ping(s,'PC1','192.168.30.10'),0);
});
test('published three-router IOS configurations earn nine live goals, actual preferred traffic eleven and recovered failover twelve',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,9);for(const n of ['R1','R2','R3'])assert.deepEqual(JSON.parse(JSON.stringify(d(s,n).config)),d(s,n).startupConfig);finish(s);
});
test('completed reference contains saved configuration only, no manufactured packets or failure history',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(JSON.parse(JSON.stringify(node.config)),node.startupConfig);}const s=load();assert.equal(lessonProgress(s)!.complete,9);assert.equal(row(s,'pc1-pc2').complete,false);assert.equal(row(s,'failover-recovery').complete,false);finish(s);
});
test('all six /31 endpoints are legitimate addressed interfaces with received Full/- neighbors and no DR/BDR election',()=>{
 const s=load();for(const n of ['R1','R2','R3']){const live=ospfLiveDetail(s,id(n),'ospf')!;assert.equal(live.neighbors.filter(n=>n.state==='FULL').length,2);for(const p of [1,2]){assert.equal(d(s,n).config.interfaces[g(p)].mask,'255.255.255.254');assert.equal(live.interfaces.find(i=>i.name===g(p))!.networkType,'point-to-point');const out=cli(s,n).execute('show ip ospf interface '+g(p)).join('\n');assert.match(out,/Network Type POINT_TO_POINT/);assert.match(out,/State POINT_TO_POINT/);assert.match(out,/Hello 10, Dead 40/);assert.doesNotMatch(out,/Designated Router|Backup Designated/);}const peers=cli(s,n).execute('show ip ospf neighbor').join('\n');assert.equal((peers.match(/FULL\/\s*-/g)??[]).length,2);assert.doesNotMatch(cli(s,n).execute('show ip ospf database network').join('\n'),/Net Link States/);const lsas=cli(s,n).execute('show ip ospf database router').join('\n');assert.match(lsas,/another Router \(point-to-point\)/);for(const rid of ['1.1.1.1','2.2.2.2','3.3.3.3'])assert.ok(lsas.includes('Link State ID: '+rid));}pairs(s);
});
test('actual selected O routes use the direct metric6 path and R2 metric11 with exact next hop, interface and AD',()=>{
 const s=load();for(const[n,net,hop,port,metric]of [['R1',30,'10.0.13.1',2,6],['R3',10,'10.0.13.0',2,6],['R2',10,'10.0.12.0',1,11],['R2',30,'10.0.23.1',2,11]] as const){const r=route(s,n,net)!;assert.equal(r.protocol,'O');assert.equal(r.ad,110);assert.equal(r.nextHop,hop);assert.equal(r.interface,g(port));assert.equal(r.metric,metric);}pairs(s);
});
test('passive LANs advertise cost1 prefixes without sending OSPF Hellos to computers',()=>{
 const s=load();s.advance(15000);for(const n of ['R1','R3']){const live=ospfLiveDetail(s,id(n),'ospf')!;assert.equal(live.interfaces.find(p=>p.name===g(0))!.passive,true);assert.equal(s.events.some(e=>e.nodeId===id(n)&&e.port===g(0)&&e.packet?.protocol==='OSPF'&&e.disposition==='send'),false);}pairs(s);
});
test('dropping real protocol89 datagrams prevents learned-state credit even with correct configuration',()=>{
 const s=new Simulator(),send=s.sendControlDatagram.bind(s);let block=true;s.sendControlDatagram=(node,src,dest,port,body,options)=>{if(block&&port===89)return;send(node,src,dest,port,body,options);};s.load(createCatalogLab(slug,'completed'));s.advance(15000);assert.equal(row(s,'full-neighbors').complete,false);assert.equal(row(s,'learned-lans').complete,false);assert.equal(ping(s,'PC1','192.168.30.10'),0);block=false;s.advance(15000);assert.equal(row(s,'full-neighbors').complete,true);finish(s);
});
test('failover requires a genuine Full-to-Down incident and new alternate-path packets in both directions during that outage',()=>{
 const s=load();pairs(s);change(s,'R1','interface g0/2','shutdown');const c=row(s,'failover-recovery').objective.criterion;assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"failover-recovery"/0'),false);assert.equal(ping(s,'PC1','192.168.30.10'),3);assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"failover-recovery"/0'),false);assert.equal(ping(s,'PC2','192.168.10.10'),3);assert.ok((s.lab as CatalogLab).lesson!.observations!.includes('"failover-recovery"/0'));assert.equal(matches(s,c),false);change(s,'R1','interface g0/2','no shutdown');assert.equal(row(s,'failover-recovery').complete,true);
});
test('a never-formed direct link cannot fabricate an outage achievement from working alternate routes',()=>{
 const doc=createCatalogLab(slug,'completed');doc.lab.devices.find(d=>d.id===id('R1'))!.config.interfaces[g(2)].adminUp=false;const s=new Simulator();s.load(doc);s.advance(15000);pairs(s);assert.equal((s.lab as CatalogLab).lesson!.observations!.includes('"failover-recovery"/0'),false);change(s,'R1','interface g0/2','no shutdown');pairs(s);assert.equal(row(s,'failover-recovery').complete,false);
});
test('failure proof survives eviction of older Full events but requires the matching post-shutdown transition',()=>{
 const s=load();pairs(s);s.events.splice(0,s.events.length,...s.events.filter(e=>e.label!=='OSPF neighbor FULL'));alternate(s);change(s,'R1','interface g0/2','no shutdown');assert.equal(lessonProgress(s)!.complete,12);
});
test('working broadcast adjacencies cannot substitute for required point-to-point state',()=>{
 const s=load();for(const n of ['R1','R3'])change(s,n,'interface g0/2','ip ospf network broadcast');s.advance(45000);pairs(s);assert.equal(row(s,'point-to-point').complete,false);assert.equal(row(s,'full-neighbors').complete,true);assert.match(cli(s,'R1').execute('show ip ospf neighbor').join('\n'),/FULL\/\s*(?:DR|BDR)/);for(const n of ['R1','R3'])change(s,n,'interface g0/2','ip ospf network point-to-point');assert.equal(row(s,'point-to-point').complete,true);
});
test('priority0 is irrelevant to P2P Full adjacency while a priority0 broadcast pair stays 2WAY and falls back through R2',()=>{
 const s=load();for(const n of ['R1','R3'])change(s,n,'interface g0/2','ip ospf priority 0');assert.equal(row(s,'full-neighbors').complete,true);assert.equal(row(s,'point-to-point').complete,true);for(const n of ['R1','R3'])change(s,n,'interface g0/2','ip ospf network broadcast');s.advance(45000);assert.equal(row(s,'full-neighbors').complete,false);assert.match(cli(s,'R1').execute('show ip ospf neighbor').join('\n'),/2WAY\/\s*DROTHER/);assert.equal(route(s,'R1',30)!.metric,21);pairs(s);assert.equal(row(s,'failover-recovery').complete,false);for(const n of ['R1','R3'])change(s,n,'interface g0/2','ip ospf network point-to-point','no ip ospf priority');assert.equal(row(s,'full-neighbors').complete,true);
});
test('passive transit, area and timer mismatch remove the intended peer while alternate connectivity remains',()=>{
 const s=load();for(const[fault,repair,wait]of [[['router ospf 10','passive-interface g0/2'],['router ospf 10','no passive-interface g0/2'],15000],[['interface g0/2','ip ospf 10 area 1'],['interface g0/2','ip ospf 10 area 0'],15000],[['interface g0/2','ip ospf hello-interval 5','ip ospf dead-interval 20'],['interface g0/2','no ip ospf hello-interval','no ip ospf dead-interval'],45000]] as const){change(s,'R1',...fault);s.advance(wait);assert.equal(row(s,'full-neighbors').complete,false);assert.equal(route(s,'R1',30)!.metric,21);pairs(s);change(s,'R1',...repair);assert.equal(row(s,'full-neighbors').complete,true);assert.equal(route(s,'R1',30)!.metric,6);}
});
test('dead-timer expiry after primary link packet loss reconverges despite physical up state',()=>{
 const s=load(),wire=s.lab.links.find(l=>l.id==='link-encor-p2p-2')!;wire.loss=1;s.changed();s.advance(1000);assert.equal(s.interfaceUp(id('R1'),g(2)),true);assert.equal(route(s,'R1',30)!.metric,6);assert.equal(ping(s,'PC1','192.168.30.10'),0);s.advance(45000);assert.equal(route(s,'R1',30)!.metric,21);pairs(s);assert.equal(row(s,'failover-recovery').complete,false);wire.loss=0;s.changed();s.advance(15000);assert.equal(route(s,'R1',30)!.metric,6);
});
test('outbound cost affects only that direction and correct metrics remain live requirements despite traffic success',()=>{
 const s=load();change(s,'R1','interface g0/2','ip ospf cost 30');assert.equal(route(s,'R1',30)!.metric,21);assert.equal(route(s,'R3',10)!.metric,6);assert.equal(row(s,'point-to-point').complete,false);assert.equal(row(s,'learned-lans').complete,false);pairs(s);change(s,'R1','interface g0/2','ip ospf cost 5');assert.equal(row(s,'learned-lans').complete,true);
});
test('LAN withdrawal preserves Full transits but removes its prefix and both actual traffic directions',()=>{
 const s=load();change(s,'R3','interface g0/0','no ip ospf 10 area 0');assert.equal(row(s,'full-neighbors').complete,true);assert.equal(route(s,'R1',30),undefined);assert.equal(ping(s,'PC1','192.168.30.10'),0);assert.equal(ping(s,'PC2','192.168.10.10'),0);change(s,'R3','interface g0/0','ip ospf 10 area 0');pairs(s);
});
test('static shortcuts cannot earn OSPF-only routing or correlated normal-path packet credit',()=>{
 const s=load();change(s,'R1','ip route 192.168.30.0 255.255.255.0 10.0.13.1');pairs(s);assert.equal(row(s,'normal-domain').complete,false);assert.equal(row(s,'learned-lans').complete,false);assert.equal(matches(s,row(s,'pc1-pc2').objective.criterion),false);change(s,'R1','no ip route 192.168.30.0 255.255.255.0 10.0.13.1');pairs(s);
});
test('packet identities, actual forwarding hops, family and target must all match the claimed path',()=>{
 const s=load();pairs(s);const criterion=row(s,'pc1-pc2').objective.criterion,events=structuredClone(s.events);for(const mutate of [(e:any)=>{if(e.label==='Echo reply received'&&e.packet)e.packet.parentId='wrong';},(e:any)=>{if(e.packet?.protocol==='ICMP')e.packet.ipVersion=6;},(e:any)=>{if(e.label==='Echo request accepted'&&e.packet)e.packet.destination='192.168.30.99';}]){s.events.splice(0,s.events.length,...structuredClone(events));for(const e of s.events)mutate(e);assert.equal(matches(s,criterion),false);}s.events.splice(0,s.events.length,...structuredClone(events).filter(e=>!(e.nodeId===id('R3')&&e.label==='Frame sent'&&e.packet?.protocol==='ICMP')));assert.equal(matches(s,criterion),false);
});
test('prepared /31 addresses and local process IDs are graded independently of otherwise functioning adjacencies',()=>{
 const s=load('practice');for(const[n,lines]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...lines.map(l=>n==='R2'?l.replace('ospf 10','ospf 20'):l));s.advance(15000);assert.equal(row(s,'full-neighbors').complete,true);assert.equal(row(s,'r2-area0').complete,false);pairs(s);const clean=load();d(clean,'R2').config.interfaces[g(1)].mask='255.255.255.252';clean.changed();assert.equal(row(clean,'r2-area0').complete,false);
});
test('all published IOS/Windows verification commands expose actual P2P neighbors, LSAs, routes and traces',()=>{
 const s=load(),res=catalogGuideResources(slug)!;assert.equal(res.rows.length,5);for(const r of res.rows)assert.equal(r.length,res.columns.length);pairs(s);for(const[n,lines]of Object.entries(res.verification))for(const line of lines){const out=cli(s,n).execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);if(line.startsWith('ping'))assert.match(out.join('\n'),/Received = 3/);if(line.startsWith('tracert')){assert.match(out.join('\n'),/Trace complete/);assert.ok(out.join('\n').includes(n==='PC1'?'10.0.13.1':'10.0.13.0'));}}
});
test('write memory and IOS reload retain intended policy; portable reopening rebuilds neighbors while retaining genuine history',()=>{
 const s=load('practice');configure(s,false);assert.equal(row(s,'saved').complete,false);for(const n of ['R1','R2','R3'])run(cli(s,n),'write memory');assert.equal(row(s,'saved').complete,true);finish(s);change(s,'R1','interface g0/2','ip ospf cost 30');s.reloadIOS(id('R1'));s.advance(30000);assert.equal(lessonProgress(s)!.complete,12);d(s,'R2').config.hostname='Transit';const reopened=new Simulator();reopened.load(parseLabFile(serializeLabFile(s.serialize())));assert.equal(row(reopened,'full-neighbors').complete,false);assert.equal(row(reopened,'pc1-pc2').complete,true);assert.equal(row(reopened,'failover-recovery').complete,false);reopened.advance(15000);assert.equal(lessonProgress(reopened)!.complete,12);pairs(reopened);
});
test('imported path and failover criteria are bounded and missing endpoints fail closed',()=>{
 const s=load(),lesson=(s.lab as CatalogLab).lesson!,base={kind:'op2p-echo',device:id('PC1'),target:id('PC2'),address:'192.168.30.10',path:[id('R1'),id('R3')]};for(const criterion of [{...base,address:'::1'},{...base,path:[id('R1'),id('R1')]},{...base,path:[id('PC1'),id('R3')]},{...base,path:Array.from({length:7},(_,i)=>'node'+i)},{...base,kind:'op2p-failover',interface:g(2),peer:id('R3'),source:id('PC1'),metric:-1}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));assert.equal(matches(s,{...base,target:'missing'} as any),false);assert.equal(matches(s,{...base,path:[id('R1'),'missing']} as any),false);
});
