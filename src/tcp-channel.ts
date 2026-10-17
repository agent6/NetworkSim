import type { Simulator, IPPacket } from './engine.ts';
import type { Device } from './model.ts';
import { isIPv4, isIPv6, prefixContains, sameAddress } from './ip.ts';

export type TCPChannelState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
export interface TCPChannelHandlers {
  onOpen?: (channel: TCPChannel) => void;
  onMessage?: (payload: any, channel: TCPChannel) => void;
  onClose?: (reason: string, channel: TCPChannel) => void;
}
export interface TCPChannelOptions extends TCPChannelHandlers { source?: string; vrf?: string; interface?: string; ttl?: number; minimumTTL?: number; authentication?: string }
export interface TCPChannel {
  readonly id: string; readonly deviceId: string; readonly peerAddress: string; readonly localAddress: string;
  readonly localPort: number; readonly peerPort: number; readonly vrf?: string; readonly state: TCPChannelState;
  setHandlers(handlers: TCPChannelHandlers): void;
  setTTL(ttl: number): void;
  setAuthentication(identity?: string): void;
  send(payload: any): number | undefined;
  close(reason?: string): void;
}
type Acceptance = boolean | { ttl?: number; minimumTTL?: number; authentication?: string };
interface Listener { accepts: (device: Device, peerAddress: string, localAddress: string, vrf?: string) => Acceptance; connected: (channel: TCPChannel) => void }
interface Outgoing { sequence: number; chunks: string[]; acknowledged: Set<number> }
interface Incoming { total: number; parts: Map<number, string> }
interface Connection {
  id: string; deviceId: string; localAddress: string; peerAddress: string; localPort: number; peerPort: number;
  vrf?: string; interface?: string; ttl: number; minimumTTL?: number; authentication?: string; state: TCPChannelState; role: 'client' | 'server'; channel: TCPChannel;
  handlers: TCPChannelHandlers; listener?: Listener; outgoing: Outgoing[]; incoming: Map<number, Incoming>; sendSequence: number;
  receiveSequence: number; retransmissions: number; sent: number; received: number; closeReason?: string; notifiedClose: boolean;
  opened: boolean; finStarted: boolean; peerMss:number;
}

/** Persistent, ordered educational TCP channels. Every handshake, data segment and ACK traverses the engine. */
export class PersistentTCPChannels {
  private engine: Simulator;
  private listeners = new Map<number, Listener>();
  private connections = new Map<string, Connection>();
  private sequence = 0;
  private packets = 0;
  constructor(engine: Simulator) { this.engine = engine; }
  register(port: number, accepts: Listener['accepts'], connected: Listener['connected']): () => void {
    this.validatePort(port); const listener = { accepts, connected }; this.listeners.set(port, listener);
    return () => { if (this.listeners.get(port) === listener) this.listeners.delete(port); };
  }
  connect(deviceId: string, address: string, port: number, options: TCPChannelOptions = {}): TCPChannel {
    this.validatePort(port); const device = this.engine.getDevice(deviceId); if (!device) throw new Error('Unknown source device');
    const id = 'channel-' + (++this.sequence).toString(36), localPort = 49152 + this.sequence % 16384;
    const conn = this.create({ id, deviceId: device.id, localAddress: '', peerAddress: address, localPort, peerPort: port, vrf: options.vrf, interface: options.interface, ttl: this.ttl(options.ttl), minimumTTL: options.minimumTTL === undefined ? undefined : this.ttl(options.minimumTTL), authentication: options.authentication, role: 'client', handlers: options });
    this.engine.clock.schedule(0, () => {
      if (!this.current(conn)) return;
      if (!device.powered) { this.finish(conn, 'Device is powered off'); return; }
      if (!isIPv4(address) && !isIPv6(address)) { this.finish(conn, 'TCP requires a resolved IP address'); return; }
      const v6 = isIPv6(address), route = this.engine.cefLookup(device.id, address, options.vrf);
      let portName = options.interface ?? (options.source && device.config.interfaces[options.source] ? options.source : undefined);
      if (!portName && options.source) { const matches = Object.keys(device.config.interfaces).filter(name => this.owns(device, name, options.source!, options.vrf)); if (matches.length !== 1) { this.finish(conn, 'TCP requires one unambiguous source interface'); return; } portName = matches[0]; }
      portName ??= route?.port;
      if (!portName && v6 && prefixContains('fe80::', 10, address)) { const eligible = Object.keys(device.config.interfaces).filter(name => this.engine.interfaceUp(device.id, name) && (device.config.interfaces[name].ipv6.length || device.config.interfaces[name].features.ipv6Enabled) && (device.config.interfaces[name].vrf ?? '') === (options.vrf ?? '')); if (eligible.length === 1) portName = eligible[0]; }
      const iface = portName && device.config.interfaces[portName];
      if (!iface || !this.engine.interfaceUp(device.id, portName!) || (iface.vrf ?? '') !== (options.vrf ?? '')) { this.finish(conn, 'No operational source interface in the selected VRF'); return; }
      const source = options.source && !device.config.interfaces[options.source] ? options.source : v6 ? (prefixContains('fe80::', 10, address) ? this.engine.linkLocalAddress(device.id, portName!) : this.engine.preferredIPv6Address(device.id, portName!)) : iface.ip;
      if (!source || !this.owns(device, portName!, source, options.vrf) || isIPv6(source) !== v6) { this.finish(conn, 'TCP source address is not assigned to the selected interface'); return; }
      conn.localAddress = source; conn.interface = portName; this.snapshot(conn);
      const syn = this.packet(conn, 'syn'); this.reliable(conn, syn, () => conn.opened, 'TCP connection timed out');
    }, { owner: device.id, label: 'TCP channel connect' });
    return conn.channel;
  }
  receive(device: Device, packet: IPPacket, input?: string): void {
    const body = packet.body; if (body?.kind !== 'tcp-channel') return;
    const key = device.id + '|' + body.channelId; let conn = this.connections.get(key);
    if (body.phase === 'syn' && !conn) {
      const listener = this.listeners.get(packet.destinationPort!); let accepted: Acceptance = false;
      try { accepted = listener?.accepts(device, packet.source, packet.destination, packet.vrf) ?? false; } catch { accepted = false; }
      if (!accepted || !listener) { this.replyReset(device, packet); return; }
      const authentication = typeof accepted === 'object' ? accepted.authentication : undefined; if (authentication !== body.authentication) { this.authenticationDrop(device); return; }
      const minimumTTL = typeof accepted === 'object' && accepted.minimumTTL !== undefined ? this.ttl(accepted.minimumTTL) : undefined; if (minimumTTL !== undefined && packet.ttl < minimumTTL) { this.ttlDrop(device, minimumTTL); return; }
      conn = this.create({ id: body.channelId, deviceId: device.id, localAddress: packet.destination, peerAddress: packet.source, localPort: packet.destinationPort!, peerPort: packet.sourcePort!, vrf: packet.vrf, interface: input, ttl: this.ttl(typeof accepted === 'object' ? accepted.ttl : undefined), minimumTTL, authentication, role: 'server', handlers: {}, listener });
      conn.peerMss=this.peerMss(body.mss);const acceptedConn = conn, synAck = this.packet(conn, 'syn-ack', {}, packet.id); this.reliable(conn, synAck, () => acceptedConn.opened, 'TCP handshake acknowledgement timed out'); return;
    }
    if (!conn) { if (body.phase !== 'rst') this.replyReset(device, packet); return; }
    if (!sameAddress(conn.peerAddress, packet.source) || !sameAddress(conn.localAddress, packet.destination) || conn.peerPort !== packet.sourcePort || conn.localPort !== packet.destinationPort || (conn.vrf ?? '') !== (packet.vrf ?? '')) return;
    if (conn.authentication !== body.authentication) { this.authenticationDrop(device); return; }
    if (conn.minimumTTL !== undefined && packet.ttl < conn.minimumTTL) { this.ttlDrop(device, conn.minimumTTL); return; }
    if (body.phase === 'rst') { this.finish(conn, 'Peer reset the connection'); return; }
    if (conn.state === 'CLOSED') { if (body.phase === 'fin') this.send(conn, this.packet(conn, 'fin-ack', {}, packet.id)); else if (body.phase !== 'fin-ack') this.replyReset(device, packet); return; }
    if (body.phase === 'syn') { this.send(conn, this.packet(conn, 'syn-ack', {}, packet.id)); return; }
    if (body.phase === 'syn-ack' && conn.role === 'client') { conn.peerMss=this.peerMss(body.mss);this.send(conn, this.packet(conn, 'ack', {}, packet.id)); this.open(conn); return; }
    if ((body.phase === 'ack' || body.phase === 'data') && conn.role === 'server' && !conn.opened) this.open(conn);
    if (body.phase === 'ack') return;
    if (body.phase === 'fin') { this.send(conn, this.packet(conn, 'fin-ack', {}, packet.id)); this.finish(conn, 'Peer closed the connection'); return; }
    if (body.phase === 'fin-ack') { if (conn.finStarted) this.finish(conn, conn.closeReason ?? 'Connection closed'); return; }
    if (!conn.opened) return;
    if (body.phase === 'data-ack') {
      const pending = conn.outgoing[0]; if (!pending || body.sequence !== pending.sequence || !Number.isInteger(body.segment) || body.segment < 0 || body.segment >= pending.chunks.length) return;
      pending.acknowledged.add(body.segment); if (pending.acknowledged.size === pending.chunks.length) { conn.outgoing.shift(); this.flush(conn); } this.snapshot(conn); return;
    }
    if (body.phase !== 'data') return;
    if (!Number.isInteger(body.sequence) || body.sequence < 1 || body.sequence > conn.receiveSequence + 128 || !Number.isInteger(body.segment) || !Number.isInteger(body.total) || body.total < 1 || body.total > 1024 || body.segment < 0 || body.segment >= body.total || typeof body.data !== 'string' || new TextEncoder().encode(body.data).length > 1024) { this.abort(conn, 'Invalid TCP channel segment'); return; }
    this.send(conn, this.packet(conn, 'data-ack', { sequence: body.sequence, segment: body.segment }, packet.id));
    if (body.sequence < conn.receiveSequence) return;
    let incoming = conn.incoming.get(body.sequence); if (!incoming) { incoming = { total: body.total, parts: new Map() }; conn.incoming.set(body.sequence, incoming); }
    if (incoming.total !== body.total) { this.abort(conn, 'Inconsistent TCP channel segment count'); return; }
    if (!incoming.parts.has(body.segment)) incoming.parts.set(body.segment, body.data);
    while (this.current(conn) && conn.channel.state !== 'CLOSED') {
      const next = conn.incoming.get(conn.receiveSequence); if (!next || next.parts.size !== next.total) break;
      let payload: any; try { payload = JSON.parse(Array.from({ length: next.total }, (_, n) => next.parts.get(n)).join('')); } catch { this.abort(conn, 'Invalid TCP channel message'); return; }
      conn.incoming.delete(conn.receiveSequence++); conn.received++; this.snapshot(conn);
      try { conn.handlers.onMessage?.(payload, conn.channel); } catch { this.abort(conn, 'TCP application callback failed'); return; }
    }
  }
  closeDevice(deviceId: string, reason = 'Device power state changed'): void { for (const conn of [...this.connections.values()]) if (conn.deviceId === deviceId) { this.finish(conn, reason); this.connections.delete(conn.deviceId + '|' + conn.id); } }
  reset(): void { for (const conn of this.connections.values()) { conn.state = 'CLOSED'; conn.handlers = {}; conn.outgoing = []; conn.incoming.clear(); } this.connections.clear(); }
  private create(input: Pick<Connection, 'id' | 'deviceId' | 'localAddress' | 'peerAddress' | 'localPort' | 'peerPort' | 'vrf' | 'interface' | 'ttl' | 'minimumTTL' | 'authentication' | 'role' | 'handlers'> & { listener?: Listener }): Connection {
    const conn = { ...input, state: 'CONNECTING' as TCPChannelState, outgoing: [], incoming: new Map(), sendSequence: 1, receiveSequence: 1, retransmissions: 0, sent: 0, received: 0, notifiedClose: false, opened: false, finStarted: false, peerMss:1024 } as unknown as Connection;
    conn.channel = { get id() { return conn.id; }, get deviceId() { return conn.deviceId; }, get peerAddress() { return conn.peerAddress; }, get localAddress() { return conn.localAddress; }, get localPort() { return conn.localPort; }, get peerPort() { return conn.peerPort; }, get vrf() { return conn.vrf; }, get state() { return conn.state; }, setHandlers: handlers => { conn.handlers = { ...conn.handlers, ...handlers }; }, setTTL: ttl => { conn.ttl = this.ttl(ttl); }, setAuthentication: identity => { conn.authentication = identity; }, send: payload => this.enqueue(conn, payload), close: reason => this.close(conn, reason) };
    this.connections.set(conn.deviceId + '|' + conn.id, conn); this.snapshot(conn); return conn;
  }
  private open(conn: Connection): void {
    if (conn.opened || conn.state !== 'CONNECTING') return; conn.opened = true; conn.state = 'OPEN'; this.snapshot(conn);
    this.engine.emit({ nodeId: conn.deviceId, protocol: 'TCP', label: 'TCP channel established', detail: conn.localAddress + ':' + conn.localPort + ' ↔ ' + conn.peerAddress + ':' + conn.peerPort, disposition: 'success' });
    try { if (conn.role === 'server') conn.listener?.connected(conn.channel); if (conn.state === 'OPEN') conn.handlers.onOpen?.(conn.channel); } catch { this.abort(conn, 'TCP application callback failed'); }
  }
  private enqueue(conn: Connection, payload: any): number | undefined {
    if (!this.current(conn) || conn.state !== 'OPEN') return;
    const encoded = JSON.stringify(payload); if (encoded === undefined) throw new Error('TCP channel payload must be JSON serializable');
    if (new TextEncoder().encode(encoded).length > 1048576 || conn.outgoing.length >= 128) throw new Error('TCP channel message or queue exceeds simulator limits');
    const maximum=Math.min(1024,conn.peerMss);const chunks: string[] = []; let chunk = '', bytes = 0;
    for (const character of encoded) { const length = new TextEncoder().encode(character).length; if (bytes + length > maximum && chunk) { chunks.push(chunk); chunk = ''; bytes = 0; } chunk += character; bytes += length; } chunks.push(chunk);
    const sequence = conn.sendSequence++, pending = { sequence, chunks, acknowledged: new Set<number>() }; conn.outgoing.push(pending); conn.sent++; this.snapshot(conn); if (conn.outgoing.length === 1) this.flush(conn); return sequence;
  }
  private flush(conn: Connection): void {
    const pending = conn.outgoing[0]; if (!pending) { if (conn.state === 'CLOSING') this.startFin(conn); return; }
    for (let segment = 0; segment < pending.chunks.length; segment++) { const packet = this.packet(conn, 'data', { sequence: pending.sequence, segment, total: pending.chunks.length, data: pending.chunks[segment] }); this.reliable(conn, packet, () => pending.acknowledged.has(segment) || conn.outgoing[0] !== pending, 'TCP data acknowledgement timed out'); }
  }
  private close(conn: Connection, reason = 'Connection closed'): void {
    if (!this.current(conn) || conn.state === 'CLOSED' || conn.state === 'CLOSING') return;
    if (!conn.opened) { this.abort(conn, reason); return; } conn.state = 'CLOSING'; conn.closeReason = reason; this.snapshot(conn); if (!conn.outgoing.length) this.startFin(conn);
  }
  private startFin(conn: Connection): void { if (conn.finStarted || conn.state === 'CLOSED') return; conn.finStarted = true; this.reliable(conn, this.packet(conn, 'fin'), () => conn.state === 'CLOSED', 'TCP close acknowledgement timed out'); }
  private abort(conn: Connection, reason: string): void { if (conn.state === 'CLOSED') return; this.send(conn, this.packet(conn, 'rst')); this.finish(conn, reason); }
  private finish(conn: Connection, reason: string): void {
    if (conn.state === 'CLOSED') return; conn.state = 'CLOSED'; conn.closeReason = reason; conn.outgoing = []; conn.incoming.clear(); this.snapshot(conn);
    this.engine.emit({ nodeId: conn.deviceId, protocol: 'TCP', label: 'TCP channel closed', detail: reason, disposition: 'info' });
    if (!conn.notifiedClose) { conn.notifiedClose = true; try { conn.handlers.onClose?.(reason, conn.channel); } catch { /* Application callbacks cannot stop transport cleanup. */ } }
    this.engine.clock.schedule(30000, () => { if (this.current(conn)) { this.connections.delete(conn.deviceId + '|' + conn.id); const d = this.engine.getDevice(conn.deviceId); if (d?.runtime.features.tcpChannels) delete d.runtime.features.tcpChannels[conn.id]; } }, { owner: conn.deviceId, label: 'TCP channel closed-state cleanup' });
  }
  private reliable(conn: Connection, packet: IPPacket, done: () => boolean, failure: string, attempt = 0): void {
    if (!this.current(conn) || conn.state === 'CLOSED' || done()) return;
    if (attempt > 0) { conn.retransmissions++; this.snapshot(conn); this.engine.emit({ nodeId: conn.deviceId, protocol: 'TCP', label: 'TCP channel retransmission', detail: packet.body.phase + ' attempt ' + (attempt + 1), disposition: 'warning' }); }
    this.send(conn, packet);
    this.engine.clock.schedule(Math.min(1600, 200 * 2 ** attempt), () => { if (!this.current(conn) || conn.state === 'CLOSED' || done()) return; if (attempt >= 5) this.abort(conn, failure); else this.reliable(conn, packet, done, failure, attempt + 1); }, { owner: conn.deviceId, label: 'TCP channel retransmission timeout' });
  }
  private send(conn: Connection, packet: IPPacket): void { if (this.engine.getDevice(conn.deviceId)?.powered) { const current=structuredClone(packet);current.body.authentication=conn.authentication;this.engine.sendTCPChannelPacket(conn.deviceId, current, conn.interface); } }
  private packet(conn: Connection, phase: string, data: Record<string, any> = {}, parentId?: string): IPPacket { return { id: 'channel-packet-' + (++this.packets).toString(36), parentId, source: conn.localAddress, destination: conn.peerAddress, protocol: 'tcp', ttl: conn.ttl, size: 40 + (typeof data.data === 'string' ? new TextEncoder().encode(data.data).length : 20), df: false, sourcePort: conn.localPort, destinationPort: conn.peerPort, vrf: conn.vrf, body: { kind: 'tcp-channel', channelId: conn.id, phase, ...(['syn','syn-ack'].includes(phase)?{mss:1024}:{}), ...(conn.authentication ? {authentication:conn.authentication}:{}), ...data } }; }
  private replyReset(device: Device, incoming: IPPacket): void { const packet: IPPacket = { id: 'channel-packet-' + (++this.packets).toString(36), parentId: incoming.id, source: incoming.destination, destination: incoming.source, protocol: 'tcp', ttl: 64, size: 40, df: false, sourcePort: incoming.destinationPort, destinationPort: incoming.sourcePort, vrf: incoming.vrf, body: { kind: 'tcp-channel', channelId: incoming.body.channelId, phase: 'rst' } }; this.engine.sendTCPChannelPacket(device.id, packet); }
  private current(conn: Connection): boolean { return this.connections.get(conn.deviceId + '|' + conn.id) === conn; }
  private owns(d: Device, port: string, address: string, vrf?: string): boolean { const c = d.config.interfaces[port]; return !!c && this.engine.interfaceUp(d.id, port) && (c.vrf ?? '') === (vrf ?? '') && (c.ip === address || c.ipv6.some(value => sameAddress(value.split('/')[0], address)) || ((c.ipv6.length || c.features.ipv6Enabled) && sameAddress(this.engine.linkLocalAddress(d.id, port), address))); }
  private snapshot(conn: Connection): void { const device = this.engine.getDevice(conn.deviceId); if (device) (device.runtime.features.tcpChannels ??= {})[conn.id] = { id: conn.id, state: conn.state, role: conn.role, localAddress: conn.localAddress, peerAddress: conn.peerAddress, localPort: conn.localPort, peerPort: conn.peerPort, vrf: conn.vrf, sent: conn.sent, received: conn.received, retransmissions: conn.retransmissions, pending: conn.outgoing.length, reason: conn.closeReason,peerMss:conn.peerMss }; }
  private ttl(value = 64): number { if (!Number.isInteger(value) || value < 1 || value > 255) throw new Error('TCP channel TTL must be 1–255'); return value; }
  private peerMss(value:unknown):number {return typeof value==='number'&&Number.isInteger(value)&&value>=64&&value<=65535?value:1024;}
  private authenticationDrop(device:Device):void { device.runtime.features.tcpAuthenticationDrops=(device.runtime.features.tcpAuthenticationDrops??0)+1;this.engine.emit({nodeId:device.id,protocol:'TCP',label:'TCP authentication rejected',detail:'The modeled key identity did not match.',disposition:'drop'}); }
  private ttlDrop(device: Device, minimum: number): void { device.runtime.features.tcpTTLDrop = (device.runtime.features.tcpTTLDrop ?? 0) + 1; this.engine.emit({ nodeId: device.id, protocol: 'TCP', label: 'TCP minimum TTL rejected', detail: 'Incoming Hop Limit/TTL was below ' + minimum + '.', disposition: 'drop' }); }
  private validatePort(port: number): void { if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TCP port must be 1–65535'); }
}
