# NetworkSim fidelity implementation progress

Audit started October 16, 2026. **The complete requested CCNA/ENCOR/ENARSI audit remains unfinished.** Continue this ledger across contexts. Parser discovery, test-name matches and a passing suite do not establish full Cisco/Windows equivalence.

## Baseline and authority

- Baseline: 517/517 tests, typecheck and offline build passed; `.cache/fidelity-baseline.log`. Latest combined results are generated from the actual log in [validation report](final-validation-report.md).
- References: current CCNA 1.1; published CCNA 2.0 effective February 3, 2027; ENCOR 1.2; ENARSI 1.1. All 284 numbered parent/child rows are indexed. Describe-only competencies remain distinct from practical requirements. The newer ENCOR removed its older wireless domain; user-requested wireless remains application scope.
- Targets: ISR4331/IOS XE17.12; Catalyst9300/17.12 for three switch kinds; Catalyst9800/17.12; lightweight Catalyst9115; Windows11 24H2 / Server2025 networking subsets. These are compatibility targets, not executed vendor firmware/operating systems.
- Requirements: nine nodes, original implementation, Tailwind, matching icons, double-click offline HTML, no backend and PoE-only AP power.
- **User-approved exclusion, October16:** retain the recent removal of server TFTP and SCP/SFTP services, their administration pages and the desktop File Transfer tool. Old file dictionaries remain; server listeners are disabled on load/reload and reject requests. IOS SCP is separate. This supersedes the original brief's preserve-services requirement for those services.
- The original `network-sandbox` was temporarily moved and is now restored; its 492 JavaScript hashes match the saved reference manifest. Use it read-only; never ship its code in the new app.
- The checkout was already untracked. Do not reset or blanket-commit concurrent/shared work. Concurrent AP/controller displays, WLC reference dropdowns and server service removals are preserved. No immutable pre-audit source diff exists.

## Bounded repairs implemented

| Group | Actual behavior and evidence | Remaining scope |
| --- | --- | --- |
| Windows | Shared PC/Laptop/Server parser; actual ICMP/trace/path samples, DHCP, DNS/cache, ARP/routes, sockets, adapter/WLAN state; browser continuous ping/Ctrl+C and CLS | Native outputs and many OS options absent; NetBIOS/OS administration excluded |
| Server GUI/services | Transactional DHCP/typed DNS, received Syslog metadata, live lease lookup, actual AAA receiver log | Explicit NetworkSim GUI; no complete Windows Server or recursive DNS |
| MAC/VTP | Zero/global/per-VLAN aging changes expiry; static exemption. Fresh Catalyst server/v1, client/extended-VLAN constraints and correct revisions | VTPv3/pruning and full vendor error parity remain partial |
| Wired policies | Physical bridge/SVI QoS precedence, routed control policies, routing ACL consumers affect traffic/counters | Full match/set/platform catalog still open |
| Queues | Real class queues, byte-weighted bandwidth, congestion LLQ, average shaping, tail drops and timing | Physical output subset; no WRED/fair-queue/full hierarchy/ASIC queues |
| Ethernet/bundles | Carrier/speed/duplex negotiation and real mismatch errors/loss; routed VRF/ARP, immediate connected routes and recovery | No PHY/fiber/cable fault model or complete LACP PDU state machine |
| BGP | Persistent TCP IPv4/IPv6 AF, family policy/withdrawals, VRF-Lite, BFD and actual ECMP/IGP-cost selection | Logical encoding and incomplete full event/catalog matrix |
| EIGRP | Classic/named IPv4 auto-summary, conditional AD5 Null0/minimum metric, external-route exception, no/default, replay/reload and actual traffic | UPDATE and external numerical seed propagation remain computed; full DUAL/RTP/overlap uncertified |
| PoE/AP | Actual priority/detection-order budget allocation; supply-preserving software reload with fresh DHCP/CAPWAP | Single full-power 30W class4 AP profile; no electrical negotiation/fault model |
| Wireless/WLC | Flex standalone, tag/profile dependencies, RF validation, nondestructive Apply, real counters, delivered RADIUS failover and CAPWAP loss detection | Full Cisco GUI, autonomous AP, WPA3, crypto and advanced roaming absent |
| SNMP | UDP161 GET/GETNEXT, ACL/views/v3 identity, real MIB/counters; actual link/restart/auth notifications over UDP162 | Read-only logical subset; no BER/USM crypto/GetBulk/informs/full MIB |
| IOS SCP | Real segmented TCP22, credentials/VTY/EXEC privilege, text files, persistence and literal names | No encrypted wire interoperability; server services deliberately excluded |
| Model management | TCP830 RPC / HTTPS datastore updates, candidate/locks/commit/discard/confirmed rollback and real monitoring | Limited interface/hostname YANG; no general schemas/NETCONF1.1/real SSH/TLS |
| AAA accounting | RADIUS EXEC / TACACS EXEC and command records; ACK/reject/timeout/fallback, receiver GUI, redaction and VTY Stop lifecycle | RADIUS command accounting rejects; console/connection/network/system remain configured-only |
| Persistence/maps | Literal user/file/SNMP/wireless names through packet paths/save/load; strict speedAuto validation | Audited dictionary paths only |

Causes, references and tests are in [wired findings](wired-fidelity-findings.json), [wireless findings](wireless-fidelity-findings.json), [Windows audit](windows-cli-coverage.md), [SNMP audit](snmp-fidelity.md), [accounting audit](aaa-accounting-fidelity.md) and [model management coverage](model-driven-management-coverage.json).

## Audit status

- Repository discovery covers every source/import/export, six IOS node registries across 83 contexts and three Windows profiles. Keep context failures; regenerate hashes after product edits.
- All 18 pinned Catalyst command-book chapters are indexed. Headings/prefix matches are candidates; complete router/WLC catalog and objective argument reconciliation remain open.
- Current wireless editable templates, including every current WLC field, are inventoried. New dropdown references, implicit default authentication and received-controller AP views have focused checks; full per-field eight-level reference fidelity remains open.
- Standalone disk launch passed Windows and wireless/PoE/packet-inspector workflows in isolated profiles. Model management, AAA and live service lease workflows have separate browser evidence. Never reset the user's browser labs.
- REA captured genuine Packet Tracer ISR4331 observations and binary identity. Its IOS16.6.4 behavior is secondary to the selected17.12 profile. No real IOSXE17.12/CML or native Windows environment was available; do not fabricate goldens.

## Remaining priorities and resume procedure

1. Reconcile fresh restored-sandbox positive/no/default probes, exact setup and selected-platform applicability. Parser agreement is not runtime parity.
2. Finish per-command argument/help/error/default/negation and configuration-to-packet traces. Extend bounded evidence through all required validation levels. Untested rows remain untested.
3. Complete router/WLC reference catalogs and practical objective reconciliation. Each missing practical capability needs implementation or an agreed exclusion; lexical matches cannot certify an exam.
4. Continue required received-message state machines: STP/LACP/DTP/VTP, OSPF area/LSA adapters, EIGRP UPDATE/RTP/DUAL, policy corners and physical troubleshooting.
5. Finish relevant WLC management/security/monitoring workflows and outstanding Windows networking options. Add genuine selected-release fixtures if an authorized reference becomes available.

Read this ledger, [machine summary](audit-summary.json), current findings, old/current probe validation and `.cache/fidelity/*` logs. Reuse completed work. Hold shared source while taking a final snapshot; run `npm run check`, regenerate inventories, validate hashes and refresh the checkpoint. Do not restart discovery or certify completion solely from a green suite. Group exact paths and hashes by subsystem; preserve unrelated concurrent edits.
