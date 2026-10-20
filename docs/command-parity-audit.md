# Executable command parity audit

Generated 2026-10-16T21:26:17.848Z. This is an ongoing differential audit, not a declaration of complete command or IOS fidelity.

## IOS output pass (2026-10-20)

The current console pass uses the IOSv 15.9(3)M router and IOSvL2 15.2 switch profiles, Cisco command references, and captured help catalogs to align command descriptions, argument-position help, completion, errors and output formatting. The inventory and closure queue below are historical reference-simulator comparison results, not new measurements or a claim that every IOS argument has been verified.

| Area | Implementation and regression coverage |
| --- | --- |
| Help, completion and errors | `ios-help.ts`, `ios-help-keywords.ts`, `ios-syntax.ts`; `ios-fidelity-help.test.ts` and the existing syntax/completion/terminal suites |
| Configuration | `config-renderer.ts`; `ios-fidelity-config.test.ts` covers IOS ordering, defaults, sections, indentation and save/replay |
| Interfaces and L3 | `ios-show.ts`; `ios-fidelity-interfaces.test.ts` covers interface, route, ARP, discovery, CEF, ACL, NAT and DHCP displays |
| Routing protocols | `ios-show-routing.ts`; `ios-fidelity-routing.test.ts` covers OSPF, EIGRP, BGP, RIP, routing-process summaries and FHRP |
| Switching | `ios-show-l2.ts`; `ios-fidelity-switching.test.ts` covers VLAN, MAC, STP/MST, EtherChannel, LACP/PAgP, VTP and port-security |
| System and probes | `ios-system-show.ts` and CLI handlers; `ios-fidelity-system.test.ts` covers identity, counters, logs, terminals, files, SSH, NTP, ping/traceroute and RSA dialogs |

Final integration corrected BGP's unreachable-peer route claim, EIGRP's neighbor count and `show line` help for configured VTY ranges, and completed ping/traceroute help for IPv6 sources, TTL, data patterns and family/VRF forms. The [validation record](validation.md#ios-output-checkpoint-2026-10-20) records the completed automated and direct-file browser checks. Full IOS equivalence is not claimed: [output boundaries](ios-output-reference.md#deliberate-boundaries-and-remaining-display-scope) distinguish measured state, derived fields, idle placeholders and remaining simplified commands.

## Reproduction

Run with Node 24:

```sh
node scripts/audit-command-parity.mjs
node scripts/audit-command-ledger.mjs
node scripts/report-command-parity.mjs
```

The supplied reference is read only. The harness loads its script order into an isolated Node VM with inert DOM, storage, and wall-timer adapters, runs feature registration, and executes commands against temporary in-memory devices. It does not launch a browser, use a server, or import reference code into the new application. Reference source hashes, command/source anchors, effective registrations, and captured outputs stay in ignored `.research/command-parity/`; the shipped artifact does not include them. Engine traffic, timer behavior, DOM interaction, and real Cisco equipment are not validated by this VM audit. Separate original network tests supply packet/state evidence.

## Inventory boundaries

The reference loads 492 scripts and 65 feature modules across 7 cataloged device models. The merged effective command trees contain 24829 model-expanded rows, 14555 rows with executable handlers, and 6493 image/catalog-only rows. Deduplicating model variants yields 3666 executable mode/path registrations including no/default forms; 1778 positive registrations receive their own path-ledger entry.

An executable registration is not proof that every catalog argument works. The reference grammar sometimes attaches a handler that rejects a catalog-only branch. For example, OSPF `capability vrf-lite` and BGP `bgp bestpath as-path ignore` were rejected by actual reference probes. Hidden and conditional handlers retain their metadata. `no`/`default` twins are mapped to their base handler and are not assumed semantically identical.

Artifacts:

- `reference-manifest.json`: every effective model/mode/path registration, handler/image flags, argument whitelist metadata, source stack, and source hash.
- `current-manifest.json`: context entry results, current descriptors, structural match and all 3,666 paths, including removal/default mappings.
- `probes.json`: independently authored variants plus actual reference test command cases, exact setup, output, prompt/mode, and configuration before/after.
- `path-ledger.json`: every positive registration, source anchors, structural mapping, candidate invocations, actual old/new output, and explicit unresolved state.

## Measured progress

The targeted corpus currently has 473 isolated probes. Classification counts: acceptance-agrees: 422; new-rejects-reference-accepts: 32; new-accepts-reference-rejects: 6; reference-config-changes-new-does-not: 11; new-setup-rejected: 2.

The all-path representative pass reports argument-or-condition-needs-fixture: 599; measured-rejection-gap: 348; accepted-path-representative: 682; reference-context-needs-fixture: 149.

“Accepted path representative” means one invocation reaches an accepting handler on both sides; it does not prove equivalent output, packet behavior, persistence, argument bounds, mode transitions, `no`, or `default`. “Measured rejection gap” includes setup/prerequisite differences that must be resolved before declaring missing functionality. “Needs fixture” remains unverified, rather than silently counted as supported. The ledger intentionally keeps those uncertainties visible.

## Operational corrections verified in original tests

- `tests/command-parity.test.ts`: static route suffix ordering, Null interface aliases, prefix-only deletion, atomic malformed commands, unusable interface subnet addresses, protected VLAN removal, and storm-control interface validation.
- `tests/routing-compat.test.ts`: OSPF reference bandwidth, per-class administrative distance, RIB filtering without deleting LSAs, redistribution seed and external summary withdrawal; EIGRP metric coefficient adjacency, offsets, filters and administrative distance; RIP seed and source distance; modern OSPFv3 IPv6 AF route exchange.
- The mGRE EIGRP lab now explicitly disables split horizon on its hub tunnel, as required for same-interface spoke route advertisements. Default split horizon remains enforced.
- System/debug/output and BGP work is being integrated independently; rerun the corpus after each integration rather than treating this snapshot as final.

## Concrete closure queue

These are actual reference-accepted examples that currently reject or fail to enter their context in the new CLI. They still require a runtime-consumer audit to distinguish operational reference behavior from stored settings. The JSON ledger contains exact captured outputs and all additional cases.

| Mode | Invocation / setup | Reference source |
| --- | --- | --- |
| config-if | `media-type` | at Object.nodes (js/cli/commands/physical.js:149:20) |
| config-if | `ip local-proxy-arp` | at Object.nodes (js/cli/commands/arp.js:82:17) |
| config-if | `ipv6 nd dad attempts 10` | at Object.extend (js/cli/commands/dhcpv6.js:829:24) |
| config-if | `ipv6 nd reachable-time 10` | at Object.extend (js/cli/commands/dhcpv6.js:843:24) |
| config-if | `ipv6 nd cache expire 10` | at Object.extend (js/cli/commands/ipv6.js:912:24) |
| config-ipv6-snooping | `exit` (context: ipv6 snooping policy AUDIT) | at js/cli/registry.js:603:20 |
| config-ipv6-snooping | `end` (context: ipv6 snooping policy AUDIT) | at js/cli/registry.js:619:24 |
| config-device-tracking | `exit` (context: device-tracking policy AUDIT) | at js/cli/registry.js:603:20 |
| config-device-tracking | `end` (context: device-tracking policy AUDIT) | at js/cli/registry.js:619:24 |
| config-cp | `exit` (context: control-plane) | at js/cli/registry.js:603:20 |
| config-cp | `end` (context: control-plane) | at js/cli/registry.js:619:24 |
| config | `ip scp server enable` | at Object.extend (js/cli/commands/http-server.js:127:22) |
| config | `ip nat outside source list 10 pool AUDIT` | at Object.extend (js/cli/commands/nat.js:461:32) |
| config | `ip as-path access-list 10 permit AUDIT` | at Object.extend (js/cli/commands/route-map.js:826:15) |
| config | `ip bgp-community new-format` | at Object.extend (js/cli/commands/route-map.js:845:15) |
| config | `ip local policy route-map AUDIT` | at s (js/cli/commands/route-map.js:807:22) |
| config | `ip flow-export version 5` | at Object.nodes (js/cli/commands/netflow.js:693:24) |
| config | `ip flow-cache timeout active 10` | at Object.nodes (js/cli/commands/netflow.js:722:24) |
| config | `security passwords min-length 10` | at Object.nodes (js/cli/commands/device-access.js:949:20) |
| config | `login block-for 10 attempts 10 within 10` | at Object.nodes (js/cli/commands/device-access.js:964:20) |
| config | `service timestamps` | at Object.nodes (js/cli/commands/device-access.js:1189:17) |
| config | `boot system AUDIT` | at Object.nodes (js/cli/commands/filesystem.js:143:24) |
| config | `bfd slow-timers 1000` | at Object.nodes (js/cli/commands/bfd.js:231:20) |
| config | `control-plane` | at Object.nodes (js/cli/commands/qos.js:683:20) |
| config | `netconf-yang` | at Object.nodes (js/cli/commands/http-server.js:148:13) |
| config | `restconf` | at Object.nodes (js/cli/commands/http-server.js:183:13) |
| config-if | `ip tcp adjust-mss 500` | at Object.extend (js/cli/commands/gre.js:110:22) |
| config-if | `mac-address 0200.0000.0001` | at Object.nodes (js/cli/commands/interfaces.js:825:20) |
| config-if | `keepalive` | at Object.nodes (js/cli/commands/interfaces.js:849:20) |
| config-if | `service-policy input AUDIT` | at Object.nodes (js/cli/commands/qos.js:1053:20) |
| config | `spanning-tree etherchannel guard misconfig` | at Object.nodes (js/cli/commands/stp.js:322:27) |
| config | `spanning-tree pathcost method long` | at Object.nodes (js/cli/commands/stp.js:340:25) |
| config | `spanning-tree pathcost method short` | at Object.nodes (js/cli/commands/stp.js:351:25) |
| config | `spanning-tree extend system-id` | at Object.nodes (js/cli/commands/stp.js:373:21) |
| config | `spanning-tree backbonefast` | at Object.nodes (js/cli/commands/stp.js:418:17) |
| config | `spanning-tree bridge assurance` | at Object.nodes (js/cli/commands/stp.js:425:21) |
| config | `spanning-tree logging` | at Object.nodes (js/cli/commands/stp.js:432:17) |
| config | `spanning-tree transmit hold-count 10` | at Object.nodes (js/cli/commands/stp.js:439:46) |
| config | `spanning-tree portfast edge default` | at Object.nodes (js/cli/commands/stp.js:505:25) |
| config | `spanning-tree portfast edge bpduguard default` | at Object.nodes (js/cli/commands/stp.js:524:31) |
| config | `spanning-tree portfast edge bpdufilter default` | at Object.nodes (js/cli/commands/stp.js:541:31) |
| config | `spanning-tree portfast network default` | at Object.nodes (js/cli/commands/stp.js:561:25) |
| config | `spanning-tree portfast normal default` | at Object.nodes (js/cli/commands/stp.js:579:25) |
| config | `spanning-tree loopguard default` | at Object.nodes (js/cli/commands/stp.js:599:21) |
| config | `vtp pruning` | at Object.nodes (js/cli/commands/vtp.js:261:17) |
| config | `ipv6 neighbor binding` | at h (js/cli/commands/ipv6-fhs.js:138:12) |
| config-vlan | `state active` | at Object.nodes (js/cli/commands/switching.js:554:24) |
| config-ipv6-snooping | `trusted-port` (context: ipv6 snooping policy AUDIT) | at m (js/cli/commands/ipv6-fhs.js:899:18) |
| config-device-tracking | `trusted-port` (context: device-tracking policy AUDIT) | at m (js/cli/commands/ipv6-fhs.js:899:18) |

## Per-mode registration ledger

Every row below is backed by the full machine-readable path ledger. Counts are positive registrations, not argument variants.

| Reference mode | All executable paths | Positive paths | Accepted representative | Rejection / setup gap | Needs fixture |
| --- | ---: | ---: | ---: | ---: | ---: |
| cfg-crypto-trans | 5 | 4 | 2 | 0 | 2 |
| config | 538 | 180 | 75 | 31 | 74 |
| config-applet | 7 | 5 | 3 | 1 | 1 |
| config-archive | 11 | 7 | 6 | 0 | 1 |
| config-arp-nacl | 9 | 5 | 2 | 0 | 3 |
| config-bfd | 15 | 7 | 3 | 3 | 1 |
| config-cmap | 7 | 5 | 2 | 1 | 2 |
| config-cp | 5 | 4 | 0 | 2 | 2 |
| config-crypto-map | 7 | 5 | 3 | 1 | 1 |
| config-device-tracking | 13 | 8 | 0 | 3 | 5 |
| config-dhcp | 19 | 11 | 6 | 0 | 5 |
| config-dhcp-guard | 11 | 7 | 3 | 0 | 4 |
| config-dhcpv6 | 11 | 7 | 4 | 1 | 2 |
| config-ext-nacl | 12 | 6 | 3 | 0 | 3 |
| config-flow-exporter | 13 | 8 | 2 | 1 | 5 |
| config-flow-monitor | 11 | 7 | 2 | 1 | 4 |
| config-flow-record | 9 | 6 | 2 | 1 | 3 |
| config-flow-top-talkers | 9 | 6 | 2 | 0 | 4 |
| config-if | 364 | 126 | 35 | 9 | 82 |
| config-if-range | 364 | 126 | 35 | 9 | 82 |
| config-ip-sla | 9 | 6 | 2 | 0 | 4 |
| config-ip-sla-echo | 12 | 6 | 2 | 0 | 4 |
| config-ip-sla-http | 9 | 6 | 2 | 0 | 4 |
| config-ip-sla-jitter | 9 | 6 | 2 | 0 | 4 |
| config-ipsec-profile | 5 | 4 | 2 | 1 | 1 |
| config-ipv6-acl | 15 | 7 | 3 | 0 | 4 |
| config-ipv6-snooping | 18 | 8 | 0 | 3 | 5 |
| config-isakmp | 13 | 8 | 7 | 0 | 1 |
| config-keychain | 6 | 4 | 3 | 0 | 1 |
| config-keychain-key | 15 | 7 | 3 | 1 | 3 |
| config-line | 79 | 29 | 9 | 0 | 20 |
| config-mon-erspan-dst | 9 | 6 | 4 | 0 | 2 |
| config-mon-erspan-dst-src | 7 | 5 | 2 | 0 | 3 |
| config-mon-erspan-src | 9 | 6 | 4 | 0 | 2 |
| config-mon-erspan-src-dst | 9 | 6 | 2 | 0 | 4 |
| config-mst | 13 | 8 | 4 | 2 | 2 |
| config-nd-inspection | 24 | 10 | 4 | 0 | 6 |
| config-pmap | 5 | 4 | 3 | 0 | 1 |
| config-pmap-c | 21 | 12 | 5 | 3 | 4 |
| config-pmap-c-police | 9 | 6 | 2 | 0 | 4 |
| config-ra-guard | 24 | 10 | 3 | 0 | 7 |
| config-radius-server | 11 | 7 | 0 | 0 | 7 |
| config-red | 5 | 4 | 2 | 0 | 2 |
| config-route-map | 12 | 6 | 3 | 2 | 1 |
| config-router | 118 | 42 | 9 | 14 | 19 |
| config-router-af | 27 | 11 | 3 | 0 | 8 |
| config-router-bgp | 30 | 12 | 11 | 0 | 1 |
| config-router-eigrp | 85 | 31 | 9 | 2 | 20 |
| config-router-eigrp-af | 34 | 14 | 6 | 0 | 8 |
| config-router-eigrp-afi | 39 | 15 | 7 | 1 | 7 |
| config-router-eigrp-aft | 54 | 20 | 6 | 2 | 12 |
| config-router-eigrp-named | 6 | 4 | 2 | 0 | 2 |
| config-router-eigrp-vaf | 59 | 31 | 0 | 12 | 19 |
| config-router-ospfv3 | 67 | 25 | 7 | 6 | 12 |
| config-router-ospfv3-af | 61 | 23 | 7 | 1 | 15 |
| config-router-rip | 60 | 22 | 14 | 7 | 1 |
| config-router-rip-af | 54 | 20 | 0 | 19 | 1 |
| config-rtr | 57 | 21 | 5 | 1 | 15 |
| config-rtr-eigrp | 49 | 19 | 5 | 0 | 14 |
| config-rtr-rip | 24 | 10 | 4 | 4 | 2 |
| config-server-tacacs | 13 | 8 | 0 | 0 | 8 |
| config-sg-radius | 6 | 4 | 0 | 0 | 4 |
| config-sg-tacacs+ | 5 | 4 | 0 | 0 | 4 |
| config-source-guard | 15 | 7 | 2 | 1 | 4 |
| config-std-nacl | 12 | 6 | 3 | 0 | 3 |
| config-subif | 364 | 126 | 34 | 7 | 85 |
| config-time-range | 7 | 5 | 2 | 0 | 3 |
| config-track | 15 | 7 | 2 | 1 | 4 |
| config-vlan | 12 | 7 | 3 | 1 | 3 |
| config-vlan-config | 9 | 6 | 0 | 2 | 4 |
| config-vrf | 15 | 7 | 3 | 1 | 3 |
| config-vrf-af | 7 | 5 | 2 | 1 | 2 |
| priv | 362 | 333 | 176 | 103 | 54 |
| user | 212 | 212 | 97 | 86 | 29 |

## Remaining verification obligations

The command corpus must expand until each unresolved context/argument branch has an explicit accepting, rejecting, stored-only, or operational result. Complete parity also requires stateful before/after tests, save/reload and `no`/`default` round trips, invalid input atomicity, privilege/mode checks, and representative IOS output comparisons. No current count certifies those obligations as complete. Hardware-specific capacity limits, catalog-only branches, and unsupported behavior in the reference are separate from actual executable parity gaps.

Reference input SHA inventory: 492 files in the ignored manifest. REA parent evidence supplied by the coordinating task: ev_a602dcc4ad0755daaa5d3538f05f738ab93e8d6335310c782263be713a6f35e5 (root SHA c876ec258e6f81eb831b7d5d95cb517b78ba6d0e77d155c5df14fc5e4a8089ec). This audit independently derives the registration and command observations.
