# NX-OS CLI and OSPF validation

Reference images are Nexus 9300v 10.6.2.F and IOL XE 17.18.02 on the user's CML controller. This is a bounded validation of the implemented NS-OS surface, not a claim of complete NX-OS parity. CML remains a developer reference; the delivered application is still an offline HTML file.

## Corrections

| Area | Corrected behavior |
| --- | --- |
| Passive configuration | Native interface `ip ospf passive-interface`, `no` and `default` forms; router/VRF `passive-interface default`. The IOS per-interface router-mode form rejects. |
| Passive operation | Interface overrides control actual Hello delivery, adjacency, advertised routes and forwarding. Defaults stay within their routing context. |
| Loopbacks | Newly created loopbacks are up by default, have native-style interface detail, 8,000,000-Kbit bandwidth and OSPF cost 1. Explicit OSPF cost still changes received route metrics. |
| Received metrics | SPF consumes the metric from received prefix advertisements. It no longer recomputes a Nexus loopback's metric using a generic decoded peer profile. |
| MTU | DBD MTU is checked at the receiving side. Enabling ignore on the larger peer does not disable the smaller receiver's check. Both delivered DBD handling and adjacency eligibility enforce this. |
| OSPF removal | Wrong tags are idempotent; wrong areas report native `Area mismatch`; matching removal preserves cost/passive/MTU settings. A configuration-file merge rolls back on the unprefixed native error. |
| Operational selectors | Named OSPF tags, interface selection and VRF/all selection. A selected interface determines the VRF; a trailing VRF selector is rejected. Unknown tags reject; unknown queried VRFs return no rows. |
| Ping | Native-style `count` and VRF/count forms execute real probes and report measured TTL, timing and loss. Count is explicitly limited to 1–20. |
| Capture workflow | Timestamped boot syslog appended to an EXEC prompt no longer hides that prompt. Command echoes cannot satisfy the prompt fence. Native unprefixed area errors are rejected by replay and evidence gates. |

The [Datacenter Switch guide](../features/datacenter.md) contains the supported command forms. Old saved IOS-style passive-interface lists still operate and export as native interface commands. Save/reload, configuration-file replay and portable lab import preserve the new controls.

## Evidence and interpretation

Exploratory native probes captured default-VRF passive failure and recovery, larger-side MTU-ignore failure followed by smaller-receiver recovery, and BLUE-VRF isolation/failure/recovery. A native loopback explicit cost and mismatched-removal probe recorded the configuration before and after each removal. Expected rejections remain in the raw evidence.

An established adjacency is not proof of a new DBD exchange. The exploratory MTU change temporarily produced different states on the two native peers, including an old FULL state. The reproducible test explicitly restarts the IOS interface, checks that the route and forwarding fail, then requires adjacency and traffic recovery. An older simulator test was updated to check the smaller receiver after restarting the link; it no longer assumes that both ends must display the same intermediate state.

Exploratory VRF migration briefly produced a missing route before convergence and, after one recovery, 2/3 replies on the first ping. Those observations are retained rather than counted as a complete recovery. The executable scenario waits for convergence and requires all three replies.

A previously retained reference VM rebooted with a low-logflash error. It was stopped and excluded from the reference pass. An extra link added to the exploratory lab after boot did not carry Nexus traffic; its capture contained only the IOS side. That link is not used as successful VRF evidence. The reproducible scenario wires its link before boot and moves the working path into BLUE for VRF checks. The exploratory capture cleanup was incomplete; the standard fresh capture supplies the complete packet evidence.

## Reproduction

[The executable scenario](../../scripts/cml/scenarios/nxos-ospf.json) contains 111 commands/checks and 12 exact read-only observations. Use [capture, replay and comparison](../cml-conformance.md) with a new output directory. It creates two isolated nodes, with no external connector and no modification to a user lab.

Raw transcripts, configurations and packet captures are kept in ignored `.cache/` directories. The reviewed fixture records image/scenario/source/capture hashes and checked observations. Controller credentials and bearer tokens are excluded.

## Completed fresh run

The fresh `nxos-ospf-01` run passed **111/111 commands/checks**, collected all **12 observations**, and stopped its owned lab without cleanup errors. Its intact capture contains **492 packets**, including 311 OSPF, 30 ICMP and 19 ARP packets. Decoded DBDs contain both the Nexus's configured 1600-byte MTU and IOS's 1500-byte MTU. The comparator reports zero evidence-gate problems and identical command acceptance for all 12 surveyed forms.

The [reviewed fixture](../../scripts/cml/fixtures/nxos-ospf-observations.json) binds the capture, scenario, simulator sources and every checked native observation. It also gives an individual disposition and diff hash for **all 31 remaining strict output differences**. These are not silently normalized or counted as full parity. Raw reference, replay and comparison files are `.cache/cml-runs/nxos-ospf-01/capture.json`, `.cache/cml-nxos-validation/scenario-replay-final.json` and `.cache/cml-nxos-validation/comparison.json`.

The review found and corrected two additional gaps: MTU-stalled neighbors now retain their exchange state and retry DBDs every five seconds while valid Hellos arrive, and accepted IP packets to a Nexus loopback increment its logical receive counter. The reference and replay both report **9 packets / 900 bytes** on Loopback0. Empty neighbor queries no longer print a fabricated zero-neighbor table. Ping timing is formatted to three decimal places while retaining the measured value.

Final `npm run check` passed **1,199/1,199 tests**, TypeScript checking and the standalone Tailwind build. The offline CML workflow checks passed **14/14** tests. Both task-owned labs are stopped; the pre-existing user lab remains STARTED. The root and `dist/` HTML files are byte-identical.

## Boundaries

This pass does not add BGP, HSRP, OSPFv3, external AAA, new vPC configuration or unverified ACL attachment types. Existing platform limits remain in `show capabilities` and the Datacenter Switch guide. One OSPF instance per VRF remains the simulator limit.

An MTU-ignore setting does not change forwarding MTU or make oversized application packets safe. The live directional test uses the Nexus as the larger-MTU peer; simulator tests exercise the receiving check and recovery. OSPF control packets remain logical envelopes, not binary Cisco images or hardware implementations.

Hardware identity, actual port capacity, MACs, clock, route age, timing and measured counters remain distinct. IOL's default 10-Mbps port and NetworkSim's Gigabit port have different OSPF costs. Those numbers are not normalized away. The new interface view omits unmodeled state-change counters, opaque-LSA checksums, ASIC state and unsupported timers.

The remaining review explicitly includes the unavailable neighbor-age field before FULL, the simulated router's 64-TTL echo-reply profile versus 254 on this native loopback path, IOS XE prompt/informational-notice differences, and reduced logical LSDB instrumentation. These are documented boundaries, not claims of byte-for-byte Cisco output.

Official syntax reference: [Cisco Nexus 9000 NX-OS 10.6 OSPFv2 guide](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/unicast-routing-configuration/cisco-nexus-9000-series-nx-os-unicast-routing-configuration-guide/m_configuring_ospfv2.html). Native transcripts and traffic tests establish the validated behavior on the selected images.
