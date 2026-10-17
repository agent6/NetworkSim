#!/usr/bin/env node
import {commandRejected} from './audit-command-fixtures.mjs';
/** Independent, read-only reference CLI audit. Reference code is evaluated only in
 * a Node VM with inert DOM/timer adapters; it is never imported by the product. */
import fs from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import { renderConfig } from '../src/config-renderer.ts';
import { commandContexts, commandVariants } from './audit-command-contexts.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reference=path.resolve(process.env.NETWORK_SANDBOX_REFERENCE||path.join(root,'network-sandbox'));
const outDir=path.join(root,'.research','command-parity');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const read=file=>fs.readFileSync(path.join(reference,file),'utf8');
const json=(file,data)=>fs.writeFileSync(path.join(outDir,file+(file==='summary.json'?'':'.gz')),file==='summary.json'?JSON.stringify(data,null,2)+'\n':gzipSync(JSON.stringify(data)));

export function loadReference(){
  const adapters={elements:new Set(),skipped:[],initializers:[],warnings:[]},elements=new Map(),argumentGrammars=[];
  let captureSources=true;
  function element(id='anonymous'){
    adapters.elements.add(id);
    if(elements.has(id))return elements.get(id);
    const el={id,value:'',textContent:'',innerHTML:'',hidden:false,style:{},dataset:{},children:[],childNodes:[],scrollTop:0,scrollHeight:0,clientHeight:800,clientWidth:1200,
      classList:{add(){},remove(){},toggle(){},contains(){return false;}},
      addEventListener(){},removeEventListener(){},setAttribute(){},getAttribute(){return null;},removeAttribute(){},
      appendChild(child){this.children.push(child);return child;},append(){},prepend(){},remove(){},replaceChildren(){this.children=[];},
      querySelector(){return null;},querySelectorAll(){return [];},matches(){return false;},closest(){return null;},
      focus(){},blur(){},setSelectionRange(){},getBoundingClientRect(){return {x:0,y:0,width:1200,height:800,top:0,left:0,right:1200,bottom:800};}};
    elements.set(id,el);return el;
  }
  const document={currentScript:{src:pathToFileURL(path.join(reference,'js/namespace.js')).href},body:element('body'),documentElement:element('html'),
    getElementById:element,createElement:tag=>element('created:'+tag),createElementNS:(_,tag)=>element('created:'+tag),createTextNode:text=>({textContent:text}),
    querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){},removeEventListener(){}};
  let timerId=0;
  const context=vm.createContext({document,URL,URLSearchParams,TextEncoder,TextDecoder,structuredClone,Uint8Array,ArrayBuffer,DataView,performance,AbortController,AbortSignal,
    console:{log(){},warn:(...args)=>adapters.warnings.push(args.map(String).join(' ')),error:(...args)=>adapters.warnings.push(args.map(String).join(' '))},
    setTimeout:()=>++timerId,clearTimeout(){},setInterval:()=>++timerId,clearInterval(){},requestAnimationFrame:()=>++timerId,cancelAnimationFrame(){},
    Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    addEventListener(){},removeEventListener(){},dispatchEvent(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
    location:{href:pathToFileURL(path.join(reference,'index.html')).href,search:'',hash:'',protocol:'file:'},navigator:{userAgent:'Independent Node VM command audit',platform:'audit'},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),getComputedStyle:()=>({getPropertyValue(){return '';}})});
  context.window=context;context.self=context;context.parent=context;context.globalThis=context;
  const html=read('index.html'),scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(m=>m[1]);
  const sources=[];let app;const initializers=new Map();
  for(const file of scripts){
    if(!file.startsWith('js/'))continue;
    const text=read(file);sources.push({file,sha256:hash(text),bytes:Buffer.byteLength(text)});
    if(file==='js/app.js')continue;
    document.currentScript.src=pathToFileURL(path.join(reference,file)).href;
    vm.runInContext(text,context,{filename:file,timeout:10000});
    if(file==='js/namespace.js'){
      app=context.NETLAB;app.options.testMode=true;app.options.virtualClock=Date.UTC(2026,0,1);
      app.options.storageAdapter={getItem(){return null;},setItem(){},removeItem(){},clear(){}};
      app.startup.provide=(name,fn)=>{if(initializers.has(name))throw Error('Duplicate initializer '+name);initializers.set(name,{fn,file:document.currentScript.src});};
    }
  }
  const factory=app.cli.parser.q;
  app.cli.parser.q=function(...args){const node=factory(...args);if(!captureSources)return node;const frames=new Error().stack.split('\n').slice(2);
    node._auditSource=frames.filter(x=>/js\//.test(x)).map(x=>x.trim()).slice(0,8);return node;};
  const order=JSON.parse(read('js/app.js').match(/app\.startup\.run\((\[[\s\S]*?\])\)/)[1].replace(/,\s*]/g,']'));
  // UI bootstrap and persistence repository are not needed to execute command handlers.
  const skipped=new Set(['ui.topologyModel.1','ui.history.1','ui.topologyOperations.1','storage.repository.1','ui.topologyViewport.1','ui.topologyEditor.1','ui.panels.1','ui.icons.1','ui.application.1','labs.definitions.open']);
  for(const name of order){
    if(skipped.has(name)){adapters.skipped.push(name);continue;}
    const entry=initializers.get(name);if(!entry)throw Error('Missing initializer '+name);
    try{entry.fn();adapters.initializers.push(name);}catch(error){throw Error(`Initializer ${name}: ${error.stack}`);}
    if(name==='cli.grammar.1'){
      const gram=app.appServices.helpers.gram,aide=gram.aide,node=gram.node;
      gram.aide=function(mode,command,patterns,...rest){const grammar=aide.call(this,mode,command,patterns,...rest);if(!captureSources)return grammar;const record={mode,path:command,patterns:plain(patterns),source:new Error().stack.split('\n').slice(2).filter(s=>s.includes('js/')).slice(0,5)};
        grammar._auditAide=record;argumentGrammars.push(record);return grammar;};
      gram.node=function(...args){const result=node.apply(this,args);result._auditAide=args[2]?._auditAide;return result;};
    }
  }
  // Deferred feature registration is part of the application startup contract.
  app.startup.ready();
  app.lab({title:'Command audit',devices:[],links:[]});
  return {app,context,adapters,sources,scripts,argumentGrammars,stopCapturingSources(){captureSources=false;}};
}

function plain(value){
  if(typeof value==='function')return '[dynamic function]';
  if(value===undefined)return undefined;
  try{return JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='function'?'[dynamic function]':v));}catch{return String(value);}
}

export function inventoryReference(env){
  const {app}=env,rows=[],models=app.devices.registry.ot.filter(p=>p.ports!==undefined&&p.type).map(p=>({model:p.name,type:p.type,ports:p.ports}));
  const selected=models;
  for(const spec of selected){
    const name='AUDIT',result=app.addDevice({...spec,name,console:false,...(spec.ports===''?{interfaces:{}}:{})});
    if(result!==true)throw Error('Create '+spec.model+': '+result);
    const d=app.api.device(name),trees=app.cli.registry.Ji(d);
    function walk(nodes,mode,parents=[],hidden=false,ancestors=[]){
      for(const node of nodes||[]){if(ancestors.includes(node))throw Error('Cyclic command tree');const words=[...parents,node.kw];
        const run=typeof node.run==='function',arg=!!node.arg,imageOnly=!!node.imageOnly;
        rows.push({model:spec.model,type:spec.type,mode,path:words.join(' '),run,arg,imageOnly,hidden:hidden||!!node.hidden,
          executable:run&&!imageOnly,runWhen:typeof node.runWhen==='function',when:typeof node.when==='function',noRun:!!node.noRun,
          help:node.help,argumentHelp:plain(node.argHelp),argumentMax:node.argMax,argumentShrink:plain(node.argShrink),
          modeSwitch:plain(node.modeSwitch),positiveOnly:!!node.positiveOnly,noTwin:!!node.noTwin,source:node._auditSource||[],grammar:node._auditAide});
        walk(node.kids,mode,words,hidden,[...ancestors,node]);
      }
      if(nodes?.hidden)walk(nodes.hidden,mode,parents,true,ancestors);
    }
    for(const [mode,nodes]of Object.entries(trees))walk(nodes,mode);
    app.removeDevice(name);
  }
  return {models,rows};
}

const invalid={test:commandRejected};
const setupLines=spec=>spec.exec==='user'?[...(spec.setup||[])]:spec.exec==='priv'?['enable',...(spec.setup||[])]:[...(spec.type==='pc'?[]:['enable','configure terminal']),...(spec.setup||[]),...(spec.priv?['end']:[])];
export function probeReference(env,spec){
  const {app}=env,name='AUDIT';
  const added=app.addDevice({name,type:spec.type||'router',model:spec.model||'NETLAB-R4',console:false});
  if(added!==true)return {error:String(added)};
  const d=app.api.device(name);d.termLength=0;
  try{
    const setup=setupLines(spec),steps=[];
    for(const command of setup){const output=app.helpers.execLine(d,command);steps.push({command,output,mode:d.con.mode});if(invalid.test(output))return {setupError:command,steps};}
    const before=app.helpers.runningFile(d).join('\n'),promptBefore=app.helpers.promptOf(d.con),modeBefore=d.con.mode;
    const output=app.helpers.execLine(d,spec.command);
    return {output,rejected:invalid.test(output),before,running:app.helpers.runningFile(d).join('\n'),modeBefore,mode:d.con.mode,promptBefore,prompt:app.helpers.promptOf(d.con),pendingPrompt:d.ask?.prompt,
      help:spec.help?app.api.helpText(d,spec.help):undefined};
  }catch(e){return {error:e.stack};}finally{app.removeDevice(name);}
}
export function probeNew(spec){
  const sim=new Simulator(),d=sim.addDevice(spec.model==='Server'?'server':spec.type||'router'),session=new IOSSession(sim,d.id);
  try{
    const setup=setupLines(spec),steps=[];
    for(const command of setup){const output=session.execute(command).join('\n');steps.push({command,output,mode:session.mode});if(invalid.test(output))return {setupError:command,steps};}
    const before=renderConfig(d).join('\n'),promptBefore=session.prompt,modeBefore=session.mode;
    const output=session.execute(spec.command).join('\n');
    return {output,rejected:invalid.test(output),before,running:renderConfig(d).join('\n'),modeBefore,mode:session.mode,promptBefore,prompt:session.prompt,
      help:spec.help?session.help(spec.help):undefined};
  }catch(e){return {error:e.stack};}
}

async function referenceCases(env){
  const captured=[],testPromises=[];
  const source=read('tests/commands.test.cjs'),cut=source.indexOf('    for (const spec of cases) {');
  if(cut<0)throw Error('Reference validation case extraction anchor changed');
  const program=source.slice(0,cut)+'    globalThis.captured.push(...cases);\n } finally {}\n});';
  const test=(_name,fn)=>testPromises.push(fn({test(){}}));
  const context=vm.createContext({captured,require(name){if(name==='node:test')return {test};if(name==='./browser.cjs')return {openBrowser:async()=>({})};return {};} });
  vm.runInContext(program,context,{filename:'tests/commands.test.cjs',timeout:10000});
  await Promise.all(testPromises);
  env.app.tests??={};vm.runInContext(read('tests/fixtures/commands.js'),env.context,{filename:'tests/fixtures/commands.js',timeout:10000});
  const fixtures=env.app.tests.commandCases;
  for(const fixture of fixtures){let setup=[];for(const command of fixture.commands){captured.push({name:fixture.name+': '+command,type:fixture.type,model:fixture.model,setup:[...setup],command,fixture:fixture.name});setup.push(command);}for(const command of fixture.undo||[]){captured.push({name:fixture.name+' undo: '+command,type:fixture.type,model:fixture.model,setup:[...setup,'end','configure terminal'],command,fixture:fixture.name});}}
  return [...captured,...commandVariants.map((spec,i)=>({...spec,name:'Independent variant '+i+': '+spec.command}))];
}

function inventoryCurrent(referenceRows){
  const contexts=[],rows=[],comparison=[];
  const choices=Object.entries(commandContexts).flatMap(([mode,spec])=>[[mode,spec],...mode==='config-track'?[[mode,{setup:['track 1 list boolean and']}],[mode,{setup:['track 1 list threshold weight']}]]:[]]);
  for(const [mode,spec] of choices){
    const engine=new Simulator(),device=engine.addDevice(spec.type||'router'),session=new IOSSession(engine,device.id);
    const c=session.c;session.c=function(...args){const result=c.apply(this,args);result.source=new Error().stack.split('\n').slice(2).filter(x=>x.includes('/src/cli.ts:')).slice(0,3);return result;};
    const steps=[];let setupError;
    for(const command of setupLines(spec)){const output=session.execute(command).join('\n');steps.push({command,output,mode:session.mode});if(invalid.test(output)){setupError=command;break;}}
    contexts.push({referenceMode:mode,currentMode:session.mode,prompt:session.prompt,spec,setupError,steps});
    if(!setupError)for(const c of session.commands())rows.push({referenceMode:mode,currentMode:session.mode,path:c.words.join(' '),args:c.args,description:c.description,source:c.source});
  }
  const seen=new Set();
  for(const old of referenceRows.filter(r=>r.executable&&!/^(no|default) /.test(r.path))){
    const key=old.mode+'|'+old.path;if(seen.has(key))continue;seen.add(key);
    const context=contexts.find(c=>c.referenceMode===old.mode&&!c.setupError)||contexts.find(c=>c.referenceMode===old.mode),available=rows.filter(r=>r.referenceMode===old.mode),canonical=old.path.toLowerCase(),exact=available.find(r=>r.path.toLowerCase()===canonical);
    const parent=available.filter(r=>r.args&&canonical.startsWith(r.path.toLowerCase()+' ')).sort((a,b)=>b.path.length-a.path.length)[0];
    const child=available.find(r=>r.path.toLowerCase().startsWith(canonical+' '));
    comparison.push({mode:old.mode,path:old.path,source:old.source,grammar:old.grammar,conditional:old.when||old.runWhen,classification:old.type==='pc'?'host-special-handler-needs-probe':!context?'unmapped-mode':context.setupError?'context-entry-rejected':exact?'exact-registration':parent?'argument-handler-needs-probe':child?'expanded-subcommands-needs-probe':'missing-registration',currentPath:(exact||parent||child)?.path,contextSetup:context?.spec,contextError:context?.setupError});
  }
  const allPaths=[...new Map(referenceRows.filter(r=>r.executable).map(r=>[r.mode+'|'+r.path,r])).values()].map(r=>{
    const modifier=/^(no|default) /.exec(r.path)?.[1],base=r.path.replace(/^(?:no|default) /,''),match=comparison.find(c=>c.mode===r.mode&&c.path===base);
    return {mode:r.mode,path:r.path,modifier,basePath:base,classification:match?.classification||'modifier-specific-handler-needs-probe',currentPath:match?.currentPath,source:r.source};
  });
  return {contexts,commands:rows,comparison,allPaths};
}

function compare(spec,old,current){
  if(old.error||old.setupError)return 'reference-probe-error';
  if(current.error)return 'new-probe-error';
  if(current.setupError)return 'new-setup-rejected';
  if(old.rejected!==current.rejected)return old.rejected?'new-accepts-reference-rejects':'new-rejects-reference-accepts';
  if(old.rejected&&current.before!==current.running)return 'rejected-command-mutates-config';
  if(!old.rejected&&old.before!==old.running&&current.before===current.running)return 'reference-config-changes-new-does-not';
  return 'acceptance-agrees';
}

async function main(){
  fs.mkdirSync(outDir,{recursive:true});
  const env=loadReference();
  const inventory=inventoryReference(env);
  const manifest={schemaVersion:1,generatedAt:new Date().toISOString(),referenceRoot:reference,
    method:'Executed supplied source startup and command registration in an isolated Node VM. DOM and wall-clock timers are inert adapters; no browser or external transport is used.',
    sources:env.sources,adapters:{...env.adapters,elements:[...env.adapters.elements]},modules:env.app.modules(),models:inventory.models,commands:inventory.rows,argumentGrammars:env.argumentGrammars};
  json('reference-manifest.json',manifest);
  const current=inventoryCurrent(inventory.rows);json('current-manifest.json',current);
  env.stopCapturingSources();
  const counts={scripts:env.sources.length,modules:manifest.modules.length,models:inventory.models.length,rows:inventory.rows.length,
    executableRows:inventory.rows.filter(r=>r.executable).length,uniqueExecutableModePaths:new Set(inventory.rows.filter(r=>r.executable).map(r=>r.mode+'|'+r.path)).size,
    argumentHandlerRows:inventory.rows.filter(r=>r.arg&&r.executable).length,catalogOnlyRows:inventory.rows.filter(r=>r.imageOnly).length};
  if(process.argv.includes('--inventory-only')){json('summary.json',counts);console.log(JSON.stringify(counts,null,2));return;}
  const cases=await referenceCases(env),probes=cases.map((spec,i)=>{if(i%100===0)process.stderr.write(`Probe ${i}/${cases.length}\n`);const old=probeReference(env,spec),current=probeNew(spec);return {spec,reference:old,current,classification:compare(spec,old,current)};});
  json('probes.json',probes);
  counts.probes=probes.length;counts.probeClassifications=Object.fromEntries([...new Set(probes.map(p=>p.classification))].map(k=>[k,probes.filter(p=>p.classification===k).length]));
  json('summary.json',counts);console.log(JSON.stringify(counts,null,2));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack);process.exitCode=1;});
