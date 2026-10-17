import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulator } from "../src/engine.ts";
import { parseDocument, fileName, loadWorkspace, saveWorkspace } from "../src/persistence.ts";

function document() {
  const s = new Simulator(42),
    a = s.addDevice("pc"),
    b = s.addDevice("switch");
  s.connect(
    { deviceId: a.id, port: "GigabitEthernet0" },
    { deviceId: b.id, port: "GigabitEthernet0/1" },
  );
  a.config.interfaces.GigabitEthernet0.ip = "192.0.2.10";
  a.config.interfaces.GigabitEthernet0.mask = "255.255.255.0";
  a.startupConfig = structuredClone(a.config);
  return s.serialize();
}
test("portable lab validates without trusting exported runtime", () => {
  const doc = document();
  doc.lab.devices[0].runtime.routes.push({
    network: "0.0.0.0",
    prefix: 0,
    interface: "fake",
    protocol: "static",
    ad: 1,
    metric: 0,
  });
  const result = parseDocument(JSON.stringify(doc));
  assert.deepEqual(result.lab.devices[0].runtime.routes, []);
  assert.equal(
    result.lab.devices[0].startupConfig?.interfaces.GigabitEthernet0.ip,
    "192.0.2.10",
  );
});
test("invalid import is rejected before a live topology is replaced", () => {
  const sim = new Simulator();
  sim.addDevice("router");
  const before = sim.serialize(),
    bad = document();
  bad.lab.links[0].a.port = "missing";
  assert.throws(() => sim.load(parseDocument(JSON.stringify(bad))), /missing/);
  assert.deepEqual(sim.serialize(), before);
});
test("duplicate IDs, occupied ports, invalid IP/masks and invalid startup configs fail", () => {
  const cases = [
    (d: any) => (d.lab.devices[1].id = d.lab.devices[0].id),
    (d: any) =>
      d.lab.links.push({ ...structuredClone(d.lab.links[0]), id: "extra" }),
    (d: any) =>
      (d.lab.devices[0].config.interfaces.GigabitEthernet0.ip = "999.0.0.1"),
    (d: any) =>
      (d.lab.devices[0].config.interfaces.GigabitEthernet0.mask =
        "255.0.255.0"),
    (d: any) =>
      (d.lab.devices[0].startupConfig.interfaces.GigabitEthernet0.mtu = -1),
    (d: any) => (d.lab.devices[0].config.protocols.ospf = { networks: "bad" }),
  ];
  for (const mutate of cases) {
    const d = document();
    mutate(d);
    assert.throws(() => parseDocument(JSON.stringify(d)));
  }
});
test("prototype keys, oversize documents and excessive depth fail closed", () => {
  assert.throws(() => parseDocument('{"__proto__":{}}'), /unsafe/);
  assert.throws(() => parseDocument(" ".repeat(10 * 1024 * 1024 + 1)), /10 MB/);
  assert.throws(
    () => parseDocument("[".repeat(60) + "0" + "]".repeat(60)),
    /nested/,
  );
  assert.equal(fileName("../../Lab<script>"), "Labscript.netsim.yaml");
});

test('literal account/file dictionary names survive JSON/YAML while nested configuration keys stay guarded',()=>{
 const doc=document(),d=doc.lab.devices[0];d.config.features.users=JSON.parse('{"__proto__":{"password":"literal","privilege":15},"constructor":{"password":"named","privilege":1}}');d.config.features.files=JSON.parse('{"__proto__":"file data","constructor":"another file"}');d.config.services.sshFiles={enabled:true,files:JSON.parse('{"__proto__":"ssh data"}')};d.startupConfig=structuredClone(d.config);
 const loaded=parseDocument(JSON.stringify(doc));assert.ok(Object.hasOwn(loaded.lab.devices[0].config.features.users,'__proto__'));assert.equal(loaded.lab.devices[0].config.features.files.constructor,'another file');assert.equal(loaded.lab.devices[0].startupConfig!.services.sshFiles.files.__proto__,'ssh data');
 const bad=structuredClone(doc);Object.defineProperty(bad.lab.devices[0].config.features.users.__proto__,'constructor',{value:{polluted:true},enumerable:true});assert.throws(()=>parseDocument(JSON.stringify(bad)),/unsafe/);assert.equal(({}as any).polluted,undefined);
});

test('Ethernet autonegotiation persists as a boolean and malformed running/startup flags reject transactionally',()=>{const doc=document(),d=doc.lab.devices[0],p=Object.values(d.config.interfaces)[0];p.features.speedAuto=false;d.startupConfig=structuredClone(d.config);assert.equal(Object.values(parseDocument(JSON.stringify(doc)).lab.devices[0].config.interfaces)[0].features.speedAuto,false);for(const field of['config','startupConfig']as const){const bad=structuredClone(doc);Object.values(bad.lab.devices[0][field]!.interfaces)[0].features.speedAuto='false';assert.throws(()=>parseDocument(JSON.stringify(bad)),/autonegotiation/);const e=new Simulator();assert.throws(()=>e.load(bad),/autonegotiation|interface/);assert.equal(e.lab.devices.length,0);}});

test("directional loss persists and invalid values fail", () => {
  const doc = document();
  doc.lab.links[0].lossAB = 1;
  doc.lab.links[0].lossBA = 0;
  assert.equal(parseDocument(JSON.stringify(doc)).lab.links[0].lossAB, 1);
  doc.lab.links[0].lossBA = 2;
  assert.throws(() => parseDocument(JSON.stringify(doc)), /loss/);
});

test("malformed lesson completion cannot break an imported workspace", () => {
  const doc: any = document();
  doc.lab.lesson = {
    title: "Guide",
    description: "Test",
    objectives: [],
    completed: 42,
  };
  assert.throws(() => parseDocument(JSON.stringify(doc)), /completion/);
});

function browserStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

test("workspace recovery preserves topology, running/startup configs, notes and viewport independently of named saves", () => {
  const storage = browserStorage();
  storage.setItem("network-sim.labs.v1", "named snapshots");
  assert.equal(loadWorkspace(storage), null);
  const doc = { ...document(), view: { x: 125, y: -40, scale: 1.4 } };
  doc.lab.devices[0].config.hostname = "Workstation";
  doc.lab.devices[0].x = 341;
  doc.lab.notes.push({ id: "note-test", x: 20, y: 75, text: "Retain this note", locked: true });
  saveWorkspace(doc, storage);
  const loaded = loadWorkspace(storage)!;
  assert.deepEqual(loaded, doc);
  assert.equal(loaded.lab.devices[0].startupConfig?.hostname, "PC1");
  const restarted = new Simulator();
  restarted.load(loaded);
  assert.equal(restarted.lab.devices[0].config.hostname, "Workstation");
  assert.equal(restarted.lab.links.length, 1);
  assert.equal(storage.getItem("network-sim.labs.v1"), "named snapshots");
});

test("an intentionally empty workspace replaces the previous lab", () => {
  const storage = browserStorage();
  saveWorkspace(document(), storage);
  const empty = new Simulator().serialize();
  saveWorkspace(empty, storage);
  assert.deepEqual(loadWorkspace(storage), empty);
});

test("failed workspace writes preserve the previous checkpoint and report failure", () => {
  const storage = browserStorage();
  const original = document();
  saveWorkspace(original, storage);
  const blocked = { setItem() { throw new Error("Storage quota exceeded"); } };
  assert.throws(() => saveWorkspace(new Simulator().serialize(), blocked), /quota/);
  assert.deepEqual(loadWorkspace(storage), original);
  assert.throws(() => loadWorkspace({ getItem() { throw new Error("Storage blocked"); } }), /blocked/);
});

test("damaged workspace data is rejected without replacing the stored recovery copy", () => {
  const storage = browserStorage();
  const bad = document();
  bad.lab.links[0].a.port = "missing";
  saveWorkspace(bad, storage);
  const before = new Map(storage.data);
  assert.throws(() => loadWorkspace(storage), /missing/);
  assert.deepEqual(storage.data, before);
});
