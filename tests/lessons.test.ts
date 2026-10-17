import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulator } from "../src/engine.ts";
import {
  lessonProgress,
  matches,
  actionAvailable,
  validateLesson,
  type GuidedLab,
} from "../src/lessons.ts";
function connectedHosts() {
  const sim = new Simulator(), client = sim.addDevice("pc"), server = sim.addDevice("server");
  Object.assign(client.config.interfaces.GigabitEthernet0, {ip: "192.0.2.1", mask: "255.255.255.0"});
  Object.assign(server.config.interfaces.GigabitEthernet0, {ip: "192.0.2.2", mask: "255.255.255.0"});
  sim.connect({deviceId: client.id, port: "GigabitEthernet0"}, {deviceId: server.id, port: "GigabitEthernet0"});
  return {sim, client, server};
}
test("imported objectives only award an echo after a real return packet and update on config changes", () => {
  const {sim, client, server} = connectedHosts();
  (sim.lab as GuidedLab).lesson = {
    title: "Imported checks", description: "",
    objectives: [
      {id: "address", title: "Address", criterion: {kind: "address", device: client.id, address: "192.0.2.1"}},
      {id: "power", title: "Power", criterion: {kind: "device", device: server.id, powered: true}},
      {id: "echo", title: "Echo", criterion: {kind: "echo", device: client.id, from: "192.0.2.2"}},
    ],
  };
  assert.equal(lessonProgress(sim)?.complete, 2);
  sim.ping(client.id, "192.0.2.2", {count: 1});
  sim.advance(5000);
  assert.equal(lessonProgress(sim)?.complete, 3);
  sim.events.splice(0);
  assert.equal(lessonProgress(sim)?.complete, 3, "clearing events preserves completed traffic");
  sim.power(server.id, false);
  assert.equal(lessonProgress(sim)?.complete, 2);
  delete client.config.interfaces.GigabitEthernet0.ip;
  sim.changed();
  assert.equal(lessonProgress(sim)?.complete, 1);
});
test("unknown predicates and recursive imported predicates do not execute or hang", () => {
  const sim = new Simulator();
  assert.equal(
    matches(sim, { kind: "script", source: "throw Error()" } as any),
    false,
  );
  const loop: any = { kind: "all", criteria: [] };
  loop.criteria.push(loop);
  assert.equal(matches(sim, loop), false);
});

test("compound objectives remember delivered traffic while configuration conditions stay live", () => {
  const {sim, client, server} = connectedHosts();
  const lab = sim.lab as GuidedLab;
  lab.lesson = {
    title: "Compound",
    description: "",
    objectives: [
      {
        id: "path",
        title: "Reach a powered server",
        criterion: {
          kind: "all",
          criteria: [
            { kind: "echo", device: client.id, from: "192.0.2.2" },
            { kind: "device", device: server.id, powered: true },
          ],
        },
        action: {
          kind: "ping",
          device: client.id,
          target: "192.0.2.2",
          when: { kind: "device", device: server.id, powered: true },
        },
      },
    ],
  };
  validateLesson(lab.lesson);
  assert.equal(actionAvailable(sim, lab.lesson.objectives[0]), true);
  assert.equal(lessonProgress(sim)?.complete, 0);
  sim.ping(client.id, "192.0.2.2", { count: 1 });
  sim.advance(5000);
  assert.equal(lessonProgress(sim)?.complete, 1);
  sim.events.splice(0);
  assert.equal(lessonProgress(sim)?.complete, 1);
  sim.power(server.id, false);
  assert.equal(lessonProgress(sim)?.complete, 0);
  assert.equal(actionAvailable(sim, lab.lesson.objectives[0]), false);
  sim.power(server.id, true);
  assert.equal(lessonProgress(sim)?.complete, 1);
});

test("guide validation rejects malformed nested conditions, duplicate IDs and unsafe action shapes", () => {
  const base = {
    title: "Guide",
    description: "",
    objectives: [
      {
        id: "a",
        title: "Address",
        criterion: { kind: "address", device: "PC", address: "2001:db8::1" },
      },
    ],
  };
  validateLesson(base);
  for (const mutate of [
    (v: any) => v.objectives.push(v.objectives[0]),
    (v: any) =>
      (v.objectives[0].criterion = {
        kind: "neighbor",
        device: "PC",
        protocol: {},
      }),
    (v: any) => (v.objectives[0].criterion = { kind: "all", criteria: [] }),
    (v: any) =>
      (v.objectives[0].action = {
        kind: "ping",
        device: "PC",
        target: "bad-address",
      }),
    (v: any) =>
      (v.objectives[0].action = {
        kind: "ping",
        device: "PC",
        target: "192.0.2.1",
        when: { kind: "script" },
      }),
  ]) {
    const copy = structuredClone(base);
    mutate(copy);
    assert.throws(() => validateLesson(copy), /objective/);
  }
});

test("IPv6 objective addresses compare canonical values", () => {
  const sim = new Simulator();
  const pc = sim.addDevice("pc");
  pc.config.interfaces.GigabitEthernet0.ipv6 = ["2001:db8::1/64"];
  assert.equal(
    matches(sim, {
      kind: "address",
      device: pc.id,
      address: "2001:0db8:0000:0000:0000:0000:0000:0001",
    }),
    true,
  );
});
