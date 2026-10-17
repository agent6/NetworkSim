import type { Device } from './model.ts';
import {ownRecordValue,setRecordValue} from './record-map.ts';

/** Device-local teaching storage; independent of the browser's own disk quota. */
export function fileSystemStats(device:Device):{capacity:number;used:number;free:number}{
  const configured=device.config.features.fileSystem?.capacityBytes;
  const capacity=Number.isSafeInteger(configured)&&configured>=0?configured:16*1024*1024;
  const used=Object.values<string>(device.config.features.files||{}).reduce((sum,text)=>sum+new TextEncoder().encode(text).byteLength,0);
  return {capacity,used,free:Math.max(0,capacity-used)};
}
export function writeFlashFile(device:Device,name:string,content:string):void{
  if(!name||/[\u0000-\u001f]/.test(name))throw new Error('Invalid simulated flash filename.');
  const files=device.config.features.files||{},stats=fileSystemStats(device),previous=ownRecordValue(files,name),oldBytes=typeof previous==='string'?new TextEncoder().encode(previous).byteLength:0,bytes=new TextEncoder().encode(content).byteLength;
  if(stats.used-oldBytes+bytes>stats.capacity)throw new Error(`Insufficient simulated flash space: ${bytes} bytes required, ${stats.free+oldBytes} available.`);
  device.config.features.files??={};setRecordValue(device.config.features.files,name,content);
}
