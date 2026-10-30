import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,EXTENDED_IPV4_ACL_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const catalog='extended-ipv4-acl',id=(name:string)=>'device-extended-acl-'+name.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(1000);return sim;}
function cli(sim:Simulator,name='R1'){const c=new IOSSession(sim,id(name));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));}}
function change(sim:Simulator,...lines:string[]){const c=cli(sim);run(c,'configure terminal',...lines,'end');return c;}
const row=(sim:Simulator,goal:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===goal)!;
const goal=(sim:Simulator,name:string)=>row(sim,name).complete;
const decisions=(sim:Simulator):any[]=>sim.getDevice(id('R1'))!.runtime.features.aclDecisions??[];
const hits=(sim:Simulator)=>sim.getDevice(id('R1'))!.runtime.features.aclHits??{};
function ping(sim:Simulator,name:string,target='192.168.20.10'){const r=sim.ping(id(name),target,{count:3});sim.advance(5000);lessonProgress(sim);return r.received;}
function web(sim:Simulator,name:string,target='192.168.20.10',path='/'){const r=sim.httpRequest(id(name),'http://'+target+path);sim.advance(12000);lessonProgress(sim);return r;}
function dns(sim:Simulator,name:string,query='web.acl.lab'){const r=sim.resolveDNS(id(name),query,{server:'192.168.30.10'});sim.advance(12000);lessonProgress(sim);return r;}
function traffic(sim:Simulator){assert.equal(web(sim,'PC1').statusCode,200);assert.equal(web(sim,'PC2').status,'failure');assert.equal(ping(sim,'PC1'),0);assert.equal(ping(sim,'PC2'),0);for(const n of ['PC1','PC2'])assert.equal(dns(sim,n).address,'192.168.20.10');assert.equal(ping(sim,'PC1','192.168.30.10'),3);assert.equal(web(sim,'PC2','192.168.30.10').status,'failure');assert.equal(lessonProgress(sim)!.complete,10);}
const permitHTTP='10 permit tcp host 192.168.10.10 host 192.168.20.10 eq 80';
const permitDNS='20 permit udp 192.168.10.0 0.0.0.255 host 192.168.30.10 eq 53';

test('Extended IPv4 ACL catalog has six nodes, five links, ten tasks and a seven-row plan with zero-credit portable practice',()=>{
 const entry=LAB_CATALOG.find(l=>l.id===catalog)!;assert.equal(entry.group,'CCNA');assert.equal(entry.section,'Services & Security');assert.equal(entry.devices,6);assert.equal(entry.links,5);const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);validateLesson((a.lab as any).lesson);const sim=load('practice');assert.equal(lessonProgress(sim)!.complete,0);assert.equal(lessonProgress(sim)!.rows.length,10);assert.equal(catalogGuideResources(catalog)!.rows.length,7);assert.equal(lessonProgress(sim)!.rows.filter(r=>r.objective.action).length,3);assert.ok(lessonProgress(sim)!.rows.filter(r=>r.objective.action).every(r=>!actionAvailable(sim,r.objective)));for(const d of sim.lab.devices)assert.deepEqual(d.startupConfig,d.config);
});
test('published IOS commands and completed reference earn only two live configuration tasks without fabricated traffic',()=>{
 const sim=load('practice');run(new IOSSession(sim,id('R1')),...COMMANDS.R1);assert.equal(lessonProgress(sim)!.complete,2);assert.deepEqual(decisions(sim),[]);const ref=load();assert.equal(lessonProgress(ref)!.complete,2);assert.deepEqual(decisions(ref),[]);assert.deepEqual(ref.getDevice(id('SRV2'))!.runtime.features.dnsQueries??[],[]);assert.ok(lessonProgress(ref)!.rows.filter(r=>r.objective.action).every(r=>actionAvailable(ref,r.objective)));
});
test('full traffic exercise completes all ten tasks through actual TCP, UDP and ICMP with their intended ACEs',()=>{
 const sim=load();traffic(sim);const d=decisions(sim);assert.ok(d.every(r=>r.port===g(0)&&r.direction==='in'&&r.name==='LAN-FILTER'));assert.ok(d.some(r=>r.protocol==='tcp'&&r.destinationPort===80&&r.sequence===10&&r.action==='permit'));assert.ok(d.some(r=>r.protocol==='udp'&&r.destinationPort===53&&r.sequence===20));assert.ok(d.some(r=>r.protocol==='icmp'&&r.sequence===30&&r.action==='permit'));assert.ok(d.some(r=>r.sequence===40&&r.action==='deny'));assert.ok(d.some(r=>r.implicit&&r.destination==='192.168.30.10'&&r.destinationPort===80));
});
test('the TCP destination-port permit allows PC1 HTTP but not its ICMP, and does not permit PC2 HTTP',()=>{
 const sim=load();assert.equal(web(sim,'PC1').statusCode,200);assert.equal(goal(sim,'pc1-http'),true);assert.equal(ping(sim,'PC1'),0);assert.equal(goal(sim,'pc1-protected'),true);assert.equal(web(sim,'PC2').status,'failure');assert.equal(goal(sim,'pc2-http'),true);assert.equal(goal(sim,'pc2-protected'),false);assert.ok(decisions(sim).some(r=>r.source==='192.168.10.10'&&r.protocol==='icmp'&&r.sequence===40));
});
test('both explicit DNS queries pass UDP 53 and receive the expected A answer, while HTTP to the DNS host is implicitly denied',()=>{
 const sim=load();for(const [n,task]of [['PC1','pc1-dns'],['PC2','pc2-dns']]){assert.equal(dns(sim,n).address,'192.168.20.10');assert.equal(goal(sim,task),true);}assert.equal(web(sim,'PC2','192.168.30.10').status,'failure');assert.equal(goal(sim,'pc2-dns-http'),true);assert.ok(decisions(sim).some(r=>r.kind==='dns-query'&&r.sequence===20&&r.destinationPort===53));assert.ok(decisions(sim).some(r=>r.source==='192.168.10.20'&&r.destination==='192.168.30.10'&&r.protocol==='tcp'&&r.implicit));
});
test('the ICMP echo permit reaches SRV2 with a reply through the unfiltered return direction',()=>{
 const sim=load();assert.equal(ping(sim,'PC1','192.168.30.10'),3);assert.equal(goal(sim,'pc1-dns-ping'),true);assert.equal(goal(sim,'pc1-dns'),false);assert.ok(decisions(sim).some(r=>r.sequence===30&&r.kind==='echo-request'));assert.ok(!decisions(sim).some(r=>r.kind==='echo-reply'));
});
test('an unbound list permits both HTTP destinations but cannot earn any applied-policy traffic proof',()=>{
 const sim=load();change(sim,'interface '+g(0),'no ip access-group LAN-FILTER in');assert.equal(goal(sim,'source-policy'),true);assert.equal(goal(sim,'lan-binding'),false);assert.equal(web(sim,'PC2').statusCode,200);assert.equal(web(sim,'PC2','192.168.30.10').statusCode,200);assert.equal(dns(sim,'PC1').address,'192.168.20.10');assert.deepEqual(decisions(sim),[]);for(const task of ['pc2-http','pc2-dns-http','pc1-dns'])assert.equal(goal(sim,task),false);change(sim,'interface '+g(0),'ip access-group LAN-FILTER in');traffic(sim);
});
test('reversing the ACL to outbound on the client interface filters replies and cannot satisfy inbound-policy tasks',()=>{
 const sim=load();change(sim,'interface '+g(0),'no ip access-group LAN-FILTER in','ip access-group LAN-FILTER out');assert.equal(web(sim,'PC1').status,'failure');assert.equal(dns(sim,'PC1').status,'failure');assert.equal(ping(sim,'PC1','192.168.30.10'),0);assert.equal(goal(sim,'lan-binding'),false);for(const task of ['pc1-http','pc1-dns','pc1-dns-ping','pc2-http'])assert.equal(goal(sim,task),false);assert.ok(decisions(sim).some(r=>r.direction==='out'&&r.source==='192.168.30.10'));
});
test('an earlier broad deny shadows the specific HTTP permit; restoring ordered rules repairs real access',()=>{
 const sim=load();change(sim,'ip access-list extended LAN-FILTER','5 deny ip 192.168.10.0 0.0.0.255 host 192.168.20.10');assert.equal(web(sim,'PC1').status,'failure');assert.equal(goal(sim,'source-policy'),false);assert.equal(goal(sim,'pc1-http'),false);assert.ok(decisions(sim).some(r=>r.action==='deny'&&r.sequence===5));change(sim,'ip access-list extended LAN-FILTER','no 5');traffic(sim);
});
test('wrong destination port, source-port placement and missing host permit all block PC1 HTTP rather than silently completing it',()=>{
 for(const replacement of ['10 permit tcp host 192.168.10.10 host 192.168.20.10 eq 443','10 permit tcp host 192.168.10.10 eq 80 host 192.168.20.10','10 permit tcp host 192.168.10.10 host 192.168.30.10 eq 80','no 10']){const sim=load();change(sim,'ip access-list extended LAN-FILTER',replacement);assert.equal(web(sim,'PC1').status,'failure');assert.equal(goal(sim,'source-policy'),false);assert.equal(goal(sim,'pc1-http'),false);change(sim,'ip access-list extended LAN-FILTER',permitHTTP);assert.equal(web(sim,'PC1').statusCode,200);assert.equal(goal(sim,'pc1-http'),true);}
});
test('TCP in place of UDP, a wrong DNS destination and a wrong DNS port fail actual fresh queries until repaired',()=>{
 for(const replacement of ['20 permit tcp 192.168.10.0 0.0.0.255 host 192.168.30.10 eq 53','20 permit udp 192.168.10.0 0.0.0.255 host 192.168.20.10 eq 53','20 permit udp 192.168.10.0 0.0.0.255 host 192.168.30.10 eq 54']){const sim=load();change(sim,'ip access-list extended LAN-FILTER',replacement);assert.equal(dns(sim,'PC1').status,'failure');assert.equal(goal(sim,'pc1-dns'),false);assert.equal(goal(sim,'source-policy'),false);change(sim,'ip access-list extended LAN-FILTER',permitDNS);assert.equal(dns(sim,'PC1').address,'192.168.20.10');assert.equal(goal(sim,'pc1-dns'),true);}
});
test('cache entries, advisory ACL queries and manually raised counters cannot fabricate DNS, HTTP or denial credit',()=>{
 const sim=load(),pc=sim.getDevice(id('PC1'))!,r=sim.getDevice(id('R1'))!;pc.runtime.features.dnsCache={'web.acl.lab':{address:'192.168.20.10',expires:999999}};assert.equal(sim.resolveName(pc.id,'web.acl.lab').source,'dns-cache');assert.equal(sim.aclPermits(r.id,'LAN-FILTER','192.168.10.10','192.168.30.10','udp',{destinationPort:53}),true);r.runtime.features.aclHits={'LAN-FILTER:10':999,'LAN-FILTER:20':999,'LAN-FILTER:40':999};assert.deepEqual(decisions(sim),[]);assert.equal(lessonProgress(sim)!.complete,2);
});
test('DNS requires the correct record and an actual reply to that client; NXDOMAIN, stopped service and blocked replies do not count',()=>{
 for(const fault of ['record','service','return']){const sim=load(),server=sim.getDevice(id('SRV2'))!;if(fault==='record')server.config.services.dns.resourceRecords[0].value='192.168.20.99';else if(fault==='service')server.config.services.dns.enabled=false;else change(sim,'ip access-list extended REPLY-BLOCK','deny ip any any','exit','interface '+g(0),'ip access-group REPLY-BLOCK out');dns(sim,'PC1');assert.equal(goal(sim,'pc1-dns'),false);assert.equal(goal(sim,'pc2-dns'),false);}const sim=load();assert.equal(dns(sim,'PC1','absent.acl.lab').status,'failure');assert.equal(goal(sim,'pc1-dns'),false);assert.equal(dns(sim,'PC1').address,'192.168.20.10');assert.equal(goal(sim,'pc1-dns'),true);assert.equal(goal(sim,'pc2-dns'),false);
});
test('DNS proof correlates packet identity, transaction, queried name, answer and the delivered reply rather than unrelated traffic',()=>{
 const sim=load();dns(sim,'PC1');const criterion=row(sim,'pc1-dns').objective.criterion;assert.equal(matches(sim,criterion),true);const log=sim.getDevice(id('SRV2'))!.runtime.features.dnsQueries[0];log.transaction='different';assert.equal(matches(sim,criterion),false);log.transaction=decisions(sim).find(d=>d.kind==='dns-query').transaction;assert.equal(matches(sim,criterion),true);for(const e of sim.events)if(e.packet?.messageType==='dns-response')e.packet.parentId='unrelated';assert.equal(matches(sim,criterion),false);
});
test('service outages and disconnected hosts cannot create explicit or implicit ACL-denial achievements',()=>{
 for(const fault of ['source','interface']){const sim=load();if(fault==='source')sim.power(id('PC2'),false);else change(sim,'interface '+g(0),'shutdown');assert.equal(web(sim,'PC2').status,'failure');assert.equal(web(sim,'PC2','192.168.30.10').status,'failure');assert.equal(goal(sim,'pc2-http'),false);assert.equal(goal(sim,'pc2-dns-http'),false);}const sim=load();change(sim,'interface '+g(0),'no ip access-group LAN-FILTER in');sim.getDevice(id('SRV1'))!.config.services.http.enabled=false;sim.getDevice(id('SRV2'))!.config.services.http.enabled=false;assert.equal(web(sim,'PC2').status,'failure');assert.equal(web(sim,'PC2','192.168.30.10').status,'failure');assert.equal(goal(sim,'pc2-http'),false);assert.equal(goal(sim,'pc2-dns-http'),false);
});
test('a failed permitted HTTP response and an explicit deny-any do not masquerade as successful delivery or implicit denial',()=>{
 const sim=load();assert.equal(web(sim,'PC1',undefined,'/missing').statusCode,404);assert.equal(goal(sim,'pc1-http'),false);change(sim,'ip access-list extended LAN-FILTER','50 deny ip any any');assert.equal(web(sim,'PC2','192.168.30.10').status,'failure');assert.equal(goal(sim,'pc2-dns-http'),false);assert.equal(goal(sim,'source-policy'),false);
});
test('fresh counters distinguish TCP, UDP, echo, explicit deny and the invisible implicit deny without changing policy',()=>{
 const sim=load(),c=cli(sim);run(c,'clear access-list counters LAN-FILTER');dns(sim,'PC1');assert.equal(hits(sim)['LAN-FILTER:20'],1);ping(sim,'PC1','192.168.30.10');assert.equal(hits(sim)['LAN-FILTER:30'],3);ping(sim,'PC2');assert.equal(hits(sim)['LAN-FILTER:40'],3);web(sim,'PC1');assert.ok(hits(sim)['LAN-FILTER:10']>0);run(c,'clear access-list counters LAN-FILTER');assert.deepEqual(hits(sim),{});web(sim,'PC2','192.168.30.10');assert.deepEqual(hits(sim),{});const out=c.execute('show access-lists LAN-FILTER').join('\n');assert.match(out,/Extended IP access list LAN-FILTER/);assert.doesNotMatch(out,/50 |deny ip any any|\d+ match/);assert.equal(goal(sim,'source-policy'),true);assert.equal(goal(sim,'lan-binding'),true);
});
test('portable saves preserve earned traffic while fresh runtime counters and live policy/binding still behave correctly',()=>{
 const sim=load();traffic(sim);const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(sim.serialize())));fresh.advance(1000);assert.equal(lessonProgress(fresh)!.complete,10);assert.deepEqual(decisions(fresh),[]);assert.deepEqual(hits(fresh),{});assert.deepEqual(fresh.getDevice(id('SRV2'))!.runtime.features.dnsQueries??[],[]);change(fresh,'interface '+g(0),'no ip access-group LAN-FILTER in');assert.equal(lessonProgress(fresh)!.complete,9);fresh.power(id('R1'),false);fresh.power(id('R1'),true);fresh.advance(12000);assert.equal(lessonProgress(fresh)!.complete,10);traffic(fresh);
});
test('published IOS and Windows commands report actual routes, binding, ACEs, DNS and intended access; aliases preserve semantic policy',()=>{
 const sim=load();traffic(sim);for(const[name,commands]of Object.entries(catalogGuideResources(catalog)!.verification)){const c=cli(sim,name);for(const command of commands){const out=c.execute(command);assert.ok(!out.some(iosRejected),name+': '+command+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);}}const c=change(sim,'ip access-list extended LAN-FILTER','10 permit tcp host 192.168.10.10 host 192.168.20.10 eq www','20 permit udp 192.168.10.0 0.0.0.255 host 192.168.30.10 eq domain');assert.equal(goal(sim,'source-policy'),true);assert.match(c.execute('show ip interface GigabitEthernet0/0').join('\n'),/Inbound\s+access list is LAN-FILTER/);
});
test('extended criteria reject malformed rules, ports, protocols and DNS proof while accepting bounded portable objectives',()=>{
 const sim=load(),valid=['source-policy','lan-binding','pc1-http','pc1-dns','pc2-dns-http'].map(n=>row(sim,n).objective.criterion);for(const criterion of valid)validateLesson({title:'ACL',description:'',objectives:[{id:'one',title:'One',criterion}]});const policy=valid[0]as any,dns=valid[3]as any;const badRules=[{...policy.entries[0],protocol:'dns'},{...policy.entries[0],destination:'bad'},{...policy.entries[0],destinationPort:65536},{...policy.entries[0],destinationPort:{operator:'eq',value:80}},{...policy.entries[0],protocol:'icmp',icmpType:'echo'},{...policy.entries[2],icmpType:'bad'}];for(const criterion of [...badRules.map(e=>({...policy,entries:[e]})),{...policy,entries:Array(65).fill(policy.entries[0])},{...dns,query:'bad..lab'},{...dns,answer:'invalid'},{...dns,action:'deny'},{...dns,query:'x'.repeat(254)}])assert.throws(()=>validateLesson({title:'ACL',description:'',objectives:[{id:'one',title:'One',criterion}]}));assert.equal(matches(sim,{...policy,kind:'standard-acl'}as Criterion),false);
});
