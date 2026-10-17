# Implementation validation results

This is the historical fidelity snapshot delivered in commit `4bf5cda`. The subsequent timed IOS reload feature has its own [current implementation and validation](../testing/ios-reload-validation.md). Source/build “current” labels below apply to this recorded audit snapshot.

Generated 2026-10-17T02:23:18.308Z. This report records the delivered simulator build and measured acceptance. A passing implementation suite does not assert exhaustive native vendor equivalence.

| Check | Result |
| --- | --- |
| Initial full check | 517 tests; 517 passed; typecheck/build passed |
| Latest combined suite | 894 tests; 894 passed; 0 failed |
| Latest typecheck | Passed |
| Latest standalone build | Passed |
| Restored sandbox probes | 4748 pairs across 3666 old mode/path registrations; 19 focused followups |
| Acceptance source snapshot | source-snapshots-stable; 0 stale inputs |
| Inventory source hashes | Current |
| windows-browser-validation.json | 16 checks; 0 browser errors; artifact current; file:///Users/erikpope/projects/NetworkSim/index.html |
| model-driven-browser-validation.json | 10 checks; 0 browser errors; artifact current; file:///Users/erikpope/projects/NetworkSim/index.html |
| aaa-accounting-browser-validation.json | 6 checks; 0 browser errors; artifact current; public YAML import in isolated headless profile; local static HTML preview |
| server-services-browser-validation.json | 9 checks; 0 browser errors; artifact current; Isolated public YAML import in local static HTML preview |
| ap-controller-browser-validation.json | 8 checks; 0 browser errors; artifact current; http://127.0.0.1:49377 |
| wlc-reference-browser-validation.json | 14 checks; 0 browser errors; artifact current; http://127.0.0.1:49709 |
| wlc-administration-browser-validation.json | 7 checks; 0 browser errors; artifact current; http://127.0.0.1:49378 |
| automation-browser-validation.json | 11 checks; 0 browser errors; artifact current; Public YAML import into standalone file:// HTML in isolated headless profile |
| physical-snmp-browser-validation.json | 9 checks; 0 browser errors; artifact current; Standalone file:// HTML, public YAML import, isolated headless profile |
| client-profiles-browser-validation.json | 11 checks; 0 browser errors; artifact current; Standalone file:// index.html, isolated profile, public YAML import |
| standalone-ap-browser-validation.json | 7 checks; 0 browser errors; artifact current; http://127.0.0.1:49376 |
| ftp-browser-validation.json | 7 checks; 0 browser errors; artifact current; Standalone file:// index.html; isolated public YAML import |
| phone-browser-validation.json | 12 checks; 0 browser errors; artifact current; isolated local static HTML preview |
| console-browser-validation.json | 9 checks; 0 browser errors; artifact current; isolated local static HTML preview |
| workspace-browser-validation.json | 7 checks; 0 browser errors; artifact current; isolated local static HTML preview |
| radio-browser-validation.json | 8 checks; 0 browser errors; artifact current; http://127.0.0.1:50149 |
| ../testing/wireless-browser-results.json | 24 checks; 0 browser errors; artifact current; http://127.0.0.1:50033 |

Source/test provenance: [final acceptance snapshot](final-check-snapshot.json). Suite log: `.cache/fidelity/phase2/final-check.log`. Generated standalone `index.html`: 3406080 bytes; SHA-256 `230e3d26868f8d1c868bb6f1d09ea4bf343c65ab09fd1ce1030d6ef72d852499`. The direct-disk browser run exercises actual in-memory network operations and packet inspection. It uses an isolated browser profile and does not reset the user's lab.

All ten node families were source-reviewed and have behavioral integration evidence, detailed in [node inventory](networksim-node-inventory.md), [protocol audit](protocol-fidelity-audit.md) and [cross-device tests](cross-device-integration.md). 1036 IOS command paths, 44 Windows variants and 43 Linux/macOS variants are inventoried. 6043/6043 exact IOS registrations were reached in the current parser sweep; representative parser checks and bounded behavioral cases are reported separately from complete native-reference equivalence. WLC/wireless forms have 143 editable templates, including 96 WLC templates, all classified partial under the strict audit contract.

The exam matrix indexes 284 numbered parent/child rows across four published versions. No practical objective is marked fully reference-verified from test names alone. Complete CCNA/ENCOR/ENARSI or guaranteed exam Simlet coverage is **not claimed**.

| Blueprint | Indexed rows | Practical leaves reviewed | Native-certified complete |
| --- | ---: | ---: | ---: |
| CCNA 200-301 v1.1 | 111 | 27 | 0 |
| CCNA 200-301 v2.0 | 59 | 39 | 0 |
| ENCOR 350-401 v1.2 | 59 | 20 | 0 |
| ENARSI 300-410 v1.1 | 55 | 44 | 0 |

The supplemental practical ledgers state direct/composed evidence and explicit external-product or service exclusions.

| Command assessment | Count |
| --- | ---: |
| IOS full behavioral/native status: complete | 0 |
| IOS full behavioral/native status: partial | 236 |
| IOS full behavioral/native status: missing | 0 |
| IOS full behavioral/native status: incorrect | 0 |
| IOS full behavioral/native status: unsupported | 6 |
| IOS full behavioral/native status: untested | 5801 |
| Windows narrow complete / partial / unsupported variants | 5 / 36 / 3 |
| Linux/macOS declared variants | 43 |

Exact continuation registry changes are in [registry delta](phase2-command-registry-delta.json); changed handlers are not relabeled as verified command repairs.

REA evidence is the genuine captured Packet Tracer ISR4331 fixture. No real IOS XE17.12/CML or native Windows runtime was available. Missing comparisons remain explicit; protocol/GUI approximations are not certified by the passing regression.

See [known limitations](known-limitations.md), [command coverage](cli-command-coverage.md), [compatibility targets](cisco-compatibility-matrix.md), and [implementation progress](implementation-progress.md). The [explicit source/test review surface](changed-files.json) groups the overall audit, and the [continuation file delta](phase2-changed-files.json) records exact before/after bytes from its immutable archive. Shared concurrent changes remain included without invented authorship attribution.
