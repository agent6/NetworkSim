import type {Simulator,ServiceOptions,ServiceResult} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import type {TCPChannel} from './tcp-channel.ts';
import type {TimerHandle} from './clock.ts';
import {isIPv4,sameAddress} from './ip.ts';
import {ownRecordValue,setRecordValue} from './record-map.ts';

/** RFC 959 control replies and independent passive data TCP streams; no wire FTP binary codec or TLS. */
export interface FTPFileRequest {username:string;password:string;operation:'read'|'write';path:string;content?:string}
const MAX_BYTES=1048576,PASSIVE_FIRST=50000,PASSIVE_COUNT=32,SESSION_TIMEOUT=60000;
const utf8=(value:string)=>new TextEncoder().encode(value).length;
function validPath(path:unknown):path is string {return typeof path==='string'&&path.length>0&&path.length<=200&&!/[\x00-\x1f\x7f\\]/.test(path)&&!path.split('/').some(v=>v==='.'||v==='..')&&!path.startsWith('/');}
function record(value:unknown):value is Record<string,any>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function validateFTPConfiguration(config:DeviceConfig|any):void {
 const service=config.services?.ftp,client=config.features?.ftpClient;
 if(service!==undefined){if(!record(service)||typeof service.enabled!=='boolean'||!record(service.users)||!record(service.files)||service.readOnly!==undefined&&typeof service.readOnly!=='boolean')throw Error('Invalid FTP server configuration');
  if(Object.keys(service.users).length>64||Object.keys(service.files).length>256)throw Error('FTP server account or file capacity exceeded');
  for(const[name,user]of Object.entries(service.users)){if(!name||name.length>64||/[\s\x00-\x1f\x7f]/.test(name)||!record(user)||typeof user.password!=='string'||!user.password||user.password.length>256||/[\r\n\x00]/.test(user.password)||user.readOnly!==undefined&&typeof user.readOnly!=='boolean')throw Error('Invalid FTP account');}
  for(const[path,content]of Object.entries(service.files))if(!validPath(path)||typeof content!=='string'||utf8(content)>MAX_BYTES)throw Error('FTP files must have valid relative paths and at most 1 MiB of UTF-8 text');
 }
 if(client!==undefined){if(!record(client)||Object.keys(client).some(k=>!['username','password','passwordType','sourceInterface','passive'].includes(k))||client.username!==undefined&&(typeof client.username!=='string'||!client.username||client.username.length>64||/[\s\x00-\x1f\x7f]/.test(client.username))||client.password!==undefined&&(typeof client.password!=='string'||client.password.length>256||/[\r\n\x00]/.test(client.password))||client.passwordType!==undefined&&![0,7].includes(client.passwordType)||client.sourceInterface!==undefined&&(typeof client.sourceInterface!=='string'||!Object.hasOwn(config.interfaces??{},client.sourceInterface))||client.passive!==undefined&&typeof client.passive!=='boolean')throw Error('Invalid FTP client configuration');}
}
interface Session {control:TCPChannel;device:Device;runtime:Device['runtime'];username?:string;password?:string;authenticated:boolean;binary:boolean;port?:number;data?:TCPChannel;operation?:'read'|'write';path?:string;content:string;bytes:number;started:boolean;finished:boolean;timer?:TimerHandle}
interface State {sessions:Set<Session>;slots:Map<string,Session>;sequence:number}
const states=new WeakMap<Simulator,State>();
function enabled(d:Device):boolean{return d.kind==='server'&&d.powered&&d.config.services.ftp?.enabled===true;}
function current(engine:Simulator,s:Session):boolean{return engine.getDevice(s.device.id)===s.device&&s.device.runtime===s.runtime&&enabled(s.device);}
function credentialCurrent(s:Session):boolean {const user=ownRecordValue(s.device.config.services.ftp?.users,s.username);return !!s.authenticated&&typeof user?.password==='string'&&user.password===s.password;}
function stream(channel:TCPChannel,content:string):void {let chunk='',bytes=0;for(const character of content){const length=utf8(character);if(bytes+length>16384&&chunk){channel.send(chunk);chunk='';bytes=0;}chunk+=character;bytes+=length;}if(chunk)channel.send(chunk);channel.close('FTP data completed');}
export function installFTPServices(engine:Simulator):void {
 if(states.has(engine))return;const state:State={sessions:new Set(),slots:new Map(),sequence:0};states.set(engine,state);
 const key=(device:string,port:number)=>device+'|'+port;
 const release=(s:Session)=>{if(s.port!==undefined){state.slots.delete(key(s.device.id,s.port));delete s.port;}};
 const end=(s:Session,reason='FTP control closed')=>{if(s.finished)return;s.finished=true;engine.clock.cancel(s.timer);release(s);state.sessions.delete(s);s.data?.close(reason);s.control.close(reason);};
 const reply=(s:Session,code:number,text:string)=>{if(s.control.state==='OPEN')s.control.send(code+' '+text+'\r\n');};
 const failData=(s:Session,text:string)=>{reply(s,426,text);release(s);s.data?.close('FTP data failed');delete s.data;delete s.operation;s.started=false;s.content='';s.bytes=0;};
 const complete=(s:Session)=>{
  if(!current(engine,s)||!credentialCurrent(s)){end(s,'FTP server or account changed');return;}
  if(s.operation==='write'){const service=s.device.config.services.ftp,user=ownRecordValue(service.users,s.username);if(service.readOnly||user?.readOnly){failData(s,'Write permission changed');return;}if(!Object.hasOwn(service.files,s.path!)&&Object.keys(service.files).length>=256){failData(s,'File capacity exceeded');return;}setRecordValue(service.files,s.path!,s.content);}
  const transfers=s.device.runtime.features.ftpTransfers??=[];transfers.push({time:engine.clock.now(),source:s.control.peerAddress,username:s.username,operation:s.operation,path:s.path,bytes:s.bytes});if(transfers.length>256)transfers.shift();
  engine.emit({nodeId:s.device.id,protocol:'FTP',label:s.operation==='read'?'File read':'File written',detail:s.path+' · '+s.bytes+' bytes',disposition:'success'});reply(s,226,'Transfer complete');release(s);delete s.data;delete s.operation;s.started=false;s.content='';s.bytes=0;engine.notify();
 };
 for(let port=PASSIVE_FIRST;port<PASSIVE_FIRST+PASSIVE_COUNT;port++)engine.registerTCPChannelService(port,(d,peer,local,vrf)=>{const s=state.slots.get(key(d.id,port));return !!s&&!s.data&&current(engine,s)&&credentialCurrent(s)&&sameAddress(s.control.peerAddress,peer)&&sameAddress(s.control.localAddress,local)&&(s.control.vrf??'')===(vrf??'');},channel=>{
  const s=state.slots.get(key(channel.deviceId,channel.localPort));if(!s||s.data){channel.close('No reserved passive transfer');return;}s.data=channel;
  channel.setHandlers({onMessage:payload=>{if(!current(engine,s)||!credentialCurrent(s)){end(s,'FTP server or account changed');return;}if(!s.started||s.operation!=='write'||typeof payload!=='string'||s.bytes+utf8(payload)>MAX_BYTES){failData(s,'Invalid or oversized data stream');return;}s.content+=payload;s.bytes+=utf8(payload);},onClose:reason=>{
   if(s.finished||s.data!==channel)return;if(s.started&&(reason==='Peer closed the connection'&&s.operation==='write'||reason==='FTP data completed'&&s.operation==='read'))complete(s);else failData(s,'Data connection closed before transfer completed');
  }});
 });
 engine.registerTCPChannelService(21,d=>enabled(d)&&[...state.sessions].filter(s=>s.device===d).length<32,control=>{
  const device=engine.getDevice(control.deviceId)!;const s:Session={control,device,runtime:device.runtime,authenticated:false,binary:false,content:'',bytes:0,started:false,finished:false};state.sessions.add(s);
  s.timer=engine.clock.schedule(SESSION_TIMEOUT,()=>{reply(s,421,'Session timed out');end(s,'FTP session timed out');},{owner:device.id,label:'FTP control session timeout'});
  control.setHandlers({onMessage:payload=>{
   if(!current(engine,s)){end(s,'FTP server unavailable');return;}if(typeof payload!=='string'||payload.length>1024||!payload.endsWith('\r\n')||/[\r\n]/.test(payload.slice(0,-2))){reply(s,500,'Malformed command');return;}
   const line=payload.slice(0,-2),space=line.indexOf(' '),command=(space<0?line:line.slice(0,space)).toUpperCase(),arg=space<0?'':line.slice(space+1);
   if(command==='QUIT'){reply(s,221,'Goodbye');end(s);return;}
   if(s.started){reply(s,450,'Transfer already in progress');return;}
   if(command==='USER'){release(s);s.data?.close('FTP user changed');delete s.data;s.username=arg;delete s.password;s.authenticated=false;s.binary=false;reply(s,331,'Password required');return;}
   if(command==='PASS'){const user=ownRecordValue(device.config.services.ftp.users,s.username);s.authenticated=typeof user?.password==='string'&&user.password.length>0&&user.password===arg;s.password=s.authenticated?arg:undefined;reply(s,s.authenticated?230:530,s.authenticated?'User logged in':'Authentication failed');return;}
   if(!credentialCurrent(s)){reply(s,530,'Not logged in');return;}
   if(command==='TYPE'){if(arg.toUpperCase()!=='I'){reply(s,504,'Only TYPE I is modeled');return;}s.binary=true;reply(s,200,'Type set to I');return;}
   if(command==='PASV'){
    release(s);s.data?.close('Passive reservation replaced');delete s.data;
    const port=Array.from({length:PASSIVE_COUNT},(_,n)=>PASSIVE_FIRST+n).find(p=>!state.slots.has(key(device.id,p)));
    if(port===undefined){reply(s,425,'No passive data ports available');return;}s.port=port;state.slots.set(key(device.id,port),s);reply(s,227,'Entering Passive Mode ('+control.localAddress.replaceAll('.',',')+','+(port>>8)+','+(port&255)+')');return;
   }
   if(command!=='RETR'&&command!=='STOR'){reply(s,502,'Command not implemented in this simulator');return;}
   if(!s.binary){reply(s,503,'Set TYPE I before transferring');return;}if(!validPath(arg)){reply(s,550,'Invalid file path');return;}if(!s.data||s.data.state!=='OPEN'){reply(s,425,'Open a passive data connection first');return;}
   const service=device.config.services.ftp,user=ownRecordValue(service.users,s.username);if(command==='STOR'&&(service.readOnly||user?.readOnly)){reply(s,550,'Write permission denied');return;}
   const content=command==='RETR'?ownRecordValue(service.files,arg):'';if(typeof content!=='string'){reply(s,550,'File not found');return;}if(utf8(content)>MAX_BYTES){reply(s,552,'File exceeds simulator limit');return;}
   s.operation=command==='RETR'?'read':'write';s.path=arg;s.content=s.operation==='read'?content:'';s.bytes=s.operation==='read'?utf8(content):0;s.started=true;reply(s,150,'Opening binary mode data connection');if(s.operation==='read')stream(s.data,content);
  },onClose:reason=>end(s,reason)});reply(s,220,'NetworkSim FTP service ready');
 });
 engine.subscribe(()=>{for(const s of state.sessions)if(!current(engine,s)||s.authenticated&&!credentialCurrent(s))end(s,'FTP server or account changed');});
}
export function transferFTPFile(engine:Simulator,sourceId:string,address:string,request:FTPFileRequest,transport:ServiceOptions={}):ServiceResult {
 installFTPServices(engine);const state=states.get(engine)!;const result:ServiceResult={id:'ftp-'+(++state.sequence),status:'running',protocol:'ftp',path:request.path,direction:request.operation,bytes:0};
 const failure=(error:string)=>{result.status='failure';result.error=error;return result;};
 if(!isIPv4(address))return failure('This FTP client requires a resolved IPv4 address');if(!validPath(request.path))return failure('Invalid FTP file path');if(!['read','write'].includes(request.operation)||typeof request.username!=='string'||!request.username||request.username.length>64||/[\s\x00-\x1f\x7f]/.test(request.username)||typeof request.password!=='string'||request.password.length>256||/[\r\n\x00]/.test(request.password))return failure('Invalid FTP request credentials or operation');
 if(request.operation==='write'&&(typeof request.content!=='string'||utf8(request.content)>MAX_BYTES))return failure('FTP files must contain at most 1 MiB of UTF-8 text');if(transport.sourcePort!==undefined)return failure('Fixed FTP client source ports are unsupported');
 const timeout=transport.timeout??30000;if(!Number.isFinite(timeout)||timeout<1||timeout>600000)return failure('Invalid FTP transaction timeout');
 let control:TCPChannel|undefined,data:TCPChannel|undefined,timer:TimerHandle|undefined,step='greeting',content='',dataDone=false,controlDone=false;
 const stop=(error?:string)=>{if(result.status!=='running')return;engine.clock.cancel(timer);if(error)failure(error);else{result.status='success';result.bytes=request.operation==='read'?utf8(content):utf8(request.content!);if(request.operation==='read')result.content=content;}control?.close(error?'FTP transfer failed':'FTP client finished');data?.close(error?'FTP transfer failed':'FTP data completed');engine.notify();};
 const finish=()=>{if(dataDone&&controlDone)stop();};
 const command=(line:string)=>control?.send(line+'\r\n');
 try{control=engine.connectTCPChannel(sourceId,address,21,{source:transport.source,vrf:transport.vrf,onMessage:payload=>{
  if(result.status!=='running')return;if(typeof payload!=='string'||!/^\d{3} [^\r\n]*\r\n$/.test(payload)){stop('Malformed FTP reply');return;}const code=Number(payload.slice(0,3));if(code>=400){stop('FTP '+payload.trim());return;}
  if(step==='greeting'&&code===220){step='user';command('USER '+request.username);}else if(step==='user'&&code===331){step='pass';command('PASS '+request.password);}else if(step==='pass'&&code===230||step==='user'&&code===230){step='type';command('TYPE I');}else if(step==='type'&&code===200){step='pasv';command('PASV');}else if(step==='pasv'&&code===227){
   const parts=/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(payload)?.slice(1).map(Number);if(!parts||parts.some(v=>v>255)||parts.slice(0,4).join('.')!==address){stop('Unsafe or malformed passive FTP endpoint');return;}const port=parts[4]*256+parts[5];if(port<PASSIVE_FIRST||port>=PASSIVE_FIRST+PASSIVE_COUNT){stop('Passive FTP port outside the modeled range');return;}step='data-connect';
   data=engine.connectTCPChannel(sourceId,address,port,{source:transport.source,vrf:transport.vrf,onOpen:()=>{step='transfer';command((request.operation==='read'?'RETR ':'STOR ')+request.path);},onMessage:part=>{if(request.operation!=='read'||typeof part!=='string'||utf8(content)+utf8(part)>MAX_BYTES){stop('Invalid or oversized FTP data stream');return;}content+=part;},onClose:reason=>{if(result.status!=='running')return;if(reason!==(request.operation==='read'?'Peer closed the connection':'FTP data completed')){stop('FTP data connection failed: '+reason);return;}dataDone=true;finish();}});
  }else if(step==='transfer'&&code===150){step='transferring';if(request.operation==='write')stream(data!,request.content!);}else if((step==='transfer'||step==='transferring')&&code===226){controlDone=true;finish();}else stop('Unexpected FTP reply '+code+' during '+step);
 },onClose:reason=>{if(result.status==='running')stop('FTP control connection failed: '+reason);}});}catch(error){stop(error instanceof Error?error.message:String(error));}
 if(result.status==='running')timer=engine.clock.schedule(timeout,()=>stop('FTP transaction timed out'),{label:'FTP client transaction timeout'});return result;
}
