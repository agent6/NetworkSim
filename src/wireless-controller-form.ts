import type { Device, DeviceConfig } from './model.ts';
import { Simulator } from './engine.ts';
import { IOSSession } from './cli.ts';
import { wirelessConfig, validateWireless, canonicalMAC, wirelessEntry as entry, setWirelessEntry as put, type WirelessConfiguration } from './wireless-model.ts';
import {applyWLCAdministration} from './wlc-administration.ts';
import { isIPv4, isIPv6, maskToPrefix } from './ip.ts';

/** Validate a complete WLC form on a disposable device. Only represented fields
 * are edited; an unrelated Apply must not enable an AKM disabled in the console
 * or erase CLI-only properties such as an AP join profile's description. */
export function controllerFormDraft(seed: number, device: Device, form: FormData, presentedAPs: string[] = []): DeviceConfig {
  const draft = new Simulator(seed), copy = draft.addDevice('wlc');
  copy.config = structuredClone(device.config);
  const cli = new IOSSession(draft, copy.id), original = wirelessConfig(device)!;
  cli.setPrivilege(15); cli.execute('configure terminal');
  const exec = (line: string) => {
    const result = cli.execute(line);
    if (result.some(r => /^%/.test(r) || r.includes('Invalid input detected'))) throw Error(line + ': ' + result.join(' '));
  };
  applyWLCAdministration(copy,form,exec);
  const read = (field: string) => String(form.get(field) ?? '').trim();
  const at = (field: string, i: number) => String(form.getAll(field)[i] ?? '').trim();
  const each = (field: string, callback: (i: number, name: string) => void, unique = true) => {
    const values = form.getAll(field).map(String).map(s => s.trim());
    if (unique && new Set(values).size !== values.length) throw Error('Duplicate ' + field.replace(/-/g, ' ') + '.');
    values.forEach((name, i) => callback(i, name));
  };
  const selected = (value: string, allowed: string[], field: string) => {
    if (!allowed.includes(value)) throw Error('Select a valid ' + field + '.');
    return value;
  };
  exec('hostname ' + read('hostname'));
  const management = read('management-interface'), ip = read('management-ip'), mask = read('management-mask'), gateway = read('management-gateway'), dns = read('management-dns').split(',').map(s => s.trim()).filter(Boolean);
  if (ip && !isIPv4(ip)) throw Error('Enter a valid IPv4 address.');
  if (ip) maskToPrefix(mask);
  if (gateway && !isIPv4(gateway)) throw Error('Enter a valid IPv4 gateway.');
  if (dns.some(a => !isIPv4(a) && !isIPv6(a))) throw Error('Enter valid DNS server addresses.');
  exec('wireless management interface ' + management); exec('interface ' + management);
  exec(ip ? 'ip address ' + ip + ' ' + mask : 'no ip address'); exec('no shutdown'); exec('exit');
  exec(gateway ? 'ip default-gateway ' + gateway : 'no ip default-gateway');
  exec('no ip name-server');
  if (dns.length) exec('ip name-server ' + dns.join(' '));
  const next = wirelessConfig(copy)!;
  for (const field of ['wlans', 'policies', 'policyTags', 'apProfiles', 'flexProfiles', 'siteTags', 'rfProfiles', 'rfTags'] as const) next[field] = {} as never;
  // Older forms did not represent empty policy tags. The current GUI declares
  // all tags explicitly, including new tags that have no WLAN mappings yet.
  const explicitTags = form.has('policy-tag-definitions');
  if (!explicitTags) for (const [name, mapping] of Object.entries(original.policyTags)) if (!Object.keys(mapping).length) put(next.policyTags,name,{});
  next.policyTags['default-policy-tag'] ??= {};
  next.assignments = structuredClone(original.assignments);
  for (const mac of presentedAPs) delete next.assignments[canonicalMAC(mac)];
  const retain = (field: keyof WirelessConfiguration, name: string) => {
    const table = next[field] as Record<string, unknown>, old = original[field] as Record<string, unknown>;
    if (entry(old,name)) put(table,name,structuredClone(entry(old,name)));
  };
  for (const [field, name] of [['apProfiles', 'default-ap-profile'], ['flexProfiles', 'default-flex-profile'], ['siteTags', 'default-site-tag'], ['rfTags', 'default-rf-tag']] as const) retain(field, name);
  if (explicitTags) each('policy-tag-name', (_i, name) => { exec('wireless tag policy ' + name); exec('exit'); });
  each('wlan-name', (i, name) => {
    const old = entry(original.wlans,name), security = selected(at('wlan-security', i), ['open', 'wpa2-personal', 'wpa2-enterprise', 'wpa3-personal', 'wpa2-wpa3-personal'], 'wireless security mode');
    retain('wlans', name);
    exec(`wlan ${name} ${at('wlan-id', i)} ${JSON.stringify(String(form.getAll('wlan-ssid')[i] ?? ''))}`);
    if (security === 'open') exec('no security wpa');
    else {
      const sae = security === 'wpa3-personal' || security === 'wpa2-wpa3-personal';
      exec('no security wpa akm sae'); exec('no security wpa wpa3');
      if (security === 'wpa3-personal') { exec('no security wpa akm psk'); exec('no security wpa akm dot1x'); exec('no security wpa wpa2'); }
      else { exec('security wpa wpa2'); exec('security wpa akm ' + (security === 'wpa2-enterprise' ? 'dot1x' : 'psk')); }
      if(sae){exec('security wpa wpa3');exec('security wpa akm sae');}
      if (security !== 'wpa2-enterprise') {
        const key = String(form.getAll('wlan-psk')[i] ?? '');
        if (key) exec('security wpa psk set-key ' + (/^[a-f0-9]{64}$/i.test(key) ? 'hex' : 'ascii') + ' 0 ' + JSON.stringify(key));
        else exec('no security wpa psk set-key');
      } else {
        const list = at('wlan-auth', i);
        if (!Object.hasOwn(next.dot1xLists,list)) throw Error('Select an existing 802.1X authentication list for WLAN ' + name + '.');
        if (old && old.authenticationList === undefined && list === 'default') delete next.wlans[name].authenticationList;
        else exec('security dot1x authentication-list ' + list);
      }
      if (old?.security === security) {
        if (old.akmEnabled === undefined) delete next.wlans[name].akmEnabled;
        if (old.wpa2Enabled === undefined) delete next.wlans[name].wpa2Enabled;
        if (old.saeEnabled === undefined) delete next.wlans[name].saeEnabled;
        if (old.wpa3Enabled === undefined) delete next.wlans[name].wpa3Enabled;
        if (old.akmEnabled === false) exec('no security wpa akm ' + (security === 'wpa2-enterprise' ? 'dot1x' : 'psk'));
        if (old.wpa2Enabled === false) exec('no security wpa wpa2');
        if (old.saeEnabled === false) exec('no security wpa akm sae');
        if (old.wpa3Enabled === false) exec('no security wpa wpa3');
      }
    }
    if(form.getAll('wlan-pmf')[i]!==undefined){const pmf=selected(at('wlan-pmf',i),['','disabled','optional','required'],'Protected Management Frames mode');exec(pmf?'security pmf '+({disabled:'disable',optional:'optional',required:'mandatory'}[pmf]):'no security pmf');}
    exec(selected(at('wlan-enabled', i), ['on', 'off'], 'WLAN status') === 'on' ? 'no shutdown' : 'shutdown');
    exec(selected(at('wlan-broadcast', i), ['on', 'off'], 'SSID advertisement') === 'on' ? 'broadcast-ssid' : 'no broadcast-ssid'); exec('exit');
  });
  each('policy-name', (i, name) => {
    retain('policies', name); exec('wireless profile policy ' + name); exec('vlan ' + at('policy-vlan', i));
    exec(selected(at('policy-switch', i), ['central', 'local'], 'switching mode') === 'central' ? 'central switching' : 'no central switching');
    for(const[field,command]of [['policy-acl','ipv4 acl'],['policy-input','service-policy input'],['policy-output','service-policy output'],['policy-client-input','service-policy client input'],['policy-client-output','service-policy client output']])if(form.has(field))exec(at(field,i)?command+' '+at(field,i):'no '+command);
    exec('session-timeout ' + at('policy-timeout', i)); exec(selected(at('policy-enabled', i), ['on', 'off'], 'policy status') === 'on' ? 'no shutdown' : 'shutdown'); exec('exit');
  });
  each('join-name', (i, name) => { retain('apProfiles', name); exec('ap profile ' + name); exec('ap capwap timers heartbeat-timeout ' + at('join-echo', i)); exec('exit'); });
  each('flex-name', (i, name) => { retain('flexProfiles', name); exec('wireless profile flex ' + name); exec('native-vlan-id ' + at('flex-native', i)); exec('exit'); });
  each('site-name', (i, name) => {
    retain('siteTags', name); exec('wireless tag site ' + name); exec('ap-profile ' + at('site-join', i)); exec('flex-profile ' + at('site-flex', i));
    exec(selected(at('site-local', i), ['local', 'flex'], 'AP operating mode') === 'local' ? 'local-site' : 'no local-site'); exec('exit');
  });
  each('rf-name', (i, name) => {
    const band = selected(at('rf-band', i), ['2.4', '5'], 'RF band');
    if (entry(original.rfProfiles,name)?.band === band) retain('rfProfiles', name);
    exec('ap dot11 ' + (band === '2.4' ? '24ghz' : '5ghz') + ' rf-profile ' + name); exec('tx-power max ' + at('rf-power', i));
    exec('channel chan-width ' + at('rf-width', i)); exec(selected(at('rf-enabled', i), ['on', 'off'], 'RF profile status') === 'on' ? 'no shutdown' : 'shutdown'); exec('exit');
    // This simulated RF profile also carries its channel selection. Older forms
    // omit the field, so preserve their existing selection rather than reset it.
    if(form.getAll('rf-channel')[i]!==undefined){
      const raw=at('rf-channel',i),channel=Number(raw),allowed=band==='2.4'?[0,1,6,11]:[0,36,40,44,48,149,153,157,161,165];
      if(!/^\d+$/.test(raw)||!allowed.includes(channel))throw Error('Select an allowed channel for the RF profile band.');
      next.rfProfiles[name].channel=channel;
    }
  });
  each('rftag-name', (i, name) => {
    retain('rfTags', name); exec('wireless tag rf ' + name);
    exec(at('rftag-24', i) ? '24ghz-rf-policy ' + at('rftag-24', i) : 'no 24ghz-rf-policy');
    exec(at('rftag-5', i) ? '5ghz-rf-policy ' + at('rftag-5', i) : 'no 5ghz-rf-policy'); exec('exit');
  });
  const mappings = new Set<string>();
  each('tag-name', (i, name) => {
    if (explicitTags && !Object.hasOwn(next.policyTags,name)) throw Error('Select an existing policy tag for the WLAN mapping.');
    const pair = JSON.stringify([name, at('tag-wlan', i)]);
    if (mappings.has(pair)) throw Error('Duplicate WLAN mapping in policy tag ' + name + '.');
    mappings.add(pair); exec('wireless tag policy ' + name); exec('wlan ' + at('tag-wlan', i) + ' policy ' + at('tag-policy', i)); exec('exit');
  }, false);
  each('ap-mac', (i, mac) => { exec('ap ' + mac); exec('policy-tag ' + at('ap-policy', i)); exec('site-tag ' + at('ap-site', i)); exec('rf-tag ' + at('ap-rf', i)); exec('exit'); });
  validateWireless('wlc', next);
  return copy.config;
}
