import type { Device } from './model.ts';
import type { IPPacket, ServiceResult, Simulator } from './engine.ts';
import type { TimerHandle } from './clock.ts';
import { bigIntToIPv6, ipv6ToBigInt, isIPv6, parseCidr, prefixContains, sameAddress } from './ip.ts';

export interface LinkControl { kind: 'link-control'; protocol: string; body: any }
interface Pending { deviceId: string; port: string; result: ServiceResult; timer: TimerHandle; delegationName?: string; information?: boolean; offers?: any[]; selection?: TimerHandle; selectedServer?: string }
/** Original, packet-delivered IPv6 host configuration. No topology-wide lease shortcuts. */
export class IPv6Services {
  private sequence = 0;
  private requests = new Map<string, Pending>();
  private dad = new Map<string, { deviceId: string; port: string; address: string; timer: TimerHandle; complete: (ok: boolean) => void }>();
  private engine: Simulator;
  constructor(engine: Simulator) { this.engine = engine; }
  reset(): void { this.requests.clear(); this.dad.clear(); }
  clearDevice(deviceId: string): void { for (const [id, p] of this.requests) if (p.deviceId === deviceId) this.finish(id, undefined, 'Device power state changed'); for (const [id, row] of this.dad) if (row.deviceId === deviceId) { this.engine.clock.cancel(row.timer); this.dad.delete(id); } }
  clearPort(deviceId: string, port: string): void { for (const [id, pending] of this.requests) if (pending.deviceId === deviceId && pending.port === port) this.finish(id, undefined, 'Automatic IPv6 configuration stopped'); for (const [id, row] of this.dad) if (row.deviceId === deviceId && row.port === port) { this.engine.clock.cancel(row.timer); this.dad.delete(id); } }
  private start(deviceId: string, port: string, kind: string): Pending {
    const result: ServiceResult = { id: kind + '-' + (++this.sequence), status: 'running' };
    const timer = this.engine.clock.schedule(9000, () => this.finish(result.id, undefined, kind + ' timed out'), { label: kind + ' timeout' });
    const pending = { deviceId, port, result, timer }; this.requests.set(result.id, pending); return pending;
  }
  private finish(id: string, fields?: any, error?: string): void {
    const p = this.requests.get(id); if (!p) return;
    this.engine.clock.cancel(p.timer); this.engine.clock.cancel(p.selection); this.requests.delete(id); Object.assign(p.result, fields ?? {}, { status: error ? 'failure' : 'success', ...(error ? { error } : {}) }); this.engine.notify();
  }
  private port(d: Device, selected?: string): string | undefined { return selected && this.engine.interfaceUp(d.id, selected) ? selected : selected ? undefined : Object.keys(d.config.interfaces).find(p => !d.config.interfaces[p].switchport && this.engine.interfaceUp(d.id, p)); }
  private send(d: Device, port: string, protocol: string, body: any): void { this.engine.sendLinkControl(d.id, port, { kind: 'link-control', protocol, body: { ...body, source: this.engine.linkLocalAddress(d.id, port) } }); }
  requestIPv6(deviceId: string, selected?: string): ServiceResult {
    const d = this.engine.getDevice(deviceId), port = d && this.port(d, selected);
    if (!d || !port) return { id: 'slaac-error', status: 'failure', error: 'No operational IPv6 interface' };
    const cfg = d.config.interfaces[port]; cfg.features.ipv6Enabled = true; cfg.features.ipv6Autoconfig = true;
    const p = this.start(d.id, port, 'SLAAC'); this.engine.changed();
    const solicit = () => { if (this.requests.has(p.result.id)) this.send(d, port, 'ICMPV6', { type: 'rs', transaction: p.result.id, clientId: d.id, clientPort: port }); };
    solicit(); this.engine.clock.schedule(2000, solicit, { owner: d.id, label: 'Router solicitation retry' }); return p.result;
  }
  requestDHCPv6(deviceId: string, selected?: string, delegationName?: string, information = false): ServiceResult {
    const d = this.engine.getDevice(deviceId), port = d && this.port(d, selected);
    if (!d || !port) return { id: 'dhcpv6-error', status: 'failure', error: 'No operational DHCPv6 client interface' };
    d.config.interfaces[port].features.ipv6Enabled = true; if (!information) d.config.interfaces[port].features.dhcpv6Client = { stateful: true, prefixDelegationName: delegationName };
    const pending = this.start(d.id, port, 'DHCPv6'); pending.delegationName = delegationName; pending.information = information;
    const message = { type: information ? 'information-request' : 'solicit', transaction: pending.result.id, clientId: d.id, clientPort: port, delegationName, information };
    this.send(d, port, 'DHCPV6', message); this.engine.clock.schedule(2000, () => { if (this.requests.has(pending.result.id)) this.send(d, port, 'DHCPV6', message); }, { owner: d.id, label: 'DHCPv6 client retry' }); this.engine.changed(); return pending.result;
  }
  /** DAD leaves the candidate out of the operational interface until the quiet interval expires. */
  probeAddress(d: Device, port: string, address: string, complete: (ok: boolean) => void): void {
    const key = d.id + '|' + port + '|' + bigIntToIPv6(ipv6ToBigInt(address));
    if (this.dad.has(key)) return;
    const attempts=d.config.interfaces[port]?.features.dadAttempts??1;
    if(attempts===0){complete(true);return;}
    const row={deviceId:d.id,port,address,complete,timer:undefined as unknown as TimerHandle};let sent=0;this.dad.set(key,row);
    const probe=()=>{if(this.dad.get(key)!==row)return;if(sent>=attempts){this.dad.delete(key);complete(true);return;}sent++;this.engine.sendDAD(d.id,port,address);row.timer=this.engine.clock.schedule(1000,probe,{owner:d.id,label:'IPv6 duplicate address detection'});};probe();
  }
  observeNeighbor(d: Device, port: string, message: { source: string; target: string; mac: string; operation: string }): void {
    if (message.mac === this.engine.macOf(d.id, port)) return;
    for (const [key, row] of this.dad) if (row.deviceId === d.id && row.port === port && (sameAddress(row.address, message.source) || (message.source === '::' && sameAddress(row.address, message.target)))) {
      this.engine.clock.cancel(row.timer); this.dad.delete(key);
      (d.runtime.features.duplicateAddresses ??= []).push({ interface: port, address: row.address, time: this.engine.clock.now() });
      this.engine.emit({ nodeId: d.id, port, protocol: 'ICMPV6', label: 'Duplicate IPv6 address', detail: row.address + ' is already present or being tested on this link.', disposition: 'drop' }); row.complete(false);
    }
  }
  /** Configured addresses remain visible while tentative/duplicate addresses are excluded from forwarding. */
  syncStaticDAD():void {
    for(const d of this.engine.lab.devices){const table=d.runtime.features.staticIPv6Dad??={};for(const [port,c]of Object.entries(d.config.interfaces)){
      const owned=[...(c.features.slaacAddresses??[]),c.features.dhcpv6Lease?.address].filter(Boolean);const configured=[...c.ipv6.map(v=>v.split('/')[0]),...(c.features.ipv6LinkLocal?[c.features.ipv6LinkLocal]:[])].filter(a=>!owned.some(x=>sameAddress(x,a)));const rows=table[port]??={};
      for(const address of Object.keys(rows))if(!configured.some(a=>sameAddress(a,address))||!this.engine.interfaceUp(d.id,port)){const key=d.id+'|'+port+'|'+bigIntToIPv6(ipv6ToBigInt(address)),pending=this.dad.get(key);if(pending){this.engine.clock.cancel(pending.timer);this.dad.delete(key);}delete rows[address];}
      if(!this.engine.interfaceUp(d.id,port))continue;
      for(const raw of configured){if(!isIPv6(raw))continue;const address=bigIntToIPv6(ipv6ToBigInt(raw));if(rows[address])continue;const row=rows[address]={state:/^Loopback/i.test(port)?'preferred':'tentative',started:this.engine.clock.now()};if(row.state==='preferred')continue;this.probeAddress(d,port,address,ok=>{if(table[port]?.[address]!==row)return;row.state=ok?'preferred':'duplicate';if(ok)this.engine.sendNeighborAnnouncement(d.id,port,address);this.engine.changed();});}
    }}
  }
  recompute(): void {
    for(const d of this.engine.lab.devices){const scheduled=d.runtime.features.raScheduled??={};const keep=new Set<string>();if(d.powered&&d.config.ipv6Routing)for(const [port,c]of Object.entries(d.config.interfaces)){
      if(c.switchport||!this.engine.operationalIPv6Addresses(d.id,port).length||!this.engine.interfaceUp(d.id,port))continue;keep.add(port);const nd=c.features.ipv6Nd||{},signature=JSON.stringify([c.ipv6,nd]),old=scheduled[port];if(old?.signature===signature)continue;if(old?.timer)this.engine.clock.cancel(old.timer);const row=scheduled[port]={signature,timer:undefined as TimerHandle|undefined};row.timer=this.engine.clock.schedule(50,()=>{if(d.runtime.features.raScheduled?.[port]===row)this.advertise(d,port);},{owner:d.id,repeat:nd.intervalMs??30000,label:'IPv6 router advertisement'});
    }for(const port of Object.keys(scheduled))if(!keep.has(port)){this.engine.clock.cancel(scheduled[port]?.timer);delete scheduled[port];}}
  }
  private advertise(d: Device, port: string, extra: any = {}): void {
    const c=d.config.interfaces[port],nd=c?.features.ipv6Nd??{};
    if(!d.powered||!d.config.ipv6Routing||!c||nd.suppressRa&&!extra.transaction||!this.engine.interfaceUp(d.id,port))return;
    const usable=this.engine.operationalIPv6Addresses(d.id,port);if(!usable.length)return;const advertised:any[]=usable.flatMap(v=>{try{const p=parseCidr(v);return p.prefix===64&&!p.address.startsWith('fe80:')?[{network:p.network,prefix:p.prefix,validLifetime:86400,preferredLifetime:14400,autonomous:true,onLink:true}]:[];}catch{return [];}});
    for(const prefix of nd.prefixes||[]){const old=advertised.findIndex(p=>p.network===prefix.network&&p.prefix===prefix.prefix);if(old>=0)advertised.splice(old,1);if(!prefix.noAdvertise)advertised.push(prefix);}
    this.send(d,port,'ICMPV6',{type:'ra',reachableTime:c.features.ndReachableTime??0,prefixes:advertised,lifetime:nd.raLifetime??1800,managed:!!nd.managed,other:!!nd.other,hopLimit:nd.hopLimit??64,routerPreference:nd.routerPreference??'medium',...extra});
  }
  private installSlaac(d:Device,port:string,address:string,prefix:any):void {
    const c=d.config.interfaces[port],table=d.runtime.features.slaacLeases??={},id=port+'|'+address,now=this.engine.clock.now(),previous=table[id],advertised=Math.max(0,prefix.validLifetime??86400)*1000,remaining=Math.max(0,(previous?.expires??now)-now);const valid=previous&&advertised<=7200000&&advertised<=remaining?(remaining<=7200000?remaining:7200000):advertised;const lease=table[id]={address,port,onLink:prefix.onLink!==false,preferredUntil:now+Math.max(0,prefix.preferredLifetime??14400)*1000,expires:now+valid};
    const current=()=>d.runtime.features.slaacLeases?.[id]===lease&&c.features.ipv6Autoconfig;
    if(!c.ipv6.some(v=>sameAddress(v.split('/')[0],address)))c.ipv6.push(address+'/64');c.features.slaacAddresses=[...new Set([...(c.features.slaacAddresses??[]),address])];const deprecated=d.runtime.features.deprecatedIPv6??={};deprecated[port]=(deprecated[port]||[]).filter((x:string)=>!sameAddress(x,address));
    this.engine.clock.schedule(Math.max(0,lease.preferredUntil-now),()=>{if(!current())return;deprecated[port]=[...new Set([...(deprecated[port]||[]),address])];this.engine.notify();},{owner:d.id,label:'SLAAC preferred lifetime'});
    this.engine.clock.schedule(Math.max(0,lease.expires-now),()=>{if(!current())return;c.ipv6=c.ipv6.filter(v=>!sameAddress(v.split('/')[0],address));c.features.slaacAddresses=c.features.slaacAddresses.filter((x:string)=>!sameAddress(x,address));deprecated[port]=(deprecated[port]||[]).filter((x:string)=>!sameAddress(x,address));delete table[id];this.engine.changed();},{owner:d.id,label:'SLAAC valid lifetime'});
  }
  receive(d: Device, port: string, message: LinkControl): void {
    const b = message.body, c = d.config.interfaces[port]; if (!c) return;
    if (b.type === 'rs') { this.advertise(d, port, { transaction: b.transaction, clientId: b.clientId, clientPort: b.clientPort }); return; }
    if (b.type === 'ra') {
      if (!c.features.ipv6Autoconfig || (b.clientId && b.clientId !== d.id)) return;
      if(b.reachableTime>0)c.features.ndAdvertisedReachableTime=b.reachableTime;
      const gateways = d.runtime.features.ipv6DefaultRouters ??= {};
      gateways[port] = { address: b.source, expires: this.engine.clock.now() + Math.max(0, b.lifetime) * 1000, receivedAt:this.engine.clock.now(), lifetime:b.lifetime, hopLimit:b.hopLimit, managed:b.managed, other:b.other, mtu:b.mtu, routerPreference:b.routerPreference, reachableTime:b.reachableTime, prefixes:structuredClone(b.prefixes??[]) };
      const old = d.config.staticRoutes.filter(r => !(r.network === '::' && r.prefix === 0 && r.interface === port && (r as any).autoconfig));
      d.config.staticRoutes = old;
      if (b.lifetime > 0) d.config.staticRoutes.push({ network: '::', prefix: 0, nextHop: b.source, interface: port, ad: 2, metric: 0, autoconfig: true } as any);
      const expiry = gateways[port].expires;
      this.engine.clock.schedule(Math.max(0, expiry - this.engine.clock.now()), () => { if (gateways[port]?.expires !== expiry) return; d.config.staticRoutes = d.config.staticRoutes.filter(r => !((r as any).autoconfig && r.interface === port)); delete gateways[port]; this.engine.changed(); }, { owner: d.id, label: 'IPv6 default router lifetime' });
      const advertised=(b.prefixes||[]).filter((p:any)=>(p.preferredLifetime??0)<=(p.validLifetime??86400));const autonomous=advertised.filter((p:any)=>p.prefix===64&&p.autonomous!==false);
      for(const entry of advertised){const marker=`${port}|${entry.network}/${entry.prefix}`;d.config.staticRoutes=d.config.staticRoutes.filter(r=>(r as any).autoconfigPrefix!==marker);if(entry.onLink!==false&&entry.validLifetime!==0){const route:any={network:entry.network,prefix:entry.prefix,interface:port,ad:2,metric:0,autoconfigPrefix:marker};d.config.staticRoutes.push(route);this.engine.clock.schedule(Math.max(0,entry.validLifetime??86400)*1000,()=>{if(!d.config.staticRoutes.includes(route))return;d.config.staticRoutes=d.config.staticRoutes.filter(r=>r!==route);this.engine.changed();},{owner:d.id,label:'RA on-link prefix lifetime'});}}
      let attempted=false;for(const prefix of autonomous){const host=ipv6ToBigInt(this.engine.linkLocalAddress(d.id,port))&((1n<<64n)-1n),address=bigIntToIPv6(ipv6ToBigInt(prefix.network)|host);if(prefix.validLifetime===0&&!c.features.slaacAddresses?.some((a:string)=>sameAddress(a,address)))continue;attempted=true;const install=()=>{if(!c.features.ipv6Autoconfig)return;this.installSlaac(d,port,address,prefix);this.engine.sendNeighborAnnouncement(d.id,port,address);this.engine.changed();for(const[id,pending]of this.requests)if(id.startsWith('SLAAC-')&&pending.deviceId===d.id&&pending.port===port)this.finish(id,{address,prefix:64,gateway:b.source});};if(c.ipv6.some(v=>sameAddress(v.split('/')[0],address)))install();else this.probeAddress(d,port,address,ok=>{if(!ok){if(b.transaction)this.finish(b.transaction,undefined,'Duplicate IPv6 address');return;}install();});}
      if(!attempted&&b.transaction)this.finish(b.transaction,{gateway:b.source},b.managed?undefined:'Router advertisement had no autonomous /64 prefix');
      if ((b.managed || b.other) && !c.features._dhcpv6Autostart) { c.features._dhcpv6Autostart = true; this.requestDHCPv6(d.id, port, undefined, !b.managed); }
      this.engine.changed(); return;
    }
    if (message.protocol === 'DHCPV6') this.receiveDHCP(d, port, b);
  }
  receiveDatagram(d: Device, packet: IPPacket): void {
    const b = packet.body;
    if (b.operation === 'relay-return') { if (d.id === b.relay.deviceId && d.config.interfaces[b.relay.port]) this.send(d, b.relay.port, 'DHCPV6', b.message); return; }
    const port = Object.keys(d.config.interfaces).find(p => d.config.interfaces[p].ipv6.some(v => sameAddress(v.split('/')[0], packet.destination))) ?? Object.keys(d.config.interfaces)[0];
    this.receiveDHCP(d, port, b.message, { ...b.relay, replyTo: packet.source });
  }
  private scheduleLease(d: Device, port: string, lease: any): void {
    const duration = lease.expires - this.engine.clock.now(), c = d.config.interfaces[port], renewalDuration = Math.min(...[lease.addressExpires, lease.pdExpires, lease.expires].filter(Number.isFinite)) - this.engine.clock.now();
    const current = () => d.powered && d.runtime.features.dhcpv6Leases?.[port] === lease;
    const renew = (rebind: boolean) => {
      if (!current() || this.engine.clock.now() >= lease.expires) return; lease.state = rebind ? 'REBINDING' : 'RENEWING';
      const pending = this.start(d.id, port, 'DHCPv6'); pending.delegationName = lease.delegationName; pending.information = lease.information;pending.selectedServer=rebind?undefined:lease.serverId;
      this.send(d, port, 'DHCPV6', { type: rebind ? 'rebind' : 'renew', transaction: pending.result.id, clientId: d.id, clientPort: port, address: lease.address, delegationName: lease.delegationName, information: lease.information, serverId: rebind ? undefined : lease.serverId });
      this.engine.emit({ nodeId: d.id, port, protocol: 'DHCPV6', label: rebind ? 'Lease rebinding' : 'Lease renewal', detail: lease.address ?? lease.delegatedPrefix ?? 'Information refresh', disposition: 'info' });
      this.engine.clock.schedule(2000, () => { if (current() && lease.state === 'REBINDING' && rebind) renew(true); }, { owner: d.id, label: 'DHCPv6 renewal retry' });
    };
    this.engine.clock.schedule(renewalDuration / 2, () => renew(false), { owner: d.id, label: 'DHCPv6 T1' }); this.engine.clock.schedule(renewalDuration * 0.8, () => renew(true), { owner: d.id, label: 'DHCPv6 T2' });
    if (lease.address) {
      this.engine.clock.schedule(Math.max(0, lease.preferredUntil - this.engine.clock.now()), () => { if (!current()) return; const deprecated = d.runtime.features.deprecatedIPv6 ??= {}; deprecated[port] = [...new Set([...(deprecated[port] ?? []), lease.address])]; lease.deprecated = true; this.engine.emit({ nodeId: d.id, port, protocol: 'DHCPV6', label: 'IPv6 address deprecated', detail: 'The preferred lifetime expired; new flows prefer another valid address.', disposition: 'warning' }); this.engine.notify(); }, { owner: d.id, label: 'DHCPv6 preferred lifetime' });
      this.engine.clock.schedule(Math.max(0, lease.addressExpires - this.engine.clock.now()), () => { if (!current()) return; c.ipv6 = c.ipv6.filter(value => !sameAddress(value.split('/')[0], lease.address)); const deprecated = d.runtime.features.deprecatedIPv6?.[port]; if (deprecated) d.runtime.features.deprecatedIPv6[port] = deprecated.filter((address: string) => !sameAddress(address, lease.address)); this.engine.changed(); }, { owner: d.id, label: 'DHCPv6 address valid lifetime' });
    }
    if (lease.delegatedPrefix && lease.delegationName) {
      this.engine.clock.schedule(Math.max(0, lease.pdPreferredUntil - this.engine.clock.now()), () => { if (current()) { const prefix = d.config.features.delegatedPrefixes?.[lease.delegationName]; if (prefix?.prefix === lease.delegatedPrefix) prefix.deprecated = true; this.engine.notify(); } }, { owner: d.id, label: 'DHCPv6 delegated prefix preferred lifetime' });
      this.engine.clock.schedule(Math.max(0, lease.pdExpires - this.engine.clock.now()), () => { if (current() && d.config.features.delegatedPrefixes?.[lease.delegationName]?.prefix === lease.delegatedPrefix) { delete d.config.features.delegatedPrefixes[lease.delegationName]; this.engine.changed(); } }, { owner: d.id, label: 'DHCPv6 delegated prefix valid lifetime' });
    }
    this.engine.clock.schedule(duration, () => {
      if (!current()) return; lease.state = 'EXPIRED'; if (lease.address) c.ipv6 = c.ipv6.filter(value => !sameAddress(value.split('/')[0], lease.address));
      if (lease.delegationName && d.config.features.delegatedPrefixes?.[lease.delegationName]?.prefix === lease.delegatedPrefix) delete d.config.features.delegatedPrefixes[lease.delegationName];
      if (JSON.stringify(d.config.dnsServers) === JSON.stringify(lease.dnsServers ?? [])) d.config.dnsServers = [];
      this.engine.emit({ nodeId: d.id, port, protocol: 'DHCPV6', label: 'Lease expired', detail: 'Leased address and delegated prefix removed after renewal and rebind failed.', disposition: 'warning' }); this.engine.changed();
      const retry = () => { if (!current()) return; this.requestDHCPv6(d.id, port, lease.delegationName, lease.information); this.engine.clock.schedule(5000, retry, { owner: d.id, label: 'DHCPv6 reacquisition retry' }); }; this.engine.clock.schedule(1000, retry, { owner: d.id, label: 'DHCPv6 reacquisition' });
    }, { owner: d.id, label: 'DHCPv6 lease expiry' });
  }
  private receiveDHCP(d: Device, port: string, b: any, relay?: any): void {
    if (b.type === 'advertise' || b.type === 'reply') {
      const pending = this.requests.get(b.transaction); if (!pending || pending.deviceId !== d.id || pending.port !== port) return;
      if (b.type === 'advertise') {
        if (pending.selectedServer) return; const offers = pending.offers ??= []; const existing = offers.findIndex(o => o.serverId === b.serverId); if (existing >= 0) offers[existing] = b; else offers.push(b);
        const choose = () => { if (this.requests.get(b.transaction) !== pending || pending.selectedServer) return; const selected = [...(pending.offers ?? [])].sort((a,b) => (Number(b.preference) || 0) - (Number(a.preference) || 0) || String(a.serverId).localeCompare(String(b.serverId)))[0]; if (!selected) return; pending.selectedServer = selected.serverId; this.send(d, port, 'DHCPV6', { ...selected, type: 'request' }); };
        if (Number(b.preference) === 255) { this.engine.clock.cancel(pending.selection); choose(); } else if (!pending.selection) pending.selection = this.engine.clock.schedule(200, choose, { owner: d.id, label: 'DHCPv6 advertised server selection' }); return;
      }
      if (pending.selectedServer && pending.selectedServer !== b.serverId) return;
      const apply = () => {
        const c = d.config.interfaces[port]; if (b.address && !c.ipv6.some(v => sameAddress(v.split('/')[0], b.address))) c.ipv6.push(b.address + '/' + (b.prefix ?? 128));
        if (b.dnsServers?.length) d.config.dnsServers = [...b.dnsServers]; if (b.domain) d.config.features.dnsDomain = b.domain;
        const now = this.engine.clock.now(), valid = Math.max(1, Number(b.lifetime) || 86400), preferred = Math.max(0, Math.min(valid, Number.isFinite(b.preferredLifetime) ? b.preferredLifetime : valid)), pdValid = Math.max(1, Number(b.pdLifetime) || valid), pdPreferred = Math.max(0, Math.min(pdValid, Number.isFinite(b.pdPreferredLifetime) ? b.pdPreferredLifetime : pdValid));
        if (b.delegatedPrefix && pending.delegationName) (d.config.features.delegatedPrefixes ??= {})[pending.delegationName] = { prefix: b.delegatedPrefix, expires: now + pdValid * 1000, preferredUntil: now + pdPreferred * 1000 };
        const deprecated = d.runtime.features.deprecatedIPv6 ??= {}; deprecated[port] = (deprecated[port] ?? []).filter((address: string) => !b.address || !sameAddress(address, b.address));
        c.features.dhcpv6Lease = { address: b.address, delegationName: pending.delegationName, delegatedPrefix: b.delegatedPrefix };
        const lease = { address: b.address, prefix: b.prefix, delegatedPrefix: b.delegatedPrefix, serverId: b.serverId, delegationName: pending.delegationName, information: pending.information, dnsServers: b.dnsServers, state: 'BOUND', addressExpires: b.address ? now + valid * 1000 : undefined, preferredUntil: b.address ? now + preferred * 1000 : undefined, pdExpires: b.delegatedPrefix ? now + pdValid * 1000 : undefined, pdPreferredUntil: b.delegatedPrefix ? now + pdPreferred * 1000 : undefined, expires: now + Math.max(b.address ? valid : 0, b.delegatedPrefix ? pdValid : 0, pending.information ? valid : 1) * 1000 }; (d.runtime.features.dhcpv6Leases ??= {})[port] = lease; this.scheduleLease(d, port, lease);
        if (b.address) this.engine.sendNeighborAnnouncement(d.id, port, b.address); this.engine.changed(); this.finish(b.transaction, { address: b.address, prefix: b.prefix, delegatedPrefix: b.delegatedPrefix, dnsServers: b.dnsServers });
      };
      if (b.address && !d.config.interfaces[port].ipv6.some(v => sameAddress(v.split('/')[0], b.address))) this.probeAddress(d, port, b.address, ok => ok ? apply() : this.finish(b.transaction, undefined, 'DHCPv6 assigned a duplicate address')); else apply(); return;
    }
    if (!['solicit', 'request', 'information-request', 'renew', 'rebind'].includes(b.type)) return;
    const c = d.config.interfaces[port], service = d.config.services.dhcpv6;
    const poolName = c.features.dhcpv6Server;
    const pool = service?.enabled && (service.pools ?? []).find((p: any) => poolName ? p.name === poolName : relay?.address && p.prefix ? prefixContains(parseCidr(p.prefix).network, parseCidr(p.prefix).prefix, relay.address) : !relay && !!p.prefix && c.ipv6.some(v => { const a = parseCidr(v), network = parseCidr(p.prefix); return prefixContains(a.network, a.prefix, network.address); }));
    if (!pool || (b.serverId && b.serverId !== d.id)) {
      if (!relay) for (const target of c.features.dhcpv6Relay ?? []) {
        const destination = typeof target === 'string' ? target : target.destination; if (!isIPv6(destination)) continue;
        const address = c.ipv6.map(v => v.split('/')[0]).find(v => !v.startsWith('fe80:')); if (!address) continue;
        this.engine.sendIPv6ServicePacket(d.id, address, destination, { kind: 'ipv6-service', operation: 'relay-forward', message: b, relay: { address, port, deviceId: d.id } });
      }
      return;
    }
    const now=this.engine.clock.now(),leases:any[]=d.runtime.features.dhcpv6ServerLeases??=[],offers:any[]=d.runtime.features.dhcpv6Offers=(d.runtime.features.dhcpv6Offers??[]).filter((entry:any)=>entry.expires>now);
    const belongs=(entry:any)=>entry.clientId===b.clientId&&entry.clientPort===b.clientPort&&entry.pool===pool.name&&entry.expires>now;
    let lease=leases.find(belongs),offer=offers.find(belongs);
    if(['renew','rebind'].includes(b.type)&&(!lease||b.address&&lease.address!==b.address))return;
    if(b.type==='request'&&!lease&&!offer)return;
    if(b.type==='request'&&b.address&&(lease??offer)?.address!==b.address)return;
    let allocation=lease??offer;
    if(b.type==='information-request')allocation={clientId:b.clientId,clientPort:b.clientPort,pool:pool.name};
    if(!allocation){
      if(offers.length>=512)return;const prefix=pool.prefix?parseCidr(pool.prefix):undefined,reservations=[...leases,...offers];let address:string|undefined,delegatedPrefix:string|undefined;
      if(prefix&&!b.information){const first=ipv6ToBigInt(prefix.network),capacity=1n<<BigInt(128-prefix.prefix);for(let n=16n;n<capacity&&n<65536n;n++){const candidate=bigIntToIPv6(first+n);if(!reservations.some(l=>l.address===candidate&&l.expires>now)&&!d.config.interfaces[port].ipv6.some(v=>sameAddress(v.split('/')[0],candidate))){address=candidate;break;}}if(!address)return;}
      if(b.delegationName&&pool.delegatedPrefix){const root=parseCidr(pool.delegatedPrefix),length=Number(pool.delegatedLength??64);if(length>=root.prefix&&length<=128)for(let n=0n;n<(1n<<BigInt(length-root.prefix))&&n<65536n;n++){const candidate=bigIntToIPv6(ipv6ToBigInt(root.network)+(n<<BigInt(128-length)))+'/'+length;if(!reservations.some(l=>l.delegatedPrefix===candidate&&l.expires>now)){delegatedPrefix=candidate;break;}}if(!delegatedPrefix)return;}
      allocation={clientId:b.clientId,clientPort:b.clientPort,pool:pool.name,address,prefix:prefix?.prefix,delegatedPrefix,expires:now+30000};offers.push(allocation);const pendingOffer=allocation;this.engine.clock.schedule(30000,()=>{d.runtime.features.dhcpv6Offers=(d.runtime.features.dhcpv6Offers??[]).filter((x:any)=>x!==pendingOffer);},{owner:d.id,label:'DHCPv6 offer expiry'});
    }
    if(b.type!=='solicit'&&b.type!=='information-request'){
      if(!lease){lease={...allocation};leases.push(lease);}allocation=lease;d.runtime.features.dhcpv6Offers=offers.filter(entry=>!belongs(entry));lease.expires=now+Math.max(1,pool.leaseSeconds??86400,lease.delegatedPrefix?(pool.pdLeaseSeconds??pool.leaseSeconds??86400):0)*1000;
      const committed=lease,expiry=lease.expires;this.engine.clock.schedule(expiry-now,()=>{if(committed.expires===expiry)d.runtime.features.dhcpv6ServerLeases=(d.runtime.features.dhcpv6ServerLeases??[]).filter((x:any)=>x!==committed);},{owner:d.id,label:'DHCPv6 server lease expiry'});
    }
    const response = { ...b, ...allocation, type: b.type === 'solicit' ? 'advertise' : 'reply', serverId: d.id, dnsServers: pool.dnsServers ?? [], domain: pool.domain, lifetime: pool.leaseSeconds ?? 86400, preferredLifetime: pool.preferredLifetime ?? pool.leaseSeconds ?? 86400, pdLifetime: pool.pdLeaseSeconds ?? pool.leaseSeconds ?? 86400, pdPreferredLifetime: pool.pdPreferredLifetime ?? pool.pdLeaseSeconds ?? pool.leaseSeconds ?? 86400, preference: Math.max(0, Math.min(255, Number(c.features.dhcpv6Preference) || 0)) };
    if (relay) { const source = d.config.interfaces[port].ipv6[0]?.split('/')[0]; if (source) this.engine.sendIPv6ServicePacket(d.id, source, relay.replyTo, { kind: 'ipv6-service', operation: 'relay-return', message: response, relay }); }
    else this.send(d, port, 'DHCPV6', response);
  }
}
