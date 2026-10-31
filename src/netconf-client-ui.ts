import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import {escapeHTML as esc} from './icons.ts';
import {netconfClient,NETCONF_EXAMPLES} from './netconf-client.ts';

export function netconfClientFields(sim:Simulator,d:Device):string {
 const client=netconfClient(sim,d.id),state=client.state;
 return `<p class="text-xs leading-5 text-slate-500">Connect to an in-lab NETCONF target over TCP 830. The client exchanges NETCONF 1.0 XML over modeled SSH. Closing this panel keeps the session open; use Disconnect or close-session to release it.</p><div class="grid gap-3 sm:grid-cols-3"><label class="field">Target IP address<input name="nc-address" value="${esc(state.address)}" autocomplete="off"></label><label class="field">Username<input name="nc-username" value="${esc(state.username)}" autocomplete="off"></label><label class="field">Lab password<input name="nc-password" type="password" autocomplete="off"></label></div><div class="flex flex-wrap items-center gap-2"><button type="button" class="btn-primary" data-nc-connect>Connect</button><button type="button" class="btn" data-nc-disconnect>Disconnect</button><span class="text-xs text-slate-500" role="status" data-nc-status></span></div><p class="text-xs text-rose-600" aria-live="polite" data-nc-notice></p><details><summary class="cursor-pointer text-xs font-semibold">Server capabilities</summary><pre class="wireless-output mt-2" style="max-height:160px;overflow:auto;white-space:pre" data-nc-capabilities></pre></details><div class="flex flex-wrap items-end gap-2"><label class="field flex-1" style="min-width:0">Example RPC<select name="nc-example">${Object.entries(NETCONF_EXAMPLES).map(([key,v])=>`<option value="${key}">${esc(v.label)}</option>`).join('')}</select></label><button type="button" class="btn" data-nc-load>Load example</button></div><label class="field">RPC XML · edit the interface names and values as needed<textarea name="nc-rpc" rows="9" wrap="off" spellcheck="false" class="font-mono text-xs">${esc(client.draft(NETCONF_EXAMPLES['read-running'].body))}</textarea></label><div class="flex flex-wrap gap-2"><button type="button" class="btn-primary" data-nc-send>Send RPC</button><button type="button" class="btn" data-nc-clear>Clear transcript</button><button type="button" class="btn" data-nc-download>Download transcript</button></div><pre class="wireless-output mt-3" style="max-height:360px;max-width:100%;overflow:auto;white-space:pre" data-nc-transcript aria-label="NETCONF transcript"></pre>`;
}
export function bindNetconfClient(root:HTMLElement,sim:Simulator,d:Device):()=>void {
 const client=netconfClient(sim,d.id),find=<T extends HTMLElement>(query:string)=>root.querySelector<T>(query)!,value=(name:string)=>find<HTMLInputElement>(`[name=${name}]`).value;
 let signature='';
 const refresh=()=>{if(!root.isConnected||!root.querySelector('[data-nc-status]'))return;const s=client.state,next=JSON.stringify(s);if(next===signature)return;signature=next;
  find('[data-nc-status]').textContent=s.status==='ready'?`Ready · session ${s.sessionId??'?'} · TCP 830${s.pending?' · waiting for '+s.pending:''}`:s.status;
  find('[data-nc-notice]').textContent=s.error??'';find('[data-nc-capabilities]').textContent=s.capabilities.join('\n')||'Connect to receive the server hello.';
  const output=find('[data-nc-transcript]'),atBottom=output.scrollHeight-output.scrollTop-output.clientHeight<25;output.textContent=s.messages.map(m=>`${(m.at/1000).toFixed(3)}s ${m.direction.toUpperCase()}${m.messageId?' · message-id '+m.messageId:''}\n${m.text}`).join('\n\n')||'No messages yet.';if(atBottom)output.scrollTop=output.scrollHeight;
  find<HTMLButtonElement>('[data-nc-send]').disabled=s.status!=='ready'||!!s.pending;find<HTMLButtonElement>('[data-nc-connect]').disabled=['connecting','authenticating'].includes(s.status);find<HTMLButtonElement>('[data-nc-disconnect]').disabled=['disconnected','closed'].includes(s.status);find<HTMLButtonElement>('[data-nc-download]').disabled=!s.messages.length;
 };
 const wait=()=>{for(let i=0;i<210&&(['connecting','authenticating'].includes(client.state.status)||client.state.pending);i++)sim.advance(100);refresh();};
 const attempt=(work:()=>void)=>{try{work();wait();}catch(error){find('[data-nc-notice]').textContent=error instanceof Error?error.message:String(error);}};
 find('[data-nc-connect]').onclick=()=>attempt(()=>{const password=find<HTMLInputElement>('[name=nc-password]');try{client.connect(value('nc-address').trim(),value('nc-username').trim(),password.value);}finally{password.value='';}});
 find('[data-nc-disconnect]').onclick=()=>attempt(()=>{client.disconnect();sim.advance(100);});
 find('[data-nc-send]').onclick=()=>attempt(()=>client.send(value('nc-rpc')));
 find('[data-nc-load]').onclick=()=>{const key=value('nc-example') as keyof typeof NETCONF_EXAMPLES;find<HTMLTextAreaElement>('[name=nc-rpc]').value=client.draft(NETCONF_EXAMPLES[key].body);};
 find('[data-nc-clear]').onclick=()=>{client.clear();refresh();};
 find('[data-nc-download]').onclick=()=>{const s=client.state,url=URL.createObjectURL(new Blob([JSON.stringify({device:d.config.hostname,target:s.address,username:s.username,sessionId:s.sessionId,capabilities:s.capabilities,messages:s.messages},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='networksim-netconf-transcript.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 refresh();return refresh;
}
