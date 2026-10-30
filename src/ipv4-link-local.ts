import type {Simulator} from './engine.ts';
import type {Device, InterfaceConfig} from './model.ts';
import {endpointProfile} from './endpoint.ts';
import {hostOSProfile} from './host-os.ts';
import {isIPv4, prefixContains} from './ip.ts';

export function isIPv4LinkLocal(address: string): boolean {
  return isIPv4(address) && prefixContains('169.254.0.0', 16, address);
}

export function supportsIPv4LinkLocal(device: Device): boolean {
  return ['pc', 'laptop', 'server'].includes(device.kind) &&
    endpointProfile(device).role === 'computer' && hostOSProfile(device) !== 'linux';
}

export function hasIPv4LinkLocalAddress(device: Device, port: string): boolean {
  const state = device.runtime.features.ipv4LinkLocal?.[port], c = device.config.interfaces[port];
  return supportsIPv4LinkLocal(device) && !!c?.features.dhcp && state?.phase === 'active' && c.ip === state.address;
}

interface LinkLocalState {
  address: string;
  phase: 'waiting' | 'probing' | 'active';
  generation: number;
  conflicts: number;
  defendedAt?: number;
}

/** RFC 3927 claim/defend on the actual link, independent of the DHCP state machine. */
export class IPv4LinkLocal {
  private contexts = new WeakMap<LinkLocalState, {runtime: Device['runtime']; config: InterfaceConfig}>();
  private engine: Simulator;
  private sendARP: (device: Device, port: string, source: string, target: string) => void;
  constructor(
    engine: Simulator,
    sendARP: (device: Device, port: string, source: string, target: string) => void,
  ) { this.engine = engine; this.sendARP = sendARP; }

  private state(d: Device, port: string): LinkLocalState | undefined {
    return d.runtime.features.ipv4LinkLocal?.[port];
  }

  private valid(d: Device, port: string, state: LinkLocalState): boolean {
    const c = d.config.interfaces[port], lease = d.runtime.features.dhcpClientLeases?.[port], context = this.contexts.get(state);
    return this.engine.getDevice(d.id) === d && d.powered && supportsIPv4LinkLocal(d) &&
      d.runtime === context?.runtime && c === context.config && this.state(d, port) === state &&
      !!c.features.dhcp && !d.runtime.features.dhcpReleased?.[port] &&
      (!c.ip || c.ip === state.address) &&
      !(lease && lease.address === c.ip && lease.expires > this.engine.clock.now());
  }

  clear(d: Device, port: string): void {
    const state = this.state(d, port), c = d.config.interfaces[port];
    if (!state) return;
    if (c?.ip === state.address) { delete c.ip; delete c.mask; }
    delete d.runtime.features.ipv4LinkLocal[port];
  }

  /** Called before connected routes are rebuilt, including after link/profile changes. */
  sync(d: Device): void {
    for (const port of Object.keys(d.runtime.features.ipv4LinkLocal ?? {})) {
      const state = this.state(d, port)!;
      if (!this.valid(d, port, state)) { this.clear(d, port); continue; }
      if (!this.engine.interfaceUp(d.id, port) && state.phase !== 'waiting') {
        const c = d.config.interfaces[port];
        if (c.ip === state.address) { delete c.ip; delete c.mask; }
        state.phase = 'waiting'; state.generation++;
      }
    }
  }

  start(d: Device, port: string): void {
    const c = d.config.interfaces[port], lease = d.runtime.features.dhcpClientLeases?.[port];
    if (!c?.features.dhcp || !supportsIPv4LinkLocal(d) || !d.powered ||
      d.runtime.features.dhcpReleased?.[port] ||
      (lease && lease.address === c.ip && lease.expires > this.engine.clock.now())) return;
    let state = this.state(d, port);
    if (c.ip && c.ip !== state?.address) return;
    if (lease && lease.expires <= this.engine.clock.now()) {
      delete c.features.dhcpLease; delete c.features.leaseExpires;
    }
    if (!state) {
      state = {address: '', phase: 'waiting', generation: 0, conflicts: 0};
      this.contexts.set(state, {runtime: d.runtime, config: c});
      (d.runtime.features.ipv4LinkLocal ??= {})[port] = state;
      const current = state;
      const retry = () => {
        if (!this.valid(d, port, current)) { if (this.state(d, port) === current) this.clear(d, port); return; }
        this.sync(d);
        if (this.engine.interfaceUp(d.id, port)) this.engine.requestDHCP(d.id, port, false);
        if (this.state(d, port) === current)
          this.engine.clock.schedule(5000, retry, {owner: d.id, label: 'DHCP retry during IPv4 link-local fallback'});
      };
      this.engine.clock.schedule(5000, retry, {owner: d.id, label: 'DHCP retry during IPv4 link-local fallback'});
    }
    if (state.phase === 'waiting' && this.engine.interfaceUp(d.id, port)) this.probe(d, port, state);
  }

  private probe(d: Device, port: string, state: LinkLocalState): void {
    const c = d.config.interfaces[port];
    if (c.ip === state.address) { delete c.ip; delete c.mask; }
    const candidate = Math.floor(this.engine.clock.random() * (254 * 256));
    state.address = `169.254.${1 + Math.floor(candidate / 256)}.${candidate % 256}`;
    state.phase = 'probing'; delete state.defendedAt;
    const generation = ++state.generation;
    const ready = () => this.valid(d, port, state) && state.generation === generation && this.engine.interfaceUp(d.id, port);
    const announce = () => this.sendARP(d, port, state.address, state.address);
    const claim = () => {
      if (!ready()) return;
      state.phase = 'active'; c.ip = state.address; c.mask = '255.255.0.0';
      // A link-local claim is not a lease and supplies neither routers nor DNS options.
      this.engine.emit({nodeId: d.id, port, protocol: 'ARP', label: 'IPv4 link-local address assigned', detail: state.address + '/16; DHCP remains enabled.', disposition: 'warning'});
      announce(); this.engine.changed();
      this.engine.clock.schedule(2000, () => { if (ready()) announce(); }, {owner: d.id, label: 'IPv4 link-local announcement'});
    };
    const probe = (number: number) => {
      if (!ready()) return;
      this.sendARP(d, port, '0.0.0.0', state.address);
      this.engine.clock.schedule(number < 3 ? 1000 + this.engine.clock.random() * 1000 : 2000,
        number < 3 ? () => probe(number + 1) : claim, {owner: d.id, label: 'IPv4 link-local address probe'});
    };
    this.engine.emit({nodeId: d.id, port, protocol: 'ARP', label: 'Checking IPv4 link-local address', detail: state.address, disposition: 'info'});
    this.engine.clock.schedule((state.conflicts >= 10 ? 60000 : 0) + this.engine.clock.random() * 1000,
      () => probe(1), {owner: d.id, label: 'IPv4 link-local initial probe'});
  }

  observe(d: Device, port: string, arp: {family: number; source: string; target: string; mac: string}): void {
    const state = this.state(d, port);
    if (!state || !this.valid(d, port, state) || arp.family !== 4 || arp.mac === this.engine.macOf(d.id, port)) return;
    const conflict = arp.source === state.address ||
      (state.phase === 'probing' && arp.source === '0.0.0.0' && arp.target === state.address);
    if (!conflict) return;
    if (state.phase === 'active' && (state.defendedAt === undefined || this.engine.clock.now() - state.defendedAt >= 10000)) {
      state.defendedAt = this.engine.clock.now();
      this.sendARP(d, port, state.address, state.address);
      this.engine.emit({nodeId: d.id, port, protocol: 'ARP', label: 'IPv4 link-local address defended', detail: state.address, disposition: 'warning'});
      return;
    }
    state.conflicts++;
    this.engine.emit({nodeId: d.id, port, protocol: 'ARP', label: 'IPv4 link-local address conflict', detail: state.address + ' claimed by ' + arp.mac + '; selecting another address.', disposition: 'warning'});
    this.probe(d, port, state); this.engine.changed();
  }
}
