import type { Device, DeviceConfig, InterfaceConfig } from './model.ts';
import { isIPv4 } from './ip.ts';

export interface TunnelProtection {
  profile: string;
  tunnel: string;
  local: string;
  peer: string;
  key?: number;
  vrf?: string;
}

export function tunnelNbma(device: Device, iface: InterfaceConfig): string | undefined {
  const source = iface.features.tunnelSource;
  return isIPv4(source ?? '') ? source : device.config.interfaces[source]?.ip;
}

export function tunnelMatches(device: Device, iface: InterfaceConfig, local: string, peer: string, key: number | undefined, vrf?: string): boolean {
  return tunnelNbma(device, iface) === local && iface.features.tunnelKey === key &&
    (iface.features.tunnelVrf ?? '') === (vrf ?? '') &&
    (iface.features.tunnelMode === 'gre multipoint' || iface.features.tunnelDestination === peer);
}

export function tunnelSignature(device: Device, port: string): string {
  const iface = device.config.interfaces[port];
  if (!iface) return '';
  const profile = device.config.features.crypto?.profiles?.[iface.features.tunnelProtection];
  return JSON.stringify([iface.adminUp, iface.ip, iface.mask, iface.vrf, tunnelNbma(device, iface),
    iface.features.tunnelSource, iface.features.tunnelMode, iface.features.tunnelDestination,
    iface.features.tunnelKey, iface.features.tunnelVrf, iface.features.tunnelProtection,
    profile, device.config.features.crypto?.transformSets?.[profile?.transformSet]]);
}

export function validateTunnelConfiguration(config: DeviceConfig): void {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 1024;
  const ip = (v: unknown): v is string => typeof v === 'string' && isIPv4(v);
  const array = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 1024;
  function error(field: string): never { throw Error('Invalid GRE/NHRP/IPsec configuration: ' + field); }
  for (const [port, iface] of Object.entries(config.interfaces)) {
    if (!iface || !object(iface.features)) continue;
    const f = iface.features, n: unknown = f.nhrp;
    for (const field of ['tunnelSource', 'tunnelDestination', 'tunnelProtection', 'tunnelVrf']) if (f[field] !== undefined && !text(f[field])) error(port + ' ' + field);
    if (f.tunnelDestination !== undefined && (typeof f.tunnelDestination !== 'string' || !isIPv4(f.tunnelDestination))) error(port + ' destination');
    if (f.tunnelKey !== undefined && !integer(f.tunnelKey, 0, 4294967295)) error(port + ' key');
    if (n === undefined) continue;
    if (!object(n)) error(port + ' NHRP');
    for (const [field, max] of [['networkId', 4294967295], ['holdtime', 65535], ['registrationTimeout', 65535]] as const)
      if (n[field] !== undefined && !integer(n[field], 1, max)) error(port + ' ' + field);
    if (n.authentication !== undefined && typeof n.authentication !== 'string') error(port + ' authentication');
    for (const field of ['shortcut', 'redirect']) if (n[field] !== undefined && typeof n[field] !== 'boolean') error(port + ' ' + field);
    if (n.nhs !== undefined && (!array(n.nhs) || n.nhs.some(v => typeof v === 'string' ? !ip(v) : !object(v) || !ip(v.address) || v.nbma !== undefined && !ip(v.nbma)))) error(port + ' NHS');
    if (n.maps !== undefined && (!array(n.maps) || n.maps.some(v => !object(v) || !ip(v.address ?? v.protocolAddress) || !ip(v.nbma)))) error(port + ' mapping');
    if (n.multicast !== undefined && n.multicast !== 'dynamic' && (!array(n.multicast) || n.multicast.some(v => typeof v !== 'string' || !isIPv4(v)))) error(port + ' multicast');
  }
  const crypto: unknown = config.features.crypto;
  if (crypto === undefined) return;
  if (!object(crypto)) error('crypto');
  for (const field of ['isakmpPolicies', 'isakmpKeys']) if (crypto[field] !== undefined && (!array(crypto[field]) || crypto[field].some(v => !object(v)))) error(field);
  for (const field of ['profiles', 'maps', 'transformSets']) if (crypto[field] !== undefined && !object(crypto[field])) error(field);
  for (const [name, profile] of Object.entries(crypto.profiles ?? {})) {
    if (!object(profile)) error('profile ' + name);
    if (profile.transformSet !== undefined && !text(profile.transformSet)) error('transform set ' + name);
    if (profile.pfs !== undefined && !integer(profile.pfs, 1, 24)) error('PFS ' + name);
    if (profile.lifetime !== undefined && !integer(profile.lifetime, 1, 86400)) error('lifetime ' + name);
  }
  for (const [name, transform] of Object.entries(crypto.transformSets ?? {})) if (!object(transform) ||
    transform.keyLength !== undefined && (typeof transform.keyLength !== 'number' || ![128, 192, 256].includes(transform.keyLength)) ||
    transform.mode !== undefined && transform.mode !== 'tunnel' && transform.mode !== 'transport' ||
    transform.encryption !== undefined && !text(transform.encryption) || transform.integrity !== undefined && !text(transform.integrity)) error('transform ' + name);
  for (const [name, rules] of Object.entries(crypto.maps ?? {})) if (!array(rules) || rules.some(v => !object(v) || v.transformSets !== undefined && (!array(v.transformSets) || v.transformSets.some(n => !text(n))))) error('map ' + name);
  if (array(crypto.isakmpKeys)) for (const key of crypto.isakmpKeys) if (!object(key) || !text(key.key) || !ip(key.peer)) error('IKE key');
}
