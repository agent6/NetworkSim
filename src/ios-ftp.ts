import type {Simulator,ServiceOptions} from './engine.ts';
import type {Device} from './model.ts';
import {encodeType7,decodeType7} from './credentials.ts';
import {transferFTPFile} from './ftp-files.ts';
import {iosRejected} from './ios-help.ts';

export interface FTPClientConfiguration {username?:string;password?:string;passwordType?:0|7;sourceInterface?:string;passive?:boolean}
type ConfigurationContext={device:Device;fail:(message?:string)=>never;interfaceName:(name:string)=>string;changed:()=>void};
/** Native configuration syntax; the simulated transport currently negotiates passive IPv4 FTP. */
export function configureFTPClient(c:ConfigurationContext,key:'username'|'password'|'source-interface'|'passive',args:string[],no:boolean):string[]{
  const reject=()=>c.fail("% Invalid input detected at '^' marker.");
  if(no){if(args.length)reject();const config=c.device.config.features.ftpClient as FTPClientConfiguration|undefined;if(config){if(key==='password'){delete config.password;delete config.passwordType;}else delete config[key==='source-interface'?'sourceInterface':key];if(!Object.keys(config).length)delete c.device.config.features.ftpClient;}c.changed();return [];}
  let value:string|undefined,type:0|7=0;
  if(key==='passive'){if(args.length)reject();}
  else if(key==='password'){
    if(!args.length)c.fail('% Incomplete command.');
    if(args.length>2)reject();
    if(args.length===2){if(!['0','7'].includes(args[0]))reject();type=Number(args[0]) as 0|7;}
    value=args.at(-1)!;
    if(type===7){try{value=decodeType7(value);}catch{c.fail('% Invalid Type 7 FTP password.');}}
    if(!value||value.length>256||/[\u0000-\u001f\u007f]/.test(value))c.fail('% FTP password must contain 1 to 256 printable characters.');
  }else{
    if(!args.length)c.fail('% Incomplete command.');
    if(key==='source-interface')value=c.interfaceName(args.join(''));
    else {if(args.length!==1)reject();value=args[0];if(!value||value.length>64||/[\s\u0000-\u001f\u007f]/.test(value))c.fail('% Invalid FTP username.');}
  }
  const config:FTPClientConfiguration=c.device.config.features.ftpClient??={};
  if(key==='passive')config.passive=true;
  else if(key==='password'){config.password=value;config.passwordType=c.device.config.features.passwordEncryption?7:type;}
  else if(key==='username')config.username=value;
  else config.sourceInterface=value;
  c.changed();return [];
}
export function renderFTPClient(features:Record<string,any>):string[]{
  const c=features.ftpClient as FTPClientConfiguration|undefined;if(!c)return [];
  const password=c.password,needsQuotes=password!==undefined&&(/\s/.test(password)||/^["']/.test(password)),quoted=password===undefined?'':needsQuotes?password.includes('"')?"'"+password+"'":'"'+password+'"':password;
  // Quoting cannot represent both quote kinds plus whitespace in the shared IOS lexer.
  // Type 7 provides a native, reversible single-token representation for that imported case.
  const encoded=c.passwordType===7||features.passwordEncryption||password!==undefined&&needsQuotes&&password.includes('"')&&password.includes("'");
  return [...c.username!==undefined?['ip ftp username '+c.username]:[],...password!==undefined?['ip ftp password '+(encoded?'7 '+encodeType7(password):'0 '+quoted)]:[],...c.sourceInterface?['ip ftp source-interface '+c.sourceInterface]:[],...c.passive?['ip ftp passive']:[]];
}
interface CopyContext {localName:(name:string)=>string;readFile:(name:string)=>string;applyText:(text:string,target:string)=>string[];resolveTarget:(name:string)=>string;username:()=>string|undefined}
interface Request {source:string;destination:string;reading:boolean;url?:URL;stage:'address'|'filename'|'confirm';host?:string;path?:string}
/** Prompts are ordinary IOS copy prompts, not a shell or host FTP process. */
export class IOSFTPClient {
  private request?:Request;
  private engine:Simulator;private deviceId:string;private context:CopyContext;
  constructor(engine:Simulator,deviceId:string,context:CopyContext){this.engine=engine;this.deviceId=deviceId;this.context=context;}
  get pending():boolean{return !!this.request;}
  get prompt():string|undefined{const r=this.request;if(!r)return;if(r.stage==='address')return 'Address or name of remote host []?';if(r.stage==='filename')return `${r.reading?'Source':'Destination'} filename [${this.defaultPath()}]?`;return `Write file ${r.path} on host ${r.host}? [confirm]`;}
  cancel():void{this.request=undefined;}
  start(source:string,destination:string):string[]{
    const remote=[source,destination].filter(value=>/^ftp:/i.test(value));if(remote.length!==1)throw Error('% Select one local and one FTP file.');
    const reading=source===remote[0],r:Request={source:reading?source:this.context.localName(source),destination:reading?this.context.localName(destination):destination,reading,stage:'address'};
    if(remote[0].toLowerCase()!=='ftp:'){
      let url:URL;try{url=new URL(remote[0]);}catch{throw Error('% Invalid FTP URL.');}
      if(url.protocol!=='ftp:'||!url.hostname||url.pathname==='/'||url.port&&url.port!=='21'||url.search||url.hash)throw Error('% Use ftp://[username[:password]@]host/path. Only port 21 is supported.');
      // Reject malformed escapes before opening any connection.
      try{decodeURIComponent(url.username);decodeURIComponent(url.password);r.path=decodeURIComponent(url.pathname).replace(/^\//,'');}catch{throw Error('% Invalid escape sequence in FTP URL.');}
      if(!r.path||r.path.split('/').includes('..')||/[\\\u0000-\u001f\u007f]/.test(r.path))throw Error('% Invalid FTP path.');
      r.url=url;r.host=url.hostname.replace(/^\[|\]$/g,'');
      if(reading)return this.run(r);
      // Read before asking for confirmation so missing local files cannot prompt a doomed transfer.
      this.context.readFile(r.source);r.stage='confirm';
    }
    this.request=r;return [];
  }
  continue(value:string):string[]{
    const r=this.request!;
    try{
      if(r.stage==='address'){if(!value)throw Error('% A remote host is required.');if(/[\s/@?#]/.test(value))throw Error('% Invalid remote host.');r.host=value;r.stage='filename';return [];}
      if(r.stage==='filename'){r.path=value||this.defaultPath();if(!r.path||r.path.split('/').includes('..')||/[\\\u0000-\u001f\u007f]/.test(r.path))throw Error('% Invalid FTP path.');if(!r.reading){this.context.readFile(r.source);r.stage='confirm';return [];}this.request=undefined;return this.run(r);}
      this.request=undefined;if(value&&!['y','yes'].includes(value.toLowerCase()))return ['% Copy aborted.'];return this.run(r);
    }catch(error){this.request=undefined;return [this.error(error)];}
  }
  private defaultPath():string{return this.engine.getDevice(this.deviceId)!.config.hostname.toLowerCase()+'-confg';}
  private error(error:unknown):string{const message=error instanceof Error?error.message:String(error);return message.startsWith('%')?message:'% FTP copy failed: '+message;}
  private run(r:Request):string[]{
    try{
      const device=this.engine.getDevice(this.deviceId)!,config=device.config.features.ftpClient as FTPClientConfiguration|undefined,address=this.context.resolveTarget(r.host!);
      if(address.includes(':'))return ['% FTP over IPv6 is not implemented in this simulator profile.'];
      const username=r.url?.username?decodeURIComponent(r.url.username):config?.username??'anonymous';
      const password=r.url?.password?decodeURIComponent(r.url.password):config?.password??`${this.context.username()??'anonymous'}@${device.config.hostname}.${device.config.features.domainName??''}`;
      const transport:ServiceOptions={timeout:30000};
      const p=config?.sourceInterface?device.config.interfaces[config.sourceInterface]:undefined;
      if(p&&p.ip&&this.engine.interfaceUp(device.id,p.name)){transport.source=p.ip;if(p.vrf)transport.vrf=p.vrf;}
      const started=this.engine.clock.now(),result=transferFTPFile(this.engine,this.deviceId,address,{username,password,operation:r.reading?'read':'write',path:r.path!,...r.reading?{}:{content:this.context.readFile(r.source)}},transport);
      for(let n=0;result.status==='running'&&n<310;n++)this.engine.advance(100);
      if(result.status!=='success')return [`%Error opening ftp://${r.host}/${r.path} (${result.error??'Transfer timed out'})`];
      const applied=r.reading?this.context.applyText(result.content,r.destination):[];
      if(applied.some(iosRejected))return applied;
      this.engine.changed();
      return [...r.reading?[`Loading ${r.path} from ${r.host}: !`]:['Writing '+r.path+': !'],`[OK - ${result.bytes} bytes]`,...applied.filter(line=>!/^\d+ bytes copied\b/.test(line)),'',`${result.bytes} bytes copied in ${(Math.max(1,this.engine.clock.now()-started)/1000).toFixed(3)} secs (${Math.floor(result.bytes*1000/Math.max(1,this.engine.clock.now()-started))} bytes/sec)`];
    }catch(error){return [this.error(error)];}
  }
}
