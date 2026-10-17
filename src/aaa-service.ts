import type{Simulator}from'./engine.ts';import type{Device}from'./model.ts';
import {ownRecordValue,accountCredential} from './record-map.ts';
import {receiveAccounting} from './aaa-accounting.ts';
/** Shared simulated AAA endpoint; service availability never depends on opening a console. */
export function handleAAARequest(engine:Simulator,device:Device,protocol:string,payload:any,source:string):Record<string,any>{
 if(payload?.operation==='accounting')return protocol==='tacacs'?receiveAccounting(engine,device,'tacacs',payload,source)??{accounted:false}: {accounted:false,error:'Use the RADIUS accounting listener'};
 const service=device.config.services[protocol],user=ownRecordValue(service?.users,payload?.username),expected=accountCredential(user),shared=typeof payload?.key==='string'&&typeof service?.secret==='string'&&service.secret.length>0&&payload.key===service.secret,authorization=payload?.operation==='authorize';
 const accepted=shared&&expected!==undefined&&(authorization?(payload.kind==='exec'||(user.privilege??1)>=(payload.requiredPrivilege??15)):typeof payload?.password==='string'&&expected===payload.password);
 const requests=device.runtime.features.aaaRequests??=[];requests.push({protocol,source,operation:authorization?'authorize':'authenticate',kind:payload?.kind,username:payload?.username,accepted,time:engine.clock.now()});if(requests.length>1000)requests.shift();
 return{accepted,privilege:accepted?user.privilege??1:undefined,reason:accepted?'Accept':shared?'Reject':'Shared key mismatch'};
}
export function installAAAServices(engine:Simulator):void{engine.registerUDPService(1812,d=>!!d.config.services.radius?.enabled,(d,payload,source)=>handleAAARequest(engine,d,'radius',payload,source));engine.registerUDPService(1813,d=>!!d.config.services.radius?.enabled,(d,payload,source)=>receiveAccounting(engine,d,'radius',payload,source));engine.registerTCPService(49,d=>!!d.config.services.tacacs?.enabled,(d,payload,source)=>handleAAARequest(engine,d,'tacacs',payload,source));}
