# IOS command and service compatibility audit

This work uses the supplied sandbox as a read-only behavioral reference and Cisco documentation as the syntax/output reference. NetworkSim contains an original implementation. No sandbox runtime, Cisco image, decompiled implementation, or copied command catalog is shipped in the offline HTML.

## Evidence

REA analyzed selected parser, registry, shared CLI, alias, logging, and system-command artifacts from the reference tree. Root SHA: `c876ec258e6f81eb831b7d5d95cb517b78ba6d0e77d155c5df14fc5e4a8089ec`.

- Parser/shared/session parent evidence: `ev_a602dcc4ad0755daaa5d3538f05f738ab93e8d6335310c782263be713a6f35e5`; summary `ev_39a39adc491b73d22f235388fa4469da40a00d0cc588553453b22db897d5284c`.
- Registry/alias/logging/system parent evidence: `ev_f91945cdc03d2986277066d4fc4ab197cac912be3aa955f873ce32d79813fff7`; summary `ev_a93356d742cbab8979d5194d83904568fc9ed9a36ed19942f01e854a5027b85b`.

These are focused static analyses, not exhaustive runtime proof. The separate executable [command ledger](command-parity-audit.md) covers registered commands. Original packet/state tests establish the behavior described below. The [interaction audit](ios-cli-interaction-audit.md) records REA browser verification, and the [output reference](ios-output-reference.md) records IOS display sources.

## Operational changes

- Software and calendar clocks use deterministic simulation time. Clock output uses IOS-style ordering, timezone and source markers. NTP master, peer/server selection, trusted keys, authentication compatibility, poll interval, stratum/loop rejection, holdover and reference clocks affect actual exchanged NTP packets. A master can reject a looping upstream association while remaining synchronized to its local reference.
- Logging honors enablement, severity, local buffer size, console/monitor settings, sequence numbers and timestamps. Debug commands select actual engine events and do not invent protocol activity. Output filters operate on produced lines; redirection writes simulated flash.
- DHCP delivers configured domain, boot file, next server, custom options, multiple router/DNS options and infinite lease information through the existing discovery/request exchange.
- DNS answers populate an expiring local cache. Lookup disable, static host lookup and selective cache clearing change resolution. Interface redirect/unreachable controls govern actual ICMP emission; hosts validate delivered redirects before installing temporary host routes.
- Interface MAC overrides affect neighbor resolution. IPv6 DAD attempt counts govern tentative-state duration; zero disables probing. Reachable-time and cache-expiry controls affect neighbor state. Named IPv6 general prefixes derive interface addresses and update connected/local routes when changed or removed.
- TCP SYN MSS adjustment affects both the persistent routing transport and segmented request/response services. UTF-8 payload segments obey negotiated MSS; delivery, reassembly and acknowledgments remain packet-driven.
- Local policy routing selects next hops for originated traffic. Classic NetFlow configured active/inactive timeouts age and export actual cached records, carrying the configured export version in the simulated datagram.
- Password minimum length applies when new credentials are entered; failed commands restore the previous configuration. Existing short credentials are not invalidated by enabling a policy. Login blocking records failed remote authentication, enforces quiet mode and expires using simulated time. SSH timeout/retry limits apply during authentication, separately from EXEC idle timeout.
- HTTP custom ports and HTTP access-class govern actual TCP requests. Modeled HTTPS endpoints accept the HTTPS scheme on their selected port, reject protocol mismatches, and use the same delivered authentication/file service.
- Configuration import handles both rendered indented configurations and flat command scripts, preserving mode-sensitive commands. Running/startup headers can be pasted back. Settings are rendered in an order that preserves pre-existing credentials when a minimum-length policy is saved later.
- Reload and startup erasure use confirmation prompts. Reload offers to save modified configuration, including a first unsaved configuration, supports relative or dated scheduling and cancellation, and records the actual restart reason. The configuration register retains current/next values outside running configuration; its `0x40` bit skips NVRAM at boot without deleting the saved configuration. Other hardware boot bits remain metadata.
- RADIUS and TACACS server settings accept the reference's port, timeout, key encoding and retransmit forms. `test aaa group` sends actual simulated requests without replacing login policy or changing the current privilege. Enable authentication uses the configured method list; received rejection stops fallback, while unavailable servers permit it. RADIUS retransmissions and TACACS timeouts use simulation time.
- DHCP helper addresses accumulate instead of replacing one another. Selective removal preserves the other helpers. IOS router DHCP services reject zero-giaddr option-82 requests until the receiving interface or all relays are trusted. DHCP server statistics count received and transmitted messages.
- Strict/loose unicast reverse-path checks inspect actual recursive forwarding paths and apply configured ACL exceptions. Numeric IPv4/IPv6 ACL protocols match actual protocol IDs, with counters driven by delivered packets.
- VRF address-family contexts have their own prompt, return path and retained metadata. Flow record/exporter/monitor descriptions survive configuration import. Full removal forms for DHCP, SSH, CEF, flow settings and SLA operations validate input before changing state.
- `show users` identifies actual simulated VTY sessions and the calling session, with idle time from last activity. EEM history records executed action counts and failure/success outcomes; system show commands and host `netstat` use aligned tables instead of internal JSON.

## Explicit simulation boundaries

The CLI does not run a Cisco IOS image. `show version` and `show inventory` use [distinct NetSim platform identities](ios-output-reference.md#netsim-platform-identities), and the running-config header, boot transcript, received discovery software and SNMP description use the same application software version. Uptime and reload reasons come from device runtime; serials are stable per-device simulated identifiers. Hardware capacities are documented virtual specifications rather than measurements of the host. Cisco copyright and licensing text is omitted. IOS syntax/layout compatibility is retained, not a claim of Cisco firmware or exact equivalence to every IOS image.

SSH and HTTPS use simulated TCP services, without SSH/TLS cryptography. NTP authentication checks a deterministic identity tag rather than wire-compatible MD5. BGP transport authentication follows the same logical compatibility approach. NetFlow version is modeled message metadata, not a binary wire encoder. TCP uses a bounded 1,024-byte maximum modeled segment, further reduced by configured transit MSS.

Reference handlers for outside-source NAT, SCP enablement, NETCONF/RESTCONF flags, boot image selection and physical media selection store configuration without providing the corresponding data-plane implementation. Their original NetworkSim compatibility handlers preserve configuration and explicitly report that boundary; they do not fake sessions, translation traffic, datastore operations or booted images. Ethernet keepalive and serial signaling are also configuration-only. NTP burst/iburst flags are retained but do not implement burst scheduling. The executable ledger retains unresolved paths and intentional validation differences rather than counting them as complete.

TACACS `single-connection` is retained as a disclosed setting; generic management transactions still use individual modeled TCP connections. VRF route distinguishers and route targets are retained metadata for this VRF-lite simulator; an MPLS VPN import/export data plane is not implied by entering a VRF address-family mode.

Reference anchors for those boundaries: `js/cli/commands/nat.js` outside source registration and `js/protocols/nat.js` outside static count-only use; `js/cli/commands/http-server.js` SCP/NETCONF/RESTCONF handlers and `js/protocols/http-server.js` service initialization; `js/cli/commands/filesystem.js` boot selection; `js/cli/commands/physical.js` media selection.

## Verification

`tests/ios-system.test.ts`, `tests/ios-service-compat.test.ts`, and `tests/ios-platform-compat.test.ts` cover formatting, defaults, actual service exchanges, negative authentication, cache/counter clearing, local PBR, IPv6 address transitions, configuration round trips and two-way MSS-limited HTTP delivery. Existing management/service and core protocol tests supplement these. Final integration counts are recorded in the main command audit rather than frozen here.

## Primary Cisco references

- [IOS CLI basics](https://www.cisco.com/c/en/us/td/docs/ios/fundamentals/configuration/guide/TIPs_Conversion/cf_15_1s_book/cf_cli-basics.html): modes, editing, help and completion.
- [show clock](https://www.cisco.com/E-Learning/bulk/public/tac/cim/cib/using_cisco_ios_software/cmdrefs/show_clock.htm) and [service timestamps](https://www.cisco.com/E-Learning/bulk/public/tac/cim/cib/using_cisco_ios_software/cmdrefs/service_timestamps.htm): display conventions.
- [System message logging](https://www.cisco.com/c/en/us/td/docs/routers/access/wireless/software/guide/SysMsgLogging.html): severity and logging configuration.
- [IOS output commands and filters](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/Cisco_IOS_Configuration_Fundamentals_Command_Reference/show_through_show_fm_summary.html): show and filtering grammar.
- [DHCP server configuration](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/ip-addressing/b-ip-addressing/m_config-dhcp-server-xe.html): pool options and leases.
- [Time and calendar configuration](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/syst-mgmt/b-system-management/m_bsm-time-calendar-set.html): NTP master, associations and authentication.
- [IP application commands](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipapp/iap-cr-book/iap-i2.html): `ip tcp adjust-mss` syntax and 500–1460 range.
- [NetFlow export configuration](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/netflow/configuration/15-mt/nf-15-mt-book/cfg-nflow-data-expt.html): active 1–60 minutes and inactive 10–600 seconds.
- [IPv6 command reference](https://www.cisco.com/c/en/us/td/docs/ios/ipv6/command/reference/ipv6_book/ipv6_07.html): DAD/neighbor-discovery options.
- [IPv6 generic prefixes](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipv6_basic/configuration/15-mt/ip6b-15-mt-book/ip6-generic-prefix.html): named prefix composition.
- [SSH version 2](https://www.cisco.com/en/US/docs/ios-xml/ios/sec_usr_ssh/configuration/15-1s/sec-secure-shell-v2.html): authentication timeout/retries.
- [HTTP services commands](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/https/command/nm-https-cr-book/m_nm-https-cr-cl-sh.html): ports, endpoint enablement and access-class.
- [AAA command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/a1/sec-a1-cr-book/sec-cr-a1.html): enable authentication and method-list behavior.
- [TACACS command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-t1.html) and [RADIUS troubleshooting](https://www.cisco.com/c/en/us/support/docs/security-vpn/remote-authentication-dial-user-service-radius/113666-tg-ios-per-vrf-00.html): server settings and test authentication.
- [DHCP relay commands](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr/command/ipaddr-cr-book/ipaddr-i2.html): interface trust and default untrusted behavior.
- [IP switching command reference](https://www.cisco.com/c/en/us/td/docs/ios/ipswitch/command/reference/isw_book/isw_i1.html): unicast reverse-path verification.
- [Reload command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/R_through_setup.html): confirmation, save, scheduling and cancellation.
- [Configuration register and startup configuration](https://www.cisco.com/c/en/us/support/docs/routers/2500-series-routers/6201-lose-config-6201.html): `0x2142`, `0x2102` and next-reload display.
- [show users](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s5.html) and [EEM show commands](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/eem/command/eem-cr-book/eem-cr-s1.html): session and event table conventions.
