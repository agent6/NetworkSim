# Ethernet keepalive vPC validation

Validated on 2026-10-22 against two Nexus 9300v instances running NX-OS
**10.6(2)** (`nxosv9300-10-6-2-f`) in CML **2.10.0+build.13**.
This covers the reported two-switch configuration and the contracts below,
not complete NX-OS or hardware equivalence.

## Reproduction and usable example

- [Portable two-node lab](../../examples/datacenter-vpc-ethernet-keepalive.netsim.yaml).
- [68-step capture/replay scenario](../../scripts/cml/scenarios/nxos-vpc-ethernet-keepalive.json).
- [Reviewed native output and packet provenance](../../scripts/cml/fixtures/nxos-vpc-ethernet-keepalive-observations.json).
- Regression tests: `cml-vpc-ethernet-keepalive`, `nsos-member-mode`,
  `nsos-admin-defaults`, and `nsos-vpc-show` under `tests/`.

The simulator uses the screenshot's Ethernet1/27–28 for Po1 and Ethernet1/29
for the routed keepalive. CML uses Ethernet1/1–2 and Ethernet1/3 respectively;
the scenario records this mapping explicitly. Both peers use domain1, role
priorities100/200 and addresses192.168.100.1/30 and .2/30. There are no downstream
vPC member bundles. Native NX-OS and NetworkSim both form the pair with
`Number of vPCs configured : 0`.

Omitting the keepalive VRF selects **management**, even when the specified
source IP belongs to a routed Ethernet interface in **default**. With the
routed addresses configured and enabled on Ethernet1/29, use this on DC1:

```text
configure terminal
interface port-channel1
 no shutdown
vpc domain 1
 peer-keepalive destination 192.168.100.2 source 192.168.100.1 vrf default
end
show vpc peer-keepalive
show vpc
```

On DC2, reverse the addresses:

```text
configure terminal
interface port-channel1
 no shutdown
vpc domain 1
 peer-keepalive destination 192.168.100.1 source 192.168.100.2 vrf default
end
```

The `no shutdown` on Po1 is useful for existing labs saved by the older
simulator, which incorrectly created port-channels shut. New port-channels
now start enabled; existing saved administrative choices are preserved.
The scenario also moves both routed interfaces into `KEEPALIVE`, reapplies
their IP addresses, observes failed keepalives while the binding is still
`default`, and restores them with `vrf KEEPALIVE`. Established CFS adjacency
survives that keepalive-only outage on both implementations.

## Measured corrections

| Case | Native observation and implemented behavior |
| --- | --- |
| Missing keepalive VRF | Defaults to management; no route/delivery in that VRF prevents initial adjacency. The simulator retains this default instead of inferring a VRF from the source IP. |
| New port-channel | Both explicit creation and `channel-group` creation start administratively enabled. Reapplying member commands preserves an explicit shutdown. |
| New physical Layer 2 port | Enabled in the measured image, whose actual defaults include `system default switchport` and `no system default switchport shutdown`. NetworkSim adopts that fixed profile without exposing unimplemented global controls. |
| Physical mode change | With no explicit administrative override, routed Ethernet defaults to shut and Layer 2 defaults to enabled. An explicit shutdown or no-shutdown survives both conversions. Metadata preserves that distinction through export/load and configuration replay; legacy saved ports retain their existing choices. |
| Individual Layer 2 member | Bare `switchport` and `no switchport` are incomplete. They do not convert the member. Help omits the executable `<CR>` leaf. |
| Individual routed member | Bare `switchport` and `no switchport` are invalid. Layer 2 subcommands are unavailable. |
| Interface range | Reapplying its existing Layer 2 or Layer 3 mode succeeds without changing it. Actual mode conversion rejects with the native port-channel error. Rejection rolls back the simulator's entire range. |
| Layer 2 member configuration | Native NVGEN omits the redundant bare `switchport`. Simulator exports now do likewise, allowing reapplication to an existing bundle. |
| Keepalive detail | A missing destination route in the selected VRF can report `Suspended (Destination IP not reachable)`. A failed receive reports `Failed`; an unreceived update timestamp is not fabricated. Native failed-status wording varies with lifecycle, so the scenario accepts both observed unreachable forms. |
| Unformed pair display | No established role, no active peer-link VLANs, native consistency-not-performed reasons, and no empty downstream vPC table. After convergence, roles, VLANs and consistency reflect modeled peer state. |

The simulator packet regression also verifies forwarding between hosts across
the two-member LACP bundle before/after range reapplication. Save/load,
configuration replay, administrative overrides, authorization and invalid
metadata are checked separately. That simulator traffic test is not presented
as a native end-host traffic test in this two-node CML topology.

## Evidence and provenance

The completed native scenario has **68 passing steps** and **eight final
diagnostics**. Another **105 supplementary observations** include expected
parser rejections, spare-interface mode changes, default-state checks and
cleanup. They are not 105 accepted configuration commands.

Three nonempty PCAPs contain **5,832 frames**, totaling **919,721 bytes**.
They include **738 UDP3200 keepalives**, with ToS192 and TTL64. The fixture
records per-file SHA-256 hashes, packet counts, raw command-output hashes,
scenario hash and parent capture hash. Raw reports, console transcripts and
PCAPs remain locally in `.cache/vpc-adjacency/`.

The final run used an already booted, task-owned isolated lab after retained
expectation failures. It is labeled
`running-owned-lab-after-expectation-failure`, not an uninterrupted fresh-boot
capture. The initial text assertion expected generic unreachable wording;
the cold-start native detail reported `Suspended`. Another attempt expected
bare `switchport` to succeed on an individual member; native NX-OS rejected
it. These observations were retained, and the final scenario uses the measured
range syntax. A domain reset and the observed alternative failed-status wording
are recorded as well. No native rejection was converted into an acceptance.

A first attempt allocating NICs through Ethernet1/29 was interrupted before
it reached a usable CLI. This is not evidence that the 30-NIC profile is
unsupported. The successful mapped run checked actual interface readiness,
rather than treating CML's early `BOOTED` flag as proof of linecard readiness.

All test-owned labs were verified stopped; the pre-existing user lab remained
STARTED. Controller passwords and authentication tokens are excluded from
published artifacts.

The comparison checks scenario provenance, raw assertions, native versions and
all three packet files and reports no evidence problems. The final text review
retains **24 transcript differences**, including the explicit port mapping,
default configuration lines, native initialization history/restore-timer display,
spacing and omitted unmodeled keepalive telemetry. Full transcript equality
is not claimed.
The earlier [six-node native return-path discrepancy](cml-vpc-pair.md) remains
unresolved; this validation does not erase that separate finding.

Verification completed with **1,241 passing tests**, TypeScript checking,
the standalone build, and **15 passing CML workflow tests**. A final focused
40-test run also checked the updated displays and preserved auto-recovery role.
Chrome155 opened the final `index.html` directly from disk with HTTP blocked:
two-node import, wrong-VRF failure, correction on both consoles, adjacency with
zero downstream members, both LACP links, native single-member rejection and
successful range reapplication all passed. There were no page errors or HTTP
requests. The tested HTML hash matches both root and distribution builds.

## Repeating the checks

```sh
node scripts/cml/replay.ts scripts/cml/scenarios/nxos-vpc-ethernet-keepalive.json .cache/cml-runs/ethernet-keepalive-replay.json
python3 -m unittest discover -s scripts/cml -p test_workflow.py
npm run check
```

For native capture, use `scripts/cml/capture.py` with the published scenario,
verified controller SSH host keys, a prompted password and a generous boot
timeout. It creates an isolated lab and stops it after capture. The current
Nexus image took substantially longer to reach a usable Ethernet module than
its CML `BOOTED` flag suggested.

Cisco's [10.6 vPC troubleshooting guide](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/troubleshooting/cisco-nexus-9000-series-nx-os-troubleshooting-guide-106x/m-troubleshooting-vpcs.html)
documents management as the default keepalive VRF and requires reachability
within the selected VRF. The [port-channel configuration guide](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/102x/configuration/interfaces/cisco-nexus-9000-nx-os-interfaces-configuration-guide-102x/b-cisco-nexus-9000-nx-os-interfaces-configuration-guide-93x_chapter_010000.html)
lists port-channels as administratively enabled by default. The observations
above were measured on the installed CML image in addition to these references.
