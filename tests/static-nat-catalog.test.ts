import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,STATIC_NAT_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {basicAuthorization} from '../src/http-service.ts';
const catalog='static-nat',id=(name:string)=>'device-static-nat-'+name.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
const endpoints={device:id('R1'),inside:id('SRV1'),outside:id('PC1'),insideLocal:'192.168.10.10',insideGlobal:'203.0.113.10',outsideAddress:'198.51.100.10'};
const pingCriterion=(direction:'inside-out'|'outside-in'):Criterion=>({kind:'nat-ping',...endpoints,direction});
const httpCriterion:Criterion={kind:'nat-http',...endpoints,content:'Static NAT: SRV1 reached'};
function load(mode:'practice'|'completed'='completed'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(1000);return sim;}
function cli(sim:Simulator,name='R1'){const c=new IOSSession(sim,id(name));c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}}
function change(sim:Simulator,...lines:string[]){const c=cli(sim);run(c,'configure terminal',...lines,'end');return c;}
const goal=(sim:Simulator,goal:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===goal)!.complete;
function ping(sim:Simulator,name:string,target:string){const r=sim.ping(id(name),target,{count:3});sim.advance(5000);return r.received;}
function http(sim:Simulator,path='/'){const r=sim.httpRequest(id('PC1'),'http://203.0.113.10'+path);sim.advance(12000);return r;}
function traffic(sim:Simulator){assert.equal(ping(sim,'SRV1','198.51.100.10'),3);assert.equal(ping(sim,'PC1','203.0.113.10'),3);assert.equal(http(sim).statusCode,200);assert.equal(lessonProgress(sim)!.complete,7);}

test('Static NAT is a seven-task CCNA Services & Security lab with independent portable practice and a six-row plan',()=>{
 const entry=LAB_CATALOG.find(l=>l.id===catalog)!;assert.equal(entry.group,'CCNA');assert.equal(entry.section,'Services & Security');assert.equal(entry.devices,4);assert.equal(entry.links,3);const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);validateLesson((a.lab as any).lesson);const sim=load('practice');assert.equal(lessonProgress(sim)!.complete,0);assert.equal(lessonProgress(sim)!.rows.length,7);const resource=catalogGuideResources(catalog)!;assert.equal(resource.rows.length,6);assert.ok(resource.rows.every(r=>r.length===4));for(const d of sim.lab.devices)assert.deepEqual(d.startupConfig,d.config);assert.equal(sim.getDevice(id('SRV1'))!.config.services.http.enabled,true);
});
test('published IOS commands earn four live goals without fabricating traffic and the reference preserves the same clean state',()=>{
 const sim=load('practice');run(new IOSSession(sim,id('R1')),...COMMANDS.R1);assert.equal(lessonProgress(sim)!.complete,4);const reference=load();assert.equal(lessonProgress(reference)!.complete,4);for(const d of reference.lab.devices){assert.equal(d.runtime.features.natFlows,undefined);assert.deepEqual(Object.keys(d.runtime.features.tcpConnections??{}),[]);}assert.ok(!reference.getDevice(id('ISP1'))!.runtime.routes.some(r=>r.network==='192.168.10.0'));assert.match(cli(sim).execute('show ip nat translations').join('\n'),/---\s+203\.0\.113\.10\s+192\.168\.10\.10/);
});
test('actual outbound and independently initiated inbound ICMP correlate translated requests and completed returns',()=>{
 const sim=load();assert.equal(ping(sim,'SRV1','198.51.100.10'),3);assert.equal(goal(sim,'inside-out'),true);assert.equal(goal(sim,'outside-in'),false);assert.equal(lessonProgress(sim)!.complete,5);assert.equal(ping(sim,'PC1','203.0.113.10'),3);assert.equal(goal(sim,'outside-in'),true);assert.equal(lessonProgress(sim)!.complete,6);assert.ok(sim.events.some(e=>e.nodeId===id('PC1')&&e.label==='Echo request accepted'&&e.packet?.source==='203.0.113.10'));assert.ok(sim.events.some(e=>e.nodeId===id('PC1')&&e.label==='Echo reply received'&&e.packet?.source==='203.0.113.10'));
});
test('delivered HTTP through the public mapping earns application credit and produces real TCP translations',()=>{
 const sim=load(),r=http(sim);assert.equal(r.status,'success');assert.equal(r.statusCode,200);assert.match(r.body,/Static NAT: SRV1 reached/);assert.equal(matches(sim,httpCriterion),true);assert.equal(goal(sim,'published-http'),true);assert.equal(goal(sim,'inside-out'),false);assert.equal(goal(sim,'outside-in'),false);const out=cli(sim).execute('show ip nat translations').join('\n');assert.match(out,/tcp\s+203\.0\.113\.10:80\s+192\.168\.10\.10:80/);
});
test('wrong HTTP paths, unavailable HTTP and ICMP alone cannot complete the website task',()=>{
 const sim=load();assert.equal(http(sim,'/missing').statusCode,404);assert.equal(matches(sim,httpCriterion),false);ping(sim,'PC1','203.0.113.10');assert.equal(goal(sim,'published-http'),false);sim.getDevice(id('SRV1'))!.config.services.http.enabled=false;assert.equal(http(sim).status,'failure');assert.equal(matches(sim,httpCriterion),false);sim.getDevice(id('SRV1'))!.config.services.http.enabled=true;assert.equal(http(sim).statusCode,200);assert.equal(goal(sim,'published-http'),true);
});
test('each missing NAT role prevents correct bidirectional translation even while the permanent mapping remains',()=>{
 for(const [port,role]of [[g(0),'inside'],[g(1),'outside']]as const){const sim=load();change(sim,'interface '+port,'no ip nat '+role);assert.equal(goal(sim,role+'-role'),false);assert.equal(goal(sim,'static-mapping'),true);assert.equal(ping(sim,'SRV1','198.51.100.10'),0);assert.equal(ping(sim,'PC1','203.0.113.10'),role==='inside'?3:0);if(role==='inside')assert.ok(sim.events.some(e=>e.nodeId===id('PC1')&&e.label==='Echo reply received'&&e.packet?.source==='192.168.10.10'));assert.equal(http(sim).status,'failure');assert.equal(matches(sim,pingCriterion('inside-out')),false);assert.equal(matches(sim,pingCriterion('outside-in')),false);change(sim,'interface '+port,'ip nat '+role);traffic(sim);}
});
test('a wrong inside address cannot be rescued by a visible static row and correction restores all traffic',()=>{
 const sim=load();change(sim,'no ip nat inside source static 192.168.10.10 203.0.113.10','ip nat inside source static 192.168.10.11 203.0.113.10');assert.equal(goal(sim,'static-mapping'),false);assert.equal(ping(sim,'SRV1','198.51.100.10'),0);assert.equal(ping(sim,'PC1','203.0.113.10'),0);assert.equal(http(sim).status,'failure');run(cli(sim),'clear ip nat translation *');change(sim,'no ip nat inside source static 192.168.10.11 203.0.113.10','ip nat inside source static 192.168.10.10 203.0.113.10');traffic(sim);
});
test('R1 needs an upstream default for the return path; NAT does not create routes or a private ISP route',()=>{
 const sim=load();change(sim,'no ip route 0.0.0.0 0.0.0.0 203.0.113.2');assert.equal(goal(sim,'default-route'),false);assert.equal(ping(sim,'SRV1','198.51.100.10'),0);assert.equal(ping(sim,'PC1','203.0.113.10'),0);assert.equal(goal(sim,'outside-in'),false);assert.equal(ping(sim,'SRV1','192.168.10.1'),3);change(sim,'ip route 0.0.0.0 0.0.0.0 203.0.113.2');traffic(sim);assert.equal(ping(sim,'PC1','192.168.10.10'),0);
});
test('static public alias is not assigned to an interface and ISP1 resolves its ARP to R1’s outside MAC',()=>{
 const sim=load();assert.ok(!sim.lab.devices.some(d=>Object.values(d.config.interfaces).some(p=>p.ip==='203.0.113.10')));assert.equal(ping(sim,'PC1','203.0.113.10'),3);const arp=cli(sim,'ISP1').execute('show ip arp').join('\n');assert.match(arp,/203\.0\.113\.10/);assert.equal(goal(sim,'outside-in'),true);
});
test('NAT configuration, a router ping and an untranslated private-address workaround cannot fabricate translation achievements',()=>{
 const sim=load();assert.equal(ping(sim,'R1','198.51.100.10'),3);assert.equal(matches(sim,pingCriterion('inside-out')),false);const isp=cli(sim,'ISP1');run(isp,'configure terminal','ip route 192.168.10.0 255.255.255.0 203.0.113.1','end');change(sim,'interface '+g(0),'no ip nat inside','interface '+g(1),'no ip nat outside');assert.equal(ping(sim,'PC1','192.168.10.10'),3);assert.equal(ping(sim,'SRV1','198.51.100.10'),3);assert.equal(matches(sim,pingCriterion('inside-out')),false);assert.equal(matches(sim,pingCriterion('outside-in')),false);assert.equal(matches(sim,httpCriterion),false);
});
test('an HTTP 200 prepared at the server without delivered TCP response cannot complete the HTTP goal',()=>{
 const sim=load(),server=sim.getDevice(id('SRV1'))!;change(sim,'ip access-list extended BLOCK_HTTP_RETURN','deny tcp host 203.0.113.10 eq 80 any','permit ip any any','exit');server.config.services.http.authentication='aaa';server.config.services.http.authenticationList='HTTP';sim.registerHTTPAuthenticator(()=>{sim.getDevice(id('R1'))!.config.interfaces[g(1)].features.aclOut='BLOCK_HTTP_RETURN';return {accepted:true};});const r=sim.httpRequest(id('PC1'),'http://203.0.113.10/',{headers:{Authorization:basicAuthorization('lab','lab')}});sim.advance(12000);assert.equal(r.status,'failure');assert.ok(Object.values<any>(server.runtime.features.tcpConnections??{}).some(c=>c.response?.statusCode===200));assert.equal(matches(sim,httpCriterion),false);assert.equal(goal(sim,'published-http'),false);
});
test('clearing dynamic state preserves the permanent static mapping and real traffic recreates its child entries',()=>{
 const sim=load();traffic(sim);const c=cli(sim);assert.ok(sim.getDevice(id('R1'))!.runtime.features.natFlows.length>0);run(c,'clear ip nat translation *');assert.deepEqual(sim.getDevice(id('R1'))!.runtime.features.natFlows,[]);assert.match(c.execute('show ip nat translations').join('\n'),/---\s+203\.0\.113\.10\s+192\.168\.10\.10/);assert.equal(lessonProgress(sim)!.complete,7);traffic(sim);assert.ok(sim.getDevice(id('R1'))!.runtime.features.natFlows.length>0);
});
test('NAT traffic proofs correlate packet identity and direction rather than unrelated requests or aggregate counters',()=>{
 const sim=load();ping(sim,'SRV1','198.51.100.10');assert.equal(matches(sim,pingCriterion('inside-out')),true);const reply=sim.events.find(e=>e.nodeId===id('SRV1')&&e.label==='Echo reply received')!,saved=reply.packet!.parentId;for(const e of sim.events.filter(e=>e.nodeId===id('SRV1')&&e.label==='Echo reply received'))e.packet!.parentId='unrelated';assert.equal(matches(sim,pingCriterion('inside-out')),false);reply.packet!.parentId=saved;assert.equal(matches(sim,pingCriterion('inside-out')),true);assert.equal(matches(sim,{...pingCriterion('inside-out'),insideGlobal:'203.0.113.11'}as Criterion),false);assert.equal(matches(sim,{...httpCriterion,outside:id('ISP1')}as Criterion),false);
});
test('portable reopening preserves packet achievements while NAT policy, usable interfaces and routing stay live',()=>{
 const sim=load();traffic(sim);sim.getDevice(id('R1'))!.config.hostname='Edge';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(1000);assert.equal(lessonProgress(fresh)!.complete,7);assert.equal(fresh.getDevice(id('R1'))!.runtime.features.natFlows,undefined);assert.deepEqual(Object.keys(fresh.getDevice(id('PC1'))!.runtime.features.tcpConnections??{}),[]);change(fresh,'interface '+g(1),'no ip nat outside');assert.equal(lessonProgress(fresh)!.complete,6);assert.equal(goal(fresh,'published-http'),true);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(12000);assert.equal(lessonProgress(fresh)!.complete,7);traffic(fresh);
});
test('all published IOS and host verification commands work and show permanent and protocol-specific NAT state',()=>{
 const sim=load();traffic(sim);for(const[name,commands]of Object.entries(catalogGuideResources(catalog)!.verification)){const c=cli(sim,name);for(const command of commands){const out=c.execute(command);assert.ok(!out.some(iosRejected),name+': '+command+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);}}assert.match(cli(sim).execute('show ip nat statistics').join('\n'),/Hits:\s*[1-9]/);
});
test('imported NAT criteria reject invalid roles, IPv6 addresses, unbounded names and unknown directions',()=>{
 const good:Criterion[]=[{kind:'nat-interface',device:id('R1'),interface:g(0),role:'inside'},{kind:'nat-static',device:id('R1'),insideLocal:'192.168.10.10',insideGlobal:'203.0.113.10'},pingCriterion('inside-out'),httpCriterion];for(const criterion of good)validateLesson({title:'NAT',description:'',objectives:[{id:'one',title:'One',criterion}]});for(const criterion of [{...good[0],role:'auto'},{...good[0],interface:''},{...good[1],insideLocal:'2001:db8::1'},{...good[1],insideGlobal:'203.0.113.999'},{...good[2],outside:'a'.repeat(129)},{...good[2],direction:'both'},{...httpCriterion,content:''},{...httpCriterion,content:'a'.repeat(1001)}])assert.throws(()=>validateLesson({title:'NAT',description:'',objectives:[{id:'one',title:'One',criterion}]}));
});
