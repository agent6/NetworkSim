# Independent wired integration review

This pass independently inspected the received-message switching adapter, STP elections/transitions, Ethernet media and negotiation, shared MAC capacity, and logical SNMP delivery. It reproduced concrete failures before repairing their source paths. This is an integration review of bounded simulation behavior, not an IOS equivalence certificate.

## Repaired findings

| Path | Reproduced failure | Repair and executable evidence |
| --- | --- | --- |
| VTP transparent relay | A version-2 transparent switch forwarded another domain; a version-1 matching-domain relay incorrectly checked its own password. | Relay follows the selected C9300 version/domain rules without adopting or authenticating the relayed database. Independent three-switch tests cover both cases. |
| VTP duplicate lifetime | Identical periodic database snapshots were treated as duplicates indefinitely, so one lost forwarded update could leave a client stale permanently. | Each originated logical advertisement has a fresh identity; transparent relays preserve it. Duplicate suppression is bounded and scoped to receiver runtime. A lost first update recovers on the unchanged five-minute advertisement, followed by a successful cross-switch VLAN ping. |
| VTP discovery and port recovery | A blank-domain client did not inherit a domain; enabling VTP on a trunk could wait five minutes for database discovery. | New eligibility and domain/version/password changes emit a logical request. Delivered compatible responses permit domain inheritance and higher-revision adoption. Tests cover a new trunk and disable/update/reenable. |
| SNMP interface packet counters | `ifInUcastPkts` and `ifOutUcastPkts` used all-frame totals, counting discovery broadcasts as unicast. | Ethernet delivery counts destination-MAC unicast, multicast and broadcast separately. MIB columns 11/17 use unicast, 12/18 use group totals, and 14/20 expose actual interface error counters. Packet tests compare returned values with delivered ARP/SNMP/ICMP events and traffic-driven CRC faults. |
| SNMP malformed-request accounting | A malformed request counted as a credential failure. | A separate logical malformed-request counter is displayed. A delivered invalid GETBULK increments it without an authentication failure or authentication trap. It is not represented as an ASN.1/BER parse error. |

VTP changes are confined to `switching-messages.ts`; SNMP mapping/accounting to `snmp.ts` and its operational show block. Parent-owned Ethernet counter hooks preserve existing frame/byte totals. Tests are in `tests/wired-integration-review.test.ts`.

## Independent checks without an additional product repair

The new LACP restart test drops peer messages during local reload: a previous synchronized actor/partner record cannot restore membership. Fresh delivered exchange reforms the bundle. Portable load also starts without received synchronization. Existing asymmetric loss/expiry, passive initiation and member-consistency tests remain in the focused suite.

The independent STP test configures transmit hold-count one, introduces several same-window changes, checks actual per-port submission windows, and verifies root convergence. A portable restart with initial superior-BPDU loss starts with the observer as root; delivered recovery elects the superior bridge. Existing proposal/agreement loss, dynamic-only topology-change flushing, BPDU/loop guards, rapid expiry and real data-plane cases remain intact.

MAC capacity inspection and existing packet tests confirm that exhausted CAM stops new learning while valid unknown-unicast traffic still floods, existing entries can move, aging frees capacity, and portable runtime state resets. Static reservations use the documented deterministic eviction teaching model. Ethernet fault/negotiation regressions retain actual carrier, collision/CRC and packet effects. No additional defect was reproduced in these paths during this pass.

SNMP pending-cap eviction, retry exhaustion, ACK-loss duplicate suppression, host removal, restart, logical v3 identity checks, notification views and persistent ifIndex tests also pass. Binary encoding and cryptography remain explicit limits and were not misclassified as new defects.

## References and limits

The selected [C9300 IOS XE 17.12 VTP guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/vlan/b_1712_vlan_9300_cg/configuring_vtp.html), especially VTP Domain and Version-Dependent Transparent Mode, supports the repaired relay/inheritance rules. Requests and advertisement identities are original logical envelopes. The simulator does not implement binary summary/subset segmentation, MD5 digests, full VTPv3 primary-server negotiation, or automatic cross-version migration. Request/response compatibility is explicitly version matched.

[RFC 2863](https://www.rfc-editor.org/rfc/rfc2863.html) defines interface unicast counters by excluding multicast/broadcast destinations, and separates interface error counters. [RFC 3418](https://www.rfc-editor.org/rfc/rfc3418.html) defines ASN.1/BER parse-error accounting; the simulator's structured malformed-request counter makes no such decoding claim.

STP/MST/RSTP and LACP retain the bounds documented in `switching-message-fidelity.md`: structured messages, conservative MST boundaries, bounded actor/partner and silent-neighbor transitions, and no binary interoperability claim. Native IOS XE 17.12 differential packet/output comparison remains unavailable.

## Validation

The focused integration command runs `wired-integration-review`, `snmp`, `snmp-advanced`, `switching-messages`, `ios-show-switching`, `link-medium`, `mac-capacity`, and `ethernet-physical` tests. It passes **72/72** cases. The new independent file passes **9/9**. Shared repository typechecking/build and combined acceptance are performed by the parent after parallel source owners hold their blocks.
