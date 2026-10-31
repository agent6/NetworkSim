import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';

export const eigrpNeighborAuthLabId = (name:string) => 'device-ena-' + name.toLowerCase();
const live = ['membership','authentication','neighbors','routes','healthy','saved'] as const;
const observed = ['diagnose','traffic','http','secret','keyid','binding','passive','kvalue'] as const;
type Observed = typeof observed[number];
type Fault = 'normal'|'initial'|'secret'|'keyid'|'binding'|'passive'|'kvalue';
export type EIGRPNeighborAuthCriterion =
  {kind:'ena-live';device:string;check:typeof live[number]} |
  {kind:'ena-observe';device:string;check:Observed};
export function validEIGRPNeighborAuthCriterion(c:any) {
  return !!c && typeof c.device==='string' && c.device.length>0 && c.device.length<=128 &&
    (c.kind==='ena-live' ? (live as readonly string[]).includes(c.check) :
      c.kind==='ena-observe' && (observed as readonly string[]).includes(c.check));
}
const id=eigrpNeighborAuthLabId, g=(n:number)=>'GigabitEthernet0/'+n;
const names=['R1','R2','R3'], chains=['EDGE-A','TRANSIT','EDGE-C'];
const client='192.168.10.10',server='192.168.30.10',control='198.51.100.2';
const get=(s:Simulator,n:string)=>s.getDevice(id(n))!;
const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const transits=(n:string)=>n==='R2'?[g(1),g(2)]:[g(1)];
function shape(s:Simulator) {
  return s.lab.devices.length===5 && names.every(n=>get(s,n)?.kind==='router' &&
    [0,1,2].every(i=>!!get(s,n)?.config.interfaces[g(i)])) &&
    get(s,'PC1')?.kind==='pc' && get(s,'SRV1')?.kind==='server' &&
    ['PC1','SRV1'].every(n=>!!get(s,n)?.config.interfaces.GigabitEthernet0);
}
function base(s:Simulator) {
  const pair=(a:string,ap:string,b:string,bp:string)=>[id(a)+':'+ap,id(b)+':'+bp].sort().join('|');
  const expected=[pair('PC1','GigabitEthernet0','R1',g(0)),pair('R1',g(1),'R2',g(1)),
    pair('R2',g(2),'R3',g(1)),pair('R3',g(0),'SRV1','GigabitEthernet0')].sort();
  const ports:[string,number,string][]=[['R1',0,'192.168.10.1'],['R1',1,'10.0.12.1'],
    ['R2',1,'10.0.12.2'],['R2',2,'10.0.23.1'],['R3',1,'10.0.23.2'],['R3',0,'192.168.30.1']];
  return s.lab.links.length===4 && s.lab.links.every(l=>l.enabled&&!l.loss) &&
    eq(s.lab.links.map(l=>[l.a.deviceId+':'+l.a.port,l.b.deviceId+':'+l.b.port].sort().join('|')).sort(),expected) &&
    s.lab.devices.every(d=>d.powered&&!d.config.staticRoutes.length &&
      !Object.keys(d.config.features.vrfs??{}).length && !Object.keys(d.config.features.routeMaps??{}).length &&
      !Object.keys(d.config.features.acls??{}).length && !Object.keys(d.config.features.prefixLists??{}).length &&
      !d.config.features.localPolicy && Object.values(d.config.interfaces).every(p=>!p.vrf &&
        !p.features.aclIn&&!p.features.aclOut&&!p.features.routeMap&&!p.features.servicePolicyIn &&
        !p.features.servicePolicyOut&&!(p.features.eigrp?.summaries??[]).length)) &&
    names.every(n=>get(s,n).config.ipRouting) && ports.every(([n,i,ip])=>{
      const d=get(s,n),p=d.config.interfaces[g(i)];
      return p.ip===ip && p.mask===(ip.startsWith('10.')?'255.255.255.252':'255.255.255.0') &&
        p.adminUp&&!p.switchport && p.features.bandwidth===1000000 && p.features.delay===10 && s.interfaceUp(d.id,p.name);
    }) && (()=>{const d=get(s,'R2'),p=d.config.interfaces.Loopback0;return !!p &&
      p.ip===control&&p.mask==='255.255.255.255'&&p.adminUp&&s.interfaceUp(d.id,p.name);})() &&
    ['PC1','SRV1'].every((n,i)=>{const d=get(s,n),p=d.config.interfaces.GigabitEthernet0;
      return p.adminUp&&!p.features.dhcp && p.ip===(i?server:client) &&
        p.mask==='255.255.255.0'&&d.config.defaultGateway===`192.168.${i?30:10}.1`;
    });
}
function membership(s:Simulator,fault:Fault='normal') {
  return names.every((n,i)=>{
    const p=get(s,n).config.protocols.eigrp;
    const wanted=i===0?['10.0.12.0/30','192.168.10.0/24']:i===1?
      ['10.0.12.0/30','10.0.23.0/30','198.51.100.2/32']:['10.0.23.0/30','192.168.30.0/24'];
    const passive=n==='R3'&&(fault==='initial'||fault==='passive');
    return eq(Object.keys(get(s,n).config.protocols),['eigrp']) && p?.asn===100 && !p.name &&
      p.enabled!==false && p.routerId===`${i+1}.${i+1}.${i+1}.${i+1}` && p.autoSummary===false &&
      eq((p.networks??[]).map((v:any)=>v.network+'/'+v.prefix).sort(),wanted) &&
      eq([...(p.passiveInterfaces??[])].sort(),passive?[g(1),'default']:['default']) &&
      eq([...(p.activeInterfaces??[])].sort(),passive?[]:transits(n)) &&
      eq(p.metricWeights??[1,0,1,0,0],n==='R3'&&fault==='kvalue'?[1,0,0,0,0]:[1,0,1,0,0]) &&
      !(p.redistribute??[]).length&&!p.defaultOriginate&&!p.distance&&!p.stub&&!p.variance&&!p.maximumPaths &&
      !Object.keys(p.summaryMetrics??{}).length&&!(p.offsetLists??[]).length&&!(p.distributeLists??[]).length;
  });
}
function authentication(s:Simulator,fault:Fault='normal') {
  return names.every((n,i)=>{
    const d=get(s,n),chain=chains[i],key=n==='R3'&&fault==='keyid'?'9':'7';
    const secret=n==='R3'&&(fault==='initial'||fault==='secret')?'WrongAuth7':'EnarsiAuth7';
    if(!eq(d.config.features.keychains,{[chain]:{keys:{[key]:{keyString:secret}}}}))return false;
    return Object.values(d.config.interfaces).every(p=>{
      const f=p.features.eigrp??{};
      return transits(n).includes(p.name)? f.authenticationMode==='md5' &&
        f.authenticationKeyChain===(n==='R3'&&fault==='binding'?'MISSING':chain) :
        !f.authenticationMode&&!f.authenticationKeyChain;
    });
  });
}
function peers(s:Simulator,broken=false) {
  return names.every(n=>{
    const expected:[string,number][]=n==='R1'?[['R2',1]]:n==='R2'?[['R1',1],['R3',2]]:[['R2',1]];
    const wanted=expected.filter(([p])=>!broken || n!=='R3'&&p!=='R3');
    const rows=get(s,n).runtime.neighbors.filter(a=>a.protocol==='EIGRP'&&a.state==='UP');
    return rows.length===wanted.length&&wanted.every(([p,i])=>rows.some(a=>a.deviceId===id(p)&&a.interface===g(i)));
  });
}
function routes(s:Simulator) {
  return [['R1','192.168.30.0','10.0.12.2',1,10240],['R2','192.168.30.0','10.0.23.2',2,7680],
    ['R2','192.168.10.0','10.0.12.1',1,7680],['R3','192.168.10.0','10.0.23.1',1,10240]].every(([n,net,hop,i,metric])=>{
      const d=get(s,String(n)),rows=d.runtime.routes.filter(r=>r.network===net&&r.prefix===24&&r.protocol==='D'&&!r.vrf);
      const c=s.cefLookup(d.id,net==='192.168.10.0'?client:server);
      return rows.length===1&&rows[0].ad===90&&rows[0].metric===metric&&rows[0].nextHop===hop &&
        rows[0].interface===g(Number(i))&&c?.port===g(Number(i))&&c.target===hop&&c.route.protocol==='D';
    });
}
function healthy(s:Simulator) {
  const h=get(s,'SRV1').config.services.http;
  return base(s)&&membership(s)&&authentication(s)&&peers(s)&&routes(s)&&h?.enabled &&
    (h.port??80)===80&&(h.authentication??'none')==='none' &&
    !!h.content?.includes('EIGRP authentication: service restored');
}
type Attempt={lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};
const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator) {
  let a=attempts.get(s);
  if(!a||a.lab!==s.lab){
    a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);
    const current=a,off=s.subscribe(()=>{
      if(s.lab!==current.lab){off();return;}
      if(shape(s))for(const check of observed)matchesEIGRPNeighborAuthCriterion(s,get(s,'R1'),{kind:'ena-observe',device:id('R1'),check});
    });
  }
  return a;
}
function since(s:Simulator,key:string,ok:boolean) {
  const a=attempt(s);if(!ok){a.epochs.delete(key);return;}
  const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),names.map(n=>
    get(s,n).runtime.routes.filter(r=>r.protocol==='D').map(r=>[r.network,r.prefix,r.interface,r.nextHop,r.metric]))]);
  const old=a.epochs.get(key);
  if(!old||old.signature!==signature){const value={signature,since:s.clock.now()};a.epochs.set(key,value);return value.since;}
  return old.since;
}
function traffic(s:Simulator,at:number,reverse=false,diagnostic=false) {
  const from=reverse?'SRV1':'PC1',to=diagnostic?'R2':reverse?'PC1':'SRV1';
  const source=reverse?server:client,target=diagnostic?control:reverse?client:server;
  const path:[string,number][]=diagnostic?[['R1',1]]:reverse?[['R3',1],['R2',1],['R1',0]]:[['R1',1],['R2',2],['R3',0]];
  const requests=new Set<string>();
  for(const e of s.events){
    const p=e.packet;
    if(e.time<=at||e.nodeId!==id(from)||e.label!=='Echo reply received'||p?.source!==target||p.destination!==source||!p.parentId)continue;
    const req=p.parentId;
    if(!s.events.some(x=>x.time>at&&x.nodeId===id(to)&&x.label==='Echo request accepted'&&x.packet?.id===req))continue;
    if(!path.every(([n,i])=>s.events.some(x=>x.time>at&&x.nodeId===id(n)&&x.port===g(i)&&x.label==='Frame sent'&&x.packet?.id===req)))continue;
    requests.add(req);
  }
  return requests.size>=3;
}
function loss(s:Simulator,at:number) {
  const requests=new Set<string>();
  for(const e of s.events){const p=e.packet;
    if(e.time<=at||e.nodeId!==id('R1')||e.label!=='No route'||e.disposition!=='drop'||p?.messageType!=='echo-request'||p.source!==client||p.destination!==server)continue;
    if(!s.events.some(x=>x.time>at&&x.nodeId===id('PC1')&&x.label==='Frame sent'&&x.packet?.id===p.id))continue;
    if(s.events.some(x=>x.time>at&&x.nodeId===id('SRV1')&&x.label==='Echo request accepted'&&x.packet?.id===p.id))continue;
    requests.add(p.id);
  }
  return requests.size>=3;
}
function web(s:Simulator,at:number) {
  return Object.entries<any>(get(s,'PC1').runtime.features.tcpConnections??{}).some(([t,c])=>{
    if(c.remoteAddress!==server||c.remotePort!==80||c.payload?.application!=='http'||c.payload.path!=='/'||!Number.isInteger(c.expected)||c.expected<1||c.expected>2048||c.received!==c.expected)return false;
    const r=get(s,'SRV1').runtime.features.tcpConnections?.[t];if(r?.source!==client||r.response?.statusCode!==200)return false;
    try{const b=JSON.parse(Array.from({length:c.expected},(_,i)=>c.segments[i]).join(''));
      if(b.statusCode!==200||b.content!==r.response.content||!b.content.includes('EIGRP authentication: service restored'))return false;
    }catch{return false;}
    return s.events.some(e=>e.time>at&&e.nodeId===id('R2')&&e.port===g(2)&&e.label==='Frame sent'&&e.packet?.serviceTransaction===t&&e.packet.source===client);
  });
}
function evaluate(s:Simulator,c:EIGRPNeighborAuthCriterion):boolean {
  if(c.kind==='ena-live')switch(c.check){
    case'membership':return base(s)&&membership(s);
    case'authentication':return base(s)&&authentication(s);
    case'neighbors':return base(s)&&membership(s)&&authentication(s)&&peers(s);
    case'routes':return base(s)&&membership(s)&&authentication(s)&&peers(s)&&routes(s);
    case'healthy':return healthy(s);
    case'saved':return healthy(s)&&names.every(n=>eq(get(s,n).config,get(s,n).startupConfig));
  }
  const a=attempt(s),ready=a.earned.has('traffic');
  for(const f of ['initial','secret','keyid','binding','passive','kvalue'] as const){
    const at=since(s,f,(f==='initial'||ready)&&base(s)&&membership(s,f)&&authentication(s,f)&&peers(s,true)&&
      !s.cefLookup(id('R1'),server)&&!s.cefLookup(id('R2'),server));
    if(at!==undefined&&loss(s,at)&&traffic(s,at,false,true))a.marks.set(f,s.clock.now());
  }
  if(c.check==='diagnose')return a.marks.has('initial');
  const at=since(s,'normal',healthy(s));if(at===undefined)return false;
  if(c.check==='traffic')return traffic(s,at)&&traffic(s,at,true);
  if(c.check==='http')return web(s,at);
  const mark=a.marks.get(c.check);
  return mark!==undefined&&at>=mark&&traffic(s,Math.max(at,mark))&&traffic(s,Math.max(at,mark),true);
}
export function matchesEIGRPNeighborAuthCriterion(s:Simulator,d:Device,c:EIGRPNeighborAuthCriterion):boolean {
  if(!validEIGRPNeighborAuthCriterion(c)||d.id!==c.device||d.id!==id('R1')||!shape(s))return false;
  if(c.kind==='ena-live')return evaluate(s,c);
  const a=attempt(s);if(a.earned.has(c.check))return true;
  if(evaluate(s,c))a.earned.add(c.check);
  return a.earned.has(c.check);
}
