# IOS help and Tab completion correction

The reported `int gi?` and `interface ?` cases exposed a generic argument placeholder instead of interface syntax. Tab treated every physical port as a competing completion, so a shared type prefix could not expand. It could also complete `lo7` to a different existing ID (`Loopback70`), and a blank interface argument could select `range` without a typed prefix. Terminal completion inside an existing word could duplicate the remaining text or separator.

The correction uses live interface types and numeric components for help. `interface ?` includes keyword branches such as `range` alongside interface types. `interface gi ?` and `interface gi0/?` show applicable number ranges; a completed interface followed by a space offers `<cr>`. Interface ranges provide end-port guidance. Tab expands a unique type while preserving the exact numeric text and leaves ambiguous or blank arguments unchanged. Completing `lo7` now produces `Loopback7`, rather than choosing another configured ID. A type without a number remains an incomplete token awaiting its identifier.

Caret edits preserve the number after the caret, reuse an existing completed word suffix and separator, and retain selected text when completion makes no change. Help preserves the input draft, selection and paging state.

The behavior follows Cisco's distinction between [partial-word help, next-argument help and unique-prefix completion](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/configuration/xe-16-12/fundamentals-xe-16-12-book/cf-cli-basics.html). Cisco's [interface help example](https://www.cisco.com/c/en/us/td/docs/routers/asr903/software/guide/chassis/17-1-1/b-config-guide-xe-17-1-1-asr900/using_cisco_ios_xe_software.html) demonstrates the progression through interface type, slot and port components. Number ranges here describe the simulator's interfaces and supported virtual-interface bounds; they do not certify every native platform's grammar.

Validation on the final artifact:

- Type checking and the standalone build passed; root and `dist/index.html` are identical.
- **930 tests passed, zero failed.** The 12 new tests cover six IOS-style node kinds, interface types and numeric components, virtual/subinterface IDs, invalid and ambiguous input, ranges, `no`/`default`/`do`, routing arguments, output filters, caret edits and read-only help/completion behavior. Updated prior expectations that required a generic placeholder or numeric guessing.
- **11 browser completion/help checks passed**, including the exact reported inputs, real Tab/Ctrl-I/question-mark events, selecting and configuring the intended port, caret positions and paged help draft restoration.
- **9 browser console-paging regression checks passed**, including resizing, wrapping, Enter/Space/Q/Escape, and restoration after context help. No page errors occurred.
- Browser checks used isolated `file://` sessions and a disposable YAML lab. The user's active lab was not changed. The localhost preview serves the same tested HTML.

Artifact SHA-256: `7ee19f50b6d7120d514987f43a8fd06ed0ac8496770bcbb2079477ab43f140df`.

Evidence: [validation snapshot](ios-completion-validation.json), [completion browser checks](ios-completion-browser-results.json), [paging browser checks](ios-completion-paging-browser-results.json). Reproduction scripts: `scripts/browser-ios-completion.mjs` and `scripts/browser-console-paging.mjs`.
