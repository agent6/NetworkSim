import type { Lab, Device } from "./model.ts";
import type { Simulator } from "./engine.ts";
import { isIPv4, isIPv6, ipToInt, inSubnet, maskToPrefix, sameAddress } from "./ip.ts";
import {switchingPeer} from './switching-messages.ts';
import {poeSettings,poePort} from './poe.ts';
import {endpointVoicePolicy, endpointNetworkPort} from './endpoint.ts';
import {ospfLiveDetail} from './ospf-packets.ts';
import {localSSHLoginSnapshot} from './management.ts';
import {ownRecordValue} from './record-map.ts';
import {validPortSecurityCriterion,matchesPortSecurityCriterion,type PortSecurityCriterion} from './port-security-lab.ts';
import {validRAGuardCriterion,matchesRAGuardCriterion,type RAGuardCriterion} from './ra-guard-lab.ts';
import {validStormCriterion,matchesStormCriterion,type StormCriterion} from './storm-control-lab.ts';
import {validARPInspectionCriterion,matchesARPInspectionCriterion,type ARPInspectionCriterion} from './arp-inspection-lab.ts';
import {validSnoopingCriterion,matchesSnoopingCriterion,type SnoopingCriterion} from './dhcp-snooping-lab.ts';
import {validACLLabCriterion,matchesACLLabCriterion,type ACLLabCriterion} from './acl-lab.ts';
import {validNATCriterion,matchesNATCriterion,type NATCriterion} from './nat-lab.ts';
import {validFileTransferCriterion,matchesFileTransferCriterion,type FileTransferCriterion} from './file-transfer-lab.ts';
import {validAAAClientCriterion,matchesAAAClientCriterion,type AAAClientCriterion} from './aaa-lab.ts';

export type Criterion =
  | AAAClientCriterion
  | FileTransferCriterion
  | NATCriterion
  | ACLLabCriterion
  | SnoopingCriterion
  | ARPInspectionCriterion
  | StormCriterion
  | RAGuardCriterion
  | PortSecurityCriterion
  | { kind: "all" | "any"; criteria: Criterion[] }
  | { kind: "local-user"; device: string; username: string; privilege: number }
  | { kind: "local-management"; device: string; setting: "enable-secret" | "console-login" | "ssh-server" | "vty-login" }
  | { kind: "local-ssh-login"; device: string; source: string; username: string; privilege: number }
  | { kind: "device"; device: string; powered?: boolean }
  | { kind: "interface-up"; device: string; interface: string }
  | { kind: "ip-routing"; device: string; enabled: boolean }
  | { kind: "ipv6-routing"; device: string; enabled: boolean }
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
      nextHop?: string;
      interface?: string;
      ad?: number;
      metric?: number;
    }
  | { kind: "static-route"; device: string; network: string; prefix: number; nextHop: string; interface: string; ad: number }
  | { kind: "neighbor"; device: string; protocol: string; state?: string; peer?: string; interface?: string }
  | { kind: "ospf-interface"; device: string; interface: string; protocol?: "ospf" | "ospfv3"; configuredRouterId?: string | null; processId?: number; routerId?: string; area?: number; passive?: boolean; networkType?: "broadcast" | "point-to-point"; configuredCost?: number; configuredPriority?: number; role?: "DR" | "BDR" | "DROTHER" | "POINT-TO-POINT" }
  | { kind: "discovery-settings"; device: string; protocol: "CDP" | "LLDP"; enabled: boolean; interval?: number; holdtime?: number }
  | { kind: "discovery-neighbor"; device: string; protocol: "CDP" | "LLDP"; interface: string; peer: string; peerInterface: string }
  | { kind: "echo"; device: string; from: string }
  | { kind: "bpdu-guard-trip"; device: string; interface: string }
  | { kind: "root-guard-block"; device: string; interface: string; vlan: number }
  | { kind: "loop-guard-block"; device: string; interface: string; vlan: number }
  | { kind: "link-loss"; device: string; interface: string; receive: number; transmit: number }
  | { kind: "vlan"; device: string; id: number }
  | { kind: "lacp-bundle"; device: string; group: number; peer: string; members: string[] }
  | { kind: "stp-forwarding"; device: string; interface: string; vlans: number[] }
  | { kind: "stp-mode"; device: string; mode: "pvst" | "rapid-pvst" | "mst" }
  | { kind: "stp-priority"; device: string; vlan: number; priority: number }
  | { kind: "stp-root"; device: string; vlan: number; root: string }
  | { kind: "stp-port"; device: string; vlan: number; interface: string; role: "root" | "designated" | "alternate"; state: "forwarding" | "blocking"; rapid?: boolean }
  | { kind: "trunk-allowed"; device: string; interface: string; vlans: number[] }
  | { kind: "poe-interface"; device: string; interface: string; mode: "auto" | "never"; max: number; priority: "high" | "low" }
  | { kind: "poe-supply"; device: string; switch: string; interface: string; watts: number; standard: "802.3af" | "802.3at"; class: 3 | 4; spatialStreams?: 2 | 4; usb?: boolean }
  | { kind: "voice-policy"; device: string; vlan: number }
  | { kind: "mac-learned"; device: string; interface: string; source: string; sourceInterface: string; vlan: number }
  | {
      kind: "interface";
      device: string;
      interface: string;
      property: "adminUp" | "vlan" | "voiceVlan" | "nativeVlan" | "nonegotiate" | "channelGroup" | "channelMode" | "mode" | "mtu" | "ip" | "mask" | "description" | "switchport" | "ipv4Addressed" | "duplex" | "portfast" | "bpduguard" | "rootGuard" | "loopGuard" | "errDisabled" | "speedAuto" | "cdp" | "lldpTransmit" | "lldpReceive";
      value: string | number | boolean;
    };
export interface Objective {
  id: string;
  title: string;
  description?: string;
  criterion: Criterion;
  action?: {kind:"slaac";device:string;interface:string;when?:Criterion} | {kind:"traffic";device:string;interface:string;traffic:"broadcast"|"multicast"|"unicast";when?:Criterion} | {kind:"arp";device:string;interface:string;address:string;when?:Criterion} | { kind: "ping"; device: string; target: string; expect?:"blocked"; when?: Criterion } | { kind: "dhcp"; device: string; interface: string; when?: Criterion };
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
      case "ps-config":
      case "ps-binding":
      case "ps-saved":
      case "ps-incident":
      case "ps-ping":
        return validPortSecurityCriterion(v);
      case "ra-policy":
      case "ra-attachment":
      case "ra-block":
      case "ra-client":
      case "ra-ping":
      case "ra-protected-gateway":
      case "ra-neighbor":
        return validRAGuardCriterion(v);
      case "storm-policy":
      case "storm-recovery":
      case "storm-drop":
      case "storm-ping":
        return validStormCriterion(v);
      case "dai-vlan":
      case "dai-trust":
      case "dai-rate":
      case "dai-static-acl":
      case "dai-frame":
      case "arp-neighbor":
        return validARPInspectionCriterion(v);
      case "dhcp-snooping":
      case "snooping-trust":
      case "snooping-rate":
      case "snooping-binding":
      case "snooping-option82":
      case "snooping-ping":
      case "snooping-rogue-drop":
        return validSnoopingCriterion(v);
      case "standard-acl":
      case "extended-acl":
      case "acl-binding":
      case "acl-ping":
      case "acl-http":
      case "acl-dns":
        return validACLLabCriterion(v);
      case "nat-interface":
      case "nat-static":
      case "nat-ping":
      case "nat-http":
      case "nat-outbound-http":
      case "pat-acl":
      case "pat-rule":
      case "pat-sharing":
        return validNATCriterion(v);
      case "scp-server":
      case "ssh-file-client":
      case "file-transfer":
      case "file-copy":
        return validFileTransferCriterion(v);
      case "device":
        return v.powered === undefined || typeof v.powered === "boolean";
      case "tacacs-server":
      case "radius-server":
      case "aaa-group":
      case "aaa-method":
      case "aaa-line":
      case "tacacs-session":
      case "radius-session":
        return validAAAClientCriterion(v);
      case "local-user":
      case "local-ssh-login":
        return text(v.username,128) && v.username!=="" && Number.isInteger(v.privilege) && v.privilege>=0 && v.privilege<=15 && (v.kind!=="local-ssh-login" || text(v.source,128) && v.source!=="");
      case "local-management":
        return ["enable-secret","console-login","ssh-server","vty-login"].includes(v.setting);
      case "interface-up":
        return text(v.interface,128);
      case "bpdu-guard-trip":
        return text(v.interface,128) && v.interface!=="";
      case "root-guard-block":
      case "loop-guard-block":
        return text(v.interface,128) && v.interface!=="" && Number.isInteger(v.vlan) && v.vlan>=1 && v.vlan<=4094;
      case "link-loss":
        return text(v.interface,128) && v.interface!=="" && [v.receive,v.transmit].every(n=>Number.isFinite(n) && n>=0 && n<=1);
      case "ip-routing":
      case "ipv6-routing":
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
          (v.protocol === undefined || text(v.protocol, 40)) &&
          (v.nextHop === undefined || address(v.nextHop)) &&
          (v.interface === undefined || text(v.interface,128) && v.interface!=="") &&
          (v.ad === undefined || Number.isInteger(v.ad) && v.ad>=0 && v.ad<=255) &&
          (v.metric === undefined || Number.isSafeInteger(v.metric) && v.metric>=0)
        );
      case "static-route":
        return address(v.network) && Number.isInteger(v.prefix) && v.prefix>=0 && v.prefix<=(v.network.includes(':')?128:32) && address(v.nextHop) && v.network.includes(':')===v.nextHop.includes(':') && text(v.interface,128) && v.interface!=="" && Number.isInteger(v.ad) && v.ad>=1 && v.ad<=255;
      case "neighbor":
        return (
          text(v.protocol, 40) && (v.state === undefined || text(v.state, 40)) &&
          (v.peer === undefined || text(v.peer,128) && v.peer!=="") &&
          (v.interface === undefined || text(v.interface,128) && v.interface!=="")
        );
      case "ospf-interface":
        return (v.protocol===undefined || ["ospf","ospfv3"].includes(v.protocol)) && text(v.interface,128) && v.interface!=="" &&
          (v.configuredRouterId===undefined || v.configuredRouterId===null || typeof v.configuredRouterId==='string' && isIPv4(v.configuredRouterId) && v.configuredRouterId!=='0.0.0.0') &&
          (v.processId===undefined || Number.isInteger(v.processId) && v.processId>=1 && v.processId<=65535) &&
          (v.routerId===undefined || typeof v.routerId==='string' && isIPv4(v.routerId)) &&
          (v.area===undefined || Number.isInteger(v.area) && v.area>=0 && v.area<=4294967295) &&
          (v.passive===undefined || typeof v.passive==='boolean') &&
          (v.networkType===undefined || ['broadcast','point-to-point'].includes(v.networkType)) &&
          (v.configuredCost===undefined || Number.isInteger(v.configuredCost) && v.configuredCost>=1 && v.configuredCost<=65535) &&
          (v.configuredPriority===undefined || Number.isInteger(v.configuredPriority) && v.configuredPriority>=0 && v.configuredPriority<=255) &&
          (v.role===undefined || ["DR","BDR","DROTHER","POINT-TO-POINT"].includes(v.role));
      case "discovery-settings":
        return ["CDP","LLDP"].includes(v.protocol) && typeof v.enabled==="boolean" && (v.interval===undefined || Number.isInteger(v.interval) && v.interval>=5 && v.interval<=(v.protocol==="CDP"?255:65535)) && (v.holdtime===undefined || Number.isInteger(v.holdtime) && v.holdtime>=1 && v.holdtime<=(v.protocol==="CDP"?255:65535));
      case "discovery-neighbor":
        return ["CDP","LLDP"].includes(v.protocol) && [v.interface,v.peer,v.peerInterface].every(s=>text(s,128) && s!=="");
      case "vlan":
        return Number.isInteger(v.id) && v.id >= 1 && v.id <= 4094;
      case "lacp-bundle":
        return Number.isInteger(v.group) && v.group>=1 && v.group<=4096 && text(v.peer,128) && Array.isArray(v.members) && v.members.length>0 && v.members.length<=32 && v.members.every((p:unknown)=>text(p,128) && p!=="") && new Set(v.members).size===v.members.length;
      case "stp-mode":
        return ["pvst","rapid-pvst","mst"].includes(v.mode);
      case "stp-priority":
        return Number.isInteger(v.vlan) && v.vlan>=1 && v.vlan<=4094 && Number.isInteger(v.priority) && v.priority>=0 && v.priority<=61440 && v.priority%4096===0;
      case "stp-root":
        return Number.isInteger(v.vlan) && v.vlan>=1 && v.vlan<=4094 && text(v.root,128) && v.root!=="";
      case "stp-port":
        return Number.isInteger(v.vlan) && v.vlan>=1 && v.vlan<=4094 && text(v.interface,128) && v.interface!=="" && ["root","designated","alternate"].includes(v.role) && ["forwarding","blocking"].includes(v.state) && (v.rapid===undefined || typeof v.rapid==="boolean");
      case "stp-forwarding":
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
        if (["switchport","ipv4Addressed","portfast","bpduguard","rootGuard","loopGuard","errDisabled","speedAuto","nonegotiate","cdp","lldpTransmit","lldpReceive"].includes(v.property)) return typeof v.value === "boolean";
        if (v.property === "description") return text(v.value,240);
        if (v.property === "channelGroup") return Number.isInteger(v.value) && v.value>=1 && v.value<=4096;
        if (v.property === "channelMode") return ["active","passive","on","desirable","auto"].includes(v.value);
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
        !["ping","dhcp","arp","traffic","slaac"].includes(o.action.kind) ||
        !text(o.action.device, 128) ||
        (o.action.kind === "ping" ? !address(o.action.target) : !text(o.action.interface,128) || (o.action.kind === "arp" && !isIPv4(o.action.address)) || (o.action.kind === "traffic" && !["broadcast","multicast","unicast"].includes(o.action.traffic))) ||
        (o.action.kind === "ping" && o.action.expect !== undefined && o.action.expect !== "blocked") ||
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
    (action.kind === "ping" || sim.interfaceUp(device(sim,action.device)!.id,action.interface)) &&
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
  if (['ps-config','ps-binding','ps-saved','ps-incident','ps-ping'].includes(criterion.kind))return matchesPortSecurityCriterion(sim,d,criterion as PortSecurityCriterion);
  if (['ra-policy','ra-attachment','ra-block','ra-client','ra-ping','ra-protected-gateway','ra-neighbor'].includes(criterion.kind))return matchesRAGuardCriterion(sim,d,criterion as RAGuardCriterion);
  if (['storm-policy','storm-recovery','storm-drop','storm-ping'].includes(criterion.kind))return matchesStormCriterion(sim,d,criterion as StormCriterion);
  if (['dai-vlan','dai-trust','dai-rate','dai-static-acl','dai-frame','arp-neighbor'].includes(criterion.kind))return matchesARPInspectionCriterion(sim,d,criterion as ARPInspectionCriterion);
  if (['tacacs-server','radius-server','aaa-group','aaa-method','aaa-line','tacacs-session','radius-session'].includes(criterion.kind))return matchesAAAClientCriterion(sim,d,criterion as AAAClientCriterion);
  if (['dhcp-snooping','snooping-trust','snooping-rate','snooping-binding','snooping-option82','snooping-ping','snooping-rogue-drop'].includes(criterion.kind))return matchesSnoopingCriterion(sim,d,criterion as SnoopingCriterion);
  if (['standard-acl','extended-acl','acl-binding','acl-ping','acl-http','acl-dns'].includes(criterion.kind))return matchesACLLabCriterion(sim,d,criterion as ACLLabCriterion);
  if (['nat-interface','nat-static','nat-ping','nat-http','nat-outbound-http','pat-acl','pat-rule','pat-sharing'].includes(criterion.kind))return matchesNATCriterion(sim,d,criterion as NATCriterion);
  if (['scp-server','ssh-file-client','file-transfer','file-copy'].includes(criterion.kind))return matchesFileTransferCriterion(sim,d,criterion as FileTransferCriterion);
  if (criterion.kind === "local-user") {
    const user=ownRecordValue(d.config.features.users,criterion.username);
    return !!user && typeof user.secret==='string' && user.secret.length>0 && (user.privilege??1)===criterion.privilege;
  }
  if (criterion.kind === "local-management") {
    const f=d.config.features;
    if(criterion.setting==='enable-secret')return typeof f.enableSecret==='string' && f.enableSecret.length>0;
    if(criterion.setting==='ssh-server')return typeof f.domainName==='string' && !!f.domainName.trim() && f.ssh?.version===2 && Number(f.ssh?.keys?.modulus)>=2048;
    if(f.aaa?.enabled)return false;
    if(criterion.setting==='console-login')return f.lines?.['console 0']?.login==='local';
    const lines=Object.entries<any>(f.lines??{}).filter(([name])=>/^vty \d+(?: \d+)?$/.test(name));
    const enabled=lines.filter(([,line])=>line.exec!==false && !['none',''].includes(String(line.transport??'')));
    const safe=(line:any)=>line.login==='local' && line.transport==='ssh';
    return enabled.every(([,line])=>safe(line)) && [0,1,2,3,4].every(n=>enabled.some(([name,line])=>{const [,start,end]=name.split(' ').map(Number);return safe(line) && start<=n && n<=(end??start);}));
  }
  if (criterion.kind === "local-ssh-login") {
    const source=device(sim,criterion.source);
    return !!source && localSSHLoginSnapshot(sim,d.id).some(row=>row.username===criterion.username && row.privilege===criterion.privilege && Object.values(source.config.interfaces).some(p=>!!p.ip && sameAddress(p.ip,row.source)));
  }
  if (criterion.kind === "stp-mode") return ["switch","poeswitch","l3switch","datacenter"].includes(d.kind) && (d.config.features.stp?.mode??"rapid-pvst")===criterion.mode;
  if (criterion.kind === "stp-priority") return ["switch","poeswitch","l3switch","datacenter"].includes(d.kind) && (d.config.features.stp?.vlanPriorities?.[criterion.vlan]??d.config.features.stp?.priority??32768)===criterion.priority;
  if (criterion.kind === "stp-root") {
    const root=device(sim,criterion.root);
    return !!root && d.powered && d.runtime.stp[String(criterion.vlan)]?.rootId===root.id;
  }
  if (criterion.kind === "stp-port") {
    const tree=d.runtime.stp[String(criterion.vlan)],port=tree?.ports[criterion.interface];
    return sim.interfaceUp(d.id,criterion.interface) && port?.role===criterion.role && port.state===criterion.state && (criterion.rapid===undefined || (tree.mode==="rapid-pvst" && !d.runtime.features.stpLegacy?.[criterion.interface] && port.linkType==="point-to-point")===criterion.rapid);
  }
  if (criterion.kind === "discovery-settings") {
    const cdp=criterion.protocol==="CDP",settings=d.config.features.discovery?.[cdp?"cdp":"lldp"]??{},enabled=cdp?d.config.features.cdp!==false:!!d.config.features.lldp;
    return enabled===criterion.enabled && (criterion.interval===undefined || (settings.interval??(cdp?60:30))===criterion.interval) && (criterion.holdtime===undefined || (settings.holdtime??(cdp?180:120))===criterion.holdtime);
  }
  if (criterion.kind === "discovery-neighbor") {
    const peer=device(sim,criterion.peer),now=sim.clock.now();
    return !!peer?.config.interfaces[criterion.peerInterface] && sim.interfaceUp(d.id,criterion.interface) && Object.values<any>(d.runtime.features.discoveryNeighbors??{}).some(row=>row.protocol===criterion.protocol && row.interface===criterion.interface && row.deviceId===peer.id && row.peerInterface===criterion.peerInterface && row.state==="UP" && Number.isFinite(row.expires) && row.expires>now && Number.isFinite(row.lastReceived) && row.lastReceived<=now);
  }
  if (criterion.kind === "lacp-bundle") {
    const channel=d.runtime.features.portChannels?.[criterion.group],peer=device(sim,criterion.peer);
    return !!peer && channel?.protocol==="lacp" && channel.state==="up" && channel.peerDeviceId===peer.id && sim.interfaceUp(d.id,`Port-channel${criterion.group}`) && channel.activeMembers.length===criterion.members.length && criterion.members.every(name=>{
      const port=d.config.interfaces[name],partner=switchingPeer(sim,d.id,name,'LACP');
      return port?.features.channelGroup===criterion.group && ["active","passive"].includes(port.features.channelMode) && channel.activeMembers.includes(name) && partner?.deviceId===peer.id && partner.synchronized===true && partner.partner?.deviceId===d.id && partner.partner?.port===name && partner.partner?.group===criterion.group;
    });
  }
  if (criterion.kind === "stp-forwarding") return sim.interfaceUp(d.id,criterion.interface) && criterion.vlans.every(v=>d.runtime.stp[String(v)]?.ports[criterion.interface]?.state==="forwarding");
  if (criterion.kind === "interface-up") return sim.interfaceUp(d.id,criterion.interface);
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
  if (criterion.kind === "ipv6-routing") return d.config.ipv6Routing === criterion.enabled;
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
  if (criterion.kind === "static-route")
    return d.config.staticRoutes.some(r=>!r.vrf && sameAddress(r.network,criterion.network) && r.prefix===criterion.prefix && !!r.nextHop && sameAddress(r.nextHop,criterion.nextHop) && r.interface===criterion.interface && (r.ad??1)===criterion.ad);
  if (criterion.kind === "route")
    return d.runtime.routes.some(
      (r) =>
        sameAddress(r.network, criterion.network) &&
        r.prefix === criterion.prefix &&
        (!criterion.protocol ||
          r.protocol.toLowerCase() === criterion.protocol.toLowerCase()) &&
        (criterion.nextHop === undefined || !!r.nextHop && sameAddress(r.nextHop,criterion.nextHop)) &&
        (criterion.interface === undefined || r.interface===criterion.interface) &&
        (criterion.ad === undefined || r.ad===criterion.ad) &&
        (criterion.metric === undefined || r.metric===criterion.metric),
    );
  if (criterion.kind === "ospf-interface") {
    if(!sim.devicePowered(d.id) || !sim.interfaceUp(d.id,criterion.interface))return false;
    const protocol=criterion.protocol??'ospf';
    const row=ospfLiveDetail(sim,d.id,protocol)?.interfaces.find(p=>p.name===criterion.interface && !p.vrf);
    return !!row &&
      (criterion.configuredRouterId===undefined || (criterion.configuredRouterId===null?!d.config.protocols[protocol]?.routerId:sameAddress(d.config.protocols[protocol]?.routerId??'',criterion.configuredRouterId))) &&
      (criterion.processId===undefined || Number(d.config.protocols[protocol]?.processId)===criterion.processId) &&
      (criterion.routerId===undefined || sameAddress(row.routerId,criterion.routerId)) &&
      (criterion.area===undefined || Number(row.area)===criterion.area) &&
      (criterion.passive===undefined || !!row.passive===criterion.passive) &&
      (criterion.networkType===undefined || (row.networkType??'broadcast')===criterion.networkType) &&
      (criterion.configuredCost===undefined || d.config.interfaces[criterion.interface]?.features[protocol]?.cost===criterion.configuredCost) &&
      (criterion.configuredPriority===undefined || d.config.interfaces[criterion.interface]?.features[protocol]?.priority===criterion.configuredPriority) &&
      (criterion.role===undefined || row.role===criterion.role);
  }
  if (criterion.kind === "neighbor")
    return d.runtime.neighbors.some(
      (n) =>
        n.protocol.toLowerCase() === criterion.protocol.toLowerCase() &&
        (!criterion.state ||
          n.state.toLowerCase() === criterion.state.toLowerCase()) &&
        (criterion.peer===undefined || n.deviceId===device(sim,criterion.peer)?.id) &&
        (criterion.interface===undefined || n.interface===criterion.interface),
    );
  if (criterion.kind === "link-loss") {
    const link=sim.linkAt(d.id,criterion.interface);if(!link?.enabled)return false;
    const a=link.a.deviceId===d.id && link.a.port===criterion.interface;
    return ((a?link.lossBA:link.lossAB)??link.loss)===criterion.receive && ((a?link.lossAB:link.lossBA)??link.loss)===criterion.transmit;
  }
  if (criterion.kind === "loop-guard-block") {
    const port=d.runtime.stp[String(criterion.vlan)]?.ports[criterion.interface];
    return sim.interfaceUp(d.id,criterion.interface) && d.config.interfaces[criterion.interface]?.features.loopGuard===true && port?.role==='loop-inconsistent' && port.state==='blocking' && d.runtime.features.stpCounters?.[criterion.interface]?.received>0;
  }
  if (criterion.kind === "root-guard-block") {
    const port=d.runtime.stp[String(criterion.vlan)]?.ports[criterion.interface];
    return sim.interfaceUp(d.id,criterion.interface) && d.config.interfaces[criterion.interface]?.features.rootGuard===true && port?.role==='root-inconsistent' && port.state==='blocking' && d.runtime.features.stpCounters?.[criterion.interface]?.received>0;
  }
  if (criterion.kind === "bpdu-guard-trip")
    return sim.events.some(e=>e.nodeId===d.id && e.port===criterion.interface && e.protocol==='STP' && e.label==='BPDU guard err-disable' && e.disposition==='drop');
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
    const value=(criterion.property==="cdp"||criterion.property==="lldpTransmit"||criterion.property==="lldpReceive")?port.features[criterion.property]!==false:criterion.property==="ipv4Addressed"?!!(port.ip||port.features.secondaryIps?.length||port.features.dhcp):criterion.property==="channelGroup"?port.features.channelGroup:criterion.property==="channelMode"?port.features.channelMode:criterion.property==="nonegotiate"?port.features.nonegotiate===true:criterion.property==="portfast"?port.features.portfast===true:criterion.property==="bpduguard"?port.features.bpduguard===true:criterion.property==="rootGuard"?port.features.rootGuard===true:criterion.property==="loopGuard"?port.features.loopGuard===true:criterion.property==="errDisabled"?port.features.errDisabled===true:criterion.property==="speedAuto"?port.features.speedAuto!==false:criterion.property==="voiceVlan"?port.features.voiceVlan:port[criterion.property];
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
    if (c.kind !== "echo" && c.kind !== "bpdu-guard-trip" && c.kind !== "root-guard-block" && c.kind !== "loop-guard-block" && c.kind !== "local-ssh-login" && c.kind !== "tacacs-session" && c.kind !== "radius-session" && c.kind !== "file-transfer" && c.kind !== "nat-ping" && c.kind !== "nat-http" && c.kind !== "nat-outbound-http" && c.kind !== "pat-sharing" && c.kind !== "acl-ping" && c.kind !== "acl-http" && c.kind !== "acl-dns" && c.kind !== "snooping-ping" && c.kind !== "snooping-rogue-drop" && c.kind !== "dai-frame" && c.kind !== "storm-drop" && c.kind !== "storm-ping" && c.kind !== "ra-block" && c.kind !== "ra-ping" && c.kind !== "ps-incident" && c.kind !== "ps-ping") return result;
    validKeys.add(key);
    if (result) observations.add(key);
    return result || observations.has(key);
  };
  const rows = lesson.objectives.map((objective) => {
    const observed = observe(objective.criterion, JSON.stringify(objective.id));
    // Traffic, login and fault observations record accomplishments; configuration stays live.
    const historical=objective.criterion.kind === "echo" || objective.criterion.kind === "bpdu-guard-trip" || objective.criterion.kind === "root-guard-block" || objective.criterion.kind === "loop-guard-block" || objective.criterion.kind === "local-ssh-login" || objective.criterion.kind === "tacacs-session" || objective.criterion.kind === "radius-session" || objective.criterion.kind === "file-transfer" || objective.criterion.kind === "nat-ping" || objective.criterion.kind === "nat-http" || objective.criterion.kind === "nat-outbound-http" || objective.criterion.kind === "pat-sharing" || objective.criterion.kind === "acl-ping" || objective.criterion.kind === "acl-http" || objective.criterion.kind === "acl-dns" || objective.criterion.kind === "snooping-ping" || objective.criterion.kind === "snooping-rogue-drop" || objective.criterion.kind === "dai-frame" || objective.criterion.kind === "storm-drop" || objective.criterion.kind === "storm-ping" || objective.criterion.kind === "ra-block" || objective.criterion.kind === "ra-ping" || objective.criterion.kind === "ps-incident" || objective.criterion.kind === "ps-ping";
    if (historical && observed)
      completed.add(objective.id);
    return {
      objective,
      complete:
        observed ||
        (historical && completed.has(objective.id)),
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
