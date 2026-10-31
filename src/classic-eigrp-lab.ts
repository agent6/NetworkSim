import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
export const classicEIGRPLabId = (name: string) => 'device-ce-' + name.toLowerCase();
const live = ['process', 'neighbors', 'routes', 'healthy', 'saved'] as const;
const observed = ['diagnose', 'traffic', 'http', 'passive', 'network', 'kvalue', 'filter', 'metric'] as const;
type Observed = typeof observed[number];
type Fault = 'initial' | 'passive' | 'network' | 'kvalue' | 'filter' | 'metric' | 'normal';
export type ClassicEIGRPCriterion = {kind: 'ce-live'; device: string; check: typeof live[number]} | {kind: 'ce-observe'; device: string; check: Observed};
export function validClassicEIGRPCriterion(c: any) {
  return !!c && typeof c.device === 'string' && c.device.length > 0 && c.device.length <= 128 &&
    (c.kind === 'ce-live' ? (live as readonly string[]).includes(c.check) : c.kind === 'ce-observe' && (observed as readonly string[]).includes(c.check));
}
const id = classicEIGRPLabId, g = (n: number) => 'GigabitEthernet0/' + n, names = ['R1', 'R2', 'R3'], client = '192.168.10.10', server = '192.168.30.10', control = '198.51.100.2';
const get = (s: Simulator, n: string) => s.getDevice(id(n))!, eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function shape(s: Simulator) {
  return s.lab.devices.length === 5 && names.every(n => get(s, n)?.kind === 'router' && [0, 1, 2].every(i => !!get(s, n)?.config.interfaces[g(i)])) && get(s, 'PC1')?.kind === 'pc' && get(s, 'SRV1')?.kind === 'server' && ['PC1','SRV1'].every(n => !!get(s,n)?.config.interfaces.GigabitEthernet0);
}
function base(s: Simulator, fault: Fault = 'normal') {
  const pair = (a: string, ap: string, b: string, bp: string) => [id(a) + ':' + ap, id(b) + ':' + bp].sort().join('|');
  const expected = [pair('PC1', 'GigabitEthernet0', 'R1', g(0)), pair('R1', g(1), 'R2', g(1)), pair('R2', g(2), 'R3', g(1)), pair('R1', g(2), 'R3', g(2)), pair('R3', g(0), 'SRV1', 'GigabitEthernet0')].sort();
  const ports: [string, number, string][] = [['R1',0,'192.168.10.1'],['R1',1,'10.0.12.1'],['R1',2,'10.0.13.1'],['R2',1,'10.0.12.2'],['R2',2,'10.0.23.1'],['R3',1,'10.0.23.2'],['R3',2,'10.0.13.2'],['R3',0,'192.168.30.1']];
  return s.lab.links.length === 5 && s.lab.links.every(l => l.enabled && !l.loss) && eq(s.lab.links.map(l => [l.a.deviceId + ':' + l.a.port, l.b.deviceId + ':' + l.b.port].sort().join('|')).sort(), expected) &&
    s.lab.devices.every(d => d.powered && !d.config.staticRoutes.length && !Object.keys(d.config.features.vrfs ?? {}).length && !Object.keys(d.config.features.routeMaps ?? {}).length && !Object.keys(d.config.features.acls ?? {}).length && !d.config.features.localPolicy && Object.values(d.config.interfaces).every(p => !p.vrf && !p.features.aclIn && !p.features.aclOut && !p.features.routeMap && !p.features.servicePolicyIn && !p.features.servicePolicyOut && !(p.features.eigrp?.summaries ?? []).length && !p.features.eigrp?.authenticationMode)) &&
    ports.every(([n, i, ip]) => {const d = get(s, n), p = d.config.interfaces[g(i)]; return p.ip === ip && p.mask === (ip.startsWith('10.') ? '255.255.255.252' : '255.255.255.0') && p.adminUp && !p.switchport && p.features.bandwidth === 1000000 && p.features.delay === (i === 2 && n !== 'R2' ? fault === 'metric' && n === 'R1' ? 15 : 1000 : 10) && s.interfaceUp(d.id, p.name);}) &&
    names.every(n => get(s,n).config.ipRouting) && (() => {const d=get(s,'R2'),p=d.config.interfaces.Loopback0;return !!p&&p.ip===control&&p.mask==='255.255.255.255'&&p.adminUp&&s.interfaceUp(d.id,p.name);})() &&
    ['PC1','SRV1'].every((n,i) => {const d=get(s,n),p=d.config.interfaces.GigabitEthernet0;return p.adminUp&&!p.features.dhcp&&p.ip===(i?server:client)&&p.mask==='255.255.255.0'&&d.config.defaultGateway===`192.168.${i?30:10}.1`;});
}
function policy(s: Simulator, fault: Fault = 'normal') {
  const prefix = get(s,'R1').config.features.prefixLists ?? {};
  if (fault === 'filter' ? !eq(prefix, {'CE-SERVICE':[{sequence:5,action:'deny',network:'192.168.30.0',prefix:24},{sequence:10,action:'permit',network:'0.0.0.0',prefix:0,le:32}]}) : Object.keys(prefix).length > 0) return false;
  return names.every((n,i) => {
    const d=get(s,n),p=d.config.protocols.eigrp,wanted=i===0?['10.0.12.0/30','10.0.13.0/30','192.168.10.0/24']:i===1?['10.0.12.0/30','10.0.23.0/30','198.51.100.2/32']:['10.0.13.0/30','10.0.23.0/30',...(fault==='network'?[]:['192.168.30.0/24'])];
    return eq(Object.keys(d.config.protocols),['eigrp']) && p?.asn===(fault==='initial'&&n==='R3'?200:100) && !p.name && p.routerId===`${i+1}.${i+1}.${i+1}.${i+1}` && p.autoSummary===false &&
      eq((p.networks??[]).map((x:any)=>x.network+'/'+x.prefix).sort(),wanted) && eq([...(p.passiveInterfaces??[])].sort(),fault==='passive'&&n==='R1'?[g(1),'default']:['default']) && eq([...(p.activeInterfaces??[])].sort(),fault==='passive'&&n==='R1'?[g(2)]:[g(1),g(2)]) &&
      eq(p.metricWeights??[1,0,1,0,0],fault==='kvalue'&&n==='R3'?[1,0,0,0,0]:[1,0,1,0,0]) && !(p.redistribute??[]).length && !p.defaultOriginate && !p.distance && !p.stub && !p.variance && !p.maximumPaths && !Object.keys(p.summaryMetrics??{}).length && !(p.offsetLists??[]).length &&
      eq(p.distributeLists??[],fault==='filter'&&n==='R1'?[{prefixList:'CE-SERVICE',direction:'in'}]:[]) && (n==='R1'||!Object.keys(d.config.features.prefixLists??{}).length);
  });
}
const up = (s:Simulator,n:string) => get(s,n).runtime.neighbors.filter(a=>a.protocol==='EIGRP'&&a.state==='UP');
function peers(s:Simulator,fault:Fault='normal') {
  return names.every(n=>{
    const expected: [string,number][] = n==='R1'?[['R2',1],['R3',2]]:n==='R2'?[['R1',1],['R3',2]]:[['R2',1],['R1',2]];
    const wanted=expected.filter(([p])=>!(['initial','kvalue'].includes(fault)&&(n==='R3'||p==='R3'))&&!(fault==='passive'&&[n,p].sort().join(',')==='R1,R2'));
    return up(s,n).length===wanted.length&&wanted.every(([p,port])=>up(s,n).some(a=>a.deviceId===id(p)&&a.interface===g(port)));
  });
}
const learned = (s:Simulator,n:string,network:string) => get(s,n).runtime.routes.filter(r=>r.network===network&&r.prefix===24&&r.protocol==='D'&&!r.vrf);
function route(s:Simulator,n:string,network:string,hop:string,port:number,metric:number) {const r=learned(s,n,network),c=s.cefLookup(id(n),network==='192.168.10.0'?client:server);return r.length===1&&r[0].ad===90&&r[0].metric===metric&&r[0].nextHop===hop&&r[0].interface===g(port)&&c?.port===g(port)&&c.target===hop&&c.route.protocol==='D';}
function routes(s:Simulator) {
  return route(s,'R1','192.168.30.0','10.0.12.2',1,10240)&&route(s,'R3','192.168.10.0','10.0.23.1',1,10240)&&route(s,'R2','192.168.30.0','10.0.23.2',2,7680)&&route(s,'R2','192.168.10.0','10.0.12.1',1,7680);
}
function healthy(s:Simulator) {const h=get(s,'SRV1').config.services.http;return base(s)&&policy(s)&&peers(s)&&routes(s)&&h?.enabled&&(h.port??80)===80&&(h.authentication??'none')==='none'&&!!h.content?.includes('Classic EIGRP: service restored');}
type Attempt = {lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};
const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator) {
  let a=attempts.get(s);if(!a||a.lab!==s.lab){a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);const current=a,off=s.subscribe(()=>{if(s.lab!==current.lab){off();return;}if(shape(s))for(const check of observed)matchesClassicEIGRPCriterion(s,get(s,'R1'),{kind:'ce-observe',device:id('R1'),check});});}return a;
}
function since(s:Simulator,key:string,ok:boolean) {
  const a=attempt(s);if(!ok){a.epochs.delete(key);return;}
  // Route epochs prevent pre-convergence probes from being credited after a table changes.
  const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),names.map(n=>get(s,n).runtime.routes.filter(r=>r.protocol==='D').map(r=>[r.network,r.prefix,r.interface,r.nextHop,r.metric]))]);
  const old=a.epochs.get(key);if(!old||old.signature!==signature){const v={signature,since:s.clock.now()};a.epochs.set(key,v);return v.since;}return old.since;
}
function traffic(s:Simulator,at:number,direct=false,reverse=false,diagnostic=false) {
  const from=reverse?'SRV1':'PC1',to=diagnostic?'R2':reverse?'PC1':'SRV1',source=reverse?server:client,target=diagnostic?control:reverse?client:server,requests=new Set<string>();
  const path:[string,number][]=diagnostic?[['R1',1]]:reverse?direct?[['R3',2],['R1',0]]:[['R3',1],['R2',1],['R1',0]]:direct?[['R1',2],['R3',0]]:[['R1',1],['R2',2],['R3',0]];
  for(const e of s.events){const p=e.packet;if(e.time<=at||e.nodeId!==id(from)||e.label!=='Echo reply received'||p?.source!==target||p.destination!==source||!p.parentId)continue;const req=p.parentId;
    if(!s.events.some(x=>x.time>at&&x.nodeId===id(to)&&x.label==='Echo request accepted'&&x.packet?.id===req))continue;
    if(!path.every(([n,i])=>s.events.some(x=>x.time>at&&x.nodeId===id(n)&&x.port===g(i)&&x.label==='Frame sent'&&x.packet?.id===req)))continue;
    if(direct&&!diagnostic&&s.events.some(x=>x.time>at&&x.nodeId===id('R2')&&x.label==='Frame sent'&&x.packet?.id===req))continue;
    requests.add(req);
  }return requests.size>=3;
}
function loss(s:Simulator,at:number) {
  const requests=new Set<string>();for(const e of s.events){const p=e.packet;if(e.time<=at||e.nodeId!==id('R1')||e.label!=='No route'||e.disposition!=='drop'||p?.messageType!=='echo-request'||p.source!==client||p.destination!==server)continue;if(!s.events.some(x=>x.time>at&&x.nodeId===id('PC1')&&x.label==='Frame sent'&&x.packet?.id===p.id))continue;if(s.events.some(x=>x.time>at&&x.nodeId===id('SRV1')&&x.label==='Echo request accepted'&&x.packet?.id===p.id))continue;requests.add(p.id);}return requests.size>=3;
}
function web(s:Simulator,at:number) {
  return Object.entries<any>(get(s,'PC1').runtime.features.tcpConnections??{}).some(([t,c])=>{if(c.remoteAddress!==server||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;const r=get(s,'SRV1').runtime.features.tcpConnections?.[t];if(r?.source!==client||r.response?.statusCode!==200)return false;try{const b=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));if(b.statusCode!==200||b.content!==r.response.content||!b.content.includes('Classic EIGRP: service restored'))return false;}catch{return false;}return s.events.some(e=>e.time>at&&e.nodeId===id('R2')&&e.port===g(2)&&e.label==='Frame sent'&&e.packet?.serviceTransaction===t&&e.packet.source===client);});
}
function evaluate(s:Simulator,d:Device,c:ClassicEIGRPCriterion):boolean {
  if(d.id!==id('R1')||!shape(s))return false;
  if(c.kind==='ce-live')switch(c.check){case'process':return base(s)&&policy(s);case'neighbors':return base(s)&&policy(s)&&peers(s);case'routes':return base(s)&&policy(s)&&peers(s)&&routes(s);case'healthy':return healthy(s);case'saved':return healthy(s)&&names.every(n=>eq(get(s,n).config,get(s,n).startupConfig));}
  const a=attempt(s),ready=a.earned.has('traffic');
  const state=(f:Fault)=>base(s,f)&&policy(s,f)&&peers(s,f);
  const track=(f:Fault,ok:boolean,proof:(at:number)=>boolean)=>{const at=since(s,f,ok);if(at!==undefined&&proof(at))a.marks.set(f,s.clock.now());return at;};
  const initial=since(s,'initial',state('initial')&&!s.cefLookup(id('R1'),server)&&!s.cefLookup(id('R2'),server));
  track('passive',ready&&state('passive')&&route(s,'R1','192.168.30.0','10.0.13.2',2,261120),at=>traffic(s,at,true));
  for(const f of ['network','kvalue','filter'] as const)track(f,ready&&state(f)&&!s.cefLookup(id('R1'),server)&&(f==='filter'?learned(s,'R2','192.168.30.0').length===1:!s.cefLookup(id('R2'),server)),at=>loss(s,at)&&traffic(s,at,false,false,true));
  track('metric',ready&&state('metric')&&route(s,'R1','192.168.30.0','10.0.13.2',2,8960),at=>traffic(s,at,true));
  const at=since(s,'normal',healthy(s));
  if(c.check==='diagnose')return initial!==undefined&&loss(s,initial)&&traffic(s,initial,false,false,true);
  if(at===undefined)return false;
  if(c.check==='traffic')return traffic(s,at)&&traffic(s,at,false,true);
  if(c.check==='http')return web(s,at);
  const mark=a.marks.get(c.check);return mark!==undefined&&at>=mark&&traffic(s,Math.max(at,mark))&&traffic(s,Math.max(at,mark),false,true);
}
export function matchesClassicEIGRPCriterion(s:Simulator,d:Device,c:ClassicEIGRPCriterion):boolean {
  if(!validClassicEIGRPCriterion(c)||d.id!==c.device||!shape(s))return false;if(c.kind==='ce-live')return evaluate(s,d,c);const a=attempt(s);if(a.earned.has(c.check))return true;if(evaluate(s,d,c))a.earned.add(c.check);return a.earned.has(c.check);
}
