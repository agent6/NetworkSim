import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';

function lab() {
  const sim = new Simulator(4242), r1 = sim.addDevice('router'), r2 = sim.addDevice('router'), r3 = sim.addDevice('router');
  sim.connect({ deviceId: r1.id, port: 'GigabitEthernet0/0' }, { deviceId: r2.id, port: 'GigabitEthernet0/0' });
  sim.connect({ deviceId: r2.id, port: 'GigabitEthernet0/1' }, { deviceId: r3.id, port: 'GigabitEthernet0/0' });
  const c1 = new IOSSession(sim, r1.id), c2 = new IOSSession(sim, r2.id), c3 = new IOSSession(sim, r3.id);
  ['enable', 'configure terminal', 'interface g0/0', 'ip address 10.0.12.1 255.255.255.0', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.0.12.2', 'end'].forEach(l => c1.execute(l));
  ['enable', 'configure terminal', 'interface g0/0', 'ip address 10.0.12.2 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 10.0.23.2 255.255.255.0', 'no shutdown', 'end'].forEach(l => c2.execute(l));
  ['enable', 'configure terminal', 'interface g0/0', 'ip address 10.0.23.3 255.255.255.0', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.0.23.2', 'end'].forEach(l => c3.execute(l));
  sim.advance(60000);
  return { sim, r1, r2, r3, c1, c2, c3 };
}
const text = (lines: string[]) => lines.join('\n');
const noCommentary = (output: string, label: string) => assert.doesNotMatch(output, /NetworkSim|simulat|not modeled|Copyright|\?\s*$/im, label);

test('show version prints the IOSv identity, actual uptime, interface count and configuration register', () => {
  const { c1 } = lab(), out = c1.execute('show version');
  assert.equal(out[0], 'Cisco IOS Software, IOSv Software (VIOS-ADVENTERPRISEK9-M), Version 15.9(3)M12, RELEASE SOFTWARE (fc1)');
  assert.equal(out[1], 'Technical Support: http://www.cisco.com/techsupport');
  const all = text(out);
  for (const line of ['ROM: Bootstrap program is IOSv', 'R1 uptime is 1 minute', 'System returned to ROM by reload', 'System image file is "flash0:/vios-adventerprisek9-m"', 'Cisco IOSv (revision 1.0) with  with 460137K/62464K bytes of memory.', '4 Gigabit Ethernet interfaces', 'DRAM configuration is 72 bits wide with parity disabled.', '256K bytes of non-volatile configuration memory.'])
    assert.ok(out.includes(line), line);
  assert.match(all, /^Processor board ID \w{11}$/m);
  assert.match(all, /^\d+K bytes of ATA System CompactFlash 0 \(Read\/Write\)$/m);
  assert.equal(out.at(-1), 'Configuration register is 0x2102');
  noCommentary(all, 'show version');
  const sim = new Simulator(7), sw = sim.addDevice('switch'), cs = new IOSSession(sim, sw.id), swv = cs.execute('show version');
  assert.match(swv[0], /^Cisco IOS Software, vios_l2 Software \(vios_l2-ADVENTERPRISEK9-M\), Version 15\.2/);
  assert.ok(swv.includes('cisco IOSv () processor (revision 1.0) with 657721K/62464K bytes of memory.'));
  assert.equal(swv.at(-1), 'Configuration register is 0x101');
  assert.match(cs.execute('show inventory')[0], /^NAME: "vios_l2", DESCR: "vios_l2 chassis, Hw Serial#: \w+, Hw Revision: 1\.0"$/);
});

test('show inventory and show processes/memory use IOS layouts', () => {
  const { c1 } = lab(), inventory = c1.execute('show inventory');
  assert.match(inventory[0], /^NAME: "IOSv", DESCR: "IOSv chassis, Hw Serial#: (\w{11}), Hw Revision: 1\.0"$/);
  const serial = inventory[0].match(/Serial#: (\w+)/)![1];
  assert.equal(inventory[1], `PID: IOSv              , VID: 1.0, SN: ${serial}`);
  assert.match(text(c1.execute('show version')), new RegExp(`Processor board ID ${serial}`));
  const cpu = c1.execute('show processes cpu');
  assert.match(cpu[0], /^CPU utilization for five seconds: \d+%\/\d+%; one minute: \d+%; five minutes: \d+%$/);
  assert.equal(cpu[1], ' PID Runtime(ms)     Invoked      uSecs   5Sec   1Min   5Min TTY Process ');
  const memory = c1.execute('show memory statistics');
  assert.equal(memory[0], '                Head    Total(b)     Used(b)     Free(b)   Lowest(b)  Largest(b)');
  assert.match(memory[1], /^Processor\s+[0-9A-F]+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+$/);
  assert.match(memory[2], /^      I\/O\s+[0-9A-F]+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+$/);
});

test('show logging prints the IOS header, per-destination counters and the log buffer', () => {
  const { c1 } = lab(), out = c1.execute('show logging'), all = text(out);
  assert.equal(out[0], 'Syslog logging: enabled (0 messages dropped, 0 messages rate-limited, 0 flushes, 0 overruns, xml disabled, filtering disabled)');
  assert.match(all, /^No Active Message Discriminator\.$/m);
  assert.match(all, /^    Console logging: level debugging, \d+ messages logged, xml disabled,\n                     filtering disabled$/m);
  assert.match(all, /^    Buffer logging:  level debugging, \d+ messages logged, xml disabled,$/m);
  assert.match(all, /^    Trap logging: level informational, \d+ message lines logged$/m);
  assert.match(all, /^        Logging Source-Interface:       VRF Name:$/m);
  assert.match(all, /^Log Buffer \(16384 bytes\):\n\n/m);
  assert.match(all, /%LINK-3-UPDOWN: Interface GigabitEthernet0\/0, changed state to up/);
  noCommentary(all, 'show logging');
});

test('show users, show line and show terminal follow IOS line numbering and layout', () => {
  const { c1 } = lab();
  assert.deepEqual(c1.execute('show users'), ['    Line       User       Host(s)              Idle       Location', '*  0 con 0                idle                 00:00:00   ', '', '  Interface    User               Mode         Idle     Peer Address', '']);
  const line = c1.execute('show line');
  assert.deepEqual(line.slice(0, 4), [
    '   Tty Typ     Tx/Rx    A Modem  Roty AccO AccI   Uses   Noise  Overruns   Int',
    '*     0 CTY              -    -      -    -    -      0       0     0/0       -',
    '      1 AUX   9600/9600  -    -      -    -    -      0       0     0/0       -',
    '      2 VTY              -    -      -    -    -      0       0     0/0       -',
  ]);
  assert.equal(line.length, 8);
  const detail = c1.execute('show line 0');
  assert.equal(detail[3], 'Line 0, Location: "", Type: ""');
  const terminal = c1.execute('show terminal');
  assert.deepEqual(terminal.slice(0, 4), ['Line 0, Location: "", Type: ""', 'Length: 24 lines, Width: 80 columns', 'Baud rate (TX/RX) is 9600/9600, no parity, 2 stopbits, 8 databits', 'Status: PSI Enabled, Ready, Active, Automore On']);
  assert.ok(terminal.includes('History is enabled, history size is 10.'));
  c1.execute('terminal length 0');
  assert.match(text(c1.execute('show terminal')), /^Length: 0 lines, Width: 80 columns$/m);
  assert.equal(c1.execute('show privilege')[0], 'Current privilege level is 15');
  noCommentary(text(terminal), 'show terminal');
});

test('show hosts, dir, show file systems and show reload use IOS formats', () => {
  const { c1 } = lab();
  ['configure terminal', 'ip host R2 10.0.12.2', 'end'].forEach(l => c1.execute(l));
  const hosts = c1.execute('show hosts');
  assert.deepEqual(hosts.slice(0, 4), ['Name lookup view: Global/default', 'Default domain is not set', 'Name/address lookup uses domain service', 'Name servers are 255.255.255.255']);
  assert.ok(hosts.includes('Host                      Port  Flags      Age Type   Address(es)'));
  assert.ok(hosts.includes('R2                        None  (perm, OK)  0   IP    10.0.12.2'));
  const dir = c1.execute('dir');
  assert.equal(dir[0], 'Directory of flash:/');
  assert.match(dir.at(-1)!, /^\d+ bytes total \(\d+ bytes free\)$/);
  const fs = c1.execute('show file systems');
  assert.deepEqual(fs.slice(0, 3), ['File Systems:', '', '       Size(b)       Free(b)      Type  Flags  Prefixes']);
  assert.match(text(fs), /^\*\s+\d+\s+\d+\s+disk\s+rw\s+flash:$/m);
  assert.deepEqual(c1.execute('show reload'), ['No reload is scheduled.']);
});

test('show ip ssh, show ssh and show ntp print IOS output for both states', () => {
  const { c1, r1 } = lab();
  const off = c1.execute('show ip ssh');
  assert.deepEqual(off.slice(0, 2), ['SSH Disabled - version 1.99', '%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).']);
  assert.equal(off.at(-1), 'IOS Keys in SECSH format(ssh-rsa, base64 encoded): NONE');
  ['configure terminal', 'ip domain-name lab.local', 'crypto key generate rsa modulus 2048', 'ip ssh version 2', 'end'].forEach(l => c1.execute(l));
  assert.ok(r1.config.features.ssh?.keys);
  const on = c1.execute('show ip ssh');
  assert.equal(on[0], 'SSH Enabled - version 2.0');
  assert.equal(on.at(-2), 'IOS Keys in SECSH format(ssh-rsa, base64 encoded): R1.lab.local');
  assert.match(on.at(-1)!, /^ssh-rsa AAAAB3NzaC1yc2E[A-Za-z0-9+/=]+$/);
  assert.deepEqual(c1.execute('show ssh'), ['%No SSHv2 server connections running.', '%No SSHv1 server connections running.']);
  const ntp = c1.execute('show ntp status');
  assert.equal(ntp[0], 'Clock is unsynchronized, stratum 16, no reference clock');
  assert.equal(ntp.at(-1), 'system poll interval is 64, never updated.');
  assert.deepEqual(c1.execute('show ntp associations'), ['', '  address         ref clock       st   when   poll reach  delay  offset   disp', ' * sys.peer, # selected, + candidate, - outlyer, x falseticker, ~ configured']);
  assert.match(c1.execute('show clock')[0], /^\*\d{2}:\d{2}:\d{2}\.\d{3} UTC \w{3} \w{3} \d{1,2} \d{4}$/);
});

test('ping prints the IOS banner, result codes and round-trip summary from actual forwarding', () => {
  const { c1 } = lab();
  const ok = c1.execute('ping 10.0.23.3');
  assert.deepEqual(ok.slice(0, 3), ['Type escape sequence to abort.', 'Sending 5, 100-byte ICMP Echos to 10.0.23.3, timeout is 2 seconds:', '!!!!!']);
  assert.match(ok[3], /^Success rate is 100 percent \(5\/5\), round-trip min\/avg\/max = \d+\/\d+\/\d+ ms$/);
  const sourced = c1.execute('ping 10.0.12.2 source g0/0 repeat 2');
  assert.deepEqual(sourced.slice(0, 4), ['Type escape sequence to abort.', 'Sending 2, 100-byte ICMP Echos to 10.0.12.2, timeout is 2 seconds:', 'Packet sent with a source address of 10.0.12.1 ', '!!']);
  const failed = c1.execute('ping 10.9.9.9');
  assert.match(failed[2], /^[U.]{5}$/);
  assert.equal(failed[3], 'Success rate is 0 percent (0/5)');
  assert.deepEqual(c1.execute('ping bogus.example'), ['Translating "bogus.example"...domain server (255.255.255.255)', '% Unrecognized host or address, or protocol not running.']);
  ['configure terminal', 'no ip domain-lookup', 'end'].forEach(l => c1.execute(l));
  assert.deepEqual(c1.execute('ping bogus.example'), ['% Unrecognized host or address, or protocol not running.']);
});

test('extended ping uses IOS prompts and reports a single sweep summary', () => {
  const { c1 } = lab();
  const prompts: string[] = [];
  c1.execute('ping'); prompts.push(c1.prompt);
  for (const answer of ['', '10.0.12.2', '2', '', '', 'y', '', '', '', '', '', '']) { c1.execute(answer); prompts.push(c1.prompt); }
  assert.deepEqual(prompts.slice(0, 12), ['Protocol [ip]:', 'Target IP address:', 'Repeat count [5]:', 'Datagram size [100]:', 'Timeout in seconds [2]:', 'Extended commands [n]:', 'Source address or interface:', 'Type of service [0]:', 'Set DF bit in IP header? [no]:', 'Validate reply data? [no]:', 'Data pattern [0xABCD]:', 'Loose, Strict, Record, Timestamp, Verbose[none]:']);
  assert.equal(prompts[12], 'Sweep range of sizes [n]:');
  const out = c1.execute('');
  assert.deepEqual(out.slice(0, 3), ['Type escape sequence to abort.', 'Sending 2, 100-byte ICMP Echos to 10.0.12.2, timeout is 2 seconds:', '!!']);
  assert.equal(c1.prompt, 'R1#');
  c1.execute('ping'); c1.execute('');
  assert.deepEqual(c1.execute(''), ['% Bad IP address']);
  assert.equal(c1.prompt, 'R1#');
});

test('traceroute prints IOS hop lines without a completion trailer and honours ttl/probe options', () => {
  const { c1 } = lab();
  const out = c1.execute('traceroute 10.0.23.3');
  assert.deepEqual(out.slice(0, 3), ['Type escape sequence to abort.', 'Tracing the route to 10.0.23.3', 'VRF info: (vrf in name/id, vrf out name/id)']);
  assert.match(out[3], /^  1 10\.0\.12\.2 \d+ msec \d+ msec \d+ msec$/);
  assert.match(out[4], /^  2 10\.0\.23\.3 \d+ msec \d+ msec \d+ msec$/);
  assert.equal(out.length, 5);
  assert.doesNotMatch(text(out), /Trace complete/);
  const limited = c1.execute('traceroute 10.0.23.3 ttl 2 2 probe 1 numeric');
  assert.equal(limited.length, 4);
  assert.match(limited[3], /^  2 10\.0\.23\.3 \d+ msec$/);
  assert.match(text(c1.execute('traceroute 10.0.23.3 ttl 3 1')), /%/);
});

test('telnet client failures use IOS connection messages', () => {
  const { c1 } = lab();
  assert.deepEqual(c1.execute('telnet 10.0.12.2'), ['Trying 10.0.12.2 ... ', '% Connection refused by remote host']);
  assert.deepEqual(c1.execute('telnet 300.1.1.1'), ['% Bad IP address or host name']);
  assert.equal(c1.prompt, 'R1#');
});

test('crypto key generate/zeroize rsa follow the IOS dialogs, and SNMP configuration replies are silent', () => {
  const { r1, c1 } = lab();
  c1.execute('configure terminal');
  assert.deepEqual(c1.execute('crypto key generate rsa modulus 1024'), ['% Please define a domain-name first.']);
  c1.execute('ip domain-name lab.local');
  const name = `${r1.config.hostname}.lab.local`;
  assert.deepEqual(c1.execute('crypto key generate rsa modulus 2048'), ['The name for the keys will be: ' + name, '', '% The key modulus size is 2048 bits', '% Generating 2048 bit RSA keys, keys will be non-exportable...', '[OK] (elapsed time was 1 seconds)', '']);
  assert.equal(r1.config.features.ssh?.keys?.modulus, 2048);
  assert.match(text(c1.execute('do show logging')), /%SSH-5-ENABLED: SSH 1\.99 has been enabled/);
  assert.deepEqual(c1.execute('crypto key generate rsa').slice(0, 1), [`% You already have RSA keys defined named ${name}.`]);
  assert.equal(c1.prompt, '% Do you really want to replace them? [yes/no]: ');
  assert.match(text(c1.execute('yes')), /Choose the size of the key modulus in the range of 512 to 4096/);
  assert.equal(c1.prompt, 'How many bits in the modulus [1024]: ');
  assert.deepEqual(c1.execute(''), ['% Generating 1024 bit RSA keys, keys will be non-exportable...', '[OK] (elapsed time was 1 seconds)', '']);
  assert.equal(r1.config.features.ssh?.keys?.modulus, 1024);
  assert.deepEqual(c1.execute('crypto key zeroize rsa'), ['% All keys will be removed.', '% All router certs issued using these keys will also be removed.']);
  assert.deepEqual(c1.execute('no'), []);
  assert.ok(r1.config.features.ssh?.keys);
  c1.execute('crypto key zeroize rsa'); c1.execute('yes');
  assert.equal(r1.config.features.ssh?.keys, undefined);
  for (const line of ['snmp-server community public rw', 'snmp-server engineID local 0123456789', 'snmp-server queue-length 10']) {
    const output = c1.execute(line);
    assert.deepEqual(output, [], line);
  }
});