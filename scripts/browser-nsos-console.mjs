import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Simulator} from '../src/engine.ts';
import {NSOSSession} from '../src/nsos.ts';
import {serializeLabFile} from '../src/persistence.ts';
import {terminalRows} from '../src/ios-terminal.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sim=new Simulator(9616),dc=sim.addDevice('datacenter',600,160),pc=sim.addDevice('pc',300,450),cli=new NSOSSession(sim,dc.id,{skipConsoleLogin:true});
for(const line of ['conf t','username admin password LabAdmin42 role network-admin','feature ssh','interface mgmt0','ip address 192.0.2.1/24','interface Ethernet1/1','description Campus uplink '+('ABCDEF0123456789'.repeat(12)),'end'])
  assert.ok(!cli.execute(line).some(row=>row.startsWith('%')),line);
const p=pc.config.interfaces.GigabitEthernet0;delete p.features.dhcp;Object.assign(p,{ip:'192.0.2.2',mask:'255.255.255.0'});
sim.connect({deviceId:dc.id,port:'mgmt0'},{deviceId:pc.id,port:p.name});sim.advance(1000);
const expected=cli.execute('show interface status'),detail=cli.execute('show interface Ethernet1/1'),folder='.cache/nsos-console';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage({viewport:{width:1916,height:1000}}),checks=[],errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
const input=page.locator('#terminal-input'),output=page.locator('#terminal-output'),prompt=page.locator('#terminal-prompt');
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const check=name=>{checks.push(name);console.log('PASS',name);};
async function command(line){const before=(await output.textContent()).length;await input.fill(line);await input.press('Enter');await settle();return(await output.textContent()).slice(before);}
async function result(line){const label=await prompt.textContent(),text=await command(line);assert.ok(text.startsWith(label+line+'\n'),text);return text.slice(label.length+line.length+1).replace(/\n$/,'').split('\n');}
async function columns(){return page.locator('#console-panel').evaluate(panel=>{
  const style=getComputedStyle(panel),probe=document.createElement('span');probe.textContent='0'.repeat(100);probe.style.cssText='position:absolute;visibility:hidden;white-space:pre';panel.append(probe);
  const cell=probe.getBoundingClientRect().width/100;probe.remove();return Math.min(512,Math.floor((panel.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))/cell));
});}
try{
  await page.goto(pathToFileURL(process.cwd()+'/index.html').href);
  await page.locator('#import-input').setInputFiles({name:'nsos-console.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(serializeLabFile(sim.serialize()))});
  await node('DC1').dblclick();assert.equal(await prompt.textContent(),'login:');await command('admin');await command('LabAdmin42');await command('terminal length 0');
  assert.ok(await columns()>132);assert.deepEqual(await result('show interface status'),terminalRows(expected,await columns()));
  check('Local NS-OS console starts with the measured viewport width');
  await command('terminal width 60');assert.deepEqual(await result('show interface status'),terminalRows(expected,60));
  await page.setViewportSize({width:760,height:800});await settle();assert.ok(await columns()<80);
  assert.deepEqual(await result('show interface status'),terminalRows(expected,60));
  check('Explicit width 60 survives subsequent renders and window resizing');
  await command('terminal width 132');assert.deepEqual(await result('show interface status'),terminalRows(expected,132));
  assert.deepEqual(await result('show interface Ethernet1/1'),terminalRows(detail,132));
  assert.ok(await page.locator('#console-panel').evaluate(panel=>panel.scrollWidth>panel.clientWidth));
  check('Explicit width 132 retains full rows with horizontal scrolling in a narrow window');
  await page.screenshot({path:folder+'/local-width.png'});
  await page.locator('[data-action=close-dock]').click();await page.setViewportSize({width:1916,height:1000});await settle();
  await node('PC1').dblclick();await page.locator('[data-desktop=cli]').click();
  await command('ssh -l admin 192.0.2.1');assert.equal(await prompt.textContent(),'Password:');await command('LabAdmin42');assert.equal(await prompt.textContent(),'DC1#');await command('terminal length 0');
  assert.deepEqual(await result('show interface status'),terminalRows(expected,await columns()));
  await page.setViewportSize({width:760,height:800});await settle();
  assert.deepEqual(await result('show interface status'),terminalRows(expected,await columns()));
  check('A fresh SSH session follows client viewport updates before width is configured');
  await command('terminal width 60');await page.setViewportSize({width:1440,height:900});await settle();
  assert.deepEqual(await result('show interface status'),terminalRows(expected,60));
  await input.fill('show ');await input.press('?');await settle();await input.fill('');
  assert.deepEqual(await result('show interface status'),terminalRows(expected,60));
  check('SSH command and help requests preserve explicit remote terminal width');
  await page.screenshot({path:folder+'/ssh-width.png'});
  await command('exit');assert.equal(await prompt.textContent(),'C:\\>');assert.deepEqual(errors,[]);check('No browser runtime errors');
  await writeFile(folder+'/results.json',JSON.stringify({browser:await browser.version(),fixture:'Isolated standalone file:// YAML import; user lab untouched',checks,errors},null,2)+'\n');
}catch(error){await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;}
finally{await browser.close();}
