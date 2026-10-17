import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { defaultInterface, type Device } from '../src/model.ts';
const port='GigabitEthernet0/0';
function address(d:Device,name:string,ip:string,mask='255.255.255.0'){const i=d.config.interfaces[name]??=defaultInterface(name,false);Object.assign(i,{adminUp:true,switchport:false,ip,mask});return i;}
function ospf(d:Device,id:string){d.config.protocols.ospf={processId:1,routerId:id,networks:[{network:'0.0.0.0',prefix:0,area:0}]};d.config.interfaces[port].features.ospf={helloInterval:1,deadInterval:3};}
function pair(seed=400){const s=new Simulator(seed),a=s.addDevice('router'),b=s.addDevice('router');address(a,port,'10.0.0.1');address(b,port,'10.0.0.2');address(b,'Loopback0','192.0.2.2','255.255.255.255');ospf(a,'1.1.1.1');ospf(b,'2.2.2.2');const wire=s.connect({deviceId:a.id,port},{deviceId:b.id,port});return{s,a,b,wire};}
const route=(d:Device,n='192.0.2.2')=>d.runtime.routes.find(r=>r.protocol.startsWith('O')&&r.network===n);

test('OSPF CP installs prefixes only after received database exchange and expires under loss without link down',()=>{
  const{s,a,wire}=pair();assert.equal(route(a),undefined);s.advance(1500);assert.ok(route(a));assert.equal(a.runtime.neighbors.find(n=>n.protocol==='OSPF')?.state,'FULL');assert.ok(a.runtime.features.ospfPackets.ospf.lsdb.length>=2);
  wire.loss=1;s.advance(1000);assert.ok(route(a),'dead timer keeps last received topology briefly');s.advance(2500);assert.equal(wire.enabled,true);assert.equal(route(a),undefined);assert.equal(a.runtime.neighbors.find(n=>n.protocol==='OSPF')?.state,'DOWN');wire.loss=0;s.advance(2000);assert.ok(route(a));
});

test('OSPF CP keeps the received remote prefix snapshot until its replacement LSA traverses the data plane',()=>{
  const{s,a,b,wire}=pair(401);s.advance(1500);assert.ok(route(a));wire.loss=1;b.config.interfaces.Loopback0.ip='198.51.100.2';s.changed();assert.ok(route(a),'remote configuration cannot directly rewrite the observer LSDB');assert.equal(route(a,'198.51.100.2'),undefined);s.advance(200);assert.ok(route(a));
  wire.loss=0;s.advance(1600);assert.equal(route(a),undefined);assert.ok(route(a,'198.51.100.2'));
});

test('OSPF installed control-plane reachability cannot manufacture a successful echo during packet loss',()=>{
  const{s,a,wire}=pair(402);s.advance(1500);wire.loss=1;assert.ok(route(a));const result=s.ping(a.id,'192.0.2.2',{count:1,timeout:500});s.advance(600);assert.equal(result.received,0);assert.ok(route(a),'the route remains present before its dead timer, independently of failed traffic');
});

test('OSPFv3 does not originate tentative or duplicate configured IPv6 prefixes',()=>{
  const s=new Simulator(403),a=s.addDevice('router'),b=s.addDevice('router'),duplicate=s.addDevice('pc'),access='GigabitEthernet0/1';
  for(const[d,id,address]of[[a,'1.1.1.1','2001:db8:10::1/64'],[b,'2.2.2.2','2001:db8:10::2/64']]as const){
    d.config.ipv6Routing=true;d.config.protocols.ospfv3={processId:1,routerId:id};Object.assign(d.config.interfaces[port],{adminUp:true,switchport:false,ipv6:[address]});d.config.interfaces[port].features.ospfv3={area:0,helloInterval:1,deadInterval:3};
  }
  Object.assign(b.config.interfaces[access],{adminUp:true,switchport:false,ipv6:['2001:db8:bad::2/64']});b.config.interfaces[access].features.ospfv3={area:0};duplicate.config.interfaces.GigabitEthernet0.ipv6=['2001:db8:bad::2/64'];
  s.connect({deviceId:a.id,port},{deviceId:b.id,port});s.connect({deviceId:b.id,port:access},{deviceId:duplicate.id,port:'GigabitEthernet0'});
  assert.equal(b.runtime.routes.some(r=>r.network==='2001:db8:bad::'&&r.protocol==='connected'),false);s.advance(2500);
  assert.equal(b.runtime.features.staticIPv6Dad[access]['2001:db8:bad::2'].state,'duplicate');
  assert.equal(a.runtime.neighbors.find(n=>n.protocol==='OSPFV3')?.state,'FULL');
  assert.equal(a.runtime.routes.some(r=>r.network==='2001:db8:bad::'),false,'A configured but unusable address cannot leak through the control-plane adapter');
  b.config.interfaces[access].ipv6=['2001:db8:beef::2/64'];s.changed();
  assert.equal(a.runtime.routes.some(r=>r.network==='2001:db8:beef::'),false);s.advance(2500);
  assert.ok(a.runtime.routes.some(r=>r.network==='2001:db8:beef::'&&r.protocol==='O'),'A unique replacement is advertised only after DAD and LSA delivery');
});
