#!/usr/bin/env node
/** Source-derived inventory. Discovery and parser smoke checks never imply fidelity. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {commandContexts} from './audit-command-contexts.mjs';
import {commandRejected} from './audit-command-fixtures.mjs';
const out='docs/audits';fs.mkdirSync(out,{recursive:true});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const kinds=['router','switch','l3switch','poeswitch','wlc','ap','pc','laptop','server'];
const sourceFiles=fs.readdirSync('src').filter(f=>/\.(ts|css|html)$/.test(f));
const sources=sourceFiles.map(file=>{const name='src/'+file,text=fs.readFileSync(name,'utf8');return {file:name,sha256:hash(text),lines:text.split('\n').length,bytes:Buffer.byteLength(text),imports:[...text.matchAll(/(?:import|export)[^;\n]*?from\s*['"]([^'"]+)['"]/g)].map(m=>m[1]),exports:[...text.matchAll(/export\s+(?:async\s+)?(?:class|function|interface|type|const)\s+([\w$]+)/g)].map(m=>m[1]),text};});
const contexts={...commandContexts,
 'wireless-wlan':{setup:['wlan AUDIT 1 Audit']},'wireless-policy':{setup:['wireless profile policy AUDIT']},'wireless-policy-tag':{setup:['wireless tag policy AUDIT']},'wireless-site-tag':{setup:['wireless tag site AUDIT']},'wireless-rf-tag':{setup:['wireless tag rf AUDIT']},'wireless-rf-profile':{setup:['ap dot11 5ghz rf-profile AUDIT']},'wireless-ap-profile':{setup:['ap profile AUDIT']},'wireless-flex':{setup:['wireless profile flex AUDIT']},'wireless-ap':{setup:['ap 0200.0000.0001']}
};
const commands=[],contextResults=[];
const locationCache=new Map();
const locate=(command,fn)=>{if(locationCache.has(command))return locationCache.get(command);const quoted=[`'${command}'`,`"${command}"`];const candidates=sources.filter(s=>s.file!=='src/main.ts'&&s.file!=='src/ios-syntax.ts'&&quoted.some(q=>s.text.includes(q)));const source=candidates.find(s=>s.file==='src/cli.ts')??candidates[0];const result=source?{file:source.file,line:source.text.slice(0,Math.max(...quoted.map(q=>source.text.indexOf(q)))).split('\n').length}: {file:'src/cli.ts',line:null,note:'Dynamic registration; inspect handler/context; exact literal location unavailable'};locationCache.set(command,result);return result;};
const feature=(p)=>/wireless|wlan|capwap|dot11|ap profile|ap tag/.test(p)?'wireless':/power inline/.test(p)?'poe':/bgp/.test(p)?'bgp':/ospf/.test(p)?'ospf':/eigrp/.test(p)?'eigrp':/spanning|vlan|switchport|etherchannel|channel-group|lacp|vtp|dtp/.test(p)?'switching':/access|acl|prefix-list|route-map/.test(p)?'policy':/nat/.test(p)?'nat':/dhcp/.test(p)?'dhcp':/snmp/.test(p)?'snmp':/netconf|restconf/.test(p)?'model-driven-management':/aaa|radius|tacacs|ssh|line|username/.test(p)?'management':/ip route|ipv6 route|vrf/.test(p)?'routing':/policy-map|class-map|service-policy|police|dscp/.test(p)?'qos':'system';
for(const kind of kinds.filter(k=>!['pc','laptop','server'].includes(k))){
 for(const [name,spec]of Object.entries(contexts)){
  const e=new Simulator(),d=e.addDevice(kind),s=new IOSSession(e,d.id,{skipConsoleLogin:true});
  // Read registry only: AP console remains inaccessible without actual PoE.
  const first=Object.keys(d.config.interfaces).find(p=>/^GigabitEthernet/.test(p));
  const setup=spec.exec==='user'?[]:spec.exec==='priv'?['enable']:['enable','configure terminal',...(spec.setup??[])];
  const lines=setup.map(l=>l.replaceAll('GigabitEthernet0/0',first??'GigabitEthernet0/0').replace('GigabitEthernet0/1 - 1','GigabitEthernet0/1 - 2'));
  let failure;
  if(kind==='ap'){const pse=e.addDevice('poeswitch');e.connect({deviceId:pse.id,port:'GigabitEthernet0/1'},{deviceId:d.id,port:'GigabitEthernet0'});}
  for(const line of lines){const output=s.execute(line);if(commandRejected(output.join('\n'))){failure={line,output};break;}}
  contextResults.push({node:kind,context:name,mode:s.mode,setup:lines,failure});
  if(failure)continue;
  for(const c of s.commands()){
   const p=c.words.join(' '),body=c.run.toString(),id=kind+'|'+s.mode+'|'+p,readOnly=/^(show|help|terminal|ping|traceroute|clear)/.test(p),lim=/configuredOnly|configuration.stored.only|not.simulated|not.modeled/.test(body);
   commands.push({id,node:kind,platform:['switch','l3switch','poeswitch'].includes(kind)?'catalyst-9300-ios-xe-17.12':kind==='wlc'?'c9800-ios-xe-17.12':kind==='ap'?'c9115-lightweight-17.12':'isr4331-ios-xe-17.12',command:p,parameters:c.args??'',mode:s.mode,context:name,description:c.description,default:'Requires per-feature reference verification',parser:locate(p,body),handlerHash:hash(body),state:[...new Set([...body.matchAll(/(?:features|config|runtime)\.([\w]+)/g)].map(m=>m[0]))],calls:[...new Set([...body.matchAll(/(?:engine|this)\.([\w]+)\(/g)].map(m=>m[1]))],protocol:feature(p),packetBehavior:readOnly?'Diagnostic/action; inspect actual handler dependencies':'Not yet independently traced for every parameter',showOutput:readOnly?p:'See feature-specific operational commands',persistence:'Configuration persists structurally; per-command startup/negation evidence required',negation:!readOnly&&s.configurationMode?'Generic no/default dispatch; individual semantics need verification':'Not applicable or separate EXEC command',status:lim?'partial':'untested',evidence:[],testIds:[],validationLevels:[],notes:lim?['Handler explicitly reports configuration-only behavior']:[]});
  }
 }
}
const byCommand=new Map();for(const r of commands){const id=r.node+'|'+r.command+'|'+r.handlerHash;let row=byCommand.get(id);if(!row){row={...r,id,modes:[],contexts:[]};delete row.mode;delete row.context;byCommand.set(id,row);}if(!row.modes.includes(r.mode))row.modes.push(r.mode);if(!row.contexts.includes(r.context))row.contexts.push(r.context);}
const unique=[...byCommand.values()];for(const row of unique){row.surface='ios-registration';if(row.node==='ap')row.notes.push('Shared IOS teaching registry; compatibility of this command with the selected lightweight AP CLI is not established.');}
// These shared handlers deliberately reject every invocation. Do not count known
// unsupported functionality as merely undiscovered, or infer support from its path.
for(const row of unique)if(['fair-queue','random-detect'].includes(row.command)){
 row.status='unsupported';row.state=[];row.packetBehavior='Explicit rejection; no fair-queue/WRED scheduler is implemented';row.persistence='No configuration is accepted';row.negation='Unsupported operation remains explicit';row.evidence=['docs/audits/wired-fidelity-audit.md','tests/qos-scheduler.test.ts'];row.notes.push('Known simulator limitation, not a claim that the selected Cisco platform lacks the feature.');
}
for(const row of unique)if(row.command==='no debug interface'){
 row.status='partial';row.evidence=['docs/audits/command-removal-fidelity.md','tests/ios-service-compat.test.ts'];row.testIds=['no debug interface aliases conditional removal and changes actual event visibility without changing traffic'];row.packetBehavior='Passive debug condition changes visibility of actual events without changing forwarding';row.persistence='Runtime-only debug subscriptions are not configuration';row.notes.push('Shared helper; bounded router packet regression, not every native interface-debug option or node profile.');
}
const windows=JSON.parse(fs.readFileSync(out+'/windows-command-inventory.json','utf8'));for(const variant of windows.commands)for(const node of variant.node){unique.push({id:node+'|windows|'+variant.id,node,surface:'windows-variant',platform:windows.profiles[node],command:variant.command,parameters:'See command variant syntax',modes:['CMD'],contexts:['WindowsSession'],parser:variant.parser,handlerHash:windows.sourceSha256,state:[variant.state],protocol:'windows-networking',packetBehavior:variant.packetBehavior,showOutput:variant.command,persistence:variant.saveReload,negation:'See supported command variant',status:variant.status,evidence:[variant.reference],testIds:variant.testIds,validationLevels:[],notes:[variant.referenceComparison,'Complete means the explicitly bounded Windows variant only; full native Windows equivalence is not established.'],change:variant.change});}
const tests=fs.readdirSync('tests').filter(f=>f.endsWith('.test.ts')).map(file=>{const t=fs.readFileSync('tests/'+file,'utf8');return{file:'tests/'+file,sha256:hash(t),cases:[...t.matchAll(/\btest\(\s*['"`]([^'"`\n]+)['"`]/g)].map(m=>m[1])};});
const gui=[];for(const s of sources.filter(s=>/main|services-ui|poe-ui|wireless-ui|simulation-ui|network-tools-ui|ap-controller-view/.test(s.file))){for(const m of s.text.matchAll(/(?:input|select|toggle|textField|field|wlcReference|definition)\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]|\bname=["']([^"']+)["']/g)){const id=m[3]??m[2];if(id.includes('${'))continue;gui.push({id:s.file+'|'+id,control:id,label:m[1]??null,source:{file:s.file,line:s.text.slice(0,m.index).split('\n').length},status:'untested',evidence:[]});}}
const document={schemaVersion:1,generatedAt:new Date().toISOString(),method:'Enumerate effective runtime command registries across all discovered contexts and node types. Capture handler identity and source candidates. Source scanning inventories GUI controls/import dependencies/tests. Mode/context arrays consolidate shared inherited registrations; no/default forms remain explicitly unverified. Does not equate registry presence, test-name matches, or parser acceptance with behavior or Cisco fidelity.',scope:{nodes:kinds,unit:'One node + canonical registered path + handler hash; modes and context entries are consolidated. Windows variants use a separate explicit syntax unit. Arguments and no/default forms require separate evidence.'},sources:sources.map(({text,...rest})=>rest),contexts:contextResults,commands:unique,gui:[...new Map(gui.map(x=>[x.id,x])).values()],tests};
fs.writeFileSync(out+'/coverage-inventory.json',JSON.stringify(document,null,2)+'\n');
fs.writeFileSync(out+'/dependency-map.json',JSON.stringify({schemaVersion:1,generatedAt:document.generatedAt,modules:document.sources},null,2)+'\n');
console.log(JSON.stringify({modules:sources.length,contexts:contextResults.length,entered:contextResults.filter(c=>!c.failure).length,registrations:commands.length,commands:unique.length,iosCommands:unique.filter(r=>r.surface==='ios-registration').length,windowsVariants:windows.counts.variants,windowsRoots:windows.counts.roots,distinctIOSPaths:new Set(unique.filter(r=>r.surface==='ios-registration').map(r=>r.command)).size,gui:document.gui.length,tests:tests.length,byNode:Object.fromEntries(kinds.map(k=>[k,unique.filter(r=>r.node===k).length]))},null,2));
