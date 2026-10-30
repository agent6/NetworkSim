import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {sameAddress} from './ip.ts';
export type BestPathStage='baseline'|'med'|'aspath'|'localpref'|'weight'|'return';
type Check='routers'|'peers'|'sessions'|'origins'|'paths'|'policy'|'rib'|'saved';
export type EBGPBestCriterion={kind:'bp-live';device:string;check:Check}|{kind:'bp-stage';device:string;phase:BestPathStage};
const checks=['routers','peers','sessions','origins','paths','policy','rib','saved'],phases=['baseline','med','aspath','localpref','weight','return'];
export const bestPathId=(name:string)=>'device-best-'+name.toLowerCase();
const g=(n:number)=>'GigabitEthernet0/'+n;
const peers=[['R1','R2',1,1,'10.0.12.1','10.0.12.2',65001,65002],['R1','R3',2,1,'10.0.13.1','10.0.13.2',65001,65002],['R2','R4',2,1,'10.0.24.1','10.0.24.2',65002,65004],['R3','R4',2,2,'10.0.34.1','10.0.34.2',65002,65004]] as const;
export function validEBGPBestCriterion(c:any):boolean{return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='bp-live'?checks.includes(c.check):c.kind==='bp-stage'&&phases.includes(c.phase));}
const devices=(s:Simulator)=>['R1','R2','R3','R4'].map(n=>s.getDevice(bestPathId(n)));
const candidates=(d:Device)=>(d.runtime.features.bgpPaths??[]).filter((p:any)=>!p.vrf&&p.network==='192.168.40.0'&&p.prefix===24);
function routers(s:Simulator):boolean{return devices(s).every((d,i)=>!!d&&s.devicePowered(d.id)&&d.kind==='router'&&d.config.ipRouting&&d.config.protocols.bgp?.asn===[65001,65002,65002,65004][i]&&d.config.protocols.bgp.routerId===`${i+1}.${i+1}.${i+1}.${i+1}`&&Object.keys(d.config.protocols).length===1&&!d.config.staticRoutes.length&&!(d.config.protocols.bgp.redistribute??[]).length&&!(d.config.protocols.bgp.aggregates??[]).length&&(d.config.protocols.bgp.maximumPaths??1)===1&&!d.config.protocols.bgp.alwaysCompareMed&&!d.config.protocols.bgp.bgpDistance);}
function peerState(s:Simulator,live=false):boolean{return routers(s)&&peers.every(([a,b,ai,bi,ipA,ipB,asA,asB])=>[[a,b,ai,bi,ipA,ipB,asA,asB],[b,a,bi,ai,ipB,ipA,asB,asA]].every(([a,b,ai,bi,ipA,ipB,asA,asB])=>{const d=s.getDevice(bestPathId(String(a)))!,other=s.getDevice(bestPathId(String(b)))!,p=d.config.interfaces[g(Number(ai))],q=other.config.interfaces[g(Number(bi))],link=s.linkAt(d.id,g(Number(ai))),cfg=d.config.protocols.bgp,n=cfg.neighbors?.find((n:any)=>n.address===ipB);if(!p||p.ip!==ipA||p.mask!=='255.255.255.252'||!q||q.ip!==ipB||q.mask!=='255.255.255.252'||!s.interfaceUp(d.id,g(Number(ai)))||!link?.enabled||![link.a.deviceId,link.b.deviceId].includes(other.id)||!n||n.remoteAs!==asB||n.shutdown||n.activated===false||n.updateSource||(n.ebgpMultihop??1)!==1||cfg.defaultIPv4Unicast===false)return false;if(!live)return true;const r=(d.runtime.features.bgpSessions??[]).find((r:any)=>r.neighbor===ipB&&!r.vrf&&r.family===4);return r?.state==='ESTABLISHED'&&!!r.channelId&&r.stats?.received?.OPEN>0&&r.stats?.received?.KEEPALIVE>0&&r.stats?.received?.UPDATE>0&&r.transport?.localAddress===ipA&&[r.transport.localPort,r.transport.peerPort].includes(179);}));}
function origins(s:Simulator):boolean{return routers(s)&&devices(s).every((d,i)=>{const network=i===0?'192.168.10.0':i===3?'192.168.40.0':undefined,c=d!.config.protocols.bgp;return network?c.networks?.length===1&&c.networks[0].network===network&&c.networks[0].prefix===24&&d!.runtime.routes.some(r=>r.protocol==='connected'&&r.network===network&&r.prefix===24):!(c.networks??[]).length;});}
function paths(s:Simulator):boolean{
 const d=s.getDevice(bestPathId('R1'));if(!d||!peerState(s,true)||!origins(s))return false;const ps=candidates(d);
 return ps.length===2&&ps.every((p:any)=>p.learnedVia==='ebgp'&&p.originCode==='i'&&p.origin===bestPathId('R4')&&p.asPath?.at(-1)===65004&&p.asPath[0]===65002&&['10.0.12.2','10.0.13.2'].includes(p.nextHop)&&Number.isFinite(p.weight)&&Number.isFinite(p.localPreference))&&new Set(ps.map((p:any)=>p.nextHop)).size===2&&ps.filter((p:any)=>p.best).length===1;
}
function stage(s:Simulator,phase:BestPathStage):boolean{
 if(!paths(s))return false;const d=s.getDevice(bestPathId('R1'))!,ps=candidates(d),a=ps.find((p:any)=>p.nextHop==='10.0.12.2'),b=ps.find((p:any)=>p.nextHop==='10.0.13.2'),late=['aspath','localpref','weight','return'].includes(phase),lp=['localpref','weight','return'].includes(phase),weight=['weight','return'].includes(phase),baseline=phase==='baseline';
 if(a.asPath.join(',')!=='65002,65004'||b.asPath.join(',')!==(late?'65002,65002,65002,65004':'65002,65004')||a.weight!==(weight?300:0)||b.weight!==0||a.localPreference!==100||b.localPreference!==(lp?200:100)||a.med!==(baseline?0:100)||b.med!==(baseline?0:50))return false;
 const best=ps.find((p:any)=>p.best),expected=baseline?best.nextHop:phase==='med'||phase==='localpref'?'10.0.13.2':'10.0.12.2',rib=d.runtime.routes.filter(r=>r.network==='192.168.40.0'&&r.prefix===24);return best.nextHop===expected&&rib.length===1&&rib[0].protocol==='B'&&rib[0].ad===20&&rib[0].nextHop===expected&&rib[0].metric===best.med;
}
function policy(s:Simulator):boolean{
 if(!stage(s,'weight'))return false;const [a,b,c]=devices(s) as Device[],left=a.config.protocols.bgp.neighbors.find((n:any)=>n.address==='10.0.12.2'),right=a.config.protocols.bgp.neighbors.find((n:any)=>n.address==='10.0.13.2'),map=(d:Device,name:string)=>Object.values<any>(d.config.features.routeMaps??{}).filter(m=>m.name===name);
 const exact=(d:Device,name:string,clauses:string[])=>{const m=map(d,name);return m.length===1&&m[0].action==='permit'&&m[0].sequence===10&&!(m[0].match??[]).length&&m[0].set?.length===clauses.length&&clauses.every(c=>m[0].set.includes(c));};
 return left.weight===300&&right.routeMapIn==='PREFER-R3'&&exact(a,'PREFER-R3',['local-preference 200'])&&b.config.protocols.bgp.neighbors.find((n:any)=>n.address==='10.0.12.1')?.routeMapOut==='TO-R1'&&c.config.protocols.bgp.neighbors.find((n:any)=>n.address==='10.0.13.1')?.routeMapOut==='TO-R1'&&exact(b,'TO-R1',['metric 100'])&&exact(c,'TO-R1',['metric 50','as-path prepend 65002 65002']);
}
// Per-attempt observation epochs prevent a prior stage's packets earning a later stage.
// Only lesson achievements persist; timers, sessions and these epochs rebuild on load.
const epochs=new WeakMap<Simulator,{lab:object;states:Map<string,{signature:string;since:number}>}>();
function observedSince(s:Simulator,c:Extract<EBGPBestCriterion,{kind:'bp-stage'}>):number|undefined{
 let e=epochs.get(s);if(!e||e.lab!==s.lab){e={lab:s.lab,states:new Map()};epochs.set(s,e);}const key=c.device+':'+c.phase;
 if(!stage(s,c.phase)){e.states.delete(key);return;}
 const signature=JSON.stringify(devices(s).map(d=>({config:d!.config,channels:(d!.runtime.features.bgpSessions??[]).map((r:any)=>[r.neighbor,r.channelId,r.establishedAt]),paths:candidates(d!)}))),prior=e.states.get(key);
 // Exclude volatile counters/uptime: candidate rows and configuration are stable within a stage.
 if(!prior||prior.signature!==signature||prior.since>s.clock.now()){const next={signature,since:s.clock.now()};e.states.set(key,next);return next.since;}return prior.since;
}
function traffic(s:Simulator,source:Device,target:Device,since:number,expectedFirst?:string):boolean{
 const from=source.config.interfaces.GigabitEthernet0?.ip,to=target.config.interfaces.GigabitEthernet0?.ip;if(!from||!to||!s.devicePowered(source.id)||!s.devicePowered(target.id))return false;
 const forward=(packetId:string,address:string,start:string,end:string,first?:string)=>{let current=start,time=since,visited=new Set<string>();for(let i=0;i<5;i++){if(visited.has(current))return false;visited.add(current);const lookup=s.cefLookup(current,address),link=lookup&&s.linkAt(current,lookup.port);if(!lookup||!['B','connected'].includes(lookup.route.protocol)||!link?.enabled)return false;const next=link.a.deviceId===current?link.b.deviceId:link.a.deviceId;if(i===0&&first&&next!==first)return false;const sent=s.events.find(e=>e.time>=time&&e.nodeId===current&&e.port===lookup.port&&e.label==='Frame sent'&&e.packet?.id===packetId&&e.packet.protocol==='ICMP'&&sameAddress(e.packet.destination,address));if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===next&&e.label==='Frame received'&&e.packet?.id===packetId))return false;if(next===end)return true;if(s.getDevice(next)?.kind!=='router')return false;current=next;time=sent.time;}return false;};
 const first=source.id===bestPathId('PC1')?'R1':'R4',last=first==='R1'?'R4':'R1';
 return s.events.some(e=>e.time>=since&&e.nodeId===target.id&&e.label==='Echo request accepted'&&e.packet?.protocol==='ICMP'&&e.packet.ipVersion===4&&sameAddress(e.packet.source,from)&&sameAddress(e.packet.destination,to)&&s.events.some(sent=>sent.time>=since&&sent.nodeId===source.id&&sent.label==='Frame sent'&&sent.packet?.id===e.packet!.id)&&forward(e.packet.id,to,bestPathId(first),target.id,expectedFirst)&&s.events.some(reply=>reply.time>=e.time&&reply.nodeId===source.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.parentId===e.packet!.id&&sameAddress(reply.packet.source,to)&&sameAddress(reply.packet.destination,from)&&forward(reply.packet.id,from,bestPathId(last),source.id)));
}
export function matchesEBGPBestCriterion(s:Simulator,d:Device,c:EBGPBestCriterion):boolean{
 if(d.id!==bestPathId('R1'))return false;
 if(c.kind==='bp-stage'){const since=observedSince(s,c);if(since===undefined)return false;const reverse=c.phase==='return',from=s.getDevice(bestPathId(reverse?'SRV1':'PC1')),to=s.getDevice(bestPathId(reverse?'PC1':'SRV1'));if(!from||!to)return false;const best=candidates(d).find((p:any)=>p.best);return traffic(s,from,to,since,reverse?undefined:bestPathId(best.nextHop==='10.0.12.2'?'R2':'R3'));}
 switch(c.check){case'routers':return routers(s);case'peers':return peerState(s);case'sessions':return peerState(s,true);case'origins':return origins(s);case'paths':return paths(s);case'policy':return policy(s);case'rib':return stage(s,'weight');case'saved':return policy(s)&&devices(s).every(d=>!!d!.startupConfig&&JSON.stringify(d!.config)===JSON.stringify(d!.startupConfig));}
}
