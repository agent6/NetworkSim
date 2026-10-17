# Validation checkpoint — full fidelity work remains open

Generated 2026-10-17T01:04:07.266Z. This file records actual checks at this checkpoint; its filename does not mean the entire requested audit is complete.

| Check | Result |
| --- | --- |
| Initial full check | 517 tests; 517 passed; typecheck/build passed |
| Latest combined suite | 695 tests; 695 passed; 0 failed |
| Latest typecheck | Passed |
| Latest standalone build | Passed |
| Restored sandbox probes | 4757 pairs across 3666 old mode/path registrations; 19 focused followups |
| Inventory source hashes | Current |
| windows-browser-validation.json | 16 checks; 0 browser errors; file:///Users/erikpope/projects/NetworkSim/index.html |
| model-driven-browser-validation.json | 10 checks; 0 browser errors; file:///Users/erikpope/projects/NetworkSim/index.html |
| aaa-accounting-browser-validation.json | 6 checks; 0 browser errors; public YAML import in isolated headless profile; local static HTML preview |
| server-services-browser-validation.json | 9 checks; 0 browser errors; isolated headless Chrome; public YAML import; ephemeral localhost static HTML preview |
| ap-controller-browser-validation.json | 8 checks; 0 browser errors; http://127.0.0.1:59698 |
| wlc-reference-browser-validation.json | 14 checks; 0 browser errors; http://127.0.0.1:59605 |
| ../testing/wireless-browser-results.json | 24 checks; 0 browser errors; file:///Users/erikpope/projects/NetworkSim/index.html |

Suite log: `.cache/fidelity/final-check.log`. Generated standalone `index.html`: 3455267 bytes; SHA-256 `52eb22827f202dfe03db3808912edc1ad2b00b31efc88620a7a3a964b336070a`. The direct-disk browser run exercises actual in-memory network operations and packet inspection. It uses an isolated browser profile and does not reset the user's lab.

All nine node families were source-reviewed and have behavioral integration evidence, detailed in [node inventory](networksim-node-inventory.md), [protocol audit](protocol-fidelity-audit.md) and [cross-device tests](cross-device-integration.md). 994 IOS command paths and 41 Windows variants are inventoried; whole-catalog eight-level verification remains open. WLC/wireless forms have 74 editable templates, including 44 WLC templates, all classified partial under the strict audit contract.

The exam matrix indexes 284 numbered parent/child rows across four published versions. No practical objective is marked fully reference-verified from test names alone. Complete CCNA/ENCOR/ENARSI or guaranteed exam Simlet coverage is **not claimed**.

REA evidence is the genuine captured Packet Tracer ISR4331 fixture. No real IOS XE17.12/CML or native Windows runtime was available. Missing comparisons remain explicit; protocol/GUI approximations are not certified by the passing regression.

See [known limitations](known-limitations.md), [command coverage](cli-command-coverage.md), [compatibility targets](cisco-compatibility-matrix.md), and [implementation progress](implementation-progress.md). The [explicit source/test review surface](changed-files.json) groups paths and hashes, while recording the missing immutable baseline and shared concurrent edits. It is not an invented Git diff.
