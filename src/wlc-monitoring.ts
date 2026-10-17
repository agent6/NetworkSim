import type {Device} from './model.ts';
import type {Simulator} from './engine.ts';
import {IOSSession} from './cli.ts';
import {escapeHTML as esc} from './icons.ts';
import {ciscoMAC} from './wireless-model.ts';

export function bindWLCMonitoring(sim:Simulator,d:Device,root:HTMLFormElement,commit:(work:()=>void)=>void):()=>void{
 const cli=new IOSSession(sim,d.id);cli.setPrivilege(15);cli.execute('terminal length 0');
 const status=()=>root.querySelector<HTMLElement>('[data-wlc-action-status]');
 const save=()=>commit(()=>{cli.execute('write memory');});
 root.addEventListener('click',event=>{
  const target=(event.target as Element).closest<HTMLElement>('[data-wlc-save],[data-wlc-reload],[data-wlc-confirm-reload],[data-wlc-save-reload],[data-wlc-disconnect]');if(!target)return;
  if(target.hasAttribute('data-wlc-save')){save();if(status())status()!.textContent='Running configuration saved to startup configuration.';}
  if(target.hasAttribute('data-wlc-reload')&&status())status()!.innerHTML='Reload the startup configuration? Unsaved running changes will be lost. <button type="button" class="btn" data-wlc-confirm-reload>Reload saved configuration</button> <button type="button" class="btn" data-wlc-save-reload>Save and reload</button>';
  if(target.hasAttribute('data-wlc-confirm-reload')||target.hasAttribute('data-wlc-save-reload')){if(target.hasAttribute('data-wlc-save-reload'))save();commit(()=>sim.reloadIOS(d.id,'Reload requested from WLC management'));document.querySelector<HTMLButtonElement>('[data-action=close-dialog]')?.click();}
  if(target.dataset.wlcDisconnect){const sent=sim.wireless.deauthenticate(d.id,target.dataset.wlcDisconnect);if(status())status()!.textContent=sent?'CAPWAP disconnect request sent. An automatically connecting client may reconnect.':'Client is no longer associated with this controller.';}
 });
 let previous=-Infinity;
 return()=>{
  if(sim.clock.now()-previous<1000)return;previous=sim.clock.now();
  const output=root.querySelector<HTMLElement>('[data-wlc-monitor]');if(output)output.textContent=['Time synchronization',...cli.execute('show ntp status'),...cli.execute('show ntp associations'),'','AAA servers',...cli.execute('show aaa servers'),'','SNMP agent',...cli.execute('show snmp'),'','System log',...cli.execute('show logging').slice(-24)].join('\n');
  const clients=root.querySelector<HTMLElement>('[data-wlc-clients]');if(clients){const rows=sim.lab.devices.flatMap(c=>{const a=sim.wireless.association(c.id);return a?.controllerId===d.id?[`<tr><td>${esc(c.config.hostname)}<small>${esc(ciscoMAC(sim.macOf(c.id,'Wireless0')))}</small></td><td>${esc(a.ssid)} · VLAN ${a.vlan}</td><td>${esc(sim.getDevice(a.apId)?.config.hostname??'')} · ${a.rssi} dBm</td><td><button type="button" class="btn" data-wlc-disconnect="${esc(sim.macOf(c.id,'Wireless0'))}">Disconnect</button></td></tr>`]:[];});clients.innerHTML=`<div class="section-label mb-2">Associated clients · ${rows.length}</div><div class="wireless-table-wrap"><table class="wireless-table"><thead><tr><th>Client</th><th>WLAN / VLAN</th><th>AP / signal</th><th>Action</th></tr></thead><tbody>${rows.join('')||'<tr><td colspan="4">No associated clients</td></tr>'}</tbody></table></div>`;}
  if(clients){const records=Object.entries<any>(d.runtime.features.apAuthorizations??{});clients.insertAdjacentHTML('beforeend',`<div class="section-label mt-4 mb-2">AP join authorization · ${records.length}</div><div class="wireless-table-wrap" data-wlc-ap-authorizations><table class="wireless-table"><thead><tr><th>Ethernet MAC / IP</th><th>Result</th><th>Reason</th><th>Age</th></tr></thead><tbody>${records.map(([mac,r])=>`<tr><td>${esc(ciscoMAC(mac))}<small>${esc(r.address)}</small></td><td>${esc(r.status)}</td><td>${esc(r.reason)}</td><td>${Math.max(0,Math.floor((sim.clock.now()-r.time)/1000))}s</td></tr>`).join('')||'<tr><td colspan="4">No AP MAC authorization requests received</td></tr>'}</tbody></table></div>`);}
 };
}
