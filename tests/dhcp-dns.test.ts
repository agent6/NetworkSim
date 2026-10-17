import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {automaticDHCPDNSRecords} from '../src/dhcp-dns.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';

const port='GigabitEthernet0',g=(n:number)=>'GigabitEthernet0/'+n;
function fixture(domain?:string) {
  const sim=new Simulator(20261016),server=sim.addDevice('server'),client=sim.addDevice('pc'),reader=sim.addDevice('pc'),sw=sim.addDevice('switch');
  client.config.hostname='Workstation'; delete client.config.interfaces[port].features.dhcp;
  Object.assign(server.config.interfaces[port],{ip:'192.0.2.1',mask:'255.255.255.0'});
  Object.assign(reader.config.interfaces[port],{ip:'192.0.2.50',mask:'255.255.255.0'});delete reader.config.interfaces[port].features.dhcp;
  reader.config.dnsServers=['192.0.2.1'];
  server.config.services.dhcp={enabled:true,pools:[{name:'LAN',network:'192.0.2.0',prefix:24,leaseSeconds:60,dnsServers:['192.0.2.1'],domain}],excluded:[{start:'192.0.2.1',end:'192.0.2.9'}]};
  server.config.services.dns={enabled:true,records:{},resourceRecords:[]};
  for(const [i,d] of [server,client,reader].entries()) {sw.config.interfaces[g(i+1)].features.portfast=true;sim.connect({deviceId:d.id,port},{deviceId:sw.id,port:g(i+1)});}
  const records=()=>automaticDHCPDNSRecords(server,sim.clock.now());
  const acquire=()=>{const result=sim.requestDHCP(client.id);sim.advance(1000);assert.equal(result.status,'success',result.error);return result;};
  const query=(name:string,type:any='A')=>{const result=sim.resolveDNS(reader.id,name,{type});sim.advance(500);return result;};
  return {sim,server,client,reader,sw,records,acquire,query};
}

test('DDNS-01 committed DHCP leases publish short and domain A names through delivered DNS packets',()=>{
  const {sim,server,client,records,acquire,query}=fixture('Office.Example.');
  assert.deepEqual(records(),[]);const lease=acquire();
  assert.deepEqual(records().map(r=>[r.name,r.type,r.value]),[['workstation','A',lease.address],['workstation.office.example','A',lease.address]]);
  assert.equal(server.runtime.features.dhcpLeases[0].hostname,'Workstation');
  // Changing a live topology label cannot rewrite a name the server received previously.
  client.config.hostname='Renamed';
  for(const name of ['WORKSTATION.','workstation.office.example']) {
    const result=query(name);assert.equal(result.status,'success');assert.equal(result.address,lease.address);
    assert.ok(result.ttl>0&&result.ttl<60);assert.equal(result.records[0].clientId,undefined);
  }
  assert.equal(server.runtime.features.dnsQueries.length,2);
  assert.ok(sim.events.some(e=>e.nodeId===server.id&&e.disposition==='receive'&&e.packet?.destinationPort===53));
  const nodata=query('workstation','AAAA');assert.equal(nodata.rcode,'NOERROR');assert.deepEqual(nodata.records,[]);
  assert.deepEqual(server.config.services.dns.resourceRecords,[]);assert.deepEqual(server.config.services.dns.records,{});
});

test('DDNS-02 offer reservations are unpublished; hostname comes from received requests',()=>{
  const {sim,server,client,records}=fixture();
  (sim as any).transmit(client,port,'ff:ff:ff:ff:ff:ff',{kind:'dhcp',operation:'discover',clientId:client.id,transaction:'offer-only',hostname:'Offered'});
  sim.advance(500);assert.equal(server.runtime.features.dhcpLeases[0].state,'OFFERED');assert.deepEqual(records(),[]);
  const address=server.runtime.features.dhcpLeases[0].address;
  (sim as any).transmit(client,port,'ff:ff:ff:ff:ff:ff',{kind:'dhcp',operation:'request',clientId:client.id,serverId:server.id,transaction:'ack-only',address,hostname:'Received-Name'});
  sim.advance(500);assert.equal(records()[0].name,'received-name');
});

test('DDNS-03 both services on the same Server gate publication and can be enabled after allocation',()=>{
  const {sim,server,records,acquire,query}=fixture();server.config.services.dns.enabled=false;acquire();assert.deepEqual(records(),[]);
  server.config.services.dns.enabled=true;assert.equal(query('workstation').address,'192.0.2.10');
  server.config.services.dhcp.enabled=false;assert.deepEqual(records(),[]);assert.equal(query('workstation').rcode,'NXDOMAIN');
  server.config.services.dhcp.enabled=true;assert.equal(records().length,1);
  const other=sim.addDevice('server');other.config.services.dhcp={enabled:true};other.config.services.dns={enabled:true};assert.deepEqual(automaticDHCPDNSRecords(other,sim.clock.now()),[]);
  const router=sim.addDevice('router');router.config.services=structuredClone(server.config.services);router.runtime.features.dhcpLeases=structuredClone(server.runtime.features.dhcpLeases);assert.deepEqual(automaticDHCPDNSRecords(router,sim.clock.now()),[]);
});

test('DDNS-04 renewal updates the received hostname and extends the lease without duplicates',()=>{
  const {sim,server,client,records,acquire,query}=fixture('lab.example');acquire();
  const oldExpiry=records()[0].expires;client.config.hostname='New-Name';
  sim.advance(31000);assert.ok(records()[0].expires>oldExpiry);
  assert.equal(server.runtime.features.dhcpLeases.length,1);assert.deepEqual(records().map(r=>r.name),['new-name','new-name.lab.example']);
  assert.equal(query('workstation').rcode,'NXDOMAIN');assert.equal(query('new-name.lab.example').address,'192.0.2.10');
  sim.advance(30000);assert.equal(records().length,2);assert.ok(records()[0].expires>sim.clock.now());
});

test('DDNS-05 delivered release removes records and reacquisition replaces the address',()=>{
  const {sim,server,client,records,acquire,query}=fixture();acquire();sim.releaseDHCP(client.id);sim.advance(500);
  assert.deepEqual(records(),[]);assert.equal(query('workstation').rcode,'NXDOMAIN');
  server.config.services.dhcp.excluded.push({start:'192.0.2.10',end:'192.0.2.10'});acquire();
  assert.equal(query('workstation').address,'192.0.2.11');assert.equal(records().length,1);
});

test('DDNS-06 a powered-off client retains its lease until expiry; resolver TTL never exceeds that expiry',()=>{
  const {sim,client,reader,records,acquire,query}=fixture();acquire();const answer=query('workstation');
  const cached=reader.runtime.features.dnsCache.workstation;assert.ok(cached.expires<=records()[0].expires);
  sim.power(client.id,false);assert.equal(records().length,1);sim.advance(61000);
  assert.deepEqual(records(),[]);assert.ok(cached.expires<=sim.clock.now());assert.equal(query('workstation').rcode,'NXDOMAIN');
  assert.ok(answer.ttl<=60);
});

test('DDNS-07 manual A records and CNAMEs take precedence; deletion reveals the live lease',()=>{
  const {server,records,acquire,query}=fixture('lab.example');
  server.config.services.dns.records={'workstation':'192.0.2.99'};
  server.config.services.dns.resourceRecords=[{name:'workstation.lab.example',type:'CNAME',value:'manual.example',ttl:300},{name:'manual.example',type:'A',value:'192.0.2.98',ttl:300}];acquire();
  assert.deepEqual(records(),[]);assert.equal(query('workstation').address,'192.0.2.99');assert.equal(query('workstation.lab.example').address,'192.0.2.98');
  delete server.config.services.dns.records.workstation;server.config.services.dns.resourceRecords=[];
  assert.equal(records().length,2);assert.equal(query('workstation').address,'192.0.2.10');
});

test('DDNS-08 invalid or missing hostnames do not break DHCP; FQDN and duplicate ownership are deterministic',()=>{
  for(const hostname of ['bad name','<bad>','', 'bad..lab']){const {client,records,acquire}=fixture();client.config.hostname=hostname;acquire();assert.deepEqual(records(),[]);}
  const {sim,client,reader,records,acquire,query}=fixture('lab.example');client.config.hostname='Host.Other.Example.';acquire();assert.deepEqual(records().map(r=>r.name),['host.other.example']);
  sim.releaseDHCP(client.id);sim.advance(100);client.config.hostname='__proto__';acquire();assert.equal(query('__proto__').address,'192.0.2.10');assert.equal((Object.prototype as any).address,undefined);assert.ok(Object.hasOwn(reader.runtime.features.dnsCache,'__proto__'));assert.equal(Object.getPrototypeOf(reader.runtime.features.dnsCache),Object.prototype);
  reader.config.hostname='__proto__';const second=sim.requestDHCP(reader.id);sim.advance(1000);assert.equal(second.status,'success');assert.equal(records().length,2);assert.ok(records().every(r=>r.clientId===client.id));
  sim.releaseDHCP(client.id);sim.advance(100);assert.ok(records().every(r=>r.clientId===reader.id));assert.ok(records().every(r=>r.value===second.address));
});

test('DDNS-09 runtime DNS records do not persist as manual configuration and rebuild on DHCP reacquisition',()=>{
  const {sim,server,client,acquire}=fixture('lab.example');acquire();const doc=parseLabFile(serializeLabFile(sim.serialize()));
  const restored=new Simulator();restored.load(doc);const target=restored.getDevice(server.id)!;
  assert.deepEqual(automaticDHCPDNSRecords(target,restored.clock.now()),[]);assert.deepEqual(target.config.services.dns.resourceRecords,[]);
  restored.advance(5000);assert.equal(automaticDHCPDNSRecords(target,restored.clock.now())[0].clientId,client.id);
  restored.reload(server.id);assert.deepEqual(automaticDHCPDNSRecords(target,restored.clock.now()),[]);
  const renewal=restored.requestDHCP(client.id);restored.advance(1000);assert.equal(renewal.status,'success');assert.equal(automaticDHCPDNSRecords(target,restored.clock.now()).length,2);
});

test('DDNS-10 relayed DHCP carries the hostname and registers only the conflict-free acknowledged address',()=>{
  const sim=new Simulator(),server=sim.addDevice('server'),client=sim.addDevice('pc'),router=sim.addDevice('router'),sw=sim.addDevice('switch'),occupied=sim.addDevice('pc');
  client.config.hostname='Relayed-PC';delete client.config.interfaces[port].features.dhcp;
  for(const [d,p,address] of [[server,port,'10.2.0.20'],[router,g(0),'10.1.0.1'],[router,g(1),'10.2.0.1'],[occupied,port,'10.1.0.10']] as const){Object.assign(d.config.interfaces[p],{ip:address,mask:'255.255.255.0',adminUp:true});delete d.config.interfaces[p].features.dhcp;}
  server.config.defaultGateway='10.2.0.1';server.config.dnsServers=['10.2.0.20'];router.config.interfaces[g(0)].features.helpers=['10.2.0.20'];
  server.config.services.dhcp={enabled:true,pools:[{name:'REMOTE',network:'10.1.0.0',prefix:24,defaultRouter:'10.1.0.1',dnsServers:['10.2.0.20'],domain:'lab.example',leaseSeconds:60}],excluded:[{start:'10.1.0.1',end:'10.1.0.9'}]};server.config.services.dns={enabled:true,records:{}};
  sim.connect({deviceId:router.id,port:g(1)},{deviceId:server.id,port});for(const [i,d]of [router,client,occupied].entries()){sw.config.interfaces[g(i+1)].features.portfast=true;sim.connect({deviceId:d.id,port:d===router?g(0):port},{deviceId:sw.id,port:g(i+1)});}
  const lease=sim.requestDHCP(client.id);sim.advance(3000);assert.equal(lease.status,'success');assert.equal(lease.address,'10.1.0.11');assert.equal(lease.conflicts,1);
  const records=automaticDHCPDNSRecords(server,sim.clock.now());assert.deepEqual(records.map(r=>[r.name,r.value]),[['relayed-pc','10.1.0.11'],['relayed-pc.lab.example','10.1.0.11']]);
  const lookup=sim.resolveDNS(client.id,'relayed-pc.lab.example');sim.advance(500);assert.equal(lookup.address,lease.address);assert.ok(sim.events.some(e=>e.label==='Address declined'));
});
