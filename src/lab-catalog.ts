import datacenterExample from '../examples/datacenter-vpc.netsim.json' with {type:'json'};
import {Simulator} from './engine.ts';
import {parseDocument} from './persistence.ts';
import {IOSSession} from './cli.ts';
import {iosRejected} from './ios-help.ts';
import {factoryDeviceConfig,emptyRuntime,type Device,type LabDocument} from './model.ts';
import {type Criterion,type GuidedLab,type Lesson} from './lessons.ts';

export const LAB_GROUPS=['CCNA','CCNP ENCOR','CCNP ENARSI','Other'] as const;
export type LabGroup=typeof LAB_GROUPS[number];
export const CCNA_SECTIONS=['Fundamentals','Switching','Routing','Services & Security'] as const;
export type CCNASection=typeof CCNA_SECTIONS[number];
export type CatalogLab=GuidedLab & {catalogId?:string};
export type CatalogMode='practice'|'completed';
type CatalogEntry={id:string;title:string;description:string;devices:number;links:number;practice:boolean}&({group:'CCNA';section:CCNASection}|{group:Exclude<LabGroup,'CCNA'>;section?:never});
export const LAB_CATALOG=[
 {id:'ipv4-interface-configuration',group:'CCNA',section:'Fundamentals',title:'IPv4 interface configuration',description:'Address two directly connected router interfaces, enable the link, and verify IPv4 connectivity in both directions.',devices:2,links:1,practice:true},
 {id:'ipv4-addressing-troubleshooting',group:'CCNA',section:'Fundamentals',title:'IPv4 addressing troubleshooting',description:'Find and repair IPv4 address, subnet mask and default gateway faults across two LANs, then restore end-to-end connectivity.',devices:3,links:2,practice:true},
 {id:'dhcp-server-and-relay',group:'CCNA',section:'Fundamentals',title:'DHCP server and relay',description:'Configure a remote DHCP server and an IOS relay, deliver IPv4 settings to two clients, and verify routed connectivity.',devices:5,links:4,practice:true},
 {id:'layer-2-switching-interfaces',group:'CCNA',section:'Switching',title:'Layer 2 switching interfaces',description:'Configure access interfaces, VLAN membership and link settings, shut an unused port, and verify dynamic MAC learning and host connectivity.',devices:3,links:2,practice:true},
 {id:'layer-3-routed-interfaces',group:'CCNA',section:'Switching',title:'Layer 3 routed interfaces',description:'Convert multilayer switch ports to routed interfaces, address two subnets, enable IPv4 routing, and verify end-to-end forwarding.',devices:3,links:2,practice:true},
 {id:'vlan-and-access-ports',group:'CCNA',section:'Switching',title:'VLAN and access ports',description:'Create two VLANs, assign four access ports, and verify same-VLAN connectivity, VLAN isolation and dynamic MAC learning.',devices:5,links:4,practice:true},
 {id:'voice-vlan',group:'CCNA',section:'Switching',title:'Voice VLAN',description:'Provision PoE phones and PC passthrough on shared access ports. Separate voice and data VLANs, learn phone policy, obtain voice DHCP leases, and verify real traffic.',devices:7,links:6,practice:true},
 {id:'poe-interface',group:'CCNA',section:'Switching',title:'PoE Interface',description:'Restore power to an AP and phone, configure per-port limits and priorities within a constrained power budget, and verify real delivery and phone PC passthrough.',devices:5,links:4,practice:true},
 {id:'802-1q-trunking',group:'CCNA',section:'Switching',title:'802.1Q Trunking',description:'Build a static trunk between two switches, match native and allowed VLANs, and verify tagged and untagged traffic with VLAN-scoped MAC learning.',devices:8,links:7,practice:true},
 {id:'router-on-a-stick',group:'CCNA',section:'Routing',title:'Router on a stick',description:'Route between two VLANs over one 802.1Q trunk. Configure access ports, router subinterfaces and default gateways.',devices:4,links:3,practice:true},
 {id:'datacenter-vpc',group:'Other',title:'Datacenter Switch vPC',description:'Explore the existing NX-OS-style vPC pair and its downstream port-channel.',devices:datacenterExample.lab.devices.length,links:datacenterExample.lab.links.length,practice:false},
] as const satisfies readonly CatalogEntry[];
export const ROAS_ADDRESS_PLAN=[
 ['R1','GigabitEthernet0/0.10','10','192.168.10.1 /24','—'],
 ['R1','GigabitEthernet0/0.20','20','192.168.20.1 /24','—'],
 ['PC1','GigabitEthernet0','10','192.168.10.10 /24','192.168.10.1'],
 ['PC2','GigabitEthernet0','20','192.168.20.10 /24','192.168.20.1'],
] as const;
export const ROAS_COMMANDS:Readonly<Record<string,readonly string[]>>={
 R1:['enable','configure terminal','interface GigabitEthernet0/0','description TRUNK_TO_SW1','no shutdown','interface GigabitEthernet0/0.10','encapsulation dot1Q 10','ip address 192.168.10.1 255.255.255.0','interface GigabitEthernet0/0.20','encapsulation dot1Q 20','ip address 192.168.20.1 255.255.255.0','end','write memory'],
 SW1:['enable','configure terminal','vlan 10','name SALES','vlan 20','name ENGINEERING','interface GigabitEthernet0/1','description TRUNK_TO_R1','switchport mode trunk','switchport trunk allowed vlan 10,20','spanning-tree portfast trunk','no shutdown','interface GigabitEthernet0/2','switchport mode access','switchport access vlan 10','spanning-tree portfast','no shutdown','interface GigabitEthernet0/3','switchport mode access','switchport access vlan 20','spanning-tree portfast','no shutdown','end','write memory'],
};
export const IPV4_INTERFACE_COMMANDS:Readonly<Record<string,readonly string[]>>={
 R1:['enable','configure terminal','interface GigabitEthernet0/0','description TO_R2','ip address 192.0.2.1 255.255.255.0','no shutdown','end','write memory'],
 R2:['enable','configure terminal','interface GigabitEthernet0/0','description TO_R1','ip address 192.0.2.2 255.255.255.0','no shutdown','end','write memory'],
};
export const IPV4_TROUBLESHOOTING_COMMANDS:Readonly<Record<string,readonly string[]>>={
 R1:['enable','configure terminal','interface GigabitEthernet0/0','ip address 192.168.10.1 255.255.255.0','no ip proxy-arp','no shutdown','interface GigabitEthernet0/1','ip address 192.168.20.1 255.255.255.0','no ip proxy-arp','no shutdown','end','write memory'],
 PC1:['netsh interface ipv4 set address name="Ethernet" source=static address=192.168.10.10 mask=255.255.255.0 gateway=192.168.10.1'],
 PC2:['netsh interface ipv4 set address name="Ethernet" source=static address=192.168.20.10 mask=255.255.255.0 gateway=192.168.20.1'],
};
export const DHCP_RELAY_COMMANDS:Readonly<Record<string,readonly string[]>>={R1:['enable','configure terminal','interface GigabitEthernet0/0','ip helper-address 192.168.100.10','end','write memory']};
export const DHCP_SERVER_SETTINGS={enabled:true,pools:[{name:'CLIENTS',network:'192.168.10.0',prefix:24,defaultRouter:'192.168.10.1',dnsServers:['192.168.100.10'],domain:'lab.example',leaseSeconds:3600}],excluded:[{start:'192.168.10.1',end:'192.168.10.20'}]};
export const L2_INTERFACE_COMMANDS:Readonly<Record<string,readonly string[]>>={SW1:[
 'enable','configure terminal','vlan 10','name USERS',
 'interface GigabitEthernet0/1','description TO_PC1','switchport','switchport mode access','switchport access vlan 10','speed auto','duplex auto','spanning-tree portfast','no shutdown',
 'interface GigabitEthernet0/2','description TO_PC2','switchport','switchport mode access','switchport access vlan 10','speed auto','duplex auto','spanning-tree portfast','no shutdown',
 'interface GigabitEthernet0/3','description UNUSED','shutdown','end','write memory',
]};
export const L3_INTERFACE_COMMANDS:Readonly<Record<string,readonly string[]>>={DSW1:[
 'enable','configure terminal',
 'interface GigabitEthernet0/1','description TO_PC1','no switchport','ip address 192.168.10.1 255.255.255.0','no shutdown',
 'interface GigabitEthernet0/2','description TO_PC2','no switchport','ip address 192.168.20.1 255.255.255.0','no shutdown',
 'exit','ip routing','end','write memory',
]};
export const VLAN_ACCESS_COMMANDS:Readonly<Record<string,readonly string[]>>={SW1:[
 'enable','configure terminal','vlan 10','name USERS','vlan 20','name GUESTS',
 'interface range GigabitEthernet0/1 - 2','description VLAN10_USERS','switchport mode access','switchport access vlan 10','spanning-tree portfast','no shutdown',
 'interface range GigabitEthernet0/3 - 4','description VLAN20_GUESTS','switchport mode access','switchport access vlan 20','spanning-tree portfast','no shutdown',
 'end','write memory',
]};
export const VOICE_VLAN_COMMANDS:Readonly<Record<string,readonly string[]>>={PSW1:[
 'enable','configure terminal','vlan 10','name DATA','vlan 20','name VOICE','exit','cdp run',
 'interface range GigabitEthernet0/1 - 2','switchport mode access','switchport access vlan 10','switchport voice vlan 20','spanning-tree portfast','cdp enable','power inline auto','no shutdown','end','write memory',
]};
export const POE_INTERFACE_COMMANDS:Readonly<Record<string,readonly string[]>>={PSW1:[
 'enable','configure terminal','interface range GigabitEthernet0/1 - 2','no shutdown',
 'interface GigabitEthernet0/2','power inline auto max 15400','power inline port priority high',
 'interface GigabitEthernet0/1','power inline auto max 15400','power inline port priority low',
 'interface GigabitEthernet0/4','power inline never','no shutdown','end','write memory',
]};
export const DOT1Q_TRUNK_COMMANDS:Readonly<Record<string,readonly string[]>>=Object.fromEntries(['SW1','SW2'].map(name=>[name,[
 'enable','configure terminal','vlan 99','name NATIVE','exit','interface GigabitEthernet0/24',
 `description TRUNK_TO_${name==='SW1'?'SW2':'SW1'}`,'switchport mode trunk','switchport nonegotiate',
 'switchport trunk native vlan 99','switchport trunk allowed vlan 10,20,99','no shutdown','end','write memory',
]]));
export interface CatalogGuideResources {
 columns:readonly string[];
 rows:readonly (readonly string[])[];
 commands:Readonly<Record<string,readonly string[]>>;
 verification:Readonly<Record<string,readonly string[]>>;
 note:string;
 setup?:readonly {title:string;instructions:readonly string[]}[];
}
const GUIDE_RESOURCES:Readonly<Record<string,CatalogGuideResources>>={
 '802-1q-trunking':{columns:['Device','Access port','VLAN','IPv4 address','Subnet mask'],rows:[['PC1 / PC2','SW1 / SW2 Gi0/1','10 · USERS','192.168.10.11 / 192.168.10.12','255.255.255.0'],['PC3 / PC4','SW1 / SW2 Gi0/2','20 · GUESTS','192.168.20.11 / 192.168.20.12','255.255.255.0'],['PC5 / PC6','SW1 / SW2 Gi0/3','99 · NATIVE','192.168.99.11 / 192.168.99.12','255.255.255.0']],commands:DOT1Q_TRUNK_COMMANDS,verification:{SW1:['show vlan brief','show interfaces trunk','show interfaces GigabitEthernet0/24 switchport','show spanning-tree vlan 10','show spanning-tree vlan 20','show spanning-tree vlan 99','show mac address-table dynamic'],SW2:['show interfaces trunk','show interfaces GigabitEthernet0/24 switchport','show mac address-table dynamic'],PC1:['ipconfig','ping -n 3 192.168.10.12','ping -n 3 192.168.20.12'],PC3:['ping -n 3 192.168.20.12'],PC5:['ping -n 3 192.168.99.12']},note:'Only the inter-switch Gi0/24 link and VLAN 99 need configuration. VLANs 10 and 20, the six access ports and PC IPv4 settings are preconfigured. Both trunks must use native VLAN 99 and allow exactly 10,20,99. Set static trunk mode before switchport nonegotiate. VLAN 10 and 20 frames cross the trunk tagged; native VLAN 99 frames cross untagged. VLAN 99 endpoints are included here to demonstrate native-VLAN forwarding. Keep normal spanning tree on the inter-switch link; do not configure PortFast there. Each PC pair shares one subnet and needs no default gateway. Cross-VLAN pings receive zero replies because no router is present. Generate traffic in all three VLANs before inspecting remote MAC addresses on Gi0/24. To explore pruning, remove VLAN 20 from one trunk and verify that only the VLAN 20 pair fails, then add it back. To explore a native-VLAN fault, change one end to native VLAN 1, inspect the trunk and spanning-tree output, then restore 99 on both ends. Save both switches with write memory.'},
 'poe-interface':{columns:['Device','Interface','IPv4 address','Subnet mask'],rows:[['AP1','GigabitEthernet0','192.168.10.21','255.255.255.0'],['PHONE1','Network','192.168.10.20','255.255.255.0'],['PC1','GigabitEthernet0','192.168.10.11','255.255.255.0'],['SRV1','GigabitEthernet0','192.168.10.10','255.255.255.0']],commands:POE_INTERFACE_COMMANDS,verification:{PSW1:['show power inline','show power inline GigabitEthernet0/1 detail','show power inline GigabitEthernet0/2 detail','show power inline priority','show interfaces status','show running-config interface GigabitEthernet0/1','show running-config interface GigabitEthernet0/2'],PC1:['ipconfig','ping -n 3 192.168.10.10']},note:'PSW1 has a preconfigured 40 W budget. Limits use milliwatts: 15400 mW = 15.4 W. The simulator’s full AP profile allocates 30 W; its reduced 802.3af profile allocates 15.4 W with 2×2 radios and USB off. The phone allocates 15.4 W. Both reduced allocations total 30.8 W, leaving 9.2 W. Keep the phone at high priority and the AP at low priority. To explore budget denial after completing the lab, temporarily raise Gi0/1 to 30000 mW: PHONE1 retains power, AP1 is denied. Restore 15400 mW afterward. Inspect the live budget and port reasons by opening PSW1. Gi0/4 remains enabled for data with inline power disabled. All IP addresses and VLAN 10 access ports are preconfigured; no default gateway is needed within this subnet. The AP exercise checks electrical power and its reduced profile; controller joining and wireless clients are outside this lab. The phone uses the untagged access VLAN, with no call registration. Save PSW1 with write memory.'},
 'voice-vlan':{columns:['Device','Interface','VLAN','IPv4 address','Default gateway'],rows:[
  ['R1','GigabitEthernet0/0.10','10 · DATA','192.168.10.1 /24','—'],['R1','GigabitEthernet0/0.20','20 · VOICE','192.168.20.1 /24','—'],['R1','GigabitEthernet0/0.100','100 · SERVICES','192.168.100.1 /24','—'],
  ['SRV1','GigabitEthernet0','100 · SERVICES','192.168.100.10 /24','192.168.100.1'],['PHONE1 / PHONE2','Network','20 · VOICE','DHCP · 192.168.20.21–254 /24','192.168.20.1'],['PC1','GigabitEthernet0','10 · DATA','192.168.10.11 /24','192.168.10.1'],['PC2','GigabitEthernet0','10 · DATA','192.168.10.12 /24','192.168.10.1'],
 ],commands:VOICE_VLAN_COMMANDS,verification:{PSW1:['show vlan brief','show interfaces GigabitEthernet0/1 switchport','show interfaces GigabitEthernet0/2 switchport','show power inline','show cdp neighbors detail','show mac address-table dynamic'],PC1:['ipconfig','ping -n 3 192.168.10.12','ping -n 3 192.168.10.1'],PC2:['ipconfig','ping -n 3 192.168.10.11'],R1:['show ip interface brief','show ip route']},note:'Configure PSW1 only. R1, the voice DHCP/DNS server, the router trunk and server port are already configured; preserve VLAN 100 and those uplinks. Open each phone for live PoE, received CDP/LLDP-MED policy and DHCP status. The phones tag voice-VLAN traffic; each attached PC remains untagged in data VLAN 10. In the MAC table, each phone and PC share one switch port but belong to different VLANs. This exercise validates network provisioning and ICMP reachability; it does not register phones or simulate telephone calls. R1 provides inter-VLAN routing, so VLAN separation is not an access-control rule.'},
 'vlan-and-access-ports':{columns:['Device','Switch port','VLAN','IPv4 address','Default gateway'],rows:[['PC1','SW1 Gi0/1','10 · USERS','192.168.10.11 /24','—'],['PC2','SW1 Gi0/2','10 · USERS','192.168.10.12 /24','—'],['PC3','SW1 Gi0/3','20 · GUESTS','192.168.20.11 /24','—'],['PC4','SW1 Gi0/4','20 · GUESTS','192.168.20.12 /24','—']],commands:VLAN_ACCESS_COMMANDS,verification:{SW1:['show vlan brief','show interfaces status','show interfaces GigabitEthernet0/1 switchport','show interfaces GigabitEthernet0/3 switchport','show mac address-table dynamic'],PC1:['ipconfig','ping -n 3 192.168.10.12','ping -n 3 192.168.20.11'],PC3:['ipconfig','ping -n 3 192.168.20.12','ping -n 3 192.168.10.11']},note:'PC1 → PC2 and PC3 → PC4 should each receive three replies. The cross-VLAN pings PC1 → PC3 and PC3 → PC1 should receive zero replies: this topology has no inter-VLAN routing or default gateways. Inspect VLAN 10 entries on Gi0/1–2 and VLAN 20 entries on Gi0/3–4. Each PC uses its GigabitEthernet0 interface. Access ports carry untagged endpoint traffic, with the switch assigning each frame to the configured access VLAN.'},
 'layer-3-routed-interfaces':{columns:['Device','Interface','IPv4 address','Subnet mask','Default gateway'],rows:[['DSW1','GigabitEthernet0/1','192.168.10.1','255.255.255.0','—'],['DSW1','GigabitEthernet0/2','192.168.20.1','255.255.255.0','—'],['PC1','GigabitEthernet0','192.168.10.10','255.255.255.0','192.168.10.1'],['PC2','GigabitEthernet0','192.168.20.10','255.255.255.0','192.168.20.1']],commands:L3_INTERFACE_COMMANDS,verification:{DSW1:['show interfaces GigabitEthernet0/1 switchport','show interfaces GigabitEthernet0/2 switchport','show ip interface brief','show ip route connected','show running-config | include ip routing','show ip arp'],PC1:['ipconfig','ping -n 3 192.168.10.1','ping -n 3 192.168.20.10'],PC2:['ipconfig','ping -n 3 192.168.20.1','ping -n 3 192.168.10.10']},note:'The PCs already have their static addresses and default gateways. Use no switchport before assigning an IP address to each physical switch port, then enable ip routing globally. Each up/up routed interface installs its directly connected subnet. No static routes or routing protocol are required for these two connected networks. Save DSW1 with write memory.'},
 'layer-2-switching-interfaces':{columns:['Device','Interface','VLAN','IPv4 address','Default gateway'],rows:[['PC1','GigabitEthernet0','10','192.168.10.10 /24','—'],['PC2','GigabitEthernet0','10','192.168.10.20 /24','—']],commands:L2_INTERFACE_COMMANDS,verification:{SW1:['show vlan brief','show interfaces status','show interfaces GigabitEthernet0/1 switchport','show interfaces GigabitEthernet0/2 switchport','show interfaces GigabitEthernet0/1','show mac address-table dynamic'],PC1:['ipconfig','ping -n 3 192.168.10.20'],PC2:['ipconfig','ping -n 3 192.168.10.10']},note:'Both PCs already have static /24 addresses and need no default gateway to communicate within their VLAN. Keep switch data ports at Layer 2; do not assign them IP addresses. PortFast is used on these endpoint-facing access ports. Generate traffic before inspecting dynamic MAC entries. To repeat the learning exercise, use clear mac address-table dynamic and send more pings.'},
 'dhcp-server-and-relay':{columns:['Device','Interface','IPv4 address','Subnet mask','Default gateway'],rows:[['R1','GigabitEthernet0/0','192.168.10.1','255.255.255.0','—'],['R1','GigabitEthernet0/1','192.168.100.1','255.255.255.0','—'],['SRV1','GigabitEthernet0','192.168.100.10','255.255.255.0','192.168.100.1'],['PC1','GigabitEthernet0','DHCP: 192.168.10.21–254','255.255.255.0','192.168.10.1'],['PC2','GigabitEthernet0','DHCP: 192.168.10.21–254','255.255.255.0','192.168.10.1']],commands:DHCP_RELAY_COMMANDS,verification:{R1:['show running-config interface GigabitEthernet0/0','show ip interface GigabitEthernet0/0','show ip route'],PC1:['ipconfig /renew','ipconfig /all','ping -n 3 192.168.100.10','nslookup server.lab.example'],PC2:['ipconfig /renew','ipconfig /all','ping -n 3 192.168.100.10']},note:'R1, SW1 and the server network are already addressed and enabled. The helper belongs on the client-facing interface. SRV1 serves DHCP; inspect its leases in Services → DHCP. R1 relays requests and does not maintain the server lease database. DNS on SRV1 is preconfigured for server.lab.example.',setup:[{title:'SRV1 · Services → DHCP',instructions:['Enable the DHCP server and add an address pool named CLIENTS.','Network address: 192.168.10.0. Prefix length: 24.','Default gateway: 192.168.10.1. DNS server: 192.168.100.10.','Lease duration: 3600 seconds. DNS domain: lab.example.','Excluded addresses: 192.168.10.1 - 192.168.10.20. Save changes.']}]},
 'router-on-a-stick':{columns:['Device','Interface','VLAN','IPv4 address','Default gateway'],rows:ROAS_ADDRESS_PLAN,commands:ROAS_COMMANDS,verification:{SW1:['show vlan brief','show interfaces trunk'],R1:['show ip interface brief','show ip route']},note:'The PCs are already addressed. PortFast trunk is used on the router-facing switch port.'},
 'ipv4-interface-configuration':{columns:['Device','Interface','IPv4 address','Subnet mask'],rows:[['R1','GigabitEthernet0/0','192.0.2.1','255.255.255.0'],['R2','GigabitEthernet0/0','192.0.2.2','255.255.255.0']],commands:IPV4_INTERFACE_COMMANDS,verification:{R1:['show ip interface brief','show interfaces GigabitEthernet0/0','show ip route','ping 192.0.2.2'],R2:['show ip interface brief','show interfaces GigabitEthernet0/0','show ip route','ping 192.0.2.1']},note:'Both interfaces share the 192.0.2.0/24 subnet. Directly connected routers do not need a static route or a routing protocol to reach one another.'},
 'ipv4-addressing-troubleshooting':{columns:['Device','Interface','IPv4 address','Subnet mask','Default gateway'],rows:[['R1','GigabitEthernet0/0','192.168.10.1','255.255.255.0','—'],['R1','GigabitEthernet0/1','192.168.20.1','255.255.255.0','—'],['PC1','GigabitEthernet0','192.168.10.10','255.255.255.0','192.168.10.1'],['PC2','GigabitEthernet0','192.168.20.10','255.255.255.0','192.168.20.1']],commands:IPV4_TROUBLESHOOTING_COMMANDS,verification:{R1:['show ip interface brief','show ip route'],PC1:['ipconfig /all','route print','ping -n 3 192.168.10.1','ping -n 3 192.168.20.10'],PC2:['ipconfig /all','route print','ping -n 3 192.168.20.1','ping -n 3 192.168.10.10']},note:'The practice lab starts with R1 Gi0/1 in the wrong subnet, PC1 using the wrong gateway, and PC2 using an overly broad mask. Correct the router through its IOS console. Correct each PC through its IP settings or the Windows Command prompt commands below. Proxy ARP is disabled on R1 so an incorrect PC mask cannot be hidden by proxy replies. No static routes or routing protocols are needed.'},
};
export function catalogGuideResources(id:string|undefined):CatalogGuideResources|undefined{return id&&Object.hasOwn(GUIDE_RESOURCES,id)?GUIDE_RESOURCES[id]:undefined;}
function completedDocument(doc:LabDocument,commands:Readonly<Record<string,readonly string[]>>):LabDocument{
 const sim=new Simulator(doc.seed);sim.load(doc);
 for(const[name,lines]of Object.entries(commands)){const d=sim.getDevice(name)!,cli=new IOSSession(sim,d.id);for(const command of lines){const output=cli.execute(command);if(output.some(iosRejected)||cli.windowsMode&&output.length>0)throw Error(`Could not prepare ${name}: ${command}\n${output.join('\n')}`);}}
 return sim.serialize();
}
const ipv4InterfaceCriterion=(device:string,address:string,port='GigabitEthernet0/0'):Criterion=>({kind:'all',criteria:[
 {kind:'interface',device,interface:port,property:'ip',value:address},
 {kind:'interface',device,interface:port,property:'mask',value:'255.255.255.0'},
 {kind:'interface',device,interface:port,property:'adminUp',value:true},
]});
export function createDot1QTrunkingLab(mode:CatalogMode='practice'):LabDocument{
 const make=(name:string,kind:Device['kind'],x:number,y:number):Device=>({id:'device-dot1q-'+name.toLowerCase(),kind,x,y,powered:true,config:factoryDeviceConfig(kind,name),runtime:emptyRuntime()});
 const switches=[make('SW1','switch',260,160),make('SW2','switch',780,160)];
 const pcs=[1,2,3,4,5,6].map(n=>{const side=(n-1)%2,pair=Math.floor((n-1)/2),vlan=[10,20,99][pair],pc=make(`PC${n}`,'pc',100+side*520+pair*160,430);Object.assign(pc.config.interfaces.GigabitEthernet0,{ip:`192.168.${vlan}.${11+side}`,mask:'255.255.255.0'});pc.config.interfaces.GigabitEthernet0.features.dhcp=false;delete pc.config.defaultGateway;return pc;});
 for(const sw of switches){for(const[id,name]of [[10,'USERS'],[20,'GUESTS']] as const)sw.config.vlans[id]={id,name,active:true};for(const[n,vlan]of [[1,10],[2,20],[3,99]]){const port=sw.config.interfaces[`GigabitEthernet0/${n}`];Object.assign(port,{mode:'access',vlan});port.features.portfast=true;}sw.config.interfaces['GigabitEthernet0/24'].adminUp=false;}
 for(const d of [...switches,...pcs])d.startupConfig=structuredClone(d.config);
 const trunk=(sw:Device):Criterion=>({kind:'all',criteria:[
  {kind:'interface',device:sw.id,interface:'GigabitEthernet0/24',property:'switchport',value:true},
  {kind:'interface',device:sw.id,interface:'GigabitEthernet0/24',property:'mode',value:'trunk'},
  {kind:'interface',device:sw.id,interface:'GigabitEthernet0/24',property:'nonegotiate',value:true},
  {kind:'interface',device:sw.id,interface:'GigabitEthernet0/24',property:'portfast',value:false},
  {kind:'interface',device:sw.id,interface:'GigabitEthernet0/24',property:'adminUp',value:true},
 ]});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'802-1q-trunking',name:'802.1Q Trunking'+(mode==='completed'?' · Completed':''),devices:[...switches,...pcs],links:[
  {id:'link-dot1q-trunk',a:{deviceId:switches[0].id,port:'GigabitEthernet0/24'},b:{deviceId:switches[1].id,port:'GigabitEthernet0/24'},enabled:true,delay:.1,loss:0},
  ...pcs.map((pc,i)=>({id:`link-dot1q-pc${i+1}`,a:{deviceId:switches[i%2].id,port:`GigabitEthernet0/${Math.floor(i/2)+1}`},b:{deviceId:pc.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0})),
 ],notes:[{id:'note-dot1q-vlans',x:520,y:620,text:'VLAN 10 · PC1 ↔ PC2 · tagged\nVLAN 20 · PC3 ↔ PC4 · tagged\nNative VLAN 99 · PC5 ↔ PC6 · untagged on the trunk'}],lesson:{title:'802.1Q Trunking',description:'SW1 and SW2 each have a PC in VLAN 10, VLAN 20 and native VLAN 99. All PC addresses and access ports are preconfigured. The inter-switch Gi0/24 ports begin shut down in access mode, and VLAN 99 is missing on both switches.\n\nCreate VLAN 99 on both switches. Configure both Gi0/24 interfaces as static 802.1Q trunks with DTP negotiation disabled, matching native VLAN 99 and an allowed list of exactly 10,20,99, then enable the interfaces. Preserve normal spanning tree on the inter-switch link.\n\nUse show interfaces trunk and show interfaces GigabitEthernet0/24 switchport to inspect both ends. Run the three PC-pair tests below: VLANs 10 and 20 must cross tagged, and native VLAN 99 must cross untagged. Inspect remote MAC entries on Gi0/24 in each VLAN. No router or default gateway is required for these same-VLAN tests. Save both switches with write memory, then save or export the lab.',objectives:[
  {id:'native-vlan',title:'Create VLAN 99 on both switches',description:'Name the native VLAN NATIVE. VLANs 10 and 20 already exist.',criterion:{kind:'all',criteria:switches.map(sw=>({kind:'vlan',device:sw.id,id:99}))}},
  ...switches.map(sw=>({id:sw.config.hostname.toLowerCase()+'-trunk',title:`Configure and enable ${sw.config.hostname} Gi0/24 as a static trunk`,description:'Use switchport mode trunk and switchport nonegotiate, then no shutdown. Keep PortFast disabled.',criterion:trunk(sw)})),
  {id:'native-match',title:'Set native VLAN 99 on both trunk interfaces',description:'Match the untagged VLAN at both ends.',criterion:{kind:'all',criteria:switches.map(sw=>({kind:'interface',device:sw.id,interface:'GigabitEthernet0/24',property:'nativeVlan',value:99}))}},
  {id:'allowed',title:'Allow exactly VLANs 10, 20 and 99 on both trunks',description:'Verify the allowed and active VLAN lists with show interfaces trunk.',criterion:{kind:'all',criteria:switches.map(sw=>({kind:'trunk-allowed',device:sw.id,interface:'GigabitEthernet0/24',vlans:[10,20,99]}))}},
  ...[10,20,99].map((vlan,i)=>({id:`vlan${vlan}-ping`,title:`Verify PC${2*i+1} reaches PC${2*i+2} across VLAN ${vlan}`,description:`192.168.${vlan}.11 → 192.168.${vlan}.12. ${vlan===99?'Native traffic crosses the trunk untagged.':'Traffic crosses the trunk with an 802.1Q tag.'}`,criterion:{kind:'echo' as const,device:pcs[2*i].id,from:`192.168.${vlan}.12`},action:{kind:'ping' as const,device:pcs[2*i].id,target:`192.168.${vlan}.12`}})),
  {id:'remote-macs',title:'Verify remote MAC learning on each switch’s trunk',description:'Each switch must learn the three PCs on the other switch through Gi0/24, in their own VLANs.',criterion:{kind:'all',criteria:switches.flatMap((sw,side)=>[0,1,2].map(pair=>({kind:'mac-learned',device:sw.id,interface:'GigabitEthernet0/24',source:pcs[2*pair+1-side].id,sourceInterface:'GigabitEthernet0',vlan:[10,20,99][pair]})))}},
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261029,lab};
 return mode==='completed'?completedDocument(doc,DOT1Q_TRUNK_COMMANDS):parseDocument(JSON.stringify(doc));
}
export function createPoEInterfaceLab(mode:CatalogMode='practice'):LabDocument{
 const make=(name:string,kind:Device['kind'],x:number,y:number):Device=>({id:'device-poe-'+name.toLowerCase(),kind,x,y,powered:true,config:factoryDeviceConfig(kind,name),runtime:emptyRuntime()});
 const sw=make('PSW1','poeswitch',500,180),ap=make('AP1','ap',200,420),phone=make('PHONE1','phone',500,420),pc=make('PC1','pc',500,650),server=make('SRV1','server',800,420);
 sw.config.features.poe.budget=40;sw.config.vlans[10]={id:10,name:'LAB',active:true};
 for(const[n,name]of [[1,'TO_AP1'],[2,'TO_PHONE1'],[3,'TO_SRV1']] as const){const port=sw.config.interfaces[`GigabitEthernet0/${n}`];Object.assign(port,{description:name,mode:'access',vlan:10});port.features.portfast=true;if(n<3){port.adminUp=false;port.features.powerInline={mode:'never',max:30000};}}
 for(const[d,port,address]of [[ap,'GigabitEthernet0','192.168.10.21'],[phone,'Network','192.168.10.20'],[pc,'GigabitEthernet0','192.168.10.11'],[server,'GigabitEthernet0','192.168.10.10']] as const){Object.assign(d.config.interfaces[port],{ip:address,mask:'255.255.255.0'});d.config.interfaces[port].features.dhcp=false;delete d.config.defaultGateway;}
 for(const d of [sw,ap,phone,pc,server])d.startupConfig=structuredClone(d.config);
 const supply=(d:Device,n:number):Criterion=>({kind:'poe-supply',device:d.id,switch:sw.id,interface:`GigabitEthernet0/${n}`,watts:15.4,standard:'802.3af',class:3,...d.kind==='ap'?{spatialStreams:2 as const,usb:false}:{}});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'poe-interface',name:'PoE Interface'+(mode==='completed'?' · Completed':''),devices:[sw,ap,phone,pc,server],links:[
  {id:'link-poe-ap',a:{deviceId:sw.id,port:'GigabitEthernet0/1'},b:{deviceId:ap.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-poe-phone',a:{deviceId:sw.id,port:'GigabitEthernet0/2'},b:{deviceId:phone.id,port:'Network'},enabled:true,delay:.1,loss:0},
  {id:'link-poe-pc',a:{deviceId:phone.id,port:'PC'},b:{deviceId:pc.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-poe-server',a:{deviceId:sw.id,port:'GigabitEthernet0/3'},b:{deviceId:server.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
 ],notes:[{id:'note-poe-budget',x:500,y:790,text:`PSW1 · 40 W available
Target: AP1 15.4 W + PHONE1 15.4 W = 30.8 W`}],lesson:{title:'PoE Interface',description:`AP1 and PHONE1 begin without power: PSW1 Gi0/1–2 are shut down and inline power is disabled. PC1 connects through the phone’s PC passthrough port. All IPv4 settings and VLAN 10 access ports are already configured.

Open PSW1 and choose Open console. Enable Gi0/1–2, set both power limits to 15400 mW, give PHONE1 high power priority and AP1 low priority, and disable inline power on unused Gi0/4 while leaving that port enabled for data. Keep the switch’s 40 W budget.

Inspect show power inline and the per-port detail and priority views. The full 30 W AP profile and the 15.4 W phone cannot share this budget. AP1 must use its reduced 15.4 W profile so both devices receive power. The completed allocation is 30.8 W used and 9.2 W remaining. Open PHONE1 to inspect power and passthrough, then run the real packet checks below. Save PSW1 with write memory, then save or export the lab.`,objectives:[
  {id:'ports',title:'Enable both powered-device interfaces',description:'Gi0/1 connects AP1; Gi0/2 connects PHONE1. Use no shutdown.',criterion:{kind:'all',criteria:[1,2].map(n=>({kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'adminUp',value:true}))}},
  {id:'phone-config',title:'Configure PHONE1’s power limit and high priority',description:'Gi0/2: inline power auto, maximum 15400 mW, priority high.',criterion:{kind:'poe-interface',device:sw.id,interface:'GigabitEthernet0/2',mode:'auto',max:15400,priority:'high'}},
  {id:'ap-config',title:'Configure AP1’s reduced power limit and low priority',description:'Gi0/1: inline power auto, maximum 15400 mW, priority low.',criterion:{kind:'poe-interface',device:sw.id,interface:'GigabitEthernet0/1',mode:'auto',max:15400,priority:'low'}},
  {id:'unused',title:'Leave unused Gi0/4 enabled for data with inline power disabled',description:'Use power inline never; keep the interface administratively up.',criterion:{kind:'all',criteria:[{kind:'poe-interface',device:sw.id,interface:'GigabitEthernet0/4',mode:'never',max:30000,priority:'low'},{kind:'interface',device:sw.id,interface:'GigabitEthernet0/4',property:'adminUp',value:true}]}},
  {id:'phone-power',title:'Verify PHONE1 receives 15.4 W from PSW1 Gi0/2',description:'Requires a live 802.3af class 3 allocation on the connected switch port.',criterion:supply(phone,2)},
  {id:'ap-power',title:'Verify AP1 receives its reduced 15.4 W allocation',description:'Gi0/1: 802.3af class 3, 2×2 radios and USB disabled.',criterion:supply(ap,1)},
  {id:'phone-ping',title:'Verify PHONE1 can reach SRV1',description:'192.168.10.20 → 192.168.10.10 over the powered Network uplink.',criterion:{kind:'echo',device:phone.id,from:'192.168.10.10'},action:{kind:'ping',device:phone.id,target:'192.168.10.10',when:supply(phone,2)}},
  {id:'pc-ping',title:'Verify PC1 reaches SRV1 through the powered phone',description:'192.168.10.11 → 192.168.10.10. The phone’s PC passthrough requires PoE.',criterion:{kind:'echo',device:pc.id,from:'192.168.10.10'},action:{kind:'ping',device:pc.id,target:'192.168.10.10',when:supply(phone,2)}},
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261029,lab};
 return mode==='completed'?completedDocument(doc,POE_INTERFACE_COMMANDS):parseDocument(JSON.stringify(doc));
}
export function createVoiceVLANLab(mode:CatalogMode='practice'):LabDocument{
 const make=(name:string,kind:Device['kind'],x:number,y:number):Device=>({id:'device-voice-'+name.toLowerCase(),kind,x,y,powered:true,config:factoryDeviceConfig(kind,name),runtime:emptyRuntime()});
 const sw=make('PSW1','poeswitch',500,300),router=make('R1','router',250,100),server=make('SRV1','server',750,100),phones=[make('PHONE1','phone',300,510),make('PHONE2','phone',700,510)],pcs=[make('PC1','pc',300,720),make('PC2','pc',700,720)];
 for(const[i,pc]of pcs.entries()){Object.assign(pc.config.interfaces.GigabitEthernet0,{ip:`192.168.10.${11+i}`,mask:'255.255.255.0'});pc.config.interfaces.GigabitEthernet0.features.dhcp=false;pc.config.defaultGateway='192.168.10.1';}
 Object.assign(server.config.interfaces.GigabitEthernet0,{ip:'192.168.100.10',mask:'255.255.255.0'});server.config.interfaces.GigabitEthernet0.features.dhcp=false;server.config.defaultGateway='192.168.100.1';server.config.dnsServers=['192.168.100.10'];server.config.services.dns={enabled:true,records:{'voice-server.lab':'192.168.100.10'}};server.config.services.dhcp={enabled:true,pools:[{name:'VOICE',network:'192.168.20.0',prefix:24,defaultRouter:'192.168.20.1',dnsServers:['192.168.100.10'],domain:'voice.lab',leaseSeconds:3600}],excluded:[{start:'192.168.20.1',end:'192.168.20.20'}]};
 const ports:Criterion={kind:'all',criteria:[1,2].flatMap(n=>[
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'mode' as const,value:'access'},
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'vlan' as const,value:10},
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'voiceVlan' as const,value:20},
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'portfast' as const,value:true},
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'adminUp' as const,value:true},
 ])};
 const lease=(phone:Device):Criterion=>({kind:'dhcp-lease',device:phone.id,interface:'Network',server:server.id,network:'192.168.20.0',prefix:24,gateway:'192.168.20.1',dnsServer:'192.168.100.10'});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'voice-vlan',name:'Voice VLAN'+(mode==='completed'?' · Completed':''),devices:[sw,router,server,...phones,...pcs],links:[
  {id:'link-voice-router',a:{deviceId:sw.id,port:'GigabitEthernet0/3'},b:{deviceId:router.id,port:'GigabitEthernet0/0'},enabled:true,delay:.1,loss:0},
  {id:'link-voice-server',a:{deviceId:sw.id,port:'GigabitEthernet0/4'},b:{deviceId:server.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  ...phones.flatMap((phone,i)=>[{id:`link-voice-phone${i+1}`,a:{deviceId:sw.id,port:`GigabitEthernet0/${i+1}`},b:{deviceId:phone.id,port:'Network'},enabled:true,delay:.1,loss:0},{id:`link-voice-pc${i+1}`,a:{deviceId:phone.id,port:'PC'},b:{deviceId:pcs[i].id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0}]),
 ],notes:[{id:'note-voice-networks',x:500,y:850,text:'DATA · VLAN 10 · PCs remain untagged\nVOICE · VLAN 20 · Phones use DHCP + tagged traffic'}],lesson:{title:'Voice VLAN',description:'Two phones connect to PSW1, with a PC attached to each phone’s PC passthrough port. The phone-facing switch ports begin shut down with inline power disabled. PCs already have their data-VLAN IPv4 settings.\n\nCreate VLAN 10 (DATA) and VLAN 20 (VOICE). Configure Gi0/1–2 as access ports in data VLAN 10 with voice VLAN 20, enable PortFast and CDP, restore inline power, and enable the ports. Keep the preconfigured router trunk, server port and services VLAN 100 intact.\n\nOpen each phone to inspect its actual power allocation, received voice policy and DHCP address. Use the checks below to test the PCs through the phones and each phone through voice VLAN 20. Inspect the MAC table: both VLANs must be learned on each shared phone-facing port. R1 and SRV1 already provide the routed gateways and voice DHCP/DNS service. Save PSW1 with write memory, then save or export the lab.',objectives:[
  {id:'vlan10',title:'Create data VLAN 10 on PSW1',description:'Name it DATA.',criterion:{kind:'vlan',device:sw.id,id:10}},
  {id:'vlan20',title:'Create voice VLAN 20 on PSW1',description:'Name it VOICE.',criterion:{kind:'vlan',device:sw.id,id:20}},
  {id:'phone-ports',title:'Configure and enable the two shared phone access ports',description:'Gi0/1–2: access VLAN 10, voice VLAN 20 and PortFast.',criterion:ports},
  {id:'poe',title:'Power both phones from PSW1',description:'Enable inline power on Gi0/1–2. Each phone needs a real PoE allocation.',criterion:{kind:'all',criteria:phones.map(phone=>({kind:'device',device:phone.id,powered:true}))}},
  {id:'voice-policy',title:'Verify both phones learn voice VLAN 20',description:'Open each phone and inspect the received CDP or LLDP-MED policy.',criterion:{kind:'all',criteria:phones.map(phone=>({kind:'voice-policy',device:phone.id,vlan:20}))}},
  {id:'voice-leases',title:'Verify both phones obtain voice DHCP leases',description:'192.168.20.0/24, gateway 192.168.20.1 and DNS 192.168.100.10. Inspect SRV1’s DHCP leases if needed.',criterion:{kind:'all',criteria:phones.map(lease)}},
  {id:'data-ping',title:'Verify PC1 can reach PC2 through the phones',description:'192.168.10.11 → 192.168.10.12 in the untagged data VLAN.',criterion:{kind:'echo',device:pcs[0].id,from:'192.168.10.12'},action:{kind:'ping',device:pcs[0].id,target:'192.168.10.12'}},
  ...phones.map((phone,i)=>({id:`phone${i+1}-ping`,title:`Verify PHONE${i+1} reaches the voice gateway`,description:'Test 192.168.20.1 using the phone’s tagged voice-VLAN path.',criterion:{kind:'echo' as const,device:phone.id,from:'192.168.20.1'},action:{kind:'ping' as const,device:phone.id,target:'192.168.20.1',when:lease(phone)}})),
  {id:'mac-learning',title:'Verify separate voice and data MAC entries on both shared ports',description:'Gi0/1: PHONE1 in VLAN 20 and PC1 in VLAN 10; Gi0/2: PHONE2 in VLAN 20 and PC2 in VLAN 10.',criterion:{kind:'all',criteria:phones.flatMap((phone,i)=>[{kind:'mac-learned' as const,device:sw.id,interface:`GigabitEthernet0/${i+1}`,source:phone.id,sourceInterface:'Network',vlan:20},{kind:'mac-learned' as const,device:sw.id,interface:`GigabitEthernet0/${i+1}`,source:pcs[i].id,sourceInterface:'GigabitEthernet0',vlan:10}])}},
 ]}};
 const baseline:Readonly<Record<string,readonly string[]>>={
  PSW1:['enable','configure terminal','vlan 100','name SERVICES','interface range GigabitEthernet0/1 - 2','power inline never','shutdown','interface GigabitEthernet0/3','description TO_R1','switchport mode trunk','switchport trunk allowed vlan 10,20,100','spanning-tree portfast trunk','no shutdown','interface GigabitEthernet0/4','description TO_SRV1','switchport mode access','switchport access vlan 100','spanning-tree portfast','no shutdown','end','write memory'],
  R1:['enable','configure terminal','interface GigabitEthernet0/0','description TRUNK_TO_PSW1','no shutdown','interface GigabitEthernet0/0.10','encapsulation dot1Q 10','ip address 192.168.10.1 255.255.255.0','interface GigabitEthernet0/0.20','encapsulation dot1Q 20','ip address 192.168.20.1 255.255.255.0','ip helper-address 192.168.100.10','interface GigabitEthernet0/0.100','encapsulation dot1Q 100','ip address 192.168.100.1 255.255.255.0','end','write memory'],
 };
 const doc=completedDocument({format:'netsim-lab',version:1,seed:20261029,lab},baseline);
 return mode==='completed'?completedDocument(doc,VOICE_VLAN_COMMANDS):doc;
}
export function createVLANAccessLab(mode:CatalogMode='practice'):LabDocument{
 const sw:Device={id:'device-vlan-sw1',kind:'switch',x:500,y:180,powered:true,config:factoryDeviceConfig('switch','SW1'),runtime:emptyRuntime()};
 const pcs=[1,2,3,4].map(n=>{const vlan=n<=2?10:20,config=factoryDeviceConfig('pc',`PC${n}`),port=config.interfaces.GigabitEthernet0;Object.assign(port,{ip:`192.168.${vlan}.${n%2===1?11:12}`,mask:'255.255.255.0',adminUp:true});port.features.dhcp=false;delete config.defaultGateway;sw.config.interfaces[`GigabitEthernet0/${n}`].adminUp=false;return {id:`device-vlan-pc${n}`,kind:'pc' as const,x:180+(n-1)*215,y:430,powered:true,config,runtime:emptyRuntime()};});
 sw.startupConfig=structuredClone(sw.config);
 const accessGroup=(ports:number[],vlan:number):Criterion=>({kind:'all',criteria:ports.flatMap(n=>[
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'switchport' as const,value:true},
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'mode' as const,value:'access'},
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'vlan' as const,value:vlan},
  {kind:'interface' as const,device:sw.id,interface:`GigabitEthernet0/${n}`,property:'adminUp' as const,value:true},
 ])});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'vlan-and-access-ports',name:'VLAN and access ports'+(mode==='completed'?' · Completed':''),devices:[sw,...pcs],links:pcs.map((d,i)=>({id:`link-vlan-pc${i+1}`,a:{deviceId:sw.id,port:`GigabitEthernet0/${i+1}`},b:{deviceId:d.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0})),notes:[{id:'note-vlan-users',x:285,y:550,text:'VLAN 10 · USERS · 192.168.10.0/24\nPC1 ↔ PC2'},{id:'note-vlan-guests',x:715,y:550,text:'VLAN 20 · GUESTS · 192.168.20.0/24\nPC3 ↔ PC4'}],lesson:{title:'VLAN and access ports',description:'Four PCs are connected to SW1 and already have static IPv4 addresses. PC1 and PC2 belong in VLAN 10 (USERS); PC3 and PC4 belong in VLAN 20 (GUESTS). All four switch access interfaces begin administratively down in VLAN 1.\n\nCreate both VLANs. Configure Gi0/1–2 as access ports in VLAN 10 and Gi0/3–4 as access ports in VLAN 20, then enable the interfaces. The reference uses interface range and PortFast for these endpoint-facing access ports.\n\nTest PC1 → PC2 and PC3 → PC4, then inspect the dynamic MAC table for all four PCs in their correct VLANs and ports. In each PC Command prompt, also verify that PC1 → PC3 and PC3 → PC1 receive no replies. The two VLANs form separate broadcast domains, and this lab provides no inter-VLAN routing. Save SW1 with write memory and save or export your lab.',objectives:[
  {id:'vlan10',title:'Create VLAN 10 on SW1',description:'Name it USERS.',criterion:{kind:'vlan',device:sw.id,id:10}},
  {id:'vlan20',title:'Create VLAN 20 on SW1',description:'Name it GUESTS.',criterion:{kind:'vlan',device:sw.id,id:20}},
  {id:'users-ports',title:'Assign and enable Gi0/1–2 as access ports in VLAN 10',description:'These ports connect PC1 and PC2.',criterion:accessGroup([1,2],10)},
  {id:'guests-ports',title:'Assign and enable Gi0/3–4 as access ports in VLAN 20',description:'These ports connect PC3 and PC4.',criterion:accessGroup([3,4],20)},
  {id:'users-ping',title:'Verify PC1 can ping PC2 within VLAN 10',description:'192.168.10.11 → 192.168.10.12',criterion:{kind:'echo',device:pcs[0].id,from:'192.168.10.12'},action:{kind:'ping',device:pcs[0].id,target:'192.168.10.12'}},
  {id:'guests-ping',title:'Verify PC3 can ping PC4 within VLAN 20',description:'192.168.20.11 → 192.168.20.12',criterion:{kind:'echo',device:pcs[2].id,from:'192.168.20.12'},action:{kind:'ping',device:pcs[2].id,target:'192.168.20.12'}},
  {id:'mac-learning',title:'Verify all four PC MAC addresses are learned in their VLANs',description:'PC1/PC2 on Gi0/1–2 in VLAN 10; PC3/PC4 on Gi0/3–4 in VLAN 20. Generate traffic first.',criterion:{kind:'all',criteria:pcs.map((d,i)=>({kind:'mac-learned',device:sw.id,interface:`GigabitEthernet0/${i+1}`,source:d.id,sourceInterface:'GigabitEthernet0',vlan:i<2?10:20}))}},
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261105,lab};return mode==='practice'?doc:completedDocument(doc,VLAN_ACCESS_COMMANDS);
}
export function createL3InterfaceLab(mode:CatalogMode='practice'):LabDocument{
 const make=(id:string,kind:Device['kind'],hostname:string,x:number,y:number):Device=>({id,kind,x,y,powered:true,config:factoryDeviceConfig(kind,hostname),runtime:emptyRuntime()});
 const sw=make('device-l3-dsw1','l3switch','DSW1',500,180),a=make('device-l3-pc1','pc','PC1',280,420),b=make('device-l3-pc2','pc','PC2',720,420);
 sw.config.ipRouting=false;
 for(const[n,d,subnet]of [[1,a,10],[2,b,20]]as const){sw.config.interfaces[`GigabitEthernet0/${n}`].adminUp=false;Object.assign(d.config.interfaces.GigabitEthernet0,{ip:`192.168.${subnet}.10`,mask:'255.255.255.0',adminUp:true});d.config.interfaces.GigabitEthernet0.features.dhcp=false;d.config.defaultGateway=`192.168.${subnet}.1`;}
 sw.startupConfig=structuredClone(sw.config);
 const routedPort=(n:number,subnet:number):Criterion=>({kind:'all',criteria:[
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'switchport',value:false},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'description',value:`TO_PC${n}`},
  ipv4InterfaceCriterion(sw.id,`192.168.${subnet}.1`,`GigabitEthernet0/${n}`),
 ]});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'layer-3-routed-interfaces',name:'Layer 3 routed interfaces'+(mode==='completed'?' · Completed':''),devices:[sw,a,b],links:[
  {id:'link-l3-pc1',a:{deviceId:sw.id,port:'GigabitEthernet0/1'},b:{deviceId:a.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-l3-pc2',a:{deviceId:sw.id,port:'GigabitEthernet0/2'},b:{deviceId:b.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
 ],notes:[{id:'note-l3-lan10',x:280,y:540,text:'192.168.10.0/24\nGateway: 192.168.10.1'},{id:'note-l3-lan20',x:720,y:540,text:'192.168.20.0/24\nGateway: 192.168.20.1'}],lesson:{title:'Layer 3 routed interfaces',description:'PC1 and PC2 are connected to the multilayer switch DSW1 on different IPv4 subnets. Both PCs already have static addresses and default gateways. The connected switch ports start as Layer 2 interfaces, administratively down, with IPv4 routing disabled.\n\nOn DSW1, use no switchport to convert Gi0/1 and Gi0/2 to routed physical interfaces. Set descriptions TO_PC1 and TO_PC2, assign the /24 gateway addresses from the plan, and enable both ports. Enable ip routing globally so the switch can forward packets between the subnets.\n\nVerify that switchport mode is disabled on both ports, both routed interfaces are up/up, and the routing table contains the two directly connected /24 networks. Check each PC can reach its own gateway, then test pings between the PCs in both directions. Save DSW1 with write memory and save or export your lab.',objectives:[
  {id:'pc1-port',title:'Configure DSW1 Gi0/1 as a routed port for PC1',description:'No switchport; description TO_PC1; 192.168.10.1/24; administratively up.',criterion:routedPort(1,10)},
  {id:'pc2-port',title:'Configure DSW1 Gi0/2 as a routed port for PC2',description:'No switchport; description TO_PC2; 192.168.20.1/24; administratively up.',criterion:routedPort(2,20)},
  {id:'ip-routing',title:'Enable IPv4 routing on DSW1',description:'Configure ip routing in global configuration mode.',criterion:{kind:'ip-routing',device:sw.id,enabled:true}},
  {id:'connected-routes',title:'Verify both directly connected /24 routes',description:'192.168.10.0/24 and 192.168.20.0/24 must be connected networks.',criterion:{kind:'all',criteria:[{kind:'route',device:sw.id,network:'192.168.10.0',prefix:24,protocol:'connected'},{kind:'route',device:sw.id,network:'192.168.20.0',prefix:24,protocol:'connected'}]}},
  {id:'pc1-ping',title:'Verify PC1 can ping PC2',description:'192.168.10.10 → 192.168.20.10',criterion:{kind:'echo',device:a.id,from:'192.168.20.10'},action:{kind:'ping',device:a.id,target:'192.168.20.10'}},
  {id:'pc2-ping',title:'Verify PC2 can ping PC1',description:'192.168.20.10 → 192.168.10.10',criterion:{kind:'echo',device:b.id,from:'192.168.10.10'},action:{kind:'ping',device:b.id,target:'192.168.10.10'}},
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261104,lab};return mode==='practice'?doc:completedDocument(doc,L3_INTERFACE_COMMANDS);
}
export function createL2InterfaceLab(mode:CatalogMode='practice'):LabDocument{
 const make=(id:string,kind:Device['kind'],hostname:string,x:number,y:number):Device=>({id,kind,x,y,powered:true,config:factoryDeviceConfig(kind,hostname),runtime:emptyRuntime()});
 const sw=make('device-l2-sw1','switch','SW1',500,180),a=make('device-l2-pc1','pc','PC1',280,420),b=make('device-l2-pc2','pc','PC2',720,420);
 for(const[n,d,address]of [[1,a,'192.168.10.10'],[2,b,'192.168.10.20']]as const){sw.config.interfaces[`GigabitEthernet0/${n}`].adminUp=false;Object.assign(d.config.interfaces.GigabitEthernet0,{ip:address,mask:'255.255.255.0',adminUp:true});d.config.interfaces.GigabitEthernet0.features.dhcp=false;delete d.config.defaultGateway;}
 sw.startupConfig=structuredClone(sw.config);
 const accessPort=(n:number):Criterion=>({kind:'all',criteria:[
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'switchport',value:true},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'mode',value:'access'},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'vlan',value:10},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'description',value:`TO_PC${n}`},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'adminUp',value:true},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'speedAuto',value:true},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'duplex',value:'auto'},
  {kind:'interface',device:sw.id,interface:`GigabitEthernet0/${n}`,property:'portfast',value:true},
 ]});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'layer-2-switching-interfaces',name:'Layer 2 switching interfaces'+(mode==='completed'?' · Completed':''),devices:[sw,a,b],links:[
  {id:'link-l2-pc1',a:{deviceId:sw.id,port:'GigabitEthernet0/1'},b:{deviceId:a.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-l2-pc2',a:{deviceId:sw.id,port:'GigabitEthernet0/2'},b:{deviceId:b.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
 ],notes:[{id:'note-l2-vlan',x:500,y:540,text:'VLAN 10 · USERS · 192.168.10.0/24\nPC1 and PC2 are already addressed'}],lesson:{title:'Layer 2 switching interfaces',description:'PC1 and PC2 are connected to SW1 and already have static IPv4 addresses in the same /24 subnet. The two connected switch interfaces begin administratively down in VLAN 1. Configure SW1 to connect the PCs through VLAN 10.\n\nCreate VLAN 10 and name it USERS. Configure Gi0/1 and Gi0/2 as access ports in VLAN 10, with descriptions TO_PC1 and TO_PC2. Use automatic speed and duplex, enable PortFast on these endpoint-facing ports, and bring both ports up. Label unused Gi0/3 UNUSED and shut it down.\n\nVerify the interface status and switchport settings, test pings in both directions, and inspect the dynamic MAC address table for both PCs in VLAN 10. A same-VLAN exchange needs no router, switch IP address or PC default gateway. Save SW1 with write memory and save or export your lab.',objectives:[
  {id:'vlan10',title:'Create VLAN 10 on SW1',description:'Name the VLAN USERS.',criterion:{kind:'vlan',device:sw.id,id:10}},
  {id:'pc1-port',title:'Configure and enable SW1 Gi0/1 for PC1',description:'Access VLAN 10, description TO_PC1, automatic speed/duplex, and PortFast.',criterion:accessPort(1)},
  {id:'pc2-port',title:'Configure and enable SW1 Gi0/2 for PC2',description:'Access VLAN 10, description TO_PC2, automatic speed/duplex, and PortFast.',criterion:accessPort(2)},
  {id:'unused-port',title:'Label and shut down unused SW1 Gi0/3',description:'Description UNUSED; administratively down.',criterion:{kind:'all',criteria:[{kind:'interface',device:sw.id,interface:'GigabitEthernet0/3',property:'description',value:'UNUSED'},{kind:'interface',device:sw.id,interface:'GigabitEthernet0/3',property:'adminUp',value:false}]}},
  {id:'mac-learning',title:'Verify both PC MAC addresses are learned dynamically',description:'PC1 on Gi0/1 and PC2 on Gi0/2, both in VLAN 10. Send traffic first.',criterion:{kind:'all',criteria:[{kind:'mac-learned',device:sw.id,interface:'GigabitEthernet0/1',source:a.id,sourceInterface:'GigabitEthernet0',vlan:10},{kind:'mac-learned',device:sw.id,interface:'GigabitEthernet0/2',source:b.id,sourceInterface:'GigabitEthernet0',vlan:10}]}},
  {id:'pc1-ping',title:'Verify PC1 can ping PC2',description:'192.168.10.10 → 192.168.10.20',criterion:{kind:'echo',device:a.id,from:'192.168.10.20'},action:{kind:'ping',device:a.id,target:'192.168.10.20'}},
  {id:'pc2-ping',title:'Verify PC2 can ping PC1',description:'192.168.10.20 → 192.168.10.10',criterion:{kind:'echo',device:b.id,from:'192.168.10.10'},action:{kind:'ping',device:b.id,target:'192.168.10.10'}},
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261103,lab};return mode==='practice'?doc:completedDocument(doc,L2_INTERFACE_COMMANDS);
}
export function createDHCPRelayLab(mode:CatalogMode='practice'):LabDocument{
 const make=(id:string,kind:Device['kind'],hostname:string,x:number,y:number):Device=>({id,kind,x,y,powered:true,config:factoryDeviceConfig(kind,hostname),runtime:emptyRuntime()});
 const r=make('device-dhcp-r1','router','R1',560,180),sw=make('device-dhcp-sw1','switch','SW1',360,360),server=make('device-dhcp-server','server','SRV1',840,180),a=make('device-dhcp-pc1','pc','PC1',200,560),b=make('device-dhcp-pc2','pc','PC2',520,560);
 Object.assign(r.config.interfaces['GigabitEthernet0/0'],{ip:'192.168.10.1',mask:'255.255.255.0',adminUp:true,description:'CLIENT_LAN'});Object.assign(r.config.interfaces['GigabitEthernet0/1'],{ip:'192.168.100.1',mask:'255.255.255.0',adminUp:true,description:'SERVER_LAN'});
 for(const n of [1,2,3])sw.config.interfaces[`GigabitEthernet0/${n}`].features.portfast=true;
 Object.assign(server.config.interfaces.GigabitEthernet0,{ip:'192.168.100.10',mask:'255.255.255.0',adminUp:true});server.config.interfaces.GigabitEthernet0.features.dhcp=false;server.config.defaultGateway='192.168.100.1';server.config.dnsServers=['192.168.100.10'];server.config.services.dns={enabled:true,records:{'server.lab.example':'192.168.100.10'}};server.config.services.dhcp=mode==='completed'?structuredClone(DHCP_SERVER_SETTINGS):{enabled:false,pools:[],excluded:[]};
 for(const d of [a,b]){const port=d.config.interfaces.GigabitEthernet0;delete port.ip;delete port.mask;port.features.dhcp=true;delete d.config.defaultGateway;d.config.dnsServers=[];}
 for(const d of [r,sw])d.startupConfig=structuredClone(d.config);
 const lease=(device:string):Criterion=>({kind:'dhcp-lease',device,interface:'GigabitEthernet0',server:server.id,network:'192.168.10.0',prefix:24,gateway:'192.168.10.1',dnsServer:'192.168.100.10'});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'dhcp-server-and-relay',name:'DHCP server and relay'+(mode==='completed'?' · Completed':''),devices:[r,sw,server,a,b],links:[
  {id:'link-dhcp-server',a:{deviceId:r.id,port:'GigabitEthernet0/1'},b:{deviceId:server.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-dhcp-uplink',a:{deviceId:r.id,port:'GigabitEthernet0/0'},b:{deviceId:sw.id,port:'GigabitEthernet0/1'},enabled:true,delay:.1,loss:0},
  {id:'link-dhcp-pc1',a:{deviceId:sw.id,port:'GigabitEthernet0/2'},b:{deviceId:a.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-dhcp-pc2',a:{deviceId:sw.id,port:'GigabitEthernet0/3'},b:{deviceId:b.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
 ],notes:[{id:'note-dhcp-clients',x:360,y:670,text:'Client LAN: 192.168.10.0/24\nGateway: 192.168.10.1 · DHCP clients'},{id:'note-dhcp-server',x:840,y:300,text:'Server LAN: 192.168.100.0/24\nDHCP / DNS: 192.168.100.10'}],lesson:{title:'DHCP server and relay',description:'PC1 and PC2 need IPv4 settings from SRV1 on a different subnet. R1, SW1 and SRV1 already have their required interface settings. The PCs are set to DHCP, but the server service and router relay still need configuration.\n\nOn SRV1, open Services → DHCP and create the CLIENTS pool for 192.168.10.0/24. Exclude 192.168.10.1–192.168.10.20, supply gateway 192.168.10.1 and DNS server 192.168.100.10, and use a 3600-second lease. Set the optional DNS domain to lab.example.\n\nConfigure ip helper-address on R1’s client-facing interface. Request or renew both client leases, inspect the active leases on SRV1, and verify each PC can reach the server. The clients may acquire a lease automatically once both settings are correct. Save R1 with write memory and save or export your lab.',objectives:[
  {id:'dhcp-pool',title:'Configure and enable the CLIENTS pool on SRV1',description:'Use the client subnet, excluded range, gateway, DNS server and lease duration in the guide.',criterion:{kind:'dhcp-pool',device:server.id,name:'CLIENTS',network:'192.168.10.0',prefix:24,gateway:'192.168.10.1',dnsServer:'192.168.100.10',excludedStart:'192.168.10.1',excludedEnd:'192.168.10.20',leaseSeconds:3600}},
  {id:'dhcp-relay',title:'Configure R1’s DHCP relay on GigabitEthernet0/0',description:'Forward client broadcasts to 192.168.100.10.',criterion:{kind:'dhcp-relay',device:r.id,interface:'GigabitEthernet0/0',serverAddress:'192.168.100.10'}},
  ...[a,b].map(d=>({id:d===a?'pc1-lease':'pc2-lease',title:`Obtain a valid DHCP lease on ${d.config.hostname}`,description:'Verify the /24 address, gateway and DNS settings received from SRV1.',criterion:lease(d.id),action:{kind:'dhcp' as const,device:d.id,interface:'GigabitEthernet0'}})),
  ...[a,b].map(d=>({id:d===a?'pc1-ping':'pc2-ping',title:`Verify ${d.config.hostname} can reach SRV1`,description:'Ping 192.168.100.10 across R1.',criterion:{kind:'echo' as const,device:d.id,from:'192.168.100.10'},action:{kind:'ping' as const,device:d.id,target:'192.168.100.10',when:lease(d.id)}})),
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261102,lab};return mode==='practice'?doc:completedDocument(doc,DHCP_RELAY_COMMANDS);
}
export function createIPv4TroubleshootingLab(mode:CatalogMode='practice'):LabDocument{
 const make=(id:string,kind:Device['kind'],hostname:string,x:number,y:number):Device=>({id,kind,x,y,powered:true,config:factoryDeviceConfig(kind,hostname),runtime:emptyRuntime()});
 const r=make('device-ipv4-ts-r1','router','R1',500,160),a=make('device-ipv4-ts-pc1','pc','PC1',260,360),b=make('device-ipv4-ts-pc2','pc','PC2',740,360);
 Object.assign(r.config.interfaces['GigabitEthernet0/0'],{ip:'192.168.10.1',mask:'255.255.255.0',adminUp:true,description:'LAN_10'});
 Object.assign(r.config.interfaces['GigabitEthernet0/1'],{ip:'192.168.30.1',mask:'255.255.255.0',adminUp:true,description:'LAN_20'});
 for(const port of ['GigabitEthernet0/0','GigabitEthernet0/1'])r.config.interfaces[port].features.proxyArp=false;
 for(const[d,subnet]of [[a,10],[b,20]]as const){const p=d.config.interfaces.GigabitEthernet0;Object.assign(p,{ip:`192.168.${subnet}.10`,mask:subnet===20?'255.255.0.0':'255.255.255.0',adminUp:true});p.features.dhcp=false;d.config.defaultGateway=subnet===10?'192.168.10.254':'192.168.20.1';}
 // PCs retain their static settings across power cycles without an IOS startup configuration.
 r.startupConfig=structuredClone(r.config);
 const hostCriterion=(d:Device,subnet:number):Criterion=>({kind:'all',criteria:[ipv4InterfaceCriterion(d.id,`192.168.${subnet}.10`,'GigabitEthernet0'),{kind:'default-gateway',device:d.id,address:`192.168.${subnet}.1`}]});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'ipv4-addressing-troubleshooting',name:'IPv4 addressing troubleshooting'+(mode==='completed'?' · Completed':''),devices:[r,a,b],links:[
  {id:'link-ipv4-ts-lan10',a:{deviceId:r.id,port:'GigabitEthernet0/0'},b:{deviceId:a.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-ipv4-ts-lan20',a:{deviceId:r.id,port:'GigabitEthernet0/1'},b:{deviceId:b.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
 ],notes:[{id:'note-ipv4-ts-lan10',x:260,y:490,text:'Intended LAN: 192.168.10.0/24\nGateway: 192.168.10.1'},{id:'note-ipv4-ts-lan20',x:740,y:490,text:'Intended LAN: 192.168.20.0/24\nGateway: 192.168.20.1'}],lesson:{title:'IPv4 addressing troubleshooting',description:'Users on PC1 and PC2 cannot communicate. The devices are powered on and the cables are connected, but three IPv4 settings are incorrect. The addressing plan shows the intended configuration.\n\nUse show ip interface brief and show ip route on R1, and ipconfig /all and route print in each PC Command prompt. Compare the live addresses, masks and gateways with the plan. Repair the settings without changing the topology or adding routes.\n\nCheck each PC can ping its own gateway, then test connectivity between the PCs in both directions. Save R1 with write memory and save or export your repaired lab.',objectives:[
  {id:'r1-addressing',title:'Restore R1 interface addressing',description:'Use the planned /24 address on each LAN interface and keep both interfaces enabled.',criterion:{kind:'all',criteria:[ipv4InterfaceCriterion(r.id,'192.168.10.1'),ipv4InterfaceCriterion(r.id,'192.168.20.1','GigabitEthernet0/1')]}},
  {id:'pc1-addressing',title:'Restore PC1 IPv4 settings',description:'Match its address, subnet mask and default gateway to the addressing plan.',criterion:hostCriterion(a,10)},
  {id:'pc2-addressing',title:'Restore PC2 IPv4 settings',description:'Match its address, subnet mask and default gateway to the addressing plan.',criterion:hostCriterion(b,20)},
  {id:'pc1-ping',title:'Verify PC1 can ping PC2',description:'192.168.10.10 → 192.168.20.10',criterion:{kind:'echo',device:a.id,from:'192.168.20.10'},action:{kind:'ping',device:a.id,target:'192.168.20.10'}},
  {id:'pc2-ping',title:'Verify PC2 can ping PC1',description:'192.168.20.10 → 192.168.10.10',criterion:{kind:'echo',device:b.id,from:'192.168.10.10'},action:{kind:'ping',device:b.id,target:'192.168.10.10'}},
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261101,lab};return mode==='practice'?doc:completedDocument(doc,IPV4_TROUBLESHOOTING_COMMANDS);
}
export function createIPv4InterfaceLab(mode:CatalogMode='practice'):LabDocument{
 const routers=[1,2].map(n=>{const config=factoryDeviceConfig('router',`R${n}`);return {id:`device-ipv4-r${n}`,kind:'router' as const,x:n===1?300:700,y:300,powered:true,config,startupConfig:structuredClone(config),runtime:emptyRuntime()};});
 const lab:CatalogLab={id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),catalogId:'ipv4-interface-configuration',name:'IPv4 interface configuration'+(mode==='completed'?' · Completed':''),devices:routers,links:[{id:'link-ipv4',a:{deviceId:routers[0].id,port:'GigabitEthernet0/0'},b:{deviceId:routers[1].id,port:'GigabitEthernet0/0'},enabled:true,delay:.1,loss:0}],notes:[{id:'note-subnet',x:500,y:440,text:'192.0.2.0/24\nR1: 192.0.2.1 · R2: 192.0.2.2'}],lesson:{title:'IPv4 interface configuration',description:'Configure GigabitEthernet0/0 on R1 and R2 using the addressing plan. Both interfaces begin unconfigured and administratively down.\n\nApply the IPv4 address and subnet mask, enable each interface with no shutdown, and verify that both interfaces are up/up. Test connectivity in both directions, then save each configuration.',objectives:[
  {id:'r1-interface',title:'Configure and enable R1 GigabitEthernet0/0',description:'192.0.2.1 with subnet mask 255.255.255.0 (/24).',criterion:ipv4InterfaceCriterion(routers[0].id,'192.0.2.1')},
  {id:'r2-interface',title:'Configure and enable R2 GigabitEthernet0/0',description:'192.0.2.2 with subnet mask 255.255.255.0 (/24).',criterion:ipv4InterfaceCriterion(routers[1].id,'192.0.2.2')},
  {id:'r1-ping',title:'Verify R1 can ping R2',description:'192.0.2.1 → 192.0.2.2',criterion:{kind:'echo',device:routers[0].id,from:'192.0.2.2'},action:{kind:'ping',device:routers[0].id,target:'192.0.2.2',when:ipv4InterfaceCriterion(routers[0].id,'192.0.2.1')}},
  {id:'r2-ping',title:'Verify R2 can ping R1',description:'192.0.2.2 → 192.0.2.1',criterion:{kind:'echo',device:routers[1].id,from:'192.0.2.1'},action:{kind:'ping',device:routers[1].id,target:'192.0.2.1',when:ipv4InterfaceCriterion(routers[1].id,'192.0.2.2')}},
 ]}};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261031,lab};return mode==='practice'?doc:completedDocument(doc,IPV4_INTERFACE_COMMANDS);
}
const LEGACY_ROAS_GUIDE_DESCRIPTION='PC1 and PC2 already have static IPv4 addresses and default gateways. Configure R1 and SW1 through their consoles to route between VLANs 10 and 20.\n\nCabling: R1 Gi0/0 ↔ SW1 Gi0/1; PC1 Gi0 ↔ SW1 Gi0/2; PC2 Gi0 ↔ SW1 Gi0/3.\n\nKeep the router physical interface unnumbered. Use 802.1Q tags 10 and 20 on its subinterfaces. The reference uses PortFast trunk on the router-facing switch link. Save the device configurations after verification.\n\nVerification: show vlan brief; show interfaces trunk; show ip interface brief; show ip route. From PC1, ping 192.168.20.10. From PC2, ping 192.168.10.10.';
export const ROAS_GUIDE_DESCRIPTION="Configure R1 and SW1 to route between VLANs 10 and 20. Both PCs already have static IPv4 addresses and default gateways.\n\nLeave R1's physical interface unnumbered and use 802.1Q subinterfaces for the VLAN gateways. Complete the tasks below, test connectivity in both directions, and save your configurations.";
/** Refresh the shipped guide copy without replacing saved configuration, progress or custom instructions. */
export function currentRouterOnAStickGuide(description:string):string{
 return description===LEGACY_ROAS_GUIDE_DESCRIPTION?ROAS_GUIDE_DESCRIPTION:description;
}
const lesson=():Lesson=>({
 title:'Router on a stick',
 description:ROAS_GUIDE_DESCRIPTION,
 objectives:[
  {id:'vlans',title:'Create VLANs 10 and 20 on SW1',criterion:{kind:'all',criteria:[{kind:'vlan',device:'device-sw1',id:10},{kind:'vlan',device:'device-sw1',id:20}]}},
  {id:'access',title:'Assign SW1 Gi0/2 to VLAN 10 and Gi0/3 to VLAN 20',criterion:{kind:'all',criteria:[{kind:'interface',device:'device-sw1',interface:'GigabitEthernet0/2',property:'vlan',value:10},{kind:'interface',device:'device-sw1',interface:'GigabitEthernet0/2',property:'mode',value:'access'},{kind:'interface',device:'device-sw1',interface:'GigabitEthernet0/3',property:'vlan',value:20},{kind:'interface',device:'device-sw1',interface:'GigabitEthernet0/3',property:'mode',value:'access'}]}},
  {id:'trunk',title:'Make SW1 Gi0/1 an 802.1Q trunk',description:'Connect to R1 Gi0/0 and allow VLANs 10 and 20. The connectivity tests verify that both VLANs can cross it.',criterion:{kind:'interface',device:'device-sw1',interface:'GigabitEthernet0/1',property:'mode',value:'trunk'}},
  {id:'gateways',title:'Configure R1 subinterface gateways and enable its physical uplink',description:'Gi0/0.10: 192.168.10.1/24, tag 10. Gi0/0.20: 192.168.20.1/24, tag 20.',criterion:{kind:'all',criteria:[{kind:'address',device:'device-r1',address:'192.168.10.1'},{kind:'address',device:'device-r1',address:'192.168.20.1'},{kind:'interface',device:'device-r1',interface:'GigabitEthernet0/0',property:'adminUp',value:true},{kind:'route',device:'device-r1',network:'192.168.10.0',prefix:24},{kind:'route',device:'device-r1',network:'192.168.20.0',prefix:24}]}},
  {id:'pc1-ping',title:'Verify PC1 can ping PC2',description:'192.168.10.10 → 192.168.20.10',criterion:{kind:'echo',device:'device-pc1',from:'192.168.20.10'},action:{kind:'ping',device:'device-pc1',target:'192.168.20.10'}},
  {id:'pc2-ping',title:'Verify PC2 can ping PC1',description:'192.168.20.10 → 192.168.10.10',criterion:{kind:'echo',device:'device-pc2',from:'192.168.10.10'},action:{kind:'ping',device:'device-pc2',target:'192.168.10.10'}},
 ],
});
export function createRouterOnAStickLab(mode:CatalogMode='practice'):LabDocument{
 const make=(id:string,kind:Device['kind'],hostname:string,x:number,y:number):Device=>({id,kind,x,y,powered:true,config:factoryDeviceConfig(kind,hostname),runtime:emptyRuntime()});
 const r=make('device-r1','router','R1',500,140),sw=make('device-sw1','switch','SW1',500,330),a=make('device-pc1','pc','PC1',300,530),b=make('device-pc2','pc','PC2',700,530);
 for(const[d,subnet]of [[a,10],[b,20]]as const){Object.assign(d.config.interfaces.GigabitEthernet0,{ip:`192.168.${subnet}.10`,mask:'255.255.255.0'});d.config.interfaces.GigabitEthernet0.features.dhcp=false;d.config.defaultGateway=`192.168.${subnet}.1`;}
 for(const d of [r,sw,a,b])d.startupConfig=structuredClone(d.config);
 const lab:CatalogLab={catalogId:'router-on-a-stick',id:'lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),name:'Router on a stick'+(mode==='completed'?' · Completed':''),devices:[r,sw,a,b],links:[
  {id:'link-uplink',a:{deviceId:r.id,port:'GigabitEthernet0/0'},b:{deviceId:sw.id,port:'GigabitEthernet0/1'},enabled:true,delay:.1,loss:0},
  {id:'link-vlan10',a:{deviceId:sw.id,port:'GigabitEthernet0/2'},b:{deviceId:a.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
  {id:'link-vlan20',a:{deviceId:sw.id,port:'GigabitEthernet0/3'},b:{deviceId:b.id,port:'GigabitEthernet0'},enabled:true,delay:.1,loss:0},
 ],notes:[{id:'note-vlan10',x:300,y:625,text:'VLAN 10 · SALES\nGateway 192.168.10.1'},{id:'note-vlan20',x:700,y:625,text:'VLAN 20 · ENGINEERING\nGateway 192.168.20.1'}],lesson:lesson()};
 const doc:LabDocument={format:'netsim-lab',version:1,seed:20261030,lab};
 if(mode==='practice')return doc;
 return completedDocument(doc,ROAS_COMMANDS);
}
export function createCatalogLab(id:string,mode:CatalogMode='practice'):LabDocument{
 if(id==='802-1q-trunking')return createDot1QTrunkingLab(mode);
 if(id==='poe-interface')return createPoEInterfaceLab(mode);
 if(id==='voice-vlan')return createVoiceVLANLab(mode);
 if(id==='vlan-and-access-ports')return createVLANAccessLab(mode);
 if(id==='layer-3-routed-interfaces')return createL3InterfaceLab(mode);
 if(id==='layer-2-switching-interfaces')return createL2InterfaceLab(mode);
 if(id==='dhcp-server-and-relay')return createDHCPRelayLab(mode);
 if(id==='ipv4-addressing-troubleshooting')return createIPv4TroubleshootingLab(mode);
 if(id==='ipv4-interface-configuration')return createIPv4InterfaceLab(mode);
 if(id==='router-on-a-stick')return createRouterOnAStickLab(mode);
 if(id==='datacenter-vpc'){const doc=parseDocument(JSON.stringify(datacenterExample));(doc.lab as CatalogLab).catalogId='datacenter-vpc';doc.lab.id='lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));return doc;}
 throw Error('This lab is not in the catalog.');
}
