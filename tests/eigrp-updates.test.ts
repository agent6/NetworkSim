import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {renderConfig} from '../src/config-renderer.ts';
import type {Device} from '../src/model.ts';

const port='GigabitEthernet0/0';
type WireArgs=Parameters<Simulator['sendControlDatagram']>;
function run(cli:IOSSession,...lines:string[]){for(const line of lines){const out=cli.execute(line);assert.ok(!out.some(s=>s.startsWith('%')),line+': '+out.join('\n'));}}
function configure(cli:IOSSession,n:number,six:boolean,named:boolean){
 run(cli,'enable','configure terminal',...(six?['ipv6 unicast-routing']:[]),'interface '+port,...(six?[`ipv6 address 2001:db8:10::${n}/64`]:[`ip address 10.0.0.${n} 255.255.255.0`]),'no shutdown','interface Loopback0',...(six?[`ipv6 address 2001:db8:${n}::1/64`]:[`ip address 192.0.2.${n} 255.255.255.255`]),'end','configure terminal',named?'router eigrp CAMPUS':six?'ipv6 router eigrp 100':'router eigrp 100');
 if(named)run(cli,`address-family ${six?'ipv6':'ipv4'} unicast autonomous-system 100`);
 run(cli,...(six?[`eigrp router-id 1.1.1.${n}`]:['network 0.0.0.0 255.255.255.255']),'end');
 if(six&&!named)run(cli,'configure terminal','interface '+port,'ipv6 eigrp 100','interface Loopback0','ipv6 eigrp 100','end');
}
function pair(six=false,named=false){const sim=new Simulator(2301),a=sim.addDevice('router'),b=sim.addDevice('router'),ca=new IOSSession(sim,a.id),cb=new IOSSession(sim,b.id);configure(ca,1,six,named);configure(cb,2,six,named);const family=six?'eigrp6':'eigrp',target=six?'2001:db8:2::1':'192.0.2.2',network=six?'2001:db8:2::':'192.0.2.2';return{sim,a,b,ca,cb,family,target,network,connect:()=>sim.connect({deviceId:a.id,port},{deviceId:b.id,port}),settle:()=>sim.advance(six?1600:200)};}
const learned=(d:Device,network:string)=>d.runtime.routes.find(r=>r.network===network&&r.protocol==='D');
function echo(sim:Simulator,d:Device,target:string){const p=sim.ping(d.id,target,{count:1,timeout:400});sim.advance(600);return p.received;}

for(const[six,named]of[[false,false],[false,true],[true,false],[true,true]]as const)test(`${named?'named':'classic'} IPv${six?6:4} INIT/ACK precedes delivered UPDATE; lost advertisements cannot create a route or successful echo`,()=>{
 const{sim,a,b,family,target,network,connect,settle}=pair(six,named),send=sim.sendControlDatagram.bind(sim),messages:WireArgs[]= [];let drop=true;
 sim.sendControlDatagram=(...args:WireArgs)=>{if(args[4]?.protocol==='eigrp-update'){messages.push(structuredClone(args));if(drop&&args[0]===b.id&&args[4].operation==='UPDATE'&&!args[4].init)return;}send(...args);};connect();settle();
 assert.ok(a.runtime.neighbors.some(n=>n.protocol===family.toUpperCase()&&n.state==='UP'));assert.equal(learned(a,network),undefined);assert.equal(echo(sim,a,target),0);assert.equal(echo(sim,a,six?'2001:db8:10::2':'10.0.0.2'),1);
 const initial=messages.filter(m=>m[0]===b.id&&m[4].operation==='UPDATE');assert.equal(initial[0][4].init,true);assert.deepEqual(initial[0][4].changes,[]);assert.ok(messages.some(m=>m[0]===a.id&&m[4].operation==='ACK'&&m[4].sequence===initial[0][4].sequence));
 drop=false;sim.advance(600);assert.ok(learned(a,network));assert.equal(echo(sim,a,target),1);assert.ok(a.runtime.features[family+'Updates'][0].receivedPrefixes>0);
});

for(const six of[false,true])test(`IPv${six?6:4} lost ACK retransmits without duplicate installation; queued withdrawal and stale replay cannot resurrect a route`,()=>{
 const{sim,a,b,cb,family,target,network,connect,settle}=pair(six,true),send=sim.sendControlDatagram.bind(sim),messages:WireArgs[]=[];let dropAck=true;
 sim.sendControlDatagram=(...args:WireArgs)=>{const body=args[4];if(body?.protocol==='eigrp-update'){messages.push(structuredClone(args));if(dropAck&&args[0]===a.id&&body.operation==='ACK'&&body.sequence>1)return;}send(...args);};connect();settle();assert.ok(learned(a,network));
 sim.advance(1100);const data=messages.filter(m=>m[0]===b.id&&m[4].operation==='UPDATE'&&m[4].changes.some((r:any)=>r.network===network&&!r.withdraw));assert.ok(data.length>=2);assert.equal(data[0][4].sequence,data[1][4].sequence);assert.equal(a.runtime.routes.filter(r=>r.network===network&&r.protocol==='D').length,1);
 run(cb,'configure terminal','interface Loopback0','shutdown','end');sim.advance(100);assert.ok(learned(a,network),'Remote configuration cannot directly remove a received vector while its reliable withdrawal is queued');dropAck=false;sim.advance(1100);assert.equal(learned(a,network),undefined);assert.equal(echo(sim,a,target),0);
 send(...data[0]);sim.advance(100);assert.equal(learned(a,network),undefined,'A delayed pre-withdrawal sequence is ACKed without being reapplied');assert.ok(a.runtime.features[family+'Traffic'].sent.ack>1);
 run(cb,'configure terminal','interface Loopback0','no shutdown','end');sim.advance(600);assert.equal(echo(sim,a,target),1);
});

test('unacknowledged INIT remains pending without normal UPDATE/QUERY; retry exhaustion resets the peer and a fresh exchange recovers',()=>{
 const{sim,a,b,family,network,connect,settle}=pair(),send=sim.sendControlDatagram.bind(sim),messages:WireArgs[]=[];let drop=true;
 sim.sendControlDatagram=(...args:WireArgs)=>{messages.push(structuredClone(args));if(drop&&args[0]===a.id&&args[4]?.protocol==='eigrp-update'&&args[4].operation==='ACK'&&args[4].sequence===1)return;send(...args);};connect();settle();assert.equal(learned(a,network),undefined);assert.equal(b.runtime.neighbors.find(n=>n.protocol==='EIGRP')?.state,'INIT (UPDATE)');sim.advance(8100);
 assert.ok(sim.events.some(e=>e.nodeId===b.id&&e.label==='UPDATE retry limit'));assert.ok(!messages.some(m=>m[0]===b.id&&m[4]?.protocol==='eigrp-update'&&m[4].operation==='UPDATE'&&!m[4].init));assert.ok(!messages.some(m=>m[0]===b.id&&m[4]?.protocol==='eigrp-dual'&&m[4].operation==='QUERY'));
 drop=false;sim.advance(5500);assert.ok(learned(a,network));assert.equal(echo(sim,a,'192.0.2.2'),1);assert.ok(a.runtime.features[family+'Traffic'].received.update>0);
});

for(const six of[false,true])test(`IPv${six?6:4} old-session replay after saved restart cannot restore a withdrawn vector`,()=>{
 const{sim,a,b,cb,target,network,connect,settle}=pair(six,true),send=sim.sendControlDatagram.bind(sim),messages:WireArgs[]=[];
 sim.sendControlDatagram=(...args:WireArgs)=>{if(args[0]===b.id&&args[4]?.protocol==='eigrp-update'&&args[4].changes?.some((r:any)=>r.network===network&&!r.withdraw))messages.push(structuredClone(args));send(...args);};connect();settle();assert.equal(echo(sim,a,target),1);assert.ok(messages.length);
 run(cb,'configure terminal','interface Loopback0','shutdown','end','write memory');sim.advance(600);sim.reload(b.id);sim.advance(6500);assert.equal(learned(a,network),undefined);send(...messages[0]);sim.advance(100);assert.equal(learned(a,network),undefined);assert.equal(echo(sim,a,target),0);
 run(cb,'configure terminal','interface Loopback0','no shutdown','end');sim.advance(600);assert.equal(echo(sim,a,target),1);
});

test('valid UPDATE traffic refreshes the advertised hold timer; losing all EIGRP packets expires it and requires Hello/INIT recovery',()=>{
 const{sim,a,b,ca,cb,network,connect,settle}=pair(),send=sim.sendControlDatagram.bind(sim);run(cb,'configure terminal','interface '+port,'ip hold-time eigrp 100 1','end');connect();settle();let dropHello=true,dropAll=false;
 sim.sendControlDatagram=(...args:WireArgs)=>{if(args[0]===b.id&&((dropHello&&args[4]?.protocol==='eigrp-hello')||(dropAll&&String(args[4]?.protocol).startsWith('eigrp-'))))return;send(...args);};
 for(let n=0;n<6;n++){run(cb,'configure terminal','interface Loopback0','delay '+(20+n),'end');sim.advance(400);assert.ok(learned(a,network));}assert.ok(a.runtime.features.eigrpHelloNeighbors[0].expires>sim.clock.now());
 dropAll=true;sim.advance(1200);assert.equal(learned(a,network),undefined);assert.ok(sim.events.some(e=>e.nodeId===a.id&&e.label==='Hold timer expired'));dropAll=false;dropHello=false;run(cb,'configure terminal','interface '+port,'no ip hold-time eigrp 100','end');sim.advance(5500);assert.ok(learned(a,network));assert.equal(echo(sim,a,'192.0.2.2'),1);
 assert.match(ca.execute('show ip eigrp traffic').join('\n'),/Updates sent\/received: \d+\/\d+/);
});

for(const six of[false,true])test(`IPv${six?6:4} protocol-88 interface ACL blocks delivered updates/hellos while other local traffic works; no form and saved reload recover`,()=>{
 const{sim,a,b,ca,cb,family,target,network,connect,settle}=pair(six,true);connect();settle();assert.equal(echo(sim,a,target),1);
 run(ca,'configure terminal',...(six?['ipv6 access-list CONTROL','deny 88 any any','permit ipv6 any any']:['ip access-list extended CONTROL','deny eigrp any any','permit ip any any']),'exit','interface '+port,...(six?['ipv6 traffic-filter CONTROL in']:['ip access-group CONTROL in']),'end');
 run(cb,'configure terminal','interface Loopback0','shutdown','end');sim.advance(600);assert.ok(learned(a,network));assert.equal(echo(sim,a,six?'2001:db8:10::2':'10.0.0.2'),1);sim.advance(16000);assert.equal(learned(a,network),undefined);assert.match(ca.execute(six?'show ipv6 access-list CONTROL':'show access-lists CONTROL').join('\n'),/\([1-9]\d* match/);
 run(ca,'configure terminal','interface '+port,...(six?['no ipv6 traffic-filter CONTROL in']:['no ip access-group CONTROL in']),'end');run(cb,'configure terminal','interface Loopback0','no shutdown','end','write memory');sim.advance(5500);assert.equal(echo(sim,a,target),1);
 const before=structuredClone(b.config.protocols[family]);assert.match(renderConfig(b).join('\n'),/router eigrp CAMPUS/);sim.reload(b.id);sim.advance(6500);assert.deepEqual(b.config.protocols[family],before);assert.equal(echo(sim,a,target),1);
});

for(const six of[false,true])test(`IPv${six?6:4} transit propagation uses each delivered neighbor vector, respects outbound policy and restores real traffic after no form`,()=>{
 const{sim,a,b,cb,family,target,network,connect,settle}=pair(six,true),c=sim.addDevice('router'),cc=new IOSSession(sim,c.id);configure(cc,3,six,true);
 run(cb,'configure terminal','interface GigabitEthernet0/1',...(six?['ipv6 address 2001:db8:20::2/64']:['ip address 10.0.1.2 255.255.255.0']),'no shutdown','end');run(cc,'configure terminal','interface '+port,...(six?['no ipv6 address 2001:db8:10::3/64','ipv6 address 2001:db8:20::3/64']:['ip address 10.0.1.3 255.255.255.0']),'end');
 const send=sim.sendControlDatagram.bind(sim);let drop=true;sim.sendControlDatagram=(...args:WireArgs)=>{if(drop&&args[0]===b.id&&args[4]?.protocol==='eigrp-update'&&args[4].operation==='UPDATE'&&!args[4].init&&args[5]?.interface==='GigabitEthernet0/1')return;send(...args);};connect();sim.connect({deviceId:b.id,port:'GigabitEthernet0/1'},{deviceId:c.id,port});settle();assert.ok(learned(a,network));assert.equal(learned(c,network),undefined);drop=false;sim.advance(600);assert.ok(learned(c,network));assert.equal(echo(sim,c,target),1);
 run(cb,'configure terminal',...(six?['ipv6 prefix-list BLOCK deny '+network+'/64','ipv6 prefix-list BLOCK permit ::/0 le 128']:['ip prefix-list BLOCK deny '+network+'/32','ip prefix-list BLOCK permit 0.0.0.0/0 le 32']),'router eigrp CAMPUS',`address-family ${six?'ipv6':'ipv4'} unicast autonomous-system 100`,'distribute-list prefix BLOCK out GigabitEthernet0/1','end');sim.advance(600);assert.equal(learned(c,network),undefined);assert.equal(echo(sim,c,target),0);assert.ok(learned(a,network));
 run(cb,'configure terminal','router eigrp CAMPUS',`address-family ${six?'ipv6':'ipv4'} unicast autonomous-system 100`,'no distribute-list prefix BLOCK out GigabitEthernet0/1','end');sim.advance(600);assert.equal(echo(sim,c,target),1);assert.ok(b.runtime.features[family+'Traffic'].sent.update>0);
});
