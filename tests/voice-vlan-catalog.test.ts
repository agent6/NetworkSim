import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,VOICE_VLAN_COMMANDS,catalogGuideResources,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,validateLesson,matches,actionAvailable,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {endpointVoicePolicy} from '../src/endpoint.ts';
const g=(n:number)=>`GigabitEthernet0/${n}`,id=(name:string)=>'device-voice-'+name.toLowerCase();
function load(mode:'practice'|'completed'='practice'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('voice-vlan',mode))));sim.advance(5000);return sim;}
function run(sim:Simulator,commands:readonly string[]){const cli=new IOSSession(sim,id('PSW1'));for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}return cli;}
const goal=(sim:Simulator,name:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===name)!.complete;
const ping=(sim:Simulator,source:string,target:string)=>{const result=sim.ping(id(source),target,{count:2});sim.advance(4000);return result.received;};
function finish(sim:Simulator){assert.equal(ping(sim,'PC1','192.168.10.12'),2);assert.equal(ping(sim,'PHONE1','192.168.20.1'),2);assert.equal(ping(sim,'PHONE2','192.168.20.1'),2);}

test('voice practice is independent and portable, with no credit or power before the switch is configured',()=>{
 const a=createCatalogLab('voice-vlan'),b=createCatalogLab('voice-vlan');assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.hostname='changed';assert.equal(b.lab.devices[0].config.hostname,'PSW1');const sim=load();assert.equal(sim.lab.devices.length,7);assert.equal(sim.lab.links.length,6);assert.equal((sim.lab as CatalogLab).catalogId,'voice-vlan');validateLesson((sim.lab as CatalogLab).lesson);assert.equal(lessonProgress(sim)!.complete,0);assert.equal(lessonProgress(sim)!.rows.length,10);assert.equal(ping(sim,'PC1','192.168.10.12'),0);
 for(const name of ['PHONE1','PHONE2']){assert.equal(sim.devicePowered(id(name)),false);assert.equal(sim.interfaceUp(id(name),'PC'),false);assert.equal(actionAvailable(sim,lessonProgress(sim)!.rows.find(r=>r.objective.id===name.toLowerCase()+'-ping')!.objective),false);}assert.equal(sim.getDevice(id('PSW1'))!.runtime.features.poe.used,0);assert.equal(sim.getDevice(id('PSW1'))!.config.vlans[100].active,true);
});

test('published switch commands deliver real PoE, CDP policy, relayed voice DHCP and untagged PC traffic',()=>{
 const sim=load();run(sim,VOICE_VLAN_COMMANDS.PSW1);sim.advance(5000);assert.equal(lessonProgress(sim)!.complete,6);const sw=sim.getDevice(id('PSW1'))!;assert.equal(sw.runtime.features.poe.used,30.8);assert.equal(sw.startupConfig!.interfaces[g(1)].features.voiceVlan,20);assert.equal(sw.startupConfig!.interfaces[g(2)].vlan,10);
 for(const name of ['PHONE1','PHONE2']){const phone=sim.getDevice(id(name))!,lease=phone.runtime.features.dhcpClientLeases.Network;assert.equal(sim.devicePowered(phone.id),true);assert.equal(phone.runtime.features.poePower.switchId,sw.id);assert.equal(endpointVoicePolicy(phone,sim.clock.now())?.vlan,20);assert.equal(endpointVoicePolicy(phone,sim.clock.now())?.protocol,'CDP');assert.match(phone.config.interfaces.Network.ip!,/^192\.168\.20\./);assert.equal(lease.relay,'192.168.20.1');assert.equal(lease.serverId,id('SRV1'));assert.equal(phone.config.defaultGateway,'192.168.20.1');assert.deepEqual(phone.config.dnsServers,['192.168.100.10']);}
 finish(sim);assert.equal(lessonProgress(sim)!.complete,10);assert.ok(sim.events.some(e=>e.nodeId===id('PHONE1')&&e.port==='Network'&&e.disposition==='send'&&e.protocol==='ICMP'&&e.packet?.vlan===20&&e.packet.cos===5));const pcMac=sim.macOf(id('PC1'),'GigabitEthernet0'),original=sim.events.find(e=>e.nodeId===id('PC1')&&e.disposition==='send'&&e.protocol==='ICMP'&&e.packet?.source==='192.168.10.11')!.packet!;assert.ok(sim.events.some(e=>e.nodeId===id('PHONE1')&&e.port==='Network'&&e.disposition==='send'&&e.protocol==='ICMP'&&e.packet?.id===original.id&&e.packet.sourceMac===pcMac&&e.packet.vlan===undefined&&e.packet.ttl===original.ttl));
});

test('configured voice VLAN cannot earn received-policy or lease credit without delivered discovery',()=>{
 const sim=new Simulator(),send=sim.sendLinkControl.bind(sim);sim.sendLinkControl=(device,port,message)=>{if(['CDP','LLDP'].includes(message.protocol))return;send(device,port,message);};sim.load(createCatalogLab('voice-vlan','completed'));sim.advance(10000);assert.equal(goal(sim,'phone-ports'),true);assert.equal(goal(sim,'poe'),true);assert.equal(goal(sim,'voice-policy'),false);assert.equal(goal(sim,'voice-leases'),false);assert.equal(ping(sim,'PC1','192.168.10.12'),2);sim.sendLinkControl=send;sim.advance(65000,200000);assert.equal(goal(sim,'voice-policy'),true);assert.equal(goal(sim,'voice-leases'),true);
});

test('wrong access and voice VLANs break their own traffic paths and repair restores them',()=>{
 const sim=load('completed');finish(sim);run(sim,['enable','configure terminal','interface '+g(1),'switchport access vlan 30','end']);sim.advance(3000);assert.equal(goal(sim,'phone-ports'),false);assert.equal(ping(sim,'PC1','192.168.10.12'),0);assert.equal(ping(sim,'PHONE1','192.168.20.1'),2);run(sim,['enable','configure terminal','interface '+g(1),'switchport access vlan 10','switchport voice vlan 30','end']);sim.advance(5000);assert.equal(goal(sim,'voice-policy'),false);assert.equal(goal(sim,'voice-leases'),false);assert.equal(ping(sim,'PC1','192.168.10.12'),2);assert.equal(ping(sim,'PHONE1','192.168.20.1'),0);assert.equal(ping(sim,'PHONE2','192.168.20.1'),2);run(sim,VOICE_VLAN_COMMANDS.PSW1);sim.advance(5000);finish(sim);assert.equal(lessonProgress(sim)!.complete,10);
});

test('PoE loss and restoration affect both phone ports, with no manual phone power shortcut',()=>{
 const sim=load('completed');finish(sim);run(sim,['enable','configure terminal','interface '+g(1),'power inline never','end']);assert.equal(sim.devicePowered(id('PHONE1')),false);assert.equal(sim.interfaceUp(id('PC1'),'GigabitEthernet0'),false);assert.equal(goal(sim,'poe'),false);assert.equal(goal(sim,'voice-policy'),false);assert.equal(ping(sim,'PC1','192.168.10.12'),0);assert.equal(ping(sim,'PHONE2','192.168.20.1'),2);run(sim,['enable','configure terminal','interface '+g(1),'power inline auto','end']);sim.advance(5000);finish(sim);assert.equal(goal(sim,'poe'),true);assert.equal(lessonProgress(sim)!.complete,10);
});

test('MAC checks distinguish each phone and its attached PC on one physical switch port',()=>{
 const sim=load('completed');finish(sim);const sw=sim.getDevice(id('PSW1'))!;for(const n of [1,2])for(const[role,port,vlan]of [['PHONE','Network',20],['PC','GigabitEthernet0',10]]as const){const mac=sim.macOf(id(role+n),port);assert.equal(sw.runtime.mac[vlan+'|'+mac].port,g(n));assert.ok(!sw.runtime.mac[vlan+'|'+mac].static);}run(sim,['enable','clear mac address-table dynamic']);assert.equal(goal(sim,'mac-learning'),false);finish(sim);assert.equal(goal(sim,'mac-learning'),true);
});

test('published verification commands return working Cisco/Windows output after configuration',()=>{
 const sim=load('completed');finish(sim);for(const[name,commands]of Object.entries(catalogGuideResources('voice-vlan')!.verification)){const cli=new IOSSession(sim,id(name));if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const out=cli.execute(command).join('\n');assert.ok(!/not recognized|not implemented|% Invalid/i.test(out),command+'\n'+out);if(command.startsWith('ping'))assert.match(out,/Received = 3/);if(command==='show power inline')assert.match(out,/30\.8/);if(command.includes('switchport'))assert.match(out,/Voice VLAN: 20/);}}
});

test('portable reload rebuilds policy, leases and MAC learning, retaining earned echo tasks and saved configuration',()=>{
 const sim=load('completed');finish(sim);sim.getDevice(id('PHONE1'))!.config.hostname='Desk phone';sim.getDevice(id('PC1'))!.config.hostname='Desk PC';const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));assert.equal(goal(restored,'voice-policy'),false);assert.equal(goal(restored,'voice-leases'),false);assert.equal(goal(restored,'mac-learning'),false);restored.advance(5000);assert.equal(goal(restored,'voice-policy'),true);assert.equal(goal(restored,'voice-leases'),true);finish(restored);assert.equal(lessonProgress(restored)!.complete,10);for(const d of restored.lab.devices.filter(d=>d.kind!=='phone')){restored.power(d.id,false);restored.power(d.id,true);}restored.advance(5000);finish(restored);assert.equal(lessonProgress(restored)!.complete,10);
});

test('static phone addresses cannot impersonate a received DHCP lease',()=>{
 const sim=load('completed'),phone=sim.getDevice(id('PHONE1'))!;sim.releaseDHCP(phone.id,'Network');sim.stopAutomaticAddressing(phone.id,'Network','ipv4');Object.assign(phone.config.interfaces.Network,{ip:'192.168.20.200',mask:'255.255.255.0'});phone.config.defaultGateway='192.168.20.1';phone.config.dnsServers=['192.168.100.10'];sim.changed();assert.equal(goal(sim,'voice-policy'),true);assert.equal(goal(sim,'voice-leases'),false);
});

test('voice criteria validate plain bounded VLAN data and never evaluate imported expressions',()=>{
 const lesson=(createCatalogLab('voice-vlan').lab as CatalogLab).lesson!;for(const vlan of [1,20,4094]){const criterion:Criterion={kind:'voice-policy',device:id('PHONE1'),vlan};assert.doesNotThrow(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion}]}));}for(const value of [0,4095,'20',{},()=>20])for(const criterion of [{kind:'voice-policy',device:id('PHONE1'),vlan:value},{kind:'interface',device:id('PSW1'),interface:g(1),property:'voiceVlan',value}])assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion}]}),/invalid/);const sim=load('completed');assert.equal(matches(sim,{kind:'voice-policy',device:'missing',vlan:20}),false);assert.equal(matches(sim,{kind:'interface',device:id('PSW1'),interface:'missing',property:'voiceVlan',value:20}),false);
});
