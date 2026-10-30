import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {handleAAARequest} from '../src/aaa-service.ts';
import {createCatalogLab,TACACS_AAA_CLIENT_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';

const catalog='tacacs-aaa-client',r1='device-tacacs-aaa-r1',pc1='device-tacacs-aaa-pc1',srv='device-tacacs-aaa-srv1';
const sessionCriterion:Criterion={kind:'tacacs-session',device:r1,server:srv,source:pc1,username:'netadmin',privilege:15};
function load(mode:'practice'|'completed'='completed'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(1000);return sim;}
function run(cli:IOSSession,...lines:string[]){for(const line of lines){const rows=cli.execute(line);assert.ok(!rows.some(iosRejected),line+'\n'+rows.join('\n'));}}
function consoleLogin(sim:Simulator){const cli=new IOSSession(sim,r1);assert.equal(cli.prompt,'Username:');run(cli,'rescue','RescueLab123');assert.equal(cli.prompt,'R1>');run(cli,'enable','EnableLab123');assert.equal(cli.prompt,'R1#');return cli;}
function change(sim:Simulator,...lines:string[]){const cli=consoleLogin(sim);run(cli,'configure terminal',...lines,'end');return cli;}
function login(sim:Simulator,user='netadmin',password='TacacsAdmin123'){const cli=new IOSSession(sim,pc1);run(cli,`ssh -l ${user} 192.0.2.1`);assert.equal(cli.prompt,'Password:');assert.equal(cli.passwordInput,true);run(cli,password);assert.equal(cli.prompt,'R1#');sim.advance(500);return cli;}
function finish(sim:Simulator,cli:IOSSession){run(cli,'exit');assert.equal(cli.prompt,'C:\\>');sim.advance(3000);}
const service=(sim:Simulator)=>sim.getDevice(srv)!.config.services.tacacs;
const received=(sim:Simulator):any[]=>sim.getDevice(srv)!.runtime.features.aaaAccountingReceived??[];
const requests=(sim:Simulator):any[]=>sim.getDevice(srv)!.runtime.features.aaaRequests??[];
const deliveries=(sim:Simulator):any[]=>sim.getDevice(r1)!.runtime.features.aaaAccountingEvents??[];
const goal=(sim:Simulator,id:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===id)!.complete;
function ping(sim:Simulator){const p=sim.ping(pc1,'192.168.100.10',{count:3});sim.advance(4000);assert.equal(p.received,3);lessonProgress(sim);}
const fresh=(sim:Simulator)=>{const next=new Simulator();next.load(parseLabFile(serializeLabFile(sim.serialize())));next.advance(1000);return next;};

test('TACACS client practice has three addressed nodes, a prepared server, independent identity and zero credit',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);assert.equal(a.lab.devices.length,3);assert.equal(a.lab.links.length,2);assert.equal(LAB_CATALOG.find(l=>l.id===catalog)!.section,'Services & Security');const sim=load('practice');assert.equal(lessonProgress(sim)!.complete,0);assert.equal(sim.getDevice(r1)!.config.features.aaa,undefined);assert.equal(service(sim).enabled,true);assert.equal(service(sim).users.netadmin.privilege,15);assert.equal(service(sim).users.rescue,undefined);assert.deepEqual(received(sim),[]);assert.equal(new IOSSession(sim,r1).prompt,'R1>');
});
test('published client configuration and completed reference earn eight live goals without invented AAA traffic',()=>{
 const sim=load('practice');run(new IOSSession(sim,r1),...COMMANDS.R1);assert.equal(lessonProgress(sim)!.complete,8);const ref=load();assert.equal(lessonProgress(ref)!.complete,8);assert.deepEqual(requests(ref),[]);assert.deepEqual(received(ref),[]);assert.deepEqual(deliveries(ref),[]);ping(ref);assert.equal(lessonProgress(ref)!.complete,9);const cli=login(ref);assert.equal(goal(ref,'accounted-session'),false);finish(ref,cli);assert.equal(lessonProgress(ref)!.complete,10);
});
test('remote SSH authenticates and authorizes EXEC through TCP49 and commits acknowledged paired Start/Stop records',()=>{
 const sim=load(),cli=login(sim);assert.match(cli.execute('show privilege').join('\n'),/level is 15/);assert.ok(requests(sim).some(q=>q.operation==='authenticate'&&q.accepted&&q.username==='netadmin'&&q.source==='192.168.100.1'));assert.ok(requests(sim).some(q=>q.operation==='authorize'&&q.kind==='exec'&&q.accepted));assert.equal(received(sim).length,1);assert.equal(received(sim)[0].status,'start');assert.equal(matches(sim,sessionCriterion),false);finish(sim,cli);const [start,stop]=received(sim);assert.equal(start.sessionId,stop.sessionId);assert.equal(stop.status,'stop');assert.equal(start.remoteSource,'192.0.2.10');assert.equal(start.source,'192.168.100.1');assert.equal(start.privilege,15);assert.ok(deliveries(sim).every(d=>d.status==='delivered'));assert.equal(matches(sim,sessionCriterion),true);assert.ok(sim.events.some(e=>e.protocol==='TCP'&&e.packet?.destinationPort===49));
});
test('wrong remote passwords are rejected and cannot create authorization, accounting or session credit',()=>{
 const sim=load(),cli=new IOSSession(sim,pc1);run(cli,'ssh netadmin@192.0.2.1');assert.match(cli.execute('WrongLab123').join('\n'),/Login invalid/);assert.equal(cli.prompt,'Password:');assert.ok(requests(sim).some(q=>q.operation==='authenticate'&&!q.accepted));assert.ok(!requests(sim).some(q=>q.operation==='authorize'));assert.deepEqual(received(sim),[]);assert.equal(goal(sim,'accounted-session'),false);run(cli,'TacacsAdmin123');assert.equal(cli.prompt,'R1#');finish(sim,cli);assert.equal(goal(sim,'accounted-session'),true);
});
test('an explicit healthy-server rejection does not fall through to the valid local rescue account',()=>{
 const sim=load(),cli=new IOSSession(sim,pc1);run(cli,'ssh rescue@192.0.2.1');for(let i=0;i<2;i++)assert.match(cli.execute('RescueLab123').join('\n'),/Login invalid/);assert.match(cli.execute('RescueLab123').join('\n'),/Bad passwords/);assert.equal(cli.prompt,'C:\\>');assert.ok(requests(sim).filter(q=>q.username==='rescue').every(q=>q.accepted===false));assert.deepEqual(received(sim),[]);assert.equal(goal(sim,'accounted-session'),false);
});
test('an unavailable TACACS service permits local authentication and EXEC fallback but cannot fabricate accounting',()=>{
 const sim=load();service(sim).enabled=false;sim.changed();ping(sim);assert.equal(goal(sim,'tacacs-server'),false);const cli=login(sim,'rescue','RescueLab123');assert.match(cli.execute('show privilege').join('\n'),/level is 15/);finish(sim,cli);assert.deepEqual(received(sim),[]);assert.ok(deliveries(sim).length>=2);assert.ok(deliveries(sim).every(d=>d.status==='failed'));assert.equal(goal(sim,'accounted-session'),false);service(sim).enabled=true;sim.changed();finish(sim,login(sim));assert.equal(lessonProgress(sim)!.complete,10);
});
test('EXEC authorization denial after accepted authentication closes SSH without accounting Start or local authorization bypass',()=>{
 const sim=load();service(sim).users.netadmin.authorization=false;sim.changed();const cli=new IOSSession(sim,pc1);run(cli,'ssh netadmin@192.0.2.1');assert.match(cli.execute('TacacsAdmin123').join('\n'),/EXEC authorization failed/);assert.equal(cli.prompt,'C:\\>');assert.ok(requests(sim).some(q=>q.operation==='authenticate'&&q.accepted));assert.ok(requests(sim).some(q=>q.operation==='authorize'&&q.kind==='exec'&&!q.accepted));assert.deepEqual(received(sim),[]);assert.equal(goal(sim,'accounted-session'),false);service(sim).users.netadmin.authorization=true;sim.changed();finish(sim,login(sim));assert.equal(goal(sim,'accounted-session'),true);
});
test('a defined authorization list without its VTY binding does not grant the planned privileged EXEC session',()=>{
 const sim=load();change(sim,'line vty 0 4','no authorization exec');assert.equal(goal(sim,'vty-ssh'),false);const cli=new IOSSession(sim,pc1);run(cli,'ssh netadmin@192.0.2.1','TacacsAdmin123');assert.equal(cli.prompt,'R1>');assert.match(cli.execute('show privilege').join('\n'),/level is 1/);finish(sim,cli);assert.ok(!requests(sim).some(q=>q.operation==='authorize'));assert.equal(matches(sim,sessionCriterion),false);
});
test('a defined accounting list without its VTY binding cannot invent a delivered EXEC session',()=>{
 const sim=load();change(sim,'line vty 0 4','no accounting exec');assert.equal(goal(sim,'vty-ssh'),false);finish(sim,login(sim));assert.deepEqual(received(sim),[]);assert.deepEqual(deliveries(sim),[]);assert.equal(matches(sim,sessionCriterion),false);
});
test('stop-only accounting is operational but cannot satisfy the required Start/Stop configuration or session pair',()=>{
 const sim=load();change(sim,'aaa accounting exec VTY-ACCT stop-only group TAC-GROUP');assert.equal(goal(sim,'accounting'),false);finish(sim,login(sim));assert.equal(received(sim).length,1);assert.equal(received(sim)[0].status,'stop');assert.equal(matches(sim,sessionCriterion),false);
});
test('accounting rejection does not deny otherwise authorized SSH and remains a failed undelivered record',()=>{
 const sim=load();service(sim).accountingEnabled=false;sim.changed();finish(sim,login(sim));assert.deepEqual(received(sim),[]);assert.ok(deliveries(sim).every(d=>d.status==='failed'));assert.equal(goal(sim,'tacacs-server'),false);assert.equal(goal(sim,'accounted-session'),false);
});
test('a mismatched shared key can permit error fallback but never earns working server or remote session credit',()=>{
 const sim=load();change(sim,'tacacs server TACACS1','key WrongSharedKey');assert.equal(goal(sim,'tacacs-server'),false);finish(sim,login(sim,'rescue','RescueLab123'));assert.ok(requests(sim).some(q=>q.accepted===false));assert.deepEqual(received(sim),[]);assert.equal(matches(sim,sessionCriterion),false);change(sim,'tacacs server TACACS1','key TacacsLabKey');finish(sim,login(sim));assert.equal(matches(sim,sessionCriterion),true);
});
test('wrong TACACS address or TCP port cannot substitute for the planned reachable server binding',()=>{
 for(const command of ['port 50','address ipv4 192.168.100.99']){const sim=load();change(sim,'tacacs server TACACS1',command);assert.equal(goal(sim,'tacacs-server'),false);finish(sim,login(sim,'rescue','RescueLab123'));assert.deepEqual(received(sim),[]);assert.equal(matches(sim,sessionCriterion),false);}
});
test('method order, protocol-specific group membership and exact named VTY bindings remain live requirements',()=>{
 const sim=load();change(sim,'aaa authentication login VTY-AUTH local group TAC-GROUP');assert.equal(goal(sim,'authentication'),false);change(sim,'aaa authentication login VTY-AUTH group TAC-GROUP local','aaa group server tacacs+ TAC-GROUP','no server name TACACS1');assert.equal(goal(sim,'server-group'),false);change(sim,'aaa group server tacacs+ TAC-GROUP','server name TACACS1','line vty 0 4','transport input all');assert.equal(goal(sim,'vty-ssh'),false);change(sim,'line vty 0 4','transport input ssh');assert.equal(goal(sim,'authentication'),true);assert.equal(goal(sim,'server-group'),true);assert.equal(goal(sim,'vty-ssh'),true);
});
test('the named local console remains usable while TACACS is unavailable and needs enable for privileged EXEC',()=>{
 const sim=load();service(sim).enabled=false;sim.changed();const cli=new IOSSession(sim,r1);assert.equal(cli.prompt,'Username:');run(cli,'rescue');assert.equal(cli.passwordInput,true);assert.match(cli.execute('wrong').join('\n'),/Authentication failed/);run(cli,'rescue','RescueLab123');assert.equal(cli.prompt,'R1>');assert.match(cli.execute('configure terminal').join('\n'),/Invalid|privilege/i);run(cli,'enable','EnableLab123');assert.equal(cli.prompt,'R1#');assert.deepEqual(requests(sim),[]);assert.deepEqual(received(sim),[]);assert.equal(goal(sim,'console-local'),true);
});
test('a received accounting Stop with no delivered ACK cannot complete the paired-session achievement',()=>{
 const sim=load(),cli=login(sim);assert.equal(deliveries(sim)[0].status,'delivered');const link=sim.lab.links.find(l=>l.id==='link-tacacs-aaa-server')!;let drop=true;sim.registerTCPService(49,d=>!!d.config.services.tacacs?.enabled,(d,payload,source)=>{const response=handleAAARequest(sim,d,'tacacs',payload,source);if(drop&&payload?.operation==='accounting'&&payload.record?.status==='stop'){drop=false;link.lossBA=1;}return response??{error:'Unavailable'};});finish(sim,cli);assert.equal(received(sim).length,2);assert.equal(matches(sim,sessionCriterion),false);sim.advance(12000);assert.equal(deliveries(sim).at(-1).status,'failed');link.lossBA=0;sim.changed();finish(sim,login(sim));assert.equal(matches(sim,sessionCriterion),true);
});
test('receiver rows must correlate target, remote source, initial privilege, session ID and both delivery event IDs',()=>{
 const sim=load();finish(sim,login(sim));assert.equal(matches(sim,sessionCriterion),true);const [start,stop]=received(sim),saved=stop.sessionId;stop.sessionId='different-session';assert.equal(matches(sim,sessionCriterion),false);stop.sessionId=saved;const event=deliveries(sim).at(-1),id=event.eventId;event.eventId='unrelated-delivery';assert.equal(matches(sim,sessionCriterion),false);event.eventId=id;for(const c of [{server:pc1},{source:r1},{device:srv},{username:'rescue'},{privilege:1}])assert.equal(matches(sim,{...sessionCriterion,...c}as Criterion),false);assert.equal(start.protocol,'tacacs');
});
test('a test aaa authentication response and local configuration alone cannot fabricate an accounted VTY session',()=>{
 const sim=load(),cli=consoleLogin(sim);const output=cli.execute('test aaa group TAC-GROUP netadmin TacacsAdmin123 legacy');assert.ok(!output.some(iosRejected),output.join('\n'));assert.ok(requests(sim).some(q=>q.operation==='authenticate'&&q.accepted));assert.deepEqual(received(sim),[]);assert.equal(matches(sim,sessionCriterion),false);
});
test('saved reopening preserves achieved traffic/session observations while rebuilding fresh AAA state and enforcing live policy',()=>{
 const sim=load();ping(sim);finish(sim,login(sim));assert.equal(lessonProgress(sim)!.complete,10);const next=fresh(sim);assert.equal(lessonProgress(next)!.complete,10);assert.deepEqual(received(next),[]);assert.deepEqual(requests(next),[]);assert.deepEqual(deliveries(next),[]);assert.equal(new IOSSession(next,r1).prompt,'Username:');change(next,'aaa accounting exec VTY-ACCT none');assert.equal(goal(next,'accounting'),false);assert.equal(goal(next,'accounted-session'),true);assert.equal(lessonProgress(next)!.complete,9);change(next,'aaa accounting exec VTY-ACCT start-stop group TAC-GROUP');finish(next,login(next));assert.equal(received(next).length,2);
});
test('startup reboot restores the saved client policy and requires a new remotely approved SSH session',()=>{
 const sim=load();change(sim,'aaa authentication login VTY-AUTH local');sim.power(r1,false);sim.power(r1,true);sim.advance(12000);assert.equal(goal(sim,'authentication'),true);assert.equal(consoleLogin(sim).prompt,'R1#');finish(sim,login(sim));assert.equal(matches(sim,sessionCriterion),true);
});
test('published verification commands show actual AAA counters, accounted actions and receiver logs without retaining credentials',()=>{
 const sim=load(),remote=login(sim),local=consoleLogin(sim),resource=catalogGuideResources(catalog)!;assert.equal(resource.rows.length,4);for(const command of resource.verification!.R1){const output=local.execute(command);assert.ok(!output.some(iosRejected),command+'\n'+output.join('\n'));}assert.match(remote.execute('show accounting').join('\n'),/Active Accounted actions/);finish(sim,remote);assert.match(local.execute('show accounting').join('\n'),/Delivered 2/);for(const secret of ['TacacsLabKey','TacacsAdmin123','RescueLab123','EnableLab123'])assert.ok(!JSON.stringify([requests(sim),received(sim),deliveries(sim)]).includes(secret));
});
test('new imported AAA criteria validate bounded data and reject unknown services, oversized methods and invalid privileges',()=>{
 const valid:Criterion[]=[{kind:'tacacs-server',device:r1,server:srv,name:'TACACS1'},{kind:'aaa-group',device:r1,name:'TAC-GROUP',serverName:'TACACS1'},{kind:'aaa-method',device:r1,service:'login',name:'VTY-AUTH',methods:['group','TAC-GROUP','local']},{kind:'aaa-line',device:r1,line:'vty 0 4',authentication:'VTY-AUTH',authorization:'VTY-EXEC',accounting:'VTY-ACCT'},sessionCriterion];for(const criterion of valid)validateLesson({title:'Test',description:'',objectives:[{id:'one',title:'One',criterion}]});const invalidBase:Record<string,unknown>[]=valid;for(const criterion of [{...invalidBase[0],name:''},{...invalidBase[0],server:42},{...invalidBase[1],serverName:'x'.repeat(129)},{...invalidBase[2],service:'evaluate'},{...invalidBase[2],methods:Array(9).fill('local')},{...invalidBase[2],methods:[42]},{...invalidBase[3],line:'vty 0 999'},{...invalidBase[3],line:'console 0'},{...sessionCriterion,privilege:16},{...sessionCriterion,source:''}])assert.throws(()=>validateLesson({title:'Test',description:'',objectives:[{id:'one',title:'One',criterion}]}));
});
