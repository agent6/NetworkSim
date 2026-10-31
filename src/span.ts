import type {Device,PacketSummary} from './model.ts';

export interface SpanCopy {sourceDevice:string;session:string;sourceInterface:string;direction:'rx'|'tx';configuredDirection:'rx'|'tx'|'both';sourceFrame:string;rspan?:{vlan:number;destinationDevice?:string;destinationSession?:string};erspan?:{id:number;sequence:number;origin:string;destination:string;packetId?:string;ttl?:number;destinationDevice?:string;destinationSession?:string}}
/** A configured, enabled monitor destination is dedicated to analyzer traffic. */
export function spanDestination(d:Device,port:string):boolean{return Object.values<any>(d.config.features.spanSessions??{}).some(s=>!s.shutdown&&s.destination===port);}
export type CapturedFrame=PacketSummary & {time:number;port:string;frameId:string;span?:SpanCopy};
export function spanCaptureRows(d:Device,filter=''):CapturedFrame[]{const q=filter.trim().toLowerCase();return (d.runtime.features.capturedFrames??[]).filter((r:CapturedFrame)=>!q||[r.protocol,r.source,r.destination,r.sourcePort,r.destinationPort,r.port,r.span?.sourceInterface,r.span?.direction,r.span?.session,r.span?.rspan?.vlan,r.span?.rspan?.destinationSession,r.span?.erspan?.id,r.span?.erspan?.origin,r.span?.erspan?.destination,r.span?.erspan?.destinationSession].some(v=>String(v??'').toLowerCase().includes(q)));}
