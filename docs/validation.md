# Validation record

## Automated checkpoints

- The integrated `npm run check` on October 16, 2026 passed TypeScript and **299 independent tests**, then built both offline HTML copies. The log is `.cache/final-check.log`. The test count is not a full-parity claim.
- Independent tests cover returned traffic and failure paths, not only configuration storage. Examples include missing return routes, VLAN isolation, MTU/DF behavior, duplicate IPv6 addresses, packet loss, failed authentication, protocol mismatch, gateway takeover and reboot invalidation.
- The build compiles Tailwind locally, bundles to one classic IIFE, verifies the escaped JavaScript parses, checks single script delimiters and rejects reference/research imports. The output includes `connect-src 'none'` and no external scripts/styles.
- The current lockfile dependency audit reports zero vulnerabilities. There are no runtime package dependencies in the delivered HTML.

## Browser checks

The exact built `dist/index.html` was tested in the Codex in-app browser using the user-authorized temporary `127.0.0.1` preview. The delivery copy is the same single HTML file. The browser automation environment rejects `file://` URLs, so direct-from-disk execution has not been observed through that browser; it was not bypassed. Packaging checks establish that the app has no runtime server or fetched-module dependency.

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
