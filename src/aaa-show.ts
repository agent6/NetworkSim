import type {Device} from './model.ts';
import {aaaStats,type AAAStats} from './aaa-client.ts';
const entries=(d:Device,protocol?:string)=>Object.entries<any>(d.config.features.aaa?.servers??{}).filter(([,s])=>!protocol||s.protocol===protocol);
function total(d:Device,protocol:string,operation:string):AAAStats {
 const result:AAAStats={requests:0,responses:0,accepts:0,rejects:0,errors:0,timeouts:0,retransmits:0};
 for(const [name]of entries(d,protocol)){const s=aaaStats(d,name,operation);for(const key of Object.keys(result) as (keyof AAAStats)[])result[key]!+=s[key]??0;}return result;
}
export function showAAAServers(d:Device):string[]{return entries(d).flatMap(([name,s],i)=>{
 const auth=aaaStats(d,name,'authenticate'),authz=aaaStats(d,name,'authorize'),acct=aaaStats(d,name,'accounting'),sum=(key:keyof AAAStats)=>(auth[key]??0)+(authz[key]??0)+(acct[key]??0);
 return [`${s.protocol==='radius'?'RADIUS':'TACACS+'}: id ${i+1}, priority ${i+1}, host ${s.address??'not configured'}, ${s.protocol==='radius'?`auth-port ${s.port??1812}, acct-port ${s.accountingPort??1813}, hostname ${name}`:`port ${s.port??49}`}`,`     Authen: request ${auth.requests}, timeouts ${auth.timeouts}`,`             Response: accept ${auth.accepts}, reject ${auth.rejects}`,`     Author: request ${authz.requests}, timeouts ${authz.timeouts}`,`             Response: accept ${authz.accepts}, reject ${authz.rejects}`,`     Account: request ${acct.requests}, timeouts ${acct.timeouts}`,`     Retransmissions: ${sum('retransmits')}`];
 });}
export function showRadiusStatistics(d:Device):string[]{
 const auth=total(d,'radius','authenticate'),authz=total(d,'radius','authorize'),acct=total(d,'radius','accounting');
 const row=(label:string,a:number,b:number)=>`${label.padStart(27)}: ${String(a).padStart(10)} ${String(b).padStart(10)} ${String(a+b).padStart(10)}`;
 return ['                                  Auth.      Acct.       Both',row('Total responses seen',auth.responses+authz.responses,acct.responses),row('Packets with responses',auth.responses+authz.responses,acct.responses),row('Packets without responses',auth.errors+authz.errors,acct.errors),`  Access Rejects           : ${String(auth.rejects+authz.rejects).padStart(10)}`,`  Access Accepts           : ${String(auth.accepts+authz.accepts).padStart(10)}`,row('Number of Radius timeouts',auth.timeouts+authz.timeouts,acct.timeouts),'NetworkSim: logical authentication/accounting counters; binary authenticators, queues and latency distributions are not modeled.'];
}
export function showTacacs(d:Device):string[]{return entries(d,'tacacs').flatMap(([name,s])=>{
 const auth=aaaStats(d,name,'authenticate'),authz=aaaStats(d,name,'authorize'),acct=aaaStats(d,name,'accounting');
 return [`Tacacs+ Server - ${s.address??'not configured'}/${s.port??49}`,`              Errors: ${auth.errors+authz.errors+acct.errors}`,`              Authentication requests: ${auth.requests}`,`              Authorization requests: ${authz.requests}`,`              Accounting requests: ${acct.requests}`,`              Replies: ${auth.responses+authz.responses+acct.responses}`,'NetworkSim: logical AAA exchanges; native wire-packet and socket counters are not modeled.'];
 });}
