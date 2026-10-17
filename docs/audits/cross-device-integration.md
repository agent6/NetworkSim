# Cross-device integration evidence

These are executable behavioral scenarios, not claims of exhaustive vendor equivalence. Tests configure devices, deliver traffic through the shared engine and check operational state/failure/recovery. The final validation report identifies the exact combined run; a source pointer alone is not a passing result.

| Required scenario | Executable evidence | Observed contract |
| --- | --- | --- |
| VLAN mismatch | `core.test.ts`, `control-plane.test.ts`, `wireless.test.ts` | Access VLAN isolates frames and OSPF/AP/client traffic fails at the affected boundary |
| Trunk pruning/native configuration | `core.test.ts`, `remote-span.test.ts`, `wired-fidelity.test.ts` | Only carried VLANs cross trunks; pruning removes forwarding/capture |
| STP topology change | `control-plane.test.ts`, `switching-compat.test.ts`, `link-indicators.test.ts` | Blocking/alternate role and timers change real forwarding after link failure |
| EtherChannel mismatch | `control-plane.test.ts`, `core.test.ts`, `wired-fidelity.test.ts` | Passive/passive or local member inconsistency prevents bundling; eligible members hash real traffic and survive failure |
| OSPF failure | `ospf-packets.test.ts`, `ospf-control-plane.test.ts`, `wired-fidelity.test.ts` | Lost controls expire adjacency/LSDB-derived routes; valid configuration alone cannot produce an echo |
| BGP filtering and failover | `bgp-session.test.ts`, `bgp-policy.test.ts`, `bgp-multiprotocol.test.ts` | Received UPDATEs, IPv4/IPv6 policy, withdrawals and equal eligible next hops affect actual UDP/CEF |
| EIGRP summarization | `eigrp-auto-summary.test.ts` | Classful boundary summaries change real echo reachability; external-only routes remain specific until an internal component permits aggregation; last-component withdrawal removes local Null0 routes |
| ACL error | `core.test.ts`, `policy-closure.test.ts`, `model-driven-management.test.ts` | Actual ingress/output/control traffic drops and real hit counters update |
| DHCP relay | `core.test.ts` | Remote server supplies client-subnet lease through relay; ARP conflict causes Decline and reallocation |
| DNS failures | `dns-service.test.ts`, `windows-cli.test.ts` | Delivered NXDOMAIN/NODATA/SERVFAIL differ; no undefined successful address; alias/negative TTL expires on clock |
| NAT/PAT | `core.test.ts`, `policy-closure.test.ts` | Original/return traffic uses real tuples, pool exhaustion and idle aging |
| HSRP failure | `control-plane.test.ts`, `fhrp-packets.test.ts` | Received Hello loss and hold/preemption timing change actual gateway ownership |
| PoE budget exhaustion | `poe.test.ts`, `wireless.test.ts` | Budget/port limit/priority removes AP supply and wireless association; restoring supply reacquires/join/connects |
| WLC unreachable | `wireless.test.ts` | Discovery/join requires valid addressing, switching and delivered CAPWAP; dead time controls registry removal |
| Wrong wireless credentials | `wireless.test.ts` | PSK/RADIUS rejection prevents authorized association and data |
| Wireless roaming | `wireless.test.ts`, browser wireless script | RF/hysteresis/residence selects AP; central VLAN IP continuity and actual traffic follow association |
| RADIUS unavailable | `management.test.ts`, `wireless.test.ts`, `ios-platform-compat.test.ts` | Timeout/retransmit/unavailable differs from explicit Reject; permitted fallback only follows unavailability |
| AAA accounting | `aaa-accounting.test.ts`, browser accounting script | Delivered RADIUS/TACACS+ EXEC and TACACS command records, ACK/reject/timeout handling, permitted fallback, credential redaction and logout Stop records |
| AP VLAN mismatch | `wireless.test.ts` | Policy/tagged uplink and routed return path govern client delivery |
| Windows trace | `windows-cli.test.ts` WIN-04/05 | Three real TTL-limited probes per hop and sampled path loss, not fabricated route strings |
| Syslog reception | `core.test.ts`, `cli.test.ts`, `services-ui.test.ts` | Actual packet metadata appears at the receiver; local logs are not substituted |
| Reload | `ios-system.test.ts`, `ios-platform-compat.test.ts`, `core.test.ts`, `wireless.test.ts` | Startup/runtime separation, unsaved configuration, fresh leases and AP supply-preserving software restart |
| Simultaneous flows | `core.test.ts`, `bgp-multiprotocol.test.ts`, `qos-scheduler.test.ts` | Real ECMP/channel hashing, weighted bytes, priority/shaping and queue drops under congestion |
| Physical errors | `ethernet-physical.test.ts` | Forced speed mismatch removes routes; overlapping duplex-mismatched traffic produces real loss/error counters; correction restores forwarding |
| Management/API operations | `model-driven-management.test.ts`, `snmp.test.ts`, `ssh-files.test.ts` | ACLs/credentials/privilege and actual delivered requests control outcomes across IOS profiles and wireless hosts |
| Reliable EIGRP delivery | `eigrp-updates.test.ts`, `eigrp-summary-metric.test.ts` | Lost/retried INIT/UPDATE/ACK, IPv4/IPv6/VRF summaries and received metric policy change actual routes and forwarding |
| OSPF authentication and practical routes | `ospf-area-auth.test.ts`, `exam-routing-practicals.test.ts` | Area/interface authentication inheritance and real IPv6 static/default/floating and OSPFv2/v3 network-type workflows |
| Congestion feedback | `qos-congestion.test.ts` | Independent flows use fair queues; WRED drops/ECN marks actual frames under congestion |
| MAC capacity / cable faults | `mac-capacity.test.ts`, `link-medium.test.ts` | Shared CAM exhaustion floods unknown traffic; wrong media/reach/open/short faults and CRC errors affect reception |
| Voice edge and dedicated Phone | `endpoint.test.ts`, `phone.test.ts`, `phone-audit.test.ts` | PoE, received voice policy and DHCP transitions; Network/PC bridge preserves MAC, IPv6 TTL and DSCP; PC port cannot power an AP |
| Standalone wireless | `standalone-ap.test.ts` | Local SSID/radio/VLAN configuration supports real DHCP, DNS and HTTP without a WLC; uplink/power errors stop delivery |
| WLC administration and WPA3 | `wlc-administration.test.ts`, `wireless-wpa3.test.ts` | Delivered management authentication, authorization, client disconnect/rejoin, logical security and radio power policies |
| SNMP manager/notifications | `snmp-advanced.test.ts`, `wired-integration-review.test.ts` | GETBULK bounds/views, inform ACK/retry/duplicate handling, stable interface identity and actual unicast/group/error counters |
| FTP configuration transfer | `ftp-files.test.ts`, `ios-ftp.test.ts`, `ftp-gui.test.ts` | Independent control/data TCP channels, authentication, file operations, routed ACL/source selection and atomic configuration import |
| Client OS profiles | `unix-cli.test.ts`, Client profile browser | Real Linux/macOS IPv4/IPv6 routes, ICMP/DNS and Wi-Fi operations share the same simulated links; cancellation stops active probes |
| Offline automation | `automation.test.ts`, Automation browser | YAML/JSON tasks use actual SSH authentication/authorization, configuration/save and verification; failures stop tasks and secrets are redacted |
| Removal/load safety | `wireless.test.ts`, `persistence.test.ts`, `record-maps.test.ts` | Removed APs lose associations; stale callbacks cannot revive old runtime; literal identifiers survive save/load without inherited values |

CLI help, syntax, invalid input, mode transitions and negation are covered by `ios-syntax`, `ios-terminal`, `command-parity`, `platform-fidelity` and service-specific suites. These cover selected argument paths. They are not an exhaustive validation of every inventory row/parameter or all eight audit levels.
