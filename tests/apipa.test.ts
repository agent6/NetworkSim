import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {WindowsSession} from '../src/windows-cli.ts';
import {UnixSession} from '../src/unix-cli.ts';
import {hasIPv4LinkLocalAddress,isIPv4LinkLocal,supportsIPv4LinkLocal} from '../src/ipv4-link-local.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {wirelessLabFixture} from './fixtures/wireless-lab.ts';
import type {Device,DeviceKind} from '../src/model.ts';
const port='GigabitEthernet0';
function pair(kind:DeviceKind='pc',os='windows'){
 const e=new Simulator(3927),host=e.addDevice(kind),peer=e.addDevice('server');host.config.features.hostOS=os;const name=Object.keys(host.config.interfaces).find(p=>!/^Vlan|Wireless/.test(p))!;Object.assign(host.config.interfaces[name],{adminUp:true});delete host.config.interfaces[name].ip;delete host.config.interfaces[name].mask;host.config.interfaces[name].features.dhcp=true;Object.assign(peer.config.interfaces[port],{ip:'192.0.2.1',mask:'255.255.255.0'});e.connect({deviceId:host.id,port:name},{deviceId:peer.id,port});e.requestDHCP(host.id,name);return{e,host,peer,name};
}
function service(peer:Device,leaseSeconds=300){peer.config.services.dhcp={enabled:true,pools:[{name:'LAN',network:'192.0.2.0',prefix:24,defaultRouter:'192.0.2.1',dnsServers:['192.0.2.1'],leaseSeconds}],excluded:[{start:'192.0.2.1',end:'192.0.2.9'}]};}
function assigned(host:Device,name=port){const p=host.config.interfaces[name];assert.ok(hasIPv4LinkLocalAddress(host,name));assert.ok(isIPv4LinkLocal(p.ip!));const bytes=p.ip!.split('.').map(Number);assert.ok(bytes[2]>=1&&bytes[2]<=254);assert.equal(p.mask,'255.255.0.0');assert.equal(p.features.dhcp,true);return p.ip!;}

test('APIPA waits for DHCP failure and real three-probe ARP claiming; it is not a DHCP lease',()=>{
 const{e,host,name}=pair();e.advance(3999);assert.equal(host.config.interfaces[name].ip,undefined);e.advance(2);assert.equal(host.runtime.features.ipv4LinkLocal[name].phase,'probing');assert.equal(host.config.interfaces[name].ip,undefined);e.advance(12000);assigned(host,name);assert.equal(host.runtime.features.dhcpClientLeases?.[name],undefined);assert.equal(host.config.interfaces[name].features.dhcpLease,undefined);assert.equal(host.config.defaultGateway,undefined);assert.deepEqual(host.config.dnsServers,[]);const address=host.config.interfaces[name].ip;assert.equal(e.events.filter(v=>v.nodeId===host.id&&v.protocol==='ARP'&&v.disposition==='send'&&v.packet?.source==='0.0.0.0'&&v.packet?.destination===address).length,3);assert.ok(e.events.some(v=>v.label==='IPv4 link-local address assigned'&&v.detail.includes(address!)));assert.doesNotThrow(()=>JSON.stringify(host.runtime));
});

test('only Windows computer/laptop/server and macOS computer/laptop profiles use automatic IPv4 link-local fallback',()=>{
 for(const[kind,os,expected]of[['pc','windows',true],['server','windows',true],['pc','macos',true],['pc','linux',false],['router','windows',false],['switch','windows',false],['l3switch','windows',false],['poeswitch','windows',false],['datacenter','windows',false]]as const){const{e,host,name}=pair(kind,os);assert.equal(supportsIPv4LinkLocal(host),expected,kind+' '+os);e.advance(17000);if(expected)assigned(host,name);else assert.equal(host.config.interfaces[name].ip,undefined,kind+' '+os);}
 const e=new Simulator();for(const os of ['windows','macos','linux']){const laptop=e.addDevice('laptop');laptop.config.features.hostOS=os;assert.equal(supportsIPv4LinkLocal(laptop),os!=='linux');}for(const kind of ['wlc','ap','phone']as const)assert.equal(supportsIPv4LinkLocal(e.addDevice(kind)),false);for(const role of ['printer','iot','phone']){const h=e.addDevice('pc');h.config.features.endpoint={role,power:'external'};assert.equal(supportsIPv4LinkLocal(h),false);}
});

test('two hosts without a DHCP server communicate with real ICMP over their self-assigned addresses',()=>{
 const e=new Simulator(23927),a=e.addDevice('pc'),b=e.addDevice('pc');e.connect({deviceId:a.id,port},{deviceId:b.id,port});e.advance(16000);const aa=assigned(a),ba=assigned(b);assert.notEqual(aa,ba);for(const[source,target]of[[a,ba],[b,aa]]as const){const result=e.ping(source.id,target,{count:2});e.advance(4000);assert.equal(result.received,2);}assert.ok(e.events.some(v=>v.protocol==='ICMP'&&v.disposition==='receive'));
});

test('a DHCP server appearing later replaces fallback automatically with the real lease, router and DNS',()=>{
 const{e,host,peer,name}=pair();e.advance(16000);const old=assigned(host,name);service(peer);e.changed();e.advance(7000);assert.equal(host.config.interfaces[name].ip,'192.0.2.10');assert.equal(hasIPv4LinkLocalAddress(host,name),false);assert.equal(host.config.defaultGateway,'192.0.2.1');assert.deepEqual(host.config.dnsServers,['192.0.2.1']);assert.equal(host.runtime.features.dhcpClientLeases[name].state,'BOUND');assert.ok(!host.runtime.routes.some(r=>r.network===old));const result=e.ping(host.id,'192.0.2.1',{count:1});e.advance(3000);assert.equal(result.received,1);
});

test('a DHCP reply during probing cancels every delayed link-local assignment',()=>{
 const{e,host,peer,name}=pair();e.advance(4500);assert.equal(host.runtime.features.ipv4LinkLocal[name].phase,'probing');service(peer);e.changed();const result=e.requestDHCP(host.id,name);e.advance(15000);assert.equal(result.status,'success');assert.equal(host.config.interfaces[name].ip,'192.0.2.10');assert.equal(hasIPv4LinkLocalAddress(host,name),false);assert.ok(!e.events.some(v=>v.nodeId===host.id&&v.label==='IPv4 link-local address assigned'));
});

test('an occupied candidate is rejected by delivered ARP replies, then another address is claimed',()=>{
 const{e,host,peer,name}=pair();e.advance(4001);const candidate=host.runtime.features.ipv4LinkLocal[name].address;Object.assign(peer.config.interfaces[port],{ip:candidate,mask:'255.255.0.0'});e.changed();e.advance(17000);assert.notEqual(assigned(host,name),candidate);assert.equal(peer.config.interfaces[port].ip,candidate);assert.ok(e.events.some(v=>v.nodeId===host.id&&v.label==='IPv4 link-local address conflict'));const result=e.ping(host.id,candidate,{count:1});e.advance(3000);assert.equal(result.received,1);
});

test('ongoing conflicting ARP ownership triggers defense and reselection instead of keeping a duplicate',()=>{
 const{e,host,peer,name}=pair();e.advance(16000);const old=assigned(host,name);Object.assign(peer.config.interfaces[port],{ip:old,mask:'255.255.0.0'});e.changed();e.ping(peer.id,'169.254.254.254',{count:1});e.advance(17000);assert.notEqual(assigned(host,name),old);assert.ok(e.events.some(v=>v.nodeId===host.id&&v.label==='IPv4 link-local address defended'));assert.ok(e.events.some(v=>v.nodeId===host.id&&v.label==='IPv4 link-local address conflict'));
});

test('a valid DHCP lease survives server outage until expiry, then falls back without stale gateway/DNS',()=>{
 const{e,host,peer,name}=pair();service(peer,20);e.changed();e.advance(7000);assert.equal(host.config.interfaces[name].ip,'192.0.2.10');peer.config.services.dhcp!.enabled=false;e.changed();e.advance(5000);assert.equal(host.config.interfaces[name].ip,'192.0.2.10');assert.equal(hasIPv4LinkLocalAddress(host,name),false);e.advance(25000);assigned(host,name);assert.equal(host.config.defaultGateway,undefined);assert.deepEqual(host.config.dnsServers,[]);assert.doesNotMatch(new WindowsSession(e,host.id).execute('ipconfig /all').join('\n'),/DHCP Server/);assert.equal(host.config.interfaces[name].features.dhcpLease,undefined);const copy=new Simulator();copy.load(parseLabFile(serializeLabFile(e.serialize())));assert.equal(copy.getDevice(host.id)!.config.interfaces[name].ip,undefined);copy.advance(17000);assigned(copy.getDevice(host.id)!,name);
});

test('ipconfig release suppresses fallback and retries until an explicit renew, including during probing',()=>{
 for(const delay of [4500,16000]){const{e,host,name}=pair();e.advance(delay);const cli=new WindowsSession(e,host.id);cli.execute('ipconfig /release');const before=e.events.length;e.advance(20000);assert.equal(host.config.interfaces[name].ip,undefined);assert.ok(!e.events.slice(before).some(v=>v.nodeId===host.id&&(v.label==='IPv4 link-local address assigned'||v.packet?.dhcpOperation==='discover')));cli.execute('ipconfig /renew');e.advance(15000);assigned(host,name);}
});

test('static configuration cancels fallback without delayed overwrites; static DNS is retained',()=>{
 for(const delay of [4500,16000]){const{e,host,name}=pair();host.config.interfaces[name].features.windowsDNSMode='static';host.config.dnsServers=['203.0.113.53'];e.advance(delay);if(delay===16000)assert.deepEqual(host.config.dnsServers,['203.0.113.53']);const cli=new WindowsSession(e,host.id);cli.execute('netsh interface ipv4 set address Ethernet static 192.0.2.50 255.255.255.0 192.0.2.1');e.advance(20000);assert.equal(host.config.interfaces[name].ip,'192.0.2.50');assert.ok(!host.config.interfaces[name].features.dhcp);assert.equal(hasIPv4LinkLocalAddress(host,name),false);assert.deepEqual(host.config.dnsServers,['203.0.113.53']);}
});

test('media disconnect removes fallback and reconnect can retry, while an unplugged DHCP host stays unaddressed',()=>{
 const e0=new Simulator(),unplugged=e0.addDevice('pc');e0.advance(30000);assert.equal(unplugged.config.interfaces[port].ip,undefined);const{e,host,name}=pair();e.advance(16000);assigned(host,name);const link=e.lab.links[0];e.disconnect(link.id);e.advance(10000);assert.equal(host.config.interfaces[name].ip,undefined);e.connect(link.a,link.b);e.advance(20000);assigned(host,name);
});

test('saved DHCP labs re-probe instead of treating a link-local address as a static address or lease',()=>{
 const{e,host,name}=pair();e.advance(16000);assigned(host,name);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(e.serialize())));const h=restored.getDevice(host.id)!;assert.equal(h.config.interfaces[name].ip,undefined);assert.equal(h.config.interfaces[name].features.dhcp,true);restored.advance(17000);assigned(h,name);assert.equal(h.runtime.features.dhcpClientLeases?.[name],undefined);
});

test('Windows and macOS show fallback honestly; switching to Linux removes it',()=>{
 const{e,host,name}=pair();e.advance(16000);const ip=assigned(host,name),windows=new WindowsSession(e,host.id);assert.match(windows.execute('ipconfig /all').join('\n'),/Autoconfiguration Enabled.*Yes/);assert.match(windows.execute('ipconfig').join('\n'),new RegExp('Autoconfiguration IPv4 Address.*'+ip.replaceAll('.','\\.')));assert.doesNotMatch(windows.execute('ipconfig /all').join('\n'),/DHCP Server/);host.config.features.hostOS='macos';e.changed();assert.match(new UnixSession(e,host.id,'macos').execute('networksetup -getinfo Ethernet').join('\n'),new RegExp(ip.replaceAll('.','\\.')));host.config.features.hostOS='linux';e.changed();e.advance(17000);assert.equal(host.config.interfaces[name].ip,undefined);assert.equal(hasIPv4LinkLocalAddress(host,name),false);
});

test('wireless Windows/macOS clients fall back only after association, using real WLAN ARP delivery',()=>{
 for(const os of ['windows','macos']){const e=new Simulator();e.load(wirelessLabFixture());e.advance(20000,200000);const host=e.lab.devices.find(d=>d.kind==='laptop')!,server=e.lab.devices.find(d=>d.kind==='server')!;assert.ok(e.wireless.association(host.id));host.config.features.hostOS=os;server.config.services.dhcp!.enabled=false;e.releaseDHCP(host.id,'Wireless0');e.changed();e.requestDHCP(host.id,'Wireless0');e.advance(18000,200000);assigned(host,'Wireless0');assert.ok(e.wireless.association(host.id));assert.ok(e.events.some(v=>v.nodeId!==host.id&&v.protocol==='ARP'&&v.disposition==='receive'&&v.packet?.source==='0.0.0.0'&&v.packet?.destination===host.config.interfaces.Wireless0.ip));assert.match(host.runtime.features.wireless.reason,/self-assigned.*DHCP/);e.releaseDHCP(host.id,'Wireless0');e.advance(15000,200000);assert.equal(host.config.interfaces.Wireless0.ip,undefined);}
});

test('an address owned in another VLAN does not conflict with an on-link candidate',()=>{
 const e=new Simulator(3930),host=e.addDevice('pc'),other=e.addDevice('server'),sw=e.addDevice('switch');sw.config.features.stp={mode:'rapid-pvst'};sw.config.vlans['10']={id:10,name:'CLIENTS',active:true};sw.config.vlans['20']={id:20,name:'OTHER',active:true};for(const[n,vlan]of [[1,10],[2,20]])Object.assign(sw.config.interfaces['GigabitEthernet0/'+n],{mode:'access',vlan,features:{...sw.config.interfaces['GigabitEthernet0/'+n].features,portfast:true}});e.connect({deviceId:host.id,port},{deviceId:sw.id,port:'GigabitEthernet0/1'});e.connect({deviceId:other.id,port},{deviceId:sw.id,port:'GigabitEthernet0/2'});e.advance(4500);const candidate=host.runtime.features.ipv4LinkLocal[port].address;Object.assign(other.config.interfaces[port],{ip:candidate,mask:'255.255.0.0'});e.changed();e.advance(17000);assert.equal(assigned(host),candidate);assert.ok(!e.events.some(v=>v.nodeId===host.id&&v.label==='IPv4 link-local address conflict'));
});

test('link-local packets stay on the link and routers do not proxy ARP or forward them',()=>{
 const{e,host,peer,name}=pair();e.advance(16000);const address=assigned(host,name),r=e.addDevice('router'),remote=e.addDevice('server');e.disconnect(e.lab.links[0].id);Object.assign(r.config.interfaces['GigabitEthernet0/0'],{ip:'169.254.200.1',mask:'255.255.0.0',adminUp:true});Object.assign(r.config.interfaces['GigabitEthernet0/1'],{ip:'192.0.2.1',mask:'255.255.255.0',adminUp:true});Object.assign(remote.config.interfaces[port],{ip:'192.0.2.10',mask:'255.255.255.0'});remote.config.defaultGateway='192.0.2.1';e.connect({deviceId:host.id,port:name},{deviceId:r.id,port:'GigabitEthernet0/0'});e.connect({deviceId:remote.id,port},{deviceId:r.id,port:'GigabitEthernet0/1'});host.config.defaultGateway='169.254.200.1';e.changed();e.advance(17000);const current=assigned(host,name);const ping=e.ping(host.id,'192.0.2.10',{count:1});e.advance(4000);assert.equal(ping.received,0);assert.ok(e.events.some(v=>v.nodeId===host.id&&v.label==='IPv4 link-local scope'));
 // Force an on-link datagram: proxy ARP can deliver it to the router, which must still reject transit.
 e.sendControlDatagram(host.id,current,'192.0.2.10',3999,{test:'scope'},{interface:name});e.advance(4000);assert.ok(e.events.some(v=>v.nodeId===r.id&&v.label==='IPv4 link-local scope'));assert.ok(!e.events.some(v=>v.nodeId===remote.id&&v.packet?.source===current&&v.protocol==='UDP'&&v.disposition==='receive'));
 const start=e.events.length;e.sendControlDatagram(remote.id,'192.0.2.10',address,3999,{test:'proxy'},{interface:port});e.advance(4000);assert.ok(!e.events.slice(start).some(v=>v.nodeId===r.id&&v.protocol==='ARP'&&v.disposition==='send'&&v.packet?.source===address));assert.ok(peer);
});

test('renew retries an unanswered discovery after DHCP is repaired without orphaning its result',()=>{
 const{e,host,peer,name}=pair();e.advance(16000);assigned(host,name);const pending=e.requestDHCP(host.id,name);e.advance(1000);assert.equal(pending.status,'running');service(peer);e.changed();const retry=e.requestDHCP(host.id,name);assert.equal(retry,pending);e.advance(2000);assert.equal(retry.status,'success');assert.equal(host.config.interfaces[name].ip,'192.0.2.10');assert.equal(hasIPv4LinkLocalAddress(host,name),false);
});
