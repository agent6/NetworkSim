import {recordDeviceAccess} from './device-access.ts';
import {nsosReservedUser} from './nsos-aaa.ts';
import {aaaServers,aaaExchange,type AAAAuthentication} from './aaa-client.ts';
import {ownRecordValue,accountCredential} from './record-map.ts';
import{handleAAARequest}from'./aaa-service.ts';
import {AAAAccountingClient,type AccountingContext} from './aaa-accounting.ts';
import type {TimerHandle} from './clock.ts';
import {handleSSHFile,sshFileEnabled} from './ssh-files.ts';
import { isIPv6 } from './ip.ts';
import { loginBlocked, recordLoginFailure } from './ios-platform-compat.ts';
import { writeFlashFile } from './filesystem.ts';
import { renderConfig } from './config-renderer.ts';
import { iosRejected } from './ios-help.ts';
import type { Device } from './model.ts';
import type { Simulator, ServiceResult } from './engine.ts';
import {createCLISession} from './session.ts';
import {nsosFeature} from './datacenter.ts';

export interface ManagedCLI {
  readonly prompt: string;
  readonly mode: string;
  readonly passwordInput: boolean;
  readonly pageLength:number;
  readonly pageWidth?:number;
  readonly editing?:boolean;
  readonly commandHistory?:string[];
  readonly commandTimestamp?:string;
  readonly remoteConnected?:boolean;
  setViewportColumns?(columns:number):void;
  complete(line:string):string;
  cancel():string[];
  pollOutput():string[];
  execute(line: string): string[];
  setPrivilege(level: number): void;
  setAccessContext?(session:string,source:string,port:number):void;
  setIdentity(username:string|undefined,authenticated:boolean,line:string,role?:string):void;
  setAccountingHook?(hook:(command:string,level:number,status:'start'|'stop',taskId:string)=>void):void;
}
type Factory = (deviceId: string) => ManagedCLI;
interface RemoteSession {
  id: string;
  deviceId: string;
  source: string;
  port: number;
  line: string;
  cli: ManagedCLI;
  method: 'local' | 'password' | 'none' | 'aaa';
  phase: 'username' | 'password' | 'ready';
  username?: string;
  attempts: number;
  expires: number;
  lastActivity:number;
  lineNumber:number;
  authDeadline?:number;
  accounting?:AccountingContext;
  expiryTimer?:TimerHandle;
}
const controllers = new WeakMap<Simulator, ManagementController>();
export interface LocalSSHLogin {username:string;source:string;privilege:number;line:string;time:number}

/** Accepted local SSH logins, without credentials; closing the connection retains evidence. */
export function localSSHLoginSnapshot(engine:Simulator,deviceId:string):LocalSSHLogin[]{
  return controllers.get(engine)?.localSSHLoginSnapshot(deviceId)??[];
}

/** Read-only management telemetry. Looking at a session never extends or closes it. */
export function managementSessionSnapshot(engine:Simulator,deviceId:string):{id:string;source:string;port:number;line:string;phase:string;username?:string;expires:number;lastActivity:number;lineNumber:number}[]{
  return controllers.get(engine)?.sessionSnapshot(deviceId)??[];
}

export function managementFor(engine: Simulator, factory: Factory): ManagementController {
  let value = controllers.get(engine);
  if (!value) { value = new ManagementController(engine, factory); controllers.set(engine, value); }
  return value;
}

/** Simulated management services. Every remote operation crosses the packet engine. */
export class ManagementController {
  private sessions = new Map<string, RemoteSession>();
  private localSSHLogins: (LocalSSHLogin & {deviceId:string;runtime:Device['runtime']})[] = [];
  private sequence = 0;
  readonly engine: Simulator;
  private readonly factory: Factory;
  private accounting:AAAAccountingClient;
  private automationRuns = new Map<string, number>();
  private clientVRFs=new Map<string,string>();
  localSSHLoginSnapshot(deviceId:string):LocalSSHLogin[]{
    const runtime=this.engine.getDevice(deviceId)?.runtime;
    return this.localSSHLogins.filter(row=>row.deviceId===deviceId&&row.runtime===runtime).map(({username,source,privilege,line,time})=>({username,source,privilege,line,time}));
  }
  sessionSnapshot(deviceId:string):{id:string;source:string;port:number;line:string;phase:string;username?:string;expires:number;lastActivity:number;lineNumber:number}[]{
    return [...this.sessions.values()].filter(s=>s.deviceId===deviceId&&this.alive(s)).map(({id,source,port,line,phase,username,expires,lastActivity,lineNumber})=>({id,source,port,line,phase,username,expires,lastActivity,lineNumber}));
  }
  sessionIdFor(cli:ManagedCLI):string|undefined{return [...this.sessions.values()].find(s=>s.cli===cli&&this.alive(s))?.id;}
  accountingSnapshot(deviceId:string):AccountingContext[]{return [...this.sessions.values()].filter(s=>s.deviceId===deviceId&&this.alive(s)&&!!s.accounting).map(s=>({...s.accounting!}));}
  constructor(engine: Simulator, factory: Factory) {
    this.engine = engine; this.factory = id=>engine.getDevice(id)?.kind==='datacenter'?createCLISession(engine,id,{skipConsoleLogin:true}):factory(id); this.accounting=new AAAAccountingClient(engine);
    engine.subscribe(()=>this.syncAutomation());
    engine.registerHTTPAuthenticator((deviceId,list,user,password)=>this.authenticate(deviceId,list,user,password));
    engine.registerUDPService(1812,d=>!!d.config.services.radius?.enabled,(d,payload,source)=>this.aaaRequest(d,'radius',payload,source));
    engine.registerTCPService(49,d=>!!d.config.services.tacacs?.enabled,(d,payload,source)=>this.aaaRequest(d,'tacacs',payload,source)??{error:'TACACS+ response unavailable'});
    for (const port of [22, 23]) engine.registerTCPService(port, d => this.accepts(d, port), (d, payload, source, destination) => this.handle(d, port, payload, source, destination));
  }
  private aaaRequest(device:Device,protocol:string,payload:any,source:string):Record<string,any>|undefined{
    return handleAAARequest(this.engine,device,protocol,payload,source);
  }
  authenticate(deviceId:string,listName:string,username:string,password:string,purpose:'login'|'enable'='login',lineName?:string):AAAAuthentication{
    const device=this.engine.getDevice(deviceId);if(!device)return {accepted:false};
    const aaa=device.config.features.aaa||{},methods=(purpose==='enable'?aaa.enable?.[listName]:aaa.login?.[listName])||[purpose==='enable'?'enable':'local'];
    return this.authenticateMethods(device,methods,username,password,lineName);
  }
  testAuthentication(deviceId:string,group:string,username:string,password:string):AAAAuthentication{
    const device=this.engine.getDevice(deviceId);if(!device)return {accepted:false};
    return this.authenticateMethods(device,['group',group],username,password);
  }
  private authenticateMethods(device:Device,methods:string[],username:string,password:string,lineName?:string):AAAAuthentication{
    const deviceId=device.id,aaa=device.config.features.aaa||{},errors:string[]=[];
    for(let i=0;i<methods.length;i++){
      const method=methods[i];if(method==='none')return {accepted:true,privilege:1};
      if(method==='enable'){const expected=device.config.features.enableSecret??device.config.features.enablePassword;return {accepted:typeof expected==='string'&&expected.length>0&&expected===password,privilege:15};}
      if(method==='line'){const expected=lineName?device.config.features.lines?.[lineName]?.password:undefined;return {accepted:typeof expected==='string'&&expected.length>0&&expected===password,privilege:1};}
      if(method==='local'){const user=ownRecordValue(device.config.features.users,username),expected=accountCredential(user);return {accepted:expected!==undefined&&typeof password==='string'&&expected===password,privilege:user?.privilege??1,role:user?.role,errors};}
      if(method!=='group')continue;
      for(const server of aaaServers(device,methods[++i])){
        const result=aaaExchange(this.engine,device,server,{username,password});
        if(!result){errors.push(server.name!);continue;}
        if(device.kind==='datacenter'&&nsosReservedUser(username))return {accepted:false};
        if(device.kind==='datacenter'&&server.protocol==='tacacs'&&result.accepted){
          const author=aaaExchange(this.engine,device,server,{operation:'authorize',kind:'exec',username});
          return {accepted:true,privilege:author?.accepted?author.privilege??1:1,role:author?.accepted?author.role??'network-operator':'network-operator'};
        }
        return {accepted:!!result.accepted,privilege:result.privilege??1,role:result.role,...server.protocol==='radius'&&result.accepted?{radius:{server:server.name!,authorized:result.execAuthorized!==false,privilege:result.privilege??1}}:{}};
      }
    }
    return {accepted:false,unavailable:true};
  }
  authorize(deviceId:string,kind:'exec'|'commands',listName:string,username:string|undefined,authenticated:boolean,requiredPrivilege=15,radius?:AAAAuthentication['radius'],errors:string[]=[]):{accepted:boolean;privilege?:number;unavailable?:boolean;configured?:boolean}{
    const device=this.engine.getDevice(deviceId);if(!device)return {accepted:false};const aaa=device.config.features.aaa||{},methods=aaa.enabled?aaa.authorization?.[kind==='commands'?'commands'+requiredPrivilege:'exec']?.[listName]:undefined;if(!methods)return {accepted:true,configured:false};
    for(let i=0;i<methods.length;i++){
      const method=methods[i];if(method==='none'||method==='if-authenticated'&&authenticated)return {accepted:true,configured:true};if(method==='if-authenticated')return {accepted:false,configured:true};
      if(method==='local'){const user=ownRecordValue(device.config.features.users,username),expected=accountCredential(user);return {accepted:expected!==undefined&&(kind==='exec'||(user.privilege??1)>=requiredPrivilege),privilege:user?.privilege??1,configured:true};}
      if(method!=='group')continue;
      for(const server of aaaServers(device,methods[++i])){if(server.protocol==='radius'){if(errors.includes(server.name!))continue;return {accepted:kind==='exec'&&radius?.server===server.name&&radius?.authorized===true,privilege:radius?.privilege,configured:true};}const result=aaaExchange(this.engine,device,server,{operation:'authorize',kind,requiredPrivilege,username});if(result)return {accepted:!!result.accepted,privilege:result.privilege,configured:true};}
    }
    return {accepted:false,configured:true,unavailable:true};
  }
  execPrivilege(deviceId:string,lineName:string,username:string|undefined,authenticated:boolean,loginPrivilege:number,authentication?:AAAAuthentication):{accepted:boolean;privilege:number}{const d=this.engine.getDevice(deviceId)!,f=d.config.features,line=f.lines?.[lineName]||{};if(!f.aaa?.enabled)return {accepted:true,privilege:loginPrivilege};if(d.kind==='datacenter')return {accepted:true,privilege:loginPrivilege};const base=line.privilege??1;if(lineName.startsWith('console')&&!f.aaa.authorizeConsole)return {accepted:true,privilege:base};const result=this.authorize(deviceId,'exec',line.authorizationExec||'default',username,authenticated,15,authentication?.radius,authentication?.errors);return {accepted:result.accepted,privilege:result.privilege??base};}
  private wait(result:ServiceResult,timeout=10000):void{const deadline=this.engine.clock.now()+timeout,step=Math.max(20,Math.ceil(timeout/2000));let count=0;while(result.status==='running'&&this.engine.clock.now()<deadline&&count++<2001)this.engine.clock.advance(Math.min(step,deadline-this.engine.clock.now()));}
  private syncAutomation():void {
    for(const device of this.engine.lab.devices){
      if(!device.powered)continue;
      const f=device.config.features,signature=JSON.stringify([f.eem,f.archive]);
      if(device.runtime.features.automationSignature===signature)continue;
      device.runtime.features.automationSignature=signature;
      const owner=`management-${device.id}`;this.engine.clock.cancelOwner(owner);
      for(const [name,applet]of Object.entries<any>(f.eem||{}))if(applet.event?.type==='timer'){
        const delay=applet.event.seconds*1000;if(!Number.isFinite(delay)||delay<1000)continue;
        this.engine.clock.schedule(delay,()=>{if(device.powered)this.runApplet(device,name);},{owner,repeat:applet.event.mode==='watchdog'?delay:undefined,label:`EEM ${name}`});
      }
      const syslog=Object.entries<any>(f.eem||{}).filter(([,a])=>a.event?.type==='syslog');
      if(syslog.length){let last=device.runtime.logs.at(-1);this.engine.clock.schedule(1000,()=>{if(!device.powered)return;const index=last?device.runtime.logs.lastIndexOf(last):-1,messages=device.runtime.logs.slice(index+1);for(const [name,applet]of syslog)if(messages.some(message=>message.includes(applet.event.pattern)))this.runApplet(device,name);last=device.runtime.logs.at(-1);},{owner,repeat:1000,label:'EEM syslog scan'});}
      if(f.archive?.timePeriod){const delay=f.archive.timePeriod*60000;if(Number.isFinite(delay)&&delay>=60000)this.engine.clock.schedule(delay,()=>{if(device.powered){try{this.archive(device,renderConfig(device).join('\n'));}catch(error){this.engine.log(device.id,(error as Error).message,3);}}},{owner,repeat:delay,label:'Configuration archive'});}
    }
  }
  private vty(d: Device, port: number): [string, any] | undefined {
    const transport = port === 22 ? 'ssh' : 'telnet';
    return Object.entries<any>(d.config.features.lines || {}).find(([name, line]) => name.startsWith('vty ') && (line.transport === 'all' || String(line.transport || '').split(' ').includes(transport)));
  }
  accepts(d: Device, port: number): boolean {
    if(d.kind==='datacenter'&&(port!==22||!nsosFeature(d,'ssh')))return false;
    return d.powered && (port===22&&sshFileEnabled(d)||!!this.vty(d, port) && (port !== 22 || !!d.config.features.ssh?.keys));
  }
  private method(d: Device, line: any): RemoteSession['method'] {
    const methods = d.config.features.aaa?.enabled ? d.config.features.aaa.login?.[line.authentication || 'default'] : undefined;
    if (methods) {
      if (methods[0] === 'local') return 'local';
      if (methods[0] === 'none') return 'none';
      return 'aaa';
    }
    return line.login === 'local' ? 'local' : line.login === 'password' ? 'password' : 'none';
  }
  private beginAccounting(session:RemoteSession,device:Device,privilege:number):void{
    session.accounting={sessionId:session.id,username:session.username,line:session.line,source:session.source,started:this.engine.clock.now(),privilege,...device.kind==='datacenter'?{platform:'nxos' as const}:{}};
    this.accounting.exec(device,session.accounting,'start');
    session.cli.setAccountingHook?.((command,level,status,taskId)=>{if(session.accounting)this.accounting.command(device,{...session.accounting,privilege:level},command,status,`${session.id}-${taskId}`);});
    this.scheduleExpiry(session);
  }
  private scheduleExpiry(session:RemoteSession):void{
    this.engine.clock.cancel(session.expiryTimer);if(session.expires===Number.MAX_SAFE_INTEGER)return;
    session.expiryTimer=this.engine.clock.schedule(Math.max(0,session.expires-this.engine.clock.now())+1,()=>{if(this.sessions.has(session.id))this.close(session,'idle timeout');},{owner:session.deviceId,label:'VTY idle timeout'});
  }
  private close(session: RemoteSession,reason='connection closed'): void {
    if(!this.sessions.has(session.id))return;
    this.engine.clock.cancel(session.expiryTimer);
    const target=this.engine.getDevice(session.deviceId);if(target?.runtime.features.managementSessions?.includes(session.id))recordDeviceAccess(this.engine,target,{session:session.id,kind:reason==='idle timeout'?'idle-timeout':reason==='logout'?'logout':'close',success:true,line:session.line,source:session.source,port:session.port,username:session.username,method:session.method,reason});
    this.sessions.delete(session.id);
    for(const key of this.clientVRFs.keys())if(key.endsWith('|'+session.id))this.clientVRFs.delete(key);
    const device = this.engine.getDevice(session.deviceId);
    // A restarted runtime has lost the session; do not invent a later Stop after power returns.
    if(device?.powered&&device.runtime.features.managementSessions?.includes(session.id)&&session.accounting)this.accounting.exec(device,session.accounting,'stop',reason);
    if (device) device.runtime.features.managementSessions = (device.runtime.features.managementSessions || []).filter((s: string) => s !== session.id);
  }
  private alive(session: RemoteSession): boolean {
    const d = this.engine.getDevice(session.deviceId);
    return !!d?.powered && !!d.runtime.features.managementSessions?.includes(session.id) && session.expires >= this.engine.clock.now() && (session.phase==='ready'||session.authDeadline===undefined||session.authDeadline>=this.engine.clock.now());
  }
  private reply(session: RemoteSession, output: string[] = []): Record<string, any> {
    return { sessionId: session.id, output, prompt: session.phase === 'username' ? 'Username:' : session.phase === 'password' ? 'Password:' : session.cli.prompt, passwordInput: session.phase === 'password' || session.cli.passwordInput, pageLength:session.cli.pageLength, pageWidth:session.cli.pageWidth, editing:session.cli.editing, history:session.cli.commandHistory, timestamp:session.cli.commandTimestamp, closed: false };
  }
  private authenticateSession(session: RemoteSession, device: Device, text: string): Record<string, any> {
    if (session.phase === 'username') { session.username = text.trim(); session.phase = 'password'; return this.reply(session); }
    const line = device.config.features.lines[session.line];
    const user = ownRecordValue(device.config.features.users,session.username),expected=accountCredential(user);
    const remote=session.method==='aaa'?this.authenticate(device.id,line.authentication||'default',session.username||'',text,'login',session.line):undefined;
    const valid = remote?remote.accepted:session.method === 'local' ? expected!==undefined && expected === text : typeof line.password==='string' && line.password.length>0 && line.password === text;
    if (valid) {
      const authorization=this.execPrivilege(device.id,session.line,session.username,true,remote?.privilege??user?.privilege??line.privilege??1,remote);if(!authorization.accepted){this.close(session);return {closed:true,output:['% EXEC authorization failed.']};}session.phase = 'ready';session.cli.setPrivilege(authorization.privilege);session.cli.setIdentity(session.username,true,session.line,session.method==='aaa'?remote?.role??'network-operator':user?.role);this.beginAccounting(session,device,authorization.privilege);
      if(session.port===22&&session.method==='local'&&!device.config.features.aaa?.enabled&&line.login==='local'&&session.username){this.localSSHLogins.push({deviceId:device.id,runtime:device.runtime,username:session.username,source:session.source,privilege:authorization.privilege,line:session.line,time:this.engine.clock.now()});if(this.localSSHLogins.length>1000)this.localSSHLogins.splice(0,this.localSSHLogins.length-1000);}
      recordDeviceAccess(this.engine,device,{session:session.id,kind:'login',success:true,line:session.line,source:session.source,port:session.port,username:session.username,privilege:authorization.privilege,method:session.method});
      this.engine.log(device.id, `User ${session.username || 'line'} logged in from ${session.source} on ${session.line}`, 6);
      return this.reply(session, device.config.features.banners?.exec ? [device.config.features.banners.exec] : []);
    }
    recordDeviceAccess(this.engine,device,{session:session.id,kind:'login',success:false,line:session.line,source:session.source,port:session.port,username:session.username,method:session.method});
    recordLoginFailure(device,this.engine.clock.now(),session.source,session.username);
    if(loginBlocked(device,this.engine.clock.now())){this.close(session);return {closed:true,output:['% Login blocked: quiet mode is active.']};}
    session.attempts++;
    if (session.attempts >= (session.port===22?device.config.features.ssh?.retries??3:3)) { this.close(session); return { closed: true, output: ['% Bad passwords', 'Connection closed.'] }; }
    if (session.method === 'local'||session.method==='aaa') session.phase = session.port===22?'password':'username';
    return this.reply(session, [(session.method === 'local'||session.method==='aaa') ? '% Login invalid' : '% Bad password']);
  }
  private handle(d: Device, port: number, payload: any, source: string, destination: string): Record<string, any> {
    if (!this.accepts(d, port)) return { closed: true, output: ['% Transport disabled.'] };
    if(port===22&&payload?.application==='ssh-file')return handleSSHFile(this.engine,d,payload,source,destination,(username,password)=>{
      const vty=this.vty(d,22),authentication=this.authenticate(d.id,vty?.[1]?.authentication??'default',username,password,'login',vty?.[0]);
      if(!authentication.accepted||!d.powered)return {accepted:false};
      if(['pc','laptop','server'].includes(d.kind))return authentication;
      if(!vty||vty[1].exec===false)return {accepted:false};
      const authorization=this.execPrivilege(d.id,vty[0],username,true,authentication.privilege??1,authentication);
      return {accepted:authorization.accepted,privilege:authorization.privilege};
    });
    if(!this.vty(d,port))return {closed:true,output:['% Interactive shell is unavailable on this file-only listener.']};
    if (payload?.operation === 'open') {
      if(payload.transport&&payload.transport!==(port===22?'ssh':'telnet'))return {closed:true,output:['% Remote terminal protocol negotiation failed.']};
      if(loginBlocked(d,this.engine.clock.now()))return {closed:true,output:['% Login blocked: quiet mode is active.']};
      const [name, line] = this.vty(d, port)!;
      const accessClass=isIPv6(source)?line.ipv6AccessClassIn:line.accessClassIn;
      if(accessClass&&!this.engine.aclPermits(d.id,accessClass,source,destination,'tcp',{destinationPort:port})){recordDeviceAccess(this.engine,d,{session:'',kind:'access-denied',success:false,line:name,source,port,username:payload.username,method:this.method(d,line)});return {closed:true,output:['% Connection refused by VTY access-class.']};}
      if(line.exec===false)return {closed:true,output:['% EXEC is disabled on this line.']};
      const method = this.method(d, line);
      if (method === 'password' && !line.password) return { closed: true, output: ['', 'Password required, but none set', 'Connection closed.'] };
      const span = name.split(' ').slice(1).map(Number), capacity = span.length > 1 ? span[1] - span[0] + 1 : 1;
      for (const existing of [...this.sessions.values()]) if (!this.alive(existing)) this.close(existing);
      if ([...this.sessions.values()].filter(s => s.deviceId === d.id && s.line === name).length >= capacity) return { closed: true, output: ['% All configured VTY lines are in use.'] };
      const used=new Set([...this.sessions.values()].filter(s=>s.deviceId===d.id).map(s=>s.lineNumber));const lineNumber=Array.from({length:capacity},(_,i)=>span[0]+i).find(n=>!used.has(n));if(lineNumber===undefined)return {closed:true,output:['% All configured VTY lines are in use.']};
      const session: RemoteSession = {lineNumber,lastActivity:this.engine.clock.now(), id: `vty-${++this.sequence}`, deviceId: d.id, source, port, line: name, cli: this.factory(d.id), method, phase: method === 'none' ? 'ready' : (method === 'local'||method==='aaa') && !payload.username ? 'username' : 'password', username: payload.username, attempts: 0, expires: this.engine.clock.now() + (line.execTimeout === 0 ? Number.MAX_SAFE_INTEGER : (line.execTimeout ?? 600) * 1000) };
      session.cli.setAccessContext?.(session.id,source,port);
      if(port===22)session.authDeadline=this.engine.clock.now()+(d.config.features.ssh?.timeout??120)*1000;
      this.sessions.set(session.id, session); (d.runtime.features.managementSessions ??= []).push(session.id);
      if(Number.isInteger(payload.columns)&&payload.columns>0&&payload.columns<=512)session.cli.setViewportColumns?.(payload.columns);
      if (session.phase === 'ready'){const authorization=this.execPrivilege(d.id,name,session.username,false,line.privilege||1);if(!authorization.accepted){this.close(session);return {closed:true,output:['% EXEC authorization failed.']};}session.cli.setPrivilege(authorization.privilege);session.cli.setIdentity(session.username,false,name);this.beginAccounting(session,d,authorization.privilege);}
      const messages = [d.config.features.banners?.motd, d.config.features.banners?.login].filter(Boolean);
      if((port===23||d.kind==='datacenter')&&session.phase!=='ready')messages.push('', 'User Access Verification', '');
      return this.reply(session, messages);
    }
    const session = this.sessions.get(payload?.sessionId);
    if (!session || session.deviceId !== d.id || session.port !== port || session.source !== source || !this.alive(session)) {
      if (session) this.close(session);
      return { closed: true, output: ['% Session expired or device restarted.'] };
    }
    if(Number.isInteger(payload.columns)&&payload.columns>0&&payload.columns<=512)session.cli.setViewportColumns?.(payload.columns);
    if(payload.operation==='poll')return this.reply(session,session.phase==='ready'?session.cli.pollOutput():[]);
    if(payload.operation==='status')return this.reply(session);
    if(payload.operation==='complete')return {...this.reply(session),completion:session.phase==='ready'?session.cli.complete(String(payload.line||'')):String(payload.line||'')};
    if(payload.operation==='cancel'){if(session.phase!=='ready'){this.close(session);return {closed:true,output:['Connection cancelled.']};}return this.reply(session,session.cli.cancel());}
    if (payload.operation === 'close') { this.close(session); return { closed: true, output: ['Connection closed.'] }; }
    const line = d.config.features.lines[session.line];
    session.lastActivity=this.engine.clock.now();
    session.expires = this.engine.clock.now() + (line.execTimeout === 0 ? Number.MAX_SAFE_INTEGER : (line.execTimeout ?? 600) * 1000);
    if(session.phase==='ready')this.scheduleExpiry(session);
    const text = String(payload.line ?? '');
    if (session.phase !== 'ready') return this.authenticateSession(session, d, text);
    const execExit=!session.cli.remoteConnected&&!session.cli.passwordInput&&/^(exit|logout)$/i.test(text.trim())&&['user','priv'].includes(session.cli.mode);
    const output = session.cli.execute(text);
    if(execExit){this.close(session,'logout');return {closed:true,output:['Connection closed.']};}
    if (!this.alive(session)) { this.close(session); return { closed: true, output: [...output, 'Connection closed.'] }; }
    return this.reply(session, output);
  }
  open(sourceId: string, address: string, port: number, username?: string,transport?:'ssh'|'telnet',columns?:number,vrf?:string): ServiceResult {
    const result = this.engine.tcpRequest(sourceId, address, port, { operation: 'open', username,transport,columns },{vrf,source:port===22?this.engine.getDevice(sourceId)?.config.features.ssh?.sourceInterface:undefined});
    this.wait(result);if(vrf&&result.status==='success'&&!result.closed&&typeof result.sessionId==='string')this.clientVRFs.set(sourceId+'|'+result.sessionId,vrf);return result;
  }
  send(sourceId: string, address: string, port: number, sessionId: string, line: string,columns?:number): ServiceResult {
    const result = this.engine.tcpRequest(sourceId, address, port, { operation: 'line', sessionId, line,columns },{vrf:this.clientVRFs.get(sourceId+'|'+sessionId),source:port===22?this.engine.getDevice(sourceId)?.config.features.ssh?.sourceInterface:undefined});
    this.wait(result);return result;
  }
  query(sourceId:string,address:string,port:number,sessionId:string,operation:string,line:string,columns?:number):ServiceResult{const result=this.engine.tcpRequest(sourceId,address,port,{operation,sessionId,line,columns},{vrf:this.clientVRFs.get(sourceId+'|'+sessionId),source:port===22?this.engine.getDevice(sourceId)?.config.features.ssh?.sourceInterface:undefined});this.wait(result);return result;}
  disconnect(sourceId: string, address: string, port: number, sessionId: string): ServiceResult {
    const result = this.engine.tcpRequest(sourceId, address, port, { operation: 'close', sessionId },{vrf:this.clientVRFs.get(sourceId+'|'+sessionId),source:port===22?this.engine.getDevice(sourceId)?.config.features.ssh?.sourceInterface:undefined});
    this.wait(result);return result;
  }
  archive(device: Device, configuration: string): string {
    const settings = device.config.features.archive || { path: 'flash:archive', maximum: 10 };
    const history = device.config.features.archives ??= [];
    const id = (history.at(-1)?.id || 0) + 1, path = `${settings.path || 'flash:archive'}-${id}`;
    writeFlashFile(device,path.replace(/^flash:/,''),configuration);
    history.push({ id, path, time: this.engine.clock.now(), configuration });
    while (history.length > (settings.maximum || 10)){const old=history.shift();delete device.config.features.files[old.path.replace(/^flash:/,'')];}
    return path;
  }
  runApplet(device: Device, name: string): string[] {
    const applet = device.config.features.eem?.[name];
    if (!applet) return ['% EEM applet does not exist.'];
    const key = `${device.id}:${name}`, depth = this.automationRuns.get(key) || 0;
    if (depth) return ['% Recursive applet invocation was blocked.'];
    this.automationRuns.set(key, depth + 1);
    const cli = this.factory(device.id); cli.setPrivilege(15); const output: string[] = [];let executed=0,failed=false;
    try {
      for (const action of [...(applet.actions || [])].sort((a, b) => Number(a.order) - Number(b.order)).slice(0, 100)) {
        executed++;if (action.kind === 'syslog') this.engine.log(device.id, action.text, 6);
        else if (action.kind === 'cli') { const result = cli.execute(action.text); output.push(...result); if (result.some(iosRejected)) {failed=true;break;} }
      }
      device.runtime.features.eemHistory ??= [];
      device.runtime.features.eemHistory.push({ name, time: this.engine.clock.now(), actions:executed,status:failed?'failed':'success',eventType:applet.event?.type??'none' });
      return output.length ? output : [`EEM applet ${name} completed.`];
    } finally { this.automationRuns.delete(key); }
  }
}
