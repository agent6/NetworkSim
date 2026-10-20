import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {fileName,parseDocument,parseLabFile,readLabFile,serializeLabFile} from '../src/persistence.ts';

function portableLab() {
  const sim=new Simulator(413), router=sim.addDevice('router'), pc=sim.addDevice('pc');
  router.config.interfaces['GigabitEthernet0/0'].adminUp=true;
  router.config.interfaces['GigabitEthernet0/0'].ip='192.0.2.1';
  router.config.interfaces['GigabitEthernet0/0'].mask='255.255.255.0';
  router.config.interfaces['GigabitEthernet0/0'].ipv6=['2001:db8::1/64'];
  router.config.features.banners={motd:'Authorized users only.\nLab: café #1 🚦\n'};
  router.config.features.users={student:{secret:'00123',privilege:15}};
  router.config.features.customLabels=['true','null','on','2026-10-16','1e3','10:30'];
  router.startupConfig=structuredClone(router.config);
  router.config.hostname='Running-Router';
  const link=sim.connect({deviceId:router.id,port:'GigabitEthernet0/0'},{deviceId:pc.id,port:'GigabitEthernet0'});
  link.lossAB=0.2;
  sim.lab.name='Campus café';
  sim.lab.notes.push({id:'note',x:24,y:48,text:'Subnet: 192.0.2.0/24\n# Keep this text',locked:true});
  return {...sim.serialize(),view:{x:84,y:-40,scale:1.25}};
}

test('YAML export and import preserve topology, startup/running configurations, Unicode, typed strings and viewport',()=>{
  const original=portableLab(), before=structuredClone(original), yaml=serializeLabFile(original);
  assert.match(yaml,/^format: netsim-lab\nversion: 1\n/);
  assert.match(yaml,/motd: \|/);
  assert.equal(fileName(original.lab.name),'Campus café.netsim.yaml');
  const decoded=parseLabFile(yaml);
  assert.deepEqual(decoded,parseDocument(JSON.stringify(original)));
  assert.deepEqual(original,before,'export does not alter the active lab');
  const sim=new Simulator();sim.load(decoded);
  assert.equal(sim.lab.devices[0].config.hostname,'Running-Router');
  assert.equal(sim.lab.devices[0].startupConfig?.hostname,'R1');
  assert.equal(sim.lab.devices[0].config.features.users.student.secret,'00123');
});

test('YAML import accepts comments, document markers, flow collections and block text',()=>{
  const yaml=`# Edited offline\n---\nformat: netsim-lab\nversion: 1\nseed: 42\nlab:\n  id: blank\n  name: "My YAML lab" # name\n  devices: []\n  links: []\n  notes:\n    - id: n1\n      x: 0\n      y: 20\n      text: |-\n        First line\n        Second: # literal\nview: {x: 10, y: 20, scale: 1}\n`;
  const doc=parseLabFile(yaml);
  assert.equal(doc.lab.notes[0].text,'First line\nSecond: # literal');
  assert.equal(doc.lab.name,'My YAML lab');
  assert.deepEqual((doc as any).view,{x:10,y:20,scale:1});
});

test('invalid YAML and invalid network data fail before replacing the current lab',()=>{
  const sim=new Simulator();sim.addDevice('router');const before=sim.serialize();
  const yaml=serializeLabFile(portableLab());
  for(const input of [
    yaml.replace('version: 1','version: 1\nversion: 2'),
    yaml+'\n---\nformat: netsim-lab\n',
    yaml.replace('name: Campus café','name: !unknown Campus'),
    yaml.replace('GigabitEthernet0/0\n','MissingPort\n'),
    '__proto__: {}\n',
    'cyclic: &loop {child: *loop}\n',
    yaml.replace('seed: 413','seed: .inf'),
    ' '.repeat(10*1024*1024+1),
  ]) {
    assert.throws(()=>sim.load(parseLabFile(input)));
    assert.deepEqual(sim.serialize(),before);
  }
});

test('exports from browser snapshots use the same YAML format and legacy JSON storage still restores',()=>{
  const stored=JSON.stringify(portableLab());
  const snapshot=parseDocument(stored),yaml=serializeLabFile(snapshot);
  assert.deepEqual(parseLabFile(yaml),snapshot);
  assert.equal(fileName('../../Old Lab.json'),'Old Labjson.netsim.yaml');
});

test('selected lab files accept YAML and prior JSON exports without changing the active lab',async()=>{
  const current=new Simulator(12);current.addDevice('switch');
  const before=current.serialize(),incoming=portableLab();
  for(const text of [serializeLabFile(incoming),JSON.stringify(incoming)]){
    const file=new File([text],'lab.netsim.yaml');
    assert.deepEqual(await readLabFile(file),parseDocument(JSON.stringify(incoming)));
    assert.deepEqual(current.serialize(),before);
  }
});

test('file selection rejects oversize files before reading and propagates read or validation failures',async()=>{
  let reads=0;
  await assert.rejects(readLabFile({size:10*1024*1024+1,async text(){reads++;return '';}}),/10 MB/);
  assert.equal(reads,0);
  await assert.rejects(readLabFile({size:1,async text(){throw Error('File access was denied');}}),/File access was denied/);
  await assert.rejects(readLabFile(new File(['not a lab'],'bad.yaml')),/NetworkSim/);
  await assert.rejects(readLabFile(new File(['format: ['],'bad.yaml')),/Invalid YAML/);
});
