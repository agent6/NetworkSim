# Versioned compatibility targets and evidence

Reviewed October 16, 2026. These profiles pin the documentation used to assess an original simulator. They do not mean that Cisco firmware or Windows is running.

| Node | Selected reference | Verified evidence and material differences |
| --- | --- | --- |
| Router | ISR4331; IOS XE 17.12 | Shared IOS-style CLI and routed IPv4/IPv6 engine. Four teaching `GigabitEthernet0/x` ports differ from real ISR numbering/module inventory. No licensing, ASIC, ROMMON or complete IOS process model. |
| L2 switch | Catalyst 9300; IOS XE 17.12 | Switching/management subset. Fresh VTP server/version 1 defaults and platform VLAN restrictions are tested. Explicit settings in older documents remain unchanged. No full hardware/license/SDM resource model. |
| L3 switch | Catalyst 9300; IOS XE 17.12 | Same bridging engine plus routed ports, SVIs, scoped routes and dynamic routing. Physical/SVI policy precedence and real routing/bridging interactions tested. |
| PoE switch | Catalyst 9300 PoE+ style; IOS XE 17.12 | 24 teaching access ports, configurable 370 W initial budget, 30 W class-4 AP allocation. High/low priority and equal-priority detection order affect actual supply. This is not a reproduction of a particular PSU/SKU. |
| WLC | Catalyst 9800; IOS XE 17.12 | Logical CAPWAP, WLAN/policy/tag configuration and five-page controller form. Public UI label remains WLC. Full Cisco GUI, default-policy-tag automatic mapping and chassis interfaces differ. |
| AP | Catalyst 9115 lightweight inspired | Received controller radio/WLAN configuration, DHCP/CAPWAP and PoE-only lifecycle. No autonomous image, WPA3, reduced-power mode or manual power toggle. |
| PC / Laptop | Windows 11 24H2 networking subset | Shared WindowsSession, real network operations, Windows defaults including ICMP payload/TTL. Laptop adds WLAN state. No complete OS, shell/process model or native output capture. |
| Server | Windows Server 2025 networking subset | Same Windows parser and explicit NetworkSim service GUI. Delivered network services; no claim that the GUI is Windows Server Manager or that arbitrary PowerShell works. |

## Reference order and actual observations

Official selected-release documentation takes precedence over observable reference devices, then Packet Tracer, RFCs, verified simulator tests and declared abstractions. Sources and hashes are retained in the machine inventories.

REA inspected the installed Packet Tracer 9.0.1 ARM64 executable, SHA-256 `4ec895db0a5632e8c53da56d7785513d2e80d8c7893a0e6d3bb11202f2d2eb0a`. A controlled native ISR4331 CLI session captured mode transitions, prompt renaming, physical admin-down defaults, valid/invalid addressing and interface state. The [genuine fixture](fixtures/packet-tracer-9.0.1-isr4331.json) identifies the commands, transcript and evidence ID.

That Packet Tracer router reports IOS 16.6.4. It rejects `terminal length 0`, although the selected IOS XE target supports the command. Its limitations were not copied into the target profile. No actual IOS XE 17.12/CML image or native Windows reference environment was available. Complete Cisco output/error, WLC GUI and protocol equivalence remains unverified. No fabricated native golden outputs were created.

## Primary references

- [Catalyst 9300 17.12 command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/command_reference/b_1712_9300_cr.html), with all discovered chapter command headings indexed automatically in `reference-command-inventory.json`.
- [Catalyst 9300 17.12 VTP configuration](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/vlan/b_1712_vlan_9300_cg/configuring_vtp.html).
- [Catalyst 9300 17.12 QoS](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/qos/b_1712_qos_9300_cg/configuring_qos.html).
- [IOS XE 17.12 NETCONF](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/prog/configuration/1712/b_1712_programmability_cg/m_1712_prog_yang_netconf.html).
- [Catalyst 9800 17.12 configuration model](https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/17-12/config-guide/b_wl_17_12_cg/m_config_model.html).
- [Windows networking command reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/windows-commands), with individual command links in `windows-command-inventory.json`.

The independently extracted [exam matrix](exam-objective-coverage.md) distinguishes current CCNA 1.1, published CCNA 2.0 effective February 3, 2027, ENCOR 1.2 and ENARSI 1.1. Current ENCOR does not require its older wireless domain; user-requested wireless remains additional application scope.
