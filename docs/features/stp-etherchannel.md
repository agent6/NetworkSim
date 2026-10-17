# STP and EtherChannel

Layer 2 EtherChannels participate in STP as one logical `Port-channel` interface. Root-port election, port identifiers, path cost, rapid proposal/agreement, received-BPDU expiry and guards belong to the aggregate. All active physical members follow that port's VLAN state. A blocked channel cannot forward through a different member.

This follows Cisco's description of [EtherChannel as one STP port](https://www.cisco.com/c/en/us/support/docs/lan-switching/etherchannel/20625-127.html). BPDUs travel over an actual active member, with one shared session for the bundle. Negotiating, suspended and standby members do not become independent STP ports. Removing a member from the channel restores it as a separate STP port. Replacing the peer invalidates its previous received information.

Configure STP settings on the logical interface:

```text
configure terminal
interface Port-channel1
 spanning-tree cost 100
 spanning-tree port-priority 64
 spanning-tree vlan 20 cost 17
 spanning-tree vlan 20 port-priority 32
end
show spanning-tree interface Port-channel1
show spanning-tree vlan 20
show spanning-tree blockedports
```

The output lists `Po1` once and includes its role, state, cost and numeric `Prio.Nbr`. Interface queries for an attached physical member resolve to the aggregate. Summary and blocked/inconsistent-port counts do not count every member separately. The diagram's individual cable sockets show the aggregate's VLAN state.

Without an explicit cost, active negotiated member bandwidth determines the cost. A two-member Gigabit channel has short cost **3**; one remaining Gigabit member has cost **4**. With `spanning-tree pathcost method long`, those costs are **10000** and **20000**. A configured logical cost stays fixed through member failure or restoration. Cisco documents this [IOS bandwidth-dependent recalculation](https://www.cisco.com/c/en/us/support/docs/switches/catalyst-6500-series-switches/24330-185.html). The classic 10/100-Mb/s bundle lookup follows [Cisco engineer Peter Paluch's direct IOS measurements](https://community.cisco.com/t5/switching/stp-port-cost-and-etherchannel/td-p/2795286); this is measured platform behavior, rather than a published universal cost formula. Physical-member-only cost settings do not replace the aggregate's cost.

Root guard and loop guard act on the logical port. Loop guard blocks the entire channel for the affected VLAN when received BPDUs expire, then recovers after valid BPDUs return, as described in [Cisco's loop guard reference](https://www.cisco.com/c/en/us/support/docs/lan-switching/spanning-tree-protocol-stp-8021d/218321-configure-stp-with-loop-guard-and-bpdu-s.html). Logical BPDU guard error-disables the aggregate and its active members. Logical shutdown prevents forwarding through every member. Access PortFast defaults do not treat a channel carrying a negotiated trunk as an edge port.

MST per-instance interface settings use the same logical port:

```text
configure terminal
spanning-tree mst 0 priority 8192
spanning-tree mst 2 priority 4096
interface Port-channel1
 spanning-tree mst 2 cost 77
 spanning-tree mst 2 port-priority 16
end
show spanning-tree mst 2 interface Port-channel1 detail
```

Instance bridge priorities, including instance 0, now affect election and survive running/startup configuration rendering and lab save/load. Priority values must be multiples of 4096. VLAN-to-instance mapping is configured separately under `spanning-tree mst configuration`.

These are original educational protocol models. Existing limits remain: logical BPDU envelopes rather than binary IEEE encoding, conservative per-VLAN MST boundary trees rather than a complete CIST/M-record state machine, and a bounded silent-neighbor transition. This change does not add the separate EtherChannel misconfiguration-detection mechanism, Bridge Assurance, or BackboneFast. Those compatibility-only commands continue to report their limitations.

See [validation evidence](../testing/stp-etherchannel-validation.md).
