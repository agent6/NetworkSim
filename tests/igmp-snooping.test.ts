import test from "node:test";
import assert from "node:assert/strict";
import { Simulator } from "../src/engine.ts";
import { snoopingEgress } from "../src/igmp-snooping.ts";
import type { Device } from "../src/model.ts";

const group = "239.10.10.10",
  hostPort = "GigabitEthernet0",
  switchPort = (n: number) => `GigabitEthernet0/${n}`;
function fixture() {
  const sim = new Simulator(711),
    sw = sim.addDevice("switch"),
    hosts = Array.from({ length: 4 }, () => sim.addDevice("pc"));
  hosts.forEach((host, i) => {
    Object.assign(host.config.interfaces[hostPort], {
      ip: `10.0.0.${i + 1}`,
      mask: "255.255.255.0",
      adminUp: true,
    });
    sw.config.interfaces[switchPort(i + 1)].features.portfast = true;
    sim.connect(
      { deviceId: host.id, port: hostPort },
      { deviceId: sw.id, port: switchPort(i + 1) },
    );
  });
  sim.changed();
  sim.advance(3000);
  return {
    sim,
    sw,
    source: hosts[0],
    receiver: hosts[1],
    other: hosts[2],
    router: hosts[3],
  };
}
function report(
  sim: Simulator,
  host: Device,
  operation = "report",
  source?: string,
) {
  sim.sendControlDatagram(
    host.id,
    host.config.interfaces[hostPort].ip!,
    "224.0.0.22",
    0,
    { protocol: "igmp", operation, group, source },
    { interface: hostPort, ttl: 1, protocol: "igmp" },
  );
  sim.advance(20);
}
function reaches(sim: Simulator, device: Device): boolean {
  return sim.events.some(
    (event) =>
      event.nodeId === device.id &&
      event.label === "Frame received" &&
      event.packet?.destination === group,
  );
}
test("IGMP snooping learns delivered reports and filters multicast to physical receiver and router ports", () => {
  const { sim, sw, source, receiver, other, router } = fixture();
  receiver.config.interfaces[hostPort].features.igmpGroups = [{ group }];
  report(sim, receiver);
  sim.sendControlDatagram(
    router.id,
    "10.0.0.4",
    "224.0.0.1",
    0,
    { protocol: "igmp", operation: "query", group: "0.0.0.0", maxResponse: 1 },
    { interface: hostPort, ttl: 1, protocol: "igmp" },
  );
  sim.advance(50);
  sim.events = [];
  sim.sendMulticast(source.id, group, {
    interface: hostPort,
    payload: "first",
  });
  sim.advance(100);
  assert.equal(reaches(sim, receiver), true);
  assert.equal(reaches(sim, router), true);
  assert.equal(reaches(sim, other), false);
  assert.deepEqual([...snoopingEgress(sim, sw, 1, group, "10.0.0.1")!].sort(), [
    switchPort(2),
    switchPort(4),
  ]);
  sw.config.features.igmpSnooping = { enabled: false };
  sim.changed();
  sim.events = [];
  sim.sendMulticast(source.id, group, { interface: hostPort });
  sim.advance(100);
  assert.equal(reaches(sim, other), true);
});
test("snooping memberships are VLAN/source scoped, age out and accept configured immediate leave", () => {
  const { sim, sw, receiver } = fixture();
  sw.config.features.igmpSnooping = {
    membershipInterval: 2,
    vlans: { 1: { immediateLeave: true } },
  };
  sim.changed();
  report(sim, receiver, "report", "10.0.0.1");
  assert.deepEqual(
    [...snoopingEgress(sim, sw, 1, group, "10.0.0.1")!],
    [switchPort(2)],
  );
  assert.equal(snoopingEgress(sim, sw, 1, group, "10.0.0.9")!.size, 0);
  assert.equal(snoopingEgress(sim, sw, 20, group, "10.0.0.1"), undefined);
  assert.equal(snoopingEgress(sim, sw, 1, "224.0.0.5", "10.0.0.1"), undefined);
  report(sim, receiver, "leave", "10.0.0.1");
  assert.equal(sw.runtime.features.igmpSnooping.groups.length, 0);
  report(sim, receiver);
  sim.advance(3000);
  assert.equal(sw.runtime.features.igmpSnooping.groups.length, 0);
});
test("a snooping querier sends real IGMP queries and hosts answer before periodic report time", () => {
  const { sim, sw, receiver } = fixture();
  receiver.config.interfaces[hostPort].features.igmpGroups = [{ group }];
  sw.config.features.igmpSnooping = {
    querier: true,
    querierAddress: "10.0.0.254",
    queryInterval: 2,
    maxResponse: 1,
    membershipInterval: 4,
  };
  sim.changed();
  sim.advance(8000);
  assert.ok(receiver.runtime.features.igmpQueriesReceived >= 3);
  assert.ok(
    sw.runtime.features.igmpSnooping.groups.some(
      (entry: any) => entry.group === group && entry.expires > sim.clock.now(),
    ),
  );
  assert.ok(
    sim.events.some(
      (event) =>
        event.protocol === "IGMP" && event.packet?.source === "10.0.0.254",
    ),
  );
  const link = sim.lab.links.find((link) => link.a.deviceId === receiver.id)!;
  link.loss = 1;
  sim.changed();
  sim.advance(6000);
  assert.equal(sw.runtime.features.igmpSnooping.groups.length, 0);
});
test("lowest-IP snooping querier wins and the surviving querier takes over after expiry", () => {
  const { sim, sw } = fixture(),
    peer = sim.addDevice("switch");
  sw.config.features.igmpSnooping = {
    querier: true,
    querierAddress: "10.0.0.253",
    queryInterval: 2,
    maxResponse: 1,
  };
  peer.config.features.igmpSnooping = {
    querier: true,
    querierAddress: "10.0.0.254",
    queryInterval: 2,
    maxResponse: 1,
  };
  const link = sim.connect(
    { deviceId: sw.id, port: switchPort(5) },
    { deviceId: peer.id, port: switchPort(1) },
  );
  sim.changed();
  sim.advance(8000);
  assert.ok(
    peer.runtime.features.igmpSnooping.queriers.some(
      (entry: any) => entry.address === "10.0.0.253" && entry.port !== "local",
    ),
  );
  assert.equal(
    peer.runtime.features.igmpSnooping.queriers.some(
      (entry: any) => entry.port === "local",
    ),
    false,
  );
  link.loss = 1;
  sim.changed();
  sim.advance(8000);
  assert.ok(
    peer.runtime.features.igmpSnooping.queriers.some(
      (entry: any) => entry.port === "local" && entry.address === "10.0.0.254",
    ),
  );
});

test("snooping retains a learned EtherChannel receiver when its report member fails", () => {
  const { sim, sw, source, other } = fixture(),
    peer = sim.addDevice("switch"),
    receiver = sim.addDevice("pc");
  Object.assign(receiver.config.interfaces[hostPort], {
    ip: "10.0.0.9",
    mask: "255.255.255.0",
    adminUp: true,
  });
  for (const [left, right] of [
    [5, 1],
    [6, 2],
  ]) {
    sw.config.interfaces[switchPort(left)].features = {
      channelGroup: 1,
      channelMode: "active",
    };
    peer.config.interfaces[switchPort(right)].features = {
      channelGroup: 1,
      channelMode: "active",
    };
    sim.connect(
      { deviceId: sw.id, port: switchPort(left) },
      { deviceId: peer.id, port: switchPort(right) },
    );
  }
  peer.config.interfaces[switchPort(3)].features.portfast = true;
  sim.connect(
    { deviceId: peer.id, port: switchPort(3) },
    { deviceId: receiver.id, port: hostPort },
  );
  sim.changed();
  sim.advance(3000);
  report(sim, receiver);
  const learned = sw.runtime.features.igmpSnooping.groups.find(
    (entry: any) => entry.reporter === "10.0.0.9",
  );
  assert.ok(learned);
  sw.config.interfaces[learned.port].adminUp = false;
  sim.changed();
  sim.advance(2000);
  assert.ok(sw.runtime.features.igmpSnooping.groups.includes(learned));
  sim.events = [];
  sim.sendMulticast(source.id, group, { interface: hostPort });
  sim.advance(100);
  assert.equal(reaches(sim, receiver), true);
  assert.equal(reaches(sim, other), false);
});
