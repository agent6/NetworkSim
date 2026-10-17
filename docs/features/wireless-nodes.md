# Wireless nodes

Open the rebuilt `NetworkSim.html` directly from disk. Wireless features, Tailwind styling and all eight generated device icons are embedded; no backend or internet connection is required. The controller is displayed simply as **WLC**.

## Example lab

Choose **My labs → Open wireless example**, or import [campus-wireless.netsim.yaml](campus-wireless.netsim.yaml).

It contains one WLC, two APs, a Layer 2 PoE switch, a router, a DHCP/DNS/RADIUS/HTTP/syslog server and two laptops. Management uses 10.10.0.0/24. Wireless clients use VLAN 20 and 192.168.20.0/24 through the router's relay. The APs draw their modeled power from the PoE switch.

1. Let virtual time run. AP1 uses a configured controller; AP2 can discover it using the DHCP/DNS configuration. WLC operational monitoring shows registration.
2. LAP1 uses SSID **Campus**, WPA2 Enterprise, username **student**, password **NetworkLab123**.
3. LAP2 deliberately starts with a wrong password. Open its settings, correct it to NetworkLab123 and Apply. A dotted line appears only after authorization.
4. Open the laptop command prompt and run `ping 10.10.0.100` or `nslookup intranet.campus.lab`.
5. Drag LAP1 toward AP2. After the signal threshold/residence conditions are met, the dotted relationship moves to AP2.
6. Open **Packets** and filter 802.11, EAPOL, RADIUS, CAPWAP or DHCP. Select an event for fields and related trace records. Pause/step acts on real virtual time.

## Device controls

- **WLC:** double-click for Overview, WLANs, Policy profiles, Tags & profiles, and Access points. Map each WLAN to an enabled policy in its AP's policy tag. Local switching also needs a non-local-site/Flex site tag. Apply changes running configuration; save startup configuration with `write memory` in the console.
- **AP:** connect GigabitEthernet0 to a working PoE switch port, then configure management addressing or DHCP and an optional primary controller. Its live controller section shows the received WLANs, security, policy/site/RF tags, VLAN mappings and effective radios. Configure WLANs and radio profiles on the WLC; the AP no longer presents conflicting local radio inputs. Estimated radio coverage is optional.
- **Wireless laptop:** placement opens adapter settings. Choose/scan an SSID, match security and supply lab credentials. Configure DHCP or static IPv4, IPv6/SLAAC, MAC and roaming settings. A configured SSID alone does not create connectivity.

Use **Open desktop** from laptop settings for its simulated web browser and workstation tools. Visit `http://intranet.campus.lab` in the example to exercise DNS and routed HTTP over wireless. AP power is determined entirely by its connected PoE switch and port; the [PoE guide](poe-switch.md) explains budget failures and power cycling.

**Show estimated radio coverage** is an immediate workspace toggle. Check it in the AP settings and close the window to see the shaded range, dashed boundary and approximate distance label; Apply is not required for this display preference. It remains selected after reopening the lab. The boundary remains visible while zooming and in both themes. An AP without PoE power displays a reason and shows its coverage when power becomes available.

Open the device console from its settings. Useful WLC commands include `show ap summary`, `show wlan summary`, `show wireless client summary`, and `show wireless client mac-address <MAC> detail`. On an AP, use `show capwap client rcb`.

## Diagnosing failures

No APs: check management addressing, cables, VLANs, controller reachability and UDP/5246 filtering. No advertised network: check policy-tag mapping, enabled WLAN/policy, radio state and RF range. Authentication failure: check security mode, key, RADIUS group/list, server secret and credentials. Associated without an address: inspect DHCP scope, VLAN trunks and relay; this is a different failure from association.

The supported security subset is Open, WPA2 Personal and logical WPA2 Enterprise. This is an educational simulator, with the explicit [compatibility limits](../compatibility/cisco-wireless.md) and [test record](../testing/wireless-test-results.md).

## AP configuration from the WLC

On the WLC, enable the WLAN and its policy profile, map them in a policy tag, and assign that tag to the AP. For radio changes, create an RF profile under **Tags & profiles**, select its band, channel, width, power ceiling and status, and reference it in the AP's RF tag. Apply the WLC settings. The AP's view updates after it receives the CAPWAP configuration; it does not display an unreceived controller draft. Missing tag/profile dependencies are shown as issues instead of an apparently working WLAN.

The selected controller RF profile overrides stale AP-local channel, width, power and enabled settings for that band. Bands without an assigned RF profile retain the modeled radio defaults. Laptops must match the advertised SSID and security mode, plus the WPA2 key or Enterprise credentials. A wireless relationship appears only after authorization. **OBTAINING_IP** means association succeeded but addressing is still pending; **CONNECTED** includes an installed IPv4 configuration.

See the [AP/WLC validation record](../testing/ap-controller-config.md) for the configuration, authentication and delivered traffic checks.

## Selecting WLC profiles and tags

Under **Tags & profiles**, create a **Policy tag** and add a **Policy tag mapping**.
Choose the tag, WLAN profile and policy profile from the dropdowns. Under
**Access points**, select the AP's policy, site and RF tags. Site and RF profile
references also use dropdowns; RF choices are filtered by radio band.

New profiles and tags become selectable immediately, before Apply. Removed or
incompatible references are marked unavailable and must be corrected before
applying. Enterprise WLANs select an existing 802.1X authentication method list;
the form explains how to create one in the console if none exists. See the
[complete WLC GUI review](../testing/wlc-reference-selectors.md).
