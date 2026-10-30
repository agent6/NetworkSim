import type {Simulator,ServiceResult} from './engine.ts';import type {Device} from './model.ts';import {renderConfig} from './config-renderer.ts';import {writeFlashFile} from './filesystem.ts';
export interface SSHFileRequest {application:'ssh-file';protocol:'scp'|'sftp';operation:'read'|'write';username:string;password:string;path:string;content?:string;transferId?:string}
export function sshFileEnabled(d:Device):boolean{return d.kind==='server'?false:['pc','laptop'].includes(d.kind)?!!d.config.services.sshFiles?.enabled:['router','switch','l3switch','poeswitch','wlc'].includes(d.kind)&&!!d.config.features.managementSettings?.scp&&!!d.config.features.ssh?.keys;}
export type SSHFileAuthenticator=(username:string,password:string)=>{accepted:boolean;privilege?:number};
/** Structured teaching SCP/SFTP operation over delivered TCP; SSH encryption is not emulated. */
export function handleSSHFile(engine:Simulator,d:Device,r:SSHFileRequest,source:string,destination:string,authenticate?:SSHFileAuthenticator):Record<string,any>{
 const host=['pc','laptop','server'].includes(d.kind),service=d.config.services.sshFiles??{};
 const failure=(error:string)=>({error,protocol:r.protocol});
 if(!sshFileEnabled(d))return failure('SSH file service is disabled');
 if(!['scp','sftp'].includes(r.protocol)||!host&&r.protocol==='sftp')return failure('This IOS XE reference is an SCP server; SFTP server mode is unsupported');
 if(!['read','write'].includes(r.operation))return failure('Invalid file operation');
 const vty=Object.entries<any>(d.config.features.lines??{}).find(([name,line])=>name.startsWith('vty ')&&(line.transport==='all'||String(line.transport).split(' ').includes('ssh')));
 if(!host&&!vty)return failure('SSH VTY transport is disabled');
 const acl=vty?.[1]?.[source.includes(':')?'ipv6AccessClassIn':'accessClassIn'];if(acl&&!engine.aclPermits(d.id,acl,source,destination,'tcp',{destinationPort:22}))return failure('VTY access-class denied file transfer');
 const local=Object.hasOwn(d.config.features.users??{},r.username)?d.config.features.users[r.username]:undefined,expected=local?.secret??local?.password,auth=authenticate?.(r.username,r.password)??{accepted:typeof expected==='string'&&expected.length>0&&expected===r.password,privilege:local?.privilege??1};
 if(!auth.accepted)return failure('Authentication failed');if(!host&&(auth.privilege??1)<15)return failure('SCP requires privilege level 15');
 const name=String(r.path??'').replace(/^\/+|^flash:/g,'');if(!name||name.length>200||name.split('/').some(p=>p==='..'||p==='.')||/[\x00-\x1f\\]/.test(name))return failure('Invalid simulated file path');
 let content:string|undefined;if(r.operation==='read'){const files=host?service.files:d.config.features.files;content=!host&&name==='running-config'?renderConfig(d).join('\n'):!host&&name==='startup-config'?d.startupConfig?renderConfig(d,d.startupConfig).join('\n'):undefined:files&&Object.hasOwn(files,name)?files[name]:undefined;}
 else{if(service.readOnly)return failure('File service is read-only');content=r.content;if(typeof content!=='string'||new TextEncoder().encode(content).length>1048576)return failure('File must contain at most 1 MiB of text');if(host)d.config.services.sshFiles.files={...(service.files??{}),[name]:content};else{try{writeFlashFile(d,name,content);}catch(error){return failure(String(error));}}engine.notify();}
 if(typeof content!=='string')return failure('File not found');const bytes=new TextEncoder().encode(content).length;
 const transfers=d.runtime.features.sshFileTransfers??=[];transfers.push({time:engine.clock.now(),source,protocol:r.protocol,operation:r.operation,path:name,bytes,username:r.username,transferId:r.transferId});if(transfers.length>500)transfers.shift();
 engine.emit({nodeId:d.id,protocol:r.protocol.toUpperCase(),label:r.operation==='read'?'File read':'File written',detail:name+' · '+bytes+' bytes',disposition:'success'});
 return {protocol:r.protocol,bytes,transferId:r.transferId,...r.operation==='read'?{content}:{}};
}
export function installSSHFileService(engine:Simulator):void{engine.registerTCPService(22,sshFileEnabled,(d,payload,source,destination)=>payload?.application==='ssh-file'?handleSSHFile(engine,d,payload,source,destination):{error:'This listener provides the modeled SSH file service only'});}
let transferSequence=0;
export function transferSSHFile(engine:Simulator,sourceId:string,address:string,request:Omit<SSHFileRequest,'application'>):ServiceResult{return engine.tcpRequest(sourceId,address,22,{...request,application:'ssh-file',transferId:'ssh-file-'+(++transferSequence)},{source:engine.getDevice(sourceId)?.config.features.ssh?.sourceInterface});}
/** Record only after the client has received success and committed its local file. No credentials or contents. */
export function recordSSHFileCopy(engine:Simulator,sourceId:string,address:string,request:{protocol:'scp'|'sftp';operation:'read'|'write';username:string;path:string;localPath:string},result:ServiceResult):void{
 if(result.status!=='success'||typeof result.transferId!=='string')return;
 const d=engine.getDevice(sourceId);if(!d)return;
 const copies=d.runtime.features.sshFileCopies??=[];copies.push({...request,path:request.path.replace(/^\/+|^flash:/g,''),address,transferId:result.transferId,bytes:result.bytes,time:engine.clock.now()});if(copies.length>500)copies.shift();
}
