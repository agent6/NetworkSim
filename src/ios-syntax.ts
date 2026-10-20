import {isIPv6,parseCidr} from './ip.ts';
import {IOS_UNRECOGNIZED,iosArgumentDescription,iosArgumentRows,iosDescription,iosHelpRows,iosKeywordHidden,iosPartialHelp} from './ios-help.ts';
/** Original IOS interaction helpers. These inspect syntax and never execute a command. */
export interface IosSyntaxCommand { words: string[]; description: string; args?: string }
export interface IosSyntaxContext {
  mode?: string;
  protocol?: string;
  aclType?: string;
  interfaces?: string[];
  maxLine?: number;
  execCommands?: IosSyntaxCommand[];
  namedProtocol?: boolean;
  addressFamily?: string;
  ethernetSpeeds?: string[];
  duplexHalf?: boolean;
  /** Terminal width used to wrap help descriptions. */
  width?: number;
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

interface InterfaceSyntax {context:IosSyntaxContext;create?:boolean;family?:string;range?:boolean}
interface Atom { label: string; description: string; literal?: string; valid?: (text: string) => boolean; values?: string[]; repeat?: boolean; interface?:InterfaceSyntax }
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
const virtualInterfaces:Record<string,[number,number]>={Loopback:[0,2147483647],Vlan:[1,4094],Tunnel:[0,2147483647],'Port-channel':[1,48]};
const interfaceTypeHelp:Record<string,string>={GigabitEthernet:'GigabitEthernet IEEE 802.3z',Loopback:'Loopback interface','Port-channel':'Ethernet Channel of interfaces',Tunnel:'Tunnel interface',Vlan:'Catalyst Vlans'};
const interfaceParts=(name:string)=>/^(.*?[a-z-])(\d[\d/.]*)$/i.exec(name);
function interfaceFamilies(syntax:InterfaceSyntax):string[] {
  return [...new Set([...(syntax.context.interfaces??[]).map(name=>interfaceParts(name)?.[1]).filter((name):name is string=>!!name),...syntax.create?Object.keys(virtualInterfaces):[]])];
}
function interfaceFragment(value:string,syntax:InterfaceSyntax):{families:string[];number?:string} {
  if(syntax.family)return {families:[syntax.family],number:value};
  const families=interfaceFamilies(syntax),prefix=families.filter(family=>family.toLowerCase().startsWith(value.toLowerCase()));
  if(prefix.length)return {families:prefix};
  const parts=interfaceParts(value);
  return {families:parts?families.filter(family=>family.toLowerCase().startsWith(parts[1].toLowerCase())):[],number:parts?.[2]};
}
function interfaceNumberValid(family:string,value:string,syntax:InterfaceSyntax):boolean {
  if(!/^\d[\d/.]*$/.test(value))return false;
  if(syntax.context.interfaces?.some(name=>name.toLowerCase()===(family+value).toLowerCase()))return true;
  if(!syntax.context.interfaces)return true;
  const range=syntax.create&&virtualInterfaces[family];
  if(range&&/^\d+$/.test(value)&&Number.isSafeInteger(+value)&&+value>=range[0]&&+value<=range[1])return true;
  return !!syntax.create&&family==='GigabitEthernet'&&/^\d+\/\d+\.\d+$/.test(value)&&+value.split('.')[1]<=2147483647&&syntax.context.interfaces.includes(family+value.split('.')[0]);
}
function interfaceValid(value:string,syntax:InterfaceSyntax):boolean {
  const {families,number}=interfaceFragment(value,syntax);
  return families.length===1&&number!==undefined&&interfaceNumberValid(families[0],number,syntax);
}
const iface = (context: IosSyntaxContext,create=false,family?:string):Atom => {
  const syntax:InterfaceSyntax={context,create,family};
  return {...argument('INTERFACE','Interface name',value=>interfaceValid(value,syntax)),interface:syntax};
};
function interfaceHelp(value:string,syntax:InterfaceSyntax):[string,string][] {
  if(syntax.range&&value.includes(','))value=value.slice(value.lastIndexOf(',')+1);
  const {families,number}=interfaceFragment(value,syntax),rows:[string,string][]=[];
  for(const family of families) {
    if(number===undefined){rows.push([family,interfaceTypeHelp[family]??`${family} interface`]);continue;}
    const virtual=syntax.create&&virtualInterfaces[family];
    if(virtual){rows.push([`<${virtual[0]}-${virtual[1]}>`,`${family} interface number`]);continue;}
    const separator=Math.max(number.lastIndexOf('/'),number.lastIndexOf('.')),stem=number.slice(0,separator+1),partial=number.slice(separator+1);
    const ids=(syntax.context.interfaces??[]).flatMap(name=>{const parts=interfaceParts(name);return parts?.[1]===family?[parts[2]]:[];});
    const numbers=[...new Set(ids.filter(id=>id.startsWith(stem)).map(id=>id.slice(stem.length).split(/[/.]/)[0]).filter(n=>n.startsWith(partial)).map(Number))].sort((a,b)=>a-b);
    for(let i=0;i<numbers.length;i++){const start=numbers[i];let end=start;while(numbers[i+1]===end+1)end=numbers[++i];rows.push([`<${start}-${end}>`,`${family} interface number`]);}
    for(const punctuation of ['/','.'])if(number&&ids.some(id=>id.startsWith(number+punctuation)))rows.push([punctuation,'Continue interface number']);
    if(syntax.create&&family==='GigabitEthernet'&&/^\d+\/\d+$/.test(number)&&ids.includes(number))rows.push(['.','Subinterface number']);
    if(syntax.create&&family==='GigabitEthernet'&&/^\d+\/\d+\.\d*$/.test(number)&&ids.includes(number.split('.')[0]))rows.push(['<0-2147483647>','Subinterface number']);
  }
  return rows;
}
/** Complete the type, preserving the exact number typed; never guess a port or virtual ID. */
function interfaceCompletion(value:string,syntax:InterfaceSyntax):string|undefined {
  const comma=syntax.range?value.lastIndexOf(','):-1,head=value.slice(0,comma+1),fragment=value.slice(comma+1);
  if(!fragment||syntax.family)return;
  const {families,number}=interfaceFragment(fragment,syntax);
  if(families.length!==1)return;
  const family=families[0];
  if(number===undefined)return head+family;
  if(!interfaceHelp(fragment,syntax).length)return;
  return head+family+number+(interfaceNumberValid(family,number,syntax)?' ':'');
}
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
  flags.edges.push({ atom: word('log', 'Log matches against this entry'), next: flags }, { atom: word('time-range', 'Specify a time-range'), next: chain([text('Time-range entry name')], flags) });
  const ipv6 = type === 'ipv6';
  // IOS words source and destination help differently (`Source wildcard bits`, `Any destination host`).
  const endpoint = (next: SyntaxGraph, role: 'standard' | 'source' | 'destination'): SyntaxGraph => {
    const side = role === 'destination' ? 'destination' : 'source', Side = role === 'destination' ? 'Destination' : 'Source';
    const address = role === 'standard' ? 'Address to match' : `${Side} address`, host = role === 'standard' ? 'Host address' : address;
    return union(
      chain([word('any', ipv6 ? `Any ${side} prefix` : `Any ${side} host`)], next),
      chain([word('host', role === 'standard' ? 'A single host address' : `A single ${side} host`), ipv6 ? argument('X:X:X:X::X', host, value => value.includes(':')) : ip(host)], next),
      ipv6 ? chain([argument('X:X:X:X::X/<0-128>', `IPv6 ${side} prefix x:x::y/<z>`, value => value.includes(':') && value.includes('/'))], next) : chain([ip(address)], role === 'standard' ? union(next, chain([ip('Wildcard bits')], next)) : chain([ip(`${Side} wildcard bits`)], next)),
    );
  };
  // IOS lists named ports per transport; names the handler also accepts but IOS does not list stay valid without a help row.
  const ports = ['www', 'http', 'https', 'domain', 'ssh', 'telnet', 'ftp', 'tftp'];
  const namedPorts: Record<'tcp' | 'udp', Record<string, string>> = {
    tcp: { domain: 'Domain Name Service (53)', ftp: 'File Transfer Protocol (21)', telnet: 'Telnet (23)', www: 'World Wide Web (HTTP, 80)' },
    udp: { domain: 'Domain Name Service (DNS, 53)', tftp: 'Trivial File Transfer Protocol (69)' },
  };
  const portValue = (protocol: 'tcp' | 'udp', next: SyntaxGraph) => {
    const listed = namedPorts[protocol], unlisted = ports.filter(name => !listed[name]);
    return union(chain([argument('<0-65535>', 'Port number', value => unlisted.includes(value.toLowerCase()) || /^\d+$/.test(value) && +value <= 65535)], next), ...Object.entries(listed).map(([name, help]) => chain([word(name, help)], next)));
  };
  const operators: Record<string, string> = { eq: 'Match only packets on a given port number', gt: 'Match only packets with a greater port number', lt: 'Match only packets with a lower port number' };
  const portMatch = (protocol: 'tcp' | 'udp', next: SyntaxGraph) => union(next, ...Object.entries(operators).map(([operator, help]) => chain([word(operator, help)], portValue(protocol, next))), chain([word('range', 'Match only packets in the range of port numbers')], portValue(protocol, portValue(protocol, next))));
  let root: SyntaxGraph;
  if (type === 'standard') root = endpoint(flags, 'standard');
  else {
    const source = (next: SyntaxGraph) => endpoint(next, 'source'), destination = (next: SyntaxGraph) => endpoint(next, 'destination');
    const plain = source(destination(flags)), transport = (protocol: 'tcp' | 'udp') => source(portMatch(protocol, destination(portMatch(protocol, flags)))), tcp = transport('tcp'), udp = transport('udp');
    const icmpTypes: Record<string, string> = { echo: 'Echo (ping)', 'echo-request': 'Echo request', 'echo-reply': 'Echo reply', unreachable: 'All unreachables', 'time-exceeded': 'All time exceededs', 'packet-too-big': 'Packet too big' };
    const icmpTail = union(flags, ...Object.entries(icmpTypes).map(([name, help]) => chain([word(name, help)], union(flags, chain([number(0, 255, 'ICMP message code')], flags)))), chain([number(0, 255, 'ICMP message type')], union(flags, chain([number(0, 255, 'ICMP message code')], flags))));
    const icmp=source(destination(icmpTail)),numeric=(valid:(value:number)=>boolean)=>({...number(0,255,'An IP protocol number'),valid:(value:string)=>/^\d+$/.test(value)&&+value<=255&&valid(+value)});
    const protocols: Record<string, string> = { ip: 'Any Internet Protocol', ipv6: 'Any IPv6 protocol', igmp: 'Internet Gateway Message Protocol', gre: "Cisco's GRE tunneling", esp: 'Encapsulation Security Payload', ah: 'Authentication Header Protocol', ospf: 'OSPF routing protocol', eigrp: "Cisco's EIGRP routing protocol", pim: 'Protocol Independent Multicast' };
    root = union(...[ipv6?'ipv6':'ip',...(!ipv6?['igmp']:[]),'gre','esp','ah','ospf','eigrp','pim'].map(protocol=>chain([word(protocol,protocols[protocol])],plain)),chain([word('tcp','Transmission Control Protocol')],tcp),chain([word('udp','User Datagram Protocol')],udp),chain([word('icmp','Internet Control Message Protocol')],icmp),chain([numeric(value=>![1,6,17,58].includes(value))],plain),chain([numeric(value=>value===6)],tcp),chain([numeric(value=>value===17)],udp),chain([numeric(value=>[1,58].includes(value))],icmp));
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
  if(path==='aaa accounting')return union(...['exec','commands','connection','network','system'].map(kind=>{const prefix=[word(kind,({exec:'For starting an exec (shell).',commands:'For exec (shell) commands.',connection:'For outbound connections. (telnet, rlogin)',network:'For network services. (PPP, SLIP, ARAP)',system:'For system events.'} as Record<string,string>)[kind]),...kind==='commands'?[number(0,15,'Command privilege level')]:[],kind==='system'?word('default','Default system list'):text('Accounting method list')];if(no)return chain(prefix,done);const server=argument('WORD','Server-group name',value=>kind!=='commands'||value!=='radius',kind==='commands'?['tacacs+']:['radius','tacacs+']),groups=optionGraph([[word('group'),server]]),required=chain([word('group'),server],groups);return chain(prefix,union(chain([word('none','Disable accounting for this list')],done),...['start-stop','stop-only'].map(mode=>chain([word(mode)],required))));}));
  if(context.mode==='line'&&path==='accounting exec')return no?done:chain([text('EXEC accounting list')],done);
  if (['standby', 'vrrp', 'glbp'].includes(path) && ['interface', 'range'].includes(context.mode || '')) {
    const hsrp = path === 'standby', vrrp = path === 'vrrp', glbp = path === 'glbp';
    const help: Record<string, string> = hsrp
      ? { ip: 'Enable HSRP IPv4 and set the virtual IP address', preempt: 'Overthrow lower priority Active routers', priority: 'Priority level', track: 'Priority tracking', timers: 'Hello and hold timers', authentication: 'Authentication' }
      : vrrp
        ? { ip: 'Enable Virtual Router Redundancy Protocol (VRRP) for IP', preempt: 'Enable preemption of lower priority Master', priority: 'Priority of this VRRP group', track: 'Event Tracking', timers: 'Set the VRRP timers', authentication: 'Authentication string' }
        : { ip: 'Enable group and set virtual IP address', preempt: 'Overthrow lower priority designated routers', priority: 'Priority level', track: 'Weighting tracking', timers: 'Adjust GLBP timers', authentication: 'Authentication method', 'load-balancing': 'Load balancing method', weighting: 'Gateway weighting and tracking' };
    const branch = (key: string, next: SyntaxGraph) => chain([word(key, help[key])], next);
    const seconds = (name: string, unit: string, next: SyntaxGraph) => union(chain([number(1, 3600, `${name} in seconds`)], next), chain([word('msec', `Specify ${unit} in milliseconds`), number(50, 3600000, `${name} in milliseconds`)], next));
    const timers = vrrp ? chain([word('advertise', 'Set the Advertisement timer')], seconds('Advertisement interval', 'the advertisement interval', done)) : seconds('Hello interval', 'hello interval', seconds('Hold time', 'hold time', done));
    const minimum = number(0, 3600, 'Number of seconds for minimum delay');
    const preempt = union(done, chain([word('delay', 'Wait before preempting'), word('minimum', 'Delay at least this long')], no ? union(done, chain([minimum], done)) : chain([minimum], done)));
    const authentication = union(chain([text(hsrp ? 'Plain text authentication string (8 chars max)' : 'Authentication string')], done), chain([word('text', 'Plain text authentication'), text('Plain text authentication string')], done),
      chain([word('md5', 'Use MD5 authentication')], union(chain([word('key-chain', 'Set key chain'), text('Name of key chain')], done), chain([word('key-string', 'Set key string'), text('Key string')], done))));
    const threshold = number(1, 254, 'Weighting threshold value');
    const group = union(
      branch('ip', no ? done : chain([ip(vrrp ? 'VRRP group IP address' : 'Virtual IP address')], done)),
      branch('priority', no ? done : chain([number(1, 255, vrrp ? 'Priority level' : 'Priority value')], done)),
      branch('preempt', preempt),
      branch('track', chain([number(1, 1000, 'Tracked object number')], no ? done : union(done, chain([word('decrement', 'Priority decrement'), number(1, 255, 'Decrement value')], done)))),
      branch('timers', no ? done : timers),
      branch('authentication', no ? done : authentication),
      ...(glbp ? [
        branch('load-balancing', no ? done : union(...[['host-dependent', 'Load balance equally, source MAC determines forwarder choice'], ['round-robin', 'Load balance equally using each forwarder in turn'], ['weighted', 'Load balance in proportion to forwarder weighting']].map(([value, text]) => chain([word(value, text)], done)))),
        branch('weighting', no ? done : chain([number(1, 254, 'Weighting maximum value')], union(done, chain([word('lower', 'Weighting lower threshold'), threshold, word('upper', 'Weighting upper threshold'), threshold], done)))),
      ] : []),
    );
    const groupNumber = number(vrrp ? 1 : 0, hsrp ? 4095 : glbp ? 1023 : 255, hsrp ? 'group number' : 'Group number');
    return union(chain([groupNumber], group), ...(hsrp ? [chain([word('version', 'HSRP version')], no ? done : chain([number(1, 2, 'Version number')], done))] : []));
  }
  if (path === 'distance' && context.mode === 'router' && ['ospf', 'eigrp', 'rip'].includes(context.protocol || '')) {
    const acl = union(done, chain([number(1, 99, 'IP Standard access list number')], done), chain([text('Standard access-list name')], done));
    const rule = chain([number(1, 255, 'Administrative distance')], union(done, chain([ip('IP Source address'), ip('Wildcard bits')], acl)));
    const kinds = [['external', 'External type 5 and type 7 routes', 'Distance for external type 5 and type 7 routes'], ['inter-area', 'Inter-area routes', 'Distance for inter-area routes'], ['intra-area', 'Intra-area routes', 'Distance for intra-area routes']];
    const ospf = chain([word('ospf', 'OSPF distance')], optionGraph(kinds.map(([key, text, value]) => no ? [word(key, text)] : [word(key, text), number(1, 255, value)])));
    const eigrp = chain([word('eigrp', 'IP-EIGRP distance')], no ? done : chain([number(1, 255, 'Distance for internal routes'), number(1, 255, 'Distance for external routes')], done));
    return union(...(no ? [done] : []), rule, ...(context.protocol === 'ospf' ? [ospf] : context.protocol === 'eigrp' ? [eigrp] : []));
  }
  if (path === 'distribute-list' && context.mode === 'router' && ['ospf', 'eigrp', 'rip'].includes(context.protocol || '')) {
    const sources: [string, string, Atom?][] = [['bgp', 'Border Gateway Protocol (BGP)', number(1, 4294967295, 'Autonomous system number')], ['connected', 'Connected'], ['eigrp', 'Enhanced Interior Gateway Routing Protocol (EIGRP)', number(1, 65535, 'Autonomous system number')], ['ospf', 'Open Shortest Path First (OSPF)', number(1, 65535, 'Process ID')], ['rip', 'Routing Information Protocol (RIP)'], ['static', 'Static routes']];
    const target = (out: boolean) => union(done, chain([iface(context)], done), ...(out && context.protocol === 'ospf' ? sources.map(([key, text, id]) => chain([word(key, text)], id ? union(done, chain([id], done)) : done)) : []));
    const direction = union(chain([word('in', 'Filter incoming routing updates')], target(false)), chain([word('out', 'Filter outgoing routing updates')], target(true)));
    return union(chain([number(1, 199, 'IP access list number')], direction), chain([text('Access-list name')], direction), chain([word('prefix', 'Filter prefixes in address updates'), text('Name of an IP prefix-list')], direction), chain([word('route-map', 'Filter prefixes based on the route-map'), text('route-map name')], direction));
  }
  if (path === 'show line') {
    const maxLine = context.maxLine ?? 6;
    return union(done, chain([number(0, maxLine, 'First Line range')], done),
      chain([word('console', 'Primary terminal line'), number(0, 0, 'Primary terminal line number')], done),
      chain([word('aux', 'Auxiliary line'), number(0, 0, 'Auxiliary line number')], done),
      chain([word('vty', 'Virtual terminal'), number(0, maxLine - 2, 'Virtual terminal line number')], done));
  }
  if ((path === 'ping' || path === 'traceroute') && ['user', 'priv'].includes(context.mode || '')) {
    const trace = path === 'traceroute', keywords = ['ip', 'ipv6', 'vrf'];
    const sourceOptions: Form[] = [[word('source', 'specify source address or name'), ip('Source address')], [word('source', 'specify source address or name'), argument('X:X:X:X::X', 'Source IPv6 address', value => value.includes(':'))], [word('source', 'specify source address or name'), iface(context)]];
    const options = optionGraph(trace ? [
      [word('numeric', 'display numeric address')], [word('port', 'specify port number'), number(0, 65535, 'Port number')],
      [word('probe', 'specify number of probes per hop'), number(1, 65535, 'Number of probes')], ...sourceOptions,
      [word('timeout', 'specify time out'), number(0, 3600, 'Timeout in seconds')], [word('ttl', 'specify minimum and maximum ttl'), number(0, 255, 'minimum ttl'), number(0, 255, 'maximum ttl')],
    ] : [
      [{ ...word('data-pattern', 'specify data pattern'), label: 'data' }, argument('Hex-data-pattern', 'Data pattern', value => /^(0x)?[0-9a-f]{1,4}$/i.test(value))], [word('df-bit', 'enable do not fragment bit in IP header')],
      [word('repeat', 'specify repeat count'), number(1, 100, 'Repeat count')], [word('size', 'specify datagram size'), number(1, 65000, 'Datagram size')], ...sourceOptions,
      [word('timeout', 'specify timeout interval'), number(1, 60, 'Timeout in seconds')], [word('tos', 'specify type of service value'), number(0, 255, 'Type of service')], [word('ttl', 'specify time to live'), number(1, 255, 'Time to live')], [word('validate', 'validate reply data')],
    ]);
    const destination = chain([argument('WORD', trace ? 'Trace route to destination address or hostname' : 'Ping destination address or hostname', value => !keywords.some(keyword => keyword.startsWith(value.toLowerCase())))], options);
    const extended = context.mode === 'priv' && !trace ? done : graph();
    const vrf = chain([word('vrf', 'Select VPN Routing/Forwarding instance'), text('VPN Routing/Forwarding instance name')], destination);
    const family = (key: string, help: string) => chain([word(key, help)], union(extended, destination, vrf));
    return union(destination, extended, family('ip', trace ? 'IP Trace' : 'IP echo'), family('ipv6', trace ? 'IPv6 trace' : 'IPv6 echo'), vrf);
  }
  if (path === 'clear mac address-table' || path === 'clear mac address-table dynamic') {
    const filters = optionGraph([[word('address', 'address keyword'), argument('H.H.H', '48 bit mac address')], [word('interface', 'interface keyword'), iface(context)], [word('vlan', 'vlan keyword'), number(1, 4094, 'Vlan number')]]);
    return path.endsWith('dynamic') ? filters : union(filters, chain([word('dynamic', 'dynamic entry type')], filters));
  }
  if(context.mode==='line'&&path==='accounting commands')return chain([number(0,15,'Command privilege level')],no?done:chain([text('TACACS command accounting list')],done));
  if(path==='snmp-server'){
    const informOptions=optionGraph(['retries','timeout','pending'].flatMap(key=>{const arg=number(key==='timeout'?0:1,key==='retries'?100:key==='timeout'?42949671:4294967295,'Inform '+key);return no?[[word(key)],[word(key),arg]]:[[word(key),arg]];}));
    const name=text('SNMP name'),acl=text('Manager access-list'),subtree=text('MIB view family name or oid');
    const levels=choices(['noauth','auth','priv']),categories=optionGraph(choices(['snmp','linkdown','linkup','coldstart','warmstart','authentication']));
    if(no)return union(done,chain([word('informs')],informOptions),chain([word('community'),name],done),chain([word('group'),name],union(done,chain([word('v3')],union(done,...levels.map(form=>chain(form,done)))))),chain([word('user'),name],union(done,chain([name],union(done,chain([word('v3')],done))))),chain([word('view'),name],union(done,chain([subtree],union(done,...choices(['included','excluded']).map(form=>chain(form,done)))))),chain([word('enable'),word('traps')],categories),...['location','contact','chassis-id','trap-source','source-interface','packetsize','queue-length'].map(value=>chain([word(value)],done)),chain([word('engineid'),word('local')],done),chain([word('ifindex'),word('persist')],done),chain([word('host'),ip('Notification host')],done));
    const access=union(done,chain([acl],done)),permission=union(access,...choices(['ro','rw']).map(form=>chain(form,access)));
    const groupOptions=optionGraph(['read','write','notify'].map(value=>[word(value),text('MIB view name')]).concat([[word('access'),acl]]));
    const userAccess=union(done,chain([word('access'),acl],done)),password=text('authentication password for user'),privacyPassword=text('privacy password for user');
    const privacy=union(userAccess,...['des','3des'].map(value=>chain([word('priv'),word(value),privacyPassword],userAccess)),...['128','192','256'].map(bits=>chain([word('priv'),word('aes'),word(bits),privacyPassword],userAccess)));
    const authentication=union(userAccess,...['md5','sha'].map(value=>chain([word('auth'),word(value),password],privacy)),...['256','384','512'].map(bits=>chain([word('auth'),word('sha-2'),word(bits),password],privacy)));
    const notificationVersion=union(chain([word('version'),word('2c'),text('Community string')],categories),...levels.map(form=>chain([word('version'),word('3'),...form,text('SNMPv3 username')],categories)));
    return union(chain([word('informs')],informOptions),chain([word('community'),name],union(permission,chain([word('view'),text('MIB view name')],permission))),...['location','contact','chassis-id'].map(value=>chain([word(value),tail('Text')],done)),chain([word('group'),name,word('v3')],union(...levels.map(form=>chain(form,groupOptions)))),chain([word('user'),name,text('Group name'),word('v3')],authentication),chain([word('view'),name,subtree],union(...choices(['included','excluded']).map(form=>chain(form,done)))),chain([word('engineid'),word('local'),argument('HEX','5–32 hexadecimal bytes',value=>/^(?:[0-9a-f]{2}){5,32}$/i.test(value))],done),chain([word('host'),ip('Notification host')],union(notificationVersion,chain([word('traps')],notificationVersion),chain([word('informs')],notificationVersion))),chain([word('enable'),word('traps')],categories),...['trap-source','source-interface'].map(value=>chain([word(value),iface(context)],done)),chain([word('ifindex'),word('persist')],done),chain([word('packetsize'),number(484,17940,'Packet size')],done),chain([word('queue-length'),number(1,1000,'Queue length (default 10)')],done));
  }
  if (path === 'redistribute') {
    const options = optionGraph([[word('metric'), number(0, 4294967295, 'Redistributed metric')], [word('metric-type'), number(1, 2, 'OSPF external type')], [word('route-map'), text('Route map name')], [word('tag'), number(0, 4294967295, 'Route tag')], [word('subnets')]]);
    const process = union(options, chain([number(1, 4294967295, 'Source process or autonomous system')], options));
    return union(...['connected', 'static', 'ospf', 'eigrp', 'rip', 'bgp', 'ospfv3', 'ripng'].map(value => chain([word(value, 'Source protocol')], process)));
  }
  if (path === 'area' && context.protocol === 'ospf') {
    return chain([area], union(
      chain([word('authentication')], union(done, chain([word('message-digest')],done))),
      chain([word('stub')], optionGraph([[word('no-summary')]])),
      chain([word('nssa')], optionGraph(choices(['no-summary', 'default-information-originate', 'no-redistribution']))),
      chain([word('range'), ip('IP address to match'), ip('IP mask for address')], optionGraph([[word('not-advertise')], [word('cost'), number(0, 16777215, 'Advertised metric for this range')]])),
      chain([word('virtual-link'), ip('ID (IP addr) associated with virtual link neighbor')], optionGraph([[word('hello-interval'), number(1, 65535, 'Seconds')], [word('dead-interval'), number(1, 65535, 'Seconds')], [word('authentication')], [word('authentication'),word('message-digest')], [word('authentication'),word('null')], [word('authentication'),word('key-chain'),text('Name of key-chain')], [word('authentication-key'), text('The OSPF password (key)')], [word('message-digest-key'),number(1,255,'Key ID'),word('md5'),text('The OSPF password (key)')]])),
    ));
  }
  if (path === 'ip route') {
    const options = optionGraph([[word('name'), text('Name of the next hop')], [word('tag'), number(1, 4294967295, 'Tag value')], [word('permanent')], [word('track'), number(1, 1000, 'Tracked object')]]);
    const distance = union(options, chain([number(1, 255, 'Distance metric for this route')], options));
    const destination = (vrf: boolean) => {
      const next = vrf ? union(distance, chain([word('global', 'Next hop address is global')], distance)) : distance;
      const via = union(chain([ip("Forwarding router's address")], next), chain([iface(context)], union(next, chain([ip("Forwarding router's address")], next))), chain([argument('Null0', 'Null interface', value => /^nu(?:ll)?0+$/i.test(value), ['Null0'])], next));
      return chain([ip('Destination prefix'), ip('Destination prefix mask')], no ? union(done, via) : via);
    };
    return union(destination(false), chain([word('vrf'), text('VPN Routing/Forwarding instance name')], destination(true)));
  }
  if (path === 'ip prefix-list' || path === 'ipv6 prefix-list') {
    const length = path.startsWith('ipv6') ? 128 : 32, address = argument(path.startsWith('ipv6') ? 'X:X:X:X::X/<0-128>' : 'A.B.C.D/<0-32>', path.startsWith('ipv6') ? 'IPv6 prefix x:x::y/<z>' : 'IP prefix <network>/<length>, e.g., 35.0.0.0/8', value => value.includes('/'));
    const options = optionGraph([[word('ge'), number(0, length, 'Minimum prefix length')], [word('le'), number(0, length, 'Maximum prefix length')]]);
    const rule = union(...['permit', 'deny'].map(value => chain([word(value), address], options)));
    const sequence = union(rule, chain([word('seq'), number(1, 2147483647, 'Sequence number')], no ? union(done, rule) : rule));
    return chain([text('Name of a prefix list')], no ? union(done, sequence) : sequence);
  }
  if (/^aaa (?:authentication login|authorization (?:exec|commands))$/.test(path)) {
    const authorization = path.includes('authorization');
    const methods = graph(true);
    const atoms = [...['local', 'none', ...(authorization ? ['if-authenticated'] : [])].map(value => [word(value)]), [word('group'), argument('WORD', 'Server-group name', undefined, ['radius', 'tacacs+'])]];
    for (const method of atoms) methods.edges.push(...chain(method, methods).edges);
    const first = { edges: methods.edges, complete: no };
    return chain([...(path.endsWith('commands') ? [number(0, 15, 'Privilege level')] : []), text('Method list name or default')], first);
  }
  if (path === 'ip nat') {
    const inside = chain([word('inside'), word('source')], union(chain([word('static'), ip('Inside local IP address'), ip('Inside global IP address')], done), chain([word('list'), text('Access list name for local addresses')], union(chain([word('interface'), iface(context)], union(done, chain([word('overload')], done))), chain([word('pool'), text('Name pool of global addresses')], union(done, chain([word('overload')], done)))))));
    const pool = chain([word('pool'), text('Pool name')], no ? done : chain([ip('Start IP address'), ip('End IP address'), word('netmask'), ip('Network mask')], done));
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
  if(path==='ip ftp username')return [[text('Default remote FTP username')]];
  if(path==='ip ftp password')return [[text('FTP password')],...combine(choices(['0','7']),[[text('FTP password')]])];
  if(path==='ip ftp source-interface')return [[iface(context)]];
  if(path==='ip ftp passive')return [[]];
  if(path==='ospfv3'&&['interface','range'].includes(context.mode??''))return combine([[number(1,65535,'OSPFv3 process ID')]],[[word('ipv4'),word('area'),text('Area ID')],[word('ipv6'),word('area'),text('Area ID')],...choices(['broadcast','non-broadcast','point-to-point','point-to-multipoint']).map(form=>[word('network'),...form]),[word('network'),word('point-to-multipoint'),word('non-broadcast')]]);
  if(path==='ipv6 ospf network'||path==='ospfv3 network')return [...choices(['broadcast','non-broadcast','point-to-point','point-to-multipoint']),[word('point-to-multipoint'),word('non-broadcast')]];
  if(path==='ipv6 ospf neighbor')return combine([[argument('X:X:X:X::X','Link-local neighbor IPv6 address',value=>isIPv6(value)&&/^fe[89ab]/i.test(value))]],combine(optional(word('poll-interval'),number(1,65535,'Down neighbor poll interval')),optional(word('cost'),number(1,65535,'Point-to-multipoint neighbor cost'))));
  if(path==='ipv6 ospf hello-interval'||path==='ipv6 ospf dead-interval'||path==='ipv6 ospf cost')return [[number(1,65535,'OSPF interface value')]];
  if(path==='ipv6 ospf priority')return [[number(0,255,'DR election interface priority')]];
  if(path==='network-policy'||path==='network-policy profile')return[[number(1,4294967295,'LLDP-MED network-policy profile')]];
  if(path==='show network-policy profile')return[[],[word('detail')],[number(1,4294967295,'Network-policy profile')],[number(1,4294967295,'Network-policy profile'),word('detail')]];
  if(path==='voice vlan'&&context.mode==='network-policy')return [...combine([[number(1,4094,'Voice VLAN')],[word('dot1p')]], [[],[word('cos'),number(0,7,'Layer2 CoS priority')],[word('dscp'),number(0,63,'IP differentiated services code point')]]),...choices(['none','untagged'])];
  if(['policy-class','policy-police'].includes(context.mode??'')){
    const names=['default','ef',...Array.from({length:7},(_,i)=>'cs'+(i+1)),...Array.from({length:4},(_,c)=>Array.from({length:3},(_,d)=>`af${c+1}${d+1}`)).flat()],dscp:Form[]=[[number(0,63,'Differentiated Services Code Point')],...choices(names)];
    if(path==='set dscp')return dscp;
    if(path==='fair-queue')return [[]];
    if(path==='random-detect')return [[],...choices(['dscp-based','precedence-based','ecn']),[word('exponential-weighting-constant'),number(1,16,'Exponential weighting constant')],...combine(combine([[word('dscp')]],dscp),combine([[number(1,4095,'Minimum threshold in packets'),number(1,4095,'Maximum threshold in packets')]],optional(number(1,65536,'Mark probability denominator')))),[word('precedence'),number(0,7,'IP precedence'),number(1,4095,'Minimum threshold in packets'),number(1,4095,'Maximum threshold in packets'),number(1,65536,'Mark probability denominator')]];
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
  if(path==='security wpa psk set-key')return combine(choices(['ascii','hex']),[[word('0','Specifies an UNENCRYPTED password will follow'),text('WPA2 preshared key')]]);
  if(path==='capwap ap primary-base')return[[text('Controller hostname'),ip('Controller IPv4 address')]];
  if(path==='show wireless client mac-address')return[[text('Client MAC address'),word('detail')]];
  if(path==='show ap name')return[[text('AP name'),word('config'),word('general')]];
  if(path==='ap capwap timers heartbeat-timeout')return[[number(1,30,'Heartbeat interval in seconds')]];
  if(path==='native-vlan-id')return[[number(1,4094,'Native VLAN ID')]];
  if(path==='session-timeout')return[[number(1,86400,'Session timeout in seconds')]];
  if (path === '__output') return [...combine(choices(['include','exclude','begin','section','count']), [[tail('Regular Expression')]]), ...combine(choices(['redirect','append','tee']), [[argument('flash:filename','Uniform Resource Locator',value=>/^flash:\S+$/i.test(value))]])];
  if (path === 'ip address' && ['interface', 'range'].includes(context.mode || '')) return [[ip(), ip('IP subnet mask')], [ip(), ip('IP subnet mask'), word('secondary', 'Make this IP address a secondary address')], [word('dhcp', 'IP Address negotiated via DHCP')]];
  if (path === 'ip address') return [[ip()]];
  if (path === 'ipv6 address') return [[prefix()], [prefix(), word('eui-64', 'Use the interface identifier')], [argument('X:X:X:X::X', 'IPv6 address'), word('link-local', 'Link-local address')], ...choices(['autoconfig', 'dhcp'])];
  if (path === 'interface') return [[iface(context,true)]];
  if (path === 'interface range') return [[{...iface(context),valid:undefined,repeat:true,interface:{context,range:true}}]];
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
  if(['policy-class','policy-police'].includes(context.mode??'')){if(path==='bandwidth')return [[number(1,2000000,'Bandwidth in kilobits per second')],[word('percent'),number(1,100,'Percentage of configured bandwidth')],[word('remaining'),word('percent'),number(1,100,'Percentage of remaining bandwidth')]];if(path==='priority')return [[number(1,2000000,'Priority bandwidth in kilobits per second')],[word('percent'),number(1,100,'Priority bandwidth percentage')]];if(path==='shape')return [[word('average'),number(1000,1000000000,'Average shaped bits per second')]];if(path==='queue-limit')return combine([[number(1,4096,'Packets')]],optional(word('packets')));}
  if (path === 'bandwidth' || path === 'delay') return [[number(1, 10000000, path === 'bandwidth' ? 'Bandwidth in kilobits per second' : 'Delay in tens of microseconds')]];
  if (['ip default-gateway', 'ip helper-address', 'router-id', 'bgp router-id', 'tunnel destination', 'default-router'].includes(path)) return [[ip()]];
  if (path === 'ip name-server' || path === 'dns-server') return [[{ ...ip('Domain server IP address (maximum of 6)'), repeat: true }]];
  if (path === 'router') return [[word('ospf'), number(1, 65535, 'OSPF process ID')], [word('eigrp'), number(1, 65535, 'Autonomous system number')], [word('eigrp'), text('Named EIGRP instance')], [word('bgp'), number(1, 4294967295, 'Autonomous system number')], [word('rip')]];
  if(path==='summary-metric'){const keys=summaryMetricKeys(context),distance=[word('distance'),number(1,255,'Administrative distance for local summary')],metric=[number(1,4294967295,'Bandwidth in kilobits per second'),number(1,4294967295,'Delay in tens of microseconds'),number(0,255,'Reliability'),number(1,255,'Load'),number(1,65535,'Path MTU')];return combine(keys,[metric,[...metric,...distance],distance]);}
  if (path === 'network') {
    if (context.mode === 'pool') return [[ip('Network number in dotted-decimal notation'), ip('Network mask')]];
    if (context.protocol === 'ospf') return [[ip('Network number'), ip('OSPF wild card bits'), word('area'), argument('AREA', 'Area ID, integer or dotted decimal', value => ipv4(value) || /^\d+$/.test(value))]];
    if (context.protocol === 'bgp') return context.addressFamily==='ipv6'?[[prefix()]]:[[ip('Network number')], [ip('Network number'), word('mask'), ip('Network mask')]];
    if (context.protocol === 'eigrp') return [[ip('Network number')], [ip('Network number'), ip('EIGRP wild card bits')]];
    if (context.protocol === 'rip') return [[ip('Network address')]];
  }
  if (path === 'passive-interface') return context.mode === 'af-interface' ? [[]] : [[word('default', 'All interfaces')], [iface(context)]];
  if (path === 'neighbor' && context.protocol === 'bgp') {
    const peer = argument('A.B.C.D or X:X:X:X::X','BGP neighbor address',value=>ipv4(value)||isIPv6(value));
    return [
      [peer, word('remote-as'), number(1, 4294967295, 'AS of remote neighbor')],
      ...combine([[peer]], choices(['shutdown', 'next-hop-self', 'activate', 'route-reflector-client'])),
      [peer, word('description'), tail('Up to 80 characters describing this neighbor')],
      [peer, word('update-source'), iface(context)],
      [peer, word('ebgp-multihop'), number(1, 255, 'maximum hop count')],
      ...[...combine([[peer, word('route-map'), text('Name of route map')]], [[word('in', 'Apply map to incoming routes')], [word('out', 'Apply map to outbound routes')]]), ...combine([[peer, word('prefix-list'), text('Name of a prefix list')]], [[word('in', 'Filter incoming updates')], [word('out', 'Filter outgoing updates')]])],
      [peer, word('maximum-prefix'), number(1, 4294967295, 'maximum no. of prefix limit')],
      [peer, word('timers'), number(0, 65535, 'Keepalive interval'), number(0, 65535, 'Holdtime')],
      ...combine([[peer, word('send-community')]], [[], ...choices(['standard', 'extended', 'both'])]),
      [peer, word('fall-over'), word('bfd')], [peer, word('ttl-security'), word('hops'), number(1, 254, 'maximum number of hops')],
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
    const destinations: Form[] = [[ip('Destination prefix'), ip('Destination prefix mask')], [word('vrf'), text('VPN Routing/Forwarding instance name'), ip('Destination prefix'), ip('Destination prefix mask')]];
    const via: Form[] = [[ip("Forwarding router's address")], [iface(context)], [iface(context), ip("Forwarding router's address")], [word('Null0', 'Null interface')]];
    return combine(combine(destinations, via), [[], [number(1, 255, 'Administrative distance')], [word('permanent')], [word('track'), number(1, 1000, 'Tracked object')], [number(1, 255, 'Administrative distance'), word('permanent')]]);
  }
  if (path === 'ipv6 route') return combine([[prefix(), argument('X:X:X:X::X', 'Next-hop address')], [prefix(), iface(context)], [prefix(), iface(context), argument('X:X:X:X::X', 'Next-hop address')]], optional(number(1, 255, 'Administrative distance')));
  if (path === 'show interfaces') return [[], [iface(context)], ...choices(['status', 'description', 'trunk', 'switchport']),[word('counters')],[word('counters'),word('errors')],[iface(context),word('counters'),word('errors')]];
  if (path === 'show ip route') return [[], [ip('Destination address')], ...choices(['connected', 'static', 'ospf', 'eigrp', 'bgp', 'rip']), [word('vrf'), text('VRF name')], [word('vrf'), text('VRF name'), ip('Destination address')]];
  if (path === 'show running-config' || path === 'show startup-config') return [[], ...combine([[word('|', 'Output modifiers')]], combine(choices(['include', 'exclude', 'begin']), [[tail('Regular Expression')]]))];
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
    return [[number(1, 65535, 'OSPF process ID'), word('area'), argument('AREA', 'Area ID')], ...combine(choices(['cost', 'hello-interval', 'dead-interval']), [[number(1, 65535, 'Value')]]), [word('priority'), number(0, 255, 'Router priority')], ...combine([[word('network')]], choices(['broadcast', 'point-to-point', 'non-broadcast', 'point-to-multipoint'])), [word('bfd')], [word('mtu-ignore')], [word('authentication')], [word('authentication'), word('message-digest')], [word('authentication'), word('null')], [word('authentication'), word('key-chain'), text('Key chain name')]];
  }
  if (path === 'crypto key generate rsa') return [[], [word('modulus'), number(512, 4096, 'RSA modulus bits')], [word('general-keys'), word('modulus'), number(512, 4096, 'RSA modulus bits')]];
  if (path === 'crypto ipsec transform-set') return combine([[text('Transform set name'), word('esp-3des')], [text('Transform set name'), word('esp-aes')], ...combine([[text('Transform set name'), word('esp-aes')]], choices(['128', '192', '256']))], choices(['esp-sha-hmac', 'esp-md5-hmac']));
  if (path === 'encryption' && context.mode === 'ike') return [[word('3des')], [word('aes')], ...combine([[word('aes')]], choices(['128', '192', '256']))];
  if (path === 'set pfs') return Array.from({ length: 24 }, (_, index) => [word(`group${index + 1}`, 'Diffie-Hellman group')]);
  if (path === 'username') { const secret = text('The UNENCRYPTED (cleartext) user secret'), password = text('The UNENCRYPTED (cleartext) user password'); return combine(combine([[text('User name')]], [[], [word('privilege'), number(0, 15, 'User privilege level')]]), [[word('secret'), secret], [word('secret'), word('0', 'Specifies an UNENCRYPTED secret will follow'), secret], [word('password'), password], [word('password'), word('0', 'Specifies an UNENCRYPTED password will follow'), password], [word('password'), word('7', 'Specifies a HIDDEN password will follow'), text('The HIDDEN user password string')]]); }
  if (path === 'login') return [[], [word('local', 'Use local user authentication')]];
  if (path === 'address ipv4' && context.mode === 'aaa-server') {const auth=[word('auth-port'),number(1,65535,'Authentication UDP port')],acct=[word('acct-port'),number(1,65535,'Accounting UDP port')];return combine([[ip()]],context.protocol==='tacacs'?[[],[word('port'),number(1,65535,'TACACS TCP port')]]:[[],auth,acct,[...auth,...acct],[...acct,...auth]]);}
  if(path==='key'&&context.mode==='aaa-server')return [[text('Shared secret')],...combine(choices(['0','7']),[[text('Shared secret')]])];
  if(path==='timeout'&&context.mode==='aaa-server')return [[number(1,1000,'Timeout seconds')]];
  if(path==='retransmit'&&context.mode==='aaa-server')return [[number(0,100,'Retransmission attempts')]];
  if (path === 'ip http authentication') return [[word('local')], [word('enable')], [word('aaa')], [word('aaa'), word('login-authentication'), text('AAA login list')]];
  if (path === 'ip arp inspection validate') return [[{ ...argument('src-mac|dst-mac|ip', 'ARP fields to validate', value => ['src-mac', 'dst-mac', 'ip'].includes(value), ['src-mac', 'dst-mac', 'ip']), repeat: true }]];
  if(path==='tracking'&&(['device-tracking','ipv6-snooping'].includes(context.mode||'')||context.mode==='ipv6-guard'&&context.protocol==='ndInspection'))return ['enable','disable'].flatMap(value=>[[word(value)],...[number(1,86400,'Binding lifetime in seconds'),word('infinite','Keep the binding indefinitely')].map(lifetime=>[word(value),word(value==='enable'?'reachable-lifetime':'stale-lifetime'),lifetime])]);
  if(path==='ipv6 neighbor binding')return [[],[word('logging')],[word('max-entries'),number(1,1000000,'Maximum binding entries')],...['reachable-lifetime','stale-lifetime','down-lifetime'].flatMap(value=>[[word(value),number(1,86400,'Binding lifetime in seconds')],[word(value),word('infinite')]]),[word('vlan'),number(1,4094,'VLAN ID'),argument('X:X:X:X::X','IPv6 address',value=>value.includes(':')),word('interface'),iface(context),argument('H.H.H','48-bit hardware address')]];
  if(path==='spanning-tree mst'&&context.mode==='config')return [[word('configuration')],[argument('<0-4094>','MST instance or instance list',value=>/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value)),word('priority'),number(0,61440,'Bridge priority in increments of 4096')]];
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
  if(path==='interface'||path==='interface range') {
    const syntax:InterfaceSyntax={context,create:path==='interface'&&!no},first=tokens[0]?.text;
    if(first) {
      const fragment=interfaceFragment(first,syntax);
      if(fragment.number===undefined&&fragment.families.length===1&&(path==='interface'||tokens.length<=2)) {
        const position=advanceForms([[iface(context,syntax.create,fragment.families[0])]],tokens.slice(1));
        if(path==='interface range'&&position.complete)position.atoms=[word('-','Last interface in range'),word(',','Add another interface range')];
        return position;
      }
    }
    if(path==='interface range'&&tokens.length) {
      const joined=tokens.map(token=>token.text).join(''),last=joined.slice(joined.lastIndexOf(',')+1),dash=/^(.*\d)-(\d*)$/.exec(last);
      if(dash&&interfaceValid(dash[1],syntax)) {
        const parts=interfaceParts(dash[1])!,family=interfaceFragment(dash[1],syntax).families[0],parent=parts[2].replace(/\d+$/,''),start=Number(parts[2].match(/\d+$/)![0]);
        const ends=(context.interfaces??[]).flatMap(name=>{const p=interfaceParts(name);return p?.[1]===family&&p[2].replace(/\d+$/,'')===parent?[Number(p[2].match(/\d+$/)![0])]:[];});
        if(!dash[2])return {atoms:[number(start,Math.max(start,...ends),'Last interface in range')],complete:false};
        if(ends.includes(+dash[2])&&+dash[2]>=start)return {atoms:[word(',','Add another interface range')],complete:true};
      }
      if(interfaceValid(last,syntax))return {atoms:[word('-','Last interface in range'),word(',','Add another interface range')],complete:true};
    }
  }
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

function summaryMetricKeys(context:IosSyntaxContext):Form[]{const six=context.protocol==='eigrp6',key=argument(six?'X:X:X:X::X/<0-128>':'A.B.C.D/<0-32>',six?'IPv6 summary prefix':'IPv4 summary prefix',value=>{try{return value.includes('/')&&parseCidr(value).family===(six?6:4);}catch{return false;}});return [[key],...(six?[]:[[ip('Summary network address'),ip('Contiguous subnet mask')]])];}

function negativeForms(path: string, forms: Form[], context: IosSyntaxContext): Form[] {
  if(path.startsWith('ip ftp '))return [[]];
  if(path==='network-policy'||path==='network-policy profile'&&['interface','range'].includes(context.mode??'')||path==='voice vlan'&&context.mode==='network-policy')return[[],...forms];
  if(path==='ipv6 ospf network'||path==='ospfv3 network'||['ipv6 ospf hello-interval','ipv6 ospf dead-interval','ipv6 ospf cost','ipv6 ospf priority'].includes(path))return[[],...forms];
  if(path==='summary-metric')return summaryMetricKeys(context);
  if(['policy-class','policy-police'].includes(context.mode??'')&&path==='random-detect')return[[],...forms.filter(f=>f[0]?.literal!=='exponential-weighting-constant'),[word('exponential-weighting-constant')],[word('precedence')]];
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
  let states = forms.map(form => ({ form, index: 0, filled: false }));
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].text.toLowerCase();
    const literals = [...new Set(states.map(state => state.form[state.index]?.literal).filter((value): value is string => !!value))];
    const exact = literals.find(value => value.toLowerCase() === token);
    const matches = exact ? [exact] : literals.filter(value => value.toLowerCase().startsWith(token));
    states = states.filter(state => {
      const atom = state.form[state.index];
      return atom && (atom.literal ? matches.length === 1 && matches[0] === atom.literal : !atom.valid || atom.valid(tokens[index].text));
    }).map(state => state.form[state.index].repeat ? { ...state, filled: true } : { ...state, index: state.index + 1, filled: false });
    if (!states.length) return { atoms: [], complete: false, bad: index };
  }
  // A repeating argument such as `| include LINE` needs at least one value before `<cr>` is offered.
  return { atoms: states.map(state => state.form[state.index]).filter(Boolean), complete: states.some(state => state.index === state.form.length || state.form[state.index]?.repeat && state.filled) };
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
  const pipe=line.indexOf('|'),width=context.width??80;
  if(pipe>=0&&/^\s*(?:do\s+)?(?:s(?:h(?:o(?:w)?)?)?|mo(?:r(?:e)?)?)\s/i.test(line))return iosContextHelp('__output '+line.slice(pipe+1).trimStart(),[{words:['__output'],description:'Output modifier',args:'<modifier>'}],{mode:'priv',width});
  if (context.mode === 'acl' && /^(?:(?:no|default)\s+)?\d+\s+\S*$/i.test(line.trimStart())) {
    const partialWord=/\s$/.test(line)?undefined:line.trim().split(/\s+/).at(-1)!.toLowerCase();
    const entries:[string,string][]=[['deny','Specify packets to reject'],['permit','Specify packets to forward'],['remark','Access list entry comment']];
    if(partialWord!==undefined){const words=entries.map(([label])=>label).filter(label=>label.startsWith(partialWord));return words.length?iosPartialHelp(words,width):[IOS_UNRECOGNIZED];}
    return iosHelpRows([...entries,...(/^\s*(?:no|default)\s/i.test(line)?[['<cr>','<cr>'] as [string,string]]:[])],width);
  }
  const partial = !!line && !/\s$/.test(line), state = lookup(line, commands, context, false);
  if (state.bad !== undefined) return undefined;
  const position = argumentPosition(state, partial);
  if (!position) return undefined;
  if (position.bad !== undefined) return undefined;
  const value = partial ? state.tokens.at(-1)!.text.toLowerCase() : '', rows = new Map<string, string>(), specPath = state.fallback?.spec.words.join(' ') ?? '';
  // IOS keyword help is keyed by the full keyword path, so `address-family ipv4 ?` looks up `address-family ipv4|unicast`.
  const typedWords=state.fallback?[...state.fallback.spec.words,...state.tokens.slice(state.fallback.index,state.tokens.length-(partial?1:0)).map(token=>token.text.toLowerCase())]:[];
  const typedPath=typedWords.join(' '),path=specPath,specLength=state.fallback?.spec.words.length??0;
  // Keywords are looked up from the longest typed prefix back to the command path, so
  // `snmp-server group G v3 ?` can use `snmp-server group|auth` before `snmp-server|auth`.
  const paths=typedWords.length>specLength?Array.from({length:typedWords.length-specLength+1},(_,i)=>typedWords.slice(0,typedWords.length-i).join(' ')):[specPath];
  // A generic placeholder means something different at each argument position (address, then mask), so
  // after the first argument it is keyed by position (`ip address#1|A.B.C.D`) rather than by the command path.
  const argIndex=typedWords.length-specLength,atomPaths=(label:string)=>argIndex>0&&/^(?:A\.B\.C\.D|X:X:X:X::X|WORD|LINE|H\.H\.H|<[^>]*>|\d+-\d+)$/.test(label)?[typedPath,`${specPath}#${argIndex}`]:paths;
  const mode=state.context.mode||'',keywordPath=state.fallback?.spec.words??[],keyword=(label:string,fallback:string,words=keywordPath)=>iosArgumentDescription(paths,label,iosDescription(mode,[...words,label],fallback,context.protocol),mode,context.protocol);
  // Simulator signatures such as <mode|vlan|mst> name keywords, not a free-form WORD.
  const alternatives:string[]=[];
  for (const atom of position.atoms) {
    if(atom.interface){for(const [label,description]of interfaceHelp(value,atom.interface))rows.set(label,description);}
    else if(!atom.literal&&atom.label==='WORD'&&/^[a-z][\w-]*(?:\|[a-z][\w-]*)+$/.test(atom.description))alternatives.push(...atom.description.split('|').filter(word=>word.startsWith(value)));
    else if (!atom.literal || atom.literal.toLowerCase().startsWith(value)) for(const [label,description]of iosArgumentRows(atomPaths(atom.label),atom.label,atom.description,mode,context.protocol))rows.set(label,description);
  }
  // A command may accept an argument and also have keyword branches (interface range,
  // show interfaces status). Both are valid at the same source position.
  const consumed=state.tokens.length-(partial?1:0),start=state.fallback?state.fallback.index-state.fallback.spec.words.length:0;
  if(state.fallback&&state.index===consumed)for(const spec of state.specs){const depth=consumed-start,child=spec.words[depth];if(child&&child.startsWith(value)&&!rows.has(child)&&!iosKeywordHidden(spec.words.slice(0,depth).join(' '),child,mode,context.protocol))rows.set(child,keyword(child,spec.description,spec.words.slice(0,depth)));}
  for(const word of alternatives)if(!rows.has(word))for(const [label,description]of iosArgumentRows(paths,word,keyword(word,state.fallback?.spec.description??'',typedWords),mode,context.protocol))rows.set(label,description);
  if (!partial && position.complete) {
    rows.set('<cr>', '<cr>');
    if(['user','priv'].includes(state.context.mode||'')&&/^(?:show|more)\b/.test(path))rows.set('|','Output modifiers');
  }
  if (!rows.size) return position.atoms.some(atom=>atom.interface)?[IOS_UNRECOGNIZED]:undefined;
  if (partial) {
    const keywords=[...rows.keys()].filter(label=>label!=='<cr>'&&label!=='|'&&/^[a-z0-9]/i.test(label)&&label.toLowerCase().startsWith(value)&&!/^(?:WORD|LINE|A\.B\.C\.D|X:X:X:X::X|H\.H\.H)$/.test(label)).sort((a,b)=>a<b?-1:a>b?1:0);
    if(keywords.length)return iosPartialHelp(keywords,width);
  }
  return iosHelpRows(rows, width);
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
  const interfaces=[...new Set(position.atoms.flatMap(atom=>atom.interface?interfaceCompletion(last.text,atom.interface)??[]:[]))];
  const values = [...new Set(position.atoms.flatMap(atom => (atom.literal ? [atom.literal] : atom.values || []).filter(value => value.toLowerCase().startsWith(prefix))))];
  if(interfaces.length===1&&!values.length)return line.slice(0,last.start)+interfaces[0];
  if(interfaces.length)return line;
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
