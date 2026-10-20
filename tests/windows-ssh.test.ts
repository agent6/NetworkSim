import {iosRejected} from '../src/ios-help.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {wirelessLabFixture} from './fixtures/wireless-lab.ts';

const password='WindowsSSH123',port='GigabitEthernet0';
const run=(cli:IOSSession,...lines:string[])=>{for(const line of lines){const output=cli.execute(line);assert.ok(!output.some(iosRejected),line+': '+output.join('\n'));}};
function configureSSH(cli:IOSSession) {
  run(cli,'enable','configure terminal','ip domain-name lab.example','crypto key generate rsa modulus 2048','ip ssh version 2',`username admin privilege 15 secret ${password}`,'line vty 0 4','login local','transport input ssh','end');
}
function fixture(kind:'router'|'switch'|'l3switch'|'poeswitch'|'wlc'|'ap'='router',hostKind:'pc'|'server'='pc') {
  const sim=new Simulator(20261017),client=sim.addDevice(hostKind),target=sim.addDevice(kind),cli=new IOSSession(sim,client.id),network=new IOSSession(sim,target.id);
  Object.assign(client.config.interfaces[port],{ip:'192.0.2.10',mask:'255.255.255.0'});delete client.config.interfaces[port].features.dhcp;
  const switched=['switch','l3switch','poeswitch'].includes(kind),physical=Object.keys(target.config.interfaces).find(name=>name.startsWith('GigabitEthernet'))!;
  if(kind==='ap') {const pse=sim.addDevice('poeswitch');for(const[d,p,n]of[[target,physical,1],[client,port,2]]as const){pse.config.interfaces['GigabitEthernet0/'+n].features.portfast=true;sim.connect({deviceId:d.id,port:p},{deviceId:pse.id,port:'GigabitEthernet0/'+n});}sim.advance(1000);}
  else sim.connect({deviceId:client.id,port},{deviceId:target.id,port:physical});
  run(network,'enable','configure terminal',...(switched?['interface '+physical,'spanning-tree portfast']:[]),'interface '+(switched?'Vlan1':physical),'ip address 192.0.2.1 255.255.255.0','no shutdown','end');
  configureSSH(network);sim.advance(2000);return {sim,client,target,cli,network,physical};
}
function login(cli:IOSSession,command='ssh admin@192.0.2.1') {
  const output=cli.execute(command);assert.equal(cli.passwordInput,true,output.join('\n'));assert.equal(cli.prompt,'Password:');
  assert.deepEqual(cli.execute(password),[]);assert.equal(cli.remoteConnected,true);assert.equal(cli.windowsMode,false);
}

for(const kind of ['router','switch','l3switch','poeswitch','wlc','ap']as const)test(`WIN-SSH-${kind} Windows PC authenticates to a configured network node, runs commands and exits to CMD`,()=>{
  const {sim,client,target,cli}=fixture(kind);const name=target.config.hostname;login(cli);
  assert.equal(cli.prompt,name+'#');assert.match(cli.execute('show running-config | include ^hostname').join('\n'),new RegExp('hostname '+name));
  run(cli,'configure terminal','hostname SSH-Test','end');assert.equal(target.config.hostname,'SSH-Test');assert.equal(client.config.hostname,'PC1');
  assert.match(cli.execute('exit').join('\n'),/Connection closed/);assert.equal(cli.prompt,'C:\\>');assert.equal(cli.remoteConnected,false);assert.equal(cli.execute('hostname')[0],'PC1');
  assert.ok(sim.events.some(e=>e.protocol==='TCP'&&e.packet?.source==='192.0.2.10'&&e.packet.destinationPort===22));
  assert.ok(!cli.history.includes(password));assert.deepEqual(target.runtime.features.managementSessions,[]);
});

test('WIN-SSH-07 Windows OpenSSH forms, flags, executable alias and server client all reach the same SSH listener',()=>{
  for(const command of ['ssh -l admin 192.0.2.1','ssh -p 22 admin@192.0.2.1','ssh -ladmin -p22 192.0.2.1','SSH.EXE -4 admin@192.0.2.1 -p 22','ssh -- admin@192.0.2.1','ssh -l admin other@192.0.2.1']) {
    const {cli}=fixture('router','server');login(cli,command);cli.execute('exit');assert.equal(cli.prompt,'C:\\>',command);
  }
});

test('WIN-SSH-08 usage and malformed or unsupported options return Windows errors without sending traffic',()=>{
  const {sim,cli}=fixture(),events=sim.events.length,now=sim.clock.now();
  for(const command of ['ssh','ssh /?','ssh -?','ssh.exe /?'])assert.match(cli.execute(command).join('\n'),/usage: ssh/);
  for(const command of ['ssh -p','ssh -l','ssh -p 0 admin@192.0.2.1','ssh -p 65536 admin@192.0.2.1','ssh -p nope admin@192.0.2.1','ssh -i key admin@192.0.2.1','ssh admin@','ssh @192.0.2.1','ssh admin@192.0.2.1 show version','ssh -4']) {
    let output:string[]=[];assert.doesNotThrow(()=>output=cli.execute(command),command);assert.match(output.join('\n'),/ssh:|not implemented/i,command);assert.equal(cli.remoteConnected,false);assert.equal(cli.prompt,'C:\\>');
  }
  assert.equal(sim.events.length,events);assert.equal(sim.clock.now(),now);
});

test('WIN-SSH-09 hostname, IPv4 and IPv6 selection resolve through DNS and use the requested address family',()=>{
  const {sim,client,target,cli,physical}=fixture();client.config.dnsServers=['192.0.2.1'];
  client.config.interfaces[port].ipv6=['2001:db8:1::10/64'];target.config.interfaces[physical].ipv6=['2001:db8:1::1/64'];
  target.config.services.dns={enabled:true,resourceRecords:[{name:'edge.lab',type:'A',value:'192.0.2.1',ttl:300},{name:'edge.lab',type:'AAAA',value:'2001:db8:1::1',ttl:300}]};sim.changed();sim.advance(1500);
  for(const command of ['ssh admin@edge.lab','ssh -4 -l admin edge.lab','ssh -6 admin@edge.lab','ssh admin@[2001:db8:1::1]']){login(cli,command);cli.execute('exit');}
  assert.ok(target.runtime.features.dnsQueries.some((r:any)=>r.type==='A'));assert.ok(target.runtime.features.dnsQueries.some((r:any)=>r.type==='AAAA'));
  assert.ok(sim.events.some(e=>e.packet?.source==='2001:db8:1::10'&&e.packet.destinationPort===22));
  for(const command of ['ssh -6 admin@192.0.2.1','ssh -4 admin@2001:db8:1::1','ssh admin@missing.lab']){assert.doesNotThrow(()=>assert.match(cli.execute(command).join('\n'),/^ssh:/));assert.equal(cli.remoteConnected,false);}
});

test('WIN-SSH-10 missing keys, disabled SSH transport, refused ports and VTY source restrictions deny access',()=>{
  for(const scenario of ['keys','transport','acl','port','telnet-port','http-port']) {
    const {sim,target,cli,network}=fixture();
    if(scenario==='keys')run(network,'conf t','crypto key zeroize rsa','yes','end');
    if(scenario==='transport')run(network,'conf t','line vty 0 4','transport input telnet','end');
    if(scenario==='telnet-port')run(network,'conf t','line vty 0 4','transport input telnet','end');
    if(scenario==='http-port')run(network,'conf t','ip http server','end');
    if(scenario==='acl')run(network,'conf t','ip access-list standard MANAGEMENT','deny host 192.0.2.10','permit any','exit','line vty 0 4','access-class MANAGEMENT in','end');
    const requestedPort=scenario==='port'?2222:scenario==='telnet-port'?23:scenario==='http-port'?80:22;
    const output=cli.execute(`ssh -p ${requestedPort} admin@192.0.2.1`);
    assert.match(output.join('\n'),/connect|refused|failed|unreachable/i,scenario);assert.equal(cli.remoteConnected,false);assert.equal(cli.prompt,'C:\\>');assert.equal((target.runtime.features.managementSessions??[]).length,0);
    if(scenario==='port')assert.ok(sim.events.some(e=>e.packet?.destinationPort===2222));
  }
});

test('WIN-SSH-11 wrong passwords retry the same SSH identity, respect retries and never enter history',()=>{
  const {cli,target,network}=fixture();run(network,'conf t','ip ssh authentication-retries 2','end');
  cli.execute('ssh -l admin 192.0.2.1');assert.match(cli.execute('incorrect-password').join('\n'),/Login invalid/);assert.equal(cli.prompt,'Password:');cli.execute(password);assert.equal(cli.prompt,target.config.hostname+'#');cli.execute('exit');
  cli.execute('ssh admin@192.0.2.1');cli.execute('wrong-one');assert.match(cli.execute('wrong-two').join('\n'),/Bad passwords/);assert.equal(cli.prompt,'C:\\>');assert.equal(cli.remoteConnected,false);
  assert.ok(!cli.history.some(row=>[password,'incorrect-password','wrong-one','wrong-two'].includes(row)));
});

test('WIN-SSH-12 remote help, Tab and cancellation operate on the network node; authentication cancel releases VTY',()=>{
  const {cli,target}=fixture();cli.execute('ssh admin@192.0.2.1');assert.match(cli.cancel().join('\n'),/cancel/i);assert.equal(cli.remoteConnected,false);assert.equal(target.runtime.features.managementSessions.length,0);
  login(cli);assert.match(cli.help('show ip ').join('\n'),/interface/);assert.equal(cli.complete('show ip rou'),'show ip route ');run(cli,'conf t','interface gi0/0');cli.cancel();assert.equal(cli.prompt,target.config.hostname+'#');cli.execute('exit');assert.equal(cli.prompt,'C:\\>');
});

test('WIN-SSH-13 lost transport and idle timeout return to the local Windows prompt',()=>{
  for(const scenario of ['link','timeout']) {
    const {sim,cli,network,client}=fixture();if(scenario==='timeout')run(network,'conf t','line vty 0 4','exec-timeout 0 2','end');login(cli);
    if(scenario==='link')sim.disconnect(sim.linkAt(client.id,port)!.id);else sim.advance(3000);
    assert.match(cli.execute('show clock').join('\n'),/failed|expired|closed|timed out/i);assert.equal(cli.remoteConnected,false);assert.equal(cli.prompt,'C:\\>');
  }
});

test('WIN-SSH-14 a Windows wireless laptop reaches a router over its real WLAN, CAPWAP and routed path',()=>{
  const sim=new Simulator();sim.load(wirelessLabFixture());const target=sim.lab.devices.find(d=>d.kind==='router')!,client=sim.lab.devices.find(d=>d.kind==='laptop')!;
  configureSSH(new IOSSession(sim,target.id));sim.advance(25000);assert.ok(sim.wireless.association(client.id));
  const cli=new IOSSession(sim,client.id);login(cli,'ssh -l admin 10.10.0.1');assert.equal(cli.prompt,'Gateway#');cli.execute('exit');assert.equal(cli.prompt,'C:\\>');assert.ok(sim.events.some(e=>e.packet?.destinationPort===5247));
});

test('WIN-SSH-15 local user privilege and enable authentication remain enforced inside the Windows SSH client',()=>{
  const {cli,network,target}=fixture();run(network,'conf t','username student secret StudentSSH123','enable secret EnableSSH123','end');
  cli.execute('ssh student@192.0.2.1');cli.execute('StudentSSH123');assert.equal(cli.prompt,target.config.hostname+'>');assert.match(cli.execute('configure terminal').join('\n'),/Invalid|privilege/i);
  cli.execute('enable');assert.equal(cli.passwordInput,true);cli.execute('EnableSSH123');assert.equal(cli.prompt,target.config.hostname+'#');assert.match(cli.execute('show privilege').join('\n'),/15/);cli.execute('exit');assert.equal(cli.prompt,'C:\\>');
  assert.ok(!cli.history.includes('StudentSSH123'));assert.ok(!cli.history.includes('EnableSSH123'));
});

test('WIN-SSH-16 SSH requires a real return route through an intermediate router',()=>{
  const {sim,client,target,cli,network,physical}=fixture();sim.disconnect(sim.linkAt(client.id,port)!.id);
  Object.assign(client.config.interfaces[port],{ip:'10.0.0.10',mask:'255.255.255.0'});client.config.defaultGateway='10.0.0.1';
  const transit=sim.addDevice('router'),middle=new IOSSession(sim,transit.id);
  sim.connect({deviceId:client.id,port},{deviceId:transit.id,port:'GigabitEthernet0/0'});sim.connect({deviceId:target.id,port:physical},{deviceId:transit.id,port:'GigabitEthernet0/1'});
  run(middle,'enable','conf t','int gi0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','int gi0/1','ip address 192.0.2.254 255.255.255.0','no shutdown','end');
  assert.match(cli.execute('ssh admin@192.0.2.1').join('\n'),/^ssh: connect/);assert.equal(cli.remoteConnected,false);assert.equal((target.runtime.features.managementSessions??[]).length,0);
  run(network,'conf t','ip route 10.0.0.0 255.255.255.0 192.0.2.254','end');login(cli);assert.equal(cli.prompt,target.config.hostname+'#');
  assert.ok(sim.events.some(e=>e.nodeId===transit.id&&e.packet?.destinationPort===22&&e.disposition==='forward'));
});
