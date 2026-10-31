import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,VRF_COMMANDS,catalogGuideResources,LAB_CATALOG,catalogSections} from '../src/lab-catalog.ts';
import {actionAvailable,lessonProgress,matches,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {packetGroups} from '../src/packet-view.ts';
const slug='vrf-configuration-and-verification',id=(name:string)=>'device-vrf-'+name.toLowerCase(),g=(n:number)=>'GigabitEthernet0/'+n;
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(1000);return s;}
const d=(s:Simulator,name='R1')=>s.getDevice(id(name))!;
function cli(s:Simulator,name='R1'){const c=new IOSSession(s,id(name));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,...lines:string[]){run(cli(s),'configure terminal',...lines,'end');s.advance(100);}
const row=(s:Simulator,name:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===name)!;
function task(s:Simulator,name:string){const action=row(s,name).objective.action!;assert.equal(action.kind,'ping');if(action.kind!=='ping')throw Error('Wrong action');assert.equal(actionAvailable(s,row(s,name).objective),true);const r=s.ping(action.device,action.target,{count:3,vrf:action.vrf});s.advance(5000);lessonProgress(s);return r;}
function finish(s:Simulator){for(const name of ['pc-blue','pc-red','r1-blue','r1-red'])assert.equal(task(s,name).received,3);assert.equal(task(s,'global-isolation').received,0);assert.equal(lessonProgress(s)!.complete,12);}

test('ENCOR Virtualization has one portable, independent seven-node VRF lab with twelve tasks',()=>{
 assert.deepEqual(catalogSections('CCNP ENCOR'),['Virtualization','Layer 2','Layer 3','IP Services','Network Assurance','Security','Automation']);assert.deepEqual(catalogSections('CCNP ENARSI'),[]);const e=LAB_CATALOG.find(e=>e.id===slug)!;assert.equal(e.group,'CCNP ENCOR');assert.equal(e.section,'Virtualization');const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);assert.equal(a.lab.devices.length,7);assert.equal(a.lab.links.length,6);assert.equal(catalogGuideResources(slug)!.rows.length,12);const s=load('practice');assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,12);assert.ok(lessonProgress(s)!.rows.filter(r=>r.objective.action).every(r=>!actionAvailable(s,r.objective)));assert.equal(s.ping(id('PC-BLUE'),'192.168.20.10',{count:1}).received,0);
});
test('reference provides seven live configuration/save goals without fabricated traffic observations',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(node.startupConfig,node.config);}const s=load();assert.equal(lessonProgress(s)!.complete,7);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,4);assert.equal(actionAvailable(s,row(s,'global-isolation').objective),false);finish(s);
});
test('published IOS commands build working overlapping tables from zero-credit practice',()=>{
 const s=load('practice');run(new IOSSession(s,id('R1')),...VRF_COMMANDS.R1);s.advance(1000);assert.equal(lessonProgress(s)!.complete,7);assert.deepEqual(d(s).runtime.routes.filter(r=>r.network==='192.168.20.0').map(r=>r.vrf).sort(),['BLUE','RED']);finish(s);
});
test('identical server addresses resolve to distinct CEF interfaces and actual server packet identities',()=>{
 const s=load();assert.equal(s.cefLookup(id('R1'),'192.168.20.10','BLUE')?.port,g(2));assert.equal(s.cefLookup(id('R1'),'192.168.20.10','RED')?.port,g(3));assert.equal(s.cefLookup(id('R1'),'192.168.20.10'),undefined);
 for(const vrf of ['BLUE','RED']){const start=s.events.length;assert.equal(task(s,'r1-'+vrf.toLowerCase()).received,3);const events=s.events.slice(start);assert.ok(events.some(e=>e.nodeId===id('SRV-'+vrf)&&e.label==='Echo request accepted'));assert.ok(!events.some(e=>e.nodeId===id('SRV-'+(vrf==='BLUE'?'RED':'BLUE'))&&e.label==='Echo request accepted'));assert.ok(events.some(e=>e.nodeId===id('R1')&&e.label==='Frame sent'&&e.packet?.vrf===vrf));}
});
test('each PC reaches its own overlapping server over HTTP and end-to-end ICMP',()=>{
 const s=load();for(const vrf of ['BLUE','RED']){assert.equal(task(s,'pc-'+vrf.toLowerCase()).received,3);const r=s.httpRequest(id('PC-'+vrf),'http://192.168.20.10/');s.advance(5000);assert.equal(r.statusCode,200);assert.match(r.body!,new RegExp('SRV-'+vrf+': '+vrf+' VRF reached'));}
});
test('removing BLUE static routing breaks only BLUE and fails its current route goal, then repairs',()=>{
 const s=load();change(s,'no ip route vrf BLUE 192.168.20.0 255.255.255.0 10.0.0.2');assert.equal(row(s,'blue-route').complete,false);assert.equal(row(s,'red-route').complete,true);const blue=s.ping(id('PC-BLUE'),'192.168.20.10',{count:1}),red=s.ping(id('PC-RED'),'192.168.20.10',{count:1});s.advance(5000);assert.equal(blue.received,0);assert.equal(red.received,1);change(s,'ip route vrf BLUE 192.168.20.0 255.255.255.0 10.0.0.2');assert.equal(task(s,'pc-blue').received,3);
});
test('a route in the wrong table cannot satisfy either intended route goal',()=>{
 const s=load();change(s,'no ip route vrf BLUE 192.168.20.0 255.255.255.0 10.0.0.2','ip route 192.168.20.0 255.255.255.0 GigabitEthernet0/2');assert.equal(row(s,'blue-route').complete,false);assert.equal(row(s,'global-isolation').complete,false);assert.equal(actionAvailable(s,row(s,'global-isolation').objective),false);
});
test('a wrong interface VRF or address fails live policy and moving a VRF clears the old IPv4 address',()=>{
 const s=load();change(s,'interface '+g(2),'vrf forwarding RED');assert.equal(d(s).config.interfaces[g(2)].ip,undefined);assert.equal(row(s,'blue-ports').complete,false);change(s,'interface '+g(2),'vrf forwarding BLUE','ip address 10.0.0.1 255.255.255.252','no shutdown');assert.equal(row(s,'blue-ports').complete,true);change(s,'interface '+g(2),'ip address 10.0.0.1 255.255.255.0');assert.equal(row(s,'blue-ports').complete,false);
});
test('missing tenant return routing cannot be mistaken for successful end-to-end forwarding',()=>{
 const s=load();run(cli(s,'CE-BLUE'),'configure terminal','no ip route 192.168.10.0 255.255.255.0 10.0.0.1','end');const p=s.ping(id('PC-BLUE'),'192.168.20.10',{count:1});s.advance(5000);assert.equal(p.received,0);assert.equal(row(s,'pc-blue').complete,false);assert.equal(task(s,'pc-red').received,3);
});
test('global isolation needs a real local default-table No route event, not another VRF or outage',()=>{
 const s=load();const wrong=s.ping(id('R1'),'192.168.20.10',{vrf:'MISSING',count:1});s.advance(5000);assert.equal(wrong.received,0);assert.equal(row(s,'global-isolation').complete,false);assert.equal(task(s,'r1-blue').received,3);assert.equal(task(s,'r1-red').received,3);assert.equal(task(s,'global-isolation').received,0);assert.equal(row(s,'global-isolation').complete,true);change(s,'interface Loopback0','ip address 198.51.100.1 255.255.255.255');assert.equal(row(s,'global-isolation').complete,false,'isolation is a live table requirement');
});
test('wrong tenant responses cannot satisfy an R1 VRF-specific probe even with identical IPs',()=>{
 const s=load();assert.equal(task(s,'r1-red').received,3);assert.equal(row(s,'r1-blue').complete,false);const c=row(s,'r1-red').objective.criterion;assert.equal(matches(s,c),true);s.events=s.events.filter(e=>e.packet?.vrf!=='RED');assert.equal(matches(s,c),false);
});
test('show vrf handles object address families and displays actual bindings without mutation',()=>{
 const s=load(),c=cli(s),before=JSON.stringify(d(s));for(const command of ['show vrf','show vrf brief','show ip vrf','show vrf BLUE']){const text=c.execute(command).join('\n');assert.doesNotMatch(text,/TypeError|Invalid|not implemented/);assert.match(text,/BLUE.*ipv4.*Gi0\/0.*Gi0\/2/);}assert.equal(JSON.stringify(d(s)),before);assert.match(c.execute('show vrf detail RED').join('\n'),/GigabitEthernet0\/1.*GigabitEthernet0\/3/);
});
test('all published verification commands execute, report scoped routes and preserve expected negative ping behavior',()=>{
 const s=load();for(const[name,commands]of Object.entries(catalogGuideResources(slug)!.verification)){const c=cli(s,name);run(c,...commands);}const c=cli(s);assert.match(c.execute('show ip route vrf BLUE').join('\n'),/Routing Table: BLUE/);assert.match(c.execute('show ip route vrf RED').join('\n'),/Routing Table: RED/);assert.doesNotMatch(c.execute('show ip route').join('\n'),/192\.168\.20\.0/);
});
test('startup save is separate from running configuration and actual IOS reload restores the saved VRF policy',()=>{
 const s=load('practice');run(new IOSSession(s,id('R1')),...VRF_COMMANDS.R1.filter(l=>l!=='write memory'));s.advance(1000);assert.equal(row(s,'save-vrfs').complete,false);run(cli(s),'write memory');assert.equal(row(s,'save-vrfs').complete,true);change(s,'no ip route vrf BLUE 192.168.20.0 255.255.255.0 10.0.0.2');assert.equal(row(s,'save-vrfs').complete,false);s.reloadIOS(id('R1'));s.advance(8000);assert.equal(row(s,'blue-route').complete,true);assert.equal(row(s,'save-vrfs').complete,true);assert.equal(task(s,'pc-blue').received,3);
});
test('portable saves retain traffic observations, scoped routes, startup and stable IDs after hostname edits',()=>{
 const s=load();finish(s);d(s).config.hostname='Tenant-Edge';const restored=new Simulator();restored.load(parseLabFile(serializeLabFile(s.serialize())));restored.advance(1000);assert.equal(lessonProgress(restored)!.complete,12);assert.equal(task(restored,'r1-blue').received,3);change(restored,'interface '+g(0),'shutdown');assert.equal(row(restored,'blue-ports').complete,false);assert.equal(row(restored,'r1-blue').complete,true);
});
test('VRF criteria and action scopes reject malformed imported data and expose scoped packet fields',()=>{
 const s=load(),objective=structuredClone(row(s,'r1-blue').objective);validateLesson({title:'VRF',description:'',objectives:[objective]});for(const vrf of [42,'',{},'x'.repeat(129)])assert.throws(()=>validateLesson({title:'VRF',description:'',objectives:[{...objective,action:{...objective.action,vrf}}]}));for(const criterion of [{kind:'vrf-definition',device:id('R1'),vrf:''},{kind:'vrf-isolation',device:id('R1'),vrfs:['BLUE','BLUE']},{kind:'vrf-interface',device:id('R1'),vrf:'BLUE',interface:g(0),address:'192.168.10.1',mask:'255.0.255.0'}])assert.throws(()=>validateLesson({title:'VRF',description:'',objectives:[{...objective,criterion}]}));assert.equal(task(s,'r1-blue').received,3);const e=s.events.find(e=>e.nodeId===id('R1')&&e.packet?.vrf==='BLUE')!;assert.ok(packetGroups(e.packet!).find(g=>g.title==='Addresses and forwarding')!.fields.some(([key,value])=>key==='vrf'&&value==='BLUE'));
});

test('a preconfiguration global failure cannot later masquerade as verified working-tenant isolation',()=>{
 const s=load('practice');const early=s.ping(id('R1'),'192.168.20.10',{count:1});s.advance(5000);assert.equal(early.received,0);lessonProgress(s);run(new IOSSession(s,id('R1')),...VRF_COMMANDS.R1);s.advance(100);assert.equal(task(s,'r1-blue').received,3);assert.equal(task(s,'r1-red').received,3);assert.equal(row(s,'global-isolation').complete,false);assert.equal(task(s,'global-isolation').received,0);assert.equal(row(s,'global-isolation').complete,true);
});
