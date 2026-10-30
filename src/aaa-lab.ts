import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {sameAddress} from './ip.ts';
import {ownRecordValue} from './record-map.ts';

export type AAAClientCriterion =
 | {kind:'tacacs-server'|'radius-server';device:string;server:string;name:string}
 | {kind:'aaa-group';device:string;name:string;serverName:string;protocol?:'tacacs'|'radius'}
 | {kind:'aaa-method';device:string;service:'login'|'exec'|'exec-accounting';name:string;methods:string[]}
 | {kind:'aaa-line';device:string;line:'console 0'|'vty 0 4';authentication:string;authorization?:string;accounting?:string}
 | {kind:'tacacs-session'|'radius-session';device:string;server:string;source:string;username:string;privilege:number};

export function validAAAClientCriterion(v:any):boolean {
 const name=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=128;
 switch(v.kind){
  case 'tacacs-server':case 'radius-server':return name(v.server)&&name(v.name);
  case 'aaa-group':return name(v.name)&&name(v.serverName)&&(v.protocol===undefined||['tacacs','radius'].includes(v.protocol));
  case 'aaa-method':return ['login','exec','exec-accounting'].includes(v.service)&&name(v.name)&&Array.isArray(v.methods)&&v.methods.length>0&&v.methods.length<=8&&v.methods.every(name);
  case 'aaa-line':return ['console 0','vty 0 4'].includes(v.line)&&name(v.authentication)&&(v.authorization===undefined||name(v.authorization))&&(v.accounting===undefined||name(v.accounting))&&(v.line!=='console 0'||v.authorization===undefined&&v.accounting===undefined);
  case 'tacacs-session':case 'radius-session':return name(v.server)&&name(v.source)&&name(v.username)&&Number.isInteger(v.privilege)&&v.privilege>=0&&v.privilege<=15;
  default:return false;
 }
}
const ownsAddress=(d:Device|undefined,address:unknown)=>typeof address==='string'&&!!d&&Object.values(d.config.interfaces).some(p=>!!p.ip&&sameAddress(p.ip,address));
const find=(sim:Simulator,name:string)=>sim.lab.devices.find(d=>d.id===name||d.config.hostname===name);

/** Bounded guide checks over configuration and actual AAA request/ACK evidence. */
export function matchesAAAClientCriterion(sim:Simulator,d:Device,c:AAAClientCriterion):boolean {
 const aaa=d.config.features.aaa??{};
 if(c.kind==='tacacs-server'||c.kind==='radius-server'){
  const protocol=c.kind==='radius-server'?'radius':'tacacs',server=find(sim,c.server),service=server?.config.services[protocol],entry=ownRecordValue(aaa.servers,c.name);
  return !!entry&&entry.protocol===protocol&&(protocol==='radius'?(entry.port??1812)===1812&&(entry.accountingPort??1813)===1813:(entry.port??49)===49)&&ownsAddress(server,entry.address)&&typeof entry.key==='string'&&entry.key.length>0&&entry.key===service?.secret&&service.enabled===true&&service.accountingEnabled!==false;
 }
 if(c.kind==='aaa-group'){
  const group=ownRecordValue(aaa.groups,c.name),protocol=c.protocol??'tacacs';
  return group?.protocol===protocol&&Array.isArray(group.servers)&&group.servers.includes(c.serverName)&&ownRecordValue(aaa.servers,c.serverName)?.protocol===protocol;
 }
 if(c.kind==='aaa-method'){
  const value=c.service==='login'?ownRecordValue(aaa.login,c.name):c.service==='exec'?ownRecordValue(aaa.authorization?.exec,c.name):ownRecordValue(aaa.accounting,'exec '+c.name);
  return aaa.enabled===true&&Array.isArray(value)&&JSON.stringify(value)===JSON.stringify(c.methods);
 }
 if(c.kind==='aaa-line'){
  if(aaa.enabled!==true)return false;
  const configured=(line:any)=>line?.authentication===c.authentication&&(c.authorization===undefined||line.authorizationExec===c.authorization)&&(c.accounting===undefined||line.accountingExec===c.accounting);
  if(c.line==='console 0')return configured(ownRecordValue(d.config.features.lines,'console 0'))&&!aaa.authorizeConsole;
  const enabled=Object.entries<any>(d.config.features.lines??{}).filter(([name,line])=>/^vty \d+(?: \d+)?$/.test(name)&&line.exec!==false&&!['none',''].includes(String(line.transport??'')));
  const safe=(line:any)=>line.transport==='ssh'&&configured(line);
  return enabled.every(([,line])=>safe(line))&&[0,1,2,3,4].every(n=>enabled.some(([name,line])=>{const [,start,end]=name.split(' ').map(Number);return safe(line)&&start<=n&&n<=(end??start);}));
 }
 if(c.kind==='tacacs-session'||c.kind==='radius-session'){
  const protocol=c.kind==='radius-session'?'radius':'tacacs',server=find(sim,c.server),source=find(sim,c.source);if(!server||!source)return false;
  const requests:any[]=server.runtime.features.aaaRequests??[],received:any[]=server.runtime.features.aaaAccountingReceived??[],deliveries:any[]=d.runtime.features.aaaAccountingEvents??[];
  const rows=received.filter(row=>row.protocol===protocol&&row.kind==='exec'&&row.username===c.username&&row.privilege===c.privilege&&/^vty /.test(row.line)&&ownsAddress(d,row.source)&&ownsAddress(source,row.remoteSource));
  const acknowledged=(row:any)=>deliveries.some(delivery=>delivery.protocol===protocol&&delivery.status==='delivered'&&delivery.eventId===row.eventId&&ownsAddress(server,delivery.server)&&delivery.record?.sessionId===row.sessionId&&delivery.record?.status===row.status);
  return rows.some(start=>start.status==='start'&&acknowledged(start)&&rows.some(stop=>stop.status==='stop'&&stop.sessionId===start.sessionId&&stop.source===start.source&&stop.remoteSource===start.remoteSource&&stop.time>=start.time&&acknowledged(stop))&&(protocol==='radius'?['authenticate']:['authenticate','authorize']).every(operation=>requests.some(q=>q.protocol===protocol&&q.operation===operation&&(operation!=='authorize'||q.kind==='exec')&&q.accepted===true&&q.username===c.username&&q.source===start.source&&q.time<=start.time)));
 }
 return false;
}
