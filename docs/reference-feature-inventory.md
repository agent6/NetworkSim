# Reference feature acceptance inventory

This is an original behavioral inventory for a fresh NetworkSim implementation. It is based on read-only inspection of the user-supplied reference at `/Users/erikpope/projects/NetworkSim/network-sandbox`. No reference source, assets, styles, command catalogs or implementation are to be incorporated into the new application. The reference's proprietary notice is in `network-sandbox/NOTICE.txt:1`.

The target is a fully local browser application opened by double-clicking an HTML file, with locally compiled Tailwind CSS, Cisco-style router/switch CLI, PCs and servers, and Enterprise ENCOR/ENARSI learning scenarios. Packet Tracer is a behavioral research reference, not an executable dependency.

## Evidence and acceptance terminology

**Behavioral coverage** means the supplied tests assert multi-device state or packet delivery. **Configuration coverage** means parsing, storage, display or negation is asserted; it does not establish a working protocol. **Catalog only** is syntax/help material without verified execution. These are reference classifications, not claims about the new implementation. Newly implemented features need independent tests and honest support reporting.

The inspected reference has 492 JavaScript files, approximately 145,513 non-catalog implementation lines, 289,361 catalog lines and 23 Node test files. Its README claims 65 families; `tests/features.test.cjs:7` contains 63 family cases, with ICMP and TFTP covered elsewhere. No browser or regression suite was run for this inventory.

All source paths below are relative to `/Users/erikpope/projects/NetworkSim/network-sandbox` and include exact file names and useful line anchors. They identify evidence only; they are not source dependencies.

## End-user workflows

| Area | Required parity behavior | Reference evidence |
| --- | --- | --- |
| Offline launch | Direct `file://` opening; local scripts/styles/icons; no web server, CDN, runtime package manager, native VM, external network requests or browser extension | `README.md:3`; `tests/source.test.cjs:15` |
| Device palette | Router with four G0/0–3 interfaces; L2 and L3 switches with G0/1–24 plus G1/1–2; PC and server with G0; server uses host networking with service UI | `js/devices/catalog.js:153` |
| Editor | Click/drag to add; rename; move; multi-select/marquee; lock positions; delete; copy/cut/paste/duplicate including internal links; text notes; undo/redo transactions | `js/ui/topology-operations.js:414`; `js/ui/panels.js:810`; `tests/ui.test.cjs:75` |
| Cabling/power | Pick endpoint ports, add/remove Ethernet connections, link/port status; start/stop individual devices and all devices; warn about unsaved device configuration | `js/ui/topology-operations.js:697`; `js/ui/panels.js:810` |
| View | Pan, zoom, fit all, reset 100%; touch drag/pinch/long-press; compact narrow-screen palette; resizable dock; separate device sessions; port/host labels | `js/ui/topology-editor.js:500`; `js/ui/panels.js:1719`; `tests/ui.test.cjs:253` |
| Accessibility | Keyboard-operable nodes, menus, toolbar and console separator; focus trapped/restored in dialogs; escaped imported text; screen-reader labels/live messages | `js/ui/dialogs.js:17`; `tests/ui.test.cjs:178` |
| CLI interaction | User/privileged/config/submodes; unambiguous abbreviations; contextual `?`; Tab/Ctrl-I completion at cursor; history; paging; multiline paste; `do`, `end`, `exit`, `no`, `default`; copy console; on-screen special keys | `js/cli/registry.js:2760`; `js/ui/device-console.js:587`; `tests/cli.test.cjs:8` |
| Host desktop | IP Configuration and Command Prompt on PC/server; PC Web Browser; server Services; IPv4 static/DHCP and DNS/gateway; IPv6 static/automatic, prefix, gateway, link-local | `js/ui/host-desktop.js:107`; `js/ui/host-desktop.js:654` |
| Simulated browser | URL/Go/Back/status/error views; DNS and HTTP traverse the simulated network; safely render local simulated HTML, CSS and images without fetching external assets or executing scripts | `js/ui/host-desktop.js:343`; `js/ui/host-desktop.js:800` |
| Services UI | DHCP pool add/edit/remove; DNS A/AAAA add/remove; HTTP file create/edit/remove; TFTP enable; NTP stratum; syslog log display; AAA controls | `js/ui/host-desktop.js:1528` |
| Host commands | Windows-like `arp`, `getmac`, `hostname`, `ipconfig`, `netstat`, `nslookup`, `ping`, `route`, `ssh`, `telnet`, `tracert`, `help`/`?` | `js/cli/commands/host.js:535` |
| Persistence | Portable JSON open/download; named browser save/open/rename/delete/download/import; optional autosave; explicit storage/import errors; transactional validation/rollback; shared-topology import preserves own lab | `js/ui/panels.js:1221`; `js/storage/schemas.js:272`; `js/storage/repository.js:226` |
| Lab objectives | Objective predicates and task list; conditional action buttons; completion flag/copy and celebration; sandbox starts empty, with no objectives | `js/labs/definitions.js:4`; `js/labs/objectives.js:469`; `js/ui/lab-panels.js:34` |
| Runtime | Deterministic scheduler/manual clock; scheduled work canceled on device removal/power-off; protection against runaway frame loops; error surfaced and recovery path | `js/core/scheduler.js:55`; `js/core/scheduler.js:290`; `js/ui/simulation-presenter.js:19` |

Keyboard acceptance: Ctrl/Cmd Z; Shift-Z or Y; A/C/X/V/D; +/-; Delete/Backspace; Escape; `?`; arrow nudge 20 px, Shift-arrow 200 px; Space-pan; Ctrl-scroll zoom. Focused device Enter opens console and F2 renames. Console shortcuts are isolated from editor shortcuts; Ctrl-Z, Ctrl-C, Ctrl-Shift-6, history arrows, completion/help and paging retain their CLI meanings.

## Complete feature-family and command-category inventory

Paths in this table are real supplied files. Every family has execution/configuration code; breadth within a family must not be inferred from the larger catalogs.

| Family | Command/configuration categories and behavior | Evidence / qualification |
| --- | --- | --- |
| system | hostname, enable/user credentials, password encryption, banners, service settings, running/startup configuration, reload, terminal/session control | `js/cli/commands/system.js`; `tests/management.test.cjs:291` |
| interfaces | physical/loopback/tunnel/SVI/port-channel/subinterface/range, descriptions, addresses, shutdown, MTU/bandwidth/delay, interface displays | `js/cli/commands/interfaces.js`; `tests/features.test.cjs:9` |
| switching | VLAN create/name/delete, access/trunk/native/allowed VLANs, switchport state | `js/protocols/switching.js`; `tests/l2.test.cjs:46` |
| routing | connected/static/default/floating/permanent/recursive routes, AD, ECMP, RIB selection, Null0, routing enable/default gateway | `js/protocols/routing.js`; `tests/ip.test.cjs:189` |
| discovery | CDP/LLDP enable/timers, neighbor detail, native VLAN mismatch, neighbor aging/link loss | `js/protocols/discovery.js`; `tests/l2.test.cjs:220` |
| host | Windows-like command prompt and host IPv4/IPv6 configuration/traffic | `js/devices/host.js`; `js/cli/commands/host.js:535` |
| mac-table | dynamic learning, aging, static entries, move/flush, display/clear | `js/protocols/mac-table.js`; `tests/l2.test.cjs:46` |
| system-extras | clock/timezone/calendar, inventory/process/TCP/reload-related displays and system configuration | `js/cli/commands/system-extras.js`; `tests/features.test.cjs:15` |
| syslog | local/buffered/remote logging, levels, terminal monitor, source/session routing | `js/protocols/syslog.js`; `tests/management.test.cjs:232` |
| device-access | console/VTY, login/password/local, privilege, timeout, transport input, access-class, nested remote sessions | `js/protocols/device-access.js`; `tests/management.test.cjs:84` |
| http-server | simulated HTTP services/authentication/file responses and host browsing | `js/protocols/http-server.js`; `js/ui/host-desktop.js:1688` |
| ssh | modeled RSA keys, SSH enable/version/authentication and remote CLI transport | `js/protocols/ssh.js`; `tests/features.test.cjs:19` |
| aaa | local/method-list authentication, TACACS/RADIUS server/group configuration, line integration | `js/protocols/aaa.js`; `tests/management.test.cjs:175` |
| stp | PVST/rapid-PVST/MST; election, roles/cost/timers, topology change, guards/filter/PortFast/UplinkFast, MST regions/boundaries | `js/protocols/stp-stp-router.js`; `tests/stp.test.cjs`; limitations below |
| stp-router | router STP command compatibility/no-instance displays | `js/cli/commands/stp-router.js`; `tests/features.test.cjs:22` |
| intervlan | 802.1Q subinterfaces, native/tagged traffic, SVI autostate and routing | `js/protocols/intervlan.js`; `tests/l2.test.cjs:365` |
| dhcp | DHCP pools, exclusions, leases, client, helper/relay, Option 82, renewal/default route | `js/protocols/dhcp.js`; `tests/services.test.cjs:59` |
| acl | numbered/named standard/extended IPv4/IPv6 rules, sequence/order, match, interfaces, hit counters | `js/protocols/acl.js`; `tests/policy.test.cjs:101` |
| time-range | absolute/periodic ACL schedules and device clock evaluation | `js/protocols/time-range.js`; `tests/policy.test.cjs:291` |
| ipv6-fhs | RA guard, DHCP guard, source guard, ND inspection, snooping/device tracking and attachment configuration | `js/cli/commands/ipv6-fhs.js:651`; actual rogue-RA filtering covered at `tests/l2security.test.cjs:347`; other policies require individual validation |
| dhcpv6 | pools, stateful/stateless address and DNS, client, server preference, lease timers, relay/prefix delegation | `js/protocols/dhcpv6.js`; `tests/services.test.cjs:291` |
| filesystem | simulated flash/NVRAM, dir/copy/delete/more, archive, space checks, config files | `js/protocols/filesystem.js`; `tests/management.test.cjs:328` |
| physical | speed/duplex/media/physical state and interface status | `js/devices/physical.js`; `tests/features.test.cjs:30` |
| arp | dynamic resolution, static ARP, proxy/aging interactions | `js/protocols/arp.js`; `tests/ip.test.cjs:111` |
| arp-table | ARP show/clear and incomplete entries | `js/protocols/arp-table.js`; `tests/ip.test.cjs:123` |
| vtp | server/client/transparent, version/domain/password, revisions and VLAN synchronization | `js/protocols/vtp.js`; `tests/l2.test.cjs:188` |
| dtp | dynamic auto/desirable and trunk negotiation/mismatch/live changes | `js/protocols/dtp.js`; `tests/l2.test.cjs:88` |
| ntp | master/server/prefer, strata, source selection/reach/holdover and loop rejection | `js/protocols/ntp.js`; `tests/services.test.cjs:164` |
| snmp | communities/ACLs, groups/users/views/engine IDs, hosts/traps/settings and displays | `js/protocols/snmp.js:15`; configuration/display/storage observed, no packet-level agent established |
| fhrp | HSRP/VRRP/GLBP elections, virtual addresses/MACs, preemption/tracking, failover | `js/protocols/fhrp.js`; `tests/fhrp.test.cjs:125` |
| etherchannel | static/PAgP/LACP, groups and port-channel, priorities, active/standby selection, hash policies, member failure | `js/protocols/etherchannel.js`; `tests/lacp.test.cjs`; limitations below |
| errdisable | causes, recovery enable/timers, recovery state | `js/protocols/errdisable.js`; `tests/l2security.test.cjs:268` |
| storm-control | broadcast/multicast/unknown-unicast percentage thresholds, hysteresis, trap/shutdown, channel propagation | `js/protocols/storm-control.js`; `tests/network.test.cjs:5` |
| port-security | secure/sticky/static MACs, max, protect/restrict/shutdown, aging and moves | `js/protocols/port-security.js`; `tests/l2security.test.cjs:268` |
| nat | inside/outside, static/dynamic pools/PAT, translation/reverse traffic/counters/aging/exhaustion | `js/protocols/nat.js`; `tests/policy.test.cjs:135` |
| ipv6 | addressing/link-local, routing/static routes, ND/RA/SLAAC/DAD, ICMPv6 | `js/protocols/ipv6.js`; `tests/services.test.cjs:220` |
| prefix-list | IPv4/IPv6 permit/deny sequence, ge/le, filtering | `js/protocols/prefix-list.js`; `tests/policy.test.cjs:264` |
| keychain | keys/key strings and lifetimes, protocol authentication | `js/protocols/keychain.js`; `tests/policy.test.cjs:318` |
| ospf | v2/v3/IPv4 AF, process/router-ID, network/interface enable, areas, neighbor exchange/election, cost/ECMP, auth/MTU/timers, summaries, stub/NSSA/virtual links, redistribution/defaults | `js/protocols/ospf.js`; `tests/ospf.test.cjs` |
| bgp | iBGP/eBGP neighbors/FSM/AS/timers, AF/network/aggregate, next-hop/reflection, attributes/best path/policy/communities, max-prefix/shutdown/multihop/TTL security | `js/protocols/bgp.js`; `tests/bgp.test.cjs:83` |
| nhrp | mapping/NHS/network-ID, mGRE/DMVPN registration and phase-2 spoke resolution | `js/protocols/nhrp.js`; `tests/overlay.test.cjs:316` |
| bfd | templates/timers and per-peer fast failure detection with OSPF/EIGRP/BGP clients | `js/protocols/bfd.js`; `tests/fhrp.test.cjs:346` |
| vrf | VRF-lite definitions/RD/AF/route-target configuration, interface binding, isolated overlapping routing/ARP, global recursion | `js/protocols/vrf.js`; `tests/ip.test.cjs:276`; route-target configuration alone does not establish MPLS VPN |
| gre | source/destination/mode/key, underlay reachability, tunnel routing/recursion/counters | `js/protocols/gre.js`; `tests/overlay.test.cjs:258` |
| route-map | ordered permit/deny, prefix/ACL/tag/AS-path/community matches and setters, PBR/redistribution/BGP attachment | `js/protocols/route-map.js`; `tests/policy.test.cjs:198` |
| ip-sla | ICMP echo and configuration modes for jitter/HTTP probes, scheduling, results and tracking | `js/cli/commands/ip-sla.js:238`; ICMP echo behavior covered at `tests/fhrp.test.cjs:310`; variants require verification |
| track | interface/route/SLA object tracking, delays, routing/FHRP use | `js/protocols/track.js`; `tests/fhrp.test.cjs:310` |
| span | local monitoring source/destination behavior; ERSPAN configuration submodes | `js/protocols/span.js`; local behavior at `tests/l2.test.cjs:339`; ERSPAN scope not established by that test |
| eigrp | classic/named/IPv6 processes, neighbors, metric, DUAL/query/reply/SIA, stubs, feasible successors/variance, summaries/redistribution | `js/protocols/eigrp.js`; `tests/eigrp.test.cjs:40` |
| crypto | modeled IKE/IPsec policy/key/transform/map, traffic-selected SAs/ESP, clear/mismatch and GRE protection | `js/protocols/crypto.js`; `tests/overlay.test.cjs:368` |
| multicast | IGMP membership/querier/snooping, PIM DR/SM/DM/RP/register/SPT/flood-prune/graft/RPF, expiration | `js/protocols/multicast.js`; `tests/overlay.test.cjs:53` |
| dhcp-snooping | trusted ports/VLANs/bindings/rate limit, rogue server/client drops, Option 82 | `js/protocols/dhcp-snooping.js`; `tests/l2security.test.cjs:104` |
| arp-inspection | binding/ARP-ACL checks, source/destination/IP validation, trust/rate controls | `js/protocols/arp-inspection.js`; `tests/l2security.test.cjs:214` |
| dns | host table/name server/domain, simulated A/AAAA queries and resolution for IOS/hosts | `js/protocols/dns.js`; `tests/ip.test.cjs:294` |
| qos | class/policy maps, DSCP matching/marking, interface policies, modeled policer drops and counters | `js/protocols/qos.js`; `tests/policy.test.cjs:264` |
| netflow | classic/flexible records/exporters/monitors/cache/top-talkers configuration and flow accounting | `js/protocols/netflow.js`; `tests/policy.test.cjs:347` |
| eem | applets/events/actions, syslog and CLI automation with independent VTY context | `js/protocols/eem.js`; `tests/management.test.cjs:371` |
| ptp | mode/domain/priorities, topology-derived clock election/path display | `js/protocols/ptp.js`; `js/cli/commands/ptp.js:24`; simplified graph-based model, no packet/timer synchronization demonstrated |
| sso | redundancy mode and show/config persistence | `js/devices/redundancy.js:4`; configuration/display state, no redundant-processor failover |
| udld | normal/aggressive, interval/port configuration, one-way failure detection and recovery | `js/protocols/udld.js`; `tests/l2.test.cjs:306` |
| rip | v1/v2/RIPng, networks, timers/poisoning, split horizon, summaries, auth, offset/filter/default/redistribution | `js/protocols/rip.js`; `tests/rip.test.cjs:63` |
| cef | shared RIB/FIB, recursive/weighted ECMP, hash policy, exact route, IPv4 show/no/default and actual forwarding | `js/protocols/cef.js`; `tests/cef.test.cjs:40` |
| aliases | local IP alias inspection | `js/cli/commands/aliases.js`; `tests/features.test.cjs:70` |
| icmp | echo, unreachable, time exceeded, IPv4/IPv6 ping and traceroute semantics and rate limits | `js/protocols/icmp.js`; `tests/ip.test.cjs:106` |
| tftp | simulated inter-device read/write/file-not-found/unreachable/config merge and startup copy | `js/protocols/tftp.js`; `tests/network.test.cjs:172` |

## Persistence and compatibility details

The legacy portable envelope uses `v:2`, `kind:"netlab-sandbox"`, `doc`, `storage`; older topology files/version 1 migrate. A document includes devices, links, notes and viewport, with device power/position locks and separate persistent device storage. Legacy Cisco names/interface numbering are migrated to generic names. The new project format may be original, but importing reference labs should preserve these semantics if offered.

The reference save is not a full live snapshot: running protocols, packet queues, terminal history and unsaved router/switch running configuration are omitted. `write memory`/`copy running-config startup-config` must precede export to preserve those configuration changes. Browser storage errors are visible and corrupt data is retained. Invalid imports do not replace the current lab; startup errors attempt rollback. Opening a portable JSON clears undo history, while opening a named browser save is undoable.

Reference limits are 100 devices, 300 links, 100 notes, 80 Unicode characters per note, 10 MB portable JSON, 50,000 text lines per stored startup config and nested JSON depth 64 (`js/storage/schemas.js:8`). These are minimum compatibility considerations, not a reason to truncate larger user input silently.

## Explicit limitations, partial models and non-features

- Extended ping displays prompts for ToS, data validation/pattern, IP source-route/record/timestamp and sweep, but discards those answers in `js/cli/commands/icmp.js:346–380`; only DF is stored in that section. Those prompts are not evidence of corresponding packet behavior.
- Catalog syntax is not implementation evidence. Do not import catalogs, promise every IOS/IOS XE command, or return fake success for unsupported commands. Unknown supported-looking commands must clearly fail with a useful diagnostic.
- Ethernet is the only shipped cable transport (`js/core/topology.js:440`). Serial is explicitly unsupported, and acceptance of serial/console labels in schemas does not provide a functional transport. Wireless nodes, hardware module insertion and a Packet Tracer-style physical workspace were not found.
- UI-created switch defaults deliberately use rapid-PVST/PortFast; factory devices use PVST (`README.txt:267`). An original product should choose and explain its own defaults consistently.
- STP BackboneFast RLQ, Bridge Assurance, transmit hold-count enforcement and the separate event-logging knob are configuration-only. MST uses internal modeled messages/digest rather than IEEE wire records. Hardware instance/cross-stack limits are absent (`README.txt:140`).
- CEF has no independent hardware adjacency/rewrite database, no hardware performance/dCEF/line cards/per-packet balancing, and no implemented `show adjacency` or `show ipv6 cef` (`README.txt:188`).
- LACP uses slow timers only; fast rate, min-links, max-bundle, 1:1 redundancy/dampening and cross-stack behavior are not implemented. The load-sharing hash is a teaching model, not an ASIC reproduction (`README.txt:244`).
- Storm control uses approximate one-second percentage accounting, not bps/pps policing. PTP is simplified. AES-256, QoS `match ip`, and NetFlow `bytes long` are explicitly unsupported (`README.txt:267`).
- SNMP, SSO and PTP limitations are recorded in the family table. Family tests cannot establish full semantics for ERSPAN, non-ICMP SLA, every IPv6 FHS mode, or every authentication variant.
- Cryptography and protocol authentication are simulated educational behavior, not interoperable implementations or security guarantees. The application never forms real routing adjacencies or exposes real network services.
- The default end-user shell has no Packet Tracer-style packet event list, inspectable PDU layers, visible single-step controls, or authored lesson collection. Those may be original improvements; the internal deterministic clock and objective engine do not imply existing UI for them.

## Fresh implementation acceptance practice

For each row, track new implementation status as implemented with behavioral tests, configuration-only with explicit UI disclosure, or unsupported. A command must not report completion while silently skipping a material behavior. Preserve the simplest useful workflows while driving each show command from actual configuration/runtime state. Validate packet delivery, convergence, failure recovery and isolation on deterministic multi-device labs, in addition to parser and rendering tests. The breadth of this inventory means a passing smoke test or a newly styled canvas does not establish full parity.
