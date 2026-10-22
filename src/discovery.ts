import {endpointProfile,endpointVoicePolicy,validVoicePolicy,switchVoiceVlan,type VoicePolicy} from './endpoint.ts';
import type { Device, Lab, Neighbor, NewSimEvent } from './model.ts';
import type { SimulationClock, TimerHandle } from './clock.ts';
import {platformIdentity,platformSoftware} from './platform-identity.ts';
import {bridgeMac} from './control-plane.ts';
import {nsosFeature} from './datacenter.ts';

export interface DiscoveryHost {
  lab: Lab;
  clock: SimulationClock;
  getDevice(id:string):Device|undefined;
  interfaceUp(id:string,port:string):boolean;
  notify():void;
  macOf?(deviceId:string,port:string):string;
  emit(event:NewSimEvent):unknown;
  sendLinkControl?(deviceId:string,port:string,message:{kind:'link-control';protocol:string;body:any}):void;
  ethernetState?(deviceId:string,port:string):{duplex:'half'|'full'}|undefined;
  log?(deviceId:string,message:string,severity?:number):void;
  endpointPolicyChanged?(deviceId:string):void;
}
type Protocol='CDP'|'LLDP';
type RecordRow=Neighbor & {expires:number;lastReceived:number;holdtime:number;hostname:string;platform:string;software?:string;capabilities:string[];description:string;duplex?:'half'|'full';medCapabilities?:boolean;voicePolicy?:VoicePolicy};
type Advertisement={runtime:Device['runtime'];signature:string;timer?:TimerHandle};
const sessions=new WeakMap<DiscoveryHost,Map<string,Advertisement>>();
const protocols:Protocol[]=['CDP','LLDP'];
const physical=(name:string)=>!(/^(Vlan|Loopback|Tunnel|Port-channel|Null|Wireless)/i.test(name)||name.includes('.'));
function enabled(d:Device,p:string,protocol:Protocol,direction:'send'|'receive'):boolean {
  const phone=(d.kind==='pc'||d.kind==='phone')&&endpointProfile(d).role==='phone';
  if(d.kind==='phone'&&p!=='Network')return false;
  if(!d.powered||['pc','server','laptop'].includes(d.kind)&&!phone||!d.config.interfaces[p]?.adminUp)return false;
  if(protocol==='CDP')return d.config.features.cdp!==false&&d.config.interfaces[p].features.cdp!==false;
  if(d.kind==='datacenter'&&!nsosFeature(d,'lldp'))return false;
  return (phone?d.config.features.lldp!==false:!!d.config.features.lldp)&&d.config.interfaces[p].features[direction==='send'?'lldpTransmit':'lldpReceive']!==false;
}
function configuration(d:Device,protocol:Protocol):{interval:number;holdtime:number}{
  const c=d.config.features.discovery?.[protocol.toLowerCase()]||{};
  return {interval:Math.max(1,Number(c.interval)||(protocol==='CDP'?60:30)),holdtime:Math.max(1,Number(c.holdtime)||(protocol==='CDP'?180:120))};
}
function table(d:Device):Record<string,RecordRow>{return d.runtime.features.discoveryNeighbors??={};}
function publish(d:Device):void {
  d.runtime.neighbors=d.runtime.neighbors.filter(n=>!protocols.includes(n.protocol as Protocol));
  d.runtime.neighbors.push(...Object.values(table(d)).map(n=>({...n})));
}
function advertisedVoice(d:Device,port:string,protocol:Protocol,now:number):VoicePolicy|undefined {
 const p=d.config.interfaces[port];if(!p.switchport||p.mode==='trunk'||d.runtime.features.trunks?.[port]?.operational)return;
 if(protocol==='CDP'){const vlan=switchVoiceVlan(d,p);return vlan!==undefined&&(typeof vlan==='number'||['dot1p','untagged','none'].includes(vlan))?{vlan,cos:5}:undefined;}
 if(p.features.lldpMedNetworkPolicy===false||!Object.values(table(d)).some(row=>row.interface===port&&row.protocol==='LLDP'&&row.medCapabilities&&row.expires>now))return;
 const profile=d.config.features.networkPolicies?.[p.features.networkPolicy];return validVoicePolicy(profile?.voice)?{...profile.voice,dscp:profile.voice.dscp??46}:undefined;
}
function refreshVoice(engine:DiscoveryHost,d:Device):void {
 if(!['pc','phone'].includes(d.kind)||endpointProfile(d).role!=='phone')return;
 const policy=endpointVoicePolicy(d,engine.clock.now()),signature=JSON.stringify(policy?[policy.protocol,policy.vlan,policy.cos,policy.dscp]:null),previous=d.runtime.features.endpointVoiceSignature;d.runtime.features.endpointVoiceSignature=signature;
 if(previous===signature||previous===undefined&&!policy)return;
 engine.emit({nodeId:d.id,protocol:policy?.protocol??'SYSTEM',label:policy?'Phone voice policy learned':'Phone voice policy expired',detail:policy?`Received ${policy.protocol} voice VLAN ${policy.vlan}, CoS ${policy.cos}${policy.dscp!==undefined?', DSCP '+policy.dscp:''}.`:'No current received voice policy; endpoint uses untagged traffic.',disposition:'info'});engine.endpointPolicyChanged?.(d.id);
}
/** Advertised TLVs are snapshots of this device, never a query of a peer. */
function identity(engine:DiscoveryHost,d:Device,port:string,protocol:Protocol){
 const p=d.config.interfaces[port],phone=(d.kind==='pc'||d.kind==='phone')&&endpointProfile(d).role==='phone';
 const management=Object.values(d.config.interfaces).find(i=>i.name==='mgmt0'&&i.ip)||Object.values(d.config.interfaces).find(i=>/^Vlan/.test(i.name)&&i.ip)||Object.values(d.config.interfaces).find(i=>i.ip);
 const local6=p.ipv6.map(a=>a.split('/')[0]),ll=d.runtime.features.linkLocalAddresses?.[port];
 const mgmt=protocol==='LLDP'?(p.ip?p:management):p.ip?p:management&&engine.interfaceUp(d.id,management.name)?management:undefined;
 const managementAddresses=mgmt?[...(mgmt.ip?[mgmt.ip]:[]),...mgmt.ipv6.map(a=>a.split('/')[0])]:[];
 const capabilities=phone?['telephone','station']:d.kind==='router'?['router']:['l3switch','datacenter'].includes(d.kind)?['router','bridge']:['bridge'];
 const enabledCapabilities=capabilities.filter(c=>c!=='router'||d.config.ipRouting||d.config.ipv6Routing);
 return {address:p.ip||local6[0],addresses:[...(p.ip?[p.ip]:[]),...local6,...(protocol==='CDP'&&ll?[ll]:[])],managementAddresses,
   chassisMac:(bridgeMac(d).match(/.{2}/g)??[]).join(':'),portMac:engine.macOf?.(d.id,port),capabilities,enabledCapabilities,
   ...(protocol==='CDP'&&p.switchport?{nativeVlan:p.mode==='trunk'||d.runtime.features.trunks?.[port]?.operational?p.nativeVlan:p.vlan,...d.kind!=='datacenter'?{vtpDomain:String(d.config.features.vtp?.domain??'')}:{}}:{})};
}
function advertise(engine:DiscoveryHost,d:Device,port:string,protocol:Protocol):void {
 if(!enabled(d,port,protocol,'send')||!engine.interfaceUp(d.id,port))return;
 const p=d.config.interfaces[port],cfg=configuration(d,protocol),phone=(d.kind==='pc'||d.kind==='phone')&&endpointProfile(d).role==='phone',voicePolicy=advertisedVoice(d,port,protocol,engine.clock.now()),medCapabilities=protocol==='LLDP'&&(phone||Object.values(table(d)).some(row=>row.interface===port&&row.protocol==='LLDP'&&row.medCapabilities&&row.expires>engine.clock.now()));
 const kind=phone?'phone':d.kind;
 engine.sendLinkControl?.(d.id,port,{kind:'link-control',protocol,body:{deviceId:d.id,port,hostname:d.config.hostname,...identity(engine,d,port,protocol),platform:'NetSim '+platformIdentity(kind).model,software:platformSoftware(kind),description:p.description||'',holdtime:cfg.holdtime,...(protocol==='CDP'?{duplex:engine.ethernetState?.(d.id,port)?.duplex}: {}),...medCapabilities?{medCapabilities:true}:{},...voicePolicy?{voicePolicy}:{} }});
  const traffic=(d.runtime.features.discoveryTraffic??={})[protocol]??={out:0,in:0,aged:0};traffic.out++;
 }

/** Per-physical-link advertisements. Timing and directional packet loss determine discovery. */
export function syncDiscovery(engine:DiscoveryHost):void {
  let state=sessions.get(engine);if(!state){state=new Map();sessions.set(engine,state);}const retained=new Set<string>();
  for(const d of engine.lab.devices){
    for(const [key,row]of Object.entries(table(d)))if(!enabled(d,row.interface,row.protocol as Protocol,'receive')||!engine.interfaceUp(d.id,row.interface)||row.expires<=engine.clock.now())delete table(d)[key];
    for(const port of Object.keys(d.config.interfaces).filter(physical))for(const protocol of protocols){
      const key=`${d.id}|${port}|${protocol}`,old=state.get(key),active=enabled(d,port,protocol,'send')&&engine.interfaceUp(d.id,port);
      if(!active){if(old)engine.clock.cancel(old.timer);state.delete(key);continue;}retained.add(key);
      const p=d.config.interfaces[port],cfg=configuration(d,protocol),signature=JSON.stringify([cfg,d.config.hostname,identity(engine,d,port,protocol),p.description,engine.ethernetState?.(d.id,port)?.duplex,endpointProfile(d),p.features.voiceVlan,p.features.networkPolicy,p.features.lldpMedNetworkPolicy,d.config.features.networkPolicies,Object.values(table(d)).some(row=>row.interface===port&&row.protocol==='LLDP'&&row.medCapabilities)]);
      if(old?.runtime===d.runtime&&old.signature===signature)continue;
      if(old)engine.clock.cancel(old.timer);const record:Advertisement={runtime:d.runtime,signature};state.set(key,record);
      record.timer=engine.clock.schedule(1,()=>{if(state!.get(key)!==record||record.runtime!==d.runtime)return;advertise(engine,d,port,protocol);},{owner:d.id,repeat:cfg.interval*1000,label:`${protocol} advertisement ${port}`});
    }
    publish(d);refreshVoice(engine,d);
  }
  for(const[key,record]of state)if(!retained.has(key)){engine.clock.cancel(record.timer);state.delete(key);}
}

export function receiveDiscoveryControl(engine:DiscoveryHost,deviceId:string,port:string,message:{protocol:string;body:any}):boolean {
  if(!protocols.includes(message.protocol as Protocol))return false;
  const protocol=message.protocol as Protocol,d=engine.getDevice(deviceId),b=message.body;
  if(!d||!enabled(d,port,protocol,'receive')||!engine.interfaceUp(deviceId,port)||!b||typeof b.deviceId!=='string'||typeof b.port!=='string'||!Number.isFinite(b.holdtime))return true;
  const key=`${protocol}|${port}|${b.deviceId}|${b.port}`,cache=table(d),previous=cache[key];
  ((d.runtime.features.discoveryTraffic??={})[protocol]??={out:0,in:0,aged:0}).in++;
  if(b.holdtime<=0){delete cache[key];publish(d);refreshVoice(engine,d);syncDiscovery(engine);engine.notify();return true;}
  const holdtime=Math.min(65535,Math.max(1,b.holdtime)),row:RecordRow={protocol,deviceId:b.deviceId,interface:port,peerInterface:b.port,address:typeof b.address==='string'?b.address:undefined,state:'UP',expires:engine.clock.now()+holdtime*1000,lastReceived:engine.clock.now(),holdtime,hostname:String(b.hostname||b.deviceId),platform:String(b.platform||'unknown'),capabilities:Array.isArray(b.capabilities)?b.capabilities.map(String):[],description:String(b.description||''),...protocol==='LLDP'&&b.medCapabilities===true?{medCapabilities:true}:{},...validVoicePolicy(b.voicePolicy)?{voicePolicy:structuredClone(b.voicePolicy)}:{}};
  if(Array.isArray(b.addresses))row.addresses=[...new Set(b.addresses.filter((a:unknown)=>typeof a==='string'))];
  if(typeof b.chassisMac==='string'&&/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(b.chassisMac))row.chassisMac=b.chassisMac;
  for(const key of ['managementAddresses','enabledCapabilities'])if(Array.isArray(b[key]))row[key]=b[key].filter((v:unknown)=>typeof v==='string');
  if(typeof b.portMac==='string'&&/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(b.portMac))row.portMac=b.portMac;
  if(Number.isInteger(b.nativeVlan)&&b.nativeVlan>=1&&b.nativeVlan<=4094)row.nativeVlan=b.nativeVlan;
  if(typeof b.vtpDomain==='string')row.vtpDomain=b.vtpDomain;
  if(typeof b.software==='string')row.software=b.software;
  if(protocol==='CDP'&&['half','full'].includes(b.duplex)){
    row.duplex=b.duplex;const local=engine.ethernetState?.(deviceId,port)?.duplex,warnings=d.runtime.features.cdpDuplexWarnings??={};
    if(local&&local!==row.duplex){const signature=local+'/'+row.duplex;if(warnings[key]!==signature){warnings[key]=signature;const message=`%CDP-4-DUPLEX_MISMATCH: duplex mismatch discovered on ${port} (${local} duplex), with ${row.hostname} ${row.peerInterface} (${row.duplex} duplex).`;engine.log?.(deviceId,message,4);engine.emit({nodeId:deviceId,port,protocol:'CDP',label:'Duplex mismatch discovered',detail:message,disposition:'warning'});}}
    else delete warnings[key];
  }
  cache[key]=row;publish(d);refreshVoice(engine,d);if(protocol==='LLDP'&&previous?.medCapabilities!==row.medCapabilities)syncDiscovery(engine);
  if(!previous)engine.emit({nodeId:d.id,protocol,label:'Neighbor discovered',detail:`${row.hostname} ${row.peerInterface} on ${port}`,disposition:'info'});
  engine.clock.schedule(holdtime*1000,()=>{if(d.runtime.features.discoveryNeighbors!==cache||cache[key]!==row)return;delete cache[key];((d.runtime.features.discoveryTraffic??={})[protocol]??={out:0,in:0,aged:0}).aged++;publish(d);refreshVoice(engine,d);syncDiscovery(engine);engine.emit({nodeId:d.id,protocol,label:'Neighbor expired',detail:`No advertisement from ${row.hostname} within ${holdtime} seconds.`,disposition:'info'});engine.notify();},{owner:d.id,label:`${protocol} neighbor expiry`});
  engine.notify();return true;
}
