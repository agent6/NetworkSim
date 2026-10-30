import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseDocument} from '../src/persistence.ts';
import {FLOATING_STATIC_ROUTE_COMMANDS as COMMANDS} from '../src/lab-catalog.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/floating-static-route-catalog-browser';await mkdir(folder,{recursive:true});
const html=await readFile('index.html','utf8');await writeFile(folder+'/index.html',html);
const browser=await chromium.launch({executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[],requests=[],id='floating-static-route',title='Floating Static Route',hash='#/labs/'+id;
const close=page=>page.locator('[data-action=close-dialog]').first().click();
const progress=(page,n)=>page.waitForFunction(n=>document.querySelector('[data-guide-progress]')?.textContent===`${n} of 8 tasks complete`,n);
async function command(page,line){await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');}
async function openNode(page,name){await page.locator('[data-action=fit]').click();await page.locator(`[data-device="device-floating-static-${name.toLowerCase()}"] .device-body`).dblclick();}
async function detail(page){
 await page.locator('.header-actions [data-action=lab-catalog]').click();await page.locator('[data-catalog-section=Routing]').click();
 assert.equal(await page.locator('[data-catalog-section=Routing] .catalog-count').textContent(),'7');await page.locator(`[data-catalog-lab="${id}"]`).click();
}
async function testPing(page,goal,success=true){
 await page.locator(`[data-guide-test="${goal}"]`).click();
 await page.waitForFunction(({goal,success})=>{const text=document.querySelector(`[data-test-status="${goal}"]`)?.textContent;return success?text==='3 of 3 replies received.':text?.startsWith('No replies.');},{goal,success});
}
async function allTraffic(page){for(const goal of ['forward-v4','forward-v6','return-v4','return-v6'])await testPing(page,goal);}
async function change(page,name,lines){await openNode(page,name);for(const line of ['enable','configure terminal',...lines,'end'])await command(page,line);await page.locator('[data-action=close-dock]').click();}
async function output(page,line){await command(page,line);return(await page.locator('#terminal-output').textContent()).replace(/\s/g,'').split(line.replace(/\s/g,'')).at(-1);}
async function inspect(page,name,line,pattern){await openNode(page,name);for(const cmd of ['enable','terminal length 0'])await command(page,cmd);assert.match(await output(page,line),pattern);await page.locator('[data-action=close-dock]').click();}
async function primary(page,up){await change(page,'R1',['interface GigabitEthernet0/2',up?'no shutdown':'shutdown']);}
async function routes(page,backup){
 for(const[name,target,hop]of [['R1','192.168.30.10',backup?'10.0.12.2':'10.0.13.2'],['R3','192.168.10.10',backup?'10.0.23.1':'10.0.13.1']])await inspect(page,name,'show ip route '+target,new RegExp('distance'+(backup?10:1)+'.*'+hop.replaceAll('.','\\.')));
 for(const[name,target,hop]of [['R1','2001:db8:30::10',backup?'2':'3'],['R3','2001:db8:10::10',backup?'2':'1']])await inspect(page,name,'show ipv6 route '+target,new RegExp('\\['+(backup?10:1)+'\\/0\\]viaFE80::'+hop+',GigabitEthernet0/'+(backup?1:2)));
}
async function traces(page,backup){
 await openNode(page,'PC1');await page.getByRole('button',{name:'Command prompt',exact:true}).click();
 for(const target of ['192.168.30.10','2001:db8:30::10']){const text=await output(page,`tracert ${target.includes(':')?'-6 ':''}-d ${target}`);assert.match(text,/Tracecomplete/);assert.equal(text.includes(target.includes(':')?'2001:db8:12::2':'10.0.12.2'),backup);}
 const terminal=await page.locator('#terminal-output').evaluate(e=>({background:getComputedStyle(e.closest('.terminal')).backgroundColor,foreground:getComputedStyle(e).color}));assert.deepEqual(terminal,{background:'rgb(51, 51, 51)',foreground:'rgb(255, 185, 0)'});await page.locator('[data-action=close-dock]').click();
}
async function reload(page,theme,width,expected,phase){
 await page.waitForTimeout(1200);const before=await page.evaluate(()=>localStorage.getItem('network-sim.workspace.v1'));assert.equal(parseDocument(before).lab.name,title);await page.reload();
 try{await page.waitForFunction(expected=>document.querySelector('#lab-name')?.textContent===expected,title);}catch(error){await writeFile(`${folder}/reload-failure-${theme}-${width}-${phase}.json`,JSON.stringify({before:JSON.parse(before),after:await page.evaluate(()=>({name:document.querySelector('#lab-name')?.textContent,toasts:window.qaToasts,startupWorkspace:window.qaStartupWorkspace,workspace:localStorage.getItem('network-sim.workspace.v1')}))},null,2));throw error;}
 await page.locator('#lab-guide-button').click();await progress(page,expected);await testPing(page,'forward-v4');await testPing(page,'forward-v6');await close(page);
}
async function scenario(theme,width){
 const profile=await mkdtemp(folder+'/profile-'+theme+'-'+width+'-');
 const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600});
 const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(25000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.route(/^https?:\/\//,r=>r.abort());await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);window.qaToasts=[];window.qaStartupWorkspace=localStorage.getItem('network-sim.workspace.v1');addEventListener('DOMContentLoaded',()=>{const e=document.querySelector('#toast');if(e){window.qaToasts.push(e.textContent);new MutationObserver(()=>window.qaToasts.push(e.textContent)).observe(e,{childList:true,subtree:true,characterData:true});}});},theme);
 try{
  // Separate file URLs keep each offline scenario's browser storage isolated.
  const localArtifact=`${folder}/index-${theme}-${width}.html`;await writeFile(localArtifact,html);await page.goto(pathToFileURL(process.cwd()+'/'+localArtifact).href);await detail(page);assert.ok(page.url().endsWith(hash));assert.match(await page.locator('.catalog-meta').first().textContent(),/CCNA · Routing/);
  assert.equal(await page.locator('.catalog-tasks').first().locator('li').count(),8);assert.equal(await page.locator('.catalog-table tbody tr').count(),10);
  assert.equal(await page.locator('.catalog-reference').getAttribute('open'),null);await page.locator('.catalog-reference summary').click();
  for(const pattern of [/GigabitEthernet0\/1 10\.0\.12\.2 10/,/fe80::2 10/,/same destination prefix/,/return backup/,/IP SLA/])assert.match(await page.locator('.catalog-reference').textContent(),pattern);
  await page.locator('.catalog-reference summary').click();await page.locator('[data-catalog-mode=practice]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===5);
  await page.locator('#lab-guide-button').click();await progress(page,0);await testPing(page,'forward-v4',false);await progress(page,0);await close(page);
  for(const[name,lines]of Object.entries(COMMANDS)){await openNode(page,name);for(const line of lines)await command(page,line);await page.locator('[data-action=close-dock]').click();}
  await page.locator('#lab-guide-button').click();await progress(page,4);await allTraffic(page);await progress(page,8);await close(page);await routes(page,false);await traces(page,false);
  await openNode(page,'R1');for(const line of ['enable','terminal length 0'])await command(page,line);const v4=await output(page,'show ip route static'),v6=await output(page,'show ipv6 route static');for(const text of [v4,v6]){assert.match(text,/\[1\/0\]/);assert.doesNotMatch(text,/\[10\/0\]/);}assert.match(await output(page,'show running-config | include ^ip route'),/GigabitEthernet0\/110\.0\.12\.210/);assert.match(await output(page,'show running-config | include ^ipv6 route'),/GigabitEthernet0\/1fe80::210/);await page.locator('[data-action=close-dock]').click();
  await primary(page,false);await routes(page,true);await traces(page,true);await page.locator('#lab-guide-button').click();await progress(page,6);for(const goal of ['ipv4-primary','ipv6-primary'])assert.equal(await page.locator(`[data-objective=${goal}]`).getAttribute('data-complete'),'false');for(const goal of ['ipv4-backup','ipv6-backup'])assert.equal(await page.locator(`[data-objective=${goal}]`).getAttribute('data-complete'),'true');await allTraffic(page);await close(page);
  const returnBackup='ip route 192.168.10.0 255.255.255.0 GigabitEthernet0/1 10.0.23.1 10';await change(page,'R3',['no '+returnBackup]);await page.locator('#lab-guide-button').click();assert.equal(await page.locator('[data-objective=ipv4-backup]').getAttribute('data-complete'),'false');await testPing(page,'forward-v4',false);await testPing(page,'forward-v6');await close(page);await change(page,'R3',[returnBackup]);
  await reload(page,theme,width,6,'backup');await routes(page,true);await primary(page,true);await routes(page,false);await traces(page,false);await page.locator('#lab-guide-button').click();await allTraffic(page);await progress(page,8);assert.equal(await page.locator('[data-guide-completion]').isVisible(),true);await page.locator('#toast').evaluate(e=>e.style.display='none');assert.ok(await page.locator('.dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;}));await page.screenshot({path:`${folder}/guide-${theme}-${width}.png`,animations:'disabled'});await close(page);await page.locator('[data-action=fit]').click();await page.screenshot({path:`${folder}/topology-${theme}-${width}.png`,animations:'disabled'});
  await reload(page,theme,width,8,'restored');await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#cancel-lab-import').click();assert.equal(await page.locator('#lab-name').textContent(),title);await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#lab-import-save').click();await page.waitForFunction(()=>document.querySelector('#lab-name')?.textContent.includes('Completed'));await page.locator('#lab-guide-button').click();await progress(page,4);await allTraffic(page);await progress(page,8);
  checks.push(`${theme} ${width}px: seven Routing labs, eight-task floating-static guide and ten-row address plan, independent zero-credit practice, both published IOS configurations, configured inactive AD 10 backups and installed AD 1 primaries, real traffic and IPv4/IPv6 traceroutes before failure, four active AD 10 routes and bidirectional traffic through R2 after failure, missing return-backup fault and repair, reload while backups are active, restored AD 1 routes and direct paths, retained progress after healthy reload, completed reference, cancel/save-copy protection, responsive guide and unchanged CLI colors`);process.stdout.write(`PASS ${theme} ${width}\n`);
 }catch(error){await page.screenshot({path:`${folder}/failure-${theme}-${width}.png`});throw error;}finally{await context.close();await rm(profile,{recursive:true,force:true});}
}
try{
 // Serialize file:// scenarios: concurrent Chrome profiles intermittently lost storage before app startup.
 for(const theme of ['light','dark'])for(const width of [1440,390,320]){if(process.env.NETWORKSIM_BROWSER_CASE&&process.env.NETWORKSIM_BROWSER_CASE!==`${theme}-${width}`)continue;await scenario(theme,width);}
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),base='https://training.example/campus/NetworkSim/index.html?class=ccna&room=2';page.setDefaultTimeout(16000);page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'text/html',body:html}));await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLabURL=text;}}});},theme);
  await page.goto(base+hash);await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(await page.locator('#world .device').count(),0);await page.locator('[data-catalog-copy]').click();await page.waitForFunction(expected=>window.copiedLabURL===expected,base+hash);
  await page.locator('[data-catalog-back]').click();assert.equal(await page.locator('[data-catalog-section=Routing]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-catalog-section=Routing] .catalog-count').textContent(),'7');assert.equal(await page.locator(`[data-catalog-lab="${id}"]`).getAttribute('href'),base+hash);
  checks.push(`${theme}: permalink preserves the current host/path/query, previews without replacing the workspace, and returns to seven Routing labs`);process.stdout.write(`PASS ${theme} permalink\n`);await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await writeFile(folder+'/validation.json',JSON.stringify({artifactSha256:createHash('sha256').update(html).digest('hex'),checks,errors,externalRequests:requests},null,2)+'\n');
}finally{await browser.close();}
