# AP configuration and laptop connection validation

Recorded 2026-10-16. This change addresses AP settings that displayed local radio defaults while the packet engine used a received controller profile. A received WLC RF profile now supplies enabled state, channel, width and transmit power for its band, including when an older saved AP has conflicting local settings. The AP dialog reads the same effective configuration that the wireless engine uses. Controller channel selection is exposed in the existing RF profile form and validated against its radio band.

The AP remains powered exclusively by its connected PoE switch/port. Management addressing and primary-controller selection remain AP settings; WLAN, security, policy and RF configuration are administered from the WLC.

## Executed validation

- TypeScript: `npm run typecheck` passed.
- Focused regression: `node --test --test-concurrency=1 tests/ap-controller-config.test.ts tests/wireless.test.ts tests/poe.test.ts`: 61 passed, zero failed.
- Full repository regression: `npm test`: 592 passed, zero failed. This count includes the concurrently developed broader fidelity work; it is the observed suite snapshot, not a count of AP-only tests.
- Offline build: `npm run build` passed and rebuilt `NetworkSim.html` and `dist/index.html`.
- Browser: `node scripts/browser-ap-controller.mjs`: eight checks passed, zero page errors, in an isolated Chrome context using a temporary local static preview. It does not load or modify the user's saved lab. Results and screenshots are written under `.cache/ap-controller-browser/`.

## New behavioral cases

| Test | Evidence |
| --- | --- |
| APCFG-01 | An enabled WLC RF profile overrides a stale disabled AP radio. The laptop associates on channel 149, receives DHCP, and delivers routed ICMP and HTTP through CAPWAP. |
| APCFG-02 | Wrong SSID, security mode or WPA2 key produces no association. Correcting each restores authorization and connectivity. |
| APCFG-03 | WLC edits do not leak into the AP before CAPWAP delivery. A changed SSID/key disconnects the old client; matching the new configuration reconnects it on the new channel. |
| APCFG-04 | The AP form shows received radio/WLAN/VLAN values, hides local radio/power controls and never displays the WLAN key. Unrelated AP form Apply cannot overwrite controller radio settings. |
| APCFG-05 | An unreachable WLC cannot provision the AP. An empty policy tag removes client service and shows the missing mapping. |
| APCFG-06 | The WLC RF form changes the delivered AP channel. A channel outside the selected band rejects without modifying configuration. |

The browser flow separately edits real WLC forms, observes AP values, corrects an Enterprise client through RADIUS, changes to a different WPA2 Personal WLAN, verifies rejection of a wrong key, and loads the routed server page after correcting it. The AP view shows the updated configuration and client state.

## Changed code

- `src/wireless.ts`: effective RF profile precedence and an AP configuration snapshot derived from received state and actual advertisements.
- `src/ap-controller-view.ts`: read-only controller, tag, radio and WLAN monitoring.
- `src/wireless-ui.ts`: AP monitoring replaces local RF inputs; live refresh; WLC channel selection.
- `src/wireless-controller-form.ts`: transactional channel/band validation with compatibility for older forms.
- `tests/ap-controller-config.test.ts`: six integration and UI cases.
- `scripts/browser-ap-controller.mjs`: eight browser checks using a disposable lab.

These tests verify the simulator's supported wireless model. They do not establish complete Cisco firmware or RF-algorithm equivalence.
