import type { Device } from './model.ts';

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = (value: number, width = 2) => String(value).padStart(width, '0');
export const severityNames = ['emergencies','alerts','critical','errors','warnings','notifications','informational','debugging'];
function instant(device: Device, now: number, calendar: boolean, local: boolean) {
  const f = device.config.features;
  return new Date(((calendar ? f.calendarEpoch : f.clockEpoch) ?? Date.UTC(2026,0,1)) + now
    + (calendar ? 0 : device.runtime.features.clockOffset ?? f.clockOffset ?? 0)
    + (local ? (f.timezone?.minutes ?? 0) * 60000 : 0));
}
export function iosClock(device: Device, now: number, calendar = false, detail = false): string[] {
  const date = instant(device, now, calendar, true), f = device.config.features;
  const source = device.runtime.features.clockSource ?? (f.clockEpoch !== undefined ? 'manual' : 'unsynchronized');
  const authoritative = !String(source).startsWith('unsynchronized');
  const marker = calendar || authoritative ? '' : source==='unsynchronized NTP'?'.':'*';
  const clock = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${calendar ? '' : '.' + pad(date.getUTCMilliseconds(),3)}`;
  const rows = [`${marker}${clock} ${f.timezone?.name ?? 'UTC'} ${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()} ${date.getUTCFullYear()}`];
  if (detail) rows.push(`Time source is ${source === 'ntp' ? 'NTP' : source === 'calendar' ? 'hardware calendar' : source === 'manual' ? 'user configuration' : source}`);
  return rows;
}
export function iosLogLine(device: Device, entry: { time: number; message: string; severity: number; sequence?: number }, kind:'log'|'debug'='log'): string {
  const f = device.config.features, timestamp = f.timestamps?.[kind];
  let prefix = f.sequenceNumbers ? `${pad(entry.sequence ?? 0,6)}: ` : '';
  if (timestamp?.mode === 'datetime') {
    const d = instant(device, entry.time, false, !!timestamp.localtime);
    prefix += `${timestamp.year ? d.getUTCFullYear() + ' ' : ''}${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${timestamp.msec ? '.' + pad(d.getUTCMilliseconds(),3) : ''}${timestamp.showTimezone ? ' ' + (timestamp.localtime ? f.timezone?.name ?? 'UTC' : 'UTC') : ''}: `;
  } else if (timestamp?.mode === 'uptime') {
    const seconds = Math.floor(entry.time / 1000);
    prefix += `${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds/60)%60)}:${pad(seconds%60)}: `;
  }
  if(kind==='debug')return prefix+entry.message;
  return prefix + (/^%[A-Z0-9_]+-\d-[A-Z0-9_]+:/.test(entry.message) ? entry.message : `%SYS-${entry.severity}-USERLOG: ${entry.message}`);
}
export function iosLogging(device: Device): string[] {
  const f = device.config.features.logging ?? {}, entries: any[] = device.runtime.features.logEntries ?? [];
  const level = (n: number) => severityNames[n] ?? String(n);
  return [
    `Syslog logging: ${f.enabled === false ? 'disabled' : 'enabled'}`,
    `    Console logging: ${f.console === false ? 'disabled' : 'level ' + level(f.consoleLevel ?? 7)}`,
    `    Monitor logging: ${f.monitor === false ? 'disabled' : 'level ' + level(f.monitorLevel ?? 7)}`,
    `    Buffer logging: ${f.buffered === false ? 'disabled' : 'level ' + level(f.bufferedLevel ?? 7)}`,
    `    Trap logging: ${f.trapEnabled === false ? 'disabled' : 'level ' + level(f.trap ?? 6)}`,
    ...((f.hosts ?? []) as string[]).map(address => `        Logging to ${address} (udp port 514)`),
    `    ${entries.length} messages retained in the event history`,
    '', `Log Buffer (${f.bufferSize ?? 16384} bytes):`, ...device.runtime.logs,
  ];
}

/** A filter operates on already produced lines and never runs a second command. */
export function filterIOSOutput(lines: string[], specification: string): string[] {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(specification.trim());
  if (!match) throw new Error('% Incomplete command.');
  const names = ['include','exclude','begin','section','count'];
  const matches = names.filter(name => name.startsWith(match[1].toLowerCase()));
  if (matches.length !== 1) throw new Error(matches.length ? '% Ambiguous filter command.' : "% Invalid input detected at '^' marker.");
  let expression = match[2]?.trim(); if (!expression) throw new Error('% Incomplete command.');
  let excludeSection = false;
  if (matches[0] === 'section' && /^(include|exclude)\s+/.test(expression)) { excludeSection = expression.startsWith('exclude '); expression = expression.replace(/^(include|exclude)\s+/, ''); }
  if (/^(["'])[\s\S]*\1$/.test(expression)) expression = expression.slice(1,-1);
  if (expression.length > 256 || /\\[1-9]|\(\?/.test(expression) || /\)[*+{]/.test(expression)) throw new Error('% Unsupported filter expression.');
  let regex: RegExp; try { regex = new RegExp(expression); } catch { throw new Error('% Invalid filter expression.'); }
  if (matches[0] === 'count') return [`Number of lines which match regexp = ${lines.filter(line => regex.test(line)).length}`];
  if (matches[0] === 'begin') { const index = lines.findIndex(line => regex.test(line)); return index < 0 ? [] : lines.slice(index); }
  if (matches[0] === 'section') {
    const sections: string[][] = [];
    for (const line of lines) { if (!/^\s/.test(line) || !sections.length) sections.push([]); sections.at(-1)!.push(line); }
    return sections.filter(section => section.some(line => regex.test(line)) !== excludeSection).flat();
  }
  return lines.filter(line => regex.test(line) === (matches[0] === 'include'));
}

export function iosNTP(device:Device, now:number, detail=false, associations=false):string[]{
  const config=device.config.features.ntp??{}, state=device.runtime.features.ntp??{}, rows:any[]=Object.values(device.runtime.features.ntpAssociations??{});
  if(!associations)return [`Clock is ${state.synchronized?'synchronized':'unsynchronized'}, stratum ${state.stratum??16}, reference is ${state.peer??(config.master?'127.127.1.1':'none')}`,...(state.synchronized?[`Clock offset is ${Number(state.offset??0).toFixed(3)} msec, root delay is ${Number(state.delay??0).toFixed(3)} msec`,`Reference time: ${state.lastSync??'?'} ms of simulation uptime`]:[]),...(state.error?[`Last synchronization failure: ${state.error}`]:[])];
  const data=(config.servers||[]).map((server:any)=>rows.find(row=>row.address===server.address)||{address:server.address,configured:true,role:server.role,reach:0,stratum:16});
  if(config.master!==undefined)data.push({address:'127.127.1.1',referenceClock:'.LOCL.',configured:true,valid:true,stratum:Math.max(0,config.master-1),reach:255,poll:64,delay:0,offset:0});
  for(const row of rows)if(!data.includes(row)&&!data.some((item:any)=>item.address===row.address))data.push(row);
  if(detail)return data.flatMap((row:any)=>[`${row.address} ${row.configured?'configured':'dynamic'}, ${row.valid?'valid':'insane'}, ${row.authenticated?'authenticated':'unauthenticated'}, stratum ${row.stratum??16}`,`our mode ${row.role==='peer'?'symmetric active':'client'}, peer mode ${row.role==='peer'?'symmetric active':'server'}`,`our poll intvl ${row.poll??64}, reach ${(row.reach??0).toString(8)}`,`delay ${row.delay===undefined?'?':row.delay.toFixed(3)} msec, offset ${row.offset===undefined?'?':row.offset.toFixed(3)} msec`,...(row.error?[`last error: ${row.error}`]:[]),'']);
  return ['     address          ref clock       st   when   poll reach  delay   offset',...data.map((row:any)=>`${state.peer===row.address&&state.synchronized?'*':' '}${row.configured?'~':' '}${row.address.padEnd(19)}${(row.referenceClock??'.INIT.').padEnd(16)}${String(row.stratum??16).padEnd(5)}${String(row.lastReply===undefined?'-':Math.floor((now-row.lastReply)/1000)).padEnd(7)}${String(row.poll??64).padEnd(5)}${(row.reach??0).toString(8).padStart(3)}  ${row.delay===undefined?'?':row.delay.toFixed(3)}  ${row.offset===undefined?'?':row.offset.toFixed(3)}`),' * sys.peer, ~ configured'];
}
