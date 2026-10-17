import type { Simulator, Frame, IPPacket } from './engine.ts';
import type { Device } from './model.ts';
import type { TimerHandle } from './clock.ts';
import { interfaceBandwidth, interfaceSpeed } from './ethernet.ts';
import {qosFlowBucket,wredConfiguration,wredCurve,wredError} from './qos-congestion.ts';

export const queueFields = ['bandwidth', 'bandwidthPercent', 'priority', 'shape', 'fairQueue', 'randomDetect', 'queueLimit'];
export const queuePolicy = (policy: any): boolean => (policy?.classes ?? []).some((c: any) => queueFields.some(k => c[k] != null && c[k] !== false));
export const catalystQueueProfile = (d: Device): boolean => ['switch', 'l3switch', 'poeswitch'].includes(d.kind);
const classifications = new WeakMap<IPPacket, Map<string, string>>();
export function rememberQosClass(packet: IPPacket, device: Device, port: string, policy: string, name: string): void {
  let rows = classifications.get(packet); if (!rows) classifications.set(packet, rows = new Map()); rows.set(device.id + '|' + port + '|' + policy, name);
}
export function inheritQosClass(source: IPPacket, target: IPPacket): void { const rows = classifications.get(source); if (rows) classifications.set(target, new Map(rows)); }

/** A simulator capability boundary, in addition to release-specific IOS restrictions. */
export function schedulingError(policy: any, port?: string, direction?: string, baseBits?: number, catalyst = false, routerProfile = true): string | undefined {
  if (!queuePolicy(policy)) return;
  if (direction && !['out', 'output'].includes(direction)) return 'Queueing is supported only by physical Ethernet output policies in this simulator.';
  if (port && (/^(?:Loopback|Vlan|Tunnel|Null|Port-channel|Wireless|control-plane)/i.test(port) || port.includes('.'))) return 'Queueing requires a physical Ethernet output interface in this simulator.';
  const classes = policy.classes ?? [];
  const classCount = classes.length + (classes.some((c:any)=>c.name==='class-default') ? 0 : 1);
  if (classCount > (catalyst ? 8 : 64)) return catalyst ? 'This Catalyst profile supports at most 8 egress queues, including class-default.' : 'This simulator supports at most 64 classes, including class-default, in one output policy.';
  if (classes.filter((c: any) => c.priority).length > 1) return 'This simulator supports one LLQ priority class per output policy.';
  for (const c of classes) {
    if (catalyst && (c.fairQueue || c.randomDetect)) return 'Router fair-queue and random-detect syntax is not supported on this Catalyst profile.';
    if (!routerProfile && (c.fairQueue || c.randomDetect)) return 'Flow fair-queue and WRED are implemented only by the ISR router profile.';
    if (c.fairQueue!==undefined&&c.fairQueue!==false&&c.fairQueue!==true) return 'Only the fixed 16-flow fair-queue mode is supported by this simulator.';
    if (c.priority&&(c.fairQueue||c.randomDetect)) return 'Flow fair-queue and WRED cannot be configured in a priority class.';
    if(c.name!=='class-default'&&(c.fairQueue||c.randomDetect)&&!c.bandwidth&&c.bandwidthPercent===undefined&&!c.shape)return 'Configure bandwidth or shape before flow fair-queue or WRED in a named class.';
    if (c.randomDetect) {const error=wredError(c.randomDetect,c.queueLimit??(c.fairQueue?16:64));if(error)return error;}
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
type Entry = { frame: Frame; send: () => number; bytes: number; at: number; tag: number;flow:number;flowTag:number;curveKey?:number };
type FlowQueue={tag:number;items:Entry[];average:number;idleAt?:number;stats:any};
type ClassQueue = { config: any; items: Entry[]; tag: number;head?:Entry;flows:Map<number,FlowQueue>;flowTime:number; nextEligible: number; tokens: number; meterAt: number; stats: any; counterKey: string; weight: number };
type State = { device: Device; port: string; runtime: Device['runtime']; signature: string; policy: string; queues: Map<string, ClassQueue>; timer?: TimerHandle; busyUntil: number; virtualTime: number };

/** Original event-clock CBWFQ/LLQ teaching scheduler. It is not a hardware queue emulator. */
export class EgressScheduler {
  private states = new Map<string, State>();
  private engine: Simulator;
  constructor(engine: Simulator) { this.engine = engine; }
  private signature(d: Device, port: string): string { const iface=d.config.interfaces[port]; if(!iface)return '';const name = iface.features.servicePolicyOut; return JSON.stringify([name, d.config.features.policyMaps?.[name], d.config.features.classMaps, interfaceSpeed(d, iface), interfaceBandwidth(d, iface)]); }
  sync(): void {
    for (const [key, state] of this.states) if (state.runtime !== state.device.runtime || state.signature !== this.signature(state.device, state.port) || !this.engine.interfaceUp(state.device.id, state.port)) {
      this.engine.clock.cancel(state.timer); for (const queue of state.queues.values()){for (const item of queue.items.splice(0)) this.drop(state, queue, item, 'QoS queue reset', 'The interface, policy or device changed while the frame was queued.');for(const flow of queue.flows.values()){flow.items=[];flow.stats.depth=0;}queue.head=undefined;} this.states.delete(key);
    }
  }
  reset(): void { for (const state of this.states.values()) this.engine.clock.cancel(state.timer); this.states.clear(); }
  enqueue(d: Device, port: string, frame: Frame, send: () => number, availableAt: number, classify: (packet: IPPacket) => string | undefined): boolean {
    const policyName = d.config.interfaces[port].features.servicePolicyOut, policy = d.config.features.policyMaps?.[policyName]; if (!queuePolicy(policy)) return false;
    const error = schedulingError(policy, port, 'out', interfaceBandwidth(d, d.config.interfaces[port]) * 1000, catalystQueueProfile(d), d.kind==='router');
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
      const mode=wredConfiguration(c.randomDetect)?.mode;if(stats.wredMode!==mode){stats.wredCurves={};stats.ecnMarked=0;stats.averageDepth=0;stats.wredMode=mode;}
      queue = { config: c, items: [], flows:new Map(),flowTime:0,tag: state.virtualTime, nextEligible: now, tokens: Math.max(1500, this.rate(c.priority, base) / 8 * .2), meterAt: now, stats, counterKey, weight: Math.max(1, weight) }; state.queues.set(name, queue);
    }
    const bucket=queue.config.fairQueue?qosFlowBucket(packet):0;let flow=queue.flows.get(bucket);if(!flow){const stats=(queue.stats.flows??={})[bucket]??={depth:0,peakDepth:0,queued:0,dequeued:0,dropped:0,bytesSent:0};flow={tag:queue.flowTime,items:[],average:0,stats};queue.flows.set(bucket,flow);}
    const bytes = packet?.size ?? 64,wred=wredConfiguration(queue.config.randomDetect),item:Entry = { frame, send, bytes, at: now, tag:0,flow:bucket,flowTag:0,curveKey:wred?(wred.mode==='dscp'?packet?.dscp??0:(packet?.dscp??0)>>3):undefined };
    const total = [...state.queues.values()].reduce((n, q) => n + q.items.length, 0);
    if (flow.items.length >= this.limit(queue) || total >= 16384) { this.drop(state, queue, item, 'QoS queue tail drop', 'The configured class or flow queue has no free packet slots.'); return true; }
    if(wred&&!this.admitWred(state,queue,flow,item,packet))return true;
    item.flowTag=Math.max(flow.tag,queue.flowTime)+bytes;flow.tag=item.flowTag;flow.items.push(item);flow.idleAt=undefined;flow.stats.queued++;flow.stats.depth=flow.items.length;flow.stats.peakDepth=Math.max(flow.stats.peakDepth,flow.stats.depth);
    queue.items.push(item); queue.stats.queued++; queue.stats.depth = queue.items.length; queue.stats.peakDepth = Math.max(queue.stats.peakDepth, queue.stats.depth);this.head(state,queue);
    if (!state.timer) this.wake(state, Math.max(0, state.busyUntil - now)); return true;
  }
  private rate(setting: any, base: number): number { return setting ? Math.max(1, setting.percent !== undefined ? base * setting.percent / 100 : Number(setting.kbps) * 1000) : 0; }
  private limit(queue:ClassQueue):number{return queue.config.queueLimit??(queue.config.fairQueue?16:64);}
  private curveStats(queue:ClassQueue,key:number):any{return(queue.stats.wredCurves??={})[key]??={transmittedPackets:0,transmittedBytes:0,randomDropped:0,randomDroppedBytes:0,maximumDropped:0,maximumDroppedBytes:0,tailDropped:0,tailDroppedBytes:0,marked:0,markedBytes:0};}
  private admitWred(state:State,queue:ClassQueue,flow:FlowQueue,item:Entry,packet?:IPPacket):boolean{
    const config=wredConfiguration(queue.config.randomDetect)!,alpha=2**-(config.exponent??6),now=this.engine.clock.now();
    if(flow.idleAt!==undefined&&now>flow.idleAt){const rate=queue.config.shape?.rate??queue.weight,packetTime=Math.max(.001,item.bytes*8000/rate);flow.average*=Math.pow(1-alpha,(now-flow.idleAt)/packetTime);flow.idleAt=now;}
    flow.average+=(flow.items.length-flow.average)*alpha;flow.stats.averageDepth=flow.average;queue.stats.averageDepth=[...queue.flows.values()].reduce((n,f)=>n+f.average,0);
    const curve=wredCurve(config,item.curveKey!,this.limit(queue)),stats=this.curveStats(queue,item.curveKey!),hard=flow.average>curve.max,probability=hard?1:flow.average<=curve.min?0:(curve.max===curve.min?1:(flow.average-curve.min)/(curve.max-curve.min))/curve.denominator;
    if(probability<=0||!hard&&this.engine.clock.random()>=probability)return true;
    if(!hard&&config.ecn&&packet&&[1,2,3].includes(packet.ecn??0)){if(packet.ecn!==3){packet.ecn=3;stats.marked++;stats.markedBytes+=item.bytes;queue.stats.ecnMarked=(queue.stats.ecnMarked??0)+1;this.engine.emit({nodeId:state.device.id,port:state.port,protocol:'QOS',label:'QoS WRED ECN mark',detail:state.policy+' / '+queue.config.name+': congestion experienced (CE).',disposition:'info',packet:{id:packet.id,source:packet.source,destination:packet.destination,protocol:packet.protocol,size:item.bytes,ecn:3}});}return true;}
    this.drop(state,queue,item,hard?'QoS WRED maximum drop':'QoS WRED random drop',hard?'Average flow queue depth exceeded the WRED maximum threshold.':'The WRED drop probability selected this packet.');return false;
  }
  private head(state:State,queue:ClassQueue):Entry|undefined{
    if(queue.head)return queue.head;const item=queue.config.fairQueue?[...queue.flows.values()].filter(f=>f.items.length).map(f=>f.items[0]).sort((a,b)=>a.flowTag-b.flowTag||a.flow-b.flow)[0]:queue.items[0];if(item){item.tag=Math.max(queue.tag,state.virtualTime)+item.bytes/queue.weight;queue.head=item;}return item;
  }
  private drop(state: State, queue: ClassQueue, item: Entry, label: string, reason: string): void {
    queue.stats.dropped++; queue.stats.depth = queue.items.length;
    const flow=queue.flows.get(item.flow);if(flow)flow.stats.dropped++;
    if(item.curveKey!==undefined){const stats=this.curveStats(queue,item.curveKey),field=label==='QoS WRED random drop'?'randomDropped':label==='QoS WRED maximum drop'?'maximumDropped':label==='QoS queue tail drop'?'tailDropped':undefined;if(field){stats[field]++;stats[field+'Bytes']+=item.bytes;}}
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
    let queue = priority ?? ready.filter(q => !q.config.priority).sort((a, b) => this.head(state,a)!.tag - this.head(state,b)!.tag)[0];
    if (!queue) { this.wake(state, Math.max(0, Math.min(...pending.map(q => q.nextEligible)) - now)); return; }
    const item = this.head(state,queue)!;queue.head=undefined;queue.items.splice(queue.items.indexOf(item),1);const flow=queue.flows.get(item.flow)!;flow.items.shift();flow.stats.depth=flow.items.length;if(!flow.items.length)flow.idleAt=now;queue.stats.depth = queue.items.length;queue.tag=item.tag;queue.flowTime=Math.max(queue.flowTime,item.flowTag);
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
    flow.stats.dequeued++;flow.stats.bytesSent+=item.bytes;if(item.curveKey!==undefined){const stats=this.curveStats(queue,item.curveKey);stats.transmittedPackets++;stats.transmittedBytes+=item.bytes;}
    const counters = state.device.runtime.features.qosCounters?.[queue.counterKey]; if (counters && !('kind' in item.frame.payload)) counters.transmitted++;
    state.busyUntil = item.send();this.head(state,queue); this.wake(state, Math.max(0, state.busyUntil - now));
  }
}
