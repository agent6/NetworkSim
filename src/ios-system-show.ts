import type { Device } from './model.ts';
import { iosClock } from './ios-system.ts';
import { fileSystemStats } from './filesystem.ts';
import { NETSIM_VERSION, NETSIM_HARDWARE_REVISION, NETSIM_HARDWARE_VID, NETSIM_NVRAM_KIB, platformIdentity, platformImage, platformSoftware } from './platform-identity.ts';

/** IOS-style system output over real state and explicitly simulated NetSim hardware profiles. */
const SWITCH_KINDS = ['switch', 'poeswitch', 'l3switch'];
const hash = (text: string): number => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const two = (n: number) => String(n).padStart(2, '0');
export const iosDuration = (ms: number): string => { const s = Math.max(0, Math.floor(ms / 1000)); return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`; };
const isSwitch = (device: Device) => SWITCH_KINDS.includes(device.kind);
const uptimeMs = (device: Device, now: number) => Math.max(0, now - Number(device.runtime.features.bootTime ?? 0));

export function iosSerial(device: Device): string {
  let serial = 0xcbf29ce484222325n;
  for (const character of device.id) serial = BigInt.asUintN(64, (serial ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n);
  return 'NS' + serial.toString(36).toUpperCase().padStart(13, '0');
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
  const capacity = fileSystemStats(device).capacity, profile = platformIdentity(device.kind);
  const reason = device.runtime.features.reloadReason ?? 'Power-on';
  const radios = device.config.features.wireless?.radios?.length ?? 0;
  return [
    platformSoftware(device.kind),
    `NetSim ${profile.model} - ${profile.description}`,
    'Virtual platform (simulated hardware)', '',
    `ROM: NetSim Bootstrap, Version ${NETSIM_VERSION}`, '',
    `${device.config.hostname} uptime is ${iosUptime(uptimeMs(device, now))}`,
    `System restarted by ${reason}`,
    `System image file is "${platformImage(device.kind)}"`,
    `Last reload reason: ${reason}`, '',
    `NetSim ${profile.model} virtual processor (revision ${NETSIM_HARDWARE_REVISION}) with ${profile.processorKiB}K/${profile.ioKiB}K bytes of memory.`,
    `Processor board ID ${iosSerial(device)}`,
    `Model number: ${profile.model}`,
    `Hardware revision: ${NETSIM_HARDWARE_REVISION}`,
    ...interfaceCounts(device),
    ...(radios ? [`${plural(radios, 'IEEE 802.11 radio')}`] : []),
    `${NETSIM_NVRAM_KIB}K bytes of non-volatile configuration memory (simulated).`,
    `${capacity} bytes of flash storage (Read/Write, simulated).`, '',
    `Configuration register is 0x${current.toString(16)}${register && register.next !== register.current ? ` (will be 0x${register.next.toString(16)} at next reload)` : ''}`,
  ];
}

export function iosInventory(device: Device): string[] {
  const serial = iosSerial(device), profile = platformIdentity(device.kind);
  return [`NAME: "Chassis", DESCR: "NetSim ${profile.model} ${profile.description} (virtual chassis)"`, `PID: ${profile.model.padEnd(18)}, VID: ${NETSIM_HARDWARE_VID}, SN: ${serial}`, ''];
}

/** Per-device CPU time and allocator counters are not observable in this shared
 * JavaScript engine. Reject these views rather than publishing invented PIDs,
 * processor utilization, addresses or memory usage as hardware telemetry. */
export function iosProcesses(_device: Device, _now: number, _vty: Array<{ lineNumber: number }>, _view: 'plain' | 'cpu' | 'memory', _sorted = false): string[] {
  return ['% Per-device process telemetry is not implemented on this virtual platform.'];
}

export function iosMemoryStatistics(_device: Device): string[] {
  return ['% Memory allocator statistics are not implemented on this virtual platform.'];
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
