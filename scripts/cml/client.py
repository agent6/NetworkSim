"""Small CML REST client using the system curl transport.

Credentials and bearer tokens go over stdin, never command-line arguments.
This also works around macOS denying sockets from Python helpers.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from urllib.parse import urlsplit


class CML:
    def __init__(self, url: str, username: str, password: str, *, insecure=False):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("CML URL must be an HTTPS origin without credentials")
        self.url = url.rstrip("/") + "/api/v0"
        self.username = username
        self._password = password
        self._token = None
        self.insecure = insecure
        self.curl = "/usr/bin/curl" if shutil.which("/usr/bin/curl") else shutil.which("curl")
        if not self.curl:
            raise RuntimeError("curl is required")

    def request(self, method: str, path: str, body=None, *, binary=False):
        if not path.startswith("/") or "\n" in path or "\r" in path:
            raise ValueError("API path must start with /")
        config = ["url = " + json.dumps(self.url + path), "request = " + json.dumps(method),
                  'header = "Accept: application/cap, application/octet-stream"' if binary else 'header = "Accept: application/json"']
        if self._token:
            config.append("header = " + json.dumps("Authorization: Bearer " + self._token))
        if body is not None:
            config += ['header = "Content-Type: application/json"',
                       "data-binary = " + json.dumps(json.dumps(body, ensure_ascii=False), ensure_ascii=False)]
        args = [self.curl, "--silent", "--show-error", "--fail-with-body", "--connect-timeout", "8", "--max-time", "120", "--config", "-"]
        if self.insecure:
            args.append("--insecure")
        result = subprocess.run(args, input=("\n".join(config) + "\n").encode(), capture_output=True, timeout=125)
        if result.returncode:
            # Never echo an authentication response, config, password or bearer token.
            detail = result.stderr.decode(errors="replace").strip()
            for secret in (self._password, self._token):
                if secret:
                    detail = detail.replace(secret, "<redacted>")
            raise RuntimeError(f"CML {method} {path.split('?')[0]} failed: {detail}")
        if binary:
            return result.stdout
        return json.loads(result.stdout) if result.stdout.strip() else None

    def login(self):
        token = self.request("POST", "/authenticate", {"username": self.username, "password": self._password})
        if not isinstance(token, str) or token.count(".") != 2:
            raise RuntimeError("CML did not return a bearer token")
        self._token = token

    def inventory(self):
        return {"system": self.request("GET", "/system_information"),
                "nodes": self.request("GET", "/node_definitions"),
                "images": self.request("GET", "/image_definitions"),
                "labs": self.request("GET", "/labs?with_data=true")}
