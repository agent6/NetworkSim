import type {Simulator} from './engine.ts';
import type {Device,InterfaceConfig} from './model.ts';
import {nsosFeature} from './datacenter.ts';
import {isIPv4,ipToInt,maskToPrefix,prefixToMask} from './ip.ts';
import {ownRecordValue,setRecordValue} from './record-map.ts';
import {natStatics,natLive,natStats,natRuleKey,natTimeout,clearNatState,clearNatRuleState} from './nat-state.ts';
type Command={syntax:string;description:string;run:(a:string[],no:boolean)=>string[]|void;no?:string;write:boolean};
const fail=(text:string):never=>{throw Error(text);};
function feature(d:Device){if(!nsosFeature(d,'nat'))fail('Enable feature nat first.');}
export function nsosNATCommands(e:Simulator,d:Device,port:(text:string)=>InterfaceConfig,confirm:(text:string,run:()=>void)=>void):Command[]{
 const state=()=>d.config.features.nat??={static:[],rules:[],pools:{}};
 const cmd=(syntax:string,run:Command['run'],no?:string):Command=>({syntax,description:'Configure enforced IPv4 NAT/PAT',write:true,run,no});
 const rule=(acl:string,target:string,pool:boolean,no:boolean)=>{
  feature(d);const nat=state(),value=pool?target:port(target).name,key=pool?'pool':'interface',previous=nat.rules.find((r:any)=>r.acl===acl&&r[key]===value);
  if(no){if(!previous)return;confirm('Removing the list will clear dynamic translations belonging to it. Continue? (y/n)  [n] ',()=>{const active=state();active.rules=active.rules.filter((r:any)=>natRuleKey(r)!==natRuleKey(previous));clearNatRuleState(d,natRuleKey(previous),e);});return;}
  if(!ownRecordValue(d.config.features.acls,acl))fail('Configure the named IPv4 access list first.');
  if(pool){if(!ownRecordValue(nat.pools,value))fail('Configure the NAT pool first.');}
  else{const p=port(value);if(!/^Ethernet/.test(p.name)||p.switchport||p.vrf||p.features.channelGroup)fail('PAT requires a standalone routed Ethernet interface in the default VRF.');}
  if(previous)return;nat.rules.push({acl,[key]:value,overload:true});
 };
 return [cmd('ip nat inside source static <local> <global>',(a,no)=>{
  feature(d);if(!a.every(isIPv4))fail('Invalid IPv4 address.');
  const nat=d.config.features.nat??={static:[],rules:[],pools:{}};nat.static??=[];
  const same=nat.static.find((x:any)=>x.inside===a[0]&&x.outside===a[1]);
  if(no){if(same){nat.static=nat.static.filter((x:any)=>x!==same);clearNatState(d,{local:a[0],global:a[1]},e);}return;}
  if(same)return;
  if(nat.static.some((x:any)=>x.inside===a[0]||x.outside===a[1]))fail('NAT translation already exists for this address.');
  nat.static.push({inside:a[0],outside:a[1]});natStatics(d,e.clock.now());
 },'ip nat inside source static <local> <global>'),
 ...['prefix-length','netmask'].map(kind=>cmd(`ip nat pool <pool> <start> <end> ${kind} <mask>`,(a)=>{
  feature(d);if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(a[0])||!isIPv4(a[1])||!isIPv4(a[2]))fail('Invalid pool name or IPv4 range.');
  const prefix=kind==='netmask'?maskToPrefix(a[3]):/^\d+$/.test(a[3])?+a[3]:-1;if(prefix<1||prefix>32)fail('Invalid network prefix.');const mask=prefixToMask(prefix);
  if(ipToInt(a[2])<ipToInt(a[1])||(ipToInt(a[1])&ipToInt(mask))!==(ipToInt(a[2])&ipToInt(mask)))fail('Pool addresses must be ordered and on the same subnet.');
  const nat=state();if(natLive(d,e.clock.now()).some(x=>nat.rules.some((r:any)=>r.pool===a[0]&&x.rule===natRuleKey(r))))fail('NAT pool is in use.');setRecordValue(nat.pools,a[0],{start:a[1],end:a[2],mask});
 })),
 cmd('ip nat pool <pool>',(a,no)=>{feature(d);if(!no)fail('Pool address range and prefix are required.');const nat=state();if(nat.rules.some((r:any)=>r.pool===a[0]))fail('Remove referencing NAT lists first.');delete nat.pools[a[0]];},'ip nat pool <pool>'),
 cmd('ip nat inside source list <acl> pool <pool> overload',(a,no)=>rule(a[0],a[1],true,no),'ip nat inside source list <acl> pool <pool> overload'),
 ...['<interface>','<interface> <number>'].map(suffix=>cmd('ip nat inside source list <acl> interface '+suffix+' overload',(a,no)=>rule(a[0],a.slice(1).join(''),false,no),'ip nat inside source list <acl> interface '+suffix+' overload'))];
}
export function nsosNATInterface(d:Device,p:InterfaceConfig):Command[]{
 return ['inside','outside'].map(role=>({syntax:'ip nat '+role,description:'Set the IPv4 NAT interface role',write:true,no:'ip nat '+role,run:(_a,no)=>{
  feature(d);if(!/^Ethernet/.test(p.name)||p.switchport||p.vrf||p.features.channelGroup)fail('NAT requires a standalone routed Ethernet interface in the default VRF.');
  if(no){if(p.features.nat===role)delete p.features.nat;}else p.features.nat=role;
 }}));
}
export const nsosNATShowSyntax=['show ip nat translations','show ip nat translations verbose','show ip nat statistics','show ip nat-alias','show running-config nat'];
export function nsosNATConfig(d:Pick<Device,'config'>):string[]{
 const nat=d.config.features.nat??{};
 return [...Object.entries<any>(nat.pools??{}).map(([name,p])=>`ip nat pool ${name} ${p.start} ${p.end} prefix-length ${maskToPrefix(p.mask)}`),...(nat.rules??[]).map((r:any)=>`ip nat inside source list ${r.acl} ${r.pool?'pool '+r.pool:'interface '+r.interface} overload`),...(nat.static??[]).map((x:any)=>`ip nat inside source static ${x.inside} ${x.outside}`)];
}
export function nsosNATShow(e:Simulator,d:Device,a:string[]):string[]|undefined {
 const topic=a.join(' ');if(!nsosNATShowSyntax.includes('show '+topic))return;
 const rows=natStatics(d,e.clock.now()),dynamic=natLive(d,e.clock.now()),stats=natStats(d),nat=d.config.features.nat??{};
 if(topic==='running-config nat')return [...nsosFeature(d,'nat')?['feature nat']:[],...nsosNATConfig(d),...Object.values(d.config.interfaces).filter(p=>p.features.nat).flatMap(p=>['interface '+p.name,'  ip nat '+p.features.nat])];
 if(topic==='ip nat-alias'){const aliases=[...new Set([...rows,...dynamic].map(x=>x.outside))].filter(address=>!Object.values(d.config.interfaces).some(p=>p.ip===address));if(!aliases.length)return [];return ['Alias Information for Context: default','Address         Interface',...aliases.map(address=>address.padEnd(16)+(Object.values(d.config.interfaces).find(p=>p.features.nat==='outside')?.name??'---'))];}
 if(topic.startsWith('ip nat translations'))return ['Pro Inside global      Inside local       Outside local      Outside global',...[...rows,...dynamic].flatMap(x=>{
  const tuple=(address:string,port?:number)=>address+(port===undefined?'':':'+port),left=x.static?-1:Math.max(0,Math.floor(((x.expires??e.clock.now()+natTimeout(d,x))-e.clock.now())/1000));
  const columns=x.static?['any',x.outside,x.inside,'---','---']:[x.protocol,tuple(x.outside,x.outsidePort),tuple(x.inside,x.insidePort),tuple(x.remote,x.protocol==='icmp'?0:x.remotePort),tuple(x.remote,x.protocol==='icmp'?0:x.remotePort)];
  return [columns[0].padEnd(5)+columns.slice(1).map((v:string)=>v.padEnd(20)).join('').trimEnd(),...topic.endsWith(' verbose')?['    Vrf: default    Group_id:0',`    Format(H:M:S) Time-left :${left<0?'0:0:-1':Math.floor(left/3600)+':'+Math.floor(left%3600/60)+':'+left%60}`]:[]];
 })];
 if(topic==='ip nat statistics'){
  const inside=Object.values(d.config.interfaces).filter(p=>p.features.nat==='inside'),outside=Object.values(d.config.interfaces).filter(p=>p.features.nat==='outside');
  return ['IP NAT Statistics','',`Total active translations: ${rows.length+dynamic.length}`,`No.Static: ${rows.length}`,`No.Dyn:    ${dynamic.length}`,`No.Dyn-ICMP:   ${dynamic.filter(x=>x.protocol==='icmp').length}`,`Total expired Translations: ${stats.expired??0}`,'',`Total Hits:  ${stats.hits}                  Total Misses:  ${stats.misses}`,`In-Out Hits: ${stats.inOut??0}                  In-Out Misses: 0`,`Out-In Hits: ${stats.outIn??0}                  Out-In Misses: 0`,`Total SW Translated Packets: ${stats.translated??0}`,`In-Out SW Translated: ${stats.inOut??0}`,`Out-In SW Translated: ${stats.outIn??0}`,'',`NAT Inside Interfaces:${inside.length}`,...inside.map(p=>p.name),`NAT Outside Interfaces:${outside.length}`,...outside.map(p=>p.name),'Inside source list:','++++++++++++++++++++',...(nat.rules??[]).flatMap((r:any)=>{
   const live=dynamic.filter(x=>x.rule===natRuleKey(r)),pool=r.pool&&ownRecordValue(nat.pools,r.pool),p=r.interface&&d.config.interfaces[r.interface],count=pool?ipToInt(pool.end)-ipToInt(pool.start)+1:0,allocated=new Set(live.map(x=>x.outside)).size;
   return [`Access list: ${r.acl}`,`RefCount: ${live.length}`,...pool?[`Pool: ${r.pool}     Overload`,`Total addresses: ${count}`,`Allocated: ${allocated}    percentage: ${Math.floor(allocated/count*100)}%`,`Missed: ${stats.poolMisses?.[r.pool]??0}`]:[`Interface Overload: ${r.interface}(${p&&e.interfaceUp(d.id,p.name)?'UP':'DOWN'}) ${p?.ip??'0.0.0.0'}`],''];
  })];
 }
}
