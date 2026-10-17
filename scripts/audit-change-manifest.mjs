#!/usr/bin/env node
// Explicit review surface, not an invented Git diff of an already-untracked tree.
import fs from 'node:fs';
import crypto from 'node:crypto';
const groups={
 'shared-engine-and-persistence':{source:['engine','model','persistence','record-map','filesystem','tcp-channel','config-renderer'],tests:['persistence','record-maps']},
 'cli-and-platform':{source:['cli','ios-syntax','ios-platform-compat','ios-switching-compat','ios-show','ios-show-switching','ios-show-operational','ios-show-enterprise','ios-maintenance'],tests:['cli','platform-fidelity','ios-show-operational','ios-show-switching']},
 'wired-protocols-and-physical-links':{source:['control-plane','bgp-session','bgp-compat','discovery','packet-policy','ethernet','qos-scheduler','mac-aging'],tests:['wired-fidelity','bgp-multiprotocol','ethernet-physical','qos-scheduler','qos-parity','mac-aging','eigrp-auto-summary']},
 'windows-and-network-services':{source:['windows-cli','dns-service','snmp','ios-snmp','ssh-files','management','aaa-service','aaa-accounting','model-driven-management','http-service'],tests:['windows-cli','dns-service','snmp','ssh-files','management','aaa-accounting','model-driven-management']},
 'wireless-and-poe':{source:['wireless','wireless-model','ios-wireless','poe','ios-poe','wireless-controller-form'],tests:['wireless','poe','ap-controller-config']},
 'gui-and-retained-concurrent-work':{source:['main','services-ui','network-tools-ui','wireless-ui','wlc-reference-ui','ap-controller-view','poe-ui'],tests:['services-ui']},
};
const digest=path=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const rows=new Map();
for(const [group,paths]of Object.entries(groups))for(const [role,names]of Object.entries(paths))for(const name of names){
 const path=role==='source'?`src/${name}.ts`:`tests/${name}.test.ts`;
 if(!fs.existsSync(path))throw Error('Missing declared review path: '+path);
 const old=rows.get(path);if(old)old.groups.push(group);else rows.set(path,{path,role,groups:[group],sha256:digest(path),bytes:fs.statSync(path).size});
}
const evidencePaths=fs.readdirSync('docs/audits').filter(name=>/\.(md|json)$/.test(name)&&name!=='changed-files.json').map(name=>'docs/audits/'+name);
const tooling=fs.readdirSync('scripts').filter(name=>/^(audit-|browser-|fidelity-inventory|report-fidelity)/.test(name)).map(name=>'scripts/'+name);
const result={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'Explicit source/test review surface for this audit and retained concurrent work. No immutable pre-audit source snapshot exists; this is not a Git diff, authorship attribution, or exhaustive historical edit count.',baseline:'Checkout was already untracked; no reset or blanket commit was made.',concurrentWork:'AP controller displays, WLC reference dropdowns and server service removal were introduced concurrently and preserved. This audit also repaired defects in these shared files.',files:[...rows.values()].sort((a,b)=>a.path.localeCompare(b.path)),evidencePaths,tooling,standalone:{path:'index.html',sha256:digest('index.html'),bytes:fs.statSync('index.html').size}};
fs.writeFileSync('docs/audits/changed-files.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:result.files.filter(r=>r.role==='source').length,testFiles:result.files.filter(r=>r.role==='tests').length,tooling:tooling.length,evidenceFiles:evidencePaths.length}));
