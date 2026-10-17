#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=file=>JSON.parse(fs.readFileSync(file)),hash=value=>createHash('sha256').update(value).digest('hex');
const file='docs/audits/command-probe-validation.json',audit=read(file),current=read('docs/audits/command-probe-current-triage.json'),followups=read('docs/audits/command-probe-followups.json'),history=read('docs/audits/command-probe-snapshots.json');
assert.equal(current.basis.sha256,hash(fs.readFileSync(file)),'Triage must bind this paired snapshot');
assert.equal(followups.basis.sha256,hash(fs.readFileSync(file)),'Followups must bind this paired snapshot');
const counts=rows=>Object.fromEntries([...new Set(rows.map(r=>r.category))].map(category=>[category,rows.filter(r=>r.category===category).length]));
const table=rows=>['| Observation | Paths |','| --- | ---: |',...Object.entries(rows).map(([label,count])=>`| ${label} | ${count} |`),''];
const escape=value=>String(value).replace(/\|/g,'\\|').replace(/\n/g,' '),runtimeStale=(audit.current.runtime.sources??[]).filter(row=>hash(fs.readFileSync(row.file))!==row.sha256).map(row=>row.file),followupStale=(followups.runtime.after??[]).filter(row=>hash(fs.readFileSync(row.file))!==row.sha256).map(row=>row.file);
const lines=[
 '# Executable old/current command comparison','',
 `Generated ${new Date().toISOString()}. This comparison measures parser, mode, prompt and rendered-configuration changes. It does not certify all parameters, native Cisco output or packet behavior.`, '',
 `The full snapshot executed ${audit.summary.attempts} old/current pairs across ${audit.summary.uniqueExecutableModePaths} old executable mode/path registrations (${audit.summary.positivePaths} positive and ${audit.summary.modifierPaths} no/default paths). Model/context deduplication is explicit; these units differ from the current node/path/handler inventory.`, '',
 `Snapshot validity: **${audit.validity}**. Current runtime hash: \`${audit.current.runtime.finish}\`. Runtime sources stale at report generation: ${runtimeStale.length?runtimeStale.join(', '):'none'}. Reference execution fresh: ${audit.reference.freshReferenceExecution}; all492 reference JavaScript hashes verified: ${audit.reference.sourceHashesVerifiedNow}. Reference input hash: \`${audit.reference.sha256}\`. The reference is read-only and excluded from the delivered app.`, '',
 ...table(audit.summary.statuses),
 `${audit.summary.pathsWithNoCurrentCommandExecution} registrations had no current command execution; ${audit.summary.pathsWithNoReferenceCommandExecution} had no reference execution. ${audit.summary.unseededRemovalPaths} removal paths include an unseeded direct-context attempt. Such acceptance does not prove removal of an installed value. Exact setup failures and raw output hashes remain in the JSON.`, '',
 '## Rejection review','',
 `${current.rejections.length} accepted-old/rejected-current fixtures remain. Old acceptance is not the chosen Cisco profile. Invalid arguments, privileged-mode requirements, physical-port restrictions and intentionally unsupported features are retained separately.`, '',
 ...table(counts(current.rejections)),
 '| Exact reference mode/path | Measured invocation | Classification |','| --- | --- | --- |',
 ...current.rejections.map(row=>`| ${escape(row.key)} | \`${escape(row.command)}\` | ${escape(row.category)} |`),'',
 'Router fair-queue/WRED now have packet-backed teaching implementations; rejection on a Catalyst or incompatible class/placement is a measured profile gate. Native OSPF VRF capability/DN-bit behavior, older EtherChannel test syntax and ISL hardware remain bounded or unsupported as documented. No static success response was added to match the old sandbox.', '',
 '## Configuration review','',
 `${current.summary.disagreements} accepted-pair rendered-change-flag differences were reviewed against actual configuration objects where necessary:`, '',
 ...table(current.summary.categories),
 `Potential object mutation omitted from rendering: ${current.disagreements.filter(row=>row.category==='configuration-rendering-omission-candidate').length}. Already-set/default values and old metadata changes do not prove missing packet behavior. Additional current rendering does not prove semantic equivalence. All exact before/after hashes, relevant fields and original eleven mutation candidates remain inspectable in the triage artifact.`, '',
 '## Focused removal and replay checks','',
 `${followups.checks.length} current assertions passed for installed debug-interface removal, populated ERSPAN peer removal, DSCP/policer action negation, invalid navigation and EIGRP BFD export/import. Runtime hash: \`${followups.runtime.afterSha256}\`; stale inputs: ${followupStale.length?followupStale.join(', '):'none'}. Changed inputs relative to the full paired snapshot: ${followups.runtime.changedFromMaster.map(row=>row.file).join(', ')||'none'}. Reference setup failures are retained rather than counted as paired passes.`, '',
 'See [command removal evidence](command-removal-fidelity.md), [congestion evidence](qos-congestion-fidelity.md), [current parser sweep](current-ios-parser-validation.json) and [cross-device integration](cross-device-integration.md). Behavioral and reference levels are separate from this comparison.', '',
 '## Evidence and reproduction','',
 '- [Paired outcomes](command-probe-validation.json)',
 '- [Current triage](command-probe-current-triage.json)',
 '- [Focused followups](command-probe-followups.json)',
 '- [Earlier immutable snapshot index](command-probe-snapshots.json)',
 ...history.snapshots.map(snapshot=>`- [${snapshot.kind} ${snapshot.sha256.slice(0,12)}](${snapshot.artifact.replace('docs/audits/','')})`),'',
 'Run with the project Node24 runtime:','',
 '```sh','node scripts/audit-command-probes.mjs','node scripts/audit-command-probe-triage.mjs --output=docs/audits/command-probe-current-triage.json','node scripts/audit-command-followups.mjs','node scripts/report-command-probes.mjs','```','',
 'Preserve an earlier latest artifact before rerunning it. Every result binds its actual runtime source graph. Passing old/current probes does not establish complete native firmware, operating-system or exam equivalence.'
];
fs.writeFileSync('docs/audits/command-probe-validation.md',lines.join('\n')+'\n');
console.log(JSON.stringify({pairs:audit.summary.attempts,paths:audit.summary.uniqueExecutableModePaths,rejections:current.rejections.length,renderingCandidates:current.disagreements.filter(row=>row.category==='configuration-rendering-omission-candidate').length,followups:followups.checks.length,runtimeStale,followupStale}));
