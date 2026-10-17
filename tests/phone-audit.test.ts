import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator,type Frame} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {phoneLabFixture,g} from './fixtures/phone-lab.ts';

test('PHONE-AUDIT-01 IPv6 PC passthrough preserves client MAC, hop limit and DSCP in both directions without entering the voice VLAN',()=>{
 const{sim,phone,pc,data}=phoneLabFixture();sim.advance(3000);
 pc.config.interfaces.GigabitEthernet0.ipv6=['2001:db8:10::10/64'];data.config.interfaces.GigabitEthernet0.ipv6=['2001:db8:10::1/64'];sim.changed();sim.advance(1500);
 const p=sim.ping(pc.id,'2001:db8:10::1',{count:1,ttl:23,tos:138,size:128});sim.advance(1500);assert.equal(p.received,1);
 const sends=sim.events.filter(v=>v.disposition==='send'&&v.protocol==='ICMPV6'&&v.packet?.icmpType===128&&v.packet.destination==='2001:db8:10::1'),original=sends.find(v=>v.nodeId===pc.id)!,forwarded=sends.find(v=>v.nodeId===phone.id&&v.port==='Network')!;
 assert.ok(original&&forwarded);assert.equal(forwarded.packet?.id,original.packet?.id);assert.equal(forwarded.packet?.sourceMac,sim.macOf(pc.id,'GigabitEthernet0'));assert.equal(forwarded.packet?.source,original.packet?.source);assert.equal(forwarded.packet?.ttl,23);assert.equal(forwarded.packet?.dscp,34);assert.equal(forwarded.packet?.ecn,2);assert.equal(forwarded.packet?.vlan,undefined);
 const reply=sim.events.find(v=>v.nodeId===phone.id&&v.port==='PC'&&v.disposition==='send'&&v.packet?.icmpType===129&&v.packet.destination==='2001:db8:10::10'),originReply=sim.events.find(v=>v.nodeId===data.id&&v.disposition==='send'&&v.packet?.icmpType===129&&v.packet.destination==='2001:db8:10::10');assert.ok(reply&&originReply);assert.equal(reply.packet?.id,originReply.packet?.id);assert.equal(reply.packet?.sourceMac,sim.macOf(data.id,'GigabitEthernet0'));assert.equal(reply.packet?.ttl,originReply.packet?.ttl);assert.equal(reply.packet?.vlan,undefined);
 assert.ok(sim.events.some(v=>v.nodeId===phone.id&&v.port==='Network'&&v.protocol==='NDP'&&v.disposition==='send'&&v.packet?.sourceMac===sim.macOf(pc.id,'GigabitEthernet0')));
});

test('PHONE-AUDIT-02 a phone bridging loop consumes the shared Ethernet forwarding limit without changing the IP TTL',()=>{
 const sim=new Simulator(8110),sw=sim.addDevice('poeswitch'),phone=sim.addDevice('phone'),pc=sim.addDevice('pc');phone.config.interfaces.Network.features.dhcp=false;
 for(const port of[g(1),g(2),g(3)]){sw.config.interfaces[port].features.portfast=true;sw.config.interfaces[port].features.cdpEnabled=false;}
 sim.connect({deviceId:sw.id,port:g(1)},{deviceId:phone.id,port:'Network'});sim.connect({deviceId:sw.id,port:g(2)},{deviceId:phone.id,port:'PC'});sim.connect({deviceId:sw.id,port:g(3)},{deviceId:pc.id,port:'GigabitEthernet0'});sim.changed();sim.advance(10);
 const frame:Frame={id:'phone-loop-frame',sourceMac:sim.macOf(pc.id,'GigabitEthernet0'),destinationMac:'ff:ff:ff:ff:ff:ff',hops:4,payload:{id:'phone-loop-probe',source:'192.0.2.10',destination:'192.0.2.255',protocol:'udp',sourcePort:9998,destinationPort:9999,ttl:37,size:64,df:false,body:{probe:'loop'}}};
 sim.sendWirelessEthernet(pc.id,'GigabitEthernet0',frame);sim.advance(50);const events=sim.events.filter(v=>v.packet?.id==='phone-loop-probe');assert.ok(events.some(v=>v.nodeId===phone.id&&v.label==='Phone PC passthrough'));assert.ok(events.some(v=>v.label==='Layer 2 loop guard'));assert.ok(events.filter(v=>v.disposition==='send').length<=16);assert.ok(events.every(v=>v.packet?.ttl===37));const count=events.length;sim.advance(200);assert.equal(sim.events.filter(v=>v.packet?.id==='phone-loop-probe').length,count);
});

test('PHONE-AUDIT-03 data-only PC ports reject imported secondary IPv4 and explicit IPv6 identities in running and startup configuration atomically',()=>{
 const{sim,phone}=phoneLabFixture();sim.advance(3000);const before=JSON.stringify(sim.serialize());
 for(const field of['running','startup'])for(const features of[{secondaryIps:[{ip:'192.0.2.77',mask:'255.255.255.0'}]},{ipv6Enabled:true},{ipv6LinkLocal:'fe80::77'},{ipv6Eui64:{'2001:db8:77::/64':'2001:db8:77::77/64'}}]){
  const doc=sim.serialize(),pd=doc.lab.devices.find(d=>d.id===phone.id)!;if(field==='startup')pd.startupConfig=structuredClone(pd.config);const config=field==='startup'?pd.startupConfig!:pd.config;Object.assign(config.interfaces.PC.features,features);
  assert.throws(()=>sim.load(doc),/passthrough|PC port|data.only/i,field+': '+Object.keys(features)[0]);assert.equal(JSON.stringify(sim.serialize()),before);
 }
});

test('PHONE-AUDIT-04 PoE loss and software reload cancel already queued passthrough frames instead of delivering them after a new boot',()=>{
 for(const reset of['poe','reload']){const{sim,phone,pc,wire,run}=phoneLabFixture();sim.advance(3000);const warm=sim.ping(pc.id,'10.10.10.1',{count:1});sim.advance(500);assert.equal(warm.received,1);wire.delay=200;const probe=sim.ping(pc.id,'10.10.10.1',{count:1,timeout:500});sim.advance(10);const sent=sim.events.filter(v=>v.nodeId===phone.id&&v.port==='Network'&&v.disposition==='send'&&v.packet?.icmpType===8).at(-1)!;assert.ok(sent);const allocation=phone.runtime.features.poePower.watts;
  if(reset==='poe'){run('conf t','interface g0/1','power inline never','end');assert.equal(sim.interfaceUp(phone.id,'PC'),false);run('conf t','interface g0/1','power inline auto','end');}else sim.reload(phone.id);
  sim.advance(1000);assert.equal(probe.received,0,reset);assert.ok(sim.events.some(v=>v.nodeId===phone.id&&v.label==='Cable interrupted'&&v.packet?.id===sent.packet?.id),reset);assert.equal(phone.runtime.features.poePower.watts,allocation);wire.delay=.1;sim.advance(3000);const good=sim.ping(pc.id,'10.10.10.1',{count:1});sim.advance(1000);assert.equal(good.received,1,reset);
 }
});

test('PHONE-AUDIT-05 portable object order cannot change phone port roles and the dedicated phone never accepts a fake IOS console',()=>{
 const{sim,phone,pc}=phoneLabFixture();const doc=sim.serialize(),pd=doc.lab.devices.find(d=>d.id===phone.id)!;pd.config.interfaces={PC:pd.config.interfaces.PC,Network:pd.config.interfaces.Network};const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(doc)));restored.advance(3000);const p=restored.getDevice(phone.id)!;assert.match(p.config.interfaces.Network.ip!,/^10\.20\.20\./);assert.equal(p.config.interfaces.PC.ip,undefined);const cli=new IOSSession(restored,p.id),before=JSON.stringify(p.config);for(const line of['enable','conf t','interface PC','ip address 192.0.2.1 255.255.255.0'])assert.match(cli.execute(line).join('\n'),/no IOS|settings panel/i);assert.equal(JSON.stringify(p.config),before);const ping=restored.ping(pc.id,'10.10.10.1',{count:1});restored.advance(1000);assert.equal(ping.received,1);const pcWire=restored.lab.links.find(l=>l.a.deviceId===p.id&&l.a.port==='PC'||l.b.deviceId===p.id&&l.b.port==='PC')!;restored.disconnect(pcWire.id);const ap=restored.addDevice('ap');restored.connect({deviceId:p.id,port:'PC'},{deviceId:ap.id,port:'GigabitEthernet0'});assert.equal(restored.devicePowered(p.id),true);assert.equal(restored.devicePowered(ap.id),false);assert.equal(restored.interfaceUp(ap.id,'GigabitEthernet0'),false);
});
