import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {IOSSession} from '../src/cli.ts';
import {secureEntries} from '../src/port-security.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {serializeLabFile,parseLabFile} from '../src/persistence.ts';

const g=(n:number)=>'GigabitEthernet0/'+n;
const run=(c:{execute:(line:string)=>string[]},...lines:string[])=>{for(const line of lines){const out=c.execute(line);assert.ok(!out.some(l=>/^%/.test(l)),line+'\n'+out.join('\n'));}};
function lab(mode='restrict',sticky=true){
 const sim=new Simulator(20261022),dut=sim.addDevice('switch'),fan=sim.addDevice('switch'),hosts=[1,2,3].map(()=>sim.addDevice('pc')),target=sim.addDevice('pc'),cli=new IOSSession(sim,dut.id);
 sim.connect({deviceId:dut.id,port:g(1)},{deviceId:fan.id,port:g(1)});
 for(const [i,h] of [...hosts,target].entries()){const port=Object.values(h.config.interfaces)[0];port.ip='10.42.0.'+(i===3?99:11+i);port.mask='255.255.255.0';port.features.macAddress='02:00:00:00:00:0'+(i+1);port.adminUp=true;sim.connect({deviceId:(i===3?dut:fan).id,port:g(i===3?2:i+2)},{deviceId:h.id,port:port.name});}
 for(const sw of [dut,fan]){const c=sw===dut?cli:new IOSSession(sim,sw.id);run(c,'enable','configure terminal','no cdp run','interface range g0/1 - 4','spanning-tree portfast','end');}
 run(cli,'configure terminal','interface g0/1','switchport mode access','switchport port-security maximum 2','switchport port-security violation '+mode,...sticky?['switchport port-security mac-address sticky']:[],'switchport port-security','end');
 sim.changed();sim.advance(3000);
 const ping=(index:number)=>{const id=sim.ping(hosts[index].id,'10.42.0.99',{count:1,timeout:200});sim.advance(1000);return id.received;};
 return {sim,dut,fan,hosts,target,cli,ping,port:dut.config.interfaces[g(1)]};
}
for(const mode of ['restrict','protect','shutdown'])test('port-security '+mode+' enforces two real source MACs and exposes the resulting state',()=>{
 const {sim,dut,cli,ping,port}=lab(mode);assert.equal(ping(0),1);assert.equal(ping(1),1);assert.match(cli.execute('show mac address-table interface g0/1').join('\n'),/0200\.0000\.0001\s+STATIC/);const before=dut.runtime.features.portSecurityPortViolations?.[g(1)]??0;
 assert.equal(ping(2),0);assert.equal(secureEntries(dut,port).length,2);
 const detail=cli.execute('show port-security interface g0/1').join('\n');assert.match(detail,/Total MAC Addresses\s+: 2/);assert.match(detail,/Sticky MAC Addresses\s+: 2/);
 assert.match(cli.execute('show port-security address').join('\n'),/0200\.0000\.0001\s+SecureSticky/);
 if(mode==='protect'){assert.equal(dut.runtime.features.portSecurityPortViolations?.[g(1)]??0,before);assert.doesNotMatch(cli.execute('show logging').join('\n'),/PSECURE_VIOLATION/);}
 else{assert.ok(dut.runtime.features.portSecurityPortViolations[g(1)]>before);assert.match(cli.execute('show logging').join('\n'),/PORT_SECURITY-2-PSECURE_VIOLATION.*0200\.0000\.0003/);}
 if(mode==='shutdown'){
  assert.match(detail,/Port Status\s+: Secure-shutdown/);assert.match(cli.execute('show interfaces status err-disabled').join('\n'),/err-disabled\s+psecure-violation/);assert.equal(ping(0),0);
  run(cli,'configure terminal','interface g0/1','shutdown','no shutdown','end');sim.advance(35000);assert.equal(ping(0),1);assert.equal(secureEntries(dut,port).length,2);
 }else{assert.equal(port.features.errDisabled,undefined);assert.equal(ping(0),1);}
});
test('sticky enable/disable converts dynamic addresses, preserves statics and renders replayable IOS syntax',()=>{
 const {dut,cli,ping,port}=lab('restrict',false);assert.equal(ping(0),1);
 run(cli,'configure terminal','interface g0/1','switchport port-security mac-address 0200.0000.0002','switchport port-security mac-address sticky','end');
 assert.deepEqual(secureEntries(dut,port).map(x=>[x.mac,x.type]).sort(),[['020000000001','SecureSticky'],['020000000002','SecureConfigured']]);
 const config=renderConfig(dut).join('\n');assert.match(config,/switchport port-security mac-address sticky 0200\.0000\.0001/);assert.match(config,/switchport port-security mac-address 0200\.0000\.0002/);
 run(cli,'configure terminal','interface g0/1','no switchport port-security mac-address sticky','end');
 assert.deepEqual(secureEntries(dut,port).map(x=>[x.mac,x.type]).sort(),[['020000000001','SecureDynamic'],['020000000002','SecureConfigured']]);
 assert.doesNotMatch(renderConfig(dut).join('\n'),/mac-address sticky/);
});
test('sticky does not age, while dynamic secure learning ages and clears on carrier loss',()=>{
 const a=lab('restrict');assert.equal(a.ping(0),1);run(a.cli,'configure terminal','interface g0/1','switchport port-security aging time 1','switchport port-security aging static','end');a.sim.advance(61000);assert.equal(secureEntries(a.dut,a.port).length,1);
 const b=lab('restrict',false);run(b.cli,'configure terminal','interface g0/1','switchport port-security aging time 1','end');assert.equal(b.ping(0),1);b.sim.advance(61000);assert.equal(secureEntries(b.dut,b.port).length,0);
 assert.equal(b.ping(0),1);const link=b.sim.linkAt(b.dut.id,g(1))!;b.sim.disconnect(link.id);assert.equal(secureEntries(b.dut,b.port).length,0);
});
test('secure maximum and interface compatibility checks reject invalid changes without storing them',()=>{
 const e=new Simulator(11),r=e.addDevice('router'),rc=new IOSSession(e,r.id);run(rc,'enable');assert.match(rc.execute('show port-security').join('\n'),/% Invalid/);
 const {cli,port,ping}=lab();ping(0);ping(1);run(cli,'configure terminal','interface g0/1');
 for(const line of ['switchport port-security maximum 1','switchport port-security mac-address sticky 0200.0000.0099','switchport mode dynamic auto','no switchport','channel-group 1 mode active'])assert.match(cli.execute(line).join('\n'),/^%/,line);
 assert.equal(port.features.portSecurity.maximum,2);assert.equal(port.switchport,true);assert.equal(port.mode,'access');
 run(cli,'interface Port-channel1');assert.match(cli.execute('switchport port-security').join('\n'),/^%/);
});
test('IOS startup and portable lab files retain the correct sticky MAC bindings',()=>{
 const {sim,dut,cli,port,ping}=lab();run(cli,'write memory');assert.equal(ping(0),1);assert.equal(dut.startupConfig?.interfaces[g(1)].features.portSecurity.stickyMacs.length,0);
 run(cli,'configure terminal','interface g0/1','switchport port-security mac-address sticky 0200.0000.0002','end','write memory');
 assert.equal(dut.startupConfig?.interfaces[g(1)].features.portSecurity.stickyMacs.length,2);
 const doc=parseLabFile(serializeLabFile(sim.serialize()));const restored=doc.lab.devices.find(d=>d.id===dut.id)!;assert.equal(restored.config.interfaces[g(1)].features.portSecurity.stickyMacs.length,2);
});

for(const mode of ['restrict','protect','shutdown'])test('NS-OS '+mode+' is feature-gated and enforces frames on a standalone physical port',()=>{
 const sim=new Simulator(20261023),dut=sim.addDevice('datacenter'),fan=sim.addDevice('switch'),target=sim.addDevice('pc'),hosts=[sim.addDevice('pc'),sim.addDevice('pc'),sim.addDevice('pc')],cli=new NSOSSession(sim,dut.id,{skipConsoleLogin:true});
 sim.connect({deviceId:dut.id,port:'Ethernet1/1'},{deviceId:fan.id,port:g(1)});sim.connect({deviceId:dut.id,port:'Ethernet1/2'},{deviceId:target.id,port:'GigabitEthernet0'});
 const fcli=new IOSSession(sim,fan.id);run(fcli,'enable','configure terminal','interface range g0/1 - 4','spanning-tree portfast','end');
 for(const [i,h] of [...hosts,target].entries()){const p=Object.values(h.config.interfaces)[0];p.ip='10.42.0.'+(i===3?99:11+i);p.mask='255.255.255.0';p.features.macAddress='02:00:00:00:00:0'+(i+1);if(i<3)sim.connect({deviceId:fan.id,port:g(i+2)},{deviceId:h.id,port:p.name});}
 run(cli,'configure terminal','interface Ethernet1/1');assert.match(cli.execute('switchport port-security').join('\n'),/feature port-security/);
 run(cli,'feature port-security','interface Ethernet1/1','spanning-tree port type edge','switchport port-security','switchport port-security maximum 2','switchport port-security mac-address sticky','switchport port-security violation '+mode,'interface Ethernet1/2','spanning-tree port type edge','end');sim.advance(3000);
 const ping=(i:number)=>{const r=sim.ping(hosts[i].id,'10.42.0.99',{count:1});sim.advance(1500);return r.received;};assert.equal(ping(0),1);assert.equal(ping(1),1);assert.equal(ping(2),0);
 assert.match(cli.execute('show port-security interface Ethernet1/1').join('\n'),/Configured Port Security\s+: Enabled/);
 assert.match(cli.execute('show port-security address').join('\n'),/0200\.0000\.0001\s+STICKY/);
 assert.doesNotMatch(cli.execute('show running-config interface Ethernet1/1').join('\n'),/sticky 0200/);
 assert.match(cli.execute('show feature').join('\n'),/eth-port-sec\s+1\s+enabled/);
 if(mode==='shutdown'){hosts[2].powered=false;sim.changed();assert.match(cli.execute('show interface status err-disabled').join('\n'),/secViolErrDis/);run(cli,'configure terminal','interface Ethernet1/1','shutdown','no shutdown','end');sim.advance(35000);assert.equal(ping(0),1);}
 else {assert.equal(ping(0),1);if(mode==='restrict'){const count=dut.runtime.features.portSecurityPortViolations['Ethernet1/1'];ping(2);assert.equal(dut.runtime.features.portSecurityPortViolations['Ethernet1/1'],count);assert.equal(dut.runtime.logs.filter(l=>l.includes('max address count violation RESTRICT')).length,1);}}
});

test('IOS sticky MAC help, completion and saved bindings use implemented syntax',()=>{
 const {sim,dut,cli,ping}=lab();run(cli,'configure terminal','interface g0/1');
 assert.match(cli.help('switchport port-security mac-address ').join('\n'),/H\.H\.H/);
 assert.match(cli.help('switchport port-security mac-address sticky ').join('\n'),/H\.H\.H/);
 assert.match(cli.help('switchport port-security mac-address sticky ').join('\n'),/<cr>/);
 assert.equal(cli.complete('switchport port-security mac-address st'),'switchport port-security mac-address sticky ');
 run(cli,'end','write memory');assert.equal(ping(0),1);sim.reloadIOS(dut.id);sim.advance(8000);assert.equal(secureEntries(dut,dut.config.interfaces[g(1)]).length,0);
});

test('NX-OS sticky storage survives reload separately from startup configuration',()=>{
 const sim=new Simulator(20261024),d=sim.addDevice('datacenter'),c=new NSOSSession(sim,d.id,{skipConsoleLogin:true}),pc=sim.addDevice('pc');
 const p=Object.values(pc.config.interfaces)[0];p.ip='10.42.0.11';p.mask='255.255.255.0';p.features.macAddress='02:00:00:00:00:01';
 sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:pc.id,port:p.name});
 run(c,'configure terminal','feature port-security','interface Ethernet1/1','switchport port-security','switchport port-security mac-address sticky','end','copy running-config startup-config');
 sim.advance(2000);sim.ping(pc.id,'10.42.0.99',{count:1});sim.advance(1000);
 assert.equal(d.secureSticky?.['Ethernet1/1'].length,1);assert.equal(d.startupConfig!.interfaces['Ethernet1/1'].features.portSecurity.stickyMacs.length,0);
 sim.reloadIOS(d.id);sim.advance(8000);assert.equal(secureEntries(d,d.config.interfaces['Ethernet1/1']).length,1);
 const restored=parseLabFile(serializeLabFile(sim.serialize())).lab.devices.find(x=>x.id===d.id)!;assert.equal(restored.secureSticky?.['Ethernet1/1'].length,1);
});

test('port-security automatic recovery preserves sticky bindings after the offending endpoint is removed',()=>{
 const {sim,dut,hosts,cli,ping,port}=lab('shutdown');assert.equal(ping(0),1);assert.equal(ping(1),1);assert.equal(ping(2),0);sim.power(hosts[2].id,false);
 run(cli,'configure terminal','errdisable recovery cause psecure-violation','errdisable recovery interval 30','end');sim.advance(35000);
 assert.equal(port.features.errDisabled,false);assert.equal(ping(0),1);assert.equal(secureEntries(dut,port).length,2);assert.match(cli.execute('show logging').join('\n'),/PM-4-ERR_RECOVER/);
});

test('default interface discards dynamic secure state and violation history',()=>{
 const {sim,dut,cli,ping,port}=lab('restrict',false);ping(0);ping(1);ping(2);assert.ok(dut.runtime.features.portSecurityPortViolations[port.name]);
 run(cli,'configure terminal','default interface g0/1','interface g0/1','switchport mode access','switchport port-security','end');
 assert.equal(secureEntries(dut,dut.config.interfaces[port.name]).length,0);assert.equal(dut.runtime.features.portSecurityPortViolations?.[port.name],undefined);
});

test('a rejected NS-OS sticky range preserves dynamic and persistent bindings atomically',()=>{
 const sim=new Simulator(20261025),d=sim.addDevice('datacenter'),c=new NSOSSession(sim,d.id,{skipConsoleLogin:true}),pc=sim.addDevice('pc');
 const p=Object.values(pc.config.interfaces)[0];sim.stopAutomaticAddressing(pc.id,p.name,'ipv4');p.ip='10.42.0.11';p.mask='255.255.255.0';
 sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:pc.id,port:p.name});
 run(c,'configure terminal','feature port-security','interface Ethernet1/1','switchport port-security','interface Ethernet1/2','no switchport','end');sim.advance(2000);sim.ping(pc.id,'10.42.0.99',{count:1});sim.advance(1000);
 const before=JSON.stringify(d.runtime.features.secureMacs);run(c,'configure terminal','interface Ethernet1/1-2');assert.match(c.execute('switchport port-security mac-address sticky').join('\n'),/standalone physical Ethernet access ports/);
 assert.equal(JSON.stringify(d.runtime.features.secureMacs),before);assert.equal(d.secureSticky,undefined);assert.equal(d.config.interfaces['Ethernet1/1'].features.portSecurity.sticky,false);
});

test('malformed, multicast and zero source MACs cannot learn secure bindings or crash diagnostics',async()=>{
 const {inspectPortSecurity}=await import('../src/port-security.ts');const {sim,dut,port}=lab();
 for(const mac of ['invalid','ff:ff:ff:ff:ff:ff','00:00:00:00:00:00'])assert.equal(inspectPortSecurity(sim,dut,port,1,{id:'invalid-source',sourceMac:mac,destinationMac:'ff:ff:ff:ff:ff:ff',hops:64,payload:{kind:'arp',operation:'request',source:'10.42.0.11',mac,target:'10.42.0.99',family:4}}),false);
 assert.equal(secureEntries(dut,port).length,0);
});

test('NS-OS automatic recovery resets its violation counter and disabled-interface diagnostics match the reference',()=>{
 const sim=new Simulator(20261026),d=sim.addDevice('datacenter'),c=new NSOSSession(sim,d.id,{skipConsoleLogin:true}),pc=sim.addDevice('pc');
 const p=Object.values(pc.config.interfaces)[0];sim.stopAutomaticAddressing(pc.id,p.name,'ipv4');p.ip='10.42.0.11';p.mask='255.255.255.0';p.features.macAddress='02:00:00:00:00:01';sim.connect({deviceId:d.id,port:'Ethernet1/1'},{deviceId:pc.id,port:p.name});
 run(c,'configure terminal','feature port-security','interface Ethernet1/1','switchport port-security','switchport port-security mac-address 0200.0000.0099','end');sim.advance(2000);sim.ping(pc.id,'10.42.0.99',{count:1});sim.advance(1000);assert.equal(d.runtime.features.portSecurityPortViolations['Ethernet1/1'],1);sim.power(pc.id,false);
 run(c,'configure terminal','errdisable recovery cause psecure-violation','errdisable recovery interval 30','end');sim.advance(35000);assert.equal(d.runtime.features.portSecurityPortViolations?.['Ethernet1/1'],undefined);
 run(c,'configure terminal','interface Ethernet1/1','no switchport port-security','end');assert.deepEqual(c.execute('show port-security interface Ethernet1/1'),['ERROR: error: Port security is not enabled']);
});
