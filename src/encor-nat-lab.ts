import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {natRuleKey} from './nat-state.ts';
import {matchesNATCriterion} from './nat-lab.ts';
export type ENCORNatCriterion={kind:'enat-live';device:string;check:'routing'|'pool'|'saved'}|{kind:'enat-dynamic';device:string;phase:'first'|'exhausted'|'reallocated'};
export const encorNatId=(name:string)=>'device-enat-'+name.toLowerCase();
export function validENCORNatCriterion(c:any):boolean{return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='enat-live'?['routing','pool','saved'].includes(c.check):c.kind==='enat-dynamic'&&['first','exhausted','reallocated'].includes(c.phase));}
const g=(n:number)=>'GigabitEthernet0/'+n;
function routing(s:Simulator,d:Device):boolean{
 const isp=s.getDevice(encorNatId('ISP1')),remote=s.getDevice(encorNatId('SRV1')),route=s.cefLookup(d.id,'198.51.100.10');
 return !!isp&&!!remote&&s.devicePowered(d.id)&&s.devicePowered(isp.id)&&s.devicePowered(remote.id)&&d.config.ipRouting&&d.config.interfaces[g(0)]?.ip==='192.168.10.1'&&d.config.interfaces[g(1)]?.ip==='203.0.113.1'&&route?.route.protocol==='static'&&route.route.network==='0.0.0.0'&&route.route.prefix===0&&route.route.nextHop==='203.0.113.2'&&route.port===g(1)&&s.interfaceUp(d.id,g(0))&&s.interfaceUp(d.id,g(1))&&!s.cefLookup(isp.id,'192.168.10.10');
}
function pool(d:Device):boolean{const p=d.config.features.nat?.pools?.PUBLIC;return p?.start==='203.0.113.20'&&p.end==='203.0.113.20'&&p.mask==='255.255.255.0';}
function common(s:Simulator,d:Device):boolean{return routing(s,d)&&pool(d)&&matchesNATCriterion(s,d,{kind:'nat-interface',device:d.id,interface:g(0),role:'inside'})&&matchesNATCriterion(s,d,{kind:'nat-interface',device:d.id,interface:g(1),role:'outside'})&&matchesNATCriterion(s,d,{kind:'nat-static',device:d.id,insideLocal:'192.168.10.50',insideGlobal:'203.0.113.10'})&&matchesNATCriterion(s,d,{kind:'pat-acl',device:d.id,name:'NAT-CLIENTS',network:'192.168.10.0',wildcard:'0.0.0.255'});}
const epochs=new WeakMap<Simulator,{lab:object;signature:string;since:number}>();
function since(s:Simulator,d:Device):number|undefined{
 const rules=d.config.features.nat?.rules??[];if(!common(s,d)||rules.length!==1||rules[0].acl!=='NAT-CLIENTS'||rules[0].pool!=='PUBLIC'||rules[0].overload||rules[0].interface){epochs.delete(s);return;}
 const signature=JSON.stringify(d.config),previous=epochs.get(s);if(!previous||previous.lab!==s.lab||previous.signature!==signature||previous.since>s.clock.now()){const e={lab:s.lab,signature,since:s.clock.now()};epochs.set(s,e);return e.since;}return previous.since;
}
/** Correlate a fresh one-to-one translated request, delivered reply and both NAT rewrites. */
function echo(s:Simulator,d:Device,inside:Device,cutoff:number):boolean{
 const from=inside.config.interfaces.GigabitEthernet0?.ip,remote=s.getDevice(encorNatId('SRV1'));if(!from||!remote||!s.devicePowered(inside.id))return false;
 return s.events.some(reply=>{const p=reply.packet;if(reply.time<cutoff||reply.nodeId!==inside.id||reply.label!=='Echo reply received'||reply.disposition!=='success'||p?.protocol!=='ICMP'||p.ipVersion!==4||p.source!=='198.51.100.10'||p.destination!==from)return false;const request=s.events.find(e=>e.time>=cutoff&&e.nodeId===remote.id&&e.label==='Echo request accepted'&&!!e.packet&&e.packet.id===p.parentId&&e.packet.protocol==='ICMP'&&e.packet.source==='203.0.113.20'&&e.packet.destination==='198.51.100.10');return !!request&&s.events.some(e=>e.time>=cutoff&&e.nodeId===inside.id&&e.label==='Frame sent'&&e.packet?.id===request.packet!.id)&&s.events.some(e=>e.time>=cutoff&&e.nodeId===d.id&&e.label==='Source NAT'&&e.disposition==='forward'&&e.packet?.id===request.packet!.id&&e.packet.source==='203.0.113.20')&&s.events.some(e=>e.time>=request.time&&e.nodeId===d.id&&e.label==='Destination NAT'&&e.disposition==='forward'&&e.packet?.id===p.id&&e.packet.destination===from);});
}
export function matchesENCORNatCriterion(s:Simulator,d:Device,c:ENCORNatCriterion):boolean{
 if(d.id!==encorNatId('R1'))return false;
 if(c.kind==='enat-live'){
  if(c.check==='routing')return routing(s,d);if(c.check==='pool')return pool(d);
  const rules=d.config.features.nat?.rules??[];return common(s,d)&&rules.length===1&&rules[0].acl==='NAT-CLIENTS'&&rules[0].interface===g(1)&&rules[0].overload===true&&!rules[0].pool&&d.config.features.nat.static.length===1&&!!d.startupConfig&&JSON.stringify(d.config)===JSON.stringify(d.startupConfig);
 }
 const cutoff=since(s,d);if(cutoff===undefined)return false;const a=s.getDevice(encorNatId('PC1')),b=s.getDevice(encorNatId('PC2'));if(!a||!b||!s.devicePowered(a.id)||!s.devicePowered(b.id))return false;
 const key=natRuleKey(d.config.features.nat.rules[0]),rows=(d.runtime.features.natTranslations??[]).filter((r:any)=>r.rule===key&&r.binding&&!r.overload&&r.expires>s.clock.now()&&r.outside==='203.0.113.20'),first=rows.find((r:any)=>r.inside==='192.168.10.10'),second=rows.find((r:any)=>r.inside==='192.168.10.20');
 if(rows.length!==1)return false;
 if(c.phase==='first')return !!first&&echo(s,d,a,Math.max(cutoff,first.created));
 if(c.phase==='reallocated')return !!second&&!first&&s.events.some(e=>e.time>=cutoff&&e.time<second.created&&e.nodeId===d.id&&e.label==='Source NAT'&&e.packet?.source==='203.0.113.20'&&e.detail.startsWith('192.168.10.10'))&&echo(s,d,b,Math.max(cutoff,second.created));
 return !!first&&!second&&echo(s,d,a,Math.max(cutoff,first.created))&&s.events.some(drop=>{const p=drop.packet;if(drop.time<Math.max(cutoff,first.created)||drop.nodeId!==d.id||drop.label!=='NAT pool exhausted'||drop.disposition!=='drop'||p?.protocol!=='ICMP'||p.source!=='192.168.10.20'||p.destination!=='198.51.100.10')return false;return s.events.some(e=>e.time>=cutoff&&e.nodeId===b.id&&e.label==='Frame sent'&&e.packet?.id===p.id)&&s.events.some(e=>e.nodeId===d.id&&e.label==='Frame received'&&e.packet?.id===p.id)&&s.events.some(e=>e.time>=drop.time&&e.nodeId===b.id&&e.label==='ICMP error received'&&e.packet?.parentId===p.id&&e.packet.icmpQuoted?.source===p.source&&e.packet.icmpQuoted.destination===p.destination);});
}
