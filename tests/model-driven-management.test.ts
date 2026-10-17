import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { basicAuthorization } from '../src/http-service.ts';
import type { TCPChannel } from '../src/tcp-channel.ts';

const NC='urn:ietf:params:xml:ns:netconf:base:1.0',IF='urn:ietf:params:xml:ns:yang:ietf-interfaces',NATIVE='http://cisco.com/ns/yang/Cisco-IOS-XE-native';
const advance=(e:Simulator,ms=500)=>e.advance(ms,200000);
function lab(){
 const e=new Simulator(1712),pc=e.addDevice('pc'),r=e.addDevice('router'),server=e.addDevice('server');
 e.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:r.id,port:'GigabitEthernet0/0'});e.connect({deviceId:r.id,port:'GigabitEthernet0/1'},{deviceId:server.id,port:'GigabitEthernet0'});
 Object.assign(pc.config.interfaces.GigabitEthernet0,{ip:'10.0.0.10',mask:'255.255.255.0'});pc.config.defaultGateway='10.0.0.1';Object.assign(server.config.interfaces.GigabitEthernet0,{ip:'10.0.1.100',mask:'255.255.255.0'});server.config.defaultGateway='10.0.1.1';
 const cli=new IOSSession(e,r.id);for(const line of ['enable','conf t','interface g0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','interface g0/1','ip address 10.0.1.1 255.255.255.0','no shutdown','exit','username admin privilege 15 secret labpassword','username limited privilege 1 secret limited','netconf-yang','restconf','ip http secure-server','ip http authentication local','end']){const out=cli.execute(line).join('\n');assert.ok(!out.includes('Invalid'),line+': '+out);}
 e.changed();return{e,pc,r,server,cli};
}
function rest(f:ReturnType<typeof lab>,path:string,method:'GET'|'PUT'|'PATCH'|'POST'|'DELETE'='GET',body?:Record<string,unknown>,credentials=true){
 const response=f.e.httpRequest(f.pc.id,'https://10.0.0.1'+path,{method,headers:credentials?{Authorization:basicAuthorization('admin','labpassword'),'Content-Type':'application/yang-data+json'}:{},body});advance(f.e,1000);return response;
}
function netconf(f:ReturnType<typeof lab>,user='admin',password='labpassword'){
 const messages:any[]=[],closed:string[]=[];let channel:TCPChannel;channel=f.e.connectTCPChannel(f.pc.id,'10.0.0.1',830,{onOpen:c=>c.send({type:'ssh-auth',username:user,password}),onMessage:message=>{messages.push(message);if(typeof message==='string'&&message.startsWith('<hello'))channel.send(`<hello xmlns="${NC}"><capabilities><capability>urn:ietf:params:netconf:base:1.0</capability></capabilities></hello>]]>]]>`);},onClose:reason=>closed.push(reason)});advance(f.e,1000);
 let sequence=0;return{channel,messages,closed,rpc(operation:string,ms=300){const id=String(++sequence);channel.send(`<rpc xmlns="${NC}" message-id="${id}">${operation}</rpc>]]>]]>`);advance(f.e,ms);return messages.findLast(m=>typeof m==='string'&&m.includes(`message-id="${id}"`)) as string|undefined;}};
}
const edit=(hostname:string,target='candidate')=>`<edit-config><target><${target}/></target><config><native xmlns="${NATIVE}"><hostname>${hostname}</hostname></native></config></edit-config>`;

test('MGMT-MON-01 show netconf-yang reports delivered authenticated sessions and actual candidate lock ownership',()=>{const f=lab();assert.match(f.cli.execute('show netconf-yang sessions').join('\n'),/Number of sessions : 0/);for(const line of['conf t','netconf-yang feature candidate-datastore','end'])f.cli.execute(line);const session=netconf(f),snapshot=f.e.modelDriven.sessionSnapshot(f.r.id);assert.equal(snapshot.length,1);assert.match(session.rpc('<lock><target><candidate/></target></lock>')!,/<ok\/>/);const output=f.cli.execute('show netconf-yang sessions').join('\n');assert.match(output,/Number of sessions : 1/);assert.match(output,/admin\s+10\.0\.0\.10\s+C/);assert.match(f.cli.execute('show netconf-yang datastores').join('\n'),new RegExp('Globally Locked By Session : '+snapshot[0].sessionId));assert.match(f.cli.execute('show netconf-yang sessions detail').join('\n'),/username : admin/);assert.match(f.cli.help('show netconf-yang sessions ').join('\n'),/session-id/);assert.match(f.cli.execute('show netconf-yang sessions detail garbage').join('\n'),/Invalid/);session.channel.close();advance(f.e);assert.match(f.cli.execute('show netconf-yang sessions').join('\n'),/Number of sessions : 0/);});

test('MD-01 RESTCONF GET uses authenticated delivered HTTPS and reports real interface/counter state',()=>{
 const f=lab();assert.equal(rest(f,'/restconf/data/ietf-interfaces:interfaces','GET',undefined,false).statusCode,401);
 const result=rest(f,'/restconf/data/ietf-interfaces:interfaces');assert.equal(result.statusCode,200);const data=JSON.parse(result.content),port=data['ietf-interfaces:interfaces'].interface.find((p:any)=>p.name==='GigabitEthernet0/0');assert.equal(port['oper-status'],'up');assert.ok(+port.statistics['in-octets']>0);assert.ok(f.e.events.some(x=>x.packet?.destinationPort===443&&x.packet?.tcpFlags==='SYN'));
 const low=f.e.httpRequest(f.pc.id,'https://10.0.0.1/restconf/data',{headers:{Authorization:basicAuthorization('limited','limited')}});advance(f.e,1000);assert.equal(low.statusCode,401);
 f.cli.execute('conf t');f.cli.execute('no restconf');f.cli.execute('end');assert.equal(rest(f,'/restconf/data').statusCode,404);
});

test('MD-02 RESTCONF interface edits affect routed traffic and invalid multi-edit transactions roll back',()=>{
 const f=lab();const before=f.e.ping(f.pc.id,'10.0.1.100',{count:1});advance(f.e,1000);assert.equal(before.received,1);
 const path='/restconf/data/ietf-interfaces:interfaces/interface=GigabitEthernet0%2F1/enabled';assert.equal(rest(f,path,'PUT',{'ietf-interfaces:enabled':false}).statusCode,204);assert.equal(f.r.config.interfaces['GigabitEthernet0/1'].adminUp,false);const failed=f.e.ping(f.pc.id,'10.0.1.100',{count:1,timeout:100});advance(f.e,500);assert.equal(failed.received,0);
 assert.equal(rest(f,path,'PATCH',{'ietf-interfaces:enabled':true}).statusCode,204);const recovered=f.e.ping(f.pc.id,'10.0.1.100',{count:1});advance(f.e,1000);assert.equal(recovered.received,1);
 const snapshot=JSON.stringify(f.r.config);const invalid=rest(f,'/restconf/data/ietf-interfaces:interfaces','PATCH',{'ietf-interfaces:interfaces':{interface:[{name:'GigabitEthernet0/1',enabled:false},{name:'Loopback1','ietf-ip:ipv4':{address:[{ip:'bad',netmask:'255.255.255.0'}]}}]}});assert.equal(invalid.statusCode,400);assert.equal(JSON.stringify(f.r.config),snapshot);
});

test('MD-03 RESTCONF native hostname and virtual interface changes share CLI, save/load and reload state',()=>{
 const f=lab();assert.equal(rest(f,'/restconf/data/Cisco-IOS-XE-native:native/hostname','PUT',{'Cisco-IOS-XE-native:hostname':'Automated'}).statusCode,204);assert.equal(f.r.config.hostname,'Automated');assert.match(f.cli.prompt,/Automated/);
 const created=rest(f,'/restconf/data/ietf-interfaces:interfaces','POST',{'ietf-interfaces:interface':[{name:'Loopback8',description:'Managed by API',enabled:true,'ietf-ip:ipv4':{address:[{ip:'192.0.2.8','prefix-length':32}]}}]});assert.equal(created.statusCode,201);assert.ok(f.e.routes(f.r.id).some(r=>r.network==='192.0.2.8'));assert.match(f.cli.execute('show running-config').join('\n'),/Managed by API/);
 f.cli.execute('write memory');const saved=f.e.serialize(),fresh=new Simulator();fresh.load(saved);assert.equal(fresh.getDevice(f.r.id)!.config.hostname,'Automated');assert.equal(fresh.getDevice(f.r.id)!.config.interfaces.Loopback8.ip,'192.0.2.8');assert.equal(fresh.getDevice(f.r.id)!.runtime.features.modelDriven,undefined);
 f.e.reload(f.r.id);assert.equal(f.r.config.hostname,'Automated');assert.equal(f.r.config.interfaces.Loopback8.ip,'192.0.2.8');
 assert.equal(rest(f,'/restconf/data/ietf-interfaces:interfaces/interface=Loopback8','DELETE').statusCode,204);assert.equal(f.r.config.interfaces.Loopback8,undefined);
});

test('MD-04 normal inbound ACL and HTTP access-class enforce RESTCONF reachability independently of credentials',()=>{
 const f=lab();for(const line of ['conf t','ip access-list standard WEB','deny host 10.0.0.10','permit any','exit','ip http access-class WEB','end'])f.cli.execute(line);assert.equal(rest(f,'/restconf/data').statusCode,403);
 for(const line of ['conf t','no ip http access-class','ip access-list extended API','deny tcp any any eq 443','permit ip any any','exit','interface g0/0','ip access-group API in','end'])f.cli.execute(line);const blocked=rest(f,'/restconf/data');assert.equal(blocked.status,'failure');assert.ok(Object.values<number>(f.r.runtime.features.aclHits??{}).some(n=>n>0));
});

test('MD-05 NETCONF authenticates over a persistent TCP830 session and reads real XML configuration',()=>{
 const f=lab(),bad=netconf(f,'admin','wrong');assert.ok(bad.messages.some(m=>m?.type==='ssh-auth-result'&&m.accepted===false));assert.ok(!bad.messages.some(m=>typeof m==='string'&&m.includes('<hello')));bad.channel.close();
 const session=netconf(f);assert.ok(session.messages.some(m=>typeof m==='string'&&m.includes('writable-running')));const reply=session.rpc('<get-config><source><running/></source><filter type="subtree"><interfaces xmlns="'+IF+'"><interface><name>GigabitEthernet0/1</name></interface></interfaces></filter></get-config>');assert.match(reply!,/<name>GigabitEthernet0\/1<\/name>/);assert.ok(!reply!.includes('<oper-status>'));assert.ok(f.e.events.some(x=>x.packet?.destinationPort===830&&x.packet?.messageType?.startsWith('tcp-channel')));
 assert.match(session.rpc(edit('ViaNETCONF','running'))!,/<ok\/>/);assert.equal(f.r.config.hostname,'ViaNETCONF');assert.match(session.rpc('<get><filter><native xmlns="'+NATIVE+'"><hostname/></native></filter></get>')!,/ViaNETCONF/);
});

test('MD-06 candidate is gated, isolated, shared and locked; commit applies, discard and session close release state',()=>{
 const f=lab(),initial=netconf(f);assert.match(initial.rpc(edit('Blocked'))!,/operation-not-supported/);initial.channel.close();advance(f.e);
 for(const line of ['conf t','netconf-yang feature candidate-datastore','end'])f.cli.execute(line);const a=netconf(f),b=netconf(f);assert.match(a.rpc('<lock><target><candidate/></target></lock>')!,/<ok\/>/);assert.match(a.rpc(edit('Candidate'))!,/<ok\/>/);assert.equal(f.r.config.hostname,'R1');assert.match(b.rpc(edit('Intruder'))!,/in-use/);assert.match(a.rpc('<get-config><source><candidate/></source></get-config>')!,/Candidate/);
 assert.match(a.rpc('<commit/>')!,/<ok\/>/);assert.equal(f.r.config.hostname,'Candidate');assert.match(a.rpc(edit('DiscardMe'))!,/<ok\/>/);assert.match(a.rpc('<discard-changes/>')!,/<ok\/>/);assert.match(a.rpc('<get-config><source><candidate/></source></get-config>')!,/Candidate/);assert.equal(f.r.config.hostname,'Candidate');a.channel.close();advance(f.e);assert.match(b.rpc('<lock><target><candidate/></target></lock>')!,/<ok\/>/);
});

test('MD-07 confirmed commit times out through simulation clock and restores actual forwarding; confirmation persists',()=>{
 const f=lab();for(const line of ['conf t','netconf-yang feature candidate-datastore','end'])f.cli.execute(line);const a=netconf(f);
 const disable=`<edit-config><target><candidate/></target><config><interfaces xmlns="${IF}"><interface><name>GigabitEthernet0/1</name><enabled>false</enabled></interface></interfaces></config></edit-config>`;assert.match(a.rpc(disable)!,/<ok\/>/);assert.match(a.rpc('<commit><confirmed/><confirm-timeout>2</confirm-timeout></commit>')!,/<ok\/>/);assert.equal(f.r.config.interfaces['GigabitEthernet0/1'].adminUp,false);advance(f.e,2100);assert.equal(f.r.config.interfaces['GigabitEthernet0/1'].adminUp,true);const ping=f.e.ping(f.pc.id,'10.0.1.100',{count:1});advance(f.e,500);assert.equal(ping.received,1);
 assert.match(a.rpc(edit('Confirmed'))!,/<ok\/>/);assert.match(a.rpc('<commit><confirmed/><confirm-timeout>2</confirm-timeout></commit>')!,/<ok\/>/);assert.match(a.rpc('<commit/>')!,/<ok\/>/);advance(f.e,2500);assert.equal(f.r.config.hostname,'Confirmed');
});

test('MD-08 session failure rolls back unconfirmed commit and power/reset clears locks, candidate and callbacks',()=>{
 const f=lab();for(const line of ['conf t','netconf-yang feature candidate-datastore','end'])f.cli.execute(line);f.cli.execute('write memory');const a=netconf(f);a.rpc(edit('Unconfirmed'));a.rpc('<commit><confirmed/><confirm-timeout>10</confirm-timeout></commit>');assert.equal(f.r.config.hostname,'Unconfirmed');a.channel.close();advance(f.e);assert.equal(f.r.config.hostname,'R1');
 const b=netconf(f);b.rpc('<lock><target><candidate/></target></lock>');b.rpc(edit('NeverCommit'));f.e.power(f.r.id,false);f.e.power(f.r.id,true);advance(f.e,1000);assert.equal(f.r.config.hostname,'R1');const c=netconf(f);assert.match(c.rpc('<lock><target><candidate/></target></lock>')!,/<ok\/>/);assert.match(c.rpc('<get-config><source><candidate/></source></get-config>')!,/<hostname>R1<\/hostname>/);advance(f.e,15000);assert.equal(f.r.config.hostname,'R1');
});

test('MD-09 invalid XML/unknown model/partial edits never mutate running state; NETCONF disable terminates sessions',()=>{
 const f=lab(),a=netconf(f),before=JSON.stringify(f.r.config);assert.match(a.rpc('<edit-config><target><running/></target><config><native xmlns="'+NATIVE+'"><hostname>Valid</hostname></native><unknown xmlns="urn:unsupported"/></config></edit-config>')!,/rpc-error/);assert.equal(JSON.stringify(f.r.config),before);a.channel.send('<!DOCTYPE rpc [<!ENTITY x SYSTEM "file:///etc/passwd">]><rpc/>');advance(f.e);assert.ok(a.messages.some(m=>typeof m==='string'&&m.includes('malformed-message')));
 f.cli.execute('conf t');f.cli.execute('no netconf-yang');f.cli.execute('end');advance(f.e,500);assert.ok(a.closed.length>0);assert.equal(f.r.runtime.features.modelDriven?.locks.running,undefined);const no=netconf(f);assert.ok(!no.messages.some(m=>typeof m==='string'&&m.includes('<hello')));
});

test('MD-10 NETCONF and RESTCONF AAA accounts authenticate through the real RADIUS server and preserve privilege requirements',()=>{
 const f=lab();f.server.config.services.radius={enabled:true,secret:'shared',users:{remote:{password:'remotepass',privilege:15},limited:{password:'limited',privilege:1}}};
 for(const line of ['conf t','radius server RAD','address ipv4 10.0.1.100 auth-port 1812','key shared','exit','aaa group server radius AUTH','server name RAD','exit','aaa new-model','aaa authentication login default group AUTH','ip http authentication aaa','end'])f.cli.execute(line);
 const a=netconf(f,'remote','remotepass');assert.ok(a.messages.some(m=>m?.type==='ssh-auth-result'&&m.accepted));const response=f.e.httpRequest(f.pc.id,'https://10.0.0.1/restconf/data/Cisco-IOS-XE-native:native/hostname',{headers:{Authorization:basicAuthorization('remote','remotepass')}});advance(f.e,1500);assert.equal(response.statusCode,200);assert.ok(f.server.runtime.features.aaaRequests.some((r:any)=>r.username==='remote'&&r.accepted));assert.ok(f.e.events.some(x=>x.packet?.destinationPort===1812));
 const low=netconf(f,'limited','limited');assert.ok(low.messages.some(m=>m?.type==='ssh-auth-result'&&!m.accepted));
});

test('MD-11 strict RESTCONF list/leaf encoding rejects ignored fields and deletion of a leaf preserves its interface',()=>{
 const f=lab(),path='/restconf/data/ietf-interfaces:interfaces/interface=GigabitEthernet0%2F1';const read=JSON.parse(rest(f,path).content);assert.ok(Array.isArray(read['ietf-interfaces:interface']));assert.equal(read['ietf-interfaces:interface'][0].name,'GigabitEthernet0/1');
 const before=JSON.stringify(f.r.config);assert.equal(rest(f,path,'PATCH',{'ietf-interfaces:interface':[{name:'GigabitEthernet0/1',enabled:false}],ignored:true}).statusCode,400);assert.equal(JSON.stringify(f.r.config),before);
 assert.equal(rest(f,path+'/description','PUT',{'ietf-interfaces:description':'Temporary description'}).statusCode,204);assert.equal(rest(f,path+'/description','DELETE').statusCode,204);assert.equal(f.r.config.interfaces['GigabitEthernet0/1'].description,'');assert.equal(f.r.config.interfaces['GigabitEthernet0/1'].ip,'10.0.1.1');
 const badType=f.e.httpRequest(f.pc.id,'https://10.0.0.1'+path,{method:'PATCH',headers:{Authorization:basicAuthorization('admin','labpassword'),'Content-Type':'application/yang-data+xml'},body:'<interface/>'});advance(f.e,1000);assert.equal(badType.statusCode,415);
 assert.equal(rest(f,path+'?depth=1').statusCode,400);
});

test('MD-12 candidate mode changes terminate sessions, NETCONF ACLs block delivery, and stale candidate edits never overwrite CLI changes',()=>{
 const f=lab(),a=netconf(f);f.cli.execute('conf t');f.cli.execute('netconf-yang feature candidate-datastore');f.cli.execute('end');advance(f.e);assert.ok(a.closed.length>0);
 const b=netconf(f);assert.match(b.rpc(edit('Stale'))!,/<ok\/>/);f.cli.execute('conf t');f.cli.execute('hostname ConcurrentCLI');f.cli.execute('end');assert.match(b.rpc('<commit/>')!,/in-use/);assert.equal(f.r.config.hostname,'ConcurrentCLI');assert.match(b.rpc('<discard-changes/>')!,/<ok\/>/);
 for(const line of ['conf t','ip access-list extended NC','deny tcp any any eq 830','permit ip any any','exit','interface g0/0','ip access-group NC in','end'])f.cli.execute(line);const blocked=netconf(f);assert.equal(blocked.messages.length,0);assert.ok(Object.values<number>(f.r.runtime.features.aclHits??{}).some(n=>n>0));
});

test('MD-13 NETCONF idle session expiry uses virtual time and releases candidate locks',()=>{
 const f=lab();f.cli.execute('conf t');f.cli.execute('netconf-yang feature candidate-datastore');f.cli.execute('end');const a=netconf(f);a.rpc('<lock><target><candidate/></target></lock>');a.rpc(edit('IdleDraft'));advance(f.e,119000);assert.equal(a.closed.length,0);advance(f.e,2000);assert.ok(a.closed.length>0);assert.equal(f.r.runtime.features.modelDriven.locks.candidate,undefined);assert.equal(f.r.runtime.features.modelDriven.candidate,undefined);assert.deepEqual(f.e.modelDriven.sessionSnapshot(f.r.id),[]);assert.equal(f.r.config.hostname,'R1');
});

test('MD-14 all five IOS XE teaching node profiles expose authenticated NETCONF and RESTCONF endpoints from actual interfaces',()=>{
 for(const kind of ['router','switch','l3switch','poeswitch','wlc'] as const){
  const e=new Simulator(1712),pc=e.addDevice('pc'),d=e.addDevice(kind),physical=Object.keys(d.config.interfaces)[0],ipPort=['switch','l3switch','poeswitch'].includes(kind)?'Vlan1':physical;
  e.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:d.id,port:physical});Object.assign(pc.config.interfaces.GigabitEthernet0,{ip:'10.5.0.10',mask:'255.255.255.0'});const cli=new IOSSession(e,d.id);
  for(const line of ['enable','conf t',...['switch','l3switch','poeswitch'].includes(kind)?['interface '+physical,'spanning-tree portfast']:[],'interface '+ipPort,'ip address 10.5.0.1 255.255.255.0','no shutdown','exit','username admin privilege 15 secret labpassword','netconf-yang','restconf','ip http secure-server','ip http authentication local','end'])assert.ok(!cli.execute(line).join('\n').includes('Invalid'),kind+': '+line);
  const http=e.httpRequest(pc.id,'https://10.5.0.1/restconf/data/Cisco-IOS-XE-native:native/hostname',{headers:{Authorization:basicAuthorization('admin','labpassword')}});advance(e,1000);assert.equal(http.statusCode,200,kind);assert.equal(JSON.parse(http.content)['Cisco-IOS-XE-native:hostname'],d.config.hostname);
  const replies:any[]=[];let channel:TCPChannel;channel=e.connectTCPChannel(pc.id,'10.5.0.1',830,{onOpen:c=>c.send({type:'ssh-auth',username:'admin',password:'labpassword'}),onMessage:message=>{replies.push(message);if(typeof message==='string'&&message.startsWith('<hello')){channel.send(`<hello xmlns="${NC}"><capabilities><capability>urn:ietf:params:netconf:base:1.0</capability></capabilities></hello>]]>]]>`);channel.send(`<rpc xmlns="${NC}" message-id="14"><get-config><source><running/></source></get-config></rpc>]]>]]>`);}}});advance(e,1500);assert.ok(replies.some(m=>typeof m==='string'&&m.includes('message-id="14"')&&m.includes('<hostname>'+d.config.hostname+'</hostname>')),kind);channel.close();
 }
});

test('MD-15 NETCONF namespace/duplicate field validation and prototype-like interface keys reject without side effects',()=>{
 const f=lab(),a=netconf(f),before=JSON.stringify(f.r.config);
 assert.match(a.rpc(`<edit-config><target><running/></target><config><interfaces xmlns="${IF}"><interface><name>GigabitEthernet0/1</name><enabled>true</enabled><enabled>false</enabled></interface></interfaces></config></edit-config>`)!,/rpc-error/);
 assert.match(a.rpc(`<edit-config><target xmlns="urn:unsupported"><running/></target><config><native xmlns="${NATIVE}"><hostname>WrongNS</hostname></native></config></edit-config>`)!,/rpc-error/);
 assert.match(a.rpc(`<edit-config><target><running/></target><config><interfaces xmlns="${IF}"><interface><name>GigabitEthernet0/1</name><type xmlns:iana="urn:wrong">iana:ethernetCsmacd</type></interface></interfaces></config></edit-config>`)!,/unknown-namespace/);
 for(const name of ['__proto__','constructor','toString']){assert.equal(rest(f,'/restconf/data/ietf-interfaces:interfaces/interface='+name,'PATCH',{'ietf-interfaces:interface':[{name,enabled:false}]}).statusCode,404);}
 assert.equal(JSON.stringify(f.r.config),before);assert.equal(({} as any).adminUp,undefined);
});

test('MD-16 lightweight AP does not advertise or accept unavailable model-driven service commands',()=>{
 const e=new Simulator(),ap=e.addDevice('ap'),pse=e.addDevice('poeswitch');e.connect({deviceId:ap.id,port:'GigabitEthernet0'},{deviceId:pse.id,port:'GigabitEthernet0/1'});const cli=new IOSSession(e,ap.id);cli.execute('enable');cli.execute('conf t');
 for(const line of ['netconf-yang','restconf','netconf-yang feature candidate-datastore'])assert.match(cli.execute(line).join('\n'),/Invalid/);assert.ok(!cli.help('').some(line=>/netconf|restconf/.test(line)));assert.equal(ap.config.features.managementSettings,undefined);
});

test('MD-17 inherited entity and undeclared namespace names remain invalid XML without changing the datastore',()=>{
 const f=lab(),a=netconf(f),before=JSON.stringify(f.r.config);
 for(const name of ['constructor','__proto__','toString']){
  const first=a.messages.length;a.rpc(`<edit-config><target><running/></target><config><native xmlns="${NATIVE}"><hostname>&${name};</hostname></native></config></edit-config>`);assert.ok(a.messages.slice(first).some(m=>typeof m==='string'&&m.includes('malformed-message')));
  const second=a.messages.length;a.rpc(`<${name}:get/>`);assert.ok(a.messages.slice(second).some(m=>typeof m==='string'&&m.includes('unknown-namespace')));
 }
 assert.equal(JSON.stringify(f.r.config),before);assert.equal(({} as any).hostname,undefined);
});
