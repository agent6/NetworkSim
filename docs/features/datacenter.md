# Datacenter Switch and NS-OS

**Datacenter Switch** is NetworkSim's fictional **NS-DC24-6Q**, with a separate
**NS-OS** CLI inspired by the standalone Cisco Nexus 9000 NX-OS 10.6(x) command
model. It is not a Cisco image, an ACI switch, or a complete NX-OS implementation.
Existing routers and switches retain their IOS-style CLI and lab format.
The palette, topology and device details use the shorter **DC Switch** label
so the name fits below the icon.

## Platform-selected defaults

| Interfaces | Intended placement | Default maximum speed | Supported speeds |
| --- | --- | --- | --- |
| Ethernet1/1–Ethernet1/24 | Access-facing | 10 Gbps | 1 / 10 Gbps |
| Ethernet1/25–Ethernet1/30 | Uplinks | 40 Gbps | 1 / 10 / 40 Gbps |
| mgmt0 | Dedicated management | 1 Gbps | 10 / 100 / 1000 Mbps |

All 30 data ports begin **administratively down**, with `switchport`, explicit
access mode and VLAN 1. These are this fictional platform's deliberately selected
access-layout defaults—not a claim about every Nexus release's defaults.
Port placement is descriptive: any data port can connect to a host, router or
switch. Autonegotiation is enabled and can negotiate down to existing 1-Gbps
NetworkSim nodes. `speed` takes Mbps, including `10000` and `40000`; `speed auto`
restores negotiation and the port's default maximum.

`mgmt0` starts enabled, routed and in the `management` VRF. It cannot be a
switchport, join a port-channel, move to another VRF, run a routing protocol, or
forward transit traffic. Give it a separate management subnet. VLAN 1, rapid-PVST
and IPv4 forwarding are present. SSH begins enabled, matching the measured Nexus
9300v 10.6.2.F default; the other optional feature gates begin disabled. VTP is disabled.

## Console, roles and management

NS-OS enters EXEC at `hostname#`, not IOS `>` followed by `enable`. A new device
has a local bootstrap administrator console until accounts are configured.
Use invented lab credentials:

```text
configure terminal
username admin password LabAdmin42 role network-admin
username observer password LabObserve42 role network-operator
feature ssh
interface mgmt0
 ip address 192.0.2.11/24
 no shutdown
end
copy running-config startup-config
```

Subsequent local consoles display `login:` and `Password:`. SSH uses the same
local accounts and actual delivered simulated TCP22 packets. A PC can use
`ssh admin@192.0.2.11`; IOS nodes can use `ssh -l admin 192.0.2.11`; NS-OS uses
`ssh admin@192.0.2.11`. Telnet is not enabled for this platform.
`no feature ssh` disables admission; `feature ssh` restores it. Disabled SSH is
exported as `no feature ssh`, so configuration replay and reload retain that choice.
To originate through a management or tenant VRF, use
`ssh admin@192.0.2.11 vrf management`; subsequent session operations retain that
VRF rather than falling back to the default table.

`network-admin` can read and change all implemented settings.
`network-operator` has operational read access and may enter `configure terminal`,
but cannot change configuration, save/reload, archive/export configuration, or
read running/startup configuration. A `#` prompt does not grant write access.
Custom roles, VDCs, remote AAA and cryptographic SSH are not implemented.
Credentials remain simulation data and are included in portable lab/configuration
exports; this is not real password storage or a security boundary for exported files.

`?`, keyword abbreviations, Tab completion and parser errors use the NS-OS command
surface. `show capabilities` lists its scope; `show feature` lists implemented
feature gates. IOS `enable`, DTP/PAgP, `switchport nonegotiate`, IOS routing
`network` statements, `vrf forwarding` and `config-register` are not aliases.
`show hostname` returns the configured hostname. Show output supports
`| include`, `| exclude` and `| begin` regular-expression filters, with help and
Tab completion for those implemented modifiers.

Configuration selectors also work inside configuration subsections. For example,
`interface port-channel1` at `(config-vpc-domain)#` switches directly to
`(config-if)#`; the following `description`, `switchport` and `vpc peer-link`
commands configure that port-channel. `exit` then returns to `(config)#`.
Other implemented global commands work from subsections too, including their
`?` and Tab support: `hostname` or `feature` returns to global configuration,
while a selector enters its target subsection. Local commands take precedence,
so a static route inside `vrf context BLUE` still belongs to BLUE. Interface
settings still require interface mode, and existing feature and role checks apply.
The [23 reviewed CML navigation observations](../../scripts/cml/fixtures/nxos-navigation-observations.json)
record these mode transitions and expected rejections on Nexus 9300v 10.6(2).
They validate CLI navigation, not additional vPC forwarding combinations.

## VLANs, trunks and port-channels

```text
configure terminal
feature lacp
vlan 10
 name Application
exit
interface Ethernet1/1
 switchport mode access
 switchport access vlan 10
 spanning-tree port type edge
 no shutdown
exit
interface Ethernet1/25
 channel-group 10 mode active
 no shutdown
exit
interface Port-channel10
 switchport mode trunk
 switchport trunk allowed vlan 10
 mtu 9216
 no shutdown
end
```

LACP `active`/`passive` requires `feature lacp`; static `mode on` does not.
Configured LACP members prevent disabling that feature. Settings on a
port-channel propagate to its physical members; shared Layer 2/MTU/VRF settings
must be changed on the logical port-channel rather than one member. Members
must be compatible; unsupported speeds and inconsistent member configurations
are rejected. There is no PAgP or DTP.

Physical selectors accept compact and spaced forms, including
`interface port-channel 1` and `interface ethernet 1/1-2`. A contiguous physical
range uses `(config-if-range)#`; interface commands apply to every selected
port, and a rejected operation rolls back the entire range. Layer 2 `mtu`
accepts 1500 or the modeled system jumbo MTU, 9216. Routed ports also accept
intermediate MTUs. A vPC peer-link and its members report an effective MTU of
9216 without adding implicit configuration lines.

STP supports `rapid-pvst`, MST region name/revision/instance mappings, per-VLAN
priority, cost and BPDU/root/loop protection. NX-style port types are `normal`,
`edge`, `edge trunk` and `network`. Edge is for endpoints, never an inter-switch
link. Network ports use the bounded operational **Bridge Assurance** model:
both sides must send reciprocal network-port BPDUs; missing BPDUs cause blocking
after three configured Hello intervals. This is not a hardware-specific
84-second peer-link bring-up timer emulation.

vPC consistency distinguishes the default STP port type/guard from explicit
`normal`/`none`, matching the measured Nexus behavior. Use
`no spanning-tree port type` and `no spanning-tree guard` to return to the
defaults. `spanning-tree guard none` is an explicit setting, not a reset.

VTP can be explicitly enabled with `feature vtp`, but accepts only transparent
mode and version 1/2. Server/client distribution and VTPv3 are rejected.

## Layer 3, VRFs and named OSPF

```text
configure terminal
feature interface-vlan
feature ospf
vrf context APPLICATION
 ip route 203.0.113.0/24 10.10.10.254
exit
interface Vlan10
 vrf member APPLICATION
 ip address 10.10.10.1/24
 no shutdown
exit
router ospf FABRIC
 vrf APPLICATION
  router-id 10.255.0.1
 exit
exit
interface Vlan10
 ip router ospf FABRIC area 0
end
```

For routed data ports, use `no switchport` before addressing. `ip address` takes
CIDR, not an IOS address/netmask pair. Changing `vrf member` deliberately clears
IPv4/IPv6 addresses and OSPF attachment; configure membership before addresses.
SVIs require `feature interface-vlan`, an active VLAN and an operational
forwarding member for line protocol. IPv6 addresses and `ipv6 unicast-routing`
enable IPv6 forwarding; IPv4/IPv6 static routes work in default or named contexts.

OSPFv2 uses a named tag and interface `ip router ospf TAG area AREA`.
Router ID, passive interfaces, cost/priority, Hello/dead timers and broadcast or
point-to-point network types use the shared packet engine.
The engine currently supports **one OSPF instance per VRF**. A second same-VRF
instance is explicitly rejected rather than replacing the first. Different VRFs
may have different tags. OSPFv3, BGP and HSRP are not exposed as working NS-OS
features in this foundation.

Passive interfaces use the native NX-OS commands:

```text
router ospf FABRIC
 passive-interface default
exit
interface Ethernet1/1
 no ip ospf passive-interface
end
```

`ip ospf passive-interface` suppresses Hellos; `no ip ospf passive-interface`
explicitly enables them, overriding the current routing context's default.
`default ip ospf passive-interface` removes that override. Each OSPF VRF has its
own `passive-interface default` / `no passive-interface default`; changing the
default VRF does not change a named VRF. Passive interfaces still advertise
their network through other active adjacencies. The IOS router-mode command
`passive-interface Ethernet1/1` is rejected. Older saved interface lists still
operate and export as native interface commands.

`ip ospf mtu-ignore` / `no ip ospf mtu-ignore` control the receiving interface's
DBD MTU check. A setting on the larger-MTU peer cannot disable the smaller
receiver's check. This does not change packet MTU or fragmentation. To test a
mismatch, force a new database exchange and check both peers plus forwarding;
an old FULL state on one peer alone is insufficient.

New loopbacks are administratively up, with 8,000,000-Kbit bandwidth and OSPF
cost 1 unless an explicit OSPF cost overrides it. Removing `ip router ospf TAG
area AREA` preserves interface OSPF parameters. A different tag leaves the
attachment unchanged; a different area reports `Area mismatch` without changing
configuration. Configuration-file replay treats that response as an error and
rolls back the whole merge.

Use `show ip ospf TAG neighbors vrf BLUE`, `show ip ospf interface vrf all` or
`show ip ospf TAG interface Ethernet1/1`. A selected interface determines its
VRF, so appending `vrf BLUE` to the selected-interface form is rejected, as on
the tested Nexus image. Missing instance tags reject; a missing queried VRF
returns no rows. Interface detail uses local state, received neighbors and
actual Hello timers; unmodeled ASIC and process fields are omitted.

`ping ADDRESS count N` and `ping ADDRESS vrf BLUE count N` send actual probes,
with a simulator limit of 1–20. Their native-style output reports measured
replies, TTL, timing and loss. The app continues to run fully offline.

## vPC

Open **My labs → Open Datacenter Switch vPC example** for the embedded six-node
lab, or import [the same portable example](../../examples/datacenter-vpc.netsim.json).
Its generator is `scripts/generate-datacenter-lab.mjs`.

Enable `feature vpc` and `feature lacp` on both switches. Keep keepalive transport
separate from the peer-link:

```text
configure terminal
feature vpc
feature lacp
vpc domain 42
 role priority 100
 peer-keepalive destination 192.0.2.12 source 192.0.2.11 vrf management
 peer-switch
 peer-gateway
 ip arp synchronize
 delay restore 30
exit
interface Port-channel100
 switchport mode trunk
 vpc peer-link
 no shutdown
exit
interface Port-channel10
 vpc 10
 no shutdown
end
```

Create the physical LACP members and compatible VLAN/trunk configuration on both
ends as in the earlier port-channel example. `vpc peer-link` requires a trunk
port-channel and sets its STP port type to `network`.
Configure each downstream port-channel's `vpc ID` on both peers. IDs range
1–4096; domains range 1–1000. A peer-link cannot also be a vPC member.
`vpc orphan-port suspend` is available on non-vPC Layer 2 interfaces.

The model uses delivered peer-link state exchanges and routed VRF UDP3200
keepalives, common LACP actor identity, sticky operational role, consistency
checks, per-VLAN/member suspension, peer-link loop prevention, peer-switch,
peer-gateway, MAC/optional ARP synchronization and timed restoration/auto-recovery.
`dual-active` describes a potential condition when both communication paths are
unavailable, not knowledge of an unreachable peer's real state.
`layer3 peer-router` is explicitly unsupported.

Keepalive `interval` is milliseconds; `timeout` and `hold-timeout` are seconds.
An explicit `interval` requires `timeout`, and vice versa. Updating keepalive
parameters invalidates keepalive freshness without resetting an established
peer-link adjacency. Delivered UDP3200 keepalives use DSCP48 (ToS192), TTL64.
`delay restore`, `delay restore interface-vlan` and auto-recovery `reload-delay`
are seconds. Auto-recovery is off by default; enabling it is a deliberate
failure-recovery choice, not universally safe.
Disabling `feature vpc` deletes the vPC domain and interface membership settings.

The default member restore timer is 30 seconds; the default SVI timer is
10 seconds. Initial adjacency delays both peers. After peer-link failure,
the still-forwarding primary keeps forwarding during recovery; the suspended
secondary waits for restoration. A running restore timer on the primary is
not itself a reason to suspend its vPC. SVI presence/admin-state mismatches
produce Type-2 warnings without suspending compatible Layer 2 members.
Different peer-gateway settings do not produce an invented Type-2 fault.

The [CML full-pair audit](../audits/cml-vpc-pair.md) separates native observations,
simulator regressions and unresolved comparisons. The independent
[six-node importable lab](../../examples/datacenter-vpc-cml.netsim.yaml) and
[117-step capture/replay scenario](../../scripts/cml/scenarios/nxos-vpc-pair.json)
exercise management-VRF keepalive, a two-link peer-link, a dual-homed IOS
access switch, two VLANs, SVIs and orphan endpoints. Native IOS access Po10
maps to simulator Po3; Nexus Po10/vPC10 are unchanged. Local aggregate IDs
are independent of the shared vPC ID.

### Validated topology matrix

This matrix describes simulator integration tests, not a claim that every row
has been independently validated on native switches in CML.

| Topology | Exercised behavior |
| --- | --- |
| One vPC pair with an IOS access switch | CLI-configured active/passive LACP and static Layer 2 EtherChannels, two VLANs, either uplink failing and recovering |
| Back-to-back vPC pairs | Four switches, separate vPC domains, four inter-pair links, LACP/static startup, member loss, peer reload, peer-link failure, restoration and lab save/load |
| Orphan access ports | Local switching remains available by default; opt-in suspension removes forwarding and reports suspended status on the secondary |
| Orphan Layer 2 EtherChannels | Suspension withdraws all member links from the IOS neighbor; LACP/static bundles recover after peer-link restoration |
| Routed EtherChannels | NS-OS-to-NS-OS and NS-OS-to-IOS Layer 3 switches, IPv4/IPv6, OSPF, individual/total member failure and recovery |
| Routed EtherChannels in VRFs | Configuration export/replay, bidirectional IPv4/IPv6 and default-table isolation; peer VRF names may differ |

The Layer 2 tests count **1,000 frames per known-unicast, unknown-unicast and
broadcast burst**, requiring one delivery per frame rather than accepting a
successful ping as evidence against duplication. The tests also exercise
invalid-command rollback and operational interface/port-channel displays.

**vPC member bundles are Layer 2 only.** Use a separate routed port-channel to
each individual switch for Layer 3 links, not one routed bundle spanning a vPC
pair. Converting a vPC member or peer-link to routed mode is rejected.
Configure Layer 3 addresses and OSPF on the logical port-channel, never its
physical members. Configure orphan suspension on the logical interface for an
orphan EtherChannel.

Back-to-back pairs need different vPC domain IDs (or separately configured
unique system identities). Member vPC IDs match within each pair; they need not
match the IDs used by the other pair, nor the local port-channel numbers.
The embedded IOS access-switch example uses Port-channel3, within that
platform's supported channel-group range of 1–6.

## Verify, save and replay

Use:

```text
show version
show inventory
show feature
show interface status
show interface Ethernet1/25
show port-channel summary
show lacp neighbor
show spanning-tree
show mac address-table
show ip route vrf APPLICATION
show ip ospf neighbors vrf APPLICATION
show vpc
show vpc role
show vpc peer-keepalive
show vpc consistency-parameters global
show vpc consistency-parameters vpc 10
show vpc consistency-parameters interface po 10
show vpc orphan-ports
show running-config vpc
```

Operational displays use local counters, RIB, received neighbors, BPDU/LACP state
and received vPC runtime—not the remote configuration or hardcoded healthy values.
vPC summaries separate global, per-VLAN, member and Type-2 checks; they retain
the last completed consistency result across a peer-link outage. Port-channel
summaries use native-style `Po1(SU)` and `Eth1/1(P)` flags. Consistency tables
show modeled parameters and received peer values; unmodeled ASIC/QoS rows and
unmeasured keepalive transmit timestamps are omitted.
`show running-config` is rendered separately in replayable NS-OS syntax.
`copy running-config startup-config`, `reload`, `copy running-config
bootflash:backup.cfg`, `copy bootflash:backup.cfg running-config` and
`archive config` use the correct dialect. Configuration replay rejects errors
transactionally. Portable lab import/export retains the version-1 format and
rebuilds runtime rather than importing neighbors, learned tables or live sessions.

The shared read-only SNMP agent can be configured with
`snmp-server community LabRead group network-operator`; optional `contact` and
`location` are supported. System identity is NS-OS/NS-DC24-6Q. Standard
`ifHighSpeed` reports Mbps without the 32-bit `ifSpeed` limit for 10G/40G ports.
No writable MIB, binary SNMP implementation or real USM cryptography is claimed.
NX-API, NETCONF, RESTCONF and general YANG schema management are not enabled on
this platform.

Offline automation accepts `ansible_network_os: cisco.nxos.nxos` and
`cisco.nxos.nxos_command` / `cisco.nxos.nxos_config` (short names also work).
Use a network-admin account, no `become`/`enable`. The same bounded lines/parents,
match, save_when, wait_for and no_log behavior applies. Dialect mismatch is
rejected; commands still cross actual simulated SSH. Native Ansible is not run.

## Evidence and official references

`tests/nsos.test.ts` covers factory/identity, strict grammar/help, feature gates,
real LACP, routed-VRF traffic, named OSPF adjacency, roles/SSH, VTP restrictions,
renderer/replay, persistence and vPC CLI validation. `tests/datacenter-vpc.test.ts`
separately exercises the vPC engine and failure cases.

Design references are Cisco Nexus 9000 **standalone NX-OS 10.6(x)** guides.
These documents describe Cisco behavior; the supported simulation subset and
deliberate defaults are defined above.

- [Understanding the CLI](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/fundamentals/cisco-nexus-9000-series-nx-os-fundamentals-configuration-guide-release-106x/m-understanding-the-cli.html)
- [User accounts and RBAC](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/security/cisco-nexus-9000-series-nx-os-security-configuration-guide-release-106x/m-configuring-user-accounts-and-rbac.html)
- [Layer 2 interfaces](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/interfaces/cisco-nexus-9000-series-nx-os-interfaces-configuration-guide-release-106x/m_configuring_layer_2_interfaces_9x.html)
- [Layer 3 interfaces](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/interfaces/cisco-nexus-9000-series-nx-os-interfaces-configuration-guide-release-106x/m_configuring_layer_3_interfaces_9x.html)
- [Port-channels](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/interfaces/cisco-nexus-9000-series-nx-os-interfaces-configuration-guide-release-106x/m_configuring_port_channels_93x.html)
- [vPC configuration and restrictions](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/interfaces/cisco-nexus-9000-series-nx-os-interfaces-configuration-guide-release-106x/m_configuring_vpcs_9x.html)

### CML operational fidelity

Fresh NS-OS devices use short STP path costs. `spanning-tree pathcost method short|long` changes actual tree calculations and survives save/replay. Existing saved explicit long settings retain long costs. Named OSPF uses a 40 Gb/s default reference bandwidth rather than the IOS 100 Mb/s default. Route, STP, OSPF neighbor, IP interface brief, MAC, CDP/LLDP detail, clock, logging and users views use local/received runtime state; unavailable CPU, memory allocator and environmental telemetry is rejected. See [the 20-command CML audit](../audits/cml-operational-fidelity.md) for platform availability and remaining boundaries.


## CML-validated operational corrections

STP forwarding determines SVI autostate, connected-route presence and local gateway MAC presence. Blocking every usable VLAN member withdraws the SVI; recovery restores its routes. Physical link-up alone is insufficient.

`router ospf NAME` accepts `auto-cost reference-bandwidth N [Mbps|Gbps]` and `no auto-cost reference-bandwidth`. This changes advertised costs and remote SPF calculations; the default is 40,000 Mbps.

The bounded IPv4 ACL surface is packet-enforced and was validated against Nexus egress traffic:

```text
configure terminal
ip access-list LAB
 statistics per-entry
 10 deny icmp 10.10.10.0/24 host 192.0.2.9
 20 permit ip any any
 exit
interface Ethernet1/3
 no switchport
 ip access-group LAB out
end
show ip access-lists LAB
```

Configure addressing, routing and link state separately for the traffic path. Packet statistics are collected only while `statistics per-entry` is enabled. Entries require explicit sequence numbers and support `ip` or `icmp`, with `any`, `host` or IPv4 CIDR addresses. `no SEQUENCE` removes an entry; remove it before reusing its sequence. `no ip access-list LAB` deletes the list and leaves its interface reference; empty or deleted lists permit traffic. `no ip access-group LAB out` removes the matching interface reference. Save/reload and NVGEN/replay preserve the implemented ACL configuration.

Only outbound routed physical Ethernet attachment is supported. Ingress, SVI/port-channel attachment, IPv6, TCP/UDP qualifiers, logging, remarks and time ranges are rejected. Remove the physical ACL before converting its interface to a switchport or channel member. No ingress support is inferred from native command acceptance without an enforced traffic test.

`terminal monitor` and `terminal no monitor` control asynchronous remote log delivery. Console delivery is independent. Native interface detail uses actual packet/byte/error counters and rolling 30-second/300-second rates (60-second short window for SVIs); there is no fake ASIC or linecard telemetry. See [the full follow-up audit](../audits/cml-fidelity-followup.md).
