# Automatic DHCP DNS records

Enable DHCP and DNS under the same Server's **Services**, and apply the settings. Each acknowledged IPv4 lease publishes an A record using the hostname received in the client's DHCP request. The DNS tab lists these records separately from editable manual records.

For example, a client named `PC1` leased `192.0.2.10` publishes `pc1 → 192.0.2.10`. Setting the DHCP pool's **DNS domain** to `lab.example` also publishes `pc1.lab.example → 192.0.2.10`. An already qualified client hostname is used directly. Configure clients to use this Server's address as their DNS server; the DHCP pool's DNS server field can distribute it automatically.

Use client `nslookup pc1.lab.example`, a ping by name, or **Network tools → DNS lookup** to query it through the simulated links, routes and policies. Relayed DHCP carries the client hostname to the allocating Server too.

- Only committed leases publish records; outstanding offers do not. Invalid or missing DNS hostnames do not prevent DHCP address assignment.
- Renewal updates the recorded hostname, domain and lease lifetime. A delivered release, decline or lease expiry removes its records. A powered-off client keeps its lease records until release or expiry.
- Enabling DNS after allocation immediately exposes existing live leases. Disabling either service hides the automatic records. Renew after changing a hostname or a pool's DNS domain.
- Manual A and CNAME records at the same name take precedence. For duplicate client names, the first active binding owns that name until its lease ends. Clients should have unique hostnames.
- Automatic TTL is at most 300 seconds by default, capped by the remaining lease time when the answer is generated. Existing resolver caches follow their TTL, including after release; `nslookup` or Network tools sends a new query directly.
- Automatic entries remain runtime lease data. Applying service settings does not convert them into manual records. Server restart and lab import rebuild them through fresh DHCP exchanges.

This is local Server service integration. It does not contact external DNS servers or implement a separate authenticated DNS update protocol. It generates A records; manual AAAA, CNAME, MX, NS and PTR controls continue to work independently.
