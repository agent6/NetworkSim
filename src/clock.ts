export interface TimerOptions { owner?: string; repeat?: number; label?: string }
export interface TimerHandle { id: number; at: number; owner?: string; repeat: number; label?: string; canceled: boolean; epoch: number; generation: number; callback: () => void }
export interface AdvanceResult { processed: number; time: number; target: number; targetReached: boolean; remaining: number; nextAt: number | null; budgetExhausted: boolean }

/** A bounded event clock. It never reads wall time or creates browser timers. */
export class SimulationClock {
  private time = 0;
  private sequence = 0;
  private epoch = 0;
  private queue: TimerHandle[] = [];
  private owners = new Map<string, number>();
  private state: number;
  readonly seed: number;
  constructor(seed = 0x24ca9e13) { this.seed = seed >>> 0 || 1; this.state = this.seed; }
  now(): number { return this.time; }
  random(): number {
    let n = this.state; n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    this.state = n >>> 0;
    return this.state / 4294967296;
  }
  schedule(delay: number, callback: () => void, options: TimerOptions = {}): TimerHandle {
    if (!Number.isFinite(delay) || delay < 0) throw new RangeError('Timer delay must be a finite nonnegative number');
    if (options.repeat !== undefined && (!Number.isFinite(options.repeat) || options.repeat <= 0)) throw new RangeError('Timer interval must be positive');
    const work: TimerHandle = { id: ++this.sequence, at: this.time + delay, owner: options.owner, repeat: options.repeat ?? 0, label: options.label, canceled: false, epoch: this.epoch, generation: this.owners.get(options.owner ?? '') ?? 0, callback };
    this.push(work); return work;
  }
  after(delay: number, callback: () => void, owner?: string): TimerHandle { return this.schedule(delay, callback, { owner }); }
  cancel(work?: TimerHandle | null): void { if (work) work.canceled = true; }
  cancelOwner(owner: string): void { this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1); }
  reset(): void { this.epoch++; this.queue = []; this.owners.clear(); this.time = 0; this.state = this.seed; this.sequence = 0; }
  pending(): number { return this.queue.filter(work => this.valid(work)).length; }
  next(): number | null { this.prune(); return this.queue[0]?.at ?? null; }
  advance(milliseconds: number, budget = 10000): AdvanceResult {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Advance duration must be finite and nonnegative');
    return this.run(this.time + milliseconds, budget);
  }
  step(): AdvanceResult { const at = this.next(); return this.run(at ?? this.time, 1); }
  private run(target: number, budget: number): AdvanceResult {
    if (!Number.isFinite(budget) || budget < 1) throw new RangeError('Event budget must be positive');
    budget = Math.floor(budget); let processed = 0; const epoch = this.epoch;
    this.prune();
    while (processed < budget && this.queue.length && this.queue[0].at <= target) {
      const work = this.pop()!;
      if (!this.valid(work)) continue;
      this.time = Math.max(this.time, work.at); processed++;
      work.callback();
      if (epoch !== this.epoch) break;
      if (work.repeat && this.valid(work)) { work.at += work.repeat; this.push(work); }
      this.prune();
    }
    this.prune();
    const due = !!this.queue.length && this.queue[0].at <= target;
    const targetReached = epoch === this.epoch && !due;
    if (targetReached) this.time = Math.max(this.time, target);
    return { processed, time: this.time, target, targetReached, remaining: this.pending(), nextAt: this.next(), budgetExhausted: processed >= budget && due };
  }
  private valid(work: TimerHandle): boolean { return !work.canceled && work.epoch === this.epoch && work.generation === (this.owners.get(work.owner ?? '') ?? 0); }
  private less(a: TimerHandle, b: TimerHandle): boolean { return a.at < b.at || (a.at === b.at && a.id < b.id); }
  private prune(): void { while (this.queue.length && !this.valid(this.queue[0])) this.pop(); }
  private push(work: TimerHandle): void {
    const q = this.queue; q.push(work); let i = q.length - 1;
    while (i > 0) { const p = (i - 1) >>> 1; if (!this.less(q[i], q[p])) break; [q[i], q[p]] = [q[p], q[i]]; i = p; }
  }
  private pop(): TimerHandle | undefined {
    const q = this.queue, first = q[0], last = q.pop();
    if (q.length && last) { q[0] = last; let i = 0; for (;;) { let n = i; const left = i * 2 + 1, right = left + 1; if (left < q.length && this.less(q[left], q[n])) n = left; if (right < q.length && this.less(q[right], q[n])) n = right; if (n === i) break; [q[i], q[n]] = [q[n], q[i]]; i = n; } }
    return first;
  }
}
export { SimulationClock as Clock };
