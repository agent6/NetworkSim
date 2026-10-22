import type {Simulator} from './engine.ts';
import type {Device,Route,Neighbor} from './model.ts';
import {prefixContains,isIPv6,ipToInt,ipv6ToBigInt} from './ip.ts';
import {iosClock,severityNames} from './ios-system.ts';
import {iosDuration} from './ios-system-show.ts';
import {managementSessionSnapshot} from './management.ts';
import {neighborIdentity} from './ios-show.ts';
import {refreshMacAging} from './mac-aging.ts';

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
    for(const r of paths){
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
    ...Object.values(d.config.interfaces).filter(p=>p.ip&&!p.switchport&&(p.vrf||'default')===vrf).map(p=>{
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
  return ['',`Logging console:                ${on(f.enabled!==false&&f.console!==false)} (Severity: ${severity(f.consoleLevel??7)})`,
    `Logging monitor:                ${on(f.enabled!==false&&f.monitor!==false)} (Severity: ${severity(f.monitorLevel??7)})`,
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
export function nsosMAC(d:Device,now:number):string[]{
  refreshMacAging(d,now);
  return ['Legend: * - primary entry','        age - seconds since last seen; - - static entry','   VLAN     MAC Address      Type      age     Ports','---------+-----------------+--------+---------+----------------',
    ...Object.values(d.runtime.mac).sort((a,b)=>a.vlan-b.vlan||a.mac.localeCompare(b.mac)).map(m=>`* ${String(m.vlan).padStart(4)}     ${dotted(m.mac).padEnd(17)}${(m.static?'static':'dynamic').padEnd(10)}${(m.static||m.lastSeen===undefined?'-':String(Math.max(0,Math.floor((now-m.lastSeen)/1000)))).padEnd(8)}${nsosPort(m.port)}`)];
}
export function nsosDiscovery(d:Device,protocol:'CDP'|'LLDP',now:number):string[]{
  const peers=d.runtime.neighbors.filter(n=>n.protocol===protocol&&(n.expires===undefined||n.expires>now));
  const left=(n:Neighbor)=>Math.max(0,Math.ceil(((n.expires??now)-now)/1000));
  const addresses=(n:Neighbor):string[]=>n.addresses??(n.address?[n.address]:[]);
  if(protocol==='CDP')return [...peers.flatMap(n=>{
    const id=neighborIdentity(n),a=addresses(n);
    return ['----------------------------------------',`Device ID:${n.hostname??n.deviceId}`,`Interface address(es): ${a.length}`,
      ...a.map(v=>`    ${isIPv6(v)?'IPv6':'IPv4'} Address: ${v}`),`Platform: ${id.platform}, Capabilities: ${id.cdpWords}`,
      `Interface: ${nsosPort(n.interface)}, Port ID (outgoing port): ${n.peerInterface??''}`,`Holdtime: ${left(n)} sec(s)`,'','Version:',...id.version,'','Advertisement Version: 2',...(n.duplex?[`Duplex: ${n.duplex}`]:[]),''];
  }),`Total entries displayed: ${peers.length}`];
  return ['Capability codes:','  (R) Router, (B) Bridge, (T) Telephone, (S) Station, (O) Other','Device ID            Local Intf      Hold-time  Capability  Port ID',
    ...peers.flatMap(n=>{const id=neighborIdentity(n);return ['----------------------------------------',`Chassis id: ${n.chassisMac?dotted(n.chassisMac):'not advertised'}`,`Port id: ${n.peerInterface??''}`,`Local Port id: ${nsosPort(n.interface)}`,`Port Description: ${n.description||n.peerInterface||''}`,`System Name: ${n.hostname??n.deviceId}`,'System Description:',...id.version,`Time remaining: ${left(n)} seconds`,`System Capabilities: ${id.lldpCodes}`,`Enabled Capabilities: ${id.lldpCodes}`,...(addresses(n).length?addresses(n).map(v=>`Management Address: ${v}`):['Management Address: not advertised']),''];}),`Total entries displayed: ${peers.length}`];
}
