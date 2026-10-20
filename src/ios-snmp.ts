import {ownRecordValue,setRecordValue} from './record-map.ts';
import type {Device} from './model.ts';
import {isIPv4,isIPv6} from './ip.ts';
import {normalizeOID,synchronizeSNMPIndexes} from './snmp.ts';
interface Host {device:Device;fail(message?:string):never;interfaceName(name:string):string}

/** Selected IOS XE 17.12 SNMP grammar. Runtime scope remains explicitly read only/logical. */
export function configureSNMP(h:Host,args:string[],no=false):string[]{
 const fail=(message="% Invalid input detected at '^' marker."):never=>h.fail(message),incomplete=():never=>fail('% Incomplete command.');
 const keyword=(text:string|undefined,options:string[]):string=>{if(!text)return incomplete();const exact=options.find(x=>x===text.toLowerCase()),matches=exact?[exact]:options.filter(x=>x.startsWith(text.toLowerCase()));if(matches.length>1)return fail('% Ambiguous command.');return matches[0]??fail();};
 const count=(a:string[],min:number,max=min)=>{if(a.length<min)incomplete();if(a.length>max)fail();};
 const name=(value:string|undefined)=>{if(!value)return incomplete();if(value.length>128||/\s/.test(value))return fail('% Invalid SNMP identifier.');return value;};
 const number=(value:string|undefined,min:number,max:number)=>{if(value===undefined)return incomplete();if(!/^\d+$/.test(value)||+value<min||+value>max)return fail(`% Value must be between ${min} and ${max}.`);return +value;};
 const features=h.device.config.features;
 if(!args.length){if(no){delete features.snmp;return [];}return incomplete();}
 const action=keyword(args[0],['community','location','contact','host','enable','group','user','view','engineid','trap-source','source-interface','chassis-id','ifindex','packetsize','queue-length','informs']),a=args.slice(1);
 const next=structuredClone(features.snmp??{communities:{},hosts:[]});next.communities??={};next.hosts??=[];delete next.enabled;
 let notice:string[]=[];
 if(action==='community'){
  count(a,1,5);const community=name(a[0]);if(no){if(a.length>1)fail();delete next.communities[community];}
  else{let i=1,view:string|undefined;if(a[i]?.toLowerCase()==='view'){view=name(a[++i]);i++;}let access='ro';if(a[i]&&['ro','rw'].some(x=>x.startsWith(a[i].toLowerCase())))access=keyword(a[i++],['ro','rw']);const acl=a[i]?name(a[i++]):undefined;if(i!==a.length)fail();setRecordValue(next.communities,community,view||acl?{access,...view?{view}:{},...acl?{acl}:{}}:access);if(access==='rw')notice=[];}
 }else if(['location','contact','chassis-id'].includes(action)){if(no){count(a,0);delete next[action];}else{if(!a.length)incomplete();next[action]=a.join(' ');}}
 else if(action==='group'){
  count(a,1,11);const group=name(a[0]);next.groups??={};if(no){count(a,1,3);if(a[1])keyword(a[1],['v3']);if(a[2])keyword(a[2],['noauth','auth','priv']);delete next.groups[group];}
  else{count(a,3,11);const version=keyword(a[1],['v3']),level=keyword(a[2],['noauth','auth','priv']),options=[version,level],seen=new Set<string>();for(let i=3;i<a.length;){const key=keyword(a[i++],['read','write','notify','access']);if(seen.has(key))fail('% Duplicate SNMP group option.');seen.add(key);const value=name(a[i++]);options.push(key,value);}setRecordValue(next.groups,group,options);if(seen.has('write'))notice=[];}
 }else if(action==='user'){
  count(a,1,15);const user=name(a[0]);next.users??={};if(no){count(a,1,3);if(a[1])name(a[1]);if(a[2])keyword(a[2],['v3']);delete next.users[user];}
  else{count(a,3,15);const group=name(a[1]),version=keyword(a[2],['v3']),options=[group,version];let i=3,auth=false,privacy=false,access=false;while(i<a.length){const key=keyword(a[i++],['auth','priv','access']);if(key==='access'){if(access)fail();access=true;options.push(key,name(a[i++]));continue;}if(key==='auth'){if(auth||privacy)fail();auth=true;const algorithm=keyword(a[i++],['md5','sha','sha-2']);options.push('auth',algorithm);if(algorithm==='sha-2'){const bits=number(a[i++],256,512);if(![256,384,512].includes(bits))fail();options.push(String(bits));}const password=name(a[i++]);if(password.length<8||password.length>64)fail('% SNMP authentication passwords must contain 8–64 characters.');options.push(password);}else{if(privacy||!auth)fail('% Configure authentication before SNMP privacy.');privacy=true;const algorithm=keyword(a[i++],['des','3des','aes']);options.push('priv',algorithm);if(algorithm==='aes'){const bits=number(a[i++],128,256);if(![128,192,256].includes(bits))fail();options.push(String(bits));}const password=name(a[i++]);if(password.length<8||password.length>64)fail('% SNMP privacy passwords must contain 8–64 characters.');options.push(password);}}setRecordValue(next.users,user,options);notice=[];}
 }else if(action==='view'){
  count(a,1,3);const view=name(a[0]);next.views??={};next.viewEntries??={};if(no&&a.length===1){delete next.views[view];delete next.viewEntries[view];}
  else{count(a,2,3);let subtree:string;try{subtree=normalizeOID(a[1]);}catch{return fail('% Invalid SNMP MIB subtree.');}const legacy=ownRecordValue(next.views,view),existing=ownRecordValue(next.viewEntries,view)??(legacy?[{subtree:legacy[0],included:legacy[1]==='included'}]:[]);let rules=existing.filter((rule:any)=>{try{return normalizeOID(rule.subtree)!==subtree;}catch{return true;}});if(!no){if(!a[2])incomplete();const disposition=keyword(a[2],['included','excluded']);rules.push({subtree,included:disposition==='included'});}if(rules.length){setRecordValue(next.viewEntries,view,rules);setRecordValue(next.views,view,[rules[0].subtree,rules[0].included?'included':'excluded']);}else{delete next.viewEntries[view];delete next.views[view];}}
 }else if(action==='engineid'){
  count(a,no?1:2);keyword(a[0],['local']);if(no)delete next.engineId;else{if(!/^(?:[0-9a-f]{2}){5,32}$/i.test(a[1]))fail('% SNMP engine ID must contain 5–32 hexadecimal bytes.');next.engineId=a[1];notice=[];}
 }else if(action==='host'){
  if(!a.length)incomplete();const address=a[0];if(!isIPv4(address)&&!isIPv6(address))fail('% Expected an IPv4 or IPv6 notification host address.');if(no){count(a,1);next.hosts=next.hosts.filter((host:any)=>host.address!==address);}
  else{let i=1;const kind=a[i]&&['traps','informs'].some(x=>x.startsWith(a[i].toLowerCase()))?keyword(a[i++],['traps','informs']):'traps';if(a[i++]!=='version')fail('% Specify notification version 2c or 3.');const version=keyword(a[i++],['2c','3']);let level:string|undefined;if(version==='3')level=keyword(a[i++],['noauth','auth','priv']);const identity=name(a[i++]);const categories=a.slice(i);if(categories.some(x=>!['snmp','linkdown','linkup','coldstart','warmstart','authentication'].includes(x.toLowerCase())))fail('% This SNMP notification category is not implemented.');const options=[...(kind==='informs'?['informs']:[]),'version',version,...level?[level]:[],identity,...categories.map(x=>x.toLowerCase())];next.hosts=next.hosts.filter((host:any)=>host.address!==address);next.hosts.push({address,options});if(version==='3')notice=[];}
 }else if(action==='informs'){
  if(no&&!a.length)delete next.informs;else{next.informs??={};const seen=new Set<string>();for(let i=0;i<a.length;){const field=keyword(a[i++],['retries','timeout','pending']);if(seen.has(field))fail('% Duplicate SNMP inform option.');seen.add(field);const max=field==='retries'?100:field==='timeout'?42949671:4294967295,min=field==='timeout'?0:1;if(no){if(a[i]&&/^\d+$/.test(a[i]))number(a[i++],min,max);delete next.informs[field];}else next.informs[field]=number(a[i++],min,max);}}
 }else if(action==='enable'){
  if(!a.length)incomplete();keyword(a[0],['traps']);const all=['linkdown','linkup','coldstart','warmstart','authentication'],categories=a.slice(1).map(x=>keyword(x,['snmp',...all])),specific=categories.filter(x=>x!=='snmp');
  if(no){if(!specific.length){next.traps=false;next.trapCategories=[];}else{const before=next.traps?(next.trapCategories?.length?next.trapCategories.filter((x:string)=>x!=='snmp'):all):[];next.trapCategories=before.filter((x:string)=>!specific.includes(x));next.traps=next.trapCategories.length>0;}}
  else{const wasAll=next.traps&&!next.trapCategories?.length;next.trapCategories=!specific.length||wasAll?[]:[...new Set([...(next.traps?next.trapCategories??[]:[]),...specific])].filter(x=>x!=='snmp');next.traps=true;}
 }else if(action==='trap-source'||action==='source-interface'){
  if(no){count(a,0);delete next[action];}else{count(a,1);next[action]=h.interfaceName(a[0]);}
 }else if(action==='ifindex'){
  count(a,1);keyword(a[0],['persist']);if(no)delete next.ifindex;else next.ifindex='persist';if(no)delete next.interfaceIndexes;
 }else{
  if(no){count(a,0);delete next[action];}else{count(a,1);next[action]=String(number(a[0],action==='packetsize'?484:1,action==='packetsize'?17940:1000));if(action==='queue-length')notice=[];}
 }
 features.snmp=next;synchronizeSNMPIndexes(h.device);return notice;
}

export function renderSNMP(config:any):string[]{if(!config)return [];const lines:string[]=[];
 for(const[name,raw]of Object.entries<any>(config.communities??{})){const entry=typeof raw==='string'?{access:raw}:raw;lines.push(`snmp-server community ${name}${entry.view?' view '+entry.view:''} ${entry.access??'ro'}${entry.acl?' '+entry.acl:''}`);}
 for(const key of ['location','contact'])if(config[key])lines.push(`snmp-server ${key} ${config[key]}`);
 if(config.engineId)lines.push('snmp-server engineid local '+config.engineId);
 for(const[name,legacy]of Object.entries<any>(config.views??{})){const rules=config.viewEntries?.[name]??[{subtree:legacy[0],included:legacy[1]==='included'}];for(const rule of rules)lines.push(`snmp-server view ${name} ${rule.subtree} ${rule.included?'included':'excluded'}`);}
 for(const kind of ['group','user'])for(const[name,options]of Object.entries<string[]>(config[kind+'s']??{}))lines.push(`snmp-server ${kind} ${name} ${options.join(' ')}`);
 for(const host of config.hosts??[])lines.push(`snmp-server host ${host.address} ${host.options.join(' ')}`);
 if(config.informs&&Object.keys(config.informs).length)lines.push('snmp-server informs '+Object.entries(config.informs).map(([k,v])=>k+' '+v).join(' '));
 if(config.traps)lines.push('snmp-server enable traps'+(config.trapCategories?.length?' '+config.trapCategories.join(' '):''));
 for(const key of ['trap-source','source-interface','chassis-id','ifindex','packetsize','queue-length'])if(config[key])lines.push(`snmp-server ${key} ${config[key]}`);
 return lines;
}
