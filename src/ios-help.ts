/** Cisco IOS context-sensitive help presentation: descriptions, ordering, alignment and messages. */
import { IOS_ARGUMENT_ROWS, IOS_KEYWORD_HELP } from './ios-help-keywords.ts';

export const IOS_UNRECOGNIZED = '% Unrecognized command';
/** IOS prints some successful-command notices with a leading `%`; callers that treat `%` as failure must skip these. */
export const iosInformational = (line: string): boolean => /^% OSPF: Reload or use "clear ip ospf process" command, for this to take effect$/.test(line) || /^%[A-Z][A-Z0-9_]*-\d-[A-Z0-9_]+:/.test(line) || /^% (?:The key modulus size is|Generating \d+ bit RSA keys|You already have RSA keys defined|They will be replaced|All keys will be removed|All router certs issued)/.test(line);
export const iosRejected = (line: string): boolean => line.startsWith('%') && !iosInformational(line) || line.trim()==='Area mismatch' || /^\s*ERROR:/i.test(line);
export const iosAmbiguous = (input: string): string => `% Ambiguous command:  "${input.trim()}"`;

/** Catalog scope for a CLI mode: EXEC levels share one tree, as do interface and range modes. */
export function iosHelpScope(mode: string, protocol?: string): string {
  if (mode === 'user' || mode === 'priv') return 'exec';
  if (mode === 'range') return 'interface';
  if (['router', 'address-family', 'af-topology'].includes(mode)) return `router:${protocol ?? ''}`;
  return mode;
}
/** `no`, `default` and `undebug` reuse the help tree of the affirmative command. */
const canonicalPath = (path: string): string => path.trim().replace(/^(?:no|default)\s+/, '').replace(/^undebug\b/, 'debug');
function keywordHelp(scope: string | undefined, path: string, label: string): string | undefined {
  const canonical = canonicalPath(path);
  return (scope ? IOS_KEYWORD_HELP[`${scope}:${canonical}|${label}`] : undefined) ?? IOS_KEYWORD_HELP[`${canonical}|${label}`];
}

/** IOS EXEC single-letter shortcuts shown as `*s=show` in partial-word help. */
export const IOS_EXEC_ALIASES: Record<string, string> = { h: 'help', lo: 'logout', p: 'ping', r: 'resume', s: 'show', w: 'where' };

const EXEC: Record<string, string> = {
  archive: 'manage archive files', calendar: 'Manage the hardware calendar', cd: 'Change current directory', clear: 'Reset functions',
  clock: 'Manage the system clock', configure: 'Enter configuration mode', connect: 'Open a terminal connection', copy: 'Copy from one file to another',
  debug: "Debugging functions (see also 'undebug')", delete: 'Delete a file', dir: 'List files on a filesystem', disable: 'Turn off privileged commands',
  disconnect: 'Disconnect an existing network connection', enable: 'Turn on privileged commands', erase: 'Erase a filesystem', event: 'Event related commands',
  exit: 'Exit from the EXEC', help: 'Description of the interactive help system', logout: 'Exit from the EXEC', more: 'Display the contents of a file',
  no: 'Disable debugging functions', ntp: 'Execute NTP', ping: 'Send echo messages', release: 'Release a resource', reload: 'Halt and perform a cold restart',
  renew: 'Renew a resource', resume: 'Resume an active network connection', send: 'Send a message to other tty lines', show: 'Show running system information',
  ssh: 'Open a secure shell client connection', telnet: 'Open a telnet connection', terminal: 'Set terminal line parameters',
  test: 'Test subsystems, memory, and interfaces', traceroute: 'Trace route to destination', udld: 'UDLD protocol commands',
  undebug: "Disable debugging functions (see also 'debug')", where: 'List active connections', write: 'Write running configuration to memory, network, or terminal',
  'clear access-list': 'Clear access list statistical information', 'clear arp-cache': 'Clear the entire ARP cache', 'clear bgp': 'Clear BGP connections',
  'clear counters': 'Clear counters on one or all interfaces', 'clear crypto': 'Encryption module', 'clear host': 'Delete host table entries',
  'clear ip': 'IP', 'clear ipv6': 'IPv6', 'clear logging': 'Clear logging buffer', 'clear mac': 'MAC forwarding table', 'clear ospfv3': 'OSPFv3 clear commands',
  'clear spanning-tree': 'Spanning tree subsystem', 'clear dhcp': 'Delete items from the DHCP database',
  'debug all': 'Enable all debugging', 'debug arp': 'IP ARP and HP Probe transactions', 'debug condition': 'Condition', 'debug crypto': 'Cryptographic subsystem',
  'debug eigrp': 'EIGRP Protocol information', 'debug event': 'Event related debugging', 'debug ip': 'IP information', 'debug ipv6': 'IPv6 information',
  'debug spanning-tree': 'Spanning tree debugging', 'debug standby': 'Hot standby protocol',
  'copy running-config': 'Copy from current system configuration', 'copy startup-config': 'Copy from startup configuration',
  'terminal length': 'Set number of lines on a screen', 'terminal width': 'Set width of the display terminal', 'terminal monitor': 'Copy debug output to the current terminal line',
  'terminal no': 'Negate a command or set its defaults', 'terminal history': 'Enable and control the command history function',
  'terminal editing': 'Enable command line editing', 'terminal exec': 'Configure EXEC', 'terminal default': 'Set a command to its defaults',
  'write memory': 'Write to NV memory', 'write terminal': 'Write to terminal', 'write erase': 'Erase NV memory', 'write network': 'Write to network TFTP server',
  'erase startup-config': 'Erase contents of configuration memory', 'erase nvram:': 'Filesystem to be erased', 'erase flash:': 'Filesystem to be erased',
  'clock set': 'Set the time and date', 'clock read-calendar': 'Read the hardware calendar into the clock', 'clock update-calendar': 'Update the hardware calendar from the clock',
  'reload in': 'Reload after a time interval', 'reload at': 'Reload at a specific time/date', 'reload cancel': 'Cancel pending reload',
  'show aaa': 'Show AAA values', 'show access-lists': 'List access lists', 'show accounting': 'Accounting data for active sessions', 'show aliases': 'Display alias commands',
  'show archive': 'Archive functions', 'show arp': 'ARP table', 'show bfd': 'BFD protocol info', 'show bgp': 'BGP information', 'show bootvar': 'Boot and related environment variable',
  'show calendar': 'Display the hardware calendar', 'show cdp': 'CDP information', 'show cef': 'Cisco Express Forwarding', 'show class-map': 'Show QoS Class Map',
  'show clock': 'Display the system clock', 'show control-plane': 'Control-plane information', 'show controllers': 'Interface controller status',
  'show crypto': 'Encryption Module', 'show debugging': 'State of each debugging option', 'show device-tracking': 'Device tracking',
  'show dhcp': 'Dynamic Host Configuration Protocol status', 'show dmvpn': 'DMVPN information', 'show dtp': 'DTP information', 'show eigrp': 'EIGRP show commands',
  'show errdisable': 'Error disable', 'show etherchannel': 'EtherChannel information', 'show event': 'Event related information', 'show file': 'Show filesystem information',
  'show flash:': 'display information about flash: file system', 'show flow': 'Flow information', 'show glbp': 'GLBP information',
  'show history': 'Display the session command history', 'show hosts': 'IP domain-name, lookup style, nameservers, and host table',
  'show interfaces': 'Interface status and configuration', 'show inventory': 'Show the physical inventory', 'show ip': 'IP information', 'show ipv6': 'IPv6 information',
  'show key': 'Key information', 'show lacp': 'Port channel information', 'show line': 'TTY line information', 'show lldp': 'LLDP information',
  'show logging': 'Show the contents of logging buffers', 'show login': 'Display Secure Login Configurations and State', 'show mac': 'MAC configuration',
  'show mac address-table': 'MAC forwarding table', 'show monitor': 'Monitoring different system events', 'show netconf-yang': 'NETCONF-YANG information',
  'show network-policy': 'Network policy information', 'show ntp': 'Network time protocol', 'show ospfv3': 'OSPFv3 information', 'show pagp': 'Port channel information',
  'show policy-map': 'Show QoS Policy Map', 'show port-security': 'Show secure port information', 'show privilege': 'Show current privilege level',
  'show processes': 'Active process statistics', 'show protocols': 'Active network routing protocols', 'show ptp': 'Precision Time Protocol',
  'show radius': 'Shows radius information', 'show redundancy': 'Redundancy Facility (RF) information', 'show reload': 'Scheduled reload information',
  'show route-map': 'route-map information', 'show running-config': 'Current operating configuration', 'show sessions': 'Information about Telnet connections',
  'show snmp': 'snmp statistics', 'show spanning-tree': 'Spanning tree topology', 'show ssh': 'Status of SSH server connections',
  'show standby': 'Hot standby protocol information', 'show startup-config': 'Contents of startup configuration', 'show storm-control': 'Show storm control configuration',
  'show tacacs': 'Shows tacacs+ server statistics', 'show tcp': 'Status of TCP connections', 'show tech-support': 'Show system information for Tech-Support',
  'show terminal': 'Display terminal configuration parameters', 'show time-range': 'Time range', 'show track': 'Tracking information', 'show udld': 'UDLD information',
  'show users': 'Display information about terminal lines', 'show version': 'System hardware and software status', 'show vlan': 'VTP VLAN status',
  'show vlans': 'Virtual LANs Information', 'show vrf': 'VPN Routing/Forwarding instance information', 'show vrrp': 'VRRP information', 'show vtp': 'VTP information',
  'show capabilities': 'Simulator feature support information',
  'show ip access-lists': 'List IP access lists', 'show ip aliases': 'IP alias table', 'show ip arp': 'IP ARP table', 'show ip as-path-access-list': 'List AS path access lists',
  'show ip bgp': 'BGP information', 'show ip cache': 'IP fast-switching route cache', 'show ip cef': 'Cisco Express Forwarding', 'show ip community-list': 'List community-list',
  'show ip dhcp': 'Show items in the DHCP database', 'show ip eigrp': 'IP-EIGRP show commands', 'show ip flow': 'NetFlow switching', 'show ip http': 'HTTP information',
  'show ip igmp': 'IGMP information', 'show ip interface': 'IP interface status and configuration', 'show ip mroute': 'IP multicast routing table',
  'show ip msdp': 'Multicast Source Discovery Protocol (MSDP)', 'show ip nat': 'IP NAT information', 'show ip nhrp': 'NHRP information', 'show ip ospf': 'OSPF information',
  'show ip pim': 'PIM information', 'show ip policy': 'Policy routing', 'show ip prefix-list': 'List IP prefix lists',
  'show ip protocols': 'IP routing protocol process parameters and statistics', 'show ip rip': 'IP RIP show commands', 'show ip route': 'IP routing table',
  'show ip rpf': 'Display RPF information for multicast source', 'show ip sla': 'IP Service Level Agreement', 'show ip source': 'IP source guard',
  'show ip ssh': 'Information on SSH', 'show ip static': 'Static routes', 'show ip vrf': 'VPN Routing/Forwarding instance information',
  'show ip ospf neighbor': 'Neighbor list', 'show ip ospf interface': 'Interface information', 'show ip ospf database': 'Database summary',
  'show ip ospf virtual-links': 'Virtual link information', 'show ip ospf border-routers': 'Border and Boundary Router Information',
  'show ip eigrp neighbors': 'IP-EIGRP neighbors', 'show ip eigrp topology': 'IP-EIGRP Topology Table', 'show ip eigrp interfaces': 'IP-EIGRP interfaces',
  'show ip bgp summary': 'Summary of BGP neighbor status', 'show ip bgp neighbors': 'Detailed information on TCP and BGP neighbor connections',
  'show ip dhcp pool': 'DHCP pools information', 'show ip dhcp binding': 'DHCP address bindings', 'show ip dhcp conflict': 'DHCP address conflicts',
  'show ip nat translations': 'Translation entries', 'show ip nat statistics': 'Translation statistics',
  'show interfaces status': 'Show interface line status', 'show interfaces trunk': 'Show interface trunk information',
  'show interfaces switchport': 'Show interface switchport information', 'show interfaces description': 'Show interface description',
  'show interfaces counters': 'Show interface counters', 'show interfaces summary': 'Show interface summary',
  'show vlan brief': 'VTP all VLAN status in brief', 'show vlan id': 'VTP VLAN status by VLAN id', 'show vlan name': 'VTP VLAN status by VLAN name',
  'show vlan summary': 'VLAN summary information',
  'show spanning-tree summary': 'Summary of port states', 'show spanning-tree vlan': 'VLAN Switch Spanning Trees', 'show spanning-tree interface': 'Spanning Tree interface status and configuration',
  'show spanning-tree detail': 'Detailed information', 'show spanning-tree root': 'Spanning tree root information', 'show spanning-tree mst': 'Multiple spanning trees',
  'show spanning-tree blockedports': 'Show blocked ports', 'show spanning-tree inconsistentports': 'Show inconsistent ports',
  'show spanning-tree pathcost': 'Show Spanning pathcost options', 'show spanning-tree active': 'Report on active interfaces only',
  'show etherchannel summary': 'One-line summary per channel-group', 'show etherchannel detail': 'Detail information', 'show etherchannel port-channel': 'Port-channel information',
  'show etherchannel load-balance': 'Load-balancing/frame-distribution scheme among ports in port-channel', 'show etherchannel port': 'Port information',
  'show cdp neighbors': 'CDP neighbor entries', 'show cdp entry': 'Information for specific neighbor entry', 'show cdp interface': 'CDP interface status and configuration',
  'show cdp traffic': 'CDP statistics', 'show lldp neighbors': 'LLDP neighbor entries', 'show lldp entry': 'Information for specific neighbor entry',
  'show lldp interface': 'LLDP interface status and configuration', 'show lldp traffic': 'LLDP statistics',
  'show mac address-table dynamic': 'dynamic entry type', 'show mac address-table static': 'static entry type', 'show mac address-table count': 'Count of addresses',
  'show mac address-table aging-time': 'aging-time keyword', 'show mac address-table address': 'address keyword', 'show mac address-table interface': 'interface keyword',
  'show mac address-table vlan': 'VLAN keyword',
  'show processes cpu': 'Show CPU use per process', 'show processes memory': 'Show memory use per process',
  'show port-security interface': 'Show secure interface', 'show port-security address': 'Show secure address',
  'show vtp status': 'VTP domain status', 'show vtp counters': 'VTP statistics', 'show vtp password': 'VTP password', 'show vtp interface': 'VTP interface status and configuration',
  'show ntp status': 'NTP status', 'show ntp associations': 'NTP associations',
  'show standby brief': 'Brief output', 'show vrrp brief': 'Brief output', 'show glbp brief': 'Brief output',
  'show ip interface brief': 'Brief summary of IP status and configuration',
};

const CONFIG: Record<string, string> = {
  aaa: 'Authentication, Authorization and Accounting.', 'access-list': 'Add an access list entry', archive: 'Archive the configuration', arp: 'Set a static ARP entry',
  banner: 'Define a login banner', bfd: 'BFD configuration commands', 'bfd-template': 'BFD template configuration', boot: 'Modify system boot parameters',
  cdp: 'Global CDP configuration subcommands', 'class-map': 'Configure CPL Class Map', clock: 'Configure time-of-day clock', 'config-register': 'Define the configuration register',
  'control-plane': 'Configure control plane services', crypto: 'Encryption module', 'device-tracking': 'Device tracking', do: 'To run exec commands in config mode',
  enable: 'Modify enable password parameters', end: 'Exit from configure mode', errdisable: 'Error disable', event: 'Event related commands', exit: 'Exit from configure mode',
  flow: 'Global Flow configuration subcommands', help: 'Description of the interactive help system', hostname: "Set system's network name",
  interface: 'Select an interface to configure', ip: 'Global IP configuration subcommands', ipv6: 'Global IPv6 configuration commands', key: 'Key management',
  lacp: 'LACP configuration', line: 'Configure a terminal line', lldp: 'Global LLDP configuration subcommands', logging: 'Modify message logging facilities',
  login: 'Enable secure login checking', mac: 'Global MAC configuration subcommands', monitor: 'Monitoring different system events',
  'netconf-yang': 'Configure NETCONF-YANG', 'network-policy': 'Network Policy Profile', ntp: 'Configure NTP', 'policy-map': 'Configure QoS Policy Map',
  'port-channel': 'EtherChannel configuration', ptp: 'Precision Time Protocol', radius: 'RADIUS server configuration command', 'radius-server': 'Modify RADIUS query parameters',
  redundancy: 'Enter redundancy mode', restconf: 'Enable RESTCONF', 'route-map': 'Create route-map or enter route-map command mode', router: 'Enable a routing process',
  security: 'Infra Security CLIs', service: 'Modify use of network based services', 'snmp-server': 'Modify SNMP engine parameters', 'spanning-tree': 'Spanning Tree Subsystem',
  tacacs: 'TACACS+ server configuration', 'tacacs-server': 'Modify TACACS query parameters', 'tftp-server': 'Provide TFTP service for netload requests',
  'time-range': 'Define time range entries', track: 'Object tracking configuration commands', udld: 'Configure global UDLD setting', username: 'Establish User Name Authentication',
  vlan: 'Vlan commands', vrf: 'VRF commands', vtp: 'Configure global VTP state', wireless: 'Wireless configuration',
  'ip access-list': 'Named access-list', 'ip arp': 'IP ARP global configuration', 'ip as-path': 'BGP autonomous system path filter', 'ip bgp-community': 'format for BGP community',
  'ip cef': 'Cisco Express Forwarding', 'ip community-list': 'Add a community list entry', 'ip default-gateway': 'Specify default gateway (if not routing IP)',
  'ip default-network': 'Flags networks as candidates for default routes', 'ip dhcp': 'Configure DHCP server and relay parameters', 'ip dns': 'Configure DNS server for a zone',
  'ip domain': 'IP DNS Resolver', 'ip domain-lookup': 'Enable IP Domain Name System hostname translation', 'ip domain-name': 'Define the default domain name',
  'ip flow-cache': 'Configure netflow cache parameters', 'ip flow-export': 'Specify host/port to send flow statistics', 'ip flow-top-talkers': 'Configure netflow top talkers',
  'ip ftp': 'FTP configuration commands', 'ip host': 'Add an entry to the ip hostname table', 'ip http': 'HTTP server configuration', 'ip icmp': 'ICMP options',
  'ip igmp': 'IGMP global configuration', 'ip local': 'Specify local options', 'ip msdp': 'MSDP global commands', 'ip multicast-routing': 'Enable IP multicast forwarding',
  'ip name-server': 'Specify address of name server to use', 'ip nat': 'NAT configuration commands', 'ip pim': 'PIM global commands', 'ip prefix-list': 'Build a prefix list',
  'ip route': 'Establish static routes', 'ip routing': 'Enable IP routing', 'ip scp': 'Scp commands', 'ip sla': 'IP Service Level Agreement', 'ip source': 'IP source guard',
  'ip ssh': 'Configure ssh options', 'ip vrf': 'Configure an IP VPN Routing/Forwarding instance',
  'ipv6 access-list': 'Configure access lists', 'ipv6 dhcp': 'Configure IPv6 DHCP', 'ipv6 general-prefix': 'Configure a general IPv6 prefix', 'ipv6 host': 'Configure static hostnames',
  'ipv6 local': 'Specify local options', 'ipv6 nd': 'IPv6 Neighbor Discovery', 'ipv6 neighbor': 'Neighbor', 'ipv6 prefix-list': 'Build a prefix list',
  'ipv6 route': 'Configure static routes', 'ipv6 router': 'Enable an IPV6 routing process', 'ipv6 snooping': 'IPv6 snooping', 'ipv6 source-guard': 'Configure IPv6 source-guard',
  'ipv6 unicast-routing': 'Enable unicast routing',
  'service dhcp': 'Enable DHCP server and relay agent', 'service password-encryption': 'Encrypt system passwords', 'service timestamps': 'Timestamp debug/log messages',
  'enable secret': 'Assign the privileged level secret (MAX of 25 characters)', 'enable password': 'Assign the privileged level password (MAX of 25 characters)',
  'spanning-tree mode': 'Spanning tree operating mode', 'spanning-tree vlan': 'VLAN Switch Spanning Tree', 'spanning-tree mst': 'Multiple spanning tree configuration',
  'spanning-tree portfast': 'Spanning tree portfast options', 'spanning-tree extend': 'Spanning Tree 802.1t extensions', 'spanning-tree pathcost': 'Spanning tree pathcost options',
  'spanning-tree loopguard': 'Spanning tree loopguard options', 'spanning-tree backbonefast': 'Enable BackboneFast Feature', 'spanning-tree uplinkfast': 'Enable UplinkFast Feature',
  'spanning-tree etherchannel': 'Spanning tree etherchannel specific configuration', 'spanning-tree logging': 'Enable Spanning tree logging',
  'spanning-tree bridge': 'STP Bridge Assurance parameters', 'spanning-tree transmit': 'STP transmit parameters',
  'vtp domain': 'Set the name of the VTP administrative domain.', 'vtp mode': 'Configure VTP device mode', 'vtp version': 'Set the administrative domain to VTP version',
  'vtp password': 'Set the password for the VTP administrative domain', 'vtp pruning': 'Set the administrative domain to permit pruning',
  'cdp run': 'Enable CDP', 'lldp run': 'Enable LLDP', 'crypto key': 'Long term key operations', 'logging buffered': 'Set buffered logging parameters',
  'logging console': 'Set console logging parameters', 'logging monitor': 'Set terminal line (monitor) logging parameters', 'logging host': 'Set syslog server IP address and parameters',
  'logging trap': 'Set syslog server logging level', 'logging on': 'Enable logging to all enabled destinations', 'logging synchronous': 'Synchronized message output',
  'ntp server': 'Configure NTP server', 'ntp master': 'Act as NTP master clock', 'ntp source': 'Configure interface for source address', 'ntp peer': 'Configure NTP peer',
  'interface range': 'interface range command',
};

const INTERFACE: Record<string, string> = {
  arp: 'Set arp type (arpa, probe, snap) or timeout or log options', bandwidth: 'Set bandwidth informational parameter', bfd: 'BFD interface configuration commands',
  cdp: 'CDP interface subcommands', 'channel-group': 'Etherchannel/port bundling configuration', 'channel-protocol': 'Select the channel protocol (LACP, PAgP)',
  delay: 'Specify interface throughput delay', description: 'Interface specific description', duplex: 'Configure duplex operation.', encapsulation: 'Set encapsulation type for an interface',
  exit: 'Exit from interface configuration mode', glbp: 'Gateway Load Balancing Protocol interface commands', help: 'Description of the interactive help system',
  ip: 'Interface Internet Protocol config commands', ipv6: 'IPv6 interface subcommands', keepalive: 'Enable keepalive', lacp: 'LACP interface subcommands',
  lldp: 'LLDP interface subcommands', 'mac-address': 'Manually set interface MAC address', 'media-type': 'Media type', mtu: 'Set the interface Maximum Transmission Unit (MTU)',
  'network-policy': 'Network Policy', ospfv3: 'OSPFv3 interface commands', power: 'Power configuration', 'service-policy': 'Configure CPL Service Policy',
  shutdown: 'Shutdown the selected interface', 'spanning-tree': 'Spanning Tree Subsystem', speed: 'Configure speed operation.', standby: 'HSRP interface configuration commands',
  'storm-control': 'storm configuration', switchport: 'Set switching mode characteristics', tunnel: 'protocol-over-protocol tunneling',
  udld: 'Configure UDLD enabled or disabled and ignore global UDLD setting', vrf: 'VPN Routing/Forwarding parameters on the interface', vrrp: 'VRRP Interface configuration commands',
  'ip access-group': 'Specify access control for packets', 'ip address': 'Set the IP address of an interface', 'ip authentication': 'authentication subcommands',
  'ip bandwidth-percent': 'Set EIGRP bandwidth limit', 'ip cef': 'Cisco Express Forwarding interface commands', 'ip dhcp': 'Configure DHCP parameters for this interface',
  'ip flow': 'NetFlow related commands', 'ip hello-interval': 'Configures EIGRP-IPv4 hello interval', 'ip helper-address': 'Specify a destination address for UDP broadcasts',
  'ip hold-time': 'Configures EIGRP-IPv4 hold time', 'ip igmp': 'IP Internet Group Management Protocol', 'ip local-proxy-arp': 'Enable local-proxy ARP',
  'ip mtu': 'Set IP Maximum Transmission Unit', 'ip nat': 'NAT interface commands', 'ip next-hop-self': 'Configures EIGRP-IPv4 next-hop-self',
  'ip nhrp': 'NBMA Next Hop Resolution Protocol', 'ip ospf': 'OSPF interface commands', 'ip pim': 'PIM interface commands', 'ip policy': 'Enable policy routing',
  'ip proxy-arp': 'Enable proxy ARP', 'ip redirects': 'Enable sending ICMP Redirect messages', 'ip rip': 'Router Information Protocol', 'ip split-horizon': 'Perform split horizon',
  'ip summary-address': 'Perform address summarization', 'ip tcp': 'TCP header compression and other parameters', 'ip unreachables': 'Enable sending ICMP Unreachable messages',
  'ip verify': 'Enable per packet validation', 'ip vrf': 'VPN Routing/Forwarding parameters on the interface',
  'ipv6 address': 'Configure IPv6 address on interface', 'ipv6 authentication': 'authentication subcommands', 'ipv6 bandwidth-percent': 'Set EIGRP bandwidth limit',
  'ipv6 dhcp': 'IPv6 DHCP interface subcommands', 'ipv6 eigrp': 'Configure EIGRP IPv6 on interface', 'ipv6 enable': 'Enable IPv6 on interface',
  'ipv6 hello-interval': 'Configures EIGRP-IPv6 hello interval', 'ipv6 hold-time': 'Configures EIGRP-IPv6 hold time', 'ipv6 nd': 'IPv6 interface Neighbor Discovery subcommands',
  'ipv6 next-hop-self': 'Configures EIGRP-IPv6 next-hop-self', 'ipv6 ospf': 'OSPF interface commands', 'ipv6 rip': 'Configure RIP routing protocol',
  'ipv6 split-horizon': 'Perform split horizon', 'ipv6 summary-address': 'Perform address summarization', 'ipv6 traffic-filter': 'Access control list for packets',
  'ipv6 verify': 'Enable per packet validation',
  'switchport access': 'Set access mode characteristics of the interface', 'switchport autostate': 'Include or exclude this port from vlan link up calculation',
  'switchport host': 'Set port host', 'switchport mode': 'Set trunking mode of the interface', 'switchport nonegotiate': 'Device will not engage in negotiation protocol on this interface',
  'switchport port-security': 'Security related command', 'switchport trunk': 'Set trunking characteristics of the interface', 'switchport voice': 'Voice appliance attributes',
  'switchport priority': 'Set appliance 802.1p priority', 'switchport protected': 'Configure an interface to be a protected port',
  'spanning-tree backbonefast': 'Enable BackboneFast Feature', 'spanning-tree bpdufilter': "Don't send or receive BPDUs on this interface",
  'spanning-tree bpduguard': "Don't accept BPDUs on this interface", 'spanning-tree bridge': 'STP Bridge Assurance parameters', 'spanning-tree cost': 'Change an interface\'s spanning tree port path cost',
  'spanning-tree guard': 'Change an interface\'s spanning tree guard mode', 'spanning-tree link-type': 'Specify a link type for spanning tree protocol use',
  'spanning-tree mst': 'Multiple spanning tree', 'spanning-tree port-priority': 'Change an interface\'s spanning tree port priority',
  'spanning-tree portfast': 'Portfast options for the interface', 'spanning-tree vlan': 'VLAN Switch Spanning Tree',
  'cdp enable': 'Enable CDP on interface', 'lldp receive': 'Enable LLDP reception on interface', 'lldp transmit': 'Enable LLDP transmission on interface',
};

const ROUTER: Record<string, string> = {
  'address-family': 'Enter Address Family command mode', area: 'OSPF area parameters', 'auto-cost': 'Calculate OSPF interface cost according to bandwidth',
  'auto-summary': 'Enable automatic network number summarization', bfd: 'BFD configuration commands', bgp: 'BGP specific commands', capability: 'Enable specific OSPF feature',
  compatible: 'OSPF compatibility list', 'default-information': 'Control distribution of default information', 'default-metric': 'Set metric of redistributed routes',
  'discard-route': 'Enable or disable discard-route installation', distance: 'Define an administrative distance', 'distribute-list': 'Filter networks in routing updates',
  'domain-id': 'OSPF domain-id', 'domain-tag': 'OSPF domain-tag', eigrp: 'EIGRP specific commands', 'event-log': 'Event Logging', exit: 'Exit from routing protocol configuration mode',
  'exit-address-family': 'Exit from Address Family configuration mode', 'flash-update-threshold': 'Specify flash update threshold in second', help: 'Description of the interactive help system',
  'input-queue': 'Specify input queue depth', 'interface-id': 'Source of the interface ID', ispf: 'Enable incremental SPF computation',
  'log-adjacency-changes': 'Log changes in adjacency state', 'max-lsa': 'maximum number of non self-generated LSAs to accept', 'max-metric': 'Set maximum metric',
  'maximum-paths': 'Forward packets over multiple paths', metric: 'Modify metrics and parameters for advertisement', neighbor: 'Specify a neighbor router',
  network: 'Enable routing on an IP network', 'offset-list': 'Add or subtract offset from RIP metrics', 'output-delay': 'Interpacket delay for RIP updates',
  'passive-interface': 'Suppress routing updates on an interface', priority: 'OSPF topology priority',
  redistribute: 'Redistribute information from another routing protocol', 'router-id': 'router-id for this OSPF process', shutdown: 'Shutdown the OSPF protocol under the current instance',
  'summary-address': 'Configure IP address summaries', synchronization: 'Perform IGP synchronization', timers: 'Adjust routing timers',
  'traffic-share': 'How to compute traffic share over alternate paths', 'ttl-security': 'TTL security check', variance: 'Control load balancing variance',
  version: 'Set routing protocol version', 'validate-update-source': 'Perform sanity checks against source address of routing updates',
};
const ROUTER_PROTOCOL: Record<string, Record<string, string>> = {
  eigrp: { 'router-id': 'router-id for this EIGRP process', shutdown: 'Shutdown this instance of EIGRP', 'summary-address': 'Perform address summarization' },
  bgp: { 'router-id': 'Override configured router identifier (peers will reset)', 'address-family': 'Enter Address Family command mode', timers: 'Adjust routing timers' },
  rip: { distance: 'Define an administrative distance', timers: 'Adjust routing timers' },
};

const LINE: Record<string, string> = {
  'access-class': 'Filter connections based on an IP access list', accounting: 'Accounting parameters', authorization: 'Authorization parameters',
  databits: 'Set number of data bits per character', editing: 'Enable command line editing', exec: 'Start an EXEC process', 'exec-timeout': 'Set the EXEC timeout',
  exit: 'Exit from line configuration mode', flowcontrol: 'Set the flow control', help: 'Description of the interactive help system',
  history: 'Enable and control the command history function', length: 'Set number of lines on a screen', logging: 'Modify message logging facilities',
  login: 'Enable password checking', parity: 'Set terminal parity', password: 'Set a password', privilege: 'Change privilege level for line', rxspeed: 'Set the receive speed',
  'session-timeout': 'Set interval for closing connection when there is no input traffic', speed: 'Set the transmit and receive speeds', stopbits: 'Set async line stop bits',
  transport: 'Define transport protocols for line', txspeed: 'Set the transmit speeds', width: 'Set width of the display terminal',
  'transport input': 'Define which protocols to use when connecting to the terminal server', 'transport output': 'Define which protocols to use for outgoing connections',
  'transport preferred': 'Specify the preferred protocol to use', 'logging synchronous': 'Synchronized message output', 'login local': 'Local password checking',
  'login authentication': 'Authentication parameters',
};

const MODES: Record<string, Record<string, string>> = {
  vlan: { name: 'Ascii name of the VLAN', shutdown: 'Shutdown VLAN switching', 'remote-span': 'Configure as Remote SPAN VLAN', exit: 'Apply changes, bump revision number, and exit mode' },
  acl: { deny: 'Specify packets to reject', permit: 'Specify packets to forward', remark: 'Access list entry comment', exit: 'Exit from access-list configuration mode', sequence: 'Sequence number' },
  pool: { 'default-router': 'Default routers', 'dns-server': 'DNS servers', 'domain-name': 'Domain name', lease: 'Address lease time', network: 'Network number and mask',
    option: 'Raw DHCP options', 'next-server': 'Next server in boot process', bootfile: 'Boot file name', exit: 'Exit from DHCP pool configuration mode', host: 'Client IP address and mask' },
  'route-map': { match: 'Match values from routing table', set: 'Set values in destination routing protocol', continue: 'Continue on a different entry within the route-map',
    description: 'Route-map comment', exit: 'Exit from route-map configuration mode' },
  'class-map': { match: 'classification criteria', description: 'Class-Map description', exit: 'Exit from QoS class-map configuration mode' },
  'policy-map': { class: 'policy criteria', description: 'Policy-Map description', exit: 'Exit from QoS policy-map configuration mode' },
  'policy-class': { bandwidth: 'Bandwidth', police: 'Police', priority: 'Strict Scheduling Priority for this Class', set: 'Set QoS values', shape: 'Traffic Shaping',
    'queue-limit': 'Queue Max Threshold for Tail Drop', exit: 'Exit from QoS class action configuration mode' },
  'key-chain': { key: 'Configure a key', exit: 'Exit from key-chain configuration mode' },
  key: { 'key-string': 'Set key string', 'accept-lifetime': 'Set accept lifetime of key', 'send-lifetime': 'Set send lifetime of key',
    'cryptographic-algorithm': 'Set cryptographic authentication algorithm', exit: 'Exit from key-chain key configuration mode' },
  vrf: { rd: 'Specify Route Distinguisher', description: 'VRF specific description', 'address-family': 'Enter Address Family command mode', 'route-target': 'Specify Target VPN Extended Communities',
    exit: 'Exit from VRF configuration mode' },
  'time-range': { absolute: 'absolute time and date', periodic: 'periodic time and date', exit: 'Exit from time-range configuration mode' },
  track: { delay: 'Tracking delay', exit: 'Exit from tracking configuration mode' },
  sla: { 'icmp-echo': 'ICMP Echo Operation', http: 'HTTP Operation', 'udp-jitter': 'UDP Jitter Operation',
    frequency: 'Frequency of an operation', timeout: 'Timeout of an operation', threshold: 'Operation threshold in milliseconds',
    exit: 'Exit from IP SLA configuration mode' },
  mst: { instance: 'Map vlans to an MST instance', name: 'Set configuration name', revision: 'Set configuration revision number', show: 'Display region configurations',
    abort: 'Exit region configuration mode, aborting changes', exit: 'Exit region configuration mode, applying changes' },
};

const COMMON: Record<string, string> = { default: 'Set a command to its defaults', no: 'Negate a command or set its defaults', help: 'Description of the interactive help system' };

/** Keyword argument descriptions keyed by command path and keyword. Generic keys apply when the grammar has no wording. */
const ARGUMENTS: Record<string, string> = {
  'show interfaces|counters': 'Show interface counters', 'show interfaces|description': 'Show interface description', 'show interfaces|status': 'Show interface line status',
  'show interfaces|trunk': 'Show interface trunk information', 'show interfaces|switchport': 'Show interface switchport information', 'show interfaces|summary': 'Show interface summary',
  'show ip route|bgp': 'Border Gateway Protocol (BGP)', 'show ip route|connected': 'Connected', 'show ip route|eigrp': 'Enhanced Interior Gateway Routing Protocol (EIGRP)',
  'show ip route|ospf': 'Open Shortest Path First (OSPF)', 'show ip route|rip': 'Routing Information Protocol (RIP)', 'show ip route|static': 'Static routes',
  'show ip route|vrf': 'Display routes from a VPN Routing/Forwarding instance', 'show ip route|summary': 'Summary of all routes', 'show ip route|A.B.C.D': 'Network to display information about or hostname',
  'show ip route|local': 'Local', 'show ip route|odr': 'On Demand stub Routes', 'show ip route|isis': 'ISO IS-IS', 'show ip route|mobile': 'Mobile routes',
  '__output|append': 'Append redirected output to URL (URLs supporting append operation only)', '__output|begin': 'Begin with the line that matches',
  '__output|count': 'Count number of lines which match regexp', '__output|exclude': 'Exclude lines that match', '__output|include': 'Include lines that match',
  '__output|redirect': 'Redirect output to URL', '__output|section': 'Filter a section of output', '__output|tee': 'Copy output to URL', '__output|format': 'Format the output using the specified spec file',
  '__output|LINE': 'Regular Expression',
  'ip route|vrf': 'Configure static route for a VPN Routing/Forwarding instance', 'ip route|A.B.C.D': 'Destination prefix',
  'line|console': 'Primary terminal line', 'line|vty': 'Virtual terminal', 'line|aux': 'Auxiliary line',
  'duplex|auto': 'Enable AUTO duplex configuration', 'duplex|full': 'Force full duplex operation', 'duplex|half': 'Force half-duplex operation',
  'speed|10': 'Force 10 Mbps operation', 'speed|100': 'Force 100 Mbps operation', 'speed|1000': 'Force 1000 Mbps operation', 'speed|10000': 'Force 10000 Mbps operation',
  'speed|auto': 'Enable AUTO speed configuration', 'speed|nonegotiate': 'Do not negotiate speed',
  'ip ospf|authentication': 'Enable authentication', 'ip ospf|authentication-key': 'Authentication password (key)', 'ip ospf|bfd': 'BFD on this interface',
  'ip ospf|cost': 'Interface cost', 'ip ospf|dead-interval': 'Interval after which a neighbor is declared dead', 'ip ospf|hello-interval': 'Time between HELLO packets',
  'ip ospf|message-digest-key': 'Message digest authentication password (key)', 'ip ospf|mtu-ignore': 'Ignores the MTU in DBD packets', 'ip ospf|network': 'Network type',
  'ip ospf|priority': 'Router priority', 'ip ospf|retransmit-interval': 'Time between retransmitting lost link state advertisements', 'ip ospf|transmit-delay': 'Link state transmit delay',
  'ip ospf|<1-65535>': 'Process ID', 'ip ospf|broadcast': 'Specify OSPF broadcast multi-access network', 'ip ospf|point-to-point': 'Specify OSPF point-to-point network',
  'ip ospf|non-broadcast': 'Specify OSPF NBMA network', 'ip ospf|point-to-multipoint': 'Specify OSPF point-to-multipoint network',
  'password|0': 'Specifies an UNENCRYPTED password will follow', 'password|7': 'Specifies a HIDDEN password will follow', 'password|LINE': 'The UNENCRYPTED (cleartext) line password',
  'enable secret|0': 'Specifies an UNENCRYPTED password will follow', 'enable secret|5': 'Specifies a MD5 HASHED secret will follow', 'enable secret|8': 'Specifies a PBKDF2 HASHED secret will follow',
  'enable secret|9': 'Specifies a SCRYPT HASHED secret will follow', 'enable secret|LINE': "The UNENCRYPTED (cleartext) 'enable' secret", 'enable secret|level': 'Set exec level password',
  'enable password|0': 'Specifies an UNENCRYPTED password will follow', 'enable password|7': 'Specifies a HIDDEN password will follow', 'enable password|LINE': "The UNENCRYPTED (cleartext) 'enable' password",
  'enable password|level': 'Set exec level password',
  'hostname|WORD': "This system's network name", 'description|LINE': 'Up to 240 characters describing this interface',
  'transport input|all': 'All protocols', 'transport input|none': 'No protocols', 'transport input|ssh': 'TCP/IP SSH protocol', 'transport input|telnet': 'TCP/IP Telnet protocol',
  'transport output|all': 'All protocols', 'transport output|none': 'No protocols', 'transport output|ssh': 'TCP/IP SSH protocol', 'transport output|telnet': 'TCP/IP Telnet protocol',
  'transport preferred|none': 'Configure no preferred transport', 'transport preferred|ssh': 'TCP/IP SSH protocol', 'transport preferred|telnet': 'TCP/IP Telnet protocol',
  'switchport mode|access': 'Set trunking mode to ACCESS unconditionally', 'switchport mode|dynamic': 'Set trunking mode to dynamically negotiate access or trunk mode',
  'switchport mode|trunk': 'Set trunking mode to TRUNK unconditionally', 'switchport mode|private-vlan': 'Set private-vlan mode', 'switchport mode|auto': 'Set trunking mode dynamic negotiation parameter to AUTO',
  'switchport mode|desirable': 'Set trunking mode dynamic negotiation parameter to DESIRABLE',
  'banner|motd': 'Set Message of the Day banner', 'banner|login': 'Set login banner', 'banner|exec': 'Set EXEC process creation banner', 'banner|LINE': 'c banner-text c, where \'c\' is a delimiting character',
  'spanning-tree mode|mst': 'Multiple spanning tree mode', 'spanning-tree mode|pvst': 'Per-Vlan spanning tree mode', 'spanning-tree mode|rapid-pvst': 'Per-Vlan rapid spanning tree mode',
  'router|bgp': 'Border Gateway Protocol (BGP)', 'router|eigrp': 'Enhanced Interior Gateway Routing Protocol (EIGRP)', 'router|ospf': 'Open Shortest Path First (OSPF)',
  'router|rip': 'Routing Information Protocol (RIP)', 'router|ospfv3': 'OSPFv3', 'router|isis': 'ISO IS-IS', 'router|odr': 'On Demand stub Routes',
  'vtp mode|client': 'Set the device to client mode.', 'vtp mode|server': 'Set the device to server mode.', 'vtp mode|transparent': 'Set the device to transparent mode.',
  'vtp mode|off': 'Set the device to off mode.',
  'channel-group|<1-48>': 'Channel group number', 'channel-group|mode': 'Etherchannel Mode of the interface',
  'channel-group|active': 'Enable LACP unconditionally', 'channel-group|passive': 'Enable LACP only if a LACP device is detected',
  'channel-group|desirable': 'Enable PAgP unconditionally', 'channel-group|auto': 'Enable PAgP only if a PAgP device is detected', 'channel-group|on': 'Enable Etherchannel only',
  'logging|synchronous': 'Synchronized message output', 'login|local': 'Local password checking', 'login|authentication': 'Authentication parameters',
  'exec-timeout|<0-35791>': 'Timeout in minutes', 'access-list|<1-99>': 'IP standard access list', 'access-list|<100-199>': 'IP extended access list',
  'access-list|<1300-1999>': 'IP standard access list (expanded range)', 'access-list|<2000-2699>': 'IP extended access list (expanded range)',
  'ip access-list|standard': 'Standard Access List', 'ip access-list|extended': 'Extended Access List', 'ip access-list|resequence': 'Resequence Access List',
  'ip access-list|logging': 'Control access list logging', 'ip access-list|log-update': 'Control access list log updates',
  'ping|A.B.C.D': 'Ping destination address or hostname', 'ping|WORD': 'Ping destination address or hostname', 'ping|ip': 'IP echo', 'ping|ipv6': 'IPv6 echo',
  'traceroute|A.B.C.D': 'Trace route to destination address or hostname', 'traceroute|WORD': 'Trace route to destination address or hostname',
  'telnet|WORD': 'IP address or hostname of a remote system', 'configure|terminal': 'Configure from the terminal', 'configure|memory': 'Configure from NV memory',
  'configure|network': 'Configure from a TFTP network host', 'configure|replace': 'Replace the running-config with a new config file', 'configure|confirm': 'Confirm replacement of running-config with a new config file',
};

const GENERIC: Record<string, string> = {
  detail: 'Detailed information', brief: 'Brief summary', summary: 'Summary information', all: 'All', vrf: 'VPN Routing/Forwarding instance', interface: 'Interface',
  vlan: 'VLAN', source: 'Source', counters: 'Counters', statistics: 'Statistics',
};

function catalogFor(scope: string): Record<string, string> | undefined {
  if (scope === 'exec') return EXEC;
  if (scope === 'config') return CONFIG;
  if (scope === 'interface' || scope === 'range') return INTERFACE;
  if (scope === 'router' || scope === 'address-family' || scope === 'af-topology') return ROUTER;
  if (scope === 'line') return LINE;
  return MODES[scope];
}

/** IOS keyword description for a command path in a CLI mode; the simulator's text remains the fallback. */
export function iosDescription(mode: string, path: string[], fallback: string, protocol?: string): string {
  const scope = mode === 'user' || mode === 'priv' ? 'exec' : mode, key = canonicalPath(path.join(' '));
  const keyword = keywordHelp(iosHelpScope(mode, protocol), path.slice(0, -1).join(' '), path.at(-1)!);
  if (keyword) return keyword;
  if (['router', 'address-family', 'af-topology'].includes(scope) && protocol && ROUTER_PROTOCOL[protocol]?.[key]) return ROUTER_PROTOCOL[protocol][key];
  return catalogFor(scope)?.[key] ?? (path.length === 1 ? COMMON[key] : undefined) ?? fallback;
}

/** Argument-position wording for keywords whose grammar only names the literal. `path` may list candidates, most specific first. */
export function iosArgumentDescription(path: string | string[], label: string, current: string, mode?: string, protocol?: string): string {
  const paths = typeof path === 'string' ? [path] : path, scope = mode ? iosHelpScope(mode, protocol) : undefined;
  for (const candidate of paths) { const keyword = keywordHelp(scope, candidate, label); if (keyword) return keyword; }
  const canonical = canonicalPath(paths[paths.length - 1] ?? ''), specific = ARGUMENTS[`${canonical}|${label}`] ?? ARGUMENTS[`${canonical.split(' ').at(-1)}|${label}`];
  if (specific) return specific;
  if (!current || current === label) return GENERIC[label] ?? current;
  return current;
}

/** IOS spelling of simulator signature tokens such as `0-15`, `HH:MM:SS` or `flash:file`. */
function iosLabel(token: string): string {
  const range = /^<?(\d+)-(\d+)>?$/.exec(token);
  if (range) return `<${range[1]}-${range[2]}>`;
  if (/^<?HH:MM:SS>?$/i.test(token)) return 'hh:mm:ss';
  if (/^<?HH:MM>?$/i.test(token)) return 'hh:mm';
  if (/^<?flash:/i.test(token)) return 'flash:';
  if (/^\*[a-z]/i.test(token)) return 'WORD';
  return token;
}

/** True when IOS_ARGUMENT_ROWS hides a simulator-only keyword at this path. */
export function iosKeywordHidden(path: string, label: string, mode?: string, protocol?: string): boolean {
  const canonical = canonicalPath(path), scope = mode ? iosHelpScope(mode, protocol) : undefined;
  const rows = (scope ? IOS_ARGUMENT_ROWS[`${scope}:${canonical}|${label}`] : undefined) ?? IOS_ARGUMENT_ROWS[`${canonical}|${label}`];
  return !!rows && !rows.length;
}

/** Help rows for one argument token; IOS_ARGUMENT_ROWS replaces or hides simulator-only tokens. */
export function iosArgumentRows(path: string | string[], label: string, description: string, mode?: string, protocol?: string): [string, string][] {
  const paths = typeof path === 'string' ? [path] : path, scope = mode ? iosHelpScope(mode, protocol) : undefined;
  for (const candidate of paths) {
    const canonical = canonicalPath(candidate);
    const replaced = (scope ? IOS_ARGUMENT_ROWS[`${scope}:${canonical}|${label}`] : undefined) ?? IOS_ARGUMENT_ROWS[`${canonical}|${label}`];
    if (replaced) return replaced.map(([row, text]) => [row, text]);
  }
  const spelled = iosLabel(label);
  return [[spelled, iosArgumentDescription(paths, spelled, spelled === label ? description : iosArgumentDescription(paths, label, description, mode, protocol), mode, protocol)]];
}

const MODE_HEADERS: Record<string, string> = {
  user: 'Exec commands:', priv: 'Exec commands:', config: 'Configure commands:', interface: 'Interface configuration commands:', range: 'Interface configuration commands:',
  router: 'Router configuration commands:', 'address-family': 'Router Address Family configuration commands:', 'af-topology': 'Router Address Family Topology configuration commands:',
  line: 'Line configuration commands:', vlan: 'VLAN configuration commands:', pool: 'DHCP pool configuration commands:', 'route-map': 'Route Map configuration commands:',
  'class-map': 'QoS class-map configuration commands:', 'policy-map': 'QoS policy-map configuration commands:', 'policy-class': 'QoS policy-map class configuration commands:',
  'key-chain': 'Key-chain configuration commands:', key: 'Key-chain key configuration commands:', vrf: 'VPN Routing/Forwarding instance configuration commands:',
  'time-range': 'Time range configuration commands:', track: 'Tracking instance configuration commands:', sla: 'IP SLAs entry configuration commands:', mst: 'MST configuration mode commands:',
};

/** The heading IOS prints before a top-level or first-level subcommand list. */
export function iosHelpHeader(mode: string, path: string[], aclType?: string): string | undefined {
  if (!path.length) {
    if (mode === 'acl') return aclType === 'extended' ? 'Ext Access List configuration commands:' : aclType === 'standard' ? 'Standard Access List configuration commands:' : undefined;
    return MODE_HEADERS[mode];
  }
  if (path.length === 1 && path[0] === 'ip') return mode === 'config' ? 'Global IP configuration subcommands:' : mode === 'interface' || mode === 'range' ? 'Interface IP configuration subcommands:' : undefined;
  if (path.length === 1 && path[0] === 'ipv6' && (mode === 'interface' || mode === 'range')) return 'IPv6 interface subcommands:';
  return undefined;
}

const rank = (label: string): number => label === '<cr>' ? 2 : 0;
function wrap(text: string, room: number): string[] {
  if (room <= 0 || text.length <= room) return [text];
  const lines: string[] = []; let current = '';
  for (const word of text.split(' ')) {
    if (current && (current + ' ' + word).length > room) { lines.push(current); current = word; }
    else current = current ? current + ' ' + word : word;
  }
  if (current) lines.push(current);
  return lines;
}

/** IOS help block: two-space indent, labels padded to the longest label plus two spaces, ASCII order, <cr> last. */
export function iosHelpRows(rows: Iterable<[string, string]>, width = 80): string[] {
  const unique = new Map<string, string>();
  for (const [label, description] of rows) if (!unique.has(label)) unique.set(label, description);
  const sorted = [...unique].sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  if (!sorted.length) return [];
  const pad = Math.max(...sorted.map(([label]) => label.length)), indent = 2 + pad + 2, room = width > 0 ? width - 1 - indent : 0;
  return sorted.flatMap(([label, description]) => {
    if (!description) return [`  ${label}`];
    const [first, ...rest] = room >= 20 ? wrap(description, room) : [description];
    return [`  ${label.padEnd(pad)}  ${first}`, ...rest.map(line => ' '.repeat(indent) + line)];
  });
}

/** Partial-word help lists matching words across the line, separated by two spaces. */
export function iosPartialHelp(words: string[], width = 80): string[] {
  const lines: string[] = []; let current = '';
  for (const word of words) {
    if (current && width > 0 && (current + '  ' + word).length > width - 1) { lines.push(current); current = word; }
    else current = current ? current + '  ' + word : word;
  }
  if (current) lines.push(current);
  return lines.length ? [...lines, ''] : [];
}

const capitalize = (text: string): string => text ? text[0].toUpperCase() + text.slice(1) : text;
function placeholder(path: string, token: string, mode?: string, protocol?: string): [string, string][] {
  if (!token.startsWith('<') || /^<\d+-\d+>$|^<HH:MM|^<flash:/i.test(token)) return iosArgumentRows(path, token, token, mode, protocol);
  const name = token.slice(1, -1).replace(/\.\.\.$/, '').trim();
  const label = /ipv6|x:x/i.test(name) ? 'X:X:X:X::X'
    : /^(?:interface|interfaces|port|source interface)$/i.test(name) ? 'WORD'
    : /\b(?:address|ip|mask|wildcard|network|next-hop|gateway|destination|start|end|peer|neighbor)\b/i.test(name) ? 'A.B.C.D'
    : /\b(?:text|line|message|description|command|string|regexp|banner|url)\b/i.test(name) || token.endsWith('...>') ? 'LINE'
    : 'WORD';
  const replaced = iosArgumentRows(path, token, '', mode, protocol);
  if (replaced.length !== 1 || replaced[0][0] !== token) return replaced;
  return iosArgumentRows(path, label, capitalize(name.replace(/[-_]/g, ' ')), mode, protocol);
}

/** IOS-style rows for a registry signature such as `[0|7] <password>`: the first argument position only. */
export function iosSignatureRows(path: string, signature: string, mode?: string, protocol?: string): [string, string][] {
  const trimmed = signature.trim(), optional = trimmed.startsWith('[');
  const group = optional ? trimmed.slice(1, trimmed.indexOf(']') < 0 ? undefined : trimmed.indexOf(']')) : trimmed;
  const first = group.match(/<[^>]+>|[^\s<]+/)?.[0] ?? '';
  const alternatives = /^<[^>]*\|[^>]*>$/.test(first) ? first.slice(1, -1).split('|').map(value => /^[a-z][a-z0-9-]*$/.test(value) ? value : `<${value}>`) : first.split('|');
  const rows = alternatives.filter(Boolean).flatMap(token => placeholder(path, token, mode, protocol));
  return optional || !rows.length ? [...rows, ['<cr>', '<cr>']] : rows;
}

/** IOS treats an unrecognised EXEC word as a host name for an implicit Telnet connection. */
export function iosUnknownHost(word: string, domainLookup: boolean, nameServer?: string): string[] {
  return [domainLookup ? `Translating "${word}"...domain server (${nameServer || '255.255.255.255'})` : `Translating "${word}"`, '% Unknown command or computer name, or unable to find computer address'];
}
