# Server DHCP DNS validation

Validated the standalone build on 2026-10-17 UTC. This is incremental feature validation; the older full command-fidelity audit remains a historical snapshot.

- `npm run typecheck`: passed.
- `npm test`: **918 passed, 0 failed**, including 10 DHCP/DNS integration tests and two new service-form tests.
- `npm run build`: passed; root and `dist/index.html` are byte-identical.
- `node scripts/browser-dhcp-dns.mjs`: **9 checks passed**, no browser page errors, using an isolated YAML lab opened through `file://` in Chrome. The user's active lab was not changed.
- The local preview at `127.0.0.1:4173` serves the same tested HTML.

Engine checks cover acknowledged versus offered leases, both-service and Server-only gates, received hostnames, short/FQDN names, real UDP/53 delivery, renewal, release, address replacement, expiry and TTL, manual A/CNAME precedence, invalid names and duplicate ownership, runtime rebuild, relayed DHCP and declined address conflicts. Form checks cover automatic-record separation, safe service saves and transactional domain validation.

Browser checks cover configuring the pool domain, enabling DNS after lease allocation, read-only automatic rows, live refresh without losing manual drafts, unrelated service saves, console DNS/ping, desktop DNS lookup, release/NXDOMAIN, and reacquisition. Light and dark layouts were visually inspected.

Artifact SHA-256: `a933008857908abc47d4accb7c24b3286c75b88c2022d925f8773290b2fcc15d`.

Machine-readable evidence: [validation](dhcp-dns-validation.json) and [browser checks](dhcp-dns-browser-results.json). Behavior and boundaries are described in the [feature guide](../features/dhcp-dns.md).
