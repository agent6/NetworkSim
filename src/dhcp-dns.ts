import type {Device} from './model.ts';
import {dnsName,dnsRecords,validateDNSRecord,type DNSRecord} from './dns-service.ts';

export interface DHCPDNSRecord extends DNSRecord {clientId:string;expires:number}

/** Lease-owned records are runtime data, never promoted into the manual DNS zone. */
export function automaticDHCPDNSRecords(server:Device,now:number):DHCPDNSRecord[] {
  const {dhcp,dns}=server.config.services;
  if(server.kind!=='server'||!dhcp?.enabled||!dns?.enabled)return [];
  const manual=dnsRecords(dns),records:DHCPDNSRecord[]=[],claimed=new Set(
    manual.filter(r=>r.type==='A'||r.type==='CNAME').map(r=>r.name),
  );
  const configuredTTL=Number(dns.ttl??300);
  const ttl=Number.isFinite(configuredTTL)?Math.max(0,Math.min(2147483647,Math.floor(configuredTTL))):300;
  for(const lease of server.runtime.features.dhcpLeases??[]) {
    if(lease.state!=='BOUND'||!Number.isFinite(lease.expires)||lease.expires<=now||typeof lease.hostname!=='string')continue;
    const hostname=dnsName(lease.hostname),domain=typeof lease.domain==='string'?dnsName(lease.domain):'';
    const names=[hostname];
    if(hostname&&!hostname.includes('.')&&domain)names.push(hostname+'.'+domain);
    for(const name of names) {
      if(claimed.has(name))continue;
      try {
        const record=validateDNSRecord({name,type:'A',value:lease.address,ttl:Math.min(ttl,Math.floor((lease.expires-now)/1000))});
        records.push({...record,clientId:lease.clientId,expires:lease.expires});
        claimed.add(name); // First active binding owns a duplicate name until that lease ends.
      } catch { /* An invalid hostname must not prevent address assignment. */ }
    }
  }
  return records;
}
