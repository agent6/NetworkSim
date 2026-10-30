import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseDocument} from '../src/persistence.ts';
import {SINGLE_AREA_OSPFV3_COMMANDS as COMMANDS} from '../src/lab-catalog.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/single-area-ospfv3-catalog-browser';await mkdir(folder,{recursive:true});
const html=await readFile('index.html','utf8');await writeFile(folder+'/index.html',html);
const browser=await chromium.launch({executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[],requests=[],id='single-area-ospfv3',title='Single-Area OSPFv3',hash='#/labs/'+id;
const close=page=>page.locator('[data-action=close-dialog]').first().click();
const progress=(page,n)=>page.waitForFunction(n=>document.querySelector('[data-guide-progress]')?.textContent===`${n} of 10 tasks complete`,n);
async function command(page,line){await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');}
async function openNode(page,name){await page.locator('[data-action=fit]').click();await page.locator(`[data-device="device-ospfv3-${name.toLowerCase()}"] .device-body`).dblclick();}
async function detail(page){
 await page.locator('.header-actions [data-action=lab-catalog]').click();await page.locator('[data-catalog-section=Routing]').click();
 assert.equal(await page.locator('[data-catalog-section=Routing] .catalog-count').textContent(),'8');await page.locator(`[data-catalog-lab="${id}"]`).click();
}
async function testPing(page,goal,success=true){
 await page.locator(`[data-guide-test="${goal}"]`).click();
 await page.waitForFunction(({goal,success})=>{const text=document.querySelector(`[data-test-status="${goal}"]`)?.textContent;return success?text==='3 of 3 replies received.':text?.startsWith('No replies.');},{goal,success});
}
async function allTraffic(page){for(const goal of ['pc1-pc2','pc1-server','server-pc1','pc2-server'])await testPing(page,goal);}
async function change(page,name,lines){await openNode(page,name);for(const line of ['enable','configure terminal',...lines,'end'])await command(page,line);await page.locator('[data-action=close-dock]').click();}
async function output(page,line){await command(page,line);return(await page.locator('#terminal-output').textContent()).replace(/\s/g,'').split(line.replace(/\s/g,'')).at(-1);}
async function primary(page,up){await change(page,'R1',['interface GigabitEthernet0/2',up?'no shutdown':'shutdown']);}
async function routes(page,alternate){
 for(const[name,target,hop]of [['R1','2001:db8:30::10',alternate?'FE80::2':'FE80::3'],['R3','2001:db8:10::10',alternate?'FE80::2':'FE80::1']]){
  await openNode(page,name);for(const cmd of ['enable','terminal length 0'])await command(page,cmd);const line='show ipv6 route '+target,pattern=new RegExp('\\[110/'+(alternate?21:6)+'\\]via'+hop+',GigabitEthernet0/'+(alternate?1:2),'i');let text='';
  for(let attempt=0;attempt<40;attempt++){text=await output(page,line);if(pattern.test(text))break;await page.waitForTimeout(500);}assert.match(text,pattern);await page.locator('[data-action=close-dock]').click();
 }
}
async function trace(page,alternate){
 await openNode(page,'PC1');await page.getByRole('button',{name:'Command prompt',exact:true}).click();const text=await output(page,'tracert -6 -d 2001:db8:30::10');assert.match(text,/Tracecomplete/);assert.equal(text.toLowerCase().includes('2001:db8:12::2'),alternate);
 const terminal=await page.locator('#terminal-output').evaluate(e=>({background:getComputedStyle(e.closest('.terminal')).backgroundColor,foreground:getComputedStyle(e).color}));assert.deepEqual(terminal,{background:'rgb(51, 51, 51)',foreground:'rgb(255, 185, 0)'});await page.locator('[data-action=close-dock]').click();
}
async function reload(page,theme,width,alternate){
 await page.waitForTimeout(1200);const before=await page.evaluate(()=>localStorage.getItem('network-sim.workspace.v1'));assert.equal(parseDocument(before).lab.name,title);await page.reload();
 try{await page.waitForFunction(expected=>document.querySelector('#lab-name')?.textContent===expected,title);}catch(error){await writeFile(`${folder}/reload-failure-${theme}-${width}-${alternate?'alternate':'restored'}.json`,JSON.stringify({before:JSON.parse(before),after:await page.evaluate(()=>({name:document.querySelector('#lab-name')?.textContent,toasts:window.qaToasts,startupWorkspace:window.qaStartupWorkspace,workspace:localStorage.getItem('network-sim.workspace.v1')}))},null,2));throw error;}
 await routes(page,alternate);await page.locator('#lab-guide-button').click();await progress(page,alternate?5:10);await testPing(page,'pc1-server');await testPing(page,'server-pc1');await close(page);
}
async function scenario(theme,width){
 const profile=await mkdtemp(folder+'/profile-'+theme+'-'+width+'-');
 const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600});
 const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(45000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.route(/^https?:\/\//,r=>r.abort());await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);window.qaToasts=[];window.qaStartupWorkspace=localStorage.getItem('network-sim.workspace.v1');addEventListener('DOMContentLoaded',()=>{const e=document.querySelector('#toast');if(e){window.qaToasts.push(e.textContent);new MutationObserver(()=>window.qaToasts.push(e.textContent)).observe(e,{childList:true,subtree:true,characterData:true});}});},theme);
 try{
  const localArtifact=`${folder}/index-${theme}-${width}.html`;await writeFile(localArtifact,html);await page.goto(pathToFileURL(process.cwd()+'/'+localArtifact).href);await detail(page);assert.ok(page.url().endsWith(hash));assert.match(await page.locator('.catalog-meta').first().textContent(),/CCNA · Routing/);
  assert.equal(await page.locator('.catalog-tasks').first().locator('li').count(),10);assert.equal(await page.locator('.catalog-table tbody tr').count(),12);
  assert.equal(await page.locator('.catalog-reference').getAttribute('open'),null);await page.locator('.catalog-reference summary').click();for(const pattern of [/ipv6 router ospf 10/,/router-id 1\.1\.1\.1/,/passive-interface default/,/ipv6 ospf network point-to-point/,/ipv6 ospf 10 area 0/,/metric 21/])assert.match(await page.locator('.catalog-reference').textContent(),pattern);await page.locator('.catalog-reference summary').click();
  await page.locator('[data-catalog-mode=practice]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===6);await page.locator('#lab-guide-button').click();await progress(page,0);await testPing(page,'pc1-server',false);await progress(page,0);await close(page);
  for(const[name,lines]of Object.entries(COMMANDS)){await openNode(page,name);for(const line of lines)await command(page,line);await page.locator('[data-action=close-dock]').click();}
  await page.locator('#lab-guide-button').click();await progress(page,6);await allTraffic(page);await progress(page,10);await close(page);await routes(page,false);await trace(page,false);
  for(const name of ['R1','R2','R3']){await openNode(page,name);for(const line of ['enable','terminal length 0'])await command(page,line);const text=await output(page,'show ipv6 ospf neighbor');assert.equal((text.match(/FULL\/-/g)||[]).length,2);if(name==='R1'){assert.match(text,/2\.2\.2\.2/);assert.match(text,/3\.3\.3\.3/);assert.match(await output(page,'show ipv6 ospf interface GigabitEthernet0/0'),/passive/i);assert.match(await output(page,'show ipv6 ospf interface brief'),/P2P/);assert.match(await output(page,'show ipv6 ospf database'),/RouterLinkStates/);}await page.locator('[data-action=close-dock]').click();}
  await primary(page,false);await routes(page,true);await trace(page,true);await page.locator('#lab-guide-button').click();await progress(page,5);for(const goal of ['full-neighbors','learned-lans'])assert.equal(await page.locator(`[data-objective=${goal}]`).getAttribute('data-complete'),'false');assert.equal(await page.locator('[data-objective=r2-area0]').getAttribute('data-complete'),'true');await allTraffic(page);await close(page);
  await reload(page,theme,width,true);await primary(page,true);await routes(page,false);await trace(page,false);await page.locator('#lab-guide-button').click();await progress(page,10);await allTraffic(page);assert.equal(await page.locator('[data-guide-completion]').isVisible(),true);await page.locator('#toast').evaluate(e=>e.style.display='none');assert.ok(await page.locator('.dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;}));await page.screenshot({path:`${folder}/guide-${theme}-${width}.png`,animations:'disabled'});await close(page);await page.locator('[data-action=fit]').click();await page.screenshot({path:`${folder}/topology-${theme}-${width}.png`,animations:'disabled'});
  await reload(page,theme,width,false);await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#cancel-lab-import').click();assert.equal(await page.locator('#lab-name').textContent(),title);await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#lab-import-save').click();await page.waitForFunction(()=>document.querySelector('#lab-name')?.textContent.includes('Completed'));await page.locator('#lab-guide-button').click();await progress(page,6);await allTraffic(page);await progress(page,10);
  checks.push(`${theme} ${width}px: eight Routing labs, ten-task OSPFv3 guide and twelve-row IPv6/link-local plan, zero-credit practice, all three published IOS configurations, six Full link-local point-to-point adjacencies, passive LAN verification and received LSDB, intra-area AD 110 metric-6 routes and direct traceroute, four real 3/3 traffic tests, physical failure with metric-21 alternate routes and real traffic through R2, reload and OSPF reconvergence while the direct link is down, restored adjacency/cost/path and retained progress after healthy reload, completed reference, safe cancel/save-copy handling, responsive guide and unchanged CLI colors`);process.stdout.write(`PASS ${theme} ${width}\n`);
 }catch(error){await page.screenshot({path:`${folder}/failure-${theme}-${width}.png`});throw error;}finally{await context.close();await rm(profile,{recursive:true,force:true});}
}
try{
 // Serialize file:// scenarios: concurrent Chrome profiles intermittently lost storage before app startup.
 for(const theme of ['light','dark'])for(const width of [1440,390,320]){if(process.env.NETWORKSIM_BROWSER_CASE&&process.env.NETWORKSIM_BROWSER_CASE!==`${theme}-${width}`)continue;await scenario(theme,width);}
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),base='https://training.example/campus/NetworkSim/index.html?class=ccna&room=2';page.setDefaultTimeout(16000);page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'text/html',body:html}));await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLabURL=text;}}});},theme);
  await page.goto(base+hash);await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(await page.locator('#world .device').count(),0);await page.locator('[data-catalog-copy]').click();await page.waitForFunction(expected=>window.copiedLabURL===expected,base+hash);
  await page.locator('[data-catalog-back]').click();assert.equal(await page.locator('[data-catalog-section=Routing]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-catalog-section=Routing] .catalog-count').textContent(),'8');assert.equal(await page.locator(`[data-catalog-lab="${id}"]`).getAttribute('href'),base+hash);
  checks.push(`${theme}: permalink preserves the current host/path/query, previews without replacing the workspace, and returns to eight Routing labs`);process.stdout.write(`PASS ${theme} permalink\n`);await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await writeFile(folder+'/validation.json',JSON.stringify({artifactSha256:createHash('sha256').update(html).digest('hex'),checks,errors,externalRequests:requests},null,2)+'\n');
}finally{await browser.close();}
