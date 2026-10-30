import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/console-expand';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),results=[],requests=[];
try{
 for(const theme of ['light','dark'])for(const [name,width,height,touch] of [['desktop',1440,1000,false],['narrow-window',650,844,false],['phone',390,844,true],['small-phone',320,568,true],['phone-landscape',844,390,true],['tablet',768,1024,true],['tablet-landscape',1180,820,true]]){
  const mobile=touch||width<=650,page=await browser.newPage({viewport:{width,height},isMobile:touch,hasTouch:touch}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.route(/^https?:\/\//,r=>r.abort());await page.addInitScript(t=>localStorage.setItem('network-sim.theme.v1',t),theme);
  const input=page.locator('#terminal-input'),output=page.locator('#terminal-output'),expand=page.locator('[data-action=maximize-dock]'),close=page.locator('[data-action=close-dock]'),settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const command=async text=>{await input.fill(text);await input.press('Enter');await settle();};
  const full=async(expectMobile=mobile)=>{
   await settle();const bounds=await page.locator('#dock').boundingBox(),view=await page.evaluate(()=>({x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height}));
   for(const key of ['x','y','width','height'])assert.ok(Math.abs(bounds[key]-view[key])<1,`${theme} ${name}: ${key}: ${bounds[key]} vs ${view[key]}`);
   for(const selector of ['.sidebar','.app-header','.editor-toolbar','#diagram-workspace','#dock-resize'])assert.equal(await page.locator(selector).isVisible(),false,`${name}: ${selector}`);
   assert.equal(await expand.getAttribute('aria-expanded'),'true');assert.equal(await expand.isVisible(),!expectMobile);assert.equal(await close.isVisible(),true);
  };
  const closed=async()=>{
   await settle();assert.equal(await page.locator('#dock').isVisible(),false);assert.equal(await page.locator('#dock-resize').isVisible(),false);for(const selector of ['.sidebar','.app-header','#diagram-workspace'])assert.equal(await page.locator(selector).isVisible(),true);assert.equal(await page.locator('#app').evaluate(e=>e.classList.contains('console-expanded')),false);
  };
  try{
   await page.goto(pathToFileURL(process.cwd()+'/index.html').href);await closed();
   // The empty console also obeys the two-state mobile layout.
   await page.locator('.workspace-panel-button[data-action=tab-console]').click();if(mobile)await full();await close.click();await closed();
   await page.locator('#import-input').setInputFiles({name:'expand.netsim.yaml',mimeType:'application/yaml',buffer:await readFile('examples/nat-pat-ios-nxos.netsim.yaml')});await page.locator('[data-action=fit]').click();await settle();const originalTransform=await page.locator('#world').getAttribute('transform');
   await page.locator('.workspace-panel-button[data-action=tab-console]').click();if(mobile)await full();else{
    assert.equal(await expand.getAttribute('aria-expanded'),'false');const separator=page.locator('#dock-resize');assert.equal(await separator.isVisible(),true);const oldHeight=(await page.locator('#dock').boundingBox()).height;await separator.press('ArrowUp');assert.equal((await page.locator('#dock').boundingBox()).height,oldHeight+20);
   }
   await command('enable');await command('terminal length 0');await command('show ip interface brief');await input.fill('show ver');await settle();const dockHeight=(await page.locator('#dock').boundingBox()).height,oldTransform=await page.locator('#world').getAttribute('transform'),oldOutput=await output.textContent();await input.evaluate(el=>el.setSelectionRange(3,7));
   if(mobile)await expand.evaluate(e=>e.click());else await expand.click();await full();assert.equal(await input.inputValue(),'show ver');assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,7]);assert.ok((await output.textContent()).includes(oldOutput));
   await page.getByRole('tab',{name:'NX',exact:true}).click();await full();await command('admin');await command('NetSimLab42!');assert.equal(await page.locator('#terminal-prompt').textContent(),'NX#');await command('show ip nat translations');await page.getByRole('tab',{name:'IOS',exact:true}).click();await full();assert.equal(await input.inputValue(),'show ver');
   if(touch){
    // Real visual-viewport resize events exercise the keyboard/pinch sizing path.
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});await full();await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await full();await cdp.detach();await page.setViewportSize({width,height:Math.max(240,Math.round(height*.6))});await full();await page.setViewportSize({width:height,height:width});await full();await page.setViewportSize({width,height});await full();
   }
   await page.screenshot({path:`${folder}/${name}-${theme}.png`,animations:'disabled'});
   if(!mobile){
    await expand.click();await settle();assert.equal(await page.locator('#dock-resize').isVisible(),true);assert.ok(Math.abs((await page.locator('#dock').boundingBox()).height-dockHeight)<1);assert.equal(await page.locator('#world').getAttribute('transform'),oldTransform);
    await page.setViewportSize({width:650,height});await full(true);assert.equal(await input.inputValue(),'show ver');await page.setViewportSize({width:651,height});await settle();assert.equal(await expand.getAttribute('aria-expanded'),'false');assert.equal(await expand.isVisible(),true);assert.ok(Math.abs((await page.locator('#dock').boundingBox()).height-dockHeight)<1);await page.setViewportSize({width,height});await expand.click();await full();await page.setViewportSize({width:650,height});await full(true);await page.setViewportSize({width,height});await full(false);
   }
   await close.click();await closed();if(mobile)assert.equal(await page.locator('#world').getAttribute('transform'),originalTransform,'Mobile open/close must not shift the topology');await page.locator('.workspace-panel-button[data-action=tab-console]').click();if(mobile)await full();else assert.equal(await expand.getAttribute('aria-expanded'),'false');assert.equal(await input.inputValue(),'show ver');await close.click();await closed();
   // Opening the device itself uses the same full-screen mobile behavior.
   await page.locator('#world [data-device] .device-body').first().dblclick();if(mobile)await full();assert.equal(await input.inputValue(),'show ver');await close.click();await closed();assert.deepEqual(errors,[]);results.push({theme,name,width,height,mobileTwoStates:mobile,desktopResizeAndRestore:!mobile,restoresLayoutAndDraft:true,visualViewport:touch,errors});console.log('PASS',theme,name);
  }catch(error){await page.screenshot({path:`${folder}/${name}-${theme}-failure.png`});throw error;}finally{await page.close();}
 }
 assert.deepEqual(requests,[]);await writeFile(folder+'/results.json',JSON.stringify({artifactSha256:createHash('sha256').update(await readFile('index.html')).digest('hex'),checks:results,browser:await browser.version(),externalRequests:requests},null,2)+'\n');
}finally{await browser.close();}
