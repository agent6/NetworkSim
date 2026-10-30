import test from "node:test";
import assert from "node:assert/strict";
import { Simulator } from "../src/engine.ts";
import { handleHTTPRequest, basicAuthorization } from "../src/http-service.ts";
import { IOSSession } from "../src/cli.ts";

function server() {
  const sim = new Simulator();
  const device = sim.addDevice("server", 0, 0);
  device.config.services.http = { enabled: true, content: "<h1>Lab page</h1>" };
  return { sim, device };
}
test("HTTP local and enable authentication challenge wrong credentials without disclosing content", () => {
  const { device } = server();
  device.config.services.http.authentication = "local";
  device.config.features.users = {
    student: { secret: "päss:word", privilege: 1 },
  };
  const request = (authorization?: string) =>
    handleHTTPRequest(device, { path: "/", headers: { authorization } });
  assert.equal(request().statusCode, 401);
  assert.match(request().headers["WWW-Authenticate"], /^Basic realm=/);
  assert.doesNotMatch(
    request(basicAuthorization("student", "wrong")).content,
    /Lab page/,
  );
  assert.equal(request("Basic !!!").statusCode, 401);
  assert.equal(
    request(basicAuthorization("student", "päss:word")).statusCode,
    200,
  );
  device.config.services.http.authentication = "enable";
  assert.equal(
    request(basicAuthorization("student", "undefined")).statusCode,
    401,
  );
  device.config.features.enableSecret = "router-lab";
  assert.equal(
    request(basicAuthorization("student", "router-lab")).statusCode,
    200,
  );
});
test("HTTP flash base paths, MIME, HEAD and UTF-8 lengths are independent of host filesystem", () => {
  const { device } = server();
  device.config.services.http.basePath = "flash:/www";
  device.config.features.files = {
    "www/index.html": "<h1>λ lab</h1>",
    "www/site.css": "body{color:teal}",
    "private.txt": "not public",
  };
  const home = handleHTTPRequest(device, { path: "/" });
  assert.equal(home.content, "<h1>λ lab</h1>");
  const head = handleHTTPRequest(device, { path: "/", method: "HEAD" });
  assert.equal(head.content, "");
  assert.equal(
    Number(head.headers["Content-Length"]),
    new TextEncoder().encode(home.content).byteLength,
  );
  assert.match(
    handleHTTPRequest(device, { path: "/site.css?v=2" }).headers[
      "Content-Type"
    ],
    /^text\/css/,
  );
  assert.equal(
    handleHTTPRequest(device, { path: "/private.txt" }).statusCode,
    404,
  );
  assert.equal(
    handleHTTPRequest(device, { path: "/%2e%2e/private.txt" }).statusCode,
    403,
  );
  assert.equal(
    handleHTTPRequest(device, { path: "/%garbled" }).statusCode,
    400,
  );
  assert.equal(
    handleHTTPRequest(device, { path: "/", method: "POST" }).statusCode,
    405,
  );
});
test("HTTP AAA distinguishes rejection from unavailable authentication and uses its method list", () => {
  const { device } = server();
  device.config.services.http.authentication = "aaa";
  device.config.services.http.authenticationList = "WEB";
  const payload = {
    path: "/",
    headers: { Authorization: basicAuthorization("learner", "lab-password") },
  };
  assert.equal(handleHTTPRequest(device, payload).statusCode, 503);
  assert.equal(
    handleHTTPRequest(device, payload, () => ({ accepted: false })).statusCode,
    401,
  );
  assert.equal(
    handleHTTPRequest(device, payload, (list, user, password) => {
      assert.deepEqual(
        [list, user, password],
        ["WEB", "learner", "lab-password"],
      );
      return { accepted: true };
    }).statusCode,
    200,
  );
});
test("HTTP authentication requests and protected content traverse real TCP links", () => {
  const { sim, device } = server();
  const pc = sim.addDevice("pc", 100, 0);
  const port = Object.values(device.config.interfaces)[0],
    client = Object.values(pc.config.interfaces)[0];
  port.ip = "192.0.2.1";
  port.mask = "255.255.255.0";
  port.adminUp = true;
  client.ip = "192.0.2.2";
  client.mask = "255.255.255.0";
  client.adminUp = true;
  const wire = sim.connect(
    { deviceId: pc.id, port: client.name },
    { deviceId: device.id, port: port.name },
  );
  device.config.services.http.authentication = "local";
  device.config.features.users = { learner: { password: "practice" } };
  sim.changed();
  const rejected = sim.httpRequest(pc.id, "http://192.0.2.1/");
  sim.advance(15000);
  assert.equal(rejected.statusCode, 401);
  const accepted = sim.httpRequest(pc.id, "http://192.0.2.1/", {
    headers: { Authorization: basicAuthorization("learner", "practice") },
  });
  sim.advance(15000);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body, "<h1>Lab page</h1>");
  assert.ok(sim.events.some((event) => event.protocol === "TCP"));
  assert.doesNotMatch(JSON.stringify(sim.events), /practice|Basic bGVh/);
  sim.disconnect(wire.id);
  const failed = sim.httpRequest(pc.id, "http://192.0.2.1/", {
    headers: { Authorization: basicAuthorization("learner", "practice") },
  });
  sim.advance(15000);
  assert.equal(failed.status, "failure");
});
test("unresolved neighbors complete HTTP and DNS-backed browser failures instead of leaving the wrapper running", () => {
  for (const host of ["192.0.2.20", "web.lab"]) {
    const {sim, device} = server(), pc = sim.addDevice("pc"), sw = sim.addDevice("switch");
    for (const [node, ip] of [[pc, "192.0.2.10"], [device, "192.0.2.20"]] as const) {
      Object.assign(node.config.interfaces.GigabitEthernet0, {ip, mask: "255.255.255.0", adminUp: true});
      node.config.interfaces.GigabitEthernet0.features.dhcp = false;
    }
    pc.config.dnsServers = ["192.0.2.20"];
    device.config.services.dns = {enabled: true, records: {"web.lab": "192.0.2.20"}};
    for (const [node, port] of [[pc, "GigabitEthernet0/1"], [device, "GigabitEthernet0/2"]] as const) {
      sw.config.interfaces[port].features.portfast = true;
      sim.connect({deviceId: node.id, port: "GigabitEthernet0"}, {deviceId: sw.id, port});
    }
    sim.advance(1000);
    sim.power(device.id, false);
    const failed = sim.httpRequest(pc.id, `http://${host}/`);
    sim.advance(12000);
    assert.equal(failed.status, "failure", host);
    assert.match(failed.error ?? "", /unreachable/i);
    const settled = structuredClone(failed);
    sim.advance(12000);
    assert.deepEqual(failed, settled, "a later timeout must not overwrite the completed failure");
    sim.power(device.id, true);
    sim.advance(1000);
    const recovered = sim.httpRequest(pc.id, `http://${host}/`);
    sim.advance(12000);
    assert.equal(recovered.statusCode, 200);
  }
});
test("HTTP authentication and flash path CLI settings survive rendered startup config", () => {
  const sim = new Simulator(),
    router = sim.addDevice("router", 0, 0),
    cli = new IOSSession(sim, router.id);
  for (const line of [
    "enable",
    "configure terminal",
    "ip http server",
    "ip http authentication aaa login-authentication WEB",
    "ip http path flash:/www",
    "end",
  ]) {
    assert.equal(
      cli.execute(line).some((text) => text.startsWith("%")),
      false,
      line,
    );
  }
  const config = cli.execute("show running-config").join("\n");
  assert.match(config, /ip http authentication aaa login-authentication WEB/);
  assert.match(config, /ip http path flash:\/www/);
});
