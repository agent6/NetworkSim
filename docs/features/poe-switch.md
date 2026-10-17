# PoE switch

The ninth palette node is a Layer 2 PoE switch. It uses the existing Ethernet, VLAN, STP, MAC-learning and EtherChannel engine, with a separate electrical-power model.

All ten node icons come from one ImageGen sheet. Layer 2 uses opposing arrows, Layer 3 uses routing arrows, and PoE uses opposing arrows plus a lightning bolt. Switches are diagram rectangles rather than rack hardware.

## Use it

Connect an AP's GigabitEthernet0 to one of the PoE switch's GigabitEthernet0/1–24 ports. APs receive power exclusively through this connection. An unconnected AP, a non-PoE switch connection, or a non-PoE uplink leaves the AP off. APs have no manual power toggle or power-source selector.

Double-click the switch for power settings. Its default budget is 370 W, with 30 W maximum per access port. The two GigabitEthernet1/x uplinks do not supply power. The lab hardware budget can be changed from 0–740 W in this form.

Each port has Auto/Never mode and a 4000–30000 mW limit. Operational rows show allocation, connected AP and the reason for denial. The full-feature AP profile reserves 30 W at the switch. An explicit 15400–29999 mW port limit selects the 15.4 W 802.3af class-3 AP profile, with 2×2 radios and USB disabled. Below 15400 mW the AP cannot boot. A default full-power port is denied when the budget is exhausted; it does not silently downgrade. High-priority ports are allocated first, followed by detection order, with port number breaking simultaneous ties.

Removing power clears AP addressing/session state, stops its interfaces/radios, and removes client associations. Restoring power restarts DHCP/CAPWAP and client authentication. Global power controls operate switches and other devices; AP power follows the resulting supply automatically.

Power detection does not require IP connectivity. VLAN and spanning-tree state can break controller access while electrical power remains available. Shutting down the physical PSE port removes power. Disabled physical cables remove supply. Fiber, open/short copper faults and copper lengths beyond 100 m also remove supply; a short reports a fault.

## Console

```text
enable
show power inline
configure terminal
interface GigabitEthernet0/4
power inline never
power inline auto max 15400
power inline port priority high
no power inline
end
show power inline GigabitEthernet0/4
write memory
```

Auto/Never and high/low port priority are supported; static allocation and hardware power policing are rejected. Per-port settings render in running configuration. Budget is a simulated hardware capacity, configured in the GUI and preserved in lab/startup snapshots.

## Fidelity

[Catalyst 9300 IOS XE 17.12 PoE configuration](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/int_hw/b_1712_int_and_hw_9300_cg/configuring_poe.html) supports the selected inline-power grammar and milliwatt units.

The selected class-4 teaching model reserves 30 W at the PSE, allowing for a 25.5 W powered-device envelope. It does not measure actual instantaneous consumption or simulate analog detection, CDP/LLDP electrical negotiation, cable resistance or power policing. [Cisco's AP deployment guide](https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/deployment-guide-c07-741977.html) documents the reduced 802.3af operation used by the explicit 15.4 W teaching profile. Actual spatial-stream settings constrain the shared wireless rate model.

APs, the dedicated Phone, and optional generic phone/printer/IoT endpoint profiles draw modeled PoE power. Ordinary computers, WLCs and servers do not. A phone has a powered Network uplink and a data-only PC passthrough port; it does not supply power downstream. Budgets and port configuration persist; operational allocations and AP power rebuild after loading. Older saved AP on/off flags and local-adapter selections are upgraded to the PoE-only model.
