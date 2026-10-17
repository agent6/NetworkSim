# PoE switch

The ninth palette node is a Layer 2 PoE switch. It uses the existing Ethernet, VLAN, STP, MAC-learning and EtherChannel engine, with a separate electrical-power model.

All nine node icons come from one ImageGen sheet. Layer 2 uses opposing arrows, Layer 3 uses routing arrows, and PoE uses opposing arrows plus a lightning bolt. Switches are diagram rectangles rather than rack hardware.

## Use it

Connect an AP's GigabitEthernet0 to one of the PoE switch's GigabitEthernet0/1–24 ports. APs receive power exclusively through this connection. An unconnected AP, a non-PoE switch connection, or a non-PoE uplink leaves the AP off. APs have no manual power toggle or power-source selector.

Double-click the switch for power settings. Its default budget is 370 W, with 30 W maximum per access port. The two GigabitEthernet1/x uplinks do not supply power. The lab hardware budget can be changed from 0–740 W in this form.

Each port has Auto/Never mode and a 4000–30000 mW limit. Operational rows show allocation, connected AP and the reason for denial. The full-feature AP profile reserves 30 W at the switch. Insufficient budget or a lower port limit prevents that profile from booting. Physical port order resolves contention reproducibly.

Removing power clears AP addressing/session state, stops its interfaces/radios, and removes client associations. Restoring power restarts DHCP/CAPWAP and client authentication. Global power controls operate switches and other devices; AP power follows the resulting supply automatically.

Power detection does not require IP connectivity. VLAN/STP/data shutdown can break controller access while electrical power remains available. Disabled physical cables remove supply.

## Console

```text
enable
show power inline
configure terminal
interface GigabitEthernet0/4
power inline never
power inline auto max 30000
no power inline
end
show power inline GigabitEthernet0/4
write memory
```

Only Auto/Never are supported; static allocation, priority commands and hardware power policing are rejected. Per-port settings render in running configuration. Budget is a simulated hardware capacity, configured in the GUI and preserved in lab/startup snapshots.

## Fidelity

[Cisco's PoE configuration guide](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960l/software/15-2_7_e/configuration_guide/b_1527e_consolidated_2960l_cg/m_1525e_poe_cg.html) supports the selected inline-power grammar and milliwatt units.

The selected class-4 teaching model reserves 30 W at the PSE, allowing for a 25.5 W powered-device envelope. It does not measure actual instantaneous consumption or simulate analog detection, CDP/LLDP power negotiation, cable resistance, power policing, or reduced-radio AP modes. [Cisco's AP deployment guide](https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/deployment-guide-c07-741977.html) documents that real 9115 APs also support reduced operation on 802.3af; that mode is outside this simulator's full-feature profile.

Only APs are modeled powered devices. Computers, WLCs and servers do not draw PoE power. Budgets and port configuration persist; operational allocations and AP power rebuild after loading. Older saved AP on/off flags and local-adapter selections are upgraded to the PoE-only model.
