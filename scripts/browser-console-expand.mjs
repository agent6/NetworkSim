import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/console-expand';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.NETWORKSIM_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),results=[];
try{
 for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['phone',390,844,true],['small-phone',320,568,true],['phone-landscape',844,390,true],['tablet',768,1024,true]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:\/\//,r=>r.abort());
  const input=page.locator('#terminal-input'),output=page.locator('#terminal-output'),expand=page.locator('[data-action=maximize-dock]'),settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const command=async text=>{await input.fill(text);await input.press('Enter');await settle();};
  const full=async()=>{
   await settle();const bounds=await page.locator('#dock').boundingBox(),view=await page.evaluate(()=>({x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height}));
   for(const key of ['x','y','width','height'])assert.ok(Math.abs(bounds[key]-view[key])<1,`${name}: ${key}: ${bounds[key]} vs ${view[key]}`);
   for(const selector of ['.sidebar','.app-header','.editor-toolbar','#diagram-workspace','#dock-resize'])assert.equal(await page.locator(selector).isVisible(),false,`${name}: ${selector}`);
   assert.equal(await expand.getAttribute('aria-expanded'),'true');assert.equal(await expand.isVisible(),true);assert.equal(await page.locator('[data-action=close-dock]').isVisible(),true);
  };
  try{
   await page.goto(pathToFileURL(process.cwd()+'/index.html').href);await page.locator('#import-input').setInputFiles({name:'expand.netsim.yaml',mimeType:'application/yaml',buffer:await readFile('examples/nat-pat-ios-nxos.netsim.yaml')});
   await page.locator('.workspace-panel-button[data-action=tab-console]').click();await command('enable');await command('terminal length 0');await command('show ip interface brief');await input.fill('show ver');await settle();
   const oldHeight=(await page.locator('#dock').boundingBox()).height,oldTransform=await page.locator('#world').getAttribute('transform'),oldOutput=await output.textContent();
   await input.evaluate(el=>el.setSelectionRange(3,7));await expand.click();await full();assert.equal(await input.inputValue(),'show ver');assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,7]);assert.ok((await output.textContent()).includes(oldOutput));
   await page.getByRole('tab',{name:'NX',exact:true}).click();await full();await command('admin');await command('NetSimLab42!');assert.equal(await page.locator('#terminal-prompt').textContent(),'NX#');await command('show ip nat translations');
   await page.getByRole('tab',{name:'IOS',exact:true}).click();await full();assert.equal(await input.inputValue(),'show ver');
   if(mobile){
    // A real visual-viewport scale change exercises the same resize event used by mobile keyboards.
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});await full();await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await full();await cdp.detach();
   }
   await page.screenshot({path:`${folder}/${name}.png`});await expand.click();await settle();assert.equal(await page.locator('.sidebar').isVisible(),true);assert.equal(await page.locator('.app-header').isVisible(),true);assert.equal(await page.locator('#diagram-workspace').isVisible(),true);assert.equal(await page.locator('#dock-resize').isVisible(),true);assert.ok(Math.abs((await page.locator('#dock').boundingBox()).height-oldHeight)<1);assert.equal(await page.locator('#world').getAttribute('transform'),oldTransform);assert.equal(await input.inputValue(),'show ver');
   await expand.click();await full();await page.setViewportSize({width:height,height:width});await full();await page.locator('[data-action=close-dock]').click();await settle();assert.equal(await page.locator('#dock').isVisible(),false);assert.equal(await page.locator('.sidebar').isVisible(),true);assert.equal(await page.locator('#diagram-workspace').isVisible(),true);
   await page.locator('.workspace-panel-button[data-action=tab-console]').click();await settle();assert.equal(await expand.getAttribute('aria-expanded'),'false');assert.equal(await input.inputValue(),'show ver');assert.deepEqual(errors,[]);results.push({name,width,height,fullWindow:true,restoresLayoutAndDraft:true,visualViewport:mobile,errors});console.log('PASS',name);
  }catch(error){await page.screenshot({path:`${folder}/${name}-failure.png`});throw error;}finally{await page.close();}
 }
 await writeFile(folder+'/results.json',JSON.stringify({checks:results,browser:await browser.version()},null,2)+'\n');
}finally{await browser.close();}
