import type { Device } from './model.ts';
import type { Simulator, ServiceResult } from './engine.ts';
import type { SimulationClock } from './clock.ts';
import { slaLife, slaStart, slaReservedPorts, type SLAOperation, type SLAResult, type SLASchedule, type SLAScheduleState } from './sla-config.ts';
import { iosBooting } from './ios-boot.ts';

interface ScheduledOperation {
  device: Device;
  runtime: Device['runtime'];
  clock: SimulationClock;
  signature: string;
  owner: string;
  state: SLAScheduleState;
}

/** Scheduled probes use the packet engine; each operation owns its timers and result generation. */
export class SLAController {
  private ports = new Set<number>();
  private operations = new Map<string, ScheduledOperation>();
  private engine: Simulator;
  constructor(engine: Simulator) {
    this.engine = engine;
    engine.registerUDPService(1967, d => !!d.config.features.ipSlaResponder?.enabled, (d, p, source) => {
      if (p?.application !== 'sla-control' || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535 || slaReservedPorts.has(p.port)) return { accepted: false };
      this.listen(p.port);
      (d.runtime.features.slaResponderWindows ??= {})[`${source}:${p.port}`] = engine.clock.now() + Math.min(600000, Math.max(1000, Number(p.duration) || 10000));
      return { accepted: true };
    });
  }
  sync(): boolean {
    let changed = false;
    const wanted = new Set<string>();
    for (const device of this.engine.lab.devices) {
      for (const entry of device.config.features.ipSlaResponder?.ports ?? []) this.listen(entry.port);
      for (const id of Object.keys(device.runtime.features.ipSla ?? {})) {
        if (!device.config.features.ipSla?.[id]) { delete device.runtime.features.ipSla[id]; changed = true; }
      }
      if (!device.powered || iosBooting(device)) continue;
      for (const [id, schedule] of Object.entries<SLASchedule>(device.config.features.ipSlaSchedules ?? {})) {
        const probe: SLAOperation | undefined = device.config.features.ipSla?.[id];
        if (!probe?.target) continue;
        const key = `${device.id}|${id}`, signature = JSON.stringify([probe, schedule]), old = this.operations.get(key);
        wanted.add(key);
        if (old?.runtime === device.runtime && old.clock === this.engine.clock && old.signature === signature) continue;
        if (old) this.stop(key, id, old);
        const owner = `ip-sla-${device.id}-${id}`, now = this.engine.clock.now();
        const state: SLAScheduleState = { status: 'pending' };
        const operation: ScheduledOperation = { device, runtime: device.runtime, clock: this.engine.clock, signature, owner, state };
        this.operations.set(key, operation);
        const previous:SLAResult|undefined=device.runtime.features.ipSla?.[id];
        if(previous)Object.assign(previous,{pending:false,success:false,rtt:undefined,returnCode:'Not started'});
        (device.runtime.features.ipSlaScheduleState ??= {})[id] = state;
        if (slaStart(schedule) !== 'pending') {
          state.startsAt = now + (slaStart(schedule) === 'after' ? (schedule.after ?? 0) * 1000 : 0);
          const life = slaLife(schedule);
          if (life) state.expiresAt = state.startsAt + life * 1000;
          state.nextRun = state.startsAt;
          const run = () => {
            if (!this.current(key, operation) || state.expiresAt !== undefined && operation.clock.now() >= state.expiresAt) return;
            state.status = 'active';
            state.nextRun = operation.clock.now() + (probe.frequency ?? 60) * 1000;
            this.run(id, probe, operation, () => this.current(key, operation) && state.status === 'active');
          };
          operation.clock.schedule(state.startsAt - now, run, { owner, repeat: (probe.frequency ?? 60) * 1000, label: `IP SLA ${id}` });
          if (state.expiresAt !== undefined) operation.clock.schedule(state.expiresAt - now, () => {
            if (!this.current(key, operation)) return;
            state.status = 'expired'; delete state.nextRun;
            operation.clock.cancelOwner(owner); this.cancelResult(id, operation);
            this.engine.recompute(); this.engine.notify();
          }, { owner, label: `IP SLA ${id} lifetime` });
        }
        changed = true;
      }
    }
    for (const [key, operation] of this.operations) if (!wanted.has(key)) {
      this.stop(key, key.slice(key.lastIndexOf('|') + 1), operation); changed = true;
    }
    return changed;
  }
  private current(key: string, operation: ScheduledOperation): boolean {
    return this.operations.get(key) === operation && operation.device.runtime === operation.runtime && operation.device.powered && !iosBooting(operation.device) && operation.clock === this.engine.clock;
  }
  private cancelResult(id: string, operation: ScheduledOperation): void {
    const result: SLAResult | undefined = operation.runtime.features.ipSla?.[id];
    if (result?.pending) Object.assign(result, { pending: false, success: false, rtt: undefined, returnCode: 'Cancelled' });
  }
  private stop(key: string, id: string, operation: ScheduledOperation): void {
    operation.clock.cancelOwner(operation.owner); this.cancelResult(id, operation);
    delete operation.runtime.features.ipSlaScheduleState?.[id];
    this.operations.delete(key);
  }
  private listen(port: number): void {
    if (this.ports.has(port)) return;
    this.ports.add(port);
    this.engine.registerUDPService(port, d => !!d.config.features.ipSlaResponder?.ports?.some((x: { port: number }) => x.port === port) || Object.entries<number>(d.runtime.features.slaResponderWindows ?? {}).some(([key, expires]) => key.endsWith(':' + port) && expires > this.engine.clock.now()), (d, p, source) => {
      const configured = d.config.features.ipSlaResponder?.ports?.some((x: { port: number; address?: string }) => x.port === port && (!x.address || x.address === p?.target));
      const temporary = d.runtime.features.slaResponderWindows?.[`${source}:${port}`] > this.engine.clock.now();
      if (p?.application !== 'sla-echo' || !configured && !temporary) return { accepted: false };
      (d.runtime.features.slaResponderCounters ??= {})[port] = (d.runtime.features.slaResponderCounters?.[port] ?? 0) + 1;
      return { accepted: true, sequence: p.sequence };
    });
  }
  private run(id: string, probe: SLAOperation, operation: ScheduledOperation, active: () => boolean): void {
    const engine = this.engine, { device, runtime, owner, clock } = operation;
    const previous: SLAResult | undefined = runtime.features.ipSla?.[id];
    if (previous?.pending || !probe.target) return;
    const started = clock.now(), timeout = probe.timeout ?? 5000;
    const state: SLAResult = { lastRun: started, success: previous?.success ?? false, rtt: previous?.rtt, returnCode: previous?.returnCode ?? 'Pending', pending: true, runs: (previous?.runs ?? 0) + 1, successes: previous?.successes ?? 0, failures: previous?.failures ?? 0 };
    (runtime.features.ipSla ??= {})[id] = state;
    let finished = false;
    const finish = (times: number[], sent: number, error = 'Timeout') => {
      if (finished || !active() || runtime.features.ipSla?.[id] !== state) return;
      finished = true;
      const rtt = times.length ? times.reduce((a, b) => a + b, 0) / times.length : undefined;
      Object.assign(state, { pending: false, success: times.length > 0, rtt, packetsSent: sent, packetsReceived: times.length, returnCode: times.length ? rtt! > (probe.threshold ?? 5000) ? 'Over threshold' : 'OK' : error });
      if (times.length) state.successes++; else state.failures++;
      if (probe.type === 'udp-jitter') state.jitter = times.length > 1 ? times.slice(1).reduce((sum, time, i) => sum + Math.abs(time - times[i]), 0) / (times.length - 1) : 0;
      engine.recompute(); engine.notify();
    };
    const watch = (result: ServiceResult, deadline: number, callback: (result: ServiceResult) => void) => {
      const poll = () => {
        if (!active() || finished) return;
        if (result.status !== 'running' || clock.now() >= deadline) callback(result);
        else clock.schedule(Math.min(10, deadline - clock.now()), poll, { owner, label: `IP SLA ${id} response` });
      };
      poll();
    };
    const source = engine.serviceSource(device, probe.target, { source: probe.source });
    if (source === undefined) { finish([], 0, 'Source unavailable'); return; }
    if (probe.type === 'http') {
      const result = engine.httpRequest(device.id, probe.url!, { source, timeout });
      watch(result, started + timeout, r => finish(r.status === 'success' ? [clock.now() - started] : [], 1, r.status === 'failure' ? r.error : undefined));
      return;
    }
    if (probe.type === 'udp-jitter') {
      const count = probe.numPackets ?? 10, interval = probe.interval ?? 20, times: number[] = [];
      let complete = 0, sent = 0;
      const train = () => {
        for (let i = 0; i < count; i++) clock.schedule(i * interval, () => {
          if (finished || !active()) return;
          const time = clock.now(); sent++;
          const result = engine.udpRequest(device.id, probe.target!, probe.port!, { application: 'sla-echo', sequence: i, target: probe.target }, { source, timeout, sourcePort: probe.sourcePort });
          watch(result, time + timeout, r => {
            if (r.status === 'success' && r.accepted && r.sequence === i) times.push(clock.now() - time);
            if (++complete === count) finish(times, sent);
          });
        }, { owner, label: `IP SLA ${id} UDP probe` });
      };
      if (probe.control === false) train();
      else {
        const control = engine.udpRequest(device.id, probe.target, 1967, { application: 'sla-control', port: probe.port, duration: timeout + count * interval + 1000 }, { source, timeout });
        watch(control, started + timeout, r => { if (r.status === 'success' && r.accepted) train(); else finish([], 0, 'Responder unavailable'); });
      }
      return;
    }
    const result = engine.ping(device.id, probe.target, { count: 1, source: source || undefined, timeout, size: probe.target.includes(':') ? 84 : 64 });
    const poll = () => {
      if (!active() || finished) return;
      if (result.status !== 'running' || clock.now() >= started + timeout) finish(result.replies.filter(x => !x.error).map(x => x.time ?? 0), result.sent);
      else clock.schedule(Math.min(10, started + timeout - clock.now()), poll, { owner, label: `IP SLA ${id} echo result` });
    };
    poll();
  }
}
