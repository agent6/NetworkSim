import {aaaStats} from './aaa-client.ts';
import type {Device} from './model.ts';
import {nsosFeature} from './datacenter.ts';
import {isIPv4} from './ip.ts';
import {ownRecordValue,setRecordValue} from './record-map.ts';

export const nsosReservedUser=(user:string)=>'bin daemon adm lp sync shutdown halt mail news uucp operator games gopher ftp nobody nscd mailnull root rpc rpcuser xfs gdm mtsuser ftpuser man sys'.split(' ').includes(user);
type Command={syntax:string;description:string;run:(a:string[],no:boolean)=>string[]|void;no?:string;write:boolean};
const fail=(message:string):never=>{throw Error(message);};
const number=(value:string,min:number,max:number)=>/^\d+$/.test(value)&&+value>=min&&+value<=max?+value:fail(`Expected ${min}-${max}.`);
const identifier=(value:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value)?value:fail('Invalid server-group name.');
export function nsosAAACommands(d:Device,enter:(group:string)=>void):Command[]{
 const f=d.config.features,aaa=()=>f.aaa??={enabled:true},cmd=(syntax:string,run:Command['run'],no?:string):Command=>({syntax,description:'Configure operational AAA',run,no,write:true});
 const host=(protocol:'radius'|'tacacs',a:string[],no:boolean)=>{
  if(protocol==='tacacs'&&!nsosFeature(d,'tacacs+'))fail('Enable feature tacacs+ first.');
  if(!isIPv4(a[0]))fail('Only IPv4 AAA hosts are implemented.');const key=protocol+':'+a[0],servers=aaa().servers??={},prior=ownRecordValue(servers,key);
  if(no){delete servers[key];return;}
  const server=prior??{protocol,address:a[0],port:protocol==='radius'?1812:49,...protocol==='radius'?{accountingPort:1813}:{}};
  for(let i=1;i<a.length;){const option=a[i++];if(option==='key'){if(a[i]==='0')i++;else if(['6','7'].includes(a[i]))fail('Only cleartext lab keys (type 0) are implemented.');if(!a[i]||a[i].length>63)fail('A shared key of 1-63 characters is required.');server.key=a[i++];}
   else if(['auth-port','acct-port','port','timeout','retransmit'].includes(option)){
    if(protocol==='tacacs'&&['auth-port','acct-port','retransmit'].includes(option)||protocol==='radius'&&option==='port')fail('Invalid server option.');
    const field=option==='auth-port'?'port':option==='acct-port'?'accountingPort':option;
    server[field]=number(a[i++],option==='retransmit'?0:1,option.includes('port')?65535:option==='timeout'?60:5);
   }else fail('Unsupported AAA server option.');
  }
  setRecordValue(servers,key,server);
 };
 return [
  ...(['radius','tacacs'] as const).flatMap(protocol=>[
   cmd(`${protocol}-server host <address>`,(a,no)=>host(protocol,a,no),`${protocol}-server host <address>`),
   ...['key <key>','key 0 <key>','timeout <seconds>',...protocol==='radius'?['auth-port <port>','acct-port <port>','retransmit <count>']:['port <port>']].map(option=>cmd(`${protocol}-server host <address> ${option}`,(a,no)=>{const words=option.split(' ');let i=1;host(protocol,[a[0],...words.map(w=>w.startsWith('<')?a[i++]:w)],no);}))
  ]),
  ...['radius','tacacs+'].map(protocol=>cmd(`aaa group server ${protocol} <group>`,(a,no)=>{
   if(protocol==='tacacs+'&&!nsosFeature(d,'tacacs+'))fail('Enable feature tacacs+ first.');
   const group=identifier(a[0]),groups=aaa().groups??={},expected=protocol==='tacacs+'?'tacacs':'radius',prior=ownRecordValue(groups,group);
   if(no){delete groups[group];return;}if(prior&&prior.protocol!==expected)fail('Server group already uses a different protocol.');
   if(!prior)setRecordValue(groups,group,{protocol:expected,servers:[]});enter(group);
  },`aaa group server ${protocol} <group>`)),
  cmd('aaa authentication login default local',()=>{(aaa().login??={}).default=['local'];}),
  cmd('aaa authentication login console local',()=>{aaa().nsosConsoleLocal=true;}),
  cmd('aaa authentication login default group <group>',a=>{
   if(!['radius','tacacs+'].includes(a[0])&&!ownRecordValue(aaa().groups,a[0]))fail('AAA server group does not exist.');
   if(a[0]==='tacacs+'&&!nsosFeature(d,'tacacs+'))fail('Enable feature tacacs+ first.');
   (aaa().login??={}).default=['group',a[0],'local'];
  }),
  cmd('aaa accounting default group <group>',a=>{
   if(!['radius','tacacs+'].includes(a[0])&&!ownRecordValue(aaa().groups,a[0]))fail('AAA server group does not exist.');
   if(a[0]==='tacacs+'&&!nsosFeature(d,'tacacs+'))fail('Enable feature tacacs+ first.');
   aaa().nsosAccounting=['group',a[0]];
  }),
  cmd('aaa accounting default',(_a,no)=>{if(!no)fail('Accounting method required.');delete aaa().nsosAccounting;},'aaa accounting default'),
  cmd('aaa authentication login default',(_a,no)=>{if(!no)fail('Authentication method required.');delete aaa().login?.default;},'aaa authentication login default'),
 ];
}
export function nsosAAAGroupCommands(d:Device,groupName:string):Command[]{
 const group=ownRecordValue(d.config.features.aaa?.groups,groupName);if(!group)return [];
 const cmd=(syntax:string,run:Command['run'],no?:string):Command=>({syntax,description:'Configure AAA server group',run,no,write:true});
 return [cmd('server <address>',(a,no)=>{const key=group.protocol+':'+a[0];if(!no&&!ownRecordValue(d.config.features.aaa?.servers,key))fail('Configure the AAA host first.');group.servers=group.servers.filter((name:string)=>name!==key);if(!no)group.servers.push(key);},'server <address>'),
  cmd('use-vrf <vrf>',(a,no)=>{if(no){delete group.vrf;return;}if(a[0]!=='default'&&!ownRecordValue(d.config.features.vrfs,a[0]))fail('VRF does not exist.');group.vrf=a[0];},'use-vrf <vrf>')];
}
export function renderNSOSAAA(d:Device):string[]{
 const aaa=d.config.features.aaa;if(!aaa)return [];const lines:string[]=[];
 for(const s of Object.values<any>(aaa.servers??{})){
  const head=`${s.protocol}-server host ${s.address}`;lines.push(head+(s.key?' key 0 '+s.key:''));
  if(s.port!==undefined&&s.port!==(s.protocol==='radius'?1812:49))lines.push(head+(s.protocol==='radius'?' auth-port ':' port ')+s.port);
  if(s.accountingPort!==undefined&&s.accountingPort!==1813)lines.push(head+' acct-port '+s.accountingPort);
  if(s.timeout!==undefined)lines.push(head+' timeout '+s.timeout);
  if(s.retransmit!==undefined)lines.push(head+' retransmit '+s.retransmit);
 }
 for(const [name,g]of Object.entries<any>(aaa.groups??{})){lines.push(`aaa group server ${g.protocol==='tacacs'?'tacacs+':'radius'} ${name}`);for(const key of g.servers)if(ownRecordValue(aaa.servers,key))lines.push(' server '+aaa.servers[key].address);if(g.vrf)lines.push(' use-vrf '+g.vrf);lines.push(' exit');}
 if(aaa.login?.default)lines.push('aaa authentication login default '+(aaa.login.default[0]==='group'?'group '+aaa.login.default[1]:'local'));
 if(aaa.nsosAccounting)lines.push('aaa accounting default group '+aaa.nsosAccounting[1]);
 if(aaa.nsosConsoleLocal)lines.push('aaa authentication login console local');
 return lines;
}

export const nsosAAAShowSyntax=['show aaa authentication','show aaa accounting',...['radius','tacacs'].flatMap(protocol=>[`show ${protocol}-server`,`show ${protocol}-server groups`,`show ${protocol}-server statistics <address>`])];
export function nsosAAAShow(d:Device,a:string[]):string[]|undefined {
 const aaa=d.config.features.aaa??{};
 if(a[0]==='aaa')return a[1]==='authentication'?[`         default: ${aaa.login?.default?.[0]==='group'?'group '+aaa.login.default[1]:'local'} `,`         console: ${aaa.nsosConsoleLocal?'local':aaa.login?.default?.[0]==='group'?'group '+aaa.login.default[1]:'local'} `]:[`         default: ${aaa.nsosAccounting?'group '+aaa.nsosAccounting[1]:'local'} `];
 if(!['radius-server','tacacs-server'].includes(a[0]))return;
 const protocol=a[0]==='radius-server'?'radius':'tacacs';
 if(a[1]==='groups')return Object.entries<any>(aaa.groups??{}).filter(([,g])=>g.protocol===protocol).flatMap(([name,g])=>[`group ${name}`,`  use-vrf ${g.vrf??'default'}`,...g.servers.map((key:string)=>'  server '+(aaa.servers?.[key]?.address??key))]);
 const servers=Object.entries<any>(aaa.servers??{}).filter(([,s])=>s.protocol===protocol&&(!a[2]||s.address===a[2]));
 const rows=servers.flatMap(([name,s])=>{
  const auth=aaaStats(d,name,'authenticate'),author=aaaStats(d,name,'authorize'),acct=aaaStats(d,name,'accounting');
  if(a[1]==='statistics')return ['Server is not monitored',...[[auth,'Authentication'],...protocol==='tacacs'?[[author,'Authorization'] as const]:[],[acct,'Accounting']].flatMap(([stats,label]:any)=>['',label+' Statistics',`        failed transactions: ${stats.errors}`,`        successful transactions: ${stats.responses}`,`        requests sent: ${stats.requests}`,`        requests timed out: ${stats.timeouts}`]),'NetworkSim: logical transaction counters; binary protocol validation counters are not modeled.'];
  return [`${s.address}:`,...protocol==='radius'?[`        available for authentication on port: ${s.port??1812}`,`        available for accounting on port: ${s.accountingPort??1813}`]:[`        available on port:${s.port??49}`],`        ${protocol==='radius'?'Radius':'TACACS+'} shared secret:********`,`        timeout:${s.timeout??5}`];
 });
 return a[1]==='statistics'?rows:[`timeout value:5`,'source interface:any available',`total number of servers:${servers.length}`,'',`following ${protocol==='radius'?'RADIUS':'TACACS+'} servers are configured:`,...rows];
}
