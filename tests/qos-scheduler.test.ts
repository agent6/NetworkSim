import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import type { Device } from '../src/model.ts';
const host='GigabitEthernet0',g=(n:number)=>'GigabitEthernet0/'+n;
function run(cli:IOSSession,...lines:string[]){for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(s=>s.startsWith('%')),line+': '+out.join('\n'));}}
function pair(){
 const sim=new Simulator(1991),a=sim.addDevice('pc'),r=sim.addDevice('router'),b=sim.addDevice('server'),cli=new IOSSession(sim,r.id);
 for(const[d,p,ip]of[[a,host,'10.0.0.2'],[r,g(0),'10.0.0.1'],[r,g(1),'10.0.1.1'],[b,host,'10.0.1.2']]as const)Object.assign(d.config.interfaces[p],{ip,mask:'255.255.255.0',switchport:false,adminUp:true});
 a.config.defaultGateway='10.0.0.1';b.config.defaultGateway='10.0.1.1';b.config.interfaces[host].speed=10;b.config.interfaces[host].duplex='full';b.config.interfaces[host].features.speedAuto=false;
 sim.connect({deviceId:a.id,port:host},{deviceId:r.id,port:g(0)});sim.connect({deviceId:r.id,port:g(1)},{deviceId:b.id,port:host});
 run(cli,'enable','configure terminal','access-list 101 permit udp any any eq 9001','access-list 102 permit udp any any eq 9002','class-map VOICE','match access-group name 101','exit','class-map DATA','match access-group name 102','exit','policy-map MARK','class VOICE','set dscp ef','exit','class DATA','set dscp af11','exit','exit','interface '+g(0),'service-policy input MARK','interface '+g(1),'speed 10','duplex full','end');
 const prime=sim.ping(a.id,'10.0.1.2',{count:1});sim.advance(100);assert.equal(prime.received,1);
 run(cli,'configure terminal','class-map QVOICE','match dscp ef','exit','class-map QDATA','match dscp af11','end');
 const delivered:{flow:string;time:number;bytes:number}[]=[];
 for(const port of[9001,9002])sim.registerUDPService(port,d=>d===b,(_d,payload)=>{delivered.push({flow:payload.flow,time:sim.clock.now(),bytes:28+new TextEncoder().encode(JSON.stringify(payload)).length});return undefined;});
 const send=(flow:'voice'|'data',n:number,size=900)=>sim.udpNotify(a.id,'10.0.1.2',flow==='voice'?9001:9002,{flow,n,padding:'x'.repeat(size)},{sourcePort:flow==='voice'?20001:20002});
 return{sim,a,r,b,cli,send,delivered};
}
function stats(r:Device,name:string){return r.runtime.features.qosQueues['P:'+name+':'+g(1)+':out'];}

test('LLQ transmits priority traffic ahead of waiting data without preempting a frame already being serialized',()=>{
 const{sim,r,b,cli,send,delivered}=pair();run(cli,'configure terminal','policy-map P','class QVOICE','priority percent 10','queue-limit 128','set dscp cs5','exit','class QDATA','bandwidth remaining percent 100','queue-limit 128','exit','exit','interface '+g(1),'service-policy output P','end');
 for(let n=0;n<40;n++)send('data',n);sim.advance(3);send('voice',1);sim.advance(100);
 const voice=delivered.findIndex(row=>row.flow==='voice');assert.ok(voice>0&&voice<10,'Priority overtakes the waiting data backlog: '+voice);assert.equal(delivered.length,41);
 assert.equal(stats(r,'QVOICE').dequeued,1);assert.equal(stats(r,'QVOICE').dropped,0);assert.equal(r.runtime.features.qosCounters['P:QVOICE:'+g(1)+':out'].transmitted,1);
 assert.ok(sim.events.some(event=>event.nodeId===b.id&&event.label==='Frame received'&&event.packet?.destinationPort===9001&&event.packet.dscp===40),'The pre-mark voice classification survives its egress DSCP rewrite');
 assert.match(cli.execute('show policy-map interface '+g(1)+' output').join('\n'),/Packets enqueued 1, dequeued 1/);
});

test('class bandwidth weights share actual congested egress bytes across unequal packet sizes and drain without loss',()=>{
 const{sim,r,cli,send,delivered}=pair();run(cli,'configure terminal','policy-map P','class QVOICE','bandwidth percent 25','queue-limit 512','exit','class QDATA','bandwidth percent 75','queue-limit 512','exit','exit','interface '+g(1),'service-policy output P','end');
 for(let n=0;n<300;n++){send('voice',n,900);send('data',n,450);}sim.advance(100);
 const voice=delivered.filter(row=>row.flow==='voice').reduce((n,row)=>n+row.bytes,0),data=delivered.filter(row=>row.flow==='data').reduce((n,row)=>n+row.bytes,0);assert.ok(voice/(voice+data)>.20&&voice/(voice+data)<.30,`Expected about 25% bytes, got ${voice}/${voice+data}`);assert.ok(stats(r,'QVOICE').depth>0&&stats(r,'QDATA').depth>0);
 sim.advance(1000);assert.equal(delivered.length,600);for(const name of['QVOICE','QDATA']){assert.equal(stats(r,name).depth,0);assert.equal(stats(r,name).dropped,0);assert.equal(stats(r,name).dequeued,300);}
});

test('shape average delays real datagrams and queue-limit tail drops prevent excess frames reaching the server',()=>{
 const{sim,r,cli,send,delivered}=pair();run(cli,'configure terminal','policy-map P','class class-default','shape average 64000','queue-limit 4 packets','exit','exit','interface '+g(1),'service-policy output P','end');
 for(let n=0;n<20;n++)send('data',n,900);sim.advance(1000);
 const queue=stats(r,'class-default');assert.equal(delivered.length,5);assert.equal(queue.dequeued,5);assert.equal(queue.dropped,15);assert.equal(queue.peakDepth,4);assert.equal(queue.depth,0);
 for(let n=1;n<delivered.length;n++)assert.ok(delivered[n].time-delivered[n-1].time>=delivered[n-1].bytes*8000/64000-.02,'Shaper departure spacing follows actual packet bytes');
 const counter=r.runtime.features.qosCounters['P:class-default:'+g(1)+':out'];assert.equal(counter.matched,20);assert.equal(counter.admitted,20);assert.equal(counter.transmitted,5);assert.equal(counter.dropped,15);assert.ok(sim.events.some(event=>event.label==='QoS queue tail drop'));
 run(cli,'configure terminal','interface '+g(1),'no service-policy output P','end');for(let n=20;n<30;n++)send('data',n,900);sim.advance(20);assert.equal(delivered.length,15,'Policy removal restores ordinary wire-rate delivery');
});

test('congested LLQ rate enforcement records real priority exceed drops and preserves data progress',()=>{
 const{sim,r,cli,send,delivered}=pair();run(cli,'configure terminal','policy-map P','class QVOICE','priority percent 5','queue-limit 256','exit','class QDATA','bandwidth remaining percent 100','queue-limit 256','exit','exit','interface '+g(1),'service-policy output P','end');
 for(let n=0;n<200;n++){send('voice',n);send('data',n);}sim.advance(1000);
 assert.ok(stats(r,'QVOICE').priorityDropped>0);assert.equal(delivered.filter(row=>row.flow==='voice').length,stats(r,'QVOICE').dequeued);assert.equal(delivered.filter(row=>row.flow==='data').length,200);assert.equal(stats(r,'QDATA').dropped,0);assert.ok(sim.events.some(event=>event.label==='QoS priority exceed drop'));
});

test('unsupported queue placement and conflicting settings reject atomically; imported unsupported policy fails closed',()=>{
 const{sim,r,cli,send,delivered}=pair();run(cli,'configure terminal','policy-map P','class class-default','shape average 64000','exit','exit','interface '+g(0));assert.match(cli.execute('service-policy input P').join('\n'),/physical Ethernet output/);assert.equal(r.config.interfaces[g(0)].features.servicePolicyIn,'MARK');run(cli,'exit','control-plane');assert.match(cli.execute('service-policy input P').join('\n'),/physical Ethernet output/);run(cli,'exit','interface Port-channel1');assert.match(cli.execute('service-policy output P').join('\n'),/physical Ethernet output/);run(cli,'exit','policy-map P','class class-default');const before=structuredClone(r.config.features.policyMaps);for(const line of['priority percent 10','fair-queue 64','random-detect discard-class-based','queue-limit 4097']){assert.match(cli.execute(line).join('\n'),/%/);assert.deepEqual(r.config.features.policyMaps,before);}run(cli,'end');
 r.config.features.policyMaps.P.classes[0].fairQueue=64;r.config.interfaces[g(1)].features.servicePolicyOut='P';sim.changed();send('data',1);sim.advance(100);assert.equal(delivered.length,0);assert.ok(sim.events.some(event=>event.label==='Unsupported queued policy'));assert.match(cli.execute('show policy-map interface '+g(1)+' output').join('\n'),/Unsupported:.*fair-queue/);
});
test('removing a shaping policy flushes pending frames and cancels its clock work; fresh traffic uses the ordinary serializer',()=>{
 const{sim,r,cli,send,delivered}=pair();run(cli,'configure terminal','policy-map P','class class-default','shape average 8000','queue-limit 64','exit','exit','interface '+g(1),'service-policy output P','end');for(let n=0;n<10;n++)send('data',n);sim.advance(20);assert.equal(delivered.length,1);assert.equal(stats(r,'class-default').depth,9);
 run(cli,'configure terminal','interface '+g(1),'no service-policy output P','end');assert.equal(stats(r,'class-default').depth,0);assert.equal(stats(r,'class-default').dropped,9);send('data',10);sim.advance(10000);assert.equal(delivered.length,2);assert.ok(sim.events.some(event=>event.label==='QoS queue reset'));
});
test('physical class queues shape bridged traffic through L2, L3 and PoE switches',()=>{
 for(const kind of['switch','l3switch','poeswitch']as const){
  const sim=new Simulator(1993),a=sim.addDevice('pc'),sw=sim.addDevice(kind),b=sim.addDevice('server'),cli=new IOSSession(sim,sw.id);for(const[d,ip]of[[a,'192.0.2.1'],[b,'192.0.2.2']]as const)Object.assign(d.config.interfaces[host],{ip,mask:'255.255.255.0'});sim.connect({deviceId:a.id,port:host},{deviceId:sw.id,port:g(1)});sim.connect({deviceId:sw.id,port:g(2)},{deviceId:b.id,port:host});run(cli,'enable','configure terminal','spanning-tree mode rapid-pvst','end');sim.advance(1500);const prime=sim.ping(a.id,'192.0.2.2',{count:1});sim.advance(100);assert.equal(prime.received,1);
  run(cli,'configure terminal','policy-map P','class class-default','shape average 32000','queue-limit 2','exit','exit','interface '+g(2),'service-policy output P','end');let delivered=0;sim.registerUDPService(9000,d=>d===b,()=>{delivered++;return undefined;});for(let n=0;n<10;n++)sim.udpNotify(a.id,'192.0.2.2',9000,{n,padding:'x'.repeat(900)});sim.advance(1000);assert.equal(delivered,3,kind);const queue=sw.runtime.features.qosQueues['P:class-default:'+g(2)+':out'];assert.equal(queue.dropped,7);assert.ok(queue.dequeued>=3,'Link controls also traverse the actual class-default queue');assert.equal(sw.runtime.features.qosCounters['P:class-default:'+g(2)+':out'].matched,10);assert.equal(sw.runtime.features.qosCounters['P:class-default:'+g(2)+':out'].transmitted,3,'L2 control dequeues do not fabricate extra classified IP transmissions');
 }
});
test('Catalyst remaining-percent values are relative weights over100, while platform conflicts and queue count reject',()=>{
 const sim=new Simulator(1994),a=sim.addDevice('pc'),sw=sim.addDevice('l3switch'),b=sim.addDevice('server'),cli=new IOSSession(sim,sw.id);for(const[d,ip]of[[a,'192.0.2.1'],[b,'192.0.2.2']]as const)Object.assign(d.config.interfaces[host],{ip,mask:'255.255.255.0'});Object.assign(b.config.interfaces[host],{speed:10,duplex:'full'});b.config.interfaces[host].features.speedAuto=false;sim.connect({deviceId:a.id,port:host},{deviceId:sw.id,port:g(1)});sim.connect({deviceId:sw.id,port:g(2)},{deviceId:b.id,port:host});run(cli,'enable','configure terminal','spanning-tree mode rapid-pvst','interface '+g(2),'speed 10','duplex full','exit','class-map A','match dscp ef','exit','policy-map P','class A','bandwidth remaining percent 50','queue-limit 256','exit','class class-default','bandwidth remaining percent 100','queue-limit 256','exit','exit','interface '+g(2),'service-policy output P','end');sim.advance(1500);const prime=sim.ping(a.id,'192.0.2.2',{count:1});sim.advance(100);assert.equal(prime.received,1);
 // Mark the real ingress flow using a separate policy, preserving output class selection.
 run(cli,'configure terminal','access-list 101 permit udp any any eq 9001','class-map MARK-A','match access-group name 101','exit','policy-map MARK','class MARK-A','set dscp ef','exit','exit','interface '+g(1),'service-policy input MARK','end');const delivered:number[]=[];for(const port of[9001,9002])sim.registerUDPService(port,d=>d===b,()=>{delivered.push(port);return undefined;});for(let n=0;n<200;n++){sim.udpNotify(a.id,'192.0.2.2',9001,{n,padding:'x'.repeat(900)});sim.udpNotify(a.id,'192.0.2.2',9002,{n,padding:'x'.repeat(900)});}sim.advance(50);const fraction=delivered.filter(port=>port===9001).length/delivered.length;assert.ok(fraction>.28&&fraction<.39,String(fraction));sim.advance(1000);assert.equal(delivered.length,400);
 run(cli,'configure terminal','policy-map P','class A');const before=structuredClone(sw.config.features.policyMaps);for(const command of['shape average 32000','bandwidth 1000']){assert.match(cli.execute(command).join('\n'),/Catalyst profile/);assert.deepEqual(sw.config.features.policyMaps,before);}run(cli,'end','configure terminal','policy-map MANY');for(let n=1;n<=7;n++){run(cli,'exit','class-map C'+n,'match dscp '+n,'exit','policy-map MANY','class C'+n,'bandwidth remaining percent 10','exit');}run(cli,'exit','class-map C8','match dscp 8','exit','policy-map MANY');assert.match(cli.execute('class C8').join('\n'),/at most 8 egress queues/);
});
