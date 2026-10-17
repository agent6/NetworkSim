import {stpPortName,stpMemberActive} from './stp-ports.ts';
import type { Simulator } from './engine.ts';
import type { Device, Link } from './model.ts';

export type PortIndicatorState = 'up' | 'down' | 'off' | 'blocked' | 'transitioning' | 'partial';
export interface PortIndicator {
  state: PortIndicatorState;
  description: string;
}

/** Physical carrier and VLAN forwarding are separate states on a switch port. */
export function portIndicator(sim: Simulator, device: Device, port: string, link: Link): PortIndicator {
  const config = device.config.interfaces[port];
  if (!link.enabled) return { state: 'off', description: 'Cable disabled' };
  if (!device.powered) return { state: 'off', description: 'Device powered off' };
  if (!config?.adminUp) return { state: 'down', description: 'Interface administratively down' };
  if (config.features.errDisabled) return { state: 'down', description: 'Interface error-disabled' };
  if (!sim.interfaceUp(device.id, port)) return { state: 'down', description: 'Physical link down' };
  if (!config.switchport) return { state: 'up', description: 'Link up' };

  if (!stpMemberActive(device,port)) return {state:'blocked',description:'EtherChannel member is not forwarding'};
  const stpPort=stpPortName(device,port);
  const trees = Object.entries(device.runtime.stp)
    .filter(([vlan, tree]) => tree.ports[stpPort] && sim.carriesVlan(device, port, Number(vlan)));
  const blocked = trees.filter(([, tree]) => ['blocking', 'discarding', 'disabled'].includes(tree.ports[stpPort].state));
  const transitioning = trees.filter(([, tree]) => ['listening', 'learning'].includes(tree.ports[stpPort].state));
  const forwarding = trees.filter(([, tree]) => tree.ports[stpPort].state === 'forwarding');
  const vlans = (rows: typeof trees) => rows.map(([vlan]) => vlan).join(', ');
  if (blocked.length) return {
    state: forwarding.length ? 'partial' : 'blocked',
    description: `STP blocking VLAN ${vlans(blocked)}${forwarding.length ? `; forwarding VLAN ${vlans(forwarding)}` : ''}`,
  };
  if (transitioning.length) return { state: 'transitioning', description: `STP converging in VLAN ${vlans(transitioning)}` };
  return { state: 'up', description: 'Link up; STP forwarding' };
}

interface Activity {
  runtime: Device['runtime'];
  tx: number;
  rx: number;
  txUntil: number;
  rxUntil: number;
}

/** Read actual port counters; never generate traffic or alter simulation state. */
export class LinkActivity {
  private ports = new Map<string, Activity>();
  sample(device: Device, port: string, now: number): { tx: boolean; rx: boolean } {
    const key = `${device.id}|${port}`, counters = device.runtime.counters[port];
    const tx = counters?.tx ?? 0, rx = counters?.rx ?? 0;
    let previous = this.ports.get(key);
    if (!previous || previous.runtime !== device.runtime || tx < previous.tx || rx < previous.rx) {
      previous = { runtime: device.runtime, tx, rx, txUntil: 0, rxUntil: 0 };
      this.ports.set(key, previous);
    } else {
      if (tx > previous.tx) previous.txUntil = now + 350;
      if (rx > previous.rx) previous.rxUntil = now + 350;
      previous.tx = tx;
      previous.rx = rx;
    }
    if (previous.txUntil <= now) previous.txUntil = 0;
    if (previous.rxUntil <= now) previous.rxUntil = 0;
    return { tx: now < previous.txUntil, rx: now < previous.rxUntil };
  }
  needsPaint(): boolean {
    return [...this.ports.values()].some(port => port.txUntil > 0 || port.rxUntil > 0);
  }
  retain(keys: Set<string>): void {
    for (const key of this.ports.keys()) if (!keys.has(key)) this.ports.delete(key);
  }
}
