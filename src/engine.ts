import {spanDestination} from './span.ts';
import {stpPacketSummary} from './stp-packet.ts';
import {natLive,natStats,natStatics,natRuleKey,refreshNatEntry,recordNatFlow,natTranslated,updateNatPeak} from './nat-state.ts';
import {reconcilePortSecurity} from './port-security.ts';
import {recordInterfaceSample} from './interface-telemetry.ts';
import {stpPortState,stpMemberActive} from './stp-ports.ts';
import {installFTPServices,validateFTPConfiguration} from './ftp-files.ts';
import { validateSLAConfiguration } from './sla-config.ts';
import { SLAController } from './sla.ts';
import {iosBooting,iosBootStages,type IOSBootState,IOS_BOOT_DURATION} from './ios-boot.ts';
import {phoneIngress,validatePhone} from './phone.ts';
import {validateHostOS} from './host-os.ts';
import {IPv4LinkLocal, isIPv4LinkLocal} from './ipv4-link-local.ts';
import {endpointUsesPoE,endpointProfile,endpointNetworkPort,endpointEgressVlan,endpointIngressAllowed,endpointVoicePolicy,switchVoiceVlan,validateEndpoint} from './endpoint.ts';
import {learnMac,installStaticMac} from './mac-table.ts';
import {ownRecordValue,setRecordValue} from './record-map.ts';
import {recomputePoE,validatePoE,type PoEPower}from './poe.ts';
import {answerDNS,dnsName,type DNSRecordType} from './dns-service.ts';
import {automaticDHCPDNSRecords} from './dhcp-dns.ts';
import {installSNMPServices} from './snmp.ts';
import {installSSHFileService} from './ssh-files.ts';
import {ModelDrivenManagement} from './model-driven-management.ts';
import{validateWireless}from'./wireless-model.ts';
import{installAAAServices}from'./aaa-service.ts';
import {WirelessEngine} from './wireless.ts';
import {syncIPv6GeneralPrefixes} from './ipv6-general-prefix.ts';
import { captureDebugEvent } from './ios-debug.ts';
import { ntpAuthenticator } from './ntp-auth.ts';
import { bufferIOSMessage } from './ios-system.ts';
import { SimulationClock, type AdvanceResult, type TimerHandle } from './clock.ts';
import { emptyRuntime, defaultInterface, factoryDeviceConfig, type Device, type DeviceKind, type Endpoint, type InterfaceConfig, type Lab, type LabDocument, type Link, type NewSimEvent, type PacketSummary, type PingOptions, type PingResult, type ProbeReply, type Route, type SimEvent, type TraceResult } from './model.ts';
import { bigIntToIPv6, ipv6ToBigInt, broadcastAddress, inSubnet, intToIp, ipToInt, isIPv4, isIPv6, maskToPrefix, networkAddress, parseCidr, prefixContains, sameAddress } from './ip.ts';
import { multicastForwarding, prefixListPermits, receiveControlDatagram, receiveLinkControl, prepareLinkState, recomputeControlPlane, registerMulticast, resolveTunnelDestination, tunnelAccepts, virtualArpReply } from './control-plane.ts';
import { CryptoServices } from './crypto.ts';
import { receiveNhrp, sendNhrpRedirect, touchNhrp, type NhrpMessage, type NhrpRuntime } from './nhrp.ts';
import { tunnelNbma, tunnelMatches, tunnelSignature, validateTunnelConfiguration, type TunnelProtection } from './tunnel.ts';
import { IPv6Services, type LinkControl } from './ipv6-services.ts';
import { applyQos, classifyQosPolicy, inspectIngress, observeFrame, recordFlow, selectPolicyRoute, egressAclRequired, findDynamicNatBinding, findInboundNatTranslation, aclIcmpMatches } from './packet-policy.ts';
import { PersistentTCPChannels, type TCPChannel, type TCPChannelOptions } from './tcp-channel.ts';
import { handleHTTPRequest, type HTTPRequestOptions, type HTTPAuthenticator } from './http-service.ts';
import { observeMulticastFrame, snoopingEgress, syncSnooping } from './igmp-snooping.ts';
import { receiveRemoteSpan, receiveRemoteSpanFrame } from './remote-span.ts';
import { resolveForwardingPaths, pruneInactiveStaticRoutes, selectInstalledRoutes } from './route-resolver.ts';
import { negotiateEthernet, type EthernetState } from './ethernet.ts';
import { EgressScheduler, inheritQosClass } from './qos-scheduler.ts';
import {isDatacenter,nsosFeature,vpcRuntime,vpcPortReason,vpcPeerLink,vpcMemberId,vpcEgressAllowed,vpcForwardPort,vpcObserveMac,vpcObserveArp,vpcPeerGatewayMac,validateNSOSConfiguration} from './datacenter.ts';

export interface IPPacket {
  id: string; parentId?: string; source: string; destination: string; protocol: string; ttl: number; size: number; df: boolean;
  sourcePort?: number; destinationPort?: number; dscp?: number; ecn?: 0|1|2|3; pimTree?: 'rpt' | 'spt'; body: any; vrf?: string; fragment?: { id: string; offset: number; length: number; more: boolean; total: number };
  vpcIngress?:{deviceId:string;peerLink:boolean};
}
interface ArpMessage { kind: 'arp'; operation: 'request' | 'reply'; source: string; target: string; mac: string; targetMac?: string; family: 4 | 6 }
interface DHCPMessage { kind: 'dhcp'; operation: 'discover' | 'offer' | 'request' | 'ack' | 'nak' | 'decline' | 'release'; clientId: string; transaction: string; hostname?: string; serverId?: string; address?: string; prefix?: number; gateway?: string; dns?: string[]; lease?: number; domain?: string; bootfile?: string; nextServer?: string; options?: Record<string, any>; routers?: string[]; relay?: string; relayPort?: string; serverAddress?: string; unicast?: string; phase?: string; reason?: string; option82?: { circuitId: string; remoteId: string } }
export interface Frame { id: string; sourceMac: string; destinationMac: string; vlan?: number; cos?:number; payload: IPPacket | ArpMessage | DHCPMessage | LinkControl; hops: number; mirrored?: boolean; span?:import('./span.ts').SpanCopy; remoteSpan?: { sourceDevice: string; session: string; vlan: number }; vpcSource?:{domain:number;member:number;sender:string} }
interface Resolution { deviceId: string; port: string; target: string; packets: IPPacket[]; attempts: number; timer?: TimerHandle }
interface TunnelResolution extends Resolution { runtime:Device['runtime'];signature:string;nhrp?:NhrpRuntime;generation?:number }
interface ProbeWait { deviceId: string; timer: TimerHandle; sentAt: number; callback: (reply: ProbeReply) => void; expectedData?: string; udpTrace?: {target:string;port:number} }
interface Reassembly { parts: Map<number, number>; packet: IPPacket; timer: TimerHandle }
interface ResolvedRoute { route: Route; port: string; target: string }
export interface ServiceOptions { source?: string; vrf?: string; sourcePort?: number; timeout?:number }
export interface ServiceResult { id: string; status: 'running' | 'success' | 'failure'; error?: string; [key: string]: any }
const BROADCAST = 'ff:ff:ff:ff:ff:ff';
const clone = <T>(value: T): T => structuredClone(value);

/** Original packet-driven teaching engine. All traffic stays inside this object. */
export class Simulator {
  readonly modelDriven:ModelDrivenManagement;
  lab: Lab;
  events: SimEvent[] = [];
  clock: SimulationClock;
  seed: number;
  readonly wireless = new WirelessEngine(this);
  private sequence = 0n;
  private listeners = new Set<() => void>();
  private pendingArp = new Map<string, Resolution>();
  private pendingTunnels = new Map<string,TunnelResolution>();
  private probes = new Map<string, ProbeWait>();
  private fragments = new Map<string, Reassembly>();
  private wireAvailable = new Map<string, number>();
  private wireTransmissions = new Map<string, { start: number; finish: number; source: Device; runtime: Device['runtime']; port: string; peer: Device; peerPort: string; duplex: 'half' | 'full'; failed: boolean }[]>();
  private egressQueues = new EgressScheduler(this);
  private serviceWait = new Map<string, { deviceId: string; timer: TimerHandle; result: ServiceResult; callback?: (result: ServiceResult) => void }>();
  private dhcpWait = new Map<string, ServiceResult>();
  private cryptoServices = new CryptoServices(this);
  private ipv6Services = new IPv6Services(this);
  private ipv4LinkLocal = new IPv4LinkLocal(this, (d, port, source, target) => this.transmit(d, port, BROADCAST,
    {kind: 'arp', operation: 'request', source, target, mac: this.macOf(d.id, port), family: 4}));
  private tcpChannels = new PersistentTCPChannels(this);
  private sla: SLAController;
  private httpAuthenticator?: (deviceId: string, list: string, username: string, password: string) => ReturnType<HTTPAuthenticator>;
  private computing = false;
  private revision = 0;
  private nodeGenerations = new Map<string, number>();
  private udpServices = new Map<number, { accepts: (device: Device) => boolean; handler: (device: Device, payload: any, sourceAddress: string,destinationAddress:string) => Record<string, any>|undefined }>();
  private tcpServices = new Map<number, { accepts: (device: Device) => boolean; handler: (device: Device, payload: any, sourceAddress: string, destinationAddress: string) => Record<string, any> }>();

  constructor(seed = 20261016) {
    this.seed = seed >>> 0 || 1; this.clock = new SimulationClock(this.seed);
    this.lab = { id: 'lab-' + this.seed.toString(36), name: 'Untitled network', devices: [], links: [], notes: [] };
    installAAAServices(this);
    installSNMPServices(this);
    installSSHFileService(this);
    installFTPServices(this);
    this.modelDriven=new ModelDrivenManagement(this,(deviceId,list,user,password)=>this.httpAuthenticator?.(deviceId,list,user,password)??{accepted:false});
    this.sla=new SLAController(this);
    this.subscribe(()=>{if(this.sla.sync())this.recompute();});
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(): void { for (const listener of this.listeners) listener(); }
  emit(event: NewSimEvent): SimEvent {
    const item: SimEvent = { ...event, id: this.id('event'), time: this.clock.now() };
    this.events.push(item); if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    const device=this.getDevice(item.nodeId);if(device)captureDebugEvent(device,item);
    return item;
  }
  private id(kind: string): string { return kind + '-' + (++this.sequence).toString(36); }
  getDevice(id: string): Device | undefined { return this.lab.devices.find(d => d.id === id || d.config.hostname === id); }
  addDevice(kind: DeviceKind, x = 160, y = 160): Device {
    if (!['router', 'switch', 'poeswitch', 'l3switch', 'datacenter', 'pc', 'server', 'wlc', 'ap', 'laptop', 'phone'].includes(kind)) throw new Error('Unknown device kind');
    const stem = ({ router: 'R', switch: 'SW', poeswitch:'PSW', l3switch: 'DSW', datacenter:'DC', pc: 'PC', server: 'SRV', wlc:'WLC', ap:'AP', laptop:'LAP', phone:'PHONE' } as const)[kind];
    let n = 1; while (this.lab.devices.some(d => d.config.hostname === stem + n)) n++;
    const device: Device = { id: this.id('device'), kind, x, y, powered: kind!=='ap'&&kind!=='phone', config: factoryDeviceConfig(kind, stem + n), runtime: {...emptyRuntime(),features:{bootTime:this.clock.now()}} };
    this.lab.devices.push(device); this.changed(); if(kind==='pc')this.startAutomaticClients(device); return device;
  }
  removeDevice(id: string): void {
    const d = this.getDevice(id); if (!d) return;
    this.tcpChannels.closeDevice(d.id, 'Device removed');
    this.nodeGenerations.set(d.id, (this.nodeGenerations.get(d.id) ?? 0) + 1);
    this.clock.cancelOwner(d.id); this.lab.links = this.lab.links.filter(l => l.a.deviceId !== d.id && l.b.deviceId !== d.id);
    this.lab.devices = this.lab.devices.filter(x => x !== d); this.changed();
  }
  connect(a: Endpoint, b: Endpoint): Link {
    const da = this.getDevice(a.deviceId), db = this.getDevice(b.deviceId);
    if (!da || !db || !da.config.interfaces[a.port] || !db.config.interfaces[b.port]) throw new Error('Select two existing physical ports');
    if (da === db) throw new Error('A cable must join different devices');
    if ([a.port, b.port].some(p => /^(Vlan|Loopback|Tunnel|Port-channel|Null|Wireless)/i.test(p) || p.includes('.'))) throw new Error('Virtual interfaces cannot be cabled');
    a = { deviceId: da.id, port: a.port }; b = { deviceId: db.id, port: b.port };
    if (this.lab.links.some(l => [l.a, l.b].some(e => (e.deviceId === a.deviceId && e.port === a.port) || (e.deviceId === b.deviceId && e.port === b.port)))) throw new Error('One of those ports already has a cable');
    const link: Link = { id: this.id('link'), a: { ...a }, b: { ...b }, enabled: true, delay: 0.1, loss: 0 };
    this.lab.links.push(link);this.changed(); return link;
  }
  disconnect(linkId: string): void { this.lab.links = this.lab.links.filter(l => l.id !== linkId); this.changed(); }
  power(id: string, powered: boolean): void {
    const d = this.getDevice(id); if (!d || d.kind==='ap' || endpointUsesPoE(d) || d.powered === powered) return;
    this.nodeGenerations.set(d.id, (this.nodeGenerations.get(d.id) ?? 0) + 1);
    d.powered = powered; this.clock.cancelOwner(d.id); this.cryptoServices.clear(d.id); this.ipv6Services.clearDevice(d.id); this.tcpChannels.closeDevice(d.id);
    for (const [key, waiting] of this.pendingArp) if (waiting.deviceId === d.id) this.pendingArp.delete(key);
    for (const [key, pending] of this.serviceWait) if (pending.deviceId === d.id) this.finishService(key, undefined, 'Device power state changed');
    for(const[key,result]of this.dhcpWait)if(result.deviceId===d.id){result.status='failure';result.error='Device power state changed';this.dhcpWait.delete(key);}
    d.runtime = emptyRuntime();d.runtime.features.bootTime=this.clock.now();
    if (powered && d.configurationRegister) d.configurationRegister.current=d.configurationRegister.next;
    if (powered && d.startupConfig && !((d.configurationRegister?.current??0x2102)&0x40)) d.config = clone(d.startupConfig);
    else if (powered && ['router', 'switch', 'poeswitch', 'l3switch', 'datacenter', 'wlc'].includes(d.kind)) { const stem = d.kind === 'router' ? 'R' : d.kind === 'switch' ? 'SW' : d.kind === 'poeswitch' ? 'PSW' : d.kind === 'wlc' ? 'WLC' : isDatacenter(d)?'DC':'DSW'; d.config = factoryDeviceConfig(d.kind, stem + (this.lab.devices.filter(x => x.kind === d.kind).indexOf(d) + 1)); }
    if (powered) this.resetAutomaticAddresses(d);
    this.emit({ nodeId: d.id, protocol: 'SYSTEM', label: powered ? 'Powered on' : 'Powered off', detail: d.config.hostname, disposition: 'info' }); this.changed(); if (powered) this.startAutomaticClients(d);
  }
  changed(): void { this.recompute(); this.notify(); }
  /** Restart software independently of the AP's electrical PoE supply. */
  reload(id:string):void {
    const d=this.getDevice(id);if(!d||!this.devicePowered(d.id))return;
    if(d.kind!=='ap'&&!endpointUsesPoE(d)){this.power(d.id,false);this.power(d.id,true);return;}
    const supply=d.runtime.features.poePower as PoEPower;
    this.nodeGenerations.set(d.id,(this.nodeGenerations.get(d.id)??0)+1);
    this.clock.cancelOwner(d.id);this.cryptoServices.clear(d.id);this.ipv6Services.clearDevice(d.id);this.tcpChannels.closeDevice(d.id);
    for(const[key,row]of this.pendingArp)if(row.deviceId===d.id)this.pendingArp.delete(key);
    for(const[key,row]of this.serviceWait)if(row.deviceId===d.id)this.finishService(key,undefined,'PoE device restarted');
    for(const[key,result]of this.dhcpWait)if(result.deviceId===d.id){result.status='failure';result.error='PoE device restarted';this.dhcpWait.delete(key);}
    this.wireless.devicePowerChanged(d.id);
    const apProfile=d.config.features.wireless?.profile,endpoint=d.config.features.endpoint,hostOS=d.config.features.hostOS;d.config=clone(d.startupConfig??(d.kind==='ap'?factoryDeviceConfig('ap',d.config.hostname):d.config));if(d.kind==='pc'){if(endpoint)d.config.features.endpoint=clone(endpoint);if(hostOS)d.config.features.hostOS=hostOS;}if(d.kind==='ap'&&['generic-standalone','c9115-lightweight'].includes(apProfile))d.config.features.wireless.profile=apProfile;
    d.runtime=emptyRuntime();d.runtime.features.bootTime=this.clock.now();d.runtime.features.poePower=supply;d.powered=true;
    this.resetAutomaticAddresses(d);
    this.emit({nodeId:d.id,protocol:'SYSTEM',label:'PoE device restarted',detail:'Software restart; PoE supply remains available',disposition:'info'});
    this.changed();this.startAutomaticClients(d);
  }
  /** Interactive restart: the chassis stays powered while software is unavailable. */
  reloadIOS(id:string,reason='Reload Command'):void {
    const d=this.getDevice(id);if(!d||!this.devicePowered(d.id)||iosBooting(d)||!['router','switch','l3switch','poeswitch','datacenter','wlc','ap'].includes(d.kind))return;
    this.reload(d.id);
    const runtime=d.runtime,startedAt=this.clock.now(),software=isDatacenter(d)?'NS-OS':'IOS';
    const boot:IOSBootState={phase:'restarting',startedAt,readyAt:startedAt+IOS_BOOT_DURATION,reason:reason.replace(/[\r\n]+/g,' ').slice(0,256),lines:[]};
    boot.lines.push(`%SYS-5-RELOAD: Reload requested. Reload Reason: ${boot.reason}.`);
    runtime.features.iosBoot=boot;runtime.features.reloadReason=boot.reason;
    for(const stage of iosBootStages(d))this.clock.schedule(stage.after,()=>{
      if(this.getDevice(d.id)!==d||d.runtime!==runtime||!this.devicePowered(d.id)||runtime.features.iosBoot!==boot)return;
      boot.phase=stage.phase;boot.lines.push(...stage.lines);
      if(stage.phase==='ready')runtime.features.bootTime=this.clock.now();
      this.emit({nodeId:d.id,protocol:'SYSTEM',label:stage.phase==='ready'?software+' ready':software+' boot',detail:stage.lines.join('\n'),disposition:'info'});
      this.changed();
      if(stage.phase==='ready')this.startAutomaticClients(d);
    },{owner:d.id,label:software+' boot: '+stage.phase});
    this.changed();
  }
  recompute(): void {
    this.wireless.sync();
    if (this.computing) return;
    this.computing = true; this.revision++;
    try {
      recomputePoE(this);
      for(const d of this.lab.devices){
        syncIPv6GeneralPrefixes(d);
        // Legacy labs may retain transfer files, but Server nodes no longer
        // offer these listeners, including after a saved-config restart.
        if(d.kind==='server')for(const config of [d.config,d.startupConfig])if(config)for(const name of ['tftp','sshFiles'])if(config.services[name])config.services[name].enabled=false;
      }
      for (const d of this.lab.devices) d.runtime.features.ethernet = Object.fromEntries(Object.keys(d.config.interfaces).flatMap(port => { const value = this.ethernetState(d.id, port); return value ? [[port, value]] : []; }));
      prepareLinkState(this);
      const sviBefore=new Map(this.lab.devices.flatMap(d=>Object.keys(d.config.interfaces).filter(p=>/^Vlan\d+$/.test(p)).map(p=>[d.id+'|'+p,this.interfaceUp(d.id,p)] as const)));
      this.cryptoServices.synchronize();
      for(const wait of this.pendingTunnels.values())if(!this.tunnelResolutionValid(wait))this.finishTunnelResolution(wait,'NHRP resolution cancelled');
      this.egressQueues.sync();
      this.ipv6Services.syncStaticDAD();
      for (const d of this.lab.devices) {
        this.ipv4LinkLocal.sync(d);
        for (const [key, row] of Object.entries(d.runtime.arp)) if (row.static) delete d.runtime.arp[key];
        installStaticMac(d);
        reconcilePortSecurity(this,d);
        for (const row of d.config.features.staticArp ?? []) { const port = row.interface; if (d.config.interfaces[port]) d.runtime.arp[port + '|' + row.ip] = { ip: row.ip, mac: row.mac.toLowerCase(), port, vrf: row.vrf, expires: Number.MAX_SAFE_INTEGER, static: true }; }

        d.runtime.routes = [];
        d.runtime.features.linkLocalAddresses = {};
        for (const [port, cfg] of Object.entries(d.config.interfaces)) {
          if (!this.interfaceUp(d.id, port)) continue;
          if (cfg.ipv6.length || cfg.features.ipv6Enabled) d.runtime.features.linkLocalAddresses[port] = this.linkLocalAddress(d.id, port);
          for(const address of [...(cfg.ip&&cfg.mask?[{ip:cfg.ip,mask:cfg.mask}]:[]),...(cfg.features.secondaryIps??[])]){try{const prefix=maskToPrefix(address.mask);if(!isIPv4(address.ip))continue;d.runtime.routes.push({network:networkAddress(address.ip,prefix),prefix,interface:port,protocol:'connected',ad:0,metric:0,vrf:cfg.vrf});d.runtime.routes.push({network:address.ip,prefix:32,interface:port,protocol:'local',ad:0,metric:0,vrf:cfg.vrf});}catch{/* Invalid addresses do not create operational routes. */}}
          for (const address of this.operationalIPv6Addresses(d.id,port)) { try { const ip = parseCidr(address); const slaac=d.runtime.features.slaacLeases?.[port+'|'+ip.address];if(!slaac)d.runtime.routes.push({network:ip.network,prefix:ip.prefix,interface:port,protocol:'connected',ad:0,metric:0,vrf:cfg.vrf});d.runtime.routes.push({network:ip.address,prefix:128,interface:port,protocol:'local',ad:0,metric:0,vrf:cfg.vrf}); } catch { /* Same validation boundary as IPv4. */ } }
        }
        if (d.powered) for (const s of [...d.config.staticRoutes,...(d.runtime.features.windowsRoutes??[])]) d.runtime.routes.push({ ...s, interface: s.interface ?? '', protocol: 'static', ad: s.ad ?? 1, metric: s.metric ?? 0 });
        if(d.powered&&d.config.ipRouting)for(const [port,lease]of Object.entries<any>(d.runtime.features.dhcpClientLeases??{})){if(lease.gateway&&lease.expires>this.clock.now()&&d.config.interfaces[port]?.ip===lease.address&&this.interfaceUp(d.id,port))d.runtime.routes.push({network:'0.0.0.0',prefix:0,nextHop:lease.gateway,interface:port,protocol:'dhcp',ad:254,metric:0,vrf:d.config.interfaces[port].vrf});}
        if(d.powered&&!d.config.ipRouting)for(const row of Object.values<any>(d.runtime.features.icmpRedirects||{}))if(row.expires>this.clock.now()&&this.interfaceUp(d.id,row.interface))d.runtime.routes.push({...row});
        if (d.powered && d.config.defaultGateway && !d.config.ipRouting) d.runtime.routes.push({ network: '0.0.0.0', prefix: 0, nextHop: d.config.defaultGateway, interface: '', protocol: 'static', ad: 1, metric: 0, management:true });
      }
      let removedStatic:boolean;
      do {
        recomputeControlPlane(this);
        removedStatic=false;
        for(const d of this.lab.devices)removedStatic=pruneInactiveStaticRoutes(d,p=>this.interfaceUp(d.id,p))||removedStatic;
        if(removedStatic)for(const d of this.lab.devices)d.runtime.routes=d.runtime.routes.filter(r=>['static','connected','local','dhcp'].includes(r.protocol));
      } while(removedStatic);
      for(const device of this.lab.devices)selectInstalledRoutes(device);
      for(const device of this.lab.devices){const now=this.clock.now(),old=device.runtime.features.routeSince??{},next:Record<string,number>={};for(const r of device.runtime.routes){const key=[r.vrf??'',r.network,r.prefix,r.protocol,r.nextHop??'',r.interface].join('|');next[key]=old[key]??now;}device.runtime.features.routeSince=next;}
      this.ipv6Services.recompute();
      syncSnooping(this);
      for (const d of this.lab.devices) {
        const previous: Record<string, boolean> | undefined = d.runtime.features.interfaceStates, next: Record<string, boolean> = {};
        for (const port of Object.keys(d.config.interfaces)) { const up = next[port] = this.interfaceUp(d.id, port); if (previous && port in previous && previous[port] !== up) { this.log(d.id, '%LINK-3-UPDOWN: Interface ' + port + ', changed state to ' + (up ? 'up' : 'down'), 3); this.log(d.id, '%LINEPROTO-5-UPDOWN: Line protocol on Interface ' + port + ', changed state to ' + (up ? 'up' : 'down'), 5); } }
        if(Object.keys(next).some(port=>/^Vlan\d+$/.test(port)&&sviBefore.get(d.id+'|'+port)!==next[port])&&!d.runtime.features.sviRoutingRefresh){
          const runtime=d.runtime;runtime.features.sviRoutingRefresh=true;
          this.clock.schedule(0,()=>{if(d.runtime!==runtime)return;delete runtime.features.sviRoutingRefresh;this.recompute();this.notify();},{owner:d.id,label:'SVI autostate routing refresh'});
        }
        d.runtime.features.interfaceStates = next;
      }
      for (const device of this.lab.devices) if (device.runtime.features.ntpAssociations || device.config.features.ntp?.master!==undefined || device.runtime.features.ntp?.localMaster) this.selectNTP(device);
      for (const d of this.lab.devices) {
        const signature = d.powered && d.config.features.ntp?.servers?.length ? JSON.stringify(d.config.features.ntp) : undefined;
        if (d.runtime.features.ntpScheduled === signature) continue;
        d.runtime.features.ntpScheduled = signature; const generation = d.runtime.features.ntpPollGeneration = (d.runtime.features.ntpPollGeneration ?? 0) + 1;
        if (!signature) continue;
        const poll = () => { if (!d.powered || d.runtime.features.ntpPollGeneration !== generation || !d.config.features.ntp?.servers?.length) return; this.requestNTP(d.id,undefined,true); this.clock.schedule(Math.min(...d.config.features.ntp.servers.map((server:any)=>Math.max(1,d.config.features.ntp.pollInterval??2**(server.minpoll??6)))) * 1000, poll, { owner: d.id, label: 'NTP poll' }); };
        this.clock.schedule(1, poll, { owner: d.id, label: 'NTP initial poll' });
      }
    } finally { this.computing = false; }
  }
  devicePowered(id:string):boolean {const d=this.getDevice(id);return !!d&&(d.kind==='ap'||endpointUsesPoE(d)?d.runtime.features.poePower?.available===true:d.powered);}
  applyPoEPower(id:string,supply:PoEPower):void {
    const d=this.getDevice(id);if(!d)return;const old=d.runtime.features.poePower as PoEPower|undefined;
    d.powered=supply.available;
    if(old&&old.available!==supply.available){
      this.nodeGenerations.set(d.id,(this.nodeGenerations.get(d.id)??0)+1);this.clock.cancelOwner(d.id);this.cryptoServices.clear(d.id);this.ipv6Services.clearDevice(d.id);this.tcpChannels.closeDevice(d.id);
      for(const[key,row]of this.pendingArp)if(row.deviceId===d.id)this.pendingArp.delete(key);
      for(const[key,row]of this.serviceWait)if(row.deviceId===d.id)this.finishService(key,undefined,'PoE power supply changed');
      for(const[key,result]of this.dhcpWait)if(result.deviceId===d.id){result.status='failure';result.error='PoE power supply changed';this.dhcpWait.delete(key);}
      d.runtime=emptyRuntime();d.runtime.features.bootTime=this.clock.now();this.resetAutomaticAddresses(d);this.wireless.devicePowerChanged(d.id);
    }
    d.runtime.features.poePower=supply;
    if(!old||JSON.stringify(old)!==JSON.stringify(supply))this.emit({nodeId:d.id,peerId:supply.switchId,port:endpointNetworkPort(d),protocol:'PoE',label:supply.available?'Power available':'Power unavailable',detail:supply.reason,disposition:supply.available?'info':'warning'});
    if(old&&!old.available&&supply.available&&d.powered)this.startAutomaticClients(d);
  }
  interfaceUp(deviceId: string, port: string, seen = new Set<string>()): boolean {
    const d = this.getDevice(deviceId), cfg = d?.config.interfaces[port];
    if (!d || !this.devicePowered(d.id) || iosBooting(d) || !cfg?.adminUp || cfg.features.errDisabled) return false;
    const key = d.id + ':' + port; if (seen.has(key)) return false; seen.add(key);
    if(port==='Wireless0'&&d.kind==='laptop')return this.wireless.interfaceUp(d);
    if (/^Loopback/i.test(port)) return true;
    if (/^Null/i.test(port)) return true;
    if(isDatacenter(d)&&((/^Port-channel|^Vlan/.test(port)||cfg.features.vpcOrphanSuspend)&&vpcPortReason(d,port)||/^Vlan/.test(port)&&!nsosFeature(d,'interface-vlan')))return false;
    if (/^Tunnel/i.test(port)) {
      const source = cfg.features.tunnelSource;
      return (!!cfg.features.tunnelDestination || (cfg.features.tunnelMode === 'gre multipoint' && !!cfg.features.nhrp?.networkId)) && !!source && Object.entries(d.config.interfaces).some(([p, c]) => !/^Tunnel/i.test(p) && (p === source || c.ip === source) && this.interfaceUp(d.id, p, new Set(seen)));
    }
    if (/^Vlan\d+$/i.test(port)) { const vlan = Number(port.slice(4)); return !!d.config.vlans[vlan]?.active && Object.entries(d.config.interfaces).some(([p, c]) => c.switchport && !c.features.autostateExclude && this.carriesVlan(d, p, vlan) && (!stpPortState(d,p,vlan)||stpPortState(d,p,vlan)!.state==='forwarding') && this.interfaceUp(d.id, p, new Set(seen))); }
    if (/^Port-channel/i.test(port)) { const group = port.replace(/^Port-channel/i, ''); const members = d.runtime.features.portChannels?.[group]?.activeMembers ?? Object.entries(d.config.interfaces).filter(([, c]) => String(c.features.channelGroup) === group).map(([p]) => p); return members.some((p: string) => this.interfaceUp(d.id, p, new Set(seen))); }
    if (port.includes('.')) return this.interfaceUp(d.id, port.split('.')[0], seen);
    const link = this.linkAt(d.id, port); if (!link || !link.enabled) return false;
    const peer = link.a.deviceId === d.id && link.a.port === port ? link.b : link.a;
    const pd = this.getDevice(peer.deviceId), pc = pd?.config.interfaces[peer.port];
    return !!pd&&this.devicePowered(pd.id) && !iosBooting(pd) && !!pc?.adminUp && !pc.features.errDisabled && negotiateEthernet(cfg, pc,link.physical).carrier;
  }
  ethernetState(deviceId: string, port: string): EthernetState | undefined {
    const d = this.getDevice(deviceId), cfg = d?.config.interfaces[port], link = d && this.linkAt(d.id, port);
    if (!d || !cfg || !link || /^(?:Loopback|Vlan|Tunnel|Null|Port-channel|Wireless)/i.test(port) || port.includes('.')) return;
    const peer = link.a.deviceId === d.id && link.a.port === port ? link.b : link.a, pc = this.getDevice(peer.deviceId)?.config.interfaces[peer.port];
    return pc ? negotiateEthernet(cfg, pc,link.physical) : undefined;
  }
  routes(deviceId: string, vrf?: string): Route[] { const d = this.getDevice(deviceId); return d ? d.runtime.routes.filter(r => (r.vrf ?? '') === (vrf ?? '')) : []; }
  advance(ms: number, budget = 10000): AdvanceResult { const result = this.clock.advance(ms, budget); this.notify(); return result; }
  step(): AdvanceResult { const result = this.clock.step(); this.notify(); return result; }
  macOf(deviceId: string, port: string): string {
    const manual=this.getDevice(deviceId)?.config.interfaces[port]?.features.macAddress;if(manual)return manual;
    let hash = 2166136261; for (const c of deviceId + ':' + port) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    return '02:4e:' + [24, 16, 8, 0].map(s => ((hash >>> s) & 255).toString(16).padStart(2, '0')).join(':');
  }
  linkLocalAddress(deviceId: string, port: string): string {
    const manual = this.getDevice(deviceId)?.config.interfaces[port]?.features.ipv6LinkLocal;
    if (typeof manual === 'string' && isIPv6(manual) && prefixContains('fe80::', 10, manual)) return parseCidr(manual + '/128').address;
    const bytes = this.macOf(deviceId, port).split(':').map(x => parseInt(x, 16)); bytes[0] ^= 2;
    const eui = [...bytes.slice(0, 3), 255, 254, ...bytes.slice(3)].map(n => n.toString(16).padStart(2, '0')).join('');
    return bigIntToIPv6((0xfe80n << 112n) | BigInt('0x' + eui));
  }
  linkAt(deviceId: string, port: string): Link | undefined { return this.lab.links.find(l => (l.a.deviceId === deviceId && l.a.port === port) || (l.b.deviceId === deviceId && l.b.port === port)); }
  carriesVlan(d: Device, port: string, vlan: number): boolean {
    const c = d.config.interfaces[port]; if (!c || !c.switchport || !d.config.vlans[vlan]?.active || vpcPortReason(d,port,vlan)) return false;
    const trunk = this.trunk(d, port);
    return trunk ? !trunk.allowedVlans || trunk.allowedVlans.includes(vlan) : c.vlan === vlan || switchVoiceVlan(d,d.config.interfaces[port]) === vlan;
  }
  private trunk(d: Device, port: string): { nativeVlan: number; allowedVlans: number[] | null } | undefined {
    const c = d.config.interfaces[port]; const state = d.runtime.features.trunks?.[port];
    return state?.operational ? state : c?.mode === 'trunk' ? { nativeVlan: c.nativeVlan, allowedVlans: c.allowedVlans } : undefined;
  }
  private stpAllows(d: Device, port: string, vlan: number): boolean { const s = stpPortState(d,port,vlan); return !vpcPortReason(d,port,vlan)&&stpMemberActive(d,port)&&(!s || s.state === 'forwarding'); }
  private ensureAging(d: Device): void {
    if (d.runtime.features.agingScheduled) return; d.runtime.features.agingScheduled = true;
    this.clock.schedule(1000, () => { for (const [key, row] of Object.entries(d.runtime.arp)) if (!row.static && row.expires <= this.clock.now()) delete d.runtime.arp[key]; for (const [key, row] of Object.entries(d.runtime.mac)) if (!row.static && row.expires <= this.clock.now()) delete d.runtime.mac[key]; }, { owner: d.id, repeat: 1000, label: 'ARP and MAC aging' });
  }
  private count(d: Device, port: string, kind: 'tx' | 'rx' | 'drops', bytes = 0, destinationMac?: string): void {
    const c = d.runtime.counters[port] ??= { tx: 0, rx: 0, drops: 0, txBytes: 0, rxBytes: 0 }; c[kind]++; if (kind === 'tx') { c.txBytes += bytes; c.lastOutput = this.clock.now(); } if (kind === 'rx') { c.rxBytes += bytes; c.lastInput = this.clock.now(); }
    if(kind!=='drops')recordInterfaceSample(c,this.clock.now(),kind,bytes);
    if(kind!=='drops'&&destinationMac){const normalized=destinationMac.replace(/[^0-9a-f]/gi,'').toLowerCase(),category=normalized==='ffffffffffff'?'Broadcast':(parseInt(normalized.slice(0,2),16)&1)?'Multicast':'Unicast',field=`${kind}${category}` as 'txUnicast'|'txMulticast'|'txBroadcast'|'rxUnicast'|'rxMulticast'|'rxBroadcast';c[field]=(c[field]??0)+1;}
  }
  private packetSummary(p: IPPacket): PacketSummary {
    const b = p.body ?? {}, v6 = isIPv6(p.destination), ports = ['tcp', 'udp'].includes(p.protocol), result: PacketSummary = { id: p.id, vrf:p.vrf, parentId: p.parentId, source: p.source, destination: p.destination, protocol: p.protocol.toUpperCase(), ipVersion: v6 ? 6 : 4, ttl: p.ttl, size: p.size, df: p.df, dscp: p.dscp ?? 0, ecn:p.ecn??0, sourcePort: ports ? p.sourcePort : undefined, destinationPort: ports ? p.destinationPort : undefined, messageType: b.kind };
    const management=b.payload??b.result;
    if(management&&['snmp','snmp-notification','snmp-response'].includes(management.application)){
      const m=management,short=(v:any)=>typeof v==='string'?v.slice(0,512):v;
      result.snmp={application:m.application,version:m.version,operation:m.operation,username:m.username,securityLevel:m.securityLevel,kind:m.kind,notificationId:m.notificationId,...Array.isArray(m.oids)?{oids:m.oids.slice(0,64).map(short)}:{},...m.errorStatus?{errorStatus:m.errorStatus}:{},...Array.isArray(m.varbinds)?{varbinds:m.varbinds.slice(0,64).map((v:any)=>({oid:short(v.oid),type:short(v.type),...v.exception?{exception:short(v.exception)}:{value:short(v.value)}}))}:{}};
    }
    if(b.kind==='syslog-message')result.syslog={hostname:b.hostname,message:String(b.message).slice(0,1024),severity:b.severity,facility:b.facility,timestamp:b.timestamp};
    if(typeof b.probeId==='string')result.probeId=b.probeId;
    if(typeof b.transaction==='string')result.serviceTransaction=b.transaction;
    if(b.kind==='remote-span')result.erspan={id:b.sessionId,sequence:b.sequence,sourceDevice:b.sourceDevice,sourceFrame:b.frame?.span?.sourceFrame};
    if(b.kind==='esp')Object.assign(result,{espSpi:b.spi,espSequence:b.sequence,protectedProtocol:b.inner?.protocol?.toUpperCase()});
    if(b.kind==='ike')Object.assign(result,{ikeStage:b.stage,ikeExchangeId:b.id});
    if(b.kind==='netflow-export'){result.netflowVersion=b.version;result.netflow={monitor:b.monitor,record:b.record,version:b.version,sequence:b.sequence,records:clone(b.records.slice(0,20))};}
    if(b.kind==='control-plane'&&b.payload?.kind==='vrrp')Object.assign(result,{messageType:'vrrp-advertisement',fhrpGroup:b.payload.group,fhrpPriority:b.payload.priority,fhrpState:b.payload.state,fhrpVersion:b.payload.version,advertisementTime:b.payload.advertisementTime});
    if(b.kind==='control-plane'&&b.payload?.wireless)Object.assign(result,{messageType:'capwap-'+b.payload.type,innerFrameId:b.payload.frame?.id,vlan:b.payload.vlan,ssid:b.payload.wlan});
    if (p.fragment) Object.assign(result, { fragmentOffset: p.fragment.offset, moreFragments: p.fragment.more, fragmentId: p.fragment.id });
    if (p.protocol === 'tcp') {
      const flags: Record<string, string> = { 'tcp-syn': 'SYN', 'tcp-syn-ack': 'SYN ACK', 'tcp-ack': 'ACK', 'tcp-request': 'PSH ACK', 'tcp-request-segment':'PSH ACK','tcp-request-ack':'ACK', 'tcp-data': 'PSH ACK', 'tcp-data-ack': 'ACK', 'tcp-fin': 'FIN ACK', 'tcp-fin-ack': 'FIN ACK', 'tcp-rst': 'RST' }; result.tcpFlags = flags[b.kind];
      if (b.kind === 'tcp-data') Object.assign(result, { tcpSegmentIndex: b.index, tcpSegmentCount: b.total });
      if (b.kind === 'tcp-data-ack') result.tcpAckSegmentIndex = b.index;
      if (b.kind === 'tcp-channel') { const phaseFlags: Record<string, string> = { syn: 'SYN', 'syn-ack': 'SYN ACK', ack: 'ACK', data: 'PSH ACK', 'data-ack': 'ACK', fin: 'FIN ACK', 'fin-ack': 'FIN ACK', rst: 'RST' }; result.tcpFlags = phaseFlags[b.phase]; result.tcpChannelId = b.channelId; result.messageType = 'tcp-channel-' + b.phase; if (b.phase === 'data') Object.assign(result, { tcpMessageSequence: b.sequence, tcpSegmentIndex: b.segment, tcpSegmentCount: b.total }); if (b.phase === 'data-ack') Object.assign(result, { tcpMessageSequence: b.sequence, tcpAckSegmentIndex: b.segment }); }
    }
    if (['icmp', 'icmpv6'].includes(p.protocol)) {
      if(b.kind==='nd-ns'||b.kind==='nd-na')Object.assign(result,{icmpType:b.kind==='nd-ns'?135:136,icmpCode:0,ndTarget:b.target});
      if (b.kind === 'echo-request' || b.kind === 'echo-reply') Object.assign(result, { icmpType: b.kind === 'echo-request' ? v6 ? 128 : 8 : v6 ? 129 : 0, icmpCode: 0, icmpIdentifier: p.sourcePort, icmpSequence: b.sequence });
      if(b.kind==='icmp-redirect')Object.assign(result,{icmpType:5,icmpCode:1});
      if (b.kind === 'icmp-error') { const reason = String(b.error ?? ''); const type = /Time exceeded/i.test(reason) ? v6 ? 3 : 11 : /Packet too big/i.test(reason) && v6 ? 2 : v6 ? 1 : 3; const code = /Time exceeded|Packet too big/i.test(reason) ? 0 : /Fragmentation needed/i.test(reason) ? 4 : /Administratively prohibited/i.test(reason) ? v6 ? 1 : 13 : /Port unreachable/i.test(reason) ? v6 ? 4 : 3 : /host unreachable/i.test(reason) ? v6 ? 3 : 1 : 0; Object.assign(result, { icmpType: type, icmpCode: code, icmpError: reason,...b.original?{icmpQuoted:{source:b.original.source,destination:b.original.destination,protocol:b.original.protocol,sourcePort:b.original.sourcePort,destinationPort:b.original.destinationPort}}:{} }); }
    }
    if (b.kind === 'dhcp-relay' || b.kind === 'dhcp-unicast') Object.assign(result, { dhcpOperation: b.message?.operation, requestedAddress: b.message?.address, relayAddress: b.message?.relay });
    return result;
  }
  private summary(frame: Frame): PacketSummary {
    const p = frame.payload;
    const ethernet = {frameId:frame.id,mirrored:!!frame.mirrored,...frame.span?{span:clone(frame.span)}:{}, vlan: frame.vlan,cos:frame.cos, sourceMac: frame.sourceMac, destinationMac: frame.destinationMac };
    if ('kind' in p && p.kind === 'link-control') return { id: frame.id, source: p.body.source ?? '', destination: p.body.clientId ?? 'multicast', protocol: p.protocol, ...ethernet, messageType: p.body.type, ...(p.protocol === 'STP' && Array.isArray(p.body.vlans) ? {stpBpdus:stpPacketSummary(p.body)} : {}), ...(p.protocol === 'DHCPV6' ? { dhcpOperation: p.body.type, requestedAddress: p.body.address } : p.protocol === 'ICMPV6' && ['ra', 'rs'].includes(p.body.type) ? { icmpType: p.body.type === 'ra' ? 134 : 133, icmpCode: 0 } : {}) };
    if ('kind' in p) return { id: frame.id, source: p.kind === 'arp' ? p.source : p.clientId, destination: p.kind === 'arp' ? p.target : p.serverId ?? 'broadcast', protocol: p.kind === 'arp' ? (p.family === 6 ? 'NDP' : 'ARP') : 'DHCP', ...ethernet, ...(p.kind === 'arp' ? { arpOperation: p.operation, targetMac: p.targetMac, ...(p.family === 6 ? { icmpType: p.operation === 'request' ? 135 : 136, icmpCode: 0 } : {}) } : { dhcpOperation: p.operation, requestedAddress: p.address, relayAddress: p.relay }) };
    return { ...this.packetSummary(p), ...ethernet };
  }
  private event(d: Device, port: string | undefined, frame: Frame, label: string, detail: string, disposition: NewSimEvent['disposition'], peerId?: string): void { this.emit({ nodeId: d.id, peerId, port, protocol: this.summary(frame).protocol, label, detail, disposition, packet: this.summary(frame) }); }
  private sendWire(d: Device, port: string, frame: Frame, dequeued = false): void {
    if(!frame.mirrored&&spanDestination(d,port)){this.event(d,port,frame,'SPAN destination egress suppressed','The dedicated analyzer port transmits only mirrored frames.','drop');return;}
    if(d.kind==='laptop'&&port==='Wireless0'){if(!this.interfaceUp(d.id,port)||frame.hops<=0){this.count(d,port,'drops');this.event(d,port,frame,'Wireless link unavailable','The wireless interface has no authorized operational association.','drop');return;}this.count(d,port,'tx','size' in frame.payload?frame.payload.size+18:64,frame.destinationMac);observeFrame(this,d,port,'tx',frame);this.wireless.sendClientFrame(d,frame);return;}
    const c = d.config.interfaces[port], link = this.linkAt(d.id, port);
    if (!c || !link || !this.interfaceUp(d.id, port)) { this.event(d, port, frame, 'Link unavailable', 'The egress port has no operational peer.', 'drop'); return; }
    if (frame.hops <= 0) { this.event(d, port, frame, 'Layer 2 loop guard', 'The frame exceeded the simulator forwarding limit.', 'drop'); return; }
    if (!dequeued && c.switchport && !('kind' in frame.payload) && !applyQos(this, d, port, 'out', frame.payload, (name, packet) => this.aclAllows(d, name, packet))) { this.count(d, port, 'drops'); return; }
    if (!dequeued && this.egressQueues.enqueue(d, port, frame, () => { this.sendWire(d, port, frame, true); return this.wireAvailable.get(d.id + ':' + port) ?? this.clock.now(); }, this.wireAvailable.get(d.id + ':' + port) ?? this.clock.now(), packet => classifyQosPolicy(d, c.features.servicePolicyOut, packet, (name, candidate) => this.aclAllows(d, name, candidate)))) return;
    const peer = link.a.deviceId === d.id && link.a.port === port ? link.b : link.a;
    const pd = this.getDevice(peer.deviceId)!;
    const bytes = 'size' in frame.payload ? frame.payload.size + 18 : 64;
    const physical = negotiateEthernet(c, pd.config.interfaces[peer.port],link.physical), speed = Math.max(1, physical.speed);
    const key = d.id + ':' + port;
    const peerKey = pd.id + ':' + peer.port;
    const start = Math.max(this.clock.now(), this.wireAvailable.get(key) ?? 0, physical.duplex === 'half' && physical.peerDuplex === 'half' ? this.wireAvailable.get(peerKey) ?? 0 : 0), finish = start + Math.max(64, bytes) * 8 / (speed * 1000);
    this.wireAvailable.set(key, finish); this.count(d, port, 'tx', bytes, frame.destinationMac);
    const inFlight = (this.wireTransmissions.get(link.id) ?? []).filter(tx => tx.finish > this.clock.now() && tx.runtime === tx.source.runtime);
    const transmission = { start, finish, source: d, runtime: d.runtime, port, peer: pd, peerPort: peer.port, duplex: physical.duplex, failed: false };
    if (physical.mismatch) for (const other of inFlight) {
      if (other.source === d || Math.max(start, other.start) >= Math.min(finish, other.finish)) continue;
      const collisionAt = Math.max(start, other.start), half = physical.duplex === 'half' ? transmission : other;
      this.clock.schedule(collisionAt - this.clock.now(), () => {
        if (transmission.failed || other.failed || transmission.runtime !== d.runtime || other.runtime !== other.source.runtime || !this.interfaceUp(d.id,port) || !this.ethernetState(d.id,port)?.mismatch) return;
        transmission.failed = other.failed = true;
        const errors = half.source.runtime.counters[half.port]!;
        errors.collisions = (errors.collisions ?? 0) + 1; errors.outputErrors = (errors.outputErrors ?? 0) + 1;
        if (collisionAt - half.start > 512 / (speed * 1000)) errors.lateCollisions = (errors.lateCollisions ?? 0) + 1;
        const full = half.peer.runtime.counters[half.peerPort] ??= { tx: 0, rx: 0, drops: 0, txBytes: 0, rxBytes: 0 };
        full.inputErrors = (full.inputErrors ?? 0) + 1; full.crc = (full.crc ?? 0) + 1;
      }, { owner: d.id, label: 'Ethernet duplex collision' });
    }
    inFlight.push(transmission); this.wireTransmissions.set(link.id, inFlight);
    const copy = clone(frame); copy.hops--;
    observeFrame(this, d, port, 'tx', copy);
    this.event(d, port, copy, 'Frame sent', d.config.hostname + ' → ' + pd.config.hostname, 'send', pd.id);
    const revision = link.id;
    const senderGeneration = this.nodeGenerations.get(d.id) ?? 0;
    this.clock.schedule(finish - this.clock.now() + Math.max(0, link.delay)+(physical.propagation??0), () => {
      if (!this.lab.links.includes(link) || link.id !== revision || !this.interfaceUp(d.id, port) || senderGeneration !== (this.nodeGenerations.get(d.id) ?? 0)) { this.event(d, port, copy, 'Cable interrupted', 'The link or sender changed while the frame was in flight.', 'drop', pd.id); return; }
      const currentPhysical = this.ethernetState(d.id,port);
      if (!currentPhysical || currentPhysical.speed !== physical.speed || currentPhysical.duplex !== physical.duplex || currentPhysical.peerDuplex !== physical.peerDuplex) { this.count(d,port,'drops'); this.event(d,port,copy,'Ethernet reconfigured','Operational speed or duplex changed while the frame was in flight.','drop',pd.id); return; }
      if (transmission.failed) { this.count(d, port, 'drops'); this.event(d, port, copy, 'Ethernet duplex collision', 'Overlapping transmissions on a mismatched half/full duplex link corrupted the frame.', 'drop', pd.id); return; }
      const ber=currentPhysical.bitErrorRate??0;if(ber>0&&this.clock.random()<-Math.expm1(bytes*8*Math.log1p(-ber))){this.count(d,port,'drops');const counters=pd.runtime.counters[peer.port]??={tx:0,rx:0,drops:0,txBytes:0,rxBytes:0};counters.inputErrors=(counters.inputErrors??0)+1;counters.crc=(counters.crc??0)+1;this.event(pd,peer.port,copy,'Ethernet signal error','The configured physical signal model corrupted the frame FCS.','drop',d.id);return;}
      const directionalLoss = (link.a.deviceId === d.id && link.a.port === port ? link.lossAB : link.lossBA) ?? link.loss;
      if (directionalLoss > 0 && this.clock.random() < directionalLoss) { this.count(d, port, 'drops'); this.event(d, port, copy, 'Link loss', 'The link loss model discarded this frame.', 'drop', pd.id); return; }
      this.count(pd, peer.port, 'rx', bytes, copy.destinationMac); this.event(pd, peer.port, copy, 'Frame received', pd.config.hostname + ' received a frame on ' + peer.port, 'receive', d.id); this.receiveFrame(pd, peer.port, copy);
    }, { owner: pd.id, label: 'frame delivery' });
  }
  private logicalPorts(d: Device, physical: string, vlan?: number): string[] {
    const c = d.config.interfaces[physical]; if (!c) return [];
    if (c.switchport) return Object.keys(d.config.interfaces).filter(p => /^Vlan\d+$/i.test(p) && Number(p.slice(4)) === vlan && this.interfaceUp(d.id, p));
    const aggregate = c.features.channelGroup && 'Port-channel' + c.features.channelGroup;
    if (aggregate && d.config.interfaces[aggregate]) return vlan === undefined && this.interfaceUp(d.id, aggregate) ? [aggregate] : [];
    if((d.kind==='pc'||d.kind==='phone')&&endpointProfile(d).role==='phone')return endpointIngressAllowed(d,vlan,this.clock.now())?[physical]:[];
    const out: string[] = vlan === undefined ? [physical] : [];
    for (const [p, cfg] of Object.entries(d.config.interfaces)) if (p.startsWith(physical + '.') && this.interfaceUp(d.id, p) && ((cfg.features.dot1q === vlan) || (cfg.features.dot1qNative && vlan === undefined))) out.push(p);
    const group = c.features.channelGroup; if (group && d.config.interfaces['Port-channel' + group]) out.push('Port-channel' + group);
    return out;
  }
  private receiveFrame(d: Device, port: string, frame: Frame): void {
    const c = d.config.interfaces[port]; if (!c) return;
    if(!vpcPeerLink(d,port))delete frame.vpcSource;
    if (frame.mirrored) { const capture = d.runtime.features.capturedFrames ??= []; capture.push({ time: this.clock.now(), port, ...this.summary(frame) }); if (capture.length > 500) capture.shift(); return; }
    if(spanDestination(d,port)){this.event(d,port,frame,'SPAN destination ingress discarded','Incoming analyzer traffic is neither learned nor forwarded.','drop');return;}
    if ('kind' in frame.payload && frame.payload.kind === 'link-control' && ['UDLD', 'STP', 'CDP', 'LLDP', 'DTP', 'LACP', 'PAGP', 'VTP', 'VPC-CFS'].includes(frame.payload.protocol)) {observeFrame(this,d,port,'rx',frame);receiveLinkControl(this, d, port, frame.payload); return; }
    if(d.kind==='phone'){
      const action=phoneIngress(port,frame,endpointEgressVlan(d,this.clock.now()),this.macOf(d.id,'Network'));
      if(action.forward&&this.interfaceUp(d.id,action.forward)){
        this.event(d,action.forward,frame,'Phone PC passthrough','Forwarding untagged data without changing its VLAN, source MAC or IP TTL.','forward');
        this.sendWire(d,action.forward,clone(frame));
      }
      if(!action.local){
        observeFrame(this,d,port,'rx',frame);
        if(action.drop){this.count(d,port,'drops');this.event(d,port,frame,'Phone VLAN isolation',action.drop,'drop');}
        return;
      }
    }
    if(!c.switchport&&!endpointIngressAllowed(d,frame.vlan,this.clock.now())){this.count(d,port,'drops');this.event(d,port,frame,'Endpoint VLAN mismatch','The phone rejects traffic outside its received voice VLAN policy.','drop');return;}
    observeFrame(this, d, port, 'rx', frame);
    this.wireless.receiveEthernet(d,port,frame);
    let vlan = frame.vlan;
    if (c.switchport) {
      const trunk = this.trunk(d, port);
      if (!trunk && vlan === 0 && switchVoiceVlan(d,d.config.interfaces[port]) === 'dot1p') vlan = c.vlan;
      if (!trunk && vlan !== undefined && vlan !== c.vlan && vlan !== switchVoiceVlan(d,d.config.interfaces[port])) { this.event(d, port, frame, 'VLAN mismatch', 'An access port rejected a tagged frame from another VLAN.', 'drop'); return; }
      vlan = vlan ?? trunk?.nativeVlan ?? c.vlan;
      if (!this.carriesVlan(d, port, vlan)) { this.event(d, port, frame, 'VLAN filtered', 'This VLAN is not allowed on the ingress port.', 'drop'); return; }
      if (!this.stpAllows(d, port, vlan)) { this.event(d, port, frame, 'STP blocked', 'The spanning-tree state prevents forwarding in VLAN ' + vlan + '.', 'drop'); return; }
      if (!inspectIngress(this, d, port, vlan, frame)) { this.count(d, port, 'drops'); return; }
      // Catalyst port policies also govern bridged traffic. A physical input
      // policy takes precedence over VLAN marking, including on channel members.
      if (!('kind' in frame.payload)) {
        const policyPort = c.features.servicePolicyIn ? port : 'Vlan' + vlan;
        if (!applyQos(this, d, policyPort, 'in', frame.payload, (name, packet) => this.aclAllows(d, name, packet))) { this.count(d, port, 'drops'); return; }
      }
      if (frame.remoteSpan || (d.config.features.rspanVlans??[]).includes(vlan)) { if (frame.remoteSpan && (frame.remoteSpan.vlan !== vlan || !(d.config.features.rspanVlans ?? []).includes(vlan))) { this.event(d, port, frame, 'RSPAN VLAN rejected', 'Mirrored transit requires a VLAN configured for remote SPAN.', 'drop'); return; } receiveRemoteSpanFrame(this, d, port, vlan, frame); this.bridge(d, port, frame, vlan); return; }
      observeMulticastFrame(this, d, port, vlan, frame);
      const origin=frame.vpcSource,runtime=vpcRuntime(d),sourceMember=origin&&origin.domain===d.config.features.nsos?.vpc?.domain&&origin.sender===runtime?.peerId?runtime?.members[origin.member]:undefined;
      const group=c.features.channelGroup,channel=group&&d.runtime.features.portChannels?.[group],aggregate=channel?.state==='up'&&channel.activeMembers.includes(port)&&d.config.interfaces['Port-channel'+group]?.switchport?'Port-channel'+group:port;
      const learnPort=sourceMember?.up&&sourceMember.activeVlans.includes(vlan)?sourceMember.port:aggregate;
      const learned=learnMac(d,learnPort,vlan,frame.sourceMac,this.clock.now());vpcObserveMac(this,d,port,vlan,frame.sourceMac);if(learned==='full'&&(d.runtime.features.macCapacityLog??-Infinity)+1000<=this.clock.now()){d.runtime.features.macCapacityLog=this.clock.now();this.log(d.id,'%L2FM-4-MAC_TABLE_FULL: MAC learning capacity exhausted; unknown unicast continues to flood.',4);}this.ensureAging(d);
    }
    const logical = this.logicalPorts(d, port, vlan);
    const payload = frame.payload;
    if(!('kind'in payload)){if(isDatacenter(d))payload.vpcIngress={deviceId:d.id,peerLink:vpcPeerLink(d,port)};else delete payload.vpcIngress;}
    if ('kind' in payload && payload.kind === 'dhcp') this.receiveDHCP(d, port, vlan, frame, payload);
    if ('kind' in payload && payload.kind === 'link-control') for (const name of logical) this.ipv6Services.receive(d, name, payload);
    if ('kind' in payload && payload.kind === 'arp') for (const name of logical) this.receiveArp(d, name, payload, frame.id);
    let delivered = false;
    if (!('kind' in payload)) {
      for (const name of logical) {
        if (this.isMulticast(payload.destination) || (payload.body?.kind === 'control-plane' && (/^(224\.|ff)/i.test(payload.destination) || payload.destination === '255.255.255.255')) || frame.destinationMac === this.macOf(d.id, name) || vpcPeerGatewayMac(this,d,name,frame.destinationMac) || this.virtualAddresses(d).some(v => v.interface === name && v.mac === frame.destinationMac && (v.role === 'active'||isDatacenter(d)&&vpcRuntime(d)?.adjacency&&v.role==='standby'&&payload.destination!==v.ip))) { this.receiveIP(d, name, clone(payload), c.switchport); delivered = true; break; }
      }
    }
    if (c.switchport && (!delivered || (!('kind' in payload) && (this.isMulticast(payload.destination) || (payload.body?.kind === 'control-plane' && payload.destination === '255.255.255.255'))))) this.bridge(d, port, frame, vlan!);
  }
  sendWirelessEthernet(deviceId:string,port:string,frame:Frame):void{const d=this.getDevice(deviceId);if(d&&frame.hops>0)this.sendWire(d,port,frame);}
  receiveWirelessEthernet(deviceId:string,frame:Frame):void{const d=this.getDevice(deviceId);if(d?.powered&&this.interfaceUp(d.id,'Wireless0')){this.count(d,'Wireless0','rx','size' in frame.payload?frame.payload.size+18:64,frame.destinationMac);this.event(d,'Wireless0',frame,'Frame received',d.config.hostname+' received a frame on Wireless0','receive',this.wireless.association(d.id)?.apId);this.receiveFrame(d,'Wireless0',frame);}}
  mirrorFrame(deviceId: string, destination: string, frame: Frame,span?:import('./span.ts').SpanCopy): void { const d = this.getDevice(deviceId); if (d) this.sendWire(d, destination, { ...clone(frame), id: this.id('mirror'), hops:1, mirrored: true,...span?{span}:{} }); }
  sendRemoteSpanPacket(deviceId: string, source: string, destination: string, body: any, vrf?: string): boolean { const d = this.getDevice(deviceId); if (!d) return false; const p = this.makePacket(source, destination, 'gre', 44 + ('size' in body.frame.payload ? body.frame.payload.size : 64), { ...clone(body), kind: 'remote-span' }); p.vrf = vrf;if(p.body.frame.span?.erspan)p.body.frame.span.erspan.packetId=p.id;if(!this.localInterface(d,source,vrf)){this.packetEvent(d,p,'Invalid ERSPAN origin','The origin must be an operational local address in the selected routing table.','drop');return false;} this.originate(d, p);return true; }
  sendRemoteSpanVlan(deviceId: string, vlan: number, frame: Frame): void {
    const d = this.getDevice(deviceId); if (!d?.powered || !d.config.vlans[vlan] || !(d.config.features.rspanVlans ?? []).includes(vlan)) return; const groups = new Set<string>();
    for (const [port, cfg] of Object.entries(d.config.interfaces)) { if (!cfg.switchport || !this.interfaceUp(d.id, port) || !this.carriesVlan(d, port, vlan) || !this.stpAllows(d, port, vlan)) continue; if (spanDestination(d,port)) continue;
      if (cfg.features.channelGroup) { const group = String(cfg.features.channelGroup); if (groups.has(group) || this.channelMember(d, group, frame, vlan) !== port) continue; groups.add(group); } const outgoing = clone(frame), trunk = this.trunk(d, port); outgoing.id = this.id('rspan'); outgoing.vlan = trunk ? vlan : undefined; this.sendWire(d, port, outgoing);
    }
  }
  private channelMember(d: Device, group: string, frame: Frame, vlan?: number): string | undefined {
    const aggregate = d.runtime.features.portChannels?.[group]; if (!aggregate || aggregate.state !== 'up') return;
    const members: string[] = aggregate.activeMembers.filter((port: string) => this.interfaceUp(d.id, port) && (vlan === undefined || (this.carriesVlan(d, port, vlan) && this.stpAllows(d, port, vlan)))).slice().sort();
    if (!members.length) return;
    const mode = d.config.features.etherchannel?.loadBalance ?? 'src-dst-mac', packet = 'kind' in frame.payload ? undefined : frame.payload;
    const source = mode.endsWith('-ip') && packet ? packet.source : frame.sourceMac, destination = mode.endsWith('-ip') && packet ? packet.destination : frame.destinationMac;
    const key = mode.startsWith('src-dst-') ? source + '|' + destination : mode.startsWith('dst-') ? destination : source;
    return members[this.hash(key) % members.length];
  }
  private bridge(d: Device, input: string, frame: Frame, vlan: number): void {
    const rspan=(d.config.features.rspanVlans??[]).includes(vlan),multicastPorts = rspan?undefined:this.multicastPorts(d, vlan, frame);
    const entry = rspan?undefined:d.runtime.mac[vlan + '|' + frame.destinationMac];
    const learnedPort = entry && entry.expires > this.clock.now() ? vpcForwardPort(d,entry.port,vlan) : undefined;
    const inputGroup = d.config.interfaces[input].features.channelGroup, learnedGroup = learnedPort && (/^Port-channel/.test(learnedPort)?learnedPort.slice(12):d.config.interfaces[learnedPort]?.features.channelGroup);
    const groups = new Set<string>();
    for (const [port, cfg] of Object.entries(d.config.interfaces)) {
      if (port === input || /^Port-channel/.test(port) || !cfg.switchport || !this.interfaceUp(d.id, port) || !this.carriesVlan(d, port, vlan) || !this.stpAllows(d, port, vlan) || !vpcEgressAllowed(d,input,port,vlan)) continue;
      if (spanDestination(d,port)) continue;
      if (multicastPorts && !multicastPorts.has(port)) continue;
      const group = cfg.features.channelGroup;
      if (learnedPort && learnedPort !== port && (!group || String(group) !== String(learnedGroup))) continue;
      if (group) { if (String(inputGroup) === String(group) || groups.has(String(group)) || this.channelMember(d, String(group), frame, vlan) !== port) continue; groups.add(String(group)); }
      const copy = clone(frame); const trunk = this.trunk(d, port); copy.vlan = trunk && (vlan !== trunk.nativeVlan || !!frame.remoteSpan) || switchVoiceVlan(d,d.config.interfaces[port]) === vlan && vlan !== cfg.vlan ? vlan : switchVoiceVlan(d,d.config.interfaces[port]) === 'dot1p' && frame.vlan === 0 ? 0 : undefined;
      const sourceMember=vpcMemberId(d,input);
      if(vpcPeerLink(d,port)&&sourceMember)copy.vpcSource={domain:d.config.features.nsos.vpc.domain,member:sourceMember,sender:d.id};else delete copy.vpcSource;
      this.event(d, port, copy, learnedPort ? 'MAC forwarding' : 'Frame flooding', learnedPort ? 'The destination MAC is learned on this port.' : 'Broadcast or unknown destination in VLAN ' + vlan + '.', 'forward'); this.sendWire(d, port, copy);
    }
  }
  private transmit(d: Device, logical: string, destinationMac: string, payload: IPPacket | ArpMessage | DHCPMessage | LinkControl, sourceMac?: string): void {
    const c = d.config.interfaces[logical]; if (!c || !this.interfaceUp(d.id, logical)) return;
    const frame: Frame = { id: this.id('frame'), sourceMac: sourceMac ?? this.macOf(d.id, logical), destinationMac, payload, hops: 64 };
    if (/^Vlan\d+$/i.test(logical)) {
      const vlan = Number(logical.slice(4)), entry = d.runtime.mac[vlan + '|' + destinationMac], learnedPort = entry && entry.expires > this.clock.now() ? vpcForwardPort(d,entry.port,vlan) : undefined, learnedGroup = learnedPort && (/^Port-channel/.test(learnedPort)?learnedPort.slice(12):d.config.interfaces[learnedPort]?.features.channelGroup); const groups = new Set<string>();
      const multicastPorts = this.multicastPorts(d, vlan, frame);
      for (const [port, cfg] of Object.entries(d.config.interfaces)) {
        const input=!('kind'in payload)&&payload.vpcIngress?.deviceId===d.id&&payload.vpcIngress.peerLink?d.config.features.nsos?.vpc?.peerLink:undefined;
        if (/^Port-channel/.test(port)||!cfg.switchport || !this.interfaceUp(d.id, port) || !this.carriesVlan(d, port, vlan) || !this.stpAllows(d, port, vlan)||!vpcEgressAllowed(d,input,port,vlan)) continue;
        if (spanDestination(d,port)) continue;
        if (multicastPorts && !multicastPorts.has(port)) continue;
        if (learnedPort && learnedPort !== port && (!cfg.features.channelGroup || String(cfg.features.channelGroup) !== String(learnedGroup))) continue;
        if (cfg.features.channelGroup) { const group = String(cfg.features.channelGroup); if (groups.has(group) || this.channelMember(d, group, frame, vlan) !== port) continue; groups.add(group); }
        const copy = clone(frame), trunk = this.trunk(d, port); copy.vlan = trunk && (vlan !== trunk.nativeVlan || !!frame.remoteSpan) || switchVoiceVlan(d,d.config.interfaces[port]) === vlan && vlan !== cfg.vlan ? vlan : switchVoiceVlan(d,d.config.interfaces[port]) === 'dot1p' && frame.vlan === 0 ? 0 : undefined; this.sendWire(d, port, copy);
      }
    } else if (/^Port-channel/i.test(logical)) {
      const member = this.channelMember(d, logical.replace(/^Port-channel/i, ''), frame); if (member) this.sendWire(d, member, frame);
    } else if (logical.includes('.')) { frame.vlan = c.features.dot1qNative ? undefined : Number(c.features.dot1q); this.sendWire(d, logical.split('.')[0], frame); }
    else {if((d.kind==='pc'||d.kind==='phone')&&endpointProfile(d).role==='phone'&&logical===endpointNetworkPort(d)&&!(('kind' in payload)&&payload.kind==='link-control'&&(d.kind==='pc'||['CDP','LLDP','STP','DTP','LACP','PAGP','VTP','UDLD'].includes(payload.protocol)))){const policy=endpointVoicePolicy(d,this.clock.now());frame.vlan=endpointEgressVlan(d,this.clock.now());if(frame.vlan!==undefined)frame.cos=policy?.cos;if(policy?.dscp!==undefined&&!('kind' in payload))frame.payload={...payload,dscp:policy.dscp};}this.sendWire(d, logical, frame);}
  }
  private multicastPorts(d: Device, vlan: number, frame: Frame): Set<string> | undefined {
    if (frame.remoteSpan) return;
    const p = frame.payload; if ('kind' in p || p.body?.kind === 'control-plane' || !this.isMulticast(p.destination)) return;
    const ports = snoopingEgress(this, d, vlan, p.destination, p.source); if (!ports) return;
    const groups = new Set([...ports].map(port => d.config.interfaces[port]?.features.channelGroup).filter(Boolean).map(String));
    for (const [port, cfg] of Object.entries(d.config.interfaces)) if (groups.has(String(cfg.features.channelGroup))) ports.add(port); return ports;
  }
  sendSnoopingQuery(deviceId: string, vlan: number, source: string, payload: any): void {
    const d = this.getDevice(deviceId); if (!d?.powered) return; const p = this.makePacket(source, '224.0.0.1', 'igmp', 64 + JSON.stringify(payload).length, { kind: 'control-plane', payload }); p.ttl = 1; const groups = new Set<string>();
    for (const [port, cfg] of Object.entries(d.config.interfaces)) { if (!cfg.switchport || !this.interfaceUp(d.id, port) || !this.carriesVlan(d, port, vlan) || !this.stpAllows(d, port, vlan)) continue; const frame: Frame = { id: this.id('frame'), sourceMac: this.macOf(d.id, port), destinationMac: this.multicastMac(p.destination), payload: p, hops: 64 };
      if (cfg.features.channelGroup) { const group = String(cfg.features.channelGroup); if (groups.has(group) || this.channelMember(d, group, frame, vlan) !== port) continue; groups.add(group); } const trunk = this.trunk(d, port); frame.vlan = trunk && vlan !== trunk.nativeVlan ? vlan : undefined; this.sendWire(d, port, frame);
    }
  }
  requestIPv6(deviceId: string, port?: string): ServiceResult { return this.ipv6Services.requestIPv6(deviceId, port); }
  /** Restart an endpoint's automatic IPv6 state without removing manual addresses or routes. */
  restartIPv6Autoconfig(deviceId:string,port:string):ServiceResult {
    const d=this.getDevice(deviceId),c=d?.config.interfaces[port];
    if(!d||!['pc','server','laptop'].includes(d.kind)||!c||c.switchport||!this.interfaceUp(deviceId,port))return {id:'slaac-reset-error',status:'failure',error:'An operational endpoint interface is required.'};
    const owned=[...(c.features.slaacAddresses??[]),c.features.dhcpv6Lease?.address].filter(Boolean);
    c.ipv6=c.ipv6.filter(value=>!owned.some(address=>sameAddress(value.split('/')[0],address)));
    d.config.staticRoutes=d.config.staticRoutes.filter(r=>r.interface!==port||!(r as any).autoconfig&&!(r as any).autoconfigPrefix);
    for(const key of Object.keys(d.runtime.features.slaacLeases??{}))if(key.startsWith(port+'|'))delete d.runtime.features.slaacLeases[key];
    this.stopAutomaticAddressing(deviceId,port,'ipv6');return this.requestIPv6(deviceId,port);
  }
  requestDHCPv6(deviceId: string, port?: string, delegationName?: string): ServiceResult { return this.ipv6Services.requestDHCPv6(deviceId, port, delegationName); }
  releaseDHCPv6(deviceId:string,port:string):ServiceResult { return this.ipv6Services.releaseDHCPv6(deviceId,port); }
  stopAutomaticAddressing(deviceId: string, port: string, family: 'ipv4' | 'ipv6' | 'all' = 'all'): void {
    const d = this.getDevice(deviceId), c = d?.config.interfaces[port]; if (!d || !c) throw new Error('Unknown device or interface');
    if (family === 'ipv4' || family === 'all') {
      this.ipv4LinkLocal.clear(d, port);
      delete c.features.dhcp; delete c.features.dhcpLease; delete c.features.leaseExpires; delete d.runtime.features.dhcpClientLeases?.[port]; delete d.runtime.features.dhcpAddressChecks?.[port];
      for (const [id, result] of this.dhcpWait) if (result.deviceId === d.id && result.port === port) { result.status = 'failure'; result.error = 'Automatic IPv4 configuration stopped'; this.dhcpWait.delete(id); }
    }
    if (family === 'ipv6' || family === 'all') {
      this.ipv6Services.clearPort(d.id, port); const lease = c.features.dhcpv6Lease;
      if (lease?.delegationName && d.config.features.delegatedPrefixes?.[lease.delegationName]) delete d.config.features.delegatedPrefixes[lease.delegationName].expires;
      delete c.features.ipv6Autoconfig; delete c.features.dhcpv6Client; delete c.features._dhcpv6Autostart; delete c.features.dhcpv6Lease; delete c.features.slaacAddresses; delete d.runtime.features.dhcpv6Leases?.[port]; delete d.runtime.features.ipv6DefaultRouters?.[port]; delete d.runtime.features.deprecatedIPv6?.[port];
      for (const route of d.config.staticRoutes) if (route.interface === port && (route as any).autoconfig) delete (route as any).autoconfig;
    }
    this.changed();
  }
  sendLinkControl(deviceId: string, port: string, message: LinkControl): void { const d = this.getDevice(deviceId); if (d) { if (['UDLD', 'STP', 'CDP', 'LLDP', 'DTP', 'LACP', 'PAGP', 'VTP', 'VPC-CFS'].includes(message.protocol)) this.sendWire(d, port, { id: this.id('frame'), sourceMac: this.macOf(d.id, port), destinationMac: message.protocol === 'STP' ? '01:80:c2:00:00:00' : message.protocol === 'LLDP' ? '01:80:c2:00:00:0e' : message.protocol === 'LACP' ? '01:80:c2:00:00:02' : '01:00:0c:cc:cc:cc', payload: message, hops: 1 }); else this.transmit(d, port, '33:33:00:00:00:01', message); } }
  sendDAD(deviceId: string, port: string, address: string): void { const d = this.getDevice(deviceId); if (d) this.transmit(d, port, '33:33:ff:' + address.replace(/:/g, '').slice(-6).padStart(6, '0').match(/../g)!.join(':'), { kind: 'arp', operation: 'request', source: '::', target: address, mac: this.macOf(d.id, port), family: 6 }); }
  sendNeighborAnnouncement(deviceId: string, port: string, address: string): void { const d = this.getDevice(deviceId); if (d) this.transmit(d, port, '33:33:00:00:00:01', { kind: 'arp', operation: 'reply', source: address, target: address, mac: this.macOf(d.id, port), family: 6 }); }
  sendIPv6ServicePacket(deviceId: string, source: string, destination: string, body: any): void { const d = this.getDevice(deviceId); if (!d) return; const packet = this.makePacket(source, destination, 'udp', 128, body); packet.sourcePort = 547; packet.destinationPort = 547; this.originate(d, packet); }
  private isMulticast(address: string): boolean { return isIPv4(address) && (ipToInt(address) >>> 28) === 14; }
  private multicastMac(address: string): string { const value = ipToInt(address) & 0x7fffff; return '01:00:5e:' + [16, 8, 0].map(n => ((value >>> n) & 255).toString(16).padStart(2, '0')).join(':'); }
  sendMulticast(deviceId: string, group: string, options: { source?: string; interface?: string; ttl?: number; payload?: any } = {}): ServiceResult {
    const d = this.getDevice(deviceId); const port = d && (options.interface ?? Object.keys(d.config.interfaces).find(p => !!d.config.interfaces[p].ip && this.interfaceUp(d.id, p)));
    if (!d || !port || !this.isMulticast(group)) return { id: 'multicast-error', status: 'failure', error: 'An IPv4 multicast group and operational source interface are required' };
    const source = options.source ?? d.config.interfaces[port].ip; if (!source) return { id: 'multicast-error', status: 'failure', error: 'No IPv4 source address' };
    const packet = this.makePacket(source, group, 'udp', 28 + JSON.stringify(options.payload ?? {}).length, { kind: 'multicast-data', payload: options.payload }); packet.ttl = options.ttl ?? 16;
    this.forwardIP(d, { port, target: group, route: { network: group, prefix: 32, interface: port, protocol: 'multicast', ad: 0, metric: 0 } }, packet); return { id: packet.id, status: 'success', group, transmitted: true };
  }
  private receiveMulticast(d: Device, input: string, packet: IPPacket): void {
    const cfg = d.config.interfaces[input], groups = cfg?.features.igmpGroups ?? [];
    if (groups.some((g: any) => (typeof g === 'string' ? g : g.group) === packet.destination && (!g.source || g.source === packet.source))) { const received = d.runtime.features.multicastReceived ??= []; received.push({ time: this.clock.now(), interface: input, source: packet.source, group: packet.destination, payload: packet.body?.payload, ttl: packet.ttl }); if (received.length > 500) received.shift(); this.packetEvent(d, packet, 'Multicast delivered', 'This interface joined the multicast group.', 'success', input); }
    if (d.kind === 'pc' || d.kind === 'server') return;
    if (registerMulticast(this, d, input, packet)) return;
    const forwarding = multicastForwarding(this, d, input, packet.source, packet.destination, packet);
    if (!forwarding.accept) { this.packetEvent(d, packet, 'Multicast drop', forwarding.reason ?? 'No multicast forwarding state', 'drop', input); return; }
    if (packet.ttl <= 1) { this.packetEvent(d, packet, 'Multicast TTL expired', 'The multicast packet reached its hop limit.', 'drop', input); return; }
    for (const port of forwarding.outgoing) this.forwardIP(d, { port, target: packet.destination, route: { network: packet.destination, prefix: 32, interface: port, protocol: 'multicast', ad: 0, metric: 0 } }, { ...clone(packet), ttl: packet.ttl - 1 }, input);
  }
  receiveRegisteredMulticast(deviceId: string, packet: IPPacket): void { const d = this.getDevice(deviceId); if (d?.powered) this.receiveMulticast(d, 'register', packet); }
  sendControlDatagram(deviceId: string, source: string, destination: string, destinationPort: number, body: any, options: { interface?: string; vrf?: string; ttl?: number; protocol?: string; dscp?: number; sourceMac?:string } = {}): void {
    const d = this.getDevice(deviceId); if (!d?.powered) return;
    const packet = this.makePacket(source, destination, options.protocol ?? 'udp', 64 + JSON.stringify(body).length, { kind: 'control-plane', payload: body });
    if(options.dscp!==undefined)packet.dscp=options.dscp;
    if(body?.wireless&&body.frame?.id)packet.parentId=body.frame.id;
    if(packet.protocol!=='vrrp'){packet.sourcePort = destinationPort; packet.destinationPort = destinationPort;}packet.ttl = options.ttl ?? 64; packet.vrf = options.vrf;
    if (options.interface && this.interfaceUp(d.id, options.interface)) {
      if ((destination === '255.255.255.255' || this.isMulticast(destination) || /^ff/i.test(destination)) && !applyQos(this, d, options.interface, 'out', packet, (name, value) => this.aclAllows(d, name, value))) return;
      if (/^Tunnel/i.test(options.interface)) this.sendResolved(d, options.interface, destination, packet);
      else if (destination === '255.255.255.255') this.transmit(d, options.interface, BROADCAST, packet);
      else if (this.isMulticast(destination) || /^ff/i.test(destination)) this.transmit(d, options.interface, isIPv6(destination) ? '33:33:00:00:00:01' : this.multicastMac(destination), packet, options.sourceMac);
      else this.forwardIP(d, { port: options.interface, target: destination, route: { network: destination, prefix: isIPv6(destination) ? 128 : 32, interface: options.interface, protocol: 'control', ad: 0, metric: 0 } }, packet);
    } else this.originate(d, packet);
  }
  sendNhrpDatagram(deviceId:string,port:string,nbma:string,message:NhrpMessage):void {
    const d=this.getDevice(deviceId),c=d?.config.interfaces[port];if(!d||!c||!this.interfaceUp(d.id,port))return;
    const source=tunnelNbma(d,c);if(!source)return;
    const outer=this.makePacket(source,nbma,'gre',28+64+JSON.stringify(message).length,{kind:'gre',key:c.features.tunnelKey,nhrp:message});
    outer.vrf=c.features.tunnelVrf;this.sendGREOuter(d,port,outer);
  }
  sendBfdEcho(deviceId:string,port:string,source:string,peer:string,body:any):void {
    const d=this.getDevice(deviceId);if(!d?.powered||!this.interfaceUp(deviceId,port))return;
    const packet=this.makePacket(source,source,'udp',64,{kind:'control-plane',payload:body});packet.sourcePort=49152;packet.destinationPort=3785;packet.ttl=255;packet.vrf=d.config.interfaces[port]?.vrf;
    this.forwardIP(d,{port,target:peer,route:{network:peer,prefix:isIPv6(peer)?128:32,interface:port,protocol:'BFD echo',ad:0,metric:0}},packet);
  }
  /** A bounded lab instrument: real Ethernet frames, never a fabricated counter. */
  sendEthernetTestBurst(deviceId:string,port:string,kind:'broadcast'|'multicast'|'unicast'):ServiceResult {
    const result:ServiceResult={id:this.id('ethernet-test'),status:'running',framesSent:0,frames:256},d=this.getDevice(deviceId),c=d?.config.interfaces[port];
    if(!d||!['pc','server','laptop'].includes(d.kind)||!c||c.switchport||!this.linkAt(deviceId,port)||!isIPv4(c.ip??'')||!['broadcast','multicast','unicast'].includes(kind)||!this.interfaceUp(deviceId,port)){result.status='failure';result.error='An operational addressed endpoint Ethernet interface is required.';return result;}
    const bursts=d.runtime.features.ethernetTestBursts??={};if(bursts[port]?.status==='running'){result.status='failure';result.error='A traffic test is already running on this interface.';return result;}bursts[port]=result;
    const runtime=d.runtime,generation=this.nodeGenerations.get(d.id)??0,source=c.ip!;
    const destination=kind==='broadcast'?'255.255.255.255':kind==='multicast'?'239.1.1.1':'192.0.2.254',destinationMac=kind==='broadcast'?BROADCAST:kind==='multicast'?'01:00:5e:01:01:01':'02:fe:00:00:00:fe';
    for(let i=0;i<256;i++)this.clock.schedule(i*2,()=>{
      if(result.status!=='running')return;
      if(this.getDevice(deviceId)!==d||d.runtime!==runtime||d.config.interfaces[port]!==c||c.ip!==source||(this.nodeGenerations.get(d.id)??0)!==generation||!this.interfaceUp(deviceId,port)){result.status='failure';result.error='Source interface became unavailable; inspect storm-control and err-disable state.';return;}
      const packet=this.makePacket(source,destination,'udp',1500,{kind:'ethernet-test',testId:result.id,sequence:i+1,traffic:kind});packet.sourcePort=49000;packet.destinationPort=49001;
      this.transmit(d,port,destinationMac,packet);result.framesSent++;if(result.framesSent===256)result.status='success';
    },{label:'Ethernet traffic test'});
    return result;
  }
  sendGratuitousARP(deviceId: string, port: string, ip: string, mac?: string): void {
    const d = this.getDevice(deviceId); if (!d) return; mac ??= this.macOf(d.id, port);
    this.transmit(d, port, BROADCAST, { kind: 'arp', operation: 'reply', source: ip, target: ip, mac, family: 4 }, mac);
  }
  private hash(value: string): number { let n = 0; for (const c of value) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0; return n; }
  private virtualAddresses(d: Device): any[] { return d.runtime.features.virtualIps ?? []; }
  private localInterface(d: Device, address: string, vrf?: string): string | undefined {
    for (const [port, c] of Object.entries(d.config.interfaces)) if ((c.vrf ?? '') === (vrf ?? '') && this.interfaceUp(d.id, port) && (c.ip === address || (c.features.secondaryIps??[]).some((entry:any)=>entry.ip===address) || this.operationalIPv6Addresses(d.id,port).some(v => sameAddress(v.split('/')[0], address)) || ((c.ipv6.length || c.features.ipv6Enabled) && this.ipv6AddressUsable(d.id,port,this.linkLocalAddress(d.id,port)) && sameAddress(this.linkLocalAddress(d.id, port), address)))) return port;
    return this.virtualAddresses(d).find(v => v.role === 'active' && sameAddress(v.ip, address) && this.interfaceUp(d.id, v.interface))?.interface;
  }
  ipv6AddressUsable(deviceId:string,port:string,address:string):boolean {const d=this.getDevice(deviceId);if(!d)return false;const rows=d.runtime.features.staticIPv6Dad?.[port],row=rows?.[bigIntToIPv6(ipv6ToBigInt(address))];return !row||row.state==='preferred';}
  operationalIPv6Addresses(deviceId:string,port:string):string[]{const c=this.getDevice(deviceId)?.config.interfaces[port];return(c?.ipv6??[]).filter(value=>this.ipv6AddressUsable(deviceId,port,value.split('/')[0]));}
  preferredIPv6Address(deviceId: string, port: string): string | undefined { const d = this.getDevice(deviceId), c = d?.config.interfaces[port]; if (!d || !c) return; const deprecated: string[] = d.runtime.features.deprecatedIPv6?.[port] ?? [],addresses=this.operationalIPv6Addresses(deviceId,port);return (addresses.find(value => !deprecated.some(address => sameAddress(address, value.split('/')[0]))) ?? addresses[0])?.split('/')[0] ?? (c.features.ipv6Enabled&&this.ipv6AddressUsable(deviceId,port,this.linkLocalAddress(deviceId,port)) ? this.linkLocalAddress(d.id, port) : undefined); }

  private addressFor(d: Device, port: string, family: 4 | 6, destination?:string): string | undefined { const c=d.config.interfaces[port];if(family===6)return this.preferredIPv6Address(d.id,port);if(!c)return;const addresses=[...(c.ip&&c.mask?[{ip:c.ip,mask:c.mask}]:[]),...(c.features.secondaryIps??[])];return (destination?addresses.find(a=>inSubnet(destination,a.ip,a.mask))?.ip:undefined)??c.ip??addresses[0]?.ip; }
  private resolveRoute(d: Device, target: string, vrf?: string, seen = new Set<string>(), flow?: { source?: string; sourcePort?: number; destinationPort?: number; protocol?: string }): ResolvedRoute | undefined {
    const paths = resolveForwardingPaths(d, target, vrf, port => this.interfaceUp(d.id, port));
    if (!paths.length) return;
    const cfg = d.config.features.cefHash ?? {}, algorithm = cfg.algorithm ?? 'universal';
    const source = flow?.source || this.addressFor(d, paths[0].port, isIPv6(target) ? 6 : 4) || '';
    const routerId = d.config.protocols.ospf?.routerId ?? d.config.protocols.bgp?.routerId ?? Object.values(d.config.interfaces).map(c => c.ip).filter((address): address is string => !!address).sort((a, b) => ipToInt(b) - ipToInt(a))[0] ?? d.id;
    const seed = cfg.seed ?? this.hash(routerId); let key = source + '|' + target;
    if (algorithm === 'universal') key += '|universal|' + seed;
    else if (algorithm === 'tunnel') key = target + '|tunnel|' + source + '|' + seed;
    else if (algorithm === 'include-ports') key += '|' + (flow?.protocol ?? '') + (cfg.sourcePort ? '|s:' + (flow?.sourcePort ?? 0) : '') + (cfg.destinationPort ? '|d:' + (flow?.destinationPort ?? 0) : '') + '|' + seed;
    const total = paths.reduce((sum, path) => sum + path.weight, 0); let position = this.hash(key) / 0x100000000 * total;
    // Avalanche the simple string hash so neighboring host addresses distribute over weighted paths.
    let hash = this.hash(key); hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d); hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b); position = ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000 * total;
    for (const path of paths) { position -= path.weight; if (position < 0) return { route: path.route, port: path.port, target: path.target }; }
    const path = paths[paths.length - 1]; return { route: path.route, port: path.port, target: path.target };
  }

  private packetEvent(d: Device, packet: IPPacket, label: string, detail: string, disposition: NewSimEvent['disposition'], port?: string): void { this.emit({ nodeId: d.id, port, protocol: packet.protocol.toUpperCase(), label, detail, disposition, packet: this.packetSummary(packet) }); }
  private originate(d: Device, packet: IPPacket, scopedInterface?: string): void {
    if (!d.powered) { this.failLocal(d.id, packet, 'Device is powered off'); return; }
    if(isIPv6(packet.source)){const rows=Object.entries<any>(d.runtime.features.staticIPv6Dad??{}).filter(([port])=>!scopedInterface||port===scopedInterface).map(([,entries])=>entries[bigIntToIPv6(ipv6ToBigInt(packet.source))]).filter(Boolean);if(rows.length&&rows.every(row=>row.state!=='preferred')){this.failLocal(d.id,packet,'IPv6 source address is tentative or duplicate');return;}}
    if (this.localInterface(d, packet.destination, packet.vrf)) { packet.source ||= packet.destination; this.clock.schedule(0, () => this.deliverIP(d, packet), { owner: d.id, label: 'local delivery' }); return; }
    if (isIPv4LinkLocal(packet.destination)) {
      const candidates = Object.entries(d.config.interfaces).filter(([port, c]) => this.interfaceUp(d.id, port) && c.ip && (c.vrf ?? '') === (packet.vrf ?? '') && (scopedInterface ? port === scopedInterface : !packet.source || packet.source === c.ip));
      if (candidates.length === 1) {
        const [port, c] = candidates[0]; packet.source ||= c.ip!;
        this.forwardIP(d, {port, target: packet.destination, route: {network: '169.254.0.0', prefix: 16, interface: port, protocol: 'connected', ad: 0, metric: 0}}, packet); return;
      }
    }
    if (isIPv6(packet.destination) && prefixContains('fe80::', 10, packet.destination)) {
      const candidates = Object.entries(d.config.interfaces).filter(([port, c]) => this.interfaceUp(d.id, port) && (c.ipv6.length || c.features.ipv6Enabled) && (c.vrf ?? '') === (packet.vrf ?? '') && (scopedInterface ? port === scopedInterface : !packet.source || sameAddress(packet.source, this.linkLocalAddress(d.id, port)) || c.ipv6.some(address => sameAddress(address.split('/')[0], packet.source))));
      if (candidates.length !== 1) { this.failLocal(d.id, packet, 'Link-local destination requires one unambiguous IPv6 source interface'); return; }
      const port = candidates[0][0]; packet.source ||= this.linkLocalAddress(d.id, port); this.forwardIP(d, { port, target: packet.destination, route: { network: 'fe80::', prefix: 10, interface: port, protocol: 'connected', ad: 0, metric: 0, vrf: packet.vrf } }, packet); return;
    }
    const normalRoute=this.resolveRoute(d,packet.destination,packet.vrf,new Set(),packet);if(normalRoute&&!packet.source)packet.source=this.addressFor(d,normalRoute.port,isIPv6(packet.destination)?6:4,packet.destination)??'';
    const route = this.policyRoute(d,'local',packet)??normalRoute;
    if (!route) { this.packetEvent(d, packet, 'No route', 'No usable route to ' + packet.destination, 'drop'); this.failLocal(d.id, packet, 'Destination network unreachable'); return; }
    packet.source ||= this.addressFor(d, route.port, isIPv6(packet.destination) ? 6 : 4,packet.destination) ?? '';
    if (!packet.source) { this.failLocal(d.id, packet, 'No source IP address on the outgoing interface'); return; }
    this.forwardIP(d, route, packet);
  }
  private receiveIP(d: Device, input: string, packet: IPPacket, ingressQosHandled = false, tunnelPeer?:string): void {
    const c = d.config.interfaces[input]; packet.vrf = c.vrf;
    if (!ingressQosHandled && !applyQos(this, d, input, 'in', packet, (name, p) => this.aclAllows(d, name, p))) return;
    if (!this.aclAllows(d, isIPv6(packet.destination) ? c.features.ipv6AclIn : c.features.aclIn, packet,{port:input,direction:'in'})) { this.packetEvent(d, packet, 'Ingress ACL denied', 'Access list ' + (isIPv6(packet.destination)?c.features.ipv6AclIn:c.features.aclIn), 'drop', input); this.icmpError(d, packet, 'Administratively prohibited', input); return; }
    if(c.features.urpf&&isIPv4(packet.source)&&packet.source!=='0.0.0.0'){
      const policy=c.features.urpf,paths=resolveForwardingPaths(d,packet.source,c.vrf,port=>this.interfaceUp(d.id,port)),pass=paths.some(path=>!/^Null/i.test(path.port)&&(path.route.prefix>0||policy.allowDefault)&&(policy.mode==='any'||path.port===input));
      if(!pass&&!(policy.acl&&this.aclAllows(d,policy.acl,packet))){const counters=d.runtime.features.urpfDrops??={};counters[input]=(counters[input]??0)+1;this.packetEvent(d,packet,'uRPF verification failed','Source address has no permitted reverse forwarding path.','drop',input);return;}
    }
    packet = this.translateInbound(d, input, packet);
    const linkLocalDestination = isIPv6(packet.destination) && prefixContains('fe80::', 10, packet.destination);
    const localDestination = linkLocalDestination ? (c.ipv6.length || c.features.ipv6Enabled) && this.ipv6AddressUsable(d.id,input,this.linkLocalAddress(d.id,input)) && sameAddress(this.linkLocalAddress(d.id, input), packet.destination) : this.localInterface(d, packet.destination, packet.vrf);
    if (localDestination || (packet.body?.kind === 'control-plane' && (this.isMulticast(packet.destination) || /^ff/i.test(packet.destination) || packet.destination === '255.255.255.255'))) {
      if (!applyQos(this, d, 'control-plane', 'in', packet, (name, p) => this.aclAllows(d, name, p))) return;
      if(isDatacenter(d)&&typeof localDestination==='string'&&/^Loopback/.test(localDestination)&&localDestination!==input)this.count(d,localDestination,'rx',packet.size,this.macOf(d.id,localDestination));
      this.deliverIP(d, packet, input);return;
    }
    if (isIPv4LinkLocal(packet.source) || isIPv4LinkLocal(packet.destination)) { this.packetEvent(d, packet, 'IPv4 link-local scope', 'Link-local traffic cannot be routed to another interface.', 'drop', input); return; }
    if (linkLocalDestination || (isIPv6(packet.source) && prefixContains('fe80::', 10, packet.source))) { this.packetEvent(d, packet, 'IPv6 link-local scope', 'Link-local traffic cannot be routed to another interface.', 'drop', input); return; }
    if(isDatacenter(d)&&input==='mgmt0'){this.packetEvent(d,packet,'Management-plane isolation','mgmt0 does not forward transit traffic.','drop',input);return;}
    if (this.isMulticast(packet.destination)) { this.receiveMulticast(d, input, packet); return; }
    const ipv6 = isIPv6(packet.destination);
    if ((ipv6 ? !d.config.ipv6Routing : !d.config.ipRouting) || d.kind === 'pc' || d.kind === 'server') { this.packetEvent(d, packet, 'Routing disabled', 'This device does not forward this address family.', 'drop', input); return; }
    if (packet.ttl <= 1) { this.packetEvent(d, packet, 'TTL expired', 'The packet hop limit was exhausted.', 'drop', input); this.icmpError(d, packet, 'Time exceeded', input); return; }
    const route = this.policyRoute(d, input, packet) ?? this.resolveRoute(d, packet.destination, packet.vrf, new Set(), packet);
    if (!route) { this.packetEvent(d, packet, 'No route', 'No usable route to ' + packet.destination, 'drop', input); this.icmpError(d, packet, 'Destination network unreachable', input); return; }
    if(route.port===input&&isIPv4(packet.destination))sendNhrpRedirect(this,d,input,tunnelPeer,packet.destination,route.target);
    if(!ipv6&&route.port===input&&c.features.redirects!==false&&c.ip&&c.mask&&route.target!==packet.source&&inSubnet(packet.source,c.ip,c.mask)&&inSubnet(route.target,c.ip,c.mask)){
      const key=input+'|'+packet.source+'|'+packet.destination,seen=d.runtime.features.redirectSent??={};
      if(seen[key]===undefined||this.clock.now()-seen[key]>=1000){seen[key]=this.clock.now();const redirect=this.makePacket(c.ip,packet.source,'icmp',56,{kind:'icmp-redirect',gateway:route.target,destination:packet.destination});redirect.parentId=packet.id;redirect.vrf=packet.vrf;this.originate(d,redirect);this.packetEvent(d,redirect,'ICMP redirect sent','Use next hop '+route.target+' for '+packet.destination,'info',input);}
    }
    packet.ttl--; this.forwardIP(d, route, packet, input);
  }
  private policyRoute(d: Device, input: string, packet: IPPacket): ResolvedRoute | undefined {
    return selectPolicyRoute(this,d,input,packet,target=>this.resolveRoute(d,target,packet.vrf,new Set(),packet),(name,value)=>this.aclAllows(d,name,value));
  }

  private forwardIP(d: Device, route: ResolvedRoute, original: IPPacket, input?: string): void {
    let packet = original;
    if ((isIPv4LinkLocal(packet.source) || isIPv4LinkLocal(packet.destination)) && route.target !== packet.destination) {
      this.packetEvent(d, packet, 'IPv4 link-local scope', 'Link-local packets must be sent directly on the local link.', 'drop', route.port);
      if (!input) this.failLocal(d.id, packet, 'Destination network unreachable'); return;
    }
    if (/^Null/i.test(route.port)) { this.packetEvent(d, packet, 'Null route', 'The selected route discards the packet.', 'drop', route.port); if (input) this.icmpError(d, packet, 'Destination unreachable', input); else this.failLocal(d.id, packet, 'Destination unreachable'); return; }
    const c = d.config.interfaces[route.port]; if (!c) return;
    if(input&&isDatacenter(d)&&route.port==='mgmt0'){this.packetEvent(d,packet,'Management-plane isolation','Data traffic cannot transit the out-of-band management port.','drop',input);return;}
    if(packet.protocol==='tcp'&&((packet.body?.kind==='tcp-channel'&&['syn','syn-ack'].includes(packet.body.phase))||['tcp-syn','tcp-syn-ack'].includes(packet.body?.kind))){const limits=[d.config.interfaces[route.port]?.features.tcpMss,input?d.config.interfaces[input]?.features.tcpMss:undefined].filter((value):value is number=>typeof value==='number');if(limits.length)packet.body.mss=Math.min(packet.body.mss??1024,...limits);}
    const translated = this.translateOutbound(d, input, route.port, packet); if (!translated) { if (input) this.icmpError(d, packet, 'NAT address pool exhausted', input); return; } packet = translated;
    if (!applyQos(this, d, route.port, 'out', packet, (name, p) => this.aclAllows(d, name, p))) return;
    if (egressAclRequired(d,input) && !this.aclAllows(d, isIPv6(packet.destination) ? c.features.ipv6AclOut : c.features.aclOut, packet,{port:route.port,direction:'out'})) { this.packetEvent(d, packet, 'Egress ACL denied', 'Access list ' + (isIPv6(packet.destination)?c.features.ipv6AclOut:c.features.aclOut), 'drop', route.port); if (input) this.icmpError(d, packet, 'Administratively prohibited', input); else this.failLocal(d.id, packet, 'Administratively prohibited'); return; }
    if (this.cryptoServices.protect(d, route.port, packet)) return;
    const mtu = Math.max(68, Number(c.features.ipMtu ?? c.mtu));
    recordFlow(this, d, input, route.port, packet);
    if (packet.size > mtu) {
      if (packet.df || isIPv6(packet.destination)) { const error = isIPv6(packet.destination) ? 'Packet too big (MTU ' + mtu + ')' : 'Fragmentation needed (MTU ' + mtu + ')'; this.packetEvent(d, packet, 'MTU exceeded', error, 'drop', route.port); if (input) this.icmpError(d, packet, error, input); else this.failLocal(d.id, packet, error); return; }
      const payload = packet.size - 20, block = Math.floor((mtu - 20) / 8) * 8;
      if (block <= 0) { this.failLocal(d.id, packet, 'MTU too small'); return; }
      const base = packet.fragment?.offset ?? 0;
      for (let offset = 0; offset < payload; offset += block) { const length = Math.min(block, payload - offset); const fragment: IPPacket = { ...clone(packet), id: this.id('packet'), parentId: packet.id, size: length + 20, fragment: { id: packet.fragment?.id ?? packet.id, offset: base + offset, length, more: offset + length < payload || !!packet.fragment?.more, total: packet.fragment?.total ?? payload } }; inheritQosClass(packet, fragment); this.packetEvent(d, fragment, 'IPv4 fragment', 'Payload bytes ' + (base + offset) + '–' + (base + offset + length - 1), 'forward', route.port); this.sendResolved(d, route.port, route.target, fragment); }
      return;
    }
    this.packetEvent(d, packet, input ? 'IP forwarded' : 'IP originated', route.route.protocol + ' route via ' + route.port + (route.route.nextHop ? ' / ' + route.route.nextHop : ''), 'forward', route.port);
    this.sendResolved(d, route.port, route.target, packet);
  }
  pendingNeighbors(deviceId:string):{ip:string;port:string;state:'Incomplete';attempts:number}[]{return [...this.pendingArp.values()].filter(row=>row.deviceId===deviceId).map(row=>({ip:row.target,port:row.port,state:'Incomplete' as const,attempts:row.attempts}));}
  private arpKey(d: Pick<Device,'id'>, port: string, address: string): string { return d.id + '|' + port + '|' + address; }
  private sendResolved(d: Device, port: string, target: string, packet: IPPacket): void {
    if (/^Tunnel/i.test(port)) { this.encapsulateGRE(d, port, packet, target); return; }
    if (this.isMulticast(packet.destination)) { this.transmit(d, port, this.multicastMac(packet.destination), packet); return; }
    const key = this.arpKey(d, port, target), entry = d.runtime.arp[port + '|' + target];
    if (entry && (entry.static || entry.expires > this.clock.now())) { this.transmit(d, port, entry.mac, packet); return; }
    let wait = this.pendingArp.get(key);
    if (!wait) { wait = { deviceId: d.id, port, target, packets: [], attempts: 0 }; this.pendingArp.set(key, wait); }
    if (wait.packets.length >= 64) { this.packetEvent(d, packet, 'ARP queue full', 'Too many packets await neighbor resolution.', 'drop', port); return; }
    wait.packets.push(packet); if (!wait.attempts) this.askNeighbor(wait);
  }
  private encapsulateGRE(d: Device, port: string, packet: IPPacket, target = packet.destination, nbma?: string): void {
    const c = d.config.interfaces[port];if(!c||!d.powered||!this.interfaceUp(d.id,port)){this.packetEvent(d,packet,'Tunnel unavailable','Tunnel is no longer operational.','drop',port);this.failLocal(d.id,packet,'Tunnel unavailable');return;}const mode = c.features.tunnelMode ?? 'gre';
    if (!['gre', 'gre ip', 'gre ipv4', 'gre multipoint'].includes(mode)) { this.packetEvent(d, packet, 'Unsupported tunnel mode', String(mode) + ' is not operational in this engine.', 'drop', port); this.failLocal(d.id, packet, 'Unsupported tunnel mode'); return; }
    const source = tunnelNbma(d,c);
    if (mode === 'gre multipoint' && !nbma && (this.isMulticast(target) || /^ff/i.test(target) || target === '255.255.255.255')) {
      const nhrp = c.features.nhrp ?? {}, cache = d.runtime.features.nhrp?.[port]?.cache ?? [];
      const destinations: string[] = nhrp.multicast === 'dynamic' ? cache.filter((entry: any) => entry.registered && entry.expires > this.clock.now()).map((entry: any) => entry.nbma) : Array.isArray(nhrp.multicast) ? nhrp.multicast : [];
      for (const destination of new Set(destinations)) if (isIPv4(destination) && destination !== source) this.encapsulateGRE(d, port, clone(packet), target, destination);
      if (!destinations.length) this.packetEvent(d, packet, 'No tunnel multicast mapping', 'No configured multicast NBMA or current dynamic registration is available.', 'drop', port);
      return;
    }
    const destination = nbma ?? (mode === 'gre multipoint' ? resolveTunnelDestination(this, d, port, target) : c.features.tunnelDestination);
    if (!destination && mode === 'gre multipoint') { this.queueTunnelResolution(d,port,target,packet);return; }
    if (!source || !destination) { this.packetEvent(d, packet, 'Tunnel underlay unavailable', 'GRE needs a resolved NBMA destination and an independent physical route.', 'drop', port); this.failLocal(d.id, packet, 'Tunnel underlay unavailable'); return; }
    touchNhrp(d,port,target);
    const outer = this.makePacket(source, destination, 'gre', packet.size + (c.features.tunnelKey === undefined ? 24 : 28), { kind: 'gre', inner: clone(packet), key: c.features.tunnelKey }); outer.parentId = packet.id; outer.vrf = c.features.tunnelVrf;
    this.sendGREOuter(d,port,outer);
  }
  private tunnelResolutionValid(wait:TunnelResolution):boolean {
    const d=this.getDevice(wait.deviceId),state:NhrpRuntime|undefined=d?.runtime.features.nhrp?.[wait.port];
    return !!d&&d.runtime===wait.runtime&&this.interfaceUp(d.id,wait.port)&&wait.signature===tunnelSignature(d,wait.port)&&state===wait.nhrp&&state?.generation===wait.generation;
  }
  private finishTunnelResolution(wait:TunnelResolution,error?:string,nbma?:string):void {
    this.pendingTunnels.delete(this.arpKey({id:wait.deviceId},wait.port,wait.target));this.clock.cancel(wait.timer);
    const d=this.getDevice(wait.deviceId);if(!d||d.runtime!==wait.runtime)return;
    for(const packet of wait.packets){
      if(error){this.packetEvent(d,packet,error,'Pending GRE packet discarded.','drop',wait.port);if(this.localInterface(d,packet.source,packet.vrf))this.failLocal(d.id,packet,error);else if(packet.body?.kind!=='control-plane')this.icmpError(d,packet,error);continue;}
      if(packet.body?.kind!=='control-plane'){
        const route=this.resolveRoute(d,packet.destination,packet.vrf,new Set(),packet);
        if(!route){this.packetEvent(d,packet,'No route','Overlay route was withdrawn during NHRP resolution.','drop',wait.port);this.failLocal(d.id,packet,'Overlay route withdrawn');continue;}
        if(route.port!==wait.port||route.target!==wait.target){this.forwardIP(d,route,packet);continue;}
      }
      this.encapsulateGRE(d,wait.port,packet,wait.target,nbma);
    }
  }
  private queueTunnelResolution(d:Device,port:string,target:string,packet:IPPacket):void {
    const key=this.arpKey(d,port,target);let wait=this.pendingTunnels.get(key);
    if(wait&&!this.tunnelResolutionValid(wait)){this.finishTunnelResolution(wait,'NHRP resolution cancelled');wait=undefined;}
    if(!wait){const state:NhrpRuntime|undefined=d.runtime.features.nhrp?.[port];wait={deviceId:d.id,port,target,packets:[],attempts:0,runtime:d.runtime,signature:tunnelSignature(d,port),nhrp:state,generation:state?.generation};this.pendingTunnels.set(key,wait);}
    if(wait.packets.length>=64){this.packetEvent(d,packet,'NHRP queue full','At most 64 packets may await this tunnel next hop.','drop',port);this.failLocal(d.id,packet,'NHRP queue full');return;}
    wait.packets.push(packet);if(wait.timer)return;
    const entry=wait,check=()=>{
      if(this.pendingTunnels.get(key)!==entry)return;
      if(!this.tunnelResolutionValid(entry)){this.finishTunnelResolution(entry,'NHRP resolution cancelled');return;}
      const nbma=resolveTunnelDestination(this,d,port,target);
      if(nbma){this.finishTunnelResolution(entry,undefined,nbma);return;}
      if(++entry.attempts>=20){this.finishTunnelResolution(entry,'NHRP resolution timed out');return;}
      entry.timer=this.clock.schedule(100,check,{owner:d.id,label:'NHRP packet queue'});
    };
    entry.timer=this.clock.schedule(100,check,{owner:d.id,label:'NHRP packet queue'});
  }
  private sendGREOuter(d:Device,port:string,outer:IPPacket):void {
    const c=d.config.interfaces[port],route=this.resolveRoute(d,outer.destination,c.features.tunnelVrf);
    if(!route||/^Tunnel|^Null/i.test(route.port)){this.packetEvent(d,outer,'Tunnel underlay unavailable','GRE needs an independent physical route to its destination.','drop',port);this.dropCryptoPacket(d.id,outer,'Tunnel underlay unavailable');return;}
    if(c.features.tunnelProtection&&this.cryptoServices.protect(d,route.port,outer,c.features.tunnelProtection,port))return;
    this.packetEvent(d,outer,'GRE encapsulation',outer.body.nhrp?'NHRP '+outer.body.nhrp.operation:`${outer.body.inner.source} → ${outer.body.inner.destination} inside ${outer.source} → ${outer.destination}`,'forward',port);this.originate(d,outer);
  }
  private receiveGRE(d:Device,p:IPPacket,protection?:TunnelProtection):void {
    const b=p.body,tunnel=Object.entries(d.config.interfaces).find(([name,c])=>/^Tunnel/i.test(name)&&this.interfaceUp(d.id,name)&&tunnelAccepts(this,d,name,p.source)&&tunnelMatches(d,c,p.destination,p.source,b.key,p.vrf));
    if(!tunnel){this.packetEvent(d,p,'No matching GRE tunnel','No operational tunnel matches the outer addresses, VRF and key.','drop');return;}
    const [port,c]=tunnel;
    if(c.features.tunnelProtection&&(!protection||protection.profile!==c.features.tunnelProtection||protection.tunnel!==port||protection.local!==p.destination||protection.peer!==p.source||protection.key!==b.key||(protection.vrf??'')!==(p.vrf??''))){this.packetEvent(d,p,'Unprotected GRE rejected','This tunnel requires a matching IPsec association.','drop',port);return;}
    this.packetEvent(d,p,'GRE decapsulation',b.nhrp?'Delivering NHRP '+b.nhrp.operation+' to '+port:'Delivering the inner packet to '+port,'receive',port);
    if(b.nhrp)receiveNhrp(this,d.id,port,p.source,b.nhrp);else if(b.inner)this.receiveIP(d,port,b.inner,false,p.source);
  }
  private askNeighbor(wait: Resolution): void {
    const d = this.getDevice(wait.deviceId); if (!d?.powered) return;
    const family = isIPv6(wait.target) ? 6 : 4;
    wait.attempts++;
    this.transmit(d, wait.port, BROADCAST, { kind: 'arp', operation: 'request', source: this.addressFor(d, wait.port, family,wait.target) ?? '', target: wait.target, mac: this.macOf(d.id, wait.port), family });
    wait.timer = this.clock.schedule(1000, () => {
      if (!this.pendingArp.has(this.arpKey(d, wait.port, wait.target))) return;
      if (wait.attempts < 3) this.askNeighbor(wait);
      else { this.pendingArp.delete(this.arpKey(d, wait.port, wait.target)); for (const packet of wait.packets) { this.packetEvent(d, packet, 'Neighbor unresolved', 'No reply for ' + wait.target, 'drop', wait.port); if (this.localInterface(d, packet.source, packet.vrf)) this.failLocal(d.id, packet, 'Destination host unreachable'); else this.icmpError(d, packet, 'Destination host unreachable', wait.port); } }
    }, { owner: d.id, label: 'neighbor resolution timeout' });
  }
  private receiveArp(d: Device, port: string, arp: ArpMessage, frameId?:string): void {
    const c = d.config.interfaces[port]; if (!c) return;
    if(arp.family===6&&c.features.ipv6AclIn){const ns=arp.operation==='request',destination=ns?bigIntToIPv6(ipv6ToBigInt('ff02::1:ff00:0')|(ipv6ToBigInt(arp.target)&0xffffffn)):arp.target===arp.source||arp.target==='::'?'ff02::1':arp.target,packet:IPPacket={id:frameId??this.id('nd-acl'),source:arp.source,destination,protocol:'icmpv6',ttl:255,size:72,df:false,body:{kind:ns?'nd-ns':'nd-na',target:arp.target}};if(!this.aclAllows(d,c.features.ipv6AclIn,packet,{port,direction:'in'})){this.packetEvent(d,packet,'Ingress ACL denied','Access list '+c.features.ipv6AclIn,'drop',port);return;}}
    this.ipv4LinkLocal.observe(d, port, arp);
    if (arp.family === 6) this.ipv6Services.observeNeighbor(d, port, arp);
    const checking = d.runtime.features.dhcpAddressChecks?.[port];
    if (arp.family === 4 && checking && arp.mac !== this.macOf(d.id, port) && (arp.source === checking.address || (arp.source === '0.0.0.0' && arp.target === checking.address))) checking.conflict = arp.mac;
    if (arp.source && arp.source !== '::' && arp.source !== '0.0.0.0' && !d.runtime.arp[port + '|' + arp.source]?.static) {
      d.runtime.arp[port + '|' + arp.source] = { ip: arp.source, mac: arp.mac, port, vrf: c.vrf, expires: this.clock.now() + Math.max(1, arp.family===6?c.features.ndCacheExpire??300:c.features.arpTimeout??300) * 1000, ...(arp.family===6?{reachableUntil:this.clock.now()+(c.features.ndReachableTime||c.features.ndAdvertisedReachableTime||30000)}:{}) };
      vpcObserveArp(this,d,port,arp.source);
    }
    this.ensureAging(d);
    const key = this.arpKey(d, port, arp.source), wait = this.pendingArp.get(key);
    if (wait) { this.clock.cancel(wait.timer); this.pendingArp.delete(key); for (const packet of wait.packets) this.transmit(d, port, arp.mac, packet); }
    const natAlias = c.features.nat === 'outside' && [...(d.config.features.nat?.static ?? []), ...(d.runtime.features.natTranslations ?? []).filter((x:any)=>x.expires===undefined||x.expires>this.clock.now())].some((mapping: any) => mapping.outside === arp.target);
    const proxyRoute = arp.family === 4 && !isIPv4LinkLocal(arp.target) && d.config.ipRouting && c.features.proxyArp !== false ? this.resolveRoute(d, arp.target, c.vrf) : undefined; const proxy = !!proxyRoute && (proxyRoute.port !== port || c.features.localProxyArp===true) && !/^Null/i.test(proxyRoute.port);
    const glbp = arp.family === 4 && arp.operation === 'request' ? virtualArpReply(this, d, port, arp.target, arp.mac) : { handled: false, mac: undefined };
    if (glbp.handled && !glbp.mac) return;
    const localTarget = arp.family === 6 && prefixContains('fe80::', 10, arp.target) ? (c.ipv6.length || c.features.ipv6Enabled) && this.ipv6AddressUsable(d.id,port,this.linkLocalAddress(d.id,port)) && sameAddress(this.linkLocalAddress(d.id, port), arp.target) : this.localInterface(d, arp.target, c.vrf) === port;
    if (arp.operation === 'request' && (glbp.mac || localTarget || natAlias || proxy)) {
      const virtual = this.virtualAddresses(d).find(v => v.role === 'active' && v.ip === arp.target && v.interface === port);
      this.transmit(d, port, arp.mac, { kind: 'arp', operation: 'reply', source: arp.target, target: arp.source, targetMac: arp.mac, mac: glbp.mac ?? virtual?.mac ?? this.macOf(d.id, port), family: arp.family }, glbp.handled ? undefined : virtual?.mac);
    }
  }
  private deliverIP(d: Device, packet: IPPacket, input?: string): void {
    if (packet.fragment) {
      const f = packet.fragment, key = d.id + '|' + packet.source + '|' + f.id;
      let assembled = this.fragments.get(key);
      if (!assembled) { const timer = this.clock.schedule(30000, () => { this.fragments.delete(key); this.packetEvent(d, packet, 'Reassembly timeout', 'Some IPv4 fragments did not arrive.', 'drop'); }, { owner: d.id, label: 'IPv4 reassembly' }); assembled = { parts: new Map(), packet: clone(packet), timer }; this.fragments.set(key, assembled); }
      assembled.parts.set(f.offset, f.length); let cursor = 0; for (const [offset, length] of [...assembled.parts].sort((a, b) => a[0] - b[0])) { if (offset !== cursor) return; cursor += length; }
      if (cursor !== f.total) return;
      this.clock.cancel(assembled.timer); this.fragments.delete(key); packet = { ...assembled.packet, id: f.id, size: f.total + 20, fragment: undefined };
      this.packetEvent(d, packet, 'IPv4 reassembled', 'All fragments arrived and passed contiguous-offset validation.', 'success');
    }
    const body = packet.body;
    if(body?.kind==='icmp-redirect'){
      const iface=input?d.config.interfaces[input]:undefined,current=this.resolveRoute(d,body.destination,packet.vrf);
      if(!d.config.ipRouting&&iface?.ip&&iface.mask&&isIPv4(body.gateway)&&isIPv4(body.destination)&&current?.target===packet.source&&inSubnet(body.gateway,iface.ip,iface.mask)&&body.gateway!==iface.ip){
        const entries=d.runtime.features.icmpRedirects??={};entries[body.destination]={network:body.destination,prefix:32,nextHop:body.gateway,interface:input,protocol:'static',ad:1,metric:0,expires:this.clock.now()+600000};this.changed();this.packetEvent(d,packet,'ICMP redirect accepted','Host route via '+body.gateway,'receive',input);this.clock.schedule(600000,()=>{if(entries[body.destination]?.expires<=this.clock.now()){delete entries[body.destination];this.changed();}},{owner:d.id,label:'ICMP redirect expiry'});
      }else this.packetEvent(d,packet,'ICMP redirect ignored','Redirect does not match the current next hop or local subnet.','drop',input);
    }else if (body?.kind === 'echo-request') {
      this.packetEvent(d, packet, 'Echo request accepted', 'The destination will route an echo reply back to the source.', 'receive');
      const reply = this.makePacket(packet.destination, packet.source, packet.protocol, packet.size, { ...body, kind: 'echo-reply' }); if(['pc','laptop','server'].includes(d.kind))reply.ttl=d.kind==='server'||!d.config.features.hostOS||d.config.features.hostOS==='windows'?128:64; reply.parentId = packet.id; reply.sourcePort = packet.destinationPort; reply.destinationPort = packet.sourcePort; reply.vrf = packet.vrf; this.originate(d, reply, input);
    } else if (body?.kind === 'echo-reply' || body?.kind === 'icmp-error') {
      const original = body.kind === 'icmp-error' ? body.original : body;
      const key = original.probeId + '|' + original.sequence, wait = this.probes.get(key);
      const invalidData = body.kind === 'echo-reply' && wait?.expectedData !== undefined && wait.expectedData !== body.dataHex;
      const quoteMatches=!wait?.udpTrace||body.kind==='icmp-error'&&original.protocol==='udp'&&original.destination===wait.udpTrace.target&&original.destinationPort===wait.udpTrace.port,traceReached=!!wait?.udpTrace&&quoteMatches&&body.error==='Port unreachable';
      if (wait && wait.deviceId === d.id && quoteMatches) { this.clock.cancel(wait.timer); this.probes.delete(key); wait.callback({ sequence: original.sequence, from: packet.source, ttl: packet.ttl, time: this.clock.now() - wait.sentAt, error: traceReached ? undefined : body.kind === 'icmp-error' ? body.error : invalidData ? 'ICMP payload verification failed' : undefined }); }
      if (body.kind === 'icmp-error' && original.transaction && this.serviceWait.get(original.transaction)?.deviceId === d.id) this.finishService(original.transaction, undefined, body.error);
      this.packetEvent(d, packet, invalidData ? 'Echo data mismatch' : body.kind === 'echo-reply' ? 'Echo reply received' : 'ICMP error received', invalidData ? 'Echoed payload differs from the transmitted pattern.' : body.error ?? 'The return path completed.', traceReached||body.kind === 'echo-reply' && !invalidData ? 'success' : 'warning');
    } else this.deliverService(d, packet, input);
  }
  private makePacket(source: string, destination: string, protocol: string, size: number, body: any): IPPacket { return { id: this.id('packet'), source, destination, protocol, ttl: 64, size, df: false, body }; }
  private icmpError(d: Device, packet: IPPacket, error: string, input?: string): void {
    if(!isIPv6(packet.source)&&/unreachable|prohibited|Fragmentation needed/i.test(error)&&input&&d.config.interfaces[input]?.features.unreachables===false)return;
    if (packet.body?.kind === 'icmp-error' || !packet.source || (packet.fragment && packet.fragment.offset !== 0)) return;
    const interval = Math.max(0, Number(d.config.features.icmpRateLimit ?? 500)), errors = d.runtime.features.icmpLastError ??= {}, errorKey = packet.protocol + '|' + error;
    if (errors[errorKey] !== undefined && this.clock.now() - errors[errorKey] < interval) { d.runtime.features.icmpRateDrops = (d.runtime.features.icmpRateDrops ?? 0) + 1; return; } errors[errorKey] = this.clock.now();
    const family = isIPv6(packet.source) ? 6 : 4;
    const back = this.resolveRoute(d, packet.source, packet.vrf);
    const source = this.addressFor(d, back?.port ?? input ?? '', family); if (!source) return;
    const response = this.makePacket(source, packet.source, family === 6 ? 'icmpv6' : 'icmp', family === 6 ? 88 : 56, { kind: 'icmp-error', error, original: { ...packet.body, source: packet.source, sourcePort: packet.sourcePort, destination: packet.destination, destinationPort: packet.destinationPort, protocol: packet.protocol } }); response.parentId = packet.id; response.vrf = packet.vrf; this.originate(d, response);
  }
  private failLocal(deviceId: string, packet: IPPacket, error: string): void {
    const key = packet.body?.probeId + '|' + packet.body?.sequence, wait = this.probes.get(key);
    if (wait && wait.deviceId === deviceId) { this.clock.cancel(wait.timer); this.probes.delete(key); wait.callback({ sequence: packet.body.sequence, error }); }
    const service = this.serviceWait.get(packet.body?.transaction); if (service && service.deviceId === deviceId) this.finishService(packet.body.transaction,undefined,error);
  }
  ping(sourceId: string, target: string, options: PingOptions = {}): PingResult {
    const d = this.getDevice(sourceId); if (!d) throw new Error('Unknown source device');
    const count = Math.min(100, Math.max(1, Math.floor(options.count ?? 5)));
    const result: PingResult = { id: this.id('ping'), sourceId: d.id, target, status: 'running', sent: 0, received: 0, replies: [] };
    if (!isIPv4(target) && !isIPv6(target)) { result.status = 'failure'; result.replies.push({ sequence: 1, error: 'Use an IP address; resolve hostnames with DNS first.' }); return result; }
    const pattern = options.dataPattern ?? (options.validateData ? 'abcd' : undefined);
    if (pattern !== undefined && (!/^[0-9a-f]{2,64}$/i.test(pattern) || pattern.length % 2 !== 0)) { result.status = 'failure'; result.replies.push({ sequence: 1, error: 'Data pattern must contain 1–32 bytes of hexadecimal pairs.' }); return result; }
    if (options.tos !== undefined && (!Number.isInteger(options.tos) || options.tos < 0 || options.tos > 255)) { result.status = 'failure'; result.replies.push({ sequence: 1, error: 'Type of service must be an integer from 0 to 255.' }); return result; }
    const size = Math.max(isIPv6(target) ? 48 : 28, options.size ?? 100), payloadBytes = size - (isIPv6(target) ? 48 : 28);
    if (pattern && size > 65535) { result.status = 'failure'; result.replies.push({ sequence: 1, error: 'Patterned echo size cannot exceed 65535 bytes.' }); return result; }
    const dataHex = pattern?.toLowerCase().repeat(Math.ceil(payloadBytes * 2 / pattern.length)).slice(0, payloadBytes * 2);
    const complete = (reply: ProbeReply) => { result.replies.push(reply); if (!reply.error) result.received++; if (result.replies.length >= count) result.status = result.received > 0 ? 'success' : 'failure'; this.notify(); };
    for (let sequence = 1; sequence <= count; sequence++) {
      this.clock.schedule((sequence - 1) * (options.interval ?? 1000), () => {
        result.sent++;
        const timeout = this.clock.schedule(options.timeout ?? 3000, () => { this.probes.delete(result.id + '|' + sequence); complete({ sequence, error: 'Request timed out' }); }, { label: 'echo timeout' });
        this.probes.set(result.id + '|' + sequence, { deviceId: d.id, timer: timeout, sentAt: this.clock.now(), callback: complete, expectedData: options.validateData ? dataHex : undefined });
        const packet = this.makePacket(options.source ?? '', target, isIPv6(target) ? 'icmpv6' : 'icmp', size, { kind: 'echo-request', probeId: result.id, sequence, dataHex });
        packet.df = !!options.df; packet.ttl = options.ttl ?? 64; packet.vrf = options.vrf; packet.dscp = options.tos === undefined ? undefined : options.tos >>> 2; packet.ecn=((options.tos??0)&3) as 0|1|2|3; packet.sourcePort = 10000 + this.hash(result.id) % 50000; packet.destinationPort = packet.sourcePort;
        this.originate(d, packet, options.interface);
      }, { label: 'echo send' });
    }
    this.notify(); return result;
  }
  /** A real UDP traceroute datagram; only a matched destination port-unreachable completes it. */
  udpTraceProbe(sourceId:string,target:string,options:Pick<PingOptions,'ttl'|'timeout'|'source'|'interface'|'vrf'>&{port?:number}={}):PingResult{
    const d=this.getDevice(sourceId);if(!d)throw new Error('Unknown source device');
    const result:PingResult={id:this.id('trace-udp'),sourceId,target,status:'running',sent:0,received:0,replies:[]},port=options.port??33434;
    if((!isIPv4(target)&&!isIPv6(target))||!Number.isInteger(port)||port<0||port>65535){result.status='failure';result.replies.push({sequence:1,error:'Invalid traceroute destination or UDP port'});return result;}
    this.clock.schedule(0,()=>{
      result.sent=1;const complete=(reply:ProbeReply)=>{result.replies.push(reply);result.received=reply.error?0:1;result.status=reply.error?'failure':'success';this.notify();},key=result.id+'|1';
      const timer=this.clock.schedule(Math.max(0,options.timeout??3000),()=>{this.probes.delete(key);complete({sequence:1,error:'Request timed out'});},{label:'UDP traceroute timeout'});
      this.probes.set(key,{deviceId:sourceId,timer,sentAt:this.clock.now(),callback:complete,udpTrace:{target,port}});
      const packet=this.makePacket(options.source??'',target,'udp',isIPv6(target)?60:40,{kind:'trace-probe',probeId:result.id,sequence:1});
      packet.ttl=Math.max(1,Math.min(255,options.ttl??1));packet.vrf=options.vrf;packet.sourcePort=0x8000|(this.hash(result.id)&0x7fff);packet.destinationPort=port;this.originate(d,packet,options.interface);
    },{label:'UDP traceroute probe'});this.notify();return result;
  }
  traceroute(sourceId: string, target: string, maxHops = 30): TraceResult {
    const d = this.getDevice(sourceId); if (!d) throw new Error('Unknown source device');
    const result: TraceResult = { id: this.id('trace'), sourceId: d.id, target, status: 'running', hops: [] };
    if (!isIPv4(target) && !isIPv6(target)) { result.status = 'failure'; return result; }
    const next = (ttl: number) => {
      const timeout = this.clock.schedule(3000, () => finish({ sequence: ttl, error: 'Request timed out' }), { label: 'trace timeout' });
      const finish = (reply: ProbeReply) => { this.clock.cancel(timeout); this.probes.delete(result.id + '|' + ttl); const reached = !reply.error; result.hops.push({ ttl, address: reply.from, time: reply.time, error: reply.error, reached }); if (reached) result.status = 'success'; else if (ttl >= Math.min(64, maxHops) || (reply.error !== 'Time exceeded' && reply.error !== 'Request timed out')) result.status = 'failure'; else this.clock.schedule(1, () => next(ttl + 1), { label: 'next traceroute hop' }); this.notify(); };
      this.probes.set(result.id + '|' + ttl, { deviceId: d.id, timer: timeout, sentAt: this.clock.now(), callback: finish });
      const packet = this.makePacket('', target, isIPv6(target) ? 'icmpv6' : 'icmp', 64, { kind: 'echo-request', probeId: result.id, sequence: ttl }); packet.ttl = ttl; this.originate(d, packet);
    };
    this.clock.schedule(0, () => next(1), { label: 'traceroute start' }); return result;
  }
  cefLookup(deviceId: string, target: string, vrf?: string, flow?: { source?: string; sourcePort?: number; destinationPort?: number; protocol?: string }): ResolvedRoute | undefined { const d = this.getDevice(deviceId), result = d && this.resolveRoute(d, target, vrf, new Set(), flow); return result ? clone(result) : undefined; }
  aclPermits(deviceId: string, name: string | undefined, source: string, destination: string, protocol: string, ports: { sourcePort?: number; destinationPort?: number } = {}): boolean { const d = this.getDevice(deviceId); return !!d && this.aclAllows(d, name, { id: 'acl-query', source, destination, protocol, ttl: 64, size: 0, df: false, body: {}, ...ports }); }
  timeRangeActive(deviceId: string, name: string, override?: Device['config']): boolean {
    const d = this.getDevice(deviceId), config = override ?? d?.config, range = config?.features.timeRanges?.[name]; if (!d || !config || !range) return false;
    const now = (config.features.clockEpoch ?? Date.UTC(2026, 0, 1)) + this.clock.now() + (d.runtime.features.clockOffset ?? config.features.clockOffset ?? 0);
    if (range.absolute && ((range.absolute.start !== undefined && now < range.absolute.start) || (range.absolute.end !== undefined && now >= range.absolute.end))) return false;
    if (!range.periodic?.length) return !!range.absolute;
    const date = new Date(now), day = date.getUTCDay(), minute = date.getUTCHours() * 60 + date.getUTCMinutes();
    return range.periodic.some((p: any) => p.startMinutes <= p.endMinutes ? (p.days.includes(day) && minute >= p.startMinutes && minute < p.endMinutes) : (p.days.includes(day) && minute >= p.startMinutes) || (p.days.includes((day + 6) % 7) && minute < p.endMinutes));
  }
  packetACLPermits(d: Device, name: string | undefined, packet: IPPacket): boolean { return this.aclAllows(d, name, packet); }
  private aclAllows(d: Device, name: string | undefined, packet: IPPacket, context?: {port:string;direction:'in'|'out'}): boolean {
    if (!name) return true;
    const acl = ownRecordValue(d.config.features.acls, name); if (!acl) return true;
    // Only applied interface filters create packet evidence; classifier/query calls do not.
    const decision=(action:'permit'|'deny',sequence?:number,implicit=false)=>{
      if(context){const rows=d.runtime.features.aclDecisions??=[];rows.push({time:this.clock.now(),name,port:context.port,direction:context.direction,packetId:packet.id,source:packet.source,destination:packet.destination,protocol:packet.protocol,kind:packet.body?.kind,sourcePort:packet.sourcePort,destinationPort:packet.destinationPort,transaction:packet.body?.transaction,action,sequence,implicit});if(rows.length>1000)rows.shift();}
      return action==='permit';
    };
    // NX-OS empty RACLs permit packets until the first entry is configured.
    if (d.kind === 'datacenter' && !(acl.entries ?? []).length) return true;
    for (const entry of [...(acl.entries ?? [])].sort((a: any, b: any) => a.sequence - b.sequence)) {
      if (entry.action === 'remark' || entry.remark !== undefined) continue;
      if (entry.timeRange && !this.timeRangeActive(d.id, entry.timeRange, d.config)) continue;
      if (entry.protocol && !['ip', 'ipv6', 'any'].includes(entry.protocol) && entry.protocol !== packet.protocol && !(entry.protocol === 'icmp' && packet.protocol === 'icmpv6')) continue;
      if (!this.addressMatches(packet.source, entry.source, entry.wildcard)) continue;
      if (acl.type !== 'standard' && !this.addressMatches(packet.destination, entry.destination, entry.destinationWildcard)) continue;
      if (!this.portMatches(packet.sourcePort, entry.sourcePort) || !this.portMatches(packet.destinationPort, entry.destinationPort)) continue;
      if(!aclIcmpMatches(entry,packet))continue;
      if (d.kind !== 'datacenter' || acl.statistics) { const hits = d.runtime.features.aclHits ??= {}; hits[name + ':' + entry.sequence] = (hits[name + ':' + entry.sequence] ?? 0) + 1; }
      return decision(entry.action,entry.sequence);
    }
    if(acl.type==='ipv6'&&packet.protocol==='icmpv6'&&['nd-ns','nd-na'].includes(packet.body?.kind))return decision('permit',undefined,true);
    return decision('deny',undefined,true);
  }
  private addressMatches(address: string, rule?: string, wildcard?: string): boolean {
    if (!rule || rule === 'any') return true; rule = rule.replace(/^host\s+/, '');
    if (rule.includes('/')) { try { const p = parseCidr(rule); return prefixContains(p.network, p.prefix, address); } catch { return false; } }
    if (!wildcard) return sameAddress(address, rule);
    try { const mask = ~ipToInt(wildcard); return (ipToInt(address) & mask) === (ipToInt(rule) & mask); } catch { return false; }
  }
  private portMatches(value: number | undefined, rule: any): boolean { if (rule === undefined || rule === null) return true; if (typeof rule === 'number') return value === rule; if (typeof rule === 'string') return Number(rule) === value; if (value === undefined) return false; const n = Number(rule.value); return rule.operator === 'range' ? value >= n && value <= Number(rule.end) : rule.operator === 'gt' ? value > n : rule.operator === 'lt' ? value < n : rule.operator === 'neq' ? value !== n : value === n; }
  private translateOutbound(d: Device, input: string | undefined, output: string, p: IPPacket): IPPacket | undefined {
    if (!input || d.config.interfaces[input]?.features.nat !== 'inside' || d.config.interfaces[output]?.features.nat !== 'outside' || !isIPv4(p.source)) return p;
    const nat = d.config.features.nat; if (!nat) return p;
    const packet=clone(p),direct=natStatics(d,this.clock.now()).find((x:any)=>x.inside===packet.source);
    if(packet.body?.kind==='icmp-error'&&packet.body.original){
      const q=packet.body.original,related=(d.runtime.features.natTranslations??[]).find((x:any)=>x.overload&&x.expires>this.clock.now()&&x.inside===q.destination&&x.insidePort===q.destinationPort&&x.protocol===q.protocol&&x.remote===q.source&&(q.protocol==='icmp'||x.remotePort===q.sourcePort));
      if(related){packet.source=related.outside;q.destination=related.outside;q.destinationPort=related.outsidePort;if(q.protocol==='icmp')q.sourcePort=related.outsidePort;refreshNatEntry(this,d,related);natTranslated(d);this.packetEvent(d,packet,'Source NAT',p.source+' → '+packet.source,'forward',output);return packet;}
    }
    if(direct){recordNatFlow(this,d,direct,packet);natTranslated(d);packet.source=direct.outside;if(packet.body?.kind==='icmp-error'&&packet.body.original?.destination===direct.inside)packet.body.original.destination=direct.outside;this.packetEvent(d,packet,'Source NAT',p.source+' → '+packet.source,'forward',output);return packet;}
    const table:any[]=d.runtime.features.natTranslations??=[],assigned=findDynamicNatBinding(table,{inside:packet.source},this.clock.now());
    if(assigned){assigned.binding=true;recordNatFlow(this,d,assigned,packet);natTranslated(d);packet.source=assigned.outside;if(packet.body?.kind==='icmp-error'&&packet.body.original?.destination===assigned.inside)packet.body.original.destination=assigned.outside;this.packetEvent(d,packet,'Source NAT',p.source+' → '+packet.source,'forward',output);return packet;}
    // An existing PAT tuple keeps its allocation decision until cleared or expired.
    const configuredRules=new Set((nat.rules??[]).map(natRuleKey));
    const established=table.find(x=>x.overload&&x.expires>this.clock.now()&&configuredRules.has(x.rule)&&x.inside===packet.source&&x.insidePort===packet.sourcePort&&x.protocol===packet.protocol&&x.remote===packet.destination&&(packet.protocol==='icmp'||x.remotePort===packet.destinationPort));
    if(established){
      recordNatFlow(this,d,established,packet);natTranslated(d);packet.source=established.outside;packet.sourcePort=established.outsidePort;if(packet.protocol==='icmp')packet.destinationPort=established.outsidePort;
      this.packetEvent(d,packet,'Source NAT',p.source+' → '+packet.source,'forward',output);return packet;
    }
    for(const [index,rule]of (nat.rules??[]).entries()){
      if(rule.acl&&!ownRecordValue(d.config.features.acls,rule.acl)||!this.aclAllows(d,rule.acl,packet))continue;
      let global=rule.interface?d.config.interfaces[rule.interface]?.ip:nat.pools?.[rule.pool]?.start;
      const key=natRuleKey(rule),pool=nat.pools?.[rule.pool];
      let entry=table.find(x=>x.expires>this.clock.now()&&x.overload&&x.rule===key&&x.inside===packet.source&&x.insidePort===packet.sourcePort&&x.protocol===packet.protocol&&x.remote===packet.destination&&(packet.protocol==='icmp'||x.remotePort===packet.destinationPort));
      if(!entry){
        if(!rule.overload&&global){const first=ipToInt(global),end=pool?.end??global;global=undefined;for(let value=first;value<=ipToInt(end)&&value-first<65536;value++){const candidate=intToIp(value);if(!table.some(x=>x.expires>this.clock.now()&&x.outside===candidate)&&!(nat.static??[]).some((x:any)=>x.outside===candidate)){global=candidate;break;}}}
        if(!global){const stats=natStats(d);stats.punted=(stats.punted??0)+1;stats.poolMisses??={};stats.poolMisses[rule.pool??rule.interface]=(stats.poolMisses[rule.pool??rule.interface]??0)+1;this.packetEvent(d,packet,'NAT pool exhausted','No unused address is available for this inside host.','drop',output);return;}
        let outsidePort=packet.sourcePort;
        if(rule.overload){outsidePort=20000;while(outsidePort<=59999&&table.some(x=>x.expires>this.clock.now()&&x.outside===global&&x.outsidePort===outsidePort&&x.protocol===packet.protocol))outsidePort++;if(outsidePort>59999){this.packetEvent(d,packet,'NAT port allocation failed','No available PAT identifier.','drop',output);return;}}
        entry={inside:packet.source,insidePort:rule.overload?packet.sourcePort:undefined,outside:global,outsidePort:rule.overload?outsidePort:undefined,overload:!!rule.overload,extended:!!rule.overload,binding:!rule.overload,protocol:rule.overload?packet.protocol:undefined,remote:rule.overload?packet.destination:undefined,remotePort:rule.overload&&packet.protocol!=='icmp'?packet.destinationPort:undefined,rule:key,mapId:index+1,created:this.clock.now()};table.push(entry);refreshNatEntry(this,d,entry,packet);
      }
      recordNatFlow(this,d,entry,packet);natTranslated(d);updateNatPeak(d,this.clock.now());
      packet.source=entry.outside;if(entry.overload){packet.sourcePort=entry.outsidePort;if(packet.protocol==='icmp')packet.destinationPort=entry.outsidePort;}
      this.packetEvent(d,packet,'Source NAT',p.source+' → '+packet.source,'forward',output);return packet;
    }
    return packet;
  }
  private translateInbound(d: Device, input: string, p: IPPacket): IPPacket {
    if (d.config.interfaces[input]?.features.nat !== 'outside') return p;
    const nat = d.config.features.nat; if (!nat) return p;
    const direct = nat.static?.find((x: any) => x.outside === p.destination);
    if (p.body?.kind === 'icmp-error'&&p.body.original) {
      const quoted = p.body.original;
      const table=d.runtime.features.natTranslations??[];const mapping=natStatics(d,this.clock.now()).find((x:any)=>x.outside===quoted.source)??findDynamicNatBinding(table,{outside:quoted.source},this.clock.now())??table.find((x:any)=>x.expires>this.clock.now()&&x.overload&&x.outside===quoted.source&&x.outsidePort===quoted.sourcePort&&x.protocol===quoted.protocol&&x.remote===quoted.destination&&(quoted.protocol==='icmp'||x.remotePort===quoted.destinationPort));
      if (mapping) { const packet = clone(p); packet.destination = mapping.inside; packet.body.original.source = mapping.inside; if(mapping.overload)packet.body.original.sourcePort = mapping.insidePort;if(mapping.overload&&quoted.protocol==='icmp')packet.body.original.destinationPort=mapping.insidePort;if(!mapping.static)refreshNatEntry(this,d,mapping);natTranslated(d,'outIn');this.packetEvent(d,packet,'Destination NAT',p.destination+' → '+packet.destination,'forward',input);return packet; }
    }
    const entry = findInboundNatTranslation(d.runtime.features.natTranslations??[],p,this.clock.now());
    if (!direct && !entry) return p;
    const packet=clone(p),mapping=direct?natStatics(d,this.clock.now()).find((x:any)=>x.inside===direct.inside&&x.outside===direct.outside):entry;
    natTranslated(d,'outIn');recordNatFlow(this,d,mapping,p,true);packet.destination=mapping.inside;
    if(entry?.overload){packet.destinationPort=entry.insidePort;if(packet.protocol==='icmp')packet.sourcePort=entry.insidePort;}
    this.packetEvent(d,packet,'Destination NAT',p.destination+' → '+packet.destination,'forward',input);return packet;
  }
  releaseDHCP(deviceId:string,portName?:string):void {
    const d=this.getDevice(deviceId);if(!d)throw new Error('Unknown device');const ports=portName?[portName]:Object.keys(d.config.interfaces);
    for(const port of ports){const c=d.config.interfaces[port];if(!c)continue;this.ipv4LinkLocal.clear(d,port);(d.runtime.features.dhcpReleased??={})[port]=true;const lease=d.runtime.features.dhcpClientLeases?.[port];if(lease?.address&&this.interfaceUp(d.id,port)){const message:DHCPMessage={kind:'dhcp',operation:'release',clientId:d.id,transaction:this.id('dhcp-release'),address:lease.address,serverId:lease.serverId};if(lease.serverAddress){message.unicast=lease.address;const packet=this.makePacket(lease.address,lease.serverAddress,'udp',328,{kind:'dhcp-unicast',message});packet.sourcePort=68;packet.destinationPort=67;this.originate(d,packet);}else this.transmit(d,port,BROADCAST,message);}
      if(lease&&c.ip===lease.address){delete c.ip;delete c.mask;}if(lease&&d.config.defaultGateway===lease.gateway)delete d.config.defaultGateway;if(c.features.windowsDNSMode!=='static'&&lease&&JSON.stringify(d.config.dnsServers)===JSON.stringify(lease.dns||[]))d.config.dnsServers=[];delete c.features.dhcpLease;delete c.features.leaseExpires;delete d.runtime.features.dhcpClientLeases?.[port];delete d.runtime.features.dhcpAddressChecks?.[port];for(const[id,result]of this.dhcpWait)if(result.deviceId===d.id&&result.port===port){result.status='failure';result.error='Lease released by client';this.dhcpWait.delete(id);}
    }this.changed();
  }
  requestDHCP(sourceId: string, portName?: string, retryDiscovery = true): ServiceResult {
    const d = this.getDevice(sourceId); if (!d) throw new Error('Unknown device');
    const port = portName ? (this.interfaceUp(d.id, portName) ? portName : undefined) : Object.keys(d.config.interfaces).find(p => this.interfaceUp(d.id, p));
    const pending = [...this.dhcpWait.values()].find(request => request.deviceId === d.id && request.port === port && request.status === 'running');
    if (pending) {
      // Reuse the transaction, but let an unanswered discovery be retried after
      // a network repair instead of attaching the caller to a silent old send.
      if (retryDiscovery && !pending.selectedAddress && this.clock.now() - pending.lastDiscover >= 500) {
        pending.lastDiscover = this.clock.now(); pending.discoveryDeadline = this.clock.now() + 4000;
        this.transmit(d, port!, BROADCAST, {kind: 'dhcp', operation: 'discover', clientId: d.id, transaction: pending.id, hostname: d.config.hostname});
      }
      return pending;
    }
    const result: ServiceResult = { id: this.id('dhcp'), status: 'running' };
    if (!port) { result.status = 'failure'; result.error = 'No operational interface'; return result; }
    result.deviceId = d.id; result.port = port; d.config.interfaces[port].features.dhcp = true;
    delete d.runtime.features.dhcpReleased?.[port];
    result.lastDiscover = this.clock.now(); result.discoveryDeadline = this.clock.now() + 4000;
    this.dhcpWait.set(result.id, result);
    this.transmit(d, port, BROADCAST, { kind: 'dhcp', operation: 'discover', clientId: d.id, transaction: result.id, hostname: d.config.hostname });
    const timeout = () => {
      if (result.status !== 'running') return;
      if (result.discoveryDeadline > this.clock.now()) { this.clock.schedule(result.discoveryDeadline - this.clock.now(), timeout, {owner: d.id, label: 'DHCP retry timeout'}); return; }
      result.status = 'failure'; result.error = 'No DHCP server answered on this broadcast domain'; this.dhcpWait.delete(result.id); this.ipv4LinkLocal.start(d, port); this.notify();
    };
    this.clock.schedule(4000, timeout, {owner: d.id, label: 'DHCP timeout'});
    return result;
  }
  private installDHCPLease(d: Device, port: string, message: DHCPMessage): void {
    const c = d.config.interfaces[port], duration = Math.max(1, message.lease ?? 86400) * 1000;
    this.ipv4LinkLocal.clear(d, port);
    c.ip = message.address; c.mask = intToIp(message.prefix ? (0xffffffff << (32 - message.prefix)) >>> 0 : 0); c.features.dhcp = true; c.features.dhcpLease = { address: message.address, gateway: message.gateway, dns: message.dns ?? [], domain: message.domain, bootfile: message.bootfile, nextServer: message.nextServer, options: message.options ?? {}, routers: message.routers ?? [] };if(message.domain)d.config.features.domainName=message.domain; c.features.leaseExpires = this.clock.now() + duration; d.config.defaultGateway = message.gateway; if(c.features.windowsDNSMode!=='static')d.config.dnsServers = message.dns ?? [];
    const table = d.runtime.features.dhcpClientLeases ??= {}, lease = { ...message, state: 'BOUND', expires: c.features.leaseExpires, transactions: [] as string[] }; table[port] = lease;
    if(message.lease===4294967295)return;
    const current = () => d.powered && d.runtime.features.dhcpClientLeases?.[port] === lease && c.features.dhcp && c.ip === lease.address;
    const renew = (rebind: boolean) => {
      if (!current() || this.clock.now() >= lease.expires) return; lease.state = rebind ? 'REBINDING' : 'RENEWING';
      const result: ServiceResult = { id: this.id('dhcp-renew'), status: 'running', deviceId: d.id, port, selectedServer: rebind ? undefined : lease.serverId, selectedAddress: lease.address }; this.dhcpWait.set(result.id, result); lease.transactions.push(result.id);
      const request: DHCPMessage = { kind: 'dhcp', operation: 'request', clientId: d.id, transaction: result.id, hostname: d.config.hostname, address: lease.address, serverId: rebind ? undefined : lease.serverId, phase: lease.state };
      this.emit({ nodeId: d.id, port, protocol: 'DHCP', label: rebind ? 'Lease rebinding' : 'Lease renewal', detail: lease.address ?? '', disposition: 'info' });
      if (!rebind && lease.serverAddress) { request.unicast = lease.address; const packet = this.makePacket(lease.address ?? '', lease.serverAddress, 'udp', 328, { kind: 'dhcp-unicast', message: request }); packet.sourcePort = 68; packet.destinationPort = 67; this.originate(d, packet); }
      else this.transmit(d, port, BROADCAST, request);
      this.clock.schedule(2000, () => { this.dhcpWait.delete(result.id); if (current() && lease.state === 'REBINDING' && rebind) renew(true); }, { owner: d.id, label: 'DHCP renewal retry' });
    };
    this.clock.schedule(duration / 2, () => renew(false), { owner: d.id, label: 'DHCP T1' }); this.clock.schedule(duration * 0.875, () => renew(true), { owner: d.id, label: 'DHCP T2' });
    this.clock.schedule(duration, () => {
      if (!current()) return; lease.state = 'EXPIRED'; delete c.ip; delete c.mask; delete c.features.leaseExpires; if (d.config.defaultGateway === lease.gateway) delete d.config.defaultGateway; if (c.features.windowsDNSMode!=='static'&&JSON.stringify(d.config.dnsServers) === JSON.stringify(lease.dns ?? [])) d.config.dnsServers = [];
      for (const id of lease.transactions) this.dhcpWait.delete(id); this.emit({ nodeId: d.id, port, protocol: 'DHCP', label: 'Lease expired', detail: 'The leased address was removed after T1/T2 failed.', disposition: 'warning' }); this.ipv4LinkLocal.start(d, port); this.changed();
      const retry = () => { if (!d.powered || !c.features.dhcp || d.runtime.features.dhcpClientLeases?.[port] !== lease) return; this.requestDHCP(d.id, port, false); this.clock.schedule(5000, retry, { owner: d.id, label: 'DHCP reacquisition retry' }); }; this.clock.schedule(1000, retry, { owner: d.id, label: 'DHCP reacquisition' });
    }, { owner: d.id, label: 'DHCP lease expiry' });
  }
  private checkDHCPAddress(d: Device, port: string, message: DHCPMessage, result: ServiceResult): void {
    const c = d.config.interfaces[port];
    const accept = () => { if (this.dhcpWait.get(message.transaction) !== result || result.status !== 'running' || !d.powered) return; this.installDHCPLease(d, port, message); result.status = 'success'; result.address = message.address; this.dhcpWait.delete(message.transaction); this.emit({ nodeId: d.id, port, protocol: 'DHCP', label: 'Lease acquired', detail: message.address + '/' + message.prefix, disposition: 'success' }); this.changed(); };
    if (c.ip === message.address && d.runtime.features.dhcpClientLeases?.[port]?.address === message.address) { accept(); return; }
    const checks = d.runtime.features.dhcpAddressChecks ??= {}; if (checks[port]?.transaction === message.transaction) return;
    const check = checks[port] = { address: message.address, transaction: message.transaction, conflict: undefined as string | undefined };
    this.emit({ nodeId: d.id, port, protocol: 'DHCP', label: 'Checking offered address', detail: 'ARP probe for ' + message.address + ' before installing the lease.', disposition: 'info' });
    this.transmit(d, port, BROADCAST, { kind: 'arp', operation: 'request', source: '0.0.0.0', target: message.address!, mac: this.macOf(d.id, port), family: 4 });
    this.clock.schedule(200, () => {
      if (d.runtime.features.dhcpAddressChecks?.[port] !== check) return; delete checks[port];
      if (this.dhcpWait.get(message.transaction) !== result || result.status !== 'running' || !d.powered) return;
      if (!check.conflict) { accept(); return; }
      const decline: DHCPMessage = { kind: 'dhcp', operation: 'decline', clientId: d.id, transaction: message.transaction, serverId: message.serverId, address: message.address, reason: 'ARP conflict with ' + check.conflict };
      this.transmit(d, port, BROADCAST, decline); this.emit({ nodeId: d.id, port, protocol: 'DHCP', label: 'Address declined', detail: message.address + ' is already claimed by ' + check.conflict + '.', disposition: 'warning' });
      result.conflicts = (result.conflicts ?? 0) + 1; delete result.selectedServer; delete result.selectedAddress;
      if (result.conflicts >= 4) { result.status = 'failure'; result.error = 'Repeated DHCP address conflicts'; this.dhcpWait.delete(message.transaction); return; }
      this.clock.schedule(100, () => { if (this.dhcpWait.get(message.transaction) === result && result.status === 'running') this.transmit(d, port, BROADCAST, { kind: 'dhcp', operation: 'discover', clientId: d.id, transaction: message.transaction, hostname: d.config.hostname }); }, { owner: d.id, label: 'DHCP discovery after decline' });
    }, { owner: d.id, label: 'DHCP conflict check' });
  }
  private replyDHCP(d: Device, port: string, request: DHCPMessage, response: DHCPMessage): void {
    const stats=d.runtime.features.dhcpServerStats??={received:{},sent:{}};stats.sent[response.operation]=(stats.sent[response.operation]??0)+1;
    if (request.unicast) { const packet = this.makePacket(d.config.interfaces[port].ip ?? '', request.unicast, 'udp', 328, { kind: 'dhcp-unicast', message: response }); packet.sourcePort = 67; packet.destinationPort = 68; this.originate(d, packet); }
    else if (request.relay) { const packet = this.makePacket(d.config.interfaces[port].ip ?? '', request.relay, 'udp', 328, { kind: 'dhcp-relay', message: response }); packet.sourcePort = 67; packet.destinationPort = 67; this.originate(d, packet); }
    else this.transmit(d, port, BROADCAST, response);
  }
  private receiveDHCP(d: Device, physical: string, vlan: number | undefined, frame: Frame | undefined, message: DHCPMessage): void {
    const logical = /^Vlan|^Loopback|^Tunnel/.test(physical) ? physical : this.logicalPorts(d, physical, vlan)[0];
    if (message.relay && d.config.interfaces[message.relayPort ?? '']?.ip === message.relay && ['offer', 'ack', 'nak'].includes(message.operation)) {
      this.transmit(d, message.relayPort!, BROADCAST, message); return;
    }
    if (d.id === message.clientId && ['offer', 'ack', 'nak'].includes(message.operation)) {
      const result = this.dhcpWait.get(message.transaction); if (!result || result.status !== 'running' || !logical) return;
      if (result.port && result.port !== logical || result.selectedServer && result.selectedServer !== message.serverId) return;
      if (message.operation === 'nak') {
        const c = d.config.interfaces[logical], lease = d.runtime.features.dhcpClientLeases?.[logical]; if (lease) { lease.state = 'NAK'; if (c.ip === lease.address) { delete c.ip; delete c.mask; delete c.features.leaseExpires; delete c.features.dhcpLease; } if (d.config.defaultGateway === lease.gateway) delete d.config.defaultGateway; if (c.features.windowsDNSMode!=='static'&&JSON.stringify(d.config.dnsServers) === JSON.stringify(lease.dns ?? [])) d.config.dnsServers = []; }
        delete d.runtime.features.dhcpAddressChecks?.[logical]; result.status = 'failure'; result.error = message.reason ?? 'DHCP server rejected the requested address'; this.dhcpWait.delete(message.transaction); this.emit({ nodeId: d.id, port: logical, protocol: 'DHCP', label: 'DHCP NAK received', detail: result.error!, disposition: 'warning' }); this.ipv4LinkLocal.start(d, logical); this.changed();
        this.clock.schedule(1000, () => { if (d.powered && c.features.dhcp && !c.ip) this.requestDHCP(d.id, logical, false); }, { owner: d.id, label: 'DHCP discovery after NAK' }); return;
      }
      if (!message.address || !isIPv4(message.address) || message.prefix === undefined || message.prefix < 0 || message.prefix > 32) return;
      if (message.operation === 'offer') { if (result.selectedServer) return; result.selectedServer = message.serverId; result.selectedAddress = message.address; const request: DHCPMessage = { ...message, operation: 'request', hostname: d.config.hostname }; delete request.relay; delete request.relayPort; delete request.option82; this.transmit(d, logical, BROADCAST, request); }
      else { if (!result.selectedAddress || result.selectedAddress !== message.address) return; result.selectedServer = message.serverId; this.checkDHCPAddress(d, logical, message, result); }
      return;
    }
    const service = d.config.services.dhcp;
    if(service?.enabled){const stats=d.runtime.features.dhcpServerStats??={received:{},sent:{}};stats.received[message.operation]=(stats.received[message.operation]??0)+1;}
    if(logical&&['router','l3switch'].includes(d.kind)&&message.option82&&!message.relay&&['discover','request'].includes(message.operation)&&!d.config.features.dhcpRelayTrustAll&&!d.config.interfaces[logical].features.dhcpRelayTrusted){d.runtime.features.dhcpRelayDrops=(d.runtime.features.dhcpRelayDrops??0)+1;this.emit({nodeId:d.id,port:logical,protocol:'DHCP',label:'DHCP relay information rejected',detail:'Option 82 with zero giaddr requires a trusted interface.',disposition:'drop'});return;}
    if (logical && !message.relay && ['discover', 'request', 'decline', 'release'].includes(message.operation) && d.config.interfaces[logical].features.helpers?.length) {
      const relay = d.config.interfaces[logical].ip;
      if (relay) for (const destination of d.config.interfaces[logical].features.helpers) { const packet = this.makePacket(relay, destination, 'udp', 328, { kind: 'dhcp-relay', message: { ...message, relay, relayPort: logical, option82: message.option82 ?? (d.config.interfaces[logical].features.helpersOption82 ? { circuitId: logical, remoteId: d.id } : undefined) } }); packet.sourcePort = 67; packet.destinationPort = 67; this.originate(d, packet); }
    }
    if (!logical || !service?.enabled || !['discover', 'request', 'decline', 'release'].includes(message.operation) || (message.serverId && message.serverId !== d.id)) return;
    const c = d.config.interfaces[logical];
    const leases: any[] = d.runtime.features.dhcpLeases ??= [];
    const conflicts: any[] = d.runtime.features.dhcpConflicts ??= [];
    if(message.operation==='release'){const lease=leases.find(x=>x.clientId===message.clientId&&x.address===message.address);if(lease){d.runtime.features.dhcpLeases=leases.filter(x=>x!==lease);this.emit({nodeId:d.id,port:logical,protocol:'DHCP',label:'Lease released',detail:message.address||'',disposition:'info'});}return;}
    if (message.operation === 'decline') {
      const lease = leases.find(x => x.clientId === message.clientId && x.address === message.address && x.expires > this.clock.now()); if (!lease) return;
      d.runtime.features.dhcpLeases = leases.filter(x => x !== lease); const conflict = { address: message.address, clientId: message.clientId, detectedAt: this.clock.now(), expires: this.clock.now() + Math.max(1, service.conflictHoldSeconds ?? 3600) * 1000, reason: message.reason ?? 'Client declined address' }; conflicts.push(conflict);
      this.clock.schedule(conflict.expires - this.clock.now(), () => { d.runtime.features.dhcpConflicts = (d.runtime.features.dhcpConflicts ?? []).filter((row: any) => row !== conflict); }, { owner: d.id, label: 'DHCP conflict hold-down' });
      this.emit({ nodeId: d.id, port: logical, protocol: 'DHCP', label: 'DHCP conflict recorded', detail: conflict.address + ': ' + conflict.reason, disposition: 'warning' }); return;
    }
    const subnetAddress = message.relay || (message.unicast ? message.address : c.ip);
    const pool = (service.pools ?? []).find((p: any) => subnetAddress && prefixContains(p.network, p.prefix, subnetAddress));
    const nak = (reason: string) => { this.replyDHCP(d, logical, message, { ...message, operation: 'nak', serverId: d.id, serverAddress: c.ip, reason }); this.emit({ nodeId: d.id, port: logical, protocol: 'DHCP', label: 'DHCP NAK sent', detail: reason, disposition: 'warning' }); };
    if (!pool) { if (message.operation === 'request' && message.serverId === d.id) nak('No configured DHCP pool permits the requested subnet'); return; }
    const excluded = (address: number) => (service.excluded ?? []).some((e: any) => address >= ipToInt(e.start) && address <= ipToInt(e.end ?? e.start));
    const unavailable = (address: string) => excluded(ipToInt(address)) || address === pool.defaultRouter || Object.values(d.config.interfaces).some(i => i.ip === address) || conflicts.some(x => x.address === address && x.expires > this.clock.now()) || leases.some(x => x.address === address && x.clientId !== message.clientId && x.expires > this.clock.now());
    let lease = leases.find(x => x.clientId === message.clientId && x.pool === pool.name && x.expires > this.clock.now());
    if (message.operation === 'request') {
      const address = message.address, valid = address && isIPv4(address) && prefixContains(pool.network, pool.prefix, address) && address !== networkAddress(pool.network, pool.prefix) && address !== broadcastAddress(pool.network, pool.prefix) && !unavailable(address);
      if (!valid || (lease && lease.address !== address)) { nak('Requested address is invalid, excluded, conflicting, or allocated to another client'); return; }
      if (!lease) { lease = { clientId: message.clientId, pool: pool.name, address, expires: this.clock.now() }; leases.push(lease); }
    }
    if (lease && unavailable(lease.address)) { leases.splice(leases.indexOf(lease), 1); lease = undefined; }
    if (!lease) {
      const start = ipToInt(networkAddress(pool.network, pool.prefix)), end = ipToInt(broadcastAddress(pool.network, pool.prefix));
      for (let address = start + 1; address < end && address < start + 65536; address++) {
        const ip = intToIp(address); if (unavailable(ip) || leases.some(x => x.address === ip && x.expires > this.clock.now())) continue;
        lease = { clientId: message.clientId, pool: pool.name, address: ip, expires: this.clock.now() + (pool.leaseSeconds ?? 86400) * 1000 }; leases.push(lease); break;
      }
    }
    if (lease) {
      lease.option82 = message.option82;
      if(message.operation==='request') {
        lease.state='BOUND'; lease.hostname=message.hostname; lease.domain=pool.domain;
      } else if(lease.state!=='BOUND') lease.state='OFFERED';
      if(message.operation==='request'||lease.state==='OFFERED')lease.expires = this.clock.now() + (pool.leaseSeconds ?? 86400) * 1000;
      const leased = lease, expiry = lease.expires; this.clock.schedule(Math.max(0, expiry - this.clock.now()), () => { if (leased.expires === expiry) d.runtime.features.dhcpLeases = (d.runtime.features.dhcpLeases ?? []).filter((x: any) => x !== leased); }, { owner: d.id, label: 'DHCP server lease expiry' });
      const response: DHCPMessage = { kind: 'dhcp', operation: message.operation === 'discover' ? 'offer' : 'ack', clientId: message.clientId, transaction: message.transaction, serverId: d.id, serverAddress: c.ip, option82: message.option82, address: lease.address, prefix: pool.prefix, gateway: pool.defaultRouter, routers: pool.defaultRouters ?? (pool.defaultRouter?[pool.defaultRouter]:[]), domain:pool.domain, bootfile:pool.bootfile, nextServer:pool.nextServers?.[Math.max(0,leases.indexOf(lease))%pool.nextServers.length], options:JSON.parse(JSON.stringify(pool.options??{})), dns: pool.dnsServers ?? [], lease: pool.leaseSeconds ?? 86400, relay: message.relay, relayPort: message.relayPort };
      this.replyDHCP(d, logical, message, response);
    }
  }
  resolveDNS(sourceId: string, hostname: string, options:{type?:DNSRecordType;server?:string}={}): ServiceResult {
    const d = this.getDevice(sourceId); if (!d) throw new Error('Unknown device');
    const result = this.startService(d, 'dns'); result.hostname = dnsName(hostname);result.type=options.type??'A';
    const server = options.server??d.config.dnsServers[0];result.server=server;
    if(!['A','AAAA','CNAME','MX','NS','PTR'].includes(result.type)||!result.hostname||result.hostname.length>253||result.hostname.split('.').some((part:string)=>!part||part.length>63||!/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(part))){this.finishService(result.id,undefined,'Invalid DNS query name or type');return result;}
    if (!server) { this.finishService(result.id, undefined, 'No DNS server configured'); return result; }
    if(!isIPv4(server)&&!isIPv6(server)){this.finishService(result.id,undefined,'DNS server must be an IPv4 or IPv6 address');return result;}
    const packet = this.makePacket('', server, 'udp', 64 + hostname.length, { kind: 'dns-query', transaction: result.id, hostname:result.hostname,type:result.type }); packet.sourcePort = 49152 + this.hash(result.id) % 16000; packet.destinationPort = 53; this.originate(d, packet); return result;
  }
  resolveName(sourceId: string, hostname: string): ServiceResult {
    if (isIPv4(hostname) || isIPv6(hostname)) return { id: this.id('dns'), status: 'success', hostname, address: hostname };
    const records = this.getDevice(sourceId)?.config.services.dns?.records, address = records?.[hostname.toLowerCase()] ?? records?.[hostname];
    if (address && (isIPv4(address) || isIPv6(address))) return { id: this.id('dns'), status: 'success', hostname, address, source: 'local-host-table' };
    const d=this.getDevice(sourceId),name=dnsName(hostname),cache=d?.runtime.features.dnsCache??{},fresh=(row:any)=>row&&row.expires>this.clock.now();
    const cached=[cache[name+'|A'],cache[name+'|AAAA'],cache[name]].find(row=>fresh(row)&&row.address);
    if(cached)return {id:this.id('dns'),status:'success',hostname,address:cached.address,source:'dns-cache'};
    const absent=[cache[name+'|A'],cache[name+'|AAAA'],cache[name]].find(row=>fresh(row)&&row.rcode==='NXDOMAIN');
    if(absent)return {id:this.id('dns'),status:'failure',hostname,error:'NXDOMAIN',source:'dns-cache'};
    if(d?.config.features.domainLookup===false)return {id:this.id('dns'),status:'failure',hostname,error:'DNS lookup is disabled'};
    if(!d)throw Error('Unknown device');
    const result=this.startService(d,'name-resolution',20001);result.hostname=name;
    const query=(type:DNSRecordType)=>{
      if(!this.serviceWait.has(result.id))return;
      const old=cache[name+'|'+type],child:ServiceResult=fresh(old)?{id:this.id('dns-cache'),status:old.error?'failure':'success',address:old.address,error:old.error,rcode:old.rcode,source:'dns-cache'}:this.resolveDNS(sourceId,name,{type});
      const done=(answer:ServiceResult)=>{if(!this.serviceWait.has(result.id))return;if(answer.status==='success'&&answer.address)this.finishService(result.id,{address:answer.address,source:answer.source??'dns',type});else if(type==='A'&&answer.status==='success'&&answer.rcode==='NOERROR')query('AAAA');else this.finishService(result.id,undefined,answer.error??'DNS name has no A or AAAA address record');};
      const pending=this.serviceWait.get(child.id);if(pending)pending.callback=done;else done(child);
    };
    query('A');return result;
  }
  registerHTTPAuthenticator(authenticate: (deviceId: string, list: string, username: string, password: string) => ReturnType<HTTPAuthenticator>): () => void { this.httpAuthenticator = authenticate; return () => { if (this.httpAuthenticator === authenticate) this.httpAuthenticator = undefined; }; }
  httpRequest(sourceId: string, url: string, options: HTTPRequestOptions & ServiceOptions = {}): ServiceResult {
    const result: ServiceResult = { id: this.id('browser'), status: 'running', url };
    let parsed: URL;
    try { parsed = new URL(url.includes('://') ? url : 'http://' + url); } catch { return Object.assign(result, { status: 'failure', error: 'Invalid URL' }); }
    if (!['http:','https:'].includes(parsed.protocol)) return Object.assign(result,{status:'failure',error:'The simulated browser supports HTTP and modeled HTTPS endpoints.'});
    const startHttp = (address: string) => {
      const response = this.fetchHTTP(sourceId, address, parsed.pathname + parsed.search, {...options,port:Number(parsed.port||(parsed.protocol==='https:'?443:80)),secure:parsed.protocol==='https:'});
      result.transportTransaction=response.id;
      const done = (r: ServiceResult) => Object.assign(result, r, { id: result.id, body: r.content, url });
      const pending = this.serviceWait.get(response.id); if (pending) pending.callback = done; else done(response);
    };
    const resolved = this.resolveName(sourceId, parsed.hostname.replace(/^\[|\]$/g, ''));
    const dnsDone = (r: ServiceResult) => { if (r.status === 'success') startHttp(r.address); else Object.assign(result, { status: 'failure', error: r.error }); };
    const pending = this.serviceWait.get(resolved.id); if (pending) pending.callback = dnsDone; else dnsDone(resolved);
    return result;
  }
  fetchHTTP(sourceId: string, address: string, path = '/', options: HTTPRequestOptions & ServiceOptions = {}): ServiceResult {
    const result = this.tcpRequest(sourceId, address, options.port??(options.secure?443:80), { application: 'http', secure:!!options.secure, path, method: options.method, headers: options.headers,body:options.body }, options); result.address = address; result.path = path; return result;
  }
  clearCrypto(deviceId: string,kind:'all'|'isakmp'|'ipsec'='all',peer?:string): void { this.cryptoServices.clear(deviceId,kind,peer); this.notify(); }
  sendCryptoPacket(deviceId: string, source: string, destination: string, protocol: string, body: any, size: number,vrf?:string): void { const d = this.getDevice(deviceId); if (!d) return; const p = this.makePacket(source, destination, protocol, size, body);p.vrf=vrf;if(body?.kind==='esp')p.parentId=body.inner?.id; if (protocol === 'udp') { p.sourcePort = 500; p.destinationPort = 500; } this.originate(d, p); }
  receiveDecryptedPacket(deviceId: string, port: string, packet: IPPacket,protection?:TunnelProtection): void { const d = this.getDevice(deviceId); if (d && this.interfaceUp(d.id, port)){if(packet.body?.kind==='gre')this.receiveGRE(d,packet,protection);else this.receiveIP(d, port, packet);} }
  dropCryptoPacket(deviceId: string, packet: IPPacket, reason: string): void { const d = this.getDevice(deviceId); if (!d) return; this.packetEvent(d, packet, 'IPsec drop', reason, 'drop'); const original = packet.body?.kind === 'gre' ? packet.body.inner : packet;if(!original)return; if (this.localInterface(d, original.source, original.vrf)) this.failLocal(d.id, original, reason); else this.icmpError(d, original, reason); }
  registerUDPService(port: number, accepts: (device: Device) => boolean, handler: (device: Device, payload: any, sourceAddress: string,destinationAddress:string) => Record<string, any>|undefined): () => void { const service = { accepts, handler }; this.udpServices.set(port, service); return () => { if (this.udpServices.get(port) === service) this.udpServices.delete(port); }; }
  /** A one-way datagram. Success means queued; receiver events establish delivery. */
  udpNotify(deviceId:string,address:string,port:number,payload:any,options:ServiceOptions={}):ServiceResult {
    const d=this.getDevice(deviceId);if(!d)throw Error('Unknown device');
    const result:ServiceResult={id:this.id('udp-notification'),status:'success',queued:true},source=this.serviceSource(d,address,options);
    if(source===undefined||!Number.isInteger(port)||port<1||port>65535)return Object.assign(result,{status:'failure',queued:false,error:'Invalid notification source or destination port'});
    const packet=this.makePacket(source,address,'udp',28+new TextEncoder().encode(JSON.stringify(payload)).length,{kind:'udp-service-notification',payload});
    packet.sourcePort=options.sourcePort??49152+this.hash(result.id)%16000;packet.destinationPort=port;packet.vrf=options.vrf;this.originate(d,packet);return result;
  }
  udpRequest(deviceId: string, address: string, port: number, payload: any, options: ServiceOptions = {}): ServiceResult {
    const d = this.getDevice(deviceId); if (!d) throw new Error('Unknown device'); const result = this.startService(d, 'udp',options.timeout), source = this.serviceSource(d, address, options); if (source === undefined) { this.finishService(result.id, undefined, 'Source address is not assigned to an operational interface in the selected VRF'); return result; } const packet = this.makePacket(source, address, 'udp', 28 + JSON.stringify(payload).length, { kind: 'udp-service-request', transaction: result.id, payload }); if (options.sourcePort !== undefined && (!Number.isInteger(options.sourcePort) || options.sourcePort < 1 || options.sourcePort > 65535)) { this.finishService(result.id, undefined, 'Source port must be 1–65535'); return result; } packet.sourcePort = options.sourcePort ?? 49152 + this.hash(result.id) % 16000; packet.destinationPort = port; packet.vrf = options.vrf; this.originate(d, packet); return result;
  }
  serviceSource(d: Device, target: string, options: ServiceOptions): string | undefined { if (!options.source) return ''; const port = d.config.interfaces[options.source] ? options.source : this.localInterface(d, options.source, options.vrf); if (!port || !this.interfaceUp(d.id, port) || (d.config.interfaces[port].vrf ?? '') !== (options.vrf ?? '')) return; const source = d.config.interfaces[options.source] ? this.addressFor(d, port, isIPv6(target) ? 6 : 4) : options.source; return source && isIPv6(source) === isIPv6(target) ? source : undefined; }
  registerTCPService(port: number, accepts: (device: Device) => boolean, handler: (device: Device, payload: any, sourceAddress: string, destinationAddress: string) => Record<string, any>): () => void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TCP port must be 1–65535');
    const entry = { accepts, handler }; this.tcpServices.set(port, entry); return () => { if (this.tcpServices.get(port) === entry) this.tcpServices.delete(port); };
  }
  registerTCPChannelService(port: number, accepts: (device: Device, peerAddress: string, localAddress: string, vrf?: string) => boolean | { ttl?: number; minimumTTL?: number }, onConnection: (channel: TCPChannel) => void): () => void { return this.tcpChannels.register(port, accepts, onConnection); }
  connectTCPChannel(sourceId: string, address: string, port: number, options: TCPChannelOptions = {}): TCPChannel { return this.tcpChannels.connect(sourceId, address, port, options); }
  sendTCPChannelPacket(deviceId: string, packet: IPPacket, scopedInterface?: string): void { const d = this.getDevice(deviceId); if (d) this.originate(d, packet, scopedInterface); }
  tcpRequest(sourceId: string, address: string, port: number, payload: any, options: ServiceOptions = {}): ServiceResult {
    const d = this.getDevice(sourceId); if (!d) throw new Error('Unknown device');
    const result = this.startService(d, 'tcp',options.timeout), source = this.serviceSource(d, address, options);
    if (source === undefined) { this.finishService(result.id, undefined, 'Source address is not assigned to an operational interface in the selected VRF'); return result; }
    if (!isIPv4(address) && !isIPv6(address)) { this.finishService(result.id, undefined, 'TCP requires a resolved IP address'); return result; }
    if(options.sourcePort!==undefined&&(!Number.isInteger(options.sourcePort)||options.sourcePort<1||options.sourcePort>65535)){this.finishService(result.id,undefined,'Source port must be 1–65535');return result;}
    const localPort = options.sourcePort??49152 + this.hash(result.id) % 16000;
    const conn = { localAddress:source,remoteAddress:address,localPort,remotePort:port,state: 'SYN-SENT', sourcePort: localPort, destination: address, destinationPort: port, payload: clone(payload), segments: {} as Record<number, string>, received: 0, expected: 0, requests: 0, retransmissions: 0 };
    (d.runtime.features.tcpConnections ??= {})[result.id] = conn;
    const packet = this.makePacket(source, address, 'tcp', 60, { kind: 'tcp-syn', transaction: result.id, mss:1024 }); packet.sourcePort = localPort; packet.destinationPort = port; packet.vrf = options.vrf;
    this.sendReliable(d, packet, () => conn.state !== 'SYN-SENT'||!this.serviceWait.has(result.id), conn); return result;
  }
  private sendReliable(d: Device, packet: IPPacket, done: () => boolean, stats?: any, attempt = 0): void {
    if (done() || !d.powered) return;
    if (attempt > 0) { if (stats) stats.retransmissions = (stats.retransmissions ?? 0) + 1; this.packetEvent(d, packet, 'Transport retransmission', 'Attempt ' + (attempt + 1) + ' after missing acknowledgement.', 'warning'); }
    this.originate(d, clone(packet));
    if (attempt < 5) this.clock.schedule(Math.min(2000, 500 * (2 ** Math.min(attempt, 2))), () => this.sendReliable(d, packet, done, stats, attempt + 1), { owner: d.id, label: packet.protocol + ' retransmission timeout' });
  }
  private replyPacket(incoming: IPPacket, body: any, size: number): IPPacket { const p = this.makePacket(incoming.destination, incoming.source, incoming.protocol, size, body); p.parentId = incoming.id; p.sourcePort = incoming.destinationPort; p.destinationPort = incoming.sourcePort; p.vrf = incoming.vrf; return p; }
  private httpPort(d:Device,port:number):boolean{const h=d.config.services.http??{};return !!(h.enabled&&port===(h.port??80)||h.secureEnabled&&port===(h.securePort??443));}
  private tcpAccepts(d: Device, port: number): boolean { return this.httpPort(d,port)||!!this.tcpServices.get(port)?.accepts(d); }
  private tcpApplication(d: Device, p: IPPacket): Record<string, any> {
    const payload = p.body.payload;
    if (this.httpPort(d,p.destinationPort!) && payload?.application === 'http') {const h=d.config.services.http??{},secure=p.destinationPort===(h.securePort??443)&&h.secureEnabled;if(!!payload.secure!==!!secure)return {error:'HTTP and HTTPS endpoint protocols do not match.'};if(h.acl&&!this.aclPermits(d.id,h.acl,p.source,p.destination,'tcp',{sourcePort:p.sourcePort,destinationPort:p.destinationPort}))return {statusCode:403,content:'<h1>403 — Forbidden by HTTP access-class</h1>',headers:{}};const modeled=this.modelDriven.handleHTTP(d,payload,p.source);if(modeled)return modeled;return handleHTTPRequest(d, payload, this.httpAuthenticator ? (list, username, password) => this.httpAuthenticator!(d.id, list, username, password) : undefined);}
    const service = this.tcpServices.get(p.destinationPort!); if (!service) return { error: 'Unsupported TCP application' };
    return service.handler(d, clone(payload), p.source, p.destination);
  }
  private tcpChunks(payload:any,mss=1024):string[]{const chunks:string[]=[],limit=Math.max(500,Math.min(1024,mss));let chunk='',bytes=0;for(const character of JSON.stringify(payload)){const length=new TextEncoder().encode(character).length;if(bytes+length>limit&&chunk){chunks.push(chunk);chunk='';bytes=0;}chunk+=character;bytes+=length;}chunks.push(chunk);return chunks;}
  private receiveTCP(d: Device, p: IPPacket): void {
    const b = p.body, key = b.transaction, table = d.runtime.features.tcpConnections ??= {};
    let conn = table[key];
    if (b.kind === 'tcp-syn') {
      if (!this.tcpAccepts(d, p.destinationPort!)) { this.serviceReply(d, p, { kind: 'tcp-rst', transaction: key }, 40); return; }
      if (!conn) conn = table[key] = {localAddress:p.destination,remoteAddress:p.source,localPort:p.destinationPort,remotePort:p.sourcePort,peerMss:Math.max(500,Math.min(1024,Number(b.mss)||1024)),state: 'SYN-RECEIVED', source: p.source, sourcePort: p.sourcePort, destinationPort: p.destinationPort, acknowledged: {} as Record<number, boolean>, retransmissions: 0 };
      if (conn.state === 'SYN-RECEIVED') this.sendReliable(d, this.replyPacket(p, { kind: 'tcp-syn-ack', transaction: key, mss:1024 }, 60), () => conn.state !== 'SYN-RECEIVED', conn);
      else this.serviceReply(d, p, { kind: 'tcp-syn-ack', transaction: key, mss:1024 }, 60);
    } else if (b.kind === 'tcp-syn-ack') {
      if (!conn || this.serviceWait.get(key)?.deviceId !== d.id) return;
      conn.peerMss=Math.max(500,Math.min(1024,Number(b.mss)||1024));conn.state = 'ESTABLISHED'; this.serviceReply(d, p, { kind: 'tcp-ack', transaction: key }, 40);
      if (!conn.requests++) {const chunks=this.tcpChunks(conn.payload,conn.peerMss);conn.requestAcks={};for(let index=0;index<chunks.length;index++){const request=this.replyPacket(p,{kind:'tcp-request-segment',transaction:key,index,total:chunks.length,data:chunks[index]},40+new TextEncoder().encode(chunks[index]).length);this.sendReliable(d,request,()=>!!conn.requestAcks[index]||conn.received>0||!this.serviceWait.has(key),conn);}}
    } else if (b.kind === 'tcp-ack') { if (conn) conn.state = 'ESTABLISHED'; }
    else if(b.kind==='tcp-request-ack'){if(conn)(conn.requestAcks??={})[b.index]=true;}
    else if(b.kind==='tcp-request-segment'){
      if(!conn||!Number.isInteger(b.index)||!Number.isInteger(b.total)||b.total<1||b.total>2048||b.index<0||b.index>=b.total||typeof b.data!=='string'||new TextEncoder().encode(b.data).length>1024)return;
      const incoming=conn.requestParts??={total:b.total,parts:{}};if(incoming.total!==b.total)return;incoming.parts[b.index]=b.data;this.serviceReply(d,p,{kind:'tcp-request-ack',transaction:key,index:b.index},40);
      if(Object.keys(incoming.parts).length===incoming.total){try{const payload=JSON.parse(Array.from({length:incoming.total},(_,index)=>incoming.parts[index]).join(''));this.receiveTCP(d,{...p,body:{kind:'tcp-request',transaction:key,payload}});}catch{this.serviceReply(d,p,{kind:'tcp-rst',transaction:key},40);}}
    }
    else if (b.kind === 'tcp-request') {
      if (!conn || conn.processing || !this.tcpAccepts(d, p.destinationPort!)) return;
      // A request carries the final handshake ACK, so loss of the separate ACK is harmless.
      conn.state = 'ESTABLISHED';
      if (!conn.response) { conn.processing = true; const pending = this.serviceWait.get(key); if (pending) this.clock.cancel(pending.timer); try { conn.response = this.tcpApplication(d, p); } catch (error) { conn.response = { error: error instanceof Error ? error.message : String(error) }; } finally { conn.processing = false; if (pending && this.serviceWait.has(key)) pending.timer = this.clock.schedule(10000, () => this.finishService(key, undefined, 'Service response timed out'), { label: 'TCP response timeout' }); } }
      const chunks=this.tcpChunks(conn.response,conn.peerMss);
      for (let index = 0; index < chunks.length; index++) { if (conn.acknowledged[index]) continue; const response = this.replyPacket(p, { kind: 'tcp-data', transaction: key, index, total: chunks.length, data: chunks[index] }, 40 + new TextEncoder().encode(chunks[index]).length); this.sendReliable(d, response, () => !!conn.acknowledged[index] || conn.state === 'CLOSED', conn); }
    } else if (b.kind === 'tcp-data') {
      if (!conn) return;
      this.serviceReply(d, p, { kind: 'tcp-data-ack', transaction: key, index: b.index }, 40);
      if (conn.segments[b.index] === undefined) { conn.segments[b.index] = b.data; conn.received++; } conn.expected = b.total;
      if (conn.received === conn.expected && this.serviceWait.get(key)?.deviceId === d.id) { try { const fields = JSON.parse(Array.from({ length: b.total }, (_, i) => conn.segments[i]).join('')); this.finishService(key, fields,typeof fields.error==='string'?fields.error:undefined); } catch { this.finishService(key, undefined, 'Invalid simulated TCP application response'); } conn.state = 'FIN-WAIT'; this.sendReliable(d, this.replyPacket(p, { kind: 'tcp-fin', transaction: key }, 40), () => conn.state === 'CLOSED', conn); }
    } else if (b.kind === 'tcp-data-ack') { if (conn) conn.acknowledged[b.index] = true; }
    else if (b.kind === 'tcp-fin') { if (conn) conn.state = 'CLOSED'; this.serviceReply(d, p, { kind: 'tcp-fin-ack', transaction: key }, 40); this.clock.schedule(30000, () => delete table[key], { owner: d.id, label: 'TCP TIME-WAIT cleanup' }); }
    else if (b.kind === 'tcp-fin-ack') { if (conn) conn.state = 'CLOSED'; this.clock.schedule(30000, () => delete table[key], { owner: d.id, label: 'TCP TIME-WAIT cleanup' }); }
    else if (b.kind === 'tcp-rst' && this.serviceWait.get(key)?.deviceId === d.id) { if (conn) conn.state = 'CLOSED'; this.finishService(key, undefined, 'Connection refused'); }
  }
  requestNTP(sourceId: string, address?: string, scheduled=false): ServiceResult {
    const d = this.getDevice(sourceId); if (!d) throw new Error('Unknown device'); const result = this.startService(d, 'ntp');
    const config = d.config.features.ntp ?? {}, servers: any[] = address ? [{ address }] : config.servers ?? [];
    if (!servers.length) { this.finishService(result.id, undefined, 'No NTP server configured'); return result; }
    const children: ServiceResult[] = [];
    for (const server of servers) {
      const prior=d.runtime.features.ntpAssociations?.[server.address], interval=(config.pollInterval??2**(server.minpoll??6))*1000;if(scheduled&&!address&&prior?.lastPoll!==undefined&&this.clock.now()-prior.lastPoll<interval)continue;
      const child = this.startService(d, 'ntp-peer'); children.push(child);
      const associations = d.runtime.features.ntpAssociations ??= {}, row = associations[server.address] ??= { address: server.address, reach: 0, valid: false }; row.prefer = !!server.prefer; row.configured = !address;row.poll=config.pollInterval??2**(server.minpoll??6);row.role=server.role||'server';row.version=server.version??4;row.key=server.key; row.lastPoll = this.clock.now(); row.reach = (row.reach << 1) & 255;
      const sourcePort = server.source ?? config.source, source = sourcePort ? d.config.interfaces[sourcePort]?.ip : '';
      if (sourcePort && (!source || !this.interfaceUp(d.id, sourcePort))) { row.valid = false; row.error = 'NTP source interface is unavailable'; this.finishService(child.id, undefined, row.error); continue; }
      const key=server.key!==undefined?config.keys?.[server.key]:undefined;
      if(server.key!==undefined&&!key){row.valid=false;row.error='NTP authentication key is undefined';this.finishService(child.id,undefined,row.error);continue;}
      const body:any={kind:'ntp-request',transaction:child.id,t1:this.clock.now()+(config.clockEpoch??d.config.features.clockEpoch??Date.UTC(2026,0,1))+(d.runtime.features.clockOffset??d.config.features.clockOffset??0),pollTime:this.clock.now(),version:server.version??4,keyId:server.key};
      if(key)body.authenticator=ntpAuthenticator(key.secret,body);
      const packet=this.makePacket(source??'',server.address,'udp',key?96:76,body);packet.vrf=server.vrf;packet.sourcePort=123;packet.destinationPort=123;this.originate(d,packet);
      if (!row.reach) row.valid = false;
    }
    this.selectNTP(d);
    this.clock.schedule(4000, () => { const successful = children.some(c => c.status === 'success'); this.finishService(result.id, d.runtime.features.ntp, successful ? undefined : children.find(c => c.error)?.error ?? 'No valid NTP peer responded'); }, { owner: d.id, label: 'NTP source selection' }); return result;
  }
  private selectNTP(d: Device): void {
    const config = d.config.features.ntp ?? {};
    const rows = Object.values(d.runtime.features.ntpAssociations ?? {}) as any[];
    for (const row of rows) if (row.configured && !(config.servers ?? []).some((server: any) => server.address === row.address)) { row.valid = false; row.error = 'NTP peer removed from configuration'; }
    for (const row of rows) { const server=(config.servers??[]).find((s:any)=>s.address===row.address), key=row.authKeyId===undefined?undefined:config.keys?.[row.authKeyId];if ((server?.key!==undefined&&(server.key!==row.authKeyId||!row.authenticated))||(row.authenticated&&(!key||ntpAuthenticator(key.secret,{kind:'identity'})!==row.authKeyFingerprint))||(config.authenticate&&(!row.authenticated||!config.trusted?.includes(row.authKeyId)))){row.valid=false;row.error='NTP authentication failed';} }
    for (const row of rows) if (row.lastReply !== undefined && this.clock.now() - row.lastReply >= Math.max(1,config.holdoverSeconds??(config.pollInterval??row.poll??64)*3)*1000) { row.valid = false; row.error = 'NTP peer expired'; }
    const eligible = rows.filter(r => r.valid && r.reach && r.stratum < 15 && !(r.referenceChain ?? []).includes(d.id)).sort((a, b) => Number(b.prefer) - Number(a.prefer) || a.stratum - b.stratum || a.delay - b.delay || a.address.localeCompare(b.address));
    const selected = eligible[0];
    if (!selected) { if(config.master!==undefined){d.runtime.features.clockSource='ntp';d.runtime.features.ntp={synchronized:true,localMaster:true,stratum:config.master,peer:'127.127.1.1',referenceChain:[d.id],offset:0,delay:0};return;}if(d.runtime.features.clockSource==='ntp')d.runtime.features.clockSource='unsynchronized NTP'; d.runtime.features.ntp = { synchronized: false, stratum: 16, referenceChain: [d.id], error: rows.find(r => r.error)?.error ?? 'No reachable NTP source' }; return; }
    if (selected.appliedAt !== selected.lastReply) { d.runtime.features.clockOffset = selected.targetOffset; selected.appliedAt = selected.lastReply; }
    d.runtime.features.clockSource='ntp';
    d.runtime.features.ntp = { synchronized: true, peer: selected.address, stratum: selected.stratum + 1, offset: selected.offset, delay: selected.delay, reach: selected.reach, lastSync: selected.lastReply, referenceChain: [d.id, ...(selected.referenceChain ?? [])] };
  }
  log(deviceId: string, message: string, severity = 6): void {
    const d = this.getDevice(deviceId); if (!d) return;
    const config = d.config.features.logging ?? {}, facility = config.facility ?? 23, time = this.clock.now(), entries = d.runtime.features.logEntries ??= [];
    if (config.enabled === false) return;
    const entry = { id: this.id('log'), time, message, severity, facility, sequence: d.runtime.features.logSequence = (d.runtime.features.logSequence ?? 0) + 1, remote: {enabled:config.trapEnabled!==false,level:config.trap??6,eligible:config.trapEnabled!==false&&severity<=(config.trap??6),hosts:[...(config.hosts??[])],source:config.source} };
    const sinks=d.runtime.features.logSinkCounts??={console:0,monitor:0,buffer:0,trap:0};
    if(config.console!==false&&severity<=(config.consoleLevel??(d.kind==='datacenter'?2:7)))sinks.console++;
    if(config.trapEnabled!==false&&severity<=(config.trap??6))sinks.trap++;
    entries.push(entry); if (entries.length > 500) entries.splice(0, entries.length - 500);
    bufferIOSMessage(d,entry);
    if (config.trapEnabled === false || severity > (config.trap ?? 6)) return;
    for (const address of config.hosts ?? []) {
      const iface = config.source ? d.config.interfaces[config.source] : undefined, source = config.source ? this.addressFor(d, config.source, isIPv6(address) ? 6 : 4) : '';
      if (config.source && (!source || !this.interfaceUp(d.id, config.source))) { this.emit({ nodeId: d.id, protocol: 'SYSLOG', label: 'Logging source unavailable', detail: 'The configured source interface has no operational address.', disposition: 'warning' }); continue; }
      const packet = this.makePacket(source ?? '', address, 'udp', 28 + new TextEncoder().encode(message).length, { kind: 'syslog-message', hostname: d.config.hostname, message, severity, facility, timestamp: time }); packet.vrf = iface?.vrf; packet.sourcePort = 514; packet.destinationPort = 514; this.originate(d, packet);
    }
  }
  exportNetFlow(deviceId: string, monitorName?: string, selectedKeys?:Set<string>): void {
    const d = this.getDevice(deviceId), monitor = monitorName && d?.config.features.flowMonitors?.[monitorName], config = monitor ? d?.config.features.flowExporters?.[monitor.exporter] : d?.config.features.netflow; if (!d || !config?.destination) return;
    const source = config.source ? d.config.interfaces[config.source]?.ip : ''; if (config.source && (!source || !this.interfaceUp(d.id, config.source))) return;
    const cache: any[] = monitorName ? d.runtime.features.flowMonitorCaches?.[monitorName] ?? [] : d.runtime.features.netflowCache ?? [];
    const records = cache.filter(r => (!selectedKeys||selectedKeys.has(r.key))&&r.packets > (r.exportedPackets ?? 0)).map(r => { const delta = { ...r, packets: r.packets - (r.exportedPackets ?? 0), bytes: r.bytes - (r.exportedBytes ?? 0) }; r.exportedPackets = r.packets; r.exportedBytes = r.bytes; delete delta.exportedPackets; delete delta.exportedBytes; delete delta.aging; return delta; });
    for (let start = 0; start < records.length; start += 20) { const chunk = clone(records.slice(start, start + 20)); const packet = this.makePacket(source ?? '', config.destination, 'udp', 52 + chunk.length * 48, { kind: 'netflow-export', monitor: monitorName, record: monitor?.record, version: config.version ?? 9, records: chunk, sequence: d.runtime.features.netflowSequence ?? 0 }); packet.sourcePort = 2055; packet.destinationPort = config.port ?? 2055; const stats=(d.runtime.features.flowExporterStats??={})[monitor?.exporter??'classic']??={packets:0,records:0,bytes:0};stats.packets++;stats.records+=chunk.length;stats.bytes+=packet.size;this.originate(d, packet); d.runtime.features.netflowSequence = (d.runtime.features.netflowSequence ?? 0) + ((config.version??9)===9?1:chunk.length); }
  }
  tftpGet(sourceId: string, address: string, filename: string): ServiceResult { return this.startTFTP(sourceId, address, filename); }
  tftpPut(sourceId: string, address: string, filename: string, content: string): ServiceResult { return this.startTFTP(sourceId, address, filename, content); }
  private startTFTP(sourceId: string, address: string, filename: string, content?: string): ServiceResult {
    const d = this.getDevice(sourceId); if (!d) throw new Error('Unknown device');
    const result = this.startService(d, 'tftp'); result.filename = filename;
    const transfers = d.runtime.features.tftpTransfers ??= {};
    transfers[result.id] = { mode: content === undefined ? 'receive' : 'send', filename, content: content ?? '', block: 0 };
    const packet = this.makePacket('', address, 'udp', 40 + filename.length, { kind: content === undefined ? 'tftp-read' : 'tftp-write', transaction: result.id, filename }); packet.sourcePort = 49152 + this.hash(result.id) % 16000; packet.destinationPort = 69; this.sendReliable(d, packet, () => !this.serviceWait.has(result.id) || !!transfers[result.id]?.started); return result;
  }
  private handleTFTP(d: Device, p: IPPacket): void {
    const b = p.body, transfers = d.runtime.features.tftpTransfers ??= {};
    const transaction = b.transaction;
    if (b.kind === 'tftp-read' || b.kind === 'tftp-write') {
      if (d.kind==='server' || !d.config.services.tftp?.enabled) { this.icmpError(d, p, 'Port unreachable'); return; }
      const files = d.config.services.tftp.files ??= {};
      if (b.kind === 'tftp-read' && typeof ownRecordValue(files,b.filename)!=='string') { this.serviceReply(d, p, { kind: 'tftp-error', transaction, error: 'File not found' }, 44); return; }
      transfers[transaction] ??= { mode: b.kind === 'tftp-read' ? 'send' : 'receive', filename: b.filename, content: b.kind === 'tftp-read' ? ownRecordValue(files,b.filename) : '', block: 0, server: true };
      if (b.kind === 'tftp-write') this.serviceReply(d, p, { kind: 'tftp-ack', transaction, block: transfers[transaction].block }, 32);
      else { if (!transfers[transaction].block) transfers[transaction].block = 1; this.sendTFTPBlock(d, p, transfers[transaction]); }
      return;
    }
    const transfer = transfers[transaction]; if (!transfer) return; transfer.started = true;
    if (b.kind === 'tftp-error') { if (this.serviceWait.get(transaction)?.deviceId === d.id) this.finishService(transaction, undefined, b.error); delete transfers[transaction]; return; }
    if (b.kind === 'tftp-data' && transfer.mode === 'receive') {
      if (b.block === transfer.block + 1) { transfer.content += b.data; transfer.block = b.block; }
      this.serviceReply(d, p, { kind: 'tftp-ack', transaction, block: transfer.block }, 32);
      if (b.data.length < 512 && b.block === transfer.block) {
        if (transfer.server) { setRecordValue(d.config.services.tftp.files,transfer.filename,transfer.content); }
        else this.finishService(transaction, { content: transfer.content, bytes: transfer.content.length });
        // Retain the final receive state so a retransmitted final DATA can still be acknowledged.
        this.clock.schedule(10000, () => delete transfers[transaction], { owner: d.id, label: 'TFTP completion cleanup' });
      }
    } else if (b.kind === 'tftp-ack' && transfer.mode === 'send' && b.block === transfer.block) {
      if (b.block > 0 && transfer.content.slice((b.block - 1) * 512, b.block * 512).length < 512) { if (!transfer.server) this.finishService(transaction, { bytes: transfer.content.length }); delete transfers[transaction]; return; }
      transfer.block++;
      this.sendTFTPBlock(d, p, transfer);
    }
  }
  private sendTFTPBlock(d: Device, incoming: IPPacket, transfer: any): void {
    const block = transfer.block, data = transfer.content.slice((block - 1) * 512, block * 512), transaction = incoming.body.transaction;
    const packet = this.replyPacket(incoming, { kind: 'tftp-data', transaction, block, data }, 32 + data.length);
    this.sendReliable(d, packet, () => !d.runtime.features.tftpTransfers?.[transaction] || transfer.block !== block);
  }
  private startService(d: Device, kind: string, timeout=10000): ServiceResult {
    const result: ServiceResult = { id: this.id(kind), status: 'running' }; const timer = this.clock.schedule(Number.isFinite(timeout)?Math.max(1,Math.min(Number.MAX_SAFE_INTEGER-this.clock.now(),timeout)):10000, () => this.finishService(result.id, undefined, 'Service request timed out'), { label: kind + ' timeout' }); this.serviceWait.set(result.id, { deviceId: d.id, result, timer }); return result;
  }
  cancelServiceRequest(id:string,reason='Service request cancelled'):boolean{if(!this.serviceWait.has(id))return false;this.finishService(id,undefined,reason);return true;}
  private finishService(id: string, fields?: Record<string, any>, error?: string): void { const pending = this.serviceWait.get(id); if (!pending) return; this.clock.cancel(pending.timer); this.serviceWait.delete(id); Object.assign(pending.result, fields ?? {}, { status: error ? 'failure' : 'success', ...(error ? { error } : {}) }); pending.callback?.(pending.result); this.notify(); }
  private serviceReply(d: Device, incoming: IPPacket, body: any, size: number): void { this.originate(d, this.replyPacket(incoming, body, size)); }
  private deliverService(d: Device, p: IPPacket, input?: string): void {
    const b = p.body; if (!b) return;
    if (b.kind === 'ike' || b.kind === 'esp') this.cryptoServices.receive(d, p,input);
    else if (b.kind === 'remote-span') {const matched=receiveRemoteSpan(this,d,p,input??'');const packet=this.packetSummary(p);packet.erspan.receiverIds=Object.values<any>(d.config.features.spanSessions??{}).filter(s=>s.type==='erspan-destination'&&!s.shutdown).map(s=>s.erspanId);this.emit({nodeId:d.id,port:input,protocol:'GRE',label:matched?'ERSPAN decapsulated':'ERSPAN session unmatched',detail:matched?'The matching ERSPAN destination session received this GRE copy.':'No enabled destination session matches the ERSPAN ID, local address and routing table.',disposition:matched?'info':'drop',packet});}
    else if (b.kind === 'control-plane') {if(!this.wireless.receiveDatagram(d,p))receiveControlDatagram(this, d.id, p.source, p.destination, b.payload, p.ttl, input);}
    else if(b.kind==='trace-probe'){
      const port=p.destinationPort,services=d.config.services,ntp=d.config.features.ntp??{};
      const open=this.udpServices.get(port!)?.accepts(d)||port===53&&services.dns?.enabled||port===123&&(services.ntp?.enabled||ntp.master!==undefined||ntp.servers?.length)||port===514&&services.syslog?.enabled||port===69&&d.kind!=='server'&&services.tftp?.enabled||port===67&&services.dhcp?.enabled||port===520&&d.config.protocols.rip||port===521&&d.config.protocols.ripng;
      this.packetEvent(d,p,'UDP probe delivered',open?'An active UDP listener received the probe; no application reply is assumed.':'The destination UDP port is closed.','receive',input);
      if(!open)this.icmpError(d,p,'Port unreachable',input);
    }
    else if (b.kind === 'udp-service-response') { if (this.serviceWait.get(b.transaction)?.deviceId === d.id) this.finishService(b.transaction, b.result, b.error); }
    else if (b.kind === 'udp-service-request'||b.kind==='udp-service-notification') { const service = this.udpServices.get(p.destinationPort!); if (!service?.accepts(d)) { this.icmpError(d, p, 'Port unreachable'); return; } try { const response=service.handler(d,b.payload,p.source,p.destination);if(b.kind==='udp-service-request'&&response!==undefined)this.serviceReply(d,p,{kind:'udp-service-response',transaction:b.transaction,result:response},128); } catch (error) { if(b.kind==='udp-service-request')this.serviceReply(d, p, { kind: 'udp-service-response', transaction: b.transaction, error: String(error) }, 64); } }
    else if (b.kind === 'ipv6-service') this.ipv6Services.receiveDatagram(d, p);
    else if (b.kind === 'gre') this.receiveGRE(d,p);
    else if (b.kind === 'dhcp-unicast') { const logical = this.localInterface(d, p.destination); if (logical) this.receiveDHCP(d, logical, undefined, undefined, b.message); }
    else if (b.kind === 'dhcp-relay') { const logical = this.localInterface(d, p.destination); if (logical) this.receiveDHCP(d, logical, undefined, undefined, b.message); }
    else if (b.kind.startsWith('tftp-')) this.handleTFTP(d, p);
    else if (b.kind === 'ntp-request') {
      const service=d.config.services.ntp,config=d.config.features.ntp??{},local=d.runtime.features.ntp;
      if(!service?.enabled&&config.master===undefined&&!local?.synchronized&&!config.servers?.length){this.icmpError(d,p,'Port unreachable');return;}
      const key=b.keyId!==undefined?config.keys?.[b.keyId]:undefined;
      if((b.keyId!==undefined&&(!key||ntpAuthenticator(key.secret,b)!==b.authenticator))||(config.authenticate&&(b.keyId===undefined||!config.trusted?.includes(b.keyId)))){this.packetEvent(d,p,'NTP authentication failed','The received NTP identity is not trusted or the modeled authenticator differs.','drop',input);return;}
      const time=this.clock.now()+(d.config.features.clockEpoch??Date.UTC(2026,0,1))+(d.runtime.features.clockOffset??d.config.features.clockOffset??0),stratum=local?.synchronized?local.stratum:config.master??(config.servers?.length?16:service?.stratum??8);
      const response={...b,kind:'ntp-response',t2:time,t3:time,stratum,referenceClock:local?.localMaster||config.master!==undefined&&!local?.synchronized?'127.127.1.1':local?.peer??'127.127.1.1',referenceChain:local?.synchronized?local.referenceChain:[d.id]};if(key)response.authenticator=ntpAuthenticator(key.secret,response);this.serviceReply(d,p,response,key?96:76);
    }
    else if (b.kind === 'ntp-response') {
      const pending = this.serviceWait.get(b.transaction); if (!pending || pending.deviceId !== d.id) return;
      const config = d.config.features.ntp ?? {}, t4 = this.clock.now() + (b.t1 - b.pollTime), offset = ((b.t2 - b.t1) + (b.t3 - t4)) / 2;
      const row = (d.runtime.features.ntpAssociations ??= {})[p.source] ??= { address: p.source, reach: 0 };
      const key=b.keyId!==undefined?config.keys?.[b.keyId]:undefined,authenticated=!!key&&b.authenticator===ntpAuthenticator(key.secret,b),required=(config.servers||[]).find((server:any)=>server.address===p.source)?.key;
      const authError=(required!==undefined&&(b.keyId!==required||!authenticated))||(config.authenticate&&(!authenticated||!config.trusted?.includes(b.keyId)));row.authenticated=authenticated;row.authKeyId=b.keyId;row.authKeyFingerprint=authenticated?ntpAuthenticator(key.secret,{kind:'identity'}):undefined;
      const loop = (b.referenceChain ?? []).includes(d.id), error = authError?'NTP authentication failed':loop ? 'NTP synchronization loop rejected' : b.stratum >= 15 ? 'NTP peer stratum is unsynchronized' : undefined;
      Object.assign(row, { reach: row.reach | 1, valid: !error, error, stratum: b.stratum, offset, targetOffset: b.t1 - b.pollTime - (d.config.features.clockEpoch??Date.UTC(2026,0,1)) + offset, delay: (t4 - b.t1) - (b.t3 - b.t2), lastReply: this.clock.now(), referenceChain: b.referenceChain ?? [], referenceClock:b.referenceClock }); this.selectNTP(d);
      const receivedAt = row.lastReply; this.clock.schedule(Math.max(1, config.holdoverSeconds ?? (config.pollInterval ?? row.poll ?? 64) * 3) * 1000, () => { if (row.lastReply === receivedAt) { this.selectNTP(d); this.notify(); } }, { owner: d.id, label: 'NTP peer validity' });
      this.finishService(b.transaction, { peer: p.source, stratum: b.stratum, offset, delay: row.delay }, error);
    }
    else if (b.kind === 'syslog-message') { if (!d.config.services.syslog?.enabled) { this.icmpError(d, p, 'Port unreachable'); return; } const logs = d.runtime.features.syslogReceived ??= []; logs.push({ packetId:p.id, source: p.source, hostname: b.hostname, message: b.message, severity: b.severity, facility: b.facility ?? 23, timestamp: b.timestamp, received: this.clock.now() }); if (logs.length > 500) logs.shift(); }
    else if (b.kind === 'netflow-export') { if (!d.config.services.netflow?.enabled || p.destinationPort !== (d.config.services.netflow.port??2055)) { this.icmpError(d, p, 'Port unreachable'); return; } const records = d.runtime.features.netflowReceived ??= []; records.push(...b.records.map((record: any) => ({ ...record, exporter: p.source, received: this.clock.now(), packetId:p.id, monitor:b.monitor, record:b.record, version:b.version, sequence:b.sequence, collectorPort:p.destinationPort }))); if (records.length > 2000) records.splice(0, records.length - 2000); }
    else if (b.kind === 'dns-query') {
      const dns=d.config.services.dns;if(!dns?.enabled||p.destinationPort!==53){this.icmpError(d,p,'Port unreachable');return;}
      let answer;try{answer=answerDNS(dns,b.hostname,b.type??'A',automaticDHCPDNSRecords(d,this.clock.now()));}catch{answer={hostname:dnsName(b.hostname),type:b.type??'A',records:[],ttl:0,rcode:'SERVFAIL',error:'SERVFAIL'};}
      const requests=d.runtime.features.dnsQueries??=[];requests.push({time:this.clock.now(),source:p.source,name:b.hostname,type:b.type??'A',rcode:answer.rcode,packetId:p.id,transaction:b.transaction,address:answer.address});if(requests.length>1000)requests.shift();
      this.serviceReply(d,p,{kind:'dns-response',transaction:b.transaction,...answer},80+JSON.stringify(answer.records).length);
    }
    else if (b.kind === 'dns-response') {
      const pending=this.serviceWait.get(b.transaction),name=pending?.result.hostname;
      if(pending?.deviceId!==d.id||!name||pending.result.server!==p.source||p.sourcePort!==53)return;
      const type=pending.result.type??'A',ttl=Math.max(0,Math.min(2147483647,Number(b.ttl??300))),cache=d.runtime.features.dnsCache??={};
      if(ttl>0&&b.rcode!=='SERVFAIL'){
        const row={address:b.address,error:b.error,records:b.records??[],type,rcode:b.rcode,created:this.clock.now(),expires:this.clock.now()+ttl*1000};
        setRecordValue(cache,dnsName(name)+'|'+type,row);
        const prior=ownRecordValue(cache,dnsName(name));if(b.rcode==='NXDOMAIN'||b.address&&(type==='A'||!prior||prior.expires<=this.clock.now()||!prior.address))setRecordValue(cache,dnsName(name),row);
      }
      this.finishService(b.transaction,{address:b.address,records:b.records??[],canonicalName:b.canonicalName,ttl,rcode:b.rcode},b.error);
    }
    else if (b.kind === 'tcp-channel') this.tcpChannels.receive(d, p, input);
    else if (b.kind.startsWith('tcp-')) this.receiveTCP(d, p);
    else this.icmpError(d, p, 'Port unreachable');
  }
  serialize(): LabDocument {
    const lab = clone({ ...this.lab, devices: this.lab.devices.map(d => ({ ...d, runtime: emptyRuntime() })) }); for (const d of lab.devices) { d.runtime = emptyRuntime(); for (const c of Object.values(d.config.interfaces)) delete c.features._secureMacs; }
    return { format: 'netsim-lab', version: 1, seed: this.seed, lab };
  }
  load(document: LabDocument | string): void {
    const parsed = typeof document === 'string' ? JSON.parse(document) : clone(document);
    if (parsed?.format !== 'netsim-lab' || parsed.version !== 1 || !parsed.lab || !Array.isArray(parsed.lab.devices) || !Array.isArray(parsed.lab.links) || !Array.isArray(parsed.lab.notes)) throw new Error('This is not a supported NetworkSim lab document');
    if (parsed.lab.devices.length > 500 || parsed.lab.links.length > 2000) throw new Error('Lab exceeds simulator limits');
    const ids = new Set<string>();
    for (const d of parsed.lab.devices) {
      if (!d.id || ids.has(d.id) || !['router','switch','poeswitch','l3switch','datacenter','pc','server','wlc','ap','laptop','phone'].includes(d.kind) || !d.config?.interfaces || !d.config?.vlans || !Array.isArray(d.config.staticRoutes) || !d.config.protocols || !d.config.services || !d.config.features) throw new Error('Invalid or duplicate device');
      ids.add(d.id);
      for (const [port,c] of Object.entries(d.config.interfaces) as [string,InterfaceConfig][]) {
        if(!port||!c||!Array.isArray(c.ipv6)||!c.features||!Number.isFinite(c.mtu)||!Number.isFinite(c.speed)||c.features.speedAuto!==undefined&&typeof c.features.speedAuto!=='boolean'||c.ip&&!isIPv4(c.ip))throw new Error('Invalid interface configuration');
      }
      validateFTPConfiguration(d.config);validateHostOS(d.kind,d.config);validateEndpoint(d.kind,d.config);validatePhone(d.kind,d.config);validatePoE(d.kind,d.config);validateWireless(d.kind,d.config.features.wireless);
      if(d.startupConfig){
        for(const c of Object.values(d.startupConfig.interfaces) as InterfaceConfig[])if(c.features.speedAuto!==undefined&&typeof c.features.speedAuto!=='boolean')throw Error('Invalid saved Ethernet autonegotiation setting');
        validateWireless(d.kind,d.startupConfig.features.wireless);validateFTPConfiguration(d.startupConfig);validateHostOS(d.kind,d.startupConfig);validateEndpoint(d.kind,d.startupConfig);validatePhone(d.kind,d.startupConfig);validatePoE(d.kind,d.startupConfig);
      }
      d.runtime=emptyRuntime();d.runtime.features.bootTime=this.clock.now();
    }
    for(const device of parsed.lab.devices){validateSLAConfiguration(device.config);validateTunnelConfiguration(device.config);validateNSOSConfiguration(device.config,device.kind);if(device.startupConfig){validateSLAConfiguration(device.startupConfig);validateTunnelConfiguration(device.startupConfig);validateNSOSConfiguration(device.startupConfig,device.kind);}}
    const occupied = new Set<string>();
    for (const link of parsed.lab.links) { if (!link?.a || !link?.b || !Number.isFinite(link.delay) || !Number.isFinite(link.loss)) throw new Error('Invalid link'); for (const e of [link.a, link.b]) { const d = parsed.lab.devices.find((x: Device) => x.id === e.deviceId); const key = e.deviceId + '|' + e.port; if (!d?.config.interfaces[e.port] || occupied.has(key)) throw new Error('Invalid or occupied cable endpoint'); occupied.add(key); } }
    this.lab = parsed.lab; this.seed = Number.isInteger(parsed.seed) ? parsed.seed >>> 0 || 1 : this.seed; this.clock = new SimulationClock(this.seed);
    for (const id of [...this.lab.devices.map(d => d.id), ...this.lab.links.map(l => l.id), ...this.lab.notes.map(n => n.id)]) { const suffix = /-([0-9a-z]+)$/.exec(id)?.[1]; if (suffix) { const value=[...suffix].reduce((n,c)=>n*36n+BigInt(parseInt(c,36)),0n);if(value>this.sequence)this.sequence=value; } }
    this.resetRuntime();
  }
  restartEndpointInterface(deviceId:string):void {
    const d=this.getDevice(deviceId);if(!d||d.kind!=='pc')return;const ports=Object.values(d.config.interfaces).filter(p=>/^GigabitEthernet/.test(p.name)),states=ports.map(p=>p.adminUp);
    try{for(const p of ports)p.adminUp=false;this.recompute();}finally{ports.forEach((p,i)=>p.adminUp=states[i]);}this.changed();
  }
  endpointPolicyChanged(deviceId:string):void {
    const d=this.getDevice(deviceId);if(!d||endpointProfile(d).role!=='phone')return;
    for(const[key,result]of this.dhcpWait)if(result.deviceId===d.id){result.status='failure';result.error='Received voice VLAN policy changed';this.dhcpWait.delete(key);}
    for(const[key,row]of this.pendingArp)if(row.deviceId===d.id)this.pendingArp.delete(key);
    this.tcpChannels.closeDevice(d.id);this.ipv6Services.clearDevice(d.id);this.resetAutomaticAddresses(d);d.runtime.arp={};delete d.runtime.features.dhcpClientLeases;delete d.runtime.features.dhcpAddressChecks;delete d.runtime.features.dhcpv6Leases;this.changed();this.startAutomaticClients(d);
  }
  private resetAutomaticAddresses(d: Device): void {
    for (const c of Object.values(d.config.interfaces)) {
      if (c.features.dhcp) { const lease = c.features.dhcpLease; if (!lease || c.ip === lease.address) { delete c.ip; delete c.mask; } if (!lease || d.config.defaultGateway === lease.gateway) delete d.config.defaultGateway; if (c.features.windowsDNSMode!=='static'&&lease && JSON.stringify(d.config.dnsServers) === JSON.stringify(lease.dns)) d.config.dnsServers = []; delete c.features.leaseExpires; delete c.features.dhcpLease; }
      const v6 = c.features.dhcpv6Lease; if (v6) { c.ipv6 = c.ipv6.filter(value => !sameAddress(value.split('/')[0], v6.address ?? '')); if (v6.delegationName) delete d.config.features.delegatedPrefixes?.[v6.delegationName]; delete c.features.dhcpv6Lease; }
      if (c.features.slaacAddresses) { c.ipv6 = c.ipv6.filter(value => !c.features.slaacAddresses.some((address: string) => sameAddress(value.split('/')[0], address))); delete c.features.slaacAddresses; }
    }
    d.config.staticRoutes = d.config.staticRoutes.filter(r => !(r as any).autoconfig);
  }
  private startAutomaticClients(d: Device): void {
    if (!d.powered) return;
    const runtime=d.runtime,generation=runtime.features.automaticClientGeneration=(runtime.features.automaticClientGeneration??0)+1;
    for (const [port, c] of Object.entries(d.config.interfaces)) {
      let dhcpRequest: ServiceResult | undefined;
      const retry = () => {
        if (!d.powered||d.runtime!==runtime||runtime.features.automaticClientGeneration!==generation) return;
        if (runtime.features.dhcpReleased?.[port] && !c.features.dhcpv6Client?.stateful && !c.features.ipv6Autoconfig) return;
        if (c.features.dhcp && !runtime.features.dhcpReleased?.[port] && !c.ip && dhcpRequest?.status !== 'success' && !d.runtime.features.dhcpClientLeases?.[port] && this.interfaceUp(d.id, port)) dhcpRequest = this.requestDHCP(d.id, port, false);
        if (c.features.dhcpv6Client?.stateful && !d.runtime.features.dhcpv6Leases?.[port] && this.interfaceUp(d.id, port)) this.requestDHCPv6(d.id, port, c.features.dhcpv6Client.prefixDelegationName);
        if (c.features.ipv6Autoconfig && !c.features.slaacAddresses?.length && this.interfaceUp(d.id, port)) this.requestIPv6(d.id, port);
        if ((c.features.dhcp && !runtime.features.dhcpReleased?.[port] && !c.ip && dhcpRequest?.status !== 'success' && !d.runtime.features.dhcpClientLeases?.[port]) || (c.features.dhcpv6Client?.stateful && !d.runtime.features.dhcpv6Leases?.[port]) || (c.features.ipv6Autoconfig && !c.features.slaacAddresses?.length)) this.clock.schedule(5000, retry, { owner: d.id, label: 'Automatic host configuration retry' });
      };
      if (c.features.dhcp || c.features.dhcpv6Client?.stateful || c.features.ipv6Autoconfig) this.clock.schedule(1, retry, { owner: d.id, label: 'Automatic host configuration after boot' });
    }
  }
  resetRuntime(): void {
    this.clock.reset(); this.wireless.reset(); this.events = []; this.pendingArp.clear(); this.pendingTunnels.clear(); this.probes.clear(); this.fragments.clear(); this.wireAvailable.clear(); this.wireTransmissions.clear(); this.egressQueues.reset(); this.serviceWait.clear(); this.dhcpWait.clear(); this.ipv6Services.reset(); this.cryptoServices.reset(); this.tcpChannels.reset();
    for (const d of this.lab.devices) { d.runtime = emptyRuntime();d.runtime.features.bootTime=this.clock.now(); this.resetAutomaticAddresses(d); } this.changed(); for (const d of this.lab.devices) this.startAutomaticClients(d);
  }
}
