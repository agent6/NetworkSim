import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Simulator} from '../src/engine.ts';
import {serializeLabFile} from '../src/persistence.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sim=new Simulator(20261016),server=sim.addDevice('server',650,250),client=sim.addDevice('pc',250,250),reader=sim.addDevice('pc',250,450),sw=sim.addDevice('switch',450,350),port='GigabitEthernet0';
for(const [d,ip]of [[server,'192.0.2.1'],[client,'192.0.2.60'],[reader,'192.0.2.50']]){Object.assign(d.config.interfaces[port],{ip,mask:'255.255.255.0'});delete d.config.interfaces[port].features.dhcp;}
reader.config.dnsServers=['192.0.2.1'];server.config.services.dns={enabled:false,records:{'intranet.lab':'192.0.2.1'}};
server.config.services.dhcp={enabled:true,pools:[{name:'LAN',network:'192.0.2.0',prefix:24,dnsServers:['192.0.2.1'],leaseSeconds:60}],excluded:[{start:'192.0.2.1',end:'192.0.2.9'}]};
for(const [i,d]of [server,client,reader].entries()){const p='GigabitEthernet0/'+(i+1);sw.config.interfaces[p].features.portfast=true;sim.connect({deviceId:d.id,port},{deviceId:sw.id,port:p});}
const folder='.cache/dhcp-dns-browser';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=name=>{checks.push(name);console.log('PASS',name);};
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');
const close=()=>page.locator('[data-action=close-dialog]').first().click(),save=()=>page.locator('button[form=dialog-form]').click(),tab=name=>page.locator(`[data-service-tab="${name}"]`);
const services=async()=>{await node('SRV1').dblclick();await page.locator('[data-desktop=services]').click();};
const cli=async name=>{await node(name).dblclick();await page.locator('[data-desktop=cli]').click();};
const command=async line=>{await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');};
const closeConsole=()=>page.locator('[data-action=close-dock]').click();
const lookup=async()=>{await node('PC2').dblclick();await page.locator('[data-desktop=tools]').click();await page.locator('[data-network-fields] [name=name]').fill('pc1.lab.example');await page.locator('[data-network-run]').click();return JSON.parse(await page.locator('[data-network-output]').textContent());};
try {
  await page.goto(pathToFileURL(process.cwd()+'/index.html').href);
  await page.locator('#import-input').setInputFiles({name:'dhcp-dns.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(serializeLabFile(sim.serialize()))});
  await services();assert.match(await page.locator('[data-dhcp-dns-empty]').textContent(),/Enable DHCP and DNS/);
  await tab('DHCP').click();await page.locator('[name=pool-domain]').fill('Lab.Example.');await save();
  await services();await tab('DHCP').click();assert.equal(await page.locator('[name=pool-domain]').inputValue(),'lab.example');await close();
  check('DHCP offers an optional validated DNS domain, saved independently of DNS enablement');
  await cli('PC1');await command('netsh interface ipv4 set address Ethernet dhcp');await command('ipconfig /all');assert.match(await page.locator('#terminal-output').textContent(),/192\.0\.2\.10/);await closeConsole();
  await services();assert.equal(await page.locator('[data-dhcp-dns-row]').count(),0);await page.locator('[name=dns-enabled]').check();await save();
  await services();assert.equal(await page.locator('[data-dhcp-dns-row]').count(),2);
  for(const name of ['pc1','pc1.lab.example'])assert.match(await page.locator(`[data-dhcp-dns-row="${name}"]`).textContent(),/192\.0\.2\.10/);
  assert.equal(await page.locator('[data-dns-row]').count(),1);assert.equal(await page.locator('[data-dhcp-dns] input,[data-dhcp-dns] button').count(),0);
  check('Enabling DNS after a real DHCP allocation publishes short and domain A names as read-only rows');
  await page.locator('[name=record-name]').fill('unsaved.lab');const ttl=await page.locator('[data-dhcp-dns-row="pc1"] td').last().textContent();
  await page.waitForFunction(previous=>document.querySelector('[data-dhcp-dns-row="pc1"] td:last-child')?.textContent!==previous,ttl,{timeout:5000});
  assert.equal(await page.locator('[name=record-name]').inputValue(),'unsaved.lab');await tab('DHCP').click();await page.locator('[data-dhcp-lease-search]').fill('PC1');await tab('DNS').click();assert.equal(await page.locator('[name=record-name]').inputValue(),'unsaved.lab');await close();
  check('Automatic TTLs refresh without disturbing manual record drafts or service tab navigation');
  await services();await tab('NTP').click();await page.locator('[name=stratum]').fill('3');await save();
  await services();assert.equal(await page.locator('[data-dns-row]').count(),1);assert.equal(await page.locator('[name=record-name]').inputValue(),'intranet.lab');assert.equal(await page.locator('[data-dhcp-dns-row]').count(),2);await page.screenshot({path:folder+'/automatic-records-light.png'});await close();
  check('Applying unrelated service settings preserves automatic ownership and existing manual records');
  await cli('PC2');await command('nslookup pc1.lab.example');assert.match(await page.locator('#terminal-output').textContent(),/Name:.*pc1\.lab\.example[\s\S]*Address: 192\.0\.2\.10/);
  await command('ping -n 1 pc1.lab.example');assert.match(await page.locator('#terminal-output').textContent(),/Sent = 1, Received = 1/);await closeConsole();
  check('The client console resolves the automatic A record and successfully pings the leased device by name');
  const result=await lookup();assert.equal(result.status,'success');assert.equal(result.address,'192.0.2.10');assert.equal(result.records[0].type,'A');await close();
  check('Desktop Network tools returns the same automatic record through simulated DNS traffic');
  await page.locator('[data-action=toggle-theme]').click();await services();assert.equal(await page.locator('[data-dhcp-dns-row]').count(),2);await page.screenshot({path:folder+'/automatic-records-dark.png'});await close();
  await cli('PC1');await command('ipconfig /release');await closeConsole();await services();await page.waitForFunction(()=>document.querySelectorAll('[data-dhcp-dns-row]').length===0);assert.equal(await page.locator('[data-dns-row]').count(),1);await close();
  const released=await lookup();assert.equal(released.rcode,'NXDOMAIN');await close();
  check('Delivered DHCP release removes both automatic names, preserves manual records and returns NXDOMAIN');
  await cli('PC1');await command('ipconfig /renew');await closeConsole();await services();assert.equal(await page.locator('[data-dhcp-dns-row]').count(),2);await close();
  check('Renewing after release recreates the lease-owned DNS entries');
  assert.deepEqual(errors,[]);check('Standalone file:// app has no browser page errors');
  await writeFile('docs/testing/dhcp-dns-browser-results.json',JSON.stringify({generatedAt:new Date().toISOString(),browser:await browser.version(),fixture:'Isolated public YAML import and public GUI/console controls in standalone file:// index.html',checks,errors,artifact:{file:'index.html',sha256:createHash('sha256').update(await readFile('index.html')).digest('hex')}},null,2)+'\n');
} catch(error) {await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;}
finally {await browser.close();}
