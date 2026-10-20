import {iosRejected} from '../src/ios-help.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { basicAuthorization } from '../src/http-service.ts';
import { IOSSession } from '../src/cli.ts';

function ok(cli:IOSSession,...commands:string[]){for(const command of commands){const output=cli.execute(command);assert.ok(!output.some(iosRejected),`${command}: ${output.join('\n')}`);}}
function setup(){const engine=new Simulator(98),a=engine.addDevice('router'),b=engine.addDevice('router'),ca=new IOSSession(engine,a.id),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});for(const [cli,ip]of [[ca,'10.0.0.1'],[cb,'10.0.0.2']] as const)ok(cli,'enable','conf t','int g0/0',`ip address ${ip} 255.255.255.0`,'no shutdown','end');return {engine,a,b,ca,cb};}

test('enable secrets and console login authenticate without retaining secrets in history',()=>{
  const {engine,a,ca}=setup();ok(ca,'conf t','enable secret enable-pass','username admin privilege 15 secret console-pass','line console 0','login local','end','disable','enable');
  assert.equal(ca.prompt,'Password:');assert.equal(ca.passwordInput,true);assert.match(ca.execute('wrong')[0],/failed/);ok(ca,'enable-pass');assert.equal(ca.prompt,'R1#');assert.ok(!ca.history.includes('enable-pass'));
  const other=new IOSSession(engine,a.id);assert.equal(other.prompt,'Username:');ok(other,'admin');assert.equal(other.passwordInput,true);ok(other,'console-pass');assert.equal(other.prompt,'R1#');assert.deepEqual(other.history,[]);
});

test('SSH authenticates over actual TCP, permits remote commands, and closes on transport failure',()=>{
  const {engine,a,b,ca,cb}=setup();ok(cb,'conf t','ip domain-name training.test','crypto key generate rsa modulus 2048','username admin privilege 15 secret secret','aaa new-model','aaa authentication login default local','aaa authorization exec default local','line vty 0 4','login authentication default','transport input ssh','end');
  ok(ca,'ssh -l admin 10.0.0.2');assert.equal(ca.prompt,'Password:');assert.equal(ca.passwordInput,true);ok(ca,'secret');assert.equal(ca.prompt,'R2#');assert.ok(ca.execute('show ip interface brief').some(x=>x.includes('10.0.0.2')));assert.ok(engine.events.some(x=>x.protocol==='TCP'));
  ok(ca,'conf t','hostname Remote','end');assert.equal(b.config.hostname,'Remote');assert.equal(a.config.hostname,'R1');assert.equal(ca.prompt,'Remote#');
  ok(cb,'conf t','int g0/0','shutdown','end');assert.match(ca.execute('show version').join('\n'),/\[Connection to 10\.0\.0\.2 closed by foreign host\]/);assert.equal(ca.prompt,'R1#');
});

test('Telnet rejects incorrect passwords and configured ACLs block new sessions',()=>{
  const {engine,b,ca,cb}=setup();ok(cb,'conf t','line vty 0 0','password access','login','transport input telnet','end');ok(ca,'telnet 10.0.0.2');assert.equal(ca.prompt,'Password:');ca.execute('wrong');ca.execute('wrong');assert.match(ca.execute('wrong').join('\n'),/Bad passwords/);assert.equal(ca.prompt,'R1#');
  ok(cb,'conf t','ip access-list extended BLOCK','deny tcp any any eq 23','permit ip any any','exit','int g0/0','ip access-group BLOCK in','end');assert.match(ca.execute('telnet 10.0.0.2').join('\n'),/^Trying 10\.0\.0\.2 \.\.\. \n% Destination unreachable; gateway or host down$/);assert.equal(b.runtime.features.managementSessions.length,0);assert.ok(engine.events.some(x=>/ACL/i.test(x.label+' '+x.detail)));
});

test('nested Telnet sessions keep independent prompts and remote changes target only the selected device',()=>{
  const {a,b,ca,cb}=setup();for(const cli of [ca,cb])ok(cli,'conf t','line vty 0 4','transport input telnet','privilege level 15','no login','end');
  ok(ca,'telnet 10.0.0.2');assert.equal(ca.prompt,'R2#');ok(ca,'telnet 10.0.0.1');assert.equal(ca.prompt,'R1#');ok(ca,'conf t','hostname Innermost','end');assert.equal(a.config.hostname,'Innermost');assert.equal(b.config.hostname,'R2');ok(ca,'disable','exit');assert.equal(ca.prompt,'R2#');ok(ca,'disable','exit');assert.equal(ca.prompt,'Innermost#');
});

test('VTY timeout and reboot invalidate established logical sessions',()=>{
  const {engine,b,ca,cb}=setup();ok(cb,'conf t','line vty 0 4','transport input telnet','exec-timeout 0 10','end','write memory');ok(ca,'telnet 10.0.0.2');assert.equal(ca.prompt,'R2>');engine.clock.advance(11000);assert.match(ca.execute('show version').join('\n'),/expired/);ok(ca,'telnet 10.0.0.2');engine.power(b.id,false);engine.power(b.id,true);assert.match(ca.execute('show version').join('\n'),/expired/);
});

test('manual, timer and syslog EEM actions change real config and archive snapshots retain a bounded history',()=>{
  const {engine,a,ca}=setup();ok(ca,'conf t','archive','path flash:backups','maximum 2','write-memory','exit','event manager applet SETNAME','event none','action 1 cli command "configure terminal"','action 2 cli command "hostname Automated"','action 3 cli command "end"','end','event manager run SETNAME');assert.equal(a.config.hostname,'Automated');assert.equal(ca.prompt,'Automated#');
  ok(ca,'archive config','archive config','archive config');assert.equal(a.config.features.archives.length,2);assert.equal(Object.keys(a.config.features.files).filter(x=>x.startsWith('backups-')).length,2);assert.match(ca.execute('show archive').join('\n'),/backups-3/);
  ok(ca,'conf t','event manager applet WATCH','event timer countdown time 2','action 1 syslog msg "timer fired"','exit','event manager applet LOG','event syslog pattern "trigger-me"','action 1 syslog msg "handled"','end');engine.clock.advance(3000);assert.ok(a.runtime.logs.some(x=>x.includes('timer fired')));engine.log(a.id,'trigger-me');engine.clock.advance(1100);assert.ok(a.runtime.logs.some(x=>x.endsWith('handled')));
  ok(ca,'write memory');assert.equal(a.config.features.archives.at(-1).id,4);
});

test('scheduled IP SLA probes actual reachability and updates object tracking after a link failure',()=>{
  const {engine,a,ca,cb}=setup();ok(ca,'conf t','ip sla 5','icmp-echo 10.0.0.2 source-interface g0/0','frequency 3','timeout 500','threshold 100','exit','ip sla schedule 5 life forever start-time now','track 5 ip sla 5 reachability','end');engine.clock.advance(1000);assert.equal(a.runtime.features.ipSla[5].returnCode,'OK');assert.equal(a.runtime.features.tracks[5].up,true);
  ok(cb,'conf t','int g0/0','shutdown','end');engine.clock.advance(4000);assert.equal(a.runtime.features.ipSla[5].returnCode,'Timeout');assert.equal(a.runtime.features.tracks[5].up,false);
});

test('VTY access-class applies source filtering even when the TCP destination is reachable',()=>{
  const {ca,cb}=setup();ok(cb,'conf t','ip access-list standard MGMT','deny host 10.0.0.1','permit any','exit','line vty 0 4','transport input telnet','access-class MGMT in','end');assert.match(ca.execute('telnet 10.0.0.2').join('\n'),/access-class/);assert.equal(ca.prompt,'R1#');
});

test('RADIUS and TACACS authentication traverse actual packets, reject bad credentials, and fall back only on unavailability',()=>{
  const {engine,a,b,ca,cb}=setup();b.config.services.radius={enabled:true,secret:'shared',users:{student:{password:'remote-pass',privilege:15}}};b.config.services.tacacs={enabled:true,secret:'tacacs-key',users:{operator:{password:'tacacs-pass',privilege:15}}};
  ok(ca,'conf t','username fallback privilege 15 secret local-pass','radius server AUTH','address ipv4 10.0.0.2 auth-port 1812','key shared','exit','tacacs server TPLUS','address ipv4 10.0.0.2 port 49','key tacacs-key','exit','aaa group server radius RAD','server name AUTH','exit','aaa group server tacacs+ TAC','server name TPLUS','exit','aaa new-model','aaa authentication login RADLOGIN group RAD local','aaa authentication login TACLOGIN group TAC local','aaa authorization exec default group RAD local','aaa authorization console','line console 0','login authentication RADLOGIN','end');
  const radius=new IOSSession(engine,a.id);assert.equal(radius.prompt,'Username:');ok(radius,'student','remote-pass');assert.equal(radius.prompt,'R1#');assert.ok(b.runtime.features.aaaRequests.some((r:any)=>r.protocol==='radius'&&r.accepted));
  const rejected=new IOSSession(engine,a.id);ok(rejected,'fallback');assert.match(rejected.execute('local-pass').join('\n'),/failed/);assert.equal(rejected.prompt,'Username:');
  b.config.services.radius.enabled=false;const fallback=new IOSSession(engine,a.id);ok(fallback,'fallback','local-pass');assert.equal(fallback.prompt,'R1#');
  ok(ca,'conf t','aaa authorization exec default group TAC local','line console 0','login authentication TACLOGIN','end');const tacacs=new IOSSession(engine,a.id);ok(tacacs,'operator','tacacs-pass');assert.equal(tacacs.prompt,'R1#');assert.ok(b.runtime.features.aaaRequests.some((r:any)=>r.protocol==='tacacs'&&r.accepted));
});

test('remote escape/resume keeps session state, completion and paging while cancel leaves a ready terminal connected',()=>{
  const {ca,cb}=setup();ok(cb,'conf t','line vty 0 4','transport input telnet','privilege level 15','no login','end');ok(ca,'telnet 10.0.0.2','terminal length 7');assert.equal(ca.pageLength,7);assert.equal(ca.complete('show ip int b'),'show ip int brief ');assert.match(ca.escape().join('\n'),/suspended/);assert.equal(ca.prompt,'R1#');assert.match(ca.execute('show sessions').join('\n'),/10.0.0.2/);ok(ca,'resume');assert.equal(ca.prompt,'R2#');assert.equal(ca.pageLength,7);ca.cancel();assert.equal(ca.prompt,'R2#');ca.escape();ok(ca,'disconnect 1');assert.match(ca.execute('show sessions').join('\n'),/No suspended/);
});

test('Type 7 input and service password-encryption preserve real authentication and rendered obfuscation',()=>{
  const engine=new Simulator(309),device=engine.addDevice('router'),cli=new IOSSession(engine,device.id);for(const line of ['enable','configure terminal','enable password 7 00081204','username trainee privilege 15 password lab','line console 0','password lab','exit','service password-encryption','end'])assert.ok(!cli.execute(line).some(x=>x.startsWith('%')),line);
  const text=cli.execute('show running-config').join('\n');assert.match(text,/enable password 7 00081204/);assert.match(text,/username trainee privilege 15 password 7 00081204/);assert.match(text,/password 7 00081204/);assert.doesNotMatch(text,/password (?:0 )?lab/);
  cli.execute('disable');assert.equal(cli.prompt,'R1>');cli.execute('enable');assert.equal(cli.prompt,'Password:');cli.execute('lab');assert.equal(cli.prompt,'R1#');cli.execute('configure terminal');assert.match(cli.execute('enable password 7 invalid').join('\n'),/Invalid Type 7/);assert.equal(device.config.features.enablePassword,'lab');
  const other=engine.addDevice('router'),session=new IOSSession(engine,other.id);other.config.features.files={saved:text};session.execute('enable');assert.ok(!session.execute('copy flash:saved running-config').some(x=>x.startsWith('%')));assert.equal(other.config.features.users.trainee.password,'lab');assert.equal(other.config.features.lines['console 0'].password,'lab');
});

test('terminal monitor drains severity-filtered logs locally and over TCP without renewing idle sessions',()=>{
  const {engine,a,b,ca,cb}=setup();ok(cb,'conf t','logging source-interface g0/0','logging facility local4','logging buffered 4096 warnings','logging monitor errors','line vty 0 4','transport input telnet','privilege level 15','exec-timeout 0 3','end');
  ok(cb,'terminal monitor');engine.log(b.id,'debug not displayed',7);engine.log(b.id,'error displayed',3);const now=engine.clock.now();assert.deepEqual(cb.pollOutput(),['%SYS-3-USERLOG: error displayed']);assert.equal(engine.clock.now(),now);assert.deepEqual(cb.pollOutput(),[]);assert.ok(!b.runtime.logs.some(x=>x.includes('debug not displayed')));
  const rendered=cb.execute('show running-config').join('\n');assert.match(rendered,/logging source-interface GigabitEthernet0\/0/);assert.match(rendered,/logging facility 20/);assert.match(rendered,/logging buffered 4096 4/);assert.match(rendered,/logging monitor 3/);
  ok(ca,'telnet 10.0.0.2','terminal monitor');engine.log(b.id,'remote event',2);engine.log(a.id,'wrong device',1);assert.deepEqual(ca.pollOutput(),['%SYS-2-USERLOG: remote event']);assert.deepEqual(ca.pollOutput(),[]);engine.clock.advance(3100);assert.match(ca.pollOutput().join('\n'),/expired/);assert.equal(ca.prompt,'R1#');ok(cb,'terminal no monitor');engine.log(b.id,'disabled event');assert.deepEqual(cb.pollOutput(),[]);
});


test('HTTP AAA uses delivered RADIUS responses and only unavailable servers allow local fallback',()=>{
  const {engine,a,b,ca}=setup();b.config.services.radius={enabled:true,secret:'shared',users:{remote:{password:'pass',privilege:1}}};
  ok(ca,'conf t','username fallback secret localpass','radius server AUTH','address ipv4 10.0.0.2 auth-port 1812','key shared','exit','aaa new-model','aaa authentication login WEB group radius local','ip http server','ip http authentication aaa login-authentication WEB','end');
  const request=(user:string,password:string)=>{const result=engine.httpRequest(b.id,'http://10.0.0.1/',{headers:{Authorization:basicAuthorization(user,password)}});engine.clock.advance(12000);return result;};
  assert.equal(request('remote','pass').statusCode,200);assert.ok(b.runtime.features.aaaRequests.some((r:any)=>r.accepted&&r.username==='remote'));assert.equal(request('fallback','localpass').statusCode,401);b.config.services.radius.enabled=false;engine.changed();assert.equal(request('fallback','localpass').statusCode,200);
  ok(ca,'conf t','aaa authentication login WEB group radius','end');assert.equal(request('fallback','localpass').statusCode,503);assert.ok(engine.events.some(e=>e.protocol==='UDP'&&e.packet?.destinationPort===1812));
});

test('HTTP and UDP-jitter SLA require delivered replies, preserve source/ports and drive tracked state',()=>{
  const {engine,a,b,ca,cb}=setup();ok(cb,'conf t','ip http server','ip sla responder','end');ok(ca,'conf t','ip sla 1','http get http://10.0.0.2/','frequency 5','timeout 500','exit','ip sla 2','udp-jitter 10.0.0.2 20000 num-packets 4 interval 20 source-ip 10.0.0.1 source-port 12345','frequency 5','timeout 500','exit','ip sla schedule 1 life forever start-time now','ip sla schedule 2 life forever start-time now','track 9 ip sla 2 reachability','end');engine.advance(1500);
  assert.equal(a.runtime.features.ipSla[1].returnCode,'OK');assert.equal(a.runtime.features.ipSla[2].packetsReceived,4);assert.equal(a.runtime.features.ipSla[2].packetsSent,4);assert.equal(a.runtime.features.tracks[9].up,true);assert.ok(engine.events.some(e=>e.packet?.source==='10.0.0.1'&&e.packet?.sourcePort===12345&&e.packet?.destinationPort===20000));assert.ok(engine.events.some(e=>e.packet?.destinationPort===1967));assert.equal(b.runtime.features.slaResponderCounters[20000],4);
  const snapshot=ca.execute('show running-config').join('\n'),copy=engine.addDevice('router'),session=new IOSSession(engine,copy.id);copy.config.features.files={snapshot};ok(session,'enable','copy flash:snapshot running-config');assert.deepEqual(copy.config.features.ipSla,a.config.features.ipSla);
  ok(cb,'conf t','int g0/0','shutdown','end');engine.advance(5500);assert.equal(a.runtime.features.ipSla[1].success,false);assert.equal(a.runtime.features.ipSla[2].returnCode,'Responder unavailable');assert.equal(a.runtime.features.tracks[9].up,false);
});

test('UDP jitter control-disabled needs an explicitly configured responder and rejects a wrong bound address',()=>{
  const {engine,a,ca,cb}=setup();ok(cb,'conf t','ip sla responder udp-echo ipaddress 10.0.0.2 port 22000','end');ok(ca,'conf t','ip sla 3','udp-jitter 10.0.0.2 22000 num-packets 2 control disable','timeout 300','frequency 2','exit','ip sla schedule 3 start-time now','end');engine.advance(1000);assert.equal(a.runtime.features.ipSla[3].packetsReceived,2);assert.ok(!engine.events.some(e=>e.packet?.destinationPort===1967));ok(cb,'conf t','no ip sla responder udp-echo ipaddress 10.0.0.2 port 22000','end');engine.advance(2500);assert.equal(a.runtime.features.ipSla[3].success,false);
});

test('AAA EXEC authorization selects privilege, command authorization rejects without local fallback, and unavailable transport permits fallback',()=>{
  const {engine,a,b,ca,cb}=setup();b.config.services.tacacs={enabled:true,secret:'shared',users:{admin:{password:'pass',privilege:15}}};ok(ca,'conf t','username admin privilege 15 secret pass','tacacs server AUTH','address ipv4 10.0.0.2 port 49','key shared','exit','aaa new-model','aaa authentication login default local','aaa authorization console','aaa authorization exec default group tacacs+ local','aaa authorization commands 15 default group tacacs+ local','line console 0','login authentication default','end');
  const console=new IOSSession(engine,a.id);ok(console,'admin','pass');assert.equal(console.prompt,'R1#');assert.ok(b.runtime.features.aaaRequests.some((x:any)=>x.operation==='authorize'&&x.kind==='exec'));ok(console,'conf t','hostname Authorized','end');assert.equal(a.config.hostname,'Authorized');b.config.services.tacacs.users.admin.privilege=1;assert.match(console.execute('configure terminal').join('\n'),/authorization failed/);assert.equal(console.mode,'priv');assert.ok(b.runtime.features.aaaRequests.some((x:any)=>x.operation==='authorize'&&x.kind==='commands'&&!x.accepted));
  b.config.services.tacacs.enabled=false;engine.changed();ok(console,'configure terminal','hostname Fallback','end');assert.equal(a.config.hostname,'Fallback');const rendered=ca.execute('show running-config').join('\n');assert.match(rendered,/aaa authorization commands 15 default group tacacs\+ local/);
  ok(ca,'conf t','no aaa authorization exec default','end');const limited=new IOSSession(engine,a.id);ok(limited,'admin','pass');assert.equal(limited.prompt,'Fallback>');assert.match(limited.execute('show privilege').join('\n'),/level is 1/);
});

test('AAA EXEC denial closes a VTY and accounting configuration renders without claiming delivery',()=>{
  const {engine,b,ca,cb}=setup();ok(cb,'conf t','username admin privilege 15 secret pass','aaa new-model','aaa authentication login default local','aaa authorization exec default group radius','line vty 0 4','login authentication default','transport input telnet','end');ok(ca,'telnet 10.0.0.2','admin');assert.match(ca.execute('pass').join('\n'),/EXEC authorization failed/);assert.equal(ca.prompt,'R1#');assert.equal(b.runtime.features.managementSessions.length,0);ok(cb,'conf t');assert.deepEqual(cb.execute('aaa accounting exec default start-stop group radius'),[]);ok(cb,'end');assert.match(cb.execute('show running-config').join('\n'),/aaa accounting exec default start-stop group radius/);
});
