import type {Device, DeviceConfig, InterfaceConfig, StaticRoute} from './model.ts';
import {nsosACLConfig} from './nsos-acl.ts';
import {nsosConfig} from './datacenter.ts';
import {maskToPrefix} from './ip.ts';
import {NETSIM_VERSION} from './platform-identity.ts';

const compare = (a:string,b:string) => a.localeCompare(b,undefined,{numeric:true});
const route = (r:StaticRoute) => `${r.network.includes(':')?'ipv6':'ip'} route ${r.network}/${r.prefix}${r.interface?' '+r.interface:''}${r.nextHop?' '+r.nextHop:''}${r.ad&&r.ad!==1?' '+r.ad:''}`;
function portLines(p:InterfaceConfig,c:DeviceConfig):string[] {
  const lines=[`interface ${p.name}`],f=p.features;
  if(p.description)lines.push(' description '+p.description);
  if(p.switchport){
    lines.push(' switchport',' switchport mode '+p.mode);
    if(p.vlan!==1)lines.push(' switchport access vlan '+p.vlan);
    if(p.nativeVlan!==1)lines.push(' switchport trunk native vlan '+p.nativeVlan);
    if(p.allowedVlans!==null)lines.push(' switchport trunk allowed vlan '+(p.allowedVlans.join(',')||'none'));
  }else if(!/^(Vlan|Loopback|mgmt)/i.test(p.name))lines.push(' no switchport');
  if(p.vrf)lines.push(' vrf member '+p.vrf);
  if(p.mtu!==1500)lines.push(' mtu '+p.mtu);
  if(f.speedAuto===false)lines.push(' speed '+p.speed);
  if(p.ip)lines.push(` ip address ${p.ip}/${maskToPrefix(p.mask||'255.255.255.0')}`);
  for(const address of p.ipv6)lines.push(' ipv6 address '+address);
  if(f.aclOut)lines.push(' ip access-group '+f.aclOut+' out');
  if(f.channelGroup)lines.push(` channel-group ${f.channelGroup} mode ${f.channelMode||'on'}`);
  if(f.lacpRate)lines.push(' lacp rate '+(f.lacpRate==='slow'?'normal':f.lacpRate));
  if(f.lacpPortPriority!==undefined)lines.push(' lacp port-priority '+f.lacpPortPriority);
  if(f.stpPortType)lines.push(' spanning-tree port type '+f.stpPortType);
  for(const [key,cmd] of [['bpduguard','bpduguard'],['bpdufilter','bpdufilter']] as const)
    if(f[key]!==undefined)lines.push(` spanning-tree ${cmd} ${f[key]?'enable':'disable'}`);
  if(f.rootGuard)lines.push(' spanning-tree guard root');
  if(f.loopGuard)lines.push(' spanning-tree guard loop');
  if(f.stpCost!==undefined)lines.push(' spanning-tree cost '+f.stpCost);
  if(f.ospf?.area!==undefined){
    const root=c.protocols.ospf,process=p.vrf?root?.vrfs?.[p.vrf]:root;
    lines.push(` ip router ospf ${process?.nsosTag||'OSPF'} area ${f.ospf.area}`);
  }
  for(const [key,cmd] of [['cost','cost'],['priority','priority'],['helloInterval','hello-interval'],['deadInterval','dead-interval'],['networkType','network']] as const)
    if(f.ospf?.[key]!==undefined)lines.push(` ip ospf ${cmd} ${f.ospf[key]}`);
  if(f.vpcId!==undefined)lines.push(' vpc '+f.vpcId);
  if(nsosConfig({kind:'datacenter',config:c} as Device).vpc?.peerLink===p.name)lines.push(' vpc peer-link');
  if(f.vpcOrphanSuspend)lines.push(' vpc orphan-port suspend');
  lines.push(p.adminUp?' no shutdown':' shutdown',' exit');
  return lines;
}

/** NS-OS NVGEN is separate from IOS; every emitted command is accepted by NSOSSession. */
export function renderNSOSConfig(device:Device,c:DeviceConfig=device.config):string[] {
  const n=nsosConfig({...device,config:c}),lines=[`! NetSim NS-OS ${NETSIM_VERSION}`,`hostname ${c.hostname}`];
  for(const feature of [...n.enabled].sort(compare))if(feature!=='ssh')lines.push('feature '+feature);
  if(!n.enabled.includes('ssh'))lines.push('no feature ssh');
  if(c.ipv6Routing)lines.push('ipv6 unicast-routing');
  for(const community of Object.keys(c.features.snmp?.communities||{}).sort(compare))lines.push(`snmp-server community ${community} group network-operator`);
  for(const field of ['contact','location'])if(c.features.snmp?.[field])lines.push(`snmp-server ${field} ${c.features.snmp[field]}`);
  for(const [name,u] of Object.entries<any>(c.features.users||{}).sort(([a],[b])=>compare(a,b)))
    lines.push(`username ${name} password ${u.secret??u.password} role ${u.role||'network-operator'}`);
  if(c.features.vtp?.enabled){
    if(c.features.vtp.domain)lines.push('vtp domain '+c.features.vtp.domain);
    lines.push('vtp mode transparent','vtp version '+(c.features.vtp.version||1));
  }
  lines.push('spanning-tree mode '+(c.features.stp?.mode||'rapid-pvst'));
  const stp=c.features.stp||{},mst=stp.mst;
  if(stp.pathcostMethod&&stp.pathcostMethod!=='short')lines.push('spanning-tree pathcost method '+stp.pathcostMethod);
  for(const [v,priority] of Object.entries(stp.vlanPriorities||{}))lines.push(`spanning-tree vlan ${v} priority ${priority}`);
  if(mst){
    lines.push('spanning-tree mst configuration',' name '+(mst.name||'NSOS'),' revision '+(mst.revision||0));
    for(const instance of mst.instances||[])lines.push(` instance ${instance.id} vlan ${instance.vlans.join(',')}`);
    lines.push(' exit');
  }
  for(const v of Object.values(c.vlans).sort((a,b)=>a.id-b.id)){
    lines.push('vlan '+v.id,' name '+v.name);
    if(!v.active)lines.push(' shutdown');
    lines.push(' exit');
  }
  for(const name of Object.keys(c.features.vrfs||{}).sort(compare)){
    lines.push('vrf context '+name,' exit');
  }
  const v=n.vpc;
  if(v){
    lines.push(`vpc domain ${v.domain}`,` role priority ${v.rolePriority}`,` system-priority ${v.systemPriority}`);
    if(v.systemMac)lines.push(' system-mac '+v.systemMac);
    if(v.keepalive){
      const k=v.keepalive;
      lines.push(` peer-keepalive destination ${k.destination}${k.source?' source '+k.source:''} vrf ${k.vrf} interval ${k.interval} timeout ${k.timeout/1000} hold-timeout ${k.holdTimeout/1000}`);
    }
    for(const [key,cmd] of [['peerSwitch','peer-switch'],['peerGateway','peer-gateway'],['arpSynchronize','ip arp synchronize']] as const)if(v[key])lines.push(' '+cmd);
    if(v.autoRecovery)lines.push(' auto-recovery reload-delay '+v.reloadDelay/1000);
    lines.push(' delay restore '+v.delayRestore/1000,' delay restore interface-vlan '+v.delayRestoreSVI/1000);
    if(!v.gracefulConsistency)lines.push(' no graceful consistency-check');
    lines.push(' exit');
  }
  lines.push(...nsosACLConfig({config:c}));
  const ports=Object.values(c.interfaces).sort((a,b)=>{
    const rank=(p:InterfaceConfig)=>/^Port-channel/.test(p.name)?0:/^Vlan/.test(p.name)?2:1;
    return rank(a)-rank(b)||compare(a.name,b.name);
  });
  for(const p of ports)lines.push(...portLines(p,c));
  // Interface OSPF attachments create their named process as needed. Emit
  // explicit interface references only after every logical interface exists.
  const ospf=c.protocols.ospf;
  if(ospf){
    const rows:[string|undefined,any][]=[...(ospf.nsosTag?[[undefined,ospf] as [undefined,any]]:[]),...Object.entries<any>(ospf.vrfs||{})];
    const tags=[...new Set(rows.map(([,p])=>p.nsosTag))].sort(compare);
    for(const tag of tags){
      lines.push('router ospf '+tag);
      for(const [vrf,p] of rows.filter(([,p])=>p.nsosTag===tag)){
        if(vrf)lines.push(' vrf '+vrf);
        const indent=vrf?'  ':' ';
        if(p.routerId)lines.push(indent+'router-id '+p.routerId);
        if(p.referenceBandwidth!==undefined&&p.referenceBandwidth!==40000)lines.push(indent+'auto-cost reference-bandwidth '+p.referenceBandwidth+' Mbps');
        for(const name of p.passiveInterfaces||[])lines.push(indent+'passive-interface '+name);
        if(vrf)lines.push(' exit');
      }
      lines.push(' exit');
    }
  }
  for(const name of Object.keys(c.features.vrfs||{}).sort(compare)){
    const routes=c.staticRoutes.filter(r=>r.vrf===name);
    if(routes.length)lines.push('vrf context '+name,...routes.map(r=>' '+route(r)),' exit');
  }
  for(const r of c.staticRoutes.filter(r=>!r.vrf))lines.push(route(r));
  lines.push('end');
  return lines;
}
