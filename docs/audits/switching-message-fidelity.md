# Received-message switching audit

The C9300-style L2, L3 and PoE switch profiles now use received control messages for dynamic switching decisions. This closes the former topology-wide election and configuration-peeking shortcuts for STP, DTP and dynamic EtherChannel membership. The envelopes are original structured simulation records, not Cisco binary frames.

## STP, rapid PVST and MST

`control-plane.ts` sends per-VLAN BPDUs through `Simulator.sendLinkControl` and physical Ethernet delivery. A switch compares its own bridge identifier with the root, path cost, sender bridge identifier and port identifier received on each eligible port. Local port cost and tie-breaking determine its root port; received vectors determine designated/alternate roles. An undelivered superior bridge cannot become the observer's root.

Root ports synchronize against received information. Designated rapid ports transmit proposals and require received matching agreements for fast transition. Other designated ports use the forward-delay fallback. Root/BPDU/loop guards, PortFast, interface filtering, global filtering, migration to classic PVST, per-VLAN and per-MST costs/priorities, configured root timers and three-Hello rapid expiry affect operational forwarding. Classic listening/learning use the received root's timer parameters. UplinkFast promotes an available alternate after direct root-port failure. The transmit hold-count bounds each port's BPDU bursts.

Topology-change flags flush dynamic MAC entries and propagate through the received-message path; static MAC entries remain. Counters record actual BPDU submissions and receptions. MST region identity and remaining-hop budgets are advertised, and matching regions support independent instance roots. Region boundaries remain a conservative per-VLAN approximation, without complete CIST/M-record encoding or the full IEEE state-machine matrix. Non-PortFast links with no received neighbor information retain the explicitly bounded one-second silent-neighbor transition used by this teaching model.

Unrelated canvas movement does not schedule new BPDU work. Triggers coalesce per port and occur only when advertised state changes; receive expiry timers follow delivered information. The existing 500-position-change timer invariant remains unchanged and passes.

## DTP, EtherChannel and VTP

`switching-messages.ts` owns per-port received partners, transmission/expiry timers and measured counters. DTP sends at30-second intervals and expires received partners after300seconds. Dynamic desirable/auto decisions use the received mode and domain. Static trunk and nonegotiate retain their independent semantics. Native conflict validation rejects nonegotiate on a dynamic port and rejects dynamic mode while nonegotiate is configured, atomically across interface ranges.

Dynamic LACP and PAgP membership requires compatible received actor/partner records and synchronization. Passive modes do not create an aggregate without an initiating partner. Member consistency, advertised system/port priorities, eight active LACP members, standby promotion and flow hashing affect real bridged/routed traffic. LACP normal/fast requests set90/3-second receive lifetimes and request30/1-second partner transmission respectively. Static on/on retains immediate physical compatibility checks. This is a bounded actor/partner model, without the complete mux/marker protocol.

VTP database adoption occurs only after a delivered message on an enabled operational trunk. Domain, password, version and increasing revision govern adoption; normal-range propagation preserves locally configured extended VLANs. Server edits advance revisions, clients can relay learned higher revisions, equal-revision conflicts cannot overwrite a peer, and transparent switches forward appropriate messages without adopting the database. New or re-enabled eligible trunks solicit the database through delivered requests and responses. Fresh per-origin advertisement IDs permit unchanged periodic messages to recover a receiver after loss; runtime-bound duplicate suppression prevents loops. Transparent forwarding follows domain/version rules and does not require matching passwords; an eligible blank-domain client/server can adopt a received domain. Periodic and triggered snapshots operate; binary summary/subset segmentation, VTPv3 primary-server behavior and pruning remain outside this implementation.

`show dtp`, `show lacp`, `show pagp` and `show vtp counters` expose received partners, expiry and actual submission/reception counters instead of unavailable/computed placeholders. Source-local configuration changes cannot instantly modify the remote switch before message delivery.

## Executable evidence

`tests/switching-messages.test.ts` independently checks initial one-way loss, BPDU-guard delivery dependency, rapid expiry/recovery without carrier loss, proposal/agreement loss, dynamic-only MAC flushing, LACP fast expiry/recovery, PAgP initiation, DTP asymmetric reception/expiry and VTP loss/triggered recovery. Existing `control-plane`, `switching-compat`, `core`, `wired-fidelity` and `ethernet-physical` cases retain actual forwarding, cost, guard, bundle, VLAN and failure assertions. Old instantaneous remote-state assertions now wait for delivered protocol messages; they were not replaced with parser-only assertions.

## Primary references and bounds

- [C9300 IOS XE17.12 STP](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/lyr2/b_1712_lyr2_9300_cg/configuring_spanning_tree_protocol.html).
- [C9300 IOS XE17.12 MST/RSTP](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/lyr2/b_1712_lyr2_9300_cg/configuring_multiple_spanning_tree_protocol.html).
- [C9300 IOS XE17.12 Layer2/3 commands](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/command_reference/b_1712_9300_cr/layer_2_3_commands.html).
- [C9300 IOS XE17.12 VTP](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/vlan/b_1712_vlan_9300_cg/configuring_vtp.html).
- [Cisco DTP timing output](https://www.cisco.com/c/en/us/td/docs/switches/lan/cisco_ie3010/software/release/15-0_2_se/command/reference/cr_ie3010/cli2.html) is supplementary timing evidence from a different platform; it is not a claim of complete selected-release output equivalence.

Native IOS XE17.12 packet/output comparison is still unavailable. These references and the stated simulation bounds justify the implemented teaching abstractions; they do not establish binary interoperability or an exhaustive Cisco implementation.
