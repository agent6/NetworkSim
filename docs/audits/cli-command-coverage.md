# Command discovery and audit status

Generated 2026-10-17T01:04:07.266Z. **The complete command fidelity audit is unfinished.** Discovery is automatic; parser registrations and source test references are not behavioral equivalence.

994 distinct canonical IOS paths occur in 5932 node/path/handler definitions (725 handler identities). Inherited mode/context registrations are consolidated; these are not tens of thousands of unique commands. Windows has 17 parser roots and 41 explicit variants, represented across three host profiles.

| Node | IOS definitions | Windows variants |
| --- | ---: | ---: |
| router | 997 | 0 |
| switch | 974 | 0 |
| l3switch | 1002 | 0 |
| poeswitch | 976 | 0 |
| wlc | 1016 | 0 |
| ap | 967 | 0 |
| pc | 0 | 41 |
| laptop | 0 | 41 |
| server | 0 | 41 |

| Strict IOS status | Count |
| --- | ---: |
| complete | 0 |
| partial | 230 |
| missing | 0 |
| incorrect | 0 |
| unsupported | 12 |
| untested | 5690 |

**Zero whole IOS definitions are certified across every argument and all eight required validation levels.** This does not mean the commands do nothing; many have actual forwarding tests. It means no unmeasured option/default/negation/reference path has been silently promoted. Windows' 5 complete variants are narrow local operations; 33 are partial and 3 unsupported. Native Windows output equivalence is unverified.

The machine-readable [coverage inventory](coverage-inventory.json) records node, target, canonical path, arguments, modes/contexts, parser source candidate, handler hash, state/calls, subsystem, packet/persistence/negation scope and status. [Audit summary](audit-summary.json) joins test-source pointers without asserting that every match is a positive behavioral test. Exact added/repaired IOS command totals are **not measurable** without an immutable pre-audit source/command snapshot; the finding ledgers enumerate concrete repair groups instead. Windows variant change classifications remain separately counted.

All 18 discovered chapters of the pinned Catalyst 9300 command book were indexed automatically: 1328 headings (1307 distinct). 271 exact registration matches, 187 parent-handler candidates and 870 without registry matches are discovery facts only. Additional platform commands are not automatically exam requirements; prefix handlers may reject them. Router/wireless catalog completion and per-objective option reconciliation remain open.

The restored sandbox was independently executed in an isolated read-only VM. [Fresh paired probes](command-probe-validation.json) record 4757 attempts across 3666 old mode/path registrations, including positive/no/default forms. Reference hashes were verified: true. Snapshot validity: source-snapshots-stable; stale current runtime sources: src/ios-debug.ts. This unit differs from the new registry inventory. The bulk snapshot precedes the final debug alias repair; [focused followups](command-probe-followups.json) retain its current source identity and additional non-default removal/replay checks (19 checks; stale supplemental runtime sources: none). Acceptance and rendered-state agreement remain partial evidence; [readable comparison](command-probe-validation.md) and [difference triage](command-probe-triage.json) separates defaults, invalid fixtures and concrete omissions.

Context setup failures remain in the inventory rather than disappearing from the denominator. Generic IOS commands still exposed on the AP are flagged as shared teaching commands whose real lightweight-AP applicability is unverified. The independently coded help grammar and GUI/CLI validators remain duplication risks.

## Reproduce

Run Node24: `node scripts/audit-windows-commands.mjs`, `node scripts/audit-wireless-gui.mjs`, `node scripts/audit-model-driven-management.mjs`, `node scripts/fidelity-inventory.mjs`; then `python3 scripts/audit-exam-objectives.py`, `python3 scripts/audit-reference-commands.py`, and `node scripts/report-fidelity-audit.mjs`. The objective generator requires the locally cached official PDF/text references. Source digests must be refreshed after implementation changes.

Stale inventory sources at report generation: none.
