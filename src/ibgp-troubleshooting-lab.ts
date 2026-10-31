import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {activeIOSOSPFRouterId} from './ospf-router-id.ts';
import {isIPv4,ipToInt} from './ip.ts';

export const ibgpTroubleshootingLabId=(name:string)=>'device-ibt-'+name.toLowerCase();
const live=['policy','underlay','sessions','paths','routes','healthy','saved']as const;
const faults=['source','reachability','next-hop','full-mesh','reflector','origin']as const;
const observed=['diagnose','traffic','http',...faults]as const;
type Observed=typeof observed[number];type Mode='initial'|'ready'|typeof faults[number];
export type IBGPTroubleshootingCriterion={kind:'ibt-live';device:string;check:typeof live[number]}|{kind:'ibt-observe';device:string;check:Observed};
export function validIBGPTroubleshootingCriterion(c:any){return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='ibt-live'?(live as readonly string[]).includes(c.check):c.kind==='ibt-observe'&&(observed as readonly string[]).includes(c.check));}
const id=ibgpTroubleshootingLabId,g=(i:number)=>'GigabitEthernet0/'+i,names=['R1','R2','R3','R4'],lo=(n:string)=>'10.255.'+n.slice(1)+'.'+n.slice(1),rid=(n:string)=>Array(4).fill(n.slice(1)).join('.');
const get=(s:Simulator,n:string)=>s.getDevice(id(n))!,eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),area=(v:unknown)=>typeof v==='string'&&isIPv4(v)?ipToInt(v):Number(v);
const ports:[string,number,string][]=[['R1',0,'192.168.10.1'],['R1',1,'10.0.12.1'],['R2',0,'192.168.20.1'],['R2',1,'10.0.12.2'],['R2',2,'10.0.23.1'],['R3',1,'10.0.23.2'],['R3',2,'172.16.34.1'],['R4',1,'172.16.34.2'],['R4',0,'192.168.40.1']];
const edges:[string,number,string,number][]=[['R1',1,'R2',1],['R2',2,'R3',1],['R3',2,'R4',1]],hosts={PC1:'192.168.10.10',PC2:'192.168.20.10',SRV1:'192.168.40.10'};
const star=(m:Mode)=>m==='full-mesh'||m==='reflector',unresolved=(m:Mode)=>m==='initial'||m==='next-hop',isolated=(m:Mode)=>['source','reachability','full-mesh'].includes(m);
function shape(s:Simulator){return s.lab.devices.length===7&&names.every(n=>get(s,n)?.kind==='router')&&ports.every(([n,i])=>!!get(s,n)?.config.interfaces[g(i)])&&['R1','R2','R3'].every(n=>!!get(s,n)?.config.interfaces.Loopback0)&&Object.keys(hosts).every(n=>get(s,n)?.kind===(n==='SRV1'?'server':'pc')&&!!get(s,n)?.config.interfaces.GigabitEthernet0);}
function base(s:Simulator){
 const key=(a:string,ap:string,b:string,bp:string)=>[id(a)+':'+ap,id(b)+':'+bp].sort().join('|'),wanted=[...edges.map(([a,ap,b,bp])=>key(a,g(ap),b,g(bp))),key('PC1','GigabitEthernet0','R1',g(0)),key('PC2','GigabitEthernet0','R2',g(0)),key('SRV1','GigabitEthernet0','R4',g(0))].sort();
 return s.lab.links.length===6&&s.lab.links.every(l=>l.enabled&&!l.loss&&!l.lossAB&&!l.lossBA)&&eq(s.lab.links.map(l=>[l.a.deviceId+':'+l.a.port,l.b.deviceId+':'+l.b.port].sort().join('|')).sort(),wanted)&&s.lab.devices.every(d=>d.powered&&!d.config.staticRoutes.length&&!Object.keys(d.config.features.vrfs??{}).length&&!Object.keys(d.config.features.acls??{}).length&&!Object.keys(d.config.features.prefixLists??{}).length&&!Object.keys(d.config.features.routeMaps??{}).length&&!d.config.features.localPolicy&&Object.values(d.config.interfaces).every(p=>!p.vrf&&!p.features.aclIn&&!p.features.aclOut&&!p.features.routeMap&&!p.features.servicePolicyIn&&!p.features.servicePolicyOut))&&names.every(n=>get(s,n).config.ipRouting&&Object.values(get(s,n).config.interfaces).every(p=>!p.ip&&p.features.ospf?.area===undefined||n!=='R4'&&p.name==='Loopback0'||ports.some(([owner,i])=>owner===n&&g(i)===p.name)))&&ports.every(([n,i,ip])=>{const p=get(s,n).config.interfaces[g(i)];return p.ip===ip&&p.mask===(ip.startsWith('192.')?'255.255.255.0':'255.255.255.252')&&!p.switchport&&p.adminUp&&p.mtu===1500&&s.interfaceUp(id(n),g(i));})&&['R1','R2','R3'].every(n=>{const p=get(s,n).config.interfaces.Loopback0;return p.ip===lo(n)&&p.mask==='255.255.255.255'&&p.adminUp&&s.interfaceUp(id(n),'Loopback0');})&&Object.entries(hosts).every(([n,ip])=>{const d=get(s,n),p=d.config.interfaces.GigabitEthernet0;return p.adminUp&&!p.features.dhcp&&p.ip===ip&&p.mask==='255.255.255.0'&&d.config.defaultGateway===ip.replace(/10$/,'1');});
}
function expectedPeers(n:string,m:Mode):[string,number,string|undefined][] {
 if(n==='R4')return [['172.16.34.1',65000,undefined]];
 const peers:[string,number,string|undefined][]=['R1','R2','R3'].filter(other=>other!==n&&!(star(m)&&[n,other].includes('R1')&&[n,other].includes('R3'))).map(other=>[lo(other),65000,m==='source'&&[n,other].includes('R1')&&[n,other].includes('R3')?g(1):'Loopback0']);
 if(n==='R3')peers.push(['172.16.34.2',65100,undefined]);return peers;
}
function policy(s:Simulator,m:Mode='ready'){
 return names.every(n=>{const d=get(s,n),b=d.config.protocols.bgp,c=d.config.protocols.ospf,ospf=n!=='R4',peers=expectedPeers(n,m),neighbors=b?.neighbors??[];
  if(!eq(Object.keys(d.config.protocols).sort(),ospf?['bgp','ospf']:['bgp'])||!b||b.asn!==(n==='R4'?65100:65000)||b.routerId!==rid(n)||b.defaultIPv4Unicast===false||b.bgpDistance||(b.defaultLocalPreference??100)!==100||(b.maximumPaths??1)!==1||(b.maximumPathsIbgp??1)!==1||(b.redistribute??[]).length||(b.aggregates??[]).length||!eq(b.networks??[],n==='R1'?[{network:'192.168.10.0',prefix:24}]:n==='R4'&&m!=='origin'?[{network:'192.168.40.0',prefix:24}]:[])||b.clusterId!==(m==='reflector'&&n==='R2'?'2.2.2.2':undefined)||neighbors.length!==peers.length)return false;
  if(!peers.every(([address,asn,source])=>{const p=neighbors.find((p:any)=>p.address===address),nhs=n==='R3'&&address.startsWith('10.')&&!unresolved(m),client=m==='reflector'&&n==='R2';return p&&p.remoteAs===asn&&p.updateSource===source&&!!p.nextHopSelf===nhs&&!!p.routeReflectorClient===client&&!p.shutdown&&p.activated!==false&&!p.password&&!p.routeMapIn&&!p.routeMapOut&&!p.prefixListIn&&!p.prefixListOut&&!p.defaultOriginate&&!p.weight&&!p.maximumPrefix&&(p.ebgpMultihop??1)===1&&!p.ttlSecurityHops&&(p.timers?.keepalive??b.timers?.keepalive??60)===60&&(p.timers?.hold??b.timers?.hold??180)===180;}))return false;
  if(ospf&&(!c||c.enabled===false||c.processId!==10||c.routerId!==rid(n)||activeIOSOSPFRouterId(d)!==rid(n)||(c.networks??[]).length||!eq(c.passiveInterfaces,['Loopback0'])||(c.activeInterfaces??[]).length||c.passiveDefault||(c.redistribute??[]).length||c.defaultOriginate||c.distance||(c.virtualLinks??[]).length||Object.values<any>(c.areas??{}).some(v=>Object.keys(v).length)))return false;
  return Object.values(d.config.interfaces).every(p=>{const f=p.features.ospf??{},enabled=ospf&&(p.name==='Loopback0'&&!(m==='reachability'&&n==='R3')||!!p.ip?.startsWith('10.0.'));return (enabled?f.processId===10&&area(f.area)===0:f.processId===undefined&&f.area===undefined)&&(p.ip?.startsWith('10.0.')?f.cost===10&&f.networkType==='point-to-point':f.cost===undefined)&&(f.helloInterval??10)===10&&(f.deadInterval??40)===40&&!f.authentication&&!f.mtuIgnore;});
 });
}
function route(s:Simulator,n:string,net:string,prefix:number,protocol:string,ad:number,nextHop:string,port:string){const rows=get(s,n).runtime.routes.filter(r=>r.network===net&&r.prefix===prefix&&!r.vrf);return rows.length===1&&rows[0].protocol===protocol&&rows[0].ad===ad&&rows[0].nextHop===nextHop&&rows[0].interface===port;}
const none=(s:Simulator,n:string,net:string,prefix=24)=>!get(s,n).runtime.routes.some(r=>r.network===net&&r.prefix===prefix);
function underlay(s:Simulator,m:Mode='ready'){
 return edges.slice(0,2).every(([a,ap,b,bp])=>[[a,ap,b,bp],[b,bp,a,ap]].every(([from,port,to,peer])=>(ospfLiveDetail(s,id(from as string),'ospf')?.neighbors??[]).some(n=>n.deviceId===id(to as string)&&n.interface===g(port as number)&&n.peerInterface===g(peer as number)&&n.state==='FULL')))&&['R1','R2','R3'].every(n=>['R1','R2','R3'].filter(other=>other!==n).every(other=>m==='reachability'&&other==='R3'?none(s,n,lo(other),32):route(s,n,lo(other),32,'O',110,n==='R1'?'10.0.12.2':n==='R3'?'10.0.23.1':other==='R1'?'10.0.12.1':'10.0.23.2',g(n==='R2'&&other==='R3'?2:1))))&&names.every(n=>!get(s,n).runtime.routes.some(r=>r.protocol.startsWith('O')&&(['192.168.10.0','192.168.40.0','172.16.34.0'].includes(r.network))));
}
function sessions(s:Simulator,m:Mode='ready'){
 return names.every(n=>expectedPeers(n,m).every(([address,,source])=>{const row=(get(s,n).runtime.features.bgpSessions??[]).find((p:any)=>!p.vrf&&p.family===4&&p.neighbor===address),internal=address.startsWith('10.'),other=internal?'R'+address.at(-1):n==='R3'?'R4':'R3',down=m==='source'&&[n,other].includes('R1')&&[n,other].includes('R3')||m==='reachability'&&internal&&[n,other].includes('R3');if(down)return !!row&&row.state!=='ESTABLISHED';return row?.state==='ESTABLISHED'&&!!row.channelId&&row.negotiatedHold===180&&row.negotiatedFamilies?.includes(4)&&row.stats?.received?.OPEN>0&&row.stats?.received?.KEEPALIVE>0&&row.transport?.localAddress===(internal?lo(n):n==='R3'?'172.16.34.1':'172.16.34.2')&&[row.transport.localPort,row.transport.peerPort].includes(179)&&(!internal||source==='Loopback0');}));
}
const bgpRows=(s:Simulator,n:string,network:string)=>(get(s,n).runtime.features.bgpPaths??[]).filter((r:any)=>!r.vrf&&r.network===network&&r.prefix===24);
function path(s:Simulator,n:string,net:string,hop:string,peer:string,asPath:number[],reflection=false){const rows=bgpRows(s,n,net);return rows.length===1&&rows.every((r:any)=>r.best&&r.reachable!==false&&r.nextHop===hop&&[id(peer),peer==='R4'?'172.16.34.2':n==='R4'?'172.16.34.1':lo(peer)].includes(r.from)&&eq(r.asPath,asPath)&&r.learnedVia===(n==='R4'||n==='R3'&&net==='192.168.40.0'?'ebgp':'ibgp')&&r.localPreference===100&&r.weight===0&&(r.med??0)===0&&r.originCode==='i'&&r.originatorId===(reflection?net==='192.168.40.0'?'3.3.3.3':'1.1.1.1':undefined)&&eq(r.clusterList??[],reflection?['2.2.2.2']:[]));}
function paths(s:Simulator,m:Mode='ready'){
 const service='192.168.40.0',core='192.168.10.0';
 if(!path(s,'R2',core,lo('R1'),'R1',[]))return false;
 if(m==='origin'){if(!['R1','R2','R3','R4'].every(n=>bgpRows(s,n,service).length===0))return false;}
 else if(!path(s,'R3',service,'172.16.34.2','R4',[65100]))return false;
 for(const n of ['R1','R2']){
  if(unresolved(m)){const rows=bgpRows(s,n,service);if(rows.length!==1||rows[0].reachable!==false||rows[0].best||rows[0].nextHop!=='172.16.34.2'||!eq(rows[0].asPath,[65100]))return false;}
  else if(m==='origin'||m==='reachability'||n==='R1'&&isolated(m)){if(bgpRows(s,n,service).length)return false;}
  else if(!path(s,n,service,lo('R3'),m==='reflector'&&n==='R1'?'R2':'R3',[65100],m==='reflector'&&n==='R1'))return false;
 }
 if(isolated(m))return bgpRows(s,'R3',core).length===0&&bgpRows(s,'R4',core).length===0;
 if(!path(s,'R3',core,lo('R1'),m==='reflector'?'R2':'R1',[],m==='reflector')||!path(s,'R4',core,'172.16.34.1','R3',[65000]))return false;
 const sent=get(s,'R2').runtime.features.bgpAdjRibOut??{},reflected=(address:string,network:string)=>(sent[address]??[]).some((r:any)=>r.network===network&&eq(r.clusterList,['2.2.2.2']));
 return m==='reflector'?reflected(lo('R1'),service)&&reflected(lo('R3'),core):!(sent[lo('R1')]??[]).some((r:any)=>r.network===service)&&!(sent[lo('R3')]??[]).some((r:any)=>r.network===core);
}
function routes(s:Simulator,m:Mode='ready'){
 const service='192.168.40.0',core='192.168.10.0',success=m==='ready'||m==='reflector';
 return (success?route(s,'R1',service,24,'B',200,lo('R3'),g(1)):none(s,'R1',service))&&(m==='origin'||m==='reachability'||unresolved(m)?none(s,'R2',service):route(s,'R2',service,24,'B',200,lo('R3'),g(2)))&&(m==='origin'?none(s,'R3',service):route(s,'R3',service,24,'B',20,'172.16.34.2',g(2)))&&route(s,'R2',core,24,'B',200,lo('R1'),g(1))&&(isolated(m)?none(s,'R3',core)&&none(s,'R4',core):route(s,'R3',core,24,'B',200,lo('R1'),g(1))&&route(s,'R4',core,24,'B',20,'172.16.34.1',g(1)));
}
const state=(s:Simulator,m:Mode='ready')=>base(s)&&policy(s,m)&&underlay(s,m)&&sessions(s,m)&&paths(s,m)&&routes(s,m);
function healthy(s:Simulator){const h=get(s,'SRV1').config.services.http;return state(s)&&h?.enabled&&(h.port??80)===80&&(h.authentication??'none')==='none'&&!!h.content?.includes('iBGP: internal routing restored');}

type Attempt={lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};
const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator){let a=attempts.get(s);if(!a||a.lab!==s.lab){a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);const current=a,off=s.subscribe(()=>{if(s.lab!==current.lab){off();return;}if(shape(s))refresh(s,current);});}return a;}
function since(s:Simulator,a:Attempt,key:string,ok:boolean){if(!ok){a.epochs.delete(key);return;}const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),names.map(n=>get(s,n).runtime.routes.filter(r=>r.protocol.startsWith('O')||r.protocol==='B').map(r=>[r.network,r.prefix,r.interface,r.metric,r.nextHop,r.ad]))]),old=a.epochs.get(key);if(!old||old.signature!==signature){a.epochs.set(key,{signature,since:s.clock.now()});return s.clock.now();}return old.since;}
// A reply must correlate to an actual request accepted by its destination; failed
// probes need an actual No route event, rather than an untouched receive counter.
function proof(s:Simulator,at:number,control:boolean,reverse:boolean,success=true){
 const from=control?(reverse?'R2':'PC2'):(reverse?'SRV1':'PC1'),to=control?(reverse?'PC2':'R2'):(reverse?'PC1':'SRV1');
 const source=control?(reverse?'192.168.20.1':hosts.PC2):(reverse?hosts.SRV1:hosts.PC1),target=control?(reverse?hosts.PC2:'192.168.20.1'):(reverse?hosts.PC1:hosts.SRV1);
 const path:[string,string][]=control?(reverse?[['R2',g(0)]]:[]):reverse?[['R4',g(1)],['R3',g(1)],['R2',g(1)],['R1',g(0)]]:[['R1',g(1)],['R2',g(2)],['R3',g(2)],['R4',g(0)]];const ids=new Set<string>();
 for(const e of s.events){const p=e.packet;if(e.time<=at||e.nodeId!==id(from)||e.label!=='Frame sent'||p?.protocol!=='ICMP'||p.ipVersion!==4||p.messageType!=='echo-request'||p.source!==source||p.destination!==target)continue;const req=p.id,replies=s.events.filter(x=>x.time>at&&x.nodeId===id(from)&&x.label==='Echo reply received'&&x.packet?.parentId===req&&x.packet.source===target&&x.packet.destination===source);
  if(success){if(!replies.length||!s.events.some(x=>x.time>at&&x.nodeId===id(to)&&x.label==='Echo request accepted'&&x.packet?.id===req)||!path.every(([n,port])=>s.events.some(x=>x.time>at&&x.nodeId===id(n)&&x.port===port&&x.label==='Frame sent'&&x.packet?.id===req)))continue;}
  else if(replies.length||!s.events.some(x=>x.time>at&&names.some(n=>x.nodeId===id(n))&&x.label==='No route'&&x.disposition==='drop'&&(x.packet?.id===req||x.packet?.parentId===req&&x.packet.messageType==='echo-reply')))continue;ids.add(req);
 }return ids.size>=3;
}
const all=(s:Simulator,at:number,failed=false)=>[false,true].every(control=>[false,true].every(reverse=>proof(s,at,control,reverse,!failed||control)));
function web(s:Simulator,at:number){return Object.entries<any>(get(s,'PC1').runtime.features.tcpConnections??{}).some(([t,c])=>{if(c.remoteAddress!==hosts.SRV1||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;const r=get(s,'SRV1').runtime.features.tcpConnections?.[t];if(r?.source!==hosts.PC1||r.response?.statusCode!==200)return false;try{const b=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));if(b.statusCode!==200||b.content!==r.response.content||!b.content.includes('iBGP: internal routing restored'))return false;}catch{return false;}return ['R1','R2','R3','R4'].every(n=>s.events.some(e=>e.time>at&&e.nodeId===id(n)&&e.label==='Frame sent'&&e.packet?.serviceTransaction===t&&e.packet.source===hosts.PC1));});}
function refresh(s:Simulator,a:Attempt){
 if(a.earned.size===observed.length)return;if(!a.earned.has('diagnose')){const at=since(s,a,'initial',state(s,'initial'));if(at!==undefined&&all(s,at,true))a.earned.add('diagnose');}
 if(a.earned.has('traffic'))for(const m of faults){if(a.earned.has(m))continue;const at=since(s,a,m,state(s,m));if(at!==undefined&&all(s,at,m!=='reflector'))a.marks.set(m,s.clock.now());}
 const at=since(s,a,'ready',healthy(s));if(at===undefined)return;if(all(s,at)){a.earned.add('traffic');for(const key of faults){const mark=a.marks.get(key);if(mark!==undefined&&at>=mark)a.earned.add(key);}}if(web(s,at))a.earned.add('http');
}
export function matchesIBGPTroubleshootingCriterion(s:Simulator,d:Device,c:IBGPTroubleshootingCriterion):boolean{
 if(!validIBGPTroubleshootingCriterion(c)||d.id!==c.device||d.id!==id('R1')||!shape(s))return false;if(c.kind==='ibt-observe'){const a=attempt(s);if(!a.earned.has(c.check))refresh(s,a);return a.earned.has(c.check);}
 switch(c.check){case'policy':return base(s)&&policy(s);case'underlay':return base(s)&&policy(s)&&underlay(s);case'sessions':return base(s)&&policy(s)&&underlay(s)&&sessions(s);case'paths':return state(s)&&paths(s);case'routes':return state(s)&&routes(s);case'healthy':return healthy(s);case'saved':return healthy(s)&&names.every(n=>eq(get(s,n).config,get(s,n).startupConfig));}
}
