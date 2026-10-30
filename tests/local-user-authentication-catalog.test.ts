import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {localSSHLoginSnapshot} from '../src/management.ts';
import {createCatalogLab,LOCAL_USER_AUTHENTICATION_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,claimLessonCelebration,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';

const catalog='local-user-authentication',r1='device-local-auth-r1',pc1='device-local-auth-pc1',passwords={admin:'AdminLab123',operator:'OperatorLab123'},enable='EnableLab123';
function load(mode:'practice'|'completed'='completed'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab(catalog,mode))));sim.advance(1000);return sim;}
function run(cli:IOSSession,...lines:string[]){for(const line of lines){const rows=cli.execute(line);assert.ok(!rows.some(iosRejected),line+'\n'+rows.join('\n'));}}
function consoleLogin(sim:Simulator,user:'admin'|'operator'='admin'){const cli=new IOSSession(sim,r1);assert.equal(cli.prompt,'Username:');run(cli,user,passwords[user]);return cli;}
function change(sim:Simulator,...lines:string[]){const cli=consoleLogin(sim);run(cli,'configure terminal',...lines,'end');return cli;}
function login(sim:Simulator,user:'admin'|'operator',cli=new IOSSession(sim,pc1)){run(cli,`ssh -l ${user} 192.0.2.1`);assert.equal(cli.prompt,'Password:');assert.equal(cli.passwordInput,true);run(cli,passwords[user]);assert.equal(cli.prompt,'R1'+(user==='admin'?'#':'>'));return cli;}
const goal=(sim:Simulator,id:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===id)!.complete;
function ping(sim:Simulator){const p=sim.ping(pc1,'192.0.2.1',{count:3});sim.advance(4000);assert.equal(p.received,3);lessonProgress(sim);}
const fresh=(sim:Simulator)=>{const next=new Simulator();next.load(parseLabFile(serializeLabFile(sim.serialize())));next.advance(1000);return next;};

test('local-auth practice is independent, zero-credit and has two addressed nodes without users or SSH',()=>{
 const a=createCatalogLab(catalog),b=createCatalogLab(catalog);assert.notEqual(a.lab.id,b.lab.id);assert.equal(a.lab.devices.length,2);assert.equal(a.lab.links.length,1);assert.equal(a.lab.notes.length,1);assert.equal(a.lab.devices.find(d=>d.id===r1)!.config.features.users,undefined);assert.equal(LAB_CATALOG.find(l=>l.id===catalog)!.section,'Services & Security');const sim=load('practice');assert.equal(lessonProgress(sim)!.complete,0);assert.equal(new IOSSession(sim,r1).prompt,'R1>');ping(sim);assert.equal(lessonProgress(sim)!.complete,1);
});
test('published IOS configuration and completed reference earn six live goals and require two real logins plus a ping',()=>{
 const sim=load('practice'),cli=new IOSSession(sim,r1);run(cli,...COMMANDS.R1);assert.equal(lessonProgress(sim)!.complete,6);const c=load();assert.equal(lessonProgress(c)!.complete,6);ping(c);const op=login(c,'operator');run(op,'exit');assert.equal(goal(c,'operator-ssh'),true);const admin=login(c,'admin');run(admin,'exit');assert.equal(lessonProgress(c)!.complete,9);assert.equal(claimLessonCelebration(c)?.total,9);assert.equal(claimLessonCelebration(c),undefined);
});
test('fresh console prompts for a username and hidden password, rejects unknown/bad credentials and applies local privileges',()=>{
 const sim=load(),cli=new IOSSession(sim,r1);run(cli,'unknown');assert.equal(cli.passwordInput,true);assert.match(cli.execute('wrong').join('\n'),/Authentication failed/);assert.equal(cli.prompt,'Username:');run(cli,'admin');assert.match(cli.execute('wrong').join('\n'),/Authentication failed/);run(cli,'admin',passwords.admin);assert.equal(cli.prompt,'R1#');assert.match(cli.execute('show privilege').join('\n'),/level is 15/);const op=consoleLogin(sim,'operator');assert.equal(op.prompt,'R1>');assert.match(op.execute('show privilege').join('\n'),/level is 1/);assert.match(op.execute('configure terminal').join('\n'),/Invalid|privilege/i);assert.equal(localSSHLoginSnapshot(sim,r1).length,0);
});
test('SSH rejects a bad password without login credit and only accepts the matching case-sensitive local user secret',()=>{
 const sim=load(),cli=new IOSSession(sim,pc1);run(cli,'ssh -l operator 192.0.2.1');assert.equal(goal(sim,'operator-ssh'),false);assert.match(cli.execute('operatorlab123').join('\n'),/Login invalid/);assert.equal(cli.prompt,'Password:');assert.equal(goal(sim,'operator-ssh'),false);assert.deepEqual(localSSHLoginSnapshot(sim,r1),[]);run(cli,passwords.operator);assert.equal(cli.prompt,'R1>');assert.equal(goal(sim,'operator-ssh'),true);assert.ok(sim.events.some(e=>e.protocol==='TCP'&&e.packet?.source==='192.0.2.10'&&e.packet.destinationPort===22));
});
test('privilege-1 SSH cannot configure until the independent enable secret is supplied, and disable returns to user EXEC',()=>{
 const sim=load(),cli=login(sim,'operator');assert.match(cli.execute('configure terminal').join('\n'),/Invalid|privilege/i);run(cli,'enable');assert.equal(cli.passwordInput,true);assert.match(cli.execute(passwords.operator).join('\n'),/Authentication failed/);run(cli,enable);assert.equal(cli.prompt,'R1#');assert.match(cli.execute('show privilege').join('\n'),/level is 15/);run(cli,'disable');assert.equal(cli.prompt,'R1>');assert.match(cli.execute('show privilege').join('\n'),/level is 1/);run(cli,'exit');assert.equal(cli.prompt,'C:\\>');assert.equal(goal(sim,'operator-ssh'),true);
});
test('an enable secret takes precedence over a configured legacy enable password',()=>{
 const sim=load();change(sim,'enable password LegacyLab123');const cli=login(sim,'operator');run(cli,'enable');assert.match(cli.execute('LegacyLab123').join('\n'),/Authentication failed/);assert.match(cli.execute(passwords.admin).join('\n'),/Authentication failed/);run(cli,enable);assert.equal(cli.prompt,'R1#');run(cli,'configure terminal','no enable password','end');assert.equal(sim.getDevice(r1)!.config.features.enablePassword,undefined);
});
test('removing login local or allowing Telnet loses live VTY credit and cannot create local-SSH login evidence',()=>{
 const sim=load();change(sim,'line vty 0 4','password SharedLab123','login');assert.equal(goal(sim,'vty-local'),false);const cli=new IOSSession(sim,pc1);run(cli,'ssh -l operator 192.0.2.1');run(cli,'SharedLab123');assert.equal(cli.remoteConnected,true);assert.equal(goal(sim,'operator-ssh'),false);run(cli,'exit');change(sim,'line vty 0 4','login local','transport input all');assert.equal(goal(sim,'vty-local'),false);change(sim,'line vty 0 4','transport input ssh');assert.equal(goal(sim,'vty-local'),true);
});
test('missing RSA keys or disabled VTY transport prevents real SSH even with valid user configuration',()=>{
 for(const fault of ['keys','transport']){const sim=load();const cli=consoleLogin(sim);run(cli,'configure terminal');if(fault==='keys'){run(cli,'crypto key zeroize rsa');if(cli.prompt.includes('yes/no'))run(cli,'yes');}else run(cli,'line vty 0 4','transport input none');run(cli,'end');assert.equal(goal(sim,fault==='keys'?'ssh-server':'vty-local'),false);const pc=new IOSSession(sim,pc1);assert.match(pc.execute('ssh admin@192.0.2.1').join('\n'),/refused|unreachable|timed out/i);assert.equal(pc.remoteConnected,false);assert.equal(goal(sim,'admin-ssh'),false);}
});
test('the SSH-only configuration refuses Telnet and a lost link prevents new SSH without undoing earned login credit',()=>{
 const sim=load(),cli=login(sim,'admin');run(cli,'exit');assert.equal(goal(sim,'admin-ssh'),true);assert.match(cli.execute('telnet 192.0.2.1').join('\n'),/refused/i);assert.equal(cli.remoteConnected,false);sim.lab.links[0].enabled=false;sim.changed();assert.match(cli.execute('ssh admin@192.0.2.1').join('\n'),/unreachable|timed out|down/i);assert.equal(cli.remoteConnected,false);assert.equal(goal(sim,'admin-ssh'),true);assert.equal(goal(sim,'operator-ssh'),false);
});
test('login evidence is scoped to target, source, username and initial privilege; fake runtime/log entries cannot earn credit',()=>{
 const sim=load(),target=sim.getDevice(r1)!;target.runtime.features.managementSessions=['fake'];target.runtime.logs.push('User operator logged in from 192.0.2.10 on vty 0 4');assert.equal(goal(sim,'operator-ssh'),false);login(sim,'operator');assert.equal(matches(sim,{kind:'local-ssh-login',device:r1,source:pc1,username:'operator',privilege:1}),true);for(const c of [{device:pc1},{source:r1},{username:'admin'},{privilege:15}])assert.equal(matches(sim,{kind:'local-ssh-login',device:r1,source:pc1,username:'operator',privilege:1,...c}),false);
});
test('local accounts with a shared password field or inherited names cannot earn the required secret-based user goal',()=>{
 const sim=load();change(sim,'no username admin','username admin privilege 15 password AdminLab123');assert.equal(goal(sim,'admin-user'),false);const users=sim.getDevice(r1)!.config.features.users;Object.setPrototypeOf(users,{inherited:{secret:'Lab123',privilege:15}});assert.equal(matches(sim,{kind:'local-user',device:r1,username:'inherited',privilege:15}),false);assert.equal(matches(sim,{kind:'local-user',device:r1,username:'operator',privilege:15}),false);
});
test('wrong privilege cannot earn the planned account or login goal, even when SSH successfully authenticates',()=>{
 const sim=load();change(sim,'username operator privilege 15 secret OperatorLab123');const cli=new IOSSession(sim,pc1);run(cli,'ssh operator@192.0.2.1',passwords.operator);assert.equal(cli.prompt,'R1#');assert.equal(goal(sim,'operator-user'),false);assert.equal(goal(sim,'operator-ssh'),false);assert.equal(goal(sim,'admin-ssh'),false);
});
test('AAA method-list authentication does not substitute for the non-AAA line configuration or local-SSH evidence',()=>{
 const sim=load();change(sim,'aaa new-model','aaa authentication login default local','aaa authorization exec default local','line vty 0 4','login authentication default');const cli=login(sim,'admin');assert.equal(cli.prompt,'R1#');assert.equal(goal(sim,'console-local'),false);assert.equal(goal(sim,'vty-local'),false);assert.equal(goal(sim,'admin-ssh'),false);assert.deepEqual(localSSHLoginSnapshot(sim,r1),[]);
});
test('accepted login evidence is read-only, excludes passwords and is not serialized as a ready session',()=>{
 const sim=load(),cli=login(sim,'operator');run(cli,'enable',enable,'exit');const snapshot=localSSHLoginSnapshot(sim,r1);assert.equal(snapshot.length,1);assert.equal(snapshot[0].privilege,1);snapshot[0].privilege=15;assert.equal(localSSHLoginSnapshot(sim,r1)[0].privilege,1);for(const secret of Object.values(passwords).concat(enable)){assert.ok(!JSON.stringify(snapshot).includes(secret));assert.ok(!cli.history.includes(secret));}assert.deepEqual(Object.keys(snapshot[0]).sort(),['line','privilege','source','time','username']);const next=fresh(sim);assert.deepEqual(localSSHLoginSnapshot(next,r1),[]);assert.equal(next.getDevice(r1)!.runtime.features.managementSessions,undefined);
});
test('saved-lab reload keeps achieved logins and ping while live config remains required and a fresh console authenticates again',()=>{
 const sim=load();ping(sim);run(login(sim,'operator'),'exit');run(login(sim,'admin'),'exit');assert.equal(lessonProgress(sim)!.complete,9);const next=fresh(sim);assert.equal(lessonProgress(next)!.complete,9);assert.deepEqual(localSSHLoginSnapshot(next,r1),[]);assert.equal(new IOSSession(next,r1).prompt,'Username:');change(next,'no username admin');assert.equal(goal(next,'admin-user'),false);assert.equal(goal(next,'admin-ssh'),true);assert.equal(lessonProgress(next)!.complete,8);
});
test('startup reboot reconstructs authentication from saved settings and discards transient login evidence',()=>{
 const sim=load();run(login(sim,'admin'),'exit');assert.equal(localSSHLoginSnapshot(sim,r1).length,1);change(sim,'username admin privilege 15 secret UnsavedLab123');sim.power(r1,false);sim.power(r1,true);sim.advance(12000);assert.deepEqual(localSSHLoginSnapshot(sim,r1),[]);assert.equal(consoleLogin(sim).prompt,'R1#');assert.equal(login(sim,'admin').prompt,'R1#');
});
test('VTY coverage accepts a safe 0–15 range but rejects missing lines, bypasses and extra Telnet listeners',()=>{
 const sim=load(),f=sim.getDevice(r1)!.config.features;f.lines={'console 0':{login:'local'},'vty 0 15':{login:'local',transport:'ssh'}};assert.equal(goal(sim,'vty-local'),true);f.lines['vty 0 15'].transport='none';assert.equal(goal(sim,'vty-local'),false);f.lines['vty 0 15'].transport='ssh';f.lines['vty 5 15']={login:'local',transport:'telnet'};assert.equal(goal(sim,'vty-local'),false);delete f.lines['vty 5 15'];f.lines['vty 0 15'].login=undefined;assert.equal(goal(sim,'vty-local'),false);
});
test('imported local-auth criteria are bounded declarative data and reject invalid privileges, settings or identifiers',()=>{
 const valid:Criterion[]=[{kind:'local-user',device:r1,username:'admin',privilege:15},{kind:'local-management',device:r1,setting:'ssh-server'},{kind:'local-ssh-login',device:r1,source:pc1,username:'operator',privilege:1}];for(const criterion of valid)validateLesson({title:'Test',description:'',objectives:[{id:'one',title:'One',criterion}]});for(const criterion of [{...valid[0],privilege:16},{...valid[0],username:''},{...valid[0],username:'x'.repeat(129)},{...valid[0],privilege:'15'},{...valid[1],setting:'eval'},{...valid[2],source:''},{...valid[2],privilege:-1}])assert.throws(()=>validateLesson({title:'Test',description:'',objectives:[{id:'one',title:'One',criterion}]}));
});
test('all published show and Windows verification commands report working local access and actual sessions',()=>{
 const sim=load(),pc=login(sim,'admin'),cli=consoleLogin(sim),resources=catalogGuideResources(catalog)!;assert.equal(resources.rows.length,2);for(const command of resources.verification!.R1){const output=cli.execute(command);assert.ok(!output.some(iosRejected),command+'\n'+output.join('\n'));}assert.match(cli.execute('show users').join('\n'),/admin/);assert.match(cli.execute('show ssh').join('\n'),/admin/);run(pc,'exit');for(const command of resources.verification!.PC1){const output=pc.execute(command);assert.doesNotMatch(output.join('\n'),/not recognized|Error:/i);}assert.ok(!sim.events.some(e=>e.protocol==='RADIUS'||e.protocol==='TACACS'));
});
