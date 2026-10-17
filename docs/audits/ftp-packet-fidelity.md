# FTP control and data delivery

The original IPv4 passive FTP implementation uses delivered TCP connections for the control dialogue on port21 and a separate data stream on ports50000–50031. USER/PASS, TYPE I, PASV, RETR/STOR and numeric replies execute in connection order. A transfer succeeds only after delivered data EOF and the control completion reply. Upload contents are staged and committed after clean data EOF; an interrupted upload leaves the previous file intact. The client result never retains the password.

`src/ftp-files.ts` owns the protocol/service. The IOS copy/client integration is documented separately in [ios-ftp-client-fidelity.md](ios-ftp-client-fidelity.md). The parent added the separate Server FTP service form and constructor/project validators. Previously removed Server TFTP/SCP/SFTP administration and Desktop transfer surfaces remain excluded.

## Primary references

- [RFC959](https://www.rfc-editor.org/rfc/rfc959.html): control/data separation, passive mode, login, image transfer type, transfer replies, data connection closure.
- The [IOS XE17 basic configuration guide](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/syst-mgmt/b-system-management/m_cm-config-files-0.html) supplies IOS client copy/default credential/source-interface behavior; see the client audit for exact native grammar and fallback evidence.

## Asserted packet cases

`tests/ftp-files.test.ts` contains six passing cases:

- `FTP-PACKET-01`: UTF-8 RETR/STOR over two actual TCP connections, real dropped segment/retransmission, no duplicate content, byte counters and EOF/completion gates.
- `FTP-PACKET-02`: empty files, wrong/missing account, wrong password, missing file, traversal, global and per-account write denial.
- `FTP-PACKET-03`: data-only ingress ACL denial with a working control connection cannot create a receiver file.
- `FTP-PACKET-04`: disabled/reloaded server, client reload and transaction deadline fail incomplete writes.
- `FTP-PACKET-05`: literal dictionary keys, portable export/load and fresh listener service; inherited accounts/files are absent.
- `FTP-PACKET-06`: strict malformed service/client import validation, atomic failed load and disabled empty service configuration.

The six IOS client cases independently verify URL/interactive copy, native defaults, type7 rendering, configuration replay/rollback, source-interface fallback and transit data ACLs. The focused routed/FTP/syntax run passed123/123, with typecheck passing (`.cache/wired-final-focused.log`, `.cache/wired-final-typecheck.log`). Parent combined acceptance remains the all-node result.

## Explicit model limits

This is an original logical FTP application over the simulator's reliable, ordered educational TCP channels. It is not an RFC959 byte-compatible external listener. It supports IPv4 passive transfers, mandatory explicit server accounts, TYPE I UTF-8 text up to1MiB/file, 64accounts, 256files, 32concurrent control sessions/passive reservations per server and a60second server session deadline. Client transactions have an independently bounded timeout. It does not implement active PORT/EPRT, IPv6/EPSV, ASCII transformations, directory-management commands, resume, FXP, TLS, arbitrary binary files or filesystem permissions beyond modeled read-only settings. No native IOS FTP server CLI was invented. FTP credentials are lab configuration exported with the lab; neither FTP protocol encryption nor SSH/TLS security is implied.
