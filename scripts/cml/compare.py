#!/usr/bin/env python3
"""Compare captured CML evidence and simulator replay; never promote features."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import re
import struct

from capture import load_scenario, write_json, step_result, REJECTED


def normalize(raw, command):
    value = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", raw.replace("\r\n", "\n").replace("\r", ""))
    # Terminal overstrikes, not arbitrary output or numeric-field removal.
    while re.search(r"[^\n]\x08", value):
        value = re.sub(r"[^\n]\x08", "", value)
    rows = value.strip("\n").splitlines()
    if rows and rows[0].strip() == command:
        rows.pop(0)
    return "\n".join(row.rstrip() for row in rows).strip("\n")


def packet_count(data):
    endian = {b'\xd4\xc3\xb2\xa1': '<', b'\xa1\xb2\xc3\xd4': '>',
              b'\x4d\x3c\xb2\xa1': '<', b'\xa1\xb2\x3c\x4d': '>'}.get(data[:4])
    if endian is None or len(data) < 24:
        raise ValueError("Missing or unsupported PCAP header")
    pos, count = 24, 0
    while pos < len(data):
        if pos + 16 > len(data):
            raise ValueError("Truncated PCAP packet header")
        size = struct.unpack_from(endian + 'I', data, pos + 8)[0]
        pos += 16 + size
        if pos > len(data):
            raise ValueError("Truncated PCAP packet")
        count += 1
    return count


def management_packets(data):
    """Count real Ethernet/IPv4 TCP management handshakes in a classic PCAP."""
    count = packet_count(data)
    endian = '<' if data[:4] in (b'\xd4\xc3\xb2\xa1', b'\x4d\x3c\xb2\xa1') else '>'
    if struct.unpack_from(endian + 'I', data, 20)[0] != 1:
        raise ValueError('Expected Ethernet packet capture')
    pos = 24
    summary = {'packets': count, 'sshSyn': 0, 'telnetSyn': 0, 'synAck': 0, 'reset': 0}
    while pos < len(data):
        size = struct.unpack_from(endian + 'I', data, pos + 8)[0]
        frame = data[pos + 16:pos + 16 + size]
        pos += 16 + size
        if len(frame) < 14:
            continue
        offset, ether_type = 14, struct.unpack_from('!H', frame, 12)[0]
        while ether_type in (0x8100, 0x88a8) and len(frame) >= offset + 4:
            ether_type = struct.unpack_from('!H', frame, offset + 2)[0]
            offset += 4
        if ether_type != 0x0800 or len(frame) < offset + 20 or frame[offset] >> 4 != 4 or frame[offset + 9] != 6:
            continue
        ihl = (frame[offset] & 15) * 4
        if ihl < 20 or len(frame) < offset + ihl + 20 or struct.unpack_from('!H', frame, offset + 6)[0] & 0x1fff:
            continue
        tcp = offset + ihl
        source, destination = struct.unpack_from('!HH', frame, tcp)
        flags = frame[tcp + 13]
        if destination in (22, 23) and flags & 2 and not flags & 16:
            summary['sshSyn' if destination == 22 else 'telnetSyn'] += 1
        if source in (22, 23):
            summary['synAck'] += int(flags & 0x12 == 0x12)
            summary['reset'] += int(bool(flags & 4))
    return summary


def packet_protocols(data):
    """Evidence for the operational scenario; these are observed wire protocols."""
    count = packet_count(data)
    endian = '<' if data[:4] in (b'\xd4\xc3\xb2\xa1', b'\x4d\x3c\xb2\xa1') else '>'
    if struct.unpack_from(endian + 'I', data, 20)[0] != 1:
        raise ValueError('Expected Ethernet packet capture')
    summary = dict.fromkeys(['ARP', 'ICMP', 'ICMPv6', 'OSPF', 'STP', 'CDP', 'LLDP'], 0)
    summary['packets'] = count
    pos = 24
    while pos < len(data):
        size = struct.unpack_from(endian + 'I', data, pos + 8)[0]
        frame = data[pos + 16:pos + 16 + size]
        pos += 16 + size
        if len(frame) < 14:
            continue
        offset, kind = 14, struct.unpack_from('!H', frame, 12)[0]
        while kind in (0x8100, 0x88a8) and len(frame) >= offset + 4:
            kind = struct.unpack_from('!H', frame, offset + 2)[0]
            offset += 4
        if kind <= 1500 and len(frame) >= offset + 3:
            llc = frame[offset:offset + 8]
            summary['STP'] += int(llc[:3] == b'\x42\x42\x03' or llc == b'\xaa\xaa\x03\x00\x00\x0c\x01\x0b')
            summary['CDP'] += int(llc == b'\xaa\xaa\x03\x00\x00\x0c\x20\x00')
        elif kind == 0x88cc:
            summary['LLDP'] += 1
        elif kind == 0x0806:
            summary['ARP'] += 1
        elif kind == 0x0800 and len(frame) >= offset + 20:
            protocol = frame[offset + 9]
            summary['ICMP'] += int(protocol == 1)
            summary['OSPF'] += int(protocol == 89)
        elif kind == 0x86dd and len(frame) >= offset + 40:
            summary['ICMPv6'] += int(frame[offset + 6] == 58)
    return summary


def compare(scenario_path, capture_path, replay_path):
    scenario, digest = load_scenario(scenario_path)
    reference, replay = json.loads(capture_path.read_text()), json.loads(replay_path.read_text())
    problems, differences = [], []
    for name, report, source, status in [('CML', reference, 'cml', 'captured'), ('NetworkSim', replay, 'networksim', 'replayed')]:
        if report.get('source') != source or report.get('status') != status:
            problems.append(name + ' run is incomplete or failed')
        if report.get('scenarioSha256') != digest or report.get('scenario') != scenario['id']:
            problems.append(name + ' scenario does not match')
        expected = [s['id'] for s in scenario['steps']]
        if [s['id'] for s in report.get('steps', [])] != expected or not all(s.get('passed') for s in report.get('steps', [])):
            problems.append(name + ' has missing, reordered or failed steps')
        for specification, recorded in zip(scenario['steps'], report.get('steps', [])):
            if any(recorded.get(field) != specification[field] for field in ('node', 'command')):
                problems.append(name + ' command/node provenance does not match ' + specification['id'])
            if not step_result(specification, recorded.get('raw', ''), timed_out=recorded.get('timedOut', False))['passed']:
                problems.append(name + ' raw evidence fails ' + specification['id'])
    if not reference.get('versions') or set(reference['versions']) != {n['id'] for n in scenario['nodes']}:
        problems.append('Real node version evidence is missing')
    elif any(not re.search(r'\bVersion\s+\d|\bNXOS:\s+version\s+\d', raw) for raw in reference['versions'].values()):
        problems.append('A node has no software version output')
    if reference.get('cleanupErrors'):
        problems.append('Capture or lab cleanup failed')
    captures = reference.get('captures', [])
    if len(captures) != len(scenario['links']):
        problems.append('Packet capture is missing for one or more links')
    if captures and (len({item.get('linkId') for item in captures}) != len(captures) or {item.get('linkId') for item in captures} != set(reference.get('links', []))):
        problems.append('Packet capture link identities do not match the owned topology')
    if scenario.get('surveys') and set(reference.get('runningConfigurations', {})) != {n['id'] for n in scenario['nodes']}:
        problems.append('Operational running configuration evidence is missing')
    packet_summaries = []
    for item in captures:
        path = capture_path.parent / item['file']
        try:
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != item['sha256'] or packet_count(data) == 0:
                problems.append('Empty or altered packet evidence: ' + item['file'])
            operational = scenario.get('packetEvidence', {}).get('kind') == 'operational'
            summary = packet_protocols(data) if operational else management_packets(data)
            packet_summaries.append({'file': item['file'], **summary})
            if not operational and (summary['sshSyn'] + summary['telnetSyn'] == 0 or summary['synAck'] == 0):
                problems.append('No successful TCP management handshake captured: ' + item['file'])
        except (OSError, ValueError) as error:
            problems.append('Invalid packet evidence: ' + str(error))
    for protocol, minimum in scenario.get('packetEvidence', {}).get('minimum', {}).items():
        if sum(item.get(protocol, 0) for item in packet_summaries) < minimum:
            problems.append('Insufficient captured ' + protocol + ' protocol evidence')
    real_steps = {s['id']: s for s in reference.get('steps', [])}
    sim_steps = {s['id']: s for s in replay.get('steps', [])}
    for step in scenario['steps']:
        if step['id'] not in real_steps or step['id'] not in sim_steps:
            continue
        real, sim = real_steps[step['id']], sim_steps[step['id']]
        a, b = normalize(real['raw'], step['command']), normalize(sim['raw'], step['command'])
        if a != b:
            differences.append({'id': step['id'], 'diff': '\n'.join(difflib.unified_diff(a.splitlines(), b.splitlines(), fromfile='CML', tofile='NetworkSim', lineterm=''))})
    expected_observations = [(survey['node'], command) for survey in scenario.get('surveys', []) for command in survey['commands']]
    availability = []
    for name, report in [('CML', reference), ('NetworkSim', replay)]:
        observations = report.get('observations', [])
        if [(o.get('node'), o.get('command')) for o in observations] != expected_observations:
            problems.append(name + ' has missing or reordered command observations')
        for observation in observations:
            actual = not observation.get('timedOut') and not bool(re.search(REJECTED, observation.get('raw', '')))
            if observation.get('timedOut') or observation.get('accepted') != actual:
                problems.append(name + ' has incomplete or inconsistent observation evidence')
    for real, sim in zip(reference.get('observations', []), replay.get('observations', [])):
        availability.append({'node': real['node'], 'command': real['command'], 'cmlAccepted': real['accepted'], 'simulatorAccepted': sim['accepted']})
        a, b = normalize(real['raw'], real['command']), normalize(sim['raw'], sim['command'])
        if a != b:
            differences.append({'id': 'observe/' + real['node'] + '/' + real['command'], 'diff': '\n'.join(difflib.unified_diff(a.splitlines(), b.splitlines(), fromfile='CML', tofile='NetworkSim', lineterm=''))})
    return {'schemaVersion': 1, 'scenario': scenario['id'], 'scenarioSha256': digest,
            'status': 'blocked' if problems else 'output-review-required' if differences else 'matched',
            'problems': problems, 'packetEvidence': packet_summaries, 'outputDifferences': differences, 'commandAvailability': availability,
            'scope': 'Only this scenario and the captured image versions. This does not certify a protocol or implement commands.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ['scenario', 'capture', 'replay', 'out']:
        parser.add_argument('--' + argument, type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.scenario, args.capture, args.replay)
    write_json(args.out, result)
    print(result['status'] + ': ' + str(len(result['outputDifferences'])) + ' output differences')
    raise SystemExit(0 if result['status'] == 'matched' else 1)
