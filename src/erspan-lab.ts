import type {Simulator} from './engine.ts';
import type {Device,SimEvent} from './model.ts';
import type {CapturedFrame} from './span.ts';

export const erspanLabId=(name:string)=>'device-erspan-'+name.toLowerCase();
type Live='routes'|'source'|'destination'|'topology'|'saved';
type Observed='local'|'reachability'|'rx'|'tx'|'both'|'arp'|'http'|'dns'|'transport'|'mismatch'|'acl'|'route-loss'|'outage'|'isolation';
export type ErspanCriterion={kind:'erspan-live';device:string;check:Live}|{kind:'erspan-observe';device:string;check:Observed};
export function validErspanCriterion(c:any):boolean {
 return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='erspan-live'?['routes','source','destination','topology','saved'].includes(c.check):c.kind==='erspan-observe'&&['local','reachability','rx','tx','both','arp','http','dns','transport','mismatch','acl','route-loss','outage','isolation'].includes(c.check));
}
const g=(n:number)=>'GigabitEthernet0/'+n,get=(s:Simulator,n:string)=>s.getDevice(erspanLabId(n));
function live(s:Simulator,d:Device,c:Live):boolean {
 const receiver=get(s,'R3')!,a=d.config.features.spanSessions?.['1'],b=receiver.config.features.spanSessions?.['7'];
 switch(c){
  case'routes':return [['R1','10.0.23.0','10.0.12.2'],['R3','10.0.12.0','10.0.23.1']].every(([n,network,nextHop])=>get(s,n)!.runtime.routes.some(r=>r.network===network&&r.prefix===30&&r.nextHop===nextHop&&r.protocol==='static'&&!r.vrf));
  case'source':return a?.type==='erspan-source'&&a.shutdown===false&&a.erspanId===42&&a.ipAddress==='10.0.23.2'&&a.originIp==='10.0.12.1'&&!a.vrf&&!a.destination&&a.sources?.length===1&&a.sources[0].interface===g(0)&&a.sources[0].direction==='both';
  case'destination':return b?.type==='erspan-destination'&&b.shutdown===false&&b.erspanId===42&&b.ipAddress==='10.0.23.2'&&b.destination===g(1)&&!b.vrf&&!b.originIp&&b.sources?.length===0;
  case'topology':return live(s,d,'source')&&live(s,d,'destination')&&[['R1',0,'192.168.10.1','255.255.255.0'],['R1',2,'192.168.20.1','255.255.255.0'],['R1',1,'10.0.12.1','255.255.255.252'],['R2',0,'10.0.12.2','255.255.255.252'],['R2',1,'10.0.23.1','255.255.255.252'],['R3',0,'10.0.23.2','255.255.255.252']].every(([n,i,ip,mask])=>{const node=get(s,String(n))!,p=node.config.interfaces[g(Number(i))];return p.ip===ip&&p.mask===mask&&!p.switchport&&!p.vrf&&!p.features.aclIn&&!p.features.aclOut&&s.interfaceUp(node.id,p.name);})&&s.interfaceUp(receiver.id,g(1))&&['PC1','SRV1','AN1'].every((n,i)=>{const node=get(s,n)!,p=node.config.interfaces.GigabitEthernet0;return p.ip===['192.168.10.10','192.168.20.20','192.168.99.99'][i]&&p.mask==='255.255.255.0'&&!p.features.dhcp&&s.interfaceUp(node.id,p.name)&&node.config.defaultGateway===[ '192.168.10.1','192.168.20.1',undefined][i];})&&s.lab.links.length===5&&s.lab.links.every(l=>l.enabled&&l.loss===0);
  case'saved':return ['routes','source','destination','topology'].every(c=>live(s,d,c as Live))&&['R1','R2','R3'].every(n=>{const node=get(s,n)!;return Object.keys(node.config.features.spanSessions??{}).length===(n==='R2'?0:1)&&!!node.startupConfig&&JSON.stringify(node.config)===JSON.stringify(node.startupConfig);});
 }
}
function echoes(s:Simulator,n='PC1',target='192.168.20.20',after=-Infinity):SimEvent[]{return s.events.filter(e=>e.nodeId===erspanLabId(n)&&e.label==='Echo reply received'&&e.disposition==='success'&&e.packet?.source===target&&e.time>after);}
function proven(s:Simulator,r:CapturedFrame,index:Map<string,SimEvent>):boolean {
 const m=r.span,o=m?.erspan;
 if(!m||!o||m.sourceDevice!==erspanLabId('R1')||m.session!=='1'||m.sourceInterface!==g(0)||o.id!==42||o.origin!=='10.0.12.1'||o.destination!=='10.0.23.2'||o.destinationDevice!==erspanLabId('R3')||o.destinationSession!=='7'||r.port!=='GigabitEthernet0'||!r.mirrored)return false;
 const original=index.get([erspanLabId('R1'),g(0),m.direction==='rx'?'Frame received':'Frame sent',m.sourceFrame].join('|'))?.packet;
 if(!original||original.mirrored||original.ipVersion!==undefined&&original.id!==r.id||original.source!==r.source||original.destination!==r.destination||original.protocol!==r.protocol||original.ttl!==r.ttl||original.sourceMac!==r.sourceMac||original.destinationMac!==r.destinationMac)return false;
 const outer=(n:string,i:number,label:string)=>index.get(['gre',erspanLabId(n),g(i),label,o.packetId].join('|')),received=outer('R3',0,'Frame received');
 return o.ttl===63&&received?.packet?.ttl===63&&received.packet.erspan?.id===42&&received.packet.erspan?.sequence===o.sequence&&received.packet.erspan?.sourceFrame===m.sourceFrame&&[['R1',1,'Frame sent',64],['R2',0,'Frame received',64],['R2',1,'Frame sent',63]].every(([n,i,label,ttl])=>outer(String(n),Number(i),String(label))?.packet?.ttl===ttl)&&index.get([erspanLabId('AN1'),r.port,'Frame received',r.frameId].join('|'))?.packet?.id===r.id;
}
export function matchesErspanCriterion(s:Simulator,d:Device,c:ErspanCriterion):boolean {
 if(d.id!==erspanLabId('R1')||['R1','R2','R3','PC1','SRV1','AN1'].some(n=>!get(s,n)))return false;
 if(c.kind==='erspan-live')return live(s,d,c.check);
 if(c.check==='local')return echoes(s).length>=3;
 if(c.check==='reachability')return echoes(s,'R1','10.0.23.2').length>=3;
 const index=new Map<string,SimEvent>();for(const e of s.events){if(e.packet?.frameId)index.set([e.nodeId,e.port,e.label,e.packet.frameId].join('|'),e);if(e.protocol==='GRE'&&e.packet)index.set(['gre',e.nodeId,e.port,e.label,e.packet.id].join('|'),e);}
 const rows:CapturedFrame[]=(get(s,'AN1')!.runtime.features.capturedFrames??[]).filter((r:CapturedFrame)=>proven(s,r,index));
 const out=(r:CapturedFrame)=>r.source==='192.168.10.10'&&r.destination==='192.168.20.20',back=(r:CapturedFrame)=>r.source==='192.168.20.20'&&r.destination==='192.168.10.10';
 const survived=(e:SimEvent)=>{const frame=e.packet?.erspan?.sourceFrame??e.packet?.span?.sourceFrame,original=index.get([d.id,g(0),'Frame received',frame].join('|'))?.packet??index.get([d.id,g(0),'Frame sent',frame].join('|'))?.packet;return original?.protocol==='ICMP'&&echoes(s).some(r=>r.packet?.parentId===(original.icmpType===8?original.id:original.parentId));};
 const recovered=(e:SimEvent)=>survived(e)&&rows.some(r=>r.time>e.time&&out(r)&&r.protocol==='ICMP');
 switch(c.check){
  case'rx':case'tx':case'both':return (c.check==='both'?[8,0]:[c.check==='rx'?8:0]).every(type=>new Set(rows.filter(r=>r.protocol==='ICMP'&&r.icmpType===type&&r.span?.configuredDirection===c.check&&(type===8?out(r):back(r))).map(r=>r.id)).size>=3);
  case'arp':return ['request','reply'].every(op=>rows.some(r=>r.protocol==='ARP'&&r.arpOperation===op&&(op==='request'?r.source==='192.168.10.10'&&r.destination==='192.168.10.1':r.source==='192.168.10.1'&&r.destination==='192.168.10.10')));
  case'http':return [out,back].every((f,i)=>rows.some(r=>f(r)&&r.protocol==='TCP'&&(i?r.sourcePort:r.destinationPort)===80))&&Object.values<any>(get(s,'PC1')!.runtime.features.tcpConnections??{}).some(c=>{if(c.remoteAddress!=='192.168.20.20'||c.remotePort!==80||c.payload?.path!=='/'||c.payload.application!=='http'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;try{const r=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));return r.statusCode===200&&r.content?.includes('ERSPAN application');}catch{return false;}});
  case'dns':return [out,back].every((f,i)=>rows.some(r=>f(r)&&r.protocol==='UDP'&&(i?r.sourcePort:r.destinationPort)===53))&&get(s,'PC1')!.runtime.features.dnsCache?.['erspan.lab|A']?.address==='192.168.20.20';
  case'transport':return [out,back].every(f=>rows.some(r=>f(r)&&r.protocol==='ICMP'));
  case'mismatch':return live(s,d,'destination')&&s.events.some(e=>e.nodeId===erspanLabId('R3')&&e.label==='ERSPAN session unmatched'&&e.packet?.erspan?.id===42&&e.packet.erspan.receiverIds?.includes(88)&&!e.packet.erspan.receiverIds.includes(42)&&recovered(e));
  case'acl':return live(s,d,'topology')&&s.events.some(e=>e.nodeId===erspanLabId('R2')&&e.port===g(1)&&e.label==='Egress ACL denied'&&e.protocol==='GRE'&&e.packet?.erspan?.id===42&&echoes(s,'R1','10.0.23.2',e.time).length>=3&&recovered(e));
  case'route-loss':return live(s,d,'routes')&&s.events.some(e=>e.nodeId===d.id&&e.label==='No route'&&e.protocol==='GRE'&&e.packet?.erspan?.id===42&&recovered(e));
  case'outage':return live(s,d,'topology')&&s.events.some(e=>e.nodeId===erspanLabId('R3')&&e.port===g(1)&&e.label==='Link unavailable'&&e.packet?.span?.erspan?.id===42&&recovered(e));
  case'isolation':return live(s,d,'destination')&&s.events.some(e=>e.nodeId===erspanLabId('R3')&&e.port===g(1)&&e.label==='SPAN destination ingress discarded'&&e.packet?.source==='192.168.99.99')&&rows.some(r=>out(r)&&r.protocol==='ICMP');
 }
}
