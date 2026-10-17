import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {serializeLabFile} from '../src/persistence.ts';
import {terminalRows} from '../src/ios-terminal.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sim=new Simulator(1920),sw=sim.addDevice('switch',600,160),pc=sim.addDevice('pc',300,450),router=sim.addDevice('router',900,450),description='Campus uplink '+('ABCDEF0123456789'.repeat(22));
Object.assign(pc.config.interfaces.GigabitEthernet0,{ip:'192.0.2.10',mask:'255.255.255.0'});delete pc.config.interfaces.GigabitEthernet0.features.dhcp;
function run(d,...lines){const c=new IOSSession(sim,d.id);for(const line of lines)assert.ok(!c.execute(line).some(row=>row.startsWith('%')),line);}
run(sw,'enable','configure terminal','interface gi0/1','description '+description,'end');
run(router,'enable','configure terminal','interface gi0/0','ip address 192.0.2.1 255.255.255.0','no shutdown','exit','ip domain-name lab.example','crypto key generate rsa modulus 2048','ip ssh version 2','username admin privilege 15 secret testpass','line vty 0 4','login local','transport input ssh','end');
sim.connect({deviceId:pc.id,port:'GigabitEthernet0'},{deviceId:router.id,port:'GigabitEthernet0/0'});
const expectedTable=new IOSSession(sim,sw.id).execute('show ip interface brief'),folder='.cache/console-width';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage({viewport:{width:1916,height:1000}}),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const input=page.locator('#terminal-input'),output=page.locator('#terminal-output'),prompt=page.locator('#terminal-prompt'),check=name=>{checks.push(name);console.log('PASS',name);};
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function command(line){const before=(await output.textContent()).length;await input.fill(line);await input.press('Enter');await settle();return(await output.textContent()).slice(before);}
async function result(line){const label=await prompt.textContent(),text=await command(line);assert.ok(text.startsWith(label+line+'\n'),text);return text.slice(label.length+line.length+1).replace(/\n$/,'').split('\n');}
async function columns(){return page.locator('#console-panel').evaluate(panel=>{const style=getComputedStyle(panel),probe=document.createElement('span');probe.textContent='0'.repeat(100);probe.style.cssText='position:absolute;visibility:hidden;white-space:pre';panel.append(probe);const cell=probe.getBoundingClientRect().width/100;probe.remove();return Math.min(512,Math.floor((panel.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))/cell));});}
async function drain(first){const lines=[...first];let pages=0;while(await prompt.textContent()==='--More--'){assert.ok(pages++<100);const offset=(await output.textContent()).length;await input.press('Space');await settle();lines.push(...(await output.textContent()).slice(offset).replace(/\n$/,'').split('\n'));}return lines;}
try{
  await page.goto(pathToFileURL(process.cwd()+'/index.html').href);
  await page.locator('#import-input').setInputFiles({name:'console-width.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(serializeLabFile(sim.serialize()))});
  await node('SW1').dblclick();await command('enable');await command('terminal length 0');
  const wide=await columns();assert.ok(wide>150);assert.match(await command('show terminal'),new RegExp(`Width: ${wide} columns`));
  const table=await result('show ip interface brief');assert.deepEqual(table,expectedTable);assert.ok(table[0].length>80);
  check('A wide console reports its measured columns and retains complete interface-table headers beyond column 80');
  const style=await output.evaluate(element=>{const s=getComputedStyle(element);return {whiteSpace:s.whiteSpace,overflowWrap:s.overflowWrap,wordBreak:s.wordBreak};});
  assert.deepEqual(style,{whiteSpace:'pre',overflowWrap:'normal',wordBreak:'normal'});
  check('The browser preserves terminal cells without a second word-based wrap');
  await page.locator('#console-panel').evaluate(p=>{p.scrollTop=0;});await page.screenshot({path:folder+'/wide-console.png'});
  await page.setViewportSize({width:760,height:800});await settle();const narrow=await columns();assert.ok(narrow<80);
  assert.match(await command('show terminal'),new RegExp(`Width: ${narrow} columns`));assert.deepEqual(await result('show ip interface brief'),terminalRows(expectedTable,narrow));
  check('Automatic width follows a narrower window and wraps output once at the measured cell boundary');
  await command('terminal width 132');assert.match(await command('show terminal'),/Width: 132 columns/);assert.deepEqual(await result('show ip interface brief'),expectedTable);
  const horizontal=await page.locator('#console-panel').evaluate(p=>({client:p.clientWidth,scroll:p.scrollWidth}));assert.ok(horizontal.scroll>horizontal.client);
  check('Explicit IOS width 132 stays fixed in a narrow console and wider rows remain horizontally accessible');
  await command('terminal width 0');const unwrapped=await result('show running-config | include ^ description');assert.deepEqual(unwrapped,[' description '+description]);
  const physical=await output.evaluate((element,line)=>{const text=element.firstChild,at=text.textContent.lastIndexOf(line),range=document.createRange();range.setStart(text,at);range.setEnd(text,at+line.length);return{rects:[...range.getClientRects()].map(r=>({width:r.width,height:r.height})),lineHeight:parseFloat(getComputedStyle(element).lineHeight)};},unwrapped[0]);
  assert.equal(physical.rects.length,1);assert.ok(physical.rects[0].height<=physical.lineHeight+1);
  await page.locator('#console-panel').evaluate(p=>{p.scrollLeft=p.scrollWidth;});assert.ok(await page.locator('#console-panel').evaluate(p=>p.scrollLeft)>0);
  check('Width zero keeps a long description on one physical line with working horizontal scrolling');
  await page.screenshot({path:folder+'/unwrapped-console.png'});
  await command('terminal length 3');const first=await result('show running-config');assert.equal(first.length,3);assert.equal(await prompt.textContent(),'--More--');
  const all=await drain(first),expected=new IOSSession(sim,sw.id);expected.execute('enable');assert.deepEqual(all,expected.execute('show running-config'));assert.ok(all.includes(' description '+description));
  check('Paging width-zero output preserves every full line without rewrapping, skipping or duplicating text');
  assert.equal(await page.locator('#console-panel').evaluate(p=>p.scrollLeft),0);
  check('Returning to the prompt resets horizontal scrolling so command input remains visible');
  await page.locator('[data-action=close-dock]').click();await page.setViewportSize({width:1916,height:1000});await node('PC1').dblclick();await page.locator('[data-desktop=cli]').click();
  await command('ssh -l admin 192.0.2.1');assert.equal(await prompt.textContent(),'Password:');await command('testpass');assert.equal(await prompt.textContent(),'R1#');await command('terminal length 0');
  assert.match(await command('show terminal'),new RegExp(`Width: ${await columns()} columns`));
  check('Windows SSH supplies the attached console width to the remote IOS session');
  await page.setViewportSize({width:960,height:800});await settle();assert.match(await command('show terminal'),new RegExp(`Width: ${await columns()} columns`));
  await command('terminal width 132');await page.setViewportSize({width:760,height:800});await settle();assert.match(await command('show terminal'),/Width: 132 columns/);
  check('Remote sessions follow resize updates while retaining explicit remote width settings');
  await command('exit');assert.equal(await prompt.textContent(),'C:\\>');assert.deepEqual(errors,[]);check('No browser page errors');
  await writeFile('docs/testing/console-width-browser-results.json',JSON.stringify({generatedAt:new Date().toISOString(),browser:await browser.version(),fixture:'Isolated public YAML import in standalone file:// app; user lab untouched',wideColumns:wide,narrowColumns:narrow,checks,errors,artifact:{file:'index.html',sha256:createHash('sha256').update(await readFile('index.html')).digest('hex')}},null,2)+'\n');
}catch(error){await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;}finally{await browser.close();}
