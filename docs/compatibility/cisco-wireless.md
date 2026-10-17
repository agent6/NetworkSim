# Cisco wireless compatibility

The interface calls the node **WLC**. Its internal configuration profile is `c9800-17.12`, referencing the documented Cisco Catalyst 9800 IOS XE 17.12 family. APs use a 9115-inspired lightweight dual-band profile. These names describe a supported teaching subset, not firmware emulation or certification.

The separate generic PoE switch uses documented Auto/Never inline-power syntax and real modeled allocations; it is not part of the WLC command profile. Its power assumptions and unsupported hardware behavior are documented in the [PoE guide](../features/poe-switch.md).

## Implemented wireless grammar

Existing IOS navigation, interface/IP configuration, saved startup configuration, logging and shared management commands remain available where applicable. Wireless configuration contexts use distinct prompts and common help/completion.

| Context | Supported additions |
| --- | --- |
| Global | `wireless management interface <interface>`; `wlan <name> <1-512> <SSID>`; existing-name WLAN edit |
| Global | `aaa authentication dot1x <list> group <group>`; existing RADIUS server/group configuration |
| Global | `wireless profile policy`, `wireless profile flex`, `wireless tag policy/site/rf`, `ap profile`, `ap <Ethernet-MAC>` |
| WLAN | shutdown, broadcast-ssid, ssid, security wpa/wpa2, AES, AKM psk/dot1x, psk set-key ascii/hex 0, dot1x authentication-list |
| Policy | vlan 1–4094, central switching, session-timeout 1–86400, shutdown |
| Policy tag | `wlan <profile> policy <policy>` (maximum 16 mappings) |
| Site tag | ap-profile, flex-profile, local-site |
| RF tag | 24ghz-rf-policy, 5ghz-rf-policy |
| AP assignment | policy-tag, site-tag, rf-tag |
| AP join profile | description; ap capwap timers heartbeat-timeout 1–30 |
| Flex | native-vlan-id |
| RF profile | ap dot11 24ghz/5ghz rf-profile; shutdown; tx-power max; channel chan-width |
| AP privileged EXEC | capwap ap primary-base <name> <IPv4>; show capwap client rcb |

Supported removal/default forms are context dependent; use `?`. Invalid/unsupported arguments are rejected rather than stored as inert configuration. Clear-text lab credentials are serialized in exported files.

Read-only WLC commands: show wlan summary; show ap summary; show ap name NAME config general; show wireless client summary; show wireless client mac-address MAC detail; show wireless tag policy/site/rf summary. Existing show running-config and show logging include actual modeled configuration/events.

## Limits that matter

- Operational output contains real modeled values in IOS-like tables; it is not a byte-for-byte transcript of a specific Cisco chassis. Hardware inventories, release-dependent columns and unsupported counters are not fabricated.
- The web form follows the WLAN/policy/tag configuration concepts using NetworkSim controls. It is not a copy of the Cisco web application.
- AP management/CAPWAP transport is IPv4. Client IPv6 uses the existing IPv6 stack. No autonomous AP, mesh, 6 GHz, WPA3/SAE, WEP, 802.11r/k/v, mobility-anchor or cross-controller L3 roaming support.
- Channels are a restricted teaching set: 2.4 GHz 1/6/11; 5 GHz 36/40/44/48/149/153/157/161/165. Widths: 20 MHz at 2.4 GHz; 20/40/80 at 5 GHz. No DFS, regulatory power tables, automatic RRM or physical antenna model.
- WPA2 PMK derivation is implemented and vector-tested. Four-way exchange ordering and key proofs are modeled; no IEEE binary frame interoperability, AES-CCMP data encryption, group-key renewal, PEAP/EAP-TLS or certificate-based DTLS. Enterprise credentials traverse the simulated RADIUS service.
- CAPWAP is structured control/data carried by real simulated IP packets; there is no firmware download or certificate trust store. AP tag rejoin timing is compressed to one virtual second. Controller dead time is three heartbeat intervals.
- RF/rate/coverage are deterministic estimates; no CSMA/CA, RF collisions, retransmission/ACK model, MIMO/OFDMA or throughput-certification claims.
- Central WLAN policies apply VLAN forwarding; existing routed ACLs still apply. Dedicated Cisco wireless policy ACL and QoS syntax is not added.
- Shared NTP/TFTP/syslog plumbing is reused where exposed by existing device commands; new wireless-specific image upgrades and a complete Cisco service-command audit are not claimed.

Authoritative sources and REA boundaries are listed in the [research record](../research/wireless-reference-analysis.md). Packet Tracer palette observation does not validate this IOS XE command subset.
