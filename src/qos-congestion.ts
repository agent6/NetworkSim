import type {IPPacket} from './engine.ts';

export interface WredCurve {min:number;max:number;denominator:number}
export interface WredConfig {mode:'precedence'|'dscp';exponent?:number;ecn?:boolean;curves?:Record<string,WredCurve>}
export function wredConfiguration(value:any):WredConfig|undefined{return value===true?{mode:'precedence'}:value||undefined;}
export function wredError(value:any,limit=64):string|undefined{
 const c=wredConfiguration(value);if(!c)return;if(!['precedence','dscp'].includes(c.mode)||Object.keys(c).some(k=>!['mode','exponent','ecn','curves'].includes(k)))return 'Unsupported random-detect configuration.';
 if(limit<2)return 'WRED requires a queue-limit of at least two packets.';
 if(c.exponent!==undefined&&(!Number.isInteger(c.exponent)||c.exponent<1||c.exponent>16))return 'The WRED exponential weighting constant must be 1 to 16.';
 if(c.ecn!==undefined&&typeof c.ecn!=='boolean')return 'Invalid WRED ECN setting.';
 if(c.curves!==undefined&&(!c.curves||Array.isArray(c.curves)||typeof c.curves!=='object'))return 'Invalid WRED curves.';
 for(const[key,curve]of Object.entries(c.curves??{})){if(!/^\d+$/.test(key)||String(+key)!==key||+key>(c.mode==='dscp'?63:7)||!curve||!Number.isInteger(curve.min)||!Number.isInteger(curve.max)||curve.min<1||curve.max<curve.min||curve.max>=limit||!Number.isInteger(curve.denominator)||curve.denominator<1||curve.denominator>65536||Object.keys(curve).some(k=>!['min','max','denominator'].includes(k)))return 'WRED packet thresholds require 1 <= minimum <= maximum < queue-limit and a probability denominator of 1 to 65536.';}
}
/** Original QFP-style teaching defaults, not a calibrated hardware drop curve. */
export function wredCurve(config:WredConfig,key:number,limit:number):WredCurve{
 const explicit=config.curves?.[key];if(explicit)return explicit;
 const precedence=config.mode==='dscp'?key>>3:key,af=config.mode==='dscp'&&key>=10&&key<=38&&[2,4,6].includes(key&7)?(key&7)/2:1;
 const max=Math.max(1,Math.floor(limit*(.5-(af-1)/32))),min=Math.max(1,Math.min(max,Math.floor(limit*(.25+precedence/32-(af-1)/32))));return{min,max,denominator:10};
}
/** Fixed 16 queues per class; collisions deliberately share FIFO service. */
export function qosFlowBucket(packet?:IPPacket):number{
 if(!packet)return 0;const text=[packet.source,packet.destination,packet.protocol,packet.sourcePort??'',packet.destinationPort??''].join('|');let hash=2166136261;for(let n=0;n<text.length;n++){hash^=text.charCodeAt(n);hash=Math.imul(hash,16777619);}return(hash>>>0)%16;
}
export function renderWred(value:any):string[]{const c=wredConfiguration(value);if(!c)return[];if(wredError(c,4096))return['random-detect unsupported'];return['random-detect'+(c.mode==='dscp'?' dscp-based':''),...(c.exponent!==undefined?['random-detect exponential-weighting-constant '+c.exponent]:[]),...(c.ecn?['random-detect ecn']:[]),...Object.entries(c.curves??{}).sort(([a],[b])=>+a-+b).map(([key,v])=>`random-detect ${c.mode} ${key} ${v.min} ${v.max} ${v.denominator}`)];}
