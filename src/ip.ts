export function isIPv4(value: string): boolean { return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(x => +x <= 255 && String(+x) === x); }
export function ipToInt(value: string): number { if (!isIPv4(value)) throw new Error('Invalid IPv4 address: ' + value); return value.split('.').reduce((n, x) => (n * 256 + Number(x)) >>> 0, 0); }
export function intToIp(value: number): string { return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.'); }
export function prefixToMask(prefix: number): string { if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('IPv4 prefix must be 0–32'); return intToIp(prefix ? (0xffffffff << (32 - prefix)) >>> 0 : 0); }
export function maskToPrefix(mask: string): number { const n = ipToInt(mask); let prefix = 0, zero = false; for (let bit = 31; bit >= 0; bit--) { if ((n >>> bit) & 1) { if (zero) throw new Error('Subnet mask must be contiguous'); prefix++; } else zero = true; } return prefix; }
export function networkAddress(address: string, maskOrPrefix: string | number): string { const prefix = typeof maskOrPrefix === 'number' ? maskOrPrefix : maskToPrefix(maskOrPrefix); return intToIp((ipToInt(address) & ipToInt(prefixToMask(prefix))) >>> 0); }
export function broadcastAddress(address: string, prefix: number): string { return intToIp((ipToInt(networkAddress(address, prefix)) | (~ipToInt(prefixToMask(prefix)))) >>> 0); }
export function inSubnet(address: string, network: string, maskOrPrefix: string | number): boolean { try { return networkAddress(address, maskOrPrefix) === networkAddress(network, maskOrPrefix); } catch { return false; } }
export function validHost(address: string, mask: string): boolean { try { const prefix = maskToPrefix(mask); return prefix >= 31 || (address !== networkAddress(address, prefix) && address !== broadcastAddress(address, prefix)); } catch { return false; } }
export function ipv6ToBigInt(value: string): bigint {
  let address = value.toLowerCase().split('%')[0];
  if (address.includes('.')) { const last = address.lastIndexOf(':'); const v4 = ipToInt(address.slice(last + 1)); address = address.slice(0, last + 1) + (v4 >>> 16).toString(16) + ':' + (v4 & 65535).toString(16); }
  if (!/^[0-9a-f:]+$/.test(address) || address.split('::').length > 2) throw new Error('Invalid IPv6 address');
  const halves = address.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  if ((halves.length === 1 && left.length !== 8) || (halves.length === 2 && left.length + right.length >= 8)) throw new Error('Invalid IPv6 address');
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) throw new Error('Invalid IPv6 address');
  return groups.reduce((n, group) => (n << 16n) | BigInt(parseInt(group, 16)), 0n);
}
export function isIPv6(value: string): boolean { try { return value.includes(':') && ipv6ToBigInt(value) >= 0n; } catch { return false; } }
export function bigIntToIPv6(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & 65535n).toString(16));
  let start = -1, size = 1;
  for (let i = 0; i < groups.length;) { if (groups[i] !== '0') { i++; continue; } let j = i; while (groups[j] === '0') j++; if (j - i > size) { start = i; size = j - i; } i = j; }
  return start < 0 ? groups.join(':') : groups.slice(0, start).join(':') + '::' + groups.slice(start + size).join(':');
}
export function ipv6Network(address: string, prefix: number): string { if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) throw new Error('IPv6 prefix must be 0–128'); const shift = BigInt(128 - prefix); return bigIntToIPv6((ipv6ToBigInt(address) >> shift) << shift); }
export function sameAddress(a: string, b: string): boolean { if (a === b) return true; return isIPv6(a) && isIPv6(b) && ipv6ToBigInt(a) === ipv6ToBigInt(b); }
export function prefixContains(network: string, prefix: number, address: string): boolean { if (isIPv4(network) && isIPv4(address)) return inSubnet(address, network, prefix); if (isIPv6(network) && isIPv6(address)) return ipv6Network(network, prefix) === ipv6Network(address, prefix); return false; }
export function parseCidr(value: string): { address: string; network: string; prefix: number; family: 4 | 6 } {
  const [address, suffix, extra] = value.split('/'); const family = isIPv4(address) ? 4 : isIPv6(address) ? 6 : null;
  if (!family || extra !== undefined || (suffix !== undefined && !/^\d+$/.test(suffix))) throw new Error('Invalid IP prefix');
  const prefix = suffix === undefined ? (family === 4 ? 32 : 128) : Number(suffix);
  return { address, network: family === 4 ? networkAddress(address, prefix) : ipv6Network(address, prefix), prefix, family };
}
export const ipv4Network = networkAddress;
export const ipToNumber = ipToInt;
export const numberToIp = intToIp;
