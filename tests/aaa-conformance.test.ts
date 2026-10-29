import {test} from 'node:test';
import {iosRejected} from '../src/ios-help.ts';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {NSOSSession} from '../src/nsos.ts';
import {serializeLabFile,parseLabFile} from '../src/persistence.ts';
function ok(cli:IOSSession|NSOSSession,...commands:string[]){for(const c of commands){const out=cli.execute(c);assert.ok(!out.some(iosRejected),`${c}: ${out.join('\n')}`);}}
function fixture(nx=false){
 const e=new Simulator(684524),nas=e.addDevice(nx?'datacenter':'router'),server=e.addDevice('router'),cli=nx?new NSOSSession(e,nas.id,{skipConsoleLogin:true}):new IOSSession(e,nas.id),client=new IOSSession(e,server.id);
 e.connect({deviceId:nas.id,port:nx?'mgmt0':'GigabitEthernet0/0'},{deviceId:server.id,port:'GigabitEthernet0/0'});
 ok(client,'enable','conf t','int g0/0','ip address 192.0.2.10 255.255.255.0','no shut','end');
 if(nx)ok(cli,'conf t','username fallback password local-pass role network-admin','int mgmt0','ip address 192.0.2.1/24','no shut','end');
 else ok(cli,'enable','conf t','int g0/0','ip address 192.0.2.1 255.255.255.0','no shut','exit','ip domain name netsim.test','crypto key generate rsa modulus 2048','username fallback privilege 15 secret local-pass','aaa new-model','line vty 0 4','transport input ssh','login authentication default','end');
 for(const p of ['radius','tacacs'])server.config.services[p]={enabled:true,secret:'shared',users:{remote:{password:'remote-pass',privilege:15,role:'network-admin'},viewer:{password:'op-pass',privilege:1,role:'network-operator'}}};
 const configure=(protocol:'radius'|'tacacs',key='shared')=>{
  if(nx)ok(cli,'conf t',...protocol==='tacacs'?['feature tacacs+']:[],`${protocol}-server host 192.0.2.10 key 0 ${key}`,`${protocol}-server host 192.0.2.10 timeout 1`,`aaa group server ${protocol==='tacacs'?'tacacs+':'radius'} AUTH`,'server 192.0.2.10','use-vrf management','exit','aaa authentication login default group AUTH','end');
  else ok(cli,'conf t',`${protocol} server AUTH-SERVER`,'address ipv4 192.0.2.10',`key ${key}`,'timeout 1','exit',`aaa group server ${protocol==='tacacs'?'tacacs+':'radius'} AUTH`,'server name AUTH-SERVER','exit','aaa authentication login default group AUTH local','aaa authorization exec default group AUTH local','end');
 };
 const login=(user='remote',password='remote-pass')=>{ok(client,`ssh -l ${user} 192.0.2.1`);return client.execute(password);};
 return {e,nas,server,cli,client,configure,login};
}
for(const nx of [false,true])for(const protocol of ['radius','tacacs'] as const){
 test(`AAA native ${nx?'NX-OS':'IOS'} ${protocol}: packet authentication, privilege/role, authoritative rejection and protocol-error fallback`,()=>{
  const f=fixture(nx);f.configure(protocol);assert.deepEqual(f.login(),[]);assert.equal(f.client.prompt,`${f.nas.config.hostname}#`);ok(f.client,'configure terminal','end','exit');
  assert.ok(f.e.events.some(ev=>ev.packet?.destinationPort===(protocol==='radius'?1812:49)));
  assert.match(f.login('fallback','local-pass').join('\n'),/Login invalid/);assert.equal(f.client.prompt,'Password:');f.client.cancel();
  // Rebuild after failed SSH rather than treating a password prompt as EXEC.
  const g=fixture(nx);g.configure(protocol,'incorrect-key');assert.deepEqual(g.login('fallback','local-pass'),[]);assert.equal(g.client.prompt,`${g.nas.config.hostname}#`);
  const stats=g.nas.runtime.features.aaaClientStats;assert.ok(Object.values<any>(stats).some(v=>v.errors>0));assert.equal(g.server.runtime.features.aaaRequests.filter((r:any)=>r.accepted).length,0);
 });
}
test('AAA RADIUS EXEC attributes are cached per successful login, with no invented authorization packet',()=>{
 const f=fixture();f.configure('radius');assert.deepEqual(f.login(),[]);const requests=f.server.runtime.features.aaaRequests;assert.equal(requests.length,1);assert.equal(requests[0].operation,'authenticate');
 const output=f.cli.execute('show radius statistics').join('\n');assert.match(output,/Access Accepts\s*:\s*1/);assert.doesNotMatch(output,/Local server requests received/);
 ok(f.client,'exit');f.server.config.services.radius.users.remote.authorization=false;assert.match(f.login().join('\n'),/EXEC authorization failed/);
});
test('AAA TACACS separates authentication and EXEC denial, and denial never starts accounting',()=>{
 const f=fixture();f.configure('tacacs');f.server.config.services.tacacs.users.remote.authorization=false;ok(f.cli,'conf t','aaa accounting exec default start-stop group AUTH','end');assert.match(f.login().join('\n'),/EXEC authorization failed/);
 assert.deepEqual(f.server.runtime.features.aaaRequests.map((r:any)=>[r.operation,r.accepted]),[['authenticate',true],['authorize',false]]);assert.equal(f.server.runtime.features.aaaAccountingReceived,undefined);
});
test('AAA NX-OS roles come from remote attributes; a same-name local account takes precedence over remote role attributes',()=>{
 const f=fixture(true);ok(f.cli,'conf t','username viewer password different role network-admin','end');f.configure('radius');assert.deepEqual(f.login('viewer','op-pass'),[]);ok(f.client,'configure terminal','hostname LocalRoleWins','end');assert.equal(f.nas.config.hostname,'LocalRoleWins');
});
test('AAA native grammar and NVGEN round-trip preserve groups and management VRF; IOS forms fail on NX-OS',()=>{
 const f=fixture(true);f.configure('tacacs');const before=JSON.stringify(f.nas.config);for(const c of ['aaa new-model','tacacs server TACACS1','aaa authentication login default group AUTH local','aaa accounting exec default start-stop group AUTH']){assert.ok(f.cli.execute(c).some(s=>s.startsWith('%')),c);assert.equal(JSON.stringify(f.nas.config),before);}
 const text=f.cli.execute('show running-config').join('\n');assert.match(text,/feature tacacs\+/);assert.match(text,/tacacs-server host 192.0.2.10 key 0 shared/);assert.match(text,/use-vrf management/);assert.doesNotMatch(text,/group AUTH local/);
 const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(f.e.serialize())));assert.deepEqual(restored.getDevice(f.nas.id)!.config.features.aaa,f.nas.config.features.aaa);
 const dst=restored.addDevice('datacenter'),cli=new NSOSSession(restored,dst.id,{skipConsoleLogin:true});ok(cli,'conf t',...text.split('\n'));assert.deepEqual(dst.config.features.aaa,f.nas.config.features.aaa);
});
test('AAA IOS rejects RADIUS command authorization transactionally and keeps server/group protocols distinct',()=>{
 const f=fixture();f.configure('radius');ok(f.cli,'conf t');for(const c of ['aaa authorization commands 15 default group AUTH','aaa authorization commands 15 default group radius','tacacs server AUTH-SERVER','aaa group server tacacs+ AUTH']){const before=JSON.stringify(f.nas.config);assert.ok(f.cli.execute(c).some(s=>s.startsWith('%')),c);assert.equal(JSON.stringify(f.nas.config),before);}
});
for(const protocol of ['radius','tacacs'] as const)test(`AAA NX-OS ${protocol} accounting default sends acknowledged EXEC Start/Stop and configuration records`,()=>{
 const f=fixture(true);f.configure(protocol);ok(f.cli,'conf t','aaa accounting default group AUTH','end');assert.deepEqual(f.login(),[]);f.e.advance(500);
 ok(f.client,'configure terminal','interface mgmt0','description Accounted','end','exit');f.e.advance(1000);
 const records=f.server.runtime.features.aaaAccountingReceived;assert.ok(records.some((r:any)=>r.kind==='exec'&&r.status==='start'));assert.ok(records.some((r:any)=>r.kind==='exec'&&r.status==='stop'));assert.ok(records.some((r:any)=>r.kind==='commands'&&r.command==='description Accounted'));assert.ok(records.every((r:any)=>r.platform==='nxos'));assert.equal(new Set(records.map((r:any)=>r.eventId)).size,records.length);
 assert.ok(f.nas.runtime.features.aaaAccountingEvents.every((r:any)=>r.status==='delivered'));assert.match(f.cli.execute('show aaa accounting').join('\n'),/default: group AUTH/);
});
test('AAA NX-OS TACACS queries EXEC role attributes separately; a denied role grant uses the native default operator role',()=>{
 const f=fixture(true);f.configure('tacacs');f.server.config.services.tacacs.users.remote.authorization=false;assert.deepEqual(f.login(),[]);ok(f.client,'configure terminal');assert.match(f.client.execute('hostname Forbidden').join('\n'),/Permission denied/);assert.equal(f.nas.config.hostname,'DC1');
 assert.deepEqual(f.server.runtime.features.aaaRequests.map((r:any)=>[r.operation,r.accepted]),[['authenticate',true],['authorize',false]]);
});
test('AAA NX-OS VRF selection controls the real route; reserved system usernames are rejected',()=>{
 const f=fixture(true);f.configure('tacacs');ok(f.cli,'conf t','aaa group server tacacs+ AUTH','use-vrf default','exit','end');assert.deepEqual(f.login('fallback','local-pass'),[]);assert.equal(f.server.runtime.features.aaaRequests,undefined);
 ok(f.cli,'conf t');const before=JSON.stringify(f.nas.config);assert.match(f.cli.execute('username operator password x role network-admin').join('\n'),/Reserved/);assert.equal(JSON.stringify(f.nas.config),before);
});
