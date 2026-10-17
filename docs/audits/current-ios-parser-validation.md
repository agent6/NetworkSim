# Current IOS parser and interaction audit
Generated from [the retained JSON](current-ios-parser-validation.json), SHA256 `613105b070085854c6394eaa604cf8ebf35ea65919253dc0c4550e6a2ab06863`. Evidence captured 2026-10-17T02:20:01.426Z. **Full requested matrix is source-current at report generation.**
Runtime source digest: `00665b72e0c631e9769dd3f3b14c515c4879082f5e7269d21dec912aad1e46b2`; exact registry digest: `ea03485c0939e3c616d82526b7e20993686dc8ee7127406ea9deca5d0a7afc73`. The JSON retains every source file hash, canonical path/registered-handler identity, mode/setup, hardware profile, command, output hash/text, rejection, config-state digest/change flag and observed dispatcher selection.
## Measured scope
The independent current-only harness indexed **6043 node/path/handler definitions**, selected **6043** registrations, and found an accepted positive representative for **5928**. **0** definitions were not selected. It retained **21791** invocation observations, including actual no/default attempts. 5245 definitions called their registered body at least once; 836 used the selected registration with a shared operational formatter at least once (these counts can overlap).
This audit certifies **0 fully behavior/native-equivalent IOS definitions**. Parser reachability/rejection, help safety and bounded known-invalid atomicity do not establish forwarding, every argument, all failure states, persistence semantics or native Cisco output. Protocol and GUI regressions remain separate evidence. Shared handler peers are never promoted without their own actual node/path/hash selection.
| IOS node | Indexed definitions | Positive representatives | Selected registrations |
| --- | ---: | ---: | ---: |
| router | 1008 | 992 | 1008 |
| switch | 991 | 971 | 991 |
| l3switch | 1019 | 1006 | 1019 |
| poeswitch | 993 | 973 | 993 |
| wlc | 1039 | 1016 | 1039 |
| ap | 993 | 970 | 993 |

The AP matrix records its ordinary lightweight profile and the separately selected generic standalone teaching profile. Standalone preparation uses the same validated public AP profile form action, followed by normal CLI SSID/radio entry; power still requires an actual PoE switch connection. LLDP-MED network-policy contexts are entered on the three switch profiles. Only observed hardware profiles/modes/arguments are evidenced; one accepted representative does not cover every inherited context.

## Help, validation and unresolved representative forms
Root/context help-completion safety failures: **0**. Per-command help-completion safety failures: **0**. Known-invalid contract cases: **54**, failures: **0**. The safety snapshot includes configuration/runtime, mode/prompt/history, events, clock time, queued timers and random state.
Known-invalid cases check selected hostname/process/mask/SSH/MTU/line-timeout bounds plus no/default navigation rejection and configuration/mode atomicity. They are bounded independent fixtures, not an exhaustive Cisco invalid-input oracle.
| Canonical path | Nodes | Assessment |
| --- | --- | --- |
| show ip dhcp | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| show ip nat | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| show ip igmp | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| show aaa | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| router | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| spanning-tree | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| vtp | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| ip access-list | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| ip nat | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| spanning-tree mode pvst | router, wlc, ap | observed-simulator-profile-gate |
| spanning-tree mode rapid-pvst | router, wlc, ap | observed-simulator-profile-gate |
| spanning-tree mode mst | router, wlc, ap | observed-simulator-profile-gate |
| spanning-tree vlan | router, wlc, ap | observed-simulator-profile-gate |
| spanning-tree mst configuration | router, wlc, ap | observed-simulator-profile-gate |
| switchport mode | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| transport input | router, switch, l3switch, poeswitch, wlc, ap | required-subcommand-branch-registration |
| config-register | switch, poeswitch, wlc, ap | observed-simulator-profile-gate |
| ip routing | switch, poeswitch, wlc, ap | observed-simulator-profile-gate |
| ipv6 unicast-routing | switch, poeswitch, wlc, ap | observed-simulator-profile-gate |
| router eigrp | switch, poeswitch, wlc, ap | observed-simulator-profile-gate |
| router rip | switch, poeswitch, wlc, ap | observed-simulator-profile-gate |
| router bgp | switch, poeswitch, wlc, ap | observed-simulator-profile-gate |
| router ospf | switch, poeswitch, wlc, ap | observed-simulator-profile-gate |
| fair-queue | switch, l3switch, poeswitch | observed-simulator-profile-gate |
| random-detect | switch, l3switch, poeswitch | observed-simulator-profile-gate |

A required-subcommand branch is actually selected by its bare incomplete invocation; a successful longer command selects a separately registered child. That is retained as branch/parser evidence, not a missing protocol implementation or a claimed successful call to the parent handler. Simulator profile gates are measured rejections only: this audit does not turn them into a universal native hardware exclusion. Any remaining no-positive fixture is retained explicitly.

## Provenance and boundaries
The harness imports only current-owned source. Older paired observations contribute **invocation strings and setup data only**, never old implementation, expected acceptance or state. The input version is hashed at read start and retained as a compressed snapshot outside the application bundle; later paired runs do not replace that captured input. Paired runs retain their own source/timing/validity and must be assessed separately; no prior acceptance or state result is reused. Contexts and argument fixtures are independently authored; speculative generated candidates keep their actual rejection instead of being labeled valid.

[Phase-local registry delta](phase2-command-registry-delta.json) separately compares the parent-provided immutable pre-phase2 current-owned source archive with the later current registry. Added/removed paths, changed function-text definitions and changed context availability are distinct; a function hash change is not automatically a repaired command. The extracted source baseline stays outside the bundled application.

[IOS FTP client scope and packet/import regressions](ios-ftp-client-fidelity.md) and the host/automation inventories retain separate behavior evidence. [Measured repairs](parser-audit-repairs.md) documents the concrete IGMP dispatcher, summary-metric, dot1q help and literal-profile persistence fixes with actual packet/interaction regressions. The 44 declared Windows variants and 43 Linux/macOS variants are separate inventories and do not inflate these IOS counts. The dedicated Phone is a separate non-CLI surface, not an invented Windows/IOS shell.
