# Wireless nodes

Open the rebuilt `index.html` directly from disk. Wireless features, Tailwind styling and diagram icons are embedded; no backend or internet connection is required. The controller is displayed simply as **WLC**.

## Build a wireless lab

Place a WLC, PoE switch, AP and wireless laptop from the device palette. Connect the AP to a PoE-capable switch port and give the AP and WLC reachable management addresses. Add a router or server when your lab needs routing, DHCP, DNS, RADIUS or HTTP.

1. Configure an enabled WLAN and policy profile on the WLC, map them in a policy tag, and assign that tag to the AP.
2. Let virtual time run and confirm that the AP registers and receives its controller configuration.
3. Configure the laptop with the advertised SSID, matching security mode and credentials. A dotted line appears only after authorization.
4. Configure DHCP or static client addressing, VLAN trunks and routing as needed. Test a reachable lab host with `ping`, or query a configured DNS record with `nslookup`.
5. Open **Packets** and filter 802.11, EAPOL, RADIUS, CAPWAP or DHCP. Select an event for fields and related trace records. Pause/step acts on real virtual time.

Use **My labs** to save your work in the browser or open a YAML lab file.

## Device controls

- **WLC:** double-click for Overview, WLANs, Policy profiles, Tags & profiles, Access points, Administration and Monitoring. Map each WLAN to an enabled policy in its AP's policy tag. Local switching also needs a non-local-site/Flex site tag. Apply changes running configuration. Monitoring saves startup configuration, reloads the controller and sends real client disconnect requests.
- **AP:** connect GigabitEthernet0 to a working PoE switch port. The default lightweight profile uses management addressing/DHCP and an optional primary controller. Its live controller section shows received WLANs, security, policy/site/RF tags, VLAN mappings and effective radios. Configure its WLAN/radio profiles on the WLC; lightweight AP radios remain read-only. The separate standalone profile has local SSID/radio settings described below. Estimated radio coverage is optional.
- **Wireless laptop:** placement opens adapter settings. Choose/scan an SSID, match security and supply lab credentials. Configure DHCP or static IPv4, IPv6/SLAAC, MAC and roaming settings. A configured SSID alone does not create connectivity.

Use **Open desktop** from laptop settings for its simulated web browser and workstation tools. Visit a configured lab HTTP server by its DNS name to exercise DNS and routed HTTP over wireless. AP power is determined entirely by its connected PoE switch and port; the [PoE guide](poe-switch.md) explains budget failures and power cycling.

**Show estimated radio coverage** is an immediate workspace toggle. Check it in the AP settings and close the window to see the shaded range, dashed boundary and approximate distance label; Apply is not required for this display preference. It remains selected after reopening the lab. The boundary remains visible while zooming and in both themes. An AP without PoE power displays a reason and shows its coverage when power becomes available.

Open the device console from its settings. Useful WLC commands include `show ap summary`, `show wlan summary`, `show wireless client summary`, and `show wireless client mac-address <MAC> detail`. On a lightweight AP, use `show capwap client rcb`; on a standalone AP, use `show dot11 associations`.

## Diagnosing failures

No APs: check management addressing, cables, VLANs, controller reachability and UDP/5246 filtering. No advertised network: check policy-tag mapping, enabled WLAN/policy, radio state and RF range. Authentication failure: check security mode, key, RADIUS group/list, server secret and credentials. Associated without an address: inspect DHCP scope, VLAN trunks and relay; this is a different failure from association.

The supported security subset is Open, WPA2 Personal, logical WPA2 Enterprise, logical WPA3 Personal/SAE and WPA2/WPA3 transition. Pure WPA3 requires PMF-capable clients. Transition permits WPA2 clients under optional PMF while SAE clients still require PMF. Incorrect SAE passwords fail confirmation before data authorization. Cryptographic SAE/H2E and encrypted 802.11 interoperability are outside this educational model; see [compatibility limits](../compatibility/cisco-wireless.md) and the [test record](../testing/wireless-test-results.md).

## AP configuration from the WLC

On the WLC, enable the WLAN and its policy profile, map them in a policy tag, and assign that tag to the AP. For radio changes, create an RF profile under **Tags & profiles**, select its band, channel, width, power ceiling and status, and reference it in the AP's RF tag. Apply the WLC settings. The AP's view updates after it receives the CAPWAP configuration; it does not display an unreceived controller draft. Missing tag/profile dependencies are shown as issues instead of an apparently working WLAN.

The selected controller RF profile overrides stale AP-local channel, width, power and enabled settings for that band. Bands without an assigned RF profile retain the modeled radio defaults. Laptops must match the advertised SSID and security mode, plus the personal key or Enterprise credentials. A wireless relationship appears only after authorization. **OBTAINING_IP** means association succeeded but addressing is still pending; **CONNECTED** includes an installed IPv4 configuration. An AP supplied in the reduced 802.3af profile has two effective spatial streams and a reduced estimated/actual scheduled data rate; its status shows the allocated streams.

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

## Administration and traffic policies

Administration configures actual shared RADIUS/TACACS servers and groups, 802.1X lists, local management accounts, NTP, syslog, SNMPv2c and logical HTTPS authentication/access ACL. Newly created dot1x lists are available to WLANs before Apply. Management credentials are lab data saved in exports. Existing advanced console configuration is preserved.

To restrict AP join, enable AAA, add a local or RADIUS AP authorization list, select it, add authorized AP Ethernet MACs for a local list, and enable AP MAC authorization. Admission runs during the next CAPWAP join; an existing joined AP is not forcibly restarted. Monitoring shows actual authorization results/reasons. A later rejoin rechecks the current database.

Policy profiles can bind an existing IPv4 ACL and aggregate/per-client input/output QoS maps. Create the definitions in the console, then select them in the policy. They affect real packets, shared counters, marking and policer loss in central and Flex local switching. Wireless bindings reject physical queuing actions. Monitoring disconnect sends a CAPWAP request; a client with automatic connection enabled may reconnect.

## Standalone AP labs

The existing AP node also offers **Standalone · generic teaching AP** in its operating-profile selector. This is a separate profile from C9115 lightweight firmware. It requires working PoE but no WLC or AP management IP to bridge client traffic.

Add a local SSID, choose Open or WPA2 Personal, set the client VLAN and radio attachment, and enable the selected radios. WPA2 requires a matching key and an AES cipher entry on the client VLAN/radio. Use an access switchport when the client VLAN matches the AP's uplink native VLAN, or a trunk allowing the native/client VLANs when carrying tags. Wrong keys, missing radio/cipher attachments and filtered VLANs fail at their actual stages. Authentication success does not bypass DHCP, routing or DNS dependencies.

The bounded console subset follows documented autonomous-style `dot11 ssid`, `authentication open`, `authentication key-management wpa version 2`, `wpa-psk`, `vlan`, `mbssid guest-mode`, `interface Dot11Radio0/1`, `ssid`, `encryption vlan ... mode ciphers aes-ccm`, `channel`, `channel width` and radio shutdown commands. `show dot11 associations` reads actual clients. Select the profile in the GUI before importing that native subset. Lab/startup persistence retains the complete teaching configuration, including GUI native-VLAN and RF power/client-limit settings. Full autonomous IOS/BVI/subinterface/bridge-group emulation is outside this profile.

PoE loss immediately removes standalone associations. Restoring power restarts local service; saving/reloading rebuilds it independently of any WLC. A reload retains the selected standalone profile and electrical allocation; without saved startup configuration its unsaved SSIDs clear. Switching back to the lightweight profile removes local service and requires a genuine CAPWAP join. Both operating profiles use the same AP node and icon; the dedicated Phone is a separate node.
