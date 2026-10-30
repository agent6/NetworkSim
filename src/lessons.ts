import type { Lab, Device } from "./model.ts";
import type { Simulator } from "./engine.ts";
import { isIPv4, isIPv6, ipToInt, inSubnet, maskToPrefix, sameAddress } from "./ip.ts";
import {poeSettings,poePort} from './poe.ts';
import {endpointVoicePolicy, endpointNetworkPort} from './endpoint.ts';

export type Criterion =
  | { kind: "all" | "any"; criteria: Criterion[] }
  | { kind: "device"; device: string; powered?: boolean }
  | { kind: "ip-routing"; device: string; enabled: boolean }
  | { kind: "link"; a: string; b: string }
  | { kind: "address"; device: string; address: string }
  | { kind: "default-gateway"; device: string; address: string }
  | { kind: "dhcp-pool"; device: string; name: string; network: string; prefix: number; gateway: string; dnsServer: string; excludedStart: string; excludedEnd: string; leaseSeconds: number }
  | { kind: "dhcp-relay"; device: string; interface: string; serverAddress: string }
  | { kind: "dhcp-lease"; device: string; interface: string; server: string; network: string; prefix: number; gateway: string; dnsServer: string }
  | {
      kind: "route";
      device: string;
      network: string;
      prefix: number;
      protocol?: string;
    }
  | { kind: "neighbor"; device: string; protocol: string; state?: string }
  | { kind: "echo"; device: string; from: string }
  | { kind: "vlan"; device: string; id: number }
  | { kind: "trunk-allowed"; device: string; interface: string; vlans: number[] }
  | { kind: "poe-interface"; device: string; interface: string; mode: "auto" | "never"; max: number; priority: "high" | "low" }
  | { kind: "poe-supply"; device: string; switch: string; interface: string; watts: number; standard: "802.3af" | "802.3at"; class: 3 | 4; spatialStreams?: 2 | 4; usb?: boolean }
  | { kind: "voice-policy"; device: string; vlan: number }
  | { kind: "mac-learned"; device: string; interface: string; source: string; sourceInterface: string; vlan: number }
  | {
      kind: "interface";
      device: string;
      interface: string;
      property: "adminUp" | "vlan" | "voiceVlan" | "nativeVlan" | "nonegotiate" | "mode" | "mtu" | "ip" | "mask" | "description" | "switchport" | "duplex" | "portfast" | "speedAuto";
      value: string | number | boolean;
    };
export interface Objective {
  id: string;
  title: string;
  description?: string;
  criterion: Criterion;
  action?: { kind: "ping"; device: string; target: string; when?: Criterion } | { kind: "dhcp"; device: string; interface: string; when?: Criterion };
}
export interface Lesson {
  title: string;
  description: string;
  objectives: Objective[];
  completed?: string[];
  observations?: string[];
  /** Remember the celebration for this saved lab attempt, including after reload. */
  celebrated?: boolean;
}
export type GuidedLab = Lab & { lesson?: Lesson };
const device = (sim: Simulator, name: string): Device | undefined =>
  sim.lab.devices.find((d) => d.id === name || d.config.hostname === name);

/** Imported guides are a bounded data format, never executable expressions. */
export function validateLesson(value: unknown): asserts value is Lesson {
  const record = (v: any): v is Record<string, any> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v: any, limit = 2000) =>
    typeof v === "string" && v.length <= limit;
  const address = (v: any) => typeof v === "string" && (isIPv4(v) || isIPv6(v));
  let nodes = 0;
  const criterion = (v: any, depth = 0): boolean => {
    if (!record(v) || ++nodes > 1000 || depth > 16) return false;
    if (v.kind === "all" || v.kind === "any")
      return (
        Array.isArray(v.criteria) &&
        v.criteria.length > 0 &&
        v.criteria.every((c: unknown) => criterion(c, depth + 1))
      );
    if (v.kind === "link") return text(v.a, 128) && text(v.b, 128);
    if (!text(v.device, 128)) return false;
    switch (v.kind) {
      case "device":
        return v.powered === undefined || typeof v.powered === "boolean";
      case "ip-routing":
        return typeof v.enabled === "boolean";
      case "address":
        return address(v.address);
      case "default-gateway":
        return typeof v.address === "string" && isIPv4(v.address);
      case "dhcp-relay":
        return text(v.interface,128) && typeof v.serverAddress === "string" && isIPv4(v.serverAddress);
      case "dhcp-pool":
      case "dhcp-lease": {
        const ip=(key:string)=>typeof v[key]==="string" && isIPv4(v[key]);
        if (!ip("network") || !Number.isInteger(v.prefix) || v.prefix<0 || v.prefix>32 || !ip("gateway") || !ip("dnsServer")) return false;
        return v.kind==="dhcp-lease"
          ? text(v.interface,128) && text(v.server,128)
          : text(v.name,128) && ip("excludedStart") && ip("excludedEnd") && ipToInt(v.excludedStart)<=ipToInt(v.excludedEnd) && Number.isInteger(v.leaseSeconds) && v.leaseSeconds>=1 && v.leaseSeconds<=4294967295;
      }
      case "echo":
        return address(v.from);
      case "route":
        return (
          address(v.network) &&
          Number.isInteger(v.prefix) &&
          v.prefix >= 0 &&
          v.prefix <= (v.network.includes(":") ? 128 : 32) &&
          (v.protocol === undefined || text(v.protocol, 40))
        );
      case "neighbor":
        return (
          text(v.protocol, 40) && (v.state === undefined || text(v.state, 40))
        );
      case "vlan":
        return Number.isInteger(v.id) && v.id >= 1 && v.id <= 4094;
      case "trunk-allowed":
        return text(v.interface,128) && Array.isArray(v.vlans) && v.vlans.length>0 && v.vlans.length<=4094 && v.vlans.every((n:unknown)=>Number.isInteger(n) && Number(n)>=1 && Number(n)<=4094) && new Set(v.vlans).size===v.vlans.length;
      case "poe-interface":
        return text(v.interface,128) && ["auto","never"].includes(v.mode) && Number.isInteger(v.max) && v.max>=4000 && v.max<=30000 && ["high","low"].includes(v.priority);
      case "poe-supply":
        return text(v.switch,128) && text(v.interface,128) && Number.isFinite(v.watts) && v.watts>0 && v.watts<=30 && ["802.3af","802.3at"].includes(v.standard) && [3,4].includes(v.class) && (v.spatialStreams===undefined || [2,4].includes(v.spatialStreams)) && (v.usb===undefined || typeof v.usb==="boolean");
      case "voice-policy":
        return Number.isInteger(v.vlan) && v.vlan >= 1 && v.vlan <= 4094;
      case "mac-learned":
        return text(v.interface,128) && text(v.source,128) && text(v.sourceInterface,128) && Number.isInteger(v.vlan) && v.vlan>=1 && v.vlan<=4094;
      case "interface":
        if (!text(v.interface, 128)) return false;
        if (["switchport","portfast","speedAuto","nonegotiate"].includes(v.property)) return typeof v.value === "boolean";
        if (v.property === "description") return text(v.value,240);
        if (v.property === "duplex") return ["auto","full","half"].includes(v.value);
        if (v.property === "ip") return typeof v.value === "string" && isIPv4(v.value);
        if (v.property === "mask") {
          if (typeof v.value !== "string" || !isIPv4(v.value)) return false;
          try { maskToPrefix(v.value); return true; } catch { return false; }
        }
        if (v.property === "adminUp") return typeof v.value === "boolean";
        if (v.property === "mode")
          return [
            "access",
            "trunk",
            "dynamic-auto",
            "dynamic-desirable",
          ].includes(v.value);
        if (v.property === "vlan" || v.property === "voiceVlan" || v.property === "nativeVlan")
          return Number.isInteger(v.value) && v.value >= 1 && v.value <= 4094;
        return (
          v.property === "mtu" &&
          Number.isInteger(v.value) &&
          v.value >= 68 &&
          v.value <= 65535
        );
      default:
        return false;
    }
  };
  if (
    !record(value) ||
    !text(value.title, 200) ||
    !text(value.description, 10000) ||
    !Array.isArray(value.objectives) ||
    value.objectives.length > 100
  )
    throw Error("The lab guide is invalid.");
  if (value.celebrated !== undefined && typeof value.celebrated !== "boolean")
    throw Error("The lab guide celebration record is invalid.");
  for (const key of ["completed", "observations"])
    if (
      value[key] !== undefined &&
      (!Array.isArray(value[key]) ||
        value[key].length > 1000 ||
        value[key].some((id: unknown) => !text(id, 300)))
    )
      throw Error("The lab guide completion record is invalid.");
  const ids = new Set<string>();
  for (const o of value.objectives) {
    if (
      !record(o) ||
      !text(o.id, 128) ||
      !o.id ||
      ids.has(o.id) ||
      !text(o.title, 500) ||
      (o.description !== undefined && !text(o.description, 10000)) ||
      !criterion(o.criterion)
    )
      throw Error(
        "A lab objective has an invalid ID, description, or condition.",
      );
    ids.add(o.id);
    if (
      o.action !== undefined &&
      (!record(o.action) ||
        !["ping","dhcp"].includes(o.action.kind) ||
        !text(o.action.device, 128) ||
        (o.action.kind === "ping" ? !address(o.action.target) : !text(o.action.interface,128)) ||
        (o.action.when !== undefined && !criterion(o.action.when)))
    )
      throw Error("A lab objective action is invalid.");
  }
}

export function actionAvailable(sim: Simulator, objective: Objective): boolean {
  const action = objective.action;
  return (
    !!action &&
    !!device(sim, action.device)?.powered &&
    (action.kind !== "dhcp" || sim.interfaceUp(device(sim,action.device)!.id,action.interface)) &&
    (!action.when || matches(sim, action.when))
  );
}

/** Declarative objectives inspect observed state; they never evaluate imported code. */
export function matches(
  sim: Simulator,
  criterion: Criterion,
  depth = 0,
): boolean {
  if (!criterion || typeof criterion !== "object" || depth > 16) return false;
  if (criterion.kind === "all" || criterion.kind === "any")
    return (
      Array.isArray(criterion.criteria) &&
      criterion.criteria.length > 0 &&
      (criterion.kind === "all"
        ? criterion.criteria.every((c) => matches(sim, c, depth + 1))
        : criterion.criteria.some((c) => matches(sim, c, depth + 1)))
    );
  if (criterion.kind === "link") {
    const a = device(sim, criterion.a),
      b = device(sim, criterion.b);
    return (
      !!a &&
      !!b &&
      sim.lab.links.some(
        (l) =>
          l.enabled &&
          ((l.a.deviceId === a.id && l.b.deviceId === b.id) ||
            (l.a.deviceId === b.id && l.b.deviceId === a.id)),
      )
    );
  }
  if (!("device" in criterion)) return false;
  const d = device(sim, criterion.device);
  if (!d) return false;
  if (criterion.kind === "trunk-allowed") {
    const port=d.config.interfaces[criterion.interface],allowed=port?.allowedVlans;
    return !!port?.switchport && port.mode==="trunk" && Array.isArray(allowed) && allowed.length===criterion.vlans.length && criterion.vlans.every(v=>allowed.includes(v));
  }
  if (criterion.kind === "poe-interface") {
    const port=d.config.interfaces[criterion.interface];
    if (d.kind!=="poeswitch" || !port || !poePort(criterion.interface)) return false;
    const settings=poeSettings(port);
    return settings.mode===criterion.mode && settings.max===criterion.max && settings.priority===criterion.priority;
  }
  if (criterion.kind === "poe-supply") {
    const sw=device(sim,criterion.switch),supply=d.runtime.features.poePower;
    const row=sw?.runtime.features.poe?.ports?.find((p:any)=>p.port===criterion.interface);
    return !!sw && sw.kind==="poeswitch" && sim.devicePowered(d.id) && supply?.available===true && supply.source==="poe" && supply.switchId===sw.id && supply.port===criterion.interface && supply.watts===criterion.watts && supply.standard===criterion.standard && supply.class===criterion.class && row?.deviceId===d.id && row.state==="on" && row.watts===criterion.watts && (criterion.spatialStreams===undefined || supply.spatialStreams===criterion.spatialStreams) && (criterion.usb===undefined || supply.usb===criterion.usb);
  }
  if (criterion.kind === "ip-routing") return d.config.ipRouting === criterion.enabled;
  if (criterion.kind === "default-gateway")
    return d.config.defaultGateway === criterion.address;
  if (criterion.kind === "dhcp-relay") {
    const port=d.config.interfaces[criterion.interface];
    return !!port?.adminUp && !!port.features.helpers?.includes(criterion.serverAddress);
  }
  if (criterion.kind === "dhcp-pool") {
    const service=d.config.services.dhcp;
    return service?.enabled===true && !!service.pools?.some((pool:any)=>pool.name===criterion.name && pool.network===criterion.network && pool.prefix===criterion.prefix && pool.defaultRouter===criterion.gateway && pool.dnsServers?.includes(criterion.dnsServer) && (pool.leaseSeconds??86400)===criterion.leaseSeconds) && !!service.excluded?.some((range:any)=>range.start===criterion.excludedStart && range.end===criterion.excludedEnd);
  }
  if (criterion.kind === "dhcp-lease") {
    const port=d.config.interfaces[criterion.interface],lease=d.runtime.features.dhcpClientLeases?.[criterion.interface],server=device(sim,criterion.server),now=sim.clock.now();
    if (!port?.features.dhcp || !isIPv4(port.ip??"") || !port.mask || !server || !lease || !["BOUND","RENEWING","REBINDING"].includes(lease.state) || lease.expires<=now || lease.serverId!==server.id || lease.address!==port.ip) return false;
    const n=ipToInt(port.ip!);
    try {
      return inSubnet(port.ip!,criterion.network,criterion.prefix) && maskToPrefix(port.mask)===criterion.prefix && d.config.defaultGateway===criterion.gateway && d.config.dnsServers.includes(criterion.dnsServer) && !(server.config.services.dhcp?.excluded??[]).some((range:any)=>n>=ipToInt(range.start)&&n<=ipToInt(range.end??range.start)) && !!server.runtime.features.dhcpLeases?.some((row:any)=>row.clientId===d.id && row.address===port.ip && row.state==='BOUND' && row.expires>now);
    } catch { return false; }
  }
  if (criterion.kind === "device")
    return criterion.powered === undefined || d.powered === criterion.powered;
  if (criterion.kind === "address")
    return Object.values(d.config.interfaces).some(
      (p) =>
        (!!p.ip && sameAddress(p.ip, criterion.address)) ||
        p.ipv6.some((ip) => sameAddress(ip.split("/")[0], criterion.address)),
    );
  if (criterion.kind === "route")
    return d.runtime.routes.some(
      (r) =>
        sameAddress(r.network, criterion.network) &&
        r.prefix === criterion.prefix &&
        (!criterion.protocol ||
          r.protocol.toLowerCase() === criterion.protocol.toLowerCase()),
    );
  if (criterion.kind === "neighbor")
    return d.runtime.neighbors.some(
      (n) =>
        n.protocol.toLowerCase() === criterion.protocol.toLowerCase() &&
        (!criterion.state ||
          n.state.toLowerCase() === criterion.state.toLowerCase()),
    );
  if (criterion.kind === "echo")
    return sim.events.some(
      (e) =>
        e.nodeId === d.id &&
        e.label === "Echo reply received" &&
        e.disposition === "success" &&
        !!e.packet?.source &&
        sameAddress(e.packet.source, criterion.from),
    );
  if (criterion.kind === "vlan") return !!d.config.vlans[criterion.id]?.active;
  if (criterion.kind === "voice-policy")
    return sim.devicePowered(d.id) && sim.interfaceUp(d.id,endpointNetworkPort(d)) && endpointVoicePolicy(d,sim.clock.now())?.vlan === criterion.vlan;
  if (criterion.kind === "mac-learned") {
    const source=device(sim,criterion.source);
    if (!source?.config.interfaces[criterion.sourceInterface] || !d.config.interfaces[criterion.interface]) return false;
    const mac=sim.macOf(source.id,criterion.sourceInterface).toLowerCase(),entry=d.runtime.mac[criterion.vlan+"|"+mac];
    return !!entry && !entry.static && entry.expires>sim.clock.now() && entry.port===criterion.interface && entry.vlan===criterion.vlan;
  }
  if (criterion.kind === "interface") {
    const port=d.config.interfaces[criterion.interface];if(!port)return false;
    const value=criterion.property==="nonegotiate"?port.features.nonegotiate===true:criterion.property==="portfast"?port.features.portfast===true:criterion.property==="speedAuto"?port.features.speedAuto!==false:criterion.property==="voiceVlan"?port.features.voiceVlan:port[criterion.property];
    return value===criterion.value;
  }
  return false;
}
export function lessonProgress(sim: Simulator):
  | {
      lesson: Lesson;
      rows: { objective: Objective; complete: boolean }[];
      complete: number;
      changed: boolean;
    }
  | undefined {
  const lesson = (sim.lab as GuidedLab).lesson;
  if (
    !lesson ||
    !Array.isArray(lesson.objectives) ||
    lesson.objectives.length > 100
  )
    return;
  const completed = new Set(lesson.completed || []);
  const observations = new Set(lesson.observations || []);
  const previous = JSON.stringify([
    lesson.completed || [],
    lesson.observations || [],
  ]);
  const validKeys = new Set<string>();
  const observe = (c: Criterion, key: string, depth = 0): boolean => {
    if (!c || typeof c !== "object" || depth > 16) return false;
    if (c.kind === "all" || c.kind === "any") {
      if (!Array.isArray(c.criteria)) return false;
      // Evaluate every branch so simultaneous traffic observations are retained.
      const results = c.criteria.map((child, i) =>
        observe(child, `${key}/${i}`, depth + 1),
      );
      return (
        results.length > 0 &&
        (c.kind === "all" ? results.every(Boolean) : results.some(Boolean))
      );
    }
    const result = matches(sim, c);
    if (c.kind !== "echo") return result;
    validKeys.add(key);
    if (result) observations.add(key);
    return result || observations.has(key);
  };
  const rows = lesson.objectives.map((objective) => {
    const observed = observe(objective.criterion, JSON.stringify(objective.id));
    // Traffic goals record an accomplishment; configuration goals stay live.
    if (objective.criterion.kind === "echo" && observed)
      completed.add(objective.id);
    return {
      objective,
      complete:
        observed ||
        (objective.criterion.kind === "echo" && completed.has(objective.id)),
    };
  });
  lesson.completed = [...completed].filter((id) =>
    lesson.objectives.some((o) => o.id === id),
  );
  lesson.observations = [...observations].filter((key) => validKeys.has(key));
  return {
    lesson,
    rows,
    complete: rows.filter((r) => r.complete).length,
    changed:
      previous !== JSON.stringify([lesson.completed, lesson.observations]),
  };
}

/** Completion is an achievement once per attempt; later repairs do not replay it. */
export function claimLessonCelebration(sim: Simulator): {title:string;total:number}|undefined {
  const progress=lessonProgress(sim);
  if (!progress || progress.lesson.celebrated || !progress.rows.length || progress.complete!==progress.rows.length) return;
  progress.lesson.celebrated=true;
  return {title:progress.lesson.title,total:progress.rows.length};
}
