import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,STANDARD_IPV4_ACL_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='standard-ipv4-acl',id=(n:string)=>'device-standard-acl-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(1000);return sim;}
function cli(sim:Simulator,name='R1'){const c=new IOSSession(sim,id(name));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}}
function change(sim:Simulator,...lines:string[]){const c=cli(sim);run(c,'configure terminal',...lines,'end');return c;}
const row=(sim:Simulator,goal:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===goal)!;
const goal=(sim:Simulator,goal:string)=>row(sim,goal).complete;
const decisions=(sim:Simulator):any[]=>sim.getDevice(id('R1'))!.runtime.features.aclDecisions??[];
function ping(sim:Simulator,name:string,target='192.168.20.10'){const r=sim.ping(id(name),target,{count:3});sim.advance(5000);lessonProgress(sim);return r.received;}
function web(sim:Simulator,name:string,target='192.168.20.10',path='/'){const r=sim.httpRequest(id(name),'http://'+target+path);sim.advance(12000);lessonProgress(sim);return r;}
function traffic(sim:Simulator){assert.equal(ping(sim,'PC1'),3);assert.equal(ping(sim,'PC2'),0);assert.equal(ping(sim,'PC3'),0);for(const n of ['PC2','PC3'])assert.equal(ping(sim,n,'192.168.30.10'),3);assert.equal(web(sim,'PC1').statusCode,200);for(const n of ['PC2','PC3'])assert.equal(web(sim,n).status,'failure');assert.equal(lessonProgress(sim)!.complete,10);}

test('Standard IPv4 ACL has seven nodes, six links, ten tasks and a nine-row addressing plan with a zero-credit portable practice',()=>{
 const entry=LAB_CATALOG.find(l=>l.id===catalog)!;assert.equal(entry.group,'CCNA');assert.equal(entry.section,'Services & Security');assert.equal(entry.devices,7);assert.equal(entry.links,6);const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);validateLesson((a.lab as any).lesson);const sim=load('practice');assert.equal(lessonProgress(sim)!.complete,0);assert.equal(lessonProgress(sim)!.rows.length,10);assert.equal(catalogGuideResources(catalog)!.rows.length,9);assert.ok(lessonProgress(sim)!.rows.filter(r=>r.objective.action).every(r=>!actionAvailable(sim,r.objective)));for(const d of sim.lab.devices)assert.deepEqual(d.startupConfig,d.config);
});
test('published commands earn only two live configuration goals; completed references never preload ACL decisions or traffic',()=>{
 const sim=load('practice');run(new IOSSession(sim,id('R1')),...COMMANDS.R1);assert.equal(lessonProgress(sim)!.complete,2);assert.equal(load().lab.devices.length,7);assert.deepEqual(decisions(sim),[]);const ref=load();assert.equal(lessonProgress(ref)!.complete,2);assert.deepEqual(decisions(ref),[]);assert.ok(lessonProgress(ref)!.rows.filter(r=>r.objective.action).every(r=>actionAvailable(ref,r.objective)));
});
test('permitted ICMP and distinct explicit/implicit denies are based on actual interface decisions and packet delivery',()=>{
 const sim=load();assert.equal(ping(sim,'PC1'),3);assert.equal(goal(sim,'pc1-protected'),true);assert.equal(ping(sim,'PC2'),0);assert.equal(goal(sim,'pc2-protected'),true);assert.equal(goal(sim,'pc3-protected'),false);assert.equal(ping(sim,'PC3'),0);assert.equal(goal(sim,'pc3-protected'),true);const filtered=decisions(sim).filter(r=>r.kind==='echo-request');assert.ok(filtered.some(r=>r.source==='192.168.10.10'&&r.action==='permit'&&r.sequence===10&&!r.implicit));assert.ok(filtered.some(r=>r.source==='192.168.10.20'&&r.action==='deny'&&r.sequence===20&&!r.implicit));assert.ok(filtered.some(r=>r.source==='192.168.40.10'&&r.action==='deny'&&r.sequence===undefined&&r.implicit));assert.ok(filtered.every(r=>r.name==='SERVER-ACCESS'&&r.direction==='out'&&r.port===g(1)));
});
test('both denied PCs still reach the control server with ICMP and HTTP because the standard ACL is near its destination',()=>{
 const sim=load();for(const n of ['PC2','PC3']){assert.equal(ping(sim,n,'192.168.30.10'),3);assert.equal(web(sim,n,'192.168.30.10').statusCode,200);}assert.equal(goal(sim,'pc2-control'),true);assert.equal(goal(sim,'pc3-control'),true);assert.ok(!decisions(sim).some(r=>r.destination==='192.168.30.10'));
});
test('the same source policy permits a completed PC1 HTTP response and blocks PC2/PC3 HTTP with the intended decisions',()=>{
 const sim=load();const permit=web(sim,'PC1');assert.equal(permit.statusCode,200);assert.match(permit.body,/SRV1: protected server reached/);assert.equal(goal(sim,'pc1-http'),true);assert.equal(web(sim,'PC2').status,'failure');assert.equal(goal(sim,'pc2-http'),true);assert.equal(goal(sim,'pc3-http'),false);assert.equal(web(sim,'PC3').status,'failure');assert.equal(goal(sim,'pc3-http'),true);assert.ok(decisions(sim).filter(r=>r.protocol==='tcp').every(r=>typeof r.transaction==='string'));assert.equal(goal(sim,'pc1-protected'),false);
});
test('a defined but unbound list does not filter traffic or earn applied-policy proof',()=>{
 const sim=load();change(sim,'interface '+g(1),'no ip access-group SERVER-ACCESS out');assert.equal(goal(sim,'source-policy'),true);assert.equal(goal(sim,'protected-binding'),false);for(const n of ['PC2','PC3']){assert.equal(ping(sim,n),3);assert.equal(web(sim,n).statusCode,200);}assert.deepEqual(decisions(sim),[]);assert.equal(goal(sim,'pc2-protected'),false);assert.equal(goal(sim,'pc3-http'),false);
});
test('wrong inbound placement on the shared source LAN also breaks PC2 access to SRV2 and cannot satisfy destination-scoped tasks',()=>{
 const sim=load();change(sim,'interface '+g(1),'no ip access-group SERVER-ACCESS out','interface '+g(0),'ip access-group SERVER-ACCESS in');assert.equal(goal(sim,'protected-binding'),false);assert.equal(ping(sim,'PC2'),0);assert.equal(ping(sim,'PC2','192.168.30.10'),0);assert.equal(ping(sim,'PC3'),3);assert.ok(decisions(sim).some(r=>r.direction==='in'&&r.port===g(0)&&r.source==='192.168.10.20'));assert.equal(goal(sim,'pc2-protected'),false);change(sim,'interface '+g(0),'no ip access-group SERVER-ACCESS in','interface '+g(1),'ip access-group SERVER-ACCESS out');traffic(sim);
});
test('a correct interface with the wrong direction blocks server responses instead of proving the intended source restriction',()=>{
 const sim=load();change(sim,'interface '+g(1),'no ip access-group SERVER-ACCESS out','ip access-group SERVER-ACCESS in');assert.equal(ping(sim,'PC1'),0);assert.equal(ping(sim,'PC2'),0);assert.equal(goal(sim,'protected-binding'),false);assert.equal(goal(sim,'pc2-protected'),false);assert.ok(decisions(sim).some(r=>r.source==='192.168.20.10'&&r.direction==='in'));assert.equal(ping(sim,'PC2','192.168.30.10'),3);
});
test('removing the specific permit lets the broader subnet deny match PC1; restoring sequence10 repairs access',()=>{
 const sim=load();change(sim,'ip access-list standard SERVER-ACCESS','no 10');assert.equal(goal(sim,'source-policy'),false);assert.equal(ping(sim,'PC1'),0);assert.equal(goal(sim,'pc1-protected'),false);assert.ok(decisions(sim).some(r=>r.source==='192.168.10.10'&&r.action==='deny'&&r.sequence===20));change(sim,'ip access-list standard SERVER-ACCESS','10 permit host 192.168.10.10');traffic(sim);
});
test('an explicit deny-any cannot be misreported as the implicit deny, and an extended ACL cannot replace the standard policy',()=>{
 const sim=load();change(sim,'ip access-list standard SERVER-ACCESS','no 20','20 deny any');assert.equal(ping(sim,'PC3'),0);assert.equal(goal(sim,'pc3-protected'),false);assert.equal(web(sim,'PC3').status,'failure');assert.equal(goal(sim,'pc3-http'),false);assert.equal(goal(sim,'source-policy'),false);assert.ok(decisions(sim).some(r=>r.source==='192.168.40.10'&&r.sequence===20&&!r.implicit));sim.getDevice(id('R1'))!.config.features.acls['SERVER-ACCESS'].type='extended';assert.equal(goal(sim,'source-policy'),false);
});
test('network outages and powered-off endpoints cannot fabricate ACL denial credit',()=>{
 for(const fault of ['server','source','interface']){const sim=load();if(fault==='server')sim.power(id('SRV1'),false);else if(fault==='source')sim.power(id('PC2'),false);else change(sim,'interface '+g(1),'shutdown');assert.equal(ping(sim,'PC2'),0);assert.equal(goal(sim,'pc2-protected'),false);assert.equal(web(sim,'PC2').status,'failure');assert.equal(goal(sim,'pc2-http'),false);}
});
test('advisory ACL queries and manually raised hit counters create no packet evidence or permitted/denied achievements',()=>{
 const sim=load(),d=sim.getDevice(id('R1'))!;assert.equal(sim.aclPermits(d.id,'SERVER-ACCESS','192.168.10.10','192.168.20.10','icmp'),true);assert.equal(sim.aclPermits(d.id,'SERVER-ACCESS','192.168.10.20','192.168.20.10','tcp',{destinationPort:80}),false);d.runtime.features.aclHits['SERVER-ACCESS:10']=99999;d.runtime.features.aclHits['SERVER-ACCESS:20']=99999;assert.deepEqual(decisions(sim),[]);for(const n of ['pc1-protected','pc2-protected','pc3-protected','pc1-http','pc2-http'])assert.equal(goal(sim,n),false);
});
test('implicit deny is absent from the visible ACE list and does not increment either explicit rule counter',()=>{
 const sim=load(),c=cli(sim);run(c,'clear access-list counters SERVER-ACCESS');ping(sim,'PC3');assert.deepEqual(sim.getDevice(id('R1'))!.runtime.features.aclHits??{},{});const text=c.execute('show access-lists SERVER-ACCESS').join('\n');assert.match(text,/10 permit 192\.168\.10\.10/);assert.match(text,/20 deny\s+192\.168\.10\.0/);assert.doesNotMatch(text,/30 |deny any/);assert.equal(goal(sim,'pc3-protected'),true);ping(sim,'PC2');assert.equal(sim.getDevice(id('R1'))!.runtime.features.aclHits['SERVER-ACCESS:20'],3);
});
test('a permitted ACL decision or failed HTTP response alone cannot complete successful HTTP delivery',()=>{
 const sim=load();assert.equal(web(sim,'PC1',undefined,'/missing').statusCode,404);assert.equal(goal(sim,'pc1-http'),false);sim.getDevice(id('SRV1'))!.config.services.http.enabled=false;assert.equal(web(sim,'PC1').status,'failure');assert.equal(goal(sim,'pc1-http'),false);sim.getDevice(id('SRV1'))!.config.services.http.enabled=true;assert.equal(web(sim,'PC1').statusCode,200);assert.equal(goal(sim,'pc1-http'),true);
});
test('packet proof correlates the actual ACE and transaction rather than an unrelated drop or another source',()=>{
 const sim=load();ping(sim,'PC2');const criterion=row(sim,'pc2-protected').objective.criterion;assert.equal(matches(sim,criterion),true);for(const d of decisions(sim))d.packetId='unrelated';assert.equal(matches(sim,criterion),false);assert.equal(matches(sim,{...criterion,source:id('PC3')}as Criterion),false);web(sim,'PC2');const h=row(sim,'pc2-http').objective.criterion;assert.equal(matches(sim,h),true);for(const d of decisions(sim))if(d.protocol==='tcp')d.transaction='different';assert.equal(matches(sim,h),false);
});
test('clearing counters preserves configuration and achievements while subsequent traffic populates fresh counters',()=>{
 const sim=load();traffic(sim);run(cli(sim),'clear access-list counters SERVER-ACCESS');assert.deepEqual(sim.getDevice(id('R1'))!.runtime.features.aclHits,{});assert.equal(lessonProgress(sim)!.complete,10);assert.equal(goal(sim,'source-policy'),true);assert.equal(goal(sim,'protected-binding'),true);ping(sim,'PC1');assert.equal(sim.getDevice(id('R1'))!.runtime.features.aclHits['SERVER-ACCESS:10'],3);
});
test('portable reopening preserves achievements with fresh decision/counter state while live policy and binding still matter',()=>{
 const sim=load();traffic(sim);sim.getDevice(id('R1'))!.config.hostname='Edge';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(1000);assert.equal(lessonProgress(fresh)!.complete,10);assert.deepEqual(decisions(fresh),[]);assert.deepEqual(fresh.getDevice(id('R1'))!.runtime.features.aclHits??{},{});change(fresh,'interface '+g(1),'no ip access-group SERVER-ACCESS out');assert.equal(lessonProgress(fresh)!.complete,9);assert.equal(goal(fresh,'pc2-protected'),true);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(12000);assert.equal(lessonProgress(fresh)!.complete,10);traffic(fresh);
});
test('all published IOS and Windows verification commands report actual policy, binding, routing and intended access results',()=>{
 const sim=load();traffic(sim);for(const[name,commands]of Object.entries(catalogGuideResources(catalog)!.verification)){const c=cli(sim,name);for(const command of commands){const out=c.execute(command);assert.ok(!out.some(iosRejected),name+': '+command+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);}}assert.match(cli(sim).execute('show ip interface GigabitEthernet0/1').join('\n'),/Outgoing access list is SERVER-ACCESS/);
});
test('ACL criteria reject oversized rules, duplicate sequences, unknown directions, invalid addresses and impossible implicit permits',()=>{
 const sim=load(),valid=['source-policy','protected-binding','pc1-protected','pc2-protected','pc3-protected','pc1-http','pc3-http'].map(n=>row(sim,n).objective.criterion);for(const criterion of valid)validateLesson({title:'ACL',description:'',objectives:[{id:'one',title:'One',criterion}]});const policy=valid[0]as any;for(const criterion of [{...policy,entries:[]},{...policy,entries:Array(65).fill(policy.entries[0])},{...policy,entries:[policy.entries[0],policy.entries[0]]},{...valid[1],direction:'both'},{...valid[2],implicit:true},{...valid[4],sequence:20},{...valid[5],content:''},{...valid[6],content:'x'.repeat(1001)}])assert.throws(()=>validateLesson({title:'ACL',description:'',objectives:[{id:'one',title:'One',criterion}]}));
});
