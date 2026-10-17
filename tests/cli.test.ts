import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import {IOS_BOOT_DURATION} from '../src/ios-boot.ts';
import { renderConfig } from '../src/config-renderer.ts';

function lab(kind: 'router'|'switch'|'l3switch'|'pc'='router') {
  const engine = new Simulator(1234), device=engine.addDevice(kind), cli=new IOSSession(engine,device.id);
  return {engine,device,cli};
}
function ok(cli: IOSSession,...lines:string[]) {
  for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(x=>/^%/.test(x)),`${line}: ${out.join('\n')}`);}
}
function conf(cli:IOSSession,...lines:string[]){ok(cli,'enable','configure terminal',...lines);}

test('mode transitions, abbreviations, contextual completion and ambiguity preserve state',()=>{
  const {device,cli}=lab();assert.equal(cli.prompt,'R1>');ok(cli,'en');assert.equal(cli.prompt,'R1#');
  assert.deepEqual(cli.execute('conf'),[]);assert.match(cli.prompt,/Configuring from terminal/);cli.cancel();assert.equal(cli.mode,'priv');
  assert.equal(cli.complete('conf t'),'conf terminal ');assert.ok(cli.help('show ip ').some(x=>x.includes('route')));
  ok(cli,'conf t','host Edge');assert.equal(cli.prompt,'Edge(config)#');
  assert.match(cli.execute('i')[0],/Ambiguous/);assert.equal(device.config.hostname,'Edge');
  ok(cli,'int g0/0','ip add 192.0.2.1 255.255.255.0','no shut');assert.equal(cli.prompt,'Edge(config-if)#');
  assert.equal(device.config.interfaces['GigabitEthernet0/0'].ip,'192.0.2.1');
  assert.ok(cli.execute('do show ip int br').some(x=>x.includes('192.0.2.1')));assert.equal(cli.mode,'interface');
  ok(cli,'exit');assert.equal(cli.mode,'config');ok(cli,'end');assert.equal(cli.mode,'priv');
});

test('invalid input cannot change interface configuration and no/default restore fields',()=>{
  const {device,cli}=lab();conf(cli,'interface g0/0','ip address 10.1.1.1 255.255.255.0');
  const port=device.config.interfaces['GigabitEthernet0/0'];
  assert.match(cli.execute('ip address 10.1.1.400 255.255.255.0')[0],/Invalid IPv4/);
  assert.match(cli.execute('ip address 10.1.1.2 255.0.255.0')[0],/contiguous/);assert.equal(port.ip,'10.1.1.1');
  assert.match(cli.execute('mtu 1500.5')[0],/integer/);assert.equal(port.mtu,1500);
  ok(cli,'mtu 1400','default mtu','no ip address');assert.equal(port.mtu,1500);assert.equal(port.ip,undefined);
});

test('interface ranges, VLAN creation, trunk set/add/remove and virtual interface naming',()=>{
  const {device,cli}=lab('l3switch');conf(cli,'vlan 10','name Engineering','exit','vlan 20','exit','interface range g0/1 - 3','switchport mode access','switchport access vlan 10');
  for(let i=1;i<=3;i++)assert.equal(device.config.interfaces[`GigabitEthernet0/${i}`].vlan,10);
  ok(cli,'exit','interface g1/1','switchport mode trunk','switchport trunk allowed vlan 10','switchport trunk allowed vlan add 20','switchport trunk allowed vlan remove 10');
  assert.deepEqual(device.config.interfaces['GigabitEthernet1/1'].allowedVlans,[20]);
  ok(cli,'exit','interface vlan10','ip address 10.10.0.1 255.255.255.0','no shutdown','end');
  assert.equal(device.config.interfaces.Vlan10.ip,'10.10.0.1');assert.equal(device.config.vlans[10].name,'Engineering');
  assert.match(cli.execute('show vlan brief').join('\n'),/Engineering/);
});

test('startup configuration is separate and reload drops unsaved configuration',()=>{
  const {engine,device,cli}=lab();conf(cli,'hostname Saved','interface loopback0','ip address 10.0.0.1 255.255.255.255','end','write memory');
  conf(cli,'hostname Unsaved','interface loopback0','description temporary','end');
  assert.equal(device.startupConfig?.hostname,'Saved');assert.equal(device.config.hostname,'Unsaved');
  ok(cli,'reload','no','');assert.equal(engine.getDevice(device.id)?.config.hostname,'Saved');assert.equal(cli.mode,'user');
  assert.equal(cli.busy,true);engine.advance(IOS_BOOT_DURATION);ok(cli,'','enable');const restored=cli.execute('show running-config').join('\n');assert.match(restored,/hostname Saved/);assert.ok(!restored.includes('temporary'));
});

test('static route parsing is atomic, supports discard and floating routes',()=>{
  const {device,cli}=lab();conf(cli,'ip route 192.0.2.0 255.255.255.0 Null0 200');
  assert.deepEqual(device.config.staticRoutes,[{network:'192.0.2.0',prefix:24,interface:'Null0',ad:200}]);
  assert.match(cli.execute('ip route 192.0.2.1 255.255.255.0 10.0.0.1')[0],/Inconsistent/);assert.equal(device.config.staticRoutes.length,1);
  ok(cli,'no ip route 192.0.2.0 255.255.255.0 Null0 200');assert.equal(device.config.staticRoutes.length,0);
});

test('protocol configuration and output preserve actual networks and Cisco wildcard notation',()=>{
  const {device,cli}=lab();conf(cli,'router ospf 10','router-id 1.1.1.1','network 10.0.0.0 0.0.255.255 area 0','passive-interface default','end');
  assert.deepEqual(device.config.protocols.ospf.networks,[{network:'10.0.0.0',prefix:16,area:'0'}]);
  assert.match(renderConfig(device).join('\n'),/network 10.0.0.0 0.0.255.255 area 0/);
  assert.match(cli.execute('show ip ospf neighbor').join('\n'),/Neighbor ID\s+Pri\s+State/);
  conf(cli,'router bgp 65001','neighbor 192.0.2.2 remote-as 65002','address-family ipv4 unicast','network 10.0.0.0 mask 255.255.0.0','exit-address-family','neighbor 192.0.2.2 shutdown','end');
  assert.equal(device.config.protocols.bgp.neighbors[0].shutdown,true);
});

test('named and numbered ACL entries parse sequences and invalid matches leave rules intact',()=>{
  const {device,cli}=lab();conf(cli,'ip access-list extended WEB','10 permit tcp 10.0.0.0 0.0.0.255 host 192.0.2.10 eq 80','20 deny ip any any');
  const acl=device.config.features.acls.WEB;assert.equal(acl.entries[0].destinationPort,80);assert.equal(acl.entries[0].source,'10.0.0.0');
  assert.match(cli.execute('30 permit tcp any host 192.0.2.10 eq 99999')[0],/between/);assert.equal(acl.entries.length,2);
  ok(cli,'no 20','exit','access-list 1 permit 10.0.0.0 0.0.0.255','interface g0/0','ip access-group WEB in');
  assert.equal(acl.entries.length,1);assert.equal(device.config.interfaces['GigabitEthernet0/0'].features.aclIn,'WEB');
  assert.equal(device.config.features.acls['1'].type,'standard');
});

test('original CLI configures a two-router lab and ping reports actual success then actual failure',()=>{
  const {engine,device:a,cli:ca}=lab();const b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);
  engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  conf(ca,'interface g0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','end');
  conf(cb,'interface g0/0','ip address 10.0.0.2 255.255.255.0','no shutdown','end');
  assert.match(ca.execute('ping 10.0.0.2 repeat 2').join('\n'),/100 percent \(2\/2\)/);
  conf(cb,'interface g0/0','shutdown','end');
  assert.match(ca.execute('ping 10.0.0.2 repeat 2 timeout 1').join('\n'),/0 percent \(0\/2\)/);
});

test('DHCP CLI configuration drives the actual host address exchange',()=>{
  const {engine,device:router,cli}=lab();const pc=engine.addDevice('pc'),host=new IOSSession(engine,pc.id);
  engine.connect({deviceId:router.id,port:'GigabitEthernet0/0'},{deviceId:pc.id,port:'GigabitEthernet0'});
  conf(cli,'interface g0/0','ip address 10.50.0.1 255.255.255.0','no shutdown','exit','ip dhcp excluded-address 10.50.0.1 10.50.0.10','ip dhcp pool OFFICE','network 10.50.0.0 255.255.255.0','default-router 10.50.0.1','dns-server 10.50.0.1','end');
  const out=host.execute('ipconfig /renew');assert.match(out.join('\n'),/10.50.0.11/);assert.equal(pc.config.defaultGateway,'10.50.0.1');
});

test('unsupported commands never return fake success and configuration-only features disclose their limit',()=>{
  const {cli}=lab();conf(cli);assert.match(cli.execute('crypto isakmp certificate 10').join('\n'),/Invalid/);
  ok(cli,'enable secret training');
  ok(cli,'vrf definition TEST');assert.match(cli.execute('rd 65000:1')[0],/configuration stored only/);ok(cli,'exit');
  ok(cli,'router ospf 1');assert.match(cli.execute('redistribute isis').join('\n'),/Invalid/);
});

test('multiline paste retains mode transitions and command order',()=>{
  const {device,cli}=lab();const out=cli.execute('enable\nconfigure terminal\nhostname Pasted\ninterface loopback1\nip address 198.51.100.1 255.255.255.255\nend');
  assert.ok(!out.some(x=>/^%/.test(x)));assert.equal(device.config.hostname,'Pasted');assert.equal(cli.mode,'priv');
  assert.equal(cli.complete('show ip rou'),'show ip route ');assert.ok(cli.help('show ip rou').some(x=>x.includes('route')));
});

test('simulated TFTP upload, download, flash copy and configuration merge use packet results',()=>{
  const {engine,device:a,cli:ca}=lab();const b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);
  engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  conf(ca,'interface g0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','end');
  conf(cb,'interface g0/0','ip address 10.0.0.2 255.255.255.0','no shutdown','end');
  b.config.services.tftp={enabled:true,files:{}};
  ok(ca,'copy running-config tftp:');assert.match(ca.prompt,/remote host/);ok(ca,'10.0.0.2');assert.match(ca.prompt,/Filename/);
  assert.match(ca.execute('backup.cfg').join('\n'),/bytes copied/);assert.match(b.config.services.tftp.files['backup.cfg'],/10.0.0.1/);
  ok(ca,'copy tftp: flash:backup.cfg','10.0.0.2');assert.match(ca.execute('backup.cfg').join('\n'),/copied/);
  assert.match(ca.execute('more flash:backup.cfg').join('\n'),/hostname R1/);
  b.config.services.tftp.files['change.cfg']='hostname Restored\ninterface Loopback5\nip address 198.51.100.5 255.255.255.255\nend';
  ok(ca,'copy tftp: running-config','10.0.0.2','change.cfg');assert.equal(a.config.hostname,'Restored');assert.equal(a.config.interfaces.Loopback5.ip,'198.51.100.5');
  ok(ca,'copy tftp: flash:absent','10.0.0.2');assert.match(ca.execute('missing.cfg')[0],/TFTP failed/);assert.equal(a.config.features.files.absent,undefined);
});

test('NTP and syslog CLI controls produce actual management packets',()=>{
  const {engine,device:a,cli:ca}=lab();const b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);
  engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  conf(ca,'interface g0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','end');
  conf(cb,'interface g0/0','ip address 10.0.0.2 255.255.255.0','no shutdown','exit','ntp master 3','end');
  conf(ca,'ntp server 10.0.0.2','logging host 10.0.0.2','logging trap informational','end');
  b.config.services.syslog={enabled:true};engine.clock.advance(5000);
  assert.equal(a.runtime.features.ntp.stratum,4);
  ok(ca,'send log 5 training-message');assert.equal(b.runtime.features.syslogReceived.at(-1).message,'training-message');
  assert.match(ca.execute('show ntp status').join('\n'),/Clock is synchronized/);
});

test('policy, security, monitor and flow commands configure the agreed packet-policy schema',()=>{
  const {device,cli}=lab('switch');conf(cli,'ip dhcp snooping','ip dhcp snooping vlan 10,20','ip arp inspection vlan 10','class-map match-any VOICE','match dscp ef cs5','exit','policy-map EDGE','class VOICE','set dscp af31','police 1000000 8000','end');
  assert.deepEqual(device.config.features.classMaps.VOICE.dscp,[46,40]);assert.equal(device.config.features.policyMaps.EDGE.classes[0].police.rate,1000000);
  conf(cli,'interface g0/1','ip dhcp snooping trust','ip arp inspection trust','ip verify source','service-policy input EDGE','switchport port-security','switchport port-security maximum 2','switchport port-security mac-address sticky','ip flow ingress','exit','monitor session 1 source interface g0/1 both','monitor session 1 destination interface g0/2','end');
  const f=device.config.interfaces['GigabitEthernet0/1'].features;assert.equal(f.servicePolicyIn,'EDGE');assert.equal(f.portSecurity.maximum,2);assert.equal(f.portSecurity.sticky,true);
  assert.equal(device.config.features.spanSessions[1].destination,'GigabitEthernet0/2');assert.deepEqual(device.config.features.dhcpSnooping.vlans,[10,20]);
});

test('IPv6 configuration, prefix lists and route-map redistribution serialize structured behavior',()=>{
  const {device,cli}=lab();conf(cli,'ipv6 unicast-routing','interface loopback6','ipv6 address 2001:db8:1::1/64','ipv6 ospf 5 area 0','exit','ipv6 router ospf 5','router-id 1.1.1.1','exit','ip prefix-list LAN seq 10 permit 192.0.2.0/24 le 32','route-map IMPORT permit 10','match ip address prefix-list LAN','set tag 99','exit','router ospf 1','redistribute static metric 20 metric-type 1 route-map IMPORT','end');
  assert.deepEqual(device.config.interfaces.Loopback6.features.ospfv3,{processId:5,area:'0'});assert.equal(device.config.features.prefixLists.LAN[0].le,32);
  assert.equal(device.config.protocols.ospf.redistribute[0].routeMap,'IMPORT');
  const text=renderConfig(device).join('\n');assert.match(text,/ipv6 ospf 5 area 0/);assert.match(text,/ip prefix-list LAN seq 10 permit 192.0.2.0\/24 le 32/);assert.match(text,/redistribute static metric 20 metric-type 1 route-map IMPORT/);
});

test('rendered configuration round-trips ACL attachments, policies, authentication, automation and IPv6 services',()=>{
  const {engine,device,cli}=lab();conf(cli,'ip access-list extended EDGE','permit ip any any','exit','class-map match-any BULK','match dscp af11','exit','policy-map QOS','class BULK','set dscp af12','exit','exit','interface g0/0','ip access-group EDGE in','service-policy input QOS','ipv6 enable','ipv6 nd managed-config-flag','ipv6 dhcp server V6','exit','ip domain-name training.test','crypto key generate rsa modulus 2048','enable secret lab-secret','username admin privilege 15 secret user-secret','aaa new-model','aaa authentication login default local','line vty 0 4','login authentication default','transport input ssh','privilege level 15','exit','ipv6 dhcp pool V6','address prefix 2001:db8:10::/64','dns-server 2001:db8:10::53','domain-name training.test','prefix-delegation 2001:db8:100::/48 length 64','exit','event manager applet SAVE','event none','action 1 cli command "write memory"','exit','archive','path flash:archive','maximum 5','exit','end');
  const rendered=renderConfig(device).join('\n');
  const target=engine.addDevice('router'),other=new IOSSession(engine,target.id);target.config.features.files={snapshot:rendered};ok(other,'enable','copy flash:snapshot running-config');
  assert.deepEqual(target.config.features.acls,device.config.features.acls);assert.deepEqual(target.config.features.policyMaps,device.config.features.policyMaps);assert.deepEqual(target.config.features.lines,device.config.features.lines);assert.deepEqual(target.config.features.eem,device.config.features.eem);assert.deepEqual(target.config.services.dhcpv6,device.config.services.dhcpv6);assert.equal(target.config.interfaces['GigabitEthernet0/0'].features.aclIn,'EDGE');assert.equal(target.config.features.enableSecret,'lab-secret');
});

test('IPv6 SLAAC and DHCPv6 CLI initiate packet exchanges and host probes use assigned addresses',()=>{
  const {engine,device:r,cli}=lab();const h=engine.addDevice('pc'),host=new IOSSession(engine,h.id);engine.connect({deviceId:r.id,port:'GigabitEthernet0/0'},{deviceId:h.id,port:'GigabitEthernet0'});
  conf(cli,'ipv6 unicast-routing','interface g0/0','ipv6 address 2001:db8:1::1/64','no shutdown','exit','ipv6 dhcp pool HOSTS','address prefix 2001:db8:1::/64','dns-server 2001:db8:1::1','exit','interface g0/0','ipv6 dhcp server HOSTS','end');
  const out=host.execute('ipconfig /autoconfig6');assert.ok(out.some(x=>x.includes('2001:db8:1:')),out.join('\n'));assert.ok(h.config.interfaces.GigabitEthernet0.ipv6.length>0);assert.ok(host.execute('ping 2001:db8:1::1 -n 1').some(x=>x.includes('Received = 1')));
  const renewed=host.execute('ipconfig /renew6');assert.ok(!renewed.some(x=>x.startsWith('DHCPv6 failed')),renewed.join('\n'));assert.ok(h.runtime.features.dhcpv6Leases.GigabitEthernet0.address);
});

test('IPv6 ACLs and UTC time ranges govern actual packets and remarks do not deny traffic',()=>{
  const {engine,device:a,cli:ca}=lab();const b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});for(const [cli,ip]of [[ca,'2001:db8::1'],[cb,'2001:db8::2']] as const)conf(cli,'ipv6 unicast-routing','interface g0/0',`ipv6 address ${ip}/64`,'no shutdown','end');
  conf(cb,'time-range OFFICE','periodic daily 09:00 to 17:00','exit','ipv6 access-list HOURS','remark Allow scheduled requests','permit icmp any any time-range OFFICE','deny ipv6 any any','exit','interface g0/0','ipv6 traffic-filter HOURS in','end');
  engine.advance(1100);ok(cb,'clock set 10:00:00 1 January 2026');assert.match(ca.execute('ping 2001:db8::2 repeat 1').join('\n'),/100 percent/);ok(cb,'clock set 18:00:00 1 January 2026');assert.match(ca.execute('ping 2001:db8::2 repeat 1').join('\n'),/0 percent/);assert.match(cb.execute('show time-range').join('\n'),/inactive/);
});

test('IOS crypto configuration negotiates modeled IKE/ESP and round-trips without proprietary code',()=>{
  const {engine,device:a,cli:ca}=lab();const b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  for(const [cli,local,peer]of [[ca,'10.0.0.1','10.0.0.2'],[cb,'10.0.0.2','10.0.0.1']] as const)conf(cli,'interface g0/0',`ip address ${local} 255.255.255.0`,'no shutdown','exit','ip access-list extended PROTECTED',`permit ip host ${local} host ${peer}`,'exit','crypto isakmp policy 10','encryption aes 256','hash sha','authentication pre-share','group 14','exit',`crypto isakmp key training-key address ${peer}`,'crypto ipsec transform-set ESP esp-aes 256 esp-sha-hmac','mode tunnel','exit','crypto map VPN 10 ipsec-isakmp',`set peer ${peer}`,'set transform-set ESP','match address PROTECTED','exit','interface g0/0','crypto map VPN','end');
  assert.match(ca.execute('ping 10.0.0.2 repeat 1').join('\n'),/100 percent/);assert.ok(a.runtime.features.ipsecSAs.some((s:any)=>s.encaps>0&&s.decaps>0));assert.match(ca.execute('show crypto isakmp sa').join('\n'),/QM_IDLE/);
  const c=engine.addDevice('router'),cc=new IOSSession(engine,c.id);c.config.features.files={test:renderConfig(a).join('\n')};ok(cc,'enable','copy flash:test running-config');assert.deepEqual(c.config.features.crypto,a.config.features.crypto);ok(ca,'clear crypto ipsec sa');assert.equal(a.runtime.features.ipsecSAs.length,0);
});

test('interface NAT role arguments retain precedence over global NAT source prefixes',()=>{
  const {device,cli}=lab();conf(cli,'interface g0/0','ip nat inside','ip nat inside source list 1 interface g0/1 overload','interface g0/1','ip nat outside','end');assert.equal(device.config.interfaces['GigabitEthernet0/0'].features.nat,'inside');assert.equal(device.config.interfaces['GigabitEthernet0/1'].features.nat,'outside');assert.equal(device.config.features.nat.rules[0].interface,'GigabitEthernet0/1');
});

test('SNMP runtime configuration and partial security/SSO settings round-trip with accurate disclosure',()=>{
  const {engine,device,cli}=lab();conf(cli);ok(cli,'snmp-server community monitor ro 10','snmp-server group OPS v3 priv read READ','snmp-server view READ iso included');assert.match(cli.execute('snmp-server user admin OPS v3 auth sha authpass priv aes 128 privpass').join('\n'),/USM authentication\/encryption is not implemented/);assert.match(cli.execute('snmp-server engineid local 0123456789').join('\n'),/key localization is not implemented/);assert.match(cli.execute('snmp-server host 192.0.2.5 version 3 priv admin').join('\n'),/no USM cryptography/);for(const command of ['redundancy','mode sso'])assert.ok(cli.execute(command).some(x=>x.includes('configuration stored only')),command);ok(cli,'end');const target=engine.addDevice('router'),session=new IOSSession(engine,target.id);target.config.features.files={config:renderConfig(device).join('\n')};ok(session,'enable','copy flash:config running-config');assert.deepEqual(target.config.features.snmp,device.config.features.snmp);assert.deepEqual(target.config.features.redundancy,device.config.features.redundancy);
});

test('advanced security and flexible flow settings round-trip to the exact consumed fields',()=>{
  const {engine,device,cli}=lab('switch');conf(cli,'flow record RECORD','match ipv4 source address','match ipv4 destination address','match ip protocol','collect counter bytes','collect counter packets','exit','flow exporter EXPORT','destination 192.0.2.50','transport udp 2055','export-protocol netflow-v9','exit','flow monitor MONITOR','record RECORD','exporter EXPORT','cache timeout active 20','exit','arp access-list VALID','permit ip host 192.0.2.10 mac host 0011.2233.4455','exit','ip arp inspection filter VALID vlan 10 static','ip arp inspection validate src-mac dst-mac ip','ip source binding 0011.2233.4455 vlan 10 192.0.2.10 interface g0/1','ip dhcp snooping information option','lacp system-priority 100','interface g0/1','ip flow monitor MONITOR input','ip dhcp snooping limit rate 10','ip arp inspection limit rate 20','switchport port-security','switchport port-security aging time 5','switchport port-security aging type inactivity','switchport port-security aging static','spanning-tree guard root','spanning-tree bpdufilter enable','lacp port-priority 100','end');
  const target=engine.addDevice('switch'),other=new IOSSession(engine,target.id);target.config.features.files={snapshot:renderConfig(device).join('\n')};ok(other,'enable','copy flash:snapshot running-config');for(const field of ['flowRecords','flowExporters','flowMonitors','arpAcls','arpInspection','staticBindings','dhcpSnooping','lacpSystemPriority'])assert.deepEqual(target.config.features[field],device.config.features[field],field);assert.deepEqual(target.config.interfaces['GigabitEthernet0/1'].features,device.config.interfaces['GigabitEthernet0/1'].features);
});

test('named EIGRP and active key lifetimes govern adjacency and survive configuration rendering',()=>{
  const {engine,device:a,cli:ca}=lab();const b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  for(const [cli,ip,rid]of [[ca,'10.0.0.1','1.1.1.1'],[cb,'10.0.0.2','2.2.2.2']] as const)conf(cli,'interface g0/0',`ip address ${ip} 255.255.255.0`,'no shutdown','exit','key chain ROUTING','key 10','key-string shared-routing','send-lifetime 00:00:00 January 1 2026 duration 5','accept-lifetime 00:00:00 January 1 2026 duration 5','exit','exit','router eigrp FABRIC','address-family ipv4 unicast autonomous-system 100',`eigrp router-id ${rid}`,'network 10.0.0.0 0.0.0.255','af-interface g0/0','authentication mode md5','authentication key-chain ROUTING','exit-af-interface','exit-address-family','end');
  engine.clock.advance(100);assert.ok(a.runtime.neighbors.some(n=>n.protocol==='EIGRP'&&n.state==='UP'));assert.match(ca.execute('show key chain').join('\n'),/send-lifetime: valid now/);
  const c=engine.addDevice('router'),cc=new IOSSession(engine,c.id);c.config.features.files={snapshot:renderConfig(a).join('\n')};ok(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(c.config.features.keychains,a.config.features.keychains);assert.deepEqual(c.config.protocols.eigrp,a.config.protocols.eigrp);
  engine.clock.advance(5100);assert.ok(!a.runtime.neighbors.some(n=>n.protocol==='EIGRP'&&n.state==='UP'));
});

test('flexible NetFlow CLI records actual transit traffic and exports packet deltas to a collector',()=>{
  const {engine,device:r,cli}=lab(),a=engine.addDevice('pc'),b=engine.addDevice('server'),port='GigabitEthernet0';
  for(const [d,address,gateway]of [[a,'10.1.0.10','10.1.0.1'],[b,'10.2.0.20','10.2.0.1']] as const){Object.assign(d.config.interfaces[port],{ip:address,mask:'255.255.255.0',adminUp:true});d.config.defaultGateway=gateway;}b.config.services.netflow={enabled:true};
  engine.connect({deviceId:a.id,port},{deviceId:r.id,port:'GigabitEthernet0/0'});engine.connect({deviceId:b.id,port},{deviceId:r.id,port:'GigabitEthernet0/1'});
  conf(cli,'flow record SOURCE','match ipv4 source address','collect counter packets','collect counter bytes','exit','flow exporter COLLECTOR','destination 10.2.0.20','source g0/1','transport udp 2055','exit','flow monitor MONITOR','record SOURCE','exporter COLLECTOR','cache timeout active 1','exit','interface g0/0','ip address 10.1.0.1 255.255.255.0','ip flow monitor MONITOR input','no shutdown','interface g0/1','ip address 10.2.0.1 255.255.255.0','no shutdown','end');
  const host=new IOSSession(engine,a.id);assert.match(host.execute('ping 10.2.0.20 -n 2').join('\n'),/Received = 2/);engine.clock.advance(2000);
  // Windows ping counts 32 data bytes plus the 20-byte IPv4 and 8-byte ICMP headers.
  assert.equal(r.runtime.features.flowMonitorCaches.MONITOR.length,1);assert.equal(r.runtime.features.flowMonitorCaches.MONITOR[0].packets,2);assert.equal(b.runtime.features.netflowReceived.reduce((n:number,f:any)=>n+f.packets,0),2);assert.match(cli.execute('show flow monitor MONITOR cache').join('\n'),/10\.1\.0\.10.*\s2\s+120/);
});

test('RIP distribute and offset lists change learned routes and serialize the consumed rules',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  for(const [cli,ip]of [[ca,'10.0.0.1'],[cb,'10.0.0.2']] as const)conf(cli,'interface g0/0',`ip address ${ip} 255.255.255.0`,'no shutdown','router rip','version 2','network 10.0.0.0','end');
  conf(cb,'interface loopback0','ip address 192.0.2.1 255.255.255.0','no shutdown','router rip','network 192.0.2.0','end');engine.clock.advance(1500);assert.equal(a.runtime.routes.find(r=>r.network==='192.0.2.0'&&r.protocol==='R')?.metric,1);
  conf(cb,'ip prefix-list BLOCK seq 10 deny 192.0.2.0/24','ip prefix-list BLOCK seq 20 permit 0.0.0.0/0 le 32','router rip','distribute-list prefix BLOCK out g0/0','end');engine.clock.advance(1500);assert.ok(!a.runtime.routes.some(r=>r.network==='192.0.2.0'&&r.protocol==='R'));
  conf(cb,'router rip','no distribute-list prefix BLOCK out g0/0','exit','access-list 10 permit 192.0.2.0 0.0.0.255','router rip','offset-list 10 out 5 g0/0','end');engine.clock.advance(1500);assert.equal(a.runtime.routes.find(r=>r.network==='192.0.2.0'&&r.protocol==='R')?.metric,6);
  const c=engine.addDevice('router'),cc=new IOSSession(engine,c.id);c.config.features.files={snapshot:renderConfig(b).join('\n')};ok(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(c.config.protocols.rip.offsetLists,b.config.protocols.rip.offsetLists);assert.deepEqual(c.config.protocols.rip.networks,b.config.protocols.rip.networks);assert.equal(c.config.protocols.rip.distributeLists?.length||0,0);
});

test('OSPF interface show exposes computed roles and named IPv6 rendering creates no IPv4 process',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  for(const [cli,ip,rid,priority]of [[ca,'10.0.0.1','1.1.1.1',100],[cb,'10.0.0.2','2.2.2.2',1]] as const)conf(cli,'interface g0/0',`ip address ${ip} 255.255.255.0`,'no shutdown',`ip ospf priority ${priority}`,'router ospf 1',`router-id ${rid}`,'network 10.0.0.0 0.0.0.255 area 0','end');
  assert.match(ca.execute('show ip ospf interface').join('\n'),/State DR, Priority 100[\s\S]*Designated Router \(ID\) 1\.1\.1\.1[\s\S]*Backup Designated router \(ID\) 2\.2\.2\.2/);assert.match(ca.execute('show ip ospf database').join('\n'),/Received logical router records/);assert.equal(ca.execute('show ip ospf virtual-links').join('\n'),'');
  const c=engine.addDevice('router'),cc=new IOSSession(engine,c.id);conf(cc,'no ip cef','ipv6 unicast-routing','interface g0/0');assert.match(cc.execute('ipv6 address 2001:db8::1/64 nonsense').join('\n'),/Invalid/);assert.deepEqual(c.config.interfaces['GigabitEthernet0/0'].ipv6,[]);ok(cc,'ipv6 address 2001:db8::1/64','router eigrp CAMPUS','address-family ipv6 unicast autonomous-system 77','eigrp router-id 3.3.3.3','end');const rendered=renderConfig(c).join('\n');assert.match(rendered,/address-family ipv6 unicast autonomous-system 77/);assert.doesNotMatch(rendered,/address-family ipv4/);assert.match(rendered,/no ip cef/);
});

test('manual link-local and EUI-64 configuration controls IPv6 identity and forwards with an interface source',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  for(const[cli,address]of[[ca,'fe80::1'],[cb,'fe80::2']]as const)conf(cli,'ipv6 unicast-routing','interface g0/0',`ipv6 address ${address} link-local`,'ipv6 address 2001:db8:44::/64 eui-64','no shutdown','end');
  assert.match(ca.execute('show ipv6 interface brief').join('\n'),/TENTATIVE/);engine.advance(1100);assert.equal(engine.linkLocalAddress(a.id,'GigabitEthernet0/0'),'fe80::1');assert.match(ca.execute('ping fe80::2 source g0/0 repeat 1').join('\n'),/100 percent/);const target=b.config.interfaces['GigabitEthernet0/0'].ipv6[0].split('/')[0];assert.match(ca.execute(`ping ${target} source g0/0 repeat 1`).join('\n'),/100 percent/);assert.match(ca.execute('show ipv6 interface brief').join('\n'),/FE80::1/);
  const text=renderConfig(a).join('\n');assert.match(text,/ipv6 address 2001:db8:44::\/64 eui-64/);assert.match(text,/ipv6 address fe80::1 link-local/);conf(ca,'interface g0/0');assert.match(ca.execute('ipv6 address 2001:db8::1 link-local').join('\n'),/link-local/);assert.match(ca.execute('ipv6 address 2001:db8::/48 eui-64').join('\n'),/\/64/);ok(ca,'no ipv6 address 2001:db8:44::/64 eui-64');assert.equal(a.config.interfaces['GigabitEthernet0/0'].ipv6.length,0);
});

test('interface ARP timeout ages real learned entries and routing timer/hash controls render exactly',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});for(const[cli,address]of[[ca,'10.0.0.1'],[cb,'10.0.0.2']]as const)conf(cli,'interface g0/0',`ip address ${address} 255.255.255.0`,'arp timeout 1','no shutdown','end');assert.match(ca.execute('ping 10.0.0.2 repeat 1').join('\n'),/100 percent/);assert.ok(Object.values(a.runtime.arp).some(x=>x.ip==='10.0.0.2'));engine.clock.advance(2000);assert.ok(!Object.values(a.runtime.arp).some(x=>x.ip==='10.0.0.2'));
  conf(ca,'port-channel load-balance src-dst-ip','interface g0/0','no ip split-horizon','router rip','timers basic 5 15 15 25','router eigrp 22','timers active-time disabled','end');const c=engine.addDevice('router'),cc=new IOSSession(engine,c.id);c.config.features.files={snapshot:renderConfig(a).join('\n')};ok(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(c.config.features.etherchannel,a.config.features.etherchannel);assert.deepEqual(c.config.protocols.rip.timers,a.config.protocols.rip.timers);assert.equal(c.config.protocols.eigrp.activeTime,0);assert.equal(c.config.interfaces['GigabitEthernet0/0'].features.rip.splitHorizon,false);assert.match(ca.execute('show etherchannel load-balance').join('\n'),/src-dst-ip/);
});

test('interactive extended ping accepts defaults, validates answers, sweeps sizes and cancels cleanly',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});for(const[cli,address]of[[ca,'10.0.0.1'],[cb,'10.0.0.2']]as const)conf(cli,'interface g0/0',`ip address ${address} 255.255.255.0`,'no shutdown','end');
  ok(ca,'ping');assert.equal(ca.prompt,'Protocol [ip]:');ok(ca,'','10.0.0.2');assert.match(ca.execute('0').join('\n'),/between/);assert.equal(ca.prompt,'Repeat count [5]:');ok(ca,'1','100','1','y','g0/0','184','y','y','0x1234','64','none','y','64','128');const out=ca.execute('32');assert.equal(out.filter(x=>x.includes('100 percent')).length,3);assert.ok(engine.events.some(e=>e.packet?.dscp===46));assert.equal(ca.prompt,'R1#');
  ok(ca,'ping','');ca.cancel();assert.equal(ca.prompt,'R1#');ok(ca,'ping ip','10.0.0.2','1','','','n');assert.match(ca.execute('').join('\n'),/100 percent/);
});

test('BGP show table and prefix details expose actual two-AS paths separately from the routing table',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),c=engine.addDevice('router'),cb=new IOSSession(engine,b.id),cc=new IOSSession(engine,c.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});engine.connect({deviceId:b.id,port:'GigabitEthernet0/1'},{deviceId:c.id,port:'GigabitEthernet0/0'});
  conf(ca,'interface g0/0','ip address 10.0.12.1 255.255.255.0','no shutdown','router bgp 65001','bgp router-id 1.1.1.1','neighbor 10.0.12.2 remote-as 65002','end');
  conf(cb,'interface g0/0','ip address 10.0.12.2 255.255.255.0','no shutdown','interface g0/1','ip address 10.0.23.2 255.255.255.0','no shutdown','router bgp 65002','bgp router-id 2.2.2.2','neighbor 10.0.12.1 remote-as 65001','neighbor 10.0.23.3 remote-as 65003','end');
  conf(cc,'interface g0/0','ip address 10.0.23.3 255.255.255.0','no shutdown','interface loopback0','ip address 10.30.0.1 255.255.255.0','no shutdown','router bgp 65003','bgp router-id 3.3.3.3','neighbor 10.0.23.2 remote-as 65002','network 10.30.0.0 mask 255.255.255.0','end');
  engine.clock.advance(3500);
  const table=ca.execute('show ip bgp').join('\n');assert.match(table,/LocPrf.*Path/);assert.match(table,/10\.30\.0\.0\/24.*65002 65003/);const detail=ca.execute('show ip bgp 10.30.0.0/24').join('\n');assert.match(detail,/\n  65002 65003\n/);assert.match(detail,/metric 0, localpref 100/);assert.match(ca.execute('show ip route bgp').join('\n'),/10\.30\.0\.0\/24/);assert.match(ca.execute('show ip bgp summary').join('\n'),/10\.0\.12\.2\s+4\s+65002[^\n]*\s1$/m);
});

test('flash copy counts UTF-8 bytes, rejects exhaustion atomically and reports capacity',()=>{
  const {device,cli}=lab();ok(cli,'enable');device.config.features.fileSystem={capacityBytes:12};device.config.features.files={source:'éé'};
  ok(cli,'copy flash:source flash:target');assert.match(cli.execute('dir').join('\n'),/12 bytes total \(4 bytes free\)/);device.config.features.files.source='éééé';const before=structuredClone(device.config.features.files);assert.match(cli.execute('copy flash:source flash:target').join('\n'),/Insufficient simulated flash space/);assert.deepEqual(device.config.features.files,before);
  assert.match(cli.execute('archive config').join('\n'),/Insufficient simulated flash space/);assert.equal(device.config.features.archives,undefined);ok(cli,'delete flash:target');assert.match(cli.execute('show file systems').join('\n'),/12\s+4\s+flash\s+rw\s+flash:/);
});

test('top talkers rank real observed traffic, preserve timed snapshots and render configuration',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:b.id,port:'GigabitEthernet0/0'});
  conf(ca,'int g0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','ip flow egress','exit','ip route 10.10.10.0 255.255.255.0 10.0.0.2','ip flow-top-talkers','top 1','sort-by bytes','cache-timeout 100000','end');
  conf(cb,'int g0/0','ip address 10.0.0.2 255.255.255.0','no shutdown','int loopback0','ip address 10.10.10.1 255.255.255.0','no shutdown','end');
  ok(ca,'ping 10.0.0.2 repeat 1 size 1000','ping 10.10.10.1 repeat 3 size 64');assert.match(ca.execute('show ip flow top-talkers').join('\n'),/10\.0\.0\.2/);assert.ok(!ca.execute('show ip flow top-talkers').join('\n').includes('10.10.10.1'));
  ok(ca,'conf t','ip flow-top-talkers','sort-by packets','end');assert.match(ca.execute('show ip flow top-talkers').join('\n'),/10\.10\.10\.1/);ok(ca,'ping 10.0.0.2 repeat 5 size 64');assert.match(ca.execute('show ip flow top-talkers').join('\n'),/10\.10\.10\.1/);engine.clock.advance(100001);assert.match(ca.execute('show ip flow top-talkers').join('\n'),/10\.0\.0\.2/);
  const text=renderConfig(a).join('\n');assert.match(text,/ip flow-top-talkers\n top 1\n sort-by packets\n cache-timeout 100000/);
});

test('BFD template, AS-path policy and persistent BGP timer syntax round-trip without permissive pattern fallback',()=>{
  const {device,cli}=lab();conf(cli,'bfd template single-hop FAST','interval min-tx 100 min-rx 150 multiplier 4','exit','ip as-path access-list FROM20 permit ^65020_','route-map PATHS permit 10','match as-path FROM20','exit','interface g0/0','bfd template FAST','exit','router bgp 65010','timers bgp 2 6','neighbor 10.0.0.2 remote-as 65020','neighbor 10.0.0.2 timers 1 3','neighbor 10.0.0.2 timers connect 2','neighbor 10.0.0.2 fall-over bfd','end');
  const text=renderConfig(device).join('\n'),other=lab();other.cli.setPrivilege(15);other.device.config.features.files={input:text};ok(other.cli,'copy flash:input running-config');assert.deepEqual(other.device.config.features.bfdTemplates,device.config.features.bfdTemplates);assert.equal(other.device.config.interfaces['GigabitEthernet0/0'].features.bfdTemplate,'FAST');assert.deepEqual(other.device.config.protocols.bgp,device.config.protocols.bgp);assert.deepEqual(other.device.config.features.asPathLists,device.config.features.asPathLists);
  ok(cli,'conf t','ip as-path access-list GROUPED permit (65020|65030)+');assert.equal(device.config.features.asPathLists.GROUPED[0].pattern,'(65020|65030)+');const before=structuredClone(device.config.features.asPathLists);assert.match(cli.execute('ip as-path access-list BAD permit .*+').join('\n'),/Invalid/);assert.deepEqual(device.config.features.asPathLists,before);
});

test('static IPv6 host names resolve locally and truthful platform displays use current model state',()=>{
  const {engine,device,cli}=lab();conf(cli,'ipv6 host self 2001:db8::1','int loopback0','ipv6 address 2001:db8::1/128','no shutdown','end');assert.match(cli.execute('ping self repeat 1').join('\n'),/100 percent/);assert.equal(engine.events.filter(e=>e.protocol==='DNS').length,0);assert.match(cli.execute('show inventory').join('\n'),new RegExp(device.id));assert.match(cli.execute('show processes cpu').join('\n'),/CPU\/memory utilization is not modeled/);assert.match(renderConfig(device).join('\n'),/ip host self 2001:db8::1/);
});

test('named RA guard roles change actual ingress admission and persist named attachments',()=>{
  const {engine,device:sw,cli}=lab('switch'),r=engine.addDevice('router'),pc=engine.addDevice('pc'),router=new IOSSession(engine,r.id);engine.connect({deviceId:r.id,port:'GigabitEthernet0/0'},{deviceId:sw.id,port:'GigabitEthernet0/1'});engine.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:sw.id,port:'GigabitEthernet0/2'});
  conf(router,'ipv6 unicast-routing','int g0/0','ipv6 address 2001:db8:51::1/64','no shutdown','end');conf(cli,'ipv6 nd raguard policy EDGE','device-role host','exit','ipv6 dhcp guard policy DHCP','device-role server','exit','int range g0/1-2','spanning-tree portfast','exit','int g0/1','ipv6 nd raguard attach-policy EDGE','ipv6 dhcp guard attach-policy DHCP','end');
  engine.clock.advance(1000);let result=engine.requestIPv6(pc.id);engine.clock.advance(10000);assert.equal(result.status,'failure');assert.ok(sw.runtime.features.raGuardDrops>0);ok(cli,'conf t','ipv6 nd raguard policy EDGE','device-role router','end');result=engine.requestIPv6(pc.id);engine.clock.advance(3000);assert.equal(result.status,'success');assert.ok(pc.config.interfaces.GigabitEthernet0.ipv6.some(ip=>ip.startsWith('2001:db8:51:')));
  const saved=renderConfig(sw).join('\n'),second=lab('switch');second.cli.setPrivilege(15);second.device.config.features.files={saved};ok(second.cli,'copy flash:saved running-config');assert.deepEqual(second.device.config.features.ipv6Policies,sw.config.features.ipv6Policies);assert.equal(second.device.config.interfaces['GigabitEthernet0/1'].features.raGuardPolicy,'EDGE');assert.equal(second.device.config.interfaces['GigabitEthernet0/1'].features.raGuard,false);
});

test('snooping, RIP summaries and BGP aggregate/TTL controls render consumed state and reject invalid combinations',()=>{
  const {device,cli}=lab();conf(cli,'ip igmp snooping','ip igmp snooping vlan 20 querier','ip igmp snooping vlan 20 querier address 192.0.2.1','ip igmp snooping vlan 20 querier query-interval 20','ip igmp snooping vlan 20 querier max-response-time 2','ip igmp snooping vlan 20 membership-interval 60','ip igmp snooping vlan 20 mrouter interface g0/1','ip igmp snooping vlan 20 immediate-leave','int g0/0','ip igmp version 2','ip rip send version 1 2','ip rip receive version 2','ip summary-address rip 10.0.0.0 255.0.0.0','exit','router rip','auto-summary','exit','router bgp 65000','aggregate-address 10.0.0.0 255.0.0.0 summary-only','neighbor 192.0.2.2 remote-as 65001','neighbor 192.0.2.2 ttl-security hops 2','end');
  const other=lab();other.cli.setPrivilege(15);other.device.config.features.files={saved:renderConfig(device).join('\n')};ok(other.cli,'copy flash:saved running-config');assert.deepEqual(other.device.config.features.igmpSnooping,device.config.features.igmpSnooping);assert.deepEqual(other.device.config.interfaces['GigabitEthernet0/0'].features.rip,device.config.interfaces['GigabitEthernet0/0'].features.rip);assert.deepEqual(other.device.config.protocols.bgp,device.config.protocols.bgp);
  ok(cli,'conf t','router bgp 65000');assert.match(cli.execute('neighbor 192.0.2.2 ebgp-multihop 3').join('\n'),/mutually exclusive/);assert.equal(device.config.protocols.bgp.neighbors[0].ebgpMultihop,undefined);
});

test('CLI ERSPAN traverses the network and local/RSPAN/ERSPAN configuration round-trips',()=>{
  const {engine,device:a,cli:ca}=lab(),b=engine.addDevice('router'),host=engine.addDevice('pc'),monitor=engine.addDevice('pc'),cb=new IOSSession(engine,b.id);engine.connect({deviceId:a.id,port:'GigabitEthernet0/0'},{deviceId:host.id,port:'GigabitEthernet0'});engine.connect({deviceId:a.id,port:'GigabitEthernet0/1'},{deviceId:b.id,port:'GigabitEthernet0/0'});engine.connect({deviceId:b.id,port:'GigabitEthernet0/1'},{deviceId:monitor.id,port:'GigabitEthernet0'});Object.assign(host.config.interfaces.GigabitEthernet0,{ip:'192.0.2.2',mask:'255.255.255.0',adminUp:true});conf(ca,'int g0/0','ip address 192.0.2.1 255.255.255.0','no shutdown','int g0/1','ip address 10.0.0.1 255.255.255.0','no shutdown','exit','monitor session 1 type erspan-source','source interface g0/0 rx','destination','erspan-id 42','ip address 10.0.0.2','origin ip address 10.0.0.1','exit','no shutdown','end');conf(cb,'int g0/0','ip address 10.0.0.2 255.255.255.0','no shutdown','int g0/1','no shutdown','exit','monitor session 5 type erspan-destination','destination interface g0/1','source','erspan-id 42','ip address 10.0.0.2','exit','no shutdown','end');const ping=engine.ping(host.id,'192.0.2.1',{count:1});engine.advance(1000);assert.equal(ping.received,1);assert.ok(b.runtime.features.spanStats[5].received>0);assert.ok(monitor.runtime.features.capturedFrames.some((f:any)=>f.protocol==='ICMP'));
  ok(ca,'conf t','vlan 90','remote-span','exit','monitor session 2 source interface g0/0 both','monitor session 2 destination remote vlan 90','monitor session 3 source remote vlan 90','monitor session 3 destination interface g0/1','end');const copy=engine.addDevice('router'),cli=new IOSSession(engine,copy.id);copy.config.features.files={snapshot:renderConfig(a).join('\n')};ok(cli,'enable','copy flash:snapshot running-config');assert.deepEqual(copy.config.features.spanSessions,a.config.features.spanSessions);assert.deepEqual(copy.config.features.rspanVlans,[90]);assert.match(cb.execute('show monitor session 5').join('\n'),/received/);
});

test('IPv6 guard constraints, DHCPv6 lifetimes and CEF algorithms round-trip their consumed fields',()=>{
  const {engine,device,cli}=lab();conf(cli,'ipv6 local pool DELEGATED 2001:db8:100::/48 64','ipv6 dhcp pool CLIENTS','address prefix 2001:db8:1::/64 lifetime 600 300','prefix-delegation pool DELEGATED lifetime 900 450','dns-server 2001:db8::53','exit','ipv6 nd raguard policy RA','device-role router','hop-limit minimum 32','hop-limit maximum 128','managed-config-flag on','other-config-flag off','router-preference maximum medium','match ra prefix-list ALLOWED','exit','ipv6 dhcp guard policy DHCP','device-role server','preference min 20','preference max 200','match reply prefix-list ALLOWED','match server access-list SERVERS','exit','ipv6 nd inspection policy ND','device-role host','validate source-mac','sec-level minimum 2','drop-unsecure','exit','ipv6 source-guard policy SOURCE','validate prefix','permit link-local','deny global-autoconf','exit','int g0/0','ipv6 dhcp server CLIENTS preference 80','ipv6 nd raguard attach-policy RA','ipv6 dhcp guard attach-policy DHCP','ipv6 nd inspection attach-policy ND','ipv6 verify source attach-policy SOURCE','exit','ip cef load-sharing algorithm include-ports source destination A5','ip pim spt-threshold infinity','end');const copy=engine.addDevice('router'),other=new IOSSession(engine,copy.id);copy.config.features.files={snapshot:renderConfig(device).join('\n')};ok(other,'enable','copy flash:snapshot running-config');for(const field of['ipv6Policies','ipv6LocalPools','cefHash','pim'])assert.deepEqual(copy.config.features[field],device.config.features[field],field);assert.deepEqual(copy.config.services.dhcpv6,device.config.services.dhcpv6);assert.equal(copy.config.interfaces['GigabitEthernet0/0'].features.dhcpv6Preference,80);assert.equal(copy.config.interfaces['GigabitEthernet0/0'].features.sourceGuardPolicy,'SOURCE');
});

test('software clock and simulated calendar advance independently and copy in both directions',()=>{
  const {engine,device,cli}=lab();ok(cli,'enable','clock set 12:00:00 16 October 2026','clock update-calendar');engine.advance(2000);assert.match(cli.execute('show calendar').join('\n'),/12:00:02(?:\.000)? UTC Fri Oct 16 2026/);ok(cli,'clock set 01:02:03 1 January 2027');assert.match(cli.execute('show calendar').join('\n'),/12:00:02(?:\.000)? UTC Fri Oct 16 2026/);ok(cli,'conf t','clock calendar-valid','end','clock read-calendar');assert.match(cli.execute('show clock detail').join('\n'),/Time source is hardware calendar/);assert.match(cli.execute('show clock').join('\n'),/12:00:02(?:\.000)? UTC Fri Oct 16 2026/);device.runtime.features.clockOffset=60000;ok(cli,'clock set 00:00:00 2 January 2027');assert.match(cli.execute('show clock').join('\n'),/00:00:00\.000 UTC Sat Jan 2 2027/);ok(cli,'calendar set 10:20:30 5 March 2028');assert.match(cli.execute('show calendar').join('\n'),/10:20:30 UTC Sun Mar 5 2028/);assert.match(cli.execute('show running-config').join('\n'),/clock calendar-valid/);
});

test('PBR default-next-hop lists validate atomically, render and expose actual match counters',()=>{
 const {device,cli}=lab();conf(cli,'route-map FALLBACK permit 10','set ip default next-hop 192.0.2.1 192.0.2.2');const row=device.config.features.routeMaps['FALLBACK permit 10'];assert.deepEqual(row.set,['ip default next-hop 192.0.2.1 192.0.2.2']);assert.match(cli.execute('set ip default next-hop 192.0.2.300').join('\n'),/Invalid IPv4/);assert.equal(row.set.length,1);ok(cli,'end');assert.match(renderConfig(device).join('\n'),/set ip default next-hop 192.0.2.1 192.0.2.2/);assert.match(cli.execute('show route-map FALLBACK').join('\n'),/matches: 0 packets/);device.runtime.features.pbrCounters={FALLBACK:{10:{matched:3,selected:2}}};assert.match(cli.execute('show route-map FALLBACK').join('\n'),/matches: 3 packets/);
});
