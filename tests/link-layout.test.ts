import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutLinks,orderedPairLinks,shortInterface,type LayoutBox} from '../src/link-layout.ts';
import type {Link} from '../src/model.ts';
const links=(count:number):Link[]=>Array.from({length:count},(_,i)=>({id:'link-'+i,a:{deviceId:'a',port:'GigabitEthernet0/'+(i+1)},b:{deviceId:'b',port:'GigabitEthernet0/'+(i+1)},enabled:true,delay:0.1,loss:0}));
const collide=(a:LayoutBox,b:LayoutBox)=>Math.abs(a.x-b.x)<(a.width+b.width)/2&&Math.abs(a.y-b.y)<(a.height+b.height)/2;

test('parallel links have distinct sockets, paths and nonoverlapping interface badges in multiple orientations',()=>{
 for(const count of [1,2,4,8,24])for(const target of [{x:360,y:0},{x:0,y:360},{x:0,y:-360},{x:300,y:240},{x:120,y:0},{x:0,y:0}]){
  const nodes=[{id:'a',x:0,y:0,name:'SW1'},{id:'b',...target,name:'SW2'}],layouts=layoutLinks(nodes,links(count)),labels=layouts.flatMap(l=>l.labels);
  assert.equal(new Set(layouts.map(l=>l.path)).size,count);
  assert.equal(new Set(layouts.map(l=>JSON.stringify(l.start))).size,count);
  assert.equal(new Set(layouts.map(l=>JSON.stringify(l.end))).size,count);
  for(const l of layouts){assert.ok(!/NaN|Infinity/.test(l.path));assert.equal(l.labels[0].endpoint.deviceId,'a');assert.equal(l.labels[1].endpoint.deviceId,'b');}
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)assert.ok(!collide(labels[i],labels[j]),`labels overlap for ${JSON.stringify(target)}: ${i}/${j}`);
  for(const label of labels)for(const node of nodes)assert.ok(!collide(label,{x:node.x,y:node.y+18,width:84,height:104}),`badge covers node for ${JSON.stringify(target)}`);
 }
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
