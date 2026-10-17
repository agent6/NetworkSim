import {ownRecordValue} from './record-map.ts';
import type {Simulator,ServiceResult,ServiceOptions} from './engine.ts';
import type {Device} from './model.ts';
import {interfaceSpeed} from './ethernet.ts';

/** Logical SNMP PDUs traverse UDP. ASN.1/BER and USM cryptography are not emulated. */
export interface SNMPRequest {application:'snmp';version:'2c'|'3';operation:'get'|'get-next'|'get-bulk'|'set';nonRepeaters?:number;maxRepetitions?:number;maxMessageSize?:number;community?:string;username?:string;securityLevel?:'noauth'|'auth'|'priv';authPassword?:string;privacyPassword?:string;oids:string[]}
export interface SNMPVariable {oid:string;type:string;value?:string|number;exception?:'noSuchObject'|'noSuchInstance'|'endOfMibView'}
export interface SNMPStatistics {inPackets:number;outPackets:number;getRequests:number;getNextRequests:number;getBulkRequests:number;informsSent:number;informsAcknowledged:number;informsFailed:number;setRequests:number;badVersions:number;badCommunityNames:number;authenticationFailures:number;accessDenied:number;readOnlyErrors:number;malformedRequests:number;variablesRead:number;trapsSent:number;trapsReceived:number;lastRequest?:{source:string;time:number;version:string;operation:string;accepted:boolean;reason?:string}}
const zero=():SNMPStatistics=>({inPackets:0,outPackets:0,getRequests:0,getNextRequests:0,getBulkRequests:0,informsSent:0,informsAcknowledged:0,informsFailed:0,setRequests:0,badVersions:0,badCommunityNames:0,authenticationFailures:0,accessDenied:0,readOnlyErrors:0,malformedRequests:0,variablesRead:0,trapsSent:0,trapsReceived:0});
export function snmpStatistics(device:Device):SNMPStatistics{return device.runtime.features.snmp??=zero();}
export function snmpEnabled(device:Device):boolean{const c=device.config.features.snmp;return !!c&&c.enabled!==false&&(Object.keys(c.communities??{}).length>0||Object.keys(c.users??{}).length>0);}
const after=(options:string[],key:string)=>{const i=options.indexOf(key);return i<0?undefined:options[i+1];};
const names:Record<string,string>={iso:'1',internet:'1.3.6.1',mib2:'1.3.6.1.2.1','mib-2':'1.3.6.1.2.1',system:'1.3.6.1.2.1.1',interfaces:'1.3.6.1.2.1.2',ifMIB:'1.3.6.1.2.1.31',sysDescr:'1.3.6.1.2.1.1.1',sysObjectID:'1.3.6.1.2.1.1.2',sysUpTime:'1.3.6.1.2.1.1.3',sysContact:'1.3.6.1.2.1.1.4',sysName:'1.3.6.1.2.1.1.5',sysLocation:'1.3.6.1.2.1.1.6',sysServices:'1.3.6.1.2.1.1.7',ifNumber:'1.3.6.1.2.1.2.1',ifTable:'1.3.6.1.2.1.2.2',ifEntry:'1.3.6.1.2.1.2.2.1'};
export function normalizeOID(value:string):string{const clean=String(value).replace(/^\./,'');const first=clean.split('.')[0],prefix=Object.keys(names).find(key=>key.toLowerCase()===first.toLowerCase());const expanded=prefix?names[prefix]+clean.slice(first.length):clean,parts=expanded.split('.').map(Number);if(!/^\d+(?:\.\d+)*$/.test(expanded)||parts.some(part=>!Number.isSafeInteger(part)||part>4294967295)||parts[0]>2||parts.length>1&&parts[0]<2&&parts[1]>39)throw Error('Invalid numeric or supported symbolic OID.');return parts.join('.');}
function subtree(value:string):string{if(value==='iso')return '1';try{return normalizeOID(value);}catch{return '';}}
function viewAllows(config:any,name:string|undefined,oid:string):boolean{if(!name)return true;const legacy=ownRecordValue(config.views,name),rules:Array<{subtree:string;included:boolean}>=ownRecordValue(config.viewEntries,name)??(Array.isArray(legacy)&&legacy.length?[{subtree:legacy[0],included:legacy[1]==='included'}]:[]);const matches=rules.map(rule=>({...rule,prefix:subtree(rule.subtree)})).filter(rule=>rule.prefix&&(oid===rule.prefix||oid.startsWith(rule.prefix+'.'))).sort((a,b)=>b.prefix.split('.').length-a.prefix.split('.').length);return matches[0]?.included===true;}
function accessAllows(engine:Simulator,device:Device,acl:string|undefined,source:string,destination:string):boolean{return !acl||!!device.config.features.acls?.[acl]&&engine.aclPermits(device.id,acl,source,destination,'udp',{destinationPort:161});}
function authenticate(engine:Simulator,device:Device,request:SNMPRequest,source:string,destination:string):{accepted:boolean;view?:string;reason?:string}{
 const c=device.config.features.snmp??{};
 if(request.version==='2c'){const community=typeof request.community==='string'&&Object.hasOwn(c.communities??{},request.community)?c.communities[request.community]:undefined;if(!community)return {accepted:false,reason:'community'};const entry=typeof community==='string'?{access:community}:community;if(!accessAllows(engine,device,entry.acl,source,destination))return {accepted:false,reason:'access-list'};return {accepted:true,view:entry.view};}
 if(request.version!=='3')return {accepted:false,reason:'version'};
 const user=typeof request.username==='string'&&Object.hasOwn(c.users??{},request.username)?c.users[request.username]:undefined;if(!Array.isArray(user)||user[1]!=='v3'||user.includes('remote')||user.includes('encrypted'))return {accepted:false,reason:'user'};
 const group=Object.hasOwn(c.groups??{},user[0])?c.groups[user[0]]:undefined;if(!Array.isArray(group)||group[0]!=='v3')return {accepted:false,reason:'group'};
 const levels={noauth:0,auth:1,priv:2},level=request.securityLevel??'noauth',minimum=Object.hasOwn(levels,group[1])?group[1] as keyof typeof levels:'noauth';if(!Object.hasOwn(levels,level)||levels[level]<levels[minimum])return {accepted:false,reason:'security-level'};
 const auth=user.indexOf('auth'),privacy=user.indexOf('priv');
 if(levels[level]>=1){if(auth<0)return {accepted:false,reason:'authentication'};if(!['md5','sha','sha-2'].includes(user[auth+1])||user[auth+1]==='sha-2'&&!['256','384','512'].includes(user[auth+2]))return {accepted:false,reason:'authentication-algorithm'};const password=user[auth+1]==='sha-2'?user[auth+3]:user[auth+2];if(!password||request.authPassword!==password)return {accepted:false,reason:'authentication'};}
 if(level==='priv'){if(privacy<0)return {accepted:false,reason:'privacy'};if(!['des','3des','aes'].includes(user[privacy+1])||user[privacy+1]==='aes'&&!['128','192','256'].includes(user[privacy+2]))return {accepted:false,reason:'privacy-algorithm'};const password=user[privacy+1]==='aes'?user[privacy+3]:user[privacy+2];if(!password||request.privacyPassword!==password)return {accepted:false,reason:'privacy'};}
 if(!accessAllows(engine,device,after(group,'access'),source,destination)||!accessAllows(engine,device,after(user,'access'),source,destination))return {accepted:false,reason:'access-list'};
 return {accepted:true,view:after(group,'read')};
}
export function synchronizeSNMPIndexes(d:Device):void{const c=d.config.features.snmp;if(c?.ifindex!=='persist')return;const mapping=c.interfaceIndexes??={},used=new Set<number>();for(const[k,v]of Object.entries<any>(mapping)){if(!Number.isInteger(v)||v<1||used.has(v)){delete mapping[k];continue;}used.add(v);}let next=Math.max(0,...used)+1;for(const name of Object.keys(d.config.interfaces))if(!Object.hasOwn(mapping,name))Object.defineProperty(mapping,name,{value:next++,enumerable:true,writable:true,configurable:true});}
export function snmpIfIndex(d:Device,name:string):number{return d.config.features.snmp?.ifindex==='persist'?d.config.features.snmp.interfaceIndexes?.[name]??Object.keys(d.config.interfaces).indexOf(name)+1:Object.keys(d.config.interfaces).indexOf(name)+1;}
export function snmpMIB(engine:Simulator,device:Device):SNMPVariable[]{
 const config=device.config.features.snmp??{},rows:SNMPVariable[]=[],add=(oid:string,type:string,value:string|number)=>rows.push({oid,type,value});
 add('1.3.6.1.2.1.1.1.0','OctetString',`NetworkSim original ${device.kind} educational agent; IOS XE 17.12-style read-only networking subset`);
 add('1.3.6.1.2.1.1.2.0','ObjectIdentifier','0.0'); // No assigned vendor enterprise OID; do not impersonate Cisco hardware.
 add('1.3.6.1.2.1.1.3.0','TimeTicks',Math.floor(Math.max(0,engine.clock.now()-(device.runtime.features.bootTime??0))/10)%4294967296);
 add('1.3.6.1.2.1.1.4.0','OctetString',config.contact??'');add('1.3.6.1.2.1.1.5.0','OctetString',device.config.hostname);add('1.3.6.1.2.1.1.6.0','OctetString',config.location??'');
 add('1.3.6.1.2.1.1.7.0','Integer',device.kind==='switch'||device.kind==='poeswitch'?2:device.kind==='l3switch'?6:device.kind==='router'?4:72);
 const ports=Object.values(device.config.interfaces);add('1.3.6.1.2.1.2.1.0','Integer',ports.length);
 ports.forEach((port,i)=>{const index=snmpIfIndex(device,port.name),prefix='1.3.6.1.2.1.2.2.1.',counters=device.runtime.counters[port.name];for(const[column,type,value]of [[1,'Integer',index],[2,'OctetString',port.name],[3,'Integer',port.name==='Wireless0'?71:/^(Loopback)/.test(port.name)?24:/^Tunnel/.test(port.name)?131:6],[4,'Integer',port.mtu],[5,'Gauge32',Math.min(4294967295,interfaceSpeed(device,port)*1000000)],[6,'OctetString',engine.macOf(device.id,port.name)],[7,'Integer',port.adminUp?1:2],[8,'Integer',engine.interfaceUp(device.id,port.name)?1:2],[10,'Counter32',(counters?.rxBytes??0)%4294967296],[11,'Counter32',(counters?.rxUnicast??0)%4294967296],[12,'Counter32',((counters?.rxMulticast??0)+(counters?.rxBroadcast??0))%4294967296],[14,'Counter32',(counters?.inputErrors??0)%4294967296],[16,'Counter32',(counters?.txBytes??0)%4294967296],[17,'Counter32',(counters?.txUnicast??0)%4294967296],[18,'Counter32',((counters?.txMulticast??0)+(counters?.txBroadcast??0))%4294967296],[20,'Counter32',(counters?.outputErrors??0)%4294967296]] as Array<[number,string,string|number]>)add(prefix+column+'.'+index,type,value);});
 return rows;
}
const compareOID=(a:string,b:string)=>{const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length;};
/** Called only after the UDP request reached this device and ingress policies permitted it. */
export function handleSNMPRequest(engine:Simulator,device:Device,payload:any,source:string,destination='0.0.0.0'):Record<string,any>|undefined{
 const stats=snmpStatistics(device);stats.inPackets++;const request=payload as SNMPRequest;
 const reject=(reason:string)=>{if(reason==='version')stats.badVersions++;else if(reason==='community')stats.badCommunityNames++;else if(reason==='access-list')stats.accessDenied++;else if(reason==='malformed')stats.malformedRequests++;else stats.authenticationFailures++;stats.lastRequest={source,time:engine.clock.now(),version:String(request?.version),operation:String(request?.operation),accepted:false,reason};engine.emit({nodeId:device.id,protocol:'SNMP',label:'SNMP request discarded',detail:reason==='access-list'?'Manager denied by SNMP access-list.':'SNMP security identity or request is not supported.',disposition:'drop'});if(['community','user','security-level','authentication','privacy','authentication-algorithm','privacy-algorithm'].includes(reason))sendSNMPNotification(engine,device.id,'1.3.6.1.6.3.1.1.5.5');return undefined;};
 if(!request||request.application!=='snmp'||!Array.isArray(request.oids)||request.oids.length<1||request.oids.length>100||!['get','get-next','get-bulk','set'].includes(request.operation))return reject('malformed');
 if(request.operation==='get-bulk'&&[request.nonRepeaters??0,request.maxRepetitions??10].some(v=>!Number.isInteger(v)||v<0||v>100))return reject('malformed');
 const identity=authenticate(engine,device,request,source,destination);if(!identity.accepted)return reject(identity.reason??'identity');
 const oids:string[]=[];try{for(const oid of request.oids)oids.push(normalizeOID(oid));}catch{return reject('malformed');}
 stats.lastRequest={source,time:engine.clock.now(),version:request.version,operation:request.operation,accepted:true};
 if(request.operation==='set'){stats.setRequests++;stats.readOnlyErrors++;stats.outPackets++;return {application:'snmp',version:request.version,errorStatus:'notWritable',errorIndex:1,varbinds:[],scope:'NetworkSim read-only agent'};}
 if(request.operation==='get')stats.getRequests++;else if(request.operation==='get-bulk')stats.getBulkRequests++;else stats.getNextRequests++;
 const mib=snmpMIB(engine,device),accessible=mib.filter(r=>viewAllows(device.config.features.snmp,identity.view,r.oid)).sort((a,b)=>compareOID(a.oid,b.oid));
 let varbinds:SNMPVariable[]=oids.map(oid=>{if(request.operation==='get-next')return accessible.find(r=>compareOID(r.oid,oid)>0)??{oid,type:'Exception',exception:'endOfMibView'};if(!viewAllows(device.config.features.snmp,identity.view,oid))return {oid,type:'Exception',exception:'noSuchObject'};const row=mib.find(r=>r.oid===oid);if(row)return row;const base=oid.split('.').slice(0,-1).join('.'),knownInstance=mib.some(r=>r.oid.startsWith(base+'.'));return {oid,type:'Exception',exception:knownInstance?'noSuchInstance':'noSuchObject'};});
 if(request.operation==='get-bulk'){
  const n=Math.min(oids.length,request.nonRepeaters??0),columns=oids.slice(n),next=(oid:string):SNMPVariable=>accessible.find(r=>compareOID(r.oid,oid)>0)??{oid,type:'Exception',exception:'endOfMibView'};varbinds=oids.slice(0,n).map(next);
  for(let rep=0;rep<(request.maxRepetitions??10)&&varbinds.length<1000;rep++){const rows=columns.map(next);varbinds.push(...rows);rows.forEach((r,i)=>columns[i]=r.oid);if(rows.every(r=>r.exception==='endOfMibView'))break;}
 }
 varbinds=varbinds.slice(0,1000);
 const maxSize=Math.min(Number(device.config.features.snmp?.packetsize??1500),Number(request.maxMessageSize??65535));if(!Number.isInteger(maxSize)||maxSize<484)return reject('malformed');const bytes=(v:SNMPVariable[])=>new TextEncoder().encode(JSON.stringify(v)).length+96;
 if(request.operation==='get-bulk')while(varbinds.length&&bytes(varbinds)>maxSize)varbinds.pop();else if(bytes(varbinds)>maxSize){stats.outPackets++;return{application:'snmp',version:request.version,errorStatus:'tooBig',errorIndex:0,varbinds:[]};}
 stats.variablesRead+=varbinds.filter(r=>!('exception'in r)).length;stats.outPackets++;
 return {application:'snmp',version:request.version,errorStatus:'noError',errorIndex:0,varbinds,scope:'Logical SNMP; no BER, USM authentication digest, or encryption'};
}
export function snmpGet(engine:Simulator,sourceId:string,address:string,options:Omit<SNMPRequest,'application'|'operation'>&{operation?:SNMPRequest['operation']},transport:ServiceOptions={}):ServiceResult{return engine.udpRequest(sourceId,address,161,{...options,application:'snmp',operation:options.operation??'get'},transport);}
export function installSNMPServices(engine:Simulator):void{
 engine.registerUDPService(161,snmpEnabled,(device,payload,source,destination)=>handleSNMPRequest(engine,device,payload,source,destination));
 engine.registerUDPService(162,device=>device.config.services.snmpManager?.enabled===true,(device,payload,source)=>receiveSNMPNotification(engine,device,payload,source));
 const observed=new Map<string,{device:Device;runtime:Device['runtime'];powered:boolean;ports:Map<string,boolean>}>();let updating=false;
 engine.subscribe(()=>{if(updating)return;updating=true;try{
  synchronizeSNMPInforms(engine);
  const current=new Set(engine.lab.devices.map(d=>d.id));for(const id of observed.keys())if(!current.has(id))observed.delete(id);
  for(const device of engine.lab.devices){synchronizeSNMPIndexes(device);const previous=observed.get(device.id),powered=engine.devicePowered(device.id),ports=new Map(Object.keys(device.config.interfaces).map(name=>[name,engine.interfaceUp(device.id,name)]));observed.set(device.id,{device,runtime:device.runtime,powered,ports});
   if(!previous||previous.device!==device)continue;
   if(powered&&(!previous.powered||previous.runtime!==device.runtime)){sendSNMPNotification(engine,device.id,!previous.powered?'1.3.6.1.6.3.1.1.5.1':'1.3.6.1.6.3.1.1.5.2');continue;}
   if(!powered)continue;
   for(const[name,up]of ports){if(!previous.ports.has(name)||previous.ports.get(name)===up)continue;const index=snmpIfIndex(device,name),prefix='1.3.6.1.2.1.2.2.1.';sendSNMPNotification(engine,device.id,up?'1.3.6.1.6.3.1.1.5.4':'1.3.6.1.6.3.1.1.5.3',[{oid:prefix+'1.'+index,type:'Integer',value:index},{oid:prefix+'7.'+index,type:'Integer',value:device.config.interfaces[name].adminUp?1:2},{oid:prefix+'8.'+index,type:'Integer',value:up?1:2}]);}
  }
 }finally{updating=false;}});
}
type InformJob={deviceId:string;runtime:Device['runtime'];host:string;result:ServiceResult;timer?:any;request?:ServiceResult;attempts:number;deadline:number;payload:any;source?:string;retries:number;timeout:number};
const informState=new WeakMap<Simulator,{sequence:number;jobs:Map<string,InformJob>}>();
function informs(e:Simulator){let state=informState.get(e);if(!state){state={sequence:0,jobs:new Map()};informState.set(e,state);}return state;}
function finishInform(e:Simulator,job:InformJob,error?:string):void{e.clock.cancel(job.timer);informs(e).jobs.delete(job.result.id);Object.assign(job.result,{status:error?'failure':'success',attempts:job.attempts,...error?{error}:{acknowledged:true}});if(job.request?.status==='running')e.cancelServiceRequest(job.request.id,error??'SNMP notification completed');const d=e.getDevice(job.deviceId);if(d?.runtime===job.runtime){const stats=snmpStatistics(d);if(error)stats.informsFailed++;else stats.informsAcknowledged++;}e.notify();}
function synchronizeSNMPInforms(e:Simulator):void{for(const job of informs(e).jobs.values()){const d=e.getDevice(job.deviceId);if(!d||d.runtime!==job.runtime||!e.devicePowered(d.id))finishInform(e,job,'Notification sender stopped or restarted');else if(!d.config.features.snmp?.hosts?.some((h:any)=>h.address===job.host&&h.options?.includes('informs')))finishInform(e,job,'Notification destination removed');}}
function pollInform(e:Simulator,job:InformJob):void{
 if(!informs(e).jobs.has(job.result.id))return;const d=e.getDevice(job.deviceId);if(!d||d.runtime!==job.runtime||!e.devicePowered(d.id)){finishInform(e,job,'Notification sender stopped or restarted');return;}
 if(job.request?.status==='success'&&job.request.application==='snmp-response'&&job.request.notificationId===job.payload.notificationId&&job.request.errorStatus==='noError'){finishInform(e,job);return;}
 if(!job.request||e.clock.now()>=job.deadline){if(job.attempts>job.retries){finishInform(e,job,'No SNMP inform acknowledgement received');return;}job.attempts++;job.result.attempts=job.attempts;job.deadline=e.clock.now()+job.timeout;job.request=e.udpRequest(d.id,job.host,162,job.payload,{source:job.source,timeout:job.timeout});snmpStatistics(d).informsSent++;if(job.request.status!=='failure')snmpStatistics(d).trapsSent++;}
 job.timer=e.clock.schedule(100,()=>pollInform(e,job),{owner:d.id,label:'SNMP inform acknowledgement / retry'});
}
function v3NotificationIdentity(d:Device,name:string,level:string,oid:string):any|undefined{
 const c=d.config.features.snmp??{},user=ownRecordValue(c.users,name),group=user&&ownRecordValue(c.groups,user[0]);if(!Array.isArray(user)||user[1]!=='v3'||user.includes('remote')||user.includes('encrypted')||!Array.isArray(group)||group[0]!=='v3')return;
 const ranks:Record<string,number>={noauth:0,auth:1,priv:2};if(!Object.hasOwn(ranks,level)||ranks[level]<(ranks[group[1]]??0))return;
 const view=after(group,'notify');if(view&&!viewAllows(c,view,oid))return;const auth=user.indexOf('auth'),priv=user.indexOf('priv'),authPassword=auth>=0?user[auth+1]==='sha-2'?user[auth+3]:user[auth+2]:undefined,privacyPassword=priv>=0?user[priv+1]==='aes'?user[priv+3]:user[priv+2]:undefined;if(ranks[level]>=1&&(!authPassword||!['md5','sha','sha-2'].includes(user[auth+1])||user[auth+1]==='sha-2'&&!['256','384','512'].includes(user[auth+2]))||level==='priv'&&(!privacyPassword||!['des','3des','aes'].includes(user[priv+1])||user[priv+1]==='aes'&&!['128','192','256'].includes(user[priv+2])))return;
 return{username:name,securityLevel:level,...ranks[level]>=1?{authPassword}:{},...level==='priv'?{privacyPassword}:{}};
}
function receiveSNMPNotification(e:Simulator,d:Device,p:any,source:string):any{
 if(p?.application!=='snmp-notification'||!['2c','3'].includes(p.version)||!Array.isArray(p.varbinds)||p.varbinds.length>1000)return;
 const cfg=d.config.services.snmpManager??{},stats=snmpStatistics(d);let accepted=false;
 if(p.version==='2c')accepted=typeof p.community==='string'&&(!cfg.community||cfg.community===p.community);
 else{const expected=cfg.security,ranks:Record<string,number>={noauth:0,auth:1,priv:2},level=p.securityLevel??'noauth';accepted=!!expected&&p.username===expected.username&&Object.hasOwn(ranks,level)&&ranks[level]>=(ranks[expected.securityLevel??'noauth']??0)&&(ranks[level]<1||!!expected.authPassword&&p.authPassword===expected.authPassword)&&(ranks[level]<2||!!expected.privacyPassword&&p.privacyPassword===expected.privacyPassword);}
 if(!accepted){stats.authenticationFailures++;return;}let variables:SNMPVariable[];try{variables=p.varbinds.map((r:any)=>({oid:normalizeOID(r.oid),type:String(r.type),...typeof r.value==='number'||typeof r.value==='string'?{value:r.value}:{}}));}catch{return;}
 const seen=d.runtime.features.snmpNotificationSeen??={},id=source+'|'+String(p.notificationId),duplicate=p.kind==='inform'&&seen[id]>e.clock.now();for(const[k,at]of Object.entries<number>(seen))if(at<=e.clock.now())delete seen[k];
 if(!duplicate){const received=d.runtime.features.snmpNotifications??=[];received.push({application:'snmp-notification',version:p.version,kind:p.kind??'trap',notificationId:p.notificationId,...p.version==='2c'?{community:p.community}:{username:p.username,securityLevel:p.securityLevel},varbinds:variables,source,received:e.clock.now()});if(received.length>500)received.shift();stats.trapsReceived++;}
 if(p.kind==='inform'){seen[id]=e.clock.now()+300000;return{application:'snmp-response',notificationId:p.notificationId,errorStatus:'noError',errorIndex:0,varbinds:variables};}
}
/** Delivered logical v2c/v3 traps and acknowledged, retried informs. */
export function sendSNMPNotification(engine:Simulator,deviceId:string,notification:string,varbinds:SNMPVariable[]=[]):ServiceResult[]{
 const device=engine.getDevice(deviceId);if(!device?.powered)return [];const config=device.config.features.snmp;if(!config?.traps)return [];const results:ServiceResult[]=[];
 const oid=normalizeOID(notification),category:Record<string,string>={'1.3.6.1.6.3.1.1.5.1':'coldstart','1.3.6.1.6.3.1.1.5.2':'warmstart','1.3.6.1.6.3.1.1.5.3':'linkdown','1.3.6.1.6.3.1.1.5.4':'linkup','1.3.6.1.6.3.1.1.5.5':'authentication'},allows=(list:string[])=>!list?.length||list.length===1&&list[0]==='snmp'||list.includes(category[oid]);
 if(!allows(config.trapCategories))return [];
 for(const host of config.hosts??[]){const options:string[]=host.options??[],at=options.indexOf('version'),version=options[at+1],isInform=options.includes('informs');if(at<0||!['2c','3'].includes(version))continue;
  const identity=version==='2c'?{community:options[at+2]}:v3NotificationIdentity(device,options[at+3],options[at+2],oid);if(!identity||!allows(options.slice(at+(version==='3'?4:3))))continue;
  const source=config['trap-source']??config['source-interface'],variables=[{oid:'1.3.6.1.2.1.1.3.0',type:'TimeTicks',value:Math.floor(Math.max(0,engine.clock.now()-(device.runtime.features.bootTime??0))/10)},{oid:'1.3.6.1.6.3.1.1.4.1.0',type:'ObjectIdentifier',value:oid},...varbinds],state=informs(engine),notificationId=`${device.id}:${++state.sequence}`,payload={application:'snmp-notification',version,kind:isInform?'inform':'trap',notificationId,...identity,varbinds:variables};
  if(!isInform){const result=engine.udpNotify(deviceId,host.address,162,payload,{source,timeout:1000});results.push(result);if(result.status==='success')snmpStatistics(device).trapsSent++;continue;}
  const result:ServiceResult={id:'snmp-inform-'+notificationId,status:'running',host:host.address,attempts:0},pending=[...state.jobs.values()].filter(j=>j.deviceId===device.id).length,limit=Number(config.informs?.pending??25);results.push(result);if(pending>=limit){const oldest=[...state.jobs.values()].find(j=>j.deviceId===device.id);if(oldest)finishInform(engine,oldest,'SNMP inform pending limit discarded the oldest request');}
  const job:InformJob={deviceId,runtime:device.runtime,host:host.address,result,attempts:0,deadline:0,payload,source,retries:Number(config.informs?.retries??3),timeout:1000*Number(config.informs?.timeout??30)};state.jobs.set(result.id,job);pollInform(engine,job);
 }
 return results;
}
