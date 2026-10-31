import type {Simulator} from './engine.ts';import type {Device} from './model.ts';
export interface DeviceAccessEvent {time:number;session:string;kind:'login'|'enable'|'disable'|'logout'|'command-denied'|'access-denied'|'idle-timeout'|'close';success:boolean;line:string;source:string;port?:number;username?:string;privilege?:number;previousPrivilege?:number;method?:string;enableSource?:string;legacyMatched?:boolean;reason?:string;loginMode?:string;transport?:string;idleSeconds?:number;accessClass?:string;aaa:boolean}
const sequence=new WeakMap<Simulator,number>();
export function consoleAccessId(s:Simulator):string{const n=(sequence.get(s)??0)+1;sequence.set(s,n);return 'console-'+n;}
/** Credential-free observations over actual CLI/VTY transitions, scoped to the current runtime. */
export function recordDeviceAccess(s:Simulator,d:Device,event:Omit<DeviceAccessEvent,'time'|'aaa'>):void{const line=d.config.features.lines?.[event.line]??{},rows:DeviceAccessEvent[]=d.runtime.features.deviceAccess??=[];rows.push({time:s.clock.now(),loginMode:line.login,transport:line.transport,idleSeconds:line.execTimeout??600,accessClass:line.accessClassIn,...event,aaa:!!d.config.features.aaa?.enabled});if(rows.length>256)rows.shift();}
export function deviceAccessSnapshot(s:Simulator,id:string):DeviceAccessEvent[]{return structuredClone(s.getDevice(id)?.runtime.features.deviceAccess??[]);}
