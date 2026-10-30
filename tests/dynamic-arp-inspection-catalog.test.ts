import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {inspectIngress} from '../src/packet-policy.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,DAI_COMMANDS as COMMANDS,DAI_STATIC_MAC,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const id=(n:string)=>'device-dai-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n,p='GigabitEthernet0';
const d=(sim:Simulator,n:string)=>sim.getDevice(id(n))!;
function load(mode:'practice'|'completed'='completed'){const sim=new Simulator();sim.load(parseLabFile(serializeLabFile(createCatalogLab('dynamic-arp-inspection',mode))));sim.advance(1500);return sim;}
function cli(sim:Simulator,n='SW1'){const c=new IOSSession(sim,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);}}
function change(sim:Simulator,...lines:string[]){run(cli(sim),'configure terminal',...lines,'end');}
const row=(sim:Simulator,n:string)=>lessonProgress(sim)!.rows.find(r=>r.objective.id===n)!;
const goal=(sim:Simulator,n:string)=>row(sim,n).complete;
function renew(sim:Simulator,n='PC1'){const r=sim.requestDHCP(id(n),p);sim.advance(1500);lessonProgress(sim);return r;}
function ping(sim:Simulator,n='PC1',target='192.168.20.10'){const r=sim.ping(id(n),target,{count:3});sim.advance(5000);lessonProgress(sim);return r.received;}
function clear(sim:Simulator,n='PC1'){run(cli(sim,n),'arp -d *');}
function claim(sim:Simulator,n='PC3',address='192.168.10.1'){sim.sendGratuitousARP(id(n),p,address);sim.advance(500);lessonProgress(sim);}
const cache=(sim:Simulator,address='192.168.10.1')=>d(sim,'PC1').runtime.arp[p+'|'+address]?.mac;
function finish(sim:Simulator){assert.equal(ping(sim),3);assert.equal(ping(sim,'PC2'),3);claim(sim,'SRV2','192.168.10.50');claim(sim);assert.equal(lessonProgress(sim)!.complete,12);}

test('DAI catalog has seven nodes, six links, twelve tasks and unprotected zero-credit practice',()=>{
 const e=LAB_CATALOG.find(e=>e.id==='dynamic-arp-inspection')!;assert.equal(e.group,'CCNA');assert.equal(e.section,'Services & Security');assert.equal(e.devices,7);assert.equal(e.links,6);const a=createCatalogLab(e.id),b=createCatalogLab(e.id);assert.notEqual(a.lab.id,b.lab.id);for(const node of a.lab.devices)assert.deepEqual(node.startupConfig,node.config);const sim=load('practice');assert.equal(lessonProgress(sim)!.complete,0);assert.equal(lessonProgress(sim)!.rows.length,12);assert.equal(catalogGuideResources(e.id)!.rows.length,7);assert.equal(lessonProgress(sim)!.rows.filter(r=>r.objective.action&&actionAvailable(sim,r.objective)).length,2);assert.equal(d(sim,'PC1').config.interfaces[p].ip,'192.168.10.100');assert.deepEqual(d(sim,'SW1').runtime.features.dhcpBindings,undefined);
});
test('reference configuration contains no invented runtime credit; fresh DORA earns two bindings and real test traffic completes all tasks',()=>{
 const doc=createCatalogLab('dynamic-arp-inspection','completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(node.startupConfig,node.config);}const sim=new Simulator();sim.load(doc);assert.equal(lessonProgress(sim)!.complete,5);sim.advance(1500);assert.equal(lessonProgress(sim)!.complete,7);finish(sim);
});
test('published commands configure the practice through IOS; old leases need new admitted ACKs before binding credit',()=>{
 const sim=load('practice');run(new IOSSession(sim,id('SW1')),...COMMANDS.SW1);assert.equal(lessonProgress(sim)!.complete,5);for(const n of ['PC1','PC2'])assert.equal(renew(sim,n).status,'success');assert.equal(lessonProgress(sim)!.complete,7);finish(sim);
});
test('both legitimate clients use binding-validated ARP and remote routed traffic; static host uses its exact ACL',()=>{
 const sim=load();finish(sim);const rows=d(sim,'SW1').runtime.features.arpInspectionEvents;for(const[i,n]of ['PC1','PC2'].entries()){const ip=d(sim,n).config.interfaces[p].ip;assert.ok(rows.some((r:any)=>r.port===g(i+1)&&r.source===ip&&r.action==='permit'&&r.basis==='binding'));}assert.equal(cache(sim,'192.168.10.50'),DAI_STATIC_MAC);assert.ok(rows.some((r:any)=>r.source==='192.168.10.50'&&r.action==='permit'&&r.basis==='acl'));assert.equal(ping(sim,'PC1','192.168.10.50'),3);const web=sim.httpRequest(id('PC1'),'http://server.dai.lab/');sim.advance(12000);assert.equal(web.statusCode,200);
});
test('forged gateway ARP produces a correlated drop with packet details and never poisons the protected PC cache',()=>{
 const sim=load();assert.equal(ping(sim),3);const before=cache(sim);claim(sim);assert.equal(goal(sim,'forged-arp'),true);assert.equal(goal(sim,'gateway-cache'),true);assert.equal(cache(sim),before);assert.equal(before,sim.macOf(id('R1'),g(0)));const r=d(sim,'SW1').runtime.features.arpInspectionEvents.find((r:any)=>r.port===g(5)&&r.action==='deny');const event=sim.events.find(e=>e.nodeId===id('SW1')&&e.disposition==='drop'&&e.packet?.id===r.frameId)!;assert.equal(event.packet!.source,'192.168.10.1');assert.equal(event.packet!.sourceMac,sim.macOf(id('PC3'),p));assert.equal(event.packet!.arpOperation,'reply');assert.equal(d(sim,'PC3').config.interfaces[p].ip,'192.168.10.60');
});
test('trust bypass or VLAN disable admits the same forged claim; restore protection and clear poisoned caches to repair',()=>{
 for(const fault of ['trust','scope']){const sim=load();assert.equal(ping(sim),3);if(fault==='trust')change(sim,'interface '+g(5),'ip arp inspection trust');else change(sim,'no ip arp inspection vlan 10');claim(sim);assert.equal(cache(sim),sim.macOf(id('PC3'),p));assert.equal(goal(sim,'forged-arp'),false);assert.equal(goal(sim,'gateway-cache'),false);if(fault==='trust')change(sim,'interface '+g(5),'no ip arp inspection trust');else change(sim,'ip arp inspection vlan 10');assert.equal(cache(sim),sim.macOf(id('PC3'),p),'policy repairs do not rewrite an endpoint cache');clear(sim);assert.equal(ping(sim),3);claim(sim);assert.equal(goal(sim,'gateway-cache'),true);}
});
test('DHCP trust does not substitute for gateway ARP trust; removing ARP trust blocks resolved-route traffic until repaired',()=>{
 const sim=load();change(sim,'interface '+g(3),'no ip arp inspection trust');assert.equal(d(sim,'SW1').config.interfaces[g(3)].features.dhcpSnoopingTrust,true);assert.equal(ping(sim),0);assert.equal(goal(sim,'trusted-gateway'),false);assert.ok(sim.events.some(e=>e.port===g(3)&&e.label==='Dynamic ARP inspection drop'));change(sim,'interface '+g(3),'ip arp inspection trust');clear(sim);assert.equal(ping(sim),3);
});
test('static filter keyword denies unmatched DHCP clients while keeping exact static permits; removing it restores binding fallback',()=>{
 const sim=load();change(sim,'ip arp inspection filter STATIC-SERVER vlan 10 static');assert.equal(goal(sim,'static-acl'),false);assert.equal(ping(sim),0);claim(sim,'SRV2','192.168.10.50');assert.equal(goal(sim,'static-arp'),true);change(sim,'no ip arp inspection filter STATIC-SERVER vlan 10 static','ip arp inspection filter STATIC-SERVER vlan 10');clear(sim);assert.equal(ping(sim),3);
});
test('missing or wrong static ARP ACL blocks real SRV2 traffic; broad permits do not satisfy exact-host policy or acceptance proof',()=>{
 const sim=load();change(sim,'no arp access-list STATIC-SERVER');claim(sim,'SRV2','192.168.10.50');assert.equal(goal(sim,'static-arp'),false);assert.equal(cache(sim,'192.168.10.50'),undefined);change(sim,'arp access-list STATIC-SERVER','permit ip any mac any','exit','ip arp inspection filter STATIC-SERVER vlan 10');claim(sim,'SRV2','192.168.10.50');assert.equal(cache(sim,'192.168.10.50'),DAI_STATIC_MAC);assert.equal(goal(sim,'static-acl'),false);assert.equal(goal(sim,'static-arp'),false);change(sim,'no arp access-list STATIC-SERVER','arp access-list STATIC-SERVER','permit ip host 192.168.10.50 mac host 0200.0010.0051','exit','ip arp inspection filter STATIC-SERVER vlan 10');claim(sim,'SRV2','192.168.10.50');assert.equal(goal(sim,'static-acl'),false);assert.equal(goal(sim,'static-arp'),false);run(new IOSSession(sim,id('SW1')),...COMMANDS.SW1);assert.equal(goal(sim,'static-acl'),false,'a wrong first rule must be removed, not hidden by another permit');change(sim,'no arp access-list STATIC-SERVER','arp access-list STATIC-SERVER','permit ip host 192.168.10.50 mac host 0200.0010.0050','exit','ip arp inspection filter STATIC-SERVER vlan 10');claim(sim,'SRV2','192.168.10.50');assert.equal(goal(sim,'static-acl'),true);assert.equal(goal(sim,'static-arp'),true);
});
test('cleared snooping bindings leave cached paths usable but fresh client ARP fails until real lease renewal',()=>{
 const sim=load();assert.equal(ping(sim),3);run(cli(sim),'clear ip dhcp snooping binding *');assert.equal(goal(sim,'pc1-lease'),false);assert.equal(ping(sim),3);clear(sim);assert.equal(ping(sim),0);assert.equal(goal(sim,'inspection'),true);assert.equal(renew(sim).status,'success');clear(sim);assert.equal(ping(sim),3);assert.equal(goal(sim,'pc1-lease'),true);
});
test('invalid ARP IPs are rejected by enabled validation; inspection records are bounded and packet counters cannot fabricate proof',()=>{
 const sim=load();claim(sim,'PC3','0.0.0.0');assert.ok(d(sim,'SW1').runtime.features.arpInspectionEvents.some((r:any)=>r.source==='0.0.0.0'&&r.basis==='ip'&&r.action==='deny'));d(sim,'SW1').runtime.features.arpInspectionDrops=999;assert.equal(goal(sim,'forged-arp'),false);sim.emit({nodeId:id('SW1'),port:g(5),protocol:'ARP',label:'Dynamic ARP inspection drop',disposition:'drop',detail:'Unrelated'});assert.equal(goal(sim,'forged-arp'),false);claim(sim);delete d(sim,'SW1').config.interfaces[g(5)].features.arpInspectionRate;for(let i=0;i<1005;i++)inspectIngress(sim,d(sim,'SW1'),g(5),10,{id:'bounded-'+i,sourceMac:sim.macOf(id('PC3'),p),destinationMac:'ff:ff:ff:ff:ff:ff',hops:64,payload:{kind:'arp',operation:'reply',family:4,source:'192.168.10.1',target:'192.168.10.1',mac:sim.macOf(id('PC3'),p)}});assert.equal(d(sim,'SW1').runtime.features.arpInspectionEvents.length,1000);assert.equal(goal(sim,'forged-arp'),true);const criterion=row(sim,'forged-arp').objective.criterion;for(const r of d(sim,'SW1').runtime.features.arpInspectionEvents)r.frameId='unrelated';assert.equal(matches(sim,criterion),false);
});
test('ARP rate violation err-disables only the offending port and shutdown/no shutdown restores inspection',()=>{
 const sim=load();change(sim,'interface '+g(5),'ip arp inspection limit rate 1');for(let i=0;i<3;i++)sim.sendGratuitousARP(id('PC3'),p,'192.168.10.1');sim.advance(500);assert.equal(d(sim,'SW1').config.interfaces[g(5)].features.errDisabled,true);assert.equal(sim.interfaceUp(id('SW1'),g(1)),true);assert.match(cli(sim).execute('show interfaces status err-disabled').join('\n'),/arp-inspection/);change(sim,'interface '+g(5),'ip arp inspection limit rate 15','shutdown','no shutdown');sim.advance(1500);assert.equal(goal(sim,'arp-rate'),true);assert.equal(ping(sim),3);
});
test('saved reopening preserves policy and achievements but rebuilds live bindings and the gateway neighbor cache',()=>{
 const sim=load();finish(sim);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(sim.serialize())));assert.equal(lessonProgress(restored)!.complete,9);assert.equal(goal(restored,'gateway-cache'),false);restored.advance(2000);assert.equal(lessonProgress(restored)!.complete,11);assert.equal(ping(restored),3);assert.equal(lessonProgress(restored)!.complete,12);assert.equal(goal(restored,'static-arp'),true);assert.equal(goal(restored,'forged-arp'),true);
});
test('all published IOS and Windows verification commands execute and inspection output reflects real drops',()=>{
 const sim=load();finish(sim);for(const[n,commands]of Object.entries(catalogGuideResources('dynamic-arp-inspection')!.verification))run(cli(sim,n),...commands);assert.match(cli(sim).execute('show ip arp inspection statistics').join('\n'),/drop/i);assert.match(cli(sim).execute('show ip dhcp snooping binding').join('\n'),/Total number of bindings: 2/);
});
test('imported ARP actions and criteria are bounded, IPv4-only and gated by the actual source interface',()=>{
 const sim=load(),obj=row(sim,'forged-arp').objective;validateLesson({title:'ARP',description:'',objectives:[obj]});assert.equal(actionAvailable(sim,obj),true);d(sim,'PC3').config.interfaces[p].adminUp=false;assert.equal(actionAvailable(sim,obj),false);const c=obj.criterion as any;for(const bad of [{...c,address:'bad'},{...c,vlan:4095},{...c,sourceInterface:[]},{...c,decision:'allow'},{kind:'dai-rate',device:id('SW1'),interfaces:[],rate:15},{kind:'dai-rate',device:id('SW1'),interfaces:[g(1)],rate:2049}])assert.throws(()=>validateLesson({title:'ARP',description:'',objectives:[{...obj,criterion:bad}]}));for(const address of ['bad','::1','999.1.1.1'])assert.throws(()=>validateLesson({title:'ARP',description:'',objectives:[{...obj,action:{...obj.action,address}}]}));
});
