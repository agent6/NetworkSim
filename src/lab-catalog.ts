import datacenterExample from '../examples/datacenter-vpc.netsim.json' with {type:'json'};
import {Simulator} from './engine.ts';
import {parseDocument} from './persistence.ts';
import {IOSSession} from './cli.ts';
import {iosRejected} from './ios-help.ts';
import {factoryDeviceConfig,emptyRuntime,type Device,type LabDocument} from './model.ts';
import {type GuidedLab,type Lesson} from './lessons.ts';

export const LAB_GROUPS=['CCNA','CCNP ENCOR','CCNP ENARSI','Other'] as const;
export type LabGroup=typeof LAB_GROUPS[number];
export type CatalogLab=GuidedLab & {catalogId?:string};
export type CatalogMode='practice'|'completed';
export const LAB_CATALOG=[
 {id:'router-on-a-stick',group:'CCNA' as LabGroup,title:'Router on a stick',description:'Route between two VLANs over one 802.1Q trunk. Configure access ports, router subinterfaces and default gateways.',devices:4,links:3,practice:true},
 {id:'datacenter-vpc',group:'Other' as LabGroup,title:'Datacenter Switch vPC',description:'Explore the existing NX-OS-style vPC pair and its downstream port-channel.',devices:datacenterExample.lab.devices.length,links:datacenterExample.lab.links.length,practice:false},
] as const;
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
const lesson=():Lesson=>({
 title:'Router on a stick',
 description:'PC1 and PC2 already have static IPv4 addresses and default gateways. Configure R1 and SW1 through their consoles to route between VLANs 10 and 20.\n\nCabling: R1 Gi0/0 ↔ SW1 Gi0/1; PC1 Gi0 ↔ SW1 Gi0/2; PC2 Gi0 ↔ SW1 Gi0/3.\n\nKeep the router physical interface unnumbered. Use 802.1Q tags 10 and 20 on its subinterfaces. The reference uses PortFast trunk on the router-facing switch link. Save the device configurations after verification.\n\nVerification: show vlan brief; show interfaces trunk; show ip interface brief; show ip route. From PC1, ping 192.168.20.10. From PC2, ping 192.168.10.10.',
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
 const sim=new Simulator(doc.seed);sim.load(doc);
 for(const[name,commands]of Object.entries(ROAS_COMMANDS)){const d=sim.getDevice(name)!,cli=new IOSSession(sim,d.id);for(const command of commands){const output=cli.execute(command);if(output.some(iosRejected))throw Error(`Could not prepare ${name}: ${command}\n${output.join('\n')}`);}}
 return sim.serialize();
}
export function createCatalogLab(id:string,mode:CatalogMode='practice'):LabDocument{
 if(id==='router-on-a-stick')return createRouterOnAStickLab(mode);
 if(id==='datacenter-vpc'){const doc=parseDocument(JSON.stringify(datacenterExample));(doc.lab as CatalogLab).catalogId='datacenter-vpc';doc.lab.id='lab-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));return doc;}
 throw Error('This lab is not in the catalog.');
}
