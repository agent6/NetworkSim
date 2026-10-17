import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync('src/windows-cli.ts','utf8'),lines=source.split('\n');
const base='https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/';
const records=[
 ['help | ?','help','complete','WIN-01','Local supported-command help','none','none','repaired'],
 ['hostname','execute','complete','WIN-01,WIN-18','config.hostname','none','lab config','retained'],
 ['ipconfig','ipConfiguration','partial','WIN-06','interfaces, interfaceUp, gateways','none','address config','repaired'],
 ['ipconfig /all','ipConfiguration','partial','WIN-06,WIN-07','MAC/address/DHCP/DNS operational state','none','config + transient lease','repaired'],
 ['ipconfig /renew [adapter]','ipconfig','partial','WIN-07','DHCP lease + interface/gateway/DNS','UDP67/68 and DHCP frames','runtime lease reacquired','repaired'],
 ['ipconfig /release [adapter]','ipconfig','partial','WIN-07','DHCP release + lease cleanup','UDP67/68','released lease not persisted','repaired'],
 ['ipconfig /renew6 [adapter]','ipconfig','partial','WIN-26','shared DHCPv6 client','UDP546/547','transient lease','retained'],
 ['ipconfig /release6 [adapter]','ipconfig','partial','WIN-26,WIN-27','only leased IPv6 address/prefix removed; static DNS/address preserved; server reclaim only after delivered release','DHCPv6 release/reply/retry through shared frames and relay','runtime lease removed, no automatic re-acquire until renew','added'],
 ['ipconfig /flushdns','ipconfig','complete','WIN-08','shared runtime DNS cache','none','runtime only','added'],
 ['ipconfig /displaydns','displayDNS','partial','WIN-08,WIN-15','shared positive/negative typed cache and TTL','none','runtime only','added'],
 ['ipconfig /autoconfig6','ipconfig','unsupported','existing tests/cli.test.ts SLAAC','LEGACY NON-WINDOWS alias retained with explicit notice','IPv6 RS/RA/ND','SLAAC runtime','legacy'],
 ['ping [-n count] [-l bytes] [-i ttl] [-w timeout] [-f] [-4|-6] target','ping','partial','WIN-02,WIN-13,WIN-15','shared echo probes/replies; bytes excludes IP/ICMP headers','ICMP/ICMPv6 through forwarding/ACL/ARP/ND','runtime diagnostics','repaired'],
 ['ping -t target','startContinuous','partial','WIN-03,WIN-20','clock-driven actual echo replies; Ctrl+C cancel','ICMP/ICMPv6','runtime session','added'],
 ['tracert [-d] [-h hops] [-w timeout] [-4|-6] target','trace','partial','WIN-04,WIN-23','three TTL probes/hop; delivered ICMP plus reverse PTR unless -d','ICMP TTL exceeded/echo and UDP53','runtime diagnostics','repaired'],
 ['pathping [-n] [-h hops] [-q count] [-p ms] [-w ms] [-4|-6] target','pathping','partial','WIN-05,WIN-23','actual hop echo samples; cumulative loss only; reverse PTR unless -n','ICMP/ICMPv6 and UDP53','runtime diagnostics','added'],
 ['nslookup [-type=A|AAAA|CNAME|MX|NS|PTR] name [server]','nslookup','partial','WIN-08,WIN-15','shared typed DNS server/cache; explicit server; reverse PTR','UDP53','server records config/cache runtime','repaired'],
 ['arp -a|-g [address] [-N interfaceAddress]','arp','partial','WIN-09','actual IPv4 runtime neighbor cache','none','runtime only','repaired'],
 ['arp -d address|* [interfaceAddress]','arp','partial','WIN-09','selected dynamic IPv4 entries; static/IPv6 retained','subsequent traffic re-ARPs','runtime only','repaired'],
 ['route print [filter]','routePrint','partial','WIN-10,WIN-17','shared operational IPv4/IPv6 routes','none','config/runtime route state','repaired'],
 ['route [-p] add destination [mask mask] gateway [metric N] [if index]','route','partial','WIN-10','active runtime Windows routes; -p config static routes','shared forwarding path selects routes','-p persisted; others reset','added'],
 ['route change destination [mask mask] gateway [metric N] [if index]','route','partial','WIN-22','replace existing next-hop/metric/interface without changing persistence; invalid values rejected before writes','actual delivered forwarding changes','preserves existing static or runtime store','added'],
 ['route delete destination [mask mask] [gateway]','route','partial','WIN-10,WIN-17','remove matching static/volatile/default gateway','traffic fails after withdrawal','removes matching config/runtime','added'],
 ['netstat [-a] [-n] [-an]','netstat','partial','WIN-11,FTPCLI-05','actual TCP channel snapshots + active service listeners, including enabled Server FTP TCP21','none; listeners backed by server handlers','runtime sessions/config listeners','repaired'],
 ['netstat -r','netstat','complete','WIN-11','same actual route table as route print','none','none','added'],
 ['netstat -e','ethernetStatistics','partial','WIN-19','actual aggregate bytes/frame/discard counters; physical errors/split unicast not modeled','none','runtime counters','added'],
 ['getmac [/v]','getmac','partial','WIN-11','engine adapter MAC and media state','none','deterministic MAC','repaired'],
 ['netsh interface show interface','netsh','partial','WIN-12','adapter admin/oper state','none','config admin','added'],
 ['netsh interface set interface name=adapter admin=enabled|disabled','netsh','partial','WIN-12','actual interface adminUp','traffic ceases/resumes; wireless sync','lab config','added'],
 ['netsh interface ipv4 show config|addresses|dnsservers|route','netshIP','partial','WIN-12','shared IPv4 config and routes','none','lab config','added'],
 ['netsh interface ipv4 set address name=adapter source=static address=ip mask=mask [gateway=ip|none]','netshIP','partial','WIN-12','stop DHCP; actual interface/gateway changes','actual traffic uses new source','lab config','added'],
 ['netsh interface ipv4 set address name=adapter source=dhcp','netshIP','partial','WIN-07','DHCP acquisition via engine','UDP67/68','lease transient','added'],
 ['netsh interface ipv4 set|add|delete dnsservers ...','netshIP','partial','WIN-12,WIN-16','shared dnsServers + static override respected by DHCP','subsequent DNS packets target selected server','lab config','added'],
 ['netsh interface ipv6 show interfaces|addresses|neighbors|route','netshIP','partial','WIN-13','operational IPv6 addresses/ND/RIB','none','config/runtime','added'],
 ['netsh interface ipv6 add|set|delete address interface=adapter address=IPv6/prefix [store=persistent]','netshIP','partial','WIN-13,WIN-25','actual persistent IPv6 config; named/indexed adapters; shared DAD/ND','actual IPv6 ICMP reachability','lab config','added'],
 ['netsh interface ipv6 add|set|delete route prefix=IPv6/prefix interface=adapter [nexthop=IPv6] [metric=N] [store=active|persistent]','netshIPv6Route','partial','WIN-24','IPv6 static route table shared with packet forwarding; selector/next-hop validated','real IPv6 forwarding and ICMPv6 failure/recovery','active resets, persistent lab config survives save/load','added'],
 ['netsh wlan show interfaces','wlan','partial','WIN-14','actual association/RF/runtime state','none','transient wireless association','added'],
 ['netsh wlan show networks [mode=bssid]','wlan','partial','WIN-14','engine RF advertisements, channel/security/signal','shared wireless model scan','runtime','added'],
 ['netsh wlan show profiles','wlan','partial','WIN-14','profiles from laptop GUI/current adapter and stored profiles','none','lab config','added'],
 ['netsh wlan connect name=profile [ssid=SSID] [interface=Wi-Fi]','wlan','partial','WIN-14','existing profile config then asynchronous authentication','real management/EAPOL/CAPWAP/RADIUS/DHCP model','profile config/association runtime','added'],
 ['netsh wlan disconnect [interface=Wi-Fi]','wlan','partial','WIN-14','turn off autoConnect through wireless state machine','disassociation + forwarding loss','adapter preference config','added'],
 ['ssh | telnet','execute','partial','tests/management.test.ts + legacy host delegate','shared management TCP sessions','TCP22/23','runtime session','retained'],
 ['cls','execute','complete','windows-browser-validation.json: CLS','clears rendered terminal output; keeps prompt and command history','none','display only','repaired'],
 ['nbtstat','execute','unsupported','WIN-01','NetBIOS/NetBT/WINS not modeled','none','none','unsupported'],
 ['Windows OS processes/registry/PowerShell service administration','execute','unsupported','WIN-01','server services use explicit NetworkSim GUI','none','none','unsupported']
];
const rootMatches=[...source.matchAll(/command==='([^']+)'/g)].map(m=>({command:m[1],file:'src/windows-cli.ts',line:source.slice(0,m.index).split('\n').length}));
const roots=[...new Map(rootMatches.map(r=>[r.command,r])).values()];
const sourceLocation=method=>{const index=lines.findIndex(line=>line.includes(' '+method+'('));return {file:'src/windows-cli.ts',line:index+1,method};};
const inventory={schemaVersion:1,generatedAt:new Date().toISOString(),profiles:{pc:'Windows 11 24H2 networking subset',laptop:'Windows 11 24H2 networking subset',server:'Windows Server 2025 networking subset'},nativeWindowsObserved:false,referenceMethod:'Official Microsoft command documentation; original simulation tests. No native Windows output captures were available.',sourceSha256:createHash('sha256').update(source).digest('hex'),counts:{roots:roots.length,variants:records.length,complete:records.filter(r=>r[2]==='complete').length,partial:records.filter(r=>r[2]==='partial').length,unsupported:records.filter(r=>r[2]==='unsupported').length},automaticallyExtractedRoots:roots,commands:records.map((r,index)=>({id:'WIN-CMD-'+String(index+1).padStart(3,'0'),node:['pc','laptop','server'],platform:'Windows 11 24H2 / Server 2025 networking subset',command:r[0],mode:'CMD',parser:sourceLocation(r[1]),status:r[2],testIds:r[3].split(','),state:r[4],packetBehavior:r[5],saveReload:r[6],change:r[7],reference:base+(r[0].startsWith('route')?'route_ws2008':r[0].startsWith('netsh wlan')?'netsh-wlan':r[0].startsWith('netsh')?'netsh-interface':r[0].split(/[ |\[]/)[0]),referenceComparison:'Documentation-reviewed; native golden output unverified'}))};
writeFileSync('docs/audits/windows-command-inventory.json',JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify(inventory.counts));
