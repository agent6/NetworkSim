import {test} from 'node:test';import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';import {IOSSession} from '../src/cli.ts';import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,ENCOR_OSPF_FILTER_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';import {parseLabFile,serializeLabFile} from '../src/persistence.ts';import {ospfLiveDetail} from '../src/ospf-packets.ts';
const slug='ospf-route-filtering',id=(n:string)=>'device-ofl-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n,names=['R1','R2','R3','R4'],list='AREA10-OUT';
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!,row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!,route=(s:Simulator,n:string,network='172.16.1.0',prefix=24)=>d(s,n).runtime.routes.find(r=>r.network===network&&r.prefix===prefix);
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(15000);return s;}
function cli(s:Simulator,n:string){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,...lines:string[]){run(cli(s,n),'conf t',...lines,'end');s.advance(15000);lessonProgress(s);}
function configure(s:Simulator,save=true){for(const[n,lines]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...lines.filter(l=>save||l!=='write memory'));s.advance(15000);}
function ping(s:Simulator,n:string,ip:string){const p=s.ping(id(n),ip,{count:3});s.advance(5000);lessonProgress(s);return p.received;}
function passed(s:Simulator){for(const[n,ip]of [['PC1','192.168.20.10'],['PC1','192.168.30.10'],['SRV1','172.16.0.10'],['PC2','172.16.0.10']])assert.equal(ping(s,n,ip),3);}
function blocked(s:Simulator){for(const[n,ip]of [['PC3','172.16.1.10'],['SRV1','172.16.1.10'],['PC2','192.168.30.10']])assert.equal(ping(s,n,ip),0);}
function finish(s:Simulator){for(const n of names)run(cli(s,n),'write memory');passed(s);blocked(s);assert.equal(lessonProgress(s)!.complete,20,JSON.stringify(lessonProgress(s)!.rows.filter(r=>!r.complete).map(r=>r.objective.id)));}
const database=(s:Simulator,n:string,network='172.16.1.0')=>cli(s,n).execute('show ip ospf database summary '+network).join('\n');
const unbind=(s:Simulator)=>change(s,'R2','router ospf 10','no area 10 filter-list prefix AREA10-OUT out');
const bind=(s:Simulator)=>change(s,'R2','router ospf 10','area 10 filter-list prefix AREA10-OUT out');

test('filter practice is an independent eight-node seven-link ENCOR Layer3 lab with twenty zero-credit tasks',()=>{
 const e=LAB_CATALOG.find(e=>e.id===slug)!;assert.equal(e.group,'CCNP ENCOR');assert.equal(e.section,'Layer 3');assert.equal(LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR'&&e.section==='Layer 3').length,8);const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='Changed';assert.equal(b.lab.devices[0].config.hostname,'R1');const s=load('practice');validateLesson((s.lab as CatalogLab).lesson);assert.equal(s.lab.devices.length,8);assert.equal(s.lab.links.length,7);assert.equal(s.lab.notes.length,4);assert.equal(lessonProgress(s)!.rows.length,20);assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.filter(r=>actionAvailable(s,r.objective)).length,7);assert.equal(ping(s,'PC1','192.168.30.10'),0);
});
test('four actual reference CLI configurations earn thirteen live goals and seven correlated traffic outcomes complete twenty',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,13);passed(s);assert.equal(lessonProgress(s)!.complete,17);blocked(s);assert.equal(lessonProgress(s)!.complete,20);
});
test('completed reference contains saved configuration and empty runtime without invented success or failure evidence',()=>{
 const doc=createCatalogLab(slug,'completed');for(const n of doc.lab.devices){assert.deepEqual(n.runtime.features,{});assert.deepEqual(JSON.parse(JSON.stringify(n.config)),n.startupConfig);}const s=load();assert.equal(lessonProgress(s)!.complete,13);for(const n of ['pc1-server','pc3-pc2','server-pc2','pc2-server'])assert.equal(row(s,n).complete,false);finish(s);
});
test('failed probes from before configuration cannot later earn filtering credit after routes and policy converge',()=>{
 const s=load('practice');assert.equal(ping(s,'PC3','172.16.1.10'),0);assert.equal(ping(s,'SRV1','172.16.1.10'),0);configure(s);assert.equal(lessonProgress(s)!.complete,13);for(const n of ['pc3-pc2','server-pc2','pc2-server'])assert.equal(row(s,n).complete,false);finish(s);
});
test('source-area out filtering preserves six Full adjacencies, both ABRs and detailed source O routes',()=>{
 const s=load();for(const[n,count]of [['R1',1],['R2',2],['R3',2],['R4',1]] as const)assert.equal(ospfLiveDetail(s,id(n),'ospf')!.neighbors.filter(n=>n.state==='FULL').length,count);assert.equal(route(s,'R2')!.protocol,'O');assert.equal(route(s,'R2')!.metric,15);assert.equal(route(s,'R2','172.16.0.0')!.metric,11);assert.equal(route(s,'R3'),undefined);assert.equal(route(s,'R4'),undefined);assert.equal(route(s,'R3','172.16.0.0')!.metric,21);assert.equal(route(s,'R4','172.16.0.0')!.metric,31);passed(s);
});
test('Type3 projection suppresses the denied LAN through both boundaries while the source Router-LSA still contains it',()=>{
 const s=load();for(const n of ['R2','R3','R4'])assert.doesNotMatch(database(s,n),/Link State ID: 172\.16\.1\.0/);assert.match(database(s,'R3','172.16.0.0'),/Advertising Router: 2\.2\.2\.2[\s\S]*Metric: 11\b/);assert.match(database(s,'R4','172.16.0.0'),/Advertising Router: 3\.3\.3\.3[\s\S]*Metric: 21\b/);assert.match(cli(s,'R1').execute('show ip ospf database router 1.1.1.1').join('\n'),/172\.16\.1\.0/);assert.match(cli(s,'R2').execute('show ip ospf').join('\n'),/Area-filter AREA10-OUT out/);
});
test('an unbound prefix list does not filter OSPF; removing the binding restores both remote /24 routes',()=>{
 const s=load();unbind(s);assert.equal(route(s,'R3')!.metric,25);assert.equal(route(s,'R4')!.metric,35);assert.match(database(s,'R4'),/Link State ID: 172\.16\.1\.0/);assert.equal(row(s,'filter-policy').complete,false);assert.equal(ping(s,'SRV1','172.16.1.10'),3);bind(s);finish(s);
});
test('destination Area20 in filtering is scoped to Area20 and does not remove R3s own Area0 route',()=>{
 const s=load();unbind(s);change(s,'R3','ip prefix-list AREA10-OUT seq 5 deny 172.16.1.0/24','ip prefix-list AREA10-OUT seq 10 permit 0.0.0.0/0 le 32','router ospf 10','area 20 filter-list prefix AREA10-OUT in');assert.equal(route(s,'R3')!.metric,25);assert.equal(route(s,'R4'),undefined);assert.match(database(s,'R3'),/Link State ID: 172\.16\.1\.0/);assert.doesNotMatch(database(s,'R4'),/Link State ID: 172\.16\.1\.0/);assert.match(cli(s,'R3').execute('show ip ospf').join('\n'),/Area-filter AREA10-OUT in/);assert.equal(ping(s,'PC3','172.16.1.10'),3);assert.equal(ping(s,'SRV1','172.16.1.10'),0);change(s,'R3','router ospf 10','no area 20 filter-list prefix AREA10-OUT in');bind(s);finish(s);
});
test('a wrong source area or wrong direction cannot supply the intended route suppression',()=>{
 const s=load();unbind(s);change(s,'R2','router ospf 10','area 0 filter-list prefix AREA10-OUT out');assert.ok(route(s,'R3'));assert.ok(route(s,'R4'));change(s,'R2','router ospf 10','no area 0 filter-list prefix AREA10-OUT out','area 10 filter-list prefix AREA10-OUT in');assert.ok(route(s,'R3'));change(s,'R2','router ospf 10','no area 10 filter-list prefix AREA10-OUT in');bind(s);finish(s);
});
test('removing the permit-all sequence invokes implicit deny for permitted LANs while neighbors remain Full',()=>{
 const s=load();change(s,'R2','no ip prefix-list AREA10-OUT seq 10');assert.equal(route(s,'R3','172.16.0.0'),undefined);assert.equal(route(s,'R4','172.16.0.0'),undefined);assert.equal(row(s,'full-neighbors').complete,true);assert.equal(row(s,'filter-policy').complete,false);assert.equal(ping(s,'PC1','192.168.30.10'),0);change(s,'R2','ip prefix-list AREA10-OUT seq 10 permit 0.0.0.0/0 le 32');finish(s);
});
test('missing or empty referenced prefix lists do not silently provide filtering protection',()=>{
 const s=load();change(s,'R2','no ip prefix-list AREA10-OUT');assert.ok(route(s,'R3'));assert.ok(route(s,'R4'));assert.equal(row(s,'filter-policy').complete,false);change(s,'R2','ip prefix-list AREA10-OUT seq 5 deny 172.16.1.0/24','ip prefix-list AREA10-OUT seq 10 permit 0.0.0.0/0 le 32');finish(s);
});
test('first matching sequence and exact prefix length determine which Type3 routes are filtered',()=>{
 const s=load();change(s,'R2','ip prefix-list AREA10-OUT seq 1 permit 172.16.1.0/24');assert.ok(route(s,'R3'));change(s,'R2','no ip prefix-list AREA10-OUT seq 1','ip prefix-list AREA10-OUT seq 5 deny 172.16.1.10/32');assert.ok(route(s,'R3'));change(s,'R2','ip prefix-list AREA10-OUT seq 5 deny 172.16.0.0/16 ge 24 le 24');assert.equal(route(s,'R3'),undefined);assert.equal(route(s,'R3','172.16.0.0'),undefined);change(s,'R2','ip prefix-list AREA10-OUT seq 5 deny 172.16.1.0/24');finish(s);
});
test('remote RIB and LSDB views change only after delivered prefix-list policy snapshots, not fresh global configuration',()=>{
 const s=load(),send=s.sendControlDatagram.bind(s);s.sendControlDatagram=(node,src,dst,port,body,options)=>{if(port!==89)send(node,src,dst,port,body,options);};run(cli(s,'R2'),'conf t','ip prefix-list AREA10-OUT seq 5 permit 172.16.1.0/24','end');s.advance(1000);assert.equal(route(s,'R3'),undefined);assert.equal(route(s,'R4'),undefined);assert.doesNotMatch(database(s,'R4'),/Link State ID: 172\.16\.1\.0/);s.sendControlDatagram=send;s.advance(15000);assert.ok(route(s,'R3'));assert.ok(route(s,'R4'));assert.match(database(s,'R4'),/Link State ID: 172\.16\.1\.0/);change(s,'R2','ip prefix-list AREA10-OUT seq 5 deny 172.16.1.0/24');finish(s);
});
test('policy edits and binding removal do not reset established Full neighbor uptime',()=>{
 const s=load(),before=names.map(n=>ospfLiveDetail(s,id(n),'ospf')!.neighbors.map(n=>n.upSince));unbind(s);bind(s);assert.deepEqual(names.map(n=>ospfLiveDetail(s,id(n),'ospf')!.neighbors.map(n=>n.upSince)),before);finish(s);
});
test('dropping real protocol89 traffic prevents Full, received-filter and failed-packet credit despite correct configuration',()=>{
 const s=new Simulator(),send=s.sendControlDatagram.bind(s);let block=true;s.sendControlDatagram=(node,src,dst,port,body,options)=>{if(block&&port===89)return;send(node,src,dst,port,body,options);};s.load(createCatalogLab(slug,'completed'));s.advance(15000);blocked(s);for(const n of ['full-neighbors','filtered-routes','pc3-pc2','server-pc2','pc2-server'])assert.equal(row(s,n).complete,false);block=false;s.advance(15000);finish(s);
});
test('request-direction failure requires actual source send, no-route drop, quoted error and matching packet identity',()=>{
 const s=load();blocked(s);const c=(row(s,'server-pc2').objective.criterion as any).criteria[0],events=structuredClone(s.events);assert.equal(matches(s,c),true);for(const label of ['Frame sent','Frame received','No route','ICMP error received']){s.events.splice(0,s.events.length,...structuredClone(events).filter(e=>e.label!==label));assert.equal(matches(s,c),false,label);}s.events.splice(0,s.events.length,...structuredClone(events));for(const e of s.events)if(e.label==='ICMP error received'&&e.packet)e.packet.parentId='wrong';assert.equal(matches(s,c),false);
});
test('the return-path failure proves an accepted request and its real parent-linked reply dropping for no route',()=>{
 const s=load();assert.equal(ping(s,'PC2','192.168.30.10'),0);const c=(row(s,'pc2-server').objective.criterion as any).criteria[0],events=structuredClone(s.events);assert.equal(matches(s,c),true);assert.ok(events.some(e=>e.nodeId===id('SRV1')&&e.label==='Echo request accepted'));assert.ok(events.some(e=>e.nodeId===id('R4')&&e.label==='No route'&&e.packet?.messageType==='echo-reply'));for(const drop of [(e:any)=>e.nodeId===id('SRV1')&&e.label==='Echo request accepted',(e:any)=>e.nodeId===id('R2')&&e.label==='Frame sent'&&e.packet?.messageType==='echo-request']){s.events.splice(0,s.events.length,...structuredClone(events).filter(e=>!drop(e)));assert.equal(matches(s,c),false);}s.events.splice(0,s.events.length,...events);for(const e of s.events)if(e.label==='No route'&&e.packet?.messageType==='echo-reply')e.packet.parentId='wrong';assert.equal(matches(s,c),false);
});
test('wrong ICMP quoted addresses cannot fabricate a filtered request observation',()=>{
 const s=load();ping(s,'PC3','172.16.1.10');const c=(row(s,'pc3-pc2').objective.criterion as any).criteria[0];assert.equal(matches(s,c),true);for(const e of s.events)if(e.label==='ICMP error received'&&e.packet?.icmpQuoted)e.packet.icmpQuoted.destination='172.16.1.99';assert.equal(matches(s,c),false);
});
test('a disconnected transit is not a valid substitute for observed route filtering',()=>{
 const s=load();change(s,'R3','interface g0/2','shutdown');assert.equal(ping(s,'SRV1','172.16.1.10'),0);assert.equal(row(s,'server-pc2').complete,false);assert.equal(row(s,'full-neighbors').complete,false);change(s,'R3','interface g0/2','no shutdown');finish(s);
});
test('static or default route workarounds cannot satisfy normal-domain and filtered-route evidence',()=>{
 const s=load();change(s,'R4','ip route 172.16.1.0 255.255.255.0 10.0.34.1');assert.equal(row(s,'interface-policy').complete,false);assert.equal(row(s,'filtered-routes').complete,false);assert.equal(ping(s,'SRV1','172.16.1.10'),0);assert.equal(row(s,'server-pc2').complete,false);change(s,'R4','no ip route 172.16.1.0 255.255.255.0 10.0.34.1');finish(s);
});
test('area-range interaction exports the aggregate if any source component is permitted and withdraws it when all deny',()=>{
 const s=load();change(s,'R2','router ospf 10','area 10 range 172.16.0.0 255.255.252.0');assert.equal(route(s,'R3','172.16.0.0',22)!.metric,25);assert.match(database(s,'R3','172.16.0.0'),/Network Mask: \/22/);assert.equal(ping(s,'PC3','172.16.1.10'),3);assert.equal(row(s,'filtered-routes').complete,false);change(s,'R2','ip prefix-list AREA10-OUT seq 5 deny 172.16.0.0/16 ge 24 le 24');assert.equal(route(s,'R3','172.16.0.0',22),undefined);assert.doesNotMatch(database(s,'R3','172.16.0.0'),/Link State ID: 172\.16\.0\.0/);change(s,'R2','ip prefix-list AREA10-OUT seq 5 deny 172.16.1.0/24','router ospf 10','no area 10 range 172.16.0.0 255.255.252.0');finish(s);
});
test('an inbound filter evaluates the advertised aggregate prefix rather than hidden component lengths',()=>{
 const s=load();unbind(s);change(s,'R2','router ospf 10','area 10 range 172.16.0.0 255.255.252.0','area 0 filter-list prefix AREA10-OUT in');assert.ok(route(s,'R3','172.16.0.0',22));change(s,'R2','ip prefix-list AREA10-OUT seq 1 deny 172.16.0.0/22');assert.equal(route(s,'R3','172.16.0.0',22),undefined);assert.doesNotMatch(database(s,'R3','172.16.0.0'),/Link State ID: 172\.16\.0\.0/);change(s,'R2','no ip prefix-list AREA10-OUT seq 1','router ospf 10','no area 0 filter-list prefix AREA10-OUT in','no area 10 range 172.16.0.0 255.255.252.0');bind(s);finish(s);
});
test('Type5 external advertisements are not filtered by an ABR Type3 prefix filter',()=>{
 const s=load();change(s,'R2','ip prefix-list AREA10-OUT seq 1 deny 192.0.2.0/24');change(s,'R1','ip route 192.0.2.0 255.255.255.0 Null0','router ospf 10','redistribute static subnets');for(const n of ['R3','R4'])assert.equal(route(s,n,'192.0.2.0')!.protocol,'O E2');
});
test('question mark, Tab, incomplete and no forms expose operational IOS area-filter syntax',()=>{
 const s=load(),c=cli(s,'R2');run(c,'conf t','router ospf 10');assert.match(c.help('area 10 ').join('\n'),/filter-list/);assert.equal(c.complete('area 10 filt'),'area 10 filter-list ');assert.match(c.help('area 10 filter-list ').join('\n'),/prefix/);assert.match(c.help('area 10 filter-list prefix AREA10-OUT ').join('\n'),/in[\s\S]*out/);assert.equal(c.complete('area 10 filter-list prefix AREA10-OUT o'),'area 10 filter-list prefix AREA10-OUT out ');assert.ok(c.execute('area 10 filter-list prefix AREA10-OUT').some(iosRejected));assert.ok(c.execute('area 10 filter-list prefix AREA10-OUT bogus').some(iosRejected));run(c,'area 10 filter-list prefix AREA10-OUT in','no area 10 filter-list prefix AREA10-OUT out');assert.equal(d(s,'R2').config.protocols.ospf.areas['10'].filterIn,list);assert.equal(d(s,'R2').config.protocols.ospf.areas['10'].filterOut,undefined);run(c,'no area 10 filter-list prefix AREA10-OUT in','area 0.0.0.10 filter-list prefix AREA10-OUT out','end');s.advance(15000);assert.equal(route(s,'R4'),undefined);
});
test('referenced prefix-list content is part of the startup-save contract, not just the area binding',()=>{
 const s=load(),criterion={kind:'mao-saved',device:id('R2'),interfaces:[g(1),g(2)]} as const;assert.equal(matches(s,criterion as any),true);change(s,'R2','ip prefix-list AREA10-OUT seq 10 deny 0.0.0.0/0 le 32');assert.equal(matches(s,criterion as any),false);run(cli(s,'R2'),'write memory');assert.equal(matches(s,criterion as any),true);change(s,'R2','ip prefix-list AREA10-OUT seq 10 permit 0.0.0.0/0 le 32');finish(s);
});
test('IOS reload and portable reopen restore filter/list state and rebuild received evidence while retaining traffic history',()=>{
 const s=load();finish(s);unbind(s);s.reloadIOS(id('R2'));s.advance(30000);assert.equal(route(s,'R4'),undefined);assert.equal(lessonProgress(s)!.complete,20);d(s,'R2').config.hostname='Export ABR';const f=new Simulator();f.load(parseLabFile(serializeLabFile(s.serialize())));assert.equal(row(f,'full-neighbors').complete,false);assert.equal(row(f,'filtered-routes').complete,false);assert.equal(row(f,'server-pc2').complete,false);f.advance(15000);assert.equal(lessonProgress(f)!.complete,20);finish(f);
});
test('all published IOS and Windows verification commands show intended routes, LSA presence/absence and ping outcomes',()=>{
 const s=load(),res=catalogGuideResources(slug)!;assert.equal(res.rows.length,7);for(const r of res.rows)assert.equal(r.length,res.columns.length);for(const[n,lines]of Object.entries(res.verification))for(const line of lines){const out=cli(s,n).execute(line).join('\n');assert.doesNotMatch(out,/% (?:Invalid|Incomplete|Ambiguous)|not implemented|not recognized/);if(line.startsWith('ping'))assert.match(out,n==='PC2'&&line.endsWith('192.168.30.10')||['PC3','SRV1'].includes(n)&&line.endsWith('172.16.1.10')?/Received = 0/:/Received = 3/);if(line.startsWith('tracert'))assert.match(out,/Trace complete/);}finish(s);
});
test('malformed imported area references and bounded lesson policies fail transactionally or closed',()=>{
 const doc=createCatalogLab(slug,'completed');for(const value of [[],{},'',42,'bad\ncommand','x'.repeat(129)]){const bad=structuredClone(doc);bad.lab.devices.find(d=>d.id===id('R2'))!.config.protocols.ospf.areas['10'].filterOut=value;assert.throws(()=>parseLabFile(JSON.stringify(bad)));}const s=load(),lesson=(s.lab as CatalogLab).lesson!,policy={kind:'ofl-remote',device:id('R3'),abr:id('R2'),list,area:10,allowedNetwork:'172.16.0.0',deniedNetwork:'172.16.1.0',prefix:24};for(const criterion of [{...policy,prefix:33},{...policy,area:-1},{...policy,abr:id('R3')},{...policy,deniedNetwork:'172.16.1.1'},{...policy,kind:'ofl-policy',routers:[]},{...policy,kind:'ofl-drop',target:id('PC2'),at:id('R3'),path:[id('R3'),id('R3')],mode:'request'}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'bad',title:'Bad',criterion}]}));assert.equal(matches(s,{...policy,abr:'missing'} as any),false);
});
