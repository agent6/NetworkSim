# NetworkSim

An original network learning simulator for CCNA and CCNP Enterprise practice, with a Tailwind interface, Cisco-style command line, routers, Layer 2/Layer 3 switches, computers, servers, WLCs, access points, wireless laptops and VoIP phones. It runs entirely inside a browser.

## Open the app

Double-click **index.html** in this folder and open it in a current browser. The file contains the program, compiled Tailwind CSS and embedded device artwork and SVG toolbar icons. It needs no server, internet connection, Packet Tracer installation, account or package manager to run. Keep a copy of this one file anywhere you want to use it.

The source build targets Safari 17+, Chrome 120+ and Firefox 121+. The current lab saves automatically in this browser and reopens after refresh, including topology, configurations, notes and canvas position. Browser saves and clipboard access depend on browser permissions, especially for files opened from disk. **Export lab** downloads a portable `.netsim.yaml` backup; **Import lab** is immediately beside it.

## Start a lab

Open **Lab catalog** for guided practice or a completed reference topology. **CCNA** is organized into **Fundamentals**, **Switching**, **Routing**, and **Services & Security**. Start with **IPv4 interface configuration** under Fundamentals to address and enable two router interfaces, then verify connectivity in both directions. **IPv4 addressing troubleshooting**, also under Fundamentals, starts with a wrong router address, PC subnet mask and PC default gateway across two LANs. Repair the settings through the router console and PC IP settings or Command prompt, then verify both directions. **Router on a stick** is under Routing. Each lab has a share link that uses the current deployment URL; opening the link previews the guide before replacing your workspace.

**DHCP server and relay** under Fundamentals uses a dedicated server and two clients on another subnet. Configure the server pool in **Services → DHCP** and R1’s `ip helper-address`, then use the guide to request leases and test routed connectivity. Lease tasks require actual DHCP exchanges with the correct address, mask, gateway and DNS options.

**Layer 2 switching interfaces** under Switching covers VLAN 10 access ports, descriptions, automatic speed/duplex, PortFast and an unused port’s shutdown state. Both PCs are already addressed. Send traffic to verify dynamic MAC learning and same-VLAN connectivity; no router or default gateway is required.

**Layer 3 routed interfaces**, also under Switching, uses a multilayer switch and two pre-addressed PCs on different subnets. Convert the physical ports with `no switchport`, assign their gateway addresses, enable `ip routing`, and verify connected routes and traffic in both directions.

**VLAN and access ports**, also under Switching, separates four pre-addressed PCs into VLAN 10 and VLAN 20. Configure the access-port groups with `interface range`, verify both same-VLAN pairs, inspect VLAN-scoped MAC entries, and check that cross-VLAN pings fail without inter-VLAN routing.

**Voice VLAN** under Switching uses two PoE phones with a PC behind each phone. Open PSW1 and choose **Open console** to configure data VLAN 10, voice VLAN 20, PortFast, CDP and inline power. R1 and SRV1 are preconfigured. The guide checks received phone policy, real DHCP leases, voice/data MAC learning, PC passthrough and phone gateway reachability. This is a network provisioning exercise; telephone registration and calls are outside its scope.

**PoE Interface** under Switching restores power to an AP and a phone on a switch with a 40 W budget. Configure inline power, per-port limits and priority, inspect the AP’s reduced power profile, and verify the phone’s network uplink and PC passthrough with real traffic. The guide checks live switch-to-device allocations and includes a completed reference.

**802.1Q Trunking** under Switching connects two switches with three PC pairs. Configure static trunks, disable DTP, match native VLAN 99 and limit the allowed list to VLANs 10, 20 and 99. The guide checks tagged and native-VLAN connectivity and remote MAC learning across the trunk; PC addressing and access ports are preconfigured.

**Switch Virtual Interface (SVI)** under Switching covers both Layer 2 management and multilayer inter-VLAN routing. Configure DSW1’s VLAN 10/20/99 gateways, enable IP routing, and address SW1’s management SVI and default gateway. The guide requires operational SVIs, connected routes, local management access and real routed traffic. VLANs, the trunk, access ports and PC settings are preconfigured.

**Layer 2 LACP EtherChannel** under Switching bundles two switch links using active/passive LACP. Configure compatible member trunks and Port-channel1, verify actual LACP partners and logical STP forwarding, and test both VLAN pairs during a member-link failure. Restore both members before finishing. VLANs, access ports and PC settings are preconfigured.

**Layer 3 LACP EtherChannel** under Switching uses two multilayer switches and two pre-addressed PC subnets. Convert the members to routed ports, put /30 transit addresses on Port-channel1, enable IP routing and configure static routes through the peer. The guide checks real LACP negotiation, connected and static routes with the correct next hops, routed traffic in both directions, and a single-member failover exercise.

**CDP and LLDP** under Switching enables global and per-interface discovery on a router and two switches, suppresses advertisements on PC-facing ports, and verifies received neighbor identities and ports. Explore directional LLDP aging while the preconfigured PC data path continues to work, then restore discovery and save the configurations.

**Layer 2/Layer 3 CLI Troubleshooting** under Switching starts with six faults across access VLANs, trunk allowed lists, SVI state, IP routing, a forward next hop and a return route. Diagnose through IOS show commands, repair the existing configuration, verify dynamic MAC learning, and test both inter-VLAN directions and both PC-to-server paths.

**Rapid PVST+** under Switching builds a redundant three-switch triangle with different preferred roots for VLANs 10 and 20. Configure RSTP, complementary primary/secondary priorities and PC-only PortFast, inspect actual per-VLAN root/alternate roles, and test both forwarding trees during uplink failure and recovery.

**STP Root Bridge Selection** under Switching begins with equal priorities and an unintended root elected by the lowest bridge MAC. Compare bridge IDs, make SW1 primary and SW2 secondary for VLAN 10, verify actual root/port roles and dynamic MAC learning, then explore ties, secondary takeover and the difference between root selection and path cost.

**PortFast and BPDU Guard** under Switching protects two access ports and uses a staged rogue switch to trigger a real received-BPDU err-disable. Inspect the reason and logs, verify legitimate traffic continues while the rogue client is isolated, remove the cause and manually recover the protected port. The guide remembers the observed incident after recovery and saved reload; a completed reference exercises the same sequence.

**Root Guard** under Switching protects a downstream switch trunk while allowing normal inferior BPDUs. Advertise a superior root only in VLAN 10, verify root-inconsistent blocking and failed traffic there while VLAN 20 still forwards, then restore the downstream priority for automatic recovery. The guide retains the observed incident and includes a completed reference with real packet checks.

**Loop Guard** under Switching protects a root port and an alternate port in a redundant triangle. Use the cable editor’s directional loss controls to interrupt BPDU reception after normal convergence. Verify loop-inconsistent blocking, live traffic over the surviving path and automatic recovery when reception returns. Both observed incidents persist through saved reload; a completed reference exercises the real fault and repair sequence.

**IPv4 Static Routing** under Routing uses three routers, two PCs and a server to practice network, host, default and floating static routes. Check installed prefixes, next hops, exit interfaces and administrative distances, prove host-route preference over a default, and test primary-link failover with a backup in each direction. All addressing is ready; the guide includes return-path troubleshooting and a completed reference.

**IPv6 Static Routing** under Routing starts with IPv6 forwarding disabled and manual global/link-local addressing ready. Enable forwarding on all routers, configure /64 network, /128 host, ::/0 default and floating routes, and use interface-scoped link-local next hops. Verify real Neighbor Discovery, return paths and primary-link failover through R2; the guide includes a completed reference and an unscoped next-hop rejection exercise.

**Default Route** under Routing focuses on dual-stack branch forwarding through one upstream router. Configure IPv4 and interface-scoped IPv6 defaults, install explicit upstream return routes, and verify two remote networks in both families. Troubleshoot removed defaults, missing return routes and uplink failure while connected gateway access continues; the guide has ten tasks and a completed reference.

**Host Route** under Routing uses IPv4 /32 and IPv6 /128 routes to send one server directly to R3 while its neighbor on the same subnet follows a broader network route through R2. Compare AD 200 host entries with AD 1 network entries, verify actual paths, remove host routes to observe fallback, and troubleshoot return routing. The guide includes ten tasks and a completed reference.

**Floating Static Route** under Routing focuses on matching-prefix IPv4 and IPv6 backups in both directions. Configure AD 1 primaries and AD 10 floating routes, compare configured and installed entries, fail the direct link, verify real traffic through R2, and restore the preferred path. The eight-task guide includes return-backup troubleshooting, the limits of untracked static routes, and a completed reference.

**Single-Area OSPFv2** under Routing builds Area 0 across three IPv4 routers. Configure unique router IDs, wildcard-based interface selection, passive LANs, point-to-point transits and explicit costs. Verify all intended Full adjacencies, intra-area routes and real traffic, then fail the lower-cost direct link and observe LSA/SPF recovery through R2. The ten-task guide includes troubleshooting and a completed reference.

**Single-Area OSPFv3** under Routing builds IPv6 Area 0 across three routers. Enable IPv6 forwarding, configure interface-based participation and 32-bit router IDs, keep LANs passive, and set point-to-point transit costs. Verify Full link-local neighbors, intra-area IPv6 routes, four real traffic checks and metric-6 direct versus metric-21 alternate forwarding. Includes a twelve-row IPv6/link-local address plan, classic IOS command reference, troubleshooting exercises, a completed reference and a shareable `#/labs/single-area-ospfv3` link.

**OSPF Point-to-Point** under Routing is a focused two-router IPv4 lab. Configure interface-based OSPFv2, passive LANs and an Ethernet point-to-point transit; verify FULL/- neighbors, no DR/BDR election and AD 110/metric 11 routes. Test real traffic, adjacency loss/recovery, and an optional priority-zero broadcast comparison. Includes eight tasks, six address-plan rows, a completed reference and `#/labs/ospf-point-to-point`.

**OSPF DR/BDR Election** under Routing uses four routers on shared Ethernet, including two priority-zero DROTHERs with client LANs. Verify priority-based DR/BDR roles, normal 2WAY/DROTHER peers, Full database exchanges, learned routes and actual traffic. Test non-preemption, BDR promotion and a fresh router-ID tie break. Includes ten tasks, an eight-row plan, a completed reference and `#/labs/ospf-dr-bdr-election`.

**OSPF Router ID** under Routing compares a manual ID, the highest active loopback, and the highest up/up physical address across three routers. Distinguish configured and active IDs, confirm a process restart for pending changes, test duplicate-ID failure and restore routed traffic. The ten-task guide includes a twelve-row selection/address plan, completed reference and `#/labs/ospf-router-id`.

**Local User Authentication** under Services & Security secures an IOS router with local admin/operator accounts, an enable secret, console login and SSH-only VTY access. Its nine tasks require actual privilege-checked SSH logins from PC1 and a real ping, alongside live configuration checks. Includes a completed reference and `#/labs/local-user-authentication`.

**TACACS+ AAA Client** under Services & Security configures named authentication, EXEC authorization and EXEC accounting lists against a prepared server. Its ten tasks require remote approval and acknowledged Start/Stop records from a PC SSH session, with guided rejection, server-unavailable fallback and console recovery exercises. Includes a completed reference and `#/labs/tacacs-aaa-client`.

**RADIUS AAA Client** under Services & Security uses UDP 1812 authentication with EXEC attributes and UDP 1813 session accounting. Its ten tasks configure named client lists and SSH, verify acknowledged Start/Stop records, and exercise rejection, local recovery and retry behavior against a prepared server. Includes a completed reference and `#/labs/radius-aaa-client`.

Finishing every task in a guide celebrates the completed lab with a short confetti burst and a completion message. Each saved lab attempt celebrates once, including when its last task finishes with the guide closed. Reopening or repairing that attempt does not replay the effect; starting a fresh catalog lab creates a new attempt. Reduced-motion preferences keep the completion message and skip the animation.

1. Use **New** for an empty workspace, **Import lab** for a file, or **My labs** to open a browser-saved lab. Add devices from the palette. New clears an unchanged saved lab immediately; unsaved work offers **Save**, **Don't save**, or **Cancel**. Save updates the existing lab, or asks for a name on its first save, before clearing the workspace.
2. Choose **Connect devices**, then select two devices and their physical ports. Use **Add another** to connect several port pairs in one step.
3. Double-click a router or switch to open its console. Router interfaces begin administratively down; configure addressing and use `no shutdown`.
4. Double-click a computer or server to open its desktop. Set IPv4/IPv6 addressing, request DHCP/SLAAC, open the command prompt, or use its simulated web browser. Server Services provides DNS, DHCP, HTTP, AAA, NTP, syslog and FTP controls, including a live DHCP lease lookup.
5. Use `ping`, `traceroute`, and `show` commands in a device console to check connectivity and inspect network state.
6. Save device startup configurations with `write memory`. Exporting a lab preserves both running and startup configuration, but a later simulated power cycle loads the device's startup configuration. Unsaved network devices boot with factory defaults.

For wireless practice, place a WLC, PoE switch, AP and wireless laptop in the workspace, or open your own YAML file with **Import lab**. Double-click a WLC or AP for configuration, or place a wireless laptop to configure its adapter. **Packets** shows real simulated protocol events and pause/step controls. See the [wireless guide](docs/features/wireless-nodes.md) and [supported wireless subset](docs/compatibility/cisco-wireless.md).

The **PoE switch** provides Layer 2 switching and simulated AP power. Double-click it for the total budget, per-port Auto/Never controls, limits and actual allocations. See the [PoE guide](docs/features/poe-switch.md). Layer 2, Layer 3 and PoE switches use distinct rectangular diagram icons.

The **Datacenter Switch** is the fictional NS-DC24-6Q with a separate **NS-OS** personality: 24 × 10-Gbps and 6 × 40-Gbps `Ethernet1/1`–`Ethernet1/30` data ports, plus isolated `mgmt0`. Data ports start shutdown in access VLAN 1. Its NX-OS-style CLI uses named login roles, explicit feature gates and vPC—not IOS `enable`, DTP or PAgP. Save it with `copy running-config startup-config`. Open its built-in vPC example from **Lab catalog → Other**. See the [Datacenter Switch guide and supported boundaries](docs/features/datacenter.md).

The **VoIP phone** has a PoE-powered **Network** uplink and an untagged **PC** passthrough port. It learns the voice VLAN through received CDP or LLDP-MED policy, obtains its own DHCP lease, and bridges PC data without changing its MAC address or IP TTL. Double-click it for live power, VLAN, IP and port status. See the [phone guide](docs/features/voip-phone.md).

PC, laptop and server desktops also provide **Network tools** for typed DNS, SNMP and RESTCONF requests through the actual simulated network. PCs and laptops offer Windows, Ubuntu or macOS networking profiles through **Client profile**. Network tools also provides bounded offline YAML/JSON automation over simulated SSH. Physical copper negotiation, real egress queues, IPv6 BGP and PoE priorities affect traffic. See the [management services guide](docs/features/management-services.md).

The Windows **Command prompt** supports interactive SSH to configured network nodes: `ssh admin@192.0.2.1` or `ssh -l admin -p 22 switch.lab`. IPv4/IPv6 selection, password retries, remote IOS help/completion and returning to CMD with `exit` are supported. See the [Windows SSH client guide](docs/features/windows-ssh.md).

**DHCP fallback:** supported Windows and macOS hosts self-assign an IPv4 link-local address when a lease is unavailable, check for conflicts with real ARP packets, and keep trying DHCP. Linux and infrastructure profiles do not gain implicit APIPA. See the [DHCP fallback guide](docs/features/apipa.md).

When **DHCP and DNS are enabled on the same Server**, acknowledged leases automatically publish A records in **Services → DNS → DHCP A records**. A DHCP pool's optional **DNS domain** also publishes the qualified hostname. Renewals maintain the records; release and expiry remove them. Manual A and CNAME records take precedence. See the [DHCP DNS guide](docs/features/dhcp-dns.md).

**STP treats EtherChannels as one logical Port-channel**: logical cost, priority and guards govern every active member, and console views and cable indicators reflect that shared state. See the [STP and EtherChannel guide](docs/features/stp-etherchannel.md).

The **console width follows its visible space**, including SSH/Telnet sessions. Explicit `terminal width` settings remain effective; `terminal width 0` preserves long rows with horizontal scrolling. See the [console width guide](docs/features/console-width.md).

**IP SLA and floating static routes** support upstream-failure detection, delayed tracking and primary-path recovery. SLA `state` and `reachability` have different threshold semantics; `show track` identifies the latest return code, RTT and dependent clients. Use an explicit `life forever start-time now` for continuous monitoring, and keep the probe routed through the intended primary path. See the [configuration and supported boundaries](docs/protocol-design.md#ip-sla-and-floating-static-routing).

**Single-hub DMVPN Phase 2 and Phase 3** support GRE/mGRE, protected NHRP registration/resolution, dynamic neighbors and actual direct spoke-to-spoke forwarding. Phase 3 installs prefix-aware CEF shortcuts while retaining hub-next-hop routing. Import the included [Phase 2](examples/dmvpn/single-hub-phase2.netsim.yaml) or [Phase 3](examples/dmvpn/single-hub-phase3.netsim.yaml) three-spoke lab. See the [DMVPN guide](docs/features/dmvpn.md) for configuration, verification, failure exercises and modeled-IPsec boundaries.

## Working with the editor and console

- Drag devices, Shift-select or marquee-select a group, and use Space-drag or the middle mouse button to pan. Scroll to zoom around the pointer. Touch supports drag, pinch and long-press menus.
- Moving nodes snaps to nearby centers and equal spacing, with guides showing the alignment. Hold Alt while dragging for free placement. A selected group keeps its relative positions.
- Add a note with N, then click the canvas. Notes are compact labels edited in place: Enter saves, Shift-Enter adds a line, and Esc cancels. Double-click a note to edit it; right-click for edit, lock, copy, duplicate and delete actions.
- Ctrl/Cmd+A selects all; C/X/V copy/cut/paste; D duplicates; Z undoes; Shift-Z or Y redoes. Delete removes the selection. Arrow keys move selected items by 20 pixels; Shift-arrow moves 200 pixels. F2 renames a device. Enter opens the focused item.
- The console has tabs for devices with a console; phones use their dedicated status/settings window. Adding or deleting a device updates the tabs automatically. Click a tab to switch consoles; each device retains its draft, history and scroll position. The terminal has one scrolling surface with an inline prompt: click blank space to type or drag across output to copy it. On mobile and touch tablets, the console is either full screen or closed; use the close button to return to the diagram. Desktop retains resize and expand controls.
- Console `?` gives context help. Tab or Ctrl-I completes at the cursor. Up/Down recalls history. Ctrl-A/E moves to the start/end; Ctrl-U/K/W deletes before/after the cursor or the previous word. Pasted complete lines execute; a final line without a line break stays editable. Pages fit the visible console height and wrapped text, including after resizing. Space advances a page, Enter advances one row, and `q` stops paging. `terminal length 0` disables paging. Ctrl-C cancels input; Ctrl-Z returns to privileged mode. Ctrl-Shift-6 followed by X suspends a remote terminal; use `show sessions`, `resume` and `disconnect` to manage it. `terminal monitor` streams eligible logs while the simulation runs.
- IOS `reload` shows a timed bootstrap, image-loading and startup-configuration sequence. Interfaces stop forwarding during the 6.5 seconds of simulation time, and the console stays read-only. Press Enter at **Press RETURN to get started!**, then log in if configured. Scheduled reloads and the WLC reload button use the same boot lifecycle. Pausing the simulation pauses startup too.
- **Import lab** opens NetworkSim `.yaml`/`.yml` files and previous NetworkSim JSON exports, up to 10 MB. The file is validated before anything is replaced. In a new, empty workspace it opens immediately; otherwise a preview identifies the incoming lab and offers **Save a copy & import**, **Import without saving**, or **Cancel**. Saving creates a separate snapshot in **My labs**, without overwriting earlier saves; a failed save leaves the current lab open. **Export current lab first** requests a portable download without closing the confirmation, so you can verify it finished before proceeding. Import replaces rather than merges the workspace, restarts protocol sessions and can be undone during the current session. Invalid files and cancelled selections leave the current lab intact.
- **New**, **Save**, **Save as**, **Import lab** and **Export lab** are grouped in the toolbar. **New** clears a saved, unchanged lab immediately. If there are edits, it offers **Save**, **Don't save**, or **Cancel**; Save updates that same saved lab rather than creating a copy. A never-saved lab asks for a name before its first Save, even if it was imported or renamed. Cancelling either dialog or a failed save keeps the workspace open. Workspace autosave does not count as an explicit Save, and edits remain detectable after refresh. **Save as** asks for a distinct name, creates a separate browser snapshot and makes that copy current, without resetting devices or overwriting the source. Undoing or redoing edits in that copy keeps subsequent saves on the copy. **Export lab** downloads a portable file; it is separate from browser saving.
- **My labs** lists browser-saved snapshots for opening, renaming, downloading or deleting. New/save/import actions live in the toolbar, not this dialog. Opening a saved lab uses the same replacement protection. The active workspace saves automatically each second and before reload, independently of these snapshots. Refresh restores the workspace; simulated protocol sessions rebuild. Browser copies stay in the same browser and may be cleared with browsing data; use exported files for portable backups.
- Parallel cables use separate curved paths with interface badges near each endpoint. Click a cable or badge to highlight both ends and inspect the connection; the arrows step through parallel links. **Connections** lists existing cables between the devices and lets you add more port pairs. Badges adjust around nearby devices, notes and labels as you move the topology.
- Link settings include delay, packet loss and separate A→B/B→A loss for asymmetric-failure experiments. Power controls affect individual devices or the whole lab.

## Scope and accuracy

This is an educational simulation, not Cisco IOS firmware. Traffic is represented as structured Ethernet/IP/transport records. Many routing and switching control-plane decisions are computed models; selected protocols and all modeled user traffic traverse interfaces and links. It does not run real sockets or contact devices on your actual network.

Console output follows Cisco IOS layouts and wording, including `?` help rows, error messages and `show` command tables, but devices identify as fictional **NetSim** platforms rather than Cisco appliances. `show version` and `show inventory` share distinct router, Layer 2, PoE, multilayer, WLC and AP models, stable per-device serials and hardware revisions. Software versions come from the application version; uptime, reload reason, interface counts and flash capacity use simulation state. RAM and NVRAM are explicitly simulated profile capacities, not measurements of your computer. See the [platform models and output fields](docs/ios-output-reference.md#netsim-platform-identities). Byte-identical output for a Cisco image is not guaranteed.

An implemented command family is not a promise that every IOS command or protocol edge case is supported. Unsupported commands report an error. SSH, IKE and IPsec use simulated authentication and compatibility checks; they do not provide real cryptographic protection. Use invented lab credentials because project exports contain configuration values.

Coverage and remaining differences are recorded in:

- [Current all-node fidelity audit and validation checkpoint](docs/audits/final-validation-report.md)
- [Machine-readable command discovery and strict coverage status](docs/audits/cli-command-coverage.md)
- [Versioned CCNA/ENCOR/ENARSI objective matrix](docs/audits/exam-objective-coverage.md)
- [Known limitations and unfinished work](docs/audits/known-limitations.md)
- [Reference feature acceptance inventory](docs/reference-feature-inventory.md)
- [Interface and local workflow coverage](docs/ui-coverage.md)
- [Packet engine coverage and limits](docs/engine-coverage.md)
- [Routing/switching protocol models](docs/protocol-design.md)
- [CLI and management coverage](docs/cli-coverage.md)
- [Executable command comparison](docs/command-parity-audit.md)
- [IOS output references](docs/ios-output-reference.md)
- [CML capture, replay and comparison workflow](docs/cml-conformance.md)
- [20-command CML operational audit and platform matrix](docs/audits/cml-operational-fidelity.md)
- [CML fidelity follow-up and all 90 dispositions](docs/audits/cml-fidelity-followup.md)
- [NX-OS CLI, passive-interface, MTU and VRF validation](docs/audits/cml-nxos-cli.md)
- [CLI interaction and switching audit](docs/ios-cli-interaction-audit.md)
- [System command and service audit](docs/ios-system-command-audit.md)
- [REA research and reconstruction evidence](docs/rea-research.md)
- [Reference engine defects and independent reproductions](docs/reference-engine-audit.md)
- [Validation record](docs/validation.md)
- [Wireless architecture](docs/architecture/wireless-engine.md)
- [Wireless tests and benchmarks](docs/testing/wireless-test-results.md)
- [Wireless reference evidence](docs/research/wireless-reference-analysis.md)

Full sandbox parity and full Cisco IOS equivalence must not be inferred from the feature names or selected regression tests. The coverage documents identify the verified subset and remaining differences.

## Develop and validate

Node 24.15 or newer is needed only to build or test the source. This workspace uses Node 24.22.0 through `.nvmrc`.

```sh
nvm use
npm ci
npm run check
```

`npm run check` type-checks TypeScript, runs independent packet/CLI/persistence tests, and creates `index.html` plus `dist/index.html`. The build checks that the result has a single inline classic script, no external script/style dependency and no bundled reference code. The Content Security Policy blocks network connections.

For temporary development preview only:

```sh
npm run preview
```

Open `http://127.0.0.1:4173`, then stop the preview with Ctrl-C. This serves the exact built HTML and is not a simulator backend.

## Provenance

The source, styles, icons and tests in this project are newly written. All ten device icons use one ImageGen artwork family matched to the user's thin gray hardware reference. Packet Tracer was inspected with REA and its bundled help was consulted. The supplied sandbox was inventoried as a reference; none of its source, assets or command catalogs are bundled. Native Packet Tracer observation verified the wireless palette; joins, authentication and roaming were not verified in its live workspace. No full equivalence claim is made. Cisco and Packet Tracer are Cisco trademarks; this project is independent and is not a Cisco product.
