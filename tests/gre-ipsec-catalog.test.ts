import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {createCatalogLab,GRE_IPSEC_COMMANDS as COMMANDS,GRE_IPSEC_PSK,catalogGuideResources,LAB_CATALOG} from '../src/lab-catalog.ts';
import {actionAvailable,lessonProgress,matches,validateLesson} from '../src/lessons.ts';
import {parseLabFile,serializeLabFile} from '../src/persistence.ts';
import {matchesProtocol,packetGroups,tracePacketIds} from '../src/packet-view.ts';
const slug='gre-over-ipsec-tunnel-configuration-and-verification',id=(n:string)=>'device-gip-'+n.toLowerCase(),profile='GRE-IPSEC',transform='GRE-TS';
function load(mode:'practice'|'completed'='completed'){const s=new Simulator();s.load(parseLabFile(serializeLabFile(createCatalogLab(slug,mode))));s.advance(1000);return s;}
const d=(s:Simulator,n='R1')=>s.getDevice(id(n))!;
function cli(s:Simulator,n='R1'){const c=new IOSSession(s,id(n));if(!c.windowsMode)c.execute('enable');return c;}
function run(c:IOSSession,...lines:string[]){for(const line of lines){const out=c.execute(line);assert.ok(!out.some(iosRejected),line+'\n'+out.join('\n'));assert.doesNotMatch(out.join('\n'),/not implemented|not recognized|TypeError/i);}}
function change(s:Simulator,n:string,...lines:string[]){run(cli(s,n),'configure terminal',...lines,'end');s.advance(100);}
const row=(s:Simulator,n:string)=>lessonProgress(s)!.rows.find(r=>r.objective.id===n)!;
function task(s:Simulator,n:string){const o=row(s,n).objective,a=o.action!;assert.equal(actionAvailable(s,o),true);if(a.kind!=='ping')throw Error('Wrong action');const p=s.ping(a.device,a.target,{count:3});s.advance(6000);lessonProgress(s);return p.received;}
function ping(s:Simulator,n='PC1',target='192.168.20.10'){const p=s.ping(id(n),target,{count:3});s.advance(6000);lessonProgress(s);return p.received;}
function clear(s:Simulator){for(const n of ['R1','R2'])run(cli(s,n),'clear crypto ipsec sa','clear crypto isakmp sa');s.advance(100);}
function finish(s:Simulator){for(const n of ['r1-underlay','r2-underlay','pc1-protected','pc2-protected'])assert.equal(task(s,n),3);assert.equal(lessonProgress(s)!.complete,12);}
const sas=(s:Simulator,n='R1')=>d(s,n).runtime.features.ipsecSAs??[];

test('third ENCOR Virtualization lab is a fresh five-node, twelve-task protected GRE practice',()=>{
 const entries=LAB_CATALOG.filter(l=>l.group==='CCNP ENCOR'&&l.section==='Virtualization');assert.equal(entries.length,3);assert.ok(entries.every(l=>l.section==='Virtualization'));const a=createCatalogLab(slug),b=createCatalogLab(slug);assert.notEqual(a.lab.id,b.lab.id);assert.equal(a.lab.devices.length,5);assert.equal(a.lab.links.length,4);assert.equal(catalogGuideResources(slug)!.rows.length,10);const s=load('practice');assert.equal(lessonProgress(s)!.complete,0);assert.equal(lessonProgress(s)!.rows.length,12);assert.equal(lessonProgress(s)!.rows.filter(r=>r.objective.action&&actionAvailable(s,r.objective)).length,2);assert.equal(d(s).config.interfaces.Tunnel0,undefined);assert.equal(d(s).config.features.crypto,undefined);
});
test('completed reference contains seven live configuration/save goals with no fabricated SAs or packet evidence',()=>{
 const doc=createCatalogLab(slug,'completed');for(const node of doc.lab.devices){assert.deepEqual(node.runtime.features,{});assert.deepEqual(node.startupConfig,node.config);}const s=load();assert.equal(lessonProgress(s)!.complete,7);assert.equal(sas(s).length,0);assert.equal(row(s,'current-sa-carrier').complete,false);finish(s);
});
test('published IOS configuration builds IKEv1 and protected GRE from unconfigured practice',()=>{
 const s=load('practice');for(const[n,commands]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...commands);s.advance(1000);assert.equal(lessonProgress(s)!.complete,7);finish(s);for(const n of ['R1','R2']){const sa=sas(s,n).find((a:any)=>a.ready);assert.equal(sa.keyLength,256);assert.equal(sa.mode,'transport');assert.equal(sa.profile,profile);assert.ok(sa.encaps>0&&sa.decaps>0);assert.ok(d(s,n).runtime.features.isakmpSAs.some((i:any)=>i.state==='QM_IDLE'));}
});
test('ISP carries ESP linked to validated peer GRE decapsulation and both LAN echo legs, with useful SPI and IKE metadata',()=>{
 const s=load();assert.equal(task(s,'pc1-protected'),3);const request=s.events.find(e=>e.nodeId===id('PC2')&&e.label==='Echo request accepted')!,gre=s.events.find(e=>e.nodeId===id('R2')&&e.label==='GRE decapsulation'&&e.packet?.parentId===request.packet?.id)!,wire=s.events.find(e=>e.nodeId===id('ISP')&&e.label==='Frame sent'&&e.packet?.parentId===gre.packet?.id&&e.packet?.protocol==='ESP')!;assert.equal(wire.packet!.source,'192.0.2.2');assert.equal(wire.packet!.destination,'198.51.100.2');assert.ok(wire.packet!.espSpi!>0&&wire.packet!.espSequence!>0);assert.equal(wire.packet!.protectedProtocol,'GRE');assert.ok(matchesProtocol(wire,'ESP'));assert.ok(!s.events.some(e=>e.nodeId===id('ISP')&&e.packet?.protocol==='GRE'));const ids=tracePacketIds(s.events,wire.packet!.id);assert.ok(ids.has(request.packet!.id));assert.ok(packetGroups(wire.packet!).find(g=>g.title==='IPsec and IKE')!.fields.some(([k,v])=>k==='espSpi'&&v==='0x'+wire.packet!.espSpi!.toString(16)));assert.ok(s.events.some(e=>e.nodeId===id('ISP')&&matchesProtocol(e,'IKE')&&e.packet?.ikeStage==='offer'));assert.doesNotMatch(JSON.stringify(s.events.map(e=>e.packet)),new RegExp(GRE_IPSEC_PSK+'|"token"'));
});
test('underlay pings leave SAs absent and cannot masquerade as protected LAN traffic',()=>{
 const s=load();assert.equal(task(s,'r1-underlay'),3);assert.equal(task(s,'r2-underlay'),3);assert.equal(sas(s).length,0);assert.equal(row(s,'pc1-protected').complete,false);assert.equal(row(s,'current-sa-carrier').complete,false);assert.equal(lessonProgress(s)!.complete,9);
});
test('a wrong peer-specific PSK fails fresh negotiation while the WAN remains reachable; repair renegotiates',()=>{
 const s=load();change(s,'R2','crypto isakmp key WRONG address 192.0.2.2');clear(s);assert.equal(ping(s),0);assert.ok(s.events.some(e=>e.label==='IKE rejected'&&e.detail.includes('Pre-shared key mismatch')));assert.equal(row(s,'pc1-protected').complete,false);assert.equal(task(s,'r1-underlay'),3);change(s,'R2','crypto isakmp key '+GRE_IPSEC_PSK+' address 192.0.2.2');clear(s);assert.equal(task(s,'pc1-protected'),3);
});
test('IKE policy incompatibility prevents protected delivery despite correct GRE configuration',()=>{
 const s=load();change(s,'R2','crypto isakmp policy 10','encryption aes 128');clear(s);assert.equal(ping(s),0);assert.equal(row(s,'r2-ike').complete,false);assert.ok(s.events.some(e=>e.detail.includes('IKE policy mismatch')));change(s,'R2','crypto isakmp policy 10','encryption aes 256');clear(s);assert.equal(task(s,'pc1-protected'),3);
});
test('transport-mode and PFS mismatches are real negotiation failures and repair independently',()=>{
 for(const [context,bad,good]of [['crypto ipsec transform-set GRE-TS esp-aes 256 esp-sha-hmac','mode tunnel','mode transport'],['crypto ipsec profile GRE-IPSEC','set pfs group19','set pfs group14']]){const s=load();change(s,'R2',context,bad);clear(s);assert.equal(ping(s),0);assert.equal(row(s,'r2-ipsec').complete,false);assert.ok(s.events.some(e=>e.detail.includes('transform or PFS mismatch')));change(s,'R2',context,good);clear(s);assert.equal(task(s,'pc1-protected'),3);}
});
test('missing profile definitions fail closed and never fall back to clear GRE transport',()=>{
 const s=load();change(s,'R1','no crypto ipsec profile GRE-IPSEC');assert.equal(ping(s),0);assert.ok(s.events.some(e=>e.label==='IPsec drop'&&e.detail.includes('Missing IPsec protection profile')));assert.ok(!s.events.some(e=>e.nodeId===id('ISP')&&e.packet?.protocol==='GRE'));assert.equal(row(s,'pc1-protected').complete,false);
});
test('removing protection at both endpoints permits plain GRE but cannot earn protected or current-SA goals',()=>{
 const s=load();for(const n of ['R1','R2'])change(s,n,'interface Tunnel0','no tunnel protection ipsec profile GRE-IPSEC');clear(s);assert.equal(ping(s),3);assert.ok(s.events.some(e=>e.nodeId===id('ISP')&&e.packet?.protocol==='GRE'));assert.equal(row(s,'pc1-protected').complete,false);assert.equal(row(s,'r1-ipsec').complete,false);assert.equal(row(s,'current-sa-carrier').complete,false);
});
test('a protected peer rejects plaintext from an unprotected opposite endpoint',()=>{
 const s=load();change(s,'R1','interface Tunnel0','no tunnel protection ipsec profile GRE-IPSEC');clear(s);assert.equal(ping(s),0);assert.ok(s.events.some(e=>e.label==='Unprotected GRE rejected'));assert.equal(row(s,'pc1-protected').complete,false);
});
test('an ordinary routed bypass can pass ICMP while failing all secure data-path evidence',()=>{
 const s=load();change(s,'R1','no ip route 192.168.20.0 255.255.255.0 10.255.0.2','ip route 192.168.20.0 255.255.255.0 192.0.2.1');change(s,'R2','no ip route 192.168.10.0 255.255.255.0 10.255.0.1','ip route 192.168.10.0 255.255.255.0 198.51.100.1');change(s,'ISP','ip route 192.168.10.0 255.255.255.0 192.0.2.2','ip route 192.168.20.0 255.255.255.0 198.51.100.2');assert.equal(ping(s),3);assert.equal(row(s,'pc1-protected').complete,false);assert.equal(row(s,'current-sa-carrier').complete,false);assert.equal(row(s,'r1-gre').complete,false);
});
test('missing return LAN routing can increment protection counters without completing a protected PC round trip',()=>{
 const s=load();change(s,'R2','no ip route 192.168.10.0 255.255.255.0 10.255.0.1');assert.equal(ping(s),0);assert.ok(sas(s).some((sa:any)=>sa.encaps>0));assert.equal(row(s,'pc1-protected').complete,false);assert.equal(row(s,'current-sa-carrier').complete,false);change(s,'R2','ip route 192.168.10.0 255.255.255.0 10.255.0.1');assert.equal(task(s,'pc1-protected'),3);
});
test('clearing SAs removes the live carrier goal; new tunnel-only traffic cannot recycle an old PC observation',()=>{
 const s=load();finish(s);const oldSpis=sas(s).map((a:any)=>a.outboundSpi);clear(s);assert.equal(lessonProgress(s)!.complete,11);assert.equal(ping(s,'R1','10.255.0.2'),3);assert.ok(sas(s).some((sa:any)=>sa.ready&&!oldSpis.includes(sa.outboundSpi)));assert.equal(row(s,'current-sa-carrier').complete,false);assert.equal(task(s,'pc1-protected'),3);assert.equal(lessonProgress(s)!.complete,12);
});
test('simultaneous initiators retain valid directional SA/SPI proof in both PC directions',()=>{
 const s=load(),a=s.ping(id('PC1'),'192.168.20.10',{count:3}),b=s.ping(id('PC2'),'192.168.10.10',{count:3});s.advance(10000);assert.equal(a.received,3);assert.equal(b.received,3);assert.equal(row(s,'pc1-protected').complete,true);assert.equal(row(s,'pc2-protected').complete,true);assert.equal(row(s,'current-sa-carrier').complete,true);
});
test('the 1400-byte tunnel MTU is enforced for DF packets and normal protected traffic recovers',()=>{
 const s=load(),a=s.ping(id('R1'),'10.255.0.2',{count:1,size:1400,df:true});s.advance(5000);assert.equal(a.received,1);const b=s.ping(id('R1'),'10.255.0.2',{count:1,size:1401,df:true});s.advance(5000);assert.equal(b.received,0);assert.match(b.replies[0].error!,/Fragmentation needed/);assert.equal(task(s,'pc1-protected'),3);
});
test('both startup crypto policies and GRE configuration must be saved; IOS reload restores a damaged unsaved endpoint',()=>{
 const s=load('practice');for(const[n,commands]of Object.entries(COMMANDS))run(new IOSSession(s,id(n)),...commands.filter(c=>c!=='write memory'));s.advance(100);assert.equal(row(s,'save-protection').complete,false);run(cli(s),'write memory');assert.equal(row(s,'save-protection').complete,false);run(cli(s,'R2'),'write memory');assert.equal(row(s,'save-protection').complete,true);finish(s);change(s,'R1','crypto isakmp key BROKEN address 198.51.100.2');assert.equal(row(s,'save-protection').complete,false);s.reloadIOS(id('R1'));s.advance(8000);assert.equal(row(s,'save-protection').complete,true);assert.equal(row(s,'current-sa-carrier').complete,false);assert.equal(task(s,'pc1-protected'),3);
});
test('portable reopening retains achievements and configuration but requires fresh SAs and current PC evidence',()=>{
 const s=load();finish(s);d(s).config.hostname='Protected-Edge';const doc=parseLabFile(serializeLabFile(s.serialize()));assert.equal(doc.lab.devices.find(d=>d.id===id('R1'))!.runtime.features.ipsecSAs,undefined);const restored=new Simulator();restored.load(doc);restored.advance(1000);assert.equal(lessonProgress(restored)!.complete,11);assert.equal(sas(restored).length,0);assert.equal(task(restored,'pc1-protected'),3);assert.equal(lessonProgress(restored)!.complete,12);
});
test('broken envelope parent identities invalidate direct protected-flow matches even with nonzero native counters',()=>{
 const s=load();assert.equal(task(s,'pc1-protected'),3);const c=row(s,'pc1-protected').objective.criterion;assert.equal(matches(s,c),true);for(const e of s.events)if(e.packet?.protocol==='ESP')e.packet.parentId='unrelated';assert.ok(sas(s).some((a:any)=>a.encaps>0&&a.decaps>0));assert.equal(matches(s,c),false);assert.equal(row(s,'current-sa-carrier').complete,false);
});
test('published show/Windows commands expose configured and negotiated AES key length and actual current SAs without secrets',()=>{
 const s=load();finish(s);for(const[n,commands]of Object.entries(catalogGuideResources(slug)!.verification))run(cli(s,n),...commands);const c=cli(s);assert.match(c.execute('show crypto isakmp policy').join('\n'),/aes 256/);assert.match(c.execute('show crypto ipsec transform-set GRE-TS').join('\n'),/esp-aes 256.*transport/);const text=c.execute('show crypto ipsec sa').join('\n');assert.match(text,/esp-aes 256.*transport/);assert.match(text,/#pkts encaps: [1-9]/);assert.doesNotMatch(text,new RegExp(GRE_IPSEC_PSK+'|"token"|#pkts encrypt:'));
});
test('negotiated AES-128 is reported as 128 and cannot masquerade as the requested AES-256 profile',()=>{
 const s=load();for(const n of ['R1','R2'])change(s,n,'crypto ipsec transform-set GRE-TS esp-aes 128 esp-sha-hmac','mode transport');clear(s);assert.equal(ping(s),3);assert.ok(sas(s).some((a:any)=>a.keyLength===128));assert.match(cli(s).execute('show crypto ipsec sa').join('\n'),/esp-aes 128/);assert.equal(row(s,'r1-ipsec').complete,false);assert.equal(row(s,'current-sa-carrier').complete,false);
});
test('bounded imported criteria accept declarative protected-flow goals and reject malformed profile, peer and identity data',()=>{
 const s=load(),o=row(s,'pc1-protected').objective,c=o.criterion as unknown as Record<string,unknown>;validateLesson({title:'IPsec',description:'',objectives:[o]});const invalid:unknown[]=[{...c,address:'999.0.0.1'},{...c,profile:''},{...c,transit:{}},{kind:'gip-ike',device:id('R1'),peer:'198.51.100.256'},{kind:'gip-saved',device:id('R1'),peer:'198.51.100.2',profile:'x'.repeat(129),transform}];for(const criterion of invalid)assert.throws(()=>validateLesson({title:'IPsec',description:'',objectives:[{...o,criterion}]}));
});
