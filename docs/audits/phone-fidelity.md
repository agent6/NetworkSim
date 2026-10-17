# Independent dedicated Phone audit

Reviewed 2026-10-17 UTC. The Phone is a generic two-port PoE network-attachment teaching node. It is not a Cisco phone firmware, call-control server or audio stack. The user approved it as the tenth node; existing AP power remains PoE-only.

`tests/phone.test.ts` supplies 13 existing attachment/persistence assertions. `tests/phone-audit.test.ts` adds five independent cases and passes with them, **18/18**, in `.cache/phone-audit-tests.log`. The later wireless/Phone combined run passes **117/117** in `.cache/wireless-phone-final-targeted.log`. TypeScript passed after the tests were added. The parent combined regression and browser run determine final repository-wide status.

| Case | Assertions reviewed and executed |
| --- | --- |
| PHONE-AUDIT-01 | A PC behind a voice-tagged phone completes actual IPv6 echo and NDP on the untagged data VLAN. Both bridge directions retain source MAC, packet identity and original sender hop limit. PC DSCP34/ECN2 is preserved rather than overwritten with the phone's voice policy. |
| PHONE-AUDIT-02 | A deliberate Ethernet loop through Network/PC consumes the existing forwarding limit and stops. IP TTL37 remains unchanged. `sendWire` already guards and decrements the Ethernet budget once, so no extra phone decrement was added. |
| PHONE-AUDIT-03 | Running and startup imports containing secondary IPv4 or explicit IPv6 identities on PC reject transactionally. Existing topology/configuration remains unchanged. |
| PHONE-AUDIT-04 | Already queued bridge frames cannot arrive from a previous boot after PoE loss/restoration or software reload. Fresh traffic recovers and allocated power remains correct. |
| PHONE-AUDIT-05 | Reversed interface object order preserves Network/PC roles through portable load; the dedicated Phone refuses fake IOS commands. A powered Phone's PC port cannot supply a connected AP. |

Two defects were demonstrated and repaired. `validatePhone` previously rejected primary PC addresses but accepted `PC.features.secondaryIps` and explicit IPv6 identity features. They could enter the shared local-address/route machinery despite the port's data-only contract. Validation now rejects those configured address sources in both running and startup configurations. Network remains the only local interface.

The shared IP settings form also selected the first interface by object insertion order. A valid imported Phone with `{PC, Network}` order could therefore open PC addressing controls. The parent changed the selection to the explicit Network interface for Phone. The reversed-order node test establishes persistence/role behavior; the parent client-profile browser separately asserts that the actual public IP settings page identifies Network.

Existing Phone cases independently cover CDP and LLDP-MED delivery, voice/data DHCP separation and policy changes/expiry, VLAN injection rejection, budget denial, physical cable/unplug/power failures, no external power, and portable recovery. The PC bridge does not route or rewrite its packets. Discovery link-local traffic terminates at the phone. No SIP/SCCP, calls, codecs, full handset operating system or exact native hardware output is claimed.

Reproduce the focused node run with `node --test --test-concurrency=1 tests/phone.test.ts tests/phone-audit.test.ts`. The [Phone user guide](../features/voip-phone.md) describes configuration; the [CCNA practical review](ccna2-practical-workflows.json) maps the bounded edge workflow without requiring external handset software.
