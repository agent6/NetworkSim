import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import type {Device} from '../src/model.ts';
import {createCLISession} from '../src/session.ts';
import {iosRejected} from '../src/ios-help.ts';
import {vpcRuntime} from '../src/datacenter.ts';
import {interfaceSpeed} from '../src/ethernet.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {advanceSimulation as advance,addDatacenterHost as host,datacenterTraffic as traffic,datacenterTopology,ethernet as eth,gigabit as gi} from './helpers/datacenter.ts';

type Session=ReturnType<typeof createCLISession>;
type Mode='active'|'passive'|'on';
function cli(s:Simulator,d:Device):Session{return createCLISession(s,d.id,{skipConsoleLogin:true});}
function run(c:Session,...lines:string[]):void {
  for(const line of lines){const output=c.execute(line);assert.ok(!output.some(iosRejected),line+'\n'+output.join('\n'));}
}
function reject(s:Simulator,c:Session,line:string,pattern:RegExp):void {
  const d=s.getDevice(c.deviceId)!,before=JSON.stringify(d.config),output=c.execute(line).join('\n');
  assert.match(output,pattern,line);assert.equal(JSON.stringify(d.config),before,line+' mutated configuration');
}
function ping(s:Simulator,from:Device,address:string,count=4,vrf?:string):void {
  const result=s.ping(from.id,address,{count,interval:20,timeout:1000,vrf});
  advance(s,2500);assert.equal(result.received,count,JSON.stringify({from:from.config.hostname,address,replies:result.replies,events:s.events.slice(-12)}));
}
function pair(s:Simulator,domain:number,network:number){
  const peers=[s.addDevice('datacenter'),s.addDevice('datacenter')],sessions=peers.map(d=>cli(s,d));
  for(let i=0;i<2;i++){
    const c=sessions[i];
    run(c,'configure terminal','feature vpc','feature lacp','feature interface-vlan','vlan 20,30','exit',
      'vpc domain '+domain,'role priority '+(100+i*100),
      `peer-keepalive destination 10.255.${network}.${2-i} source 10.255.${network}.${i+1} vrf management`,
      'exit','interface mgmt0',`ip address 10.255.${network}.${i+1}/24`,'exit',
      'interface Port-channel1','switchport mode trunk','vpc peer-link','no shutdown','exit');
    for(const n of[29,30])run(c,'interface '+eth(n),'switchport mode trunk','channel-group 1 mode active','lacp rate fast','no shutdown','exit');
    run(c,'end');
  }
  const peerLinks=[29,30].map(n=>s.connect({deviceId:peers[0].id,port:eth(n)},{deviceId:peers[1].id,port:eth(n)}));
  const keepalive=s.connect({deviceId:peers[0].id,port:'mgmt0'},{deviceId:peers[1].id,port:'mgmt0'});
  return {peers,sessions,peerLinks,keepalive};
}
function vpcChannel(c:Session,ports:number[],group:number,id:number,mode:Mode):void {
  run(c,'configure terminal','interface Port-channel'+group,'switchport mode trunk','vpc '+id,'no shutdown','exit');
  for(const n of ports)run(c,'interface '+eth(n),'switchport mode trunk',`channel-group ${group} mode ${mode}`,...(mode==='on'?[]:['lacp rate fast']),'no shutdown','exit');
  run(c,'end');
}
function healthy(peers:Device[],id:number):void {
  for(const d of peers){
    const r=vpcRuntime(d)!;assert.equal(r.adjacency,true,d.config.hostname+' adjacency');assert.equal(r.peerAlive,true);
    assert.deepEqual(r.consistency,[],d.config.hostname+' consistency');assert.equal(r.members[id].up,true,JSON.stringify({node:d.config.hostname,r,channels:d.runtime.features.portChannels}));
  }
}
function exactlyOnce(s:Simulator,from:Device,to:Device):void {
  ping(s,from,to.config.interfaces.GigabitEthernet0.ip!);
  assert.deepEqual(traffic(s,from,to,1000),Array(1000).fill(1),'known unicast');
  const key='20|'+s.macOf(to.id,'GigabitEthernet0');
  for(const d of s.lab.devices)delete d.runtime.mac[key];
  assert.deepEqual(traffic(s,from,to,1000),Array(1000).fill(1),'unknown unicast');
  assert.deepEqual(traffic(s,from,to,1000,true),Array(1000).fill(1),'broadcast');
}

for(const mode of['active','passive','on']as const)test(`CLI-built vPC pair and IOS ${mode} Layer 2 EtherChannel forward both VLANs and survive either uplink loss`,()=>{
  const s=new Simulator(94100),p=pair(s,41,1),access=s.addDevice('switch'),ac=cli(s,access);
  p.sessions.forEach((c,i)=>vpcChannel(c,[25],10+i*10,10,mode==='passive'?'active':mode));
  run(ac,'enable','configure terminal','vlan 20','exit','vlan 30','exit');
  for(const n of[1,2])run(ac,'interface '+gi(n),'switchport mode trunk',`channel-group 3 mode ${mode}`,...(mode==='on'?[]:['lacp rate fast']),'no shutdown','exit');
  run(ac,'interface Port-channel3','switchport mode trunk','no shutdown','end');
  const links=p.peers.map((d,i)=>s.connect({deviceId:d.id,port:eth(25)},{deviceId:access.id,port:gi(i+1)}));
  const client=host(s,access,gi(3),'192.0.2.10'),a=host(s,p.peers[0],eth(1),'192.0.2.20'),b=host(s,p.peers[1],eth(1),'192.0.2.30');
  const client30=host(s,access,gi(4),'192.0.2.40',30),b30=host(s,p.peers[1],eth(2),'192.0.2.50',30);
  advance(s,40000);healthy(p.peers,10);
  assert.equal(access.runtime.features.portChannels[3].activeMembers.length,2);
  exactlyOnce(s,client,b);ping(s,client,a.config.interfaces.GigabitEthernet0.ip!);ping(s,client30,b30.config.interfaces.GigabitEthernet0.ip!);
  for(let i=0;i<2;i++){
    s.disconnect(links[i].id);advance(s,4000);
    assert.equal(access.runtime.features.portChannels[3].activeMembers.length,1);
    ping(s,client,a.config.interfaces.GigabitEthernet0.ip!);ping(s,client,b.config.interfaces.GigabitEthernet0.ip!);
    links[i]=s.connect({deviceId:p.peers[i].id,port:eth(25)},{deviceId:access.id,port:gi(i+1)});advance(s,4000);
  }
  assert.equal(access.runtime.features.portChannels[3].activeMembers.length,2);
});

for(const mode of['active','on']as const)test(`back-to-back vPC pairs with ${mode} channels bootstrap and forward without BUM duplication`,()=>{
  const s=new Simulator(94200),left=pair(s,42,2),right=pair(s,84,3);
  left.sessions.forEach((c,i)=>vpcChannel(c,[25,26],10+i*10,10,mode));
  right.sessions.forEach((c,i)=>vpcChannel(c,[25,26],30+i*10,20,mode));
  const links=[];
  for(let a=0;a<2;a++)for(let b=0;b<2;b++)links.push(s.connect({deviceId:left.peers[a].id,port:eth(25+b)},{deviceId:right.peers[b].id,port:eth(25+a)}));
  const hosts=[...left.peers,...right.peers].map((d,i)=>host(s,d,eth(1),'192.0.2.'+(10+i)));
  advance(s,45000);healthy(left.peers,10);healthy(right.peers,20);
  for(const d of[...left.peers,...right.peers])assert.equal(d.runtime.features.portChannels[d.config.interfaces[eth(25)].features.channelGroup].activeMembers.length,2);
  exactlyOnce(s,hosts[0],hosts[3]);exactlyOnce(s,hosts[2],hosts[1]);
  s.disconnect(links[0].id);advance(s,4000);exactlyOnce(s,hosts[0],hosts[3]);
  s.power(left.peers[0].id,false);advance(s,12000);exactlyOnce(s,hosts[1],hosts[2]);
  left.peers[0].startupConfig=structuredClone(left.peers[0].config);s.power(left.peers[0].id,true);advance(s,45000);
  healthy(left.peers,10);healthy(right.peers,20);exactlyOnce(s,hosts[0],hosts[3]);
  for(const link of left.peerLinks)s.disconnect(link.id);advance(s,10000);
  assert.equal(vpcRuntime(left.peers[0])!.state,'secondary suspended');healthy(right.peers,20);
  for(const d of right.peers)assert.deepEqual(d.runtime.features.portChannels[d.config.interfaces[eth(26)].features.channelGroup].activeMembers,[eth(26)]);
  exactlyOnce(s,hosts[1],hosts[3]);
  for(const n of[29,30])s.connect({deviceId:left.peers[0].id,port:eth(n)},{deviceId:left.peers[1].id,port:eth(n)});
  advance(s,45000);healthy(left.peers,10);exactlyOnce(s,hosts[0],hosts[3]);
  const restored=new Simulator();restored.load(s.serialize());advance(restored,45000);
  healthy(left.peers.map(d=>restored.getDevice(d.id)!),10);healthy(right.peers.map(d=>restored.getDevice(d.id)!),20);
  exactlyOnce(restored,restored.getDevice(hosts[3].id)!,restored.getDevice(hosts[0].id)!);
  assert.ok(!s.events.some(e=>e.label==='Layer 2 loop guard'));
});

for(const mode of['active','on']as const)for(const peerKind of['datacenter','l3switch']as const)test(`${mode} Layer 3 EtherChannel from NS-OS to ${peerKind} carries IPv4/IPv6, OSPF and member failure recovery`,()=>{
  const s=new Simulator(94300),devices=[s.addDevice('datacenter'),s.addDevice(peerKind)],sessions=devices.map(d=>cli(s,d));
  for(let i=0;i<2;i++){
    const c=sessions[i],nx=devices[i].kind==='datacenter',group=11+i,port=(n:number)=>nx?eth(n):gi(n===25?1:2);
    run(c,...(nx?[]:['enable']),'configure terminal',...(nx?['feature lacp','feature ospf']:['ip routing']),'ipv6 unicast-routing',
      'interface Port-channel'+group,'no switchport',nx?`ip address 172.16.0.${i+1}/30`:`ip address 172.16.0.${i+1} 255.255.255.252`,
      `ipv6 address 2001:db8:1::${i+1}/64`,'no shutdown','exit');
    for(const n of[25,26])run(c,'interface '+port(n),'no switchport',`channel-group ${group} mode ${mode}`,...(mode==='on'?[]:['lacp rate fast']),'no shutdown','exit');
    if(nx)run(c,'router ospf FABRIC','router-id '+(i+1)+'.'+(i+1)+'.'+(i+1)+'.'+(i+1),'exit','interface Port-channel'+group,'ip router ospf FABRIC area 0','exit','interface Loopback0',`ip address 192.0.2.${i+1}/32`,'ip router ospf FABRIC area 0','no shutdown','exit');
    else run(c,'interface Loopback0',`ip address 192.0.2.${i+1} 255.255.255.255`,'exit','router ospf 99','router-id 2.2.2.2','network 172.16.0.0 0.0.0.3 area 0','network 192.0.2.2 0.0.0.0 area 0','exit');
    run(c,'interface Loopback0',`ipv6 address 2001:db8:2::${i+1}/128`,'exit',`ipv6 route 2001:db8:2::${2-i}/128 2001:db8:1::${2-i}`,'end');
  }
  const remote=(n:number)=>peerKind==='datacenter'?eth(n):gi(n===25?1:2);
  for(const n of[25,26])s.connect({deviceId:devices[0].id,port:eth(n)},{deviceId:devices[1].id,port:remote(n)});
  advance(s,45000);
  for(let i=0;i<2;i++){
    const d=devices[i];assert.equal(d.runtime.features.portChannels[11+i].activeMembers.length,2);
    assert.equal(interfaceSpeed(d,d.config.interfaces['Port-channel'+(11+i)]),peerKind==='datacenter'?80000:2000);
    assert.match(sessions[i].execute(devices[i].kind==='datacenter'?'show ip ospf neighbors':'show ip ospf neighbor').join('\n'),/FULL/);
    ping(s,d,'192.0.2.'+(2-i));ping(s,d,'2001:db8:2::'+(2-i));
    if(d.kind==='datacenter')for(const address of['192.0.2.'+(2-i),'2001:db8:2::'+(2-i)])
      assert.match(sessions[i].execute('ping '+address).join('\n'),/5 packets transmitted, 5 packets received/);
  }
  run(sessions[0],'configure terminal','interface '+eth(25),'shutdown','end');advance(s,4000);
  assert.equal(s.interfaceUp(devices[0].id,'Port-channel11'),true);
  assert.equal(interfaceSpeed(devices[0],devices[0].config.interfaces['Port-channel11']),peerKind==='datacenter'?40000:1000);
  ping(s,devices[0],'192.0.2.2');ping(s,devices[1],'2001:db8:2::1');
  run(sessions[0],'configure terminal','interface '+eth(26),'shutdown','end');advance(s,1000);
  assert.equal(s.interfaceUp(devices[0].id,'Port-channel11'),false);
  assert.ok(!s.routes(devices[0].id).some(r=>r.interface==='Port-channel11'));
  run(sessions[0],'configure terminal','interface '+eth(25),'no shutdown','interface '+eth(26),'no shutdown','end');advance(s,45000);
  ping(s,devices[0],'192.0.2.2');ping(s,devices[1],'2001:db8:2::1');
});

test('routed NS-OS EtherChannel VRFs and addressing survive configuration replay',()=>{
  const s=new Simulator(),d=s.addDevice('datacenter'),c=cli(s,d);
  run(c,'configure terminal','feature lacp','vrf context TRANSPORT','exit','interface Port-channel11','no switchport','vrf member TRANSPORT','ip address 172.16.0.1/30','ipv6 address 2001:db8:1::1/64','no shutdown','exit');
  for(const n of[25,26])run(c,'interface '+eth(n),'no switchport','vrf member TRANSPORT','channel-group 11 mode active','no shutdown','exit');
  run(c,'interface Ethernet1/1','no switchport','vrf member TRANSPORT','ip address 192.0.2.1/24','no shutdown','end');
  const fresh=s.addDevice('datacenter'),replay=cli(s,fresh);
  run(replay,'configure terminal',...renderConfig(d).filter(line=>line.trim()&&!line.trim().startsWith('!')).map(line=>line.trim()));
  assert.equal(fresh.config.interfaces['Port-channel11'].vrf,'TRANSPORT');
  assert.equal(fresh.config.interfaces['Port-channel11'].ip,'172.16.0.1');
  assert.equal(fresh.config.interfaces[eth(1)].ip,'192.0.2.1');
  run(replay,'configure terminal','vrf context REMOTE','exit','interface Port-channel11','vrf member REMOTE','ip address 172.16.0.2/30','ipv6 address 2001:db8:1::2/64','end');
  for(const n of[25,26])s.connect({deviceId:d.id,port:eth(n)},{deviceId:fresh.id,port:eth(n)});
  advance(s,4000);ping(s,d,'172.16.0.2',4,'TRANSPORT');ping(s,fresh,'172.16.0.1',4,'REMOTE');
  ping(s,d,'2001:db8:1::2',4,'TRANSPORT');ping(s,fresh,'2001:db8:1::1',4,'REMOTE');
  const isolated=s.ping(d.id,'172.16.0.2',{count:1,timeout:1000});advance(s,1500);assert.equal(isolated.received,0);
});

test('orphan access ports keep local switching by default and suspend operationally only when requested',()=>{
  const {s,a,b,peerLinks,ha,hb,client}=datacenterTopology(),other=host(s,b,eth(3),'192.0.2.40'),c=cli(s,b);
  advance(s,2000);ping(s,hb,other.config.interfaces.GigabitEthernet0.ip!);
  for(const link of peerLinks)s.disconnect(link.id);advance(s,10000);
  assert.equal(vpcRuntime(b)!.state,'secondary suspended');
  assert.equal(s.interfaceUp(b.id,eth(2)),true);ping(s,hb,other.config.interfaces.GigabitEthernet0.ip!);
  const failed=s.ping(hb.id,client.config.interfaces.GigabitEthernet0.ip!,{count:1,timeout:1000});advance(s,1500);assert.equal(failed.received,0);
  run(c,'configure terminal','interface '+eth(2),'vpc orphan-port suspend','end');
  assert.equal(s.interfaceUp(b.id,eth(2)),false,'orphan suspension must be operational, not only VLAN filtering');
  assert.match(c.execute('show interface status').join('\n'),/^Ethernet1\/2\s+suspended\b/m);
  const suspended=s.ping(hb.id,other.config.interfaces.GigabitEthernet0.ip!,{count:1,timeout:1000});advance(s,1500);assert.equal(suspended.received,0);
  for(const n of[29,30])s.connect({deviceId:a.id,port:eth(n)},{deviceId:b.id,port:eth(n)});
  advance(s,45000);assert.equal(s.interfaceUp(b.id,eth(2)),true);ping(s,hb,ha.config.interfaces.GigabitEthernet0.ip!);ping(s,hb,client.config.interfaces.GigabitEthernet0.ip!);
});

for(const mode of['active','on']as const)test(`${mode} orphan Layer 2 port-channel suspension withdraws every member from its IOS neighbor and recovers`,()=>{
  const {s,a,b,peerLinks,client}=datacenterTopology(),access=s.addDevice('switch'),c=cli(s,b),ac=cli(s,access);
  run(c,'configure terminal','interface Port-channel50','switchport mode trunk','vpc orphan-port suspend','no shutdown','exit');
  for(const n of[25,26])run(c,'interface '+eth(n),'switchport mode trunk',`channel-group 50 mode ${mode}`,...(mode==='on'?[]:['lacp rate fast']),'no shutdown','exit');
  run(c,'end');run(ac,'enable','configure terminal','vlan 20','exit');
  for(const n of[1,2])run(ac,'interface '+gi(n),'switchport mode trunk',`channel-group 2 mode ${mode}`,...(mode==='on'?[]:['lacp rate fast']),'no shutdown','exit');
  run(ac,'interface Port-channel2','switchport mode trunk','no shutdown','end');
  for(let i=0;i<2;i++)s.connect({deviceId:b.id,port:eth(25+i)},{deviceId:access.id,port:gi(1+i)});
  const endpoint=host(s,access,gi(3),'192.0.2.40');advance(s,10000);
  assert.equal(access.runtime.features.portChannels[2].activeMembers.length,2);ping(s,endpoint,client.config.interfaces.GigabitEthernet0.ip!);
  for(const link of peerLinks)s.disconnect(link.id);advance(s,10000);
  assert.equal(s.interfaceUp(b.id,'Port-channel50'),false);
  assert.match(c.execute('show port-channel summary').join('\n'),/^50\s+Port-channel50\s+\S+\s+suspended\s+Ethernet1\/25\(s\).*Ethernet1\/26\(s\)/m);
  assert.equal(access.runtime.features.portChannels[2].activeMembers.length,0,'the IOS neighbor must not retain collecting/distributing links to a suspended orphan bundle');
  for(const n of[29,30])s.connect({deviceId:a.id,port:eth(n)},{deviceId:b.id,port:eth(n)});
  advance(s,45000);
  assert.equal(s.interfaceUp(b.id,'Port-channel50'),true);assert.equal(access.runtime.features.portChannels[2].activeMembers.length,2);
  ping(s,endpoint,client.config.interfaces.GigabitEthernet0.ip!);
});

test('NS-OS rejects routed vPC/peer-link conversions and orphan suspension on their physical members transactionally',()=>{
  const s=new Simulator(),p=pair(s,45,4),c=p.sessions[0];vpcChannel(c,[25],10,10,'active');
  run(c,'configure terminal','interface Port-channel10');reject(s,c,'no switchport',/vPC|Layer 2/);
  run(c,'interface Port-channel1');reject(s,c,'no switchport',/peer-link|Layer 2/);reject(s,c,'switchport mode access',/peer-link|trunk/);
  run(c,'interface '+eth(25));reject(s,c,'vpc orphan-port suspend',/orphan|vPC/);
  run(c,'interface '+eth(29));reject(s,c,'vpc orphan-port suspend',/orphan|peer-link/);
  run(c,'interface Port-channel99','no switchport');reject(s,c,'vpc 99',/Layer 2/);
});

test('NS-OS rejects member addressing and incompatible pre-created port-channels instead of creating split routed state',()=>{
  const s=new Simulator(),d=s.addDevice('datacenter'),c=cli(s,d);
  run(c,'configure terminal','feature lacp','interface Port-channel11','no switchport','ip address 172.16.0.1/30','no shutdown','interface '+eth(25),'no switchport','channel-group 11 mode active','no shutdown');
  reject(s,c,'ip address 198.51.100.1/30',/port-channel|Port-channel/);
  reject(s,c,'ipv6 address 2001:db8::1/64',/port-channel|Port-channel/);
  run(c,'exit','feature ospf','interface '+eth(25));reject(s,c,'ip router ospf FABRIC area 0',/port-channel|Port-channel/);
  run(c,'interface Port-channel12','switchport mode trunk','interface '+eth(26),'no switchport');
  reject(s,c,'channel-group 12 mode active',/compatible|Layer 2|Layer 3/);
  run(c,'interface Port-channel4096','end');
  assert.match(c.execute('show port-channel summary').join('\n'),/^4096\s+Port-channel4096\s+NONE\s+down\b/m);
});
