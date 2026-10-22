# CML operational command fidelity audit

The requested 20 commands were captured on IOSv 15.9(3)M12, IOL XE 17.18.02, IOSvL2 2020, and Nexus 9300v 10.6.2.F, using CML 2.10.0+build.13. The complete run finished on 2026-10-22 UTC (2026-10-21 in Arizona). Fourteen positive operational tests pass in both CML and NetworkSim; 80 exact command observations and five PCAPs containing 1,124 packets were collected. No captured CLI timeout or evidence integrity gate failed. This validates this topology and these versions, not complete IOS/NX-OS equivalence.

The reusable procedure is in [CML conformance](../cml-conformance.md). The versioned scenario is `scripts/cml/scenarios/operations.json`; reviewed facts, command availability, image IDs, reference patterns and SHA-256 hashes are in `scripts/cml/fixtures/operations-observations.json`. Full configurations, console dumps and PCAPs remain private under `.cache/cml-runs/operations-02/`. The raw comparison and replay are `.cache/cml-runs/operations-comparison.json` and `.cache/cml-runs/operations-replay.json`.

## Baseline and actual forwarding evidence

IOSv connects through IOSvL2 and redundant VLAN 10 trunks to Nexus. Nexus routes to an IOL XE NAT router, which connects to an outside IOSv router and loopback destination. Positive checks verify FULL OSPF neighbors, IPv4 round trips through PAT, live translations, ACL hit counters, IPv6 round trips through static routes, Nexus STP root status, an IOSvL2 alternate blocking port, learned MAC entries, CDP and received LLDP.

The completed run is explicitly a **warm owned-lab observation**. Initial run `operations-01` passed 13 checks and failed its final assumption that Nexus would learn IOSvL2 through LLDP. It remains a failed reference, not a pass. A read-only survey and wire capture established that Nexus learned IOL XE on the routed link, while IOSvL2 advertised on the trunks without appearing in the Nexus neighbor table. A diagnostic Nexus native-VLAN allowance change did not resolve this and was restored. The completed scenario tests the proven routed LLDP adjacency; the trunk interoperability difference remains recorded. Its actual running configurations are captured and the earlier report is hashed. No new configuration step is claimed as validated by warm replay.

Five intact link captures contain 263 OSPF, 450 STP, 51 CDP, 80 LLDP, 56 ICMP and 81 ICMPv6 frames. The sum includes additional protocols beyond these decoded categories. Warm ARP caches meant no new ARP exchanges; ARP is not claimed from this capture. All owned diagnostic labs are stopped or unstarted; the pre-existing user lab was left running.

## Requested command availability

“Yes” below means that exact command was accepted on the captured image. Empty output or command acceptance alone does not prove runtime behavior. NetworkSim's column lists its IOS router and NS-OS switch surfaces; its IOS switches additionally implement the switch MAC table.

| Command | IOSv | IOL XE | IOSvL2 | Nexus | Sim IOS router / NS-OS | Result or boundary |
|---|---|---|---|---|---|---|
| `show version` | Yes | Yes | Yes | Yes | Yes / Yes | Explicit virtual NetSim identity/capacity |
| `show inventory` | Yes | Yes | Yes | Yes | Yes / Yes | Explicit virtual NetSim identity/capacity |
| `show environment` | No | No | No | Yes | No / No | No sensor model; explicit rejection |
| `show processes cpu` | Yes | Yes | Yes | Yes | No / No | Unavailable process/allocator telemetry; explicit rejection |
| `show processes memory` | Yes | Yes | Yes | Yes | No / No | Unavailable process/allocator telemetry; explicit rejection |
| `show memory statistics` | Yes | Yes | Yes | No | No / No | Unavailable process/allocator telemetry; explicit rejection |
| `show clock` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show logging` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show users` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show interfaces` | Yes | Yes | Yes | No | Yes / No | IOS form; NX-OS uses singular `show interface` |
| `show ip interface brief` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show ip route` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show ipv6 route` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show spanning-tree` | Yes | Yes | Yes | Yes | Yes / Yes | Real L2 instances; routers report no instance |
| `show mac address-table` | No | No | Yes | Yes | No / Yes | Switch-only in tested profiles |
| `show cdp neighbors detail` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show lldp neighbors detail` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show ip ospf neighbor` | Yes | Yes | Yes | Yes | Yes / Yes | State-backed view |
| `show ip nat translations` | Yes | Yes | Yes | No | Yes / No | IOS PAT verified by round-trip traffic; NS-OS excluded |
| `show access-lists` | Yes | Yes | Yes | Yes | Yes / No | IOS ACL configuration/counters work; NS-OS ACL surface excluded |

## Implemented corrections

- Nexus-style IPv4/IPv6 route headings, attached/local routes, grouped next hops and actual route ages; default and named VRF isolation. Routes are read from the installed RIB.
- Nexus-style IP interface brief, STP roots and port roles, dotted MAC table, OSPF priority/role/up time, discovery detail, clock, logging and user-session views. Untracked Linux PIDs and login dates display `-`; hardware facilities and linecard statistics are not fabricated.
- Fresh Nexus-style devices now use short STP path costs. Short/long selection changes real tree costs, persists in configuration, and replays successfully. Existing saved explicit long settings retain their value. This matches the observed 1 Gb/s cost of 4 and [Cisco's Rapid PVST+ defaults](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/104x/configuration/layer-2-switching/cisco-nexus-9000-series-nx-os-layer-2-switching-configuration-guide-104x/m-configuring-rapid-pvst.html).
- Nexus-style OSPF now uses the [40 Gb/s default reference bandwidth](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/unicast-routing-configuration/cisco-nexus-9000-series-nx-os-unicast-routing-configuration-guide/m_configuring_ospfv2.html). Received OSPF snapshots preserve effective interface bandwidth and reference values so remote SPF calculations retain the advertised cost. The reference IOS route to 198.51.100.0/30 has metric 41; the simulator previously returned 2 and now returns 41.
- OSPF neighbor up time starts at the actual FULL transition and survives discarded event history. Discovery caches now retain advertised MAC identity and both IPv4/IPv6 management addresses. Queries never read an unreceived change from a remote device's current configuration.
- IOS five-minute input/output rates and load are calculated from actual counted packet/byte samples. Counter clearing records the real clear time. Storage is bounded to one-second buckets over 300 seconds. This rolling mean is an educational approximation of IOS's decayed averaging, not an exact hardware algorithm.
- ICMP PAT output uses the translated identifier in outside-global and the original identifier in outside-local, matching the observed IOL XE tuple. NAT table column widths follow the captured layout; translated allocations still belong to the simulator, not Cisco's allocator.
- Router `show mac address-table` is rejected, matching both tested router images. NS-OS does not accept IOS's plural `show interfaces` alias.
- Fabricated process lists, PIDs, hash-derived CPU utilization and fixed allocator usage were removed. CPU/process and allocator-memory views explicitly reject because per-device telemetry does not exist in the shared JavaScript engine. No sensor model or NS-OS ACL/NAT configuration stubs were added.

## Remaining differences and exclusions

The strict comparison remains **`output-review-required`, with 90 raw output differences** across 14 steps plus 80 observations. It deliberately preserves numeric fields. No output-equivalence pass or complete platform certification is claimed.

Differences include NetSim identity/serials/MACs/profile capacities and mapped interface names; warm versus fresh timestamps, counters, traffic volumes, PAT allocations and OSPF DR/BDR election order; the observed Nexus–IOSvL2 LLDP gap; and virtual hardware/system detail. Nexus locally programmed gateway MAC rows and hardware port names are not reproduced as learned rows. Native logging facility tables, Linux process IDs and physical environmental information have no simulator counterpart. Legacy IOS interface hardware queue/error placeholders, simplified logging/system output, IPv6 receive routes and platform-specific detail still differ. See [IOS output boundaries](../ios-output-reference.md) for the broader presentation scope.

There are 13 command-acceptance differences: nine IOS CPU/process/allocator views, Nexus environment and two process views, and Nexus ACL display. Cisco accepts those forms; NetworkSim rejects them explicitly. On this Nexus image, `show access-lists` is accepted with an empty result, but NS-OS has no implemented ACL configuration surface. That does not justify returning a fake successful ACL view. NX-OS `show memory statistics`, `show interfaces`, and `show ip nat translations` are rejected on both sides in these exact forms.

The existing management workflow separately covers VTY/SSH admission and authentication. Unsupported stored-only configuration remains rejected atomically. The application stays a fully offline HTML simulator; CML access is only a developer capture tool.

## Final validation

`npm run check` passed after the implementation: TypeScript type checking, **1,175/1,175 tests**, and the standalone Tailwind build. All 10 offline Python evidence-workflow tests pass. The final management replay retains 98/98 passing steps and its 17 documented raw differences; the operational replay retains 14/14 passing steps, 80 observations, 90 documented raw differences and zero evidence-gate problems. Root `index.html` and `dist/index.html` are byte-identical offline bundles. `git diff --check` is clean.
