import type {Simulator} from './engine.ts';
import type {Device} from './model.ts';
import type {TCPChannel} from './tcp-channel.ts';
import type {TimerHandle} from './clock.ts';
import {isIPv4,isIPv6} from './ip.ts';
import {managementFor} from './management.ts';
import {createCLISession} from './session.ts';

export const NETCONF_NS='urn:ietf:params:xml:ns:netconf:base:1.0';
export const NETCONF_BASE='urn:ietf:params:netconf:base:1.0';
export const INTERFACES_NS='urn:ietf:params:xml:ns:yang:ietf-interfaces';
const IPV4_NS='urn:ietf:params:xml:ns:yang:ietf-ip';
export const netconfRPC=(body:string,id:string|number)=>`<rpc xmlns="${NETCONF_NS}" message-id="${String(id).replace(/[^a-zA-Z0-9_.:-]/g,'')}">\n${body}\n</rpc>]]>]]>`;
const edit=(target:string,body:string)=>`<edit-config><target><${target}/></target><error-option>rollback-on-error</error-option><config><interfaces xmlns="${INTERFACES_NS}">${body}</interfaces></config></edit-config>`;
const iface=(body:string)=>`<interface><name>GigabitEthernet0/1</name>${body}</interface>`;
export const NETCONF_EXAMPLES={
 'read-running':{label:'Read running interface configuration',body:`<get-config><source><running/></source><filter type="subtree"><interfaces xmlns="${INTERFACES_NS}"><interface><name>GigabitEthernet0/1</name></interface></interfaces></filter></get-config>`},
 'read-state':{label:'Read interface operational state',body:`<get><filter type="subtree"><interfaces xmlns="${INTERFACES_NS}"><interface><name>GigabitEthernet0/1</name></interface></interfaces></filter></get>`},
 'edit-running':{label:'Edit running and create Loopback10',body:edit('running',iface('<description>Managed by NETCONF</description>')+`<interface><name>Loopback10</name><description>Created by NETCONF</description><enabled>true</enabled><ipv4 xmlns="${IPV4_NS}"><address><ip>192.0.2.10</ip><netmask>255.255.255.255</netmask></address></ipv4></interface>`)},
 'invalid-edit':{label:'Reject an invalid multi-interface edit',body:edit('running',iface('<enabled>false</enabled>')+`<interface><name>Loopback11</name><ipv4 xmlns="${IPV4_NS}"><address><ip>bad-address</ip><netmask>255.255.255.0</netmask></address></ipv4></interface>`)},
 'lock-candidate':{label:'Lock candidate',body:'<lock><target><candidate/></target></lock>'},
 'draft':{label:'Stage a candidate description to discard',body:edit('candidate',iface('<description>Discard this change</description>'))},
 'read-candidate':{label:'Read candidate configuration',body:`<get-config><source><candidate/></source></get-config>`},
 'discard':{label:'Discard candidate changes',body:'<discard-changes/>'},
 'candidate-edit':{label:'Stage the final Loopback10 description',body:edit('candidate','<interface><name>Loopback10</name><description>Committed via candidate</description></interface>')},
 'commit':{label:'Commit or confirm the candidate',body:'<commit/>'},
 'disable-data':{label:'Stage a shutdown of the data interface',body:edit('candidate',iface('<enabled>false</enabled>'))},
 'confirmed':{label:'Commit with a 20-second confirmation timer',body:'<commit><confirmed/><confirm-timeout>20</confirm-timeout></commit>'},
 'final-description':{label:'Stage the final data-interface description',body:edit('candidate',iface('<description>NETCONF verified</description>'))},
 'unlock':{label:'Unlock candidate',body:'<unlock><target><candidate/></target></unlock>'},
 'close':{label:'Close the NETCONF session',body:'<close-session/>'},
} as const;
export interface NETCONFMessage {at:number;direction:'sent'|'received'|'info';text:string;channelId?:string;messageId?:string}
export interface NETCONFClientState {status:'disconnected'|'connecting'|'authenticating'|'ready'|'failed'|'closed';address:string;username:string;sessionId?:number;channelId?:string;capabilities:string[];pending?:string;error?:string;messages:NETCONFMessage[]}
const messageId=(xml:string)=>/<(?:[\w.-]+:)?rpc(?:-reply)?\b[^>]*\bmessage-id\s*=\s*["']([^"']+)["']/.exec(xml)?.[1];
export class NETCONFClient {
 readonly device:Device;readonly runtime:Device['runtime'];readonly state:NETCONFClientState;
 private engine:Simulator;private channel?:TCPChannel;private timer?:TimerHandle;private draftId=0;private generation=0;
 constructor(engine:Simulator,device:Device){managementFor(engine,id=>createCLISession(engine,id,{skipConsoleLogin:true}));this.engine=engine;this.device=device;this.runtime=device.runtime;this.state={status:'disconnected',address:'',username:'',capabilities:[],messages:[]};device.runtime.features.netconfClient=this.state;}
 draft(body:string):string{return netconfRPC(body,'nc-'+(++this.draftId));}
 private record(direction:NETCONFMessage['direction'],text:string):void{this.state.messages.push({at:this.engine.clock.now(),direction,text:text.length>32768?text.slice(0,32768)+'\n[message truncated]':text,channelId:this.channel?.id,messageId:messageId(text)});if(this.state.messages.length>100)this.state.messages.shift();}
 connect(address:string,username:string,password:string):void {
  if(this.engine.getDevice(this.device.id)!==this.device||this.device.runtime!==this.runtime)throw Error('Reopen NETCONF after replacing the lab.');
  if(!isIPv4(address)&&!isIPv6(address))throw Error('Enter a resolved IPv4 or IPv6 target address.');if(!username||username.length>256||!password||password.length>1024)throw Error('Enter a username and lab password.');
  const generation=++this.generation;this.engine.clock.cancel(this.timer);this.channel?.close('NETCONF client reconnect');
  Object.assign(this.state,{status:'connecting',address,username,sessionId:undefined,capabilities:[],pending:undefined,error:undefined});this.record('info',`Connecting to ${address}, TCP 830.`);
  const auth={type:'ssh-auth',username,password};
  const channel=this.engine.connectTCPChannel(this.device.id,address,830,{
   onOpen:c=>{if(generation!==this.generation)return;this.state.status='authenticating';c.send(auth);auth.password='';},
   onMessage:(message,c)=>{if(generation!==this.generation)return;
    if(typeof message!=='string'){if(message?.type==='ssh-auth-result'&&!message.accepted){this.state.status='failed';this.state.error=String(message.reason??'Authentication rejected');this.record('info','Authentication rejected.');this.engine.clock.cancel(this.timer);c.close('NETCONF authentication rejected');}return;}
    this.record('received',message);
    if(/<hello\b/.test(message)){const session=/<session-id>(\d+)<\/session-id>/.exec(message);this.state.sessionId=session?Number(session[1]):undefined;this.state.capabilities=[...message.matchAll(/<capability>([^<]+)<\/capability>/g)].map(m=>m[1]);if(!this.state.capabilities.includes(NETCONF_BASE)){this.state.status='failed';this.state.error='The server does not advertise NETCONF base 1.0.';c.close('Unsupported NETCONF framing');return;}
     const hello=`<hello xmlns="${NETCONF_NS}"><capabilities><capability>${NETCONF_BASE}</capability></capabilities></hello>]]>]]>`;c.send(hello);this.record('sent',hello);this.state.status='ready';this.engine.clock.cancel(this.timer);
    }else if(messageId(message)===this.state.pending){this.state.pending=undefined;this.engine.clock.cancel(this.timer);}
   },
   onClose:reason=>{auth.password='';if(generation!==this.generation)return;this.engine.clock.cancel(this.timer);if(['connecting','authenticating'].includes(this.state.status)){this.state.status='failed';this.state.error=reason;}else if(this.state.status!=='failed')this.state.status='closed';this.state.pending=undefined;this.record('info',reason);}
  });this.channel=channel;this.state.channelId=channel.id;
  this.timer=this.engine.clock.schedule(20000,()=>{if(generation!==this.generation)return;auth.password='';this.state.status='failed';this.state.error='NETCONF connection timed out.';channel.close(this.state.error);},{owner:this.device.id,label:'NETCONF client connection deadline'});
 }
 send(xml:string):void {
  if(this.state.status!=='ready'||!this.channel||this.channel.state!=='OPEN')throw Error('Connect and complete the hello exchange first.');if(this.state.pending)throw Error('Wait for the current RPC reply.');
  if(typeof xml!=='string'||xml.length>262144||!messageId(xml))throw Error('Supply one RPC with a message-id, no larger than 256 KiB.');
  this.state.pending=messageId(xml);this.state.error=undefined;this.record('sent',xml);this.channel.send(xml);
  this.timer=this.engine.clock.schedule(20000,()=>{this.state.pending=undefined;this.state.status='failed';this.state.error='RPC timed out; reconnect before retrying.';this.channel?.close(this.state.error);},{owner:this.device.id,label:'NETCONF client RPC deadline'});
 }
 disconnect():void{this.engine.clock.cancel(this.timer);this.channel?.close('NETCONF client disconnected');this.state.pending=undefined;if(this.state.status!=='failed')this.state.status='closed';}
 clear():void{this.state.messages=[];}
}
const clients=new WeakMap<Simulator,Map<string,NETCONFClient>>();
export function netconfClient(engine:Simulator,deviceId:string):NETCONFClient {const d=engine.getDevice(deviceId);if(!d)throw Error('Unknown NETCONF source device.');let rows=clients.get(engine);if(!rows){rows=new Map();clients.set(engine,rows);}let client=rows.get(d.id);if(!client||client.device!==d||client.runtime!==d.runtime){client=new NETCONFClient(engine,d);rows.set(d.id,client);}return client;}
