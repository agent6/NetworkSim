import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packetGroups,
  tracePacketIds,
  matchesProtocol,
} from "../src/packet-view.ts";
import type { SimEvent } from "../src/model.ts";

test("packet trace follows retained parent/fragment branches without unrelated traffic or looping", () => {
  const event = (id: string, parentId?: string) =>
    ({ packet: { id, parentId } }) as SimEvent;
  const records = [
    event("request"),
    event("fragment-a", "request"),
    event("fragment-b", "request"),
    event("reassembled", "fragment-a"),
    event("other"),
    event("loop-a", "loop-b"),
    event("loop-b", "loop-a"),
  ];
  assert.deepEqual(
    tracePacketIds(records, "fragment-b"),
    new Set(["request", "fragment-a", "fragment-b", "reassembled"]),
  );
  assert.deepEqual(
    tracePacketIds(records, "loop-a"),
    new Set(["loop-a", "loop-b"]),
  );
  assert.deepEqual(tracePacketIds(records, "expired"), new Set(["expired"]));
});

test("packet groups preserve real zero values and never invent missing transport fields", () => {
  const groups = packetGroups({
    id: "p",
    source: "192.0.2.1",
    destination: "192.0.2.2",
    protocol: "TCP",
    sourceMac: "02:00:00:00:00:01",
    vlan: 0,
    sourcePort: 10000,
    destinationPort: 80,
    seq: 0,
    flags: "SYN",
    futureField: "visible",
    ttl: undefined,
  });
  const fields = groups.flatMap((g) => g.fields);
  assert.ok(fields.some(([k, v]) => k === "seq" && v === 0));
  assert.ok(fields.some(([k]) => k === "futureField"));
  assert.ok(!fields.some(([k]) => k === "ttl" || k === "ack"));
  assert.equal(new Set(fields.map(([k]) => k)).size, fields.length);
});

test("service filters include transported request and response packets", () => {
  const dns: SimEvent = {
    id: "event-1",
    time: 0,
    nodeId: "pc",
    label: "Frame sent",
    detail: "DNS query",
    protocol: "UDP",
    disposition: "send",
    packet: {
      id: "packet-1",
      source: "192.0.2.1",
      destination: "192.0.2.53",
      protocol: "UDP",
      sourcePort: 42000,
      destinationPort: 53,
    },
  };
  assert.equal(matchesProtocol(dns, "DNS"), true);
  assert.equal(matchesProtocol(dns, "TCP"), false);
  assert.equal(matchesProtocol(dns, "drop"), false);
  assert.equal(
    matchesProtocol(
      {
        ...dns,
        packet: { ...dns.packet!, sourcePort: 53, destinationPort: 42000 },
      },
      "DNS",
    ),
    true,
  );
  assert.equal(matchesProtocol({ ...dns, protocol: "BGP" }, "BGP"), true);
  assert.equal(
    matchesProtocol(
      { ...dns, packet: { ...dns.packet!, source: "2001:db8::1" } },
      "IPv6",
    ),
    true,
  );
});
