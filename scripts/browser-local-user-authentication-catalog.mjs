import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseDocument} from '../src/persistence.ts';
import {LOCAL_USER_AUTHENTICATION_COMMANDS as COMMANDS} from '../src/lab-catalog.ts';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const chrome=process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const folder='.cache/local-user-authentication-catalog-browser',id='local-user-authentication',title='Local User Authentication',hash='#/labs/'+id;
await mkdir(folder,{recursive:true});
const html=await readFile('index.html','utf8');
await writeFile(folder+'/index.html',html);
const checks=[],errors=[],externalRequests=[];
const close=page=>page.locator('[data-action=close-dialog]').first().click();
const progress=(page,n)=>page.waitForFunction(n=>document.querySelector('[data-guide-progress]')?.textContent===`${n} of 9 tasks complete`,n);
async function command(page,line){await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');}
async function output(page,line){await command(page,line);return(await page.locator('#terminal-output').textContent()).replace(/\s/g,'').split(line.replace(/\s/g,'')).at(-1);}
async function prompt(page,text){await page.waitForFunction(text=>document.querySelector('#terminal-prompt')?.textContent===text,text);}
async function openNode(page,name){
  await page.locator('[data-action=fit]').click();
  await page.locator(`[data-device="device-local-auth-${name.toLowerCase()}"] .device-body`).dblclick();
  if(name==='PC1')await page.getByRole('button',{name:'Command prompt',exact:true}).click();
}
async function detail(page){
  await page.locator('.header-actions [data-action=lab-catalog]').click();
  const section=page.locator('[data-catalog-section="Services & Security"]');
  assert.equal(await section.getAttribute('aria-label'),'Services & Security, 13 labs');
  assert.equal(await section.locator('.catalog-count').textContent(),'13');
  await section.click();await page.locator(`[data-catalog-lab="${id}"]`).click();
}
async function guide(page,n){await page.locator('#lab-guide-button').click();await progress(page,n);}
async function ping(page){
  await page.locator('[data-guide-test=pc1-r1]').click();
  await page.waitForFunction(()=>document.querySelector('[data-test-status=pc1-r1]')?.textContent==='3 of 3 replies received.');
}
async function login(page,user,exercise=false){
  await openNode(page,'PC1');await prompt(page,'C:\\>');
  await command(page,`ssh -l ${user} 192.0.2.1`);await prompt(page,'Password:');
  assert.equal(await page.locator('#terminal-input').getAttribute('type'),'password');
  if(exercise){assert.match(await output(page,'WrongLab123'),/Logininvalid/);await prompt(page,'Password:');}
  await command(page,user==='admin'?'AdminLab123':'OperatorLab123');await prompt(page,user==='admin'?'R1#':'R1>');
  assert.match(await output(page,'show privilege'),new RegExp('levelis'+(user==='admin'?15:1)));
  if(exercise){
    assert.match(await output(page,'configure terminal'),/Invalid|privilege/i);await prompt(page,'R1>');
    await command(page,'enable');await prompt(page,'Password:');
    assert.match(await output(page,'OperatorLab123'),/Authenticationfailed/);
    await command(page,'EnableLab123');await prompt(page,'R1#');
    assert.match(await output(page,'show privilege'),/levelis15/);
  }
  assert.ok((await output(page,'show users')).includes(user));
  assert.ok((await output(page,'show ssh')).includes(user));
  const text=await page.locator('#terminal-output').textContent();
  for(const password of ['AdminLab123','OperatorLab123','EnableLab123','WrongLab123'])assert.ok(!text.includes(password),'Password leaked in terminal output');
  const colors=await page.locator('#terminal-output').evaluate(e=>({background:getComputedStyle(e.closest('.terminal')).backgroundColor,foreground:getComputedStyle(e).color}));
  assert.deepEqual(colors,{background:'rgb(51, 51, 51)',foreground:'rgb(255, 185, 0)'});
  await command(page,'exit');await prompt(page,'C:\\>');await page.locator('[data-action=close-dock]').click();
}
async function changeTransport(page,value){
  await openNode(page,'R1');await prompt(page,'R1#');
  for(const line of ['configure terminal','line vty 0 4','transport input '+value,'end','write memory'])await command(page,line);
  await page.locator('[data-action=close-dock]').click();
}
async function reloadAndConsole(page){
  await page.waitForTimeout(1200);
  const saved=await page.evaluate(()=>localStorage.getItem('network-sim.workspace.v1'));
  assert.equal(parseDocument(saved).lab.name,title);
  await page.reload();
  try{await page.waitForFunction(title=>document.querySelector('#lab-name')?.textContent===title,title);}
  catch(error){await writeFile(folder+'/reload-failure.json',JSON.stringify({before:JSON.parse(saved),after:await page.evaluate(()=>({name:document.querySelector('#lab-name')?.textContent,startup:window.qaStartupWorkspace,workspace:localStorage.getItem('network-sim.workspace.v1'),toasts:window.qaToasts}))},null,2));throw error;}
  await guide(page,9);await close(page);
  await openNode(page,'R1');await prompt(page,'Username:');
  await command(page,'operator');await prompt(page,'Password:');
  assert.equal(await page.locator('#terminal-input').getAttribute('type'),'password');
  assert.match(await output(page,'WrongLab123'),/Authenticationfailed/);await prompt(page,'Username:');
  await command(page,'operator');await command(page,'OperatorLab123');await prompt(page,'R1>');
  assert.match(await output(page,'show privilege'),/levelis1/);
  await command(page,'enable');await prompt(page,'Password:');await command(page,'EnableLab123');await prompt(page,'R1#');
  assert.match(await output(page,'show privilege'),/levelis15/);
  const text=await page.locator('#terminal-output').textContent();
  for(const password of ['OperatorLab123','EnableLab123','WrongLab123'])assert.ok(!text.includes(password));
  await page.locator('[data-action=close-dock]').click();
}
async function scenario(theme,width){
  const profile=await mkdtemp(`${folder}/profile-${theme}-${width}-`);
  const context=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600});
  const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(r.url());});
  await page.route(/^https?:\/\//,r=>r.abort());
  await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);window.qaStartupWorkspace=localStorage.getItem('network-sim.workspace.v1');window.qaToasts=[];addEventListener('DOMContentLoaded',()=>{const e=document.querySelector('#toast');if(e)new MutationObserver(()=>window.qaToasts.push(e.textContent)).observe(e,{childList:true,subtree:true,characterData:true});});},theme);
  try{
    const artifact=`${folder}/index-${theme}-${width}.html`;await writeFile(artifact,html);await page.goto(pathToFileURL(process.cwd()+'/'+artifact).href);
    await detail(page);assert.ok(page.url().endsWith(hash));assert.match(await page.locator('.catalog-meta').first().textContent(),/CCNA · Services & Security/);
    assert.equal(await page.locator('.catalog-tasks').first().locator('li').count(),9);assert.equal(await page.locator('.catalog-table tbody tr').count(),2);
    assert.equal(await page.locator('.catalog-reference').getAttribute('open'),null);await page.locator('.catalog-reference summary').click();
    for(const phrase of ['username admin privilege 15 secret','username operator privilege 1 secret','login local','transport input ssh','enable secret','ssh -l operator','Fresh console session'])assert.ok((await page.locator('.catalog-reference').textContent()).includes(phrase));
    await page.locator('[data-catalog-mode=practice]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===2);
    await guide(page,0);await close(page);await openNode(page,'PC1');assert.match(await output(page,'ssh admin@192.0.2.1'),/refused/);await prompt(page,'C:\\>');await page.locator('[data-action=close-dock]').click();
    await openNode(page,'R1');for(const line of COMMANDS.R1)await command(page,line);await prompt(page,'R1#');
    for(const line of ['terminal length 0','show running-config | include ^username','show ip ssh','show running-config | section line']){
      const text=await output(page,line);assert.doesNotMatch(text,/Invalidinput|Incompletecommand/);
      if(line==='show ip ssh')assert.match(text,/version2\.0/);
    }
    await page.locator('[data-action=close-dock]').click();await guide(page,6);await ping(page);await progress(page,7);await close(page);
    await login(page,'operator',true);await guide(page,8);assert.equal(await page.locator('[data-objective=operator-ssh]').getAttribute('data-complete'),'true');await close(page);
    await login(page,'admin');await guide(page,9);assert.equal(await page.locator('[data-guide-completion]').isVisible(),true);await close(page);
    await changeTransport(page,'none');await guide(page,8);assert.equal(await page.locator('[data-objective=vty-local]').getAttribute('data-complete'),'false');await close(page);
    await openNode(page,'PC1');assert.match(await output(page,'ssh admin@192.0.2.1'),/refused/);await prompt(page,'C:\\>');await page.locator('[data-action=close-dock]').click();
    await changeTransport(page,'ssh');await guide(page,9);await close(page);await reloadAndConsole(page);
    await guide(page,9);assert.ok(await page.locator('.dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;}));
    await page.locator('#toast').evaluate(e=>e.style.display='none');await page.screenshot({path:`${folder}/guide-${theme}-${width}.png`,animations:'disabled'});await close(page);
    await page.locator('[data-action=fit]').click();await page.screenshot({path:`${folder}/topology-${theme}-${width}.png`,animations:'disabled'});
    await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#cancel-lab-import').click();assert.equal(await page.locator('#lab-name').textContent(),title);
    await detail(page);await page.locator('[data-catalog-mode=completed]').click();await page.locator('#lab-import-save').click();await page.waitForFunction(()=>document.querySelector('#lab-name')?.textContent.includes('Completed'));
    await guide(page,6);await ping(page);await close(page);await login(page,'operator');await login(page,'admin');await guide(page,9);
    checks.push(`${theme} ${width}px: Services & Security labs and accurate accessible count, nine-task guide and two-row plan, zero-credit practice, published IOS configuration and six live goals, real ping and two locally authenticated SSH users with distinct initial privileges, wrong-password rejection and hidden inputs, privilege-1 command denial and independent enable-secret elevation, actual show users/ssh, blocked transport and recovery with live grading, saved achievements and fresh console authentication after reload, completed reference with no fabricated logins, cancel/save-copy protection, responsive layout and unchanged CLI colors`);
    process.stdout.write(`PASS ${theme} ${width}\n`);
  }catch(error){
    await writeFile(`${folder}/failure-${theme}-${width}.json`,JSON.stringify(await page.evaluate(()=>({name:document.querySelector('#lab-name')?.textContent,prompt:document.querySelector('#terminal-prompt')?.textContent,terminal:document.querySelector('#terminal-output')?.textContent,toasts:window.qaToasts})),null,2));
    await page.screenshot({path:`${folder}/failure-${theme}-${width}.png`});throw error;
  }finally{await context.close();await rm(profile,{recursive:true,force:true});}
}
for(const theme of ['light','dark'])for(const width of [1440,390,320])await scenario(theme,width);
const browser=await chromium.launch({executablePath:chrome,headless:true});
try{
  for(const theme of ['light','dark']){
    const page=await browser.newPage({viewport:{width:390,height:844}}),base='https://training.example/campus/NetworkSim/index.html?class=ccna&room=2';page.on('pageerror',e=>errors.push(e.message));
    await page.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'text/html',body:html}));
    await page.addInitScript(t=>{localStorage.setItem('network-sim.theme.v1',t);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLabURL=text;}}});},theme);
    await page.goto(base+hash);await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(await page.locator('#world .device').count(),0);
    await page.locator('[data-catalog-copy]').click();await page.waitForFunction(expected=>window.copiedLabURL===expected,base+hash);await page.locator('[data-catalog-back]').click();
    const section=page.locator('[data-catalog-section="Services & Security"]');assert.equal(await section.getAttribute('aria-pressed'),'true');assert.equal(await section.locator('.catalog-count').textContent(),'13');assert.equal(await page.locator(`[data-catalog-lab="${id}"]`).getAttribute('href'),base+hash);
    checks.push(`${theme}: permalink preserves current host/path/query, previews without replacing workspace, and returns to Services & Security with thirteen labs`);process.stdout.write(`PASS ${theme} permalink\n`);await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  await writeFile(folder+'/validation.json',JSON.stringify({artifactSha256:createHash('sha256').update(html).digest('hex'),checks,errors,externalRequests},null,2)+'\n');
}finally{await browser.close();}
