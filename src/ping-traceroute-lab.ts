import type {Simulator} from './engine.ts';
import type {Device, SimEvent} from './model.ts';

export const pingTraceId = (name:string) => 'device-ptt-'+name.toLowerCase();
type Live = 'gateway'|'forward-route'|'return-route'|'policy'|'routing'|'saved';
type Observation = 'local'|'gateway-fault'|'forward-fault'|'return-fault'|'transit-source'|'source-fault'|'source-success'|'forward'|'reverse'|'filtered-trace'|'ios-trace'|'windows-trace'|'ttl'|'mtu-fault'|'mtu-success';
export type PingTraceCriterion = {kind:'pt-live';device:string;check:Live}|{kind:'pt-observe';device:string;check:Observation};
const live = ['gateway','forward-route','return-route','policy','routing','saved'];
const observed = ['local','gateway-fault','forward-fault','return-fault','transit-source','source-fault','source-success','forward','reverse','filtered-trace','ios-trace','windows-trace','ttl','mtu-fault','mtu-success'];
export function validPingTraceCriterion(c:any):boolean {
  return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='pt-live'?live.includes(c.check):c.kind==='pt-observe'&&observed.includes(c.check));
}
const g=(n:number)=>'GigabitEthernet0/'+n, get=(s:Simulator,n:string)=>s.getDevice(pingTraceId(n));
const client='192.168.10.10', server='192.168.30.10', lanSource='192.168.10.1', transitSource='10.0.12.1';
const chain=['PC1','R1','R2','R3','SRV1'];
function gateway(s:Simulator):boolean {
  const d=get(s,'PC1'),p=d?.config.interfaces.GigabitEthernet0;
  return !!p&&p.ip===client&&p.mask==='255.255.255.0'&&p.features.dhcp!==true&&d!.config.defaultGateway===lanSource;
}
function route(s:Simulator,name:string,network:string,prefix:number,nextHop:string,port:string):boolean {
  const d=get(s,name),r=d&&s.cefLookup(d.id,network.slice(0,network.lastIndexOf('.')+1)+(network.startsWith('192.')?'10':'2'));
  return !!d&&d.config.ipRouting&&d.config.staticRoutes.some(r=>r.network===network&&r.prefix===prefix&&r.nextHop===nextHop&&(r.ad??1)===1)&&r?.route.protocol==='static'&&r.route.prefix===prefix&&r.target===nextHop&&r.port===port&&s.interfaceUp(d.id,port);
}
const forwardRoute=(s:Simulator)=>route(s,'R2','192.168.30.0',24,'10.0.23.2',g(1));
const returnRoute=(s:Simulator)=>route(s,'R3','192.168.10.0',24,'10.0.23.1',g(0));
function policy(s:Simulator):boolean {
  const d=get(s,'R2'),acl=d?.config.features.acls?.['TRACE-RETURN'],r=acl?.entries?.[0];
  return !!d&&acl?.type==='extended'&&acl.entries.length===1&&r.sequence===20&&r.action==='permit'&&r.protocol==='ip'&&r.source==='0.0.0.0'&&r.wildcard==='255.255.255.255'&&r.destination==='0.0.0.0'&&r.destinationWildcard==='255.255.255.255'&&d.config.interfaces[g(1)].features.aclIn==='TRACE-RETURN'&&['R1','R2','R3'].every(n=>Object.values(get(s,n)!.config.interfaces).every(p=>!p.features.aclOut&&(!p.features.aclIn||n==='R2'&&p.name===g(1)&&p.features.aclIn==='TRACE-RETURN')));
}
function routing(s:Simulator):boolean {
  const plan=[['PC1','GigabitEthernet0',client,'255.255.255.0'],['R1',g(0),lanSource,'255.255.255.0'],['R1',g(1),transitSource,'255.255.255.252'],['R2',g(0),'10.0.12.2','255.255.255.252'],['R2',g(1),'10.0.23.1','255.255.255.252'],['R3',g(0),'10.0.23.2','255.255.255.252'],['R3',g(1),'192.168.30.1','255.255.255.0'],['SRV1','GigabitEthernet0',server,'255.255.255.0']];
  return plan.every(([n,port,ip,mask])=>{const d=get(s,n),p=d?.config.interfaces[port];return !!p&&p.ip===ip&&p.mask===mask&&s.interfaceUp(d!.id,port);})&&['PC1','SRV1'].every(n=>!get(s,n)!.config.staticRoutes.length&&get(s,n)!.config.interfaces.GigabitEthernet0.features.dhcp!==true)&&gateway(s)&&forwardRoute(s)&&returnRoute(s)&&get(s,'SRV1')?.config.defaultGateway==='192.168.30.1'&&get(s,'R2')?.config.interfaces[g(1)].mtu===1400&&[
    ['R1','192.168.30.0',24,'10.0.12.2',g(1)],['R1','10.0.23.0',30,'10.0.12.2',g(1)],['R2','192.168.10.0',24,'10.0.12.1',g(0)],['R3','10.0.12.0',30,'10.0.23.1',g(0)],
  ].every(([n,net,prefix,next,port])=>route(s,n as string,net as string,prefix as number,next as string,port as string))&&['R1','R2','R3'].every(n=>get(s,n)!.config.staticRoutes.length===2&&!Object.keys(get(s,n)!.config.protocols).length);
}
/** Correlate every actual Ethernet hop, current FIB egress and linked peer. */
function leg(s:Simulator,id:string,address:string,names:string[],since=-Infinity):boolean {
  let at=since;
  for(let i=0;i<names.length-1;i++){
    const a=get(s,names[i]),b=get(s,names[i+1]);if(!a||!b||!s.devicePowered(a.id)||!s.devicePowered(b.id))return false;
    const link=s.lab.links.find(l=>l.enabled&&[l.a.deviceId,l.b.deviceId].includes(a.id)&&[l.a.deviceId,l.b.deviceId].includes(b.id));if(!link)return false;
    const port=link.a.deviceId===a.id?link.a.port:link.b.port;
    if(a.kind==='router'&&s.cefLookup(a.id,address)?.port!==port)return false;
    const sent=s.events.find(e=>e.time>=at&&e.nodeId===a.id&&e.port===port&&e.label==='Frame sent'&&!!e.packet&&e.packet.id===id&&e.packet.destination===address);
    if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===b.id&&e.label==='Frame received'&&!!e.packet&&e.packet.id===id))return false;at=sent.time;
  }
  return true;
}
function echo(s:Simulator,from='PC1',source=client,to='SRV1',destination=server,size?:number,df?:boolean,ttl?:number,runPackets?:string[]):boolean {
  const path=from==='SRV1'?[...chain].reverse():from==='R1'?chain.slice(1):to==='R1'?chain.slice(0,2):chain;
  return s.events.some(e=>e.nodeId===pingTraceId(to)&&e.label==='Echo request accepted'&&e.packet?.protocol==='ICMP'&&e.packet.source===source&&e.packet.destination===destination&&(!runPackets||runPackets.includes(e.packet.id))&&(size===undefined||e.packet.size===size)&&(df===undefined||e.packet.df===df)&&s.events.some(sent=>sent.nodeId===pingTraceId(from)&&sent.label==='Frame sent'&&sent.packet?.id===e.packet!.id&&(ttl===undefined||sent.packet.ttl===ttl))&&leg(s,e.packet.id,destination,path)&&s.events.some(r=>r.time>=e.time&&r.nodeId===pingTraceId(from)&&r.label==='Echo reply received'&&r.disposition==='success'&&r.packet?.parentId===e.packet!.id&&r.packet.source===destination&&r.packet.destination===source&&leg(s,r.packet.id,source,[...path].reverse(),e.time)));
}
function lostReturn(s:Simulator,source=client):boolean {
  if(!gateway(s)||!forwardRoute(s)||s.cefLookup(pingTraceId('R3'),source))return false;
  const names=source===client?chain:chain.slice(1);
  return s.events.some(e=>e.nodeId===pingTraceId('SRV1')&&e.label==='Echo request accepted'&&e.packet?.protocol==='ICMP'&&e.packet.source===source&&e.packet.destination===server&&leg(s,e.packet.id,server,names)&&s.events.some(r=>r.time>=e.time&&r.nodeId===pingTraceId('R3')&&r.label==='No route'&&r.packet?.parentId===e.packet!.id&&r.packet.source===server&&r.packet.destination===source&&leg(s,r.packet.id,source,['SRV1','R3'],e.time)));
}
/** Received ICMP must quote and parent-link a real probe and traverse the complete return path. */
function errorReply(s:Simulator,from:string,source:string,origin:string,type:number,code:number,ttl:number,protocol='ICMP',label='TTL expired'):SimEvent[] {
  const start=chain.indexOf(from),end=chain.indexOf(origin),path=chain.slice(start,end+1),target=server;
  return s.events.filter(e=>{
    const p=e.packet,q=p?.icmpQuoted;
    if(e.nodeId!==pingTraceId(from)||e.label!=='ICMP error received'||p?.icmpType!==type||p.icmpCode!==code||p.destination!==source||q?.source!==source||q.destination!==target||q.protocol!==protocol.toLowerCase()||!p.parentId)return false;
    const sent=s.events.find(r=>r.nodeId===pingTraceId(from)&&r.label==='Frame sent'&&!!r.packet&&r.packet.id===p.parentId&&r.packet.protocol===protocol&&r.packet.source===source&&r.packet.destination===target&&(ttl<0||r.packet.ttl===ttl)&&(protocol!=='UDP'||r.packet.sourcePort===q.sourcePort&&r.packet.destinationPort===q.destinationPort));
    return !!sent&&s.events.some(r=>r.nodeId===pingTraceId(origin)&&r.label===label&&!!r.packet&&r.packet.id===p.parentId)&&leg(s,p.parentId,target,path)&&leg(s,p.id,source,[...path].reverse(),sent.time);
  });
}
export function matchesPingTraceCriterion(s:Simulator,d:Device,c:PingTraceCriterion):boolean {
  if(d.id!==pingTraceId('R1')||['PC1','R1','R2','R3','SRV1'].some(n=>!get(s,n)))return false;
  if(c.kind==='pt-live')switch(c.check){
    case'gateway':return gateway(s);case'forward-route':return forwardRoute(s);case'return-route':return returnRoute(s);case'policy':return policy(s);case'routing':return routing(s);
    case'saved':return routing(s)&&policy(s)&&['R1','R2','R3'].every(n=>{const d=get(s,n)!;return !!d.startupConfig&&JSON.stringify(d.config)===JSON.stringify(d.startupConfig);});
    default:return false;
  }
  const runs:any[]=get(s,'PC1')!.runtime.features.probeRuns??[],traces=runs.filter(r=>r.kind==='tracert'&&r.target===server);
  switch(c.check){
    case'local':return echo(s,'PC1',client,'R1',lanSource);
    case'gateway-fault':return get(s,'PC1')!.config.defaultGateway==='192.168.10.254'&&s.events.some(e=>e.nodeId===pingTraceId('PC1')&&e.label==='Neighbor unresolved'&&e.detail.includes('192.168.10.254')&&e.packet?.source===client&&e.packet.destination===server)&&s.events.some(e=>e.nodeId===pingTraceId('PC1')&&e.packet?.arpOperation==='request'&&e.packet.destination==='192.168.10.254');
    case'forward-fault':return gateway(s)&&!s.cefLookup(pingTraceId('R2'),server)&&errorReply(s,'PC1',client,'R2',3,0,-1,'ICMP','No route').length>0;
    case'return-fault':return lostReturn(s);
    case'transit-source':return !s.cefLookup(pingTraceId('R3'),lanSource)&&echo(s,'R1',transitSource);
    case'source-fault':return lostReturn(s,lanSource);
    case'source-success':return routing(s)&&echo(s,'R1',lanSource);
    case'forward':return routing(s)&&echo(s);
    case'reverse':return routing(s)&&echo(s,'SRV1',server,'PC1',client);
    case'filtered-trace':return routing(s)&&traces.some(run=>echo(s,'PC1',client,'SRV1',server,60,undefined,4,run.packets))&&(get(s,'R2')!.runtime.features.aclDecisions??[]).some((r:any)=>r.name==='TRACE-RETURN'&&r.port===g(1)&&r.direction==='in'&&r.sequence===10&&r.action==='deny'&&s.events.some(e=>e.nodeId===pingTraceId('R2')&&e.label==='Ingress ACL denied'&&!!e.packet&&e.packet.id===r.packetId&&e.packet.source==='10.0.23.2'&&e.packet.destination===client&&e.packet.icmpType===11&&e.packet.icmpCode===0&&e.packet.icmpQuoted?.source===client&&e.packet.icmpQuoted.destination===server&&s.events.some(p=>p.nodeId===pingTraceId('PC1')&&p.label==='Frame sent'&&!!p.packet&&p.packet.id===e.packet!.parentId&&p.packet.ttl===3)&&leg(s,e.packet.id,client,['R3','R2'])));
    case'ios-trace':return [[1,'R2',11,0,'TTL expired'],[2,'R3',11,0,'TTL expired'],[3,'SRV1',3,3,'UDP probe delivered']].every(([ttl,node,type,code,label])=>errorReply(s,'R1',transitSource,node as string,type as number,code as number,ttl as number,'UDP',label as string).some(e=>e.packet!.icmpQuoted!.destinationPort!>=33434&&e.packet!.icmpQuoted!.destinationPort!<=33442));
    case'windows-trace':return routing(s)&&policy(s)&&traces.some(run=>['R1','R2','R3'].every((n,i)=>errorReply(s,'PC1',client,n,11,0,i+1).some(e=>run.packets.includes(e.packet!.parentId)))&&echo(s,'PC1',client,'SRV1',server,60,undefined,4,run.packets));
    case'ttl':return runs.some(r=>r.kind==='ping'&&r.target===server&&r.ttl===1&&errorReply(s,'PC1',client,'R1',11,0,1).some(e=>r.packets.includes(e.packet!.parentId)));
    case'mtu-fault':return routing(s)&&errorReply(s,'R1',transitSource,'R2',3,4,64,'ICMP','MTU exceeded').some(e=>s.events.some(p=>!!p.packet&&p.packet.id===e.packet!.parentId&&p.packet.df&&p.packet.size===1500));
    case'mtu-success':return routing(s)&&echo(s,'R1',transitSource,'SRV1',server,1400,true);
    default:return false;
  }
}
