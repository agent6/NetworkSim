import type {Device} from './model.ts';
import {bigIntToIPv6,ipv6ToBigInt} from './ip.ts';
/** Resolve named IPv6 prefixes without treating their derived addresses as static literals. */
export function syncIPv6GeneralPrefixes(device:Device):void {
 for(const port of Object.values(device.config.interfaces)){
  const rows:any[]=port.features.ipv6General??[];
  for(const row of rows){const prefix=device.config.features.ipv6GeneralPrefixes?.[row.name];let address:string|undefined;if(prefix&&prefix.prefix<=row.prefix){const low=(1n<<BigInt(128-prefix.prefix))-1n;address=bigIntToIPv6(ipv6ToBigInt(prefix.network)|(ipv6ToBigInt(row.suffix)&low))+'/'+row.prefix;}
   if(row.address!==address){if(row.address)port.ipv6=port.ipv6.filter(v=>v!==row.address);if(address&&!port.ipv6.includes(address))port.ipv6.push(address);row.address=address;}
  }
 }
}
