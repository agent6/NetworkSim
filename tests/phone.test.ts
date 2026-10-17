import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator,type Frame} from '../src/engine.ts';
import {factoryDeviceConfig} from '../src/model.ts';
import {endpointVoicePolicy,endpointEgressVlan} from '../src/endpoint.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {phoneLabFixture,g} from './fixtures/phone-lab.ts';

test('PHONE-01 a dedicated phone has exactly Network/PC ports, DHCP on Network, and no manual power',()=>{
  const config=factoryDeviceConfig('phone','PHONE1');
  assert.deepEqual(Object.keys(config.interfaces),['Network','PC']);
  assert.equal(config.interfaces.Network.features.dhcp,true);assert.equal(config.interfaces.PC.features.dhcp,undefined);
  const sim=new Simulator(),phone=sim.addDevice('phone');assert.equal(phone.powered,false);sim.power(phone.id,true);assert.equal(sim.devicePowered(phone.id),false);
});

test('PHONE-02 only Network accepts PoE; a PC cable or non-PoE switch cannot power the phone',()=>{
  for(const[kind,port]of[['switch','Network'],['poeswitch','PC']]as const){
    const sim=new Simulator(),sw=sim.addDevice(kind),phone=sim.addDevice('phone');sim.connect({deviceId:sw.id,port:g(1)},{deviceId:phone.id,port});
    assert.equal(sim.devicePowered(phone.id),false);assert.equal(sim.interfaceUp(phone.id,port),false);
    if(kind==='poeswitch')assert.equal(sw.runtime.features.poe.used,0);
  }
  const{sim,sw,phone}=phoneLabFixture();assert.equal(sim.devicePowered(phone.id),true);assert.equal(sw.runtime.features.poe.used,15.4);assert.equal(phone.runtime.features.poePower.class,3);
});

test('PHONE-03 actual discovery and DHCP separate voice and untagged PC traffic on one switch port',()=>{
  const{sim,sw,phone,pc}=phoneLabFixture();sim.advance(3000);
  assert.equal(endpointVoicePolicy(phone,sim.clock.now())?.protocol,'CDP');assert.equal(endpointEgressVlan(phone,sim.clock.now()),20);
  assert.match(phone.config.interfaces.Network.ip!,/^10\.20\.20\./);assert.match(pc.config.interfaces.GigabitEthernet0.ip!,/^10\.10\.10\./);
  assert.equal(phone.config.defaultGateway,'10.20.20.1');assert.equal(pc.config.defaultGateway,'10.10.10.1');
  for(const[d,target]of[[phone,'10.20.20.1'],[pc,'10.10.10.1']]as const){const ping=sim.ping(d.id,target,{count:1});sim.advance(1000);assert.equal(ping.received,1);}
  const phoneMac=sim.macOf(phone.id,'Network'),pcMac=sim.macOf(pc.id,'GigabitEthernet0');
  assert.equal(sw.runtime.mac['20|'+phoneMac]?.port,g(1));assert.equal(sw.runtime.mac['10|'+pcMac]?.port,g(1));
  const voice=sim.events.filter(e=>e.nodeId===phone.id&&e.disposition==='send'&&e.protocol==='ICMP'&&e.packet?.sourceMac===phoneMac);
  const data=sim.events.filter(e=>e.nodeId===phone.id&&e.disposition==='send'&&e.protocol==='ICMP'&&e.packet?.sourceMac===pcMac);
  assert.ok(voice.length);assert.ok(data.length);assert.ok(voice.every(e=>e.packet!.vlan===20&&e.packet!.cos===5));
  assert.ok(data.every(e=>e.packet!.vlan===undefined));
  const original=sim.events.find(e=>e.nodeId===pc.id&&e.disposition==='send'&&e.protocol==='ICMP');
  const forwarded=data.find(e=>e.packet?.id===original?.packet?.id);assert.equal(forwarded?.packet?.ttl,original?.packet?.ttl);
  assert.ok(sim.events.filter(e=>e.nodeId===phone.id&&e.port==='PC'&&e.disposition==='send').every(e=>e.packet?.vlan===undefined));
});

test('PHONE-04 VLAN policy changes renew only the phone lease while PC data keeps working',()=>{
  const{sim,sw,phone,pc,voice,run,service}=phoneLabFixture();sim.advance(3000);const pcAddress=pc.config.interfaces.GigabitEthernet0.ip;
  service(voice,'10.30.30');run('configure terminal','vlan 30','exit','interface g0/3','switchport access vlan 30','exit','interface g0/1','switchport voice vlan 30','end');sim.advance(3000);
  assert.equal(endpointEgressVlan(phone,sim.clock.now()),30);assert.match(phone.config.interfaces.Network.ip!,/^10\.30\.30\./);
  assert.equal(pc.config.interfaces.GigabitEthernet0.ip,pcAddress);const ping=sim.ping(pc.id,'10.10.10.1',{count:1});sim.advance(1000);assert.equal(ping.received,1);
  assert.equal(sw.runtime.features.poe.used,15.4);
});

test('PHONE-05 LLDP-MED capabilities and delivered policy configure the dedicated phone',()=>{
  const{sim,phone,sw}=phoneLabFixture('LLDP');sim.advance(3000);
  assert.equal(endpointVoicePolicy(phone,sim.clock.now())?.protocol,'LLDP');assert.equal(endpointEgressVlan(phone,sim.clock.now()),20);
  assert.match(phone.config.interfaces.Network.ip!,/^10\.20\.20\./);
  const ping=sim.ping(phone.id,'10.20.20.1',{count:1});sim.advance(1000);assert.equal(ping.received,1);
  assert.ok(sw.runtime.neighbors.some(n=>n.deviceId===phone.id&&n.protocol==='LLDP'&&n.peerInterface==='Network'));
  assert.ok(sim.events.some(e=>e.nodeId===phone.id&&e.disposition==='send'&&e.protocol==='ICMP'&&e.packet?.vlan===20&&e.packet.dscp===46));
});

test('PHONE-06 without a received policy both phone and PC use the untagged data VLAN',()=>{
  const{sim,phone,pc}=phoneLabFixture('none');sim.advance(3000);
  assert.equal(endpointEgressVlan(phone,sim.clock.now()),undefined);
  assert.match(phone.config.interfaces.Network.ip!,/^10\.10\.10\./);assert.match(pc.config.interfaces.GigabitEthernet0.ip!,/^10\.10\.10\./);
  assert.notEqual(phone.config.interfaces.Network.ip,pc.config.interfaces.GigabitEthernet0.ip);
});

test('PHONE-07 lost discovery cannot reveal switch configuration and does not stop PC data',()=>{
  const{sim,phone,pc,sw}=phoneLabFixture(),send=sim.sendLinkControl.bind(sim);
  sim.sendLinkControl=(id,port,message)=>{if(id===sw.id&&['CDP','LLDP'].includes(message.protocol))return;send(id,port,message);};sim.advance(3000);
  assert.equal(sim.devicePowered(phone.id),true);assert.equal(endpointEgressVlan(phone,sim.clock.now()),undefined);
  assert.match(phone.config.interfaces.Network.ip!,/^10\.10\.10\./);const ping=sim.ping(pc.id,'10.10.10.1',{count:1});sim.advance(1000);assert.equal(ping.received,1);
});

test('PHONE-08 tagged PC injection is rejected and voice broadcasts never reach the PC port',()=>{
  const{sim,phone,pc}=phoneLabFixture();sim.advance(3000);
  const frame:Frame={id:'pc-tagged-injection',sourceMac:sim.macOf(pc.id,'GigabitEthernet0'),destinationMac:'ff:ff:ff:ff:ff:ff',vlan:20,hops:64,payload:{id:'tagged-probe',source:'10.20.20.99',destination:'10.20.20.1',protocol:'icmp',ttl:128,size:64,df:false,body:{kind:'echo-request'}}};
  sim.sendWirelessEthernet(pc.id,'GigabitEthernet0',frame);sim.advance(100);
  assert.ok(sim.events.some(e=>e.nodeId===phone.id&&e.port==='PC'&&e.label==='Phone VLAN isolation'));
  assert.equal(sim.events.some(e=>e.nodeId===phone.id&&e.disposition==='send'&&e.packet?.id==='tagged-probe'),false);
  assert.ok(sim.events.filter(e=>e.nodeId===phone.id&&e.port==='PC'&&e.disposition==='send').every(e=>e.packet?.vlan===undefined));
});

test('PHONE-09 PoE loss takes both ports down and restoration recovers voice plus PC connectivity',()=>{
  const{sim,sw,phone,pc,run}=phoneLabFixture();sim.advance(3000);
  run('configure terminal','interface g0/1','power inline never','end');assert.equal(sim.devicePowered(phone.id),false);
  assert.equal(sim.interfaceUp(phone.id,'Network'),false);assert.equal(sim.interfaceUp(phone.id,'PC'),false);assert.equal(sim.interfaceUp(pc.id,'GigabitEthernet0'),false);
  assert.equal(sw.runtime.features.poe.used,0);
  run('configure terminal','interface g0/1','power inline auto','end');sim.advance(3000);assert.equal(endpointEgressVlan(phone,sim.clock.now()),20);
  assert.match(phone.config.interfaces.Network.ip!,/^10\.20\.20\./);for(const[d,target]of[[phone,'10.20.20.1'],[pc,'10.10.10.1']]as const){const ping=sim.ping(d.id,target,{count:1});sim.advance(1000);assert.equal(ping.received,1);}
});

test('PHONE-10 power budget denial, broken cable, and removal of the uplink cannot leave a phantom powered bridge',()=>{
  const{sim,sw,phone,wire}=phoneLabFixture();sw.config.features.poe.budget=0;sim.changed();assert.equal(sim.devicePowered(phone.id),false);
  sw.config.features.poe.budget=370;sim.changed();assert.equal(sim.devicePowered(phone.id),true);
  wire.physical={medium:'copper-cat6a',length:10,fault:'open',bitErrorRate:0};sim.changed();assert.equal(sim.devicePowered(phone.id),false);
  wire.physical=undefined;sim.changed();assert.equal(sim.devicePowered(phone.id),true);sim.disconnect(wire.id);assert.equal(sim.devicePowered(phone.id),false);assert.equal(sim.interfaceUp(phone.id,'PC'),false);
});

test('PHONE-11 portable YAML reload recreates real phone discovery, power, DHCP and passthrough',()=>{
  const{sim,phone,pc}=phoneLabFixture();sim.advance(3000);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));restored.advance(3000);
  const device=restored.getDevice(phone.id)!;assert.equal(device.kind,'phone');assert.deepEqual(Object.keys(device.config.interfaces),['Network','PC']);assert.equal(restored.devicePowered(phone.id),true);
  assert.equal(endpointEgressVlan(device,restored.clock.now()),20);assert.match(device.config.interfaces.Network.ip!,/^10\.20\.20\./);
  const ping=restored.ping(pc.id,'10.10.10.1',{count:1});restored.advance(1000);assert.equal(ping.received,1);
});

test('PHONE-12 invalid phone ports, local PC addressing and manual power reject transactionally',()=>{
  const{sim,phone}=phoneLabFixture(),before=JSON.stringify(sim.serialize());
  for(const mutate of[(d:any)=>delete d.config.interfaces.PC,(d:any)=>d.config.interfaces.PC.ip='192.0.2.4',(d:any)=>d.config.interfaces.PC.features.dhcp=true,(d:any)=>d.config.features.powerSource='external']){
    const doc=sim.serialize();mutate(doc.lab.devices.find(d=>d.id===phone.id));assert.throws(()=>sim.load(doc),/phone|Phone|passthrough|PoE/);assert.equal(JSON.stringify(sim.serialize()),before);
  }
});

test('PHONE-13 expired voice discovery returns only the phone to the data VLAN and preserves PC traffic',()=>{
  const{sim,phone,pc,run}=phoneLabFixture();run('configure terminal','cdp timer 5','cdp holdtime 6','end');sim.advance(3000);
  assert.equal(endpointEgressVlan(phone,sim.clock.now()),20);const pcAddress=pc.config.interfaces.GigabitEthernet0.ip;
  run('configure terminal','interface g0/1','no cdp enable','end');sim.advance(9000);
  assert.equal(endpointEgressVlan(phone,sim.clock.now()),undefined);assert.match(phone.config.interfaces.Network.ip!,/^10\.10\.10\./);assert.equal(pc.config.interfaces.GigabitEthernet0.ip,pcAddress);
  const ping=sim.ping(pc.id,'10.10.10.1',{count:1});sim.advance(1000);assert.equal(ping.received,1);assert.equal(sim.devicePowered(phone.id),true);
});
