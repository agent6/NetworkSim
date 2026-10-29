import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {IPV4_TROUBLESHOOTING_COMMANDS} from '../src/lab-catalog.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/ipv4-troubleshooting';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[],requests=[],id='ipv4-addressing-troubleshooting',hash='#/labs/'+id;
const close=page=>page.locator('[data-action=close-dialog]').first().click();
const command=async(page,line)=>{await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');};
const progress=(page,n)=>page.waitForFunction(n=>document.querySelector('[data-guide-progress]')?.textContent===`${n} of 5 tasks complete`,n);
const detail=async page=>{await page.locator('.header-actions [data-action=lab-catalog]').click();await page.locator(`[data-catalog-lab=${id}]`).click();};
try{
 for(const theme of ['light','dark'])for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.route(/^https?:\/\//,r=>r.abort());await page.addInitScript(t=>localStorage.setItem('network-sim.theme.v1',t),theme);
  await page.goto(pathToFileURL(process.cwd()+'/index.html').href);await detail(page);assert.ok(page.url().endsWith(hash));assert.match(await page.locator('.catalog-meta').first().textContent(),/CCNA · Fundamentals/);assert.equal(await page.locator('.catalog-tasks li').count(),5);assert.equal(await page.locator('.catalog-table tbody tr').count(),4);assert.equal(await page.locator('.catalog-reference').getAttribute('open'),null);
  await page.locator('.catalog-reference summary').click();assert.match(await page.locator('.catalog-reference').textContent(),/netsh interface ipv4 set address/);assert.match(await page.locator('.catalog-reference').textContent(),/no ip proxy-arp/);await page.locator('.catalog-reference summary').click();assert.ok(await page.locator('.dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;}));await page.screenshot({path:`${folder}/detail-${theme}-${width}.png`,animations:'disabled'});
  await page.locator('[data-catalog-mode=practice]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===3);await page.locator('#lab-guide-button').click();await progress(page,0);await page.locator('[data-guide-test=pc1-ping]').click();await page.waitForFunction(()=>document.querySelector('[data-test-status=pc1-ping]')?.textContent?.startsWith('No replies.'));await progress(page,0);await close(page);
  // Repair through the same visible consoles and desktop tools used by a learner.
  for(const[name,commands]of Object.entries(IPV4_TROUBLESHOOTING_COMMANDS)){
   const node=page.locator(`[data-device=device-ipv4-ts-${name.toLowerCase()}] .device-body`);await node.dblclick();
   if(name!=='R1')await page.locator('[data-desktop=cli]').click();
   await command(page,name==='R1'?'enable':'ipconfig /all');if(name==='R1'){await command(page,'terminal length 0');await command(page,'show ip interface brief');assert.match((await page.locator('#terminal-output').textContent()).replace(/\s/g,''),/192\.168\.30\.1/);}else assert.match((await page.locator('#terminal-output').textContent()).replace(/\s/g,''),name==='PC1'?/192\.168\.10\.254/:/255\.255\.0\.0/);
   if(name==='PC2'&&width===320){
    await node.dblclick();await page.locator('[data-desktop=ip]').click();assert.equal(await page.locator('[name=mask]').inputValue(),'255.255.0.0');await page.locator('[name=mask]').fill('255.255.255.0');await page.locator('[form=dialog-form]').click();
   }else for(const line of commands.filter(line=>line!=='enable'))await command(page,line);
   await page.locator('#lab-guide-button').click();await progress(page,name==='R1'?1:name==='PC1'?2:3);await close(page);
  }
  await page.locator('#lab-guide-button').click();await page.locator('[data-guide-test=pc1-ping]').click();await page.locator('[data-guide-test=pc2-ping]').click();await progress(page,5);await page.waitForFunction(()=>[...document.querySelectorAll('[data-test-status]')].every(e=>e.textContent==='3 of 3 replies received.'));await page.locator('#toast').evaluate(e=>e.style.display='none');await page.screenshot({path:`${folder}/repaired-${theme}-${width}.png`,animations:'disabled'});await close(page);
  await page.waitForTimeout(1200);await page.reload();await page.locator('#lab-guide-button').click();await progress(page,5);assert.equal(await page.locator('.catalog-table tbody tr').count(),4);await close(page);
  await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#cancel-lab-import').click();assert.equal(await page.locator('#lab-name').textContent(),'IPv4 addressing troubleshooting');
  await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#lab-import-save').click();await page.waitForFunction(()=>document.querySelector('#lab-name').textContent.includes('Completed'));await page.locator('#lab-guide-button').click();await progress(page,3);await page.locator('[data-guide-test=pc1-ping]').click();await page.locator('[data-guide-test=pc2-ping]').click();await progress(page,5);
  checks.push(`${theme} ${width}px: Fundamentals entry, addressing plan, collapsed repair reference, failing baseline, visible IOS/Windows diagnosis and ${width===320?'PC IP settings':'CLI'} repairs, live 1/2/3-task progression, bidirectional replies, restored progress and safe completed-lab replacement`);console.log('PASS',theme,width);await page.close();
 }
 const html=await readFile('index.html','utf8');
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),base='https://training.example/campus/NetworkSim/index.html?class=ccna&room=2';page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'text/html',body:html}));
  await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLabURL=text;}}});},theme);await page.goto(base+hash);await page.getByRole('heading',{name:'IPv4 addressing troubleshooting',exact:true}).waitFor();assert.equal(await page.locator('#world .device').count(),0);await page.locator('[data-catalog-copy]').click();await page.waitForFunction(expected=>window.copiedLabURL===expected,base+hash);
  await page.locator('[data-catalog-back]').click();assert.equal(await page.locator('[data-catalog-section=Fundamentals]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator(`[data-catalog-lab=${id}]`).getAttribute('href'),base+hash);assert.equal(await page.locator('[data-catalog-lab=ipv4-interface-configuration]').count(),1);
  checks.push(`${theme}: direct entry, sharing preserves current host/subfolder/query and Back returns to both Fundamentals labs without replacing the workspace`);console.log('PASS',theme,'permalink');await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await writeFile(folder+'/validation.json',JSON.stringify({artifactSha256:createHash('sha256').update(html).digest('hex'),checks,errors,externalRequests:requests},null,2)+'\n');
}finally{await browser.close();}
