import {validateEndpoint} from './endpoint.ts';
import {validatePhone} from './phone.ts';
import {validateLinkMedium} from './link-medium.ts';
import{validatePoE}from'./poe.ts';
import {dnsRecords,validateDNSRecords} from './dns-service.ts';
import{validateWireless}from'./wireless-model.ts';
import { parseDocument as parseYAML, stringify as stringifyYAML } from "yaml";
import { emptyRuntime, type LabDocument } from "./model.ts";
import { isIPv4, isIPv6, maskToPrefix, parseCidr } from "./ip.ts";
import { validateLesson } from "./lessons.ts";

const STORAGE_KEY = "network-sim.labs.v1";
const WORKSPACE_KEY = "network-sim.workspace.v1";
const KINDS = new Set(["router", "switch", "poeswitch", "l3switch", "pc", "server", "wlc", "ap", "laptop", "phone"]);
export interface SavedLab {
  id: string;
  name: string;
  savedAt: number;
  document: LabDocument;
}
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

function object(v: any): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function validateConfig(c: any) {
  if (
    !object(c) ||
    typeof c.hostname !== "string" ||
    c.hostname.length > 80 ||
    !object(c.interfaces) ||
    Object.keys(c.interfaces).length > 300
  )
    throw Error("A device has invalid configuration.");
  if (
    ![c.vlans, c.protocols, c.services, c.features].every(object) ||
    !Array.isArray(c.dnsServers) ||
    !Array.isArray(c.staticRoutes) ||
    typeof c.ipRouting !== "boolean" ||
    typeof c.ipv6Routing !== "boolean"
  )
    throw Error("A device configuration is incomplete.");
  if(c.services.dns?.resourceRecords!==undefined){
    if(!Array.isArray(c.services.dns.resourceRecords)||c.services.dns.resourceRecords.length>10000)throw Error('Invalid DNS resource record table.');
    validateDNSRecords(dnsRecords(c.services.dns));
  }
  if(c.features.macAgingTime!==undefined&&(!Number.isInteger(c.features.macAgingTime)||c.features.macAgingTime<0||c.features.macAgingTime>1000000))throw Error('Invalid global MAC aging time.');
  if(c.features.macAgingVlans!==undefined&&(!object(c.features.macAgingVlans)||Object.entries<any>(c.features.macAgingVlans).some(([vlan,seconds])=>!/^\d+$/.test(vlan)||+vlan<1||+vlan>4094||!Number.isInteger(seconds)||seconds!==0&&(seconds<10||seconds>1000000))))throw Error('Invalid VLAN MAC aging time.');
  if (
    c.defaultGateway &&
    !isIPv4(c.defaultGateway) &&
    !isIPv6(c.defaultGateway)
  )
    throw Error("A default gateway is invalid.");
  if (
    c.dnsServers.some(
      (ip: unknown) => typeof ip !== "string" || (!isIPv4(ip) && !isIPv6(ip)),
    )
  )
    throw Error("A DNS server address is invalid.");
  for (const [name, p] of Object.entries(c.interfaces) as [string, any][]) {
    if(p?.features?.speedAuto!==undefined&&typeof p.features.speedAuto!=='boolean')throw Error(`Invalid Ethernet autonegotiation setting on ${name}.`);
    if (
      !object(p) ||
      p.name !== name ||
      typeof p.adminUp !== "boolean" ||
      !Array.isArray(p.ipv6) ||
      !object(p.features) ||
      typeof p.switchport !== "boolean" ||
      !Number.isInteger(p.mtu) ||
      p.mtu < 68 ||
      p.mtu > 65535 ||
      !Number.isFinite(p.speed) ||
      p.speed <= 0
    )
      throw Error(`Invalid interface ${name}.`);
    if (
      !["access", "trunk", "dynamic-auto", "dynamic-desirable"].includes(
        p.mode,
      ) ||
      !["auto", "full", "half"].includes(p.duplex)
    )
      throw Error(`Invalid mode on ${name}.`);
    if (
      ![p.vlan, p.nativeVlan].every(
        (v) => Number.isInteger(v) && v >= 1 && v <= 4094,
      ) ||
      (p.allowedVlans !== null &&
        (!Array.isArray(p.allowedVlans) ||
          p.allowedVlans.some(
            (v: number) => !Number.isInteger(v) || v < 1 || v > 4094,
          )))
    )
      throw Error(`Invalid VLAN on ${name}.`);
    if (p.ip && (typeof p.ip !== "string" || !isIPv4(p.ip)))
      throw Error(`Invalid IPv4 address on ${name}.`);
    if (p.mask) maskToPrefix(p.mask);
    for (const ip of p.ipv6) {
      if (typeof ip !== "string" || !ip.includes(":"))
        throw Error(`Invalid IPv6 address on ${name}.`);
      parseCidr(ip);
    }
  }
  for (const r of c.staticRoutes) {
    if (
      !object(r) ||
      typeof r.network !== "string" ||
      (!isIPv4(r.network) && !isIPv6(r.network)) ||
      !Number.isInteger(r.prefix) ||
      r.prefix < 0 ||
      r.prefix > (r.network.includes(":") ? 128 : 32)
    )
      throw Error("A static route is invalid.");
    if (r.nextHop && !isIPv4(r.nextHop) && !isIPv6(r.nextHop))
      throw Error("A route next hop is invalid.");
  }
  for (const p of Object.values(c.protocols) as any[]) {
    if (!object(p)) throw Error("A protocol configuration is invalid.");
    for (const key of [
      "networks",
      "neighbors",
      "passiveInterfaces",
      "redistribute",
    ])
      if (p[key] !== undefined && !Array.isArray(p[key]))
        throw Error(`Protocol ${key} must be an array.`);
  }
}

/** Validation is deliberately transactional: no current simulator state is touched here. */
export function parseDocument(text: string): LabDocument {
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024)
    throw Error("This lab exceeds the 10 MB file limit.");
  return validateDocument(JSON.parse(text));
}

/** YAML is the portable file format; browser recovery keeps its existing JSON storage. */
export function parseLabFile(text: string): LabDocument {
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024)
    throw Error("This lab exceeds the 10 MB file limit.");
  const yaml = parseYAML(text, {
    version: "1.2", schema: "core", merge: false, resolveKnownTags: false,
    stringKeys: true, uniqueKeys: true,
  });
  const problem = yaml.errors[0] ?? yaml.warnings[0];
  if (problem) throw Error(`Invalid YAML: ${problem.message}`);
  return validateDocument(yaml.toJS({maxAliasCount: 100}));
}

export function serializeLabFile(doc: LabDocument): string {
  // Keep the same portable data model as browser saves: omit undefined fields.
  const portable = validateDocument(JSON.parse(JSON.stringify(doc)));
  const yaml = stringifyYAML(portable, {indent: 2, lineWidth: 0, blockQuote: "literal", aliasDuplicateObjects: false});
  if (new TextEncoder().encode(yaml).byteLength > 10 * 1024 * 1024)
    throw Error("This lab exceeds the 10 MB file limit.");
  return yaml;
}

function validateDocument(doc: any): LabDocument {
  // Literal usernames, filenames and wireless profile names may coincide with
  // JavaScript property names. Only these audited dictionary entry positions
  // permit them; nested configuration property names remain guarded.
  const dictionary=(path:string[]):boolean=>{
    if(path[0]!=='lab'||path[1]!=='devices'||!/^\d+$/.test(path[2]??'')||!['config','startupConfig'].includes(path[3]))return false;
    const tail=path.slice(4);
    if(tail.length===2&&tail[0]==='features'&&['users','files'].includes(tail[1]))return true;
    if(tail.length===3&&tail[0]==='features'&&tail[1]==='snmp'&&['communities','users','groups','views','viewEntries'].includes(tail[2]))return true;
    if(tail.length===3&&tail[0]==='services'&&(['radius','tacacs'].includes(tail[1])&&tail[2]==='users'||['tftp','sshFiles','http'].includes(tail[1])&&tail[2]==='files'))return true;
    if(tail[0]==='features'&&tail[1]==='wireless')return tail.length===3&&['wlans','policies','policyTags','siteTags','rfTags','apProfiles','flexProfiles','rfProfiles','dot1xLists'].includes(tail[2])||tail.length===4&&tail[2]==='policyTags';
    return false;
  };
  const inspect = (value: any, depth = 0,path:string[]=[]) => {
    if (depth > 48) throw Error("The lab contains objects nested too deeply.");
    if (typeof value === "number" && !Number.isFinite(value))
      throw Error("The lab contains a non-finite number.");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)&&!dictionary(path))
        throw Error("The lab contains an unsafe object key.");
      inspect(child, depth + 1,[...path,key]);
    }
  };
  inspect(doc);
  if (doc?.format !== "netsim-lab" || doc?.version !== 1)
    throw Error("Open a NetworkSim version 1 YAML lab (.netsim.yaml).");
  const lab = doc.lab;
  if (
    !lab ||
    typeof lab.id !== "string" ||
    typeof lab.name !== "string" ||
    lab.name.length > 200 ||
    !Array.isArray(lab.devices) ||
    !Array.isArray(lab.links) ||
    !Array.isArray(lab.notes)
  )
    throw Error("The lab is missing its name, devices, links, or notes.");
  if (
    lab.devices.length > 250 ||
    lab.links.length > 300 ||
    lab.notes.length > 100
  )
    throw Error("A lab can have up to 250 devices, 300 links, and 100 notes.");
  const ids = new Set<string>(),
    ports = new Set<string>();
  const id = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !value.length ||
      value.length > 128 ||
      ids.has(value)
    )
      throw Error("Lab IDs must be unique, nonempty text.");
    ids.add(value);
  };
  const position = (v: any) => {
    if (![v.x, v.y].every((n) => Number.isFinite(n) && Math.abs(n) < 1e7))
      throw Error("An item has invalid coordinates.");
  };
  for (const d of lab.devices) {
    id(d.id);
    position(d);
    if (!KINDS.has(d.kind) || typeof d.powered !== "boolean")
      throw Error("A device has an unknown type or power state.");
    validateConfig(d.config);validateEndpoint(d.kind,d.config);validatePhone(d.kind,d.config);validatePoE(d.kind,d.config);
    validateWireless(d.kind,d.config.features.wireless);
    if (d.startupConfig !== undefined) {validateConfig(d.startupConfig);validateEndpoint(d.kind,d.startupConfig);validatePhone(d.kind,d.startupConfig);validatePoE(d.kind,d.startupConfig);validateWireless(d.kind,d.startupConfig.features.wireless);}
    if (d.configurationRegister !== undefined && !['current','next'].every(key=>Number.isInteger(d.configurationRegister[key])&&d.configurationRegister[key]>=0&&d.configurationRegister[key]<=65535))
      throw Error("A device has an invalid configuration register.");
    d.runtime = emptyRuntime();
  }
  for (const link of lab.links) {
    validateLinkMedium(link.physical);
    id(link.id);
    for (const ep of [link.a, link.b]) {
      const d = lab.devices.find((v: any) => v.id === ep?.deviceId);
      if (!d?.config.interfaces[ep?.port])
        throw Error("A link references a missing device or interface.");
      if (/^Wireless/i.test(ep.port))
        throw Error("Wireless associations cannot be stored as physical cables.");
      const key = `${ep.deviceId}:${ep.port}`;
      if (ports.has(key)) throw Error("Two cables use the same interface.");
      ports.add(key);
    }
    if (
      link.a.deviceId === link.b.deviceId ||
      !Number.isFinite(link.delay) ||
      link.delay < 0 ||
      !Number.isFinite(link.loss) ||
      link.loss < 0 ||
      link.loss > 1 ||
      [link.lossAB, link.lossBA].some(
        (v) => v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1),
      ) ||
      typeof link.enabled !== "boolean"
    )
      throw Error("A link has invalid endpoints, latency, or loss.");
  }
  for (const n of lab.notes) {
    id(n.id);
    position(n);
    if (typeof n.text !== "string" || n.text.length > 2000 || (n.locked !== undefined && typeof n.locked !== "boolean"))
      throw Error("A note is invalid or too long.");
  }
  if (lab.lesson !== undefined) validateLesson(lab.lesson);
  if (!Number.isInteger(doc.seed)) doc.seed = 0x24ca9e13;
  return doc;
}
export function listSaved(): SavedLab[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const values = JSON.parse(raw);
  if (
    !Array.isArray(values) ||
    values.some(
      (v) =>
        !v ||
        typeof v.id !== "string" ||
        typeof v.name !== "string" ||
        !Number.isFinite(v.savedAt) ||
        !v.document,
    )
  )
    throw Error(
      "Saved-lab storage is damaged. Export your current lab before clearing browser data.",
    );
  return values;
}
export function saveLocal(doc: LabDocument, id = doc.lab.id): void {
  const labs = listSaved().filter((l) => l.id !== id);
  labs.unshift({ id, name: doc.lab.name, savedAt: Date.now(), document: doc });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labs));
}

/** The active workspace is independent of the user's named lab snapshots. */
export function loadWorkspace(storage: Pick<Storage, "getItem"> = localStorage): LabDocument | null {
  const raw = storage.getItem(WORKSPACE_KEY);
  return raw === null ? null : parseDocument(raw);
}
export function saveWorkspace(doc: LabDocument, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(WORKSPACE_KEY, JSON.stringify(doc));
}
export function deleteLocal(id: string): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(listSaved().filter((l) => l.id !== id)),
  );
}
export function download(
  name: string,
  data: string,
  type = "application/yaml",
): void {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export function fileName(name: string): string {
  return (
    (name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Untitled lab") +
    ".netsim.yaml"
  );
}

export function renameLocal(id: string, name: string): void {
  if (!name.trim() || name.length > 200)
    throw Error("Use a name from 1–200 characters.");
  const labs = listSaved();
  const lab = labs.find((l) => l.id === id);
  if (!lab) throw Error("The saved lab no longer exists.");
  lab.name = name.trim();
  lab.document.lab.name = lab.name;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labs));
}
