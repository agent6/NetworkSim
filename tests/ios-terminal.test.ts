import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { terminalRows } from '../src/ios-terminal.ts';

function fixture(){const engine=new Simulator(415),device=engine.addDevice('router'),cli=new IOSSession(engine,device.id);return {engine,device,cli};}
function run(cli:IOSSession,...lines:string[]){for(const line of lines)assert.ok(!cli.execute(line).some(row=>/^%/.test(row)),line);}

test('invalid no/default navigation cannot leave modes or dispatch EXEC and is absent from help/completion',()=>{
  const {engine,device,cli}=fixture();
  for(const setup of [['enable','conf t'],['interface g0/0'],['exit','router bgp 65000','address-family ipv4 unicast']]){
    run(cli,...setup);const mode=cli.mode,prompt=cli.prompt,configuration=JSON.stringify(device.config),clock=engine.clock.now();
    for(const command of ['no end','default end','no exit','default exit','no help','default help','no do reload','default do show version',...mode==='address-family'?['no exit-address-family','default exit-address-family']:[]]){
      assert.match(cli.execute(command).join('\n'),/Invalid input/,command);assert.equal(cli.mode,mode);assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),configuration);assert.equal(engine.clock.now(),clock);
    }
    assert.ok(!cli.help('no ').some(row=>/^\s*(?:end|exit|help|do)\s/.test(row)));
    assert.match(cli.help('no do ').join('\n'),/% Unrecognized command/);assert.equal(cli.complete('no do sh'),'no do sh');assert.equal(cli.complete('no exi'),'no exi');
  }
});

test('configure source prompt and cancellation preserve configuration and privilege',()=>{
  const {device,cli}=fixture();run(cli,'enable','configure');assert.match(cli.prompt,/\[terminal\]\?$/);
  run(cli,'');assert.equal(cli.mode,'config');run(cli,'hostname Campus','interface g0/0');
  assert.equal(cli.configurationMode,true);assert.deepEqual(cli.cancel(),[]);assert.equal(cli.prompt,'Campus#');
  assert.equal(device.config.hostname,'Campus');run(cli,'configure');cli.cancel();assert.equal(cli.prompt,'Campus#');
  run(cli,'disable');cli.cancel();assert.equal(cli.prompt,'Campus>');
});

test('intermediate privilege cannot gain configuration access through disable',()=>{
  const {cli}=fixture();run(cli,'enable 5');assert.equal(cli.prompt,'R1#');
  assert.match(cli.execute('configure terminal').join('\n'),/Invalid/);
  assert.match(cli.execute('disable 15').join('\n'),/higher privilege/);
  assert.deepEqual(cli.execute('show privilege'),['Current privilege level is 5']);
  run(cli,'disable 1');assert.equal(cli.prompt,'R1>');
  run(cli,'enable','configure terminal','enable secret training','end','disable','enable 5');
  assert.equal(cli.passwordInput,true);run(cli,'training');assert.deepEqual(cli.execute('show privilege'),['Current privilege level is 5']);
});

test('bare write saves the actual configuration and write terminal displays it without saving',()=>{
  const {device,cli}=fixture();run(cli,'enable','configure terminal','hostname Saved','end','wr');assert.equal(device.startupConfig?.hostname,'Saved');
  run(cli,'configure terminal','hostname Draft','end');assert.match(cli.execute('write terminal').join('\n'),/hostname Draft/);assert.equal(device.startupConfig?.hostname,'Saved');
});

test('session history, width, editing and timestamp settings govern terminal metadata',()=>{
  const {engine,cli}=fixture();run(cli,'terminal history size 2','show clock','show version');assert.deepEqual(cli.commandHistory,['show clock','show version']);
  run(cli,'terminal no history');const retained=[...cli.commandHistory];run(cli,'show clock');assert.deepEqual(cli.commandHistory,retained);
  run(cli,'terminal width 20','terminal no editing','terminal exec prompt timestamp');assert.equal(cli.pageWidth,20);assert.equal(cli.editing,false);
  assert.match(cli.commandTimestamp!,/^\*00:00:00/);engine.clock.advance(1000);assert.match(cli.commandTimestamp!,/^\*00:00:01/);
  const rows=terminalRows(cli.execute('show version'),cli.pageWidth);assert.ok(rows.every(row=>[...row].length<=20));
  assert.equal(rows.join(''),cli.execute('show version').join(''));
  run(cli,'terminal width 0','terminal editing','terminal no exec prompt timestamp');assert.equal(cli.editing,true);assert.equal(cli.commandTimestamp,undefined);
  assert.deepEqual(terminalRows(['long line',''],cli.pageWidth),['long line','']);assert.deepEqual(terminalRows(['a\tb'],8),['a       ','b']);
});

test('output count and redirection persist real command results, append and enforce flash quota atomically',()=>{
  const {device,cli}=fixture();run(cli,'enable');const output=cli.execute('show interfaces'), count=output.filter(row=>/input/.test(row)).length;
  assert.deepEqual(cli.execute('show interfaces | count input'),[`Number of lines which match regexp = ${count}`]);
  run(cli,'show interfaces | redirect flash:ports.txt');assert.equal(device.config.features.files['ports.txt'],output.join('\n')+'\n');
  const clock=cli.execute('show clock');run(cli,'show clock | append flash:ports.txt');assert.equal(device.config.features.files['ports.txt'],[...output,...clock].join('\n')+'\n');
  assert.deepEqual(cli.execute('show clock | tee flash:clock.txt'),clock);assert.equal(device.config.features.files['clock.txt'],clock.join('\n')+'\n');
  device.config.features.fileSystem={capacityBytes:0};const before=JSON.stringify(device.config.features.files);
  assert.match(cli.execute('show version | redirect flash:ports.txt').join('\n'),/Insufficient simulated flash space/);assert.equal(JSON.stringify(device.config.features.files),before);
  assert.match(cli.execute('show version | redirect').join('\n'),/Incomplete/);assert.match(cli.execute('show version | redirect ftp:\/\/example.test\/x').join('\n'),/simulated flash/);
});

test('default line commands restore enabled editing, history and EXEC while transports normalize abbreviations',()=>{
  const {engine,device,cli}=fixture();run(cli,'enable','configure terminal','line console 0','no history','no editing','no exec','transport output none','transport preferred none','transport input none','default history','default edit','default exec','default transport output','default transport preferred','default transport input','end');const settings=device.config.features.lines['console 0'];assert.equal(settings.history,true);assert.equal(settings.editing,true);assert.equal(settings.exec,true);assert.equal(settings.transport,'all');assert.equal(settings.transportOutput,'all');assert.equal(settings.transportPreferred,'telnet');const fresh=new IOSSession(engine,device.id);assert.equal(fresh.editing,true);run(fresh,'show clock');assert.deepEqual(fresh.commandHistory,['show clock']);
  run(cli,'configure terminal','line console 0','transport output s t','transport input t','transport preferred s');assert.equal(settings.transportOutput,'ssh telnet');assert.equal(settings.transport,'telnet');assert.equal(settings.transportPreferred,'ssh');const before=JSON.stringify(device.config);for(const command of ['transport input all ssh','transport output none telnet','transport preferred all','transport preferred ssh telnet']){assert.match(cli.execute(command).join('\n'),/Invalid/);assert.equal(JSON.stringify(device.config),before);}run(cli,'exit','interface g0/0');const physicalBefore=JSON.stringify(device.config);assert.match(cli.execute('no keepalive').join('\n'),/not implemented/);assert.match(cli.execute('default keepalive').join('\n'),/not implemented/);assert.equal(JSON.stringify(device.config),physicalBefore);
});

test('line output transports prevent forbidden remote connection traffic and restored default permits it',()=>{
  const {engine,device,cli}=fixture(),peer=engine.addDevice('router'),other=new IOSSession(engine,peer.id);engine.connect({deviceId:device.id,port:'GigabitEthernet0/0'},{deviceId:peer.id,port:'GigabitEthernet0/0'});for(const [session,address]of [[cli,'192.0.2.1'],[other,'192.0.2.2']]as const)run(session,'enable','configure terminal','interface g0/0','ip address '+address+' 255.255.255.0','no shutdown','end');run(other,'configure terminal','line vty 0 4','transport input t','no login','no exec','end');run(cli,'configure terminal','line console 0','transport output none','end');const events=engine.events.length;assert.match(cli.execute('telnet 192.0.2.2').join('\n'),/not an allowed output transport/);assert.equal(engine.events.length,events);run(cli,'configure terminal','line console 0','default transport output','end');assert.match(cli.execute('telnet 192.0.2.2').join('\n'),/EXEC is disabled/);run(other,'configure terminal','line vty 0 4','default exec','end');run(cli,'telnet 192.0.2.2');assert.equal(cli.prompt,'R2>');
});

test('IPv6 VTY access-class evaluates actual source and destination and output ACLs gate outgoing sessions',()=>{
  const {engine,device,cli}=fixture(),peer=engine.addDevice('router'),other=new IOSSession(engine,peer.id);engine.connect({deviceId:device.id,port:'GigabitEthernet0/0'},{deviceId:peer.id,port:'GigabitEthernet0/0'});for(const [session,address]of [[cli,'2001:db8::1'],[other,'2001:db8::2']]as const)run(session,'enable','configure terminal','interface g0/0','ipv6 address '+address+'/64','no shutdown','end');engine.advance(1200);run(other,'configure terminal','ipv6 access-list MGMT','deny tcp host 2001:db8::1 host 2001:db8::2 eq telnet','permit ipv6 any any','exit','line vty 0 4','transport input telnet','no login','ipv6 access-class MGMT in','end');assert.match(cli.execute('telnet 2001:db8::2').join('\n'),/VTY access-class/);run(other,'configure terminal','line vty 0 4','no ipv6 access-class MGMT in','end');run(cli,'configure terminal','ipv6 access-list OUT','deny ipv6 any host 2001:db8::2','permit ipv6 any any','exit','line console 0','ipv6 access-class OUT out','end');assert.match(cli.execute('telnet 2001:db8::2').join('\n'),/output access-class/);run(cli,'configure terminal','line console 0','no ipv6 access-class OUT out','end','telnet 2001:db8::2');assert.equal(cli.prompt,'R2>');
});
