import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Extract every current named field template, including repeated radios and
// switch ports. This is an implementation inventory, not a vendor GUI fixture.
const files = ['src/wireless-ui.ts', 'src/poe-ui.ts', 'src/wireless-controller-form.ts', 'src/ap-controller-view.ts', 'src/wlc-reference-ui.ts'];
const source = readFileSync(files[0], 'utf8'), fields = [];
const shared = new Set(['address-mode','ip','mask','gateway','dns','ipv6','slaac']);
const ap = new Set(['coverage','controller','controller-name']);
for (const m of source.matchAll(/\b(input|select|toggle|wlcReference|definition)\('([^']*)','([^']*)'\s*,/g)) {
  const type = m[1], name = type === 'toggle' ? m[2] : m[3], label = type === 'toggle' ? m[3] : m[2];
  const nodes = m.index > source.indexOf('function controllerUI(') ? ['wlc'] : shared.has(name) ? ['ap','laptop'] : ap.has(name) ? ['ap'] : ['laptop'];
  fields.push({ name, label, type: type === 'toggle' ? 'checkbox' : type==='wlcReference'?'select':type==='definition'?'text':type, nodes, source: `${files[0]}:${source.slice(0,m.index).split('\n').length}`, repeat: nodes[0] === 'wlc' && !name.startsWith('management-') && name !== 'hostname' ? 'per configured row' : 'once' });
}
if (source.includes("'radio-'+i+'-")) throw Error('Editable AP radio inputs returned; inventory their authoritative runtime paths before regenerating.');
if (!source.includes('renderAPControllerConfiguration(sim.wireless.apConfiguration(d.id))')) throw Error('AP received-configuration display extraction drift');
if (!source.includes('name="ap-mac"')) throw Error('AP assignment extraction drift');
fields.push({name:'ap-mac',label:'AP Ethernet MAC (assignment key)',type:'hidden',nodes:['wlc'],source:`${files[0]}:${source.slice(0,source.indexOf('name="ap-mac"')).split('\n').length}`,repeat:'per AP in current topology'});
const references=[...source.matchAll(/\bwlcReference\('([^']*)','([^']*)',(.+?),'([^']+)',catalog\)/g)].map(m=>({name:m[2],label:m[1],kind:m[4],source:`${files[0]}:${source.slice(0,m.index).split('\n').length}`,options:'existing own profile/interface names plus unsaved form rows; removed or incompatible selections retained as unavailable and invalid',validator:'bindWLCReferences custom validity, invalid-section reveal, then transactional controllerFormDraft parser',status:'partial'}));
const controlMarkers=[{name:'policy-tag-definitions',type:'hidden',meaning:'Current form explicitly declares all policy tags, including empty tags; absence preserves older form compatibility',persistent:false,source:files[0],parser:files[2]}];
if(!source.includes('name="policy-tag-definitions"'))throw Error('Policy-tag control marker extraction drift');
const poeSource = readFileSync(files[1],'utf8');
for (const [name,label,type,repeat] of [['poe-budget','Available PoE budget (W)','number','once'],['poe-mode','Power mode','select','24 PoE access ports'],['poe-max','Power limit (mW)','number','24 PoE access ports'],['poe-priority','Power priority','select','24 PoE access ports']]) {
  if (!poeSource.includes(`name="${name}"`)) throw Error('PoE extraction drift: ' + name);
  fields.push({name,label,type,nodes:['poeswitch'],source:`${files[1]}:${poeSource.slice(0,poeSource.indexOf(`name="${name}"`)).split('\n').length}`,repeat});
}
const state = {
 coverage:['config.features.wirelessCoverage','main.ts coverage circles; presentation only','false','boolean','WL browser optional coverage'],
 'adapter-enabled':['wireless.adapter.enabled','tickClient → disconnect/scan → Wireless0 interface','true','boolean','WL-05/06/07/24'],
 'auto-connect':['wireless.adapter.autoConnect','tickClient → IDLE/reconnect','true','boolean','source trace; dedicated GUI invalid/reload cases pending'],
 ssid:['wireless.adapter.ssid','advertisement matching → authentication/association','empty','0–32 bytes','WL-01/02; WL-04/30'],
 security:['wireless.adapter.security','security compatibility + open/WPA2 authentication','wpa2-personal','open | wpa2-personal | wpa2-enterprise','WL-18/19; open WLAN'],
 passphrase:['wireless.adapter.passphrase','PBKDF2 PMK → four-way MIC validation','empty','8–63 ASCII or 64 hex for WPA2 PSK','WL-04/30; published IEEE PMK vector'],
 username:['wireless.adapter.username','CAPWAP client-auth → delivered RADIUS request','empty','0–128 bytes','WL-18/19; WF-07/08/09'],
 password:['wireless.adapter.password','CAPWAP client-auth → delivered RADIUS request','empty','0–128 bytes','WL-18/19; WF-07/08/09'],
 hysteresis:['wireless.adapter.roamHysteresis','stronger AP threshold in tickClient','8 dB','1–30 dB','WL-08/09/10'],
 residence:['wireless.adapter.minimumResidence','minimum association duration before roaming','5 seconds','1–300 seconds','WL-08/09/10'],
 mac:['Wireless0.features.macAddress','frame source + RADIUS association key + duplicate rejection','deterministic generated unicast','valid nonzero unicast MAC','duplicate wireless MAC test'],
 controller:['wireless.controller','CAPWAP IP discovery destination and response source gate','unset','valid IPv4 or blank','WL-15/16/27; WF-06'],
 'controller-name':['wireless.controllerName','primary-base rendering; name is descriptive, IP selects controller','unset','maximum 32 bytes on persisted configuration','source trace; hardware identity validation unsupported'],
 'address-mode':['interface.features.dhcp','requestDHCP or static address → shared IP engine','DHCP','dhcp | static','WL-03/11/12/13/26; GUI validation partial'],
 ip:['interface.ip','shared connected/local routes + IP endpoint + CAPWAP addressing','unassigned','IPv4 or empty','WL-15/16/27'],
 mask:['interface.mask','shared subnet/route resolution','255.255.255.0 in form','contiguous IPv4 mask','source trace; boundary matrix pending'],
 gateway:['config.defaultGateway','shared recursive route and ARP','unset','IPv4 or empty','WL-14/28'],
 dns:['config.dnsServers','shared DNS UDP delivery and CAPWAP DNS discovery','empty','IPv4/IPv6 comma-separated','WL-03/11/12/13/26'],
 ipv6:['interface.ipv6','shared ND/IPv6/ICMPv6','empty','IPv6 CIDR addresses comma-separated; IPv4 CIDR rejected','wireless IPv6 central/local test; AP/laptop browser invalid-CIDR checks'],
 slaac:['interface.features.ipv6Autoconfig','shared RA/SLAAC services','false','boolean','source trace; dedicated wireless GUI disable/renew test pending'],
 meters:['wireless.rf.metersPerUnit','RF log-distance path loss','0.2','0.01–10','WL-05/06/07/24; deterministic abstraction'],
 exponent:['wireless.rf.pathLossExponent','RF log-distance path loss','3','1–6','source trace; physical RF validation unsupported'],
 noise:['wireless.rf.noiseFloor','RF SNR and eligibility','-95 dBm','-120 to -40 dBm','source trace; physical RF validation unsupported'],
 attenuation:['wireless.rf.attenuation','RF RSSI and eligibility','0 dB','0–80 dB','source trace; physical RF validation unsupported'],
 sensitivity:['wireless.rf.sensitivity','RF receiver threshold','-82 dBm','-100 to -30 dBm','WL-05/06/07/24; approximation'],
 interference:['wireless.rf.interference','co-channel noise sum → SNR/eligibility','true','boolean','source trace; no collisions/CSMA implementation'],
 hostname:['config.hostname','shared IOS show/log/AP identity labels','WLC1','IOS hostname validation','WF-10/11/12 form → parser'],
 'management-interface':['wireless.managementInterface','CAPWAP control source and reachability','GigabitEthernet1','existing interface','WL-15/16/27; virtual interface dataplane incomplete'],
 'management-ip':['management interface.ip','CAPWAP source + shared IP endpoint','unset','IPv4 or empty','WL-15/16/27; WF-10/11/12'],
 'management-mask':['management interface.mask','shared route/subnet resolution','255.255.255.0 in form','contiguous mask','WF-10/11/12; boundary matrix pending'],
 'management-gateway':['config.defaultGateway','shared default routing','unset','IPv4 or empty','WL-14/28; WF-10/11/12'],
 'management-dns':['config.dnsServers','shared DNS resolver','empty','IPv4/IPv6 comma-separated','WF-10/11/12/18 DNS replacement and clearing; isolated resolver traffic remains partial'],
 'wlan-name':['wireless.wlans[name].name','own dictionary identity → policy-tag → delivered AP WLAN','empty for new row','1–32 letters/digits/._-; duplicate rejected; legal inherited-member names remain data','WF-10/11/12; WF-19/20/21 safe names and real traffic/save/load'],
 'wlan-id':['wireless.wlans[name].id','BSSID derivation + show output','first unused ID in GUI','1–512 on creation; existing ID read-only; differing ID rejected','WF-06/16; exact platform error transcript unverified'],
 'wlan-ssid':['wireless.wlans[name].ssid','AP beacon/probe and client match','empty for new row','1–32 bytes','WF-12; SSID invalidation test'],
 'wlan-security':['wireless.wlans[name].security','open/WPA2 four-way/EAP+RADIUS','WPA2 personal GUI; dot1x CLI','open | wpa2-personal | wpa2-enterprise','WL-18/19; WF-08/10/11'],
 'wlan-psk':['wireless.wlans[name].psk','WPA2 PMK/MIC validation','empty','8–63 ASCII or 64 hex; lab clear text','WL-04/30; WF-10'],
 'wlan-auth':['wireless.wlans[name].authenticationList','dot1x method list → AAA group → real UDP requests','existing explicit method list or available implicit default; blank when unavailable','existing method-list dropdown for Enterprise WLANs; implicit default preserved on unrelated Apply','WF-07/08/09/22; WLC reference browser implicit-default selection/Apply'],
 'wlan-enabled':['wireless.wlans[name].enabled','AP advertisement and session eligibility','disabled for new WLAN','on | off','WF-12; source trace'],
 'wlan-broadcast':['wireless.wlans[name].broadcast','beacon/probe visibility; directed preferred SSID scan','broadcast','on | off','WF-17 hidden directed association and unknown-client scan visibility'],
 'policy-tag-name':['wireless.policyTags[name]','WLAN/policy mapping namespace consumed by delivered AP configuration; empty tags can be created and removed','default-policy-tag exists','unique profile name; selected references must exist; built-in name read-only and nonremovable','APCFG-07/08; WLC reference browser unsaved create, mappings, empty-tag persistence and deletion'],
 'policy-name':['wireless.policies[name].name','WLAN policy reference','empty','profile name; duplicate rejected','WF-11/12'],
 'policy-vlan':['wireless.policies[name].vlan','actual Ethernet/VLAN and CAPWAP data encapsulation','1','1–4094','WL-14/28; routed ACL test'],
 'policy-switch':['wireless.policies[name].centralSwitching','central UDP5247 vs local AP Ethernet path','central','central | local; local requires Flex site','WL-12; WF-01/11'],
 'policy-enabled':['wireless.policies[name].enabled','AP advertisement/session eligibility','disabled for new policy','on | off','source trace; parser and form tests'],
 'policy-timeout':['wireless.policies[name].sessionTimeout','session expiration → disconnect/reauth','1800 seconds','1–86400 seconds','WF-17 real configured expiry forces a fresh handshake; full timer boundaries pending'],
 'tag-name':['wireless.policyTags[name]','AP WLAN-to-policy mappings','default-policy-tag exists','profile name; maximum 16 WLAN mappings','WL-20/29; policy-tag rejoin test'],
 'tag-wlan':['wireless.policyTags[tag][wlan] key','WLAN existence → AP advertisement','empty','existing WLAN profile; duplicate pair rejected','WF-02/11'],
 'tag-policy':['wireless.policyTags[tag][wlan] value','policy dependency → forwarding mode/VLAN','empty','existing policy profile','WL-14/28; WF-02'],
 'site-name':['wireless.siteTags[name]','AP operating-mode/join/Flex dependency','default-site-tag exists','profile name; duplicate rejected','WF-01/02/04'],
 'site-local':['wireless.siteTags[name].localSite','local mode vs FlexConnect standalone behavior','local','local | flex','WF-01/04/11'],
 'site-join':['wireless.siteTags[name].apProfile','CAPWAP heartbeat/dead timers; changes rejoin','default-ap-profile','existing AP join profile','WF-02/04'],
 'site-flex':['wireless.siteTags[name].flexProfile','local native VLAN; changes rejoin','default-flex-profile','existing Flex profile','WF-02/04'],
 'join-name':['wireless.apProfiles[name]','site attachment → CAPWAP timers','default-ap-profile exists','profile name; duplicate rejected','WF-02/04/10'],
 'join-echo':['wireless.apProfiles[name].echoInterval; deadInterval = 3×','actual CAPWAP echo scheduling/dead expiry','30 seconds','1–30 seconds; three-echo dead model abstraction','WF-01/04; WL-17'],
 'flex-name':['wireless.flexProfiles[name]','site attachment → AP local VLAN mapping','default-flex-profile exists','profile name; duplicate rejected','WF-02/10'],
 'flex-native':['wireless.flexProfiles[name].nativeVlan','AP ingress untagged VLAN and egress tag removal','1','1–4094','WL-12/14/28; exact native mismatch cases pending'],
 'rf-name':['wireless.rfProfiles[name]','RF tag → effective AP radios','empty','profile name; duplicate rejected','WF-02/03/12'],
 'rf-band':['wireless.rfProfiles[name].band','band-specific tag validation','5 GHz','2.4 | 5','WF-03/11'],
 'rf-power':['wireless.rfProfiles[name].power','received WLC RF profile overrides local AP radio power → RF','30 dBm','integer -10 to 30; teaching range','APCFG-01/04 authoritative profile power with actual forwarding; dedicated full power boundary matrix pending'],
 'rf-channel':['wireless.rfProfiles[name].channel','received WLC RF profile selects effective radio channel; Auto uses AP selection','Auto (0)','2.4:0/1/6/11; 5:0/36/40/44/48/149/153/157/161/165','APCFG-01/03/06 received channel/application/invalid-band transactional rejection; browser boundaries pending'],
 'rf-width':['wireless.rfProfiles[name].width','effective radio width → RF estimate/rate','20 MHz','2.4:20; 5:20/40/80 MHz','WF-03/12; no PHY implementation'],
 'rf-enabled':['wireless.rfProfiles[name].enabled','effective radio → advertisement/session removal','disabled for new profile','on | off','WF-12'],
 'rftag-name':['wireless.rfTags[name]','AP RF profile selection','default-rf-tag exists','profile name; duplicate rejected','WF-02/03/12'],
 'rftag-24':['wireless.rfTags[name].band24','effective 2.4 GHz radio; blank restores global AP settings','unset','existing matching-band RF profile or blank','WF-02/03/12'],
 'rftag-5':['wireless.rfTags[name].band5','effective 5 GHz radio; blank restores global AP settings','unset','existing matching-band RF profile or blank','WF-02/03/12'],
 'ap-mac':['wireless.assignments[canonicalMAC] key','physical AP identity for tag configuration','generated AP Ethernet MAC','12 hex digits in canonical form','AP policy-tag rejoin test'],
 'ap-policy':['wireless.assignments[MAC].policyTag','delivered configure-response; rejoin; WLAN selection','default-policy-tag','existing policy tag','AP policy-tag rejoin test; WF-02'],
 'ap-site':['wireless.assignments[MAC].siteTag','delivered AP mode/join/Flex dependencies','default-site-tag','existing site tag','WF-01/02/04'],
 'ap-rf':['wireless.assignments[MAC].rfTag','delivered RF profile dependencies','default-rf-tag','existing RF tag','WF-02/03/12'],
 'radio-{index}-enabled':['wireless.radios[index].enabled','effective radios → beacon/association/data eligibility','true','boolean','WL-05/06/07/24'],
 'radio-{index}-channel':['wireless.radios[index].channel','BSSID advertisement; RF co-channel noise; session invalidation','1 / 36','2.4:1/6/11; 5:36/40/44/48/149/153/157/161/165','source trace; regulatory/DFS/PHY unsupported'],
 'radio-{index}-width':['wireless.radios[index].width','effective radio width/rate and session signature','20 MHz','2.4:20; 5:20/40/80 MHz','source trace; PHY width compatibility incomplete'],
 'radio-{index}-power':['wireless.radios[index].power','RSSI/SNR/range and session signature','17 dBm','-10 to 30; teaching range','WL-05/06/07/24; not hardware power table'],
 'radio-{index}-clients':['wireless.radios[index].maxClients','radio-band association+pending admission count','100','integer 1–200','SSID/admission test'],
 'poe-budget':['config.features.poe.budget','recomputePoE → allocations → AP lifecycle → wireless loss/recovery','370 W','0–740 W; 0.1 input step','PoE budget integration/persistence tests'],
 'poe-mode':['interface.features.powerInline.mode','electrical allocation independent from Ethernet shutdown/VLAN/STP','auto','auto | never','per-port power-off/reboot test'],
 'poe-max':['interface.features.powerInline.max','grant/deny 30 W full AP allocation','30000 mW','integer 4000–30000 mW','budget/port maximum integration test'],
 'poe-priority':['interface.features.powerPriority','budget admission/shedding ranks high before low, then actual detection order among equal priorities','low','high | low','POE-12/13 priority/preemption/detection-order/persistence'],
};
for (const field of fields) {
  const mapping = state[field.name]; if (!mapping) throw Error('Unmapped GUI field: ' + field.name);
  [field.state,field.runtimePath,field.default,field.validation,field.tests] = mapping;
  field.persistence = 'running topology and startup configuration where saved; derived sessions excluded';
  field.parser = field.nodes[0] === 'wlc' ? 'wireless-controller-form.ts → IOSSession → ios-wireless.ts/shared IOS commands' : field.nodes[0] === 'poeswitch' ? 'poe-ui.ts → poe.ts' : 'wireless-ui.ts → validateWireless → shared device configuration';
  const reference=references.find(r=>r.name===field.name);if(reference)field.reference={kind:reference.kind,options:reference.options,validator:reference.validator};
  field.status = 'partial';
  field.evidenceScope = 'Every field has a source-to-state/runtime trace. Tests listed cover behavior subsets; a complete per-field validation/negation/reload matrix and actual Cisco transcript comparison are not yet verified.';
}
const actions = [];
for (const file of files.slice(0,2)) {
  const text=readFileSync(file,'utf8');
  for(const attribute of new Set(text.match(/data-(?:wireless|choose-ssid|poe|ap|coverage)[a-z-]*/g)??[])) actions.push({attribute,source:file,status:'source-traced',notes:attribute.includes('remove')?'Removes row on Apply; invalid remaining references reject transaction.':attribute.includes('power')?'Read-only AP electrical status; no AP power toggle exists.':'Control/monitoring hook; see source binding. Not counted as a configuration field.'});
}
const operationalViews=[{node:'ap',source:files[3],fields:['state','reason','controllerName','controllerAddress','assignment.policyTag','assignment.siteTag','assignment.rfTag','issues[]','radios[].band','radios[].operational','radios[].enabled','radios[].channel','radios[].width','radios[].power','radios[].profileName','wlans[].name','wlans[].ssid','wlans[].policyName','wlans[].security','wlans[].vlan','wlans[].central','wlans[].reason'],runtimePath:'wireless.apConfiguration → received CAPWAP configuration + effectiveRadios + advertisementsForAP',editable:false,status:'partial',evidence:'APCFG-01–06 received profile/forwarding/HTML/dependency/channel checks; WF-20 real reserved WLAN identity; 21-check wireless browser run verifies read-only radio/WLAN display; complete per-field boundaries remain partial'}];
const result={schemaVersion:3,profile:'Catalyst 9800 IOS XE 17.12 teaching subset; C9115 lightweight inspired; generic PoE+',generatedAt:new Date().toISOString(),generator:'node scripts/audit-wireless-gui.mjs',sources:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),counts:{fieldTemplates:fields.length,wlc:fields.filter(x=>x.nodes.includes('wlc')).length,ap:fields.filter(x=>x.nodes.includes('ap')).length,laptop:fields.filter(x=>x.nodes.includes('laptop')).length,poeswitch:fields.filter(x=>x.nodes.includes('poeswitch')).length,complete:0,partial:fields.length,monitoringAndActionHooks:actions.length,apReadOnlyDisplayFields:operationalViews[0].fields.length,referenceDropdownTemplates:references.length,hiddenControlMarkers:controlMarkers.length},fields,actions,operationalViews,references,controlMarkers};
mkdirSync('docs/audits',{recursive:true});writeFileSync('docs/audits/wireless-gui-inventory.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.counts));
