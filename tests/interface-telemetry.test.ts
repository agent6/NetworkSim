import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {interfaceRates,recordInterfaceSample} from '../src/interface-telemetry.ts';
import type {PortCounters} from '../src/model.ts';
const run=(c:IOSSession,...commands:string[])=>{for(const cmd of commands)assert.ok(!c.execute(cmd).some(iosRejected),cmd);};
test('interface rates follow delivered frames, age to zero, and clear without altering the configuration',()=>{
 const e=new Simulator(20261022),a=e.addDevice('router'),b=e.addDevice('router'),ca=new IOSSession(e,a.id),cb=new IOSSession(e,b.id),port='GigabitEthernet0/0';
 e.connect({deviceId:a.id,port},{deviceId:b.id,port});
 for(const [cli,ip] of [[ca,'192.0.2.1'],[cb,'192.0.2.2']] as const)run(cli,'enable','conf t','no cdp run','int g0/0','ip address '+ip+' 255.255.255.0','no shutdown','end');
 run(ca,'ping 192.0.2.2 repeat 5');
 const rates=interfaceRates(a,port,e.clock.now());assert.ok(rates.inputBits>0&&rates.outputBits>0);
 const before=JSON.stringify(a.runtime.counters),now=e.clock.now();const output=ca.execute('show interfaces g0/0').join('\n');
 assert.match(output,new RegExp('5 minute input rate '+rates.inputBits+' bits/sec'));assert.match(output,new RegExp('5 minute output rate '+rates.outputBits+' bits/sec'));
 assert.equal(JSON.stringify(a.runtime.counters),before);assert.equal(e.clock.now(),now);
 e.advance(301000);assert.deepEqual(interfaceRates(a,port,e.clock.now()),{inputBits:0,outputBits:0,inputPackets:0,outputPackets:0});
 run(ca,'ping 192.0.2.2 repeat 2');assert.ok(interfaceRates(a,port,e.clock.now()).outputBits>0);
 const config=JSON.stringify(a.config);run(ca,'clear counters g0/0');assert.equal(JSON.stringify(a.config),config);assert.equal(a.runtime.counters[port],undefined);
 assert.match(ca.execute('show interfaces g0/0').join('\n'),/Last clearing of "show interface" counters 00:00:00/);
 assert.equal(interfaceRates(a,port,e.clock.now()).inputBits,0);
});
test('rate recording is bounded per port under long-running traffic',()=>{
 const c:PortCounters={rx:0,tx:0,drops:0,rxBytes:0,txBytes:0};
 for(let second=0;second<1000;second++)for(let i=0;i<2;i++)recordInterfaceSample(c,second*1000,'tx',100);
 assert.ok(c.rateSamples!.length<=301);assert.equal(c.rateSamples!.at(-1)!.tx,2);assert.equal(c.rateSamples!.at(-1)!.txBytes,200);
});
