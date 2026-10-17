import {mediumState,type LinkMedium} from './link-medium.ts';
import type { Device, InterfaceConfig } from './model.ts';

export interface EthernetState {
  carrier: boolean;
  speed: number;
  duplex: 'half' | 'full';
  peerDuplex: 'half' | 'full';
  speedAuto: boolean;
  duplexAuto: boolean;
  mismatch: boolean;
  reason?: string;
  medium?:string;length?:number;propagation?:number;bitErrorRate?:number;
}

/** Legacy projects used 1000 for both the default and explicit speed 1000. */
export function speedIsAuto(port: InterfaceConfig): boolean {
  return port.features.speedAuto ?? port.speed === 1000;
}
export function ethernetSpeeds(port: InterfaceConfig): number[] {
  return /^TenGigabitEthernet/i.test(port.name) ? [10000] : /^FastEthernet/i.test(port.name) ? [10, 100] : [10, 100, 1000];
}
export function interfaceSpeed(device: Device, port: InterfaceConfig): number {
  if (/^Port-channel/i.test(port.name)) {
    const group = port.name.replace(/^Port-channel/i, ''), members: string[] | undefined = device.runtime.features.portChannels?.[group]?.activeMembers;
    if (members?.length) return members.reduce((sum, name) => sum + interfaceSpeed(device, device.config.interfaces[name]), 0);
  }
  return device.runtime.features.ethernet?.[port.name.split('.')[0]]?.speed ?? port.speed;
}
export function interfaceBandwidth(device: Device, port: InterfaceConfig): number { return Number(port.features.bandwidth ?? interfaceSpeed(device, port) * 1000); }
export function interfaceDuplex(device: Device, port: InterfaceConfig): InterfaceConfig['duplex'] { return device.runtime.features.ethernet?.[port.name.split('.')[0]]?.duplex ?? port.duplex; }

/** Bounded twisted-pair negotiation. No FLP, master/slave or PHY signal encoding. */
export function negotiateEthernet(local: InterfaceConfig, peer: InterfaceConfig, medium?:LinkMedium): EthernetState {
  const speedAuto = speedIsAuto(local), peerAuto = speedIsAuto(peer);
  const available = (p: InterfaceConfig, auto: boolean) => ethernetSpeeds(p).filter(n => (!auto ? n === p.speed : true) && (p.duplex !== 'half' || n <= 100));
  const left = available(local, speedAuto), right = available(peer, peerAuto);
  const common = left.filter(n => right.includes(n)), speed = Math.max(0, ...common);
  const duplex = (p: InterfaceConfig, other: InterfaceConfig, auto: boolean, otherAuto: boolean): 'half' | 'full' => {
    if (speed >= 1000) return 'full';
    if (p.duplex !== 'auto') return p.duplex;
    // Parallel detection discovers 10/100 speed, not the fixed peer's duplex.
    if (!auto || !otherAuto) return 'half';
    return other.duplex === 'half' ? 'half' : 'full';
  };
  const own = duplex(local, peer, speedAuto, peerAuto), remote = duplex(peer, local, peerAuto, speedAuto);
  const physical=mediumState(medium,speed,local.features.mediaType,peer.features.mediaType);
  return { ...physical,carrier: speed > 0&&physical.carrier, speed: speed || local.speed, duplex: own, peerDuplex: remote, speedAuto, duplexAuto: local.duplex === 'auto', mismatch: speed > 0 && own !== remote, ...(!speed ? { reason: 'No common Ethernet speed or duplex capability' } : {}) };
}
