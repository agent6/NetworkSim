import metadata from '../package.json' with { type: 'json' };
import type { DeviceKind } from './model.ts';

export const NETSIM_VERSION = metadata.version;
export const NETSIM_HARDWARE_REVISION = '1.0';
export const NETSIM_HARDWARE_VID = 'V01';
export const NETSIM_NVRAM_KIB = 256;

interface PlatformIdentity {
  readonly model: string;
  readonly description: string;
  readonly software: string;
  readonly processorKiB: number;
  readonly ioKiB: number;
}

const platforms: Readonly<Record<DeviceKind, PlatformIdentity>> = {
  router: { model: 'NS-R4', description: '4-port Gigabit Ethernet router', software: 'Routing', processorKiB: 448 * 1024, ioKiB: 64 * 1024 },
  switch: { model: 'NS-S24-2G', description: '24-port Layer 2 switch with 2 Gigabit uplinks', software: 'Switching', processorKiB: 448 * 1024, ioKiB: 64 * 1024 },
  poeswitch: { model: 'NS-S24P-2G', description: '24-port PoE switch with 2 Gigabit uplinks', software: 'PoE Switching', processorKiB: 448 * 1024, ioKiB: 64 * 1024 },
  l3switch: { model: 'NS-L3S24-2G', description: '24-port multilayer switch with 2 Gigabit uplinks', software: 'Multilayer Switching', processorKiB: 960 * 1024, ioKiB: 64 * 1024 },
  datacenter: { model: 'NS-DC24-6Q', description: 'Datacenter Switch, 24 Ethernet access ports and 6 Ethernet uplinks', software: 'NS-OS', processorKiB: 4096 * 1024, ioKiB: 512 * 1024 },
  wlc: { model: 'NS-WLC1', description: 'Wireless LAN controller', software: 'Wireless Controller', processorKiB: 1984 * 1024, ioKiB: 64 * 1024 },
  ap: { model: 'NS-AP2', description: 'Dual-band wireless access point', software: 'Access Point', processorKiB: 224 * 1024, ioKiB: 32 * 1024 },
  pc: { model: 'NS-PC1', description: 'Desktop endpoint', software: 'Endpoint', processorKiB: 448 * 1024, ioKiB: 64 * 1024 },
  server: { model: 'NS-SRV1', description: 'Lab services server', software: 'Services', processorKiB: 960 * 1024, ioKiB: 64 * 1024 },
  laptop: { model: 'NS-LT1', description: 'Wireless laptop endpoint', software: 'Endpoint', processorKiB: 448 * 1024, ioKiB: 64 * 1024 },
  phone: { model: 'NS-PH2', description: 'VoIP phone with PC passthrough', software: 'Phone', processorKiB: 224 * 1024, ioKiB: 32 * 1024 },
};

export const platformIdentity = (kind: DeviceKind): PlatformIdentity => platforms[kind];
export const platformSoftware = (kind: DeviceKind): string => {
  const profile = platformIdentity(kind);
  if (kind === 'datacenter') return `NetSim NS-OS Software (${profile.model}), Version ${NETSIM_VERSION}`;
  return `NetSim OS Software, ${profile.software} Software (${profile.model}), Version ${NETSIM_VERSION}`;
};
// Images are embedded application profiles, not files in the writable simulated flash.
export const platformImage = (kind: DeviceKind): string => `embedded:netsim-${kind}-${NETSIM_VERSION}`;
