import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {renderConfig} from '../src/config-renderer.ts';
import type {Device} from '../src/model.ts';
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(s=>/^%/.test(s)),`${line}: ${out.join('\n')}`);}}
function device(s:Simulator,hostname:string){const d=s.addDevice('router'),cli=new IOSSession(s,d.id);run(cli,'enable','conf t',`hostname ${hostname}`);return {d,cli};}
function intf(c:IOSSession,name:string,vrf:string,address:string){run(c,`vrf definition ${vrf}`,'exit',`interface ${name}`,`vrf forwarding ${vrf}`,`ip address ${address} 255.255.255.0`,'no shutdown','exit');}
function connect(s:Simulator,a:Device,pa:string,b:Device,pb:string){s.connect({deviceId:a.id,port:pa},{deviceId:b.id,port:pb});}
function process(c:IOSSession,protocol:string,vrf:string,asn=100){run(c,protocol==='eigrp'?'router eigrp CAMPUS':'router rip',`address-family ipv4 vrf ${vrf}${protocol==='eigrp'?' autonomous-system '+asn:''}`,'network 10.0.0.0','network 192.0.2.0','exit-address-family','exit');}
for(const protocol of ['eigrp','rip'])test(`${protocol.toUpperCase()} VRF address families isolate overlapping prefixes, policy, packets and persisted configuration`,()=>{
 const s=new Simulator(protocol==='eigrp'?501:502),a=device(s,'PE'),b=device(s,'CE-B'),c=device(s,'CE-R');
 intf(a.cli,'g0/0','BLUE','10.0.0.1');intf(a.cli,'g0/1','RED','10.0.0.1');intf(b.cli,'g0/0','CUSTOMER','10.0.0.2');intf(c.cli,'g0/0','SITE','10.0.0.2');intf(b.cli,'loop0','CUSTOMER','192.0.2.1');intf(c.cli,'loop0','SITE','192.0.2.1');
 process(a.cli,protocol,'BLUE',100);process(a.cli,protocol,'RED',200);process(b.cli,protocol,'CUSTOMER',100);process(c.cli,protocol,'SITE',200);for(const q of[a,b,c])run(q.cli,'end');
 connect(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');connect(s,a.d,'GigabitEthernet0/1',c.d,'GigabitEthernet0/0');s.advance(3000);
 const code=protocol==='eigrp'?'D':'R',routes=()=>a.d.runtime.routes.filter(r=>r.protocol===code&&r.network==='192.0.2.0');assert.deepEqual(routes().map(r=>r.vrf).sort(),['BLUE','RED']);assert.equal(routes().find(r=>r.vrf==='BLUE')?.interface,'GigabitEthernet0/0');assert.equal(routes().find(r=>r.vrf==='RED')?.interface,'GigabitEthernet0/1');assert.ok(!routes().some(r=>!r.vrf));
 for(const vrf of ['BLUE','RED']){const p=s.ping(a.d.id,'192.0.2.1',{count:1,vrf});s.advance(1000);assert.equal(p.received,1,`${protocol} ${vrf} ping`);}
 run(a.cli,'conf t','ip prefix-list BLOCK deny 192.0.2.0/24','ip prefix-list BLOCK permit 0.0.0.0/0 le 32',protocol==='eigrp'?'router eigrp CAMPUS':'router rip','address-family ipv4 vrf BLUE'+(protocol==='eigrp'?' autonomous-system 100':''),'distribute-list prefix BLOCK in','end');s.advance(2000);assert.deepEqual(routes().map(r=>r.vrf),['RED']);
 const text=renderConfig(a.d).join('\n');assert.match(text,/address-family ipv4 vrf BLUE/);assert.match(text,/address-family ipv4 vrf RED/);const restored=device(s,'RESTORE');run(restored.cli,'end');restored.d.config.features.files={'restore.cfg':text};const output=restored.cli.execute('copy flash:restore.cfg running-config');assert.ok(!output.some(s=>s.startsWith('%')),output.join('\n'));assert.deepEqual(restored.d.config.protocols[protocol].vrfs,a.d.config.protocols[protocol].vrfs);
 if(protocol==='rip'){assert.deepEqual(new Set(a.d.runtime.features.ripDatabase.map((r:any)=>r.vrf)),new Set(['BLUE','RED']));run(a.cli,'conf t','router rip','no address-family ipv4 vrf BLUE','end');s.advance(100);assert.ok(a.d.runtime.features.ripDatabase.some((r:any)=>r.vrf==='RED'));assert.ok(!a.d.runtime.features.ripDatabase.some((r:any)=>r.vrf==='BLUE'));}
});

test('EIGRP overlapping same-device peers retain independent authentication and DUAL query/reply state',()=>{
 const s=new Simulator(503),a=device(s,'A'),b=device(s,'B');for(const q of[a,b]){const host=q===a?1:2;intf(q.cli,'g0/0','BLUE',`10.0.0.${host}`);intf(q.cli,'g0/1','RED',`10.0.0.${host}`);if(q===b){intf(q.cli,'loop0','BLUE','192.0.2.1');intf(q.cli,'loop1','RED','192.0.2.1');}process(q.cli,'eigrp','BLUE',100);process(q.cli,'eigrp','RED',200);run(q.cli,'end');}connect(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');connect(s,a.d,'GigabitEthernet0/1',b.d,'GigabitEthernet0/1');s.advance(1000);
 const routes=()=>a.d.runtime.routes.filter(r=>r.protocol==='D'&&r.network==='192.0.2.0');assert.equal(routes().length,2);
 const before=s.events.length;run(b.cli,'conf t','interface loop0','no ip address','end');s.advance(1000);assert.deepEqual(routes().map(r=>r.vrf),['RED']);assert.ok(a.d.runtime.features.eigrpTraffic.sent.query>0);assert.ok(b.d.runtime.features.eigrpTraffic.sent.reply>0);assert.ok(!a.d.runtime.features.eigrpTopology.some((r:any)=>r.vrf==='RED'&&r.state==='ACTIVE'));
 run(b.cli,'conf t','interface loop0','ip address 192.0.2.1 255.255.255.0','end');s.advance(6000);assert.equal(routes().length,2);
 run(a.cli,'conf t','key chain KEYS','key 1','key-string BLUEKEY','end','conf t','interface g0/0','ip authentication mode eigrp 100 md5','ip authentication key-chain eigrp 100 KEYS','end');s.advance(1000);assert.deepEqual(routes().map(r=>r.vrf),['RED']);assert.equal(a.d.runtime.neighbors.find(n=>n.protocol==='EIGRP'&&n.interface==='GigabitEthernet0/0')?.state,'AUTH-FAILED');assert.equal(a.d.runtime.neighbors.find(n=>n.protocol==='EIGRP'&&n.interface==='GigabitEthernet0/1')?.state,'UP');
 run(b.cli,'conf t','key chain KEYS','key 1','key-string BLUEKEY','end','conf t','interface g0/0','ip authentication mode eigrp 100 md5','ip authentication key-chain eigrp 100 KEYS','end');s.advance(1000);assert.equal(routes().length,2);
});

test('RIP VRF-specific update and invalid timers expire one route while another remains valid',()=>{
 const s=new Simulator(504),a=device(s,'A'),b=device(s,'B');for(const q of[a,b]){const host=q===a?1:2;intf(q.cli,'g0/0','BLUE',`10.0.0.${host}`);intf(q.cli,'g0/1','RED',`10.0.0.${host}`);if(q===b){intf(q.cli,'loop0','BLUE','192.0.2.1');intf(q.cli,'loop1','RED','192.0.2.1');}process(q.cli,'rip','BLUE');process(q.cli,'rip','RED');run(q.cli,'router rip','address-family ipv4 vrf BLUE','timers basic 1 3 1 5','exit-address-family','address-family ipv4 vrf RED','timers basic 1 30 1 35','end');}connect(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');connect(s,a.d,'GigabitEthernet0/1',b.d,'GigabitEthernet0/1');s.advance(2000);
 const routes=()=>a.d.runtime.routes.filter(r=>r.protocol==='R'&&r.network==='192.0.2.0');assert.equal(routes().length,2);assert.equal(a.d.runtime.features.ripStatsByVrf.BLUE.timers.invalid,3000);assert.equal(a.d.runtime.features.ripStatsByVrf.RED.timers.invalid,30000);
 run(b.cli,'conf t','router rip','address-family ipv4 vrf BLUE','passive-interface g0/0','exit-address-family','address-family ipv4 vrf RED','passive-interface g0/1','end');s.advance(4000);assert.deepEqual(routes().map(r=>r.vrf),['RED']);assert.ok(a.d.runtime.features.ripDatabase.some((r:any)=>r.vrf==='BLUE'&&r.status==='invalid'));
});

test('OSPF VRF processes isolate overlapping neighbors, LSDBs, timers and installed routes',()=>{
 const s=new Simulator(505),a=device(s,'A'),b=device(s,'B');for(const q of[a,b]){const host=q===a?1:2;for(const[port,vrf,id]of[['g0/0','BLUE',10],['g0/1','RED',20]] as const){intf(q.cli,port,vrf,`10.0.0.${host}`);run(q.cli,`router ospf ${id} vrf ${vrf}`,`router-id ${id}.${id}.${id}.${host}`,'network 0.0.0.0 255.255.255.255 area 0','exit');}if(q===b){intf(q.cli,'loop0','BLUE','192.0.2.1');intf(q.cli,'loop1','RED','192.0.2.1');}run(q.cli,'end');}connect(s,a.d,'GigabitEthernet0/0',b.d,'GigabitEthernet0/0');connect(s,a.d,'GigabitEthernet0/1',b.d,'GigabitEthernet0/1');s.advance(12000);
 const routes=()=>a.d.runtime.routes.filter(r=>r.protocol==='O'&&r.network==='192.0.2.0');assert.deepEqual(routes().map(r=>r.vrf).sort(),['BLUE','RED']);assert.ok(a.d.runtime.features.ospfPackets['ospf:BLUE'].neighbors.every((n:any)=>n.routerId==='10.10.10.2'));assert.ok(a.d.runtime.features.ospfPackets['ospf:RED'].neighbors.every((n:any)=>n.routerId==='20.20.20.2'));
 for(const vrf of['BLUE','RED']){const ping=s.ping(a.d.id,'192.0.2.1',{vrf,count:1});s.advance(1000);assert.equal(ping.received,1);}
 run(a.cli,'conf t','router ospf 10 vrf BLUE','shutdown','end');s.advance(45000);assert.deepEqual(routes().map(r=>r.vrf),['RED']);assert.match(renderConfig(a.d).join('\n'),/router ospf 10 vrf BLUE/);
});
