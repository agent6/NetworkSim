import type { Lab, Device } from "./model.ts";
import type { Simulator } from "./engine.ts";
import { isIPv4, isIPv6, sameAddress } from "./ip.ts";

export type Criterion =
  | { kind: "all" | "any"; criteria: Criterion[] }
  | { kind: "device"; device: string; powered?: boolean }
  | { kind: "link"; a: string; b: string }
  | { kind: "address"; device: string; address: string }
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
  | {
      kind: "interface";
      device: string;
      interface: string;
      property: "adminUp" | "vlan" | "mode" | "mtu";
      value: string | number | boolean;
    };
export interface Objective {
  id: string;
  title: string;
  description?: string;
  criterion: Criterion;
  action?: { kind: "ping"; device: string; target: string; when?: Criterion };
}
export interface Lesson {
  title: string;
  description: string;
  objectives: Objective[];
  completed?: string[];
  observations?: string[];
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
      case "address":
        return address(v.address);
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
      case "interface":
        if (!text(v.interface, 128)) return false;
        if (v.property === "adminUp") return typeof v.value === "boolean";
        if (v.property === "mode")
          return [
            "access",
            "trunk",
            "dynamic-auto",
            "dynamic-desirable",
          ].includes(v.value);
        if (v.property === "vlan")
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
        o.action.kind !== "ping" ||
        !text(o.action.device, 128) ||
        !address(o.action.target) ||
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
  if (criterion.kind === "interface")
    return (
      d.config.interfaces[criterion.interface]?.[criterion.property] ===
      criterion.value
    );
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
