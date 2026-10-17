# Windows SSH client

Open a PC or Server's **Desktop → Command prompt**, or a Windows laptop's **Wireless adapter → Open command prompt**. Connect with an explicit username:

```text
ssh admin@192.0.2.1
ssh -l admin -p 22 switch.lab
ssh -4 admin@switch.lab
ssh -6 admin@2001:db8:1::1
```

`ssh.exe` is an equivalent command name. Attached `-ladmin` and `-p22` arguments are supported. `ssh`, `ssh /?` and `ssh -?` show the supported syntax. The `user@hostname` password-login form follows [Microsoft's Windows SSH client guidance](https://learn.microsoft.com/en-us/windows/terminal/tutorials/ssh).

Enter the password when prompted; it is masked and excluded from command history. Failed passwords retry the same SSH identity up to the target's configured retry count. A successful login displays the network node's IOS prompt. Commands, privilege changes, configuration, question-mark help and Tab completion operate on that remote node. Use `end` to leave configuration mode, then `exit` or `logout` to close the session and return to `C:\>`. Ctrl-C cancels a pending login; within an authenticated IOS session it cancels the current input while retaining the connection.

The target needs a reachable IP address, a return route, SSH key state and VTY settings that allow SSH. For example, on a fresh network node with working addressing:

```text
enable
configure terminal
ip domain-name lab.example
crypto key generate rsa modulus 2048
ip ssh version 2
username admin privilege 15 secret LabPassword123
line vty 0 4
login local
transport input ssh
end
```

Use invented lab credentials. If AAA is already enabled, its login and EXEC authorization method lists must also permit the intended account. Interface ACLs, VTY access classes, missing routes, key removal, disabled SSH, retry limits and idle timeouts affect sessions. An account at privilege level 1 must use the node's configured `enable` authentication before entering privileged configuration.

Hostname connections use the client's simulated DNS configuration. `-4` selects an A lookup; `-6` selects an AAAA lookup. A literal IP must match the requested address family. A wireless laptop must associate and obtain working addressing before its SSH traffic can cross the WLAN, CAPWAP and routed network.

The provided IOS-style SSH server listens on TCP/22. The client accepts `-p` and attempts that port; an unopened port or a different application such as Telnet or HTTP cannot establish an SSH terminal. This is an interactive, password-based teaching transport inside the offline lab. Native encryption, host-key trust storage, key files, agent/port forwarding, native host processes and one-shot remote command execution are outside this implementation.
