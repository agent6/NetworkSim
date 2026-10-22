import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {iosRejected} from '../src/ios-help.ts';
import {nsosConfig} from '../src/datacenter.ts';

function setup(){
  const sim=new Simulator(20261022),device=sim.addDevice('datacenter');
  const cli=new NSOSSession(sim,device.id,{skipConsoleLogin:true});
  return {sim,device,cli};
}
function run(cli:NSOSSession,...commands:string[]){
  for(const command of commands){const output=cli.execute(command);assert.ok(!output.some(iosRejected),command+'\n'+output.join('\n'));}
}

test('NSOS vPC subsection can select a port-channel and apply the following interface configuration',()=>{
  const {device,cli}=setup();
  run(cli,'configure terminal','feature vpc','vpc domain 1','role priority 100','peer-keepalive destination 192.168.100.2 source 192.168.100.1');
  assert.match(cli.prompt,/\(config-vpc-domain\)#$/);
  run(cli,'interface port-channel1','description vPC_PEER_LINK','switchport','switchport mode trunk','vpc peer-link','no shutdown');
  assert.match(cli.prompt,/\(config-if\)#$/);
  const port=device.config.interfaces['Port-channel1'];
  assert.equal(port.description,'vPC_PEER_LINK');assert.equal(port.mode,'trunk');assert.equal(port.adminUp,true);
  assert.equal(nsosConfig(device).vpc?.peerLink,'Port-channel1');
  assert.equal(nsosConfig(device).vpc?.rolePriority,100);
  run(cli,'exit');assert.match(cli.prompt,/\(config\)#$/);
});

for(const [mode,enter] of [
  ['VLAN',['vlan 10']],['VRF',['vrf context BLUE']],['OSPF',['router ospf LAB']],
  ['OSPF VRF',['vrf context BLUE','exit','router ospf LAB','vrf BLUE']],
  ['MST',['spanning-tree mst configuration']],['ACL',['ip access-list NAV']],
] as const){
  test('NSOS interface selection, help and Tab work from '+mode+' configuration',()=>{
    const {device,cli}=setup();
    run(cli,'conf t','feature ospf',...enter);
    const prompt=cli.prompt,before=JSON.stringify(device.config);
    assert.match(cli.help('int').join('\n'),/interface/);
    assert.equal(cli.complete('int'),'interface ');
    assert.match(cli.help('interface ').join('\n'),/Ethernet1\/1/);
    assert.equal(cli.complete('interface Ethernet1/30'),'interface Ethernet1/30 ');
    assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
    run(cli,'int eth1/30','description selected from '+mode);
    assert.match(cli.prompt,/\(config-if\)#$/);
    assert.equal(device.config.interfaces['Ethernet1/30'].description,'selected from '+mode);
    run(cli,'exit');assert.match(cli.prompt,/\(config\)#$/);
  });
}

test('NSOS failed interface navigation preserves its subsection and configuration',()=>{
  const {device,cli}=setup();run(cli,'conf t','feature vpc','vpc domain 1');
  const prompt=cli.prompt,before=JSON.stringify(device.config);
  for(const command of ['interface','interface Ethernet1/99','interface port-channel0','interface vlan10']){
    assert.ok(cli.execute(command).some(iosRejected),command);
    assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
  }
  run(cli,'role priority 100');assert.equal(nsosConfig(device).vpc?.rolePriority,100);
});

test('NSOS configuration selectors replace the subsection while keeping local commands scoped',()=>{
  const {device,cli}=setup();
  run(cli,'conf t','feature vpc','feature ospf','vpc domain 1','interface port-channel1',
    'vlan 10','name Users','vrf context BLUE','ip route 203.0.113.0/24 192.0.2.2',
    'router ospf LAB','router-id 1.1.1.1','vrf BLUE','router-id 2.2.2.2',
    'spanning-tree mst configuration','name REGION','revision 7','ip access-list NAV','10 permit ip any any',
    'vpc domain 1','role priority 100','interface port-channel1','description peer-link');
  assert.equal(device.config.vlans[10].name,'Users');
  assert.equal(device.config.staticRoutes[0].vrf,'BLUE');
  assert.equal(device.config.protocols.ospf.routerId,'1.1.1.1');
  assert.equal(device.config.protocols.ospf.vrfs.BLUE.routerId,'2.2.2.2');
  assert.equal(device.config.features.stp.mst.name,'REGION');
  assert.equal(device.config.features.stp.mst.revision,7);
  assert.equal(device.config.features.acls.NAV.entries.length,1);
  const prompt=cli.prompt,before=JSON.stringify(device.config);
  for(const command of ['role priority 200','name Wrong','router-id 3.3.3.3','feature bgp']){
    assert.ok(cli.execute(command).some(iosRejected),command);
    assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
  }
});

test('NSOS inherited interface navigation preserves role checks and rejects configuration commands in EXEC',()=>{
  const {device,cli}=setup();
  device.config.features.users={viewer:{password:'viewerlab',role:'network-operator',privilege:1}};
  cli.setIdentity('viewer',true,'vty 0');
  run(cli,'conf t','interface Ethernet1/1');
  const prompt=cli.prompt,before=JSON.stringify(device.config);
  for(const command of ['interface port-channel1','vlan 10','vrf context BLUE','vpc domain 1']){
    assert.ok(cli.execute(command).some(iosRejected),command);
    assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
  }
  run(cli,'end');
  for(const command of ['interface Ethernet1/2','vpc domain 1','description wrong-mode','switchport'])assert.ok(cli.execute(command).some(iosRejected),command);
});

test('NSOS global commands entered in subsections return to global configuration without leaking VRF scope',()=>{
  const {device,cli}=setup();
  run(cli,'conf t','feature vpc','vpc domain 1','feature lldp');
  assert.match(cli.prompt,/\(config\)#$/);assert.equal(device.config.features.lldp,true);
  run(cli,'interface Ethernet1/1');
  const prompt=cli.prompt,before=JSON.stringify(device.config);
  assert.equal(cli.complete('hostn'),'hostname ');assert.match(cli.help('feature ').join('\n'),/lacp/);
  assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
  run(cli,'hostname NAV');assert.equal(cli.prompt,'NAV(config)#');
  run(cli,'vrf context BLUE','ip route 198.51.100.0/24 192.0.2.2');
  assert.equal(cli.mode,'vrf');assert.equal(device.config.staticRoutes[0].vrf,'BLUE');
  run(cli,'interface Ethernet1/1','no switchport','vrf member BLUE','ip route 203.0.113.0/24 192.0.2.2');
  assert.equal(cli.prompt,'NAV(config)#');assert.equal(device.config.staticRoutes[1].vrf,undefined);
  run(cli,'vpc domain 1','no vpc domain 1');assert.equal(cli.prompt,'NAV(config)#');assert.equal(nsosConfig(device).vpc,undefined);
});

test('NSOS rejected inherited globals preserve the current context, configuration and authorization',()=>{
  const {device,cli}=setup();run(cli,'conf t','feature vpc','vpc domain 1');
  let prompt=cli.prompt,before=JSON.stringify(device.config);
  for(const command of ['hostname','hostname invalid/name','feature bgp','ip route 203.0.113.0/99 192.0.2.2','spanning-tree vlan 10 priority 7']){
    assert.ok(cli.execute(command).some(iosRejected),command);
    assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
  }
  run(cli,'interface Ethernet1/1');cli.setIdentity('viewer',true,'vty 0');
  prompt=cli.prompt;before=JSON.stringify(device.config);
  for(const command of ['hostname Unauthorized','feature lldp','ip route 203.0.113.0/24 192.0.2.2']){
    assert.match(cli.execute(command).join('\n'),/Permission denied/);
    assert.equal(cli.prompt,prompt);assert.equal(JSON.stringify(device.config),before);
  }
});

test('NSOS mode transitions and rejection behavior match the bounded NX-OS CML observations',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../scripts/cml/fixtures/nxos-navigation-observations.json',import.meta.url),'utf8'));
  assert.equal(fixture.version,'10.6(2)');assert.equal(fixture.observations.length,23);
  const enter:Record<string,string[]>={
    priv:[],config:['conf t'],interface:['conf t','interface port-channel1','switchport mode trunk'],
    vpc:['conf t','vpc domain 1'],vlan:['conf t','vlan 10'],vrf:['conf t','vrf context BLUE'],
    router:['conf t','router ospf LAB'],'router-vrf':['conf t','router ospf LAB','vrf BLUE'],
    mst:['conf t','spanning-tree mst configuration'],acl:['conf t','ip access-list NAV'],
  };
  for(const observation of fixture.observations){
    const {cli}=setup();run(cli,'conf t','feature vpc','feature ospf','vrf context BLUE','vpc domain 1','end',...enter[observation.from]);
    const output=cli.execute(observation.command);
    assert.equal(!output.some(iosRejected),observation.accepted,observation.command+'\n'+output.join('\n'));
    assert.equal(cli.mode,observation.to,observation.from+': '+observation.command);
    assert.match(observation.rawSha256,/^[a-f0-9]{64}$/);
  }
});
