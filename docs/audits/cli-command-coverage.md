# Command discovery and audit status

Generated 2026-10-17T02:23:18.308Z. **Representative parser execution and behavioral fidelity are separate measures.** Current-profile parser/help/invalid-input evidence is recorded for each exact reached registration; passing a representative invocation does not certify every native argument or output.

1036 distinct canonical IOS paths occur in 6043 node/path/handler definitions (760 handler identities). Inherited mode/context registrations are consolidated; these are not tens of thousands of unique commands. Windows has 17 parser roots and 44 explicit variants, represented across three host profiles. Linux/macOS add 43 separately inventoried variants. No native operating-system shell is executed.

| Node | IOS definitions | Windows variants |
| --- | ---: | ---: |
| router | 1008 | 0 |
| switch | 991 | 0 |
| l3switch | 1019 | 0 |
| poeswitch | 993 | 0 |
| wlc | 1039 | 0 |
| ap | 993 | 0 |
| pc | 0 | 44 |
| laptop | 0 | 44 |
| server | 0 | 44 |
| phone | 0 | 0 |

| Strict IOS status | Count |
| --- | ---: |
| complete | 0 |
| partial | 236 |
| missing | 0 |
| incorrect | 0 |
| unsupported | 6 |
| untested | 5801 |

**Zero whole IOS definitions are certified across every argument and all eight required validation levels.** This does not mean the commands do nothing; many have actual forwarding tests. It means no unmeasured option/default/negation/reference path has been silently promoted. Windows' 5 complete variants are narrow local operations; 36 are partial and 3 unsupported. Native Windows output equivalence is unverified.

The machine-readable [coverage inventory](coverage-inventory.json) records node, target, canonical path, arguments, modes/contexts, parser source candidate, handler hash, state/calls, subsystem, packet/persistence/negation scope and status. [Audit summary](audit-summary.json) joins test-source pointers without asserting that every match is a positive behavioral test. Whole-command historical repair totals are not measurable without an original immutable baseline. The [continuation registry delta](phase2-command-registry-delta.json) measures added/removed paths and changed handlers against the preserved continuation baseline, while [exact changed files](phase2-changed-files.json) compares bytes. These units are not silently relabeled as repaired commands. Windows variant change classifications remain separately counted.

All 18 discovered chapters of the pinned Catalyst 9300 command book were indexed automatically: 1328 headings (1307 distinct). 277 exact registration matches, 187 parent-handler candidates and 864 without registry matches are discovery facts only. Additional platform commands are not automatically exam requirements; prefix handlers may reject them. Catalog headings without a matching implementation remain candidates; platform relevance and objective requirements must be assessed separately from keyword matches.

The restored sandbox was independently executed in an isolated read-only VM. [Fresh paired probes](command-probe-validation.json) record 4748 attempts across 3666 old mode/path registrations, including positive/no/default forms. Reference hashes were verified: true. Snapshot validity: source-snapshots-stable; stale current runtime sources: none. This unit differs from the new registry inventory. The bulk comparison and [focused followups](command-probe-followups.json) retain its current source identity and additional non-default removal/replay checks (19 checks; stale supplemental runtime sources: none). Acceptance and rendered-state agreement remain partial evidence; [readable comparison](command-probe-validation.md) and [difference triage](command-probe-triage.json) separates defaults, invalid fixtures and concrete omissions.

Context setup failures remain in the inventory rather than disappearing from the denominator. Generic IOS commands still exposed on the AP are flagged as shared teaching commands whose real lightweight-AP applicability is unverified. The independently coded help grammar and GUI/CLI validators remain duplication risks.

## Current parser execution

6043 exact node/path/handler definitions measured; 6043 reached, 5928 accepted positive representatives, 21791 total positive/no/default observations. Registry/help safety failures: 0. Known-invalid atomicity failures: 0/54. Snapshot: source-snapshots-stable. Read the artifact for profile exclusions, rejected structural parents and untested argument limits.

## Reproduce

Run Node24: `node scripts/audit-windows-commands.mjs`, `node scripts/audit-wireless-gui.mjs`, `node scripts/audit-model-driven-management.mjs`, `node scripts/fidelity-inventory.mjs`; then `python3 scripts/audit-exam-objectives.py`, `python3 scripts/audit-reference-commands.py`, and `node scripts/report-fidelity-audit.mjs`. The objective generator requires the locally cached official PDF/text references. Source digests must be refreshed after implementation changes.

Stale inventory sources at report generation: none.
