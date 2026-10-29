# AAA, RADIUS and TACACS+ conformance

Validated 24 October 2026 against CML 2.10.0, IOS XE IOL L2 17.18.2 and C9300v NX-OS 10.6(2), using real OpenSSH sessions, FreeRADIUS 3.2.7 and tac_plus-ng. The browser remains fully offline; CML and Linux daemons are development references only.

## Results

The native matrix completed **42 groups: 39 passed and 3 retained differences**. The identical simulator matrix passes **42/42**. This is a bounded AAA validation, not certification of every Cisco AAA feature or byte-for-byte native output.

Both captured data links contain RADIUS Access-Request, Access-Accept, Access-Reject, Accounting-Request and Accounting-Response messages, plus TACACS+ authentication, authorization and accounting requests and replies. The server received EXEC Start/Stop from both platforms. Actual configuration changes on Nexus generated command accounting. PCAP SHA-256 hashes, counts, probe results, exact plan hash and unresolved differences are retained in [the reviewed fixture](../../scripts/cml/fixtures/aaa-observations.json). Full private transcripts, server logs and captures are in `.cache/cml-aaa/final/`.

| Native difference | Evidence and simulator treatment |
| --- | --- |
| `aaa-015`: NX-OS RADIUS operator logout | Authentication, operator role and write denial passed; SSH did not close within the probe's 25-second limit. This remains a failed group. |
| `aaa-019`: NX-OS logout after a shared-key error | Local fallback authenticated correctly and returned the administrator role. Logout exceeded 25 seconds while remote accounting was also unable to authenticate its server responses. This remains a failed group. NetworkSim accounting failure is asynchronous and does not hold the shell open. |
| `aaa-039`: local role applied after remote caching | Adding a local administrator account for a username already cached through remote authentication did not replace its operator role on this image. NetworkSim follows Cisco's documented local-role precedence. This runtime-cache difference remains visible; it is not described as a native pass. |

The owned native lab was stopped. The user's pre-existing lab remained STARTED.

## Runtime changes

- RADIUS and TACACS+ use distinct ACCEPT/REJECT versus protocol-error outcomes. A valid rejection stops method-list fallback. An unavailable server, RADIUS shared-key failure or TACACS+ protocol/key error permits the next server/method. Tests exercise packets through actual simulated routing, links and services.
- IOS RADIUS EXEC authorization reuses attributes from that session's Access-Accept. It no longer fabricates a separate passwordless authorization transaction for that login. TACACS+ authentication and EXEC authorization remain independent exchanges. Denied IOS EXEC access creates no accounting Start.
- Authentication/authorization/accounting statistics now describe the NAS client's actual requests and replies. Server receiver logs remain separate. `show aaa servers`, `show radius statistics`, `show tacacs` and native NX-OS server/statistics commands expose measured logical counters. Unmodeled binary and socket counters are not fabricated.
- NS-OS adds IPv4 `radius-server host`, `feature tacacs+`, `tacacs-server host`, native `aaa group server` / `server ADDRESS` / `use-vrf`, default login authentication and automatic local fallback on errors. Group VRF selection affects actual packet routing. IOS-style named-server submodes, `aaa new-model` and an explicit trailing `local` are not accepted as NX-OS aliases.
- NX-OS roles are distinct from IOS privilege levels. Server Services → AAA has separate role and IOS EXEC policy controls. Remote TACACS+ role authorization uses a second actual exchange; a denied role grant falls back to the native default operator role. Locally configured roles take precedence. Reserved NX-OS system usernames, including `operator`, are rejected.
- NS-OS `aaa accounting default group NAME` sends acknowledged SSH EXEC Start/Stop and stop-only configuration-command records through RADIUS or TACACS+. IOS retains privilege-specific TACACS command accounting; IOS RADIUS command authorization/accounting is rejected. NX-OS RADIUS command accounting is a separate supported case. Console configuration writes can also produce NS-OS command records; console EXEC Start/Stop is not modeled.
- Native-style `show user-account [NAME]` includes actual runtime remote users. NX-OS `show ... | section PATTERN` works, including the requested AAA configuration view. Help and completion expose the implemented server options.
- Facility syslog lines returned by `show logging` no longer count as parser failures.

## Reusable workflow

From the repository, using the existing CML Python environment and verified controller SSH host key:

```sh
.cache/cml-venv/bin/python scripts/cml/aaa_workflow.py \
  --url https://192.168.1.201 --insecure \
  --known-hosts .cache/cml-network/ssh-host-keys \
  --provision --output .cache/cml-runs/aaa-001
```

The controller password is entered at a hidden prompt. No real controller credentials are stored in source, arguments, fixtures or the browser application. `--insecure` is needed for this controller's certificate; SSH still checks the verified host key.

The workflow creates a dedicated owned lab, builds all links before boot, provisions the disposable Linux node through a NAT connector, installs FreeRADIUS and an immutable tac_plus-ng revision, then disables Linux NAT egress. It drives native consoles and paced OpenSSH probes, checks returned command data, gathers server logs and captures both data links. It only stops its exact owned lab. Failures remain failures. A zero SSH exit status does not by itself prove an authorized shell.

`--resume-owned-from CAPTURE.json` is restricted to an already running owned AAA lab with matching title, node identities, installed images, links and exact endpoints. A normal new run uses a new output directory and `--provision`. Linux package installation requires internet access during provisioning; the finished NetworkSim app requires none.

Replay the checked-in native vectors without CML:

```sh
node scripts/cml/aaa_replay.ts scripts/cml/aaa/scenario.json .cache/cml-runs/aaa-replay.json
python3 -m unittest discover -s scripts/cml -p 'test_*.py'
```

The replay uses public CLI sessions and real simulated service traffic. It does not inject successful protocol state. Python gates reject incomplete probes, echoed JSON masquerading as results, foreign ownership, truncated captures and missing AAA protocol directions. TACACS+ wire bodies remain encrypted; TCP packets alone never prove successful authentication. Native server logs and shell behavior provide that proof.

## Offline example

Import [aaa-ios-nxos.netsim.yaml](../../examples/aaa-ios-nxos.netsim.yaml) into NetworkSim. Open PC1 → Command Prompt:

```text
ssh remote@192.168.100.1
ssh remote@192.168.100.2
```

Use `RemotePass42!` for the remote administrator. `viewer` / `Operator42!` has IOS privilege 1 and NX-OS network-operator. `fallback` / `LocalOnly42!` is local and is intentionally rejected while the configured AAA server authoritatively rejects that username; disable the corresponding server service to test local fallback. Device console account: `admin` / `NetSimLab42!`. Shared key: `LabShared42`. These are public, synthetic lab credentials.

Server Services → AAA shows received records. Change the server role, reconnect and verify the new session's permissions. The lab ends with TACACS+ selected; RADIUS definitions are also present for method-list exercises. IOS and NX-OS use their own syntax.

## Limits

The simulator uses original logical service payloads over simulated TCP/UDP. Binary RADIUS authenticators/AVPs, TACACS+ encryption, external daemon interoperability, EAP/MFA/challenges, TLS, custom RBAC, source-interface CLI selection, AAA dead-server monitoring, exact native queue/latency/socket counters, remote-user cache expiration and exact native accounting text/redirect duplicates are outside this implementation. The NS-OS surface rejects encrypted key formats and unsupported server options. Its built-in role model remains network-admin/network-operator.

IOS RADIUS EXEC attributes are session-scoped and reused for the authenticating server; standalone authorize-only RADIUS requests are not implemented. Local-console EXEC accounting, custom privilege maps, connection/network/system/interim accounting and durable accounting storage remain excluded. NS-OS built-in local accounting storage/`show accounting log` is not implemented; its remote group accounting is operational. Server TFTP and SCP/SFTP services remain deliberately excluded.

## Primary references

- [Cisco NX-OS 10.6 AAA](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/security/cisco-nexus-9000-series-nx-os-security-configuration-guide-release-106x/m-configuring-aaa.html): native default methods, error fallback and accounting selection.
- [Cisco NX-OS 10.6 RADIUS](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/security/cisco-nexus-9000-series-nx-os-security-configuration-guide-release-106x/m-configuring-radius.html): native hosts, groups, ports and VRF selection.
- [Cisco NX-OS 10.6 TACACS+](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/security/cisco-nexus-9000-series-nx-os-security-configuration-guide-release-106x/m-configuring-tacacs.html): feature gate and role attributes.
- [Cisco NX-OS 10.6 accounts and RBAC](https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/security/cisco-nexus-9000-series-nx-os-security-configuration-guide-release-106x/m-configuring-user-accounts-and-rbac.html): reserved identities and documented local-role precedence.
- [Cisco IOS XE accounting](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/configuration_guide/sec/b_1712_sec_9300_cg/configuring_accounting.html): EXEC modes and IOS command accounting boundaries.
- [tac_plus-ng upstream documentation](https://projects.pro-bono-publico.de/event-driven-servers/doc/tac_plus-ng.html): independently running native test daemon and its policy/attribute configuration.

## Verification

The same 42 native groups replay successfully in NetworkSim. The offline Chrome run passed six end-to-end checks with zero page errors and zero HTTP requests: Windows SSH into both dialects, role enforcement, actual interface changes, received accounting, GUI role updates on reconnect, and light/dark service views. A separate fresh disposable Linux node successfully ran the complete pinned-daemon bootstrap, verified the installed daemons/Python console dependency, disabled NAT egress and stopped. The fixture includes these results and the tested standalone HTML hash.

The full simulator suite passes 1,277 tests. Focused AAA, management, file-transfer authorization, native show, role, persistence and server-service regressions also pass after the final display changes. The Python CML suite passes 22 tests. Native server images still retain the three differences above; they are not hidden by simulator test results.
