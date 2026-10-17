// Independently authored arguments/preconditions for executable registration probes.
export const argumentFixtures={
 'priv|reload at':['reload at 23:59'],
 'priv|reload in':['reload in 5'],
 'config|ip msdp peer':['ip msdp peer 192.0.2.1 remote-as 65001'],
 'config-track|object':['object 2'],
 'config-track|threshold':['threshold weight up 20 down 10'],
 'config-track|ip vrf':['ip vrf BLUE'],
 'config-dhcp-guard|preference':['preference min 10'],
 'config-dhcp-guard|match':['match server access-list ALLOW6'],
 'config-line|login authentication':['login authentication default'],
 'config|ip dhcp pool':['ip dhcp pool POOL'],
 'config|ip route':['ip route 192.0.2.0 255.255.255.0 Null0'],
 'config|ip nat pool':['ip nat pool POOL 198.51.100.1 198.51.100.10 netmask 255.255.255.0'],
 'config|ip prefix-list':['ip prefix-list FILTER permit 192.0.2.0/24'],
 'config|logging host':['logging host 192.0.2.1'],
 'config|banner':['banner motd #Authorized laboratory users#'],
 'config|aaa authentication login':['aaa authentication login default local'],
 'config|aaa authentication enable':['aaa authentication enable default enable'],
 'config|aaa authorization':['aaa authorization exec default local'],
 'config|aaa accounting':['aaa accounting exec default start-stop group radius'],
 'config|aaa group server':['aaa group server radius GROUP'],
 'config|tacacs server':['tacacs server AUTH'],
 'config|radius server':['radius server AUTH'],
 'config|radius-server':['radius-server host 192.0.2.1 key lab'],
 'config|config-register':['config-register 0x2102'],
 'config|ptp':['ptp mode boundary'],
 'config|spanning-tree vlan':['spanning-tree vlan 1 priority 4096'],
 'config-dhcp|network':['network 192.0.2.0 255.255.255.0'],
 'config-dhcp|default-router':['default-router 192.0.2.1'],
 'config-dhcp|dns-server':['dns-server 192.0.2.53'],
 'config-dhcp|next-server':['next-server 192.0.2.1'],
 'config-dhcpv6|dns-server':['dns-server 2001:db8::53'],
 'config-router|summary-address':['summary-address 192.0.2.0 255.255.255.0'],
 'config-router-eigrp|metric weights':['metric weights 0 1 0 1 0 0'],
 'config-router-eigrp-af|metric weights':['metric weights 0 1 0 1 0 0'],
 'config-router-eigrp-vaf|metric weights':['metric weights 0 1 0 1 0 0'],
 'config-router|auto-cost':['auto-cost reference-bandwidth 1000'],
 'config-router-ospfv3|auto-cost':['auto-cost reference-bandwidth 1000'],
 'config-router-ospfv3-af|auto-cost':['auto-cost reference-bandwidth 1000'],
 'config-router-eigrp|summary-metric':['summary-metric 192.0.2.0/24 100000 10 255 1 1500'],
 'config-router-eigrp-aft|summary-metric':['summary-metric 192.0.2.0/24 100000 10 255 1 1500'],
 'config-router-eigrp-afi|summary-address':['summary-address 192.0.2.0 255.255.255.0'],
 'config-keychain-key|send-lifetime':['send-lifetime 00:00:00 Jan 1 2026 infinite'],
 'config-keychain-key|accept-lifetime':['accept-lifetime 00:00:00 Jan 1 2026 infinite'],
 'config-mst|instance':['instance 1 vlan 10,20'],
 'config-time-range|absolute':['absolute start 00:00 1 Jan 2026 end 23:59 31 Dec 2026'],
 'config-time-range|periodic':['periodic daily 08:00 to 17:00'],
 'config-vrf|rd':['rd 65000:10'],
 'config-vrf|route-target':['route-target both 65000:10'],
 'config-vrf-af|route-target':['route-target both 65000:10'],
 'config-radius-server|address':['address ipv4 192.0.2.1 auth-port 1812 acct-port 1813'],
 'config-server-tacacs|address':['address ipv4 192.0.2.1'],
 'config-ip-sla|icmp-echo':['icmp-echo 192.0.2.1'],
 'config-ip-sla|udp-jitter':['udp-jitter 192.0.2.1 5000'],
 'config-ip-sla|http':['http get http://192.0.2.1/'],
 'config-ipv6-acl|sequence':['sequence 10 permit ipv6 any any'],
 'config-flow-exporter|source':['source GigabitEthernet0/0'],
 'priv|clock set':['clock set 12:00:00 16 Oct 2026'],
 'priv|test aaa group':['test aaa group radius trainee lab legacy'],
 'priv|ssh':['ssh -l trainee 192.0.2.1'],
 'user|ssh':['ssh -l trainee 192.0.2.1'],
};
for(const mode of ['user','priv']){argumentFixtures[mode+'|show ip rpf']=['show ip rpf 192.0.2.1'];argumentFixtures[mode+'|show spanning-tree vlan']=['show spanning-tree vlan 1'];argumentFixtures[mode+'|show vlan id']=['show vlan id 1'];}
for(const mode of ['config-if','config-if-range','config-subif'])for(const [path,command]of Object.entries({
 'encapsulation dot1Q':'encapsulation dot1Q 10','negotiation':'negotiation auto','ip nhrp':'ip nhrp network-id 10','ip vrf':'ip vrf forwarding BLUE','ip summary-address rip':'ip summary-address rip 192.0.2.0 255.255.255.0','vrf':'vrf forwarding BLUE','tunnel':'tunnel source GigabitEthernet0/0','tunnel key':'tunnel key 10','tunnel protection':'tunnel protection ipsec profile VPN','crypto':'crypto map VPN','switchport access vlan':'switchport access vlan 10','switchport port-security mac-address':'switchport port-security mac-address sticky','switchport port-security aging':'switchport port-security aging time 10','spanning-tree port-priority':'spanning-tree port-priority 16','spanning-tree vlan':'spanning-tree vlan 1 cost 10','storm-control broadcast level':'storm-control broadcast level 10','storm-control multicast level':'storm-control multicast level 10','storm-control unicast level':'storm-control unicast level 10','device-tracking attach-policy':'device-tracking attach-policy TRACK'}))argumentFixtures[mode+'|'+path]=[command];
Object.assign(argumentFixtures,{
 'user|tracert':['tracert 192.0.2.1'],'user|arp':['arp -a'],'user|route':['route print'],'user|nslookup':['nslookup example.test'],'user|telnet':['telnet 192.0.2.1'],'priv|telnet':['telnet 192.0.2.1'],
 'priv|event':['event manager run AUDIT'],'priv|more':['more flash:parity.txt'],'priv|delete':['delete flash:parity.txt'],'priv|clear ip bgp':['clear ip bgp *'],
 'config-if|media-type':['media-type rj45'],'config-if-range|media-type':['media-type rj45'],'config-applet|action':['action 1 cli command "show clock"'],
 'config-server-tacacs|key':['key 0 lab'],'config-radius-server|key':['key 0 lab'],'config-rtr|auto-cost':['auto-cost reference-bandwidth 1000'],'config-rtr-eigrp|metric weights':['metric weights 0 1 0 1 0 0'],
 'config-ipsec-profile|set transform-set':['set transform-set AUDIT'],'config-track|delay':['delay up 10 down 10'],
 'config-flow-record|description':['description Audit record'],'config-flow-exporter|description':['description Audit exporter'],'config-flow-monitor|description':['description Audit monitor'],
 'config|vlan':['vlan 10'],'config|vlan configuration':['vlan configuration 10'],
 'user|show etherchannel':['show etherchannel summary'],'priv|show etherchannel':['show etherchannel summary'],
 'config-router-eigrp|address-family':['address-family ipv4 vrf AUDIT autonomous-system 100'],'config-router-rip|address-family':['address-family ipv4 vrf AUDIT'],
 'config|service timestamps':['service timestamps log datetime msec'],
 'config|ip igmp':['ip igmp snooping'],
 'config-router|address-family':['address-family ipv4 unicast'],
 'config-flow-monitor|record':['record AUDIT'],
 'config-flow-monitor|exporter':['exporter AUDIT'],
 'priv|test etherchannel load-balance':['test etherchannel load-balance interface Port-channel1 ip 192.0.2.1 192.0.2.2'],
});
export function fixtureContext(mode,path,base){
 const setup=[...(base.setup||[])];
 if(mode==='priv'&&path==='event')setup.push('configure terminal','event manager applet AUDIT','event none','action 1 cli command "show clock"','end');
 if(mode==='priv'&&path==='test aaa group')setup.push('configure terminal','aaa new-model','radius-server host 192.0.2.1 key lab','end');
 if(mode==='priv'&&path==='test etherchannel load-balance')return {...base,type:'switch',model:'NETLAB-S24T',setup:['configure terminal','interface range GigabitEthernet0/1 - 2','channel-group 1 mode on','end']};
 if(mode==='config'&&path==='restconf')setup.unshift('ip http secure-server');
 if(mode==='config'&&path==='ip igmp')return {...base,type:'switch',model:'NETLAB-S24T',setup};
 if(mode==='config-track'&&['object','threshold'].includes(path))return {...base,setup:['track 2 interface GigabitEthernet0/0 line-protocol','exit','track 1 list threshold weight']};
 if(mode==='config-router-eigrp-afi'&&path==='summary-address')return {...base,setup:setup.map(line=>line==='af-interface default'?'af-interface GigabitEthernet0/0':line)};
 if(mode==='config-router'&&path==='address-family')return {...base,setup:['router ospfv3 1']};
 if(mode==='config-router'&&path==='capability vrf-lite')return {...base,setup:['vrf definition AUDIT','exit','router ospf 1 vrf AUDIT']};
 if(mode==='priv'&&['more','delete'].includes(path))setup.push('copy running-config flash:parity.txt');
 if(mode==='config-dhcpv6'&&path==='prefix-delegation')setup.unshift('ipv6 local pool AUDIT 2001:db8:100::/48 64');
 if(mode==='config-sg-tacacs+'||mode==='config-sg-radius')setup.unshift('aaa new-model',mode==='config-sg-radius'?'radius server AUDIT':'tacacs server AUDIT','address ipv4 192.0.2.1','exit');
 if(mode==='config-ipsec-profile')setup.unshift('crypto ipsec transform-set AUDIT esp-aes esp-sha-hmac','exit');
 if(['config-router-eigrp','config-router-rip'].includes(mode)&&path==='address-family')setup.unshift('vrf definition AUDIT','exit');
 if(mode==='config-crypto-map'&&path==='match')setup.unshift('access-list 100 permit ip any any');
 if(mode==='config-flow-monitor'&&path==='record')setup.unshift('flow record AUDIT','exit');
 if(mode==='config-flow-monitor'&&path==='exporter')setup.unshift('flow exporter AUDIT','exit');

 if(mode==='config'&&/^(aaa |tacacs server|radius server|radius-server)/.test(path))setup.unshift('aaa new-model');
 if(mode!=='config-subif'&&/switchport (?:port-security|nonegotiate)/.test(path))setup.push('switchport mode access');
 if(path==='ip access-group'||path==='access-class')setup.unshift('access-list 10 permit any');
 if(path==='ipv6 traffic-filter'||path==='ipv6 access-class'||mode==='config-dhcp-guard')setup.unshift('ipv6 access-list ALLOW6','permit ipv6 any any','exit','ipv6 access-list AUDIT','permit ipv6 any any','exit');
 if(path==='service-policy')setup.unshift('policy-map AUDIT','exit');
 if(path==='login authentication')setup.unshift('aaa new-model','aaa authentication login default local');
 if(path==='crypto key generate rsa')setup.unshift('ip domain-name lab.example');
 if(/^(?:ip )?vrf$/.test(path))setup.unshift('vrf definition BLUE','exit');
 if(path==='tunnel protection')setup.unshift('crypto ipsec profile VPN','exit');
 if(path==='crypto')setup.unshift('crypto map VPN 10 ipsec-isakmp','exit');
 if(path==='device-tracking attach-policy')setup.unshift('device-tracking policy TRACK','exit');
 if(mode!=='config-subif'&&(path==='negotiation'||path.startsWith('switchport trunk encapsulation')))return {...base,type:'l3switch',model:'NETLAB-L3-24T',setup};
 if(path==='ip nhrp'||path==='tunnel'||path==='tunnel key'||path==='tunnel protection')return {...base,type:'router',model:'NETLAB-R4',setup:setup.filter(x=>!/^interface /.test(x)).concat('interface Tunnel0')};
 return {...base,setup};
}

// Error classification intentionally ignores explicit stored-setting notices and diagnostic sections.
export function commandRejected(value){
 const text=String(value??'').split('\n').filter(line=>!/^% configuration stored only:/i.test(line)).join('\n');
 if(/^\s*-{5,}\s+show /i.test(text))return false;
 // Actual rejection notices that the historical broad regex missed. Keep informational/stored-only output accepted.
 if(/(?:^|\n)\s*% (?:Supply an interface for this ARP entry\.|Value must be between \d+ and \d+\.|Subnet mask is not contiguous\.|Remove the OSPFv3 process to remove its address family\.|Specify the VRF address family to remove\.)/i.test(text))return true;
 return /(?:^|\n)\s*(?:%\s*(?:Invalid|Incomplete command|Ambiguous command|[^\n]*not implemented|[^\n]*not supported|Unsupported|[^\n]*does not exist(?!\. Creating)|[^\n]*not available|Bad mask|Expected|Please define|Command rejected|[^\n]*requires? )|Command rejected|Bad mask|Inconsistent address)/i.test(text);
}
