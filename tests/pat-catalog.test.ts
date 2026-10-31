import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,PAT_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {basicAuthorization} from '../src/http-service.ts';
const catalog='pat',id=(name:string)=>'device-pat-'+name.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
const rule='ip nat inside source list PAT-INSIDE interface GigabitEthernet0/1 overload';
function load(mode:'practice'|'completed'='completed'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(1000);return sim;}
function cli(sim:Simulator,name='R1'){const c=new IOSSession(sim,id(name));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}}
function change(sim:Simulator,...lines:string[]){const c=cli(sim);run(c,'configure terminal',...lines,'end');return c;}
const goal=(sim:Simulator,goal:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===goal)!.complete;
const criterion=(sim:Simulator,goal:string):Criterion=>lessonProgress(sim)!.rows.find(r=>r.objective.id===goal)!.objective.criterion;
function ping(sim:Simulator,name:string){const r=sim.ping(id(name),'198.51.100.10',{count:3});sim.advance(5000);return r.received;}
function web(sim:Simulator,name:string,path='/'){const r=sim.httpRequest(id(name),'http://198.51.100.10'+path);sim.advance(12000);return r;}
function traffic(sim:Simulator){for(const name of ['PC1','PC2'])assert.equal(ping(sim,name),3);for(const name of ['PC1','PC2'])assert.equal(web(sim,name).statusCode,200);assert.equal(lessonProgress(sim)!.complete,10);}
function restrict(sim:Simulator){run(cli(sim),'clear ip nat translation *');change(sim,'ip access-list standard PAT-INSIDE','no permit 192.168.10.0 0.0.0.255','permit host 192.168.10.10');}
function restoreACL(sim:Simulator){run(cli(sim),'clear ip nat translation *');change(sim,'ip access-list standard PAT-INSIDE','no permit host 192.168.10.10','permit 192.168.10.0 0.0.0.255');}

test('PAT is an independent ten-task CCNA Services & Security lab with six nodes, five links and a seven-row plan',()=>{
 const entry=LAB_CATALOG.find(l=>l.id===catalog)!;assert.equal(entry.group,'CCNA');assert.equal(entry.section,'Services & Security');assert.equal(entry.devices,6);assert.equal(entry.links,5);const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);validateLesson((a.lab as any).lesson);const sim=load('practice');assert.equal(lessonProgress(sim)!.complete,0);assert.equal(lessonProgress(sim)!.rows.length,10);assert.equal(catalogGuideResources(catalog)!.rows.length,7);for(const d of sim.lab.devices)assert.deepEqual(d.startupConfig,d.config);assert.ok(!sim.getDevice(id('ISP1'))!.runtime.routes.some(r=>r.network==='192.168.10.0'));
});
test('published reference commands earn five configuration goals and do not preload translations or packet achievements',()=>{
 const sim=load('practice');run(new IOSSession(sim,id('R1')),...COMMANDS.R1);assert.equal(lessonProgress(sim)!.complete,5);const reference=load();assert.equal(lessonProgress(reference)!.complete,5);assert.equal(reference.getDevice(id('R1'))!.runtime.features.natTranslations,undefined);assert.doesNotMatch(cli(reference).execute('show ip nat translations').join('\n'),/(?:icmp|tcp|---)\s+203/);assert.deepEqual(reference.getDevice(id('R1'))!.config.features.nat.static,[]);
});
test('both real ICMP sessions share one global address with unique translated identifiers and successful returns',()=>{
 const sim=load();assert.equal(ping(sim,'PC1'),3);assert.equal(lessonProgress(sim)!.complete,6);assert.equal(goal(sim,'shared-address'),false);assert.equal(ping(sim,'PC2'),3);assert.equal(lessonProgress(sim)!.complete,8);assert.equal(goal(sim,'shared-address'),true);const rows=sim.getDevice(id('R1'))!.runtime.features.natTranslations.filter((r:any)=>r.protocol==='icmp');assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map((r:any)=>r.inside)),new Set(['192.168.10.10','192.168.10.20']));assert.ok(rows.every((r:any)=>r.outside==='203.0.113.1'));assert.equal(new Set(rows.map((r:any)=>r.outsidePort)).size,2);for(const name of ['PC1','PC2'])assert.ok(sim.events.some(e=>e.nodeId===id(name)&&e.label==='Echo reply received'&&e.packet?.source==='198.51.100.10'));
});
test('simultaneous HTTP requests with the same local source port receive independent PAT ports and complete for both clients',()=>{
 const sim=load(),requests=['PC1','PC2'].map(n=>sim.httpRequest(id(n),'http://198.51.100.10/',{sourcePort:44000}));sim.advance(2000);assert.ok(requests.every(r=>r.status==='success'&&r.statusCode===200&&r.body.includes('PAT: outside server reached')));const rows=sim.getDevice(id('R1'))!.runtime.features.natTranslations.filter((r:any)=>r.protocol==='tcp');assert.equal(rows.length,2);assert.ok(rows.every((r:any)=>r.insidePort===44000&&r.outside==='203.0.113.1'));assert.equal(new Set(rows.map((r:any)=>r.outsidePort)).size,2);assert.equal(goal(sim,'pc1-http'),true);assert.equal(goal(sim,'pc2-http'),true);assert.equal(goal(sim,'shared-address'),false);
});
test('one PC, a router-originated ping, NAT counters or a table row alone cannot fabricate the second host’s achievements',()=>{
 const sim=load();assert.equal(ping(sim,'R1'),3);assert.equal(goal(sim,'pc1-icmp'),false);assert.equal(goal(sim,'shared-address'),false);ping(sim,'PC1');web(sim,'PC1');assert.equal(goal(sim,'pc2-icmp'),false);assert.equal(goal(sim,'pc2-http'),false);assert.equal(goal(sim,'shared-address'),false);sim.getDevice(id('R1'))!.runtime.features.natStats.hits=99999;assert.equal(matches(sim,criterion(sim,'shared-address')),false);
});
test('the source ACL is precise and an excluded second PC fails while the permitted first PC continues to work',()=>{
 const sim=load();restrict(sim);assert.equal(goal(sim,'source-acl'),false);assert.equal(goal(sim,'overload-rule'),true);assert.equal(ping(sim,'PC1'),3);assert.equal(ping(sim,'PC2'),0);assert.equal(web(sim,'PC1').statusCode,200);assert.equal(web(sim,'PC2').status,'failure');assert.equal(goal(sim,'pc2-http'),false);assert.equal(goal(sim,'shared-address'),false);restoreACL(sim);traffic(sim);
});
test('a missing ACL or wrong overload interface is a live fault and cannot earn the intended configuration or traffic',()=>{
 const sim=load();change(sim,'no ip access-list standard PAT-INSIDE');assert.equal(goal(sim,'source-acl'),false);assert.equal(ping(sim,'PC1'),0);change(sim,'ip access-list standard PAT-INSIDE','permit 192.168.10.0 0.0.0.255','exit','no '+rule,'ip nat inside source list PAT-INSIDE interface GigabitEthernet0/0 overload');assert.equal(goal(sim,'overload-rule'),false);assert.equal(ping(sim,'PC1'),0);run(cli(sim),'clear ip nat translation *');change(sim,'no ip nat inside source list PAT-INSIDE interface GigabitEthernet0/0 overload',rule);traffic(sim);
});
test('both NAT roles, the overload rule and the upstream route are necessary for the working client sessions',()=>{
 for(const command of ['interface '+g(0)+'|no ip nat inside','interface '+g(1)+'|no ip nat outside','no '+rule,'no ip route 0.0.0.0 0.0.0.0 203.0.113.2']){const sim=load();change(sim,...command.split('|'));assert.equal(ping(sim,'PC1'),0);assert.equal(ping(sim,'PC2'),0);assert.equal(web(sim,'PC1').status,'failure');assert.equal(matches(sim,criterion(sim,'shared-address')),false);}
});
test('the PAT ACL classifies new flows rather than acting as an interface filter or revoking an existing tuple',()=>{
 const sim=load();sim.registerUDPService(9000,d=>d.id===id('SRV1'),(_d,_payload,source)=>({source}));const request=(port:number)=>{const r=sim.udpRequest(id('PC2'),'198.51.100.10',9000,{}, {sourcePort:port,timeout:2000});sim.advance(2500);return r;};assert.equal(request(44000).source,'203.0.113.1');const row=sim.getDevice(id('R1'))!.runtime.features.natTranslations.find((r:any)=>r.protocol==='udp'),port=row.outsidePort;
 change(sim,'ip access-list standard PAT-INSIDE','no permit 192.168.10.0 0.0.0.255','permit host 192.168.10.10');assert.equal(request(44000).source,'203.0.113.1');assert.equal(row.outsidePort,port);assert.equal(request(44001).status,'failure');run(cli(sim),'clear ip nat translation *');assert.equal(request(44000).status,'failure');assert.ok(!sim.getDevice(id('R1'))!.config.interfaces[g(0)].features.aclIn);restoreACL(sim);assert.equal(request(44000).source,'203.0.113.1');
});
test('wrong HTTP paths or unavailable service cannot complete application tasks despite working ICMP and PAT entries',()=>{
 const sim=load();ping(sim,'PC1');assert.equal(web(sim,'PC1','/missing').statusCode,404);assert.equal(goal(sim,'pc1-http'),false);sim.getDevice(id('SRV1'))!.config.services.http.enabled=false;assert.equal(web(sim,'PC2').status,'failure');assert.equal(goal(sim,'pc2-http'),false);sim.getDevice(id('SRV1'))!.config.services.http.enabled=true;assert.equal(web(sim,'PC1').statusCode,200);assert.equal(goal(sim,'pc1-http'),true);assert.equal(goal(sim,'pc2-http'),false);
});
test('an HTTP response prepared at SRV1 without its returned TCP data cannot earn client delivery credit',()=>{
 const sim=load(),srv=sim.getDevice(id('SRV1'))!;change(sim,'ip access-list extended BLOCK_HTTP_RETURN','deny tcp host 198.51.100.10 eq 80 any','permit ip any any','exit');srv.config.services.http.authentication='aaa';sim.registerHTTPAuthenticator(()=>{sim.getDevice(id('R1'))!.config.interfaces[g(1)].features.aclIn='BLOCK_HTTP_RETURN';return {accepted:true};});const r=sim.httpRequest(id('PC1'),'http://198.51.100.10/',{headers:{Authorization:basicAuthorization('lab','lab')}});sim.advance(12000);assert.equal(r.status,'failure');assert.ok(Object.values<any>(srv.runtime.features.tcpConnections??{}).some(c=>c.response?.statusCode===200));assert.equal(goal(sim,'pc1-http'),false);
});
test('clearing removes dynamic entries but preserves the classifier and overload rule; new traffic creates fresh state',()=>{
 const sim=load();traffic(sim);run(cli(sim),'clear ip nat translation *');assert.deepEqual(sim.getDevice(id('R1'))!.runtime.features.natTranslations,[]);assert.equal(goal(sim,'source-acl'),true);assert.equal(goal(sim,'overload-rule'),true);assert.equal(lessonProgress(sim)!.complete,10);assert.doesNotMatch(cli(sim).execute('show ip nat translations').join('\n'),/(?:icmp|tcp)\s+203/);traffic(sim);
});
test('sharing requires current bindings with unique translated identifiers and matching returned packet evidence',()=>{
 const sim=load();ping(sim,'PC1');ping(sim,'PC2');const c=criterion(sim,'shared-address'),rows=sim.getDevice(id('R1'))!.runtime.features.natTranslations;assert.equal(matches(sim,c),true);const original=rows[1].outsidePort;rows[1].outsidePort=rows[0].outsidePort;assert.equal(matches(sim,c),false);rows[1].outsidePort=original;for(const event of sim.events.filter(e=>e.nodeId===id('PC2')&&e.label==='Echo reply received'))event.packet!.parentId='unrelated';assert.equal(matches(sim,c),false);
});
test('portable reopening preserves achievements while rebuilding fresh dynamic state and retaining live policy checks',()=>{
 const sim=load();traffic(sim);const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(1000);assert.equal(lessonProgress(fresh)!.complete,10);assert.equal(fresh.getDevice(id('R1'))!.runtime.features.natTranslations,undefined);restrict(fresh);assert.equal(goal(fresh,'source-acl'),false);assert.equal(goal(fresh,'shared-address'),true);assert.equal(lessonProgress(fresh)!.complete,9);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(12000);assert.equal(goal(fresh,'source-acl'),true);traffic(fresh);
});
test('every published router, switch and Windows verification command works on actual PAT traffic',()=>{
 const sim=load();traffic(sim);for(const[name,commands]of Object.entries(catalogGuideResources(catalog)!.verification)){const c=cli(sim,name);for(const command of commands){const out=c.execute(command);assert.ok(!out.some(iosRejected),name+': '+command+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);}}assert.match(cli(sim).execute('show ip nat statistics').join('\n'),/Hits:\s*[1-9]/);
});
test('new PAT criteria validate bounded data, rejecting duplicated hosts, oversized sets, unknown paths and invalid addresses',()=>{
 const sim=load(),good=['source-acl','overload-rule','shared-address','pc1-http'].map(g=>criterion(sim,g));for(const criterion of good)validateLesson({title:'PAT',description:'',objectives:[{id:'one',title:'One',criterion}]});const invalidBase:Record<string,unknown>[]=good;for(const criterion of [{...invalidBase[0],wildcard:'999.0.0.0'},{...invalidBase[1],acl:''},{...invalidBase[2],inside:[id('PC1'),id('PC1')]},{...invalidBase[2],inside:Array.from({length:9},(_,i)=>'p'+i)},{...invalidBase[2],insideGlobal:'2001:db8::1'},{...invalidBase[3],content:''}])assert.throws(()=>validateLesson({title:'PAT',description:'',objectives:[{id:'one',title:'One',criterion}]}));
});
