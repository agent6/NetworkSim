import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';

test('CML evidence gates reject incomplete, tampered and configuration-only results offline',()=>{
  const result=spawnSync('python3',['-m','unittest','discover','-s','scripts/cml','-p','test_workflow.py'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});

test('unsupported retained-only configuration is rejected atomically on IOS nodes',()=>{
  for(const kind of ['router','switch','l3switch','poeswitch'] as const){
    const engine=new Simulator(20261021),device=engine.addDevice(kind),cli=new IOSSession(engine,device.id);
    cli.execute('enable');cli.execute('configure terminal');
    for(const [setup,command] of [
      [[], 'redundancy'],
      [['line console 0'], 'speed 9600'],
      [['end','configure terminal','vrf definition BLUE'], 'route-target both 65000:10'],
      [['end','configure terminal','router ospf 1'], 'timers pacing flood 25'],
    ] as [string[],string][]){
      for(const line of setup)cli.execute(line);
      const before=JSON.stringify(device.config),mode=cli.mode;
      assert.match(cli.execute(command).join('\n'),/not implemented.*No configuration was changed/,`${kind}: ${command}`);
      assert.equal(JSON.stringify(device.config),before,`${kind}: ${command} mutated configuration`);
      assert.equal(cli.mode,mode);
    }
  }
});

test('CML operational scenario forwards IPv4/PAT and IPv6 with Cisco-derived Nexus costs',async()=>{
  const {readFileSync}=await import('node:fs'),{replayScenario}=await import('../scripts/cml/replay.ts');
  const scenario=JSON.parse(readFileSync('scripts/cml/scenarios/operations.json','utf8'));
  const result=replayScenario(scenario);
  assert.equal(result.status,'replayed');assert.equal(result.steps.length,14);assert.equal(result.observations.length,80);
  const output=(node:string,command:string)=>result.observations.find(o=>o.node===node&&o.command===command)!.raw;
  assert.match(output('ios','show ip route'),/198\.51\.100\.0 \[110\/41\]/);
  assert.match(output('nxos','show spanning-tree'),/Eth1\/1\s+Desg FWD 4\s/);
  const nat=result.steps.find(s=>s.id==='translated-flow').raw.split('\n').find((s:string)=>s.startsWith('icmp '))!.trim().split(/\s+/);
  assert.equal(nat[1].split(':')[1],nat[4].split(':')[1],'ICMP outside-global identifier is the translated identifier');
  assert.equal(nat[2].split(':')[1],nat[3].split(':')[1],'ICMP outside-local identifier is the original identifier');
});

test('reviewed operational evidence retains exact scenario provenance and full command coverage',async()=>{
  const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');
  const scenario=readFileSync('scripts/cml/scenarios/operations.json'),spec=JSON.parse(scenario.toString()),fixture=JSON.parse(readFileSync('scripts/cml/fixtures/operations-observations.json','utf8'));
  assert.equal(fixture.scenarioSha256,createHash('sha256').update(scenario).digest('hex'));
  assert.equal(fixture.baseline,'warm-owned-lab');assert.equal(fixture.comparisonStatus,'output-review-required');
  assert.deepEqual(fixture.commandAvailability.map((x:any)=>[x.node,x.command]),spec.surveys.flatMap((s:any)=>s.commands.map((c:string)=>[s.node,c])));
  assert.equal(fixture.packetEvidence.length,5);assert.equal(fixture.packetEvidence.reduce((n:number,p:any)=>n+p.packets,0),1124);
  for(const item of fixture.contracts)assert.match(item.observed,new RegExp(item.pattern));
});

test('CML follow-up scenario enforces ACL denial/recovery and STP SVI withdrawal through public CLI',async()=>{
 const {readFileSync}=await import('node:fs'),{replayScenario}=await import('../scripts/cml/replay.ts');
 const spec=JSON.parse(readFileSync('scripts/cml/scenarios/fidelity-regressions.json','utf8')),result=replayScenario(spec);
 assert.equal(result.status,'replayed',JSON.stringify(result.steps.at(-1)));assert.equal(result.steps.length,74);assert.equal(result.observations.length,80);
 const checks=result.steps.filter(s=>s.checks.length);assert.ok(checks.some(s=>s.command==='show ip access-lists NS_AUDIT'&&s.raw.includes('[match=3]')));
 assert.ok(checks.some(s=>s.command==='show interface Vlan10'&&s.raw.includes('Vlan10 is down')));assert.ok(checks.some(s=>s.command==='show interface Vlan10'&&s.raw.includes('Vlan10 is up')));
 assert.ok(result.events.some(e=>e.label==='Egress ACL denied'));assert.ok(result.steps.filter(s=>s.command==='ping 192.0.2.9 repeat 3').at(-1).raw.includes('Success rate is 100 percent'));
 const node={...spec.nodes.find((n:any)=>n.id==='nxos'),simulatorSetup:[]};for(const commands of [['conf t','ip access-list TEST','10 permit ip any any','10 deny icmp any any'],['conf t','router ospf MISSING']]){const invalid={schemaVersion:1,id:'invalid-config',nodes:[node],links:[],steps:commands.map((command,i)=>({id:'invalid-'+i,node:'nxos',command}))};const negative=replayScenario(invalid);assert.equal(negative.status,'failed');assert.equal(negative.steps.at(-1).passed,false);}
});

test('all original 90 differences have a unique source-bound disposition without hiding unsupported views',async()=>{
 const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto'),source=readFileSync('scripts/cml/scenarios/operations.json'),spec=JSON.parse(source.toString()),ledger=JSON.parse(readFileSync('scripts/cml/fixtures/operations-difference-ledger.json','utf8'));
 assert.equal(ledger.scenarioSha256,createHash('sha256').update(source).digest('hex'));assert.match(ledger.sourceComparisonSha256,/^[0-9a-f]{64}$/);
 assert.equal(ledger.entries.length,90);assert.equal(new Set(ledger.entries.map((e:any)=>e.id)).size,90);assert.deepEqual(ledger.entries.map((e:any)=>e.number),Array.from({length:90},(_,i)=>i+1));
 const expected=new Set([...spec.steps.map((s:any)=>s.id),...spec.surveys.flatMap((s:any)=>s.commands.map((c:string)=>'observe/'+s.node+'/'+c))]);
 for(const entry of ledger.entries){assert.ok(expected.has(entry.id));assert.ok(entry.finding.length>20);assert.ok(entry.evidence.length);}
 assert.equal(ledger.entries.filter((e:any)=>e.disposition==='unsupported-telemetry').length,12);assert.equal(ledger.entries.find((e:any)=>e.id==='observe/nxos/show access-lists').disposition,'fixed');
 const facts=JSON.parse(readFileSync('scripts/cml/fixtures/fidelity-supplemental-observations.json','utf8'));assert.equal(facts.checks.length,16);
 for(const fact of facts.checks){assert.match(fact.observed,new RegExp(fact.pattern));assert.match(facts.runs[fact.run].captureSha256,/^[0-9a-f]{64}$/);}
 assert.equal(facts.checks.find((f:any)=>f.feature==='ingress-not-enforced').status,'excluded-not-validated');assert.equal(facts.checks.find((f:any)=>f.feature==='svi-ingress-not-enforced').status,'excluded-not-validated');
 const freshSource=readFileSync('scripts/cml/scenarios/fidelity-regressions.json'),freshSpec=JSON.parse(freshSource.toString()),fresh=JSON.parse(readFileSync('scripts/cml/fixtures/fidelity-regressions-observations.json','utf8'));assert.equal(fresh.scenarioSha256,createHash('sha256').update(freshSource).digest('hex'));assert.equal(fresh.status,'captured');assert.equal(fresh.labStopped,true);assert.equal(fresh.stepCount,freshSpec.steps.length);assert.equal(fresh.observationCount,80);assert.deepEqual(fresh.problems,[]);assert.equal(fresh.packetEvidence.length,5);assert.equal(fresh.packetEvidence.reduce((n:number,p:any)=>n+p.packets,0),2072);assert.equal(fresh.commandAvailability.filter((a:any)=>a.cmlAccepted!==a.simulatorAccepted).length,12);
 for(const contract of fresh.contracts)for(const check of contract.checks){assert.equal(check.passed,true);if(check.pattern)assert.match(check.observed,new RegExp(check.pattern));}
});
