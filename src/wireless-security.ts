/** Original SHA-1/HMAC/PBKDF2 implementation for deterministic WPA2 key proofs.
 * The simulator models EAPOL state/MICs, not a wire-compatible CCMP cipher. */
const bytes=(text:string)=>new TextEncoder().encode(text);
const cat=(...parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let n=0;for(const p of parts){out.set(p,n);n+=p.length;}return out;};
export function sha1(input:Uint8Array):Uint8Array {
 const size=Math.ceil((input.length+9)/64)*64,data=new Uint8Array(size);data.set(input);data[input.length]=128;const dv=new DataView(data.buffer);dv.setUint32(size-8,Math.floor(input.length/0x20000000));dv.setUint32(size-4,input.length*8>>>0);
 let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476,e0=0xc3d2e1f0;const w=new Int32Array(80),rol=(x:number,n:number)=>(x<<n)|(x>>>(32-n));
 for(let off=0;off<size;off+=64){for(let i=0;i<16;i++)w[i]=dv.getInt32(off+i*4);for(let i=16;i<80;i++)w[i]=rol(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);let a=a0,b=b0,c=c0,d=d0,e=e0;for(let i=0;i<80;i++){const f=i<20?(b&c)|(~b&d):i<40?b^c^d:i<60?(b&c)|(b&d)|(c&d):b^c^d,k=i<20?0x5a827999:i<40?0x6ed9eba1:i<60?0x8f1bbcdc:0xca62c1d6,t=(rol(a,5)+f+e+k+w[i])|0;e=d;d=c;c=rol(b,30);b=a;a=t;}a0=(a0+a)|0;b0=(b0+b)|0;c0=(c0+c)|0;d0=(d0+d)|0;e0=(e0+e)|0;}
 const out=new Uint8Array(20),v=new DataView(out.buffer);[a0,b0,c0,d0,e0].forEach((x,i)=>v.setInt32(i*4,x));return out;
}
export function hmacSha1(key:Uint8Array,message:Uint8Array):Uint8Array {if(key.length>64)key=sha1(key);const inner=new Uint8Array(64).fill(0x36),outer=new Uint8Array(64).fill(0x5c);for(let i=0;i<key.length;i++){inner[i]^=key[i];outer[i]^=key[i];}return sha1(cat(outer,sha1(cat(inner,message))));}
const cache=new Map<string,Uint8Array>();
export function wpa2PMK(passphrase:string,ssid:string):Uint8Array {
 const id=JSON.stringify([passphrase,ssid]),known=cache.get(id);if(known)return known;
 if(/^[a-f0-9]{64}$/i.test(passphrase))return Uint8Array.from(passphrase.match(/../g)!,x=>parseInt(x,16));
 const key=bytes(passphrase),salt=bytes(ssid),out=new Uint8Array(40);for(let block=1;block<=2;block++){let u=hmacSha1(key,cat(salt,Uint8Array.of(0,0,0,block))),t=new Uint8Array(u);for(let j=1;j<4096;j++){u=hmacSha1(key,u);for(let n=0;n<20;n++)t[n]^=u[n];}out.set(t,(block-1)*20);}const pmk=out.slice(0,32);if(cache.size>256)cache.clear();cache.set(id,pmk);return pmk;
}
export function keyProof(key:Uint8Array,context:unknown):string {return [...hmacSha1(key,bytes(JSON.stringify(context)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function sessionKey(pmk:Uint8Array,bssid:string,client:string,anonce:string,snonce:string):Uint8Array {return hmacSha1(pmk,bytes(JSON.stringify(['Pairwise key expansion',...[bssid,client].sort(),...[anonce,snonce].sort()])));}
export function validPSK(value:string):boolean{return /^[\x20-\x7e]{8,63}$/.test(value)||/^[a-f0-9]{64}$/i.test(value);}
/** Logical SAE teaching proof, deliberately not the elliptic-curve SAE key
 * agreement. Commit nonces bind the simulated confirmation and installed key. */
export function logicalSAEKey(password:string,context:unknown):Uint8Array{return cat(hmacSha1(bytes(password),bytes(JSON.stringify(['logical SAE',context,1]))),hmacSha1(bytes(password),bytes(JSON.stringify(['logical SAE',context,2])))).slice(0,32);}
