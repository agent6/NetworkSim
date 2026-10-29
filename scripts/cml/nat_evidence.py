"""Require token-correlated NAT request and reply packets on both reference wires."""
import ipaddress,json,struct
from pathlib import Path
from compare import packet_count

def packets(data):
 packet_count(data) # Validates every record boundary, including empty/truncated files.
 endian='<' if data[:4] in (b'\xd4\xc3\xb2\xa1',b'\x4d\x3c\xb2\xa1') else '>'
 if struct.unpack_from(endian+'I',data,20)[0]!=1:raise ValueError('Expected Ethernet PCAP')
 rows=[];pos=24
 while pos<len(data):
  size=struct.unpack_from(endian+'I',data,pos+8)[0];frame=data[pos+16:pos+16+size];pos+=16+size
  if len(frame)<14:continue
  offset,kind=14,struct.unpack_from('!H',frame,12)[0]
  while kind in (0x8100,0x88a8) and len(frame)>=offset+4:kind=struct.unpack_from('!H',frame,offset+2)[0];offset+=4
  if kind!=0x0800 or len(frame)<offset+20:continue
  ip=frame[offset:];ihl=(ip[0]&15)*4;length=struct.unpack_from('!H',ip,2)[0]
  if ip[0]>>4!=4 or ihl<20 or len(ip)<length or length<ihl or struct.unpack_from('!H',ip,6)[0]&0x3fff:continue
  payload=ip[ihl:length];protocol={1:'icmp',6:'tcp',17:'udp'}.get(ip[9])
  row={'protocol':protocol,'source':str(ipaddress.ip_address(ip[12:16])),'destination':str(ipaddress.ip_address(ip[16:20]))}
  if protocol=='icmp' and len(payload)>=8:row.update(type=payload[0],identifier=struct.unpack_from('!H',payload,4)[0],sequence=struct.unpack_from('!H',payload,6)[0],payload=payload[8:])
  elif protocol in ('tcp','udp') and len(payload)>=(20 if protocol=='tcp' else 8):
   header=(payload[12]>>4)*4 if protocol=='tcp' else 8
   if header<(20 if protocol=='tcp' else 8) or header>len(payload):continue
   row.update(sourcePort=struct.unpack_from('!H',payload)[0],destinationPort=struct.unpack_from('!H',payload,2)[0],payload=payload[header:])
  else:continue
  rows.append(row)
 return rows

def transport_evidence(spec,result,inside,outside):
 """A success flag or receiver text is insufficient without all four actual tuples."""
 token=spec['token'].encode();protocol=spec['protocol'];observed=result.get('observed',{});incoming=spec['node'].startswith('O');port=spec.get('port',9000 if protocol=='udp' else 9001)
 original={'source':spec['source'],'sourcePort':spec['sourcePort'],'destination':spec['destination'],'destinationPort':port}
 translated={key:observed.get(key) for key in original}
 def has(rows,tuple,reply=False):
  if reply:tuple={'source':tuple['destination'],'sourcePort':tuple['destinationPort'],'destination':tuple['source'],'destinationPort':tuple['sourcePort']}
  return any(p['protocol']==protocol and token in p['payload'] and all(p.get(k)==v for k,v in tuple.items()) for p in rows)
 before,after=(outside,inside) if incoming else (inside,outside)
 return {'requestBefore':has(before,original),'requestAfter':has(after,translated),'replyBefore':has(after,translated,True),'replyAfter':has(before,original,True)}

def evidence(report,plan,root):
 root=Path(root);wires={c['linkId']:packets((root/c['file']).read_bytes()) for c in report['captures']};links=report['links'];pairs={'IOS':(wires[links[0]],wires[links[1]]),'NX':(wires[links[2]],wires[links[3]])};cases=[]
 specs={s['id']:s for s in plan['steps']};probes=[(specs[r['id']],r.get('result'), 'IOS') for r in report['steps'] if r['kind']=='probe']
 probes += [(r['spec'],r['result'],'NX') for r in report.get('nxProbes',[])]
 probes += [(r['spec'],r['result'],'NX') for mode in report.get('nxModes',{}).values() for r in mode['probes']]
 for spec,result,platform in probes:
  if not result or not result.get('success'):continue
  if spec['protocol']=='icmp':continue
  checks=transport_evidence(spec,result,*pairs[platform]);cases.append({'token':spec['token'],'platform':platform,**checks,'passed':all(checks.values())})
 # Echo identifier, sequence and payload must survive both request/reply wires.
 icmp=[]
 for platform,(inside,outside) in pairs.items():
  for incoming in [False,True]:
   before,after=(outside,inside) if incoming else (inside,outside)
   requests=[p for p in before if p['protocol']=='icmp' and p['type']==8];matched=0
   for p in requests:
    translated=[q for q in after if q['protocol']=='icmp' and q['type']==8 and q['payload']==p['payload'] and q['sequence']==p['sequence']]
    if any(any(r['protocol']=='icmp' and r['type']==0 and r['source']==q['destination'] and r['destination']==q['source'] and r['identifier']==q['identifier'] and r['payload']==q['payload'] for r in after) and any(r['protocol']=='icmp' and r['type']==0 and r['source']==p['destination'] and r['destination']==p['source'] and r['identifier']==p['identifier'] and r['payload']==p['payload'] for r in before) for q in translated):matched+=1
   expected=sum(1 for spec,result,key in probes if key==platform and spec['protocol']=='icmp' and result and result.get('success'))
   icmp.append({'platform':platform,'wireOrder':'outside-inside' if incoming else 'inside-outside','completeEchoes':matched,'expectedSuccessfulEchoes':expected,'passed':expected>0 and matched>=expected})
 return {'transport':cases,'icmp':icmp,'passed':bool(cases) and all(r['passed'] for r in cases+icmp)}

if __name__=='__main__':
 import sys
 root=Path(sys.argv[1]);result=evidence(json.loads((root/'capture.json').read_text()),json.loads((root/'scenario.json').read_text()),root);(root/'wire-evidence.json').write_text(json.dumps(result,indent=2)+'\n');print('NAT wire evidence:',result['passed'],len(result['transport']),'transport probes');sys.exit(0 if result['passed'] else 1)
