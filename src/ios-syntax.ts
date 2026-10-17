import {isIPv6} from './ip.ts';
/** Original IOS interaction helpers. These inspect syntax and never execute a command. */
export interface IosSyntaxCommand { words: string[]; description: string; args?: string }
export interface IosSyntaxContext {
  mode?: string;
  protocol?: string;
  aclType?: string;
  interfaces?: string[];
  execCommands?: IosSyntaxCommand[];
  namedProtocol?: boolean;
  addressFamily?: string;
  ethernetSpeeds?: string[];
  duplexHalf?: boolean;
}
export interface IosToken { text: string; start: number; end: number }

/** Keep source columns, including indentation, for the terminal's caret marker. */
export function iosTokens(line: string): IosToken[] {
  return [...line.matchAll(/"[^"\n]*"|'[^'\n]*'|\S+/g)].map(match => ({
    text: match[0].replace(/^(["'])(.*)\1$/, '$2'), start: match.index!, end: match.index! + match[0].length,
  }));
}

export function iosInvalidInput(prompt: string, line: string, offset: number): string[] {
  const column = prompt.length + Math.max(0, Math.min(line.length, offset));
  return [' '.repeat(column) + '^', "% Invalid input detected at '^' marker."];
}

interface Atom { label: string; description: string; literal?: string; valid?: (text: string) => boolean; values?: string[]; repeat?: boolean }
type Form = Atom[];
const word = (literal: string, description = literal): Atom => ({ label: literal, literal, description });
const argument = (label: string, description: string, valid?: Atom['valid'], values?: string[]): Atom => ({ label, description, valid, values });
const choices = (values: string[], description?: string): Form[] => values.map(value => [word(value, description || value)]);
const ipv4 = (value: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(part => +part <= 255);
const ip = (description = 'IPv4 address') => argument('A.B.C.D', description, ipv4);
const text = (description = 'Name') => argument('WORD', description);
const number = (min: number, max: number, description: string) => argument(`<${min}-${max}>`, description, value => /^\d+$/.test(value) && +value >= min && +value <= max);
const tail = (description = 'Text') => ({ ...argument('LINE', description), repeat: true });
const optional = (...atoms: Atom[]): Form[] => [[], atoms];
const combine = (head: Form[], suffix: Form[]): Form[] => head.flatMap(a => suffix.map(b => [...a, ...b]));
function interfacePrefix(value: string, candidate: string): boolean {
  const typed = /^([a-z-]+)([\d/.]*)$/i.exec(value), full = /^([a-z-]+)([\d/.]*)$/i.exec(candidate);
  return !!typed && !!full && full[1].toLowerCase().startsWith(typed[1].toLowerCase()) && full[2].startsWith(typed[2]);
}
const iface = (context: IosSyntaxContext) => argument('INTERFACE', 'Interface name', value => {
  if (!/^[a-z][a-z-]*\d[\d/.]*$/i.test(value)) return false;
  return !context.interfaces || context.interfaces.some(name => interfacePrefix(value, name) && name.match(/[\d/.]+$/)?.[0] === value.match(/[\d/.]+$/)?.[0]) || /^(?:lo(?:opback)?|vl(?:an)?|tu(?:nnel)?|po(?:rt-channel)?)\d+$/i.test(value);
}, context.interfaces);
const prefix = () => argument('X:X:X:X::X/<0-128>', 'IPv6 prefix');

interface SyntaxGraph { edges: { atom: Atom; next: SyntaxGraph }[]; complete: boolean }
const graph = (complete = false): SyntaxGraph => ({ edges: [], complete });
function chain(atoms: Atom[], next: SyntaxGraph): SyntaxGraph {
  for (let index = atoms.length - 1; index >= 0; index--) next = { edges: [{ atom: atoms[index], next }], complete: false };
  return next;
}
const union = (...nodes: SyntaxGraph[]): SyntaxGraph => ({ edges: nodes.flatMap(node => node.edges), complete: nodes.some(node => node.complete) });
const aclGraphs = new Map<string, SyntaxGraph>();

/** A small shared graph avoids expanding every combination of two addresses and two port operators. */
function aclGraph(type: string): SyntaxGraph {
  const cached = aclGraphs.get(type); if (cached) return cached;
  const flags = graph(true);
  flags.edges.push({ atom: word('log', 'Log matching packets'), next: flags }, { atom: word('time-range', 'Restrict the active time'), next: chain([text('Time range name')], flags) });
  const ipv6 = type === 'ipv6';
  const endpoint = (next: SyntaxGraph): SyntaxGraph => union(
    chain([word('any', 'Any source or destination')], next),
    chain([word('host', 'Single host address'), ipv6 ? argument('X:X:X:X::X', 'IPv6 host address', value => value.includes(':')) : ip('Host address')], next),
    ipv6 ? chain([argument('X:X:X:X::X/<0-128>', 'IPv6 prefix', value => value.includes(':') && value.includes('/'))], next) : chain([ip('Address')], union(next, chain([ip('Wildcard mask')], next))),
  );
  const ports = ['www', 'http', 'https', 'domain', 'ssh', 'telnet', 'ftp', 'tftp'];
  const port = argument('<0-65535>', 'Port number or service name', value => ports.includes(value.toLowerCase()) || /^\d+$/.test(value) && +value <= 65535, ports);
  const portMatch = (next: SyntaxGraph) => union(next, ...['eq', 'gt', 'lt'].map(operator => chain([word(operator, `${operator} port match`), port], next)), chain([word('range', 'Inclusive port range'), port, port], next));
  let root: SyntaxGraph;
  if (type === 'standard') root = endpoint(flags);
  else {
    const plain = endpoint(endpoint(flags)), transport = endpoint(portMatch(endpoint(portMatch(flags))));
    const icmpTail = union(flags, ...['echo', 'echo-request', 'echo-reply', 'unreachable', 'time-exceeded', 'packet-too-big'].map(name => chain([word(name, 'ICMP message type')], union(flags, chain([number(0, 255, 'ICMP code')], flags)))), chain([number(0, 255, 'ICMP type')], union(flags, chain([number(0, 255, 'ICMP code')], flags))));
    const icmp=endpoint(endpoint(icmpTail)),numeric=(valid:(value:number)=>boolean)=>({...number(0,255,'IP protocol number'),valid:(value:string)=>/^\d+$/.test(value)&&+value<=255&&valid(+value)});
    root = union(...[ipv6?'ipv6':'ip',...(!ipv6?['igmp']:[]),'gre','esp','ah','ospf','eigrp','pim'].map(protocol=>chain([word(protocol,'IP protocol')],plain)),...['tcp','udp'].map(protocol=>chain([word(protocol,'Transport protocol')],transport)),chain([word('icmp','Internet Control Message Protocol')],icmp),chain([numeric(value=>![1,6,17,58].includes(value))],plain),chain([numeric(value=>[6,17].includes(value))],transport),chain([numeric(value=>[1,58].includes(value))],icmp));
  }
  aclGraphs.set(type, root); return root;
}

function advanceGraph(root: SyntaxGraph, tokens: IosToken[]): Position {
  let states = [root];
  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index].text, token = value.toLowerCase(), edges = states.flatMap(state => state.edges);
    const names = [...new Set(edges.map(edge => edge.atom.literal).filter((literal): literal is string => !!literal))];
    const exact = names.find(name => name === token), matches = exact ? [exact] : names.filter(name => name.startsWith(token));
    states = [...new Set(edges.filter(({ atom }) => atom.literal ? matches.length === 1 && matches[0] === atom.literal : !atom.valid || atom.valid(value)).map(edge => edge.next))];
    if (!states.length) return { atoms: [], complete: false, bad: index };
  }
  return { atoms: states.flatMap(state => state.edges.map(edge => edge.atom)), complete: states.some(state => state.complete) };
}

function optionGraph(options: Form[], complete = true): SyntaxGraph {
  const loop = graph(complete);
  for (const option of options) loop.edges.push(...chain(option, loop).edges);
  return loop;
}

function protocolGraph(path: string, context: IosSyntaxContext, no: boolean): SyntaxGraph | undefined {
  const done = graph(true), area = argument('AREA', 'Area ID, integer or dotted decimal', value => ipv4(value) || /^\d+$/.test(value));
  if(path==='aaa accounting')return union(...['exec','commands','connection','network','system'].map(kind=>{const prefix=[word(kind,kind==='exec'?'VTY EXEC records':kind==='commands'?'TACACS command records':'Stored configuration only'),...kind==='commands'?[number(0,15,'Command privilege level')]:[],kind==='system'?word('default','Default system list'):text('Accounting method list')];if(no)return chain(prefix,done);const server=argument('WORD',kind==='commands'?'TACACS+ server group':'RADIUS or TACACS+ server group',value=>kind!=='commands'||value!=='radius',kind==='commands'?['tacacs+']:['radius','tacacs+']),groups=optionGraph([[word('group'),server]]),required=chain([word('group'),server],groups);return chain(prefix,union(chain([word('none','Disable accounting for this list')],done),...['start-stop','stop-only'].map(mode=>chain([word(mode)],required))));}));
  if(context.mode==='line'&&path==='accounting exec')return no?done:chain([text('EXEC accounting list')],done);
  if(context.mode==='line'&&path==='accounting commands')return chain([number(0,15,'Command privilege level')],no?done:chain([text('TACACS command accounting list')],done));
  if(path==='snmp-server'){
    const name=text('SNMP name'),acl=text('Manager access-list'),subtree=text('Numeric or supported symbolic MIB subtree');
    const levels=choices(['noauth','auth','priv']),categories=optionGraph(choices(['snmp','linkdown','linkup','coldstart','warmstart','authentication']));
    if(no)return union(done,chain([word('community'),name],done),chain([word('group'),name],union(done,chain([word('v3')],union(done,...levels.map(form=>chain(form,done)))))),chain([word('user'),name],union(done,chain([name],union(done,chain([word('v3')],done))))),chain([word('view'),name],union(done,chain([subtree],union(done,...choices(['included','excluded']).map(form=>chain(form,done)))))),chain([word('enable'),word('traps')],categories),...['location','contact','chassis-id','trap-source','source-interface','packetsize','queue-length'].map(value=>chain([word(value)],done)),chain([word('engineid'),word('local')],done),chain([word('ifindex'),word('persist')],done),chain([word('host'),ip('Notification host')],done));
    const access=union(done,chain([acl],done)),permission=union(access,...choices(['ro','rw']).map(form=>chain(form,access)));
    const groupOptions=optionGraph(['read','write','notify'].map(value=>[word(value),text('MIB view name')]).concat([[word('access'),acl]]));
    const userAccess=union(done,chain([word('access'),acl],done)),password=text('Lab password, 8–64 characters');
    const privacy=union(userAccess,...['des','3des'].map(value=>chain([word('priv'),word(value),password],userAccess)),...['128','192','256'].map(bits=>chain([word('priv'),word('aes'),word(bits),password],userAccess)));
    const authentication=union(userAccess,...['md5','sha'].map(value=>chain([word('auth'),word(value),password],privacy)),...['256','384','512'].map(bits=>chain([word('auth'),word('sha-2'),word(bits),password],privacy)));
    const notificationVersion=union(chain([word('version'),word('2c'),text('Community string')],categories),...levels.map(form=>chain([word('version'),word('3'),...form,text('SNMPv3 username')],categories)));
    return union(chain([word('community'),name],union(permission,chain([word('view'),text('MIB view name')],permission))),...['location','contact','chassis-id'].map(value=>chain([word(value),tail('Text')],done)),chain([word('group'),name,word('v3')],union(...levels.map(form=>chain(form,groupOptions)))),chain([word('user'),name,text('Group name'),word('v3')],authentication),chain([word('view'),name,subtree],union(...choices(['included','excluded']).map(form=>chain(form,done)))),chain([word('engineid'),word('local'),argument('HEX','5–32 hexadecimal bytes',value=>/^(?:[0-9a-f]{2}){5,32}$/i.test(value))],done),chain([word('host'),ip('Notification host')],union(notificationVersion,chain([word('traps')],notificationVersion),chain([word('informs')],notificationVersion))),chain([word('enable'),word('traps')],categories),...['trap-source','source-interface'].map(value=>chain([word(value),iface(context)],done)),chain([word('ifindex'),word('persist')],done),chain([word('packetsize'),number(484,17940,'Stored packet-size setting')],done),chain([word('queue-length'),number(1,1000,'Stored queue-length setting')],done));
  }
  if (path === 'redistribute') {
    const options = optionGraph([[word('metric'), number(0, 4294967295, 'Redistributed metric')], [word('metric-type'), number(1, 2, 'OSPF external type')], [word('route-map'), text('Route map name')], [word('tag'), number(0, 4294967295, 'Route tag')], [word('subnets')]]);
    const process = union(options, chain([number(1, 4294967295, 'Source process or autonomous system')], options));
    return union(...['connected', 'static', 'ospf', 'eigrp', 'rip', 'bgp', 'ospfv3', 'ripng'].map(value => chain([word(value, 'Source protocol')], process)));
  }
  if (path === 'area' && context.protocol === 'ospf') {
    return chain([area], union(
      chain([word('stub')], optionGraph([[word('no-summary')]])),
      chain([word('nssa')], optionGraph(choices(['no-summary', 'default-information-originate', 'no-redistribution']))),
      chain([word('range'), ip('Network address'), ip('Subnet mask')], optionGraph([[word('not-advertise')], [word('cost'), number(0, 16777215, 'Summary cost')]])),
      chain([word('virtual-link'), ip('Remote router ID')], optionGraph([[word('hello-interval'), number(1, 65535, 'Hello seconds')], [word('dead-interval'), number(1, 65535, 'Dead seconds')], [word('authentication')], [word('authentication-key'), text('Authentication key')]])),
    ));
  }
  if (path === 'ip route') {
    const options = optionGraph([[word('name'), text('Route name')], [word('tag'), number(1, 4294967295, 'Route tag')], [word('permanent')], [word('track'), number(1, 1000, 'Tracked object')]]);
    const distance = union(options, chain([number(1, 255, 'Administrative distance')], options));
    const destination = (vrf: boolean) => {
      const next = vrf ? union(distance, chain([word('global', 'Resolve next hop in the global table')], distance)) : distance;
      const via = union(chain([ip('Next-hop address')], next), chain([iface(context)], union(next, chain([ip('Next-hop address')], next))), chain([argument('Null0', 'Discard route', value => /^nu(?:ll)?0+$/i.test(value), ['Null0'])], next));
      return chain([ip('Destination network'), ip('Subnet mask')], no ? union(done, via) : via);
    };
    return union(destination(false), chain([word('vrf'), text('VRF name')], destination(true)));
  }
  if (path === 'ip prefix-list' || path === 'ipv6 prefix-list') {
    const length = path.startsWith('ipv6') ? 128 : 32, address = argument(path.startsWith('ipv6') ? 'X:X:X:X::X/<0-128>' : 'A.B.C.D/<0-32>', 'Prefix to match', value => value.includes('/'));
    const options = optionGraph([[word('ge'), number(0, length, 'Minimum prefix length')], [word('le'), number(0, length, 'Maximum prefix length')]]);
    const rule = union(...['permit', 'deny'].map(value => chain([word(value), address], options)));
    const sequence = union(rule, chain([word('seq'), number(1, 2147483647, 'Sequence number')], no ? union(done, rule) : rule));
    return chain([text('Prefix list name')], no ? union(done, sequence) : sequence);
  }
  if (/^aaa (?:authentication login|authorization (?:exec|commands))$/.test(path)) {
    const authorization = path.includes('authorization');
    const methods = graph(true);
    const atoms = [...['local', 'none', ...(authorization ? ['if-authenticated'] : [])].map(value => [word(value)]), [word('group'), argument('WORD', 'RADIUS, TACACS+, or named server group', undefined, ['radius', 'tacacs+'])]];
    for (const method of atoms) methods.edges.push(...chain(method, methods).edges);
    const first = { edges: methods.edges, complete: no };
    return chain([...(path.endsWith('commands') ? [number(0, 15, 'Privilege level')] : []), text('Method list name or default')], first);
  }
  if (path === 'ip nat') {
    const inside = chain([word('inside'), word('source')], union(chain([word('static'), ip('Inside local address'), ip('Inside global address')], done), chain([word('list'), text('Access list name')], union(chain([word('interface'), iface(context)], union(done, chain([word('overload')], done))), chain([word('pool'), text('Pool name')], union(done, chain([word('overload')], done)))))));
    const pool = chain([word('pool'), text('Pool name')], no ? done : chain([ip('First global address'), ip('Last global address'), word('netmask'), ip('Subnet mask')], done));
    return union(inside, pool, ...(['interface', 'range'].includes(context.mode || '') ? ['inside', 'outside'].map(value => chain([word(value)], done)) : []));
  }
  if (path === 'eigrp stub') return optionGraph(choices(['connected', 'summary', 'static', 'redistributed', 'receive-only']));
  if (path === 'transport input') return optionGraph(choices(['ssh', 'telnet', 'all', 'none']), no);
  if (path === 'ntp server') return chain([ip('NTP server address')], optionGraph([[word('prefer')], [word('source'), iface(context)]]));
  if (path === 'service timestamps') return union(...['log', 'debug'].map(value => chain([word(value)], no ? done : union(chain([word('uptime')], done), chain([word('datetime')], optionGraph(choices(['msec', 'localtime', 'show-timezone', 'year'])))))));
  return undefined;
}

/** Deliberately explicit: prose in legacy argument hints is not an executable grammar. */
function formsFor(path: string, context: IosSyntaxContext): Form[] | undefined {
  if(path==='network-policy'||path==='network-policy profile')return[[number(1,4294967295,'LLDP-MED network-policy profile')]];
  if(path==='show network-policy profile')return[[],[word('detail')],[number(1,4294967295,'Network-policy profile')],[number(1,4294967295,'Network-policy profile'),word('detail')]];
  if(path==='voice vlan'&&context.mode==='network-policy')return [...combine([[number(1,4094,'Voice VLAN')],[word('dot1p')]], [[],[word('cos'),number(0,7,'Layer2 CoS priority')],[word('dscp'),number(0,63,'IP differentiated services code point')]]),...choices(['none','untagged'])];
  if(['policy-class','policy-police'].includes(context.mode??'')){
    const names=['default','ef',...Array.from({length:7},(_,i)=>'cs'+(i+1)),...Array.from({length:4},(_,c)=>Array.from({length:3},(_,d)=>`af${c+1}${d+1}`)).flat()],dscp:Form[]=[[number(0,63,'Differentiated Services Code Point')],...choices(names)];
    if(path==='set dscp')return dscp;
    if(['conform-action','exceed-action','violate-action'].includes(path))return [...choices(['transmit','drop']),...combine([[word('set-dscp-transmit')]],dscp),[word('set-prec-transmit'),number(0,7,'IP precedence')]];
  }
  if(path==='ap dot11 24ghz rf-profile'||path==='ap dot11 5ghz rf-profile')return[[text('RF profile name')]];
  if(path==='channel chan-width')return choices(['20','40','80']);
  if(path==='tx-power max')return[[argument('<-10-30>','Transmit power ceiling in dBm',value=>/^-?\d+$/.test(value)&&+value>=-10&&+value<=30)]];
  if(path==='power inline')return [[word('auto')],[word('auto'),word('max'),number(4000,30000,'Maximum PSE allocation in milliwatts')],[word('never')],[word('port'),word('priority'),word('high')],[word('port'),word('priority'),word('low')]];
  if(path==='show power inline')return [[],[iface(context)],[word('detail')],[iface(context),word('detail')],[word('priority')],[word('priority'),iface(context)]];
  if(path==='show netconf-yang')return [[word('sessions')],[word('sessions'),word('detail')],[word('sessions'),word('session-id'),number(1,4294967295,'NETCONF session ID')],[word('datastores')]];
  if(path==='mac address-table aging-time'){const seconds=argument('<0|10-1000000>','Dynamic MAC aging seconds; zero disables aging',value=>/^\d+$/.test(value)&&(+value===0||+value>=10&&+value<=1000000));return [[seconds],[seconds,word('vlan'),number(1,4094,'VLAN ID')]];}
  if(path==='wlan')return context.mode==='wireless-policy-tag'?[[text('WLAN profile'),word('policy'),text('Policy profile')]]:[[text('WLAN profile')],[text('WLAN profile'),number(1,512,'WLAN ID'),text('SSID (1–32 bytes)')]];
  if(path==='ssid')return[[text('SSID (1–32 bytes)')]];
  if(['wireless profile policy','wireless profile flex','wireless tag policy','wireless tag site','wireless tag rf','ap profile','policy-tag','site-tag','rf-tag','ap-profile','flex-profile','24ghz-rf-policy','5ghz-rf-policy','security dot1x authentication-list'].includes(path))return[[text('Profile, tag or method-list name')]];
  if(path==='ap')return[[argument('H.H.H','AP Ethernet MAC address',value=>/^[a-f0-9]{12}$/i.test(value.replace(/[:.\-]/g,'')))]];
  if(path==='wireless management interface')return[[iface(context)]];
  if(path==='aaa authentication dot1x')return[[text('Method-list name'),word('group'),text('RADIUS server group')]];
  if(path==='security wpa psk set-key')return combine(choices(['ascii','hex']),[[word('0','Unencrypted lab key'),text('WPA2 preshared key')]]);
  if(path==='capwap ap primary-base')return[[text('Controller hostname'),ip('Controller IPv4 address')]];
  if(path==='show wireless client mac-address')return[[text('Client MAC address'),word('detail')]];
  if(path==='show ap name')return[[text('AP name'),word('config'),word('general')]];
  if(path==='ap capwap timers heartbeat-timeout')return[[number(1,30,'Heartbeat interval in seconds')]];
  if(path==='native-vlan-id')return[[number(1,4094,'Native VLAN ID')]];
  if(path==='session-timeout')return[[number(1,86400,'Session timeout in seconds')]];
  if (path === '__output') return [...combine(choices(['include','exclude','begin','section','count']), [[tail('Regular expression')]]), ...combine(choices(['redirect','append','tee']), [[argument('flash:filename','Destination in simulated flash',value=>/^flash:\S+$/i.test(value))]])];
  if (path === 'ip address' && ['interface', 'range'].includes(context.mode || '')) return [[ip(), ip('Subnet mask')], [ip(), ip('Subnet mask'), word('secondary', 'Secondary IP address')], [word('dhcp', 'Obtain an IP address using DHCP')]];
  if (path === 'ip address') return [[ip()]];
  if (path === 'ipv6 address') return [[prefix()], [prefix(), word('eui-64', 'Use the interface identifier')], [argument('X:X:X:X::X', 'IPv6 address'), word('link-local', 'Link-local address')], ...choices(['autoconfig', 'dhcp'])];
  if (path === 'interface') return [[iface(context)]];
  if (path === 'interface range') return [[{ ...argument('INTERFACE', 'Interface range, for example GigabitEthernet0/1 - 3'), repeat: true }]];
  if (path === 'hostname') return [[text('System hostname')]];
  if (path === 'description' || path === 'remark') return [[tail()]];
  if (path === 'terminal length') return [[number(0, 512, 'Number of lines on screen (0 disables paging)')]];
  if (path === 'terminal width') return [[number(0, 512, 'Number of columns on screen')]];
  if (path === 'ip access-group' || path === 'ipv6 traffic-filter') return combine([[text('Access list name or number')]], choices(['in', 'out']));
  if (path === 'switchport mode') return [...choices(['access', 'trunk']), ...combine([[word('dynamic')]], choices(['auto', 'desirable']))];
  if (path === 'switchport access vlan' || path === 'switchport trunk native vlan') return [[number(1, 4094, 'VLAN ID')]];
  if (path === 'vlan' || path === 'switchport trunk allowed vlan') {
    const vlans = argument('WORD', 'VLAN IDs and ranges', value => /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value));
    return path === 'vlan' ? [[vlans]] : [[vlans], ...choices(['all', 'none']), ...combine(choices(['add', 'remove', 'except']), [[vlans]])];
  }
  if (path === 'encapsulation dot1q') return combine([[number(1, 4094, 'VLAN ID')]], optional(word('native')));
  if (path === 'channel-group') return combine([[number(1, 48, 'Port-channel number'), word('mode')]], choices(['active', 'passive', 'on', 'desirable', 'auto']));
  if (path === 'duplex') return choices(['auto', 'full', ...(context.duplexHalf===false?[]:['half'])]);
  if (path === 'speed') return choices(['auto', ...(context.ethernetSpeeds??['10','100','1000'])]);
  if (path === 'mtu' || path === 'ip mtu') return [[number(68, 9216, 'Maximum transmission unit')]];
  if(['policy-class','policy-police'].includes(context.mode??'')){if(path==='bandwidth')return [[number(1,2000000,'Bandwidth in kilobits per second')],[word('percent'),number(1,100,'Percentage of configured bandwidth')],[word('remaining'),word('percent'),number(1,100,'Percentage of remaining bandwidth')]];if(path==='priority')return [[number(1,2000000,'Priority bandwidth in kilobits per second')],[word('percent'),number(1,100,'Priority bandwidth percentage')]];if(path==='shape')return [[word('average'),number(1000,1000000000,'Average shaped bits per second')]];if(path==='queue-limit')return combine([[number(1,4096,'Simulator class queue capacity in packets')]],optional(word('packets')));}
  if (path === 'bandwidth' || path === 'delay') return [[number(1, 10000000, path === 'bandwidth' ? 'Bandwidth in kilobits per second' : 'Delay in tens of microseconds')]];
  if (['ip default-gateway', 'ip helper-address', 'router-id', 'bgp router-id', 'tunnel destination', 'default-router'].includes(path)) return [[ip()]];
  if (path === 'ip name-server' || path === 'dns-server') return [[{ ...ip('DNS server address'), repeat: true }]];
  if (path === 'router') return [[word('ospf'), number(1, 65535, 'OSPF process ID')], [word('eigrp'), number(1, 65535, 'Autonomous system number')], [word('eigrp'), text('Named EIGRP instance')], [word('bgp'), number(1, 4294967295, 'Autonomous system number')], [word('rip')]];
  if (path === 'network') {
    if (context.mode === 'pool') return [[ip('Network address'), ip('Subnet mask')]];
    if (context.protocol === 'ospf') return [[ip('Network address'), ip('Wildcard mask'), word('area'), argument('AREA', 'Area ID, integer or dotted decimal', value => ipv4(value) || /^\d+$/.test(value))]];
    if (context.protocol === 'bgp') return context.addressFamily==='ipv6'?[[prefix()]]:[[ip('Network address')], [ip('Network address'), word('mask'), ip('Subnet mask')]];
    if (context.protocol === 'eigrp') return [[ip('Network address')], [ip('Network address'), ip('Wildcard mask')]];
    if (context.protocol === 'rip') return [[ip('Network address')]];
  }
  if (path === 'passive-interface') return context.mode === 'af-interface' ? [[]] : [[word('default', 'All interfaces')], [iface(context)]];
  if (path === 'neighbor' && context.protocol === 'bgp') {
    const peer = argument('A.B.C.D or X:X:X:X::X','BGP neighbor address',value=>ipv4(value)||isIPv6(value));
    return [
      [peer, word('remote-as'), number(1, 4294967295, 'Remote autonomous system')],
      ...combine([[peer]], choices(['shutdown', 'next-hop-self', 'activate', 'route-reflector-client'])),
      [peer, word('description'), tail('Neighbor description')],
      [peer, word('update-source'), iface(context)],
      [peer, word('ebgp-multihop'), number(1, 255, 'Maximum hop count')],
      ...combine([[peer, word('route-map'), text('Route map name')], [peer, word('prefix-list'), text('Prefix list name')]], choices(['in', 'out'])),
      [peer, word('maximum-prefix'), number(1, 4294967295, 'Maximum prefixes')],
      [peer, word('timers'), number(0, 65535, 'Keepalive interval'), number(0, 65535, 'Hold time')],
      ...combine([[peer, word('send-community')]], [[], ...choices(['standard', 'extended', 'both'])]),
      [peer, word('fall-over'), word('bfd')], [peer, word('ttl-security'), word('hops'), number(1, 254, 'Maximum external hops')],
    ];
  }
  if (path === 'address-family') {
    if(context.protocol==='bgp')return combine(combine(choices(['ipv4','ipv6']),optional(word('unicast'))),[[],[word('vrf'),text('VRF name')]]);
    if (context.mode === 'vrf') return choices(['ipv4', 'ipv6']);
    if (context.namedProtocol && ['eigrp', 'eigrp6'].includes(context.protocol || '')) return combine(combine(choices(['ipv4', 'ipv6']), optional(word('unicast'))), [[word('autonomous-system'), number(1, 65535, 'Autonomous system number')]]);
    return [[word('ipv4')], [word('ipv4'), word('unicast')]];
  }
  if (path === 'ip access-list') return combine(choices(['standard', 'extended']), [[text('Access list name')]]);
  if (path === 'ipv6 access-list') return [[text('IPv6 access list name')]];
  if ((path==='permit'||path==='deny')&&context.mode==='arp-acl'){const mac=argument('H.H.H','MAC address'),ips=[[word('any')],[word('host'),ip()],[ip(),ip('Wildcard mask')]],macs=[[word('any')],[word('host'),mac],[mac,argument('H.H.H','MAC wildcard mask')]];return combine(combine(combine(combine([[],...choices(['request','response'])],[[word('ip')]]),ips),combine([[word('mac')]],macs)),optional(word('log')));}
  if (path === 'permit' || path === 'deny') {
    const endpoint: Form[] = [[word('any', 'Any address')], [word('host', 'Single host address'), ip()], [ip('Host address')], [ip('Address'), ip('Wildcard mask')]];
    if (context.aclType === 'standard') return [...endpoint, ...combine(endpoint, [[word('log')]])];
    if (context.aclType === 'extended') return combine(choices(['ip', 'tcp', 'udp', 'icmp', 'gre', 'ospf']), combine(endpoint, endpoint));
  }
  if (path === 'ip route') {
    const destinations: Form[] = [[ip('Destination network'), ip('Subnet mask')], [word('vrf'), text('VRF name'), ip('Destination network'), ip('Subnet mask')]];
    const via: Form[] = [[ip('Next-hop address')], [iface(context)], [iface(context), ip('Next-hop address')], [word('Null0', 'Discard route')]];
    return combine(combine(destinations, via), [[], [number(1, 255, 'Administrative distance')], [word('permanent')], [word('track'), number(1, 1000, 'Tracked object')], [number(1, 255, 'Administrative distance'), word('permanent')]]);
  }
  if (path === 'ipv6 route') return combine([[prefix(), argument('X:X:X:X::X', 'Next-hop address')], [prefix(), iface(context)], [prefix(), iface(context), argument('X:X:X:X::X', 'Next-hop address')]], optional(number(1, 255, 'Administrative distance')));
  if (path === 'show interfaces') return [[], [iface(context)], ...choices(['status', 'description', 'trunk', 'switchport']),[word('counters')],[word('counters'),word('errors')],[iface(context),word('counters'),word('errors')]];
  if (path === 'show ip route') return [[], [ip('Destination address')], ...choices(['connected', 'static', 'ospf', 'eigrp', 'bgp', 'rip']), [word('vrf'), text('VRF name')], [word('vrf'), text('VRF name'), ip('Destination address')]];
  if (path === 'show running-config' || path === 'show startup-config') return [[], ...combine([[word('|', 'Output modifiers')]], combine(choices(['include', 'exclude', 'begin']), [[tail('Regular expression')]]))];
  if (path === 'show cdp neighbors' || path === 'show lldp neighbors') return [[], [word('detail', 'Detailed neighbor information')]];
  if (path === 'show access-lists' || path === 'show ip access-lists' || path === 'show ipv6 access-list') return [[], [text('Access list name')]];
  if(path==='show users')return [[],[word('all','Include idle lines')]];
  if(path==='test aaa group')return combine([[text('AAA group name'),text('Username'),text('Password')]],choices(['legacy','new-code']));
  if(path==='config-register')return [[argument('0x0-0xFFFF','Configuration register, hexadecimal',value=>/^0x[0-9a-f]{1,4}$/i.test(value))]];
  if(path==='reload reason')return [[tail('Reason for reload')]];
  if(path==='reload in')return combine([[argument('MINUTES|HH:MM','Delay before reload',value=>{const m=/^(\d+)(?::([0-5]\d))?$/.exec(value);if(!m)return false;const n=Number(m[1])*(m[2]===undefined?1:60)+Number(m[2]??0);return n>=1&&n<=43200;})]],optional(tail('Reason for reload')));
  if (path === 'show clock') return [[], [word('detail', 'Show time source')]];
  if (path === 'show ip ospf' || path === 'show ipv6 ospf') return [[], ...choices(['neighbor', 'interface', 'database', 'virtual-links'])];
  if (path === 'show ip eigrp' || path === 'show ipv6 eigrp') return [[], ...choices(['neighbors', 'topology', 'interfaces'])];
  if (path === 'show ip bgp') return [[], ...choices(['summary', 'neighbors'])];
  if (path === 'show ip dhcp') return choices(['pool', 'binding', 'conflict']);
  if (path === 'show ip nat') return choices(['translations', 'statistics']);
  if (path === 'show vlan') return [[],...choices(['brief','summary','remote-span']),[word('id'),number(1,4094,'VLAN ID')],[word('name'),text('VLAN name')]];
  if(['transport input','transport output'].includes(path))return [...choices(['ssh','telnet','all','none']),[word('ssh'),word('telnet')],[word('telnet'),word('ssh')]];
  if(path==='transport preferred')return choices(['ssh','telnet','none']);
  if (path === 'ip ospf') {
    return [[number(1, 65535, 'OSPF process ID'), word('area'), argument('AREA', 'Area ID')], ...combine(choices(['cost', 'hello-interval', 'dead-interval']), [[number(1, 65535, 'Value')]]), [word('priority'), number(0, 255, 'Router priority')], ...combine([[word('network')]], choices(['broadcast', 'point-to-point', 'non-broadcast', 'point-to-multipoint'])), [word('bfd')], [word('mtu-ignore')], [word('authentication')], [word('authentication'), word('message-digest')], [word('authentication'), word('key-chain'), text('Key chain name')]];
  }
  if (path === 'crypto key generate rsa') return [[], [word('modulus'), number(512, 4096, 'RSA modulus bits')], [word('general-keys'), word('modulus'), number(512, 4096, 'RSA modulus bits')]];
  if (path === 'crypto ipsec transform-set') return combine([[text('Transform set name'), word('esp-3des')], [text('Transform set name'), word('esp-aes')], ...combine([[text('Transform set name'), word('esp-aes')]], choices(['128', '192', '256']))], choices(['esp-sha-hmac', 'esp-md5-hmac']));
  if (path === 'encryption' && context.mode === 'ike') return [[word('3des')], [word('aes')], ...combine([[word('aes')]], choices(['128', '192', '256']))];
  if (path === 'set pfs') return Array.from({ length: 24 }, (_, index) => [word(`group${index + 1}`, 'Diffie-Hellman group')]);
  if (path === 'username') return combine(combine([[text('User name')]], [[], [word('privilege'), number(0, 15, 'Privilege level')]]), [[word('secret'), text('Password')], [word('secret'), word('0'), text('Clear-text password')], [word('password'), text('Password')], ...combine([[word('password')]], combine(choices(['0', '7']), [[text('Password')]]))]);
  if (path === 'login') return [[], [word('local', 'Use local user authentication')]];
  if (path === 'address ipv4' && context.mode === 'aaa-server') {const auth=[word('auth-port'),number(1,65535,'Authentication UDP port')],acct=[word('acct-port'),number(1,65535,'Accounting UDP port')];return combine([[ip()]],context.protocol==='tacacs'?[[],[word('port'),number(1,65535,'TACACS TCP port')]]:[[],auth,acct,[...auth,...acct],[...acct,...auth]]);}
  if(path==='key'&&context.mode==='aaa-server')return [[text('Shared secret')],...combine(choices(['0','7']),[[text('Shared secret')]])];
  if(path==='timeout'&&context.mode==='aaa-server')return [[number(1,1000,'Timeout seconds')]];
  if(path==='retransmit'&&context.mode==='aaa-server')return [[number(0,100,'Retransmission attempts')]];
  if (path === 'ip http authentication') return [[word('local')], [word('enable')], [word('aaa')], [word('aaa'), word('login-authentication'), text('AAA login list')]];
  if (path === 'ip arp inspection validate') return [[{ ...argument('src-mac|dst-mac|ip', 'ARP fields to validate', value => ['src-mac', 'dst-mac', 'ip'].includes(value), ['src-mac', 'dst-mac', 'ip']), repeat: true }]];
  if(path==='tracking'&&(['device-tracking','ipv6-snooping'].includes(context.mode||'')||context.mode==='ipv6-guard'&&context.protocol==='ndInspection'))return ['enable','disable'].flatMap(value=>[[word(value)],...[number(1,86400,'Binding lifetime in seconds'),word('infinite','Keep the binding indefinitely')].map(lifetime=>[word(value),word(value==='enable'?'reachable-lifetime':'stale-lifetime'),lifetime])]);
  if(path==='ipv6 neighbor binding')return [[],[word('logging')],[word('max-entries'),number(1,1000000,'Maximum binding entries')],...['reachable-lifetime','stale-lifetime','down-lifetime'].flatMap(value=>[[word(value),number(1,86400,'Binding lifetime in seconds')],[word(value),word('infinite')]]),[word('vlan'),number(1,4094,'VLAN ID'),argument('X:X:X:X::X','IPv6 address',value=>value.includes(':')),word('interface'),iface(context),argument('H.H.H','48-bit hardware address')]];
  if(path==='spanning-tree portfast')return ['interface','range'].includes(context.mode||'')?[[],...choices(['edge','network','normal','trunk','disable']),[word('edge'),word('trunk')]]:[[word('default')],...combine(choices(['edge','network','normal']),[[word('default')]]),...combine([[],[word('edge')]],combine(choices(['bpduguard','bpdufilter']),[[word('default')]]))];
  return undefined;
}

/** Use only structurally unambiguous hints owned by the new command registry. */
function signatureForms(signature: string | undefined, context: IosSyntaxContext): Form[] | undefined {
  if (!signature || signature.includes('...') && !/^<[^>]*\.\.\.>$/.test(signature) || /(?:\]|>)\|(?:\[|<|[a-z])/.test(signature)) return undefined;
  const tokens = signature.match(/<[^>]+>|\[|\]|[^\s[\]]+/g) || [];
  let position = 0, invalid = false;
  const variable = (label: string): Atom => {
    const range = /^(\d+)-(\d+)$/.exec(label);
    if (range) return number(+range[1], +range[2], 'Value');
    if (/^(?:IPv4(?: address)?|address|IP|network|mask|wildcard|subnet-mask)$/i.test(label)) return ip(label);
    if (/^(?:interface|port)$/i.test(label)) return label === 'interface' ? iface(context) : argument('WORD', 'Interface or transport port');
    const names: Record<string, string> = { name: 'Name', ACL: 'Access list name or number', key: 'Key string', password: 'Password', secret: 'Secret', list: 'List name', chain: 'Key chain name', seconds: 'Seconds', minutes: 'Minutes', count: 'Count' };
    const atom = argument(label.includes('/') || label.includes(':') ? label : /^\d/.test(label) ? `<${label}>` : 'WORD', names[label] || label);
    return label.endsWith('...') ? { ...atom, repeat: true } : atom;
  };
  const bareVariables = new Set(['name', 'address', 'ip', 'port', 'number', 'n', 'N', 'seconds', 'size', 'severity', 'filename', 'sequence', 'bits', 'level', 'ms', 'count', 'wildcard', 'subnet-mask', 'hours', 'minutes', 'interface', 'end']);
  const sequence = (nested = false): Form[] => {
    let result: Form[] = [[]];
    while (position < tokens.length) {
      const token = tokens[position++];
      if (token === ']') { if (!nested) invalid = true; return result; }
      let alternatives: Form[];
      if (token === '[') alternatives = [[], ...sequence(true)];
      else if (token.startsWith('<') && token.endsWith('>')) alternatives = [[variable(token.slice(1, -1))]];
      else {
        const options = token.split('|');
        if (options.some(value => !value || /[<>]/.test(value))) { invalid = true; return []; }
        alternatives = options.map(value => [bareVariables.has(value) ? variable(value) : word(value)]);
      }
      result = combine(result, alternatives);
      if (result.length > 128) { invalid = true; return []; }
    }
    if (nested) invalid = true;
    return result;
  };
  const result = sequence(); return invalid ? undefined : result;
}

function specialPosition(path: string, tokens: IosToken[], context: IosSyntaxContext, no: boolean): Position | undefined {
  if(path==='reload at'){
    const months=['january','february','march','april','may','june','july','august','september','october','november','december'],month=argument('MONTH','Month name',value=>value.length>=3&&months.some(m=>m.startsWith(value.toLowerCase())),months),day=number(1,31,'Day of month'),time=argument('HH:MM','24-hour local reload time',value=>/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value)),reason=tail('Reason for reload');
    if(!tokens.length)return {atoms:[time],complete:false};if(!time.valid!(tokens[0].text))return {atoms:[],complete:false,bad:0};if(tokens.length===1)return {atoms:[day,month,reason],complete:true};
    const value=tokens[1].text,dayFirst=/^\d+$/.test(value),monthFirst=month.valid!(value);if(dayFirst||monthFirst){const first=dayFirst?day:month,second=dayFirst?month:day;if(!first.valid!(value))return {atoms:[],complete:false,bad:1};if(tokens.length===2)return {atoms:[second],complete:false};if(!second.valid!(tokens[2].text))return {atoms:[],complete:false,bad:2};}
    return {atoms:[reason],complete:true};
  }

  const protocol = protocolGraph(path, context, no);
  if (protocol) {
    const position = advanceGraph(protocol, tokens);
    // Option lists shrink after a unique option is used, matching the executable parser's contract.
    const used = new Set(tokens.map(token => token.text.toLowerCase())), unique = new Set(['name', 'tag', 'permanent', 'track', 'ge', 'le', 'prefer', 'source', 'msec', 'localtime', 'show-timezone', 'year', 'no-summary', 'default-information-originate', 'no-redistribution', 'not-advertise', 'cost']);
    position.atoms = position.atoms.filter(atom => !atom.literal || !unique.has(atom.literal) || !used.has(atom.literal));
    if (path === 'ip route' && (used.has('permanent') || used.has('track'))) position.atoms = position.atoms.filter(atom => atom.literal !== 'permanent' && atom.literal !== 'track');
    return position;
  }
  if ((path === 'permit' || path === 'deny') && ['standard', 'extended', 'ipv6'].includes(context.aclType || '')) return advanceGraph(aclGraph(context.aclType!), tokens);
  if (path === 'access-list' || path === 'sequence') {
    if (!tokens.length) return { atoms: [number(1, path === 'sequence' ? 2147483647 : 2699, path === 'sequence' ? 'Sequence number' : 'Access list number')], complete: false };
    if (!/^\d+$/.test(tokens[0].text)) return { atoms: [], complete: false, bad: 0 };
    if (tokens.length === 1) return { atoms: ['permit', 'deny', 'remark'].map(value => word(value, 'Access list entry')), complete: no };
    const action = tokens[1].text.toLowerCase();
    if (action === 'remark') return { atoms: [tail('Comment')], complete: tokens.length > 2 };
    if (!['permit', 'deny'].some(value => value.startsWith(action))) return { atoms: [], complete: false, bad: 1 };
    const id = +tokens[0].text, type = path === 'sequence' ? context.aclType || 'extended' : id <= 99 || id >= 1300 && id <= 1999 ? 'standard' : 'extended';
    const position = advanceGraph(aclGraph(type), tokens.slice(2));
    return { ...position, bad: position.bad === undefined ? undefined : position.bad + 2 };
  }
  return undefined;
}

function negativeForms(path: string, forms: Form[], context: IosSyntaxContext): Form[] {
  if(path==='network-policy'||path==='network-policy profile'&&['interface','range'].includes(context.mode??'')||path==='voice vlan'&&context.mode==='network-policy')return[[],...forms];
  if(['policy-class','policy-police'].includes(context.mode??'')&&['set dscp','conform-action','exceed-action','violate-action'].includes(path))return [[],...forms];
  if(path==='power inline')return [[],...forms];
  if(context.mode?.startsWith('wireless-')&&['tx-power max','channel chan-width','security wpa psk set-key','security dot1x authentication-list','vlan','session-timeout','native-vlan-id','policy-tag','site-tag','rf-tag','ap-profile','flex-profile','24ghz-rf-policy','5ghz-rf-policy','ap capwap timers heartbeat-timeout'].includes(path))return[[],...forms];
  if(path==='wlan'||path==='aaa authentication dot1x')return[[text('Profile or method-list name')],...forms];
  if(path==='config-register')return [[]];
  if(context.mode==='ipv6-guard'&&/^(?:hop-limit |preference |match |managed-config-flag|other-config-flag|router-preference |device-role)/.test(path))return [[],...forms];
  if(context.mode==='aaa-server'&&['address ipv4','key','timeout','retransmit','port'].includes(path))return [[],...forms];
  if(context.mode==='line'&&['history size','speed','txspeed','rxspeed','length','width','exec-timeout'].includes(path))return [[],...forms];
  if(path==='ipv6 neighbor binding')return [[],[word('logging')],...choices(['max-entries','reachable-lifetime','stale-lifetime','down-lifetime']),[word('vlan'),number(1,4094,'VLAN ID'),argument('X:X:X:X::X','IPv6 address')]];
  if(path==='tracking'&&(['device-tracking','ipv6-snooping'].includes(context.mode||'')||context.mode==='ipv6-guard'&&context.protocol==='ndInspection'))return [[]];
  if(['spanning-tree guard','spanning-tree bpduguard','spanning-tree bpdufilter','spanning-tree pathcost method'].includes(path)||path==='spanning-tree portfast'&&['interface','range'].includes(context.mode||''))return [[],...forms];
  if (path === 'channel-group') return [[number(1, 48, 'Port-channel number')],...forms];
  if (path === 'neighbor' && context.protocol === 'bgp') return [[argument('A.B.C.D or X:X:X:X::X','BGP neighbor address',value=>ipv4(value)||isIPv6(value))], ...forms];
  const bare = ['hostname', 'description', 'ip address', 'ipv6 address', 'switchport mode', 'switchport access vlan', 'switchport trunk native vlan', 'switchport trunk allowed vlan', 'mtu', 'ip mtu', 'speed', 'duplex', 'bandwidth', 'delay', 'ip default-gateway', 'ip helper-address', 'ip name-server', 'dns-server', 'default-router', 'tunnel destination'];
  return bare.includes(path) || path === 'network' && context.mode === 'pool' ? [[], ...forms] : forms;
}

interface Position { atoms: Atom[]; complete: boolean; bad?: number }
function advanceForms(forms: Form[], tokens: IosToken[]): Position {
  let states = forms.map(form => ({ form, index: 0 }));
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].text.toLowerCase();
    const literals = [...new Set(states.map(state => state.form[state.index]?.literal).filter((value): value is string => !!value))];
    const exact = literals.find(value => value.toLowerCase() === token);
    const matches = exact ? [exact] : literals.filter(value => value.toLowerCase().startsWith(token));
    states = states.filter(state => {
      const atom = state.form[state.index];
      return atom && (atom.literal ? matches.length === 1 && matches[0] === atom.literal : !atom.valid || atom.valid(tokens[index].text));
    }).map(state => ({ ...state, index: state.form[state.index].repeat ? state.index : state.index + 1 }));
    if (!states.length) return { atoms: [], complete: false, bad: index };
  }
  return { atoms: states.map(state => state.form[state.index]).filter(Boolean), complete: states.some(state => state.index === state.form.length || state.form[state.index]?.repeat && tokens.length > 0) };
}

interface Lookup { tokens: IosToken[]; specs: IosSyntaxCommand[]; index: number; no: boolean; prefix: string; context: IosSyntaxContext; fallback?: { spec: IosSyntaxCommand; index: number }; bad?: number; badColumn?: number }
/** Navigation commands have no configuration to negate or restore. */
export function iosCommandSupportsNegation(words: string[]): boolean {
  return !['end','exit','do','help','disable','logout'].includes(words[0])&&!words[0]?.startsWith('exit-');
}
function lookup(line: string, commands: IosSyntaxCommand[], context: IosSyntaxContext, includeLast: boolean): Lookup {
  const tokens = iosTokens(line), count = tokens.length - (!includeLast && !/\s$/.test(line) ? 1 : 0);
  let index = 0, no = false, specs = commands;
  if (['no', 'default'].includes(tokens[0]?.text.toLowerCase()) && !['user', 'priv'].includes(context.mode || '')) { index++; no = true; specs=specs.filter(spec=>iosCommandSupportsNegation(spec.words)); }
  if (!no && tokens[index]?.text.toLowerCase() === 'do' && !['user', 'priv'].includes(context.mode || '') && context.execCommands) { index++; specs = context.execCommands; context = { ...context, mode: 'priv' }; }
  if (context.mode === 'acl' && /^\d+$/.test(tokens[index]?.text || '')) index++;
  const start = index, prefix = line.slice(0, tokens[start]?.start ?? line.length);
  let fallback: Lookup['fallback'];
  for (; index < count; index++) {
    const depth = index - start, terminal = specs.find(spec => spec.words.length === depth);
    if (terminal?.args) fallback = { spec: terminal, index };
    const names = [...new Set(specs.map(spec => spec.words[depth]).filter(Boolean))];
    const value = tokens[index].text.toLowerCase(), exact = names.find(name => name === value), matches = exact ? [exact] : names.filter(name => name.startsWith(value));
    if (matches.length !== 1) {
      const shared = Math.max(0, ...names.map(name => { let length = 0; while (length < value.length && name[length] === value[length]) length++; return length; }));
      return { tokens, specs, index, no, prefix, context, fallback, bad: fallback ? undefined : index, badColumn: tokens[index].start + Math.min(shared, Math.max(0, value.length - 1)) };
    }
    specs = specs.filter(spec => spec.words[depth] === matches[0]);
  }
  const terminal = specs.find(spec => spec.words.length === index - start);
  if (terminal?.args) fallback = { spec: terminal, index };
  return { tokens, specs, index, no, prefix, context, fallback };
}

function argumentPosition(state: Lookup, lastIsPartial: boolean): Position | undefined {
  if (!state.fallback) return;
  const end = state.tokens.length - (lastIsPartial ? 1 : 0);
  const arguments_ = state.tokens.slice(state.fallback.index, end);
  let path = state.fallback.spec.words.join(' '), forms: Form[] | undefined, prefixTokens: IosToken[] = [];
  // Expanded command branches retain their parent's argument hint. Recover the original syntax root.
  while (true) {
    const special = specialPosition(path, [...prefixTokens, ...arguments_], state.context, state.no);
    if (special) return special;
    forms = formsFor(path, state.context);
    if (forms || !path.includes(' ')) break;
    const words = path.split(' '), last = words.pop()!;
    prefixTokens.unshift({ text: last, start: 0, end: 0 }); path = words.join(' ');
  }
  if (!forms) { path = state.fallback.spec.words.join(' '); forms = signatureForms(state.fallback.spec.args, state.context); prefixTokens = []; }
  if (!forms) return;
  return advanceForms(state.no ? negativeForms(path, forms, state.context) : forms, [...prefixTokens, ...arguments_]);
}

/** undefined asks the caller to retain its existing help for an unmodeled argument grammar. */
export function iosContextHelp(line: string, commands: IosSyntaxCommand[], context: IosSyntaxContext = {}): string[] | undefined {
  const pipe=line.indexOf('|');
  if(pipe>=0&&/^\s*(?:do\s+)?(?:s(?:h(?:o(?:w)?)?)?|mo(?:r(?:e)?)?)\s/i.test(line))return iosContextHelp('__output '+line.slice(pipe+1).trimStart(),[{words:['__output'],description:'Output modifier',args:'<modifier>'}],{mode:'priv'});
  if (context.mode === 'acl' && /^(?:(?:no|default)\s+)?\d+\s+$/i.test(line.trimStart())) return [...['permit', 'deny', 'remark'].map(value => `  ${value.padEnd(22)} Access list entry`), ...(/^\s*(?:no|default)\s/i.test(line) ? ['  <cr>'] : [])];
  const partial = !!line && !/\s$/.test(line), state = lookup(line, commands, context, false);
  if (state.bad !== undefined) return undefined;
  const position = argumentPosition(state, partial);
  if (!position) return undefined;
  if (position.bad !== undefined) return undefined;
  const value = partial ? state.tokens.at(-1)!.text.toLowerCase() : '', rows = new Map<string, string>();
  for (const atom of position.atoms) if (!atom.literal || atom.literal.toLowerCase().startsWith(value)) rows.set(atom.label, atom.description);
  if (!partial && position.complete) rows.set('<cr>', '');
  if (!rows.size) return undefined;
  return [...rows].sort(([a], [b]) => a === '<cr>' ? 1 : b === '<cr>' ? -1 : a.localeCompare(b)).map(([label, description]) => `  ${label.padEnd(22)} ${description}`.trimEnd());
}

export function iosArgumentCompletion(line: string, commands: IosSyntaxCommand[], context: IosSyntaxContext = {}): string | undefined {
  if (!line || /\s$/.test(line)) return undefined;
  const pipe=line.indexOf('|');
  if(pipe>=0&&/^\s*(?:do\s+)?(?:s(?:h(?:o(?:w)?)?)?|mo(?:r(?:e)?)?)\s/i.test(line)){
    const suffix=line.slice(pipe+1), transformed='__output '+suffix.trimStart(), result=iosArgumentCompletion(transformed,[{words:['__output'],description:'Output modifier',args:'<modifier>'}],{mode:'priv'});
    return result===undefined?undefined:line.slice(0,pipe+1)+(suffix.match(/^\s*/)?.[0]||'')+result.slice('__output '.length);
  }
  const state = lookup(line, commands, context, false), position = argumentPosition(state, true);
  if (!position || position.bad !== undefined) return undefined;
  const last = state.tokens.at(-1)!, prefix = last.text.toLowerCase();
  const values = [...new Set(position.atoms.flatMap(atom => (atom.literal ? [atom.literal] : atom.values || []).filter(value => value.toLowerCase().startsWith(prefix) || atom.label === 'INTERFACE' && interfacePrefix(last.text, value))))];
  if (values.length !== 1) return undefined;
  return line.slice(0, last.start) + values[0] + ' ';
}

/** Conservative location for a rejected command; handlers may provide a more precise argument index. */
export function iosErrorOffset(line: string, commands: IosSyntaxCommand[], context: IosSyntaxContext = {}): number {
  const state = lookup(line, commands, context, true);
  if (state.bad !== undefined) return state.badColumn ?? state.tokens[state.bad].start;
  if (state.fallback) {
    const special = specialPosition(state.fallback.spec.words.join(' '), state.tokens.slice(state.fallback.index), state.context, state.no);
    if (special?.bad !== undefined) return state.tokens[state.fallback.index + special.bad].start;
    const forms = formsFor(state.fallback.spec.words.join(' '), state.context);
    if (forms) {
      const path = state.fallback.spec.words.join(' ');
      const position = advanceForms(state.no ? negativeForms(path, forms, state.context) : forms, state.tokens.slice(state.fallback.index));
      if (position.bad !== undefined) return state.tokens[state.fallback.index + position.bad].start;
    }
  }
  return state.tokens.at(-1)?.start ?? 0;
}
