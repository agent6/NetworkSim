import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';

export const flexibleNetflowId=(name:string)=>'device-fnf-'+name.toLowerCase();
export const FNF_MATCH=['ipv4 source address','ipv4 destination address','ipv4 protocol','transport source-port','transport destination-port','interface input'] as const;
export const FNF_COLLECT=['interface output','counter bytes long','counter packets long','timestamp sys-uptime first','timestamp sys-uptime last'] as const;
type Live='keys'|'collect'|'exporter'|'monitor'|'client'|'server'|'receiver'|'saved';
type Observed='forward'|'reverse'|'icmp'|'tcp'|'udp'|'inactive'|'active'|'delivery';
export type FlexibleNetflowCriterion={kind:'fnf-live';device:string;check:Live}|{kind:'fnf-observe';device:string;check:Observed};
export function validFlexibleNetflowCriterion(c:any):boolean{return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='fnf-live'?['keys','collect','exporter','monitor','client','server','receiver','saved'].includes(c.check):c.kind==='fnf-observe'&&['forward','reverse','icmp','tcp','udp','inactive','active','delivery'].includes(c.check));}
const g=(n:number)=>'GigabitEthernet0/'+n,get=(s:Simulator,n:string)=>s.getDevice(flexibleNetflowId(n));
const exact=(a:string[]|undefined,b:readonly string[])=>a?.length===b.length&&b.every(v=>a.includes(v));
function live(s:Simulator,d:Device,c:Live):boolean{
 const f=d.config.features,r=f.flowRecords?.['LAB-IPV4'],e=f.flowExporters?.['TO-NMS'],m=f.flowMonitors?.['LAB-MONITOR'];
 switch(c){
  case'keys':return exact(r?.match,FNF_MATCH)===true;
  case'collect':return exact(r?.collect,FNF_COLLECT)===true;
  case'exporter':return e?.destination==='192.168.100.10'&&e.source==='Loopback0'&&e.port===2055&&e.version===9;
  case'monitor':return m?.record==='LAB-IPV4'&&m.exporter==='TO-NMS'&&m.cacheTimeout===15&&m.inactiveTimeout===5;
  case'client':return d.config.interfaces[g(0)]?.features.flowMonitorIn==='LAB-MONITOR';
  case'server':return d.config.interfaces[g(1)]?.features.flowMonitorIn==='LAB-MONITOR'&&Object.values(d.config.interfaces).every(p=>!p.features.flowMonitorOut&&!p.features.netflowIn&&!p.features.netflowOut)&&!d.config.interfaces[g(2)]?.features.flowMonitorIn;
  case'receiver':{const n=get(s,'NMS1')?.config.services.netflow;return n?.enabled===true&&(n.port??2055)===2055;}
  case'saved':return ['keys','collect','exporter','monitor','client','server','receiver'].every(c=>live(s,d,c as Live))&&d.config.ipRouting&&Object.values(d.config.interfaces).filter(p=>[g(0),g(1),g(2),'Loopback0'].includes(p.name)).every(p=>s.interfaceUp(d.id,p.name))&&s.lab.links.every(l=>l.enabled)&&[[g(0),'192.168.10.1','255.255.255.0'],[g(1),'192.168.20.1','255.255.255.0'],[g(2),'192.168.100.1','255.255.255.0'],['Loopback0','10.255.0.1','255.255.255.255']].every(([name,ip,mask])=>d.config.interfaces[name]?.ip===ip&&d.config.interfaces[name].mask===mask)&&!!d.startupConfig&&JSON.stringify(d.config)===JSON.stringify(d.startupConfig);
 }
}
/** Correlate exported records with actual routed packets, rather than accepting configuration or arbitrary counters. */
function proven(s:Simulator,r:any):boolean{
 const router=get(s,'R1')!,collector=get(s,'NMS1')!;
 if(r.exporter!=='10.255.0.1'||r.collectorPort!==2055||r.version!==9||r.monitor!=='LAB-MONITOR'||r.record!=='LAB-IPV4'||!Number.isInteger(r.packets)||r.packets<1||r.last<r.first)return false;
 const received=s.events.find(e=>e.nodeId===collector.id&&e.label==='Frame received'&&!!e.packet&&e.packet.id===r.packetId&&e.packet.source===r.exporter&&e.packet.destination==='192.168.100.10'&&e.packet.destinationPort===2055&&e.packet.netflow?.records.some((v:any)=>v.key===r.key&&v.first===r.first&&v.last===r.last&&v.packets===r.packets&&v.bytes===r.bytes));
 if(!received||!s.events.some(e=>e.nodeId===router.id&&e.port===g(2)&&e.label==='Frame sent'&&e.packet?.id===r.packetId))return false;
 const ids=new Map<string,number>();
 for(const e of s.events){const p=e.packet;if(e.nodeId!==router.id||e.label!=='Frame received'||e.port!==r.input||!p||p.source!==r.source||p.destination!==r.destination||p.protocol.toLowerCase()!==r.protocol||e.time<r.first-.01||e.time>r.last+.01||(p.sourcePort??0)!==r.sourcePort||(p.destinationPort??0)!==r.destinationPort)continue;
  const destination=get(s,r.destination==='192.168.20.10'?'SRV1':'PC1');
  if(s.events.some(sent=>sent.nodeId===router.id&&sent.label==='Frame sent'&&sent.port===r.output&&sent.packet?.id===p.id)&&s.events.some(end=>end.nodeId===destination?.id&&end.label==='Frame received'&&end.packet?.id===p.id))ids.set(p.id,p.size??0);
 }
 return ids.size===r.packets&&[...ids.values()].reduce((a,b)=>a+b,0)===r.bytes;
}
export function matchesFlexibleNetflowCriterion(s:Simulator,d:Device,c:FlexibleNetflowCriterion):boolean{
 if(d.id!==flexibleNetflowId('R1')||['R1','PC1','SRV1','NMS1'].some(n=>!get(s,n)))return false;
 if(c.kind==='fnf-live')return live(s,d,c.check);
 const rows=(get(s,'NMS1')!.runtime.features.netflowReceived??[]).filter((r:any)=>proven(s,r));
 const outward=(r:any)=>r.source==='192.168.10.10'&&r.destination==='192.168.20.10'&&r.input===g(0)&&r.output===g(1),inward=(r:any)=>r.source==='192.168.20.10'&&r.destination==='192.168.10.10'&&r.input===g(1)&&r.output===g(0);
 switch(c.check){
  case'forward':case'reverse':{const from=get(s,c.check==='forward'?'PC1':'SRV1')!,to=c.check==='forward'?'192.168.20.10':'192.168.10.10';return s.events.some(e=>e.nodeId===from.id&&e.label==='Echo reply received'&&e.disposition==='success'&&e.packet?.source===to&&s.events.some(f=>f.nodeId===d.id&&f.label==='Frame sent'&&f.packet?.id===e.packet!.id));}
  case'icmp':return [outward,inward].every(direction=>rows.some((r:any)=>direction(r)&&r.protocol==='icmp'&&r.sourcePort===0&&r.destinationPort===0&&r.packets>=3));
  case'tcp':return [outward,inward].every((direction,i)=>rows.some((r:any)=>direction(r)&&r.protocol==='tcp'&&(i?r.sourcePort:r.destinationPort)===80))&&Object.values<any>(get(s,'PC1')!.runtime.features.tcpConnections??{}).some(c=>{if(c.remoteAddress!=='192.168.20.10'||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;try{const r=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));return r.statusCode===200&&r.content?.includes('Flexible NetFlow application');}catch{return false;}});
  case'udp':return [outward,inward].every((direction,i)=>rows.some((r:any)=>direction(r)&&r.protocol==='udp'&&(i?r.sourcePort:r.destinationPort)===53))&&get(s,'PC1')!.runtime.features.dnsCache?.['app.lab|A']?.address==='192.168.20.10';
  case'inactive':case'active':return rows.some((r:any)=>outward(r)&&r.protocol==='icmp'&&(d.runtime.features.flowRetirements??[]).some((h:any)=>h.monitor===r.monitor&&h.key===r.key&&h.first===r.first&&h.last===r.last&&h.packets===r.packets&&h.reason===c.check&&h.time-r.first>=(c.check==='active'?15000:5000)));
  case'delivery':return rows.length>=2&&rows.some(outward)&&rows.some(inward);
 }
}
