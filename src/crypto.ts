import type { Device } from './model.ts';
import type { IPPacket, Simulator } from './engine.ts';

interface Pending { id: string; deviceId: string; local: string; peer: string; port: string; rule: any; profile?: string; packets: IPPacket[]; proposal: any; attempts: number }
/** Educational IKE/IPsec negotiation and encapsulation. The inner packet stays inspectable;
 * these tokens are deterministic model identifiers, never encryption or real authentication. */
export class CryptoServices {
  private engine: Simulator;
  private sequence = 0;
  private pending = new Map<string, Pending>();
  constructor(engine: Simulator) { this.engine = engine; }
  reset(): void { this.pending.clear(); }
  clear(deviceId: string): void { const d = this.engine.getDevice(deviceId); if (!d) return; d.runtime.features.isakmpSAs = []; d.runtime.features.ipsecSAs = []; for (const [key, p] of this.pending) if (p.deviceId === d.id) this.pending.delete(key); }
  private token(value: string): string { let hash = 2166136261; for (const c of value) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0; return hash.toString(16).padStart(8, '0'); }
  private key(d: Device, peer: string): string | undefined { return d.config.features.crypto?.isakmpKeys?.find((k: any) => k.peer === peer)?.key ?? d.config.features.crypto?.isakmpKeys?.find((k: any) => k.peer === '0.0.0.0')?.key; }
  private policies(d: Device): any[] { return [...(d.config.features.crypto?.isakmpPolicies ?? [])].sort((a, b) => a.priority - b.priority); }
  private equivalent(a: any, b: any): boolean { return a.encryption === b.encryption && (a.keyLength ?? 128) === (b.keyLength ?? 128) && a.hash === b.hash && (a.authentication ?? 'pre-share') === (b.authentication ?? 'pre-share') && a.group === b.group; }
  private transforms(d: Device, rule: any): any[] { return (rule.transformSets ?? []).flatMap((name: string) => { const t = d.config.features.crypto?.transformSets?.[name]; return t ? [{ ...t, name }] : []; }); }
  private emit(d: Device, label: string, detail: string, disposition: 'info' | 'warning' | 'drop' | 'success' = 'info'): void { this.engine.emit({ nodeId: d.id, protocol: 'IPSEC', label, detail, disposition }); }
  private selectorsMatch(d: Device, rule: any, packet: IPPacket, reverse = false): boolean { return this.engine.aclPermits(d.id, rule.acl, reverse ? packet.destination : packet.source, reverse ? packet.source : packet.destination, packet.protocol, { sourcePort: reverse ? packet.destinationPort : packet.sourcePort, destinationPort: reverse ? packet.sourcePort : packet.destinationPort }); }
  protect(d: Device, output: string, packet: IPPacket, profile?: string): boolean {
    if (['ike', 'esp'].includes(packet.body?.kind)) return false;
    const c = d.config.interfaces[output], crypto = d.config.features.crypto; if (!c) return false; if (!crypto) { if (profile) { this.engine.dropCryptoPacket(d.id, packet, 'Missing IPsec protection profile'); return true; } return false; }
    const map = c.features.cryptoMap;
    let rule: any;
    if (profile) { const definition = crypto.profiles?.[profile]; if (!definition) { this.engine.dropCryptoPacket(d.id, packet, 'Missing IPsec protection profile'); return true; } if (definition) rule = { peer: packet.destination, transformSets: [definition.transformSet], profile }; }
    else rule = (crypto.maps?.[map] ?? []).find((r: any) => r.peer && r.acl && this.selectorsMatch(d, r, packet));
    if (!rule) return false;
    const local = c.ip, peer = rule.peer;
    if (!local || !peer) { this.engine.dropCryptoPacket(d.id, packet, 'IPsec endpoint has no IPv4 address'); return true; }
    const sas: any[] = d.runtime.features.ipsecSAs ??= [];
    const sa = sas.find(sa => sa.local === local && sa.peer === peer && sa.source === packet.source && sa.destination === packet.destination && sa.protocol === packet.protocol && sa.expires > this.engine.clock.now() && sa.ready);
    if (sa) { this.encapsulate(d, sa, packet); return true; }
    let pending = [...this.pending.values()].find(p => p.deviceId === d.id && p.local === local && p.peer === peer && p.proposal.selector.source === packet.source && p.proposal.selector.destination === packet.destination && p.proposal.selector.protocol === packet.protocol);
    if (pending) { if (pending.packets.length < 64) pending.packets.push(structuredClone(packet)); else this.engine.dropCryptoPacket(d.id, packet, 'IPsec negotiation queue full'); return true; }
    const key = this.key(d, peer), policies = this.policies(d), transforms = this.transforms(d, rule);
    if (!key || !policies.length || !transforms.length) { this.engine.dropCryptoPacket(d.id, packet, 'IKE needs a matching peer key, policy and transform set'); return true; }
    const id = 'ike-' + (++this.sequence), spi = 256 + this.sequence * 2;
    const proposal = { kind: 'ike', stage: 'offer', id, policies, transforms, pfs: rule.pfs, profile: !!profile, selector: { source: packet.source, destination: packet.destination, protocol: packet.protocol, sourcePort: packet.sourcePort, destinationPort: packet.destinationPort }, spi, lifetime: rule.lifetime ?? 3600, token: this.token(key + '|' + id + '|' + local + '|' + peer) };
    pending = { id, deviceId: d.id, local, peer, port: output, rule: { ...rule, map }, profile, packets: [structuredClone(packet)], proposal, attempts: 0 }; this.pending.set(id, pending);
    (d.runtime.features.isakmpSAs ??= []).push({ peer, local, state: 'MM_NO_STATE', policy: policies[0].priority, created: this.engine.clock.now(), id }); this.transmitOffer(pending); return true;
  }
  private transmitOffer(p: Pending): void {
    if (!this.pending.has(p.id)) return; const d = this.engine.getDevice(p.deviceId); if (!d?.powered) { this.pending.delete(p.id); return; }
    if (p.attempts++ >= 5) { this.fail(p, 'IKE peer did not complete negotiation'); return; }
    this.engine.sendCryptoPacket(d.id, p.local, p.peer, 'udp', p.proposal, 300);
    this.engine.clock.schedule(750, () => this.transmitOffer(p), { owner: d.id, label: 'IKE negotiation timeout' });
  }
  private fail(p: Pending, error: string): void { this.pending.delete(p.id); const d = this.engine.getDevice(p.deviceId); if (!d) return; const ike = d.runtime.features.isakmpSAs?.find((s: any) => s.id === p.id); if (ike) { ike.state = 'FAILED'; ike.error = error; } for (const packet of p.packets) this.engine.dropCryptoPacket(d.id, packet, error); }
  receive(d: Device, packet: IPPacket): void {
    if (packet.body.kind === 'esp') { this.decapsulate(d, packet); return; }
    const b = packet.body, crypto = d.config.features.crypto;
    if (!crypto) return;
    if (b.stage === 'offer') {
      const port = Object.keys(d.config.interfaces).find(p => d.config.interfaces[p].ip === packet.destination && this.engine.interfaceUp(d.id, p)); if (!port) return;
      let rule: any; const map = d.config.interfaces[port].features.cryptoMap;
      if (b.profile) { const tunnel = Object.values(d.config.interfaces).find(c => c.features.tunnelProtection && (c.features.tunnelDestination === packet.source || c.features.tunnelMode === 'gre multipoint')); const profile = tunnel && crypto.profiles?.[tunnel.features.tunnelProtection]; if (profile) rule = { transformSets: [profile.transformSet], profile: tunnel!.features.tunnelProtection }; }
      else rule = (crypto.maps?.[map] ?? []).find((r: any) => r.peer === packet.source && this.selectorsMatch(d, r, b.selector, true));
      const key = this.key(d, packet.source), policy = this.policies(d).find(p => b.policies.some((other: any) => this.equivalent(p, other))), transforms = rule && this.transforms(d, rule);
      const transform = transforms?.find((t: any) => b.transforms.some((v: any) => v.encryption === t.encryption && (v.keyLength ?? 128) === (t.keyLength ?? 128) && v.integrity === t.integrity && (v.mode ?? 'tunnel') === (t.mode ?? 'tunnel')));
      const error = !rule ? 'Crypto selector or peer mismatch' : !key || b.token !== this.token(key + '|' + b.id + '|' + packet.source + '|' + packet.destination) ? 'Pre-shared key mismatch' : !policy ? 'IKE policy mismatch' : !transform || rule.pfs !== b.pfs ? 'IPsec transform or PFS mismatch' : undefined;
      if (error) { this.emit(d, 'IKE rejected', error, 'drop'); this.engine.sendCryptoPacket(d.id, packet.destination, packet.source, 'udp', { kind: 'ike', stage: 'reject', id: b.id, error }, 100); return; }
      let sa = (d.runtime.features.ipsecSAs ??= []).find((s: any) => s.id === b.id && s.peer === packet.source);
      if (!sa) { sa = { id: b.id, peer: packet.source, local: packet.destination, interface: port, map, profile: rule.profile, inboundSpi: b.spi, outboundSpi: b.spi + 1, source: b.selector.destination, destination: b.selector.source, protocol: b.selector.protocol, transform: transform.name, encryption: transform.encryption, integrity: transform.integrity, token: this.token(key + '|sa|' + b.id), created: this.engine.clock.now(), expires: this.engine.clock.now() + Math.min(rule.lifetime ?? 3600, b.lifetime) * 1000, encaps: 0, decaps: 0, sendSequence: 0, receiveSequence: 0, ready: false }; d.runtime.features.ipsecSAs.push(sa); (d.runtime.features.isakmpSAs ??= []).push({ id: b.id, local: sa.local, peer: sa.peer, state: 'MM_KEY_EXCH', policy: policy.priority, created: sa.created }); }
      this.engine.sendCryptoPacket(d.id, packet.destination, packet.source, 'udp', { kind: 'ike', stage: 'accept', id: b.id, spi: sa.outboundSpi, transform, expires: sa.expires, token: this.token(key + '|accept|' + b.id) }, 220); return;
    }
    const p = this.pending.get(b.id);
    if (b.stage === 'reject' && p && p.deviceId === d.id && p.peer === packet.source) { this.fail(p, b.error); return; }
    if (b.stage === 'accept' && p && p.deviceId === d.id && p.peer === packet.source) {
      const key = this.key(d, p.peer); if (!key || b.token !== this.token(key + '|accept|' + p.id)) { this.fail(p, 'IKE response authentication mismatch'); return; }
      const sa = { id: p.id, peer: p.peer, local: p.local, interface: p.port, map: p.rule.map, profile: p.profile, inboundSpi: b.spi, outboundSpi: p.proposal.spi, source: p.proposal.selector.source, destination: p.proposal.selector.destination, protocol: p.proposal.selector.protocol, transform: b.transform.name, encryption: b.transform.encryption, integrity: b.transform.integrity, token: this.token(key + '|sa|' + p.id), created: this.engine.clock.now(), expires: b.expires, encaps: 0, decaps: 0, sendSequence: 0, receiveSequence: 0, ready: true };
      (d.runtime.features.ipsecSAs ??= []).push(sa); const ike = d.runtime.features.isakmpSAs.find((s: any) => s.id === p.id); if (ike) ike.state = 'QM_IDLE';
      this.engine.sendCryptoPacket(d.id, p.local, p.peer, 'udp', { kind: 'ike', stage: 'confirm', id: p.id, token: sa.token }, 100); this.pending.delete(p.id); this.emit(d, 'IPsec SA established', 'Educational ESP model; inner packet remains inspectable.', 'success'); for (const inner of p.packets) this.encapsulate(d, sa, inner); return;
    }
    if (b.stage === 'confirm') { const sa = d.runtime.features.ipsecSAs?.find((s: any) => s.id === b.id && s.peer === packet.source && s.token === b.token); if (sa) { sa.ready = true; const ike = d.runtime.features.isakmpSAs?.find((s: any) => s.id === b.id && s.peer === packet.source); if (ike) ike.state = 'QM_IDLE'; } }
  }
  private encapsulate(d: Device, sa: any, inner: IPPacket): void {
    sa.encaps++; const sequence = ++sa.sendSequence;
    this.emit(d, 'ESP encapsulation', `${inner.source} → ${inner.destination} inside modeled ESP to ${sa.peer}`);
    this.engine.sendCryptoPacket(d.id, sa.local, sa.peer, 'esp', { kind: 'esp', spi: sa.outboundSpi, sequence, token: sa.token, inner: structuredClone(inner) }, inner.size + 56);
  }
  private decapsulate(d: Device, packet: IPPacket): void {
    const b = packet.body, sa = d.runtime.features.ipsecSAs?.find((s: any) => s.peer === packet.source && s.local === packet.destination && s.inboundSpi === b.spi && s.token === b.token && s.expires > this.engine.clock.now());
    if (!sa || b.sequence <= sa.receiveSequence) { this.emit(d, 'ESP rejected', 'No matching unexpired security association, or replayed sequence.', 'drop'); return; }
    // A valid protected data packet confirms receipt even when the separate final IKE message was lost.
    sa.ready = true; sa.receiveSequence = b.sequence; sa.decaps++; this.emit(d, 'ESP decapsulation', 'Validated modeled association and sequence; forwarding inner packet.'); this.engine.receiveDecryptedPacket(d.id, sa.interface, b.inner);
  }
}
