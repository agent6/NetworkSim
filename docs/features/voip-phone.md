# VoIP phone

The tenth palette node is a dedicated, two-port VoIP phone. Like an AP, it has no local power switch: connect **Network** directly to an enabled copper PoE access port. The phone reserves 15.4 W as an 802.3af class 3 powered device. The **PC** port is a data passthrough port and neither accepts nor supplies PoE.

Connect a computer's Ethernet interface to **PC**. The phone bridges its untagged frames through **Network**, preserving the original Ethernet source/destination addresses and IP TTL. Return data stays untagged. Tagged traffic injected through PC is rejected; tagged voice broadcasts never get bridged onto PC.

Configure the connected switch port, for example:

```text
enable
configure terminal
vlan 10
exit
vlan 20
exit
interface GigabitEthernet0/1
switchport mode access
switchport access vlan 10
switchport voice vlan 20
spanning-tree portfast
power inline auto
end
```

The phone learns VLAN 20 from delivered CDP advertisements, then sends its own DHCP, ARP and IP traffic tagged for that voice VLAN. The PC stays in untagged access VLAN 10. Provide a DHCP pool or relay path in each VLAN. The switch learns the phone MAC in VLAN 20 and the PC MAC in VLAN 10 on the same physical port.

LLDP-MED network-policy profiles are also supported. The phone advertises telephone capabilities on Network, receives the switch's actual policy, and applies its VLAN/CoS/DSCP values. Neither CDP nor LLDP advertisements pass through to the PC. Dropped or disabled discovery cannot silently reveal switch configuration. Without a valid received voice policy, the phone uses the untagged access VLAN. Policy changes or expiry restart only its own automatic address acquisition; they do not reconfigure the PC.

Double-click the phone to see its live PoE allocation, uplink and PC peers, learned policy, voice IP and gateway. **IP settings** always configures Network addressing, including imported files whose interface entries have a different order; **Renew DHCP lease** runs through the real simulated voice interface. The PC port cannot have primary/secondary IPv4, explicit IPv6 or automatic address configuration. Phones have no IOS/Windows console tab.

Removing the Network cable, disabling inline power, exhausting the PoE budget, shutting down its supplying port, or breaking the copper cable takes both phone ports down. Restoring power boots the phone, relearns policy and obtains addressing again. Portable YAML and browser recovery preserve the topology and configured addressing; electrical supply, neighbor policies and leases rebuild from live traffic.

This node models network attachment and PC bridging. SIP/SCCP registration, dial plans, calls and audio are outside its current scope.

Behavior follows Cisco's documented [voice-VLAN attachment and unchanged untagged PC traffic](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst_digital_building_series_switches/software/15-2_7_e/configuration_guide/b_1527e_consolidated_cdb_cg/m_vlan_voice_cg_2960-x.html). All node artwork is one newly generated family of ten flat gray diagram symbols with transparent backgrounds.

Validation: `tests/phone.test.ts`, `tests/phone-audit.test.ts`, `tests/endpoint.test.ts`, `tests/poe.test.ts`, and `node scripts/browser-phone.mjs`. The [independent audit tests](../../tests/phone-audit.test.ts) cover IPv6 passthrough, loop limits, import validation and boot cancellation.
