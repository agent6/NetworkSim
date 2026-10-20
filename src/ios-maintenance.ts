import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {isIPv4,isIPv6} from './ip.ts';
import {clearNhrp} from './nhrp.ts';
export interface MaintenanceHost {engine:Simulator;device:Device;interfaceName(value:string):string;fail(message?:string):never}
export function maintenanceCommands(h:MaintenanceHost){
 const d=h.device,r=d.runtime,f=r.features,commands:Array<{words:string[];description:string;args?:string;run(a:string[],no:boolean):string[]|void}>=[];
 const add=(path:string,run:(a:string[])=>string[]|void,args?:string)=>commands.push({words:path.split(' '),description:'Clear actual operational state',run,args});
 const exact=(a:string[],n:number)=>{if(a.length<n)h.fail('% Incomplete command.');if(a.length>n)h.fail();};
 const keyword=(a:string,choices:string[])=>{const found=choices.includes(a)?[a]:choices.filter(word=>word.startsWith(a));if(found.length!==1)h.fail(found.length?'% Ambiguous command.':undefined);return found[0];};
 add('clear ip arp',a=>{if(a.length>1)h.fail();if(a[0]&&!isIPv4(a[0]))h.fail();for(const [key,entry]of Object.entries(r.arp))if(!entry.static&&isIPv4(entry.ip)&&(!a.length||entry.ip===a[0]))delete r.arp[key];},'[address]');
 add('clear ipv6 neighbors',a=>{if(a.length>1)h.fail();const port=a.length?h.interfaceName(a[0]):undefined;for(const [key,entry]of Object.entries(r.arp))if(!entry.static&&isIPv6(entry.ip)&&(!port||entry.port===port))delete r.arp[key];},'[interface]');
 add('clear counters',a=>{if(a.length>2)h.fail();if(a.length)delete r.counters[h.interfaceName(a.join(''))];else r.counters={};},'[interface]');
 for(const type of ['binding','conflict'])add('clear ip dhcp '+type,a=>{exact(a,1);if(a[0]!=='*'&&!isIPv4(a[0]))h.fail();const field=type==='binding'?'dhcpLeases':'dhcpConflicts';f[field]=(f[field]||[]).filter((row:any)=>a[0]!=='*'&&row.address!==a[0]);},'*|address');
 add('clear ip dhcp snooping',a=>{if(a[0]){keyword(a[0],['binding']);if(a.length>2||a[1]&&a[1]!=='*')h.fail();}f.dhcpBindings=[];},'[binding] [*]');
 for(const prefix of ['clear access-list counters','clear ip access-list counters'])add(prefix,a=>{if(a.length>1)h.fail();for(const key of Object.keys(f.aclHits||{}))if(!a.length||key.startsWith(a[0]+':'))delete f.aclHits[key];},'[name]');
 add('clear ip nat translation',a=>{if(!a.length)h.fail('% Incomplete command.');if(a[0]==='*'){exact(a,1);f.natTranslations=[];return;}if(a[0]==='inside'){exact(a,3);if(!isIPv4(a[1])||!isIPv4(a[2]))h.fail();f.natTranslations=(f.natTranslations||[]).filter((row:any)=>row.outside!==a[1]||row.inside!==a[2]);return;}h.fail();},'*|inside <global-address> <local-address>');
 const clearMac=(a:string[])=>{let port:string|undefined,vlan:number|undefined,mac:string|undefined;for(let i=0;i<a.length;i++){const key=keyword(a[i],['dynamic','interface','vlan','address']);if(key==='dynamic')continue;const value=a[++i];if(!value)h.fail('% Incomplete command.');if(key==='interface')port=h.interfaceName(value);else if(key==='vlan'){vlan=Number(value);if(!/^\d+$/.test(value)||vlan<1||vlan>4094)h.fail();}else{const hex=value.replace(/[.:-]/g,'').toLowerCase();if(!/^[0-9a-f]{12}$/.test(hex))h.fail();mac=hex;}}
 for(const [key,row]of Object.entries(r.mac))if(!row.static&&(!port||row.port===port)&&(!vlan||row.vlan===vlan)&&(!mac||row.mac.replace(/:/g,'').toLowerCase()===mac))delete r.mac[key];};
 add('clear mac address-table',clearMac,'[dynamic] [interface name] [vlan id] [address MAC]');add('clear mac address-table dynamic',clearMac,'[interface name] [vlan id] [address MAC]');
 add('clear ip flow',a=>{if(a.length>1)h.fail();if(a[0])keyword(a[0],['stats']);if(a[0])delete f.netflowStats;else f.netflowCache=[];},'[stats]');
 add('clear ip nhrp',a=>{let port:string|undefined,address:string|undefined;while(a.length){if(a[0]==='interface'){a.shift();if(!a.length)h.fail('% Incomplete command.');port=h.interfaceName(a.shift()!);if(!/^Tunnel/i.test(port))h.fail('% Expected a Tunnel interface.');}else if(isIPv4(a[0]))address=a.shift();else h.fail();}clearNhrp(h.engine,d.id,port,address);},'[address] [interface name]');
 add('clear crypto',a=>{if(!a.length)h.fail('% Incomplete command.');const kind=keyword(a[0],['isakmp','ipsec','sa']);if(kind==='sa'){exact(a,1);h.engine.clearCrypto(d.id);return;}if(a.length!==2&&a.length!==4)h.fail();keyword(a[1],['sa']);let peer:string|undefined;if(a.length===4){keyword(a[2],['peer']);if(!isIPv4(a[3]))h.fail();peer=a[3];}h.engine.clearCrypto(d.id,kind==='isakmp'?'isakmp':'ipsec',peer);},'isakmp sa|ipsec sa [peer address]');
 add('clear host',a=>{exact(a,1);if(a[0]==='*')f.dnsCache={};else if(f.dnsCache){const name=a[0].replace(/\.$/,'').toLowerCase();for(const key of Object.keys(f.dnsCache))if(key===name||key.startsWith(name+'|'))delete f.dnsCache[key];}},'*|name');
 return commands;
}
