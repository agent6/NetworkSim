import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {iosRejected} from '../src/ios-help.ts';
import {addDatacenterHost} from './helpers/datacenter.ts';

function run(cli:NSOSSession,...commands:string[]){for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}}
function setup(){const sim=new Simulator(20261022),device=sim.addDevice('datacenter'),cli=new NSOSSession(sim,device.id,{skipConsoleLogin:true});return {sim,device,cli};}

test('NSOS spaced interface selectors and physical ranges work directly from vPC mode',()=>{
  const {device,cli}=setup();
  run(cli,'conf t','feature vpc','feature lacp','vpc domain 1','interface port-channel 1','switchport mode trunk','vpc peer-link','no shutdown',
    'interface ethernet 1/1-2','description PEER_LINK_MEMBER','switchport mode trunk','channel-group 1 mode active','no shutdown');
  assert.match(cli.prompt,/\(config-if-range\)#$/);
  for(const name of ['Ethernet1/1','Ethernet1/2']){
    const p=device.config.interfaces[name];assert.equal(p.description,'PEER_LINK_MEMBER');assert.equal(p.features.channelGroup,1);assert.equal(p.adminUp,true);
  }
  assert.equal(cli.history.filter(line=>line==='description PEER_LINK_MEMBER').length,1);
  run(cli,'interface e 1/3');assert.match(cli.prompt,/\(config-if\)#$/);
  run(cli,'interface Ethernet1/1-2','hostname DC-RANGE');assert.equal(cli.prompt,'DC-RANGE(config)#');
});

test('NSOS range configuration negotiates and forwards over both actual LACP members, fails and recovers',()=>{
  const {sim,device:a,cli}=setup(),b=sim.addDevice('datacenter'),peer=new NSOSSession(sim,b.id,{skipConsoleLogin:true});
  for(const session of [cli,peer])run(session,'conf t','feature lacp','interface ethernet 1/1-2','switchport mode trunk','channel-group 1 mode active','no shutdown','interface port-channel 1','no shutdown','end');
  for(const port of ['Ethernet1/1','Ethernet1/2'])sim.connect({deviceId:a.id,port},{deviceId:b.id,port});
  const left=addDatacenterHost(sim,a,'Ethernet1/3','192.0.2.1',1),right=addDatacenterHost(sim,b,'Ethernet1/3','192.0.2.2',1);
  sim.changed();sim.advance(40000);
  const ping=()=>{const p=sim.ping(left.id,'192.0.2.2',{count:3,interval:20,timeout:1000});sim.advance(4000);return p.received;};
  assert.deepEqual(a.runtime.features.portChannels[1].activeMembers,['Ethernet1/1','Ethernet1/2']);assert.equal(ping(),3);
  run(cli,'conf t','interface e1/1-2','shutdown','end');sim.advance(4000);assert.equal(ping(),0);
  run(cli,'conf t','interface ethernet 1/1-2','no shutdown','end');sim.advance(40000);assert.equal(ping(),3);
  assert.equal(right.config.interfaces.GigabitEthernet0.ip,'192.0.2.2');
});

test('NSOS spaced argument help and completion preserve context and require the interface number',()=>{
  const {cli,device}=setup();run(cli,'conf t','feature vpc','vpc domain 1');
  const prompt=cli.prompt,before=JSON.stringify(device.config);
  assert.match(cli.help('interface ethernet ').join('\n'),/1\/30/);
  assert.doesNotMatch(cli.help('interface ethernet ').join('\n'),/<CR>/);
  assert.equal(cli.complete('interface Ethernet 1/30'),'interface Ethernet 1/30 ');
  assert.match(cli.execute('interface ethernet').join('\n'),/Incomplete/);
  assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
});

test('NSOS range validation and a failed later interface operation cannot retain partial changes',()=>{
  const {cli,device}=setup();run(cli,'conf t','interface e1/1','no switchport','interface e1/1-2');
  const prompt=cli.prompt,before=JSON.stringify(device.config);
  assert.ok(cli.execute('ip address 192.0.2.1/24').some(iosRejected));assert.equal(JSON.stringify(device.config),before);assert.equal(cli.prompt,prompt);
  for(const command of ['interface ethernet 1/1-99','interface ethernet 1/3-1','no interface ethernet 1/1-2']){
    assert.ok(cli.execute(command).some(iosRejected),command);assert.equal(JSON.stringify(device.config),before);assert.equal(cli.prompt,prompt);
  }
});

test('NSOS range changes retain port-channel member protection and network-operator authorization',()=>{
  const {cli,device}=setup();
  run(cli,'conf t','feature lacp','interface e1/1-2','switchport mode trunk','channel-group 1 mode active');
  let before=JSON.stringify(device.config);
  assert.match(cli.execute('switchport trunk allowed vlan 1').join('\n'),/Port-channel1/);assert.equal(JSON.stringify(device.config),before);
  cli.setIdentity('viewer',true,'vty 0');run(cli,'interface e1/3-4');before=JSON.stringify(device.config);
  assert.match(cli.execute('description unauthorized').join('\n'),/Permission denied/);assert.equal(JSON.stringify(device.config),before);
});
