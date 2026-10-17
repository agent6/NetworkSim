import type {DeviceConfig} from './model.ts';
import type {Frame} from './engine.ts';

export const PHONE_NETWORK_PORT='Network';
export const PHONE_PC_PORT='PC';
export interface PhoneIngress {local:boolean;forward?:string;drop?:string}

/** The PC bridge never adds a voice tag, rewrites a MAC, or routes a packet. */
export function phoneIngress(port:string,frame:Frame,voiceVlan:number|undefined,localMac:string):PhoneIngress {
  if(port===PHONE_PC_PORT)return frame.vlan===undefined
    ?{local:false,forward:PHONE_NETWORK_PORT}
    :{local:false,drop:'The PC port accepts untagged data only; tagged traffic cannot enter the voice VLAN.'};
  if(port!==PHONE_NETWORK_PORT)return{local:false,drop:'Unknown phone interface.'};
  if(frame.vlan!==undefined)return frame.vlan===voiceVlan
    ?{local:true}
    :{local:false,drop:'The received tag does not match the learned voice VLAN.'};
  const own=frame.destinationMac===localMac;
  return{local:voiceVlan===undefined||voiceVlan===0,...!own?{forward:PHONE_PC_PORT}:{},...own&&voiceVlan!==undefined&&voiceVlan!==0?{drop:'Untagged traffic cannot reach the phone voice interface while a tagged voice VLAN is active.'}:{}};
}

/** A phone always has exactly one powered uplink and one data-only PC port. */
export function validatePhone(kind:string,config:Pick<DeviceConfig,'interfaces'|'features'>):void {
  if(kind!=='phone')return;
  const ports=Object.keys(config.interfaces).sort();
  if(ports.length!==2||ports[0]!==PHONE_NETWORK_PORT||ports[1]!==PHONE_PC_PORT)throw Error('A VoIP phone requires exactly the Network uplink and PC passthrough ports.');
  if(config.features.powerSource!==undefined&&config.features.powerSource!=='poe')throw Error('A VoIP phone is powered only through its Network PoE uplink.');
  if(Object.values(config.interfaces).some(p=>p.switchport))throw Error('Phone ports cannot be configured as switchports.');
  const pc=config.interfaces.PC;
  const localAddressFeature=['secondaryIps','ipv6Enabled','ipv6LinkLocal','ipv6Eui64','ipv6General','dhcp','dhcpv6Client','ipv6Autoconfig','dhcpLease','dhcpv6Lease','slaacAddresses'].some(key=>{
    const value=pc.features[key];return !!value&&(typeof value!=='object'||Object.keys(value).length>0);
  });
  if(pc.ip||pc.mask||pc.ipv6.length||localAddressFeature)throw Error('The PC passthrough port cannot have a local IP address or DHCP client.');
  config.features.powerSource='poe';
}
