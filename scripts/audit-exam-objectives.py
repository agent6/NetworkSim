#!/usr/bin/env python3
"""Map every numbered official objective, without copying the blueprint prose."""
import re,json,hashlib
from pathlib import Path
profiles={
 'ccna-1.1':('CCNA 200-301 v1.1','https://learningcontent.cisco.com/documents/marketing/exam-topics/200-301-CCNA-v1.1.pdf','current through 2027-02-02'),
 'ccna-2.0':('CCNA 200-301 v2.0','https://learningcontent.cisco.com/documents/marketing/exam-topics/200-301_CCNA_v2.0_Exam_Topics_PDF.pdf','published; effective 2027-02-03'),
 'encor-1.2':('ENCOR 350-401 v1.2','https://learningcontent.cisco.com/documents/marketing/exam-topics/350-401-ENCORE-v1.2.pdf','current'),
 'enarsi-1.1':('ENARSI 300-410 v1.1','https://learningcontent.cisco.com/documents/marketing/exam-topics/300-410-ENARSI-v1.1.pdf','current')}
# Original semantic mapping to implementation modules; no exam questions used.
features=[
 ('model-driven',r'netconf|restconf|yang', ['router','switch','l3switch','poeswitch','wlc'],['src/model-driven-management.ts','src/ios-platform-compat.ts'],['tests/model-driven-management.test.ts'],['netconf-yang','restconf','ip http secure-server']),
 ('bgp',r'bgp|route reflector|as.path', ['router','l3switch'],['src/bgp-session.ts','src/control-plane.ts','src/bgp-compat.ts'],['tests/bgp-multiprotocol.test.ts','tests/bgp-session.test.ts','tests/bgp-policy.test.ts'],['router bgp','address-family ipv4 unicast','address-family ipv6 unicast','neighbor','show bgp']),
 ('ospf',r'ospf|lsa|abr|asbr|spf', ['router','l3switch'],['src/ospf-packets.ts','src/control-plane.ts'],['tests/ospf-packets.test.ts','tests/ospf-control-plane.test.ts'],['router ospf','ipv6 router ospf','ip ospf','show ip ospf','show ipv6 ospf']),
 ('eigrp',r'eigrp|dual|successor|stuck in active', ['router','l3switch'],['src/control-plane.ts'],['tests/control-plane.test.ts','tests/routing-compat.test.ts'],['router eigrp','address-family','show ip eigrp']),
 ('dns',r'\bdns\b|cname|\bptr\b', ['pc','laptop','server'],['src/dns-service.ts','src/engine.ts','src/windows-cli.ts'],['tests/dns-service.test.ts','tests/windows-cli.test.ts'],['nslookup','ipconfig /displaydns','ipconfig /flushdns']),
 ('dhcp',r'dhcp', ['router','switch','l3switch','poeswitch','pc','laptop','server'],['src/engine.ts','src/ipv6-services.ts','src/services-ui.ts'],['tests/core.test.ts','tests/ios-service-compat.test.ts','tests/windows-cli.test.ts'],['ip dhcp pool','ip helper-address','ipv6 dhcp','ipconfig /renew']),
 ('file-transfer',r'sftp|scp|tftp|\(t\)ftp|file transfer|software files', ['router','switch','l3switch','poeswitch','wlc','server'],['src/ssh-files.ts','src/management.ts','src/engine.ts'],['tests/ssh-files.test.ts','tests/management.test.ts'],['copy','ip scp server enable']),
 ('snmp',r'snmp', ['router','switch','l3switch','poeswitch','wlc','server'],['src/snmp.ts','src/ios-snmp.ts'],['tests/snmp.test.ts'],['snmp-server','show snmp']),
 ('wireless',r'wireless|\brf\b|\bwlan\b|\bwpa\b|wpa2|ssid|access point', ['ap','wlc','laptop','poeswitch'],['src/wireless.ts','src/wireless-ui.ts','src/wireless-model.ts'],['tests/wireless.test.ts','tests/poe.test.ts'],['wlan','wireless profile policy','wireless tag','show wireless client','netsh wlan']),
 ('switching',r'spanning|pvst|rstp|\bmst\b|802\.1q|trunk|vlan|lacp|etherchannel|port.channel|layer 2', ['switch','l3switch','poeswitch'],['src/engine.ts','src/control-plane.ts'],['tests/wired-fidelity.test.ts','tests/control-plane.test.ts','tests/platform-fidelity.test.ts'],['vlan','switchport','channel-group','spanning-tree','show spanning-tree']),
 ('discovery',r'\bcdp\b|\blldp\b', ['router','switch','l3switch','poeswitch'],['src/discovery.ts'],['tests/discovery.test.ts'],['show cdp neighbors','show lldp neighbors']),
 ('security',r'acl|access.control|snooping|inspection|guard|storm.control|port security|urpf|reverse path|copp|policing', ['router','switch','l3switch','poeswitch'],['src/packet-policy.ts','src/fhs-tracking.ts'],['tests/policy-closure.test.ts','tests/wired-fidelity.test.ts'],['ip access-list','ip access-group','ipv6 traffic-filter','service-policy','ip dhcp snooping']),
 ('aaa',r'aaa|radius|tacacs|authentication|authorization|local user|device access|device security|console|vty', ['router','switch','l3switch','poeswitch','wlc','server'],['src/management.ts','src/aaa-service.ts'],['tests/management.test.ts','tests/snmp.test.ts'],['aaa new-model','aaa authentication','aaa authorization','line','username']),
 ('nat',r'\bnat\b|\bpat\b', ['router'],['src/engine.ts'],['tests/core.test.ts','tests/policy-closure.test.ts'],['ip nat','show ip nat translations']),
 ('qos',r'\bqos\b|queu|shaping|classif|marking', ['router','switch','l3switch','poeswitch'],['src/packet-policy.ts','src/engine.ts'],['tests/qos-parity.test.ts','tests/wired-fidelity.test.ts'],['class-map','policy-map','service-policy','show policy-map']),
 ('tunnels',r'\b(?:dmvpn|nhrp|gre|ipsec|vpn)\b|tunnel', ['router'],['src/engine.ts','src/crypto.ts','src/control-plane.ts'],['tests/control-plane.test.ts','tests/core.test.ts'],['interface Tunnel','tunnel mode','ip nhrp','crypto ipsec']),
 ('redundancy',r'hsrp|vrrp|first.hop|fhrp|redundan', ['router','l3switch'],['src/fhrp-packets.ts','src/control-plane.ts'],['tests/fhrp-packets.test.ts'],['standby','vrrp','show standby','show vrrp']),
 ('management',r'syslog|logging|debug|ntp|ptp|netflow|span|ipsla|ip sla|tracking|eem|event manager', ['router','switch','l3switch','poeswitch','wlc','server'],['src/engine.ts','src/management.ts','src/sla.ts','src/remote-span.ts'],['tests/management.test.ts','tests/remote-span.test.ts','tests/tracking.test.ts'],['show logging','ntp server','logging host','show flow monitor','ip sla']),
 ('windows',r'windows|client connectivity|macos|linux', ['pc','laptop','server'],['src/windows-cli.ts'],['tests/windows-cli.test.ts'],['ipconfig','ping','tracert','netsh interface','netsh wlan']),
 ('physical',r'cable|duplex|collision|signal|pin out|interface issues', ['router','switch','l3switch','poeswitch','pc','server'],['src/engine.ts','src/model.ts','src/ethernet.ts'],['tests/ethernet-physical.test.ts','tests/discovery.test.ts'],['show interfaces','speed','duplex','shutdown']),
 ('routing',r'routing|route|ipv4|ipv6|ip connectivity|address|subnet|prefix|forward|next.hop|administrative|metric|redistribut|filter|tagging', ['router','l3switch','pc','server'],['src/engine.ts','src/control-plane.ts','src/route-resolver.ts'],['tests/route-resolver.test.ts','tests/routing-vrf.test.ts','tests/control-plane.test.ts'],['ip route','ipv6 route','show ip route','show ipv6 route','route print']),
 ('automation-concepts',r'\b(?:python|json|ansible|lisp|vxlan|api)\b|automation|orchestration|artificial|agentic|generative|prompt|controller|sd.wan|sd.access|catalyst center|dna center|hypervisor|virtual machine|container|cloud', [],[],[],[])]
labs={
 'model-driven':('PC → IOS management interface / SVI → routed server; five IOS profiles parametrized','Desktop Network tools → RESTCONF; IOS console and shared interface editor'),
 'bgp':('Two-AS peers and a three-path diamond; IPv4/IPv6 and overlapping VRF-Lite variants','IOS consoles; topology links and packet inspection'),
 'ospf':('Multi-router routed chain / switched broadcast segment / normal, stub and NSSA areas','IOS consoles; topology links and packet inspection'),
 'eigrp':('Router triangle with unequal metrics, feasible alternate and failed successor','IOS consoles and packet inspection'),
 'dns':('PC / wireless laptop → routed DNS server with six typed record families','Server Services → DNS; Desktop DNS lookup; Windows console'),
 'dhcp':('Client → access switch → relay router → remote server; IPv6 PD variant','Server Services → DHCP; host IPv4/IPv6 settings; Windows/IOS consoles'),
 'file-transfer':('Host ↔ routed IOS SSH/SCP node and host file server; ACL/privilege failure variants','Server Services → Management/TFTP; Desktop File transfer; IOS copy'),
 'snmp':('Wired or wireless manager → router / switch SVI; source ACL and logical-v3 variants','Desktop SNMP manager; IOS snmp-server/show snmp'),
 'wireless':('Campus example: router, PoE switch, WLC, two APs, two laptops and service server','WLC five-page form, received AP diagnostics, laptop WLAN and PoE forms'),
 'switching':('Three-switch triangle plus access hosts/trunks; routed LACP/VRF variant','IOS consoles, topology links and port/packet inspection'),
 'discovery':('Router/switch physical link with actual CDP/LLDP and one-way loss','IOS neighbor output and topology/packet inspection'),
 'security':('Two host subnets across policy router/switch; DHCP/ARP/ND guard variants','IOS ACL/policy consoles and packet/drop inspection'),
 'aaa':('Management client → IOS VTY/HTTP endpoint → RADIUS/TACACS server; WLAN Enterprise variant','Server Services → AAA; IOS console; laptop credentials'),
 'nat':('Inside hosts → NAT router → outside server with return traffic and pool exhaustion','IOS console and actual translation/packet views'),
 'qos':('Fast ingress → congested 10-Mbps egress → receiver with mixed datagram sizes/classes','IOS policy-map and physical interface output; packet/drop inspection'),
 'tunnels':('Separate underlay router chain with GRE/IPsec endpoints; mGRE/NHRP hub/spokes','IOS consoles and encapsulated packet inspection'),
 'redundancy':('Two gateway routers on a shared host LAN, routed server and failed active peer','IOS FHRP/track consoles and topology power/link controls'),
 'management':('Managed IOS device → routed services/collector server with failure variants','Server Services, IOS clock/logging/SLA and packet inspection'),
 'windows':('PC/server through routed hops; laptop through campus WLAN','Shared Windows terminal and host/adapter/WLAN forms'),
 'physical':('Two copper endpoints with auto/fixed speed, duplex overlap; routed OSPF/LACP variants','IOS interface/received-CDP diagnostics and link controls'),
 'routing':('Multi-router dual-stack chain/diamond and isolated BLUE/RED VRFs','IOS/Windows route tables, addressing forms and packet inspection'),
 'automation-concepts':('External conceptual/tool exercise; no actual Ansible/Python/Catalyst Center runtime','No implemented external controller/automation product workflow')}
rows=[];summaries=[];parts=['# Versioned exam-objective coverage\n','This is a source-indexed implementation assessment, **not a claim of complete exam or Simlet coverage**. Every numbered parent and child is indexed; child rows inherit the parent competency. Counts distinguish parent/child rows from practical leaf objectives. Text is summarized using original subsystem tags; consult the linked Cisco blueprint for exact wording. No real exam questions were used.\n','All functional areas remain **partial** until their full objective-level command/options, failure and reference comparison requirements are verified. Test pointers identify relevant executable evidence, not proof of every objective detail. Describe/interpret objectives do not impose an unrequested full protocol implementation.\n']
for key,(title,url,effective) in profiles.items():
 file=Path('.cache/fidelity/references')/(key+'.txt');text=file.read_text();matches=list(re.finditer(r'^\s*(\d+\.\d+(?:\.[a-z0-9]+)*)\s{2,}(.+)$',text,re.M));texts={}
 for i,m in enumerate(matches):
  end=matches[i+1].start() if i+1<len(matches) else len(text);content=(m[2]+' '+text[m.end():end]).lower();content=re.sub(r'\d{4} cisco systems.*?page \d+',' ',content);content=re.sub(r'\s+',' ',content);texts[m[1]]=content
 start=len(rows)
 for m in matches:
  id=m[1];ancestors=[id.rsplit('.',n)[0] for n in range(1,id.count('.'))];parent=next((texts[a] for a in ancestors if a in texts),'');own=texts[id];context=parent+' '+own
  first=own.split(' ')[0];verb=first if first in ['describe','explain','compare','interpret','identify','configure','verify','validate','troubleshoot','diagnose','manage','construct','use','select','recognize','determine'] else (parent.split(' ')[0] if parent else '')
  competency='Troubleshoot' if verb in ['troubleshoot','diagnose'] else 'Configure' if verb in ['configure','manage','construct','use'] else 'Verify' if verb in ['verify','validate'] else 'Interpret' if verb in ['interpret','identify','select','recognize','determine'] else 'Describe'
  found=[f for f in features if re.search(f[1],context)];tags=[f[0] for f in found] or ['concept-review'];leaf=not any(other.startswith(id+'.') for other in texts)
  practical=competency in ['Configure','Troubleshoot','Verify'];status=('partial' if any(f[3] for f in found) else 'unsupported' if tags==['automation-concepts'] else 'missing') if practical else 'concept-only'
  notes=[]
  if 'physical'in tags:notes.append('Copper negotiation/traffic-driven duplex errors operate; calibrated cable/fiber/optics diagnosis remains incomplete.')
  if key=='ccna-2.0' and id=='1.6':notes.append('Windows subset only; macOS/Linux OS commands are not implemented.')
  if 'qos'in tags:notes.append('Marking/policing and physical egress LLQ/weighted queues/shaping operate; full hierarchy/WRED/per-flow fair queueing and hardware parity remain incomplete.')
  if 'automation-concepts'in tags:notes.append('No real Catalyst Center/SD-WAN manager/cloud/Ansible/Python runtime; do not infer those products from network-node support.')
  if 'wireless'in tags:notes.append('Logical WPA2/lightweight/Flex models; autonomous AP/WPA3/real RF and cryptography incomplete.')
  unique=lambda values:list(dict.fromkeys(values))
  competencies=[competency];leading=(own if first==verb else parent)[:50]
  if competency=='Configure'and re.search(r'configure (?:and )?verify',leading):competencies.append('Verify')
  row={'exam':title,'id':id,'leaf':leaf,'competency':competency,'competencies':competencies,'practical':practical,'subsystems':tags,'nodes':unique([n for f in found for n in f[2]]),'implementation':unique([n for f in found for n in f[3]]),'testCandidates':unique([n for f in found for n in f[4]]),'commands':unique([n for f in found for n in f[5]]),'gui':unique([labs[tag][1]for tag in tags if tag in labs]),'labTopology':unique([labs[tag][0]for tag in tags if tag in labs]),'validationLevels':[],'status':status,'reference':url,'referenceTextDigest':hashlib.sha256(own.encode()).hexdigest(),'notes':notes};rows.append(row)
 selected=rows[start:];summary={'exam':title,'effective':effective,'source':url,'sourcePDFDigest':hashlib.sha256(file.with_suffix('.pdf').read_bytes()).hexdigest(),'indexedRows':len(selected),'parentObjectives':sum(r['id'].count('.')==1 for r in selected),'leafObjectives':sum(r['leaf'] for r in selected),'practicalLeaves':sum(r['leaf'] and r['practical'] for r in selected),'fullyVerifiedLeaves':0};summaries.append(summary)
 parts+=['\n## '+title+'\n',f'[{effective}]({url}). {summary["indexedRows"]} indexed rows; {summary["leafObjectives"]} leaves; {summary["practicalLeaves"]} practical leaves. **0 fully reference-verified leaves claimed.**\n','| Objective | Competency | Subsystems | Status |\n| --- | --- | --- | --- |\n']
 parts += ['| '+r['id']+' | '+r['competency']+' | '+', '.join(r['subsystems'])+' | '+r['status']+' |\n' for r in selected]
missing=sorted({p for row in rows for p in row['implementation']+row['testCandidates'] if not Path(p).is_file()});assert not missing, 'Invalid source/test pointers: '+str(missing)
result={'schemaVersion':1,'reviewedAt':'2026-10-16','method':'Extract all official objective IDs; classify inherited action verbs and map source semantics to original modules. Full prose not reproduced. Partial is not complete; conceptual rows are not protocol implementation claims.','exams':summaries,'objectives':rows};Path('docs/audits/exam-objective-coverage.json').write_text(json.dumps(result,indent=2)+'\n');Path('docs/audits/exam-objective-coverage.md').write_text(''.join(parts));print(json.dumps(summaries,indent=2))
