# Windows SSH client validation

The original Windows facade could connect using `ssh user@host` and `ssh -l user host`, but standard port options, missing arguments and DNS errors could escape as IOS parser exceptions. This change adds a Windows SSH argument parser, explicit usage, controlled host-client errors and IPv4/IPv6 selection. It retains the existing packet-driven management sessions and configured target authentication/authorization. Failed SSH passwords now retry the same username. Transport identification and response checks reject Telnet and unrelated TCP applications instead of treating their replies as SSH terminals.

Final validation:

- Type checking and standalone build passed. Root and `dist/index.html` match.
- **946 tests passed, zero failed**, including **16 new Windows SSH tests**.
- **10 browser checks passed**, with no page errors, using an isolated YAML lab and public PC/Server desktop command prompts in the standalone `file://` artifact.
- The localhost preview serves the same tested HTML. The user's active lab was not changed.

The new tests authenticate a Windows PC to Router, L2/L3/PoE switch, WLC and AP targets configured through IOS-style commands. They verify real TCP/22 traffic, remote show/configuration commands, local prompt restoration, Windows Server as a client, OpenSSH-style username/port options, `ssh.exe`, help/errors, A/AAAA lookups and IPv6, missing keys, disabled transport, VTY restrictions, wrong ports/applications, password retries and history exclusion, remote help/Tab/cancel, idle timeout and link failure, privilege/enable authentication, and a required return route through an intermediate router. A Windows wireless laptop also authenticates through its actual WLAN/CAPWAP and routed path.

Browser checks verify syntax help, invalid-option feedback, DNS hostname login, masked passwords and retry, remote configuration, IOS help/completion, exit to local CMD, switch SVI login with `-l`/`-p`, rejected connections, Ctrl-C during authentication, and the Windows Server `ssh.exe` client.

This validates the simulator's interactive password-based subset, not a native Windows/OpenSSH binary or real encryption. Client syntax and configuration examples are in the [Windows SSH guide](../features/windows-ssh.md), with [Microsoft's SSH client reference](https://learn.microsoft.com/en-us/windows/terminal/tutorials/ssh).

Artifact SHA-256: `e1e4cb140fdd9994517233f2ff17c3d5f960b61db5b64b72e7c3cafb29e23ab4`.

Evidence: [validation snapshot](windows-ssh-validation.json), [browser checks](windows-ssh-browser-results.json). Reproduce with `node --test tests/windows-ssh.test.ts` and `node scripts/browser-windows-ssh.mjs` after building.
