import type {PacketSummary} from './model.ts';

/** Summaries retain the actual modeled BPDU payload, not later device state. */
export function stpPacketSummary(payload:any):NonNullable<PacketSummary['stpBpdus']>{
 if(!Array.isArray(payload?.vlans))return [];
 return payload.vlans.filter((b:any)=>b&&typeof b==='object').map((b:any)=>{
  const vlan=Number(b.vlan),summary:NonNullable<PacketSummary['stpBpdus']>[number]={vlan,mode:String(b.mode),version:b.mode==='pvst'?0:b.mode==='mst'?3:b.mode==='rapid-pvst'?2:-1,rootBridgeId:String(b.rootBridgeId),bridgeId:String(b.bridgeId),rootPathCost:Number(b.cost),role:String(b.role),proposal:!!b.proposal,agreement:!!b.agreement,topologyChange:!!b.tc};
  if(b.mode==='mst'){
   const signature=typeof b.region==='string'?b.region:'';summary.region=signature;
   try{const region=JSON.parse(signature);if(Array.isArray(region)&&typeof region[0]==='string'&&Number.isInteger(region[1])&&Array.isArray(region[2])){summary.regionName=region[0];summary.revision=region[1];summary.instance=region[2].find((i:any)=>Array.isArray(i)&&Array.isArray(i[1])&&i[1].includes(vlan))?.[0]??0;}}catch{/* An invalid region remains visible as missing decoded fields. */}
  }
  return summary;
 });
}
