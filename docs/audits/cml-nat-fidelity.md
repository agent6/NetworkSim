# NAT and PAT reference validation

NetworkSim's IOS NAT path was compared with IOL IOS XE 17.18.02 in Cisco CML using two real Linux endpoints, isolated inside/outside links, socket receiver logs, and captures from both wires. Nexus tests use C9300v NX-OS 10.6(2). Configuration acceptance is checked separately from translated traffic.

## IOS behavior implemented and checked

The 47-group matrix in `scripts/cml/nat/scenario.json` covers the requested interface roles, static NAT, basic dynamic pools, interface PAT, table/statistics/configuration output, clearing, and debug. It exercises both directions of static ICMP, UDP and TCP; two inside addresses using the same source port; different outside peers; pool exhaustion; fresh outside traffic to a whole-address allocation; absent allocation ACLs; and actual idle expiry.

The engine now maintains a basic address allocation separately from its extended transport entries. Static configurations retain permanent entries while actual traffic creates extended IOS entries. Generic allocations default to 24 hours, UDP entries to 300 seconds, ICMP entries to 60 seconds, and closed TCP entries to 60 seconds. A live child retains its parent allocation. Clearing cancels runtime timers and preserves permanent statics. Removing an active static mapping asks the native confirmation; an empty response preserves it. A live dynamic policy or referenced pool cannot be removed silently.

PAT rewrites ICMP identifiers on both request and reply paths, keeps independent transport tuples, and restores original quoted addresses/identifiers in ICMP errors. A different outside peer cannot reuse a PAT mapping: the negative test installs a real listener at the original inside port and checks that no request arrives there. In contrast, a basic dynamic whole-address allocation permits independently initiated outside flows.

`show ip nat translations`, `verbose`, protocol filters and `show ip nat statistics` derive their rows and counters from actual allocations, children, timers and translated packets. `debug ip nat` is fed by actual source/destination translation events. Conflicting static addresses and cross-subnet pool bounds reject without changing the configuration. `?`, Tab, saved configurations and portable lab import are covered.

The comparison normalizes only ICMP identifiers and the interface-PAT global port allocator, then compares every IOS translation table, including empty tables after expiry/deletion. The reviewed observations, original capture hashes, 24 successful native Nexus probes, and failed basic dynamic candidate are retained in `scripts/cml/fixtures/nat-observations.json`. Cisco's image-specific ephemeral port selection, entry IDs, elapsed times, map IDs and TCP segment counts are not asserted equal to NetworkSim. NetworkSim uses a deterministic collision-checked port allocator, rather than pretending to reproduce a particular hardware allocator.

## Nexus scope and prerequisites

Static IPv4 inside-source NAT and named-ACL pool/interface PAT are implemented on standalone routed Ethernet interfaces in the default VRF, behind `feature nat`. Bidirectional ICMP/UDP/TCP traffic has passed in CML and in NetworkSim. NS-OS emits its own native `any` mapping and directional statistics; it does not reuse IOS's extended static-entry display. Feature removal removes NAT configuration, interface roles and runtime state. Switchport, named-VRF and port-channel NAT placement, basic non-overloaded dynamic NAT, other unvalidated NAT commands and malformed imported configurations reject instead of storing inactive settings.

The reference VM initially rejected `ip nat inside/outside` with `Error: Nat tcam not carved.` The owned test Nexus needed its NAT region allocated, a real observed boot image saved to startup configuration, and a reboot. The workflow performs this preparation only inside its disposable reference lab. NetworkSim does not expose ASIC TCAM carving commands: it has no physical TCAM to allocate.

The native Nexus passed all 24 supported traffic probes: six bidirectional static probes, nine pool-PAT probes, and nine interface-PAT probes, covering ICMP/UDP/TCP and three inside addresses sharing the same source port. The simulator's separate 30-group Nexus matrix replays those forms. `clear ip nat translation all`, native ICMP outside columns `:0`, pool/alias statistics, saved configuration and native confirmation before removing a PAT list are implemented and checked. Basic non-overloaded dynamic NAT allocated addresses and forwarded UDP but failed TCP and ICMP; it remains unavailable on the NX node.

The pool-PAT run originally asserted that allocation must use the first pool address. Nexus used the other valid address, so those original assertion failures are preserved alongside the successful receiver/wire evidence. The runner now accepts any address in the configured pool. A later warm baseline was probed before retained policy was removed; its failed result remains in the source report. The first clean native baseline and both static traffic runs passed. Reusable warm runs now explicitly reset owned NAT policies and interface roles before baseline probes. No native `differences` report has been relabeled as an all-feature pass.

The actual virtual Nexus printed zero dynamic time-left and zero per-entry hardware counters despite successful traffic. NetworkSim reports its real remaining idle deadline and software counters, and omits unavailable ASIC counters. It does not fabricate zero timers or hardware state. Interface PAT is proven on the specified C9300v image; Cisco documents restrictions on some physical Nexus families, so this is not a blanket hardware compatibility claim.

## Reproduce

Use Node 24.15+, Python with `scripts/cml/requirements.txt`, system curl/OpenSSH and a previously verified controller SSH host key. The controller password is requested with a hidden terminal prompt. No controller credentials or tokens belong in source, command arguments, example labs, or exported fixtures.

```sh
.cache/cml-venv/bin/python scripts/cml/nat_workflow.py \
  --url https://192.168.1.201 --username admin --insecure \
  --known-hosts .cache/cml-network/ssh-host-keys \
  --output .cache/cml-nat/new-reference
node scripts/cml/nat_replay.ts scripts/cml/nat/scenario.json \
  .cache/cml-nat/replay.json examples/nat-pat-ios-nxos.netsim.yaml
node scripts/cml/nat_replay.ts scripts/cml/nat/nx-scenario.json \
  .cache/cml-nat/nx-replay.json
.cache/cml-venv/bin/python scripts/cml/nat_evidence.py .cache/cml-nat/new-reference
.cache/cml-venv/bin/python scripts/cml/nat_compare.py \
  .cache/cml-nat/new-reference/capture.json .cache/cml-nat/replay.json \
  .cache/cml-nat/comparison.json
node scripts/browser-nat-conformance.mts
npm run cml:test
npm run check
```

The runner creates six nodes and four links with no external connector, checks physical port readiness, verifies the real socket listeners, saves versions/transcripts/receiver logs and four PCAPs, then stops only the lab it owns. Reusing `--resume-owned-from CAPTURE.json` requires the exact run title, node/image identities and link endpoints; it may restart a verified stopped owned lab. It never reuses arbitrary user labs. Non-working Nexus candidates produce a `differences` result rather than a successful certification. Successful transport probes additionally require request/reply tuples and matching tokens on both captured links; ICMP checks preserve echo identifiers across both wires.

The portable example opens directly in the offline HTML app. `I1` reaches `O1` through IOS PAT; `O2` reaches `I2` at Nexus static global address `198.51.100.10`. `O1` and `O2` provide the simulator's working HTTP service. The synthetic example Nexus account is `admin` / `NetSimLab42!`.

## Limits

This work covers IPv4 inside-source address NAT and PAT, not NAT64, outside-source/twice NAT, NAT-aware ALGs, arbitrary VRFs or hardware performance. The tests exercise the named CML images, not every Cisco hardware family or release. The application remains a local offline simulator; CML is used only by the developer validation tools.

## Final validation

All 1,292 project tests, TypeScript checking and the offline production build pass. The Python CML workflow suite passes 28 tests. IOS replay passes 47/47 groups and Nexus replay passes 30/30 groups; all 11 IOS translation-table comparisons match after the documented allocator normalization. The captured successful transport probes have request/reply tuple evidence on both links; complete ICMP echo pairs cover all five successful IOS and eight successful Nexus probes. Eight offline Chrome checks pass with no page errors or external HTTP requests. The reference lab is stopped and the pre-existing user CML lab remains started.

References: [Cisco IOS XE NAT address conservation](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/ip-addressing/b-ip-addressing/m_iadnat-addr-consv-xe.html), [NX-OS 10.6 static/dynamic NAT](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/interfaces/cisco-nexus-9000-series-nx-os-interfaces-configuration-guide-release-106x/m_configuring_static_and_dynamic_nat_translation_9x.html), [Nexus 9000v virtual platform limits](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/n9000v-9300v-9500v/cisco-nexus-9000v-9300v-9500v-guide-release-106x/m-overview.html).
