# Single-hub DMVPN

NetworkSim implements IPv4 single-hub DMVPN Phase 2 and Phase 3 inside the offline simulator: GRE/mGRE, NHRP registration and resolution, dynamic routing neighbors, modeled IPsec profiles, and direct spoke-to-spoke forwarding. No server, external network, Cisco image or account is needed.

**IPsec is a teaching model, not encryption.** IKEv1 policy, PSK, transform, key-length, mode and PFS compatibility determine whether logical SAs establish. Traffic remains inspectable. Use invented credentials.

## Ready-to-import labs

Open the standalone `index.html`, select **Import lab**, and choose either:

- [Protected Phase 2](../../examples/dmvpn/single-hub-phase2.netsim.yaml)
- [Protected Phase 3](../../examples/dmvpn/single-hub-phase3.netsim.yaml)

Both contain one hub, three spokes and a routed ISP. Startup configurations are saved, so simulated power cycles retain the setup. Runtime neighbors, caches and SAs rebuild after import; allow about ten simulated seconds for EIGRP convergence.

| Device | WAN address /30 | ISP gateway | Tunnel address /24 | Loopback LAN /24 |
|---|---|---|---|---|
| HUB | 198.51.100.2 | 198.51.100.1 | 10.10.10.1 | 172.16.1.1 |
| SPOKE1 | 192.0.2.2 | 192.0.2.1 | 10.10.10.2 | 172.16.2.1 |
| SPOKE2 | 203.0.113.2 | 203.0.113.1 | 10.10.10.3 | 172.16.3.1 |
| SPOKE3 | 198.19.0.2 | 198.19.0.1 | 10.10.10.4 | 172.16.4.1 |

The ISP has only connected WAN routes. Each overlay router has one underlay default route. Remote LAN routes come from EIGRP, not hand-installed overlay statics.

On SPOKE1:

```text
enable
ping 172.16.3.1 source 172.16.2.1 repeat 5
show dmvpn detail
show ip nhrp
show ip nhrp nhs detail
show ip nhrp traffic
show ip eigrp neighbors
show ip route 172.16.3.1
show ip cef 172.16.3.1
show ip cef exact-route 172.16.2.1 172.16.3.1
show crypto isakmp sa
show crypto ipsec sa
show crypto sockets
show crypto ipsec profile DM-IPSEC
```

In Phase 2 the learned EIGRP route already has the destination spoke's tunnel next hop. NHRP resolves its NBMA address and GRE/ESP carries packets directly.

In Phase 3 the EIGRP route retains the **hub** next hop. Initial traffic traverses the hub, which sends an NHRP redirect. The source requests resolution through the hub; the destination spoke replies directly. An actual prefix-aware forwarding override then bypasses the hub. `show ip route` marks the route with `%` and describes its override; `show ip cef` shows the destination spoke. This does not create a fake static route. A hub summary can remain in the RIB while a more-specific destination LAN shortcut appears in CEF.

The **Packets** view exposes NHRP registration, resolution, redirects, shortcut installation and ESP encapsulation/decapsulation. For warmed spoke traffic, the ISP still forwards WAN packets, but the hub no longer forwards the inner LAN payload.

## Configuration pattern

Configure working WAN addressing/default routes and the local LAN first. The shared modeled protection configuration is:

```text
crypto isakmp policy 10
 encryption aes 256
 hash sha
 authentication pre-share
 group 14
crypto isakmp key dmvpn-lab address 0.0.0.0
crypto ipsec transform-set DM-TS esp-aes 256 esp-sha-hmac
 mode transport
crypto ipsec profile DM-IPSEC
 set transform-set DM-TS
 set pfs group14
 set security-association lifetime seconds 60
```

The wildcard PSK is convenient only for an invented-credential learning lab. The short 60-second IPsec lifetime makes expiry and traffic-triggered replacement observable.

Phase 3 hub:

```text
interface Tunnel0
 ip address 10.10.10.1 255.255.255.0
 ip mtu 1400
 tunnel source GigabitEthernet0/0
 tunnel mode gre multipoint
 tunnel key 123
 ip nhrp network-id 100
 ip nhrp authentication lesson
 ip nhrp holdtime 30
 ip nhrp map multicast dynamic
 ip nhrp redirect
 no ip split-horizon eigrp 100
 tunnel protection ipsec profile DM-IPSEC
 no shutdown
router eigrp 100
 network 10.10.10.0 0.0.0.255
 network 172.16.1.0 0.0.0.255
```

Phase 3 SPOKE1:

```text
interface Tunnel0
 ip address 10.10.10.2 255.255.255.0
 ip mtu 1400
 tunnel source GigabitEthernet0/0
 tunnel mode gre multipoint
 tunnel key 123
 ip nhrp network-id 101
 ip nhrp authentication lesson
 ip nhrp holdtime 30
 ip nhrp nhs 10.10.10.1 nbma 198.51.100.2
 ip nhrp map multicast 198.51.100.2
 ip nhrp shortcut
 tunnel protection ipsec profile DM-IPSEC
 no shutdown
router eigrp 100
 network 10.10.10.0 0.0.0.255
 network 172.16.2.0 0.0.0.255
```

Other spokes change their local WAN, tunnel and LAN addresses, not the hub configuration. NHRP network IDs are **locally significant**; the examples deliberately use different IDs. GRE keys, NHRP authentication and IPsec PSKs are independent checks.

For **Phase 2**, omit hub `ip nhrp redirect` and spoke `ip nhrp shortcut`, and configure **`no ip next-hop-self eigrp 100` on the hub tunnel**. Split horizon must still be disabled on that hub interface. For Phase 3, leave next-hop-self enabled.

A separate NHS mapping is also supported:

```text
ip nhrp map 10.10.10.1 198.51.100.2
ip nhrp nhs 10.10.10.1
```

Without either an inline NBMA or a static mapping, `show ip nhrp nhs detail` reports an incomplete/down server rather than inventing registration.

Loopback NBMA sources and a front-door `tunnel vrf WAN` are supported when the source and independent WAN route exist in that VRF. This does not move the overlay into that VRF. The regression suite also exercises protected OSPF **point-to-multipoint with Phase 3**, using its default 30-second Hello interval; allow longer convergence than EIGRP.

## Failure and recovery exercises

Change one spoke's NHRP authentication, GRE key, PSK, PFS group or transform mode. Observe registration/routing failure on that peer without forcing the entire hub mGRE interface down. Wrong PSKs cannot create successful registrations, and a protected receiver rejects plaintext GRE, including NHRP.

Remove the hub multicast mapping to interrupt routing discovery independently of unicast NHRP. Apply WAN packet loss or an ACL blackhole to observe registration retries, hold expiry and routing loss. Restore compatibility or reachability to recover.

```text
debug nhrp packet
debug nhrp error
clear ip nhrp interface Tunnel0
clear ip nhrp 10.10.10.3
clear crypto ipsec sa peer 203.0.113.2
clear crypto isakmp sa peer 203.0.113.2
undebug all
write memory
```

NHRP clear preserves configured static mappings. Peer-scoped crypto clears leave other peers untouched; clearing IKE does not automatically delete IPsec SAs and vice versa. Used dynamic mappings refresh; idle mappings/shortcuts expire and Phase 3 falls back to the hub. Changed registrations purge old spoke mappings/shortcuts. Pending packets are bounded to 64 per unresolved next hop, recheck current routes before release, and are cancelled when their owning tunnel/runtime/NHRP generation changes.

Registration refresh defaults to the configured holdtime divided by three; `ip nhrp registration timeout N` overrides that interval. Registration and resolution use bounded retries with 1/2/4/8/16/32-second delays. Failed NHS registrations retry again after a bounded recovery delay.

## Supported boundary and evidence

The verified target is **IPv4 single-hub Phase 2/3**, dynamic EIGRP neighbors and direct GRE or modeled ESP data paths; protected OSPF point-to-multipoint Phase 3 is covered separately. A spoke-to-spoke data SA does not require a full mesh of routing adjacencies.

NHRP/GRE/IKE/ESP use inspectable structured records, not interoperable binary packets. This is not complete RFC/vendor FSM emulation. IKEv2, NAT-T/PAT traversal, certificates/PKI, IPv6 DMVPN, multiple hubs/clouds, NHS clustering and native cryptography are outside this implementation. IPsec replacement is traffic-triggered, not a complete independent IKE/IPsec soft-rekey/DPD engine.

`tests/dmvpn.test.ts` covers protected/plain Phase 2/3, dynamic join, OSPF, failure isolation, loopback/VRF endpoints, idle/active expiry, NBMA changes, loss/recovery, queue bounds/cancellation, clear scoping, summary-prefix forwarding, read-only verification, legacy configuration, rendered replay, YAML/JSON/startup/reload and transactional malformed-import rejection. Regenerate the two example files with Node 24.15+:

```text
node scripts/generate-dmvpn-examples.mjs
```

Primary behavior references: [Cisco DMVPN configuration](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_conn_dmvpn/configuration/15-s/sec-conn-dmvpn-15-s-book/sec-conn-dmvpn.html), [Cisco NHRP configuration and verification](https://www.cisco.com/c/en/us/td/docs/routers/ios-xe/ip-addressing/ip-addressing/m_config-nhrp-0.html), and [Cisco Phase 3 redirect/shortcut example](https://www.cisco.com/c/en/us/support/docs/security/dynamic-multipoint-vpn-dmvpn/222585-configure-bgp-over-dmvpn-phase-3.html). These are documentation references, not certification against a live IOS image.
