import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {ospfShow} from './ios-show-routing.ts';
import {activeIOSOSPFRouterId} from './ospf-router-id.ts';
import {isIPv4,ipToInt} from './ip.ts';

export const ospfPathPreferenceLabId=(name:string)=>'device-opp-'+name.toLowerCase();
const live=['policy','neighbors','metric','routes','database','healthy','saved']as const;
const stages=['equal','intra','e1','e2','tie','failover']as const;
const observed=['diagnose','traffic','http',...stages]as const;
type Observed=typeof observed[number];type Mode='initial'|'ready'|typeof stages[number];
export type OSPFPathPreferenceCriterion={kind:'opp-live';device:string;check:typeof live[number]}|{kind:'opp-observe';device:string;check:Observed};
export function validOSPFPathPreferenceCriterion(c:any){return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='opp-live'?(live as readonly string[]).includes(c.check):c.kind==='opp-observe'&&(observed as readonly string[]).includes(c.check));}
const id=ospfPathPreferenceLabId,g=(i:number)=>'GigabitEthernet0/'+i,names=['R1','R2','R3','R4'];
const get=(s:Simulator,n:string)=>s.getDevice(id(n))!,eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),area=(v:unknown)=>typeof v==='string'&&isIPv4(v)?ipToInt(v):Number(v);
const ports:[string,number,string][]=[['R1',0,'192.168.10.1'],['R1',1,'10.0.12.1'],['R1',2,'10.0.13.1'],['R2',0,'192.168.20.1'],['R2',1,'10.0.12.2'],['R2',2,'10.0.24.1'],['R3',1,'10.0.13.2'],['R3',2,'10.0.34.1'],['R4',0,'192.168.40.1'],['R4',1,'10.0.24.2'],['R4',2,'10.0.34.2']];
const edges:[string,number,string,number][]=[['R1',1,'R2',1],['R1',2,'R3',1],['R2',2,'R4',1],['R3',2,'R4',2]],hosts={PC1:'192.168.10.10',PC2:'192.168.20.10',SRV1:'192.168.40.10'};
const external=(m:Mode)=>['e1','e2','tie'].includes(m);
function shape(s:Simulator){return s.lab.devices.length===7&&names.every(n=>get(s,n)?.kind==='router')&&ports.every(([n,i])=>!!get(s,n)?.config.interfaces[g(i)])&&Object.keys(hosts).every(n=>get(s,n)?.kind===(n==='SRV1'?'server':'pc')&&!!get(s,n)?.config.interfaces.GigabitEthernet0);}
function base(s:Simulator,m:Mode='ready'){
 const key=(a:string,ap:string,b:string,bp:string)=>[id(a)+':'+ap,id(b)+':'+bp].sort().join('|'),wanted=[...edges.map(([a,ap,b,bp])=>key(a,g(ap),b,g(bp))),key('PC1','GigabitEthernet0','R1',g(0)),key('PC2','GigabitEthernet0','R2',g(0)),key('SRV1','GigabitEthernet0','R4',g(0))].sort();
 return s.lab.links.length===7&&s.lab.links.every(l=>l.enabled&&!l.loss&&!l.lossAB&&!l.lossBA)&&eq(s.lab.links.map(l=>[l.a.deviceId+':'+l.a.port,l.b.deviceId+':'+l.b.port].sort().join('|')).sort(),wanted)&&s.lab.devices.every(d=>d.powered&&!Object.keys(d.config.features.vrfs??{}).length&&!Object.keys(d.config.features.acls??{}).length&&!Object.keys(d.config.features.prefixLists??{}).length&&!Object.keys(d.config.features.routeMaps??{}).length&&!d.config.features.localPolicy&&Object.values(d.config.interfaces).every(p=>!p.vrf&&!p.features.aclIn&&!p.features.aclOut&&!p.features.routeMap&&!p.features.servicePolicyIn&&!p.features.servicePolicyOut))&&names.every(n=>get(s,n).config.ipRouting&&Object.values(get(s,n).config.interfaces).every(p=>!p.ip&&p.features.ospf?.area===undefined||ports.some(([owner,i])=>owner===n&&g(i)===p.name)))&&ports.every(([n,i,ip])=>{const p=get(s,n).config.interfaces[g(i)],admin=!(m==='failover'&&n==='R1'&&i===1),up=!(m==='failover'&&['R1','R2'].includes(n)&&i===1);return p.ip===ip&&p.mask===(ip.startsWith('10.')?'255.255.255.252':'255.255.255.0')&&!p.switchport&&p.adminUp===admin&&p.mtu===1500&&s.interfaceUp(id(n),g(i))===up;})&&Object.entries(hosts).every(([n,ip])=>{const d=get(s,n),p=d.config.interfaces.GigabitEthernet0;return p.adminUp&&!p.features.dhcp&&!d.config.staticRoutes.length&&p.ip===ip&&p.mask==='255.255.255.0'&&d.config.defaultGateway===ip.replace(/10$/,'1');});
}
function cost(n:string,i:number,m:Mode){return i===0?1:m==='initial'&&n==='R1'&&i===1||m==='intra'&&['R1','R4'].includes(n)&&i===1?100:['R1','R4'].includes(n)&&i===2?!['equal','intra'].includes(m)?30:10:10;}
function policy(s:Simulator,m:Mode='ready'){
 return names.every(n=>{const d=get(s,n),c=d.config.protocols.ospf,asbr=external(m)&&['R2','R3'].includes(n),staticRows=d.config.staticRoutes;
  if(!eq(Object.keys(d.config.protocols),['ospf'])||!c||c.enabled===false||c.processId!==10||c.routerId!==Array(4).fill(n.slice(1)).join('.')||activeIOSOSPFRouterId(d)!==c.routerId||c.maximumPaths!==2||(c.networks??[]).length||!eq(c.passiveInterfaces??[],n==='R3'?[]:[g(0)])||c.passiveDefault||(c.activeInterfaces??[]).length||c.defaultOriginate||c.distance||c.maxMetric||(c.neighbors??[]).length||(c.distributeLists??[]).length||(c.virtualLinks??[]).length||Object.values<any>(c.areas??{}).some(v=>Object.keys(v).length))return false;
  const metric=m==='e1'?(n==='R2'?100:1):m==='e2'?(n==='R2'?50:20):20,type=m==='e1'&&n==='R2'?1:2;
  if(!eq(c.redistribute??[],asbr?[{protocol:'static',metric,metricType:type}]:[])||staticRows.length!==(asbr?1:0))return false;
  if(asbr){const r=staticRows[0];if(r.network!=='192.168.40.0'||r.prefix!==24||r.nextHop!==(n==='R2'?'10.0.24.2':'10.0.34.2')||r.interface||r.vrf||r.track||r.ad!==undefined&&r.ad!==1)return false;}
  return ports.filter(([owner])=>owner===n).every(([,i])=>{const f=d.config.interfaces[g(i)].features.ospf??{},inactive=external(m)&&n==='R4'&&i===0,a=m==='intra'&&(n==='R3'||['R1','R4'].includes(n)&&i===2)?10:0;return (inactive?f.processId===undefined&&f.area===undefined:f.processId===10&&area(f.area)===a)&&f.cost===cost(n,i,m)&&f.networkType===(i?'point-to-point':undefined)&&(f.helloInterval??10)===10&&(f.deadInterval??40)===40&&!f.authentication&&!f.authenticationKeyChain&&!f.mtuIgnore;});
 });
}
function neighbors(s:Simulator,m:Mode='ready'){return edges.every(([a,ap,b,bp])=>[[a,ap,b,bp],[b,bp,a,ap]].every(([from,port,to,peer])=>{const down=m==='failover'&&[from,to].includes('R1')&&[from,to].includes('R2'),rows=ospfLiveDetail(s,id(from as string),'ospf')?.neighbors??[];return down?!rows.some(n=>n.deviceId===id(to as string)&&n.state==='FULL'):rows.some(n=>n.deviceId===id(to as string)&&n.interface===g(port as number)&&n.peerInterface===g(peer as number)&&n.state==='FULL');}));}
function route(s:Simulator,n:string,network:string,protocol:string,metric:number,hops:string[],forward?:number){const rows=get(s,n).runtime.routes.filter(r=>r.network===network&&r.prefix===24&&!r.vrf);return rows.length===hops.length&&rows.every(r=>r.protocol===protocol&&r.ad===110&&r.metric===metric&&hops.includes(r.nextHop!)&&r.interface===g(r.nextHop==='10.0.13.2'||r.nextHop==='10.0.34.1'?2:1)&&(forward===undefined||r.forwardMetric===forward))&&hops.every(h=>rows.some(r=>r.nextHop===h));}
function routes(s:Simulator,m:Mode='ready'){
 const forward=m==='initial'||m==='e2'||m==='failover'?'10.0.13.2':'10.0.12.2',reverse=m==='failover'?'10.0.34.1':'10.0.24.1',metric=m==='intra'?111:m==='initial'||m==='failover'?41:m==='e1'?110:external(m)?20:21;
 return route(s,'R1','192.168.40.0',m==='e1'?'O E1':external(m)?'O E2':'O',metric,m==='equal'?['10.0.12.2','10.0.13.2']:[forward],external(m)?m==='e2'?30:10:undefined)&&route(s,'R4','192.168.10.0','O',m==='intra'?111:m==='failover'?41:21,m==='equal'?['10.0.24.1','10.0.34.1']:[reverse])&&(m!=='intra'||['192.168.10.0','192.168.40.0'].every(net=>get(s,'R3').runtime.routes.some(r=>r.network===net&&r.protocol==='O IA')));
}
const state=(s:Simulator,m:Mode='ready')=>base(s,m)&&policy(s,m)&&neighbors(s,m)&&routes(s,m);
function database(s:Simulator){return [['R1','4.4.4.4','192.168.40.0'],['R4','1.1.1.1','192.168.10.0']].every(([n,rid,prefix])=>{const text=(ospfShow(s,get(s,n),'ospf','database',['router',rid])??[]).join('\n');return text.includes('Advertising Router: '+rid)&&text.includes(prefix);});}
function healthy(s:Simulator){const h=get(s,'SRV1').config.services.http;return state(s)&&database(s)&&h?.enabled&&(h.port??80)===80&&(h.authentication??'none')==='none'&&!!h.content?.includes('OSPF path preference: primary service verified');}

type Attempt={lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator){let a=attempts.get(s);if(!a||a.lab!==s.lab){a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);const current=a,off=s.subscribe(()=>{if(s.lab!==current.lab){off();return;}if(shape(s))refresh(s,current);});}return a;}
function since(s:Simulator,a:Attempt,key:string,ok:boolean){if(!ok){a.epochs.delete(key);return;}const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),names.map(n=>get(s,n).runtime.routes.filter(r=>r.protocol.startsWith('O')).map(r=>[r.network,r.prefix,r.interface,r.metric,r.forwardMetric]))]),old=a.epochs.get(key);if(!old||old.signature!==signature){a.epochs.set(key,{signature,since:s.clock.now()});return s.clock.now();}return old.since;}
// Correlate original requests, destination acceptance, actual branch egresses and
// parent-linked replies. Configuration and historical ping counters are insufficient.
function proof(s:Simulator,at:number,control:boolean,reverse:boolean,m:Mode){
 const from=control?(reverse?'R2':'PC2'):(reverse?'SRV1':'PC1'),to=control?(reverse?'PC2':'R2'):(reverse?'PC1':'SRV1');
 const source=control?(reverse?'192.168.20.1':hosts.PC2):(reverse?hosts.SRV1:hosts.PC1),target=control?(reverse?hosts.PC2:'192.168.20.1'):(reverse?hosts.PC1:hosts.SRV1),ids=new Set<string>();
 const branches=m==='equal'?['R2','R3']:m==='failover'||!reverse&&['initial','e2'].includes(m)?['R3']:['R2'];
 const path=(branch:string):[string,string][]=>control?(reverse?[['R2',g(0)]]:[]):reverse?[['R4',g(branch==='R2'?1:2)],[branch,g(1)],['R1',g(0)]]:[['R1',g(branch==='R2'?1:2)],[branch,g(2)],['R4',g(0)]];
 for(const e of s.events){const p=e.packet;if(e.time<=at||e.nodeId!==id(from)||e.label!=='Frame sent'||p?.protocol!=='ICMP'||p.ipVersion!==4||p.messageType!=='echo-request'||p.source!==source||p.destination!==target)continue;const req=p.id;if(!s.events.some(x=>x.time>at&&x.nodeId===id(from)&&x.label==='Echo reply received'&&x.packet?.parentId===req&&x.packet.source===target&&x.packet.destination===source)||!s.events.some(x=>x.time>at&&x.nodeId===id(to)&&x.label==='Echo request accepted'&&x.packet?.id===req)||!branches.some(branch=>path(branch).every(([n,port])=>s.events.some(x=>x.time>at&&x.nodeId===id(n)&&x.port===port&&x.label==='Frame sent'&&x.packet?.id===req))))continue;ids.add(req);
 }return ids.size>=3;
}
const all=(s:Simulator,at:number,m:Mode)=>[false,true].every(control=>[false,true].every(reverse=>proof(s,at,control,reverse,m)));
function web(s:Simulator,at:number){return Object.entries<any>(get(s,'PC1').runtime.features.tcpConnections??{}).some(([t,c])=>{if(c.remoteAddress!==hosts.SRV1||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;const r=get(s,'SRV1').runtime.features.tcpConnections?.[t];if(r?.source!==hosts.PC1||r.response?.statusCode!==200)return false;try{const b=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));if(b.statusCode!==200||b.content!==r.response.content||!b.content.includes('OSPF path preference: primary service verified'))return false;}catch{return false;}return [['R1',g(1)],['R2',g(2)],['R4',g(0)]].every(([n,port])=>s.events.some(e=>e.time>at&&e.nodeId===id(n)&&e.port===port&&e.label==='Frame sent'&&e.packet?.serviceTransaction===t&&e.packet.source===hosts.PC1));});}
function refresh(s:Simulator,a:Attempt){
 if(a.earned.size===observed.length)return;if(!a.earned.has('diagnose')){const at=since(s,a,'initial',state(s,'initial'));if(at!==undefined&&all(s,at,'initial'))a.earned.add('diagnose');}
 if(a.earned.has('traffic'))for(const m of stages){if(a.earned.has(m))continue;const at=since(s,a,m,state(s,m));if(at!==undefined&&all(s,at,m))a.marks.set(m,s.clock.now());}
 const at=since(s,a,'ready',healthy(s));if(at===undefined)return;if(all(s,at,'ready')){a.earned.add('traffic');for(const key of stages){const mark=a.marks.get(key);if(mark!==undefined&&at>=mark)a.earned.add(key);}}if(web(s,at))a.earned.add('http');
}
export function matchesOSPFPathPreferenceCriterion(s:Simulator,d:Device,c:OSPFPathPreferenceCriterion):boolean{
 if(!validOSPFPathPreferenceCriterion(c)||d.id!==c.device||d.id!==id('R1')||!shape(s))return false;if(c.kind==='opp-observe'){const a=attempt(s);if(!a.earned.has(c.check))refresh(s,a);return a.earned.has(c.check);}
 switch(c.check){case'policy':return base(s)&&policy(s);case'neighbors':return base(s)&&policy(s)&&neighbors(s);case'metric':return state(s)&&ports.every(([n,i])=>(ospfShow(s,get(s,n),'ospf','interface',[g(i)])??[]).some(line=>line.includes('Cost: '+cost(n,i,'ready'))));case'routes':return state(s);case'database':return state(s)&&database(s);case'healthy':return healthy(s);case'saved':return healthy(s)&&names.every(n=>eq(get(s,n).config,get(s,n).startupConfig));}
}
