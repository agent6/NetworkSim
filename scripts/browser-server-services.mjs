import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import http from 'node:http';
import {Simulator} from '../src/engine.ts';
import {serializeLabFile} from '../src/persistence.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sim=new Simulator(20261016),pc=sim.addDevice('pc',250,250),host=sim.addDevice('server',600,250);
sim.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:host.id,port:'GigabitEthernet0'});
Object.assign(host.config.interfaces.GigabitEthernet0,{ip:'192.0.2.1',mask:'255.255.255.0'});
Object.assign(pc.config.interfaces.GigabitEthernet0,{ip:'192.0.2.50',mask:'255.255.255.0'});delete pc.config.interfaces.GigabitEthernet0.features.dhcp;
host.config.services.dhcp={enabled:true,pools:[{name:'LAN',network:'192.0.2.0',prefix:24,defaultRouter:'192.0.2.1',leaseSeconds:3600}],excluded:[{start:'192.0.2.1',end:'192.0.2.9'}]};
host.config.services.tftp={enabled:true,files:{'old.cfg':'retained'}};host.config.services.sshFiles={enabled:true,files:{'old.txt':'retained'}};
host.config.features.users={student:{password:'labpassword',privilege:15}};
sim.changed();
const folder='.cache/server-services-browser';await mkdir(folder,{recursive:true});
const html=await readFile('dist/index.html'),server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const check=name=>{checks.push(name);console.log('PASS',name);};
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');
const tab=name=>page.locator('[data-service-tab]').filter({hasText:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
const services=async()=>{await node('SRV1').dblclick();await page.locator('[data-desktop=services]').click();};
const close=()=>page.locator('[data-action=close-dialog]').first().click(),save=()=>page.locator('button[form=dialog-form]').click();
const command=async line=>{await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');};
try {
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#import-input').setInputFiles({name:'server-services.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(serializeLabFile(sim.serialize()))});
  await services();
  assert.deepEqual(await page.locator('[data-service-tab]').allTextContents(),['DNS','DHCP','HTTP','AAA','NTP','FTP','Syslog']);
  for(const [label,control] of [['NTP','[name=ntp-enabled]'],['Syslog','[name=syslog-enabled]']]) {
    await tab(label).click();assert.equal(await page.locator(control).isVisible(),true);
    assert.equal(await page.locator('[data-service-section]:visible').count(),1);
    assert.equal(await tab(label).getAttribute('aria-selected'),'true');
  }
  assert.equal(await page.locator('[name^=tftp-],[name^=ssh-files]').count(),0);
  check('The server exposes its seven service tabs and no TFTP or SCP/SFTP controls');
  await tab('DNS').focus();await page.keyboard.press('ArrowRight');assert.equal(await tab('DHCP').getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');assert.equal(await tab('Syslog').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');assert.equal(await tab('DNS').getAttribute('aria-selected'),'true');
  check('Service tabs support arrow keys, Home, End and accessible tab selection');
  await tab('DHCP').click();assert.match(await page.locator('[data-dhcp-lease-empty]').textContent(),/No active leases/);
  check('DHCP shows an accurate empty lease state before allocation');
  await tab('NTP').click();await page.locator('[name=ntp-enabled]').check();await page.locator('[name=stratum]').fill('3');
  await tab('Syslog').click();await page.locator('[name=syslog-enabled]').check();await save();
  await services();await tab('NTP').click();assert.equal(await page.locator('[name=ntp-enabled]').isChecked(),true);assert.equal(await page.locator('[name=stratum]').inputValue(),'3');
  await tab('Syslog').click();assert.equal(await page.locator('[name=syslog-enabled]').isChecked(),true);await close();
  check('NTP and Syslog edits survive saving across separate tabs');
  await node('PC1').dblclick();await page.locator('[data-desktop=cli]').click();
  await command('netsh interface ipv4 set address Ethernet dhcp');await command('ipconfig /all');
  assert.match(await page.locator('#terminal-output').textContent(),/192\.0\.2\.10/);
  await page.locator('[data-action=close-dock]').click();
  await services();await tab('DHCP').click();
  const lease=page.locator('[data-dhcp-lease="192.0.2.10"]');assert.equal(await lease.count(),1);
  assert.match(await lease.textContent(),/PC1[\s\S]*LAN/);assert.ok((await lease.textContent()).includes(sim.macOf(pc.id,'GigabitEthernet0')));
  check('A real client DHCP exchange appears under the allocating server with IP, client, MAC and pool');
  const search=page.locator('[data-dhcp-lease-search]');
  for(const term of ['192.0.2.10','pc1','lan',sim.macOf(pc.id,'GigabitEthernet0').toUpperCase()]){await search.fill(term);assert.equal(await lease.count(),1);}
  await search.fill('missing-client');assert.match(await page.locator('[data-dhcp-lease-empty]').textContent(),/No leases match/);
  assert.match(await page.locator('[data-dhcp-lease-count]').textContent(),/0 of 1/);await search.fill('PC1');
  check('DHCP lookup filters by IP, hostname, pool and MAC, with clear no-match feedback');
  await tab('NTP').click();await page.locator('[name=stratum]').fill('4');await tab('DHCP').click();
  const before=await page.locator('[data-lease-remaining]').textContent();
  await page.waitForFunction(previous=>document.querySelector('[data-lease-remaining]')?.textContent!==previous,before,{timeout:5000});
  assert.equal(await search.inputValue(),'PC1');await tab('NTP').click();assert.equal(await page.locator('[name=stratum]').inputValue(),'4');await tab('DHCP').click();
  check('Lease times update live without resetting searches or unsaved service settings');
  await search.fill('');await page.screenshot({path:folder+'/dhcp-light.png'});await close();
  await page.locator('[data-action=toggle-theme]').click();await services();await tab('DHCP').click();await page.screenshot({path:folder+'/dhcp-dark.png'});await close();
  await node('PC1').dblclick();await page.locator('[data-desktop=cli]').click();await command('ipconfig /release');await page.locator('[data-action=close-dock]').click();
  await services();await tab('DHCP').click();await page.waitForSelector('[data-dhcp-lease-empty]');assert.match(await page.locator('[data-dhcp-lease-empty]').textContent(),/No active leases/);
  check('Released leases disappear from the DHCP lookup');
  assert.deepEqual(errors,[]);check('No browser page errors');
  const result=JSON.stringify({generatedAt:new Date().toISOString(),browser:await browser.version(),fixture:'Isolated public YAML import in local static HTML preview',artifact:{path:'dist/index.html',sha256:createHash('sha256').update(html).digest('hex')},checks,errors},null,2)+'\n';await writeFile(folder+'/results.json',result);await writeFile('docs/audits/server-services-browser-validation.json',result);
} catch(error) {
  await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
