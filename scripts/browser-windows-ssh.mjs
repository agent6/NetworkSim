import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {serializeLabFile} from '../src/persistence.ts';
const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sim=new Simulator(20261017),pc=sim.addDevice('pc',250,250),server=sim.addDevice('server',250,480),router=sim.addDevice('router',750,250),disabled=sim.addDevice('router',750,480),sw=sim.addDevice('l3switch',500,350),password='WindowsSSH123',port='GigabitEthernet0';
const run=(d,...lines)=>{const cli=new IOSSession(sim,d.id);for(const line of lines){const output=cli.execute(line);assert.ok(!output.some(row=>row.startsWith('%')),line+': '+output.join('\n'));}};
for(const[i,[d,p,address]]of [[pc,port,'192.0.2.10'],[server,port,'192.0.2.53'],[router,'GigabitEthernet0/0','192.0.2.1'],[disabled,'GigabitEthernet0/0','192.0.2.3']].entries()) {
  Object.assign(d.config.interfaces[p],{ip:address,mask:'255.255.255.0',adminUp:true});delete d.config.interfaces[p].features.dhcp;sw.config.interfaces['GigabitEthernet0/'+(i+1)].features.portfast=true;sim.connect({deviceId:d.id,port:p},{deviceId:sw.id,port:'GigabitEthernet0/'+(i+1)});
}
run(sw,'enable','conf t','interface Vlan1','ip address 192.0.2.2 255.255.255.0','no shutdown','end');
for(const d of [sw,router])run(d,'enable','conf t','ip domain-name lab.example','crypto key generate rsa modulus 2048','ip ssh version 2','ip ssh authentication-retries 2',`username admin privilege 15 secret ${password}`,'line vty 0 4','login local','transport input ssh','end');
run(disabled,'enable','conf t',`username admin privilege 15 secret ${password}`,'line vty 0 4','login local','transport input telnet','end');
pc.config.dnsServers=['192.0.2.53'];server.config.services.dns={enabled:true,records:{'router.lab':'192.0.2.1','switch.lab':'192.0.2.2'}};
const folder='.cache/windows-ssh-browser';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const input=page.locator('#terminal-input'),output=page.locator('#terminal-output'),prompt=page.locator('#terminal-prompt'),check=name=>{checks.push(name);console.log('PASS',name);};
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');
const openCLI=async name=>{await node(name).dblclick();await page.locator('[data-desktop=cli]').click();assert.equal(await prompt.textContent(),'C:\\>');};
const command=async line=>{const before=(await output.textContent()).length;await input.fill(line);await input.press('Enter');return (await output.textContent()).slice(before);};
const login=async(line,expected)=>{await command(line);assert.equal(await prompt.textContent(),'Password:');assert.equal(await input.getAttribute('type'),'password');await command(password);assert.equal(await prompt.textContent(),expected);assert.equal(await input.getAttribute('type'),'text');};
try {
  await page.goto(pathToFileURL(process.cwd()+'/index.html').href);await page.locator('#import-input').setInputFiles({name:'windows-ssh.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(serializeLabFile(sim.serialize()))});await openCLI('PC1');
  assert.match(await command('ssh /?'),/usage: ssh[\s\S]*-p port[\s\S]*-l login_name/);assert.match(await command('ssh -p nope admin@192.0.2.1'),/ssh: Bad port/);assert.equal(await prompt.textContent(),'C:\\>');
  check('Windows command prompt provides SSH help and controlled option errors');
  await command('ssh admin@router.lab');assert.equal(await prompt.textContent(),'Password:');assert.equal(await input.getAttribute('type'),'password');await command('WrongSSHPassword');assert.equal(await prompt.textContent(),'Password:');await command(password);assert.equal(await prompt.textContent(),'R1#');
  assert.ok(!(await output.textContent()).includes(password));assert.ok(!(await output.textContent()).includes('WrongSSHPassword'));
  check('Hostname SSH resolves through DNS, masks passwords and retries the same username after a failed password');
  assert.match(await command('show ip interface brief'),/192\.0\.2\.1/);await command('configure terminal');await command('hostname SSH-Router');await command('end');assert.equal(await prompt.textContent(),'SSH-Router#');
  check('Authenticated Windows SSH controls the remote router and reflects its changed hostname');
  await command('terminal length 0');await input.fill('show ip rou');await input.press('Tab');assert.equal(await input.inputValue(),'show ip route ');await input.fill('show ip ');const helpOffset=(await output.textContent()).length;await input.press('?');assert.match((await output.textContent()).slice(helpOffset),/interface/);assert.equal(await input.inputValue(),'show ip ');
  check('Remote IOS Tab and question-mark help work inside the Windows SSH session');await page.screenshot({path:folder+'/pc-ssh-router.png'});
  assert.match(await command('exit'),/Connection closed/);assert.equal(await prompt.textContent(),'C:\\>');assert.match(await command('hostname'),/PC1\n$/);
  check('Exit restores the local Windows prompt and local command routing');
  await login('ssh -l admin -p 22 192.0.2.2','DSW1#');assert.match(await command('show vlan brief'),/default/);await command('exit');assert.equal(await prompt.textContent(),'C:\\>');
  check('Windows -l and -p options authenticate to a configured switch management SVI');
  for(const line of ['ssh admin@192.0.2.3','ssh -p 23 admin@192.0.2.3','ssh -p 2222 admin@192.0.2.1','ssh admin@missing.lab']){assert.match(await command(line),/ssh:|protocol negotiation failed/i);assert.equal(await prompt.textContent(),'C:\\>');assert.equal(await input.getAttribute('type'),'text');}
  check('SSH-disabled targets, a Telnet listener, an unopened port and failed DNS do not open a session');
  await command('ssh admin@192.0.2.1');assert.equal(await prompt.textContent(),'Password:');await input.press('Control+c');assert.equal(await prompt.textContent(),'C:\\>');assert.equal(await input.getAttribute('type'),'text');
  check('Ctrl-C during login closes the pending SSH session and restores normal input');
  await page.locator('[data-action=close-dock]').click();await openCLI('SRV1');await login('ssh.exe -p22 admin@192.0.2.2','DSW1#');assert.match(await command('show ip ssh'),/keys present/);await command('exit');assert.equal(await prompt.textContent(),'C:\\>');assert.match(await command('hostname'),/SRV1\n$/);
  check('Windows Server command prompt also supports the ssh.exe client and returns to its own shell');
  assert.deepEqual(errors,[]);check('No browser page errors');
  await writeFile('docs/testing/windows-ssh-browser-results.json',JSON.stringify({generatedAt:new Date().toISOString(),browser:await browser.version(),fixture:'Isolated public YAML import and Windows PC/Server desktops in standalone file:// app',checks,errors,artifact:{file:'index.html',sha256:createHash('sha256').update(await readFile('index.html')).digest('hex')}},null,2)+'\n');
}catch(error){await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;}finally{await browser.close();}
