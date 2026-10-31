import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {ospfShow} from './ios-show-routing.ts';
import {activeIOSOSPFRouterId} from './ospf-router-id.ts';
import {isIPv4,ipToInt} from './ip.ts';

export const ospfVirtualLinkLabId=(name:string)=>'device-ovl-'+name.toLowerCase();
const live=['policy','physical','virtual','routes','database','healthy','saved']as const;
const faults=['peer','reciprocal','timers','key','underlay','backbone']as const;
const observed=['diagnose','traffic','http',...faults]as const;
type Observed=typeof observed[number];type Mode='initial'|'ready'|typeof faults[number];
export type OSPFVirtualLinkCriterion={kind:'ovl-live';device:string;check:typeof live[number]}|{kind:'ovl-observe';device:string;check:Observed};
export function validOSPFVirtualLinkCriterion(c:any){return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='ovl-live'?(live as readonly string[]).includes(c.check):c.kind==='ovl-observe'&&(observed as readonly string[]).includes(c.check));}
const id=ospfVirtualLinkLabId,g=(i:number)=>'GigabitEthernet0/'+i,names=['R1','R2','R3','R4'];
const get=(s:Simulator,n:string)=>s.getDevice(id(n))!,eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const area=(v:unknown)=>typeof v==='string'&&isIPv4(v)?ipToInt(v):Number(v);
const ports:[string,number,string,number,number][]=[['R1',0,'192.168.10.1',0,1],['R1',1,'10.0.12.1',0,10],['R2',1,'10.0.12.2',0,10],['R2',2,'10.0.23.1',10,10],['R2',0,'192.168.20.1',10,1],['R3',1,'10.0.23.2',10,10],['R3',2,'10.0.34.1',20,10],['R4',1,'10.0.34.2',20,10],['R4',0,'192.168.40.1',20,1]];
const edges:[string,number,string,number][]=[['R1',1,'R2',1],['R2',2,'R3',1],['R3',2,'R4',1]],hosts={PC1:'192.168.10.10',PC2:'192.168.20.10',SRV1:'192.168.40.10'};
function shape(s:Simulator){return s.lab.devices.length===7&&names.every(n=>get(s,n)?.kind==='router')&&ports.every(([n,i])=>!!get(s,n)?.config.interfaces[g(i)])&&Object.keys(hosts).every(n=>get(s,n)?.kind===(n==='SRV1'?'server':'pc')&&!!get(s,n)?.config.interfaces.GigabitEthernet0);}
function base(s:Simulator){
 const key=(a:string,ap:string,b:string,bp:string)=>[id(a)+':'+ap,id(b)+':'+bp].sort().join('|');
 const wanted=[...edges.map(([a,ap,b,bp])=>key(a,g(ap),b,g(bp))),key('PC1','GigabitEthernet0','R1',g(0)),key('PC2','GigabitEthernet0','R2',g(0)),key('SRV1','GigabitEthernet0','R4',g(0))].sort();
 return s.lab.links.length===6&&s.lab.links.every(l=>l.enabled&&!l.loss&&!l.lossAB&&!l.lossBA)&&eq(s.lab.links.map(l=>[l.a.deviceId+':'+l.a.port,l.b.deviceId+':'+l.b.port].sort().join('|')).sort(),wanted)&&s.lab.devices.every(d=>d.powered&&!d.config.staticRoutes.length&&!Object.keys(d.config.features.vrfs??{}).length&&!Object.keys(d.config.features.acls??{}).length&&!Object.keys(d.config.features.prefixLists??{}).length&&!Object.keys(d.config.features.routeMaps??{}).length&&!d.config.features.localPolicy&&Object.values(d.config.interfaces).every(p=>!p.vrf&&!p.features.aclIn&&!p.features.aclOut&&!p.features.routeMap&&!p.features.servicePolicyIn&&!p.features.servicePolicyOut))&&names.every(n=>get(s,n).config.ipRouting&&Object.values(get(s,n).config.interfaces).every(p=>!p.ip&&!p.features.ospf?.area||ports.some(([owner,i])=>owner===n&&g(i)===p.name)))&&ports.every(([n,i,ip])=>{const p=get(s,n).config.interfaces[g(i)];return p.ip===ip&&p.mask===(ip.startsWith('10.')?'255.255.255.252':'255.255.255.0')&&!p.switchport&&p.adminUp&&p.mtu===1500&&s.interfaceUp(id(n),g(i));})&&Object.entries(hosts).every(([n,ip])=>{const d=get(s,n),p=d.config.interfaces.GigabitEthernet0;return p.adminUp&&!p.features.dhcp&&p.ip===ip&&p.mask==='255.255.255.0'&&d.config.defaultGateway===ip.replace(/10$/,'1');});
}
function policy(s:Simulator,m:Mode='ready'){
 return names.every(n=>{const d=get(s,n),c=d.config.protocols.ospf,passive=n==='R3'?[]:[g(0)];if(m==='underlay'&&n==='R2')passive.push(g(2));
  if(!eq(Object.keys(d.config.protocols),['ospf'])||!c||c.enabled===false||c.processId!==10||c.routerId!==Array(4).fill(n.slice(1)).join('.')||activeIOSOSPFRouterId(d)!==c.routerId||(c.networks??[]).length||!eq([...(c.passiveInterfaces??[])].sort(),passive.sort())||c.passiveDefault||(c.activeInterfaces??[]).some((p:string)=>p!==g(2)||n!=='R2')||c.defaultOriginate||c.distance||(c.neighbors??[]).length||(c.distributeLists??[]).length||(c.redistribute??[]).length||Object.values<any>(c.areas??{}).some(v=>Object.keys(v).length))return false;
  const expected=(n==='R2'||n==='R3')&&m!=='initial'&&!(n==='R3'&&m==='reciprocal'),links=c.virtualLinks??[];
  if(links.length!==(expected?1:0))return false;
  if(expected){const v=links[0],peer=n==='R2'?(m==='peer'?'10.0.23.2':'3.3.3.3'):'2.2.2.2';if(area(v.transitArea)!==10||v.routerId!==peer||v.authentication!=='message-digest'||!eq(v.messageDigestKeys,{'1':n==='R2'&&m==='key'?'WrongVirtual10':'Virtual10'})||(v.helloInterval??10)!==(n==='R2'&&m==='timers'?5:10)||(v.deadInterval??40)!==40||v.authenticationKey||v.authenticationKeyChain)return false;}
  return ports.filter(([owner])=>owner===n).every(([,i,,a,cost])=>{const f=d.config.interfaces[g(i)].features.ospf??{},inactive=m==='backbone'&&n==='R2'&&i===1;return (inactive?f.processId===undefined&&f.area===undefined:f.processId===10&&area(f.area)===a)&&f.cost===cost&&f.networkType===(cost===10?'point-to-point':undefined)&&(f.helloInterval??10)===10&&(f.deadInterval??40)===40&&!f.authentication&&!f.authenticationKeyChain&&!f.mtuIgnore;});
 });
}
function physical(s:Simulator,m:Mode='ready'){return edges.every(([a,ap,b,bp])=>[[a,ap,b,bp],[b,bp,a,ap]].every(([from,port,to,peer])=>{const down=m==='underlay'&&[from,to].includes('R2')&&[from,to].includes('R3')||m==='backbone'&&[from,to].includes('R1'),rows=ospfLiveDetail(s,id(from as string),'ospf')?.neighbors??[];return down?!rows.some(n=>n.deviceId===id(to as string)&&n.state==='FULL'):rows.some(n=>n.deviceId===id(to as string)&&n.interface===g(port as number)&&n.peerInterface===g(peer as number)&&n.state==='FULL');}));}
function virtual(s:Simulator,m:Mode='ready'){return ['R2','R3'].every(n=>{const rows=get(s,n).runtime.features.ospfVirtualLinks??[],missing=m==='initial'||m==='reciprocal'&&n==='R3';return missing?rows.length===0:rows.length===1&&(m==='backbone'?['UP','DOWN'].includes(rows[0].state):rows[0].state===(m==='ready'?'UP':'DOWN'))&&area(rows[0].transitArea)===10&&(m!=='ready'||rows[0].cost===10&&rows[0].interface===g(n==='R2'?2:1));});}
function route(s:Simulator,n:string,network:string,protocol:string,metric:number,hop:string,i:number){const rows=get(s,n).runtime.routes.filter(r=>r.network===network&&r.prefix===24&&!r.vrf);return rows.length===1&&rows[0].protocol===protocol&&rows[0].ad===110&&rows[0].metric===metric&&rows[0].nextHop===hop&&rows[0].interface===g(i);}
function routes(s:Simulator,m:Mode='ready'){return m==='ready'?route(s,'R1','192.168.40.0','O IA',31,'10.0.12.2',1)&&route(s,'R2','192.168.40.0','O IA',21,'10.0.23.2',2)&&route(s,'R3','192.168.10.0','O',21,'10.0.23.1',1)&&route(s,'R4','192.168.10.0','O IA',31,'10.0.34.1',1):!get(s,'R1').runtime.routes.some(r=>r.network==='192.168.40.0')&&!get(s,'R4').runtime.routes.some(r=>r.network==='192.168.10.0');}
const state=(s:Simulator,m:Mode='ready')=>base(s)&&policy(s,m)&&physical(s,m)&&virtual(s,m)&&routes(s,m);
function database(s:Simulator){return [['R2','192.168.40.0','3.3.3.3'],['R3','192.168.10.0','2.2.2.2']].every(([n,prefix,rid])=>{const text=(ospfShow(s,get(s,n),'ospf','database',['summary',prefix])??[]).join('\n');return text.includes('Link State ID: '+prefix)&&text.includes('Advertising Router: '+rid);});}
function healthy(s:Simulator){const h=get(s,'SRV1').config.services.http;return state(s)&&database(s)&&h?.enabled&&(h.port??80)===80&&(h.authentication??'none')==='none'&&!!h.content?.includes('OSPF virtual link: backbone continuity restored');}

type Attempt={lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};
const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator){let a=attempts.get(s);if(!a||a.lab!==s.lab){a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);const current=a,off=s.subscribe(()=>{if(s.lab!==current.lab){off();return;}if(shape(s))refresh(s,current);});}return a;}
function since(s:Simulator,a:Attempt,key:string,ok:boolean){if(!ok){a.epochs.delete(key);return;}const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),names.map(n=>get(s,n).runtime.routes.filter(r=>r.protocol.startsWith('O')).map(r=>[r.network,r.prefix,r.interface,r.metric]))]),old=a.epochs.get(key);if(!old||old.signature!==signature){a.epochs.set(key,{signature,since:s.clock.now()});return s.clock.now();}return old.since;}
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
function web(s:Simulator,at:number){return Object.entries<any>(get(s,'PC1').runtime.features.tcpConnections??{}).some(([t,c])=>{if(c.remoteAddress!==hosts.SRV1||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;const r=get(s,'SRV1').runtime.features.tcpConnections?.[t];if(r?.source!==hosts.PC1||r.response?.statusCode!==200)return false;try{const b=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));if(b.statusCode!==200||b.content!==r.response.content||!b.content.includes('OSPF virtual link: backbone continuity restored'))return false;}catch{return false;}return ['R1','R2','R3','R4'].every(n=>s.events.some(e=>e.time>at&&e.nodeId===id(n)&&e.label==='Frame sent'&&e.packet?.serviceTransaction===t&&e.packet.source===hosts.PC1));});}
function refresh(s:Simulator,a:Attempt){
 if(a.earned.size===observed.length)return;if(!a.earned.has('diagnose')){const at=since(s,a,'initial',state(s,'initial'));if(at!==undefined&&all(s,at,true))a.earned.add('diagnose');}
 if(a.earned.has('traffic'))for(const m of faults){if(a.earned.has(m))continue;const at=since(s,a,m,state(s,m));if(at!==undefined&&all(s,at,true))a.marks.set(m,s.clock.now());}
 const at=since(s,a,'ready',healthy(s));if(at===undefined)return;if(all(s,at)){a.earned.add('traffic');for(const key of faults){const mark=a.marks.get(key);if(mark!==undefined&&at>=mark)a.earned.add(key);}}if(web(s,at))a.earned.add('http');
}
export function matchesOSPFVirtualLinkCriterion(s:Simulator,d:Device,c:OSPFVirtualLinkCriterion):boolean{
 if(!validOSPFVirtualLinkCriterion(c)||d.id!==c.device||d.id!==id('R2')||!shape(s))return false;if(c.kind==='ovl-observe'){const a=attempt(s);if(!a.earned.has(c.check))refresh(s,a);return a.earned.has(c.check);}
 switch(c.check){case'policy':return base(s)&&policy(s);case'physical':return base(s)&&policy(s)&&physical(s);case'virtual':return base(s)&&policy(s)&&physical(s)&&virtual(s);case'routes':return state(s);case'database':return state(s)&&database(s);case'healthy':return healthy(s);case'saved':return healthy(s)&&names.every(n=>eq(get(s,n).config,get(s,n).startupConfig));}
}
