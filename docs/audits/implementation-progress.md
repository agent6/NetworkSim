# NetworkSim audit implementation ledger

This continuation completes concrete implementation and executable audit work across the nine original node families and the newly included dedicated Phone node. It distinguishes delivered teaching workflows from exhaustive native Cisco/OS equivalence. The generated [validation report](final-validation-report.md) and [command coverage](cli-command-coverage.md) contain final measured counts and source identities.

## Preserved requirements and provenance

- Original source, Tailwind UI, matching node styles, deterministic shared engine, direct-disk `index.html`, fully offline and no backend.
- AP power is exclusively supplied by a working PoE port. Local AP power toggles/adapters remain absent.
- Explicitly preserve the user-approved removal of Server TFTP/SCP/SFTP listeners/admin pages and the desktop File Transfer tool.
- Old sandbox reference is read-only and independent of the shipped app. REA Packet Tracer evidence remains versioned and genuine. No unavailable vendor runtime output is fabricated.
- `.cache/fidelity/phase2/pre-source.tar.gz` is the immutable continuation baseline. [Exact file changes](phase2-changed-files.json) and [registry changes](phase2-command-registry-delta.json) compare against it. The overall earlier audit had no equivalent initial archive. Concurrent shared edits remain preserved; no blanket reset/stage/commit is used.

## Implemented and audited continuation groups

| Group | Concrete behavior | Evidence |
| --- | --- | --- |
| Received switching | Per-observer STP vectors, rapid proposal/agreement, guard/TC/timers; delivered DTP, LACP/PAgP and VTP, requests/expiry/recovery and measured counters | switching-message-fidelity; switching-messages and independent wired-integration-review cases |
| Reliable EIGRP | INIT/UPDATE/ACK vectors, retransmission, policy/withdrawal, classic/named IPv4/IPv6, VRF; native IPv6 summary vectors and distance | eigrp-update-fidelity; eigrp-updates and summary-metric cases |
| OSPF authentication | Area inheritance, interface null override, received Hello gating, routed failure/recovery, virtual-link keys/overrides and persistence | ospf-authentication-fidelity; ospf-area-auth cases |
| Congestion | Actual per-flow fair queues and precedence/DSCP WRED/ECN admission, counters and removals on supported router output profiles | qos-congestion-fidelity and14 independent congestion cases |
| Physical/CAM | Optional cable/fiber/reach/media/fault/FCS effects; actual receiving CRC;32k shared CAM and flooding under exhaustion | physical-medium-fidelity; link-medium, mac-capacity and browser cases |
| SNMP | GETBULK, size bounds, real inform ACK/retry/dedup/queue behavior, logical v3 notifications, receiver GUI, stable ifIndex, correct unicast/group/error counters | snmp-fidelity; snmp-advanced, independent review and browser cases |
| WLC/security | Administration/monitoring, local/RADIUS/TACACS management, NTP/syslog/SNMP, AP authorization, save/reload, actual client lifecycle, four QoS directions, logical WPA3/PMF | wlc-administration, wireless-wpa3, bounded GUI traces and browser evidence |
| Standalone AP | Explicit generic profile, native-shaped SSID/radio configuration, local bridge with open/WPA2, VLANs and PoE, no controller dependency | standalone-ap tests and browser workflow; no native autonomous firmware claim |
| Host diagnostics | Shared Windows repairs plus optional Ubuntu/macOS client profiles; real IPv4/IPv6 addressing/routes/ICMP/DNS/Wi-Fi and Ctrl+C | windows/unix CLI ledgers and packet-backed tests; Client profile browser workflow |
| Edge endpoints | Phone/printer/IoT roles, actual class3 PoE, received CDP/LLDP-MED, voice VLAN/COS/DSCP, DHCP domain changes and physical shutdown/recovery | endpoint-edge-fidelity and15 independent endpoint cases |
| Automation/JSON | Bounded YAML/JSON inventory/tasks, real SSH VTY/authz/config/save/verification, structured output/redaction, JSON editing | automation-fidelity; automation tests and browser cases |
| File transfer | Passive text-file FTP over separate control/data TCP channels, Server accounts/files GUI, native IOS URL/default/prompt workflows and source selection; excluded Server listeners stay disabled | ftp-files, ios-ftp, ftp-gui and isolated browser cases |
| Dedicated Phone | Network/PC bridge, received voice policy, PoE-only lifecycle, DHCP/settings, IPv6 data passthrough and import safety | phone, independent phone-audit and reversed-interface-order browser cases |
| Parser/validation | Exact handler/path execution, all six IOS registries and local submodes, read-only help/completion; repaired WLC help mutation, IGMP show dispatch, duplicate SNMP show and DTP conflicts | current-ios-parser-validation, parser regressions and generated inventories |

Earlier retained work includes actual BGP TCP/family policy, OSPF packet/LSDB operations, IPv6 services, NAT/ACLs, DHCP/DNS, FHRP, snooping/inspection, remote SPAN, model-driven management, IOS SCP, AAA accounting and literal-name persistence. Existing behavioral assertions remain in the combined regression.

## Acceptance and limits

Run `npm run check` using Node24, then source-bound command/objective/GUI generators and isolated direct-disk browser workflows. Inventories must match final source hashes. Parser acceptance, current-state assertions, packet/cross-device tests, persistence and primary-reference rationale are reported independently; none is silently promoted into full firmware equivalence.

The tenth Phone node also has a dedicated Network/PC bridge and settings workflow; no IOS/Windows console is invented for it. The practical ledgers identify concrete lab workflows and external-product exclusions. Remaining [compatibility limits](known-limitations.md) concern native option/output/state-machine breadth, unsupported hardware/crypto, deliberately excluded services and unavailable reference environments. They are not hidden behind a passing suite or static success output.
