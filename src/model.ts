import {defaultWireless} from './wireless-model.ts';
/** Original browser-local network simulation domain contract. */
export type DeviceKind = 'router' | 'switch' | 'poeswitch' | 'l3switch' | 'datacenter' | 'pc' | 'server' | 'wlc' | 'ap' | 'laptop' | 'phone';
export type SwitchportMode = 'access' | 'trunk' | 'dynamic-auto' | 'dynamic-desirable';
export type Disposition = 'info' | 'send' | 'receive' | 'forward' | 'drop' | 'success' | 'warning';

export interface InterfaceConfig {
  name: string;
  adminUp: boolean;
  description: string;
  ip?: string;
  mask?: string;
  ipv6: string[];
  switchport: boolean;
  mode: SwitchportMode;
  vlan: number;
  nativeVlan: number;
  allowedVlans: number[] | null;
  mtu: number;
  speed: number;
  duplex: 'auto' | 'full' | 'half';
  vrf?: string;
  features: Record<string, any>;
}

export interface VlanConfig { id: number; name: string; active: boolean }
export interface StaticRoute {
  network: string;
  prefix: number;
  nextHop?: string;
  interface?: string;
  ad?: number;
  metric?: number;
  share?: number;
  global?: boolean;
  permanent?: boolean;
  track?: number;
  vrf?: string;
  name?: string;
  tag?: number;
}
export interface Route {
  /** Local host-mode forwarding through ip default-gateway; not an installed routed default. */
  management?: boolean;
  network: string;
  prefix: number;
  nextHop?: string;
  interface: string;
  protocol: string;
  ad: number;
  metric: number;
  vrf?: string;
  learnedFrom?: string;
  tag?: number;
  area?: string;
  asPath?: number[];
  loadShare?: boolean;
  share?: number;
  global?: boolean;
  permanent?: boolean;
  track?: number;
  candidateDefault?: boolean;
}
export interface DeviceConfig {
  hostname: string;
  interfaces: Record<string, InterfaceConfig>;
  vlans: Record<number, VlanConfig>;
  ipRouting: boolean;
  ipv6Routing: boolean;
  defaultGateway?: string;
  dnsServers: string[];
  staticRoutes: StaticRoute[];
  protocols: Record<string, any>;
  services: Record<string, any>;
  features: Record<string, any>;
}
export interface ArpEntry { ip: string; mac: string; port: string; vlan?: number; vrf?: string; expires: number; static?: boolean; reachableUntil?:number }
export interface MacEntry { mac: string; port: string; vlan: number; expires: number; lastSeen?:number; static?: boolean; secure?: boolean }
export interface Neighbor { protocol: string; deviceId: string; interface: string; peerInterface?: string; address?: string; state: string; [key: string]: any }
export interface PortCounters { tx: number; rx: number; drops: number; txBytes: number; rxBytes: number; txUnicast?: number; txMulticast?: number; txBroadcast?: number; rxUnicast?: number; rxMulticast?: number; rxBroadcast?: number; inputErrors?: number; crc?: number; collisions?: number; lateCollisions?: number; outputErrors?: number; lastInput?: number; lastOutput?: number; rateSamples?:{at:number;rx:number;tx:number;rxBytes:number;txBytes:number}[] }
export interface StpPortState { state: 'forwarding' | 'blocking' | 'discarding' | 'learning' | 'listening' | 'disabled'; role?: string; rootId?: string; cost?: number; [key: string]: any }
export interface StpVlanState { rootId: string; ports: Record<string, StpPortState>; [key: string]: any }
export interface DeviceRuntime {
  routes: Route[];
  arp: Record<string, ArpEntry>;
  mac: Record<string, MacEntry>;
  neighbors: Neighbor[];
  stp: Record<string, StpVlanState>;
  counters: Record<string, PortCounters>;
  logs: string[];
  features: Record<string, any>;
}
export interface Device {
  id: string;
  kind: DeviceKind;
  x: number;
  y: number;
  powered: boolean;
  config: DeviceConfig;
  runtime: DeviceRuntime;
  startupConfig?: DeviceConfig;
  /** NX-OS sticky bindings persist separately from startup configuration. */
  secureSticky?: Record<string,string[]>;
  configurationRegister?: { current: number; next: number };
}
export interface Endpoint { deviceId: string; port: string }
export interface Link { id: string; a: Endpoint; b: Endpoint; enabled: boolean; delay: number; loss: number; lossAB?: number; lossBA?: number; physical?:import('./link-medium.ts').LinkMedium }
export interface Note { id: string; x: number; y: number; text: string; locked?: boolean }
export interface Lab { id: string; name: string; devices: Device[]; links: Link[]; notes: Note[] }
export interface PacketSummary {
  id: string;
  vrf?: string;
  parentId?: string;
  source: string;
  destination: string;
  protocol: string;
  ttl?: number;
  size?: number;
  vlan?: number;
  sourceMac?: string;
  destinationMac?: string;
  [key: string]: any;
}
export interface SimEvent {
  id: string;
  time: number;
  nodeId: string;
  peerId?: string;
  port?: string;
  protocol: string;
  label: string;
  detail: string;
  disposition: Disposition;
  packet?: PacketSummary;
}
export type NewSimEvent = Omit<SimEvent, 'id' | 'time'>;
export interface PingOptions { count?: number; size?: number; df?: boolean; ttl?: number; timeout?: number; interval?: number; source?: string; interface?: string; vrf?: string; tos?: number; dataPattern?: string; validateData?: boolean }
export interface ProbeReply { sequence: number; from?: string; ttl?: number; time?: number; error?: string }
export interface PingResult { id: string; sourceId: string; target: string; status: 'running' | 'success' | 'failure'; sent: number; received: number; replies: ProbeReply[] }
export interface TraceHop { ttl: number; address?: string; time?: number; error?: string; reached: boolean }
export interface TraceResult { id: string; sourceId: string; target: string; status: 'running' | 'success' | 'failure'; hops: TraceHop[] }
export interface LabDocument { format: 'netsim-lab'; version: 1; seed: number; lab: Lab }

export function emptyRuntime(): DeviceRuntime {
  return { routes: [], arp: {}, mac: {}, neighbors: [], stp: {}, counters: {}, logs: [], features: {} };
}
export function defaultInterface(name: string, switchport = false): InterfaceConfig {
  return { name, adminUp: true, description: '', ipv6: [], switchport, mode: 'access', vlan: 1, nativeVlan: 1, allowedVlans: null, mtu: /^Tunnel/i.test(name) ? 1476 : 1500, speed: 1000, duplex: 'auto', features: {} };
}

export function factoryDeviceConfig(kind: DeviceKind, hostname: string): DeviceConfig {
  if (kind === 'datacenter') {
    const interfaces: Record<string, InterfaceConfig> = {};
    for (let n = 1; n <= 30; n++) {
      const p = interfaces[`Ethernet1/${n}`] = defaultInterface(`Ethernet1/${n}`, true);
      p.features.nsosAdminExplicit = false;
      p.speed = n <= 24 ? 10000 : 40000;
      p.features.ethernetSpeeds = n <= 24 ? [1000, 10000] : [1000, 10000, 40000];
      p.features.speedAuto = true;
      p.features.nonegotiate = true;
    }
    const management = interfaces.mgmt0 = defaultInterface('mgmt0');
    management.vrf = 'management';
    management.features.ethernetSpeeds = [10, 100, 1000];
    management.features.speedAuto = true;
    management.features.proxyArp = false;
    return {hostname, interfaces, vlans: {1: {id: 1, name: 'default', active: true}}, ipRouting: true, ipv6Routing: false,
      dnsServers: [], staticRoutes: [], protocols: {}, services: {},
      features: {logging:{consoleLevel:2,monitorLevel:5,bufferedLevel:5}, nsos: {enabled: ['ssh']}, ssh: {keys: true, version: 2}, lines: {'vty 0 15': {login: 'local', transport: 'ssh', exec: true}}, vrfs: {management: {}}, stp: {mode: 'rapid-pvst',pathcostMethod:'short'}, cdp: true,
        vtp: {domain: '', mode: 'transparent', version: 1, revision: 0, enabled: false}}};
  }
  const switchport = kind === 'switch' || kind === 'poeswitch' || kind === 'l3switch', interfaces: Record<string, InterfaceConfig> = {};
  const ports = switchport ? [...Array.from({ length: 24 }, (_, i) => 'GigabitEthernet0/' + (i + 1)), 'GigabitEthernet1/1', 'GigabitEthernet1/2'] : kind === 'router' ? Array.from({ length: 4 }, (_, i) => 'GigabitEthernet0/' + i) : kind==='wlc'?['GigabitEthernet1']:kind==='laptop'?['Wireless0']:kind==='phone'?['Network','PC']:['GigabitEthernet0'];
  for (const port of ports) { interfaces[port] = defaultInterface(port, switchport); interfaces[port].adminUp = kind !== 'router'; }
  const features:Record<string,any>={};if(switchport)features.vtp={domain:'',mode:'server',version:1,revision:0};if(kind==='ap'||kind==='phone')features.powerSource='poe';if(kind==='poeswitch')features.poe={budget:370};if(['wlc','ap','laptop'].includes(kind))features.wireless=defaultWireless(kind==='wlc'?'c9800-17.12':kind==='ap'?'c9115-lightweight':'generic-dual-band');if(kind==='pc'||kind==='ap'||kind==='laptop'||kind==='phone')interfaces[kind==='laptop'?'Wireless0':kind==='phone'?'Network':'GigabitEthernet0'].features.dhcp=true;
  if(kind==='phone'){interfaces.Network.description='Network uplink · PoE input and voice traffic';interfaces.PC.description='PC passthrough · untagged data only';}
  return { hostname, interfaces, vlans: { 1: { id: 1, name: 'default', active: true } }, ipRouting: kind === 'router', ipv6Routing: false, dnsServers: [], staticRoutes: [], protocols: {}, services: {}, features };
}
