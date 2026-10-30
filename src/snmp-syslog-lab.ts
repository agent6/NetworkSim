import type {Simulator} from './engine.ts';
import type {Device,SimEvent} from './model.ts';
import {snmpIfIndex,normalizeOID} from './snmp.ts';
import {iosLogLine} from './ios-system.ts';

export const snmpSyslogId=(name:string)=>'device-sst-'+name.toLowerCase();
type Live='community'|'manager-acl'|'view'|'v3'|'log-destination'|'log-profile'|'source'|'receiver'|'notifications'|'saved';
type Observed='reachability'|'switch-poll'|'community-fault'|'acl-fault'|'view-fault'|'router-poll'|'v3-fault'|'v3-poll'|'severity-fault'|'destination-fault'|'receiver-fault'|'source-fault'|'router-logs'|'switch-logs'|'inform-ack'|'oper-down'|'oper-up';
export type SNMPSyslogCriterion={kind:'ss-live';device:string;check:Live}|{kind:'ss-observe';device:string;check:Observed};
const live=['community','manager-acl','view','v3','log-destination','log-profile','source','receiver','notifications','saved'];
const observed=['reachability','switch-poll','community-fault','acl-fault','view-fault','router-poll','v3-fault','v3-poll','severity-fault','destination-fault','receiver-fault','source-fault','router-logs','switch-logs','inform-ack','oper-down','oper-up'];
export function validSNMPSyslogCriterion(c:any):boolean{return !!c&&typeof c.device==='string'&&c.device.length>0&&c.device.length<=128&&(c.kind==='ss-live'?live.includes(c.check):c.kind==='ss-observe'&&observed.includes(c.check));}
const get=(s:Simulator,n:string)=>s.getDevice(snmpSyslogId(n)),g=(n:number)=>'GigabitEthernet0/'+n;
const nms='172.16.100.10',router='10.255.0.1',sw='172.16.10.2',community='NETOPS',sysName='1.3.6.1.2.1.1.5.0',location='1.3.6.1.2.1.1.6.0',ifNumber='1.3.6.1.2.1.2.1.0';
function communityReady(d:Device):boolean{const c=d.config.features.snmp?.communities??{},r=c.NETOPS;return Object.keys(c).length===1&&r?.access==='ro'&&r.view==='MONITOR'&&r.acl==='NMS-ONLY';}
function aclReady(d:Device):boolean{const a=d.config.features.acls?.['NMS-ONLY'],r=a?.entries?.[0];return a?.type==='standard'&&a.entries.length===1&&r.sequence===10&&r.action==='permit'&&r.source===nms&&r.wildcard==='0.0.0.0';}
function viewReady(d:Device):boolean{const c=d.config.features.snmp,r=c?.viewEntries?.MONITOR??(c?.views?.MONITOR?[{subtree:c.views.MONITOR[0],included:c.views.MONITOR[1]==='included'}]:[]);return r.length===2&&['system','interfaces'].every(v=>r.some((r:any)=>r.included===true&&(()=>{try{return normalizeOID(String(r.subtree))===normalizeOID(v);}catch{return false;}})()));}
function v3Ready(d:Device):boolean{const c=d.config.features.snmp;return JSON.stringify(c?.groups?.ASSURANCE)===JSON.stringify(['v3','priv','read','MONITOR','access','NMS-ONLY'])&&JSON.stringify(c?.users?.monitor)===JSON.stringify(['ASSURANCE','v3','auth','sha','AuthLab123','priv','aes','128','PrivLab123']);}
function logProfile(d:Device):boolean{const f=d.config.features,l=f.logging;return l?.enabled===true&&l.buffered===true&&l.bufferSize===32768&&l.bufferedLevel===7&&l.trapEnabled===true&&l.trap===6&&l.facility===20&&f.timestamps?.log?.mode==='datetime'&&f.timestamps.log.msec===true&&f.sequenceNumbers===true;}
function notificationReady(d:Device):boolean{const c=d.config.features.snmp;return c?.traps===true&&c.trapCategories?.length===2&&['linkdown','linkup'].every(v=>c.trapCategories.includes(v))&&c.hosts?.length===1&&c.hosts[0].address===nms&&JSON.stringify(c.hosts[0].options)===JSON.stringify(['informs','version','2c',community])&&c['trap-source']==='Loopback0'&&c.informs?.timeout===1&&c.informs.retries===2;}
const receiver=(s:Simulator)=>get(s,'NMS1')?.config.services.syslog?.enabled===true&&get(s,'NMS1')?.config.services.snmpManager?.enabled===true&&get(s,'NMS1')?.config.services.snmpManager?.community===community;
const logDestination=(d:Device)=>d.config.features.logging?.hosts?.length===1&&d.config.features.logging.hosts[0]===nms;
const sourceReady=(d:Device)=>d.config.features.logging?.source==='Loopback0'&&d.config.interfaces.Loopback0?.ip===router&&d.config.interfaces.Loopback0.adminUp;
function healthy(s:Simulator):boolean{
  const a=get(s,'R1')!,b=get(s,'SW1')!,m=get(s,'NMS1')!;
  const plan=[['NMS1','GigabitEthernet0',nms,'255.255.255.0'],['R1',g(0),'172.16.100.1','255.255.255.0'],['R1',g(1),'172.16.10.1','255.255.255.0'],['R1','Loopback0',router,'255.255.255.255'],['R1','Loopback99','192.0.2.99','255.255.255.255'],['SW1','Vlan10',sw,'255.255.255.0'],['PC1','GigabitEthernet0','172.16.10.10','255.255.255.0']];
  return plan.every(([name,port,ip,mask])=>{const node=get(s,name),p=node?.config.interfaces[port];return p?.ip===ip&&p.mask===mask&&s.interfaceUp(node!.id,port);})&&s.lab.links.every(l=>l.enabled&&s.interfaceUp(l.a.deviceId,l.a.port)&&s.interfaceUp(l.b.deviceId,l.b.port))&&a.config.ipRouting&&b.config.ipRouting===false&&[1,2].every(n=>b.config.interfaces[g(n)].mode==='access'&&b.config.interfaces[g(n)].vlan===10)&&get(s,'PC1')!.config.defaultGateway==='172.16.10.1'&&communityReady(a)&&aclReady(a)&&viewReady(a)&&v3Ready(a)&&logProfile(a)&&logDestination(a)&&sourceReady(a)&&receiver(s)&&notificationReady(a)&&a.config.interfaces.Loopback99?.adminUp===true&&b.config.interfaces[g(2)]?.adminUp===true&&s.interfaceUp(b.id,'Vlan10')&&b.config.interfaces.Vlan10.ip===sw&&b.config.defaultGateway==='172.16.10.1'&&m.config.interfaces.GigabitEthernet0.ip===nms&&m.config.interfaces.GigabitEthernet0.features.dhcp!==true&&m.config.defaultGateway==='172.16.100.1';
}
/** A protocol observation must traverse the actual links and router FIB in both directions. */
function leg(s:Simulator,id:string,destination:string,names:string[],since=-Infinity):boolean{
  let at=since;
  for(let i=0;i<names.length-1;i++){
    const a=get(s,names[i]),b=get(s,names[i+1]);if(!a||!b||!s.devicePowered(a.id)||!s.devicePowered(b.id))return false;
    const l=s.lab.links.find(l=>l.enabled&&[l.a.deviceId,l.b.deviceId].includes(a.id)&&[l.a.deviceId,l.b.deviceId].includes(b.id));if(!l)return false;
    const port=l.a.deviceId===a.id?l.a.port:l.b.port;if(a.kind==='router'&&s.cefLookup(a.id,destination)?.port!==port)return false;
    const sent=s.events.find(e=>e.time>=at&&e.nodeId===a.id&&e.port===port&&e.label==='Frame sent'&&!!e.packet&&e.packet.id===id&&e.packet.destination===destination);
    if(!sent||!s.events.some(e=>e.time>=sent.time&&e.nodeId===b.id&&e.label==='Frame received'&&!!e.packet&&e.packet.id===id))return false;at=sent.time;
  }return true;
}
function polls(s:Simulator,name='R1',version='2c',operation='get'):SimEvent[]{
  const address=name==='R1'?router:sw,path=name==='R1'?['NMS1','R1']:['NMS1','R1','SW1'];
  return s.events.filter(e=>{
    const p=e.packet;if(e.nodeId!==snmpSyslogId('NMS1')||e.label!=='Frame received'||p?.protocol!=='UDP'||p.source!==address||p.destination!==nms||p.sourcePort!==161||p.snmp?.application!=='snmp'||p.snmp.errorStatus!=='noError'||p.snmp.version!==version||!p.parentId)return false;
    return s.events.some(r=>r.nodeId===snmpSyslogId(name)&&r.label==='Frame received'&&!!r.packet&&r.packet.id===p.parentId&&r.packet.source===nms&&r.packet.destination===address&&r.packet.destinationPort===161&&r.packet.snmp?.version===version&&r.packet.snmp.operation===operation&&leg(s,r.packet.id,address,path))&&leg(s,p.id,nms,[...path].reverse());
  });
}
const values=(e:SimEvent)=>e.packet?.snmp?.varbinds??[];
const value=(e:SimEvent,oid:string,wanted:string|number)=>values(e).some((v:any)=>v.oid===oid&&!v.exception&&v.value===wanted);
function rejected(s:Simulator,reason:string,version='2c'):boolean{
  const a=get(s,'R1')!,last=a.runtime.features.snmp?.lastRequest;
  return last?.accepted===false&&last.reason===reason&&last.source===nms&&last.version===version&&s.events.some(e=>e.nodeId===a.id&&e.label==='SNMP request discarded'&&e.time===last.time)&&s.events.some(e=>e.time===last.time&&e.nodeId===a.id&&e.label==='Frame received'&&e.packet?.destination===router&&e.packet.source===nms&&e.packet.destinationPort===161&&e.packet.snmp?.version===version&&leg(s,e.packet.id,router,['NMS1','R1']));
}
function receivedLogs(s:Simulator,name:string,source:string,port:string):boolean{
  const m=get(s,'NMS1')!,path=name==='R1'?['R1','NMS1']:['SW1','R1','NMS1'];
  return ['down','up'].every(state=>(m.runtime.features.syslogReceived??[]).some((r:any)=>r.source===source&&r.hostname===name&&r.severity===3&&r.facility===20&&r.message===`%LINK-3-UPDOWN: Interface ${port}, changed state to ${state}`&&s.events.some(e=>e.nodeId===m.id&&e.label==='Frame received'&&!!e.packet&&e.packet.id===r.packetId&&e.packet.source===source&&e.packet.destination===nms&&e.packet.destinationPort===514&&e.packet.syslog?.message===r.message&&leg(s,r.packetId,nms,path))));
}
function informs(s:Simulator):boolean{
  const m=get(s,'NMS1')!,a=get(s,'R1')!,index=snmpIfIndex(a,'Loopback99');
  return notificationReady(a)&&(a.runtime.features.snmp?.informsAcknowledged??0)>=2&&[3,4].every(end=>(m.runtime.features.snmpNotifications??[]).some((r:any)=>r.kind==='inform'&&r.source===router&&r.version==='2c'&&r.varbinds.some((v:any)=>v.oid==='1.3.6.1.6.3.1.1.4.1.0'&&v.value==='1.3.6.1.6.3.1.1.5.'+end)&&r.varbinds.some((v:any)=>v.oid==='1.3.6.1.2.1.2.2.1.1.'+index&&v.value===index)&&s.events.some(e=>e.nodeId===m.id&&e.label==='Frame received'&&e.packet?.source===router&&e.packet.destinationPort===162&&e.packet.snmp?.notificationId===r.notificationId&&leg(s,e.packet.id,nms,['R1','NMS1'])&&s.events.some(ack=>ack.time>=e.time&&ack.nodeId===a.id&&ack.label==='Frame received'&&ack.packet?.parentId===e.packet!.id&&ack.packet.sourcePort===162&&ack.packet.snmp?.notificationId===r.notificationId&&ack.packet.snmp.errorStatus==='noError'&&leg(s,ack.packet.id,router,['NMS1','R1'],e.time)))));
}
export function matchesSNMPSyslogCriterion(s:Simulator,d:Device,c:SNMPSyslogCriterion):boolean{
  if(d.id!==snmpSyslogId('R1')||['R1','SW1','NMS1','PC1'].some(n=>!get(s,n)))return false;
  const a=get(s,'R1')!,b=get(s,'SW1')!,m=get(s,'NMS1')!,index=snmpIfIndex(a,'Loopback99'),oper='1.3.6.1.2.1.2.2.1.8.'+index;
  if(c.kind==='ss-live')switch(c.check){
    case'community':return communityReady(a);case'manager-acl':return aclReady(a);case'view':return viewReady(a);case'v3':return v3Ready(a);case'log-destination':return logDestination(a);case'log-profile':return logProfile(a);case'source':return !!sourceReady(a);case'receiver':return receiver(s);case'notifications':return notificationReady(a);
    case'saved':return healthy(s)&&[a,b].every(d=>!!d.startupConfig&&JSON.stringify(d.config)===JSON.stringify(d.startupConfig));default:return false;
  }
  const reads=polls(s),entries:any[]=a.runtime.features.logEntries??[],link=(r:any)=>r.message?.startsWith('%LINK-3-UPDOWN: Interface Loopback99, changed state to ');
  switch(c.check){
    case'reachability':return s.events.some(e=>e.nodeId===a.id&&e.label==='Echo request accepted'&&e.packet?.source===nms&&e.packet.destination===router&&leg(s,e.packet.id,router,['NMS1','R1'])&&s.events.some(r=>r.nodeId===m.id&&r.label==='Echo reply received'&&r.disposition==='success'&&r.packet?.parentId===e.packet!.id&&leg(s,r.packet.id,nms,['R1','NMS1'],e.time)));
    case'switch-poll':return polls(s,'SW1').some(e=>value(e,sysName,'SW1')&&value(e,location,'Campus rack B'));
    case'community-fault':return !communityReady(a)&&rejected(s,'community');
    case'acl-fault':return communityReady(a)&&!aclReady(a)&&rejected(s,'access-list');
    case'view-fault':return communityReady(a)&&aclReady(a)&&!viewReady(a)&&reads.some(e=>value(e,sysName,'R1')&&values(e).some((v:any)=>v.oid===ifNumber&&v.exception==='noSuchObject'));
    case'router-poll':return communityReady(a)&&aclReady(a)&&viewReady(a)&&reads.some(e=>value(e,sysName,'R1')&&value(e,location,'Campus rack A')&&value(e,ifNumber,Object.keys(a.config.interfaces).length))&&polls(s,'R1','2c','get-bulk').some(e=>Object.keys(a.config.interfaces).every((name)=>{const i=snmpIfIndex(a,name);return value(e,'1.3.6.1.2.1.2.2.1.1.'+i,i);}));
    case'v3-fault':return v3Ready(a)&&rejected(s,'privacy','3');
    case'v3-poll':return v3Ready(a)&&aclReady(a)&&viewReady(a)&&polls(s,'R1','3').some(e=>value(e,sysName,'R1')&&value(e,ifNumber,Object.keys(a.config.interfaces).length));
    case'severity-fault':return ['down','up'].every(state=>entries.some(r=>link(r)&&r.message.endsWith(state)&&r.severity===3&&r.remote?.enabled===true&&r.remote.level===2&&r.remote.eligible===false&&a.runtime.logs.includes(iosLogLine(a,r))&&/^\d{6}: [*.]?\w{3}\s+\d{1,2} \d\d:\d\d:\d\d\.\d{3}:/.test(iosLogLine(a,r))));
    case'destination-fault':return s.events.some(e=>e.nodeId===a.id&&e.label==='Neighbor unresolved'&&e.packet?.destination==='172.16.100.20'&&e.packet.destinationPort===514&&e.packet.syslog?.message?.startsWith('%LINK-3-UPDOWN: Interface Loopback99,')&&entries.some(r=>r.message===e.packet!.syslog.message&&r.remote?.eligible===true&&r.remote.hosts.includes('172.16.100.20')));
    case'receiver-fault':return m.config.services.syslog?.enabled===false&&s.events.some(e=>e.nodeId===m.id&&e.label==='Frame received'&&e.packet?.destination===nms&&e.packet.destinationPort===514&&e.packet.syslog?.message?.startsWith('%LINK-3-UPDOWN: Interface Loopback99,')&&leg(s,e.packet.id,nms,['R1','NMS1'])&&s.events.some(r=>r.nodeId===a.id&&r.label==='ICMP error received'&&r.packet?.parentId===e.packet!.id&&r.packet.icmpType===3&&r.packet.icmpCode===3));
    case'source-fault':return receivedLogs(s,'R1','172.16.100.1','Loopback99');
    case'router-logs':return logProfile(a)&&sourceReady(a)&&receivedLogs(s,'R1',router,'Loopback99');
    case'switch-logs':return receivedLogs(s,'SW1',sw,g(2));
    case'inform-ack':return informs(s);
    case'oper-down':return a.config.interfaces.Loopback99.adminUp===false&&reads.some(e=>value(e,oper,2));
    case'oper-up':return a.config.interfaces.Loopback99.adminUp===true&&reads.some(down=>value(down,oper,2)&&reads.some(up=>up.time>down.time&&value(up,oper,1)));
    default:return false;
  }
}
