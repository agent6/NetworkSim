import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
export const eigrpVRFLabId=(name:string)=>'device-evr-'+name.toLowerCase();
const live=['definitions','policy','neighbors','routes','healthy','saved'] as const;
const observed=['diagnose','traffic','http','isolation','passive','network','binding','filter'] as const;
type Observed=typeof observed[number];type VRF='BLUE'|'RED';
type Mode='normal'|'initial'|'passive'|'network'|'binding'|'filter';
export type EIGRPVRFCriterion={kind:'evr-live';device:string;check:typeof live[number]}|{kind:'evr-observe';device:string;check:Observed};
export function validEIGRPVRFCriterion(c:any){return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='evr-live'?(live as readonly string[]).includes(c.check):c.kind==='evr-observe'&&(observed as readonly string[]).includes(c.check));}
const id=eigrpVRFLabId,g=(n:number)=>'GigabitEthernet0/'+n,get=(s:Simulator,n:string)=>s.getDevice(id(n))!,eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const vrfs:VRF[]=['BLUE','RED'],tag=(v:VRF)=>v==='BLUE'?110:120,sub=(v:VRF)=>g(1)+'.'+tag(v),lan=(v:VRF)=>g(v==='BLUE'?0:2),diag=(v:VRF)=>'198.51.100.'+tag(v),asn=(v:VRF)=>v==='BLUE'?100:200;
const client='192.168.10.10',server='192.168.20.10';
function shape(s:Simulator){return s.lab.devices.length===6&&['PE1','PE2'].every(n=>get(s,n)?.kind==='router'&&[0,1,2].every(i=>!!get(s,n)?.config.interfaces[g(i)]))&&vrfs.every(v=>get(s,'PC-'+v)?.kind==='pc'&&get(s,'SRV-'+v)?.kind==='server'&&['PC-','SRV-'].every(p=>!!get(s,p+v)?.config.interfaces.GigabitEthernet0));}
function base(s:Simulator){
 const pair=(a:string,ap:string,b:string,bp:string)=>[id(a)+':'+ap,id(b)+':'+bp].sort().join('|'),expected=[pair('PC-BLUE','GigabitEthernet0','PE1',g(0)),pair('PC-RED','GigabitEthernet0','PE1',g(2)),pair('PE1',g(1),'PE2',g(1)),pair('PE2',g(0),'SRV-BLUE','GigabitEthernet0'),pair('PE2',g(2),'SRV-RED','GigabitEthernet0')].sort();
 return s.lab.links.length===5&&s.lab.links.every(l=>l.enabled&&!l.loss)&&eq(s.lab.links.map(l=>[l.a.deviceId+':'+l.a.port,l.b.deviceId+':'+l.b.port].sort().join('|')).sort(),expected)&&s.lab.devices.every(d=>d.powered&&!d.config.staticRoutes.length&&!Object.keys(d.config.features.routeMaps??{}).length&&!Object.keys(d.config.features.acls??{}).length&&!d.config.features.localPolicy&&Object.values(d.config.interfaces).every(p=>!p.features.aclIn&&!p.features.aclOut&&!p.features.routeMap&&!p.features.servicePolicyIn&&!p.features.servicePolicyOut&&!(p.features.eigrp?.summaries??[]).length&&!p.features.eigrp?.authenticationMode))&&
 ['PE1','PE2'].every(n=>{const d=get(s,n),p=d.config.interfaces[g(1)],lists=d.config.features.prefixLists??{};return d.config.ipRouting&&eq(Object.keys(d.config.protocols),['eigrp'])&&p.adminUp&&!p.ip&&!p.vrf&&!p.switchport&&s.interfaceUp(d.id,p.name)&&eq(lists,n==='PE1'?{'BLUE-IN':[{sequence:5,action:'deny',network:'192.168.20.0',prefix:24},{sequence:10,action:'permit',network:'0.0.0.0',prefix:0,le:32}]}:{});})&&
 vrfs.every(v=>['PC-','SRV-'].every(prefix=>{const d=get(s,prefix+v),p=d.config.interfaces.GigabitEthernet0,srv=prefix==='SRV-';return p.adminUp&&!p.features.dhcp&&p.ip===(srv?server:client)&&p.mask==='255.255.255.0'&&d.config.defaultGateway===(srv?'192.168.20.1':'192.168.10.1');}));
}
function definitions(s:Simulator){return ['PE1','PE2'].every(n=>{const a=get(s,n).config.features.vrfs??{};return eq(Object.keys(a).sort(),['BLUE','RED'])&&vrfs.every(v=>eq(a[v],{addressFamilies:{ipv4:{}}}));});}
function interfaces(s:Simulator,mode:Mode='normal'){
 return ['PE1','PE2'].every((n,i)=>vrfs.every(v=>{const d=get(s,n),access=d.config.interfaces[lan(v)],p=d.config.interfaces[sub(v)],loop=d.config.interfaces['Loopback'+tag(v)],unbound=mode==='binding'&&n==='PE1'&&v==='BLUE';return access.adminUp&&!access.switchport&&access.vrf===(unbound?undefined:v)&&access.ip===(unbound?undefined:`192.168.${i?20:10}.1`) &&(unbound||access.mask==='255.255.255.0')&&s.interfaceUp(d.id,access.name)&&!!p&&p.adminUp&&!p.switchport&&p.vrf===v&&p.ip===`10.0.0.${i+1}`&&p.mask==='255.255.255.252'&&p.features.dot1q===tag(v)&&!p.features.dot1qNative&&s.interfaceUp(d.id,p.name)&&[access,p].every(p=>p.features.bandwidth===1000000&&p.features.delay===10)&&(!i||!!loop&&loop.adminUp&&loop.vrf===v&&loop.ip===diag(v)&&loop.mask==='255.255.255.255'&&loop.features.bandwidth===1000000&&loop.features.delay===10&&s.interfaceUp(d.id,loop.name));}));
}
function policy(s:Simulator,mode:Mode='normal'){
 return ['PE1','PE2'].every((n,i)=>{const root=get(s,n).config.protocols.eigrp;if(!root||root.name!=='TENANTS'||root.asn!==undefined||(root.networks??[]).length||(root.passiveInterfaces??[]).length||!eq(Object.keys(root.vrfs??{}).sort(),['BLUE','RED']))return false;
  return vrfs.every(v=>{const p=root.vrfs[v],missing=mode==='network'&&n==='PE2'&&v==='BLUE',passive=mode==='passive'&&n==='PE2'&&v==='BLUE',networks=['10.0.0.0/30',...(!missing?[`192.168.${i?20:10}.0/24`]:[]),...(i?[diag(v)+'/32']:[])].sort(),interfaces=[lan(v),...(i?['Loopback'+tag(v)]:[]),...(passive?[sub(v)]:[])].sort();return p.name==='TENANTS'&&p.enabled!==false&&p.asn===(mode==='initial'&&n==='PE2'&&v==='BLUE'?999:asn(v))&&p.routerId===(v==='BLUE'?i?'2.2.2.2':'1.1.1.1':i?'22.22.22.22':'11.11.11.11')&&p.autoSummary===false&&eq((p.networks??[]).map((r:any)=>r.network+'/'+r.prefix).sort(),networks)&&eq([...(p.passiveInterfaces??[])].sort(),interfaces)&&eq([...(p.activeInterfaces??[])].sort(),passive?[]:[sub(v)])&&eq(p.metricWeights??[1,0,1,0,0],[1,0,1,0,0])&&!(p.redistribute??[]).length&&!p.stub&&!p.distance&&(p.variance??1)===1&&(p.maximumPaths??4)===4&&!(p.offsetLists??[]).length&&eq(p.distributeLists??[],mode==='filter'&&n==='PE1'&&v==='BLUE'?[{prefixList:'BLUE-IN',direction:'in',interface:sub(v)}]:[]);});
 });
}
function peers(s:Simulator,mode:Mode='normal'){return ['PE1','PE2'].every((n,i)=>{const d=get(s,n),rows=d.runtime.neighbors.filter(r=>r.protocol==='EIGRP'&&r.state==='UP'),wanted=mode==='initial'||mode==='passive'?['RED']:vrfs;return rows.length===wanted.length&&wanted.every(v=>rows.some(r=>r.interface===sub(v as VRF)&&r.peerInterface===sub(v as VRF)&&r.deviceId===id(i?'PE1':'PE2')&&r.address===`10.0.0.${i?1:2}`&&r.asn===asn(v as VRF)));});}
function learned(s:Simulator,n:string,v:VRF,network:string,prefix:number,present=true){const d=get(s,n),rows=d.runtime.routes.filter(r=>r.protocol==='D'&&r.vrf===v&&r.network===network&&r.prefix===prefix),c=s.cefLookup(d.id,network,v);if(!present)return !rows.length&&!c;const t=d.runtime.features.eigrpTopology?.find((r:any)=>r.vrf===v&&r.network===network&&r.prefix===prefix);return rows.length===1&&rows[0].ad===90&&rows[0].metric===15360&&rows[0].interface===sub(v)&&rows[0].nextHop===`10.0.0.${n==='PE1'?2:1}`&&c?.port===sub(v)&&c.route.protocol==='D'&&c.route.vrf===v&&t?.state==='PASSIVE'&&t.metricMode==='wide'&&t.feasibleDistance===1966080&&t.successors?.length===1&&t.successors[0].reportedDistance===1310720;}
function routes(s:Simulator,mode:Mode='normal'){
 if(!['PE1','PE2'].every(n=>get(s,n).runtime.routes.length>0&&get(s,n).runtime.routes.every(r=>r.vrf==='BLUE'||r.vrf==='RED')&&!s.cefLookup(id(n),n==='PE1'?server:client)))return false;
 return vrfs.every(v=>{const down=v==='BLUE'&&['initial','passive'].includes(mode);return learned(s,'PE1',v,'192.168.20.0',24,!down&&!(v==='BLUE'&&['network','filter'].includes(mode)))&&learned(s,'PE1',v,diag(v),32,!down)&&learned(s,'PE2',v,'192.168.10.0',24,!down&&!(v==='BLUE'&&mode==='binding'));});
}
function state(s:Simulator,mode:Mode='normal'){return base(s)&&definitions(s)&&interfaces(s,mode)&&policy(s,mode)&&peers(s,mode)&&routes(s,mode);}
function healthy(s:Simulator){return state(s)&&vrfs.every(v=>{const h=get(s,'SRV-'+v).config.services.http;return h?.enabled&&(h.port??80)===80&&(h.authentication??'none')==='none'&&!!h.content?.includes(`EIGRP VRF ${v}: isolated service reached`);});}
type Attempt={lab:object;epochs:Map<string,{signature:string;since:number}>;marks:Map<string,number>;earned:Set<Observed>};
const attempts=new WeakMap<Simulator,Attempt>();
function attempt(s:Simulator){let a=attempts.get(s);if(!a||a.lab!==s.lab){a={lab:s.lab,epochs:new Map(),marks:new Map(),earned:new Set()};attempts.set(s,a);const current=a,off=s.subscribe(()=>{if(s.lab!==current.lab){off();return;}if(shape(s))refresh(s,current);});}return a;}
function since(s:Simulator,a:Attempt,key:string,ok:boolean){if(!ok){a.epochs.delete(key);return;}const signature=JSON.stringify([s.lab.devices.map(d=>[d.id,d.config]),['PE1','PE2'].map(n=>get(s,n).runtime.routes.filter(r=>r.protocol==='D').map(r=>[r.vrf,r.network,r.prefix,r.interface,r.metric]))]),old=a.epochs.get(key);if(!old||old.signature!==signature){const v={signature,since:s.clock.now()};a.epochs.set(key,v);return v.since;}return old.since;}
function traffic(s: Simulator, at: number, v: VRF, reverse = false, router = false, target = server) {
  const from = router ? 'PE1' : reverse ? 'SRV-' + v : 'PC-' + v, to = target === server ? 'SRV-' + v : target === client ? 'PC-' + v : 'PE2', source = router ? '10.0.0.1' : reverse ? server : client, requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet; if (e.time <= at || e.nodeId !== id(from) || e.label !== 'Echo reply received' || p?.source !== target || p.destination !== source || !p.parentId || router && p.vrf !== v) continue;
    const req = p.parentId;
    if (!s.events.some(x => x.time > at && x.nodeId === id(to) && x.label === 'Echo request accepted' && x.packet?.id === req && (to !== 'PE2' || x.packet.vrf === v))) continue;
    if (s.events.some(x => x.time > at && x.nodeId === id(target === client ? 'PC-' + (v === 'BLUE' ? 'RED' : 'BLUE') : 'SRV-' + (v === 'BLUE' ? 'RED' : 'BLUE')) && x.label === 'Echo request accepted' && x.packet?.id === req)) continue;
    const tx = reverse ? 'PE2' : 'PE1', rx = reverse ? 'PE1' : 'PE2';
    if (!s.events.some(x => x.time > at && x.nodeId === id(tx) && x.port === g(1) && x.label === 'Frame sent' && x.packet?.id === req && x.packet.vrf === v && x.packet.vlan === tag(v)) || !s.events.some(x => x.time > at && x.nodeId === id(rx) && x.port === g(1) && x.label === 'Frame received' && x.packet?.id === req && x.packet.vlan === tag(v))) continue;
    requests.add(req);
  }
  return requests.size >= 3;
}
function drops(s: Simulator, at: number, v: VRF, target: string, binding = false, neighbor = false) {
  const requests = new Set<string>();
  for (const e of s.events) {
    const p = e.packet; if (e.time <= at || e.disposition !== 'drop' || p?.messageType !== 'echo-request' || p.source !== client || p.destination !== target) continue;
    const gateway = e.nodeId === id('PE1') && e.label === 'No route' && p.vrf === (binding ? undefined : v);
    const unresolved = e.label === 'Neighbor unresolved' && e.nodeId === id(binding ? 'PC-' + v : 'PE1') && (binding || p.vrf === v);
    if (!(neighbor ? unresolved : binding ? gateway || unresolved : gateway)) continue;
    if (!binding && !s.events.some(x => x.time > at && x.nodeId === id('PC-' + v) && x.label === 'Frame sent' && x.packet?.id === p.id)) continue;
    if (s.events.some(x => x.time > at && x.nodeId === id('SRV-' + v) && x.label === 'Echo request accepted' && x.packet?.id === p.id)) continue;
    requests.add(p.id);
  }
  return requests.size >= 3;
}
function web(s: Simulator, at: number, v: VRF) {
  return Object.entries<any>(get(s, 'PC-' + v).runtime.features.tcpConnections ?? {}).some(([t, c]) => {
    if (c.remoteAddress !== server || c.remotePort !== 80 || c.payload?.application !== 'http' || c.payload.path !== '/' || !Number.isInteger(c.expected) || c.expected < 1 || c.expected > 2048 || c.received !== c.expected) return false;
    const r = get(s, 'SRV-' + v).runtime.features.tcpConnections?.[t]; if (r?.source !== client || r.response?.statusCode !== 200 || get(s, 'SRV-' + (v === 'BLUE' ? 'RED' : 'BLUE')).runtime.features.tcpConnections?.[t]) return false;
    try {const b = JSON.parse(Array.from({length: c.expected}, (_, i) => c.segments[i]).join('')); if (b.statusCode !== 200 || b.content !== r.response.content || !b.content.includes(`EIGRP VRF ${v}: isolated service reached`)) return false;} catch {return false;}
    return s.events.some(e => e.time > at && e.nodeId === id('PE1') && e.port === g(1) && e.label === 'Frame sent' && e.packet?.serviceTransaction === t && e.packet.source === client && e.packet.vrf === v && e.packet.vlan === tag(v));
  });
}
const all=(s:Simulator,at:number)=>vrfs.every(v=>traffic(s,at,v)&&traffic(s,at,v,true,false,client));
const red=(s:Simulator,at:number)=>traffic(s,at,'RED')&&traffic(s,at,'RED',true,false,client);
function globalDrops(s:Simulator,at:number){return new Set(s.events.filter(e=>e.time>at&&e.nodeId===id('PE1')&&e.label==='No route'&&e.disposition==='drop'&&e.packet?.messageType==='echo-request'&&e.packet.destination===server&&e.packet.vrf===undefined).map(e=>e.packet!.id)).size>=3;}
function refresh(s:Simulator,a:Attempt){
 if(a.earned.size===observed.length)return;
 if(!a.earned.has('diagnose')){const at=since(s,a,'initial',state(s,'initial'));if(at!==undefined&&drops(s,at,'BLUE',server)&&red(s,at))a.earned.add('diagnose');}
 for(const mode of ['passive','network','binding','filter'] as const){if(a.earned.has(mode))continue;const at=since(s,a,mode,a.earned.has('traffic')&&state(s,mode));if(at!==undefined&&drops(s,at,'BLUE',server,mode==='binding')&&red(s,at)&&(mode==='binding'?traffic(s,at,'BLUE',false,true):['network','filter'].includes(mode)?traffic(s,at,'BLUE',false,false,diag('BLUE')):true))a.marks.set(mode,s.clock.now());}
 const normal=since(s,a,'normal',healthy(s));if(normal===undefined)return;
 if(all(s,normal)){a.earned.add('traffic');for(const mode of ['passive','network','binding','filter'] as const){const mark=a.marks.get(mode);if(mark!==undefined&&normal>=mark)a.earned.add(mode);}}
 if(vrfs.every(v=>web(s,normal,v)))a.earned.add('http');
 if(a.earned.has('traffic')&&globalDrops(s,normal)&&vrfs.every(v=>traffic(s,normal,v,false,true)&&traffic(s,normal,v,false,false,diag(v))&&drops(s,normal,v,diag(v==='BLUE'?'RED':'BLUE'))))a.earned.add('isolation');
}
export function matchesEIGRPVRFCriterion(s:Simulator,d:Device,c:EIGRPVRFCriterion):boolean{
 if(!validEIGRPVRFCriterion(c)||d.id!==c.device||d.id!==id('PE1')||!shape(s))return false;
 if(c.kind==='evr-observe'){const a=attempt(s);if(!a.earned.has(c.check))refresh(s,a);return a.earned.has(c.check);}
 switch(c.check){case'definitions':return base(s)&&definitions(s)&&interfaces(s)&&policy(s);case'policy':return base(s)&&definitions(s)&&interfaces(s)&&policy(s);case'neighbors':return base(s)&&definitions(s)&&interfaces(s)&&policy(s)&&peers(s);case'routes':return state(s);case'healthy':return healthy(s);case'saved':return healthy(s)&&['PE1','PE2'].every(n=>eq(get(s,n).config,get(s,n).startupConfig));}
}
