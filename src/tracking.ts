import type { Device } from './model.ts';
import type { SimulationClock, TimerHandle } from './clock.ts';
export interface TrackingHost {clock:SimulationClock;recompute():void;notify():void}
export interface TrackStatus {up:boolean;description:string;rawUp?:boolean;lastChange?:number;pending?:'up'|'down';pendingUntil?:number;error?:string;value?:number}
type State={up:boolean;changedAt:number;pendingUp?:boolean;pendingSince?:number;deadline?:number;timer?:TimerHandle};
type DeviceState={runtime:Device['runtime'];objects:Map<string,State>};
const tracked=new WeakMap<TrackingHost,Map<string,DeviceState>>();

/** Resolve list dependencies and debounce real leaf results using the simulated clock. */
export function settleTrackStates(engine:TrackingHost,device:Device,leaves:Record<string,TrackStatus>):Record<string,TrackStatus>{
  let machines=tracked.get(engine);if(!machines){machines=new Map();tracked.set(engine,machines);}let machine=machines.get(device.id);
  if(!machine||machine.runtime!==device.runtime){if(machine)for(const state of machine.objects.values())engine.clock.cancel(state.timer);machine={runtime:device.runtime,objects:new Map()};machines.set(device.id,machine);}
  const definitions=device.config.features.tracks||{},result:Record<string,TrackStatus>={},now=engine.clock.now(),visiting=new Set<string>();
  const evaluate=(id:string):TrackStatus=>{
    if(result[id])return result[id];
    if(visiting.has(id))return {up:false,description:`Track ${id}`,error:'Cyclic tracked-object dependency'};
    const config=definitions[id];if(!config)return {up:false,description:`Track ${id}`,error:'Referenced tracked object does not exist'};
    visiting.add(id);let raw:TrackStatus;
    if(config.type==='list'){
      const children=(config.objects||[]).map((object:any)=>({object,state:evaluate(String(object.id))})),error=children.find((x:any)=>x.state.error)?.state.error;
      const values=children.map((x:any)=>x.object.not?!x.state.up:x.state.up);
      if(config.thresholdType){const value=config.thresholdType==='percentage'?(values.length?Math.floor(100*values.filter(Boolean).length/values.length):0):children.reduce((sum:number,x:any)=>sum+(x.state.up?Number(x.object.weight??10):0),0),up=config.thresholds?.up??(config.thresholdType==='weight'?1:100),down=config.thresholds?.down??0;raw={up:!error&&values.length>0&&(value>=up||value>down&&!!machine!.objects.get(id)?.up),value,description:config.description||`Threshold ${config.thresholdType} list`,...(error?{error}:{})};}
      else raw={up:!error&&values.length>0&&(config.operator==='or'?values.some(Boolean):values.every(Boolean)),description:config.description||`Boolean ${String(config.operator||'and').toUpperCase()} list`,...(error?{error}:{})};
    }else raw=leaves[id]||{up:false,description:'Unresolved tracked object',error:'No leaf state was supplied'};
    visiting.delete(id);let state=machine!.objects.get(id);
    if(!state||state.changedAt>now){state={up:raw.error?false:raw.up&&!(config.delayUp>0),changedAt:now};machine!.objects.set(id,state);}
    const clear=()=>{engine.clock.cancel(state!.timer);delete state!.timer;delete state!.pendingUp;delete state!.pendingSince;delete state!.deadline;};
    if(raw.error){if(state.up)state.changedAt=now;state.up=false;clear();}
    else if(raw.up===state.up)clear();
    else{
      const delay=Math.max(0,Number(raw.up?config.delayUp:config.delayDown)||0)*1000;
      if(state.pendingUp!==raw.up||state.pendingSince===undefined){clear();state.pendingUp=raw.up;state.pendingSince=now;}
      const deadline=state.pendingSince!+delay;
      if(deadline<=now){state.up=raw.up;state.changedAt=now;clear();}
      else if(state.deadline!==deadline||!state.timer){engine.clock.cancel(state.timer);state.deadline=deadline;const expected=state,runtime=device.runtime;state.timer=engine.clock.schedule(deadline-now,()=>{if(device.runtime!==runtime||machine!.objects.get(id)!==expected)return;expected.timer=undefined;engine.recompute();engine.notify();},{owner:device.id,label:`Track ${id} delayed ${raw.up?'up':'down'}`});}
    }
    return result[id]={up:state.up,rawUp:raw.up,description:config.description||raw.description,lastChange:state.changedAt,...(raw.value===undefined?{}:{value:raw.value}),...(state.pendingUp===undefined?{}:{pending:state.pendingUp?'up':'down',pendingUntil:state.deadline}),...(raw.error?{error:raw.error}:{})};
  };
  for(const id of Object.keys(definitions))evaluate(id);
  for(const[id,state]of machine.objects)if(!definitions[id]){engine.clock.cancel(state.timer);machine.objects.delete(id);}
  return result;
}
