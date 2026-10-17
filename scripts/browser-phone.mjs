import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {factoryDeviceConfig,emptyRuntime} from '../src/model.ts';
import {stringify} from 'yaml';

const require=createRequire(import.meta.url),{chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/phone-browser';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100}}),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const check=name=>{checks.push(name);console.log('PASS',name);};
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');
const close=()=>page.locator('[data-action=close-dialog]').first().click();
const command=async line=>{await page.locator('#terminal-input').fill(line);await page.locator('#terminal-input').press('Enter');await settle();};
const phoneAddress=()=>page.waitForFunction(()=>/^10\.20\.20\./.test(document.querySelector('[data-phone-address]')?.textContent??''),null,{timeout:20000});
function fixture(){
 const devices=[['poeswitch','PSW1',460,170],['phone','PHONE1',460,390],['pc','PC1',460,610],['server','SRV1',200,170],['server','SRV2',720,170]].map(([kind,name,x,y],i)=>({id:`device-${i+1}`,kind,x,y,powered:kind!=='phone',config:factoryDeviceConfig(kind,name),runtime:emptyRuntime()}));
 const[sw,phone,pc,data,voice]=devices;
 Object.assign(sw.config.vlans,{10:{id:10,name:'DATA',active:true},20:{id:20,name:'VOICE',active:true}});
 for(const[port,vlan]of[['GigabitEthernet0/1',10],['GigabitEthernet0/2',10],['GigabitEthernet0/3',20]]){sw.config.interfaces[port].vlan=vlan;sw.config.interfaces[port].features.portfast=true;}
 sw.config.interfaces['GigabitEthernet0/1'].features.voiceVlan=20;
 for(const[d,network]of[[data,'10.10.10'],[voice,'10.20.20']]){Object.assign(d.config.interfaces.GigabitEthernet0,{ip:network+'.1',mask:'255.255.255.0'});d.config.services.dhcp={enabled:true,pools:[{name:network,network:network+'.0',prefix:24,defaultRouter:network+'.1',dnsServers:[network+'.1']}],excluded:[{start:network+'.1',end:network+'.9'}]};}
 const links=[[sw,'GigabitEthernet0/1',phone,'Network'],[phone,'PC',pc,'GigabitEthernet0'],[sw,'GigabitEthernet0/2',data,'GigabitEthernet0'],[sw,'GigabitEthernet0/3',voice,'GigabitEthernet0']].map(([a,ap,b,bp],i)=>({id:`link-${i+6}`,a:{deviceId:a.id,port:ap},b:{deviceId:b.id,port:bp},enabled:true,delay:.1,loss:0}));
 return{format:'netsim-lab',version:1,seed:61004,lab:{id:'lab-phone',name:'VoIP phone · voice and PC data VLANs',devices,links,notes:[]}};
}
try{
 await page.goto(pathToFileURL(process.cwd()+'/index.html').href);
 const kinds=['router','switch','l3switch','poeswitch','pc','server','wlc','ap','laptop','phone'];
 assert.equal(await page.locator('.palette-card').count(),10);
 assert.equal(new Set(await page.locator('.palette-card .node-artwork').evaluateAll(icons=>icons.map(icon=>icon.getAttribute('viewBox')))).size,10);
 for(const kind of kinds){await page.locator(`[data-kind=${kind}]`).click();if(await page.locator('.dialog').count())await close();}
 await page.locator('[data-action=fit]').click();await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===10);await settle();assert.equal(await page.locator('#world .device').count(),10);
 await page.locator('.palette-grid').screenshot({path:folder+'/ten-icons-light.png'});await page.screenshot({path:folder+'/ten-nodes-light.png'});
 check('Ten distinct ImageGen icons render in the palette and workspace');
 await page.locator('[data-action=toggle-theme]').click();await settle();await page.locator('.palette-grid').screenshot({path:folder+'/ten-icons-dark.png'});await page.screenshot({path:folder+'/ten-nodes-dark.png'});
 check('All ten symbols remain consistent and visible in dark mode');
 await node('PHONE1').dblclick();assert.match(await page.locator('[data-phone-status]').textContent(),/Waiting for PoE/);assert.equal(await page.locator('[data-phone-renew]').isDisabled(),true);await close();
 check('A disconnected phone has no simulated local power and cannot request DHCP');
 const yaml=stringify(fixture());await writeFile(folder+'/fixture.netsim.yaml',yaml);await page.locator('#import-input').setInputFiles({name:'phone.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(yaml)});await page.waitForFunction(()=>document.querySelectorAll('#world .device').length===5);await node('PHONE1').waitFor();await node('PHONE1').dblclick();await phoneAddress();
 assert.match(await page.locator('[data-phone-voice-vlan]').textContent(),/VLAN 20/);assert.match(await page.locator('[data-phone-policy]').textContent(),/CDP/);assert.match(await page.locator('[data-phone-network]').textContent(),/Up.*PSW1/);assert.match(await page.locator('[data-phone-pc]').textContent(),/Up.*PC1/);
 await page.screenshot({path:folder+'/phone-status-dark.png'});check('The live phone panel shows PoE, learned voice policy, voice DHCP and both port peers');
 await page.locator('[data-phone-renew]').click();await phoneAddress();check('Renew DHCP runs through the actual phone voice interface');
 await page.locator('[data-phone-ip]').click();assert.equal(await page.locator('[name=mode4]').inputValue(),'dhcp');assert.match(await page.locator('[name=ip]').inputValue(),/^10\.20\.20\./);assert.equal(await page.locator('[name=ip]').getAttribute('readonly'),'');await close();
 check('Phone IP settings use the Network uplink and preserve DHCP addressing');
 await node('PC1').dblclick();await page.locator('[data-desktop=ip]').click();await page.waitForFunction(()=>/^10\.10\.10\./.test(document.querySelector('[name=ip]')?.value??''));assert.match(await page.locator('[name=ip]').inputValue(),/^10\.10\.10\./);await close();
 await node('PC1').dblclick();await page.locator('[data-desktop=cli]').click();await command('ping -n 1 10.10.10.1');assert.match(await page.locator('#terminal-output').textContent(),/Received = 1/);assert.equal(await page.locator('[data-session]').filter({hasText:'PHONE1'}).count(),0);await page.locator('[data-action=close-dock]').click();
 check('The PC obtains a data-subnet lease and passes real traffic through the phone');
 await page.locator('[data-action=fit]').click();await settle();await node('PHONE1').click();await page.waitForFunction(()=>[...document.querySelectorAll('#world .device.selected .device-label')].some(el=>el.textContent==='PHONE1'));if(!await page.locator('#inspector').isVisible())await page.locator('[data-action=inspector]').first().click();await page.waitForFunction(()=>!document.querySelector('#inspector')?.hidden&&document.querySelector('#inspector')?.textContent.includes('PHONE1'));assert.equal(await page.locator('#inspector [data-action=power-device]').count(),0);
 await node('PHONE1').click({button:'right'});assert.equal(await page.locator('.mini-menu [data-action=power-device]').count(),0);await page.keyboard.press('Escape');
 check('Inspector and context menu provide no manual phone power toggle');
 await node('PSW1').dblclick();await page.locator('[data-poe-console]').click();await command('enable');await command('configure terminal');await command('interface g0/1');await command('power inline never');await command('end');await page.locator('[data-action=close-dock]').click();
 await node('PHONE1').dblclick();assert.match(await page.locator('[data-phone-status]').textContent(),/Waiting for PoE/);assert.match(await page.locator('[data-phone-pc]').textContent(),/Down/);await close();
 check('Switch inline-power shutdown takes the phone and PC passthrough carrier down');
 await node('PSW1').dblclick();await page.locator('[data-poe-console]').click();await command('configure terminal');await command('interface g0/1');await command('power inline auto');await command('end');await page.locator('[data-action=close-dock]').click();await node('PHONE1').dblclick();await phoneAddress();await close();
 check('Restoring switch PoE reboots the phone and reacquires its voice configuration');
 await page.locator('[data-action=toggle-theme]').click();await node('PHONE1').dblclick();await phoneAddress();await page.screenshot({path:folder+'/phone-status-light.png'});await close();await page.reload();await node('PHONE1').waitFor();await node('PHONE1').dblclick();await phoneAddress();assert.match(await page.locator('[data-phone-pc]').textContent(),/Up.*PC1/);
 check('Both themes and browser reload retain the real two-port phone topology');
 assert.deepEqual(errors,[]);check('No browser page errors');
 const result=JSON.stringify({generatedAt:new Date().toISOString(),browser:await browser.version(),artifact:{file:'index.html',sha256:createHash('sha256').update(await readFile('index.html')).digest('hex')},checks,errors},null,2)+'\n';await writeFile(folder+'/results.json',result);await writeFile('docs/audits/phone-browser-validation.json',result);
}catch(error){await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);console.error(await page.evaluate(()=>({selected:[...document.querySelectorAll('#world .device.selected .device-label')].map(el=>el.textContent),inspector:document.querySelector('#inspector')?.textContent,hidden:document.querySelector('#inspector')?.hidden})));process.exitCode=1;}
finally{await browser.close();}
