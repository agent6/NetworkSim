/** Replay the native AAA matrix with public CLI sessions and actual simulated service traffic. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Simulator} from '../../src/engine.ts';
import {createCLISession,type CLISession} from '../../src/session.ts';
import {iosRejected} from '../../src/ios-help.ts';
import {serializeLabFile} from '../../src/persistence.ts';
export function aaaLab(){
 const engine=new Simulator(684524),ios=engine.addDevice('l3switch',340,220),nx=engine.addDevice('datacenter',570,220),server=engine.addDevice('server',340,390),pc=engine.addDevice('pc',120,220);
 ios.config.hostname='IOS';nx.config.hostname='NX';
 for(const[d,port,n]of [[nx,'mgmt0',1],[server,'GigabitEthernet0',2],[pc,'GigabitEthernet0',3]] as const)engine.connect({deviceId:ios.id,port:'GigabitEthernet0/'+n},{deviceId:d.id,port});
 const cli={IOS:createCLISession(engine,ios.id,{skipConsoleLogin:true}),NX:createCLISession(engine,nx.id,{skipConsoleLogin:true})};cli.IOS.setPrivilege(15);
 const run=(c:CLISession,commands:string[])=>{for(const command of commands){const output=c.execute(command);if(output.some(iosRejected))throw Error(command+': '+output.join('\n'));}};
 run(cli.IOS,['configure terminal','ip domain name netsim.test','crypto key generate rsa modulus 2048','username admin privilege 15 secret NetSimLab42!','vlan 100','exit','interface range GigabitEthernet0/1 - 3','switchport mode access','switchport access vlan 100','spanning-tree portfast','no shutdown','exit','interface Vlan100','ip address 192.168.100.1 255.255.255.0','no shutdown','end']);
 run(cli.NX,['configure terminal','username admin password NetSimLab42! role network-admin','interface mgmt0','ip address 192.168.100.2/24','no shutdown','end']);
 for(const [d,ip]of [[server,'192.168.100.10'],[pc,'192.168.100.30']] as const){Object.assign(d.config.interfaces.GigabitEthernet0,{ip,mask:'255.255.255.0',adminUp:true});delete d.config.interfaces.GigabitEthernet0.features.dhcp;}
 const users={remote:{password:'RemotePass42!',privilege:15,role:'network-admin'},viewer:{password:'Operator42!',privilege:1,role:'network-operator'},noexec:{password:'NoExec42!',privilege:1,authorization:false}};
 for(const protocol of ['radius','tacacs'])server.config.services[protocol]={enabled:true,secret:'LabShared42',users:structuredClone(users)};
 engine.changed();engine.advance(1500);return {engine,ios,nx,server,pc,cli};
}
export function replayAAA(plan:any[]){
 const lab=aaaLab(),{engine,cli,pc}=lab,steps:any[]=[];
 for(const [index,spec]of plan.entries()){
  const row:any={id:`aaa-${String(index+1).padStart(3,'0')}`,node:spec.node,kind:spec.kind};steps.push(row);
  if(spec.kind!=='probe'){
   const commands=spec.commands.map((command:string)=>({command,output:cli[spec.node as 'IOS'|'NX'].execute(command)}));
   row.commands=commands;row.passed=commands.every((c:any)=>!c.output.some(iosRejected));
  }else{
   const client=createCLISession(engine,pc.id),address=spec.node==='IOS'?'192.168.100.1':'192.168.100.2';
   const output=client.execute(`ssh ${spec.username}@${address}`),login=client.execute(spec.password);output.push(...login);
   const authenticated=client.remoteConnected&&!client.passwordInput&&client.prompt===spec.node+'#'||client.remoteConnected&&!client.passwordInput&&client.prompt===spec.node+'>';
   const commands=authenticated?spec.commands.map((command:string)=>({command,raw:client.execute(command).join('\n')})):[];
   row.result={authenticated,username:spec.username,commands,loginOutput:output.join('\n')};
   const body=[...output,...commands.map((c:any)=>c.raw)].join('\n');row.passed=authenticated===spec.authenticated&&spec.expect.every((pattern:string)=>new RegExp(pattern,'i').test(body));client.cancel();
  }
  engine.advance(1000);
 }
 return {schemaVersion:1,source:'simulator',scenario:'aaa',status:steps.every(r=>r.passed)?'passed':'differences',steps,received:lab.server.runtime.features.aaaAccountingReceived??[],events:engine.events.length,lab};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [input,output,example]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/cml/aaa_replay.ts PLAN.json REPLAY.json [EXAMPLE.netsim.yaml]');
 const bytes=readFileSync(input),result=replayAAA(JSON.parse(bytes.toString())),{lab,...report}=result;mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({...report,planSha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n');
 if(example){lab.engine.lab.name='AAA — IOS and NX-OS';writeFileSync(example,serializeLabFile(lab.engine.serialize()));}
 console.log(`AAA simulator: ${report.status}; ${report.steps.filter(r=>r.passed).length}/${report.steps.length}`);if(report.status!=='passed')process.exitCode=1;
}
