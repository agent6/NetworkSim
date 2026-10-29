import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {NSOSSession} from '../src/nsos.ts';
import {iosRejected} from '../src/ios-help.ts';
import {serializeLabFile,parseLabFile} from '../src/persistence.ts';
const g=(n:number)=>'GigabitEthernet0/'+n;
function ok(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+': '+out.join('\n'));}}
export function natFixture(){
 const e=new Simulator(684525),r=e.addDevice('router'),inside=e.addDevice('pc'),outside=e.addDevice('server'),c=new IOSSession(e,r.id);
 e.connect({deviceId:inside.id,port:'GigabitEthernet0'},{deviceId:r.id,port:g(0)});e.connect({deviceId:r.id,port:g(1)},{deviceId:outside.id,port:'GigabitEthernet0'});
 Object.assign(inside.config.interfaces.GigabitEthernet0,{ip:'192.168.10.10',mask:'255.255.255.0',adminUp:true});inside.config.interfaces.GigabitEthernet0.features.secondaryIps=[{ip:'192.168.10.11',mask:'255.255.255.0'},{ip:'192.168.10.12',mask:'255.255.255.0'}];inside.config.defaultGateway='192.168.10.1';
 Object.assign(outside.config.interfaces.GigabitEthernet0,{ip:'203.0.113.100',mask:'255.255.255.0',adminUp:true});outside.config.interfaces.GigabitEthernet0.features.secondaryIps=[{ip:'203.0.113.101',mask:'255.255.255.0'}];
 delete inside.config.interfaces.GigabitEthernet0.features.dhcp;delete outside.config.interfaces.GigabitEthernet0.features.dhcp;
 ok(c,'enable','conf t','int g0/0','ip address 192.168.10.1 255.255.255.0','ip nat inside','no shut','int g0/1','ip address 203.0.113.1 255.255.255.0','ip nat outside','no shut','exit','access-list 1 permit 192.168.10.0 0.0.0.255','end');
 e.registerUDPService(9000,d=>[inside.id,outside.id].includes(d.id),(d,p,source,destination)=>({ok:true,source,destination,token:p.token}));e.registerTCPService(9001,d=>[inside.id,outside.id].includes(d.id),(d,p,source,destination)=>({ok:true,source,destination,token:p.token}));
 const request=(protocol:'udp'|'tcp',source='192.168.10.10',target='203.0.113.100',port?:number)=>{const from=source.startsWith('192.')?inside:outside,result=protocol==='udp'?e.udpRequest(from.id,target,port??9000,{token:'probe'},{source,sourcePort:44000,timeout:2000}):e.tcpRequest(from.id,target,port??9001,{token:'probe'},{source,timeout:2000});e.advance(2500);return result;};
 return {e,r,inside,outside,c,request,show:(command='show ip nat translations')=>c.execute(command).join('\n')};
}
test('NAT static translates real bidirectional ICMP/UDP/TCP and creates extended children beneath its permanent entry',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat inside source static 192.168.10.10 203.0.113.10','end');assert.match(f.show(),/---\s+203\.0\.113\.10\s+192\.168\.10\.10/);
 for(const protocol of ['udp','tcp'] as const){const out=f.request(protocol);assert.equal(out.status,'success');assert.equal(out.source,'203.0.113.10');const input=f.request(protocol,'203.0.113.100','203.0.113.10');assert.equal(input.status,'success');assert.equal(input.destination,'192.168.10.10');}
 const ping=f.e.ping(f.inside.id,'203.0.113.100',{count:1});f.e.advance(1500);assert.equal(ping.received,1);
 const table=f.show();for(const protocol of ['udp','tcp','icmp'])assert.match(table,new RegExp(protocol+'\\s+203\\.0\\.113\\.10:'));assert.equal(f.r.runtime.features.natTranslations?.length??0,0);assert.equal(f.r.runtime.features.natFlows.length,5);
 assert.match(f.show('show ip nat statistics'),/6 \(1 static, 5 dynamic; 5 extended\)/);ok(f.c,'clear ip nat translation *');assert.equal(f.r.runtime.features.natFlows.length,0);assert.match(f.show(),/---\s+203\.0\.113\.10/);
});
test('NAT dynamic uses one allocation per host, records child flows, rejects a third host when its pool is exhausted',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat pool PUBLIC 203.0.113.10 203.0.113.11 netmask 255.255.255.0','ip nat inside source list 1 pool PUBLIC','end');
 assert.equal(f.request('udp').source,'203.0.113.10');assert.equal(f.request('tcp').source,'203.0.113.10');assert.equal(f.request('udp','192.168.10.11').source,'203.0.113.11');assert.equal(f.r.runtime.features.natTranslations.length,2);
 assert.equal(f.request('udp','192.168.10.12').status,'failure');assert.equal(f.r.runtime.features.natStats.poolMisses.PUBLIC,1);assert.match(f.show('show ip nat statistics'),/allocated 2 \(100%\), misses 1/);assert.equal(f.r.runtime.features.natStats.misses,0);
 assert.equal(f.request('udp','203.0.113.101','203.0.113.10').status,'success','Whole-address allocation permits an independent inbound flow');assert.match(f.show('show ip nat translations verbose'),/left 23:59:/);
});
test('NAT allocation ACL absence does not translate, an existing binding does not re-run its allocation classifier',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat pool PUBLIC 203.0.113.10 203.0.113.11 netmask 255.255.255.0','ip nat inside source list MISSING pool PUBLIC','end');f.request('udp');assert.equal(f.r.runtime.features.natTranslations.length,0);
 ok(f.c,'conf t','no ip nat inside source list MISSING pool PUBLIC','ip nat inside source list 1 pool PUBLIC','end');assert.equal(f.request('udp').status,'success');const hits=f.r.runtime.features.aclHits['1:10'];assert.equal(f.request('tcp').status,'success');assert.equal(f.r.runtime.features.aclHits['1:10'],hits);
});
test('NAT PAT keeps independent collision-safe tuples and translates ICMP identifiers on both wires',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat inside source list 1 interface g0/1 overload','end');assert.equal(f.request('udp').status,'success');assert.equal(f.request('udp','192.168.10.11').status,'success');assert.equal(f.request('udp','192.168.10.10','203.0.113.101').status,'success');
 const udp=f.r.runtime.features.natTranslations;assert.equal(new Set(udp.map((x:any)=>x.outsidePort)).size,3);assert.ok(udp.every((x:any)=>x.outside==='203.0.113.1'));
 const p=f.e.ping(f.inside.id,'203.0.113.100',{count:1});f.e.advance(1000);assert.equal(p.received,1);
 const request=f.e.events.findLast(ev=>ev.nodeId===f.outside.id&&ev.packet?.icmpType===8&&ev.label==='Frame received')!.packet!,reply=f.e.events.findLast(ev=>ev.nodeId===f.inside.id&&ev.packet?.icmpType===0&&ev.label==='Frame received')!.packet!;
 const mapping=f.r.runtime.features.natTranslations.find((x:any)=>x.protocol==='icmp');assert.equal(request.icmpIdentifier,mapping.outsidePort);assert.equal(reply.icmpIdentifier,mapping.insidePort);assert.notEqual(mapping.insidePort,mapping.outsidePort);
 assert.match(f.show('show ip nat translations icmp'),new RegExp(`203\\.0\\.113\\.100:${mapping.insidePort}\\s+203\\.0\\.113\\.100:${mapping.outsidePort}`));
});
test('NAT clear and separate generic/flow timers release actual bindings and preserve static configuration',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat pool PUBLIC 203.0.113.10 203.0.113.10 netmask 255.255.255.0','ip nat inside source list 1 pool PUBLIC','ip nat translation timeout 4','ip nat translation udp-timeout 4','end');assert.equal(f.request('udp').status,'success');assert.equal(f.r.runtime.features.natTranslations.length,1);f.e.advance(5000);assert.equal(f.r.runtime.features.natTranslations.length,0);assert.equal(f.r.runtime.features.natFlows.length,0);assert.equal(f.r.runtime.features.natStats.expired,2);
 const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(f.e.serialize())));assert.deepEqual(restored.getDevice(f.r.id)!.config.features.nat.timeouts,{generic:4,udp:4});assert.match(f.show('show running-config | include ip nat'),/ip nat translation timeout 4/);
});
test('NAT CLI rejects conflicting statics and live mapping removal transactionally, and help exposes verbose and generic timers',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat inside source static 192.168.10.10 203.0.113.10');for(const command of ['ip nat inside source static 192.168.10.10 203.0.113.11','ip nat inside source static 192.168.10.11 203.0.113.10','ip nat pool BAD 203.0.113.10 203.0.114.10 netmask 255.255.255.0']){const before=JSON.stringify(f.r.config);assert.ok(f.c.execute(command).some(iosRejected));assert.equal(JSON.stringify(f.r.config),before);}
 ok(f.c,'no ip nat inside source static 192.168.10.10 203.0.113.10','ip nat pool PUBLIC 203.0.113.10 203.0.113.11 netmask 255.255.255.0','ip nat inside source list 1 pool PUBLIC','end');f.request('udp');ok(f.c,'conf t');for(const command of ['no ip nat inside source list 1 pool PUBLIC','no ip nat pool PUBLIC']){const before=JSON.stringify(f.r.config);assert.ok(f.c.execute(command).some(iosRejected));assert.equal(JSON.stringify(f.r.config),before);}ok(f.c,'end','clear ip nat translation *','conf t','no ip nat inside source list 1 pool PUBLIC','no ip nat pool PUBLIC','end');
 assert.match(f.c.help('show ip nat translations ').join('\n'),/verbose/);assert.equal(f.c.complete('show ip nat translations ver'),'show ip nat translations verbose ');ok(f.c,'conf t');assert.match(f.c.help('ip nat translation ').join('\n'),/timeout/);
});
test('NAT debug is driven by actual static translation and closed TCP children use the native short timeout',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat inside source static 192.168.10.10 203.0.113.10','end','debug ip nat');assert.equal(f.request('tcp').status,'success');assert.ok(f.r.runtime.features.debugEntries.some((x:any)=>/NAT: s=192\.168\.10\.10->203\.0\.113\.10/.test(x.message)));assert.match(f.show('show ip nat translations verbose'),/extended, timing-out/);f.e.advance(61000);assert.equal(f.r.runtime.features.natFlows.length,0);assert.match(f.show(),/---/);
});
test('NS-OS rejects NAT configuration before its feature is enabled',()=>{
 const e=new Simulator(),d=e.addDevice('datacenter'),c=new NSOSSession(e,d.id,{skipConsoleLogin:true});c.execute('conf t');for(const command of ['ip nat inside source static 192.0.2.1 198.51.100.1','ip nat pool PUBLIC 198.51.100.10 198.51.100.20 netmask 255.255.255.0']){const before=JSON.stringify(d.config);assert.ok(c.execute(command).some(iosRejected));assert.equal(JSON.stringify(d.config),before);}
});
test('NAT ICMP error quotes restore the inside address and translated transport identifier',()=>{
 for(const overload of [false,true]){
  const f=natFixture();ok(f.c,'conf t',overload?'ip nat inside source list 1 interface g0/1 overload':'ip nat inside source static 192.168.10.10 203.0.113.10','end');const r=f.e.udpRequest(f.inside.id,'203.0.113.100',9999,{}, {sourcePort:44040});f.e.advance(1000);assert.equal(r.status,'failure');assert.match(r.error!,/Port unreachable/);
  const error=f.e.events.findLast(ev=>ev.nodeId===f.inside.id&&ev.packet?.icmpQuoted&&ev.label==='Frame received')!.packet!;assert.equal(error.destination,'192.168.10.10');assert.equal(error.icmpQuoted!.source,'192.168.10.10');assert.equal(error.icmpQuoted!.sourcePort,44040);
 }
});
test('NAT static live deletion asks the native confirmation; default no preserves children and yes removes them',()=>{
 const f=natFixture();ok(f.c,'conf t','ip nat inside source static 192.168.10.10 203.0.113.10','end');f.request('udp');ok(f.c,'conf t','no ip nat inside source static 192.168.10.10 203.0.113.10');assert.match(f.c.prompt,/Static entry in use.*\[no\]:/);ok(f.c,'');assert.equal(f.r.config.features.nat.static.length,1);assert.equal(f.r.runtime.features.natFlows.length,1);ok(f.c,'no ip nat inside source static 192.168.10.10 203.0.113.10','yes');assert.equal(f.r.config.features.nat.static.length,0);assert.equal(f.r.runtime.features.natFlows.length,0);assert.equal(f.c.mode,'config');
});
