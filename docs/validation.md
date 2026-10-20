# Validation record

## NetSim version and inventory identities (2026-10-20)

The integrated `npm run check` passed TypeScript checking, **1,072 tests** and the standalone build. The preceding focused run passed **113 tests** across platform identity, system/configuration/interface output, boot, discovery, SNMP and CLI behavior. Eleven dedicated identity regressions cover all six network platforms, consistent software/model/serial/revision fields, actual port/radio counts and flash capacity, shared memory totals, read-only output, help/invalid arguments, 1,000 distinct device IDs, rename/reload/import stability, cached received discovery data and legacy/new configuration-header replay.

The rebuilt HTML passed **ten identity checks and eight existing IOS-console checks in each of Chrome and Edge**, directly through `file://` with networking disabled, zero runtime exceptions and zero external requests. The identity checks used the public YAML import, device dialogs and real console keyboard events. All six network kinds reported their correct distinct NetSim model, including an AP powered through the imported PoE switch. Received CDP/LLDP advertised the full remote model/software, contextual help and completion remained usable, and a real timed reload retained the saved hostname and serial while loading the same embedded image reported by `show version`.

The delivery and `dist/index.html` copies have identical SHA-256 hashes:

```text
bc7164966ae927e3554692aebbb06d421d71b95f10c7d909387fa175b8a76c4e
```

This checkpoint supersedes the earlier IOSv/IOSvL2 identity policy, not the IOS-style command syntax/layout goal. NetSim RAM/NVRAM are fictional virtual-platform capacities; CPU and memory-usage figures remain representative, not host-resource measurements. Inventory lists only the modeled fixed chassis, serials are not manufacturer-registered identifiers, and embedded profiles do not execute Cisco firmware or stored boot-image selections. The corrected field meanings, six models and primary Cisco documentation are recorded in the [platform identity policy](ios-output-reference.md#netsim-platform-identities).

## IP SLA and floating-static-route edge cases (2026-10-20)

The integrated `npm run check` passed TypeScript checking, **1,061 tests** and the offline build. The final import-validation, responder-port and SLA-help refinements then passed TypeScript checking and **90 focused tests** across SLA/failover, management, persistence/YAML, IOS platform compatibility and help, followed by another offline build. Seventeen dedicated SLA/failover regressions cover independent timer/lifetime ownership, pending cancellation and restart, deletion and stale replies, operation editing, scheduling defaults and delayed starts, source validation, IPv6, reload without an open console, state versus reachability, recursive dependency withdrawal and cycles, explicit egress, AD 255, OSPF competition, delivered backup traffic, blackholes and debounced recovery. Malformed running/startup/imported SLA records reject transactionally; legacy forever schedules and tracks without an explicit aspect remain supported.

The final delivered HTML passed **eight SLA checks and eight existing IOS-console checks in each of Chrome and Edge**, directly through `file://` with networking disabled, zero runtime exceptions and zero external requests. The SLA checks imported a four-router lab through the public file control and used real console keyboard events. An upstream ACL blackhole left the edge carrier Up while SLA timed out; after the configured track delay the AD 200 default delivered traffic. Removing the blackhole recovered the AD 1 primary. Checks also exercised OverThreshold state/reachability differences, operation prompts, `?` help and Tab completion, delayed start and finite expiry, unrelated EEM changes, unavailable sources, scheduled-edit rejection and deletion with the configured track delay. Browser assertions wait for the observed configured transition rather than assuming a fixed ping command advances enough simulation time.

The delivery and `dist/index.html` copies have identical SHA-256 hashes:

```text
9d813d186d7696c166aca3cd219e89ae4ee40bd09e566d71b8e92d7995de56a4
```

These fixes follow Cisco documentation, not live IOS-image certification. Source-interface selection does not pin egress, and an appropriate primary-only monitoring route is still required to avoid false recovery through a backup. Absolute/random/recurring/reaction scheduling, ageout, the full probe catalog and synchronized one-way jitter/MOS remain outside the supported subset. See the [configuration and boundaries](protocol-design.md#ip-sla-and-floating-static-routing).

## New lab save-state correction (2026-10-20)

TypeScript checking and **27 focused persistence/YAML tests** passed. New regressions distinguish an explicit named save from workspace recovery; verify first-save identity, in-place updates, meaningful topology/configuration/startup/note edits, undoing to saved content, ignored runtime/view changes, generated DHCP/SLAAC addressing, actual DHCP acquisition and renewal, save/load recovery, independent Save as identities, duplicate names and failed writes. The offline build produces matching `index.html` and `dist/index.html` copies.

The built app passed **13 workflow checks in each of Chrome and Edge**, opened through `file://` with networking disabled, zero runtime errors and zero external requests. Clean saved labs cleared without a prompt or another snapshot. Edited saved labs offered Save/Don't save/Cancel and updated the existing record before clearing. Never-saved work requested a name; cancelling naming, duplicate names and blocked writes preserved the active lab. Checks also covered clean/edited reload recovery, undoing back to saved content, first Save on imported/custom-named work, Save as identity safety, unavailable saved-lab storage, unchanged Import protection, and 320/390-pixel dialogs. The existing eight-check offline IOS/console smoke also passed in both browsers.

Save status is compared with the explicitly saved browser snapshot, not an autosave-reset dirty flag. Canvas navigation and runtime state do not count as edits; browser saves remain separate from portable exports. This corrects the earlier New flow recorded below, which offered a backup copy instead of updating the saved lab.

## Lab toolbar and replacement checkpoint (2026-10-20)

TypeScript checking, the offline build and **20 persistence/YAML tests** passed after adding the grouped New, Save, Save as, Import and Export controls. Tests cover independent backup identities, distinct Save as names, updating only the selected saved copy, failed writes, file-size limits, unreadable files, YAML/JSON validation, and preservation of the active document.

The built `index.html` was exercised directly through `file://`, with networking disabled, in Chrome and Edge. Both browsers passed **14 workflow checks**, with zero runtime exceptions and zero external requests. Observed workflows include the actual native file chooser, fresh-workspace imports, save/cancel/discard replacement, export-first confirmation, storage-failure recovery, undo/redo, repeated file selection, malformed/unreadable/oversized files, cancelled slow reads, JSON import, immediate reload recovery, notes-only and renamed-empty labs, escaped imported text, and 320/390-pixel layouts. The toolbar's Save as flow preserved console drafts, edit history and earlier snapshots; Undo/Redo followed by Save stayed on the copy rather than overwriting its source. New offered save/cancel/discard, blocked clearing on a failed backup, and was undoable. My labs no longer duplicates the toolbar's new/save/import actions.

Browser-local saving remains distinct from portable export. A download request is not evidence that a user completed the browser's save dialog; the export-first flow deliberately waits for an explicit replacement decision. Browser snapshots can be cleared with browsing data, and imported protocol sessions rebuild rather than restoring live runtime memory.

## IOS output checkpoint (2026-10-20)

The integrated `npm run check` passed TypeScript checking and **1,033 tests**, with no failures, then rebuilt both offline HTML copies. A final targeted run also passed 53 help, syntax, completion, terminal and terminal-width regressions after making `show line` help follow the configured VTY range.

The final `index.html` was opened directly through `file://` in Chrome 155.0.8059.84 and Edge 155.0.4283.62 with networking disabled. Both browsers passed eight checks, with zero runtime errors and zero external requests. These checks used the public file-import control and real keyboard events to exercise IOSv/IOSvL2 identity, contextual `?` help, IPv6 source help, Tab completion, CLI mode transitions, delivered ping/traceroute probes, OSPF output, VLANs and EtherChannel output.

The delivery and `dist/index.html` copies have identical SHA-256 hashes:

```text
f006460233150aa0941ddaefbc2cdf84e9ccebc7b155dd5faeec5ff18c493f3b
```

The six `ios-fidelity-*.test.ts` suites and existing regressions cover the revised configuration, help, interface/L3, routing, switching and system/probe output. This is not a live-image comparison of every IOS command or option. See [output boundaries](ios-output-reference.md#deliberate-boundaries-and-remaining-display-scope) for derived protocol fields, representative hardware values, unsupported dialogs and other remaining differences.

## Automated checkpoints

- The integrated `npm run check` on October 16, 2026 passed TypeScript and **299 independent tests**, then built both offline HTML copies. The log is `.cache/final-check.log`. The test count is not a full-parity claim.
- Independent tests cover returned traffic and failure paths, not only configuration storage. Examples include missing return routes, VLAN isolation, MTU/DF behavior, duplicate IPv6 addresses, packet loss, failed authentication, protocol mismatch, gateway takeover and reboot invalidation.
- The build compiles Tailwind locally, bundles to one classic IIFE, verifies the escaped JavaScript parses, checks single script delimiters and rejects reference/research imports. The output includes `connect-src 'none'` and no external scripts/styles.
- The current lockfile dependency audit reports zero vulnerabilities. There are no runtime package dependencies in the delivered HTML.

## Browser checks (earlier environment)

The earlier built `dist/index.html` was tested in the Codex in-app browser using the user-authorized temporary `127.0.0.1` preview. The delivery copy was the same single HTML file. That browser automation environment rejected `file://` URLs, so direct-from-disk execution was not observed through it; the restriction was not bypassed. The newer direct-file Chrome/Edge evidence is recorded above. Packaging checks establish that the app has no runtime server or fetched-module dependency.

Observed in the browser:

- Empty workspace, original device palette and sample loading.
- First-packets host ping: four replies, real ARP/MAC/ICMP events.
- Routed OSPF campus ping: four replies with TTL 62; guide reaches 3/3.
- Paused test creation, one-event stepping, resumed probe with 1/1 replies.
- Clear event view retains simulation time and completed traffic objective.
- Desktop opening, service forms, DNS/HTTP response and actual page content.
- Created a linked HTML page and CSS file through Services. Host browser loaded the stylesheet with the observed computed color, followed the page link and navigated Back; all requests used simulated transport.
- Browser-local save/reload/open, saved-lab rename, share-code generation/import and independent copy.
- Downloaded `.netsim.json`, reopened it through the file picker, retained topology and service content.
- IOS console paged `show running-config` at five lines; Space advanced output and `q` returned to the prompt. Tab completed `show ip int` to `show ip interface `.
- Narrow 390×844 layout: compact palette, reachable horizontal toolbars, fit-to-view topology and readable packet details with Back to events. Temporary viewport reset afterward.

Additional observed checks:

- The unified terminal has one command input, immediately after output. Blank-space clicks focus it, per-device drafts survive tab switches, Up/Down restores an unfinished draft, Ctrl-A/E/U/W edits the line, and multiline paste leaves an unterminated final line editable. Scrollback restores across sessions; the latest-prompt button returns to the bottom. Expand, restore and close were exercised.
- Notes render as compact white labels, with inline editing and context-menu actions. Enter saves, Shift-Enter creates a second line, Esc preserves the original text, Undo restores the previous note, and locking prevents dragging. The final build's right-click menu exposes edit, lock, copy, duplicate and delete.
- Dragging a node displays center guides and snaps to alignment. A third node snaps to equal edge spacing, with spacing guides visible. Holding Alt permits a small unaligned move with no guides.
- Ordinary wheel scrolling changed the displayed zoom from 100% to 55%; scrolling back restored 100%. Two selected routers moved together and retained their 220-pixel horizontal separation and common vertical position.
- The final console was checked at 390×844: one command input, readable output, reachable close/expand controls, and no document horizontal overflow. The expanded dock ended at pixel 820 above the 844-pixel viewport boundary. Temporary device emulation was cleared afterward.
- The IPv6 guide reached 1/1 after an actual reply; its completion report was available to copy or download.
- Server AAA form preserved an invented RADIUS user and privilege after closing and reopening.
- The unsaved configuration warning offered save/discard; Save and power off preserved the router hostname through a subsequent power-on.
- Double-clicking a cable opened its editable link settings after preserving SVG element identity through selection changes.
- Space activated a native toolbar button. Keyboard console resizing changed its height while the selected device position remained unchanged.
- The BGP guide reached 3/3. `show ip bgp` displayed the learned `65002 65003` AS path. An extended ping from an unadvertised transit source returned 0/2, while explicitly selecting the advertised LAN source returned 2/2.
- Packet tracing retained the request and related reply, with actual MAC addresses, TTL, DSCP and ICMP type/code/sequence grouped in the inspector.
- Changed an IPv6 computer from SLAAC to Manual, assigned a new address and received four echo replies. The independent lease regression also advances beyond old renewal/expiry deadlines and checks that manual values survive.
- Enabled `terminal monitor`, scheduled a lab syslog event through EEM, and observed the message while the unsubmitted `show logging` draft remained intact.
- Created a local HTTP user through Services. The host browser received a 401 challenge without credentials and loaded the server page after the invented lab login. Protected requests traverse modeled TCP.

Bugs found and fixed during browser checks: inline-script replacement corruption, node double-click pointer-capture handling, cable child replacement during selection, hidden console panel overriding packet view, narrow-screen toolbar overflow, inaccessible mobile packet details, native Space activation/console-resize keyboard interference, and missing AS-path attributes in the BGP table.

## Boundaries

Browser observations do not prove every CLI command or UI gesture works in every browser. Native Packet Tracer accessibility observation timed out, so tests are based on the independent implementation and public protocol semantics rather than live Packet Tracer differential tests. No copied reference tests or command catalogs are part of the deliverable. See the coverage documents for remaining protocol/model gaps.

## Additional checkpoint

A subsequent integrated run passed **123 tests**, including all six examples, modeled GRE protection, DHCPv4/v6 lease lifecycles, NAT expiry, protocol authentication and sharing validation at that snapshot. A bounded 100-device smoke lab delivered 10/10 echo replies through a 20-router shared LAN and serialized to about 84 KB; its build plus 50 seconds of simulated traffic completed in roughly 264 ms on this machine. This is a smoke check, not a performance guarantee for every 100-device protocol topology.
