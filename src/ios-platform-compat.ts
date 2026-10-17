import {isIPv4,parseCidr} from './ip.ts';
import type {Device,DeviceConfig,InterfaceConfig} from './model.ts';
export interface PlatformHost {device:Device;mode:string;now():number;ports():InterfaceConfig[];changed():void;fail(message?:string):never}
export function platformCompatibilityCommands(h:PlatformHost){
 const commands:Array<{words:string[];description:string;args?:string;run(a:string[],no:boolean):string[]|void}>=[],f=h.device.config.features;
 const add=(name:string,run:(a:string[],no:boolean)=>string[]|void,args?:string)=>commands.push({words:name.split(' '),description:'Configure modeled device behavior',run,args});
 const stored=(feature:string)=>[`% ${feature} configuration stored only; this mechanism is not simulated.`];
 const exact=(a:string[],n:number)=>{if(a.length<n)h.fail('% Incomplete command.');if(a.length>n)h.fail();};
 const number=(value:string|undefined,min:number,max:number)=>{if(value===undefined)h.fail('% Incomplete command.');const n=Number(value);if(!/^\d+$/.test(value!)||!Number.isSafeInteger(n)||n<min||n>max)h.fail();return n;};
 const option=(value:string|undefined,choices:string[])=>{if(!value)h.fail('% Incomplete command.');const matches=choices.includes(value!)?[value!]:choices.filter(word=>word.startsWith(value!));if(matches.length!==1)h.fail(matches.length?'% Ambiguous command.':undefined);return matches[0];};
 if(['interface','range'].includes(h.mode)){
  for(const [path,field,min,max]of [['ip tcp adjust-mss','tcpMss',500,1460],['ipv6 nd dad attempts','dadAttempts',0,600],['ipv6 nd reachable-time','ndReachableTime',0,3600000],['ipv6 nd cache expire','ndCacheExpire',1,65535]] as const)add(path,(a,no)=>{exact(a,no?0:1);const value=no?undefined:number(a[0],min,max);for(const port of h.ports()){if(no)delete port.features[field];else port.features[field]=value;}h.changed();},`<${min}-${max}>`);
  add('ip verify unicast source reachable-via',(a,no)=>{if(no){if(a.length>3)h.fail();for(const port of h.ports())delete port.features.urpf;}else{if(!a.length)h.fail('% Incomplete command.');const mode=option(a[0],['any','rx']);let allowDefault=false,acl:string|undefined;for(const word of a.slice(1)){if(word==='allow-default')allowDefault=true;else if(/^\d+$/.test(word)&&!acl)acl=word;else h.fail();}for(const port of h.ports()){if(port.switchport)h.fail('% uRPF requires a routed interface.');port.features.urpf={mode,allowDefault,acl};}}h.changed();},'any|rx [allow-default] [ACL]');
  add('ip dhcp relay information trusted',(a,no)=>{exact(a,0);for(const port of h.ports())port.features.dhcpRelayTrusted=!no;h.changed();});
  add('ip local-proxy-arp',(a,no)=>{exact(a,0);for(const port of h.ports())port.features.localProxyArp=!no;h.changed();});
  add('mac-address',(a,no)=>{exact(a,no?0:1);const value=no?'':a[0].replace(/[:.\-]/g,'').toLowerCase();if(!no&&(!/^[a-f0-9]{12}$/.test(value)||(parseInt(value.slice(0,2),16)&1)||/^0+$/.test(value)))h.fail('% Invalid unicast MAC address.');for(const port of h.ports()){if(no)delete port.features.macAddress;else port.features.macAddress=value.match(/../g)!.join(':');}h.changed();},'<MAC-address>');
  add('media-type',(a,no)=>{exact(a,no?0:1);const value=no?undefined:option(a[0],['rj45','sfp','auto-select']);for(const port of h.ports())port.features.mediaType=value;h.changed();return [];},'rj45|sfp|auto-select');
  add('keepalive',(a,no)=>{if(a.length>2)h.fail();const seconds=no?0:a.length?number(a[0],0,32767):10,retries=a[1]?number(a[1],1,255):3;for(const port of h.ports())port.features.keepalive={seconds,retries};h.changed();return ['% Ethernet keepalive configuration stored only; physical loopback signaling is not simulated.'];},'[seconds] [retries]');
 }
 if(h.mode==='config'){
  add('config-register',(a,no)=>{exact(a,no?0:1);if(!['router','l3switch'].includes(h.device.kind))h.fail('% Configuration register is not available on this device.');if(!no&&!/^0x[0-9a-f]{1,4}$/i.test(a[0]))h.fail();const register=h.device.configurationRegister??={current:0x2102,next:0x2102};register.next=no?0x2102:parseInt(a[0].slice(2),16);h.changed();if((register.next&~0x40)!==0x2102)return ['% Only the ignore-startup-configuration bit affects simulated boot; other hardware boot flags are stored only.'];},'<0x0-0xFFFF>');
  add('ip dhcp relay information trust-all',(a,no)=>{exact(a,0);f.dhcpRelayTrustAll=!no;h.changed();});
  add('ip domain name',(a,no)=>{exact(a,no?0:1);f.domainName=no?undefined:a[0];h.changed();},'<name>');
  add('ip domain lookup',(a,no)=>{exact(a,0);f.domainLookup=!no;h.changed();});
  for(const [path,field,min,max,value]of [['time-out','timeout',1,120,120],['authentication-retries','retries',0,5,3]]as const)add('ip ssh '+path,(a,no)=>{exact(a,no?0:1);f.ssh??={};f.ssh[field]=no?value:number(a[0],min,max);h.changed();},`<${min}-${max}>`);
  for(const side of ['server','client'])add('ip ssh '+side+' algorithm encryption',(a,no)=>{if(no)exact(a,0);else if(!a.length)h.fail('% Incomplete command.');const values=a.map(v=>option(v,['aes128-ctr','aes192-ctr','aes256-ctr','aes128-cbc','aes192-cbc','aes256-cbc','3des-cbc','aes128-gcm','aes256-gcm','chacha20-poly1305']));f.ssh??={};f.ssh[side+'Algorithms']=no?undefined:values;h.changed();return stored('SSH cipher selection');},'<algorithms>');
  for(const [path,field,defaultPort]of [['port','port',80],['secure-port','securePort',443]]as const)add('ip http '+path,(a,no)=>{exact(a,no?0:1);h.device.config.services.http??={};h.device.config.services.http[field]=no?defaultPort:number(a[0],1,65535);h.changed();},'<1-65535>');
  add('ip http secure-server',(a,no)=>{exact(a,0);h.device.config.services.http??={};h.device.config.services.http.secureEnabled=!no;h.changed();return ['HTTPS endpoint modeled over simulated TCP; TLS encryption is not implemented.'];});
  add('ip http access-class',(a,no)=>{if(a[0]==='ipv4')a=a.slice(1);exact(a,no?0:1);const acl=no?undefined:a[0];if(acl&&f.acls?.[acl]?.type==='extended')h.fail('% HTTP access-class requires a standard IPv4 access list.');h.device.config.services.http??={};h.device.config.services.http.acl=acl;h.changed();},'[ipv4] <ACL>');
  for(const [path,key]of [['ip scp server enable','scp'],['netconf-yang','netconf'],['netconf-yang feature candidate-datastore','candidate'],['restconf','restconf']]){
   if(key!=='scp'&&!['router','switch','l3switch','poeswitch','wlc'].includes(h.device.kind))continue;
   add(path,(a,no)=>{exact(a,0);f.managementSettings??={};f.managementSettings[key]=!no;h.changed();return key==='scp'?['SCP file service uses simulated SSH/TCP; cryptographic encryption is not emulated.']:key==='restconf'?['RESTCONF uses the modeled HTTPS datastore and requires a privilege-15 account. Only the documented YANG subset is supported.']:key==='candidate'?['NETCONF candidate locks, commit/discard and confirmed rollback use the simulation clock. Existing sessions restart after datastore-mode changes.']:['NETCONF uses persistent simulated TCP/830 with logical SSH authentication. Only the documented YANG/RPC subset is supported.'];});
  }
  add('boot system',(a,no)=>{if(!no&&!a.length)h.fail('% Incomplete command.');if(a.length>4)h.fail();f.bootSystems=no?[]:[...(f.bootSystems??[]).filter((s:string)=>s!==a.join(' ')),a.join(' ')];h.changed();return stored('Boot image selection');},'<image specification>');
  add('ipv6 general-prefix',(a,no)=>{exact(a,no?1:2);f.ipv6GeneralPrefixes??={};if(no)delete f.ipv6GeneralPrefixes[a[0]];else{let cidr;try{cidr=parseCidr(a[1]);}catch{h.fail();}if(cidr!.family!==6||!a[1].includes('/'))h.fail();f.ipv6GeneralPrefixes[a[0]]={network:cidr!.network,prefix:cidr!.prefix};}h.changed();},'<name> <IPv6-prefix/length>');
  add('ip nat outside source',(a,no)=>{const kind=option(a[0],['static','list']);f.nat??={static:[],pools:{},rules:[]};if(kind==='static'){if(a.length<3)h.fail('% Incomplete command.');if(a.length>4||!isIPv4(a[1])||!isIPv4(a[2]))h.fail();if(a[3])option(a[3],['add-route']);f.nat.outsideStatic=(f.nat.outsideStatic??[]).filter((r:any)=>r.global!==a[1]||r.local!==a[2]);if(!no)f.nat.outsideStatic.push({global:a[1],local:a[2],addRoute:!!a[3]});}else{exact(a,4);option(a[2],['pool']);f.nat.outsideRules=(f.nat.outsideRules??[]).filter((r:any)=>r.acl!==a[1]);if(!no)f.nat.outsideRules.push({acl:a[1],pool:a[3]});}h.changed();return stored('Outside-source NAT');},'static <outside-global> <outside-local> [add-route]|list <ACL> pool <name>');

  add('ip local policy route-map',(a,no)=>{exact(a,no?0:1);f.localPolicy=no?undefined:a[0];h.changed();},'<route-map>');
  add('ip flow-export version',(a,no)=>{exact(a,no?0:1);f.netflow??={};f.netflow.version=no?9:number(a[0],1,9);if(![1,5,9].includes(f.netflow.version))h.fail();h.changed();},'1|5|9');
  add('ip flow-cache timeout',(a,no)=>{const kind=option(a[0],['active','inactive']);exact(a,no?1:2);f.netflow??={};if(no)delete f.netflow[kind+'Timeout'];else f.netflow[kind+'Timeout']=number(a[1],kind==='active'?1:10,kind==='active'?60:600);h.changed();},'active|inactive <interval>');
  add('security passwords min-length',(a,no)=>{exact(a,no?0:1);f.passwordMinLength=no?0:number(a[0],0,16);h.changed();},'<0-16>');
  add('login block-for',(a,no)=>{if(no){exact(a,0);delete f.loginBlock;}else{exact(a,5);option(a[1],['attempts']);option(a[3],['within']);f.loginBlock={seconds:number(a[0],1,65535),attempts:number(a[2],1,65535),within:number(a[4],1,65535)};}h.changed();},'<seconds> attempts <count> within <seconds>');
  add('bfd slow-timers',(a,no)=>{exact(a,no?0:1);f.bfdSlowTimers=no?1000:number(a[0],1000,30000);h.changed();},'<1000-30000>');
 }
 if(['priv','user'].includes(h.mode)){add('show ipv6 general-prefix',a=>{exact(a,0);return Object.entries<any>(f.ipv6GeneralPrefixes??{}).flatMap(([name,c])=>[`IPv6 Prefix ${name}, acquired via Manual`,`${c.network}/${c.prefix}`]);});add('show bootvar',a=>{exact(a,0);return ['BOOT variable = '+(f.bootSystems??[]).join(';'),'Boot image execution is not simulated.'];});}
 if(['priv','user'].includes(h.mode))add('show login',a=>{if(a.length>1)h.fail();if(a[0])option(a[0],['failures']);const setting=f.loginBlock,r=h.device.runtime.features.loginProtection||{};if(a[0])return ['Username              Source              Time',...(r.failures||[]).map((row:any)=>`${String(row.username||'').padEnd(22)}${String(row.source).padEnd(20)}${row.time} ms`)];return [setting?`If ${setting.attempts} login attempts fail within ${setting.within} seconds, block logins for ${setting.seconds} seconds.`:'No login quiet-mode configuration.',`Router presently in ${loginBlocked(h.device,h.now())?'Quiet-Mode. Remaining time: '+Math.ceil((r.blockedUntil-h.now())/1000)+' seconds':'Normal-Mode.'}`];},'[failures]');
 return commands;
}
/** Only newly changed console/EXEC credentials are subject to the password policy. */
export function passwordChangeError(before:DeviceConfig,after:DeviceConfig):string|undefined{
 const min=before.features.passwordMinLength||0;if(!min)return;const values:Array<[unknown,unknown]>=[];
 for(const key of ['enableSecret','enablePassword'])values.push([before.features[key],after.features[key]]);
 for(const [name,user]of Object.entries<any>(after.features.users||{}))for(const key of ['secret','password'])values.push([before.features.users?.[name]?.[key],user[key]]);
 for(const [name,line]of Object.entries<any>(after.features.lines||{}))values.push([before.features.lines?.[name]?.password,line.password]);
 if(values.some(([previous,next])=>next!==undefined&&next!==previous&&String(next).length<min))return `% Password must contain at least ${min} characters.`;
}
export function loginBlocked(device:Device,now:number):boolean{return (device.runtime.features.loginProtection?.blockedUntil??0)>now;}
export function recordLoginFailure(device:Device,now:number,source:string,username?:string):void{
 const setting=device.config.features.loginBlock;if(!setting)return;const state=device.runtime.features.loginProtection??={failures:[]};state.failures=(state.failures||[]).filter((row:any)=>now-row.time<=setting.within*1000);state.failures.push({time:now,source,username});if(state.failures.length>=setting.attempts){state.blockedUntil=now+setting.seconds*1000;state.failures=state.failures.slice(-setting.attempts);}
}
export function renderPlatformInterface(port:InterfaceConfig):string[]{
 const out:string[]=[],f=port.features;
 for(const [field,path]of [['tcpMss','ip tcp adjust-mss'],['dadAttempts','ipv6 nd dad attempts'],['ndReachableTime','ipv6 nd reachable-time'],['ndCacheExpire','ipv6 nd cache expire'],['macAddress','mac-address']])if(f[field]!==undefined)out.push(` ${path} ${field==='macAddress'?f[field].replace(/:/g,'').match(/.{4}/g).join('.'):f[field]}`);
 if(f.urpf)out.push(` ip verify unicast source reachable-via ${f.urpf.mode}${f.urpf.allowDefault?' allow-default':''}${f.urpf.acl?' '+f.urpf.acl:''}`);if(f.dhcpRelayTrusted)out.push(' ip dhcp relay information trusted');
 if(f.mediaType)out.push(' media-type '+f.mediaType);
 if(f.localProxyArp)out.push(' ip local-proxy-arp');if(f.keepalive)out.push(f.keepalive.seconds===0?' no keepalive':` keepalive ${f.keepalive.seconds} ${f.keepalive.retries}`);return out;
}
export function renderPlatformGlobal(config:DeviceConfig):string[]{
 const f=config.features,out:string[]=[];
 if(f.dhcpRelayTrustAll)out.push('ip dhcp relay information trust-all');
 for(const [path,key]of [['ip scp server enable','scp'],['netconf-yang','netconf'],['netconf-yang feature candidate-datastore','candidate'],['restconf','restconf']])if(f.managementSettings?.[key])out.push(path);
 for(const image of f.bootSystems??[])out.push('boot system '+image);
 for(const [field,path]of [['timeout','time-out'],['retries','authentication-retries']])if(f.ssh?.[field]!==undefined)out.push('ip ssh '+path+' '+f.ssh[field]);for(const side of ['server','client'])if(f.ssh?.[side+'Algorithms'])out.push('ip ssh '+side+' algorithm encryption '+f.ssh[side+'Algorithms'].join(' '));
 const http=config.services.http??{};if(http.secureEnabled)out.push('ip http secure-server');if(http.port!==undefined)out.push('ip http port '+http.port);if(http.securePort!==undefined)out.push('ip http secure-port '+http.securePort);if(http.acl)out.push('ip http access-class '+http.acl);
 for(const r of f.nat?.outsideStatic??[])out.push(`ip nat outside source static ${r.global} ${r.local}${r.addRoute?' add-route':''}`);for(const r of f.nat?.outsideRules??[])out.push(`ip nat outside source list ${r.acl} pool ${r.pool}`);
 if(f.localPolicy)out.push('ip local policy route-map '+f.localPolicy);if(f.netflow?.version!==undefined)out.push('ip flow-export version '+f.netflow.version);for(const kind of ['active','inactive'])if(f.netflow?.[kind+'Timeout']!==undefined)out.push(`ip flow-cache timeout ${kind} ${f.netflow[kind+'Timeout']}`);
 if(f.passwordMinLength!==undefined)out.push('security passwords min-length '+f.passwordMinLength);if(f.loginBlock)out.push(`login block-for ${f.loginBlock.seconds} attempts ${f.loginBlock.attempts} within ${f.loginBlock.within}`);if(f.bfdSlowTimers!==undefined)out.push('bfd slow-timers '+f.bfdSlowTimers);return out;
}
