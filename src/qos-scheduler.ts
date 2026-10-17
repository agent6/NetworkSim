import type { Simulator, Frame, IPPacket } from './engine.ts';
import type { Device } from './model.ts';
import type { TimerHandle } from './clock.ts';
import { interfaceBandwidth, interfaceSpeed } from './ethernet.ts';

export const queueFields = ['bandwidth', 'bandwidthPercent', 'priority', 'shape', 'fairQueue', 'randomDetect', 'queueLimit'];
export const queuePolicy = (policy: any): boolean => (policy?.classes ?? []).some((c: any) => queueFields.some(k => c[k] !== undefined));
export const catalystQueueProfile = (d: Device): boolean => ['switch', 'l3switch', 'poeswitch'].includes(d.kind);
const classifications = new WeakMap<IPPacket, Map<string, string>>();
export function rememberQosClass(packet: IPPacket, device: Device, port: string, policy: string, name: string): void {
  let rows = classifications.get(packet); if (!rows) classifications.set(packet, rows = new Map()); rows.set(device.id + '|' + port + '|' + policy, name);
}
export function inheritQosClass(source: IPPacket, target: IPPacket): void { const rows = classifications.get(source); if (rows) classifications.set(target, new Map(rows)); }

/** A simulator capability boundary, in addition to release-specific IOS restrictions. */
export function schedulingError(policy: any, port?: string, direction?: string, baseBits?: number, catalyst = false): string | undefined {
  if (!queuePolicy(policy)) return;
  if (direction && !['out', 'output'].includes(direction)) return 'Queueing is supported only by physical Ethernet output policies in this simulator.';
  if (port && (/^(?:Loopback|Vlan|Tunnel|Null|Port-channel|Wireless|control-plane)/i.test(port) || port.includes('.'))) return 'Queueing requires a physical Ethernet output interface in this simulator.';
  const classes = policy.classes ?? [];
  const classCount = classes.length + (classes.some((c:any)=>c.name==='class-default') ? 0 : 1);
  if (classCount > (catalyst ? 8 : 64)) return catalyst ? 'This Catalyst profile supports at most 8 egress queues, including class-default.' : 'This simulator supports at most 64 classes, including class-default, in one output policy.';
  if (classes.filter((c: any) => c.priority).length > 1) return 'This simulator supports one LLQ priority class per output policy.';
  for (const c of classes) {
    if (c.fairQueue || c.randomDetect) return 'Flow-based fair-queue and random-detect are not supported by this simulator.';
    if (c.priority && (c.bandwidth || c.bandwidthPercent !== undefined || c.shape)) return 'Remove bandwidth or shaping before configuring priority in the same class.';
    if (catalyst && c.shape && (c.bandwidth || c.bandwidthPercent !== undefined)) return 'This Catalyst profile does not support bandwidth and shape in the same class.';
    if (c.queueLimit !== undefined && (!Number.isInteger(c.queueLimit) || c.queueLimit < 1 || c.queueLimit > 4096)) return 'The simulator queue-limit range is 1 to 4096 packets.';
    if (c.shape && (!Number.isFinite(c.shape.rate) || c.shape.rate < 1000)) return 'Invalid average shaper rate.';
  }
  const percent = classes.reduce((n: number, c: any) => n + Number(c.priority?.percent ?? 0) + Number(c.bandwidth?.remaining ? 0 : c.bandwidth?.percent ?? c.bandwidthPercent ?? 0), 0);
  if (percent > 100) return 'Total priority and bandwidth percentages exceed 100 percent.';
  if (!catalyst && classes.reduce((n: number, c: any) => n + Number(c.bandwidth?.remaining ? c.bandwidth.percent : 0), 0) > 100) return 'Total remaining-bandwidth percentages exceed 100 percent.';
  if (catalyst && new Set(classes.filter((c:any)=>c.bandwidth||c.bandwidthPercent!==undefined).map((c:any)=>c.bandwidth?.remaining?'remaining':c.bandwidth?.percent!==undefined||c.bandwidthPercent!==undefined?'percent':'kbps')).size>1) return 'This Catalyst profile does not support mixing bandwidth types in one policy.';
  if (baseBits) {
    const reserved = classes.reduce((n: number, c: any) => n + (c.priority?.kbps ?? 0) * 1000 + (c.bandwidth?.remaining ? 0 : c.bandwidth?.kbps ?? 0) * 1000, baseBits * percent / 100);
    if (reserved > baseBits) return 'Class bandwidth reservations exceed the configured interface bandwidth.';
  }
}
type Entry = { frame: Frame; send: () => number; bytes: number; at: number; tag: number };
type ClassQueue = { config: any; items: Entry[]; tag: number; nextEligible: number; tokens: number; meterAt: number; stats: any; counterKey: string; weight: number };
type State = { device: Device; port: string; runtime: Device['runtime']; signature: string; policy: string; queues: Map<string, ClassQueue>; timer?: TimerHandle; busyUntil: number; virtualTime: number };

/** Original event-clock CBWFQ/LLQ teaching scheduler. It is not a hardware queue emulator. */
export class EgressScheduler {
  private states = new Map<string, State>();
  private engine: Simulator;
  constructor(engine: Simulator) { this.engine = engine; }
  private signature(d: Device, port: string): string { const iface=d.config.interfaces[port]; if(!iface)return '';const name = iface.features.servicePolicyOut; return JSON.stringify([name, d.config.features.policyMaps?.[name], d.config.features.classMaps, interfaceSpeed(d, iface), interfaceBandwidth(d, iface)]); }
  sync(): void {
    for (const [key, state] of this.states) if (state.runtime !== state.device.runtime || state.signature !== this.signature(state.device, state.port) || !this.engine.interfaceUp(state.device.id, state.port)) {
      this.engine.clock.cancel(state.timer); for (const queue of state.queues.values()) for (const item of queue.items.splice(0)) this.drop(state, queue, item, 'QoS queue reset', 'The interface, policy or device changed while the frame was queued.'); this.states.delete(key);
    }
  }
  reset(): void { for (const state of this.states.values()) this.engine.clock.cancel(state.timer); this.states.clear(); }
  enqueue(d: Device, port: string, frame: Frame, send: () => number, availableAt: number, classify: (packet: IPPacket) => string | undefined): boolean {
    const policyName = d.config.interfaces[port].features.servicePolicyOut, policy = d.config.features.policyMaps?.[policyName]; if (!queuePolicy(policy)) return false;
    const error = schedulingError(policy, port, 'out', interfaceBandwidth(d, d.config.interfaces[port]) * 1000, catalystQueueProfile(d));
    if (error) { this.engine.emit({ nodeId: d.id, port, protocol: 'QOS', label: 'Unsupported queued policy', detail: error, disposition: 'drop' }); const counter = d.runtime.counters[port] ??= { tx: 0, rx: 0, drops: 0, txBytes: 0, rxBytes: 0 }; counter.drops++; return true; }
    this.sync(); const key = d.id + ':' + port, now = this.engine.clock.now(); let state = this.states.get(key);
    if (!state) { state = { device: d, port, runtime: d.runtime, signature: this.signature(d, port), policy: policyName, queues: new Map(), busyUntil: Math.max(now, availableAt), virtualTime: 0 }; this.states.set(key, state); }
    const packet = 'kind' in frame.payload ? undefined : frame.payload;
    const name = packet ? classifications.get(packet)?.get(d.id + '|' + port + '|' + policyName) ?? classify(packet) ?? 'class-default' : 'class-default';
    let queue = state.queues.get(name);
    if (!queue) {
      const c = policy.classes.find((row: any) => row.name === name) ?? { name }, base = interfaceBandwidth(d, d.config.interfaces[port]) * 1000;
      const reserved = policy.classes.reduce((n: number, row: any) => n + this.rate(row.priority, base) + (row.bandwidth?.remaining ? 0 : this.rate(row.bandwidth ?? (row.bandwidthPercent !== undefined ? { percent: row.bandwidthPercent } : undefined), base)), 0), remaining = Math.max(1, base - reserved);
      const weight = c.bandwidth?.remaining ? this.rate(c.bandwidth, remaining) : this.rate(c.bandwidth ?? (c.bandwidthPercent !== undefined ? { percent: c.bandwidthPercent } : undefined), base) || remaining;
      const counterKey = policyName + ':' + name + ':' + port + ':out', stats = (d.runtime.features.qosQueues ??= {})[counterKey] ??= { depth: 0, peakDepth: 0, queued: 0, dequeued: 0, dropped: 0, priorityDropped: 0, bytesSent: 0, delayTotal: 0 };
      queue = { config: c, items: [], tag: state.virtualTime, nextEligible: now, tokens: Math.max(1500, this.rate(c.priority, base) / 8 * .2), meterAt: now, stats, counterKey, weight: Math.max(1, weight) }; state.queues.set(name, queue);
    }
    const bytes = packet?.size ?? 64, item = { frame, send, bytes, at: now, tag: Math.max(queue.tag, state.virtualTime) + bytes / queue.weight }; queue.tag = item.tag;
    const total = [...state.queues.values()].reduce((n, q) => n + q.items.length, 0);
    if (queue.items.length >= (queue.config.queueLimit ?? 64) || total >= 16384) { this.drop(state, queue, item, 'QoS queue tail drop', 'The configured class queue has no free packet slots.'); return true; }
    queue.items.push(item); queue.stats.queued++; queue.stats.depth = queue.items.length; queue.stats.peakDepth = Math.max(queue.stats.peakDepth, queue.stats.depth);
    if (!state.timer) this.wake(state, Math.max(0, state.busyUntil - now)); return true;
  }
  private rate(setting: any, base: number): number { return setting ? Math.max(1, setting.percent !== undefined ? base * setting.percent / 100 : Number(setting.kbps) * 1000) : 0; }
  private drop(state: State, queue: ClassQueue, item: Entry, label: string, reason: string): void {
    queue.stats.dropped++; queue.stats.depth = queue.items.length;
    const counters = state.runtime.features.qosCounters?.[queue.counterKey]; if (counters && !('kind' in item.frame.payload)) counters.dropped++;
    const physical = state.runtime.counters[state.port] ??= { tx: 0, rx: 0, drops: 0, txBytes: 0, rxBytes: 0 }; physical.drops++;
    this.engine.emit({ nodeId: state.device.id, port: state.port, protocol: 'QOS', label, detail: state.policy + ' / ' + queue.config.name + ': ' + reason, disposition: 'drop', packet: { id: item.frame.id, source: 'source' in item.frame.payload ? item.frame.payload.source : '-', destination: 'destination' in item.frame.payload ? item.frame.payload.destination : '-', protocol: 'kind' in item.frame.payload ? item.frame.payload.kind : item.frame.payload.protocol, size: item.bytes } });
  }
  private wake(state: State, delay: number): void { state.timer = this.engine.clock.schedule(delay, () => { state.timer = undefined; this.pump(state); }, { owner: state.device.id, label: 'QoS egress scheduling' }); }
  private pump(state: State): void {
    if (this.states.get(state.device.id + ':' + state.port) !== state) return;
    this.sync(); if (this.states.get(state.device.id + ':' + state.port) !== state) return;
    const now = this.engine.clock.now(), pending = [...state.queues.values()].filter(q => q.items.length);
    if (!pending.length) return;
    const ready = pending.filter(q => q.nextEligible <= now + 1e-9), priority = ready.find(q => q.config.priority);
    let queue = priority ?? ready.filter(q => !q.config.priority).sort((a, b) => a.items[0].tag - b.items[0].tag)[0];
    if (!queue) { this.wake(state, Math.max(0, Math.min(...pending.map(q => q.nextEligible)) - now)); return; }
    let item = queue.items.shift()!; queue.stats.depth = queue.items.length;
    if (queue.config.priority) {
      const rate = this.rate(queue.config.priority, interfaceBandwidth(state.device, state.device.config.interfaces[state.port]) * 1000), burst = Math.max(1500, rate / 8 * .2);
      queue.tokens = Math.min(burst, queue.tokens + Math.max(0, now - queue.meterAt) * rate / 8000); queue.meterAt = now;
      if (ready.some(q => q !== queue) || queue.items.length) {
        if (queue.tokens < item.bytes) { queue.stats.priorityDropped++; this.drop(state, queue, item, 'QoS priority exceed drop', 'The congested priority queue exceeded its bandwidth allowance.'); this.wake(state, 0); return; }
      }
      queue.tokens = Math.max(0, queue.tokens - item.bytes);
    } else state.virtualTime = Math.max(state.virtualTime, item.tag);
    if (queue.config.shape) queue.nextEligible = now + item.bytes * 8000 / queue.config.shape.rate;
    queue.stats.dequeued++; queue.stats.bytesSent += item.bytes; queue.stats.delayTotal += now - item.at;
    const counters = state.device.runtime.features.qosCounters?.[queue.counterKey]; if (counters && !('kind' in item.frame.payload)) counters.transmitted++;
    state.busyUntil = item.send(); this.wake(state, Math.max(0, state.busyUntil - now));
  }
}
