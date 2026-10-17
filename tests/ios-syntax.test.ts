import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { iosTokens, iosInvalidInput, iosContextHelp, iosArgumentCompletion, iosErrorOffset, type IosSyntaxCommand, type IosSyntaxContext } from '../src/ios-syntax.ts';

function lab(...commands: string[]) {
  const engine = new Simulator(894), device = engine.addDevice('router'), session = new IOSSession(engine, device.id);
  for (const command of commands) assert.ok(!session.execute(command).some(line => line.startsWith('%')), command);
  // Inspect the actual original command metadata; help must not execute a handler to discover syntax.
  const specs = () => (session as unknown as { commands(): IosSyntaxCommand[] }).commands();
  const context = (extra: IosSyntaxContext = {}): IosSyntaxContext => ({ mode: session.mode, interfaces: Object.keys(device.config.interfaces), ...extra });
  return { engine, device, session, specs, context };
}

test('caret offset identifies the rejected word while preserving actual terminal indentation', () => {
  const { session, specs, context } = lab('enable');
  const command = '  show   zzunknown';
  assert.equal(iosErrorOffset(command, specs(), context()), command.indexOf('zzunknown'));
  const output = iosInvalidInput(session.prompt, command, command.indexOf('zzunknown'));
  assert.equal(output[0].indexOf('^'), (session.prompt + '  show   ').length);
  assert.equal(output[1], "% Invalid input detected at '^' marker.");
  const typo = 'show ip interfaace brief';
  assert.equal(iosErrorOffset(typo, specs(), context()), typo.indexOf('interfaace') + 7);
  assert.deepEqual(iosTokens('description "Core uplink"'), [{ text: 'description', start: 0, end: 11 }, { text: 'Core uplink', start: 12, end: 25 }]);
});

test('IPv4 argument help follows address, mask, optional secondary and completion without changing state', () => {
  const { engine, device, session, specs, context } = lab('enable', 'configure terminal', 'interface g0/0');
  const configuration = JSON.stringify(device.config), clock = engine.clock.now(), history = [...session.history];
  assert.match(iosContextHelp('ip address ', specs(), context())!.join('\n'), /A\.B\.C\.D\s+IPv4 address/);
  assert.match(iosContextHelp('ip address 192.0.2.1 ', specs(), context())!.join('\n'), /A\.B\.C\.D\s+Subnet mask/);
  const final = iosContextHelp('ip address 192.0.2.1 255.255.255.0 ', specs(), context())!.join('\n');
  assert.match(final, /secondary/); assert.match(final, /<cr>/);
  assert.equal(iosArgumentCompletion('ip address 192.0.2.1 255.255.255.0 sec', specs(), context()), 'ip address 192.0.2.1 255.255.255.0 secondary ');
  assert.equal(JSON.stringify(device.config), configuration); assert.equal(engine.clock.now(), clock); assert.deepEqual(session.history, history);
  assert.deepEqual(session.execute('ip address 192.0.2.1 255.255.255.0 secondary'), []);
  assert.equal(device.config.interfaces['GigabitEthernet0/0'].features.secondaryIps[0].ip, '192.0.2.1');
});

test('negative help permits a bare removal only for commands whose handler supports it', () => {
  const { specs, context } = lab('enable', 'configure terminal', 'interface g0/0');
  assert.match(iosContextHelp('NO ip address ', specs(), context())!.join('\n'), /<cr>/);
  assert.ok(!iosContextHelp('no interface ', specs(), context())!.some(line => line.includes('<cr>')));
  assert.equal(iosArgumentCompletion('NO ip address d', specs(), context()), 'NO ip address dhcp ');
  assert.match(iosContextHelp('no channel-group 1 ', specs(), context())!.join('\n'), /<cr>/);
});

test('expanded command metadata recovers its original argument path instead of repeating keywords', () => {
  const { session, specs, context } = lab('enable', 'configure terminal');
  const output = iosContextHelp('router ospf ', specs(), context())!.join('\n');
  assert.match(output, /<1-65535>/); assert.ok(!output.includes(' bgp '));
  assert.deepEqual(session.execute('router ospf 20'), []);
  const networkHelp = iosContextHelp('network 192.0.2.0 0.0.0.255 ', specs(), context({ protocol: 'ospf' }))!.join('\n');
  assert.match(networkHelp, /area/);
  assert.equal(iosArgumentCompletion('network 192.0.2.0 0.0.0.255 ar', specs(), context({ protocol: 'ospf' })), 'network 192.0.2.0 0.0.0.255 area ');
  assert.deepEqual(session.execute('network 192.0.2.0 0.0.0.255 area 0'), []);
});

test('BGP help depends on neighbor argument position and accepts only a unique keyword completion', () => {
  const { session, specs, context } = lab('enable', 'configure terminal', 'router bgp 65001');
  const ctx = context({ protocol: 'bgp' });
  assert.match(iosContextHelp('neighbor 192.0.2.2 ', specs(), ctx)!.join('\n'), /remote-as/);
  assert.match(iosContextHelp('neighbor 192.0.2.2 remote-as ', specs(), ctx)!.join('\n'), /Autonomous|autonomous/);
  assert.equal(iosArgumentCompletion('neighbor 192.0.2.2 rem', specs(), ctx), 'neighbor 192.0.2.2 remote-as ');
  assert.equal(iosArgumentCompletion('neighbor 192.0.2.2 r', specs(), ctx), undefined);
  assert.deepEqual(session.execute('neighbor 192.0.2.2 remote-as 65002'), []);
  assert.match(iosContextHelp('neighbor 192.0.2.2 route-map POLICY ', specs(), ctx)!.join('\n'), /in[\s\S]*out/);
});

test('interface completion reads the live interface list and help keeps do in EXEC context', () => {
  const { session, specs, context } = lab('enable', 'configure terminal', 'interface loopback70', 'exit');
  assert.equal(iosArgumentCompletion('interface Loop', specs(), context()), 'interface Loopback70 ');
  assert.equal(iosArgumentCompletion('interface lo7', specs(), context()), 'interface Loopback70 ');
  const exec = (session as unknown as { execCommands(privileged: boolean): IosSyntaxCommand[] }).execCommands(true);
  assert.match(iosContextHelp('DO show ip route ', specs(), context({ execCommands: exec }))!.join('\n'), /<cr>/);
  assert.equal(session.mode, 'config');
});

test('invalid argument caret locates an address error rather than pointing at the final valid mask', () => {
  const { specs, context } = lab('enable', 'configure terminal', 'interface g0/0');
  const line = 'ip address 192.0.2.400 255.255.255.0';
  assert.equal(iosErrorOffset(line, specs(), context()), line.indexOf('192.0.2.400'));
  assert.equal(iosContextHelp('ip address 192.0.2.400 ', specs(), context()), undefined);
});

test('ACL help walks real source/destination port grammar and sequence-prefixed entries execute', () => {
  const { session, device } = lab('enable','configure terminal','ip access-list extended WEB');
  assert.match(session.help('10 permit tcp any ').join('\n'),/range/);
  assert.match(session.help('10 permit tcp any range 1024 ').join('\n'),/<0-65535>/);
  assert.match(session.help('10 permit tcp any range 1024 65535 host 192.0.2.10 eq ').join('\n'),/service name/);
  assert.equal(session.complete('10 permit tcp any host 192.0.2.10 eq ht'),'10 permit tcp any host 192.0.2.10 eq ht');
  assert.equal(session.complete('10 permit tcp any host 192.0.2.10 eq htt'),'10 permit tcp any host 192.0.2.10 eq htt');
  assert.deepEqual(session.execute('10 permit tcp any range 1024 65535 host 192.0.2.10 eq https log'),[]);
  assert.equal(device.config.features.acls.WEB.entries[0].destinationPort,443);
  assert.match(session.help('20 permit icmp any any echo ').join('\n'),/<cr>/);
  assert.deepEqual(session.execute('20 permit icmp any any echo'),[]);
});

test('help exposes advanced parser options and does not suggest repeated unique route suffixes', () => {
  const { session, device }=lab('enable','configure terminal');
  for(const [prefix, pattern] of [
    ['ip route 192.0.2.0 255.255.255.0 Null0 220 ',/name[\s\S]*tag/],
    ['aaa authentication login default group radius ',/local/],
    ['ip prefix-list EDGE seq 10 permit 192.0.2.0/24 ',/ge[\s\S]*le/],
    ['ip nat inside source list INSIDE interface g0/0 ',/overload/],
    ['service timestamps log datetime ',/msec/],
  ] as const)assert.match(session.help(prefix).join('\n'),pattern,prefix);
  const route='ip route 192.0.2.0 255.255.255.0 Null0 220 name Discard tag 20';
  assert.deepEqual(session.execute(route),[]);
  assert.ok(!session.help(route+' ').some(line=>/^\s*(name|tag)\s/.test(line)));
  assert.equal(device.config.staticRoutes[0].tag,20);
  assert.deepEqual(session.execute('ip prefix-list EDGE seq 10 permit 192.0.2.0/24 ge 25 le 30'),[]);
  assert.deepEqual(session.execute('aaa authentication login default group radius local'),[]);
});

test('actual command execution distinguishes incomplete, ambiguous and invalid syntax atomically', () => {
  const probes=[
    {setup:['enable'],command:'show',error:/^% Incomplete command\.$/},
    {setup:['enable','configure terminal'],command:'interface',error:/^% Incomplete command\.$/},
    {setup:['enable','configure terminal'],command:'i',error:/^% Ambiguous command: "i"$/},
    {setup:['enable','configure terminal','interface g0/0'],command:'ip address 192.0.2.1',error:/^% Incomplete command\.$/},
    {setup:['enable','configure terminal','router bgp 65001'],command:'neighbor 192.0.2.2 r',error:/^% Ambiguous command: "neighbor 192.0.2.2 r"$/},
    {setup:['enable'],command:'show ip interfaace brief',error:/Invalid input detected/,caret:'show ip interfaace brief'.indexOf('interfaace')+7},
    {setup:['enable','configure terminal','interface g0/0'],command:'ip address 192.0.2.1 255.255.255.0 tertiary',error:/Invalid input detected/},
  ];
  for(const probe of probes){
    const {session,device}=lab(...probe.setup), before=JSON.stringify(device.config), mode=session.mode, prompt=session.prompt;
    const output=session.execute(probe.command);assert.match(output.join('\n'),probe.error,probe.command);
    assert.equal(JSON.stringify(device.config),before,probe.command);assert.equal(session.mode,mode);
    if(probe.caret!==undefined)assert.equal(output[0].indexOf('^'),prompt.length+probe.caret);
  }
});

test('output modifier help and completion describe the same real filter and file operations',()=>{
  const {session}=lab('enable');
  assert.match(session.help('show interfaces | ').join('\n'),/append[\s\S]*count[\s\S]*redirect[\s\S]*tee/);
  assert.match(session.help('show interfaces | count ').join('\n'),/Regular expression/);
  assert.match(session.help('show interfaces | redirect ').join('\n'),/flash:filename/);
  assert.equal(session.complete('show interfaces | red'),'show interfaces | redirect ');
});

test('AAA server and ARP binding help follows actual accepted optional ports and address selectors',()=>{
 const {device,session}=lab('enable','configure terminal','radius server RADIUS');const before=JSON.stringify(device.config);assert.match(session.help('address ipv4 192.0.2.5 ').join('\n'),/acct-port/);assert.match(session.help('address ipv4 192.0.2.5 auth-port 1812 ').join('\n'),/acct-port/);assert.match(session.help('key ').join('\n'),/0|7/);assert.match(session.help('no address ipv4 ').join('\n'),/<cr>/);assert.equal(JSON.stringify(device.config),before);assert.deepEqual(session.execute('address ipv4 192.0.2.5 acct-port 1813 auth-port 1812'),[]);assert.equal(device.config.features.aaa.servers.RADIUS.accountingPort,1813);session.execute('exit');session.execute('tacacs server TACACS');assert.doesNotMatch(session.help('address ipv4 192.0.2.6 ').join('\n'),/acct-port|auth-port/);session.execute('exit');session.execute('arp access-list BINDINGS');assert.match(session.help('permit ip ').join('\n'),/any/);assert.match(session.help('permit ip any mac ').join('\n'),/host/);assert.deepEqual(session.execute('permit ip any mac any'),[]);assert.equal(device.config.features.arpAcls.BINDINGS[0].ip,'any');
});

test('numeric IP protocols select their actual transport or ICMP argument branches',()=>{
 const {device,session}=lab('enable','configure terminal','ip access-list extended NUMERIC');const all=session.help('permit ').join('\n');for(const name of ['<0-255>','igmp','esp','ah','eigrp','pim'])assert.ok(all.includes(name),name);assert.match(session.help('permit 6 any ').join('\n'),/eq/);assert.match(session.help('permit 58 any any ').join('\n'),/echo/);assert.doesNotMatch(session.help('permit 251 any any ').join('\n'),/eq|echo/);for(const command of ['permit 6 any eq 22 any eq 80','permit 17 any any range 53 54','permit 58 any any echo-request','permit 251 any any','permit 0 any any','permit 255 any any','permit esp any any','permit ah any any','permit igmp any any'])assert.deepEqual(session.execute(command),[],command);assert.deepEqual(device.config.features.acls.NUMERIC.entries.slice(0,6).map((e:any)=>e.protocol),['tcp','udp','icmpv6','251','0','255']);const before=JSON.stringify(device.config);assert.match(session.execute('permit 256 any any').join('\n'),/between 0 and 255/);assert.equal(JSON.stringify(device.config),before);
});

test('system command help follows scheduled reload dates, AAA test modes and configuration-register syntax',()=>{
 const {device,session}=lab('enable');assert.match(session.help('show users ').join('\n'),/all/);assert.match(session.help('test aaa group radius alice secret ').join('\n'),/legacy/);assert.equal(session.complete('test aaa group radius alice secret new'),'test aaa group radius alice secret new-code ');assert.match(session.help('reload at 13:00 ').join('\n'),/MONTH/);assert.doesNotMatch(session.help('reload at 13:00 7 ').join('\n'),/<cr>/);assert.match(session.help('reload at 13:00 7 ').join('\n'),/MONTH/);assert.doesNotMatch(session.help('reload at 13:00 december ').join('\n'),/<cr>/);assert.match(session.help('reload at 13:00 december 7 ').join('\n'),/<cr>/);assert.match(session.help('reload at 13:00 7 december ').join('\n'),/<cr>/);const before=JSON.stringify(device);session.help('reload at 13:00 7 december patch window ');assert.equal(JSON.stringify(device),before);session.execute('configure terminal');assert.match(session.help('config-register ').join('\n'),/0x0-0xFFFF/);assert.match(session.help('no config-register ').join('\n'),/<cr>/);assert.deepEqual(session.execute('config-register 0x2142'),[]);assert.equal(device.configurationRegister?.next,0x2142);assert.deepEqual(session.execute('no config-register'),[]);assert.equal(device.configurationRegister?.next,0x2102);
});
