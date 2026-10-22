import type {Simulator} from './engine.ts';
import {defaultInterface, type Device, type InterfaceConfig, type StaticRoute} from './model.ts';
import {IOSSession} from './cli.ts';
import {createCLISession} from './session.ts';
import {nsosConfig,nsosFeature,defaultVPC,vpcPortReason,vpcAggregationSuspended,vpcInterfaceMTU,type VPCConfig} from './datacenter.ts';
import {nsosVPCShow,nsosVPCConfig} from './nsos-vpc-show.ts';
import {nsosACLEntry,nsosACLShow} from './nsos-acl.ts';
import {renderNSOSConfig} from './nsos-config.ts';
import {platformIdentity,platformSoftware,platformImage,NETSIM_VERSION} from './platform-identity.ts';
import {iosSerial,iosUptime} from './ios-system-show.ts';
import {iosBootState,iosBooting} from './ios-boot.ts';
import {isIPv4,isIPv6,parseCidr,maskToPrefix,intToIp} from './ip.ts';
import {ownRecordValue,accountCredential,setRecordValue} from './record-map.ts';
import {managementFor} from './management.ts';
import {formatIOSL2Show} from './ios-show-l2.ts';
import {formatIOSShow} from './ios-show.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {nsosRouteTable,nsosIPBrief,nsosClock,nsosLogging,nsosUsers,nsosMAC,nsosDiscovery,nsosPort,nsosInterface} from './nsos-operational-show.ts';
import {iosDuration} from './ios-system-show.ts';
import {writeFlashFile} from './filesystem.ts';
import {interfaceSpeed,interfaceBandwidth} from './ethernet.ts';
import {filterIOSOutput,iosLogLine} from './ios-system.ts';
import {iosRejected} from './ios-help.ts';

type Mode='priv'|'config'|'interface'|'interface-range'|'vlan'|'vrf'|'router'|'router-vrf'|'vpc'|'mst'|'acl';
type Context={mode:Mode;name?:string;interfaces?:string[];vrf?:string;parent?:Context};
type Command={syntax:string;description:string;run:(args:string[],no:boolean)=>string[]|void;no?:string;write:boolean};
type Variant={command:Command;words:string[];no:boolean};
const FEATURES=['interface-vlan','lacp','lldp','ospf','ssh','vpc','vtp'];
class NSOSError extends Error {}
const fail=(message:string):never=>{throw new NSOSError('% '+message);};
const integer=(text:string|undefined,min:number,max:number):number=>{
  if(!text||!/^\d+$/.test(text)||!Number.isSafeInteger(+text)||+text<min||+text>max)return fail(`Value must be an integer between ${min} and ${max}.`);
  return +text;
};
const name=(text:string):string=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(text)?text:fail('Invalid name.');
const ip4=(text:string):string=>isIPv4(text)?text:fail('Invalid IPv4 address.');
const clone=<T>(value:T):T=>structuredClone(value);
const wildcard=(word:string)=>word.startsWith('<');
const remainder=(word:string)=>word.endsWith('...>');
const mask=(prefix:number)=>[24,16,8,0].map(shift=>((prefix===0?0:0xffffffff<<(32-prefix))>>>shift)&255).join('.');
function vlanList(text:string):number[]{
  const result=new Set<number>();
  for(const entry of text.split(',')){
    const m=/^(\d+)(?:-(\d+))?$/.exec(entry);
    if(!m)fail('Invalid VLAN list.');
    const low=integer(m![1],1,4094),high=integer(m![2]??m![1],low,4094);
    for(let i=low;i<=high;i++)result.add(i);
  }
  return [...result].sort((a,b)=>a-b);
}

/** A deliberately bounded NX-OS-style command surface, not an IOS alias layer. */
export class NSOSSession {
  readonly engine:Simulator;
  readonly deviceId:string;
  readonly history:string[]=[];
  private context:Context={mode:'priv'};
  private role:'network-admin'|'network-operator'='network-admin';
  private username?:string;
  private login?:{phase:'username'|'password';username?:string;attempts:number};
  private transport:IOSSession;
  private length=24;
  private width?:number;
  private viewportColumns?:number;
  private boot?:ReturnType<typeof iosBootState>;
  private bootCursor=0;
  private runtime?:Device['runtime'];
  private readonly localConsole:boolean;
  private pendingReload=false;
  private monitor=false;
  private logCursor?:string;
  constructor(engine:Simulator,deviceId:string,options:{skipConsoleLogin?:boolean}={}){
    this.engine=engine;this.deviceId=deviceId;
    if(this.device.kind!=='datacenter')throw Error('NS-OS requires a Datacenter Switch.');
    this.localConsole=!options.skipConsoleLogin;
    this.transport=new IOSSession(engine,deviceId,{skipConsoleLogin:true});
    this.transport.setPrivilege(15);
    this.runtime=this.device.runtime;this.logCursor=this.device.runtime.features.logEntries?.at(-1)?.id;
    if(this.localConsole)this.beginLogin();
  }
  private get device():Device{return this.engine.getDevice(this.deviceId)!;}
  get mode():string{return this.remoteConnected?this.transport.mode:this.context.mode;}
  get prompt():string{
    if(this.remoteConnected)return this.transport.prompt;
    if(this.login)return this.login.phase==='username'?'login:':'Password:';
    if(this.pendingReload)return 'Proceed with reload? (y/n) [n] ';
    const suffix:Record<Mode,string>={priv:'',config:'(config)',interface:'(config-if)','interface-range':'(config-if-range)',vlan:'(config-vlan)',vrf:'(config-vrf)',router:'(config-router)', 'router-vrf':'(config-router-vrf)',vpc:'(config-vpc-domain)',mst:'(config-mst)',acl:'(config-acl)'};
    return this.device.config.hostname+suffix[this.context.mode]+'#';
  }
  get busy():boolean{return iosBooting(this.device);}
  get passwordInput():boolean{return this.remoteConnected?this.transport.passwordInput:this.login?.phase==='password';}
  get remoteConnected():boolean{return this.transport.remoteConnected;}
  get windowsMode():boolean{return false;}
  get hostMode():boolean{return false;}
  get pageLength():number{return this.remoteConnected?this.transport.pageLength:this.length;}
  get pageWidth():number{return this.remoteConnected?this.transport.pageWidth:this.width??this.viewportColumns??80;}
  get editing():boolean{return true;}
  get commandHistory():string[]{return this.remoteConnected?this.transport.commandHistory:this.history;}
  get commandTimestamp():string|undefined{return undefined;}
  get configurationMode():boolean{return this.remoteConnected?this.transport.configurationMode:this.context.mode!=='priv';}
  setViewportColumns(columns:number):void{if(Number.isInteger(columns)&&columns>0)this.viewportColumns=Math.min(512,columns);this.transport.setViewportColumns(columns);}
  consumeDisplayAction():undefined{return undefined;}
  setPrivilege(_level:number):void{this.context={mode:'priv'};}
  setIdentity(username:string|undefined,authenticated:boolean,_line:string):void{
    this.username=username;this.login=undefined;
    const user=ownRecordValue(this.device.config.features.users,username);
    this.role=authenticated&&user?.role==='network-admin'?'network-admin':'network-operator';
  }
  private beginLogin():void{
    if(Object.keys(this.device.config.features.users||{}).length){this.role='network-operator';this.login={phase:'username',attempts:0};}
    else{this.role='network-admin';this.login=undefined;}
  }
  private syncRuntime():void{
    if(this.runtime===this.device.runtime)return;
    this.runtime=this.device.runtime;this.context={mode:'priv'};this.pendingReload=false;this.history.length=0;this.bootCursor=0;
    this.length=24;this.width=undefined;this.logCursor=undefined;this.monitor=false;
    this.transport=new IOSSession(this.engine,this.deviceId,{skipConsoleLogin:true});this.transport.setPrivilege(15);
    this.transport.setViewportColumns(this.viewportColumns??80);
    if(this.localConsole)this.beginLogin();
  }
  pollOutput():string[]{
    this.syncRuntime();
    if(this.remoteConnected)return this.transport.pollOutput();
    const boot=iosBootState(this.device);
    if(boot!==this.boot){this.boot=boot;this.bootCursor=0;}
    const lines=boot?boot.lines.slice(this.bootCursor):[];if(boot)this.bootCursor=boot.lines.length;
    if(this.busy)return lines;
    const entries:any[]=this.device.runtime.features.logEntries??[],index=this.logCursor?entries.findIndex(e=>e.id===this.logCursor):-1,unread=entries.slice(index+1);this.logCursor=entries.at(-1)?.id;
    const logging=this.device.config.features.logging??{},enabled=this.localConsole?logging.console!==false:this.monitor&&logging.monitor!==false;
    if(this.login||!enabled||logging.enabled===false)return lines;
    const rows=unread.filter(e=>e.severity<=(this.localConsole?logging.consoleLevel??2:logging.monitorLevel??5));
    if(!this.localConsole){const counts=this.device.runtime.features.logSinkCounts??={console:0,monitor:0,buffer:0,trap:0};counts.monitor+=rows.length;}
    return [...lines,...rows.map(e=>iosLogLine(this.device,e))];
  }
  cancel():string[]{if(this.remoteConnected)return this.transport.cancel();this.context={mode:'priv'};this.pendingReload=false;return [];}
  escape():string[]{return this.remoteConnected?this.transport.escape():[];}
  private requireAdmin():void{if(this.role!=='network-admin')fail('Permission denied: role network-admin is required.');}
  private requireFeature(feature:string):void{if(!nsosFeature(this.device,feature))fail(`Feature ${feature} is not enabled. Use "feature ${feature}" in configuration mode.`);}
  private enter(mode:Mode,name?:string,vrf?:string):void{this.context={mode,name,vrf,parent:this.context};}
  private c(syntax:string,description:string,run:Command['run'],options:{no?:string;read?:boolean}={}):Command{return {syntax,description,run,no:options.no,write:!options.read};}
  private get vrf():string|undefined{return this.context.mode==='vrf'?this.context.name:this.context.vrf;}
  private port(input:string,create=false):InterfaceConfig{
    const compact=input.replace(/\s/g,''),exact=Object.values(this.device.config.interfaces).find(p=>p.name.toLowerCase()===compact.toLowerCase());
    if(exact)return exact;
    const match=/^(e|eth(?:ernet)?|po(?:rt-channel)?|vl(?:an)?|lo(?:opback)?)(\d+(?:\/\d+)?)$/i.exec(compact);
    if(!match)return fail('Invalid interface name.');
    const prefix=match[1].toLowerCase(),label=prefix.startsWith('e')?'Ethernet':prefix.startsWith('po')?'Port-channel':prefix.startsWith('vl')?'Vlan':'Loopback',canonical=label+match[2];
    if(this.device.config.interfaces[canonical])return this.device.config.interfaces[canonical];
    if(!create||label==='Ethernet')return fail(`Interface ${canonical} does not exist.`);
    this.requireAdmin();
    const id=integer(match[2],label==='Loopback'?0:1,label==='Vlan'?4094:label==='Port-channel'?4096:1023);
    if(label==='Vlan')this.requireFeature('interface-vlan');
    const p=defaultInterface(label+id,label==='Port-channel');
    p.adminUp=label==='Loopback';
    if(label==='Loopback'){p.features.bandwidth=8000000;p.features.delay=500;}
    if(label==='Port-channel'){p.features.nonegotiate=true;p.speed=10000;}
    this.device.config.interfaces[p.name]=p;
    return p;
  }
  private configureInterfaces(args:string[],no:boolean):void{
    const input=args.join(''),range=/^(?:e|eth(?:ernet)?)(\d+)\/(\d+)-(\d+)$/i.exec(input);
    if(range){
      if(no)fail('Physical interfaces cannot be deleted.');
      const first=integer(range[2],1,65535),last=integer(range[3],first,65535),interfaces:string[]=[];
      for(let port=first;port<=last;port++)interfaces.push(this.port('Ethernet'+range[1]+'/'+port).name);
      this.context={mode:'interface-range',name:interfaces[0],interfaces,parent:{mode:'config'}};return;
    }
    const p=this.port(input,!no);
    if(no){
      this.requireAdmin();if(!/^(Port-channel|Vlan|Loopback)/.test(p.name))fail('Physical interfaces cannot be deleted.');
      if(Object.values(this.device.config.interfaces).some(x=>x.features.channelGroup&&'Port-channel'+x.features.channelGroup===p.name))fail('Remove channel-group members first.');
      delete this.device.config.interfaces[p.name];if(nsosConfig(this.device).vpc?.peerLink===p.name)delete nsosConfig(this.device).vpc!.peerLink;
      this.context={mode:'config'};return;
    }
    this.context={mode:'interface',name:p.name,parent:{mode:'config'}};
  }
  private rangeCommands():Command[]{
    return this.interfaceCommands().map(command=>({...command,run:(args:string[],no:boolean)=>{
      const range=this.context,output:string[]=[];
      try{
        for(const name of range.interfaces!){
          this.context={mode:'interface',name,parent:{mode:'config'}};
          const before=clone(this.device.config),handler=this.interfaceCommands().find(c=>c.syntax===command.syntax)!;
          const lines=handler.run(args,no)||[];
          if(lines.some(iosRejected))throw new NSOSError(lines.join('\n'));
          if(command.write)this.synchronizeChannel(before,this.context);
          output.push(...lines);
        }
        return output;
      }finally{this.context=range;}
    }}));
  }
  private get selected():InterfaceConfig{return this.device.config.interfaces[this.context.name!]??fail('No interface selected.');}
  private process(tag:string,vrf?:string,create=true):any{
    name(tag);
    const c=this.device.config;
    let root=c.protocols.ospf;
    if(!root&&create)root=c.protocols.ospf={vrfs:{}};
    const prior=vrf?root?.vrfs?.[vrf]:root;
    if(create&&prior?.nsosTag&&prior.nsosTag!==tag)fail(`Only one OSPF instance per VRF is supported; ${prior.nsosTag} already exists in ${vrf||'default'}.`);
    if(!create)return prior?.nsosTag===tag?prior:undefined;
    if(vrf&&!c.features.vrfs?.[vrf])fail(`VRF ${vrf} does not exist.`);
    if(prior?.nsosTag)return prior;
    const process={processId:1,nsosTag:tag,networks:[],passiveInterfaces:[]};
    if(vrf){root.vrfs??={};root.vrfs[vrf]=process;return process;}
    Object.assign(root,process);return root;
  }
  private feature(feature:string,no:boolean):void{
    if(!FEATURES.includes(feature))fail(`Feature ${feature} is not supported by the NS-OS simulation.`);
    const d=this.device,n=nsosConfig(d),c=d.config;
    if(no&&feature==='lacp'&&Object.values(c.interfaces).some(p=>p.features.channelGroup&&['active','passive'].includes(p.features.channelMode)))fail('Remove configured LACP channel-groups before disabling feature lacp.');
    if(no&&feature==='interface-vlan'&&Object.keys(c.interfaces).some(p=>/^Vlan/.test(p)))fail('Remove VLAN interfaces before disabling feature interface-vlan.');
    if(no&&feature==='vpc'){delete n.vpc;for(const p of Object.values(c.interfaces)){delete p.features.vpcId;delete p.features.vpcOrphanSuspend;}}
    if(no&&feature==='ospf'){delete c.protocols.ospf;for(const p of Object.values(c.interfaces))delete p.features.ospf;}
    n.enabled=n.enabled.filter(f=>f!==feature);if(!no)n.enabled.push(feature);
    if(feature==='lldp')c.features.lldp=!no;
    if(feature==='vtp'){c.features.vtp??={domain:'',mode:'transparent',version:1,revision:0};c.features.vtp.enabled=!no;c.features.vtp.mode='transparent';}
    if(feature==='ssh'){
      c.features.ssh={...(c.features.ssh||{}),keys:!no,version:2};
      c.features.lines??={};c.features.lines['vty 0 15']={login:'local',transport:no?'none':'ssh',exec:true};
    }
  }
  private route(prefix:string,next:string,adText:string|undefined,no:boolean,family:4|6,iface?:string):void{
    const cidr=parseCidr(prefix);if(cidr.family!==family)fail('Address family does not match route.');
    if(family===4?!isIPv4(next):!isIPv6(next))fail('Invalid next-hop address.');
    const ad=adText===undefined?1:integer(adText,1,255),r:StaticRoute={network:cidr.network,prefix:cidr.prefix,nextHop:next,ad,vrf:this.vrf};
    if(iface)r.interface=this.port(iface).name;
    this.device.config.staticRoutes=this.device.config.staticRoutes.filter(x=>!(x.network===r.network&&x.prefix===r.prefix&&x.nextHop===r.nextHop&&(x.vrf||'')===(r.vrf||'')&&x.interface===r.interface));
    if(!no)this.device.config.staticRoutes.push(r);
  }
  private commands():Command[]{
    const c=this.device.config,f=c.features,cmd=this.c.bind(this),mode=this.context.mode;
    const common=[
      cmd('show <show...>','Display operational information',a=>this.show(a),{read:true}),
      cmd('end','Return to EXEC',()=>{this.context={mode:'priv'};},{read:true}),
      cmd('exit','Exit current mode',()=>{this.context=this.context.parent??{mode:'priv'};},{read:true}),
      cmd('configure terminal','Enter configuration mode',()=>{this.context={mode:'config'};return ['Enter configuration commands, one per line. End with CNTL/Z.'];},{read:true}),
      cmd('terminal length <number>','Set terminal page length',a=>{this.length=integer(a[0],0,511);},{read:true}),
      cmd('terminal monitor','Display subsequent monitor log events',()=>{this.monitor=true;this.logCursor=this.device.runtime.features.logEntries?.at(-1)?.id;},{read:true}),
      cmd('terminal no monitor','Disable monitor log events',()=>{this.monitor=false;},{read:true}),
      cmd('terminal width <number>','Set terminal width',a=>{this.width=integer(a[0],40,511);},{read:true}),
      cmd('logout','End console login',()=>{this.context={mode:'priv'};if(this.localConsole)this.beginLogin();},{read:true}),
    ];
    if(mode==='priv')return [...common,
      cmd('copy running-config startup-config','Save configuration',()=>{this.device.startupConfig=clone(c);return ['Copy complete.'];}),
      cmd('copy running-config <file>','Export running configuration',a=>{const target=this.fileName(a[0]);writeFlashFile(this.device,target,renderNSOSConfig(this.device).join('\n'));return ['Copy complete.'];}),
      cmd('copy <file> running-config','Replay a configuration file',a=>this.applyText(this.readFile(a[0]))),
      cmd('copy startup-config running-config','Merge startup configuration',()=>this.device.startupConfig?this.applyText(renderNSOSConfig(this.device,this.device.startupConfig).join('\n')):fail('Startup configuration is not present.')),
      cmd('show running-config','Display running configuration',()=>{this.requireAdmin();return renderNSOSConfig(this.device);},{read:true}),
      cmd('show startup-config','Display saved configuration',()=>{this.requireAdmin();return this.device.startupConfig?renderNSOSConfig(this.device,this.device.startupConfig):['Startup configuration is not present.'];},{read:true}),
      cmd('reload','Reload from startup configuration',()=>{this.pendingReload=true;return [];}),
      cmd('archive config','Archive running configuration',()=>[managementFor(this.engine,id=>createCLISession(this.engine,id,{skipConsoleLogin:true})).archive(this.device,renderNSOSConfig(this.device).join('\n'))]),
      cmd('ssh <destination>','Connect to a simulated SSH server',a=>this.ssh(a[0]),{read:true}),
      cmd('ssh <destination> vrf <vrf>','Connect through a selected VRF',a=>this.ssh(a[0],a[1]),{read:true}),
      cmd('ping <address>','Send IPv4/IPv6 probes',a=>this.ping(a[0]),{read:true}),
      cmd('ping <address> vrf <vrf>','Send probes in a VRF',a=>this.ping(a[0],a[1]),{read:true}),
      cmd('ping <address> count <count>','Send a bounded number of IPv4/IPv6 probes',a=>this.ping(a[0],undefined,integer(a[1],1,20)),{read:true}),
      cmd('ping <address> vrf <vrf> count <count>','Send a bounded number of probes in a VRF',a=>this.ping(a[0],a[1],integer(a[2],1,20)),{read:true}),
    ];
    const globals=[
      cmd('ip access-list <name>','Configure an implemented IPv4 access list',(a,no)=>{
        const key=name(a[0]);f.acls??={};
        if(no){delete f.acls[key];this.clearACLHits(key);return;}
        if(!ownRecordValue(f.acls,key))setRecordValue(f.acls,key,{name:key,type:'extended',entries:[]});
        this.context={mode:'acl',name:key,parent:{mode:'config'}};
      },{no:'ip access-list <name>'}),
      cmd('hostname <name>','Set hostname',(a,no)=>{c.hostname=no?'DC':name(a[0]);},{no:'hostname'}),
      cmd('feature <feature>','Enable an implemented feature',(a,no)=>this.feature(a[0],no),{no:'feature <feature>'}),
      ...['<interface>','<interface> <number>'].map(syntax=>cmd('interface '+syntax,'Select Ethernet or logical interface',(a,no)=>this.configureInterfaces(a,no),{no:'interface '+syntax,read:true})),
      cmd('vlan <vlans>','Create and select VLANs',(a,no)=>{
        this.requireAdmin();const list=vlanList(a[0]);if(no&&list.includes(1))fail('VLAN 1 cannot be deleted.');
        for(const id of list)if(no)delete c.vlans[id];else c.vlans[id]??={id,name:'VLAN'+String(id).padStart(4,'0'),active:true};
        if(!no)this.context={mode:'vlan',name:list.join(','),parent:{mode:'config'}};
      },{no:'vlan <vlans>'}),
      cmd('vrf context <vrf>','Create/select routing context',(a,no)=>{
        this.requireAdmin();const n=name(a[0]);if(n==='default')fail('The default VRF cannot be configured as a named context.');
        f.vrfs??={};if(no){if(n==='management')fail('The management VRF cannot be deleted.');if(Object.values(c.interfaces).some(p=>p.vrf===n))fail('Remove VRF interface membership first.');delete f.vrfs[n];c.staticRoutes=c.staticRoutes.filter(r=>r.vrf!==n);delete c.protocols.ospf?.vrfs?.[n];}
        else{f.vrfs[n]??={};this.context={mode:'vrf',name:n,parent:{mode:'config'}};}
      },{no:'vrf context <vrf>'}),
      cmd('username <user> password <password> role network-admin','Configure a local administrator',(a)=>this.user(a,'network-admin')),
      cmd('username <user> password <password> role network-operator','Configure a read-only local operator',(a)=>this.user(a,'network-operator')),
      cmd('username <user>','Remove a local account',(a,no)=>{if(!no)fail('Password and role are required.');delete f.users?.[a[0]];},{no:'username <user>'}),
      cmd('snmp-server community <community> group network-operator','Configure read-only SNMPv2c community',a=>{
        if(a[0].length>128)fail('SNMP community is too long.');f.snmp??={communities:{},hosts:[]};f.snmp.communities??={};setRecordValue(f.snmp.communities,a[0],'ro');
      }),
      cmd('snmp-server community <community>','Remove SNMP community',(a,no)=>{if(!no)fail('Use group network-operator for the read-only agent.');delete f.snmp?.communities?.[a[0]];},{no:'snmp-server community <community>'}),
      ...['contact','location'].map(key=>cmd(`snmp-server ${key} <text...>`,'Set SNMP system '+key,(a,no)=>{f.snmp??={communities:{},hosts:[]};if(no)delete f.snmp[key];else f.snmp[key]=a.join(' ');},{no:'snmp-server '+key})),
      cmd('ipv6 unicast-routing','Enable IPv6 forwarding',(_a,no)=>{c.ipv6Routing=!no;},{no:'ipv6 unicast-routing'}),
      cmd('router ospf <tag>','Select named OSPF instance',(a,no)=>{
        this.requireFeature('ospf');
        name(a[0]);
        if(no){
          const root=c.protocols.ospf;if(!root)fail('OSPF instance not found.');
          const scopes=new Set<string>();
          if(root.nsosTag===a[0]){const vrfs=root.vrfs;delete c.protocols.ospf;c.protocols.ospf={vrfs};scopes.add('');}
          for(const [vrf,p] of Object.entries<any>(c.protocols.ospf.vrfs||{}))if(p.nsosTag===a[0]){delete c.protocols.ospf.vrfs[vrf];scopes.add(vrf);}
          if(!scopes.size)fail('OSPF instance not found.');
          for(const p of Object.values(c.interfaces))if(scopes.has(p.vrf||''))delete p.features.ospf;
          return;
        }
        // A second tag may be used to select a different VRF without replacing
        // the one supported instance in the default routing table.
        if(!c.protocols.ospf?.nsosTag||c.protocols.ospf.nsosTag===a[0])this.process(a[0]);
        this.context={mode:'router',name:a[0],parent:{mode:'config'}};
      },{no:'router ospf <tag>'}),
      cmd('vpc domain <domain>','Configure a vPC domain',(a,no)=>{
        this.requireFeature('vpc');const domain=integer(a[0],1,1000),n=nsosConfig(this.device);
        if(no){if(n.vpc?.domain===domain){delete n.vpc;for(const p of Object.values(c.interfaces))delete p.features.vpcId;}return;}
        if(n.vpc&&n.vpc.domain!==domain)fail('Remove the current vPC domain before configuring a different domain.');
        n.vpc??=defaultVPC(domain);this.context={mode:'vpc',name:String(domain),parent:{mode:'config'}};
      },{no:'vpc domain <domain>'}),
      ...['short','long'].map(method=>cmd('spanning-tree pathcost method '+method,'Set operational spanning-tree path cost method',(_a,no)=>{f.stp??={};f.stp.pathcostMethod=no?'short':method;},{no:'spanning-tree pathcost method '+method})),
      ...['rapid-pvst','mst'].map(stpMode=>cmd('spanning-tree mode '+stpMode,'Set operational spanning-tree mode',()=>{f.stp??={};f.stp.mode=stpMode;})),
      cmd('spanning-tree vlan <vlans> priority <priority>','Set per-VLAN bridge priority',a=>{
        const priority=integer(a[1],0,61440);if(priority%4096)fail('Bridge priority must be a multiple of 4096.');
        const ids=vlanList(a[0]);f.stp??={};f.stp.vlanPriorities??={};for(const id of ids)f.stp.vlanPriorities[id]=priority;
      }),
      cmd('spanning-tree mst configuration','Configure MST region',()=>{f.stp??={};f.stp.mst??={name:'NSOS',revision:0,instances:[]};this.context={mode:'mst',parent:{mode:'config'}};}),
      cmd('vtp mode transparent','Set transparent VTP mode',()=>{this.requireFeature('vtp');f.vtp.mode='transparent';}),
      cmd('vtp version <version>','Set VTP version 1 or 2',a=>{this.requireFeature('vtp');f.vtp.version=integer(a[0],1,2);}),
      cmd('vtp domain <name>','Set VTP domain',a=>{this.requireFeature('vtp');f.vtp.domain=name(a[0]);}),
    ];
    const routes=[4,6].flatMap(family=>[
      cmd(`${family===4?'ip':'ipv6'} route <prefix> <next-hop>`,'Configure static route',(a,no)=>this.route(a[0],a[1],undefined,no,family as 4|6),{no:`${family===4?'ip':'ipv6'} route <prefix> <next-hop>`}),
      cmd(`${family===4?'ip':'ipv6'} route <prefix> <next-hop> <distance>`,'Configure static route distance',(a,no)=>this.route(a[0],a[1],a[2],no,family as 4|6),{no:`${family===4?'ip':'ipv6'} route <prefix> <next-hop> <distance>`}),
      cmd(`${family===4?'ip':'ipv6'} route <prefix> <interface> <next-hop>`,'Configure interface-qualified static route',(a,no)=>this.route(a[0],a[2],undefined,no,family as 4|6,a[1]),{no:`${family===4?'ip':'ipv6'} route <prefix> <interface> <next-hop>`}),
      cmd(`${family===4?'ip':'ipv6'} route <prefix> <interface> <next-hop> <distance>`,'Configure interface-qualified static route',(a,no)=>this.route(a[0],a[2],a[3],no,family as 4|6,a[1]),{no:`${family===4?'ip':'ipv6'} route <prefix> <interface> <next-hop> <distance>`}),
    ]);
    if(mode==='config')return [...common,...globals,...routes];
    // NX-OS falls back to global configuration when a command belongs there.
    // Keep local definitions first (notably VRF routes), and change context
    // only when the inherited handler executes, never during help/completion.
    const scoped=(local:Command[]):Command[]=>[...local,...[...globals,...routes]
      .filter(global=>!local.some(command=>command.syntax===global.syntax))
      .map(command=>({...command,run:(args:string[],no:boolean)=>{this.context={mode:'config'};return command.run(args,no);}}))];
    if(mode==='interface')return scoped([...common,...this.interfaceCommands()]);
    if(mode==='interface-range')return scoped([...common,...this.rangeCommands()]);
    if(mode==='acl'){
      const acl=()=>ownRecordValue(f.acls,this.context.name!)??fail('Access list no longer exists.');
      return scoped([...common,
        cmd('statistics per-entry','Collect actual per-rule packet matches',(_a,no)=>{acl().statistics=!no;},{no:'statistics per-entry'}),
        cmd('<sequence> <rule...>','Set an ip/icmp permit/deny entry',a=>{
          const sequence=integer(a[0],1,4294967295),entry=nsosACLEntry(a.slice(1),sequence);
          if(acl().entries.some((e:any)=>e.sequence===sequence))fail('Sequence number already exists; remove the entry before reusing it.');
          acl().entries.push(entry);acl().entries.sort((a:any,b:any)=>a.sequence-b.sequence);this.clearACLHits(this.context.name!,sequence);
        }),
        cmd('no <sequence>','Remove one ACL entry',a=>{const sequence=integer(a[0],1,4294967295);acl().entries=acl().entries.filter((e:any)=>e.sequence!==sequence);this.clearACLHits(this.context.name!,sequence);}),
      ]);
    }
    if(mode==='vrf')return scoped([...common,...routes]);
    if(mode==='vlan')return scoped([...common,
      cmd('name <name>','Name VLAN',a=>{const n=name(a[0]);for(const id of vlanList(this.context.name!))c.vlans[id].name=n;}),
      cmd('shutdown','Suspend VLAN',(_a,no)=>{for(const id of vlanList(this.context.name!))c.vlans[id].active=no;},{no:'shutdown'}),
    ]);
    if(mode==='router'||mode==='router-vrf'){
      const p=()=>this.process(this.context.name!,this.context.vrf);
      return scoped([...common,
        ...['',' Mbps',' Gbps'].map(unit=>cmd('auto-cost reference-bandwidth <number>'+unit,'Set operational OSPF reference bandwidth',(a,no)=>{const value=a[0]===undefined?undefined:integer(a[0],1,unit===' Gbps'?4000:4000000)*(unit===' Gbps'?1000:1);if(no)delete p().referenceBandwidth;else p().referenceBandwidth=value;},{no:'auto-cost reference-bandwidth'+(unit?' <number>'+unit:'')})),
        cmd('router-id <address>','Set OSPF router ID',(a,no)=>{if(no)delete p().routerId;else p().routerId=ip4(a[0]);},{no:'router-id'}),
        cmd('passive-interface default','Suppress OSPF hellos unless an interface overrides the default',(_a,no)=>{p().passiveDefault=!no;},{no:'passive-interface default'}),
        ...(mode==='router'?[cmd('vrf <vrf>','Select OSPF VRF',a=>{this.process(this.context.name!,name(a[0]));this.enter('router-vrf',this.context.name,name(a[0]));})]:[]),
      ]);
    }
    if(mode==='mst')return scoped([...common,
      cmd('name <name>','Set MST region name',a=>{f.stp.mst.name=name(a[0]);}),
      cmd('revision <revision>','Set MST revision',a=>{f.stp.mst.revision=integer(a[0],0,65535);}),
      cmd('instance <instance> vlan <vlans>','Map VLANs to MST instance',(a,no)=>{
        const id=integer(a[0],1,4094),vlans=vlanList(a[1]),m=f.stp.mst;
        for(const row of m.instances)row.vlans=row.vlans.filter((v:number)=>!vlans.includes(v)||no&&row.id!==id);
        m.instances=m.instances.filter((r:any)=>r.vlans.length);
        if(!no){const prior=m.instances.find((r:any)=>r.id===id);if(prior)prior.vlans=[...new Set([...prior.vlans,...vlans])].sort((a:any,b:any)=>a-b);else m.instances.push({id,vlans});}
      },{no:'instance <instance> vlan <vlans>'}),
    ]);
    if(mode==='vpc')return scoped([...common,...this.vpcCommands()]);
    return scoped(common);
  }
  private user(a:string[],role:'network-admin'|'network-operator'):void{
    const username=name(a[0]);if(!a[1]||a[1].length>128)fail('Password must contain 1–128 non-space characters.');
    this.device.config.features.users??={};
    setRecordValue(this.device.config.features.users,username,{password:a[1],role,privilege:role==='network-admin'?15:1});
  }
  private clearACLHits(name:string,sequence?:number):void{
    const hits=this.device.runtime.features.aclHits??{};
    for(const key of Object.keys(hits))if(sequence===undefined?key.startsWith(name+':'):key===name+':'+sequence)delete hits[key];
  }
  private interfaceCommands():Command[]{
    const cmd=this.c.bind(this),p=this.selected,f=p.features,c=this.device.config;
    const data=()=>{if(p.name==='mgmt0')fail('mgmt0 is a dedicated routed management interface.');};
    const routed=()=>{if(p.switchport)fail('Configure no switchport before Layer 3 addressing.');if(f.channelGroup)fail(`Configure Layer 3 on Port-channel${f.channelGroup}, not on an individual member.`);};
    return [
      cmd('description <text...>','Set interface description',(a,no)=>{p.description=no?'':a.join(' ');},{no:'description'}),
      cmd('shutdown','Administratively disable interface',(_a,no)=>{p.adminUp=no;},{no:'shutdown'}),
      cmd('switchport','Configure Layer 2 or routed port',(_a,no)=>{
        data();if(/^(Vlan|Loopback)/.test(p.name))fail('Logical routed interfaces do not support switchport.');
        if(f.channelGroup)fail('Remove channel-group membership before changing Layer 2/3 mode.');
        if(p.switchport!==!no&&f.aclOut)fail('Remove the outbound ACL before changing Layer 2/3 mode.');
        if(no&&(f.vpcId||nsosConfig(this.device).vpc?.peerLink===p.name))fail('vPC members and the peer-link must remain Layer 2 port-channels.');
        if(p.switchport!==!no){delete p.ip;delete p.mask;p.ipv6=[];delete f.ospf;}p.switchport=!no;f.nonegotiate=true;
      },{no:'switchport'}),
      ...['access','trunk'].map(value=>cmd('switchport mode '+value,'Set explicit Layer 2 mode',()=>{
        data();if(!p.switchport)fail('Interface is not a switchport.');
        if(value!=='trunk'&&nsosConfig(this.device).vpc?.peerLink===p.name)fail('The vPC peer-link must remain a Layer 2 trunk port-channel.');
        p.mode=value as 'access'|'trunk';
      })),
      cmd('switchport access vlan <vlan>','Set access VLAN',(a,no)=>{data();if(!p.switchport)fail('Interface is not a switchport.');p.vlan=no?1:integer(a[0],1,4094);},{no:'switchport access vlan'}),
      cmd('switchport trunk native vlan <vlan>','Set native VLAN',(a,no)=>{data();if(!p.switchport)fail('Interface is not a switchport.');p.nativeVlan=no?1:integer(a[0],1,4094);},{no:'switchport trunk native vlan'}),
      cmd('switchport trunk allowed vlan <vlans>','Set allowed VLAN list',(a,no)=>{data();if(!p.switchport)fail('Interface is not a switchport.');p.allowedVlans=no||a[0]==='all'?null:a[0]==='none'?[]:vlanList(a[0]);},{no:'switchport trunk allowed vlan'}),
      ...['add','remove','except'].map(op=>cmd(`switchport trunk allowed vlan ${op} <vlans>`,'Modify allowed VLAN list',a=>{
        data();if(!p.switchport)fail('Interface is not a switchport.');const list=vlanList(a[0]),all=Array.from({length:4094},(_,i)=>i+1),old=p.allowedVlans??all;
        p.allowedVlans=op==='add'?[...new Set([...old,...list])].sort((a,b)=>a-b):(op==='except'?all:old).filter(v=>!list.includes(v));
      })),
      cmd('speed <speed>','Set supported physical speed in Mbps',(a,no)=>{
        const supported:number[]=f.ethernetSpeeds||[];if(!supported.length)fail('Speed can only be set on a physical Ethernet interface.');
        if(no||a[0]==='auto'){f.speedAuto=true;p.speed=Math.max(...supported);return;}
        const speed=integer(a[0],10,40000);if(!supported.includes(speed))fail('Unsupported speed for this port. Supported: '+supported.join(', ')+'.');
        p.speed=speed;f.speedAuto=false;
      },{no:'speed'}),
      cmd('mtu <mtu>','Set interface MTU',(a,no)=>{const mtu=no?1500:integer(a[0],576,9216);if(p.switchport&&mtu!==1500&&mtu!==9216)throw new NSOSError('ERROR: MTU can only be default or system jumbo MTU');p.mtu=mtu;},{no:'mtu'}),
      cmd('vrf member <vrf>','Assign interface to routing context',(a,no)=>{
        routed();const vrf=no?undefined:name(a[0]);if(vrf&&!c.features.vrfs?.[vrf])fail('VRF does not exist.');
        if(p.name==='mgmt0'&&vrf!=='management')fail('mgmt0 must remain in the management VRF.');
        if(p.vrf!==vrf){p.vrf=vrf;delete p.ip;delete p.mask;p.ipv6=[];delete f.ospf;return ['Warning: Deleted all L3 config on interface '+(/^Loopback/.test(p.name)?p.name.toLowerCase():p.name)];}
      },{no:'vrf member'}),
      cmd('ip access-group <name> out','Apply an enforced outbound IPv4 routed ACL',(a,no)=>{
        routed();data();if(!/^Ethernet/.test(p.name))fail('Outbound RACLs are currently implemented on routed physical Ethernet ports only.');
        const key=name(a[0]);
        if(no){if(f.aclOut!==key)fail('Requested ACL does not match the configured outbound ACL.');delete f.aclOut;}
        else f.aclOut=key;
      },{no:'ip access-group <name> out'}),
      cmd('ip address <prefix>','Set IPv4 interface address',(a,no)=>{
        routed();if(no){delete p.ip;delete p.mask;return;}
        const cidr=parseCidr(a[0]);if(cidr.family!==4)fail('An IPv4 prefix is required.');
        p.ip=a[0].split('/')[0];p.mask=mask(cidr.prefix);
      },{no:'ip address'}),
      cmd('ipv6 address <prefix>','Add IPv6 interface address',(a,no)=>{
        routed();const cidr=parseCidr(a[0]);if(cidr.family!==6)fail('An IPv6 prefix is required.');
        p.ipv6=p.ipv6.filter(x=>x.toLowerCase()!==a[0].toLowerCase());if(!no)p.ipv6.push(a[0]);
      },{no:'ipv6 address <prefix>'}),
      ...['active','passive','on'].map(mode=>cmd('channel-group <group> mode '+mode,'Join a port-channel',a=>{
        data();if(!/^Ethernet/.test(p.name))fail('Only physical Ethernet interfaces may join a port-channel.');
        if(mode!=='on')this.requireFeature('lacp');
        const group=integer(a[0],1,4096);
        if(p.ip||p.ipv6.length||f.ospf?.area!==undefined)fail('Remove physical member addressing and OSPF attachment; configure Layer 3 on the port-channel.');
        if(f.aclOut)fail('Remove the outbound physical ACL before joining a port-channel.');
        if(f.channelGroup&&f.channelGroup!==group)fail('Remove current channel-group membership first.');
        if(f.vpcOrphanSuspend)fail('Remove orphan-port suspension before joining a port-channel; configure it on the logical port-channel.');
        const prior=c.interfaces['Port-channel'+group];
        if(prior&&nsosConfig(this.device).vpc?.peerLink===prior.name)p.mtu=prior.mtu;
        const members=Object.values(c.interfaces).filter(x=>x.name!==p.name&&x.features.channelGroup===group);
        if(members.some(x=>(x.features.channelMode==='on')!==(mode==='on')))fail('Static and LACP members cannot share a port-channel.');
        const compatible=(x:InterfaceConfig)=>x.switchport===p.switchport&&x.mtu===p.mtu&&x.vrf===p.vrf&&(!p.switchport||x.mode===p.mode&&x.vlan===p.vlan&&x.nativeVlan===p.nativeVlan&&JSON.stringify(x.allowedVlans)===JSON.stringify(p.allowedVlans));
        if(members.some(x=>!compatible(x)))fail('Port-channel members must have compatible Layer 2/3, MTU and VRF configuration.');
        if(prior&&!compatible(prior))fail('Interface must be compatible with the port-channel Layer 2/3, MTU and VRF configuration.');
        const po=this.port('Port-channel'+group,true);
        if(!prior){po.switchport=p.switchport;po.mode=p.mode;po.vlan=p.vlan;po.nativeVlan=p.nativeVlan;po.allowedVlans=clone(p.allowedVlans);po.mtu=p.mtu;po.vrf=p.vrf;}
        f.channelGroup=group;f.channelMode=mode;
      })),
      cmd('channel-group','Remove port-channel membership',(_a,no)=>{if(!no)fail('Channel-group number and mode are required.');delete f.channelGroup;delete f.channelMode;},{no:'channel-group'}),
      cmd('no channel-group <group>','Remove selected port-channel membership',a=>{const id=integer(a[0],1,4096);if(f.channelGroup!==id)fail('Interface is not in that port-channel.');delete f.channelGroup;delete f.channelMode;}),
      cmd('no ip address <prefix>','Remove selected IPv4 address',a=>{routed();const cidr=parseCidr(a[0]);if(cidr.family!==4)fail('An IPv4 prefix is required.');if(p.ip===a[0].split('/')[0]&&maskToPrefix(p.mask||'255.255.255.0')===cidr.prefix){delete p.ip;delete p.mask;}}),
      ...['fast','normal'].map(rate=>cmd('lacp rate '+rate,'Set LACP periodic rate',()=>{this.requireFeature('lacp');f.lacpRate=rate==='normal'?'slow':'fast';})),
      cmd('lacp port-priority <priority>','Set LACP port priority',a=>{this.requireFeature('lacp');f.lacpPortPriority=integer(a[0],1,65535);}),
      ...['normal','edge','edge trunk','network'].map(type=>cmd('spanning-tree port type '+type,'Set spanning-tree port type',()=>{
        data();if(!p.switchport)fail('Spanning-tree requires a switchport.');f.stpPortType=type;f.portfast=type.startsWith('edge');f.portfastTrunk=type==='edge trunk';
      })),
      ...['bpduguard','bpdufilter'].flatMap(key=>['enable','disable'].map(value=>cmd('spanning-tree '+key+' '+value,'Set BPDU protection',()=>{data();f[key]=value==='enable';}))),
      cmd('no spanning-tree port type','Restore the default STP port type',()=>{data();if(nsosConfig(this.device).vpc?.peerLink===p.name)f.stpPortType='network';else delete f.stpPortType;f.portfast=false;f.portfastTrunk=false;}),
      ...['root','loop','none'].map(value=>cmd('spanning-tree guard '+value,'Set spanning-tree guard',()=>{data();f.stpGuard=value;f.rootGuard=value==='root';f.loopGuard=value==='loop';})),
      cmd('no spanning-tree guard','Restore the default STP guard',()=>{data();delete f.stpGuard;delete f.rootGuard;delete f.loopGuard;}),
      cmd('spanning-tree cost <cost>','Set spanning-tree port cost',a=>{data();f.stpCost=integer(a[0],1,200000000);}),
      cmd('ip router ospf <tag> area <area>','Enable named OSPF on interface',(a,no)=>{
        routed();if(p.name==='mgmt0')fail('Routing protocols are not supported on mgmt0.');this.requireFeature('ospf');const area=this.area(a[1]);
        const process=this.process(a[0],p.vrf,!no);
        if(no){
          if(!process||f.ospf?.area===undefined)return ['Already not configured'];
          if(String(f.ospf.area)!==area)return ['Area mismatch'];
          delete f.ospf.area;delete f.ospf.processId;
        }else f.ospf={...f.ospf,processId:1,area};
      },{no:'ip router ospf <tag> area <area>'}),
      cmd('ip ospf passive-interface','Suppress OSPF hellos on this interface',(_a,no)=>{
        routed();if(p.name==='mgmt0')fail('Routing protocols are not supported on mgmt0.');this.requireFeature('ospf');f.ospf??={};f.ospf.passive=!no;
        const process=p.vrf?c.protocols.ospf?.vrfs?.[p.vrf]:c.protocols.ospf;
        if(process){process.passiveInterfaces=process.passiveInterfaces?.filter((i:string)=>i!==p.name);process.activeInterfaces=process.activeInterfaces?.filter((i:string)=>i!==p.name);}
      },{no:'ip ospf passive-interface'}),
      cmd('default ip ospf passive-interface','Inherit the router or VRF passive-interface default',()=>{
        routed();if(p.name==='mgmt0')fail('Routing protocols are not supported on mgmt0.');this.requireFeature('ospf');if(f.ospf)delete f.ospf.passive;
        const process=p.vrf?c.protocols.ospf?.vrfs?.[p.vrf]:c.protocols.ospf;
        if(process){process.passiveInterfaces=process.passiveInterfaces?.filter((i:string)=>i!==p.name);process.activeInterfaces=process.activeInterfaces?.filter((i:string)=>i!==p.name);}
      }),
      cmd('ip ospf mtu-ignore','Ignore an oversized received OSPF database-description MTU',(_a,no)=>{
        routed();if(p.name==='mgmt0')fail('Routing protocols are not supported on mgmt0.');this.requireFeature('ospf');f.ospf??={};if(no)delete f.ospf.mtuIgnore;else f.ospf.mtuIgnore=true;
      },{no:'ip ospf mtu-ignore'}),
      ...[['cost','cost',1,65535],['priority','priority',0,255],['hello-interval','helloInterval',1,65535],['dead-interval','deadInterval',1,65535]].map(([command,field,min,max])=>cmd(`ip ospf ${command} <number>`,'Set OSPF interface parameter',(a,no)=>{
        routed();if(p.name==='mgmt0')fail('Routing protocols are not supported on mgmt0.');this.requireFeature('ospf');f.ospf??={};if(no)delete f.ospf[field];else f.ospf[field]=integer(a[0],+min,+max);
      },{no:`ip ospf ${command}`})),
      ...['broadcast','point-to-point'].map(type=>cmd('ip ospf network '+type,'Set OSPF network type',()=>{routed();if(p.name==='mgmt0')fail('Routing protocols are not supported on mgmt0.');this.requireFeature('ospf');f.ospf??={};f.ospf.networkType=type;})),
      cmd('vpc <vpc-id>','Assign port-channel vPC ID',(a,no)=>{
        this.requireFeature('vpc');if(!nsosConfig(this.device).vpc)fail('Configure a vPC domain first.');
        if(!/^Port-channel/.test(p.name)||!p.switchport)fail('vPC members must be Layer 2 port-channels.');
        if(nsosConfig(this.device).vpc?.peerLink===p.name)fail('The peer-link cannot also be a vPC member.');
        if(f.vpcOrphanSuspend&&!no)fail('Remove orphan-port suspension before assigning a vPC ID.');
        const id=integer(a[0],1,4096);if(Object.values(c.interfaces).some(x=>x.name!==p.name&&x.features.vpcId===id))fail('vPC ID is already assigned.');
        if(no)delete f.vpcId;else f.vpcId=id;
      },{no:'vpc <vpc-id>'}),
      cmd('vpc peer-link','Designate the vPC peer-link',(_a,no)=>{
        this.requireFeature('vpc');const v=nsosConfig(this.device).vpc;if(!v)fail('Configure a vPC domain first.');
        if(!/^Port-channel/.test(p.name)||!p.switchport||p.mode!=='trunk')fail('The vPC peer-link must be a Layer 2 trunk port-channel.');
        if(f.vpcId)fail('A vPC member cannot also be the peer-link.');
        if(no){if(v!.peerLink===p.name)delete v!.peerLink;}else{if(v!.peerLink&&v!.peerLink!==p.name)fail('Only one peer-link may be configured.');v!.peerLink=p.name;f.stpPortType='network';f.portfast=false;}
      },{no:'vpc peer-link'}),
      cmd('vpc orphan-port suspend','Suspend orphan port upon peer-link failure',(_a,no)=>{
        this.requireFeature('vpc');if(!p.switchport||f.channelGroup||f.vpcId||nsosConfig(this.device).vpc?.peerLink===p.name)fail('An orphan port must be a non-vPC Layer 2 interface; configure port-channel suspension on the logical interface.');f.vpcOrphanSuspend=!no;
      },{no:'vpc orphan-port suspend'}),
    ];
  }
  private area(text:string):string{
    if(isIPv4(text))return String(text.split('.').reduce((n,x)=>(n*256+Number(x))>>>0,0));
    return String(integer(text,0,4294967295));
  }
  private vpcCommands():Command[]{
    const cmd=this.c.bind(this),v=nsosConfig(this.device).vpc!;
    return [
      cmd('role priority <priority>','Set configured vPC role priority',a=>{v.rolePriority=integer(a[0],1,65535);}),
      cmd('system-priority <priority>','Set vPC LACP system priority',a=>{v.systemPriority=integer(a[0],1,65535);}),
      cmd('system-mac <mac>','Set vPC system MAC',a=>{if(!/^(?:[0-9a-f]{4}\.){2}[0-9a-f]{4}$|^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(a[0])||(parseInt(a[0].replace(/[.:]/g,'').slice(0,2),16)&1))fail('Invalid unicast system MAC.');v.systemMac=a[0];}),
      cmd('peer-keepalive destination <destination> <options...>','Configure packet-based peer keepalive',a=>this.keepalive(v,a)),
      cmd('peer-keepalive destination <destination>','Configure packet-based peer keepalive',a=>this.keepalive(v,a)),
      cmd('no peer-keepalive','Remove peer keepalive configuration',()=>{delete v.keepalive;}),
      ...[['peer-switch','peerSwitch'],['peer-gateway','peerGateway'],['ip arp synchronize','arpSynchronize'],['graceful consistency-check','gracefulConsistency']].map(([syntax,key])=>cmd(syntax,'Configure vPC '+syntax,(_a,no)=>{(v as any)[key]=!no;},{no:syntax})),
      cmd('auto-recovery','Enable timed vPC auto recovery',(_a,no)=>{v.autoRecovery=!no;},{no:'auto-recovery'}),
      cmd('auto-recovery reload-delay <seconds>','Set auto recovery reload delay',a=>{v.reloadDelay=integer(a[0],240,3600)*1000;v.autoRecovery=true;}),
      cmd('delay restore <seconds>','Set vPC restoration delay',a=>{v.delayRestore=integer(a[0],0,3600)*1000;}),
      cmd('delay restore interface-vlan <seconds>','Set SVI restoration delay',a=>{v.delayRestoreSVI=integer(a[0],0,3600)*1000;}),
    ];
  }
  private keepalive(v:VPCConfig,a:string[]):void{
    const old=v.keepalive,k={destination:ip4(a[0]),source:old?.source,vrf:old?.vrf||'management',interval:old?.interval??1000,timeout:old?.timeout??5000,holdTimeout:old?.holdTimeout??3000},seen=new Set<string>();
    for(let i=1;i<a.length;i+=2){
      const option=a[i],value=a[i+1];if(!value||seen.has(option))fail('Incomplete or duplicate peer-keepalive option.');seen.add(option);
      if(option==='source')k.source=ip4(value);
      else if(option==='vrf'){if(value!=='default'&&!this.device.config.features.vrfs?.[value])fail('Keepalive VRF does not exist.');k.vrf=value;}
      else if(option==='interval')k.interval=integer(value,400,10000);
      else if(option==='timeout')k.timeout=integer(value,3,20)*1000;
      else if(option==='hold-timeout')k.holdTimeout=integer(value,3,10)*1000;
      else fail('Unsupported peer-keepalive option: '+option+'.');
    }
    if(seen.has('interval')!==seen.has('timeout'))fail('Incomplete command: interval requires timeout.');
    if(k.timeout<=k.interval)fail('Keepalive timeout must exceed interval.');
    v.keepalive=k;
  }
  private fileName(input:string):string{
    if(!/^(?:bootflash:|flash:)[a-zA-Z0-9_.-]{1,120}$/.test(input))return fail('Use a local bootflash:filename.');
    return input.replace(/^(?:bootflash:|flash:)/,'');
  }
  private readFile(input:string):string{
    const file=ownRecordValue(this.device.config.features.files,this.fileName(input));
    if(typeof file!=='string')fail('File not found.');return file;
  }
  private applyText(text:string):string[]{
    const old=this.context,before=clone(this.device.config);this.context={mode:'config'};
    try{
      for(const line of text.split(/\r?\n/)){
        if(!line.trim()||line.trim().startsWith('!'))continue;
        if(this.context.mode==='priv')fail('Configuration replay cannot execute EXEC commands after leaving configuration mode.');
        const output=this.execute(line.trim());
        if(output.some(iosRejected))fail(`Configuration replay rejected "${line.trim()}": ${output.join(' ')}`);
      }
      return ['Configuration applied.'];
    }catch(error){this.device.config=before;this.engine.changed();throw error;}
    finally{this.context=old;}
  }
  private ping(address:string,vrf?:string,count=5):string[]{
    if(!isIPv4(address)&&!isIPv6(address))fail('A literal IPv4 or IPv6 destination is required.');
    if(vrf&&vrf!=='default'&&!this.device.config.features.vrfs?.[vrf])fail('VRF does not exist.');
    const r=this.engine.ping(this.deviceId,address,{count,vrf:vrf==='default'?undefined:vrf,size:isIPv6(address)?104:84});
    let iterations=0;while(r.status==='running'&&iterations++<600)this.engine.advance(100);
    const replies=r.replies.filter(x=>!x.error),times=replies.map(x=>x.time??0),milliseconds=(n:number)=>String(Number(n.toFixed(3)));
    const output=r.replies.flatMap(x=>{
      if(!x.error)return [`64 bytes from ${x.from}: icmp_seq=${x.sequence-1}${x.ttl===undefined?'':' ttl='+x.ttl} time=${milliseconds(x.time??0)} ms`];
      const detail=!x.from&&/network unreachable|route/i.test(x.error)?[`ping: sendto ${address} 64 chars, No route to host`]:x.error==='Request timed out'?[]:[x.from?`From ${x.from}: ${x.error}`:'ping: '+x.error];
      return [...detail,`Request ${x.sequence-1} timed out`];
    });
    return [`PING ${address} (${address}): 56 data bytes`,...output,'',`--- ${address} ping statistics ---`,`${r.sent} packets transmitted, ${r.received} packets received, ${(100*(r.sent-r.received)/Math.max(1,r.sent)).toFixed(2)}% packet loss`,...(times.length?[`round-trip min/avg/max = ${milliseconds(Math.min(...times))}/${milliseconds(times.reduce((a,b)=>a+b,0)/times.length)}/${milliseconds(Math.max(...times))} ms`]:[])];
  }
  private ssh(destination:string,vrf?:string):string[]{
    const m=/^([^@\s]+)@(.+)$/.exec(destination);if(!m)fail('Use ssh username@address.');
    if(!isIPv4(m![2])&&!isIPv6(m![2]))fail('Use a literal IPv4 or IPv6 SSH destination.');
    if(vrf&&vrf!=='default'&&!this.device.config.features.vrfs?.[vrf])fail('VRF does not exist.');
    return this.transport.openSSH(m![2],m![1],vrf==='default'?undefined:vrf);
  }
  private variants():Variant[]{
    return this.commands().flatMap(command=>[{command,words:command.syntax.split(' '),no:false},...(command.no?[{command,words:['no',...command.no.split(' ')],no:true}]:[])]);
  }
  private synchronizeChannel(before:Device['config'],context:Context):void{
    if(context.mode!=='interface'||!context.name)return;
    const old=before.interfaces[context.name],p=this.device.config.interfaces[context.name];
    if(!old||!p)return;
    const keys=['switchport','mode','vlan','nativeVlan','allowedVlans','mtu','vrf'] as const;
    const fields=keys.filter(key=>JSON.stringify(old[key])!==JSON.stringify(p[key]));
    if(!fields.length)return;
    if(old.features.channelGroup&&old.features.channelGroup===p.features.channelGroup)fail(`Configure shared Layer 2/MTU/VRF settings on Port-channel${p.features.channelGroup}, not on an individual member.`);
    if(!/^Port-channel/.test(p.name))return;
    const id=Number(p.name.slice(12));
    for(const member of Object.values(this.device.config.interfaces).filter(m=>m.features.channelGroup===id)){
      for(const key of fields)(member as any)[key]=clone(p[key]);
      if(fields.includes('switchport')){delete member.ip;delete member.mask;member.ipv6=[];delete member.features.ospf;}
    }
  }
  private match(words:string[],variant:Variant,partial=false):boolean{
    const grammar=variant.words;
    for(let i=0;i<words.length;i++){
      const token=grammar[i];if(!token)return !!grammar.at(-1)&&remainder(grammar.at(-1)!);
      if(remainder(token))return true;
      if(token==='<next-hop>'&&!isIPv4(words[i])&&!isIPv6(words[i]))return false;
      if(token==='<distance>'&&!/^\d+$/.test(words[i]))return false;
      if(token==='<interface>'&&i===grammar.length-1&&!partial&&/^(e|eth|ethernet|po|port-channel|vl|vlan|lo|loopback|mgmt)$/i.test(words[i]))return false;
      if(!wildcard(token)&&!token.toLowerCase().startsWith(words[i].toLowerCase()))return false;
    }
    return partial||grammar.length===words.length||remainder(grammar.at(-1)!)&&words.length>=grammar.length;
  }
  private choices(token:string,words:string[]=[]):string[]{
    if(token==='<feature>')return FEATURES;
    if(token==='<interface>')return Object.keys(this.device.config.interfaces);
    if(token==='<vrf>')return ['default',...Object.keys(this.device.config.features.vrfs||{})];
    if(token==='<ospf-tag>')return [...new Set([this.device.config.protocols.ospf?.nsosTag,...Object.values<any>(this.device.config.protocols.ospf?.vrfs??{}).map(p=>p?.nsosTag)].filter(Boolean))];
    if(token==='<number>'&&words[0]&&'interface'.startsWith(words[0].toLowerCase())){
      const type=words[1]?.toLowerCase(),family=/^(e|eth|ethernet)$/.test(type)?'Ethernet':/^(po|port-channel)$/.test(type)?'Port-channel':/^(vl|vlan)$/.test(type)?'Vlan':/^(lo|loopback)$/.test(type)?'Loopback':type==='mgmt'?'mgmt':undefined;
      if(family)return Object.keys(this.device.config.interfaces).filter(p=>p.startsWith(family)).map(p=>p.slice(family.length));
    }
    if(token==='<speed>')return ['auto',...(['interface','interface-range'].includes(this.context.mode)?this.selected.features.ethernetSpeeds||[]:[]).map(String)];
    return [];
  }
  help(line=''):string[]{
    if(this.remoteConnected)return this.transport.help(line);
    if(this.login)return [];
    const input=line.replace(/\?$/,''),trailing=/\s$/.test(input),words=input.trim().split(/\s+/).filter(Boolean),prefix=trailing?'':words.pop()||'';
    let variants=this.variants();
    if(words[0]&&'show'.startsWith(words[0].toLowerCase())||!words.length&&'show'.startsWith(prefix.toLowerCase())){
      const syntax=this.showSyntax().flatMap(s=>[s,...['include','exclude','begin'].map(filter=>s+' | '+filter+' <expression...>')]);
      const shows=syntax.map(s=>({command:{syntax:s,description:'Display '+s.slice(5),write:false,run:()=>[]},words:s.split(' '),no:false}));
      variants=[...variants.filter(v=>v.words[0]!=='show'),...shows];
    }
    const rows=new Map<string,string>();
    for(const v of variants){
      if(!this.match(words,v,true))continue;
      const token=v.words[words.length];
      if(!token){if(!prefix&&this.match(words,v))rows.set('<CR>','Execute command');continue;}
      const choices=wildcard(token)?this.choices(token,words):[token],values=choices.length?choices:[token];
      for(const value of values)if(wildcard(value)||value.toLowerCase().startsWith(prefix.toLowerCase()))rows.set(value,v.command.description);
      if(remainder(v.words.at(-1)!)&&words.length>=v.words.length&&!prefix)rows.set('<CR>','Execute command');
    }
    return [...rows].sort(([a],[b])=>a.localeCompare(b)).map(([word,description])=>'  '+word.padEnd(25)+' '+description);
  }
  complete(line:string):string{
    if(this.remoteConnected)return this.transport.complete(line);
    const trailing=/\s$/.test(line),parts=line.trim().split(/\s+/).filter(Boolean),last=trailing?'':parts.pop()||'',base=trailing?line:line.slice(0,line.length-last.length);
    const values=this.help(line).map(row=>row.trim().split(/\s+/)[0]).filter(word=>!word.startsWith('<')&&word.toLowerCase().startsWith(last.toLowerCase()));
    if(!values.length)return line;
    let common=values[0];for(const value of values)while(common&&!value.toLowerCase().startsWith(common.toLowerCase()))common=common.slice(0,-1);
    return base+common+(values.length===1?' ':'');
  }
  execute(input:string):string[]{
    this.syncRuntime();
    if(!this.engine.devicePowered(this.deviceId))return ['% Device is powered off.'];
    if(this.busy)return [];
    if(this.remoteConnected)return this.transport.execute(input);
    if(this.login){
      const l=this.login;
      if(l.phase==='username'){l.username=input.trim();l.phase='password';return [];}
      const u=ownRecordValue(this.device.config.features.users,l.username),credential=accountCredential(u);
      if(credential!==undefined&&credential===input){this.username=l.username;this.role=u?.role==='network-admin'?'network-admin':'network-operator';this.login=undefined;return [];}
      l.attempts++;l.phase='username';l.username=undefined;return ['% Login incorrect.'];
    }
    if(this.pendingReload){this.pendingReload=false;if(input.toLowerCase()==='y'||input.toLowerCase()==='yes'){this.engine.reloadIOS(this.deviceId,'NS-OS CLI reload');this.syncRuntime();}return [];}
    if(input.includes('\n'))return input.split(/\r?\n/).flatMap(line=>this.execute(line));
    const line=input.trim();if(!line||line.startsWith('!'))return [];
    if(line.endsWith('?'))return this.help(input.slice(0,-1));
    const words=line.split(/\s+/),before=clone(this.device.config),oldContext=this.context;
    try{
      let variants=this.variants().filter(v=>this.match(words,v));
      if(!variants.length){
        if(this.variants().some(v=>this.match(words,v,true)))return ['% Incomplete command.'];
        const valid=this.variants();let offset=0;
        for(let n=1;n<=words.length;n++){if(!valid.some(v=>this.match(words.slice(0,n),v,true)))break;offset+=words[n-1].length+1;}
        return [' '.repeat(this.prompt.length+Math.min(offset,line.length))+'^',"% Invalid command at '^' marker."];
      }
      const score=(v:Variant)=>v.words.reduce((n,w,i)=>n+(!wildcard(w)?w===words[i]?.toLowerCase()?100:10:0),0);
      const best=Math.max(...variants.map(score));variants=variants.filter(v=>score(v)===best);
      if(variants.length>1)return ['% Ambiguous command.'];
      const v=variants[0];if(v.command.write)this.requireAdmin();
      const args:string[]=[];for(let i=0;i<v.words.length;i++)if(remainder(v.words[i])){args.push(...words.slice(i));break;}else if(wildcard(v.words[i]))args.push(words[i]);
      const out=v.command.run(args,v.no)||[];
      if(v.command.write)this.synchronizeChannel(before,oldContext);
      if(v.command.write||JSON.stringify(before)!==JSON.stringify(this.device.config))this.engine.changed();
      if(!/\b(?:password|secret)\b/i.test(line)){this.history.push(line);if(this.history.length>100)this.history.shift();}
      return out;
    }catch(error){
      this.device.config=before;this.context=oldContext;
      if(error instanceof NSOSError)return [error.message];
      if(error instanceof Error)return ['% '+error.message];
      throw error;
    }
  }
  private showSyntax():string[]{
    return ['show access-lists','show access-lists <name>','show ip access-lists','show ip access-lists <name>','show clock','show logging','show users','show ip interface brief','show ip interface brief vrf <vrf>','show version','show hostname','show inventory','show feature','show running-config','show running-config vpc','show running-config interface <interface>','show startup-config','show user-account','show role','show vrf',
      'show interface','show interface brief','show interface status','show interface trunk','show interface <interface>','show interface <interface> switchport','show port-channel summary','show lacp neighbor',
      'show vpc','show vpc brief','show vpc role','show vpc peer-keepalive','show vpc consistency-parameters global','show vpc consistency-parameters vpc <vpc-id>','show vpc consistency-parameters interface <interface>','show vpc consistency-parameters interface <interface> <number>','show vpc orphan-ports',
      'show vlan','show vlan brief','show spanning-tree','show spanning-tree summary','show spanning-tree pathcost method','show spanning-tree vlan <vlan>','show spanning-tree interface <interface>',
      'show spanning-tree mst configuration','show mac address-table','show ip route','show ip route vrf <vrf>','show ipv6 route','show ipv6 route vrf <vrf>',
      ...['','<ospf-tag> '].flatMap(tag=>['','neighbors','interface','interface <interface>'].flatMap(suffix=>(suffix.includes('<interface>')?['']:['',' vrf <vrf>']).map(vrf=>('show ip ospf '+tag+suffix).trim()+vrf))),
      'show ip arp','show ip arp vrf <vrf>',
      'show lldp neighbors','show lldp neighbors detail','show cdp neighbors','show cdp neighbors detail','show ssh server','show vtp status','show snmp','show archive','show capabilities'];
  }
  private show(args:string[]):string[]{
    const pipe=args.indexOf('|');
    if(pipe>=0){
      const operation=args[pipe+1],pattern=args.slice(pipe+2).join(' ');
      if(!['include','exclude','begin'].includes(operation)||!pattern)fail('Invalid or incomplete output filter.');
      const specification=operation+' '+pattern;
      try{filterIOSOutput([],specification);}catch{fail('Invalid output filter regular expression.');}
      return filterIOSOutput(this.show(args.slice(0,pipe)),specification);
    }
    const input=['show',...args],variants=this.showSyntax().map(s=>({words:s.split(' '),command:{} as Command,no:false})).filter(v=>this.match(input,v));
    if(!variants.length)fail('Invalid or incomplete show command.');
    const score=(v:Variant)=>v.words.reduce((n,word,i)=>n+(wildcard(word)?0:word===input[i]?.toLowerCase()?100:10),0);
    const best=Math.max(...variants.map(score)),choices=variants.filter(v=>score(v)===best);
    if(choices.length!==1)fail('Ambiguous show command.');
    const grammar=choices[0].words,a=grammar.slice(1).map((word,i)=>wildcard(word)?args[i]:word),topic=a.join(' '),d=this.device,c=d.config,f=c.features;
    if(a[0]==='access-lists'||a[0]==='ip'&&a[1]==='access-lists')return nsosACLShow(d,a[a[0]==='ip'?2:1]);
    if(topic==='clock')return nsosClock(d,this.engine.clock.now());
    if(topic==='logging')return nsosLogging(d);
    if(topic==='users')return nsosUsers(this.engine,d,{username:this.username,sessionId:managementFor(this.engine,id=>createCLISession(this.engine,id,{skipConsoleLogin:true})).sessionIdFor(this),localConsole:this.localConsole});
    if(a[0]==='ip'&&a[1]==='interface')return nsosIPBrief(this.engine,d,a[3]==='vrf'?a[4]:undefined);
    if(a[0]==='version')return [platformSoftware(d.kind),'Datacenter Switch — original virtual platform, NX-OS-style teaching subset',`Model number: ${platformIdentity(d.kind).model}`,`Processor board ID ${iosSerial(d)}`,`System image file is "${platformImage(d.kind)}"`,`${c.hostname} uptime is ${iosUptime(this.engine.clock.now()-(d.runtime.features.bootTime||0))}`,'24 Ethernet access-facing ports (10 Gbps); 6 Ethernet uplink ports (40 Gbps); 1 management port (1 Gbps)',`Last reload reason: ${d.runtime.features.reloadReason||'Power-on'}`];
    if(a[0]==='hostname')return [c.hostname];
    if(a[0]==='inventory')return [`NAME: "Chassis", DESCR: "NetSim Datacenter Switch"`,`PID: NS-DC24-6Q, VID: V01, SN: ${iosSerial(d)}`];
    if(a[0]==='capabilities')return ['NS-OS standalone datacenter teaching subset',`Implemented feature gates: ${FEATURES.join(', ')}`,'Operational: Ethernet switching, VLAN/trunk, LACP/static port-channel, rapid-PVST/MST, Bridge Assurance network ports, VRF, IPv4/IPv6/static routing, named OSPFv2, received CDP/LLDP, outbound physical routed IPv4 ip/icmp ACLs with per-entry counters, role-based SSH, read-only SNMPv2c, vPC','Not supported: BGP, HSRP, OSPFv3, EVPN/VXLAN, FEX, ACI, FabricPath, DTP/PAgP, VTP server/client/v3, layer3 peer-router, external AAA/custom RBAC, NX-API/NETCONF/RESTCONF or real cryptography','Only one OSPF instance per VRF is supported; management VRF is not a transit VRF.','ACL limits: explicit sequence numbers; IPv4 ip/icmp; any/host/CIDR addresses; outbound routed physical Ethernet only. Ingress/SVI/port-channel ACLs, TCP/UDP qualifiers, IPv6 ACLs, logging, remarks and time-ranges are not implemented.'];
    if(a[0]==='feature')return ['Feature Name           Instance   State',...FEATURES.map(x=>(x==='ssh'?'sshServer':x).padEnd(23)+'1          '+(nsosFeature(d,x)?'enabled':'disabled')),'Other NX-OS features are not implemented.'];
    if(a[0]==='running-config'||a[0]==='startup-config'){
      this.requireAdmin();const config=a[0]==='startup-config'?d.startupConfig:c;if(!config)return ['Startup configuration is not present.'];
      if(a[1]==='vpc')return nsosVPCConfig(d);const lines=renderNSOSConfig(d,config);if(a[1]==='interface'){const p=this.port(a[2]),index=lines.indexOf('interface '+p.name),end=lines.indexOf(' exit',index);return index<0?[]:lines.slice(index,end+1);}return lines;
    }
    if(a[0]==='user-account')return Object.entries<any>(f.users||{}).flatMap(([username,u])=>[`user:${username}`,`  roles: ${u.role||'network-operator'}`]);
    if(a[0]==='role')return ['Role: network-admin — all implemented read/write operations','Role: network-operator — operational reads; configure terminal permitted; configuration changes and running/startup configuration reads denied'];
    if(a[0]==='vrf')return ['VRF-Name                         State','default                          Up',...Object.keys(f.vrfs||{}).sort().map(v=>v.padEnd(33)+'Up')];
    if(a[0]==='interface')return this.showInterfaces(a.slice(1));
    if(a[0]==='port-channel')return this.showChannels();
    if(a[0]==='lacp'){this.requireFeature('lacp');return formatIOSL2Show(this.engine,d,'lacp',['neighbor'])||[];}
    if(a[0]==='vpc')return (this.requireFeature('vpc'),nsosVPCShow(this.engine,d,a.slice(1)));
    if(a[0]==='vlan')return ['VLAN Name                             Status    Ports',...Object.values(c.vlans).sort((a,b)=>a.id-b.id).map(v=>`${String(v.id).padEnd(5)}${v.name.padEnd(33)}${(v.active?'active':'suspended').padEnd(10)}${Object.values(c.interfaces).filter(p=>p.switchport&&p.mode==='access'&&p.vlan===v.id).map(p=>p.name).join(', ')}`)];
    if(a[0]==='spanning-tree')return this.showSTP(a.slice(1));
    if(a[0]==='mac')return nsosMAC(this.engine,d,this.engine.clock.now());
    if(a[0]==='ip'&&a[1]==='ospf')return this.showOSPF(a.slice(2));
    if(a[0]==='ip'&&a[1]==='arp'){
      const vrf=a[2]==='vrf'?a[3]:undefined;
      return ['Address          MAC Address        Interface',...Object.values(d.runtime.arp).filter(r=>(r.vrf||'default')===(vrf||'default')).map(r=>`${r.ip.padEnd(17)}${r.mac.padEnd(19)}${r.port}`)];
    }
    if((a[0]==='ip'||a[0]==='ipv6')&&a[1]==='route'){
      return nsosRouteTable(this.engine,d,a[0]==='ipv6'?6:4,a[2]==='vrf'?a[3]:undefined);
    }
    if(a[0]==='lldp'||a[0]==='cdp'){
      if(a[0]==='lldp')this.requireFeature('lldp');
      return a[2]==='detail'?nsosDiscovery(this.engine,d,a[0]==='cdp'?'CDP':'LLDP',this.engine.clock.now()):formatIOSShow(this.engine,this.deviceId,a[0]+' neighbors',a.slice(2))||[];
    }
    if(topic==='ssh server')return ['SSH version 2 (logical simulated service)',nsosFeature(d,'ssh')?'SSH server enabled; local role accounts required':'SSH server disabled'];
    if(topic==='vtp status')return [`VTP feature: ${nsosFeature(d,'vtp')?'enabled':'disabled'}`,`VTP Operating Mode: transparent`,`VTP Domain Name: ${f.vtp?.domain||''}`,`VTP Version: ${f.vtp?.version||1}`,'Only transparent VTP version 1/2 is supported.'];
    if(topic==='snmp')return ['Logical read-only SNMPv2c agent',`Configured read-only communities: ${Object.keys(f.snmp?.communities||{}).length}`,`Contact: ${f.snmp?.contact||''}`,`Location: ${f.snmp?.location||''}`,'No BER/USM cryptography or writable MIB is modeled.'];
    if(a[0]==='archive'){this.requireAdmin();return (f.archives||[]).map((x:any)=>`${x.id} ${x.path} ${x.time}`);}
    return fail('Unsupported show command.');
  }
  private showInterfaces(a:string[]):string[]{
    const d=this.device,list=a.length&&!['brief','status','trunk'].includes(a[0])?[this.port(a[0])]:Object.values(d.config.interfaces);
    if(a[1]==='switchport')return list.flatMap(p=>[`Name: ${p.name}`,`Switchport: ${p.switchport?'Enabled':'Disabled'}`,...p.switchport?[`Administrative Mode: ${p.mode}`,`Operational Mode: ${this.engine.interfaceUp(d.id,p.name)?d.runtime.features.trunks?.[p.name]?.operational?'trunk':'access':'down'}`,`Access Mode VLAN: ${p.vlan}`,`Trunking Native Mode VLAN: ${p.nativeVlan}`,`Trunking VLANs Allowed: ${p.allowedVlans===null?'ALL':p.allowedVlans.join(',')||'NONE'}`]:[]]);
    if(a[0]==='brief'||a[0]==='status')return ['Interface       Status         VLAN/VRF        Speed(Mbps) MTU',...list.map(p=>`${p.name.padEnd(16)}${(!p.adminUp?'admin-down':vpcPortReason(d,p.name)?'suspended':this.engine.interfaceUp(d.id,p.name)?'up':'down').padEnd(15)}${(p.switchport?p.mode==='trunk'?'trunk':String(p.vlan):p.vrf||'routed').padEnd(16)}${String(interfaceSpeed(d,p)).padEnd(12)}${vpcInterfaceMTU(d,p)}`)];
    if(a[0]==='trunk')return ['Port             Operational  Native  Allowed VLANs',...list.filter(p=>p.switchport&&p.mode==='trunk').map(p=>`${p.name.padEnd(17)}${(d.runtime.features.trunks?.[p.name]?.operational?'trunking':'down').padEnd(13)}${String(p.nativeVlan).padEnd(8)}${p.allowedVlans?.join(',')??'1-4094'}`)];
    return list.flatMap(p=>nsosInterface(this.engine,d,p));
  }
  private showChannels():string[]{
    const d=this.device;
    return ['Flags: D - Down        P - Up in port-channel (members)',
      '       I - Individual  H - Hot-standby (LACP only)',
      '       s - Suspended   r - Module-removed',
      '       S - Switched    R - Routed',
      '       U - Up (port-channel)',
      '--------------------------------------------------------------------------------',
      'Group Port-       Type     Protocol  Member Ports',
      '      Channel',
      '--------------------------------------------------------------------------------',
      ...Object.values(d.config.interfaces).filter(p=>/^Port-channel/.test(p.name)).sort((a,b)=>Number(a.name.slice(12))-Number(b.name.slice(12))).map(p=>{
        const id=p.name.slice(12),r=d.runtime.features.portChannels?.[id],members=Object.values(d.config.interfaces).filter(m=>String(m.features.channelGroup)===id),suspended=vpcAggregationSuspended(d,p.name),up=this.engine.interfaceUp(d.id,p.name);
        const protocol=r?.protocol??(members.some(m=>m.features.channelMode!=='on')?'LACP':'NONE');
        return id.padEnd(6)+(nsosPort(p.name)+'('+(p.switchport?'S':'R')+(up?'U':'D')+')').padEnd(12)+'Eth'.padEnd(9)+(String(protocol).toUpperCase()==='STATIC'?'NONE':String(protocol).toUpperCase()).padEnd(10)+members.map(m=>nsosPort(m.name)+'('+(!p.adminUp||!m.adminUp||!this.engine.interfaceUp(d.id,m.name)&&!suspended?'D':suspended?'s':r?.activeMembers?.includes(m.name)?'P':r?.state==='suspended'?'s':'I')+')').join(' ');
      })];
  }
  private showSTP(a:string[]):string[]{
    const d=this.device,stp=d.config.features.stp||{},mode=stp.mode||'rapid-pvst',trees=Object.entries(d.runtime.stp);
    if(a[0]==='pathcost')return formatIOSL2Show(this.engine,d,'spanning-tree',a)||[];
    if(a[0]==='mst'){
      const m=stp.mst||{name:'',revision:0,instances:[]};
      return [`MST region name: ${m.name}`,`Revision: ${m.revision}`,'Instance  VLANs',...(m.instances||[]).map((x:any)=>`${String(x.id).padEnd(10)}${x.vlans.join(',')}`)];
    }
    if(a[0]==='summary')return [`Switch is in ${mode} mode`,`Path cost method: ${stp.pathcostMethod||'short'}`,`Active VLAN trees: ${trees.length}`,`Forwarding ports: ${trees.reduce((n,[,t])=>n+Object.values(t.ports).filter(p=>p.state==='forwarding').length,0)}`,`Blocking ports: ${trees.reduce((n,[,t])=>n+Object.values(t.ports).filter(p=>['blocking','discarding'].includes(p.state)).length,0)}`];
    const args=a[0]==='interface'?['interface',this.port(a[1]).name]:a;
    return formatIOSL2Show(this.engine,d,'spanning-tree',args)||[];
  }
  private showOSPF(a:string[],scope?:{vrf:string}):string[]{
    this.requireFeature('ospf');
    const tag=a.length&&!['neighbors','interface','vrf'].includes(a[0])?a.shift():undefined;
    const selectedVRF=scope?.vrf??(a.includes('vrf')?a[a.indexOf('vrf')+1]:a[0]==='interface'&&a[1]?this.port(a[1]).vrf:undefined);
    if(!scope&&a.includes('vrf')&&selectedVRF==='all')return ['default',...Object.keys(this.device.config.features.vrfs??{})].flatMap(vrf=>this.showOSPF([...(tag?[tag]:[]),...a.slice(0,a.indexOf('vrf')),'vrf',vrf],{vrf}));
    const root=this.device.config.protocols.ospf;
    if(tag&&![root?.nsosTag,...Object.values<any>(root?.vrfs??{}).map(p=>p?.nsosTag)].includes(tag))return fail('Invalid OSPF instance tag.');
    if(selectedVRF&&selectedVRF!=='default'&&!this.device.config.features.vrfs?.[selectedVRF])return [];
    const vrf=selectedVRF==='default'?undefined:selectedVRF,p=vrf?root?.vrfs?.[vrf]:root,live=ospfLiveDetail(this.engine,this.deviceId,'ospf',vrf);
    if(tag&&p?.nsosTag!==tag)return [];
    if(!p?.nsosTag)return [];
    if(a[0]==='neighbors'){
      const neighbors=(live?.neighbors||[]).filter(n=>n.state!=='DOWN');
      if(!neighbors.length)return [];
      return [` OSPF Process ID ${p.nsosTag} VRF ${vrf||'default'}`,` Total number of neighbors: ${neighbors.length}`,' Neighbor ID     Pri State            Up Time  Address         Interface',...neighbors.map(n=>{
        const state=n.state+'/'+(n.peerRole==='DR'?'DR':n.peerRole==='BDR'?'BDR':live?.interfaces.find(i=>i.name===n.interface)?.networkType==='point-to-point'?'-':'DROTHER');
        return ' '+n.routerId.padEnd(16)+String(n.priority).padStart(3)+' '+state.padEnd(17)+(n.upSince===undefined?'-':iosDuration(this.engine.clock.now()-n.upSince)).padEnd(9)+n.address.padEnd(16)+nsosPort(n.interface);
      })];
    }
    if(a[0]==='interface'){
      const selected=a[1]&&a[1]!=='vrf'?this.port(a[1]).name:undefined;
      const ports=Object.values(this.device.config.interfaces).filter(i=>i.features.ospf?.area!==undefined&&(i.vrf||'')===(vrf||''));
      return ports.filter(i=>!selected||i.name===selected).flatMap(i=>{
        const up=this.engine.interfaceUp(this.deviceId,i.name),loopback=/^Loopback/.test(i.name),f=i.features.ospf,local=live?.interfaces.find(p=>p.name===i.name),state=this.device.runtime.features.ospfInterfaces?.[i.name];
        const passive=f.passive??(p.passiveInterfaces?.includes(i.name)||p.activeInterfaces?.includes(i.name)?!p.activeInterfaces?.includes(i.name):p.passiveDefault??p.passiveInterfaces?.includes('default')??false);
        const cost=f.cost??(loopback?1:Math.max(1,Math.min(65535,Math.floor((p.referenceBandwidth??40000)/(interfaceBandwidth(this.device,i)/1000))))),neighbors=(live?.neighbors??[]).filter(n=>n.interface===i.name&&n.state!=='DOWN'),full=neighbors.filter(n=>n.state==='FULL');
        const rows=[` ${loopback?i.name.toLowerCase():i.name} is ${up?'up':'down'}, line protocol is ${up?'up':'down'}`,...(i.ip?[`    IP address ${i.ip}/${maskToPrefix(i.mask!)}`]:[]),`    Process ID ${p.nsosTag} VRF ${vrf||'default'}, area ${isIPv4(String(f.area))?f.area:intToIp(Number(f.area))}`,'    Enabled by interface configuration',`    State ${!up?'DOWN':loopback?'LOOPBACK':passive&&i.ip?'DR':state?.role??'DOWN'}, Network type ${loopback?'LOOPBACK':String(f.networkType??'broadcast').toUpperCase()}, cost ${cost}`];
        if(!up||loopback||passive)return [...rows,...passive&&!loopback?['    Passive interface']:[],''];
        rows.push(`    Router Priority ${f.priority??1}`);
        for(const [role,key]of [['Designated','drRouterId'],['Backup Designated','bdrRouterId']] as const){
          const id=state?.[key],address=id===local?.routerId?i.ip:neighbors.find(n=>n.routerId===id)?.address;
          if(id)rows.push(`    ${role} Router ID: ${id}${address?', address: '+address:''}`);
        }
        rows.push(`    ${neighbors.length} Neighbors, flooding to ${full.length}, adjacent with ${full.length}`,`    Timer intervals: Hello ${f.helloInterval??10}, Dead ${f.deadInterval??40}`);
        if(live?.helloDue[i.name]!==undefined)rows.push('      Hello timer due in '+iosDuration(live.helloDue[i.name]));
        rows.push('    No authentication','');return rows;
      });
    }
    return [` Routing Process ${p.nsosTag} with ID ${p.routerId||live?.interfaces?.[0]?.routerId||'0.0.0.0'} VRF ${vrf||'default'}`,` Reference Bandwidth is ${p.referenceBandwidth??40000} Mbps`,...(p.passiveDefault||p.passiveInterfaces?.includes('default')?[' Default Passive Interface is enabled']:[]),` Number of LSAs: ${live?.lsas.length||0}`,` SPF calculation has run ${live?.spfRuns||0} times`];
  }
}
