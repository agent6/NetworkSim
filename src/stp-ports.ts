import type {Device, InterfaceConfig, StpPortState} from './model.ts';

export function stpRegion(d:Device):string {
  const m=d.config.features.stp?.mst;
  return JSON.stringify([m?.name??'',m?.revision??0,[...(m?.instances??[])].sort((a:{id:number},b:{id:number})=>a.id-b.id).map((i:{id:number;vlans:number[]})=>[i.id,[...i.vlans].sort((a,b)=>a-b)])]);
}

/** STP owns the aggregate. Physical forwarding and cable indicators use its state. */
export function stpPortName(device:Device, port:string):string {
  const group=device.config.interfaces[port]?.features.channelGroup;
  return group ? 'Port-channel'+group : port;
}

export function stpPortState(device:Device, port:string, vlan:number|string):StpPortState|undefined {
  return device.runtime.stp[String(vlan)]?.ports[stpPortName(device,port)];
}

export function stpInterfaces(device:Device):InterfaceConfig[] {
  return Object.values(device.config.interfaces).filter(p=>{
    if(!p.switchport||p.features.channelGroup||/^(Vlan|Loopback|Tunnel|Null)/i.test(p.name)||p.name.includes('.'))return false;
    return !/^Port-channel/i.test(p.name)||!!device.runtime.features.portChannels?.[p.name.slice(12)];
  });
}

export function stpMembers(device:Device, port:string):string[] {
  if(!/^Port-channel/i.test(port))return [port];
  return device.runtime.features.portChannels?.[port.slice(12)]?.activeMembers??[];
}

export function stpMemberActive(device:Device, port:string):boolean {
  const group=device.config.interfaces[port]?.features.channelGroup;
  if(!group)return true;
  const logical=device.config.interfaces['Port-channel'+group];
  return !!logical?.adminUp&&!logical.features.errDisabled&&!!device.runtime.features.portChannels?.[group]?.activeMembers.includes(port);
}

export function stpPortNumber(device:Device, port:string):number {
  return Object.keys(device.config.interfaces).indexOf(stpPortName(device,port))+1;
}

// Cisco's classic short-cost values for negotiated 10/100-Mb/s bundles.
// Long costs use the active bandwidth directly; no configured bandwidth override.
const shortCosts:readonly (readonly [number,number])[]=[
  [10,100],[20,56],[30,47],[40,41],[50,35],[60,30],[70,26],[80,23],
  [100,19],[200,12],[300,9],[400,8],[500,7],[600,6],[700,5],[800,5],[1000,4],
];
export function stpDefaultCost(speed:number, method:string|undefined):number {
  if(method==='long')return Math.max(1,Math.floor(20000000/Math.max(speed,1)));
  return shortCosts.find(([bandwidth])=>speed<=bandwidth)?.[1]??(speed<10000?3:speed===10000?2:1);
}
