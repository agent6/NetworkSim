"""Offline tests for evidence handling. No CML connections or real credentials."""
import hashlib
import json
import re
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch, Mock

from client import CML
from capture import step_result, nxos_boot_image, verify_owned_lab, wait_for_ports, ensure_link_interfaces, PROMPT
from compare import compare, normalize, packet_count, packet_protocols
from capture import load_scenario


class WorkflowTests(unittest.TestCase):
    def test_required_interfaces_are_allocated_before_boot_from_real_definition_slots(self):
        definition={'device':{'interfaces':{'physical':['mgmt0','Ethernet1/1','Ethernet1/2','Ethernet1/3','Ethernet1/4']}}}
        initial=[{'label':'mgmt0'},{'label':'Ethernet1/1'}]
        complete=initial+[{'label':'Ethernet1/4'}]
        client=Mock(request=Mock(side_effect=[initial,None,complete]))
        ensure_link_interfaces(client,'lab','node',definition,{'mgmt0','Ethernet1/4'})
        self.assertEqual(client.request.call_args_list[1].args,('POST','/labs/lab/interfaces',{'node':'node','slot':4}))
        client=Mock(request=Mock(return_value=complete))
        ensure_link_interfaces(client,'lab','node',definition,{'mgmt0','Ethernet1/4'})
        self.assertEqual(client.request.call_count,1)
        with self.assertRaises(ValueError):ensure_link_interfaces(client,'lab','node',definition,{'Ethernet1/99'})
        self.assertEqual(client.request.call_count,1)
        with self.assertRaises(RuntimeError):
            ensure_link_interfaces(Mock(request=Mock(side_effect=[initial,None,initial])),'lab','node',definition,{'Ethernet1/4'})

    def test_nexus_prompt_survives_same_line_boot_syslog_but_never_command_echo(self):
        for raw in ['\rNEXUS# ', '\rNEXUS(config-if)# \x1b[0m',
                    '\rNEXUS# 2026 Oct 22 14:13:33 NEXUS %$ VDC-1 %$ %USER-2-SYSTEM_MSG: ready\r\n']:
            match=re.search(PROMPT,raw)
            self.assertIsNotNone(match,repr(raw))
            self.assertNotIn('SYSTEM_MSG',match[0])
        for raw in ['NEXUS# show version\r\n', 'NEXUS(config)# boot nxos bootflash:nxos.bin\r\n',
                    'not a hostname NEXUS#', 'NEXUS# 2026 release notes']:
            self.assertIsNone(re.search(PROMPT,raw),repr(raw))

    def test_nexus_unprefixed_area_mismatch_is_a_rejection(self):
        step={'id':'remove','node':'nxos','command':'no ip router ospf LAB area 1'}
        self.assertFalse(step_result(step,'Area mismatch\r\nNEXUS(config-if)#')['passed'])
        self.assertTrue(step_result(step,'Already not configured\r\nNEXUS(config-if)#')['passed'])

    def test_operational_packet_evidence_decodes_tagged_protocols(self):
        header = struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)
        def frame(kind, body):
            return bytes(12) + struct.pack('!H', kind) + body
        ip = bytearray(20); ip[0] = 0x45
        ip[9] = 89; ospf = frame(0x0800, ip)
        ip[9] = 1; icmp = frame(0x0800, ip)
        ipv6 = bytearray(40); ipv6[0] = 0x60; ipv6[6] = 58
        frames = [ospf, icmp, frame(0x86dd, ipv6), frame(0x88cc, bytes(10)),
            frame(0x0806, bytes(28)), frame(30, b'\x42\x42\x03' + bytes(30)),
            frame(0x8100, b'\x00\x0a\x00\x28\xaa\xaa\x03\x00\x00\x0c\x20\x00'+bytes(32))]
        data = header + b''.join(struct.pack('<IIII', 0, 0, len(f), len(f)) + f for f in frames)
        result = packet_protocols(data)
        self.assertEqual(result['packets'], 7)
        for name in ['ARP','ICMP','ICMPv6','OSPF','STP','CDP','LLDP']:
            self.assertEqual(result[name], 1, name)

    def test_surveys_never_accept_configuration_or_redirection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'scenario.json'
            base = {'schemaVersion':1,'id':'survey-test','nodes':[{'id':'dut'}],
                    'steps':[{'id':'a','node':'dut','command':'show clock'}]}
            for command in ['configure terminal', 'show clock\nreload', 'show run | redirect flash:x', 'show run | tee flash:x']:
                path.write_text(json.dumps(base | {'surveys':[{'node':'dut','commands':[command]}]}))
                with self.assertRaises(ValueError): load_scenario(path)
            path.write_text(json.dumps(base | {'surveys':[{'node':'dut','commands':['show interfaces']}]}))
            self.assertEqual(load_scenario(path)[0]['surveys'][0]['commands'], ['show interfaces'])

    def test_nexus_prompt_is_not_linecard_readiness(self):
        console=Mock(command=Mock(side_effect=[('Invalid range at marker',False),('Ethernet1/3 is up',False)]));observations=[]
        with patch('capture.time.sleep'):
            wait_for_ports(console,{'cml':{'definition':'nxosv9000'}},{'Ethernet1/3'},observe=observations.append)
        self.assertEqual([v['ready'] for v in observations],[False,True])
        self.assertEqual(console.command.call_args.args[0],'show interface Ethernet1/3')
        with patch('capture.time.monotonic',side_effect=[0,100]):
            with self.assertRaises(TimeoutError):wait_for_ports(Mock(command=Mock(return_value=('NEXUS#',False))),{'cml':{'definition':'nxosv9000'}},{'Ethernet1/3'},timeout=10)

    def test_owned_reuse_rejects_foreign_labs_changed_images_and_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            spec={'schemaVersion':1,'id':'owned-test','nodes':[{'id':'dut','cml':{'definition':'iosv','image':'iosv-1'}}],
                'links':[],'steps':[{'id':'a','node':'dut','command':'show clock'}]}
            (root/'scenario.json').write_text(json.dumps(spec))
            _,digest=load_scenario(root/'scenario.json')
            report={'source':'cml','labId':'owned-id','runId':'owned-marker','scenarioSha256':digest,'nodes':{'dut':'node-id'},'links':[]}
            (root/'capture.json').write_text(json.dumps(report))
            node={'id':'node-id','label':'dut','node_definition':'iosv','image_definition':'iosv-1'}
            def client(title='NetworkSim fidelity owned-marker',node=node,links=None):
                return Mock(request=Mock(side_effect=[{'lab_title':title},[node],links or []]))
            self.assertEqual(verify_owned_lab(client(),spec,root/'capture.json'),report)
            for fake in [client(title='User lab'),client(node=node|{'image_definition':'other'}),client(links=[{'id':'unexpected'}])]:
                with self.assertRaises(ValueError): verify_owned_lab(fake,spec,root/'capture.json')
                self.assertTrue(all(call.args[0]=='GET' for call in fake.request.call_args_list))

    def test_observation_coverage_is_rechecked_and_cannot_forge_availability(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            spec={'schemaVersion':1,'id':'survey-test','nodes':[{'id':'dut'}],'links':[],
                'steps':[{'id':'a','node':'dut','command':'show clock','expect':['UTC']}],
                'surveys':[{'node':'dut','commands':['show processes cpu']}]}
            (root/'scenario.json').write_text(json.dumps(spec));_,digest=load_scenario(root/'scenario.json')
            base={'schemaVersion':1,'scenario':spec['id'],'scenarioSha256':digest,
                'steps':[step_result(spec['steps'][0],'00:00:00 UTC\nDUT#')],
                'observations':[{'node':'dut','command':'show processes cpu','raw':'% Per-device process telemetry is not implemented.','accepted':False,'timedOut':False}]}
            ref=base|{'source':'cml','status':'captured','versions':{'dut':'Synthetic test Version 0.0'},'captures':[],'runningConfigurations':{'dut':'hostname DUT'}}
            sim=base|{'source':'networksim','status':'replayed'}
            def result():
                (root/'capture.json').write_text(json.dumps(ref));(root/'replay.json').write_text(json.dumps(sim))
                return compare(root/'scenario.json',root/'capture.json',root/'replay.json')
            self.assertEqual(result()['status'],'matched')
            sim['observations']=[];self.assertEqual(result()['status'],'blocked')
            sim['observations']=[base['observations'][0]|{'accepted':True}];self.assertEqual(result()['status'],'blocked')
            sim['observations']=[base['observations'][0]|{'timedOut':True}];self.assertEqual(result()['status'],'blocked')
            sim['observations']=base['observations'];ref['runningConfigurations']={};self.assertEqual(result()['status'],'blocked')

    def test_nxos_boot_image_is_observed_not_guessed(self):
        self.assertEqual(nxos_boot_image('NXOS image file is: bootflash:///nxos64-cs.10.6.2.F.bin'), 'bootflash:///nxos64-cs.10.6.2.F.bin')
        truncated = 'NXOS image file is: bootflash:///nxos64-'
        self.assertEqual(nxos_boot_image(truncated, ' 1234 Oct 22 nxos64-cs.10.6.2.F.bin\n'), 'bootflash:nxos64-cs.10.6.2.F.bin')
        for listing in ('', 'nxos-one.bin\nnxos-two.bin', 'nxos-one.bin.backup'):
            with self.assertRaises(RuntimeError):
                nxos_boot_image(truncated, listing)

    def test_curl_keeps_auth_secrets_out_of_process_arguments(self):
        seen = []
        def run(args, **kwargs):
            seen.append((args, kwargs['input']))
            class Result:
                returncode = 0
                stdout = b'"a.b.c"'
            return Result()
        with patch('client.subprocess.run', side_effect=run):
            client = CML('https://192.0.2.10', 'admin', 'controller-secret')
            client.login()
            client.request('GET', '/labs')
        self.assertNotIn('controller-secret', str(seen[0][0]))
        self.assertNotIn('a.b.c', str(seen[1][0]))
        self.assertIn(b'controller-secret', seen[0][1])
        self.assertIn(b'Bearer a.b.c', seen[1][1])
        with self.assertRaises(ValueError):
            CML('https://user:secret@192.0.2.10', 'admin', 'secret')

    def test_expected_refusal_is_a_valid_negative_probe_but_invalid_cli_never_passes(self):
        step = {'id': 'refusal', 'node': 'probe', 'command': 'telnet 192.0.2.1', 'expect': ['refused', 'PROBE#$']}
        self.assertTrue(step_result(step, '% Connection refused by remote host\nPROBE#')['passed'])
        self.assertFalse(step_result(step, '% Invalid input detected\nrefused\nPROBE#')['passed'])
        self.assertFalse(step_result({'id': 'c', 'node': 'dut', 'command': 'show invalid'}, '% Invalid or incomplete show command.')['passed'])
        self.assertFalse(step_result(step, 'refused\nPROBE#', timed_out=True)['passed'])
        self.assertFalse(step_result({'id': 'c', 'node': 'dut', 'command': 'echo'}, '% configuration stored only')['passed'])
        self.assertTrue(step_result({'id': 'c', 'node': 'dut', 'command': 'show feature'}, 'Other NX-OS features are not implemented.')['passed'])

    def test_duplicate_nexus_acl_sequence_is_not_a_successful_configuration(self):
        self.assertFalse(step_result({'id':'a','node':'nxos','command':'10 permit ip any any'},'Duplicate sequence number\nNEXUS(config-acl)#')['passed'])

    def test_terminal_normalization_does_not_erase_meaningful_values(self):
        self.assertEqual(normalize('show x\r\n\x1b[32m  VLAN 10\x1b[0m\r\nDUT#', 'show x'), '  VLAN 10\nDUT#')
        self.assertNotEqual(normalize('10 packets', 'show x'), normalize('11 packets', 'show x'))
        self.assertEqual(normalize('ab\x08c\nDUT#', 'x'), 'ac\nDUT#')

    def test_missing_truncated_and_empty_packet_evidence_is_not_validated(self):
        header = struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)
        self.assertEqual(packet_count(header), 0)
        with self.assertRaises(ValueError):
            packet_count(b'not a capture')
        with self.assertRaises(ValueError):
            packet_count(header + struct.pack('<IIII', 0, 0, 20, 20) + b'abc')

    def test_comparison_rejects_missing_steps_changed_scenarios_and_fabricated_pass_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = {'schemaVersion': 1, 'id': 'synthetic-test', 'nodes': [{'id': 'dut'}], 'links': [],
                    'steps': [{'id': 'a', 'node': 'dut', 'command': 'show hostname', 'expect': ['DUT']}]}
            source = json.dumps(spec).encode()
            (root/'scenario.json').write_bytes(source)
            digest = hashlib.sha256(source).hexdigest()
            base = {'schemaVersion': 1, 'scenario': spec['id'], 'scenarioSha256': digest,
                    'steps': [step_result(spec['steps'][0], 'DUT\nDUT#')]}
            reference = base | {'source': 'cml', 'status': 'captured', 'versions': {'dut': 'Synthetic test Version 0.0'}, 'captures': []}
            simulated = base | {'source': 'networksim', 'status': 'replayed'}
            def result():
                (root/'capture.json').write_text(json.dumps(reference))
                (root/'replay.json').write_text(json.dumps(simulated))
                return compare(root/'scenario.json', root/'capture.json', root/'replay.json')
            self.assertEqual(result()['status'], 'matched')
            simulated['steps'] = []
            self.assertEqual(result()['status'], 'blocked')
            simulated['steps'] = [base['steps'][0] | {'raw': 'WRONG#', 'passed': True}]
            self.assertEqual(result()['status'], 'blocked')
            simulated['steps'] = base['steps']
            simulated['steps'] = [base['steps'][0] | {'node': 'wrong-device'}]
            self.assertEqual(result()['status'], 'blocked')
            simulated['steps'] = base['steps']
            simulated['scenarioSha256'] = 'different'
            self.assertEqual(result()['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()
