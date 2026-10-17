import {stpPortState,stpMemberActive} from './stp-ports.ts';
import type { Simulator, Frame } from "./engine.ts";
import type { Device } from "./model.ts";
import type { SimulationClock, TimerHandle } from "./clock.ts";
import { isIPv4, ipToInt } from "./ip.ts";

interface Membership {
  vlan: number;
  group: string;
  source?: string;
  reporter: string;
  port: string;
  expires: number;
}
interface RouterPort {
  vlan: number;
  port: string;
  expires: number;
}
interface Querier {
  vlan: number;
  address: string;
  port: string;
  expires: number;
}
interface SnoopingState {
  groups: Membership[];
  routers: RouterPort[];
  queriers: Querier[];
}
interface Config {
  enabled?: boolean;
  querier?: boolean;
  querierAddress?: string;
  queryInterval?: number;
  maxResponse?: number;
  membershipInterval?: number;
  mrouter?: string[];
  immediateLeave?: boolean;
  vlans?: Record<number, Config>;
}
interface Scheduled {
  timer: TimerHandle;
  runtime: Device["runtime"];
  signature: string;
}
interface Controller {
  clock: SimulationClock;
  maintenance: TimerHandle;
  queries: Map<string, Scheduled>;
}
const controllers = new WeakMap<Simulator, Controller>();
function config(device: Device, vlan: number): Config {
  const global: Config = device.config.features.igmpSnooping || {};
  return {
    ...global,
    ...global.vlans?.[vlan],
    enabled:
      global.enabled !== false && global.vlans?.[vlan]?.enabled !== false,
  };
}
function state(device: Device): SnoopingState {
  return (device.runtime.features.igmpSnooping ??= {
    groups: [],
    routers: [],
    queriers: [],
  });
}
function seconds(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0
    ? Math.min(86400, value!)
    : fallback;
}
function isGroup(address: string): boolean {
  return (
    isIPv4(address) &&
    Number(address.split(".")[0]) >= 224 &&
    Number(address.split(".")[0]) <= 239
  );
}
function usable(
  engine: Simulator,
  device: Device,
  port: string,
  vlan: number,
): boolean {
  const stp = stpPortState(device,port,vlan);
  return (
    !!device.config.interfaces[port]?.switchport &&
    engine.interfaceUp(device.id, port) &&
    engine.carriesVlan(device, port, vlan) &&
    stpMemberActive(device,port) && (!stp || stp.state === "forwarding")
  );
}
function age(engine: Simulator, device: Device): boolean {
  const value = state(device),
    before = value.groups.length + value.routers.length + value.queriers.length;
  const alive = (entry: { vlan: number; port: string; expires: number }) =>
    device.powered &&
    entry.expires > engine.clock.now() &&
    config(device, entry.vlan).enabled !== false &&
    (entry.port === "local" ||
      usable(engine, device, entry.port, entry.vlan) ||
      bundlePorts(device, entry.port).some((port) =>
        usable(engine, device, port, entry.vlan),
      ));
  value.groups = value.groups.filter(alive);
  value.routers = value.routers.filter(alive);
  value.queriers = value.queriers.filter(alive);
  return (
    before !==
    value.groups.length + value.routers.length + value.queriers.length
  );
}
function bundlePorts(device: Device, port: string): string[] {
  const group =
    /^Port-channel(\d+)$/i.exec(port)?.[1] ??
    device.config.interfaces[port]?.features.channelGroup;
  return group === undefined
    ? []
    : device.runtime.features.portChannels?.[String(group)]?.activeMembers ||
        [];
}
function sourceAddress(
  device: Device,
  vlan: number,
  cfg: Config,
): string | undefined {
  const address =
    cfg.querierAddress || device.config.interfaces[`Vlan${vlan}`]?.ip;
  return address &&
    isIPv4(address) &&
    address !== "0.0.0.0" &&
    Number(address.split(".")[0]) < 224
    ? address
    : undefined;
}
function elected(
  engine: Simulator,
  device: Device,
  vlan: number,
  source: string,
): boolean {
  age(engine, device);
  return !state(device).queriers.some(
    (q) =>
      q.vlan === vlan &&
      q.address !== source &&
      ipToInt(q.address) < ipToInt(source),
  );
}
function query(
  engine: Simulator,
  device: Device,
  vlan: number,
  group = "0.0.0.0",
): void {
  const cfg = config(device, vlan),
    source = sourceAddress(device, vlan, cfg);
  if (
    !device.powered ||
    cfg.enabled === false ||
    !cfg.querier ||
    !source ||
    !elected(engine, device, vlan, source)
  )
    return;
  const value = state(device),
    expires =
      engine.clock.now() +
      (seconds(cfg.queryInterval, 60) * 2 + seconds(cfg.maxResponse, 10)) *
        1000;
  value.queriers = value.queriers.filter(
    (q) => !(q.vlan === vlan && q.port === "local"),
  );
  value.queriers.push({ vlan, address: source, port: "local", expires });
  engine.sendSnoopingQuery(device.id, vlan, source, {
    protocol: "igmp",
    operation: "query",
    group,
    maxResponse: seconds(cfg.maxResponse, 10),
  });
}

/** Called only after ingress VLAN, spanning-tree and protection checks pass. */
export function observeMulticastFrame(
  engine: Simulator,
  device: Device,
  port: string,
  vlan: number,
  frame: Frame,
): void {
  if ("kind" in frame.payload || !usable(engine, device, port, vlan)) return;
  const packet = frame.payload,
    payload =
      packet.body?.kind === "control-plane" ? packet.body.payload : undefined;
  const cfg = config(device, vlan);
  if (cfg.enabled === false || !payload || packet.ttl !== 1) return;
  const value = state(device),
    now = engine.clock.now();
  age(engine, device);
  if (payload.protocol === "pim") {
    value.routers = value.routers.filter(
      (entry) => !(entry.vlan === vlan && entry.port === port),
    );
    value.routers.push({
      vlan,
      port,
      expires: now + seconds(cfg.membershipInterval, 125) * 1000,
    });
    return;
  }
  if (payload.protocol !== "igmp" || packet.protocol !== "igmp") return;
  if (payload.operation === "query") {
    if (
      !isIPv4(packet.source) ||
      packet.source === "0.0.0.0" ||
      Number(packet.source.split(".")[0]) >= 224
    )
      return;
    const expires =
      now +
      (seconds(cfg.queryInterval, 60) * 2 + seconds(payload.maxResponse, 10)) *
        1000;
    value.routers = value.routers.filter(
      (entry) => !(entry.vlan === vlan && entry.port === port),
    );
    value.routers.push({ vlan, port, expires });
    value.queriers = value.queriers.filter(
      (q) => !(q.vlan === vlan && q.address === packet.source),
    );
    value.queriers.push({ vlan, address: packet.source, port, expires });
    if (
      sourceAddress(device, vlan, cfg) &&
      !elected(engine, device, vlan, sourceAddress(device, vlan, cfg)!)
    )
      value.queriers = value.queriers.filter(
        (q) => !(q.vlan === vlan && q.port === "local"),
      );
  } else if (
    isGroup(payload.group) &&
    ["report", "leave"].includes(payload.operation)
  ) {
    const matches = (entry: Membership) =>
      entry.vlan === vlan &&
      entry.group === payload.group &&
      entry.source === payload.source &&
      entry.reporter === packet.source &&
      entry.port === port;
    if (payload.operation === "report") {
      value.groups = value.groups.filter((entry) => !matches(entry));
      value.groups.push({
        vlan,
        group: payload.group,
        source: payload.source,
        reporter: packet.source,
        port,
        expires: now + seconds(cfg.membershipInterval, 125) * 1000,
      });
    } else if (cfg.immediateLeave)
      value.groups = value.groups.filter((entry) => !matches(entry));
    else {
      for (const entry of value.groups.filter(matches))
        entry.expires = Math.min(
          entry.expires,
          now + 2 * seconds(cfg.maxResponse, 10) * 1000,
        );
      query(engine, device, vlan, payload.group);
    }
  }
}

/** Unknown groups and link-local control groups retain normal VLAN flooding. */
export function snoopingEgress(
  engine: Simulator,
  device: Device,
  vlan: number,
  group: string,
  source: string,
): Set<string> | undefined {
  const cfg = config(device, vlan);
  if (cfg.enabled === false || !isGroup(group) || group.startsWith("224.0.0."))
    return;
  age(engine, device);
  const value = state(device),
    memberships = value.groups.filter(
      (entry) => entry.vlan === vlan && entry.group === group,
    );
  if (!memberships.length) return;
  const ports = new Set(
    memberships
      .filter((entry) => !entry.source || entry.source === source)
      .map((entry) => entry.port),
  );
  for (const entry of value.routers)
    if (entry.vlan === vlan) ports.add(entry.port);
  for (const port of cfg.mrouter || []) {
    if (usable(engine, device, port, vlan)) ports.add(port);
    for (const member of bundlePorts(device, port))
      if (usable(engine, device, member, vlan)) ports.add(member);
  }
  return ports;
}

export function syncSnooping(engine: Simulator): void {
  let controller = controllers.get(engine);
  if (!controller || controller.clock !== engine.clock) {
    const maintenance = engine.clock.schedule(
      1000,
      () => {
        let changed = false;
        for (const device of engine.lab.devices)
          if (device.runtime.features.igmpSnooping)
            changed = age(engine, device) || changed;
        if (changed) engine.notify();
      },
      { repeat: 1000, label: "IGMP snooping membership aging" },
    );
    controller = { clock: engine.clock, maintenance, queries: new Map() };
    controllers.set(engine, controller);
  }
  const wanted = new Set<string>();
  for (const device of engine.lab.devices) {
    if (!device.powered) continue;
    if (device.runtime.features.igmpSnooping) age(engine, device);
    for (const id of Object.keys(device.config.vlans)) {
      const vlan = Number(id),
        cfg = config(device, vlan),
        address = sourceAddress(device, vlan, cfg);
      if (
        cfg.enabled === false ||
        !cfg.querier ||
        !address ||
        !Object.keys(device.config.interfaces).some((port) =>
          usable(engine, device, port, vlan),
        )
      )
        continue;
      const key = `${device.id}|${vlan}`,
        signature = JSON.stringify([
          address,
          cfg.queryInterval,
          cfg.maxResponse,
        ]);
      wanted.add(key);
      const old = controller.queries.get(key);
      if (old?.runtime === device.runtime && old.signature === signature)
        continue;
      if (old) engine.clock.cancel(old.timer);
      const timer = engine.clock.schedule(
        1,
        () => query(engine, device, vlan),
        {
          owner: device.id,
          repeat: seconds(cfg.queryInterval, 60) * 1000,
          label: "IGMP snooping querier",
        },
      );
      controller.queries.set(key, {
        timer,
        runtime: device.runtime,
        signature,
      });
    }
  }
  for (const [key, value] of controller.queries)
    if (!wanted.has(key)) {
      engine.clock.cancel(value.timer);
      controller.queries.delete(key);
    }
}
