# IOS reload validation

IOS `reload` now streams a shortened bootstrap, image-load, initialization and startup-configuration sequence, holds the console and actual link forwarding during startup, and requires Enter before the next console login. Scheduled and WLC GUI reloads use the same lifecycle. See the [reload guide](../features/ios-reload.md).

| Check | Result |
| --- | --- |
| Full combined regression | 906/906 passed; zero failures |
| TypeScript | Passed |
| Offline build | Passed; root and dist HTML identical |
| New timed-boot cases | 12 passed, including all six IOS-style node profiles |
| Visible boot workflow | 7 checks passed |
| Existing console paging | 9 checks passed |
| WLC administration/reload | 7 checks passed |
| Browser errors | Zero |
| Source/test changes during the full run | Zero |

The new cases exercise real traffic failure/recovery, ordered staged output, console input/help blocking, multiple-console privilege reset, saved authentication, configuration-register bypass, scheduler deadlines, power/lab replacement cancellation, AP PoE preservation and SSH disconnect/reconnect without leaking physical-console boot messages.

Artifact SHA-256: `db25244569d24da494a7cec68fe8b067fcaf4f940f1d9d3050bc081a692aec4c`. All 23 browser checks used this same HTML. Each durable browser record and exact source/test/build input hash is retained in [the validation JSON](ios-reload-validation.json). The full log is `.cache/ios-boot-check.log`.

These are simulator behavior checks. The symbolic image loading and compressed 6.5-second clock sequence do not execute firmware, hardware POST or ROMMON. The earlier broad command/objective audit remains a historical snapshot in commit `4bf5cda`; it is not silently presented as a rerun of every command path after this change.
