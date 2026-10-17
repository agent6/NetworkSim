#!/usr/bin/env node
// Audit-only expansion of executable registrations; no reference data enters the product.
import fs from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {loadReference,probeReference,probeNew} from './audit-command-parity.mjs';
import {argumentFixtures,fixtureContext,commandRejected} from './audit-command-fixtures.mjs';
import {commandContexts} from './audit-command-contexts.mjs';
const dir='.research/command-parity',manifest=JSON.parse(gunzipSync(fs.readFileSync(dir+'/reference-manifest.json.gz'))),current=JSON.parse(gunzipSync(fs.readFileSync(dir+'/current-manifest.json.gz')));
const env=loadReference();env.stopCapturingSources();
const seen=new Map();for(const row of manifest.commands.filter(r=>r.executable&&!/^(no|default) /.test(r.path))){const k=row.mode+'|'+row.path,old=seen.get(k);if(!old||row.model==='NETLAB-R4'||row.type==='switch'&&old.type==='pc')seen.set(k,row);}
const substitute=pattern=>pattern.replace(/A\.B\.C\.D\/nn/g,'192.0.2.0/24').replace(/\/nn/g,'24').replace(/\{ifs\}/g,'GigabitEthernet0/0').replace(/<(-?\d+)-(\d+)>/g,(_,lo,hi)=>String(Math.max(Number(lo),Math.min(10,Number(hi))))).replace(/A\.B\.C\.D/g,'192.0.2.1').replace(/X:X:X:X::X\/<0-128>/g,'2001:db8::/64').replace(/X:X:X:X::X/g,'2001:db8::1').replace(/H\.H\.H/g,'0200.0000.0001').replace(/\b(?:WORD|NAME|LINE)\b/g,'AUDIT');
const rejection=commandRejected;
const ledger=[];
for(const [key,row]of seen){
 const spec=commandContexts[row.mode],mapping=current.comparison.find(r=>r.mode===row.mode&&r.path===row.path);if(!spec){ledger.push({key,mode:row.mode,path:row.path,status:'unmapped-context',source:row.source});continue;}
 const patterns=row.grammar?.patterns||[],candidates=[...(argumentFixtures[key]||[]),row.path,...patterns.filter(p=>typeof p==='string'&&!/[{}\[\]|]/.test(p)).slice(0,12).map(p=>(row.path+' '+substitute(p)).trim())];
 const base=fixtureContext(row.mode,row.path,{...spec,...(['switch','l3switch','pc','server'].includes(row.type)?{type:row.type,model:row.model}:{})});if(['switch','l3switch'].includes(base.type)){base.model??='NETLAB-S24T';base.setup=(base.setup||[]).map(l=>l.replace('GigabitEthernet0/0 - 1','GigabitEthernet0/1 - 2').replace('GigabitEthernet0/0','GigabitEthernet0/1'));}
 const probes=[],queue=[...new Set(candidates)].map(command=>({command,depth:0})),visited=new Set();while(queue.length&&probes.length<24){const{command,depth}=queue.shift();if(visited.has(command))continue;visited.add(command);const setup={...base,command,help:command+' '},reference=probeReference(env,setup),fresh=probeNew(setup);const accepted=!reference.error&&!reference.setupError&&!rejection(reference.output);probes.push({command,setup:base,reference,current:fresh,referenceAccepted:accepted});if(accepted&&!rejection(fresh.output)&&!fresh.setupError&&!fresh.error)break;
  if(!accepted&&!reference.error&&!reference.setupError&&depth<6){const tokens=(reference.help||'').split('\n').map(l=>/^\s{2,}(\S+)\s{2,}/.exec(l)?.[1]).filter(Boolean).filter(t=>t!=='<cr>'&&t!=='|');for(const token of tokens.slice(0,4)){let arg=substitute(token);if(/^[A-Z][A-Z0-9_-]*$/.test(arg))arg='AUDIT';if(token==='GigabitEthernet')arg='GigabitEthernet0/'+(['switch','l3switch'].includes(base.type)?1:0);if(token==='Vlan')arg='Vlan10';if(token==='WORD')arg='AUDIT';if(arg.includes('<')||arg.includes('{')||arg==='...')continue;queue.push({command:command+' '+arg,depth:depth+1});}}
 }

 const accepted=probes.filter(p=>p.referenceAccepted),matched=accepted.find(p=>!p.current.setupError&&!p.current.error&&!rejection(p.current.output));
 const status=matched?'accepted-path-representative':accepted.length?'measured-rejection-gap':probes.some(p=>p.reference.setupError||p.reference.error)?'reference-context-needs-fixture':'argument-or-condition-needs-fixture';
 ledger.push({key,mode:row.mode,path:row.path,source:row.source,conditional:row.when||row.runWhen,structural:mapping?.classification,currentPath:mapping?.currentPath,status,probes});if(ledger.length%100===0)console.error(`Registration ${ledger.length}/${seen.size}`);
}
fs.writeFileSync(dir+'/path-ledger.json.gz',gzipSync(JSON.stringify({generatedAt:new Date().toISOString(),method:'One or more isolated command probes per positive executable mode/path. Acceptance is not behavioral equivalence. Arguments synthesized from executable whitelist patterns where possible; unresolved contexts and incomplete arguments remain explicit.',rows:ledger})));
console.log(JSON.stringify(Object.fromEntries([...new Set(ledger.map(x=>x.status))].map(k=>[k,ledger.filter(x=>x.status===k).length])),null,2));
