import type {Simulator} from './engine.ts';
import type {Device,DeviceConfig} from './model.ts';
import {isIPv4} from './ip.ts';
import {switchingPeer} from './switching-messages.ts';

export type EtherChannelTroubleshootingCriterion=
 | {kind:'ec-saved';device:string;group:number;members:string[];vlans:number[]}
 | {kind:'ec-stp';device:string;group:number;members:string[];vlans:number[]}
 | {kind:'ec-echo';device:string;target:string;address:string;vlan:number;localSwitch:string;remoteSwitch:string;group:number;members:string[];failed?:string};
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const vlan=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=1&&Number(v)<=4094;
export function validEtherChannelTroubleshootingCriterion(c:any):boolean{
 if(!name(c.device)||!Number.isInteger(c.group)||c.group<1||c.group>48||!Array.isArray(c.members)||c.members.length<2||c.members.length>8||!c.members.every(name)||new Set(c.members).size!==c.members.length)return false;
 if(c.kind==='ec-saved'||c.kind==='ec-stp')return Array.isArray(c.vlans)&&c.vlans.length>0&&c.vlans.length<=64&&c.vlans.every(vlan)&&new Set(c.vlans).size===c.vlans.length;
 return c.kind==='ec-echo'&&name(c.target)&&name(c.localSwitch)&&name(c.remoteSwitch)&&c.localSwitch!==c.remoteSwitch&&typeof c.address==='string'&&isIPv4(c.address)&&vlan(c.vlan)&&(c.failed===undefined||c.members.includes(c.failed)&&c.members.length===2);
}
const projection=(c:DeviceConfig,group:number,members:string[],vlans:number[])=>{
 const ports=[`Port-channel${group}`,...members];if(ports.some(p=>!Object.hasOwn(c.interfaces,p))||vlans.some(v=>!Object.hasOwn(c.vlans,v)))return;
 return JSON.stringify([ports.map(p=>{const i=c.interfaces[p];return [i.adminUp,i.switchport,i.mode,i.vlan,i.nativeVlan,i.allowedVlans===null?null:[...i.allowedVlans].sort((a,b)=>a-b),i.speed,i.duplex,i.features.speedAuto,!!i.features.nonegotiate,!!i.features.portfast,i.features.channelGroup,i.features.channelMode,i.features.channelProtocol];}),vlans.map(v=>c.vlans[v].active)]);
};
const lastTransition=(d:Device,port:string,state:'up'|'down'):number=>(d.runtime.features.logEntries??[]).reduce((latest:number,e:any)=>e.message===`%LINK-3-UPDOWN: Interface ${port}, changed state to ${state}`?Math.max(latest,e.time):latest,-1);
export function matchesEtherChannelTroubleshootingCriterion(s:Simulator,d:Device,c:EtherChannelTroubleshootingCriterion):boolean{
 const po=`Port-channel${c.group}`;
 if(c.kind==='ec-saved'){const running=projection(d.config,c.group,c.members,c.vlans);return !!d.startupConfig&&running!==undefined&&running===projection(d.startupConfig,c.group,c.members,c.vlans);}
 if(c.kind==='ec-stp')return !!d.config.interfaces[po]?.switchport&&!d.config.interfaces[po].features.portfast&&s.interfaceUp(d.id,po)&&c.members.every(p=>d.config.interfaces[p]?.features.channelGroup===c.group&&!d.config.interfaces[p].features.portfast)&&c.vlans.every(v=>d.runtime.stp[v]?.ports[po]?.state==='forwarding'&&c.members.every(p=>!d.runtime.stp[v].ports[p]));
 const local=s.getDevice(c.localSwitch),remote=s.getDevice(c.remoteSwitch),target=s.getDevice(c.target);if(!local||!remote||!target)return false;
 const a=local.runtime.features.portChannels?.[c.group],b=remote.runtime.features.portChannels?.[c.group];
 if(a?.protocol!=='lacp'||b?.protocol!=='lacp'||a.state!=='up'||b.state!=='up'||a.peerDeviceId!==remote.id||b.peerDeviceId!==local.id||!s.interfaceUp(local.id,po)||!s.interfaceUp(remote.id,po))return false;
 const links=s.lab.links.filter(l=>l.enabled).flatMap(l=>{const x=l.a.deviceId===local.id?l.a:l.b.deviceId===local.id?l.b:undefined,y=x===l.a?l.b:l.a;return x&&y.deviceId===remote.id&&c.members.includes(x.port)&&c.members.includes(y.port)&&a.activeMembers.includes(x.port)&&b.activeMembers.includes(y.port)?[{a:x.port,b:y.port}]:[];});
 if(!links.length)return false;
 let floor=Math.max(lastTransition(local,po,'up'),lastTransition(remote,po,'up'));
 if(c.failed){const down=lastTransition(local,c.failed,'down');if(local.config.interfaces[c.failed]?.adminUp!==false||a.activeMembers.length!==1||b.activeMembers.length!==1||a.activeMembers.includes(c.failed)||down<0)return false;floor=Math.max(floor,down);}
 const wire=(id:string,reverse:boolean,before:number)=>links.some(p=>{
  const from=reverse?remote:local,to=reverse?local:remote,fp=reverse?p.b:p.a,tp=reverse?p.a:p.b,partner=switchingPeer(s,from.id,fp,'LACP');
  return partner?.deviceId===to.id&&partner.synchronized===true&&partner.partner?.deviceId===from.id&&s.events.some(e=>e.nodeId===from.id&&e.port===fp&&e.protocol==='LACP'&&e.label==='Frame received'&&e.time<=before)&&s.events.some(e=>e.nodeId===from.id&&e.port===fp&&e.label==='Frame sent'&&e.time>floor&&e.packet?.id===id&&e.packet.vlan===c.vlan)&&s.events.some(e=>e.nodeId===to.id&&e.port===tp&&e.label==='Frame received'&&e.time>floor&&e.packet?.id===id&&e.packet.vlan===c.vlan);
 });
 return s.events.some(request=>request.nodeId===target.id&&request.label==='Echo request accepted'&&request.time>floor&&request.packet?.destination===c.address&&wire(request.packet.id,false,request.time)&&s.events.some(reply=>reply.nodeId===d.id&&reply.label==='Echo reply received'&&reply.disposition==='success'&&reply.packet?.source===c.address&&reply.packet.parentId===request.packet!.id&&wire(reply.packet.id,true,reply.time)));
}
