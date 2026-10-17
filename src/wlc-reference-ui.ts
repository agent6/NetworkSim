import type {Device} from './model.ts';
import type {WirelessConfiguration} from './wireless-model.ts';
import {escapeHTML as esc} from './icons.ts';
import {queuePolicy} from './qos-scheduler.ts';

type Choice = [value: string, label: string];
type Reference = 'interface'|'wlan'|'policy'|'policy-tag'|'site-tag'|'rf-tag'|'join'|'flex'|'rf24'|'rf5'|'dot1x'|'ipv4-acl'|'qos';
type Catalog = Record<Reference, Choice[]>;
const names = (table: object): Choice[] => Object.keys(table).map(name => [name, name]);
const definitions: Record<Reference, {placeholder: string; guidance: string; optional?: boolean}> = {
  'ipv4-acl':{placeholder:'No wireless IPv4 ACL',guidance:'Create an IPv4 ACL in the IOS console.',optional:true},
  qos:{placeholder:'No wireless QoS policy',guidance:'Create a policing/marking policy map in the console. Physical queue policies are unavailable here.',optional:true},
  interface: {placeholder: 'Select a management interface', guidance: 'Select an existing interface. Configure additional interfaces in the IOS XE console.'},
  wlan: {placeholder: 'Select a WLAN profile', guidance: 'Create a WLAN in the WLANs tab.'},
  policy: {placeholder: 'Select a policy profile', guidance: 'Create a policy in the Policy profiles tab.'},
  'policy-tag': {placeholder: 'Select a policy tag', guidance: 'Create a policy tag in Tags & profiles.'},
  'site-tag': {placeholder: 'Select a site tag', guidance: 'Create a site tag in Tags & profiles.'},
  'rf-tag': {placeholder: 'Select an RF tag', guidance: 'Create an RF tag in Tags & profiles.'},
  join: {placeholder: 'Select an AP join profile', guidance: 'Create an AP join profile in Tags & profiles.'},
  flex: {placeholder: 'Select a Flex profile', guidance: 'Create a Flex profile in Tags & profiles.'},
  rf24: {placeholder: 'Use AP radio defaults', guidance: 'Create a 2.4 GHz RF profile to override the radio defaults.', optional: true},
  rf5: {placeholder: 'Use AP radio defaults', guidance: 'Create a 5 GHz RF profile to override the radio defaults.', optional: true},
  dot1x: {placeholder: 'Select an 802.1X method list', guidance: 'Create a method list in the IOS XE console: aaa authentication dot1x <name> group <RADIUS-group>.'},
};

export function wlcReferenceCatalog(w: WirelessConfiguration, device: Device): Catalog {
  return {
    'ipv4-acl':Object.entries<any>(device.config.features.acls??{}).filter(([,value])=>value.type!=='ipv6').map(([name])=>[name,name]),
    qos:Object.entries(device.config.features.policyMaps??{}).filter(([,value])=>!queuePolicy(value)).map(([name])=>[name,name]),
    interface: names(device.config.interfaces),
    wlan: Object.entries(w.wlans).map(([name, p]) => [name, `${name} · ${p.ssid || 'No SSID'} · ${p.enabled ? 'Enabled' : 'Disabled'}`]),
    policy: Object.entries(w.policies).map(([name, p]) => [name, `${name} · VLAN ${p.vlan} · ${p.enabled ? 'Enabled' : 'Disabled'}`]),
    'policy-tag': names(w.policyTags), 'site-tag': names(w.siteTags), 'rf-tag': names(w.rfTags),
    join: names(w.apProfiles), flex: names(w.flexProfiles),
    rf24: Object.entries(w.rfProfiles).filter(([,p]) => p.band === '2.4').map(([name,p]) => [name, `${name} · ${p.enabled ? 'Enabled' : 'Disabled'}`]),
    rf5: Object.entries(w.rfProfiles).filter(([,p]) => p.band === '5').map(([name,p]) => [name, `${name} · ${p.enabled ? 'Enabled' : 'Disabled'}`]),
    dot1x: Object.entries(w.dot1xLists).map(([name,group]) => [name, `${name} · ${group}`]),
  };
}

function options(kind: Reference, value: string, choices: Choice[]): string {
  const missing = value && !choices.some(([name]) => name === value);
  return [["", definitions[kind].placeholder], ...(missing ? [[value, `${value} · unavailable`]] : []), ...choices]
    .map(([name,label]) => `<option value="${esc(name)}"${name === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

export function wlcReference(label: string, name: string, value: unknown, kind: Reference, catalog: Catalog): string {
  return `<label class="field">${esc(label)}<select name="${name}" data-wlc-reference="${kind}">${options(kind, String(value ?? ''), catalog[kind])}</select><small class="text-[11px] font-normal text-slate-500" data-reference-help></small></label>`;
}

/** Options come from the entire unsaved form. Updating a list never changes an
 * existing reference or silently substitutes the first remaining profile. */
export function bindWLCReferences(root: HTMLFormElement, w: WirelessConfiguration, device: Device): () => void {
  const signatures = new WeakMap<HTMLSelectElement,string>();
  const rows = (kind: string) => [...root.querySelectorAll<HTMLElement>('[data-wireless-row]')].filter(row => row.dataset.wirelessRow === kind);
  const value = (row: HTMLElement, name: string) => row.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${name}"]`)?.value.trim() ?? '';
  const checked=(row:HTMLElement,name:string)=>{const control=row.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${name}"]`);return control instanceof HTMLSelectElement?control.value==='on':control?.checked===true;};
  const unique = (choices: Choice[]) => [...new Map(choices.filter(([name]) => name).map(choice => [choice[0], choice])).values()];
  const named = (kind: string, field: string): Choice[] => rows(kind).map(row => { const name = value(row, field); return [name, name]; });
  const refresh = () => {
    const catalog = wlcReferenceCatalog(w,device);
    catalog.wlan = unique(rows('WLAN').map(row => [value(row,'wlan-name'), `${value(row,'wlan-name')} · ${row.querySelector<HTMLInputElement>('[name=wlan-ssid]')?.value || 'No SSID'} · ${checked(row,'wlan-enabled') ? 'Enabled' : 'Disabled'}`]));
    if(root.querySelector('[name=wlc-administration]'))catalog.dot1x=unique(rows('802.1X list').map(row=>[value(row,'admin-dot1x-name'),`${value(row,'admin-dot1x-name')} · ${value(row,'admin-dot1x-group')}`]));
    catalog.policy = unique(rows('Policy').map(row => [value(row,'policy-name'), `${value(row,'policy-name')} · VLAN ${value(row,'policy-vlan')} · ${checked(row,'policy-enabled') ? 'Enabled' : 'Disabled'}`]));
    catalog['policy-tag'] = unique(named('Policy tag','policy-tag-name'));
    catalog['site-tag'] = unique(named('Site tag','site-name'));
    catalog['rf-tag'] = unique(named('RF tag','rftag-name'));
    catalog.join = unique(named('AP join profile','join-name'));
    catalog.flex = unique(named('Flex profile','flex-name'));
    for (const [kind,band] of [['rf24','2.4'],['rf5','5']] as const) {
      catalog[kind] = unique(rows('RF profile').filter(row => value(row,'rf-band') === band).map(row => [value(row,'rf-name'), `${value(row,'rf-name')} · ${checked(row,'rf-enabled') ? 'Enabled' : 'Disabled'}`]));
    }
    for (const select of root.querySelectorAll<HTMLSelectElement>('[data-wlc-reference]')) {
      const kind = select.dataset.wlcReference as Reference, current = select.value, choices = catalog[kind];
      const signature = JSON.stringify([choices,current]);
      if (signatures.get(select) !== signature) {
        select.innerHTML = options(kind,current,choices); select.value = current; signatures.set(select,signature);
      }
      const enterprise = select.closest('[data-wireless-row="WLAN"]')?.querySelector<HTMLSelectElement>('[name=wlan-security]')?.value === 'wpa2-enterprise';
      const relevant = kind !== 'dot1x' || enterprise, missing = !!current && !choices.some(([name]) => name === current);
      const invalid = relevant && (missing || (!current && !definitions[kind].optional));
      select.setCustomValidity(invalid ? `${missing ? 'The selected item is unavailable. ' : ''}${definitions[kind].guidance}` : '');
      select.setAttribute('aria-invalid', String(invalid));
      const label = select.closest('label')!, help = label.querySelector<HTMLElement>('[data-reference-help]');
      label.classList.toggle('hidden', !relevant);
      if (help) help.textContent = missing && relevant ? 'This item was removed, renamed, or has an incompatible radio band. Select an available item.' : !choices.length ? definitions[kind].guidance : '';
    }
    for (const row of rows('WLAN')) row.querySelector('[name=wlan-psk]')?.closest('label')?.classList.toggle('hidden', !['wpa2-personal','wpa3-personal','wpa2-wpa3-personal'].includes(value(row,'wlan-security')));
    // A policy VLAN can be carried upstream without a local WLC VLAN object;
    // its numeric field intentionally accepts any valid VLAN ID.
  };
  root.addEventListener('input', refresh);
  root.addEventListener('change', refresh);
  let revealingInvalid = false;
  root.addEventListener('invalid', event => {
    if (revealingInvalid) return;
    revealingInvalid = true; setTimeout(() => { revealingInvalid = false; },0);
    const control = event.target as HTMLElement, panel = control.closest<HTMLElement>('[data-wireless-section]');
    root.querySelectorAll<HTMLButtonElement>('[data-wireless-tab]').forEach(tab => { if (tab.dataset.wirelessTab === panel?.dataset.wirelessSection) tab.click(); });
    for (let parent = control.parentElement; parent && parent !== root; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  }, true);
  refresh();
  return refresh;
}
