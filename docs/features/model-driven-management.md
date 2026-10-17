# Model-driven management teaching subset

NetworkSim now implements NETCONF and RESTCONF operations through the same simulated TCP, routing, ARP, ACL and interface state used by other lab traffic. These are ports inside the simulated topology; enabling them opens no host operating-system listener and needs no backend.

Reference: Cisco IOS XE Dublin 17.12.x, [NETCONF](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/prog/configuration/1712/b_1712_programmability_cg/m_1712_prog_yang_netconf.html) and [RESTCONF](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/prog/configuration/1712/b_1712_programmability_cg/m_1712_prog_restconf.html), with [RFC 6241](https://www.rfc-editor.org/rfc/rfc6241.html), [RFC 8040](https://www.rfc-editor.org/rfc/rfc8040.html) and [RFC 7951](https://www.rfc-editor.org/rfc/rfc7951.html). No Cisco output transcript is fabricated.

## Enable the modeled services

Configure an operational management IP and a privilege-15 account, then use existing IOS commands:

```text
username admin privilege 15 secret labpassword
netconf-yang
restconf
ip http secure-server
ip http authentication local
```

`netconf-yang feature candidate-datastore` enables shared candidate configuration, candidate locks and confirmed commits. Changing this setting terminates existing NETCONF sessions. `no netconf-yang` terminates its sessions. `no restconf` disables the RESTCONF resources. HTTPS enablement, HTTP access-class, normal interface ACLs and actual reachability remain necessary for RESTCONF. A privilege-1 account cannot access either datastore.

If AAA is enabled for NETCONF or selected with `ip http authentication aaa`, authentication reuses the shared method-list/AAA implementation. The account must be granted privilege 15. A remote RADIUS test demonstrates actual delivered authentication requests; no direct service success shortcut is used.

## Supported datastore resources

| Resource | Writable fields | Runtime effects |
| --- | --- | --- |
| `Cisco-IOS-XE-native:native/hostname` | Valid IOS hostname | CLI prompt/config and device identity update |
| `ietf-interfaces:interfaces/interface` | Existing name/key, description, enabled, matching type | Admin state changes routes and actual packet forwarding |
| Interface `ietf-ip:ipv4/address` | IPv4 key and contiguous netmask or prefix length | Connected/local routes, source selection and addressing update; replaces automatic IPv4 configuration when edited |
| `LoopbackN` and existing-VLAN `VlanN` interface entries | Same subset | Virtual interface creation/removal, addressing and routes |

Physical interfaces cannot be deleted. The interface type must match the modeled interface. Unsupported, operational-only and unknown fields reject; multi-entry changes are validated on a clone and commit together. IPv4 merge updates addresses by key; per-interface replacement resets the supported interface properties while preserving unrelated native configuration.

Reads report current configuration and, for operational retrieval, real up/down state and packet byte counters. They do not invent hardware counters. All mutations affect ordinary device configuration, so `show running-config`, `write memory`, save/load and reload use the same state. Candidate work and live sessions are excluded from exported topologies.

## RESTCONF client API

Use `Simulator.httpRequest` with a simulated destination URL. The path, HTTP method, headers and body all travel through the existing simulated TCP request/response path. A request body uses `application/yang-data+json`; list entries retain RFC 7951 array encoding even when selecting one interface.

Supported reads are `/restconf`, `/restconf/data`, `/restconf/data/Cisco-IOS-XE-native:native`, its `/hostname` leaf, `/restconf/data/ietf-interfaces:interfaces`, `/interface={percent-encoded-name}`, and selected interface `/enabled` or `/description` leaves. GET and HEAD return modeled values. Hostname and existing interface/leaf resources support PUT/PATCH. POST at the interfaces resource creates virtual entries. PATCH at that collection edits multiple entries transactionally. DELETE removes virtual entries or resets a selected enabled/description leaf to its default; it never deletes an interface when a leaf is targeted.

Example request body for a PATCH to `/restconf/data/ietf-interfaces:interfaces/interface=GigabitEthernet0%2F1`:

```json
{
  "ietf-interfaces:interface": [
    { "name": "GigabitEthernet0/1", "enabled": false }
  ]
}
```

A valid change returns 204, or 201 for creation. Invalid fields/values, unknown resources, missing credentials and forbidden methods produce structured RESTCONF errors. HTTP access-class can reject access before the datastore handler. Packet ACL drops fail through ordinary TCP delivery rather than returning fabricated application success. Unknown query parameters, XML media, collection-wide PUT and unsupported model resources explicitly reject.

## NETCONF client API

Use `Simulator.connectTCPChannel(sourceId, address, 830, handlers)`. This is a persistent ordered TCP channel. The teaching SSH handshake is an application message `{type: "ssh-auth", username, password}`; a valid account receives an authentication result and a NETCONF XML server hello. The client then sends its base-1.0 hello and XML RPCs using `]]>]]>` framing. SSH and TLS encryption are not implemented.

Supported RPCs: `get`, `get-config`, transactional `edit-config`, `lock`, `unlock`, `discard-changes`, `commit`, confirmed commit with optional `confirm-timeout`, and `close-session`. Subtree filters select the modeled native/hostname or interface subtree. Default merge is supported; individual interface entries can use a namespaced NETCONF `operation` of merge/replace/create/delete/remove. Unsupported default replacement and unknown options reject. Only implemented capabilities are advertised.

Running edits apply immediately. Candidate edits remain isolated until commit. The candidate datastore is shared, with locks owned by the actual TCP session; another session receives an in-use error. Unlock or session failure releases its locks and discards uncommitted candidate edits. A concurrent CLI change produces an explicit commit conflict rather than silently overwriting that change.

A confirmed commit temporarily applies candidate state. A normal commit from the same session confirms it. If its virtual-time deadline passes or its owning session ends, the old configuration is restored and forwarding recovers. The default confirmation timeout is 600 seconds; supported explicit values are 1–65535 seconds. Candidate/running locks block conflicting commits. Idle sessions expire after 120 seconds of simulated inactivity. Device reset/power loss clears channels, candidates, locks and their callbacks.

## Validation and limits

`tests/model-driven-management.test.ts` covers authenticated packet delivery, RADIUS privilege, operational reads, real routed traffic changes/recovery, atomic invalid changes, unknown XML/models, HTTP/interface ACLs, persistence/reload, simultaneous sessions/locks, candidate commit/discard, confirmed timeout/session-loss rollback, mode transitions, concurrent CLI conflicts and idle expiry. The tests compare documented invariants and actual simulation state, not made-up Cisco golden transcripts.

The [machine-readable coverage inventory](../audits/model-driven-management-coverage.json) is reproduced with `node scripts/audit-model-driven-management.mjs`. It maps the three service commands across all five IOS XE node profiles, the supported REST paths/RPCs/models, actual packet/runtime dependencies, and MD-01–17 plus MGMT-MON-01. Lightweight APs do not accept or advertise these unsupported service commands. The [desktop browser evidence](../audits/model-driven-browser-validation.json) records authenticated GET, interface disable/recovery with real routed Windows ping, IOS operational output, and hostname changes through the public REST tool UI.

XML parsing uses only own entity and namespace entries. Undeclared namespaces and custom entities with names such as `constructor` or `__proto__` reject without changing configuration. `show netconf-yang sessions`, its detail/session-id forms, and `show netconf-yang datastores` report actual authenticated TCP sessions and current lock ownership.

This is a limited YANG resource and operation subset. It is not a general YANG compiler/schema server or a complete IOS XE datastore. It omits IPv6 edits, subscriptions/notifications/telemetry, schema/library download, arbitrary XPath filters, chunked NETCONF base-1.1 framing, startup/copy-config/kill-session/cancel-commit RPCs, persistent confirmed commits, NACM/model-level authorization, full RESTCONF query/ETag/YANG-patch support, TLS/SSH cryptography and external Python/Ansible interoperability. The bounded original XML parser rejects DTDs, custom entities and CDATA. Default datastore and AAA behavior outside this subset remain partial; these services must not be labeled complete IOS equivalence.
