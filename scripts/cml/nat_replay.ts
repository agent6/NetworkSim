/** Replay captured NAT cases through public CLI and actual simulated packets. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Simulator} from '../../src/engine.ts';
import {createCLISession} from '../../src/session.ts';
import {iosRejected} from '../../src/ios-help.ts';
import {serializeLabFile} from '../../src/persistence.ts';
export function natLab(){
 const engine=new Simulator(684525),ios=engine.addDevice('router',340,200),nx=engine.addDevice('datacenter',340,450),nodes={IOS:ios,NX:nx,I1:engine.addDevice('pc',100,200),O1:engine.addDevice('server',600,200),I2:engine.addDevice('pc',100,450),O2:engine.addDevice('server',600,450)};
 for(const [key,d]of Object.entries(nodes))d.config.hostname=key;
 const cli={IOS:createCLISession(engine,ios.id,{skipConsoleLogin:true}),NX:createCLISession(engine,nx.id,{skipConsoleLogin:true})};cli.IOS.setPrivilege(15);for(const line of ['configure terminal','username admin password NetSimLab42! role network-admin','end'])cli.NX.execute(line);
 for(const [key,router,subnet,port]of [['I1',ios,'192.168.10.',0],['O1',ios,'203.0.113.',1],['I2',nx,'192.168.20.',1],['O2',nx,'198.51.100.',2]] as const){
  const d=nodes[key],p=d.config.interfaces.GigabitEthernet0,inside=key.startsWith('I');
  Object.assign(p,{ip:subnet+(inside?10:100),mask:'255.255.255.0',adminUp:true});delete p.features.dhcp;p.features.secondaryIps=(inside?[11,12]:[101]).map(n=>({ip:subnet+n,mask:'255.255.255.0'}));d.config.defaultGateway=subnet+'1';
  if(!inside)d.config.services.http={enabled:true,content:'NAT/PAT destination reached.'};
  const iface=router===ios?'GigabitEthernet0/'+port:'Ethernet1/'+port,c=router===ios?cli.IOS:cli.NX;
  for(const line of ['configure terminal','interface '+iface,...router===nx?['no switchport']:[],'ip address '+subnet+'1'+(router===nx?'/24':' 255.255.255.0'),'no shutdown','end']){const out=c.execute(line);if(out.some(iosRejected))throw Error(line+': '+out.join('\n'));}
  engine.connect({deviceId:d.id,port:'GigabitEthernet0'},{deviceId:router.id,port:iface});
 }
 const receipts:any[]=[];
 const serve=(protocol:'udp'|'tcp')=>(d:any,p:any,source:string,destination:string)=>{
  const packet=engine.events.findLast(ev=>ev.nodeId===d.id&&ev.label==='Frame received'&&ev.packet?.protocol===protocol.toUpperCase()&&ev.packet?.source===source&&ev.packet?.destination===destination&&ev.packet?.destinationPort===(protocol==='udp'?9000:9001))?.packet;
  const observed={source,sourcePort:packet?.sourcePort,destination,destinationPort:protocol==='udp'?9000:9001,token:p.token};receipts.push({nodeId:d.id,protocol,...observed});return observed;
 };
 engine.registerUDPService(9000,d=>Object.values(nodes).some(n=>n.id===d.id&&['pc','server'].includes(n.kind)),serve('udp'));
 engine.registerTCPService(9001,d=>Object.values(nodes).some(n=>n.id===d.id&&['pc','server'].includes(n.kind)),serve('tcp'));
 engine.changed();engine.advance(1000);return {engine,nodes,cli,receipts};
}
export function replayNAT(plan:any){
 const lab=natLab(),{engine,nodes,cli,receipts}=lab,steps:any[]=[],results:Record<string,any>={};
 const probe=(spec:any)=>{
  const d=nodes[spec.node as keyof typeof nodes];
  if(spec.protocol==='icmp'){const r=engine.ping(d.id,spec.destination,{source:spec.source,count:1,timeout:1000});engine.advance(1100);return {success:r.received===1,received:r.received};}
  const args=[d.id,spec.destination,spec.port??(spec.protocol==='udp'?9000:9001),{token:spec.token},{source:spec.source,sourcePort:spec.sourcePort,timeout:1000}] as const;
  const r=spec.protocol==='udp'?engine.udpRequest(...args):engine.tcpRequest(...args);engine.advance(1100);if(r.status==='failure')engine.advance(3000);return {success:r.status==='success',observed:r.status==='success'?{source:r.source,sourcePort:r.sourcePort,destination:r.destination,destinationPort:r.destinationPort,token:r.token}:undefined,error:r.error};
 };
 for(const spec of plan.steps){
  const row:any={id:spec.id,kind:spec.kind,node:spec.node};steps.push(row);
  if(['config','survey'].includes(spec.kind)){
   const session=cli[spec.node as 'IOS'|'NX'];row.commands=spec.commands.map((entry:any)=>{
    const expected=typeof entry==='string'?{command:entry}:entry,line=expected.command.replaceAll('Ethernet0/','GigabitEthernet0/'),output=session.execute(line);let confirmation=false;
    if('answer'in expected){confirmation=/Static entry in use|Removing the list/.test(session.prompt);output.push(...session.execute(expected.answer));}
    return {command:line,output,confirmation,passed:output.some(iosRejected)===!!expected.reject&&(!('answer'in expected)||confirmation)};
   });row.passed=row.commands.every((c:any)=>c.passed);engine.advance(100);
  }else if(spec.kind==='probe'){
   row.result=results[spec.token]=probe(spec);row.passed=row.result.success===spec.success&&(!spec.success||!spec.observedSource||spec.protocol==='icmp'||row.result.observed?.source===spec.observedSource)&&(!spec.success||!spec.observedRange||spec.protocol==='icmp'||spec.observedRange.includes(row.result.observed?.source))&&(!spec.success||spec.protocol==='icmp'||row.result.observed?.token===spec.token&&Number.isInteger(row.result.observed?.sourcePort));
  }else if(spec.kind==='wait'){engine.advance(spec.seconds*1000);row.passed=true;}
  else if(spec.kind==='unsolicited'){
   let insideReceived=false;const cancel=engine.registerUDPService(spec.insidePort,d=>d.id===nodes.I1.id,()=>{insideReceived=true;return {unexpected:true};});
   row.result=probe({...spec,protocol:'udp',port:results[spec.reference].observed.sourcePort});cancel();row.insideReceived=insideReceived;row.passed=!row.result.success&&!insideReceived;
  }
 }
 return {schemaVersion:1,source:'simulator',scenario:'nat',status:steps.every(r=>r.passed)?'passed':'differences',steps,receipts,lab};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [input,output,example]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/cml/nat_replay.ts PLAN.json REPLAY.json [EXAMPLE.netsim.yaml]');
 const bytes=readFileSync(input),{lab,...report}=replayNAT(JSON.parse(bytes.toString()));mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({...report,scenarioSha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n');
 if(example){
  for(const line of ['configure terminal','feature nat','interface Ethernet1/1','ip nat inside','interface Ethernet1/2','ip nat outside','ip nat inside source static 192.168.20.10 198.51.100.10','end']){const out=lab.cli.NX.execute(line);if(out.some(iosRejected))throw Error(line+': '+out.join('\n'));}
  for(const c of Object.values(lab.cli))c.execute('copy running-config startup-config');
  lab.engine.lab.name='NAT and PAT — IOS and NX-OS';writeFileSync(example,serializeLabFile(lab.engine.serialize()));
 }
 console.log(`NAT simulator: ${report.status}; ${report.steps.filter(r=>r.passed).length}/${report.steps.length}`);if(report.status!=='passed')process.exitCode=1;
}
