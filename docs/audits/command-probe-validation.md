# Executable command probe validation

Generated 2026-10-17T01:03:15.715Z. These are parser, configuration and bounded runtime-condition observations. They do not establish full protocol behavior or native Cisco/Windows equivalence.

## Complete paired snapshot

The complete run measured **4,757 old/current command pairs across 3,666 unique executable mode/path registrations**: 1,778 positive paths and 1,888 no/default paths. The old inventory contains 14,555 model-expanded executable rows. Deduplication does not test every argument on every model.

Fresh old VM execution was attempted for all 3,666 paths. The restored reference's 492 JavaScript hashes match the prior inventory; index.html is separately hashed. DOM, storage and wall-clock timers are inert VM adapters. Reference code is read only and excluded from the simulator build.

Captured 2026-10-17T00:51:32.456Z through 2026-10-17T00:55:10.889Z. Validity: **source-snapshots-stable**. The runtime import graph contains 67 inputs, including package/configuration provenance. Its immutable hash is `b6cc881bc1d33e1a4e76dfee5f6567497c861bd390e4b8d89b3997795f37c4ee`. Reference input hash: `09a65c44ad6f185035cc803f1111ce90348f1b77ebfcc573e4217732be3fd111`. Whole-source hash: `d872009f96f310dc8b61e73a974deec3b369de6f2f19058879f03d6a0d5eb3a3`.

Workspace files changed during the complete run: none. Runtime dependency changes: none. Unrelated UI modules are recorded in the whole-source snapshot but do not invalidate CLI/engine/config-renderer probes. Later focused results are separately bound to their own source snapshot.

| Observation | Paths |
| --- | ---: |
| current-accepts-reference-accepted-representative | 3432 |
| current-rejects-reference-accepted-representative | 87 |
| no-accepting-representative | 47 |
| current-accepts-without-reference-accepted-representative | 100 |

0 paths lack current command execution. 2 paths lack old execution in the complete snapshot: `priv / no debug all` and `priv / no debug interface` used a NETLAB-R2 fixture without a port inventory. The focused followups use the actually registered NETLAB-R4 model and reach both handlers; both current commands accept. The complete snapshot retains the original fixture errors.

137 removal paths include an unseeded direct-context attempt. Parser acceptance there does not prove removal of an installed value. Failed positive preparation is retained, and navigation end/exit is never used to seed a removal test. Exact outputs, setup failures, prompts, modes, configuration deltas and hashes remain inspectable. Known notices for missing ARP interface, invalid MTU/mask/baud and explicit address-family removal restrictions are classified as rejection.

## Refreshed rejection triage

The 87 accepted-old/rejected-current forms below are classification results, not 87 confirmed runtime defects. A stricter native-style command profile can legitimately reject an old sandbox form. Every exact fixture/output is in the supplemental JSON.

| Observation | Paths |
| --- | ---: |
| ARP-legacy-argument-or-prerequisite | 1 |
| removal-operand-compatibility-needs-native-check | 3 |
| IOS-navigation-no-form-restriction | 19 |
| current-port-command-profile-needs-native-check | 2 |
| invalid-legacy-argument-or-prerequisite | 30 |
| privileged-mode-available-followup | 3 |
| EIGRP-summary-legacy-CIDR-or-mask-grammar | 3 |
| OSPF-VRF-capability-root-gap | 3 |
| explicit-address-family-removal-restriction | 6 |
| explicitly-unsupported-congestion-scheduling | 2 |
| EtherChannel-diagnostic-root-gap | 1 |
| fixed-dot1q-current-profile | 12 |
| subinterface-UDLD-removal-profile-needs-native-check | 2 |

Demonstrated positive parser gaps remain for OSPF VRF `capability vrf-lite`, `test etherchannel load-balance`, and the explicitly unsupported `fair-queue`/`random-detect` congestion schedulers. The old EtherChannel diagnostic returned “No members bundled”; that is handler evidence, not proof of an equivalent working algorithm. `negotiation auto` needs a port/profile-specific native assessment. Legacy ISL/negotiate forms are outside the current fixed-dot1q switch profile. User-mode show debugging/AAA/tech-support rejections are separately available after enable. Malformed MTU, masks, baud and CIDR summary fixtures are not evidence of missing routing behavior.

The three removal-operand cases are `no/default snmp-server chassis-id AUDIT` and `no autonomous-system 10`. The current implementation requires the bare removal form; the primary-reference review confirmed that grammar. Subinterface UDLD and explicit address-family removal restrictions remain profile-specific observations. These classifications do not establish correctness for all native hardware/release variants.

## Refreshed configuration-change triage

The refreshed complete snapshot has 387 paired rendered-configuration changed-flag disagreements:

| Observation | Paths |
| --- | ---: |
| current-additional-rendered-state | 257 |
| old-navigation-metadata | 71 |
| default-or-existing-setting-no-observed-mutation | 50 |
| stored-only-or-default-physical-setting | 3 |
| fixed-dot1q-profile-or-default | 6 |

No actual config-object mutation omitted from running configuration remains among these refreshed candidates. The 257 current-additional changes are not missing current mutations; semantic equivalence is still unproven. Fifty no-change fixtures were separately checked against actual config objects and were already configured/default values. Old timestamps account for 71 navigation differences. The physical keepalive notices are explicitly stored-only/default behavior. Fixed-dot1q notices do not demonstrate legacy ISL support. Native default equivalence is not inferred for modeled defaults such as IGMP v3, RIP v2 or IKE settings.

The eleven earlier “old config changed/new did not” cases were freshly rechecked. VTP version 2 and VRF IPv4 address-family now mutate and render correctly. The other nine are already configured/default values or navigation metadata: switchport access twice, modeled IKE pre-share/group 14, end twice, default exporter UDP 2055, event none and RIP version 2. No missing configuration mutation was demonstrated among those eleven.

## Focused repairs at the final source snapshot

The separate followup artifact records **19 passing current assertions**. Its stable runtime graph hash is `b3da3cf8221cacab5bc94f168d5ab1eb494de2d2fb70e3bfebfc2f69404da4c2`. Relative to the complete paired snapshot, only `src/ios-debug.ts` changed. The complete snapshot is not silently rewritten or presented as a complete rerun of this later source.

- Both `no debug interface GigabitEthernet0/0` and `undebug interface GigabitEthernet0/0` accept and remove an installed modeled runtime interface condition. Before/after condition arrays are recorded. The old R4 VM reaches both spellings too; its interactive last-condition message is retained. This is a bounded condition-removal assertion, not full native debug output coverage.
- Four populated ERSPAN source/destination endpoint removals cover no/default forms and verify actual endpoint fields disappear and running configuration changes.
- Configured DSCP and all three policer color actions can be removed with the legacy optional operand; actual properties and running configuration are checked.
- No/default end/exit reject without leaving configuration mode or changing configuration.
- Three EIGRP BFD contexts change configuration and survive running-config export/import, including classic, VRF and named-interface contexts.

The four populated ERSPAN preparations are current-only followups: the old router fixture rejects their ERSPAN setup (4 explicitly retained old setup errors). They are not counted as old/current paired passes. No native packet-convergence claim follows from these configuration tests.

Cisco IOS XE 17.12 documents the no-debug/undebug interface alias in its [Catalyst 9300 interface command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/command_reference/b_1712_9300_cr/interface_and_hardware_commands.html), debug interface usage guidelines. The final source supports that alias in its bounded model; it must not be reported as currently unsupported.

## Archived initial triage

The initial immutable paired snapshot had 4,688 attempts, 24 accepted-old/rejected-current forms and 437 changed-flag disagreements. These are historical observations before classifier, BFD, ERSPAN, QoS and navigation repairs, not current defect counts. Exact source/artifact hashes and compressed copies are retained in the snapshot index.

| Observation | Paths |
| --- | ---: |
| invalid-fixture-or-argument-misclassified-by-legacy-regex | 31 |
| current-additional-rendered-state | 254 |
| old-navigation-metadata | 71 |
| invalid-positive-seed-misclassified-by-legacy-regex | 8 |
| default-or-existing-setting-no-observed-mutation | 50 |
| stored-only-or-default-physical-setting | 3 |
| explicit-removal-restriction-misclassified-by-legacy-regex | 6 |
| configuration-rendering-omission-candidate | 8 |
| fixed-dot1q-profile-or-default | 6 |

The eight actual rendering candidates were EIGRP interface BFD flags: config changed but running configuration omitted them. The refreshed corpus records their rendered changes, and focused export/import checks confirm the three contexts. Thirty-one invalid-argument notices, eight invalid removal seeds and six explicit AF-removal notices were previously classified too permissively; the refreshed helper fixes that classification without modifying stored outputs.

| Initial reference mode/path | Invocation | Historical triage |
| --- | --- | --- |
| config / no snmp-server | `no snmp-server chassis-id AUDIT` | removal-operand-compatibility-needs-native-check |
| config / default snmp-server | `default snmp-server chassis-id AUDIT` | removal-operand-compatibility-needs-native-check |
| config-if / negotiation | `negotiation auto` | current-port-command-profile-needs-native-check |
| config-if-range / negotiation | `negotiation auto` | current-port-command-profile-needs-native-check |
| user / show debugging | `show debugging` | privileged-mode-available-followup |
| user / show aaa | `show aaa servers` | privileged-mode-available-followup |
| user / show tech-support | `show tech-support` | privileged-mode-available-followup |
| config-router / capability vrf-lite | `capability vrf-lite` | OSPF-VRF-capability-root-gap |
| config-router-eigrp-vaf / no autonomous-system | `no autonomous-system 10` | removal-operand-compatibility-needs-native-check |
| config-pmap-c / fair-queue | `fair-queue` | explicitly-unsupported-congestion-scheduling |
| config-pmap-c / random-detect | `random-detect` | explicitly-unsupported-congestion-scheduling |
| config-pmap-c / no set | `no set dscp 10` | removal-operand-compatibility-needs-native-check |
| config-pmap-c-police / no conform-action | `no conform-action drop` | removal-operand-compatibility-needs-native-check |
| config-pmap-c-police / no exceed-action | `no exceed-action drop` | removal-operand-compatibility-needs-native-check |
| config-pmap-c-police / no violate-action | `no violate-action drop` | removal-operand-compatibility-needs-native-check |
| priv / test etherchannel load-balance | `test etherchannel load-balance interface Port-channel1 ip 192.0.2.1 192.0.2.2` | EtherChannel-diagnostic-root-gap |
| config-if / switchport trunk encapsulation isl | `switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if / switchport trunk encapsulation negotiate | `switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-if-range / switchport trunk encapsulation isl | `switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if-range / switchport trunk encapsulation negotiate | `switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-subif / no udld | `no udld` | subinterface-UDLD-removal-profile-needs-native-check |
| config-subif / default udld | `default udld` | subinterface-UDLD-removal-profile-needs-native-check |
| config-mon-erspan-src / no destination | `no destination` | ERSPAN-endpoint-removal-grammar-gap |
| config-mon-erspan-dst / no source | `no source` | ERSPAN-endpoint-removal-grammar-gap |

## Reproduction and evidence

Use the project Node version (captured v24.22.0 on darwin/arm64). Audit commands operate on isolated in-memory devices and read the old source without modifying or bundling it. Running the corpus overwrites the working latest artifact; archive it first if preserving another observation.

```sh
node scripts/audit-command-ledger.mjs
node scripts/audit-command-probes.mjs
node scripts/audit-command-probe-triage.mjs --output=docs/audits/command-probe-current-triage.json
node scripts/audit-command-followups.mjs
node scripts/report-command-probes.mjs
```

- [Complete paired outcomes](command-probe-validation.json): canonical path, mode, node/context, exact commands, outputs, state deltas and exact source hashes. Truncation retains full-output hashes and lengths.
- [Current supplemental triage](command-probe-current-triage.json): all 87 exact rejection fixtures, 387 classifications, actual config-object checks and original eleven-case recheck.
- [Final focused followups](command-probe-followups.json): final runtime source hashes, the one changed module, bounded assertions, explicit old setup errors and BFD import evidence.
- [Initial supplemental triage](command-probe-triage.json): historical 437 classifications and 24 rejection fixtures; use its basis hash and archive index to retrieve the exact old main snapshot.
- [Immutable snapshot index](command-probe-snapshots.json): full hashes and compressed earlier observations.
- [command-probe-validation 59412c44b997](command-probe-validation.59412c44b997.json.gz): runtime `98f6523e6010ed4df5588e0e4a30d3d4b459e2ccf8198711b73c9b5094e6f98c`.
- [command-probe-triage 6e56aeaf8480](command-probe-triage.6e56aeaf8480.json.gz): runtime `98f6523e6010ed4df5588e0e4a30d3d4b459e2ccf8198711b73c9b5094e6f98c`.

This audit does not establish packet forwarding, protocol convergence, GUI behavior, complete saved-lab persistence, native output formatting, all arguments, every hardware model or complete CCNA/CCNP coverage. Separate behavior tests and primary references remain necessary.
