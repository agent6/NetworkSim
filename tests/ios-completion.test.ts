import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {terminalCompletionEdit} from '../src/ios-terminal.ts';

function fixture(kind:'router'|'switch'|'l3switch'|'poeswitch'|'wlc'|'ap'='l3switch') {
  const sim=new Simulator(20261017),device=sim.addDevice(kind),cli=new IOSSession(sim,device.id);
  if(kind==='ap'){const pse=sim.addDevice('poeswitch');sim.connect({deviceId:device.id,port:'GigabitEthernet0'},{deviceId:pse.id,port:'GigabitEthernet0/1'});sim.advance(1000);}
  for(const line of ['enable','configure terminal'])assert.ok(!cli.execute(line).some(row=>row.startsWith('%')),line);
  return {sim,device,cli};
}

for(const kind of ['router','switch','l3switch','poeswitch','wlc','ap'] as const)test(`COMP-${kind} question-mark and Tab use the live interface type without guessing a port`,()=>{
  const {sim,device,cli}=fixture(kind),before=JSON.stringify(device.config),history=[...cli.history],now=sim.clock.now(),events=sim.events.length;
  const physical=Object.keys(device.config.interfaces).find(name=>name.startsWith('GigabitEthernet'))!;
  for(const prefix of ['int gi','interface gi','INTERFACE GI']){assert.match(cli.help(prefix).join('\n'),/GigabitEthernet/);assert.doesNotMatch(cli.help(prefix).join('\n'),/INTERFACE\s+Interface name/);assert.equal(cli.complete(prefix),prefix.slice(0,prefix.lastIndexOf(' ')+1)+'GigabitEthernet');}
  assert.match(cli.help('interface ').join('\n'),/GigabitEthernet/);assert.match(cli.help('interface ').join('\n'),/range/);assert.equal(cli.complete('interface '),'interface ');
  assert.match(cli.help('interface gi ').join('\n'),/<\d+-\d+>/);
  const short=physical.replace('GigabitEthernet','gi');assert.equal(cli.complete('interface '+short),'interface '+physical+' ');assert.match(cli.help('interface '+short+' ').join('\n'),/<cr>/);
  assert.equal(JSON.stringify(device.config),before);assert.deepEqual(cli.history,history);assert.equal(sim.clock.now(),now);assert.equal(sim.events.length,events);
  assert.deepEqual(cli.execute('interface '+short),[]);assert.equal(cli.mode,'interface');
});

test('COMP-07 interface types coexist with keyword branches and numeric guidance follows slots and ports',()=>{
  const {cli}=fixture();
  assert.match(cli.help('interface ').join('\n'),/GigabitEthernet[\s\S]*Loopback[\s\S]*range/);
  assert.match(cli.help('int gi ').join('\n'),/<0-1>/);assert.match(cli.help('int gi0/').join('\n'),/<1-24>/);
  assert.match(cli.help('interface gi 0/3 ').join('\n'),/<cr>/);assert.deepEqual(cli.execute('interface gi 0/3'),[]);cli.execute('exit');
  assert.equal(cli.complete('int r'),'int range ');assert.equal(cli.complete('int gi0/'),'int GigabitEthernet0/');
  cli.execute('end');const help=cli.help('show interfaces ').join('\n');for(const word of ['GigabitEthernet','status','trunk','switchport','<cr>'])assert.ok(help.includes(word),word);
  assert.equal(cli.complete('show interfaces gi0/2'),'show interfaces GigabitEthernet0/2 ');assert.equal(cli.complete('show interfaces st'),'show interfaces status ');
});

test('COMP-08 virtual IDs and subinterface numbers are preserved exactly instead of completing a different interface',()=>{
  const {device,cli}=fixture('router');cli.execute('interface Loopback70');cli.execute('exit');
  const before=JSON.stringify(device.config);
  assert.equal(cli.complete('interface lo'),'interface Loopback');assert.equal(cli.complete('interface lo7'),'interface Loopback7 ');
  assert.match(cli.help('interface lo ').join('\n'),/<0-2147483647>/);assert.match(cli.help('interface Vlan ').join('\n'),/<1-4094>/);
  assert.equal(cli.complete('interface gi0/1.2'),'interface GigabitEthernet0/1.2 ');assert.match(cli.help('interface gi0/1.').join('\n'),/Subinterface number/);
  assert.equal(JSON.stringify(device.config),before);assert.equal(device.config.interfaces.Loopback7,undefined);
  assert.deepEqual(cli.execute('interface lo7'),[]);assert.ok(device.config.interfaces.Loopback7);
});

test('COMP-09 invalid interface fragments and ambiguous commands are left unchanged by Tab',()=>{
  const {cli}=fixture();for(const line of ['i','interface xyz','interface gi99/9','interface gi0/999','router z','interface ',''])assert.equal(cli.complete(line),line,line);
  assert.match(cli.help('interface xyz').join('\n'),/% Unrecognized command/);assert.match(cli.help('interface gi99/9').join('\n'),/% Unrecognized command/);
  assert.equal(cli.complete('no int gi'),'no int GigabitEthernet');assert.equal(cli.complete('default int gi'),'default int GigabitEthernet');
});

test('COMP-10 interface ranges offer types, last-port bounds and separators without changing the selection',()=>{
  const {cli,device}=fixture(),before=JSON.stringify(device.config);
  assert.match(cli.help('interface range ').join('\n'),/GigabitEthernet/);assert.equal(cli.complete('int range gi'),'int range GigabitEthernet');
  assert.match(cli.help('int range gi0/1 - ').join('\n'),/<1-24>/);assert.match(cli.help('int range gi 0/1 - ').join('\n'),/<1-24>/);
  assert.match(cli.help('int range gi0/1 ').join('\n'),/Last interface/);assert.match(cli.help('int range gi0/1 - 3 ').join('\n'),/<cr>/);
  assert.equal(cli.complete('int range gi0/1,gi'),'int range gi0/1,GigabitEthernet');assert.equal(JSON.stringify(device.config),before);
  assert.deepEqual(cli.execute('int range gi0/1 - 3'),[]);assert.equal(cli.mode,'range');
});

test('COMP-11 completion preserves argument and EXEC context for routing, negation, optional keywords and filters',()=>{
  const {cli}=fixture('router');
  for(const [input,expected]of [['ip nat inside source list INSIDE interface g0/0 ov','ip nat inside source list INSIDE interface g0/0 overload '],['no ip domain-lo','no ip domain-lookup '],['DO show ip rou','do show ip route ']])assert.equal(cli.complete(input),expected);
  assert.match(cli.help('ip nat inside source list INSIDE interface g0/0 ').join('\n'),/overload/);
  cli.execute('router bgp 65001');assert.equal(cli.complete('neighbor 192.0.2.1 rem'),'neighbor 192.0.2.1 remote-as ');assert.equal(cli.complete('neighbor 192.0.2.1 r'),'neighbor 192.0.2.1 r');
  cli.execute('end');assert.equal(cli.complete('show ip route | inc'),'show ip route | include ');assert.match(cli.help('show ip route | ').join('\n'),/include/);
});

test('COMP-12 caret completion preserves existing word suffixes, argument separators and selected text',()=>{
  const edit=(value:string,cursor:number,result:string,end=cursor)=>terminalCompletionEdit(value,cursor,end,result);
  assert.equal(edit('configure terminal',4,'configure ').value,'configure terminal');
  assert.equal(edit('conf terminal',4,'configure ').value,'configure terminal');
  assert.deepEqual(edit('interface gi0/3',12,'interface GigabitEthernet'),{value:'interface GigabitEthernet0/3',start:25,end:25});
  assert.equal(edit('show int status',8,'show interfaces ').value,'show interfaces status');
  assert.equal(edit('interface wrong',10,'interface GigabitEthernet',15).value,'interface GigabitEthernet');
  assert.deepEqual(edit('interface gi',10,'interface ',12),{value:'interface gi',start:10,end:12});
});
