import type {Simulator} from './engine.ts';import type {Device,SimEvent} from './model.ts';import {spanDestination,type CapturedFrame} from './span.ts';
export const spanLabId=(name:string)=>'device-span-'+name.toLowerCase();
type Live='destination'|'source'|'ports'|'saved';type Observed='forward'|'control'|'rx'|'tx'|'both'|'arp'|'http'|'dns'|'duplicates'|'isolation'|'removed'|'recovery';
export type SpanCriterion={kind:'span-live';device:string;check:Live}|{kind:'span-observe';device:string;check:Observed};
export function validSpanCriterion(c:any):boolean{return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='span-live'?['destination','source','ports','saved'].includes(c.check):c.kind==='span-observe'&&['forward','control','rx','tx','both','arp','http','dns','duplicates','isolation','removed','recovery'].includes(c.check));}
const g=(n:number)=>'GigabitEthernet0/'+n,get=(s:Simulator,n:string)=>s.getDevice(spanLabId(n));
function live(s:Simulator,d:Device,c:Live):boolean{const session=d.config.features.spanSessions?.['1'];switch(c){
 case'destination':return session?.destination===g(4)&&!session.shutdown&&(!session.type||session.type==='local');
 case'source':return session?.sources?.length===1&&session.sources[0].interface===g(1)&&session.sources[0].direction==='both';
 case'ports':return d.config.vlans[10]?.active===true&&live(s,d,'destination')&&[1,2,3,4].every(n=>{const p=d.config.interfaces[g(n)];return p?.switchport&&p.mode==='access'&&p.vlan===10&&s.interfaceUp(d.id,g(n));})&&['PC1','SRV1','PC2','AN1'].every((n,i)=>{const p=get(s,n)?.config.interfaces.GigabitEthernet0;return p?.ip===['192.168.10.10','192.168.10.20','192.168.10.30','192.168.10.99'][i]&&p.mask==='255.255.255.0'&&p.features.dhcp!==true;})&&s.lab.links.every(l=>l.enabled);
 case'saved':return ['destination','source','ports'].every(c=>live(s,d,c as Live))&&Object.keys(d.config.features.spanSessions??{}).length===1&&!!d.startupConfig&&JSON.stringify(d.config)===JSON.stringify(d.startupConfig);
}}
/** Analyzer evidence requires an actual source observation, mirror transmission and matching cable delivery. */
function proven(s:Simulator,r:CapturedFrame,index:Map<string,SimEvent>):boolean{
 const sw=get(s,'SW1')!,a=get(s,'AN1')!,m=r.span;if(!m||m.sourceDevice!==sw.id||m.session!=='1'||r.port!=='GigabitEthernet0'||!r.mirrored||![g(1),g(2)].includes(m.sourceInterface))return false;
 const observation=index.get([sw.id,m.sourceInterface,m.direction==='rx'?'Frame received':'Frame sent',m.sourceFrame].join('|'));
 if(observation?.packet?.mirrored)return false;
 if(!observation||observation.packet!.protocol!==r.protocol||observation.packet!.source!==r.source||observation.packet!.destination!==r.destination)return false;
 const sent=index.get([sw.id,g(4),'Frame sent',r.frameId].join('|')),received=index.get([a.id,r.port,'Frame received',r.frameId].join('|'));
 return sent?.packet?.span?.sourceFrame===m.sourceFrame&&received?.time===r.time&&received.packet?.id===r.id&&received.packet.source===r.source&&received.packet.destination===r.destination;
}
function echoes(s:Simulator,source:string,after=-Infinity):SimEvent[]{const from=get(s,source)!,to=source==='PC1'?'192.168.10.20':'192.168.10.20';return s.events.filter(e=>e.nodeId===from.id&&e.label==='Echo reply received'&&e.disposition==='success'&&e.time>after&&e.packet?.source===to&&!!e.packet.parentId&&s.events.some(r=>r.nodeId===spanLabId('SW1')&&r.label==='Frame received'&&!!r.packet&&r.packet.id===e.packet!.parentId&&!r.packet.mirrored)&&s.events.some(r=>r.nodeId===spanLabId('SW1')&&r.label==='Frame sent'&&!!r.packet&&r.packet.id===e.packet!.id&&!r.packet.mirrored));}
export function matchesSpanCriterion(s:Simulator,d:Device,c:SpanCriterion):boolean{
 if(d.id!==spanLabId('SW1')||['SW1','PC1','PC2','SRV1','AN1'].some(n=>!get(s,n)))return false;if(c.kind==='span-live')return live(s,d,c.check);
 if(c.check==='forward'||c.check==='control')return echoes(s,c.check==='forward'?'PC1':'PC2').length>=3;
 const index=new Map<string,SimEvent>();for(const e of s.events)if(e.packet?.frameId)index.set([e.nodeId,e.port,e.label,e.packet.frameId].join('|'),e);
 const captures:CapturedFrame[]=(get(s,'AN1')!.runtime.features.capturedFrames??[]).filter((r:CapturedFrame)=>proven(s,r,index)),client=(r:CapturedFrame)=>r.source==='192.168.10.10'&&r.destination==='192.168.10.20',server=(r:CapturedFrame)=>r.source==='192.168.10.20'&&r.destination==='192.168.10.10';
 const icmp=(mode:string,type:number)=>captures.filter(r=>r.protocol==='ICMP'&&r.icmpType===type&&r.span?.sourceInterface===g(1)&&r.span.configuredDirection===mode&&(type===8?client(r):server(r)));
 switch(c.check){
 case'rx':return new Set(icmp('rx',8).map(r=>r.id)).size>=3;
 case'tx':return new Set(icmp('tx',0).map(r=>r.id)).size>=3;
 case'both':return [8,0].every(type=>new Set(icmp('both',type).map(r=>r.id)).size>=3);
 case'arp':return ['request','reply'].every(op=>captures.some(r=>r.protocol==='ARP'&&r.arpOperation===op&&r.span?.sourceInterface===g(1)&&r.span.configuredDirection==='both'&&(op==='request'?client(r):server(r))));
 case'http':return [client,server].every((dir,i)=>captures.some(r=>dir(r)&&r.protocol==='TCP'&&(i?r.sourcePort:r.destinationPort)===80&&r.span?.configuredDirection==='both'))&&Object.values<any>(get(s,'PC1')!.runtime.features.tcpConnections??{}).some(c=>{if(c.remoteAddress!=='192.168.10.20'||c.remotePort!==80||c.payload?.path!=='/'||c.payload.application!=='http'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;try{const r=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));return r.statusCode===200&&r.content?.includes('SPAN application');}catch{return false;}});
 case'dns':return [client,server].every((dir,i)=>captures.some(r=>dir(r)&&r.protocol==='UDP'&&(i?r.sourcePort:r.destinationPort)===53&&r.span?.configuredDirection==='both'))&&get(s,'PC1')!.runtime.features.dnsCache?.['span.lab|A']?.address==='192.168.10.20';
 case'duplicates':return captures.some(r=>r.protocol==='ICMP'&&r.icmpType===8&&client(r)&&r.span?.sourceInterface===g(1)&&r.span.direction==='rx'&&captures.some(copy=>copy.frameId!==r.frameId&&copy.id===r.id&&copy.span?.sourceFrame===r.span!.sourceFrame&&copy.span.sourceInterface===g(2)&&copy.span.direction==='tx'));
 case'isolation':return spanDestination(d,g(4))&&s.events.some(e=>e.nodeId===d.id&&e.port===g(4)&&e.label==='SPAN destination ingress discarded'&&e.packet?.source==='192.168.10.99'&&e.packet.destination==='192.168.10.10')&&captures.some(r=>r.protocol==='ARP'&&r.source==='192.168.10.10'&&r.destination==='192.168.10.99'&&r.arpOperation==='request')&&!Object.values(d.runtime.mac).some(r=>r.port===g(4));
 case'removed':{const change=(d.runtime.features.spanSessionChanges??[]).findLast((h:any)=>h.id==='1'&&h.destination===g(4)&&h.sources.length===0&&!h.removed);return !!change&&live(s,d,'destination')&&d.config.features.spanSessions?.['1']?.sources.length===0&&s.interfaceUp(d.id,g(4))&&captures.some(r=>r.protocol==='ICMP'&&client(r)&&r.time<change.time)&&echoes(s,'PC1',change.time).length>=3&&!captures.some(r=>(index.get([d.id,g(4),'Frame sent',r.frameId].join('|'))?.time??-Infinity)>change.time);}
 case'recovery':return s.events.some(e=>e.nodeId===d.id&&e.port===g(4)&&e.label==='Link unavailable'&&e.packet?.span?.sourceInterface===g(1)&&e.packet.source==='192.168.10.10'&&e.packet.destination==='192.168.10.20'&&echoes(s,'PC1',e.time).length>=3&&captures.some(r=>r.time>e.time&&client(r)&&r.protocol==='ICMP'&&r.icmpType===8))&&live(s,d,'ports');
 }
}
