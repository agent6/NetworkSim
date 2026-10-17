import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {Simulator} from '../src/engine.ts';
import {wirelessLabFixture} from './fixtures/wireless-lab.ts';
import {wirelessConfig} from '../src/wireless-model.ts';
import {controllerFormDraft} from '../src/wireless-controller-form.ts';

const assetHook=registerHooks({load(url,context,next){return url.endsWith('.png')?{format:'module',source:'export default "";',shortCircuit:true}:next(url,context);}});
const {renderAPControllerConfiguration}=await import('../src/ap-controller-view.ts');
const {showWireless}=await import('../src/wireless-ui.ts');
assetHook.deregister();
function advance(e:Simulator,ms=25000){for(let left=ms;left>0;left-=100)e.advance(Math.min(100,left),100000);}
function fixture(){
 const e=new Simulator();e.load(wirelessLabFixture());
 const wlc=e.lab.devices.find(d=>d.kind==='wlc')!,ap=e.lab.devices.find(d=>d.kind==='ap')!,laptop=e.lab.devices.find(d=>d.kind==='laptop')!,server=e.lab.devices.find(d=>d.kind==='server')!,sw=e.lab.devices.find(d=>d.kind==='poeswitch')!;
 const w=wirelessConfig(wlc)!;
 Object.assign(w.wlans.CAMPUS,{security:'wpa2-personal',psk:'correct-password'});
 w.rfProfiles.MANAGED24={band:'2.4',enabled:false,channel:1,width:20,power:17};
 w.rfProfiles.MANAGED5={band:'5',enabled:true,channel:149,width:80,power:25};
 w.rfTags['default-rf-tag']={band24:'MANAGED24',band5:'MANAGED5'};
 const legacy=wirelessConfig(ap)!.radios.find(r=>r.band==='5')!;Object.assign(legacy,{channel:36,power:5,width:20,enabled:false});
 Object.assign(wirelessConfig(laptop)!.adapter,{security:'wpa2-personal',passphrase:'correct-password',bands:['5']});
 for(const other of e.lab.devices.filter(d=>d.kind==='laptop'&&d.id!==laptop.id))wirelessConfig(other)!.adapter.enabled=false;
 sw.config.interfaces['GigabitEthernet0/5'].features.powerInline={mode:'never',max:30000};e.changed();
 return {e,wlc,ap,laptop,server,sw,w};
}
function captureAP(e:Simulator,ap:ReturnType<Simulator['addDevice']>){
 let markup='',save=(_f:FormData)=>{};const original=globalThis.document,root={isConnected:false,addEventListener(){}};
 Object.assign(globalThis,{document:{querySelector:(selector:string)=>selector==='#dialog-form'?root:selector==='.dialog'?{classList:{add(){}}}:null}});
 try{showWireless(e,ap,(_title,html,callback)=>{markup=html;save=callback;},work=>{work();e.changed();},()=>{});}finally{Object.assign(globalThis,{document:original});}
 return {markup,save};
}
function wlcForm(wlc:ReturnType<Simulator['addDevice']>){
 const w=wirelessConfig(wlc)!,f=new FormData(),add=(values:Record<string,unknown>)=>Object.entries(values).forEach(([key,value])=>f.append(key,String(value??'')));
 const p=wlc.config.interfaces[w.managementInterface!];add({hostname:wlc.config.hostname,'management-interface':w.managementInterface,'management-ip':p.ip,'management-mask':p.mask,'management-gateway':wlc.config.defaultGateway,'management-dns':wlc.config.dnsServers.join(', ')});
 for(const p of Object.values(w.wlans))add({'wlan-name':p.name,'wlan-id':p.id,'wlan-ssid':p.ssid,'wlan-security':p.security,'wlan-psk':p.psk,'wlan-auth':p.authenticationList,'wlan-enabled':p.enabled?'on':'off','wlan-broadcast':p.broadcast?'on':'off'});
 for(const[name,p]of Object.entries(w.policies))add({'policy-name':name,'policy-vlan':p.vlan,'policy-switch':p.centralSwitching?'central':'local','policy-enabled':p.enabled?'on':'off','policy-timeout':p.sessionTimeout});
 for(const[name,m]of Object.entries(w.policyTags))for(const[wlan,policy]of Object.entries(m))add({'tag-name':name,'tag-wlan':wlan,'tag-policy':policy});
 for(const[name,p]of Object.entries(w.apProfiles))add({'join-name':name,'join-echo':p.echoInterval});
 for(const[name,p]of Object.entries(w.flexProfiles))add({'flex-name':name,'flex-native':p.nativeVlan});
 for(const[name,p]of Object.entries(w.siteTags))add({'site-name':name,'site-local':p.localSite?'local':'flex','site-join':p.apProfile,'site-flex':p.flexProfile});
 for(const[name,p]of Object.entries(w.rfProfiles))add({'rf-name':name,'rf-band':p.band,'rf-power':p.power,'rf-channel':p.channel,'rf-width':p.width,'rf-enabled':p.enabled?'on':'off'});
 for(const[name,p]of Object.entries(w.rfTags))add({'rftag-name':name,'rftag-24':p.band24,'rftag-5':p.band5});
 return f;
}

test('APCFG-01 delivered WLC profiles override stale AP radio settings, and matching laptop carries routed traffic',()=>{
 const {e,ap,laptop,server}=fixture();advance(e);
 const view=e.wireless.apConfiguration(ap.id)!;assert.equal(view.state,'RUN');assert.equal(view.configured,true);assert.ok(view.appliedAt!>0);assert.equal(view.controllerName,'WLC1');
 assert.deepEqual(view.radios.find(r=>r.band==='5'),{band:'5',enabled:true,channel:149,width:80,power:25,maxClients:100,profileName:'MANAGED5',operational:true});
 assert.equal(wirelessConfig(ap)!.radios.find(r=>r.band==='5')!.channel,36);
 assert.ok(view.wlans.some(w=>w.ssid==='Campus'&&w.vlan===20&&w.active));
 assert.equal(e.wireless.association(laptop.id)?.channel,149);assert.equal(laptop.runtime.features.wireless.state,'CONNECTED');
 const ping=e.ping(laptop.id,'10.10.0.100',{count:2});advance(e,2500);assert.equal(ping.received,2);
 const http=e.fetchHTTP(laptop.id,'10.10.0.100');advance(e,3000);assert.equal(http.status,'success');assert.equal(http.content,server.config.services.http.content);
 assert.ok(e.events.some(x=>x.packet?.destinationPort===5246));assert.ok(e.events.some(x=>x.packet?.destinationPort===5247));
});

test('APCFG-02 wrong SSID, security mode or WPA2 key cannot associate; correcting each reconnects',()=>{
 for(const mismatch of ['ssid','security','passphrase'] as const){
  const {e,laptop}=fixture(),adapter=wirelessConfig(laptop)!.adapter;
  if(mismatch==='ssid')adapter.ssid='Other';if(mismatch==='security')adapter.security='open';if(mismatch==='passphrase')adapter.passphrase='wrong-password';
  e.changed();advance(e);assert.equal(e.wireless.association(laptop.id),undefined,mismatch);
  Object.assign(adapter,{ssid:'Campus',security:'wpa2-personal',passphrase:'correct-password'});e.changed();advance(e,15000);
  assert.equal(laptop.runtime.features.wireless.state,'CONNECTED',mismatch);assert.ok(e.wireless.association(laptop.id)?.authorized);
 }
});

test('APCFG-03 WLC edits are visible only after CAPWAP delivery and require the laptop to match the new configuration',()=>{
 const {e,w,ap,laptop}=fixture();advance(e);assert.ok(e.wireless.association(laptop.id));
 w.wlans.CAMPUS.ssid='New-Campus';w.wlans.CAMPUS.psk='new-password';w.rfProfiles.MANAGED5.channel=157;e.changed();
 assert.equal(e.wireless.apConfiguration(ap.id)!.wlans[0].ssid,'Campus');
 advance(e,3000);const applied=e.wireless.apConfiguration(ap.id)!;assert.equal(applied.wlans[0].ssid,'New-Campus');assert.equal(applied.radios.find(r=>r.band==='5')!.channel,157);assert.equal(e.wireless.association(laptop.id),undefined);
 Object.assign(wirelessConfig(laptop)!.adapter,{ssid:'New-Campus',passphrase:'new-password'});e.changed();advance(e,15000);
 assert.equal(laptop.runtime.features.wireless.state,'CONNECTED');assert.equal(e.wireless.association(laptop.id)?.channel,157);
});

test('APCFG-04 AP form shows operational controller settings without editable local radios or a power control',()=>{
 const {e,ap}=fixture();advance(e);const {markup,save}=captureAP(e,ap);
 assert.match(markup,/WLC configuration applied/);assert.match(markup,/data-ap-channel="5">149/);assert.match(markup,/data-ap-radio-power="5">25 dBm/);assert.match(markup,/Campus/);assert.match(markup,/CAMPUS-POLICY/);
 assert.ok(!/name="radio-/.test(markup));assert.ok(!/name="power-source"|data-action="power-device"/.test(markup));assert.ok(!markup.includes('correct-password'));
 const before=structuredClone(wirelessConfig(ap)!.radios),f=new FormData(),p=ap.config.interfaces.GigabitEthernet0;
 f.set('address-mode','static');f.set('ip',p.ip!);f.set('mask',p.mask!);f.set('gateway',ap.config.defaultGateway!);f.set('dns',ap.config.dnsServers.join(','));f.set('controller','10.10.0.2');
 f.set('radio-1-power','-10');f.set('radio-1-channel','36');save(f);assert.deepEqual(wirelessConfig(ap)!.radios,before);advance(e,2000);assert.equal(e.wireless.apConfiguration(ap.id)!.radios.find(r=>r.band==='5')!.channel,149);
});

test('APCFG-05 absent controller configuration and policy dependencies are explained rather than shown as serving a WLAN',()=>{
 const {e,w,ap,laptop}=fixture();wirelessConfig(ap)!.controller='10.10.0.250';e.changed();advance(e,15000);
 assert.equal(e.wireless.apConfiguration(ap.id)!.configured,false);assert.match(renderAPControllerConfiguration(e.wireless.apConfiguration(ap.id)),/Waiting for WLC configuration/);assert.equal(e.wireless.association(laptop.id),undefined);
 wirelessConfig(ap)!.controller='10.10.0.2';e.changed();advance(e,15000);assert.ok(e.wireless.association(laptop.id));
 w.policyTags['default-policy-tag']={};e.changed();advance(e,3000);const missing=e.wireless.apConfiguration(ap.id)!;assert.equal(missing.wlans.length,0);assert.match(missing.issues.join(' '),/No WLAN is mapped/);assert.equal(e.wireless.association(laptop.id),undefined);
});

test('APCFG-06 WLC RF form channel selection changes AP operation and invalid band/channel rejects atomically',()=>{
 const {e,wlc,ap}=fixture();advance(e);const f=wlcForm(wlc);const channels=f.getAll('rf-channel').map(String);channels[1]='161';f.delete('rf-channel');channels.forEach(c=>f.append('rf-channel',c));
 wlc.config=controllerFormDraft(e.seed,wlc,f);e.changed();advance(e,3000);assert.equal(e.wireless.apConfiguration(ap.id)!.radios.find(r=>r.band==='5')!.channel,161);
 const bad=wlcForm(wlc),old=JSON.stringify(wlc.config);bad.set('rf-channel','149');assert.throws(()=>controllerFormDraft(e.seed,wlc,bad),/allowed channel/);assert.equal(JSON.stringify(wlc.config),old);
});

test('APCFG-07 explicit GUI tag definitions create empty tags, bind an AP and remove unused tags',()=>{
 const {e,wlc,ap,laptop}=fixture(),f=wlcForm(wlc),mac=e.macOf(ap.id,'GigabitEthernet0');
 f.set('policy-tag-definitions','1');for(const name of ['default-policy-tag','BRANCH','EMPTY'])f.append('policy-tag-name',name);
 f.set('tag-name','BRANCH');f.append('ap-mac',mac);f.append('ap-policy','BRANCH');f.append('ap-site','default-site-tag');f.append('ap-rf','default-rf-tag');
 const before=JSON.stringify(wlc.config),config=controllerFormDraft(e.seed,wlc,f,[mac]);assert.equal(JSON.stringify(wlc.config),before);
 assert.deepEqual(config.features.wireless.policyTags.EMPTY,{});
 wlc.config=config;e.changed();advance(e);assert.equal(e.wireless.apConfiguration(ap.id)!.assignment?.policyTag,'BRANCH');assert.ok(e.wireless.association(laptop.id));
 const remove=wlcForm(wlc);remove.set('policy-tag-definitions','1');for(const name of ['default-policy-tag','BRANCH'])remove.append('policy-tag-name',name);
 const next=controllerFormDraft(e.seed,wlc,remove);assert.ok(!Object.hasOwn(next.features.wireless.policyTags,'EMPTY'));assert.equal(next.features.wireless.policyTags.BRANCH.CAMPUS,'CAMPUS-POLICY');
});

test('APCFG-08 GUI references reject missing policy tags and 802.1X lists before changing running state',()=>{
 const {e,wlc}=fixture(),before=JSON.stringify(wlc.config);
 const tag=wlcForm(wlc);tag.set('policy-tag-definitions','1');tag.append('policy-tag-name','default-policy-tag');tag.set('tag-name','REMOVED');
 assert.throws(()=>controllerFormDraft(e.seed,wlc,tag),/existing policy tag/);assert.equal(JSON.stringify(wlc.config),before);
 const auth=wlcForm(wlc);auth.set('wlan-security','wpa2-enterprise');auth.set('wlan-auth','REMOVED');
 assert.throws(()=>controllerFormDraft(e.seed,wlc,auth),/existing 802.1X authentication list/);assert.equal(JSON.stringify(wlc.config),before);
 auth.set('wlan-auth','CAMPUS-DOT1X');assert.equal(controllerFormDraft(e.seed,wlc,auth).features.wireless.wlans.CAMPUS.authenticationList,'CAMPUS-DOT1X');
});
