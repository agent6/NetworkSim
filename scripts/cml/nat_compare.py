"""Compare native and simulated IOS NAT tables without masking address or tuple errors."""
import argparse,hashlib,json,re
from pathlib import Path
from nat_evidence import evidence

def table(text):
 rows=[]
 for line in text.replace('\r','').splitlines():
  fields=line.split()
  if len(fields)!=5 or fields[0] not in ('---','any','icmp','udp','tcp'):continue
  if fields[0]=='icmp':fields=[re.sub(r':\d+$',':<icmp-id>',x) for x in fields]
  elif fields[0] in ('tcp','udp') and fields[1].startswith('203.0.113.1:'):fields[1]='203.0.113.1:<pat-port>'
  rows.append(' '.join(fields))
 return sorted(rows)

def compare(native,replay):
 results=[];by_id={s['id']:s for s in replay['steps']}
 if [s['id'] for s in native['steps']]!=[s['id'] for s in replay['steps']]:raise ValueError('Native/replay step identity mismatch')
 for n in native['steps']:
  s=by_id[n['id']];passed=n.get('passed') is True and s.get('passed') is True
  if n['kind'] in ('config','survey'):
   if len(n['commands'])!=len(s['commands']):raise ValueError('Command count mismatch')
   for a,b in zip(n['commands'],s['commands']):
    if a['command'].replace('Ethernet0/','GigabitEthernet0/')!=b['command']:raise ValueError('Command identity mismatch')
    if a['command'].startswith('show ip nat translations'):
     actual=table('\n'.join(b['output']));expected=table(a['raw']);results.append({'id':n['id'],'command':a['command'],'native':expected,'simulator':actual,'passed':actual==expected})
  results.append({'id':n['id'],'kind':n['kind'],'passed':passed})
 return results

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('capture',type=Path);p.add_argument('replay',type=Path);p.add_argument('output',type=Path);a=p.parse_args();native=json.loads(a.capture.read_text());replay=json.loads(a.replay.read_text());root=a.capture.parent;plan=json.loads((root/'scenario.json').read_text())
 if hashlib.sha256((root/'scenario.json').read_bytes()).hexdigest()!=native['scenarioSha256'] or native['scenarioSha256']!=replay['scenarioSha256']:raise ValueError('Scenario provenance mismatch')
 checks=compare(native,replay);wire=evidence(native,plan,root);result={'source':'comparison','scenario':'nat','scope':'IOS 47-group matrix and wire evidence for successful reference probes; NX candidate availability is reported separately','captureSha256':hashlib.sha256(a.capture.read_bytes()).hexdigest(),'replaySha256':hashlib.sha256(a.replay.read_bytes()).hexdigest(),'checks':checks,'wireEvidence':wire,'nxStaticStatus':native.get('nxStaticStatus',native.get('nxStatus')),'nxCandidates':{k:v.get('passed',False) for k,v in native.get('nxModes',{}).items()},'passed':all(r['passed'] for r in checks) and wire['passed']};a.output.write_text(json.dumps(result,indent=2)+'\n');print('NAT comparison:',result['passed']);raise SystemExit(0 if result['passed'] else 1)
