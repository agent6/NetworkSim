# CML management conformance — 2026-10-21

The local capture/replay/comparison workflow completed against CML **2.10.0+build.13**. The isolated five-node scenario completed **98/98 command steps** on real images and **98/98** through NetworkSim's CLI and packet engine. Four intact PCAPs contain **576 packets**, with successful management TCP handshakes on every link. These results establish the tested authentication/transport paths, not complete IOS/NX-OS output equivalence or CCNA/CCNP protocol coverage.

| Role | CML image |
| --- | --- |
| IOS target and legacy probe | IOSv 15.9(3)M12, `iosv-159-3-m12` |
| IOS XE target and modern SSH probe | IOL XE 17.18.02, `iol-xe-17-18-02` |
| Nexus target | NX-OS 9300v 10.6(2) / 10.6.2.F, `nxosv9300-10-6-2-f` |

## Findings implemented

- Selecting VTY configuration retains password checking. `transport input all` enables transports; it does not bypass authentication. With no line password, login closes with `Password required, but none set`. A configured line password works, and `login local` uses the configured account and privilege.
- `default login` restores VTY password checking. `default transport input` restores **SSH** on both tested IOS images. A separate **24-command** live probe verified this from both explicit `none` and `telnet` settings. The initial CML IOSv bootstrap has `transport input none`; that initial configuration is not the reset command's behavior. The IOL XE initial configuration has SSH selected.
- Fresh NS-OS devices enable SSH, matching the tested Nexus image. Local accounts still authenticate every remote session. `no feature ssh` blocks admission, `feature ssh` restores it, and configuration export/replay preserves disabled SSH.
- Remote login displays the access-verification header where observed. Remote exit closes the session and returns to the originating prompt without the simulator's local-console exit notice. Telnet refusal spacing, IOS configuration-entry spacing, Nexus configuration-entry text, `sshServer` output and `show hostname` were corrected.
- NS-OS show filters `include`, `exclude` and `begin` operate on real output and expose help/Tab completion. Invalid commands and invalid filters remain failures.
- A separate simulator regression ensures enable passwords equal to `exit` or `logout` are handled as password input, while actual EXEC exit still closes the remote session. This edge case was found by source review and verified locally; it is not an additional CML-captured case.
- Handlers declaring that a command only stores configuration now reject transactionally instead of retaining nonoperational settings. This source audit covers the explicit configuration-only handlers; it does not certify every command in the repository against Cisco hardware.

The screenshot's Telnet issue is therefore fixed by requiring the complete working line configuration. Enabling transport alone does not supply credentials.

## Evidence and remaining differences

The comparison has no missing-step, provenance, version, capture-integrity or cleanup failures. Its status remains **`output-review-required`**, with **17** differences after the fixes above:

| Difference | Affected steps | Disposition |
| --- | --- | --- |
| Cisco image legal/login banners | Seven IOSv login steps and Nexus login | Intentionally excluded from this original simulator; raw private captures retain the evidence. |
| Initial ARP warm-up | `ios-warm-arp`, `iosxe-warm-arp` | CML loses the first echo during address resolution; NetworkSim queues it. Both subsequent reachability checks pass. Timing/queue behavior remains a fidelity limitation. |
| IOL XE initial line configuration | `iosxe-factory-lines`, `iosxe-default-lines` | The generic NetworkSim IOS profile does not reproduce IOL's activation-character, synchronous-logging and initial SSH configuration. Reset-to-SSH is implemented. No new platform selector is claimed. |
| Image-specific warnings and key-generation time | `iosxe-select-line-3`, `iosxe-ssh-setup-3`, `nxos-ssh-disable-2` | Cisco's legacy-transport/deprecation/XML warnings and real RSA computation are not reproduced. NS-OS does not implement the XML service named in that warning. |
| Login whitespace | `iosxe-local-username` | One additional blank line remains. |
| Disabled Nexus SSH | `nxos-no-ssh` | Both deny a shell. This CML image accepts then closes the TCP connection; NetworkSim refuses its disabled listener. Real-image asynchronous syslog also differs. |

These differences are neither suppressed by normalization nor labeled an exact fidelity pass. The workflow does not mask packet counts, versions, numeric fields, warnings or banners to obtain a match. It normalizes terminal control codes, carriage returns, echoed commands and trailing spaces only.

Reviewed excerpts and evidence hashes are stored as source fixtures in `scripts/cml/fixtures/management-observations.json`; their regression test replays the scenario and checks eight observed output contracts. Controller credentials, full Cisco banners and raw packet payloads are excluded. The full private run is retained locally in `.cache/cml-runs/management-03/`; comparison is `.cache/cml-runs/comparison-03.json`. The supplemental reset probe is `.cache/cml-network/default-reset.json`.

Both owned diagnostic/reference labs were confirmed stopped. The pre-existing user lab was not modified and remained running. New captures create separate isolated labs and stop only their own lab.

See [the runnable CML workflow](../cml-conformance.md) for installation, capture, replay, comparison and the requirements for promoting further simulator features. This run does not establish real cryptography, SSH algorithm negotiation/host-key prompts, every IOS release, external AAA, or unrelated routing/switching protocol fidelity.

## Delivery validation

`npm run check` passed with **1,164/1,164 tests**, no failures or skips, TypeScript checking and the offline HTML build. The six Python workflow tests also pass, including fail-closed evidence checks and NX-OS boot-image discovery. Root `index.html` and `dist/index.html` are rebuilt from the final source. No application backend or CML connection was added to the browser application.
