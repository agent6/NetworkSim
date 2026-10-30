# DHCP fallback and IPv4 link-local addressing

DHCP-enabled Windows PCs, laptops and servers use APIPA when they cannot obtain a lease. macOS PCs and laptops use the equivalent IPv4 link-local fallback. The current Linux profile has no implicit fallback; phones, printer/IoT profiles, routers, switches, APs and WLCs remain outside this behavior. Static addresses and unexpired DHCP leases are preserved.

An operational link is required. After DHCP fails, the client selects an address from `169.254.1.0` through `169.254.254.255` with mask `255.255.0.0`. It sends three real ARP probes before assignment and two announcements afterward. A conflicting owner on the same VLAN causes reselection. Active addresses are defended, with repeated conflicts causing a new claim. Separate VLANs can independently use the same candidate.

Fallback supplies no default gateway or DHCP DNS options. Existing static DNS settings remain intact. Hosts can exchange packets on their local link; IPv4 link-local source/destination traffic cannot pass through a router, and routers do not proxy ARP for another link's link-local addresses.

DHCP retries continue while fallback is active. A delivered, checked DHCP ACK replaces the self-assigned address with the lease and its options. Repairing a server or DHCP-snooping trust does not leave an explicit renew attached to an unanswered old discovery. Simulator DHCP attempts and retries use its existing accelerated lab times; they do not reproduce every OS-specific backoff interval.

`ipconfig` identifies an **Autoconfiguration IPv4 Address**; `/all` reports autoconfiguration availability without presenting a stale DHCP server as a current lease. macOS network commands show the assigned address. Wi-Fi remains associated and reports self-assigned, local-link-only connectivity. IP configuration dialogs refresh their read-only automatic IPv4 fields and explain fallback.

Release suppresses reacquisition until a new request, while static configuration cancels fallback and pending probes. Media loss removes the active claim. Reconnection can reacquire an address, and saved DHCP labs probe again after loading instead of treating an old fallback address as static configuration.

## References

- [Microsoft: Automatic TCP/IP addressing without a DHCP server](https://learn.microsoft.com/en-us/windows-server/troubleshoot/how-to-use-automatic-tcpip-addressing-without-a-dh)
- [RFC 3927: IPv4 link-local selection, ARP claim/defense and scope](https://datatracker.ietf.org/doc/html/rfc3927)
- [NetworkManager IPv4 settings: link-local behavior depends on the configured method/profile](https://www.networkmanager.dev/docs/api/latest/settings-ipv4.html)
