import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {Simulator} from '../src/engine.ts';
import {transferSSHFile} from '../src/ssh-files.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {IOSSession} from '../src/cli.ts';
// The UI module imports its decorative sprite; no image bytes are needed for form behavior.
const assets=registerHooks({load(url,context,next){return url.endsWith('.png')?{format:'module',source:'export default "";',shortCircuit:true}:next(url,context);}});
const {showServices}=await import('../src/services-ui.ts');
assets.deregister();

function form(){const data=new FormData();data.set('stratum','1');data.set('dhcp-excluded','');data.set('html','<h1>Service</h1>');data.set('http-auth','none');data.set('http-auth-list','default');data.set('http-base','');data.set('http-enable-password','');return data;}
function dialog(engine=new Simulator(2025),server=engine.addDevice('server')){let save:(data:FormData)=>void=()=>{};let markup='';const before=globalThis.document;Object.assign(globalThis,{document:{querySelector:()=>({addEventListener:()=>{},querySelectorAll:()=>[],querySelector:()=>null,isConnected:false})}});try{showServices(server,(_title,html,callback)=>{markup=html;save=callback;},work=>{work();engine.changed();},engine);}finally{Object.assign(globalThis,{document:before});}return {engine,server,save,markup};}
function pool(data:FormData,network='192.0.2.0',gateway='192.0.2.1',lease='3600'){for(const[key,value]of Object.entries({'pool-name':'LAN','pool-network':network,'pool-prefix':'24','pool-gateway':gateway,'pool-dns':'192.0.2.20','pool-lease':lease}))data.append(key,value);}

test('SVC-GUI-01 DHCP invalid subnet, reversed exclusions, and fractional leases reject transactionally',()=>{for(const scenario of ['network','gateway','exclusion','lease']){const {server,save}=dialog(),data=form();server.config.services.http={enabled:true,content:'original'};pool(data,scenario==='network'?'192.0.2.10':'192.0.2.0',scenario==='gateway'?'198.51.100.1':'192.0.2.1',scenario==='lease'?'60.5':'3600');data.set('dhcp-excluded',scenario==='exclusion'?'192.0.2.30 - 192.0.2.10':'192.0.2.1 - 192.0.2.20');const before=JSON.stringify(server.config);assert.throws(()=>save(data),/network address|gateway|exclusion range|lease times/);assert.equal(JSON.stringify(server.config),before);}});

test('SVC-GUI-02 removed file-transfer services have no controls and legacy form fields cannot enable them',()=>{
  const {server,save,markup}=dialog(),data=form();
  server.config.services.tftp={enabled:true,files:{'old.cfg':'retained'}};
  server.config.services.sshFiles={enabled:true,files:{'old.txt':'retained'}};
  assert.ok(!/data-service-(?:tab|section)="(?:TFTP|SCP \/ SFTP)"/.test(markup));
  assert.ok(!/name="(?:tftp-|ssh-files)/.test(markup));
  data.set('tftp-enabled','on');data.set('tftp-name','ignored');data.set('tftp-body','ignored');data.set('ssh-files-enabled','on');data.set('ssh-files','invalid legacy input');
  save(data);assert.equal(server.config.services.tftp.enabled,false);assert.equal(server.config.services.sshFiles.enabled,false);
  assert.equal(server.config.services.tftp.files['old.cfg'],'retained');assert.equal(server.config.services.sshFiles.files['old.txt'],'retained');
});

test('SVC-GUI-03 saved server transfer services stay disabled after load and reject delivered reads and writes',()=>{
  const engine=new Simulator(55),server=engine.addDevice('server'),client=engine.addDevice('pc');
  Object.assign(server.config.interfaces.GigabitEthernet0,{ip:'192.0.2.20',mask:'255.255.255.0'});
  Object.assign(client.config.interfaces.GigabitEthernet0,{ip:'192.0.2.10',mask:'255.255.255.0'});
  engine.connect({deviceId:client.id,port:'GigabitEthernet0'},{deviceId:server.id,port:'GigabitEthernet0'});
  server.config.features.users={admin:{password:'lab-password',privilege:15}};
  server.config.services.tftp={enabled:true,files:{'old.cfg':'retained'}};server.config.services.sshFiles={enabled:true,files:{'old.txt':'retained'}};
  server.startupConfig=structuredClone(server.config);
  const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(engine.serialize())));
  const target=restored.getDevice(server.id)!;
  for(const config of [target.config,target.startupConfig!])for(const name of ['tftp','sshFiles'])assert.equal(config.services[name].enabled,false);
  // Listener guards must also reject a stale flag introduced without recompute.
  target.config.services.tftp.enabled=true;target.config.services.sshFiles.enabled=true;
  const requests=[restored.tftpGet(client.id,'192.0.2.20','old.cfg'),restored.tftpPut(client.id,'192.0.2.20','new.cfg','blocked')];
  for(const protocol of ['scp','sftp'] as const)for(const operation of ['read','write'] as const)requests.push(transferSSHFile(restored,client.id,'192.0.2.20',{protocol,operation,path:'old.txt',content:'blocked',username:'admin',password:'lab-password'}));
  restored.advance(10000);for(const result of requests)assert.equal(result.status,'failure');
  assert.equal(target.config.services.tftp.files['old.cfg'],'retained');assert.equal(target.config.services.tftp.files['new.cfg'],undefined);assert.equal(target.config.services.sshFiles.files['old.txt'],'retained');
  assert.ok(!new IOSSession(restored,target.id).execute('netstat -an').join('\n').match(/0\.0\.0\.0:69\b/));
  restored.reload(target.id);assert.equal(target.config.services.tftp.enabled,false);assert.equal(target.config.services.sshFiles.enabled,false);
});

test('SVC-GUI-04 Syslog receiver displays packet metadata and never substitutes its own local log',()=>{const {engine,server}=dialog();server.runtime.logs=['LOCAL ONLY'];server.runtime.features.syslogReceived=[{source:'192.0.2.1',hostname:'R1',facility:23,severity:5,timestamp:'2026-10-16T12:00:00Z',message:'Interface up',received:123}];const {markup}=dialog(engine,server);assert.match(markup,/192\.0\.2\.1 \(R1\) facility=23 severity=5: Interface up/);assert.match(markup,/2026-10-16T12:00:00Z/);assert.ok(!markup.includes('LOCAL ONLY'));});

test('SVC-GUI-05 DHCP lease view reflects packet-backed allocation, release and expiry',()=>{
  const engine=new Simulator(2026),server=engine.addDevice('server'),client=engine.addDevice('pc');
  client.config.hostname='PC <Lab>';
  Object.assign(server.config.interfaces.GigabitEthernet0,{ip:'192.0.2.1',mask:'255.255.255.0'});
  server.config.services.dhcp={enabled:true,pools:[{name:'LAN',network:'192.0.2.0',prefix:24,leaseSeconds:60}],excluded:[{start:'192.0.2.1',end:'192.0.2.9'}]};
  engine.connect({deviceId:client.id,port:'GigabitEthernet0'},{deviceId:server.id,port:'GigabitEthernet0'});
  assert.match(dialog(engine,server).markup,/No active leases/);
  const result=engine.requestDHCP(client.id);engine.advance(5000);assert.equal(result.status,'success');
  const {markup}=dialog(engine,server);
  assert.match(markup,/data-dhcp-lease="192\.0\.2\.10"/);
  assert.match(markup,/PC &lt;Lab&gt;/);
  assert.ok(markup.includes(engine.macOf(client.id,'GigabitEthernet0')));
  assert.match(markup,/data-lease-remaining>5\ds</);
  assert.ok(!markup.includes('PC <Lab>'));
  const other=engine.addDevice('server');assert.match(dialog(engine,other).markup,/No active leases/);
  engine.releaseDHCP(client.id);engine.advance(1000);
  assert.match(dialog(engine,server).markup,/No active leases/);
  const renewed=engine.requestDHCP(client.id);engine.advance(5000);assert.equal(renewed.status,'success');
  engine.power(client.id,false);engine.advance(61000);
  assert.match(dialog(engine,server).markup,/No active leases/);
});

test('SVC-GUI-06 explicit prototype-named users are ordinary account keys; absent password fields reject',()=>{const {server,save}=dialog(),data=form();for(const protocol of ['radius','tacacs','http-local'])for(const name of ['constructor','toString','__proto__']){data.append(protocol+'-user',name);data.append(protocol+'-password','lab-secret');data.append(protocol+'-privilege','15');}save(data);for(const users of [server.config.features.users,server.config.services.radius.users,server.config.services.tacacs.users])for(const name of ['constructor','toString','__proto__']){assert.ok(Object.hasOwn(users,name));assert.equal(users[name].password,'lab-secret');}assert.equal((Object.prototype as any).password,undefined);const missing=form();missing.append('radius-user','missing');missing.append('radius-privilege','15');const before=JSON.stringify(server.config);assert.throws(()=>save(missing),/username, password/);assert.equal(JSON.stringify(server.config),before);});

test('SVC-GUI-07 AAA received accounting log contains delivered records and escapes command text',()=>{const {engine,server}=dialog(),client=engine.addDevice('router');engine.connect({deviceId:client.id,port:'GigabitEthernet0/0'},{deviceId:server.id,port:'GigabitEthernet0'});Object.assign(client.config.interfaces['GigabitEthernet0/0'],{adminUp:true,ip:'192.0.2.1',mask:'255.255.255.0'});Object.assign(server.config.interfaces.GigabitEthernet0,{ip:'192.0.2.2',mask:'255.255.255.0'});server.config.services.tacacs={enabled:true,secret:'shared'};engine.changed();const result=engine.tcpRequest(client.id,'192.0.2.2',49,{operation:'accounting',key:'shared',record:{eventId:'gui-1',sessionId:'vty-1',username:'<student>',line:'vty 0',source:'192.0.2.1',kind:'commands',status:'stop',time:0,privilege:15,command:'description <example>'}});engine.advance(500);assert.equal(result.accounted,true);const {markup}=dialog(engine,server);assert.match(markup,/data-aaa-accounting/);assert.match(markup,/tacacs 192\.0\.2\.1 &lt;student&gt; vty 0 commands stop/);assert.match(markup,/command=description &lt;example&gt;/);assert.ok(!markup.includes('description <example>'));assert.match(markup,/1 stored · 0 duplicate retries · 0 rejected/);});
