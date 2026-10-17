import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {serializeLabFile} from '../src/persistence.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sim=new Simulator(7011),a=sim.addDevice('switch',400,260),b=sim.addDevice('switch',900,260),g=n=>'GigabitEthernet0/'+n;
function run(d,...commands){const c=new IOSSession(sim,d.id);for(const command of commands)assert.ok(!c.execute(command).some(line=>line.startsWith('%')),command);}
run(a,'enable','configure terminal','spanning-tree vlan 1 priority 0','end');
run(b,'enable','configure terminal','spanning-tree vlan 1 priority 8192','end');
for(const n of [1,2,3]){
  for(const[d,group]of[[a,1],[b,2]])run(d,'enable','configure terminal','interface '+g(n),'switchport mode trunk',...(n<3?[`channel-group ${group} mode active`]:[]),'end');
  sim.connect({deviceId:a.id,port:g(n)},{deviceId:b.id,port:g(n)});
}
const folder='.cache/stp-etherchannel-browser';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const input=page.locator('#terminal-input'),output=page.locator('#terminal-output'),check=name=>{checks.push(name);console.log('PASS',name);};
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');
async function command(line){const before=(await output.textContent()).length;await input.fill(line);await input.press('Enter');return(await output.textContent()).slice(before);}
async function eventually(line,pattern){const deadline=Date.now()+15000;let text='';do{text=await command(line);if(pattern.test(text))return text;await page.waitForTimeout(250);}while(Date.now()<deadline);assert.match(text,pattern);}
async function open(name){await node(name).dblclick();await command('enable');await command('terminal length 0');}
const socket=(name,n)=>page.locator(`.wire-socket[aria-label^="${name} · ${g(n)} ·"]`);
try{
  await page.goto(pathToFileURL(process.cwd()+'/index.html').href);
  await page.locator('#import-input').setInputFiles({name:'stp-etherchannel.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(serializeLabFile(sim.serialize()))});
  await open('SW2');
  const initial=await eventually('show spanning-tree interface po2',/Po2\s+Root\s+FWD\s+3\s+128\.\d+\s+P2p/);
  assert.doesNotMatch(initial,/Gi0\/[12]\s/);check('Port-channel has one logical Root/FWD row with correct Gigabit bundle cost and port ID');
  assert.match(await command('show spanning-tree interface gi0/2'),/Po2\s+Root\s+FWD/);
  check('A physical member query resolves to its logical STP port');
  await command('configure terminal');await command('interface po2');await command('spanning-tree cost 100');await command('end');
  await eventually('show spanning-tree interface po2',/Po2\s+Altn\s+BLK\s+100/);
  assert.match(await command('show spanning-tree interface gi0/3'),/Gi0\/3\s+Root\s+FWD\s+4/);
  check('Changing cost on Port-channel changes actual root-port selection to the backup link');
  for(const n of [1,2])await socket('SW2',n).and(page.locator('.state-blocked')).waitFor();
  check('Both physical cables show the logical channel’s blocked state in the diagram');
  const blocked=await command('show spanning-tree blockedports');assert.match(blocked,/Po2\s+alternate/);assert.match(blocked,/segments\) in the system: 1/);assert.doesNotMatch(blocked,/Gi0\/[12]\s/);
  check('Blocked-port view counts the bundle as one segment');await page.screenshot({path:folder+'/logical-channel-blocked.png'});
  await command('configure terminal');await command('interface po2');await command('no spanning-tree cost');await command('end');
  await eventually('show spanning-tree interface po2',/Po2\s+Root\s+FWD\s+3/);
  check('Removing the configured cost restores automatic cost and the preferred root port');
  await command('configure terminal');await command('interface gi0/3');await command('shutdown');await command('interface gi0/1');await command('shutdown');await command('end');
  await eventually('show spanning-tree interface po2',/Po2\s+Root\s+FWD\s+4/);
  assert.match(await command('show etherchannel summary'),/Po2\(SU\)/);
  check('The remaining member retains the logical root port and automatic cost changes to a single Gigabit link');
  await command('configure terminal');await command('interface po2');await command('spanning-tree cost 100');await command('interface gi0/1');await command('no shutdown');await command('end');
  await eventually('show spanning-tree interface po2',/Po2\s+Root\s+FWD\s+100/);
  for(const n of [1,2])await socket('SW2',n).and(page.locator('.state-up')).waitFor();
  check('Manual cost stays fixed after member restoration and both diagram sockets return to forwarding');
  for(const line of ['configure terminal','interface po2','shutdown','end'])await command(line);
  assert.match(await command('show etherchannel summary'),/Po2\(SD\)/);
  for(const line of ['configure terminal','interface po2','no shutdown','end'])await command(line);
  await eventually('show spanning-tree interface po2',/Po2\s+Root\s+FWD\s+100/);
  check('Logical shutdown reports the aggregate down and no shutdown restores its STP port');
  await command('configure terminal');await command('vlan 20');await command('exit');await command('spanning-tree mode mst');await command('spanning-tree mst configuration');await command('name LAB');await command('instance 2 vlan 20');await command('exit');await command('spanning-tree mst 0 priority 8192');await command('spanning-tree mst 2 priority 8192');await command('interface po2');await command('spanning-tree mst 2 cost 77');await command('spanning-tree mst 2 port-priority 16');await command('end');
  await page.locator('[data-action=close-dock]').click();await open('SW1');
  for(const line of ['configure terminal','vlan 20','exit','spanning-tree mode mst','spanning-tree mst configuration','name LAB','instance 2 vlan 20','exit','spanning-tree mst 0 priority 0','spanning-tree mst 2 priority 0','end'])await command(line);
  await page.locator('[data-action=close-dock]').click();await open('SW2');
  await eventually('show spanning-tree mst 2 interface po2 detail',/Po2\s+Root\s+FWD\s+77\s+16\.\d+\s+P2p/);
  check('MST uses the Port-channel’s configured instance cost and port priority');await page.screenshot({path:folder+'/mst-logical-channel.png'});
  assert.deepEqual(errors,[]);check('No browser page errors');
  await writeFile('docs/testing/stp-etherchannel-browser-results.json',JSON.stringify({generatedAt:new Date().toISOString(),browser:await browser.version(),fixture:'Disposable public YAML import and IOS consoles in standalone file:// app; no user lab modified',checks,errors,artifact:{file:'index.html',sha256:createHash('sha256').update(await readFile('index.html')).digest('hex')}},null,2)+'\n');
}catch(error){await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;}finally{await browser.close();}
