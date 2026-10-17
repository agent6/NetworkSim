import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {terminalRows} from '../src/ios-terminal.ts';

function run(c:IOSSession,...commands:string[]) {
  for(const command of commands)assert.ok(!c.execute(command).some(line=>line.startsWith('%')),command);
}

test('attached terminal columns replace the 80-column fallback and preserve wide table headers',()=>{
  const s=new Simulator(),d=s.addDevice('switch'),c=new IOSSession(s,d.id),before=JSON.stringify(s.serialize());
  run(c,'enable');assert.equal(c.pageWidth,80);
  c.setViewportColumns(190);assert.match(c.execute('show terminal').join('\n'),/Width: 190 columns/);
  const table=c.execute('show ip interface brief');assert.ok(table[0].length>80);assert.deepEqual(terminalRows(table,c.pageWidth),table);
  const history=[...c.commandHistory];c.setViewportColumns(65);assert.equal(c.pageWidth,65);
  const narrow=terminalRows(table,c.pageWidth);assert.ok(narrow.every(row=>[...row].length<=65));assert.equal(narrow.join(''),table.join(''));
  assert.deepEqual(c.commandHistory,history);assert.equal(JSON.stringify(s.serialize()),before,'terminal geometry is session metadata, not device configuration');
  c.setViewportColumns(0);c.setViewportColumns(NaN);assert.equal(c.pageWidth,65);c.setViewportColumns(10000);assert.equal(c.pageWidth,512);
});

test('an explicit IOS width, including zero, survives window resizing',()=>{
  const s=new Simulator(),d=s.addDevice('switch'),c=new IOSSession(s,d.id);c.setViewportColumns(190);
  run(c,'terminal width 132');c.setViewportColumns(65);assert.equal(c.pageWidth,132);assert.match(c.execute('show terminal').join('\n'),/Width: 132 columns/);
  const lines=['Interface and protocol columns remain on their original output row. '.repeat(8)];
  assert.ok(terminalRows(lines,c.pageWidth).every(row=>[...row].length<=132));
  run(c,'terminal width 0');c.setViewportColumns(40);assert.equal(c.pageWidth,0);assert.deepEqual(terminalRows(lines,c.pageWidth),lines);
});

test('configured console-line widths take precedence over automatic sizing without leaking into other sessions',()=>{
  const s=new Simulator(),d=s.addDevice('switch');d.config.features.lines={'console 0':{width:100}};
  const c=new IOSSession(s,d.id);c.setViewportColumns(180);assert.equal(c.pageWidth,100);run(c,'terminal width 0');
  const fresh=new IOSSession(s,d.id);fresh.setViewportColumns(160);assert.equal(fresh.pageWidth,100);
  d.config.features.lines['console 0'].width=0;const unwrapped=new IOSSession(s,d.id);unwrapped.setViewportColumns(160);assert.equal(unwrapped.pageWidth,0);
});

for(const [kind,protocol]of [['pc','ssh'],['router','ssh'],['router','telnet']] as const)test(`${kind} ${protocol}: remote width follows attached columns, while explicit remote widths stay fixed`,()=>{
  const s=new Simulator(),client=s.addDevice(kind),target=s.addDevice('router'),c=new IOSSession(s,client.id),r=new IOSSession(s,target.id),port=kind==='pc'?'GigabitEthernet0':'GigabitEthernet0/0';
  Object.assign(client.config.interfaces[port],{ip:'192.0.2.10',mask:'255.255.255.0',adminUp:true});delete client.config.interfaces[port].features.dhcp;
  run(r,'enable','configure terminal','interface g0/0','ip address 192.0.2.1 255.255.255.0','no shutdown','exit','ip domain-name lab.example','crypto key generate rsa modulus 2048','ip ssh version 2','username admin privilege 15 secret testpass','line vty 0 4','login local','transport input ssh telnet','end');
  s.connect({deviceId:client.id,port},{deviceId:target.id,port:'GigabitEthernet0/0'});c.setViewportColumns(190);
  run(c,protocol==='ssh'?'ssh -l admin 192.0.2.1':'telnet 192.0.2.1');if(protocol==='telnet')run(c,'admin');run(c,'testpass');assert.equal(c.prompt,target.config.hostname+'#');
  assert.match(c.execute('show terminal').join('\n'),/Width: 190 columns/);assert.equal(c.pageWidth,190);
  c.setViewportColumns(115);assert.match(c.execute('show terminal').join('\n'),/Width: 115 columns/);assert.equal(c.pageWidth,115);
  run(c,'terminal width 132');c.setViewportColumns(60);assert.match(c.execute('show terminal').join('\n'),/Width: 132 columns/);assert.equal(c.pageWidth,132);
  run(c,'terminal width 0');c.setViewportColumns(170);c.pollOutput();assert.equal(c.pageWidth,0);
  run(c,'exit');assert.equal(c.pageWidth,170);assert.ok(s.events.some(e=>e.protocol==='TCP'),'width information accompanies the actual simulated management transport');
});

test('VTY line width overrides a client window and does not alter the physical console width',()=>{
  const s=new Simulator(),a=s.addDevice('router'),b=s.addDevice('router'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id);
  for(const [c,address]of [[ca,'192.0.2.1'],[cb,'192.0.2.2']] as const)run(c,'enable','conf t','interface g0/0','ip address '+address+' 255.255.255.0','no shutdown','end');
  run(cb,'conf t','line vty 0 4','transport input telnet','no login','width 100','end');
  s.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});ca.setViewportColumns(190);cb.setViewportColumns(175);
  run(ca,'telnet 192.0.2.2');assert.match(ca.execute('show terminal').join('\n'),/Width: 100 columns/);assert.equal(ca.pageWidth,100);assert.equal(cb.pageWidth,175);
});
