import type {Device, InterfaceConfig} from './model.ts';
import type {Simulator, Frame} from './engine.ts';
import {disableInterface} from './ios-errdisable.ts';

export const secureMac = (mac:string):string => mac.replace(/[^0-9a-f]/gi,'').toLowerCase();
export const secureDotted = (mac:string):string => secureMac(mac).match(/.{4}/g)?.join('.')??mac;
const colon = (mac:string):string => secureMac(mac).match(/../g)!.join(':');
export function securityConfig(p:InterfaceConfig):any {
  const c=p.features.portSecurity??={enabled:false,maximum:1,violation:'shutdown',sticky:false,macs:[],stickyMacs:[]};
  // Older documents stored learned sticky and static addresses in one list.
  if(c.stickyMacs===undefined){c.stickyMacs=c.sticky?[...(c.macs??[])]:[];if(c.sticky)c.macs=[];}
  c.macs??=[];c.sticky??=false;return c;
}
export function securityEnabled(d:Device,p:InterfaceConfig):boolean {
  return !!p.switchport&&!!p.features.portSecurity&&p.features.portSecurity.enabled!==false&&(d.kind!=='datacenter'||d.config.features.nsos?.enabled?.includes('port-security'));
}
export function secureEntries(d:Device,p:InterfaceConfig):{mac:string;type:string;vlan:number}[]{
  const c=p.features.portSecurity;if(!c)return [];
  const legacy=c.stickyMacs===undefined&&c.sticky,seen=new Set<string>(),out:{mac:string;type:string;vlan:number}[]=[];
  for(const [macs,type] of [[legacy?[]:c.macs??[],'SecureConfigured'],[legacy?c.macs??[]:c.stickyMacs??[],'SecureSticky'],[d.runtime.features.secureMacs?.[p.name]??[],'SecureDynamic']] as [string[],string][])
    for(const raw of macs){const mac=secureMac(raw);if(seen.has(mac))continue;seen.add(mac);out.push({mac,type,vlan:d.runtime.features.secureMacVlans?.[p.name+'|'+mac]??p.vlan??1});}
  return out;
}
export function setSticky(d:Device,p:InterfaceConfig,enabled:boolean):void {
  const c=securityConfig(p),dynamic:string[]=d.runtime.features.secureMacs?.[p.name]??[];
  if(enabled){c.stickyMacs=[...new Set([...c.stickyMacs,...dynamic].map(colon))];if(d.runtime.features.secureMacs)delete d.runtime.features.secureMacs[p.name];}
  else{(d.runtime.features.secureMacs??={})[p.name]=[...new Set([...dynamic,...c.stickyMacs].map(colon))];c.stickyMacs=[];}
  c.sticky=enabled;
  if(d.kind==='datacenter'){d.secureSticky??={};if(enabled)d.secureSticky[p.name]=[...c.stickyMacs];else delete d.secureSticky[p.name];}
}
function forget(d:Device,p:InterfaceConfig,mac?:string):void {
  const state=d.runtime.features;
  if(state.secureMacs?.[p.name])state.secureMacs[p.name]=mac?state.secureMacs[p.name].filter((m:string)=>secureMac(m)!==mac):[];
  for(const key of Object.keys(state.secureMacTimes??{}))if(key.startsWith(p.name+'|')&&(!mac||key===p.name+'|'+mac))delete state.secureMacTimes[key];
  for(const [key,row] of Object.entries(d.runtime.mac))if(row.port===p.name&&row.secure&&(!mac||secureMac(row.mac)===mac))delete d.runtime.mac[key];
}
/** Secure dynamic learning follows carrier state; sticky/static bindings survive link loss. */
export function reconcilePortSecurity(e:Simulator,d:Device):void {
  for(const [key,row] of Object.entries(d.runtime.mac))if(row.secure&&(!d.config.interfaces[row.port]||!securityEnabled(d,d.config.interfaces[row.port])||!e.interfaceUp(d.id,row.port)))delete d.runtime.mac[key];
  for(const port of Object.keys(d.runtime.features.secureMacs??{}))if(!d.config.interfaces[port])delete d.runtime.features.secureMacs[port];
  for(const p of Object.values(d.config.interfaces)){
    if(!p.features.portSecurity){forget(d,p);if(d.secureSticky)delete d.secureSticky[p.name];for(const field of ['portSecurityPortViolations','portSecurityLastSource','portSecurityRejected','portSecurityLogAt','portSecurityNotified'])delete d.runtime.features[field]?.[p.name];for(const key of Object.keys(d.runtime.features.secureMacVlans??{}))if(key.startsWith(p.name+'|'))delete d.runtime.features.secureMacVlans[key];continue;}
    if(d.kind==='datacenter'&&p.features.portSecurity.sticky){const c=securityConfig(p);c.stickyMacs=[...new Set([...c.stickyMacs,...d.secureSticky?.[p.name]??[]].map(colon))];(d.secureSticky??={})[p.name]=[...c.stickyMacs];}
    if(!securityEnabled(d,p)||!e.interfaceUp(d.id,p.name)){delete d.runtime.features.portSecurityNotified?.[p.name];forget(d,p);continue;}
    const allowed=new Set<string>();
    for(const row of secureEntries(d,p)){
      const mac=colon(row.mac),key=row.vlan+'|'+mac;allowed.add(key);
      d.runtime.mac[key]={mac,port:p.name,vlan:row.vlan,expires:Number.MAX_SAFE_INTEGER,static:true,secure:true};
    }
    for(const [key,row] of Object.entries(d.runtime.mac))if(row.secure&&row.port===p.name&&!allowed.has(key))delete d.runtime.mac[key];
  }
}
export function inspectPortSecurity(e:Simulator,d:Device,p:InterfaceConfig,vlan:number,f:Frame):boolean {
  if(!securityEnabled(d,p))return true;
  const c=securityConfig(p),state=d.runtime.features,mac=secureMac(f.sourceMac),key=p.name+'|'+mac;
  if(!/^[0-9a-f]{12}$/.test(mac)||(parseInt(mac.slice(0,2),16)&1)||/^0{12}$/.test(mac)){e.emit({nodeId:d.id,port:p.name,protocol:'ETHERNET',label:'Invalid Ethernet source',detail:'The source must be a nonzero unicast MAC address.',disposition:'drop'});return false;}
  const entries=secureEntries(d,p),moved=Object.values(d.config.interfaces).some(other=>other!==p&&securityEnabled(d,other)&&secureEntries(d,other).some(x=>x.mac===mac&&x.vlan===vlan));
  const known=entries.some(x=>x.mac===mac);
  (state.portSecurityLastSource??={})[p.name]={mac:f.sourceMac,vlan};
  if(moved||!known&&entries.length>=(c.maximum??1)){
    const nx=d.kind==='datacenter',mode=moved&&nx?'shutdown':c.violation??'shutdown';
    const rejected: string[]=(state.portSecurityRejected??={})[p.name]??=[];
    if(mode!=='protect'&&(!nx||!rejected.includes(mac))){
      (state.portSecurityPortViolations??={})[p.name]=(state.portSecurityPortViolations[p.name]??0)+1;
      if(nx)rejected.push(mac);
    }
    if(mode!=='protect'||nx){
      // IOS counts rejected frames; NX-OS counts distinct rejected source addresses.
      const logs=state.portSecurityLogAt??={},notified=(state.portSecurityNotified??={})[p.name]??={},notificationKey=mode+'|'+mac;
      if((!nx||!notified[notificationKey])&&(mode==='shutdown'||e.clock.now()-(logs[p.name]??-Infinity)>=1000)){
        if(nx)notified[notificationKey]=true;
        logs[p.name]=e.clock.now();
        e.log(d.id,nx?`%DAEMON-2-SYSTEM_MSG: <<%ETH-PORT-SEC-2-ETH_PORT_SEC_SECURITY_MAX_ADDR_COUNT_VIOLATION>> Triggered max address count violation ${mode.toUpperCase()} on port ${p.name} - eth_port_sec`:`%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${secureDotted(mac)} on port ${p.name}.`,2);
      }
    }
    if(mode==='shutdown'&&disableInterface(e,d,p.name,'psecure-violation')){
      e.log(d.id,`%PM-4-ERR_DISABLE: psecure-violation error detected on ${p.name.replace('GigabitEthernet','Gi').replace('Ethernet','Eth')}, putting ${p.name.replace('GigabitEthernet','Gi').replace('Ethernet','Eth')} in err-disable state`,4);e.changed();
    }
    state.portSecurityViolations=(state.portSecurityViolations??0)+1;
    e.emit({nodeId:d.id,port:p.name,protocol:'ETHERNET',label:moved?'Secure MAC move violation':'Port security violation',detail:moved?'This source MAC belongs to a different secure port in the same VLAN.':'The secure MAC limit was exceeded on '+p.name+'.',disposition:'drop'});return false;
  }
  if(!known){
    if(c.sticky){c.stickyMacs.push(colon(mac));if(d.kind==='datacenter')(d.secureSticky??={})[p.name]=[...c.stickyMacs];}else(state.secureMacs??={})[p.name]=[...(state.secureMacs?.[p.name]??[]),colon(mac)];
    (state.secureMacVlans??={})[key]=vlan;
  }
  const times=state.secureMacTimes??={},row=times[key]??={first:e.clock.now(),last:e.clock.now()};row.last=e.clock.now();
  const ageable=()=>!c.stickyMacs.some((m:string)=>secureMac(m)===mac)&&(!c.macs.some((m:string)=>secureMac(m)===mac)||c.agingStatic);
  if(Number(c.agingTime)>0&&!row.scheduled&&ageable()){
    row.scheduled=true;
    const expire=()=>{
      if(d.runtime.features!==state||times[key]!==row)return;
      const current=d.config.interfaces[p.name],config=current?.features.portSecurity;
      if(!current||!securityEnabled(d,current)||!(Number(config?.agingTime)>0)||!secureEntries(d,current).some(x=>x.mac===mac&&x.type!=='SecureSticky'&&(x.type!=='SecureConfigured'||config.agingStatic))){row.scheduled=false;return;}
      const due=(config.agingType==='inactivity'?row.last:row.first)+Number(config.agingTime)*60000;
      if(due>e.clock.now()){e.clock.schedule(due-e.clock.now(),expire,{owner:d.id,label:'Secure MAC aging'});return;}
      forget(d,current,mac);if(config.agingStatic)config.macs=config.macs.filter((m:string)=>secureMac(m)!==mac);
      e.emit({nodeId:d.id,port:p.name,protocol:'ETHERNET',label:'Secure MAC aged out',detail:f.sourceMac,disposition:'info'});
    };
    e.clock.schedule(Number(c.agingTime)*60000,expire,{owner:d.id,label:'Secure MAC aging'});
  }
  const address=colon(mac);d.runtime.mac[vlan+'|'+address]={mac:address,port:p.name,vlan,expires:Number.MAX_SAFE_INTEGER,static:true,secure:true};return true;
}
export function renderPortSecurity(p:InterfaceConfig,nxos=false):string[]{
  const c=p.features.portSecurity;if(!c)return [];
  const a:string[]=[];
  if(c.maximum!==undefined&&c.maximum!==1)a.push(' switchport port-security maximum '+c.maximum);
  if(c.violation&&c.violation!=='shutdown')a.push(' switchport port-security violation '+c.violation);
  if(c.agingTime)a.push(' switchport port-security aging time '+c.agingTime);
  if(c.agingType&&c.agingType!=='absolute')a.push(' switchport port-security aging type '+c.agingType);
  if(c.agingStatic&&!nxos)a.push(' switchport port-security aging static');
  if(c.sticky)a.push(' switchport port-security mac-address sticky');
  const legacy=c.stickyMacs===undefined&&c.sticky;
  for(const mac of legacy?[]:c.macs??[])a.push(' switchport port-security mac-address '+secureDotted(mac));
  if(!nxos)for(const mac of legacy?c.macs??[]:c.stickyMacs??[])a.push(' switchport port-security mac-address sticky '+secureDotted(mac));
  if(c.enabled!==false)a.push(' switchport port-security');return a;
}

export function validatePortSecurity(p:InterfaceConfig):void {
 const c=p.features.portSecurity;if(c===undefined)return;
 const invalid=()=>{throw Error('Invalid port-security configuration on '+p.name+'.');};
 if(!c||typeof c!=='object'||Array.isArray(c))invalid();
 for(const key of ['enabled','sticky','agingStatic'])if(c[key]!==undefined&&typeof c[key]!=='boolean')invalid();
 if(c.maximum!==undefined&&(!Number.isInteger(c.maximum)||c.maximum<1||c.maximum>1025))invalid();
 if(c.violation!==undefined&&!['protect','restrict','shutdown'].includes(c.violation))invalid();
 if(c.agingTime!==undefined&&(!Number.isInteger(c.agingTime)||c.agingTime<0||c.agingTime>1440))invalid();
 if(c.agingType!==undefined&&!['absolute','inactivity'].includes(c.agingType))invalid();
 for(const key of ['macs','stickyMacs'])if(c[key]!==undefined&&(!Array.isArray(c[key])||c[key].length>1025||c[key].some((m:unknown)=>typeof m!=='string'||!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$|^[0-9a-f]{4}(\.[0-9a-f]{4}){2}$/i.test(m))))invalid();
}

/** NX-OS 10.6 has its own table and labels, including the native spelling of Opertional. */
export function nsosPortSecurity(e:Simulator,d:Device,port?:InterfaceConfig,address=false):string[]{
 const secured=Object.values(d.config.interfaces).filter(p=>securityEnabled(d,p)),extra=secured.reduce((n,p)=>n+Math.max(0,secureEntries(d,p).length-1),0);
 const totals=['',`Total Secured Mac Addresses in System (excluding one mac per port)     : ${extra}`,`Max Addresses limit in System (excluding one mac per port) : ${8192-extra}`,''];
 const title=(mode:string)=>mode[0].toUpperCase()+mode.slice(1);
 if(address){const rows=(port?[port]:secured).flatMap(p=>secureEntries(d,p).map(x=>String(x.vlan).padStart(4)+'   '+secureDotted(x.mac)+'   '+({SecureConfigured:'STATIC',SecureSticky:'STICKY',SecureDynamic:'DYNAMIC'}[x.type]??'DYNAMIC').padStart(7)+'  0          No       No     '+p.name+'   '));
  if(!rows.length)return [];
  return [...port?[]:totals,'-'.repeat(70),'                    Secure Mac Address Table','-'.repeat(70),'Vlan    Mac Address    Type      Remaining  Remotely Remotely Ports','                                 age        learnt   aged','                                 (mins)              out','----    -----------   ------     ------     -------  -----    ----',...rows,...port?['-'.repeat(70)]:[]];
 }
 if(port&&!securityEnabled(d,port))return ['ERROR: error: Port security is not enabled'];
 if(port){const c=port.features.portSecurity??{},enabled=securityEnabled(d,port),rows=secureEntries(d,port),label=(s:string)=>s.padEnd(27)+': ';
  return [label('Configured Port Security')+(c.enabled!==false&&port.features.portSecurity?'Enabled':'Disabled'),label('Opertional Port Security')+(enabled?'Enabled':'Disabled'),label('Port Status')+(port.features.errDisabled?'Secure-shutdown':enabled&&e.interfaceUp(d.id,port.name)?'Secure UP':'Secure DOWN'),label('Violation Mode')+title(c.violation??'shutdown'),label('Aging Time')+(c.agingTime??0)+' mins',label('Aging Type')+title(c.agingType??'absolute'),label('Maximum MAC Addresses')+(c.maximum??1),label('Total MAC Addresses')+rows.length,label('Configured MAC Addresses')+rows.filter(x=>x.type==='SecureConfigured').length,label('Sticky MAC Addresses')+rows.filter(x=>x.type==='SecureSticky').length,label('Security violation count')+(d.runtime.features.portSecurityPortViolations?.[port.name]??0)];
 }
 return [...totals,'-'.repeat(76),'Secure Port    MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action','                  (Count)       (Count)          (Count)','-'.repeat(76),...secured.map(p=>p.name.padEnd(14)+String(p.features.portSecurity.maximum??1).padStart(11)+String(secureEntries(d,p).length).padStart(13)+String(d.runtime.features.portSecurityPortViolations?.[p.name]??0).padStart(13)+'              '+title(p.features.portSecurity.violation??'shutdown').padEnd(10))];
}
