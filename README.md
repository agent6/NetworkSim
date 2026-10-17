# NetworkSim

An original network learning simulator for CCNA and CCNP Enterprise practice, with a Tailwind interface, Cisco-style command line, routers, Layer 2/Layer 3 switches, computers, servers, WLCs, access points, wireless laptops and VoIP phones. It runs entirely inside a browser.

## Open the app

Double-click **index.html** in this folder and open it in a current browser. The file contains the program, compiled Tailwind CSS and embedded device artwork and SVG toolbar icons. It needs no server, internet connection, Packet Tracer installation, account or package manager to run. Keep a copy of this one file anywhere you want to use it.

The source build targets Safari 17+, Chrome 120+ and Firefox 121+. The current lab saves automatically in this browser and reopens after refresh, including topology, configurations, notes and canvas position. Browser saves and clipboard access depend on browser permissions, especially for files opened from disk. **Export lab** downloads a portable `.netsim.yaml` backup.

## Start a lab

1. Add devices from the palette, or choose **My labs** to open a saved lab or start a new empty lab.
2. Choose **Connect devices**, then select two devices and their physical ports. Use **Add another** to connect several port pairs in one step.
3. Double-click a router or switch to open its console. Router interfaces begin administratively down; configure addressing and use `no shutdown`.
4. Double-click a computer or server to open its desktop. Set IPv4/IPv6 addressing, request DHCP/SLAAC, open the command prompt, or use its simulated web browser. Server Services provides DNS, DHCP, HTTP, AAA, NTP, syslog and FTP controls, including a live DHCP lease lookup.
5. Use `ping`, `traceroute`, and `show` commands in a device console to check connectivity and inspect network state.
6. Save device startup configurations with `write memory`. Exporting a lab preserves both running and startup configuration, but a later simulated power cycle loads the device's startup configuration. Unsaved network devices boot with factory defaults.

For wireless practice, place a WLC, PoE switch, AP and wireless laptop in the workspace, or open your own YAML lab from **My labs**. Double-click a WLC or AP for configuration, or place a wireless laptop to configure its adapter. **Packets** shows real simulated protocol events and pause/step controls. See the [wireless guide](docs/features/wireless-nodes.md) and [supported wireless subset](docs/compatibility/cisco-wireless.md).

The **PoE switch** provides Layer 2 switching and simulated AP power. Double-click it for the total budget, per-port Auto/Never controls, limits and actual allocations. See the [PoE guide](docs/features/poe-switch.md). Layer 2, Layer 3 and PoE switches use distinct rectangular diagram icons.

The **VoIP phone** has a PoE-powered **Network** uplink and an untagged **PC** passthrough port. It learns the voice VLAN through received CDP or LLDP-MED policy, obtains its own DHCP lease, and bridges PC data without changing its MAC address or IP TTL. Double-click it for live power, VLAN, IP and port status. See the [phone guide](docs/features/voip-phone.md).

PC, laptop and server desktops also provide **Network tools** for typed DNS, SNMP and RESTCONF requests through the actual simulated network. PCs and laptops offer Windows, Ubuntu or macOS networking profiles through **Client profile**. Network tools also provides bounded offline YAML/JSON automation over simulated SSH. Physical copper negotiation, real egress queues, IPv6 BGP and PoE priorities affect traffic. See the [management services guide](docs/features/management-services.md).

The Windows **Command prompt** supports interactive SSH to configured network nodes: `ssh admin@192.0.2.1` or `ssh -l admin -p 22 switch.lab`. IPv4/IPv6 selection, password retries, remote IOS help/completion and returning to CMD with `exit` are supported. See the [Windows SSH client guide](docs/features/windows-ssh.md).

When **DHCP and DNS are enabled on the same Server**, acknowledged leases automatically publish A records in **Services → DNS → DHCP A records**. A DHCP pool's optional **DNS domain** also publishes the qualified hostname. Renewals maintain the records; release and expiry remove them. Manual A and CNAME records take precedence. See the [DHCP DNS guide](docs/features/dhcp-dns.md).

**STP treats EtherChannels as one logical Port-channel**: logical cost, priority and guards govern every active member, and console views and cable indicators reflect that shared state. See the [STP and EtherChannel guide](docs/features/stp-etherchannel.md).

The **console width follows its visible space**, including SSH/Telnet sessions. Explicit `terminal width` settings remain effective; `terminal width 0` preserves long rows with horizontal scrolling. See the [console width guide](docs/features/console-width.md).

## Working with the editor and console

- Drag devices, Shift-select or marquee-select a group, and use Space-drag or the middle mouse button to pan. Scroll to zoom around the pointer. Touch supports drag, pinch and long-press menus.
- Moving nodes snaps to nearby centers and equal spacing, with guides showing the alignment. Hold Alt while dragging for free placement. A selected group keeps its relative positions.
- Add a note with N, then click the canvas. Notes are compact labels edited in place: Enter saves, Shift-Enter adds a line, and Esc cancels. Double-click a note to edit it; right-click for edit, lock, copy, duplicate and delete actions.
- Ctrl/Cmd+A selects all; C/X/V copy/cut/paste; D duplicates; Z undoes; Shift-Z or Y redoes. Delete removes the selection. Arrow keys move selected items by 20 pixels; Shift-arrow moves 200 pixels. F2 renames a device. Enter opens the focused item.
- The console has tabs for devices with a console; phones use their dedicated status/settings window. Adding or deleting a device updates the tabs automatically. Click a tab to switch consoles; each device retains its draft, history and scroll position. The terminal has one scrolling surface with an inline prompt: click blank space to type or drag across output to copy it. The panel can be resized, expanded or closed.
- Console `?` gives context help. Tab or Ctrl-I completes at the cursor. Up/Down recalls history. Ctrl-A/E moves to the start/end; Ctrl-U/K/W deletes before/after the cursor or the previous word. Pasted complete lines execute; a final line without a line break stays editable. Pages fit the visible console height and wrapped text, including after resizing. Space advances a page, Enter advances one row, and `q` stops paging. `terminal length 0` disables paging. Ctrl-C cancels input; Ctrl-Z returns to privileged mode. Ctrl-Shift-6 followed by X suspends a remote terminal; use `show sessions`, `resume` and `disconnect` to manage it. `terminal monitor` streams eligible logs while the simulation runs.
- IOS `reload` shows a timed bootstrap, image-loading and startup-configuration sequence. Interfaces stop forwarding during the 6.5 seconds of simulation time, and the console stays read-only. Press Enter at **Press RETURN to get started!**, then log in if configured. Scheduled reloads and the WLC reload button use the same boot lifecycle. Pausing the simulation pauses startup too.
- **My labs** saves, opens, renames and downloads named browser-local lab snapshots. The active workspace saves automatically each second and before reload, independently of these snapshots. Refresh restores the workspace; simulated protocol sessions rebuild. Portable files use YAML; choose **Open a YAML lab** for `.yaml` or `.yml` files.
- Parallel cables use separate curved paths with interface badges near each endpoint. Click a cable or badge to highlight both ends and inspect the connection; the arrows step through parallel links. **Connections** lists existing cables between the devices and lets you add more port pairs. Badges adjust around nearby devices, notes and labels as you move the topology.
- Link settings include delay, packet loss and separate A→B/B→A loss for asymmetric-failure experiments. Power controls affect individual devices or the whole lab.

## Scope and accuracy

This is an educational simulation, not Cisco IOS firmware. Traffic is represented as structured Ethernet/IP/transport records. Many routing and switching control-plane decisions are computed models; selected protocols and all modeled user traffic traverse interfaces and links. It does not run real sockets or contact devices on your actual network.

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
