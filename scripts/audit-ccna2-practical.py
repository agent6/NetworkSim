#!/usr/bin/env python3
"""Reviewed practical-workflow index; never equate a test pointer with exam parity."""
import hashlib,json,re
from pathlib import Path

# Original workflow summaries. Selectors refer to assertions inspected during this audit.
rows=[]
def add(id,workflow,tests,limits,scope='direct-and-composed-invariants'):
 rows.append(dict(id=id,workflow=workflow,evidenceSelectors=tests,remainingBoundary=limits,evidenceScope=scope))

add('1.1','Create copper/fiber medium faults, observe carrier/counters and restore real packets.',[
 ('link-medium','cable open/short/miswire'),('link-medium','signal corruption'),('ethernet-physical','duplex mismatch causes actual')],
 'Distance/category/media compatibility and logical BER are modeled; calibrated optical dBm/DOM, optical transceiver inventory and analog pin measurements are not.')
add('1.3','Change IPv4 host/router addressing, subnet or gateway and diagnose real reachability.',[
 ('windows-cli','WIN-12'),('windows-cli','WIN-22'),('core','IP parsing validates contiguous')],
 'Native OS and every IOS address option are not reproduced; public/private addresses use the same simulated forwarding rules.')
add('1.4','Configure static, EUI-64, link-local and dynamic IPv6 addresses; diagnose DAD/prefix/route faults.',[
 ('cli','manual link-local and EUI-64'),('reference-closure','static IPv6 DAD'),('windows-cli','WIN-24')],
 'Bounded IPv6 address/route implementations; complete native stack and all prefix-sizing exercises have not been reference-verified.')
add('1.6','Use Windows, Linux and macOS teaching terminals to diagnose wired/WLAN IP, DNS and security.',[
 ('windows-cli','WIN-14'),('unix-cli','UNIX-01'),('unix-cli','UNIX-02'),('unix-cli','UNIX-06'),('unix-cli','UNIX-09')],
 'These terminals project actual simulator state, not native OS execution. Enterprise supplicant provisioning and every platform flag are not implemented.')
add('1.7','Configure IOS DHCP pool/client/relay, obtain a delivered lease and diagnose failed or expired leases.',[
 ('cli','DHCP CLI configuration drives'),('core','DHCP relay reaches'),('reference-closure','router DHCP installs'),('core','DHCPv4 T1 renewal')],
 'Bounded DHCP messages/options, exclusions, relay and lease timers; not every IOS server/relay option.')
add('2.1.a','Configure switched or routed physical interfaces; incorrect carrier/speed/duplex prevents real traffic.',[
 ('ethernet-physical','fixed Ethernet speed mismatch'),('wired-fidelity','L2, L3 and PoE switch physical')],
 'Modeled device/port capabilities only; hardware-specific interface types and counters differ.')
add('2.1.b','Configure access/trunk/native/allowed VLAN attributes and inspect real tagged forwarding/pruning.',[
 ('cli','interface ranges, VLAN creation'),('switching-compat','voice VLAN carries tagged'),('remote-span','RSPAN traverses')],
 'VLAN forwarding is executable; complete per-platform negotiation and exact native show formatting remain bounded.')
add('2.1.c','Form L2 and routed LACP bundles, carry real flows, and observe member loss/eligibility.',[
 ('control-plane','LACP active/passive'),('core','switched EtherChannel hashes'),('core','routed EtherChannel applies'),('wired-fidelity','routed LACP peers may')],
 'LACP is packet-driven with bounded member/hash behavior; full hardware hashing and all channel options are not modeled.')
add('2.1.d','Configure a switch SVI and use its actual autostate, routed traffic and management reachability.',[
 ('cli','interface ranges, VLAN creation'),('switching-compat','voice VLAN carries tagged'),('wired-fidelity','Catalyst physical marking'),('snmp','SNMP-11')],
 'Direct SVI assertions are required here; generic routing candidates in the broad semantic matrix do not by themselves establish this workflow.')
add('2.2.a','Connect desktop, printer and IoT role endpoints on configured access ports and enforce actual PoE supply.',[
 ('endpoint','ENDPOINT-01'),('endpoint','ENDPOINT-11')],
 'Printer/IoT roles reuse host IP/service traffic and class3 power. Native printing protocols, sensors and every appliance OS are outside this connectivity exercise.')
add('2.2.b','Connect PoE-only lightweight or explicit generic standalone APs; configure VLAN/SSID security and carry real client traffic.',[
 ('standalone-ap','SAP-01'),('standalone-ap','SAP-02'),('standalone-ap','SAP-07'),('standalone-ap','SAP-08'),('poe','PoE powered APs join'),('wlc-administration','WADM-10')],
 'Generic standalone is distinct from C9115 lightweight firmware. Shared radio/auth/bridge behavior is bounded; full autonomous IOS BVI/subinterface/image features are not claimed.')
add('2.2.c','Receive CDP/LLDP-MED voice policy, obtain voice-VLAN DHCP and carry tagged traffic while PoE controls service.',[
 ('endpoint','ENDPOINT-02'),('endpoint','ENDPOINT-04'),('endpoint','ENDPOINT-09'),('endpoint','ENDPOINT-12'),('endpoint','ENDPOINT-14'),('phone','PHONE-03'),('phone','PHONE-05'),('phone-audit','PHONE-AUDIT-01'),('phone-audit','PHONE-AUDIT-03'),('phone-audit','PHONE-AUDIT-04')],
 'Received voice policy/VLAN/COS/DSCP and electrical state are functional. Call registration/media/signaling and a real handset OS are separate from edge-port configuration.')
add('2.2.d','Exercise a virtualized-host attachment with trunk VLANs and LACP-capable endpoint abstractions.',[
 ('core','VLAN switching learns'),('core','switched EtherChannel hashes'),('wired-fidelity','routed LACP peers may')],
 'Switch-side trunk/LACP and forwarding are real. The peer is a modeled host/router/switch endpoint, not a hypervisor, virtual switch product or guest/container runtime.',
 'composed-network-side-workflow-with-external-peer-substitute')
add('2.2.e','Exercise a network-appliance attachment using access/trunk/routed and LACP-capable modeled peers.',[
 ('core','VLAN switching learns'),('core','routed EtherChannel applies'),('wired-fidelity','routed LACP peers may')],
 'Network-side connectivity is executable. An external appliance OS and every vendor-specific appliance service are not supplied.',
 'composed-network-side-workflow-with-external-peer-substitute')
add('2.3','Compare delivered CDP/LLDP neighbors, ports, addresses and expiry with the actual topology.',[
 ('discovery','CDP and LLDP'),('ethernet-physical','CDP reports received duplex')],
 'Documentation accuracy is a learner comparison, not an automatic truth oracle. Only implemented TLVs and physical-hop semantics are represented.')
add('2.4','Diagnose actual forwarding/operational faults with native shows/logs, interactive extended ping, traceroute and packet inspection.',[
 ('cli','interactive extended ping'),('core','traceroute reports routed'),('core','packet inspector exposes'),('core','logging independently controls')],
 'Only implemented diagnostic commands/options and logical packets are available; exact hardware output and binary PCAP interoperability are not implied.')
add('2.5.a','Configure Rapid-PVST bridge/port priority/cost and inspect elected roots/root ports after topology changes.',[
 ('control-plane','rapid spanning tree blocks'),('switching-compat','per-tree port costs'),('control-plane-cli','IOS root guard and LACP')],
 'Root election/path invariants are direct; every root-primary/root-secondary macro/default combination is not separately fixture-verified.')
add('2.5.b','Inspect real root/designated/alternate state transitions and failover behavior.',[
 ('control-plane','rapid spanning tree blocks'),('switching-compat','shared STP links')],
 'Packet-driven logical bridge trees and timers; complete ASIC convergence/counter fidelity is not claimed.')
add('2.5.c','Apply edge PortFast defaults/overrides and verify timing and bridge-peer protection.',[
 ('control-plane','classic PVST observes'),('switching-compat','global PortFast applies')],
 'Existing access/trunk edge modes are bounded by the selected switching profile.')
add('2.5.d','Cause superior or missing BPDUs and validate root/loop/BPDU guard blocking and recovery.',[
 ('control-plane','BPDU guard prevents'),('control-plane','STP root guard rejects'),('control-plane','STP loop guard blocks')],
 'Guard actions depend on actual delivered messages; not every recovery/configuration permutation has a native reference comparison.')
add('3.2.a','Configure IPv4/IPv6 default routes and diagnose gateway/interface/return-path faults.',[
 ('exam-routing-practicals','PRACTICAL-STATIC6'),('reference-closure','router DHCP installs'),('windows-cli','WIN-10'),('windows-cli','WIN-24'),('route-resolver','secondary IPv4 and IPv6')],
 'Direct native IOS IPv6 ::/0 assertions select the real default next hop and delivered UDP receiver. Every family/platform route option is not separately reference-verified.')
add('3.2.b','Configure network-prefix routes, follow recursive next hops and recover from unusable egress.',[
 ('exam-routing-practicals','PRACTICAL-STATIC6'),('route-resolver','cyclic recursion terminates'),('core','routing requires a usable'),('windows-cli','WIN-24')],
 'Shared IPv4/IPv6 resolver and packet paths are executable; every family and recursive syntax permutation is not separately verified.')
add('3.2.c','Configure specific host routes and inspect longest-prefix/CEF resolution independently of covering prefixes.',[
 ('exam-routing-practicals','PRACTICAL-STATIC6'),('core','GRE carries routed'),('ios-show','CEF shows all resolved'),('windows-cli','WIN-24')],
 'Direct IPv6 /128 overrides a covering /64 and selects the actual receiver; removing it restores covering-prefix selection. All native show/grammar variants are not certified.')
add('3.2.d','Use administrative distance and egress eligibility to select a floating route after primary failure.',[
 ('exam-routing-practicals','PRACTICAL-STATIC6'),('reference-closure','operational RIB selects floating'),('cli','static route parsing is atomic')],
 'Direct IPv4 and IPv6 fixtures now establish failover; IPv6 additionally verifies real UDP next hop and saved/portable recovery. Every tracking/permanent/VRF variant remains bounded.')
add('3.3.a','Configure OSPFv2/v3 and require delivered Hello/database exchange before adjacency/routes/real packets.',[
 ('ospf-packets','OSPF databases and Full'),('control-plane','OSPF enforces area'),('control-plane','OSPFv3 establishes'),('ospf-control-plane','OSPF CP installs')],
 'Authentication is explicitly excluded by this objective and is not counted as required AAA evidence. Logical OSPF messages/LSAs are bounded.')
add('3.3.b','Configure OSPF point-to-point network mode and use the common delivered neighbor/LSDB engine.',[
 ('exam-routing-practicals','PRACTICAL-P2P'),('ospf-packets','OSPF databases and Full'),('control-plane','OSPFv3 establishes')],
 'Parameterized native OSPFv2/v3 point-to-point cases now assert received FULL/P2P state, real echo, Hello-loss withdrawal/recovery and saved reload. Complete native output/platform options are not certified.')
add('3.3.c','Observe broadcast DR/BDR/DROTHER election and actual route/adjacency consequences of priorities/failure.',[
 ('control-plane','OSPF broadcast election'),('cli','OSPF interface show exposes')],
 'Direct broadcast election assertions; complete native interface/neighbor output is not certified.')
add('3.3.d','Set router IDs in OSPFv2/v3 and observe received IDs in neighbor/LSDB/role output.',[
 ('cli','protocol configuration and output'),('control-plane','OSPFv3 establishes'),('ios-show','OSPF views use received router IDs')],
 'Configured and received IDs are functional; every auto-selection/clear-process lifecycle variant is not covered by these selectors.')
add('4.1','Configure local users and delivered RADIUS/TACACS management login, authorization, fallback and access restrictions.',[
 ('management','SSH authenticates over actual TCP'),('management','RADIUS and TACACS authentication'),('management','AAA EXEC authorization'),('wlc-administration','WADM-12')],
 'Logical TCP/SSH/AAA exchanges and actual command privilege are modeled. Full native cryptography, accounting and every AAA scheme remain outside the bounded subset.')
add('4.2','Copy actual configuration/software file content over packet-backed SCP or SFTP and enforce credentials/ACL/listener policy.',[
 ('ssh-files','FILE-01'),('ssh-files','FILE-02'),('ssh-files','FILE-04'),('ssh-files','FILE-05')],
 'IOS-to-IOS SCP is functional; SFTP uses an eligible non-IOS test endpoint, not an IOS SFTP server. User-excluded Server TFTP/SCP/SFTP GUI/services stay excluded. No actual IOS image boot/update is claimed.')
add('4.3','Configure NAT/PAT and diagnose actual translations, return tuples, exhaustion and aging.',[
 ('core','PAT supplies a return path'),('core','dynamic NAT allocates'),('policy-closure','allocated basic dynamic NAT'),('policy-closure','PAT accepts the established')],
 'Bounded basic NAT/PAT packet behavior, not all IOS NAT architectures or application-layer gateways.')
add('4.4','Query six DNS record types, aliases and failures; diagnose resolver/cache/TTL effects on actual routed access.',[
 ('dns-service','DNS-01'),('dns-service','DNS-02'),('dns-service','DNS-03'),('windows-cli','WIN-15')],
 'A/AAAA/CNAME/MX/NS/PTR have actual DNS query responses; no mail server SMTP product or unrelated AAA requirement is implied.')
add('4.6','Configure standard/extended numbered/named ACL entries and attachments; observe real drops, hits and correction.',[
 ('cli','named and numbered ACL entries'),('core','extended ACL enforces'),('wired-fidelity','standard and extended ACL route-map'),('policy-closure','router output ACLs count')],
 'The four ACL forms are executable. Complete per-platform ACL compilation, every option and every attachment/match combination remain unverified.')
add('4.7.a','Enforce trusted DHCP server paths, learn actual leases/bindings and validate renew/release/expiry.',[
 ('core','DHCP snooping trust'),('core','DHCP snooping learns'),('policy-closure','validated DHCP RELEASE')],
 'Logical snooping/rate/Option82 subset, not all hardware database-agent and stacking behavior.')
add('4.7.b','Enforce DAI against learned/static bindings, ARP ACL and actual request/reply frame fields.',[
 ('policy-closure','DAI validates request sender'),('core','static bindings and ARP ACLs')],
 'Actual ARP admission/counters are modeled; not every hardware DAI validation option.')
add('4.7.c','Generate actual storm traffic and observe configured suppression/shutdown/recovery.',[
 ('core','storm-control shutdown recovers')],
 'Bounded traffic-window/threshold behavior; every traffic class, unit/default and native counter mode is not independently compared.')
add('4.7.d','Apply RA-guard roles/policies, drop actual unauthorized advertisements and restore permitted RA/SLAAC.',[
 ('switching-compat','VLAN RA-guard attachment'),('core','named RA guard checks'),('cli','named RA guard roles')],
 'Implemented logical IPv6 packet fields and policy scope; evasive binary extension-header/fragment parsing is outside this model.')
add('4.7.e','Configure secure MAC/limits and enforce real MAC-move/aging/violation outcomes.',[
 ('core','port security rejects moves'),('endpoint','ENDPOINT-07')],
 'Actual host admission is modeled; every violation/recovery/sticky persistence permutation is not established by these selectors.')
add('5.5','Use YAML/JSON inventory/tasks to issue packet-backed remote IOS commands/configuration and inspect structured results.',[
 ('automation','AUTO-01'),('automation','AUTO-03'),('automation','AUTO-04'),('automation','AUTO-09')],
 'Original offline Ansible-shaped teaching task subset. No installed Ansible/Python/Jinja/controller runtime, arbitrary collections, or external host execution.')

def digest(v):return hashlib.sha256(v).hexdigest()
for row in rows:
 evidence=[]
 for name,selector in row.pop('evidenceSelectors'):
  path=Path('tests/'+name+'.test.ts');raw=path.read_bytes();text=raw.decode()
  match=re.search(r"test\(\s*['\"`]"+re.escape(selector),text)
  assert match,f'{row["id"]}: missing {path} / {selector}'
  end=text.find('\ntest(',match.end());excerpt=text[match.start():end if end>=0 else len(text)]
  assert 'assert.' in excerpt,f'{path}:{selector} has no assertions'
  evidence.append(dict(file=str(path),selector=selector,line=text[:match.start()].count('\n')+1,
   fileSha256=digest(raw),assertionExcerptSha256=digest(excerpt.encode())))
 row['assertionEvidence']=evidence
 row['workflowAssessment']='available within stated teaching model'
 row['nativeEquivalenceClaim']=False

matrix=Path('docs/audits/exam-objective-coverage.json');m=json.loads(matrix.read_text())
practical=[r for r in m['objectives'] if r['exam']=='CCNA 200-301 v2.0' and r['leaf'] and r['practical']]
assert len(rows)==39 and {r['id'] for r in rows}=={r['id'] for r in practical}
for row in rows:
 broad=next(r for r in practical if r['id']==row['id']);row['broadMatrixCaseIds']=broad['objectiveEvidence']['caseIds']
 row['caseEvidenceReview']='Explicit broad-matrix cases are bounded and consistent with their stated assertions; supplemental selectors provide workflow-specific evidence where the semantic matrix only had subsystem candidates.'
result=dict(schemaVersion=1,reviewedAt='2026-10-17',generatorSha256=digest(Path(__file__).read_bytes()),
 blueprint=m['exams'][1],practicalLeaves=39,
 method='Independently read each practical blueprint leaf and inspect available configuration/runtime paths and named test assertions. Supplemental workflow assessment does not promote the broad matrix to native-equivalent or complete. This generator validates selector existence and hashes; it does not execute tests.',
 executionBoundary='Consult the final combined regression and durable browser records. The owned focused run passed117 cases (wireless99 plus dedicated Phone18). Wired owner separately reported4 direct routing-practical cases passing. This generator only indexes inspected assertions and never executes them.',
 newlyClosedGaps=[
  dict(objective='1.6',repair='Actual Windows/Linux/macOS diagnostic profiles share host addressing, routed IP/DNS and WLAN security state.',evidence='UNIX-01 through11; WIN host/WLAN cases'),
  dict(objective='2.2.a/c',repair='Generic endpoint roles plus a dedicated two-port Phone, PoE class3 allocation, received CDP/LLDP-MED voice policy, real voice DHCP and isolated IPv4/IPv6 PC passthrough.',evidence='ENDPOINT-01 through15; PHONE-01 through13; PHONE-AUDIT-01 through05'),
  dict(objective='2.2.b',repair='Explicit generic standalone AP profile has local SSID/radio/security/VLAN datapath with no controller; software reload retains the selected profile and PoE supply.',evidence='SAP-01 through08; standalone-ap-browser-validation.json')],
 broadMatrixCorrections=[
  '2.1.d: SVI requires direct switching/management-autostate evidence, not only generic routing candidates.',
  '3.3.a: authentication is explicitly excluded; semantic AAA matches are not required OSPF evidence.',
  '4.4: DNS mail-name diagnosis does not imply unrelated AAA; six typed DNS cases are the direct evidence.',
  '4.2: IOS SCP server is supported; IOS SFTP server is not. SFTP-client exercises use an eligible non-IOS endpoint; excluded Server file-service GUI is not restored.',
  '2.2.b: generic standalone now exists independently of lightweight Flex controller-outage fallback.'],
 newlyStrengthenedAcceptanceEvidence=['PRACTICAL-STATIC6 directly asserts native IPv6 network/default/host route selection, floating failover, actual UDP receiver and saved/portable recovery.','Parameterized PRACTICAL-P2P directly asserts native OSPFv2/v3 point-to-point FULL/P2P, real echo, Hello-loss withdrawal and saved recovery.'],
 unresolvedAcceptanceEvidence=['Root-primary/secondary macros, every ACL form/direction and every native option/output have not each received exhaustive boundary/reload/platform reference comparisons.','Virtualized-host and network-appliance edge workflows use modeled network peers; no external hypervisor/appliance operating system is supplied.'],
 implementationConclusion='No additional fundamental practical workflow gap was demonstrated in the39-leaf source review after the repairs above. Several leaves still have composed or peer-substitute evidence; this is not a complete exam/Simlet guarantee.',
 exclusions=['Native crypto interoperability and measured hardware/RF parity.','Full external hypervisor/appliance/Ansible products and arbitrary operating-system shells.','User-approved Server TFTP/SCP/SFTP service/GUI removal.'],
 objectives=rows)
Path('docs/audits/ccna2-practical-workflows.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(practicalLeaves=len(rows),assertionPointers=sum(len(r['assertionEvidence'])for r in rows),nativeEquivalenceClaims=0)))
