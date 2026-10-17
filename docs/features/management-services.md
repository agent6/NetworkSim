# Packet-backed management teaching services

PC, laptop and server desktops expose **Network tools** for typed DNS queries, SNMP managers and RESTCONF. Requests cross the lab's real simulated links, routes and policies. There is no backend, Internet request or host network service.

- DNS supports A/AAAA/CNAME/MX/NS/PTR through the server Services form. Resolver cache TTL and negative results use simulation time. Address resolution falls back to AAAA after a delivered A NODATA answer.
- Configure `snmp-server` communities or v3 users/groups/views on an IOS-style node. The manager queries the read-only system/interface MIB over UDP161. Configured v2c notifications go through UDP162 to a server with `services.snmpManager.enabled`. Actual link/admin transitions, restart and authentication failures can originate the selected notifications. Delivery is unacknowledged and can fail independently of submission.
- Server nodes no longer provide TFTP or SCP/SFTP services. Existing lab file dictionaries are retained with their listeners disabled. IOS nodes can still serve SCP with keys, SSH VTY transport, privilege 15, permitted EXEC authorization and `ip scp server enable`. `copy scp://user@address/file flash:file` prompts for the password.
- Enable `netconf-yang` for the persistent modeled TCP830 XML endpoint. Candidate configuration, locks, commit/discard and confirmed rollback use the shared configuration and clock. `show netconf-yang sessions [detail|session-id ID]` and `show netconf-yang datastores` inspect actual sessions/locks.
- RESTCONF requires `restconf`, modeled HTTPS and privilege-15 authentication. Desktop GET/PUT/PATCH/DELETE operations change actual interfaces/hostname. [Supported paths/RPCs and limits](model-driven-management.md) are explicit.

Passwords and SNMP identities are logical security checks, not cryptography. These clients are useful for deterministic network exercises; external OS tools cannot connect to these in-memory endpoints. Real Cisco/Windows interoperability is not claimed.
