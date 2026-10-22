# Two-peer vPC validation against CML

Validation date: 2026-10-22. NetworkSim was compared with two native Nexus
9300v instances running NX-OS **10.6(2)** (`nxosv9300-10-6-2-f`) in CML
2.10.0+build.13. The access switch and three routed endpoints use IOL
17.18.02. This validates selected vPC contracts; it does not certify complete
NX-OS, physical ASIC behavior, all timer timings, or every failure combination.

## Topology and reproducible artifacts

- [Importable offline lab](../../examples/datacenter-vpc-cml.netsim.yaml).
- [Capture/replay scenario](../../scripts/cml/scenarios/nxos-vpc-pair.json).
- [Reviewed native observations](../../scripts/cml/fixtures/nxos-vpc-pair-observations.json).
- Engine tests: `datacenter-vpc`, `vpc-topologies`, `nsos-interface-range`,
  `nsos-vpc-show`, and `cml-vpc-validation` under `tests/`.

DC1/DC2 use domain1, role priorities100/200, independent mgmt0 addresses
192.168.100.1/30 and .2/30 in the management VRF, two peer-link members
(Ethernet1/1–2, Po1), and a downstream Po10/vPC10 on Ethernet1/3.
VLANs10/20 traverse both bundles. Separate orphan interfaces and SVIs provide
same-VLAN and routed traffic paths. The IOS access switch aggregates its two
uplinks into native Po10; the simulator uses local Po3 because that IOS profile
supports groups1–6. This does not change the peers' vPC ID or LACP actor key.
IOL Ethernet interfaces map to simulator GigabitEthernet interfaces explicitly.

The native diagnostic capture restarted the same task-owned isolated lab after
its boot-image configuration had been saved. It is **restarted/warm evidence**,
not a fresh, uninterrupted execution of the published 117-step scenario. An
initial diagnostic worker failed before its first test step; that failed report
was retained separately. Later IOS console-idle expirations and the interactive
mgmt0 shutdown confirmation were recovered and are recorded as harness issues,
not command/forwarding passes. No strict full-transcript match is claimed.

The published scenario contains assertions for intended forwarding, including
single peer-link member loss. It is a regression/reproduction harness. Its
successful simulator replay must not be presented as an all-green native CML
capture: the native unresolved case below remains separate.

## Confirmed behavior and repairs

| Contract | Native observation | NetworkSim change/check |
| --- | --- | --- |
| Configuration navigation | Spaced Po selectors and `interface ethernet 1/1-2` work directly from vPC mode; range prompt follows | Physical ranges, spaced selectors, help/Tab, atomic rejection, role checks, actual two-member LACP traffic |
| Healthy pair | Both vPCs/peer-link up, matching VLANs10/20; five same-VLAN/routed paths reach 5/5 after convergence | Full CLI-built six-node scenario, packet-based adjacency, switching and routing |
| Keepalive-only failure | Both report keepalive unreachable while CFS adjacency and forwarding remain up; both orphan paths 5/5 | Preserve established adjacency independently of keepalive transport |
| Keepalive parameter edit | `interval 2000 timeout 5` accepted; interval alone incomplete; vPC stays up | Enforce paired syntax, reschedule timer without resetting CFS; real UDP3200, DSCP48, TTL64 |
| STP Type-1 consistency | Default differs from explicit Normal Port; Root and explicit None differ from Default; secondary suspends | Exchange and compare port type/guard; correct `no` resets, config replay preserves explicit settings |
| MTU | L2 MTU1600 rejected; 1500/9216 accepted; peer-link operational MTU9216; member mismatch suspends secondary | Native L2 constraints, effective peer-link MTU, rejection-aware transactional replay |
| Type-2 consistency | SVI admin mismatch warns without suspending L2; peer-gateway difference alone remains successful | SVI state comparison; remove invented peer-gateway Type-2 failure |
| Peer-link failure | Primary remains up/forwards; secondary vPC, related SVIs and opt-in orphan port go down | Real policy suspension, split-horizon behavior and interface diagnostics |
| Restoration | Primary may show an active restore timer while forwarding; secondary remains down during its timer | Separate timer display from primary forwarding suppression; default SVI delay10s |
| Downstream leg failure | After native LACP settles, access switch retains the other leg and both orphan paths reach 5/5 | MAC redirection and remote-leg-down exception covered with packets |
| Peer-switch / ARP sync | Shared STP bridge identity; a newly learned orphan IP appears on the peer | Existing packet-driven identity/ARP synchronization tests retained |
| Operational displays | Global/member/Type-2 results differ; last consistency result survives peer-link loss | Native-shaped summaries, received-peer consistency tables, scoped config, roles and orphan view |

Cold ARP and recovery probes sometimes returned 4/5 or 0/5 before later
successful traffic. Those results remain in the evidence; they are not
normalized into success. The native VM's LACP/peer-link convergence timing is
not assumed to equal the deterministic simulator's timing.

## Unresolved native comparison

Shutting DC1 Ethernet1/1 left Po1 up on
Ethernet1/2, both vPCs up, consistent parameters and forwarding STP state.
Nevertheless, the client-to-secondary-orphan path returned 0/5, including a
repeat after 95 seconds and another repeat after both Nexus peers themselves
successfully pinged that orphan (5/5). Disabling `peer-switch` on both peers
and repeating after 95 seconds produced the same failure. Other paths worked,
and full restoration
returned all five tested paths to 5/5 in the earlier settled recovery run.
The last repeat still had 0/5 to this same orphan after a 40-second restoration
wait despite both bundles reporting up. This is an observed reference-run
inconsistency, not proof of its root cause. It must not be called a native
single-member forwarding pass or copied into the simulator as desired behavior.

The saved packet captures narrow the failure to the return path. In the failing
probes, all five echo requests and replies appear on the secondary orphan link;
all five replies then appear on the remaining peer-link, but no matching reply
appears on either access uplink or the client link. During the earlier successful
recovery run, replies instead leave the secondary access uplink and reach the
client. The echo replies still carry the endpoint's source MAC and TTL255, so
the observed return packets are being bridged rather than routed by a Nexus.
This is packet-path evidence, not a diagnosis of the responsible native software
or configuration component.

The simulator's existing one-member-loss packet tests require continued
forwarding over the remaining member. Packet captures and exact observation
hashes are retained for follow-up. Back-to-back vPCs, native peer reboot,
peer-gateway first-hop MAC forwarding during faults, native auto-recovery and
keepalive-first double failure were not independently validated in this native
run; simulator tests cover several of these, which is a different evidence level.

## Running the workflow

Use the existing `scripts/cml/capture.py` workflow with the published scenario,
verified SSH host keys and a prompted controller password. It allocates physical
interface slots from the installed CML node definition before wiring/booting.
The scenario creates an isolated lab and can take several minutes for native
boot and deliberately conservative convergence waits.

```sh
node scripts/cml/replay.ts scripts/cml/scenarios/nxos-vpc-pair.json .cache/cml-runs/vpc-replay.json
python3 -m unittest discover -s scripts/cml -p test_workflow.py
npm run check
```

Replay verifies assertions through the same public CLI and delivered packet
paths used by the app. It fails if the simulation cannot advance through a
convergence interval; a depleted event budget cannot silently shorten a wait.
Configuration acceptance alone is not forwarding evidence. Only actual native
captures meeting their assertions should be passed to the strict comparison
workflow as successful CML captures.

The reviewed run retained **481 command observations**, five harness timeouts,
and **10 nonempty PCAPs** totaling **4,988,209 bytes**. Its management-link PCAP
contains 3,867 UDP3200 keepalives with ToS192 and TTL64. All captured files have
SHA-256 hashes in the reviewed fixture. Raw transcripts/reports and PCAPs are
retained locally under `.cache/cml-vpc/live/`; the original failed worker report
remains at `.cache/cml-vpc/capture.json`. The audit lab was verified stopped
after downloads, with no cleanup errors. The pre-existing user lab remained
STARTED.

Headless Chrome also opened the built root `index.html` directly from disk with
HTTP blocked: six-node YAML import, native subsection navigation, spaced/range
selectors, help/Tab, pair convergence, received consistency values and both LACP
members passed without page errors or HTTP requests. The browser result and
screenshot are retained under `.cache/cml-vpc/browser-results.json` and
`.cache/cml-vpc/browser.png`.

Cisco's [NX-OS 9000 CML reference](https://developer.cisco.com/docs/modeling-labs/nx-os-9000/)
reports vPC/port-channel support and describes a software data plane without
specific hardware emulation. The failed path above is therefore recorded as an
unresolved observation, not a blanket assertion that vPC is unsupported.
The [NX-OS 10.6 vPC troubleshooting guide](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/troubleshooting/cisco-nexus-9000-series-nx-os-troubleshooting-guide-106x/m-troubleshooting-vpcs.html)
and [vPC configuration guide](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/105x/configuration/interfaces/cisco-nexus-9000-series-nx-os-interfaces-configuration-guide-release-105x/m_configuring_vpcs_9x.html)
provide the intended failure and consistency model. NetworkSim omits unmodeled
hardware/QoS tables and transmit timestamps rather than fabricating telemetry.
