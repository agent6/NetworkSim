import {isIPv4,isIPv6} from './ip.ts';
export const DNS_TYPES=['A','AAAA','CNAME','MX','NS','PTR'] as const;
export type DNSRecordType=typeof DNS_TYPES[number];
export interface DNSRecord {name:string;type:DNSRecordType;value:string;ttl:number;preference?:number}
export interface DNSAnswer {hostname:string;type:DNSRecordType;records:DNSRecord[];address?:string;canonicalName?:string;ttl:number;rcode:'NOERROR'|'NXDOMAIN'|'SERVFAIL';error?:string}
export function dnsName(value:string):string {return String(value).trim().replace(/\.$/,'').toLowerCase();}
export function validateDNSRecord(record:DNSRecord):DNSRecord {
 const name=dnsName(record.name),type=String(record.type).toUpperCase() as DNSRecordType,value=String(record.value).trim();
 if(!name||name.length>253||name.split('.').some(x=>!x||x.length>63||!/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(x)))throw Error('DNS record name is invalid.');
 if(!DNS_TYPES.includes(type))throw Error('DNS record type is unsupported.');
 if(!Number.isInteger(record.ttl)||record.ttl<0||record.ttl>2147483647)throw Error('DNS TTL must be an integer from 0 to 2147483647 seconds.');
 if(type==='A'?!isIPv4(value):type==='AAAA'?!isIPv6(value):!value||value.length>253||dnsName(value).split('.').some(x=>!x||x.length>63||!/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(x)))throw Error('DNS record value does not match its type.');
 if(type==='MX'&&(!Number.isInteger(record.preference)||record.preference!<0||record.preference!>65535))throw Error('MX preference must be an integer from 0 to 65535.');
 return {name,type,value:type==='A'||type==='AAAA'?value:dnsName(value),ttl:record.ttl,...type==='MX'?{preference:record.preference}:{} };
}
/** Legacy address table stays compatible; typed records take precedence per name/type. */
export function dnsRecords(service:any):DNSRecord[]{
 const typed:DNSRecord[]=(service?.resourceRecords??[]).map((r:DNSRecord)=>validateDNSRecord(r));
 const records=[...typed];for(const[name,value]of Object.entries<any>(service?.records??{})){if(typeof value!=='string'||!isIPv4(value)&&!isIPv6(value))continue;const type=isIPv4(value)?'A':'AAAA';if(!typed.some(r=>r.name===dnsName(name)&&r.type===type))records.push({name:dnsName(name),type,value,ttl:service?.ttl??300});}
 return records;
}
export function validateDNSRecords(records:DNSRecord[]):DNSRecord[]{
 const result=records.map(validateDNSRecord),keys=new Set<string>();
 for(const r of result){const key=[r.name,r.type,r.value,r.preference??''].join('|');if(keys.has(key))throw Error('Duplicate DNS record.');keys.add(key);if(r.type==='CNAME'&&result.some(x=>x.name===r.name&&x!==r))throw Error('A CNAME must be the only record at its name.');}
 return result;
}
/** Bounded authoritative teaching server, reached only through delivered UDP/53. */
export function answerDNS(service:any,hostname:string,type:DNSRecordType='A',additionalRecords:DNSRecord[]=[]):DNSAnswer {
 const original=dnsName(hostname),all=[...dnsRecords(service),...additionalRecords.map(validateDNSRecord)],records:DNSRecord[]=[],visited=new Set<string>();let name=original,ttl=2147483647;
 const answer=(rcode:DNSAnswer['rcode'],error?:string):DNSAnswer=>{const positive=records.some(r=>r.type===type),negativeTTL=Math.max(0,Math.min(86400,service?.negativeTTL??30));return {hostname:original,type,records,address:records.find(r=>r.type===type&&(type==='A'||type==='AAAA'))?.value,canonicalName:name,ttl:rcode==='SERVFAIL'?0:positive?ttl:Math.min(ttl,negativeTTL),rcode,...error?{error}:{}};};
 for(let step=0;step<16;step++){
  if(visited.has(name))return answer('SERVFAIL','SERVFAIL');visited.add(name);
  const at=all.filter(r=>r.name===name),selected=at.filter(r=>r.type===type).sort((a,b)=>(a.preference??0)-(b.preference??0));
  if(selected.length){records.push(...selected);ttl=Math.min(ttl,...selected.map(r=>r.ttl));return answer('NOERROR');}
  const alias=at.find(r=>r.type==='CNAME');if(alias&&type!=='CNAME'){records.push(alias);ttl=Math.min(ttl,alias.ttl);name=dnsName(alias.value);continue;}
  if(at.length)return answer('NOERROR'); // Existing name, absent requested type (NODATA).
  return answer('NXDOMAIN','NXDOMAIN');
 }
 return answer('SERVFAIL','SERVFAIL');
}
