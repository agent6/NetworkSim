/** Deterministic authentication model for simulated NTP packets; this is not wire MD5. */
export function ntpAuthenticator(secret:string, message:Record<string,any>):string {
  const input=JSON.stringify([secret,message.transaction,message.t1,message.pollTime,message.t2,message.t3,message.stratum,message.version]);
  let a=2166136261,b=2246822507;
  for(let n=0;n<input.length;n++){a=Math.imul(a^input.charCodeAt(n),16777619);b=Math.imul(b^input.charCodeAt(n),3266489909);}
  return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
