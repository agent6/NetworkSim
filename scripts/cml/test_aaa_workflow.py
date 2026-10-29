import json,struct,unittest
from aaa_workflow import evaluate_probe,probe_result,verify_owner
from aaa_evidence import aaa_packets,complete_aaa_evidence
class AAAWorkflowTests(unittest.TestCase):
 def test_probe_requires_authentication_and_complete_data(self):
  spec={'authenticated':True,'commands':['show privilege'],'expect':['level is 15']}
  good={'authenticated':True,'commands':[{'command':'show privilege','raw':'Current privilege level is 15','timedOut':False}]}
  self.assertTrue(evaluate_probe(spec,good));self.assertFalse(evaluate_probe(spec,{**good,'authenticated':False}));self.assertFalse(evaluate_probe(spec,{**good,'commands':[]}));self.assertFalse(evaluate_probe(spec,{**good,'commands':[{'command':'show privilege','raw':'level is 15','timedOut':True}]}))
 def test_a_zero_ssh_exit_does_not_prove_a_shell_or_expected_output(self):
  self.assertFalse(evaluate_probe({'authenticated':True,'commands':['show privilege'],'expect':['level is 15']},{'authenticated':False,'commands':[],'exitCode':0}))
 def test_probe_json_must_be_an_actual_output_line(self):
  value={'host':'192.0.2.1','authenticated':False,'commands':[]};self.assertEqual(probe_result('echo ignored\n'+json.dumps(value)),value)
  with self.assertRaises(ValueError):probe_result('echo '+json.dumps(value))
 def test_foreign_owned_title_fails_before_any_mutation(self):
  class API:
   def request(self,method,path):
    self.asserted=method=='GET';return {'lab_title':'My user lab'}
  api=API()
  with self.assertRaises(ValueError):verify_owner(api,{'labId':'id','runId':'abc','nodes':{},'links':[]})
  self.assertTrue(api.asserted)
 def test_empty_and_truncated_pcaps_do_not_certify_aaa(self):
  header=b'\xd4\xc3\xb2\xa1'+struct.pack('<HHIIII',2,4,0,0,65535,1)
  self.assertFalse(complete_aaa_evidence(aaa_packets(header)))
  with self.assertRaises(ValueError):aaa_packets(header+b'broken')
 def test_every_protocol_and_reply_is_required(self):
  self.assertFalse(complete_aaa_evidence({'radiusAccept':100,'tacacsAuthenticateRequest':100}))
if __name__=='__main__':unittest.main()
