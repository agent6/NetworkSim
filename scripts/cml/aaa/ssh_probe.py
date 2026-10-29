#!/usr/bin/env python3
"""Real OpenSSH probe inside the owned CML Linux node; uses synthetic lab credentials."""
import json,re,sys,time
import pexpect
host,user,password,*commands=sys.argv[1:]
prompt=r'(?m)(?:^|[\r\n])(?:[ \t\r]|\x1b\[[0-?]*[ -/]*[@-~])*[A-Za-z0-9_.-]+(?:\([^\r\n)]*\))?[>#][ \t\r]*$'
c=pexpect.spawn('/usr/bin/ssh',['-tt','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile=/tmp/netsim-hosts',user+'@'+host],encoding='utf-8',timeout=25,echo=False,dimensions=(200,132))
result={'host':host,'username':user,'authenticated':False,'commands':[]}
try:
 m=c.expect([r'(?i)password:\s*$',prompt,pexpect.EOF,pexpect.TIMEOUT])
 if m==0:c.sendline(password);m=c.expect([prompt,r'(?i)(?:password incorrect|permission denied|authentication failed|password:)\s*',pexpect.EOF,pexpect.TIMEOUT])
 else:m=0 if m==1 else m
 result['loginOutput']=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',c.before)
 if m!=0:print(json.dumps(result));sys.exit(3)
 result['authenticated']=True
 for command in commands:
  c.sendline(command);c.expect_exact(command);m=c.expect([prompt,pexpect.EOF,pexpect.TIMEOUT]);result['commands'].append({'command':command,'raw':c.before,'closed':m==1,'timedOut':m==2})
  if m:break
 print(json.dumps(result))
finally:c.close(force=True)
