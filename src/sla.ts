import type { Device } from './model.ts';
import type { Simulator, ServiceResult } from './engine.ts';

/** Original scheduled probes over real simulated transports. No topology shortcuts. */
export class SLAController {
  private ports=new Set<number>();
  private engine:Simulator;
  constructor(engine:Simulator){
    this.engine=engine;
    engine.registerUDPService(1967,d=>!!d.config.features.ipSlaResponder?.enabled,(d,p,source)=>{
      if(p?.application!=='sla-control'||!Number.isInteger(p.port)||p.port<1||p.port>65535)return {accepted:false};
      this.listen(p.port);(d.runtime.features.slaResponderWindows??={})[`${source}:${p.port}`]=engine.clock.now()+Math.min(600000,Math.max(1000,Number(p.duration)||10000));return {accepted:true};
    });
  }
  sync():void{for(const d of this.engine.lab.devices)for(const entry of d.config.features.ipSlaResponder?.ports||[])this.listen(entry.port);}
  private listen(port:number):void{if(this.ports.has(port))return;this.ports.add(port);this.engine.registerUDPService(port,d=>!!d.config.features.ipSlaResponder?.ports?.some((x:any)=>x.port===port)||Object.entries<number>(d.runtime.features.slaResponderWindows||{}).some(([key,expires])=>key.endsWith(':'+port)&&expires>this.engine.clock.now()),(d,p,source)=>{const configured=d.config.features.ipSlaResponder?.ports?.some((x:any)=>x.port===port&&(!x.address||x.address===p?.target)),temporary=d.runtime.features.slaResponderWindows?.[`${source}:${port}`]>this.engine.clock.now();if(p?.application!=='sla-echo'||!configured&&!temporary)return {accepted:false};(d.runtime.features.slaResponderCounters??={})[port]=(d.runtime.features.slaResponderCounters?.[port]||0)+1;return {accepted:true,sequence:p.sequence};});}
  run(device:Device,id:string,probe:any,owner:string):void{
    const engine=this.engine,previous=device.runtime.features.ipSla?.[id];if(previous?.pending)return;
    const started=engine.clock.now(),timeout=Math.max(1,probe.timeout??5000),runtime=device.runtime;
    const state:any={lastRun:started,success:previous?.success??false,rtt:previous?.rtt,returnCode:previous?.returnCode||'Pending',pending:true,runs:(previous?.runs||0)+1,successes:previous?.successes||0,failures:previous?.failures||0};
    (runtime.features.ipSla??={})[id]=state;let finished=false;
    const finish=(times:number[],sent:number,error?:string)=>{if(finished||device.runtime!==runtime)return;finished=true;const rtt=times.length?times.reduce((a,b)=>a+b,0)/times.length:undefined;Object.assign(state,{pending:false,success:times.length>0,rtt,packetsSent:sent,packetsReceived:times.length,returnCode:times.length?(rtt!>(probe.threshold??5000)?'Over threshold':'OK'):error||'Timeout'});if(times.length)state.successes++;else state.failures++;if(probe.type==='udp-jitter')state.jitter=times.length>1?times.slice(1).reduce((sum,time,i)=>sum+Math.abs(time-times[i]),0)/(times.length-1):0;engine.recompute();engine.notify();};
    const watch=(result:ServiceResult,deadline:number,callback:(result:ServiceResult)=>void)=>{const poll=()=>{if(device.runtime!==runtime||!device.powered||finished)return;if(result.status!=='running'||engine.clock.now()>=deadline)callback(result);else engine.clock.schedule(Math.min(10,deadline-engine.clock.now()),poll,{owner,label:`IP SLA ${id} response`});};poll();};
    if(probe.type==='http'){
      const result=engine.httpRequest(device.id,probe.url,{source:probe.source});watch(result,started+timeout,r=>finish(r.status==='success'?[engine.clock.now()-started]:[],1,r.status==='failure'?r.error:undefined));return;
    }
    if(probe.type==='udp-jitter'){
      const count=probe.numPackets??10,interval=probe.interval??20,times:number[]=[];let complete=0,sent=0;
      const train=()=>{for(let i=0;i<count;i++)engine.clock.schedule(i*interval,()=>{if(finished||device.runtime!==runtime||!device.powered)return;const time=engine.clock.now();sent++;const result=engine.udpRequest(device.id,probe.target,probe.port,{application:'sla-echo',sequence:i,target:probe.target},{source:probe.source,...(probe.sourcePort?{sourcePort:probe.sourcePort}:{})});watch(result,time+timeout,r=>{if(r.status==='success'&&r.accepted&&r.sequence===i)times.push(engine.clock.now()-time);if(++complete===count)finish(times,sent);});},{owner,label:`IP SLA ${id} UDP probe`});};
      if(probe.control===false)train();else {const control=engine.udpRequest(device.id,probe.target,1967,{application:'sla-control',port:probe.port,duration:timeout+count*interval+1000},{source:probe.source});watch(control,started+timeout,r=>{if(r.status==='success'&&r.accepted)train();else finish([],0,'Responder unavailable');});}return;
    }
    const source=probe.source&&device.config.interfaces[probe.source]?device.config.interfaces[probe.source].ip:probe.source,result=engine.ping(device.id,probe.target,{count:1,source,timeout});
    const poll=()=>{if(device.runtime!==runtime||finished)return;if(result.status!=='running'||engine.clock.now()>=started+timeout+100)finish(result.replies.filter(x=>!x.error).map(x=>x.time??0),1);else engine.clock.schedule(10,poll,{owner,label:`IP SLA ${id} echo result`});};poll();
  }
}
