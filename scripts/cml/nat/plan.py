"""Packet assertions for native IOS NAT; NX-OS is checked separately, with hardware prerequisites."""
import json
from pathlib import Path

def scenario():
 steps=[]
 def cfg(*commands):steps.append({'kind':'config','node':'IOS','commands':list(commands)})
 def show(*commands):steps.append({'kind':'survey','node':'IOS','commands':list(commands)})
 def probe(protocol,source,target,token,translated=None,success=True,source_port=44080):steps.append({'kind':'probe','node':'I1' if source.startswith('192.') else 'O1','protocol':protocol,'source':source,'destination':target,'token':token,'success':success,'observedSource':translated,'sourcePort':source_port})
 cfg('clear ip nat translation *','configure terminal','no ip nat inside source static 192.168.10.10 203.0.113.10','no ip nat inside source list 1 pool PUBLIC','no ip nat inside source list 1 pool SHORT','no ip nat inside source list 1 interface Ethernet0/1 overload','no ip nat inside source list 99 interface Ethernet0/1 overload','no ip nat pool PUBLIC','no ip nat pool SHORT','no ip nat translation timeout','no ip nat translation udp-timeout','no ip nat translation icmp-timeout','interface Ethernet0/0','ip nat inside','exit','interface Ethernet0/1','ip nat outside','exit','access-list 1 permit 192.168.10.0 0.0.0.255','end')
 probe('udp','192.168.10.10','203.0.113.100','ios-baseline','192.168.10.10')
 probe('udp','203.0.113.100','203.0.113.10','ios-unallocated',success=False)
 cfg('configure terminal','ip nat inside source static 192.168.10.10 203.0.113.10','end','debug ip nat')
 show('show ip nat translations','show ip nat translations verbose','show ip nat statistics')
 for protocol in ['icmp','udp','tcp']:
  probe(protocol,'192.168.10.10','203.0.113.100','ios-static-out-'+protocol,'203.0.113.10')
  probe(protocol,'203.0.113.100','203.0.113.10','ios-static-in-'+protocol,'203.0.113.100',source_port=45080)
 show('show ip nat translations verbose','show ip nat statistics','show running-config | include ip nat')
 cfg('clear ip nat translation *')
 show('show ip nat translations')
 probe('udp','192.168.10.10','203.0.113.100','ios-static-confirm','203.0.113.10',source_port=44081)
 cfg('configure terminal',{'command':'no ip nat inside source static 192.168.10.10 203.0.113.10','answer':''},'end')
 show('show ip nat translations')
 cfg('configure terminal',{'command':'no ip nat inside source static 192.168.10.10 203.0.113.10','answer':'yes'},'end')
 show('show ip nat translations')
 cfg('configure terminal','ip nat pool PUBLIC 203.0.113.10 203.0.113.11 netmask 255.255.255.0','ip nat inside source list 1 pool PUBLIC','end')
 for protocol in ['icmp','udp','tcp']:probe(protocol,'192.168.10.10','203.0.113.100','ios-dynamic-'+protocol,'203.0.113.10',source_port=44082)
 probe('udp','192.168.10.11','203.0.113.100','ios-dynamic-second','203.0.113.11',source_port=44082)
 probe('udp','192.168.10.12','203.0.113.100','ios-dynamic-exhausted',success=False,source_port=44082)
 probe('udp','203.0.113.101','203.0.113.10','ios-dynamic-fresh-in','203.0.113.101',source_port=45082)
 show('show ip nat translations verbose','show ip nat statistics')
 cfg('configure terminal',{'command':'no ip nat inside source list 1 pool PUBLIC','reject':True},{'command':'no ip nat pool PUBLIC','reject':True},'end','clear ip nat translation *','configure terminal','no ip nat inside source list 1 pool PUBLIC','no ip nat pool PUBLIC','ip nat inside source list 1 interface Ethernet0/1 overload','end')
 for protocol in ['udp','tcp','icmp']:
  probe(protocol,'192.168.10.10','203.0.113.100','ios-pat-first-'+protocol,'203.0.113.1',source_port=44083)
  probe(protocol,'192.168.10.11','203.0.113.100','ios-pat-second-'+protocol,'203.0.113.1',source_port=44083)
 probe('udp','192.168.10.10','203.0.113.101','ios-pat-other-peer','203.0.113.1',source_port=44083)
 steps.append({'kind':'unsolicited','node':'O1','reference':'ios-pat-first-udp','source':'203.0.113.101','destination':'203.0.113.1','sourcePort':45083,'inside':'192.168.10.10','insidePort':44083,'token':'ios-pat-unsolicited','success':False})
 show('show ip nat translations verbose','show ip nat statistics')
 cfg('clear ip nat translation *','configure terminal','no ip nat inside source list 1 interface Ethernet0/1 overload','ip nat pool SHORT 203.0.113.20 203.0.113.21 netmask 255.255.255.0','ip nat inside source list 1 pool SHORT','ip nat translation timeout 4','ip nat translation udp-timeout 4','end')
 probe('udp','192.168.10.10','203.0.113.100','ios-timer','203.0.113.20',source_port=44084)
 show('show ip nat translations verbose')
 steps.append({'kind':'wait','seconds':6})
 show('show ip nat translations','show ip nat statistics')
 cfg('configure terminal','no ip nat inside source list 1 pool SHORT','no ip nat pool SHORT','no ip nat translation timeout','no ip nat translation udp-timeout','ip nat inside source list 99 interface Ethernet0/1 overload','end')
 probe('udp','192.168.10.10','203.0.113.100','ios-missing-acl','192.168.10.10',source_port=44085)
 show('show ip nat translations')
 cfg('configure terminal','no ip nat inside source list 99 interface Ethernet0/1 overload','ip nat inside source list 1 interface Ethernet0/1 overload','end','undebug all')
 show('show running-config | include ip nat','show logging')
 return {'schemaVersion':1,'id':'nat','steps':[{'id':f'nat-{i+1:03}',**s} for i,s in enumerate(steps)]}
def nx_scenario():
 """Working C9300v forms; basic non-overloaded pools remain a failed reference candidate."""
 steps=[]
 def cfg(*commands):steps.append({'kind':'config','node':'NX','commands':list(commands)})
 def show():steps.append({'kind':'survey','node':'NX','commands':['show ip nat translations verbose','show ip nat statistics','show ip nat-alias','show running-config nat']})
 cfg('configure terminal','feature nat','interface Ethernet1/1','ip nat inside','interface Ethernet1/2','ip nat outside','ip nat inside source static 192.168.20.10 198.51.100.10','end')
 for protocol in ['icmp','udp','tcp']:
  for incoming in [False,True]:steps.append({'kind':'probe','node':'O2' if incoming else 'I2','protocol':protocol,'source':'198.51.100.100' if incoming else '192.168.20.10','destination':'198.51.100.10' if incoming else '198.51.100.100','token':f'nx-static-{protocol}-{incoming}','sourcePort':44410,'success':True,'observedSource':'198.51.100.100' if incoming else '198.51.100.10'})
 show();cfg('clear ip nat translation all','configure terminal','no ip nat inside source static 192.168.20.10 198.51.100.10','ip access-list NAT-INSIDE','10 permit ip 192.168.20.0/24 any','exit','ip nat pool PUBLIC 198.51.100.10 198.51.100.11 prefix-length 24','ip nat inside source list NAT-INSIDE pool PUBLIC overload','end')
 for mode in ['pool-overload','interface-overload']:
  if mode=='interface-overload':cfg('clear ip nat translation all','configure terminal',{'command':'no ip nat inside source list NAT-INSIDE pool PUBLIC overload','answer':'y'},'ip nat inside source list NAT-INSIDE interface Ethernet1/2 overload','end')
  for protocol in ['udp','tcp','icmp']:
   for host in [10,11,12]:steps.append({'kind':'probe','node':'I2','protocol':protocol,'source':f'192.168.20.{host}','destination':'198.51.100.100','sourcePort':44500,'token':f'nx-{mode}-{protocol}-{host}','success':True,**({'observedSource':'198.51.100.1'} if mode=='interface-overload' else {'observedRange':['198.51.100.10','198.51.100.11']})})
  show()
 return {'schemaVersion':1,'id':'nx-nat','steps':[{'id':f'nx-nat-{i+1:03}',**s} for i,s in enumerate(steps)]}
if __name__=='__main__':
 import sys
 print(json.dumps(nx_scenario() if '--nx' in sys.argv else scenario(),indent=2))
