import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';

export const eigrpLoadBalancingLabId=(name:string)=>'device-elb-'+name.toLowerCase();
export const eigrpLoadBalancingTargets=Array.from({length:8},(_,i)=>'192.168.40.'+(10+i));
const live=['policy','neighbors','routes','weights','healthy','saved'] as const;
const observed=['diagnose','equal','variance','traffic','http','minimum','feasibility','failover'] as const;
type Observed=typeof observed[number];
type Mode='initial'|'equal'|'variance'|'normal'|'minimum'|'feasibility'|'failover';
export type EIGRPLoadBalancingCriterion={kind:'elb-live';device:string;check:typeof live[number]}|{kind:'elb-observe';device:string;check:Observed};
export function validEIGRPLoadBalancingCriterion(c:any){return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='elb-live'?(live as readonly string[]).includes(c.check):c.kind==='elb-observe'&&(observed as readonly string[]).includes(c.check));}
const id=eigrpLoadBalancingLabId,g=(i:number)=>'GigabitEthernet0/'+i,names=['R1','R2','R3','R4'];
const get=(s:Simulator,n:string)=>s.getDevice(id(n))!,eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const client='192.168.10.10',server=eigrpLoadBalancingTargets[0],net='192.168.40.0';
function shape(s:Simulator){return s.lab.devices.length===6&&names.every(n=>get(s,n)?.kind==='router'&&[0,1,2].every(i=>!!get(s,n)?.config.interfaces[g(i)]))&&get(s,'PC1')?.kind==='pc'&&get(s,'SRV1')?.kind==='server'&&['PC1','SRV1'].every(n=>!!get(s,n)?.config.interfaces.GigabitEthernet0);}
function base(s:Simulator,mode:Mode='normal'){
 const pair=(a:string,ap:string,b:string,bp:string)=>[id(a)+':'+ap,id(b)+':'+bp].sort().join('|');
 const expected=[pair('PC1','GigabitEthernet0','R1',g(0)),pair('R1',g(1),'R2',g(0)),pair('R2',g(1),'R4',g(1)),pair('R1',g(2),'R3',g(0)),pair('R3',g(1),'R4',g(2)),pair('R4',g(0),'SRV1','GigabitEthernet0')].sort();
 const ports:[string,number,string][]=[['R1',0,'192.168.10.1'],['R1',1,'10.0.12.1'],['R2',0,'10.0.12.2'],['R2',1,'10.0.24.1'],['R4',1,'10.0.24.2'],['R1',2,'10.0.13.1'],['R3',0,'10.0.13.2'],['R3',1,'10.0.34.1'],['R4',2,'10.0.34.2'],['R4',0,'192.168.40.1']];
 return s.lab.links.length===6&&s.lab.links.every(l=>l.enabled&&!l.loss)&&eq(s.lab.links.map(l=>[l.a.deviceId+':'+l.a.port,l.b.deviceId+':'+l.b.port].sort().join('|')).sort(),expected)&&
 s.lab.devices.every(d=>d.powered&&!d.config.staticRoutes.length&&!Object.keys(d.config.features.vrfs??{}).length&&!Object.keys(d.config.features.routeMaps??{}).length&&!Object.keys(d.config.features.acls??{}).length&&!Object.keys(d.config.features.prefixLists??{}).length&&!d.config.features.localPolicy&&!d.config.features.cefHash&&Object.values(d.config.interfaces).every(p=>!p.vrf&&!p.features.aclIn&&!p.features.aclOut&&!p.features.routeMap&&!p.features.servicePolicyIn&&!p.features.servicePolicyOut&&!(p.features.eigrp?.summaries??[]).length&&!p.features.eigrp?.authenticationMode))&&
 names.every(n=>get(s,n).config.ipRouting)&&ports.every(([n,i,ip])=>{const d=get(s,n),p=d.config.interfaces[g(i)],admin=!(n==='R1'&&i===1&&mode==='failover'),up=admin&&!(n==='R2'&&i===0&&mode==='failover'),delay=n==='R1'&&i===2?['initial','equal'].includes(mode)?10:50:n==='R3'&&i===0?1000:n==='R3'&&i===1&&mode==='feasibility'?20:10;return p.ip===ip&&p.mask===(ip.startsWith('10.')?'255.255.255.252':'255.255.255.0')&&p.adminUp===admin&&!p.switchport&&p.features.bandwidth===1000000&&p.features.delay===delay&&s.interfaceUp(d.id,p.name)===up;})&&
 ['PC1','SRV1'].every((n,i)=>{const d=get(s,n),p=d.config.interfaces.GigabitEthernet0;return p.adminUp&&!p.features.dhcp&&p.ip===(i?server:client)&&p.mask==='255.255.255.0'&&d.config.defaultGateway===`192.168.${i?40:10}.1`&&eq(p.features.secondaryIps??[],i?eigrpLoadBalancingTargets.slice(1).map(ip=>({ip,mask:'255.255.255.0'})):[]);});
}
function policy(s:Simulator,mode:Mode='normal'){return names.every((n,i)=>{const d=get(s,n),p=d.config.protocols.eigrp,wanted=[['10.0.12.0/30','10.0.13.0/30','192.168.10.0/24'],['10.0.12.0/30','10.0.24.0/30'],['10.0.13.0/30','10.0.34.0/30'],['10.0.24.0/30','10.0.34.0/30','192.168.40.0/24']][i],active=n==='R1'||n==='R4'?[g(1),g(2)]:[g(0),g(1)];return eq(Object.keys(d.config.protocols),['eigrp'])&&p?.asn===100&&!p.name&&p.enabled!==false&&p.routerId===`${i+1}.${i+1}.${i+1}.${i+1}`&&p.autoSummary===false&&eq((p.networks??[]).map((x:any)=>x.network+'/'+x.prefix).sort(),wanted)&&eq(p.passiveInterfaces,['default'])&&eq([...(p.activeInterfaces??[])].sort(),active)&&eq(p.metricWeights??[1,0,1,0,0],[1,0,1,0,0])&&!(p.redistribute??[]).length&&!p.defaultOriginate&&!p.distance&&!p.stub&&(p.variance??1)===(n==='R1'?['initial','equal','variance'].includes(mode)?1:mode==='feasibility'?3:2:1)&&(p.maximumPaths??4)===(n==='R1'?mode==='initial'?1:2:4)&&(p.trafficShare??'balanced')===(n==='R1'&&mode==='minimum'?'min':'balanced')&&!Object.keys(p.summaryMetrics??{}).length&&!(p.offsetLists??[]).length&&!(p.distributeLists??[]).length;});}
function peers(s:Simulator,mode:Mode='normal'){return names.every(n=>{const entries:[string,number][]=n==='R1'?[['R2',1],['R3',2]]:n==='R2'?[['R1',0],['R4',1]]:n==='R3'?[['R1',0],['R4',1]]:[['R2',1],['R3',2]],wanted=entries.filter(([p])=>!(mode==='failover'&&[n,p].sort().join(',')==='R1,R2')),rows=get(s,n).runtime.neighbors.filter(a=>a.protocol==='EIGRP'&&a.state==='UP');return rows.length===wanted.length&&wanted.every(([p,i])=>rows.some(a=>a.deviceId===id(p)&&a.interface===g(i)));});}
function routes(s:Simulator,mode:Mode='normal',weights=false){
 const d=get(s,'R1'),r=d.runtime.routes.filter(r=>r.network===net&&r.prefix===24&&r.protocol==='D'&&!r.vrf).sort((a,b)=>a.metric-b.metric),t=d.runtime.features.eigrpTopology?.find((r:any)=>r.network===net&&r.prefix===24&&!r.vrf);
 const entries: [number,number,number][] =mode==='failover'?[[2,20480,1]]:['initial','variance','feasibility'].includes(mode)?[[1,10240,1]]:mode==='equal'?[[1,10240,1],[2,10240,1]]:[[1,10240,mode==='minimum'?1:2],[2,20480,mode==='minimum'?0:1]];
 if(r.length!==entries.length||!t||t.state!=='PASSIVE'||t.feasibleDistance!==10240||t.successors.length!==entries.length||!entries.every(([i,metric,share])=>r.some(v=>v.ad===90&&v.interface===g(i)&&v.nextHop===`10.0.1${i+1}.2`&&v.metric===metric&&(!weights||v.share===share))))return false;
 if(mode==='variance')return t.feasibleSuccessors?.some((p:any)=>p.interface===g(2)&&p.metric===20480&&p.reportedDistance===7680);
 if(mode==='feasibility')return t.nonFeasiblePaths?.some((p:any)=>p.interface===g(2)&&p.metric===23040&&p.reportedDistance===10240)&&!t.feasibleSuccessors.length;
 return true;
}
function state(s:Simulator,m:Mode='normal'){return base(s,m)&&policy(s,m)&&peers(s,m)&&routes(s,m,true);}
function healthy(s:Simulator){const h=get(s,'SRV1').config.services.http;return state(s)&&h?.enabled&&(h.port??80)===80&&(h.authentication??'none')==='none'&&!!h.content?.includes('EIGRP load balancing: service available');}
type Attempt={lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};
const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator){let a=attempts.get(s);if(!a||a.lab!==s.lab){a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);const current=a,off=s.subscribe(()=>{if(s.lab!==current.lab){off();return;}if(shape(s))refresh(s,current);});}return a;}
function since(s:Simulator,a:Attempt,key:string,ok:boolean){if(!ok){a.epochs.delete(key);return;}const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),names.map(n=>get(s,n).runtime.routes.filter(r=>r.protocol==='D').map(r=>[r.network,r.prefix,r.interface,r.nextHop,r.metric,r.share]))]),old=a.epochs.get(key);if(!old||old.signature!==signature){const v={signature,since:s.clock.now()};a.epochs.set(key,v);return v.since;}return old.since;}
/** Require delivered requests AND matched replies; per-flow stable egress and
 * actual forwarding on both branches distinguish ECMP/UCMP from RIB-only work. */
function flows(s:Simulator,at:number,mode:'primary'|'both'|'alternate'){
 const events=s.events.filter(e=>e.time>at),accepted=new Set(events.filter(e=>e.nodeId===id('SRV1')&&e.label==='Echo request accepted').map(e=>e.packet?.id)),sent=new Map<string,string[]>();
 for(const e of events)if(e.nodeId===id('R1')&&e.label==='Frame sent'&&e.packet?.messageType==='echo-request'&&e.packet.source===client){const ports=sent.get(e.packet.id)??[];ports.push(e.port!);sent.set(e.packet.id,ports);}
 const delivered=new Map<string,Set<string>>(),path=new Map<string,Set<string>>();
 for(const e of events){const p=e.packet;if(e.nodeId!==id('PC1')||e.label!=='Echo reply received'||p?.destination!==client||!p.parentId||!eigrpLoadBalancingTargets.includes(p.source)||!accepted.has(p.parentId))continue;
  const ports=sent.get(p.parentId);if(!ports||ports.length!==1||![g(1),g(2)].includes(ports[0]))continue;
  const branch=ports[0]===g(1)?'R2':'R3';if(!events.some(x=>x.nodeId===id(branch)&&x.port===g(1)&&x.label==='Frame sent'&&x.packet?.id===p.parentId)||!events.some(x=>x.nodeId===id('R4')&&x.port===g(0)&&x.label==='Frame sent'&&x.packet?.id===p.parentId))continue;
  const ids=delivered.get(p.source)??new Set();ids.add(p.parentId);delivered.set(p.source,ids);const choices=path.get(p.source)??new Set();choices.add(ports[0]);path.set(p.source,choices);
 }
 if(!eigrpLoadBalancingTargets.every(t=>(delivered.get(t)?.size??0)>=3&&path.get(t)?.size===1))return false;
 const ports=new Set([...path.values()].flatMap(v=>[...v]));return mode==='both'?ports.size===2:ports.size===1&&ports.has(g(mode==='primary'?1:2));
}
function reverse(s:Simulator,at:number){const ids=new Set<string>();for(const e of s.events){const p=e.packet;if(e.time<=at||e.nodeId!==id('SRV1')||e.label!=='Echo reply received'||p?.source!==client||p.destination!==server||!p.parentId)continue;if(s.events.some(x=>x.time>at&&x.nodeId===id('PC1')&&x.label==='Echo request accepted'&&x.packet?.id===p.parentId))ids.add(p.parentId);}return ids.size>=3;}
function web(s:Simulator,at:number){return Object.entries<any>(get(s,'PC1').runtime.features.tcpConnections??{}).some(([t,c])=>{if(c.remoteAddress!==server||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;const r=get(s,'SRV1').runtime.features.tcpConnections?.[t];if(r?.source!==client||r.response?.statusCode!==200)return false;try{const b=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));if(b.statusCode!==200||b.content!==r.response.content||!b.content.includes('EIGRP load balancing: service available'))return false;}catch{return false;}return s.events.some(e=>e.time>at&&e.nodeId===id('R1')&&[g(1),g(2)].includes(e.port??'')&&e.label==='Frame sent'&&e.packet?.serviceTransaction===t&&e.packet.source===client);});}
function refresh(s:Simulator,a:Attempt){
 for(const [mode,check,paths]of [['initial','diagnose','primary'],['equal','equal','both'],['variance','variance','primary']] as const){const at=since(s,a,mode,state(s,mode));if(at!==undefined&&flows(s,at,paths))a.earned.add(check);}
 for(const [mode,paths]of [['minimum','primary'],['feasibility','primary'],['failover','alternate']] as const){const at=since(s,a,mode,a.earned.has('traffic')&&state(s,mode));if(at!==undefined&&flows(s,at,paths)&&reverse(s,at))a.marks.set(mode,s.clock.now());}
 const normal=since(s,a,'normal',healthy(s));if(normal===undefined)return;
 if(flows(s,normal,'both')&&reverse(s,normal)){a.earned.add('traffic');for(const check of ['minimum','feasibility','failover'] as const){const mark=a.marks.get(check);if(mark!==undefined&&normal>=mark)a.earned.add(check);}}
 if(web(s,normal))a.earned.add('http');
}
export function matchesEIGRPLoadBalancingCriterion(s:Simulator,d:Device,c:EIGRPLoadBalancingCriterion):boolean{
 if(!validEIGRPLoadBalancingCriterion(c)||d.id!==c.device||d.id!==id('R1')||!shape(s))return false;
 if(c.kind==='elb-observe'){const a=attempt(s);if(!a.earned.has(c.check))refresh(s,a);return a.earned.has(c.check);}
 switch(c.check){case'policy':return base(s)&&policy(s);case'neighbors':return base(s)&&policy(s)&&peers(s);case'routes':return base(s)&&policy(s)&&peers(s)&&routes(s);case'weights':return state(s);case'healthy':return healthy(s);case'saved':return healthy(s)&&names.every(n=>eq(get(s,n).config,get(s,n).startupConfig));}
}
