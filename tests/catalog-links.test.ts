import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogLabHash,catalogLabPermalink,parseCatalogRoute} from '../src/catalog-links.ts';
import {LAB_CATALOG} from '../src/lab-catalog.ts';

test('each catalog lab has a stable entry link independent of its title, group or workspace ID',()=>{
 for(const lab of LAB_CATALOG){const hash=catalogLabHash(lab.id);assert.equal(hash,'#/labs/'+lab.id);assert.deepEqual(parseCatalogRoute(hash),{kind:'lab',id:lab.id});}
});
test('shared links use each deployment host and retain its port, subfolder, filename and query',()=>{
 for(const base of ['https://training.example/','https://other.example/networksim/','https://academy.example/apps/NetworkSim/index.html?tenant=campus','http://lab-host:8080/sim.html','http://127.0.0.1:4173/','file:///Users/test/NetworkSim/index.html']){
  const expected=new URL(base);expected.hash='#/labs/router-on-a-stick';assert.equal(catalogLabPermalink('router-on-a-stick',base+'#previous'),expected.href);
 }
});
test('a shared link replaces the current fragment without copying a private lab configuration',()=>{
 const result=catalogLabPermalink('datacenter-vpc','https://custom.example/sim/?class=ccnp&room=2#/labs/router-on-a-stick');assert.equal(result,'https://custom.example/sim/?class=ccnp&room=2#/labs/datacenter-vpc');
});
test('catalog routing recognizes the list and decoded IDs, and handles absent or malformed entries',()=>{
 assert.deepEqual(parseCatalogRoute('#/labs'),{kind:'catalog'});assert.deepEqual(parseCatalogRoute('#/labs/'),{kind:'catalog'});assert.deepEqual(parseCatalogRoute('#/labs/%72outer-on-a-stick'),{kind:'lab',id:'router-on-a-stick'});assert.deepEqual(parseCatalogRoute('#/labs/datacenter-vpc/'),{kind:'lab',id:'datacenter-vpc'});
 for(const hash of ['#/labs/unknown','#/labs/%ZZ','#/labs/%3Cscript%3E','#/labs/router-on-a-stick?command=reload'])assert.deepEqual(parseCatalogRoute(hash),{kind:'missing'});
 for(const hash of ['','#other','#/unrelated'])assert.equal(parseCatalogRoute(hash),null);assert.throws(()=>catalogLabHash('unknown'),/not in the catalog/);
});
