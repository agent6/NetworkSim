# OSPFv3 network types and interface neighbors

The native interface command adapters now connect IPv6 OSPF network type, Hello/dead interval, priority, cost and interface-scoped link-local neighbor configuration to the existing delivered OSPF exchange. The modern `ospfv3 [process-id] network` form applies to the selected process or enabled interface address families. Removing AF/interface membership preserves independent interface network/timer/neighbor settings. Rendering, copy-to-running replay and saved reload retain those fields.

## References and precedence

- [C9300 IOS XE17.12 configuration guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/vxlan/b_1712_bgp_evpn_vxlan_9300_cg/configuring_tenant_routed_multicast.html): selected-platform OSPFv3 point-to-point example.
- [Cisco IOS IPv6 command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipv6/command/ipv6-cr-book/ipv6-i4.html): legacy IPv6 OSPF neighbor/network/timer/priority grammar, link-local neighbor scope, NBMA poll intervals and point-to-multipoint neighbor costs.
- [Modern OSPFv3 command reference](https://www.cisco.com/c/en/us/td/docs/ios/ipv6/command/reference/ipv6_book/ipv6_10.html): optional process-scoped network syntax and inheritance.
- [RFC2328](https://www.rfc-editor.org/rfc/rfc2328.html), sections9.5–10.5: unicast Hello/poll behavior, received-neighbor state and dead timer. Used for protocol detail after the selected Cisco guidance, not as proof of every platform option.

## Behavior and evidence

`tests/exam-routing-practicals.test.ts` has six routing cases plus two virtual-gateway cases:

- `PRACTICAL-STATIC6`: IPv6 network/default/host static routes, actual next-hop UDP identity, floating failover, saved reload and portable recovery.
- `PRACTICAL-P2P OSPFv2 IPv4` and `PRACTICAL-P2P OSPFv3 IPv6`: native CLI topology, delivered FULL exchange, point-to-point interface state, real routed echo, loss of logical Hello fragments with carrier retained, withdrawal, recovery and reload.
- `PRACTICAL-NBMA6 IPv6 interface-scoped`: two links reuse the same link-local peer address without leaking interface cost or next hop; per-neighbor costs affect RIB metrics and actual echo; invalid global neighbor/range input is atomic; portable load restores real traffic.
- `PRACTICAL-NBMA6 native non-broadcast`: actual unicast Hello/poll traffic, FULL adjacency, routed IPv6 echo, timer-mismatch failure/recovery, preserved settings after membership removal, equivalent-address neighbor removal and no forms.
- `PRACTICAL-P2P modern`: process-scoped network grammar, AF membership removal, render, copy replay and saved reload.

Configured NBMA down neighbors use their poll interval; point-to-multipoint uses the Hello interval because poll configuration does not apply there. Point-to-multipoint nonbroadcast neighbors are explicitly configured on each interface. NBMA may respond to a discovered eligible peer through a received Hello; it does not inspect a remote configuration to invent a received Hello. IPv6 link-local destinations are sent on the configured local interface. Existing IPv4 nonbroadcast and VRF routing cases remain passing.

The two additional `PRACTICAL-FHRP` cases use actual end-host UDP through HSRP/VRRP virtual gateways, assert failure before hold expiry, subsequent standby forwarding, preemptive recovery and portable restart. They strengthen the ENCOR practical ledger without altering the OSPF implementation.

## Boundaries

These adapters do not replace the full OSPF implementation. Received logical Hello/DBD/request/UPDATE/ACK records feed local neighbor/database state, but candidate link eligibility, DR/BDR election and area/ABR/virtual-link calculations retain computed teaching portions. No binary LSA/TLV compatibility, complete native neighbor state machine, full multi-process inheritance, MANET, neighbor priority hints or neighbor database-filter option is claimed. Unsupported neighbor options are rejected. Interface priority is operational in the existing computed election. Complete native command/output equivalence is unverified. The focused run passed123/123 with typecheck; it is not whole-IOS certification.
