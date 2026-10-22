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
      [['end','configure terminal','vrf definition BLUE'], 'rd 65000:10'],
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
