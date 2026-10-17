import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {IOSSession} from '../src/cli.ts';
import {defaultInterface,type Device} from '../src/model.ts';
import {renderConfig} from '../src/config-renderer.ts';
import {matchIOSExpression,validIOSExpression,canonicalCommunity,communityListMatches} from '../src/bgp-policy.ts';
const port='GigabitEthernet0/0';
function ip(d:Device,p:string,address:string,mask='255.255.255.0'){Object.assign(d.config.interfaces[p]??=defaultInterface(p,false),{ip:address,mask,adminUp:true,switchport:false});}
function cmd(c:IOSSession,...lines:string[]){for(const text of lines){const out=c.execute(text);assert.ok(!out.some(s=>s.startsWith('%')),text+': '+out.join('\n'));}}
function pair(){const s=new Simulator(1781),a=s.addDevice('router'),b=s.addDevice('router'),ca=new IOSSession(s,a.id),cb=new IOSSession(s,b.id);ip(a,port,'10.0.0.1');ip(b,port,'10.0.0.2');ip(b,'Loopback0','192.0.2.2','255.255.255.255');for(const[d,asn,peer,remote]of[[a,10,'10.0.0.2',20],[b,20,'10.0.0.1',10]]as const)d.config.protocols.bgp={asn,neighbors:[{address:peer,remoteAs:remote}],networks:d===b?[{network:'192.0.2.2',prefix:32}]:[]};s.connect({deviceId:a.id,port},{deviceId:b.id,port});cmd(ca,'enable');cmd(cb,'enable');return{s,a,b,ca,cb};}
const learned=(d:Device)=>d.runtime.routes.some(r=>r.network==='192.0.2.2'&&r.protocol==='B');

test('IOS expression matcher handles classes, negation, groups, alternation and empty boundaries without backtracking',()=>{
 for(const[p,value,want]of[['^4_[0-9]*$','4 65000',true],['^4_[0-9]*$','4',true],['^(65001|65002)_[0-9]+$','65002 65010',true],['^(65001|65002)_[0-9]+$','65020 65010',false],['^65001(_65001)*$','65001 65001',true],['_65001_','165001 65010',false],['_65001_','10 65001 20',true],['^[^0-4]+$','98765',true],['^[^0-4]+$','98761',false],['^$','',true],['(a+)+b','a'.repeat(8192),false]]as const)assert.equal(matchIOSExpression(p,value),want,p);
 for(const invalid of['[0-9','(65001','.*+','^*','[9-0]','\\1'])assert.equal(validIOSExpression(invalid),false,invalid);
});

test('standard communities canonicalize formats, match AND within entries and respect exact-match',()=>{
 assert.equal(canonicalCommunity('4259840020'),'65000:20');assert.equal(canonicalCommunity('0xfde80014'),'65000:20');assert.equal(canonicalCommunity('65535:65281'),'no-export');assert.equal(canonicalCommunity('70000:1'),undefined);
 const rules=[{action:'deny',communities:['65000:20','65000:30']},{action:'permit',communities:['internet']}];assert.equal(communityListMatches(rules,['65000:20']),true);assert.equal(communityListMatches(rules,['65000:20','65000:30']),false);assert.equal(communityListMatches([{action:'permit',communities:['4259840020']}],['65000:20','65000:30'],true,true),false);assert.equal(communityListMatches([{action:'permit',communities:['4259840020']}],['65000:20'],true,true),true);
});

test('expanded community filtering follows local format and affects delivered BGP routes without resetting TCP',()=>{
 const{s,a,b,ca,cb}=pair();cmd(cb,'conf t','route-map TAG permit 10','set community 65000:20 65000:30','router bgp 20','neighbor 10.0.0.1 send-community','neighbor 10.0.0.1 route-map TAG out','end');cmd(ca,'conf t','ip community-list expanded TAGGED permit ^65000:2[0-9]_65000:30$','route-map IMPORT permit 10','match community TAGGED','router bgp 10','neighbor 10.0.0.2 route-map IMPORT in','end');s.advance(1500);assert.equal(learned(a),false);const channel=a.runtime.features.bgpSessions[0].channelId;cmd(ca,'conf t','ip bgp-community new-format','end');assert.equal(learned(a),true);assert.match(ca.execute('show ip bgp community 65000:20').join('\n'),/192\.0\.2\.2/);assert.doesNotMatch(ca.execute('show ip bgp community 65000:21').join('\n'),/192\.0\.2\.2/);assert.match(ca.execute('show ip bgp community-list TAGGED').join('\n'),/192\.0\.2\.2/);assert.match(ca.execute('show ip bgp 192.0.2.2').join('\n'),/Community: 65000:20 65000:30/);cmd(ca,'conf t','no ip bgp-community new-format','end');assert.equal(learned(a),false);assert.equal(a.runtime.features.bgpSessions[0].channelId,channel);assert.deepEqual(b.runtime.features.bgpAdjRibOut['10.0.0.1'][0].communities,['65000:20','65000:30']);
});

test('numbered standard and expanded lists plus format rendering round-trip with numeric equivalence',()=>{
 const{s,a,ca,cb}=pair();cmd(cb,'conf t','route-map TAG permit 10','set community 4259840020 0xfde8001e','router bgp 20','neighbor 10.0.0.1 send-community','neighbor 10.0.0.1 route-map TAG out','end');cmd(ca,'conf t','ip community-list 10 permit 4259840020','ip community-list 110 permit ^4259840020_4259840030$','route-map IMPORT permit 10','match community 10 110','router bgp 10','neighbor 10.0.0.2 route-map IMPORT in','end');s.advance(1500);assert.equal(learned(a),true);assert.match(ca.execute('show ip bgp 192.0.2.2').join('\n'),/Community: 4259840020 4259840030/);cmd(ca,'conf t','route-map IMPORT permit 10','no match community 10 110','match community 10 exact-match','end');assert.equal(learned(a),false);cmd(ca,'conf t','ip community-list 10 permit 65000:20 65000:30','ip as-path access-list 1 permit ^(20|30)$','end');assert.equal(learned(a),true);
 const text=renderConfig(a).join('\n'),copy=s.addDevice('router'),cc=new IOSSession(s,copy.id);copy.config.features.files={snapshot:text};cmd(cc,'enable','copy flash:snapshot running-config');assert.deepEqual(copy.config.features.communityLists,a.config.features.communityLists);assert.deepEqual(copy.config.features.asPathLists,a.config.features.asPathLists);
 cmd(ca,'conf t');const before=structuredClone(a.config.features.communityLists);assert.match(ca.execute('ip community-list standard BAD permit 65536:1').join('\n'),/Invalid/);assert.deepEqual(a.config.features.communityLists,before);assert.match(ca.execute('ip as-path access-list 2 permit [9-0]').join('\n'),/Invalid/);cmd(ca,'no ip community-list 10');assert.equal(a.config.features.communityLists['10'],undefined);
});

test('broader AS-path patterns filter real received advertisements',()=>{
 const{s,a,ca}=pair();cmd(ca,'conf t','ip as-path access-list FROM20 permit ^(1[0-9]|20)$','route-map PATH permit 10','match as-path FROM20','router bgp 10','neighbor 10.0.0.2 route-map PATH in','end');s.advance(1500);assert.equal(learned(a),true);cmd(ca,'conf t','no ip as-path access-list FROM20','ip as-path access-list FROM20 permit ^[3-9][0-9]$','end');assert.equal(learned(a),false);
});
