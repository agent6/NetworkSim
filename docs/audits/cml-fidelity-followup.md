# CML fidelity follow-up: all 90 original differences

This audit follows the [first 20-command audit](cml-operational-fidelity.md). Every one of its 90 strict output differences has an individual [disposition](cml-90-differences.md) and a [source-bound JSON record](../../scripts/cml/fixtures/operations-difference-ledger.json). Reviewing all 90 is not a claim that all native output is identical. The original report, numeric values and its SHA-256 remain intact.

## Implemented behavior

- **STP and SVI autostate:** an SVI needs an active VLAN and an operational member forwarding that VLAN. Root/loop/Bridge Assurance blocking cannot keep the SVI up merely because the physical cable is up. A changed STP state refreshes connected/local routing entries; recovery restores them. Legacy imported VLAN records without an active flag default to active, while explicitly suspended VLANs remain down. Locally programmed gateway MAC entries follow the same SVI state.
- **Switch management gateway:** `ip default-gateway` still carries switch-originated management traffic when IP routing is disabled, but is excluded from the routed default shown by `show ip route`. Enabling IP routing removes the host-mode gateway fallback. The original CML SVI-down snapshot was transient; follow-up CML inspection found its SVI up with C/L routes and no routed default.
- **Working NS-OS OSPF reference bandwidth:** `auto-cost reference-bandwidth N [Mbps|Gbps]` changes advertised interface cost and remote SPF results, validates its range, saves and replays, and resets to the 40,000-Mbps default with `no auto-cost reference-bandwidth`. CML and the simulator both change the IOS remote route metric from 41 to 11 at 10,000 Mbps and restore 41 after removal.
- **Working bounded NS-OS IPv4 RACL:** explicit sequence entries for `permit|deny ip|icmp`, with `any`, `host` or IPv4 CIDR addresses; `statistics per-entry` gates actual counter collection; outbound attachment to routed physical Ethernet; entry deletion; ACL deletion; native display; NVGEN and configuration replay. Empty and deleted ACLs permit forwarding, and deleting an ACL leaves its interface reference. Duplicate sequence numbers reject without replacing an entry. Unsupported directions, attachment types and qualifiers reject without changing configuration.
- **Discovery:** received advertisements now preserve stable chassis identity separately from port MACs, interface versus management addresses, IPv4/IPv6, CDP native VLAN/VTP domain and LLDP supported versus enabled capabilities. An unaddressed switchport can advertise SVI management. Loss preserves the last received values rather than exposing a peer's unreceived configuration changes.
- **Logging:** console, monitor, buffer and trap counters count their own eligible/delivered events. Console delivery works independently of `terminal monitor`; remote monitor polling does not renew idle sessions. NS-OS has native log timestamps, default severity and real asynchronous monitor delivery.
- **Operational output:** empty IOS NAT and uninitialized IPv6 tables return no fabricated table; an absent IOS OSPF neighbor process returns empty output. Native interface detail reports actual counters and short/long rolling rates, effective bandwidth and SVI autostate. NS-OS IP brief uses native SVI-before-Ethernet ordering. Hardware-only counters are not invented for the new native view.

`tests/cml-fidelity-regressions.test.ts`, `tests/discovery.test.ts` and the CML workflow tests verify forwarding, negative cases, recovery, read-only displays, cached advertisement loss and configuration replay. Existing debug tests drain initial link-state console events before isolating subsequent debug traffic; terminal-monitor tests configure console severity separately.

## Native evidence and limits

The original owned operations lab was used for versioned supplemental probes, with before/after running configurations and five-link PCAPs for each batch. Private reports are under `.cache/cml-next/live-02`, `live-03` and `live-04`; [reviewed supplemental facts and hashes](../../scripts/cml/fixtures/fidelity-supplemental-observations.json) are exported separately. Controller secrets and full dumps are excluded from the repository.

The Nexus egress probe produced successful baseline pings, then **0/3** replies and **three deny matches**, then **3/3** after detachment. A separate run confirmed empty ACL forwarding, rejection of a duplicate sequence, and **3/3** recovery after deleting the applied ACL while retaining the interface binding. Ingress and SVI probes accepted configuration but did not enforce the tested traffic on this reference image. Those paths do **not** qualify as validation and are not exposed as supported NS-OS configuration.

A separate root-guard probe blocked both VLAN10 members while physical links stayed up. Native `show interface Vlan10` then reported down with autostate enabled; priority/guard recovery restored the SVI and successful pings. The reproducible follow-up scenario additionally checks route withdrawal and recovery. The virtual linecard can become ready well after privileged EXEC and CML's BOOTED indication. The capture workflow now waits for every linked physical port to exist before starting protocol checks.

The attempted warm `operations-03` rerun remains **failed** at its CDP assertion. Nexus received IOS XE on its routed link but no longer listed IOSvL2 on the trunks. The earlier LLDP discrepancy also remains documented. No fake native-VLAN gate, synthetic neighbor or hidden output normalization was added. The follow-up scenario requires the proven routed discovery peer and records full trunk discovery output for review.

## Reproduce the follow-up

`scripts/cml/scenarios/fidelity-regressions.json` uses the same five image definitions and isolated topology, then executes **74 checks/commands** covering normal traffic, OSPF cost changes, ACL denial/counters/deletion, dual-port root-guard failure, SVI route withdrawal and recovery. It includes the exact 80-command platform survey. This scenario creates a new owned lab; it does not mutate a user lab. See [CML workflow instructions](../cml-conformance.md).

## Explicit exclusions

The 90-entry ledger records six fixed differences, 21 fixed with remaining boundaries, 20 runtime differences, 19 profile differences, 11 presentation differences, 12 unsupported telemetry views and one reviewed route-tag boundary. These classifications are review dispositions, not a replacement for the raw comparator.

Per-device CPU/process and allocator-memory telemetry, environmental sensors and Linux PIDs remain unavailable. Version, hardware capacity, serial/MAC identity, mapped ports, wall clock, route ages, traffic counters and PAT allocations remain truthful to the virtual simulator. The original IOL 10-Mb/s interface naturally has a different OSPF cost from a NetSim Gigabit port; calibrate explicit bandwidth for an equal-profile comparison.

The IOL-originated default is displayed by Nexus with tag 1. A universal process-number tag was not inferred: Cisco's [IOS default-route example](https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/47868-ospfdb9.html) shows tag 0, while the [IOS XR command reference](https://www.cisco.com/c/en/us/td/docs/routers/asr9000/software/asr9k-r6-6/routing/command/reference/b-routing-cr-asr9000-66x/b-routing-cr-asr9000-66x_chapter_0110.pdf) describes a process-number default. Explicit configured route tags already propagate in the simulator; this image-specific default remains a boundary pending broader evidence.

NS-OS ACL support remains IPv4 ip/icmp on routed physical Ethernet egress. Ingress, SVI/port-channel attachment, TCP/UDP qualifiers, IPv6 ACLs, logging, remarks and time ranges are rejected. There is no successful configuration stub for these features. The [NX-OS 10.6 ACL guide](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/security/cisco-nexus-9000-series-nx-os-security-configuration-guide-release-106x/m-configuring-ip-acls.html) provides syntax and duplicate/removal semantics; the live traffic probes establish which subset was actually enforced on the tested image.

The first fresh follow-up run (`fidelity-regressions-01`) passed the feature/failure checks but failed its final ping after a fixed 45-second SVI recovery delay. Read-only diagnostics subsequently showed FULL adjacency, restored routes and 3/3 pings without changing configuration. That failed run is retained. The revised scenario waits a further bounded 90 seconds, explicitly requires both Nexus OSPF peers FULL and the IOS route at metric 41, then tests forwarding. SVI-up is not treated as proof that routing has converged.

## Simulator validation

The full `npm run check` completed with **1,188/1,188 tests**, TypeScript checking and the standalone Tailwind build. Subsequent focused checks cover the reviewed fixtures, malformed IPv6-route input on an uninitialized stack, and ACL save/reload plus lab-file persistence. The original operational capture compares against the corrected simulator with **83 raw differences**, zero evidence-gate problems and **12 explicit telemetry acceptance differences**. The management replay remains **98/98** with its existing **17** raw differences and no evidence-gate problems. The root and `dist/` HTML files are byte-identical, require no backend and retain the offline connection policy.

## Completed fresh CML validation

The revised fresh run `fidelity-regressions-02` completed **74/74 steps and all 80 exact command observations** on IOSv 15.9(3)M12, IOL XE 17.18.02, IOSvL2 2020 and Nexus 9300v 10.6.2.F. Its five intact PCAPs contain **2,072 packets**: 12 ARP, 134 ICMP, 102 ICMPv6, 528 OSPF, 797 STP, 96 CDP and 143 LLDP. Other frames account for the remaining packets. All evidence-integrity gates pass. The owned lab was stopped after capture.

The [reviewed fresh-run manifest](../../scripts/cml/fixtures/fidelity-regressions-observations.json) contains scenario/capture/source hashes, image IDs, every command's availability, checked native excerpts, packet hashes and failed-run provenance. Raw evidence remains private at `.cache/cml-runs/fidelity-regressions-02/`; final replay/comparison files are `.cache/cml-next/regressions-replay-final.json` and `.cache/cml-next/regressions-comparison-final.json`.

| Comparison | Passing steps | Observations | Raw differences | Evidence-gate problems |
|---|---:|---:|---:|---:|
| Original operational capture against corrected simulator | 14/14 | 80 | 83 | 0 |
| Fresh follow-up capture against corrected simulator | 74/74 | 80 | 98 | 0 |
| Management capture/replay | 98/98 | — | 17 | 0 |

The fresh scenario has 60 additional commands/checks, so its 98 raw differences are not comparable as a reduction from the original 90. Numeric differences and unavailable telemetry remain visible. The fresh survey still has exactly 12 command-acceptance differences, all explicitly unavailable telemetry. Nexus again learned IOS XE through LLDP without learning the IOSvL2 trunk peer; that interoperability boundary remains recorded.
