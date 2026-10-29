import {LAB_CATALOG} from './lab-catalog.ts';

export type CatalogRoute={kind:'catalog'}|{kind:'lab';id:string}|{kind:'missing'};
const hasLab=(id:string)=>LAB_CATALOG.some(lab=>lab.id===id);
export function catalogLabHash(id:string):string{
 if(!hasLab(id))throw new Error('This lab is not in the catalog.');
 return '#/labs/'+encodeURIComponent(id);
}
/** Replace only the fragment: keep this deployment's host, port, path and query. */
export function catalogLabPermalink(id:string,currentURL:string):string{
 const url=new URL(currentURL);url.hash=catalogLabHash(id);return url.href;
}
export function parseCatalogRoute(hash:string):CatalogRoute|null{
 if(hash==='#/labs'||hash==='#/labs/')return{kind:'catalog'};
 if(!hash.startsWith('#/labs/'))return null;
 try{const id=decodeURIComponent(hash.slice('#/labs/'.length).replace(/\/$/,''));return hasLab(id)?{kind:'lab',id}:{kind:'missing'};}catch{return{kind:'missing'};}
}
