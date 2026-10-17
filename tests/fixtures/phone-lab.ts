import assert from 'node:assert/strict';
import {Simulator} from '../../src/engine.ts';
import {IOSSession} from '../../src/cli.ts';
import type {Device} from '../../src/model.ts';

export const g=(n:number)=>`GigabitEthernet0/${n}`;
export function phoneLabFixture(discovery:'CDP'|'LLDP'|'none'='CDP'){
  const sim=new Simulator(61004),sw=sim.addDevice('poeswitch',460,170),phone=sim.addDevice('phone',460,390),pc=sim.addDevice('pc',460,610),data=sim.addDevice('server',200,170),voice=sim.addDevice('server',720,170),cli=new IOSSession(sim,sw.id);
  const run=(...lines:string[])=>{for(const line of lines){const output=cli.execute(line);assert.ok(!output.some(s=>s.startsWith('%')),`${line}: ${output.join('\n')}`);}};
  run('enable','configure terminal','vlan 10','exit','vlan 20','exit','interface range g0/1 - 3','switchport mode access','spanning-tree portfast','exit','interface g0/1','switchport access vlan 10','exit','interface g0/2','switchport access vlan 10','exit','interface g0/3','switchport access vlan 20','exit');
  if(discovery==='CDP')run('interface g0/1','switchport voice vlan 20','exit');
  if(discovery==='LLDP')run('no cdp run','lldp run','network-policy profile 1','voice vlan 20 cos 5','voice vlan 20 dscp 46','exit','interface g0/1','network-policy 1','exit');
  if(discovery==='none')run('no cdp run');
  run('end');
  const service=(d:Device,network:string)=>{
    Object.assign(d.config.interfaces.GigabitEthernet0,{ip:network+'.1',mask:'255.255.255.0'});
    d.config.services.dhcp={enabled:true,pools:[{name:'LAN-'+network,network:network+'.0',prefix:24,defaultRouter:network+'.1',dnsServers:[network+'.1']}],excluded:[{start:network+'.1',end:network+'.9'}]};
  };
  service(data,'10.10.10');service(voice,'10.20.20');
  const wire=sim.connect({deviceId:sw.id,port:g(1)},{deviceId:phone.id,port:'Network'});
  sim.connect({deviceId:phone.id,port:'PC'},{deviceId:pc.id,port:'GigabitEthernet0'});
  sim.connect({deviceId:sw.id,port:g(2)},{deviceId:data.id,port:'GigabitEthernet0'});
  sim.connect({deviceId:sw.id,port:g(3)},{deviceId:voice.id,port:'GigabitEthernet0'});
  sim.lab.name='VoIP phone · voice and PC data VLANs';sim.changed();
  return{sim,sw,phone,pc,data,voice,cli,wire,run,service};
}
