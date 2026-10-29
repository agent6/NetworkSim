import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {natLab,replayNAT} from '../scripts/cml/nat_replay.ts';
import {iosRejected} from '../src/ios-help.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {Simulator} from '../src/engine.ts';
import {createCLISession} from '../src/session.ts';
const native=JSON.parse(readFileSync('scripts/cml/fixtures/nat-observations.json','utf8'));
const normalizedTable=(lines:string[])=>lines.filter(l=>/^(---|any|icmp|udp|tcp)\s/.test(l)).map(line=>{
 const fields=line.trim().split(/\s+/);if(fields[0]==='icmp')return fields.map(f=>f.replace(/:\d+$/,':<icmp-id>')).join(' ');
 if(['tcp','udp'].includes(fields[0])&&fields[1].startsWith('203.0.113.1:'))fields[1]='203.0.113.1:<pat-port>';return fields.join(' ');
}).sort();
test('CML NAT scenario replays every command, confirmation, real receiver tuple and negative flow',()=>{
 const result=replayNAT(JSON.parse(readFileSync('scripts/cml/nat/scenario.json','utf8')));
 assert.equal(result.steps.length,47);assert.deepEqual(result.steps.filter(r=>!r.passed),[]);
 assert.equal(result.receipts.filter(r=>r.token==='ios-pat-unsolicited').length,0);
 assert.ok(result.receipts.some(r=>r.token==='ios-pat-first-udp'&&r.source==='203.0.113.1'&&r.sourcePort!==44083));
 assert.ok(result.receipts.some(r=>r.token==='ios-dynamic-fresh-in'&&r.destination==='192.168.10.10'));
 assert.equal(result.receipts.filter(r=>r.token==='ios-dynamic-exhausted').length,0);
 for(const contract of native.iosTableContracts){const step=result.steps.find(s=>s.id===contract.id)!;assert.deepEqual(normalizedTable(step.commands.find((c:any)=>c.command===contract.command).output),contract.rows,contract.id);}
});
test('Reviewed native evidence preserves failed candidates and proves every supported Nexus traffic probe',()=>{
 assert.equal(native.nxPositiveProbes.length,24);assert.ok(native.nxPositiveProbes.every((r:any)=>r.reviewedTrafficPassed));assert.ok(native.nxBasicDynamicExcluded.probes.some((r:any)=>!r.passed));
 assert.ok(native.nativeRuns.every((r:any)=>r.labStopped&&r.unrelatedUserLabState==='STARTED'&&r.captures.length===4&&r.captures.every((c:any)=>/^[a-f0-9]{64}$/.test(c.sha256))));assert.equal(native.wireEvidence.passed,true);
 const replay=replayNAT(JSON.parse(readFileSync('scripts/cml/nat/nx-scenario.json','utf8')));assert.equal(replay.steps.length,30);assert.deepEqual(replay.steps.filter(s=>!s.passed),[]);
 for(const reference of native.nxPositiveProbes){const receipt=replay.receipts.find(r=>r.token===reference.spec.token);if(reference.spec.protocol!=='icmp')assert.ok(receipt,reference.spec.token);}
});
test('NX-OS static NAT gates the feature, forwards both ways and reports native any mappings and real directional counters',()=>{
 const {engine:e,nodes:n,cli}=natLab(),c=cli.NX;
 const run=(...lines:string[])=>{for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+': '+out.join('\n'));}};
 run('configure terminal');const before=JSON.stringify(n.NX.config);assert.ok(c.execute('ip nat inside source static 192.168.20.10 198.51.100.10').some(iosRejected));assert.equal(JSON.stringify(n.NX.config),before);
 run('feature nat','interface Ethernet1/1','ip nat inside','interface Ethernet1/2','ip nat outside','ip nat inside source static 192.168.20.10 198.51.100.10','end');
 for(const incoming of [false,true])for(const protocol of ['udp','tcp','icmp']){
  const from=incoming?n.O2:n.I2,target=incoming?'198.51.100.10':'198.51.100.100';
  if(protocol==='icmp'){const ping=e.ping(from.id,target,{count:1});e.advance(1100);assert.equal(ping.received,1);}
  else{const args=[from.id,target,protocol==='udp'?9000:9001,{token:'nx-static'},{sourcePort:44410,timeout:1000}] as const,r=protocol==='udp'?e.udpRequest(...args):e.tcpRequest(...args);e.advance(1100);assert.equal(r.status,'success');assert.equal(r.source,incoming?'198.51.100.100':'198.51.100.10');assert.equal(r.destination,incoming?'192.168.20.10':'198.51.100.100');}
 }
 const table=c.execute('show ip nat translations verbose').join('\n');assert.match(table,/any\s+198\.51\.100\.10\s+192\.168\.20\.10/);assert.match(table,/Time-left :0:0:-1/);assert.doesNotMatch(table,/^(udp|tcp|icmp) /m);
 const stats=n.NX.runtime.features.natStats;assert.ok(stats.inOut>0&&stats.outIn>0);assert.equal(stats.hits,stats.inOut+stats.outIn);assert.equal(stats.misses,0);
 assert.match(c.execute('show ip nat statistics').join('\n'),/Total active translations: 1/);assert.match(c.execute('show ip nat-alias').join('\n'),/198\.51\.100\.10\s+Ethernet1\/2/);
 assert.equal(c.complete('show ip nat translations ver'),'show ip nat translations verbose ');assert.match(c.help('show ip nat ').join('\n'),/translations/);
 run('copy running-config startup-config');const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(e.serialize())));const other=createCLISession(restored,n.NX.id,{skipConsoleLogin:true});assert.match(other.execute('show running-config nat').join('\n'),/ip nat inside source static/);
 for(const mutate of [(d:any)=>d.config.features.nsos.enabled.splice(d.config.features.nsos.enabled.indexOf('nat'),1),(d:any)=>d.config.features.nat.rules.push({acl:'MISSING',interface:'Ethernet1/2',overload:true}),(d:any)=>d.config.interfaces['Ethernet1/1'].switchport=true]){
  const exported=structuredClone(e.serialize());mutate(exported.lab.devices.find(d=>d.id===n.NX.id));assert.throws(()=>parseLabFile(serializeLabFile(exported)));
 }
 run('configure terminal','vrf context RED','exit','interface Ethernet1/1');const beforePort=JSON.stringify(n.NX.config);
 for(const command of ['switchport','vrf member RED','channel-group 1 mode on']){assert.ok(c.execute(command).some(iosRejected),command);assert.equal(JSON.stringify(n.NX.config),beforePort);}
 run('end');
 // Every line emitted by the NX-specific NVGEN is accepted by its own parser.
 const target=natLab();target.cli.NX.execute('configure terminal');for(const line of c.execute('show running-config').filter(l=>!l.startsWith('!'))){const out=target.cli.NX.execute(line);assert.ok(!out.some(iosRejected),line+': '+out.join('\n'));}
 run('configure terminal','no feature nat','end');assert.doesNotMatch(c.execute('show running-config nat').join('\n'),/ip nat/);
});
for(const pool of [false,true])test(`NX-OS ${pool?'pool':'interface'} PAT forwards three colliding hosts with native tables, policy confirmation and persistent configuration`,()=>{
 const {engine:e,nodes:n,cli}=natLab(),c=cli.NX,run=(...lines:string[])=>{for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+': '+out.join('\n'));}};
 const rule='ip nat inside source list NAT-INSIDE '+(pool?'pool PUBLIC':'interface Ethernet1/2')+' overload';
 run('configure terminal','feature nat','interface Ethernet1/1','ip nat inside','interface Ethernet1/2','ip nat outside','ip access-list NAT-INSIDE','10 permit ip 192.168.20.0/24 any','exit',...pool?['ip nat pool PUBLIC 198.51.100.10 198.51.100.11 prefix-length 24']:[],rule,'end');
 for(const protocol of ['udp','tcp','icmp'])for(const host of [10,11,12]){
  const source='192.168.20.'+host;
  if(protocol==='icmp'){const p=e.ping(n.I2.id,'198.51.100.100',{source,count:1});e.advance(1100);assert.equal(p.received,1);}
  else{const args=[n.I2.id,'198.51.100.100',protocol==='udp'?9000:9001,{token:`nx-${protocol}-${host}`},{source,sourcePort:44500,timeout:1000}] as const,r=protocol==='udp'?e.udpRequest(...args):e.tcpRequest(...args);e.advance(1100);assert.equal(r.status,'success');assert.ok((pool?['198.51.100.10','198.51.100.11']:['198.51.100.1']).includes(r.source));assert.notEqual(r.sourcePort,44500);}
 }
 const rows=n.NX.runtime.features.natTranslations;assert.equal(rows.length,9);assert.equal(n.NX.runtime.features.natFlows?.length??0,0);assert.equal(new Set(rows.map((x:any)=>x.protocol+':'+x.outsidePort)).size,9);
 assert.match(c.execute('show ip nat statistics').join('\n'),/No.Dyn:\s+9/);assert.match(c.execute('show ip nat statistics').join('\n'),/No.Dyn-ICMP:\s+3/);assert.match(c.execute('show ip nat translations').join('\n'),/icmp\s+198\.51\.100\.[0-9]+:[0-9]+\s+192\.168\.20\.[0-9]+:[0-9]+\s+198\.51\.100\.100:0\s+198\.51\.100\.100:0/);
 assert.match(c.execute('show running-config nat').join('\n'),new RegExp(rule.replaceAll('.','\\.')));
 run('copy running-config startup-config');const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(e.serialize())));assert.deepEqual(restored.getDevice(n.NX.id)!.config.features.nat,n.NX.config.features.nat);
 run('configure terminal');let before=JSON.stringify(n.NX.config);assert.ok(c.execute('ip nat inside source list NAT-INSIDE pool PUBLIC').some(iosRejected));assert.equal(JSON.stringify(n.NX.config),before);
 if(pool){assert.ok(c.execute('no ip nat pool PUBLIC').some(iosRejected));assert.ok(c.execute('ip nat pool PUBLIC 198.51.100.20 198.51.100.21 prefix-length 24').some(iosRejected));}
 run('no '+rule);assert.match(c.prompt,/Removing the list.*\[n\]/);run('');assert.equal(n.NX.runtime.features.natTranslations.length,9);assert.equal(n.NX.config.features.nat.rules.length,1);
 run('no '+rule,'y');assert.equal(n.NX.runtime.features.natTranslations.length,0);assert.equal(n.NX.config.features.nat.rules.length,0);
 run(rule,'end');const p=e.ping(n.I2.id,'198.51.100.100',{count:1});e.advance(1100);assert.equal(p.received,1);run('clear ip nat translation all');assert.equal(n.NX.runtime.features.natTranslations.length,0);
 const target=natLab();target.cli.NX.execute('configure terminal');for(const line of c.execute('show running-config').filter(l=>!l.startsWith('!'))){const out=target.cli.NX.execute(line);assert.ok(!out.some(iosRejected),line+': '+out.join('\n'));}
});
