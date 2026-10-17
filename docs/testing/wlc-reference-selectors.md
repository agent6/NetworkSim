# WLC GUI reference review

The review covers all five existing WLC sections. References to existing
configuration objects use native select controls. Names for new objects,
addresses, credentials and numeric settings use entry fields. Existing WLAN IDs
remain read-only.

| Section | Reviewed controls and resulting behavior |
| --- | --- |
| Overview | Management interface selects an existing interface. An unavailable configured interface remains marked unavailable instead of silently choosing another port. |
| WLANs | Security, enabled state and broadcast state are selectors. Enterprise WLANs select an existing 802.1X authentication method list; its server group is included in the option label. Personal WLANs show their PSK field, and Enterprise WLANs show their authentication list. |
| Policy profiles | Switching and status are selectors. VLAN ID remains numeric because the policy can carry a VLAN through the upstream network without defining a local WLC VLAN object. |
| Tags & profiles | Policy tags have separate name/create rows. Policy mappings select the tag, WLAN profile and policy profile. WLAN labels include SSID/status; policy labels include VLAN/status. Site tags select AP join and Flex profiles. RF tags select profiles compatible with the corresponding radio band, or explicitly retain AP radio defaults. |
| Access points | Policy, site and RF tags select existing tags, including newly created unsaved tags. |

Dropdown choices update on edits, additions and removals throughout the same
form. Creating a new profile does not require an intermediate Apply. Empty
policy tags can be created, saved and removed. Built-in default tag/profile
names are read-only and their rows cannot be removed.

Removing or renaming a referenced object, or changing its RF band, retains the
requested value with an **unavailable** label and a validation error. Apply
reveals the first invalid control's tab and opens its containing details panel.
It does not substitute another profile. The form parser also
validates references transactionally on a disposable simulator; running state
is committed only after the complete form passes.

802.1X method lists continue to be created through the existing IOS XE console:
`aaa authentication dot1x <name> group <RADIUS-group>`. The GUI explains this when
no lists are available. This change does not add a complete AAA server/group
editor or claim feature parity with Cisco's entire web application.

RF channel and width selectors track the band. In this simulator the supported
2.4 GHz width is 20 MHz; 5 GHz also offers 40 and 80 MHz.

The reference workflow was checked against Cisco's
[Catalyst 9800 configuration model](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/213911-understand-catalyst-9800-wireless-contro.html)
and [IOS XE 17.12 configuration guide](https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/17-12/config-guide/b_wl_17_12_cg.pdf).

Validation:

- `npm run typecheck` and the offline HTML build.
- `tests/ap-controller-config.test.ts`: explicit/empty tag creation and deletion,
  delivered AP assignment, matching client connectivity, and transactional
  rejection of missing policy tags and 802.1X lists.
- Existing wireless, PoE and server-service regression tests.
- `scripts/browser-wlc-references.mjs`: actual form controls, options from unsaved
  profiles, RF filtering, removal/validation behavior, AP receipt over CAPWAP,
  matching laptop DHCP and routed DNS/HTTP, saved/deleted empty tags and both themes.
- `scripts/browser-ap-controller.mjs`: existing Enterprise/Personal authentication
  and controller-to-AP workflow, updated to select the RF profile dropdown.

Browser evidence is written under `.cache/wlc-references-browser/` and
`.cache/ap-controller-browser/` in isolated headless profiles and temporary
localhost servers. The user's open workspace and saved lab are not used by QA.
