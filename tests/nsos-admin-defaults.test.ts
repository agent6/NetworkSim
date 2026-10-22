import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {iosRejected} from '../src/ios-help.ts';
import {renderNSOSConfig} from '../src/nsos-config.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
function setup(){const sim=new Simulator(),d=sim.addDevice('datacenter'),cli=new NSOSSession(sim,d.id,{skipConsoleLogin:true});return {sim,d,cli};}
function run(cli:NSOSSession,...commands:string[]){for(const c of commands)assert.ok(!cli.execute(c).some(iosRejected),c);}

test('native physical defaults follow Layer 2/3 mode until an explicit shutdown choice overrides them',()=>{
 const {d,cli}=setup(),p=d.config.interfaces['Ethernet1/4'];assert.equal(p.adminUp,true);
 run(cli,'conf t','interface e1/4','no switchport');assert.equal(p.adminUp,false);
 run(cli,'switchport');assert.equal(p.adminUp,true);
 for(const up of [false,true]){
  run(cli,up?'no shutdown':'shutdown','no switchport');assert.equal(p.adminUp,up);
  run(cli,'switchport');assert.equal(p.adminUp,up);assert.equal(p.features.nsosAdminExplicit,true);
 }
});

test('a default routed interface cannot forward until enabled, and the override survives later mode changes',()=>{
 const {sim,d,cli}=setup(),host=sim.addDevice('pc'),p=host.config.interfaces.GigabitEthernet0;
 delete p.features.dhcp;Object.assign(p,{ip:'192.0.2.2',mask:'255.255.255.0'});
 sim.connect({deviceId:d.id,port:'Ethernet1/4'},{deviceId:host.id,port:p.name});
 run(cli,'conf t','interface e1/4','no switchport','ip address 192.0.2.1/24','end');
 assert.equal(sim.interfaceUp(d.id,'Ethernet1/4'),false);
 const down=sim.ping(host.id,'192.0.2.1',{count:1,timeout:500});assert.equal(sim.advance(1000,100000).targetReached,true);assert.equal(down.received,0);
 run(cli,'conf t','interface e1/4','no shutdown','end');
 const up=sim.ping(host.id,'192.0.2.1',{count:3,interval:20,timeout:1000});assert.equal(sim.advance(4000,100000).targetReached,true);assert.equal(up.received,3);
 run(cli,'conf t','interface e1/4','switchport','no switchport','end');assert.equal(d.config.interfaces['Ethernet1/4'].adminUp,true);
});

test('default and explicit administrative states survive portable lab and CLI configuration replay',()=>{
 const {sim,d,cli}=setup();
 run(cli,'conf t','interface e1/1','no switchport','interface e1/2','no shutdown','no switchport','interface e1/3','shutdown','interface po1','interface po2','shutdown','end');
 const expected=[false,true,false,true,false],ports=['Ethernet1/1','Ethernet1/2','Ethernet1/3','Port-channel1','Port-channel2'];
 const loaded=new Simulator();loaded.load(parseLabFile(serializeLabFile(sim.serialize())));
 const restored=loaded.lab.devices[0];assert.deepEqual(ports.map(p=>restored.config.interfaces[p].adminUp),expected);
 const text=renderNSOSConfig(d).join('\n'),other=sim.addDevice('datacenter'),replay=new NSOSSession(sim,other.id,{skipConsoleLogin:true});
 other.config.features.files={source:text};run(replay,'copy bootflash:source running-config');
 assert.deepEqual(ports.map(p=>other.config.interfaces[p].adminUp),expected);assert.equal(renderNSOSConfig(other).join('\n'),text);
});

test('legacy lab states stay explicit and malformed administrative metadata is rejected',()=>{
 const {sim,d}=setup(),p=d.config.interfaces['Ethernet1/1'];delete p.features.nsosAdminExplicit;p.adminUp=false;
 const loaded=new Simulator();loaded.load(parseLabFile(serializeLabFile(sim.serialize())));
 const old=loaded.lab.devices[0],cli=new NSOSSession(loaded,old.id,{skipConsoleLogin:true});
 assert.equal(old.config.interfaces[p.name].adminUp,false);run(cli,'conf t','interface e1/1','no switchport','switchport');assert.equal(old.config.interfaces[p.name].adminUp,false);
 run(cli,'no shutdown');assert.equal(old.config.interfaces[p.name].adminUp,true);
 p.features.nsosAdminExplicit='invalid';assert.throws(()=>parseLabFile(JSON.stringify(sim.serialize())),/administrative override/);
});
