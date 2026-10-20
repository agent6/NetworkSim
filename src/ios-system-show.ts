import type { Device } from './model.ts';
import { iosClock } from './ios-system.ts';
import { fileSystemStats } from './filesystem.ts';

/** Cisco IOS formatted system output. Every value is derived from simulator state or an idle IOSv default. */
const SWITCH_KINDS = ['switch', 'poeswitch', 'l3switch'];
const hash = (text: string): number => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const two = (n: number) => String(n).padStart(2, '0');
export const iosDuration = (ms: number): string => { const s = Math.max(0, Math.floor(ms / 1000)); return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`; };
const isSwitch = (device: Device) => SWITCH_KINDS.includes(device.kind);
const uptimeMs = (device: Device, now: number) => Math.max(0, now - Number(device.runtime.features.bootTime ?? 0));

export function iosSerial(device: Device): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let serial = '9';
  for (let i = 0; i < 10; i++) serial += alphabet[hash(`${device.id}:${i}`) % alphabet.length];
  return serial;
}

export function iosUptime(ms: number): string {
  let minutes = Math.floor(Math.max(0, ms) / 60000), started = false;
  const parts: string[] = [];
  for (const [unit, size] of [['year', 525600], ['week', 10080], ['day', 1440], ['hour', 60]] as const) {
    const value = Math.floor(minutes / size); minutes -= value * size;
    if (value || started) { started = true; parts.push(plural(value, unit)); }
  }
  parts.push(plural(minutes, 'minute'));
  return parts.join(', ');
}

function interfaceCounts(device: Device): string[] {
  const names = Object.keys(device.config.interfaces).filter(name => !name.includes('.'));
  const count = (pattern: RegExp) => names.filter(name => pattern.test(name)).length;
  return ([[/^Vlan/i, 'Virtual Ethernet'], [/^FastEthernet/i, 'FastEthernet'], [/^GigabitEthernet/i, 'Gigabit Ethernet'], [/^TenGigabitEthernet/i, 'Ten Gigabit Ethernet'], [/^Serial/i, 'Serial']] as const)
    .map(([pattern, label]) => [count(pattern), label] as const).filter(([n]) => n > 0).map(([n, label]) => `${n} ${label} interface${n === 1 ? '' : 's'}`);
}

export function iosVersion(device: Device, now: number): string[] {
  const sw = isSwitch(device), register = device.configurationRegister, current = register?.current ?? (sw ? 0x101 : 0x2102);
  const capacity = fileSystemStats(device).capacity;
  return [
    sw ? 'Cisco IOS Software, vios_l2 Software (vios_l2-ADVENTERPRISEK9-M), Version 15.2(CML_NIGHTLY_20190423)FLO_DSGS7, EARLY DEPLOYMENT DEVELOPMENT BUILD, synced to  V152_6_0_81_E'
      : 'Cisco IOS Software, IOSv Software (VIOS-ADVENTERPRISEK9-M), Version 15.9(3)M12, RELEASE SOFTWARE (fc1)',
    'Technical Support: http://www.cisco.com/techsupport', '', '',
    'ROM: Bootstrap program is IOSv', '',
    `${device.config.hostname} uptime is ${iosUptime(uptimeMs(device, now))}`,
    'System returned to ROM by reload',
    `System image file is "flash0:/${sw ? 'vios_l2-adventerprisek9-m' : 'vios-adventerprisek9-m'}"`,
    `Last reload reason: ${device.runtime.features.reloadReason ?? 'Unknown reason'}`, '', '',
    sw ? 'cisco IOSv () processor (revision 1.0) with 657721K/62464K bytes of memory.' : 'Cisco IOSv (revision 1.0) with  with 460137K/62464K bytes of memory.',
    `Processor board ID ${iosSerial(device)}`,
    ...interfaceCounts(device),
    'DRAM configuration is 72 bits wide with parity disabled.',
    '256K bytes of non-volatile configuration memory.',
    `${Math.floor(capacity / 1024)}K bytes of ATA System CompactFlash 0 (Read/Write)`, '', '', '',
    `Configuration register is 0x${current.toString(16)}${register && register.next !== register.current ? ` (will be 0x${register.next.toString(16)} at next reload)` : ''}`,
  ];
}

export function iosInventory(device: Device): string[] {
  const serial = iosSerial(device), name = isSwitch(device) ? 'vios_l2' : 'IOSv';
  return [`NAME: "${name}", DESCR: "${name} chassis, Hw Serial#: ${serial}, Hw Revision: 1.0"`, `PID: ${name.padEnd(18)}, VID: 1.0, SN: ${serial}`, ''];
}

interface ProcessRow { pid: number; name: string; tty: number }
const BASE_PROCESSES = ['Chunk Manager', 'Load Meter', 'PKI Trustpool', 'Retransmission of IPC messages', 'Check heaps', 'Pool Manager', 'DiscardQ Background Mgr', 'Timers', 'WATCH_AFS', 'MEMLEAK PROCESS', 'ARP Input', 'ARP Background', 'ATM Idle Timer', 'ATM ASYNC PROC', 'AAA_SERVER_DEADTIME', 'Policy Manager', 'DDR Timers', 'Entity MIB API', 'PrstVbl', 'RO Notify Timers', 'RMI RM Notify Watched Policy', 'EEM ED Syslog', 'SMART', 'GraphIt', 'Dialer event', 'IOS Licensing Expiry', 'SERIAL A\'detect', 'XML Proxy Client', 'Critical Bkgnd', 'Net Background', 'IDB Work', 'Logger', 'TTY Background', 'BACK CHECK', 'IF-MGR control process', 'IF-MGR event process', 'IPC Seat Manager', 'IPC Event Notifier', 'IPC Session Service', 'IP Input', 'ICMP event handler', 'IPv6 Input', 'TCP Timer', 'TCP Protocols', 'Socket Timers', 'HTTP CORE', 'CEF background', 'IP ARP Retry Ager', 'IP RIB Update', 'SSS Manager', 'Syslog Traps'];

function processList(device: Device, vty: Array<{ lineNumber: number }>): ProcessRow[] {
  const names = [...BASE_PROCESSES], f = device.config.features, p = device.config.protocols, s = device.config.services;
  if (f.cdp !== false) names.push('CDP Protocol');
  if (f.lldp) names.push('LLDP Protocol');
  if (isSwitch(device)) names.push('Spanning Tree', 'DTP Protocol', 'VTP Trap Process', 'PAgP Protocol', 'LACP Protocol');
  const id = (protocol: any) => protocol?.processId ?? protocol?.asn ?? '';
  if (p.ospf) names.push(`OSPF-${id(p.ospf)} Router`, `OSPF-${id(p.ospf)} Hello`);
  if (p.ospfv3) names.push(`OSPFv3-${id(p.ospfv3)} Router`, `OSPFv3-${id(p.ospfv3)} Hello`);
  if (p.eigrp) names.push('EIGRP-IPv4 Hello', `EIGRP-IPv4 Router: ${id(p.eigrp) || p.eigrp.name || ''}`.trim());
  if (p.eigrp6) names.push('EIGRP-IPv6 Hello', 'EIGRP-IPv6 Router');
  if (p.bgp) names.push('BGP Scheduler', 'BGP Router', 'BGP I/O', 'BGP Scanner', 'BGP Event');
  if (p.rip) names.push('RIP Router', 'RIP Send', 'RIP Timers');
  if (p.ripng) names.push('RIPng Router');
  if (Object.values(device.config.interfaces).some((i: any) => i.features?.hsrp || i.features?.standby)) names.push('HSRP IPv4');
  if (f.ntp) names.push('NTP');
  if (s.dhcp?.enabled !== false && s.dhcp?.pools?.length) names.push('DHCPD Receive', 'DHCPD Timer', 'DHCPD Database');
  if (f.snmp || s.snmp) names.push('SNMP ENGINE', 'SNMP Timers');
  if (f.ssh?.keys) names.push('SSH Event handler');
  const rows: ProcessRow[] = names.map((name, index) => ({ pid: index + 1, name, tty: 0 }));
  for (const session of vty) rows.push({ pid: rows.length + 1, name: 'Virtual Exec', tty: session.lineNumber + 1 });
  return rows;
}

function processCounters(row: ProcessRow, uptime: number) {
  const seed = hash(row.name), seconds = Math.max(1, Math.floor(uptime / 1000));
  const invoked = 1 + Math.floor(seconds * ((seed % 97) + 3) / 60);
  const usecs = 50 + seed % 900;
  return { runtime: Math.floor(invoked * usecs / 1000), invoked, usecs };
}

export function iosProcesses(device: Device, now: number, vty: Array<{ lineNumber: number }>, view: 'plain' | 'cpu' | 'memory', sorted = false): string[] {
  const uptime = uptimeMs(device, now), rows = processList(device, vty), counters = new Map(rows.map(row => [row, processCounters(row, uptime)]));
  const name16 = (name: string) => name.slice(0, 16).padEnd(16);
  if (view === 'memory') {
    const memory = iosMemoryPools(device), held = new Map(rows.map(row => [row, 4096 + (hash(row.name + 'm') % 60) * 1024]));
    if (sorted) rows.sort((a, b) => held.get(b)! - held.get(a)!);
    const line = (pid: number, tty: number, allocated: number, freed: number, holding: number, name: string) => String(pid).padStart(4) + String(tty).padStart(4) + String(allocated).padStart(11) + String(freed).padStart(11) + String(holding).padStart(11) + '0'.padStart(11) + '0'.padStart(11) + ' ' + name16(name);
    return [
      `Processor Pool Total: ${String(memory.processor.total).padStart(10)} Used: ${String(memory.processor.used).padStart(10)} Free: ${String(memory.processor.total - memory.processor.used).padStart(10)}`,
      `      I/O Pool Total: ${String(memory.io.total).padStart(10)} Used: ${String(memory.io.used).padStart(10)} Free: ${String(memory.io.total - memory.io.used).padStart(10)}`, '',
      ' PID TTY  Allocated      Freed    Holding    Getbufs    Retbufs Process',
      line(0, 0, 157498784, 36883336, 113426928, '*Init*'),
      ...rows.map(row => { const holding = held.get(row)!; return line(row.pid, row.tty, holding + 2048 * (counters.get(row)!.invoked % 7), 2048 * (counters.get(row)!.invoked % 7), holding, row.name); }),
      String(memory.processor.used).padStart(63) + ' Total',
    ];
  }
  if (sorted) rows.sort((a, b) => counters.get(b)!.runtime - counters.get(a)!.runtime || a.pid - b.pid);
  const header = 'CPU utilization for five seconds: 0%/0%; one minute: 0%; five minutes: 0%';
  if (view === 'cpu') return [header, ' PID Runtime(ms)     Invoked      uSecs   5Sec   1Min   5Min TTY Process ', ...rows.map(row => { const c = counters.get(row)!; return String(row.pid).padStart(4) + String(c.runtime).padStart(12) + String(c.invoked).padStart(12) + String(c.usecs).padStart(11) + '  0.00%'.repeat(3) + String(row.tty).padStart(4) + ' ' + name16(row.name); })];
  return [header, ' PID QTy       PC Runtime(ms)    Invoked   uSecs    Stacks TTY Process', ...rows.map(row => { const c = counters.get(row)!, seed = hash(row.name + 'pc'); return String(row.pid).padStart(4) + ' ' + (row.name === 'Virtual Exec' ? 'M* ' : ['Cwe', 'Csp', 'Mwe', 'Lwe', 'Hwe', 'Lsi', 'Msi'][seed % 7]) + ' ' + (0x20000000 + seed % 0x0fffffff).toString(16).toUpperCase().padStart(8, '0') + String(c.runtime).padStart(12) + String(c.invoked).padStart(11) + String(c.usecs).padStart(8) + `${[5660, 2620, 9764, 10764, 4800][seed % 5]}/${[6000, 3000, 12000, 12000, 6000][seed % 5]}`.padStart(10) + String(row.tty).padStart(4) + ' ' + row.name; })];
}

function iosMemoryPools(device: Device) {
  const configBytes = JSON.stringify(device.config).length, state = device.runtime.routes.length + device.runtime.neighbors.length + Object.keys(device.runtime.arp).length;
  return { processor: { head: 'F6E0E2A0', total: 370393444, used: 135061928 + configBytes * 4 + state * 1024 }, io: { head: 'E400000', total: 63963136, used: 20330608 + Object.keys(device.config.interfaces).length * 65536 } };
}

export function iosMemoryStatistics(device: Device): string[] {
  const pools = iosMemoryPools(device), row = (name: string, pool: { head: string; total: number; used: number }) => {
    const free = pool.total - pool.used, lowest = free - 1694288, largest = Math.floor(lowest * 0.987);
    return name.padStart(9) + pool.head.padStart(11) + [pool.total, pool.used, free, lowest, largest].map(n => String(n).padStart(12)).join('');
  };
  return ['                Head    Total(b)     Used(b)     Free(b)   Lowest(b)  Largest(b)', row('Processor', pools.processor), row('I/O', pools.io)];
}

export const iosLineNumber = (line: string): number => line.startsWith('vty ') ? Number(line.split(' ')[1]) + 2 : line.startsWith('aux') ? 1 : 0;

export function iosLineRow(line: string, active: boolean, uses: number, accessOut?: string, accessIn?: string): string {
  const type = line.startsWith('vty') ? 'VTY' : line.startsWith('aux') ? 'AUX' : 'CTY';
  return (active ? '*' : ' ') + String(iosLineNumber(line)).padStart(6) + ' ' + type + (type === 'AUX' ? '   9600/9600' : ''.padStart(12)) + '  -    -      -' + (accessOut || '-').padStart(5) + (accessIn || '-').padStart(5) + String(uses).padStart(7) + '0'.padStart(8) + '0/0'.padStart(8) + '-'.padStart(8);
}
export const IOS_LINE_HEADER = '   Tty Typ     Tx/Rx    A Modem  Roty AccO AccI   Uses   Noise  Overruns   Int';

export interface LineDetail { line: string; active: boolean; length: number; width: number; execTimeout: number; editing: boolean; history: boolean; historySize: number; transportInput: string; transportOutput?: string; transportPreferred?: string; activeFor?: number }
export function iosLineDetail(d: LineDetail): string[] {
  const vty = d.line.startsWith('vty'), timeout = d.execTimeout === 0 ? 'never' : iosDuration(d.execTimeout * 1000);
  const output = d.transportOutput && d.transportOutput !== 'all' ? d.transportOutput : 'pad telnet rlogin lapb-ta mop udptn v120 ssh';
  return [
    `Line ${iosLineNumber(d.line)}, Location: "", Type: ""`,
    `Length: ${d.length} lines, Width: ${d.width} columns`,
    'Baud rate (TX/RX) is 9600/9600, no parity, 2 stopbits, 8 databits',
    `Status: ${d.active ? `${vty ? '' : 'PSI Enabled, '}Ready, Active${vty ? ', No Exit Banner' : ''}${d.length > 0 ? ', Automore On' : ''}` : 'No Exit Banner'}`,
    'Capabilities: none',
    `Modem state: ${d.active ? 'Ready' : 'Idle'}`,
    'Group codes:    0',
    'Special Chars: Escape  Hold  Stop  Start  Disconnect  Activation',
    '                ^^x    none   -     -       none         ',
    'Timeouts:      Idle EXEC    Idle Session   Modem Answer  Session   Dispatch',
    `               ${timeout.padEnd(8)}        never                        none     not set`,
    '                            Idle Session Disconnect Warning',
    '                              never ',
    '                            Login-sequence User Response',
    '                             00:00:30',
    '                            Autoselect Initial Wait',
    '                              not set ',
    'Modem type is unknown.',
    'Session limit is not set.',
    ...(d.activeFor !== undefined ? [`Time since activation: ${iosDuration(d.activeFor)}`] : []),
    `Editing is ${d.editing ? 'enabled' : 'disabled'}.`,
    `History is ${d.history ? 'enabled' : 'disabled'}, history size is ${d.historySize}.`,
    'DNS resolution in show commands is enabled',
    'Full user help is disabled',
    `Allowed input transports are ${d.transportInput}.`,
    `Allowed output transports are ${output}.`,
    `Preferred transport is ${d.transportPreferred ?? 'telnet'}.`,
    'Shell: enabled',
    'Shell trace: off',
    'No output characters are padded',
    'No special data dispatching characters',
  ];
}

export function iosHosts(device: Device, now: number): string[] {
  const f = device.config.features, servers = device.config.dnsServers ?? [];
  const row = (name: string, flags: string, age: number, address: string) => name.padEnd(26) + 'None  ' + flags + String(age).padStart(3) + '   ' + (address.includes(':') ? 'IPV6' : 'IP').padEnd(6) + address;
  const cache = Object.entries<any>(device.runtime.features.dnsCache ?? {}).filter(([key, entry]) => key.includes('|') && entry.expires > now && entry.address && !entry.error);
  return [
    'Name lookup view: Global/default',
    `Default domain is ${f.domainName || 'not set'}`,
    `Name/address lookup uses ${f.domainLookup === false ? 'static mappings' : 'domain service'}`,
    `Name servers are ${servers.length ? servers.join(', ') : '255.255.255.255'}`, '',
    'Codes: UN - unknown, EX - expired, OK - OK, ?? - revalidate',
    '       temp - temporary, perm - permanent',
    '       NA - Not Applicable None - Not defined', '',
    'Host                      Port  Flags      Age Type   Address(es)',
    ...Object.entries<string>(device.config.services.dns?.records ?? {}).map(([name, address]) => row(name, '(perm, OK)', 0, address)),
    ...cache.map(([key, entry]) => row(key.split('|')[0], '(temp, OK)', Math.floor(Math.max(0, now - Number(entry.created ?? now)) / 3600000), entry.address)),
  ];
}

export function iosDirectory(device: Device): string[] {
  const stats = fileSystemStats(device), files = Object.entries<string>(device.config.features.files ?? {});
  return ['Directory of flash:/', '',
    ...(files.length ? files.map(([name, body], i) => String(i + 1).padStart(5) + '  -rw-' + String(new TextEncoder().encode(body).byteLength).padStart(12) + '<no date>'.padStart(29) + '  ' + name) : ['No files in directory']),
    '', `${stats.capacity} bytes total (${stats.free} bytes free)`];
}

export function iosFileSystems(device: Device): string[] {
  const stats = fileSystemStats(device), row = (mark: string, size: string, free: string, type: string, flags: string, prefix: string) => mark + size.padStart(13) + free.padStart(14) + type.padStart(10) + flags.padStart(7) + '   ' + prefix;
  return ['File Systems:', '', '       Size(b)       Free(b)      Type  Flags  Prefixes',
    row(' ', '-', '-', 'opaque', 'rw', 'system:'),
    row('*', String(stats.capacity), String(stats.free), 'disk', 'rw', 'flash:'),
    row(' ', '-', '-', 'opaque', 'rw', 'null:'),
    row(' ', '-', '-', 'network', 'rw', 'tftp:'),
    row(' ', '-', '-', 'network', 'rw', 'ftp:'),
    row(' ', '-', '-', 'network', 'rw', 'scp:'),
  ];
}

export function iosReloadStatus(device: Device, now: number): string[] {
  const scheduled = device.runtime.features.scheduledReload;
  if (!scheduled) return ['No reload is scheduled.'];
  const at = iosClock(device, scheduled.due)[0].replace(/^[*.]/, '').replace(/\.\d{3} /, ' ');
  const remaining = Math.max(0, Math.ceil((scheduled.due - now) / 1000)), minutes = Math.floor(remaining / 60), seconds = remaining % 60;
  const text = minutes && seconds ? `${plural(minutes, 'minute')} and ${plural(seconds, 'second')}` : minutes ? plural(minutes, 'minute') : plural(seconds, 'second');
  return [`Reload scheduled for ${at} (in ${text}) by console`, `Reload reason: ${scheduled.reason}`];
}

function base64(bytes: number[]): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63] + (i + 1 < bytes.length ? table[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? table[n & 63] : '=');
  }
  return out;
}
function sshPublicKey(device: Device, modulus: number): string {
  const length = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const name = [...'ssh-rsa'].map(c => c.charCodeAt(0)), bytes = Math.ceil(modulus / 8), key: number[] = [0];
  for (let i = 0; i < bytes; i++) key.push(hash(`${device.id}:rsa:${modulus}:${i}`) & 255);
  key[1] |= 0x80; key[bytes] |= 1;
  return 'ssh-rsa ' + base64([...length(name.length), ...name, ...length(3), 1, 0, 1, ...length(key.length), ...key]);
}

export function iosSSHStatus(device: Device): string[] {
  const ssh = device.config.features.ssh ?? {}, keys = ssh.keys, version = ssh.version === 2 ? '2.0' : '1.99';
  return [
    ...(keys ? [`SSH Enabled - version ${version}`] : [`SSH Disabled - version ${version}`, '%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).']),
    'Authentication methods:publickey,keyboard-interactive,password',
    'Authentication Publickey Algorithms:x509v3-ssh-rsa,ssh-rsa',
    'Hostkey Algorithms:x509v3-ssh-rsa,ssh-rsa',
    'Encryption Algorithms:aes128-ctr,aes192-ctr,aes256-ctr',
    'MAC Algorithms:hmac-sha2-256,hmac-sha2-512,hmac-sha1,hmac-sha1-96',
    'KEX Algorithms:diffie-hellman-group-exchange-sha1,diffie-hellman-group14-sha1',
    `Authentication timeout: ${ssh.timeout ?? 120} secs; Authentication retries: ${ssh.retries ?? 3}`,
    'Minimum expected Diffie Hellman key size : 2048 bits',
    ...(keys ? [`IOS Keys in SECSH format(ssh-rsa, base64 encoded): ${device.config.hostname}.${device.config.features.domainName ?? ''}`.replace(/\.$/, ''), sshPublicKey(device, Number(keys.modulus ?? 2048))] : ['IOS Keys in SECSH format(ssh-rsa, base64 encoded): NONE']),
  ];
}

export function iosSSHSessions(sessions: Array<{ lineNumber: number; phase: string; username?: string; port: number }>): string[] {
  const rows = sessions.filter(session => session.port === 22);
  if (!rows.length) return ['%No SSHv2 server connections running.', '%No SSHv1 server connections running.'];
  return ['Connection Version Mode Encryption  Hmac          State                 Username',
    ...rows.flatMap(session => (['IN', 'OUT'] as const).map(mode => String(session.lineNumber + 2).padEnd(11) + '2.0'.padEnd(8) + mode.padEnd(5) + 'aes256-ctr'.padEnd(12) + 'hmac-sha2-256'.padEnd(14) + (session.phase === 'ready' ? 'Session started' : 'Authenticating').padEnd(22) + (session.username ?? ''))),
    '%No SSHv1 server connections running.'];
}

/** IOS ping result character for one reply. */
export function iosPingCode(reply: { from?: string; error?: string }, ipv6: boolean): string {
  const error = reply.error;
  if (!error) return '!';
  if (!reply.from || /timed out/i.test(error)) return '.';
  if (ipv6) {
    if (/Time exceeded/i.test(error)) return 'T';
    if (/Packet too big/i.test(error)) return 'B';
    if (/prohibited/i.test(error)) return 'A';
    if (/host unreachable/i.test(error)) return 'H';
    if (/Port unreachable/i.test(error)) return 'P';
    if (/network unreachable|^Destination unreachable$/i.test(error)) return 'X';
    if (/unreachable/i.test(error)) return '@';
    return '?';
  }
  if (/Time exceeded/i.test(error)) return '&';
  if (/Fragmentation needed/i.test(error)) return 'M';
  if (/unreachable|prohibited/i.test(error)) return 'U';
  return '?';
}

export function iosPingSummary(replies: Array<{ from?: string; error?: string; time?: number }>, sent: number, ipv6: boolean): string[] {
  const codes = replies.map(reply => iosPingCode(reply, ipv6)).join(''), lines: string[] = [];
  for (let i = 0; i < codes.length; i += 70) lines.push(codes.slice(i, i + 70));
  const ok = replies.filter(reply => !reply.error), times = ok.map(reply => Math.max(1, Math.ceil(Number(reply.time ?? 0))));
  const total = Math.max(sent, replies.length), percent = total ? Math.floor(ok.length * 100 / total) : 0;
  lines.push(`Success rate is ${percent} percent (${ok.length}/${total})${times.length ? `, round-trip min/avg/max = ${Math.min(...times)}/${Math.floor(times.reduce((a, b) => a + b, 0) / times.length)}/${Math.max(...times)} ms` : ''}`);
  return lines;
}

/** One IOS traceroute probe token. */
export function iosTraceToken(reply: { from?: string; error?: string; time?: number }): string {
  if (reply.error && (!reply.from || /timed out/i.test(reply.error))) return '*';
  const time = `${Math.max(1, Math.ceil(Number(reply.time ?? 0)))} msec`;
  if (!reply.error || /Time exceeded/i.test(reply.error)) return time;
  if (/prohibited/i.test(reply.error)) return '!A';
  if (/host unreachable/i.test(reply.error)) return '!H';
  if (/network unreachable|^Destination unreachable$/i.test(reply.error)) return '!N';
  if (/Port unreachable/i.test(reply.error)) return '!P';
  if (/Fragmentation needed|Packet too big/i.test(reply.error)) return '!F';
  if (/unreachable/i.test(reply.error)) return '!U';
  return '?';
}
