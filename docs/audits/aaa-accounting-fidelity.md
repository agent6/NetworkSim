# AAA accounting fidelity — bounded operational subset

NetworkSim now sends accounting records through its packet engine. This closes the previous configuration-only gap for **VTY EXEC sessions** and **TACACS command accounting**. It does not implement complete Cisco AAA accounting or binary RADIUS/TACACS interoperability.

## Implemented behavior

- A successful, authorized VTY login creates an EXEC session context. `start-stop` sends Start after authorization and Stop on logout, disconnect or idle timeout. `stop-only` sends only Stop; `none` suppresses the selected list. Failed authentication or EXEC authorization does not create an EXEC accounting session.
- EXEC records travel to RADIUS UDP1813 or TACACS TCP49 using the configured server/group order. The sender remains pending until it receives a matching acknowledgement. Unavailability permits fallback; an explicit TACACS rejection stops fallback. RADIUS requests use configured bounded timeout/retransmit settings and a stable event ID on retries. Lost acknowledgements can cause retransmission; the receiver acknowledges duplicates without storing them twice.
- Commands that pass the existing authorization/privilege gate use the selected TACACS accounting list. This subset classifies ordinary user EXEC commands at level1, navigation at level0, and privileged/configuration commands at level15. Custom IOS privilege remapping is not modeled. A dispatched command can still produce a parser or execution error; a command accounting record records its issuance, not successful configuration or forwarding.
- Native line selectors `accounting exec NAME` and `accounting commands LEVEL NAME` override default lists. Running configuration and YAML/JSON labs preserve lists and selectors. Operational sessions, receiver logs and pending delivery state are runtime-only.
- `show accounting` derives active actions from real VTY sessions and adds explicitly labeled NetworkSim delivery telemetry. It never counts an unacknowledged packet as delivered. Server Services → AAA shows actual received records, duplicate retries and rejection counts. Commands and usernames are escaped in the GUI.
- Password prompts never enter command accounting. Whole secret-bearing commands are replaced with `[sensitive configuration command redacted]`, including local usernames, password/secret/community/key commands, SNMPv3 users/notification hosts, routing/NTP/FHRP authentication keys, `test aaa` credentials and credential-bearing URLs. The receiver also sanitizes command text and copies only recognized record fields. Logical shared keys still appear in simulated service traffic because this is not protocol cryptography; use lab-only credentials.

## Explicit limits

Local console accounting and connection/network/system accounting remain configuration-only. System lists accept only `default`. Resource accounting, interim updates, broadcast accounting, VRF/source-interface selection, custom privilege maps, remote accounting storage persistence and admin-triggered clear-line accounting are not implemented. Remote services currently listen on the default 1813/49 ports; an alternate configured destination is genuinely sent to that port and can fail rather than being treated as available.

The Cisco implementation of RADIUS does not support command accounting. NetworkSim rejects that configuration for known RADIUS groups and refuses RADIUS command records at runtime. RADIUS EXEC accounting remains operational. A future named-group change to RADIUS cannot turn command records into a supported RADIUS feature.

Abrupt power loss/reload discards runtime sessions. NetworkSim does not fabricate a later Stop when power returns. Stop delivery can also fail if the network or accounting receiver is unavailable. Failed accounting does not falsely report success or block an otherwise authorized shell. All records are bounded to 1000 entries per device. There is no durable retry queue after restart.

The records are original logical application payloads over simulated UDP/TCP. RADIUS authenticators, binary AVPs, TACACS packet encoding/encryption, NAS-vendor attributes, challenge-response and external daemon interoperability are not implemented. `show accounting` is IOS-shaped for active actions; its delivery diagnostics are deliberately labeled simulator output.

## Reference invariants

These primary references establish behavior, not a captured native-device transcript:

1. [Cisco IOS XE Dublin 17.12, Catalyst 9300 — Configuring Accounting](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/sec/b_1712_sec_9300_cg/configuring_accounting.html): named/default list selection, Start/Stop modes, no-response-only fallback, password masking, privilege-specific command records, no RADIUS command accounting and active `show accounting` fields.
2. [RFC 2866 — RADIUS Accounting](https://www.rfc-editor.org/rfc/rfc2866.html): UDP1813, commit before acknowledgement, Start/Stop session identity, retransmission and exclusion of User-Password from accounting requests. NetworkSim models these invariants without implementing the binary wire format.
3. [RFC 8907 — TACACS+](https://www.rfc-editor.org/rfc/rfc8907.html): separate accounting requests/replies and Start/Stop task semantics. NetworkSim models a logical acknowledgement, not native packet encoding or encryption.

## Validation

`tests/aaa-accounting.test.ts` contains 12 behavior tests: actual RADIUS Start/Stop, TACACS level selection/redaction, named lists/modes/persistence, ACL-dropped acknowledgement retry/deduplication, explicit rejection versus unavailability fallback, idle timeout and EXEC denial, invalid grammar rollback, receiver sanitation, disabled receiver failure, abrupt power loss, context help without mutation, and command authorization denial/password prompt exclusion. `tests/services-ui.test.ts` SVC-GUI07 sends a real TCP accounting request before inspecting escaped receiver output. Existing management/nested-session, account-map and CLI syntax regressions also pass.

This is a partial fidelity classification. It is not proof of full CCNA/CCNP coverage or native Cisco accounting output equivalence.

Browser validation: `scripts/browser-aaa-accounting.mjs` imports an isolated four-node YAML lab through the public interface, opens Windows Telnet, authenticates to the VTY, issues actual accounted commands and verifies the server receiver log and logout Stop in light/dark views. All six checks passed with zero page errors. Results: `aaa-accounting-browser-validation.json`; screenshots: `.cache/aaa-accounting-browser/received-light.png` and `received-dark.png`.
