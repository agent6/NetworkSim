#!/usr/bin/env python3
"""Capture versioned Cisco CLI and packet evidence in a new, isolated CML lab."""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
import uuid

from client import CML

CSI = r"\x1b\[[0-?]*[ -/]*[@-~]"
PROMPT = r"(?m)(?:^|[\r\n])(?:" + CSI + r"|[ \t\r])*[A-Za-z0-9_.-]+(?:\([^\r\n]*\))?[>#](?:" + CSI + r"|[ \t\r])*$"
AUTH_PROMPT = r"(?im)(?:^|[\r\n])(?:" + CSI + r"|[ \t\r])*(?:[A-Za-z0-9_.-]+ )?(?:username|login|password):(?:" + CSI + r"|[ \t\r])*$"
REJECTED = r"(?im)^\s*(?:%?\s*(?:Invalid\b|Incomplete\b|Ambiguous\b|Unsupported\b|Unrecognized command|Configuration update aborted|Error:|Please define )|%[^\r\n]*(?:not implemented|configuration stored only|operational behavior is not simulated))"


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def expand(text, variables):
    for key, value in variables.items():
        text = text.replace("${" + key + "}", value)
    if "${" in text:
        raise ValueError("Unresolved scenario variable")
    return text


def step_result(step, raw, *, timed_out=False):
    checks = []
    for pattern in step.get("expect", []):
        checks.append({"pattern": pattern, "passed": bool(re.search(pattern, raw, re.M))})
    for pattern in step.get("absent", []):
        checks.append({"absent": pattern, "passed": not bool(re.search(pattern, raw, re.M))})
    rejected = bool(re.search(REJECTED, raw))
    return {"id": step["id"], "node": step["node"], "command": step["command"],
            "raw": raw, "checks": checks, "timedOut": timed_out,
            "passed": not timed_out and not rejected and all(c["passed"] for c in checks)}


def nxos_boot_image(version, directory=''):
    image = re.search(r'NXOS image file is:\s*(bootflash:[A-Za-z0-9_./-]+\.bin)(?=\s|$)', version)
    if image:
        return image[1]
    # Some fresh CML VMs truncate this field to "bootflash:///nxos64-".
    # A single actual NX-OS .bin file on bootflash is an unambiguous fallback.
    candidates = set(re.findall(r'(?<![A-Za-z0-9_.-])(nxos[A-Za-z0-9_.-]+\.bin)(?![A-Za-z0-9_.-])', directory))
    if len(candidates) != 1:
        raise RuntimeError('Cannot identify one real NX-OS boot image from version or bootflash')
    return 'bootflash:' + next(iter(candidates))


def load_scenario(path):
    content = path.read_bytes()
    value = json.loads(content)
    if value.get("schemaVersion") != 1 or not value.get("nodes") or not value.get("steps"):
        raise ValueError("Expected schemaVersion 1 with nodes and steps")
    nodes = {n["id"] for n in value["nodes"]}
    if len(nodes) != len(value["nodes"]):
        raise ValueError("Duplicate node id")
    ids = set()
    for step in value["steps"]:
        if step["id"] in ids or step["node"] not in nodes or "\n" in step["command"]:
            raise ValueError("Invalid step id, node or multiline command")
        ids.add(step["id"])
        for pattern in step.get("expect", []) + step.get("absent", []):
            re.compile(pattern)
        if not 0 <= step.get('waitSeconds', 0) <= 300:
            raise ValueError('A convergence wait must be between zero and 300 seconds')
    for survey in value.get('surveys', []):
        if survey['node'] not in nodes or any(not re.match(r'^show\s+[^\r\n]+$', c) or re.search(r'\|\s*(redirect|append|tee)\b', c) for c in survey['commands']):
            raise ValueError('Surveys accept read-only show commands on known nodes only')
    return value, hashlib.sha256(content).hexdigest()


class Console:
    def __init__(self, host, username, password, lab_id, node_id, known_hosts, transcript_path):
        import pexpect
        self.pexpect = pexpect
        self.child = pexpect.spawn("/usr/bin/ssh", ["-tt", "-o", "ConnectTimeout=8",
            "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + str(known_hosts),
            username + "@" + host, "open /" + lab_id + "/" + node_id + "/0"],
            encoding="utf-8", codec_errors="replace", echo=False, timeout=60,
            dimensions=(200, 132))
        self.child.expect(r"(?i)password:\s*$")
        self.child.sendline(password)
        self.child.expect(r"Connected to (?:CML )?terminalserver\.")
        self.log = transcript_path.open('a')
        self.child.logfile_read = self.log
        self.child.send("\r")

    def ready(self, *, username="admin", password="NetSimLab42!", timeout=90):
        transcript = ""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            match = self.child.expect([PROMPT, AUTH_PROMPT,
                r"initial configuration dialog\?\s*\[yes/no\]:", self.pexpect.TIMEOUT, self.pexpect.EOF,
                r'Are you sure you want to continue connecting[^\r\n]*\?'], timeout=10)
            transcript += self.child.before + (self.child.after if isinstance(self.child.after, str) else "")
            if match == 0:
                visible = re.sub(CSI, '', str(self.child.after)).strip()
                if '(config' in visible:
                    self.child.send('end\r')
                    continue
                if visible.endswith(">"):
                    self.child.send("enable\r")
                    continue
                return transcript
            if match == 1:
                self.child.send((password if "password" in self.child.after.lower() else username) + "\r")
            elif match == 2:
                self.child.send("no\r")
            elif match == 3:
                self.child.send("\r")
            elif match == 5:
                self.child.send('no\r')
            else:
                raise RuntimeError("Console disconnected before reaching EXEC")
        raise RuntimeError("Console did not reach privileged EXEC: " + repr(transcript[-1500:]))

    def command(self, command, timeout=45, *, sensitive=False):
        self.child.send(command + "\r")
        echo = ''
        if not sensitive:
            try:
                # Fence responses to this command's echo. A buffered prompt or
                # asynchronous syslog must not mark a new command as completed.
                self.child.expect_exact(command, timeout=timeout)
                echo = command
            except (self.pexpect.TIMEOUT, self.pexpect.EOF):
                return self.child.before, True
        match = self.child.expect([PROMPT, AUTH_PROMPT, self.pexpect.TIMEOUT, self.pexpect.EOF], timeout=timeout)
        raw = echo + self.child.before + (self.child.after if isinstance(self.child.after, str) else "")
        return raw, match >= 2

    def close(self):
        self.child.close(force=True)
        self.log.close()


def verify_owned_lab(client, scenario, previous_path):
    previous = json.loads(previous_path.read_text())
    previous_scenario, previous_digest = load_scenario(previous_path.parent/'scenario.json')
    hardware = lambda spec: [(n['id'], n['cml']) for n in spec['nodes']]
    if previous.get('source') != 'cml' or previous.get('scenarioSha256') != previous_digest or hardware(previous_scenario) != hardware(scenario) or previous_scenario['links'] != scenario['links']:
        raise ValueError('Owned lab topology/images do not match this scenario')
    details = client.request('GET', f"/labs/{previous['labId']}")
    if not previous.get('runId') or details.get('lab_title') != 'NetworkSim fidelity ' + previous['runId']:
        raise ValueError('Refusing to reuse a lab without its exact ownership marker')
    actual = client.request('GET', f"/labs/{previous['labId']}/nodes?data=true&exclude_configurations=true")
    if {n['label']: n['id'] for n in actual} != previous.get('nodes'):
        raise ValueError('Owned lab nodes have changed')
    expected = {n['id']:n['cml'] for n in scenario['nodes']}
    if any(n.get('node_definition') != expected[n['label']]['definition'] or n.get('image_definition') != expected[n['label']]['image'] for n in actual):
        raise ValueError('Owned lab image definitions have changed')
    links = client.request('GET', f"/labs/{previous['labId']}/links?data=true")
    if {link['id'] for link in links} != set(previous.get('links', [])) or len(links) != len(scenario['links']):
        raise ValueError('Owned lab links have changed')
    # Link UUIDs are immutable in CML. Creation provenance and exact retained UUIDs
    # ensure a warm observation never starts or stops an unrelated lab.
    return previous


def capture(client, scenario_path, output, username, password, known_hosts, *, boot_timeout=720, resume=False, keep_failed=False, reuse_owned_from=None):
    scenario, digest = load_scenario(scenario_path)
    import pexpect  # Fail before creating a lab if developer dependencies are missing.
    if not known_hosts.is_file():
        raise ValueError('The SSH known-hosts file is missing; verify the controller host key before capture')
    if not resume:
        output.mkdir(parents=True, exist_ok=False)
    os.chmod(output, 0o700)
    (output / 'scenario.json').write_bytes(scenario_path.read_bytes())
    run_id = uuid.uuid4().hex[:10]
    report = {"schemaVersion": 1, "source": "cml", "scenario": scenario["id"], "scenarioSha256": digest,
              "startedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "starting", "steps": [], "captures": []}
    lab_id = None
    if reuse_owned_from:
        if resume or any(not re.match(r'^(show|ping|traceroute)\s+[^\r\n]+$', step['command']) or re.search(r'\|\s*(redirect|append|tee)\b', step['command']) for step in scenario['steps']):
            raise ValueError('Reusing an owned lab is restricted to read-only observation and traffic probes')
        previous = verify_owned_lab(client, scenario, reuse_owned_from)
        lab_id = previous['labId']
        report.update({'labId':lab_id,'runId':previous['runId'],'nodes':previous['nodes'],'links':previous['links'],
            'baseline':'warm-owned-lab','reusedFromSha256':hashlib.sha256(reuse_owned_from.read_bytes()).hexdigest()})
    if resume:
        previous = json.loads((output / "capture.json").read_text())
        if previous.get("source") != "cml" or previous.get("scenarioSha256") != digest or previous.get("steps"):
            raise ValueError("Only an owned run interrupted before its first test step can be resumed")
        verify_owned_lab(client, scenario, output/'capture.json')
        report = previous
        report.pop("error", None)
        report.pop("cleanupErrors", None)
        report["status"] = "booting"
        lab_id = previous["labId"]
    consoles = {}
    started_captures = []
    def save():
        # Only the CML controller password/token are confidential; fixture passwords are synthetic.
        raw = json.dumps(report)
        for secret in (password, client._token):
            if secret:
                raw = raw.replace(secret, "<redacted>")
        write_json(output / "capture.json", json.loads(raw))
    try:
        inventory = client.inventory()
        report["system"] = inventory["system"]
        selected = {}
        definitions = {x["id"]: x for x in inventory["nodes"]}
        images = {x["id"]: x for x in inventory["images"]}
        for node in scenario["nodes"]:
            definition, image = node["cml"]["definition"], node["cml"]["image"]
            if definition not in definitions or images.get(image, {}).get("node_definition_id") != definition:
                raise ValueError(f"Image/definition unavailable: {node['id']}: {image}")
            selected[node["id"]] = {"definition": definition, "image": image, "label": images[image]["label"]}
        report["images"] = selected
        if not resume and not reuse_owned_from:
            created = client.request("POST", "/labs", {"title": "NetworkSim fidelity " + run_id,
                "description": "Dedicated isolated CLI/packet conformance lab. Created by scripts/cml/capture.py. No external links."})
            lab_id = created["id"]
            report["labId"] = lab_id
            report["runId"] = run_id
            report["nodes"] = {}
            save()
        for i, node in enumerate([] if resume or reuse_owned_from else scenario["nodes"]):
            variables = node.get("variables", {}) | {"port": node["cml"]["port"]}
            config = expand("\n".join(node["startup"]), variables)
            response = client.request("POST", f"/labs/{lab_id}/nodes?populate_interfaces=true", {
                "node_definition": node["cml"]["definition"], "image_definition": node["cml"]["image"],
                "label": node["id"], "x": i * 200, "y": 0, "configuration": config})
            report["nodes"][node["id"]] = response["id"]
            save()
        links = report.get("links", []) if resume or reuse_owned_from else []
        for link in ([] if resume or reuse_owned_from else scenario["links"]):
            endpoints = []
            for endpoint in link:
                node_id = report["nodes"][endpoint["node"]]
                interfaces = client.request("GET", f"/labs/{lab_id}/nodes/{node_id}/interfaces?data=true")
                interface = next(x for x in interfaces if x["label"] == endpoint["port"])
                endpoints.append(interface["id"])
            links.append(client.request("POST", f"/labs/{lab_id}/links", {"src_int": endpoints[0], "dst_int": endpoints[1]})["id"])
        report["links"] = links
        report["status"] = "booting"
        report["labStopped"] = False
        save()
        client.request("PUT", f"/labs/{lab_id}/start")
        print("Lab started:", lab_id, flush=True)
        deadline = time.monotonic() + boot_timeout
        while time.monotonic() < deadline:
            nodes = client.request("GET", f"/labs/{lab_id}/nodes?data=true&exclude_configurations=true")
            report["bootStates"] = {n["label"]: {"state": n["state"], "boot": n.get("boot_progress")} for n in nodes}
            save()
            if all(n["state"] == "BOOTED" for n in nodes):
                break
            time.sleep(5)
        else:
            raise TimeoutError("CML nodes did not finish booting; see bootStates")
        for node in scenario["nodes"]:
            console = Console(urlsplit(client.url).hostname, username, password, lab_id, report["nodes"][node["id"]], known_hosts, output / (node['id'] + '-console.txt'))
            consoles[node["id"]] = console
            report.setdefault("bootConsoles", {})[node["id"]] = console.ready(timeout=boot_timeout)
            for command in ["terminal length 0", "terminal width 132"]:
                raw, timeout = console.command(command)
                if timeout or re.search(REJECTED, raw):
                    raise RuntimeError(f"Terminal setup rejected on {node['id']}")
            raw, timeout = console.command("show version")
            if timeout or re.search(REJECTED, raw) or not re.search(r'\bVersion\s+\d|\bNXOS:\s+version\s+\d', raw):
                raise RuntimeError("Missing real show version evidence")
            report.setdefault("versions", {})[node["id"]] = raw
            if scenario.get('surveys'):
                configuration, timed_out = console.command('show running-config', 120)
                if timed_out or re.search(REJECTED, configuration):
                    raise RuntimeError('Cannot record the actual lab configuration')
                report.setdefault('runningConfigurations', {})[node['id']] = configuration
            if node['cml']['definition'].startswith('nxos') and not reuse_owned_from:
                # CML Nexus reference disks require a persistent boot variable after
                # their first boot. Learn the filename from this actual image;
                # do not guess or add a simulated boot-image configuration command.
                preparation = []
                try:
                    image = nxos_boot_image(raw)
                except RuntimeError:
                    directory, timed_out = console.command('dir bootflash:', 90)
                    preparation.append({'command': 'dir bootflash:', 'raw': directory})
                    if timed_out or re.search(REJECTED, directory):
                        raise RuntimeError('Cannot read NX-OS bootflash')
                    image = nxos_boot_image(raw, directory)
                for command in ['configure terminal', 'boot nxos ' + image, 'end']:
                    response, timed_out = console.command(command, 90)
                    preparation.append({'command': command, 'raw': response})
                    if timed_out or re.search(REJECTED, response):
                        raise RuntimeError('NX-OS boot-image preparation failed')
                save_deadline = time.monotonic() + 180
                while True:
                    response, timed_out = console.command('copy running-config startup-config', 90)
                    preparation.append({'command': 'copy running-config startup-config', 'raw': response})
                    if not timed_out and re.search(r'Copy complete|\[OK\]', response, re.I):
                        break
                    if time.monotonic() >= save_deadline or 'system not ready' not in response:
                        raise RuntimeError('NX-OS did not confirm saving its boot configuration')
                    time.sleep(5)
                report.setdefault('hardwarePreparation', {})[node['id']] = preparation
            save()
        for link_id in links:
            client.request("PUT", f"/labs/{lab_id}/links/{link_id}/capture/start", {"maxtime": 1800, "maxpackets": 100000})
            started_captures.append(link_id)
        report["status"] = "capturing"
        save()
        for step in scenario["steps"]:
            print("Step:", step["id"], flush=True)
            time.sleep(step.get('waitSeconds', 0))
            raw, timed_out = consoles[step["node"]].command(step["command"], step.get("timeout", 45), sensitive=step.get('sensitive', False))
            result = step_result(step, raw, timed_out=timed_out)
            report["steps"].append(result)
            save()
            if not result["passed"]:
                raise RuntimeError("Step failed: " + step["id"])
        for survey in scenario.get('surveys', []):
            for command in survey['commands']:
                print('Observe:', survey['node'], command, flush=True)
                raw, timed_out = consoles[survey['node']].command(command, 90)
                report.setdefault('observations', []).append({'node': survey['node'], 'command': command, 'raw': raw,
                    'timedOut': timed_out, 'accepted': not timed_out and not bool(re.search(REJECTED, raw))})
                save()
                if timed_out:
                    raise RuntimeError('Observation timed out; incomplete command coverage')
        report["status"] = "captured"
    except (Exception, KeyboardInterrupt) as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        for link_id in started_captures:
            try:
                status = client.request("GET", f"/labs/{lab_id}/links/{link_id}/capture/status")
                client.request("PUT", f"/labs/{lab_id}/links/{link_id}/capture/stop")
                packet_data = client.request("GET", f"/pcap/{link_id}", binary=True)
                name = link_id + ".pcap"
                (output / name).write_bytes(packet_data)
                report["captures"].append({"linkId": link_id, "file": name, "bytes": len(packet_data),
                    "sha256": hashlib.sha256(packet_data).hexdigest(), "status": status})
            except Exception as error:
                report.setdefault("cleanupErrors", []).append("Capture: " + str(error))
        for console in consoles.values():
            console.close()
        if lab_id and not (keep_failed and report['status'] == 'failed'):
            try:
                client.request("PUT", f"/labs/{lab_id}/stop")
                for _ in range(20):
                    if client.request("GET", f"/labs/{lab_id}")["state"] in ("STOPPED", "DEFINED"):
                        report["labStopped"] = True
                        break
                    time.sleep(2)
                else:
                    raise TimeoutError('Owned lab has not confirmed shutdown')
            except Exception as error:
                report.setdefault("cleanupErrors", []).append("Stop lab: " + str(error))
        report["finishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
        save()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--user", default="admin")
    parser.add_argument("--insecure", action="store_true", help="Allow the lab controller's self-signed HTTPS certificate")
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--scenario", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--known-hosts", type=Path, default=Path.home() / ".ssh/known_hosts")
    parser.add_argument("--resume", action="store_true", help="Resume an owned lab interrupted before its first test step")
    parser.add_argument('--reuse-owned-from', type=Path, help='Collect read-only operational evidence from a previously owned lab; records its actual running configurations')
    parser.add_argument("--keep-running-on-failure", action="store_true", help="Leave this owned lab running for diagnosis if a check fails")
    args = parser.parse_args()
    password = os.environ.get("CML_PASSWORD") or getpass.getpass("CML password: ")
    client = CML(args.url, args.user, password, insecure=args.insecure)
    client.login()
    if args.inventory:
        args.out.mkdir(parents=True, exist_ok=False)
        write_json(args.out / "inventory.json", client.inventory())
    else:
        if not args.scenario:
            parser.error("--scenario or --inventory is required")
        capture(client, args.scenario, args.out, args.user, password, args.known_hosts, resume=args.resume, keep_failed=args.keep_running_on_failure, reuse_owned_from=args.reuse_owned_from)


if __name__ == "__main__":
    main()
