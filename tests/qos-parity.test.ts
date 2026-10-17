import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {applyQos} from '../src/packet-policy.ts';
import type {Device} from '../src/model.ts';
import type {IPPacket} from '../src/engine.ts';
const host='GigabitEthernet0',g=(i:number)=>'GigabitEthernet0/'+i;
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(x=>x.startsWith('%')&&!x.includes('configuration stored only')),line+': '+out.join('\n'));}}
function ip(d:Device,p:string,a:string){Object.assign(d.config.interfaces[p],{ip:a,mask:'255.255.255.0',switchport:false,adminUp:true});}
function lab(){const s=new Simulator(1800),a=s.addDevice('pc'),r=s.addDevice('router'),b=s.addDevice('server');ip(a,host,'10.0.0.2');a.config.defaultGateway='10.0.0.1';ip(r,g(0),'10.0.0.1');ip(r,g(1),'10.0.1.1');ip(b,host,'10.0.1.2');b.config.defaultGateway='10.0.1.1';s.connect({deviceId:a.id,port:host},{deviceId:r.id,port:g(0)});s.connect({deviceId:r.id,port:g(1)},{deviceId:b.id,port:host});const c=new IOSSession(s,r.id);run(c,'enable','conf t');return{s,a,r,b,c};}
const counter=(r:Device)=>r.runtime.features.qosCounters['P:class-default:'+g(0)+':in'];

test('CLI policer uses conform/exceed/violate colors on delivered traffic and records actual marks and drops',()=>{
 const{s,a,r,c}=lab();run(c,'policy-map P','class class-default','police cir 8 bc 100 be 100','conform-action set-dscp-transmit ef','exceed-action set-dscp-transmit af11','violate-action drop');assert.match(c.prompt,/config-pmap-c-police/);run(c,'end','conf t','interface g0/0','service-policy input P','end');const ping=s.ping(a.id,'10.0.1.2',{count:3,interval:0,size:100});s.advance(2000);assert.equal(ping.received,2);assert.deepEqual(counter(r).colors,{conform:{packets:1,bytes:100},exceed:{packets:1,bytes:100},violate:{packets:1,bytes:100}});assert.equal(counter(r).dropped,1);assert.ok(s.events.some(e=>e.nodeId===r.id&&e.packet?.dscp===46));assert.ok(s.events.some(e=>e.nodeId===r.id&&e.packet?.dscp===10));const output=c.execute('show policy-map interface g0/0 input').join('\n');assert.match(output,/conformed 1 packets, 100 bytes/);assert.match(output,/exceeded 1 packets, 100 bytes; action set-dscp-transmit 10/);assert.match(output,/violated 1 packets, 100 bytes; action drop/);
});

test('two-color exceed transmit and conform drop are operational, not aliases for the default policer',()=>{
 const{s,a,r,c}=lab();run(c,'policy-map P','class class-default','police 8 100 conform-action drop exceed-action transmit','end','conf t','interface g0/0','service-policy input P','end');let ping=s.ping(a.id,'10.0.1.2',{count:2,interval:0,size:100});s.advance(2000);assert.equal(ping.received,1);assert.equal(counter(r).colors.conform.packets,1);assert.equal(counter(r).colors.exceed.packets,1);assert.equal(counter(r).colors.violate,undefined);run(c,'conf t','policy-map P','class class-default','no police','drop','end');ping=s.ping(a.id,'10.0.1.2',{count:1});s.advance(1500);assert.equal(ping.received,0);assert.ok(s.events.some(e=>e.label==='QoS class drop'));
});

test('three-color committed refill precedes excess refill, actions preserve precedence bits and default class is last',()=>{
 const s=new Simulator(1801),r=s.addDevice('router');r.config.features.classMaps={VOICE:{match:'all',dscp:[11]}};r.config.features.policyMaps={P:{classes:[{name:'class-default',drop:true},{name:'VOICE',police:{rate:800,burst:100,excessBurst:100,conform:{kind:'set-precedence',value:5},exceed:{kind:'transmit'},violate:{kind:'drop'}}}]}};r.config.interfaces[g(0)].features.servicePolicyIn='P';
 const packet=():IPPacket=>({kind:'ip',id:'test',source:'10.0.0.1',destination:'10.0.0.2',protocol:'udp',ttl:64,size:100,df:false,dscp:11,body:{}} as IPPacket);
 const apply=()=>{const p=packet();return {ok:applyQos(s,r,g(0),'in',p,()=>false),p};};let result=apply();assert.equal(result.ok,true);assert.equal(result.p.dscp,43);assert.equal(apply().ok,true);assert.equal(apply().ok,false);s.advance(1000);assert.equal(apply().ok,true,'One second replenishes committed only');assert.equal(apply().ok,false);s.advance(2000);assert.equal(apply().ok,true);assert.equal(apply().ok,true,'Second second overflows into excess');assert.equal(apply().ok,false);assert.equal(r.runtime.features.qosCounters['P:class-default:'+g(0)+':in'],undefined);
});

test('QoS settings and policer submode round-trip; unsupported and conflicting scheduling is rejected',()=>{
 const{s,r,c}=lab();run(c,'class-map match-any VOICE','description Delay sensitive traffic','match dscp ef','exit','policy-map P','class VOICE','priority percent 30','queue-limit 40 packets','set dscp cs5','police 8000 1000 2000 conform-action transmit exceed-action set-dscp-transmit af11 violate-action drop','exit','class class-default','bandwidth remaining percent 70','drop','end');const copy=s.addDevice('router'),other=new IOSSession(s,copy.id);copy.config.features.files={snapshot:renderConfig(r).join('\n')};run(other,'enable','copy flash:snapshot running-config');assert.deepEqual(copy.config.features.policyMaps,r.config.features.policyMaps);assert.deepEqual(copy.config.features.classMaps,r.config.features.classMaps);const output=c.execute('show policy-map P').join('\n');assert.match(output,/priority percent 30/);assert.doesNotMatch(output,/congestion drops are not modeled/);assert.match(c.execute('show class-map VOICE').join('\n'),/Description: Delay sensitive traffic/);run(c,'conf t','policy-map P','class VOICE');const before=structuredClone(r.config.features.policyMaps);for(const unsupported of['shape average 64000','fair-queue','random-detect','bandwidth percent 20']){assert.match(c.execute(unsupported).join('\n'),/%/);assert.deepEqual(r.config.features.policyMaps,before);}assert.match(c.execute('police 8000 1000 conform-action set-dscp-transmit nonsense').join('\n'),/%/);assert.deepEqual(r.config.features.policyMaps,before);assert.match(c.execute('drop').join('\n'),/Remove policing/);assert.deepEqual(r.config.features.policyMaps,before);assert.ok(!r.runtime.features.qosQueues,'An unattached policy does not create queue telemetry');
});

test('CoPP color actions affect locally delivered traffic while transit bypasses the control-plane policy',()=>{
 const{s,a,r,c}=lab();run(c,'policy-map P','class class-default','police 8 1 conform-action transmit exceed-action drop','end','conf t','control-plane','service-policy input P','end');const local=s.ping(a.id,'10.0.0.1',{count:1});s.advance(1500);assert.equal(local.received,0);const transit=s.ping(a.id,'10.0.1.2',{count:1});s.advance(1500);assert.equal(transit.received,1);assert.match(c.execute('show policy-map control-plane input class class-default').join('\n'),/exceeded 1 packets/);assert.equal(r.runtime.features.qosCounters['P:class-default:control-plane:in'].dropped,1);
});
