import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {defaultInterface,type Device} from '../src/model.ts';
import {formatIOSShow} from '../src/ios-show.ts';
const g=(n:number)=>'GigabitEthernet0/'+n;
function ip(d:Device,p:string,addr:string){Object.assign(d.config.interfaces[p]??=defaultInterface(p,false),{ip:addr,mask:'255.255.255.0',adminUp:true,switchport:false});}
function join(s:Simulator,a:Device,ap:string,b:Device,bp:string){return s.connect({deviceId:a.id,port:ap},{deviceId:b.id,port:bp});}
function show(s:Simulator,d:Device,topic:string,...args:string[]){const output=formatIOSShow(s,d.id,topic,args);assert.notEqual(output,undefined,topic);return output!.join('\n');}
function cmd(c:IOSSession,...commands:string[]){for(const x of commands){const out=c.execute(x);assert.ok(!out.some(y=>y.startsWith('%')),x+': '+out.join('\n'));}}
function pair(){const s=new Simulator(1710),a=s.addDevice('router'),b=s.addDevice('router');ip(a,g(0),'10.0.0.1');ip(b,g(0),'10.0.0.2');const link=join(s,a,g(0),b,g(0));return{s,a,b,link};}

test('BFD show follows delivered session state and deadline, without invented discriminators',()=>{
 const{s,a,b,link}=pair();for(const d of[a,b])d.config.interfaces[g(0)].features.bfd={minTx:100,minRx:100,multiplier:3};s.changed();s.advance(2500);let text=show(s,a,'bfd','neighbors','details');assert.match(text,/10\.0\.0\.2\s+\?\/\?\s+Up\s+UP/);assert.match(text,/Detection time: 300 ms/);assert.match(text,/MinTxInt: 100000 us/);const before=JSON.stringify(a.runtime);show(s,a,'bfd','summary');assert.equal(JSON.stringify(a.runtime),before);link.loss=1;s.advance(500);text=show(s,a,'bfd','neighbors');assert.match(text,/10\.0\.0\.2\s+\?\/\?\s+Down\s+DOWN/);assert.match(show(s,a,'bfd','neighbors','made-up'),/Invalid/);
});

test('SLA output reports real success, failure and configuration with track delayed state',()=>{
 const{s,a,link}=pair(),c=new IOSSession(s,a.id);cmd(c,'enable','conf t','ip sla 1','icmp-echo 10.0.0.2','frequency 1','timeout 100','exit','ip sla schedule 1 life forever start-time now','track 1 ip sla 1 reachability','delay down 1','end');s.advance(1100);let text=show(s,a,'ip sla','statistics','1');assert.match(text,/Latest operation return code: OK/);assert.match(text,/Number of successes: [1-9]/);assert.match(show(s,a,'track','1'),/State is Up/);link.loss=1;s.advance(3500);text=show(s,a,'ip sla','statistics','1');assert.match(text,/Number of failures: [1-9]/);assert.match(show(s,a,'track','1'),/State is Down/);assert.match(show(s,a,'ip sla','configuration','1'),/Operation frequency \(seconds\): 1/);assert.match(show(s,a,'ip sla','summary'),/icmp-echo/);assert.match(show(s,a,'ip sla','statistics','999'),/not found/);
});

test('NHRP shows actual registration and learned NBMA expiry, never an invented creation time',()=>{
 const{s,a,b}=pair();for(const[d,n]of[[a,1],[b,2]]as const){ip(d,'Tunnel0','192.0.2.'+n);d.config.interfaces.Tunnel0.features={tunnelSource:g(0),tunnelMode:'gre multipoint',tunnelKey:10,nhrp:{networkId:n,authentication:'lab',holdtime:3,nhs:n===2?[{address:'192.0.2.1',nbma:'10.0.0.1'}]:[]}};}s.changed();s.advance(500);assert.match(show(s,a,'ip nhrp'),/192\.0\.2\.2\/32[\s\S]*created \?[\s\S]*NBMA address: 10\.0\.0\.2/);assert.match(show(s,b,'ip nhrp','nhs'),/registration active/);assert.match(show(s,a,'dmvpn'),/10\.0\.0\.2\s+192\.0\.2\.2\s+UP\s+D/);b.config.interfaces.Tunnel0.features.nhrp.authentication='wrong';s.changed();s.advance(3500);assert.doesNotMatch(show(s,a,'ip nhrp'),/192\.0\.2\.2/);assert.match(show(s,a,'ip nhrp','traffic'),/not tracked/);
});

test('multicast output uses received IGMP memberships and computed PIM roles with explicit unknown timing',()=>{
 const{s,a,b}=pair();a.config.features.multicastRouting=true;a.config.interfaces[g(0)].features.pim='dense-mode';b.config.interfaces[g(0)].features.igmpGroups=['239.1.1.1'];s.changed();s.advance(500);assert.match(show(s,a,'ip igmp','groups'),/239\.1\.1\.1\s+GigabitEthernet0\/0\s+\?\s+00:0[12]:[0-9]+\s+10\.0\.0\.2/);assert.match(show(s,a,'ip pim','interface'),/10\.0\.0\.1/);assert.match(show(s,a,'ip pim','neighbor'),/Hello aging is not modeled/);assert.match(show(s,a,'ip igmp','groups','detail'),/membership received/);b.config.interfaces[g(0)].features.igmpGroups=[];s.changed();s.advance(126000);assert.doesNotMatch(show(s,a,'ip igmp','groups'),/239\.1\.1\.1/);
});

test('crypto show displays negotiated state and ESP counters while withholding secrets and fake crypto measurements',()=>{
 const{s,a,b}=pair();for(const[d,peer,local]of[[a,'10.0.0.2','10.0.0.1'],[b,'10.0.0.1','10.0.0.2']]as const){d.config.features.acls={VPN:{type:'extended',entries:[{sequence:10,action:'permit',protocol:'ip',source:local,destination:peer}]}};d.config.features.crypto={isakmpPolicies:[{priority:10,encryption:'aes',hash:'sha',group:14}],isakmpKeys:[{peer,key:'do-not-print'}],transformSets:{T:{encryption:'esp-aes',integrity:'esp-sha-hmac'}},maps:{M:[{sequence:10,peer,acl:'VPN',transformSets:['T'],lifetime:30}]}};d.config.interfaces[g(0)].features.cryptoMap='M';}s.changed();const p=s.ping(a.id,'10.0.0.2',{count:1});s.advance(1500);assert.equal(p.received,1);assert.match(show(s,a,'crypto','isakmp','sa'),/QM_IDLE/);const text=show(s,a,'crypto','ipsec','sa');assert.match(text,/#pkts encaps: 1, #pkts decaps: 1/);assert.match(text,/spi: 0x/);assert.doesNotMatch(text,/do-not-print|#pkts encrypt:/);assert.match(show(s,a,'crypto','isakmp','policy'),/priority 10/);assert.match(show(s,a,'crypto','ipsec','transform-set','T'),/esp-aes/);s.advance(30000);assert.match(show(s,a,'crypto','ipsec','sa'),/Status: EXPIRED/);
});

test('flow and policy views retain actual counters and unknown uncollected fields',()=>{
 const{s,a,b}=pair();a.config.features.flowRecords={SRC:{match:['ipv4 source address'],collect:['counter packets long']}};a.config.features.flowMonitors={M:{record:'SRC',cacheTimeout:1}};a.config.interfaces[g(0)].features.flowMonitorOut='M';s.changed();s.ping(a.id,'10.0.0.2',{count:2});s.advance(2500);const text=show(s,a,'flow','monitor','M','cache');assert.match(text,/Current entries: 1/);assert.match(text,/10\.0\.0\.1/);assert.doesNotMatch(text,/10\.0\.0\.2/,'Uncollected destination must remain unknown');assert.match(show(s,a,'flow','interface'),/output: M/);assert.match(show(s,a,'flow','monitor','missing'),/not found/);a.config.features.aaa={servers:{AUTH:{protocol:'radius',address:'10.0.0.2',key:'secret'}}};assert.doesNotMatch(show(s,a,'aaa','servers'),/secret/);assert.match(show(s,a,'aaa','servers'),/auth-port 1812/);
});

test('security and VRF views use dynamic bindings, secure MACs and actual configuration without mutation',()=>{
 const s=new Simulator(1711),sw=s.addDevice('switch'),a=s.addDevice('pc'),b=s.addDevice('pc');ip(a,'GigabitEthernet0','10.0.0.1');ip(b,'GigabitEthernet0','10.0.0.2');sw.config.interfaces[g(1)].features={portfast:true,portSecurity:{enabled:true,maximum:1,sticky:false}};sw.config.interfaces[g(2)].features.portfast=true;join(s,a,'GigabitEthernet0',sw,g(1));join(s,b,'GigabitEthernet0',sw,g(2));s.advance(1100);s.ping(a.id,'10.0.0.2',{count:1});s.advance(1100);assert.match(show(s,sw,'port-security','interface',g(1)),/Total MAC Addresses: 1/);assert.match(show(s,sw,'port-security','address'),/SecureDynamic/);sw.config.features.vrfs={BLUE:{rd:'65000:1',routeTargets:[{direction:'both',value:'65000:2'}]}};sw.config.interfaces[g(1)].vrf='BLUE';const before=JSON.stringify(sw);assert.match(show(s,sw,'vrf','detail','BLUE'),/Import route targets: 65000:2/);assert.match(show(s,sw,'ip source binding'),/MacAddress/);assert.equal(JSON.stringify(sw),before);assert.match(show(s,sw,'vrf','MISSING'),/does not exist/);
});

test('IPv6 neighbor show uses real NDP cache and unresolved state',()=>{
 const{s,a,b}=pair();a.config.ipv6Routing=true;b.config.ipv6Routing=true;a.config.interfaces[g(0)].ipv6=['2001:db8::1/64'];b.config.interfaces[g(0)].ipv6=['2001:db8::2/64'];s.changed();s.advance(1200);s.ping(a.id,'2001:db8::2',{count:1});s.advance(1000);const text=show(s,a,'ipv6 neighbors');assert.match(text,/2001:db8::2/);assert.doesNotMatch(text,/10\.0\.0\.2/);const before=JSON.stringify(a.runtime);show(s,a,'ipv6 neighbors','2001:db8::2',g(0));assert.equal(JSON.stringify(a.runtime),before);assert.match(show(s,a,'ipv6 neighbors','invalid'),/Invalid/);
});
