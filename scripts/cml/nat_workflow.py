#!/usr/bin/env python3
"""Isolated IOS/NX-OS NAT reference capture. Accepted CLI alone is never a forwarding pass."""
from __future__ import annotations
import argparse,datetime,getpass,hashlib,json,re,shlex,sys,time,uuid
from pathlib import Path
from urllib.parse import urlsplit
from client import CML
from capture import Console,PROMPT,REJECTED,write_json,wait_for_ports
from aaa_workflow import Shell
from nat.plan import scenario
from nat_evidence import evidence
ASSETS=Path(__file__).parent/'nat'
SPEC={'IOS':('iol-xe','iol-xe-17-18-02'),'NX':('nxosv9000','nxosv9300-10-6-2-f'),**{k:('net-tools','net-tools-2-10-1-3') for k in ['I1','O1','I2','O2']}}
LINKS=[('IOS','Ethernet0/0','I1','eth0'),('IOS','Ethernet0/1','O1','eth0'),('NX','Ethernet1/1','I2','eth0'),('NX','Ethernet1/2','O2','eth0')]
SUBNET={'I1':'192.168.10.','O1':'203.0.113.','I2':'192.168.20.','O2':'198.51.100.'}
CONFIRM=r'Static entry in use, do you want to delete child entries\? \[no\]:\s*$|Removing the list will clear dynamic translations belonging to it\. Continue\? \(y/n\)  \[n\]\s*$'
NAT_REJECTED=REJECTED+r'|(?im:^\s*%(?:Dynamic mapping in use|Pool [^\r\n]*in use|Start and end addresses|NAT:))'

def startup(key):
 if key not in ['IOS','NX']:
  base=SUBNET[key];ips=[10,11,12] if key[0]=='I' else [100,101]
  return '\n'.join(['#!/bin/bash','hostname '+key,'ip link set eth0 up',*[f'ip addr add {base}{n}/24 dev eth0' for n in ips],f'ip route add default via {base}1','echo READY >/dev/console','exit 0'])
 if key=='IOS':return '\n'.join(['hostname IOS','no ip domain-lookup','no logging console','interface Ethernet0/0','ip address 192.168.10.1 255.255.255.0','no shutdown','interface Ethernet0/1','ip address 203.0.113.1 255.255.255.0','no shutdown','line console 0','exec-timeout 0 0','end'])
 return '\n'.join(['hostname NX','no password strength-check','username admin password NetSimLab42! role network-admin','interface Ethernet1/1','no switchport','ip address 192.168.20.1/24','no shutdown','interface Ethernet1/2','no switchport','ip address 198.51.100.1/24','no shutdown','end'])

def verify_owner(api,owner):
 lab=owner['labId'];detail=api.request('GET',f'/labs/{lab}')
 if not owner.get('runId') or detail['lab_title']!='NetworkSim NAT '+owner['runId']:raise ValueError('NAT lab ownership mismatch')
 nodes=api.request('GET',f'/labs/{lab}/nodes?data=true&exclude_configurations=true')
 if {n['label']:n['id'] for n in nodes}!=owner['nodes'] or any(n['label'] not in SPEC or (n['node_definition'],n.get('image_definition'))!=SPEC[n['label']] for n in nodes):raise ValueError('NAT node identity/image mismatch')
 interfaces={}
 for key,node in owner['nodes'].items():
  for i in api.request('GET',f'/labs/{lab}/nodes/{node}/interfaces?data=true'):interfaces[i['id']]=(key,i['label'])
 links=api.request('GET',f'/labs/{lab}/links?data=true')
 if {l['id'] for l in links}!=set(owner['links']) or {frozenset((interfaces[l['interface_a']],interfaces[l['interface_b']])) for l in links}!={frozenset(((a,p),(b,q))) for a,p,b,q in LINKS}:raise ValueError('NAT lab links/endpoints mismatch')
 return detail

def create_lab(api):
 run=uuid.uuid4().hex[:10];lab=api.request('POST','/labs',{'title':'NetworkSim NAT '+run,'description':'Disposable isolated NAT/PAT conformance lab. No external connectors.'})['id'];o={'runId':run,'labId':lab,'nodes':{},'links':[]}
 try:
  for i,(key,(definition,image)) in enumerate(SPEC.items()):o['nodes'][key]=api.request('POST',f'/labs/{lab}/nodes?populate_interfaces=true',{'label':key,'node_definition':definition,'image_definition':image,'configuration':startup(key),'x':i*150,'y':0})['id']
  for a,p,b,q in LINKS:
   ia=next(i['id'] for i in api.request('GET',f'/labs/{lab}/nodes/{o["nodes"][a]}/interfaces?data=true') if i['label']==p);ib=next(i['id'] for i in api.request('GET',f'/labs/{lab}/nodes/{o["nodes"][b]}/interfaces?data=true') if i['label']==q);o['links'].append(api.request('POST',f'/labs/{lab}/links',{'src_int':ia,'dst_int':ib})['id'])
  api.request('PUT',f'/labs/{lab}/start');return o
 except Exception:
  if api.request('GET',f'/labs/{lab}')['lab_title']=='NetworkSim NAT '+run:api.request('PUT',f'/labs/{lab}/stop')
  raise

def command(console,spec):
 import pexpect
 spec={'command':spec} if isinstance(spec,str) else spec;line=spec['command'];c=console.child;c.sendline(line);c.expect_exact(line,timeout=30);m=c.expect([PROMPT,CONFIRM,pexpect.TIMEOUT,pexpect.EOF],timeout=90);raw=line+c.before+(c.after if isinstance(c.after,str) else '');confirmed=m==1
 if confirmed:
  c.sendline(spec.get('answer','y' if 'Removing the list' in raw else ''));m=c.expect([PROMPT,pexpect.TIMEOUT,pexpect.EOF],timeout=45);raw+=c.before+(c.after if isinstance(c.after,str) else '');timed=m!=0
 else:timed=m>=2
 body=re.sub(r'^'+re.escape(line)+r'\r?\n?','',raw,count=1);rejected=bool(re.search(NAT_REJECTED,body));passed=not timed and rejected==spec.get('reject',False) and ('answer' not in spec or confirmed)
 return {'command':line,'raw':raw,'timedOut':timed,'confirmation':confirmed,'passed':passed}

def probe_result(raw):
 for line in raw.splitlines():
  if line.startswith('{"protocol":'):return json.loads(line)
 raise ValueError('Missing actual endpoint probe result')

def probe_pass(spec,value):
 return value.get('success') is spec['success'] and (not spec['success'] or spec['protocol']=='icmp' or spec.get('observedSource') is None or value.get('observed',{}).get('source')==spec['observedSource']) and (not spec['success'] or spec['protocol']=='icmp' or not spec.get('observedRange') or value.get('observed',{}).get('source') in spec['observedRange'])

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='https://192.168.1.201');p.add_argument('--username',default='admin');p.add_argument('--insecure',action='store_true');p.add_argument('--known-hosts',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--resume-owned-from',type=Path);args=p.parse_args()
 if not args.known_hosts.is_file() or args.output.exists():p.error('A verified SSH known-hosts file and a new output directory are required')
 args.output.mkdir(parents=True,mode=0o700);password=getpass.getpass('CML password: ');api=CML(args.url,args.username,password,insecure=args.insecure);api.login();report={'schemaVersion':1,'source':'cml','scenario':'nat','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'starting','steps':[],'versions':{},'captures':[],'labStopped':False};owner=None;consoles={};shells={};started=[]
 def save():
  text=json.dumps(report)
  for secret in (password,api._token):
   if secret:text=text.replace(secret,'<redacted>')
  write_json(args.output/'capture.json',json.loads(text))
 def ready(key,timeout=1500):
  deadline=time.monotonic()+timeout
  while time.monotonic()<deadline:
   if api.request('GET',f'/labs/{owner["labId"]}/nodes/{owner["nodes"][key]}')['state']=='BOOTED':return
   time.sleep(5)
  raise TimeoutError('Node boot timeout: '+key)
 def connect(key):
  c=Console(urlsplit(args.url).hostname,args.username,password,owner['labId'],owner['nodes'][key],args.known_hosts,args.output/(key+'-console.txt'));consoles[key]=c
  if key in ['IOS','NX']:
   c.child.sendcontrol('c');c.ready(timeout=180);command(c,'terminal length 0');command(c,'terminal width 132')
  else:shells[key]=Shell(c)
  return c
 def config(key,commands):return [command(consoles[key],c) for c in commands]
 def shell(key,text,timeout=120):
  raw,code=shells[key].command(text,timeout)
  if code:raise RuntimeError('Linux command failed: '+text[:100]+' '+raw[-300:])
  return raw
 def probe(spec):
  text='python3 /tmp/nat-endpoint.py probe '+' '.join(map(shlex.quote,[spec['protocol'],spec['source'],spec['destination'],'--source-port',str(spec.get('sourcePort',44080)),'--token',spec['token'],*(['--port',str(spec['port'])] if 'port' in spec else [])]));return probe_result(shell(spec['node'],text,30))
 try:
  report['system']=api.request('GET','/system_information');report['unrelatedBefore']={l['id']:l['state'] for l in api.request('GET','/labs?with_data=true')}
  if args.resume_owned_from:
   owner=json.loads(args.resume_owned_from.read_text());details=verify_owner(api,owner)
   if details['state']=='STOPPED':api.request('PUT',f'/labs/{owner["labId"]}/start')
  else:owner=create_lab(api)
  report.update({k:owner[k] for k in ['labId','runId','nodes','links']});report['title']='NetworkSim NAT '+owner['runId'];report['status']='booting';save()
  for key in SPEC:ready(key);connect(key)
  for key in ['IOS','NX']:
   wait_for_ports(consoles[key],{'cml':{'definition':SPEC[key][0]}},['Ethernet0/0','Ethernet0/1'] if key=='IOS' else ['Ethernet1/1','Ethernet1/2'],720);report['versions'][key]=command(consoles[key],'show version')['raw']
  # Hardware preparation belongs to the disposable reference image, not the simulator CLI.
  tcam=command(consoles['NX'],'show hardware access-list tcam region')['raw'];report['nxHardwareBefore']=tcam
  if not re.search(r'NAT ACL\[nat\] size =\s+[1-9]',tcam):
   files=command(consoles['NX'],'dir bootflash:')['raw'];images=set(re.findall(r'\b(nxos[^\s]+\.bin)\b',files))
   if len(images)!=1:raise ValueError('Cannot identify a unique real Nexus boot image')
   rows=config('NX',['configure terminal','feature nat','hardware access-list tcam region vpc-convergence 0','hardware access-list tcam region nat 512','boot nxos bootflash:'+images.pop(),'end','copy running-config startup-config']);report['nxHardwarePreparation']=rows;save()
   if not all(r['passed'] for r in rows) or 'Copy complete' not in rows[-1]['raw']:raise RuntimeError('Nexus TCAM preparation/save failed')
   consoles['NX'].close();verify_owner(api,owner);api.request('PUT',f'/labs/{owner["labId"]}/nodes/{owner["nodes"]["NX"]}/state/stop')
   deadline=time.monotonic()+120
   while api.request('GET',f'/labs/{owner["labId"]}/nodes/{owner["nodes"]["NX"]}')['state']!='STOPPED':
    if time.monotonic()>deadline:raise TimeoutError('Nexus did not stop')
    time.sleep(2)
   api.request('PUT',f'/labs/{owner["labId"]}/nodes/{owner["nodes"]["NX"]}/state/start');ready('NX');connect('NX');wait_for_ports(consoles['NX'],{'cml':{'definition':SPEC['NX'][0]}},['Ethernet1/1','Ethernet1/2'],720)
  report['nxHardwareAfter']=command(consoles['NX'],'show hardware access-list tcam region')['raw'];save()
  for key in ['I1','O1','I2','O2']:
   shells[key].upload(ASSETS/'endpoint.py','/tmp/nat-endpoint.py');shell(key,"pkill -f '^python3 /tmp/nat-endpoint.py serve ' || true; : >/tmp/nat-events.jsonl")
   addresses=[SUBNET[key]+str(n) for n in ([10,11,12] if key[0]=='I' else [100,101])];shell(key,'python3 /tmp/nat-endpoint.py serve '+' '.join(addresses)+' --log /tmp/nat-events.jsonl >/tmp/nat-server.out 2>&1 &')
   shell(key,f"(for i in $(seq 1 50); do test $(grep -c '\"ready\": true' /tmp/nat-server.out) -eq {len(addresses)*2} && exit 0; sleep 0.1; done; exit 1)")
  for link in owner['links']:api.request('PUT',f'/labs/{owner["labId"]}/links/{link}/capture/start',{'maxtime':3600,'maxpackets':100000});started.append(link)
  plan=scenario();write_json(args.output/'scenario.json',plan);report['scenarioSha256']=hashlib.sha256((args.output/'scenario.json').read_bytes()).hexdigest();report['status']='testing';save();probes={}
  for spec in plan['steps']:
   row={'id':spec['id'],'kind':spec['kind'],'node':spec.get('node')};report['steps'].append(row)
   if spec['kind'] in ['config','survey']:
    rows=config('IOS',spec['commands']);row.update(commands=rows,passed=all(r['passed'] for r in rows))
   elif spec['kind']=='probe':
    result=probe(spec);probes[spec['token']]=result;row.update(result=result,passed=probe_pass(spec,result))
   elif spec['kind']=='wait':time.sleep(spec['seconds']);row['passed']=True
   elif spec['kind']=='unsolicited':
    port=probes[spec['reference']]['observed']['sourcePort'];shell('I1',f": >/tmp/nat-extra.jsonl; python3 /tmp/nat-endpoint.py serve {spec['inside']} --udp-only --udp-port {spec['insidePort']} --log /tmp/nat-extra.jsonl >/tmp/nat-extra.out 2>&1 &");shell('I1',"(for i in $(seq 1 50); do grep -q '\"ready\": true' /tmp/nat-extra.out && exit 0; sleep 0.1; done; exit 1)")
    result=probe({**spec,'protocol':'udp','port':port});received=shell('I1','cat /tmp/nat-extra.jsonl');row.update(result=result,insideLog=received,passed=result['success'] is False and spec['token'] not in received)
   print(row['id'],row['kind'],'PASS' if row['passed'] else 'FAIL',flush=True);save()
  report['iosStatus']='passed' if all(r['passed'] for r in report['steps']) else 'differences'
  # Native Nexus support is proved by translated packets, after a routed baseline and real TCAM preparation.
  report['nxEnable']=config('NX',['configure terminal','feature nat','end'])
  if not all(row['passed'] for row in report['nxEnable']):raise RuntimeError('Could not enable owned Nexus NAT feature')
  report['nxBeforeReset']=command(consoles['NX'],'show running-config nat')['raw']
  saved=report['nxBeforeReset'].replace('\r','').splitlines();rules=[line.strip() for line in saved if line.startswith('ip nat inside source ')];pools=[line.strip().split()[3] for line in saved if line.startswith('ip nat pool ')]
  report['nxReset']=config('NX',['clear ip nat translation all','configure terminal',*['no '+rule for rule in rules],*['no ip nat pool '+pool for pool in pools],'interface Ethernet1/1','no ip nat inside','exit','interface Ethernet1/2','no ip nat outside','end'])
  if not all(row['passed'] for row in report['nxReset']):raise RuntimeError('Could not reset owned Nexus NAT baseline')
  time.sleep(3);report['nxSteps']=[]
  base=probe({'node':'I2','protocol':'udp','source':'192.168.20.10','destination':'198.51.100.100','token':'nx-baseline','sourcePort':44400});report['nxBaseline']=base
  report['nxBaselineSecondary']=[probe({'node':'I2','protocol':'udp','source':f'192.168.20.{host}','destination':'198.51.100.100','token':f'nx-baseline-{host}','sourcePort':44400}) for host in [11,12]]
  report['nxSteps']+=config('NX',['clear ip nat translation all','configure terminal','feature nat','no ip nat inside source list 1 interface Ethernet1/2 overload','interface Ethernet1/1','ip nat inside','exit','interface Ethernet1/2','ip nat outside','exit','ip nat inside source static 192.168.20.10 198.51.100.10','end'])
  report['nxProbes']=[]
  for protocol in ['icmp','udp','tcp']:
   for incoming in [False,True]:
    spec={'node':'O2' if incoming else 'I2','protocol':protocol,'source':'198.51.100.100' if incoming else '192.168.20.10','destination':'198.51.100.10' if incoming else '198.51.100.100','token':f'nx-static-{protocol}-{incoming}','sourcePort':44410,'success':True,'observedSource':'198.51.100.100' if incoming else '198.51.100.10'};result=probe(spec);report['nxProbes'].append({'spec':spec,'result':result,'passed':probe_pass(spec,result)})
  report['nxSurvey']=config('NX',['show ip nat translations','show ip nat translations verbose','show ip nat statistics','show ip nat-alias','show running-config nat']);report['nxStaticStatus']='passed' if probe_pass({'success':True,'protocol':'udp','observedSource':'192.168.20.10'},base) and all(probe_pass({'success':True,'protocol':'udp','observedSource':f'192.168.20.{host}'},r) for host,r in zip([11,12],report['nxBaselineSecondary'])) and all(r['passed'] for r in report['nxSteps']+report['nxProbes']) else 'not-validated';save()
  report['nxModes']={}
  for mode in ['dynamic','pool-overload','interface-overload']:
   commands=['clear ip nat translation all','configure terminal','no ip nat inside source static 192.168.20.10 198.51.100.10','no ip nat inside source list NAT-INSIDE pool PUBLIC','no ip nat inside source list NAT-INSIDE pool PUBLIC overload','no ip nat inside source list NAT-INSIDE interface Ethernet1/2 overload','ip access-list NAT-INSIDE','10 permit ip 192.168.20.0/24 any','exit','ip nat pool PUBLIC 198.51.100.10 198.51.100.11 prefix-length 24','ip nat inside source list NAT-INSIDE '+('interface Ethernet1/2 overload' if mode=='interface-overload' else 'pool PUBLIC'+(' overload' if mode=='pool-overload' else '')),'end']
   record={'commands':config('NX',commands),'probes':[]};time.sleep(3);report['nxModes'][mode]=record;save()
   for protocol in ['udp','tcp','icmp']:
    for host in [10,11,12]:
     spec={'node':'I2','protocol':protocol,'source':f'192.168.20.{host}','destination':'198.51.100.100','sourcePort':44500,'token':f'nx-{mode}-{protocol}-{host}','success':not(mode=='dynamic' and host==12)}
     if protocol!='icmp' and spec['success']:spec['observedSource']='198.51.100.1' if mode=='interface-overload' else '198.51.100.'+str(host) if mode=='dynamic' else None
     if mode=='pool-overload':spec['observedRange']=['198.51.100.10','198.51.100.11']
     result=probe(spec);record['probes'].append({'spec':spec,'result':result,'passed':probe_pass(spec,result)});print('NX',mode,protocol,host,result['success'],flush=True);save()
   record['survey']=config('NX',['show ip nat translations verbose','show ip nat statistics','show ip nat-alias','show running-config nat']);record['passed']=all(r['passed'] for r in record['probes']) and record['commands'][-2]['passed'];save()
  report['nxStatus']='passed' if report['nxStaticStatus']=='passed' and all(x['passed'] for x in report['nxModes'].values()) else 'differences';report['status']='passed' if report['iosStatus']=='passed' and report['nxStatus']=='passed' else 'differences';save()
  report['receiverLogs']={key:shell(key,'cat /tmp/nat-events.jsonl') for key in ['I1','O1','I2','O2']}
 except (Exception,KeyboardInterrupt) as error:report['status']='failed';report['error']=str(error) or type(error).__name__;save()
 finally:
  for c in consoles.values():c.close()
  if owner:
   for link in started:
    try:
     api.request('PUT',f'/labs/{owner["labId"]}/links/{link}/capture/stop');data=api.request('GET',f'/pcap/{link}',binary=True);file=link+'.pcap';(args.output/file).write_bytes(data);report['captures'].append({'linkId':link,'file':file,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    except Exception as error:report.setdefault('cleanupErrors',[]).append(str(error))
   try:
    verify_owner(api,owner);api.request('PUT',f'/labs/{owner["labId"]}/stop');deadline=time.monotonic()+60
    while time.monotonic()<deadline:
     if api.request('GET',f'/labs/{owner["labId"]}')['state']=='STOPPED':report['labStopped']=True;break
     time.sleep(2)
   except Exception as error:report.setdefault('cleanupErrors',[]).append(str(error))
  if len(report['captures'])==4 and (args.output/'scenario.json').is_file():
   try:
    report['wireEvidence']=evidence(report,json.loads((args.output/'scenario.json').read_text()),args.output)
    if report['status']=='passed' and not report['wireEvidence']['passed']:report['status']='differences'
   except Exception as error:report['status']='failed';report['wireEvidenceError']=str(error)
  report['unrelatedAfter']={l['id']:l['state'] for l in api.request('GET','/labs?with_data=true') if not owner or l['id']!=owner['labId']};report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
 print('NAT reference capture:',report['status'],args.output/'capture.json',flush=True);return 0 if report['status']=='passed' and report['labStopped'] and len(report['captures'])==4 else 1
if __name__=='__main__':sys.exit(main())
