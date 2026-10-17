# Command removal and navigation follow-up

The fresh old/current command probes exposed differences that required semantic review. Old acceptance alone is not the selected Cisco behavior. The [paired evidence](command-probe-validation.json), [archived snapshot index](command-probe-snapshots.json) and readable command probe report preserve their source identities.

## ERSPAN endpoint removal

`no destination` in an ERSPAN source session previously rejected. The corresponding retained ERSPAN collector `no source` form also rejected. Endpoint fields were flattened into the session, and the renderer unconditionally emitted a peer subsection even when all of its fields were removed.

`spanModeCommands` now clears only the expected peer endpoint's ID, IP, origin and VRF. It retains the monitor session, source interfaces, destination monitor port and administrative state. Wrong-direction removal rejects without modifying configuration. Rendering emits a peer subsection only when peer settings remain, so text replay does not recreate an empty endpoint. `default` uses the same removal path.

The dedicated case in `tests/remote-span.test.ts` observes actual routed GRE and captured frames before removal, no GRE transmission/capture after removal, unchanged original echo delivery, collector rejection with its peer removed, recovery after reconfiguration, invalid-direction atomicity, rendered-copy replay and saved reload. The four remote-SPAN tests pass; the combined CLI/persistence/remote-SPAN run passes 56 tests.

[Catalyst9300 IOS XE17.12 Network Management commands](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/command_reference/b_1712_9300_cr/network_management_commands.html) documents argument-free `destination`/`no destination` in the ERSPAN source session. The corresponding collector removal is additionally supported by the restored sandbox observation. No native17.12 collector transcript was captured; full ERSPAN platform/output parity remains partial.

## Invalid navigation negation

The common handler ignored the negation flag for navigation. Consequently `no end` and `no exit` actually left configuration mode, and `no do` could dispatch an EXEC command. Generic help/completion also offered these invalid forms.

Execution now rejects negated/defaulted navigation before dispatch. Shared syntax filtering and terminal fallback help/completion omit those forms. `tests/ios-terminal.test.ts` verifies global configuration, interface and BGP address-family contexts: mode/prompt/configuration/clock remain unchanged, negated EXEC dispatch is blocked, and help/completion agree. The combined terminal/syntax/remote-SPAN run passes 27 tests.

The [Cisco configuration fundamentals reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/D_through_E.html) documents `end` as a navigation command without configuration/default arguments. Exact selected-release error caret placement is not certified by these original tests.

## Intentional differences from old acceptance

The final old-VM follow-up also exposed a missing `no debug interface` alias. The selected [9300 interface command reference](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/command_reference/b_1712_9300_cr/interface_and_hardware_commands.html) explicitly makes it equivalent to `undebug interface`. Both now use the existing validated interface-condition removal handler. `tests/ios-service-compat.test.ts` verifies that a condition initially suppresses actual packet debug events, malformed removal leaves it intact, valid removal reveals subsequent events and ICMP delivery remains unchanged. The bounded interface-condition model does not implement every native counter/state debugging option.

- ISL or encapsulation negotiation remains rejected for the selected dot1q-only Catalyst profile. DTP trunk-mode negotiation is separate.
- `negotiation auto` is documented for dedicated management interfaces; current switch teaching ports use `speed auto`/`duplex auto` and have no dedicated management-port role.
- Privileged diagnostic roots do not become user EXEC commands merely because the old sandbox exposed them there.
- `no snmp-server chassis-id` takes no old text value. The [Cisco SNMP command reference](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/snmp/command/nm-snmp-cr-book/nm-snmp-cr-s2.html) supports the current strict argument-free removal.
- Bare interface `no udld` is not a substitute for the modeled `no udld port` form; physical UDLD is not a subinterface protocol.
- Standalone autonomous-system removal does not replace removing the named EIGRP address-family header.
- WRED/fair-queue and OSPF `capability vrf-lite` remain unsupported. The latter requires PE DN-bit/VPN-tag/super-backbone mechanisms absent from the current logical LSA model. Adding a stored boolean would not implement its effect.
- The older `test etherchannel load-balance` form is not established for the pinned9300 reference, which documents `show platform etherchannel ...`. It remains a legacy compatibility gap, not a certified missing9300 command.

The QoS no-form, three-color default-drop and EIGRP BFD rendering repairs have their own packet/persistence regressions in the [wired findings](wired-fidelity-audit.md). Every whole-command and native-reference limitation remains visible; this follow-up does not certify all argument paths or the complete CLI.
