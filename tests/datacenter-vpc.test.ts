import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {defaultInterface, type Device} from '../src/model.ts';
import {defaultVPC, nsosConfig, vpcRuntime, vpcPortReason, validateNSOSConfiguration} from '../src/datacenter.ts';
import {negotiateEthernet, interfaceSpeed} from '../src/ethernet.ts';
import {datacenterTopology as topology,configureChannel as channel,ethernet as eth,gigabit as gi,advanceSimulation as advance,addDatacenterHost as host,datacenterTraffic as load} from './helpers/datacenter.ts';
function ping(s:Simulator,from:Device,to:Device,count=2):void {
  const result=s.ping(from.id,to.config.interfaces.GigabitEthernet0.ip!,{count,interval:20,timeout:1000});
  advance(s,2500);assert.equal(result.received,count,JSON.stringify({from:from.config.hostname,to:to.config.hostname,replies:result.replies,trees:s.lab.devices.filter(d=>['datacenter','switch'].includes(d.kind)).map(d=>({name:d.config.hostname,ports:d.runtime.stp['20']?.ports,mac:d.runtime.mac})),events:s.events.filter(e=>['ARP','ICMP'].includes(e.protocol)).slice(-40).map(e=>({node:e.nodeId,port:e.port,label:e.label,destination:e.packet?.destination,detail:e.detail}))}));
}

test('Datacenter profile has 24 access-facing and six Ethernet uplinks, with real negotiated capacities',()=>{
  const s=new Simulator(),a=s.addDevice('datacenter'),b=s.addDevice('datacenter'),ios=s.addDevice('switch');
  const ports=Object.values(a.config.interfaces).filter(p=>/^Ethernet/.test(p.name));
  assert.equal(ports.length,30);assert.ok(ports.every(p=>!p.adminUp));
  assert.equal(ports.filter(p=>p.speed===10000).length,24);assert.equal(ports.filter(p=>p.speed===40000).length,6);
  assert.equal(negotiateEthernet(a.config.interfaces[eth(1)],b.config.interfaces[eth(1)]).speed,10000);
  assert.equal(negotiateEthernet(a.config.interfaces[eth(25)],b.config.interfaces[eth(25)]).speed,40000);
  assert.equal(negotiateEthernet(a.config.interfaces[eth(1)],ios.config.interfaces[gi(1)]).speed,1000);
  assert.equal(negotiateEthernet(a.config.interfaces[eth(25)],b.config.interfaces[eth(25)],{medium:'fiber-om3',length:100,fault:'none',bitErrorRate:0}).carrier,true);
  assert.equal(negotiateEthernet(a.config.interfaces[eth(25)],b.config.interfaces[eth(25)],{medium:'fiber-om3',length:101,fault:'none',bitErrorRate:0}).carrier,false);
  assert.equal(a.config.interfaces.mgmt0.vrf,'management');
});

test('delivered peer state and routed keepalive form a vPC with distinct local channel numbers and one shared LACP actor',()=>{
  const {s,a,b,access,client,ha,hb}=topology();
  for(const d of[a,b]){
    const r=vpcRuntime(d)!;assert.equal(r.adjacency,true);assert.equal(r.peerAlive,true);assert.deepEqual(r.consistency,[]);
    assert.equal(r.members[10].up,true);assert.ok(r.rxKeepalives>20&&r.txKeepalives>20);
    assert.equal(interfaceSpeed(d,d.config.interfaces['Port-channel1']),80000);
  }
  assert.equal(vpcRuntime(a)!.role,'primary');assert.equal(vpcRuntime(b)!.role,'secondary');
  assert.equal(access.runtime.features.portChannels[3].state,'up');
  assert.deepEqual(access.runtime.features.portChannels[3].activeMembers,[gi(1),gi(2)]);
  assert.equal(access.runtime.features.portChannels[3].peerActorSystem,vpcRuntime(a)!.systemMac);
  assert.equal(access.runtime.features.portChannels[3].peerActorKey,10);
  ping(s,client,ha);ping(s,client,hb);ping(s,ha,hb);ping(s,hb,client);
});

test('known unicast and BUM each deliver exactly 1000 copies, without peer-link reflection or duplicate vPC delivery',()=>{
  const {s,client,ha,hb}=topology();
  ping(s,client,hb);ping(s,ha,client);advance(s,2000);
  assert.deepEqual(load(s,client,hb,1000),Array(1000).fill(1));
  for(const d of s.lab.devices)delete d.runtime.mac['20|'+s.macOf(hb.id,'GigabitEthernet0')];
  assert.deepEqual(load(s,client,hb,1000),Array(1000).fill(1));
  assert.deepEqual(load(s,ha,client,1000,true),Array(1000).fill(1));
  assert.ok(!s.events.some(e=>e.label==='Layer 2 loop guard'));
});

test('one peer-link cable failure preserves adjacency and forwarding at the remaining negotiated bandwidth',()=>{
  const {s,a,b,peerLinks,client,hb}=topology();
  s.disconnect(peerLinks[0].id);advance(s,2500);
  assert.equal(vpcRuntime(a)!.adjacency,true);assert.equal(vpcRuntime(b)!.adjacency,true);
  assert.equal(interfaceSpeed(a,a.config.interfaces['Port-channel1']),40000);ping(s,client,hb);
});

test('a failed vPC leg redirects synchronized MAC destinations over the peer-link, allowing only the remote-leg-down exception',()=>{
  const {s,a,b,access,legs,ha,client}=topology();ping(s,ha,client);
  s.disconnect(legs[0].id);advance(s,3000);
  assert.deepEqual(access.runtime.features.portChannels[3].activeMembers,[gi(2)]);
  assert.equal(vpcRuntime(a)!.members[10].up,false);assert.equal(vpcRuntime(b)!.members[10].peerUp,false);
  ping(s,ha,client);assert.deepEqual(load(s,ha,client,1000),Array(1000).fill(1));
});

test('keepalive-only loss does not suspend either vPC while reciprocal peer-link synchronization remains healthy',()=>{
  const {s,a,b,keepalive,client,ha,hb}=topology();
  s.disconnect(keepalive.id);advance(s,10000);
  for(const d of[a,b]){assert.equal(vpcRuntime(d)!.peerAlive,false);assert.equal(vpcRuntime(d)!.adjacency,true);assert.equal(vpcRuntime(d)!.members[10].up,true);}
  ping(s,client,ha);ping(s,client,hb);
});

test('peer-link loss with a live peer suspends secondary members and related SVIs; keepalive loss afterward does not silently recover them',()=>{
  const {s,a,b,peerLinks,keepalive,access,client,ha}=topology();
  b.config.interfaces.Vlan20={...defaultInterface('Vlan20'),adminUp:true,ip:'192.0.2.2',mask:'255.255.255.0'};
  b.config.interfaces[eth(2)].features.vpcOrphanSuspend=true;s.changed();
  for(const link of peerLinks)s.disconnect(link.id);advance(s,10000);
  assert.equal(vpcRuntime(a)!.members[10].up,true);assert.equal(vpcRuntime(b)!.state,'secondary suspended');
  assert.equal(vpcRuntime(b)!.members[10].up,false);assert.equal(s.interfaceUp(b.id,'Vlan20'),false);
  assert.match(vpcPortReason(b,eth(2))!,/orphan/);
  assert.deepEqual(access.runtime.features.portChannels[3].activeMembers,[gi(1)]);ping(s,client,ha);
  s.disconnect(keepalive.id);advance(s,15000);assert.equal(vpcRuntime(b)!.members[10].up,false);
});

test('a keepalive-first double failure exposes dual-active risk rather than assuming an unreachable peer is safely shut down',()=>{
  const {s,a,b,peerLinks,keepalive}=topology();
  s.disconnect(keepalive.id);advance(s,7000);for(const link of peerLinks)s.disconnect(link.id);advance(s,12000);
  assert.equal(vpcRuntime(a)!.dualActive,true);assert.equal(vpcRuntime(b)!.dualActive,true);
  assert.equal(vpcRuntime(b)!.role,'primary');
  s.connect({deviceId:a.id,port:'mgmt0'},{deviceId:b.id,port:'mgmt0'});
  for(const n of[29,30])s.connect({deviceId:a.id,port:eth(n)},{deviceId:b.id,port:eth(n)});
  advance(s,40000);assert.equal(vpcRuntime(a)!.role,'primary');assert.equal(vpcRuntime(b)!.role,'secondary');
  nsosConfig(a).vpc!.rolePriority=60000;nsosConfig(b).vpc!.rolePriority=100;s.changed();advance(s,2000);
  assert.equal(vpcRuntime(a)!.configuredRole,'secondary');assert.equal(vpcRuntime(a)!.role,'primary');
});

test('peer failure promotes the survivor; a saved-config reload does not preempt its operational primary role',()=>{
  const {s,a,b,client,hb}=topology();
  a.startupConfig=structuredClone(a.config);s.power(a.id,false);advance(s,12000);
  assert.equal(vpcRuntime(b)!.role,'primary');ping(s,client,hb);
  s.power(a.id,true);advance(s,40000);
  assert.equal(vpcRuntime(a)!.adjacency,true);assert.equal(vpcRuntime(a)!.configuredRole,'primary');
  assert.equal(vpcRuntime(a)!.role,'secondary');assert.equal(vpcRuntime(b)!.role,'primary');ping(s,client,hb);
});

test('type-1 native VLAN mismatch suspends the secondary, while type-2 peer-gateway mismatch warns without suspending healthy forwarding',()=>{
  const {s,a,b,client,ha}=topology();
  nsosConfig(a).vpc!.peerGateway=true;s.changed();advance(s,3000);
  assert.ok(vpcRuntime(b)!.consistency.some(c=>c.type===2&&c.name==='Peer-gateway'));
  assert.equal(vpcRuntime(b)!.members[10].up,true);ping(s,client,ha);
  b.config.interfaces['Port-channel20'].nativeVlan=30;s.changed();advance(s,3000);
  assert.ok(vpcRuntime(b)!.consistency.some(c=>c.type===1&&c.name==='Native VLAN'));
  assert.equal(vpcRuntime(a)!.members[10].up,true);assert.equal(vpcRuntime(b)!.members[10].up,false);
});

test('per-VLAN consistency suspends only affected VLANs, including physical ingress and egress, and recovers when repaired',()=>{
  const {s,a,b,client,ha}=topology();
  b.config.interfaces['Port-channel20'].allowedVlans=[1,30];s.changed();advance(s,3000);
  for(const d of[a,b]){
    assert.equal(vpcRuntime(d)!.members[10].up,true);assert.ok(vpcRuntime(d)!.members[10].suspendedVlans.includes(20));
    assert.equal(s.carriesVlan(d,eth(1),20),false);assert.equal(s.carriesVlan(d,eth(1),30),true);
  }
  assert.deepEqual(load(s,client,ha,1000),Array(1000).fill(0));
  b.config.interfaces['Port-channel20'].allowedVlans=null;s.changed();advance(s,3000);
  assert.equal(s.carriesVlan(a,eth(1),20),true);assert.equal(s.carriesVlan(b,eth(1),20),true);
  ping(s,client,ha);
});

test('directional peer-link loss breaks reciprocal adjacency even if one side still receives CFS advertisements',()=>{
  const {s,a,b,peerLinks}=topology();
  for(const link of peerLinks){link.lossAB=1;link.lossBA=0;}s.changed();advance(s,12000);
  assert.equal(vpcRuntime(a)!.adjacency,false);assert.equal(vpcRuntime(b)!.adjacency,false);
  assert.equal(vpcRuntime(b)!.state,'secondary suspended');
});

test('network ports enforce Bridge Assurance and recover only with reciprocal network BPDUs',()=>{
  const s=new Simulator(),a=s.addDevice('datacenter'),b=s.addDevice('datacenter');
  for(const d of[a,b]){const p=d.config.interfaces[eth(1)];p.adminUp=true;p.features.stpPortType='network';}
  s.connect({deviceId:a.id,port:eth(1)},{deviceId:b.id,port:eth(1)});s.changed();advance(s,10000);
  assert.equal(a.runtime.stp['1'].ports[eth(1)].state,'forwarding');
  b.config.interfaces[eth(1)].features.stpPortType='normal';s.changed();advance(s,8000);
  assert.equal(a.runtime.stp['1'].ports[eth(1)].role,'bridge-assurance-inconsistent');
  b.config.interfaces[eth(1)].features.stpPortType='network';s.changed();advance(s,10000);
  assert.equal(a.runtime.stp['1'].ports[eth(1)].state,'forwarding');
});

test('ordinary LACP cannot aggregate two unrelated IOS chassis',()=>{
  const s=new Simulator(),access=s.addDevice('switch'),a=s.addDevice('switch'),b=s.addDevice('switch');
  channel(access,[1,2],1);channel(a,[1],1);channel(b,[1],1);
  s.connect({deviceId:access.id,port:gi(1)},{deviceId:a.id,port:gi(1)});
  s.connect({deviceId:access.id,port:gi(2)},{deviceId:b.id,port:gi(1)});s.changed();advance(s,10000);
  assert.equal(access.runtime.features.portChannels[1].state,'suspended');
  assert.deepEqual(access.runtime.features.portChannels[1].activeMembers,[]);
});

test('static vPC members interoperate without enabling LACP and preserve unrelated-chassis aggregation protection',()=>{
  const {s,a,b,access,client,hb}=topology();
  for(const d of[a,b,access])for(const p of Object.values(d.config.interfaces))if(p.features.channelGroup)p.features.channelMode='on';
  for(const d of[a,b])nsosConfig(d).enabled=nsosConfig(d).enabled.filter(f=>f!=='lacp');
  s.changed();advance(s,40000);
  assert.equal(access.runtime.features.portChannels[3].protocol,'static');
  assert.deepEqual(access.runtime.features.portChannels[3].activeMembers,[gi(1),gi(2)]);ping(s,client,hb);
});

test('mgmt0 accepts local management traffic but cannot route transit packets in either direction',()=>{
  const s=new Simulator(),d=s.addDevice('datacenter'),management=s.addDevice('pc'),data=s.addDevice('pc');
  d.config.ipRouting=true;
  Object.assign(d.config.interfaces.mgmt0,{adminUp:true,ip:'10.0.0.1',mask:'255.255.255.0',vrf:'management'});
  Object.assign(d.config.interfaces[eth(1)],{adminUp:true,switchport:false,ip:'10.0.1.1',mask:'255.255.255.0',vrf:'management'});
  for(const[h,address,gateway,port]of[[management,'10.0.0.10','10.0.0.1','mgmt0'],[data,'10.0.1.10','10.0.1.1',eth(1)]]as const){
    const p=h.config.interfaces.GigabitEthernet0;delete p.features.dhcp;Object.assign(p,{ip:address,mask:'255.255.255.0'});
    h.config.defaultGateway=gateway;s.connect({deviceId:h.id,port:p.name},{deviceId:d.id,port});
  }
  s.changed();advance(s,3000);
  const local=s.ping(management.id,'10.0.0.1',{count:1});advance(s,2000);assert.equal(local.received,1);
  for(const[from,to]of[[management,data],[data,management]]as const){
    const result=s.ping(from.id,to.config.interfaces.GigabitEthernet0.ip!,{count:1,timeout:1000});
    advance(s,2000);assert.equal(result.received,0);
  }
  assert.ok(s.events.some(e=>e.nodeId===d.id&&e.label==='Management-plane isolation'));
});

test('peer-switch shares STP identity without merging configuration, routing state or independent roles',()=>{
  const {s,a,b,client,ha,hb}=topology();
  for(const d of[a,b])nsosConfig(d).vpc!.peerSwitch=true;
  s.changed();advance(s,6000);
  assert.equal(a.runtime.stp['20'].bridgeId,b.runtime.stp['20'].bridgeId);
  assert.equal(vpcRuntime(a)!.role,'primary');assert.equal(vpcRuntime(b)!.role,'secondary');
  assert.notEqual(a.config,b.config);assert.notEqual(a.runtime.routes,b.runtime.routes);
  assert.deepEqual(vpcRuntime(a)!.consistency,[]);
  ping(s,client,ha);ping(s,client,hb);
});

test('matching MST regions permit independent local priorities and do not falsely report a region inconsistency',()=>{
  const {s,a,b,client,hb}=topology();
  for(const d of[a,b]){
    d.config.features.stp.mode='mst';
    d.config.features.stp.mst={name:'DATACENTER',revision:1,instances:[{id:1,vlans:[20,30]}],priorities:{0:d===a?4096:8192,1:d===a?4096:8192}};
  }
  s.changed();advance(s,40000);
  assert.ok(!vpcRuntime(a)!.consistency.some(c=>c.name==='MST region'));
  assert.equal(vpcRuntime(a)!.members[10].up,true);assert.equal(vpcRuntime(b)!.members[10].up,true);
  ping(s,client,hb);
});

function routedTopology(hsrp=false){
  const t=topology(),{s,a,b,client}=t;
  for(const d of[a,b]){
    d.config.ipRouting=true;
    for(const[vlan,network]of [[20,'192.0.2.'],[30,'198.51.100.']]as const){
      const name='Vlan'+vlan;d.config.interfaces[name]={...defaultInterface(name),adminUp:true,ip:network+(d===a?'2':'3'),mask:'255.255.255.0'};
      d.config.interfaces[name].features.proxyArp=false;
      if(hsrp)(d.config.features.fhrp??=[]).push({protocol:'hsrp',interface:name,group:vlan,virtualIp:network+'1',version:2,priority:d===a?110:100,preempt:true,helloTime:1000,holdTime:3000});
    }
    nsosConfig(d).vpc!.peerGateway=true;nsosConfig(d).vpc!.arpSynchronize=true;
  }
  client.config.defaultGateway=hsrp?'192.0.2.1':'192.0.2.2';
  const destination=host(s,b,eth(3),'198.51.100.10',30);destination.config.defaultGateway=hsrp?'198.51.100.1':'198.51.100.3';
  s.changed();advance(s,12000);return {...t,destination};
}

test('peer-gateway routes frames addressed to the other peer locally, while ARP synchronization does not echo or invent ownership',()=>{
  const {s,a,b,legs,client,destination}=routedTopology();
  s.disconnect(legs[0].id);advance(s,4000);s.events=[];
  ping(s,client,destination);
  assert.ok(s.events.some(e=>e.nodeId===b.id&&e.label==='IP forwarded'&&e.packet?.destination==='198.51.100.10'));
  assert.ok(!s.events.some(e=>e.nodeId===a.id&&e.label==='IP forwarded'&&e.packet?.destination==='198.51.100.10'));
  advance(s,3000);
  assert.equal(a.runtime.arp['Vlan30|198.51.100.10']?.mac,s.macOf(destination.id,'GigabitEthernet0'));
});

test('HSRP remains one active/one standby control plane while either vPC peer can forward gateway data',()=>{
  const {s,a,b,legs,client,destination}=routedTopology(true);
  for(const vlan of[20,30]){
    const states=[a,b].map(d=>d.runtime.features.virtualIps.find((v:{interface:string})=>v.interface==='Vlan'+vlan)?.role).sort();
    assert.deepEqual(states,['active','standby']);
  }
  s.disconnect(legs[0].id);advance(s,4000);s.events=[];ping(s,client,destination);
  assert.ok(s.events.some(e=>e.nodeId===b.id&&e.label==='IP forwarded'&&e.packet?.destination==='198.51.100.10'));
});

test('synchronized CAM entries follow MAC moves and expire without being reflected indefinitely between peers',()=>{
  const {s,a,b,client,hb}=topology();ping(s,hb,client);advance(s,2000);
  const key='20|'+s.macOf(hb.id,'GigabitEthernet0'),old=s.linkAt(hb.id,'GigabitEthernet0')!;
  s.disconnect(old.id);Object.assign(a.config.interfaces[eth(4)],{adminUp:true,mode:'access',vlan:20});
  a.config.interfaces[eth(4)].features.portfast=true;
  s.connect({deviceId:hb.id,port:'GigabitEthernet0'},{deviceId:a.id,port:eth(4)});s.changed();advance(s,2000);
  ping(s,hb,client);advance(s,2000);
  assert.equal(a.runtime.mac[key]?.port,eth(4));assert.equal(b.runtime.mac[key]?.port,'Port-channel1');
  a.runtime.mac[key].expires=s.clock.now()+1000;advance(s,5000);
  assert.equal(a.runtime.mac[key],undefined);assert.equal(b.runtime.mac[key],undefined);
});

test('disabling vPC removes synchronized state and cancels peer timers rather than retaining stale MAC ownership',()=>{
  const {s,a,b,client,hb}=topology();ping(s,hb,client);advance(s,2000);
  const key='20|'+s.macOf(hb.id,'GigabitEthernet0');assert.ok(a.runtime.mac[key]);
  nsosConfig(a).enabled=nsosConfig(a).enabled.filter(f=>f!=='vpc');delete nsosConfig(a).vpc;
  for(const p of Object.values(a.config.interfaces))delete p.features.vpcId;
  s.changed();advance(s,4000);
  assert.equal(vpcRuntime(a),undefined);assert.equal(a.runtime.mac[key],undefined);
  assert.equal(vpcRuntime(b)!.adjacency,false);
});

test('keepalive packets cannot cross an incorrectly selected VRF, even with a healthy peer-link',()=>{
  const {s,a,b}=topology();
  for(const d of[a,b])nsosConfig(d).vpc!.keepalive!.vrf='wrong-vrf';
  s.changed();advance(s,7000);
  for(const d of[a,b]){assert.equal(vpcRuntime(d)!.adjacency,false);assert.equal(vpcRuntime(d)!.rxKeepalives,0);assert.equal(vpcRuntime(d)!.members[10].up,false);}
});

test('delay-restore is enforced to its exact deadline before member forwarding resumes',()=>{
  const {s,a,b,peerLinks}=topology();
  for(const link of peerLinks)s.disconnect(link.id);advance(s,10000);
  for(const n of[29,30])s.connect({deviceId:a.id,port:eth(n)},{deviceId:b.id,port:eth(n)});
  advance(s,3000);
  const until=vpcRuntime(b)!.restoreUntil!;assert.ok(until>s.clock.now());
  advance(s,until-s.clock.now()-1);assert.equal(vpcRuntime(b)!.members[10].up,false);
  advance(s,1);assert.equal(vpcRuntime(b)!.members[10].up,true);
});

test('save/load restores NS-OS configuration but starts fresh peer state and rejects malformed imported vPC configuration transactionally',()=>{
  const {s,a,b}=topology(),document=s.serialize(),loaded=new Simulator();
  loaded.load(document);assert.equal(vpcRuntime(loaded.getDevice(a.id)!)!.adjacency,false);advance(loaded,40000);
  assert.equal(vpcRuntime(loaded.getDevice(a.id)!)!.adjacency,true);
  assert.equal(vpcRuntime(loaded.getDevice(b.id)!)!.role,'secondary');
  const invalid:Array<[string,(config:Device['config'])=>void,RegExp]>=[
    ['domain',config=>{config.features.nsos.vpc.domain=0;},/vPC/],
    ['unsupported feature',config=>{config.features.nsos.enabled.push('hsrp');},/NS-OS feature/],
    ['missing personality',config=>{delete config.features.nsos;},/NS-OS/],
    ['missing physical port',config=>{delete config.interfaces[eth(30)];},/Ethernet1\/30/],
    ['management VRF',config=>{config.interfaces.mgmt0.vrf='default';},/management VRF/],
    ['multicast system MAC',config=>{config.features.nsos.vpc.systemMac='01:00:00:00:00:01';},/unicast/],
    ['IPv6 keepalive',config=>{config.features.nsos.vpc.keepalive.destination='2001:db8::2';},/IPv4/],
    ['null keepalive',config=>{config.features.nsos.vpc.keepalive=null;},/keepalive/],
  ];
  for(const target of['config','startupConfig']as const)for(const[name,mutate,expected]of invalid){
    const bad=structuredClone(document),device=bad.lab.devices.find(d=>d.id===a.id)!;
    if(target==='startupConfig')device.startupConfig=structuredClone(device.config);
    mutate(device[target]!);
    const before=loaded.lab;assert.throws(()=>loaded.load(bad),expected,`${target}: ${name}`);assert.equal(loaded.lab,before);
  }
  const cfg=structuredClone(a.config);cfg.interfaces['Port-channel99']={...defaultInterface('Port-channel99',true),features:{vpcId:10}};
  assert.throws(()=>validateNSOSConfiguration(cfg),/duplicate/);
});

test('auto-recovery is opt-in and obeys the full configured reload delay without a peer',()=>{
  const s=new Simulator(),a=s.addDevice('datacenter');nsosConfig(a).enabled=['vpc','lacp'];
  nsosConfig(a).vpc={...defaultVPC(1),autoRecovery:true};s.changed();
  advance(s,239999);assert.equal(vpcRuntime(a)!.state,'initializing');advance(s,1);
  assert.equal(vpcRuntime(a)!.state,'auto-recovery');
});
