import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {renderConfig} from './config-renderer.ts';
import {ownRecordValue} from './record-map.ts';
import {sameAddress} from './ip.ts';

type CopyCriterion={device:string;server:string;protocol:'scp'|'sftp';operation:'read'|'write';username:string;localPath:string;remotePath:string};
export type FileTransferCriterion=
 | {kind:'ssh-file-client';device:string;interface:string}
 | {kind:'scp-server';device:string}
 | (CopyCriterion & {kind:'file-transfer'|'file-copy'});

export function validFileTransferCriterion(v:any):boolean{
 const name=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=128;
 const path=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=200&&!/[\x00-\x1f\\]/.test(s)&&!s.split('/').some(p=>p==='..'||p==='.');
 if(v.kind==='scp-server')return true;
 if(v.kind==='ssh-file-client')return name(v.interface);
 return ['file-transfer','file-copy'].includes(v.kind)&&name(v.server)&&name(v.username)&&['scp','sftp'].includes(v.protocol)&&['read','write'].includes(v.operation)&&path(v.localPath)&&path(v.remotePath);
}
const host=(d:Device)=>['pc','laptop'].includes(d.kind);
const file=(d:Device,path:string):unknown=>{
 if(!host(d)&&path==='running-config')return renderConfig(d).join('\n');
 if(!host(d)&&path==='startup-config')return d.startupConfig?renderConfig(d,d.startupConfig).join('\n'):undefined;
 return ownRecordValue(host(d)?d.config.services.sshFiles?.files:d.config.features.files,path.replace(/^flash:/,''));
};
const owns=(d:Device,address:unknown)=>typeof address==='string'&&Object.values(d.config.interfaces).some(p=>!!p.ip&&sameAddress(p.ip,address));

/** Keep file integrity live; separately remember proof of a correlated, completed client transfer. */
export function matchesFileTransferCriterion(sim:Simulator,d:Device,c:FileTransferCriterion):boolean{
 if(c.kind==='scp-server')return d.config.features.managementSettings?.scp===true;
 if(c.kind==='ssh-file-client')return d.config.features.ssh?.sourceInterface===c.interface&&sim.interfaceUp(d.id,c.interface);
 const server=sim.lab.devices.find(s=>s.id===c.server||s.config.hostname===c.server);if(!server)return false;
 if(c.kind==='file-copy'){
  const local=file(d,c.localPath),remote=file(server,c.remotePath);
  return typeof local==='string'&&local.length>0&&local===remote;
 }
 const copies:any[]=d.runtime.features.sshFileCopies??[],received:any[]=server.runtime.features.sshFileTransfers??[];
 return copies.some(copy=>copy.protocol===c.protocol&&copy.operation===c.operation&&copy.username===c.username&&copy.path===c.remotePath&&copy.localPath===c.localPath&&owns(server,copy.address)&&typeof copy.transferId==='string'&&received.some(row=>row.transferId===copy.transferId&&row.protocol===copy.protocol&&row.operation===copy.operation&&row.path===copy.path&&row.username===copy.username&&row.bytes===copy.bytes&&owns(d,row.source)&&row.time<=copy.time));
}
