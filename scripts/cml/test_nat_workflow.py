import struct,unittest
from nat_workflow import probe_result,probe_pass,verify_owner
from nat_evidence import packets,transport_evidence

class NATWorkflowTests(unittest.TestCase):
 def test_receiver_source_is_required_for_translation_success(self):
  spec={'success':True,'protocol':'udp','observedSource':'203.0.113.10'}
  self.assertFalse(probe_pass(spec,{'success':True}));self.assertFalse(probe_pass(spec,{'success':True,'observed':{'source':'192.168.10.10'}}));self.assertTrue(probe_pass(spec,{'success':True,'observed':{'source':'203.0.113.10'}}))
 def test_pool_pat_accepts_any_configured_pool_address_but_never_an_untranslated_source(self):
  spec={'success':True,'protocol':'udp','observedRange':['198.51.100.10','198.51.100.11']}
  for ip in spec['observedRange']:self.assertTrue(probe_pass(spec,{'success':True,'observed':{'source':ip}}))
  self.assertFalse(probe_pass(spec,{'success':True,'observed':{'source':'192.168.20.10'}}))
 def test_probe_parser_does_not_accept_echoed_shell_source_as_evidence(self):
  with self.assertRaises(ValueError):probe_result('echo '+str({'protocol':'udp'}))
  self.assertEqual(probe_result('ignored\n{"protocol":"udp","success":false}')['success'],False)
 def test_unowned_lab_title_prevents_reuse(self):
  class API:
   def request(self,method,path):
    if method!='GET':raise AssertionError('Mutation before ownership check')
    return {'lab_title':'User lab'}
  with self.assertRaises(ValueError):verify_owner(API(),{'labId':'id','runId':'test'})
 def test_empty_or_one_sided_capture_cannot_certify_a_translation(self):
  header=b'\xd4\xc3\xb2\xa1'+struct.pack('<HHIIII',2,4,0,0,65535,1)
  self.assertEqual(packets(header),[])
  with self.assertRaises(ValueError):packets(header+b'bad')
  spec={'token':'unique-token','protocol':'udp','node':'I1','source':'192.168.10.10','sourcePort':44000,'destination':'203.0.113.100'}
  result={'observed':{'source':'203.0.113.1','sourcePort':4790,'destination':'203.0.113.100','destinationPort':9000}}
  outgoing={'protocol':'udp','source':'192.168.10.10','sourcePort':44000,'destination':'203.0.113.100','destinationPort':9000,'payload':b'unique-token'}
  self.assertFalse(all(transport_evidence(spec,result,[outgoing],[]).values()))
 def test_return_wire_tuple_and_token_must_match_the_forward_translation(self):
  spec={'token':'unique-token','protocol':'tcp','node':'I1','source':'192.168.10.10','sourcePort':44000,'destination':'203.0.113.100'}
  original={'source':'192.168.10.10','sourcePort':44000,'destination':'203.0.113.100','destinationPort':9001};mapped={**original,'source':'203.0.113.1','sourcePort':4790}
  def packet(t,reply=False):return {'protocol':'tcp','payload':b'unique-token',**({'source':t['destination'],'destination':t['source'],'sourcePort':t['destinationPort'],'destinationPort':t['sourcePort']} if reply else t)}
  inside=[packet(original),packet(original,True)];outside=[packet(mapped),packet(mapped,True)]
  self.assertTrue(all(transport_evidence(spec,{'observed':mapped},inside,outside).values()));outside[-1]['destinationPort']=4791;self.assertFalse(all(transport_evidence(spec,{'observed':mapped},inside,outside).values()))
if __name__=='__main__':unittest.main()
