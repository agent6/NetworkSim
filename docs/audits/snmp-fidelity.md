# SNMP runtime audit and implementation

Reference: Catalyst 9300, Cisco IOS XE Dublin 17.12.x configuration model; applicable shared IOS XE router management concepts. This is an original, packet-driven teaching agent. It runs no Cisco software. The native Packet Tracer/IOS SNMP output has not been independently observed for this implementation.

`src/snmp.ts` installs an agent on UDP/161 and an optional server notification receiver on UDP/162. Manager requests use `snmpGet` → `Simulator.udpRequest` → normal route, VLAN, ARP/ND, ACL and UDP delivery → agent → routed response. A manager must reach the target. Authentication failures and manager ACL denials silently discard requests, so a response cannot appear without a delivered request and valid configured identity. Interface ACL denial occurs before agent delivery and does not increment SNMP request counters.

## Operational subset

- SNMPv2c community matching with manager ACLs; no default public community.
- Logical SNMPv3 users/groups, minimum noauth/auth/priv level, configured authentication/privacy identities, group/user source ACLs and read-view filtering. Password comparison models configuration compatibility; it is **not USM cryptography**.
- GET and GETNEXT with numeric OID ordering, `noSuchObject`, `noSuchInstance`, and `endOfMibView` exceptions. All MIB values are read only; SET returns `notWritable`, including for a configured RW community.
- System MIB: original simulator description, unassigned `sysObjectID` of `0.0`, uptime derived from device boot clock, contact, hostname, location, services and interface count. No Cisco enterprise identifier or hardware inventory is fabricated.
- Interface MIB: actual interface index/name/type/MTU/speed/MAC/admin/oper state and byte/frame counters. Counter32 wraps modulo 2^32. Indexes follow configured interface order.
- Received/answered requests, unknown communities, version/authentication/ACL failures, operations, variables read and notifications are runtime counters. `show snmp` displays those counters and states the logical security boundary. User displays omit passwords.
- Optional one-way v2c notifications use `udpNotify` through normal packet processing. A submitted notification is not proof of delivery. Only an enabled manager that receives the datagram stores it. Runtime storage is bounded to 500 notifications. Actual link/admin transitions, cold/warm restart and failed authentication originate the selected categories; repeated unchanged snapshots do not duplicate transitions. Agent and host category filters change actual datagram submission. Enabling traps alone does not fabricate events.

## Evidence

`tests/snmp.test.ts` contains 18 tests: SNMP-01–16, SNMP-NAME-01 and SNMP-EVENT-01. It checks real UDP requests/responses, no response on invalid community, listener removal, manager/source ACL and interface ACL denial, v3 logical credential/security/view restrictions, missing/next OIDs, immutable read-only SET, operational state/counters, saved configuration and reboot uptime, actual one-way notification reception, L2/L3/PoE switch management SVI reachability, and Laptop manager traffic over wireless/CAPWAP/VLAN routing. The added cases exercise literal dictionary identifiers through packets/save/load and actual filtered link/auth notifications without duplicate events. Unsupported v3 algorithms and missing views cannot grant access. Existing operational display tests also check disclosure and secret omission.

Tests validate the documented subset; they do not prove a complete SNMP agent or native Cisco output equivalence.

## Remaining limitations

No ASN.1/BER wire encoding, USM message digest/encryption, localized keys, discovery/timeliness/replay protection, engine boots synchronization, engine-ID-bound secrets, VACM context/VRF namespaces, SNMPv1, GETBULK, writable MIB, informs, v3 notifications, full vendor MIBs, physical interface error counters, persistent ifIndex assignment, or enterprise trap category dispatch is implemented. Unsupported configured features must remain marked partial; accepting a legacy token array is not evidence of its runtime effect. The CLI stores multiple view subtree rules and applies the longest matching include/exclude rule; rendering preserves every entry. Legacy one-rule views still load. Invalid CLI arguments reject transactionally; supported partial settings issue explicit NetworkSim notices without being mistaken for import errors. SNMP has a limited manager GUI/API rather than invented Cisco `snmpget` EXEC syntax.

## Primary references

[IOS XE 17.12 Catalyst SNMP configuration](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/nmgmt/b_1712_nmgmt_9300_cg/configuring_simple_network_management_protocol.html) supplies release-specific community, group, user, ACL and notification configuration. [RFC 3416](https://www.rfc-editor.org/rfc/rfc3416.html) supplies request/response/error invariants. [RFC 3418](https://www.rfc-editor.org/rfc/rfc3418.html) defines system objects. [RFC 2863](https://www.rfc-editor.org/rfc/rfc2863.html) defines interface objects. [RFC 3414](https://www.rfc-editor.org/rfc/rfc3414.html) specifies the real USM security mechanisms that this logical model explicitly does not execute.

Browser evidence: `windows-browser-validation.json` verifies successful router queries and invalid-community timeout through the host SNMP manager GUI using an imported four-node topology.
