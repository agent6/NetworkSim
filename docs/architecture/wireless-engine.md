# Wireless engine

## Shared model and integration

`model.ts` adds WLC, AP and laptop device factories. `wireless-model.ts` owns versioned persistent configuration; `wireless.ts` owns transient AP/client state under device runtime. GUI and IOS commands update that same model. The controller GUI validates a draft through the existing IOS parser before committing it.

The single existing simulation clock drives a 250 ms lifecycle evaluation, one-second RF/scan sampling, individual authentication stages, airtime delivery, deadlines and bounded retry. Pause stops virtual time. Single step executes an existing queued event. Generation checks invalidate obsolete callbacks after power changes, deletion or reconfiguration.

A deterministic 0–1999 ms initial DHCP delay spreads simultaneous client startup across UI ticks. It does not bypass DHCP or fabricate leases. No protocol work runs in canvas drawing.

## AP lifecycle

BOOT → WAIT_IP → DISCOVERY → JOIN → CONFIGURE → RUN.

Management IP and a working Ethernet uplink are required. Discovery uses configured primary addressing, DHCP option 43, a DNS request for cisco-capwap-controller, or local broadcast. Control messages are real simulated UDP/5246 IP packets and must cross existing switches/routes/ACLs. Tags and profiles reach the AP in delivered configuration responses. Tag changes cause rejoin. Echo expiry distinguishes lost controllers; established Flex local sessions may continue with cached policy, while new authentication needs the controller.

Site join/Flex profile reference and operating-mode changes also require rejoin. Explicit missing site/join/Flex/RF dependencies disable the affected WLAN; wrong-band RF mappings reject rather than borrowing another band's profile. In Flex standalone operation, centrally switched WLANs stop serving clients while existing locally switched sessions remain operational. The controller expires AP registrations from its last delivered CAPWAP message, without consulting the AP's global power flag.

## Client lifecycle

IDLE/ADAPTER_DISABLED → SCANNING → NETWORK_FOUND → AUTHENTICATING → ASSOCIATING → KEY_NEGOTIATING → ASSOCIATED → OBTAINING_IP → CONNECTED.

Open WLANs omit key negotiation. Enterprise exchanges perform association, logical EAP identity/RADIUS authentication, then key establishment. Failures retain distinct reasons and use exponential retry capped at 30 seconds. DHCP failure keeps a valid wireless association separate from IP availability.

Enterprise requests respect each RADIUS server's timeout and retransmit count, then try the next configured group member only when no usable reply arrives. A delivered Access-Reject stops the group. The association deadline includes the configured bounded retry chain; AP/controller runtime and client generation checks invalidate stale replies after resets. This is logical password-based EAP, without TLS/PEAP or a physical RADIUS implementation.

Adapter, WLAN, radio and policy changes invalidate affected sessions. Duplicate client MACs and radio admission limits reject association. History is bounded to 80 rows.

## Frame paths

Central: laptop Wireless0 → scheduled 802.11 data record → AP → UDP/5247 CAPWAP through the wired topology → WLC → Ethernet/VLAN → existing network stack.

Local: laptop Wireless0 → scheduled 802.11 data record → AP → Ethernet/VLAN uplink.

Return traffic follows the reverse path. Same-AP and inter-AP client traffic use these same frame handlers. ARP, IPv6 neighbor discovery, DHCP, DNS, ICMP, TCP and HTTP use existing implementations. `aaa-service.ts` registers the existing RADIUS/TACACS service handlers independently of whether a console has been opened.

Authorized wireless transmission and reception update shared Wireless0 packet/byte counters and frame observations. Radio contention/retry/FCS counters are not synthesized.

## RF, roaming and presentation

The configurable model uses distance, band reference loss, path-loss exponent, power, noise, co-channel interference, attenuation, receiver sensitivity, SNR and estimated rate. It is not a propagation survey or PHY emulator. Default roaming requires an 8 dB improvement and five-second residence. Central roaming within the same controller/VLAN preserves the lease; switching networks releases automatic addressing.

The AP displays the WLC configuration it actually received over CAPWAP. Its controller-managed radio settings are read-only on the AP form. A selected matching-band RF profile supplies effective enabled/power/width values; an explicit profile channel overrides the AP fallback channel. Missing explicit RF profiles disable the affected radio. WLC RF channel edits validate allowed channels before applying atomically.

Successful runtime associations produce dotted SVG relationships. They never enter the physical cable collection. Optional coverage is an estimate, disabled initially. Positions are read during timed RF evaluation; moving a node does not schedule per-pixel protocol events.

Packet events carry only modeled fields, with inner-frame and parent IDs linking CAPWAP records to their payload. The Packets panel filters the existing event collection and controls the shared simulation clock.

## Persistence

The ninth device kind is `poeswitch`. It shares the Layer 2 switch classification. `poe.ts` recomputes electrical allocations from direct copper connections, per-port limits and a total budget. Effective device power gates AP interfaces, scanning/advertisement, CAPWAP and console access. Losing supply cancels AP sessions and invalidates client associations; recovery starts addressing and join again. AP power is derived entirely from PoE availability. Manual and bulk power requests skip APs; older saved AP flags and source selections cannot override supply. PoE events are electrical status records, not fabricated Ethernet packets.

High-priority ports receive budget before low-priority ports. Equal-priority devices are admitted in actual detection order. Priorities are persistent interface settings, while detection/allocation records are transient. Budget changes can shed a powered AP and thereby stop its actual wireless service.

Running/startup configuration is serialized; runtime, handshakes, AP registrations and wireless lines rebuild after load. Wireless0 is not a physical cable endpoint. Saved topology validation rejects malformed radio/configuration values transactionally. WLC power cycles load startup configuration or factory defaults. AP/laptop settings are retained as endpoint properties unless a startup snapshot is present.

Wireless profile dictionaries use own-property reads and safe data-property insertion. Legal names that coincide with JavaScript inherited members remain independent entries across CLI, GUI drafts, CAPWAP and reload. Saved validation permits such names only in the modeled dictionary key positions, while recursively inspecting their values.
