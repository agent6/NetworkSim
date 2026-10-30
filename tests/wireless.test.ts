import {hasIPv4LinkLocalAddress} from '../src/ipv4-link-local.ts';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';import {IOSSession} from '../src/cli.ts';import{wirelessConfig}from'../src/wireless-model.ts';import{wpa2PMK,sha1}from'../src/wireless-security.ts';import{parseDocument}from'../src/persistence.ts';
import {controllerFormDraft} from '../src/wireless-controller-form.ts';
export function wirelessLab(central=true,security:'open'|'wpa2-personal'|'wpa2-enterprise'='wpa2-personal'){
 const e=new Simulator(912),sw=e.addDevice('poeswitch',400,100),wlc=e.addDevice('wlc',400,0),ap=e.addDevice('ap',100,200),ap2=e.addDevice('ap',700,200),server=e.addDevice('server',450,0),c=e.addDevice('laptop',110,240),c2=e.addDevice('laptop',680,240);let port=1;for(const d of[wlc,ap,ap2,server]){const p=Object.keys(d.config.interfaces)[0];e.connect({deviceId:d.id,port:p},{deviceId:sw.id,port:'GigabitEthernet0/'+port++});}
 for(const[d,ip]of[[wlc,'10.10.0.2'],[ap,'10.10.0.11'],[ap2,'10.10.0.12'],[server,'10.10.0.100']]as const){const p=Object.values(d.config.interfaces)[0];Object.assign(p,{ip,mask:'255.255.255.0'});delete p.features.dhcp;}
 server.config.services.dhcp={enabled:true,pools:[{name:'CLIENTS',network:'10.10.0.0',prefix:24,defaultRouter:'10.10.0.1',dnsServers:['10.10.0.100'],leaseSeconds:3600}],excluded:[{start:'10.10.0.1',end:'10.10.0.110'}]};server.config.services.dns={enabled:true,records:{'intranet.lab':'10.10.0.100'}};server.config.services.http={enabled:true,content:'<h1>Wireless works</h1>'};server.config.services.radius={enabled:true,secret:'radius-secret',users:{student:{password:'correct-password',privilege:1}}};
 const w=wirelessConfig(wlc)!;w.wlans.LAB={name:'LAB',id:1,ssid:'Campus',enabled:true,security,psk:'correct-password',broadcast:true,authenticationList:'DOT1X'};w.policies.LAB={name:'LAB',enabled:true,vlan:1,centralSwitching:central,sessionTimeout:1800};w.policyTags['default-policy-tag']={LAB:'LAB'};w.siteTags['default-site-tag'].localSite=central;w.dot1xLists.DOT1X='AUTH';wlc.config.features.aaa={servers:{RAD:{name:'RAD',protocol:'radius',address:'10.10.0.100',port:1812,key:'radius-secret'}},groups:{AUTH:{protocol:'radius',servers:['RAD']}}};new IOSSession(e,wlc.id);
 for(const a of[ap,ap2])wirelessConfig(a)!.controller='10.10.0.2';for(const d of[c,c2])Object.assign(wirelessConfig(d)!.adapter,{ssid:'Campus',security,passphrase:'correct-password',username:'student',password:'correct-password'});e.changed();return{e,sw,wlc,ap,ap2,server,c,c2,w};
}
function advance(e:Simulator,ms=10000){let left=ms;while(left>0){const step=Math.min(left,1000);e.advance(step,100000);left-=step;}}
test('WPA2 key derivation matches the published IEEE/password PMK vector and SHA-1',()=>{assert.equal(Buffer.from(sha1(new TextEncoder().encode('abc'))).toString('hex'),'a9993e364706816aba3e25717850c26c9cd0d89d');assert.equal(Buffer.from(wpa2PMK('password','IEEE')).toString('hex'),'f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e');});
test('WL-15/16/27 CAPWAP requires delivered packets, IP addressing, and operational switching',()=>{const{e,wlc,ap,sw}=wirelessLab();sw.powered=false;e.changed();advance(e);assert.notEqual(ap.runtime.features.wireless.state,'RUN');sw.powered=true;e.changed();advance(e,10000);assert.equal(ap.runtime.features.wireless.state,'RUN',JSON.stringify(ap.runtime.features.wireless));assert.ok(Object.values<any>(wlc.runtime.features.wirelessAPs).some(r=>r.id===ap.id));assert.ok(e.events.some(x=>x.packet?.destinationPort===5246));});
test('WL-03/11/12/13/26 centralized WPA2 authorizes only after four-way handshake and transports DHCP, DNS, HTTP, ICMP',()=>{const{e,c,ap,server}=wirelessLab();advance(e);assert.equal(ap.runtime.features.wireless.state,'RUN');assert.equal(c.runtime.features.wireless.state,'CONNECTED',JSON.stringify(c.runtime.features.wireless));assert.ok(c.config.interfaces.Wireless0.ip);const p=e.ping(c.id,'10.10.0.100',{count:2});advance(e,2000);assert.equal(p.received,2);const dns=e.resolveDNS(c.id,'intranet.lab');advance(e,1000);assert.equal(dns.address,'10.10.0.100');const http=e.fetchHTTP(c.id,'10.10.0.100');advance(e,2000);assert.equal(http.content,server.config.services.http.content);assert.ok(e.events.some(x=>x.label==='EAPOL-Key 4/4'));assert.ok(e.events.some(x=>x.packet?.destinationPort===5247));});
test('WL-12 locally switched client traffic traverses the AP uplink without a CAPWAP data tunnel',()=>{const{e,c}=wirelessLab(false);advance(e);assert.equal(c.runtime.features.wireless.state,'CONNECTED');e.events=[];const p=e.ping(c.id,'10.10.0.100',{count:1});advance(e,500);assert.equal(p.received,1);assert.ok(e.events.some(x=>x.label==='Frame sent'&&x.port==='GigabitEthernet0'));assert.ok(!e.events.some(x=>x.packet?.destinationPort===5247));});
test('WL-01/02 configured SSID is not association; unavailable network uses bounded retry',()=>{const e=new Simulator(7),c=e.addDevice('laptop');advance(e,1000);assert.equal(c.runtime.features.wireless.state,'IDLE');wirelessConfig(c)!.adapter.ssid='Missing';e.changed();advance(e,30000);assert.equal(e.wireless.association(c.id),undefined);assert.equal(c.runtime.features.wireless.state,'RETRY_WAIT');assert.ok(e.events.filter(x=>x.label==='Probe Request').length<=5);assert.ok(e.clock.pending()<10);});
test('WL-04/30 incorrect WPA2 MIC fails then corrected credentials reconnect',()=>{const{e,c}=wirelessLab();wirelessConfig(c)!.adapter.passphrase='wrong-password';advance(e);assert.equal(e.wireless.association(c.id),undefined);assert.equal(c.runtime.features.wireless.state,'AUTH_FAILED');assert.match(c.runtime.features.wireless.reason,/MIC/);wirelessConfig(c)!.adapter.passphrase='correct-password';e.changed();advance(e,6000);assert.equal(c.runtime.features.wireless.state,'CONNECTED');});
test('WL-05/06/07/24 disabled radios and deleted APs remove derived associations; moving back retries',()=>{const{e,c,ap,ap2}=wirelessLab();advance(e);wirelessConfig(ap2)!.radios.forEach(r=>r.enabled=false);ap.x=100000;e.changed();advance(e,1500);assert.equal(e.wireless.association(c.id),undefined);ap.x=100;e.changed();advance(e,35000);assert.equal(e.wireless.association(c.id)?.apId,ap.id);wirelessConfig(ap)!.radios.forEach(r=>r.enabled=false);wirelessConfig(ap2)!.radios.forEach(r=>r.enabled=false);e.changed();advance(e,1500);assert.equal(e.wireless.association(c.id),undefined);wirelessConfig(ap)!.radios[0].enabled=true;c.x=100000;e.changed();advance(e,5000);assert.equal(e.wireless.association(c.id),undefined);c.x=120;e.changed();advance(e,35000);assert.equal(e.wireless.association(c.id)?.apId,ap.id);e.removeDevice(ap.id);advance(e,1500);assert.equal(e.wireless.association(c.id),undefined);});
test('WL-08/09/10 roaming selects the stronger AP, preserves central VLAN IP, and uses residence/hysteresis',()=>{const{e,c,ap,ap2}=wirelessLab();advance(e);assert.equal(e.wireless.association(c.id)?.apId,ap.id);const ip=c.config.interfaces.Wireless0.ip;c.x=690;e.changed();advance(e,6000);assert.equal(e.wireless.association(c.id)?.apId,ap2.id);assert.equal(c.config.interfaces.Wireless0.ip,ip);c.x=400;e.changed();advance(e,20000);assert.ok(c.runtime.features.wireless.history.filter((x:any)=>x.state==='ROAMING').length<=2);});
test('WL-17 central clients disconnect after controller echo failure; FlexConnect keeps an established local session',()=>{for(const central of[true,false]){const{e,c,wlc}=wirelessLab(central);advance(e);e.power(wlc.id,false);advance(e,100000);assert.equal(!!e.wireless.association(c.id),!central);if(!central){const p=e.ping(c.id,'10.10.0.100',{count:1});advance(e,500);assert.equal(p.received,1);}}});
test('WL-18/19 Enterprise authentication uses the existing RADIUS server and denies Access-Reject',()=>{for(const correct of[true,false]){const{e,c,server}=wirelessLab(true,'wpa2-enterprise');if(!correct)wirelessConfig(c)!.adapter.password='wrong';advance(e,12000);assert.equal(!!e.wireless.association(c.id),correct,JSON.stringify(c.runtime.features.wireless));assert.ok(server.runtime.features.aaaRequests?.some((r:any)=>r.username==='student'&&r.accepted===correct));assert.ok(e.events.some(x=>x.packet?.destinationPort===1812));}});
test('WL-22/23 saved topologies exclude associations and wireless time advances only with the simulation clock',()=>{const{e,c}=wirelessLab();assert.equal(e.clock.now(),0);assert.equal(c.runtime.features.wireless.state,'IDLE');advance(e);const document=e.serialize(),copy=parseDocument(JSON.stringify(document));assert.equal(copy.lab.links.length,4);assert.equal(copy.lab.devices.find(d=>d.id===c.id)!.runtime.features.wireless,undefined);const fresh=new Simulator();fresh.load(copy);advance(fresh);assert.equal(fresh.getDevice(c.id)!.runtime.features.wireless.state,'CONNECTED');});
test('WL-25 DHCP failure preserves association and exposes the failed address acquisition separately',()=>{const{e,c,server}=wirelessLab();server.config.services.dhcp.enabled=false;advance(e,12000);assert.ok(e.wireless.association(c.id));assert.equal(c.runtime.features.wireless.state,'OBTAINING_IP');assert.equal(c.config.interfaces.Wireless0.ip,undefined);assert.match(c.runtime.features.wireless.reason,/DHCP/);});
test('WL-20/29 Catalyst WLAN/policy/tag CLI changes shared state, rejects invalid syntax, and produces operational show output',()=>{const e=new Simulator(),d=e.addDevice('wlc'),cli=new IOSSession(e,d.id);const ok=(...lines:string[])=>{for(const line of lines){const out=cli.execute(line).join('\n');assert.ok(!out.includes('%'),line+': '+out);}};ok('enable','conf t','wlan LAB 1 Campus');assert.equal(cli.prompt,'WLC1(config-wlan)#');assert.match(cli.execute('security wpa psk set-key ascii 0 short').join('\n'),/8–63/);ok('security wpa wpa2','security wpa akm psk','security wpa psk set-key ascii 0 correct-password','no shutdown','exit','wireless profile policy CLIENTS','vlan 20','no shutdown','exit','wireless tag policy CAMPUS','wlan LAB policy CLIENTS','end');assert.equal(wirelessConfig(d)!.wlans.LAB.psk,'correct-password');assert.equal(wirelessConfig(d)!.policyTags.CAMPUS.LAB,'CLIENTS');assert.match(cli.execute('show wlan summary').join('\n'),/Campus\s+UP/);assert.match(cli.execute('show running-config').join('\n'),/wireless profile policy CLIENTS/);assert.match(cli.execute('config wlan add').join('\n'),/Invalid/);});
test('wireless clients on one AP or separate APs exchange real Ethernet/IP frames in central and local mode',()=>{for(const central of[true,false])for(const sameAP of[true,false]){const{e,c,c2}=wirelessLab(central);if(sameAP){c2.x=c.x+5;c2.y=c.y+5;}advance(e);assert.ok(c2.config.interfaces.Wireless0.ip);const p=e.ping(c.id,c2.config.interfaces.Wireless0.ip!,{count:1});advance(e,1500);assert.equal(p.received,1,`${central?'central':'local'} ${sameAP?'same':'different'} AP`);}});
test('WL-14/28 VLAN policy maps to real tags, isolation and routed return paths in the example',async()=>{const{wirelessLabFixture}=await import('./fixtures/wireless-lab.ts'),e=new Simulator();e.load(wirelessLabFixture());advance(e,25000);const c=e.lab.devices.find(d=>d.kind==='laptop')!,wlc=e.lab.devices.find(d=>d.kind==='wlc')!;assert.equal(c.config.interfaces.Wireless0.ip,'192.168.20.21');assert.deepEqual(c.config.dnsServers,['10.10.0.100']);const dns=e.resolveDNS(c.id,'intranet.campus.lab');advance(e,1000);assert.equal(dns.address,'10.10.0.100');const http=e.httpRequest(c.id,'http://intranet.campus.lab');advance(e,2000);assert.equal(http.statusCode,200);const p=e.ping(c.id,'10.10.0.100',{count:1});advance(e,1500);assert.equal(p.received,1);assert.ok(e.events.some(x=>x.packet?.vlan===20));wirelessConfig(wlc)!.policies['CAMPUS-POLICY'].vlan=30;e.changed();advance(e,35000);assert.ok(e.wireless.association(c.id));assert.equal(hasIPv4LinkLocalAddress(c,'Wireless0'),true);assert.equal(c.runtime.features.dhcpClientLeases?.Wireless0,undefined);assert.equal(c.runtime.features.wireless.state,'CONNECTED');assert.match(c.runtime.features.wireless.reason,/self-assigned.*DHCP/);const blocked=e.ping(c.id,'10.10.0.100',{count:1});advance(e,5000);assert.equal(blocked.received,0);});
test('wireless uplink controller ACL failure prevents joins without bypassing the wired network',()=>{const{e,wlc,ap}=wirelessLab(),cli=new IOSSession(e,wlc.id);for(const line of['enable','conf t','ip access-list extended CAPWAP','deny udp any any eq 5246','permit ip any any','exit','interface GigabitEthernet1','ip access-group CAPWAP in','end'])cli.execute(line);advance(e);assert.notEqual(ap.runtime.features.wireless.state,'RUN');assert.ok(Object.values<number>(wlc.runtime.features.aclHits??{}).some(n=>n>0));});
test('open WLAN has authentication and association frames but no EAPOL key exchange',()=>{const{e,c}=wirelessLab(true,'open');advance(e);assert.ok(e.wireless.association(c.id));assert.ok(e.events.some(x=>x.nodeId===c.id&&x.label==='Association Response'));assert.ok(!e.events.some(x=>x.nodeId===c.id&&x.protocol==='EAPOL'));});
test('SSID changes disconnect stale sessions and AP admission limits reject surplus clients',()=>{const{e,c,c2,ap,ap2,w}=wirelessLab();c2.x=c.x;c2.y=c.y;wirelessConfig(ap)!.radios.forEach(r=>r.maxClients=1);wirelessConfig(ap2)!.radios.forEach(r=>r.enabled=false);advance(e);assert.equal(e.lab.devices.filter(d=>d.kind==='laptop'&&e.wireless.association(d.id)).length,1);w.wlans.LAB.ssid='Changed';e.changed();advance(e,35000);assert.equal(e.wireless.association(c.id),undefined);assert.equal(e.wireless.association(c2.id),undefined);});
test('WL-27 controller joins and client packets traverse two physical switches',()=>{const{e,ap,sw,c}=wirelessLab(),extra=e.addDevice('poeswitch');e.disconnect(e.lab.links.find(l=>l.a.deviceId===ap.id||l.b.deviceId===ap.id)!.id);e.connect({deviceId:ap.id,port:'GigabitEthernet0'},{deviceId:extra.id,port:'GigabitEthernet0/1'});e.connect({deviceId:extra.id,port:'GigabitEthernet0/2'},{deviceId:sw.id,port:'GigabitEthernet0/5'});advance(e,15000);assert.equal(ap.runtime.features.wireless.state,'RUN');const ping=e.ping(c.id,'10.10.0.100',{count:1});advance(e,1000);assert.equal(ping.received,1);assert.ok(e.events.some(x=>x.nodeId===extra.id&&x.label==='Frame sent'));});
test('duplicate wireless MAC addresses are rejected rather than sharing one session',()=>{const{e,c,c2}=wirelessLab();c2.config.interfaces.Wireless0.features.macAddress=e.macOf(c.id,'Wireless0');e.changed();advance(e);assert.equal([c,c2].filter(d=>e.wireless.association(d.id)).length,1);assert.ok([c,c2].some(d=>d.runtime.features.wireless.reason.includes('Duplicate')));});
test('WLC power cycle loads startup configuration; AP and client restart rejoin and reset transient sessions',()=>{const{e,c,ap,wlc,w,sw}=wirelessLab(),cli=new IOSSession(e,wlc.id);cli.execute('enable');cli.execute('write memory');advance(e);w.wlans.LAB.ssid='Unsaved';e.power(wlc.id,false);e.power(wlc.id,true);assert.equal(wirelessConfig(wlc)!.wlans.LAB.ssid,'Campus');sw.config.interfaces['GigabitEthernet0/2'].features.powerInline={mode:'never',max:30000};e.changed();e.power(c.id,false);advance(e,1000);assert.equal(e.wireless.association(c.id),undefined);delete sw.config.interfaces['GigabitEthernet0/2'].features.powerInline;e.changed();e.power(c.id,true);advance(e,15000);assert.equal(e.wireless.association(c.id)?.apId,ap.id);const blank=e.addDevice('wlc');wirelessConfig(blank)!.wlans.X={name:'X',id:1,ssid:'Unsaved',security:'open',enabled:true,broadcast:true};e.power(blank.id,false);e.power(blank.id,true);assert.equal(Object.keys(wirelessConfig(blank)!.wlans).length,0);});
test('AP policy tag changes trigger rejoin and apply a second WLAN without a global SSID shortcut',()=>{const{e,c,w,ap}=wirelessLab();advance(e);w.wlans.GUEST={name:'GUEST',id:2,ssid:'Guest',security:'open',enabled:true,broadcast:true};w.policyTags.GUEST={GUEST:'LAB'};w.assignments[e.macOf(ap.id,'GigabitEthernet0').replaceAll(':','')]={policyTag:'GUEST',siteTag:'default-site-tag',rfTag:'default-rf-tag'};e.changed();advance(e,600);assert.equal(ap.runtime.features.wireless.state,'REJOIN');advance(e,6000);assert.equal(ap.runtime.features.wireless.state,'RUN');assert.ok(e.wireless.scan(c.id).some(r=>r.apId===ap.id&&r.ssid==='Guest'));assert.ok(!e.wireless.scan(c.id).some(r=>r.apId===ap.id&&r.ssid==='Campus'));});
test('wireless data reuses IPv6 neighbor discovery and ICMPv6 in central and local mode',()=>{for(const central of[true,false]){const{e,c,server}=wirelessLab(central);c.config.interfaces.Wireless0.ipv6=['2001:db8:1::10/64'];server.config.interfaces.GigabitEthernet0.ipv6=['2001:db8:1::100/64'];e.changed();advance(e);const ping=e.ping(c.id,'2001:db8:1::100',{count:1});advance(e,2000);assert.equal(ping.received,1);assert.ok(e.events.some(x=>x.protocol==='ICMPV6'));}});
test('decapsulated wireless client traffic still obeys routed interface ACLs',async()=>{const{wirelessLabFixture}=await import('./fixtures/wireless-lab.ts'),e=new Simulator();e.load(wirelessLabFixture());const c=e.lab.devices.find(d=>d.kind==='laptop')!,router=e.lab.devices.find(d=>d.kind==='router')!,cli=new IOSSession(e,router.id);for(const line of['enable','conf t','ip access-list extended WIRELESS-DENY','deny icmp any any','permit ip any any','exit','interface GigabitEthernet0/0.20','ip access-group WIRELESS-DENY in','end'])assert.ok(!cli.execute(line).join('\n').includes('%'),line);advance(e,25000);const ping=e.ping(c.id,'10.10.0.100',{count:1,timeout:500});advance(e,1000);assert.equal(ping.received,0);assert.ok(Object.values<number>(router.runtime.features.aclHits??{}).some(n=>n>0));});
test('wireless CLI help/completion and disabled security settings survive running-config export',()=>{const e=new Simulator(),wlc=e.addDevice('wlc'),cli=new IOSSession(e,wlc.id);cli.execute('enable');cli.execute('conf t');cli.execute('wlan LAB 1 Campus');assert.match(cli.help('security wpa ').join('\n'),/akm/);assert.equal(cli.complete('security dot1x auth'),'security dot1x authentication-list ');for(const line of['security wpa akm psk','no security wpa akm psk','no security wpa wpa2','end'])cli.execute(line);const text=cli.execute('show running-config').join('\n');assert.match(text,/no security wpa akm psk/);assert.match(text,/no security wpa wpa2/);const ap=e.addDevice('ap'),pse=e.addDevice('poeswitch');e.connect({deviceId:ap.id,port:'GigabitEthernet0'},{deviceId:pse.id,port:'GigabitEthernet0/1'});const apCLI=new IOSSession(e,ap.id);apCLI.execute('enable');assert.match(apCLI.execute('show capwap client rcb').join('\n'),/OperationState/);assert.match(apCLI.execute('show capwap client configuration').join('\n'),/Invalid/);});
test('rapid position changes create no per-pixel timers or stale associations; saved wireless cables are rejected',()=>{const{e,c}=wirelessLab();advance(e);const pending=e.clock.pending();for(let i=0;i<500;i++){c.x=i%2?100000:110;e.changed();}assert.ok(e.clock.pending()<=pending+2);c.x=100000;advance(e,2000);assert.equal(e.wireless.association(c.id),undefined);const doc=e.serialize();doc.lab.links[0].a={deviceId:c.id,port:'Wireless0'};assert.throws(()=>parseDocument(JSON.stringify(doc)),/physical cables/);});

test('WF-01 FlexConnect standalone disassociates central WLANs and preserves working local clients',()=>{
 const {e,c,c2,w,wlc}=wirelessLab(false);
 w.wlans.CENTRAL={...w.wlans.LAB,name:'CENTRAL',id:2,ssid:'Central'};
 w.policies.CENTRAL={...w.policies.LAB,name:'CENTRAL',centralSwitching:true};
 w.policyTags['default-policy-tag'].CENTRAL='CENTRAL';wirelessConfig(c2)!.adapter.ssid='Central';
 wlc.startupConfig=structuredClone(wlc.config);e.changed();advance(e);
 assert.ok(e.wireless.association(c.id));assert.ok(e.wireless.association(c2.id)?.central);
 const address=c.config.interfaces.Wireless0.ip;e.power(wlc.id,false);advance(e,100000);
 assert.ok(e.wireless.association(c.id));assert.equal(e.wireless.association(c2.id),undefined);
 assert.ok(e.wireless.scan(c.id).some(a=>a.ssid==='Campus'));assert.ok(!e.wireless.scan(c2.id).some(a=>a.ssid==='Central'));
 const ping=e.ping(c.id,'10.10.0.100',{count:1});advance(e,1000);assert.equal(ping.received,1);
 e.power(wlc.id,true);advance(e,15000);assert.ok(e.wireless.association(c2.id));assert.equal(c.config.interfaces.Wireless0.ip,address);
});

test('WF-02 missing tag and profile dependencies deactivate WLANs rather than falling back to valid-looking defaults',()=>{
 for(const missing of ['site','join','flex','rf-tag','rf-profile'] as const){
  const {e,c,w,ap2}=wirelessLab(false);wirelessConfig(ap2)!.radios.forEach(r=>r.enabled=false);advance(e);assert.ok(e.wireless.association(c.id));
  if(missing==='site')delete w.siteTags['default-site-tag'];
  if(missing==='join')delete w.apProfiles['default-ap-profile'];
  if(missing==='flex')delete w.flexProfiles['default-flex-profile'];
  if(missing==='rf-tag')delete w.rfTags['default-rf-tag'];
  if(missing==='rf-profile'){w.rfTags['default-rf-tag']={band24:'MISSING',band5:'MISSING'};}
  e.changed();advance(e,3000);assert.equal(e.wireless.association(c.id),undefined,missing);assert.ok(!e.wireless.scan(c.id).some(a=>a.ssid==='Campus'),missing);
 }
});

test('WF-03 RF tag assignment validates the radio band transactionally through CLI and saved labs',()=>{
 const e=new Simulator(),wlc=e.addDevice('wlc'),cli=new IOSSession(e,wlc.id);
 for(const line of ['enable','conf t','ap dot11 5ghz rf-profile FIVE','no shutdown','exit','wireless tag rf BRANCH'])assert.ok(!cli.execute(line).join('\n').includes('%'),line);
 assert.equal(cli.prompt,'WLC1(config-wireless-rf-tag)#');const before=JSON.stringify(wlc.config);
 assert.match(cli.execute('24ghz-rf-policy FIVE').join('\n'),/wrong radio band/);assert.equal(JSON.stringify(wlc.config),before);
 assert.ok(!cli.execute('5ghz-rf-policy FIVE').join('\n').includes('%'));
 const doc=e.serialize();wirelessConfig(doc.lab.devices[0])!.rfTags.BRANCH.band24='FIVE';assert.throws(()=>parseDocument(JSON.stringify(doc)),/wireless/);
});

test('WF-04 site profile reference changes restart CAPWAP join before restoring client service',()=>{
 const {e,c,ap,w}=wirelessLab(false);advance(e);w.apProfiles.BRANCH={echoInterval:10,deadInterval:30};w.siteTags['default-site-tag'].apProfile='BRANCH';e.changed();advance(e,600);
 assert.equal(ap.runtime.features.wireless.state,'REJOIN');assert.equal(e.wireless.association(c.id),undefined);advance(e,8000);assert.equal(ap.runtime.features.wireless.state,'RUN');assert.ok(e.wireless.association(c.id));
});

test('WF-05 powered AP CLI reload preserves electrical supply but clears sessions and rejoins using saved configuration',()=>{
 const {e,c,ap,sw}=wirelessLab();const cli=new IOSSession(e,ap.id);cli.execute('enable');cli.execute('write memory');advance(e);assert.ok(e.wireless.association(c.id));
 const supply=structuredClone(ap.runtime.features.poePower),used=sw.runtime.features.poe.used;wirelessConfig(ap)!.controller='10.10.0.99';
 cli.execute('reload');assert.match(cli.prompt,/Save\?/i);cli.execute('no');assert.match(cli.prompt,/confirm|Proceed/i);cli.execute('');
 assert.equal(e.devicePowered(ap.id),true);assert.deepEqual(ap.runtime.features.poePower,supply);assert.equal(sw.runtime.features.poe.used,used);assert.equal(e.wireless.association(c.id),undefined);assert.equal(wirelessConfig(ap)!.controller,'10.10.0.2');assert.notEqual(ap.runtime.features.wireless?.state,'RUN');
 advance(e,15000);assert.equal(ap.runtime.features.wireless.state,'RUN');assert.equal(e.wireless.association(c.id)?.apId,ap.id);
});

test('WF-06 invalid saved wireless security flags, duplicate WLAN IDs and malformed primary addresses reject before load',()=>{
 const {e,wlc}=wirelessLab();
 for(const mutate of [(w:any)=>w.wlans.LAB.akmEnabled='no',(w:any)=>w.wlans.OTHER={...w.wlans.LAB,name:'OTHER'},(w:any)=>w.controller={address:'10.1.1.1'}]){
  const doc=e.serialize(),w=wirelessConfig(doc.lab.devices.find(d=>d.id===wlc.id)!)!;mutate(w);assert.throws(()=>parseDocument(JSON.stringify(doc)),/wireless/);
 }
});

test('WF-07 Enterprise RADIUS retransmits then fails over through delivered UDP requests without an early client deadline',()=>{
 const {e,c,c2,wlc,server}=wirelessLab(true,'wpa2-enterprise');
 const aaa=wlc.config.features.aaa;aaa.servers.DEAD={protocol:'radius',address:'10.10.0.200',port:1812,key:'radius-secret',timeout:7,retransmit:1};aaa.groups.AUTH.servers=['DEAD','RAD'];e.changed();advance(e,18000);
 assert.ok(e.wireless.association(c.id));assert.ok(e.wireless.association(c2.id));assert.ok(server.runtime.features.aaaRequests.some((r:any)=>r.accepted));
 assert.equal(e.events.filter(x=>x.nodeId===wlc.id&&x.label==='Access-Request'&&x.packet?.radiusServer==='10.10.0.200').length,4);
 assert.ok(e.events.some(x=>x.packet?.destinationPort===1812&&x.packet?.destination==='10.10.0.100'));
 const ping=e.ping(c.id,'10.10.0.100',{count:1});advance(e,1000);assert.equal(ping.received,1);
});

test('WF-08 a delivered RADIUS reject stops the server group rather than trying a permissive fallback',()=>{
 const {e,c,c2,wlc,server,sw}=wirelessLab(true,'wpa2-enterprise'),fallback=e.addDevice('server');
 e.connect({deviceId:fallback.id,port:'GigabitEthernet0'},{deviceId:sw.id,port:'GigabitEthernet0/5'});Object.assign(fallback.config.interfaces.GigabitEthernet0,{ip:'10.10.0.101',mask:'255.255.255.0'});fallback.config.services.radius=structuredClone(server.config.services.radius);
 const aaa=wlc.config.features.aaa;aaa.servers.RAD.key='wrong-key';aaa.servers.FALLBACK={protocol:'radius',address:'10.10.0.101',port:1812,key:'radius-secret',timeout:1};aaa.groups.AUTH.servers=['RAD','FALLBACK'];e.changed();advance(e,5000);
 assert.equal(e.wireless.association(c.id),undefined);assert.equal(e.wireless.association(c2.id),undefined);assert.ok(server.runtime.features.aaaRequests.some((r:any)=>!r.accepted));assert.equal(fallback.runtime.features.aaaRequests,undefined);assert.ok(!e.events.some(x=>x.label==='Access-Request'&&x.packet?.radiusServer==='10.10.0.101'));
});

test('WF-09 RADIUS group timeouts are bounded and a controller reset invalidates the old authentication attempt',()=>{
 const {e,c,wlc}=wirelessLab(true,'wpa2-enterprise');const aaa=wlc.config.features.aaa;aaa.servers.RAD.address='10.10.0.200';aaa.servers.RAD.timeout=1;aaa.servers.RAD.retransmit=1;e.changed();advance(e,9500);
 assert.equal(e.wireless.association(c.id),undefined);assert.ok(c.runtime.features.wireless.history.some((h:any)=>/timed out/.test(h.reason)));assert.ok(e.clock.pending()<50);
 advance(e,2500);e.power(wlc.id,false);advance(e,1000);assert.equal(e.wireless.association(c.id),undefined);assert.ok(!e.events.some(x=>x.label==='Access-Accept'));assert.ok(e.clock.pending()<50);
});

function controllerForm(d:ReturnType<Simulator['addDevice']>):FormData{
 const f=new FormData(),w=wirelessConfig(d)!;const add=(record:Record<string,unknown>)=>Object.entries(record).forEach(([k,v])=>f.append(k,String(v??'')));
 const p=d.config.interfaces[w.managementInterface??'GigabitEthernet1'];add({hostname:d.config.hostname,'management-interface':w.managementInterface??'GigabitEthernet1','management-ip':p.ip,'management-mask':p.mask??'255.255.255.0','management-gateway':d.config.defaultGateway,'management-dns':d.config.dnsServers.join(', ')});
 for(const p of Object.values(w.wlans))add({'wlan-name':p.name,'wlan-id':p.id,'wlan-ssid':p.ssid,'wlan-security':p.security,'wlan-psk':p.psk,'wlan-auth':p.authenticationList??'default','wlan-enabled':p.enabled?'on':'off','wlan-broadcast':p.broadcast?'on':'off'});
 for(const [name,p] of Object.entries(w.policies))add({'policy-name':name,'policy-vlan':p.vlan,'policy-switch':p.centralSwitching?'central':'local','policy-enabled':p.enabled?'on':'off','policy-timeout':p.sessionTimeout});
 for(const [name,p] of Object.entries(w.apProfiles))add({'join-name':name,'join-echo':p.echoInterval});
 for(const [name,p] of Object.entries(w.flexProfiles))add({'flex-name':name,'flex-native':p.nativeVlan});
 for(const [name,p] of Object.entries(w.siteTags))add({'site-name':name,'site-local':p.localSite?'local':'flex','site-join':p.apProfile,'site-flex':p.flexProfile});
 for(const [name,p] of Object.entries(w.rfProfiles))add({'rf-name':name,'rf-band':p.band,'rf-power':p.power,'rf-width':p.width,'rf-enabled':p.enabled?'on':'off'});
 for(const [name,p] of Object.entries(w.rfTags))add({'rftag-name':name,'rftag-24':p.band24,'rftag-5':p.band5});
 for(const [name,mapping] of Object.entries(w.policyTags))for(const [wlan,policy] of Object.entries(mapping))add({'tag-name':name,'tag-wlan':wlan,'tag-policy':policy});
 return f;
}

test('WF-10 WLC form Apply preserves disabled CLI security and unrepresented profile settings',()=>{
 const {e,wlc,w}=wirelessLab();w.wlans.LAB.akmEnabled=false;w.wlans.LAB.wpa2Enabled=false;w.apProfiles['default-ap-profile'].description='Branch AP heartbeat';w.flexProfiles['default-flex-profile'].vlans={VOICE:20};w.policyTags.EMPTY={};w.assignments['001122334455']={policyTag:'EMPTY',siteTag:'default-site-tag',rfTag:'default-rf-tag'};
 w.rfProfiles.FIVE={band:'5',enabled:true,power:20,width:40,channel:36};
 const before=JSON.stringify(wlc.config),config=controllerFormDraft(e.seed,wlc,controllerForm(wlc)),next=config.features.wireless;
 assert.equal(next.wlans.LAB.akmEnabled,false);assert.equal(next.wlans.LAB.wpa2Enabled,false);assert.equal(next.apProfiles['default-ap-profile'].description,'Branch AP heartbeat');assert.deepEqual(next.flexProfiles['default-flex-profile'].vlans,{VOICE:20});assert.equal(next.rfProfiles.FIVE.channel,36);assert.deepEqual(next.policyTags.EMPTY,{});assert.deepEqual(next.assignments['001122334455'],w.assignments['001122334455']);assert.equal(JSON.stringify(wlc.config),before);
});

test('WF-11 WLC form rejects duplicate profiles and invalid select values without mutating the running configuration',()=>{
 const {e,wlc}=wirelessLab(),before=JSON.stringify(wlc.config);
 for(const mutate of [(f:FormData)=>f.append('policy-name','LAB'),(f:FormData)=>f.set('wlan-security','wpa3'),(f:FormData)=>f.set('policy-switch','imaginary'),(f:FormData)=>f.set('site-local','autonomous')]){
  const form=controllerForm(wlc);mutate(form);assert.throws(()=>controllerFormDraft(e.seed,wlc,form));assert.equal(JSON.stringify(wlc.config),before);
 }
});

test('WF-12 WLC form edits drive CAPWAP and real client state, and clearing RF mappings restores global radio settings',()=>{
 const {e,wlc,w,c}=wirelessLab();w.rfProfiles.OFF24={band:'2.4',enabled:false,power:20,width:20,channel:0};w.rfProfiles.OFF5={band:'5',enabled:false,power:20,width:20,channel:0};w.rfTags['default-rf-tag']={band24:'OFF24',band5:'OFF5'};e.changed();advance(e);assert.equal(e.wireless.association(c.id),undefined);
 const form=controllerForm(wlc);form.set('rftag-24','');form.set('rftag-5','');wlc.config=controllerFormDraft(e.seed,wlc,form);e.changed();advance(e,8000);assert.ok(e.wireless.association(c.id));
 const edit=controllerForm(wlc);edit.set('wlan-ssid','Changed');wlc.config=controllerFormDraft(e.seed,wlc,edit);e.changed();advance(e,2000);assert.equal(e.wireless.association(c.id),undefined);const cli=new IOSSession(e,wlc.id);assert.match(cli.execute('show wlan summary').join('\n'),/Changed/);
});

test('WF-13 WLC learns an unannounced AP power failure through its CAPWAP timer rather than global topology knowledge',()=>{
 const {e,c,ap,wlc,w,sw}=wirelessLab();w.apProfiles['default-ap-profile']={echoInterval:1,deadInterval:3};e.changed();advance(e);const mac=e.macOf(ap.id,'GigabitEthernet0').replaceAll(':','');assert.ok(wlc.runtime.features.wirelessAPs[mac]);
 sw.config.interfaces['GigabitEthernet0/2'].features.powerInline={mode:'never',max:30000};e.changed();assert.equal(e.wireless.association(c.id),undefined);advance(e,500);assert.ok(wlc.runtime.features.wirelessAPs[mac]);advance(e,3500);assert.equal(wlc.runtime.features.wirelessAPs[mac],undefined);assert.ok(e.events.some(x=>x.nodeId===wlc.id&&x.label==='AP loss'&&x.packet?.apEthernetMac===mac));assert.ok(wlc.runtime.logs.some(x=>x.includes('AP1 heartbeat timed out')));
 delete sw.config.interfaces['GigabitEthernet0/2'].features.powerInline;e.changed();advance(e,10000);assert.equal(ap.runtime.features.wireless.state,'RUN');assert.ok(wlc.runtime.features.wirelessAPs[mac]);
});

test('WF-14 removing a visible AP assignment resets that AP while retaining assignments outside the diagram',()=>{
 const {e,wlc,w,ap}=wirelessLab(),mac=e.macOf(ap.id,'GigabitEthernet0').replaceAll(':','');
 w.assignments[mac]={policyTag:'default-policy-tag',siteTag:'default-site-tag',rfTag:'default-rf-tag'};w.assignments['001122334455']={...w.assignments[mac]};
 const config=controllerFormDraft(e.seed,wlc,controllerForm(wlc),[mac]);assert.equal(config.features.wireless.assignments[mac],undefined);assert.deepEqual(config.features.wireless.assignments['001122334455'],w.assignments['001122334455']);
 delete w.wlans.LAB.psk;assert.doesNotThrow(()=>controllerFormDraft(e.seed,wlc,controllerForm(wlc)));
});

test('WF-15 wireless traffic updates the shared adapter packet and byte counters in both switching modes',()=>{
 for(const central of [true,false]){
  const {e,c}=wirelessLab(central);advance(e);const before=structuredClone(c.runtime.counters.Wireless0);assert.ok(before.tx>0);assert.ok(before.rx>0);
  const ping=e.ping(c.id,'10.10.0.100',{count:2});advance(e,1500);assert.equal(ping.received,2);const after=c.runtime.counters.Wireless0;assert.ok(after.tx>=before.tx+2);assert.ok(after.rx>=before.rx+2);assert.ok(after.txBytes>before.txBytes);assert.ok(after.rxBytes>before.rxBytes);
  const statistics=new IOSSession(e,c.id).execute('netstat -e').join('\n');assert.match(statistics,/Bytes\s+\d+\s+\d+/);assert.ok(statistics.includes(String(after.rxBytes)));assert.ok(statistics.includes(String(after.txBytes)));
  assert.ok(e.events.some(x=>x.nodeId===c.id&&x.port==='Wireless0'&&x.label==='Frame received'));
 }
});

test('WF-16 changing an existing WLAN ID rejects atomically rather than accepting an ignored parameter',()=>{
 const {e,wlc,w}=wirelessLab(),cli=new IOSSession(e,wlc.id);cli.execute('enable');cli.execute('conf t');const before=JSON.stringify(wlc.config);
 assert.match(cli.execute('wlan LAB 2 Campus').join('\n'),/ID cannot be changed/);assert.equal(JSON.stringify(wlc.config),before);
 const form=controllerForm(wlc);form.set('wlan-id','2');assert.throws(()=>controllerFormDraft(e.seed,wlc,form),/ID cannot be changed/);assert.equal(w.wlans.LAB.id,1);
});

test('WF-17 hidden WLANs accept a directed preferred SSID and a real session timer forces a fresh handshake',()=>{
 const {e,w,c,c2}=wirelessLab();w.wlans.LAB.broadcast=false;w.policies.LAB.sessionTimeout=3;wirelessConfig(c2)!.adapter.ssid='';e.changed();advance(e);
 assert.ok(!e.wireless.scan(c2.id).some(a=>a.ssid==='Campus'));assert.ok(e.wireless.scan(c.id).some(a=>a.ssid==='Campus'));assert.ok(c.runtime.features.wireless.history.some((h:any)=>h.reason.includes('session timeout')));const first=e.events.filter(x=>x.nodeId===c.id&&x.label==='EAPOL-Key 4/4').length;advance(e,8000);assert.ok(e.events.filter(x=>x.nodeId===c.id&&x.label==='EAPOL-Key 4/4').length>first);assert.ok(e.clock.pending()<100);
});

test('WF-18 WLC form replaces DNS server selection and preserves SSID bytes including spaces',()=>{
 const {e,wlc}=wirelessLab();wlc.config.dnsServers=['10.10.0.99'];const form=controllerForm(wlc);form.set('management-dns','10.10.0.100');form.set('wlan-ssid',' Campus ');const config=controllerFormDraft(e.seed,wlc,form);
 assert.deepEqual(config.dnsServers,['10.10.0.100']);assert.equal(config.features.wireless.wlans.LAB.ssid,' Campus ');form.set('management-dns','');assert.deepEqual(controllerFormDraft(e.seed,wlc,form).dnsServers,[]);
});

test('WF-19 legal profile names that match JS inherited members remain independent own configuration entries',()=>{
 const inherited=Object.getOwnPropertyDescriptors(Object.prototype);
 for(const name of ['constructor','__proto__','toString','hasOwnProperty']){
  const e=new Simulator(),wlc=e.addDevice('wlc'),cli=new IOSSession(e,wlc.id);
  for(const line of ['enable','conf t',`wlan ${name} 1 ReservedSSID`,'no security wpa','no shutdown','exit',`wireless profile policy ${name}`,'vlan 1','no shutdown','exit',`ap profile ${name}`,'description Safe profile','exit',`wireless profile flex ${name}`,'native-vlan-id 1','exit',`wireless tag site ${name}`,`ap-profile ${name}`,`flex-profile ${name}`,'no local-site','exit',`ap dot11 5ghz rf-profile ${name}`,'no shutdown','exit',`wireless tag rf ${name}`,`5ghz-rf-policy ${name}`,'exit',`wireless tag policy ${name}`,`wlan ${name} policy ${name}`,'exit',`aaa authentication dot1x ${name} group radius`,'end'])assert.ok(!cli.execute(line).join('\n').includes('%'),name+': '+line);
  const w=wirelessConfig(wlc)!;
  for(const field of ['wlans','policies','apProfiles','flexProfiles','siteTags','rfProfiles','rfTags','policyTags','dot1xLists'] as const){assert.ok(Object.hasOwn(w[field],name),field+': '+name);assert.equal(Object.getPrototypeOf(w[field]),Object.prototype);}
  assert.equal(w.wlans[name].name,name);assert.equal(w.policies[name].name,name);assert.equal(w.siteTags[name].apProfile,name);assert.equal(w.policyTags[name][name],name);
  const draft=controllerFormDraft(e.seed,wlc,controllerForm(wlc));assert.equal(draft.features.wireless.wlans[name].ssid,'ReservedSSID');assert.equal(draft.features.wireless.policyTags[name][name],name);
  const copy=parseDocument(JSON.stringify(e.serialize())),saved=wirelessConfig(copy.lab.devices[0])!;assert.equal(saved.rfTags[name].band5,name);assert.ok(Object.hasOwn(saved.policyTags[name],name));
 }
 assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype),inherited);
});

test('WF-20 reserved profile names traverse CAPWAP, advertise, authenticate and forward after save/load',()=>{
 for(const name of ['constructor','__proto__']){
  const {e,wlc,w,ap,ap2,c,c2}=wirelessLab(true,'open'),cli=new IOSSession(e,wlc.id);
  for(const line of ['enable','conf t',`wlan ${name} 2 ReservedSSID`,'no security wpa','no shutdown','exit',`wireless profile policy ${name}`,'vlan 1','no shutdown','exit',`wireless tag policy ${name}`,`wlan ${name} policy ${name}`,'exit',`ap ${e.macOf(ap.id,'GigabitEthernet0')}`,`policy-tag ${name}`,'end'])assert.ok(!cli.execute(line).join('\n').includes('%'),line);
  delete w.wlans.LAB;wirelessConfig(ap2)!.radios.forEach(r=>r.enabled=false);wirelessConfig(c)!.adapter.ssid='ReservedSSID';wirelessConfig(c2)!.adapter.enabled=false;e.changed();advance(e,15000);
  assert.equal(e.wireless.association(c.id)?.wlan,name);assert.equal(e.wireless.apConfiguration(ap.id)?.wlans[0].name,name);const ping=e.ping(c.id,'10.10.0.100',{count:1});advance(e,1500);assert.equal(ping.received,1);
  const restored=new Simulator();restored.load(parseDocument(JSON.stringify(e.serialize())));advance(restored,15000);assert.equal(restored.wireless.association(c.id)?.wlan,name);const next=restored.ping(c.id,'10.10.0.100',{count:1});advance(restored,1500);assert.equal(next.received,1);
 }
});

test('WF-21 missing inherited-member references reject and never become usable wireless profile fallbacks',()=>{
 const {e,wlc,w,c}=wirelessLab(),cli=new IOSSession(e,wlc.id);cli.execute('enable');cli.execute('conf t');cli.execute('wireless tag site EMPTY');
 for(const name of ['constructor','__proto__','toString']){assert.match(cli.execute('ap-profile '+name).join('\n'),/does not exist/);assert.match(cli.execute('flex-profile '+name).join('\n'),/does not exist/);}
 cli.execute('exit');cli.execute('wireless tag rf EMPTY');for(const name of ['constructor','__proto__'])assert.match(cli.execute('5ghz-rf-policy '+name).join('\n'),/does not exist/);cli.execute('end');
 w.siteTags['default-site-tag'].apProfile='constructor';e.changed();assert.doesNotThrow(()=>advance(e));assert.equal(e.wireless.association(c.id),undefined);
});

test('WF-22 an unrelated WLC Apply preserves implicit Enterprise defaults and an established client session',()=>{
 const {e,wlc,w,c,server}=wirelessLab(true,'wpa2-enterprise');delete w.wlans.LAB.authenticationList;w.dot1xLists.default='AUTH';e.changed();advance(e);const since=e.wireless.association(c.id)?.since;assert.ok(since!==undefined);const requests=server.runtime.features.aaaRequests.length;
 const form=controllerForm(wlc);form.set('hostname','BranchWLC');const config=controllerFormDraft(e.seed,wlc,form);assert.deepEqual(config.features.wireless.wlans.LAB,w.wlans.LAB);wlc.config=config;e.changed();advance(e,3500);
 assert.equal(e.wireless.association(c.id)?.since,since);assert.equal(server.runtime.features.aaaRequests.length,requests);const ping=e.ping(c.id,'10.10.0.100',{count:1});advance(e,1000);assert.equal(ping.received,1);
});
