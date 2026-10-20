import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';

function session(kind:'router'|'switch'='router'){const sim=new Simulator(4242),device=sim.addDevice(kind);return new IOSSession(sim,device.id);}
function run(cli:IOSSession,...commands:string[]){for(const command of commands){const output=cli.execute(command);assert.ok(!output.some(line=>line.startsWith('%')),`${command}: ${output.join('\n')}`);}}
const labels=(rows:string[])=>rows.filter(row=>row.startsWith('  ')).map(row=>row.trim().split(/\s{2,}/)[0]);

test('HELP-01 top-level help uses the IOS mode header, ASCII order, and two-column rows',()=>{
  const cli=session(),rows=cli.help('');
  assert.equal(rows[0],'Exec commands:');
  const names=labels(rows);
  assert.deepEqual(names,[...names].sort((a,b)=>a<b?-1:a>b?1:0));
  assert.ok(rows.includes('  enable      Turn on privileged commands'));
  assert.ok(rows.includes('  show        Show running system information'));
  assert.ok(!names.includes('<cr>'));
});

test('HELP-02 partial-word help lists matches with the alias marker and a trailing blank line',()=>{
  const cli=session();
  assert.deepEqual(cli.help('s'),['*s=show  show  ssh','']);
  run(cli,'enable');
  assert.deepEqual(cli.help('show ver'),['version','']);
});

test('HELP-03 IOS error strings for unknown, unrecognized, and ambiguous input',()=>{
  const cli=session();
  assert.deepEqual(cli.execute('xyzzy'),['Translating "xyzzy"...domain server (255.255.255.255)','% Unknown command or computer name, or unable to find computer address']);
  run(cli,'enable');
  assert.deepEqual(cli.help('show xyz '),['% Unrecognized command']);
  assert.equal(cli.help('s ')[0],'  aaa              Show AAA values');
  run(cli,'configure terminal');
  assert.deepEqual(cli.help('s '),['% Ambiguous command:  "s"']);
  assert.deepEqual(cli.help('no ip rout '),['% Ambiguous command:  "no ip rout"']);
});

test('HELP-04 show commands end with the output-modifier row and <cr> last',()=>{
  const cli=session();run(cli,'enable');
  assert.deepEqual(cli.help('show running-config '),['  |     Output modifiers','  <cr>  <cr>']);
  const clock=cli.help('show clock ');
  assert.deepEqual(clock,['  detail  Display detailed information','  |       Output modifiers','  <cr>    <cr>']);
  const pipe=cli.help('show version | ');
  assert.ok(pipe.includes('  include   Include lines that match'));
  assert.ok(pipe.includes('  section   Filter a section of output'));
});

test('HELP-05 sub-mode help shows the mode header, hides end/do and inherited global commands',()=>{
  const cli=session();run(cli,'enable','configure terminal','router ospf 1');
  const rows=cli.help(''),names=labels(rows);
  assert.equal(rows[0],'Router configuration commands:');
  for(const hidden of ['end','do','hostname','interface','router'])assert.ok(!names.includes(hidden),hidden);
  for(const shown of ['default','exit','network','no','router-id'])assert.ok(names.includes(shown),shown);
  assert.deepEqual(cli.help('do '),['  LINE  Exec Command']);
  run(cli,'exit','interface g0/0');
  assert.equal(cli.help('')[0],'Interface configuration commands:');
});

test('HELP-06 debug, undebug, and no debug share the IOS debug tree',()=>{
  const cli=session();run(cli,'enable');
  const debug=cli.help('debug ip ospf ');
  assert.ok(debug.includes('  adj             OSPF adjacency events'));
  assert.ok(debug.includes('  hello           OSPF hello events'));
  assert.deepEqual(cli.help('undebug ip ospf '),debug);
  assert.deepEqual(cli.help('no debug ip ospf '),debug);
});

test('HELP-07 typed-path and child-keyword lookups use IOS descriptions',()=>{
  const cli=session();run(cli,'enable');
  assert.deepEqual(cli.help('show crypto isakmp '),['  sa    Show ISAKMP Security Associations','  |     Output modifiers','  <cr>  <cr>']);
  run(cli,'configure terminal','router bgp 65000');
  const family=cli.help('address-family ipv4 ');
  assert.ok(family.includes('  unicast  Address Family modifier'));
  assert.equal(family.at(-1),'  <cr>     <cr>');
});

test('HELP-08 simulator argument tokens are replaced with IOS ranges and keywords',()=>{
  const cli=session();run(cli,'enable');
  const ospf=cli.help('clear ip ospf ');
  assert.equal(ospf[0],'  <1-65535>       Process ID number');
  assert.ok(!labels(ospf).includes('ipv4')&&!labels(ospf).includes('ipv6'));
  assert.deepEqual(cli.help('show spanning-tree mst '),['  <0-4094>  MST instance list, example 0,2-4,6,8-12','  |         Output modifiers','  <cr>      <cr>']);
  assert.deepEqual(cli.help('reload in '),['  Delay before reload (mmm or hhh:mm)']);
  assert.deepEqual(labels(cli.help('show processes ')),['cpu','memory','|','<cr>']);
  assert.ok(cli.help('show processes cpu ').includes('  sorted  Show sorted output'));
  run(cli,'configure terminal');
  assert.deepEqual(cli.help('ip ssh version '),['  <1-2>  Protocol version']);
  assert.deepEqual(cli.help('mac address-table aging-time '),['  <0-0>         Enter 0 to disable aging','  <10-1000000>  Aging time in seconds']);
  assert.deepEqual(cli.help('ip arp inspection validate '),['  dst-mac  Validate destination MAC address','  ip       Validate IP addresses','  src-mac  Validate source MAC address']);
  run(cli,'router rip');
  assert.deepEqual(cli.help('version '),['  <1-2>  version']);
});

test('HELP-09 logging severities, interface types, and transport input use IOS rows',()=>{
  const cli=session();run(cli,'enable','configure terminal');
  const logging=cli.help('logging console ');
  assert.equal(logging[0],'  <0-7>          Logging severity level');
  assert.ok(logging.includes('  alerts         Immediate action needed           (severity=1)'));
  assert.ok(logging.includes('  warnings       Warning conditions                (severity=4)'));
  assert.equal(logging.at(-1),'  <cr>           <cr>');
  const types=cli.help('interface ');
  assert.ok(types.includes('  GigabitEthernet  GigabitEthernet IEEE 802.3z'));
  assert.ok(types.includes('  Port-channel     Ethernet Channel of interfaces'));
  assert.ok(types.includes('  range            interface range command'));
  run(cli,'interface g0/0');
  assert.deepEqual(cli.help('ip nat '),['  inside   Inside interface for address translation','  outside  Outside interface for address translation']);
  run(cli,'exit','line vty 0 4');
  assert.deepEqual(cli.help('transport input '),['  all     All protocols','  none    No protocols','  ssh     TCP/IP SSH protocol','  telnet  TCP/IP Telnet protocol']);
});

test('HELP-10 argument help uses IOS wording for ACL endpoints, ports, addresses, routes and FHRP groups',()=>{
  const cli=session(),help=(line:string)=>cli.help(line).join('\n');
  run(cli,'enable');
  assert.doesNotMatch(help('show interfaces | include '),/<cr>/);
  assert.match(help('show interfaces | include up '),/LINE\s+Regular Expression[\s\S]*<cr>/);
  run(cli,'configure terminal');
  assert.match(help('access-list 10 permit '),/A\.B\.C\.D\s+Address to match[\s\S]*any\s+Any source host[\s\S]*host\s+A single host address/);
  assert.match(help('access-list 10 permit 192.0.2.0 '),/A\.B\.C\.D\s+Wildcard bits/);
  assert.match(help('access-list 100 permit tcp 192.0.2.0 '),/A\.B\.C\.D\s+Source wildcard bits/);
  assert.doesNotMatch(help('access-list 100 permit tcp 192.0.2.0 '),/<cr>/);
  assert.match(help('access-list 100 permit tcp any '),/A\.B\.C\.D\s+Destination address[\s\S]*any\s+Any destination host[\s\S]*host\s+A single destination host/);
  assert.match(help('access-list 100 permit tcp any any eq '),/<0-65535>\s+Port number[\s\S]*telnet\s+Telnet \(23\)[\s\S]*www\s+World Wide Web \(HTTP, 80\)/);
  assert.match(help('access-list 100 permit udp any any eq '),/tftp\s+Trivial File Transfer Protocol \(69\)/);
  assert.doesNotMatch(help('access-list 100 permit udp any any eq '),/www/);
  assert.deepEqual(cli.execute('access-list 100 permit tcp any any eq https'),[]);
  assert.match(help('ip route 10.0.0.0 255.0.0.0 '),/A\.B\.C\.D\s+Forwarding router's address[\s\S]*Null0\s+Null interface/);
  assert.match(help('ip dhcp excluded-address 192.0.2.1 '),/A\.B\.C\.D\s+High IP address/);
  run(cli,'interface GigabitEthernet0/0');
  assert.match(help('ip address 192.0.2.1 '),/A\.B\.C\.D\s+IP subnet mask/);
  assert.match(help('standby '),/<0-4095>\s+group number/);
  assert.match(help('standby 1 '),/ip\s+Enable HSRP IPv4 and set the virtual IP address[\s\S]*preempt\s+Overthrow lower priority Active routers/);
  run(cli,'exit','router bgp 65001');
  assert.match(help('neighbor 192.0.2.2 '),/remote-as\s+Specify a BGP neighbor[\s\S]*update-source\s+Source of routing updates/);
  assert.match(help('neighbor 192.0.2.2 route-map RM '),/in\s+Apply map to incoming routes[\s\S]*out\s+Apply map to outbound routes/);
});
test('HELP-11 ping, traceroute and system show arguments use IOS help rows',()=>{
  const cli=session(),help=(line:string)=>cli.help(line).join('\n');
  run(cli,'enable');
  assert.deepEqual(labels(cli.help('ping 192.0.2.1 ')),['data','df-bit','repeat','size','source','timeout','tos','ttl','validate','<cr>']);
  assert.match(help('ping '),/WORD\s+Ping destination address or hostname[\s\S]*ip\s+IP echo[\s\S]*vrf\s+Select VPN Routing\/Forwarding instance[\s\S]*<cr>/);
  assert.match(help('ping 192.0.2.1 repeat '),/<1-100>\s+Repeat count/);
  assert.match(help('ping 192.0.2.1 timeout '),/<1-60>\s+Timeout in seconds/);
  assert.match(help('ping 192.0.2.1 ttl '),/<1-255>\s+Time to live/);
  assert.match(help('ping 192.0.2.1 ttl 3 '),/<cr>/);
  assert.match(help('ping ::1 source ::1 '),/<cr>/);
  assert.match(help('ping ip vrf BLUE '),/WORD\s+Ping destination address or hostname/);
  assert.match(help('ping 192.0.2.1 data-pattern '),/Hex-data-pattern\s+Data pattern/);
  assert.match(help('ping 192.0.2.1 data 0xABCD '),/<cr>/);
  assert.deepEqual(labels(cli.help('traceroute 192.0.2.1 ')),['numeric','port','probe','source','timeout','ttl','<cr>']);
  assert.match(help('traceroute 192.0.2.1 ttl '),/<0-255>\s+minimum ttl/);
  assert.match(help('traceroute 192.0.2.1 ttl 1 '),/<0-255>\s+maximum ttl/);
  assert.doesNotMatch(help('traceroute '),/<cr>/);
  assert.match(help('show memory '),/statistics\s+Memory statistics/);
  assert.match(help('show line '),/<0-6>\s+First Line range/);
  run(cli,'configure terminal','line vty 0 15','end');
  assert.match(help('show line '),/<0-17>\s+First Line range/);
  assert.match(help('show line vty '),/<0-15>\s+Virtual terminal line number/);
  assert.match(cli.execute('show line 17').join('\n'),/VTY/);
});
