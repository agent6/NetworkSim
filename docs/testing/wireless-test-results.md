# Wireless and PoE validation

The 2026-10-17 UTC follow-up adds WLC administration/monitoring, native AP authorization, wireless ACL/QoS, logical WPA3/transition/PMF, PoE stream-rate validation and a distinct generic standalone AP profile. The focused current set passes **99/99 tests**: wireless48, AP controller8, PoE14, administration16, WPA3 five and standalone AP eight. A later combined run with the dedicated Phone's 18 cases passes **117/117**; TypeScript also passes. The final parent combined run/build determines repository-wide status. Reproducible commands, source/runtime field mapping and actual limitations are in the [current WLC audit](../audits/wlc-gui-coverage.md). Current browser evidence records reference controls14, AP configuration8, administration/WPA3 seven, standalone AP seven, [broader wireless24](wireless-browser-results.json) and [radio coverage8](../audits/radio-browser-validation.json): **68 checks**, no page errors, all tied to HTML SHA256 `230e3d26868f8d1c868bb6f1d09ea4bf343c65ab09fd1ce1030d6ef72d852499`. The broader run now verifies all ten icons plus actual packet inspection/pause/step; the two legacy workflows ran sequentially. These are bounded simulator invariants, not Cisco runtime goldens. The dated runs below remain historical evidence for their recorded source.

Recorded 2026-10-16 on macOS ARM64, Node 24.22.0 and Chrome 155.0.8059.84.

## Executed checks

- `npm run check`: TypeScript passed; **517 tests passed, 0 failed**; offline build passed.
- Targeted `tests/wireless.test.ts` and `tests/poe.test.ts`: **37 tests passed**, including AP movement after the full run.
- Historical `scripts/browser-wireless.mjs --wireless-only`: **18 checks passed, no page errors**: palette placement, adapter configuration, absent AP manual-power controls, disconnected AP power state, RADIUS failure/correction, canvas drag/roam, laptop DNS/HTTP browsing, WLC GUI/CLI updates and PoE budget denial/restoration. That run omitted packet inspection/pause/step while their entry point was unavailable. The current full 24-check run linked above exercises those controls successfully; the shared result file now records that newer run.
- `scripts/benchmark-wireless.mjs`: three deterministic engine workloads, using 100 ms advances with the normal 10,000-event budget. See [raw benchmark results](wireless-benchmarks.json).

All nine images were checked in the actual palette/canvas. All use one embedded ImageGen atlas; switch symbols distinguish opposing arrows, routing arrows and PoE lightning. The controller label is WLC.

## Mandatory scenario mapping

| IDs | Executed evidence |
| --- | --- |
| WL-01/02 | Empty SSID stays idle; absent network retries without association or runaway timers |
| WL-03 | Matching AP joins and completes authorization before a link exists |
| WL-04/30 | Wrong WPA2 MIC fails; corrected key reconnects |
| WL-05 | Disabled radios remove associations |
| WL-06/07 | AP/client distance changes disconnect; return to coverage reconnects |
| WL-08/09/10 | Strongest eligible AP; hysteresis/residence; browser pointer drag changes the actual relationship |
| WL-11 | DHCP crosses air, CAPWAP or AP bridge, switch and existing server |
| WL-12/13 | Real ICMP, DNS, TCP/HTTP delivery; central and local paths tested |
| WL-14/28 | VLAN 20 routed example works; wrong VLAN loses addressing; routed ACL denies decapsulated traffic |
| WL-15/16 | Broken wired path blocks join; restored path delivers discovery/join/configuration |
| WL-17 | Central clients lose service after controller timeout; established Flex local traffic continues |
| WL-18/19 | Actual existing RADIUS service records Access-Accept/Reject decisions |
| WL-20/21 | CLI and controller GUI changes are reflected through shared configuration and operational output |
| WL-22 | Save/load omits associations and rebuilds service |
| WL-23 | Virtual time does not advance by itself; earlier browser checks exercised pause/step on the shared queue |
| WL-24 | Deleted AP removes its derived association |
| WL-25 | Unavailable DHCP leaves an authorized client without a lease |
| WL-26 | 802.11/EAPOL records, CAPWAP transport fields and related packet IDs; earlier browser checks exercised packet inspection |
| WL-27 | Physical path through two switches joins and delivers ICMP |
| WL-29 | Invalid syntax/ranges/platform commands reject without retaining changes |

Additional cases cover same-AP and inter-AP client traffic in both switching modes; Open authentication without EAPOL; duplicate MAC rejection; admission limits; tag-change rejoin; saved WLC startup versus factory reset; AP/client restart; IPv6 ND/ICMPv6; 500 rapid position updates without per-pixel timers; malformed wireless cable rejection; per-port power modes/maximums; total PoE budget; unplug/switch outage; PoE-only AP behavior, hidden AP power controls, migration of old power flags; PoE configuration persistence; and electrical power remaining independent of data shutdown.

These are scenario-family assertions, not exhaustive protocol/command conformance.

## Performance

Each workload advances **20 virtual seconds**, includes the real frame pipeline and PoE-powered APs, and excludes setup and browser rendering.

| APs / clients | Wall time | Largest 100 ms tick | PoE allocation | Associated/addressed | Budget exhaustions |
| --- | ---: | ---: | ---: | --- | ---: |
| 2 / 5 | 100.8 ms | 73 events | 60 W | 5 / 5 | 0 |
| 5 / 25 | 316.3 ms | 655 events | 150 W | 25 / 25 | 0 |
| 10 / 100 | 6122.5 ms | 6008 events | 300 W | 100 / 100 | 0 |

Pending timers include normal lease renewal/expiry, table aging, STP and discovery work; they are not reported as leaks. Initial wireless DHCP requests use deterministic jitter to avoid a synchronized broadcast burst exhausting a browser tick.

## Limits

Chrome was exercised; current Safari/Firefox were not independently validated in this change. Browser QA uses an authorized temporary static localhost preview. The deliverable is still a self-contained file, with build checks for inline assets and no server dependency.

REA native evidence verifies the Packet Tracer wireless palette, not live Cisco join/authentication/roaming equivalence. AP power and wireless security/RF are explicitly bounded teaching models. See [research](../research/wireless-reference-analysis.md), [compatibility](../compatibility/cisco-wireless.md) and [PoE assumptions](../features/poe-switch.md).

This work does not establish coverage of every CCNA v2 exam simlet, all IOS commands, all EAP methods or all Cisco hardware behaviors.
