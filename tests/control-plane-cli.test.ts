import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import type { Device } from '../src/model.ts';

function command(cli:IOSSession,...lines:string[]):void {
  for(const line of lines){const output=cli.execute(line);assert.ok(!output.some(s=>s.startsWith('%')),`${line}: ${output.join('\n')}`);}
}
function router(s:Simulator,ip:string):{d:Device;cli:IOSSession}{
  const d=s.addDevice('router'),cli=new IOSSession(s,d.id);command(cli,'enable','configure terminal','interface g0/0',`ip address ${ip} 255.255.255.0`,'no shutdown','exit');return{d,cli};
}
function cable(s:Simulator,a:Device,ap:string,b:Device,bp:string){return s.connect({deviceId:a.id,port:ap},{deviceId:b.id,port:bp});}

test('IOS commands enable real BFD-gated OSPF forwarding and loss withdrawal',()=>{
  const s=new Simulator(100),a=router(s,'10.0.0.1'),b=router(s,'10.0.0.2');
  for(const[r,n]of[[a,1],[b,2]] as const)command(r.cli,'interface g0/0','bfd interval 100 min_rx 100 multiplier 3','exit','interface loopback0',`ip address 192.0.2.${n} 255.255.255.255`,'no shutdown','exit','router ospf 1','network 0.0.0.0 255.255.255.255 area 0','bfd all-interfaces','end');
  const link=cable(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');s.advance(12000);
  assert.match(a.cli.execute('show bfd neighbors').join('\n'),/UP/);assert.match(a.cli.execute('ping 192.0.2.2').join('\n'),/100 percent/);
  link.loss=1;s.advance(500);assert.match(a.cli.execute('show bfd neighbors').join('\n'),/DOWN/);assert.ok(!a.d.runtime.routes.some(r=>r.network==='192.0.2.2'));
  assert.match(renderConfig(a.d).join('\n'),/bfd all-interfaces/);
});

test('IOS IP SLA scheduling measures actual replies and changes tracked gateway priority',()=>{
  const s=new Simulator(101),a=router(s,'10.0.0.1'),b=router(s,'10.0.0.2');
  command(a.cli,'ip sla 1','icmp-echo 10.0.0.2','frequency 2','timeout 500','threshold 100','exit','ip sla schedule 1 life forever start-time now','track 1 ip sla 1 reachability','interface g0/0','standby 1 ip 10.0.0.254','standby 1 track 1 decrement 20','end');command(b.cli,'end');
  const link=cable(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');s.advance(1000);
  assert.equal(a.d.runtime.features.ipSla[1].success,true);assert.equal(a.d.runtime.features.tracks[1].up,true);assert.equal(a.d.runtime.features.virtualIps[0].priority,100);
  link.loss=1;s.advance(2500);assert.equal(a.d.runtime.features.ipSla[1].success,false);assert.equal(a.d.runtime.features.tracks[1].up,false);assert.equal(a.d.runtime.features.virtualIps[0].priority,80);
});

test('IOS NHRP commands register distinct local network IDs and carry direct multipoint GRE traffic',()=>{
  const s=new Simulator(102),sw=s.addDevice('switch'),nodes=[router(s,'192.0.2.1'),router(s,'192.0.2.2'),router(s,'192.0.2.3')];
  for(const[r,index]of nodes.map((r,index)=>[r,index] as const)){
    command(r.cli,'interface tunnel0',`ip address 10.0.0.${index+1} 255.255.255.0`,'tunnel source g0/0','tunnel mode gre multipoint','tunnel key 77',`ip nhrp network-id ${100+index}`,'ip nhrp authentication lesson','ip nhrp holdtime 6');
    if(index===0)command(r.cli,'ip nhrp map multicast dynamic');else command(r.cli,'ip nhrp nhs 10.0.0.1 nbma 192.0.2.1','ip nhrp map multicast 192.0.2.1');
    command(r.cli,'no shutdown','end');cable(s,r.d,'GigabitEthernet0/0',sw,`GigabitEthernet0/${index+1}`);
  }
  s.advance(2500);assert.match(nodes[0].cli.execute('show ip nhrp').join('\n'),/192\.0\.2\.3/);
  assert.match(nodes[1].cli.execute('ping 10.0.0.3').join('\n'),/100 percent/);
  assert.match(renderConfig(nodes[1].d).join('\n'),/ip nhrp nhs 10.0.0.1 nbma 192.0.2.1/);
});

test('IOS configuration connects GLBP, multicast, UDLD and routing policy to consumed fields',()=>{
  const s=new Simulator(103),a=router(s,'10.0.0.1');
  command(a.cli,'ip multicast-routing','ip pim rp-address 10.0.0.1','ip community-list standard BLUE permit 65000:7','ip prefix-list CAMPUS permit 172.16.0.0/16 le 24','interface g0/0','glbp 1 ip 10.0.0.254','glbp 1 priority 120','glbp 1 weighting 100 lower 80 upper 95','glbp 1 load-balancing host-dependent','ip pim sparse-mode','ip igmp join-group 239.7.7.7','udld port aggressive','exit','router bgp 65000','neighbor 10.0.0.2 remote-as 65000','neighbor 10.0.0.2 route-reflector-client','neighbor 10.0.0.2 send-community','neighbor 10.0.0.2 maximum-prefix 100','exit','router ospf 1','area 1 range 172.16.0.0 255.255.0.0 cost 50','end');
  const f=a.d.config.features,iface=a.d.config.interfaces['GigabitEthernet0/0'];assert.equal(f.fhrp[0].weighting.lower,80);assert.equal(iface.features.pim,'sparse-mode');assert.equal(iface.features.udld.mode,'aggressive');assert.equal(a.d.config.protocols.bgp.neighbors[0].maximumPrefix,100);assert.equal(a.d.config.protocols.ospf.areas['1'].ranges[0].cost,50);
  const config=renderConfig(a.d).join('\n');assert.match(config,/glbp 1 load-balancing host-dependent/);assert.match(config,/neighbor 10.0.0.2 route-reflector-client/);assert.match(config,/area 1 range 172.16.0.0 255.255.0.0 cost 50/);
});

test('IOS named EIGRP IPv6 and active keychain authentication carry traffic and render configuration',()=>{
  const s=new Simulator(104),a=router(s,'10.0.0.1'),b=router(s,'10.0.0.2');
  for(const[r,n]of[[a,1],[b,2]] as const){
    command(r.cli,'ipv6 unicast-routing','key chain CAMPUS','key 7','key-string shared-secret','exit','exit','interface g0/0',`ipv6 address 2001:db8:10::${n}/64`,'exit','interface loopback0',`ipv6 address 2001:db8:${n}::1/64`,'no shutdown','exit','router eigrp CAMPUS','address-family ipv6 unicast autonomous-system 77',`eigrp router-id 1.1.1.${n}`,'af-interface g0/0','authentication mode md5','authentication key-chain CAMPUS','exit-af-interface','exit-address-family','end');
  }
  cable(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');s.advance(1300);assert.match(a.cli.execute('ping 2001:db8:2::1').join('\n'),/100 percent/);
  assert.equal(a.d.config.protocols.eigrp6.name,'CAMPUS');assert.equal(a.d.runtime.features.keychains.CAMPUS.sendKeyId,'7');
  const rendered=renderConfig(a.d).join('\n');assert.match(rendered,/address-family ipv6 unicast autonomous-system 77/);assert.match(rendered,/authentication key-chain eigrp 77 CAMPUS/);assert.match(rendered,/key-string shared-secret/);
  command(b.cli,'configure terminal','key chain CAMPUS','key 7','key-string wrong-secret','end');assert.ok(!a.d.runtime.routes.some(r=>r.network==='2001:db8:2::'&&r.protocol==='D'));assert.equal(a.d.runtime.neighbors.find(n=>n.protocol==='EIGRP6')?.state,'AUTH-FAILED');
});

test('IOS RIP policy commands filter advertisements and offset the installed metric',()=>{
  const s=new Simulator(105),a=router(s,'10.0.0.1'),b=router(s,'10.0.0.2');
  command(a.cli,'router rip','version 2','network 10.0.0.0','end');command(b.cli,'interface loopback0','ip address 192.0.2.1 255.255.255.0','no shutdown','exit','ip prefix-list BLOCK deny 192.0.2.0/24','ip prefix-list BLOCK permit 0.0.0.0/0 le 32','ip access-list standard SELECT','permit 192.0.2.0 0.0.0.255','exit','router rip','version 2','network 10.0.0.0','network 192.0.2.0','distribute-list prefix BLOCK out g0/0','end');cable(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');s.advance(12000);
  assert.ok(!a.d.runtime.routes.some(r=>r.network==='192.0.2.0'&&r.protocol==='R'));command(b.cli,'configure terminal','router rip','no distribute-list prefix BLOCK out g0/0','offset-list SELECT out 5 g0/0','end');s.advance(1500);assert.equal(a.d.runtime.routes.find(r=>r.network==='192.0.2.0'&&r.protocol==='R')?.metric,6);assert.match(renderConfig(b.d).join('\n'),/offset-list SELECT out 5 GigabitEthernet0\/0/);
});

test('IOS root guard and LACP priority configuration reaches the operational switch model',()=>{
  const s=new Simulator(106),a=s.addDevice('switch'),b=s.addDevice('switch'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id);
  command(ca,'enable','configure terminal','spanning-tree vlan 1 priority 8192','lacp system-priority 100','interface g0/1','lacp port-priority 50','spanning-tree guard root','no shutdown','end');command(cb,'enable','configure terminal','spanning-tree vlan 1 priority 0','interface g0/1','no shutdown','end');cable(s,a,'GigabitEthernet0/1',b,'GigabitEthernet0/1');s.advance(2000);
  assert.equal(a.runtime.stp['1'].ports['GigabitEthernet0/1'].role,'root-inconsistent');assert.equal(a.config.features.lacpSystemPriority,100);assert.equal(a.config.interfaces['GigabitEthernet0/1'].features.lacpPortPriority,50);const rendered=renderConfig(a).join('\n');assert.match(rendered,/spanning-tree guard root/);assert.match(rendered,/lacp system-priority 100/);
});


test('IOS EIGRP interface hello and hold timers change actual packet-driven neighbor lifetime',()=>{
  const s=new Simulator(107),a=router(s,'10.0.0.1'),b=router(s,'10.0.0.2');for(const r of[a,b])command(r.cli,'interface g0/0','ip hello-interval eigrp 77 1','ip hold-time eigrp 77 3','exit','router eigrp 77','network 10.0.0.0 0.0.0.255','end');const wire=cable(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');s.advance(100);assert.equal(a.d.runtime.features.eigrpHelloNeighbors[0].holdTime,3);assert.match(renderConfig(a.d).join('\n'),/ip hello-interval eigrp 77 1/);wire.lossBA=1;s.advance(3100);assert.equal(a.d.runtime.neighbors.find(n=>n.protocol==='EIGRP')?.state,'INIT (HELLO)');
});
