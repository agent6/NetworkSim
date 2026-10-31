import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,catalogGuideResources,DHCP_SERVER_SETTINGS,DHCP_RELAY_COMMANDS,type CatalogLab} from '../src/lab-catalog.ts';
import {lessonProgress,actionAvailable,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const port='GigabitEthernet0';
const load=(mode:'practice'|'completed'='practice')=>{const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('dhcp-server-and-relay',mode))));sim.advance(1500);return sim;};
const run=(sim:Simulator,commands:readonly string[])=>{const cli=new IOSSession(sim,sim.getDevice('R1')!.id);for(const command of commands){const out=cli.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));}};
const configure=(sim:Simulator)=>{sim.getDevice('SRV1')!.config.services.dhcp=structuredClone(DHCP_SERVER_SETTINGS);sim.changed();run(sim,DHCP_RELAY_COMMANDS.R1);};
const request=(sim:Simulator,name='PC1')=>{const result=sim.requestDHCP(name,port);sim.advance(5000);return result;};
const ping=(sim:Simulator,name:string)=>{const p=sim.ping(name,'192.168.100.10',{count:2});sim.advance(5000);return p.received;};
const leases=(sim:Simulator)=>lessonProgress(sim)!.rows.filter(r=>r.objective.criterion.kind==='dhcp-lease');
const release=(sim:Simulator)=>{for(const name of ['PC1','PC2'])sim.stopAutomaticAddressing(sim.getDevice(name)!.id,port,'ipv4');sim.advance(100);};

test('DHCP catalog practice is portable, starts without leases, and keeps the server on a separate subnet',()=>{
 const a=createCatalogLab('dhcp-server-and-relay'),b=createCatalogLab('dhcp-server-and-relay');assert.notEqual(a.lab.id,b.lab.id);const sim=load();assert.equal(sim.lab.devices.length,5);assert.equal(sim.lab.links.length,4);assert.equal((sim.lab as CatalogLab).catalogId,'dhcp-server-and-relay');validateLesson((sim.lab as CatalogLab).lesson);
 assert.equal(sim.getDevice('SRV1')!.config.services.dhcp.enabled,false);assert.equal(sim.getDevice('SRV1')!.config.interfaces[port].ip,'192.168.100.10');assert.equal(sim.getDevice('R1')!.config.interfaces['GigabitEthernet0/0'].features.helpers,undefined);
 assert.equal(request(sim).status,'failure');assert.equal(lessonProgress(sim)!.complete,0);assert.ok(leases(sim).every(r=>actionAvailable(sim,r.objective)));assert.ok(lessonProgress(sim)!.rows.filter(r=>r.objective.action?.kind==='ping').every(r=>!actionAvailable(sim,r.objective)));
});
test('server configuration alone cannot cross the router; helper configuration enables actual DHCP and routed traffic',()=>{
 const sim=load(),server=sim.getDevice('SRV1')!;server.config.services.dhcp=structuredClone(DHCP_SERVER_SETTINGS);sim.changed();assert.equal(request(sim).status,'failure');assert.equal(lessonProgress(sim)!.complete,1);
 run(sim,DHCP_RELAY_COMMANDS.R1);sim.advance(5000);assert.equal(request(sim,'PC1').status,'success');assert.equal(request(sim,'PC2').status,'success');assert.equal(lessonProgress(sim)!.complete,4);
 const addresses=new Set<string>();for(const name of ['PC1','PC2']){const d=sim.getDevice(name)!,p=d.config.interfaces[port];assert.match(p.ip!,/^192\.168\.10\./);assert.ok(Number(p.ip!.split('.')[3])>=21);assert.equal(p.mask,'255.255.255.0');assert.equal(d.config.defaultGateway,'192.168.10.1');assert.deepEqual(d.config.dnsServers,['192.168.100.10']);addresses.add(p.ip!);}assert.equal(addresses.size,2);assert.equal(server.runtime.features.dhcpLeases.length,2);assert.ok(leases(sim).every(r=>r.complete));
 for(const name of ['PC1','PC2'])assert.equal(sim.getDevice(name)!.runtime.features.dhcpClientLeases[port].relay,'192.168.10.1','the received ACK identifies the client-subnet relay address');assert.ok(server.runtime.features.dhcpServerStats.sent.ack>=2);assert.equal(ping(sim,'PC1'),2);assert.equal(ping(sim,'PC2'),2);assert.equal(lessonProgress(sim)!.complete,6);const dns=sim.resolveDNS('PC1','server.lab.example');sim.advance(1000);assert.equal(dns.address,'192.168.100.10');assert.equal(sim.getDevice('R1')!.startupConfig!.interfaces['GigabitEthernet0/0'].features.helpers[0],'192.168.100.10');
 for(const[name,commands]of Object.entries(catalogGuideResources('dhcp-server-and-relay')!.verification)){const cli=new IOSSession(sim,sim.getDevice(name)!.id);if(!cli.windowsMode)cli.execute('enable');for(const command of commands){const output=cli.execute(command).join('\n');assert.ok(!/not recognized|not implemented|% Invalid/i.test(output),command);if(command.startsWith('ping'))assert.match(output,/Received = 3/);}}
});
test('helper on the wrong interface, disabled service, wrong scope and missing server gateway each prevent fresh leases',()=>{
 for(const fault of ['wrong-interface','disabled','wrong-scope','no-return-route']){const sim=load();configure(sim);release(sim);const server=sim.getDevice('SRV1')!,router=sim.getDevice('R1')!;
  if(fault==='wrong-interface'){router.config.interfaces['GigabitEthernet0/0'].features.helpers=[];router.config.interfaces['GigabitEthernet0/1'].features.helpers=['192.168.100.10'];}else if(fault==='disabled')server.config.services.dhcp.enabled=false;else if(fault==='wrong-scope')server.config.services.dhcp.pools[0].network='192.168.20.0';else delete server.config.defaultGateway;sim.changed();assert.equal(request(sim).status,'failure',fault);assert.ok(leases(sim).every(r=>!r.complete),fault);
  server.config.defaultGateway='192.168.100.1';configure(sim);assert.equal(request(sim).status,'success',fault+' repair');assert.equal(ping(sim,'PC1'),2,fault+' traffic');
 }
});
test('a manually assigned address cannot earn a lease task, and altered options or released leases invalidate it',()=>{
 const sim=load();configure(sim);release(sim);const pc=sim.getDevice('PC1')!;Object.assign(pc.config.interfaces[port],{ip:'192.168.10.21',mask:'255.255.255.0'});pc.config.defaultGateway='192.168.10.1';pc.config.dnsServers=['192.168.100.10'];sim.changed();assert.equal(leases(sim)[0].complete,false);
 assert.equal(request(sim).status,'success');assert.equal(leases(sim)[0].complete,true);pc.config.dnsServers=[];assert.equal(leases(sim)[0].complete,false);pc.config.dnsServers=['192.168.100.10'];pc.config.defaultGateway='192.168.10.254';assert.equal(leases(sim)[0].complete,false);pc.config.defaultGateway='192.168.10.1';assert.equal(leases(sim)[0].complete,true);sim.stopAutomaticAddressing(pc.id,port,'ipv4');assert.equal(leases(sim)[0].complete,false);
});
test('completed DHCP configuration re-acquires delivered leases after save, reload and power cycles',()=>{
 const sim=load('completed');sim.advance(5000);assert.equal(lessonProgress(sim)!.complete,4);sim.getDevice('SRV1')!.config.hostname='DHCP-SERVER';sim.getDevice('PC1')!.config.hostname='Student';assert.equal(ping(sim,'device-dhcp-pc1'),2);assert.equal(ping(sim,'PC2'),2);assert.equal(lessonProgress(sim)!.complete,6);
 const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));assert.ok(leases(restored).every(r=>!r.complete),'imported runtime leases cannot be treated as received ACKs');restored.advance(6000);assert.equal(lessonProgress(restored)!.complete,6);for(const d of restored.lab.devices){restored.power(d.id,false);restored.power(d.id,true);}restored.advance(6000);assert.ok(leases(restored).every(r=>r.complete));assert.equal(ping(restored,'device-dhcp-pc1'),2);
});
test('DHCP predicates and actions reject invalid imported data and honor powered-source prerequisites',()=>{
 const doc=createCatalogLab('dhcp-server-and-relay'),original=(doc.lab as CatalogLab).lesson!;for(const c of original.objectives.map(o=>o.criterion))assert.doesNotThrow(()=>validateLesson({...original,objectives:[{id:'x',title:'x',criterion:c}]}));
 const invalid:any[]=[{kind:'dhcp-relay',device:'R1',interface:port,serverAddress:'invalid'},{...(original.objectives[0].criterion as Record<string,unknown>),prefix:33},{...(original.objectives[0].criterion as Record<string,unknown>),excludedEnd:'192.168.0.0'},{...(original.objectives[0].criterion as Record<string,unknown>),leaseSeconds:0},{...(original.objectives[2].criterion as Record<string,unknown>),dnsServer:'invalid'}];for(const criterion of invalid)assert.throws(()=>validateLesson({...original,objectives:[{id:'x',title:'x',criterion}]}),/invalid/);
 assert.throws(()=>validateLesson({...original,objectives:[{...original.objectives[2],action:{kind:'dhcp',device:'PC1',interface:()=>true}}]}),/invalid/);const sim=load();sim.power('PC1',false);assert.equal(actionAvailable(sim,leases(sim)[0].objective),false);assert.equal(matches(sim,{kind:'dhcp-lease',device:'missing',interface:port,server:'SRV1',network:'192.168.10.0',prefix:24,gateway:'192.168.10.1',dnsServer:'192.168.100.10'} as Criterion),false);
});
