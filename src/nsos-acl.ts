import type {Device} from './model.ts';
import {isIPv4,parseCidr} from './ip.ts';
import {ownRecordValue} from './record-map.ts';

/** Deliberately bounded, packet-enforced IPv4 RACL grammar validated on NX-OS. */
export function nsosACLEntry(words:string[],sequence:number):any {
  const [action,protocol]=words.map(w=>w.toLowerCase());
  if(!['permit','deny'].includes(action)||!['ip','icmp'].includes(protocol))throw Error('Only implemented IPv4 ip/icmp permit/deny rules are supported.');
  let index=2;
  const address=()=>{
    const token=words[index++];
    if(token?.toLowerCase()==='any')return 'any';
    if(token?.toLowerCase()==='host'){
      const host=words[index++];if(!isIPv4(host))throw Error('Invalid IPv4 host.');return host+'/32';
    }
    if(!token?.includes('/'))throw Error('Use any, host IPv4-address, or an IPv4 prefix.');
    const prefix=parseCidr(token);if(prefix.family!==4)throw Error('An IPv4 prefix is required.');
    return prefix.network+'/'+prefix.prefix;
  };
  const source=address(),destination=address();
  if(index!==words.length)throw Error('Unsupported ACL qualifier; rule was not applied.');
  return {sequence,action,protocol,source,destination,text:`${action} ${protocol} ${source} ${destination}`};
}
export function nsosACLShow(d:Device,name?:string):string[]{
  const acls=d.config.features.acls??{},keys=name?[name]:Object.keys(acls).sort();
  return keys.flatMap(key=>{
    const acl=ownRecordValue(acls,key);if(!acl)return [];
    return [`IP access list ${key}`,...acl.statistics?['        statistics per-entry']:[],...(acl.entries??[]).map((entry:any)=>`        ${entry.sequence} ${entry.text}${acl.statistics?' [match='+(d.runtime.features.aclHits?.[key+':'+entry.sequence]??0)+']':''}`),''];
  });
}
export function nsosACLConfig(d:Pick<Device,'config'>):string[]{
  return Object.entries<any>(d.config.features.acls??{}).sort(([a],[b])=>a.localeCompare(b)).flatMap(([name,acl])=>[
    'ip access-list '+name,...acl.statistics?[' statistics per-entry']:[],...(acl.entries??[]).map((entry:any)=>' '+entry.sequence+' '+entry.text),' exit',
  ]);
}
