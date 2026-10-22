import type {Simulator} from './engine.ts';
import {IOSSession} from './cli.ts';
import {NSOSSession} from './nsos.ts';

/** All console and network-management entry points choose the device's dialect. */
export function createCLISession(engine:Simulator,deviceId:string,options:{skipConsoleLogin?:boolean}={}):IOSSession|NSOSSession {
  return engine.getDevice(deviceId)?.kind==='datacenter'?new NSOSSession(engine,deviceId,options):new IOSSession(engine,deviceId,options);
}
export type CLISession=ReturnType<typeof createCLISession>;
