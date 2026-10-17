import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Simulator} from '../src/engine.ts';
import {serializeLabFile} from '../src/persistence.ts';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NETWORKSIM_PLAYWRIGHT_PATH||'/Users/erikpope/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder='.cache/link-layout-browser';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const check=name=>{checks.push(name);console.log('PASS',name);};
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const node=name=>page.locator('#world .device').filter({has:page.locator('text.device-label',{hasText:new RegExp('^'+name+'$')})}).locator('.device-body');

function campus(){
 const sim=new Simulator(4401);
 const devices=[['DSW1','l3switch',390,130],['DSW2','l3switch',760,130],['PSW1','poeswitch',310,280],['SW1','switch',460,290],['SW2','switch',700,290],['SRV1','server',900,330],['WLC1','wlc',1060,130],['AP1','ap',230,460],['AP2','ap',390,460],['PC1','pc',600,400]];
 for(const[name,kind,x,y]of devices)sim.addDevice(kind,x,y).config.hostname=name;
 const connect=(a,b,ap,bp)=>sim.connect({deviceId:sim.getDevice(a).id,port:'GigabitEthernet'+ap},{deviceId:sim.getDevice(b).id,port:'GigabitEthernet'+bp});
 connect('DSW1','DSW2','0/1','0/1');connect('DSW1','DSW2','0/2','0/2');connect('DSW1','DSW2','0/6','0/6');
 connect('DSW1','PSW1','0/3','0/2');connect('DSW1','SW1','0/4','0/1');connect('DSW1','SW2','0/5','0/1');
 connect('DSW2','SW1','0/5','0/2');connect('DSW2','SW2','0/3','0/2');connect('DSW2','SRV1','0/4','0');connect('DSW2','WLC1','0/7','1');
 connect('PSW1','AP1','0/1','0');connect('PSW1','AP2','0/3','0');connect('SW2','PC1','0/4','0');
 sim.lab.name='Shared switch connection layout';return sim;
}
function dense(){
 const sim=new Simulator(4402),hub=sim.addDevice('switch',300,400);hub.config.hostname='HUB';
 for(let i=0;i<24;i++){
  const pc=sim.addDevice('pc',700+(i%3)*160,100+Math.floor(i/3)*100);
  sim.connect({deviceId:hub.id,port:`GigabitEthernet0/${i+1}`},{deviceId:pc.id,port:'GigabitEthernet0'});
 }
 sim.lab.name='24-neighbor socket spacing';return sim;
}
async function load(sim){
 await page.locator('#import-input').setInputFiles({name:'layout.netsim.yaml',mimeType:'application/yaml',buffer:Buffer.from(serializeLabFile(sim.serialize()))});
 await page.waitForFunction(count=>document.querySelectorAll('#world .wire-socket').length===count,sim.lab.links.length*2);
 await page.locator('[data-action=fit]').click();await settle();
}
async function verify(expected){
 const geometry=await page.evaluate(()=>{
  const sockets=[...document.querySelectorAll('#world .wire-socket')].map(el=>{
   const point=el.transform.baseVal.consolidate().matrix,box=el.querySelector('circle').getBoundingClientRect();
   return{device:el.getAttribute('aria-label').split(' · ')[0],x:point.e,y:point.f,box:{x:box.x,y:box.y,width:box.width,height:box.height}};
  });
  const labels=[...document.querySelectorAll('#world .port-label rect')].map(el=>{const b=el.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};});
  return{sockets,labels};
 });
 assert.equal(geometry.sockets.length,expected*2);assert.equal(geometry.labels.length,expected*2);
 const overlaps=(a,b)=>a.x+a.width>b.x+.1&&b.x+b.width>a.x+.1&&a.y+a.height>b.y+.1&&b.y+b.height>a.y+.1;
 for(let i=0;i<geometry.sockets.length;i++){
  const a=geometry.sockets[i];
  for(const b of geometry.sockets.slice(i+1))if(a.device===b.device){
   assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=12,`Sockets too close on ${a.device}`);
   assert.ok(!overlaps(a.box,b.box),`Rendered socket collision on ${a.device}`);
  }
  for(const label of geometry.labels)assert.ok(!overlaps(a.box,label),'A rendered badge covers a connection point');
 }
 for(let i=0;i<geometry.labels.length;i++)for(const b of geometry.labels.slice(i+1))assert.ok(!overlaps(geometry.labels[i],b),'Rendered interface badges overlap');
}
async function move(name,dx,dy){
 const box=await node(name).boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();await settle();
}
try{
 await page.goto(pathToFileURL(process.cwd()+'/index.html').href);const sim=campus();await load(sim);await verify(sim.lab.links.length);
 check('Campus fan-out and parallel links have separate sockets and badges in the offline app');
 await page.screenshot({path:folder+'/campus-light.png'});
 for(const[dx,dy]of[[-160,120],[150,-190],[70,90]]){await move('DSW2',dx,dy);await verify(sim.lab.links.length);}
 check('Dragging a shared switch recomputes collision-free endpoints and labels');
 for(const direction of['zoom-out','zoom-out','zoom-out','zoom-in','zoom-in','zoom-in','zoom-in','zoom-in']){await page.locator(`[data-action=${direction}]`).click();await settle();await verify(sim.lab.links.length);}
 check('Connection points and labels remain separate across zoom levels');
 await page.locator('[data-action=fit]').click();await page.locator('[data-action=toggle-theme]').click();await settle();await verify(sim.lab.links.length);
 await page.screenshot({path:folder+'/campus-dark.png'});check('Dark theme retains clear, separated connection points');
 await page.reload();await node('DSW1').waitFor();await settle();await verify(sim.lab.links.length);check('Saved workspace reload preserves the layout');
 const crowded=dense();await load(crowded);await verify(crowded.lab.links.length);await page.screenshot({path:folder+'/dense-dark.png'});
 check('A switch with 24 different neighbors has no stacked connection points or badges');
 assert.deepEqual(errors,[]);check('No browser page errors');
 await writeFile(folder+'/results.json',JSON.stringify({generatedAt:new Date().toISOString(),browser:await browser.version(),artifact:{file:'index.html',sha256:createHash('sha256').update(await readFile('index.html')).digest('hex')},checks,errors},null,2)+'\n');
}catch(error){await page.screenshot({path:folder+'/failure.png'});console.error(error);console.error(errors);process.exitCode=1;}
finally{await browser.close();}
