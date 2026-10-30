import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,ENCOR_OSPF_SUMMARY_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const slug='ospf-route-summarization',id=(n:string)=>'device-osum-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n,names=['R1','R2','R3'];
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!,row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!,route=(s:Simulator,n:string,net='172.16.0.0',prefix=22)=>d(s,n).runtime.routes.find(r=>r.network===net&&r.prefix===prefix);
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(15000);return s;}
function cli(s:Simulator,n:string){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,...lines:string[]){run(cli(s,n),'conf t',...lines,'end');s.advance(15000);lessonProgress(s);}
function configure(s:Simulator,save=true){for(const[n,lines]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...lines.filter(l=>save||l!=='write memory'));s.advance(15000);}
function ping(s:Simulator,n:string,ip:string){const p=s.ping(id(n),ip,{count:3});s.advance(5000);lessonProgress(s);return p.received;}
function pairs(s:Simulator){for(const[n,ip]of [['PC1','192.168.30.10'],['PC2','192.168.30.10'],['SRV1','172.16.0.10'],['SRV1','172.16.1.10']])assert.equal(ping(s,n,ip),3);}
const summary=(s:Simulator)=>cli(s,'R3').execute('show ip ospf database summary 172.16.0.0 adv-router 2.2.2.2').join('\n');
const range=(s:Simulator,options='')=>change(s,'R2','router ospf 10','area 10 range 172.16.0.0 255.255.252.0'+options);
function finish(s:Simulator){for(const n of names)run(cli(s,n),'write memory');pairs(s);assert.ok([16,17].includes(lessonProgress(s)!.complete),JSON.stringify(lessonProgress(s)!.rows.filter(r=>!r.complete).map(r=>r.objective.id)));assert.equal(ping(s,'SRV1','172.16.2.10'),0);assert.equal(lessonProgress(s)!.complete,17);}

test('summary practice is an independent six-node five-link zero-credit ENCOR Layer3 lab with seventeen tasks',()=>{
 const entry=LAB_CATALOG.find(e=>e.id===slug)!;assert.equal(entry.group,'CCNP ENCOR');assert.equal(entry.section,'Layer 3');assert.equal(LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR'&&e.section==='Layer 3').length,6);const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');assert.equal((createCatalogLab('ospf-passive-interface').lab as CatalogLab).catalogId,'ospf-passive-interface');const s=load('practice');validateLesson((s.lab as CatalogLab).lesson);assert.equal(s.lab.devices.length,6);assert.equal(s.lab.links.length,5);assert.equal(s.lab.notes.length,1);assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,17);assert.equal(lessonProgress(s)!.rows.filter(r=>actionAvailable(s,r.objective)).length,5);for(const n of names){assert.deepEqual(d(s,n).config.protocols,{});assert.deepEqual(d(s,n).config.staticRoutes,[]);}assert.equal(ping(s,'PC1','192.168.30.10'),0);
});
test('published real IOS commands earn twelve live tasks, four traffic proofs sixteen and actual Null0 failure seventeen',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,12);for(const n of names)assert.deepEqual(JSON.parse(JSON.stringify(d(s,n).config)),d(s,n).startupConfig);pairs(s);assert.equal(lessonProgress(s)!.complete,16);finish(s);
});
test('completed reference serializes saved configuration and empty runtime without invented packet/discard accomplishments',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(JSON.parse(JSON.stringify(node.config)),node.startupConfig);}const s=load();assert.equal(lessonProgress(s)!.complete,12);for(const n of ['pc1-server','pc2-server','server-pc1','server-pc2','summary-hole'])assert.equal(row(s,n).complete,false);finish(s);
});
test('unsummarized baseline learns both component /24s remotely and has no conditional discard',()=>{
 const s=load();change(s,'R2','router ospf 10','no area 10 range 172.16.0.0 255.255.252.0');assert.equal(route(s,'R3'),undefined);assert.equal(route(s,'R2'),undefined);for(const[net,metric]of [['172.16.0.0',21],['172.16.1.0',25]] as const){const r=route(s,'R3',net,24)!;assert.equal(r.protocol,'O IA');assert.equal(r.metric,metric);}assert.equal(row(s,'summary-policy').complete,false);assert.equal(row(s,'aggregate-route').complete,false);pairs(s);range(s);finish(s);
});
test('ABR preserves specific intra-area routes while R3 installs only the maximum-cost aggregate with the exact next hop',()=>{
 const s=load();for(const[net,metric]of [['172.16.0.0',11],['172.16.1.0',15]] as const){const r=route(s,'R2',net,24)!;assert.equal(r.protocol,'O');assert.equal(r.ad,110);assert.equal(r.metric,metric);assert.equal(r.nextHop,'10.0.12.1');}const r=route(s,'R3')!;assert.equal(r.protocol,'O IA');assert.equal(r.metric,25);assert.equal(r.ad,110);assert.equal(r.nextHop,'10.0.23.1');assert.equal(r.interface,g(1));assert.equal(d(s,'R3').runtime.routes.some(r=>r.prefix===24&&r.network.startsWith('172.16.')),false);assert.equal(s.cefLookup(id('R2'),'172.16.0.10')!.route.prefix,24);assert.equal(s.cefLookup(id('R2'),'172.16.1.10')!.route.prefix,24);pairs(s);
});
test('Type3 summary and show ip ospf Active metric report maximum fifteen rather than the first component eleven or one',()=>{
 const s=load(),out=summary(s);assert.match(out,/Summary Net Link States \(Area 0\)/);assert.match(out,/Advertising Router: 2\.2\.2\.2/);assert.match(out,/Network Mask: \/22/);assert.match(out,/Metric: 15\b/);assert.doesNotMatch(out,/Metric: 11\b/);assert.match(cli(s,'R2').execute('show ip ospf').join('\n'),/172\.16\.0\.0\/22 Active\(15\) Advertise/);
});
test('summary metric and output remain independent of component interface enumeration order',()=>{
 const doc=createCatalogLab(slug,'completed'),r=doc.lab.devices.find(d=>d.id===id('R1'))!;r.config.interfaces=Object.fromEntries(Object.entries(r.config.interfaces).reverse());const s=new Simulator();s.load(doc);s.advance(15000);assert.equal(route(s,'R3')!.metric,25);assert.match(summary(s),/Metric: 15\b/);
});
test('changing ABR policy without delivering a new router record cannot change the remote summary display or route',()=>{
 const s=load(),send=s.sendControlDatagram.bind(s);s.sendControlDatagram=(node,src,dest,port,body,options)=>{if(port!==89)send(node,src,dest,port,body,options);};run(cli(s,'R2'),'conf t','router ospf 10','area 10 range 172.16.0.0 255.255.252.0 cost 40','end');s.advance(1000);assert.equal(route(s,'R3')!.metric,25);assert.match(summary(s),/Metric: 15\b/);assert.doesNotMatch(summary(s),/Metric: 40\b/);s.sendControlDatagram=send;s.advance(15000);assert.equal(route(s,'R3')!.metric,50);assert.match(summary(s),/Metric: 40\b/);range(s);finish(s);
});
test('summary requires delivered OSPF control records, Full neighbors and a real backbone-connected ABR',()=>{
 const s=new Simulator(),send=s.sendControlDatagram.bind(s);let block=true;s.sendControlDatagram=(node,src,dest,port,body,options)=>{if(block&&port===89)return;send(node,src,dest,port,body,options);};s.load(createCatalogLab(slug,'completed'));s.advance(15000);for(const n of ['full-neighbors','backbone-abr','aggregate-route','saved'])assert.equal(row(s,n).complete,false);assert.equal(ping(s,'SRV1','172.16.2.10'),0);assert.equal(row(s,'summary-hole').complete,false);block=false;s.advance(15000);finish(s);
});
test('range belongs on the ABR and source Area10, not internal R1 or the outgoing Area0',()=>{
 const s=load();change(s,'R2','router ospf 10','no area 10 range 172.16.0.0 255.255.252.0');change(s,'R1','router ospf 10','area 10 range 172.16.0.0 255.255.252.0');assert.equal(route(s,'R3'),undefined);assert.equal(row(s,'summary-policy').complete,false);change(s,'R1','router ospf 10','no area 10 range 172.16.0.0 255.255.252.0');change(s,'R2','router ospf 10','area 0 range 172.16.0.0 255.255.252.0');assert.equal(route(s,'R3'),undefined);change(s,'R2','router ospf 10','no area 0 range 172.16.0.0 255.255.252.0');range(s);finish(s);
});
test('a smaller /23 can carry valid traffic but cannot replace the intended /22 and hole-discard exercise',()=>{
 const s=load();change(s,'R2','router ospf 10','no area 10 range 172.16.0.0 255.255.252.0','area 10 range 172.16.0.0 255.255.254.0');assert.equal(route(s,'R3'),undefined);assert.equal(route(s,'R3','172.16.0.0',23)!.metric,25);pairs(s);assert.equal(row(s,'aggregate-route').complete,false);assert.equal(ping(s,'SRV1','172.16.2.10'),0);assert.equal(row(s,'summary-hole').complete,false);change(s,'R2','router ospf 10','no area 10 range 172.16.0.0 255.255.254.0');range(s);finish(s);
});
test('explicit range cost changes both Type3 metric and remote route while live default-cost grading rejects it',()=>{
 const s=load();range(s,' cost 40');assert.equal(route(s,'R3')!.metric,50);assert.match(summary(s),/Metric: 40\b/);assert.match(cli(s,'R2').execute('show ip ospf').join('\n'),/Active\(40\)/);assert.equal(row(s,'summary-policy').complete,false);assert.equal(row(s,'aggregate-route').complete,false);pairs(s);range(s);assert.equal(route(s,'R3')!.metric,25);finish(s);
});
test('not-advertise hides both aggregate and components remotely without deleting internal component routes',()=>{
 const s=load();range(s,' not-advertise');assert.equal(route(s,'R3'),undefined);assert.equal(route(s,'R3','172.16.0.0',24),undefined);assert.equal(route(s,'R3','172.16.1.0',24),undefined);assert.ok(route(s,'R2','172.16.0.0',24));assert.ok(route(s,'R2','172.16.1.0',24));assert.doesNotMatch(summary(s),/Link State ID: 172\.16\.0\.0/);assert.match(cli(s,'R2').execute('show ip ospf').join('\n'),/Active\(15\) DoNotAdvertise/);assert.equal(ping(s,'SRV1','172.16.0.10'),0);range(s);finish(s);
});
test('withdrawing the highest-cost component retains the aggregate and changes its dynamic metric to the remaining component',()=>{
 const s=load();change(s,'R1','interface g0/2','no ip ospf 10 area 10');assert.equal(route(s,'R3')!.metric,21);assert.match(summary(s),/Metric: 11\b/);assert.ok(route(s,'R2'));assert.equal(route(s,'R2','172.16.1.0',24),undefined);assert.equal(row(s,'full-neighbors').complete,true);assert.equal(ping(s,'SRV1','172.16.0.10'),3);assert.equal(ping(s,'SRV1','172.16.1.10'),0);change(s,'R1','interface g0/2','ip ospf 10 area 10');finish(s);
});
test('withdrawing every component removes the conditional aggregate and Null0 route without shutting transit neighbors',()=>{
 const s=load();change(s,'R1','interface g0/0','no ip ospf 10 area 10','interface g0/2','no ip ospf 10 area 10');assert.equal(route(s,'R3'),undefined);assert.equal(route(s,'R2'),undefined);assert.equal(row(s,'full-neighbors').complete,true);assert.doesNotMatch(summary(s),/Link State ID: 172\.16\.0\.0/);assert.match(cli(s,'R2').execute('show ip ospf').join('\n'),/172\.16\.0\.0\/22 Passive Advertise/);assert.equal(ping(s,'SRV1','172.16.2.10'),0);assert.equal(row(s,'summary-hole').complete,false);change(s,'R1','interface g0/0','ip ospf 10 area 10','interface g0/2','ip ospf 10 area 10');finish(s);
});
test('Null0 proof requires actual source send, edge forwarding, ABR drop and a parent-linked ICMP error',()=>{
 const s=load();pairs(s);assert.equal(row(s,'summary-hole').complete,false);assert.equal(ping(s,'SRV1','172.16.2.10'),0);assert.equal(row(s,'summary-hole').complete,true);const c=(row(s,'summary-hole').objective.criterion as any).criteria[0],events=structuredClone(s.events);for(const label of ['Frame sent','Frame received','Null route','ICMP error received']){s.events.splice(0,s.events.length,...structuredClone(events).filter(e=>e.label!==label));assert.equal(matches(s,c),false,label);}s.events.splice(0,s.events.length,...events);assert.equal(matches(s,c),true);for(const e of s.events)if(e.label==='ICMP error received'&&e.packet)e.packet.parentId='wrong';assert.equal(matches(s,c),false);
});
test('wrong quoted destination or packet source cannot fabricate safe-discard evidence',()=>{
 const s=load();ping(s,'SRV1','172.16.2.10');const c=(row(s,'summary-hole').objective.criterion as any).criteria[0],events=structuredClone(s.events);for(const e of s.events)if(e.label==='ICMP error received'&&e.packet?.icmpQuoted)e.packet.icmpQuoted.destination='172.16.2.99';assert.equal(matches(s,c),false);s.events.splice(0,s.events.length,...events);for(const e of s.events)if(e.label==='Null route'&&e.packet)e.packet.source='192.168.30.99';assert.equal(matches(s,c),false);
});
test('an actual Null0 discard does not bounce the original request back toward the backbone',()=>{
 const s=load();ping(s,'SRV1','172.16.2.10');for(const drop of s.events.filter(e=>e.label==='Null route'&&e.nodeId===id('R2')))assert.equal(s.events.some(e=>e.nodeId===id('R2')&&e.label==='Frame sent'&&e.packet?.id===drop.packet?.id),false);pairs(s);
});
test('disabling the internal discard prevents safe-discard completion until restored',()=>{
 const s=load();change(s,'R2','router ospf 10','no discard-route internal');assert.equal(route(s,'R2'),undefined);assert.equal(ping(s,'SRV1','172.16.2.10'),0);assert.equal(row(s,'summary-hole').complete,false);assert.equal(row(s,'summary-discard').complete,false);change(s,'R2','router ospf 10','discard-route internal');finish(s);
});
test('static shortcuts cannot replace the aggregate protocol, normal domain or packet path requirements',()=>{
 const s=load();change(s,'R3','ip route 172.16.0.0 255.255.252.0 10.0.23.1');pairs(s);assert.equal(row(s,'summary-policy').complete,false);assert.equal(row(s,'aggregate-route').complete,false);assert.equal(matches(s,row(s,'server-pc1').objective.criterion),false);change(s,'R3','no ip route 172.16.0.0 255.255.252.0 10.0.23.1');finish(s);
});
test('summary-range persistence requires write memory and IOS reload restores an unsaved explicit-cost fault',()=>{
 const s=load('practice');configure(s,false);assert.equal(row(s,'saved').complete,false);for(const n of names)run(cli(s,n),'write memory');assert.equal(row(s,'saved').complete,true);range(s,' cost 40');assert.equal(row(s,'saved').complete,false);s.reloadIOS(id('R2'));s.advance(30000);assert.equal(route(s,'R3')!.metric,25);assert.equal(row(s,'saved').complete,true);finish(s);
});
test('portable reopen retains actual traffic/discard observations and rebuilds live summaries after a stable-ID rename',()=>{
 const s=load();finish(s);d(s,'R2').config.hostname='Core ABR';const f=new Simulator();f.load(parseLabFile(serializeLabFile(s.serialize())));assert.equal(row(f,'full-neighbors').complete,false);assert.equal(row(f,'aggregate-route').complete,false);assert.equal(row(f,'summary-hole').complete,false);assert.equal(row(f,'server-pc2').complete,true);f.advance(15000);assert.equal(lessonProgress(f)!.complete,17);finish(f);
});
test('all published verification commands work and the deliberate hole ping is the only expected ping failure',()=>{
 const s=load(),res=catalogGuideResources(slug)!;assert.equal(res.rows.length,6);for(const r of res.rows)assert.equal(r.length,res.columns.length);for(const[n,lines]of Object.entries(res.verification))for(const line of lines){const out=cli(s,n).execute(line).join('\n');assert.doesNotMatch(out,/% (?:Invalid|Incomplete|Ambiguous)|not implemented|not recognized/);if(line.startsWith('ping'))assert.match(out,line.endsWith('172.16.2.10')?/Received = 0/:/Received = 3/);if(line.startsWith('tracert')){assert.match(out,/Trace complete/);assert.ok(out.includes('10.0.12.2'));assert.ok(out.includes('10.0.23.2'));}}pairs(s);
});
test('imported summary criteria reject malformed ranges, areas and identities and missing nodes fail closed',()=>{
 const s=load(),lesson=(s.lab as CatalogLab).lesson!,domain={kind:'osum-domain',device:id('R2'),areas:[10,0],active:[g(1),g(2)]},summary={kind:'osum-summary',device:id('R3'),abr:id('R2'),network:'172.16.0.0',prefix:22,metric:25,nextHop:'10.0.23.1',interface:g(1)};for(const criterion of [{...domain,areas:[10,10]},{...domain,active:[]},{...domain,range:{area:20,network:'172.16.0.0',prefix:22}},{...domain,range:{area:10,network:'172.16.1.0',prefix:22}},{...summary,metric:-1},{...summary,abr:id('R3')},{...summary,prefix:33},{kind:'osum-hole',device:id('SRV1'),abr:id('R2'),edge:id('R3'),network:'172.16.0.0',prefix:22,address:'172.17.2.10'}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));assert.equal(matches(s,{...summary,abr:'missing'} as any),false);assert.equal(matches(s,{...domain,device:'missing'} as any),false);
});
