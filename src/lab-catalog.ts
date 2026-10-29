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
export interface CatalogGuideResources {
 columns:readonly string[];
 rows:readonly (readonly string[])[];
 commands:Readonly<Record<string,readonly string[]>>;
 verification:Readonly<Record<string,readonly string[]>>;
 note:string;
 setup?:readonly {title:string;instructions:readonly string[]}[];
}
const GUIDE_RESOURCES:Readonly<Record<string,CatalogGuideResources>>={
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
 if(id==='layer-3-routed-interfaces')return createL3InterfaceLab(mode);
 if(id==='layer-2-switching-interfaces')return createL2InterfaceLab(mode);
 if(id==='dhcp-server-and-relay')return createDHCPRelayLab(mode);
 if(id==='ipv4-addressing-troubleshooting')return createIPv4TroubleshootingLab(mode);
 if(id==='ipv4-interface-configuration')return createIPv4InterfaceLab(mode);
 if(id==='router-on-a-stick')return createRouterOnAStickLab(mode);
 if(id==='datacenter-vpc'){const doc=parseDocument(JSON.stringify(datacenterExample));(doc.lab as CatalogLab).catalogId='datacenter-vpc';doc.lab.id='lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));return doc;}
 throw Error('This lab is not in the catalog.');
}
