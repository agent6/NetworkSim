/** User-controlled identifiers are data keys, including ordinary Object prototype names. */
export function ownRecordValue(record:unknown,key:unknown):any {
  return record!==null&&typeof record==='object'&&typeof key==='string'&&Object.hasOwn(record,key)?(record as Record<string,unknown>)[key]:undefined;
}
export function setRecordValue<T>(record:Record<string,T>,key:string,value:T):void {
  Object.defineProperty(record,key,{value,writable:true,enumerable:true,configurable:true});
}
export function accountCredential(record:unknown):string|undefined {
  const value=ownRecordValue(record,'secret')??ownRecordValue(record,'password');
  return typeof value==='string'&&value.length>0?value:undefined;
}
