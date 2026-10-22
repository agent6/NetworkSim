import type {Device, PortCounters} from './model.ts';

/** Bounded, one-second buckets of frames actually counted by the packet engine. */
export function recordInterfaceSample(c:PortCounters,now:number,direction:'rx'|'tx',bytes:number):void{
  const at=Math.floor(now/1000)*1000,samples=c.rateSamples??=[];
  let sample=samples.at(-1);
  if(!sample||sample.at!==at){
    sample={at,rx:0,tx:0,rxBytes:0,txBytes:0};samples.push(sample);
    while(samples.length&&samples[0].at<at-300000)samples.shift();
  }
  sample[direction]++;sample[direction==='rx'?'rxBytes':'txBytes']+=bytes;
}

/** Read-only rolling average; no synthetic CPU work or clock advancement. */
export function interfaceRates(device:Device,port:string,now:number){
  const cleared=device.runtime.features.countersClearedAt?.[port];
  const since=cleared??device.runtime.features.bootTime??0;
  const seconds=Math.min(300,Math.max(1,(now-since)/1000));
  const total={rx:0,tx:0,rxBytes:0,txBytes:0};
  for(const sample of device.runtime.counters[port]?.rateSamples??[])if(sample.at>now-300000)
    for(const key of ['rx','tx','rxBytes','txBytes'] as const)total[key]+=sample[key];
  return {inputBits:Math.floor(total.rxBytes*8/seconds),outputBits:Math.floor(total.txBytes*8/seconds),
    inputPackets:Math.floor(total.rx/seconds),outputPackets:Math.floor(total.tx/seconds)};
}

export function clearInterfaceCounters(device:Device,now:number,port?:string):void{
  const cleared=device.runtime.features.countersClearedAt??={};
  for(const name of port?[port]:Object.keys(device.config.interfaces)){delete device.runtime.counters[name];cleared[name]=now;}
}
