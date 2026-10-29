# Port-security implementation and CML audit

NetworkSim now enforces secure source-MAC admission on actual received frames.
The IOS and NS-OS access-port commands drive learning, denial, diagnostics and
recovery. The implementation does not merely retain configuration text.

## Delivered behavior

- Maximum two-address admission with independent configured, dynamic and sticky
  bindings; IOS static addresses remain static when sticky learning is enabled.
- IOS sticky enable/disable converts existing learned bindings, and NVGEN emits
  `mac-address sticky <MAC>`. Unsaved learned IOS bindings disappear on reload.
- NS-OS sticky bindings persist separately from startup configuration and stay
  out of interface NVGEN. `feature port-security` gates enforcement.
- Restrict/protect reject unauthorized frames while authorized traffic continues.
  Shutdown creates a real `psecure-violation` fault and stops forwarding.
- IOS counts rejected frames; NS-OS counts distinct violating sources. Protect
  does not increment the displayed counter. Notifications follow the platform.
- Secure CAM entries, per-interface counts, address types, last-source information,
  err-disabled rows and syslog come from the actual model state. Sticky bindings
  do not age. Dynamic bindings age and clear on carrier loss.
- `?`, Tab, explicit IOS sticky MAC entries, maximum-limit rejection and interface
  compatibility checks use the implemented syntax. Invalid ranges preserve state.
- Manual and configured timer recovery work in NetworkSim; NS-OS timer recovery
  resets its per-port violation count while retaining sticky bindings.

The NS-OS addition is bounded to standalone physical access ports. Trunk security,
aggregate/vPC secure-table synchronization, per-VLAN limits, security MIBs and
port-security-specific SNMP notifications are unavailable. IOS retains its existing
broader switching surface; this audit validates access-port behavior.

## Native evidence and limits

The strict seven-node CML run used IOSvL2 15.2, IOL XE 17.18.2 and Nexus 9300v
10.6(2). Every link existed before boot. A separate target behind the Nexus
ensured that probes tested transit forwarding. Both authorized sources passed
before any denial assertion was evaluated.

The strict run passed 67 steps and failed `s068`: the third source reached
`10.42.0.99` while restrict was configured and two sticky addresses were already
installed. Its replies were present on the target's captured wire. A supplemental
probe repeated the test after settling and still received all replies.

| Native check | Observed result |
| --- | --- |
| IOS two-source learning, restrict, protect and shutdown | Passed |
| IOS manual recovery and diagnostics | Passed |
| NX-OS feature gate, syntax, sticky tables and diagnostics | Observed and implemented |
| NX-OS restrict denial | Failed: unauthorized traffic continued; violation count became 1 |
| NX-OS protect denial | Failed: unauthorized traffic continued |
| NX-OS shutdown | Secure-shutdown / secViolErrDis; authorized traffic also stopped |
| NX-OS manual recovery | Not restored within the supplemental ten-second wait |
| NX-OS configured 30-second recovery | Secure UP, authorized replies restored, count reset to 0; two sticky bindings retained |

These are observations of the installed virtual image, not a universal hardware
defect claim. NetworkSim enforces the documented ingress policy rather than
copying this image's forwarding failure. Exact ASIC timing and complete hardware
fidelity are not certified.

The [Cisco IOS guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9500/software/release/17-18/configuration_guide/sec/b_1718_sec_9500_cg/port_security.html)
provides the sticky conversion, violation and aging contracts. The
[NX-OS 10.6 guide](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/security/cisco-nexus-9000-series-nx-os-security-configuration-guide-release-106x/m-configuring-port-security.html)
describes persistent sticky storage and the dropped-address counter. Cisco's
[CML feature test](https://developer.cisco.com/docs/modeling-labs/nx-os-9000/)
uses a 9500v lab and describes shutdown and auto-recovery checks; it does not
establish restrict/protect enforcement for this installed 9300v image.

## Reproduce and inspect

Run the capture, replay and compare commands in
[the workflow](../cml-conformance.md#validate-port-security-with-three-source-hosts).
The unchanged denial assertions deliberately expose the installed image's gap.
The complete 98-step scenario passes through NetworkSim's public CLI and packet
paths. This is a simulator test result, not a relabelled CML pass.

Reviewed excerpts, hashes and 12 packet-capture summaries are in
[`port-security-observations.json`](../../scripts/cml/fixtures/port-security-observations.json).
They contain 30 checked contracts and retain the failed native step. Full local
transcripts and PCAPs remain under `.cache/cml-port-security/`. Earlier failed
baselines and the interrupted run before its first test step remain separate.
The owned labs were stopped; the pre-existing user lab remained STARTED.

The [IOS example](../../examples/ios-port-security.netsim.yaml) and
[NX-OS example](../../examples/nxos-port-security.netsim.yaml) use three Windows
clients, a fanout switch, a secured DUT and a target. Open them in the standalone
HTML app, ping from PC1 and PC2 first, then PC3. Both examples passed browser
checks with HTTP requests blocked, including learned-address displays, real
violations and IOS context help / completion.
