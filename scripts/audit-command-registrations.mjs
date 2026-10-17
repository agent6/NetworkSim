#!/usr/bin/env node
// Independent audit of every effective executable registration, including removal/default semantics.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {loadReference,probeReference,probeNew} from './audit-command-parity.mjs';
import {commandRejected} from './audit-command-fixtures.mjs';
const directory='.research/command-parity',read=name=>JSON.parse(gunzipSync(fs.readFileSync(`${directory}/${name}.json.gz`)));
const manifest=read('reference-manifest'),positive=read('path-ledger'),environment=loadReference();environment.stopCapturingSources();
const byPositive=new Map(positive.rows.map(row=>[row.key,row])),all=new Map();for(const row of manifest.commands.filter(r=>r.executable)){const key=row.mode+'|'+row.path;if(!all.has(key))all.set(key,row);}
const hash=text=>createHash('sha256').update(text??'').digest('hex');
function compact(result,baseline){const before=result.before??'',after=result.running??'',old=new Set(before.split('\n')),fresh=new Set(after.split('\n'));return{output:result.output,modeBefore:result.modeBefore,mode:result.mode,setupError:result.setupError,error:result.error,rejected:!!result.error||!!result.setupError||commandRejected(result.output),changed:before!==after,returnedToBaseline:after===baseline,beforeHash:hash(before),afterHash:hash(after),added:[...fresh].filter(line=>!old.has(line)),removed:[...old].filter(line=>!fresh.has(line))};}
const rows=[];
for(const[key,row]of all){
 const match=/^(no|default) (.+)$/.exec(row.path),basePath=match?.[2]??row.path,base=byPositive.get(row.mode+'|'+basePath);
 if(!match){rows.push({key,mode:row.mode,path:row.path,source:row.source,form:'positive',status:base?.status??'missing-positive-fixture',positiveKey:base?.key});continue;}
 const seed=base?.probes.find(p=>p.referenceAccepted&&!p.current.error&&!p.current.setupError&&!commandRejected(p.current.output))??base?.probes.find(p=>p.referenceAccepted);
 if(!seed){rows.push({key,mode:row.mode,path:row.path,source:row.source,form:match[1],status:'base-command-needs-fixture',positiveKey:base?.key});continue;}
 const setup=[...(seed.setup.setup??[]),seed.command];if(seed.reference.mode!==seed.reference.modeBefore||seed.current.mode!==seed.current.modeBefore)setup.push('end','configure terminal',...(seed.setup.setup??[]));
 const argumentsText=seed.command.slice(basePath.length).trim(),full=(row.path+(argumentsText?' '+argumentsText:'')).trim(),tokens=full.split(/\s+/),minimum=row.path.split(/\s+/).length,candidates=[full];
 for(let n=tokens.length-1;n>=minimum;n--)candidates.push(tokens.slice(0,n).join(' '));
 const probes=[];for(const command of [...new Set(candidates)].slice(0,12)){const spec={...seed.setup,setup,command},reference=compact(probeReference(environment,spec),seed.reference.before),current=compact(probeNew(spec),seed.current.before);probes.push({command,reference,current});if(!reference.rejected&&!current.rejected)break;}
 const accepted=probes.filter(p=>!p.reference.rejected),both=accepted.find(p=>!p.current.rejected);let status=both?both.reference.changed===both.current.changed?'removal-state-change-agrees':'removal-state-change-differs':accepted.length?'removal-rejected-by-current':probes.some(p=>p.reference.setupError||p.reference.error)?'removal-reference-setup-needs-fixture':'reference-removal-rejected';
 rows.push({key,mode:row.mode,path:row.path,source:row.source,form:match[1],status,positiveKey:base?.key,preparedWith:seed.command,setup,probes});if(rows.length%100===0)console.error(`Registration ${rows.length}/${all.size}`);
}
const summary=Object.fromEntries([...new Set(rows.map(r=>r.status))].map(status=>[status,rows.filter(r=>r.status===status).length]));
fs.writeFileSync(`${directory}/all-registration-ledger.json.gz`,gzipSync(JSON.stringify({generatedAt:new Date().toISOString(),method:'Every executable mode/path including no/default. Positive evidence referenced from path-ledger. Removal/default probes first apply a concrete positive command, then capture independent old/new configuration changes, baseline recovery and output. State-change agreement does not certify equivalent resulting values or all arguments.',summary,rows})));
console.log(JSON.stringify(summary,null,2));
