import type {Simulator} from './engine.ts';
import type {Device,SimEvent} from './model.ts';
import type {SLAObservation} from './sla-config.ts';

export const ipSlaLabId=(name:string)=>'device-ip-sla-'+name.toLowerCase();
type Live='pinned'|'echo'|'tracks'|'defaults'|'http'|'udp'|'topology'|'saved';
type Observed='baseline'|'icmp'|'primary'|'failover'|'recovery'|'threshold'|'http-result'|'http-failure'|'udp-result'|'udp-failure'|'unschedule';
export type IPSLACriterion={kind:'ipsla-live';device:string;check:Live}|{kind:'ipsla-observe';device:string;check:Observed};
export function validIPSLACriterion(c:any):boolean{return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='ipsla-live'?['pinned','echo','tracks','defaults','http','udp','topology','saved'].includes(c.check):c.kind==='ipsla-observe'&&['baseline','icmp','primary','failover','recovery','threshold','http-result','http-failure','udp-result','udp-failure','unschedule'].includes(c.check));}
const g=(n:number)=>'GigabitEthernet0/'+n,get=(s:Simulator,n:string)=>s.getDevice(ipSlaLabId(n));
const scheduled=(d:Device,id:number)=>{const v=d.config.features.ipSlaSchedules?.[id];return v?.start==='now'&&v.life===0;};
function live(s:Simulator,d:Device,c:Live):boolean {
 const p=d.config.features.ipSla??{},f=d.config.features,t=f.tracks??{};
 switch(c){
  case'pinned':return d.config.staticRoutes.some(r=>r.network==='203.0.113.4'&&r.prefix===32&&r.nextHop==='10.0.12.2'&&r.interface===g(1)&&r.track===undefined&&(r.ad??1)===1)&&s.cefLookup(d.id,'203.0.113.4')?.port===g(1);
  case'echo':return p[1]?.type==='icmp-echo'&&p[1].target==='203.0.113.4'&&p[1].source===g(1)&&p[1].frequency===5&&p[1].timeout===500&&p[1].threshold===100&&scheduled(d,1);
  case'tracks':return t[1]?.type==='sla'&&t[1].sla===1&&t[1].aspect==='reachability'&&t[1].delayDown===2&&t[1].delayUp===3&&t[2]?.type==='sla'&&t[2].sla===1&&t[2].aspect==='state';
  case'defaults':return d.config.staticRoutes.some(r=>r.prefix===0&&r.network==='0.0.0.0'&&r.nextHop==='10.0.12.2'&&r.interface===g(1)&&(r.ad??1)===1&&r.track===1)&&d.config.staticRoutes.some(r=>r.prefix===0&&r.network==='0.0.0.0'&&r.nextHop==='10.0.13.2'&&r.interface===g(2)&&r.ad===200&&!r.track);
  case'http':return p[2]?.type==='http'&&p[2].url==='http://192.0.2.10/'&&p[2].frequency===60&&p[2].timeout===1000&&scheduled(d,2);
  case'udp':return p[3]?.type==='udp-jitter'&&p[3].target==='203.0.113.44'&&p[3].port===20000&&p[3].source==='192.168.10.1'&&p[3].numPackets===5&&p[3].interval===20&&p[3].control===true&&p[3].frequency===5&&p[3].timeout===500&&scheduled(d,3)&&get(s,'R4')!.config.features.ipSlaResponder?.enabled===true;
  case'topology':return live(s,d,'echo')&&['R1','R2','R3','R4'].every(n=>get(s,n)!.config.ipRouting)&&[['R1',0,'192.168.10.1',24],['R1',1,'10.0.12.1',30],['R1',2,'10.0.13.1',30],['R2',0,'10.0.12.2',30],['R2',1,'10.0.24.1',30],['R3',0,'10.0.13.2',30],['R3',1,'10.0.34.1',30],['R4',0,'10.0.24.2',30],['R4',1,'10.0.34.2',30],['R4',2,'192.0.2.1',24]].every(([n,i,ip,prefix])=>{const node=get(s,String(n))!,p=node.config.interfaces[g(Number(i))];return p.ip===ip&&p.mask===(prefix===24?'255.255.255.0':'255.255.255.252')&&!p.vrf&&!p.switchport&&!p.features.aclIn&&!p.features.aclOut&&s.interfaceUp(node.id,p.name);})&&['PC1','SRV1'].every((n,i)=>{const node=get(s,n)!,p=node.config.interfaces.GigabitEthernet0;return p.ip===['192.168.10.10','192.0.2.10'][i]&&p.mask==='255.255.255.0'&&!p.features.dhcp&&node.config.defaultGateway===['192.168.10.1','192.0.2.1'][i];})&&get(s,'R4')!.config.interfaces.Loopback0?.ip==='203.0.113.4'&&get(s,'R4')!.config.interfaces.Loopback1?.ip==='203.0.113.44'&&get(s,'SRV1')!.config.services.http?.enabled===true&&s.lab.links.length===6&&s.lab.links.every(l=>l.enabled&&l.loss===0&&!l.lossAB&&!l.lossBA);
  case'saved':return ['pinned','echo','tracks','defaults','http','udp','topology'].every(c=>live(s,d,c as Live))&&['R1','R2','R3','R4'].every(n=>{const node=get(s,n)!;return !!node.startupConfig&&JSON.stringify(node.config)===JSON.stringify(node.startupConfig);});
 }
}
function userPath(s:Simulator,via:string,after=-Infinity,before=Infinity):boolean {
 const replies=s.events.filter(e=>e.nodeId===ipSlaLabId('PC1')&&e.label==='Echo reply received'&&e.packet?.source==='192.0.2.10'&&e.time>after&&e.time<before);
 return new Set(replies.filter(e=>s.events.some(r=>r.nodeId===ipSlaLabId(via)&&r.label==='Frame sent'&&r.packet?.id===e.packet!.parentId&&r.packet?.icmpType===8&&r.packet?.source==='192.168.10.10'&&r.packet?.destination==='192.0.2.10')).map(e=>e.packet!.parentId)).size>=3;
}
function packets(s:Simulator,h:SLAObservation):SimEvent[]{const ids=new Set(h.requests);return s.events.filter(e=>e.time>=h.lastRun&&e.time<=h.completedAt&&(ids.has(e.packet?.probeId)||ids.has(e.packet?.serviceTransaction)));}
function measured(s:Simulator,h:SLAObservation):boolean {
 const events=packets(s,h);
 if(h.probe.type==='icmp-echo')return events.some(e=>e.nodeId===ipSlaLabId('R4')&&e.packet?.icmpType===8&&e.packet.destination==='203.0.113.4')&&events.some(e=>e.nodeId===ipSlaLabId('R1')&&e.label==='Echo reply received'&&e.packet?.source==='203.0.113.4');
 if(h.probe.type==='http')return events.some(e=>e.nodeId===ipSlaLabId('SRV1')&&e.label==='Frame received'&&e.packet?.destinationPort===80)&&events.some(e=>e.nodeId===ipSlaLabId('R1')&&e.label==='Frame received'&&e.packet?.sourcePort===80&&e.packet.tcpFlags==='PSH ACK');
 return h.packetsSent===5&&h.packetsReceived===5&&h.requests.length===6&&[1967,20000].every(port=>events.some(e=>e.nodeId===ipSlaLabId('R4')&&e.label==='Frame received'&&e.packet?.destinationPort===port)&&events.some(e=>e.nodeId===ipSlaLabId('R1')&&e.label==='Frame received'&&e.packet?.sourcePort===port))&&Number.isFinite(h.jitter)&&h.jitter!>=0;
}
export function matchesIPSLACriterion(s:Simulator,d:Device,c:IPSLACriterion):boolean {
 if(d.id!==ipSlaLabId('R1')||['R1','R2','R3','R4','PC1','SRV1'].some(n=>!get(s,n)))return false;
 if(c.kind==='ipsla-live')return live(s,d,c.check);
 const history:SLAObservation[]=d.runtime.features.ipSlaHistory??[],good=(op:string)=>history.filter(h=>h.operation===op&&h.returnCode==='OK'&&h.success&&measured(s,h));
 const failures=history.filter(h=>h.operation==='1'&&h.returnCode==='Timeout'&&h.upInterfaces.includes(g(1))&&h.tracks[1]?.up===false&&h.defaults.some(r=>r.ad===200)&&packets(s,h).some(e=>e.nodeId===ipSlaLabId('R2')&&e.port===g(1)&&e.label==='Link loss'));
 const failover=failures.find(h=>userPath(s,'R3',h.completedAt,good('1').find(r=>r.completedAt>h.completedAt)?.completedAt??Infinity));
 switch(c.check){
  case'baseline':return userPath(s,'R3');
  case'icmp':return good('1').some((h,i,a)=>h.probe.source===g(1)&&h.probe.frequency===5&&a.some(k=>h.lastRun-k.lastRun===5000));
  case'primary':return good('1').some(h=>h.tracks[1]?.up&&h.defaults.some(r=>r.ad===1)&&userPath(s,'R2',h.completedAt));
  case'failover':return !!failover;
  case'recovery':return !!failover&&good('1').some(h=>h.completedAt>failover.completedAt&&h.tracks[1]?.up&&h.defaults.some(r=>r.ad===1)&&userPath(s,'R2',h.completedAt));
  case'threshold':return history.some(h=>h.operation==='1'&&h.probe.threshold===1&&h.returnCode==='Over threshold'&&h.success&&h.tracks[1]?.up===true&&h.tracks[2]?.up===false&&h.defaults.some(r=>r.ad===1)&&measured(s,h));
  case'http-result':return good('2').some(h=>h.probe.url==='http://192.0.2.10/');
  case'udp-result':return good('3').some(h=>h.probe.target==='203.0.113.44'&&h.probe.port===20000);
  case'http-failure':case'udp-failure':{const op=c.check==='http-failure'?'2':'3';return history.some(h=>h.operation===op&&!h.success&&h.requests.length>0&&good(op).some(k=>k.completedAt<h.lastRun)&&(op==='2'?packets(s,h).some(e=>e.packet?.tcpFlags==='RST')||h.returnCode==='HTTP error 404':h.returnCode==='Responder unavailable'&&packets(s,h).some(r=>r.nodeId===ipSlaLabId('R4')&&r.label==='Frame received'&&r.packet?.destinationPort===1967&&s.events.some(e=>e.nodeId===ipSlaLabId('R1')&&e.label==='Frame received'&&e.packet?.parentId===r.packet!.id&&e.packet.icmpType===3&&e.packet.icmpCode===3)))&&good('1').some(k=>k.completedAt>h.completedAt)&&good(op).some(k=>k.completedAt>h.completedAt));}
  case'unschedule':{const stop=(d.runtime.features.ipSlaScheduleChanges??[]).findLast((v:any)=>v.operation==='1');return !!stop&&!d.config.features.ipSlaSchedules?.[1]&&d.config.features.ipSla?.[1]?.type==='icmp-echo'&&s.clock.now()-stop.time>=5000&&history.some(h=>h.operation==='1'&&h.success&&h.completedAt<stop.time)&&!history.some(h=>h.operation==='1'&&h.lastRun>stop.time)&&d.runtime.features.tracks?.[1]?.up===false&&userPath(s,'R3',stop.time+2000)&&good('3').some(h=>h.completedAt>stop.time);}
 }
}
