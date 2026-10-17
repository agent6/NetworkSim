import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutLinks,orderedPairLinks,shortInterface,type LayoutBox,type LinkLayout,type Point} from '../src/link-layout.ts';
import type {Link} from '../src/model.ts';
const links=(count:number):Link[]=>Array.from({length:count},(_,i)=>({id:'link-'+i,a:{deviceId:'a',port:'GigabitEthernet0/'+(i+1)},b:{deviceId:'b',port:'GigabitEthernet0/'+(i+1)},enabled:true,delay:0.1,loss:0}));
const collide=(a:LayoutBox,b:LayoutBox)=>Math.abs(a.x-b.x)<(a.width+b.width)/2&&Math.abs(a.y-b.y)<(a.height+b.height)/2;
function separatedSockets(layouts:LinkLayout[]){
 const sockets=new Map<string,Point[]>();
 for(const layout of layouts)for(const[index,point]of[layout.start,layout.end].entries()){
  const id=layout.labels[index].endpoint.deviceId,others=sockets.get(id)??[];
  for(const other of others)assert.ok(Math.hypot(point.x-other.x,point.y-other.y)>=12,`Sockets overlap on ${id}: ${JSON.stringify([point,other])}`);
  others.push(point);sockets.set(id,others);
 }
}

test('parallel links have distinct sockets, paths and nonoverlapping interface badges in multiple orientations',()=>{
 for(const count of [1,2,4,8,24])for(const target of [{x:360,y:0},{x:0,y:360},{x:0,y:-360},{x:300,y:240},{x:120,y:0},{x:0,y:0}]){
  const nodes=[{id:'a',x:0,y:0,name:'SW1'},{id:'b',...target,name:'SW2'}],layouts=layoutLinks(nodes,links(count)),labels=layouts.flatMap(l=>l.labels);
  separatedSockets(layouts);
  assert.equal(new Set(layouts.map(l=>l.path)).size,count);
  assert.equal(new Set(layouts.map(l=>JSON.stringify(l.start))).size,count);
  assert.equal(new Set(layouts.map(l=>JSON.stringify(l.end))).size,count);
  for(const l of layouts){assert.ok(!/NaN|Infinity/.test(l.path));assert.equal(l.labels[0].endpoint.deviceId,'a');assert.equal(l.labels[1].endpoint.deviceId,'b');}
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)assert.ok(!collide(labels[i],labels[j]),`labels overlap for ${JSON.stringify(target)}: ${i}/${j}`);
  for(const label of labels)for(const node of nodes)assert.ok(!collide(label,{x:node.x,y:node.y+18,width:84,height:104}),`badge covers node for ${JSON.stringify(target)}`);
 }
});

test('all neighbors share one collision-free socket layout on a campus switch',()=>{
 const nodes=[{id:'dsw1',x:0,y:0,name:'DSW1'},{id:'dsw2',x:370,y:0,name:'DSW2'},{id:'psw',x:-80,y:150},{id:'sw1',x:70,y:160},{id:'sw2',x:310,y:160},{id:'server',x:510,y:200},{id:'wlc',x:680,y:0}];
 const cables:Link[]=[];
 const connect=(a:string,b:string,aPort:number,bPort:number)=>cables.push({id:`${a}-${b}-${aPort}`,a:{deviceId:a,port:`GigabitEthernet0/${aPort}`},b:{deviceId:b,port:`GigabitEthernet0/${bPort}`},enabled:true,delay:.1,loss:0});
 connect('dsw1','dsw2',1,1);connect('dsw1','dsw2',2,2);connect('dsw1','dsw2',6,6);
 connect('dsw1','psw',3,2);connect('dsw1','sw1',4,1);connect('dsw1','sw2',5,1);
 connect('dsw2','sw1',5,2);connect('dsw2','sw2',3,2);connect('dsw2','server',4,0);connect('dsw2','wlc',7,1);
 for(const x of [-200,0,200])for(const y of [-180,0,180]){
  const moved=nodes.map(n=>n.id==='dsw2'?{...n,x:n.x+x,y:n.y+y}:n),layouts=layoutLinks(moved,cables),labels=layouts.flatMap(l=>l.labels);
  separatedSockets(layouts);
  for(const label of labels){
   for(const other of labels)if(label!==other)assert.ok(!collide(label,other),'Interface badges must stay separate');
   for(const layout of layouts)for(const point of[layout.start,layout.end])assert.ok(!collide(label,{...point,width:8,height:8}),'A badge must not cover a connection point');
  }
  const reversed=layoutLinks([...moved].reverse(),cables.map(l=>({...l,a:l.b,b:l.a})).reverse());
  assert.deepEqual(layouts.map(l=>[l.id,l.path]),reversed.map(l=>[l.id,l.path]));
 }
});

test('dense fan-out keeps sockets apart even when every cable has a different neighbor',()=>{
 for(const count of[8,24,48]){
  const nodes=[{id:'a',x:0,y:0},...Array.from({length:count},(_,i)=>({id:`peer-${i}`,x:360,y:(i-(count-1)/2)*24}))];
  const cables=links(count).map((link,i)=>({...link,b:{...link.b,deviceId:`peer-${i}`}}));
  const layouts=layoutLinks(nodes,cables);separatedSockets(layouts);
  for(const layout of layouts)assert.ok(!/NaN|Infinity/.test(layout.path));
 }
});

test('large notes cannot exhaust label candidates and leave an overlapping badge',()=>{
 const note={x:180,y:0,width:1200,height:1000},layouts=layoutLinks([{id:'a',x:0,y:0},{id:'b',x:360,y:0}],links(2),[note]);
 for(const label of layouts.flatMap(l=>l.labels))assert.ok(!collide(label,note));
});
test('vertical parallel cables stay on their assigned side without crossing through the bundle',()=>{
 for(const y of [-300,300])for(const layout of layoutLinks([{id:'a',x:0,y:0},{id:'b',x:0,y}],links(4))){
  const values=layout.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number),xs=values.filter((_,i)=>i%2===0);
  assert.ok(xs.every(x=>x>0)||xs.every(x=>x<0),layout.path);
 }
});
test('lane ordering survives reversed cable endpoints and uses natural interface order',()=>{
 const nodes=[{id:'a',x:0,y:0},{id:'b',x:300,y:80}],cables=links(12);
 const normal=layoutLinks(nodes,cables),reversed=layoutLinks(nodes,cables.map(l=>({...l,a:l.b,b:l.a})).reverse());
 assert.deepEqual(normal.map(l=>[l.id,l.path]),reversed.map(l=>[l.id,l.path]));
 assert.equal(orderedPairLinks(cables.reverse(),'b','a')[1].a.port,'GigabitEthernet0/2');
 assert.equal(normal[0].labels[0].text,'Gi0/1');
 assert.equal(shortInterface('TenGigabitEthernet1/0/2'),'Te1/0/2');
});
test('labels avoid other devices and notes, and fit bounds contain every badge',()=>{
 const obstacle={x:100,y:0,width:100,height:50};
 const layout=layoutLinks([{id:'a',x:0,y:0},{id:'b',x:400,y:0},{id:'c',x:300,y:-60}],links(2),[obstacle]);
 for(const link of layout)for(const badge of link.labels){assert.ok(!collide(badge,obstacle));assert.ok(badge.x-badge.width/2>=link.bounds.x-link.bounds.width/2-.01);assert.ok(badge.y+badge.height/2<=link.bounds.y+link.bounds.height/2+.01);}
});
