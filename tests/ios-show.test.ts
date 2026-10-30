import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { defaultInterface, type Device } from '../src/model.ts';
import { formatIOSShow, iosMac } from '../src/ios-show.ts';
import { resolveForwardingPaths } from '../src/route-resolver.ts';

const g='GigabitEthernet0/0';
function address(d:Device,name:string,ip:string,mask='255.255.255.0'){const p=d.config.interfaces[name]??=defaultInterface(name,false);Object.assign(p,{adminUp:true,switchport:false,ip,mask});return p;}
function pair(){const s=new Simulator(532),a=s.addDevice('router'),b=s.addDevice('router');address(a,g,'10.0.0.1');address(b,g,'10.0.0.2');const link=s.connect({deviceId:a.id,port:g},{deviceId:b.id,port:g});return{s,a,b,link};}
const show=(s:Simulator,d:Device,topic:string,...args:string[])=>formatIOSShow(s,d.id,topic,args)!.join('\n');

test('route presentation selects longest prefix and isolates VRFs, protocols and exact masks',()=>{
 const{s,a}=pair();a.config.staticRoutes.push({network:'10.20.0.0',prefix:16,nextHop:'10.0.0.2'},{network:'10.20.30.0',prefix:24,nextHop:'10.0.0.2'},{network:'0.0.0.0',prefix:0,nextHop:'10.0.0.2'},{network:'10.20.30.0',prefix:24,interface:'Null0',vrf:'RED'});s.changed();
 const detail=show(s,a,'ip route','10.20.30.9');assert.match(detail,/Routing entry for 10\.20\.30\.0\/24/);assert.doesNotMatch(detail,/10\.20\.0\.0\/16|0\.0\.0\.0\/0/);assert.match(detail,/Known via "static", distance 1/);
 assert.match(show(s,a,'ip route'),/S\*\s+0\.0\.0\.0\/0 \[1\/0\] via 10\.0\.0\.2/);
 assert.match(show(s,a,'ip route','10.20.0.0','255.255.0.0','longer-prefixes'),/10\.20\.30\.0\/24/);
 assert.doesNotMatch(show(s,a,'ip route','static'),/^C\s/m);assert.match(show(s,a,'ip route','vrf','RED'),/Null0/);assert.doesNotMatch(show(s,a,'ip route','vrf','RED'),/10\.0\.0\.2/);
 assert.match(show(s,a,'ip route','summary'),/Route Source\s+Networks\s+Paths/);assert.match(show(s,a,'ip route','vrf'),/Incomplete/);assert.match(show(s,a,'ip route','10.0.0.1','255.0.255.0'),/Invalid/);
 const cli=new IOSSession(s,a.id);assert.match(cli.execute('show ip route 10.20.30.9').join('\n'),/Routing entry for 10\.20\.30\.0\/24/);
});

test('IPv6 routes and interface state show real DAD state and operational connected routes',()=>{
 const{s,a}=pair();a.config.ipv6Routing=true;a.config.interfaces[g].ipv6=['2001:db8:1::1/64'];s.changed();
 assert.match(show(s,a,'ipv6 interface','brief'),/TENTATIVE/);assert.doesNotMatch(show(s,a,'ipv6 route'),/2001:DB8:1::\/64/);s.advance(1100);
 assert.match(show(s,a,'ipv6 route'),/C\s+2001:DB8:1::\/64 \[0\/0\]/);assert.doesNotMatch(show(s,a,'ipv6 interface','brief'),/TENTATIVE/);
 const cli=new IOSSession(s,a.id);assert.match(cli.execute('show ipv6 route connected').join('\n'),/2001:DB8:1::\/64/);
});

test('interface brief, status and counters use distinct IOS fields and actual packet counts',()=>{
 const{s,a}=pair();const brief=show(s,a,'ip interface','brief');assert.match(brief,/Interface\s+IP-Address\s+OK\?\s+Method\s+Status\s+Protocol/);assert.match(brief,/10\.0\.0\.1\s+YES\s+manual\s+up\s+up/);assert.match(brief,/unassigned\s+YES\s+unset\s+administratively down\s+down/);
 s.ping(a.id,'10.0.0.2',{count:1});s.advance(1500);assert.match(show(s,a,'interfaces','g0/0'),new RegExp(a.runtime.counters[g].tx+' packets output'));assert.match(show(s,a,'interfaces','GigabitEthernet','0/0'),/Internet address is 10\.0\.0\.1\/24/);
 const sw=s.addDevice('switch');assert.match(show(s,sw,'interfaces','status'),/Port\s+Name\s+Status\s+Vlan\s+Duplex\s+Speed\s+Type/);assert.doesNotMatch(show(s,sw,'interfaces','status'),/IP-Address/);assert.match(show(s,sw,'interfaces','status','wat'),/Invalid/);
});

test('ARP and MAC tables render actual learned addresses, VLANs and filters',()=>{
 const s=new Simulator(134),r=s.addDevice('router'),p=s.addDevice('pc'),sw=s.addDevice('switch');address(r,g,'192.0.2.1');address(p,'GigabitEthernet0','192.0.2.2');for(const [d,port,n]of [[r,g,1],[p,'GigabitEthernet0',2]]as const)s.connect({deviceId:d.id,port},{deviceId:sw.id,port:'GigabitEthernet0/'+n});s.advance(1001);s.ping(r.id,'192.0.2.2',{count:1});s.advance(1500);
 const arp=show(s,r,'ip arp');assert.match(arp,/Age \(min\)\s+Hardware Addr/);assert.match(arp,new RegExp(iosMac(s.macOf(p.id,'GigabitEthernet0')).replaceAll('.','\\.')));assert.match(arp,/Internet\s+192\.0\.2\.2\s+\d+\s+/);assert.match(arp,/Internet\s+192\.0\.2\.1\s+-\s+/);assert.doesNotMatch(show(s,r,'arp','198.51.100.1'),/192\.0\.2\.2/);
 const mac=show(s,sw,'mac address-table','dynamic','interface','g0/2');assert.match(mac,/DYNAMIC\s+Gi0\/2/);assert.doesNotMatch(mac,/DYNAMIC\s+Gi0\/1/);assert.match(show(s,sw,'mac address-table','count'),/Total Mac Addresses\s+: [1-9]/);
 sw.config.vlans[20]={id:20,name:'Users',active:true};sw.config.interfaces['GigabitEthernet0/3'].vlan=20;s.changed();assert.match(show(s,sw,'vlan','id','20'),/20\s+Users\s+active\s+Gi0\/3/);assert.match(show(s,sw,'mac address-table','vlan','4095'),/Invalid/);
});

test('STP display uses live root identity, roles and blocked edges',()=>{
 const s=new Simulator(77),a=s.addDevice('switch'),b=s.addDevice('switch'),c=s.addDevice('switch');a.config.features.stp={priority:0};b.config.features.stp={priority:4096};c.config.features.stp={priority:8192};for(const[x,xp,y,yp]of[[a,1,b,1],[b,2,c,1],[c,2,a,2]]as const)s.connect({deviceId:x.id,port:'GigabitEthernet0/'+xp},{deviceId:y.id,port:'GigabitEthernet0/'+yp});s.advance(1100);
 assert.match(show(s,a,'spanning-tree','vlan','1'),/This bridge is the root/);assert.match([a,b,c].map(d=>show(s,d,'spanning-tree')).join('\n'),/Altn\s+BLK/);assert.match(show(s,b,'spanning-tree','summary'),/Blocking\s+Listening\s+Learning\s+Forwarding/);assert.match(show(s,b,'spanning-tree','bridge'),/Bridge ID/);assert.doesNotMatch(show(s,b,'spanning-tree','bridge'),/Root ID/);
});

test('OSPF views use received router IDs, role states, dead deadlines and learned LSDB',()=>{
 const{s,a,b,link}=pair();for(const[d,id]of[[a,'1.1.1.1'],[b,'2.2.2.2']]as const){d.config.protocols.ospf={processId:7,routerId:id,networks:[{network:'0.0.0.0',prefix:0,area:0}]};d.config.interfaces[g].features.ospf={helloInterval:1,deadInterval:3};}address(b,'Loopback0','192.0.2.2','255.255.255.255');s.changed();s.advance(2500);
 assert.match(show(s,a,'ip ospf','neighbor'),/2\.2\.2\.2\s+1\s+FULL\/(DR|BDR)\s+00:00:0[1-3]\s+10\.0\.0\.2\s+GigabitEthernet0\/0/);assert.match(show(s,a,'ip ospf','interface','brief'),/Nbrs F\/C/);assert.match(show(s,a,'ip ospf','database'),/Router Link States \(Area 0\)/);assert.match(show(s,a,'ip ospf','database'),/2\.2\.2\.2/);
 link.loss=1;s.changed();s.advance(4000);assert.doesNotMatch(show(s,a,'ip ospf','neighbor'),/FULL/);assert.match(show(s,a,'ip ospf','interface','garbage'),/Invalid/);
});

test('EIGRP output distinguishes measured hold timers from untracked transport statistics',()=>{
 const{s,a,b}=pair();for(const d of[a,b])d.config.protocols.eigrp={asn:100,networks:[{network:'0.0.0.0',prefix:0}]};address(b,'Loopback0','192.0.2.2','255.255.255.255');s.changed();s.advance(200);
 assert.match(show(s,a,'ip eigrp','neighbors'),/10\.0\.0\.2\s+Gi0\/0\s+1[0-5]\s+\d\d:\d\d:\d\d\s+\d+\s+\d+\s+0\s+\d+/);assert.doesNotMatch(show(s,a,'ip eigrp','neighbors'),/\?/);assert.match(show(s,a,'ip eigrp','topology'),/P 192\.0\.2\.2\/32, 1 successors, FD is/);assert.doesNotMatch(show(s,a,'ip eigrp','topology','192.0.2.0','255.255.255.0'),/P 192/);const traffic=show(s,a,'ip eigrp','traffic'),stats=a.runtime.features.eigrpTraffic;assert.match(traffic,/EIGRP-IPv4 Traffic Statistics for AS\(100\)/);for(const[label,key]of[['Hellos','hello'],['Updates','update'],['Acks','ack']]){assert.ok(stats.sent[key]>0&&stats.received[key]>0);assert.ok(traffic.includes(`${label} sent/received: ${stats.sent[key]}/${stats.received[key]}`));}assert.doesNotMatch(traffic,/computed|normal UPDATE/);
});

test('BGP summary uses actual established prefix count and live session state',()=>{
 const{s,a,b,link}=pair();address(b,'Loopback0','192.0.2.2','255.255.255.255');a.config.protocols.bgp={asn:65001,routerId:'1.1.1.1',timers:{keepalive:1,hold:3},neighbors:[{address:'10.0.0.2',remoteAs:65002}]};b.config.protocols.bgp={asn:65002,routerId:'2.2.2.2',timers:{keepalive:1,hold:3},neighbors:[{address:'10.0.0.1',remoteAs:65001}],networks:[{network:'192.0.2.2',prefix:32}]};s.changed();s.advance(3500);
 const summary=show(s,a,'ip bgp','summary');assert.match(summary,/State\/PfxRcd/);const peer=summary.split('\n').find(line=>line.startsWith('10.0.0.2'))!;assert.match(peer,/\s1$/);assert.doesNotMatch(peer,/Established/);assert.match(show(s,a,'ip bgp'),/192\.0\.2\.2\/32.*65002/);assert.match(show(s,a,'ip bgp','neighbors','10.0.0.2'),/BGP state = Established/);
 link.loss=1;s.changed();s.advance(5000);assert.match(show(s,a,'ip bgp','summary'),/Idle|Connect|Active/);assert.match(show(s,a,'ip bgp','neighbors','10.0.0.99'),/No such neighbor/);
});

test('CDP and LLDP display received information without peeking at changed remote configuration',()=>{
 const{s,a,b,link}=pair();for(const d of[a,b]){d.config.features.lldp=true;d.config.features.discovery={cdp:{interval:5,holdtime:10},lldp:{interval:5,holdtime:10}};}b.config.hostname='Original';s.changed();s.advance(200);assert.match(show(s,a,'cdp neighbors'),/Original/);assert.match(show(s,a,'lldp neighbors','detail'),/System Name: Original/);
 b.config.hostname='Unadvertised';assert.doesNotMatch(show(s,a,'cdp neighbors'),/Unadvertised/);assert.match(show(s,a,'cdp neighbors','g0/0','detail'),/IP address: 10\.0\.0\.2/);link.loss=1;s.changed();s.advance(11000);assert.match(show(s,a,'lldp neighbors'),/Total entries displayed: 0/);
});

test('CEF shows all resolved next hops and does not confuse a covering prefix with its host route',()=>{
 const{s,a,b}=pair();address(a,'Loopback0','192.0.2.0');address(b,'Loopback0','198.51.100.2','255.255.255.255');a.config.staticRoutes.push({network:'172.16.0.0',prefix:16,nextHop:'198.51.100.2'},{network:'198.51.100.2',prefix:32,nextHop:'10.0.0.2'},{network:'203.0.113.0',prefix:24,interface:'Null0'});s.changed();
 assert.match(show(s,a,'ip cef','172.16.2.1'),/172\.16\.0\.0\/16\n  nexthop 10\.0\.0\.2 GigabitEthernet0\/0/);assert.match(show(s,a,'ip cef','203.0.113.1'),/203\.0\.113\.0\/24\n  attached to Null0/);assert.match(show(s,a,'ip cef','192.0.2.0/24'),/attached to Loopback0/);assert.match(show(s,a,'ip cef','192.0.2.0/32'),/receive for Loopback0/);assert.match(show(s,a,'ip cef exact-route','10.0.0.1','172.16.2.1'),/next hop 10\.0\.0\.2/);
 const covering=a.runtime.routes.filter(r=>r.network==='192.0.2.0'&&r.prefix===24);assert.equal(resolveForwardingPaths(a,'192.0.2.0',undefined,p=>s.interfaceUp(a.id,p),covering)[0].route.prefix,24);
});

test('formatters are read-only and invalid arguments never become silent table fallbacks',()=>{
 const{s,a}=pair();const before=structuredClone(s.lab),events=s.events.length,now=s.clock.now();const args=['static'];for(const topic of['ip route','ipv6 route','interfaces','ip interface','ipv6 interface','arp','mac address-table','vlan','spanning-tree','cdp neighbors','lldp neighbors','ip ospf','ip eigrp','ip bgp','ip cef'])formatIOSShow(s,a.id,topic);
 formatIOSShow(s,a.id,'ip route',args);assert.deepEqual(args,['static']);assert.deepEqual(s.lab,before);assert.equal(s.events.length,events);assert.equal(s.clock.now(),now);assert.equal(formatIOSShow(s,a.id,'unknown'),undefined);assert.match(show(s,a,'ip route','bogus'),/Invalid/);assert.match(show(s,a,'interfaces','GigabitEthernet99/9'),/Invalid/);
});

test('NAT output distinguishes basic address bindings from extended PAT tuples and actual timers',()=>{
 const s=new Simulator(202),r=s.addDevice('router'),pc=s.addDevice('pc'),server=s.addDevice('server');address(pc,'GigabitEthernet0','10.1.0.10');pc.config.defaultGateway='10.1.0.1';address(r,g,'10.1.0.1');address(r,'GigabitEthernet0/1','203.0.113.1');address(server,'GigabitEthernet0','203.0.113.2');s.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:r.id,port:g});s.connect({deviceId:r.id,port:'GigabitEthernet0/1'},{deviceId:server.id,port:'GigabitEthernet0'});r.config.interfaces[g].features.nat='inside';r.config.interfaces['GigabitEthernet0/1'].features.nat='outside';r.config.features.nat={rules:[{interface:'GigabitEthernet0/1',overload:true}]};s.changed();s.registerUDPService(9001,d=>d.id===server.id,()=>({ok:true}));const request=s.udpRequest(pc.id,'203.0.113.2',9001,{}, {sourcePort:44000});s.advance(500);assert.equal(request.status,'success');
 const text=show(s,r,'ip nat','translations','udp','verbose');assert.match(text,/udp\s+203\.0\.113\.1:20000\s+10\.1\.0\.10:44000\s+203\.0\.113\.2:9001\s+203\.0\.113\.2:9001/);assert.match(text,/extended, use_count/);assert.match(text,/left 00:04:/);assert.doesNotMatch(show(s,r,'ip nat','translations','tcp'),/203\.0\.113\.1:20000/);assert.match(show(s,r,'ip nat','statistics'),/1 dynamic; 1 extended/);
 r.config.features.nat.static=[{inside:'10.1.0.20',outside:'203.0.113.20'}];assert.match(show(s,r,'ip nat','translations'),/---\s+203\.0\.113\.20\s+10\.1\.0\.20\s+---\s+---/);r.runtime.features.natTranslations[0].overload=false;assert.match(show(s,r,'ip nat','translations'),/---\s+203\.0\.113\.1\s+10\.1\.0\.10\s+---\s+---/);
});

test('DHCP binding and pool output follow real allocation and release without fabricated client MAC',()=>{
 const s=new Simulator(203),r=s.addDevice('router'),pc=s.addDevice('pc');address(r,g,'10.0.0.1');s.connect({deviceId:r.id,port:g},{deviceId:pc.id,port:'GigabitEthernet0'});r.config.services.dhcp={enabled:true,excluded:[{start:'10.0.0.1',end:'10.0.0.10'},{start:'10.0.0.5',end:'10.0.0.12'}],pools:[{name:'LAN',network:'10.0.0.0',prefix:24,defaultRouter:'10.0.0.1',leaseSeconds:60}]};s.changed();const request=s.requestDHCP(pc.id);s.advance(1500);assert.equal(request.status,'success');const leases=show(s,r,'ip dhcp','binding');assert.match(leases,/10\.0\.0\.13/);assert.match(leases,new RegExp(('01'+s.macOf(pc.id,'GigabitEthernet0').replace(/[^0-9a-f]/gi,'').toLowerCase()).match(/.{1,4}/g)!.join('\\.')));assert.match(leases,/Automatic  Active/);assert.match(show(s,r,'ip dhcp','pool','LAN'),/Leased addresses\s+: 1/);assert.match(show(s,r,'ip dhcp','pool','LAN'),/Excluded addresses\s+: 12/);s.releaseDHCP(pc.id);s.advance(100);assert.doesNotMatch(show(s,r,'ip dhcp','binding'),/10\.0\.0\.13/);assert.match(show(s,r,'ip dhcp','binding','bad'),/Invalid/);
});

test('ACL display shows real matching counters, standard wildcards and IPv6 sequence syntax',()=>{
 const{s,a,b}=pair(),cli=new IOSSession(s,a.id);for(const line of['enable','conf t','ip access-list extended IN','10 deny icmp any any echo','20 permit ip any any','exit','ip access-list standard CLIENT','10 permit 10.0.0.0 0.0.0.255','exit','ipv6 access-list V6','10 permit ipv6 any any','exit','int g0/0','ip access-group IN in','end'])assert.ok(!cli.execute(line).some(x=>x.startsWith('%')),line);
 const ping=s.ping(b.id,'10.0.0.1',{count:1});s.advance(1500);assert.equal(ping.received,0);assert.match(show(s,a,'access-lists','IN'),/10 deny icmp any any echo \(1 match\)/);assert.match(show(s,a,'access-lists','CLIENT'),/10 permit 10\.0\.0\.0, wildcard bits 0\.0\.0\.255/);assert.match(show(s,a,'ipv6 access-list'),/permit ipv6 any any sequence 10/);assert.doesNotMatch(show(s,a,'ip access-lists'),/IPv6 access list/);
});

test('EtherChannel summary distinguishes logical channel state, bundled ports and failed members',()=>{
 const s=new Simulator(204),a=s.addDevice('switch'),b=s.addDevice('switch');for(const n of[1,2]){const name='GigabitEthernet0/'+n;a.config.interfaces[name].features={channelGroup:1,channelMode:'active'};b.config.interfaces[name].features={channelGroup:2,channelMode:'passive'};s.connect({deviceId:a.id,port:name},{deviceId:b.id,port:name});}s.advance(1100);assert.match(show(s,a,'etherchannel','summary'),/Po1\(SU\)\s+LACP\s+Gi0\/1\(P\)\s+Gi0\/2\(P\)/);a.config.interfaces['GigabitEthernet0/1'].adminUp=false;s.changed();assert.match(show(s,a,'etherchannel','1','summary'),/Gi0\/1\(D\)\s+Gi0\/2\(P\)/);assert.match(show(s,a,'etherchannel','detail'),/Number of ports = 1\b/);
});

test('HSRP, VRRP and GLBP views use received peer addresses and distinguish gateway and forwarder roles',()=>{
 for(const protocol of['hsrp','vrrp','glbp']as const){const{s,a,b,link}=pair();for(const[d,priority]of[[a,110],[b,100]]as const)d.config.features.fhrp=[{protocol,interface:g,group:1,virtualIp:'10.0.0.254',priority,preempt:true,helloTime:200,holdTime:700}];s.changed();s.advance(2000);const topic=protocol==='hsrp'?'standby':protocol;const active=show(s,a,topic,'brief'),backup=show(s,b,topic,'brief');assert.match(active,protocol==='vrrp'?/Master\s+10\.0\.0\.1\s/:/Active\s+(10\.0\.0\.254\s+)?local/);assert.match(backup,/10\.0\.0\.1/);if(protocol==='glbp'){assert.match(active,/0007\.b400\.010[12]/);assert.match(show(s,a,topic),/Forwarder 1/);}const expiry=b.runtime.features.fhrpPeers.find((p:any)=>p.deviceId===a.id)?.expires;assert.ok(Number.isFinite(expiry));link.lossAB=1;s.changed();s.advance(Math.max(0,expiry-s.clock.now()-1));if(protocol==='vrrp')assert.match(show(s,b,topic,'brief'),/Backup\s+10\.0\.0\.1/);s.advance(2);assert.match(show(s,b,topic,'brief'),protocol==='vrrp'?/Master\s+10\.0\.0\.2\s/:/Active\s+(10\.0\.0\.254\s+)?local/);assert.doesNotMatch(show(s,b,topic,'brief'),/10\.0\.0\.1/);}
});
