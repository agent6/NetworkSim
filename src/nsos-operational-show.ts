import type {Simulator} from './engine.ts';
import type {Device,Route,Neighbor,InterfaceConfig} from './model.ts';
import {prefixContains,isIPv6,ipToInt,ipv6ToBigInt,maskToPrefix} from './ip.ts';
import {iosClock,severityNames} from './ios-system.ts';
import {iosDuration} from './ios-system-show.ts';
import {managementSessionSnapshot} from './management.ts';
import {neighborIdentity,iosInterfaceName} from './ios-show.ts';
import {interfaceRates} from './interface-telemetry.ts';
import {interfaceSpeed,interfaceBandwidth,interfaceDuplex} from './ethernet.ts';
import {refreshMacAging} from './mac-aging.ts';
import {vpcInterfaceMTU,vpcPortReason} from './datacenter.ts';

export const nsosPort=(port:string)=>port.replace(/^Ethernet/,'Eth').replace(/^Port-channel/,'Po').replace(/^Loopback/,'Lo');
const dotted=(value:string)=>(value.replace(/[^a-f0-9]/gi,'').match(/.{4}/g)??[]).join('.').toLowerCase();
const routeKey=(r:Route)=>[r.vrf??'',r.network,r.prefix,r.protocol,r.nextHop??'',r.interface].join('|');
const badVRF=(d:Device,vrf:string)=>vrf!=='default'&&!d.config.features.vrfs?.[vrf];

/** NX-OS-style views over local runtime state. No hardware counters or remote configuration peeks. */
export function nsosRouteTable(engine:Simulator,d:Device,family:4|6,vrf='default'):string[]{
  if(badVRF(d,vrf))return ['% VRF does not exist.'];
  const routes=engine.routes(d.id,vrf==='default'?undefined:vrf).filter(r=>(isIPv6(r.network)?6:4)===family);
  const groups=new Map<string,Route[]>();
  const order=(a:Route,b:Route)=>family===4?ipToInt(a.network)-ipToInt(b.network)||a.prefix-b.prefix:(ipv6ToBigInt(a.network)<ipv6ToBigInt(b.network)?-1:ipv6ToBigInt(a.network)>ipv6ToBigInt(b.network)?1:0)||a.prefix-b.prefix;
  for(const r of [...routes].sort(order)){const key=r.network+'/'+r.prefix;groups.set(key,[...(groups.get(key)??[]),r]);}
  const lines=[`${family===6?'IPv6 Routing':'IP Route'} Table for VRF "${vrf}"`,"'*' denotes best ucast next-hop","'**' denotes best mcast next-hop","'[x/y]' denotes [preference/metric]",...(family===4?["'%<string>' in via output denotes VRF <string>"]:[]),''];
  for(const [prefix,paths]of groups){
    const attached=paths.every(r=>['connected','local'].includes(r.protocol));
    lines.push(`${family===6&&prefix==='::/0'?'0::/0':prefix}, ubest/mbest: ${paths.length}/0${attached?', attached':''}`);
    for(const r of [...paths].sort((a,b)=>Number(b.protocol==='local')-Number(a.protocol==='local'))){
      const intf=d.config.interfaces[r.interface],local=r.protocol==='local',direct=r.protocol==='connected';
      const next=r.nextHop||(local?r.network:family===4?intf?.ip:intf?.ipv6.map(v=>v.split('/')[0]).find(v=>prefixContains(r.network,r.prefix,v)));
      const since=d.runtime.features.routeSince?.[routeKey(r)],age=typeof since==='number'?iosDuration(engine.clock.now()-since):undefined;
      const process=r.vrf?d.config.protocols.ospf?.vrfs?.[r.vrf]:d.config.protocols.ospf;
      const protocol=direct?'direct':local?'local':/^O(?:\s|$)/.test(r.protocol)?'ospf-'+(process?.nsosTag??process?.processId??1):r.protocol.toLowerCase();
      const type=/\bE2\b/.test(r.protocol)?'type-2':/\bE1\b/.test(r.protocol)?'type-1':r.protocol==='O IA'?'inter':r.protocol==='O'?'intra':undefined;
      lines.push('    *via '+[next??nsosPort(r.interface),...(next&&r.interface?[nsosPort(r.interface)]:[]),`[${r.ad}/${r.metric}]`,...(age?[age]:[]),protocol,...(type?[type]:[]),...(r.tag!==undefined?['tag '+r.tag]:[])].join(', '));
    }
  }
  return lines;
}

export function nsosIPBrief(engine:Simulator,d:Device,vrf='default'):string[]{
  if(badVRF(d,vrf))return ['% VRF does not exist.'];
  return ['',`IP Interface Status for VRF "${vrf}"${vrf==='default'?'(1)':''}`,'Interface            IP Address      Interface Status',
    ...Object.values(d.config.interfaces).filter(p=>p.ip&&!p.switchport&&(p.vrf||'default')===vrf).sort((a,b)=>{const rank=(p:InterfaceConfig)=>/^Vlan/.test(p.name)?0:/^Loopback/.test(p.name)?1:2;return rank(a)-rank(b)||a.name.localeCompare(b.name,undefined,{numeric:true});}).map(p=>{
      const up=engine.interfaceUp(d.id,p.name),state=`protocol-${up?'up':'down'}/link-${up?'up':'down'}/admin-${p.adminUp?'up':'down'}`;
      return nsosPort(p.name).padEnd(21)+p.ip!.padEnd(16)+state;
    })];
}

export function nsosClock(d:Device,now:number):string[]{
  // The Nexus display has no IOS '*' marker, but synchronization status remains explicit.
  const rows=iosClock(d,now,false,true);rows[0]=rows[0].replace(/^[*.]/,'');
  if(String(d.runtime.features.clockSource??(d.config.features.clockEpoch!==undefined?'manual':'unsynchronized')).startsWith('unsynchronized'))rows.splice(1,0,'Warning: Clock is not synchronized. Time may be out of sync.');
  return rows;
}
export function nsosLogging(d:Device):string[]{
  const f=d.config.features.logging??{},on=(value:boolean)=>value?'enabled':'disabled',severity=(n:number)=>severityNames[n]??String(n);
  // Facilities, linecards, logflash and rate limiting are deliberately absent: no such runtime exists.
  return ['',`Logging console:                ${on(f.enabled!==false&&f.console!==false)} (Severity: ${severity(f.consoleLevel??2)})`,
    `Logging monitor:                ${on(f.enabled!==false&&f.monitor!==false)} (Severity: ${severity(f.monitorLevel??5)})`,
    `Logging server:                 ${on(f.enabled!==false&&f.trapEnabled!==false&&!!f.hosts?.length)}`,
    `Logging logfile:                ${on(f.enabled!==false&&f.buffered!==false)}`,'',...d.runtime.logs];
}
export function nsosUsers(engine:Simulator,d:Device,identity:{username?:string;sessionId?:string;localConsole:boolean}):string[]{
  const rows=['NAME     LINE         TIME         IDLE          PID COMMENT'];
  if(identity.localConsole)rows.push(`${(identity.username??'-').padEnd(9)}${'console'.padEnd(13)}${'-'.padEnd(13)}${'.'.padEnd(10)}${'-'.padStart(5)} *`);
  for(const s of managementSessionSnapshot(engine,d.id).filter(s=>s.phase==='ready')){
    const current=s.id===identity.sessionId;
    rows.push(`${(s.username??'-').padEnd(9)}${('vty '+s.lineNumber).padEnd(13)}${'-'.padEnd(13)}${iosDuration(engine.clock.now()-s.lastActivity).padEnd(10)}${'-'.padStart(5)}${current?' *':''}`);
  }
  return rows;
}
export function nsosMAC(engine:Simulator,d:Device,now:number):string[]{
  refreshMacAging(d,now);
  const gateways=Object.values(d.config.interfaces).filter(p=>/^Vlan\d+$/.test(p.name)&&(p.ip||p.ipv6.length)&&engine.interfaceUp(d.id,p.name));
  return ['Legend: * - primary entry, G - Gateway MAC, (R) - Routed MAC','        age - seconds since last seen; - - static entry','   VLAN     MAC Address      Type      age     Ports','---------+-----------------+--------+---------+----------------',
    ...Object.values(d.runtime.mac).sort((a,b)=>a.vlan-b.vlan||a.mac.localeCompare(b.mac)).map(m=>`* ${String(m.vlan).padStart(4)}     ${dotted(m.mac).padEnd(17)}${(m.static?'static':'dynamic').padEnd(10)}${(m.static||m.lastSeen===undefined?'-':String(Math.max(0,Math.floor((now-m.lastSeen)/1000)))).padEnd(8)}${nsosPort(m.port)}`),...gateways.map(p=>`G ${p.name.slice(4).padStart(4)}     ${dotted(engine.macOf(d.id,p.name)).padEnd(17)}${'static'.padEnd(10)}${'-'.padEnd(8)}${p.name}(R)`)];
}
export function nsosDiscovery(engine:Simulator,d:Device,protocol:'CDP'|'LLDP',now:number):string[]{
  const peers=d.runtime.neighbors.filter(n=>n.protocol===protocol&&(n.expires===undefined||n.expires>now));
  const left=(n:Neighbor)=>Math.max(0,Math.ceil(((n.expires??now)-now)/1000));
  const addresses=(n:Neighbor):string[]=>n.addresses??(n.address?[n.address]:[]);
  if(protocol==='CDP')return [...peers.flatMap(n=>{
    const id=neighborIdentity(n),a=addresses(n);
    return ['----------------------------------------',`Device ID:${n.hostname??n.deviceId}`,'',`Interface address(es): ${a.length}`,
      ...a.map(v=>`    ${isIPv6(v)?'IPv6':'IPv4'} Address: ${v}`),`Platform: ${id.platform}, Capabilities: ${id.cdpWords}`,
      `Interface: ${n.interface}, Port ID (outgoing port): ${n.peerInterface??''}`,`Holdtime: ${left(n)} sec`,'','Version:',...id.version,'','Advertisement Version: 2','',...(n.nativeVlan!==undefined?[`Native VLAN: ${n.nativeVlan}`]:[]),...(n.duplex?[`Duplex: ${n.duplex}`]:[]),...(n.managementAddresses?.length?['Mgmt address(es):',...n.managementAddresses.map((v:string)=>`    ${isIPv6(v)?'IPv6':'IPv4'} Address: ${v}`)]:[]),`Local Interface MAC: ${engine.macOf(d.id,n.interface)}`,...(n.portMac?[`Remote Interface MAC: ${n.portMac}`]:[]),''];
  })];
  return ['Capability codes:','  (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device','  (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other','Device ID            Local Intf      Hold-time  Capability  Port ID',
    ...peers.flatMap(n=>{const id=neighborIdentity(n);return ['',`Chassis id: ${n.chassisMac?dotted(n.chassisMac):'not advertised'}`,`Port id: ${iosInterfaceName(n.peerInterface??'')}`,`Local Port id: ${nsosPort(n.interface)}`,`Port Description: ${n.description||n.peerInterface||''}`,`System Name: ${n.hostname??n.deviceId}`,'System Description: '+id.version.join(' '),`Time remaining: ${left(n)} seconds`,`System Capabilities: ${id.lldpCodes}`,`Enabled Capabilities: ${neighborIdentity({...n,capabilities:n.enabledCapabilities??n.capabilities}).lldpCodes}`,...(n.managementAddresses?.length?n.managementAddresses.map((v:string)=>`Management Address${isIPv6(v)?' IPV6':''}: ${v}`):['Management Address: not advertised']),'Vlan ID: not advertised','Max Frame Size: not advertised','Vlan Name TLV:','[Vlan ID: Vlan Name]  not advertised','Link Aggregation TLV:','Capability: not advertised','Status : not advertised','Link agg ID : 0',''];}),`Total entries displayed: ${peers.length}`];
}

/** Only measured counters are printed; there are no ASIC registers or reset statistics. */
export function nsosInterface(engine:Simulator,d:Device,p:InterfaceConfig):string[]{
 const now=engine.clock.now(),up=engine.interfaceUp(d.id,p.name),svi=/^Vlan/.test(p.name),channel=/^Port-channel/.test(p.name),c=d.runtime.counters[p.name],short=svi?60:30;
 if(/^Loopback/.test(p.name))return [`${p.name.toLowerCase()} is ${up?'up':'down'}`,`admin state is ${p.adminUp?'up':'down'},`,'  Hardware: Loopback',...(p.description?['  Description: '+p.description]:[]),...(p.ip?[`  Internet Address is ${p.ip}/${maskToPrefix(p.mask??'255.255.255.255')}`]:[]),...p.ipv6.map(a=>'  IPv6 address: '+a),`  MTU ${p.mtu} bytes, BW ${interfaceBandwidth(d,p)} Kbit , DLY ${(p.features.delay??500)*10} usec`,'  Encapsulation LOOPBACK, medium is broadcast',`    ${c?.rx??0} packets input ${c?.rxBytes??0} bytes`,`    ${c?.inputErrors??0} input errors`,`    ${c?.tx??0} packets output ${c?.txBytes??0} bytes`,`    ${c?.outputErrors??0} output errors`,''];
 const cleared=d.runtime.features.countersClearedAt?.[p.name],mac=dotted(engine.macOf(d.id,p.name));
 const windows=[short,300].flatMap((seconds,index)=>{
  const r=interfaceRates(d,p.name,now,seconds);
  return [`  Load-Interval #${index+1}: ${seconds===300?'5 minute (300 seconds)':seconds+' seconds'}`,`    ${seconds} seconds input rate ${r.inputBits} bits/sec, ${r.inputPackets} packets/sec`,`    ${seconds} seconds output rate ${r.outputBits} bits/sec, ${r.outputPackets} packets/sec`];
 });
 const vpcReason=vpcPortReason(d,p.name),peerDown=!!vpcReason&&/peer-link failed|orphan port suspended/.test(vpcReason);
 return [`${channel?p.name.toLowerCase():p.name} is ${up?'up':'down'}${svi?`${up?'':!p.adminUp?' (Administratively down)':peerDown?' (vPC peer-link down)':' (VLAN/BD is down)'}, line protocol is ${up?'up':'down'}, autostate enabled`:!up&&peerDown?' (vpc peerlink is down)':''}`,
  ...svi?[]:[`admin state is ${p.adminUp?'up':'down'}, Dedicated Interface`],
  `  Hardware${svi?' is EtherSVI':channel?': Port-Channel':': Ethernet'}, address${svi?' is':':'} ${mac}`,...(p.description?[`  Description: ${p.description}`]:[]),
  ...(p.ip?[`  Internet Address is ${p.ip}/${maskToPrefix(p.mask??'255.255.255.0')}`]:[]),...p.ipv6.map(a=>'  IPv6 address: '+a),
  `  MTU ${vpcInterfaceMTU(d,p)} bytes, BW ${interfaceBandwidth(d,p)} Kbit , DLY ${(p.features.delay??1)*10} usec`,
  ...svi?['  Encapsulation ARPA, loopback not set','  Keepalive not supported','  ARP type: ARPA']:['  Encapsulation ARPA, medium is broadcast',`  ${interfaceDuplex(d,p)}-duplex, ${interfaceSpeed(d,p)} Mb/s`],
  `  Last clearing of "show interface" counters ${cleared===undefined?'never':iosDuration(now-cleared)}`,...windows,
  '  RX',`    ${c?.rxUnicast??0} unicast packets  ${c?.rxMulticast??0} multicast packets  ${c?.rxBroadcast??0} broadcast packets`,`    ${c?.rx??0} input packets  ${c?.rxBytes??0} bytes`,
  `    ${c?.inputErrors??0} input error  ${c?.crc??0} CRC`,
  '  TX',`    ${c?.txUnicast??0} unicast packets  ${c?.txMulticast??0} multicast packets  ${c?.txBroadcast??0} broadcast packets`,`    ${c?.tx??0} output packets  ${c?.txBytes??0} bytes`,
  `    ${c?.outputErrors??0} output error  ${c?.collisions??0} collision  ${c?.lateCollisions??0} late collision`, `    ${c?.drops??0} total interface discards`];
}
