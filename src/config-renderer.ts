import {renderFTPClient} from './ios-ftp.ts';
import {endpointGlobalLines,endpointInterfaceLines} from './ios-endpoint.ts';
import { speedIsAuto } from './ethernet.ts';
import {renderWred} from './qos-congestion.ts';
import {renderSNMP} from './ios-snmp.ts';
import{renderWireless}from'./ios-wireless.ts';
import { renderARPBindingRule } from './arp-binding-acl.ts';
import { displayCommunity } from './bgp-policy.ts';
import { renderPlatformInterface, renderPlatformGlobal } from './ios-platform-compat.ts';
import { switchingCompatibilityLines, switchingInterfaceLines } from './ios-switching-compat.ts';
import { encodeType7 } from './credentials.ts';
import { routingCompatibilityLines } from './ios-routing-compat.ts';
import type { Device, DeviceConfig, InterfaceConfig, StaticRoute } from './model.ts';

export function prefixMask(prefix: number): string {
  const n = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
function wildcard(prefix: number): string { return prefixMask(prefix).split('.').map(x=>255-Number(x)).join('.'); }

function routeLine(r: StaticRoute): string {
  if(r.network.includes(':'))return `ipv6 route ${r.network}/${r.prefix}${r.interface?` ${r.interface}`:''}${r.nextHop?` ${r.nextHop}`:''}${r.ad&&r.ad!==1?` ${r.ad}`:''}`;
  return `ip route ${r.vrf ? `vrf ${r.vrf} ` : ''}${r.network} ${prefixMask(r.prefix)}${r.interface ? ` ${r.interface}` : ''}${r.nextHop ? ` ${r.nextHop}` : ''}${r.global?' global':''}${r.ad && r.ad !== 1 ? ` ${r.ad}` : ''}${r.name?' name '+r.name:''}${r.permanent?' permanent':''}${r.track!==undefined?' track '+r.track:''}${r.tag!==undefined?' tag '+r.tag:''}`;
}

const IOS_KINDS = ['router', 'switch', 'poeswitch', 'l3switch'];
const physicalEthernet = (name: string) => /^(GigabitEthernet|FastEthernet|Ethernet|TenGigabitEthernet)\d/i.test(name) && !name.includes('.');
function interfaceRank(name: string): number { return /^Loopback/i.test(name) ? 0 : /^Tunnel/i.test(name) ? 1 : /^Port-channel/i.test(name) ? 2 : /^Vlan/i.test(name) ? 4 : 3; }
function naturalCompare(a: string, b: string): number {
  const x = a.split(/(\d+)/), y = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return i % 2 ? Number(x[i]) - Number(y[i]) : x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
}
/** IOS NVGEN order: Loopback, Tunnel, Port-channel, physical (subinterfaces after their parent), then SVIs. */
export function orderedInterfaces(config: DeviceConfig): InterfaceConfig[] {
  return Object.values(config.interfaces).sort((a, b) => interfaceRank(a.name) - interfaceRank(b.name) || naturalCompare(a.name, b.name));
}

function interfaceLines(p: InterfaceConfig, config: DeviceConfig, kind = 'router'): string[] {
  const a = [`interface ${p.name}`];
  if (p.description) a.push(` description ${p.description}`);
  if (p.features.bandwidth) a.push(` bandwidth ${p.features.bandwidth}`);
  if (p.features.dot1q !== undefined) a.push(` encapsulation dot1Q ${p.features.dot1q}${p.features.dot1qNative ? ' native' : ''}`);
  if (p.vrf) a.push(` vrf forwarding ${p.vrf}`);
  if (p.switchport) {
    if (p.vlan !== 1) a.push(` switchport access vlan ${p.vlan}`);
    if (p.nativeVlan !== 1) a.push(` switchport trunk native vlan ${p.nativeVlan}`);
    if (p.allowedVlans !== null) a.push(` switchport trunk allowed vlan ${p.allowedVlans.join(',') || 'none'}`);
    if (p.mode !== 'access' || p.features.switchportModeSet) a.push(` switchport mode ${p.mode.replace('dynamic-', 'dynamic ')}`);
  } else if (kind !== 'router' && !/^(Loopback|Vlan|Tunnel)/.test(p.name)) a.push(' no switchport');
  if(p.features.nonegotiate)a.push(' switchport nonegotiate');
  const security=p.features.portSecurity;
  if(security){if(security.maximum!==undefined&&security.maximum!==1)a.push(` switchport port-security maximum ${security.maximum}`);if(security.enabled)a.push(' switchport port-security');if(security.agingTime!==undefined)a.push(` switchport port-security aging time ${security.agingTime}`);if(security.violation&&security.violation!=='shutdown')a.push(` switchport port-security violation ${security.violation}`);if(security.agingStatic)a.push(' switchport port-security aging static');if(security.agingType)a.push(` switchport port-security aging type ${security.agingType}`);if(security.sticky)a.push(' switchport port-security mac-address sticky');for(const mac of security.macs||[])a.push(` switchport port-security mac-address ${mac}`);}
  if (p.mtu !== (/^Tunnel/i.test(p.name) ? 1476 : 1500)) a.push(` mtu ${p.mtu}`);
  if (p.features.dhcp) a.push(' ip address dhcp');
  else if (p.ip) a.push(` ip address ${p.ip} ${p.mask || '255.255.255.0'}`);
  else if (!p.switchport && IOS_KINDS.includes(kind)) a.push(' no ip address');
  for(const address of p.features.secondaryIps??[])a.push(` ip address ${address.ip} ${address.mask} secondary`);
  const eui=Object.values<string>(p.features.ipv6Eui64||{});p.ipv6.filter(ip=>!eui.includes(ip)&&!(p.features.ipv6General??[]).some((row:any)=>row.address===ip)).forEach(ip=>a.push(` ipv6 address ${ip}`));
  for(const row of p.features.ipv6General??[])a.push(` ipv6 address ${row.name} ${row.suffix}/${row.prefix}`);
  for(const prefix of Object.keys(p.features.ipv6Eui64||{}))a.push(` ipv6 address ${prefix} eui-64`);
  if(p.features.ipv6LinkLocal)a.push(` ipv6 address ${p.features.ipv6LinkLocal} link-local`);
  if (p.features.ipv6Autoconfig || p.features.slaac) a.push(' ipv6 address autoconfig');
  if (p.features.delay) a.push(` delay ${p.features.delay}`);
  if(p.features.cdp!==undefined)a.push(p.features.cdp?' cdp enable':' no cdp enable');
  if(p.features.lldpTransmit!==undefined)a.push(p.features.lldpTransmit?' lldp transmit':' no lldp transmit');
  if(p.features.lldpReceive!==undefined)a.push(p.features.lldpReceive?' lldp receive':' no lldp receive');
  if(p.features.arpTimeout!==undefined)a.push(` arp timeout ${p.features.arpTimeout}`);
  if(p.features.rip?.splitHorizon!==undefined)a.push((p.features.rip.splitHorizon?' ':' no ')+'ip split-horizon');
  if(p.features.ripng?.splitHorizon!==undefined)a.push((p.features.ripng.splitHorizon?' ':' no ')+`ipv6 rip ${p.features.ripng.processId||config.protocols.ripng?.processId||'RIPNG'} split-horizon`);
  if(p.features.ripng?.poisonReverse!==undefined)a.push((p.features.ripng.poisonReverse?' ':' no ')+`ipv6 rip ${p.features.ripng.processId||config.protocols.ripng?.processId||'RIPNG'} poison-reverse`);
  if(p.features.ospfv3ipv4?.area!==undefined)a.push(` ospfv3 ${p.features.ospfv3ipv4.processId||config.protocols.ospfv3ipv4?.processId||1} ipv4 area ${p.features.ospfv3ipv4.area}`);
  const network3=p.features.ospfv3?.networkType??p.features.ospfv3ipv4?.networkType;if(network3)a.push(p.features.ospfv3NetworkSyntax==='modern'?` ospfv3${p.features.ospfv3NetworkProcess?' '+p.features.ospfv3NetworkProcess:''} network ${network3}`:` ipv6 ospf network ${network3}`);
  for(const[field,command]of [['helloInterval','hello-interval'],['deadInterval','dead-interval'],['priority','priority'],['cost','cost']])if(p.features.ospfv3?.[field]!==undefined)a.push(` ipv6 ospf ${command} ${p.features.ospfv3[field]}`);for(const row of p.features.ospfv3?.neighbors??[])a.push(` ipv6 ospf neighbor ${row.address}${row.pollInterval!==undefined?' poll-interval '+row.pollInterval:''}${row.cost!==undefined?' cost '+row.cost:''}`);
  for(const [protocol,family]of [['eigrp','ip'],['eigrp6','ipv6']])if(p.features[protocol]?.bandwidthPercent!==undefined)a.push(` ${family} bandwidth-percent eigrp ${p.features[protocol]?.asn||p.features[protocol]?.optionsAsn||config.protocols[protocol]?.asn||1} ${p.features[protocol].bandwidthPercent}`);
  for(const [protocol,family]of [['eigrp','ip'],['eigrp6','ipv6']])for(const [field,command]of [['helloInterval','hello-interval'],['holdTime','hold-time']])if(p.features[protocol]?.[field]!==undefined)a.push(` ${family} ${command} eigrp ${p.features[protocol]?.asn||p.features[protocol]?.optionsAsn||config.protocols[protocol]?.asn||1} ${p.features[protocol][field]}`);
  for(const [protocol,family]of [['eigrp','ip'],['eigrp6','ipv6']])for(const [field,command]of [['splitHorizon','split-horizon'],['nextHopSelf','next-hop-self']])if(p.features[protocol]?.[field]!==undefined)a.push(`${p.features[protocol][field]?' ':' no '}${family} ${command} eigrp ${p.features[protocol]?.asn||p.features[protocol]?.optionsAsn||config.protocols[protocol]?.asn||1}`);
  if(p.features.pimDrPriority!==undefined)a.push(` ip pim dr-priority ${p.features.pimDrPriority}`);
  if (p.features.channelGroup) a.push(` channel-group ${p.features.channelGroup} mode ${p.features.channelMode || 'on'}`);
  if (p.features.portfastType) a.push(` spanning-tree portfast ${p.features.portfastType}${p.features.portfastTrunk?' trunk':''}`); else if (p.features.portfast) a.push(' spanning-tree portfast');
  a.push(...switchingInterfaceLines(p),...endpointInterfaceLines(p));
  if(p.features.trackingPolicy)a.push(` ${p.features.trackingForm==='snooping'?'ipv6 snooping':'device-tracking'} attach-policy ${p.features.trackingPolicy}`);
  if(p.features.rootGuard)a.push(' spanning-tree guard root');
  if(p.features.loopGuard)a.push(' spanning-tree guard loop');
  else if(p.features.loopGuard===false&&!p.features.rootGuard)a.push(' spanning-tree guard none');
  if(p.features.bpdufilter!==undefined)a.push(` spanning-tree bpdufilter ${p.features.bpdufilter?'enable':'disable'}`);
  if(p.features.lacpPortPriority)a.push(` lacp port-priority ${p.features.lacpPortPriority}`);
  if (p.features.bpduguard!==undefined) a.push(` spanning-tree bpduguard ${p.features.bpduguard?'enable':'disable'}`);
  if (p.features.stpCost) a.push(` spanning-tree cost ${p.features.stpCost}`);
  for(const protocol of ['eigrp','eigrp6','rip']){const auth=p.features[protocol];if(!auth)continue;const family=protocol==='eigrp6'?'ipv6':'ip',asn=protocol==='eigrp6'?(auth.asn||config.protocols.eigrp6?.asn||1):(config.protocols.eigrp?.asn||1);if(protocol==='eigrp6'&&auth.asn)a.push(` ipv6 eigrp ${auth.asn}`);if(auth.authenticationMode)a.push(protocol==='rip'?` ip rip authentication mode ${auth.authenticationMode}`:` ${family} authentication mode eigrp ${asn} ${auth.authenticationMode}`);if(auth.authenticationKeyChain)a.push(protocol==='rip'?` ip rip authentication key-chain ${auth.authenticationKeyChain}`:` ${family} authentication key-chain eigrp ${asn} ${auth.authenticationKeyChain}`);if(protocol==='eigrp6')for(const s of auth.summaries||[])a.push(` ipv6 summary-address eigrp ${asn} ${s.network}/${s.prefix}`);}
  if (p.features.ospf) {
    const o = p.features.ospf;
    if (o.area !== undefined) a.push(` ip ospf ${o.processId || 1} area ${o.area}`);
    if(o.priority!==undefined)a.push(` ip ospf priority ${o.priority}`);
    if (o.cost) a.push(` ip ospf cost ${o.cost}`);
    if (o.helloInterval) a.push(` ip ospf hello-interval ${o.helloInterval}`);
    if (o.deadInterval) a.push(` ip ospf dead-interval ${o.deadInterval}`);
    if(o.authenticationKey)a.push(` ip ospf authentication-key ${o.authenticationKey}`);
    if(o.authenticationKeyChain)a.push(` ip ospf authentication key-chain ${o.authenticationKeyChain}`);
    for(const [id,key]of Object.entries<any>(o.messageDigestKeys||{}))a.push(` ip ospf message-digest-key ${id} md5 ${typeof key==='string'?key:key.keyString}`);
    if (o.authentication&&!o.authenticationKeyChain) a.push(` ip ospf authentication${['message-digest','null'].includes(o.authentication)?' '+o.authentication:''}`);
    if (o.mtuIgnore) a.push(' ip ospf mtu-ignore');
    if (o.networkType) a.push(` ip ospf network ${o.networkType}`);
  }
  if(p.features.ipv6AclIn)a.push(` ipv6 traffic-filter ${p.features.ipv6AclIn} in`);
  if(p.features.ipv6AclOut)a.push(` ipv6 traffic-filter ${p.features.ipv6AclOut} out`);
  if(p.features.powerInline)a.push(p.features.powerInline.mode==='never'?' power inline never':' power inline auto'+(p.features.powerInline.max!==30000?' max '+p.features.powerInline.max:''));
  if(p.features.powerPriority==='high')a.push(' power inline port priority high');
  if (p.features.aclIn) a.push(` ip access-group ${p.features.aclIn} in`);
  if (p.features.aclOut) a.push(` ip access-group ${p.features.aclOut} out`);
  if(p.features.helpersOption82)a.push(' ip dhcp relay information option');
  for (const address of p.features.helpers || []) a.push(` ip helper-address ${address}`);
  if(p.features.cryptoMap)a.push(` crypto map ${p.features.cryptoMap}`);
  if(p.features.tunnelProtection)a.push(` tunnel protection ipsec profile ${p.features.tunnelProtection}`);
  if (p.features.nat === 'inside') a.push(' ip nat inside');
  if (p.features.nat === 'outside') a.push(' ip nat outside');
  if(p.features.tunnelKey!==undefined)a.push(` tunnel key ${p.features.tunnelKey}`);
  if(p.features.tunnelMode)a.push(p.features.tunnelMode==='gre multipoint'?' tunnel mode gre multipoint':' tunnel mode gre ip');
  if(p.features.nhrp){const n=p.features.nhrp;for(const [key,field]of [['network-id','networkId'],['authentication','authentication'],['holdtime','holdtime']])if(n[field]!==undefined)a.push(` ip nhrp ${key} ${n[field]}`);for(const h of n.nhs||[])a.push(` ip nhrp nhs ${h.address}${h.nbma?` nbma ${h.nbma}`:''}`);for(const m of n.maps||[])a.push(` ip nhrp map ${m.address} ${m.nbma}`);for(const m of n.multicast==='dynamic'?['dynamic']:n.multicast||[])a.push(` ip nhrp map multicast ${m}`);for(const k of ['shortcut','redirect'])if(n[k])a.push(` ip nhrp ${k}`);}
  if(p.features.udld===false)a.push(' no udld port');else if(p.features.udld)a.push(' udld port'+(p.features.udld.mode==='aggressive'?' aggressive':''));
  if(p.features.bfdEcho!==undefined)a.push(`${p.features.bfdEcho?' ':' no '}bfd echo`);
  if(p.features.bfdTemplate)a.push(` bfd template ${p.features.bfdTemplate}`);
  if(p.features.bfd?.enabled)a.push(` bfd interval ${p.features.bfd.minTx} min_rx ${p.features.bfd.minRx} multiplier ${p.features.bfd.multiplier}`);
  if(p.features.ospf?.bfd)a.push(' ip ospf bfd');
  if(p.features.pim)a.push(` ip pim ${p.features.pim}`);
  if(p.features.igmpVersion!==undefined)a.push(` ip igmp version ${p.features.igmpVersion}`);
  for(const g of p.features.igmpGroups||[])a.push(` ip igmp join-group ${g.group}${g.source?` source ${g.source}`:''}`);
  if(p.features.ipv6Enabled)a.push(' ipv6 enable');
  if(p.features.dhcpv6Client?.stateful&&!p.features.dhcpv6Client.prefixDelegationName)a.push(' ipv6 address dhcp');
  if(p.features.dhcpv6Client?.prefixDelegationName)a.push(` ipv6 dhcp client pd ${p.features.dhcpv6Client.prefixDelegationName}`);
  if(p.features.dhcpv6Server)a.push(` ipv6 dhcp server ${p.features.dhcpv6Server}${p.features.dhcpv6Preference!==undefined?` preference ${p.features.dhcpv6Preference}`:''}`);
  for(const r of p.features.dhcpv6Relay||[])a.push(` ipv6 dhcp relay destination ${r.destination}`);
  const nd=p.features.ipv6Nd;if(nd){for(const prefix of nd.prefixes||[])a.push(` ipv6 nd prefix ${prefix.network}/${prefix.prefix} ${prefix.validLifetime} ${prefix.preferredLifetime}${prefix.autonomous===false?' no-autoconfig':''}${prefix.onLink===false?' no-onlink':''}${prefix.noAdvertise?' no-advertise':''}`);if(nd.intervalMs!==undefined)a.push(` ipv6 nd ra interval msec ${nd.intervalMs}`);if(nd.hopLimit!==undefined)a.push(` ipv6 nd ra hop-limit ${nd.hopLimit}`);if(nd.routerPreference)a.push(` ipv6 nd router-preference ${nd.routerPreference}`);if(nd.suppressRa)a.push(' ipv6 nd suppress-ra');if(nd.managed)a.push(' ipv6 nd managed-config-flag');if(nd.other)a.push(' ipv6 nd other-config-flag');if(nd.raLifetime!==undefined)a.push(` ipv6 nd ra lifetime ${nd.raLifetime}`);}
  for(const [field,command]of [['raGuard','ipv6 nd raguard'],['dhcpv6Guard','ipv6 dhcp guard'],['ndInspection','ipv6 nd inspection'],['ipv6SourceGuard','ipv6 verify source']]){if(p.features[(field==='ipv6SourceGuard'?'sourceGuard':field)+'Policy'])a.push(` ${command} attach-policy ${p.features[(field==='ipv6SourceGuard'?'sourceGuard':field)+'Policy']}`);else if(p.features[field])a.push(' '+command);}
  for(const field of ['redirects','unreachables'])if(p.features[field]===false)a.push(` no ip ${field}`);
  if(p.features.dhcpSnoopingTrust)a.push(' ip dhcp snooping trust');
  if(p.features.arpInspectionTrust)a.push(' ip arp inspection trust');
  if(p.features.dhcpSnoopingRate)a.push(` ip dhcp snooping limit rate ${p.features.dhcpSnoopingRate}`);
  if(p.features.arpInspectionRate)a.push(` ip arp inspection limit rate ${p.features.arpInspectionRate}`);
  if(p.features.proxyArp!==undefined)a.push(` ${p.features.proxyArp?'':'no '}ip proxy-arp`);
  if(p.features.flowMonitorIn)a.push(` ip flow monitor ${p.features.flowMonitorIn} input`);
  if(p.features.flowMonitorOut)a.push(` ip flow monitor ${p.features.flowMonitorOut} output`);
  if(p.features.sourceGuard)a.push(' ip verify source');
  if(p.features.servicePolicyIn)a.push(` service-policy input ${p.features.servicePolicyIn}`);
  if(p.features.servicePolicyOut)a.push(` service-policy output ${p.features.servicePolicyOut}`);
  if(p.features.netflowIn)a.push(' ip flow ingress');
  if(p.features.netflowOut)a.push(' ip flow egress');
  if(p.features.routeMap)a.push(` ip policy route-map ${p.features.routeMap}`);
  const storm=p.features.stormControl;
  if(storm){for(const kind of ['broadcast','multicast','unicast'])if(storm[kind])a.push(` storm-control ${kind} level ${storm[kind].rising} ${storm[kind].falling}`);if(storm.action)a.push(` storm-control action ${storm.action}`);}
  for(const summary of p.features.rip?.summaries||[])a.push(` ip summary-address rip ${summary.network} ${prefixMask(summary.prefix)}`);
  if(p.features.rip?.sendVersion)a.push(` ip rip send version ${p.features.rip.sendVersion.join(' ')}`);
  if(p.features.rip?.receiveVersion)a.push(` ip rip receive version ${p.features.rip.receiveVersion.join(' ')}`);
  for(const summary of p.features.eigrp?.summaries||[])a.push(` ip summary-address eigrp ${config.protocols.eigrp?.asn||1} ${summary.network} ${prefixMask(summary.prefix)} ${summary.ad||5}`);
  if (p.features.tunnelSource) a.push(` tunnel source ${p.features.tunnelSource}`);
  if (p.features.tunnelDestination) a.push(` tunnel destination ${p.features.tunnelDestination}`);
  if (p.features.ospfv3?.area!==undefined) a.push(` ipv6 ospf ${p.features.ospfv3.processId||1} area ${p.features.ospfv3.area}`);
  if (p.features.ripng?.enabled) a.push(` ipv6 rip ${p.features.ripng.processId||'RIPNG'} enable`);
  if(p.features.hsrpVersion!==undefined)a.push(` standby version ${p.features.hsrpVersion}`);
  for(const group of config.features.fhrp||[])if(group.interface===p.name){const name=group.protocol==='hsrp'?'standby':group.protocol;a.push(` ${name} ${group.group} ip ${group.virtualIp}`,` ${name} ${group.group} priority ${group.priority}`);if(group.preempt)a.push(` ${name} ${group.group} preempt${group.preemptDelay!==undefined?' delay minimum '+group.preemptDelay:''}`);else if(group.protocol==='vrrp')a.push(` no vrrp ${group.group} preempt`);if(group.helloTime!==undefined)a.push(group.protocol==='vrrp'?` vrrp ${group.group} timers advertise msec ${group.helloTime}`:` ${name} ${group.group} timers msec ${group.helloTime} msec ${group.holdTime??10000}`);if(group.authentication){const auth=group.authentication;a.push(` ${name} ${group.group} authentication ${auth.mode}${auth.mode==='md5'?auth.keyChain?' key-chain':' key-string':''} ${auth.keyChain||auth.key||''}`);}if(group.protocol==='glbp'){if(group.loadBalancing)a.push(` glbp ${group.group} load-balancing ${group.loadBalancing}`);if(group.weighting)a.push(` glbp ${group.group} weighting ${group.weighting.maximum} lower ${group.weighting.lower} upper ${group.weighting.upper}`);}for(const track of group.track||[])a.push(` ${name} ${group.group} track ${track.id} decrement ${track.decrement||10}`);}
  if (!p.adminUp) a.push(' shutdown');
  const platform = renderPlatformInterface(p), hardware: string[] = [];
  if (kind === 'router' && physicalEthernet(p.name)) hardware.push(` duplex ${p.duplex}`, ` speed ${speedIsAuto(p) ? 'auto' : p.speed}`, ` media-type ${p.features.mediaType || 'rj45'}`);
  else { if (!speedIsAuto(p)) hardware.push(` speed ${p.speed}`); if (p.duplex !== 'auto') hardware.push(` duplex ${p.duplex}`); hardware.push(...platform.filter(line => line.startsWith(' media-type '))); }
  const v6 = (line: string, i: number) => i > 0 && /^ (no )?(ipv6|ospfv3) /.test(line);
  return [...a.filter((line, i) => !v6(line, i)), ...hardware, ...a.filter(v6), ...platform.filter(line => !line.startsWith(' media-type ')), '!'];
}

function renderLineBlocks(c: DeviceConfig, kind: string): string[] {
  const out: string[] = [], aaa = !!c.features.aaa?.enabled, configured = Object.entries<any>(c.features.lines || {});
  const range = (name: string) => { const [, start, end] = name.split(' ').map(Number); return [start, Number.isNaN(end) || end === undefined ? start : end]; };
  const block = (head: string, line: any, vty: boolean) => {
    out.push(head);
    if (line.sessionTimeout) out.push(` session-timeout ${line.sessionTimeout}`);
    if (line.accessClassIn) out.push(` access-class ${line.accessClassIn} in`);
    if (line.accessClassOut) out.push(` access-class ${line.accessClassOut} out`);
    for (const direction of ['In','Out']) if (line['ipv6AccessClass'+direction]) out.push(` ipv6 access-class ${line['ipv6AccessClass'+direction]} ${direction.toLowerCase()}`);
    if (line.execTimeout !== undefined && line.execTimeout !== 600) out.push(` exec-timeout ${Math.floor(line.execTimeout / 60)} ${line.execTimeout % 60}`);
    if (line.exec === false) out.push(' no exec');
    if (line.privilege !== undefined && line.privilege !== 1) out.push(` privilege level ${line.privilege}`);
    if (line.password) out.push(` password ${line.passwordType === 7 ? '7 ' + encodeType7(line.password) : line.password}`);
    if (line.authorizationExec) out.push(` authorization exec ${line.authorizationExec}`);
    for (const [level, name] of Object.entries(line.authorizationCommands || {})) out.push(` authorization commands ${level} ${name}`);
    if (line.accountingExec) out.push(` accounting exec ${line.accountingExec}`);
    for (const [level, name] of Object.entries(line.accountingCommands || {})) out.push(` accounting commands ${level} ${name}`);
    if (line.loggingSynchronous) out.push(' logging synchronous');
    if (line.authentication) out.push(` login authentication ${line.authentication}`);
    if (line.login) out.push(` login${line.login === 'local' ? ' local' : ''}`);
    else if (vty && !line.authentication && !aaa) out.push(' no login');
    if (line.length !== undefined && line.length !== 24) out.push(` length ${line.length}`);
    if (line.width !== undefined && line.width !== 80) out.push(` width ${line.width}`);
    if (line.historySize !== undefined && line.historySize !== 10) out.push(` history size ${line.historySize}`);
    if (line.history === false) out.push(' no history');
    if (line.editing === false) out.push(' no editing');
    if (line.transportPreferred !== undefined && line.transportPreferred !== 'telnet') out.push(` transport preferred ${line.transportPreferred}`);
    if (vty) out.push(` transport input ${line.transport ?? 'none'}`);
    else if (line.transport !== undefined && !['all','none'].includes(line.transport)) out.push(` transport input ${line.transport}`);
    if (line.transportOutput !== undefined && line.transportOutput !== 'all') out.push(` transport output ${line.transportOutput}`);
    for (const field of ['speed','txspeed','rxspeed','databits','parity','stopbits','flowcontrol']) if (line[field] !== undefined) out.push(` ${field} ${line[field]}`);
  };
  block('line con 0', c.features.lines?.['console 0'] ?? {}, false);
  if (kind === 'router') out.push('line aux 0');
  const vty: [number, string, any][] = configured.filter(([name]) => name.startsWith('vty ')).map(([name, line]) => [range(name)[0], `line ${name}`, line]);
  const covered = (n: number) => configured.some(([name]) => name.startsWith('vty ') && range(name)[0] <= n && n <= range(name)[1]);
  const defaults: [number, string][] = [[0, 'line vty 0 4'], ...(kind === 'router' ? [] : [[5, 'line vty 5 15']] as [number, string][])];
  for (const [start, head] of defaults) if (!covered(start)) vty.push([start, head, undefined]);
  for (const [, head, line] of vty.sort((x, y) => x[0] - y[0])) {
    if (line) block(head, line, true);
    else out.push(head, ...(aaa ? [] : [' login']), ' transport input none');
  }
  return out;
}

const RENDERED_DEFAULTS = /^(version \d+\.\d+|boot-start-marker|boot-end-marker|(no )?mmi .*|ip forward-protocol nd|(no )?ipv6 cef|multilink bundle-name authenticated|no scheduler allocate|vlan internal allocation policy ascending|spanning-tree extend system-id)$/;

/** True when a rendered line only restates an IOS default the simulator already holds, so config replay can skip it. */
export function isRenderedDefaultLine(device: Device, line: string, parentHead?: string): boolean {
  const text = line.trim(), c = device.config, f = c.features;
  if (!parentHead) {
    if (RENDERED_DEFAULTS.test(text)) return true;
    if (text === 'no service password-encryption') return !f.passwordEncryption;
    if (text === 'no aaa new-model') return !f.aaa?.enabled;
    if (text === 'ip cef') return f.cef !== false;
    if (text === 'no ip http server') return !c.services.http?.enabled;
    if (text === 'no ip http secure-server') return !c.services.http?.secureEnabled;
    if (text === 'spanning-tree mode rapid-pvst') return f.stp === undefined;
    return false;
  }
  const head = parentHead.trim();
  if (head.startsWith('interface ')) {
    const port = c.interfaces[head.slice(10).trim()];
    if (!port) return false;
    if (text === 'duplex auto') return port.duplex === 'auto';
    if (text === 'speed auto') return speedIsAuto(port);
    if (text === 'media-type rj45') return port.features.mediaType === undefined;
    if (text === 'no ip address') return !port.ip && !port.features.dhcp;
    return false;
  }
  const lineMatch = /^line (con(?:sole)?|vty) (\d+)(?: (\d+))?$/.exec(head);
  if (lineMatch) {
    const name = lineMatch[1].startsWith('con') ? 'console 0' : `vty ${lineMatch[2]}${lineMatch[3] && lineMatch[3] !== lineMatch[2] ? ' ' + lineMatch[3] : ''}`, entry = f.lines?.[name];
    if (text === 'no login') return entry?.login === undefined;
    if (text === 'transport input none' && name.startsWith('vty')) return entry?.transport === undefined;
  }
  return false;
}

/** True when a rendered block (head plus children) is IOS boilerplate with no simulator state behind it. */
export function isRenderedDefaultBlock(device: Device, head: string, children: string[]): boolean {
  const text = head.trim(), rows = children.map(line => line.trim()).filter(Boolean);
  if (/^line aux 0$/.test(text)) return true;
  if (!rows.length && /^(line con(sole)? 0|control-plane|redundancy)$/.test(text)) return true;
  const vty = /^line vty (\d+) (\d+)$/.exec(text);
  if (vty && !device.config.features.lines?.[`vty ${vty[1]} ${vty[2]}`]) return rows.every(row => row === 'login' || row === 'transport input none') && rows.includes('transport input none');
  return false;
}

/** Deterministic original IOS-like configuration rendering from real state. */
export function renderConfig(device: Device, config: DeviceConfig = device.config): string[] {
  const c = config, router = device.kind === 'router';
  const platformGlobal = renderPlatformGlobal(c), timestampOrder = (type: string) => type === 'debug' ? 0 : 1;
  const lines = ['!', `version ${router ? '15.9' : '15.2'}`];
  for(const [type,timestamp]of Object.entries<any>(c.features.timestamps||{}).sort((x,y)=>timestampOrder(x[0])-timestampOrder(y[0])))lines.push(`service timestamps ${type} ${timestamp.mode}${timestamp.msec?' msec':''}${timestamp.localtime?' localtime':''}${timestamp.showTimezone?' show-timezone':''}${timestamp.year?' year':''}`);
  lines.push(c.features.passwordEncryption ? 'service password-encryption' : 'no service password-encryption');
  if(c.features.sequenceNumbers)lines.push('service sequence-numbers');
  lines.push('!', `hostname ${c.hostname}`, '!', 'boot-start-marker', ...platformGlobal.filter(line => line.startsWith('boot system ')), 'boot-end-marker', '!');
  lines.push(...renderWireless(c.features.wireless));
  if(c.features.timezone)lines.push(`clock timezone ${c.features.timezone.name} ${Math.trunc(c.features.timezone.minutes/60)} ${Math.abs(c.features.timezone.minutes)%60}`);
  for(const [name,r]of Object.entries<any>(c.features.timeRanges||{})){lines.push(`time-range ${name}`);const format=(ms:number)=>{const d=new Date(ms);return `${d.toISOString().slice(11,16)} ${d.getUTCDate()} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;};if(r.absolute)lines.push(' absolute '+Object.entries<number>(r.absolute).map(([key,value])=>`${key} ${format(value)}`).join(' '));const minutes=(n:number)=>`${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;for(const p of r.periodic||[])lines.push(` periodic ${p.days.map((n:number)=>['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][n]).join(' ')} ${minutes(p.startMinutes)} to ${minutes(p.endMinutes)}`);lines.push('!');}
  for(const r of c.features.staticArp||[])lines.push(`arp ${r.ip} ${r.mac} arpa ${r.interface}`);
  for(const r of c.features.staticMac||[])lines.push(`mac address-table static ${r.mac} vlan ${r.vlan} interface ${r.interface}`);
  for(const [name,prefix]of Object.entries<any>(c.features.ipv6GeneralPrefixes??{}))lines.push(`ipv6 general-prefix ${name} ${prefix.network}/${prefix.prefix}`);
  if(c.features.enablePassword!==undefined)lines.push(`enable password ${c.features.enablePasswordType===7?'7 '+encodeType7(c.features.enablePassword):c.features.enablePassword}`);
  if (c.features.enableSecret) lines.push(`enable secret ${c.features.enableSecret}`);
  lines.push('!', c.features.aaa?.enabled ? 'aaa new-model' : 'no aaa new-model', '!');
  if (router) lines.push('mmi polling-interval 60', 'no mmi auto-configure', 'no mmi pvc', 'mmi snmp-timeout 180', '!');
  if (c.services.dhcp) {
    for (const range of c.services.dhcp.excluded || []) lines.push(`ip dhcp excluded-address ${range.start}${range.end && range.end !== range.start ? ` ${range.end}` : ''}`);
    if (c.services.dhcp.excluded?.length) lines.push('!');
    for (const p of c.services.dhcp.pools || []) {
      lines.push(`ip dhcp pool ${p.name}`);
      if (p.network) lines.push(` network ${p.network} ${prefixMask(p.prefix)}`);
      if (p.defaultRouters?.length||p.defaultRouter) lines.push(` default-router ${(p.defaultRouters||[p.defaultRouter]).join(' ')}`);
      if (p.dnsServers?.length) lines.push(` dns-server ${p.dnsServers.join(' ')}`);
      if(p.domain)lines.push(` domain-name ${p.domain}`);if(p.bootfile)lines.push(` bootfile ${JSON.stringify(p.bootfile)}`);if(p.nextServers?.length)lines.push(` next-server ${p.nextServers.join(' ')}`);
      for(const [code,option]of Object.entries<any>(p.options||{}))lines.push(` option ${code} ${option.type} ${Array.isArray(option.value)?option.value.join(' '):option.type==='ascii'?JSON.stringify(option.value):option.value}`);
      if(p.leaseSeconds!==undefined)lines.push(p.leaseSeconds===4294967295?' lease infinite':` lease ${Math.floor(p.leaseSeconds/86400)} ${Math.floor(p.leaseSeconds%86400/3600)} ${Math.floor(p.leaseSeconds%3600/60)}`);
      lines.push('!');
    }
  }
  if(c.features.domainLookup===false)lines.push('no ip domain-lookup');
  if (c.features.domainName) lines.push(`ip domain-name ${c.features.domainName}`);
  if (router) lines.push(c.features.cef === false ? 'no ip cef' : 'ip cef');
  else if(c.features.cef!==undefined)lines.push(c.features.cef?'ip cef':'no ip cef');
  if (router && !c.ipRouting) lines.push('no ip routing');
  else if (!router && c.ipRouting) lines.push('ip routing');
  if (c.ipv6Routing) lines.push('ipv6 unicast-routing');
  if (router) lines.push(c.ipv6Routing ? 'ipv6 cef' : 'no ipv6 cef', '!', 'multilink bundle-name authenticated');
  lines.push('!');
  for (const [name, user] of Object.entries<any>(c.features.users || {})) lines.push(`username ${name}${(user.privilege??1)!==1?' privilege '+user.privilege:''} ${user.password!==undefined?'password '+(user.passwordType===7?'7 '+encodeType7(user.password):'0 '+user.password):'secret '+user.secret}`);
  if (router || c.features.redundancy?.mode) lines.push('!', 'redundancy', ...(c.features.redundancy?.mode ? [` mode ${c.features.redundancy.mode}`] : []));
  lines.push('!');
  for (const [name, acl] of Object.entries<any>(c.features.acls || {})) {
    lines.push(acl.type==='ipv6'?`ipv6 access-list ${name}`:`ip access-list ${acl.type || 'extended'} ${name}`);
    for (const e of acl.entries || []) lines.push(` ${e.sequence} ${e.text}`);
    lines.push('!');
  }
  for(const [name,chain]of Object.entries<any>(c.features.keychains||{})){lines.push(`key chain ${name}`);for(const [id,key]of Object.entries<any>(chain.keys||{})){lines.push(` key ${id}`);if(key.keyString)lines.push(`  key-string ${key.keyString}`);if(key.algorithm)lines.push(`  cryptographic-algorithm ${key.algorithm}`);const date=(t:number)=>{const d=new Date(t);return `${d.toISOString().slice(11,19)} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;};for(const kind of ['accept','send'])if(key[kind+'Lifetime']){const life=key[kind+'Lifetime'];lines.push(`  ${kind}-lifetime ${date(life.start||Date.UTC(1970,0,1))} ${life.end!==undefined?date(life.end):'infinite'}`);}lines.push(' exit');}lines.push('!');}
  for(const [name,entries]of Object.entries<any[]>(c.features.arpAcls||{})){lines.push(`arp access-list ${name}`);for(const e of entries)lines.push(' '+renderARPBindingRule(e));lines.push('!');}
  for(const binding of c.features.staticBindings||[])lines.push(`ip source binding ${binding.mac} vlan ${binding.vlan} ${binding.ip} interface ${binding.interface}`);
  if(c.features.macAgingTime!==undefined)lines.push(`mac address-table aging-time ${c.features.macAgingTime}`);
  for(const[vlan,seconds]of Object.entries(c.features.macAgingVlans??{}))lines.push(`mac address-table aging-time ${seconds} vlan ${vlan}`);
  if(c.features.etherchannel?.loadBalance)lines.push(`port-channel load-balance ${c.features.etherchannel.loadBalance}`);
  for(const protocol of ['cdp','lldp'])for(const [field,command]of [['interval','timer'],['holdtime','holdtime']])if(c.features.discovery?.[protocol]?.[field]!==undefined)lines.push(`${protocol} ${command} ${c.features.discovery[protocol][field]}`);
  if(c.features.cdp!==undefined)lines.push(c.features.cdp?'cdp run':'no cdp run');
  if(c.features.lldp!==undefined)lines.push(c.features.lldp?'lldp run':'no lldp run');
  if(c.features.lacpSystemPriority)lines.push(`lacp system-priority ${c.features.lacpSystemPriority}`);
  if(c.features.icmpRateLimit!==undefined)lines.push(`ip icmp rate-limit unreachable ${c.features.icmpRateLimit}`);
  for(const [name,record]of Object.entries<any>(c.features.flowRecords||{})){lines.push(`flow record ${name}`);if(record.description)lines.push(` description ${record.description}`);for(const kind of ['match','collect'])for(const field of record[kind]||[])lines.push(` ${kind} ${field}`);lines.push('!');}
  for(const [name,exporter]of Object.entries<any>(c.features.flowExporters||{})){lines.push(`flow exporter ${name}`);if(exporter.description)lines.push(` description ${exporter.description}`);if(exporter.destination)lines.push(` destination ${exporter.destination}`);if(exporter.source)lines.push(` source ${exporter.source}`);lines.push(` transport udp ${exporter.port||2055}`,' export-protocol netflow-v9','!');}
  for(const [name,monitor]of Object.entries<any>(c.features.flowMonitors||{})){lines.push(`flow monitor ${name}`);if(monitor.description)lines.push(` description ${monitor.description}`);if(monitor.record)lines.push(` record ${monitor.record}`);if(monitor.exporter)lines.push(` exporter ${monitor.exporter}`);if(monitor.cacheTimeout)lines.push(` cache timeout active ${monitor.cacheTimeout}`);lines.push('!');}
  const crypto=c.features.crypto;
  if(crypto){
    for(const p of crypto.isakmpPolicies||[]){lines.push(`crypto isakmp policy ${p.priority}`,` encryption ${p.encryption}${p.encryption==='aes'&&p.keyLength?` ${p.keyLength}`:''}`,` hash ${p.hash}`,` authentication ${p.authentication}`,` group ${p.group}`);if(p.lifetime)lines.push(` lifetime ${p.lifetime}`);lines.push('!');}
    for(const k of crypto.isakmpKeys||[])lines.push(`crypto isakmp key ${k.key} address ${k.peer}`);
    for(const [name,t]of Object.entries<any>(crypto.transformSets||{}))lines.push(`crypto ipsec transform-set ${name} ${t.encryption}${t.encryption==='esp-aes'&&t.keyLength?` ${t.keyLength}`:''} ${t.integrity}`,` mode ${t.mode||'tunnel'}`,'!');
    for(const [name,maps]of Object.entries<any[]>(crypto.maps||{}))for(const m of maps){lines.push(`crypto map ${name} ${m.sequence} ipsec-isakmp`);if(m.peer)lines.push(` set peer ${m.peer}`);if(m.transformSets?.length)lines.push(` set transform-set ${m.transformSets.join(' ')}`);if(m.acl)lines.push(` match address ${m.acl}`);if(m.pfs)lines.push(` set pfs group${m.pfs}`);if(m.lifetime)lines.push(` set security-association lifetime seconds ${m.lifetime}`);lines.push('!');}
    for(const [name,p]of Object.entries<any>(crypto.profiles||{})){lines.push(`crypto ipsec profile ${name}`);if(p.transformSet)lines.push(` set transform-set ${p.transformSet}`);lines.push('!');}
  }
  if(c.features.msdp?.originatorId)lines.push(`ip msdp originator-id ${c.features.msdp.originatorId}`);
  for(const p of c.features.msdp?.peers??[])lines.push(`ip msdp peer ${p.address}${p.connectSource?' connect-source '+p.connectSource:''}${p.remoteAs?' remote-as '+p.remoteAs:''}`);
  for(const [name,map]of Object.entries<any>(c.features.classMaps||{})){lines.push(`class-map match-${map.match||'all'} ${name}`);if(map.description)lines.push(` description ${map.description}`);if(map.dscp?.length)lines.push(` match dscp ${map.dscp.join(' ')}`);if(map.acl)lines.push(` match access-group name ${map.acl}`);lines.push('!');}
  for(const [name,policy]of Object.entries<any>(c.features.policyMaps||{})){lines.push(`policy-map ${name}`);for(const c of policy.classes||[]){lines.push(` class ${c.name}`);if(c.bandwidthPercent!==undefined)lines.push(`  bandwidth percent ${c.bandwidthPercent}`);for(const kind of ['bandwidth','priority'])if(c[kind])lines.push(`  ${kind} ${c[kind].percent!==undefined?(c[kind].remaining?'remaining ':'')+'percent '+c[kind].percent:c[kind].kbps}`);if(c.shape)lines.push(`  shape average ${c.shape.rate}`);if(c.fairQueue)lines.push(c.fairQueue===true?'  fair-queue':'  fair-queue '+c.fairQueue);if(c.queueLimit!==undefined)lines.push(`  queue-limit ${c.queueLimit} packets`);if(c.randomDetect)lines.push(...renderWred(c.randomDetect).map(line=>'  '+line));if(c.drop)lines.push('  drop');if(c.dscp!==undefined)lines.push(`  set dscp ${c.dscp}`);if(c.police){lines.push(`  police ${c.police.rate}${c.police.burst!==undefined?` bc ${c.police.burst}`:''}${c.police.excessBurst!==undefined||c.police.threeColor===true?` be ${c.police.excessBurst??c.police.burst??Math.max(1500,Math.round(c.police.rate/32))}`:''}`);for(const color of ['conform','exceed','violate']){const a=c.police[color];if(a)lines.push(`   ${color}-action ${a.kind==='set-dscp'?'set-dscp-transmit '+a.value:a.kind==='set-precedence'?'set-prec-transmit '+a.value:a.kind}`);}lines.push('  exit');}lines.push(' exit');}lines.push('!');}
  if (c.dnsServers.length) lines.push(`ip name-server ${c.dnsServers.join(' ')}`);
  const stp = c.features.stp, switching = ['switch','poeswitch','l3switch'].includes(device.kind);
  if (stp || switching) {
    lines.push(`spanning-tree mode ${stp?.mode || 'rapid-pvst'}`);
    if (switching) lines.push('spanning-tree extend system-id');
  }
  if (stp) {
    if(stp.uplinkFast)lines.push('spanning-tree uplinkfast');
    const orderedTimers=(timers:any,base=20)=>{const a=[['helloTime','hello-time'],['maxAge','max-age'],['forwardTime','forward-time']];return (timers.maxAge??base)>base?a.reverse():a;};
    for(const [field,command]of orderedTimers(stp))if(stp[field]!==undefined)lines.push(`spanning-tree ${command} ${stp[field]}`);
    for(const [vlan,timers]of Object.entries<any>(stp.vlanTimers||{}))for(const [field,command]of orderedTimers(timers,stp.maxAge??20))if(timers[field]!==undefined)lines.push(`spanning-tree vlan ${vlan} ${command} ${timers[field]}`);
    for (const [v,p] of Object.entries(stp.vlanPriorities || {})) lines.push(`spanning-tree vlan ${v} priority ${p}`);
    if (stp.mst) {
      lines.push('spanning-tree mst configuration', ` name ${stp.mst.name || ''}`, ` revision ${stp.mst.revision || 0}`);
      for (const i of stp.mst.instances || []) lines.push(` instance ${i.id} vlan ${i.vlans.join(',')}`);
      lines.push(' exit');
      for(const [id,priority]of Object.entries(stp.mst.priorities||{}))lines.push(`spanning-tree mst ${id} priority ${priority}`);
    }
  }
  if (switching) lines.push('!', 'vlan internal allocation policy ascending');
  if (stp || switching) lines.push('!');
  for (const v of Object.values(c.vlans).sort((a,b) => a.id-b.id)) {
    if (v.id === 1 && v.name === 'default') continue;
    lines.push(`vlan ${v.id}`, ...(v.name !== `VLAN${String(v.id).padStart(4,'0')}` ? [` name ${v.name}`] : []), ...(v.active ? [] : [' shutdown']), ...(c.features.rspanVlans?.includes(v.id)?[' remote-span']:[]), '!');
  }
  if (c.features.vtp) for (const k of ['domain','mode','version','password']) {const value=c.features.vtp[k];if(value!==undefined&&value!==''&&!(k==='mode'&&value==='server')&&!(k==='version'&&value===1))lines.push(`vtp ${k} ${value}`);}
  if(c.features.calendarValid)lines.push('clock calendar-valid');
  if(c.features.cefHash){const h=c.features.cefHash;lines.push(`ip cef load-sharing algorithm ${h.algorithm}${h.sourcePort?' source':''}${h.destinationPort?' destination':''}${h.seed!==undefined?' '+h.seed.toString(16).toUpperCase():''}`);}
  if(c.features.igmpSnooping){const all=c.features.igmpSnooping;const emit=(settings:any,base:string)=>{if(settings.enabled!==undefined)lines.push((settings.enabled?'':'no ')+base);if(settings.querier!==undefined)lines.push((settings.querier?'':'no ')+base+' querier');if(settings.querierAddress)lines.push(base+' querier address '+settings.querierAddress);if(settings.queryInterval!==undefined)lines.push(base+' querier query-interval '+settings.queryInterval);if(settings.maxResponse!==undefined)lines.push(base+' querier max-response-time '+settings.maxResponse);if(settings.membershipInterval!==undefined)lines.push(base+' membership-interval '+settings.membershipInterval);if(settings.immediateLeave!==undefined)lines.push((settings.immediateLeave?'':'no ')+base+' immediate-leave');for(const port of settings.mrouter||[])lines.push(base+' mrouter interface '+port);};emit(all,'ip igmp snooping');for(const [vlan,settings]of Object.entries(all.vlans||{}))emit(settings,'ip igmp snooping vlan '+vlan);}
  if(c.features.dhcpSnooping){if(c.features.dhcpSnooping.enabled)lines.push('ip dhcp snooping');if(c.features.dhcpSnooping.vlans.length)lines.push(`ip dhcp snooping vlan ${c.features.dhcpSnooping.vlans.join(',')}`);}
  if(c.features.dhcpSnooping?.option82)lines.push('ip dhcp snooping information option');
  if(c.features.dhcpSnooping?.allowUntrustedOption82)lines.push('ip dhcp snooping information option allow-untrusted');
  if(c.features.arpInspection?.vlans.length)lines.push(`ip arp inspection vlan ${c.features.arpInspection.vlans.join(',')}`);
  for(const filter of c.features.arpInspection?.filters||[])lines.push(`ip arp inspection filter ${filter.acl} vlan ${filter.vlans.join(',')}${filter.static?' static':''}`);
  const validation=c.features.arpInspection?.validations;if(validation){const fields=[validation.sourceMac?'src-mac':'',validation.destinationMac?'dst-mac':'',validation.ip?'ip':''].filter(Boolean);if(fields.length)lines.push(`ip arp inspection validate ${fields.join(' ')}`);}
  for(const cause of c.features.errdisable?.causes||[])lines.push(`errdisable recovery cause ${cause}`);
  if(c.features.errdisable?.interval)lines.push(`errdisable recovery interval ${c.features.errdisable.interval}`);
  for(const [id,span]of Object.entries<any>(c.features.spanSessions||{})){
    if(span.type?.startsWith('erspan')){
      lines.push(`monitor session ${id} type ${span.type}`);
      for(const source of span.sources||[])lines.push(` source interface ${source.interface} ${source.direction}`);
      if(span.destination)lines.push(` destination interface ${span.destination}`);
      if(['erspanId','ipAddress','originIp','vrf'].some(key=>span[key]!==undefined)){
        lines.push(span.type==='erspan-source'?' destination':' source');
        if(span.erspanId!==undefined)lines.push(`  erspan-id ${span.erspanId}`);
        if(span.ipAddress)lines.push(`  ip address ${span.ipAddress}`);
        if(span.originIp)lines.push(`  origin ip address ${span.originIp}`);
        if(span.vrf)lines.push(`  vrf ${span.vrf}`);
        lines.push(' exit');
      }
      lines.push(span.shutdown?' shutdown':' no shutdown',' exit','!');
    }else{
      for(const source of span.sources||[])lines.push(`monitor session ${id} source interface ${source.interface} ${source.direction}`);
      if(span.remoteVlan)lines.push(`monitor session ${id} destination remote vlan ${span.remoteVlan}`);
      if(span.sourceVlan)lines.push(`monitor session ${id} source remote vlan ${span.sourceVlan}`);
      if(span.destination)lines.push(`monitor session ${id} destination interface ${span.destination}`);
    }
  }
  if(c.features.netflow?.destination)lines.push(`ip flow-export destination ${c.features.netflow.destination} ${c.features.netflow.port||2055}`);
  for(const [name,vrf]of Object.entries<any>(c.features.vrfs||{})){lines.push(`vrf definition ${name}`);if(vrf.description)lines.push(` description ${vrf.description}`);if(vrf.rd)lines.push(` rd ${vrf.rd}`);for(const target of vrf.routeTargets||[])lines.push(` route-target ${target.direction} ${target.value}`);for(const[family,af]of Object.entries<any>(vrf.addressFamilies||{})){lines.push(` address-family ${family}`);for(const target of af.routeTargets||[])lines.push(`  route-target ${target.direction} ${target.value}`);lines.push(' exit-address-family');}lines.push('!');}
  for(const [kind,command]of [['raGuard','ipv6 nd raguard'],['dhcpv6Guard','ipv6 dhcp guard'],['ndInspection','ipv6 nd inspection'],['sourceGuard','ipv6 source-guard']])for(const [name,policy]of Object.entries<any>(c.features.ipv6Policies?.[kind]||{})){lines.push(`${command} policy ${name}`);if(policy.deviceRole)lines.push(` device-role ${policy.deviceRole}`);for(const [field,cmd]of [['trusted','trusted-port'],['validateSourceMac','validate source-mac'],['dropUnsecure','drop-unsecure'],['validateAddress','validate address'],['validatePrefix','validate prefix'],['permitLinkLocal','permit link-local'],['denyGlobalAutoconf','deny global-autoconf']])if(policy[field]!==undefined&&!(field==='trusted'&&kind==='sourceGuard'))lines.push((policy[field]?' ':' no ')+cmd);for(const [field,cmd]of [['hopLimitMin','hop-limit minimum'],['hopLimitMax','hop-limit maximum'],['managedFlag','managed-config-flag'],['otherFlag','other-config-flag'],['routerPreferenceMaximum','router-preference maximum'],['sourceAcl','match ipv6 access-list'],['serverAcl','match server access-list'],['prefixList',kind==='raGuard'?'match ra prefix-list':'match reply prefix-list'],['serverPreferenceMin','preference min'],['serverPreferenceMax','preference max'],['securityLevel','sec-level minimum']])if(policy[field]!==undefined)lines.push(` ${cmd} ${policy[field]}`);if(policy.limit!==undefined)lines.push(' limit address-count '+policy.limit);if(policy.tracking)lines.push(` tracking ${policy.tracking}${policy.lifetime!==undefined?' '+(policy.tracking==='enable'?'reachable-lifetime':'stale-lifetime')+' '+policy.lifetime:''}`);if(kind==='sourceGuard'&&policy.trusted)lines.push(' trusted');lines.push(' exit','!');}
  for(const [name,b]of Object.entries<any>(c.features.bfdTemplates||{})){lines.push(`bfd-template single-hop ${name}`,` interval min-tx ${b.minTx??300} min-rx ${b.minRx??300} multiplier ${b.multiplier??3}`);if(b.echo)lines.push(' echo');if(b.authentication)lines.push(` authentication ${b.authentication.mode} keychain ${b.authentication.keyChain}`);if(b.dampening)lines.push(' dampening '+b.dampening.join(' '));lines.push(' exit','!');}
  if(c.features.flowTopTalkers){const top=c.features.flowTopTalkers;lines.push('ip flow-top-talkers',` top ${top.top}`,` sort-by ${top.sortBy}`,` cache-timeout ${top.cacheTimeout}`,' exit','!');}
  const compatLines=switchingCompatibilityLines({...device,config:c}),controlPlaneAt=compatLines.indexOf('control-plane');
  if(controlPlaneAt>=0)compatLines.splice(controlPlaneAt,4);
  lines.push(...compatLines,...endpointGlobalLines(c));
  for (const p of orderedInterfaces(c)) lines.push(...interfaceLines(p,c,device.kind));
  const processEntries=['ospf','eigrp','eigrp6','rip','bgp','ospfv3','ospfv3ipv4','ripng'].flatMap(protocol=>{const root=c.protocols[protocol];return root?[[protocol,undefined,root],...Object.entries<any>(root.vrfs??{}).map(([vrf,p])=>[protocol,vrf,p])]:[];});
  for (const [protocol,vrf,p] of processEntries as [string,string|undefined,any][]) {
    if (!p || p.placeholder || ((protocol==='eigrp'||protocol==='eigrp6')&&p.name&&!p.asn)) continue;
    const named=(protocol==='eigrp'||protocol==='eigrp6')&&p.name;
    lines.push(named?`router eigrp ${p.name}`:protocol==='eigrp6'?`ipv6 router eigrp ${p.asn||1}`:protocol.startsWith('ospfv3')?`${p.modernSyntax?'router ospfv3':'ipv6 router ospf'} ${p.processId||1}`:protocol==='ripng'?`ipv6 router rip ${p.processId||'RIPNG'}`:`router ${protocol}${protocol === 'rip' ? '' : ` ${p.processId || p.asn || 1}`}`);
    if(vrf&&protocol.startsWith('ospf'))lines[lines.length-1]+=` vrf ${vrf}`;
    else if(vrf)lines.push(` address-family ${protocol==='eigrp6'?'ipv6':'ipv4'} vrf ${vrf}${protocol.startsWith('eigrp')?' autonomous-system '+(p.asn||1):''}`);else if(named)lines.push(` address-family ${protocol==='eigrp6'?'ipv6':'ipv4'} unicast autonomous-system ${p.asn||1}`);
    if(protocol.startsWith('ospfv3')&&p.modernSyntax)lines.push(` address-family ${protocol==='ospfv3ipv4'?'ipv4':'ipv6'} unicast`);
    const routingLines=routingCompatibilityLines(protocol,p);lines.push(...routingLines.filter(line=>!named||!line.trimStart().startsWith('summary-metric ')));if(named){const summaries=routingLines.filter(line=>line.trimStart().startsWith('summary-metric '));if(summaries.length)lines.push(' topology base',...summaries.map(line=>' '+line),' exit-af-topology');}
    if(p.autoSummary!==undefined){if(named&&protocol==='eigrp')lines.push(' topology base',p.autoSummary?'  auto-summary':'  no auto-summary',' exit-af-topology');else lines.push(p.autoSummary?' auto-summary':' no auto-summary');}
    if(p.ribScale!==undefined)lines.push(` metric rib-scale ${p.ribScale}`);
    if(p.activeTime!==undefined)lines.push(` timers active-time ${p.activeTime===0?'disabled':p.activeTime/60000}`);
    if(protocol==='bgp'){
      if(p.defaultIPv4Unicast===false)lines.push(' no bgp default ipv4-unicast');
      if(p.bgpLogNeighborChanges)lines.push(' bgp log-neighbor-changes');
      if(p.alwaysCompareMed)lines.push(' bgp always-compare-med');
      if(p.deterministicMed)lines.push(' bgp deterministic-med');
      if(p.dampening)lines.push(` bgp dampening ${p.dampening.halfLife} ${p.dampening.reuse} ${p.dampening.suppress} ${p.dampening.maxSuppress}`);
      if(p.defaultLocalPreference!==undefined)lines.push(` bgp default local-preference ${p.defaultLocalPreference}`);
      if(p.bgpDistance)lines.push(` distance bgp ${p.bgpDistance.external} ${p.bgpDistance.internal} ${p.bgpDistance.local}`);
    }
    if(protocol==='bgp'&&p.timers)lines.push(` timers bgp ${p.timers.keepalive??60} ${p.timers.hold??180}`);
    if(['rip','ripng'].includes(protocol)&&p.timers)lines.push(` timers basic ${p.timers.update} ${p.timers.invalid} ${p.timers.holddown} ${p.timers.flush}`);
    if(p.enabled===false)lines.push(' shutdown');
    if(p.clusterId)lines.push(` bgp cluster-id ${p.clusterId}`);
    if(p.bfd)lines.push(' bfd all-interfaces');
    if(protocol==='eigrp'||protocol==='eigrp6')for(const iface of Object.values(c.interfaces))if((iface.vrf??'')===(vrf??'')&&iface.features[protocol]?.bfd!==undefined){const on=iface.features[protocol].bfd;if(named)lines.push(` af-interface ${iface.name}`,on?'  bfd':'  no bfd',' exit-af-interface');else lines.push(`${on?' ':' no '}bfd interface ${iface.name}`);}
    if (p.routerId) lines.push(` router-id ${p.routerId}`);
    for(const filter of p.distributeLists||[])lines.push(` distribute-list ${filter.prefixList?`prefix ${filter.prefixList}`:filter.routeMap?`route-map ${filter.routeMap}`:filter.acl} ${filter.direction}${filter.interface?` ${filter.interface}`:''}${filter.protocol?` ${filter.protocol}${filter.processId!==undefined?' '+filter.processId:''}`:''}`);
    for(const offset of p.offsetLists||[])lines.push(` offset-list ${offset.acl} ${offset.direction} ${offset.offset}${offset.interface?` ${offset.interface}`:''}`);
    if (protocol === 'rip') lines.push(` version ${p.version || 2}`);
    for (const n of p.networks || []) lines.push(` network ${n.network}${protocol === 'ospfv3'?`/${n.prefix} area ${n.area}`:protocol==='ripng'||protocol==='eigrp6'?`/${n.prefix}`:protocol === 'ospf' ? ` ${wildcard(n.prefix)} area ${n.area}` : protocol === 'bgp' ? ` mask ${prefixMask(n.prefix)}` : protocol === 'eigrp' ? ` ${wildcard(n.prefix)}` : ''}`);
    if(p.passiveDefault)lines.push(' passive-interface default');
    for (const intf of p.passiveInterfaces || []) lines.push(` passive-interface ${intf}`);
    for (const intf of p.activeInterfaces || []) lines.push(` no passive-interface ${intf}`);
    if (p.defaultOriginate) lines.push(' default-information originate'+(p.defaultAlways?' always':''));
    if (p.maximumPaths) lines.push(` maximum-paths ${p.maximumPaths}`);
    if(p.variance!==undefined)lines.push(` variance ${p.variance}`);
    if(p.stub)lines.push(` eigrp stub ${p.stub.join(' ')}`);
    for(const v of p.virtualLinks||[]){const base=` area ${v.transitArea} virtual-link ${v.routerId}`;lines.push(`${base}${v.helloInterval?` hello-interval ${v.helloInterval}`:''}${v.deadInterval?` dead-interval ${v.deadInterval}`:''}${v.authentication?` authentication${v.authenticationKeyChain?' key-chain '+v.authenticationKeyChain:['message-digest','null'].includes(v.authentication)?' '+v.authentication:''}`:''}`);if(v.authenticationKey)lines.push(`${base} authentication-key ${JSON.stringify(v.authenticationKey)}`);for(const [keyId,key]of Object.entries(v.messageDigestKeys??{}))lines.push(`${base} message-digest-key ${keyId} md5 ${JSON.stringify(key)}`);}
    for(const [id,area]of Object.entries<any>(p.areas||{})){if(area.authentication)lines.push(` area ${id} authentication${area.authentication==='message-digest'?' message-digest':''}`);if(area.type)lines.push(` area ${id} ${area.type}${area.noSummary?' no-summary':''}${area.defaultOriginate?' default-information-originate':''}${area.noRedistribution?' no-redistribution':''}`);if(area.defaultCost!==undefined)lines.push(` area ${id} default-cost ${area.defaultCost}`);for(const r of area.ranges||[])lines.push(` area ${id} range ${r.network.includes(':')?r.network+'/'+r.prefix:r.network+' '+prefixMask(r.prefix)}${r.notAdvertise?' not-advertise':''}${r.cost!==undefined?` cost ${r.cost}`:''}`);}
    for(const r of p.redistribute||[])lines.push(` redistribute ${r.protocol}${r.metric!==undefined?` metric ${r.metric}`:''}${r.metricType?` metric-type ${r.metricType}`:''}${r.routeMap?` route-map ${r.routeMap}`:''}${r.tag?` tag ${r.tag}`:''}`);
    for(const aggregate of p.aggregates||[])lines.push(` aggregate-address ${aggregate.network} ${prefixMask(aggregate.prefix)}${aggregate.summaryOnly?' summary-only':''}`);
    const renderBgpPeer=(n:any)=>{
      if(n.remoteAs!==undefined)lines.push(` neighbor ${n.address} remote-as ${n.remoteAs}`);
      if(n.password!==undefined)lines.push(` neighbor ${n.address} password ${n.passwordType===7||c.features.passwordEncryption?'7 '+encodeType7(n.password):'0 '+n.password}`);
      if(n.weight!==undefined)lines.push(` neighbor ${n.address} weight ${n.weight}`);
      if(n.softReconfigurationInbound)lines.push(` neighbor ${n.address} soft-reconfiguration inbound`);
      if(n.defaultOriginate)lines.push(` neighbor ${n.address} default-originate${n.defaultOriginateRouteMap?' route-map '+n.defaultOriginateRouteMap:''}`);
      if(n.removePrivateAs)lines.push(` neighbor ${n.address} remove-private-as${n.removePrivateAs==='all'?' all':n.removePrivateAs==='replace-as'?' all replace-as':''}`);
      if(n.allowAsIn)lines.push(` neighbor ${n.address} allowas-in ${n.allowAsIn}`);
      if(n.routeReflectorClient)lines.push(` neighbor ${n.address} route-reflector-client`);
      if(n.sendCommunity)lines.push(` neighbor ${n.address} send-community`);
      if(n.ttlSecurityHops)lines.push(` neighbor ${n.address} ttl-security hops ${n.ttlSecurityHops}`);
      if(n.bfd)lines.push(` neighbor ${n.address} fall-over bfd`);
      if(n.timers?.keepalive!==undefined||n.timers?.hold!==undefined)lines.push(` neighbor ${n.address} timers ${n.timers.keepalive??60} ${n.timers.hold??180}`);
      if(n.timers?.connectRetry!==undefined)lines.push(` neighbor ${n.address} timers connect ${n.timers.connectRetry}`);
      if(n.maximumPrefix)lines.push(` neighbor ${n.address} maximum-prefix ${n.maximumPrefix}`);
      if(n.description)lines.push(` neighbor ${n.address} description ${n.description}`);
      if (n.shutdown) lines.push(` neighbor ${n.address} shutdown`);
      if (n.nextHopSelf) lines.push(` neighbor ${n.address} next-hop-self`);
      if (n.ebgpMultihop) lines.push(` neighbor ${n.address} ebgp-multihop ${n.ebgpMultihop}`);
      if(n.updateSource)lines.push(` neighbor ${n.address} update-source ${n.updateSource}`);
      for(const direction of ['In','Out']){if(n[`routeMap${direction}`])lines.push(` neighbor ${n.address} route-map ${n[`routeMap${direction}`]} ${direction.toLowerCase()}`);if(n[`prefixList${direction}`])lines.push(` neighbor ${n.address} prefix-list ${n[`prefixList${direction}`]} ${direction.toLowerCase()}`);}
    };
    for(const n of protocol==='bgp'?p.neighbors||[]:[])renderBgpPeer(n);
    if(protocol==='bgp'){
      if(p.maximumPathsIbgp)lines.push(` maximum-paths ibgp ${p.maximumPathsIbgp}`);
      const explicit=(p.neighbors??[]).filter((n:any)=>n.activated!==undefined&&(!n.address.includes(':')||n.activated));
      if(explicit.length){lines.push(' address-family ipv4 unicast'+(vrf?' vrf '+vrf:''),...explicit.map((n:any)=>`  ${n.activated?'':'no '}neighbor ${n.address} activate`),' exit-address-family');}
      if(p.ipv6){const af=p.ipv6;lines.push(' address-family ipv6 unicast'+(vrf?' vrf '+vrf:''));for(const n of af.networks??[])lines.push(`  network ${n.network}/${n.prefix}`);for(const n of af.neighbors??[]){renderBgpPeer(n);lines.push(`  ${n.activated===false?'no ':''}neighbor ${n.address} activate`);}for(const r of af.redistribute??[])lines.push(`  redistribute ${r.protocol}${r.metric!==undefined?' metric '+r.metric:''}${r.routeMap?' route-map '+r.routeMap:''}`);for(const r of af.aggregates??[])lines.push(`  aggregate-address ${r.network}/${r.prefix}${r.summaryOnly?' summary-only':''}`);if(af.defaultLocalPreference!==undefined)lines.push(`  bgp default local-preference ${af.defaultLocalPreference}`);if(af.alwaysCompareMed)lines.push('  bgp always-compare-med');if(af.deterministicMed)lines.push('  bgp deterministic-med');if(af.dampening)lines.push(`  bgp dampening ${af.dampening.halfLife} ${af.dampening.reuse} ${af.dampening.suppress} ${af.dampening.maxSuppress}`);if(af.maximumPaths)lines.push(`  maximum-paths ${af.maximumPaths}`);if(af.maximumPathsIbgp)lines.push(`  maximum-paths ibgp ${af.maximumPathsIbgp}`);if(af.bgpDistance)lines.push(`  distance bgp ${af.bgpDistance.external} ${af.bgpDistance.internal} ${af.bgpDistance.local}`);lines.push(' exit-address-family');}
    }
    if(named||vrf&&!protocol.startsWith('ospf'))lines.push(' exit-address-family');
    lines.push('!');
  }
  if (c.defaultGateway) lines.push(`ip default-gateway ${c.defaultGateway}`);
  if (IOS_KINDS.includes(device.kind)) lines.push('ip forward-protocol nd', '!');
  const httpPlatform = platformGlobal.filter(line => line.startsWith('ip http '));
  lines.push(c.services.http?.enabled ? 'ip http server' : 'no ip http server', ...(c.services.http?.secureEnabled ? [] : ['no ip http secure-server']), ...httpPlatform);
  for (const route of c.staticRoutes) lines.push(routeLine(route));
  for(const binding of c.features.staticBfd??[])lines.push(`ip route static bfd ${binding.interface} ${binding.peer}`);
  for(const network of c.features.defaultNetworks??[])lines.push(`ip default-network ${network}`);
  lines.push('!');
  if(c.features.bgpCommunityNewFormat)lines.push('ip bgp-community new-format');
  for(const [name,entries]of Object.entries<any[]>(c.features.asPathLists||{}))for(const e of entries)lines.push(`ip as-path access-list ${name} ${e.action} ${e.pattern}`);
  for(const [name,entries]of Object.entries<any[]>(c.features.communityLists||{}))for(const e of entries)lines.push(`ip community-list ${/^\d+$/.test(name)?'':(e.type??'standard')+' '}${name} ${e.action} ${e.pattern??e.communities.map((v:string)=>displayCommunity(v,!!c.features.bgpCommunityNewFormat)).join(' ')}`);
  for(const [name,entries] of Object.entries<any[]>(c.features.prefixLists||{}))for(const e of entries)lines.push(`${e.network.includes(':')?'ipv6':'ip'} prefix-list ${name} seq ${e.sequence} ${e.action} ${e.network}/${e.prefix}${e.ge!==undefined?` ge ${e.ge}`:''}${e.le!==undefined?` le ${e.le}`:''}`);
  for(const r of Object.values<any>(c.features.routeMaps||{})){lines.push(`route-map ${r.name} ${r.action} ${r.sequence}`,...r.match.map((x:string)=>' match '+x),...(r.continue===undefined?[]:[' continue'+(r.continue===null?'':' '+r.continue)]),...r.set.map((x:string)=>' set '+(x.startsWith('community ')?x.split(' ').map((v:string,i:number)=>i?displayCommunity(v,!!c.features.bgpCommunityNewFormat):v).join(' '):x)),'!');}
  for(const [id,track] of Object.entries<any>(c.features.tracks||{})){lines.push(track.type==='list'?`track ${id} list ${track.thresholdType?'threshold '+track.thresholdType:'boolean '+(track.operator||'and')}`:track.type==='sla'?`track ${id} ip sla ${track.sla} reachability`:track.type==='bfd'?`track ${id} bfd ${track.interface}${track.peer?` ${track.peer}`:''}`:track.type==='interface'?`track ${id} interface ${track.interface} line-protocol`:`track ${id} ip route ${track.network} ${prefixMask(track.prefix)} reachability`);for(const object of track.objects||[])lines.push(` object ${object.id}${object.not?' not':''}${object.weight!==undefined?' weight '+object.weight:''}`);if(track.thresholds)lines.push(' threshold '+track.thresholdType+(track.thresholds.up!==undefined?' up '+track.thresholds.up:'')+(track.thresholds.down!==undefined?' down '+track.thresholds.down:''));if(track.delayUp!==undefined||track.delayDown!==undefined)lines.push(' delay'+(track.delayUp!==undefined?` up ${track.delayUp}`:'')+(track.delayDown!==undefined?` down ${track.delayDown}`:''));if(track.description)lines.push(` description ${track.description}`);lines.push('!');}
  const nat=c.features.nat;
  if(nat){for(const r of nat.static||[])lines.push(`ip nat inside source static ${r.inside} ${r.outside}`);for(const [name,pool]of Object.entries<any>(nat.pools||{}))lines.push(`ip nat pool ${name} ${pool.start} ${pool.end} netmask ${pool.mask}`);for(const rule of nat.rules||[])lines.push(`ip nat inside source list ${rule.acl} ${rule.interface?`interface ${rule.interface}`:`pool ${rule.pool}`}${rule.overload?' overload':''}`);}
  if(c.features.udld)lines.push(`udld ${c.features.udld.mode==='aggressive'?'aggressive':'enable'}`,`udld message time ${c.features.udld.messageTime||15}`);
  if(c.features.ptp)for(const [key,value]of Object.entries(c.features.ptp))lines.push(`ptp ${key} ${value}`);
  if(c.features.ipSlaResponder?.enabled)lines.push('ip sla responder');for(const port of c.features.ipSlaResponder?.ports||[])lines.push(`ip sla responder udp-echo${port.address?' ipaddress '+port.address:''} port ${port.port}`);
  for(const [id,p]of Object.entries<any>(c.features.ipSla||{})){lines.push(`ip sla ${id}`);if(p.type==='http'&&p.url)lines.push(` http get ${p.url}`);else if(p.type==='udp-jitter'&&p.target)lines.push(` udp-jitter ${p.target} ${p.port} num-packets ${p.numPackets??10} interval ${p.interval??20}${p.source?' source-ip '+p.source:''}${p.sourcePort?' source-port '+p.sourcePort:''} control ${p.control===false?'disable':'enable'}`);else if(p.target)lines.push(` icmp-echo ${p.target}${p.source?` ${p.source.includes('.')?'source-ip':'source-interface'} ${p.source}`:''}`);for(const key of ['frequency','timeout','threshold'])if(p[key]!==undefined)lines.push(` ${key} ${p[key]}`);lines.push('!');}
  for(const [id,p]of Object.entries<any>(c.features.ipSlaSchedules||{}))lines.push(`ip sla schedule ${id} life ${p.life||'forever'} start-time now`);
  if(c.features.multicastRouting)lines.push('ip multicast-routing');
  if(c.features.pim?.sptThreshold!==undefined)lines.push(`ip pim spt-threshold ${c.features.pim.sptThreshold}`);
  if(c.features.pim?.rpAddress)lines.push(`ip pim rp-address ${c.features.pim.rpAddress}`);
  for(const r of c.features.pim?.ssmRanges||[])lines.push(`ip pim ssm range ${r.network}/${r.prefix}`);
  for(const [name,local]of Object.entries<any>(c.features.ipv6LocalPools||{}))lines.push(`ipv6 local pool ${name} ${local.prefix} ${local.length}`);
  for(const p of c.services.dhcpv6?.pools||[]){lines.push(`ipv6 dhcp pool ${p.name}`);if(p.prefix)lines.push(` address prefix ${p.prefix}${p.leaseSeconds!==undefined?` lifetime ${p.leaseSeconds} ${p.preferredLifetime??p.leaseSeconds}`:''}`);for(const address of p.dnsServers||[])lines.push(` dns-server ${address}`);if(p.domain)lines.push(` domain-name ${p.domain}`);if(p.delegatedPrefix)lines.push(` prefix-delegation ${p.pdPoolName?'pool '+p.pdPoolName:p.delegatedPrefix+' length '+(p.delegatedLength||64)}${p.pdLeaseSeconds!==undefined?` lifetime ${p.pdLeaseSeconds} ${p.pdPreferredLifetime??p.pdLeaseSeconds}`:''}`);lines.push('!');}
  for(const [protocol,seconds]of Object.entries(c.features.nat?.timeouts||{}))lines.push(`ip nat translation ${protocol}-timeout ${seconds}`);
  if(c.features.logging?.enabled===false)lines.push('no logging on');
  if(c.features.logging?.console!==undefined)lines.push(`${c.features.logging.console?'':'no '}logging console${c.features.logging.console?' '+(c.features.logging.consoleLevel??7):''}`);
  for(const host of c.features.logging?.hosts||[])lines.push(`logging host ${host}`);
  if(c.features.logging?.trapEnabled===false)lines.push('no logging trap');else if(c.features.logging?.trap!==undefined)lines.push(`logging trap ${c.features.logging.trap}`);
  if(c.features.logging?.source)lines.push(`logging source-interface ${c.features.logging.source}`);
  if(c.features.logging?.facility!==undefined)lines.push(`logging facility ${c.features.logging.facility}`);
  if(c.features.logging?.monitor===false)lines.push('no logging monitor');else if(c.features.logging?.monitorLevel!==undefined)lines.push(`logging monitor ${c.features.logging.monitorLevel}`);
  if(c.features.logging?.buffered!==undefined)lines.push(`${c.features.logging.buffered?'':'no '}logging buffered${c.features.logging.buffered?`${c.features.logging.bufferSize?` ${c.features.logging.bufferSize}`:''}${c.features.logging.bufferedLevel!==undefined?` ${c.features.logging.bufferedLevel}`:''}`:''}`);
  lines.push(...renderFTPClient(c.features));
  if(c.features.ssh?.version)lines.push('ip ssh version 2');
  if(c.features.ssh?.keys)lines.push(`crypto key generate rsa modulus ${c.features.ssh.keys.modulus||2048}`);
  if(c.features.archive){const a=c.features.archive;lines.push('archive',` path ${a.path||'flash:archive'}`,` maximum ${a.maximum||10}`);if(a.writeMemory)lines.push(' write-memory');if(a.timePeriod)lines.push(` time-period ${a.timePeriod}`);lines.push('!');}
  if(c.features.snmp)lines.push(...renderSNMP(c.features.snmp));
  for(const [name,server]of Object.entries<any>(c.features.aaa?.servers||{})){if(server.legacy){lines.push(`radius-server host ${server.address}${server.port?' auth-port '+server.port:''}${server.accountingPort?' acct-port '+server.accountingPort:''}${server.timeout?' timeout '+server.timeout:''}${server.retransmit!==undefined?' retransmit '+server.retransmit:''}${server.key?' key '+JSON.stringify(server.key):''}`);continue;}lines.push(`${server.protocol} server ${name}`);if(server.address)lines.push(` address ipv4 ${server.address}${server.protocol==='radius'?` auth-port ${server.port??1812} acct-port ${server.accountingPort??1813}`:''}`);if(server.protocol==='tacacs'&&server.port!==undefined)lines.push(` port ${server.port}`);if(server.timeout!==undefined)lines.push(` timeout ${server.timeout}`);if(server.retransmit!==undefined)lines.push(` retransmit ${server.retransmit}`);if(server.singleConnection)lines.push(' single-connection');if(server.key)lines.push(` key ${JSON.stringify(server.key)}`);lines.push('!');}
  for(const [name,group]of Object.entries<any>(c.features.aaa?.groups||{})){lines.push(`aaa group server ${group.protocol==='tacacs'?  'tacacs+':'radius'} ${name}`);for(const server of group.servers||[])lines.push(` server name ${server}`);lines.push('!');}
    if(c.features.aaa?.authorizeConsole!==undefined)lines.push((c.features.aaa.authorizeConsole?'':'no ')+'aaa authorization console');if(c.features.aaa?.authorizeConfig!==undefined)lines.push((c.features.aaa.authorizeConfig?'':'no ')+'aaa authorization config-commands');for(const [kind,lists]of Object.entries<any>(c.features.aaa?.authorization||{}))for(const [name,methods]of Object.entries<string[]>(lists))lines.push(`aaa authorization ${kind.startsWith('commands')?'commands '+kind.slice(8):kind} ${name} ${methods.join(' ')}`);for(const [key,methods]of Object.entries<string[]>(c.features.aaa?.accounting||{}))lines.push(`aaa accounting ${key} ${methods.join(' ')}`);
  for(const [name,methods]of Object.entries<string[]>(c.features.aaa?.enable||{}))lines.push(`aaa authentication enable ${name} ${methods.join(' ')}`);
  for(const [name,methods]of Object.entries<string[]>(c.features.aaa?.login||{}))lines.push(`aaa authentication login ${name} ${methods.join(' ')}`);
  if(c.services.http?.authentication&&c.services.http.authentication!=='none')lines.push(`ip http authentication ${c.services.http.authentication}${c.services.http.authentication==='aaa'&&c.services.http.authenticationList?` login-authentication ${c.services.http.authenticationList}`:''}`);
  if(c.services.http?.basePath)lines.push(`ip http path ${c.services.http.basePath}`);
  if(c.services.dns?.enabled)lines.push('ip dns server');
  for(const [name,address]of Object.entries(c.services.dns?.records||{}))lines.push(`ip host ${name} ${address}`);
  lines.push(...platformGlobal.filter(line => !line.startsWith('boot system ') && !line.startsWith('ip http ')), '!');
  if (router || c.features.controlPlanePolicyIn) lines.push('control-plane', ...(c.features.controlPlanePolicyIn ? [` service-policy input ${c.features.controlPlanePolicyIn}`] : []), '!');
  for (const [kind, text] of Object.entries<string>(c.features.banners || {})) lines.push(`banner ${kind} ^C${text}^C`);
  lines.push('!');
  lines.push(...renderLineBlocks(c, device.kind));
  lines.push('!');
  if (router) lines.push('no scheduler allocate');
  if(c.features.ntp?.source)lines.push(`ntp source ${c.features.ntp.source}`);
  if(c.features.ntp?.pollInterval)lines.push(`ntp poll-interval ${c.features.ntp.pollInterval}`);
  if(c.features.ntp?.master)lines.push(`ntp master ${c.features.ntp.master}`);
  if(c.features.ntp?.authenticate)lines.push('ntp authenticate');
  for(const [id,key]of Object.entries<any>(c.features.ntp?.keys||{}))lines.push(`ntp authentication-key ${id} md5 ${key.type===7?encodeType7(key.secret):JSON.stringify(key.secret)}${key.type===7?' 7':''}`);
  for(const id of c.features.ntp?.trusted||[])lines.push(`ntp trusted-key ${id}`);
  for(const s of c.features.ntp?.servers||[])lines.push(`ntp ${s.role||'server'} ${s.vrf?'vrf '+s.vrf+' ':''}${s.address}${s.prefer?' prefer':''}${s.source?` source ${s.source}`:''}${['key','version','minpoll','maxpoll'].map(key=>s[key]!==undefined?' '+key+' '+s[key]:'').join('')}${s.burst?' burst':''}${s.iburst?' iburst':''}`);
  for(const [name,a]of Object.entries<any>(c.features.eem||{})){lines.push(`event manager applet ${name}`);if(a.event.type==='timer')lines.push(` event timer ${a.event.mode} time ${a.event.seconds}`);else if(a.event.type==='syslog')lines.push(` event syslog pattern ${JSON.stringify(a.event.pattern)}`);else lines.push(' event none');for(const action of a.actions)lines.push(` action ${action.order} ${action.kind} ${action.kind==='cli'?'command':'msg'} ${JSON.stringify(action.text)}`);lines.push('!');}
  if (lines.at(-1) !== '!') lines.push('!');
  lines.push('end');
  return lines;
}
