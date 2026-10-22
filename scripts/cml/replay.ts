/** Replays the same CML scenario through public simulator CLI and packet paths. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Simulator} from '../../src/engine.ts';
import {createCLISession,type CLISession} from '../../src/session.ts';
import {iosRejected} from '../../src/ios-help.ts';
import type {DeviceKind} from '../../src/model.ts';

interface NodeSpec {id:string;kind:DeviceKind;hostname:string;simPort:string;cml:{port:string};portMap?:Record<string,string>;simulatorSetup:string[]}
interface Step {id:string;node:string;command:string;simCommand?:string;waitSeconds?:number;expect?:string[];absent?:string[];sensitive?:boolean}
export interface Scenario {schemaVersion:number;id:string;nodes:NodeSpec[];links:{node:string;port:string}[][];steps:Step[];surveys?:{node:string;commands:string[]}[]}
const rejectedOutput=(raw:string)=>/^\s*(?:%?\s*(?:Invalid\b|Incomplete\b|Ambiguous\b|Unrecognized command|Unsupported\b|Duplicate sequence number|Sequence number already exists|Area mismatch|Permission denied|Value must be)|%[^\r\n]*(?:not implemented|configuration stored only|operational behavior is not simulated))/im.test(raw);
export function replayScenario(scenario:Scenario,digest=''){
  if(scenario.schemaVersion!==1)throw new Error('Unsupported scenario schema');
  const engine=new Simulator(20261021),nodes=new Map<string,{deviceId:string;cli:CLISession;spec:NodeSpec}>();
  for(const spec of scenario.nodes){
    if(nodes.has(spec.id))throw new Error('Duplicate scenario node');
    const device=engine.addDevice(spec.kind);
    nodes.set(spec.id,{deviceId:device.id,cli:createCLISession(engine,device.id,{skipConsoleLogin:true}),spec});
  }
  for(const link of scenario.links){
    if(link.length!==2)throw new Error('A link needs two endpoints');
    const endpoints=link.map(e=>{const n=nodes.get(e.node);if(!n)throw new Error('Unknown link node');return {deviceId:n.deviceId,port:n.spec.portMap?.[e.port]??(e.port===n.spec.cml.port?n.spec.simPort:e.port)};});
    engine.connect(endpoints[0],endpoints[1]);
  }
  for(const {cli,spec}of nodes.values())for(const line of spec.simulatorSetup){
    const command=line.replaceAll('${port}',spec.simPort),out=cli.execute(command);
    if(out.some(iosRejected))throw new Error(`${spec.id} setup rejected ${command}: ${out.join('\n')}`);
  }
  engine.advance(2000);
  const steps:any[]=[];
  for(const step of scenario.steps){
    const session=nodes.get(step.node);if(!session)throw new Error('Unknown step node');
    engine.advance((step.waitSeconds??0)*1000);
    const configuring=session.cli.configurationMode;
    const out=session.cli.execute(step.simCommand??step.command),raw=[...out,session.cli.prompt].join('\n');
    const checks=[...(step.expect??[]).map(pattern=>({pattern,passed:new RegExp(pattern,'m').test(raw)})),
      ...(step.absent??[]).map(pattern=>({absent:pattern,passed:!new RegExp(pattern,'m').test(raw)}))];
    const rejected=rejectedOutput(out.join('\n'))||configuring&&!/^(?:show|ping|traceroute|telnet|ssh)\b/i.test(step.simCommand??step.command)&&out.some(iosRejected);
    const passed=!rejected&&checks.every(c=>c.passed);
    steps.push({id:step.id,node:step.node,command:step.command,raw,checks,timedOut:false,passed});
    if(!passed)break;
  }
  const observations=(scenario.surveys??[]).flatMap(survey=>survey.commands.map(command=>{
    const session=nodes.get(survey.node);if(!session)throw new Error('Unknown survey node');
    if(!/^show\s+[^\r\n]+$/.test(command)||/\|\s*(redirect|append|tee)\b/.test(command))throw new Error('Only read-only show observations are allowed');
    const output=session.cli.execute(command),raw=[...output,session.cli.prompt].join('\n');
    return {node:survey.node,command,raw,timedOut:false,accepted:!rejectedOutput(output.join('\n'))};
  }));
  return {schemaVersion:1,source:'networksim',scenario:scenario.id,scenarioSha256:digest,
    status:steps.length===scenario.steps.length&&steps.every(s=>s.passed)?'replayed':'failed',steps,observations,
    events:engine.events.map(e=>({protocol:e.protocol,label:e.label,detail:e.detail,packet:e.packet}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [scenarioPath,outputPath]=process.argv.slice(2);
  if(!scenarioPath||!outputPath)throw new Error('Usage: node scripts/cml/replay.ts SCENARIO OUTPUT.json');
  const source=readFileSync(scenarioPath),scenario=JSON.parse(source.toString()),digest=createHash('sha256').update(source).digest('hex');
  const report=replayScenario(scenario,digest);
  mkdirSync(resolve(outputPath,'..'),{recursive:true});
  writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
  console.log(`${report.status}: ${report.steps.length}/${scenario.steps.length} steps; ${outputPath}`);
  if(report.status==='failed'){console.error('Failed step:',report.steps.at(-1)?.id);process.exitCode=1;}
}
