import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseDocument} from '../src/persistence.ts';
import {RADIUS_AAA_CLIENT_COMMANDS as COMMANDS} from '../src/lab-catalog.ts';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const chrome=process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const folder='.cache/radius-aaa-client-catalog-browser',id='radius-aaa-client',title='RADIUS AAA Client',hash='#/labs/'+id;
await mkdir(folder,{recursive:true});const html=await readFile('index.html','utf8');await writeFile(folder+'/index.html',html);
const checks=[],errors=[],externalRequests=[];
const terminalFixture=JSON.parse(await readFile('tests/fixtures/console-theme-styles.json','utf8'));
async function assertTerminalTheme(page){
  await page.locator('#terminal-input').focus();await page.waitForTimeout(200);
  const theme=await page.locator('html').getAttribute('data-theme'),mobile=page.viewportSize().width<600;
  const expected=mobile?terminalFixture.mobileThemes[theme].expanded:terminalFixture.themes[theme].normal;
  const params={ids:expected.map(e=>e.key),props:Object.keys(expected[0].styles)};
  const actual=await page.locator('#console-panel').evaluate((root,{ids,props})=>[root,...root.querySelectorAll('*')].filter(e=>ids.includes(e.id)).map(e=>({key:e.id,styles:Object.fromEntries(props.map(p=>[p,getComputedStyle(e)[p]]))})),params);
  assert.deepEqual(actual,expected,'CLI font, colors, cursor and controls must retain their established styles');
}
const close=page=>page.locator('[data-action=close-dialog]').first().click();
const progress=(page,n)=>page.waitForFunction(n=>document.querySelector('[data-guide-progress]')?.textContent===`${n} of 10 tasks complete`,n);
async function command(page,line){await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');}
async function output(page,line){await command(page,line);return(await page.locator('#terminal-output').textContent()).replace(/\s/g,'').split(line.replace(/\s/g,'')).at(-1);}
const prompt=(page,text)=>page.waitForFunction(text=>document.querySelector('#terminal-prompt')?.textContent===text,text);
async function pollOutput(page,line,pattern){let text='';for(let i=0;i<40;i++){text=await output(page,line);if(pattern.test(text))return text;await page.waitForTimeout(250);}assert.match(text,pattern);return text;}
async function openNode(page,name){await page.locator('[data-action=fit]').click();await page.locator(`[data-device="device-radius-aaa-${name.toLowerCase()}"] .device-body`).dblclick();if(name==='PC1')await page.getByRole('button',{name:'Command prompt',exact:true}).click();}
async function detail(page){
  await page.locator('.header-actions [data-action=lab-catalog]').click();const section=page.locator('[data-catalog-section="Services & Security"]');
  assert.equal(await section.getAttribute('aria-label'),'Services & Security, 3 labs');assert.equal(await section.locator('.catalog-count').textContent(),'3');await section.click();await page.locator(`[data-catalog-lab="${id}"]`).click();
}
async function guide(page,n){await page.locator('#lab-guide-button').click();await progress(page,n);}
async function ping(page){await page.locator('[data-guide-test=pc1-server]').click();await page.waitForFunction(()=>document.querySelector('[data-test-status=pc1-server]')?.textContent==='3 of 3 replies received.');}
async function services(page){
  await openNode(page,'SRV1');await page.locator('[data-desktop=services]').click();await page.locator('[data-service-tab=AAA]').click();
  assert.ok(await page.locator('#radius-users [data-aaa-row]').first().evaluate(row=>{const box=row.getBoundingClientRect();return [...row.querySelectorAll('input,select,button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;});}),'AAA account controls overflow their row');
}
async function records(page,expected){
  await services(page);await page.waitForFunction(n=>document.querySelector('[data-aaa-accounting]')?.textContent?.includes(`${n} stored`),expected);
  const text=await page.locator('[data-aaa-accounting]').textContent();
  if(expected){assert.match(text,/radius 192\.168\.100\.1 netadmin vty 0 4 exec start/);assert.match(text,/radius 192\.168\.100\.1 netadmin vty 0 4 exec stop/);assert.match(text,/remote=192\.0\.2\.10 privilege=15/);const starts=[...text.matchAll(/exec start session=(\S+)/g)].map(m=>m[1]),stops=[...text.matchAll(/exec stop session=(\S+)/g)].map(m=>m[1]);assert.ok(starts.some(start=>stops.includes(start)));}
  else assert.match(text,/No accounting records received/);
  const log=await page.locator('[data-aaa-accounting] pre').textContent();for(const password of ['RadiusAdmin123','RescueLab123','EnableLab123','RadiusLabKey'])assert.ok(!log.includes(password));
  return text;
}
async function setServer(page,{enabled,authorization}={}){
  await services(page);if(enabled!==undefined)await page.locator('[name=radius-enabled]').setChecked(enabled);if(authorization)await page.locator('[name=radius-authorization]').selectOption(authorization);
  await page.getByRole('button',{name:'Save changes',exact:true}).click();assert.equal(await page.locator('#form-error').count(),0);
}
async function login(page,user='netadmin',exercise=false){
  await openNode(page,'PC1');await prompt(page,'C:\\>');await command(page,`ssh -l ${user} 192.0.2.1`);await prompt(page,'Password:');assert.equal(await page.locator('#terminal-input').getAttribute('type'),'password');
  if(exercise){assert.match(await output(page,'WrongLab123'),/Logininvalid/);await prompt(page,'Password:');}
  await command(page,user==='netadmin'?'RadiusAdmin123':'RescueLab123');await prompt(page,'R1#');await command(page,'terminal length 0');assert.match(await output(page,'show privilege'),/levelis15/);
  assert.ok((await output(page,'show users')).includes(user));
  if(user==='netadmin')await pollOutput(page,'show accounting',/Delivered[1-9]/);else await pollOutput(page,'show accounting',/Failed[1-9]/);
  const text=await page.locator('#terminal-output').textContent();for(const password of ['RadiusAdmin123','RescueLab123','EnableLab123','WrongLab123'])assert.ok(!text.includes(password));
  const colors=await page.locator('#terminal-output').evaluate(e=>({background:getComputedStyle(e.closest('.terminal')).backgroundColor,foreground:getComputedStyle(e).color}));assert.deepEqual(colors,{background:'rgb(51, 51, 51)',foreground:'rgb(255, 185, 0)'});await assertTerminalTheme(page);
  await command(page,'exit');await prompt(page,'C:\\>');await page.locator('[data-action=close-dock]').click();
}
async function rejectLocal(page){
  await openNode(page,'PC1');await command(page,'ssh -l rescue 192.0.2.1');await prompt(page,'Password:');
  for(let i=0;i<2;i++){assert.match(await output(page,'RescueLab123'),/Logininvalid/);await prompt(page,'Password:');}
  assert.match(await output(page,'RescueLab123'),/Badpasswords/);await prompt(page,'C:\\>');await page.locator('[data-action=close-dock]').click();
}
async function denyExec(page){await openNode(page,'PC1');await command(page,'ssh -l netadmin 192.0.2.1');await prompt(page,'Password:');assert.match(await output(page,'RadiusAdmin123'),/EXECauthorizationfailed/);await prompt(page,'C:\\>');await page.locator('[data-action=close-dock]').click();}
async function reloadAndConsole(page){
  await page.waitForTimeout(1200);const saved=await page.evaluate(()=>localStorage.getItem('network-sim.workspace.v1'));assert.equal(parseDocument(saved).lab.name,title);await page.reload();
  try{await page.waitForFunction(title=>document.querySelector('#lab-name')?.textContent===title,title);}catch(error){await writeFile(folder+'/reload-failure.json',JSON.stringify({before:JSON.parse(saved),after:await page.evaluate(()=>({name:document.querySelector('#lab-name')?.textContent,startup:window.qaStartupWorkspace,workspace:localStorage.getItem('network-sim.workspace.v1'),toasts:window.qaToasts}))},null,2));throw error;}
  await guide(page,10);await close(page);await records(page,0);await close(page);
  await openNode(page,'R1');await prompt(page,'Username:');await command(page,'rescue');await prompt(page,'Password:');assert.equal(await page.locator('#terminal-input').getAttribute('type'),'password');await command(page,'RescueLab123');await prompt(page,'R1>');assert.match(await output(page,'show privilege'),/levelis1/);await command(page,'enable');await command(page,'EnableLab123');await prompt(page,'R1#');assert.match(await output(page,'show privilege'),/levelis15/);await page.locator('[data-action=close-dock]').click();
  await login(page);await records(page,2);await close(page);
}
async function scenario(theme,width){
  const profile=await mkdtemp(`${folder}/profile-${theme}-${width}-`),context=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600});
  const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(r.url());});await page.route(/^https?:\/\//,r=>r.abort());
  await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);window.qaStartupWorkspace=localStorage.getItem('network-sim.workspace.v1');window.qaToasts=[];addEventListener('DOMContentLoaded',()=>{const e=document.querySelector('#toast');if(e)new MutationObserver(()=>window.qaToasts.push(e.textContent)).observe(e,{childList:true,subtree:true,characterData:true});});},theme);
  try{
    const artifact=`${folder}/index-${theme}-${width}.html`;await writeFile(artifact,html);await page.goto(pathToFileURL(process.cwd()+'/'+artifact).href);await detail(page);
    assert.ok(page.url().endsWith(hash));assert.match(await page.locator('.catalog-meta').first().textContent(),/CCNA · Services & Security/);assert.equal(await page.locator('.catalog-tasks').first().locator('li').count(),10);assert.equal(await page.locator('.catalog-table tbody tr').count(),4);
    await page.locator('.catalog-reference summary').click();for(const phrase of ['radius server RADIUS1','aaa group server radius RAD-GROUP','aaa authentication login VTY-AUTH group RAD-GROUP local','aaa authorization exec VTY-EXEC','aaa accounting exec VTY-ACCT','authorization exec VTY-EXEC','accounting exec VTY-ACCT','fallback'])assert.ok((await page.locator('.catalog-reference').textContent()).includes(phrase));
    await page.locator('[data-catalog-mode=practice]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===3);await guide(page,0);await close(page);await records(page,0);await close(page);
    await openNode(page,'R1');for(const line of COMMANDS.R1)await command(page,line);await prompt(page,'R1#');
    for(const line of ['terminal length 0','show aaa servers','show radius statistics','show running-config | section aaa','show running-config | section line']){const text=await output(page,line);assert.doesNotMatch(text,/Invalidinput|Incompletecommand/);}
    await page.locator('[data-action=close-dock]').click();await guide(page,8);await ping(page);await progress(page,9);await close(page);
    await login(page,'netadmin',true);await guide(page,10);assert.equal(await page.locator('[data-guide-completion]').isVisible(),true);await close(page);await records(page,2);await close(page);
    await rejectLocal(page);await records(page,2);await close(page);
    await setServer(page,{enabled:false});await guide(page,9);assert.equal(await page.locator('[data-objective=radius-server]').getAttribute('data-complete'),'false');await ping(page);await close(page);await login(page,'rescue');await records(page,2);await close(page);
    await setServer(page,{enabled:true});await login(page);await records(page,4);await close(page);await setServer(page,{authorization:'deny'});await denyExec(page);await records(page,4);await close(page);await setServer(page,{authorization:'allow'});await login(page);await records(page,6);
    await page.locator('[data-aaa-accounting]').scrollIntoViewIfNeeded();await page.screenshot({path:`${folder}/accounting-${theme}-${width}.png`,animations:'disabled'});await close(page);
    await reloadAndConsole(page);await guide(page,10);await page.locator('[data-guide-progress]').scrollIntoViewIfNeeded();assert.ok(await page.locator('.dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;}));await page.locator('#toast').evaluate(e=>e.style.display='none');await page.screenshot({path:`${folder}/guide-${theme}-${width}.png`,animations:'disabled'});await close(page);await page.locator('[data-action=fit]').click();await page.screenshot({path:`${folder}/topology-${theme}-${width}.png`,animations:'disabled'});
    await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#cancel-lab-import').click();assert.equal(await page.locator('#lab-name').textContent(),title);await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#lab-import-save').click();await page.waitForFunction(()=>document.querySelector('#lab-name')?.textContent.includes('Completed'));
    await guide(page,8);await ping(page);await close(page);await records(page,0);await close(page);await login(page);await records(page,2);await close(page);await guide(page,10);
    checks.push(`${theme} ${width}px: three Services & Security labs, ten-task guide and four-row plan, zero-credit practice with prepared RADIUS server, published named IOS AAA/SSH configuration and eight live goals, real routed ping and UDP1812 authentication with Access-Accept EXEC attributes, acknowledged UDP1813 paired server accounting with NAS/PC addresses and privilege, hidden input and wrong-password rejection, healthy-server rejection without local fallback, unavailable-service local authentication/authorization fallback without fabricated accounting, denied Access-Accept EXEC permission without new Start, service/policy restoration, saved achievements and fresh console/receiver state after reload, completed reference requiring new traffic/session evidence, save/cancel protection, responsive AAA controls/guide and unchanged CLI fonts, colors, cursor and controls against the established golden styles`);process.stdout.write(`PASS ${theme} ${width}\n`);
  }catch(error){await writeFile(`${folder}/failure-${theme}-${width}.json`,JSON.stringify(await page.evaluate(()=>({name:document.querySelector('#lab-name')?.textContent,prompt:document.querySelector('#terminal-prompt')?.textContent,terminal:document.querySelector('#terminal-output')?.textContent,formError:document.querySelector('#form-error')?.textContent,toasts:window.qaToasts})),null,2));await page.screenshot({path:`${folder}/failure-${theme}-${width}.png`});throw error;}
  finally{await context.close();await rm(profile,{recursive:true,force:true});}
}
for(const theme of ['light','dark'])for(const width of [1440,390,320])await scenario(theme,width);
const browser=await chromium.launch({executablePath:chrome,headless:true});
try{
  for(const theme of ['light','dark']){
    const page=await browser.newPage({viewport:{width:390,height:844}}),base='https://training.example/campus/NetworkSim/index.html?class=ccna&room=2';page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'text/html',body:html}));
    await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLabURL=text;}}});},theme);await page.goto(base+hash);await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(await page.locator('#world .device').count(),0);await page.locator('[data-catalog-copy]').click();await page.waitForFunction(expected=>window.copiedLabURL===expected,base+hash);await page.locator('[data-catalog-back]').click();
    const section=page.locator('[data-catalog-section="Services & Security"]');assert.equal(await section.getAttribute('aria-pressed'),'true');assert.equal(await section.locator('.catalog-count').textContent(),'3');assert.equal(await page.locator(`[data-catalog-lab="${id}"]`).getAttribute('href'),base+hash);assert.equal(await page.locator('[data-catalog-lab=local-user-authentication]').count(),1);checks.push(`${theme}: permalink preserves current host/path/query and returns to Services & Security with all three labs without replacing the workspace`);process.stdout.write(`PASS ${theme} permalink\n`);await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);await writeFile(folder+'/validation.json',JSON.stringify({artifactSha256:createHash('sha256').update(html).digest('hex'),checks,errors,externalRequests},null,2)+'\n');
}finally{await browser.close();}
