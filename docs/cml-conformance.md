# Cisco CML conformance workflow

NAT/PAT capture, packet evidence, replay and offline browser checks are documented in [the NAT/PAT audit](audits/cml-nat-fidelity.md). The reusable runner is `scripts/cml/nat_workflow.py`; the portable exercise is `examples/nat-pat-ios-nxos.netsim.yaml`.

This is an on-demand developer workflow for comparing NetworkSim with actual IOS, IOS XE and NX-OS images. It runs outside the application. The delivered simulator remains an offline HTML application and never contacts CML.

The first scenario, `scripts/cml/scenarios/management.json`, creates five nodes with four isolated links: IOSv, IOL XE, Nexus 9000v, an IOSv probe and a modern IOL XE SSH probe. The second probe avoids an observed SSH negotiation abort between the older IOSv client and IOS XE 17.18. It is not a simulator workaround. It checks VTY admission, missing line passwords, local users, privileged login, Telnet transport filtering and SSH feature enable/disable. Each run records the exact image IDs, `show version` output, console transcripts, command results and PCAP files. It does not certify other protocols or every command on those images.

The completed first run and its remaining output differences are recorded in [CML management conformance](audits/cml-management-fidelity.md). Reviewed output excerpts and hashes are in `scripts/cml/fixtures/management-observations.json`.

## Install the developer tools

Run from the repository root on macOS or Linux, with Python 3.10+, Node 24.15+, `curl` and OpenSSH installed:

```sh
python3 -m venv .cache/cml-venv
.cache/cml-venv/bin/python -m pip install -r scripts/cml/requirements.txt
```

The workflow uses system `curl` and `ssh` clients. This matters on macOS: Local Network permissions can affect Python or Node sockets differently from the built-in clients. A working browser alone does not establish that a Python API client can connect.

Use the CML application account, rather than the maintenance/cockpit account. Passwords are read with a hidden prompt, or from `CML_PASSWORD` for an existing protected automation environment. Controller passwords and bearer tokens are never placed in command arguments or saved in the evidence. The node password in the scenario is a public, synthetic lab credential; it must never be reused outside the isolated lab. Telnet PCAPs contain that synthetic password.

## Connect and inspect available images

Set the controller URL and verify its SSH host key using your trusted CML console or administrator before adding it to a known-hosts file. The capture runner requires host-key checking; it does not automatically trust a new key.

```sh
export CML_URL=https://192.168.1.201
.cache/cml-venv/bin/python scripts/cml/capture.py \
  --url "$CML_URL" --user admin --insecure \
  --inventory --out .cache/cml-runs/inventory-01
```

`--insecure` explicitly permits the lab controller's self-signed HTTPS certificate. Omit it when using a trusted certificate. The inventory command reads system, node, image and lab metadata without changing labs. Select the installed image IDs and physical port labels in the scenario before a capture; an unavailable image is an error, never a skipped test.

## Capture a fresh reference run

```sh
.cache/cml-venv/bin/python scripts/cml/capture.py \
  --url "$CML_URL" --user admin --insecure \
  --scenario scripts/cml/scenarios/management.json \
  --known-hosts "$HOME/.ssh/known_hosts" \
  --out .cache/cml-runs/management-01
```

Choose a new output directory for each run. The runner creates a uniquely named `NetworkSim fidelity …` lab. It never connects the test devices to an external connector and never edits an existing user lab. Only the lab created by the run is stopped during cleanup. Labs are retained for inspection; nothing is wiped or deleted automatically. NX-OS can take several minutes to boot. The runner reads the real NX-OS image filename from `show version`, or from the single actual NX-OS `.bin` file in `dir bootflash:` when a fresh VM truncates the version field. It saves the boot variable and waits for a confirmed configuration save, so the retained lab can boot again. Ambiguous filenames or an unconfirmed save stop the run. These hardware preparation commands are recorded separately; they are not claimed as simulator features.

The runner stops on a rejected CLI command, unexpected prompt/output, or timeout. A failed run retains its partial evidence and is not a reference pass. `--keep-running-on-failure` leaves the owned lab running for diagnosis; stop it when finished. `--resume` is restricted to an owned run interrupted **before its first test step**, with the same scenario hash, lab marker and node IDs. It cannot resume a partially executed configuration scenario as if it were a fresh baseline.

## Replay and compare

```sh
npm run cml:replay
python3 scripts/cml/compare.py \
  --scenario scripts/cml/scenarios/management.json \
  --capture .cache/cml-runs/management-01/capture.json \
  --replay .cache/cml-runs/replay.json \
  --out .cache/cml-runs/comparison.json
```

Replay uses NetworkSim's CLI sessions and delivered packets. It does not inject configuration or invented protocol state. Negative connection tests must fail for the expected reason, while positive tests must reach the expected authenticated prompt and execute a command.

Comparison requires the same scenario hash, a complete ordered set of passing steps, version evidence for every node, and intact nonempty PCAPs. It rechecks raw command output instead of trusting saved pass flags. Management scenarios require TCP management handshakes on each captured link. Operational scenarios instead require their declared OSPF, STP, CDP, LLDP, ICMP and ICMPv6 packet counts across intact link captures. Each capture must have a distinct owned link identity. Operational command observations require complete ordered coverage and recorded actual running configurations. Missing captures, timeouts, rejected commands and altered evidence block comparison.

Only terminal control codes, carriage returns, command echo and trailing spaces are normalized. Other output differences remain visible in unified diffs. `output-review-required` is not a full fidelity pass. Review each difference against the captured image/version; do not erase fields or add permissive patterns merely to obtain a green result.

## Audit operational commands with real traffic

`scripts/cml/scenarios/operations.json` creates IOSv, IOSvL2, Nexus 9000v, IOL XE and an outside IOSv router on five isolated links. Fourteen positive tests check OSPF adjacency, end-to-end IPv4 PAT, NAT entries, ACL hit counters, IPv6 routing, STP root/alternate roles, dynamic MAC learning, CDP and LLDP. It then surveys all 20 requested show commands on four platform types (80 observations). Rejected command forms are recorded as observations, never mistaken for implemented features or positive operational passes. Slow console dumps may take several minutes.

```sh
.cache/cml-venv/bin/python scripts/cml/capture.py \
  --url "$CML_URL" --user admin --insecure \
  --scenario scripts/cml/scenarios/operations.json \
  --known-hosts "$HOME/.ssh/known_hosts" \
  --out .cache/cml-runs/operations-01
node scripts/cml/replay.ts scripts/cml/scenarios/operations.json .cache/cml-runs/operations-replay.json
python3 scripts/cml/compare.py \
  --scenario scripts/cml/scenarios/operations.json \
  --capture .cache/cml-runs/operations-01/capture.json \
  --replay .cache/cml-runs/operations-replay.json \
  --out .cache/cml-runs/operations-comparison.json
```

Image/port mappings are explicit: IOL Ethernet ports map to simulator GigabitEthernet ports, and IOSvL2 Gi0/0–2 map to simulator Gi0/1–3. MACs, serials, software identity, clock and counters are not forced to match Cisco hardware. `simCommand` allows a documented dialect-specific positive check; all 80 survey commands remain exact, unmodified user command forms.

For diagnostics, `--reuse-owned-from PATH/capture.json` can collect a **warm observation**, restricted to read-only show commands and ping/traceroute traffic probes. It verifies the retained run marker, original scenario hash, node IDs, image definitions, and exact link IDs before starting the lab. It never reapplies startup configuration. The new report records `baseline: warm-owned-lab`, the previous report hash and every actual running configuration. Review those configurations before interpreting any comparison: warm counters, caches, ages and DR elections cannot be compared to a fresh baseline as equal numerical values. Use a new output directory. This option does not allow continuing partially executed configuration steps. Cleanup still stops only that owned lab.

The completed live run, reviewed excerpts and explicit exclusions are in [the operational audit](audits/cml-operational-fidelity.md) and `scripts/cml/fixtures/operations-observations.json`. The unchanged raw diff is intentionally `output-review-required` when platform identity, elapsed time, unmodeled telemetry, or documented interoperability differences remain.

## Turn an observation into a simulator change

1. Capture the initial configuration, failure, corrected configuration and working packet path on the real image.
2. Reproduce the difference through the simulator's CLI and network path.
3. Implement the state transition or packet behavior, including negative cases and recovery.
4. Add a regression test and replay the reference scenario.
5. Review command formatting and help separately from forwarding/authentication behavior. Record platform/version limitations.

An accepted configuration line alone is not evidence that a feature operates. NetworkSim now rejects commands whose handlers declare that they only store configuration, restoring the previous configuration instead. Such commands cannot be promoted to supported features until their runtime behavior is implemented and tested.

Run the offline workflow checks and normal project checks with:

```sh
npm run cml:test
npm run check
```

Raw evidence stays in the ignored `.cache/cml-runs/` directory. Export only reviewed, sanitized observations into repository fixtures; never commit controller credentials, bearer tokens, private lab configurations or full device-image contents.

References: [Cisco CML console server](https://developer.cisco.com/docs/modeling-labs/2-10/console-server/), [IOS login defaults](https://www.cisco.com/c/en/us/td/docs/ios/termserv/command/reference/tsv_book/tsv_a1.html), [IOS transport input](https://www.cisco.com/c/en/us/td/docs/ios/termserv/command/reference/tsv_book/tsv_s1.html).


## Operational fidelity regression scenario

Use `scripts/cml/scenarios/fidelity-regressions.json` with the same capture/replay/compare commands above and a fresh output directory. It creates a separate owned lab and runs 74 commands/checks plus the 80-command survey. It tests OSPF reference-bandwidth changes, outbound Nexus RACL deny/counters/deletion and forwarding recovery, dual root-guard failure, SVI route withdrawal and recovery. It does not require the intermittently observed IOSvL2 trunk discovery adjacency; full discovery output and PCAPs are retained for review. The original operational scenario and failed reruns remain unchanged.

The runner now waits for every linked physical port to be available after BOOTED/privileged EXEC. This prevents an early Nexus prompt from being treated as a ready linecard. Native duplicate ACL sequence errors are rejected by the evidence gate. Consult [the follow-up audit and exclusions](audits/cml-fidelity-followup.md) before promoting a feature; native CLI acceptance alone remains insufficient.

## NX-OS OSPF CLI regression scenario

`scripts/cml/scenarios/nxos-ospf.json` creates Nexus 9300v 10.6.2.F and IOL XE
17.18.02 with one link wired before boot. Its 111 commands/checks test passive
defaults and interface overrides, loopback status/cost, MTU failure and recovery,
VRF migration, scoped route withdrawal and recovery. Twelve exact show-command
observations include rejected selectors; they are observations, not positive
feature checks. Use the same capture/replay/compare commands above with this
scenario and a fresh output directory.

The MTU checks restart the IOS interface before interpreting a new database
exchange. Both adjacency and forwarding must recover. The scenario uses bounded
convergence waits and does not treat SVI/interface-up as proof of routing. IOL's
10-Mbps default differs from NetworkSim's Gigabit port; resulting numerical
route-metric differences remain visible in comparison.

The console reader recognizes a timestamped Nexus VDC syslog message appended
to an already printed prompt. It still rejects command echoes as prompt fences.
Unprefixed native `Area mismatch` is a command rejection; `Already not
configured` remains an idempotent notice. No numerical output fields are removed
to make comparisons match.

## Validate port-security with three source hosts

`scripts/cml/scenarios/port-security.json` uses IOSvL2, Nexus 9300v,
a fanout switch, three IOL source hosts and a separate transit target. All six
links are created before any VM starts. The scenario requires successful
forwarding before it interprets a third-host failure as enforcement. It then
checks sticky learning, restrict, protect, shutdown, diagnostics and manual
recovery on both platforms. Convergence waits also let pending ARP retries drain
before recovery, so a still-transmitting offender cannot create a misleading
recovery failure.

```sh
.cache/cml-venv/bin/python scripts/cml/capture.py \
  --url "$CML_URL" --user admin --insecure \
  --scenario scripts/cml/scenarios/port-security.json \
  --known-hosts "$HOME/.ssh/known_hosts" \
  --out .cache/cml-runs/port-security-01
node scripts/cml/replay.ts scripts/cml/scenarios/port-security.json \
  .cache/cml-runs/port-security-replay.json
python3 scripts/cml/compare.py \
  --scenario scripts/cml/scenarios/port-security.json \
  --capture .cache/cml-runs/port-security-01/capture.json \
  --replay .cache/cml-runs/port-security-replay.json \
  --out .cache/cml-runs/port-security-comparison.json
```

An echoed `show interfaces status err-disabled` is not proof that a port is
error-disabled. Assertions now ignore the command echo; the NX-OS check requires
the native `secViolErrDis` row. Native unprefixed secure-MAC limit rejections are
failures as well. Failed baselines remain failed captures, never reference passes.

The portable [IOS example](../examples/ios-port-security.netsim.yaml) and
[NX-OS example](../examples/nxos-port-security.netsim.yaml) open in the offline
application. Ping the target from PC1 and PC2 first, then PC3. The example starts
in restrict mode. NX-OS port-security currently accepts standalone physical access
ports; aggregate/vPC synchronization, per-VLAN limits, security MIBs and
port-security-specific SNMP notifications remain unavailable.

The current reviewed run is **not a native fidelity pass**. IOS checks passed,
but the installed Nexus 9300v 10.6(2) forwarded the third source in both restrict
and protect modes despite reporting a violation. The strict run stopped at
`s068`; supplemental captures confirmed the behavior after settling. Shutdown
and timer recovery operated. See [the port-security audit](audits/cml-port-security.md)
and the reviewed `scripts/cml/fixtures/port-security-observations.json` evidence.
Do not remove the denial assertions to make this image pass. The simulator's
packet tests enforce the documented security policy independently.

### AAA, RADIUS and TACACS+ interoperability

The dedicated [AAA workflow and audit](audits/cml-aaa-fidelity.md) uses real FreeRADIUS/tac_plus-ng daemons, paced SSH sessions, server logs and protocol-aware packet gates. It covers IOS named servers and native NX-OS hosts/groups/VRFs, local/error fallback, separate privilege/role handling and accounting. The checked-in [42-group matrix](../scripts/cml/aaa/scenario.json) replays through `scripts/cml/aaa_replay.ts`. Native results retain three unresolved Nexus differences; the simulator passes the documented semantic contracts. Import `examples/aaa-ios-nxos.netsim.yaml` for an offline exercise.
