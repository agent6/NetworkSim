# Reference-engine audit

This document records behavioral observations of the user-supplied Network Sandbox copy at `/Users/erikpope/projects/NetworkSim/network-sandbox`. The new simulator is an entirely original implementation. No reference implementation, assets, command catalogs, or source fragments are included here or reused in it.

Audit date: 2026-10-16. The audit was read-only. No applicable AGENTS.md was found. Existing automated tests ran in an isolated headless Chrome profile with network access disabled; no further browser inspection is needed to use this evidence.

## Existing regression evidence

Command: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test --test-concurrency=1 tests/*.test.cjs` from the reference directory.

Observed result: 895 reported tests, 891 passed, 4 failed, 56.9 seconds. The four failures consist of three CLI assertions plus their enclosing suite. All protocol suites passed. An independent CLI rerun returned 66/70 reported passes with the same failures.

The failed cases were on-screen Tab completion at a cursor within a line, on-screen question-mark help at that cursor, and insertion of an on-screen question mark into a password. References: `tests/cli.test.cjs:255`, `:261`, and `:344`. Logs produced during the audit were `/tmp/network-sandbox-engine-audit-tests.log` and `/tmp/network-sandbox-engine-audit-cli-rerun.log`; these are temporary evidence, not distribution files.

The reference has 65 registered feature families and extensive protocol tests. Passing these tests is evidence for the scenarios they exercise, not proof of complete Cisco IOS, ENCOR, or ENARSI behavior.

## Reproduced correctness cases for the original implementation

### MTU and Don't Fragment

Two directly connected routers were given IPv4 addresses in the same subnet and `ip mtu 1200` on their connected interfaces. After a normal ping warmed ARP, `ping 10.0.0.2 size 18000 df-bit` returned five successful replies. The observed interface IP MTU was 1200. A subsequent 100-byte ping also returned five replies.

The new engine must reject an oversized IPv4 packet with DF set at the relevant egress, provide a useful packet trace/error, and support fragmentation and destination reassembly when DF is clear. IPv6 forwarding must return Packet Too Big rather than fragment in a router. Include routed and tunnel-overhead cases as the model expands.

Reference inspection locations: `js/cli/commands/icmp.js:605` carries the DF flag; `js/core/ip.js:539` is outbound forwarding. No data-plane fragmentation/reassembly path was located by searches of core and protocol sources. MTU was used by OSPF adjacency compatibility checks.

### Monotonic simulation time

A deterministic isolated scheduler reproduction started its wall source at 1000, selected 10× speed, advanced that source to 2000, then selected 1×. Reported simulation time moved from 11000 backward to 2000.

The original core should use a single monotonic simulation time independent of browser wall time. Any UI speed multiplier changes how much virtual time advances, not the stored clock timestamp. Reference locations: `js/core/scheduler.js:29` and `:320`.

### Cancellation during a running interval

A repeating 1 ms callback canceled all work for its own device. Advancing by 3 ms still executed it three times and left one item pending. A callback resetting the scheduler on its first run produced the same result. The running item had been removed from the queue before cancellation and was reinserted after its callback.

The original scheduler must check reset epochs and owner generations before requeueing repeating work. Tests must cancel/reset from inside a callback, not only from outside the scheduler. Reference locations: `js/core/scheduler.js:137`, `:258`, and `:379`.

### Bounded manual advancement

An ordinary zero-delay callback that scheduled itself again prevented manual `advance(1)` from returning. An isolated VM's execution timeout interrupted the reproduction. The per-drain cap did not bound the surrounding advancement loop, and the packet budget did not apply to ordinary timers.

The original clock must enforce a total event budget for every advance or step and return a continuation state when it exhausts that budget. Reference location: `js/core/scheduler.js:330`.

## Design implications

- Record actual transmission, reception, forwarding decisions, ARP resolution, routing, and drop reasons as structured events with stable packet lineage. Animation should consume those events, not infer success from the drawing.
- Preserve a clear distinction between configuration, operational state, and saved startup configuration.
- Avoid treating help catalogs as implemented protocol support. Explicitly disclose unsupported behavior.
- Test real cabled topologies, link failures, VLAN isolation, route selection, return paths, TTL expiry, MTU errors, and timer cleanup.
- Keep core models independent of DOM, browser storage, real sockets, and backend services. Ship compiled local JavaScript and local Tailwind CSS for direct offline HTML opening.
- The reference's SPAN implementation counts/marks traffic rather than preserving original mirrored frames (`js/protocols/span.js:22`); it should not be treated as evidence of a full packet-capture implementation.

These observations guide independent tests and requirements only. They are not a complete feature specification or a claim of compatibility with every IOS platform/release.
