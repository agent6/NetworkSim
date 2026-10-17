import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {Simulator} from '../src/engine.ts';
import {parseDocument} from '../src/persistence.ts';
const assets=registerHooks({load(url,context,next){return url.endsWith('.png')?{format:'module',source:'export default "";',shortCircuit:true}:next(url,context);}});
const {ftpDraft,ftpFormFields}=await import('../src/ftp-ui.ts');assets.deregister();
function form(){const f=new FormData();f.set('ftp-form','1');f.set('ftp-enabled','on');f.set('ftp-user','operator');f.set('ftp-password','lab-password');f.set('ftp-user-readonly','true');f.set('ftp-path','configs/router.cfg');f.set('ftp-content','hostname LAB');return f;}
test('FTP-GUI-01 separate account/file form validates a draft without changing the existing service',()=>{
 const e=new Simulator(),server=e.addDevice('server');server.config.services.ftp={enabled:false,users:{existing:{password:'old-password'}},files:{existing:'retained'}};const before=JSON.stringify(server.config),f=form(),draft=ftpDraft(f,server.config);assert.equal(JSON.stringify(server.config),before);assert.equal(draft.enabled,true);assert.equal(draft.users.operator.readOnly,true);assert.equal(draft.files['configs/router.cfg'],'hostname LAB');assert.match(ftpFormFields(draft),/FTP server enabled/);assert.match(ftpFormFields(draft),/configs\/router.cfg/);assert.match(ftpFormFields(draft),/data-ftp-add-user/);assert.equal(ftpDraft(new FormData(),server.config),server.config.services.ftp);
 for(const [key,value]of [['ftp-path','../escape'],['ftp-user',''],['ftp-password',''],['ftp-content','x'.repeat(1048577)]]){const bad=form();bad.set(key,value);assert.throws(()=>ftpDraft(bad,server.config));assert.equal(JSON.stringify(server.config),before);}
});
test('FTP-GUI-02 duplicate account/file rows reject and literal dictionary names survive portable validation',()=>{
 const e=new Simulator(),server=e.addDevice('server');for(const fields of [['ftp-user','ftp-password','ftp-user-readonly'],['ftp-path','ftp-content']]){const f=form();for(const field of fields)f.append(field,String(f.get(field)));assert.throws(()=>ftpDraft(f,server.config),/unique/);}
 const f=form();f.set('ftp-user','constructor');f.set('ftp-path','__proto__');server.config.services.ftp=ftpDraft(f,server.config);server.startupConfig=structuredClone(server.config);const saved=parseDocument(JSON.stringify(e.serialize())),loaded=new Simulator();loaded.load(saved);const ftp=loaded.getDevice(server.id)!.config.services.ftp;assert.ok(Object.hasOwn(ftp.users,'constructor'));assert.equal(ftp.users.constructor.password,'lab-password');assert.ok(Object.hasOwn(ftp.files,'__proto__'));assert.equal(ftp.files.__proto__,'hostname LAB');assert.equal((Object.prototype as any).password,undefined);
});
