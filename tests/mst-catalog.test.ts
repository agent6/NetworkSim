import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,MST_COMMANDS as COMMANDS,catalogGuideResources,LAB_CATALOG,type CatalogLab} from '../src/lab-catalog.ts';
import {actionAvailable,lessonProgress,matches,validateLesson,type Criterion} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {stpRegion} from '../src/stp-ports.ts';
import {stpPacketSummary} from '../src/stp-packet.ts';
import {packetGroups} from '../src/packet-view.ts';
const slug='multiple-spanning-tree',id=(n:string)=>'device-mst-'+n.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(12000);return s;}
const d=(s:Simulator,n:string)=>s.getDevice(id(n))!;
const row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!;
function cli(s:Simulator,n:string){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,...lines:string[]){run(cli(s,n),'conf t',...lines,'end');s.advance(12000);}
function configure(s:Simulator,save=true){for(const[n,lines]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...lines.filter(l=>save||l!=='write memory'));s.advance(12000);}
function ping(s:Simulator,n:string,address:string){const p=s.ping(id(n),address,{count:3});s.advance(5000);lessonProgress(s);return p.received;}
function pairs(s:Simulator){for(const[v,n]of [[10,1],[20,3],[30,5]])assert.equal(ping(s,'PC'+n,`192.168.${v}.12`),3);}
function failure(s:Simulator,failed:23|24){const time=s.clock.now(),vlan=failed===23?10:30,survivor=failed===23?24:23;run(cli(s,'SW3'),'conf t','interface '+g(failed),'shutdown','end');s.advance(1000);assert.equal(row(s,'fail-gi'+failed).complete,false);const promoted=s.events.find(e=>e.time>=time&&e.nodeId===id('SW3')&&e.label===g(survivor)+' forwarding'&&e.detail.startsWith('VLAN '+vlan+': root port'));assert.ok(promoted);assert.ok(promoted.time-time<3000);assert.equal(actionAvailable(s,row(s,'fail-gi'+failed).objective),true);assert.equal(ping(s,failed===23?'PC1':'PC5',`192.168.${vlan}.12`),3);assert.equal(row(s,'fail-gi'+failed).complete,true);pairs(s);change(s,'SW3','interface '+g(failed),'no shutdown');pairs(s);}
function finish(s:Simulator){pairs(s);assert.equal(lessonProgress(s)!.complete,14);failure(s,23);assert.equal(lessonProgress(s)!.complete,15);failure(s,24);assert.equal(lessonProgress(s)!.complete,16);}

test('ENCOR Layer 2 has five labs and a portable independent nine-node sixteen-task MST practice',()=>{
 assert.deepEqual(LAB_CATALOG.filter(e=>e.group==='CCNP ENCOR'&&e.section==='Layer 2').map(e=>e.id),['802-1q-trunk-troubleshooting','etherchannel-troubleshooting','rapid-spanning-tree-protocol',slug,'stp-root-guard']);const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);a.lab.devices[0].config.vlans[10].name='changed';assert.equal(b.lab.devices[0].config.vlans[10].name,'VLAN10');const s=load('practice');validateLesson((s.lab as CatalogLab).lesson);assert.equal(s.lab.devices.length,9);assert.equal(s.lab.links.length,9);assert.equal(lessonProgress(s)!.rows.length,16);assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,3);assert.equal(ping(s,'PC1','192.168.10.12'),0);
});
test('published IOS commands commit one region, elect saved instance roots and deliver all normal and failure tasks',()=>{
 const s=load('practice');configure(s);assert.equal(lessonProgress(s)!.complete,10);for(const n of ['SW1','SW2','SW3']){assert.deepEqual(d(s,n).config,d(s,n).startupConfig);assert.equal(d(s,n).config.features.stp.pathcostMethod,'long');}finish(s);
});
test('completed reference contains ten live goals with empty runtime and no fabricated packets, failures or MAC learning',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(node.config,node.startupConfig);}const s=load();assert.equal(lessonProgress(s)!.complete,10);finish(s);
});
test('region changes stay pending until exit; abort discards them and current/pending displays remain distinct',()=>{
 const s=load(),c=cli(s,'SW3');run(c,'conf t','spanning-tree mst configuration','revision 11');assert.match(c.execute('show pending').join('\n'),/Revision 11/);assert.match(c.execute('show current').join('\n'),/Revision 10/);assert.equal(d(s,'SW3').config.features.stp.mst.revision,10);assert.equal(row(s,'region').complete,true);run(c,'abort','end');assert.equal(d(s,'SW3').config.features.stp.mst.revision,10);run(c,'conf t','spanning-tree mst configuration','revision 11','exit','end');s.advance(12000);assert.equal(row(s,'region').complete,false);assert.equal(d(s,'SW3').config.features.stp.mst.revision,11);
});
test('region membership compares name, revision and complete mapping, including a VLAN without a lab endpoint',()=>{
 const s=load();for(const lines of [['name WRONG'],['revision 11'],['instance 2 vlan 4094']]){change(s,'SW3','spanning-tree mst configuration',...lines,'exit');assert.equal(row(s,'region').complete,false);assert.notEqual(stpRegion(d(s,'SW1')),stpRegion(d(s,'SW3')));assert.ok(d(s,'SW3').runtime.stp[10].boundary);assert.equal(row(s,'elections').complete,false);if(lines[0].includes('4094'))change(s,'SW3','spanning-tree mst configuration','no instance 2','instance 2 vlan 30','exit');configure(s);assert.equal(row(s,'region').complete,true);assert.equal(row(s,'elections').complete,true);}
});
test('VLAN10 and20 share instance1 root, root port, cost and actual traffic path while remaining separate VLANs',()=>{
 const s=load();pairs(s);for(const n of ['SW1','SW2','SW3']){const sw=d(s,n),a=sw.runtime.stp[10],b=sw.runtime.stp[20];assert.equal(a.rootId,id('SW1'));assert.equal(b.rootId,a.rootId);assert.equal(a.rootPort,b.rootPort);assert.equal(a.cost,b.cost);assert.equal(a.rootBridgeId,b.rootBridgeId);}assert.equal(d(s,'SW3').runtime.stp[10].rootPort,g(23));assert.equal(d(s,'SW3').runtime.stp[30].rootPort,g(24));assert.equal(ping(s,'PC1','192.168.20.12'),0);assert.equal(ping(s,'PC3','192.168.30.12'),0);
});
test('MST0 covers active unmapped VLAN1 and99 and priorities use instance IDs rather than VLAN IDs',()=>{
 const s=load();for(const n of ['SW1','SW2','SW3'])for(const v of [1,99])assert.equal(d(s,n).runtime.stp[v].rootId,id('SW1'));assert.equal(d(s,'SW3').runtime.stp[10].rootBridgeId.split('.')[0],'024577');assert.equal(d(s,'SW3').runtime.stp[20].rootBridgeId.split('.')[0],'024577');assert.equal(d(s,'SW3').runtime.stp[30].rootBridgeId.split('.')[0],'024578');assert.equal(d(s,'SW3').runtime.stp[99].rootBridgeId.split('.')[0],'024576');assert.equal(d(s,'SW3').runtime.stp[10].cost,20000);assert.match(cli(s,'SW3').execute('show spanning-tree mst configuration').join('\n'),/0\s+1-9,11-19,21-29,31-4094/);
});
test('configuration alone cannot prove received instance trees when MST BPDUs are dropped',()=>{
 const s=new Simulator(),send=s.sendLinkControl.bind(s);let drop=true;s.sendLinkControl=(device,port,message)=>{if(drop&&message.protocol==='STP')return;send(device,port,message);};s.load(createCatalogLab(slug,'completed'));s.advance(12000);assert.equal(row(s,'region').complete,true);assert.equal(row(s,'mst-mode').complete,true);assert.equal(row(s,'elections').complete,false);assert.equal(row(s,'roles').complete,false);drop=false;s.advance(12000);assert.equal(row(s,'elections').complete,true);pairs(s);
});
test('edge behavior belongs only on PC ports and half-duplex cannot satisfy point-to-point instance roles',()=>{
 const s=load();for(const[n,p,v]of [['SW1',1,30],['SW2',1,10],['SW2',2,20],['SW3',1,10],['SW3',2,20],['SW3',3,30]] as const)assert.equal(d(s,n).runtime.stp[v].ports[g(p)].edge,true);change(s,'SW3','interface gi0/23','spanning-tree portfast trunk');assert.equal(row(s,'trunks').complete,false);configure(s);change(s,'SW3','interface gi0/23','speed 100','duplex half');assert.equal(row(s,'roles').complete,false);configure(s);assert.equal(row(s,'roles').complete,true);
});
test('each direct uplink failure promotes the alternate rapidly and carries all three VLAN pairs over the survivor',()=>{
 const s=load();pairs(s);failure(s,23);failure(s,24);assert.equal(lessonProgress(s)!.complete,16);
});
test('both source uplinks down isolate all pairs; core-link failure keeps received roots and working alternate traffic',()=>{
 const s=load();change(s,'SW3','interface range gi0/23 - 24','shutdown');for(const[v,n]of [[10,1],[20,3],[30,5]])assert.equal(ping(s,'PC'+n,`192.168.${v}.12`),0);configure(s);change(s,'SW1','interface gi0/24','shutdown');assert.equal(row(s,'elections').complete,true);assert.equal(row(s,'roles').complete,false);pairs(s);assert.equal(matches(s,row(s,'vlan10-ping').objective.criterion),false);
});
test('MST1 priority changes move both grouped VLAN roots together without changing MST0 or MST2 roots',()=>{
 const s=load();change(s,'SW1','spanning-tree mst 1 priority 61440');for(const v of [10,20])assert.equal(d(s,'SW3').runtime.stp[v].rootId,id('SW2'));assert.equal(d(s,'SW3').runtime.stp[99].rootId,id('SW1'));assert.equal(d(s,'SW3').runtime.stp[30].rootId,id('SW2'));assert.equal(row(s,'priority-1').complete,false);pairs(s);configure(s);assert.equal(row(s,'elections').complete,true);
});
test('a mismatched region cannot earn matching-instance traffic credit even if a conservative boundary path forwards',()=>{
 const s=load();pairs(s);change(s,'SW3','spanning-tree mst configuration','revision 11','exit');const out=cli(s,'SW3').execute('show spanning-tree mst interface gi0/24').join('\n');assert.match(out,/boundary/i);assert.equal(matches(s,row(s,'vlan10-ping').objective.criterion),false);assert.equal(matches(s,row(s,'vlan20-ping').objective.criterion),false);configure(s);pairs(s);assert.equal(matches(s,row(s,'vlan10-ping').objective.criterion),true);
});
test('classic-mode packets and later MST BPDUs cannot retroactively satisfy a matching-region MST path',()=>{
 const doc=createCatalogLab(slug,'completed');for(const sw of doc.lab.devices.filter(d=>d.kind==='switch'))sw.config.features.stp.mode='pvst';const s=new Simulator();s.load(doc);s.advance(35000);pairs(s);assert.equal(row(s,'mst-mode').complete,false);assert.equal(row(s,'vlan10-ping').complete,false);configure(s);for(const n of ['SW1','SW2','SW3'])run(cli(s,n),'clear spanning-tree detected-protocols');s.advance(12000);assert.equal(row(s,'vlan10-ping').complete,false);pairs(s);assert.equal(row(s,'vlan10-ping').complete,true);
});
test('wrong packet identities, missing transit hops, wrong tags, recorded regions or instances invalidate fresh path matches',()=>{
 const s=load();pairs(s);const c=row(s,'vlan10-ping').objective.criterion,events=structuredClone(s.events);for(const e of s.events)if(e.label==='Echo reply received'&&e.packet)e.packet.parentId='unrelated';assert.equal(matches(s,c),false);s.events.splice(0,s.events.length,...structuredClone(events));s.events.splice(0,s.events.length,...s.events.filter(e=>!(e.nodeId===id('SW1')&&e.port===g(24)&&e.label==='Frame sent'&&e.packet?.protocol==='ICMP')));assert.equal(matches(s,c),false);s.events.splice(0,s.events.length,...structuredClone(events));for(const e of s.events)for(const b of e.packet?.stpBpdus??[])b.region='wrong';assert.equal(matches(s,c),false);s.events.splice(0,s.events.length,...structuredClone(events));for(const e of s.events)for(const b of e.packet?.stpBpdus??[])b.instance=2;assert.equal(matches(s,c),false);s.events.splice(0,s.events.length,...structuredClone(events));for(const e of s.events)if(e.nodeId===id('SW1')&&e.packet?.protocol==='ICMP')e.packet.vlan=30;assert.equal(matches(s,c),false);
});
test('MST packet inspection shows version3 region and instance fields while hiding the internal serialized region tuple',()=>{
 const s=load();const packet=s.events.find(e=>e.label==='Frame received'&&e.nodeId===id('SW3')&&e.packet?.stpBpdus?.some(b=>b.mode==='mst'))!.packet!;for(const b of packet.stpBpdus!){assert.equal(b.mode,'mst');assert.equal(b.version,3);assert.equal(b.regionName,'ENCOR-MST');assert.equal(b.revision,10);assert.equal(b.instance,b.vlan===10||b.vlan===20?1:b.vlan===30?2:0);}const groups=packetGroups(packet).filter(g=>g.title.startsWith('Spanning tree'));assert.ok(groups.every(g=>g.title.includes('MST')));assert.ok(groups.some(g=>g.fields.some(([k])=>k==='regionName')));assert.ok(groups.every(g=>!g.fields.some(([k])=>k==='region')));
});
test('region comparison is independent of instance-list and VLAN-list ordering and root priorities are locally significant',()=>{
 const s=load();d(s,'SW3').config.features.stp.mst.instances.reverse();d(s,'SW3').config.features.stp.mst.instances.find((i:any)=>i.id===1).vlans.reverse();s.changed();s.advance(12000);assert.equal(row(s,'region').complete,true);assert.equal(stpRegion(d(s,'SW1')),stpRegion(d(s,'SW3')));assert.notDeepEqual(d(s,'SW1').config.features.stp.mst.priorities,d(s,'SW2').config.features.stp.mst.priorities);assert.equal(row(s,'elections').complete,true);
});
test('nine dynamic MAC checks require access learning and the restored MST1/MST2 root paths, then clear or expire live',()=>{
 const s=load();pairs(s);assert.equal(row(s,'mac-learning').complete,true);for(const[v,n,p]of [[10,2,23],[20,4,23],[30,6,24]]){const mac=s.macOf(id('PC'+n),'GigabitEthernet0');assert.equal(d(s,'SW3').runtime.mac[v+'|'+mac].port,g(p));}run(cli(s,'SW3'),'clear mac address-table dynamic');assert.equal(row(s,'mac-learning').complete,false);pairs(s);for(const entry of Object.values(d(s,'SW3').runtime.mac))entry.expires=s.clock.now()-1;assert.equal(row(s,'mac-learning').complete,false);
});
test('healthy configuration must be saved and IOS reload restores an unsaved region revision fault',()=>{
 const s=load('practice');configure(s,false);assert.equal(row(s,'saved').complete,false);for(const n of ['SW1','SW2','SW3'])run(cli(s,n),'write memory');assert.equal(row(s,'saved').complete,true);change(s,'SW3','spanning-tree mst configuration','revision 11','exit');assert.equal(row(s,'saved').complete,false);s.reloadIOS(id('SW3'));s.advance(24000);assert.equal(row(s,'region').complete,true);assert.equal(row(s,'saved').complete,true);pairs(s);
});
test('offline reopening retains achievements and saved policy but rebuilds BPDUs and demands fresh dynamic MAC learning',()=>{
 const s=load();finish(s);d(s,'PC1').config.hostname='Student PC';const fresh=new Simulator();fresh.load(parseLabFile(serializeLabFile(s.serialize())));fresh.advance(12000);assert.equal((fresh.lab as CatalogLab).catalogId,slug);assert.equal(lessonProgress(fresh)!.complete,15);assert.equal(row(fresh,'mac-learning').complete,false);pairs(fresh);assert.equal(lessonProgress(fresh)!.complete,16);
});
test('all advertised IOS and Windows verification commands expose committed mapping, instance priorities, roles and long costs',()=>{
 const s=load();pairs(s);const resources=catalogGuideResources(slug)!;for(const[n,lines]of Object.entries(resources.verification))for(const line of lines){const out=cli(s,n).execute(line).join('\n');assert.doesNotMatch(out,/% (Invalid|Incomplete)|not implemented|not recognized/);if(line==='show spanning-tree mst configuration'){assert.match(out,/Name\s+\[ENCOR-MST\]/);assert.match(out,/Revision\s+10/);assert.match(out,/1\s+10,20/);assert.match(out,/2\s+30/);}if(line==='show spanning-tree mst 1'){assert.match(out,/MST1\s+vlans mapped:\s+10,20/);if(n==='SW3'){assert.match(out,/Gi0\/23\s+Root\s+FWD\s+20000/);assert.match(out,/Gi0\/24\s+Altn\s+BLK/);assert.match(out,/24577\s+\(24576 sysid 1\)/);}}if(line==='show spanning-tree mst 2'&&n==='SW3')assert.match(out,/Gi0\/24\s+Root\s+FWD/);if(line==='show spanning-tree pathcost method')assert.match(out,/long/);if(line.startsWith('ping'))assert.match(out,/Received = 3/);}for(const r of resources.rows)assert.equal(r.length,resources.columns.length);
});
test('imported MST criteria reject ambiguous mappings and invalid bounds and missing targets or ports fail closed',()=>{
 const s=load(),lesson=(s.lab as CatalogLab).lesson!,region:Record<string,unknown>={kind:'mst-region',device:id('SW1'),name:'ENCOR-MST',revision:10,instances:[{id:1,vlans:[10,20]},{id:2,vlans:[30]}]},tree:Record<string,unknown>={kind:'mst-tree',device:id('SW3'),instance:1,vlans:[10,20],root:id('SW1')};const invalid:unknown[]=[{...region,name:'x'.repeat(33)},{...region,revision:65536},{...region,instances:[]},{...region,instances:[{id:1,vlans:[10]},{id:2,vlans:[10]}]},{...region,instances:[{id:1,vlans:[10]},{id:1,vlans:[20]}]},{...tree,instance:4095},{...tree,vlans:[0]},{...tree,ports:[{name:g(23),role:'invented',state:'forwarding'}]},{kind:'mst-priority',device:id('SW1'),instance:1,priority:7},{kind:'rstp-edge',protocol:'invented',device:id('SW1'),interface:g(1),vlan:30}];for(const criterion of invalid)assert.throws(()=>validateLesson({...lesson,objectives:[{id:'x',title:'x',criterion}]}),/invalid/);assert.equal(matches(s,{...tree,root:'missing'} as Criterion),false);assert.equal(matches(s,{...tree,ports:[{name:'missing',role:'root',state:'forwarding'}]} as Criterion),false);
});
test('STP summaries tolerate malformed envelopes and retain send-time region data rather than later configuration',()=>{
 assert.deepEqual(stpPacketSummary(null),[]);assert.deepEqual(stpPacketSummary({vlans:[null,7]}),[]);const bad=stpPacketSummary({vlans:[{mode:'mst',vlan:'10',region:'invalid'}]});assert.equal(bad[0].version,3);assert.equal(bad[0].regionName,undefined);const payload={vlans:[{mode:'mst',vlan:'20',region:'["ENCOR-MST",10,[[1,[10,20]],[2,[30]]]]',rootBridgeId:'r',bridgeId:'b',cost:20000,role:'root',agreement:'accepted'}]};const summary=stpPacketSummary(payload);payload.vlans[0].region='["OTHER",11,[]]';assert.equal(summary[0].regionName,'ENCOR-MST');assert.equal(summary[0].instance,1);assert.equal(summary[0].agreement,true);
});
