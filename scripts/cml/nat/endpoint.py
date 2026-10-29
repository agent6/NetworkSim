#!/usr/bin/env python3
"""Real socket endpoints for isolated NAT probes; no mocked router responses."""
import argparse,json,socket,threading,time,subprocess
from pathlib import Path

def main():
 p=argparse.ArgumentParser();s=p.add_subparsers(dest='operation',required=True)
 serve=s.add_parser('serve');serve.add_argument('addresses',nargs='+');serve.add_argument('--log',required=True);serve.add_argument('--udp-only',action='store_true');serve.add_argument('--udp-port',type=int,default=9000)
 probe=s.add_parser('probe');probe.add_argument('protocol',choices=['udp','tcp','icmp']);probe.add_argument('source');probe.add_argument('destination');probe.add_argument('--source-port',type=int,default=44000);probe.add_argument('--port',type=int);probe.add_argument('--token',default='probe');probe.add_argument('--timeout',type=float,default=3)
 a=p.parse_args()
 if a.operation=='serve':
  lock=threading.Lock()
  def echo(address,protocol):
   port=a.udp_port if protocol=='udp' else 9001;sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM if protocol=='udp' else socket.SOCK_STREAM);sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);sock.bind((address,port))
   if protocol=='tcp':sock.listen(20)
   print(json.dumps({'ready':True,'protocol':protocol,'address':address,'port':port}),flush=True)
   while True:
    connection=None
    if protocol=='udp':data,peer=sock.recvfrom(4096)
    else:connection,peer=sock.accept();connection.settimeout(3);data=connection.recv(4096)
    row={'protocol':protocol,'source':peer[0],'sourcePort':peer[1],'destination':address,'destinationPort':port,'token':data.decode(errors='replace')}
    with lock:
     with open(a.log,'a') as f:f.write(json.dumps(row)+'\n')
    response=json.dumps(row).encode()
    if connection:connection.sendall(response);connection.close()
    else:sock.sendto(response,peer)
  for ip in a.addresses:
   for protocol in (['udp'] if a.udp_only else ['udp','tcp']):threading.Thread(target=echo,args=(ip,protocol),daemon=True).start()
  while True:time.sleep(30)
 else:
  result={'protocol':a.protocol,'source':a.source,'destination':a.destination,'token':a.token,'success':False}
  try:
   if a.protocol=='icmp':
    r=subprocess.run(['ping','-n','-c','1','-W',str(int(a.timeout)),'-I',a.source,a.destination],capture_output=True,text=True,timeout=a.timeout+3);result.update(success=r.returncode==0,raw=r.stdout+r.stderr)
   else:
    sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM if a.protocol=='udp' else socket.SOCK_STREAM);sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);sock.settimeout(a.timeout);sock.bind((a.source,a.source_port));port=a.port or (9000 if a.protocol=='udp' else 9001)
    if a.protocol=='udp':sock.sendto(a.token.encode(),(a.destination,port));data,peer=sock.recvfrom(4096)
    else:sock.connect((a.destination,port));sock.sendall(a.token.encode());data=sock.recv(4096);peer=sock.getpeername()
    row=json.loads(data);result.update(success=row.get('token')==a.token and peer==(a.destination,port),observed=row,replySource=peer[0],replySourcePort=peer[1]);sock.close()
  except (OSError,ValueError,subprocess.TimeoutExpired) as error:result['error']=str(error)
  print(json.dumps(result))
if __name__=='__main__':main()
