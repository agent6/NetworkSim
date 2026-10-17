import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {renderConfig} from '../src/config-renderer.ts';

function fixture(kind:'router'|'switch'='router'){
  const engine=new Simulator(),device=engine.addDevice(kind),cli=new IOSSession(engine,device.id);
  cli.execute('enable');cli.execute('configure terminal');return {engine,device,cli};
}
function accepted(cli:IOSSession,line:string){assert.ok(!cli.execute(line).some(s=>/^%|Bad mask/.test(s)),line);}

test('static route Null aliases, metadata, VRF global ordering and prefix deletion match executable reference cases',()=>{
  const {device,cli}=fixture();
  for(const target of ['Null0','Null00','Nu0','Null 0','Nu 00']){
    accepted(cli,`ip route 192.0.2.0 255.255.255.0 ${target} 200 name DISCARD tag 123`);
    assert.equal(device.config.staticRoutes.length,1);
    assert.deepEqual(device.config.staticRoutes[0],{network:'192.0.2.0',prefix:24,interface:'Null0',ad:200,name:'DISCARD',tag:123});
  }
  accepted(cli,'vrf definition BLUE');accepted(cli,'exit');
  accepted(cli,'ip route vrf BLUE 198.51.100.0 255.255.255.0 203.0.113.1 g 220 name global tag 4294967295');
  const line=renderConfig(device).find(x=>x.startsWith('ip route vrf'))!;
  assert.equal(line,'ip route vrf BLUE 198.51.100.0 255.255.255.0 203.0.113.1 global 220 name global tag 4294967295');
  const other=fixture();accepted(other.cli,line);assert.deepEqual(other.device.config.staticRoutes[0],device.config.staticRoutes[1]);
  const before=JSON.stringify(device.config.staticRoutes);
  for(const suffix of ['name DEFAULT global','name DEFAULT 200','tag -1','tag 1 tag 2','permanent track 1']){
    assert.match(cli.execute(`ip route vrf BLUE 198.51.100.0 255.255.255.0 203.0.113.1 ${suffix}`).join('\n'),/%/);
    assert.equal(JSON.stringify(device.config.staticRoutes),before);
  }
  accepted(cli,'no ip route 192.0.2.0 255.255.255.0');assert.equal(device.config.staticRoutes.length,1);
  accepted(cli,'no ip route vrf BLUE 198.51.100.0 255.255.255.0');assert.equal(device.config.staticRoutes.length,0);
});

test('IPv4 subnet and broadcast assignments reject atomically while /31 and /32 remain usable',()=>{
  const {device,cli}=fixture();accepted(cli,'interface g0/0');accepted(cli,'ip address 192.0.2.1 255.255.255.0');
  for(const address of ['192.0.2.0','192.0.2.255']){
    assert.match(cli.execute(`ip address ${address} 255.255.255.0`).join('\n'),/Bad mask/);
    assert.equal(device.config.interfaces['GigabitEthernet0/0'].ip,'192.0.2.1');
  }
  accepted(cli,'ip address 192.0.2.0 255.255.255.254');accepted(cli,'ip address 192.0.2.255 255.255.255.255');
});

test('reserved VLAN deletion and SVI storm control reject without partial state changes',()=>{
  const {device,cli}=fixture('switch');accepted(cli,'vlan 10');accepted(cli,'exit');
  for(const list of ['1','1002','1003-1005','10,1002']){
    assert.match(cli.execute('no vlan '+list).join('\n'),/may not be deleted/);
    assert.ok(device.config.vlans[10]);
  }
  accepted(cli,'interface Vlan1');assert.match(cli.execute('storm-control broadcast level 10').join('\n'),/Invalid input/);
  assert.equal(device.config.interfaces.Vlan1.features.stormControl,undefined);
  accepted(cli,'interface g0/1');accepted(cli,'storm-control broadcast level 10 5');
  assert.equal(device.config.interfaces['GigabitEthernet0/1'].features.stormControl.broadcast.rising,10);
});
