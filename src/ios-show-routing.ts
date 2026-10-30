import {activeIOSOSPFRouterId} from './ospf-router-id.ts';
/**
 * Cisco IOS (IOSv 15.9) presentation of routing-protocol show commands: OSPF, EIGRP, BGP, RIP,
 * "show ip protocols" and the first-hop redundancy protocols. Values come from simulator state;
 * fields IOS prints that the simulator does not model use the IOS idle-lab defaults.
 */
import type { Simulator } from './engine.ts';
import type { Device, InterfaceConfig } from './model.ts';
import { interfaceBandwidth } from './ethernet.ts';
import { intToIp, ipToInt, isIPv4, isIPv6, maskToPrefix, parseCidr, prefixContains, prefixToMask, sameAddress } from './ip.ts';
import { ospfLiveDetail, type OSPFLink, type OSPFPrefix } from './ospf-packets.ts';
import { dualOwnDistance } from './control-plane.ts';
import { routingConfig } from './routing-scope.ts';
import { displayCommunity } from './bgp-policy.ts';
import { bgpAddressFamily } from './bgp-compat.ts';
import { resolveForwardingPaths } from './route-resolver.ts';

class RoutingShowError extends Error {}
const INVALID = "% Invalid input detected at '^' marker.";
const invalid = (): never => { throw new RoutingShowError(INVALID); };
const incomplete = (): never => { throw new RoutingShowError('% Incomplete command.'); };
function guard(render: () => string[] | undefined): string[] | undefined {
  try { return render(); } catch (error) { if (error instanceof RoutingShowError) return [error.message]; throw error; }
}
function word(value: string | undefined, choices: string[]): string {
  if (!value) return incomplete();
  const lower = value.toLowerCase();
  if (choices.includes(lower)) return lower;
  const matches = choices.filter(choice => choice.startsWith(lower));
  if (matches.length > 1) throw new RoutingShowError(`% Ambiguous command: "${value}"`);
  return matches[0] ?? invalid();
}
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const ports = (d: Device) => Object.values(d.config.interfaces).sort((a, b) => natural(a.name, b.name));
const ipNumber = (ip: string) => isIPv4(ip) ? ipToInt(ip) : 0;
const byIp = (a: string, b: string) => ipNumber(a) - ipNumber(b);
const pad = (value: unknown, width: number) => String(value).padEnd(width);
const lpad = (value: unknown, width: number) => String(value).padStart(width);
export function shortInterfaceName(name: string): string {
  return name.replace(/^GigabitEthernet/i, 'Gi').replace(/^FastEthernet/i, 'Fa').replace(/^TenGigabitEthernet/i, 'Te').replace(/^Port-channel/i, 'Po').replace(/^Loopback/i, 'Lo').replace(/^Tunnel/i, 'Tu').replace(/^Ethernet/i, 'Et').replace(/^Vlan/i, 'Vl').replace(/^Serial/i, 'Se');
}
function portName(d: Device, value?: string): string {
  if (!value) return incomplete();
  const input = value.toLowerCase(), names = ports(d).map(p => p.name);
  const exact = names.find(name => name.toLowerCase() === input || shortInterfaceName(name).toLowerCase() === input);
  if (exact) return exact;
  const parts = /^([a-z-]+)(\d.*)$/i.exec(value);
  const matches = names.filter(name => { const full = /^([a-z-]+)(\d.*)$/i.exec(name); return parts && full ? full[1].toLowerCase().startsWith(parts[1].toLowerCase()) && full[2] === parts[2] : false; });
  if (matches.length > 1) throw new RoutingShowError(`% Ambiguous command: "${value}"`);
  return matches[0] ?? invalid();
}
function takePort(d: Device, args: string[]): string {
  let value = args.shift();
  if (value && /^[a-z-]+$/i.test(value) && /^\d/.test(args[0] ?? '')) value += args.shift();
  return portName(d, value);
}
/** hh:mm:ss */
function hms(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
/** hh:mm:ss.mmm */
function hmsMillis(milliseconds: number): string { const ms = Math.max(0, Math.floor(milliseconds)); return `${hms(ms)}.${String(ms % 1000).padStart(3, '0')}`; }
/** IOS uptime: 00:01:02, 1d02h, 2w3d, 1y4w */
function uptime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 86400) return hms(seconds * 1000);
  const days = Math.floor(seconds / 86400);
  if (days < 7) return `${days}d${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}h`;
  const weeks = Math.floor(days / 7);
  return weeks < 52 ? `${weeks}w${days % 7}d` : `${Math.floor(weeks / 52)}y${weeks % 52}w`;
}
/** Deterministic 16-bit value for LSA checksums and other unmodeled per-object constants. */
function fold16(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 16) ^ h) & 0xffff || 0x1d2b;
}
const hex = (value: number, digits: number) => value.toString(16).toUpperCase().padStart(digits, '0');
function classfulPrefix(ip: string): number { const first = Number(ip.split('.')[0]); return first < 128 ? 8 : first < 192 ? 16 : first < 224 ? 24 : 32; }
const wildcard = (prefix: number) => intToIp((~ipToInt(prefixToMask(prefix))) >>> 0);
function interfaceState(e: Simulator, d: Device, p: InterfaceConfig) {
  const up = e.interfaceUp(d.id, p.name);
  return { status: !p.adminUp ? 'administratively down' : p.features.errDisabled ? 'down' : up ? 'up' : 'down', protocol: up ? 'up' : 'down', up };
}
function highestRouterId(d: Device, protocol: string): string {
  return (protocol==='ospf'?activeIOSOSPFRouterId(d):undefined) || routingConfig(d, protocol)?.routerId || ports(d).filter(p => p.ip && !p.vrf).sort((a, b) => Number(/^Loopback/i.test(b.name)) - Number(/^Loopback/i.test(a.name)) || ipToInt(b.ip!) - ipToInt(a.ip!))[0]?.ip || '0.0.0.0';
}
function filterName(entry: any): string { return entry.acl ?? entry.prefixList ?? entry.routeMap ?? entry.name ?? ''; }
function updateFilterLines(config: any, indent = '  '): string[] {
  const lists: any[] = config?.distributeLists ?? [];
  const global = (direction: string) => lists.find(l => l.direction === direction && !l.interface && !l.protocol);
  const lines: string[] = [];
  for (const [direction, label] of [['out', 'Outgoing'], ['in', 'Incoming']]) {
    const g = global(direction);
    lines.push(`${indent}${label} update filter list for all interfaces is ${g ? filterName(g) : 'not set'}`);
    for (const l of lists.filter(l => l.direction === direction && l.interface)) lines.push(`${indent}  ${l.interface} filtered by ${filterName(l)}`);
    for (const l of lists.filter(l => l.direction === direction && l.protocol && !l.interface)) lines.push(`${indent}  Redistributed ${l.protocol} filtered by ${filterName(l)}`);
  }
  return lines;
}

// ---------------------------------------------------------------- OSPF

type OspfProtocol = 'ospf' | 'ospfv3' | 'ospfv3ipv4';
interface OspfPort {
  iface: InterfaceConfig; name: string; address: string; prefix: number; area: string; areaLabel: string; viaInterface: boolean;
  status: string; protocolUp: boolean; up: boolean; loopback: boolean; passive: boolean; cost: number; hello: number; dead: number;
  networkType: string; p2p: boolean; priority: number; state?: any;
}
interface OspfView {
  e: Simulator; d: Device; protocol: OspfProtocol; config: any; v3: boolean; pid: number; rid: string; now: number;
  live: ReturnType<typeof ospfLiveDetail>; ports: OspfPort[]; neighbors: NonNullable<ReturnType<typeof ospfLiveDetail>>['neighbors'];
}
const areaKey = (area: unknown) => { const text = String(area ?? 0); return text.includes('.') && isIPv4(text) ? String(ipToInt(text)) : String(Number(text)); };
function areaConfig(config: any, key: string): any { for (const [id, value] of Object.entries(config?.areas ?? {})) if (areaKey(id) === key) return value; return undefined; }
function ospfPorts(e: Simulator, d: Device, protocol: OspfProtocol, config: any): OspfPort[] {
  const v3 = protocol !== 'ospf', states = d.runtime.features[protocol + 'Interfaces'] ?? {}, result: OspfPort[] = [];
  const passiveList: string[] = config.passiveInterfaces ?? [];
  for (const p of ports(d)) {
    if (p.vrf) continue;
    const f = p.features[protocol] ?? {};
    let address: string | undefined, prefix = 0, area: string | undefined, viaInterface = false;
    if (v3) {
      if (f.area === undefined) continue;
      address = d.runtime.features.linkLocalAddresses?.[p.name] ?? p.ipv6?.[0]?.split('/')[0];
      if (!address) continue;
      prefix = 64; area = String(f.area); viaInterface = true;
    } else {
      if (!p.ip || !p.mask) continue;
      address = p.ip; prefix = maskToPrefix(p.mask);
      if (f.area !== undefined) { area = String(f.area); viaInterface = true; }
      else area = (config.networks ?? []).find((n: any) => n.area !== undefined && prefixContains(n.network, Number(n.prefix), p.ip!))?.area;
      if (area === undefined) continue;
    }
    const live = interfaceState(e, d, p), loopback = /^Loopback/i.test(p.name);
    const networkType = String(f.networkType ?? f.network ?? (loopback ? 'loopback' : /^(Serial|Tunnel)/i.test(p.name) ? 'point-to-point' : 'broadcast')).toLowerCase();
    const slow = networkType.includes('non-broadcast') || networkType.startsWith('point-to-multipoint');
    const bandwidthMbps = Math.max(interfaceBandwidth(d, p) / 1000, 0.001);
    const cost = Math.max(1, Math.min(65535, Number(f.cost ?? Math.floor(Number(config.referenceBandwidth ?? 100) / bandwidthMbps))));
    const passive = passiveList.includes(p.name) || (passiveList.includes('default') || !!config.passiveDefault) && !(config.activeInterfaces ?? []).includes(p.name);
    result.push({
      iface: p, name: p.name, address, prefix, area: areaKey(area), areaLabel: String(area), viaInterface, status: live.status, protocolUp: live.protocol === 'up', up: live.up,
      loopback, passive, cost: loopback ? 1 : cost, hello: Number(f.helloInterval ?? (slow ? 30 : 10)), dead: Number(f.deadInterval ?? (slow ? 120 : 40)), networkType,
      p2p: networkType === 'point-to-point' || states[p.name]?.role === 'POINT-TO-POINT', priority: Number(f.priority ?? 1), state: states[p.name],
    });
  }
  return result;
}
function ospfView(e: Simulator, d: Device, protocol: OspfProtocol, config: any): OspfView {
  const live = ospfLiveDetail(e, d.id, protocol);
  const rid = (protocol==='ospf'?activeIOSOSPFRouterId(d,config):undefined) ?? live?.interfaces[0]?.routerId ?? config.routerId ?? highestRouterId(d, protocol === 'ospf' ? 'ospf' : protocol);
  return { e, d, protocol, config, v3: protocol !== 'ospf', pid: Number(config.processId ?? 1), rid, now: e.clock.now(), live, ports: ospfPorts(e, d, protocol, config), neighbors: (live?.neighbors ?? []).filter(n => n.state !== 'DOWN') };
}
function areaLabel(v: OspfView, key: string): string { return v.ports.find(p => p.area === key)?.areaLabel ?? (key.includes('.') ? key : String(key)); }
function areaKind(v: OspfView, key: string): 'normal' | 'stub' | 'nssa' { const t = areaConfig(v.config, key)?.type; return t === 'stub' || t === 'nssa' ? t : 'normal'; }
const ospfTitle = (v: OspfView) => `            ${v.v3 ? 'OSPFv3' : 'OSPF'} Router with ID (${v.rid}) (Process ID ${v.pid})`;
function segmentAddress(v: OspfView, port: OspfPort, deviceId: string | undefined): string {
  if (!deviceId) return v.v3 ? '::' : '0.0.0.0';
  if (deviceId === v.d.id) return port.address;
  const peer = v.neighbors.find(n => n.interface === port.name && n.deviceId === deviceId);
  if (peer) return peer.address;
  const other = v.e.getDevice(deviceId);
  const match = other && Object.values(other.config.interfaces).find(i => i.ip && i.mask && prefixContains(port.address, port.prefix, i.ip));
  return match?.ip ?? '0.0.0.0';
}
function neighborRole(port: OspfPort | undefined, deviceId: string): string {
  if (!port || port.p2p) return '-';
  return port.state?.drDeviceId === deviceId ? 'DR' : port.state?.bdrDeviceId === deviceId ? 'BDR' : 'DROTHER';
}
function interfaceId(e: Simulator, deviceId: string, name: string): number {
  const d = e.getDevice(deviceId); if (!d) return 0;
  return ports(d).findIndex(p => p.name === name) + 1;
}
function ospfNeighbors(v: OspfView, args: string[]): string[] {
  const a = [...args]; let detail = false, wanted: string | undefined, port: string | undefined;
  while (a.length) {
    const value = a[0];
    if ('detail'.startsWith(value.toLowerCase())) { a.shift(); detail = true; }
    else if (isIPv4(value)) { a.shift(); wanted = value; }
    else if (!port) port = takePort(v.d, a);
    else return invalid();
  }
  const portOf = (name: string) => v.ports.find(p => p.name === name);
  const selected = v.neighbors.filter(n => (!wanted || n.routerId === wanted) && (!port || n.interface === port))
    .sort((x, y) => natural(x.interface, y.interface) || byIp(y.routerId, x.routerId));
  const head = v.v3 ? ['', ospfTitle(v), ''] : [''];
  if (detail) {
    const events: any[] = v.d.runtime.features[v.protocol + 'Events'] ?? [];
    return [...(v.v3 ? head : []), ...selected.flatMap((n, index) => {
      const p = portOf(n.interface), role = neighborRole(p, n.deviceId), kind = p ? areaKind(v, p.area) : 'normal';
      const mine = events.filter(x => x.routerId === n.routerId && x.interface === n.interface);
      const fullAt = n.upSince ?? [...mine].reverse().find(x => x.to === 'FULL')?.time ?? v.now;
      const dr = p && !p.p2p ? segmentAddress(v, p, p.state?.drDeviceId) : '0.0.0.0', bdr = p && !p.p2p ? segmentAddress(v, p, p.state?.bdrDeviceId) : '0.0.0.0';
      const helloOptions = kind === 'stub' ? '0x10 in Hello (L-bit)' : kind === 'nssa' ? '0x18 in Hello (N-bit, L-bit)' : '0x12 in Hello (E-bit, L-bit)';
      const dbdOptions = kind === 'stub' ? '0x50 in DBD (L-bit, O-bit)' : kind === 'nssa' ? '0x58 in DBD (N-bit, L-bit, O-bit)' : '0x52 in DBD (E-bit, L-bit, O-bit)';
      const i = index + 1;
      return [
        v.v3 ? ` Neighbor ${n.routerId}` : ` Neighbor ${n.routerId}, interface address ${n.address}`,
        ...(v.v3 ? [`    In the area ${p?.areaLabel ?? 0} via interface ${n.interface}`, `    Neighbor: interface-id ${interfaceId(v.e, n.deviceId, n.peerInterface)}, link-local address ${n.address}`] : [`    In the area ${p?.areaLabel ?? 0} via interface ${n.interface}`]),
        `    Neighbor priority is ${n.priority}, State is ${n.state}, ${Math.max(1, mine.length)} state changes`,
        `    DR is ${v.v3 ? (role === 'DR' ? n.routerId : p?.state?.drRouterId ?? '0.0.0.0') : dr} BDR is ${v.v3 ? p?.state?.bdrRouterId ?? '0.0.0.0' : bdr}`,
        ...(v.v3 ? [`    Options is 0x000013 in Hello (V6-Bit, E-Bit, R-Bit)`, `    Options is 0x000013 in DBD (V6-Bit, E-Bit, R-Bit)`] : [`    Options is ${helloOptions}`, `    Options is ${dbdOptions}`, '    LLS Options is 0x1 (LR)']),
        `    Dead timer due in ${hms(n.deadAt - v.now)}`,
        ...(n.state === 'FULL' ? [`    Neighbor is up for ${hms(v.now - fullAt)}`] : []),
        `    Index ${i}/${i}/${i}, retransmission queue length ${n.pending}, number of retransmission ${Math.max(0, n.attempts - 1)}`,
        '    First 0x0(0)/0x0(0)/0x0(0) Next 0x0(0)/0x0(0)/0x0(0)',
        '    Last retransmission scan length is 0, maximum is 0',
        '    Last retransmission scan time is 0 msec, maximum is 0 msec',
        '',
      ];
    })];
  }
  const header = v.v3 ? 'Neighbor ID     Pri   State           Dead Time   Interface ID    Interface' : 'Neighbor ID     Pri   State           Dead Time   Address         Interface';
  return [...head, header, ...selected.map(n => {
    const role = neighborRole(portOf(n.interface), n.deviceId);
    const stateText = `${n.state}/${role === '-' ? '  -' : role}`;
    const address = v.v3 ? String(interfaceId(v.e, n.deviceId, n.peerInterface)) : n.address;
    return `${pad(n.routerId, 15)} ${lpad(n.priority, 3)}   ${pad(stateText, 15)} ${pad(hms(n.deadAt - v.now), 11)} ${pad(address, 15)} ${n.interface}`;
  })];
}
function briefState(p: OspfPort): string {
  if (!p.up) return 'DOWN';
  if (p.loopback && p.networkType === 'loopback') return 'LOOP';
  if (p.p2p) return 'P2P';
  if (p.passive || !p.state) return 'DR';
  return p.state.role === 'DROTHER' ? 'DROTH' : p.state.role === 'POINT-TO-POINT' ? 'P2P' : p.state.role;
}
function authenticationMode(v: OspfView, p: OspfPort): string {
  if (p.state?.authenticationMode) return String(p.state.authenticationMode);
  const f = p.iface.features[v.protocol] ?? {};
  if (f.authentication !== undefined) return f.authentication === true ? 'simple' : String(f.authentication);
  const area = areaConfig(v.config, p.area)?.authentication;
  return area ? String(area) : 'none';
}
function ospfInterfaces(v: OspfView, args: string[]): string[] {
  const a = [...args]; let brief = false, wanted: string | undefined;
  while (a.length) {
    if ('brief'.startsWith(a[0].toLowerCase())) { a.shift(); brief = true; }
    else if (!wanted) wanted = takePort(v.d, a);
    else return invalid();
  }
  const selected = v.ports.filter(p => !wanted || p.name === wanted);
  const counts = (p: OspfPort) => { const all = v.neighbors.filter(n => n.interface === p.name); return { full: all.filter(n => n.state === 'FULL').length, all: all.length }; };
  if (brief) {
    const header = v.v3 ? 'Interface    PID   Area            Intf ID    Cost  State Nbrs F/C' : 'Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C';
    return [header, ...selected.map(p => {
      const c = counts(p), where = v.v3 ? pad(interfaceId(v.e, v.d.id, p.name), 11) : pad(`${p.address}/${p.prefix}`, 19);
      return `${pad(shortInterfaceName(p.name), 13)}${pad(v.pid, 6)}${pad(p.areaLabel, 16)}${where}${pad(p.cost, 6)}${pad(briefState(p), 6)}${c.full}/${c.all}`;
    })];
  }
  const indexes = new Map<string, number>(); v.ports.filter(p => !p.loopback).forEach((p, i) => indexes.set(p.name, i + 1));
  return selected.flatMap(p => {
    const typeName = p.networkType === 'loopback' ? 'LOOPBACK' : p.networkType === 'point-to-point' ? 'POINT_TO_POINT' : p.networkType === 'non-broadcast' ? 'NON_BROADCAST' : p.networkType.startsWith('point-to-multipoint') ? (p.networkType.includes('non-broadcast') ? 'POINT_TO_MULTIPOINT_NBMA' : 'POINT_TO_MULTIPOINT') : 'BROADCAST';
    const lines = [`${p.name} is ${p.status}, line protocol is ${p.protocolUp ? 'up' : 'down'} `];
    if (v.v3) lines.push(`  Link Local Address ${p.address.toUpperCase()}, Interface ID ${interfaceId(v.e, v.d.id, p.name)}`, `  Area ${p.areaLabel}, Process ID ${v.pid}, Instance ID ${Number(p.iface.features[v.protocol]?.instanceId ?? 0)}, Router ID ${v.rid}`, `  Network Type ${typeName}, Cost: ${p.cost}`);
    else lines.push(`  Internet Address ${p.address}/${p.prefix}, Area ${p.areaLabel}, Attached via ${p.viaInterface ? 'Interface Enable' : 'Network Statement'}`, `  Process ID ${v.pid}, Router ID ${v.rid}, Network Type ${typeName}, Cost: ${p.cost}`, '  Topology-MTID    Cost    Disabled    Shutdown      Topology Name', `        0           ${pad(p.cost, 10)}no          no            Base`);
    if (p.viaInterface && !v.v3) lines.push('  Enabled by interface config, including secondary ip addresses');
    if (p.loopback && p.networkType === 'loopback') { lines.push('  Loopback interface is treated as a stub Host'); return lines; }
    const timers = `  Timer intervals configured, Hello ${p.hello}, Dead ${p.dead}, Wait ${p.dead}, Retransmit 5`;
    if (!p.up) { lines.push(`  Transmit Delay is 1 sec, State DOWN${p.p2p ? '' : `, Priority ${p.priority}`}`, ...(p.p2p ? [] : ['  No designated router on this network', '  No backup designated router on this network']), timers); return lines; }
    const role = p.p2p ? 'POINT_TO_POINT' : p.passive || !p.state ? 'DR' : p.state.role === 'DROTHER' ? 'DROTHER' : p.state.role;
    lines.push(`  Transmit Delay is 1 sec, State ${role}${p.p2p ? '' : `, Priority ${p.priority}`}`);
    if (!p.p2p) {
      const drId = p.passive || !p.state ? v.rid : p.state.drRouterId, drDevice = p.passive || !p.state ? v.d.id : p.state.drDeviceId;
      if (drId && drDevice) lines.push(v.v3 ? `  Designated Router (ID) ${drId}, local address ${segmentAddress(v, p, drDevice).toUpperCase()}` : `  Designated Router (ID) ${drId}, Interface address ${segmentAddress(v, p, drDevice)}`);
      else lines.push('  No designated router on this network');
      if (p.state?.bdrRouterId && p.state?.bdrDeviceId) lines.push(v.v3 ? `  Backup Designated router (ID) ${p.state.bdrRouterId}, local address ${segmentAddress(v, p, p.state.bdrDeviceId).toUpperCase()}` : `  Backup Designated router (ID) ${p.state.bdrRouterId}, Interface address ${segmentAddress(v, p, p.state.bdrDeviceId)}`);
      else lines.push('  No backup designated router on this network');
    }
    lines.push(timers);
    if (!v.v3) lines.push(`    oob-resync timeout ${p.dead}`);
    const due = v.live?.helloDue[p.name];
    lines.push(p.passive ? '    No Hellos (Passive interface) ' : `    Hello due in ${hms(due ?? p.hello * 1000)}`);
    if (!v.v3) lines.push('  Supports Link-local Signaling (LLS)');
    lines.push('  Cisco NSF helper support enabled', '  IETF NSF helper support enabled');
    const i = indexes.get(p.name) ?? 1, c = counts(p);
    lines.push(`  Index ${i}/${i}/${i}, flood queue length 0`, '  Next 0x0(0)/0x0(0)/0x0(0)', `  Last flood scan length is ${c.full ? 1 : 0}, maximum is ${c.full ? 1 : 0}`, '  Last flood scan time is 0 msec, maximum is 0 msec');
    lines.push(`  Neighbor Count is ${c.all}, Adjacent neighbor count is ${c.full} `);
    for (const n of v.neighbors.filter(n => n.interface === p.name && n.state === 'FULL')) {
      const role = neighborRole(p, n.deviceId);
      lines.push(`    Adjacent with neighbor ${n.routerId}${role === 'DR' ? '  (Designated Router)' : role === 'BDR' ? '  (Backup Designated Router)' : ''}`);
    }
    lines.push('  Suppress hello for 0 neighbor(s)');
    if (!v.v3) {
      const mode = authenticationMode(v, p);
      if (mode === 'message-digest' || mode === 'md5' || mode === 'key-chain' || mode === 'cryptographic') {
        const keys = Object.keys(p.iface.features[v.protocol]?.messageDigestKeys ?? {}).map(Number).filter(Number.isFinite);
        lines.push('  Cryptographic authentication enabled', `    Youngest key id is ${keys.length ? Math.max(...keys) : 1}`);
      } else if (mode === 'simple' || mode === 'true' || mode === 'text') lines.push('  Simple password authentication enabled');
    }
    return lines;
  });
}

// OSPF link-state database, derived from the per-router LSAs the simulator floods.
interface DbLsa {
  type: 1 | 2 | 3 | 4 | 5 | 7; area?: string; linkId: string; adv: string; age: number; seq: number; checksum: number;
  routerLinks?: { kind: 'stub' | 'transit' | 'p2p'; id: string; data: string; metric: number }[]; bits?: { abr: boolean; asbr: boolean };
  mask?: number; attached?: string[]; metric?: number; metricType?: number; tag?: number; forward?: string;
}
const seqHex = (seq: number) => '0x' + hex((0x80000000 + Math.max(1, seq)) >>> 0, 8);
function ospfDatabaseEntries(v: OspfView): DbLsa[] {
  const lsas = v.live?.lsas ?? [], result: DbLsa[] = [];
  // The process summary also consumes these entries for OSPFv3. IPv6 prefix
  // lengths must not pass through the IPv4 dotted-mask formatter.
  const prefixData = (prefix: number) => v.v3 ? String(prefix) : prefixToMask(prefix);
  const localAreas = new Set(v.ports.filter(p => p.up).map(p => p.area));
  const areasOf = (l: typeof lsas[number]) => new Set([...l.links.map(k => areaKey(k.area)), ...l.prefixes.filter(x => x.kind === 'prefix').map(x => areaKey(x.endpoint.area))]);
  const deviceOf = (l: typeof lsas[number]) => l.links[0]?.from.deviceId ?? l.prefixes[0]?.endpoint.deviceId;
  const checksum = (...parts: unknown[]) => fold16(parts.join('|'));
  const isP2p = (link: OSPFLink) => String((link.from as any).networkType ?? '').includes('point-to-point') || (link.from as any).role === 'POINT-TO-POINT';
  const roleOf = (deviceId: string, name: string) => v.e.getDevice(deviceId)?.runtime.features[v.protocol + 'Interfaces']?.[name]?.role;
  // Shortest path cost between router IDs inside one area (for summary metrics).
  const distances = (area: string, from: string) => {
    const dist = new Map<string, number>([[from, 0]]), edges = lsas.flatMap(l => l.links.filter(k => areaKey(k.area) === area));
    for (let changed = true; changed;) { changed = false; for (const k of edges) { const base = dist.get(k.from.routerId); if (base === undefined) continue; const next = base + k.cost; if (next < (dist.get(k.to.routerId) ?? Infinity)) { dist.set(k.to.routerId, next); changed = true; } } }
    return dist;
  };
  // A remote area's summary cost includes the path through Area 0 to its ABR.
  // Retain the traversal phase so a path cannot leave and then re-enter the backbone.
  const backboneDistances = (source: string, from: string) => {
    const states = new Map<string, number>([[`0|${from}`, 0]]), edges = lsas.flatMap(l => l.links.filter(k => ['0', source].includes(areaKey(k.area))));
    for (let changed = true; changed;) {
      changed = false;
      for (const k of edges) for (const phase of ['0', source]) {
        const edgeArea = areaKey(k.area); if (phase !== '0' && edgeArea === '0') continue;
        const base = states.get(`${phase}|${k.from.routerId}`); if (base === undefined) continue;
        const key = `${edgeArea}|${k.to.routerId}`, next = base + k.cost;
        if (next < (states.get(key) ?? Infinity)) { states.set(key, next); changed = true; }
      }
    }
    const result = new Map<string, number>();
    for (const [key, cost] of states) { const rid = key.slice(key.indexOf('|') + 1); result.set(rid, Math.min(cost, result.get(rid) ?? Infinity)); }
    return result;
  };
  for (const area of localAreas) {
    // Router LSAs (type 1)
    for (const l of lsas.filter(l => areasOf(l).has(area))) {
      const links = l.links.filter(k => areaKey(k.area) === area), prefixes = l.prefixes.filter(x => x.kind === 'prefix' && areaKey(x.endpoint.area) === area);
      const entries: NonNullable<DbLsa['routerLinks']> = [], withTransit = new Set<string>();
      for (const name of [...new Set(links.map(k => k.from.name))].sort(natural)) {
        const mine = links.filter(k => k.from.name === name);
        if (isP2p(mine[0])) {
          for (const k of mine) entries.push({ kind: 'p2p', id: k.to.routerId, data: k.from.address, metric: k.cost });
          const stub = prefixes.find(x => x.endpoint.name === name);
          if (stub) entries.push({ kind: 'stub', id: stub.network, data: prefixData(stub.prefix), metric: Number(stub.cost ?? mine[0].cost) });
        } else {
          const endpoints = [...mine.map(k => k.from), ...mine.map(k => k.to)];
          const dr = endpoints.find(x => roleOf(x.deviceId, x.name) === 'DR') ?? endpoints.find(x => (x as any).role === 'DR');
          entries.push({ kind: 'transit', id: dr?.address ?? mine[0].from.address, data: mine[0].from.address, metric: mine[0].cost });
        }
        withTransit.add(name);
      }
      for (const x of prefixes.filter(x => !withTransit.has(x.endpoint.name))) entries.push({ kind: 'stub', id: x.network, data: prefixData(x.prefix), metric: Number(x.cost ?? 1) });
      const external = l.prefixes.some(x => x.kind !== 'prefix'), abr = areasOf(l).size > 1;
      result.push({ type: 1, area, linkId: l.routerId, adv: l.routerId, age: l.age, seq: l.sequence, checksum: checksum(1, area, l.routerId, l.sequence, entries.length), routerLinks: entries, bits: { abr, asbr: external } });
    }
    // Network LSAs (type 2) from segments with a designated router
    const segments = new Map<string, OSPFLink[]>();
    for (const l of lsas) for (const k of l.links.filter(k => areaKey(k.area) === area && !isP2p(k))) { const key = k.from.family === 4 ? `${intToIp((ipToInt(k.from.address) & ipToInt(prefixToMask(k.from.prefix))) >>> 0)}/${k.from.prefix}` : k.from.address; segments.set(key, [...(segments.get(key) ?? []), k]); }
    for (const [key, links] of segments) {
      const endpoints = links.flatMap(k => [k.from, k.to]), dr = endpoints.find(x => roleOf(x.deviceId, x.name) === 'DR');
      if (!dr || result.some(r => r.type === 2 && r.area === area && r.linkId === dr.address)) continue;
      const attached = [...new Set([dr.routerId, ...endpoints.map(x => x.routerId)])], owner = lsas.find(l => l.routerId === dr.routerId);
      result.push({ type: 2, area, linkId: dr.address, adv: dr.routerId, age: owner?.age ?? 0, seq: owner?.sequence ?? 1, checksum: checksum(2, key, dr.routerId, owner?.sequence), mask: dr.prefix, attached });
    }
    // Summary LSAs (type 3/4) originated by area border routers attached to this area
    const kind = areaKind(v, area), cfgArea = areaConfig(v.config, area);
    for (const abr of lsas.filter(l => areasOf(l).size > 1 && areasOf(l).has(area))) {
      const abrDevice = v.e.getDevice(deviceOf(abr) ?? ''), abrConfig = abrDevice ? routingConfig(abrDevice, v.protocol) : undefined, mineAreas = areasOf(abr);
      const add = (linkId: string, mask: number, metric: number) => { if (!result.some(r => r.type === 3 && r.area === area && r.linkId === linkId && r.mask === mask && r.adv === abr.routerId)) result.push({ type: 3, area, linkId, adv: abr.routerId, age: abr.age, seq: abr.sequence, checksum: checksum(3, area, linkId, mask, abr.routerId, abr.sequence), mask, metric }); };
      if (kind !== 'normal') add('0.0.0.0', 0, Number(areaConfig(abrConfig, area)?.defaultCost ?? 1));
      if (kind !== 'normal' && (cfgArea?.noSummary || areaConfig(abrConfig, area)?.noSummary)) continue;
      for (const source of [...new Set(lsas.flatMap(l => [...areasOf(l)]))].filter(x => x !== area && (area !== '0' || mineAreas.has(x)))) {
        if (area !== '0' && source !== '0' && !mineAreas.has(source) && !mineAreas.has('0')) continue;
        const dist = mineAreas.has(source) ? distances(source, abr.routerId) : backboneDistances(source, abr.routerId), ranges: any[] = areaConfig(abrConfig, source)?.ranges ?? [], emitted = new Set<string>();
        for (const l of lsas) for (const x of l.prefixes.filter(x => x.kind === 'prefix' && areaKey(x.endpoint.area) === source)) {
          const distance = dist.get(l.routerId); if (distance === undefined) continue;
          const metric = distance + Number(x.cost ?? 1);
          const range = ranges.find(r => prefixContains(r.network, Number(r.prefix), x.network) && x.prefix >= Number(r.prefix));
          if (range) { if (!range.notAdvertise && !emitted.has(range.network + '/' + range.prefix)) { emitted.add(range.network + '/' + range.prefix); add(range.network, Number(range.prefix), Number(range.cost ?? metric)); } continue; }
          add(x.network, x.prefix, metric);
        }
      }
      if (kind === 'normal') for (const asbr of lsas.filter(l => l.prefixes.some(x => x.kind !== 'prefix') && !areasOf(l).has(area) && l.routerId !== abr.routerId)) {
        const shared = [...areasOf(asbr)].find(x => mineAreas.has(x)); if (shared === undefined) continue;
        if (!result.some(r => r.type === 4 && r.area === area && r.linkId === asbr.routerId && r.adv === abr.routerId)) result.push({ type: 4, area, linkId: asbr.routerId, adv: abr.routerId, age: abr.age, seq: abr.sequence, checksum: checksum(4, area, asbr.routerId, abr.routerId), mask: 0, metric: distances(shared, abr.routerId).get(asbr.routerId) ?? 1 });
      }
    }
  }
  // External LSAs (type 5, or type 7 inside NSSAs)
  const hasNormal = [...localAreas].some(a => areaKind(v, a) === 'normal');
  for (const l of lsas) {
    const areas = [...areasOf(l)], nssa = areas.length > 0 && areas.every(a => areaKind(v, a) === 'nssa' || areaConfig(routingConfig(v.e.getDevice(deviceOf(l) ?? '') ?? v.d, v.protocol), a)?.type === 'nssa');
    for (const x of l.prefixes.filter(x => x.kind !== 'prefix')) {
      const route = x.route ?? {}, base = { linkId: x.network, adv: l.routerId, age: l.age, seq: l.sequence, mask: x.prefix, metric: Number(route.metric ?? 20), metricType: Number(route.metricType ?? 2), tag: Number(route.tag ?? 0) };
      if (nssa) {
        for (const area of areas.filter(a => localAreas.has(a))) result.push({ type: 7, area, ...base, checksum: checksum(7, area, x.network, l.routerId), forward: x.endpoint.address ?? '0.0.0.0' });
        const translator = lsas.filter(t => areasOf(t).size > 1 && areas.some(a => areasOf(t).has(a))).sort((p, q) => byIp(q.routerId, p.routerId))[0];
        if (translator && hasNormal) result.push({ type: 5, ...base, adv: translator.routerId, age: translator.age, seq: translator.sequence, checksum: checksum(5, x.network, translator.routerId), forward: x.endpoint.address ?? '0.0.0.0' });
      } else if (hasNormal) result.push({ type: 5, ...base, checksum: checksum(5, x.network, l.routerId), forward: '0.0.0.0' });
    }
  }
  return result.map(r => ({ ...r, age: Math.min(3600, r.age) }));
}
const sectionTitle: Record<number, string> = { 1: 'Router Link States', 2: 'Net Link States', 3: 'Summary Net Link States', 4: 'Summary ASB Link States', 5: 'Type-5 AS External Link States', 7: 'Type-7 AS External Link States' };
function ospfDatabase(v: OspfView, args: string[]): string[] {
  const a = [...args];
  const types: Record<string, number> = { router: 1, network: 2, summary: 3, 'asbr-summary': 4, external: 5, 'nssa-external': 7 };
  let type: number | undefined, linkId: string | undefined, adv: string | undefined, self = false;
  if (a.length && !['self-originate', 'adv-router'].some(k => k.startsWith(a[0].toLowerCase()))) {
    type = types[word(a.shift(), Object.keys(types))];
    if (a[0] && isIPv4(a[0])) linkId = a.shift();
  }
  if (a.length) {
    const option = word(a.shift(), ['self-originate', 'adv-router']);
    if (option === 'self-originate') self = true;
    else { adv = a.shift(); if (!adv) return incomplete(); if (!isIPv4(adv)) return invalid(); }
  }
  if (a.length) return invalid();
  if (v.v3) return ospfv3Database(v, type, adv ?? (self ? v.rid : undefined));
  const all = ospfDatabaseEntries(v).filter(r => (type === undefined || r.type === type) && (!linkId || r.linkId === linkId) && (!adv || r.adv === adv) && (!self || r.adv === v.rid));
  const lines = ['', ospfTitle(v), ''];
  const areas = [...new Set(all.filter(r => r.area !== undefined).map(r => r.area!))].sort((x, y) => Number(x) - Number(y));
  const groups: { type: number; area?: string; rows: DbLsa[] }[] = [];
  for (const area of areas) for (const t of [1, 2, 3, 4, 7]) { const rows = all.filter(r => r.area === area && r.type === t); if (rows.length) groups.push({ type: t, area, rows }); }
  const externals = all.filter(r => r.type === 5); if (externals.length) groups.push({ type: 5, rows: externals });
  for (const g of groups) {
    g.rows.sort((x, y) => byIp(x.linkId, y.linkId) || byIp(x.adv, y.adv));
    lines.push(`\t\t${sectionTitle[g.type]}${g.area !== undefined && g.type !== 4 ? ` (Area ${areaLabel(v, g.area)})` : g.type === 4 ? ` (Area ${areaLabel(v, g.area!)})` : ''}`, '');
    if (type === undefined) {
      lines.push(`Link ID         ADV Router      Age         Seq#       Checksum${g.type === 1 ? ' Link count' : g.type === 5 || g.type === 7 ? ' Tag' : ''}`);
      for (const r of g.rows) lines.push(`${pad(r.linkId, 16)}${pad(r.adv, 16)}${pad(r.age, 12)}${pad(seqHex(r.seq), 11)}0x00${hex(r.checksum, 4)}${g.type === 1 ? ' ' + r.routerLinks!.length : g.type === 5 || g.type === 7 ? ' ' + r.tag : ''}`);
      lines.push('');
      continue;
    }
    for (const r of g.rows) lines.push(...ospfLsaDetail(v, r));
  }
  return lines;
}
function ospfLsaDetail(v: OspfView, r: DbLsa): string[] {
  const own = r.adv === v.rid, lines = [...(own ? [] : ['  Routing Bit Set on this LSA in topology Base with MTID 0']), `  LS age: ${r.age}`];
  const upward = r.type >= 3 ? ', Upward' : '';
  lines.push(`  Options: (No TOS-capability, ${r.type === 7 ? 'Type 7/5 translation, ' : ''}DC${upward})`);
  const typeName: Record<number, string> = { 1: 'Router Links', 2: 'Network Links', 3: 'Summary Links(Network)', 4: 'Summary Links(AS Boundary Router)', 5: 'AS External Link', 7: 'AS External Link' };
  const idNote: Record<number, string> = { 1: '', 2: ' (address of Designated Router)', 3: ' (summary Network Number)', 4: ' (AS Boundary Router address)', 5: ' (External Network Number )', 7: ' (External Network Number )' };
  const length = r.type === 1 ? 24 + 12 * r.routerLinks!.length : r.type === 2 ? 24 + 4 * r.attached!.length : r.type >= 5 ? 36 : 28;
  lines.push(`  LS Type: ${typeName[r.type]}`, `  Link State ID: ${r.linkId}${idNote[r.type]}`, `  Advertising Router: ${r.adv}`, `  LS Seq Number: ${seqHex(r.seq).slice(2)}`, `  Checksum: 0x${hex(r.checksum, 4)}`, `  Length: ${length}`);
  if (r.type === 1) {
    if (r.bits?.abr) lines.push('  Area Border Router');
    if (r.bits?.asbr) lines.push('  AS Boundary Router');
    lines.push(`  Number of Links: ${r.routerLinks!.length}`, '');
    for (const k of r.routerLinks!) {
      if (k.kind === 'stub') lines.push('    Link connected to: a Stub Network', `     (Link ID) Network/subnet number: ${k.id}`, `     (Link Data) Network Mask: ${k.data}`);
      else if (k.kind === 'transit') lines.push('    Link connected to: a Transit Network', `     (Link ID) Designated Router address: ${k.id}`, `     (Link Data) Router Interface address: ${k.data}`);
      else lines.push('    Link connected to: another Router (point-to-point)', `     (Link ID) Neighboring Router ID: ${k.id}`, `     (Link Data) Router Interface address: ${k.data}`);
      lines.push('      Number of MTID metrics: 0', `       TOS 0 Metrics: ${k.metric}`, '');
    }
    lines.push('');
    return lines;
  }
  if (r.type === 2) { lines.push(`  Network Mask: /${r.mask}`, ...r.attached!.map(id => `\tAttached Router: ${id}`), ''); return lines; }
  if (r.type === 3 || r.type === 4) { lines.push(`  Network Mask: /${r.mask}`, `\tMTID: 0 \tMetric: ${r.metric} `, ''); return lines; }
  lines.push(`  Network Mask: /${r.mask}`, `\tMetric Type: ${r.metricType} (${r.metricType === 1 ? 'Comparable directly to link state metric' : 'Larger than any link state path'})`, '\tMTID: 0 ', `\tMetric: ${r.metric} `, `\tForward Address: ${r.forward ?? '0.0.0.0'}`, `\tExternal Route Tag: ${r.tag ?? 0}`, '');
  return lines;
}
function ospfv3Database(v: OspfView, type: number | undefined, adv: string | undefined): string[] {
  const lsas = (v.live?.lsas ?? []).filter(l => !adv || l.routerId === adv), lines = ['', ospfTitle(v), ''];
  const areas = [...new Set(v.ports.filter(p => p.up).map(p => p.area))].sort((x, y) => Number(x) - Number(y));
  const row = (adv: string, age: number, seq: number, rest: string) => `${pad(adv, 17)}${pad(Math.min(3600, age), 12)}${pad(seqHex(seq), 12)}${rest}`;
  for (const area of areas) {
    const members = lsas.filter(l => l.links.some(k => areaKey(k.area) === area) || l.prefixes.some(x => x.kind === 'prefix' && areaKey(x.endpoint.area) === area)).sort((x, y) => byIp(x.routerId, y.routerId));
    if (type === undefined || type === 1) {
      lines.push(`\t\tRouter Link States (Area ${areaLabel(v, area)})`, '', 'ADV Router       Age         Seq#        Fragment ID  Link count  Bits');
      for (const l of members) { const links = l.links.filter(k => areaKey(k.area) === area); const bits = [l.prefixes.some(x => x.kind !== 'prefix') ? 'E' : '', new Set(l.links.map(k => areaKey(k.area))).size > 1 ? 'B' : ''].filter(Boolean).join(''); lines.push(row(l.routerId, l.age, l.sequence, `${pad(0, 13)}${pad(new Set(links.map(k => k.from.name)).size, 12)}${bits || 'None'}`)); }
      lines.push('');
    }
    if (type === undefined || type === 2) {
      const nets = members.flatMap(l => [...new Set(l.links.filter(k => areaKey(k.area) === area && v.e.getDevice(k.from.deviceId)?.runtime.features[v.protocol + 'Interfaces']?.[k.from.name]?.role === 'DR').map(k => k.from.name))].map(name => ({ l, name, count: 1 + l.links.filter(k => k.from.name === name).length })));
      if (nets.length) { lines.push(`\t\tNet Link States (Area ${areaLabel(v, area)})`, '', 'ADV Router       Age         Seq#        Link ID    Rtr count'); for (const n of nets) { const device = n.l.links[0]?.from.deviceId ?? ''; lines.push(row(n.l.routerId, n.l.age, n.l.sequence, `${pad(interfaceId(v.e, device, n.name), 11)}${n.count}`)); } lines.push(''); }
    }
    if (type === undefined) {
      const local = v.ports.filter(p => p.area === area && p.up && !p.loopback);
      if (local.length) { lines.push(`\t\tLink (Type-8) Link States (Area ${areaLabel(v, area)})`, '', 'ADV Router       Age         Seq#        Link ID    Interface'); const own = lsas.find(l => l.routerId === v.rid); for (const p of local) lines.push(row(v.rid, own?.age ?? 0, own?.sequence ?? 1, `${pad(interfaceId(v.e, v.d.id, p.name), 11)}${shortInterfaceName(p.name)}`)); lines.push(''); }
      lines.push(`\t\tIntra Area Prefix Link States (Area ${areaLabel(v, area)})`, '', 'ADV Router       Age         Seq#        Link ID    Ref-lstype  Ref-LSID');
      for (const l of members) lines.push(row(l.routerId, l.age, l.sequence, `${pad(0, 11)}${pad('0x2001', 12)}0`));
      lines.push('');
    }
  }
  if (type === undefined || type === 5) {
    const externals = lsas.flatMap(l => l.prefixes.filter(x => x.kind !== 'prefix').map(x => ({ l, x })));
    if (externals.length) { lines.push('\t\tType-5 AS External Link States', '', 'ADV Router       Age         Seq#        Prefix'); for (const { l, x } of externals) lines.push(row(l.routerId, l.age, l.sequence, `${x.network}/${x.prefix}`)); lines.push(''); }
  }
  return lines;
}
function ospfProcess(v: OspfView): string[] {
  const c = v.config, entries = ospfDatabaseEntries(v), boot = Number(v.d.runtime.features.bootTime ?? 0);
  const started = v.live?.started ?? v.now, lastSpf = v.live?.lastSpf ?? started;
  const areas = [...new Set(v.ports.map(p => p.area))].sort((x, y) => Number(x) - Number(y));
  const abr = new Set(v.ports.filter(p => p.up).map(p => p.area)).size > 1;
  const redistribute: any[] = (Array.isArray(c.redistribute) ? c.redistribute : c.redistribute ? [c.redistribute] : []).map((r: any) => typeof r === 'string' ? { protocol: r } : r);
  const asbr = redistribute.length > 0 || !!c.defaultInformationOriginate || !!c.defaultInformation;
  const spf: number[] = Array.isArray(c.throttle?.spf) ? c.throttle.spf.map(Number) : [5000, 10000, 10000];
  const sum = (rows: DbLsa[]) => '0x' + hex(rows.reduce((s, r) => s + r.checksum, 0), 6);
  const externals = entries.filter(r => r.type === 5);
  const counts = { normal: 0, stub: 0, nssa: 0 } as Record<string, number>; for (const a of areas) counts[areaKind(v, a)]++;
  const lines = [` Routing Process "${v.v3 ? 'ospfv3' : 'ospf'} ${v.pid}" with ID ${v.rid}`, ` Start time: ${hmsMillis(started - boot)}, Time elapsed: ${hmsMillis(v.now - started)}`];
  if (!v.v3) lines.push(' Supports only single TOS(TOS0) routes', ' Supports opaque LSA', ' Supports Link-local Signaling (LLS)', ' Supports area transit capability');
  lines.push(' Supports NSSA (compatible with RFC 3101)', ' Supports Database Exchange Summary List Optimization (RFC 5243)');
  if (abr || asbr) lines.push(` It is an ${abr && asbr ? 'area border and autonomous system boundary' : abr ? 'area border' : 'autonomous system boundary'} router`);
  if (redistribute.length) { lines.push(' Redistributing External Routes from,'); for (const r of redistribute) lines.push(`    ${r.protocol}${r.asn ?? r.processId ? ' ' + (r.asn ?? r.processId) : ''}${r.metric !== undefined ? ' with metric mapped to ' + r.metric : ''}${v.v3 ? '' : ', includes subnets in redistribution'}`); }
  lines.push(' Event-log enabled, Maximum number of events: 1000, Mode: cyclic');
  lines.push(c.maxMetric ? ' Originating router-LSAs with maximum metric' : ' Router is not originating router-LSAs with maximum metric');
  if (c.maxMetric) lines.push(`    Condition: always, State: active`);
  lines.push(` Initial SPF schedule delay ${spf[0]} msecs`, ` Minimum hold time between two consecutive SPFs ${spf[1]} msecs`, ` Maximum wait time between two consecutive SPFs ${spf[2]} msecs`, ' Incremental-SPF disabled');
  lines.push(' Minimum LSA interval 5 secs', ' Minimum LSA arrival 1000 msecs', ' LSA group pacing timer 240 secs', ' Interface flood pacing timer 33 msecs', ' Retransmission pacing timer 66 msecs');
  if (!v.v3) lines.push(' EXCHANGE/LOADING adjacency limit: initial 300, process maximum 300');
  lines.push(` Number of external LSA ${externals.length}. Checksum Sum ${sum(externals)}`);
  if (!v.v3) lines.push(' Number of opaque AS LSA 0. Checksum Sum 0x000000', ' Number of DCbitless external and opaque AS LSA 0', ' Number of DoNotAge external and opaque AS LSA 0');
  lines.push(` Number of areas in this router is ${areas.length}. ${counts.normal} normal ${counts.stub} stub ${counts.nssa} nssa`);
  if (!v.v3) lines.push(' Number of areas transit capable is 0');
  lines.push(' External flood list length 0', ' IETF NSF helper support enabled', ' Cisco NSF helper support enabled');
  if (!v.v3) lines.push(` Reference bandwidth unit is ${Number(c.referenceBandwidth ?? 100)} mbps`);
  for (const area of areas) {
    const label = areaLabel(v, area), members = v.ports.filter(p => p.area === area), loops = members.filter(p => p.loopback).length, ac = areaConfig(c, area) ?? {}, kind = areaKind(v, area);
    lines.push(area === '0' ? `    Area BACKBONE(${label})` : `    Area ${label}`, `        Number of interfaces in this area is ${members.length}${loops ? ` (${loops} loopback)` : ''}`);
    if (kind === 'stub') lines.push(`\tIt is a stub area${ac.noSummary ? ', no summary LSA in this area' : ''}`, ...(abr ? [`\t  generates stub default route with cost ${Number(ac.defaultCost ?? 1)}`] : []));
    if (kind === 'nssa') lines.push(`\tIt is a NSSA area${ac.noSummary ? ', no summary LSA in this area' : ''}`, ...(abr ? ['\tPerform type-7/type-5 LSA translation'] : []));
    const auth = String(ac.authentication ?? '');
    if (!v.v3) lines.push(auth === 'message-digest' ? '\tArea has message digest authentication' : auth ? '\tArea has simple password authentication' : '\tArea has no authentication');
    lines.push(`\tSPF algorithm last executed ${hmsMillis(v.now - lastSpf)} ago`, `\tSPF algorithm executed ${v.live?.spfRuns ?? 0} times`, '\tArea ranges are');
    for (const r of ac.ranges ?? []) {
      const active = entries.some(x => x.type === 1 && x.area === area && x.routerLinks!.some(k => k.kind === 'stub' && prefixContains(r.network, Number(r.prefix), k.id)));
      lines.push(`\t   ${r.network}/${r.prefix} ${active ? `Active(${Number(r.cost ?? 1)})` : 'Passive'} ${r.notAdvertise ? 'DoNotAdvertise' : 'Advertise'} `);
    }
    const inArea = entries.filter(r => r.area === area);
    lines.push(`\tNumber of LSA ${inArea.length}. Checksum Sum ${sum(inArea)}`);
    if (!v.v3) lines.push('\tNumber of opaque link LSA 0. Checksum Sum 0x000000', '\tNumber of DCbitless LSA 0', '\tNumber of indication LSA 0', '\tNumber of DoNotAge LSA 0');
    lines.push('\tFlood list length 0', '');
  }
  return lines;
}
/** Handles the OSPF show views whose IOS layout this module owns; returns undefined for the rest. */
export function ospfShow(e: Simulator, d: Device, protocol: OspfProtocol, kind: string, args: readonly string[]): string[] | undefined {
  return guard(() => {
    const config = d.config.protocols[protocol]; if (!config) return undefined;
    const v = ospfView(e, d, protocol, config), a = [...args];
    switch (kind) {
      case 'process': if (a.length) return invalid(); return ospfProcess(v);
      case 'neighbor': return ospfNeighbors(v, a);
      case 'interface': return ospfInterfaces(v, a);
      case 'database': return ospfDatabase(v, a);
      case 'statistics': {
        if (a.length) return invalid();
        const areas = [...new Set(v.ports.map(p => p.area))].sort((x, y) => Number(x) - Number(y));
        return ['', ospfTitle(v), '', ...areas.map(x => `  Area ${areaLabel(v, x)}: SPF algorithm executed ${v.live?.spfRuns ?? 0} times`), '', '  Summary OSPF SPF statistic', '', '  SPF calculation time', 'Delta T   Intra     D-Intra   Summ      D-Summ    Ext       D-Ext     Total     Reason', ''];
      }
      case 'flood-list': {
        if (a.length) return invalid();
        return ['', ospfTitle(v), '', ...v.ports.filter(p => p.up && !p.loopback && !p.passive).flatMap(p => [` Interface ${p.name}, Queue length 0`, ''])];
      }
      case 'request-list': case 'retransmission-list': {
        if (a.length) return invalid();
        const retransmit = kind === 'retransmission-list';
        return ['', ospfTitle(v), '', ...v.neighbors.flatMap(n => [` Neighbor ${n.routerId}, interface ${n.interface} address ${n.address}`, ...(retransmit ? [` Link state retransmission due in ${n.pending ? 5000 : 0} msec, Queue length ${n.pending}`] : []), '', ' Type  LS ID           ADV RTR         Seq NO      Age    Checksum', ''])];
      }
      case 'max-metric': {
        if (a.length) return invalid();
        const started = v.live?.started ?? v.now, boot = Number(d.runtime.features.bootTime ?? 0);
        return ['', ospfTitle(v), '', ' Base Topology (MTID 0)', ...(config.maxMetric ? [` Start time: ${hmsMillis(started - boot)}, Time elapsed: ${hmsMillis(v.now - started)}`, ' Originating router-LSAs with maximum metric', '    Condition: always, State: active'] : [' Router is not originating router-LSAs with maximum metric'])];
      }
      case 'sham-links': if (a.length) return invalid(); return [];
      case 'traffic': return v.v3 ? undefined : ospfTraffic(v, a);
      default: return undefined;
    }
  });
}
export interface OspfBorderEntry { routerId: string; type: string; cost: number; via?: string; port?: string; areas: string[] }
const OSPF_PACKET_TYPES: [string, string][] = [['Hello', 'hello'], ['DB des', 'database-description'], ['LS req', 'request'], ['LS upd', 'update'], ['LS ack', 'ack']];
const OSPF_ERROR_LINES = ['OSPF header errors', '  Length 0, Instance ID 0, Checksum 0, Auth Type 0,', '  Version 0, Bad Source 0, No Virtual Link 0,', '  Area Mismatch 0, No Sham Link 0, Self Originated 0,', '  Duplicate ID 0, Hello 0, MTU Mismatch 0,', '  Nbr Ignored 0, LLS 0, Unknown Neighbor 0,', '  Authentication 0, TTL Check Fail 0, Adjacency Throttle 0,', '  BFD 0, Test discard 0', '', 'OSPF LSA errors', '  Type 0, Length 0, Data 0, Checksum 0'];
type OspfCounter = Record<string, { packets: number; bytes: number } | undefined>;
function ospfPacketTable(rx: OspfCounter, tx: OspfCounter): string[] {
  const row = (label: string, c?: { packets: number; bytes: number }) => `  ${pad(label, 14)}${pad(c?.packets ?? 0, 21)}${c?.bytes ?? 0}`;
  const total = (c: OspfCounter) => OSPF_PACKET_TYPES.reduce((s, [, k]) => ({ packets: s.packets + (c[k]?.packets ?? 0), bytes: s.bytes + (c[k]?.bytes ?? 0) }), { packets: 0, bytes: 0 });
  return ['  Type          Packets              Bytes', row('RX Invalid'), ...OSPF_PACKET_TYPES.map(([l, k]) => row('RX ' + l, rx[k])), row('RX Total', total(rx)), '', row('TX Failed'), ...OSPF_PACKET_TYPES.map(([l, k]) => row('TX ' + l, tx[k])), row('TX Total', total(tx)), ''];
}
function ospfTraffic(v: OspfView, args: string[]): string[] {
  const a = [...args], wanted = a.length ? takePort(v.d, a) : undefined; if (a.length) return invalid();
  const stats = v.d.runtime.features[v.protocol + 'Traffic'] ?? {}, byInterface: Record<string, { sent: OspfCounter; received: OspfCounter }> = stats.interfaces ?? {};
  const ports = v.ports.filter(p => !wanted || p.name === wanted);
  if (wanted && !ports.length) return [];
  const interfaceBlock = (p: OspfPort) => [`    Interface ${p.name}`, '', 'Last clearing of interface traffic counters never', '', 'OSPF packets received/sent', ...ospfPacketTable(byInterface[p.name]?.received ?? {}, byInterface[p.name]?.sent ?? {}), ...OSPF_ERROR_LINES];
  if (wanted) return ['', '', ...ports.flatMap(interfaceBlock)];
  const n = (side: 'sent' | 'received', key: string) => Number(stats[side]?.[key] ?? 0), sum = (side: 'sent' | 'received') => Object.values(stats[side] ?? {}).reduce((s: number, x) => s + Number(x), 0);
  const counts = (side: 'sent' | 'received') => [`  \t${n(side, 'hello')} hello, ${n(side, 'database-description')} database desc, ${n(side, 'request')} link state req`, `  \t${n(side, 'update')} link state updates, ${n(side, 'ack')} link state acks`];
  const queue = (label: string, ...values: number[]) => `${pad(label, 19)}${values.map((x, i) => pad(x, i === 2 ? 10 : 11)).join('')}`;
  const queueTypes = ['    Invalid', '    Hello', '    DB des', '    LS req', '    LS upd', '    LS ack'].map(l => queue(l, 0, 0, 0));
  const summed = (side: 'sent' | 'received') => { const out: OspfCounter = {}; for (const p of v.ports) for (const [k, c] of Object.entries(byInterface[p.name]?.[side] ?? {})) if (c) { const t = out[k] ??= { packets: 0, bytes: 0 }; t.packets += c.packets; t.bytes += c.bytes; } return out; };
  return ['', '', 'OSPF statistics:', '  Last clearing of OSPF traffic counters never', `  Rcvd: ${sum('received')} total, 0 checksum errors`, ...counts('received'), `  Sent: ${sum('sent')} total`, ...counts('sent'), '', '', '',
    ospfTitle(v), '', `OSPF queue statistics for process ID ${v.pid}:`, '', '                   InputQ     UpdateQ    OutputQ', queue('  Limit', 0, 200, 0), queue('  Drops', 0, 0, 0), queue('  Max delay [msec]', 0, 0, 0), queue('  Max size', 0, 0, 0), ...queueTypes, queue('  Current size', 0, 0, 0), ...queueTypes, '', '',
    'Interface statistics:', '', '', ...ports.flatMap((p, i) => [...(i ? ['', '', ''] : []), ...interfaceBlock(p)]), '', '', '',
    `Summary traffic statistics for process ID ${v.pid}:`, '', 'OSPF packets received/sent', '', ...ospfPacketTable(summed('received'), summed('sent')), ...OSPF_ERROR_LINES, ''];
}
export function ospfBorderRouterLines(e: Simulator, d: Device, protocol: OspfProtocol, entries: OspfBorderEntry[]): string[] {
  const v = ospfView(e, d, protocol, d.config.protocols[protocol] ?? {}), local = new Set(v.ports.map(p => p.area)), spf = v.live?.spfRuns ?? 0;
  const rows = entries.flatMap(r => {
    const shared = [...new Set(r.areas.map(areaKey))].filter(a => local.has(a)), via = v.v3 ? String(r.via ?? '::').toUpperCase() : r.via ?? '0.0.0.0';
    const areas = shared.length ? shared.map(area => ({ area, code: 'i' })) : [{ area: v.ports.find(p => p.name === r.port)?.area ?? [...local][0] ?? '0', code: 'I' }];
    return areas.map(({ area, code }) => `${code} ${r.routerId} [${r.cost}] via ${via}, ${r.port ?? ''}, ${r.type}, Area ${areaLabel(v, area)}, SPF ${spf}`);
  });
  return ['', ospfTitle(v), '', ...(v.v3 ? [] : ['', '\t\tBase Topology (MTID 0)', '']), 'Internal Router Routing Table', 'Codes: i - Intra-area route, I - Inter-area route', '', ...rows];
}

// ---------------------------------------------------------------- EIGRP
type EigrpProtocol = 'eigrp' | 'eigrp6';
const ipFamily = (protocol: string) => protocol === 'eigrp6' ? 'IPv6' : 'IPv4';
const sameVrf = (value: string | undefined, vrf: string | undefined) => (value ?? '') === (vrf ?? '');
function eigrpHeading(protocol: EigrpProtocol, config: any, what: 'Neighbors' | 'Interfaces', vrf?: string): string {
  return `EIGRP-${ipFamily(protocol)}${config.name ? ` VR(${config.name}) Address-Family` : ''} ${what} for AS(${config.asn})${vrf ? ` VRF(${vrf})` : ''}`;
}
const eigrpRouterId = (d: Device, protocol: EigrpProtocol, config: any) => config.routerId || highestRouterId(d, protocol);
function eigrpMember(protocol: EigrpProtocol, config: any, p: InterfaceConfig): boolean {
  if (protocol === 'eigrp6') { const f = p.features.eigrp6; return !!p.ipv6?.length && (Number(f?.asn) === Number(config.asn) || !!config.name && f?.asn === undefined && f?.enabled !== false); }
  return !!p.ip && (config.networks ?? []).some((n: any) => prefixContains(n.network, Number(n.prefix), p.ip!));
}
function isPassive(config: any, name: string): boolean {
  const list: string[] = config.passiveInterfaces ?? [];
  return list.includes(name) || (list.includes('default') || !!config.passiveDefault) && !(config.activeInterfaces ?? []).includes(name);
}
/** EIGRP smooth round-trip time is not modeled; IOS idle-lab values are a few milliseconds. */
const eigrpSrtt = (address: string, iface: string) => 1 + fold16(`${address}|${iface}`) % 20;
function eigrpPeers(d: Device, protocol: EigrpProtocol, vrf?: string) {
  return d.runtime.neighbors.filter(n => n.protocol.toLowerCase() === protocol && n.state === 'UP' && !!n.address && sameVrf(d.config.interfaces[n.interface]?.vrf, vrf))
    .map(n => ({ ...n, address: String(n.address) }) as typeof n & { address: string })
    .sort((x, y) => (x.establishedAt ?? 0) - (y.establishedAt ?? 0) || natural(x.interface, y.interface) || byIp(x.address, y.address));
}
function detailAndPort(d: Device, args: string[]): { detail: boolean; wanted?: string } {
  let detail = false, wanted: string | undefined;
  while (args.length) { if ('detail'.startsWith(args[0].toLowerCase())) { args.shift(); detail = true; } else if (!wanted) wanted = takePort(d, args); else return invalid(); }
  return { detail, wanted };
}
function eigrpNeighbors(e: Simulator, d: Device, protocol: EigrpProtocol, config: any, vrf: string | undefined, args: string[]): string[] {
  const { detail, wanted } = detailAndPort(d, args), now = e.clock.now();
  const hellos: any[] = d.runtime.features[protocol + 'HelloNeighbors'] ?? [], updates: any[] = d.runtime.features[protocol + 'Updates'] ?? [];
  const lines = [eigrpHeading(protocol, config, 'Neighbors', vrf), 'H   Address                 Interface              Hold Uptime   SRTT   RTO  Q  Seq', ' '.repeat(51) + '(sec)         (ms)       Cnt Num'];
  const indexed = eigrpPeers(d, protocol, vrf).map((n, h) => ({ n, h })).filter(x => !wanted || x.n.interface === wanted).reverse();
  for (const { n, h } of indexed) {
    const match = (x: any) => x.interface === n.interface && sameAddress(String(x.address), n.address) && sameVrf(x.vrf, vrf);
    const hello = hellos.find(match), update = updates.find(match);
    const hold = hello?.expires !== undefined ? Math.max(0, Math.ceil((hello.expires - now) / 1000)) : Number(d.config.interfaces[n.interface]?.features[protocol]?.holdTime ?? 15);
    const srtt = eigrpSrtt(n.address, n.interface), rto = Math.max(100, srtt * 6), queue = update?.pendingSequence !== undefined ? 1 : 0;
    const tail = pad(shortInterfaceName(n.interface), 23) + lpad(hold, 4) + ' ' + pad(uptime(now - (n.establishedAt ?? hello?.since ?? now)), 9) + lpad(srtt, 4) + lpad(rto, 6) + lpad(queue, 3) + '  ' + Number(update?.receivedSequence ?? 0);
    if (protocol === 'eigrp6') lines.push(pad(h, 4) + pad('Link-local address:', 24) + tail, '    ' + n.address.toUpperCase());
    else lines.push(pad(h, 4) + pad(n.address, 24) + tail);
    if (detail) lines.push(`   Version 23.0/2.0, Retrans: ${Number(update?.retries ?? 0)}, Retries: ${Number(update?.retries ?? 0)}, Prefixes: ${Number(update?.receivedPrefixes ?? 0)}`, '   Topology-ids from peer - 0');
  }
  if (detail) lines.push(`Max Nbrs: 0, Current Nbrs: ${indexed.length}`);
  return lines;
}
interface EigrpPath { via: string; interface?: string; metric?: number; reported?: number }
interface EigrpEntry { network: string; prefix: number; active: boolean; fd: number; successors: EigrpPath[]; feasible: EigrpPath[]; other: EigrpPath[]; activeSince?: number; pendingReplies?: any[] }
function eigrpEntries(d: Device, protocol: EigrpProtocol, config: any, vrf?: string): EigrpEntry[] {
  const v6 = protocol === 'eigrp6', entries = new Map<string, EigrpEntry>(), key = (network: string, prefix: number) => `${network}/${prefix}`;
  const learned = (s: any): EigrpPath => ({ via: String(s.nextHop ?? 'Connected'), interface: s.interface, metric: s.metric, reported: s.reportedDistance });
  for (const r of d.runtime.features[v6 ? 'eigrp6Topology' : 'eigrpTopology'] ?? []) {
    if (!sameVrf(r.vrf, vrf)) continue;
    entries.set(key(r.network, r.prefix), { network: r.network, prefix: r.prefix, active: r.state === 'ACTIVE', fd: Number(r.feasibleDistance), successors: (r.successors ?? []).map(learned), feasible: (r.feasibleSuccessors ?? []).map(learned), other: [], activeSince: r.activeSince, pendingReplies: r.pendingReplies });
  }
  const routes = d.runtime.routes.filter(r => sameVrf(r.vrf, vrf) && isIPv6(r.network) === v6);
  for (const s of routes.filter(r => r.protocol === 'D summary')) {
    const metric = Number((s as any).wideMetric ?? s.metric);
    entries.set(key(s.network, s.prefix), { network: s.network, prefix: s.prefix, active: false, fd: metric, successors: [{ via: 'Summary', interface: s.interface, metric, reported: 0 }], feasible: [], other: [] });
  }
  for (const r of routes) {
    if (r.protocol.startsWith('D') || r.protocol === 'local' || r.network.toLowerCase().startsWith('fe80:') || entries.get(key(r.network, r.prefix))?.successors.some(s => s.via === 'Summary')) continue;
    const fd = dualOwnDistance(d, protocol, r.network, r.prefix, vrf);
    if (fd === undefined) continue;
    const port = r.protocol === 'connected' ? d.config.interfaces[r.interface] : undefined;
    const own: EigrpPath = port && eigrpMember(protocol, config, port) ? { via: 'Connected', interface: r.interface } : { via: `R${r.protocol === 'connected' || r.protocol === 'static' ? r.protocol : r.protocol.startsWith('O') ? 'ospf' : r.protocol.startsWith('R') ? 'rip' : r.protocol === 'B' ? 'bgp' : r.protocol}`, metric: fd, reported: 0 };
    const old = entries.get(key(r.network, r.prefix)), paths = old ? [...old.successors, ...old.feasible] : [];
    entries.set(key(r.network, r.prefix), { network: r.network, prefix: r.prefix, active: false, fd, successors: [own], feasible: paths.filter(p => Number(p.reported) < fd), other: paths.filter(p => !(Number(p.reported) < fd)) });
  }
  return [...entries.values()].sort((x, y) => v6 ? natural(x.network, y.network) || x.prefix - y.prefix : byIp(x.network, y.network) || x.prefix - y.prefix);
}
function eigrpPathLine(p: EigrpPath): string {
  const metric = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? 'Infinity' : value;
  if (p.via === 'Connected') return `        via Connected, ${p.interface}`;
  if (p.via.startsWith('R') && !p.interface) return `        via ${p.via} (${metric(p.metric)}/${metric(p.reported)})`;
  return `        via ${v6Upper(p.via)} (${metric(p.metric)}/${metric(p.reported)}), ${p.interface}`;
}
const v6Upper = (address: string) => isIPv6(address) ? address.toUpperCase() : address;
function eigrpTopology(e: Simulator, d: Device, protocol: EigrpProtocol, config: any, vrf: string | undefined, args: string[]): string[] {
  const a = args, v6 = protocol === 'eigrp6';
  let rows = eigrpEntries(d, protocol, config, vrf), allLinks = false;
  if (a.length) {
    if (isIPv4(a[0]) || isIPv6(a[0]) || a[0].includes('/')) {
      const raw = a.shift()!; let target; try { target = parseCidr(raw); } catch { return invalid(); }
      if (target.family !== (v6 ? 6 : 4)) return invalid();
      let prefix = target.prefix, exact = raw.includes('/');
      if (a[0] && isIPv4(a[0])) { try { prefix = maskToPrefix(a.shift()!); exact = true; } catch { return invalid(); } }
      rows = rows.filter(r => prefixContains(r.network, r.prefix, target.address) && (!exact || r.prefix === prefix));
    } else {
      const filter = word(a.shift(), ['all-links', 'active', 'passive', 'zero-successors']);
      allLinks = filter === 'all-links';
      rows = rows.filter(r => filter === 'active' ? r.active : filter === 'passive' ? !r.active : filter === 'zero-successors' ? !r.successors.length : true);
    }
  }
  if (a.length) return invalid();
  const now = e.clock.now(), title = `EIGRP-${ipFamily(protocol)}${config.name ? ` VR(${config.name})` : ''} Topology Table for AS(${config.asn})/ID(${eigrpRouterId(d, protocol, config)})${vrf ? ` VRF(${vrf})` : ''}`;
  const lines = [title, '', 'Codes: P - Passive, A - Active, U - Update, Q - Query, R - Reply,', '       r - reply Status, s - sia Status ', ''];
  for (const r of rows) {
    const fd = Number.isFinite(r.fd) ? String(r.fd) : 'Inaccessible', net = `${v6Upper(r.network)}/${r.prefix}`;
    lines.push(`${r.active ? 'A' : 'P'} ${net}, ${r.successors.length} successors, FD is ${fd}${r.active ? ', Qrr' : ''}`);
    if (r.active) lines.push(`    ${(r.pendingReplies ?? []).length} replies, active ${hms(now - Number(r.activeSince ?? now))}, query-origin: Local origin`);
    lines.push(...r.successors.map(eigrpPathLine), ...r.feasible.map(eigrpPathLine), ...(allLinks ? r.other.map(eigrpPathLine) : []));
    if (r.active && (r.pendingReplies ?? []).length) lines.push('    Remaining replies:', ...(r.pendingReplies ?? []).map((p: any) => `         via ${v6Upper(String(p.address))}, r, ${p.interface}`));
  }
  lines.push('');
  return lines;
}
function eigrpInterfaces(e: Simulator, d: Device, protocol: EigrpProtocol, config: any, vrf: string | undefined, args: string[]): string[] {
  const { detail, wanted } = detailAndPort(d, args), peers = eigrpPeers(d, protocol, vrf);
  const members = ports(d).filter(p => sameVrf(p.vrf, vrf) && (!wanted || p.name === wanted) && eigrpMember(protocol, config, p) && !isPassive(config, p.name) && e.interfaceUp(d.id, p.name));
  const lines = [eigrpHeading(protocol, config, 'Interfaces', vrf), '                              Xmit Queue   PeerQ        Mean   Pacing Time   Multicast    Pending', 'Interface              Peers  Un/Reliable  Un/Reliable  SRTT   Un/Reliable   Flow Timer   Routes'];
  for (const p of members) {
    const on = peers.filter(n => n.interface === p.name), srtt = on.length ? Math.round(on.reduce((s, n) => s + eigrpSrtt(n.address, n.interface), 0) / on.length) : 0;
    lines.push(pad(shortInterfaceName(p.name), 23) + pad(on.length, 9) + pad('0/0', 10) + '0/0' + lpad(srtt, 12) + ' '.repeat(7) + '0/0' + lpad(on.length ? 50 : 0, 13) + lpad(0, 12));
    if (!detail) continue;
    const f = p.features[protocol] ?? {};
    lines.push(`  Hello-interval is ${Number(f.helloInterval ?? 5)}, Hold-time is ${Number(f.holdTime ?? 15)}`, `  Split-horizon is ${f.splitHorizon === false ? 'disabled' : 'enabled'}`, '  Next xmit serial <none>', '  Packetized sent/expedited: 0/0', "  Hello's sent/expedited: 0/0", '  Un/reliable mcasts: 0/0  Un/reliable ucasts: 0/0', '  Mcast exceptions: 0  CR packets: 0  ACKs suppressed: 0', '  Retransmissions sent: 0  Out-of-sequence rcvd: 0', '  Topology-ids on interface - 0 ',
      f.authenticationMode ? `  Authentication mode is ${f.authenticationMode},  key-chain is ${f.authenticationKeyChain ? `"${f.authenticationKeyChain}"` : 'not set'}` : '  Authentication mode is not set', '  Topologies advertised on this interface:  base', '  Topologies not advertised on this interface:', '');
  }
  return lines;
}
/** show ip eigrp neighbors | topology | interfaces in the IOS 15 layout. */
export function eigrpShow(e: Simulator, d: Device, protocol: EigrpProtocol, config: any, vrf: string | undefined, kind: string, args: readonly string[]): string[] | undefined {
  return guard(() => {
    const a = [...args];
    if (kind === 'neighbors') return eigrpNeighbors(e, d, protocol, config, vrf, a);
    if (kind === 'topology') return eigrpTopology(e, d, protocol, config, vrf, a);
    if (kind === 'interfaces') return eigrpInterfaces(e, d, protocol, config, vrf, a);
    return undefined;
  });
}
/** The "EIGRP-IPv4 Protocol for AS(n)" block shared by show eigrp protocols and show ip protocols. */
export function eigrpProtocolLines(d: Device, protocol: EigrpProtocol, config: any, indent = ''): string[] {
  const k: number[] = Array.isArray(config.metricWeights) && config.metricWeights.length ? config.metricWeights.map(Number) : [1, 0, 1, 0, 0];
  const weights = [0, 1, 2, 3, 4].map(i => `K${i + 1}=${k[i] ?? 0}`).join(', ') + (config.name ? `, K6=${k[5] ?? 0}` : '');
  const distance = config.distance ?? {}, active = config.activeTime === 0 ? 'disabled' : `${Math.round(Number(config.activeTime ?? 180000) / 60000)} min`;
  const lines = [`EIGRP-${ipFamily(protocol)}${config.name ? ` VR(${config.name}) Address-Family` : ''} Protocol for AS(${config.asn})`, `  Metric weight ${weights}`];
  if (config.name) lines.push('  Metric rib-scale 128', '  Metric version 64bit');
  lines.push('  Soft SIA disabled', '  NSF-aware route hold timer is 240', '  EIGRP NSF disabled', '     NSF signal timer is 20s', '     NSF converge timer is 120s', `  Router-ID: ${eigrpRouterId(d, protocol, config)}`);
  const stub: string[] = Array.isArray(config.stub) ? config.stub : config.stub ? ['connected', 'summary'] : [];
  if (stub.length) lines.push(`  Stub, ${stub.map(s => String(s).toLowerCase()).join(', ')}`);
  lines.push('  Topology : 0 (base)', `    Active Timer: ${active}`, `    Distance: internal ${Number(distance.internal ?? distance.global ?? 90)} external ${Number(distance.external ?? 170)}`, `    Maximum path: ${Number(config.maximumPaths ?? (protocol === 'eigrp6' ? 16 : 4))}`, `    Maximum hopcount ${Number(config.maximumHops ?? 100)}`, `    Maximum metric variance ${Number(config.variance ?? 1)}`);
  return lines.map(line => indent + line);
}

// ---------------------------------------------------------------- BGP
const bgpStateName = (value: string | undefined) => ({ ESTABLISHED: 'Established', IDLE: 'Idle', CONNECT: 'Connect', ACTIVE: 'Active', OPENSENT: 'OpenSent', OPENCONFIRM: 'OpenConfirm' } as Record<string, string>)[value ?? ''] ?? (/MAX-PREFIX/i.test(value ?? '') ? 'Idle (PfxCt)' : 'Idle');
const bgpTableVersion = (rows: any[]) => 1 + rows.filter(r => r.best).length;
const bgpRouterId = (d: Device, config: any) => config.routerId || highestRouterId(d, 'bgp');
function bgpNetwork(r: any): string {
  if (!isIPv4(r.network)) return `${r.network}/${r.prefix}`;
  if (r.prefix === 0 && r.network === '0.0.0.0') return r.network;
  return r.prefix === classfulPrefix(r.network) && r.prefix < 32 ? r.network : `${r.network}/${r.prefix}`;
}
function bgpPeerState(n: any, s: any): string { return n.shutdown ? 'Idle (Admin)' : bgpStateName(s?.state); }
function bgpUpDown(now: number, s: any): string {
  if (s?.state === 'ESTABLISHED' && s.establishedAt !== undefined) return uptime(now - s.establishedAt);
  return s?.stats?.resetAt !== undefined ? uptime(now - s.stats.resetAt) : 'never';
}
/** show ip bgp summary */
export function bgpSummaryLines(e: Simulator, d: Device, config: any, rows: any[], sessions: any[], peers: any[]): string[] {
  const now = e.clock.now(), version = bgpTableVersion(rows), attributes = (list: any[]) => new Set(list.map(r => JSON.stringify([r.nextHop, r.asPath ?? [], r.originCode, r.med, r.localPreference, r.communities ?? []]))).size;
  const nets = new Set(rows.map(r => `${r.network}/${r.prefix}`)).size, paths = rows.length, attrs = attributes(rows), best = attributes(rows.filter(r => r.best)), asPaths = new Set(rows.map(r => (r.asPath ?? []).join(' '))).size;
  const lines = [`BGP router identifier ${bgpRouterId(d, config)}, local AS number ${config.asn}`, `BGP table version is ${version}, main routing table version ${version}`];
  if (paths) {
    const bytes = [nets * 144, paths * 80, attrs * 144, asPaths * 24];
    lines.push(`${nets} network entries using ${bytes[0]} bytes of memory`, `${paths} path entries using ${bytes[1]} bytes of memory`, `${attrs}/${best} BGP path/bestpath attribute entries using ${bytes[2]} bytes of memory`, `${asPaths} BGP AS-PATH entries using ${bytes[3]} bytes of memory`, '0 BGP route-map cache entries using 0 bytes of memory', '0 BGP filter-list cache entries using 0 bytes of memory', `BGP using ${bytes.reduce((x, y) => x + y, 0)} total bytes of memory`, `BGP activity ${nets}/0 prefixes, ${paths}/0 paths, scan interval 60 secs`);
  }
  lines.push('', 'Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd');
  for (const n of [...peers].sort((x, y) => isIPv4(x.address) && isIPv4(y.address) ? byIp(x.address, y.address) : natural(x.address, y.address))) {
    const s = sessions.find(x => x.neighbor === n.address), established = s?.state === 'ESTABLISHED' && !n.shutdown;
    const address = String(n.address), stats = '4' + lpad(n.remoteAs, 13) + ' ' + lpad(s?.messagesReceived ?? 0, 7) + ' ' + lpad(s?.messagesSent ?? 0, 7) + ' ' + lpad(established ? version : 1, 8) + lpad(0, 5) + lpad(0, 5) + ' ' + pad(bgpUpDown(now, s), 8) + (established ? lpad(s.receivedPrefixes ?? 0, 9) : ' ' + bgpPeerState(n, s));
    if (address.length > 15) lines.push(address, ' '.repeat(16) + stats); else lines.push(pad(address, 16) + stats);
  }
  return lines;
}
/** show ip bgp (table view) */
export function bgpTableLines(d: Device, config: any, rows: any[]): string[] {
  const lines = [`BGP table version is ${bgpTableVersion(rows)}, local router ID is ${bgpRouterId(d, config)}`,
    'Status codes: s suppressed, d damped, h history, * valid, > best, i - internal, ', '              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter, ', '              x best-external, a additional-path, c RIB-compressed, ', '              t secondary path, L long-lived-stale,',
    'Origin codes: i - IGP, e - EGP, ? - incomplete', 'RPKI validation codes: V valid, I invalid, N Not found', '', '     Network          Next Hop            Metric LocPrf Weight Path'];
  const defaultLocal = Number(config.defaultLocalPreference ?? 100);
  const sorted = [...rows].sort((x, y) => (isIPv4(x.network) && isIPv4(y.network) ? byIp(x.network, y.network) : natural(x.network, y.network)) || x.prefix - y.prefix || Number(!!y.best) - Number(!!x.best));
  let previous = '';
  for (const r of sorted) {
    const net = bgpNetwork(r), shown = net === previous ? '' : net; previous = net;
    const status = ' ' + (r.suppressed ? 's' : r.damped ? 'd' : '*') + (r.best ? '>' : r.multipath ? 'm' : ' ') + (r.learnedVia === 'ibgp' ? 'i' : ' ') + ' ';
    const local = r.learnedVia === 'ibgp' || r.localPreference !== undefined && Number(r.localPreference) !== defaultLocal ? String(r.localPreference ?? defaultLocal) : '';
    const metric = typeof r.med === 'number' ? String(r.med) : r.learnedVia ? '' : '0', weight = r.weight ?? (r.learnedVia ? 0 : 32768), path = (r.asPath ?? []).join(' ');
    const nextHop = String(r.nextHop ?? '0.0.0.0'), tail = lpad(metric, 10) + lpad(local, 7) + lpad(weight, 7) + ' ' + (path ? path + ' ' : '') + (r.originCode ?? '?');
    const head = shown.length > 16 ? [status + shown, ' '.repeat(22)] : [status + pad(shown, 17)];
    if (nextHop.length > 15) lines.push(...head.slice(0, -1), head.at(-1)! + nextHop, ' '.repeat(38) + tail);
    else lines.push(...head.slice(0, -1), head.at(-1)! + pad(nextHop, 16) + tail);
  }
  return lines;
}
/** show ip bgp <prefix> */
export function bgpEntryLines(e: Simulator, d: Device, config: any, selected: any[], prefix: number, allRows: any[], vrf?: string): string[] {
  const version = bgpTableVersion(allRows), bestIndex = selected.findIndex(r => r.best) + 1, rid = bgpRouterId(d, config);
  const ribOut: Record<string, any[]> = d.runtime.features.bgpAdjRibOut ?? {};
  const advertised = Object.entries(ribOut).some(([peer, routes]) => (vrf ? peer.startsWith(vrf + '|') : !peer.includes('|')) && (routes ?? []).some((r: any) => r.network === selected[0].network && r.prefix === prefix));
  const lines = [`BGP routing table entry for ${selected[0].network}/${prefix}, version ${version}`, `Paths: (${selected.length} available, ${bestIndex ? `best #${bestIndex}` : 'no best path'}${vrf ? `, table ${vrf}` : ', table default'})`];
  lines.push(...(advertised ? ['  Advertised to update-groups:', '     1         '] : ['  Not advertised to any peer']));
  for (const r of selected) {
    const peer = r.from ? d.runtime.neighbors.find(n => n.deviceId === r.from && n.protocol === 'BGP') : undefined;
    const fromAddress = peer?.address ?? (r.learnedVia ? String(r.from) : '0.0.0.0'), fromId = r.learnedVia ? r.routerId ?? peer?.routerId ?? fromAddress : rid;
    const kind = r.learnedVia === 'ibgp' ? 'internal' : r.learnedVia === 'ebgp' ? 'external' : 'sourced, local';
    const weight = r.weight ?? (r.learnedVia ? 0 : 32768);
    lines.push('  Refresh Epoch 1', `  ${r.asPath?.length ? r.asPath.join(' ') : 'Local'}`, `    ${r.nextHop ?? '0.0.0.0'} from ${fromAddress} (${fromId})`);
    lines.push(`      Origin ${r.originCode === 'i' ? 'IGP' : r.originCode === 'e' ? 'EGP' : 'incomplete'}, metric ${r.med ?? 0}, localpref ${r.localPreference ?? config.defaultLocalPreference ?? 100}${weight ? `, weight ${weight}` : ''}, valid, ${kind}${r.multipath ? r.best ? ', multipath(oldest)' : ', multipath' : ''}${r.best ? ', best' : ''}`);
    if (r.communities?.length) lines.push('      Community: ' + r.communities.map((v: string) => displayCommunity(v, !!d.config.features.bgpCommunityNewFormat)).join(' '));
    if (r.originatorId || r.clusterList?.length) lines.push(`      ${r.originatorId ? `Originator: ${r.originatorId}` : ''}${r.originatorId && r.clusterList?.length ? ', ' : ''}${r.clusterList?.length ? `Cluster list: ${r.clusterList.join(' ')}` : ''}`);
    lines.push(`      rx pathid: 0, tx pathid: ${r.best ? '0x0' : '0'}`);
  }
  return lines;
}
/** show ip bgp neighbors X advertised-routes | received-routes | routes */
export function bgpAdjRibLines(d: Device, config: any, view: string, values: any[], rows: any[], peerAddress: string, internal: boolean): string[] {
  const peer = d.runtime.neighbors.find(n => n.protocol === 'BGP' && n.address === peerAddress);
  const shown = view === 'advertised-routes'
    ? values.map(r => rows.find(x => x.best && x.network === r.network && x.prefix === r.prefix) ?? { ...r, best: true })
    : view === 'received-routes'
      ? values.map(r => ({ ...r, learnedVia: r.learnedVia ?? (internal ? 'ibgp' : 'ebgp'), weight: r.weight ?? 0, best: rows.some(x => x.best && x.network === r.network && x.prefix === r.prefix && peer && x.from === peer.deviceId) }))
      : values;
  if (!shown.length) return [];
  return [...bgpTableLines(d, config, shown), '', `Total number of prefixes ${shown.length} `];
}
/** show ip bgp neighbors [address] */
export function bgpNeighborLines(e: Simulator, d: Device, config: any, sessions: any[], selected: any[], rows: any[], family: 4 | 6, vrf?: string): string[] {
  const now = e.clock.now(), version = bgpTableVersion(rows);
  return selected.flatMap((n: any) => {
    const s = sessions.find(x => x.neighbor === n.address), established = s?.state === 'ESTABLISHED' && !n.shutdown, internal = String(n.remoteAs) === String(config.asn);
    const runtime = d.runtime.neighbors.find(p => p.protocol === 'BGP' && p.address === n.address);
    const hold = Number(s?.negotiatedHold ?? n.timers?.hold ?? config.timers?.hold ?? 180), configuredKeepalive = Number(n.timers?.keepalive ?? config.timers?.keepalive ?? 60);
    const keepalive = established && hold ? Math.min(configuredKeepalive, Math.floor(hold / 3)) : configuredKeepalive;
    const lastRead = s?.lastReceived !== undefined ? hms(now - s.lastReceived) : 'never';
    const lastWrite = established && keepalive ? hms(((now - s.establishedAt) % (keepalive * 1000))) : 'never';
    const stats = s?.stats ?? { sent: {}, received: {}, established: 0, dropped: 0 }, count = (direction: 'sent' | 'received', type: string) => Number(stats[direction]?.[type] ?? 0);
    const total = (direction: 'sent' | 'received') => Object.values<number>(stats[direction] ?? {}).reduce((x, y) => x + Number(y), 0);
    const key = vrf ? `${vrf}|${n.address}` : n.address, out = (d.runtime.features.bgpAdjRibOut?.[key] ?? []).filter((r: any) => isIPv6(r.network) === (family === 6)).length;
    const received = Number(s?.receivedPrefixes ?? 0), bestFrom = runtime ? rows.filter(r => r.best && r.from === runtime.deviceId).length : 0;
    const stat = (label: string, sent: unknown, rcvd: unknown) => pad(`    ${label}:`, 20) + lpad(sent, 9) + lpad(rcvd, 11);
    const lines = [`BGP neighbor is ${n.address},  ${vrf ? `vrf ${vrf},  ` : ''}remote AS ${n.remoteAs}, ${internal ? 'internal' : 'external'} link`];
    if (n.description) lines.push(` Description: ${n.description}`);
    if (n.routeReflectorClient) lines.push('  Route-Reflector Client');
    lines.push(`  BGP version 4, remote router ID ${established ? runtime?.routerId ?? '0.0.0.0' : '0.0.0.0'}`, `  BGP state = ${n.shutdown ? 'Idle (Admin)' : bgpStateName(s?.state)}${established && s.establishedAt !== undefined ? `, up for ${uptime(now - s.establishedAt)}` : ''}`);
    lines.push(`  Last read ${lastRead}, last write ${lastWrite}, hold time is ${hold}, keepalive interval is ${keepalive} seconds`);
    if (established) lines.push('  Neighbor sessions:', '    1 active, is not multisession capable (disabled)', '  Neighbor capabilities:', '    Route refresh: advertised and received(new)', '    Four-octets ASN Capability: advertised and received', `    Address family IPv${family} Unicast: advertised and received`, '    Enhanced Refresh Capability: advertised and received', '    Multisession Capability: ', '    Stateful switchover support enabled: NO for session 1');
    lines.push('  Message statistics:', '    InQ depth is 0', '    OutQ depth is 0', '', '                         Sent       Rcvd',
      stat('Opens', count('sent', 'OPEN'), count('received', 'OPEN')), stat('Notifications', count('sent', 'NOTIFICATION'), count('received', 'NOTIFICATION')), stat('Updates', count('sent', 'UPDATE'), count('received', 'UPDATE')), stat('Keepalives', count('sent', 'KEEPALIVE'), count('received', 'KEEPALIVE')), stat('Route Refresh', count('sent', 'ROUTE-REFRESH'), count('received', 'ROUTE-REFRESH')), stat('Total', Math.max(total('sent'), Number(s?.messagesSent ?? 0)), Math.max(total('received'), Number(s?.messagesReceived ?? 0))));
    lines.push(`  Default minimum time between advertisement runs is ${internal ? 0 : 30} seconds`, '');
    lines.push(` For address family: IPv${family} Unicast`, `  Session: ${n.address}`, `  BGP table version ${version}, neighbor version ${established ? version : 1}/0`, '  Output queue size : 0', '  Index 1, Advertise bit 0', '  1 update-group member');
    if (n.softReconfigurationInbound) lines.push('  Inbound soft reconfiguration allowed');
    if (n.nextHopSelf) lines.push('  NEXT_HOP is always this router for eBGP paths');
    if (n.routeReflectorClient) lines.push('  Route-Reflector Client');
    if (n.routeMapIn) lines.push(`  Route map for incoming advertisements is ${n.routeMapIn}`);
    if (n.routeMapOut) lines.push(`  Route map for outgoing advertisements is ${n.routeMapOut}`);
    if (n.prefixListIn) lines.push(`  Incoming update prefix filter list is ${n.prefixListIn}`);
    if (n.prefixListOut) lines.push(`  Outgoing update prefix filter list is ${n.prefixListOut}`);
    lines.push('  Slow-peer detection is disabled', '  Slow-peer split-update-group dynamic is disabled',
      '                                 Sent       Rcvd', '  Prefix activity:               ----       ----',
      pad('    Prefixes Current:', 32) + lpad(out, 5) + lpad(received, 11) + (received ? ` (Consumes ${received * 56} bytes)` : ''),
      pad('    Prefixes Total:', 32) + lpad(out, 5) + lpad(received, 11), pad('    Implicit Withdraw:', 32) + lpad(0, 5) + lpad(0, 11), pad('    Explicit Withdraw:', 32) + lpad(0, 5) + lpad(0, 11),
      pad('    Used as bestpath:', 32) + lpad('n/a', 5) + lpad(bestFrom, 11), pad('    Used as multipath:', 32) + lpad('n/a', 5) + lpad(0, 11), '',
      '                                   Outbound    Inbound', '  Local Policy Denied Prefixes:    --------    -------', pad('    Total:', 34) + lpad(0, 9) + lpad(0, 11), '  Number of NLRIs in the update sent: max 0, min 0', '  Last detected as dynamic slow peer: never', '  Dynamic slow peer recovered: never', '');
    const reachable = resolveForwardingPaths(d, n.address, vrf, port => e.interfaceUp(d.id, port)).some(path => !/^Null/i.test(path.port));
    lines.push(`  Address tracking is enabled, the RIB does ${reachable ? '' : 'not '}have a route to ${n.address}`, `  Connections established ${stats.established ?? 0}; dropped ${stats.dropped ?? 0}`, `  Last reset ${stats.resetAt !== undefined ? hms(now - stats.resetAt) : 'never'}${stats.resetAt !== undefined && stats.resetReason ? `, due to ${stats.resetReason}` : ''}`);
    if (!internal) {
      lines.push(`  External BGP neighbor ${n.ebgpMultihop ? `may be up to ${n.ebgpMultihop} hops away` : 'configured for connected checks (single-hop no-disable-connected-check)'}`);
      if (!n.ebgpMultihop && runtime?.interface) lines.push(`  Interface associated: ${runtime.interface} (peering address in same link)`);
    }
    lines.push('  Transport(tcp) path-mtu-discovery is enabled', '  Graceful-Restart is disabled');
    const t = s?.transport;
    if (established && t) {
      const local = t.localPort === 179;
      lines.push('Connection state is ESTAB, I/O status: 1, unread input bytes: 0', `Connection is ECN Disabled, Mininum incoming TTL 0, Outgoing TTL ${internal || n.ebgpMultihop ? 255 : 1}`, `Local host: ${t.localAddress}, Local port: ${local ? 179 : t.localPort}`, `Foreign host: ${n.address}, Foreign port: ${local ? t.peerPort : 179}`, `Connection tableid (VRF): ${vrf ? 1 : 0}`, 'Maximum output segment queue size: 50', '', 'Enqueued packets for retransmit: 0, input: 0  mis-ordered: 0 (0 bytes)', '');
    } else lines.push('  No active TCP connection', '');
    return lines;
  });
}

// ---------------------------------------------------------------- HSRP / VRRP / GLBP
type FhrpProtocol = 'hsrp' | 'vrrp' | 'glbp';
const dottedMac = (mac: string | undefined) => { const hexes = String(mac ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase().padStart(12, '0'); return `${hexes.slice(0, 4)}.${hexes.slice(4, 8)}.${hexes.slice(8, 12)}`; };
const fhrpTime = (ms: number) => ms % 1000 ? `${ms} msec` : `${ms / 1000} sec`;
const expiresIn = (now: number, expires: number) => `${(Math.max(0, expires - now) / 1000).toFixed(3)} sec`;
function fhrpAuthentication(protocol: FhrpProtocol, auth: any): string[] {
  if (!auth) return [];
  if (String(auth.mode).toLowerCase() === 'md5') return [`  Authentication MD5, ${auth.keyChain ? `key-chain "${auth.keyChain}"` : protocol === 'vrrp' ? `key-string "${auth.key ?? ''}"` : 'key-string'}`];
  return [`  Authentication text, string "${auth.key ?? ''}"`];
}
/** show standby | vrrp | glbp [interface] [group] [brief|all] */
export function fhrpShow(e: Simulator, d: Device, protocol: FhrpProtocol, args: readonly string[]): string[] | undefined {
  return guard(() => {
    const a = [...args], now = e.clock.now();
    let brief = false, all = false, port: string | undefined, group: number | undefined;
    const maxGroup = protocol === 'hsrp' ? 4095 : protocol === 'vrrp' ? 255 : 1023, minGroup = protocol === 'vrrp' ? 1 : 0;
    while (a.length) {
      if (['brief', 'all', 'interface'].some(k => k.startsWith(a[0].toLowerCase()))) { const key = word(a.shift(), ['brief', 'all', 'interface']); if (key === 'brief') brief = true; else if (key === 'all') all = true; else port = takePort(d, a); }
      else if (/^\d+$/.test(a[0])) { const value = Number(a.shift()); if (value < minGroup || value > maxGroup) return invalid(); group = value; }
      else if (!port) port = takePort(d, a);
      else return invalid();
    }
    const configured: any[] = (d.config.features.fhrp ?? []).filter((c: any) => c.protocol === protocol && (!port || port === c.interface) && (group === undefined || group === Number(c.group)));
    const runtime: any[] = (protocol === 'glbp' ? d.runtime.features.glbpGroups : d.runtime.features.virtualIps) ?? [];
    const rows = configured.map(c => ({ c, r: runtime.find((r: any) => r.interface === c.interface && r.group === c.group && (protocol === 'glbp' || r.protocol === protocol)) }))
      .filter(x => all || x.r).sort((x, y) => natural(x.c.interface, y.c.interface) || Number(x.c.group) - Number(y.c.group));
    const stateName = (role: string | undefined) => protocol === 'vrrp' ? role === 'active' ? 'Master' : role === 'standby' || role === 'listen' ? 'Backup' : 'Init' : role ? role[0].toUpperCase() + role.slice(1) : 'Init';
    const peers = (c: any) => (d.runtime.features.fhrpPeers ?? []).filter((p: any) => String(p.id).startsWith(`${protocol}|${c.interface}|${c.group}|${c.virtualIp}|`) && p.expires > now);
    const peerOf = (c: any, id: string | undefined) => id && id !== d.id ? peers(c).find((p: any) => p.deviceId === id) : undefined;
    const address = (c: any, id: string | undefined) => id === d.id ? 'local' : peerOf(c, id)?.source ?? 'unknown';
    const standbyPeer = (c: any) => peers(c).find((p: any) => String(p.state).toLowerCase() === 'standby');
    const standby = (c: any, r: any) => r?.role === 'standby' ? 'local' : standbyPeer(c)?.source ?? 'unknown';
    const ownIp = (c: any) => d.config.interfaces[c.interface]?.ip ?? '0.0.0.0';
    const priorityOf = (c: any, r: any) => Number(r?.priority ?? c.priority ?? 100);
    const advertisement = (c: any) => Number(c.helloTime ?? (protocol === 'vrrp' ? 1000 : 3000));
    const masterDown = (c: any, r: any) => 3 * advertisement(c) + Math.floor((256 - priorityOf(c, r)) * advertisement(c) / 256);
    const preempt = (c: any) => c.preempt ?? protocol === 'vrrp';
    if (brief) {
      if (protocol === 'hsrp') return ['                     P indicates configured to preempt.', '                     |', 'Interface   Grp  Pri P State   Active          Standby         Virtual IP',
        ...rows.map(({ c, r }) => pad(shortInterfaceName(c.interface), 12) + pad(c.group, 5) + pad(priorityOf(c, r), 4) + (preempt(c) ? 'P' : ' ') + ' ' + pad(stateName(r?.role), 8) + pad(address(c, r?.activeDeviceId), 16) + pad(standby(c, r), 16) + c.virtualIp)];
      if (protocol === 'vrrp') return ['Interface          Grp Pri Time  Own Pre State   Master addr     Group addr',
        ...rows.map(({ c, r }) => {
          const own = ownIp(c) === c.virtualIp, master = r?.activeDeviceId === d.id ? ownIp(c) : peerOf(c, r?.activeDeviceId)?.source ?? 'unknown';
          return pad(shortInterfaceName(c.interface), 19) + pad(c.group, 4) + pad(priorityOf(c, r), 4) + pad(masterDown(c, r), 6) + pad(own ? ' Y' : '', 4) + pad(preempt(c) ? ' Y' : '', 4) + pad(stateName(r?.role), 8) + pad(master, 16) + pad(c.virtualIp, 15);
        })];
      return ['Interface   Grp  Fwd Pri State    Address         Active router   Standby router', ...rows.flatMap(({ c, r }) => [
        pad(shortInterfaceName(c.interface), 12) + pad(c.group, 5) + pad('-', 4) + pad(priorityOf(c, r), 4) + pad(stateName(r?.role), 9) + pad(c.virtualIp, 16) + pad(address(c, r?.activeDeviceId), 16) + standby(c, r),
        ...(r?.forwarders ?? []).map((f: any) => pad(shortInterfaceName(c.interface), 12) + pad(c.group, 5) + pad(f.id, 4) + pad(7, 4) + pad(f.deviceId === d.id ? 'Active' : 'Listen', 9) + pad(dottedMac(f.mac), 16) + pad(address(c, f.deviceId), 16) + '-')])];
    }
    return rows.flatMap(({ c, r }) => {
      const state = stateName(r?.role), priority = priorityOf(c, r), lines: string[] = [];
      if (protocol === 'vrrp') {
        const local = r?.activeDeviceId === d.id, master = peerOf(c, r?.activeDeviceId);
        lines.push(`${c.interface} - Group ${c.group}  `, `  State is ${pad(state, 8)}`, `  Virtual IP address is ${c.virtualIp}`, `  Virtual MAC address is ${dottedMac(r?.mac ?? `00005e0001${hex(Number(c.group), 2)}`)}`, `  Advertisement interval is ${(advertisement(c) / 1000).toFixed(3)} sec`, `  Preemption ${preempt(c) ? 'enabled' : 'disabled'}${preempt(c) && c.preemptDelay ? `, delay min ${c.preemptDelay} secs` : ''}`, `  Priority is ${priority} `, ...fhrpAuthentication(protocol, c.authentication));
        lines.push(local ? `  Master Router is ${ownIp(c)} (local), priority is ${priority} ` : master ? `  Master Router is ${master.source}, priority is ${master.priority} ` : '  Master Router is unknown, priority is unknown ');
        lines.push(`  Master Advertisement interval is ${(advertisement(c) / 1000).toFixed(3)} sec`, `  Master Down interval is ${(masterDown(c, r) / 1000).toFixed(3)} sec${!local && master ? ` (expires in ${expiresIn(now, master.expires)})` : ''}`, '');
        return lines;
      }
      const version = Number(r?.version ?? c.version ?? d.config.interfaces[c.interface]?.features.hsrpVersion ?? 1);
      lines.push(`${c.interface} - Group ${c.group}${protocol === 'hsrp' && version === 2 ? ' (version 2)' : ''}`, `  State is ${state}`, `  Virtual IP address is ${c.virtualIp}`);
      const active = r?.activeDeviceId === d.id ? undefined : peerOf(c, r?.activeDeviceId), stand = r?.role === 'standby' ? undefined : standbyPeer(c);
      const activeLine = (label: string) => r?.activeDeviceId === d.id ? [`  ${label} is local`] : active ? [`  ${label} is ${active.source}, priority ${active.priority} (expires in ${expiresIn(now, active.expires)})`] : [`  ${label} is unknown`];
      const standbyLine = (label: string) => r?.role === 'standby' ? [`  ${label} is local`] : stand ? [`  ${label} is ${stand.source}, priority ${stand.priority} (expires in ${expiresIn(now, stand.expires)})`] : [`  ${label} is unknown`];
      if (protocol === 'hsrp') {
        const defaultMac = version === 2 ? `00000c9ff${hex(Number(c.group), 3)}` : `00000c07ac${hex(Number(c.group), 2)}`;
        lines.push(`  Active virtual MAC address is ${r?.activeDeviceId ? dottedMac(r?.mac ?? defaultMac) : 'unknown'} (MAC ${r?.role === 'active' ? 'In Use' : 'Not In Use'})`, `    Local virtual MAC address is ${dottedMac(r?.mac ?? defaultMac)} (v${version} default)`);
        lines.push(`  Hello time ${fhrpTime(Number(c.helloTime ?? 3000))}, hold time ${fhrpTime(Number(c.holdTime ?? 10000))}`, ...fhrpAuthentication(protocol, c.authentication));
        lines.push(`  Preemption ${preempt(c) ? `enabled${c.preemptDelay ? `, delay min ${c.preemptDelay} secs` : ''}` : 'disabled'}`, ...activeLine('Active router'));
        if (active) lines.push(`    MAC address is ${dottedMac(e.macOf(active.deviceId, active.peerInterface))}`);
        lines.push(...standbyLine('Standby router'), `  Priority ${priority} (${c.priority !== undefined ? `configured ${c.priority}` : 'default 100'})`, `  Group name is "hsrp-${shortInterfaceName(c.interface)}-${c.group}" (default)`, '');
        return lines;
      }
      const forwarders: any[] = r?.forwarders ?? [];
      lines.push(`  Hello time ${fhrpTime(Number(c.helloTime ?? 3000))}, hold time ${fhrpTime(Number(c.holdTime ?? 10000))}`, '  Redirect time 600 sec, forwarder time-out 14400 sec', ...fhrpAuthentication(protocol, c.authentication));
      lines.push(`  Preemption ${preempt(c) ? `enabled, min delay ${Number(c.preemptDelay ?? 0)} sec` : 'disabled'}`, ...activeLine('Active'), ...standbyLine('Standby'), `  Priority ${priority} (${c.priority !== undefined ? 'configured' : 'default'})`);
      const weight = Number(r?.weight ?? c.weighting?.maximum ?? c.weighting ?? 100);
      lines.push(`  Weighting ${weight} (${c.weighting !== undefined ? `configured ${Number(c.weighting?.maximum ?? c.weighting)}` : 'default 100'}), thresholds: lower ${Number(c.weighting?.lower ?? 1)}, upper ${Number(c.weighting?.upper ?? c.weighting?.maximum ?? 100)}`, `  Load balancing: ${r?.loadBalancing ?? c.loadBalancing ?? 'round-robin'}`);
      const activeForwarders = forwarders.filter(f => f.deviceId === d.id).length;
      lines.push(`  There ${forwarders.length === 1 ? 'is 1 forwarder' : `are ${forwarders.length} forwarders`} (${activeForwarders} active)`);
      for (const f of forwarders) {
        const mine = f.deviceId === d.id, owner = peers(c).find((p: any) => p.deviceId === f.deviceId);
        lines.push(`  Forwarder ${f.id}`, `    State is ${mine ? 'Active' : 'Listen'}`, `    MAC address is ${dottedMac(f.mac)} (${mine ? 'default' : 'learnt'})`, `    Owner ID is ${dottedMac(mine ? e.macOf(d.id, c.interface) : owner ? e.macOf(owner.deviceId, owner.peerInterface) : f.mac)}`, '    Redirection enabled');
        lines.push('    Preemption enabled, min delay 30 sec', mine ? `    Active is local, weighting ${Number(f.weight ?? weight)}` : `    Active is ${owner?.source ?? 'unknown'} (primary), weighting ${Number(f.weight ?? 100)}${owner ? ` (expires in ${expiresIn(now, owner.expires)})` : ''}`);
      }
      lines.push('');
      return lines;
    });
  });
}

// ---------------------------------------------------------------- RIP
const ripSources = (d: Device, vrf?: string) => ((d.runtime.features.ripDatabase ?? []) as any[]).filter(r => sameVrf(r.vrf, vrf));
/** show ip rip database [prefix mask] */
export function ripDatabaseShow(e: Simulator, d: Device, args: readonly string[]): string[] | undefined {
  return guard(() => {
    const a = [...args];
    let wanted: { network: string; prefix: number } | undefined;
    if (a.length) {
      if (a.length !== 2 || !isIPv4(a[0]) || !isIPv4(a[1])) return a.length === 1 && isIPv4(a[0]) ? incomplete() : invalid();
      let prefix: number; try { prefix = maskToPrefix(a[1]); } catch { return invalid(); }
      wanted = { network: a[0], prefix };
    }
    if (!d.config.protocols.rip) return [];
    const now = e.clock.now(), rows = ripSources(d).filter(r => !wanted || r.network === wanted.network && r.prefix === wanted.prefix).sort((x, y) => byIp(x.network, y.network) || x.prefix - y.prefix);
    const lines: string[] = [], majors = new Set<string>();
    for (const r of rows) {
      const major = classfulPrefix(r.network), net = intToIp((ipToInt(r.network) & ipToInt(prefixToMask(major))) >>> 0);
      if (!wanted && r.prefix > major && !majors.has(net)) { majors.add(net); lines.push(`${net}/${major}    auto-summary`); }
      const label = `${r.network}/${r.prefix}`;
      if (r.origin === 'local' && r.interface) lines.push(`${label}    directly connected, ${r.interface}`);
      else if (r.origin === 'local') lines.push(`${label}    redistributed`, `    [${Number(r.metric)}] via 0.0.0.0, `);
      else lines.push(label, `    [${Number(r.metric)}] via ${r.source}, ${hms(now - Number(r.lastUpdate ?? now))}, ${r.interface}`);
    }
    return lines;
  });
}

// ---------------------------------------------------------------- show ip protocols
const sourceHeader = ['  Routing Information Sources:', '    Gateway         Distance      Last Update'];
const sourceRow = (gateway: string, distance: number, ms: number) => '    ' + pad(gateway, 16) + lpad(distance, 8) + '      ' + hms(ms);
function redistributeList(config: any): string[] {
  const list: any[] = Array.isArray(config?.redistribute) ? config.redistribute : config?.redistribute ? [config.redistribute] : [];
  return list.map(r => typeof r === 'string' ? r : `${r.protocol}${r.asn ?? r.processId ?? r.process ? ' ' + (r.asn ?? r.processId ?? r.process) : ''}`);
}
function passiveLines(d: Device, config: any, members: string[]): string[] {
  const list = members.filter(name => isPassive(config, name));
  return list.length ? ['  Passive Interface(s):', ...list.map(name => '    ' + name)] : [];
}
function classfulNetwork(n: any): string { return isIPv4(n.network) && Number(n.prefix) === classfulPrefix(n.network) ? n.network : `${n.network}/${n.prefix}`; }
function eigrpIpProtocols(e: Simulator, d: Device, config: any): string[] {
  const now = e.clock.now(), redistribute = redistributeList(config), members = ports(d).filter(p => !p.vrf && eigrpMember('eigrp', config, p)).map(p => p.name);
  const lines = [`Routing Protocol is "eigrp ${config.asn}"`, ...updateFilterLines(config), '  Default networks flagged in outgoing updates', '  Default networks accepted from incoming updates'];
  if (redistribute.length) lines.push(`  Redistributing: ${redistribute.join(', ')}`);
  lines.push(...eigrpProtocolLines(d, 'eigrp', config, '  '), '', `  Automatic Summarization: ${config.autoSummary ? 'enabled' : 'disabled'}`, `  Maximum path: ${Number(config.maximumPaths ?? 4)}`, '  Routing for Networks:', ...[...(config.networks ?? [])].sort((x: any, y: any) => byIp(x.network, y.network) || x.prefix - y.prefix).map((n: any) => '    ' + classfulNetwork(n)));
  lines.push(...passiveLines(d, config, members), ...sourceHeader);
  for (const n of eigrpPeers(d, 'eigrp').sort((x, y) => byIp(x.address, y.address))) {
    const hello = (d.runtime.features.eigrpHelloNeighbors ?? []).find((h: any) => h.interface === n.interface && sameAddress(String(h.address), n.address));
    lines.push(sourceRow(n.address, Number(config.distance?.internal ?? 90), now - Number(n.establishedAt ?? hello?.since ?? now)));
  }
  lines.push(`  Distance: internal ${Number(config.distance?.internal ?? 90)} external ${Number(config.distance?.external ?? 170)}`, '');
  return lines;
}
function ospfIpProtocols(e: Simulator, d: Device, config: any): string[] {
  const v = ospfView(e, d, 'ospf', config), areas = [...new Set(v.ports.map(p => p.area))].sort((x, y) => Number(x) - Number(y));
  const counts = { normal: 0, stub: 0, nssa: 0 } as Record<string, number>; for (const area of areas) counts[areaKind(v, area)]++;
  const abr = new Set(v.ports.filter(p => p.up).map(p => p.area)).size > 1, redistribute = redistributeList(config), asbr = redistribute.length > 0 || !!config.defaultInformationOriginate || !!config.defaultInformation;
  const lines = [`Routing Protocol is "ospf ${v.pid}"`, ...updateFilterLines(config), `  Router ID ${v.rid}`];
  if (abr || asbr) lines.push(`  It is an ${abr && asbr ? 'area border and autonomous system boundary' : abr ? 'area border' : 'autonomous system boundary'} router`);
  if (redistribute.length) lines.push('  Redistributing External Routes from,', ...redistribute.map(r => `    ${r}`));
  lines.push(`  Number of areas in this router is ${areas.length}. ${counts.normal} normal ${counts.stub} stub ${counts.nssa} nssa`, `  Maximum path: ${Number(config.maximumPaths ?? 4)}`);
  const networks: any[] = (config.networks ?? []).filter((n: any) => n.area !== undefined);
  if (networks.length) lines.push('  Routing for Networks:', ...networks.map(n => `    ${n.network} ${wildcard(Number(n.prefix))} area ${n.area}`));
  for (const area of areas) {
    const explicit = v.ports.filter(p => p.area === area && p.viaInterface);
    if (explicit.length) lines.push(`  Routing on Interfaces Configured Explicitly (Area ${areaLabel(v, area)}):`, ...explicit.map(p => `    ${p.name}`));
  }
  lines.push(...passiveLines(d, config, v.ports.map(p => p.name)), ...sourceHeader);
  const distance = config.distance ?? {}, routers = new Map<string, number>();
  for (const lsa of ospfDatabaseEntries(v)) if (lsa.type === 1 && lsa.adv !== v.rid) routers.set(lsa.adv, Math.min(routers.get(lsa.adv) ?? Infinity, lsa.age));
  for (const [adv, age] of [...routers].sort((x, y) => byIp(x[0], y[0]))) lines.push(sourceRow(adv, Number(distance.global ?? distance.intraArea ?? 110), age * 1000));
  const custom = distance.intraArea !== undefined || distance.interArea !== undefined || distance.external !== undefined;
  lines.push(custom ? `  Distance: intra-area ${Number(distance.intraArea ?? distance.global ?? 110)} inter-area ${Number(distance.interArea ?? distance.global ?? 110)} external ${Number(distance.external ?? distance.global ?? 110)}` : `  Distance: (default is ${Number(distance.global ?? 110)})`, '');
  return lines;
}
function ripIpProtocols(e: Simulator, d: Device, config: any): string[] {
  const now = e.clock.now(), stats = d.runtime.features.ripStats, update = Number(stats?.timers?.update ?? Number(config.timers?.update ?? 30) * 1000);
  const origin = stats?.periodicOrigin, due = origin === undefined ? update / 1000 : Math.max(0, Math.ceil((update - ((now - origin) % update + update) % update) / 1000));
  const timers = { invalid: Number(config.timers?.invalid ?? 180), holddown: Number(config.timers?.holddown ?? 180), flush: Number(config.timers?.flush ?? 240) };
  const version = Number(config.version ?? 2), redistribute = redistributeList(config);
  const members = ports(d).filter(p => !p.vrf && p.ip && (config.networks ?? []).some((n: any) => prefixContains(n.network, Number(n.prefix), p.ip!)));
  const lines = [`Routing Protocol is "rip"`, ...updateFilterLines(config), `  Sending updates every ${update / 1000} seconds, next due in ${due} seconds`, `  Invalid after ${timers.invalid} seconds, hold down ${timers.holddown}, flushed after ${timers.flush}`];
  lines.push(`  Redistributing: ${['rip', ...redistribute].join(', ')}`);
  if (config.defaultOriginate) lines.push('  Default route originated');
  lines.push(`  Default version control: send version ${version}, receive version ${version}`, '    Interface                           Send  Recv  Triggered RIP  Key-chain');
  for (const p of members.filter(p => !isPassive(config, p.name) && e.interfaceUp(d.id, p.name))) {
    const f = p.features.rip ?? {}, send = (f.sendVersion ?? [version]).join(' '), receive = (f.receiveVersion ?? [version]).join(' ');
    lines.push(('    ' + pad(p.name, 36) + pad(send, 6) + pad(receive, 6) + (f.authenticationKeyChain ? ' '.repeat(15) + f.authenticationKeyChain : '')).trimEnd());
  }
  lines.push(`  Automatic network summarization is ${config.autoSummary || version === 1 ? '' : 'not '}in effect`, `  Maximum path: ${Number(config.maximumPaths ?? 4)}`, '  Routing for Networks:', ...[...(config.networks ?? [])].sort((x: any, y: any) => byIp(x.network, y.network)).map((n: any) => '    ' + n.network));
  lines.push(...passiveLines(d, config, members.map(p => p.name)), ...sourceHeader);
  const sources = new Map<string, number>();
  for (const r of ripSources(d)) if (r.origin === 'learned' && r.source) sources.set(r.source, Math.max(sources.get(r.source) ?? 0, Number(r.lastUpdate ?? 0)));
  for (const [source, last] of [...sources].sort((x, y) => byIp(x[0], y[0]))) lines.push(sourceRow(source, Number(config.distance ?? 120), now - last));
  lines.push(`  Distance: (default is ${Number(config.distance ?? 120)})`, '');
  return lines;
}
function bgpIpProtocols(e: Simulator, d: Device): string[] {
  const config = bgpAddressFamily(d, undefined, 4); if (!config) return [];
  const now = e.clock.now(), redistribute = redistributeList(config), distance = config.bgpDistance ?? {};
  const lines = [`Routing Protocol is "bgp ${config.asn}"`, ...updateFilterLines(config), '  IGP synchronization is disabled', '  Automatic route summarization is disabled'];
  if (redistribute.length) lines.push(`  Redistributing: ${redistribute.join(', ')}`);
  const neighbors: any[] = [...(config.neighbors ?? [])].sort((x, y) => byIp(x.address, y.address));
  if (neighbors.length) lines.push('  Neighbor(s):', '    Address          FiltIn FiltOut DistIn DistOut Weight RouteMap', ...neighbors.map(n => ('    ' + pad(n.address, 17) + pad(n.filterListIn ?? '', 7) + pad(n.filterListOut ?? '', 8) + pad(n.distributeListIn ?? '', 7) + pad(n.distributeListOut ?? '', 8) + pad(n.weight ?? '', 7) + (n.routeMapIn ?? '')).trimEnd()));
  lines.push(`  Maximum path: ${Number(config.maximumPaths ?? 1)}`);
  if (config.networks?.length) lines.push('  Routing for Networks:', ...[...config.networks].sort((x: any, y: any) => byIp(x.network, y.network) || x.prefix - y.prefix).map((n: any) => '    ' + (Number(n.prefix) === classfulPrefix(n.network) ? n.network : `${n.network} mask ${prefixToMask(Number(n.prefix))}`)));
  lines.push(...sourceHeader);
  const rows: any[] = (d.runtime.features.bgpTable ?? []).filter((r: any) => r.best && r.learnedVia && !r.vrf && isIPv4(r.network)), sessions: any[] = (d.runtime.features.bgpSessions ?? []).filter((s: any) => !s.vrf && (s.family ?? 4) === 4);
  for (const n of neighbors) {
    const peer = d.runtime.neighbors.find(x => x.protocol === 'BGP' && x.address === n.address), from = rows.filter(r => r.from === (peer?.deviceId ?? n.address)), s = sessions.find(x => x.neighbor === n.address);
    if (!from.length) continue;
    lines.push(sourceRow(n.address, from[0].learnedVia === 'ibgp' ? Number(distance.internal ?? 200) : Number(distance.external ?? 20), now - Number(s?.establishedAt ?? now)));
  }
  lines.push(`  Distance: external ${Number(distance.external ?? 20)} internal ${Number(distance.internal ?? 200)} local ${Number(distance.local ?? 200)}`, '');
  return lines;
}
function ipv6Protocols(e: Simulator, d: Device): string[] {
  const lines = ['IPv6 Routing Protocol is "connected"', 'IPv6 Routing Protocol is "application"', 'IPv6 Routing Protocol is "ND"'];
  for (const [key, config] of Object.entries<any>(d.config.protocols)) {
    if (key === 'ospfv3') {
      const v = ospfView(e, d, 'ospfv3', config), areas = [...new Set(v.ports.map(p => p.area))].sort((x, y) => Number(x) - Number(y));
      const counts = { normal: 0, stub: 0, nssa: 0 } as Record<string, number>; for (const area of areas) counts[areaKind(v, area)]++;
      const redistribute = redistributeList(config);
      lines.push(`IPv6 Routing Protocol is "ospf ${v.pid}"`, `  Router ID ${v.rid}`, `  Number of areas: ${counts.normal} normal, ${counts.stub} stub, ${counts.nssa} nssa`);
      for (const area of areas) lines.push(`  Interfaces (Area ${areaLabel(v, area)}):`, ...v.ports.filter(p => p.area === area).map(p => `    ${p.name}`));
      lines.push('  Redistribution:', ...(redistribute.length ? redistribute.map(r => `    Redistributing protocol ${r}`) : ['    None']));
    } else if (key === 'eigrp6' && config.asn !== undefined) {
      const members = ports(d).filter(p => !p.vrf && eigrpMember('eigrp6', config, p)), redistribute = redistributeList(config);
      lines.push(`IPv6 Routing Protocol is "eigrp ${config.asn}"`, ...eigrpProtocolLines(d, 'eigrp6', config), '', '  Interfaces:', ...members.map(p => `    ${p.name}${isPassive(config, p.name) ? ' (passive)' : ''}`), '  Redistribution:', ...(redistribute.length ? redistribute.map(r => `    Redistributing protocol ${r}`) : ['    None']));
    } else if (key === 'ripng') {
      const members = ports(d).filter(p => !p.vrf && p.features.ripng?.enabled), redistribute = redistributeList(config);
      lines.push(`IPv6 Routing Protocol is "rip ${config.processId ?? ''}"`, '  Interfaces:', ...members.map(p => `    ${p.name}`), '  Redistribution:', ...(redistribute.length ? redistribute.map(r => `    Redistributing protocol ${r}`) : ['    None']));
    }
  }
  return lines;
}
/** show ip protocols [summary] | show ipv6 protocols */
export function iosIpProtocols(e: Simulator, d: Device, family: 4 | 6, args: readonly string[]): string[] | undefined {
  return guard(() => {
    const a = [...args];
    if (family === 6) { if (a.length) return invalid(); return ipv6Protocols(e, d); }
    const summary = a.length ? word(a.shift(), ['summary']) === 'summary' : false;
    if (a.length) return invalid();
    const order = Object.keys(d.config.protocols).filter(key => ['eigrp', 'ospf', 'rip', 'bgp'].includes(key) && (key !== 'bgp' || bgpAddressFamily(d, undefined, 4)) && (key !== 'eigrp' || d.config.protocols.eigrp?.asn !== undefined));
    if (!d.config.ipRouting && !order.length) return [];
    if (summary) {
      const names = ['connected', 'static', 'application', ...order.map(key => key === 'eigrp' ? `eigrp ${d.config.protocols.eigrp.asn}` : key === 'ospf' ? `ospf ${Number(d.config.protocols.ospf.processId ?? 1)}` : key === 'bgp' ? `bgp ${bgpAddressFamily(d, undefined, 4)!.asn}` : key)];
      return ['Index Process Name', ...names.map((name, i) => pad(i, 6) + name)];
    }
    const lines = ['*** IP Routing is NSF aware ***', '', 'Routing Protocol is "application"', '  Sending updates every 0 seconds', '  Invalid after 0 seconds, hold down 0, flushed after 0', ...updateFilterLines(undefined), '  Maximum path: 32', '  Routing for Networks:', ...sourceHeader, '  Distance: (default is 4)', ''];
    for (const key of order) {
      const config = d.config.protocols[key];
      if (key === 'eigrp') lines.push(...eigrpIpProtocols(e, d, config));
      else if (key === 'ospf') lines.push(...ospfIpProtocols(e, d, config));
      else if (key === 'rip') lines.push(...ripIpProtocols(e, d, config));
      else lines.push(...bgpIpProtocols(e, d));
    }
    return lines;
  });
}
