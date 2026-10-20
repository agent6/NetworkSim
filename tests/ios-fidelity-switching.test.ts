import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/engine.ts';
import { IOSSession } from '../src/cli.ts';
import type { Device } from '../src/model.ts';

const g=(n:number)=>'GigabitEthernet0/'+n;
const run=(c:IOSSession,...lines:string[])=>{for(const line of lines){const out=c.execute(line);assert.ok(!out.some(l=>/^%/.test(l)),line+'\n'+out.join('\n'));}};
const host=(d:Device)=>Object.keys(d.config.interfaces)[0];
const address=(d:Device,ip:string)=>{const p=d.config.interfaces[host(d)];p.ip=ip;p.mask='255.255.255.0';p.adminUp=true;};

function lab(){
  const sim=new Simulator(4242),s1=sim.addDevice('switch'),s2=sim.addDevice('switch'),pc=sim.addDevice('pc'),pc2=sim.addDevice('pc');
  sim.connect({deviceId:s1.id,port:g(1)},{deviceId:s2.id,port:g(1)});
  sim.connect({deviceId:s1.id,port:g(3)},{deviceId:s2.id,port:g(3)});
  sim.connect({deviceId:s1.id,port:g(4)},{deviceId:s2.id,port:g(4)});
  sim.connect({deviceId:s1.id,port:g(2)},{deviceId:pc.id,port:host(pc)});
  sim.connect({deviceId:s2.id,port:g(2)},{deviceId:pc2.id,port:host(pc2)});
  const c1=new IOSSession(sim,s1.id),c2=new IOSSession(sim,s2.id);
  for(const c of [c1,c2])run(c,'enable','configure terminal','vtp domain LAB','vlan 10','name USERS','interface g0/1','switchport mode trunk','interface range g0/3 - 4','switchport mode trunk','channel-group 1 mode active','interface port-channel 1','switchport mode trunk','interface g0/2','switchport mode access','switchport access vlan 10','end');
  run(c1,'configure terminal','spanning-tree vlan 1,10 priority 4096','end');
  address(pc,'10.10.0.5');address(pc2,'10.10.0.6');sim.changed();
  sim.advance(60000);sim.ping(pc.id,'10.10.0.6',{count:1});sim.advance(2000);
  return {sim,s1,s2,pc,pc2,c1,c2};
}

test('show spanning-tree uses the IOS per-VLAN layout and omits ports that are not up',()=>{
  const {s1,c1,c2}=lab(),out=c1.execute('show spanning-tree vlan 10').join('\n');
  assert.match(out,/^\nVLAN0010\n  Spanning tree enabled protocol rstp\n  Root ID    Priority    4106\n             Address     [0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\n             This bridge is the root\n             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n\n  Bridge ID  Priority    4106   \(priority 4096 sys-id-ext 10\)\n/);
  assert.match(out,/             Aging Time  300 sec\n\nInterface           Role Sts Cost      Prio\.Nbr Type\n------------------- ---- --- --------- -------- --------------------------------\n/);
  assert.match(out,/^Gi0\/1               Desg FWD 4         128\.\d+ +P2p $/m);
  assert.match(out,/^Gi0\/2               Desg FWD 4         128\.\d+ +P2p $/m);
  assert.match(out,/^Po1                 Desg FWD 3         128\.\d+ +P2p $/m);
  assert.doesNotMatch(out,/Gi0\/[3-9]|Gi0\/1\d|DIS/,'members and notconnect ports are not listed');
  const peer=c2.execute('show spanning-tree vlan 10').join('\n');
  assert.match(peer,/             Cost        3\n             Port        \d+ \(Port-channel1\)\n/);
  assert.match(peer,/^Gi0\/1 +Altn BLK 4 /m);assert.match(peer,/^Po1 +Root FWD 3 /m);
  assert.equal(s1.runtime.stp['10'].rootId,s1.id);
});

test('show spanning-tree summary and auxiliary views follow IOS text',()=>{
  const {c1,c2}=lab(),summary=c1.execute('show spanning-tree summary').join('\n');
  assert.match(summary,/^Switch is in rapid-pvst mode\nRoot bridge for: VLAN0001, VLAN0010\nExtended system ID                      is enabled\nPortfast Default                        is disabled\nPortFast BPDU Guard Default             is disabled\n/);
  assert.match(summary,/Configured Pathcost method used is short\n\nName                   Blocking Listening Learning Forwarding STP Active\n---------------------- -------- --------- -------- ---------- ----------\nVLAN0001                     0         0        0          2          2\nVLAN0010                     0         0        0          3          3\n---------------------- -------- --------- -------- ---------- ----------\n2 vlans                      0         0        0          5          5$/);
  assert.match(c2.execute('show spanning-tree blockedports').join('\n'),/VLAN0001             Gi0\/1\nVLAN0010             Gi0\/1\n\nNumber of blocked ports \(segments\) in the system : 2/);
  assert.match(c2.execute('show spanning-tree root').join('\n'),/^VLAN0010\s+4106 [0-9a-f.]{14}\s+3\s+2\s+20\s+15\s+Po1$/m);
  assert.match(c1.execute('show spanning-tree interface g0/1').join('\n'),/^VLAN0010            Desg FWD 4 /m);
  assert.match(c1.execute('show spanning-tree interface g0/1 detail').join('\n'),/ Port \d+ \(GigabitEthernet0\/1\) of VLAN0001 is designated forwarding \n   Port path cost 4, Port priority 128, Port Identifier 128\.\d+\./);
  assert.deepEqual(c1.execute('show spanning-tree vlan 99'),['Spanning tree instance(s) for vlan 99 does not exist.']);
});

test('show vlan brief and show vlan match the IOS tables, wrapping and default VLANs',()=>{
  const {c1}=lab(),brief=c1.execute('show vlan brief').join('\n');
  assert.match(brief,/^\nVLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n1    default                          active    Gi0\/5, Gi0\/6, Gi0\/7, Gi0\/8\n {48}Gi0\/9, Gi0\/10, Gi0\/11, Gi0\/12\n/);
  assert.match(brief,/^10   USERS                            active    Gi0\/2$/m);
  assert.match(brief,/^1002 fddi-default                     act\/unsup \n1003 token-ring-default               act\/unsup \n1004 fddinet-default                  act\/unsup \n1005 trnet-default                    act\/unsup $/m);
  assert.doesNotMatch(brief,/Gi0\/1,|Gi0\/3|Po1/,'trunks and bundle members are not access ports');
  const full=c1.execute('show vlan').join('\n');
  assert.match(full,/\nVLAN Type  SAID       MTU   Parent RingNo BridgeNo Stp  BrdgMode Trans1 Trans2\n---- ----- ---------- ----- ------ ------ -------- ---- -------- ------ ------\n1    enet  100001     1500  -      -      -        -    -        0      0\n10   enet  100010     1500 /);
  assert.match(full,/\nRemote SPAN VLANs\n-{78}\n\n\nPrimary Secondary Type              Ports\n------- --------- ----------------- ------------------------------------------\n/);
  assert.match(c1.execute('show vlan summary').join('\n'),/^Number of existing VLANs           : 6\n Number of existing VTP VLANs      : 6\n Number of existing extended VLANS : 0$/);
});

test('show mac address-table uses the IOS header, CPU entries and totals',()=>{
  const {sim,c1,pc}=lab(),out=c1.execute('show mac address-table').join('\n');
  assert.match(out,/^          Mac Address Table\n-------------------------------------------\n\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n All    0100\.0ccc\.cccc    STATIC      CPU\n/);
  assert.match(out,/ All    ffff\.ffff\.ffff    STATIC      CPU\n/);
  const mac=sim.macOf(pc.id,host(pc)).replace(/:/g,'').toLowerCase().match(/.{4}/g)!.join('.');
  assert.ok(out.split('\n').includes(`  10    ${mac}    DYNAMIC     Gi0/2`),mac+'\n'+out);
  assert.match(out,/\nTotal Mac Addresses for this criterion: \d+$/);
  assert.match(c1.execute('show mac address-table count').join('\n'),/\nMac Entries for Vlan 10:\n---------------------------\nDynamic Address Count  : 2\nStatic  Address Count  : 0\nTotal Mac Addresses    : 2\n/);
  assert.deepEqual(c1.execute('show mac address-table aging-time'),['Global Aging Time:  300','Vlan    Aging Time','----    ----------']);
});

test('show interfaces status, trunk and switchport print IOS columns and fields',()=>{
  const {c1}=lab(),status=c1.execute('show interfaces status');
  assert.equal(status[1],'Port      Name               Status       Vlan       Duplex  Speed Type ');
  assert.ok(status.includes('Gi0/1                        connected    trunk      a-full a-1000 10/100/1000BaseTX'));
  assert.ok(status.includes('Gi0/2                        connected    10         a-full a-1000 10/100/1000BaseTX'));
  assert.ok(status.includes('Gi0/9                        notconnect   1            auto   auto 10/100/1000BaseTX'));
  assert.ok(!status.some(l=>/simulated/.test(l)));
  const trunk=c1.execute('show interfaces trunk').join('\n');
  assert.match(trunk,/^\nPort        Mode             Encapsulation  Status        Native vlan\nGi0\/1       on               802\.1q         trunking      1\nPo1         on               802\.1q         trunking      1\n\nPort        Vlans allowed on trunk\nGi0\/1       1-4094\nPo1         1-4094\n\nPort        Vlans allowed and active in management domain\nGi0\/1       1,10\n/);
  assert.match(trunk,/\nPort        Vlans in spanning tree forwarding state and not pruned\nGi0\/1       1,10\n/);
  const sw=c1.execute('show interfaces g0/2 switchport');
  for(const line of ['Name: Gi0/2','Switchport: Enabled','Administrative Mode: static access','Operational Mode: static access','Administrative Trunking Encapsulation: dot1q','Operational Trunking Encapsulation: native','Negotiation of Trunking: Off','Access Mode VLAN: 10 (USERS)','Trunking Native Mode VLAN: 1 (default)','Administrative Native VLAN tagging: enabled','Voice VLAN: none','Administrative private-vlan host-association: none ','Trunking VLANs Enabled: ALL','Pruning VLANs Enabled: 2-1001','Capture Mode Disabled','Capture VLANs Allowed: ALL','Protected: false','Unknown unicast blocked: disabled','Unknown multicast blocked: disabled','Appliance trust: none'])assert.ok(sw.includes(line),line);
  const member=c1.execute('show interfaces g0/3 switchport');
  assert.ok(member.includes('Administrative Mode: trunk')&&member.includes('Operational Mode: trunk (member of bundle Po1)'),member.join('\n'));
});

test('EtherChannel and LACP displays use the IOS legend, columns and partner details',()=>{
  const {c1,s2}=lab(),summary=c1.execute('show etherchannel summary').join('\n');
  assert.match(summary,/^Flags:  D - down        P - bundled in port-channel\n        I - stand-alone s - suspended\n        H - Hot-standby \(LACP only\)\n        R - Layer3      S - Layer2\n        U - in use      N - not in use, no aggregation\n        f - failed to allocate aggregator\n\n        M - not in use, minimum links not met\n        m - not in use, port not aggregated due to minimum links not met\n        u - unsuitable for bundling\n        w - waiting to be aggregated\n        d - default port\n\n        A - formed by Auto LAG\n\n\nNumber of channel-groups in use: 1\nNumber of aggregators:           1\n\nGroup  Port-channel  Protocol    Ports\n------\+-------------\+-----------\+-----------------------------------------------\n1      Po1\(SU\)         LACP      Gi0\/3\(P\)    Gi0\/4\(P\)    $/);
  const nbr=c1.execute('show lacp neighbor').join('\n');
  assert.match(nbr,/Channel group 1 neighbors\n\nPartner's information:\n\n                  LACP port                        Admin  Oper   Port    Port\nPort      Flags   Priority  Dev ID          Age    key    Key    Number  State\nGi0\/3     SA      32768     [0-9a-f.]{14} +\d+s    0x0    0x1    0x\w+ +0x3D/);
  const sys=c2sys(s2);assert.ok(nbr.includes(sys),sys);
  assert.match(c1.execute('show lacp internal').join('\n'),/^Gi0\/3     SA      bndl      32768         0x1       0x1     0x\w+ +0x3D/m);
  assert.match(c1.execute('show lacp counters').join('\n'),/^Port       Sent   Recv     Sent   Recv     Sent   Recv      Pkts Err\n-{69}\nChannel group: 1\nGi0\/3      \d+/m);
  assert.match(c1.execute('show etherchannel load-balance').join('\n'),/^EtherChannel Load-Balancing Configuration:\n        src-dst-mac\n/);
});
function c2sys(d:Device){const m=Object.values(d.runtime.stp)[0]?.bridgeId?.split('.')[1]??'';return m.replace(/[^0-9a-f]/gi,'').match(/.{4}/g)!.join('.');}

test('show vtp status and counters use the IOS 15 layout with actual domain, mode and revision',()=>{
  const {c1,c2,s1}=lab();run(c2,'configure terminal','vtp mode client','end');
  const out=c1.execute('show vtp status');
  assert.deepEqual(out.slice(0,6),['VTP Version capable             : 1 to 3','VTP version running             : 1','VTP Domain Name                 : LAB','VTP Pruning Mode                : Disabled','VTP Traps Generation            : Disabled','Device ID                       : '+c2sys(s1)]);
  assert.match(out.join('\n'),/\nLocal updater ID is 0\.0\.0\.0 \(no valid interface found\)\n\nFeature VLAN:\n--------------\nVTP Operating Mode                : Server\nMaximum VLANs supported locally   : 1005\nNumber of existing VLANs          : 6\nConfiguration Revision            : \d+\nMD5 digest                        : (0x[0-9A-F]{2} ){8}\n {36}(0x[0-9A-F]{2} ){8}$/);
  assert.match(c2.execute('show vtp status').join('\n'),/VTP Operating Mode                : Client/);
  assert.match(c1.execute('show vtp counters').join('\n'),/^VTP statistics:\nSummary advertisements received    : \d+\nSubset advertisements received     : \d+\n/);
  assert.deepEqual(c1.execute('show vtp password'),['The VTP password is not configured.']);
});

test('port-security tables count real violations and record the last source address',()=>{
  const {sim,c1,pc}=lab();
  run(c1,'configure terminal','interface g0/2','switchport port-security','switchport port-security mac-address 0000.1111.2222','switchport port-security violation restrict','end');
  sim.ping(pc.id,'10.10.0.6',{count:2});sim.advance(3000);
  const table=c1.execute('show port-security').join('\n');
  assert.match(table,/^Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n                \(Count\)       \(Count\)          \(Count\)\n-{75}\n      Gi0\/2              1            1                  [1-9]\d*         Restrict\n-{75}\nTotal Addresses in System \(excluding one mac per port\)     : 0\nMax Addresses limit in System \(excluding one mac per port\) : 4096$/);
  const intf=c1.execute('show port-security interface g0/2');
  assert.deepEqual(intf.slice(0,10),['Port Security              : Enabled','Port Status                : Secure-up','Violation Mode             : Restrict','Aging Time                 : 0 mins','Aging Type                 : Absolute','SecureStatic Address Aging : Disabled','Maximum MAC Addresses      : 1','Total MAC Addresses        : 1','Configured MAC Addresses   : 1','Sticky MAC Addresses       : 0']);
  assert.match(intf[10],/^Last Source Address:Vlan   : [0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}:10$/);assert.notEqual(intf[10],'Last Source Address:Vlan   : 0000.1111.2222:10');
  assert.match(intf[11],/^Security Violation Count   : [1-9]\d*$/);
  assert.match(c1.execute('show port-security address').join('\n'),/^  10    0000\.1111\.2222    SecureConfigured              Gi0\/2        -$/m);
});

test('errdisable, storm-control and DTP views print IOS tables',()=>{
  const {c1}=lab();run(c1,'configure terminal','errdisable recovery cause bpduguard','interface g0/2','storm-control broadcast level 50 30','end');
  const recovery=c1.execute('show errdisable recovery');
  assert.deepEqual(recovery.slice(0,2),['ErrDisable Reason            Timer Status','-----------------            --------------']);
  assert.ok(recovery.includes('bpduguard                    Enabled'));assert.ok(recovery.includes('Timer interval: 300 seconds'));
  assert.deepEqual(c1.execute('show errdisable detect').slice(0,2),['ErrDisable Reason            Detection    Mode','-----------------            ---------    ----']);
  assert.deepEqual(c1.execute('show storm-control'),['Interface  Filter State   Upper        Lower        Current','---------  -------------  -----------  -----------  ----------','Gi0/2      Forwarding          50.00%       30.00%       0.00%']);
  const dtp=c1.execute('show dtp interface g0/1').join('\n');
  assert.match(dtp,/^DTP information for GigabitEthernet0\/1:\n  TOS\/TAS\/TNS:                              TRUNK\/ON\/TRUNK\n  TOT\/TAT\/TNT:                              802\.1Q\/802\.1Q\/802\.1Q\n  Neighbor address 1:                       [0-9A-F]{12}\n/);
  assert.match(dtp,/\n  Statistics\n  ----------\n  \d+ packets received \(\d+ good\)\n/);
  assert.deepEqual(c1.execute('show dtp').slice(0,3),['Global DTP information','        Sending DTP Hello packets every 30 seconds','        Dynamic Trunk timeout is 300 seconds']);
});

test('switching shows contain no placeholders or simulator commentary and still reject bad input',()=>{
  const {c1}=lab();for(const line of ['configure terminal','spanning-tree backbonefast','spanning-tree uplinkfast','end'])c1.execute(line);
  for(const cmd of ['show spanning-tree','show spanning-tree detail','show spanning-tree summary','show spanning-tree backbonefast','show spanning-tree uplinkfast','show vlan','show mac address-table','show interfaces status','show interfaces trunk','show interfaces g0/1 switchport','show etherchannel summary','show etherchannel detail','show lacp neighbor detail','show vtp status','show vtp counters','show port-security','show port-security interface g0/2','show errdisable recovery','show storm-control','show dtp interface g0/1']){
    const out=c1.execute(cmd);assert.ok(out.length,cmd);
    assert.ok(!out.some(l=>/(^|\s)\?(\s|$)|not simulated|simulation|simulated/i.test(l)),cmd+'\n'+out.join('\n'));
  }
  for(const cmd of ['show spanning-tree vlan 5000','show vlan id 0','show mac address-table bogus','show etherchannel 1 bogus','show vtp status extra','show port-security interface g0/99'])assert.match(c1.execute(cmd).join('\n'),/% (Invalid|Incomplete)/,cmd);
});
