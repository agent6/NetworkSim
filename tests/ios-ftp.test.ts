import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {WindowsSession} from '../src/windows-cli.ts';
import {encodeType7} from '../src/credentials.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';

function fixture(){
 const e=new Simulator(),r=e.addDevice('router'),server=e.addDevice('server');
 Object.assign(r.config.interfaces['GigabitEthernet0/0'],{adminUp:true,ip:'192.0.2.1',mask:'255.255.255.0'});
 Object.assign(server.config.interfaces.GigabitEthernet0,{adminUp:true,ip:'192.0.2.2',mask:'255.255.255.0'});
 delete server.config.interfaces.GigabitEthernet0.features.dhcp;
 server.config.services.ftp={enabled:true,readOnly:false,users:{admin:{password:'FtpPass123'}},files:{'hello.txt':'Hello FTP 🌐\n','good.cfg':'hostname FTPImported\n','bad.cfg':'hostname BadImport\nthis-is-not-ios\n'}};
 e.connect({deviceId:r.id,port:'GigabitEthernet0/0'},{deviceId:server.id,port:'GigabitEthernet0'});
 const cli=new IOSSession(e,r.id);cli.execute('enable');return {e,r,server,cli};
}
function command(cli:IOSSession,line:string){const out=cli.execute(line);assert.ok(!out.some(x=>/^%/.test(x)),line+'\n'+out.join('\n'));return out.join('\n');}
test('FTPCLI-01 native FTP URL copy downloads and confirms uploads through real control/data TCP channels',()=>{
 const {e,r,server,cli}=fixture();
 assert.match(command(cli,'copy ftp://admin:FtpPass123@192.0.2.2/hello.txt flash:hello.txt'),/\[OK - 15 bytes\]/);
 assert.equal(r.config.features.files['hello.txt'],'Hello FTP 🌐\n');
 assert.deepEqual(cli.execute('copy flash:hello.txt ftp://admin:FtpPass123@192.0.2.2/upload.txt'),[]);
 assert.match(cli.prompt,/Write file upload.txt on host 192\.0\.2\.2\? \[confirm\]/);assert.equal(cli.passwordInput,false);assert.ok(!Object.hasOwn(server.config.services.ftp.files,'upload.txt'));
 assert.match(command(cli,''),/bytes copied/);assert.equal(server.config.services.ftp.files['upload.txt'],'Hello FTP 🌐\n');
 assert.ok(e.events.some(x=>x.packet?.destinationPort===21&&x.packet?.tcpFlags==='SYN'));
 assert.ok(e.events.some(x=>x.packet?.destinationPort!>=50000&&x.packet?.destinationPort!<=50031&&x.packet?.tcpFlags==='SYN'));
 assert.ok(!cli.execute('show history').join('\n').includes('\nFtpPass123\n'));
});
test('FTPCLI-02 configured FTP credentials, Type 7 render/import, interactive copy and native aliases persist',()=>{
 const {e,r,server,cli}=fixture();
 for(const line of['conf t','ip ftp username admin','ip ftp password 7 '+encodeType7('FtpPass123'),'ip ftp passive','ip ftp source-interface GigabitEthernet 0/0','end'])command(cli,line);
 const running=command(cli,'show running-config');assert.match(running,/ip ftp password 7 [0-9A-F]+/i);assert.ok(!running.includes('ip ftp password 0 FtpPass123'));
 assert.deepEqual(cli.execute('copy ftp: flash:interactive.txt'),[]);assert.match(cli.prompt,/remote host/);command(cli,'192.0.2.2');assert.match(cli.prompt,/Source filename/);assert.match(command(cli,'hello.txt'),/bytes copied/);
 assert.equal(r.config.features.files['interactive.txt'],'Hello FTP 🌐\n');
 assert.match(command(cli,'copy ftp://192.0.2.2/good.cfg system:running-config'),/\[OK - \d+ bytes\]\n\n\d+ bytes copied in \d+\.\d{3} secs \(\d+ bytes\/sec\)$/);assert.equal(r.config.hostname,'FTPImported');
 command(cli,'copy running-config startup-config');assert.match(cli.prompt,/Destination filename \[startup-config\]\?/);assert.match(command(cli,''),/Building configuration\.\.\.\n\[OK\]/);
 const parsed=parseLabFile(serializeLabFile(e.serialize())),loaded=new Simulator();loaded.load(parsed);const rr=loaded.getDevice(r.id)!;assert.equal(rr.config.features.ftpClient.password,'FtpPass123');assert.equal(rr.startupConfig?.features.ftpClient.passwordType,7);
 const restored=new IOSSession(loaded,r.id);restored.execute('enable');assert.match(command(restored,'copy ftp://192.0.2.2/hello.txt flash:restored.txt'),/bytes copied/);assert.equal(rr.config.features.files['restored.txt'],'Hello FTP 🌐\n');
 for(const line of['conf t','no ip ftp password','default ip ftp username','no ip ftp source-interface','default ip ftp passive','end'])command(cli,line);
 assert.equal(r.config.features.ftpClient,undefined);assert.equal(server.config.services.ftp.enabled,true);
});
test('FTPCLI-03 rejection and cancellation are truthful and configuration imports roll back atomically',()=>{
 const {e,r,server,cli}=fixture(),original=r.config.hostname;
 assert.match(cli.execute('copy ftp://admin:wrong@192.0.2.2/hello.txt flash:denied.txt').join('\n'),/%Error opening.*(?:auth|login|password|530)/i);assert.equal(r.config.features.files?.['denied.txt'],undefined);
 assert.match(cli.execute('copy ftp://admin:FtpPass123@192.0.2.2/bad.cfg running-config').join('\n'),/import rejected/);assert.equal(r.config.hostname,original);
 cli.execute('copy running-config ftp://admin:FtpPass123@192.0.2.2/cancel.txt');cli.cancel();assert.ok(!Object.hasOwn(server.config.services.ftp.files,'cancel.txt'));assert.equal(cli.prompt,original+'#');
 cli.execute('copy ftp: flash:cancel.txt');cli.cancel();assert.equal(cli.prompt,original+'#');
 for(const line of['conf t','ip ftp username admin','ip ftp password FtpPass123'])command(cli,line);const before=JSON.stringify(r.config);
 for(const line of['ip ftp password 8 nope','ip ftp passive extra','no ip ftp username extra','ip ftp source-interface Bad9']){assert.ok(cli.execute(line).some(x=>/^%/.test(x)),line);assert.equal(JSON.stringify(r.config),before,line);}
 command(cli,'end');server.config.services.ftp.enabled=false;assert.match(cli.execute('copy ftp://192.0.2.2/hello.txt flash:disabled.txt').join('\n'),/%Error opening/);assert.equal(r.config.features.files?.['disabled.txt'],undefined);assert.ok(e.events.some(x=>x.packet?.destinationPort===21));
});
test('FTPCLI-04 data-channel ACL denial cannot fabricate a completed upload',()=>{
 const {e,r,server,cli}=fixture();
 const transit=e.addDevice('router');e.disconnect(e.lab.links[0].id);
 r.config.interfaces['GigabitEthernet0/0'].ip='10.0.0.1';
 Object.assign(transit.config.interfaces['GigabitEthernet0/0'],{adminUp:true,ip:'10.0.0.2',mask:'255.255.255.0'});
 Object.assign(transit.config.interfaces['GigabitEthernet0/1'],{adminUp:true,ip:'192.0.2.1',mask:'255.255.255.0'});
 server.config.defaultGateway='192.0.2.1';
 e.connect({deviceId:r.id,port:'GigabitEthernet0/0'},{deviceId:transit.id,port:'GigabitEthernet0/0'});e.connect({deviceId:transit.id,port:'GigabitEthernet0/1'},{deviceId:server.id,port:'GigabitEthernet0'});
 for(const line of['conf t','ip route 192.0.2.0 255.255.255.0 10.0.0.2','end','copy running-config flash:upload.cfg'])command(cli,line);
 const c=new IOSSession(e,transit.id);for(const line of['enable','conf t','ip access-list extended FTPDATA','deny tcp any any range 50000 50031','permit ip any any','exit','interface g0/1','ip access-group FTPDATA out','end'])command(c,line);
 command(cli,'copy flash:upload.cfg ftp://admin:FtpPass123@192.0.2.2/blocked.cfg');assert.match(cli.prompt,/confirm/);assert.match(cli.execute('').join('\n'),/%Error opening/);assert.ok(!Object.hasOwn(server.config.services.ftp.files,'blocked.cfg'));
 assert.ok(e.events.some(x=>x.disposition==='drop'&&x.packet?.destinationPort!>=50000&&x.packet?.destinationPort!<=50031));
 assert.ok(!Object.hasOwn(r.config.features.files,'blocked.cfg'));
});
test('FTPCLI-05 native anonymous/default password ordering and actual Server listener visibility',()=>{
 const {r,server,cli,e}=fixture();
 server.config.services.ftp.users.anonymous={password:'anonymous@'+r.config.hostname+'.'};
 assert.match(command(cli,'copy ftp://192.0.2.2/hello.txt flash:anonymous.txt'),/bytes copied/);assert.equal(r.config.features.files['anonymous.txt'],'Hello FTP 🌐\n');
 const host=new WindowsSession(e,server.id);assert.match(host.execute('netstat -an').join('\n'),/TCP\s+0\.0\.0\.0:21\s+0\.0\.0\.0:0\s+LISTENING/);
 server.config.services.ftp.enabled=false;assert.ok(!/0\.0\.0\.0:21\s/.test(host.execute('netstat -an').join('\n')));
});
test('FTPCLI-06 source-interface changes actual FTP packet source and a down interface falls back to egress',()=>{
 const {e,r,server,cli}=fixture();server.config.defaultGateway='192.0.2.1';
 for(const line of['conf t','interface Loopback11','ip address 198.51.100.1 255.255.255.255','exit','ip ftp source-interface Loopback11','ip ftp username admin','ip ftp password FtpPass123','end'])command(cli,line);
 const before=e.events.length;command(cli,'copy ftp://192.0.2.2/hello.txt flash:loopback.txt');
 assert.ok(e.events.slice(before).some(x=>x.packet?.destinationPort===21&&x.packet.source==='198.51.100.1'));
 for(const line of['conf t','interface Loopback11','shutdown','end'])command(cli,line);
 const fallback=e.events.length;command(cli,'copy ftp://192.0.2.2/hello.txt flash:fallback.txt');
 assert.ok(e.events.slice(fallback).some(x=>x.packet?.destinationPort===21&&x.packet.source==='192.0.2.1'));
 assert.equal(r.config.features.files['loopback.txt'],r.config.features.files['fallback.txt']);
});
test('FTPCLI-07 accepted whitespace passwords and imported quote conflicts survive rendered configuration re-import',()=>{
 const {r,cli}=fixture();
 for(const password of['two words',`a'quoted word`,'a"quoted word',`'quoted'`,'"quoted"',`both'" quote kinds`]){
  command(cli,'conf t');
  if(password.includes('"')&&password.includes("'"))r.config.features.ftpClient={password,passwordType:0};
  else command(cli,'ip ftp password '+(password.includes('"')?"'"+password+"'":'"'+password+'"'));
  command(cli,'end');command(cli,'copy running-config flash:credentials.cfg');
  command(cli,'conf t');command(cli,'no ip ftp password');command(cli,'end');
  assert.match(command(cli,'copy flash:credentials.cfg running-config'),/^\d+ bytes copied in \d+\.\d{3} secs \(\d+ bytes\/sec\)$/);
  assert.equal(r.config.features.ftpClient.password,password);
 }
});
