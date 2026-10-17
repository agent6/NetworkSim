import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {endpointVoicePolicy} from './endpoint.ts';
import {escapeHTML as esc} from './icons.ts';

type Dialog=(title:string,content:string,footer?:string,wide?:boolean)=>void;
export function showPhone(sim:Simulator,d:Device,dialog:Dialog,configureIP:()=>void,commit:(work:()=>void)=>void):void {
  dialog(`${d.config.hostname} · VoIP phone`,`<section data-phone-status></section><p class="mt-5 text-xs leading-6 text-slate-500">Connect <strong>Network</strong> to a PoE switch. The phone learns its voice VLAN from CDP or LLDP-MED and obtains its own IP address on that VLAN. <strong>PC</strong> passes untagged data in both directions; voice traffic stays off the PC port. Both ports require phone power.</p>`,`<button class="btn" data-phone-ip>IP settings</button><button class="btn" data-phone-renew>Renew DHCP lease</button><button class="btn-primary" data-action="close-dialog">Done</button>`);
  const root=document.querySelector<HTMLElement>('[data-phone-status]')!;
  const renew=document.querySelector<HTMLButtonElement>('[data-phone-renew]')!;
  let previous='';
  const port=(name:string)=>{
    const link=sim.lab.links.find(l=>l.a.deviceId===d.id&&l.a.port===name||l.b.deviceId===d.id&&l.b.port===name);
    const peer=link&&(link.a.deviceId===d.id?link.b:link.a),device=peer&&sim.getDevice(peer.deviceId);
    return device?`${sim.interfaceUp(d.id,name)?'Up':'Down'} · ${device.config.hostname} · ${peer!.port}`:'Not connected';
  };
  const render=()=>{
    if(!root.isConnected){off();return;}
    const powered=sim.devicePowered(d.id),power=d.runtime.features.poePower,policy=endpointVoicePolicy(d,sim.clock.now()),network=d.config.interfaces.Network;
    const vlan=typeof policy?.vlan==='number'?`VLAN ${policy.vlan}`:policy?.vlan==='dot1p'?'Access VLAN · priority tagged (VLAN 0)':'Access VLAN · untagged';
    const rows=[['power','Power',powered?`PoE · ${power.watts.toFixed(1)} W allocated`:'No PoE power'],['network','Network uplink',port('Network')],['voice-vlan','Voice VLAN',powered?vlan:'Unavailable while unpowered'],['policy','Learned policy',policy?`${policy.protocol} · CoS ${policy.cos}${policy.dscp===undefined?'':` · DSCP ${policy.dscp}`}`:'No voice policy received'],['address','Phone IPv4',powered?network.ip??(network.features.dhcp?'Waiting for DHCP':'Not configured'):'Unavailable while unpowered'],['gateway','Default gateway',powered?d.config.defaultGateway??'Not assigned':'—'],['pc','PC passthrough',port('PC')]];
    const markup=`<div class="wireless-status"><span class="wireless-state ${powered?'connected':''}" data-phone-powered>${powered?'Powered by switch':'Waiting for PoE'}</span><p>${esc(power?.reason??'Connect Network to an enabled PoE switch port.')}</p></div><dl class="mt-4 divide-y divide-slate-100">${rows.map(([key,label,value])=>`<div class="flex items-start justify-between gap-5 py-3 text-xs"><dt class="text-slate-500">${label}</dt><dd class="text-right font-medium" data-phone-${key}>${esc(value)}</dd></div>`).join('')}</dl>`;
    if(markup!==previous){root.innerHTML=markup;previous=markup;}
    renew.disabled=!powered||!sim.interfaceUp(d.id,'Network')||!network.features.dhcp;
  };
  document.querySelector('[data-phone-ip]')!.addEventListener('click',configureIP);
  renew.addEventListener('click',()=>commit(()=>{sim.releaseDHCP(d.id,'Network');sim.requestDHCP(d.id,'Network');}));
  const off=sim.subscribe(render);render();
}
