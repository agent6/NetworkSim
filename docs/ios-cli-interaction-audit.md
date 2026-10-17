# IOS CLI interaction audit

Reviewed 2026-10-16. This is the interaction portion of the older-sandbox comparison, not a claim of complete Cisco IOS support.

## Evidence and boundary

The supplied reference is a complete JavaScript source tree. Following REA's source-repository rule, this portion used direct source inspection and executable probes rather than starting a binary analysis session. Reference files: `network-sandbox/js/cli/parser.js`, `network-sandbox/js/cli/registry.js`, `network-sandbox/js/ui/device-console.js`, and the mode declarations in `network-sandbox/js/cli/commands/{acl,aaa,ipv6-fhs}.js`. Original runtime code and help metadata were written independently; none of the reference's implementation or command catalogs are imported.

Cisco's [IOS XE CLI fundamentals](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/configuration/xe-16-12/fundamentals-xe-16-12-book/cf-cli-basics.html) distinguishes partial-word help from next-argument help, uses `<cr>` when the line is executable, and documents unique-prefix completion. It also documents Return/Space paging, zero-length paging disablement, word motion, delete shortcuts, and redraw shortcuts. These rules are interaction targets; the document does not establish behavior of every command implemented here.

The [Catalyst 9400 CLI reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/26-x/command_reference/b_26x_9400_cr/using_the_command_line_interface.html) distinguishes incomplete, ambiguous, and invalid syntax. Invalid syntax includes a caret aligned with the offending input. It also distinguishes `default` from `no`: a default-enabled feature must be restored to its enabled default.

## Reproduced discrepancies at audit start

| Probe | Earlier NetworkSim behavior | Required correction |
| --- | --- | --- |
| `show zzunknown` | Invalid-input text mentioned a marker that was absent | Include a caret line aligned with the prompt and rejected token |
| Interface mode: `ip address 192.0.2.1 ?` | No matching command | Show the subnet-mask argument |
| Interface mode: `ip address 192.0.2.1 255.255.255.0 ?` | No matching command | Offer `secondary` and `<cr>` |
| Interface mode: `ip address 192.0.2.1 255.255.255.0 sec<Tab>` | No completion | Complete a unique argument keyword |
| Global mode: `router ospf ?` | Parent's broad argument string | Show the process identifier argument |
| `NO shut<Tab>` | No completion while execution accepted uppercase keywords | Treat keywords consistently regardless of case |
| Router: `default ip routing` | Disabled forwarding | Restore the router's enabled default |
| Ctrl-L | Erased transcript | Redisplay current command, preserving transcript |
| Ctrl-X, Ctrl-R, Ctrl-T, Esc B/F | Missing or browser behavior | Implement the documented editing actions |
| `ipv6 access-list TEST` | `(config-ext-nacl)#` | `(config-ipv6-acl)#` |
| `radius server TEST` / `tacacs server TEST` | Generic server mode prompt | Preserve the protocol-specific prompt |
| IPv6 guard policy commands | Generic IPv6 guard prompt | Preserve the policy-specific prompt |

The reference has argument-aware help and caret formatting in its registry, and Ctrl-X/R/L/T plus Esc word motion in its terminal handler. It is useful evidence of the previous application's behavior, but it is not treated as authoritative when Cisco documents a different action.

## Original helper implementation

`src/ios-syntax.ts` provides source-position tokenization, aligned invalid-input formatting, bounded contextual help, argument completion, and conservative error positioning. Its explicit schemas cover common addressing, interfaces, VLAN and trunk configuration, route selection, routing process/network/neighbor entry, sequence-prefixed IPv4/IPv6 ACLs with source/destination port operators and ICMP types, static-route VRF/name/tag/track options, AAA method lists, NAT, prefix lists, selected protocol/security option grammars, terminal settings, and output filters. It reads the live interface list and retains abbreviated fixed words. Help and completion never run configuration handlers, send packets, advance time, or modify history.

The helper returns `undefined` when it cannot establish an argument grammar, allowing the caller's existing help to remain available. Simple argument metadata from the new implementation supplies conservative help where its structure is unambiguous; it never authorizes execution or validates a handler. Negative syntax only offers a bare `<cr>` where the handler supports bare removal. Expanded command branches are resolved against their original syntax root, preventing repeated parent keywords in help.

`tests/ios-syntax.test.ts` probes the actual command registry and then executes representative displayed syntax. It checks address/mask progression, optional secondary addresses, unique and ambiguous BGP keyword completion, live interface names, `do` context, negative syntax, caret position, and state immutability during help. The 16 focused syntax and terminal tests passed after integration, including actual incomplete/ambiguous/invalid execution probes, privilege-level guards, write/save behavior, terminal metadata, flash-file redirection, and flash quota failure atomicity.

## Prompt references

- Cisco [web authentication examples](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-17/configuration_guide/sec/b_1717_sec_9300_cg/configuring_web_based_authentication.html) show distinct RADIUS and TACACS server configuration prompts.
- Cisco [IPv6 first-hop security guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/c9000/sec-crypto/fhs-sisf/fhs-and-sisf-configuration-guide/ipv6-first-hop-security.html) shows policy-specific RA guard, DHCP guard, ND inspection, and source guard prompts.
- Cisco [IPv6 ACL configuration](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst3650/software/release/16-2/configuration_guide/b_162_consolidated_3650_cg/b_162_consolidated_3650_cg_chapter_010010.html) provides the named IPv6 ACL and RA guard mode context.

## Remaining verification limits

The helper tests do not establish that every optional argument of every command has context-sensitive help. Exact error wording for semantic failures varies by IOS release and platform. Complete command-output verification remains separate from this interaction evidence. No live Cisco IOS image was executed for this audit.

## Browser and session verification

A controlled REA browser replay launched an isolated, headless Chromium 155.0.8059.84 process with empty storage against the temporary loopback preview. The capture is saved in [ios-terminal-browser-evidence.json](research/ios-terminal-browser-evidence.json), evidence `ev_e17dade32005d9e5dd3ea05f155494daa6367ce128dd620d418c9a2f54ba1334`. Every replay step completed and no page errors were recorded.

Observed in the rendered interface:

- `terminal length 3` followed by `show ?` displayed three help rows and `--More--`; Enter revealed one further row, and `q` restored the original `show ` draft.
- Ctrl+C discarded an unsubmitted `hostname Discarded`, returned to privileged EXEC, and `show running-config | include ^hostname` still reported `hostname R1`.
- Ctrl+Z submitted `hostname Accepted` and returned to `Accepted#`; the same show command confirmed the new name. Ctrl+Z in EXEC produced no invalid `end` error.
- Ctrl+L and Ctrl+R retained both the transcript and the editable `draft kept` input.

The [Cisco secure CLI configuration guide](https://www.cisco.com/c/en/us/td/docs/routers/ios-xe/security-vpn/security-vpn/m_sec-cfg-sec-4cli-0.html) documents the difference between cancelling input with Ctrl+C and executing the current configuration command with Ctrl+Z.

Session width now wraps output before pager rows are counted; width zero disables this wrapping. UI history reads the bounded CLI history, editing settings control enhanced navigation, and prompt timestamps use the simulated clock. The same metadata crosses simulated SSH/Telnet sessions. Bare `configure` offers the source prompt, bare `write` saves, and `write terminal` displays the current configuration. Default EXEC aliases dispatch their corresponding commands.

`count`, `redirect`, `append`, and `tee` operate on actual generated output. Redirection writes to simulated flash and enforces its storage capacity; external file destinations are explicitly unsupported. Cisco's [output redirection guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/configuration/xe-3e/fundamentals-xe-3e-book/fundamentals-xe-3e-book_chapter_010.html) and [command reference](https://www.cisco.com/c/en/us/td/docs/ios/fundamentals/command/reference/cf_book/cf_s1.html) establish these command roles.

## Switching and first-hop security closure

The executable reference paths in `js/cli/commands/ipv6-fhs.js`, `stp.js`, `qos.js`, and `switching.js` were compared with the corresponding packet consumers. `src/ios-switching-compat.ts` supplies independently written command handlers and configuration serialization. `src/fhs-tracking.ts` supplies binding state and lifecycle; no reference code or command catalog is loaded by the application.

The following now affect real simulated traffic or state:

- `device-tracking policy` and `ipv6 snooping policy`, named/interface/VLAN attachment, device roles, trust, security levels, address limits, binding lifetime configuration, per-port/per-VLAN counters, and binding/drop logging. IPv6 snooping excludes IPv4 learning. Static IPv6 security bindings persist in configuration; learned bindings expire on simulation time and react to interface shutdown.
- ND inspection policy address limits and tracking lifetimes, source-guard trust, and VLAN RA/DHCP/ND/source guard attachment fallback. Interface attachments override VLAN attachments.
- `control-plane` / `service-policy input` runs the existing class matching and byte token bucket on device-addressed IP packets. Transit traffic continues through its own interface policies.
- `vlan` / `state active|suspend` drives the existing VLAN forwarding gate. STP short/long path costs change computed root metrics; global PortFast, BPDU guard/filter and loop guard defaults participate in forwarding state and actual BPDU loss/recovery. Explicit interface overrides are retained in rendered configuration.

Primary sources used for behavior include Cisco's [SISF device-tracking guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9500/software/release/17-1/configuration_guide/sec/b_171_sec_9500_cg/configuring_sisf_based_device_tracking.html), [Catalyst 9300 security command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-15/command_reference/b_1715_9300_cr/security_commands.html), [IOS spanning-tree command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/lanswitch/command/lsw-cr-book/lsw-s2.html), and [spanning-tree feature guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst6500/ios/15-4SY/config_guide/sup6T/15_3_sy_swcg_6T/spanning_tree_features.html). In particular, globally configured BPDU filtering must yield to a switch peer rather than permanently suppressing its STP participation.

`tests/switching-compat.test.ts` has 13 operational tests, all passing. They include delivered ARP/NDP/RA frames, real ping success/failure, one-way BPDU loss, simulator-clock aging, command import/export, and malformed command state preservation. The 76 core and 40 CLI regression tests also passed after these changes.

The binding implementation retains the reference's finite state/lifetime model. It does not reproduce hardware-specific TCAM limits, SEND cryptographic validation, or Cisco's active address-ownership polling. The legacy source-guard `trusted` command is retained for reference compatibility; current Catalyst platform documentation limits support for that option. These tests verify original simulator behavior, not binary equivalence to a running IOS image.

## Final switching and terminal follow-up

The final targeted regression ran 201 tests across the control-plane, packet engine, management sessions, terminal, syntax, switching-compatibility, and switching-output suites, with all tests passing. The new output suite has 12 operational tests and the syntax suite has 12. TypeScript checking passed after integration. Evidence is reproducible from `tests/ios-show-switching.test.ts`, `tests/switching-compat.test.ts`, `tests/ios-terminal.test.ts`, and `tests/ios-syntax.test.ts`; the earlier browser capture remains the evidence for rendered terminal keyboard and pager behavior.

Additional corrections now connect the commands to these behaviors:

- Per-VLAN/MST port costs and priorities change root-port selection; shared links observe classic timers. A delivered PVST BPDU causes a rapid port to retain legacy detection until `clear spanning-tree detected-protocols [interface ...]` clears it. MST region edits remain pending until exit/end, `show current|pending` distinguishes them, and `abort` discards them. VLAN reassignment removes the previous instance mapping. Cisco documents this transaction behavior in its [MST troubleshooting guide](https://www.cisco.com/c/en/us/support/docs/lan-switching/stp/218351-troubleshoot-mst-on-catalyst-9000-switch.html).
- Voice VLANs carry tagged traffic on access ports; the `dot1p` selection admits priority-tagged frames. SVI autostate excludes selected member ports without disabling their ordinary forwarding. Interface `vtp` gates actual modeled database propagation. `switchport host` applies access mode, PortFast, and EtherChannel removal.
- `src/ios-errdisable.ts` records actual fault causes/deadlines. Recovery can be enabled after a fault, changing or disabling recovery reschedules/cancels its timer, and physical BPDU-guard/UDLD shutdown uses the same mechanism. `shutdown` followed by `no shutdown` clears the latch. The display derives remaining seconds from the simulation clock. Cisco's [errdisable recovery guidance](https://www.cisco.com/c/en/us/support/docs/lan-switching/spanning-tree-protocol/69980-errdisable-recovery.html) establishes these recovery and inspection roles; the simulator uses deterministic timers instead of platform jitter.
- ARP ACL `any`, host, IP/MAC wildcard, request/response and logging variants match actual ingress ARP messages, and serialize back to accepted syntax. Cisco's [IP addressing command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr/command/ipaddr-cr-book/ipaddr-a1.html) documents the ARP ACL context and `any` alternatives.
- IPv4 and IPv6 line access classes evaluate actual source/destination addresses before admission or outgoing connection. Transport output prevents prohibited connection traffic. Transport arguments normalize unique abbreviations and reject mixed `all`/`none` lists. `default` restores editing/history/EXEC, terminal dimensions/history size, timeout and transports rather than blindly negating them. Full no/default forms validate any supplied values before changing state.

`src/ios-show-switching.ts` formats VLAN summary/RSPAN, MST configuration and active trees, UplinkFast/BackboneFast, VTP interface/password/synchronization state, DTP compatibility, LACP/PAgP local and negotiated members, errdisable detection/recovery, and measured storm load. It validates filters and never invents PDU counters. FHS policy displays use their own handlers so a generic IPv6 DHCP/neighbor formatter cannot intercept them. Cisco's [DTP command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s3.html) supplies the administrative/operational display terminology.

Model boundaries remain explicit. Periodic DTP/VTP/LACP/PAgP packet state machines and advertisement counters are absent; VTP reports actual database synchronization events, and EtherChannel displays computed compatibility. VTP pruning, BackboneFast, bridge assurance, EtherChannel misconfiguration guard, transmit hold-count and the MST PVST-simulation knob retain configuration with an explicit limitation message. Non-modeled errdisable detector causes are identified as configuration-only. No hardware flap-rate thresholds are fabricated.

Terminal transport defaults vary across images: Cisco's [terminal-services reference](https://www.cisco.com/c/en/us/td/docs/ios/termserv/command/reference/tsv_book/tsv_s1.html) documents older input `all` and later input `none`, output `all`, and preferred Telnet. NetworkSim deliberately retains its existing input `all` profile, output `all`, and preferred Telnet; it does not claim one universal IOS-image default. Likewise its existing VTP default remains transparent/version 2. These profile choices are separate from verifying the accepted syntax and actual state transitions.

The final syntax pass adds protocol numbers 0–255 to ACL help while routing numbers 6/17 to port operators and 1/58 to ICMP type/code arguments. Other numeric values retain ordinary IP source/destination grammar. The keyword list reflects the actual IPv4/IPv6 parser. The 14 syntax tests pass, including actual entries for TCP, UDP, ICMPv6, unknown numeric protocols, range rejection without mutation, `show users all`, AAA test mode completion, hexadecimal configuration-register reset, and scheduled-reload help for both day/month orders. Help does not claim that an incomplete date can be executed.
