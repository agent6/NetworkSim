import type { Simulator } from './engine.ts';
import type { Device, InterfaceConfig } from './model.ts';
import {endpointPowerProfile,endpointUsesPoE,endpointNetworkPort} from './endpoint.ts';

export interface PoEPower {source:'poe';available:boolean;watts:number;reason:string;switchId?:string;port?:string;standard?:'802.3af'|'802.3at';class?:3|4;spatialStreams?:2|4;usb?:boolean}
export interface PoEPort {port:string;admin:'auto'|'never';priority:'high'|'low';state:'on'|'off'|'denied'|'fault';watts:number;maximum:number;deviceId?:string;reason:string;standard?:'802.3af'|'802.3at';class?:3|4}
export const AP_POE_ALLOCATION=30;
export function poePort(port:string):boolean {const match=/^GigabitEthernet0\/(\d+)$/.exec(port);return !!match&&+match[1]>=1&&+match[1]<=24;}
export function poeSettings(p:InterfaceConfig):{mode:'auto'|'never';max:number;priority:'high'|'low'}{return {...(p.features.powerInline??{mode:'auto',max:30000}),priority:p.features.powerPriority??'low'};}

/** Electrical supply is independent of STP, VLANs and Ethernet protocol delivery.
 * C9115 full-feature profile reserves30W at PSE (802.3at class4); an explicitly
 * limited port supplies15.4W (802.3af class3), reducing both radios to2x2.
 * High-priority ports survive shedding first; equal-priority detection uses
 * first-come order, with port number as a deterministic simultaneous tie. */
export function recomputePoE(e:Simulator):void {
 const supplies=new Map<string,PoEPower>();
 for(const ap of e.lab.devices.filter(d=>d.kind==='ap'||d.kind==='phone'))ap.config.features.powerSource='poe';
 for(const sw of e.lab.devices.filter(d=>d.kind==='poeswitch')){
  const budget=sw.config.features.poe?.budget??370,ports:PoEPort[]=[],detections=sw.runtime.features.poeDetections??={};let used=0;
  const names=Object.keys(sw.config.interfaces).filter(poePort).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  for(const port of names){const link=e.lab.links.find(l=>l.a.deviceId===sw.id&&l.a.port===port||l.b.deviceId===sw.id&&l.b.port===port),endpoint=link&&(link.a.deviceId===sw.id?link.b:link.a),pd=endpoint&&e.getDevice(endpoint.deviceId),detected=sw.powered&&link?.enabled&&!!pd&&(pd.kind==='ap'||endpointUsesPoE(pd))&&endpoint?.port===endpointNetworkPort(pd!)&&sw.config.interfaces[port].adminUp&&poeSettings(sw.config.interfaces[port]).mode==='auto';if(!detected)delete detections[port];else if(detections[port]?.deviceId!==pd!.id)detections[port]={deviceId:pd!.id,order:sw.runtime.features.poeDetectionSequence=(sw.runtime.features.poeDetectionSequence??0)+1};}
  const allocation=[...names].sort((a,b)=>Number(poeSettings(sw.config.interfaces[b]).priority==='high')-Number(poeSettings(sw.config.interfaces[a]).priority==='high')||(detections[a]?.order??Infinity)-(detections[b]?.order??Infinity)||a.localeCompare(b,undefined,{numeric:true}));
  for(const port of allocation){
   const setting=poeSettings(sw.config.interfaces[port]),link=e.lab.links.find(l=>l.a.deviceId===sw.id&&l.a.port===port||l.b.deviceId===sw.id&&l.b.port===port),endpoint=link&&(link.a.deviceId===sw.id?link.b:link.a),pd=endpoint&&e.getDevice(endpoint.deviceId);
   const row:PoEPort={port,admin:setting.mode,priority:setting.priority,state:'off',watts:0,maximum:setting.max/1000,deviceId:pd&&(pd.kind==='ap'||endpointUsesPoE(pd))?pd.id:undefined,reason:'No powered device detected'};
   if(pd&&(pd.kind==='ap'||endpointUsesPoE(pd))&&endpoint?.port===endpointNetworkPort(pd!)){
    const endpointProfile=endpointPowerProfile(pd),reduced=pd.kind==='ap'&&setting.max<30000,allocation=endpointProfile?.watts??(reduced?15.4:AP_POE_ALLOCATION);row.standard=endpointProfile?.standard??(reduced?'802.3af':'802.3at');row.class=endpointProfile?.class??(reduced?3:4);
    let reason='';if(!sw.powered)reason='PoE switch is powered off';else if(!link?.enabled)reason='Physical cable is disabled';else if(!sw.config.interfaces[port].adminUp)reason='PoE switch port is administratively shut down';else if(link.physical&&(link.physical.medium.startsWith('fiber')||['open','short'].includes(link.physical.fault)||link.physical.length>100))reason='Physical cable cannot deliver PoE: fiber, open/short fault or copper length exceeds100m';else if(setting.mode==='never')reason='Inline power is administratively disabled';else if(setting.max<15400)reason='Port limit cannot supply the minimum 15.4 W 802.3af powered-device allocation';else if(Math.round(used*1000)+Math.round(allocation*1000)>Math.floor(budget*1000))reason='Insufficient switch PoE budget';
    if(!reason){row.state='on';row.watts=allocation;used=Math.round((used+row.watts)*1000)/1000;row.reason=endpointProfile?'802.3af class 3 endpoint allocation granted':reduced?'802.3af class 3 allocation granted; 2x2 radios, USB disabled':'802.3at class 4 allocation granted; 4x4 radios';}else{row.state=link?.physical?.fault==='short'?'fault':/limit|budget/.test(reason)?'denied':'off';row.reason=reason;}
    supplies.set(pd.id,{source:'poe',available:row.state==='on',watts:row.watts,reason:row.reason,switchId:sw.id,port,standard:row.standard,class:row.class,...pd.kind==='ap'?{spatialStreams:reduced?2 as const:4 as const,usb:!reduced}:{}});
   }
   ports.push(row);
  }
  ports.sort((a,b)=>a.port.localeCompare(b.port,undefined,{numeric:true}));sw.runtime.features.poe={budget,used,remaining:Math.max(0,Math.round((budget-used)*1000)/1000),ports};
 }
 for(const ap of e.lab.devices.filter(d=>d.kind==='ap'||endpointUsesPoE(d))){
  const supply=supplies.get(ap.id)??{source:'poe' as const,available:false,watts:0,reason:'Connect the uplink to an enabled PoE switch port'};
  e.applyPoEPower(ap.id,supply);
 }
}

export function powerInlineOutput(e:Simulator,d:Device,port?:string,priority=false,detail=false):string[]{
 const state=d.runtime.features.poe??{budget:d.config.features.poe?.budget??370,used:0,remaining:d.config.features.poe?.budget??370,ports:[]};
 if(priority)return ['Interface               Admin  Oper       Admin Priority',...state.ports.filter((p:PoEPort)=>!port||p.port===port).map((p:PoEPort)=>`${p.port.padEnd(24)}${p.admin.padEnd(7)}${p.state.padEnd(11)}${p.priority}`)];
 if(detail)return state.ports.filter((p:PoEPort)=>!port||p.port===port).flatMap((p:PoEPort)=>[`Interface: ${p.port}`,`Inline Power Mode: ${p.admin}`,`Operational state: ${p.state}`,`Admin Priority: ${p.priority}`,`Power allocated: ${p.watts.toFixed(1)} W; Maximum: ${p.maximum.toFixed(1)} W`,`Device class: ${p.deviceId?String(p.class??4):'n/a'}`,`Reason: ${p.reason}`, '']);
 return [...port?[]:[`Available:${state.budget.toFixed(1)}(w)  Used:${state.used.toFixed(1)}(w)  Remaining:${state.remaining.toFixed(1)}(w)`,''], 'Interface               Admin  Oper       Power   Device                 Class Max',...state.ports.filter((p:PoEPort)=>!port||p.port===port).map((p:PoEPort)=>`${p.port.padEnd(24)}${p.admin.padEnd(7)}${p.state.padEnd(11)}${p.watts.toFixed(1).padEnd(8)}${(p.deviceId?(e.getDevice(p.deviceId)?.config.hostname??'AP'):'n/a').padEnd(23)}${(p.state==='on'?String(p.class??4):'n/a').padEnd(6)}${p.maximum.toFixed(1)}`)];
}

export function validatePoE(kind:string,config:{features:Record<string,any>;interfaces:Record<string,InterfaceConfig>}):void {
 if(kind==='poeswitch'&&(!config.features.poe||!Number.isFinite(config.features.poe.budget)||config.features.poe.budget<0||config.features.poe.budget>740))throw Error('Invalid PoE power budget.');
 if(kind==='ap'&&config.features.powerSource!==undefined&&!['auto','external','poe'].includes(config.features.powerSource))throw Error('Invalid AP power source.');
 // Older labs may contain local-adapter selection. Preserve the topology while
 // upgrading every AP to the current PoE-only power model.
 if(kind==='ap')config.features.powerSource='poe';
 for(const p of Object.values(config.interfaces)){const s=p.features.powerInline;if(s&&(!['auto','never'].includes(s.mode)||!Number.isInteger(s.max)||s.max<4000||s.max>30000))throw Error('Invalid inline power configuration.');if(p.features.powerPriority!==undefined&&!['high','low'].includes(p.features.powerPriority))throw Error('Invalid inline power priority.');}
}
