import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseDocument} from '../src/persistence.ts';
import {HOST_ROUTE_COMMANDS as COMMANDS} from '../src/lab-catalog.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/host-route-catalog-browser';await mkdir(folder,{recursive:true});
const html=await readFile('index.html','utf8');await writeFile(folder+'/index.html',html);
const artifactURL=pathToFileURL(process.cwd()+'/'+folder+'/index.html').href;
const browser=await chromium.launch({executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[],requests=[],id='host-route',title='Host Route',hash='#/labs/'+id;
const close=page=>page.locator('[data-action=close-dialog]').first().click();
const progress=(page,n)=>page.waitForFunction(n=>document.querySelector('[data-guide-progress]')?.textContent===`${n} of 10 tasks complete`,n);
async function command(page,line){await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');}
async function openNode(page,name){await page.locator('[data-action=fit]').click();await page.locator(`[data-device="device-host-route-${name.toLowerCase()}"] .device-body`).dblclick();}
async function detail(page){
 await page.locator('.header-actions [data-action=lab-catalog]').click();await page.locator('[data-catalog-section=Routing]').click();
 assert.equal(await page.locator('[data-catalog-section=Routing] .catalog-count').textContent(),'5');await page.locator(`[data-catalog-lab="${id}"]`).click();
}
async function testPing(page,goal,success=true){
 await page.locator(`[data-guide-test="${goal}"]`).click();
 await page.waitForFunction(({goal,success})=>{const text=document.querySelector(`[data-test-status="${goal}"]`)?.textContent;return success?text==='3 of 3 replies received.':text?.startsWith('No replies.');},{goal,success});
}
async function allTraffic(page){for(const goal of ['srv1-v4','srv1-v6','srv2-v4','srv2-v6','return-v4','return-v6'])await testPing(page,goal);}
async function change(page,name,lines){await openNode(page,name);for(const line of ['enable','configure terminal',...lines,'end'])await command(page,line);await page.locator('[data-action=close-dock]').click();}
const v4host='ip route 203.0.113.10 255.255.255.255 GigabitEthernet0/2 10.0.13.2 200',v6host='ipv6 route 2001:db8:30::10/128 GigabitEthernet0/2 fe80::3 200';
async function output(page,line){await command(page,line);return(await page.locator('#terminal-output').textContent()).replace(/\s/g,'').split(line.replace(/\s/g,'')).at(-1);}
async function inspect(page,line,pattern){await openNode(page,'R1');for(const cmd of ['enable','terminal length 0'])await command(page,cmd);assert.match(await output(page,line),pattern);await page.locator('[data-action=close-dock]').click();}
async function scenario(theme,width){
 const page=await browser.newPage({viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600});page.setDefaultTimeout(25000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.route(/^https?:\/\//,r=>r.abort());await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);window.qaToasts=[];window.qaStartupWorkspace=localStorage.getItem('network-sim.workspace.v1');addEventListener('DOMContentLoaded',()=>{const e=document.querySelector('#toast');if(e){window.qaToasts.push(e.textContent);new MutationObserver(()=>window.qaToasts.push(e.textContent)).observe(e,{childList:true,subtree:true,characterData:true});}});},theme);
 try{
  await page.goto(artifactURL);await detail(page);assert.ok(page.url().endsWith(hash));assert.match(await page.locator('.catalog-meta').first().textContent(),/CCNA · Routing/);
  assert.equal(await page.locator('.catalog-tasks').first().locator('li').count(),10);assert.equal(await page.locator('.catalog-table tbody tr').count(),11);
  assert.equal(await page.locator('.catalog-reference').getAttribute('open'),null);await page.locator('.catalog-reference summary').click();
  for(const pattern of [/255\.255\.255\.255/,/2001:db8:30::10\/128 GigabitEthernet0\/2 fe80::3 200/,/longest-prefix/i,/local receive/,/return route/])assert.match(await page.locator('.catalog-reference').textContent(),pattern);
  await page.locator('.catalog-reference summary').click();await page.locator('[data-catalog-mode=practice]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===7);
  await page.locator('#lab-guide-button').click();await progress(page,0);await testPing(page,'srv1-v4',false);await progress(page,0);await close(page);
  for(const[name,lines]of Object.entries(COMMANDS)){await openNode(page,name);for(const line of lines)await command(page,line);await page.locator('[data-action=close-dock]').click();}
  await page.locator('#lab-guide-button').click();await progress(page,4);await allTraffic(page);await progress(page,10);assert.equal(await page.locator('[data-guide-completion]').isVisible(),true);await close(page);
  await inspect(page,'show ip route 203.0.113.10',/203\.0\.113\.10\/32.*distance200.*10\.0\.13\.2/);await inspect(page,'show ip route 203.0.113.20',/203\.0\.113\.0\/24.*distance1.*10\.0\.12\.2/);
  await inspect(page,'show ipv6 route 2001:db8:30::10',/2001:DB8:30::10\/128\[200\/0\]viaFE80::3,GigabitEthernet0\/2/);await inspect(page,'show ipv6 route 2001:db8:30::20',/2001:DB8:30::\/64\[1\/0\]via2001:DB8:12::2/);
  await openNode(page,'PC1');await page.getByRole('button',{name:'Command prompt',exact:true}).click();for(const[target,viaR2]of [['203.0.113.10',false],['203.0.113.20',true],['2001:db8:30::10',false],['2001:db8:30::20',true]]){const text=await output(page,`tracert ${target.includes(':')?'-6 ':''}-d ${target}`);assert.match(text,/Tracecomplete/);assert.equal(text.includes(target.includes(':')?'2001:db8:12::2':'10.0.12.2'),viaR2);}
  const terminal=await page.locator('#terminal-output').evaluate(e=>({background:getComputedStyle(e.closest('.terminal')).backgroundColor,foreground:getComputedStyle(e).color}));assert.deepEqual(terminal,{background:'rgb(51, 51, 51)',foreground:'rgb(255, 185, 0)'});await page.locator('[data-action=close-dock]').click();
  await change(page,'R1',['no '+v4host]);await inspect(page,'show ip route 203.0.113.10',/203\.0\.113\.0\/24.*distance1.*10\.0\.12\.2/);await page.locator('#lab-guide-button').click();assert.equal(await page.locator('[data-objective=ipv4-host]').getAttribute('data-complete'),'false');await testPing(page,'srv1-v4');await testPing(page,'srv1-v6');await close(page);
  await change(page,'R1',[v4host,'no '+v6host]);await inspect(page,'show ipv6 route 2001:db8:30::10',/2001:DB8:30::\/64\[1\/0\]via2001:DB8:12::2/);await page.locator('#lab-guide-button').click();assert.equal(await page.locator('[data-objective=ipv6-host]').getAttribute('data-complete'),'false');await testPing(page,'srv1-v6');await testPing(page,'srv2-v6');await close(page);await change(page,'R1',[v6host]);
  await change(page,'R3',['no ip route 192.168.10.0 255.255.255.0 GigabitEthernet0/2 10.0.13.1']);await page.locator('#lab-guide-button').click();assert.equal(await page.locator('[data-objective=return-routes]').getAttribute('data-complete'),'false');await testPing(page,'srv1-v4',false);await testPing(page,'srv1-v6');await close(page);await change(page,'R3',['ip route 192.168.10.0 255.255.255.0 GigabitEthernet0/2 10.0.13.1']);
  await page.locator('#lab-guide-button').click();await allTraffic(page);await progress(page,10);await page.locator('#toast').evaluate(e=>e.style.display='none');
  assert.ok(await page.locator('.dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;}));await page.screenshot({path:`${folder}/guide-${theme}-${width}.png`,animations:'disabled'});await close(page);await page.locator('[data-action=fit]').click();await page.screenshot({path:`${folder}/topology-${theme}-${width}.png`,animations:'disabled'});
  await page.waitForTimeout(1200);const beforeReload=await page.evaluate(()=>localStorage.getItem('network-sim.workspace.v1'));assert.equal(parseDocument(beforeReload).lab.name,title);await writeFile(`${folder}/before-reload-${theme}-${width}.json`,beforeReload);await page.reload();try{await page.waitForFunction(expected=>document.querySelector('#lab-name')?.textContent===expected,title);}catch(error){await writeFile(`${folder}/reload-failure-${theme}-${width}.json`,JSON.stringify({before:JSON.parse(beforeReload),after:await page.evaluate(()=>({name:document.querySelector('#lab-name')?.textContent,toasts:window.qaToasts,startupWorkspace:window.qaStartupWorkspace,workspace:localStorage.getItem('network-sim.workspace.v1'),keys:Object.keys(localStorage)}))},null,2));throw error;}await page.locator('#lab-guide-button').click();await progress(page,10);await testPing(page,'srv1-v4');await testPing(page,'srv1-v6');await close(page);
  await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#cancel-lab-import').click();assert.equal(await page.locator('#lab-name').textContent(),title);await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#lab-import-save').click();await page.waitForFunction(()=>document.querySelector('#lab-name')?.textContent.includes('Completed'));await page.locator('#lab-guide-button').click();await progress(page,4);await allTraffic(page);await progress(page,10);
  checks.push(`${theme} ${width}px: five Routing labs, ten-task host-route guide and eleven-row address plan, zero-credit practice, both published IOS configurations, six real 3/3 traffic tests, AD 200 host versus AD 1 network lookups and four real traceroutes proving different neighboring-server paths, per-family host-route removal with working broader-route fallback and revoked host credit, missing return route and repair, retained progress after offline reload, completed reference, cancel/save-copy protection, responsive guide and unchanged CLI colors`);process.stdout.write(`PASS ${theme} ${width}\n`);
 }catch(error){await page.screenshot({path:`${folder}/failure-${theme}-${width}.png`});throw error;}finally{await page.close();}
}
try{
 for(const theme of ['light','dark']){const results=await Promise.allSettled([1440,390,320].map(width=>scenario(theme,width)));for(const r of results)if(r.status==='rejected')throw r.reason;}
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),base='https://training.example/campus/NetworkSim/index.html?class=ccna&room=2';page.setDefaultTimeout(16000);page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'text/html',body:html}));await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLabURL=text;}}});},theme);
  await page.goto(base+hash);await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(await page.locator('#world .device').count(),0);await page.locator('[data-catalog-copy]').click();await page.waitForFunction(expected=>window.copiedLabURL===expected,base+hash);
  await page.locator('[data-catalog-back]').click();assert.equal(await page.locator('[data-catalog-section=Routing]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-catalog-section=Routing] .catalog-count').textContent(),'5');assert.equal(await page.locator(`[data-catalog-lab="${id}"]`).getAttribute('href'),base+hash);
  checks.push(`${theme}: permalink preserves the current host/path/query, previews without replacing the workspace, and returns to five Routing labs`);process.stdout.write(`PASS ${theme} permalink\n`);await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await writeFile(folder+'/validation.json',JSON.stringify({artifactSha256:createHash('sha256').update(html).digest('hex'),checks,errors,externalRequests:requests},null,2)+'\n');
}finally{await browser.close();}
