import type {Device} from './model.ts';

export interface IOSBootState {
  phase:'restarting'|'bootstrap'|'loading'|'initializing'|'configuration'|'ready';
  startedAt:number;
  readyAt:number;
  reason:string;
  lines:string[];
}
export const IOS_BOOT_DURATION=6500;
export function iosBootState(device:Device):IOSBootState|undefined{return device.runtime.features.iosBoot;}
export function iosBooting(device:Device):boolean{const boot=iosBootState(device);return !!boot&&boot.phase!=='ready';}
/** Original shortened boot transcript; no firmware, ROMMON or image verification runs. */
export function iosBootStages(device:Device):Array<{after:number;phase:IOSBootState['phase'];lines:string[]}> {
  const type=device.kind==='router'?'Router':device.kind==='wlc'?'WLC':device.kind==='ap'?'Access point':'Switch';
  const ignored=!!((device.configurationRegister?.current??0x2102)&0x40);
  return [
    {after:600,phase:'bootstrap',lines:['',`${type} ${device.kind==='router'?'System Bootstrap':'Boot Loader'}, NetworkSim`,'Initializing platform hardware...']},
    {after:1800,phase:'loading',lines:['Loading "flash:packages.conf"...','Image loading: ####################']},
    {after:3200,phase:'initializing',lines:['Image load complete.','Initializing interfaces and system services...']},
    {after:4800,phase:'configuration',lines:[ignored?`Startup configuration ignored (configuration register 0x${device.configurationRegister!.current.toString(16)}).`:device.startupConfig?'Loading configuration from nvram:startup-config...':'No startup configuration found. Loading factory defaults.']},
    {after:IOS_BOOT_DURATION,phase:'ready',lines:['','%SYS-5-RESTART: System restarted',`${device.config.hostname} con0 is now available`,'','Press RETURN to get started!']},
  ];
}
