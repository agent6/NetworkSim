import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {formatIOSShow} from '../src/ios-show.ts';
import {defaultInterface,type Device} from '../src/model.ts';
const g='GigabitEthernet0/0';
const host='GigabitEthernet0';
function pair(){const e=new Simulator(1720),a=e.addDevice('router'),b=e.addDevice('router');for(const[d,n]of[[a,1],[b,2]]as const)Object.assign(d.config.interfaces[g],{ip:'10.0.0.'+n,mask:'255.255.255.0',adminUp:true});const link=e.connect({deviceId:a.id,port:g},{deviceId:b.id,port:g});return{e,a,b,link};}
function show(e:Simulator,d:Device,t:string,...a:string[]){const result=formatIOSShow(e,d.id,t,a);assert.notEqual(result,undefined,t);return result!.join('\n');}
function cli(e:Simulator,d:Device,...lines:string[]){const c=new IOSSession(e,d.id);for(const s of ['enable',...lines]){const out=c.execute(s);assert.ok(!out.some(v=>/^% (Invalid|Incomplete|Ambiguous)/.test(v)),s+' '+out.join('\n'));}return c;}

test('operational static/RPF/CEF displays follow usable recursive forwarding and interface status',()=>{
 const{e,a,b,link}=pair();a.config.staticRoutes.push({network:'192.0.2.0',prefix:24,nextHop:'10.0.0.2'},{network:'198.51.100.0',prefix:24,nextHop:'10.9.9.9'});a.config.interfaces[g].features.urpf={mode:'rx'};e.changed();
 assert.match(show(e,a,'ip static route'),/192\.0\.2\.0\/24 \[1\/0\] \[A\]/);assert.match(show(e,a,'ip static route'),/198\.51\.100\.0\/24 \[1\/0\] \[N\]/);
 assert.match(show(e,a,'ip rpf','192.0.2.9'),/RPF interface: GigabitEthernet0\/0[\s\S]*RPF neighbor: \? \(10\.0\.0\.2\)/);assert.match(show(e,a,'cef interface',g),/RPF check is strict/);assert.match(show(e,a,'protocols',g),/Internet address is 10\.0\.0\.1\/24/);
 link.enabled=false;e.changed();assert.match(show(e,a,'ip rpf','192.0.2.9'),/Not found/);assert.match(show(e,a,'ip static route'),/192\.0\.2\.0\/24 \[1\/0\] \[N\]/);assert.match(show(e,a,'protocols',g),/is down, line protocol is down/);
 const before=JSON.stringify(a);show(e,a,'controllers');show(e,a,'ip rpf','203.0.113.2');assert.equal(JSON.stringify(a),before);assert.match(show(e,a,'ip rpf'),/Incomplete/);assert.match(show(e,a,'cef interface','missing'),/Invalid/);
});

test('CDP and LLDP base/interface/entry aliases expose actual advertisement cache and configured directions',()=>{
 const{e,a,b}=pair();a.config.features.lldp=true;b.config.features.lldp=true;a.config.features.discovery={cdp:{interval:2,holdtime:7}};a.config.interfaces[g].features.lldpTransmit=false;e.changed();e.advance(100);
 assert.match(show(e,a,'cdp'),/every 2 seconds/);assert.match(show(e,a,'lldp','interface',g),/Tx: disabled[\s\S]*Rx: enabled/);assert.match(show(e,a,'cdp','entry',b.config.hostname),/10\.0\.0\.2/);assert.match(show(e,a,'lldp','entry',b.config.hostname),/10\.0\.0\.2/);assert.match(show(e,a,'cdp','traffic'),/CDP counters :[\s\S]*Total packets output: [1-9]\d*, Input: [1-9]\d*/);
 const c=cli(e,a);assert.match(c.execute('show cdp').join('\n'),/Global CDP/);assert.match(c.execute('show lldp interface gi0\/0').join('\n'),/Tx: disabled/);
});

test('DHCP lease view distinguishes client committed lease from server bindings and expiry',()=>{
 const{e,a,b,link}=pair();b.config.services.dhcp={enabled:true,pools:[{name:'LAN',network:'10.0.0.0',prefix:24,defaultRouter:'10.0.0.2',leaseSeconds:6}],excluded:[{start:'10.0.0.1',end:'10.0.0.9'}]};delete a.config.interfaces[g].ip;e.changed();const request=e.requestDHCP(a.id,g);e.advance(1300);assert.equal(request.status,'success');assert.match(show(e,a,'dhcp lease'),/Temp IP addr: 10\.0\.0\.10[\s\S]*state: BOUND[\s\S]*Lease: 6 secs/);assert.equal(show(e,b,'dhcp lease'),'');link.loss=1;e.advance(6000);assert.match(show(e,a,'dhcp lease'),/state: EXPIRED/);
});

test('IPv6 router and DHCPv6 views use received RA fields and received lease lifetimes',()=>{
 const{e,a,b,link}=pair();a.config.interfaces[g].ipv6=['2001:db8:1::1/64'];a.config.ipv6Routing=true;a.config.interfaces[g].features.ipv6Nd={raLifetime:5,hopLimit:77,intervalMs:30000};a.config.interfaces[g].features.ndReachableTime=7000;b.config.interfaces[g].features.ipv6Autoconfig=true;b.config.interfaces[g].features.ipv6Enabled=true;e.changed();e.advance(2500);
 const routers=show(e,b,'ipv6 routers');assert.match(routers,/Hops 77, Lifetime 5 sec/);assert.match(routers,/Reachable time 7000/);assert.match(routers,/Prefix 2001:db8:1::\/64/);a.config.services.dhcpv6={enabled:true,pools:[{name:'V6',prefix:'2001:db8:1::/64',leaseSeconds:60,dnsServers:['2001:db8::53']}]};a.config.interfaces[g].features.dhcpv6Server='V6';e.changed();const req=e.requestDHCPv6(b.id,g);e.advance(2000);assert.equal(req.status,'success');assert.match(show(e,b,'ipv6 dhcp','interface',g),/State is BOUND[\s\S]*2001:db8:1::10/);assert.match(show(e,a,'ipv6 dhcp','pool','V6'),/Active clients: 1/);assert.match(show(e,b,'ipv6 dhcp'),new RegExp(b.id));link.loss=1;e.advance(6000);assert.equal(show(e,b,'ipv6 routers'),'');
});

test('prefix-list family filters, class maps and IPv6 protocol summaries stay separate and read-only',()=>{
 const{e,a}=pair();a.config.features.prefixLists={V4:[{sequence:5,action:'permit',network:'10.0.0.0',prefix:8}],V6:[{sequence:10,action:'permit',network:'2001:db8::',prefix:32,le:64}]};a.config.features.classMaps={WEB:{match:'all',acl:'HTTP',dscp:[46]}};a.config.protocols.eigrp6={asn:10,routerId:'1.1.1.1'};const before=JSON.stringify(a);assert.match(show(e,a,'ipv6 prefix-list','V6','detail'),/seq 10 permit 2001:db8::\/32 le 64/);assert.doesNotMatch(show(e,a,'ipv6 prefix-list'),/V4/);assert.match(show(e,a,'ipv6 protocols'),/eigrp 10/);assert.match(show(e,a,'class-map','WEB'),/Match access-group name HTTP/);assert.equal(JSON.stringify(a),before);assert.match(show(e,a,'class-map','missing'),/not found/);
});

test('line and SSH views use live actual remote sessions without extending idle timeout',()=>{
 const{e,a,b}=pair();b.config.features.ssh={keys:true};b.config.features.lines={'vty 0':{transport:'ssh',execTimeout:3,privilege:1}};e.changed();const client=cli(e,a);cli(e,b);assert.match(show(e,b,'ssh'),/No SSHv2/);client.execute('ssh 10.0.0.2');assert.match(show(e,b,'ssh'),/^2          2\.0     IN   aes256-ctr  hmac-sha2-256 Session started/m);const vty=show(e,b,'line','vty','0');assert.match(vty,/^\*     2 VTY\s+-\s+-\s+-\s+-\s+-\s+1\s+0\s+0\/0\s+-$/m);assert.match(vty,/Status: Ready, Active, No Exit Banner/);assert.match(vty,/Allowed input transports are ssh\./);const before=JSON.stringify(b.runtime);show(e,b,'line');show(e,b,'ssh');assert.equal(JSON.stringify(b.runtime),before);e.advance(4000);assert.match(show(e,b,'ssh'),/No SSHv2/);
});

test('SNMP configuration views disclose logical security and never leak user authentication keys',()=>{
 const{e,a}=pair();const c=cli(e,a,'conf t','snmp-server group OPS v3 priv read READ','snmp-server user admin OPS v3 auth sha private-auth-key priv aes 128 private-encryption-key','snmp-server engineid local 0123456789','snmp-server location Classroom','end');assert.match(c.execute('show snmp group').join('\n'),/groupname: OPS\s+security model:v3 priv/);const user=show(e,a,'snmp','user');assert.match(user,/Authentication Protocol: SHA\nPrivacy Protocol: AES128\nGroup-name: OPS/);assert.doesNotMatch(user,/private-auth-key|private-encryption-key/);assert.match(show(e,a,'snmp','engineid'),/0123456789/);assert.match(show(e,a,'snmp'),/^Chassis: \w+\nLocation: Classroom\n/);assert.match(show(e,a,'snmp'),/0 SNMP packets input/);assert.match(show(e,a,'radius','statistics'),/counters are not retained/);
});

test('BGP all, EIGRP address-family and OSPFv3 base aliases reach real existing formatters',()=>{
 const{e,a,b}=pair();for(const[d,n]of[[a,1],[b,2]]as const){d.config.protocols.eigrp={asn:10,networks:[{network:'10.0.0.0',prefix:24}]};d.config.interfaces[g].ipv6=['2001:db8::'+n+'/64'];d.config.ipv6Routing=true;d.config.protocols.ospfv3={processId:1,routerId:n+'.'+n+'.'+n+'.'+n};d.config.interfaces[g].features.ospfv3={processId:1,area:'0'};d.config.protocols.bgp={asn:65000+n,neighbors:[{address:'10.0.0.'+(3-n),remoteAs:65000+3-n}]};}e.changed();e.advance(3500);const c=cli(e,a);assert.match(c.execute('show bgp all summary').join('\n'),/10\.0\.0\.2/);assert.match(c.execute('show eigrp address-family ipv4 neighbors').join('\n'),/10\.0\.0\.2/);assert.match(c.execute('show ospfv3 neighbor').join('\n'),/FULL/);assert.match(show(e,a,'ospfv3'),/ospfv3 1/);assert.match(show(e,a,'eigrp','protocols'),/AS\(10\)/);assert.doesNotMatch(show(e,a,'eigrp','plugins'),/23\.00\.00/);
});

test('OSPF border-router view derives ABR identity and cost from received LSAs',()=>{
 const{e,a,b}=pair();b.config.interfaces.Loopback1=defaultInterface('Loopback1');Object.assign(b.config.interfaces.Loopback1,{ip:'192.0.2.1',mask:'255.255.255.0'});for(const[d,id]of[[a,'1.1.1.1'],[b,'2.2.2.2']]as const){d.config.protocols.ospf={processId:1,routerId:id,networks:[{network:'10.0.0.0',prefix:24,area:'0'},...(d===b?[{network:'192.0.2.0',prefix:24,area:'1'}]:[])]};}e.changed();assert.doesNotMatch(show(e,a,'ip ospf','border-routers'),/2\.2\.2\.2/);e.advance(2000);assert.match(show(e,a,'ip ospf','border-routers'),/Internal Router Routing Table\nCodes: i - Intra-area route, I - Inter-area route\n\ni 2\.2\.2\.2 \[1\] via 10\.0\.0\.2, GigabitEthernet0\/0, ABR, Area 0, SPF \d+/);assert.match(show(e,a,'ip ospf','rib'),/192\.0\.2\.0\/24/);const before=JSON.stringify(a);show(e,a,'ip ospf','statistics');show(e,a,'ip ospf','border-routers');assert.equal(JSON.stringify(a),before);
});
