import type {Device} from './model.ts';
const scoped = new WeakMap<Device, {base:Device;vrf:string}>();
/** A process view shares the real runtime and interfaces, but selects one local VRF's IGP settings. */
export function routingDevice(device:Device,vrf?:string):Device {
  const previous=scoped.get(device),base=previous?.base??device;if(!vrf)return base;
  if(previous?.vrf===vrf)return device;
  const protocols={...base.config.protocols};
  for(const name of ['eigrp','eigrp6','rip','ripng','ospf','ospfv3','ospfv3ipv4']){const child=base.config.protocols[name]?.vrfs?.[vrf];if(child)protocols[name]=child;else delete protocols[name];}
  const view={...base,config:{...base.config,protocols}};scoped.set(view,{base,vrf});return view;
}
export function routingConfig(device:Device,protocol:string,vrf?:string):any {
  if(vrf)return routingDevice(device,vrf).config.protocols[protocol];
  return device.config.protocols[protocol];
}
