# FTP configuration transfers

Double-click a Server, open **Services → FTP**, enable the listener and add an account. Add text files for downloads; uploads appear in this same file list. A global or per-account read-only setting prevents uploads. Save the form to apply the validated draft.

On a reachable IOS-style device:

```text
enable
configure terminal
ip ftp username student
ip ftp password 0 LabPassword123
ip ftp passive
end
copy running-config ftp://192.0.2.20/router.cfg
```

Press Enter at the write confirmation. To download and inspect a file:

```text
copy ftp://192.0.2.20/router.cfg flash:received.cfg
more flash:received.cfg
```

The remote address must be reachable through the simulated network. FTP uses TCP21 plus an independent passive data connection on TCP50000–50031. An ACL can allow login but block the file transfer. Wrong credentials, a disabled listener, a missing file, read-only policy or an interrupted connection fail without a fabricated successful copy.

`copy ftp: flash:received.cfg` asks for the remote host and source filename. URL credentials take precedence over the configured FTP defaults. `ip ftp source-interface Loopback0` selects an available source address; a down source interface falls back to the routed egress. `no` and `default` remove the client defaults. These commands do not enable an FTP server on the router.

This is a passive IPv4 UTF-8 text-file teaching service, limited to 1 MiB per file. Active FTP, IPv6 FTP, FTPS and binary images are outside this profile. Credentials and files are included in portable lab exports. The user-excluded Server TFTP and SCP/SFTP listeners remain disabled.

See the [packet implementation audit](../audits/ftp-packet-fidelity.md), [IOS client audit](../audits/ios-ftp-client-fidelity.md) and [browser evidence](../audits/ftp-browser-validation.json).
