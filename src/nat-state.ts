import type {Simulator,IPPacket} from './engine.ts';
import type {Device} from './model.ts';
export const natRuleKey=(rule:any)=>JSON.stringify([rule.acl??'',rule.interface??'',rule.pool??'',!!rule.overload]);
export function natLive(d:Device,now:number):any[]{return [...d.runtime.features.natTranslations??[],...d.runtime.features.natFlows??[]].filter(x=>x.expires===undefined||x.expires>now);}
export function natStats(d:Device):any{return d.runtime.features.natStats??={hits:0,misses:0,translated:0,punted:0,expired:0,poolMisses:{}};}
function nextId(d:Device):number{return d.runtime.features.natEntrySequence=(d.runtime.features.natEntrySequence??0)+1;}
export function natStatics(d:Device,now:number):any[]{
 const state=d.runtime.features.natStaticState??={};const rows=(d.config.features.nat?.static??[]).map((s:any)=>{const key=s.inside+'|'+s.outside;return {...s,...state[key]??={id:nextId(d),created:now,lastUsed:now},static:true,extended:false};});
 for(const key of Object.keys(state))if(!rows.some((s:any)=>s.inside+'|'+s.outside===key))delete state[key];return rows;
}
export function natTimeout(d:Device,entry:any):number {
 const t=d.config.features.nat?.timeouts??{};
 return (entry.binding?t.generic??86400:entry.timingOut?t.finrst??60:t[entry.protocol]??(entry.protocol==='tcp'?86400:entry.protocol==='icmp'?60:300))*1000;
}
/** Idle deadlines belong to real allocations and child flows. A live child retains its address allocation. */
export function refreshNatEntry(e:Simulator,d:Device,entry:any,packet?:IPPacket):void {
 entry.id??=nextId(d);entry.created??=e.clock.now();
 if(packet?.protocol==='tcp'&&(/^(tcp-fin|tcp-fin-ack|tcp-rst)$/.test(packet.body?.kind)||packet.body?.kind==='tcp-channel'&&['fin','fin-ack','rst'].includes(packet.body.phase)))entry.timingOut=true;
 entry.lastUsed=e.clock.now();entry.expires=e.clock.now()+natTimeout(d,entry);
 if(entry.binding){entry.idleExpires=entry.expires;entry.expires=Math.max(entry.expires,...(d.runtime.features.natFlows??[]).filter((x:any)=>x.parentId===entry.id).map((x:any)=>x.expires));}
 if(entry.expiryTimer&&entry.expiryAt<=entry.expires)return;
 e.clock.cancel(entry.expiryTimer);entry.expiryScheduled=true;
 const expire=()=>{
  const table=entry.extended&&!entry.overload?d.runtime.features.natFlows??[]:d.runtime.features.natTranslations??[];
  if(!table.includes(entry))return;
  if(entry.binding)entry.expires=Math.max(entry.idleExpires??entry.expires,...(d.runtime.features.natFlows??[]).filter((x:any)=>x.parentId===entry.id&&x.expires>e.clock.now()).map((x:any)=>x.expires));
  if(entry.expires>e.clock.now()){arm();return;}
  const field=entry.extended&&!entry.overload?'natFlows':'natTranslations';d.runtime.features[field]=table.filter((x:any)=>x!==entry);natStats(d).expired=(natStats(d).expired??0)+1;e.emit({nodeId:d.id,protocol:'NAT',label:'Translation expired',detail:entry.inside+' → '+entry.outside,disposition:'info'});
 };
 const arm=()=>{entry.expiryAt=entry.expires;entry.expiryTimer=e.clock.schedule(Math.max(1,entry.expires-e.clock.now()),expire,{owner:d.id,label:'NAT idle timeout'});};arm();
}
/** Static and basic dynamic mappings also create observable extended transport entries. */
export function recordNatFlow(e:Simulator,d:Device,mapping:any,packet:IPPacket,inbound=false):void {
 if(d.kind==='datacenter'&&mapping.static)return;
 if(!['tcp','udp','icmp'].includes(packet.protocol)||packet.protocol==='icmp'&&!['echo-request','echo-reply'].includes(packet.body?.kind))return;
 if(mapping.overload){refreshNatEntry(e,d,mapping,packet);return;}
 const flows:any[]=d.runtime.features.natFlows??=[],icmp=packet.protocol==='icmp';
 const insidePort=icmp?packet.sourcePort:inbound?packet.destinationPort:packet.sourcePort,remote=inbound?packet.source:packet.destination,remotePort=icmp?insidePort:inbound?packet.sourcePort:packet.destinationPort;
 let flow=flows.find(x=>x.inside===mapping.inside&&x.outside===mapping.outside&&x.insidePort===insidePort&&x.protocol===packet.protocol&&x.remote===remote&&x.remotePort===remotePort);
 if(!flow){flow={inside:mapping.inside,outside:mapping.outside,insidePort,outsidePort:insidePort,protocol:packet.protocol,remote,remotePort,extended:true,overload:false,parentId:mapping.binding?mapping.id:undefined,staticParent:!!mapping.static,rule:mapping.rule,mapId:mapping.mapId,created:e.clock.now()};flows.push(flow);}
 refreshNatEntry(e,d,flow,packet);
 if(mapping.binding)refreshNatEntry(e,d,mapping);else {const key=mapping.inside+'|'+mapping.outside,state=d.runtime.features.natStaticState?.[key];if(state)state.lastUsed=e.clock.now();}
 updateNatPeak(d,e.clock.now());
}
export function updateNatPeak(d:Device,now:number):void{const count=natLive(d,now).length+(d.config.features.nat?.static??[]).length;natStats(d).peak=Math.max(natStats(d).peak??0,count);}
export function natTranslated(d:Device,direction:'inOut'|'outIn'='inOut'):void{const s=natStats(d);s.hits++;s.translated=(s.translated??0)+1;s[direction]=(s[direction]??0)+1;}
export function clearNatState(d:Device,inside?:{global:string;local:string},e?:Simulator):void {
 const match=(r:any)=>!inside||r.outside===inside.global&&r.inside===inside.local;
 for(const row of [...d.runtime.features.natTranslations??[],...d.runtime.features.natFlows??[]])if(match(row))e?.clock.cancel(row.expiryTimer);
 d.runtime.features.natTranslations=(d.runtime.features.natTranslations??[]).filter((x:any)=>!match(x));d.runtime.features.natFlows=(d.runtime.features.natFlows??[]).filter((x:any)=>!match(x));
}
export function clearNatRuleState(d:Device,rule:string,e:Simulator):void {
 for(const field of ['natTranslations','natFlows']){
  const rows:any[]=d.runtime.features[field]??=[];
  for(const row of rows)if(row.rule===rule)e.clock.cancel(row.expiryTimer);
  d.runtime.features[field]=rows.filter(row=>row.rule!==rule);
 }
}
