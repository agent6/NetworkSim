# Console width validation

The previous browser build reported an 80-column session in a console with room for approximately 199 columns. Even the 82-character `show ip interface brief` header was split into `Protoc` and `ol`. Output could then be wrapped a second time by viewport pagination and again by CSS word wrapping. Width zero therefore did not reliably preserve a complete line.

The active session now receives its measured viewport columns. Explicit session/line settings take precedence, including width zero. The browser preserves terminal rows, and pagination does not rewrap output that has already been formatted. Simulated SSH/Telnet requests carry the viewport metadata to remote sessions.

Final verification:

- **972 tests passed, zero failed**, including seven new terminal-width tests covering attached/default widths, wide table headers, resizing, manual/zero widths, configured console/VTY widths, Windows SSH, IOS SSH and Telnet.
- **19 browser checks passed**, with no page errors: ten width/scroll/remote checks plus nine existing paging/help checks.
- Type checking and the standalone build passed. Root and `dist/index.html` match, and the localhost preview serves the same artifact.
- Browser tests used isolated profiles and disposable labs. The user's open lab was not changed.

The width fixture measured **197 columns** at 1916 × 1000 and **73 columns** at 760 × 800 after reserving scrollbar space. The wide table header remains intact. Narrow output wraps once at the session boundary. Explicit width 132 remains unchanged in a narrow panel; width zero keeps a long description on one physical line, with working horizontal scrolling even through the pager. New commands restore the input's horizontal position. Windows SSH follows window resizing and preserves explicit remote width overrides.

The existing paging checks confirm complete unpaged output, page fitting without lost/repeated rows, Enter/Q/Escape behavior, shrinking and expanding the console, narrow output, explicit shorter page lengths and restoring a draft/caret after paged `?` help.

Artifact SHA-256: `94fcadce800075c058ab8a18e9d00de2b54da99754ec5cf8d1bb6a60abdb5bcb`.

See the [console width guide](../features/console-width.md), [validation snapshot](console-width-validation.json), [width browser checks](console-width-browser-results.json), and [paging browser checks](console-width-paging-browser-results.json). Reproduce with `node --test tests/terminal-width.test.ts`, then build and run `node scripts/browser-console-width.mjs` and `node scripts/browser-console-paging.mjs`.
