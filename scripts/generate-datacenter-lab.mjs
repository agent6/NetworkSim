import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {datacenterTopology,advanceSimulation} from '../tests/helpers/datacenter.ts';
import {parseLabFile} from '../src/persistence.ts';
import {vpcRuntime} from '../src/datacenter.ts';

const {s,a,b,access,client,ha,hb}=datacenterTopology();
s.lab.name='Datacenter Switch - single-domain vPC';
for(const[d,name,x,y]of [[a,'DC1',350,180],[b,'DC2',750,180],[access,'ACCESS1',550,480],[client,'CLIENT',550,700],[ha,'ORPHAN1',160,370],[hb,'ORPHAN2',950,370]]){
  d.config.hostname=name;d.x=x;d.y=y;d.startupConfig=structuredClone(d.config);
}
s.lab.notes.push({id:'datacenter-guide',x:80,y:30,locked:true,text:'NS-OS Datacenter Switch / vPC domain 42\n24 x Ethernet1/1-24 (10G); 6 x Ethernet1/25-30 (40G)\nPeer-link: Po1, Ethernet1/29-30 (2 x 40G)\nKeepalive: mgmt0, management VRF, 10.255.0.1/2\nvPC 10: DC1 Po10 / DC2 Po20 -> ACCESS1 Po3\nVLAN 20: CLIENT .10, ORPHAN1 .20, ORPHAN2 .30 (192.0.2.0/24)\nWait 35 simulated seconds after import (peer establishment + delay-restore).\nshow vpc / show vpc brief / show port-channel summary\nTry cable failures separately; auto-recovery is disabled.\nBoth control paths lost can produce dual-active risk; this is not a stack.'});
s.changed();advanceSimulation(s,1000);
for(const d of[a,b])assert.equal(vpcRuntime(d).adjacency,true);
for(const target of[ha,hb]){
  const result=s.ping(client.id,target.config.interfaces.GigabitEthernet0.ip,{count:2,interval:20,timeout:1000});
  advanceSimulation(s,2500);assert.equal(result.received,2);
}
const contents=JSON.stringify(s.serialize(),null,2)+'\n',parsed=parseLabFile(contents);
assert.equal(parsed.lab.devices.length,6);assert.equal(parsed.lab.links.length,8);
const file=new URL('../examples/datacenter-vpc.netsim.json',import.meta.url);
await writeFile(file,contents);console.log(fileURLToPath(file));
