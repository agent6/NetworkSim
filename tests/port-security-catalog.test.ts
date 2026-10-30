import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator,type Frame} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {inspectPortSecurity,secureEntries,secureMac} from '../src/port-security.ts';
import {createCatalogLab,PORT_SECURITY_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const id=(n:string)=>'device-ps-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n,p='GigabitEthernet0';
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab('port-security',mode))));s.advance(3000);return s;}
function cli(s:Simulator,n='SW1'){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...commands:string[]){for(const command of commands){const out=c.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);}}
function change(s:Simulator,...lines:string[]){run(cli(s),'configure terminal',...lines,'end');}
const row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!;
const goal=(s:Simulator,n:string)=>row(s,n).complete;
function ping(s:Simulator,n='PC1'){const r=s.ping(id(n),'192.168.10.100',{count:3});s.advance(5000);lessonProgress(s);return r.received;}
const entries=(s:Simulator)=>secureEntries(d(s,'SW1'),d(s,'SW1').config.interfaces[g(1)]);
const count=(s:Simulator)=>d(s,'SW1').runtime.features.portSecurityPortViolations?.[g(1)]??0;
const violationLogs=(s:Simulator)=>d(s,'SW1').runtime.logs.filter(l=>l.includes('PSECURE_VIOLATION'));
function mode(s:Simulator,value:string){change(s,'interface '+g(1),'switchport port-security violation '+value);}
function learn(s:Simulator,save=true){assert.equal(ping(s),3);assert.equal(ping(s,'PC2'),3);if(save)run(cli(s),'write memory');lessonProgress(s);}
function recover(s:Simulator){mode(s,'restrict');change(s,'interface '+g(1),'shutdown','no shutdown');s.advance(2200);assert.equal(ping(s),3);}
function finish(s:Simulator,save=true){learn(s,save);assert.equal(ping(s,'PC3'),0);mode(s,'protect');assert.equal(ping(s,'PC3'),0);mode(s,'shutdown');assert.equal(ping(s,'PC3'),0);assert.equal(ping(s,'PC4'),3);recover(s);assert.equal(lessonProgress(s)!.complete,save?12:11);}

test('Port Security catalog has seven nodes, six links, twelve tasks and zero-credit unprotected practice',()=>{
 const e=LAB_CATALOG.find(e=>e.id==='port-security')!;assert.equal(e.group,'CCNA');assert.equal(e.section,'Services & Security');assert.equal(e.devices,7);assert.equal(e.links,6);const a=createCatalogLab(e.id),b=createCatalogLab(e.id);assert.notEqual(a.lab.id,b.lab.id);for(const node of a.lab.devices)assert.deepEqual(node.startupConfig,node.config);const s=load('practice');assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,12);assert.equal(catalogGuideResources(e.id)!.rows.length,5);assert.ok(lessonProgress(s)!.rows.filter(r=>r.objective.action).every(r=>!actionAvailable(s,r.objective)));for(const name of ['PC1','PC2','PC3','PC4'])assert.equal(ping(s,name),3);assert.equal(lessonProgress(s)!.complete,0);
});
test('completed reference provides four configuration goals without learned MACs, saved bindings or fabricated runtime proof',()=>{
 const doc=createCatalogLab('port-security','completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(node.startupConfig,node.config);}const s=load();assert.equal(lessonProgress(s)!.complete,4);assert.deepEqual(entries(s),[]);assert.equal(goal(s,'save-sticky'),false);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,2);assert.equal(d(s,'SW1').config.interfaces[g(1)].features.portfast,false);assert.equal(d(s,'SW2').config.interfaces[g(1)].features.portfast,false);
});
test('published IOS configuration earns four policy goals; real source traffic learns two sticky bindings and a later write saves them',()=>{
 const s=load('practice');run(new IOSSession(s,id('SW1')),...COMMANDS.SW1);assert.equal(lessonProgress(s)!.complete,4);assert.equal(ping(s),3);assert.equal(lessonProgress(s)!.complete,5);assert.equal(ping(s,'PC2'),3);assert.equal(lessonProgress(s)!.complete,6);assert.equal(goal(s,'save-sticky'),false);run(cli(s),'write memory');assert.equal(lessonProgress(s)!.complete,7);assert.deepEqual(entries(s).map(r=>[r.mac,r.type,r.vlan]).sort(),[['020000100011','SecureSticky',10],['020000100012','SecureSticky',10]]);
});
test('restrict drops actual PC3 frames, increments native counts, emits syslog and preserves authorized forwarding',()=>{
 const s=load();learn(s);assert.equal(ping(s,'PC3'),0);assert.equal(goal(s,'restrict-incident'),true);assert.ok(count(s)>0);assert.ok(violationLogs(s).some(l=>l.includes('0200.0010.0013')));assert.equal(s.interfaceUp(id('SW1'),g(1)),true);assert.equal(ping(s),3);assert.equal(ping(s,'PC2'),3);const r=d(s,'SW1').runtime.features.portSecurityEvents.find((r:any)=>r.mode==='restrict'&&r.logged),event=s.events.find(e=>e.nodeId===id('SW1')&&e.packet?.id===r.packetId&&e.disposition==='drop')!;assert.equal(event.packet!.sourceMac,'02:00:00:10:00:13');assert.equal(event.packet!.source,'192.168.10.13');assert.equal(event.port,g(1));assert.equal(r.vlan,10);assert.ok(r.afterCount>r.beforeCount);
});
test('protect silently drops the same unknown source without incrementing a preexisting native count or logging, keeping known hosts usable',()=>{
 const s=load();learn(s);ping(s,'PC3');const before=count(s),logs=violationLogs(s).length;mode(s,'protect');assert.equal(ping(s,'PC3'),0);assert.equal(count(s),before);assert.equal(violationLogs(s).length,logs);assert.equal(goal(s,'protect-incident'),true);assert.equal(s.interfaceUp(id('SW1'),g(1)),true);assert.equal(ping(s),3);assert.equal(ping(s,'PC2'),3);assert.ok(d(s,'SW1').runtime.features.portSecurityEvents.some((r:any)=>r.mode==='protect'&&r.afterCount===r.beforeCount&&!r.logged&&!r.disabled));
});
test('shutdown really err-disables the shared ingress and interrupts both authorized hosts while PC4 still reaches SRV1',()=>{
 const s=load();learn(s);mode(s,'shutdown');assert.equal(ping(s,'PC3'),0);assert.equal(goal(s,'shutdown-incident'),true);assert.equal(d(s,'SW1').runtime.features.errdisableCauses[g(1)],'psecure-violation');assert.match(cli(s).execute('show port-security interface '+g(1)).join('\n'),/Port Status\s+: Secure-shutdown/);assert.match(cli(s).execute('show interfaces status err-disabled').join('\n'),/psecure-violation/);assert.equal(ping(s),0);assert.equal(ping(s,'PC2'),0);assert.equal(actionAvailable(s,row(s,'pc4-unaffected').objective),true);assert.equal(ping(s,'PC4'),3);assert.equal(goal(s,'pc4-unaffected'),true);assert.equal(entries(s).length,2);
});
test('manual recovery restores restrict and actual forwarding while retaining the two sticky addresses and rejecting PC3',()=>{
 const s=load();finish(s);assert.equal(s.interfaceUp(id('SW1'),g(1)),true);assert.equal(d(s,'SW1').config.interfaces[g(1)].features.portSecurity.violation,'restrict');assert.equal(entries(s).length,2);assert.equal(goal(s,'pc1-recovered'),true);assert.equal(ping(s,'PC3'),0);assert.equal(ping(s),3);
});
test('all mode observations remain earned after recovery while the intended final restrict mode remains a live configuration goal',()=>{
 const s=load();finish(s);mode(s,'protect');assert.equal(lessonProgress(s)!.complete,11);for(const value of ['restrict','protect','shutdown'])assert.equal(goal(s,value+'-incident'),true);assert.equal(goal(s,'restrict-mode'),false);mode(s,'restrict');assert.equal(lessonProgress(s)!.complete,12);
});
test('raising the maximum admits the third source and fails policy; remove the mistaken sticky address before restoring the two-MAC limit',()=>{
 const s=load();learn(s);change(s,'interface '+g(1),'switchport port-security maximum 3');assert.equal(ping(s,'PC3'),3);assert.equal(goal(s,'maximum'),false);assert.equal(goal(s,'restrict-incident'),false);assert.equal(entries(s).length,3);const c=cli(s);run(c,'configure terminal','interface '+g(1));assert.ok(c.execute('switchport port-security maximum 2').some(iosRejected));run(c,'no switchport port-security mac-address sticky 0200.0010.0013','switchport port-security maximum 2','end');assert.equal(ping(s,'PC3'),0);assert.equal(goal(s,'maximum'),true);
});
test('dynamic secure MACs do not masquerade as sticky bindings; enabling sticky converts observed dynamic sources and requires another save',()=>{
 const s=load();change(s,'interface '+g(1),'no switchport port-security mac-address sticky');learn(s,false);assert.ok(entries(s).every(r=>r.type==='SecureDynamic'));assert.equal(goal(s,'pc1-learn'),false);assert.equal(goal(s,'pc2-learn'),false);assert.equal(goal(s,'sticky'),false);change(s,'interface '+g(1),'switchport port-security mac-address sticky');assert.ok(entries(s).every(r=>r.type==='SecureSticky'));assert.equal(goal(s,'pc1-learn'),true);assert.equal(goal(s,'save-sticky'),false);run(cli(s),'write memory');assert.equal(goal(s,'save-sticky'),true);
});
test('learning PC3 first consumes a real secure slot and blocks PC2 until the wrong sticky address is removed',()=>{
 const s=load();assert.equal(ping(s,'PC3'),3);assert.equal(ping(s),3);assert.equal(ping(s,'PC2'),0);assert.equal(goal(s,'pc2-learn'),false);assert.equal(actionAvailable(s,row(s,'restrict-incident').objective),false);change(s,'interface '+g(1),'no switchport port-security mac-address sticky 0200.0010.0013');assert.equal(ping(s,'PC2'),3);assert.equal(goal(s,'pc2-learn'),true);assert.equal(entries(s).length,2);
});
test('explicit static secure entries permit their hosts but cannot satisfy the sticky learning objectives',()=>{
 const s=load();change(s,'interface '+g(1),'no switchport port-security mac-address sticky','switchport port-security mac-address 0200.0010.0011','switchport port-security mac-address 0200.0010.0012');assert.equal(ping(s),3);assert.equal(ping(s,'PC2'),3);assert.ok(entries(s).every(r=>r.type==='SecureConfigured'));assert.equal(goal(s,'pc1-learn'),false);assert.equal(goal(s,'save-sticky'),false);
});
test('IOS reload uses actual startup configuration: unsaved learned sticky addresses disappear while saved bindings survive',()=>{
 const unsaved=load();learn(unsaved,false);assert.equal(entries(unsaved).length,2);unsaved.reloadIOS(id('SW1'));unsaved.advance(8000);assert.equal(entries(unsaved).length,0);assert.equal(goal(unsaved,'pc1-learn'),false);const saved=load();learn(saved);saved.reloadIOS(id('SW1'));saved.advance(8000);assert.equal(entries(saved).length,2);assert.equal(goal(saved,'save-sticky'),true);assert.equal(ping(saved),3);
});
test('saving during a temporary mode does not save the intended final policy; restore restrict and write again',()=>{
 const s=load();learn(s);mode(s,'protect');run(cli(s),'write memory');assert.equal(goal(s,'save-sticky'),false);mode(s,'restrict');assert.equal(goal(s,'save-sticky'),false);run(cli(s),'write memory');assert.equal(goal(s,'save-sticky'),true);
});
test('unrelated outages, fabricated counters and mismatched packet identities cannot create violation observations or unaffected/recovered traffic',()=>{
 const s=load();learn(s);assert.equal(ping(s,'PC4'),3);assert.equal(goal(s,'pc4-unaffected'),false);assert.equal(goal(s,'pc1-recovered'),false);d(s,'SW1').runtime.features.portSecurityPortViolations={[g(1)]:999};s.emit({nodeId:id('SW1'),port:g(1),protocol:'ETHERNET',label:'Port security violation',detail:'Unrelated',disposition:'drop'});assert.equal(goal(s,'restrict-incident'),false);s.power(id('PC3'),false);assert.equal(ping(s,'PC3'),0);assert.equal(goal(s,'restrict-incident'),false);s.power(id('PC3'),true);assert.equal(ping(s,'PC3'),0);const criterion=row(s,'restrict-incident').objective.criterion;assert.equal(matches(s,criterion),true);for(const r of d(s,'SW1').runtime.features.portSecurityEvents)r.packetId='unrelated';assert.equal(matches(s,criterion),false);
});
test('published show/Windows commands and HTTP reflect actual state; portable saves retain running bindings separately from startup',()=>{
 const s=load();finish(s);for(const[name,commands]of Object.entries(catalogGuideResources('port-security')!.verification))run(cli(s,name),...commands);const web=s.httpRequest(id('PC4'),'http://192.168.10.100/');s.advance(10000);assert.equal(web.statusCode,200);assert.match(web.body,/authorized forwarding works/);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(s.serialize())));assert.equal(lessonProgress(restored)!.complete,12);assert.equal(entries(restored).length,2);assert.equal(d(restored,'SW1').runtime.features.portSecurityEvents,undefined);const unsaved=load();learn(unsaved,false);const portable=new Simulator();portable.load(parseLabFile(serializeLabFile(unsaved.serialize())));assert.equal(entries(portable).length,2);assert.equal(goal(portable,'save-sticky'),false);
});
test('violation decision telemetry is bounded and records actual counter semantics without altering the source frame',()=>{
 const s=load();learn(s);mode(s,'protect');const frame:Frame={id:'bounded',sourceMac:s.macOf(id('PC3'),p),destinationMac:'ff:ff:ff:ff:ff:ff',hops:64,payload:{kind:'arp',operation:'request',family:4,source:'192.168.10.13',target:'192.168.10.100',mac:s.macOf(id('PC3'),p)}};const payload=structuredClone(frame.payload);d(s,'SW1').runtime.features.portSecurityEvents=[];for(let i=0;i<1005;i++){frame.id='bounded-'+i;assert.equal(inspectPortSecurity(s,d(s,'SW1'),d(s,'SW1').config.interfaces[g(1)],10,frame),false);}assert.deepEqual(frame.payload,payload);const rows=d(s,'SW1').runtime.features.portSecurityEvents;assert.equal(rows.length,1000);assert.equal(rows[0].frameId,'bounded-5');assert.ok(rows.every((r:any)=>r.mode==='protect'&&r.beforeCount===r.afterCount&&!r.logged));
});
test('port-security lesson criteria and expected-block ping actions are bounded, declarative and mode-gated',()=>{
 const s=load(),obj=row(s,'restrict-incident').objective;validateLesson({title:'PS',description:'',objectives:[obj]});assert.equal(actionAvailable(s,obj),false);learn(s);assert.equal(actionAvailable(s,obj),true);const c=row(s,'maximum').objective.criterion as any;for(const bad of [{...c,value:0},{...c,value:1025},{...c,vlan:4095},{...c,field:'command'},{kind:'ps-saved',device:id('SW1'),interface:g(1),vlan:10,sources:[id('PC1'),id('PC1')],sourceInterface:p}])assert.throws(()=>validateLesson({title:'PS',description:'',objectives:[{...obj,criterion:bad}]}));assert.throws(()=>validateLesson({title:'PS',description:'',objectives:[{...obj,action:{...obj.action,expect:'anything'}}]}));mode(s,'protect');assert.equal(actionAvailable(s,obj),false);
});
