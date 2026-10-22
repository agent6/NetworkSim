import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {iosRejected} from '../src/ios-help.ts';
import {renderNSOSConfig} from '../src/nsos-config.ts';
import {addDatacenterHost,advanceSimulation as advance} from './helpers/datacenter.ts';
function run(cli:NSOSSession,...commands:string[]){for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}}
function setup(routed=false){
 const sim=new Simulator(),d=sim.addDevice('datacenter'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true});
 run(cli,'conf t','feature lacp','interface e1/27-28',...(routed?['no switchport']:['switchport mode trunk']),'channel-group 1 mode active','no shutdown','end');
 return {sim,d,cli};
}

test('explicit and automatically created port-channels start enabled, and an explicit shutdown survives reapplication',()=>{
 const {d,cli}=setup();assert.equal(d.config.interfaces['Port-channel1'].adminUp,true);
 run(cli,'conf t','interface port-channel2');assert.equal(d.config.interfaces['Port-channel2'].adminUp,true);
 run(cli,'shutdown','interface e1/25-26','channel-group 2 mode on','end');
 assert.equal(d.config.interfaces['Port-channel2'].adminUp,false);
 run(cli,'conf t','interface e1/25-26','channel-group 2 mode on','end');assert.equal(d.config.interfaces['Port-channel2'].adminUp,false);
});
for(const routed of[false,true])test(`${routed?'routed':'Layer 2'} member mode commands match native individual and range contexts`,()=>{
 const {d,cli}=setup(routed);run(cli,'conf t','interface e1/27');
 const before=JSON.stringify(d.config);
 for(const command of ['switchport','no switchport']){
  assert.match(cli.execute(command).join('\n'),routed?/Invalid command/:/Incomplete command/);assert.equal(JSON.stringify(d.config),before);
  assert.doesNotMatch(cli.help(command+' ').join('\n'),/<CR>/);
 }
 if(routed)assert.deepEqual(cli.help('switchport '),[]);
 run(cli,'interface e1/27-28',routed?'no switchport':'switchport');assert.equal(JSON.stringify(d.config),before);
 assert.match(cli.help((routed?'no switchport':'switchport')+' ').join('\n'),/<CR>/);
 assert.match(cli.execute(routed?'switchport':'no switchport').join('\n'),/ERROR: : port already in a port-channel, no config allowed/);assert.equal(JSON.stringify(d.config),before);
});

test('reapplying the screenshot member configuration leaves both LACP links and real forwarding operational',()=>{
 const {sim,d:a,cli}=setup(),b=sim.addDevice('datacenter'),peer=new NSOSSession(sim,b.id,{skipConsoleLogin:true});
 run(peer,'conf t','feature lacp','interface e1/27-28','switchport mode trunk','channel-group 1 mode active','no shutdown','end');
 for(const port of ['Ethernet1/27','Ethernet1/28'])sim.connect({deviceId:a.id,port},{deviceId:b.id,port});
 const left=addDatacenterHost(sim,a,'Ethernet1/1','192.0.2.1',1),right=addDatacenterHost(sim,b,'Ethernet1/1','192.0.2.2',1);sim.changed();advance(sim,40000);
 const reachable=()=>{const p=sim.ping(left.id,right.config.interfaces.GigabitEthernet0.ip!,{count:3,interval:20,timeout:1000});advance(sim,4000);assert.equal(p.received,3);};
 reachable();
 const channel=structuredClone(a.runtime.features.portChannels[1]);
 run(cli,'conf t','interface e1/27-28','switchport','switchport mode trunk','channel-group 1 mode active','no shutdown','end');
 assert.deepEqual(a.runtime.features.portChannels[1].activeMembers,channel.activeMembers);
 reachable();
 // NVGEN repeats logical and physical settings; replay must also be safe on an existing bundle.
 const rendered=renderNSOSConfig(a).join('\n');a.config.features.files={replay:rendered};run(cli,'copy bootflash:replay running-config');assert.equal(renderNSOSConfig(a).join('\n'),rendered);reachable();
});

test('no-op member mode commands retain configuration authorization',()=>{
 const {d,cli}=setup();run(cli,'conf t','interface e1/27-28');cli.setIdentity('viewer',true,'vty 0');
 const before=JSON.stringify(d.config);assert.match(cli.execute('switchport').join('\n'),/Permission denied/);assert.equal(JSON.stringify(d.config),before);
});
