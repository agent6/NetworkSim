import test from "node:test";
import assert from "node:assert/strict";
import { Simulator } from "../src/engine.ts";
import type { Device } from "../src/model.ts";
const g = (n: number) => `GigabitEthernet0/${n}`,
  host = "GigabitEthernet0";
function address(d: Device, port: string, ip: string) {
  Object.assign(d.config.interfaces[port], {
    ip,
    mask: "255.255.255.0",
    adminUp: true,
  });
}
function link(s: Simulator, a: Device, p: string, b: Device, q: string) {
  return s.connect({ deviceId: a.id, port: p }, { deviceId: b.id, port: q });
}
function erspan() {
  const sim = new Simulator(821),
    source = sim.addDevice("router"),
    transit = sim.addDevice("router"),
    collector = sim.addDevice("router"),
    pc = sim.addDevice("pc"),
    monitor = sim.addDevice("pc");
  address(pc, host, "192.0.2.2");
  address(source, g(0), "192.0.2.1");
  address(source, g(1), "10.0.12.1");
  address(transit, g(0), "10.0.12.2");
  address(transit, g(1), "10.0.23.1");
  address(collector, g(0), "10.0.23.2");
  collector.config.interfaces[g(1)].adminUp = true;
  link(sim, pc, host, source, g(0));
  link(sim, source, g(1), transit, g(0));
  const wire = link(sim, transit, g(1), collector, g(0));
  link(sim, collector, g(1), monitor, host);
  source.config.staticRoutes.push({
    network: "10.0.23.0",
    prefix: 24,
    nextHop: "10.0.12.2",
    ad: 1,
  });
  source.config.features.spanSessions = {
    1: {
      type: "erspan-source",
      sources: [{ interface: g(0), direction: "rx" }],
      erspanId: 42,
      ipAddress: "10.0.23.2",
      originIp: "10.0.12.1",
    },
  };
  collector.config.features.spanSessions = {
    7: {
      type: "erspan-destination",
      sources: [],
      erspanId: 42,
      ipAddress: "10.0.23.2",
      destination: g(1),
    },
  };
  sim.changed();
  sim.advance(100);
  return { sim, source, transit, collector, pc, monitor, wire };
}
test("ERSPAN copies use routed GRE, reach the matching collector and preserve original traffic", () => {
  const { sim, collector, pc, monitor, wire } = erspan();
  const ping = sim.ping(pc.id, "192.0.2.1", { count: 1 });
  sim.advance(1000);
  assert.equal(ping.received, 1);
  assert.ok(collector.runtime.features.spanStats["7"].received >= 1);
  assert.ok(
    monitor.runtime.features.capturedFrames.some(
      (frame: any) => frame.protocol === "ICMP",
    ),
  );
  assert.ok(
    sim.events.some(
      (event) =>
        event.protocol === "GRE" &&
        event.label === "Frame received" &&
        event.nodeId === collector.id &&
        event.packet?.ttl === 63,
    ),
  );
  const received = collector.runtime.features.spanStats["7"].received;
  wire.loss = 1;
  sim.changed();
  const localPing = sim.ping(pc.id, "192.0.2.1", { count: 1 });
  sim.advance(1000);
  assert.equal(localPing.received, 1);
  assert.equal(collector.runtime.features.spanStats["7"].received, received);
});
test("ERSPAN rejects an unmatched session and stops capture when the source is shut", () => {
  const { sim, source, collector, pc, monitor } = erspan();
  collector.config.features.spanSessions[7].erspanId = 88;
  sim.changed();
  sim.ping(pc.id, "192.0.2.1", { count: 1 });
  sim.advance(1000);
  assert.ok(collector.runtime.features.remoteSpanUnmatched > 0);
  assert.equal(monitor.runtime.features.capturedFrames, undefined);
  const sent = source.runtime.features.spanStats[1].frames;
  source.config.features.spanSessions[1].shutdown = true;
  sim.changed();
  sim.ping(pc.id, "192.0.2.1", { count: 1 });
  sim.advance(1000);
  assert.equal(source.runtime.features.spanStats[1].frames, sent);
});
test("RSPAN traverses the remote VLAN and stops at a trunk that prunes it", () => {
  const sim = new Simulator(822),
    left = sim.addDevice("switch"),
    transit = sim.addDevice("switch"),
    right = sim.addDevice("switch");
  const a = sim.addDevice("pc"),
    b = sim.addDevice("pc"),
    monitor = sim.addDevice("pc");
  address(a, host, "192.0.2.2");
  address(b, host, "192.0.2.3");
  for (const sw of [left, transit, right]) {
    sw.config.vlans[99] = { id: 99, name: "REMOTE-CAPTURE", active: true };
    sw.config.features.rspanVlans = [99];
  }
  for (const [sw, port] of [
    [left, g(3)],
    [transit, g(1)],
    [transit, g(2)],
    [right, g(1)],
  ] as Array<[Device, string]>) {
    Object.assign(sw.config.interfaces[port], {
      mode: "trunk",
      allowedVlans: [1, 99],
    });
  }
  left.config.interfaces[g(1)].features.portfast = true;
  left.config.interfaces[g(2)].features.portfast = true;
  link(sim, a, host, left, g(1));
  link(sim, b, host, left, g(2));
  link(sim, left, g(3), transit, g(1));
  link(sim, transit, g(2), right, g(1));
  link(sim, right, g(2), monitor, host);
  left.config.features.spanSessions = {
    1: {
      type: "rspan-source",
      sources: [{ interface: g(1), direction: "rx" }],
      remoteVlan: 99,
    },
  };
  right.config.features.spanSessions = {
    2: {
      type: "rspan-destination",
      sources: [],
      sourceVlan: 99,
      destination: g(2),
    },
  };
  sim.changed();
  sim.advance(4000);
  const first = sim.ping(a.id, "192.0.2.3", { count: 1 });
  sim.advance(1000);
  assert.equal(first.received, 1);
  assert.ok(
    monitor.runtime.features.capturedFrames.some(
      (frame: any) => frame.protocol === "ICMP",
    ),
  );
  assert.ok(
    sim.events.some(
      (event) =>
        event.nodeId === transit.id &&
        event.label === "Frame received" &&
        event.packet?.vlan === 99,
    ),
  );
  const count = right.runtime.features.spanStats[2].received;
  transit.config.interfaces[g(2)].allowedVlans = [1];
  sim.changed();
  const second = sim.ping(a.id, "192.0.2.3", { count: 1 });
  sim.advance(1000);
  assert.equal(second.received, 1);
  assert.equal(right.runtime.features.spanStats[2].received, count);
  transit.config.interfaces[g(2)].allowedVlans = [1, 99];
  transit.config.features.rspanVlans = [];
  sim.changed();
  // Restoring a trunk VLAN restarts its spanning-tree transition.
  sim.advance(4000);
  sim.ping(a.id, "192.0.2.3", { count: 1 });
  sim.advance(1000);
  assert.equal(right.runtime.features.spanStats[2].received, count);
  assert.ok(sim.events.some(event => event.nodeId === transit.id && event.label === "RSPAN VLAN rejected"));
});
