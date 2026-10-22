import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {iosRejected} from '../src/ios-help.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {readFileSync} from 'node:fs';
import {replayScenario} from '../scripts/cml/replay.ts';
import {createHash} from 'node:crypto';

function run(c:IOSSession,...commands:string[]){for(const command of commands)assert.ok(!c.execute(command).some(iosRejected),command);}
test('fresh VTY selection preserves password checking and the rendered factory configuration',()=>{
  const s=new Simulator(20261021),dut=s.addDevice('router'),probe=s.addDevice('router'),c=new IOSSession(s,dut.id),p=new IOSSession(s,probe.id);
  s.connect({deviceId:dut.id,port:'GigabitEthernet0/0'},{deviceId:probe.id,port:'GigabitEthernet0/0'});
  for(const [cli,ip]of [[c,'192.0.2.1'],[p,'192.0.2.2']] as const)run(cli,'enable','configure terminal','interface g0/0',`ip address ${ip} 255.255.255.0`,'no shutdown','end');
  const before=renderConfig(dut).join('\n');run(c,'configure terminal','line vty 0 4','end');
  assert.equal(renderConfig(dut).join('\n'),before);
  run(c,'configure terminal','line vty 0 4','transport input all','end');
  assert.match(p.execute('telnet 192.0.2.1').join('\n'),/Password required, but none set/);assert.equal(p.prompt,'R2#');
  run(c,'configure terminal','line vty 0 4','password labpass','end');assert.match(p.execute('telnet 192.0.2.1').join('\n'),/User Access Verification/);assert.equal(p.prompt,'Password:');run(p,'labpass');assert.equal(p.prompt,'R1>');
  const closed=p.execute('exit').join('\n');assert.match(closed,/closed by foreign host/);assert.doesNotMatch(closed,/Session returned/);
  run(c,'configure terminal','line vty 0 4','no login','end');run(p,'telnet 192.0.2.1');assert.equal(p.prompt,'R1>');run(p,'exit');
  run(c,'configure terminal','line vty 0 4','default login','end');run(p,'telnet 192.0.2.1');assert.equal(p.prompt,'Password:');p.cancel();
  run(c,'configure terminal','line vty 0 4','default transport input','end');assert.match(p.execute('telnet 192.0.2.1').join('\n'),/refused/);
  assert.equal(dut.config.features.lines['vty 0 4'].transport,'ssh');
  for(const transport of ['none','telnet']){
    run(c,'configure terminal','line vty 0 4','transport input '+transport,'default transport input','end');
    assert.equal(dut.config.features.lines['vty 0 4'].transport,'ssh');
  }
  assert.ok(s.events.some(e=>e.protocol==='TCP'));
});

test('the versioned CML management scenario exercises simulator authentication over delivered packets',()=>{
  const scenario=JSON.parse(readFileSync(new URL('../scripts/cml/scenarios/management.json',import.meta.url),'utf8'));
  const report=replayScenario(scenario);
  assert.equal(report.status,'replayed',JSON.stringify(report.steps.at(-1)));
  assert.equal(report.steps.length,scenario.steps.length);
  assert.ok(report.events.some(e=>e.protocol==='TCP'));
});

test('management output retains the reviewed observations captured from real CML images',()=>{
  const source=readFileSync(new URL('../scripts/cml/scenarios/management.json',import.meta.url));
  const fixture=JSON.parse(readFileSync(new URL('../scripts/cml/fixtures/management-observations.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(source).digest('hex'),fixture.scenarioSha256);
  const report=replayScenario(JSON.parse(source.toString()));assert.equal(report.status,'replayed');
  for(const observation of fixture.observations){
    const step=report.steps.find(s=>s.id===observation.step);assert.ok(step,observation.step);
    assert.equal(step.node,observation.node);assert.equal(step.command,observation.command);
    const lines=step.raw.split('\n').map((row:string)=>row.trimEnd());
    for(const line of observation.lines)assert.ok(lines.includes(line),`${observation.step}: ${JSON.stringify(line)}`);
  }
});
