import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import type {Device} from '../src/model.ts';
import {snmpGet,snmpMIB,snmpStatistics} from '../src/snmp.ts';
import {parseDocument} from '../src/persistence.ts';
const g=(n:number)=>'GigabitEthernet0/'+n;
function run(c:IOSSession,...commands:string[]){for(const line of commands){const out=c.execute(line);assert.ok(!out.some(s=>s.startsWith('%')),line+': '+out.join('\n'));}}
const vlanName=(d:Device,n:number)=>d.config.vlans[n]?.name;
function chain(version=2,domain='CAMPUS',password='shared'){
 const s=new Simulator(2601),a=s.addDevice('switch'),t=s.addDevice('l3switch'),b=s.addDevice('poeswitch'),ca=new IOSSession(s,a.id),ct=new IOSSession(s,t.id),cb=new IOSSession(s,b.id);
 for(const[c,name,pw]of[[ca,'CAMPUS','shared'],[ct,domain,password],[cb,'CAMPUS','shared']]as const){run(c,'enable','configure terminal','vtp domain '+name,'vtp version '+version,'vtp password '+pw,'interface '+g(1),'switchport mode trunk','switchport nonegotiate','interface '+g(2),'switchport mode trunk','switchport nonegotiate','end');}
 run(ct,'configure terminal','vtp mode transparent','end');run(cb,'configure terminal','vtp mode client','end');s.connect({deviceId:a.id,port:g(1)},{deviceId:t.id,port:g(1)});const downstream=s.connect({deviceId:t.id,port:g(2)},{deviceId:b.id,port:g(1)});return{s,a,t,b,ca,ct,cb,downstream};
}

test('C9300 VTPv2 transparent relay requires the configured domain; matching domain restores downstream database delivery',()=>{
 const{s,a,t,b,ca,ct,downstream}=chain(2,'OTHER');run(ca,'configure terminal','vlan 20','name STAFF','end');s.advance(100);assert.equal(b.config.vlans[20],undefined,'A different-domain v2 transparent switch cannot relay this update');assert.equal(t.config.vlans[20],undefined);run(ct,'configure terminal','vtp domain CAMPUS','end');run(ca,'configure terminal','vlan 30','name GUEST','end');s.advance(100);assert.equal(vlanName(b,20),'STAFF');assert.equal(vlanName(b,30),'GUEST');assert.equal(t.config.vlans[20],undefined);
});

test('C9300 VTPv1 transparent relays matching domain/version without authenticating the VLAN database with its own password',()=>{
 const{s,t,b,ca}=chain(1,'CAMPUS','different');run(ca,'configure terminal','vlan 20','name STAFF','end');s.advance(100);assert.equal(vlanName(b,20),'STAFF');assert.equal(t.config.vlans[20],undefined);
});

test('fresh periodic VTP advertisements traverse transparent relay after the first forwarded update was lost',()=>{
 const{s,a,t,b,ca,downstream}=chain();downstream.lossAB=1;run(ca,'configure terminal','vlan 20','name STAFF','end');s.advance(100);assert.equal(b.config.vlans[20],undefined);downstream.lossAB=0;s.advance(300100);assert.equal(vlanName(b,20),'STAFF','Unchanged five-minute advertisements are fresh packets, not forever-duplicate databases');
 t.config.vlans[20]={id:20,name:'LOCAL',active:true};const p=s.addDevice('pc'),q=s.addDevice('server');for(const[d,ip]of[[p,'192.0.2.1'],[q,'192.0.2.2']]as const){Object.assign(d.config.interfaces.GigabitEthernet0,{ip,mask:'255.255.255.0'});delete d.config.interfaces.GigabitEthernet0.features.dhcp;}for(const d of[a,b]){d.config.interfaces[g(3)].vlan=20;d.config.interfaces[g(3)].features.portfast=true;}s.connect({deviceId:p.id,port:'GigabitEthernet0'},{deviceId:a.id,port:g(3)});s.connect({deviceId:q.id,port:'GigabitEthernet0'},{deviceId:b.id,port:g(3)});s.advance(3000);const echo=s.ping(p.id,'192.0.2.2',{count:1});s.advance(100);assert.equal(echo.received,1);
});

test('new trunks, reenabled VTP ports and no-domain clients solicit delivered database refresh without waiting five minutes',()=>{
 const s=new Simulator(2602),a=s.addDevice('switch'),b=s.addDevice('switch'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id);for(const c of[ca,cb])run(c,'enable','configure terminal','interface '+g(1),'switchport mode trunk','switchport nonegotiate','end');run(ca,'configure terminal','vtp domain CAMPUS','vlan 20','name STAFF','end');run(cb,'configure terminal','vtp mode client','end');s.connect({deviceId:a.id,port:g(1)},{deviceId:b.id,port:g(1)});s.advance(100);assert.equal(b.config.features.vtp.domain,'CAMPUS');assert.equal(vlanName(b,20),'STAFF');
 run(cb,'configure terminal','interface '+g(1),'no vtp','end');run(ca,'configure terminal','vlan 30','name GUEST','end');s.advance(100);assert.equal(b.config.vlans[30],undefined);run(cb,'configure terminal','interface '+g(1),'vtp','end');s.advance(100);assert.equal(vlanName(b,30),'GUEST');assert.ok(s.events.some(e=>e.protocol==='VTP'&&e.disposition==='receive'));
});

test('SNMP unicast MIB counters exclude broadcast discovery and reflect actual Ethernet delivery',()=>{
 const s=new Simulator(2603),a=s.addDevice('router'),m=s.addDevice('server'),c=new IOSSession(s,a.id);Object.assign(a.config.interfaces[g(0)],{ip:'192.0.2.1',mask:'255.255.255.0',adminUp:true});Object.assign(m.config.interfaces.GigabitEthernet0,{ip:'192.0.2.2',mask:'255.255.255.0'});delete m.config.interfaces.GigabitEthernet0.features.dhcp;s.connect({deviceId:a.id,port:g(0)},{deviceId:m.id,port:'GigabitEthernet0'});run(c,'enable','configure terminal','snmp-server community read ro','end');
 const request=snmpGet(s,m.id,'192.0.2.1',{version:'2c',community:'read',oids:['1.3.6.1.2.1.2.2.1.11.1']});s.advance(100);assert.equal(request.status,'success');const received=s.events.filter(e=>e.nodeId===a.id&&e.label==='Frame received'&&e.port===g(0)),unicast=received.filter(e=>!(parseInt(e.packet!.destinationMac!.slice(0,2),16)&1));assert.ok(received.length>unicast.length);assert.equal(request.varbinds[0].value,unicast.length);const mib=snmpMIB(s,a),value=(column:number)=>mib.find(r=>r.oid===`1.3.6.1.2.1.2.2.1.${column}.1`)?.value;assert.equal(value(11),unicast.length);assert.equal(value(12),received.length-unicast.length);
});

test('SNMP MIB non-unicast and error columns use delivered Ethernet groups and traffic-driven CRC counters',()=>{
 const s=new Simulator(2604),a=s.addDevice('router'),m=s.addDevice('server');Object.assign(a.config.interfaces[g(0)],{ip:'192.0.2.1',mask:'255.255.255.0',adminUp:true});Object.assign(m.config.interfaces.GigabitEthernet0,{ip:'192.0.2.2',mask:'255.255.255.0'});delete m.config.interfaces.GigabitEthernet0.features.dhcp;const wire=s.connect({deviceId:a.id,port:g(0)},{deviceId:m.id,port:'GigabitEthernet0'});const good=s.ping(m.id,'192.0.2.1',{count:1});s.advance(100);assert.equal(good.received,1);const sent=s.events.filter(e=>e.nodeId===a.id&&e.port===g(0)&&e.label==='Frame sent'),group=sent.filter(e=>parseInt(e.packet!.destinationMac!.slice(0,2),16)&1).length,value=(n:number)=>snmpMIB(s,a).find(r=>r.oid===`1.3.6.1.2.1.2.2.1.${n}.1`)?.value;assert.equal(value(17),sent.length-group);assert.equal(value(18),group);
 wire.physical={medium:'copper-cat6a',length:10,fault:'none',bitErrorRate:1};s.changed();s.ping(m.id,'192.0.2.1',{count:1,timeout:100});s.advance(150);assert.ok(a.runtime.counters[g(0)].inputErrors!>0);assert.equal(value(14),a.runtime.counters[g(0)].inputErrors);assert.equal(value(20),a.runtime.counters[g(0)].outputErrors??0);
});

test('malformed delivered SNMP requests do not count as credential failures or generate authentication traps',()=>{
 const s=new Simulator(2605),a=s.addDevice('router'),m=s.addDevice('server'),c=new IOSSession(s,a.id);Object.assign(a.config.interfaces[g(0)],{ip:'192.0.2.1',mask:'255.255.255.0',adminUp:true});Object.assign(m.config.interfaces.GigabitEthernet0,{ip:'192.0.2.2',mask:'255.255.255.0'});delete m.config.interfaces.GigabitEthernet0.features.dhcp;s.connect({deviceId:a.id,port:g(0)},{deviceId:m.id,port:'GigabitEthernet0'});run(c,'enable','configure terminal','snmp-server community read ro','snmp-server host 192.0.2.2 version 2c read','snmp-server enable traps authentication','end');m.config.services.snmpManager={enabled:true,community:'read'};const bad=snmpGet(s,m.id,'192.0.2.1',{version:'2c',community:'read',operation:'get-bulk',maxRepetitions:-1,oids:['sysName']},{timeout:100});s.advance(200);assert.equal(bad.status,'failure');assert.equal(snmpStatistics(a).authenticationFailures,0);assert.equal(snmpStatistics(a).malformedRequests,1);assert.equal(m.runtime.features.snmpNotifications,undefined);assert.match(c.execute('show snmp').join('\n'),/\n    1 Encoding errors\n/);
});

test('LACP restart and portable load discard received synchronization until fresh delivered actor/partner exchange',()=>{
 const s=new Simulator(2606),a=s.addDevice('switch'),b=s.addDevice('switch'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id);for(const c of[ca,cb])run(c,'enable','configure terminal','interface '+g(1),'channel-group 1 mode active','lacp rate fast','end','write memory');s.connect({deviceId:a.id,port:g(1)},{deviceId:b.id,port:g(1)});s.advance(100);assert.equal(a.runtime.features.portChannels[1].activeMembers.length,1);const send=s.sendLinkControl.bind(s);let drop=true;s.sendLinkControl=(id,port,body)=>{if(drop&&id===b.id&&body.protocol==='LACP')return;send(id,port,body);};s.reload(a.id);s.advance(100);assert.equal(a.runtime.features.portChannels[1].activeMembers.length,0);s.advance(3200);assert.equal(a.runtime.features.portChannels[1].activeMembers.length,0);drop=false;s.advance(1200);assert.equal(a.runtime.features.portChannels[1].activeMembers.length,1);const fresh=new Simulator();fresh.load(parseDocument(JSON.stringify(s.serialize())));assert.equal(fresh.getDevice(a.id)!.runtime.features.portChannels[1].activeMembers.length,0);fresh.advance(100);assert.equal(fresh.getDevice(a.id)!.runtime.features.portChannels[1].activeMembers.length,1);
});


test('STP transmit hold count bounds triggered bursts and portable load requires fresh delivered BPDUs',()=>{
 const s=new Simulator(2607),a=s.addDevice('switch'),b=s.addDevice('poeswitch'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id),sent:Array<{id:string;time:number}>=[],send=s.sendLinkControl.bind(s);
 s.sendLinkControl=(id,port,body)=>{if(body.protocol==='STP')sent.push({id,time:s.clock.now()});send(id,port,body);};
 run(ca,'enable','configure terminal','spanning-tree transmit hold-count 1','spanning-tree vlan 1 priority 0','end');run(cb,'enable','configure terminal','spanning-tree transmit hold-count 1','end');
 s.connect({deviceId:a.id,port:g(1)},{deviceId:b.id,port:g(1)});s.advance(100);
 for(const priority of[8192,4096,0])run(ca,'configure terminal','spanning-tree vlan 1 priority '+priority,'end');s.advance(5100);assert.equal(b.runtime.stp['1'].rootId,a.id);
 const windows=new Map<string,number>();for(const row of sent){const k=row.id+'|'+Math.floor(row.time/1000);windows.set(k,(windows.get(k)??0)+1);}assert.ok(windows.size>2);assert.ok([...windows.values()].every(n=>n<=1));
 const document=parseDocument(JSON.stringify(s.serialize()));document.lab.links[0].lossAB=1;const fresh=new Simulator();fresh.load(document);fresh.advance(100);assert.equal(fresh.getDevice(b.id)!.runtime.stp['1'].rootId,b.id,'Received superior vectors must not survive a portable restart with initial BPDU loss');document.lab.links[0].lossAB=0;fresh.lab.links[0].lossAB=0;fresh.advance(3100);assert.equal(fresh.getDevice(b.id)!.runtime.stp['1'].rootId,a.id);
});
