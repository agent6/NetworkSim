# STP / EtherChannel validation

STP previously elected and displayed physical member ports. Logical Port-channel queries had no port rows, and STP cost configured on the logical interface was ignored. The engine now owns one STP port and BPDU session per Layer 2 aggregate, resolves physical forwarding through that logical state, and uses logical settings in election and guards. IOS-style displays and individual diagram cable sockets follow the same state.

Final verification:

- **965 tests passed, zero failed**, including **19 new STP/EtherChannel tests**. One existing LACP test now checks the logical member list instead of expecting duplicate physical STP states.
- Type checking and the standalone build passed.
- **11 browser checks passed**, with no page errors, through public IOS consoles in the built `file://` app. The fixture used an isolated browser and disposable YAML import; the user's lab was not changed.
- Root `index.html`, `dist/index.html` and the localhost preview match byte for byte.

The protocol tests cover LACP, PAgP and static bundles, actual one-member BPDU transmission, packet forwarding, single logical display/counting, global and per-VLAN logical cost/priority, MST instance settings and bridge priority election, configuration replay and save/load, automatic/manual costs through member loss/restoration, long costs, negotiated 10/100-Mb/s costs, logical shutdown, a redundant triangle's blocking and uplink failover, root guard, BPDU-loss loop guard and recovery, BPDU guard, PVST forward delays, logical port-priority selection between bundles, passive/passive non-formation, PortFast defaults on member-carried trunks, member removal and peer replacement without stale root information.

Browser checks verify the `Po2` row and numeric port ID, member query resolution, a configured cost moving the root port onto the backup cable, both channel cables showing blocking, one blocked segment, restoration of automatic cost, surviving member failure with updated cost, a fixed manual cost after restoration, aggregate shutdown/recovery and matching EtherChannel state, MST cost/priority output, and absence of browser page errors.

The documented model boundaries remain in the [feature guide](../features/stp-etherchannel.md), together with Cisco references. This verifies the simulator's educational model and does not establish full Cisco firmware equivalence.

Artifact SHA-256: `c9667ab35e832d6e926ded8f0ff18260a7f5bc43581ef56157c72a8874054771`.

Evidence: [validation snapshot](stp-etherchannel-validation.json), [browser checks](stp-etherchannel-browser-results.json). Reproduce with `node --test tests/stp-etherchannel.test.ts` and, after building, `node scripts/browser-stp-etherchannel.mjs`.
