# Nine-node implementation and dependencies

All nine kinds share `Simulator`, structured Ethernet/IP packets, one deterministic event queue, policy/forwarding, persistent configuration and original renderers. Nodes are configurations of this engine, not independent cosmetic simulators.

| Node | Entry/configuration | Runtime and packet dependencies | Current audit scope |
| --- | --- | --- | --- |
| Router | `model.ts`, `cli.ts`, IOS compatibility modules | IPv4/IPv6 forwarding, `control-plane.ts`, OSPF packets, BGP TCP, policy, NAT, tunnels, services | Reviewed; targeted remediation in progress; exhaustive IOS equivalence unverified |
| L2 switch | switchport factory, VLAN/STP/EtherChannel CLI | Shared bridge/FDB, VLAN admission, STP/aggregation, discovery, snooping/security, physical QoS | Reviewed; packet QoS and VTP fixes; computed negotiation limits remain |
| L3 switch | switching plus routed ports/SVIs and routing enablement | Same L2 domains plus scoped RIB/recursive forwarding and dynamic routing | Reviewed; SVI/physical QoS precedence tested; full platform license/ASIC behavior absent |
| PoE switch | L2 profile plus `poe.ts`, `ios-poe.ts`, `poe-ui.ts` | Shared electrical allocation and AP lifecycle, separate from data link admin state | Reviewed; class-4 profile only; no analog detection/real power negotiation |
| WLC | `wireless-model.ts`, `ios-wireless.ts`, `wireless-ui.ts` | Logical CAPWAP, WLAN/policy/tag configuration, RADIUS, central forwarding, monitoring | Current field templates inventoried; runtime corrections and browser evidence recorded; full reference GUI unverified |
| AP | Lightweight 9115 profile, AP GUI and supported CLI | PoE supply, DHCP/DNS discovery, CAPWAP join/keepalive, logical radios/security/bridging | Software reload and failure dependencies corrected; autonomous/WPA3 absent |
| PC | `windows-cli.ts` through `IOSSession`; desktop addressing | Shared IPv4/IPv6/ARP/DHCP/DNS/ICMP/TCP, volatile and persistent routes | Networking subset implemented and packet-tested; no full Windows OS |
| Laptop | Same Windows parser and desktop plus wireless form | Shared host stack over authorized Wireless0 frames, association/RF/roaming | Windows and wireless integration/counters corrected; no OS WLAN XML store |
| Server | Same Windows parser, `services-ui.ts` | Delivered DHCP/DNS/HTTP/AAA/NTP/syslog requests; management clients | Typed DNS, transactional validation and received accounting integrated; TFTP/SCP/SFTP server removal is a user-approved exclusion |

The complete source hash/import/export map is [dependency-map.json](dependency-map.json). Cycles between engine, policy and protocol helpers are explicit; type-only imports do not imply separate engines. Application state flows from CLI/GUI → DeviceConfig → changed/recompute or actual scheduled protocol messages → DeviceRuntime/RIB/FDB → transmit/receive admission → event/counter output. Configuration rendering and portable serialization share the same DeviceConfig. Runtime learning is omitted from lab saves and rebuilt on load.

The most consequential architectural duplication is the IOS registry plus independently coded context-help grammar, and GUI validation versus CLI validation. The Windows command path previously mixed OS output into IOS errors; the new WindowsSession isolates that grammar while sharing the engine. Existing service dictionaries remain backward compatible. Replacing every protocol with vendor firmware is not part of this original offline architecture.
