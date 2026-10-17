# Offline configuration-management teaching workflow

NetworkSim provides an **Ansible-compatible teaching subset** in PC, Laptop and Server → Network tools → Automation. It runs entirely in the standalone HTML file. No backend, Ansible installation, Python process, host shell or real SSH encryption is involved. The syntax follows the documented cisco.ios collection 11.6.0 subset below; this is not a complete or interoperable Ansible runtime.

Cisco's [CCNA 200-301 v2.0 blueprint](https://learningcontent.cisco.com/documents/marketing/exam-topics/200-301_CCNA_v2.0_Exam_Topics_PDF.pdf), objective 5.5, requires using configuration-management mechanisms such as Ansible to execute commands. This workflow provides a practical local exercise for that objective. It does not certify complete exam coverage or reproduce exam questions.

## A working lab

Use [the inventory](../../examples/automation/inventory.yaml) and [the playbook](../../examples/automation/playbook.yaml). Adjust the management address, account and interface for your lab. A reachable router/switch needs configured SSH keys, a permitted SSH VTY transport, authentication and sufficient authorization. The client needs an operational address and route. A typical target preparation is:

```text
enable
configure terminal
interface GigabitEthernet0/0
 ip address 192.0.2.1 255.255.255.0
 no shutdown
exit
ip domain-name lab.test
crypto key generate rsa modulus 2048
username admin privilege 15 secret lab-password
aaa new-model
aaa authentication login default local
aaa authorization exec default local
line vty 0 4
 login authentication default
 transport input ssh
end
```

Put the client at 192.0.2.10/24 and connect it to that interface. Paste the two files into Automation and run the playbook. The configuration task describes the uplink and saves only when its running configuration changes. The verification task collects the actual interface status and evaluates its returned text. Run again to observe unchanged exact-line configuration. Break the link, block TCP22 with an ACL or enter the wrong password to observe a real failed run.

## Supported teaching subset

| Input | Implemented behavior |
| --- | --- |
| Inventory | Block YAML or JSON group mappings with `vars`, `hosts`, `children`; inherited connection variables; alias or exact group selection, including `all` |
| Connection | `ansible.netcommon.network_cli`/`network_cli`, `cisco.ios.ios`/`ios`, IPv4/IPv6 `ansible_host`, SSH22, `ansible_user`, `ansible_password`/`ansible_ssh_pass` |
| Privilege | `become: true`, `become_method: enable`, optional `become_password`; corresponding `ansible_become*` inventory variables |
| Plays | `name`, `hosts`, `gather_facts: false`, supported connection variables and `tasks` |
| `cisco.ios.ios_command` / `ios_command` | A string or string list of EXEC commands; actual output in `stdout`; `wait_for` literal `result[N] contains TEXT` / `not contains TEXT`; `match: all/any`, explicit retries and simulated-clock interval |
| `cisco.ios.ios_config` / `ios_config` | `lines`, ordered `parents`, `match: line/none`, `save_when: never/changed/always` |
| Sensitive tasks | `no_log: true` suppresses task commands, output and detailed errors in the returned report |
| Results | Typed JSON task results, confirmed running-config change flags, saved acknowledgments, host recap and download |

The implementation performs complete input/schema validation before opening any connection. Unsupported modules, arbitrary task keys, Jinja expressions, YAML aliases, invalid types and reserved object keys reject. Inventory is bounded to 32 hosts, plays to 16, tasks to 100 per play and an estimated 1,000 command budget including retries. Input size is bounded; deep nesting rejects. This is an explicit teaching profile, not silent acceptance of unsupported Ansible options.

Tasks execute through `ManagementController.open/send/disconnect` over ordinary simulated TCP22 requests. They use the same VTY capacity, transport, access-class, login/AAA, EXEC and command authorization, expiry and accounting paths as the interactive CLI. A new local privileged CLI is **not** used to apply configuration. The runner does not write the destination config directly or infer success from topology adjacency.

`ios_config` retrieves the remote running config, matches exact rendered lines in the selected hierarchy, sends actual configuration commands and retrieves the remote config again. `changed` describes that observed running-config difference. `saved: true` means the requested copy command was acknowledged; it is not a separate native Ansible result contract. The target's ordinary copy handler updates startup config. Exact canonical lines are necessary for predictable line matching; aliases or default lines absent from running config can execute again yet report unchanged. Arbitrary nested Ansible matching, strict/exact block replacement and offline intended-config comparison are not implemented.

An invalid command stops later tasks for that host. Already applied changes remain; the result reports confirmed partial changes. If transport loss prevents a post-failure read, `changeStatusUnknown` is explicit rather than fabricated success. A session close that cannot be delivered is reported; the target's idle timeout still applies. Other selected hosts can proceed independently.

Inventory password strings are redacted from results, and known secret-bearing configuration commands have their command text suppressed. An explicit `show running-config` can include **other** lab secrets. Use `no_log` for sensitive output. Teaching credentials are present in the logical lab packets/configuration as elsewhere in this simulator; no cryptographic confidentiality is claimed. Inventory/playbook drafts are not automatically saved into the lab. Portable lab export preserves actual running/startup device changes, not an external automation installation.

## JSON construction, validation and interpretation

The **Validate and format as JSON** button validates the inventory/playbook schema, converts the inputs to indented JSON and reports the selected hosts/task count. It sends no network requests and makes no device changes. Leading `{` or `[` selects strict JSON parsing: missing property quotes, malformed syntax and wrong schema types reject. Block YAML remains available; YAML flow-style documents must use JSON-compatible syntax.

This lets a learner construct an inventory object and task array, distinguish JSON booleans from strings, interpret validation errors, run the documents and inspect structured results. A successful result includes a numeric simulated start/finish time, a status string, an array of task records, boolean `changed` fields and an object keyed by host alias. The result format is NetworkSim's documented output, not an asserted native Ansible transcript. The existing RESTCONF client provides a separate JSON request/response exercise through actual simulated HTTPS operations.

## Evidence and exclusions

`tests/automation.test.ts` AUTO-01–09 covers delivered SSH configuration/save/verification and VTY close, exact-line repeat behavior, bad credentials, actual TCP ACL drops, command authorization rejection, validation before packets, partial changes/failure, evaluated wait conditions, enable escalation, redaction/no_log and typed JSON construction/validation. `tests/windows-cli.test.ts` WIN-22–28 covers the related host route/PTR/IPv6/DHCPv6 improvements with actual packet effects and persistence checks. Browser evidence is in [automation-browser-validation.json](automation-browser-validation.json), with screenshots under `.cache/automation-browser/`.

There is no general Ansible scheduler, roles, collections, plugins, fact gathering, Jinja, loops, handlers, delegation, arbitrary conditions, external file access, vault, subprocesses or OS command execution. This adds no server file-transfer services or administration pages; the user-approved server TFTP/SCP/SFTP exclusion remains in effect.

Primary syntax references reviewed: [cisco.ios.ios_command](https://docs.ansible.com/projects/ansible/latest/collections/cisco/ios/ios_command_module.html), [cisco.ios.ios_config](https://docs.ansible.com/projects/ansible/latest/collections/cisco/ios/ios_config_module.html), and [IOS connection options](https://docs.ansible.com/projects/ansible/latest/network/user_guide/platform_ios.html), whose collection documentation identified version 11.6.0 when reviewed. No external implementation was copied.
