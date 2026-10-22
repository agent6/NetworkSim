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
  if(device.kind==='datacenter'&&kind==='log'){
    const d=instant(device,entry.time,false,true),message=/^%[A-Z0-9_]+-\d-[A-Z0-9_]+:/.test(entry.message)?entry.message:`%SYS-${entry.severity}-USERLOG: ${entry.message}`;
    return `${d.getUTCFullYear()} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${device.config.hostname} ${message}`;
  }
  const f = device.config.features, timestamp = f.timestamps?.[kind];
  let prefix = f.sequenceNumbers ? `${pad(entry.sequence ?? 0,6)}: ` : '';
  if (timestamp?.mode === 'datetime') {
    const d = instant(device, entry.time, false, !!timestamp.localtime), source = device.runtime.features.clockSource ?? (f.clockEpoch !== undefined ? 'manual' : 'unsynchronized');
    prefix += String(source).startsWith('unsynchronized') ? source === 'unsynchronized NTP' ? '.' : '*' : '';
    prefix += `${timestamp.year ? d.getUTCFullYear() + ' ' : ''}${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${timestamp.msec ? '.' + pad(d.getUTCMilliseconds(),3) : ''}${timestamp.showTimezone ? ' ' + (timestamp.localtime ? f.timezone?.name ?? 'UTC' : 'UTC') : ''}: `;
  } else if (timestamp?.mode === 'uptime') {
    const seconds = Math.floor(entry.time / 1000);
    prefix += `${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds/60)%60)}:${pad(seconds%60)}: `;
  }
  if(kind==='debug')return prefix+entry.message;
  return prefix + (/^%[A-Z0-9_]+-\d-[A-Z0-9_]+:/.test(entry.message) ? entry.message : `%SYS-${entry.severity}-USERLOG: ${entry.message}`);
}
export function iosLogging(device: Device): string[] {
  const f = device.config.features.logging ?? {}, counts=device.runtime.features.logSinkCounts??{};
  const level = (n: number) => severityNames[n] ?? String(n), logged = (name:string) => Number(counts[name]??0);
  const sink = (name: string, enabled: boolean, severity: number, indent: string) => enabled ? [`    ${name} level ${level(severity)}, ${logged(name.startsWith('Console')?'console':name.startsWith('Monitor')?'monitor':'buffer')} messages logged, xml disabled,`, `${indent}filtering disabled`] : [`    ${name} disabled`];
  const trap = f.trap ?? 6;
  return [
    `Syslog logging: ${f.enabled === false ? 'disabled' : 'enabled'} (0 messages dropped, 0 messages rate-limited, 0 flushes, 0 overruns, xml disabled, filtering disabled)`,
    '', 'No Active Message Discriminator.', '', '', '', 'No Inactive Message Discriminator.', '', '',
    ...sink('Console logging:', f.enabled !== false && f.console !== false, f.consoleLevel ?? 7, '                     '),
    ...sink('Monitor logging:', f.enabled !== false && f.monitor !== false, f.monitorLevel ?? 7, '                     '),
    ...(f.enabled !== false && f.buffered !== false ? sink('Buffer logging: ', true, f.bufferedLevel ?? 7, '                    ') : ['    Buffer logging:  disabled, xml disabled,', '                    filtering disabled']),
    '    Exception Logging: size (4096 bytes)',
    '    Count and timestamp logging messages: disabled',
    '    Persistent logging: disabled',
    '', 'No active filter modules.', '',
    f.enabled === false || f.trapEnabled === false ? '    Trap logging: disabled' : `    Trap logging: level ${level(trap)}, ${logged('trap')} message lines logged`,
    ...((f.hosts ?? []) as string[]).flatMap(address => [
      `        Logging to ${address}  (udp port 514, audit disabled,`,
      '              link up),',
      `              ${f.enabled === false || f.trapEnabled === false ? 0 : logged('trap')} message lines logged, `,
      '              0 message lines rate-limited, ',
      '              0 message lines dropped-by-MD, ',
      `              xml disabled, sequence number ${device.config.features.sequenceNumbers ? 'enabled' : 'disabled'}`,
      '              filtering disabled']),
    '        Logging Source-Interface:       VRF Name:',
    ...(f.source ? [`        ${String(f.source).padEnd(32)}`] : []),
    '', `Log Buffer (${f.bufferSize ?? 16384} bytes):`, '', ...device.runtime.logs,
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
  const stamp=(t:number|undefined)=>{if(t===undefined)return '00000000.00000000 (00:00:00.000 UTC Mon Jan 1 1900)';const ms=instant(device,t,false,false).getTime(),seconds=(Math.floor(ms/1000)+2208988800)%2**32,fraction=Math.floor((((ms%1000)+1000)%1000)/1000*2**32);return `${seconds.toString(16).toUpperCase().padStart(8,'0')}.${fraction.toString(16).toUpperCase().padStart(8,'0')} (${iosClock(device,t)[0].replace(/^[*.]/,'')})`;};
  if(!associations){
    const head=['nominal freq is 1000.0003 Hz, actual freq is 1000.0003 Hz, precision is 2**10',`ntp uptime is ${Math.floor(Math.max(0,now-Number(device.runtime.features.bootTime??0))/10)} (1/100 of seconds), resolution is 4000`];
    if(!state.synchronized)return ['Clock is unsynchronized, stratum 16, no reference clock',...head,`reference time is ${stamp(undefined)}`,'clock offset is 0.0000 msec, root delay is 0.00 msec','root dispersion is 0.00 msec, peer dispersion is 0.00 msec',"loopfilter state is 'NSET' (Never set), drift is 0.000000000 s/s",'system poll interval is 64, never updated.'];
    const updated=state.lastSync??now;
    return [`Clock is synchronized, stratum ${state.stratum??16}, reference is ${state.peer??'127.127.1.1'}`,...head,`reference time is ${stamp(updated)}`,`clock offset is ${Number(state.offset??0).toFixed(4)} msec, root delay is ${Number(state.delay??0).toFixed(2)} msec`,`root dispersion is ${state.localMaster?'0.00':'2.38'} msec, peer dispersion is ${state.localMaster?'0.00':'1.94'} msec`,"loopfilter state is 'CTRL' (Normal Controlled Loop), drift is 0.000000000 s/s",`system poll interval is 64, last update was ${Math.max(0,Math.floor((now-updated)/1000))} sec ago.`];
  }
  const data=(config.servers||[]).map((server:any)=>rows.find(row=>row.address===server.address)||{address:server.address,configured:true,role:server.role,reach:0,stratum:16});
  if(config.master!==undefined)data.push({address:'127.127.1.1',referenceClock:'.LOCL.',configured:true,valid:true,stratum:Math.max(0,config.master-1),reach:255,poll:64,delay:0,offset:0,lastReply:state.lastSync??now});
  for(const row of rows)if(!data.includes(row)&&!data.some((item:any)=>item.address===row.address))data.push(row);
  const selected=(row:any)=>state.synchronized&&state.peer===row.address,reach=(row:any)=>(row.reach??0).toString(8);
  if(detail)return data.flatMap((row:any)=>[`${row.address} ${row.configured?'configured':'dynamic'}, ipv4, ${row.authenticated?'authenticated':'unauthenticated'}, ${selected(row)?'our_master, ':''}${row.valid?'sane, valid':'insane, invalid'}, stratum ${row.stratum??16}`,`ref ID ${row.referenceClock??'.INIT.'}, time ${stamp(row.lastReply)}`,`our mode ${row.role==='peer'?'active':'client'}, peer mode ${row.role==='peer'?'active':'server'}, our poll intvl ${row.poll??64}, peer poll intvl ${row.poll??64}`,`root delay 0.00 msec, root disp 0.00, reach ${reach(row)}, sync dist ${row.reach?'4.21':'15937.50'}`,`delay ${Number(row.delay??0).toFixed(2)} msec, offset ${Number(row.offset??0).toFixed(4)} msec, dispersion ${row.reach?'1.94':'15937.50'}, jitter ${row.reach?'0.97':'0.00'} msec`,'precision 2**10, version 4','']);
  return ['','  address         ref clock       st   when   poll reach  delay  offset   disp',...data.map((row:any)=>`${selected(row)?'*':' '}${row.configured?'~':' '}${String(row.address).padEnd(16)}${String(row.referenceClock??'.INIT.').padEnd(15)}${String(row.stratum??16).padStart(3)}${(row.lastReply===undefined?'-':String(Math.max(0,Math.floor((now-row.lastReply)/1000)))).padStart(7)}${String(row.poll??64).padStart(7)}${reach(row).padStart(6)}${Number(row.delay??0).toFixed(3).padStart(7)}${Number(row.offset??0).toFixed(3).padStart(8)}${(row.reach?'1.939':'15937.').padStart(7)}`),' * sys.peer, # selected, + candidate, - outlyer, x falseticker, ~ configured'];
}
