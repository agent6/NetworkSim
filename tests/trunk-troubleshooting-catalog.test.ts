import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,TRUNK_TROUBLESHOOTING_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG,catalogSections,type CatalogLab} from '../src/lab-catalog.ts';
import {actionAvailable,lessonProgress,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
const slug='802-1q-trunk-troubleshooting',id=(n:string)=>'device-ett-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(5000);return s;}
const row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!;
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!;
function cli(s:Simulator,n:string){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,...lines:string[]){run(cli(s,n),'conf t',...lines,'end');s.advance(5000);}
function configure(s:Simulator,save=true){for(const[n,lines]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...lines.filter(l=>save||l!=='write memory'));s.advance(5000);}
function ping(s:Simulator,n:string,address:string){const p=s.ping(id(n),address,{count:3});s.advance(5000);lessonProgress(s);return p.received;}
function pairs(s:Simulator){for(const[vlan,n]of [[10,1],[20,3],[99,5]])assert.equal(ping(s,'PC'+n,`192.168.${vlan}.12`),3);}

test('ENCOR Layer 2 has six labs and an independent nine-node trunk troubleshooting lab, beside three Virtualization labs',()=>{
 assert.deepEqual(catalogSections('CCNP ENCOR'),['Virtualization','Layer 2']);const entries=LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR');assert.equal(entries.length,9);assert.equal(entries.filter(e=>e.section==='Virtualization').length,3);assert.deepEqual(entries.filter(e=>e.section==='Layer 2').map(e=>e.id),[slug,'etherchannel-troubleshooting','rapid-spanning-tree-protocol','multiple-spanning-tree','stp-root-guard','stp-bpdu-guard']);const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.vlans[99].active=false;assert.equal(b.lab.devices[0].config.vlans[99].active,true);const s=load('practice');validateLesson((s.lab as CatalogLab).lesson);assert.equal(s.lab.devices.length,9);assert.equal(s.lab.links.length,8);assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,12);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,3);for(const n of ['PC1','PC3','PC5'])assert.equal(ping(s,n,`192.168.${n==='PC1'?10:n==='PC3'?20:99}.12`),0);
});
test('the six prepared faults are present and all other addressing/access settings remain ready',()=>{
 const s=load('practice');assert.equal(d(s,'SW1').config.interfaces[g(24)].adminUp,false);for(const[n,p]of [['SW1',24],['SW2',23]] as const){assert.equal(d(s,n).config.interfaces[g(p)].mode,'dynamic-auto');assert.equal(d(s,n).config.interfaces[g(p)].features.nonegotiate,false);}assert.deepEqual(d(s,'SW2').config.interfaces[g(24)].allowedVlans,[10,99]);assert.equal(d(s,'SW3').config.interfaces[g(24)].nativeVlan,1);assert.equal(d(s,'SW3').config.vlans[99].active,false);assert.equal(d(s,'SW3').config.interfaces[g(1)].vlan,20);for(const pc of s.lab.devices.filter(d=>d.kind==='pc')){assert.equal(pc.config.defaultGateway,undefined);assert.equal(pc.config.interfaces.GigabitEthernet0.features.dhcp,false);}
});
test('published IOS repairs earn eight live tasks; delivered VLAN pairs and twelve dynamic MACs earn all twelve',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,8);assert.equal(ping(s,'PC1','192.168.10.12'),3);assert.equal(lessonProgress(s)!.complete,9);assert.equal(ping(s,'PC3','192.168.20.12'),3);assert.equal(lessonProgress(s)!.complete,10);assert.equal(ping(s,'PC5','192.168.99.12'),3);assert.equal(lessonProgress(s)!.complete,12);for(const n of ['SW1','SW2','SW3'])assert.deepEqual(d(s,n).config,d(s,n).startupConfig);
});
test('completed reference has saved repairs with empty runtime and no fabricated traffic or MAC learning',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(node.config,node.startupConfig);}const s=load();assert.equal(lessonProgress(s)!.complete,8);pairs(s);assert.equal(lessonProgress(s)!.complete,12);
});
test('auto/auto fails negotiation even after shutdown is repaired; static trunk repairs restore actual delivery',()=>{
 const s=load();for(const[n,p]of [['SW1',24],['SW2',23]] as const)change(s,n,'interface '+g(p),'no switchport nonegotiate','switchport mode dynamic auto');assert.equal(row(s,'static-trunks').complete,false);assert.equal(ping(s,'PC1','192.168.10.12'),0);configure(s);pairs(s);
});
test('allowed VLAN pruning blocks VLAN20 alone and exact policy rejects all/extra VLANs',()=>{
 const s=load();change(s,'SW2','interface '+g(24),'switchport trunk allowed vlan remove 20');assert.equal(row(s,'allowed').complete,false);assert.equal(ping(s,'PC3','192.168.20.12'),0);assert.equal(ping(s,'PC1','192.168.10.12'),3);assert.equal(ping(s,'PC5','192.168.99.12'),3);for(const v of ['all','10,20,99,100']){change(s,'SW2','interface '+g(24),'switchport trunk allowed vlan '+v);assert.equal(row(s,'allowed').complete,false);}configure(s);pairs(s);
});
test('native mismatch and suspended VLAN99 block native traffic and recover independently',()=>{
 const s=load();change(s,'SW3','interface '+g(24),'switchport trunk native vlan 1');assert.equal(row(s,'native').complete,false);assert.equal(ping(s,'PC5','192.168.99.12'),0);assert.equal(ping(s,'PC1','192.168.10.12'),3);configure(s);change(s,'SW3','vlan 99','state suspend');assert.equal(row(s,'active-vlans').complete,false);assert.equal(ping(s,'PC5','192.168.99.12'),0);assert.equal(ping(s,'PC3','192.168.20.12'),3);configure(s);pairs(s);
});
test('wrong access membership breaks VLAN10 while other VLANs pass; shutdown and cable loss interrupt all traffic',()=>{
 const s=load();change(s,'SW3','interface '+g(1),'switchport access vlan 20');assert.equal(row(s,'access').complete,false);assert.equal(ping(s,'PC1','192.168.10.12'),0);assert.equal(ping(s,'PC3','192.168.20.12'),3);configure(s);change(s,'SW1','interface '+g(24),'shutdown');assert.equal(row(s,'enabled').complete,false);assert.equal(row(s,'forwarding').complete,false);assert.equal(ping(s,'PC1','192.168.10.12'),0);configure(s);s.lab.links.find(l=>l.id==='link-ett-b')!.enabled=false;s.changed();assert.equal(ping(s,'PC3','192.168.20.12'),0);assert.equal(row(s,'forwarding').complete,false);
});
test('all four trunk endpoints use normal per-VLAN STP; PortFast shortcut loses config and forwarding tasks',()=>{
 const s=load();for(const[n,ports]of [['SW1',[24]],['SW2',[23,24]],['SW3',[24]]] as const)for(const p of ports)for(const v of [10,20,99])assert.equal(d(s,n).runtime.stp[v].ports[g(p)].state,'forwarding');change(s,'SW2','interface '+g(23),'spanning-tree portfast trunk');assert.equal(row(s,'static-trunks').complete,false);assert.equal(row(s,'forwarding').complete,false);configure(s);assert.equal(row(s,'forwarding').complete,true);
});
test('traffic credit correlates request/reply packet identities and actual tags across both hops',()=>{
 for(const[vlan,n]of [[10,1],[20,3],[99,5]]){const s=load();assert.equal(ping(s,'PC'+n,`192.168.${vlan}.12`),3);const criterion=row(s,'vlan'+vlan+'-ping').objective.criterion;assert.equal(matches(s,criterion),true);const frames=s.events.filter(e=>e.label==='Frame sent'&&e.packet?.protocol==='ICMP'&&e.nodeId.startsWith('device-ett-sw'));assert.ok(frames.length);for(const e of frames.filter(e=>e.port===g(23)||e.port===g(24)))assert.equal(e.packet!.vlan,vlan===99?undefined:vlan);const removed=s.events.filter(e=>e.nodeId===id('SW2')&&e.port===g(24));s.events.splice(0,s.events.length,...s.events.filter(e=>!removed.includes(e)));assert.equal(matches(s,criterion),false,'reply alone cannot prove missing transit hop');}
});
test('tag forgery, wrong destination, unrelated replies and reverse-path gaps cannot satisfy new packet predicates',()=>{
 const s=load();pairs(s);const criterion=row(s,'vlan10-ping').objective.criterion;const originals=structuredClone(s.events);for(const e of s.events)if(e.nodeId===id('SW2')&&e.port===g(24)&&e.packet)e.packet.vlan=20;assert.equal(matches(s,criterion),false);s.events.splice(0,s.events.length,...structuredClone(originals));for(const e of s.events)if(e.label==='Echo reply received'&&e.packet)e.packet.parentId='unrelated';assert.equal(matches(s,criterion),false);s.events.splice(0,s.events.length,...structuredClone(originals));assert.equal(matches(s,{...criterion,target:id('PC4')} as Criterion),false);s.events.splice(0,s.events.length,...originals.filter(e=>!(e.nodeId===id('SW2')&&e.port===g(23)&&e.label==='Frame sent'&&e.packet?.protocol==='ICMP')));assert.equal(matches(s,criterion),false);
});
test('twelve dynamic MAC entries are VLAN-scoped, live and expire or clear without losing earned traffic',()=>{
 const s=load();pairs(s);assert.equal(row(s,'remote-macs').complete,true);const macs=row(s,'remote-macs').objective.criterion;assert.equal(macs.kind,'all');if(macs.kind!=='all')return;assert.equal(macs.criteria.length,12);run(cli(s,'SW2'),'clear mac address-table dynamic');assert.equal(row(s,'remote-macs').complete,false);assert.equal(row(s,'vlan10-ping').complete,true);pairs(s);assert.equal(row(s,'remote-macs').complete,true);for(const entry of Object.values(d(s,'SW1').runtime.mac))entry.expires=s.clock.now()-1;assert.equal(row(s,'remote-macs').complete,false);
});
test('write memory is required after repairs and live saved-policy credit responds to later changes',()=>{
 const s=load('practice');configure(s,false);assert.equal(lessonProgress(s)!.complete,7);assert.equal(row(s,'saved').complete,false);for(const n of ['SW1','SW2','SW3'])run(cli(s,n),'write memory');assert.equal(row(s,'saved').complete,true);change(s,'SW3','interface '+g(1),'switchport access vlan 20');assert.equal(row(s,'saved').complete,false);configure(s);assert.equal(row(s,'saved').complete,true);
});
test('offline portable roundtrip retains earned packets and config but demands fresh dynamic MAC evidence',()=>{
 const s=load();pairs(s);d(s,'PC1').config.hostname='Student PC';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(s.serialize())));fresh.advance(5000);assert.equal((fresh.lab as CatalogLab).catalogId,slug);assert.equal(lessonProgress(fresh)!.complete,11);assert.equal(row(fresh,'remote-macs').complete,false);pairs(fresh);assert.equal(lessonProgress(fresh)!.complete,12);for(const n of ['SW1','SW2','SW3']){fresh.power(id(n),false);fresh.power(id(n),true);}fresh.advance(5000);pairs(fresh);assert.equal(lessonProgress(fresh)!.complete,12);
});
test('IOS reload restores the saved trunk and removes unsaved VLAN pruning',()=>{const s=load();change(s,'SW2','interface '+g(24),'switchport trunk allowed vlan remove 20');assert.equal(ping(s,'PC3','192.168.20.12'),0);assert.equal(row(s,'saved').complete,false);s.reloadIOS(id('SW2'));s.advance(10000);assert.equal(row(s,'saved').complete,true);pairs(s);assert.equal(lessonProgress(s)!.complete,12);});
test('all advertised show commands work and reflect both active trunks and VLAN/STP/MAC state',()=>{
 const s=load();pairs(s);const resources=catalogGuideResources(slug)!;for(const[n,lines]of Object.entries(resources.verification))for(const line of lines){const out=cli(s,n).execute(line).join('\n');assert.doesNotMatch(out,/% (Invalid|Incomplete)|not implemented|not recognized/);if(line==='show interfaces trunk'){assert.match(out,/Gi0\/24\s+on\s+802.1q\s+trunking\s+99/);assert.match(out,/10,20,99/);if(n==='SW2')assert.match(out,/Gi0\/23\s+on\s+802.1q\s+trunking\s+99/);}}assert.equal(ping(s,'PC1','192.168.20.12'),0);for(const r of resources.rows)assert.equal(r.length,resources.columns.length);
});
test('new imported predicates validate bounded declarative data and missing devices/ports fail closed',()=>{
 const s=load(),lesson=(s.lab as CatalogLab).lesson!,traffic:Record<string,unknown>={...row(s,'vlan10-ping').objective.criterion},saved:Record<string,unknown>={kind:'trunk-saved',device:id('SW1'),interfaces:[g(24)],vlans:[10,20,99]};const invalid:unknown[]=[{...traffic,path:[]},{...traffic,path:Array(9).fill({aDevice:'a',aPort:'p',bDevice:'b',bPort:'p'})},{...traffic,vlan:0},{...traffic,nativeVlan:4095},{...traffic,address:'bad'},{...traffic,path:[null]},{...saved,interfaces:[]},{...saved,interfaces:[g(24),g(24)]},{...saved,vlans:[99,99]},{...saved,vlans:[4095]}];for(const criterion of invalid)assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion}]}),/invalid/);assert.equal(matches(s,{...saved,interfaces:['missing']} as Criterion),false);assert.equal(matches(s,{...traffic,target:'missing'} as Criterion),false);
});
