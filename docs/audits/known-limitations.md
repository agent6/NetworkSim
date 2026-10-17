# Known limitations and unfinished audit work

The requested complete CCNA/ENCOR/ENARSI fidelity audit is **not complete**. The simulator is substantially more functional, but it must not be described as full IOS, full Windows, complete Cisco Web GUI or guaranteed exam/Simlet coverage.

## Verification still required

- The generated command inventory covers discovered registrations/contexts, not every valid/invalid argument, abbreviation, `no`/default form, side effect or eight-level reference comparison. Untested rows remain visible.
- Official reference command headings are automatically indexed as candidates. Generic parser-prefix matches do not establish support. Full router and wireless release-specific catalogs and objective-specific required-option reconciliation remain unfinished.
- No real IOS XE 17.12/CML or native Windows reference was available. Packet Tracer observation is genuine but narrow and reports an older IOS version. No fabricated golden fixtures fill that gap.
- Every numbered blueprint objective is indexed, including CCNA 2.0 effective in 2027. No objective is promoted to fully verified solely from test pointers or static examples.
- Source changes in this checkout were untracked before this audit. Work is grouped by subsystem and evidence files; no unrelated checkout reset or blanket commit was made.

## Functional scope still partial or absent

- STP/LACP/DTP/VTP and parts of OSPF/EIGRP/multicast use computed state rather than complete received-message state machines. OSPF area/LSA type adapters, complete DUAL/RTP/UPDATE behavior, VTPv3 primary/pruning and full BGP event/wire catalog remain unfinished.
- Ethernet covers copper negotiation and traffic-driven duplex errors. Calibrated cable/fiber distance, pinout, signal/optics and PHY fault injection are absent; half-duplex arbitration omits collision backoff. CAM/TCAM capacity is not reproduced.
- Output queues now schedule real traffic. Full hierarchy, WRED, per-flow fair queueing and hardware ASIC queues remain unsupported; exact platform-specific error/counter parity is incomplete.
- IPv6 FHRP, full DMVPN phase 3, MPLS/VPN SAFIs, full multicast/MLD, arbitrary route-policy expressions, real crypto/PKI and vendor hardware resources are absent or partial.
- WLC has five implemented controller pages, not the full Cisco GUI. Missing relevant management/security/monitoring workflows include GUI AAA/certificates/SNMP/NTP/syslog, wireless ACL/QoS, AP authorization/images, exclusion/CoA, mobility groups and controller failover. Default-policy-tag mapping differs.
- Wireless models lightweight WPA2 and logical security. Autonomous APs, WPA3/SAE, real EAP-TLS/PEAP/AES/DTLS, 6 GHz/DFS/regulatory behavior, RF contention/retries and fast/inter-controller roaming remain unsupported.
- AP power is exclusively PoE as requested. Only the full 30 W class-4 AP profile exists; 802.3af reduced mode, 802.3bt, non-AP PDs, physical classification/LLDP power negotiation and electrical fault recovery are absent.
- Windows is a networking subset. NetBIOS/NetBT/WINS, complete `nbtstat`, OS processes/registry/PowerShell and some adapter/route/IPv6 options are unsupported. Source inventory details each partial variant.
- DNS is authoritative service plus resolver cache, not a complete recursive resolver/zone server. Server management uses the explicit NetworkSim GUI, not invented Windows commands.
- SNMP is read-only logical v2c/v3. BER/USM cryptography, GetBulk, writable MIB, informs/v3 notifications and full MIB/index/transport behavior remain unsupported. Notification counters represent submission/delivery at their respective endpoints, not acknowledged trap delivery.
- SSH/TLS/IPsec/SNMPv3 security are logical teaching models. IOS SCP transfers use actual simulated TCP but not interoperable encrypted file protocols. Files are bounded text; no firmware execution.
- **User-approved exclusion, October 16, 2026:** keep the recent removal of server TFTP and SCP/SFTP services, their administration pages and the desktop File Transfer tool. Server listeners stay disabled even when an older lab contains enabled settings; retained file dictionaries are not deleted. IOS SCP and other retained protocol APIs are separate bounded capabilities. This supersedes the original brief's requirement to preserve those server services.
- NETCONF/RESTCONF cover a narrow interfaces/hostname datastore and defined RPCs; general YANG schemas, NETCONF1.1, subscriptions and real SSH/TLS interoperability are absent.
- NTP/PTP, accounting, hardware boot/redundancy and protocol compatibility knobs have explicit bounds. PTP election does not synchronize clocks; SSO, real boot images, serial signaling and some retained options are configuration-only. Consult `show capabilities` and subsystem reports.

Further work should prioritize the per-command evidence matrix, full received control-plane state machines, complete WLC workflows, physical troubleshooting media, outstanding exam practical objectives and actual selected-release reference fixtures. Preserve the completed behavioral regressions while closing those gaps.
