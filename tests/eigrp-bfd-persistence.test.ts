import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {renderConfig} from '../src/config-renderer.ts';
import type {Device} from '../src/model.ts';
const port='GigabitEthernet0/0';
function run(cli:IOSSession,...lines:string[]){for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(row=>row.startsWith('%')),line+': '+out.join('\n'));}}
function process(cli:IOSSession,named:boolean,six:boolean,inside?:()=>void){run(cli,'configure terminal',named?'router eigrp CAMPUS':'router eigrp 10');if(named)run(cli,`address-family ${six?'ipv6':'ipv4'} unicast autonomous-system 10`);inside?.();run(cli,'end');}
function pair(named:boolean,six:boolean){
 const sim=new Simulator(2100),a=sim.addDevice('router'),b=sim.addDevice('router'),ca=new IOSSession(sim,a.id),cb=new IOSSession(sim,b.id);
 for(const[d,cli,n]of[[a,ca,1],[b,cb,2]]as const){run(cli,'enable','configure terminal',...(six?['ipv6 unicast-routing']:[]),'interface '+port,...(six?[`ipv6 address 2001:db8:10::${n}/64`]:[`ip address 10.0.0.${n} 255.255.255.0`]),'no shutdown','interface Loopback0',...(six?[`ipv6 address 2001:db8:${n}::1/64`]:[`ip address 192.0.2.${n} 255.255.255.255`]),'end');process(cli,named,six,()=>run(cli,...(six?[`eigrp router-id 1.1.1.${n}`]:['network 0.0.0.0 255.255.255.255'])));}
 sim.connect({deviceId:a.id,port},{deviceId:b.id,port});sim.advance(6500);return{sim,a,b,ca,cb};
}
const value=(d:Device,six:boolean)=>d.config.interfaces[port].features[six?'eigrp6':'eigrp']?.bfd;
function replay(sim:Simulator,d:Device,six:boolean){const copy=sim.addDevice('router'),cli=new IOSSession(sim,copy.id);copy.config.features.files={snapshot:renderConfig(d).join('\n')};run(cli,'enable','copy flash:snapshot running-config');assert.equal(value(copy,six),value(d,six));return copy;}
function ping(sim:Simulator,a:Device,six:boolean){const p=sim.ping(a.id,six?'2001:db8:2::1':'192.0.2.2',{count:1});sim.advance(1000);return p.received;}

for(const[named,six,af]of[[false,false,false],[true,true,false],[true,true,true]]as const)test(`${named?'named IPv6':'classic IPv4'} ${af?'af-interface bfd':'bfd interface'} persists enable/no/default and gates actual EIGRP forwarding`,()=>{
 const{sim,a,ca}=pair(named,six);assert.equal(ping(sim,a,six),1);const configure=(command:string)=>process(ca,named,six,()=>{if(af)run(ca,'af-interface '+port);run(ca,command);});const set=af?'bfd':'bfd interface '+port;
 configure(set);sim.advance(1000);assert.equal(value(a,six),true);assert.equal(ping(sim,a,six),0,'BFD requirement without an established BFD peer withdraws the route');const rendered=renderConfig(a).join('\n');assert.match(rendered,af||named?/af-interface GigabitEthernet0\/0\n  bfd\n exit-af-interface/:/ bfd interface GigabitEthernet0\/0/);replay(sim,a,six);
 run(ca,'write memory');sim.reload(a.id);sim.advance(7000);assert.equal(value(a,six),true);assert.equal(ping(sim,a,six),0);
 configure('no '+set);sim.advance(6000);assert.equal(value(a,six),false);assert.equal(ping(sim,a,six),1);replay(sim,a,six);run(ca,'write memory');sim.reload(a.id);sim.advance(7000);assert.equal(value(a,six),false);assert.equal(ping(sim,a,six),1);
 configure(set);configure('default '+set);sim.advance(6000);assert.equal(value(a,six),false);assert.equal(ping(sim,a,six),1);replay(sim,a,six);
 if(named)process(ca,true,true,()=>{const before=structuredClone(a.config.protocols.eigrp6);for(const line of['no autonomous-system 10','no autonomous-system']){assert.match(ca.execute(line).join('\n'),/% Invalid/);assert.deepEqual(a.config.protocols.eigrp6,before);}assert.doesNotMatch(ca.help('autonomous-').join('\n'),/autonomous-system/);});
});
