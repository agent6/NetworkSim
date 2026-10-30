import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator,type Frame} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {inspectIngress} from '../src/packet-policy.ts';
import {createCatalogLab,IPV6_RA_GUARD_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {lessonProgress,matches,validateLesson,actionAvailable} from '../src/lessons.ts';
import {prefixContains,sameAddress} from '../src/ip.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const id=(n:string)=>'device-ra-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n,p='GigabitEthernet0',rp=g(0);
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab('ipv6-ra-guard',mode))));s.advance(2200);return s;}
function cli(s:Simulator,n='SW1'){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...commands:string[]){for(const command of commands){const out=c.execute(command);assert.ok(!out.some(iosRejected),command+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized/i);}}
function change(s:Simulator,...lines:string[]){run(cli(s),'configure terminal',...lines,'end');}
const row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!;
const goal=(s:Simulator,n:string)=>row(s,n).complete;
function renew(s:Simulator,n='PC1'){const r=s.restartIPv6Autoconfig(id(n),p);s.advance(2200);lessonProgress(s);return r;}
function ping(s:Simulator,n='PC1'){const r=s.ping(id(n),'2001:db8:20::10',{count:3});s.advance(5000);lessonProgress(s);return r.received;}
const bad=(s:Simulator,n='PC1')=>d(s,n).config.interfaces[p].ipv6.some(a=>prefixContains('2001:db8:bad::',64,a.split('/')[0]));
function finish(s:Simulator){for(const n of ['PC1','PC2']){assert.equal(renew(s,n).status,'success');assert.equal(ping(s,n),3);}assert.equal(lessonProgress(s)!.complete,12);}

test('IPv6 RA Guard catalog has six nodes, five links, twelve tasks and a genuinely poisoned zero-credit practice',()=>{
 const e=LAB_CATALOG.find(e=>e.id==='ipv6-ra-guard')!;assert.equal(e.group,'CCNA');assert.equal(e.section,'Services & Security');assert.equal(e.devices,6);assert.equal(e.links,5);const a=createCatalogLab(e.id),b=createCatalogLab(e.id);assert.notEqual(a.lab.id,b.lab.id);for(const node of a.lab.devices)assert.deepEqual(node.startupConfig,node.config);const s=load('practice');assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,12);assert.equal(catalogGuideResources(e.id)!.rows.length,6);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,2);for(const n of ['PC1','PC2']){assert.equal(bad(s,n),true);assert.equal(d(s,n).runtime.features.ipv6DefaultRouters[p].address,'fe80::bad');}
});
test('reference contains five configuration goals and no saved runtime proof; automatic live RA/DAD traffic earns five more',()=>{
 const doc=createCatalogLab('ipv6-ra-guard','completed');for(const n of doc.lab.devices){assert.deepEqual(n.runtime.features,{});assert.deepEqual(n.startupConfig,n.config);}const s=new Simulator();s.load(doc);assert.equal(lessonProgress(s)!.complete,5);s.advance(2200);assert.equal(lessonProgress(s)!.complete,10);assert.equal(ping(s),3);assert.equal(ping(s,'PC2'),3);assert.equal(lessonProgress(s)!.complete,12);
});
test('published IOS commands protect ingress but do not erase existing bad prefixes; endpoint reset and real traffic complete the lab',()=>{
 const s=load('practice');run(new IOSSession(s,id('SW1')),...COMMANDS.SW1);assert.equal(lessonProgress(s)!.complete,5);s.advance(1500);assert.equal(bad(s),true);assert.equal(goal(s,'pc1-slaac'),false);finish(s);assert.equal(bad(s),false);assert.equal(bad(s,'PC2'),false);
});
test('actual rogue drops carry RA type, source link-local/MAC, advertised prefix, VLAN and correct ingress packet correlation',()=>{
 const s=load(),sw=d(s,'SW1'),rogue=d(s,'ROGUE');assert.equal(goal(s,'rogue-drop'),true);assert.equal(rogue.powered,true);assert.equal(s.interfaceUp(rogue.id,rp),true);const r=sw.runtime.features.raGuardEvents.find((r:any)=>r.port===g(4)),event=s.events.find(e=>e.nodeId===sw.id&&e.disposition==='drop'&&e.packet?.id===r.frameId)!;assert.equal(r.source,'fe80::bad');assert.equal(r.sourceMac,s.macOf(rogue.id,rp));assert.equal(r.vlan,10);assert.equal(r.policy,'HOST-PORTS');assert.equal(event.packet!.messageType,'ra');assert.equal(event.packet!.icmpType,134);assert.ok(event.packet!.raPrefixes.some((p:any)=>p.network==='2001:db8:bad::'&&p.prefix===64));
});
test('client ports are host-facing, legitimate uplink is router-facing and the rogue port remains host-facing without trusted bypass',()=>{
 const s=load(),sw=d(s,'SW1');for(const n of [1,2,4])assert.equal(sw.config.interfaces[g(n)].features.raGuardPolicy,'HOST-PORTS');assert.equal(sw.config.interfaces[g(3)].features.raGuardPolicy,'ROUTER-PORT');assert.equal(sw.config.features.ipv6Policies.raGuard['ROUTER-PORT'].deviceRole,'router');change(s,'interface '+g(1),'no ipv6 nd raguard attach-policy HOST-PORTS');assert.equal(goal(s,'client-ports'),false);assert.equal(goal(s,'rogue-port'),true);change(s,'interface '+g(1),'ipv6 nd raguard attach-policy HOST-PORTS');assert.equal(goal(s,'client-ports'),true);
});
test('removing the rogue attachment or assigning it the router role permits real unwanted RAs; restoring protection and reset repairs both clients',()=>{
 for(const fault of ['detach','router']){const s=load();if(fault==='detach')change(s,'interface '+g(4),'no ipv6 nd raguard attach-policy HOST-PORTS');else change(s,'interface '+g(4),'ipv6 nd raguard attach-policy ROUTER-PORT');renew(s);assert.equal(bad(s),true);assert.equal(goal(s,'pc1-slaac'),false);assert.equal(goal(s,'rogue-port'),false);change(s,'interface '+g(4),'ipv6 nd raguard attach-policy HOST-PORTS');assert.equal(bad(s),true,'repairing the switch does not erase learned prefixes');finish(s);}
});
test('trusted-port bypass defeats a host-role policy until removed, even if its device-role still prints host',()=>{
 const s=load();change(s,'ipv6 nd raguard policy HOST-PORTS','trusted-port');renew(s);assert.equal(bad(s),true);assert.equal(goal(s,'host-policy'),false);assert.equal(goal(s,'rogue-port'),false);change(s,'ipv6 nd raguard policy HOST-PORTS','no trusted-port');finish(s);assert.equal(goal(s,'host-policy'),true);
});
test('host role on the legitimate router port blocks fresh SLAAC rather than masquerading as successful rogue protection',()=>{
 const s=load();change(s,'interface '+g(3),'ipv6 nd raguard attach-policy HOST-PORTS');const r=s.restartIPv6Autoconfig(id('PC1'),p);s.advance(10000);assert.equal(r.status,'failure');assert.equal(goal(s,'pc1-slaac'),false);assert.equal(goal(s,'router-port'),false);assert.ok(s.events.some(e=>e.port===g(3)&&e.label==='RA guard drop'));change(s,'interface '+g(3),'ipv6 nd raguard attach-policy ROUTER-PORT');assert.equal(renew(s).status,'success');assert.equal(ping(s),3);
});
test('a restrictive router policy is enforced; removing the mistaken prefix check restores the intended basic router role',()=>{
 const s=load();change(s,'ipv6 prefix-list WRONG seq 5 permit 2001:db8:99::/64','ipv6 nd raguard policy ROUTER-PORT','match ra prefix-list WRONG');const r=s.restartIPv6Autoconfig(id('PC1'),p);s.advance(10000);assert.equal(r.status,'failure');assert.equal(goal(s,'router-policy'),false);assert.ok(s.events.some(e=>e.port===g(3)&&e.label==='RA guard policy drop'));change(s,'ipv6 nd raguard policy ROUTER-PORT','no match ra prefix-list');assert.equal(renew(s).status,'success');assert.equal(ping(s),3);
});
test('reset removes only automatically learned IPv6 state, preserving manual IPv6/IPv4 addresses and explicit routes',()=>{
 const s=load('practice'),pc=d(s,'PC1'),c=pc.config.interfaces[p];c.ip='192.0.2.10';c.mask='255.255.255.0';c.ipv6.push('2001:db8:99::77/128');const manual={network:'2001:db8:88::',prefix:64,nextHop:'fe80::1',interface:p,ad:1,metric:0};pc.config.staticRoutes.push(manual);run(new IOSSession(s,id('SW1')),...COMMANDS.SW1);const r=s.restartIPv6Autoconfig(pc.id,p);assert.ok(c.ipv6.includes('2001:db8:99::77/128'));assert.ok(!c.ipv6.some(a=>prefixContains('2001:db8:bad::',64,a.split('/')[0])));assert.ok(pc.config.staticRoutes.includes(manual));assert.equal(c.ip,'192.0.2.10');assert.equal(c.mask,'255.255.255.0');s.advance(2200);assert.equal(r.status,'success');assert.ok(pc.config.staticRoutes.includes(manual));assert.equal(goal(s,'pc1-slaac'),true);
});
test('repeated resets cancel old pending DAD/configuration and invalid source interfaces do not mutate configuration',()=>{
 const s=load(),a=s.restartIPv6Autoconfig(id('PC1'),p),b=s.restartIPv6Autoconfig(id('PC1'),p);assert.equal(a.status,'failure');s.advance(2200);assert.equal(b.status,'success');assert.equal(bad(s),false);const before=JSON.stringify(d(s,'PC1').config);assert.equal(s.restartIPv6Autoconfig(id('PC1'),'missing').status,'failure');assert.equal(JSON.stringify(d(s,'PC1').config),before);assert.equal(s.restartIPv6Autoconfig(id('R1'),rp).status,'failure');d(s,'PC1').config.interfaces[p].adminUp=false;assert.equal(s.restartIPv6Autoconfig(id('PC1'),p).status,'failure');
});
test('Router Solicitation, DAD and NDP remain functional while host-originated RAs are blocked, and both clients route to SRV1',()=>{
 const s=load();finish(s);assert.ok(s.events.some(e=>e.nodeId===id('R1')&&e.label==='Frame received'&&e.packet?.messageType==='rs'));assert.equal(goal(s,'neighbor-discovery'),true);for(const n of ['PC1','PC2']){const entry=d(s,n).runtime.arp[p+'|fe80::1'];assert.equal(entry.mac,s.macOf(id('R1'),rp));assert.ok(entry.expires>s.clock.now());assert.ok(s.events.some(e=>e.nodeId===id(n)&&e.packet?.protocol==='NDP'&&e.packet?.arpOperation==='reply'&&e.packet?.source==='fe80::1'));}const web=s.httpRequest(id('PC1'),'http://[2001:db8:20::10]/');s.advance(10000);assert.equal(web.statusCode,200);assert.match(web.body,/protected IPv6 forwarding/);
});
test('a disconnected rogue, counters or unrelated drops cannot fabricate the required rogue ingress observation',()=>{
 const s=load('practice');s.disconnect(s.linkAt(id('ROGUE'),rp)!.id);run(new IOSSession(s,id('SW1')),...COMMANDS.SW1);renew(s);d(s,'SW1').runtime.features.raGuardDrops=999;assert.equal(goal(s,'rogue-drop'),false);s.emit({nodeId:id('SW1'),port:g(4),protocol:'ICMPV6',label:'RA guard drop',detail:'Unrelated',disposition:'drop'});assert.equal(goal(s,'rogue-drop'),false);const other=load(),c=row(other,'rogue-drop').objective.criterion;assert.equal(matches(other,c),true);for(const r of d(other,'SW1').runtime.features.raGuardEvents)r.frameId='unrelated';assert.equal(matches(other,c),false);
});
test('manually assigned correct addresses, missing SLAAC leases or wrong gateway/neighbor data cannot replace actual live proof',()=>{
 const s=load();finish(s);const client=row(s,'pc1-slaac').objective.criterion,pc=d(s,'PC1'),port=pc.config.interfaces[p];port.features.ipv6Autoconfig=false;assert.equal(matches(s,client),false);port.features.ipv6Autoconfig=true;const gateway=pc.runtime.features.ipv6DefaultRouters[p];gateway.address='fe80::bad';assert.equal(matches(s,client),false);gateway.address='fe80::1';const leases=pc.runtime.features.slaacLeases;pc.runtime.features.slaacLeases={};assert.equal(matches(s,client),false);pc.runtime.features.slaacLeases=leases;const neighbor=pc.runtime.arp[p+'|fe80::1'];neighbor.mac='00:00:00:00:00:00';assert.equal(goal(s,'neighbor-discovery'),false);neighbor.mac=s.macOf(id('R1'),rp);assert.equal(goal(s,'neighbor-discovery'),true);
});
test('RA default-router lifetime expires when the legitimate advertiser stops; retained addresses alone do not count as valid configuration',()=>{
 const s=load();d(s,'R1').config.interfaces[rp].features.ipv6Nd.suppressRa=true;s.changed();s.advance(62000);assert.equal(goal(s,'pc1-slaac'),false);assert.equal(goal(s,'protected-gateway'),false);assert.equal(d(s,'PC1').runtime.features.ipv6DefaultRouters[p],undefined);assert.ok(d(s,'PC1').config.interfaces[p].ipv6.length>0);d(s,'R1').config.interfaces[rp].features.ipv6Nd.suppressRa=false;s.changed();assert.equal(renew(s).status,'success');assert.equal(goal(s,'pc1-slaac'),true);
});
test('IOS policy inventory, all published verification commands and portable reopening expose actual policy and traffic state',()=>{
 const s=load();finish(s);const c=cli(s),text=c.execute('show ipv6 nd raguard policy HOST-PORTS').join('\n');assert.match(text,/Policy HOST-PORTS configuration:/);assert.match(text,/device-role host/);for(const n of [1,2,4])assert.match(text,new RegExp('Gi0/'+n+'\\s+vlan all'));assert.doesNotMatch(text,/Gi0\/3/);assert.ok(c.execute('show ipv6 nd raguard policy missing').some(iosRejected));assert.ok(c.execute('show ipv6 nd raguard policy HOST-PORTS extra').some(iosRejected));for(const[n,commands]of Object.entries(catalogGuideResources('ipv6-ra-guard')!.verification))run(cli(s,n),...commands);const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(s.serialize())));assert.equal(lessonProgress(restored)!.complete,8);assert.equal(d(restored,'SW1').runtime.features.raGuardEvents,undefined);restored.advance(2200);assert.equal(lessonProgress(restored)!.complete,12);
});
test('RA-drop telemetry retains at most one thousand actual ingress decisions and never alters the dropped advertisement',()=>{
 const s=load(),source=s.linkLocalAddress(id('ROGUE'),rp),frame:Frame={id:'bounded',sourceMac:s.macOf(id('ROGUE'),rp),destinationMac:'33:33:00:00:00:01',hops:64,payload:{kind:'link-control',protocol:'ICMPV6',body:{type:'ra',source,lifetime:60,prefixes:[{network:'2001:db8:bad::',prefix:64}]}}};const payload=structuredClone(frame.payload);d(s,'SW1').runtime.features.raGuardEvents=[];for(let i=0;i<1005;i++){frame.id='bounded-'+i;assert.equal(inspectIngress(s,d(s,'SW1'),g(4),10,frame),false);}assert.deepEqual(frame.payload,payload);assert.equal(d(s,'SW1').runtime.features.raGuardEvents.length,1000);assert.equal(d(s,'SW1').runtime.features.raGuardEvents[0].frameId,'bounded-5');
});
test('imported IPv6 policy, source, prefix and action criteria remain bounded and declarative',()=>{
 const s=load(),obj=row(s,'pc1-slaac').objective;validateLesson({title:'RA',description:'',objectives:[obj]});const c=obj.criterion as any;for(const bad of [{...c,network:'192.0.2.0'},{...c,prefix:129},{...c,rogueNetwork:'not-ipv6'},{...c,router:()=>true},{kind:'ra-attachment',device:id('SW1'),policy:'HOST-PORTS',role:'host',interfaces:[]},{kind:'ra-policy',device:id('SW1'),policy:'HOST-PORTS',role:'monitor'}])assert.throws(()=>validateLesson({title:'RA',description:'',objectives:[{...obj,criterion:bad}]}));d(s,'PC1').config.interfaces[p].adminUp=false;assert.equal(actionAvailable(s,obj),false);
});
