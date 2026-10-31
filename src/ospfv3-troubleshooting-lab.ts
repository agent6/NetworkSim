import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
export const ospfv3TroubleshootingLabId=(name:string)=>'device-ot3-'+name.toLowerCase();
const live=['policy','neighbors','database','routes','healthy','saved'] as const;
const observed=['diagnose','traffic','http','timers','passive','instance','mtu','advertisement','cost'] as const;
type Observed=typeof observed[number];
type Mode='normal'|'initial'|'timers'|'passive'|'instance'|'mtu'|'advertisement'|'cost';
export type OSPFv3TroubleshootingCriterion={kind:'ot3-live';device:string;check:typeof live[number]}|{kind:'ot3-observe';device:string;check:Observed};
export function validOSPFv3TroubleshootingCriterion(c:any){return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='ot3-live'?(live as readonly string[]).includes(c.check):c.kind==='ot3-observe'&&(observed as readonly string[]).includes(c.check));}
const id=ospfv3TroubleshootingLabId,g=(i:number)=>'GigabitEthernet0/'+i,names=['R1','R2','R3'],get=(s:Simulator,n:string)=>s.getDevice(id(n))!,eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),rid=(n:string)=>n.slice(1)+'.'+n.slice(1)+'.'+n.slice(1)+'.'+n.slice(1);
const server='2001:db8:30::10',clients={PC1:'2001:db8:10::10',PC2:'2001:db8:20::10'};
const backup=(m:Mode)=>['initial','timers','passive','instance','mtu'].includes(m);
function shape(s:Simulator){return s.lab.devices.length===6&&names.every(n=>get(s,n)?.kind==='router'&&[0,1,2].every(i=>!!get(s,n)?.config.interfaces[g(i)]))&&['PC1','PC2'].every(n=>get(s,n)?.kind==='pc')&&get(s,'SRV1')?.kind==='server'&&['PC1','PC2','SRV1'].every(n=>!!get(s,n)?.config.interfaces.GigabitEthernet0);}
function base(s:Simulator,mode:Mode='normal'){
 const pair=(a:string,ap:string,b:string,bp:string)=>[id(a)+':'+ap,id(b)+':'+bp].sort().join('|'),expected=[pair('PC1','GigabitEthernet0','R1',g(0)),pair('PC2','GigabitEthernet0','R2',g(0)),pair('SRV1','GigabitEthernet0','R3',g(0)),pair('R1',g(1),'R2',g(1)),pair('R2',g(2),'R3',g(1)),pair('R1',g(2),'R3',g(2))].sort();
 const ports:[string,number,string][]=[['R1',0,'2001:db8:10::1'],['R2',0,'2001:db8:20::1'],['R3',0,'2001:db8:30::1'],['R1',1,'2001:db8:12::1'],['R2',1,'2001:db8:12::2'],['R2',2,'2001:db8:23::1'],['R3',1,'2001:db8:23::2'],['R1',2,'2001:db8:13::1'],['R3',2,'2001:db8:13::2']];
 return s.lab.links.length===6&&s.lab.links.every(l=>l.enabled&&!l.loss)&&eq(s.lab.links.map(l=>[l.a.deviceId+':'+l.a.port,l.b.deviceId+':'+l.b.port].sort().join('|')).sort(),expected)&&
 s.lab.devices.every(d=>d.powered&&(d.kind==='router'?!d.config.staticRoutes.length:true)&&!Object.keys(d.config.features.vrfs??{}).length&&!Object.keys(d.config.features.routeMaps??{}).length&&!Object.keys(d.config.features.acls??{}).length&&!Object.keys(d.config.features.prefixLists??{}).length&&!d.config.features.localPolicy&&Object.values(d.config.interfaces).every(p=>!p.vrf&&!p.features.aclIn&&!p.features.aclOut&&!p.features.routeMap&&!p.features.servicePolicyIn&&!p.features.servicePolicyOut))&&
 names.every(n=>get(s,n).config.ipv6Routing)&&ports.every(([n,i,ip])=>{const d=get(s,n),p=d.config.interfaces[g(i)];return !p.ip&&eq(p.ipv6,[ip+'/64'])&&p.features.ipv6LinkLocal==='fe80::'+n.slice(1)&&(!i?p.features.ipv6Nd?.suppressRa===true:true)&&p.adminUp&&!p.switchport&&p.mtu===(n==='R1'&&i===2&&mode==='mtu'?1400:1500)&&s.interfaceUp(d.id,p.name);})&&
 ['PC1','PC2','SRV1'].every((n,i)=>{const d=get(s,n),p=d.config.interfaces.GigabitEthernet0;return p.adminUp&&!p.features.dhcp&&!p.ip&&!p.features.ipv6Autoconfig&&eq(p.ipv6,[`2001:db8:${(i+1)*10}::10/64`])&&!d.config.defaultGateway&&eq(d.config.staticRoutes,[{network:'::',prefix:0,nextHop:'fe80::'+(i+1),interface:'GigabitEthernet0',ad:1}]);});
}
function policy(s:Simulator,mode:Mode='normal'){
 return names.every(n=>{const d=get(s,n),p=d.config.protocols.ospfv3;if(!eq(Object.keys(d.config.protocols),['ospfv3'])||!p||p.processId!==10||p.enabled===false||p.routerId!==rid(n)||(p.networks??[]).length||!eq([...(p.passiveInterfaces??[])].sort(),[g(0),...(n==='R1'&&mode==='passive'?[g(2)]:[])].sort())||(p.activeInterfaces??[]).some((port:string)=>![g(1),g(2)].includes(port)||n==='R1'&&mode==='passive'&&port===g(2))||(p.redistribute??[]).length||p.distance||p.defaultOriginate||Object.keys(p.areas??{}).length||(p.distributeLists??[]).length)return false;
  return [0,1,2].every(i=>{const f=d.config.interfaces[g(i)].features.ospfv3??{},missing=n==='R3'&&i===0&&mode==='advertisement',cost=i===0?1:n==='R1'&&i===2&&mode==='cost'?30:(n==='R1'||n==='R3')&&i===2?5:10;return (missing?f.processId===undefined:f.processId===10&&String(f.area)===(n==='R1'&&i===2&&mode==='initial'?'1':'0'))&&f.cost===cost&&(!i||f.networkType==='point-to-point')&&(f.instanceId??0)===(n==='R1'&&i===2&&mode==='instance'?1:0)&&!f.authentication&&(f.helloInterval??10)===(n==='R1'&&i===2&&mode==='timers'?5:10)&&(f.deadInterval??40)===(n==='R1'&&i===2&&mode==='timers'?20:40)&&!f.mtuIgnore&&!f.neighbors?.length;});
 });
}
function peers(s:Simulator,mode:Mode='normal'){
 return names.every(n=>{const rows=ospfLiveDetail(s,id(n),'ospfv3')?.neighbors??[],wanted:[string,number][]=n==='R1'?[['R2',1],...(!backup(mode)?[['R3',2] as [string,number]]:[])]:n==='R2'?[['R1',1],['R3',2]]:[['R2',1],...(!backup(mode)?[['R1',2] as [string,number]]:[])],full=rows.filter(r=>r.state==='FULL');
  if(mode==='mtu'&&n==='R3'){if(!full.some(r=>r.deviceId===id('R2')&&r.interface===g(1)))return false;}else if(full.length!==wanted.length||!wanted.every(([peer,i])=>full.some(r=>r.deviceId===id(peer)&&r.interface===g(i))))return false;
  return mode!=='mtu'||n!=='R1'||rows.some(r=>r.deviceId===id('R3')&&r.interface===g(2)&&r.state==='EXSTART');
 });
}
function database(s:Simulator){return names.every(n=>{const lsas=ospfLiveDetail(s,id(n),'ospfv3')?.lsas??[];return names.every((peer,i)=>lsas.some(l=>l.origin.startsWith(id(peer)+'\0')&&l.routerId===rid(peer)&&l.links.length===2&&l.prefixes.some(p=>p.network===`2001:db8:${(i+1)*10}::`&&p.prefix===64&&p.cost===1)));});}
function route(s:Simulator,n:string,network:string,metric:number,hop:string,port:number,present=true){const d=get(s,n),rows=d.runtime.routes.filter(r=>r.network===network&&r.prefix===64&&!r.vrf),c=s.cefLookup(d.id,network);return present?rows.length===1&&rows[0].protocol==='O'&&rows[0].ad===110&&rows[0].metric===metric&&rows[0].nextHop===hop&&rows[0].interface===g(port)&&c?.port===g(port)&&c.target===hop&&c.route.protocol==='O':!rows.length&&!c;}
function routes(s:Simulator,mode:Mode='normal'){
 const indirect=backup(mode)||mode==='cost',missing=mode==='advertisement';return route(s,'R1','2001:db8:30::',indirect?21:6,indirect?'fe80::2':'fe80::3',indirect?1:2,!missing)&&route(s,'R3','2001:db8:10::',backup(mode)?21:6,backup(mode)?'fe80::2':'fe80::1',backup(mode)?1:2)&&route(s,'R2','2001:db8:30::',11,'fe80::3',2,!missing)&&route(s,'R2','2001:db8:10::',11,'fe80::1',1)&&route(s,'R1','2001:db8:20::',11,'fe80::2',1)&&route(s,'R3','2001:db8:20::',11,'fe80::2',1);
}
function state(s:Simulator,mode:Mode='normal'){return base(s,mode)&&policy(s,mode)&&peers(s,mode)&&routes(s,mode);}
function healthy(s:Simulator){const h=get(s,'SRV1').config.services.http;return state(s)&&database(s)&&h?.enabled&&(h.port??80)===80&&(h.authentication??'none')==='none'&&!!h.content?.includes('OSPFv3: service restored');}
type Attempt={lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};
const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator){let a=attempts.get(s);if(!a||a.lab!==s.lab){a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);const current=a,off=s.subscribe(()=>{if(s.lab!==current.lab){off();return;}if(shape(s))refresh(s,current);});}return a;}
function since(s:Simulator,a:Attempt,key:string,ok:boolean){if(!ok){a.epochs.delete(key);return;}const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),names.map(n=>get(s,n).runtime.routes.filter(r=>r.protocol.startsWith('O')).map(r=>[r.network,r.prefix,r.interface,r.metric]))]),old=a.epochs.get(key);if(!old||old.signature!==signature){const v={signature,since:s.clock.now()};a.epochs.set(key,v);return v.since;}return old.since;}
function echo(s:Simulator,at:number,from:string,to:string,source:string,target:string,path:[string,number][]){const ids=new Set<string>();for(const e of s.events){const p=e.packet;if(e.time<=at||e.nodeId!==id(from)||e.label!=='Echo reply received'||p?.protocol!=='ICMPV6'||p.ipVersion!==6||p.source!==target||p.destination!==source||!p.parentId)continue;const request=p.parentId;if(!s.events.some(x=>x.time>at&&x.nodeId===id(to)&&x.label==='Echo request accepted'&&x.packet?.id===request&&x.packet.source===source&&x.packet.destination===target))continue;if(!path.every(([n,i])=>s.events.some(x=>x.time>at&&x.nodeId===id(n)&&x.port===g(i)&&x.label==='Frame sent'&&x.packet?.id===request)))continue;ids.add(request);}return ids.size>=3;}
function traffic(s:Simulator,at:number,who:'PC1'|'PC2'='PC1',reverse=false,mode:Mode='normal'){
 const path:[string,number][]=who==='PC2'?reverse?[['R3',1],['R2',0]]:[['R2',2],['R3',0]]:reverse?backup(mode)?[['R3',1],['R2',1],['R1',0]]:[['R3',2],['R1',0]]:backup(mode)||mode==='cost'?[['R1',1],['R2',2],['R3',0]]:[['R1',2],['R3',0]];
 return echo(s,at,reverse?'SRV1':who,reverse?who:'SRV1',reverse?server:clients[who],reverse?clients[who]:server,path);
}
const all=(s:Simulator,at:number,mode:Mode='normal')=>[false,true].every(reverse=>traffic(s,at,'PC1',reverse,mode)&&traffic(s,at,'PC2',reverse,mode));
function lanControl(s:Simulator,at:number){return echo(s,at,'PC1','PC2',clients.PC1,clients.PC2,[['R1',1],['R2',0]])&&echo(s,at,'PC2','PC1',clients.PC2,clients.PC1,[['R2',1],['R1',0]]);}
function loss(s:Simulator,at:number,who:'PC1'|'PC2'){const ids=new Set<string>(),node=who==='PC1'?'R1':'R2';for(const e of s.events){const p=e.packet;if(e.time<=at||e.nodeId!==id(node)||e.label!=='No route'||e.disposition!=='drop'||p?.messageType!=='echo-request'||p.source!==clients[who]||p.destination!==server)continue;if(s.events.some(x=>x.time>at&&x.nodeId===id(who)&&x.label==='Frame sent'&&x.packet?.id===p.id))ids.add(p.id);}return ids.size>=3;}
function web(s:Simulator,at:number){return Object.entries<any>(get(s,'PC1').runtime.features.tcpConnections??{}).some(([t,c])=>{if(c.remoteAddress!==server||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;const r=get(s,'SRV1').runtime.features.tcpConnections?.[t];if(r?.source!==clients.PC1||r.response?.statusCode!==200)return false;try{const b=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));if(b.statusCode!==200||b.content!==r.response.content||!b.content.includes('OSPFv3: service restored'))return false;}catch{return false;}return s.events.some(e=>e.time>at&&e.nodeId===id('R1')&&e.port===g(2)&&e.label==='Frame sent'&&e.packet?.serviceTransaction===t&&e.packet.source===clients.PC1);});}
function refresh(s:Simulator,a:Attempt){
 if(a.earned.size===observed.length)return;
 if(!a.earned.has('diagnose')){const at=since(s,a,'initial',state(s,'initial'));if(at!==undefined&&all(s,at,'initial'))a.earned.add('diagnose');}
 for(const mode of ['timers','passive','instance','mtu','advertisement','cost'] as const){if(a.earned.has(mode))continue;const at=since(s,a,mode,a.earned.has('traffic')&&state(s,mode));if(at!==undefined&&(mode==='advertisement'?loss(s,at,'PC1')&&loss(s,at,'PC2')&&lanControl(s,at):all(s,at,mode)))a.marks.set(mode,s.clock.now());}
 const normal=since(s,a,'normal',healthy(s));if(normal===undefined)return;
 if(all(s,normal)){a.earned.add('traffic');for(const check of ['timers','passive','instance','mtu','advertisement','cost'] as const){const mark=a.marks.get(check);if(mark!==undefined&&normal>=mark)a.earned.add(check);}}
 if(web(s,normal))a.earned.add('http');
}
export function matchesOSPFv3TroubleshootingCriterion(s:Simulator,d:Device,c:OSPFv3TroubleshootingCriterion):boolean{
 if(!validOSPFv3TroubleshootingCriterion(c)||d.id!==c.device||d.id!==id('R1')||!shape(s))return false;
 if(c.kind==='ot3-observe'){const a=attempt(s);if(!a.earned.has(c.check))refresh(s,a);return a.earned.has(c.check);}
 switch(c.check){case'policy':return base(s)&&policy(s);case'neighbors':return base(s)&&policy(s)&&peers(s);case'database':return base(s)&&policy(s)&&peers(s)&&database(s);case'routes':return state(s);case'healthy':return healthy(s);case'saved':return healthy(s)&&names.every(n=>eq(get(s,n).config,get(s,n).startupConfig));}
}
