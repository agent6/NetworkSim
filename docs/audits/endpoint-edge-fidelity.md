# Endpoint attachment and voice VLAN fidelity

This extension provides an executable wired edge workflow for a phone, printer or generic IoT appliance while retaining the existing nine palette node kinds. It does not implement an audio codec, call-control server, printer spooler or IoT application protocol.

## Persisted profile and power

PC and laptop nodes can retain `features.endpoint={role,power}`. An absent profile remains an ordinary externally powered computer. Printer and IoT roles reuse the actual host IPv4/IPv6, DHCP, ARP/NDP, DNS and packet paths. A wired PC can explicitly select the generic class-3 PoE profile for printer/IoT; the phone role is a wired PC using that profile. Laptops remain externally powered and cannot use the phone role. This is a generic educational allocation of 15.4 W at the PSE, not a hardware-specific phone power measurement.

The PoE switch detects these endpoints through the same direct copper-port electrical path as APs. Per-port inline power, maximum allocation, high/low priority, detection order, total budget, physical cable eligibility and switch power govern delivery. An administratively shut physical switch port now removes its PoE allocation and powers down its PD, following the selected platform's detection prerequisite. STP/VLAN forwarding remains independent of electrical delivery. APs retain their strict PoE-only full/reduced power behavior.

Allocation arithmetic uses integer-milliwatt comparisons and rounded totals so ten 15.4 W endpoints fit an exact 154 W budget. Further demand is denied without oversubscription. Software reload preserves an available supply while resetting the endpoint's received protocol state.

## Received voice attachment

A phone can learn an access-port voice policy from delivered CDP or LLDP-MED records. The latter requires an explicit configured voice network-policy profile, LLDP enabled on the switch, and a received MED-capable endpoint advertisement. The switch does not transmit a MED policy merely because a phone exists elsewhere in the topology.

The selected policy controls actual host egress VLAN tagging. A numbered VLAN emits that tag; dot1p emits VID0 with configured CoS; untagged uses the access VLAN. A dot1p phone accepts both native untagged and priority-tagged return frames. A numbered voice endpoint rejects data-domain frames. An attached profile supplies the switch's effective voice VLAN for ingress, egress, STP membership and switchport show output. LLDP DSCP and CoS fields appear in the actual packet/tag metadata; CDP supplies a VLAN/CoS policy without pretending generic ICMP is native audio.

A changed or expired received policy invalidates the old ARP/DHCP/automatic-address state before restarting host acquisition. A live data-subnet DHCP lease is replaced with a voice-subnet lease only after the policy arrives. Configuration, discovery loss, expiry, link power loss and recovery affect real reachability.

The adapter selects the most recently received live policy, with CDP as a deterministic simultaneous tie. Conflict precedence among different real phone vendors is not certified. The `none` policy uses the generic phone's untagged default because this endpoint has no vendor keypad override. An endpoint software reload without a carrier bounce may wait for the connected switch's next normal discovery advertisement; a previously unexpired MED record does not prove a remote software restart.

## IOS-style configuration surface

The voice-only subset includes:

- Global `network-policy profile <1-4294967295>` and removal.
- Profile `voice vlan <id>|dot1p|none|untagged`, with one optional `cos` or `dscp` clause per command. Updating the other priority field retains the existing value for the same VLAN.
- Interface `network-policy <id>` and `no network-policy`; the configuration-guide `network-policy profile <id>` alias is also accepted.
- `lldp med-tlv-select network-policy`, its removal/default, context help/completion and `show network-policy profile [id] [detail]`.

Profile-only voice forwarding works without a separate switchport voice VLAN command. Existing voice configuration can precede an attached profile; a subsequent positive switchport voice command is rejected until the profile is removed. Static secure MAC/profile combinations are rejected atomically in either configuration order. Invalid ranges and trailing clauses do not partially mutate configuration.

IOS text rendering, copy replay, saved reload and portable JSON preserve configured profiles/attachments. Endpoint role/power remain application metadata rather than invented IOS commands. Received policies, timers, power allocations and leases rebuild from current delivery after portable load.

Voice-signaling policy, LLDP binary TLVs, the complete MED fast-start/state-machine behavior, advanced power renegotiation and vendor-specific endpoint firmware remain outside this bounded extension. The new voice policy surface does not imply native CLI/output equivalence across all IOS commands.

## Primary references

- [C9300 IOS XE 17.12 Voice VLANs](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/vlan/b_1712_vlan_9300_cg/configuring_voice_vlans.html): access-port operation, CDP policy delivery, tagged/priority-tagged/untagged attachment.
- [C9300 IOS XE 17.12 LLDP/LLDP-MED](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/int_hw/b_1712_int_and_hw_9300_cg/configuring_lldp__lldp_med__and_wired_location_service.html): received MED-capability prerequisite, explicit network policy, default TLV enablement, profile/voice/static-security restrictions.
- [C9300 IOS XE 17.12 interface command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/command_reference/b_1712_9300_cr/interface_and_hardware_commands.html): native profile/attachment/voice syntax, ranges, CoS/DSCP defaults, show variants.
- [C9300 IOS XE 17.12 PoE](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/int_hw/b_1712_int_and_hw_9300_cg/configuring_poe.html): no-shutdown detection prerequisite, class-3 PSE allocation, maximum/budget denial and electrical lifecycle.

## Executable evidence

`tests/endpoint.test.ts` passes 15/15 independent cases: printer/IoT traffic and optional power; CDP delivery/loss/recovery; actual voice VLAN/CoS/DSCP frames; MED capability handshake; profile-only switching; received edits/expiry/removal/default; live data-to-voice DHCP replacement; tagged/data isolation; dot1p native DHCP and routed ICMP returns; exact budget boundary; software reload; existing computer-to-phone NIC restart and DHCP migration; syntax/help/atomic rejection; text replay; saved/portable configuration.

The focused endpoint, PoE, discovery, core packet, syntax, switching-compatibility, switch operational output and independent wired integration suite passes **160/160**. Parent-owned combined typecheck/build/audit snapshots establish the final integrated artifact separately. Native IOS XE 17.12 differential device capture remains unavailable.
