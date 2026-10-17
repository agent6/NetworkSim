# Executable old/current command comparison

Generated 2026-10-17T02:17:37.104Z. This comparison measures parser, mode, prompt and rendered-configuration changes. It does not certify all parameters, native Cisco output or packet behavior.

The full snapshot executed 4748 old/current pairs across 3666 old executable mode/path registrations (1778 positive and 1888 no/default paths). Model/context deduplication is explicit; these units differ from the current node/path/handler inventory.

Snapshot validity: **source-snapshots-stable**. Current runtime hash: `00665b72e0c631e9769dd3f3b14c515c4879082f5e7269d21dec912aad1e46b2`. Runtime sources stale at report generation: none. Reference execution fresh: true; all492 reference JavaScript hashes verified: true. Reference input hash: `09a65c44ad6f185035cc803f1111ce90348f1b77ebfcc573e4217732be3fd111`. The reference is read-only and excluded from the delivered app.

| Observation | Paths |
| --- | ---: |
| current-accepts-reference-accepted-representative | 3434 |
| current-rejects-reference-accepted-representative | 85 |
| no-accepting-representative | 46 |
| current-accepts-without-reference-accepted-representative | 101 |

0 registrations had no current command execution; 2 had no reference execution. 135 removal paths include an unseeded direct-context attempt. Such acceptance does not prove removal of an installed value. Exact setup failures and raw output hashes remain in the JSON.

## Rejection review

85 accepted-old/rejected-current fixtures remain. Old acceptance is not the chosen Cisco profile. Invalid arguments, privileged-mode requirements, physical-port restrictions and intentionally unsupported features are retained separately.

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
| EtherChannel-diagnostic-root-gap | 1 |
| fixed-dot1q-current-profile | 12 |
| subinterface-UDLD-removal-profile-needs-native-check | 2 |

| Exact reference mode/path | Measured invocation | Classification |
| --- | --- | --- |
| config\|arp | `arp 192.0.2.1 0200.0000.0001` | ARP-legacy-argument-or-prerequisite |
| config\|no snmp-server | `no snmp-server chassis-id AUDIT` | removal-operand-compatibility-needs-native-check |
| config\|no exit | `no exit` | IOS-navigation-no-form-restriction |
| config\|no end | `no end` | IOS-navigation-no-form-restriction |
| config\|default snmp-server | `default snmp-server chassis-id AUDIT` | removal-operand-compatibility-needs-native-check |
| config\|default exit | `default exit` | IOS-navigation-no-form-restriction |
| config\|default end | `default end` | IOS-navigation-no-form-restriction |
| config-if\|negotiation | `negotiation auto` | current-port-command-profile-needs-native-check |
| config-if\|mtu | `mtu 64` | invalid-legacy-argument-or-prerequisite |
| config-vlan\|no exit | `no exit` | IOS-navigation-no-form-restriction |
| config-if-range\|negotiation | `negotiation auto` | current-port-command-profile-needs-native-check |
| config-if-range\|mtu | `mtu 64` | invalid-legacy-argument-or-prerequisite |
| config-subif\|mtu | `mtu 64` | invalid-legacy-argument-or-prerequisite |
| user\|show debugging | `show debugging` | privileged-mode-available-followup |
| user\|show aaa | `show aaa servers` | privileged-mode-available-followup |
| user\|show tech-support | `show tech-support` | privileged-mode-available-followup |
| config-if\|ip summary-address eigrp | `ip summary-address eigrp 10 192.0.2.0/24` | EIGRP-summary-legacy-CIDR-or-mask-grammar |
| config-if\|no ip summary-address eigrp | `no ip summary-address eigrp 10 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-if\|default ip summary-address eigrp | `default ip summary-address eigrp 10 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-if-range\|ip summary-address eigrp | `ip summary-address eigrp 10 192.0.2.0/24` | EIGRP-summary-legacy-CIDR-or-mask-grammar |
| config-if-range\|no ip summary-address eigrp | `no ip summary-address eigrp 10 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-if-range\|default ip summary-address eigrp | `default ip summary-address eigrp 10 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-subif\|ip address | `ip address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-subif\|ip summary-address eigrp | `ip summary-address eigrp 10 192.0.2.0/24` | EIGRP-summary-legacy-CIDR-or-mask-grammar |
| config-subif\|no ip address | `no ip address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-subif\|no ip summary-address eigrp | `no ip summary-address eigrp 10 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-subif\|default ip address | `default ip address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-subif\|default ip summary-address eigrp | `default ip summary-address eigrp 10 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-line\|speed | `speed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|txspeed | `txspeed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|rxspeed | `rxspeed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|no speed | `no speed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|no txspeed | `no txspeed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|no rxspeed | `no rxspeed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|default speed | `default speed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|default txspeed | `default txspeed 10` | invalid-legacy-argument-or-prerequisite |
| config-line\|default rxspeed | `default rxspeed 10` | invalid-legacy-argument-or-prerequisite |
| config-router\|network | `network 192.0.2.1 192.0.2.1 area 10` | invalid-legacy-argument-or-prerequisite |
| config-router\|capability vrf-lite | `capability vrf-lite` | OSPF-VRF-capability-root-gap |
| config-router\|no network | `no network 192.0.2.1 192.0.2.1 area 10` | invalid-legacy-argument-or-prerequisite |
| config-router\|no address-family | `no address-family ipv4 unicast` | explicit-address-family-removal-restriction |
| config-router\|no capability vrf-lite | `no capability vrf-lite` | OSPF-VRF-capability-root-gap |
| config-router\|default network | `default network 192.0.2.1 192.0.2.1 area 10` | invalid-legacy-argument-or-prerequisite |
| config-router\|default address-family | `default address-family ipv4 unicast` | explicit-address-family-removal-restriction |
| config-router\|default capability vrf-lite | `default capability vrf-lite` | OSPF-VRF-capability-root-gap |
| config-router-ospfv3\|no address-family | `no address-family ipv4` | explicit-address-family-removal-restriction |
| config-router-ospfv3\|default address-family | `default address-family ipv4` | explicit-address-family-removal-restriction |
| config-router-ospfv3-af\|no exit-address-family | `no exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-ospfv3-af\|default exit-address-family | `default exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-bgp\|aggregate-address | `aggregate-address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-router-bgp\|no aggregate-address | `no aggregate-address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-router-bgp\|default aggregate-address | `default aggregate-address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-router-af\|aggregate-address | `aggregate-address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-router-af\|no aggregate-address | `no aggregate-address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-router-af\|no exit-address-family | `no exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-af\|default aggregate-address | `default aggregate-address 192.0.2.1 192.0.2.1` | invalid-legacy-argument-or-prerequisite |
| config-router-af\|default exit-address-family | `default exit-address-family` | IOS-navigation-no-form-restriction |
| config-vrf-af\|no exit-address-family | `no exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-eigrp-vaf\|no autonomous-system | `no autonomous-system 10` | removal-operand-compatibility-needs-native-check |
| config-router-eigrp-vaf\|no exit-address-family | `no exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-eigrp-named\|no address-family | `no address-family ipv4 autonomous-system 10` | explicit-address-family-removal-restriction |
| config-router-eigrp-named\|default address-family | `default address-family ipv4 autonomous-system 10` | explicit-address-family-removal-restriction |
| config-router-eigrp-af\|no exit-address-family | `no exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-eigrp-af\|default exit-address-family | `default exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-eigrp-afi\|no exit-af-interface | `no exit-af-interface` | IOS-navigation-no-form-restriction |
| config-router-eigrp-afi\|default exit-af-interface | `default exit-af-interface` | IOS-navigation-no-form-restriction |
| config-router-eigrp-aft\|no exit-af-topology | `no exit-af-topology` | IOS-navigation-no-form-restriction |
| config-router-eigrp-aft\|default exit-af-topology | `default exit-af-topology` | IOS-navigation-no-form-restriction |
| config-router-rip-af\|no exit-address-family | `no exit-address-family` | IOS-navigation-no-form-restriction |
| config-router-rip-af\|default exit-address-family | `default exit-address-family` | IOS-navigation-no-form-restriction |
| priv\|test etherchannel load-balance | `test etherchannel load-balance interface Port-channel1 ip 192.0.2.1 192.0.2.2` | EtherChannel-diagnostic-root-gap |
| config-if\|switchport trunk encapsulation isl | `switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if\|switchport trunk encapsulation negotiate | `switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-if\|no switchport trunk encapsulation isl | `no switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if\|no switchport trunk encapsulation negotiate | `no switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-if\|default switchport trunk encapsulation isl | `default switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if\|default switchport trunk encapsulation negotiate | `default switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-if-range\|switchport trunk encapsulation isl | `switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if-range\|switchport trunk encapsulation negotiate | `switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-if-range\|no switchport trunk encapsulation isl | `no switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if-range\|no switchport trunk encapsulation negotiate | `no switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-if-range\|default switchport trunk encapsulation isl | `default switchport trunk encapsulation isl` | fixed-dot1q-current-profile |
| config-if-range\|default switchport trunk encapsulation negotiate | `default switchport trunk encapsulation negotiate` | fixed-dot1q-current-profile |
| config-subif\|no udld | `no udld` | subinterface-UDLD-removal-profile-needs-native-check |
| config-subif\|default udld | `default udld` | subinterface-UDLD-removal-profile-needs-native-check |

Router fair-queue/WRED now have packet-backed teaching implementations; rejection on a Catalyst or incompatible class/placement is a measured profile gate. Native OSPF VRF capability/DN-bit behavior, older EtherChannel test syntax and ISL hardware remain bounded or unsupported as documented. No static success response was added to match the old sandbox.

## Configuration review

387 accepted-pair rendered-change-flag differences were reviewed against actual configuration objects where necessary:

| Observation | Paths |
| --- | ---: |
| current-additional-rendered-state | 257 |
| old-navigation-metadata | 71 |
| default-or-existing-setting-no-observed-mutation | 50 |
| stored-only-or-default-physical-setting | 3 |
| fixed-dot1q-profile-or-default | 6 |

Potential object mutation omitted from rendering: 0. Already-set/default values and old metadata changes do not prove missing packet behavior. Additional current rendering does not prove semantic equivalence. All exact before/after hashes, relevant fields and original eleven mutation candidates remain inspectable in the triage artifact.

## Focused removal and replay checks

19 current assertions passed for installed debug-interface removal, populated ERSPAN peer removal, DSCP/policer action negation, invalid navigation and EIGRP BFD export/import. Runtime hash: `00665b72e0c631e9769dd3f3b14c515c4879082f5e7269d21dec912aad1e46b2`; stale inputs: none. Changed inputs relative to the full paired snapshot: none. Reference setup failures are retained rather than counted as paired passes.

See [command removal evidence](command-removal-fidelity.md), [congestion evidence](qos-congestion-fidelity.md), [current parser sweep](current-ios-parser-validation.json) and [cross-device integration](cross-device-integration.md). Behavioral and reference levels are separate from this comparison.

## Evidence and reproduction

- [Paired outcomes](command-probe-validation.json)
- [Current triage](command-probe-current-triage.json)
- [Focused followups](command-probe-followups.json)
- [Earlier immutable snapshot index](command-probe-snapshots.json)
- [command-probe-validation 59412c44b997](command-probe-validation.59412c44b997.json.gz)
- [command-probe-triage 6e56aeaf8480](command-probe-triage.6e56aeaf8480.json.gz)

Run with the project Node24 runtime:

```sh
node scripts/audit-command-probes.mjs
node scripts/audit-command-probe-triage.mjs --output=docs/audits/command-probe-current-triage.json
node scripts/audit-command-followups.mjs
node scripts/report-command-probes.mjs
```

Preserve an earlier latest artifact before rerunning it. Every result binds its actual runtime source graph. Passing old/current probes does not establish complete native firmware, operating-system or exam equivalence.
