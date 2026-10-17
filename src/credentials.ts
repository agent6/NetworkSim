/** Legacy IOS Type 7 is reversible configuration obfuscation, not cryptography. */
const type7Pad='dsfd;kfoA,.iyewrkldJKDHSUB';
export function encodeType7(text:string,seed=0):string {
  if(!Number.isInteger(seed)||seed<0||seed>=type7Pad.length)throw new Error('Invalid Type 7 seed');
  return String(seed).padStart(2,'0')+[...new TextEncoder().encode(text)].map((byte,i)=>(byte^type7Pad.charCodeAt((seed+i)%type7Pad.length)).toString(16).padStart(2,'0')).join('').toUpperCase();
}
export function decodeType7(encoded:string):string {
  if(!/^\d{2}(?:[0-9a-f]{2})+$/i.test(encoded))throw new Error('Invalid Type 7 password');const seed=Number(encoded.slice(0,2));if(seed>=type7Pad.length)throw new Error('Invalid Type 7 seed');
  const bytes=Array.from({length:(encoded.length-2)/2},(_,i)=>parseInt(encoded.slice(2+i*2,4+i*2),16)^type7Pad.charCodeAt((seed+i)%type7Pad.length));
  return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes));
}
