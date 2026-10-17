# Estimated radio coverage visibility

Original change recorded 2026-10-16; browser validation refreshed 2026-10-17 UTC.

The AP coverage checkbox previously changed only when the entire settings form was applied. Its canvas circle also used about 3% fill opacity and a faint, scaling outline, making large coverage areas hard to distinguish from the workspace.

The checkbox now immediately updates the workspace display preference. Closing the dialog leaves it enabled; unchecking removes it immediately. The overlay uses a contrasting dashed boundary, visible shading, an inner distance ring and an estimated range label. Selecting its AP strengthens the overlay. Its stroke does not shrink with zoom, and dark mode has dedicated contrast. The AP settings explain when PoE or an enabled radio is unavailable. Coverage remains an estimate and does not imply successful authentication or addressing.

## Validation

The final sequential browser run passes **eight checks**, with no page errors, against the held HTML SHA256 `230e3d26868f8d1c868bb6f1d09ea4bf343c65ab09fd1ce1030d6ef72d852499`. The durable [radio browser record](../audits/radio-browser-validation.json) includes source/build hashes, fixture metadata, browser version and temporary localhost URL. The refreshed light/dark screenshots were visually inspected: coverage shading, boundary, inner ring and distance label remain clear. This concerns estimated coverage visibility; it does not establish calibrated RF performance.

Original validation:

- `npm run typecheck`: passed.
- `npm run build`: passed; offline HTML rebuilt.
- `node --test --test-concurrency=1 tests/ap-controller-config.test.ts tests/poe.test.ts tests/wireless.test.ts`: 61 passed, zero failed.
- `node scripts/browser-radio-coverage.mjs`: eight checks passed, no browser errors.

Browser checks exercise immediate selection without Apply, visible styling and label, zoom, dark theme, immediate removal, persisted selection after reload, and the unpowered AP explanation. Light/dark screenshots were visually inspected. The test uses an isolated browser context and a temporary static preview; it does not modify the user's active lab.

Browser results and screenshots are in `.cache/radio-coverage-browser/`. The original failure probe is in `.cache/coverage-probe.log` and `.cache/coverage-before.png`.

## Changed paths

- `src/main.ts`: coverage area, distance ring and label rendering.
- `src/styles.css`: contrast, selected state, dark theme and fixed-width strokes.
- `src/wireless-ui.ts`: immediate toggle and availability explanation.
- `scripts/browser-radio-coverage.mjs`: browser regression.
- `docs/features/wireless-nodes.md`: usage guidance.
