import type {Simulator} from './engine.ts';
import {basicAuthorization,type HTTPRequestOptions} from './http-service.ts';
import {isIPv4,isIPv6} from './ip.ts';
import {managementFor} from './management.ts';
import {createCLISession} from './session.ts';
import {modelConfigSnapshot,type NETCONFConfigSnapshot} from './model-driven-management.ts';
export const RESTCONF_MEDIA='application/yang-data+json',RESTCONF_INTERFACES='/restconf/data/ietf-interfaces:interfaces',RESTCONF_DATA=RESTCONF_INTERFACES+'/interface=GigabitEthernet0%2F1',RESTCONF_LOOPBACK=RESTCONF_INTERFACES+'/interface=Loopback10';
const list=(...items:Record<string,unknown>[])=>({'ietf-interfaces:interface':items}),lo=(description?:string)=>({name:'Loopback10',type:'iana-if-type:softwareLoopback',enabled:true,...description?{description}:{},'ietf-ip:ipv4':{address:[{ip:'192.0.2.10',netmask:'255.255.255.255'}]}});
export const RESTCONF_EXAMPLES={
 root:{label:'GET · RESTCONF root',method:'GET',path:'/restconf'},
 interfaces:{label:'GET · data interface and operational state',method:'GET',path:RESTCONF_DATA},
 hostname:{label:'GET · native hostname',method:'GET',path:'/restconf/data/Cisco-IOS-XE-native:native/hostname'},
 rename:{label:'PATCH · rename the router',method:'PATCH',path:'/restconf/data/Cisco-IOS-XE-native:native/hostname',body:{'Cisco-IOS-XE-native:hostname':'R1-API'}},
 restore:{label:'PATCH · restore the router name',method:'PATCH',path:'/restconf/data/Cisco-IOS-XE-native:native/hostname',body:{'Cisco-IOS-XE-native:hostname':'R1'}},
 create:{label:'POST · create Loopback10 (repeat for conflict)',method:'POST',path:RESTCONF_INTERFACES,body:list(lo('Created via RESTCONF'))},
 loopback:{label:'GET · Loopback10',method:'GET',path:RESTCONF_LOOPBACK},
 merge:{label:'PATCH · merge the loopback description',method:'PATCH',path:RESTCONF_LOOPBACK,body:list({name:'Loopback10',description:'Merged via RESTCONF'})},
 replace:{label:'PUT · replace the loopback, omitting description',method:'PUT',path:RESTCONF_LOOPBACK,body:list(lo())},
 invalid:{label:'PATCH · reject an invalid multi-interface edit',method:'PATCH',path:RESTCONF_INTERFACES,body:list({name:'GigabitEthernet0/1',enabled:false},{name:'Loopback11','ietf-ip:ipv4':{address:[{ip:'bad-address',netmask:'255.255.255.0'}]}})},
 shutdown:{label:'PUT · disable the data interface',method:'PUT',path:RESTCONF_DATA+'/enabled',body:{'ietf-interfaces:enabled':false}},
 recover:{label:'PATCH · restore the data interface',method:'PATCH',path:RESTCONF_DATA+'/enabled',body:{'ietf-interfaces:enabled':true}},
 remove:{label:'DELETE · remove Loopback10',method:'DELETE',path:RESTCONF_LOOPBACK},
 final:{label:'PATCH · final loopback description',method:'PATCH',path:RESTCONF_LOOPBACK,body:list({name:'Loopback10',description:'RESTCONF verified'})},
} satisfies Record<string,{label:string;method:NonNullable<HTTPRequestOptions['method']>;path:string;body?:Record<string,unknown>}>;
export interface RESTCONFRequest {address:string;username:string;password:string;method:NonNullable<HTTPRequestOptions['method']>;path:string;body?:string;accept?:string;contentType?:string}
export interface RESTCONFRecord {started:number;completed:number;transaction:string;sourceId:string;targetId?:string;address:string;username:string;method:string;path:string;body:string;accept:string;contentType:string;httpAccessClass?:string;status:'success'|'failure';statusCode?:number;headers:Record<string,string>;content:string;error?:string;before?:NETCONFConfigSnapshot;after?:NETCONFConfigSnapshot}
export interface RESTCONFClientState {address:string;username:string;method:string;path:string;body:string;accept:string;contentType:string;requests:RESTCONFRecord[]}
export function restconfState(sim:Simulator,deviceId:string):RESTCONFClientState{const d=sim.getDevice(deviceId);if(!d)throw Error('Unknown RESTCONF source.');return d.runtime.features.restconfClient??={address:'',username:'',method:'GET',path:RESTCONF_INTERFACES,body:'',accept:RESTCONF_MEDIA,contentType:RESTCONF_MEDIA,requests:[]};}
export function restconfTranscript(r:RESTCONFRecord){return {transaction:r.transaction,started:r.started,completed:r.completed,address:r.address,username:r.username,method:r.method,path:r.path,requestBody:r.body,accept:r.accept,contentType:r.contentType,status:r.status,statusCode:r.statusCode,headers:r.headers,content:r.content,error:r.error};}
/** Stateless in-lab HTTPS client; credentials exist only in the request, never in retained evidence. */
export function requestRESTCONF(sim:Simulator,sourceId:string,request:RESTCONFRequest):RESTCONFRecord {
 const {address,username,password,method,path}=request;if(!isIPv4(address)&&!isIPv6(address))throw Error('Enter a resolved IPv4 or IPv6 target address.');if(!username||username.length>256||!password||password.length>1024)throw Error('Enter the lab username and password.');if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method)||!path.startsWith('/restconf')||path.length>2048)throw Error('Use a supported method and a /restconf resource path.');if((request.body?.length??0)>32768)throw Error('Keep JSON requests within 32 KiB.');
 managementFor(sim,id=>createCLISession(sim,id,{skipConsoleLogin:true}));const target=sim.lab.devices.find(d=>Object.values(d.config.interfaces).some(p=>p.ip===address)),before=target?modelConfigSnapshot(target.config):undefined,httpAccessClass=target?.config.services.http?.acl,started=sim.clock.now(),accept=request.accept??RESTCONF_MEDIA,contentType=request.contentType??RESTCONF_MEDIA,body=['GET','HEAD','DELETE'].includes(method)?'':request.body??'';
 const state=restconfState(sim,sourceId);Object.assign(state,{address,username,method,path,body:request.body??'',accept,contentType});
 const response=sim.fetchHTTP(sourceId,address,path,{secure:true,method,timeout:5000,headers:{Authorization:basicAuthorization(username,password),Accept:accept,'Content-Type':contentType},body});for(let n=0;response.status==='running'&&n<60;n++)sim.advance(100);
 const record:RESTCONFRecord={started,completed:sim.clock.now(),transaction:response.id,sourceId,targetId:target?.id,address,username,method,path,body,accept,contentType,httpAccessClass,status:response.status==='success'?'success':'failure',statusCode:response.statusCode,headers:structuredClone(response.headers??{}),content:String(response.content??'').slice(0,32768),error:response.error,before,after:target?modelConfigSnapshot(target.config):undefined};state.requests.push(record);if(state.requests.length>100)state.requests.shift();sim.notify();return record;
}
