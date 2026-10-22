import assert from 'node:assert/strict';
import {Simulator,type Frame} from '../../src/engine.ts';
import {defaultInterface,type Device} from '../../src/model.ts';
import {defaultVPC,nsosConfig} from '../../src/datacenter.ts';

export const ethernet=(n:number)=>'Ethernet1/'+n;
export const gigabit=(n:number)=>'GigabitEthernet0/'+n;
export function advanceSimulation(s:Simulator,ms:number):void {assert.equal(s.advance(ms,200000).targetReached,true);}
export function datacenterTraffic(s:Simulator,from:Device,to:Device,count:number,broadcast=false):number[]{
  const received=Array<number>(count).fill(0);
  const stop=s.registerUDPService(49123,d=>d.id===to.id,(_d,payload)=>{if(!broadcast)received[payload.sequence]++;return undefined;});
  const emit=s.emit;
  if(broadcast)s.emit=function(event){if(event.nodeId===to.id&&event.label==='Frame received'&&event.packet?.id.startsWith('vpc-packet-'))received[Number(event.packet.id.slice(11))]++;return emit.call(this,event);};
  for(let i=0;i<count;i++){
    const frame:Frame={id:'vpc-load-'+i,sourceMac:s.macOf(from.id,'GigabitEthernet0'),destinationMac:broadcast?'ff:ff:ff:ff:ff:ff':s.macOf(to.id,'GigabitEthernet0'),hops:64,
      payload:{id:'vpc-packet-'+i,source:from.config.interfaces.GigabitEthernet0.ip!,destination:to.config.interfaces.GigabitEthernet0.ip!,protocol:'udp',ttl:64,size:128,df:false,sourcePort:50000+i,destinationPort:49123,body:{kind:'udp-service-notification',payload:{sequence:i}}}};
    s.sendWirelessEthernet(from.id,'GigabitEthernet0',frame);
  }
  try{advanceSimulation(s,1000);}finally{stop();s.emit=emit;}return received;
}
export function configureChannel(d:Device,numbers:number[],group:number,id?:number,network=false):void {
  const name='Port-channel'+group,p=defaultInterface(name,true);
  Object.assign(p,{adminUp:true,mode:'trunk',allowedVlans:null});
  if(id)p.features.vpcId=id;
  if(network)p.features.stpPortType='network';
  d.config.interfaces[name]=p;
  for(const n of numbers){
    const port=d.config.interfaces[d.kind==='datacenter'?ethernet(n):gigabit(n)];
    Object.assign(port,{adminUp:true,switchport:true,mode:'trunk',allowedVlans:null});
    Object.assign(port.features,{channelGroup:group,channelMode:'active',lacpRate:'fast'});
  }
}
export function addDatacenterHost(s:Simulator,d:Device,port:string,address:string,vlan=20):Device {
  const h=s.addDevice('pc'),p=h.config.interfaces.GigabitEthernet0;
  delete p.features.dhcp;Object.assign(p,{ip:address,mask:'255.255.255.0'});
  const sw=d.config.interfaces[port];Object.assign(sw,{adminUp:true,mode:'access',vlan});
  sw.features.portfast=true;sw.features.stpPortType='edge';
  s.connect({deviceId:h.id,port:p.name},{deviceId:d.id,port});return h;
}
export function datacenterTopology(){
  const s=new Simulator(930042),a=s.addDevice('datacenter'),b=s.addDevice('datacenter'),access=s.addDevice('switch');
  for(const [d,priority,ip,destination]of [[a,100,'10.255.0.1','10.255.0.2'],[b,200,'10.255.0.2','10.255.0.1']]as const){
    const n=nsosConfig(d);n.enabled=['vpc','lacp','interface-vlan'];
    n.vpc={...defaultVPC(42),rolePriority:priority,peerLink:'Port-channel1',keepalive:{destination,source:ip,vrf:'management',interval:1000,timeout:5000,holdTimeout:3000}};
    Object.assign(d.config.interfaces.mgmt0,{ip,mask:'255.255.255.0',vrf:'management',adminUp:true});
    configureChannel(d,[29,30],1,undefined,true);configureChannel(d,[1],d===a?10:20,10);
    d.config.features.stp.mode='rapid-pvst';
    for(const vlan of[20,30])d.config.vlans[vlan]={id:vlan,name:'VLAN'+vlan,active:true};
    d.config.features.stp.vlanPriorities={1:4096,20:4096,30:4096};
  }
  configureChannel(access,[1,2],3);
  for(const vlan of[20,30])access.config.vlans[vlan]={id:vlan,name:'VLAN'+vlan,active:true};
  const peerLinks=[29,30].map(n=>s.connect({deviceId:a.id,port:ethernet(n)},{deviceId:b.id,port:ethernet(n)}));
  const keepalive=s.connect({deviceId:a.id,port:'mgmt0'},{deviceId:b.id,port:'mgmt0'});
  const legs=[s.connect({deviceId:a.id,port:ethernet(1)},{deviceId:access.id,port:gigabit(1)}),s.connect({deviceId:b.id,port:ethernet(1)},{deviceId:access.id,port:gigabit(2)})];
  const client=addDatacenterHost(s,access,gigabit(3),'192.0.2.10'),ha=addDatacenterHost(s,a,ethernet(2),'192.0.2.20'),hb=addDatacenterHost(s,b,ethernet(2),'192.0.2.30');
  s.changed();advanceSimulation(s,40000);return {s,a,b,access,peerLinks,keepalive,legs,client,ha,hb};
}
