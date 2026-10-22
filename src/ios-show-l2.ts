import type { Simulator } from './engine.ts';
import type { Device, InterfaceConfig, StpPortState, StpVlanState } from './model.ts';
import { stpPortName, stpMembers } from './stp-ports.ts';
import { switchingPeer } from './switching-messages.ts';
import { interfaceSpeed, interfaceDuplex, speedIsAuto } from './ethernet.ts';
import { bridgeMac } from './control-plane.ts';
import { ERRDISABLE_CAUSES, errdisableDetectionEnabled } from './ios-errdisable.ts';
import { macCapacity } from './mac-table.ts';
import { switchVoiceVlan } from './endpoint.ts';
import { portfastConfigured, loopguardEnabled, bpduguardEnabled } from './ios-switching-compat.ts';

/** Catalyst 2960/3560 IOS 15.2 layouts for layer-2 show commands, rendered from simulator state. */
class InputError extends Error {}
const bad=():never=>{throw new InputError("% Invalid input detected at '^' marker.");};
const missing=():never=>{throw new InputError('% Incomplete command.');};
const exact=(a:string[],n=0)=>{if(a.length<n)missing();if(a.length>n)bad();};
const natural=(a:string,b:string)=>a.localeCompare(b,'en',{numeric:true});
const short=(p:string)=>p.replace(/^GigabitEthernet/i,'Gi').replace(/^FastEthernet/i,'Fa').replace(/^TenGigabitEthernet/i,'Te').replace(/^Ethernet/i,'Et').replace(/^Port-channel/i,'Po');
const dotted=(value:string)=>(value.replace(/[^a-f0-9]/gi,'').toLowerCase().padStart(12,'0').match(/.{4}/g)??[]).join('.');
const physical=(name:string)=>!/^(Vlan|Loopback|Tunnel|Null|BVI|Dialer|Virtual)/i.test(name)&&!name.includes('.');
const ports=(d:Device)=>Object.values(d.config.interfaces).filter(p=>p.switchport&&physical(p.name)).sort((a,b)=>natural(a.name,b.name));
const allPorts=(d:Device)=>Object.values(d.config.interfaces).filter(p=>physical(p.name)).sort((a,b)=>natural(a.name,b.name));
const word=(value:string|undefined,options:string[])=>{if(!value)missing();const v=value!.toLowerCase(),found=options.includes(v)?[v]:options.filter(o=>o.startsWith(v));if(found.length>1)throw new InputError(`% Ambiguous command: "${value}"`);return found[0]??bad();};
const num=(value:string|undefined,min:number,max:number)=>{if(!value)missing();if(!/^\d+$/.test(value!)||Number(value)<min||Number(value)>max)bad();return Number(value);};
const pad2=(n:number)=>String(n).padStart(2,'0');
const age=(ms:number)=>{const s=Math.max(0,Math.floor(ms/1000));return `${Math.floor(s/86400)}d:${pad2(Math.floor(s%86400/3600))}h:${pad2(Math.floor(s%3600/60))}m:${pad2(s%60)}s`;};
const hms=(ms:number)=>{const s=Math.max(0,Math.floor(ms/1000));return `${pad2(Math.floor(s/3600))}:${pad2(Math.floor(s%3600/60))}:${pad2(s%60)}`;};
const wall=(d:Device,t:number)=>new Date((d.config.features.clockEpoch??Date.UTC(2026,0,1))+t+(d.runtime.features.clockOffset??d.config.features.clockOffset??0));
function takePort(d:Device,a:string[]):InterfaceConfig {let value=a.shift()??missing();if(/^[a-z-]+$/i.test(value)&&/^\d/.test(a[0]??''))value+=a.shift();const m=/^([a-z-]+)(\d.*)$/i.exec(value),names=Object.values(d.config.interfaces).filter(p=>{const n=/^([a-z-]+)(\d.*)$/i.exec(p.name);return p.name.toLowerCase()===value.toLowerCase()||short(p.name).toLowerCase()===value.toLowerCase()||!!(m&&n&&n[1].toLowerCase().startsWith(m[1].toLowerCase())&&n[2]===m[2]);});if(names.length>1)throw new InputError(`% Ambiguous command: "${value}"`);return names[0]??bad();}
function ranges(values:number[],none='none'):string {const sorted=[...new Set(values)].sort((a,b)=>a-b),result:string[]=[];for(let i=0;i<sorted.length;i++){const first=sorted[i];while(sorted[i+1]===sorted[i]+1)i++;result.push(first===sorted[i]?String(first):first+'-'+sorted[i]);}return result.join(',')||none;}
function vlanList(value:string|undefined):number[] {if(!value)missing();const out:number[]=[];for(const part of value!.split(',')){const m=/^(\d+)(?:-(\d+))?$/.exec(part);if(!m)bad();const lo=Number(m![1]),hi=Number(m![2]??m![1]);if(lo<1||hi>4094||hi<lo)bad();for(let v=lo;v<=hi;v++)out.push(v);}return out;}
const fnv=(text:string,seed:number)=>{let h=(0x811c9dc5^seed)>>>0;for(const ch of text){h^=ch.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}return h;};
/** Deterministic 16-byte digest used where IOS prints an MD5 value the simulator does not compute. */
const digest=(text:string)=>[0,1,2,3].flatMap(i=>{const h=fnv(text,i*0x9e3779b9);return [h>>>24,(h>>>16)&255,(h>>>8)&255,h&255];});

export function formatIOSL2Show(e:Simulator,d:Device,topic:string,input:readonly string[]):string[]|undefined {
  const [family,...suffix]=topic.split(' '),a=[...suffix,...input];
  try {
    switch(family){
      case 'spanning-tree':return spanningTree(e,d,a);
      case 'vlan':return vlanShow(e,d,a);
      case 'mac':if(a[0]?.toLowerCase()!=='address-table')return undefined;a.shift();return macTable(e,d,a);
      case 'etherchannel':return etherchannel(e,d,a);
      case 'interfaces':return interfacesL2(e,d,a);
      case 'vtp':return vtp(e,d,a);
      case 'port-security':return portSecurity(e,d,a);
      case 'dtp':return dtp(e,d,a);
      case 'lacp':return lacp(e,d,a);
      case 'pagp':return pagp(e,d,a);
      case 'errdisable':return errdisable(e,d,a);
      case 'storm-control':return storm(e,d,a);
    }
    return undefined;
  }catch(error){if(error instanceof InputError)return [error.message];throw error;}
}
type Instance={label:string;id:number;key:string;tree:StpVlanState;vlans:number[];ports:[string,StpPortState][]};
const stpMode=(d:Device):string=>d.config.features.stp?.mode??'rapid-pvst';
const protocolName=(mode:string)=>mode==='pvst'?'ieee':mode==='mst'?'mstp':'rstp';
const shown=(s:StpPortState)=>s.state!=='disabled';
const ROLE:Record<string,string>={root:'Root',designated:'Desg',alternate:'Altn',backup:'Back','root-inconsistent':'Desg','loop-inconsistent':'Desg'};
const stsOf=(s:StpPortState)=>/inconsistent/.test(s.role??'')?'BKN*':({forwarding:'FWD',blocking:'BLK',discarding:'BLK',learning:'LRN',listening:'LIS'} as Record<string,string>)[s.state]??'BLK';
const splitId=(id:string|undefined)=>{const [p,m]=String(id??'').split('.');return {priority:Number(p)||0,mac:dotted(m??'')};};
const secs=(ms:number|undefined,fallback:number)=>Math.round((ms??fallback*1000)/1000);
function mstMapping(d:Device):{id:number;vlans:number[];priority?:number}[] {const m=d.config.features.stp?.mst??{},list:any[]=[...(m.instances??[])].sort((x:any,y:any)=>x.id-y.id),mapped=new Set<number>(list.flatMap((i:any)=>i.vlans??[]));return [{id:0,vlans:Array.from({length:4094},(_,i)=>i+1).filter(v=>!mapped.has(v))},...list.map((i:any)=>({id:Number(i.id),vlans:[...(i.vlans??[])].map(Number).sort((x,y)=>x-y),priority:i.priority}))];}
function mstRegion(d:Device):string {const m=d.config.features.stp?.mst??{};return JSON.stringify([m.name??'',m.revision??0,mstMapping(d).slice(1).map(i=>[i.id,i.vlans])]);}
function instances(d:Device):Instance[] {
  const trees=Object.entries(d.runtime.stp).filter(([,t])=>Object.values(t.ports).some(shown)).sort(([x],[y])=>Number(x)-Number(y)),sorted=(r:Record<string,StpPortState>)=>Object.entries(r).filter(([,s])=>shown(s)).sort(([x],[y])=>natural(x,y));
  if(stpMode(d)!=='mst')return trees.map(([v,t])=>({label:'VLAN'+v.padStart(4,'0'),id:Number(v),key:v,tree:t,vlans:[Number(v)],ports:sorted(t.ports)}));
  return mstMapping(d).flatMap(i=>{const members=trees.filter(([v])=>i.vlans.includes(Number(v)));if(!members.length)return [];const merged:Record<string,StpPortState>={};for(const [,t] of members)for(const [n,s] of Object.entries(t.ports))if(shown(s)&&!merged[n])merged[n]=s;return [{label:'MST'+i.id,id:i.id,key:members[0][0],tree:members[0][1],vlans:i.vlans,ports:sorted(merged)}];});
}
function peerOf(e:Simulator,d:Device,name:string):{device:Device;port:string}|undefined {
  const members=stpMembers(d,name);for(const member of members.length?members:[name]){const link=e.linkAt(d.id,member);if(!link||link.enabled===false)continue;const far=link.a.deviceId===d.id&&link.a.port===member?link.b:link.a,device=e.getDevice(far.deviceId);if(device)return {device,port:far.port};}
  return undefined;
}
function stpType(e:Simulator,d:Device,name:string,s:StpPortState):string {
  let t=(s.linkType==='shared'?'Shr':'P2p')+' ';if(s.edge)t+='Edge ';
  const mode=stpMode(d);if(mode==='rapid-pvst'&&d.runtime.features.stpLegacy?.[name])t+='Peer(STP) ';
  if(mode==='mst'){const peer=peerOf(e,d,name);if(peer&&peer.device.config.features.stp){const pm=stpMode(peer.device);if(pm!=='mst')t+='Bound(PVST) ';else if(mstRegion(peer.device)!==mstRegion(d))t+='Bound(RSTP) ';}}
  if(s.role==='root-inconsistent')t+='*ROOT_Inc ';else if(s.role==='loop-inconsistent')t+='*LOOP_Inc ';
  return t;
}
function stpRow(e:Simulator,d:Device,label:string,width:number,name:string,s:StpPortState):string {const sts=stsOf(s);return `${label.padEnd(width)} ${(ROLE[s.role??'']??'Desg').padEnd(4)} ${sts.length>3?sts:sts+' '}${String(s.cost??0).padEnd(9)} ${`${s.portPriority??128}.${s.portNumber??0}`.padEnd(8)} ${stpType(e,d,name,s)}`;}
const configuredTimer=(d:Device,key:string,name:string,fallback:number)=>Number(d.config.features.stp?.vlanTimers?.[key]?.[name]??d.config.features.stp?.[name]??fallback);
const helloLine=(h:number,m:number,f:number)=>`             Hello Time ${String(h).padStart(3)} sec  Max Age ${String(m).padStart(2)} sec  Forward Delay ${String(f).padStart(2)} sec`;
function treeHeader(e:Simulator,d:Device,i:Instance):string[] {
  const t=i.tree,root=splitId(t.rootBridgeId),bridge=splitId(t.bridgeId),isRoot=t.rootBridgeId===t.bridgeId||t.rootId===d.id,ext=bridge.priority%4096,mst=stpMode(d)==='mst',rp=t.rootPort?t.ports[t.rootPort]:undefined;
  return ['',i.label,`  Spanning tree enabled protocol ${protocolName(stpMode(d))}`,`  Root ID    Priority    ${root.priority}`,`             Address     ${root.mac}`,...(isRoot?['             This bridge is the root']:[`             Cost        ${t.cost??0}`,`             Port        ${rp?.portNumber??0} (${t.rootPort})`]),helloLine(secs(t.helloTime,2),secs(t.maxAge,20),secs(t.forwardTime,15)),'',
    `  Bridge ID  Priority    ${String(bridge.priority).padEnd(6)} (priority ${bridge.priority-ext} sys-id-ext ${ext})`,`             Address     ${bridge.mac}`,helloLine(configuredTimer(d,i.key,'helloTime',2),configuredTimer(d,i.key,'maxAge',20),configuredTimer(d,i.key,'forwardTime',15)),...(mst||d.kind==='datacenter'?[]:[`             Aging Time  ${d.config.features.macAgingVlans?.[i.id]??d.config.features.macAgingTime??300} sec`]),''];
}
function spanningTree(e:Simulator,d:Device,a:string[]):string[] {
  const stp=d.config.features.stp??{};let vlans:number[]|undefined,vlanText='',port:InterfaceConfig|undefined,view='tree';
  while(a.length){
    const key=word(a.shift(),['active','backbonefast','blockedports','bridge','detail','inconsistentports','interface','mst','pathcost','root','summary','uplinkfast','vlan']);
    if(key==='mst'){if(vlans||port||view!=='tree')bad();return mstShow(e,d,a);}
    if(key==='pathcost'){word(a.shift(),['method']);exact(a);return [`Spanning tree default pathcost method used is ${stp.pathcostMethod??'short'}`];}
    if(key==='backbonefast'){exact(a);return stp.backbonefast?['BackboneFast is enabled','','BackboneFast statistics','-----------------------',...['Number of transition via backboneFast (all VLANs)','Number of inferior BPDUs received (all VLANs)','Number of RLQ request PDUs received (all VLANs)','Number of RLQ response PDUs received (all VLANs)','Number of RLQ request PDUs sent (all VLANs)','Number of RLQ response PDUs sent (all VLANs)'].map(l=>l.padEnd(60)+': 0')]:['BackboneFast is disabled'];}
    if(key==='uplinkfast'){exact(a);if(!stp.uplinkFast)return ['UplinkFast is disabled'];const rows=instances(d).flatMap(i=>{const list=i.ports.filter(([,s])=>['root','alternate'].includes(s.role??'')).sort(([,x],[,y])=>(x.role==='root'?0:1)-(y.role==='root'?0:1)).map(([n,s])=>short(n)+(s.role==='root'&&s.state==='forwarding'?'(fwd)':''));return list.length?[i.label.padEnd(20)+' '+list.join(', ')]:[];});return ['UplinkFast is enabled','','Station update rate set to 150 packets/sec.','','UplinkFast statistics','-----------------------','Number of transitions via uplinkFast (all VLANs)            : 0','Number of proxy multicast addresses transmitted (all VLANs) : 0','','Name                 Interface List','-------------------- ------------------------------------',...rows];}
    if(key==='vlan'){if(vlans)bad();vlanText=a[0]??'';vlans=vlanList(a.shift());}
    else if(key==='interface'){if(port)bad();port=takePort(d,a);}
    else if(key==='active'){}
    else if(key==='detail'&&view==='tree')view='detail';
    else if(key==='detail'&&view==='detail')bad();
    else{if(view!=='tree'&&!(view==='detail'&&key==='active'))bad();view=key;if(key==='summary'&&a[0]&&'totals'.startsWith(a[0].toLowerCase())){a.shift();view='totals';}}
  }
  let list=instances(d);if(vlans)list=list.filter(i=>i.vlans.some(v=>vlans!.includes(v)));
  const logical=port?stpPortName(d,port.name):undefined;
  if(view==='summary'||view==='totals')return stpSummary(d,list,view==='totals');
  if(view==='blockedports'||view==='inconsistentports'){
    const blocked=view==='blockedports',rows=list.map(i=>({i,names:i.ports.filter(([n,s])=>(!logical||n===logical)&&(blocked?['blocking','discarding'].includes(s.state)&&!/inconsistent/.test(s.role??''):/^(root|loop)-inconsistent$/.test(s.role??'')))})).filter(r=>r.names.length);
    const count=rows.reduce((n,r)=>n+r.names.length,0);
    return blocked?['','Name                 Blocked Interfaces List','-------------------- ------------------------------------',...rows.map(r=>r.i.label.padEnd(20)+' '+r.names.map(([n])=>short(n)).join(', ')),'',`Number of blocked ports (segments) in the system : ${count}`]:['','Name                 Interface                Inconsistency','-------------------- ------------------------ ------------------',...rows.flatMap(r=>r.names.map(([n,s])=>r.i.label.padEnd(20)+' '+n.padEnd(24)+' '+(s.role==='root-inconsistent'?'Root Inconsistent':'Loop Inconsistent'))),'',`Number of inconsistent ports (segments) in the system : ${count}`];
  }
  if(vlans&&!list.length)return [`Spanning tree instance(s) for vlan ${vlanText} does not exist.`];
  if(logical){list=list.filter(i=>i.ports.some(([n])=>n===logical));if(!list.length)return [`no spanning tree info available for ${port!.name}`];}
  if(!list.length)return ['No spanning tree instances exist.',''];
  if(view==='root')return stpRoot(d,list);
  if(view==='bridge')return stpBridge(d,list);
  if(view==='detail')return list.flatMap(i=>[...(logical?[]:stpDetailHeader(e,d,i)),...i.ports.filter(([n])=>!logical||n===logical).flatMap(([n,s])=>stpPortDetail(e,d,i,n,s))]);
  if(logical&&view==='tree')return ['',(stpMode(d)==='mst'?'Mst Instance':'Vlan').padEnd(19)+' Role Sts Cost      Prio.Nbr Type','------------------- ---- --- --------- -------- --------------------------------',...list.map(i=>stpRow(e,d,i.label,19,logical,i.ports.find(([n])=>n===logical)![1]))];
  const width=d.kind==='datacenter'?16:19, label=(n:string)=>d.kind==='datacenter'?short(n).replace(/^Et(?=\d)/,'Eth'):short(n);
  return list.flatMap(i=>[...treeHeader(e,d,i),'Interface'.padEnd(width)+' Role Sts Cost      Prio.Nbr Type','-'.repeat(width)+' ---- --- --------- -------- --------------------------------',...i.ports.filter(([n])=>!logical||n===logical).map(([n,s])=>stpRow(e,d,label(n),width,n,s))]);
}
function stpSummary(d:Device,list:Instance[],totals:boolean):string[] {
  const stp=d.config.features.stp??{},mode=stpMode(d),flag=(label:string,on:boolean)=>label.padEnd(40)+'is '+(on?'enabled':'disabled'),roots=list.filter(i=>i.tree.rootBridgeId===i.tree.bridgeId||i.tree.rootId===d.id).map(i=>i.label);
  const rootLines=roots.length?Array.from({length:Math.ceil(roots.length/6)},(_,n)=>(n?' '.repeat(17):'Root bridge for: ')+roots.slice(n*6,n*6+6).join(', ')+(n*6+6<roots.length?',':'')):['Root bridge for: none'];
  const line=(name:string,c:number[])=>name.padEnd(22)+' '+String(c[0]).padStart(7)+String(c[1]).padStart(10)+String(c[2]).padStart(9)+String(c[3]).padStart(11)+String(c[4]).padStart(11);
  const counts=list.map(i=>{const st=i.ports.map(([,s])=>s.state);return [st.filter(s=>s==='blocking'||s==='discarding').length,st.filter(s=>s==='listening').length,st.filter(s=>s==='learning').length,st.filter(s=>s==='forwarding').length,st.length];});
  const sum=[0,1,2,3,4].map(k=>counts.reduce((n,c)=>n+c[k],0)),dash='---------------------- -------- --------- -------- ---------- ----------',unit=mode==='mst'?'mst':'vlan';
  return [mode==='mst'?'Switch is in mst mode (IEEE Standard)':`Switch is in ${mode} mode`,...rootLines,flag('Extended system ID',true),flag('Portfast Default',!!stp.portfastDefault),flag('PortFast BPDU Guard Default',!!stp.bpduguardDefault),flag('Portfast BPDU Filter Default',!!stp.bpdufilterDefault),flag('Loopguard Default',!!stp.loopguardDefault),flag('EtherChannel misconfig guard',stp.etherchannelGuard!==false),flag('UplinkFast',!!stp.uplinkFast),flag('BackboneFast',!!stp.backbonefast),`Configured Pathcost method used is ${stp.pathcostMethod??'short'}`,'',
    'Name                   Blocking Listening Learning Forwarding STP Active',dash,...(totals?[]:[...list.map((i,n)=>line(i.label,counts[n])),dash]),line(`${list.length} ${unit}${list.length===1?'':'s'}`,sum)];
}
function stpRoot(d:Device,list:Instance[]):string[] {
  return ['','                                        Root    Hello Max Fwd','Vlan                   Root ID          Cost    Time  Age Dly  Root Port','---------------- -------------------- --------- ----- --- ---  ------------',...list.map(i=>{const t=i.tree,r=splitId(t.rootBridgeId);return (i.label.padEnd(17)+String(r.priority).padStart(5)+' '+r.mac+String(t.cost??0).padStart(10)+String(secs(t.helloTime,2)).padStart(5)+String(secs(t.maxAge,20)).padStart(5)+String(secs(t.forwardTime,15)).padStart(4)+'  '+(t.rootPort?short(t.rootPort):'')).trimEnd();})];
}
function stpBridge(d:Device,list:Instance[]):string[] {
  const proto=protocolName(stpMode(d));
  return ['','                                                   Hello  Max  Fwd','Vlan                         Bridge ID              Time  Age  Dly  Protocol','---------------- --------------------------------- -----  ---  ---  --------',...list.map(i=>{const b=splitId(i.tree.bridgeId),ext=b.priority%4096;return i.label.padEnd(17)+`${String(b.priority).padStart(5)} (${String(b.priority-ext).padStart(5)}, ${String(ext).padStart(3)}) ${b.mac}`+String(configuredTimer(d,i.key,'helloTime',2)).padStart(5)+String(configuredTimer(d,i.key,'maxAge',20)).padStart(6)+String(configuredTimer(d,i.key,'forwardTime',15)).padStart(5)+'  '+proto;})];
}
function stpDetailHeader(e:Simulator,d:Device,i:Instance):string[] {
  const t=i.tree,stp=d.config.features.stp??{},bridge=splitId(t.bridgeId),root=splitId(t.rootBridgeId),ext=bridge.priority%4096,isRoot=t.rootBridgeId===t.bridgeId||t.rootId===d.id,now=e.clock.now(),topo=d.runtime.features.stpTopology?.[i.key],oh=secs(t.helloTime,2),om=secs(t.maxAge,20),of=secs(t.forwardTime,15),tcLeft=topo&&topo.count?Math.max(0,Math.ceil(((topo.time??0)+(om+of)*1000-now)/1000)):0,rp=t.rootPort?t.ports[t.rootPort]:undefined;
  return ['',` ${i.label} is executing the ${protocolName(stpMode(d))} compatible Spanning Tree protocol`,`  Bridge Identifier has priority ${bridge.priority-ext}, sysid ${ext}, address ${bridge.mac}`,`  Configured hello time ${configuredTimer(d,i.key,'helloTime',2)}, max age ${configuredTimer(d,i.key,'maxAge',20)}, forward delay ${configuredTimer(d,i.key,'forwardTime',15)}, transmit hold-count ${stp.transmitHoldCount??6}`,
    ...(isRoot?['  We are the root of the spanning tree']:[`  Current root has priority ${root.priority}, address ${root.mac}`,`  Root port is ${rp?.portNumber??0} (${t.rootPort}), cost of root path is ${t.cost??0}`]),
    `  Topology change flag ${tcLeft?'set':'not set'}, detected flag ${tcLeft?'set':'not set'}`,`  Number of topology changes ${topo?.count??0} last change occurred ${hms(now-(topo?.count?topo.time??0:0))} ago`,`  Times:  hold 1, topology change ${om+of}, notification ${oh}`,`          hello ${oh}, max age ${om}, forward delay ${of} `,`  Timers: hello 0, topology change ${tcLeft}, notification 0, aging ${d.config.features.macAgingVlans?.[i.id]??d.config.features.macAgingTime??300}`];
}
function stpPortDetail(e:Simulator,d:Device,i:Instance,name:string,s:StpPortState):string[] {
  const p=d.config.interfaces[name],t=i.tree,bridge=splitId(t.bridgeId),root=splitId(t.rootBridgeId),pid=`${s.portPriority??128}.${s.portNumber??0}`;let db=bridge,dpid=pid,dcost=t.cost??0;
  if(['root','alternate','backup'].includes(s.role??'')){const peer=peerOf(e,d,name),pt=peer?.device.runtime.stp[i.key];if(peer&&pt){const ps=pt.ports[stpPortName(peer.device,peer.port)];db=splitId(pt.bridgeId);dcost=pt.cost??0;if(ps)dpid=`${ps.portPriority??128}.${ps.portNumber??0}`;}}
  const inconsistent=/^(root|loop)-inconsistent$/.test(s.role??''),role=['root','alternate','backup'].includes(s.role??'')?s.role:'designated',state=({forwarding:'forwarding',learning:'learning',listening:'listening'} as Record<string,string>)[s.state]??'blocking',counter=d.runtime.features.stpCounters?.[name];
  return ['',` Port ${s.portNumber??0} (${name}) of ${i.label} is ${inconsistent?`broken  (${s.role==='root-inconsistent'?'Root':'Loop'} Inconsistent)`:role+' '+state} `,`   Port path cost ${s.cost??0}, Port priority ${s.portPriority??128}, Port Identifier ${pid}.`,`   Designated root has priority ${root.priority}, address ${root.mac}`,`   Designated bridge has priority ${db.priority}, address ${db.mac}`,`   Designated port id is ${dpid}, designated path cost ${dcost}`,`   Timers: message age ${s.role==='root'?Math.floor((t.messageAge??0)/1000):0}, forward delay 0, hold 0`,`   Number of transitions to forwarding state: ${s.state==='forwarding'?1:0}`,
    ...(s.edge?['   The port is in the portfast mode']:[]),`   Link type is ${s.linkType??'point-to-point'}${p?.features.stpLinkType?'':' by default'}`,...(p?.features.rootGuard?['   Root guard is enabled on the port']:[]),...(p&&loopguardEnabled(d,p)?[p.features.loopGuard?'   Loop guard is enabled on the port':'   Loop guard is enabled by default on the port']:[]),...(p&&bpduguardEnabled(d,p)?[p.features.bpduguard?'   Bpdu guard is enabled':'   Bpdu guard is enabled by default']:[]),...(p?.features.bpdufilter?['   Bpdu filter is enabled']:[]),`   BPDU: sent ${counter?.sent??0}, received ${counter?.received??0}`];
}
function mstShow(e:Simulator,d:Device,a:string[]):string[] {
  const stp=d.config.features.stp??{},m=stp.mst??{},mapping=mstMapping(d);
  if(a[0]&&!/^\d/.test(a[0])&&word(a[0],['configuration','detail','interface'])==='configuration'){
    a.shift();let withDigest=false;if(a.length){withDigest=word(a.shift(),['digest','revision'])==='digest';}exact(a);
    const head=[`Name      [${m.name??''}]`,`Revision  ${String(m.revision??0).padEnd(5)} Instances configured ${mapping.length}`];
    if(withDigest){const hex=(seed:string)=>'0x'+digest(seed+mstRegion(d)).map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join('');return [...head,`Digest          ${hex('mst')}`,`Pre-std Digest  ${hex('pre')}`];}
    return [...head,'','Instance  Vlans mapped','--------  '+'-'.repeat(69),...mapping.map(i=>String(i.id).padEnd(10)+ranges(i.vlans)),'-'.repeat(79)];
  }
  let ids:number[]|undefined,port:InterfaceConfig|undefined,detail=false;
  if(/^\d/.test(a[0]??'')){const text=a.shift()!;ids=[];for(const part of text.split(',')){const r=/^(\d+)(?:-(\d+))?$/.exec(part);if(!r)bad();const lo=num(r![1],0,4094),hi=num(r![2]??r![1],0,4094);if(hi<lo)bad();for(let v=lo;v<=hi;v++)ids.push(v);}}
  while(a.length){const key=word(a.shift(),['detail','interface']);if(key==='detail'){if(detail)bad();detail=true;}else{if(port)bad();port=takePort(d,a);}}
  if(stpMode(d)!=='mst')return ['% Switch is not in mst mode'];
  const list=instances(d),selected=mapping.filter(i=>ids?ids.includes(i.id):true);
  const roleLine=(full:string,id:number,s:StpPortState)=>{const inc=/inconsistent/.test(s.role??'');return `${full} of MST${id} is ${inc?`broken  (${s.role==='root-inconsistent'?'Root':'Loop'} Inconsistent)`:(['root','alternate','backup'].includes(s.role??'')?s.role:'designated')+' '+(({forwarding:'forwarding',learning:'learning',listening:'listening'} as Record<string,string>)[s.state]??'blocking')} `;};
  const bpdus=(name:string,id:number)=>{const c=d.runtime.features.stpCounters?.[name];return `Bpdus${id?' (MRecords)':''} sent ${c?.sent??0}, received ${c?.received??0}`;};
  const portDetail=(i:Instance,name:string,s:StpPortState)=>{const t=i.tree,root=splitId(t.rootBridgeId),bridge=splitId(t.bridgeId),pid=`${s.portPriority??128}.${s.portNumber??0}`;let db=bridge,dpid=pid,dcost=t.cost??0;if(['root','alternate','backup'].includes(s.role??'')){const peer=peerOf(e,d,name),pt=peer?.device.runtime.stp[i.key];if(peer&&pt){const ps=pt.ports[stpPortName(peer.device,peer.port)];db=splitId(pt.bridgeId);dcost=pt.cost??0;if(ps)dpid=`${ps.portPriority??128}.${ps.portNumber??0}`;}}const expires=s.role==='root'?Math.max(0,secs(t.maxAge,20)-Math.floor((t.messageAge??0)/1000)):0;
    return [`Port info             port id ${pid.padStart(14)}  priority ${String(s.portPriority??128).padStart(6)}  cost ${String(s.cost??0).padStart(11)}`,`Designated root       address ${root.mac}  priority ${String(root.priority).padStart(6)}  cost ${String(t.boundary?t.cost??0:0).padStart(11)}`,`Design. regional root address ${(t.boundary?bridge:root).mac}  priority ${String((t.boundary?bridge:root).priority).padStart(6)}  cost ${String(t.boundary?0:dcost).padStart(11)}`,`Designated bridge     address ${db.mac}  priority ${String(db.priority).padStart(6)}  port id ${dpid.padStart(9)}`,`Timers: message expires in ${expires} sec, forward delay 0, forward transitions ${s.state==='forwarding'?1:0}`,bpdus(name,i.id)];};
  if(port){
    const logical=stpPortName(d,port.name),rows=list.filter(i=>(!ids||ids.includes(i.id))).map(i=>({i,s:i.ports.find(([n])=>n===logical)?.[1]})).filter(r=>r.s) as {i:Instance;s:StpPortState}[];
    if(!rows.length)return [`no spanning tree info available for ${port.name}`];
    const p=d.config.interfaces[logical]??port,first=rows[0],guard=p.features.rootGuard?'root':loopguardEnabled(d,p)?'loop':'none',type=stpType(e,d,logical,first.s),bound=/Bound\((\w+)\)/.exec(type),edgeCfg=p.features.portfast!==undefined;
    const head=['',roleLine(logical,first.i.id,first.s),`Edge port: ${(first.s.edge?'yes':'no').padEnd(15)}${(edgeCfg?'(configured)':'(default)').padEnd(17)}port guard : ${guard.padEnd(12)}(${p.features.rootGuard||p.features.loopGuard?'configured':'default'})`,`Link type: ${(String(first.s.linkType??'point-to-point')+(p.features.stpLinkType?'':' (auto)')).padEnd(32)}bpdu filter: ${(p.features.bpdufilter?'enable':'disable').padEnd(12)}(${p.features.bpdufilter!==undefined?'configured':'default'})`,`Boundary : ${(bound?`boundary (${bound[1]})`:'internal').padEnd(32)}bpdu guard : ${(bpduguardEnabled(d,p)?'enable':'disable').padEnd(12)}(${p.features.bpduguard!==undefined?'configured':'default'})`,bpdus(logical,first.i.id)];
    if(detail)return [...head,...rows.flatMap(r=>['',`MST${r.i.id}`,...portDetail(r.i,logical,r.s).slice(0,5)])];
    if(ids)return head;
    return [...head,'','Instance Role Sts Cost      Prio.Nbr Vlans mapped','-------- ---- --- --------- -------- -------------------------------',...rows.map(r=>{const sts=stsOf(r.s);return `${String(r.i.id).padEnd(8)} ${(ROLE[r.s.role??'']??'Desg').padEnd(4)} ${sts.length>3?sts:sts+' '}${String(r.s.cost??0).padEnd(9)} ${`${r.s.portPriority??128}.${r.s.portNumber??0}`.padEnd(8)} ${ranges(r.i.vlans)}`;})];
  }
  return selected.flatMap(map=>{
    const i=list.find(x=>x.id===map.id),configured=Number(m.priorities?.[map.id]??map.priority??stp.priority??32768),t=i?.tree,bridge=t?splitId(t.bridgeId):{priority:configured+map.id,mac:dotted(bridgeMac(d))},root=t?splitId(t.rootBridgeId):bridge,isRoot=!t||t.rootBridgeId===t.bridgeId||t.rootId===d.id,idLine=(x:{priority:number;mac:string})=>`address ${x.mac}  priority      ${String(x.priority).padEnd(6)}(${x.priority-x.priority%4096} sysid ${x.priority%4096})`;
    const rp=t?.rootPort?short(t.rootPort):'',lines=['',`##### MST${map.id}    vlans mapped:   ${ranges(map.vlans)}`,`Bridge        ${idLine(bridge)}`];
    if(isRoot)lines.push(`Root          this switch for ${map.id?'MST'+map.id:'the CIST'}`);
    else if(map.id)lines.push(`Root          ${idLine(root)}`,`              port    ${rp.padEnd(17)}cost          ${String(t!.cost??0).padEnd(10)}rem hops ${t!.hops??20}`);
    else if(t!.boundary)lines.push(`Root          ${idLine(root)}`,`              port    ${rp.padEnd(17)}path cost     ${String(t!.cost??0).padEnd(9)}`,'Regional Root this switch');
    else lines.push(`Root          ${idLine(root)}`,`              port    ${rp.padEnd(17)}path cost     ${'0'.padEnd(9)}`,`Regional Root ${idLine(root)}`,' '.repeat(39)+`internal cost ${String(t!.cost??0).padEnd(10)}rem hops ${t!.hops??20}`);
    if(!map.id)lines.push(`Operational   hello time ${secs(t?.helloTime,Number(stp.helloTime??2))} , forward delay ${secs(t?.forwardTime,Number(stp.forwardTime??15))}, max age ${secs(t?.maxAge,Number(stp.maxAge??20))}, txholdcount ${stp.transmitHoldCount??6} `,`Configured    hello time ${stp.helloTime??2} , forward delay ${stp.forwardTime??15}, max age ${stp.maxAge??20}, max hops    ${m.maxHops??20}`);
    if(!i)return lines;
    if(detail)return [...lines,...i.ports.flatMap(([n,s])=>['',roleLine(n,map.id,s),...portDetail(i,n,s)])];
    return [...lines,'','Interface        Role Sts Cost      Prio.Nbr Type','---------------- ---- --- --------- -------- --------------------------------',...i.ports.map(([n,s])=>stpRow(e,d,short(n),16,n,s))];
  });
}
const DEFAULT_VLANS:[number,string,string,string][]=[[1002,'fddi-default','fddi','-'],[1003,'token-ring-default','tr','-'],[1004,'fddinet-default','fdnet','ieee'],[1005,'trnet-default','trnet','ibm']];
function vlanRecords(d:Device):{id:number;name:string;status:string;type:string;stp:string}[] {
  const list=Object.values(d.config.vlans).map(v=>{const def=DEFAULT_VLANS.find(x=>x[0]===v.id);return {id:v.id,name:v.name,status:def?'act/unsup':v.active===false?'suspended':'active',type:def?def[2]:'enet',stp:def?def[3]:'-'};});
  if(ports(d).length)for(const [id,name,type,stp] of DEFAULT_VLANS)if(!list.some(v=>v.id===id))list.push({id,name,status:'act/unsup',type,stp});
  return list.sort((x,y)=>x.id-y.id);
}
function vlanPorts(e:Simulator,d:Device,v:number,trunks:boolean):string[] {
  const t=d.runtime.features.trunks??{};
  return ports(d).filter(p=>!p.features.channelGroup&&(t[p.name]?.operational?trunks&&e.interfaceUp(d.id,p.name)&&e.carriesVlan(d,p.name,v):p.mode!=='trunk'&&(p.vlan===v||switchVoiceVlan(d,p)===v))).map(p=>short(p.name));
}
function vlanShow(e:Simulator,d:Device,a:string[]):string[]|undefined {
  let view='full',filter:((v:{id:number;name:string})=>boolean)|undefined,missingText='';
  if(a.length){
    const all=['access-map','all','brief','dot1q','filter','id','ifindex','internal','mtu','name','private-vlan','remote-span','summary'],lower=a[0].toLowerCase(),found=all.includes(lower)?[lower]:all.filter(o=>o.startsWith(lower));
    if(found.length!==1||!['brief','id','name','summary','remote-span'].includes(found[0]))return undefined;
    view=found[0];a.shift();
    if(view==='id'){const text=a[0]??'';const ids=vlanList(a.shift());filter=v=>ids.includes(v.id);missingText=`VLAN id ${text} not found in current VLAN database`;}
    if(view==='name'){const name=a.shift()??missing();filter=v=>v.name===name;missingText=`VLAN name ${name} not found in current VLAN database`;}
  }
  exact(a);
  const records=vlanRecords(d);
  if(view==='summary'){const ext=records.filter(v=>v.id>1005).length;return [`Number of existing VLANs           : ${records.length}`,` Number of existing VTP VLANs      : ${records.length-ext}`,` Number of existing extended VLANS : ${ext}`];}
  const rspan=((d.config.features.rspanVlans??[]) as number[]).filter(v=>!!d.config.vlans[v]);
  if(view==='remote-span')return ['','Remote SPAN VLANs','-'.repeat(78),rspan.length?ranges(rspan):''];
  const selected=filter?records.filter(filter):records;if(filter&&!selected.length)return [missingText];
  const table=selected.flatMap(v=>{const members=vlanPorts(e,d,v.id,!!filter),chunks=members.length?Array.from({length:Math.ceil(members.length/4)},(_,i)=>members.slice(i*4,i*4+4).join(', ')):[''];return chunks.map((chunk,i)=>i?' '.repeat(48)+chunk:`${String(v.id).padEnd(4)} ${v.name.slice(0,32).padEnd(32)} ${v.status.padEnd(9)} ${chunk}`);});
  const head=['','VLAN Name                             Status    Ports','---- -------------------------------- --------- -------------------------------',...table];
  if(view==='brief')return head;
  return [...head,'','VLAN Type  SAID       MTU   Parent RingNo BridgeNo Stp  BrdgMode Trans1 Trans2','---- ----- ---------- ----- ------ ------ -------- ---- -------- ------ ------',...selected.map(v=>`${String(v.id).padEnd(4)} ${v.type.padEnd(5)} ${String(100000+v.id).padEnd(10)} 1500  -      -      -        ${v.stp.padEnd(4)} -        0      0`),'',
    ...(filter?['Remote SPAN VLAN','----------------',selected.some(v=>rspan.includes(v.id))?'Enabled':'Disabled']:['Remote SPAN VLANs','-'.repeat(78),rspan.length?ranges(rspan):'']),'','Primary Secondary Type              Ports','------- --------- ----------------- ------------------------------------------',''];
}
const CPU_MACS=['0100.0ccc.cccc','0100.0ccc.cccd',...Array.from({length:17},(_,i)=>'0180.c200.00'+i.toString(16).padStart(2,'0')),'ffff.ffff.ffff'];
function macTable(e:Simulator,d:Device,a:string[]):string[] {
  let type:string|undefined,vlan:number|undefined,address:string|undefined,port:InterfaceConfig|undefined,view='table';
  while(a.length){const key=word(a.shift(),['address','aging-time','count','dynamic','interface','static','vlan']);
    if(key==='dynamic'||key==='static'){if(type)bad();type=key;}
    else if(key==='address'){const raw=a.shift()??missing();if(!/^[0-9a-f:.]+$/i.test(raw)||raw.replace(/[:.]/g,'').length!==12)bad();address=dotted(raw);}
    else if(key==='interface'){if(port)bad();port=takePort(d,a);}
    else if(key==='vlan'){if(vlan!==undefined)bad();vlan=num(a.shift(),1,4094);}
    else{if(view!=='table')bad();view=key;}
  }
  const cfg=d.config.features,now=e.clock.now();
  if(view==='aging-time'){if(address||port||type)bad();const row=(v:number,t:number)=>String(v).padStart(4)+String(t).padStart(8);if(vlan!==undefined)return ['Vlan    Aging Time','----    ----------',row(vlan,cfg.macAgingVlans?.[vlan]??cfg.macAgingTime??300)];return [`Global Aging Time:${String(cfg.macAgingTime??300).padStart(5)}`,'Vlan    Aging Time','----    ----------',...Object.entries<number>(cfg.macAgingVlans??{}).sort(([x],[y])=>Number(x)-Number(y)).map(([v,t])=>row(Number(v),t))];}
  const all=Object.values(d.runtime.mac).filter(x=>x.static||x.expires>now),entries=all.filter(x=>(!type||(type==='static')===!!x.static)&&(vlan===undefined||vlan===x.vlan)&&(!address||address===dotted(x.mac))&&(!port||port.name===x.port)).sort((x,y)=>x.vlan-y.vlan||natural(x.mac,y.mac));
  if(view==='count'){
    const ids=vlan!==undefined?[vlan]:[...new Set([...Object.values(d.config.vlans).filter(v=>v.active!==false).map(v=>v.id),...entries.map(x=>x.vlan)])].sort((x,y)=>x-y),capacity=macCapacity(d);
    return [...ids.flatMap(v=>{const rows=entries.filter(x=>x.vlan===v);return ['',`Mac Entries for Vlan ${v}:`,'---------------------------',`Dynamic Address Count  : ${rows.filter(x=>!x.static).length}`,`Static  Address Count  : ${rows.filter(x=>x.static).length}`,`Total Mac Addresses    : ${rows.length}`];}),'',...(Number.isFinite(capacity)?[`Total Mac Address Space Available: ${Math.max(0,capacity-Object.keys(d.runtime.mac).length)}`]:[])];
  }
  const cpu=['switch','l3switch','poeswitch'].includes(d.kind)&&type!=='dynamic'&&vlan===undefined&&!port?CPU_MACS.filter(m=>!address||m===address):[];
  return ['          Mac Address Table','-------------------------------------------','','Vlan    Mac Address       Type        Ports','----    -----------       --------    -----',...cpu.map(m=>' All    '+m.padEnd(18)+'STATIC'.padEnd(12)+'CPU'),...entries.map(x=>String(x.vlan).padStart(4)+'    '+dotted(x.mac).padEnd(18)+(x.static?'STATIC':'DYNAMIC').padEnd(12)+short(x.port)),`Total Mac Addresses for this criterion: ${cpu.length+entries.length}`];
}
function linkStatus(e:Simulator,d:Device,p:InterfaceConfig):string {return p.features.errDisabled?'err-disabled':!p.adminUp?'disabled':e.interfaceUp(d.id,p.name)?'connected':'notconnect';}
function mediaType(name:string):string {return /^GigabitEthernet/i.test(name)?'10/100/1000BaseTX':/^(FastEthernet|Ethernet)/i.test(name)?'10/100BaseTX':/^TenGigabitEthernet/i.test(name)?'SFP-10GBase-SR':'';}
function channelOf(d:Device,p:InterfaceConfig):{group:string;po:InterfaceConfig|undefined;channel:any}|undefined {const g=p.features.channelGroup;if(g===undefined||g===null||/^Port-channel/i.test(p.name))return undefined;return {group:String(g),po:d.config.interfaces['Port-channel'+g],channel:d.runtime.features.portChannels?.[String(g)]};}
function trunking(d:Device,p:InterfaceConfig):boolean {const c=channelOf(d,p),name=c?.po?c.po.name:p.name;return !!d.runtime.features.trunks?.[name]?.operational;}
function speedDuplex(e:Simulator,d:Device,p:InterfaceConfig):[string,string] {
  const up=e.interfaceUp(d.id,p.name),c=d.runtime.features.portChannels?.[String(/^Port-channel(\d+)/i.exec(p.name)?.[1]??'')],member=/^Port-channel/i.test(p.name)?d.config.interfaces[(c?.activeMembers??[])[0]??(c?.members??[])[0]??'']:p,cfg=member??p;
  const fmt=(s:number)=>s>=10000?s/1000+'G':String(s);
  if(!up)return [cfg.duplex==='auto'||!cfg.duplex?'auto':cfg.duplex,speedIsAuto(cfg)?'auto':fmt(cfg.speed)];
  const state=e.ethernetState(d.id,cfg.name),speed=state?.speed??interfaceSpeed(d,cfg),duplex=state?.duplex??interfaceDuplex(d,cfg),dAuto=state?.duplexAuto??cfg.duplex==='auto',sAuto=state?.speedAuto??speedIsAuto(cfg);
  return [(dAuto?'a-':'')+(duplex==='half'?'half':'full'),(sAuto?'a-':'')+fmt(speed)];
}
function interfacesL2(e:Simulator,d:Device,a:string[]):string[]|undefined {
  if(!a.length)return undefined;
  const opts=['status','description','counters','switchport','trunk'],b=[...a];let port:InterfaceConfig|undefined;
  if(!opts.some(o=>o.startsWith(b[0].toLowerCase()))){try{port=takePort(d,b);}catch{return undefined;}}
  if(!b.length)return undefined;
  const lower=b[0].toLowerCase(),found=opts.includes(lower)?[lower]:opts.filter(o=>o.startsWith(lower));
  if(found.length!==1||!['status','trunk','switchport'].includes(found[0]))return undefined;
  b.shift();const view=found[0];
  if(view==='status'){
    let errOnly=false;if(b.length){word(b.shift(),['err-disabled']);errOnly=true;}exact(b);
    const list=(port?[port]:allPorts(d)).filter(p=>physical(p.name));
    if(errOnly)return ['','Port      Name               Status       Reason               Err-disabled Vlans',...list.filter(p=>p.features.errDisabled).map(p=>`${short(p.name).padEnd(9)} ${(p.description??'').slice(0,18).padEnd(18)} ${'err-disabled'.padEnd(12)} ${String(d.runtime.features.errdisableCauses?.[p.name]??'unknown')}`)];
    return ['','Port      Name               Status       Vlan       Duplex  Speed Type ',...list.map(p=>{const [duplex,speed]=speedDuplex(e,d,p),vlan=!p.switchport?'routed':trunking(d,p)?'trunk':String(p.vlan??1);return `${short(p.name).padEnd(9)} ${(p.description??'').slice(0,18).padEnd(18)} ${linkStatus(e,d,p).padEnd(12)} ${vlan.padEnd(10)} ${duplex.padStart(6)} ${speed.padStart(6)} ${mediaType(p.name)}`;})];
  }
  exact(b);
  if(view==='trunk'){
    if(port&&!port.switchport)return [];
    const trunks=d.runtime.features.trunks??{},activeVlans=Object.values(d.config.vlans).filter(v=>v.active!==false&&(v.id<1002||v.id>1005)).map(v=>v.id);
    const list=(port?[port]:ports(d).filter(p=>!channelOf(d,p)&&trunks[p.name]?.operational)).filter(p=>physical(p.name));if(!list.length)return [];
    const info=list.map(p=>{const c=channelOf(d,p),logical=c?.po?c.po.name:p.name,t=trunks[logical],cfg=c?.po??p,on=!!t?.operational,allowed:number[]=on?(cfg.allowedVlans??Array.from({length:4094},(_,i)=>i+1)):[cfg.vlan??1],active=allowed.filter(v=>activeVlans.includes(v)),fwd=active.filter(v=>{const tree=d.runtime.stp[String(v)];return !tree||tree.ports[logical]?.state==='forwarding';});
      const mode=({trunk:'on','dynamic-desirable':'desirable','dynamic-auto':'auto',access:'off'} as Record<string,string>)[cfg.mode]??'off';
      return {name:short(p.name),mode,status:on?(c?'trunk-inbndl':'trunking'):'not-trunking',native:String(t?.nativeVlan??cfg.nativeVlan??1)+(on&&c?`(Po${c.group})`:''),allowed:on&&cfg.allowedVlans===null?'1-4094':ranges(allowed),active:ranges(active),fwd:ranges(fwd)};});
    return ['','Port        Mode             Encapsulation  Status        Native vlan',...info.map(r=>r.name.padEnd(12)+r.mode.padEnd(17)+'802.1q'.padEnd(15)+r.status.padEnd(14)+r.native),'','Port        Vlans allowed on trunk',...info.map(r=>r.name.padEnd(12)+r.allowed),'','Port        Vlans allowed and active in management domain',...info.map(r=>r.name.padEnd(12)+r.active),'','Port        Vlans in spanning tree forwarding state and not pruned',...info.map(r=>r.name.padEnd(12)+r.fwd)];
  }
  const vlanName=(v:number)=>{const x=d.config.vlans[v]??(DEFAULT_VLANS.some(y=>y[0]===v)?{name:DEFAULT_VLANS.find(y=>y[0]===v)![1],active:true}:undefined);return `${v} (${x&&x.active!==false?x.name:'Inactive'})`;};
  return (port?[port]:allPorts(d)).filter(p=>physical(p.name)).flatMap(p=>{
    if(!p.switchport)return [`Name: ${short(p.name)}`,'Switchport: Disabled',''];
    const c=channelOf(d,p),cfg=c?.po??p,on=trunking(d,p),up=e.interfaceUp(d.id,p.name),voice=switchVoiceVlan(d,p);
    const admin=({access:'static access',trunk:'trunk','dynamic-auto':'dynamic auto','dynamic-desirable':'dynamic desirable'} as Record<string,string>)[cfg.mode]??'static access';
    const oper=(!up?'down':on?'trunk':'static access')+(c?` (member of bundle Po${c.group})`:'');
    return [`Name: ${short(p.name)}`,'Switchport: Enabled',`Administrative Mode: ${admin}`,`Operational Mode: ${oper}`,'Administrative Trunking Encapsulation: dot1q',`Operational Trunking Encapsulation: ${on?'dot1q':'native'}`,`Negotiation of Trunking: ${cfg.mode==='access'||p.features.nonegotiate?'Off':'On'}`,`Access Mode VLAN: ${vlanName(cfg.vlan??1)}`,`Trunking Native Mode VLAN: ${vlanName(cfg.nativeVlan??1)}`,'Administrative Native VLAN tagging: enabled',`Voice VLAN: ${voice===undefined||voice==='none'?'none':typeof voice==='number'?vlanName(voice):voice}`,
      'Administrative private-vlan host-association: none ','Administrative private-vlan mapping: none ','Administrative private-vlan trunk native VLAN: none','Administrative private-vlan trunk Native VLAN tagging: enabled','Administrative private-vlan trunk encapsulation: dot1q','Administrative private-vlan trunk normal VLANs: none','Administrative private-vlan trunk associations: none','Administrative private-vlan trunk mappings: none','Operational private-vlan: none',
      `Trunking VLANs Enabled: ${cfg.allowedVlans===null||cfg.allowedVlans===undefined?'ALL':ranges(cfg.allowedVlans,'NONE')}`,'Pruning VLANs Enabled: 2-1001','Capture Mode Disabled','Capture VLANs Allowed: ALL','','Protected: false','Unknown unicast blocked: disabled','Unknown multicast blocked: disabled','Appliance trust: none',''];
  });
}
type Member={name:string;group:number;channel:any;p:InterfaceConfig;mode:string};
function members(d:Device,protocol:'lacp'|'pagp'|undefined,group?:number):Member[] {
  const modes=protocol==='lacp'?['active','passive']:protocol==='pagp'?['desirable','auto']:undefined;
  return allPorts(d).filter(p=>!/^Port-channel/i.test(p.name)&&p.features.channelGroup!==undefined&&p.features.channelGroup!==null&&(group===undefined||Number(p.features.channelGroup)===group)&&(!modes||modes.includes(p.features.channelMode))).map(p=>({name:p.name,group:Number(p.features.channelGroup),channel:d.runtime.features.portChannels?.[String(p.features.channelGroup)],p,mode:p.features.channelMode??'on'})).sort((x,y)=>x.group-y.group||natural(x.name,y.name));
}
const bundled=(m:Member)=>!!m.channel?.activeMembers?.includes(m.name);
const standby=(m:Member)=>!!m.channel?.standbyMembers?.includes(m.name);
const portNo=(d:Device,name:string)=>Math.max(1,Object.keys(d.config.interfaces).filter(n=>physical(n)&&!/^Port-channel/i.test(n)).sort(natural).indexOf(name)+1);
const ifIndex=(d:Device,name:string)=>Object.keys(d.config.interfaces).indexOf(name)+1;
function lacpState(active:boolean,fast:boolean,inBundle:boolean,hot:boolean,up:boolean):string {const v=(active?1:0)+(fast?2:0)+4+(inBundle?0x38:0)+(!inBundle&&!hot||!up?0x40:0);return '0x'+v.toString(16).toUpperCase();}
const groupedBy=(rows:Member[])=>[...new Set(rows.map(r=>r.group))].map(g=>({group:g,rows:rows.filter(r=>r.group===g)}));
const LACP_FLAGS=['Flags:  S - Device is requesting Slow LACPDUs ','        F - Device is requesting Fast LACPDUs','        A - Device is in Active mode       P - Device is in Passive mode     ',''];
const PAGP_FLAGS=['Flags:  S - Device is sending Slow hello.  C - Device is in Consistent state.','        A - Device is in Auto mode.        P - Device learns on physical port.'];
const PAGP_INTERNAL_FLAGS=[...PAGP_FLAGS,'        d - PAgP is down.','Timers: H - Hello timer is running.        Q - Quit timer is running.','        S - Switching timer is running.    I - Interface timer is running.'];
function lacpLocal(e:Simulator,d:Device,m:Member,detail:boolean):string[] {
  const up=e.interfaceUp(d.id,m.name),fast=m.p.features.lacpRate==='fast',active=m.mode==='active',state=!up?'down':bundled(m)?'bndl':standby(m)?'hot-sby':m.channel?.state==='suspended'?'susp':'indep',prio=String(m.p.features.lacpPortPriority??32768),key='0x'+m.group.toString(16),num='0x'+(0x100+portNo(d,m.name)).toString(16),hex=lacpState(active,fast,bundled(m),standby(m),up),flags=(fast?'F':'S')+(active?'A':'P');
  if(!detail)return [short(m.name).padEnd(10)+flags.padEnd(8)+state.padEnd(10)+prio.padEnd(14)+key.padEnd(10)+key.padEnd(8)+num.padEnd(12)+hex.padEnd(6)];
  const sys=`${d.config.features.lacpSystemPriority??32768},${dotted(bridgeMac(d))}`;
  return [...stateDecode(short(m.name).padEnd(10)+sys.padEnd(22)+num.padEnd(16)+'0s'.padEnd(12)+flags,prio,key,hex,'Actor')];
}
function stateDecode(head:string,prio:string,key:string,hex:string,who:'Actor'|'Partner'):string[] {
  const v=parseInt(hex,16),yn=(bit:number)=>v&bit?'Yes':'No';
  return [`          ${who.padEnd(22)}${who.padEnd(28)}${who}`,`Port      System ID             Port Number     Age         Flags`,head,'',`          LACP ${who.padEnd(17)}${who.padEnd(16)}${who}`,`          Port Priority         Oper Key        Port State`,'          '+prio.padEnd(22)+key.padEnd(16)+hex,'','          Port State Flags Decode:','          Activity:   Timeout:   Aggregation:   Synchronization:','          '+(v&1?'Active':'Passive').padEnd(12)+(v&2?'Short':'Long').padEnd(11)+yn(4).padEnd(15)+yn(8),'','          Collecting:   Distributing:   Defaulted:   Expired:','          '+yn(16).padEnd(14)+yn(32).padEnd(16)+yn(64).padEnd(13)+yn(128)];
}
function lacpPartner(e:Simulator,d:Device,m:Member,detail:boolean):string[] {
  const peer=switchingPeer(e,d.id,m.name,'LACP');if(!peer)return [];
  const other=e.getDevice(peer.deviceId),pm:Member|undefined=other?members(other,'lacp').find(x=>x.name===peer.port):undefined,fast=peer.timeout!==undefined&&peer.timeout<=3000,active=peer.mode==='active',inBundle=pm?bundled(pm):!!peer.synchronized,hex=lacpState(active,fast,inBundle,pm?standby(pm):false,true),flags=(fast?'F':'S')+(active?'A':'P'),prio=String(peer.portPriority??32768),num='0x'+(0x100+(other?portNo(other,peer.port):1)).toString(16),key='0x'+Number(peer.group??0).toString(16),ageS=Math.max(0,Math.floor((e.clock.now()-(peer.lastReceived??e.clock.now()))/1000))+'s';
  if(detail)return stateDecode(short(m.name).padEnd(10)+`${peer.systemPriority??32768},${dotted(peer.systemMac??'')}`.padEnd(22)+num.padEnd(16)+ageS.padEnd(12)+flags,prio,key,hex,'Partner');
  return [short(m.name).padEnd(10)+flags.padEnd(8)+prio.padEnd(10)+dotted(peer.systemMac??'').padEnd(14)+' '+ageS.padStart(4)+'    '+'0x0'.padEnd(7)+key.padEnd(7)+num.padEnd(8)+hex];
}
function pagpLocal(e:Simulator,d:Device,m:Member):string {const up=e.interfaceUp(d.id,m.name),b=bundled(m),flags='S'+(b?'C':'')+(m.mode==='auto'?'A':''),state=b?'U6/S7':up?'U2/S1':'U1/S1',received=!!switchingPeer(e,d.id,m.name,'PAGP');return short(m.name).padEnd(10)+flags.padEnd(6)+state.padEnd(8)+(up?'H':'').padEnd(8)+'30s'.padEnd(9)+(received?'1':'0').padEnd(8)+String(m.p.features.pagpPortPriority??128).padEnd(11)+'Any'.padEnd(8)+ifIndex(d,m.name);}
function pagpPartner(e:Simulator,d:Device,m:Member):string[] {const peer=switchingPeer(e,d.id,m.name,'PAGP');if(!peer)return [];const other=e.getDevice(peer.deviceId),pm=other?members(other,'pagp').find(x=>x.name===peer.port):undefined,flags='S'+(pm&&bundled(pm)?'C':'')+(peer.mode==='auto'?'A':''),ageS=Math.max(0,Math.floor((e.clock.now()-(peer.lastReceived??e.clock.now()))/1000))+'s';return [short(m.name).padEnd(10)+String(other?.config.hostname??'').slice(0,20).padEnd(21)+dotted(peer.systemMac??(other?bridgeMac(other):'')).padEnd(17)+short(peer.port).padEnd(11)+ageS.padStart(4)+' '+flags.padEnd(8)+(0x10000+Number(peer.group??0)).toString(16)];}
function lacp(e:Simulator,d:Device,a:string[]):string[] {
  let group:number|undefined;if(/^\d+$/.test(a[0]??''))group=num(a.shift(),1,4096);
  const kind=word(a.shift(),group===undefined?['counters','internal','neighbor','sys-id']:['counters','internal','neighbor']);let detail=false;if(a.length&&kind!=='sys-id'&&kind!=='counters'){word(a.shift(),['detail']);detail=true;}exact(a);
  if(kind==='sys-id')return [`${d.config.features.lacpSystemPriority??32768}, ${dotted(bridgeMac(d))}`];
  const groups=groupedBy(members(d,'lacp',group));
  if(kind==='counters')return ['             LACPDUs         Marker      Marker Response    LACPDUs','Port       Sent   Recv     Sent   Recv     Sent   Recv      Pkts Err','-'.repeat(69),...groups.flatMap(g=>[`Channel group: ${g.group}`,...g.rows.map(m=>{const c=d.runtime.features.switchingMessages?.[m.name]?.LACP;return short(m.name).padEnd(11)+String(c?.sent??0).padEnd(7)+String(c?.received??0).padEnd(9)+'0'.padEnd(7)+'0'.padEnd(9)+'0'.padEnd(7)+'0'.padEnd(10)+String(c?.errors??0);})])];
  if(kind==='internal')return [...LACP_FLAGS,...groups.flatMap(g=>[`Channel group ${g.group}`,...(detail?g.rows.flatMap((m,i)=>[...(i?['']:[]),...lacpLocal(e,d,m,true)]):['                            LACP port     Admin     Oper    Port        Port','Port      Flags   State     Priority      Key       Key     Number      State',...g.rows.flatMap(m=>lacpLocal(e,d,m,false))]),''])];
  return [...LACP_FLAGS,...groups.flatMap(g=>[`Channel group ${g.group} neighbors`,'',...(detail?["Partner's information:",'',...g.rows.flatMap((m,i)=>[...(i?['']:[]),...lacpPartner(e,d,m,true)])]:["Partner's information:",'','                  LACP port                        Admin  Oper   Port    Port','Port      Flags   Priority  Dev ID          Age    key    Key    Number  State',...g.rows.flatMap(m=>lacpPartner(e,d,m,false))]),''])];
}
function pagp(e:Simulator,d:Device,a:string[]):string[] {
  let group:number|undefined;if(/^\d+$/.test(a[0]??''))group=num(a.shift(),1,4096);
  const kind=word(a.shift(),['counters','internal','neighbor']);if(a.length&&kind!=='counters'){word(a.shift(),['detail']);}exact(a);
  const groups=groupedBy(members(d,'pagp',group));
  if(kind==='counters')return ['          Information         Flush        PAgP','Port      Sent    Recv     Sent    Recv    Err Pkts','-'.repeat(51),...groups.flatMap(g=>[`Channel group: ${g.group}`,...g.rows.map(m=>{const c=d.runtime.features.switchingMessages?.[m.name]?.PAGP;return '  '+short(m.name).padEnd(8)+String(c?.sent??0).padEnd(8)+String(c?.received??0).padEnd(9)+'0'.padEnd(8)+'0'.padEnd(8)+String(c?.errors??0);})])];
  if(kind==='internal')return [...PAGP_INTERNAL_FLAGS,...groups.flatMap(g=>['',`Channel group ${g.group}`,'                                Hello    Partner  PAgP     Learning  Group','Port      Flags State   Timers  Interval Count   Priority   Method  Ifindex',...g.rows.map(m=>pagpLocal(e,d,m))])];
  return [...PAGP_FLAGS,...groups.flatMap(g=>['',`Channel group ${g.group} neighbors`,'          Partner              Partner          Partner         Partner Group','Port      Name                 Device ID        Port       Age  Flags   Cap.',...g.rows.flatMap(m=>pagpPartner(e,d,m))])];
}
const EC_FLAGS=['Flags:  D - down        P - bundled in port-channel','        I - stand-alone s - suspended','        H - Hot-standby (LACP only)','        R - Layer3      S - Layer2','        U - in use      N - not in use, no aggregation','        f - failed to allocate aggregator','','        M - not in use, minimum links not met','        m - not in use, port not aggregated due to minimum links not met','        u - unsuitable for bundling','        w - waiting to be aggregated','        d - default port','','        A - formed by Auto LAG'];
const EC_MODE:Record<string,string>={active:'Active',passive:'Passive',desirable:'Desirable-Sl',auto:'Automatic-Sl',on:'On'};
const LOAD_BALANCE:Record<string,[string,string,string]>={'src-mac':['Source MAC address','Source MAC address','Source MAC address'],'dst-mac':['Destination MAC address','Destination MAC address','Destination MAC address'],'src-dst-mac':['Source XOR Destination MAC address','Source XOR Destination MAC address','Source XOR Destination MAC address'],'src-ip':['Source MAC address','Source IP address','Source IP address'],'dst-ip':['Destination MAC address','Destination IP address','Destination IP address'],'src-dst-ip':['Source XOR Destination MAC address','Source XOR Destination IP address','Source XOR Destination IP address']};
function etherchannel(e:Simulator,d:Device,a:string[]):string[] {
  let group:number|undefined;if(/^\d+$/.test(a[0]??''))group=num(a.shift(),1,4096);
  const kind=word(a.shift(),['summary','detail','port-channel','load-balance']);exact(a);
  if(kind==='load-balance'){const method=d.config.features.etherchannel?.loadBalance??'src-dst-mac',used=LOAD_BALANCE[method]??LOAD_BALANCE['src-dst-mac'];return ['EtherChannel Load-Balancing Configuration:',`        ${method}`,'','EtherChannel Load-Balancing Addresses Used Per-Protocol:',`Non-IP: ${used[0]}`,`  IPv4: ${used[1]}`,`  IPv6: ${used[2]}`];}
  const channels=Object.entries<any>(d.runtime.features.portChannels??{}).filter(([id])=>group===undefined||Number(id)===group).sort((x,y)=>Number(x[0])-Number(y[0]));
  const proto=(c:any)=>c.protocol==='lacp'?'LACP':c.protocol==='pagp'?'PAgP':'-';
  const layer=(id:string,c:any)=>(d.config.interfaces['Port-channel'+id]??d.config.interfaces[c.members[0]])?.switchport?'S':'R';
  const flag=(c:any,name:string)=>c.activeMembers?.includes(name)?'P':c.standbyMembers?.includes(name)?'H':c.state==='suspended'?'s':!e.interfaceUp(d.id,name)?'D':c.protocol==='static'?'s':'I';
  if(kind==='summary'){
    const rows=channels.flatMap(([id,c])=>{const names=[...c.members].sort(natural).map((n:string)=>`${short(n)}(${flag(c,n)})`.padEnd(12)),lines:string[]=[];for(let i=0;i<Math.max(1,names.length);i+=3)lines.push((i?' '.repeat(33):id.padEnd(7)+`Po${id}(${layer(id,c)}${c.state==='up'?'U':'D'})`.padEnd(14)+(c.protocol==='static'?'   -':'  '+proto(c)).padEnd(12))+names.slice(i,i+3).join(''));return lines;});
    return [...EC_FLAGS,'','',`Number of channel-groups in use: ${channels.length}`,`Number of aggregators:           ${channels.length}`,'','Group  Port-channel  Protocol    Ports','------+-------------+-----------+-----------------------------------------------',...rows];
  }
  const now=e.clock.now(),uptime=now-Number(d.runtime.features.bootTime??0),protocolValue=(c:any)=>c.protocol==='static'?'    -':'   '+proto(c);
  const channelSection=(id:string,c:any)=>{const active:string[]=c.activeMembers??[],n=active.length,load=(i:number)=>{let v=0,b=0;for(let bit=0;bit<8;bit++)if(n&&bit%n===i){v|=1<<bit;b++;}return [v.toString(16).toUpperCase().padStart(2,'0'),b] as const;};
    return [' '.repeat(16)+'Port-channels in the group: ',' '.repeat(16)+'---------------------------','',`Port-channel: Po${id}${c.protocol==='lacp'?'    (Primary Aggregator)':''}`,'','------------','',`Age of the Port-channel   = ${age(uptime)}`,`Logical slot/port   = 2/${id}`.padEnd(35)+`Number of ports = ${n}`,'HotStandBy port = null ',`Port state          = Port-channel ${c.state==='up'?'Ag-Inuse':'Ag-Not-Inuse'} `,`Protocol            = ${protocolValue(c)}`,'Port security       = Disabled','',...(n?['Ports in the Port-channel: ','','Index   Load   Port     EC state        No of bits','------+------+------+------------------+-----------',...active.map((name,i)=>{const [hex,bits]=load(i);return `  ${String(i).padEnd(6)}${hex.padEnd(7)}${short(name).padEnd(9)}${(EC_MODE[d.config.interfaces[name]?.features.channelMode??'on']??'On').padEnd(19)}${bits}`;}),'']:[])];};
  const header=[' '.repeat(16)+'Channel-group listing: ',' '.repeat(16)+'----------------------',''];
  if(kind==='port-channel')return [...header,...channels.flatMap(([id,c])=>[`Group: ${id} `,'----------',...channelSection(id,c)])];
  return [...header,...channels.flatMap(([id,c])=>{const list=members(d,undefined,Number(id));
    const portBlock=(m:Member,index:number)=>{const up=e.interfaceUp(d.id,m.name),b=bundled(m),s=standby(m),lacpPort=c.protocol==='lacp';
      const state=!up?'Down Not-in-Bndl ':b?(lacpPort?'Up Mstr Assoc In-Bndl ':'Up Mstr In-Bndl '):s?'Up Mstr Assoc Not-In-Bndl Hot-Stdby ':lacpPort?'Up Indep ':'Up Mstr Not-in-Bndl ';
      const gc=c.protocol==='pagp'?'0x'+(0x10000+Number(id)).toString(16).padStart(8,'0'):'  -';
      const body=c.protocol==='lacp'?['Flags:  S - Device is sending Slow LACPDUs   F - Device is sending fast LACPDUs.','        A - Device is in active mode.        P - Device is in passive mode.','','Local information:','                            LACP port     Admin     Oper    Port        Port','Port      Flags   State     Priority      Key       Key     Number      State',...lacpLocal(e,d,m,false),'',"Partner's information:",'','                  LACP port                        Admin  Oper   Port    Port','Port      Flags   Priority  Dev ID          Age    key    Key    Number  State',...lacpPartner(e,d,m,false),'']:c.protocol==='pagp'?[...PAGP_INTERNAL_FLAGS,'','Local information:','                                Hello    Partner  PAgP     Learning  Group','Port      Flags State   Timers  Interval Count   Priority   Method  Ifindex',pagpLocal(e,d,m),'',"Partner's information:",'','          Partner              Partner          Partner         Partner Group','Port      Name                 Device ID        Port       Age  Flags   Cap.',...pagpPartner(e,d,m),'']:[];
      return [`Port: ${short(m.name)}`,'------------','',`Port state    = ${state}`,`Channel group = ${id.padEnd(12)}Mode = ${(EC_MODE[m.mode]??'On').padEnd(15)}Gcchange = ${c.protocol==='pagp'?'0':'-'}`,`Port-channel  = ${(b||s?'Po'+id:'null').padEnd(12)}GC   = ${gc.padEnd(15)}Pseudo port-channel = Po${id}`,`Port index    = ${String(Math.max(0,index)).padEnd(12)}Load = ${'0x00'.padEnd(15)}Protocol = ${protocolValue(c)}`,'',...body,`Age of the port in the current state: ${age(uptime)}`];};
    return [`Group: ${id} `,'----------',`Group state = ${layer(id,c)==='S'?'L2':'L3'} `,`Ports: ${list.length}   Maxports = ${c.protocol==='pagp'?8:16}`,`Port-channels: 1 Max Port-channels = ${c.protocol==='pagp'?1:16}`,`Protocol: ${protocolValue(c)}`,...(c.protocol==='lacp'?['Minimum Links: 0']:[]),' '.repeat(16)+'Ports in the group:',' '.repeat(16)+'-------------------',...list.flatMap(m=>portBlock(m,(c.activeMembers??[]).indexOf(m.name))),'',...channelSection(id,c)];
  })];
}
const MODE_LABEL:Record<string,string>={server:'Server',client:'Client',transparent:'Transparent',off:'Off'};
const ipOf=(x:Device)=>Object.values(x.config.interfaces).filter(p=>/^Vlan\d+$/i.test(p.name)&&p.ip&&p.adminUp).sort((p,q)=>natural(p.name,q.name))[0];
const vtpTime=(t:Date)=>`${t.getUTCMonth()+1}-${t.getUTCDate()}-${pad2(t.getUTCFullYear()%100)} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`;
function vtp(e:Simulator,d:Device,a:string[]):string[]|undefined {
  const cfg=d.config.features.vtp;if(!a.length||!cfg)return undefined;
  const kind=word(a.shift(),['counters','devices','interface','password','status','conflicts']),version=Number(cfg.version??1),label=(text:string,width:number)=>text.padEnd(width)+': ';
  if(kind==='interface'){const selected=a.length?[takePort(d,a)]:ports(d).filter(p=>!/^Port-channel/i.test(p.name));exact(a);if(selected.some(p=>!p.switchport))bad();return ['Interface                      VTP Status','-'.repeat(42),...selected.map(p=>p.name.padEnd(31)+(p.features.vtp===false?'disabled':'enabled'))];}
  if(kind==='devices'||kind==='conflicts'){if(kind==='devices'&&a.length)word(a.shift(),['conflicts']);exact(a);if(version!==3)return ['Device information can be only retrieved in VTP version 3'];return ['Retrieving information from the VTP domain. Waiting for 5 seconds.','','VTP Feature  Conf Revision Primary Server  Device ID       Device Description','------------ ---- -------- --------------- --------------- ----------------------',...(cfg.mode==='server'||cfg.mode==='client'?[`VLAN         No   ${String(cfg.revision??0).padEnd(9)}0000.0000.0000  ${dotted(bridgeMac(d)).padEnd(16)}${d.config.hostname}`]:[])];}
  exact(a);
  if(kind==='password')return [cfg.password?'VTP Password: '+cfg.password:'The VTP password is not configured.'];
  if(kind==='counters'){const msgs=Object.entries<any>(d.runtime.features.switchingMessages??{}).filter(([,r])=>r.VTP),sum=(f:string)=>msgs.reduce((n,[,r])=>n+Number(r.VTP[f]??0),0),trunks=ports(d).filter(p=>!channelOf(d,p)&&d.runtime.features.trunks?.[p.name]?.operational);
    return ['VTP statistics:',label('Summary advertisements received',35)+Math.max(0,sum('received')-sum('errors')),label('Subset advertisements received',35)+(d.runtime.features.vtpSyncCount??0),label('Request advertisements received',35)+0,label('Summary advertisements transmitted',35)+sum('sent'),label('Subset advertisements transmitted',35)+0,label('Request advertisements transmitted',35)+0,label('Number of config revision errors',35)+0,label('Number of config digest errors',35)+sum('errors'),label('Number of V1 summary errors',35)+0,'','','VTP pruning statistics:','','Trunk            Join Transmitted Join Received    Summary advts received from','                                                   non-pruning-capable device','---------------- ---------------- ---------------- ---------------------------',...trunks.map(p=>short(p.name).padEnd(20)+'0'.padEnd(17)+'0'.padEnd(17)+'0')];}
  const vlans=vlanRecords(d),sync=[d.runtime.features.vtpLastSync,d.runtime.features.vtpLastModified].filter(Boolean).sort((x:any,y:any)=>y.at-x.at)[0],origin=sync?(sync.hostname===d.config.hostname?d:e.lab.devices.find(x=>x.config.hostname===sync.hostname)):undefined,local=ipOf(d),mode=MODE_LABEL[cfg.mode]??'Server';
  const bytes=digest(JSON.stringify([cfg.domain??'',cfg.password??'',cfg.revision??0,vlans.filter(v=>v.id<=1005).map(v=>[v.id,v.name,v.status])])),hex=bytes.map(b=>'0x'+b.toString(16).toUpperCase().padStart(2,'0'));
  const md5=[label('MD5 digest',34)+hex.slice(0,8).join(' ')+' ',' '.repeat(36)+hex.slice(8).join(' ')+' '];
  const head=[label('VTP Version capable',32)+'1 to 3',label('VTP version running',32)+version,label('VTP Domain Name',32)+(cfg.domain??''),label('VTP Pruning Mode',32)+(cfg.pruning?'Enabled':'Disabled'),label('VTP Traps Generation',32)+'Disabled',label('Device ID',32)+dotted(bridgeMac(d))];
  if(version===3)return [...head,'','Feature VLAN:','--------------',label('VTP Operating Mode',34)+mode,label('Number of existing VLANs',34)+vlans.filter(v=>v.id<=1005).length,label('Number of existing extended VLANs',34)+vlans.filter(v=>v.id>1005).length,label('Maximum VLANs supported locally',34)+4096,label('Configuration Revision',34)+(cfg.revision??0),label('Primary ID',34)+'0000.0000.0000',label('Primary Description',34),...md5,'','','Feature MST:','--------------',label('VTP Operating Mode',34)+'Transparent','','','Feature UNKNOWN:','--------------',label('VTP Operating Mode',34)+'Transparent',''];
  const originIp=origin?ipOf(origin)?.ip??'0.0.0.0':'0.0.0.0';
  return [...head,`Configuration last modified by ${originIp} at ${sync?vtpTime(wall(d,sync.at)):'0-0-00 00:00:00'}`,...(cfg.mode==='server'?[local?`Local updater ID is ${local.ip} on interface ${short(local.name).replace(/^Vlan/i,'Vl')} (lowest numbered VLAN interface found)`:'Local updater ID is 0.0.0.0 (no valid interface found)']:[]),'','Feature VLAN:','--------------',label('VTP Operating Mode',34)+mode,label('Maximum VLANs supported locally',34)+1005,label('Number of existing VLANs',34)+vlans.length,label('Configuration Revision',34)+(cfg.revision??0),...md5];
}
const dtpAdmin=(p:InterfaceConfig)=>p.features.nonegotiate?'NONEGOTIATE':({trunk:'ON',access:'OFF','dynamic-auto':'AUTO','dynamic-desirable':'DESIRABLE'} as Record<string,string>)[p.mode]??'AUTO';
function dtp(e:Simulator,d:Device,a:string[]):string[] {
  const candidates=ports(d).filter(p=>!/^Port-channel/i.test(p.name));
  if(!a.length)return ['Global DTP information',' '.repeat(8)+'Sending DTP Hello packets every 30 seconds',' '.repeat(8)+'Dynamic Trunk timeout is 300 seconds',' '.repeat(8)+`${candidates.filter(p=>!p.features.nonegotiate).length} interfaces using DTP`];
  word(a.shift(),['interface']);const selected=a.length?[takePort(d,a)]:candidates;exact(a);if(selected.some(p=>!p.switchport))bad();
  const now=e.clock.now(),line=(text:string,value:string|number)=>'  '+text.padEnd(42)+value;
  return selected.flatMap(p=>{const c=channelOf(d,p),logical=c?.po?c.po.name:p.name,on=!!d.runtime.features.trunks?.[logical]?.operational,state=on?'TRUNK':'ACCESS',up=e.interfaceUp(d.id,p.name),enabled=!p.features.nonegotiate,peer=switchingPeer(e,d.id,p.name,'DTP'),other=peer?e.getDevice(peer.deviceId):undefined,nbr=(peer?String(e.macOf(peer.deviceId,peer.port)??''):'').replace(/[^0-9a-f]/gi,'').toUpperCase().padStart(12,'0'),stats=d.runtime.features.switchingMessages?.[p.name]?.DTP??{sent:0,received:0,errors:0},good=Math.max(0,Number(stats.received)-Number(stats.errors)),boot=Number(d.runtime.features.bootTime??0),t=wall(d,boot),days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return [`DTP information for ${p.name}:`,line('TOS/TAS/TNS:',`${state}/${dtpAdmin(p)}/${state}`),line('TOT/TAT/TNT:',on?'802.1Q/802.1Q/802.1Q':'NATIVE/802.1Q/NATIVE'),line('Neighbor address 1:',nbr),line('Neighbor address 2:','000000000000'),line('Hello timer expiration (sec/state):',up&&enabled?`${30-Math.floor(now/1000)%30}/RUNNING`:'never/STOPPED'),line('Access timer expiration (sec/state):',peer&&up&&enabled?`${Math.max(0,Math.ceil((peer.expires-now)/1000))}/RUNNING`:'never/STOPPED'),line('Negotiation timer expiration (sec/state):','never/STOPPED'),line('Multidrop timer expiration (sec/state):','never/STOPPED'),line('FSM state:',!up||!enabled?'S1:OFF':on?'S6:TRUNK':'S2:ACCESS'),line('# times multi & trunk',0),line('Enabled:',enabled?'yes':'no'),line('In STP:',Object.values(d.runtime.stp).some(tree=>tree.ports[stpPortName(d,p.name)])?'yes':'no'),'','  Statistics','  ----------',`  ${stats.received} packets received (${good} good)`,`  ${stats.errors} packets dropped`,`      0 nonegotiate, 0 bad version, ${stats.errors} domain mismatches,`,'      0 bad TLVs, 0 bad TAS, 0 bad TAT, 0 bad TOT, 0 other',`  ${stats.sent} packets output (${stats.sent} good)`,`      ${stats.sent} native, 0 software encap isl, 0 isl hardware native`,'  0 output errors','  0 trunk timeouts',up?`  1 link ups, last link up on ${days[t.getUTCDay()]} ${months[t.getUTCMonth()]} ${pad2(t.getUTCDate())} ${t.getUTCFullYear()}, ${hms(t.getUTCHours()*3600000+t.getUTCMinutes()*60000+t.getUTCSeconds()*1000)}`:'  0 link ups','  0 link downs',''];});
}
const causeLabel=(c:string)=>c==='channel-misconfig'?'channel-misconfig (STP)':c;
function errdisable(e:Simulator,d:Device,a:string[]):string[] {
  const kind=word(a.shift(),['detect','recovery','flap-values']);exact(a);const cfg=d.config.features.errdisable??{},causes:string[]=cfg.causes??[];
  if(kind==='flap-values')return ['ErrDisable Reason    Flaps    Time (sec)','-----------------    ------   ----------','pagp-flap'.padEnd(23)+'3'.padEnd(8)+'30','dtp-flap'.padEnd(23)+'3'.padEnd(8)+'30','link-flap'.padEnd(23)+'5'.padEnd(8)+'10'];
  if(kind==='detect')return ['ErrDisable Reason            Detection    Mode','-----------------            ---------    ----',...ERRDISABLE_CAUSES.map(c=>causeLabel(c).padEnd(29)+(errdisableDetectionEnabled(d,c)?'Enabled':'Disabled').padEnd(13)+(c==='psecure-violation'?'port/vlan':'port'))];
  const now=e.clock.now(),pending=Object.entries<number>(d.runtime.features.errdisableDeadline??{}).filter(([port])=>d.config.interfaces[port]?.features.errDisabled).sort(([x],[y])=>natural(x,y));
  return ['ErrDisable Reason            Timer Status','-----------------            --------------',...ERRDISABLE_CAUSES.map(c=>causeLabel(c).padEnd(29)+(causes.includes('all')||causes.includes(c)?'Enabled':'Disabled')),'',`Timer interval: ${cfg.interval??300} seconds`,'','Interfaces that will be enabled at the next timeout:','',...(pending.length?['Interface       Errdisable reason       Time left(sec)','---------       -----------------       --------------',...pending.map(([port,deadline])=>short(port).padEnd(16)+String(d.runtime.features.errdisableCauses?.[port]??'unknown').padEnd(24)+Math.max(0,Math.ceil((deadline-now)/1000))),'']:[])];
}
function storm(e:Simulator,d:Device,a:string[]):string[] {
  const kinds=['broadcast','multicast','unicast'];let port:InterfaceConfig|undefined,kind='broadcast';
  if(a.length&&!kinds.some(v=>v.startsWith(a[0].toLowerCase())))port=takePort(d,a);if(a.length)kind=word(a.shift(),kinds);exact(a);if(port&&!port.switchport)bad();
  const selected=port?[port]:ports(d).filter(p=>p.features.stormControl?.[kind]!==undefined),now=Math.floor(e.clock.now()/1000),pct=(v:number)=>v.toFixed(2)+'%';
  return ['Interface  Filter State   Upper        Lower        Current','---------  -------------  -----------  -----------  ----------',...selected.map(p=>{const setting=p.features.stormControl?.[kind],meter=d.runtime.features.stormMeters?.[p.name+':'+kind],current=meter?.window===now?meter.bytes*8/(interfaceSpeed(d,p)*1000000)*100:0,blocked=meter?.blocked&&now-meter.window<=1,state=setting===undefined?'Inactive':!e.interfaceUp(d.id,p.name)?'Link Down':blocked?'Blocking':'Forwarding',upper=setting===undefined?100:Number(typeof setting==='number'?setting:setting.rising),lower=setting===undefined?100:Number(typeof setting==='number'?setting:setting.falling??setting.rising);
    return short(p.name).padEnd(11)+state.padEnd(15)+pct(upper).padStart(11)+'  '+pct(lower).padStart(11)+'  '+pct(Math.min(100,current)).padStart(10);})];
}
const clean=(m:string)=>m.replace(/[^0-9a-f]/gi,'').toLowerCase();
const ACTION:Record<string,string>={shutdown:'Shutdown',restrict:'Restrict',protect:'Protect'};
function secureEntries(d:Device,p:InterfaceConfig):{mac:string;type:string}[] {
  const c=p.features.portSecurity??{},configured:string[]=(c.macs??[]).map(clean),dynamic:string[]=(d.runtime.features.secureMacs?.[p.name]??[]).map(clean),seen=new Set<string>(),out:{mac:string;type:string}[]=[];
  for(const m of configured)if(!seen.has(m)){seen.add(m);out.push({mac:m,type:c.sticky?'SecureSticky':'SecureConfigured'});}
  for(const m of dynamic)if(!seen.has(m)){seen.add(m);out.push({mac:m,type:'SecureDynamic'});}
  return out;
}
function portSecurity(e:Simulator,d:Device,a:string[]):string[] {
  let port:InterfaceConfig|undefined,address=false;
  while(a.length){const key=word(a.shift(),port?['address']:['address','interface']);if(key==='interface'){if(address)bad();port=takePort(d,a);}else{if(address)bad();address=true;}}
  if(port&&!port.switchport)return [];
  const secured=allPorts(d).filter(p=>p.switchport&&p.features.portSecurity&&p.features.portSecurity.enabled!==false),extra=secured.reduce((n,p)=>n+Math.max(0,secureEntries(d,p).length-1),0),totals=[`Total Addresses in System (excluding one mac per port)     : ${extra}`,'Max Addresses limit in System (excluding one mac per port) : 4096'];
  if(address){const now=e.clock.now(),rows=(port?secured.filter(p=>p===port):secured).flatMap(p=>{const c=p.features.portSecurity;return secureEntries(d,p).map(x=>{const times=d.runtime.features.secureMacTimes?.[p.name+'|'+x.mac],aging=Number(c.agingTime)>0&&times&&(x.type==='SecureDynamic'||c.agingStatic),left=aging?String(Math.max(0,Math.ceil(((c.agingType==='inactivity'?times.last:times.first)+Number(c.agingTime)*60000-now)/60000))):'-';return String(p.vlan??1).padStart(4)+'    '+dotted(x.mac).padEnd(18)+x.type.padEnd(30)+short(p.name).padEnd(13)+left;});});
    return ['               Secure Mac Address Table','-'.repeat(77),'Vlan    Mac Address       Type                          Ports   Remaining Age','                                                                   (mins)    ','----    -----------       ----                          -----   -------------',...rows,'-'.repeat(77),...totals];}
  if(port){const c=port.features.portSecurity??{},enabled=!!port.features.portSecurity&&c.enabled!==false,entries=secureEntries(d,port),last=d.runtime.features.portSecurityLastSource?.[port.name],label=(t:string)=>t.padEnd(27)+': ';
    return [label('Port Security')+(enabled?'Enabled':'Disabled'),label('Port Status')+(port.features.errDisabled&&d.runtime.features.errdisableCauses?.[port.name]==='psecure-violation'?'Secure-shutdown':enabled&&e.interfaceUp(d.id,port.name)?'Secure-up':'Secure-down'),label('Violation Mode')+(ACTION[c.violation??'shutdown']??'Shutdown'),label('Aging Time')+`${c.agingTime??0} mins`,label('Aging Type')+(c.agingType==='inactivity'?'Inactivity':'Absolute'),label('SecureStatic Address Aging')+(c.agingStatic?'Enabled':'Disabled'),label('Maximum MAC Addresses')+(c.maximum??1),label('Total MAC Addresses')+entries.length,label('Configured MAC Addresses')+entries.filter(x=>x.type==='SecureConfigured').length,label('Sticky MAC Addresses')+entries.filter(x=>x.type==='SecureSticky').length,label('Last Source Address:Vlan')+(last?`${dotted(last.mac)}:${last.vlan}`:'0000.0000.0000:0'),label('Security Violation Count')+(d.runtime.features.portSecurityPortViolations?.[port.name]??0)];}
  return ['Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action','                (Count)       (Count)          (Count)','-'.repeat(75),...secured.map(p=>{const c=p.features.portSecurity;return short(p.name).padStart(11)+String(c.maximum??1).padStart(15)+String(secureEntries(d,p).length).padStart(13)+String(d.runtime.features.portSecurityPortViolations?.[p.name]??0).padStart(19)+(ACTION[c.violation??'shutdown']??'Shutdown').padStart(17);}),'-'.repeat(75),...totals];
}
