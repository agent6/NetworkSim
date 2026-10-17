import { interfaceSpeed, interfaceBandwidth } from './ethernet.ts';
import { queuePolicy, schedulingError, catalystQueueProfile, rememberQosClass } from './qos-scheduler.ts';
import { arpBindingRuleMatches } from './arp-binding-acl.ts';
import { disableInterface } from './ios-errdisable.ts';
import { ipToInt, isIPv6, sameAddress, parseCidr, prefixContains } from './ip.ts';
import type { Device, Route } from './model.ts';
import type { Frame, IPPacket, Simulator } from './engine.ts';
import { observeRemoteSpan } from './remote-span.ts';
import { prefixListPermits } from './control-plane.ts';
import { inspectTracking, trackingPolicy, setBindingLifetime } from './fhs-tracking.ts';

/** Stateful ingress controls operate on frames that actually reached a port. */
export function inspectIngress(engine: Simulator, device: Device, port: string, vlan: number, frame: Frame): boolean {
  const features = device.config.features, iface = device.config.interfaces[port], state = device.runtime.features;
  const drop = (counter: string, protocol: string, label: string, detail: string) => { state[counter] = (state[counter] ?? 0) + 1; engine.emit({ nodeId: device.id, port, protocol, label, detail, disposition: 'drop' }); return false; };
  const cleanMac = (mac: string) => mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const security = iface.features.portSecurity;
  if (security && security.enabled !== false) {
    const moved = Object.entries(device.config.interfaces).some(([other, c]) => other !== port && c.features.portSecurity?.enabled !== false && c.features.portSecurity && [...(c.features.portSecurity.macs ?? []), ...(state.secureMacs?.[other] ?? [])].some((mac: string) => cleanMac(mac) === cleanMac(frame.sourceMac)));
    if (moved) { if ((security.violation ?? 'shutdown') === 'shutdown') disablePort(engine, device, port, 'psecure-violation'); return drop('portSecurityViolations', 'ETHERNET', 'Secure MAC move violation', 'This source MAC belongs to a different secure port.'); }
    const entries: string[] = state.secureMacs?.[port] ?? [];
    const configured: string[] = security.macs ?? [];
    const known = [...new Set([...configured, ...entries].map(x => x.replace(/[^0-9a-f]/gi, '').toLowerCase()))];
    if (!known.includes(frame.sourceMac.replace(/[^0-9a-f]/gi, '').toLowerCase())) {
      if (known.length >= (security.maximum ?? 1)) {
        if ((security.violation ?? 'shutdown') === 'shutdown') disablePort(engine, device, port, 'psecure-violation');
        return drop('portSecurityViolations', 'ETHERNET', 'Port security violation', 'The secure MAC limit was exceeded on ' + port + '.');
      }
      (state.secureMacs ??= {})[port] = [...entries, frame.sourceMac];
      if (security.sticky) security.macs = [...configured, frame.sourceMac];
    }
    if (Number(security.agingTime) > 0) {
      const key = port + '|' + cleanMac(frame.sourceMac), times = state.secureMacTimes ??= {}, row = times[key] ??= { first: engine.clock.now(), last: engine.clock.now() }; row.last = engine.clock.now();
      const isStatic = () => (security.macs ?? []).some((mac: string) => cleanMac(mac) === cleanMac(frame.sourceMac));
      if (!row.scheduled && (!isStatic() || security.agingStatic)) {
        row.scheduled = true;
        const expire = () => { if (!(Number(security.agingTime) > 0)) { row.scheduled = false; return; } const duration = Math.max(1, security.agingTime) * 60000, due = (security.agingType === 'inactivity' ? row.last : row.first) + duration; if (due > engine.clock.now()) { engine.clock.schedule(due - engine.clock.now(), expire, { owner: device.id, label: 'Secure MAC aging' }); return; } if (isStatic() && !security.agingStatic) { row.scheduled = false; return; } if (state.secureMacs?.[port]) state.secureMacs[port] = state.secureMacs[port].filter((mac: string) => cleanMac(mac) !== cleanMac(frame.sourceMac)); if (security.agingStatic) security.macs = (security.macs ?? []).filter((mac: string) => cleanMac(mac) !== cleanMac(frame.sourceMac)); delete times[key]; engine.emit({ nodeId: device.id, port, protocol: 'ETHERNET', label: 'Secure MAC aged out', detail: frame.sourceMac, disposition: 'info' }); };
        engine.clock.schedule(Math.max(1, security.agingTime) * 60000, expire, { owner: device.id, label: 'Secure MAC aging' });
      }
    }
  }
  const payload = frame.payload;
  const dhcp = 'kind' in payload ? (payload.kind === 'dhcp' ? payload : undefined) : payload.body?.kind === 'dhcp-unicast' ? payload.body.message : undefined;
  const ageBindings = () => { state.dhcpBindings = (state.dhcpBindings ?? []).filter((b: any) => b.expires > engine.clock.now()); state.ipv6Bindings = (state.ipv6Bindings ?? []).filter((b: any) => b.expires > engine.clock.now()); };
  if ((dhcp?.operation === 'ack') || ('kind' in payload && payload.kind === 'link-control' && payload.body.type === 'reply')) { const seconds = dhcp ? dhcp.lease ?? 86400 : (payload as any).body.lifetime ?? 86400; engine.clock.schedule(Math.max(1, seconds) * 1000, ageBindings, { owner: device.id, label: 'Snooping binding expiry' }); }
  const snooping = features.dhcpSnooping;
  const inspectVlan = !!snooping?.enabled && (snooping.vlans ?? []).includes(vlan);
  let releasedBinding: any;
  const rate = (kind: string, maximum: number | undefined) => { if (maximum === undefined) return true; const key = port + ':' + kind, meters = state.policyRateMeters ??= {}, window = Math.floor(engine.clock.now() / 1000); let meter = meters[key]; if (!meter || meter.window !== window) meter = meters[key] = { window, packets: 0 }; if (++meter.packets <= Math.max(1, maximum)) return true; disablePort(engine, device, port, kind === 'DHCP' ? 'dhcp-rate-limit' : 'arp-inspection'); return drop(kind === 'DHCP' ? 'dhcpSnoopingDrops' : 'arpInspectionDrops', kind, kind + ' rate limit', 'The configured packet-per-second limit was exceeded.'); };
  if (dhcp && inspectVlan && !rate('DHCP', iface.features.dhcpSnoopingRate)) return false;
  if ('kind' in payload && payload.kind === 'arp' && payload.family === 4 && (features.arpInspection?.vlans ?? []).includes(vlan) && !rate('ARP', iface.features.arpInspectionRate)) return false;
  if (dhcp && inspectVlan) {
    const server = dhcp.operation === 'offer' || dhcp.operation === 'ack' || dhcp.operation === 'nak';
    if (server && !iface.features.dhcpSnoopingTrust) return drop('dhcpSnoopingDrops', 'DHCP', 'DHCP snooping drop', 'A server reply arrived on an untrusted port.');
    if (!server) {
      if (dhcp.operation === 'release') {
        const client = state.dhcpClients?.[dhcp.clientId];
        releasedBinding = client?.port === port && client.vlan === vlan && cleanMac(client.mac) === cleanMac(frame.sourceMac)
          ? (state.dhcpBindings ?? []).find((binding: any) => binding.port === port && binding.vlan === vlan && cleanMac(binding.mac) === cleanMac(frame.sourceMac) && binding.ip === dhcp.address && binding.expires > engine.clock.now()) : undefined;
        if (!releasedBinding) return drop('dhcpSnoopingDrops', 'DHCP', 'DHCP release validation drop', 'The releasing client does not own this IP/MAC/port binding.');
      }
      if (snooping.option82 && dhcp.option82 && !iface.features.dhcpSnoopingTrust && !snooping.allowUntrustedOption82) return drop('dhcpSnoopingDrops', 'DHCP', 'DHCP Option82 drop', 'Relay information arrived from an untrusted client port.');
      if (snooping.option82 && !dhcp.option82) dhcp.option82 = { circuitId: vlan + ':' + port, remoteId: device.id };
      if (dhcp.operation !== 'release') (state.dhcpClients ??= {})[dhcp.clientId] = { port, vlan, mac: frame.sourceMac };
    }
    if (dhcp.operation === 'ack' && dhcp.address) {
      const client = state.dhcpClients?.[dhcp.clientId];
      if (client) { const bindings: any[] = state.dhcpBindings ??= []; const old = bindings.findIndex(x => x.mac === client.mac && x.vlan === client.vlan); if (old >= 0) bindings.splice(old, 1); bindings.push({ ...client, ip: dhcp.address, expires: engine.clock.now() + (dhcp.lease ?? 86400) * 1000 }); }
    }
    if (dhcp.operation === 'nak' || dhcp.operation === 'decline') { const client = state.dhcpClients?.[dhcp.clientId]; if (client) state.dhcpBindings = (state.dhcpBindings ?? []).filter((binding: any) => !(binding.port === client.port && binding.vlan === client.vlan && (!dhcp.address || binding.ip === dhcp.address))); }
  }
  const matchesBinding = (ip: string) => [...(state.dhcpBindings ?? []), ...(features.staticBindings ?? []).map((x: any) => ({ ...x, port: x.interface, expires: Infinity }))].some((x: any) => x.port === port && x.vlan === vlan && cleanMac(x.mac) === cleanMac(frame.sourceMac) && x.ip === ip && x.expires > engine.clock.now());
  if ('kind' in payload && payload.kind === 'arp' && payload.family === 4 && (features.arpInspection?.vlans ?? []).includes(vlan) && !iface.features.arpInspectionTrust) {
    const validation = features.arpInspection.validations ?? {};
    if ((validation.sourceMac && cleanMac(payload.mac) !== cleanMac(frame.sourceMac)) || (validation.destinationMac && payload.operation === 'reply' && payload.targetMac && cleanMac(payload.targetMac) !== cleanMac(frame.destinationMac))) return drop('arpInspectionDrops', 'ARP', 'ARP header validation drop', 'Ethernet and ARP hardware addresses disagree.');
    if (validation.ip && (payload.operation === 'reply' ? [payload.source, payload.target] : [payload.source]).some(ip => { try { const value = ipToInt(ip); return value === 0 || value === 0xffffffff || (value >>> 28) >= 14; } catch { return true; } })) return drop('arpInspectionDrops', 'ARP', 'ARP IP validation drop', 'The ARP protocol address is invalid.');
    const filter = (features.arpInspection.filters ?? []).find((f: any) => f.vlans.includes(vlan));
    const rule = filter && (features.arpAcls?.[filter.acl] ?? []).find((r: any) => arpBindingRuleMatches(r,payload.source,payload.mac,payload.operation));
    if(rule?.log)engine.log(device.id,`%ARP_ACL: ${filter.acl} ${rule.action} ${payload.source} ${payload.mac} on ${port}`,6);
    if (rule?.action === 'deny' || (!rule && filter?.static)) return drop('arpInspectionDrops', 'ARP', 'ARP ACL drop', 'The VLAN ARP ACL denied this source.');
    if (rule?.action !== 'permit' && payload.source !== '0.0.0.0' && (!matchesBinding(payload.source) || cleanMac(payload.mac) !== cleanMac(frame.sourceMac))) return drop('arpInspectionDrops', 'ARP', 'Dynamic ARP inspection drop', 'The sender IP/MAC/port does not match a valid DHCP or static binding.');
  }
  if (!('kind' in payload) && iface.features.sourceGuard && !isIPv6(payload.source) && !matchesBinding(payload.source)) return drop('sourceGuardDrops', payload.protocol.toUpperCase(), 'IP source guard drop', 'No matching source IP/MAC binding exists on this port.');
  const policies = features.ipv6Policies ?? {}, vlanPolicies = features.fhsVlanPolicies?.[vlan] ?? {};
  const policyName = (kind: string) => iface.features[kind + 'Policy'] ?? vlanPolicies[kind + 'Policy'];
  const raName = policyName('raGuard'), dhcpName = policyName('dhcpv6Guard'), ndName = policyName('ndInspection'), sourceName = policyName('sourceGuard') ?? iface.features.ipv6SourceGuardPolicy;
  const raPolicy = raName === 'default' ? {deviceRole:'host'} : policies.raGuard?.[raName], dhcpPolicy = dhcpName === 'default' ? {deviceRole:'client'} : policies.dhcpv6Guard?.[dhcpName], ndPolicy = policies.ndInspection?.[ndName] ?? {};
  const tracking = trackingPolicy(device, port, vlan);
  if (!inspectTracking(engine, device, port, vlan, frame)) return false;
  const prefixAllowed = (name: string | undefined, address: string, length?: number): boolean => { if (!name) return true; try { const parsed = parseCidr(address.includes('/') ? address : address + '/' + (length ?? 128)); return prefixListPermits(device, name, { network: parsed.network, prefix: parsed.prefix }); } catch { return false; } };
  if ('kind' in payload && payload.kind === 'link-control') {
    const b = payload.body;
    if (payload.protocol === 'ICMPV6' && b.type === 'ra' && !raPolicy?.trusted && raPolicy?.deviceRole !== 'switch') {
      if ((!raPolicy && iface.features.raGuard) || raPolicy?.deviceRole === 'host') return drop('raGuardDrops', 'ICMPV6', 'RA guard drop', 'Router advertisements are not permitted on this host-facing port.');
      if (raPolicy) { const rank: Record<string,number> = { low: 0, medium: 1, high: 2 }, hopLimit = Number(b.hopLimit ?? 64); const invalid =
        (raPolicy.hopLimitMin !== undefined && hopLimit < raPolicy.hopLimitMin) || (raPolicy.hopLimitMax !== undefined && hopLimit > raPolicy.hopLimitMax) ||
        (raPolicy.managedFlag !== undefined && !!b.managed !== (raPolicy.managedFlag === 'on')) || (raPolicy.otherFlag !== undefined && !!b.other !== (raPolicy.otherFlag === 'on')) ||
        (raPolicy.routerPreferenceMaximum !== undefined && (rank[b.routerPreference ?? 'medium'] ?? 1) > rank[raPolicy.routerPreferenceMaximum]) ||
        (raPolicy.sourceAcl && !engine.aclPermits(device.id, raPolicy.sourceAcl, b.source, 'ff02::1', 'icmpv6')) ||
        (b.prefixes ?? []).some((prefix: any) => !prefixAllowed(raPolicy.prefixList, prefix.network, prefix.prefix));
        if (invalid) { if (raPolicy.deviceRole === 'monitor') { state.raGuardMonitored = (state.raGuardMonitored ?? 0) + 1; engine.emit({nodeId:device.id,port,protocol:'ICMPV6',label:'RA guard monitor',detail:'The advertisement violates an attached policy constraint.',disposition:'warning'}); } else return drop('raGuardDrops', 'ICMPV6', 'RA guard policy drop', 'The advertisement violates its hop-limit, flags, preference, source ACL or prefix-list policy.'); }
      }
    }
    if (payload.protocol === 'DHCPV6') {
      if (['advertise', 'reply'].includes(b.type) && !dhcpPolicy?.trusted) {
        if ((!dhcpPolicy && iface.features.dhcpv6Guard) || dhcpPolicy?.deviceRole === 'client') return drop('dhcpv6GuardDrops', 'DHCPV6', 'DHCPv6 guard drop', 'DHCPv6 server replies are not permitted on this port.');
        if (dhcpPolicy && ((dhcpPolicy.serverPreferenceMin !== undefined && Number(b.preference ?? 0) < dhcpPolicy.serverPreferenceMin) || (dhcpPolicy.serverPreferenceMax !== undefined && Number(b.preference ?? 0) > dhcpPolicy.serverPreferenceMax) || (dhcpPolicy.serverAcl && !engine.aclPermits(device.id, dhcpPolicy.serverAcl, b.source, 'ff02::1:2', 'udp', { sourcePort: 547, destinationPort: 546 })) || (b.address && !prefixAllowed(dhcpPolicy.prefixList, b.address, b.prefix)) || (b.delegatedPrefix && !prefixAllowed(dhcpPolicy.prefixList, b.delegatedPrefix)))) return drop('dhcpv6GuardDrops', 'DHCPV6', 'DHCPv6 guard policy drop', 'The server preference, source ACL or leased prefix violates the attached policy.');
      }
      if (['solicit', 'request', 'information-request', 'renew', 'rebind'].includes(b.type)) (state.dhcpv6Clients ??= {})[b.clientId + '|' + b.clientPort] = { port, vlan, mac: frame.sourceMac };
      if (b.type === 'reply' && b.address) { const client = state.dhcpv6Clients?.[b.clientId + '|' + b.clientPort]; if (client) { const bindings: any[] = state.ipv6Bindings ??= []; const old = bindings.findIndex(x => sameAddress(x.ip, b.address)); if (old >= 0) bindings.splice(old, 1); bindings.push({ ...client, ip: b.address, prefix: b.prefix ?? 128, source: 'DHCPv6', state: 'reachable', expires: engine.clock.now() + (b.lifetime ?? 86400) * 1000 }); } }
    }
  }
  if ('kind' in payload && payload.kind === 'arp' && payload.family === 6) {
    const bindings: any[] = state.ipv6Bindings ??= [], enabled = !!iface.features.ndInspection || !!ndName, trusted = !!ndPolicy.trusted || ndPolicy.deviceRole === 'switch';
    const address = payload.source === '::' ? payload.target : payload.source;
    const binding = bindings.find(x => x.vlan === vlan && sameAddress(x.ip, address) && x.expires > engine.clock.now());
    const identity = binding && binding.port === port && cleanMac(binding.mac) === cleanMac(frame.sourceMac) && cleanMac(payload.mac) === cleanMac(frame.sourceMac);
    let violation: string | undefined;
    if (enabled && !trusted && !binding && ndPolicy.limit !== undefined && bindings.filter(x=>x.port===port&&x.expires>engine.clock.now()).length>=ndPolicy.limit) violation='The ND inspection address-count limit was reached.';
    if (enabled && !trusted && ndPolicy.securityLevel !== 'glean') {
      if ((ndPolicy.dropUnsecure && !(payload as any).securityLevel) || (typeof ndPolicy.securityLevel === 'number' && Number((payload as any).securityLevel ?? 0) < ndPolicy.securityLevel)) violation = 'The neighbor-discovery message does not meet the configured security level.';
      else if (ndPolicy.validateSourceMac && cleanMac(payload.mac) !== cleanMac(frame.sourceMac)) violation = 'Ethernet and neighbor-discovery source MAC addresses disagree.';
      else if (binding && !identity && payload.source !== '::') violation = 'The neighbor advertisement conflicts with the IPv6 binding table.';
      else if (!binding && payload.source !== '::' && !prefixContains('fe80::', 10, payload.source)) violation = 'No IPv6 binding or preceding DAD exchange permits this neighbor source.';
    }
    if (violation) { if (!ndPolicy.monitor) return drop('ndInspectionDrops', 'NDP', 'ND inspection drop', violation); state.ndInspectionMonitored = (state.ndInspectionMonitored ?? 0) + 1; engine.emit({nodeId:device.id,port,protocol:'NDP',label:'ND inspection monitor',detail:violation,disposition:'warning'}); }
    if (!tracking) {
    if (payload.source === '::') { if (!binding) bindings.push({ port, vlan, mac: frame.sourceMac, ip: payload.target, prefix:128, state: 'tentative', source: 'NDP', expires: engine.clock.now() + 5000 }); }
    else if (identity) { binding.state = 'reachable'; if (binding.source !== 'DHCPv6' && binding.source !== 'static') binding.expires = engine.clock.now() + 300000; }
    else if (!binding && (!enabled || trusted || ndPolicy.monitor || ndPolicy.securityLevel === 'glean' || prefixContains('fe80::',10,payload.source))) bindings.push({ port, vlan, mac: frame.sourceMac, ip: payload.source, prefix:128, state: 'reachable', source: 'NDP', expires: engine.clock.now() + 300000 });
    if(ndPolicy.tracking){const learned=bindings.find(x=>x.port===port&&sameAddress(x.ip,address));if(learned)setBindingLifetime(engine,device,learned,ndPolicy);}
    }
  }
  if (!('kind' in payload) && isIPv6(payload.source) && (iface.features.ipv6SourceGuard || sourceName)) {
    const policy = policies.sourceGuard?.[sourceName] ?? (typeof iface.features.ipv6SourceGuard === 'object' ? iface.features.ipv6SourceGuard : {}), local = prefixContains('fe80::',10,payload.source);
    if (!policy.trusted && !(local && policy.permitLinkLocal !== false)) {
      const allowed = (state.ipv6Bindings ?? []).some((x: any) => x.port === port && x.vlan === vlan && cleanMac(x.mac) === cleanMac(frame.sourceMac) && !['tentative','down'].includes(x.state) && x.expires > engine.clock.now() && !(policy.denyGlobalAutoconf && x.source !== 'DHCPv6' && !local) && (policy.validateAddress === false ? true : sameAddress(x.ip,payload.source)) && (!policy.validatePrefix || prefixContains(x.ip,x.prefix ?? 128,payload.source)));
      if (!allowed) return drop('ipv6SourceGuardDrops', payload.protocol.toUpperCase(), 'IPv6 source guard drop', 'The IPv6 source does not match an allowed address/prefix binding on this port.');
    }
  }
  const storm = iface.features.stormControl;
  if (storm) {
    const isBroadcast = frame.destinationMac === 'ff:ff:ff:ff:ff:ff';
    const multicast = (parseInt(frame.destinationMac.slice(0, 2), 16) & 1) !== 0;
    const kind = isBroadcast ? 'broadcast' : multicast ? 'multicast' : !device.runtime.mac[vlan + '|' + frame.destinationMac] ? 'unicast' : undefined;
    if (kind && storm[kind] !== undefined) {
      const window = Math.floor(engine.clock.now() / 1000), key = port + ':' + kind, setting = storm[kind];
      const rising = Number(typeof setting === 'number' ? setting : setting.rising), falling = Number(typeof setting === 'number' ? setting : setting.falling ?? setting.rising);
      const counters = state.stormMeters ??= {}; let meter = counters[key];
      if (!meter) meter = counters[key] = { window, bytes: 0, blocked: false };
      if (meter.window !== window) { if (window - meter.window > 1 || meter.bytes * 8 / (interfaceSpeed(device,iface) * 1000000) <= falling / 100) meter.blocked = false; meter.window = window; meter.bytes = 0; }
      meter.bytes += 'size' in payload ? payload.size + 18 : 64; const fraction = meter.bytes * 8 / (interfaceSpeed(device,iface) * 1000000);
      if (rising < 100 && (meter.blocked || fraction > rising / 100)) {
        if (!meter.blocked && storm.action === 'trap') engine.log(device.id, '%STORM_CONTROL: ' + port + ' ' + kind + ' threshold exceeded', 4);
        meter.blocked = true;
        if (storm.action === 'shutdown') disablePort(engine, device, port, 'storm-control');
        return drop('stormControlDrops', 'ETHERNET', 'Storm control drop', kind + ' traffic exceeded the configured one-second threshold.');
      }
    }
  }
  // Validate source guard against the live lease before removing it. A rejected
  // release must neither reach the server nor erase another client's binding.
  if (releasedBinding) {
    state.dhcpBindings = (state.dhcpBindings ?? []).filter((binding: any) => binding !== releasedBinding);
    delete state.dhcpClients?.[dhcp!.clientId];
    engine.emit({ nodeId: device.id, port, protocol: 'DHCP', label: 'Snooping binding released', detail: releasedBinding.ip, disposition: 'info' });
  }
  return true;
}

function disablePort(engine: Simulator, device: Device, port: string, cause: string): void {
  if(disableInterface(engine,device,port,cause))engine.changed();
}

export function classifyQosPolicy(device: Device, policyName: string, packet: IPPacket, aclMatches: (name: string, packet: IPPacket) => boolean): string | undefined {
  const policy = device.config.features.policyMaps?.[policyName];
  for (const c of [...(policy?.classes ?? [])].sort((a, b) => Number(a.name === 'class-default') - Number(b.name === 'class-default'))) {
    if (c.name === 'class-default') return c.name;
    const map = device.config.features.classMaps?.[c.name], checks: boolean[] = [];
    if (map?.dscp?.length) checks.push(map.dscp.includes(packet.dscp ?? 0)); if (map?.acl) checks.push(aclMatches(map.acl, packet));
    if (map && checks.length && (map.match === 'any' ? checks.some(Boolean) : checks.every(Boolean))) return c.name;
  }
}
/** Classification and single-rate two/three-color policing use simulated bytes and time.
 * Output queue policies count transmission only when the actual egress scheduler dequeues. */
export function applyQos(engine: Simulator, device: Device, port: string, direction: 'in' | 'out', packet: IPPacket, aclMatches: (name: string, packet: IPPacket) => boolean): boolean {
  const iface = device.config.interfaces[port], policyName = port === 'control-plane' && direction === 'in' ? device.config.features.controlPlanePolicyIn : iface?.features[direction === 'in' ? 'servicePolicyIn' : 'servicePolicyOut'];
  const policy = device.config.features.policyMaps?.[policyName]; if (!policy) return true;
  const unsupported = schedulingError(policy, port, direction, iface ? interfaceBandwidth(device, iface) * 1000 : undefined,catalystQueueProfile(device),device.kind==='router'); if (unsupported) { engine.emit({ nodeId: device.id, port, protocol: 'QOS', label: 'Unsupported queued policy', detail: unsupported, disposition: 'drop' }); return false; }
  // class-default is a fallback regardless of where it appeared in the configuration.
  const ordered = [...(policy.classes ?? [])].sort((a, b) => Number(a.name === 'class-default') - Number(b.name === 'class-default'));
  for (const policyClass of ordered) {
    const map = device.config.features.classMaps?.[policyClass.name], checks: boolean[] = [];
    if (map?.dscp?.length) checks.push(map.dscp.includes(packet.dscp ?? 0));
    if (map?.acl) checks.push(aclMatches(map.acl, packet));
    const matched = policyClass.name === 'class-default' || (!!map && checks.length > 0 && (map.match === 'any' ? checks.some(Boolean) : checks.every(Boolean)));
    if (!matched) continue;
    if (direction === 'out') rememberQosClass(packet, device, port, policyName, policyClass.name);
    const key = policyName + ':' + policyClass.name + ':' + port + ':' + direction;
    const counters = device.runtime.features.qosCounters ??= {};
    const counter = counters[key] ??= { matched: 0, transmitted: 0, dropped: 0, bytes: 0 };
    counter.matched++; counter.bytes += packet.size;
    let drop = !!policyClass.drop, reason = 'class drop action';
    if (policyClass.police) {
      const p = policyClass.police, bytesPerSecond = Math.max(1, Number(p.rate)) / 8;
      const committed = Math.max(1, Number(p.burst ?? Math.max(1500, Math.round(bytesPerSecond / 4))));
      const excess = Math.max(1, Number(p.excessBurst ?? committed)), threeColor = p.threeColor === true || p.violate !== undefined || p.excessBurst !== undefined;
      const signature = JSON.stringify([p.rate, committed, excess, threeColor]);
      const meters = device.runtime.features.qosMeters ??= {};
      let meter = meters[key];
      if (!meter || meter.signature !== signature) meter = meters[key] = { signature, at: engine.clock.now(), tokens: committed, excessTokens: excess };
      const available = meter.tokens + Math.max(0, engine.clock.now() - meter.at) * bytesPerSecond / 1000;
      if (threeColor) meter.excessTokens = Math.min(excess, meter.excessTokens + Math.max(0, available - committed));
      meter.tokens = Math.min(committed, available); meter.at = engine.clock.now();
      let color: 'conform' | 'exceed' | 'violate';
      if (meter.tokens >= packet.size) { meter.tokens -= packet.size; color = 'conform'; }
      else if (threeColor && meter.excessTokens >= packet.size) { meter.excessTokens -= packet.size; color = 'exceed'; }
      else color = threeColor ? 'violate' : 'exceed';
      const tally = (counter.colors ??= {})[color] ??= { packets: 0, bytes: 0 }; tally.packets++; tally.bytes += packet.size;
      const action = p[color] ?? { kind: color === 'conform' ? 'transmit' : 'drop' };
      if (action.kind === 'drop') { drop = true; reason = color + ' policer action'; }
      else if (action.kind === 'set-dscp') { packet.dscp = action.value; counter.remarked = (counter.remarked ?? 0) + 1; }
      else if (action.kind === 'set-precedence') { packet.dscp = (action.value << 3) | ((packet.dscp ?? 0) & 7); counter.remarked = (counter.remarked ?? 0) + 1; }
    }
    if (drop) {
      counter.dropped++;
      engine.emit({ nodeId: device.id, port, protocol: packet.protocol.toUpperCase(), label: policyClass.police ? 'QoS policer drop' : 'QoS class drop', detail: `${policyName} / ${policyClass.name}: ${reason}`, disposition: 'drop', packet: { id: packet.id, source: packet.source, destination: packet.destination, protocol: packet.protocol, size: packet.size } });
      return false;
    }
    if (policyClass.dscp !== undefined) { packet.dscp = policyClass.dscp; counter.remarked = (counter.remarked ?? 0) + 1; }
    if (direction === 'out' && queuePolicy(policy)) counter.admitted = (counter.admitted ?? 0) + 1; else counter.transmitted++;
    return true;
  }
  return true;
}

export function observeFrame(engine: Simulator, device: Device, port: string, direction: 'rx' | 'tx', frame: Frame): void {
  if (frame.mirrored || frame.remoteSpan) return;
  observeRemoteSpan(engine, device, port, direction, frame);
  for (const [id, session] of Object.entries(device.config.features.spanSessions ?? {}) as [string, any][]) {
    if (session.type && session.type !== 'local') continue;
    if (!session.destination || session.destination === port || !session.sources?.some((source: any) => source.interface === port && (source.direction === direction || source.direction === 'both'))) continue;
    const stats = device.runtime.features.spanStats ??= {}, row = stats[id] ??= { frames: 0, bytes: 0 }; row.frames++; row.bytes += 'size' in frame.payload ? frame.payload.size + 18 : 64;
    engine.mirrorFrame(device.id, session.destination, frame);
  }
}

export function recordFlow(engine: Simulator, device: Device, input: string | undefined, output: string, packet: IPPacket): void {
  if (packet.body?.kind === 'netflow-export') return;
  const transport = packet.protocol === 'tcp' || packet.protocol === 'udp', icmp = icmpMessageFields(packet);
  const values: Record<string, any> = { source: packet.source, destination: packet.destination, protocol: packet.protocol, sourcePort: transport ? packet.sourcePort ?? 0 : 0, destinationPort: transport ? packet.destinationPort ?? 0 : 0, input: input ?? 'local', output, dscp: packet.dscp ?? 0 };
  const fields: Record<string, string> = { 'ipv4 source address': 'source', 'ipv4 destination address': 'destination', 'ipv6 source address': 'source', 'ipv6 destination address': 'destination', 'ip protocol': 'protocol', 'ipv4 protocol': 'protocol', 'ipv6 protocol': 'protocol', 'transport source-port': 'sourcePort', 'transport destination-port': 'destinationPort', 'interface input': 'input', 'interface output': 'output', 'ip dscp': 'dscp', 'ipv4 tos': 'dscp' };
  const monitors = new Set<string>(); if (input && device.config.interfaces[input]?.features.flowMonitorIn) monitors.add(device.config.interfaces[input].features.flowMonitorIn); if (device.config.interfaces[output]?.features.flowMonitorOut) monitors.add(device.config.interfaces[output].features.flowMonitorOut);
  const classic = (input && device.config.interfaces[input]?.features.netflowIn) || device.config.interfaces[output]?.features.netflowOut;
  for (const name of [...(classic ? [''] : []), ...monitors]) {
    const monitor = name ? device.config.features.flowMonitors?.[name] : undefined, record = monitor && device.config.features.flowRecords?.[monitor.record];
    if (name && !record) continue;
    // Classic NetFlow overloads its destination-port field with ICMP type/code.
    // Flexible transport fields remain ports: ICMP has neither source nor destination port.
    const flowValues = !name && icmp ? { ...values, destinationPort: (icmp.type << 8) | icmp.code } : values;
    const selected = name ? (record.match ?? []).map((field: string) => fields[field]).filter(Boolean) : ['source', 'destination', 'protocol', 'sourcePort', 'destinationPort', 'input', 'output'];
    if (!selected.length) continue;
    const cache: any[] = name ? (device.runtime.features.flowMonitorCaches ??= {})[name] ??= [] : device.runtime.features.netflowCache ??= [];
    const key = selected.map((field: string) => flowValues[field]).join('|'); let flow = cache.find(x => x.key === key);
    if (!flow) { flow = { key, ...Object.fromEntries(selected.map((field: string) => [field, flowValues[field]])), monitor: name || undefined, record: monitor?.record, packets: 0, bytes: 0, first: engine.clock.now(), last: engine.clock.now() }; cache.push(flow); if (cache.length > 2000) cache.shift(); }
    flow.packets++; flow.bytes += packet.size; flow.last = engine.clock.now();
    const exporter = name ? device.config.features.flowExporters?.[monitor.exporter] : device.config.features.netflow;
    const classicConfig=device.config.features.netflow??{};
    if(!name&&(classicConfig.activeTimeout!==undefined||classicConfig.inactiveTimeout!==undefined)){
      if(!flow.aging){flow.aging=true;const row=flow;
        const expire=()=>{if(device.runtime.features.netflowCache!==cache||!cache.includes(row))return;const settings=device.config.features.netflow??{},remaining=Math.min(row.first+(settings.activeTimeout??30)*60000,row.last+(settings.inactiveTimeout??15)*1000)-engine.clock.now();if(remaining>0){engine.clock.schedule(remaining,expire,{owner:device.id,label:'NetFlow cache aging'});return;}engine.exportNetFlow(device.id,undefined,new Set([row.key]));cache.splice(cache.indexOf(row),1);};
        engine.clock.schedule(Math.min((classicConfig.activeTimeout??30)*60000,(classicConfig.inactiveTimeout??15)*1000),expire,{owner:device.id,label:'NetFlow cache aging'});
      }continue;
    }
    const scheduled = device.runtime.features.flowExportsScheduled ??= {};
    if (exporter?.destination && !scheduled[name]) { scheduled[name] = true; engine.clock.schedule(Math.max(1, monitor?.cacheTimeout ?? 1) * 1000, () => { scheduled[name] = false; engine.exportNetFlow(device.id, name || undefined); }, { owner: device.id, label: 'NetFlow export' }); }
  }
}


export interface PolicyRouteResolution { route: Route; port: string; target: string }

/** Describe the ICMP message independently from simulator probe correlation IDs. */
export function icmpMessageFields(packet: IPPacket): { type: number; code: number } | undefined {
  if (!['icmp', 'icmpv6'].includes(packet.protocol)) return;
  const v6 = packet.protocol === 'icmpv6', body = packet.body ?? {};
  let type: number | undefined, code = 0;
  if (body.kind === 'echo-request') type = v6 ? 128 : 8;
  else if (body.kind === 'echo-reply') type = v6 ? 129 : 0;
  else if (body.kind === 'icmp-error') {
    const reason = String(body.error ?? '');
    type = /Time exceeded/i.test(reason) ? v6 ? 3 : 11 : /Packet too big/i.test(reason) && v6 ? 2 : v6 ? 1 : 3;
    code = /Time exceeded|Packet too big/i.test(reason) ? 0 : /Fragmentation needed/i.test(reason) ? 4 : /Administratively prohibited/i.test(reason) ? v6 ? 1 : 13 : /Port unreachable/i.test(reason) ? v6 ? 4 : 3 : /host unreachable/i.test(reason) ? v6 ? 3 : 1 : 0;
  }
  return type === undefined ? undefined : { type, code };
}

/** Match ICMP message selectors before an ACL entry records a hit. */
export function aclIcmpMatches(entry: { icmpType?: string | number; icmpCode?: number }, packet: IPPacket): boolean {
  if (entry.icmpType === undefined && entry.icmpCode === undefined) return true;
  const message = icmpMessageFields(packet); if (!message) return false;
  const v6 = packet.protocol === 'icmpv6';
  const names: Record<string, number> = { echo: v6 ? 128 : 8, 'echo-request': v6 ? 128 : 8, 'echo-reply': v6 ? 129 : 0, unreachable: v6 ? 1 : 3, 'time-exceeded': v6 ? 3 : 11, 'packet-too-big': 2 };
  const wanted = typeof entry.icmpType === 'string' ? names[entry.icmpType] ?? (/^\d+$/.test(entry.icmpType) ? Number(entry.icmpType) : NaN) : entry.icmpType;
  return (wanted === undefined || message.type === wanted) && (entry.icmpCode === undefined || message.code === entry.icmpCode);
}

/** IOS-style interface output ACLs govern transit traffic. Locally generated router traffic uses its local stack instead. */
export function egressAclRequired(device:Device,input?:string):boolean {
  return input!==undefined||!['router','l3switch'].includes(device.kind);
}

/** PBR's default next hop is used only when no usable explicit prefix route exists; a 0/0 route does not count. */
export function selectPolicyRoute(
  engine:Pick<Simulator,'emit'>,device:Device,input:string,packet:IPPacket,
  resolve:(target:string)=>PolicyRouteResolution|undefined,
  aclMatches:(name:string,packet:IPPacket)=>boolean,
):PolicyRouteResolution|undefined {
  const name=input==='local'?device.config.features.localPolicy:device.config.interfaces[input]?.features.routeMap;if(!name)return;
  const entries=Object.values(device.config.features.routeMaps??{}).flatMap((raw:any)=>Array.isArray(raw)?raw:raw.entries??[raw]).filter((entry:any)=>entry.name===name).sort((a:any,b:any)=>a.sequence-b.sequence);
  for(const entry of entries as any[]){
    const matches=(entry.match??[]).every((clause:string)=>{const words=clause.trim().split(/\s+/);if(words[0]!=='ip'||words[1]!=='address')return false;return words[2]==='prefix-list'?words.slice(3).some(n=>prefixListPermits(device,n,{network:packet.destination,prefix:isIPv6(packet.destination)?128:32})):words.slice(2).some(n=>aclMatches(n,packet));});
    if(!matches)continue;const policies=device.runtime.features.pbrCounters??={},counts=policies[name]??={},counter=counts[entry.sequence]??={matched:0,selected:0};counter.matched++;if(entry.action==='deny')return;
    for(const defaultOnly of[false,true]){
      if(defaultOnly&&(resolve(packet.destination)?.route.prefix??0)>0)continue;
      for(const clause of entry.set??[]){const words=String(clause).trim().split(/\s+/),offset=defaultOnly?3:2;if(words[0]!=='ip'||words[1]!== (defaultOnly?'default':'next-hop')||defaultOnly&&words[2]!=='next-hop')continue;
        for(const hop of words.slice(offset)){const selected=resolve(hop);if(!selected||/^Null/i.test(selected.port)||!sameAddress(selected.target,hop))continue;
          counter.selected++;engine.emit({nodeId:device.id,port:input,protocol:packet.protocol.toUpperCase(),label:'Policy routing',detail:`${name} selected ${defaultOnly?'default ':''}next hop ${hop}.`,disposition:'forward',packet:{id:packet.id,source:packet.source,destination:packet.destination,protocol:packet.protocol,size:packet.size}});
          return{...selected,route:{...selected.route,protocol:'policy',nextHop:hop}};
        }
      }
    }
    return;
  }
}

/** A non-overloaded NAT allocation binds the entire address until its idle timer expires. */
export function findDynamicNatBinding(table:any[],address:{inside?:string;outside?:string},now:number):any|undefined {
  return table.find(entry=>!entry.overload&&(entry.expires===undefined||entry.expires>now)&&(address.inside===undefined||sameAddress(entry.inside,address.inside))&&(address.outside===undefined||sameAddress(entry.outside,address.outside)));
}
/** PAT retains its remote transport tuple; basic dynamic NAT admits new outside flows to the allocated address. */
export function findInboundNatTranslation(table:any[],packet:IPPacket,now:number):any|undefined {
  return findDynamicNatBinding(table,{outside:packet.destination},now)??table.find(entry=>entry.overload&&(entry.expires===undefined||entry.expires>now)&&sameAddress(entry.outside,packet.destination)&&entry.outsidePort===packet.destinationPort&&entry.protocol===packet.protocol&&sameAddress(entry.remote,packet.source)&&(entry.remotePort===undefined||entry.remotePort===packet.sourcePort));
}
