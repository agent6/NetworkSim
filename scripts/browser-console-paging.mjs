import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {terminalRows} from '../src/ios-terminal.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/console-paging';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const input=page.locator('#terminal-input'),output=page.locator('#terminal-output'),prompt=page.locator('#terminal-prompt');
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const command=async line=>{await input.fill(line);await input.press('Enter');await settle();};
const more=async()=>await prompt.textContent()==='--More--';
const check=name=>{checks.push(name);console.log('PASS',name);};
async function geometry(start){
 return page.evaluate(start=>{
  const panel=document.querySelector('#console-panel'),output=document.querySelector('#terminal-output'),prompt=document.querySelector('#terminal-form');
  const style=getComputedStyle(panel),box=panel.getBoundingClientRect(),probe=document.createElement('span');probe.textContent='0'.repeat(100);probe.style.cssText='position:absolute;visibility:hidden;white-space:pre';panel.append(probe);const cell=probe.getBoundingClientRect().width/100;probe.remove();
  const text=output.firstChild,offset=start+(text?.textContent?.slice(start).match(/^\n*/)?.[0].length??0);let first;
  if(text&&offset<text.length){const range=document.createRange();range.setStart(text,offset);range.setEnd(text,offset+1);first=range.getBoundingClientRect().top;}
  return {first,top:box.top+parseFloat(style.paddingTop),bottom:box.bottom-parseFloat(style.paddingBottom),promptBottom:prompt.getBoundingClientRect().bottom,columns:Math.floor((panel.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))/cell),rows:Math.floor((panel.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))/parseFloat(style.lineHeight))};
 },start);
}
async function fits(start){const m=await geometry(start);assert.ok(m.first===undefined||m.first>=m.top-1,JSON.stringify(m));assert.ok(m.promptBottom<=m.bottom+1,JSON.stringify(m));return m;}
async function begin(line){
 const before=(await output.textContent()).length,label=await prompt.textContent();await command(line);
 const start=before+label.length+line.length+1;
 return {start,text:(await output.textContent()).slice(start)};
}
async function drain(start,first){
 const parts=[first];let count=0;
 while(await more()){
  assert.ok(count++<500,'Pager must finish');const offset=(await output.textContent()).length;
  await input.press('Space');await settle();parts.push((await output.textContent()).slice(offset));await fits(offset);
 }
 return parts.join('').replace(/\n$/,'').split('\n');
}
async function resizeConsole(height){
 const handle=await page.locator('#dock-resize').boundingBox(),dock=await page.locator('#dock').boundingBox();
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2+dock.height-height,{steps:8});await page.mouse.up();await settle();
}
try {
 await page.goto(process.env.NETWORKSIM_PREVIEW_URL||pathToFileURL(resolve('index.html')).href);
 await page.locator('[data-kind=router]').click();await page.locator('#world .device.kind-router .device-body').dblclick();await command('enable');await command('terminal length 0');
 const baseline=await begin('show running-config');assert.equal(await more(),false);const expected=baseline.text.replace(/\n$/,'').split('\n');assert.ok(expected.length>15);
 check('terminal length 0 retains complete unpaged output');
 await command('terminal length 200');const normal=await begin('show running-config');assert.ok(await more());await fits(normal.start);assert.deepEqual(await drain(normal.start,normal.text),expected);
 check('Every page of a long command fits the normal console, without missing or repeated output');
 const enter=await begin('show running-config'),before=(await output.textContent()).length;await input.press('Enter');await settle();const added=(await output.textContent()).slice(before);assert.equal(added.split('\n').length-1,1);await fits(before);await input.press('q');await settle();assert.equal(await more(),false);
 check('Enter advances one screen row and Q restores the command prompt');
 const shrinking=await begin('show running-config');await resizeConsole(170);const small=await fits(shrinking.start);assert.ok(small.rows<8);const visible=(await output.textContent()).slice(shrinking.start);assert.deepEqual(await drain(shrinking.start,visible),expected);
 check('Shrinking an active page requeues overflow and preserves every unread line');
 await page.locator('[data-action=maximize-dock]').click();await settle();const expanded=await begin('show running-config');const large=await fits(expanded.start);assert.ok(large.rows>small.rows);assert.deepEqual(await drain(expanded.start,expanded.text),expected);
 check('Expanded consoles use their extra rows for subsequent pages');
 await page.locator('[data-action=maximize-dock]').click();await settle();await resizeConsole(260);await page.setViewportSize({width:760,height:800});await settle();
 const narrow=await begin('show running-config'),narrowMetrics=await fits(narrow.start);assert.ok(narrowMetrics.columns<80);assert.deepEqual(await drain(narrow.start,narrow.text),terminalRows(expected,narrowMetrics.columns));
 check('Narrow consoles count wrapped physical rows and retain all command output');
 await command('terminal length 3');const limited=await begin('show running-config');assert.equal(limited.text.split('\n').length-1,3);await fits(limited.start);await input.press('Escape');await settle();
 check('Explicit shorter terminal length still limits the page, and Escape exits the pager');
 await command('terminal length 200');await input.fill('show ip ');await input.press('?');await settle();assert.ok(await more());await input.press('q');await settle();assert.equal(await input.inputValue(),'show ip ');assert.equal(await input.evaluate(element=>element.selectionStart),8);
 check('Paged context help restores the command draft and caret after quitting');
 assert.deepEqual(errors,[]);check('No browser errors');await page.screenshot({path:folder+'/console.png'});
 const artifact=await readFile('index.html');await writeFile(folder+'/results.json',JSON.stringify({generatedAt:new Date().toISOString(),artifact:{path:'index.html',sha256:createHash('sha256').update(artifact).digest('hex')},checks,errors},null,2)+'\n');
} catch(error){await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;}
finally {await browser.close();}
