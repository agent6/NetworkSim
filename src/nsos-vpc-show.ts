import type {Simulator} from './engine.ts';
import type {Device,InterfaceConfig} from './model.ts';
import {datacenterBridgeMac,nsosConfig,vpcPeerState,vpcRuntime,vpcLogicalPort,vpcMemberId,vpcPeerLink,vpcPortReason} from './datacenter.ts';
import {nsosPort} from './nsos-operational-show.ts';
import {renderNSOSConfig} from './nsos-config.ts';

const enabled=(v:unknown)=>v?'Enabled':'Disabled';
const field=(name:string,value:unknown)=>name.padEnd(33)+' : '+value;
const mac=(value:string|undefined)=>value?.match(/.{2}/g)?.join(':')??'-';
function vlans(d:Device,p:InterfaceConfig|undefined):number[]{
  return p?.switchport?Object.values(d.config.vlans).filter(v=>v.active&&(p.mode==='trunk'?p.allowedVlans===null||p.allowedVlans.includes(v.id):p.vlan===v.id)).map(v=>v.id).sort((a,b)=>a-b):[];
}
function vlanList(values:number[]):string{
  const sorted=[...new Set(values)].sort((a,b)=>a-b),runs:string[]=[];
  for(let i=0;i<sorted.length;i++){const first=sorted[i];while(sorted[i+1]===sorted[i]+1)i++;runs.push(first===sorted[i]?String(first):first+'-'+sorted[i]);}
  return runs.join(',')||'-';
}
const stpType=(type:string|undefined)=>({default:'Default',normal:'Normal Port',edge:'Edge Port','edge trunk':'Edge Trunk Port',network:'Network Port'}[type??'default']??type!);
const guard=(p:InterfaceConfig)=>p.features.rootGuard?'Root':p.features.loopGuard?'Loop':p.features.stpGuard==='none'?'None':'Default';
const timer=(now:number,until:number|undefined,timeout:number)=>until!==undefined&&until>now?`Timer is on.(timeout = ${timeout/1000}s, ${Math.ceil((until-now)/1000)}s left)`:`Timer is off.(timeout = ${timeout/1000}s)`;

/** Native-shaped diagnostics for modeled state. ASIC/QoS telemetry is not invented. */
export function nsosVPCShow(e:Simulator,d:Device,a:string[]):string[]{
  const v=nsosConfig(d).vpc,r=vpcRuntime(d),peer=vpcPeerState(e,d),now=e.clock.now();
  if(!v)return ['vPC domain is not configured.'];
  const peerLink=v.peerLink&&d.config.interfaces[v.peerLink],localMembers=Object.values(d.config.interfaces).filter(p=>p.features.vpcId!==undefined);
  const status=(rows:unknown[])=>!r?.consistencyEvaluated?'Consistency Check Not Performed':rows.length?'failed':'success';
  const rows=r?.consistency??[],global=rows.filter(x=>x.type===1&&x.vpc===undefined&&x.vlan===undefined),perVlan=rows.filter(x=>x.type===1&&x.vlan!==undefined),type2=rows.filter(x=>x.type===2);
  const alive=r?.peerAlive?'peer is alive':'peer is not reachable through peer-keepalive';
  const evaluated=r?.consistencyEvaluated===true,role=evaluated||r?.state==='auto-recovery'?r?.role??'none established':'none established';
  if(a[0]==='role')return ['vPC Role status','----------------------------------------------------',field('vPC role',role),field('Dual Active Detection Status',r?.dualActive?1:0),field('vPC system-mac',mac(r?.systemMac??v.systemMac)),field('vPC system-priority',v.systemPriority),field('vPC local system-mac',mac(datacenterBridgeMac(d))),field('vPC local role-priority',v.rolePriority),field('vPC local config role-priority',v.rolePriority),field('vPC peer system-mac',mac(peer?.localMac)),field('vPC peer role-priority',peer?.rolePriority??'-'),field('vPC peer config role-priority',peer?.rolePriority??'-')];
  if(a[0]==='peer-keepalive'){
    const k=v.keepalive,age=r?.lastKeepalive===undefined?undefined:now-r.lastKeepalive;
    const vrf=k?.vrf==='default'?undefined:k?.vrf;
    const destinationUnreachable=k&&!e.cefLookup(d.id,k.destination,vrf);
    return [field('vPC keep-alive status',destinationUnreachable?'Suspended (Destination IP not reachable)':alive),field('--Receive status',r?.peerAlive?'Success':'Failed'),...(age===undefined?[]:[field('--Last update from peer',`(${Math.floor(age/1000)}) seconds, (${Math.floor(age%1000)}) msec`)]),'','vPC Keep-alive parameters',field('--Destination',k?.destination??'not configured'),field('--Keepalive interval',(k?.interval??1000)+' msec'),field('--Keepalive timeout',(k?.timeout??5000)/1000+' seconds'),field('--Keepalive hold timeout',(k?.holdTimeout??3000)/1000+' seconds'),field('--Keepalive vrf',k?.vrf??'management'),field('--Keepalive udp port',3200),field('--Keepalive tos',192)];
  }
  if(a[0]==='orphan-ports'){
    if(!r?.peerLinkUp)return ['ERROR: Peer-link is down'];
    const grouped=new Map<number,string[]>(),seen=new Set<string>();
    for(const p of Object.values(d.config.interfaces)){
      const logical=vpcLogicalPort(d,p.name);if(seen.has(logical))continue;seen.add(logical);
      const port=d.config.interfaces[logical];if(!port?.switchport||vpcPeerLink(d,logical)||vpcMemberId(d,logical)!==undefined||!e.interfaceUp(d.id,logical))continue;
      for(const vlan of vlans(d,port).filter(id=>vlans(d,peerLink||undefined).includes(id))){const list=grouped.get(vlan)??[];list.push(nsosPort(logical));grouped.set(vlan,list);}
    }
    return ['Note:','--------::Going through port database. Please be patient.::--------','','VLAN           Orphan Ports','-------        -------------------------',...[...grouped].sort(([a],[b])=>a-b).map(([id,ports])=>String(id).padEnd(15)+ports.join(', '))];
  }
  if(a[0]==='consistency-parameters'){
    let selected:InterfaceConfig|undefined;
    if(a[1]==='vpc')selected=localMembers.find(p=>p.features.vpcId===Number(a[2]));
    if(a[1]==='interface'){
      const key=a.slice(2).join('').replace(/^po(?:rt-channel)?/i,'Port-channel');
      selected=d.config.interfaces[key];
    }
    if(a[1]!=='global'&&(!selected||!/^Port-channel/.test(selected.name)||selected.name!==v.peerLink&&selected.features.vpcId===undefined))return ['% vPC port-channel is not configured.'];
    const table:[string,string,unknown,unknown][]=[];
    if(selected&&selected.name!==v.peerLink){
      const remote=peer?.members.find(m=>m.id===selected.features.vpcId);
      table.push(['STP Port Guard','1',guard(selected),remote?({default:'Default',none:'None',root:'Root',loop:'Loop'}[remote.stpGuard]??'Default'):'-'],['STP Port Type','1',stpType(selected.features.stpPortType??(selected.features.portfast?'edge':'default')),remote?stpType(remote.stpPortType):'-'],['MTU','1',selected.mtu,remote?.mtu??'-'],['Port mode','1',selected.mode,remote?.mode??'-'],['Native VLAN','1',selected.nativeVlan,remote?.nativeVlan??'-'],['Allowed VLANs','-',vlanList(vlans(d,selected)),remote?vlanList(remote.vlans):'-'],['Local suspended VLANs','-',vlanList(r?.members[selected.features.vpcId]?.suspendedVlans??[]),'-']);
    }else{
      const mode=(v:string|undefined)=>v==='mst'?'MST':v==='pvst'?'PVST':'Rapid-PVST',svis=(values:Record<string,boolean>,up:boolean)=>vlanList(Object.entries(values).filter(([,active])=>!up||active).map(([port])=>Number(port.slice(4)))),local=Object.fromEntries(Object.values(d.config.interfaces).filter(p=>/^Vlan\d+$/.test(p.name)).map(p=>[p.name,p.adminUp]));
      table.push(['STP Mode','1',mode(d.config.features.stp?.mode),peer?mode(peer.stpMode):'-'],['STP Bridge Assurance','1',enabled(d.config.features.stp?.bridgeAssurance!==false),peer?enabled(peer.bridgeAssurance):'-'],['Interface-vlan admin up','2',svis(local,true),peer?svis(peer.svis??{},true):'-'],['Interface-vlan routing capability','2',svis(local,false),peer?svis(peer.svis??{},false):'-'],['Allowed VLANs','-',vlanList(vlans(d,peerLink||undefined)),peer?vlanList(peer.peerVlans):'-'],['Local suspended VLANs','-',vlanList(Object.values(r?.members??{}).flatMap(m=>m.suspendedVlans)),'-']);
      // Additional modeled checks remain visible without manufacturing hardware rows.
      for(const row of global)table.push([row.name,String(row.type),row.local,row.peer]);
    }
    return ['','    Legend:','        Type 1 : vPC will be suspended in case of mismatch','','Name                            Type  Local Value             Peer Value','------------------------------- ----  ----------------------- -----------------------',...table.map(([name,type,local,remote])=>name.padEnd(32)+type.padEnd(6)+String(local).padEnd(24)+remote),...(!r?.consistencyEvaluated?['','Consistency Check Not Performed']:[])];
  }
  const type2Reason=type2[0]?.name;
  return ['Legend:','                (*) - local vPC is down, forwarding via vPC peer-link','',field('vPC domain id',v.domain),field('Peer status',r?.adjacency?'peer adjacency formed ok':r?.consistencyEvaluated?'peer link is down':'peer adjacency not formed'),field('vPC keep-alive status',alive),field('Configuration consistency status',evaluated?status(global):'failed'),field('Per-vlan consistency status',evaluated?status(perVlan):'success'),...(evaluated?[field('Type-2 consistency status',status(type2))]:[field('Configuration inconsistency reason','Consistency Check Not Performed'),field('Type-2 inconsistency reason','Consistency Check Not Performed')]),...(type2Reason?[field('Type-2 inconsistency reason',type2Reason)]:[]),field('vPC role',role),field('Number of vPCs configured',localMembers.length),field('Peer Gateway',enabled(v.peerGateway)),field('Dual-active excluded VLANs','-'),field('Graceful Consistency Check',evaluated?enabled(v.gracefulConsistency):'Disabled (due to peer configuration)'),field('Auto-recovery status',enabled(v.autoRecovery)),field('Delay-restore status',timer(now,r?.restoreUntil,v.delayRestore)),field('Delay-restore SVI status',timer(now,r?.sviRestoreUntil,v.delayRestoreSVI)),field('Delay-restore Orphan-port status',timer(now,undefined,0)),field('Operational Layer3 Peer-router','Disabled'),field('Virtual-peerlink mode','Disabled'),'','vPC Peer-link status','---------------------------------------------------------------------','id    Port   Status Active vlans','--    ----   ------ -------------------------------------------------',...(peerLink?[String(1).padEnd(6)+nsosPort(peerLink.name).padEnd(7)+(r?.peerLinkUp?'up':'down').padEnd(7)+vlanList(r?.peerLinkUp&&r.adjacency?vlans(d,peerLink):[])]:[]),...(localMembers.length?['','vPC status','--------------------------------------------------------------------------------','Id    Port          Status Consistency Reason                       Active vlans','--    ------------  ------ ----------- ---------------------------- ---------------',...localMembers.map(p=>{
    const id=p.features.vpcId,m=r?.members[id],incompatible=rows.some(x=>x.type===1&&(x.vpc===undefined||x.vpc===id)),failed=!r?.consistencyEvaluated||incompatible||m?.suspended&&!r?.adjacency;
    const reason=!r?.consistencyEvaluated?'Consistency Check Not Performed':incompatible?'vPC type-1 configuration incompatible':m?.suspended&&!r?.adjacency?'Peer-link is down':'success';
    const state=m?.up?'up':r?.adjacency&&m?.peerUp?'down*':'down';
    return String(id).padEnd(6)+nsosPort(p.name).padEnd(14)+state.padEnd(7)+(failed?'failed':'success').padEnd(12)+reason.padEnd(29)+vlanList(m?.activeVlans??[]);
  }),'','Please check "show vpc consistency-parameters vpc <vpc-num>" for the','consistency reason of down vpc and for type-2 consistency reasons for','any vpc.']:[])];
}

export function nsosVPCConfig(d:Device):string[]{
  const lines=renderNSOSConfig(d),result:string[]=[];let domain=false;
  for(const line of lines){
    if(line==='feature vpc'){result.push(line);continue;}
    if(/^vpc domain /.test(line)){domain=true;result.push('',line);continue;}
    if(domain){if(line===' exit'){domain=false;continue;}result.push(line);}
  }
  for(const p of Object.values(d.config.interfaces)){
    const commands=[...(nsosConfig(d).vpc?.peerLink===p.name?['  vpc peer-link']:[]),...(p.features.vpcId!==undefined?['  vpc '+p.features.vpcId]:[]),...(p.features.vpcOrphanSuspend?['  vpc orphan-port suspend']:[])];
    if(commands.length)result.push('','interface '+p.name.replace('Port-channel','port-channel'),...commands);
  }
  return result;
}
