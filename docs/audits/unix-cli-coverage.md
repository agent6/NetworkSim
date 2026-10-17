# Linux and macOS client networking profiles

PC and Laptop → **Client profile** can select Windows, Linux or macOS. Windows remains the default, and Server remains Windows Server. The new targets are **Ubuntu 24.04 LTS** with iproute2/iputils/NetworkManager-style tools, and **macOS 15 Sequoia** with Darwin networking tools. These are original, bounded teaching implementations in the offline browser application. No native OS, host shell, process, network daemon or installed host networking configuration is executed or changed.

The shared console runs a simulated root networking session. Interface aliases are explicit: Linux `eth0`/`wlan0`, macOS `en0`/`en1` and Ethernet/Wi-Fi service names, mapped to the same underlying Ethernet and wireless adapters. The OS selector changes the parser, prompt and help, cancels an old streaming command, and persists in the portable lab. It does not create another topology node or require a backend.

## Supported practical operations

| Area | Linux | macOS | Actual source of results |
| --- | --- | --- | --- |
| Addresses and link | `ip address`, `ip link`, `ifconfig`; selected address add/delete and link up/down | `ifconfig`, `networksetup -getinfo/-setmanual`, interface up/down | Shared configured/operational addresses, carrier, MAC, IPv6 DAD; changes affect actual packets |
| Routes | `ip [-4|-6] route show/get/add/del` | `route [-n] get/add/delete [-inet6]`, `netstat -rn` | Actual RIB/recursive forwarding and added runtime host routes; invalid connected gateway fails before mutation |
| Neighbors | `ip [-4|-6] neigh show/flush`, `arp -a/-d` | `arp -a/-d` | Actual ARP/ND records; dynamic removal causes later traffic to resolve again |
| Echo | `ping`, `ping6`, IPv4/IPv6, count/payload/TTL/interface/timeout, selected DF | Distinct IPv4 `ping -m/-b/-W` and IPv6 `ping6 -h/-B` | Actual ICMP/ICMPv6 requests/replies, delivered TTL, measured RTT/loss and source selection |
| Streaming | Omit `-c`, then Ctrl+C | Omit `-c`, then Ctrl+C | Clock-driven real requests; cancellation stops future requests and reports observed counters |
| Trace | `traceroute -I`, `traceroute6 -I` | Same native ICMP-probe option | Actual TTL expiry/echo replies; names require delivered DNS PTR queries. Default native UDP/TCP probes explicitly reject |
| DNS | `nslookup`, `dig`, six record families, explicit server, reverse `-x`, `+short` | Same bounded BIND-compatible syntax | Shared packet-backed DNS/cache over IPv4/IPv6; real records, TTL, preference and errors |
| DHCP | `nmcli device connect eth0` | `networksetup -setdhcp Ethernet` | Real client/server request/lease; unavailable server reports failure |
| Wireless | `nmcli device status/show/wifi list/connect/disconnect` | `networksetup -getairportnetwork/-setairportnetwork/-getairportpower/-setairportpower` | Shared scan/association, actual personal authentication, DHCP and delivered traffic; wrong keys fail |

`help` lists the exact supported syntax. Unsupported options and shell pipelines/redirection reject explicitly. Quotes group arguments without shell expansion or command execution. Optional `sudo` is redundant in the explicitly simulated root session; there is no native privilege/account database.

## Native syntax and behavior boundaries

Linux `ping -W` is in seconds. macOS IPv4 `ping -W` is in milliseconds; macOS `ping6 -W` is a different native query option and is **not** accepted as a fabricated timeout switch. macOS IPv4 TTL uses `-m`; IPv6 hop limit uses `-h`. The common finite/continuous echo implementation sends actual family-appropriate packet sizes. Linux/macOS host replies originate at hop limit 64; a routed delivery decrements that value. Windows defaults remain separate.

Only one primary IPv4 address is modeled for these commands. Static address edits are stored as portable-lab device configuration; they do not emulate Linux boot scripts or Darwin kernel/preferences synchronization. Added `ip route`/`route` entries are runtime-only and clear on project load/restart. Route deletion is limited to the modeled user-added runtime routes, rather than silently changing connected routes or external native routing tables. The host has one shared DNS list, not independent per-service resolver scopes. Wireless command connections cover open/personal networks; enterprise identity is configured in the existing adapter form. No native WPA cryptographic or RF interoperability is asserted.

The output is a bounded native-shaped view of actual state. It omits native process/kernel statistics that the simulator does not have, and does not fabricate query IDs, DNS flags, socket/process tables, NetworkManager UUIDs or complete native packet captures. No golden native Ubuntu/macOS transcript has been captured; the profile labels identify reference targets, not execution of those systems.

## Evidence

`tests/unix-cli.test.ts` **UNIX-01–11** exercises packet-backed IPv4/IPv6 echo, actual routed route add/delete, link failure/recovery, dynamic neighbor removal, IPv6 DAD, DNS/AAAA/PTR over IPv6, finite/continuous ping cancellation, native flag differences, profile changes/save/load/invalid values, DHCP success/timeouts and failed/corrected Wi-Fi passwords carrying actual routed packets. They test the declared cases, not every argument combination.

[unix-command-inventory.json](unix-command-inventory.json) declares **43 syntax variants: Linux 23, macOS 20**, with exact parser locations/hashes, tests, packet effects, persistence and limits. This is separate from IOS registration and Windows variant counts. The parent acceptance run and browser artifacts supply execution/build identities; the inventory generator itself does not execute the tests.

Primary references reviewed: [Ubuntu 24.04 `ip`](https://manpages.ubuntu.com/manpages/noble/en/man8/ip.8.html), [Ubuntu 24.04 `ping`](https://manpages.ubuntu.com/manpages/noble/en/man8/ping.8.html), [NetworkManager nmcli manual](https://networkmanager.dev/docs/api/latest/nmcli.html), [ISC BIND command manual](https://bind9.readthedocs.io/en/v9.20.0/manpages.html), and locally installed Apple `ifconfig(8)`, `ping(8)`, `ping6(8)`, `route(8)`, `traceroute(8)`, `traceroute6(8)` and `networksetup(8)` documentation. Their exact local hashes are retained in the inventory; these local manuals are grammar evidence and are not a captured macOS 15 execution fixture. Apple publishes the underlying tool documentation in its [network_cmds source distribution](https://github.com/apple-oss-distributions/network_cmds). No external implementation was copied.
