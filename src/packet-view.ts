import type { PacketSummary, SimEvent } from "./model.ts";

const servicePorts: Record<string, number[]> = {
  DNS: [53],
  SNMP: [161,162],
  DHCP: [67, 68, 546, 547],
  HTTP: [80],
  SSH: [22],
  FTP: [21,...Array.from({length:32},(_,i)=>50000+i)],
  TELNET: [23],
  NTP: [123],
  TFTP: [69],
  SYSLOG: [514],
  RADIUS: [1812, 1813],
  TACACS: [49],
  BFD: [3784, 3785, 4784],
  CAPWAP:[5246,5247],
  IKE: [500, 4500],
  BGP: [179],
  RIP: [520, 521],
};

/** Service filters include their transport frames, not only control-plane notices. */
export function matchesProtocol(event: SimEvent, selected: string): boolean {
  if (selected === "all") return true;
  if (selected === "drop") return event.disposition === "drop";
  const protocol = event.protocol.toUpperCase(),
    wanted = selected.toUpperCase();
  if (wanted === "IPV6")
    return (
      !!event.packet?.source?.includes(":") ||
      /ICMPV6|DHCPV6|NDP/.test(protocol)
    );
  if (protocol.includes(wanted)) return true;
  if (!["TCP", "UDP"].includes(protocol)) return false;
  const ports = servicePorts[wanted] || [];
  return (
    ports.includes(Number(event.packet?.sourcePort)) ||
    ports.includes(Number(event.packet?.destinationPort))
  );
}

export function packetGroups(packet: PacketSummary) {
  const values = Object.entries(packet).map(([key,value])=>[key,key==='espSpi'&&typeof value==='number'?'0x'+value.toString(16):value] as [string,any]).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  const used = new Set<string>();
  const group = (title: string, keys: string[]) => {
    const fields = values.filter(([key]) => keys.includes(key));
    fields.forEach(([key]) => used.add(key));
    return { title, fields };
  };
  const groups = [
    group("IPsec and IKE",["espSpi","espSequence","protectedProtocol","ikeStage","ikeExchangeId"]),
    group("802.11 and wireless transport",["frameType","subtype","bssid","ssid","channel","band","rssi","snr","rate","eapType","keyMessage","replayCounter","micValidated","innerFrameId"]),
    group("Ethernet", ["sourceMac", "destinationMac", "vlan", "cos"]),
    group("Addresses and forwarding", [
      "vrf",
      "source",
      "destination",
      "protocol",
      "ttl",
      "size",
      "dscp",
      "ecn",
      "ipVersion",
      "df",
      "fragmentOffset",
      "moreFragments",
    ]),
    group("Transport and message", [
      "sourcePort",
      "destinationPort",
      "flags",
      "sequence",
      "acknowledgment",
      "seq",
      "ack",
      "tcpFlags",
      "tcpSegmentIndex",
      "tcpSegmentCount",
      "tcpAckSegmentIndex",
      "icmpType",
      "icmpCode",
      "icmpSequence",
      "icmpIdentifier",
      "arpOperation",
      "operation",
      "dhcpOperation",
      "requestedAddress",
      "relayAddress",
      "messageType",
    ]),
    group("Packet identity", ["id", "parentId"]),
  ];
  groups.push({
    title: "Additional fields",
    fields: values.filter(([key]) => !used.has(key)),
  });
  return groups.filter((g) => g.fields.length);
}

/** Follow retained parent/fragment relationships; never infer delivery from a path. */
export function tracePacketIds(events: SimEvent[], id: string): Set<string> {
  const parent = new Map<string, string>();
  const children = new Map<string, Set<string>>();
  for (const event of events) {
    const packet = event.packet;
    if (!packet?.parentId || packet.parentId === packet.id) continue;
    parent.set(packet.id, packet.parentId);
    if (!children.has(packet.parentId))
      children.set(packet.parentId, new Set());
    children.get(packet.parentId)!.add(packet.id);
  }
  let root = id;
  const ancestors = new Set<string>();
  while (parent.has(root) && !ancestors.has(root)) {
    ancestors.add(root);
    root = parent.get(root)!;
  }
  const found = new Set<string>([root]);
  const pending = [root];
  for (let i = 0; i < pending.length; i++)
    for (const child of children.get(pending[i]) || [])
      if (!found.has(child)) {
        found.add(child);
        pending.push(child);
      }
  return found;
}
