import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {NSOSSession} from '../src/nsos.ts';
import {createCLISession} from '../src/session.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {nsosConfig,nsosFeature} from '../src/datacenter.ts';
import {factoryDeviceConfig} from '../src/model.ts';
import {parseDocument,parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {IOS_BOOT_DURATION,iosBootStages} from '../src/ios-boot.ts';
import {snmpMIB,snmpGet} from '../src/snmp.ts';
import {runAutomation,validateAutomation} from '../src/automation.ts';
import {platformSoftware} from '../src/platform-identity.ts';
import {managementFor} from '../src/management.ts';
import {iosRejected} from '../src/ios-help.ts';

function setup(seed=9601){
  const sim=new Simulator(seed),d=sim.addDevice('datacenter'),cli=createCLISession(sim,d.id,{skipConsoleLogin:true}) as NSOSSession;
  return {sim,d,cli};
}
function run(cli:Pick<NSOSSession,'execute'>,...commands:string[]):void{
  for(const line of commands){const output=cli.execute(line);assert.ok(!output.some(iosRejected),line+'\n'+output.join('\n'));}
}
const text=(cli:Pick<NSOSSession,'execute'>,line:string)=>cli.execute(line).join('\n');
function reject(cli:NSOSSession,line:string,pattern=/%/):void{assert.match(text(cli,line),pattern,line);}

test('NSOS factory exposes 24 access-facing and 6 uplink Ethernet ports plus isolated mgmt0',()=>{
  const {sim,d,cli}=setup();
  assert.ok(cli instanceof NSOSSession);assert.match(cli.prompt,/#$/);assert.doesNotMatch(cli.prompt,/>$/);
  assert.equal(Object.keys(d.config.interfaces).length,31);
  for(let n=1;n<=30;n++){
    const p=d.config.interfaces['Ethernet1/'+n];
    assert.equal(p.speed,n<=24?10000:40000);assert.equal(p.adminUp,false);assert.equal(p.switchport,true);assert.equal(p.mode,'access');assert.equal(p.vlan,1);
    assert.deepEqual(p.features.ethernetSpeeds,n<=24?[1000,10000]:[1000,10000,40000]);assert.equal(p.features.speedAuto,true);
  }
  assert.equal(d.config.interfaces.mgmt0.vrf,'management');assert.equal(d.config.interfaces.mgmt0.speed,1000);
  assert.equal(d.config.interfaces.mgmt0.features.proxyArp,false);assert.equal(d.config.features.stp.pathcostMethod,'short');
  assert.deepEqual(nsosConfig(d).enabled,['ssh']);assert.equal(d.config.features.vtp.enabled,false);
  const old=sim.addDevice('switch'),before=JSON.stringify(old.config);
  assert.deepEqual(nsosConfig(old),{enabled:[]});assert.equal(JSON.stringify(old.config),before);
  assert.equal(Object.keys(factoryDeviceConfig('switch','SW').interfaces).length,26);
});

test('NSOS identity is consistent across shows, boot, received discovery and SNMP',()=>{
  const {sim,d,cli}=setup(9602),router=sim.addDevice('router');
  run(cli,'configure terminal','feature lldp','interface Ethernet1/1','no shutdown','end');
  router.config.interfaces['GigabitEthernet0/0'].adminUp=true;router.config.features.lldp=true;
  sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:router.id,port:'GigabitEthernet0/0'});sim.advance(100);
  assert.match(text(cli,'show version'),/NetSim NS-OS Software \(NS-DC24-6Q\)/);
  assert.match(text(cli,'show inventory'),/PID: NS-DC24-6Q/);
  assert.match(iosBootStages(d).flatMap(s=>s.lines).join('\n'),/NS-DC24-6Q.*NS-OS/);
  assert.equal(snmpMIB(sim,d).find(r=>r.oid==='1.3.6.1.2.1.1.1.0')?.value,platformSoftware('datacenter')+'; virtual platform, read-only educational agent');
  assert.equal(snmpMIB(sim,d).find(r=>r.oid==='1.3.6.1.2.1.1.7.0')?.value,6);
  assert.equal(snmpMIB(sim,d).find(r=>r.oid==='1.3.6.1.2.1.31.1.1.1.15.25')?.value,40000);
  const rc=new IOSSession(sim,router.id),cdp=text(rc,'show cdp neighbors detail');
  assert.match(cdp,/NS-DC24-6Q/);assert.match(cdp,/NS-OS Software/);
  assert.equal(sim.ethernetState(d.id,'Ethernet1/1')?.speed,1000);
});

test('NSOS strict grammar, argument help and completion reject IOS-only syntax without mutation',()=>{
  const {d,cli}=setup(9603);
  reject(cli,'enable');reject(cli,'configure',/Incomplete/);
  assert.equal(cli.complete('conf'),'configure ');assert.match(cli.help('configure ').join('\n'),/terminal/);
  for(const show of ['show interface status','show interface brief','show interface trunk','sh int st','sh int b','show interface Ethernet1/1','show interface Ethernet1/1 switchport'])
    assert.ok(!cli.execute(show).some(iosRejected),show);
  assert.match(text(cli,'show interface status'),/Ethernet1\/30/);
  assert.match(text(cli,'sh int st'),/Ethernet1\/30/);
  reject(cli,'show i',/Ambiguous/);
  run(cli,'conf t');
  assert.match(cli.help('feature ').join('\n'),/lacp/);assert.doesNotMatch(cli.help('feature ').join('\n'),/bgp|hsrp/);
  assert.equal(cli.complete('interface eth'),'interface Ethernet1/');
  run(cli,'interface eth1/1');
  assert.match(cli.help('switchport mode ').join('\n'),/access[\s\S]*trunk/);
  assert.doesNotMatch(cli.help('switchport mode ').join('\n'),/dynamic/);
  const before=JSON.stringify(d.config);
  for(const line of ['switchport mode dynamic desirable','switchport nonegotiate','channel-group 1 mode desirable','ip address 10.0.0.1 255.255.255.0','ip ospf 1 area 0','spanning-tree portfast','config-register 0x2142'])reject(cli,line);
  assert.equal(JSON.stringify(d.config),before);
  run(cli,'end','configure terminal');reject(cli,'feature bgp');reject(cli,'router eigrp 1');reject(cli,'vtp mode server');
});

test('NSOS feature gates, practical access/trunk configuration and speed/MTU validation',()=>{
  const {d,cli}=setup(9604);
  run(cli,'conf t');reject(cli,'interface vlan10',/interface-vlan/);
  run(cli,'feature interface-vlan','feature lacp','vlan 10,20','name Users','exit','interface Ethernet1/25','switchport mode trunk','switchport trunk allowed vlan 10,20','switchport trunk allowed vlan add 30','switchport trunk allowed vlan remove 20','switchport trunk native vlan 10','mtu 9216','speed 40000','spanning-tree port type network','no shutdown');
  assert.deepEqual(d.config.interfaces['Ethernet1/25'].allowedVlans,[10,30]);assert.equal(d.config.interfaces['Ethernet1/25'].features.stpPortType,'network');
  run(cli,'interface Ethernet1/1');reject(cli,'speed 40000',/Unsupported speed/);reject(cli,'mtu 9999');reject(cli,'channel-group 1 mode auto');
  run(cli,'speed 1000','speed auto','spanning-tree port type edge trunk','end');
  assert.equal(d.config.interfaces['Ethernet1/1'].speed,10000);assert.equal(d.config.interfaces['Ethernet1/1'].features.portfast,true);
  assert.doesNotMatch(text(cli,'show interface Ethernet1/25 switchport'),/DTP|dynamic|PAgP|private-vlan/);
});

test('NSOS static and LACP port-channel modes use actual negotiated state and enforce feature dependencies',()=>{
  const {sim,d,cli}=setup(9605),peer=sim.addDevice('datacenter'),pc=createCLISession(sim,peer.id,{skipConsoleLogin:true}) as NSOSSession;
  for(const s of [cli,pc]){
    run(s,'conf t','interface Ethernet1/25');reject(s,'channel-group 10 mode active',/lacp/);
    run(s,'end','conf t','feature lacp','interface Ethernet1/25','switchport mode trunk','channel-group 10 mode active','no shutdown','interface Port-channel10','no shutdown','end');
  }
  sim.connect({deviceId:d.id,port:'Ethernet1/25'},{deviceId:peer.id,port:'Ethernet1/25'});sim.advance(5000);
  assert.equal(d.runtime.features.portChannels['10'].state,'up');
  assert.match(text(cli,'show port-channel summary'),/Port-channel10.*up.*Ethernet1\/25\(P\)/);
  run(cli,'conf t','interface Port-channel10','switchport trunk allowed vlan 1,10','end');
  assert.deepEqual(d.config.interfaces['Ethernet1/25'].allowedVlans,[1,10]);
  run(cli,'conf t','interface Ethernet1/25');reject(cli,'switchport trunk allowed vlan 1',/Port-channel10/);run(cli,'end');
  run(cli,'conf t');reject(cli,'no feature lacp',/Remove configured LACP/);
  run(cli,'interface Ethernet1/25','no channel-group','end','conf t','no feature lacp','interface Ethernet1/1','channel-group 20 mode on','end');
  assert.equal(nsosFeature(d,'lacp'),false);assert.equal(d.config.interfaces['Ethernet1/1'].features.channelMode,'on');
});

test('NSOS routed ports, VRF membership, SVI and IPv4/IPv6 static routes are real forwarding configuration',()=>{
  const {sim,d,cli}=setup(9606),host=sim.addDevice('pc');
  run(cli,'conf t','feature interface-vlan','vrf context TENANT','ip route 203.0.113.0/24 192.0.2.2','ipv6 route 2001:db8:2::/64 2001:db8:1::2','exit','interface Ethernet1/1','no switchport','vrf member TENANT','ip address 192.0.2.1/24','ipv6 address 2001:db8:1::1/64','no shutdown','end');
  assert.equal(d.config.staticRoutes[0].vrf,'TENANT');
  const hp=host.config.interfaces.GigabitEthernet0;hp.ip='192.0.2.2';hp.mask='255.255.255.0';delete hp.features.dhcp;
  sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:host.id,port:'GigabitEthernet0'});sim.advance(1000);
  const ping=sim.ping(d.id,'192.0.2.2',{count:1,vrf:'TENANT'});sim.advance(3000);assert.equal(ping.status,'success');
  assert.match(text(cli,'show ip route vrf TENANT'),/203.0.113.0\/24/);
  assert.doesNotMatch(text(cli,'show ip route'),/203.0.113.0/);
  run(cli,'conf t','interface Ethernet1/1','no vrf member');
  assert.equal(d.config.interfaces['Ethernet1/1'].ip,undefined);
  run(cli,'interface Vlan10','ip address 10.10.10.1/24','no shutdown','end');
  run(cli,'conf t','interface mgmt0');reject(cli,'no vrf member',/management VRF/);reject(cli,'switchport',/dedicated/);
  run(cli,'end','conf t','feature ospf','interface mgmt0');reject(cli,'ip router ospf MGMT area 0',/mgmt0/);
});

test('NSOS named OSPF exchanges packets, uses feature gate and rejects multiple instances within a VRF',()=>{
  const {sim,d,cli}=setup(9607),other=sim.addDevice('datacenter'),peer=createCLISession(sim,other.id,{skipConsoleLogin:true}) as NSOSSession;
  for(const [s,address,rid] of [[cli,'10.0.0.1','1.1.1.1'],[peer,'10.0.0.2','2.2.2.2']] as const){
    run(s,'conf t');reject(s,'router ospf FABRIC',/ospf/);
    run(s,'feature ospf','router ospf FABRIC','router-id '+rid,'exit','interface Ethernet1/1','no switchport','ip address '+address+'/30','ip router ospf FABRIC area 0','no shutdown','end');
  }
  sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:other.id,port:'Ethernet1/1'});sim.advance(45000);
  assert.match(text(cli,'show ip ospf neighbors'),/2\.2\.2\.2.*FULL/);
  run(cli,'conf t','router ospf SECOND');reject(cli,'router-id 3.3.3.3',/one OSPF instance per VRF/);
  assert.equal(d.config.protocols.ospf.nsosTag,'FABRIC');
  run(cli,'end','conf t','vrf context RED','exit','router ospf SECOND','vrf RED','router-id 3.3.3.3','end');
  assert.equal(d.config.protocols.ospf.vrfs.RED.nsosTag,'SECOND');
});

test('NSOS VTP is disabled by default and only operational transparent version 1/2 is exposed',()=>{
  const {d,cli}=setup(9608);
  run(cli,'conf t');reject(cli,'vtp mode transparent',/not enabled/);
  run(cli,'feature vtp','vtp mode transparent','vtp domain LAB','vtp version 2');
  reject(cli,'vtp version 3');reject(cli,'vtp mode client');
  run(cli,'no feature vtp','end');assert.equal(d.config.features.vtp.enabled,false);assert.match(text(cli,'show vtp status'),/disabled/);
});

test('NSOS local and packet-delivered SSH sessions enforce named roles, not # or IOS enable privilege',()=>{
  const {sim,d,cli}=setup(9609),host=sim.addDevice('pc');
  run(cli,'conf t','username admin password adminlab role network-admin','username viewer password viewerlab role network-operator','feature ssh','interface mgmt0','ip address 192.0.2.1/24','end');
  const hp=host.config.interfaces.GigabitEthernet0;delete hp.features.dhcp;hp.ip='192.0.2.2';hp.mask='255.255.255.0';
  sim.connect({deviceId:d.id,port:'mgmt0'},{deviceId:host.id,port:'GigabitEthernet0'});sim.advance(1000);
  const console=createCLISession(sim,d.id) as NSOSSession;assert.equal(console.prompt,'login:');
  run(console,'viewer','viewerlab');assert.match(console.prompt,/#$/);
  run(console,'configure terminal');reject(console,'hostname Wrong',/Permission denied/);reject(console,'show running-config',/Permission denied/);
  console.setPrivilege(15);reject(console,'show startup-config',/Permission denied/);
  const controller=managementFor(sim,id=>new IOSSession(sim,id,{skipConsoleLogin:true}));
  const opened=controller.open(host.id,'192.0.2.1',22,'viewer');assert.equal(opened.status,'success');assert.equal(opened.passwordInput,true);
  const authed=controller.send(host.id,'192.0.2.1',22,opened.sessionId,'viewerlab');assert.match(authed.prompt,/#$/);
  const cfg=controller.send(host.id,'192.0.2.1',22,opened.sessionId,'configure terminal');assert.match(cfg.prompt,/\(config\)#$/);
  assert.match(controller.send(host.id,'192.0.2.1',22,opened.sessionId,'hostname Wrong').output.join('\n'),/Permission denied/);
  assert.match(controller.send(host.id,'192.0.2.1',22,opened.sessionId,'show version').output.join('\n'),/NS-OS/);
  assert.equal(controller.accepts(d,23),false);
  const client=new IOSSession(sim,host.id);run(client,'ssh viewer@192.0.2.1','viewerlab');assert.match(client.prompt,/#$/);
  reject(cli,'enable');
});

test('NSOS to NSOS and IOS SSH clients select the peer dialect and NS-OS SNMP is read-only over delivered packets',()=>{
  const {sim,d,cli}=setup(9612),peer=sim.addDevice('datacenter'),pc=createCLISession(sim,peer.id,{skipConsoleLogin:true}) as NSOSSession;
  for(const [s,address] of [[cli,'192.0.2.1'],[pc,'192.0.2.2']] as const)
    run(s,'conf t','username admin password LabAdmin42 role network-admin','feature ssh','snmp-server community LabRead group network-operator','snmp-server location Datacenter Lab','interface mgmt0','ip address '+address+'/24','end');
  sim.connect({deviceId:d.id,port:'mgmt0'},{deviceId:peer.id,port:'mgmt0'});sim.advance(1000);
  run(cli,'ssh admin@192.0.2.2 vrf management','LabAdmin42');assert.equal(cli.remoteConnected,true);
  assert.match(text(cli,'show version'),/NS-DC24-6Q/);reject(cli,'enable');
  run(cli,'exit');assert.equal(cli.remoteConnected,false);
  const response=snmpGet(sim,d.id,'192.0.2.2',{version:'2c',community:'LabRead',operation:'get',oids:['sysDescr.0','ifNumber.0','sysLocation.0']},{vrf:'management'});
  sim.advance(100);assert.equal(response.status,'success');assert.match(response.varbinds[0].value,/NS-OS/);assert.equal(response.varbinds[1].value,31);assert.equal(response.varbinds[2].value,'Datacenter Lab');
  const router=sim.addDevice('router'),rc=new IOSSession(sim,router.id);
  run(rc,'enable','conf t','interface g0/0','ip address 198.51.100.1 255.255.255.0','no shutdown','exit','ip domain-name lab.test','crypto key generate rsa modulus 2048','username admin privilege 15 secret LabAdmin42','line vty 0 4','login local','transport input ssh','end');
  run(cli,'conf t','interface Ethernet1/1','no switchport','ip address 198.51.100.2/24','no shutdown','end');
  sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:router.id,port:'GigabitEthernet0/0'});sim.advance(1000);
  run(cli,'ssh admin@198.51.100.1','LabAdmin42');
  assert.match(text(cli,'show version'),/NetSim OS Software, Routing/);run(cli,'exit');
});

test('NSOS automation uses explicit nxos modules, role authorization, actual SSH and idempotent NS-OS configuration',()=>{
  const {sim,d,cli}=setup(9613),host=sim.addDevice('pc');
  run(cli,'conf t','username admin password LabAdmin42 role network-admin','username viewer password LabView42 role network-operator','feature ssh','interface mgmt0','ip address 192.0.2.1/24','end');
  const hp=host.config.interfaces.GigabitEthernet0;delete hp.features.dhcp;hp.ip='192.0.2.2';hp.mask='255.255.255.0';
  sim.connect({deviceId:d.id,port:'mgmt0'},{deviceId:host.id,port:'GigabitEthernet0'});sim.advance(1000);
  const inventory=(user='admin',password='LabAdmin42')=>JSON.stringify({all:{vars:{ansible_network_os:'cisco.nxos.nxos',ansible_user:user,ansible_password:password},hosts:{leaf:{ansible_host:'192.0.2.1'}}}});
  const tasks=JSON.stringify([{hosts:'all',gather_facts:false,tasks:[
    {'cisco.nxos.nxos_config':{lines:['description Automation access'],parents:['interface Ethernet1/1'],save_when:'changed'}},
    {'cisco.nxos.nxos_command':{commands:['show interface Ethernet1/1','show feature'],wait_for:['result[0] contains Automation access']}},
  ]}]);
  assert.equal(validateAutomation(inventory(),tasks).valid,true);
  const first=runAutomation(sim,host.id,inventory(),tasks);assert.equal(first.status,'success',JSON.stringify(first));assert.equal(first.results[0].module,'nxos_config');assert.equal(first.results[0].changed,true);assert.equal(d.startupConfig?.interfaces['Ethernet1/1'].description,'Automation access');
  assert.equal(runAutomation(sim,host.id,inventory(),tasks).results[0].changed,false);
  const denied=runAutomation(sim,host.id,inventory('viewer','LabView42'),tasks);assert.equal(denied.status,'failure');assert.match(JSON.stringify(denied),/Permission denied/);
  assert.throws(()=>validateAutomation(inventory(),tasks.replaceAll('cisco.nxos.nxos_','cisco.ios.ios_')),/dialect/);
  const wrongOS=inventory().replace('cisco.nxos.nxos','cisco.ios.ios'),iosTasks=tasks.replaceAll('cisco.nxos.nxos_','cisco.ios.ios_');
  assert.match(JSON.stringify(runAutomation(sim,host.id,wrongOS,iosTasks)),/Remote platform does not match/);
});

test('NSOS renderer, export/replay, startup save, reload and old/new lab import preserve dialect with fresh runtime',()=>{
  const {sim,d,cli}=setup(9610);
  run(cli,'conf t','hostname Spine','feature lacp','feature interface-vlan','feature ospf','feature vpc','feature ssh','feature vtp','vtp domain DC','vtp mode transparent','vrf context BLUE','ip route 203.0.113.0/24 192.0.2.2','exit','vlan 10','name App','exit','router ospf FABRIC','router-id 1.1.1.1','exit','interface Ethernet1/1','no switchport','ip address 10.0.0.1/30','ip router ospf FABRIC area 0','no shutdown','interface Ethernet1/25','switchport mode trunk','channel-group 10 mode active','no shutdown','interface Port-channel10','switchport mode trunk','no shutdown','exit','vpc domain 10','role priority 100','peer-keepalive destination 192.0.2.2 source 192.0.2.1 vrf management','exit','interface Port-channel10','vpc peer-link','end');
  const rendered=renderConfig(d).join('\n');
  assert.doesNotMatch(rendered,/\benable\b|config-register|switchport nonegotiate|ip ospf 1 area|vrf forwarding|network \d+\.\d+\.\d+\.\d+.*area/);
  const peer=sim.addDevice('datacenter'),replay=createCLISession(sim,peer.id,{skipConsoleLogin:true}) as NSOSSession;
  peer.config.features.files={replay:rendered};
  run(replay,'copy bootflash:replay running-config');assert.equal(renderConfig(peer).join('\n'),rendered);
  run(cli,'copy running-config startup-config','copy running-config bootflash:saved.cfg');
  assert.equal(d.config.features.files['saved.cfg'],rendered);
  d.runtime.features.testStale=true;sim.reloadIOS(d.id,'NS-OS regression');sim.advance(IOS_BOOT_DURATION);
  assert.equal(d.config.hostname,'Spine');assert.equal(d.runtime.features.testStale,undefined);
  const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));
  const dc=restored.getDevice(d.id)!;assert.deepEqual(nsosConfig(dc),nsosConfig(d));assert.equal(dc.runtime.features.testStale,undefined);
  assert.ok(createCLISession(restored,dc.id,{skipConsoleLogin:true}) instanceof NSOSSession);
  const legacy=sim.addDevice('router');assert.ok(createCLISession(sim,legacy.id) instanceof IOSSession);
  const doc=sim.serialize();doc.lab.devices.find(x=>x.id===d.id)!.config.interfaces['Ethernet1/2'].mode='dynamic-auto';
  assert.throws(()=>parseDocument(JSON.stringify(doc)),/dynamic trunk/);
});

test('NSOS vPC CLI validates domain/member/peer-link, shows absent peers honestly and clears feature state',()=>{
  const {d,cli}=setup(9611);
  run(cli,'conf t');reject(cli,'vpc domain 1',/not enabled/);
  run(cli,'feature vpc','vpc domain 1','role priority 100','peer-keepalive destination 192.0.2.2 source 192.0.2.1','auto-recovery reload-delay 300','delay restore 30');
  reject(cli,'layer3 peer-router');run(cli,'exit','interface Port-channel1','switchport mode trunk','vpc peer-link','interface Port-channel2','vpc 20','end');
  assert.equal(d.config.interfaces['Port-channel1'].features.stpPortType,'network');
  assert.match(text(cli,'show vpc'),/adjacency not formed/);assert.doesNotMatch(text(cli,'show vpc'),/Status.*success/);
  assert.match(text(cli,'show vpc peer-keepalive'),/received: 0/);
  run(cli,'conf t','no feature vpc','end');assert.equal(nsosConfig(d).vpc,undefined);assert.equal(d.config.interfaces['Port-channel2'].features.vpcId,undefined);
});

test('regression: NSOS configuration replay resolves passive logical interfaces and qualified routes in default and named VRFs',()=>{
  const {sim,d,cli}=setup(9614);
  run(cli,'conf t','feature ospf','feature interface-vlan','vrf context BLUE','exit',
    'interface Vlan20','ip address 10.0.20.1/24','ip router ospf CORE area 0','ip ospf passive-interface','no shutdown',
    'interface Loopback0','ip address 10.0.0.1/32','ip router ospf CORE area 0','ip ospf passive-interface',
    'interface Port-channel10','no switchport','ip address 10.0.10.1/30','ip router ospf CORE area 0','ip ospf passive-interface',
    'interface Loopback1','vrf member BLUE','ip address 10.1.0.1/32','ip router ospf CORE area 0','ip ospf passive-interface',
    'interface Port-channel20','no switchport','vrf member BLUE','ip address 10.1.10.1/30','ip router ospf CORE area 0','ip ospf passive-interface',
    'exit','router ospf CORE','router-id 10.0.0.1',
    'vrf BLUE','router-id 10.1.0.1','end',
    'conf t','ip route 192.0.2.0/24 Port-channel10 10.0.10.2','vrf context BLUE','ip route 198.51.100.0/24 Port-channel20 10.1.10.2','end');
  const rendered=renderConfig(d).join('\n'),peer=sim.addDevice('datacenter'),replay=new NSOSSession(sim,peer.id,{skipConsoleLogin:true});
  peer.config.features.files={replay:rendered};
  run(replay,'copy bootflash:replay running-config');
  assert.equal(renderConfig(peer).join('\n'),rendered);
  assert.deepEqual(peer.config.protocols.ospf,d.config.protocols.ospf);
  for(const vrf of [undefined,'BLUE'])
    assert.deepEqual(peer.config.staticRoutes.filter(r=>r.vrf===vrf),d.config.staticRoutes.filter(r=>r.vrf===vrf));
  run(replay,'copy running-config startup-config');sim.reload(peer.id);
  assert.deepEqual(peer.config.protocols.ospf,d.config.protocols.ospf);
});

test('regression: explicit NSOS terminal width survives local viewport changes and SSH column updates',()=>{
  const {sim,d,cli}=setup(9615);
  assert.equal(cli.pageWidth,80);cli.setViewportColumns(140);assert.equal(cli.pageWidth,140);
  run(cli,'terminal width 60');cli.setViewportColumns(200);assert.equal(cli.pageWidth,60);
  run(cli,'terminal width 132');cli.setViewportColumns(90);assert.equal(cli.pageWidth,132);
  run(cli,'conf t','username admin password LabAdmin42 role network-admin','feature ssh','interface mgmt0','ip address 192.0.2.1/24','end');
  const host=sim.addDevice('pc'),p=host.config.interfaces.GigabitEthernet0;
  delete p.features.dhcp;Object.assign(p,{ip:'192.0.2.2',mask:'255.255.255.0'});
  sim.connect({deviceId:d.id,port:'mgmt0'},{deviceId:host.id,port:p.name});sim.advance(1000);
  const controller=managementFor(sim,id=>createCLISession(sim,id,{skipConsoleLogin:true}));
  const opened=controller.open(host.id,'192.0.2.1',22,'admin','ssh',140);
  assert.equal(opened.status,'success');
  const id=opened.sessionId;
  assert.equal(controller.send(host.id,'192.0.2.1',22,id,'LabAdmin42',140).pageWidth,140);
  assert.equal(controller.send(host.id,'192.0.2.1',22,id,'show version',100).pageWidth,100);
  assert.equal(controller.send(host.id,'192.0.2.1',22,id,'terminal width 60',100).pageWidth,60);
  assert.equal(controller.send(host.id,'192.0.2.1',22,id,'show interface status',180).pageWidth,60);
  assert.equal(controller.query(host.id,'192.0.2.1',22,id,'help','show ',120).pageWidth,60);
  // A reload starts a new terminal session while retaining the attached viewport.
  sim.reload(d.id);cli.pollOutput();assert.equal(cli.pageWidth,90);
});

test('CML regression: SSH is enabled by default, gated by feature ssh and retained when disabled in NVGEN',()=>{
  const {sim,d,cli}=setup(9616),host=sim.addDevice('router'),client=new IOSSession(sim,host.id);
  sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:host.id,port:'GigabitEthernet0/0'});
  run(cli,'conf t','username admin password LabAdmin42 role network-admin','interface Ethernet1/1','no switchport','ip address 192.0.2.1/24','no shutdown','end');
  run(client,'enable','conf t','interface g0/0','ip address 192.0.2.2 255.255.255.0','no shutdown','end');
  assert.match(text(cli,'show feature | include ssh'),/sshServer\s+1\s+enabled/);
  assert.match(text(client,'ssh -l admin 192.0.2.1'),/User Access Verification/);run(client,'LabAdmin42');assert.equal(client.prompt,d.config.hostname+'#');
  assert.equal(text(client,'show hostname'),d.config.hostname);run(client,'exit');
  run(cli,'conf t','no feature ssh','end');assert.match(text(cli,'show feature | include ssh'),/sshServer\s+1\s+disabled/);
  assert.match(client.execute('ssh -l admin 192.0.2.1').join('\n'),/refused/);
  const config=renderConfig(d).join('\n');assert.match(config,/^no feature ssh$/m);
  const peer=sim.addDevice('datacenter'),replay=new NSOSSession(sim,peer.id);run(replay,'conf t');
  for(const line of config.split('\n').filter(l=>l&&!l.startsWith('!')))run(replay,line);
  assert.equal(nsosConfig(peer).enabled.includes('ssh'),false);
  run(cli,'conf t','feature ssh','end');run(client,'ssh -l admin 192.0.2.1','LabAdmin42');assert.equal(client.prompt,d.config.hostname+'#');
  assert.ok(sim.events.some(e=>e.protocol==='TCP'));
});

test('NSOS show filters use real output, expose help and completion, and preserve invalid-command failures',()=>{
  const {cli}=setup(9617);
  const row=text(cli,'show feature | include ssh');assert.match(row,/^sshServer\s+1\s+enabled$/);assert.doesNotMatch(row,/Feature Name/);
  assert.doesNotMatch(text(cli,'show feature | exclude ssh'),/sshServer/);
  assert.match(text(cli,'show feature | begin ssh'),/^sshServer/m);
  assert.match(cli.help('show feature | ').join('\n'),/include/);assert.equal(cli.complete('show feature | inc'),'show feature | include ');
  reject(cli,'show feature | include [',/Invalid output filter/);
  reject(cli,'show invalid | include ssh',/Invalid or incomplete show command/);
  reject(cli,'show feature | redirect flash:out',/Invalid or incomplete output filter/);
});
