import type { Simulator, Frame, IPPacket } from "./engine.ts";
import type { Device } from "./model.ts";
import { isIPv4 } from "./ip.ts";

interface Session {
  type?:
    | "local"
    | "rspan-source"
    | "rspan-destination"
    | "erspan-source"
    | "erspan-destination";
  sources?: Array<{ interface: string; direction: "rx" | "tx" | "both" }>;
  destination?: string;
  remoteVlan?: number;
  sourceVlan?: number;
  erspanId?: number;
  ipAddress?: string;
  originIp?: string;
  vrf?: string;
  shutdown?: boolean;
}
function sessions(device: Device): Array<[string, Session]> {
  return Object.entries(device.config.features.spanSessions || {});
}
function row(device: Device, id: string): any {
  const stats = (device.runtime.features.spanStats ??= {});
  return (stats[id] ??= { frames: 0, bytes: 0, received: 0, drops: 0 });
}
function bytes(frame: Frame): number {
  return "size" in frame.payload ? frame.payload.size + 18 : 64;
}
function copy(frame: Frame): Frame {
  const value = structuredClone(frame);
  delete value.remoteSpan;
  value.mirrored = true;
  return value;
}
function captured(
  engine: Simulator,
  device: Device,
  id: string,
  session: Session,
  frame: Frame,
  source: string,
  sequence?: number,
): void {
  const stats = row(device, id);
  stats.received = (stats.received || 0) + 1;
  stats.receivedBytes = (stats.receivedBytes || 0) + bytes(frame);
  stats.lastSource = source;
  if (sequence !== undefined) stats.lastSequence = sequence;
  if (session.destination) {
    if(!engine.interfaceUp(device.id,session.destination))stats.drops=(stats.drops||0)+1;
    const outgoing=copy(frame);
    if(session.type==='rspan-destination'){
      // The transport tag belongs to the RSPAN domain, not to the analyzer.
      delete outgoing.vlan;
      if(outgoing.span)outgoing.span.rspan={vlan:session.sourceVlan!,destinationDevice:device.id,destinationSession:id};
    }
    if(session.type==='erspan-destination'&&outgoing.span?.erspan)Object.assign(outgoing.span.erspan,{destinationDevice:device.id,destinationSession:id});
    engine.mirrorFrame(device.id, session.destination, outgoing);
  } else stats.drops = (stats.drops || 0) + 1;
}

/** Remote copies travel as GRE packets or VLAN frames, never topology shortcuts. */
export function observeRemoteSpan(
  engine: Simulator,
  device: Device,
  port: string,
  direction: "rx" | "tx",
  frame: Frame,
): void {
  if (
    frame.mirrored ||
    frame.remoteSpan ||
    (!("kind" in frame.payload) && frame.payload.body?.kind === "remote-span")
  )
    return;
  for (const [id, session] of sessions(device)) {
    if (
      session.shutdown ||
      !["rspan-source", "erspan-source"].includes(session.type || "") ||
      !session.sources?.some(
        (source) =>
          source.interface === port &&
          (source.direction === direction || source.direction === "both"),
      )
    )
      continue;
    // RSPAN transports data traffic; Layer 2 control protocols are not carried.
    if(session.type==='rspan-source'&&'kind' in frame.payload&&frame.payload.kind==='link-control'&&['UDLD','STP','CDP','LLDP','DTP','LACP','PAGP','VTP','VPC-CFS'].includes(frame.payload.protocol))continue;
    const stats = row(device, id);
    stats.frames++;
    stats.bytes += bytes(frame);
    if (session.type === "rspan-source") {
      if (
        !Number.isInteger(session.remoteVlan) ||
        session.remoteVlan! < 1 ||
        session.remoteVlan! > 4094 ||
        !device.config.features.rspanVlans?.includes(session.remoteVlan)
      ) {
        stats.drops++;
        continue;
      }
      const mirrored = structuredClone(frame);
      mirrored.hops=64;
      mirrored.span={sourceDevice:device.id,session:id,sourceInterface:port,direction,configuredDirection:session.sources!.find(s=>s.interface===port)!.direction??'both',sourceFrame:frame.id,rspan:{vlan:session.remoteVlan!}};
      mirrored.remoteSpan = {
        sourceDevice: device.id,
        session: id,
        vlan: session.remoteVlan!,
      };
      engine.sendRemoteSpanVlan(device.id, session.remoteVlan!, mirrored);
    } else {
      const source =
        session.originIp &&
        (isIPv4(session.originIp)
          ? session.originIp
          : device.config.interfaces[session.originIp]?.ip);
      if (
        !source ||
        !session.ipAddress ||
        !isIPv4(session.ipAddress) ||
        !Number.isInteger(session.erspanId)
      ) {
        stats.drops++;
        continue;
      }
      const sequence = (stats.sequence = ((stats.sequence || 0) + 1) >>> 0);
      const mirrored=copy(frame);
      mirrored.span={sourceDevice:device.id,session:id,sourceInterface:port,direction,configuredDirection:session.sources!.find(s=>s.interface===port)!.direction??'both',sourceFrame:frame.id,erspan:{id:session.erspanId!,sequence,origin:source,destination:session.ipAddress}};
      if(!engine.sendRemoteSpanPacket(
        device.id,
        source,
        session.ipAddress,
        {
          kind: "remote-span",
          sessionId: session.erspanId,
          sequence,
          sourceDevice: device.id,
          frame: mirrored,
        },
        session.vrf,
      ))stats.drops++;
    }
  }
}

export function receiveRemoteSpan(
  engine: Simulator,
  device: Device,
  packet: IPPacket,
  input: string,
): boolean {
  const body = packet.body;
  if (
    body?.kind !== "remote-span" ||
    !body.frame?.payload ||
    typeof body.frame.sourceMac !== "string" ||
    typeof body.frame.destinationMac !== "string"
  )
    return false;
  let matched = false;
  for (const [id, session] of sessions(device)) {
    if (
      session.shutdown ||
      session.type !== "erspan-destination" ||
      !Number.isInteger(session.erspanId) || session.erspanId! < 1 || session.erspanId! > 1023 ||
      !isIPv4(session.ipAddress??'') ||
      session.erspanId !== body.sessionId ||
      (session.vrf??'') !== (packet.vrf??'') ||
      (session.ipAddress && session.ipAddress !== packet.destination) ||
      (session.originIp && session.originIp !== packet.source)
    )
      continue;
    matched = true;
    if(body.frame.span?.erspan)Object.assign(body.frame.span.erspan,{packetId:packet.id,ttl:packet.ttl});
    captured(
      engine,
      device,
      id,
      session,
      body.frame,
      packet.source,
      body.sequence,
    );
    row(device, id).input = input;
  }
  if (!matched)
    device.runtime.features.remoteSpanUnmatched =
      (device.runtime.features.remoteSpanUnmatched || 0) + 1;
  return matched;
}

/** Called on validated RSPAN VLAN ingress; the engine then bridges the frame. */
export function receiveRemoteSpanFrame(
  engine: Simulator,
  device: Device,
  port: string,
  vlan: number,
  frame: Frame,
): void {
  if (
    !frame.remoteSpan ||
    frame.remoteSpan.vlan !== vlan ||
    frame.remoteSpan.sourceDevice === device.id ||
    !device.config.features.rspanVlans?.includes(vlan)
  )
    return;
  for (const [id, session] of sessions(device)) {
    if (
      session.shutdown ||
      session.type !== "rspan-destination" ||
      session.sourceVlan !== vlan ||
      session.destination === port
    )
      continue;
    captured(engine, device, id, session, frame, frame.remoteSpan.sourceDevice);
  }
}
