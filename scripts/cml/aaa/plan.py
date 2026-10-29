"""Shared native test vectors. Every probe checks returned data, never echoed commands."""
LAB_KEY='LabShared42'
def ios(protocol):
 name,group=('RADIUS1','RAD-GROUP') if protocol=='radius' else ('TACACS1','TAC-GROUP')
 return ['configure terminal',f'{protocol} server {name}','address ipv4 192.168.100.10',f'key {LAB_KEY}','timeout 2',*(['retransmit 0'] if protocol=='radius' else []),'exit',f'aaa group server {"radius" if protocol=="radius" else "tacacs+"} {group}',f'server name {name}','exit',f'aaa authentication login default group {group} local',f'aaa authorization exec default group {group} local',f'aaa accounting exec default start-stop group {group}','line vty 0 4','login authentication default','accounting exec default','transport input ssh','exit','end']
def nx(protocol):
 group='RAD-GROUP' if protocol=='radius' else 'TAC-GROUP'
 return ['configure terminal',*(['feature tacacs+'] if protocol=='tacacs' else []),f'{protocol}-server host 192.168.100.10 key 0 {LAB_KEY}',f'{protocol}-server host 192.168.100.10 timeout 2',*([f'{protocol}-server host 192.168.100.10 retransmit 0'] if protocol=='radius' else []),f'aaa group server {"radius" if protocol=="radius" else "tacacs+"} {group}','server 192.168.100.10','use-vrf management','exit',f'aaa authentication login default group {group}',f'aaa accounting default group {group}','end']

def suite():
 steps=[]
 def config(node,commands):steps.append({'kind':'config','node':node,'commands':commands})
 def probe(node,user,password,commands=(),expect=(),authenticated=True):steps.append({'kind':'probe','node':node,'username':user,'password':password,'commands':list(commands),'expect':list(expect),'authenticated':authenticated})
 config('IOS',['configure terminal','aaa new-model','username admin privilege 15 secret NetSimLab42!','username fallback privilege 15 secret LocalOnly42!','aaa authentication login CONSOLE local','aaa authentication login default local','aaa authorization exec default local','line console 0','login authentication CONSOLE','exit','line vty 0 4','login authentication default','transport input ssh','exit','end'])
 config('NX',['configure terminal','aaa authentication login console local','username fallback password LocalOnly42! role network-admin','aaa authentication login default local','end'])
 for node in ['IOS','NX']:probe(node,'fallback','LocalOnly42!',['show privilege','exit'] if node=='IOS' else ['show user-account fallback','exit'],['level is 15'] if node=='IOS' else ['roles:network-admin'])
 for protocol in ['radius','tacacs']:
  for node in ['IOS','NX']:
   config(node,ios(protocol) if node=='IOS' else nx(protocol))
   probe(node,'remote','RemotePass42!',['show privilege','exit'] if node=='IOS' else ['show user-account remote','configure terminal','interface mgmt0',f'description AAA-{protocol}','end','exit'],['level is 15'] if node=='IOS' else ['roles:network-admin'])
   probe(node,'viewer','Operator42!',['show privilege','exit'] if node=='IOS' else ['show user-account viewer','configure terminal','hostname MUST-NOT-CHANGE','end','exit'],['level is 1'] if node=='IOS' else ['roles:network-operator','Permission denied'])
   probe(node,'remote','wrong',authenticated=False)
   probe(node,'fallback','LocalOnly42!',authenticated=False)
   # A mismatched key is an ERROR, not an authoritative user rejection.
   config(node,['configure terminal',*( [f'{protocol} server {"RADIUS1" if protocol=="radius" else "TACACS1"}','key WrongKey42','exit'] if node=='IOS' else [f'{protocol}-server host 192.168.100.10 key 0 WrongKey42']),'end'])
   probe(node,'fallback','LocalOnly42!',['show privilege','exit'] if node=='IOS' else ['show user-account fallback','exit'],['level is 15'] if node=='IOS' else ['roles:network-admin'])
   config(node,ios(protocol) if node=='IOS' else nx(protocol))
   if node=='IOS' and protocol=='tacacs':probe(node,'noexec','NoExec42!',[],['Authorization failed'],authenticated=False)
 # Native NX-OS uses the local role when the same username exists locally.
 config('NX',['configure terminal','username viewer password LocalDifferent42! role network-admin','end'])
 probe('NX','viewer','Operator42!',['show user-account viewer','configure terminal','interface mgmt0','description AAA-local-role','end','exit'],['roles:network-admin'])
 config('NX',['configure terminal','no username viewer','end'])
 for node,commands in [('IOS',['show aaa servers','show radius statistics','show tacacs','show running-config | section aaa','show logging']),('NX',['show aaa authentication','show aaa accounting','show radius-server','show radius-server statistics 192.168.100.10','show tacacs-server','show tacacs-server statistics 192.168.100.10','show running-config | section aaa','show logging'])]:steps.append({'kind':'survey','node':node,'commands':commands})
 return steps
