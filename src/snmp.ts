import {ownRecordValue} from './record-map.ts';
import type {Simulator,ServiceResult,ServiceOptions} from './engine.ts';
import type {Device} from './model.ts';
import {interfaceSpeed} from './ethernet.ts';

/** Logical SNMP PDUs traverse UDP. ASN.1/BER and USM cryptography are not emulated. */
export interface SNMPRequest {application:'snmp';version:'2c'|'3';operation:'get'|'get-next'|'set';community?:string;username?:string;securityLevel?:'noauth'|'auth'|'priv';authPassword?:string;privacyPassword?:string;oids:string[]}
export interface SNMPVariable {oid:string;type:string;value?:string|number;exception?:'noSuchObject'|'noSuchInstance'|'endOfMibView'}
export interface SNMPStatistics {inPackets:number;outPackets:number;getRequests:number;getNextRequests:number;setRequests:number;badVersions:number;badCommunityNames:number;authenticationFailures:number;accessDenied:number;readOnlyErrors:number;variablesRead:number;trapsSent:number;trapsReceived:number;lastRequest?:{source:string;time:number;version:string;operation:string;accepted:boolean;reason?:string}}
const zero=():SNMPStatistics=>({inPackets:0,outPackets:0,getRequests:0,getNextRequests:0,setRequests:0,badVersions:0,badCommunityNames:0,authenticationFailures:0,accessDenied:0,readOnlyErrors:0,variablesRead:0,trapsSent:0,trapsReceived:0});
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
export function snmpMIB(engine:Simulator,device:Device):SNMPVariable[]{
 const config=device.config.features.snmp??{},rows:SNMPVariable[]=[],add=(oid:string,type:string,value:string|number)=>rows.push({oid,type,value});
 add('1.3.6.1.2.1.1.1.0','OctetString',`NetworkSim original ${device.kind} educational agent; IOS XE 17.12-style read-only networking subset`);
 add('1.3.6.1.2.1.1.2.0','ObjectIdentifier','0.0'); // No assigned vendor enterprise OID; do not impersonate Cisco hardware.
 add('1.3.6.1.2.1.1.3.0','TimeTicks',Math.floor(Math.max(0,engine.clock.now()-(device.runtime.features.bootTime??0))/10)%4294967296);
 add('1.3.6.1.2.1.1.4.0','OctetString',config.contact??'');add('1.3.6.1.2.1.1.5.0','OctetString',device.config.hostname);add('1.3.6.1.2.1.1.6.0','OctetString',config.location??'');
 add('1.3.6.1.2.1.1.7.0','Integer',device.kind==='switch'||device.kind==='poeswitch'?2:device.kind==='l3switch'?6:device.kind==='router'?4:72);
 const ports=Object.values(device.config.interfaces);add('1.3.6.1.2.1.2.1.0','Integer',ports.length);
 ports.forEach((port,i)=>{const index=i+1,prefix='1.3.6.1.2.1.2.2.1.',counters=device.runtime.counters[port.name];for(const[column,type,value]of [[1,'Integer',index],[2,'OctetString',port.name],[3,'Integer',port.name==='Wireless0'?71:/^(Loopback)/.test(port.name)?24:/^Tunnel/.test(port.name)?131:6],[4,'Integer',port.mtu],[5,'Gauge32',Math.min(4294967295,interfaceSpeed(device,port)*1000000)],[6,'OctetString',engine.macOf(device.id,port.name)],[7,'Integer',port.adminUp?1:2],[8,'Integer',engine.interfaceUp(device.id,port.name)?1:2],[10,'Counter32',(counters?.rxBytes??0)%4294967296],[11,'Counter32',(counters?.rx??0)%4294967296],[16,'Counter32',(counters?.txBytes??0)%4294967296],[17,'Counter32',(counters?.tx??0)%4294967296]] as Array<[number,string,string|number]>)add(prefix+column+'.'+index,type,value);});
 return rows;
}
const compareOID=(a:string,b:string)=>{const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length;};
/** Called only after the UDP request reached this device and ingress policies permitted it. */
export function handleSNMPRequest(engine:Simulator,device:Device,payload:any,source:string,destination='0.0.0.0'):Record<string,any>|undefined{
 const stats=snmpStatistics(device);stats.inPackets++;const request=payload as SNMPRequest;
 const reject=(reason:string)=>{if(reason==='version')stats.badVersions++;else if(reason==='community')stats.badCommunityNames++;else if(reason==='access-list')stats.accessDenied++;else stats.authenticationFailures++;stats.lastRequest={source,time:engine.clock.now(),version:String(request?.version),operation:String(request?.operation),accepted:false,reason};engine.emit({nodeId:device.id,protocol:'SNMP',label:'SNMP request discarded',detail:reason==='access-list'?'Manager denied by SNMP access-list.':'SNMP security identity or request is not supported.',disposition:'drop'});if(['community','user','security-level','authentication','privacy','authentication-algorithm','privacy-algorithm'].includes(reason))sendSNMPNotification(engine,device.id,'1.3.6.1.6.3.1.1.5.5');return undefined;};
 if(!request||request.application!=='snmp'||!Array.isArray(request.oids)||request.oids.length<1||request.oids.length>100||!['get','get-next','set'].includes(request.operation))return reject('malformed');
 const identity=authenticate(engine,device,request,source,destination);if(!identity.accepted)return reject(identity.reason??'identity');
 const oids:string[]=[];try{for(const oid of request.oids)oids.push(normalizeOID(oid));}catch{return reject('malformed');}
 stats.lastRequest={source,time:engine.clock.now(),version:request.version,operation:request.operation,accepted:true};
 if(request.operation==='set'){stats.setRequests++;stats.readOnlyErrors++;stats.outPackets++;return {application:'snmp',version:request.version,errorStatus:'notWritable',errorIndex:1,varbinds:[],scope:'NetworkSim read-only agent'};}
 if(request.operation==='get')stats.getRequests++;else stats.getNextRequests++;
 const mib=snmpMIB(engine,device),accessible=mib.filter(r=>viewAllows(device.config.features.snmp,identity.view,r.oid)).sort((a,b)=>compareOID(a.oid,b.oid));
 const varbinds=oids.map(oid=>{if(request.operation==='get-next')return accessible.find(r=>compareOID(r.oid,oid)>0)??{oid,type:'Exception',exception:'endOfMibView'};if(!viewAllows(device.config.features.snmp,identity.view,oid))return {oid,type:'Exception',exception:'noSuchObject'};const row=mib.find(r=>r.oid===oid);if(row)return row;const base=oid.split('.').slice(0,-1).join('.'),knownInstance=mib.some(r=>r.oid.startsWith(base+'.'));return {oid,type:'Exception',exception:knownInstance?'noSuchInstance':'noSuchObject'};});
 stats.variablesRead+=varbinds.filter(r=>!('exception'in r)).length;stats.outPackets++;
 return {application:'snmp',version:request.version,errorStatus:'noError',errorIndex:0,varbinds,scope:'Logical SNMP; no BER, USM authentication digest, or encryption'};
}
export function snmpGet(engine:Simulator,sourceId:string,address:string,options:Omit<SNMPRequest,'application'|'operation'>&{operation?:SNMPRequest['operation']},transport:ServiceOptions={}):ServiceResult{return engine.udpRequest(sourceId,address,161,{...options,application:'snmp',operation:options.operation??'get'},transport);}
export function installSNMPServices(engine:Simulator):void{
 engine.registerUDPService(161,snmpEnabled,(device,payload,source,destination)=>handleSNMPRequest(engine,device,payload,source,destination));
 engine.registerUDPService(162,device=>device.config.services.snmpManager?.enabled===true,(device,payload,source)=>{if(payload?.application!=='snmp-notification'||!Array.isArray(payload.varbinds))return undefined;const received=device.runtime.features.snmpNotifications??=[];received.push({...payload,source,received:engine.clock.now()});if(received.length>500)received.shift();snmpStatistics(device).trapsReceived++;return {received:true};});
 const observed=new Map<string,{device:Device;runtime:Device['runtime'];powered:boolean;ports:Map<string,boolean>}>();let updating=false;
 engine.subscribe(()=>{if(updating)return;updating=true;try{
  const current=new Set(engine.lab.devices.map(d=>d.id));for(const id of observed.keys())if(!current.has(id))observed.delete(id);
  for(const device of engine.lab.devices){const previous=observed.get(device.id),powered=engine.devicePowered(device.id),ports=new Map(Object.keys(device.config.interfaces).map(name=>[name,engine.interfaceUp(device.id,name)]));observed.set(device.id,{device,runtime:device.runtime,powered,ports});
   if(!previous||previous.device!==device)continue;
   if(powered&&(!previous.powered||previous.runtime!==device.runtime)){sendSNMPNotification(engine,device.id,!previous.powered?'1.3.6.1.6.3.1.1.5.1':'1.3.6.1.6.3.1.1.5.2');continue;}
   if(!powered)continue;
   for(const[name,up]of ports){if(!previous.ports.has(name)||previous.ports.get(name)===up)continue;const index=Object.keys(device.config.interfaces).indexOf(name)+1,prefix='1.3.6.1.2.1.2.2.1.';sendSNMPNotification(engine,device.id,up?'1.3.6.1.6.3.1.1.5.4':'1.3.6.1.6.3.1.1.5.3',[{oid:prefix+'1.'+index,type:'Integer',value:index},{oid:prefix+'7.'+index,type:'Integer',value:device.config.interfaces[name].adminUp?1:2},{oid:prefix+'8.'+index,type:'Integer',value:up?1:2}]);}
  }
 }finally{updating=false;}});
}
/** Logical unacknowledged v2c traps. Informs/v3 notifications remain unsupported. */
export function sendSNMPNotification(engine:Simulator,deviceId:string,notification:string,varbinds:SNMPVariable[]=[]):ServiceResult[]{
 const device=engine.getDevice(deviceId);if(!device?.powered)return [];const config=device.config.features.snmp;if(!config?.traps)return [];const results:ServiceResult[]=[];
 const oid=normalizeOID(notification),category:Record<string,string>={'1.3.6.1.6.3.1.1.5.1':'coldstart','1.3.6.1.6.3.1.1.5.2':'warmstart','1.3.6.1.6.3.1.1.5.3':'linkdown','1.3.6.1.6.3.1.1.5.4':'linkup','1.3.6.1.6.3.1.1.5.5':'authentication'},allows=(list:string[])=>!list?.length||list.length===1&&list[0]==='snmp'||list.includes(category[oid]);
 if(!allows(config.trapCategories))return [];
 for(const host of config.hosts??[]){const options:string[]=host.options??[],at=options.indexOf('version');if(options.includes('informs')||at<0||options[at+1]!=='2c')continue;const community=options[at+2];if(!community||!allows(options.slice(at+3)))continue;const source=config['trap-source']??config['source-interface'];const variables=[{oid:'1.3.6.1.2.1.1.3.0',type:'TimeTicks',value:Math.floor(Math.max(0,engine.clock.now()-(device.runtime.features.bootTime??0))/10)},{oid:'1.3.6.1.6.3.1.1.4.1.0',type:'ObjectIdentifier',value:oid},...varbinds],result=engine.udpNotify(deviceId,host.address,162,{application:'snmp-notification',version:'2c',community,varbinds:variables},{source,timeout:1000});results.push(result);if(result.status==='success')snmpStatistics(device).trapsSent++;}
 return results;
}
