"""Bounded wire evidence for AAA. TACACS payloads stay encrypted; never infer a grant from TCP alone."""
import struct
from compare import packet_count

def aaa_packets(data):
 count=packet_count(data);endian='<' if data[:4] in (b'\xd4\xc3\xb2\xa1',b'\x4d\x3c\xb2\xa1') else '>'
 if struct.unpack_from(endian+'I',data,20)[0]!=1:raise ValueError('Expected Ethernet PCAP')
 result={key:0 for key in ['radiusRequest','radiusAccept','radiusReject','radiusAccountingRequest','radiusAccountingResponse','tacacsAuthenticateRequest','tacacsAuthenticateReply','tacacsAuthorizeRequest','tacacsAuthorizeReply','tacacsAccountingRequest','tacacsAccountingReply']};result['packets']=count
 streams=[];active={};pos=24
 while pos<len(data):
  size=struct.unpack_from(endian+'I',data,pos+8)[0];frame=data[pos+16:pos+16+size];pos+=16+size
  if len(frame)<14:continue
  offset,kind=14,struct.unpack_from('!H',frame,12)[0]
  while kind in (0x8100,0x88a8) and len(frame)>=offset+4:kind=struct.unpack_from('!H',frame,offset+2)[0];offset+=4
  if kind!=0x0800 or len(frame)<offset+20 or frame[offset]>>4!=4:continue
  ihl=(frame[offset]&15)*4;length=struct.unpack_from('!H',frame,offset+2)[0]
  if ihl<20 or length<ihl or struct.unpack_from('!H',frame,offset+6)[0]&0x3fff:continue
  ip=frame[offset:offset+length];payload=ip[ihl:];protocol=ip[9]
  if protocol==17 and len(payload)>=28:
   src,dst,udp_len=struct.unpack_from('!HHH',payload);radius=payload[8:udp_len]
   if src not in (1812,1813) and dst not in (1812,1813):continue
   if len(radius)<20 or struct.unpack_from('!H',radius,2)[0]!=len(radius):continue
   key={1:'radiusRequest',2:'radiusAccept',3:'radiusReject',4:'radiusAccountingRequest',5:'radiusAccountingResponse'}.get(radius[0])
   if key:result[key]+=1
  if protocol==6 and len(payload)>=20:
   src,dst,sequence=struct.unpack_from('!HHI',payload);header=(payload[12]>>4)*4
   if 49 not in (src,dst) or header<20:continue
   flow=(ip[12:16],ip[16:20],src,dst);flags=payload[13]
   if flags&2 and (flow not in active or active[flow][0]!=sequence):
    segments={};active[flow]=(sequence,segments);streams.append((flow,segments))
   if len(payload)<=header:continue
   if flow not in active:raise ValueError('TACACS payload without captured connection establishment')
   active[flow][1][sequence]=payload[header:]
 for flow,segments in streams:
  # Every captured stream starts with SYN before the first request. Deduplicate TCP retransmissions.
  raw=b'';end=None
  for sequence,chunk in sorted(segments.items()):
   if end is not None and sequence>end:raise ValueError('Incomplete TACACS TCP stream')
   skip=max(0,(end or sequence)-sequence);raw+=chunk[skip:];end=max(end or sequence,sequence+len(chunk))
  offset=0
  while offset<len(raw):
   if len(raw)-offset<12:raise ValueError('Truncated TACACS header')
   version,kind,seq,flags,session,length=struct.unpack_from('!BBBBII',raw,offset)
   if version>>4!=12 or kind not in (1,2,3) or length>1024*1024 or offset+12+length>len(raw):raise ValueError('Invalid/truncated TACACS record')
   request=flow[3]==49
   if request!=(seq%2==1):raise ValueError('TACACS sequence/direction mismatch')
   result[{1:'tacacsAuthenticate',2:'tacacsAuthorize',3:'tacacsAccounting'}[kind]+('Request' if request else 'Reply')]+=1;offset+=12+length
 return result

def complete_aaa_evidence(summary):
 return all(summary.get(key,0)>0 for key in ['radiusRequest','radiusAccept','radiusReject','radiusAccountingRequest','radiusAccountingResponse','tacacsAuthenticateRequest','tacacsAuthenticateReply','tacacsAuthorizeRequest','tacacsAuthorizeReply','tacacsAccountingRequest','tacacsAccountingReply'])
