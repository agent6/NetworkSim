import type { Device, DeviceConfig } from './model.ts';
import { isIPv4, isIPv6 } from './ip.ts';

export interface SLAOperation {
  type?: 'icmp-echo' | 'http' | 'udp-jitter';
  target?: string;
  source?: string;
  url?: string;
  port?: number;
  sourcePort?: number;
  numPackets?: number;
  interval?: number;
  control?: boolean;
  frequency?: number;
  timeout?: number;
  threshold?: number;
}
export interface SLASchedule { start?: 'now' | 'pending' | 'after'; life?: number; after?: number }
export interface SLAScheduleState { status: 'pending' | 'active' | 'expired'; startsAt?: number; expiresAt?: number; nextRun?: number }
export interface SLAResult {
  lastRun: number;
  success: boolean;
  pending: boolean;
  returnCode: string;
  rtt?: number;
  jitter?: number;
  packetsSent?: number;
  packetsReceived?: number;
  runs: number;
  successes: number;
  failures: number;
}
export const slaDefaults = { frequency: 60, timeout: 5000, threshold: 5000 };
export const slaReservedPorts = new Set([53, 67, 68, 123, 161, 162, 514, 1812, 1813, 1967]);
export const slaStart = (schedule: SLASchedule) => schedule.start ?? 'now';
export const slaLife = (schedule: SLASchedule) => schedule.life ?? 3600;
export function slaStartText(schedule: SLASchedule): string {
  if (slaStart(schedule) !== 'after') return slaStart(schedule);
  const seconds = schedule.after ?? 0;
  return 'after ' + [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function slaTrackUp(device: Device, operation: string | number, aspect = 'reachability'): boolean {
  if (!device.config.features.ipSla?.[operation]?.target || !device.config.features.ipSlaSchedules?.[operation]) return false;
  const schedule: SLAScheduleState | undefined = device.runtime.features.ipSlaScheduleState?.[operation];
  const result: SLAResult | undefined = device.runtime.features.ipSla?.[operation];
  return schedule?.status === 'active' && (result?.returnCode === 'OK' || aspect === 'reachability' && result?.returnCode === 'Over threshold');
}

export function validateSLAConfiguration(config: DeviceConfig): void {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value: unknown, min: number, max: number): boolean => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  const address = (value: unknown): value is string => typeof value === 'string' && (isIPv4(value) || isIPv6(value));
  const table = (name: string): Record<string, unknown> => {
    const value: unknown = config.features[name];
    if (value === undefined) return {};
    if (!record(value) || Object.keys(value).length > 2000 || Object.keys(value).some(id => String(Number(id)) !== id || !integer(Number(id), 1, 2147483647))) throw Error(`Invalid IP SLA ${name === 'ipSla' ? 'operation' : 'schedule'} table.`);
    return value;
  };
  const operations = table('ipSla');
  for (const [id, probe] of Object.entries(operations)) {
    if (!record(probe) || probe.type !== undefined && (typeof probe.type !== 'string' || !['icmp-echo', 'http', 'udp-jitter'].includes(probe.type)) || probe.target !== undefined && probe.type === undefined) throw Error(`Invalid IP SLA ${id} operation.`);
    for (const [key, min, max] of [['frequency', 1, 604800], ['timeout', 1, 604800000], ['threshold', 1, 604800000], ['port', 1, 65535], ['sourcePort', 1, 65535], ['numPackets', 1, 100], ['interval', 1, 60000]] as const) {
      if (probe[key] !== undefined && !integer(probe[key], min, max)) throw Error(`Invalid IP SLA ${id} ${key}.`);
    }
    if (probe.source !== undefined && (typeof probe.source !== 'string' || !address(probe.source) && !/^[a-z][a-z-]*\d[\d/.]*$/i.test(probe.source))) throw Error(`Invalid IP SLA ${id} source.`);
    if (probe.control !== undefined && typeof probe.control !== 'boolean') throw Error(`Invalid IP SLA ${id} responder control.`);
    if (probe.target !== undefined) {
      if (probe.type === 'http') {
        let url: URL;
        try { url = new URL(String(probe.url)); } catch { throw Error(`Invalid IP SLA ${id} HTTP URL.`); }
        if (url.protocol !== 'http:' || url.port && url.port !== '80' || url.hostname !== probe.target) throw Error(`Invalid IP SLA ${id} HTTP target.`);
      } else if (!address(probe.target) || probe.type === 'udp-jitter' && (!isIPv4(probe.target) || !integer(probe.port, 1, 65535))) throw Error(`Invalid IP SLA ${id} target.`);
    }
  }
  for (const [id, schedule] of Object.entries(table('ipSlaSchedules'))) {
    const probe = operations[id];
    if (!record(schedule) || !record(probe) || !probe.target || schedule.start !== undefined && (typeof schedule.start !== 'string' || !['now', 'pending', 'after'].includes(schedule.start)) || schedule.life !== undefined && !integer(schedule.life, 0, 2147483647) || schedule.start === 'after' && !integer(schedule.after, 0, 86399)) throw Error(`Invalid IP SLA ${id} schedule.`);
  }
  for (const track of Object.values(config.features.tracks ?? {})) {
    if (record(track) && track.type === 'sla' && (!integer(track.sla, 1, 2147483647) || track.aspect !== undefined && (typeof track.aspect !== 'string' || !['state', 'reachability'].includes(track.aspect)))) throw Error('Invalid IP SLA tracked object.');
  }
  const responder:unknown=config.features.ipSlaResponder;
  if(responder!==undefined){
    if(!record(responder)||typeof responder.enabled!=='boolean'||!Array.isArray(responder.ports)||responder.ports.length>2000)throw Error('Invalid IP SLA responder.');
    for(const port of responder.ports)if(!record(port)||!integer(port.port,1,65535)||slaReservedPorts.has(Number(port.port))||port.address!==undefined&&!address(port.address))throw Error('Invalid IP SLA responder port.');
  }
}
