import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Extract every current named field template, including repeated radios and
// switch ports. This is an implementation inventory, not a vendor GUI fixture.
const files = ['src/wireless-ui.ts', 'src/poe-ui.ts', 'src/wireless-controller-form.ts', 'src/ap-controller-view.ts', 'src/wlc-reference-ui.ts', 'src/wlc-administration.ts', 'src/wlc-monitoring.ts', 'src/wireless-policy.ts', 'src/wireless.ts', 'src/wireless-model.ts', 'src/ios-wireless.ts', 'src/wireless-security.ts', 'src/poe.ts', 'src/engine.ts', 'src/management.ts', 'src/aaa-service.ts', 'src/snmp.ts', 'src/packet-policy.ts', 'src/standalone-ap.ts', 'src/ios-standalone-ap.ts'];
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
const adminSource=readFileSync('src/wlc-administration.ts','utf8');
for(const m of adminSource.matchAll(/\b(input|select|toggle)\('([^']*)','([^']*)'\s*,/g))fields.push({name:m[3],label:m[2],type:m[1]==='toggle'?'checkbox':m[1],nodes:['wlc'],source:`src/wlc-administration.ts:${adminSource.slice(0,m.index).split('\n').length}`,repeat:/admin-(server|group|dot1x|user|community|trap|ap-list)-/.test(m[3])?'per configured row':'once'});
const standaloneSource=readFileSync('src/standalone-ap.ts','utf8');for(const m of standaloneSource.matchAll(/\b(input|select)\('([^']*)','([^']*)'\s*,/g))fields.push({name:m[3],label:m[2],type:m[1],nodes:['ap'],source:`src/standalone-ap.ts:${standaloneSource.slice(0,m.index).split('\n').length}`,repeat:m[3].startsWith('local-radio-')?'per radio':m[3]==='ap-profile'||m[3]==='local-native'?'once':'per local SSID'});
const references=[...source.matchAll(/\bwlcReference\('([^']*)','([^']*)',(.+?),'([^']+)',catalog\)/g)].map(m=>({name:m[2],label:m[1],kind:m[4],source:`${files[0]}:${source.slice(0,m.index).split('\n').length}`,options:'existing own profile/interface names plus unsaved form rows; removed or incompatible selections retained as unavailable and invalid',validator:'bindWLCReferences custom validity, invalid-section reveal, then transactional controllerFormDraft parser',status:'partial'}));
const controlMarkers=[{name:'policy-tag-definitions',type:'hidden',meaning:'Current form explicitly declares all policy tags, including empty tags; absence preserves older form compatibility',persistent:false,source:files[0],parser:files[2]}];
controlMarkers.push({name:'wlc-administration',type:'hidden',meaning:'Current form includes controller administration; older forms leave these shared service settings unchanged',persistent:false,source:'src/wlc-administration.ts',parser:'src/wlc-administration.ts'});
controlMarkers.push({name:'local-original',type:'hidden',meaning:'Retain local SSID identity while renaming a represented standalone row',persistent:false,source:'src/standalone-ap.ts',parser:'src/standalone-ap.ts'});
if(!source.includes('name="policy-tag-definitions"'))throw Error('Policy-tag control marker extraction drift');
const poeSource = readFileSync(files[1],'utf8');
for (const [name,label,type,repeat] of [['poe-budget','Available PoE budget (W)','number','once'],['poe-mode','Power mode','select','24 PoE access ports'],['poe-max','Power limit (mW)','number','24 PoE access ports'],['poe-priority','Power priority','select','24 PoE access ports']]) {
  if (!poeSource.includes(`name="${name}"`)) throw Error('PoE extraction drift: ' + name);
  fields.push({name,label,type,nodes:['poeswitch'],source:`${files[1]}:${poeSource.slice(0,poeSource.indexOf(`name="${name}"`)).split('\n').length}`,repeat});
}
const state = {
 coverage:['config.features.wirelessCoverage','main.ts coverage circles; presentation only','false','boolean','WL browser optional coverage'],
 'ap-profile':['wireless.profile','lightweight CAPWAP lifecycle or independent local SSID/association/Ethernet bridge','c9115-lightweight','c9115-lightweight | generic-standalone; explicit distinct teaching profile','SAP-01–08 no-WLC packets, failure, native replay, PoE/reset/save-load, profile reversal and symmetric reload retention; standalone browser'],
 'local-native':['wireless.standalone.nativeVlan','actual client VLAN tag removal/ingress classification on the AP uplink','1','integer 1–4094','SAP-01 tagged VLAN20 forwarding; SAP-07 untagged access VLAN20 with no AP management IP'],
 'local-ssid':['wireless.wlans[SSID].ssid/name','actual local advertisement, handshake and client selection without WLC','empty','unique nonempty 1–32 bytes when present; up to16','SAP-01/02/05/06'],
 'local-vlan':['wireless.policies[SSID].vlan','real local Ethernet client VLAN and DHCP/return traffic','1','integer 1–4094','SAP-01/02 actual correct/filtered VLAN forwarding'],
 'local-security':['wireless.wlans[SSID].security','shared open or WPA2 four-way authentication','wpa2-personal in GUI','open | wpa2-personal; no native cryptographic interoperability','SAP-01/02 wrong/correct key and cipher dependency; standalone browser'],
 'local-psk':['wireless.wlans[SSID].psk','shared WPA2 PMK and MIC confirmation before data authorization','empty','8–63 ASCII or64 hex for WPA2','SAP-01/02/05/06 and browser wrong-key recovery'],
 'local-broadcast':['wireless.wlans[SSID].broadcast','beacon visibility; directed preferred SSID remains eligible','broadcast','on | off','SAP-01 native guest-mode; shared hidden SSID WF-17; standalone hidden-specific matrix partial'],
 'local-enabled':['wireless.wlans[SSID].enabled','removes disabled SSID from actual advertisements and sessions','on','on | off','SAP-01 local policy binding; explicit disable matrix partial'],
 'local-auth':['wireless.wlans[SSID].openAuthentication','native open-system authentication prerequisite; false suppresses local service','on in GUI; false newly created CLI SSID','on | off','SAP-01/05 native authentication open; explicit false matrix partial'],
 'local-bands':['wireless.standalone.bindings[].ssids','actual SSID attachment per radio; removed attachment disconnects clients','both in new GUI row','none | both | 2.4 | 5','SAP-01/02 radio149/attachment removal; SAP-06 GUI band assignment and unchanged unattached SSID preservation'],
 'local-aes':['wireless.standalone.bindings[].aesVlans','WPA2 advertisement requires AES cipher configured on client VLAN/radio','on in new GUI row; preserve for asymmetric CLI settings','on | off | preserve; native encryption vlan mode ciphers aes-ccm subset','SAP-02 missing AES suppresses service and restoring it authenticates; SAP-06 preserves asymmetric and unrelated native cipher VLANs on Apply'],
 'local-radio-enabled':['wireless.radios[].enabled','actual standalone beacon/association/data eligibility','on','on | off','standalone browser native shutdown/no shutdown; shared radio tests'],
 'local-radio-channel':['wireless.radios[].channel','actual standalone RF/band/channel selection and session signature','1 /36','2.4:1/6/11;5:36/40/44/48/149/153/157/161/165','SAP-01 channel149 and SAP-06 GUI channel6; browser'],
 'local-radio-width':['wireless.radios[].width','actual estimated rate and scheduled airtime','20 MHz','2.4:20;5:20/40/80','shared RF rate model; standalone dedicated width boundary matrix partial'],
 'local-radio-power':['wireless.radios[].power','actual RSSI/SNR and shared RF admission','17 dBm','integer -10–30 teaching range','shared RF tests; standalone dedicated power boundary matrix partial'],
 'local-radio-clients':['wireless.radios[].maxClients','actual association/pending admission limit on selected radio','100','integer1–200','shared admission test; standalone-specific full matrix partial'],
 'adapter-enabled':['wireless.adapter.enabled','tickClient → disconnect/scan → Wireless0 interface','true','boolean','WL-05/06/07/24'],
 'auto-connect':['wireless.adapter.autoConnect','tickClient → IDLE/reconnect','true','boolean','source trace; dedicated GUI invalid/reload cases pending'],
 'pmf-capable':['wireless.adapter.pmfCapable','SAE/mandatory-PMF admission and protected administrative deauthentication','true when absent','boolean; false prevents SAE or mandatory PMF association','WPA3-01/02/03 actual negotiated security and failures'],
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
 'wlan-pmf':['wireless.wlans[name].pmf','actual association admission and protected management flag','pure SAE mandatory; transition optional; legacy disabled','default | disabled | optional | required; SAE cannot disable; pure SAE requires mandatory','WPA3-01/02/03/04'],
 'wlan-enabled':['wireless.wlans[name].enabled','AP advertisement and session eligibility','disabled for new WLAN','on | off','WF-12; source trace'],
 'wlan-broadcast':['wireless.wlans[name].broadcast','beacon/probe visibility; directed preferred SSID scan','broadcast','on | off','WF-17 hidden directed association and unknown-client scan visibility'],
 'policy-tag-name':['wireless.policyTags[name]','WLAN/policy mapping namespace consumed by delivered AP configuration; empty tags can be created and removed','default-policy-tag exists','unique profile name; selected references must exist; built-in name read-only and nonremovable','APCFG-07/08; WLC reference browser unsaved create, mappings, empty-tag persistence and deletion'],
 'policy-name':['wireless.policies[name].name','WLAN policy reference','empty','profile name; duplicate rejected','WF-11/12'],
 'policy-vlan':['wireless.policies[name].vlan','actual Ethernet/VLAN and CAPWAP data encapsulation','1','1–4094','WL-14/28; routed ACL test'],
 'policy-switch':['wireless.policies[name].centralSwitching','central UDP5247 vs local AP Ethernet path','central','central | local; local requires Flex site','WL-12; WF-01/11'],
 'policy-enabled':['wireless.policies[name].enabled','AP advertisement/session eligibility','disabled for new policy','on | off','source trace; parser and form tests'],
 'policy-timeout':['wireless.policies[name].sessionTimeout','session expiration → disconnect/reauth','1800 seconds','1–86400 seconds','WF-17 real configured expiry forces a fresh handshake; full timer boundaries pending'],
 'policy-acl':['wireless.policies[name].ipv4Acl','shared IPv4 ACL on real client IP packets; received dependency snapshot for Flex local','unset','existing IPv4 ACL or blank; missing dependency denies traffic','WADM-06 actual ICMP deny/permit and rule update propagation'],
 'policy-input':['wireless.policies[name].servicePolicyIn','shared aggregate input QoS classification/DSCP marking/policing on actual packet','unset','existing policy map without physical queuing actions','WADM-07/08 shared QoS marking/policing and queue rejection; aggregate input subset'],
 'policy-output':['wireless.policies[name].servicePolicyOut','shared aggregate output QoS on actual per-client downlink copies','unset','existing policy map without physical queuing actions','WADM-14 actual downstream DSCP and direction counters in central/Flex'],
 'policy-client-input':['wireless.policies[name].clientServicePolicyIn','shared per-client input token bucket/counters and actual inner IP packet marking','unset','existing policy map without physical queuing actions','WADM-07 actual server-received DSCP and policer loss in central/Flex'],
 'policy-client-output':['wireless.policies[name].clientServicePolicyOut','shared per-client output token bucket/counters and actual downlink packet marking','unset','existing policy map without physical queuing actions','WADM-14 actual downstream DSCP and direction counters in central/Flex'],
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
const adminPaths={
 'aaa-enabled':['features.aaa.enabled','AAA new-model gates AP authorization and management authentication','false','boolean'],
 'server-name':['features.aaa.servers[name]','native named server → delivered UDP RADIUS or TCP TACACS request','empty','unique 1–32 character name'],
 'server-protocol':['features.aaa.servers[name].protocol','selects UDP1812 or TCP49 shared AAA service','radius','radius | tacacs'],
 'server-address':['features.aaa.servers[name].address','actual routed AAA destination','unset','IPv4'],
 'server-port':['features.aaa.servers[name].port','actual UDP/TCP destination port','1812 / 49','integer 1–65535'],
 'server-accounting':['features.aaa.servers[name].accountingPort','shared RADIUS accounting destination when accounting is configured','1813','integer 1–65535; RADIUS only'],
 'server-key':['features.aaa.servers[name].key','shared-secret acceptance on delivered AAA request','empty','single-line lab credential'],
 'server-timeout':['features.aaa.servers[name].timeout','real request timeout before retries/failover','5 seconds in GUI','native IOS numeric validation'],
 'server-retries':['features.aaa.servers[name].retransmit','real RADIUS retransmission and sequential failover','0','native IOS numeric validation; RADIUS only'],
 'group-name':['features.aaa.groups[name]','method-list dependency used by real AAA requests','empty','unique 1–32 character name'],
 'group-protocol':['features.aaa.groups[name].protocol','restricts group membership to selected protocol','radius','radius | tacacs'],
 'group-servers':['features.aaa.groups[name].servers','ordered actual server attempts','empty','unique existing same-protocol server names, comma-separated'],
 'dot1x-name':['features.wireless.dot1xLists[name]','WLAN authentication-list → RADIUS group → delivered requests','empty','unique 1–32 character name'],
 'dot1x-group':['features.wireless.dot1xLists[name] value','delivered RADIUS enterprise client authentication','empty','existing RADIUS group or radius aggregate'],
 'user-name':['features.users[name]','shared local HTTP/CLI/model-driven management identity','empty','unique 1–32 character name'],
 'user-password':['features.users[name].secret','real local password comparison','empty','nonempty single-line credential'],
 'user-privilege':['features.users[name].privilege','shared management authorization privilege','15 new row','integer 0–15'],
 'login-group':['features.aaa.login.default','real default login method list; advanced unrepresented chains retained','local','existing group | local | none | radius | tacacs+ | keep'],
 'login-fallback':['features.aaa.login.default[]','local authentication only if remote group unavailable','false','boolean'],
 'ap-enabled':['features.wireless.apAuthorization.enabled','CAPWAP join waits for real local/RADIUS MAC authorization','false','boolean; enabled requires AAA and existing list'],
 'ap-method':['features.wireless.apAuthorization.methodList','selects local or real RADIUS authorization at AP join','default','existing authorization list when enabled'],
 'ap-macs':['features.wireless.apAuthorization.macs','local Ethernet-MAC database used by join authorization','empty','unique canonical 12-hex MAC addresses'],
 'ap-list-name':['features.wireless.apAuthorization.lists[name]','safe own-key authorization method dependency','empty','unique 1–32 character name'],
 'ap-list-method':['features.wireless.apAuthorization.lists[name].method','local comparison or delivered RADIUS requests','local','local | radius'],
 'ap-list-group':['features.wireless.apAuthorization.lists[name].group','ordered RADIUS server group for AP authorization','empty','existing RADIUS group or radius aggregate'],
 'ntp-servers':['features.ntp.servers[]','delivered UDP123 response updates device clock synchronization','empty','IPv4 addresses, comma-separated'],
 'ntp-source':['features.ntp.source','real NTP packet source interface/address','default','existing interface or blank'],
 'ntp-poll':['features.ntp.pollInterval','actual recurring NTP request schedule','64 seconds','native IOS interval range'],
 'log-hosts':['features.logging.hosts[]','delivered UDP514 syslog collector records','empty','IPv4 destinations, comma-separated'],
 'log-level':['features.logging.trap','actual remote severity filter','6','integer 0–7'],
 'log-source':['features.logging.source','real syslog source interface/address','default','existing interface or blank'],
 'log-enabled':['features.logging.trapEnabled; enabled','gates actual remote log transmission without erasing buffered logging','true','boolean'],
 'community-name':['features.snmp.communities[name]','real SNMP GET/GETNEXT credential and view/ACL authorization','empty','nonempty unique no-whitespace community'],
 'community-access':['features.snmp.communities[name].access','shared SNMP authorization; modeled MIB rejects SET','ro','ro | rw configuration'],
 'community-view':['features.snmp.communities[name].view','actual OID subtree inclusion/exclusion','unset','existing SNMP view or blank'],
 'community-acl':['features.snmp.communities[name].acl','actual SNMP manager source authorization','unset','existing ACL or blank'],
 'trap-address':['features.snmp.hosts[].address','delivered v2c UDP162 notification destination','empty','unique IPv4 destination'],
 'trap-community':['features.snmp.hosts[].options','actual v2c notification community','empty','native IOS credential validation'],
 'snmp-location':['features.snmp.location','actual sysLocation MIB value returned in delivered SNMP response','empty','single-line native IOS text'],
 'snmp-contact':['features.snmp.contact','actual sysContact MIB value returned in delivered SNMP response','empty','single-line native IOS text'],
 'snmp-source':['features.snmp.trap-source','real SNMP notification source interface/address','default','existing interface or blank'],
 'snmp-traps':['features.snmp.traps','enables real v2c notifications; informs and v3 notifications remain outside editor','false','boolean'],
 'https-enabled':['services.http.secureEnabled','actual simulated HTTPS443 service availability','false','boolean; logical TLS transport'],
 'http-auth':['services.http.authentication','real shared HTTP local/enable/AAA authorization','none','none | local | enable | aaa'],
 'http-list':['services.http.authenticationList','actual AAA login list for HTTPS authentication','default','existing own AAA login list when aaa selected'],
 'http-acl':['services.http.acl','actual HTTP access-class source gate before service dispatch','unset','existing ACL or blank'],
};
for(const [key,values]of Object.entries(adminPaths))state['admin-'+key]=[...values,/^ap-/.test(key)?'WADM-04/05/10/11/13/16 local/RADIUS/reject/failover/power cancellation and live-database rejoin':/^(server|group|dot1x|login|user|http|https)/.test(key)?'WADM-01/02/12 GUI-derived authentication, validation and TCP TACACS; per-field boundaries remain partial':'WADM-01/15 real NTP/syslog/SNMP GET and authentication-failure trap packets; full individual-field matrix remains partial'];
for(const name of['security','wlan-security']){state[name][1]='mode negotiation → open/WPA2 EAP/PSK or logical SAE → controlled data port';state[name][3]='open | wpa2-personal | wpa2-enterprise | wpa3-personal | wpa2-wpa3-personal';state[name][4]+='; WPA3-01–05 SAE/transition/PMF failure, packet service and save/reload';}
for(const name of['passphrase','wlan-psk']){state[name][1]='WPA2 PBKDF2/four-way validation or logical SAE password confirmation';state[name][3]='8–63 ASCII or 64 hex lab credential';state[name][4]+='; WPA3-01/02';}
state['poe-max'][1]='actual allocation: ≥30000mW default 4-stream profile; explicit15400–29999mW 802.3af reduced 2-stream profile; insufficient limit denies';state['poe-max'][4]+='; POE-14 supply/rate/traffic/persistence; WADM-09 effective rate and AP diagnostics';
for (const field of fields) {
  const mapping = state[field.name]; if (!mapping) throw Error('Unmapped GUI field: ' + field.name);
  [field.state,field.runtimePath,field.default,field.validation,field.tests] = mapping;
  field.persistence = 'running topology and startup configuration where saved; derived sessions excluded';
  field.parser = field.name==='ap-profile'||field.name.startsWith('local-') ? 'standalone-ap.ts → isolated applyAPProfileFields → validateWireless; ios-standalone-ap.ts shares the configuration' : field.name.startsWith('admin-') ? 'wireless-controller-form.ts → applyWLCAdministration isolated draft → IOSSession/shared IOS commands' : field.nodes[0] === 'wlc' ? 'wireless-controller-form.ts → IOSSession → ios-wireless.ts/shared IOS commands' : field.nodes[0] === 'poeswitch' ? 'poe-ui.ts → poe.ts' : 'wireless-ui.ts → validateWireless → shared device configuration';
  const reference=references.find(r=>r.name===field.name);if(reference)field.reference={kind:reference.kind,options:reference.options,validator:reference.validator};
  field.status = 'partial';
  field.evidenceScope = 'Every field has a source-to-state/runtime trace. Tests listed cover behavior subsets; a complete per-field validation/negation/reload matrix and actual Cisco transcript comparison are not yet verified.';
}
const actions = [];
for (const file of [files[0],files[1],files[5],files[6],files[18]]) {
  const text=readFileSync(file,'utf8');
  for(const attribute of new Set(text.match(/data-(?:wireless|choose-ssid|poe|ap|coverage|admin|wlc|local|standalone)[a-z-]*/g)??[])) actions.push({attribute,source:file,status:'source-traced',notes:attribute.includes('remove')?'Removes row on Apply; invalid remaining references reject transaction.':attribute.includes('power')?'Read-only AP electrical status; no AP power toggle exists.':attribute.includes('disconnect')?'Delivered CAPWAP administrative deauthentication; automatic client may reconnect.':attribute.includes('reload')?'Explicit saved/save-and-reload choice calls real Simulator.reload; unsaved draft fields must be Applied first.':attribute.includes('save')?'Native write memory stores applied running configuration.':'Control/monitoring hook; see source binding. Not counted as a configuration field.'});
}
const operationalViews=[{node:'ap',source:files[3],fields:['state','reason','controllerName','controllerAddress','assignment.policyTag','assignment.siteTag','assignment.rfTag','issues[]','radios[].band','radios[].operational','radios[].enabled','radios[].channel','radios[].width','radios[].power','radios[].profileName','radios[].spatialStreams','wlans[].name','wlans[].ssid','wlans[].policyName','wlans[].security','wlans[].vlan','wlans[].central','wlans[].reason'],runtimePath:'wireless.apConfiguration → received CAPWAP configuration + effectiveRadios + advertisementsForAP',editable:false,status:'partial',evidence:'APCFG-01–06 received profile/forwarding/HTML/dependency/channel checks; WF-20 real reserved WLAN identity; 21-check wireless browser run verifies read-only radio/WLAN display; complete per-field boundaries remain partial'}];
const result={schemaVersion:4,profile:'Catalyst 9800 IOS XE 17.12 teaching subset; C9115 lightweight inspired; generic PoE+',generatedAt:new Date().toISOString(),generator:'node scripts/audit-wireless-gui.mjs',sources:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),counts:{fieldTemplates:fields.length,wlc:fields.filter(x=>x.nodes.includes('wlc')).length,ap:fields.filter(x=>x.nodes.includes('ap')).length,laptop:fields.filter(x=>x.nodes.includes('laptop')).length,poeswitch:fields.filter(x=>x.nodes.includes('poeswitch')).length,complete:0,partial:fields.length,monitoringAndActionHooks:actions.length,apReadOnlyDisplayFields:operationalViews[0].fields.length,referenceDropdownTemplates:references.length,hiddenControlMarkers:controlMarkers.length},fields,actions,operationalViews,references,controlMarkers};
mkdirSync('docs/audits',{recursive:true});writeFileSync('docs/audits/wireless-gui-inventory.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.counts));
