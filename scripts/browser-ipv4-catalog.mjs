import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {IPV4_INTERFACE_COMMANDS} from '../src/lab-catalog.ts';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/ipv4-catalog';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[],requests=[];
const close=page=>page.locator('[data-action=close-dialog]').first().click();
const command=async(page,line)=>{const input=page.locator('#terminal-input');await input.fill(line);await input.press('Enter');};
const progress=(page,n)=>page.waitForFunction(n=>document.querySelector('[data-guide-progress]')?.textContent===`${n} of 4 tasks complete`,n);
const fit=page=>page.locator('.dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;});
try{
 for(const theme of ['light','dark'])for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600});page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.route(/^https?:\/\//,r=>r.abort());
  await page.addInitScript(t=>localStorage.setItem('network-sim.theme.v1',t),theme);await page.goto(pathToFileURL(process.cwd()+'/index.html').href);
  await page.locator('.header-actions [data-action=lab-catalog]').click();assert.deepEqual(await page.locator('[data-catalog-section]').allTextContents(),['Fundamentals','Switching','Routing','Services & Security']);
  assert.equal(await page.locator('[data-catalog-section=Fundamentals]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-catalog-lab=router-on-a-stick]').count(),0);assert.ok(await fit(page));
  await page.locator('[data-catalog-section=Switching]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-catalog-lab=layer-2-switching-interfaces]').count(),1);assert.equal(await page.locator('[data-catalog-section=Switching]').evaluate(e=>document.activeElement===e),true);
  await page.locator('[data-catalog-section=Fundamentals]').click();await page.screenshot({path:`${folder}/fundamentals-${theme}-${width}.png`,animations:'disabled'});
  await page.locator('[data-catalog-lab=ipv4-interface-configuration]').click();assert.ok(page.url().endsWith('#/labs/ipv4-interface-configuration'));assert.equal(await page.locator('.catalog-table tbody tr').count(),2);assert.deepEqual(await page.locator('.catalog-table th').allTextContents(),['Device','Interface','IPv4 address','Subnet mask']);assert.equal(await page.locator('.catalog-tasks li').count(),4);assert.ok(await fit(page));
  await page.locator('.catalog-reference summary').click();assert.match(await page.locator('.catalog-reference').textContent(),/ip address 192\.0\.2\.2 255\.255\.255\.0/);assert.ok(!await page.locator('.catalog-reference').textContent().then(t=>t.includes('encapsulation dot1Q')));
  await page.locator('[data-catalog-back]').click();assert.equal(await page.locator('[data-catalog-section=Fundamentals]').getAttribute('aria-pressed'),'true');await page.locator('[data-catalog-lab=ipv4-interface-configuration]').click();await page.locator('[data-catalog-mode=practice]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===2);await page.locator('#lab-guide-button').click();await progress(page,0);assert.equal(await page.locator('[data-guide-test=r1-ping]').isDisabled(),true);assert.equal(await page.locator('[data-guide-test=r2-ping]').isDisabled(),true);await close(page);
  for(const [name,commands]of Object.entries(IPV4_INTERFACE_COMMANDS)){
   await page.locator(`[data-device=device-ipv4-${name.toLowerCase()}] .device-body`).dblclick();
   for(const line of [...commands,'show ip interface brief'])await command(page,line);
   assert.match(await page.locator('#terminal-output').textContent(),new RegExp(name==='R1'?'192\\.0\\.2\\.1':'192\\.0\\.2\\.2'));
  }
  await page.locator('#lab-guide-button').click();await progress(page,2);await page.locator('[data-guide-test=r1-ping]').click();await page.locator('[data-guide-test=r2-ping]').click();await progress(page,4);await page.waitForFunction(()=>[...document.querySelectorAll('[data-test-status]')].every(e=>e.textContent==='3 of 3 replies received.'));
  await page.locator('#toast').evaluate(e=>e.style.display='none');await page.screenshot({path:`${folder}/guide-${theme}-${width}.png`,animations:'disabled'});await close(page);await page.waitForTimeout(1200);await page.reload();await page.locator('#lab-guide-button').click();await progress(page,4);assert.equal(await page.locator('.catalog-table tbody tr').count(),2);await close(page);
  // Completed reference copies use the same replacement protection as every catalog lab.
  await page.locator('.header-actions [data-action=lab-catalog]').click();await page.locator('[data-catalog-lab=ipv4-interface-configuration]').click();await page.locator('[data-catalog-mode=completed]').click();await page.locator('#cancel-lab-import').click();assert.equal(await page.locator('#lab-name').textContent(),'IPv4 interface configuration');
  await page.locator('.header-actions [data-action=lab-catalog]').click();await page.locator('[data-catalog-lab=ipv4-interface-configuration]').click();await page.locator('[data-catalog-mode=completed]').click();await page.locator('#lab-import-save').click();await page.waitForFunction(()=>document.querySelector('#lab-name').textContent.includes('Completed'));await page.locator('#lab-guide-button').click();await progress(page,2);
  checks.push(`${theme} ${width}px: four CCNA sections, keyboard focus, initial practice, per-lab addressing/reference, visible IOS configuration, bidirectional 3/3 replies, restored progress, cancel/save protection and completed reference`);console.log('PASS',theme,width);await page.close();
 }
 const html=await readFile('index.html','utf8');
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),base='https://campus.example/apps/NetworkSim/index.html?class=ccna&room=2',hash='#/labs/ipv4-interface-configuration';page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'text/html',body:html}));
  await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLabURL=text;}}});},theme);
  await page.goto(base+hash);await page.getByRole('heading',{name:'IPv4 interface configuration',exact:true}).waitFor();assert.equal(await page.locator('#world .device').count(),0);await page.locator('[data-catalog-copy]').click();await page.waitForFunction(expected=>window.copiedLabURL===expected,base+hash);
  await page.locator('[data-catalog-back]').click();assert.equal(await page.locator('[data-catalog-section=Fundamentals]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-catalog-lab=ipv4-interface-configuration]').getAttribute('href'),base+hash);
  await page.locator('[data-catalog-section=Routing]').click();await page.locator('[data-catalog-lab=router-on-a-stick]').click();await page.locator('[data-catalog-back]').click();assert.equal(await page.locator('[data-catalog-section=Routing]').getAttribute('aria-pressed'),'true');
  checks.push(`${theme}: new lab direct link and clipboard preserve the current host, subfolder and query; Back restores Fundamentals or Routing without replacing the workspace`);console.log('PASS',theme,'permalink');await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 await writeFile(folder+'/validation.json',JSON.stringify({artifactSha256:createHash('sha256').update(await readFile('index.html')).digest('hex'),checks,errors,externalRequests:requests},null,2)+'\n');
}finally{await browser.close();}
