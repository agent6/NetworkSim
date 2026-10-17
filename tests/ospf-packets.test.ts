import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { defaultInterface, type Device } from '../src/model.ts';
import { syncOSPF, receiveOSPFControl, ospfDatabaseView, verifiedOSPFAdjacency, type OSPFHost, type OSPFSnapshot, type OSPFInterface } from '../src/ospf-packets.ts';
const port = 'GigabitEthernet0/0';
function network(count = 2) {
 const s = new Simulator(220), devices = Array.from({length:count},()=>s.addDevice('router'));
 for(let i=0;i<count;i++) { const d=devices[i]; for(let n=0;n<2;n++) { const p=d.config.interfaces['GigabitEthernet0/'+n];p.adminUp=true;p.ip=`10.${i+n}.0.${n?1:2}`;p.mask='255.255.255.0'; } }
 for(let i=0;i<count-1;i++) s.connect({deviceId:devices[i].id,port:'GigabitEthernet0/1'},{deviceId:devices[i+1].id,port});
 const host:OSPFHost={clock:s.clock,getDevice:id=>s.getDevice(id),interfaceUp:(id,p)=>s.interfaceUp(id,p),emit:e=>s.emit(e),recompute(){},notify(){},sendControlDatagram:(...args)=>s.sendControlDatagram(...args)};
 const deliver=(s as any).deliverService.bind(s);(s as any).deliverService=(d:Device,p:any,input?:string)=>{if(p.body?.payload?.protocol==='ospf-packets')receiveOSPFControl(host,d.id,p.source,p.destination,p.body.payload,p.ttl,input);else deliver(d,p,input);};
 const interfaces:OSPFInterface[]=devices.flatMap((d,i)=>[0,1].filter(n=>n===0?i>0:i<count-1).map(n=>({deviceId:d.id,name:'GigabitEthernet0/'+n,node:d.id,address:d.config.interfaces['GigabitEthernet0/'+n].ip!,prefix:24,family:4,routerId:`${i+1}.${i+1}.${i+1}.${i+1}`,area:'0',helloInterval:1,deadInterval:4,mtu:1500,snapshot:{deviceConfig:structuredClone(d.config),interfaceConfig:structuredClone(d.config.interfaces['GigabitEthernet0/'+n])}})));
 const candidates=interfaces.flatMap(a=>interfaces.filter(b=>a!==b&&a.address.split('.').slice(0,3).join('.')===b.address.split('.').slice(0,3).join('.')).map(b=>({from:a,to:b,area:'0',cost:1,bandwidth:1000,delay:10})));
 const snapshot:OSPFSnapshot={protocol:'ospf',interfaces,candidates,origins:devices.map((d,i)=>({endpoint:interfaces.find(p=>p.deviceId===d.id)!,kind:'prefix',network:`192.0.${i}.0`,prefix:24,cost:1})),refreshInterval:6,maxAge:15};
 syncOSPF(host,snapshot);return {s,host,devices,snapshot};
}
test('OSPF databases and Full adjacency require actual Hello and database exchange packets',()=>{
 const {s,host,devices:[a,b]}=network();assert.equal(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'DOWN');assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.length,1);s.advance(500);
 assert.equal(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'FULL');assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.length,2);assert.ok(s.events.some(e=>e.packet?.protocol==='OSPF'));assert.equal(s.clock.advance(0).budgetExhausted,false);
});
test('OSPF floods a remote changed prefix hop by hop and retains learned snapshots until receipt',()=>{
 const {s,host,devices:[a,,c],snapshot}=network(3);s.advance(500);assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.length,3);s.lab.links[1].delay=100;
 snapshot.origins.find(o=>o.endpoint.deviceId===c.id)!.network='198.51.100.0';syncOSPF(host,snapshot);assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.some(p=>p.network==='198.51.100.0'),false);s.advance(50);assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.some(p=>p.network==='198.51.100.0'),false);s.advance(500);assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.some(p=>p.network==='198.51.100.0'),true);
});
test('OSPF actual one-way Hello loss expires neighbors and recovers through a new exchange',()=>{
 const {s,host,devices:[a,b]}=network();s.advance(500);s.lab.links[0].lossAB=1;s.advance(5000);assert.notEqual(verifiedOSPFAdjacency(host,'ospf',b.id,port,a.id,'GigabitEthernet0/1'),'FULL');assert.notEqual(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'FULL');s.lab.links[0].lossAB=0;s.advance(2000);assert.equal(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'FULL');
});
test('OSPF retransmits an unacknowledged LSA and expires unreachable advertisements at MaxAge',()=>{
 const {s,host,devices:[a,b],snapshot}=network();s.advance(500);const send=s.sendControlDatagram.bind(s);let dropped=false;(s as any).sendControlDatagram=(...args:any[])=>{if(args[0]===a.id&&args[4]?.type==='ack'&&!dropped){dropped=true;return;}return(send as any)(...args);};snapshot.origins[1].network='203.0.113.0';syncOSPF(host,snapshot);s.advance(1500);assert.equal(dropped,true);assert.ok(b.runtime.features.ospfPackets.ospf.neighbors[0].retransmissions>0);assert.equal(b.runtime.features.ospfPackets.ospf.neighbors[0].pendingLSAs,0);
 s.lab.links[0].loss=1;s.advance(20000);assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.some(p=>p.endpoint.deviceId===b.id),false);assert.equal(ospfDatabaseView(host,a.id,'ospf').prefixes.length,1);
});

test('remote OSPF area changes cannot invalidate a neighbor before a delivered Hello or deadline',()=>{
 const {s,host,devices:[a,b],snapshot}=network();s.advance(500);assert.equal(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'FULL');s.lab.links[0].delay=1000;snapshot.interfaces.find(i=>i.deviceId===b.id)!.area='1';snapshot.candidates=[];syncOSPF(host,snapshot);assert.equal(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'FULL');s.advance(100);assert.equal(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'FULL');s.advance(2000);assert.equal(verifiedOSPFAdjacency(host,'ospf',a.id,'GigabitEthernet0/1',b.id,port),'DOWN');assert.ok(s.events.some(e=>e.nodeId===a.id&&e.detail.includes('Delivered Hello has incompatible')));
});
