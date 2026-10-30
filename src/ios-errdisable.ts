import type { ControlPlaneHost } from './control-plane.ts';
import type { TimerHandle } from './clock.ts';
type Simulator = ControlPlaneHost;
import type { Device } from './model.ts';

/** Configuration vocabulary retained independently from the mechanisms that can raise each fault. */
export const ERRDISABLE_CAUSES = ['arp-inspection','bpduguard','channel-misconfig','dhcp-rate-limit','dtp-flap','gbic-invalid','inline-power','l2ptguard','link-flap','link-monitor-failure','loopback','mac-limit','oam-remote-failure','pagp-flap','port-mode-failure','pppoe-ia-rate-limit','psecure-violation','psp','security-violation','sfp-config-mismatch','storm-control','udld','unicast-flood','vmps'];
export const MODELED_ERRDISABLE_CAUSES = ['arp-inspection','bpduguard','dhcp-rate-limit','psecure-violation','storm-control','udld'];
export const errdisableDetectionEnabled = (d:Device,cause:string) => d.config.features.errdisable?.detect?.[cause] !== false;
const sessions = new WeakMap<Simulator,Map<string,{runtime:Device['runtime'];signature:string;timer:TimerHandle|undefined}>>();

export function disableInterface(engine:Simulator,d:Device,port:string,cause:string):boolean {
  const iface=d.config.interfaces[port];if(!iface||!errdisableDetectionEnabled(d,cause))return false;
  if(!iface.features.errDisabled){
    iface.features.errDisabled=true;(d.runtime.features.errdisableCauses??={})[port]=cause;(d.runtime.features.errdisableAt??={})[port]=engine.clock.now();
    if(cause==='bpduguard'){
      const short=port.replace('GigabitEthernet','Gi').replace('Ethernet','Eth');
      engine.log?.(d.id,`%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${port} with BPDU Guard enabled. Disabling port.`,2);
      engine.log?.(d.id,`%PM-4-ERR_DISABLE: bpduguard error detected on ${short}, putting ${short} in err-disable state`,4);
      engine.emit({nodeId:d.id,port,protocol:'STP',label:'BPDU guard err-disable',detail:'Received BPDU on a BPDU Guard protected interface.',disposition:'drop'});
    }
  }
  reconcileErrdisable(engine,d);return true;
}

/** Reconcile timers after configuration changes, including recovery enabled after a fault. */
export function reconcileErrdisable(engine:Simulator,d:Device):void {
  let map=sessions.get(engine);if(!map){map=new Map();sessions.set(engine,map);}const config=d.config.features.errdisable??{},now=engine.clock.now();
  for(const [port,iface]of Object.entries(d.config.interfaces)){
    const key=d.id+'|'+port,old=map.get(key),cause=d.runtime.features.errdisableCauses?.[port],enabled=iface.features.errDisabled&&cause&&((config.causes??[]).includes('all')||(config.causes??[]).includes(cause)),signature=JSON.stringify([cause,Number(config.interval??300),enabled]);
    if(old&&old.runtime===d.runtime&&old.signature===signature)continue;
    if(old)engine.clock.cancel(old.timer);map.delete(key);if(d.runtime.features.errdisableDeadline)delete d.runtime.features.errdisableDeadline[port];
    if(!iface.features.errDisabled){if(d.runtime.features.errdisableCauses)delete d.runtime.features.errdisableCauses[port];if(d.runtime.features.errdisableAt)delete d.runtime.features.errdisableAt[port];delete iface.features.errDisabledReason;}
    if(!enabled)continue;
    const deadline=now+Math.max(1,Number(config.interval??300))*1000,record={runtime:d.runtime,signature,timer:undefined as TimerHandle|undefined};(d.runtime.features.errdisableDeadline??={})[port]=deadline;map.set(key,record);
    record.timer=engine.clock.schedule(deadline-now,()=>{if(map!.get(key)!==record||d.runtime!==record.runtime)return;map!.delete(key);delete d.runtime.features.errdisableDeadline?.[port];if(!iface.features.errDisabled||d.runtime.features.errdisableCauses?.[port]!==cause)return;iface.features.errDisabled=false;delete iface.features.errDisabledReason;delete d.runtime.features.errdisableCauses[port];delete d.runtime.features.errdisableAt?.[port];if(d.kind==='datacenter'&&cause==='psecure-violation')for(const field of ['portSecurityPortViolations','portSecurityRejected','portSecurityNotified'])delete d.runtime.features[field]?.[port];engine.log?.(d.id,`%PM-4-ERR_RECOVER: Attempting to recover from ${cause} err-disable state on ${port.replace('GigabitEthernet','Gi')}`,4);engine.emit({nodeId:d.id,port,protocol:'SYSTEM',label:'Errdisable recovery',detail:cause+' recovery timer expired.',disposition:'info'});engine.recompute();engine.notify();},{owner:d.id,label:'errdisable recovery'});
  }
}
