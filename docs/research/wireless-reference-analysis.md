# Wireless reference analysis

Recorded 2026-10-16. The app labels the controller **WLC**. Its deliberately limited command profile follows IOS XE 17.12; this is not Cisco firmware.

## REA evidence

Authorized target: installed Packet Tracer 9.0.1, ARM64 slice of
`/Applications/Cisco Packet Tracer 9.0.1/Cisco Packet Tracer 9.0.1.app/Contents/MacOS/PacketTracer`.
SHA-256: `4ec895db0a5632e8c53da56d7785513d2e80d8c7893a0e6d3bb11202f2d2eb0a`.

| Evidence | Controlled observation | Boundaries |
| --- | --- | --- |
| `ev_171f6e079c3e5e64382d403789f6f467a5d2d0d575ebc2b92469d97845385123` | Existing native window: workspace, device categories, Realtime/Simulation controls | Initial accessibility capture truncated at 100 nodes |
| `ev_7e544a560c408075086f670fb0d4baab76ae71b3bc4cb2b3235aaf1962db2b33` | AXPress on Wireless Devices exposes WLC-2504, WLC-3504, WLC-PT, 3702i and LAP-PT | Palette observation only; not verification of joins, authentication, roaming or controller CLI |

The native workspace exposes no usable placement action through the observed accessibility tree. An authentication window was present; no login or access-control bypass was attempted. The shipped help file `Contents/help/default/config_others.htm` describes generic AP, LAP and 3702i configuration; that is documentation evidence, not a runtime result.

Packet Tracer's older WLC palette is not the chosen IOS XE command platform. No AireOS command grammar, firmware or proprietary graphics are bundled. NetworkSim's nine device illustrations were generated with ImageGen against the user's thin-gray hardware style reference.

REA controlled browser evidence `ev_613e4f7158244ce5a52cb2e221fc838818a32751c9dd523b99c67839260ec02f` loaded NetworkSim's example in an owned Chrome process, captured the then-current eight palette controls and the WLC label, and reported no page errors. This 12-second sample did not capture an established client association. Independent longer browser tests exercise that lifecycle. Compact evidence metadata is saved beside this document. A portable native-analysis snapshot could not be exported because REA required a concrete provider analysis profile; the live analysis session was then closed without a snapshot. No immutable snapshot verification is claimed.

## Authoritative references and decisions

- [Cisco 17.12 configuration model](https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/17-12/config-guide/b_wl_17_12_cg/m_config_model.html): WLAN, policy, site, AP join, Flex and RF profile/tag relationships; GUI category names and configuration modes.
- [Cisco controller configuration model explanation](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/213911-understand-catalyst-9800-wireless-contro.html): policy mapping and AP tag assignment; APs rejoin when tags change.
- [Cisco 17.12 WLAN security](https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/17-12/config-guide/b_wl_17_12_cg/m_wlan_security_9800.html): supported WPA2 configuration grammar.
- [Cisco 802.1X configuration](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/213919-configure-802-1x-authentication-on-catal.html): RADIUS group, dot1x method list and WLAN binding.
- [Cisco FlexConnect](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/213945-understand-flexconnect-on-9800-wireless.html): local versus centralized forwarding and controller outage distinctions.
- [Cisco AP command reference](https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/command-reference/b_wireless_cr/show-commands.html): AP `show capwap client rcb`; `show capwap client configuration` belongs to 17.13 and is excluded.
- [Cisco heartbeat command reference](https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/17-9/cmd-ref/b_wl_17_9_cr/configuration-commands-a-to-f.pdf): AP profile heartbeat range 1–30 seconds, default 30.

## Verification and assumptions

NetworkSim's reproducible tests verify its own packet delivery, GUI/CLI consistency, retry, addressing and roaming. They do not establish equivalence with a live Cisco device.

Intentional teaching assumptions: AP rejoin waits one virtual second; controller loss uses three missed heartbeat intervals; beacon visibility is sampled every second; RF uses a deterministic log-distance model. A 9115-inspired two-radio capability profile is selected, not a complete regulatory/hardware emulation.

Security exchanges are logical records. WPA2 PMK derivation uses PBKDF2-HMAC-SHA1, with a known vector test, but session-key serialization/MIC exchanges are educational and not interoperable IEEE frames. Enterprise authentication reuses credential-based simulated RADIUS; PEAP, EAP-TLS, AES-CCMP and DTLS certificate validation are not implemented. See [compatibility limits](../compatibility/cisco-wireless.md).
