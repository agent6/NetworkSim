#!/usr/bin/env python3
"""Own an isolated CML AAA lab; validate real SSH, native AAA daemons and PCAPs.

No controller credentials are written to arguments, artifacts or source. This
workflow does not emulate binary AAA packets in the browser simulator.
"""
from __future__ import annotations
import argparse,base64,datetime,getpass,hashlib,json,re,shlex,sys,time,uuid
from pathlib import Path
from urllib.parse import urlsplit
from client import CML
from capture import Console,REJECTED,write_json
from aaa.plan import suite
from aaa_evidence import aaa_packets,complete_aaa_evidence

SPEC={'IOS':('ioll2-xe','ioll2-xe-17-18-02'),'NX':('nxosv9000','nxosv9300-10-6-2-f'),'PROBE':('iol-xe','iol-xe-17-18-02'),'AAA':('net-tools','net-tools-2-10-1-3'),'NAT':('external_connector',None)}
LINKS=[('IOS','Ethernet0/0','AAA','eth0'),('IOS','Ethernet0/1','NX','mgmt0'),('IOS','Ethernet0/2','PROBE','Ethernet0/0'),('AAA','eth1','NAT','port')]
ASSETS=Path(__file__).parent/'aaa'

def startup(key):
 if key=='NAT':return 'NAT'
 if key=='AAA':return '#!/bin/bash\nhostname AAA\nip addr add 192.168.100.10/24 dev eth0\nip link set eth0 up\necho READY >/dev/console\nexit 0'
 if key=='NX':return '\n'.join(['hostname NX','no password strength-check','username admin password NetSimLab42! role network-admin','interface mgmt0','ip address 192.168.100.2/24','no shutdown','end'])
 lines=['hostname '+key,'no ip domain-lookup','no logging console','username admin privilege 15 secret NetSimLab42!','ip domain name netsim.test','crypto key generate rsa modulus 2048','ip ssh version 2','line console 0','exec-timeout 0 0','exit']
 if key=='IOS':lines+=['vlan 100','interface range Ethernet0/0 - 2','switchport mode access','switchport access vlan 100','spanning-tree portfast','no shutdown','exit','interface Vlan100','ip address 192.168.100.1 255.255.255.0','no shutdown','exit']
 else:lines+=['interface Ethernet0/0','ip address 192.168.100.30 255.255.255.0','no shutdown','exit']
 return '\n'.join(lines+['line vty 0 4','login local','transport input ssh','end'])

def verify_owner(api,owned):
 lab=owned['labId'];details=api.request('GET',f'/labs/{lab}')
 if not owned.get('runId') or details['lab_title']!='NetworkSim AAA '+owned['runId']:raise ValueError('Owned AAA lab title mismatch')
 nodes=api.request('GET',f'/labs/{lab}/nodes?data=true&exclude_configurations=true')
 if {n['label']:n['id'] for n in nodes}!=owned['nodes']:raise ValueError('Owned AAA node identity mismatch')
 if any(n['label'] not in SPEC or (n['node_definition'],n.get('image_definition'))!=SPEC[n['label']] for n in nodes):raise ValueError('Owned AAA image/definition mismatch')
 links=api.request('GET',f'/labs/{lab}/links?data=true')
 if {l['id'] for l in links}!=set(owned['links']) or len(links)!=len(LINKS):raise ValueError('Owned AAA links changed')
 # Verify the endpoints too; an ownership file alone is not a topology contract.
 interfaces={}
 for label,node in owned['nodes'].items():
  for interface in api.request('GET',f'/labs/{lab}/nodes/{node}/interfaces?data=true'):interfaces[interface['id']]=(label,interface['label'])
 expected={frozenset(((a,p),(b,q))) for a,p,b,q in LINKS}
 if {frozenset((interfaces[l['interface_a']],interfaces[l['interface_b']])) for l in links}!=expected:raise ValueError('Owned AAA link endpoint mismatch')
 return details

def create_lab(api):
 run=uuid.uuid4().hex[:10];lab=api.request('POST','/labs',{'title':'NetworkSim AAA '+run,'description':'Disposable AAA validation; NAT egress only during package bootstrap.'})['id']
 owned={'labId':lab,'runId':run,'nodes':{},'links':[]}
 # A partial creation still has an exact owned lab id for safe cleanup.
 try:
  for i,(key,(definition,image)) in enumerate(SPEC.items()):
   body={'label':key,'node_definition':definition,'x':i*150,'y':0,'configuration':startup(key)}
   if image:body['image_definition']=image
   owned['nodes'][key]=api.request('POST',f'/labs/{lab}/nodes?populate_interfaces=true',body)['id']
  for a,p,b,q in LINKS:
   endpoints=[]
   for key,port in [(a,p),(b,q)]:
    interfaces=api.request('GET',f'/labs/{lab}/nodes/{owned["nodes"][key]}/interfaces?data=true')
    endpoints.append(next(v['id'] for v in interfaces if v['label']==port))
   owned['links'].append(api.request('POST',f'/labs/{lab}/links',{'src_int':endpoints[0],'dst_int':endpoints[1]})['id'])
  api.request('PUT',f'/labs/{lab}/start');return owned
 except Exception:
  if api.request('GET',f'/labs/{lab}')['lab_title']=='NetworkSim AAA '+run:api.request('PUT',f'/labs/{lab}/stop')
  raise

class Shell:
 def __init__(self,console):
  self.console=console;c=console.child;c.expect(r'(?m)^.*[#$>] ',timeout=180);c.sendcontrol('c');c.sendline('');c.expect(r'(?m)^.*[#$] ',timeout=10)
  self.command("stty cols 1000; export PS1='NSAAA# '")
 def command(self,command,timeout=120):
  import pexpect
  token='NETSIM_DONE_'+uuid.uuid4().hex;c=self.console.child
  c.sendline('eval '+shlex.quote(command)+"; rc=$?; printf '\\n"+token+" %s\\n' \"$rc\"")
  m=c.expect([r'(?m)^'+token+r' (\d+)\r?$',pexpect.TIMEOUT,pexpect.EOF],timeout=timeout);raw=c.before
  if m:raise TimeoutError('CML Linux shell did not complete: '+command[:80])
  code=int(c.match.group(1));c.expect_exact('NSAAA# ',timeout=10);return raw,code
 def upload(self,source,destination):
  content=base64.b64encode(source.read_bytes()).decode();raw,code=self.command('printf %s '+content+' | base64 -d >'+shlex.quote(destination))
  if code:raise RuntimeError('CML Linux upload failed')

def probe_result(raw):
 for line in raw.splitlines():
  if line.startswith('{"host":'):
   value=json.loads(line);return value
 raise ValueError('SSH probe did not return a structured result')

def evaluate_probe(spec,result):
 if result.get('authenticated') is not spec['authenticated']:return False
 commands=result.get('commands',[])
 if spec['authenticated'] and (len(commands)!=len(spec['commands']) or any(c.get('timedOut') for c in commands)):return False
 body='\n'.join(c['raw'] for c in commands)+'\n'+result.get('loginOutput','')
 return all(re.search(pattern,body,re.I) for pattern in spec.get('expect',[]))

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--url',default='https://192.168.1.201');parser.add_argument('--username',default='admin');parser.add_argument('--insecure',action='store_true');parser.add_argument('--known-hosts',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--resume-owned-from',type=Path);parser.add_argument('--provision',action='store_true',help='Install pinned daemons in the disposable Linux node; required for a fresh lab');args=parser.parse_args()
 if not args.known_hosts.is_file():parser.error('Verify the controller SSH key and provide its known-hosts file')
 if args.output.exists():parser.error('Output directory must be new')
 if not args.resume_owned_from and not args.provision:parser.error('A new Linux node requires --provision')
 import pexpect
 args.output.mkdir(parents=True,mode=0o700);password=getpass.getpass('CML password: ');api=CML(args.url,args.username,password,insecure=args.insecure);api.login()
 report={'schemaVersion':1,'source':'cml','scenario':'aaa','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'starting','steps':[],'captures':[],'versions':{},'labStopped':False};consoles={};started=[];owned=None
 def save():
  raw=json.dumps(report)
  for secret in (password,api._token):
   if secret:raw=raw.replace(secret,'<redacted>')
  write_json(args.output/'capture.json',json.loads(raw))
 def config(node,commands):
  rows=[]
  for command in commands:
   raw,timed=consoles[node].command(command,90);body=re.sub(r'^'+re.escape(command)+r'\r?\n?','',raw,count=1);rows.append({'command':command,'raw':raw,'timedOut':timed,'passed':not timed and not re.search(REJECTED,body)})
  return rows
 try:
  report['system']=api.request('GET','/system_information');report['unrelatedLabsBefore']={l['id']:l['state'] for l in api.request('GET','/labs?with_data=true')}
  if args.resume_owned_from:
   owned=json.loads(args.resume_owned_from.read_text());details=verify_owner(api,owned)
   if details['state'] not in ('STARTED','BOOTED'):raise ValueError('Warm reuse requires an already running owned lab; omit --resume-owned-from for a new provisioned run')
  else:owned=create_lab(api)
  report.update({k:owned[k] for k in ['labId','runId','nodes','links']});report['title']='NetworkSim AAA '+owned['runId'];report['status']='booting';save();lab=owned['labId']
  deadline=time.monotonic()+1500
  while True:
   states=api.request('GET',f'/labs/{lab}/nodes?data=true&exclude_configurations=true');report['bootStates']={n['label']:n['state'] for n in states};save()
   if all(n['state']=='BOOTED' for n in states):break
   if time.monotonic()>deadline:raise TimeoutError('CML AAA boot timeout')
   time.sleep(5)
  for key in ['IOS','NX','AAA']:
   c=Console(urlsplit(args.url).hostname,args.username,password,lab,owned['nodes'][key],args.known_hosts,args.output/(key+'-console.txt'));consoles[key]=c
   if key!='AAA':c.ready(timeout=180);config(key,['terminal length 0','terminal width 132']);report['versions'][key]=config(key,['show version'])[0]['raw']
  shell=Shell(consoles['AAA']);report['status']='provisioning';save()
  if args.provision:
   shell.upload(ASSETS/'bootstrap.sh','/tmp/netsim-bootstrap.sh');raw,code=shell.command('bash /tmp/netsim-bootstrap.sh',600);(args.output/'bootstrap.txt').write_text(raw)
   if code:raise RuntimeError('Linux AAA bootstrap failed; see bootstrap.txt')
  for source,target in [('clients.conf','/etc/freeradius/3.0/clients.conf'),('users','/etc/freeradius/3.0/mods-config/files/authorize'),('tac_plus-ng.cfg','/tmp/tac_plus-ng.cfg'),('ssh_probe.py','/tmp/ssh_probe.py')]:shell.upload(ASSETS/source,target)
  for command in ['pkill freeradius || true; pkill tac_plus-ng || true','freeradius -X >/tmp/radius.log 2>&1 &','tac_plus-ng -P /tmp/tac_plus-ng.cfg','tac_plus-ng /tmp/tac_plus-ng.cfg >/tmp/tacacs.log 2>&1 &']:
   raw,code=shell.command(command)
   if code:raise RuntimeError('AAA daemon start failed: '+raw[-1000:])
  raw,code=shell.command('freeradius -v; ss -ltnup; git -C /opt/netsim-tacsrc rev-parse HEAD 2>/dev/null || git -C /opt/tacsrc rev-parse HEAD');report['versions']['AAA']=raw;save()
  for link in owned['links'][:2]:api.request('PUT',f'/labs/{lab}/links/{link}/capture/start',{'maxtime':1800,'maxpackets':100000});started.append(link)
  report['status']='testing';plan=suite();write_json(args.output/'plan.json',plan);report['planSha256']=hashlib.sha256((args.output/'plan.json').read_bytes()).hexdigest();save()
  for i,spec in enumerate(plan):
   row={'id':f'aaa-{i+1:03}','kind':spec['kind'],'node':spec['node']};report['steps'].append(row)
   if spec['kind']=='probe':
    host='192.168.100.1' if spec['node']=='IOS' else '192.168.100.2';command='python3 /tmp/ssh_probe.py '+' '.join(map(shlex.quote,[host,spec['username'],spec['password'],*spec['commands']]))
    raw,code=shell.command(command,120);result=probe_result(raw);row.update({'result':result,'exitCode':code,'passed':evaluate_probe(spec,result)})
    # Native login banners are unrelated to fidelity and remain in private console transcripts.
    if result['authenticated']:result.pop('loginOutput',None)
   else:
    rows=config(spec['node'],spec['commands']);row.update({'commands':rows,'passed':all(r['passed'] for r in rows)})
   print(row['id'],spec['node'],spec['kind'],'PASS' if row['passed'] else 'FAIL',flush=True);save()
  report['serverLogs']={}
  for name,path in [('radius','/tmp/radius.log'),('tacacsAuthc','/tmp/tacacs-authc.log'),('tacacsAuthz','/tmp/tacacs-authz.log'),('tacacsAccounting','/tmp/tacacs-acct.log')]:
   raw,code=shell.command('cat '+path);report['serverLogs'][name]=raw
  # Actual acknowledged Start/Stop and configuration command records are mandatory evidence.
  acct=report['serverLogs']['tacacsAccounting'];report['accountingEvidence']={address:bool(re.search(re.escape(address)+r'\s+remote[^\n]*\tstart\t',acct)) and bool(re.search(re.escape(address)+r'\s+remote[^\n]*\tstop\t',acct)) for address in ['192.168.100.1','192.168.100.2']}
  report['status']='passed' if all(r['passed'] for r in report['steps']) and all(report['accountingEvidence'].values()) else 'differences';save()
 except Exception as error:report['status']='failed';report['error']=str(error);save()
 finally:
  for c in consoles.values():c.close()
  if owned:
   for link in started:
    try:
     api.request('PUT',f'/labs/{owned["labId"]}/links/{link}/capture/stop');data=api.request('GET',f'/pcap/{link}',binary=True);name=link+'.pcap';(args.output/name).write_bytes(data);summary=aaa_packets(data);report['captures'].append({'linkId':link,'file':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'packets':summary,'passed':complete_aaa_evidence(summary)})
     if not complete_aaa_evidence(summary) and report['status']=='passed':report['status']='differences'
    except Exception as error:report.setdefault('cleanupErrors',[]).append(str(error))
   try:
    verify_owner(api,owned);api.request('PUT',f'/labs/{owned["labId"]}/stop')
    deadline=time.monotonic()+60
    while time.monotonic()<deadline:
     if api.request('GET',f'/labs/{owned["labId"]}')['state']=='STOPPED':report['labStopped']=True;break
     time.sleep(2)
   except Exception as error:report.setdefault('cleanupErrors',[]).append(str(error))
  report['evidencePassed']=len(report['captures'])==2 and all(c.get('passed') for c in report['captures']) and report['labStopped'] and not report.get('cleanupErrors')
  if report['status']=='passed' and not report['evidencePassed']:report['status']='failed'
  report['unrelatedLabsAfter']={l['id']:l['state'] for l in api.request('GET','/labs?with_data=true') if not owned or l['id']!=owned['labId']};report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
 print('AAA capture:',report['status'],args.output/'capture.json',flush=True)
 return 0 if report['status']=='passed' and report['labStopped'] and len(report['captures'])==2 and all(c['bytes']>24 for c in report['captures']) else 1

if __name__=='__main__':sys.exit(main())
