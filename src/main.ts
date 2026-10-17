import {showPhone} from './phone-ui.ts';
import {endpointUsesPoE,validateEndpoint} from './endpoint.ts';
import {linkMediumFields,readLinkMedium} from './link-medium.ts';
import {showNetworkTools} from './network-tools-ui.ts';
import{showPoE}from'./poe-ui.ts';
import{showSimulation}from'./simulation-ui.ts';
import projectLogo from './assets/networksim-logo.png';
import{showWireless}from'./wireless-ui.ts';
import{wirelessConfig}from'./wireless-model.ts';
import { layoutLinks, orderedPairLinks, shortInterface, type LinkLayout, type PortLabel } from "./link-layout.ts";
import { LinkActivity, portIndicator } from "./link-indicators.ts";
import { setupTooltips } from "./tooltips.ts";
import { nodeIconDefinitions } from "./node-icons.ts";
import { alignMove, type AlignmentGuide, type AlignmentItem } from "./alignment.ts";
import { Simulator } from "./engine.ts";
import { IOSSession, CLI_CAPABILITIES } from "./cli.ts";
import { terminalRows, terminalPage, terminalCompletionEdit } from "./ios-terminal.ts";
import { CONTROL_PLANE_CAPABILITIES } from "./control-plane.ts";
import { isIPv6, parseCidr } from "./ip.ts";
import { showServices } from "./services-ui.ts";
import { basicAuthorization, type HTTPRequestOptions } from "./http-service.ts";
import {
  type Device,
  type DeviceKind,
  type LabDocument,
  type Link,
} from "./model.ts";
import { icon, deviceLabels, escapeHTML as esc } from "./icons.ts";
import {
  parseDocument,
  parseLabFile,
  serializeLabFile,
  listSaved,
  saveLocal,
  loadWorkspace,
  saveWorkspace,
  deleteLocal,
  renameLocal,
  download,
  fileName,
  type Viewport,
} from "./persistence.ts";

const projectFavicon = document.createElement('link');
projectFavicon.rel = 'icon';
projectFavicon.type = 'image/png';
projectFavicon.href = projectLogo;
document.head.append(projectFavicon);

const sim = new Simulator();
const THEME_KEY = 'network-sim.theme.v1';
let colorTheme: 'light' | 'dark' = 'light';
try { if (localStorage.getItem(THEME_KEY) === 'dark') colorTheme = 'dark'; } catch { /* The toggle also works when browser storage is unavailable. */ }
document.documentElement.dataset.theme = colorTheme;
document.documentElement.style.colorScheme = colorTheme;
const linkActivity = new LinkActivity();
const $ = <T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T => parent.querySelector(selector)!;
const $$ = <T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T[] => [...parent.querySelectorAll<T>(selector)];
const app = $("#app");
const kinds: DeviceKind[] = ["router", "switch", "l3switch", "poeswitch", "pc", "server", "wlc", "ap", "laptop", "phone"];
const kindDescriptions = [
  "Routing & WAN",
  "VLANs & switching",
  "Multilayer switching",
  "Switching & PoE power",
  "End-user workstation",
  "Network services",
  "Wireless LAN controller",
  "Lightweight dual-band AP",
  "Wireless workstation",
  "PoE voice VLAN endpoint & PC passthrough",
];
const paletteLabels: Partial<Record<DeviceKind, string>> = {
  switch: 'L2 switch', l3switch: 'L3 switch', ap: 'Access point', laptop: 'Laptop',
};
const selected = new Set<string>();
type TerminalSession = {
  cli: IOSSession;
  lines: string[];
  history: string[];
  cursor: number;
  pending?: string[];
  pageStart?: number;
  pageEcho?: string[];
  pendingDraft?: {value:string;start:number;end:number};
  draft?: string;
  draftStart?: number;
  draftEnd?: number;
  historyDraft?: string;
  scrollTop?: number;
  scrollLeft?: number;
};
const sessions = new Map<string, TerminalSession>();
const undoStack: string[] = [],
  redoStack: string[] = [];
let viewport: Viewport = { x: 70, y: 60, scale: 1 };
let tool: "select" | "link" | "note" = "select";
let linkStart: string | null = null,
  selectedLink: string | null = null,
  activeDevice: string | null = null;
let inspectorOpen = false,
  dockHeight = Math.min(340, Math.round(innerHeight * 0.38)),
  dockOpen = false,
  dockMaximized = false;
let renderedSession: string | null = null;
let lastSessionMarkup = "";
let alignmentGuides: AlignmentGuide[] = [];
let noteEdit: { id?: string; x: number; y: number; element: HTMLElement } | null = null;
let playing = true,
  dirty = true,
  dirtyFile = false,
  lastAutosave = 0;
let lastWorkspaceSnapshot = "", workspaceError = "";
let clipboard: any = null;
let spaceHeld = false,
  toastTimer: ReturnType<typeof setTimeout> | undefined;
let lastFocus: HTMLElement | null = null;
let escapeArmed: string | null = null;
let terminalMetaArmed: string | null = null;
const touchPoints = new Map<number, { x: number; y: number }>();
let pinch: {
  distance: number;
  center: { x: number; y: number };
  view: Viewport;
} | null = null;
let longPress: ReturnType<typeof setTimeout> | undefined;
let hoveredLink: string | null = null;
let linkLayoutSignature = "", linkLayouts: LinkLayout[] = [], lastLinkDetails = "";
let lastTopologyMarkup = "",
  lastInspectorMarkup = "";
function patchElement(current: Element, next: Element) {
  for (const attr of [...current.attributes])
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of [...next.attributes])
    if (current.getAttribute(attr.name) !== attr.value)
      current.setAttribute(attr.name, attr.value);
  const oldChildren = [...current.childNodes], newChildren = [...next.childNodes];
  newChildren.forEach((child, index) => {
    const old = oldChildren[index];
    if (!old) current.append(child);
    else if (old.nodeType !== child.nodeType || old.nodeName !== child.nodeName)
      current.replaceChild(child, old);
    else if (old instanceof Element && child instanceof Element) patchElement(old, child);
    else if (old.textContent !== child.textContent) old.textContent = child.textContent;
  });
  for (const child of oldChildren.slice(newChildren.length)) current.removeChild(child);
}
function patchTopology(world: SVGGElement, markup: string) {
  if (markup === lastTopologyMarkup) return;
  lastTopologyMarkup = markup;
  const draft = document.createElementNS("http://www.w3.org/2000/svg", "g");
  draft.innerHTML = markup;
  const key = (el: Element) =>
    (el.hasAttribute("data-link-labels") ? "labels:" + el.getAttribute("data-link-labels") : null) ??
    (el.hasAttribute("data-wireless-link")?"wireless:"+el.getAttribute("data-wireless-link"):null) ??
    (el.hasAttribute("data-wireless-coverage")?"coverage:"+el.getAttribute("data-wireless-coverage"):null) ??
    el.getAttribute("data-device") ??
    el.getAttribute("data-link") ??
    el.getAttribute("data-note");
  const current = new Map([...world.children].map((el) => [key(el), el]));
  const desired = [...draft.children].map(key);
  for (const next of [...draft.children]) {
    const old = current.get(key(next));
    if (!old) {
      world.append(next);
      continue;
    }
    current.delete(key(next));
    patchElement(old, next);
  }
  for (const old of current.values()) old.remove();
  // Keep cables below devices and their badges above cables after additions.
  for (const [index, id] of desired.entries()) {
    const el = [...world.children].find(child => key(child) === id);
    if (el && world.children[index] !== el) world.insertBefore(el, world.children[index] ?? null);
  }
}
let drag: {
  type: "node" | "pan" | "marquee" | "note";
  id?: string;
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  moved: boolean;
  positions: Map<string, { x: number; y: number }>;
  view: Viewport;
} | null = null;

const button = (action: string, name: string, title: string, extra = "") =>
  `<button class="icon-btn ${extra}" data-action="${action}" data-tooltip="${esc(title)}" aria-label="${esc(title)}">${icon(name)}</button>`;

app.innerHTML = `${nodeIconDefinitions()}
  <div class="flex h-full flex-col">
    <header class="app-header flex h-[58px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center"><span class="brand-logo" style="--brand-image: url('${projectLogo}')" aria-hidden="true"></span></div>
        <div><div class="flex items-center gap-2"><span class="text-[15px] font-bold tracking-tight">NetworkSim</span></div><button id="lab-name" data-action="rename-lab" class="max-w-[250px] truncate text-left text-[11px] text-slate-400" title="Rename lab">Untitled lab</button></div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn theme-toggle" id="theme-toggle" data-action="toggle-theme" aria-label="Switch to dark mode">${icon('moon', 15)}<span class="wide-label">Dark mode</span></button>
        <button class="btn" data-action="files">${icon("folder", 15)}<span class="wide-label">My labs</span></button>
        <button class="btn-primary" data-action="export">${icon("download", 15)}<span class="export-label">Export lab</span></button>
        ${button("help", "info", "Supported behavior and limits")}
      </div>
    </header>
    <div class="flex min-h-0 flex-1">
      <aside class="sidebar" aria-label="Device palette">
        <div class="palette-heading">Devices</div>
        <div class="palette-grid">${kinds.map((kind, i) => `<button draggable="true" class="palette-card" data-kind="${kind}" data-tooltip="${esc(deviceLabels[kind] + '\n' + kindDescriptions[i])}" aria-label="Add ${deviceLabels[kind]}"><span class="palette-symbol">${icon(kind, 72)}</span><span class="palette-copy">${paletteLabels[kind] ?? deviceLabels[kind]}</span></button>`).join("")}</div>
      </aside>
      <main class="flex min-w-0 flex-1 flex-col">
        <div class="editor-toolbar flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
          <div class="flex items-center gap-1">
            ${button("tool-select", "cursor", "Select and move (V)", "tool-active")}${button("tool-link", "link", "Connect devices (C)")}${button("tool-note", "note", "Add a note (N)")}
            <span class="divider"></span>${button("undo", "undo", "Undo (⌘Z)")}${button("redo", "redo", "Redo (⇧⌘Z)")}${button("delete", "trash", "Delete selection")}${button("power-lab", "power", "Power controls")}<span class="divider"></span>${button("simulation", "pulse", "Inspect packets and control simulation")}
          </div>
          <div class="flex items-center gap-1"><div class="canvas-navigation" role="group" aria-label="Canvas navigation">${button("zoom-out", "minus", "Zoom out")}${button("zoom-in", "plus", "Zoom in")}${button("fit", "fit", "Fit topology")}<button data-action="zoom-reset" id="zoom-value" class="zoom-value" aria-label="Reset zoom to 100 percent">100%</button></div><span class="divider"></span><button class="workspace-panel-button" data-action="tab-console">${icon("terminal", 15)} Console</button><span class="divider"></span>${button("inspector", "settings", "Toggle device details")}</div>
        </div>
        <div class="relative flex min-h-0 flex-1">
          <div class="canvas-wrap" id="canvas-wrap"><svg id="topology" role="application" aria-label="Network topology editor" tabindex="0"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#d5dfe6"/></pattern></defs><rect id="grid-bg" width="100%" height="100%" fill="url(#grid)"/><g id="world"></g><g id="alignment-guides" pointer-events="none"></g><rect id="marquee" class="marquee" visibility="hidden"/></svg><div id="empty-hint" class="empty-hint"><div><div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white text-teal shadow-xs">${icon("router", 32)}</div><h1 class="text-xl font-semibold tracking-tight">A clear space to learn networks.</h1><p class="mt-3 text-xs leading-6 text-slate-400">Add devices from the left, connect their ports,<br>then open a console to bring your network to life.</p></div></div><div id="connection-hint" class="connection-hint" hidden></div><section id="link-details" class="link-details" aria-label="Selected connection" hidden></section></div>
          <aside id="inspector" class="inspector" hidden aria-label="Device details"></aside>
        </div>
        <div id="dock-resize" role="separator" tabindex="0" aria-label="Resize console" aria-orientation="horizontal" hidden><span></span></div>
        <div id="dock" class="flex shrink-0 flex-col" style="height:${dockHeight}px" hidden>
          <div class="dock-tabs"><button class="tab active" data-action="tab-console">Console</button><div id="console-device-tabs" class="console-device-tabs" role="tablist" aria-label="Device consoles"></div><div class="dock-actions"><button class="dock-text-button" data-action="copy-console" title="Copy terminal history">Copy</button>${button("terminal-keys", "terminal", "Terminal keyboard shortcuts")}${button("maximize-dock", "fit", "Expand console")}${button("close-dock", "close", "Close console panel")}</div></div>
          <section id="console-panel" class="terminal min-h-0 flex-1" aria-label="Device terminal"><div id="terminal-empty" class="terminal-empty">${icon("terminal", 24)}<span>Add a device to the workspace to use its console.</span></div><div id="terminal-surface" class="terminal-surface" hidden><pre id="terminal-output" class="terminal-output" aria-live="polite"></pre><div id="terminal-form" class="terminal-input"><span id="terminal-prompt" class="prompt"></span><input id="terminal-input" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Device command"></div></div></section>
          <button id="terminal-jump" class="terminal-jump" data-action="terminal-bottom" hidden>Latest prompt ↓</button>
        </div>
      </main>
    </div>
  </div><input type="file" id="import-input" accept=".yaml,.yml,application/yaml,text/yaml" hidden>`;
syncThemeToggle();

function syncThemeToggle() {
  const next = colorTheme === 'dark' ? 'light' : 'dark';
  const toggle = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
  toggle.innerHTML = `${icon(next === 'dark' ? 'moon' : 'sun', 15)}<span class="wide-label">${next === 'dark' ? 'Dark' : 'Light'} mode</span>`;
  toggle.setAttribute('aria-label', `Switch to ${next} mode`);
  toggle.setAttribute('data-tooltip', `Switch to ${next} mode`);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', colorTheme);
}

function toast(text: string) {
  clearTimeout(toastTimer);
  $("#toast").className = "toast";
  $("#toast").textContent = text;
  toastTimer = setTimeout(() => {
    $("#toast").className = "";
    $("#toast").textContent = "";
  }, 4500);
}
function documentState(): LabDocument {
  const value = sim.serialize();
  const doc =
    typeof value === "string" ? JSON.parse(value) : structuredClone(value);
  doc.view = { ...viewport };
  return doc;
}
function snapshot(): string {
  return JSON.stringify(documentState());
}
function persistWorkspace(): boolean {
  try {
    const doc = documentState();
    const text = JSON.stringify(doc);
    if (text !== lastWorkspaceSnapshot || workspaceError) {
      saveWorkspace(doc);
      lastWorkspaceSnapshot = text;
      workspaceError = "";
      dirty = true;
    }
    if (dirtyFile) { dirtyFile = false; dirty = true; }
    return true;
  } catch (error) {
    const detail = message(error);
    if (workspaceError !== detail)
      toast(`Could not save this workspace: ${detail}. Export the lab to keep your changes.`);
    workspaceError = detail;
    dirty = true;
    return false;
  }
}
function restoreWorkspace() {
  const initial = documentState();
  try {
    let saved = loadWorkspace();
    // Upgrade previous versions that only offered named browser saves.
    if (!saved) {
      const latest = listSaved()[0];
      if (latest) saved = parseDocument(JSON.stringify(latest.document));
    }
    if (saved) {
      if (saved.lab.name === "Campus wireless · Catalyst 9800") saved.lab.name = "Campus wireless · WLC";
      sim.load(saved);
      restoreView(saved);
      persistWorkspace();
    } else lastWorkspaceSnapshot = snapshot();
  } catch (error) {
    sim.load(initial);
    restoreView(initial);
    lastWorkspaceSnapshot = snapshot();
    toast(`Could not restore the last workspace: ${message(error)}. Saved labs remain available in My labs.`);
  }
}
function flushWorkspace(): boolean {
  // An in-place note editor is part of the lab, even before it loses focus.
  if (noteEdit) finishNoteEdit(true);
  return persistWorkspace();
}
function checkpoint() {
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  dirtyFile = true;
}
function changed() {
  sim.changed();
  dirty = true;
  dirtyFile = true;
}
function transaction(work: () => void) {
  const before = snapshot();
  try {
    work();
    undoStack.push(before);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
    changed();
  } catch (e) {
    try {
      sim.load(JSON.parse(before));
    } catch {}
    toast(message(e));
  }
}
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function restore(text: string) {
  const doc = parseDocument(text);
  sim.load(doc);
  restoreView(doc);
  selected.clear();
  selectedLink = null;
  activeDevice = null;
  sessions.clear();
  dirty = true;
  dirtyFile = true;
  renderTerminal();
}
function undo(redo = false) {
  const from = redo ? redoStack : undoStack,
    to = redo ? undoStack : redoStack;
  const value = from.pop();
  if (!value) return;
  to.push(snapshot());
  restore(value);
  toast(redo ? "Change restored" : "Change undone");
}
function selectedDevice(): Device | undefined {
  return sim.lab.devices.find((d) => selected.has(d.id));
}
function worldPoint(clientX: number, clientY: number) {
  const r = $("#topology").getBoundingClientRect();
  return {
    x: (clientX - r.left - viewport.x) / viewport.scale,
    y: (clientY - r.top - viewport.y) / viewport.scale,
  };
}
function canvasCenter() {
  const r = $("#canvas-wrap").getBoundingClientRect();
  return worldPoint(r.x + r.width / 2, r.y + r.height / 2);
}
function setTool(next: typeof tool) {
  tool = next;
  linkStart = null;
  dirty = true;
  for (const b of $$('[data-action^="tool-"]'))
    b.classList.toggle("tool-active", b.dataset.action === `tool-${next}`);
}
function zoom(factor: number, x?: number, y?: number) {
  const r = $("#canvas-wrap").getBoundingClientRect();
  x ??= r.width / 2;
  y ??= r.height / 2;
  const before = viewport.scale;
  const next = Math.max(0.2, Math.min(3, before * factor));
  viewport.x = x - ((x - viewport.x) * next) / before;
  viewport.y = y - ((y - viewport.y) * next) / before;
  viewport.scale = next;
  dirty = true;
}
function fit() {
  if (!sim.lab.devices.length) {
    viewport = { x: 70, y: 60, scale: 1 };
    dirty = true;
    return;
  }
  const points = [...sim.lab.devices, ...sim.lab.notes],
    items=points.map(p=>({x:p.x,y:p.y,halfWidth:'text'in p?noteLayout(p.text).width/2:65,halfHeight:'text'in p?noteLayout(p.text).height/2:65})),
    r = $("#canvas-wrap").getBoundingClientRect();
  const bounds = topologyLinkLayouts().map(l => l.bounds);
  const minX = Math.min(...items.map(p=>p.x-p.halfWidth-20), ...bounds.map(b => b.x-b.width/2-20)),
    maxX = Math.max(...items.map(p=>p.x+p.halfWidth+20), ...bounds.map(b => b.x+b.width/2+20)),
    minY = Math.min(...items.map(p=>p.y-p.halfHeight-20), ...bounds.map(b => b.y-b.height/2-20)),
    maxY = Math.max(...items.map(p=>p.y+p.halfHeight+20), ...bounds.map(b => b.y+b.height/2+20));
  const scale = Math.min(
    1.5,
    Math.max(
      0.2,
      Math.min((r.width - 60) / (maxX - minX), (r.height - 50) / (maxY - minY)),
    ),
  );
  viewport = {
    x: (r.width - (maxX + minX) * scale) / 2,
    y: (r.height - (maxY + minY) * scale) / 2,
    scale,
  };
  dirty = true;
}

function addDevice(kind: DeviceKind, at?: { x: number; y: number }) {
  if (sim.lab.devices.length >= 250)
    return toast("A lab can contain up to 250 devices.");
  if (!at) {
    const center = canvasCenter();
    at = center;
    // Click-to-add finds nearby open space; an explicit drag keeps its placement.
    for (let ring = 0; ring < 10; ring++) {
      const candidates = ring === 0 ? [center] : Array.from({ length: ring * 8 }, (_, n) => {
        const angle = n * Math.PI * 2 / (ring * 8);
        return { x: center.x + Math.cos(angle) * ring * 130, y: center.y + Math.sin(angle) * ring * 130 };
      });
      const free = candidates.find(point => sim.lab.devices.every(d => Math.hypot(d.x - point.x, d.y - point.y) > 110));
      if (free) { at = free; break; }
    }
  }
  checkpoint();
  const d = sim.addDevice(
    kind,
    Math.round(at.x / 20) * 20,
    Math.round(at.y / 20) * 20,
  );
  selected.clear();
  selected.add(d.id);
  dirty = true;
  toast(`${deviceLabels[kind]} added. Double-click to configure.`);
  if(kind==='laptop')wirelessDialog(d);
}
function portUp(d: Device, name: string): boolean {
  try {
    return sim.interfaceUp(d.id, name);
  } catch {
    return d.powered && !!d.config.interfaces[name]?.adminUp;
  }
}
function topologyLinkLayouts() {
  const nodes = sim.lab.devices.map(d => ({ id: d.id, x: d.x, y: d.y, name: d.config.hostname }));
  const obstacles = sim.lab.notes.map(n => ({x: n.x, y: n.y, ...noteLayout(n.text)}));
  const signature = JSON.stringify([nodes, sim.lab.links.map(l => [l.id,l.a,l.b]), obstacles]);
  if (signature !== linkLayoutSignature) {
    linkLayoutSignature = signature;
    linkLayouts = layoutLinks(nodes, sim.lab.links, obstacles);
  }
  return linkLayouts;
}
function connectionState(link: Link) {
  if (!link.enabled) return {up: false, label: "Disabled"};
  const a = sim.getDevice(link.a.deviceId), b = sim.getDevice(link.b.deviceId);
  if (!a||!b||!sim.devicePowered(a.id)||!sim.devicePowered(b.id)) return {up: false, label: "Device off"};
  if (!portUp(a,link.a.port) || !portUp(b,link.b.port)) return {up: false, label: "Interface down"};
  return {up: true, label: "Link up"};
}
function portBadge(label: PortLabel, link: Link) {
  const d = sim.getDevice(label.endpoint.deviceId)!;
  const up = link.enabled && portUp(d,label.endpoint.port);
  const dx = label.anchor.x-label.x, dy = label.anchor.y-label.y;
  const factor = Math.min(1, 1 / Math.max(Math.abs(dx)/(label.width/2), Math.abs(dy)/(label.height/2)));
  const leader = Math.hypot(dx,dy)>14 ? `<path class="port-label-leader" d="M${label.anchor.x},${label.anchor.y} L${label.x+dx*factor},${label.y+dy*factor}"/>` : "";
  return `${leader}<g class="port-label ${up ? "up" : "down"}" transform="translate(${label.x},${label.y})" data-tooltip="${esc(d.config.hostname)} · ${esc(label.endpoint.port)}"><rect x="${-label.width/2}" y="-11" width="${label.width}" height="22" rx="6"/><text x="0" y=".5" dominant-baseline="middle" text-anchor="middle">${esc(label.text)}</text></g>`;
}
function portSocket(point: {x: number; y: number}, device: Device, port: string, link: Link) {
  const status = portIndicator(sim, device, port, link);
  const activity = linkActivity.sample(device, port, performance.now());
  const active = status.state !== 'off' && status.state !== 'down' && (activity.tx || activity.rx);
  const description = `${device.config.hostname} · ${port} · ${status.description} · Left: status; right: TX/RX activity`;
  return `<g class="wire-socket state-${status.state}" transform="translate(${point.x},${point.y})" role="img" aria-label="${esc(description)}" data-tooltip="${esc(description)}"><path class="socket-half socket-status" d="M0,-4 A4,4 0 0,0 0,4 Z"/><path class="socket-half socket-activity ${active ? 'traffic' : ''}" d="M0,-4 A4,4 0 0,1 0,4 Z"/><circle class="socket-outline" r="4"/><path class="socket-divider" d="M0,-4 V4"/></g>`;
}
function renderTopology() {
  const world = document.querySelector<SVGGElement>("#world")!;
  linkActivity.retain(new Set(sim.lab.links.flatMap(link => [link.a,link.b]).map(endpoint => `${endpoint.deviceId}|${endpoint.port}`)));
  const layouts = new Map(topologyLinkLayouts().map(l => [l.id,l]));
  let labels = "";
  const links = sim.lab.links.map(l => {
    const layout = layouts.get(l.id), a = sim.getDevice(l.a.deviceId), b = sim.getDevice(l.b.deviceId);
    if (!layout || !a || !b) return "";
    const state = connectionState(l), active = selectedLink === l.id, hover = hoveredLink === l.id;
    const classes = `diagram-link ${active ? "selected" : ""} ${hover ? "hovered" : ""}`;
    const description = `${a.config.hostname} ${l.a.port} to ${b.config.hostname} ${l.b.port}, ${state.label}${layout.count>1 ? `, link ${layout.index+1} of ${layout.count}` : ""}`;
    labels += `<g class="${classes} link-label-group" data-link-labels="${esc(l.id)}" data-link="${esc(l.id)}" aria-label="${esc(description)}">${layout.labels.map(label => portBadge(label,l)).join("")}</g>`;
    return `<g class="${classes}" data-link="${esc(l.id)}" tabindex="0" role="button" aria-label="Link ${esc(description)}" aria-pressed="${active}"><path class="wire-halo" d="${layout.path}"/><path class="wire ${state.up ? "" : "down"}" d="${layout.path}"/><path class="wire-hit" d="${layout.path}"/>${portSocket(layout.start,a,l.a.port,l)}${portSocket(layout.end,b,l.b.port,l)}</g>`;
  }).join("");
  const notes = sim.lab.notes.map(n => {
    const layout = noteLayout(n.text);
    return `<g class="diagram-note ${selected.has(n.id) ? "selected" : ""} ${noteEdit?.id === n.id ? "editing" : ""}" data-note="${esc(n.id)}" transform="translate(${n.x},${n.y})" role="button" tabindex="0" aria-label="Note: ${esc(n.text)}"><rect x="${-layout.width / 2}" y="${-layout.height / 2}" width="${layout.width}" height="${layout.height}" rx="4"/><text text-anchor="middle">${layout.lines.map((line, i) => `<tspan x="0" y="${4 + (i - (layout.lines.length - 1) / 2) * 18}">${esc(line)}</tspan>`).join("")}</text>${n.locked ? `<g transform="translate(${layout.width / 2 + 4},-6)" color="#7d8e97">${icon("lock", 11)}</g>` : ""}</g>`;
  }).join("");
  const nodes = sim.lab.devices
    .map(
      (d) =>
        `<g class="device kind-${d.kind} ${selected.has(d.id) ? "selected" : ""} ${sim.devicePowered(d.id) ? "" : "off"}" data-device="${esc(d.id)}" transform="translate(${d.x},${d.y})"><rect class="selection-glow" x="-39" y="-34" width="78" height="103" rx="10" fill="none" stroke="none"/><rect class="device-body" x="-30" y="-26" width="60" height="52" rx="12" tabindex="0" role="button" aria-label="${esc(d.config.hostname)}, ${deviceLabels[d.kind]}, ${sim.devicePowered(d.id) ? "powered on" : "powered off"}"/><g class="node-icon" transform="translate(-22,-23)">${icon(d.kind, 44)}</g><circle cx="21" cy="17" r="3" fill="${d.runtime.features.iosBoot&&d.runtime.features.iosBoot.phase!=="ready" ? "#d99b32" : sim.devicePowered(d.id) ? "#31b397" : "#a7b4bd"}"/><text class="device-label" y="46">${esc(d.config.hostname)}</text><text class="device-sub" y="60">${esc(d.runtime.features.iosBoot&&d.runtime.features.iosBoot.phase!=="ready" ? "Booting…" : Object.values(d.config.interfaces).find((p) => p.ip)?.ip || (d.kind === "router" ? "Router" : d.kind === "switch" ? "L2 switch" : d.kind === "l3switch" ? "L3 switch" : deviceLabels[d.kind]))}</text>${d.config.features.positionLocked ? `<g transform="translate(-35,-34)" color="#6b7d88">${icon("lock", 12)}</g>` : ""}${linkStart === d.id ? '<circle cx="0" cy="0" r="40" fill="none" stroke="#0d9488" stroke-dasharray="4 4"/>' : ""}</g>`,
    )
    .join("");
  const wirelessLinks=sim.lab.devices.filter(d=>d.kind==='laptop').map(d=>{const association=sim.wireless.association(d.id),ap=association&&sim.getDevice(association.apId);return association&&ap?`<g class="wireless-association" data-wireless-link="${esc(d.id)}" aria-label="${esc(d.config.hostname)} associated with ${esc(ap.config.hostname)} on ${esc(association.ssid)}"><line x1="${d.x}" y1="${d.y}" x2="${ap.x}" y2="${ap.y}"/><title>${esc(association.ssid)} · ${association.band} GHz · ${association.rssi} dBm</title></g>`:'';}).join('');
  const coverage=sim.lab.devices.filter(d=>d.kind==='ap'&&d.config.features.wirelessCoverage).map(d=>{
    const radius=sim.wireless.coverageRadius(d.id);if(!radius)return '';
    const meters=Math.round(radius*(d.config.features.wireless?.rf?.metersPerUnit??.2));
    return `<g class="wireless-coverage ${selected.has(d.id)?'selected':''}" data-wireless-coverage="${esc(d.id)}" aria-label="${esc(d.config.hostname)} estimated radio coverage, approximately ${meters} meters"><title>Estimated RF coverage · authentication and network reachability are separate</title><circle class="wireless-coverage-area" cx="${d.x}" cy="${d.y}" r="${radius}"/><circle class="wireless-coverage-ring" cx="${d.x}" cy="${d.y}" r="${radius*.5}"/><g class="wireless-coverage-label" transform="translate(${d.x},${d.y+88})"><rect x="-93" y="-12" width="186" height="24" rx="6"/><text text-anchor="middle" dominant-baseline="middle" y="1">Estimated RF · ~${meters} m</text></g></g>`;
  }).join('');
  patchTopology(world, coverage+links+wirelessLinks + nodes + notes + labels);
  world.setAttribute(
    "transform",
    `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`,
  );
  const guides = document.querySelector("#alignment-guides")!;
  guides.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`);
  guides.innerHTML = alignmentGuides.map(g => `<g class="alignment-guide"><line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>${g.spacing ? (g.y1 === g.y2 ? `<path d="M${g.x1},${g.y1-4}v8 M${g.x2},${g.y2-4}v8"/>` : `<path d="M${g.x1-4},${g.y1}h8 M${g.x2-4},${g.y2}h8"/>`) : ""}</g>`).join("");
  positionNoteEditor();
  const pattern = document.querySelector("#grid")!;
  pattern.setAttribute(
    "patternTransform",
    `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`,
  );
  $("#empty-hint").style.display =
    sim.lab.devices.length || sim.lab.notes.length ? "none" : "flex";
  $("#zoom-value").textContent = `${Math.round(viewport.scale * 100)}%`;
  $("#lab-name").textContent = sim.lab.name || "Untitled lab";
  ($('[data-action="undo"]') as HTMLButtonElement).disabled = !undoStack.length;
  ($('[data-action="redo"]') as HTMLButtonElement).disabled = !redoStack.length;
  renderWorkspaceControls();
  syncConsoleDevices();
  if (renderedSession !== activeDevice) renderTerminal();
  else renderDock();
}

function renderWorkspaceControls() {
  const items = [...sim.lab.devices, ...sim.lab.notes].filter(item => selected.has(item.id));
  const hint = $("#connection-hint");
  hint.hidden = tool === "select";
  hint.textContent = tool === "note" ? "Click the canvas to place a note · Esc to cancel" : linkStart ? `Connect ${sim.getDevice(linkStart)?.config.hostname ?? "device"} → select another device · Esc to cancel` : "Select the first device to connect · Esc to cancel";
  for (const control of $$<HTMLButtonElement>('[data-action="delete"]')) control.disabled = !items.length && !selectedLink;
  renderLinkDetails();
}

function deviceOpenAction(kind:DeviceKind):{glyph:string;label:string} {
  if(kind==='pc'||kind==='server')return {glyph:'pc',label:'Open desktop'};
  const settings:Partial<Record<DeviceKind,string>>={poeswitch:'Open PoE settings',wlc:'Open WLC settings',ap:'Open AP settings',laptop:'Open wireless adapter',phone:'Open phone settings'};
  return settings[kind]?{glyph:'settings',label:settings[kind]!}:{glyph:'terminal',label:'Open console'};
}

function renderInspector() {
  const el = $("#inspector"),
    d = selectedDevice();
  el.hidden = !inspectorOpen || !d;
  if (!d) return;
  const openAction=deviceOpenAction(d.kind);
  const markup = `<div class="flex items-center justify-between border-b border-slate-100 p-4"><span class="section-label">Device details</span>${button("inspector", "close", "Hide details")}</div><div class="p-4"><div class="flex items-center gap-3"><span class="palette-symbol">${icon(d.kind, 32)}</span><div><div class="text-sm font-semibold">${esc(d.config.hostname)}</div><div class="mt-1 text-[10px] text-slate-400">${deviceLabels[d.kind]}</div></div></div><div class="mt-4 flex gap-2"><button class="btn-primary flex-1" data-action="open-device">${icon(openAction.glyph, 14)} ${openAction.label}</button>${d.kind==='ap'||endpointUsesPoE(d)?'':button("power-device", "power", d.powered ? "Power off device" : "Power on device")}</div>${["pc","laptop"].includes(d.kind)?`<button class="btn mt-3 w-full" data-action="host-profile">Client profile</button>`:""}<div class="mt-3 flex items-center justify-between"><button data-action="rename-device" class="text-[10px] text-slate-400 hover:text-teal">Rename device</button><button data-action="lock-device" class="text-[10px] text-slate-400 hover:text-teal">${d.config.features.positionLocked ? "Unlock position" : "Lock position"}</button></div></div><div class="p-4"><button data-action="delete" class="text-[10px] text-rose-500">Remove device</button></div>`;
  if (markup !== lastInspectorMarkup) {
    el.innerHTML = markup;
    lastInspectorMarkup = markup;
  }
}

function selectDevice(id: string, additive = false) {
  if (!additive) selected.clear();
  selected.add(id);
  selectedLink = null;
  dirty = true;
}
function openDevice(id: string, forceConsole = false) {
  const d = sim.getDevice(id);
  if (!d) return;
  selectDevice(id);
  if(d.kind==='phone')return showPhone(sim,d,dialog,()=>hostConfig(d),transaction);
  if(!forceConsole&&d.kind==='poeswitch')return showPoE(sim,d,formDialog,transaction,()=>{closeDialog();openConsole(d.id);});
  if(!forceConsole&&['wlc','ap','laptop'].includes(d.kind))return wirelessDialog(d);
  if (!forceConsole && (d.kind === "pc" || d.kind === "server"))
    return desktop(d);
  openConsole(id);
}
function stashTerminal() {
  const state = renderedSession ? sessions.get(renderedSession) : undefined;
  if (!state) return;
  const input = $<HTMLInputElement>("#terminal-input");
  state.draft = state.pendingDraft?.value ?? input.value;
  state.draftStart = state.pendingDraft?.start ?? input.selectionStart ?? input.value.length;
  state.draftEnd = state.pendingDraft?.end ?? input.selectionEnd ?? input.value.length;
  state.scrollTop = $("#console-panel").scrollTop;
  state.scrollLeft = $("#console-panel").scrollLeft;
}
function focusTerminal(scroll = false) {
  if (!activeDevice || !sessions.has(activeDevice) || !dockOpen) return;
  $("#terminal-input").focus({ preventScroll: true });
  if (scroll) { $("#console-panel").scrollTop = $("#console-panel").scrollHeight; $("#console-panel").scrollLeft = 0; }
  updateTerminalJump();
}
function setDock(open: boolean) {
  const before = $("#canvas-wrap").clientHeight;
  dockOpen = open;
  renderDock();
  viewport.y += ($("#canvas-wrap").clientHeight - before) / 2;
  dirty = true;
}
function dockLimit() { return Math.max(150, $("main").clientHeight - 292); }
function revealConsoleDevice() {
  const device = activeDevice ? sim.getDevice(activeDevice) : undefined;
  if (!device || !dockOpen) return;
  const canvas = $("#canvas-wrap"), x = device.x * viewport.scale + viewport.x, y = device.y * viewport.scale + viewport.y;
  viewport.x += Math.max(55, Math.min(canvas.clientWidth - 55, x)) - x;
  viewport.y += Math.max(70, Math.min(canvas.clientHeight - 65, y)) - y;
}
function ensureConsoleSession(id: string) {
  if (sessions.has(id)||sim.getDevice(id)?.kind==='phone') return;
  sessions.set(id, { cli: new IOSSession(sim, id), lines: [], history: [], cursor: 0 });
  if (renderedSession === id) renderedSession = null;
}
function syncConsoleDevices() {
  const deviceIds = new Set(sim.lab.devices.filter(device=>device.kind!=='phone').map(device => device.id));
  for (const id of sessions.keys()) if (!deviceIds.has(id)) sessions.delete(id);
  if (activeDevice && !deviceIds.has(activeDevice)) activeDevice = null;
  if (!activeDevice && dockOpen)
    activeDevice = (selectedDevice()?.kind!=='phone'?selectedDevice()?.id:undefined) ?? sim.lab.devices.find(d=>d.kind!=='phone')?.id ?? null;
  if (activeDevice) ensureConsoleSession(activeDevice);
}
function openConsole(id: string) {
  stashTerminal();
  const d = sim.getDevice(id);
  if (!d) return;
  if(d.kind==='phone')return showPhone(sim,d,dialog,()=>hostConfig(d),transaction);
  activeDevice = id;
  selectDevice(id);
  ensureConsoleSession(id);
  setDock(true);
  revealConsoleDevice();
  renderTerminal();
  focusTerminal();
}
function renderDock() {
  $("#dock").hidden = !dockOpen;
  $("#dock-resize").hidden = !dockOpen;
  $("#dock").style.height = `${dockMaximized ? dockLimit() : Math.min(dockHeight, dockLimit())}px`;
  $("#dock-resize").setAttribute("aria-valuenow", String(dockHeight));
  for (const b of $$('[data-action^="tab-"]')) {
    const on = dockOpen && b.dataset.action === "tab-console";
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  const maximize = $('[data-action="maximize-dock"]');
  maximize.setAttribute("aria-label", dockMaximized ? "Restore console size" : "Expand console");
  maximize.dataset.tooltip = dockMaximized ? "Restore console size" : "Expand console";
  const markup = sim.lab.devices.filter(device=>device.kind!=='phone').map(device =>
    `<div class="console-session ${device.id === activeDevice ? "active" : ""}"><button data-session="${esc(device.id)}" role="tab" aria-selected="${device.id === activeDevice}" aria-controls="console-panel" class="session-name"><span class="session-dot ${sim.devicePowered(device.id) ? "on" : ""}"></span>${esc(device.config.hostname)}</button></div>`,
  ).join("");
  if (markup !== lastSessionMarkup) { $("#console-device-tabs").innerHTML = markup; lastSessionMarkup = markup; }
  updateTerminalJump();
}
function updateTerminalJump() {
  const panel = $("#console-panel");
  $("#terminal-jump").hidden = !dockOpen || panel.scrollHeight - panel.scrollTop - panel.clientHeight < 28;
}
function renderTerminal(forceBottom = false) {
  syncConsoleDevices();
  const state = activeDevice ? sessions.get(activeDevice) : undefined;
  const panel = $("#console-panel"), output = $("#terminal-output");
  const switched = renderedSession !== activeDevice;
  const follow = forceBottom || panel.scrollHeight - panel.scrollTop - panel.clientHeight < 28;
  const selecting = !!window.getSelection()?.toString() && panel.contains(window.getSelection()?.anchorNode ?? null);
  $("#terminal-empty").hidden = !!state;
  $("#terminal-surface").hidden = !state;
  if (!state) { renderedSession = null; renderDock(); return; }
  syncTerminalColumns(state);
  const text = state.lines.length ? state.lines.join("\n") + "\n" : "";
  const previous = output.textContent ?? "";
  if (text !== previous) {
    if (!switched && text.startsWith(previous) && output.firstChild instanceof Text) output.firstChild.appendData(text.slice(previous.length));
    else output.textContent = text;
  }
  $("#terminal-prompt").textContent = state.pending?.length ? "--More--" : state.cli.busy ? "" : state.cli.prompt;
  const input = $<HTMLInputElement>("#terminal-input");
  input.readOnly = !!state.pending?.length || state.cli.busy;
  input.type = (state.cli as any).passwordInput ? "password" : "text";
  if (switched) {
    input.value = state.pending?.length ? "" : state.draft ?? "";
    input.setSelectionRange(state.draftStart ?? input.value.length, state.draftEnd ?? input.value.length);
  }
  renderedSession = activeDevice;
  renderDock();
  if (switched) panel.scrollTop = state.scrollTop ?? panel.scrollHeight;
  else if (follow && !selecting) panel.scrollTop = panel.scrollHeight;
  if (switched) panel.scrollLeft = state.scrollLeft ?? 0;
  if (forceBottom) panel.scrollLeft = 0;
  updateTerminalJump();
}
function pollTerminal() {
  const state = activeDevice ? sessions.get(activeDevice) : undefined;
  if (!state || state.pending?.length || !dockOpen) return;
  syncTerminalColumns(state);
  try {
    const output = state.cli.pollOutput();
    if (!output.length) {
      if ($<HTMLInputElement>("#terminal-input").readOnly !== state.cli.busy || $("#terminal-prompt").textContent !== state.cli.prompt) renderTerminal();
      return;
    }
    state.lines.push(...terminalRows(output,state.cli.pageWidth));
    if (state.lines.length > 2500) state.lines = state.lines.slice(-2000);
    renderTerminal();
  } catch (error) {
    state.lines.push(`% ${message(error)}`);
    renderTerminal();
  }
}
let terminalGeometryCache:{key:string;columns:number;rows:number}|undefined;
function terminalGeometry() {
  const panel = $("#console-panel"), style = getComputedStyle(panel);
  const key=[panel.clientWidth,panel.clientHeight,style.font,style.lineHeight,style.padding].join('|');
  if(terminalGeometryCache?.key===key)return terminalGeometryCache;
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(100);
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;pointer-events:none";
  panel.append(probe);
  const columnWidth = probe.getBoundingClientRect().width / 100;
  probe.remove();
  const columns = Math.max(1, Math.floor((panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / columnWidth));
  const rows = Math.floor((panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight));
  return terminalGeometryCache={key,columns,rows};
}
function syncTerminalColumns(state:TerminalSession) {
  if(dockOpen&&$("#console-panel").clientWidth>0)state.cli.setViewportColumns(terminalGeometry().columns);
}
function fitTerminalPage(lines: string[], length: number, echo: string[] = []) {
  // Output already has the session's one permitted wrap. Paging must not wrap it again.
  const {rows}=terminalGeometry();
  return terminalPage(lines, { columns:0, rows, length, reservedRows:1+echo.length });
}
function appendTerminalPage(state: TerminalSession, lines: string[], length: number, echo: string[] = []) {
  const page = fitTerminalPage(lines, length, echo);
  state.pageStart = page.pending.length ? state.lines.length : undefined;
  state.pageEcho = page.pending.length ? echo : undefined;
  state.lines.push(...page.visible);
  state.pending = page.pending;
}
// Shrinking the console returns overflow to the queue instead of hiding or skipping it.
new ResizeObserver(() => {
  const state = activeDevice ? sessions.get(activeDevice) : undefined;
  if (!dockOpen || !state) return;
  syncTerminalColumns(state);
  if (!state.pending?.length || state.pageStart === undefined) return;
  const page = fitTerminalPage(state.lines.splice(state.pageStart), state.cli.pageLength, state.pageEcho);
  state.lines.push(...page.visible);
  state.pending.unshift(...page.pending);
  renderTerminal(true);
}).observe($("#console-panel"));
function runCommand(line: string) {
  if (!activeDevice) return;
  const state = sessions.get(activeDevice);
  if (!state) return;
  syncTerminalColumns(state);
  const secret = !!(state.cli as any).passwordInput;
  const echo = [secret ? state.cli.prompt : `${state.cli.prompt}${line}`];
  if (!secret && state.cli.commandTimestamp) echo.push(state.cli.commandTimestamp);
  state.lines.push(...echo);
  try {
    const before = snapshot();
    const output = terminalRows(state.cli.execute(line),state.cli.pageWidth);
    if(state.cli.consumeDisplayAction()==='clear-screen'){state.lines=[];state.pending=undefined;state.pendingDraft=undefined;}
    appendTerminalPage(state, output, state.cli.pageLength, echo);
    if (snapshot() !== before) {
      undoStack.push(before);
      if (undoStack.length > 80) undoStack.shift();
      redoStack.length = 0;
      dirtyFile = true;
    }
  } catch (e) {
    state.lines.push(`% ${message(e)}`);
  }
  state.history = [...state.cli.commandHistory];
  state.cursor = state.history.length;
  if (state.lines.length > 2500) {
    const removed = state.lines.length - 2000;
    state.lines = state.lines.slice(removed);
    if (state.pageStart !== undefined) state.pageStart = Math.max(0, state.pageStart - removed);
  }
  dirty = true;
  state.draft = "";
  renderTerminal(true);
  pollTerminal();
}
function pageTerminal(oneLine = false, stop = false) {
  const state = activeDevice ? sessions.get(activeDevice) : null;
  if (!state?.pending) return;
  if (stop) {
    state.pending = [];
    state.pageStart = undefined;
    state.pageEcho = undefined;
  } else appendTerminalPage(state, state.pending, oneLine ? 1 : state.cli.pageLength);
  if (!state.pending.length && state.pendingDraft) {
    const input=$<HTMLInputElement>("#terminal-input"), draft=state.pendingDraft;
    state.pendingDraft=undefined;input.value=draft.value;input.setSelectionRange(draft.start,draft.end);
    state.draft=draft.value;state.draftStart=draft.start;state.draftEnd=draft.end;
  }
  renderTerminal(true);
}
function cliComplete(help = false) {
  const input = $<HTMLInputElement>("#terminal-input"),
    state = activeDevice ? sessions.get(activeDevice) : null;
  if (!state) return;
  syncTerminalColumns(state);
  if ((state.cli as any).passwordInput) {
    if (help)
      input.setRangeText(
        "?",
        input.selectionStart ?? input.value.length,
        input.selectionEnd ?? input.value.length,
        "end",
      );
    input.focus();
    return;
  }
  const caret = input.selectionStart ?? input.value.length,
    prefix = input.value.slice(0, caret);
  if (help) {
    const output=terminalRows(state.cli.help(prefix),state.cli.pageWidth),echo=[`${state.cli.prompt}${prefix}?`];
    state.lines.push(...echo);
    appendTerminalPage(state, output, state.cli.pageLength, echo);
    if(state.pending?.length){
      state.pendingDraft={value:input.value,start:input.selectionStart??input.value.length,end:input.selectionEnd??input.value.length};
      input.value='';
    }
    renderTerminal(true);
  } else {
    const result = state.cli.complete(prefix);
    const edit=terminalCompletionEdit(input.value,caret,input.selectionEnd??caret,result);
    input.value = edit.value;
    input.setSelectionRange(edit.start, edit.end);
  }
  input.focus();
}

function closeDialog() {
  $("#dialogs").innerHTML = "";
  if (lastFocus?.isConnected) lastFocus.focus();
  else $("#topology").focus();
}
function dialog(title: string, content: string, footer = "", wide = false) {
  if (!$("#dialogs").children.length)
    lastFocus = document.activeElement as HTMLElement;
  $("#dialogs").innerHTML =
    `<div class="dialog-backdrop"><section class="dialog ${wide ? "!max-w-3xl" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title" class="text-base font-semibold">${esc(title)}</h2>${button("close-dialog", "close", "Close dialog")}</div><div class="dialog-body">${content}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ""}</section></div>`;
  setTimeout(
    () =>
      $("#dialogs")
        .querySelector<HTMLElement>("input,select,textarea,button")
        ?.focus(),
    0,
  );
}
function formDialog(
  title: string,
  content: string,
  onSave: (data: FormData) => void,
  saveLabel = "Save changes",
) {
  dialog(
    title,
    `<form id="dialog-form" class="space-y-4">${content}<div id="form-error" role="alert" class="text-xs text-rose-600"></div></form>`,
    `<button class="btn" data-action="close-dialog">Cancel</button><button class="btn-primary" form="dialog-form">${saveLabel}</button>`,
  );
  $("#dialog-form").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      onSave(new FormData(e.currentTarget as HTMLFormElement));
      closeDialog();
    } catch (err) {
      $("#form-error").textContent = message(err);
    }
  });
}
function textField(
  label: string,
  name: string,
  value: unknown,
  placeholder = "",
  required = false,
) {
  return `<label class="field">${esc(label)}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? "required" : ""}></label>`;
}
function renameLab() {
  formDialog(
    "Name your lab",
    textField("Lab name", "name", sim.lab.name, "Untitled lab", true),
    (f) =>
      transaction(() => {
        sim.lab.name = String(f.get("name")).trim().slice(0, 100);
      }),
  );
}
function renameDevice() {
  const d = selectedDevice();
  if (!d) return;
  formDialog(
    "Rename device",
    textField("Hostname", "name", d.config.hostname, "", true),
    (f) => {
      const name = String(f.get("name")).trim();
      if (!/^[A-Za-z][\w.-]{0,62}$/.test(name))
        throw Error(
          "Use a letter followed by up to 62 letters, digits, hyphens, dots or underscores.",
        );
      transaction(() => (d.config.hostname = name));
    },
  );
}
const noteMeasure = document.createElement("canvas").getContext("2d");
function noteLayout(text: string) {
  if (noteMeasure) noteMeasure.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const measure = (value: string) => noteMeasure?.measureText(value).width ?? value.length * 7;
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const char of raw) {
      if (line && measure(line + char) > 420) { lines.push(line); line = ""; }
      line += char;
    }
    lines.push(line);
  }
  return { lines, width: Math.max(42, ...lines.map(measure)) + 16, height: Math.max(26, lines.length * 18 + 8) };
}
function positionNoteEditor() {
  if (!noteEdit) return;
  const editor = noteEdit.element, input = $<HTMLTextAreaElement>("textarea", editor);
  const layout = noteLayout(input.value || input.placeholder);
  const bounds = $("#canvas-wrap").getBoundingClientRect();
  const width = Math.min(Math.max(180, layout.width * viewport.scale + 8), bounds.width - 24);
  editor.style.width = `${width}px`;
  editor.style.left = `${Math.max(width/2 + 12, Math.min(bounds.width - width/2 - 12, viewport.x + noteEdit.x * viewport.scale))}px`;
  editor.style.top = `${Math.max(24, Math.min(bounds.height - 70, viewport.y + noteEdit.y * viewport.scale))}px`;
  input.style.fontSize = `${Math.max(12, Math.min(20, 13 * viewport.scale))}px`;
  input.style.height = 'auto'; input.style.height = `${Math.min(220, Math.max(30, input.scrollHeight))}px`;
}
function finishNoteEdit(save: boolean) {
  const editing = noteEdit;
  if (!editing) return;
  const text = $<HTMLTextAreaElement>("textarea", editing.element).value.trim();
  noteEdit = null; editing.element.remove();
  const existing = sim.lab.notes.find(n => n.id === editing.id);
  if (save && text && text !== existing?.text) transaction(() => {
    if (existing) existing.text = text;
    else { const note = { id: crypto.randomUUID(), x: editing.x, y: editing.y, text }; sim.lab.notes.push(note); selected.clear(); selected.add(note.id); }
  });
  dirty = true;
}
function addNote(at = canvasCenter(), id?: string) {
  finishNoteEdit(true);
  const existing = sim.lab.notes.find(n => n.id === id);
  if (!existing && sim.lab.notes.length >= 100) return toast("A lab can contain up to 100 notes.");
  const editor = document.createElement("div"); editor.className = "inline-note-editor";
  editor.innerHTML = `<textarea aria-label="Note text" rows="1" maxlength="2000" placeholder="e.g. 192.168.1.0/24" spellcheck="false">${esc(existing?.text ?? "")}</textarea><div class="note-edit-controls"><span>Enter to save · Esc to cancel</span><button aria-label="Save note" title="Save note">${icon("check", 14)}</button></div>`;
  noteEdit = { id: existing?.id, x: existing?.x ?? at.x, y: existing?.y ?? at.y, element: editor };
  $("#canvas-wrap").append(editor);
  const input = $<HTMLTextAreaElement>("textarea", editor);
  input.addEventListener("input", positionNoteEditor);
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); finishNoteEdit(false); svg.focus(); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finishNoteEdit(true); svg.focus(); }
  });
  $("button", editor).addEventListener("click", () => { finishNoteEdit(true); svg.focus(); });
  editor.addEventListener("focusout", () => queueMicrotask(() => { if (noteEdit?.element === editor && !editor.contains(document.activeElement)) finishNoteEdit(true); }));
  positionNoteEditor(); input.focus(); input.select(); dirty = true;
}
function geometry(item: Device | { id: string; x: number; y: number; text: string }): AlignmentItem {
  const note = "text" in item ? noteLayout(item.text) : undefined;
  return { id: item.id, x: item.x, y: item.y, halfWidth: note ? note.width/2 : 39, halfHeight: note ? note.height/2 : 42 };
}
function availablePorts(d: Device) {
  const used = new Set(sim.lab.links.flatMap(l => [l.a,l.b]).filter(e => e.deviceId===d.id).map(e => e.port));
  return Object.values(d.config.interfaces).filter(p => !used.has(p.name) && !/^(Vlan|Loopback|Tunnel|Port-channel|Wireless)/i.test(p.name) && !p.name.includes("."));
}
function portOptions(d: Device) { return availablePorts(d).map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join(""); }
function pairLinks(link: Link) { return orderedPairLinks(sim.lab.links,link.a.deviceId,link.b.deviceId); }
function selectLink(id: string) { selectedLink=id; selected.clear(); dirty=true; }
function cycleLink(direction: number) {
  const link=sim.lab.links.find(l => l.id===selectedLink); if (!link) return;
  const siblings=pairLinks(link),index=siblings.findIndex(l=>l.id===link.id);
  selectLink(siblings[(index+direction+siblings.length)%siblings.length].id);
}
function renderLinkDetails() {
  const panel=$("#link-details"), link=sim.lab.links.find(l=>l.id===selectedLink);
  panel.hidden=!link; if(!link) return;
  const a=sim.getDevice(link.a.deviceId)!,b=sim.getDevice(link.b.deviceId)!,siblings=pairLinks(link),index=siblings.findIndex(l=>l.id===link.id),state=connectionState(link);
  const markup=`<div class="link-details-heading"><span class="link-status ${state.up?"up":""}"><i></i>${state.label}</span><div class="link-stepper"><button class="icon-btn" data-action="previous-link" aria-label="Previous parallel link" ${siblings.length<2?"disabled":""}>‹</button><span>${index+1} / ${siblings.length}</span><button class="icon-btn" data-action="next-link" aria-label="Next parallel link" ${siblings.length<2?"disabled":""}>›</button><button class="icon-btn" data-action="deselect-link" aria-label="Close connection details">${icon("close",14)}</button></div></div><div class="link-endpoints"><div><strong>${esc(a.config.hostname)}</strong><span>${esc(shortInterface(link.a.port))}</span></div><span class="endpoint-connector">↔</span><div><strong>${esc(b.config.hostname)}</strong><span>${esc(shortInterface(link.b.port))}</span></div></div><div class="link-details-actions"><button class="btn" data-action="edit-selected-link">${icon("settings",14)} Settings</button><button class="btn" data-action="manage-pair-links">${icon("link",14)} Connections${siblings.length>1?` (${siblings.length})`:""}</button></div>`;
  if(markup!==lastLinkDetails){panel.innerHTML=markup;lastLinkDetails=markup;}
}
function connectDialog(aId: string, bId: string) {
  const a=sim.getDevice(aId),b=sim.getDevice(bId); if(!a||!b||aId===bId)return;
  const ap=availablePorts(a),bp=availablePorts(b),existing=orderedPairLinks(sim.lab.links,aId,bId);
  const drafts:Array<{a:string;b:string}>=ap.length&&bp.length&&sim.lab.links.length<300?[{a:ap[0].name,b:bp[0].name}]:[];
  const endpoint=(d:Device,count:number)=>`<div class="connection-device"><span class="palette-symbol">${icon(d.kind,30)}</span><div><strong>${esc(d.config.hostname)}</strong><span>${count} available ${count===1?"interface":"interfaces"}</span></div></div>`;
  dialog("Connections",`<div class="connection-pair">${endpoint(a,ap.length)}<span class="endpoint-connector">↔</span>${endpoint(b,bp.length)}</div>${existing.length?`<div class="connection-section-heading"><span>Existing connections</span><span>${existing.length} ${existing.length===1?"link":"links"}</span></div><div class="existing-connections">${existing.map(l=>{const local=l.a.deviceId===aId?l.a:l.b,remote=l.a.deviceId===aId?l.b:l.a,state=connectionState(l);return `<button class="existing-connection ${l.id===selectedLink?"active":""}" data-existing-link="${esc(l.id)}" aria-label="Edit ${esc(local.port)} to ${esc(remote.port)}"><span class="font-mono">${esc(shortInterface(local.port))}</span><span class="endpoint-connector">↔</span><span class="font-mono">${esc(shortInterface(remote.port))}</span><span class="link-status ${state.up?"up":""}"><i></i>${state.label}</span>${icon("settings",14)}</button>`;}).join("")}</div>`:""}<form id="connection-form"><div class="connection-section-heading"><span>New connections</span><button type="button" class="connection-add" id="add-connection-row">${icon("plus",14)} Add another</button></div><div id="connection-rows"></div><p class="connection-footnote">Each cable uses one free interface on each device. Router interfaces may need <code>no shutdown</code>.</p><div id="connection-error" class="text-xs text-rose-600" role="alert"></div></form>`,`<button class="btn" data-action="close-dialog">Cancel</button><button class="btn-primary" form="connection-form" id="connect-submit">Connect</button>`);
  const renderRows=()=>{
    $("#connection-rows").innerHTML=drafts.length?drafts.map((row,index)=>`<div class="connection-row"><span class="connection-row-number">${index+1}</span>${([['a',a,ap],['b',b,bp]] as const).map(([side,d,ports])=>`<label class="field"><span class="sr-only">${esc(d.config.hostname)} interface for link ${index+1}</span><select data-connection-side="${side}" data-connection-index="${index}" aria-label="${esc(d.config.hostname)} interface for link ${index+1}">${ports.map(p=>`<option value="${esc(p.name)}" ${row[side]===p.name?"selected":""} ${drafts.some((other,i)=>i!==index&&other[side]===p.name)?"disabled":""}>${esc(shortInterface(p.name))}${!p.adminUp?" · admin down":""}</option>`).join("")}</select></label>`).join('<span class="endpoint-connector">↔</span>')}<button type="button" class="icon-btn" data-remove-connection="${index}" aria-label="Remove new link ${index+1}">${icon("close",14)}</button></div>`).join(""):'<p class="connection-empty">'+(!ap.length||!bp.length?'All physical interfaces on one of these devices are in use.':'Choose Add another to prepare a connection.')+'</p>';
    const canAdd=drafts.length<Math.min(ap.length,bp.length,300-sim.lab.links.length);
    ($("#add-connection-row") as HTMLButtonElement).disabled=!canAdd;
    const submit=$("#connect-submit") as HTMLButtonElement;submit.disabled=!drafts.length;submit.textContent=drafts.length>1?`Connect ${drafts.length} links`:"Connect link";
  };
  $("#add-connection-row").onclick=()=>{const left=ap.find(p=>!drafts.some(d=>d.a===p.name)),right=bp.find(p=>!drafts.some(d=>d.b===p.name));if(left&&right){drafts.push({a:left.name,b:right.name});renderRows();}};
  $("#connection-rows").addEventListener("change",event=>{const select=event.target as HTMLSelectElement,index=Number(select.dataset.connectionIndex),side=select.dataset.connectionSide as 'a'|'b';if(!drafts[index]||!['a','b'].includes(side))return;drafts[index][side]=select.value;renderRows();$<HTMLSelectElement>(`select[data-connection-index="${index}"][data-connection-side="${side}"]`).focus();});
  $("#connection-rows").addEventListener("click",event=>{const remove=(event.target as Element).closest<HTMLElement>('[data-remove-connection]');if(remove){drafts.splice(Number(remove.dataset.removeConnection),1);renderRows();}});
  for(const row of $$<HTMLButtonElement>('[data-existing-link]'))row.onclick=()=>{selectLink(row.dataset.existingLink!);editLink(row.dataset.existingLink!);};
  $("#connection-form").addEventListener("submit",event=>{event.preventDefault();try{
    if(!drafts.length)return;
    if(sim.lab.links.length+drafts.length>300)throw Error("A lab can contain up to 300 links.");
    for(const [side,device] of [['a',a],['b',b]] as const){const free=new Set(availablePorts(device).map(p=>p.name)),selectedPorts=drafts.map(row=>row[side]);if(new Set(selectedPorts).size!==selectedPorts.length||selectedPorts.some(p=>!free.has(p)))throw Error("Choose a different available interface for each connection.");}
    let last:Link|undefined;
    transaction(()=>{for(const row of drafts)last=sim.connect({deviceId:aId,port:row.a},{deviceId:bId,port:row.b});setTool("select");});
    if(!last||!sim.lab.links.some(link=>link.id===last!.id))return;
    selectLink(last.id);closeDialog();toast(`${drafts.length===1?"Connection":drafts.length+" connections"} added. Click a cable or interface badge to inspect it.`);
  }catch(error){$("#connection-error").textContent=message(error);}});
  renderRows();
}
function editLink(id: string) {
  const l = sim.lab.links.find((l) => l.id === id);
  if (!l) return;
  formDialog(
    "Ethernet link",
    `<p class="text-xs text-slate-500">${esc(sim.getDevice(l.a.deviceId)?.config.hostname)} ${esc(l.a.port)} ↔ ${esc(sim.getDevice(l.b.deviceId)?.config.hostname)} ${esc(l.b.port)}</p><div class="grid grid-cols-2 gap-4">${textField("One-way delay (ms)", "delay", l.delay)}${textField("Packet loss (%)", "loss", l.loss * 100)}</div><details class="text-xs"><summary class="cursor-pointer text-slate-500">Directional failure settings</summary><div class="mt-3 grid grid-cols-2 gap-4">${textField("A → B loss (%)", "lossAB", l.lossAB === undefined ? "" : l.lossAB * 100, "Use shared loss")}${textField("B → A loss (%)", "lossBA", l.lossBA === undefined ? "" : l.lossBA * 100, "Use shared loss")}</div><p class="mt-2 text-[10px] text-slate-400">A is the first endpoint above. Useful for UDLD and asymmetric failure labs.</p></details><label class="flex items-center gap-2"><input type="checkbox" name="enabled" ${l.enabled ? "checked" : ""}> Link enabled</label>${linkMediumFields(l)}`,
    (f) => {
      const delay = Number(f.get("delay")),
        loss = Number(f.get("loss")) / 100;
      if (
        !Number.isFinite(delay) ||
        delay < 0 ||
        delay > 60000 ||
        !Number.isFinite(loss) ||
        loss < 0 ||
        loss > 1
      )
        throw Error("Enter a delay from 0–60000 ms and loss from 0–100%.");
      const direction = (key: string) => {
        const value = String(f.get(key)).trim();
        if (!value) return undefined;
        const result = Number(value) / 100;
        if (!Number.isFinite(result) || result < 0 || result > 1)
          throw Error("Directional loss must be 0–100%.");
        return result;
      };
      const physical=readLinkMedium(f);
      const lossAB = direction("lossAB"),
        lossBA = direction("lossBA");
      transaction(() => {
        l.physical=physical;
        l.lossAB = lossAB;
        l.lossBA = lossBA;
        l.delay = delay;
        l.loss = loss;
        l.enabled = f.has("enabled");
      });
    },
  );
}
function removeSelection() {
  if (!selected.size && !selectedLink) return;
  transaction(() => {
    for (const id of selected)
      if (sim.lab.devices.some((d) => d.id === id)) sim.removeDevice(id);
    sim.lab.notes = sim.lab.notes.filter((n) => !selected.has(n.id));
    if (selectedLink) sim.disconnect(selectedLink);
    selected.clear();
    selectedLink = null;
    if (activeDevice && !sim.getDevice(activeDevice)) {
      activeDevice = null;
      renderTerminal();
    }
  });
}
function copySelection(cut = false) {
  if (!selected.size) return;
  clipboard = {
    notes: structuredClone(sim.lab.notes.filter((n) => selected.has(n.id))),
    devices: structuredClone(sim.lab.devices.filter((d) => selected.has(d.id))),
    links: structuredClone(
      sim.lab.links.filter(
        (l) => selected.has(l.a.deviceId) && selected.has(l.b.deviceId),
      ),
    ),
  };
  if (cut) removeSelection();
  else toast(`${selected.size} item${selected.size === 1 ? "" : "s"} copied`);
}
function pasteSelection() {
  if (!clipboard) return;
  if (sim.lab.devices.length + clipboard.devices.length > 100)
    return toast("A lab can contain up to 250 devices.");
  if (sim.lab.notes.length + (clipboard.notes?.length || 0) > 100)
    return toast("A lab can contain up to 100 notes.");
  if (sim.lab.links.length + clipboard.links.length > 300)
    return toast("A lab can contain up to 300 links.");
  transaction(() => {
    const ids = new Map<string, string>();
    selected.clear();
    for (const n of clipboard.notes || []) {
      const copy = { ...n, id: crypto.randomUUID(), x: n.x + 50, y: n.y + 50 };
      sim.lab.notes.push(copy);
      selected.add(copy.id);
    }
    for (const original of clipboard.devices) {
      const d = sim.addDevice(original.kind, original.x + 50, original.y + 50);
      ids.set(original.id, d.id);
      d.config = structuredClone(original.config);
      const base = d.config.hostname.slice(0, 50);
      let suffix = 1;
      let name = `${base}-copy`;
      while (
        sim.lab.devices.some(
          (other) => other.id !== d.id && other.config.hostname === name,
        )
      )
        name = `${base}-copy${++suffix}`;
      d.config.hostname = name;
      d.config.features.positionLocked = false;
      d.startupConfig = original.startupConfig
        ? structuredClone(original.startupConfig)
        : undefined;
      if (d.startupConfig) d.startupConfig.hostname = name;
      d.powered = original.powered;
      selected.add(d.id);
    }
    for (const l of clipboard.links) {
      const nl = sim.connect(
        { deviceId: ids.get(l.a.deviceId)!, port: l.a.port },
        { deviceId: ids.get(l.b.deviceId)!, port: l.b.port },
      );
      nl.delay = l.delay;
      nl.loss = l.loss;
      nl.lossAB = l.lossAB;
      nl.lossBA = l.lossBA;
      nl.enabled = l.enabled;
    }
  });
}

function powerDevices(devices: Device[], powered: boolean) {
  const affected = devices.filter((d) => d.kind!=='ap'&&!endpointUsesPoE(d)&&d.powered !== powered);
  transaction(() => {
    for (const d of affected) {
      sim.power(d.id, powered);
      sessions.delete(d.id);
    }
  });
  closeDialog();
  renderTerminal();
}

function exportLab() {
  try {
    download(fileName(sim.lab.name), serializeLabFile(documentState()));
  } catch (error) {
    toast(`Could not export lab: ${message(error)}`);
    return;
  }
  dirtyFile = false;
  dirty = true;
  toast("YAML lab exported with running and startup configurations.");
}
function restoreView(doc: LabDocument) {
  const view = (doc as LabDocument & { view?: Viewport }).view;
  if (
    view &&
    [view.x, view.y, view.scale].every(Number.isFinite) &&
    view.scale >= 0.2 &&
    view.scale <= 3
  ) {
    viewport = { ...view };
    return true;
  }
  return false;
}
function importLab(doc: LabDocument) {
  const before = snapshot();
  try {
    sim.load(doc);
    undoStack.push(before);
    redoStack.length = 0;
    selected.clear();
    sessions.clear();
    activeDevice = null;
    dirtyFile = false;
    dirty = true;
    closeDialog();
    renderTerminal();
    if (!restoreView(doc)) setTimeout(fit, 0);
    toast(`Opened ${sim.lab.name}`);
  } catch (e) {
    sim.load(JSON.parse(before));
    toast(message(e));
  }
}
function filesDialog() {
  let labs: ReturnType<typeof listSaved> = [],
    err = "";
  try {
    labs = listSaved();
  } catch (e) {
    err = message(e);
  }
  dialog(
    "My labs",
    `<div class="grid grid-cols-2 gap-3"><button class="btn py-4" data-action="import">${icon("upload")} Open a YAML lab</button><button class="btn py-4" data-action="save-local">${icon("save")} Save in this browser</button></div><div class="mt-6 flex items-center justify-between"><span class="section-label">Saved in this browser</span><span class="text-[10px] text-slate-400">Current workspace saves automatically</span></div>${err ? `<p class="notice mt-3">${esc(err)}</p>` : ""}<div class="mt-3 divide-y divide-slate-100">${labs.length ? labs.map((l) => `<div class="flex items-center justify-between gap-2 py-3"><button data-open-saved="${esc(l.id)}" class="min-w-0 flex-1 text-left"><div class="truncate text-xs font-semibold">${esc(l.name)}</div><div class="mt-1 text-[10px] text-slate-400">${new Date(l.savedAt).toLocaleString()}</div></button><button class="icon-btn" data-rename-saved="${esc(l.id)}" aria-label="Rename ${esc(l.name)}">${icon("edit", 16)}</button><button class="icon-btn" data-download-saved="${esc(l.id)}" title="Export saved lab" aria-label="Export ${esc(l.name)}">${icon("download", 16)}</button><button class="icon-btn" data-delete-saved="${esc(l.id)}" title="Delete saved lab" aria-label="Delete ${esc(l.name)}">${icon("trash", 16)}</button></div>`).join("") : '<p class="py-5 text-xs text-slate-400">No saved labs yet. Export a file for a portable backup.</p>'}</div><p class="mt-4 text-[10px] leading-5 text-slate-400">Browser saves depend on browser permissions and can be cleared with browsing data. A downloaded lab file is the reliable way to move or back up your work.</p>`,
    `<button class="btn" data-action="new-lab">New empty lab</button><button class="btn-primary" data-action="close-dialog">Done</button>`,
  );

}

function desktop(d: Device) {
  dialog(
    `${d.config.hostname} · Desktop`,
    `<div class="desktop-grid"><button class="desktop-card" data-desktop="ip" data-id="${d.id}"><span class="text-teal">${icon("settings", 28)}</span>IP configuration</button><button class="desktop-card" data-desktop="cli" data-id="${d.id}"><span class="text-teal">${icon("terminal", 28)}</span>Command prompt</button><button class="desktop-card" data-desktop="tools" data-id="${d.id}"><span class="text-teal">${icon("settings", 28)}</span>Network tools</button><button class="desktop-card" data-desktop="browser" data-id="${d.id}"><span class="text-teal">${icon("globe", 28)}</span>Web browser</button>${d.kind !== "server" ? `<button class="desktop-card" data-desktop="profile" data-id="${d.id}"><span class="text-teal">${icon("pc", 28)}</span>Client profile</button>`:""}${d.kind === "server" ? `<button class="desktop-card" data-desktop="services" data-id="${d.id}"><span class="text-teal">${icon("server", 28)}</span>Services</button>` : ""}</div><p class="mt-5 text-[11px] leading-5 text-slate-400">These tools operate inside your simulated network.</p>`,
  );
}
function hostProfile(d: Device) {
  if(!['pc','laptop'].includes(d.kind))return;
  const endpoint=d.config.features.endpoint??{role:'computer',power:'external'},roles=d.kind==='pc'?[['computer','Computer'],['printer','Printer'],['iot','IoT appliance'],['phone','VoIP phone']]:[['computer','Computer']];
  const select=(label:string,name:string,value:string,options:string[][])=>`<label class="field">${label}<select name="${name}">${options.map(([id,text])=>`<option value="${id}" ${id===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
  formDialog(`${d.config.hostname} · Client profile`,`${select('Operating system','host-os',d.config.features.hostOS??'windows',[['windows','Windows'],['linux','Linux'],['macos','macOS']])}${select('Endpoint role','endpoint-role',endpoint.role,roles)}${d.kind==='pc'?select('Power source','endpoint-power',endpoint.power,[['external','External power'],['poe','PoE from switch']]):''}<p class="text-xs leading-5 text-slate-500">The operating system selects the network console commands. Printers, appliances and phones use the same network stack. Phones require PoE and learn their voice VLAN from the connected switch.</p>`,f=>{
    const hostOS=String(f.get('host-os')),role=String(f.get('endpoint-role')),power=role==='phone'?'poe':role==='computer'?'external':d.kind==='pc'?String(f.get('endpoint-power')):'external';
    if(!['windows','linux','macos'].includes(hostOS)||!roles.some(([id])=>id===role)||!['external','poe'].includes(power))throw Error('Select a valid client profile.');
    validateEndpoint(d.kind,{...d.config,features:{...d.config.features,endpoint:{role,power}}});const wasPoE=endpointUsesPoE(d),hardwareChanged=endpoint.role!==role||endpoint.power!==power;sessions.get(d.id)?.cli.cancel();transaction(()=>{d.config.features.hostOS=hostOS;d.config.features.endpoint={role,power};if(wasPoE&&!endpointUsesPoE(d)){d.powered=true;delete d.runtime.features.poePower;}if(hardwareChanged)sim.restartEndpointInterface(d.id);});sessions.delete(d.id);ensureConsoleSession(d.id);dirty=true;
  });
  const role=$<HTMLSelectElement>('[name="endpoint-role"]'),power=document.querySelector<HTMLSelectElement>('[name="endpoint-power"]');if(power){const update=()=>{if(role.value==='phone')power.value='poe';if(role.value==='computer')power.value='external';power.disabled=['phone','computer'].includes(role.value);};role.addEventListener('change',update);update();}
}
function hostConfig(d: Device) {
  const p = d.kind==='phone'?d.config.interfaces.Network:Object.values(d.config.interfaces)[0];
  const mode4 = p.features.dhcp ? "dhcp" : "manual";
  const mode6 = p.features.ipv6Autoconfig
    ? p.features.dhcpv6Client
      ? "both"
      : "slaac"
    : p.features.dhcpv6Client
      ? "dhcpv6"
      : "manual";
  const modeSelect = (
    name: string,
    value: string,
    choices: Array<[string, string]>,
  ) =>
    `<label class="field">${name === "mode4" ? "IPv4" : "IPv6"} addressing mode<select name="${name}">${choices.map(([key, label]) => `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  formDialog(
    `${d.config.hostname} · IP configuration`,
    `<div class="flex items-center justify-between"><span class="section-label">${esc(p.name)} · IPv4</span><button type="button" class="btn" id="request-dhcp">Request DHCP lease</button></div>
    ${modeSelect("mode4", mode4, [
      ["manual", "Manual"],
      ["dhcp", "DHCP"],
    ])}
    <div class="grid grid-cols-2 gap-4">${textField("IPv4 address", "ip", p.ip || "", "192.168.10.10")}${textField("Subnet mask", "mask", p.mask || "", "255.255.255.0")}${textField("Default gateway", "gateway", d.config.defaultGateway || "")}${textField("DNS servers (comma-separated)", "dns", d.config.dnsServers.join(", "))}</div>
    <div class="flex flex-wrap items-center justify-between gap-2 pt-3"><span class="section-label">IPv6</span><div class="flex gap-2"><button type="button" class="btn" id="request-slaac">Auto (SLAAC)</button><button type="button" class="btn" id="request-dhcpv6">DHCPv6</button></div></div>
    ${modeSelect("mode6", mode6, [
      ["manual", "Manual"],
      ["slaac", "SLAAC"],
      ["dhcpv6", "DHCPv6"],
      ["both", "SLAAC + DHCPv6"],
    ])}
    <p class="text-[10px] text-slate-400">Link-local: ${esc(sim.linkLocalAddress(d.id, p.name))}</p>${textField("IPv6 addresses (comma-separated, with /prefix)", "ipv6", p.ipv6.join(", "), "2001:db8:10::10/64")}${textField("IPv6 default gateway", "gateway6", d.config.staticRoutes.find((r) => r.network === "::" && r.prefix === 0)?.nextHop || "", "fe80::1")}
    <p class="text-[11px] text-slate-400">Automatic modes show the current addresses. Select Manual to edit them; saving stops renewals for that address family. DHCPv6 obtains its default gateway from router advertisements.</p>`,
    (f) => {
      const next4 = String(f.get("mode4")),
        next6 = String(f.get("mode6"));
      const ip = String(f.get("ip")).trim(),
        mask = String(f.get("mask")).trim();
      const gateway = String(f.get("gateway")).trim();
      const dns = String(f.get("dns"))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (next4 === "manual") {
        if (ip && !validIPv4(ip)) throw Error("Enter a valid IPv4 address.");
        if (ip && !validMask(mask))
          throw Error("Enter a contiguous IPv4 subnet mask.");
        if (gateway && !validIPv4(gateway))
          throw Error("Enter a valid default gateway.");
        if (dns.some((s) => !validIPv4(s) && !isIPv6(s)))
          throw Error("Enter DNS server addresses.");
      }
      const ipv6 = String(f.get("ipv6"))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const gateway6 = String(f.get("gateway6")).trim();
      if (next6 === "manual") {
        for (const address of ipv6) {
          const parsed = parseCidr(address);
          if (!address.includes("/") || !isIPv6(parsed.address))
            throw Error("Enter IPv6 addresses with a prefix length.");
        }
        if (gateway6 && !isIPv6(gateway6))
          throw Error("Enter a valid IPv6 default gateway.");
      }
      transaction(() => {
        p.adminUp = true;
        if (next4 === "manual") {
          sim.stopAutomaticAddressing(d.id, p.name, "ipv4");
          p.ip = ip || undefined;
          p.mask = mask || undefined;
          d.config.defaultGateway = gateway || undefined;
          d.config.dnsServers = dns;
        } else if (next4 !== mode4) {
          sim.stopAutomaticAddressing(d.id, p.name, "ipv4");
          p.ip = undefined;
          p.mask = undefined;
          d.config.defaultGateway = undefined;
          sim.requestDHCP(d.id, p.name);
        }
        if (next6 === "manual") {
          sim.stopAutomaticAddressing(d.id, p.name, "ipv6");
          p.ipv6 = ipv6;
          d.config.staticRoutes = d.config.staticRoutes.filter(
            (r) => !(r.network === "::" && r.prefix === 0),
          );
          if (gateway6)
            d.config.staticRoutes.push({
              network: "::",
              prefix: 0,
              nextHop: gateway6,
              interface: p.name,
              ad: 1,
            });
        } else if (next6 !== mode6) {
          sim.stopAutomaticAddressing(d.id, p.name, "ipv6");
          p.ipv6 = [];
          d.config.staticRoutes = d.config.staticRoutes.filter(
            (r) =>
              !(r.network === "::" && r.prefix === 0 && r.interface === p.name),
          );
          if (next6 === "slaac" || next6 === "both")
            sim.requestIPv6(d.id, p.name);
          if (next6 === "dhcpv6" || next6 === "both")
            sim.requestDHCPv6(d.id, p.name);
        }
      });
    },
  );
  const updateEditable = () => {
    const manual4 = $<HTMLSelectElement>('[name="mode4"]').value === "manual";
    const manual6 = $<HTMLSelectElement>('[name="mode6"]').value === "manual";
    for (const name of ["ip", "mask", "gateway", "dns", "ipv6", "gateway6"]) {
      const input = $<HTMLInputElement>(`[name="${name}"]`);
      input.readOnly = !(name === "ipv6" || name === "gateway6"
        ? manual6
        : manual4);
      input.classList.toggle("opacity-60", input.readOnly);
    }
  };
  $('[name="mode4"]').addEventListener("change", updateEditable);
  $('[name="mode6"]').addEventListener("change", updateEditable);
  updateEditable();
  const request6 = (dhcp: boolean) => {
    checkpoint();
    try {
      const result = dhcp
        ? sim.requestDHCPv6(d.id, p.name)
        : sim.requestIPv6(d.id, p.name);
      sim.advance(9500);
      dirtyFile = true;
      dirty = true;
      hostConfig(d);
      toast(
        result.status === "success"
          ? "IPv6 configuration received."
          : result.error || "IPv6 request sent. Check the assigned address.",
      );
    } catch (e) {
      toast(message(e));
    }
  };
  $("#request-slaac").onclick = () => request6(false);
  $("#request-dhcpv6").onclick = () => request6(true);
  $("#request-dhcp").addEventListener("click", () => {
    checkpoint();
    try {
      sim.requestDHCP(d.id);
      sim.advance(5000);
      dirtyFile = true;
      dirty = true;
      hostConfig(d);
      toast("DHCP request sent. Check the assigned lease.");
    } catch (e) {
      toast(message(e));
    }
  });
}
function validIPv4(v: string) {
  const p = v.split(".");
  return (
    p.length === 4 && p.every((n) => /^\d{1,3}$/.test(n) && Number(n) <= 255)
  );
}
function validMask(v: string) {
  if (!validIPv4(v)) return false;
  const bits = v
    .split(".")
    .map((n) => Number(n).toString(2).padStart(8, "0"))
    .join("");
  return /^1*0*$/.test(bits);
}
function interfaceConfig(d: Device, name: string) {
  const p = d.config.interfaces[name];
  if (!p) return;
  formDialog(
    `${d.config.hostname} · ${name}`,
    `${textField("Description", "description", p.description)}${!p.switchport ? `<div class="grid grid-cols-2 gap-4">${textField("IPv4 address", "ip", p.ip || "")}${textField("Subnet mask", "mask", p.mask || "")}</div>` : ""}${p.switchport ? `<div class="grid grid-cols-2 gap-4"><label class="field">Switchport mode<select name="mode">${["access", "trunk", "dynamic-auto", "dynamic-desirable"].map((m) => `<option ${m === p.mode ? "selected" : ""}>${m}</option>`).join("")}</select></label>${textField("Access VLAN", "vlan", p.vlan)}</div>` : ""}<div class="grid grid-cols-2 gap-4">${textField("IP MTU", "mtu", p.mtu)}<label class="mt-6 flex items-center gap-2"><input type="checkbox" name="up" ${p.adminUp ? "checked" : ""}>Enabled (no shutdown)</label></div>`,
    (f) => {
      const ip = p.switchport ? p.ip : String(f.get("ip") ?? "").trim(),
        mask = p.switchport ? p.mask : String(f.get("mask") ?? "").trim(),
        mtu = Number(f.get("mtu"));
      if (ip && (!validIPv4(ip) || !validMask(mask || "")))
        throw Error("Enter a valid IPv4 address and contiguous mask.");
      if (!Number.isInteger(mtu) || mtu < 68 || mtu > 65535)
        throw Error("MTU must be 68–65535 bytes.");
      transaction(() => {
        if (
          !p.switchport &&
          ((ip || undefined) !== p.ip || (mask || undefined) !== p.mask)
        )
          sim.stopAutomaticAddressing(d.id, p.name, "ipv4");
        p.ip = ip || undefined;
        p.mask = mask || undefined;
        p.adminUp = f.has("up");
        p.mtu = mtu;
        p.description = String(f.get("description"));
        if (p.switchport) {
          p.mode = String(f.get("mode")) as typeof p.mode;
          p.vlan = Math.max(1, Math.min(4094, Number(f.get("vlan")) || 1));
        }
      });
    },
  );
}
function wirelessDialog(d:Device){showWireless(sim,d,formDialog,transaction,()=>{closeDialog();openConsole(d.id);},()=>{closeDialog();desktop(d);});}
function servicesDialog(d: Device) {
  showServices(d, formDialog, transaction, sim);
}

function browserDialog(d: Device) {
  const history: string[] = [];
  let currentURL = "http://intranet.lab/",
    hasPage = false,
    credentialOrigin = "";
  const requestOptions = (url: string): HTTPRequestOptions => {
    const username = $<HTMLInputElement>("#browser-username").value;
    const password = $<HTMLInputElement>("#browser-password").value;
    return new URL(url).origin === credentialOrigin && (username || password)
      ? { headers: { Authorization: basicAuthorization(username, password) } }
      : {};
  };
  dialog(
    `${d.config.hostname} · Web browser`,
    `<form id="browser-form" class="flex gap-2"><button type="button" id="browser-back" class="btn" aria-label="Back in simulated browser" disabled>${icon("undo", 15)}</button><input id="browser-url" aria-label="Simulated web address" class="min-w-0 flex-1 text-xs" value="" placeholder="http://192.168.10.100"><button class="btn-primary">Go</button></form><details class="mt-3"><summary class="cursor-pointer text-[11px] text-slate-500">Lab HTTP login</summary><div class="mt-2 grid grid-cols-2 gap-3"><label class="field">Username<input id="browser-username" autocomplete="off"></label><label class="field">Password<input id="browser-password" type="password" autocomplete="off"></label></div><p class="mt-2 text-[10px] text-slate-400">Use lab-only credentials. Press Go to send them to the simulated address above.</p></details><div id="browser-status" class="my-3 text-[11px] text-slate-400">Enter the address of an HTTP server in your lab.</div><iframe id="browser-page" title="Simulated website" sandbox="allow-same-origin" class="h-[330px] w-full rounded-lg border border-slate-200 bg-white"></iframe>`,
    "",
    true,
  );
  const frame = $<HTMLIFrameElement>("#browser-page");
  const visit = (address: string, record = true) => {
    try {
      const url = new URL(
        address.includes("://")
          ? address
          : address.startsWith("/")
            ? address
            : "http://" + address,
        currentURL,
      ).href;
      const result = sim.httpRequest(d.id, url, requestOptions(url));
      sim.advance(10000);
      $("#browser-status").textContent =
        result.error ||
        (result.statusCode
          ? `${result.statusCode} ${({ 200: "OK", 400: "Invalid request", 401: "Authentication required", 403: "Forbidden", 404: "Not found", 405: "Method not allowed", 503: "Service unavailable" } as Record<number, string>)[result.statusCode] || "HTTP response"}`
          : result.status);
      if (result.status === "success" && typeof result.body === "string") {
        if (record && hasPage && currentURL !== url) history.push(currentURL);
        hasPage = true;
        currentURL = url;
        $<HTMLInputElement>("#browser-url").value = url;
        const parsed = new DOMParser().parseFromString(
          result.body,
          "text/html",
        );
        let css = "";
        for (const link of [
          ...parsed.querySelectorAll('link[rel="stylesheet"][href]'),
        ].slice(0, 10)) {
          const resourceURL = new URL(link.getAttribute("href")!, url).href;
          const resource = sim.httpRequest(
            d.id,
            resourceURL,
            requestOptions(resourceURL),
          );
          sim.advance(10000);
          if (resource.status === "success" && resource.statusCode === 200)
            css += String(resource.body || "") + "\n";
        }
        for (const img of [...parsed.querySelectorAll("img[src]")].slice(
          0,
          20,
        )) {
          const src = img.getAttribute("src")!;
          if (src.startsWith("data:")) continue;
          const resourceURL = new URL(src, url).href;
          const resource = sim.httpRequest(
            d.id,
            resourceURL,
            requestOptions(resourceURL),
          );
          sim.advance(10000);
          if (
            resource.status === "success" &&
            resource.statusCode === 200 &&
            typeof resource.body === "string" &&
            resource.body.startsWith("data:image/")
          )
            img.setAttribute("src", resource.body);
          else img.removeAttribute("src");
        }
        frame.srcdoc = safePage(parsed.documentElement.outerHTML, css);
      } else if (result.status === "failure")
        frame.srcdoc = safePage(
          `<h1>Page unavailable</h1><p>${esc(result.error || "The server did not respond.")}</p>`,
        );
      $<HTMLButtonElement>("#browser-back").disabled = !history.length;
    } catch (err) {
      $("#browser-status").textContent = message(err);
    }
  };
  frame.addEventListener("load", () =>
    frame.contentDocument?.addEventListener("click", (event) => {
      const anchor = (event.target as Element).closest<HTMLElement>(
        "[data-lab-url]",
      );
      if (anchor) {
        event.preventDefault();
        try {
          visit(new URL(anchor.dataset.labUrl!, currentURL).href);
        } catch {}
      }
    }),
  );
  $("#browser-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const address = $<HTMLInputElement>("#browser-url").value;
    try {
      credentialOrigin = new URL(
        address.includes("://") || address.startsWith("/") ? address : "http://" + address,
        currentURL,
      ).origin;
    } catch {
      credentialOrigin = "";
    }
    visit(address);
  });
  $("#browser-back").addEventListener("click", () => {
    const url = history.pop();
    if (url) visit(url, false);
  });
}
function safePage(content: string, extraCSS = "") {
  const dom = new DOMParser().parseFromString(content, "text/html");
  const css =
    [...dom.querySelectorAll("style")]
      .map((el) => el.textContent || "")
      .join("\n") +
    "\n" +
    extraCSS;
  for (const el of dom.querySelectorAll(
    "script,iframe,object,embed,link,meta,base,form,style",
  ))
    el.remove();
  for (const el of dom.querySelectorAll("*")) {
    const href = el.getAttribute("href");
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on") ||
        [
          "srcdoc",
          "srcset",
          "href",
          "action",
          "formaction",
          "poster",
          "target",
          "data-lab-url",
        ].includes(name)
      )
        el.removeAttribute(attr.name);
      if (
        name === "src" &&
        !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(
          attr.value,
        )
      )
        el.removeAttribute(attr.name);
    }
    if (
      el.tagName === "A" &&
      href &&
      !/^(javascript|data|file|vbscript):/i.test(href)
    ) {
      el.setAttribute("data-lab-url", href);
      el.setAttribute("href", "#");
    }
  }
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 -apple-system,sans-serif;color:#254354;padding:22px}h1{font-size:24px}${css.replace(/<\/style/gi, "<\\/style")}</style></head><body>${dom.body.innerHTML}</body></html>`;
}

function capabilitiesDialog() {
  const rows = [
    ...Object.entries(CLI_CAPABILITIES).map(([name, items]) => ({
      name,
      description: items.join(" · "),
    })),
    ...Object.entries(CONTROL_PLANE_CAPABILITIES).map(
      ([name, description]) => ({ name, description }),
    ),
  ];
  dialog(
    "Supported behavior",
    `<p class="mb-4 text-xs leading-6 text-slate-500">This simulator implements the behaviors below. Computed control-plane models and packet exchanges are distinguished. Use <code>show capabilities</code> in a console for this information while configuring a lab.</p><label class="field">Find a feature<input id="capability-search" type="search" placeholder="OSPF, authentication, multicast…"></label><div class="mt-4 space-y-3">${rows.map((row) => `<section data-capability="${esc((row.name + " " + row.description).toLowerCase())}" class="rounded-xl border border-slate-200 p-4"><h3 class="text-xs font-semibold uppercase tracking-wide text-teal">${esc(row.name === "configurationOnly" ? "Configuration only" : row.name)}</h3><p class="mt-2 text-xs leading-6 text-slate-500">${esc(row.description)}</p></section>`).join("")}</div>`,
    '<button class="btn-primary" data-action="close-dialog">Done</button>',
    true,
  );
  $("#capability-search").addEventListener("input", (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
    for (const row of $$("[data-capability]"))
      row.hidden = !row.dataset.capability!.includes(query);
  });
}

const actions: Record<string, () => void> = {
  'toggle-theme': () => {
    colorTheme = colorTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = colorTheme;
    document.documentElement.style.colorScheme = colorTheme;
    try { localStorage.setItem(THEME_KEY, colorTheme); } catch { /* Keep this session's selection. */ }
    syncThemeToggle();
  },
  simulation:()=>showSimulation(sim,dialog,{playing:()=>playing,setPlaying:value=>{playing=value;dirty=true;}}),
  "edit-note": () => {
    const n = sim.lab.notes.find((n) => selected.has(n.id));
    if (n) addNote(undefined, n.id);
  },
  "lock-note": () => {
    const note = sim.lab.notes.find(n => selected.has(n.id));
    if (note) transaction(() => { note.locked = !note.locked; });
  },
  "tool-select": () => setTool("select"),
  "tool-link": () => setTool("link"),
  "connect-device": () => {
    const device = selectedDevice();
    if (!device) return;
    if (!portOptions(device))
      return toast(`${device.config.hostname} has no available physical interfaces.`);
    setTool("link");
    linkStart = device.id;
    selectDevice(device.id);
    toast(`Choose another device to connect to ${device.config.hostname}.`);
    svg.focus();
  },
  "tool-note": () => setTool("note"),
  undo: () => undo(),
  redo: () => undo(true),
  delete: removeSelection,
  "zoom-in": () => zoom(1.2),
  "zoom-out": () => zoom(1 / 1.2),
  "zoom-reset": () => zoom(1 / viewport.scale),
  fit,
  inspector: () => {
    inspectorOpen = !inspectorOpen;
    dirty = true;
  },
  "rename-lab": renameLab,
  "rename-device": renameDevice,
  "open-device": () => {
    const d = selectedDevice();
    if (d) openDevice(d.id);
  },
  "power-device": () => {
    const d = selectedDevice();
    if (d&&d.kind!=='ap'&&!endpointUsesPoE(d)) powerDevices([d], !d.powered);
  },
  "power-lab": () => {
    dialog(
      "Power controls",
      `<p class="text-xs leading-6 text-slate-500">Power changes clear learned tables and active protocol sessions. Devices boot from their startup configuration. AP and phone power follow the connected PoE switch and port.</p>`,
      `<button class="btn" id="all-off">Power off all</button><button class="btn-primary" id="all-on">Power on all</button>`,
    );
    $("#all-off").onclick = () => powerDevices(sim.lab.devices, false);
    $("#all-on").onclick = () => powerDevices(sim.lab.devices, true);
  },
  "lock-device": () => {
    const d = selectedDevice();
    if (d)
      transaction(
        () =>
          (d.config.features.positionLocked =
            !d.config.features.positionLocked),
      );
  },
  "tab-console": () => {
    const device = (activeDevice && sim.getDevice(activeDevice)) || selectedDevice() || sim.lab.devices[0];
    if (device) return openConsole(device.id);
    setDock(true);
    renderTerminal();
  },
  "close-dock": () => { stashTerminal(); setDock(false); $("#topology").focus(); },
  "maximize-dock": () => { dockMaximized = !dockMaximized; renderDock(); revealConsoleDevice(); dirty = true; },
  "terminal-bottom": () => focusTerminal(true),
  "edit-selected-link": () => { if (selectedLink) editLink(selectedLink); },
  "previous-link": () => cycleLink(-1),
  "next-link": () => cycleLink(1),
  "host-profile": () => {const d=selectedDevice();if(d)hostProfile(d);},
  "deselect-link": () => {selectedLink=null;dirty=true;},
  "manage-pair-links": () => { const link=sim.lab.links.find(l=>l.id===selectedLink);if(link)connectDialog(link.a.deviceId,link.b.deviceId); },
  "terminal-keys": () => {
    dialog("Terminal keyboard shortcuts", `<div class="terminal-shortcuts"><p>Click anywhere in the terminal to type. Drag across output to select and copy it.</p><dl><dt>Tab · ?</dt><dd>Complete a command · show context help</dd><dt>↑ / ↓ · Ctrl P / N</dt><dd>Command history</dd><dt>Ctrl A / E</dt><dd>Beginning / end of the line</dd><dt>Ctrl U / K / W</dt><dd>Delete before cursor / after cursor / previous word</dd><dt>Ctrl C · Ctrl Z</dt><dd>Cancel input · return to privileged mode</dd><dt>Space / Enter / q</dt><dd>Next page / next line / stop paged output</dd><dt>Ctrl Shift 6, then X</dt><dd>Suspend a remote session</dd><dt>Shift Tab</dt><dd>Move keyboard focus out of the terminal</dd></dl><p>Each device keeps its draft, history and scroll position. Pasted lines execute at line breaks; a final line without a line break remains editable.</p></div>`, '<button class="btn-primary" data-action="close-dialog">Done</button>');
  },
  files: filesDialog,
  export: exportLab,
  import: () => $<HTMLInputElement>("#import-input").click(),
  "save-local": () => {
    try {
      saveLocal(documentState());
      dirtyFile = false;
      dirty = true;
      filesDialog();
      toast("Lab saved in this browser");
    } catch (e) {
      toast(`Browser save failed: ${message(e)}`);
    }
  },
  "new-lab": () => {
    checkpoint();
    const doc = documentState();
    doc.lab = {
      id: crypto.randomUUID(),
      name: "Untitled lab",
      devices: [],
      links: [],
      notes: [],
    };
    sim.load(doc);
    sessions.clear();
    activeDevice = null;
    selected.clear();
    closeDialog();
    fit();
    dirty = true;
    renderTerminal();
  },
  "close-dialog": closeDialog,
  help: capabilitiesDialog,
  capabilities: capabilitiesDialog,
  "cli-escape": () => {
    const state = activeDevice ? sessions.get(activeDevice) : undefined;
    if (state) {
      state.lines.push(...state.cli.escape());
      $<HTMLInputElement>("#terminal-input").value = "";
      renderTerminal();
    }
  },
  "cli-more": () => pageTerminal(),
  "cli-tab": () => cliComplete(),
  "cli-help": () => cliComplete(true),
  copy: () => copySelection(),
  cut: () => copySelection(true),
  paste: pasteSelection,
  duplicate: () => {
    copySelection();
    pasteSelection();
  },
  "copy-console": () => {
    const s = activeDevice ? sessions.get(activeDevice) : null;
    if (s)
      navigator.clipboard
        ?.writeText(s.lines.join("\n"))
        .then(() => toast("Console copied"))
        .catch(() =>
          toast("Clipboard unavailable. Select and copy the console text."),
        );
  },
  "export-config": () => {
    const d = selectedDevice();
    if (d) {
      const s = new IOSSession(sim, d.id);
      s.execute("enable");
      download(
        `${d.config.hostname}.txt`,
        s.execute("show running-config").join("\n"),
        "text/plain",
      );
    }
  },
};
document.addEventListener("click", (e) => {
  const target = e.target as Element;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action && actions[action]) {
    e.preventDefault();
    if (target.closest(".mini-menu")) closeContextMenu(true);
    actions[action]();
  }
  const palette = target.closest<HTMLElement>("[data-kind]");
  if (palette) addDevice(palette.dataset.kind as DeviceKind);
  const session = target.closest<HTMLElement>("[data-session]");
  if (session) openConsole(session.dataset.session!);
  const port = target.closest<HTMLElement>("[data-port]");
  if (port) {
    const d = selectedDevice();
    if (d) interfaceConfig(d, port.dataset.port!);
  }
  const desktop = target.closest<HTMLElement>("[data-desktop]");
  if (desktop) {
    const d = sim.getDevice(desktop.dataset.id!);
    if (d) {
      const fn = desktop.dataset.desktop;
      if (fn === "profile") hostProfile(d);
      if (fn === "ip") hostConfig(d);
      if (fn === "services") servicesDialog(d);
      if (fn === "tools") showNetworkTools(sim,d,dialog);
      if (fn === "browser") browserDialog(d);
      if (fn === "cli") {
        closeDialog();
        openConsole(d.id);
      }
    }
  }
  const open = target.closest<HTMLElement>("[data-open-saved]");
  if (open) {
    try {
      const l = listSaved().find((l) => l.id === open.dataset.openSaved);
      if (l) importLab(parseDocument(JSON.stringify(l.document)));
    } catch (err) {
      toast(message(err));
    }
  }
  const rename = target.closest<HTMLElement>("[data-rename-saved]");
  if (rename) {
    const saved = listSaved().find((l) => l.id === rename.dataset.renameSaved);
    if (saved)
      formDialog(
        "Rename saved lab",
        textField("Lab name", "name", saved.name, "", true),
        (f) => {
          const name = String(f.get("name")).trim();
          renameLocal(saved.id, name);
          if (sim.lab.id === saved.id)
            transaction(() => {
              sim.lab.name = name;
            });
          toast("Saved lab renamed");
        },
        "Rename",
      );
  }
  const del = target.closest<HTMLElement>("[data-delete-saved]");
  if (del) {
    try {
      deleteLocal(del.dataset.deleteSaved!);
      filesDialog();
    } catch (err) {
      toast(message(err));
    }
  }
  const dl = target.closest<HTMLElement>("[data-download-saved]");
  if (dl) {
    const l = listSaved().find((l) => l.id === dl.dataset.downloadSaved);
    if (l) {
      try { download(fileName(l.name), serializeLabFile(l.document)); }
      catch (error) { toast(`Could not export lab: ${message(error)}`); }
    }
  }
  if (!target.closest(".mini-menu"))
    closeContextMenu();
});
document.addEventListener("pointerdown", e => {
  if (!(e.target as Element).closest(".mini-menu")) closeContextMenu();
  if (noteEdit && !noteEdit.element.contains(e.target as Node)) finishNoteEdit(true);
}, true);

$("#import-input").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw Error("This lab exceeds the 10 MB file limit.");
    importLab(parseLabFile(await file.text()));
  } catch (err) {
    toast(`Could not open lab: ${message(err)}`);
  }
  input.value = "";
});
let terminalPointer: { x: number; y: number } | null = null;
$("#console-panel").addEventListener("pointerdown", e => { terminalPointer = { x: e.clientX, y: e.clientY }; });
$("#console-panel").addEventListener("pointerup", e => {
  const selection = window.getSelection();
  if (terminalPointer && Math.hypot(e.clientX - terminalPointer.x, e.clientY - terminalPointer.y) < 5 && !selection?.toString() && e.target !== $("#terminal-input")) focusTerminal(true);
  terminalPointer = null;
});
$("#console-panel").addEventListener("scroll", () => { updateTerminalJump(); stashTerminal(); }, { passive: true });
$("#terminal-input").addEventListener("input", () => { stashTerminal(); focusTerminal(true); });
function terminalHistory(direction: number) {
  const state = activeDevice ? sessions.get(activeDevice) : undefined;
  if (!state || (state.cli as any).passwordInput) return;
  const input = $<HTMLInputElement>("#terminal-input");
  if (state.cursor === state.history.length) state.historyDraft = input.value;
  state.cursor = Math.max(0, Math.min(state.history.length, state.cursor + direction));
  input.value = state.cursor === state.history.length ? state.historyDraft ?? "" : state.history[state.cursor];
  input.setSelectionRange(input.value.length, input.value.length);
  stashTerminal(); focusTerminal(true);
}
$("#terminal-input").addEventListener("keydown", e => {
  const input = e.target as HTMLInputElement,
    state = activeDevice ? sessions.get(activeDevice) : undefined;
  if (!state || e.isComposing) return;
  e.stopPropagation();
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === "c" && window.getSelection()?.toString()) return;
  if (e.key === "Tab" && e.shiftKey) return;
  if (e.key === "PageUp" || e.key === "PageDown") {
    e.preventDefault();
    const panel = $("#console-panel");
    panel.scrollTop += panel.clientHeight * .85 * (e.key === "PageUp" ? -1 : 1);
    return;
  }
  if (e.ctrlKey && (e.key === "^" || (e.shiftKey && e.code === "Digit6"))) {
    e.preventDefault(); escapeArmed = activeDevice; return;
  }
  if (escapeArmed) {
    const armed = escapeArmed; escapeArmed = null;
    if (key === "x" && activeDevice === armed) { e.preventDefault(); actions["cli-escape"](); return; }
  }
  if (state.pending?.length) {
    if (e.metaKey || (e.ctrlKey && key !== "c")) return;
    e.preventDefault();
    if (e.key === " " || e.key === "Enter") pageTerminal(e.key === "Enter");
    if (key === "q" || e.key === "Escape" || (e.ctrlKey && key === "c")) pageTerminal(false, true);
    return;
  }
  if (state.cli.busy && !(e.ctrlKey && key === "c")) { e.preventDefault(); return; }
  if (!state.cli.editing && (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key) || e.altKey || e.ctrlKey && ['a','e','b','f','p','n','k','w','t'].includes(key))) { e.preventDefault(); return; }
  if (e.key === 'Escape') { e.preventDefault(); terminalMetaArmed = state.cli.editing ? activeDevice : null; return; }
  if (state.cli.editing && (e.altKey || terminalMetaArmed === activeDevice)) {
    terminalMetaArmed = null;
    const cursor = input.selectionStart ?? input.value.length;
    if (key === 'b' || key === 'f') {
      e.preventDefault();
      const next = key === 'b' ? input.value.slice(0,cursor).replace(/\S+\s*$|\s+$/, '').length : cursor + (input.value.slice(cursor).match(/^\s*\S+\s*/)?.[0].length ?? 0);
      input.setSelectionRange(next,next); stashTerminal(); return;
    }
  }
  if (e.key === "Enter") {
    e.preventDefault(); const line = input.value; input.value = "";
    state.historyDraft = ""; runCommand(line); focusTerminal(true);
  } else if (e.key === "Tab" || (e.ctrlKey && key === "i")) {
    e.preventDefault(); cliComplete(); stashTerminal(); focusTerminal(true);
  } else if (e.key === "?" && !state.cli.windowsMode && !(state.cli as any).passwordInput) {
    e.preventDefault(); cliComplete(true); focusTerminal(true);
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || (e.ctrlKey && (key === "p" || key === "n"))) {
    e.preventDefault(); terminalHistory(e.key === "ArrowUp" || key === "p" ? -1 : 1);
  } else if (e.ctrlKey && key === "c") {
    e.preventDefault(); state.lines.push(state.cli.windowsMode && state.cli.busy ? "^C" : `${state.cli.prompt}${(state.cli as any).passwordInput ? "" : input.value}^C`, ...state.cli.cancel());
    input.value = ""; state.draft = ""; renderTerminal(true);
  } else if (e.ctrlKey && key === "z") {
    e.preventDefault(); const configured=state.cli.configurationMode, line=input.value;
    input.value = ""; state.draft = "";
    if(configured && line.trim())runCommand(line);
    if(state.pending?.length)pageTerminal(false,true);
    state.lines.push(`${state.cli.prompt}^Z`,...state.cli.cancel());
    state.history=[...state.cli.commandHistory];state.cursor=state.history.length;renderTerminal(true);
  } else if (e.ctrlKey && !e.metaKey && !e.altKey) {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    if (["a", "e", "b", "f", "u", "x", "k", "w", "l", "r", "t", "d", "h"].includes(key)) {
      e.preventDefault();
      if (key === "a") input.setSelectionRange(0, 0);
      if (key === "e") input.setSelectionRange(input.value.length, input.value.length);
      if (key === "b") input.setSelectionRange(Math.max(0, a - 1), Math.max(0, a - 1));
      if (key === "f") input.setSelectionRange(Math.min(input.value.length, b + 1), Math.min(input.value.length, b + 1));
      if (key === "u" || key === "x") input.setRangeText("", 0, a, "start");
      if (key === "k") input.setRangeText("", a, input.value.length, "start");
      if (key === "w") input.setRangeText("", input.value.slice(0, a).replace(/\S+\s*$|\s+$/, "").length, b, "end");
      if (key === "h") input.setRangeText("", a === b ? Math.max(0, a - 1) : a, b, "end");
      if (key === "d") {
        if (input.value) input.setRangeText("", a, a === b ? Math.min(input.value.length, b + 1) : b, "end");
      }
      if (key === 't' && a === b && a > 0 && input.value.length > 1) {
        const end = a === input.value.length ? a : a + 1;
        input.setRangeText(input.value[end - 1] + input.value[end - 2], end - 2, end, 'end');
      }
      if (key === "l" || key === "r") renderTerminal(true);
      stashTerminal(); focusTerminal(true);
    }
  }
});
$("#terminal-input").addEventListener("paste", e => {
  const state = activeDevice ? sessions.get(activeDevice) : undefined;
  if (!state || (state.cli as any).passwordInput) return;
  const text = e.clipboardData?.getData("text");
  if (!text || !/[\r\n]/.test(text)) return;
  e.preventDefault();
  const input = e.target as HTMLInputElement;
  const prefix = input.value.slice(0, input.selectionStart ?? input.value.length);
  const suffix = input.value.slice(input.selectionEnd ?? input.value.length);
  const lines = (prefix + text.replace(/\r\n?/g, "\n")).split("\n");
  const tail = lines.pop()! + suffix;
  input.value = "";
  pageTerminal(false, true);
  for (const line of lines.slice(0, 2000)) {
    runCommand(line);
    if (state.pending?.length) { state.lines.push(...state.pending); state.pending = []; }
  }
  input.value = tail; input.setSelectionRange(tail.length, tail.length);
  stashTerminal(); renderTerminal(true); focusTerminal(true);
});

for (const card of $$("[data-kind]"))
  card.addEventListener("dragstart", (e) => {
    (e as DragEvent).dataTransfer?.setData(
      "application/x-network-device",
      card.dataset.kind!,
    );
  });
$("#canvas-wrap").addEventListener("dragover", (e) => e.preventDefault());
$("#canvas-wrap").addEventListener("drop", (e) => {
  e.preventDefault();
  const kind = e.dataTransfer?.getData(
    "application/x-network-device",
  ) as DeviceKind;
  if (kinds.includes(kind)) addDevice(kind, worldPoint(e.clientX, e.clientY));
});
const svg = $("#topology");
svg.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return;
  const panning = spaceHeld || e.button === 1;
  if (e.button === 1) e.preventDefault();
  if (e.pointerType === "touch") {
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.size === 2) {
      const [a, b] = [...touchPoints.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: { ...viewport },
      };
      drag = null;
      clearTimeout(longPress);
      return;
    }
  }
  closeContextMenu();
  const node = (e.target as Element).closest<SVGElement>("[data-device]"),
    note = (e.target as Element).closest<SVGElement>("[data-note]"),
    link = (e.target as Element).closest<SVGElement>("[data-link]");
  const p = worldPoint(e.clientX, e.clientY);
  if (e.pointerType === "touch" && (node || note)) {
    clearTimeout(longPress);
    longPress = setTimeout(() => {
      if (drag && !drag.moved) {
        drag = null;
        (node || note)!.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: e.clientX,
            clientY: e.clientY,
          }),
        );
      }
    }, 550);
  }
  if (tool === "note" && !node && !note && !link && !panning) {
    e.preventDefault();
    addNote(p);
    setTool("select");
    return;
  }
  if (tool === "link" && node && !panning) {
    const id = node.dataset.device!;
    if (!linkStart) {
      linkStart = id;
      selectDevice(id);
    } else if (linkStart !== id) {
      connectDialog(linkStart, id);
      linkStart = null;
    }
    dirty = true;
    return;
  }
  if (link && !node && !panning) {
    e.preventDefault();
    selectLink(link.dataset.link!);
    svg.querySelector<SVGElement>(`.diagram-link:not(.link-label-group)[data-link="${CSS.escape(link.dataset.link!)}"]`)?.focus({preventScroll:true});
    return;
  }
  if (node && !panning) {
    const id = node.dataset.device!;
    if (e.shiftKey && selected.has(id)) {
      selected.delete(id);
      dirty = true;
      return;
    }
    if (!selected.has(id)) selectDevice(id, e.shiftKey);
    const d = sim.getDevice(id);
    if (d?.config.features.positionLocked) return;
    drag = {
      type: "node",
      id,
      start: p,
      pointer: { x: e.clientX, y: e.clientY },
      moved: false,
      positions: new Map(
        [...sim.lab.devices, ...sim.lab.notes]
          .filter((d) => selected.has(d.id))
          .map((d) => [d.id, { x: d.x, y: d.y }]),
      ),
      view: { ...viewport },
    };
  } else if (note && !panning) {
    if (!e.shiftKey && !selected.has(note.dataset.note!)) selected.clear();
    if (e.shiftKey && selected.has(note.dataset.note!)) {
      selected.delete(note.dataset.note!);
      dirty = true;
      return;
    }
    selected.add(note.dataset.note!);
    selectedLink = null;
    if (sim.lab.notes.find(n => n.id === note.dataset.note)?.locked) { dirty = true; return; }
    dirty = true;
    drag = {
      type: "note",
      id: note.dataset.note,
      start: p,
      pointer: { x: e.clientX, y: e.clientY },
      moved: false,
      positions: new Map(
        [...sim.lab.devices, ...sim.lab.notes]
          .filter((item) => selected.has(item.id))
          .map((item) => [item.id, { x: item.x, y: item.y }]),
      ),
      view: { ...viewport },
    };
  } else {
    if (!panning && !e.shiftKey) {
      selected.clear();
      selectedLink = null;
      dirty = true;
    }
    drag = {
      type:
        spaceHeld || e.button === 1 || e.pointerType === "touch"
          ? "pan"
          : "marquee",
      start: p,
      pointer: { x: e.clientX, y: e.clientY },
      moved: false,
      positions: new Map(),
      view: { ...viewport },
    };
  }
});
svg.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch" && touchPoints.has(e.pointerId)) {
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touchPoints.size === 2) {
      const [a, b] = [...touchPoints.values()],
        r = svg.getBoundingClientRect(),
        scale = Math.max(
          0.2,
          Math.min(
            3,
            (pinch.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
              Math.max(1, pinch.distance),
          ),
        ),
        cx = (a.x + b.x) / 2 - r.left,
        cy = (a.y + b.y) / 2 - r.top;
      viewport = {
        scale,
        x:
          cx -
          ((pinch.center.x - r.left - pinch.view.x) * scale) / pinch.view.scale,
        y:
          cy -
          ((pinch.center.y - r.top - pinch.view.y) * scale) / pinch.view.scale,
      };
      dirty = true;
      return;
    }
  }
  if (!drag) return;
  const dx = e.clientX - drag.pointer.x,
    dy = e.clientY - drag.pointer.y;
  if (!drag.moved && Math.hypot(dx, dy) > 3) {
    drag.moved = true;
    if (drag.type === "node" || drag.type === "note") checkpoint();
  }
  if (!drag.moved) return;
  if (!svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
  if (drag.type === "pan") {
    viewport.x = drag.view.x + dx;
    viewport.y = drag.view.y + dy;
  } else if (drag.type === "node" || drag.type === "note") {
    const all = [...sim.lab.devices, ...sim.lab.notes], anchor = all.find(item => item.id === drag!.id)!;
    const origin = drag.positions.get(anchor.id)!;
    const moved = alignMove({ ...geometry(anchor), x: origin.x + dx / viewport.scale, y: origin.y + dy / viewport.scale }, all.filter(item => !drag!.positions.has(item.id)).map(geometry), viewport.scale, e.altKey);
    alignmentGuides = moved.guides;
    for (const [id, start] of drag.positions) {
      const item =
        sim.lab.devices.find((d) => d.id === id) ??
        sim.lab.notes.find((n) => n.id === id);
      if (item && !("config" in item ? item.config.features.positionLocked : item.locked)) {
        item.x = start.x + moved.x - origin.x;
        item.y = start.y + moved.y - origin.y;
      }
    }
  } else {
    const r = svg.getBoundingClientRect(),
      m = document.querySelector("#marquee")!;
    m.setAttribute("x", String(Math.min(drag.pointer.x, e.clientX) - r.left));
    m.setAttribute("y", String(Math.min(drag.pointer.y, e.clientY) - r.top));
    m.setAttribute("width", String(Math.abs(dx)));
    m.setAttribute("height", String(Math.abs(dy)));
    m.setAttribute("visibility", "visible");
    const p = worldPoint(e.clientX, e.clientY);
    for (const d of [...sim.lab.devices, ...sim.lab.notes])
      if (
        d.x >= Math.min(p.x, drag.start.x) &&
        d.x <= Math.max(p.x, drag.start.x) &&
        d.y >= Math.min(p.y, drag.start.y) &&
        d.y <= Math.max(p.y, drag.start.y)
      )
        selected.add(d.id);
      else if (!e.shiftKey) selected.delete(d.id);
  }
  dirty = true;
});
svg.addEventListener("pointerup", (e) => {
  touchPoints.delete(e.pointerId);
  if (touchPoints.size < 2) pinch = null;
  clearTimeout(longPress);
  if (drag?.moved && (drag.type === "node" || drag.type === "note"))
    dirtyFile = true;
  if(drag?.moved&&drag.type==='node')sim.changed();
  drag = null;
  alignmentGuides = [];
  dirty = true;
  document.querySelector("#marquee")!.setAttribute("visibility", "hidden");
  if (svg.hasPointerCapture(e.pointerId))
    svg.releasePointerCapture(e.pointerId);
});
svg.addEventListener("pointercancel", (e) => {
  touchPoints.delete(e.pointerId);
  pinch = null;
  drag = null;
  alignmentGuides = [];
  dirty = true;
  clearTimeout(longPress);
  document.querySelector("#marquee")!.setAttribute("visibility", "hidden");
});
svg.addEventListener("pointerover", e => {
  const link=(e.target as Element).closest<SVGElement>("[data-link]")?.dataset.link??null;
  if(hoveredLink!==link){hoveredLink=link;dirty=true;}
});
svg.addEventListener("pointerleave",()=>{if(hoveredLink){hoveredLink=null;dirty=true;}});
svg.addEventListener("focusin",e=>{const link=(e.target as Element).closest<SVGElement>('[data-link]');if(link)selectLink(link.dataset.link!);});
svg.addEventListener("dblclick", (e) => {
  const t = e.target as Element,
    node = t.closest<SVGElement>("[data-device]"),
    note = t.closest<SVGElement>("[data-note]"),
    link = t.closest<SVGElement>("[data-link]");
  if (node) openDevice(node.dataset.device!);
  else if (note) addNote(undefined, note.dataset.note);
  else if (link) editLink(link.dataset.link!);
});
svg.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
    zoom(Math.exp(-Math.max(-300, Math.min(300, pixels)) * (e.ctrlKey ? .008 : .002)), e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);
let contextMenuReturnFocus: HTMLElement | SVGElement | null = null;
function closeContextMenu(restoreFocus = false) {
  const menu = document.querySelector(".mini-menu");
  if (!menu) return;
  menu.remove();
  if (restoreFocus) {
    const target = contextMenuReturnFocus?.isConnected ? contextMenuReturnFocus : svg;
    target.focus({ preventScroll: true });
  }
  contextMenuReturnFocus = null;
}

type ContextMenuItem = [action: string, glyph: string, label: string, shortcut?: string, disabled?: boolean] | null;
svg.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  closeContextMenu();
  const target = e.target as Element;
  const node = target.closest<SVGElement>("[data-device]");
  const note = target.closest<SVGElement>("[data-note]");
  const link = target.closest<SVGElement>("[data-link]");
  if (node) {
    if (!selected.has(node.dataset.device!)) selectDevice(node.dataset.device!);
    selectedLink = null;
  } else if (note) {
    if (!selected.has(note.dataset.note!)) selected.clear();
    selected.add(note.dataset.note!);
    selectedLink = null;
  } else if (link) {
    selected.clear();
    selectedLink = link.dataset.link!;
  }
  dirty = true;
  contextMenuReturnFocus = node?.querySelector<SVGElement>(".device-body") || note || link || svg;
  const d = selected.size === 1 ? selectedDevice() : undefined;
  const selectedNote = selected.size === 1 ? sim.lab.notes.find(n => selected.has(n.id)) : undefined;
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  let label = "Workspace";
  let items: ContextMenuItem[];
  if (d) {
    label = d.config.hostname;
    const openAction=deviceOpenAction(d.kind);
    items = [
      ["open-device", openAction.glyph, openAction.label, "Enter"],
      ["connect-device", "link", "Connect to another device"],
      null,
      ["rename-device", "edit", "Rename device", "F2"],
      ["lock-device", "lock", d.config.features.positionLocked ? "Unlock position" : "Lock position"],
      ...(d.kind==='ap'||endpointUsesPoE(d)?[]:[["power-device", "power", d.powered ? "Power off device" : "Power on device"] as ContextMenuItem]),
      null,
      ["copy", "copy", "Copy", `${mod}C`],
      ["duplicate", "copy", "Duplicate", `${mod}D`],
      ["export-config", "download", "Export configuration"],
      null,
      ["delete", "trash", "Delete device", "Delete"],
    ];
  } else if (selectedNote) {
    label = "Note";
    items = [
      ["edit-note", "edit", "Edit note", "Enter", !!selectedNote.locked],
      ["lock-note", "lock", selectedNote.locked ? "Unlock note" : "Lock note"],
      null,
      ["copy", "copy", "Copy", `${mod}C`],
      ["duplicate", "copy", "Duplicate note", `${mod}D`],
      null,
      ["delete", "trash", "Delete note", "Delete"],
    ];
  } else if (selectedLink) {
    label = "Link";
    items = [
      ["edit-selected-link", "settings", "Edit link settings", "Enter"],
      ["manage-pair-links", "link", "Manage connections between devices"],
      null,
      ["delete", "trash", "Delete link", "Delete"],
    ];
  } else if (selected.size) {
    label = `${selected.size} items selected`;
    items = [
      ["copy", "copy", "Copy selection", `${mod}C`],
      ["duplicate", "copy", "Duplicate selection", `${mod}D`],
      null,
      ["delete", "trash", "Delete selection", "Delete"],
    ];
  } else {
    items = [
      ["paste", "copy", "Paste", `${mod}V`, !clipboard],
      ["fit", "fit", "Fit topology"],
    ];
  }
  const menu = document.createElement("div");
  menu.className = "mini-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `${label} actions`);
  menu.innerHTML = `<div class="menu-heading" aria-hidden="true">${esc(label)}</div>` + items.map(item => {
    if (!item) return '<div class="menu-separator" role="separator"></div>';
    const [action, glyph, text, shortcut, disabled] = item;
    return `<button type="button" role="menuitem" tabindex="-1" class="menu-item${action === "delete" ? " menu-item-danger" : ""}" data-action="${action}"${disabled ? ' disabled aria-disabled="true"' : ""}>${icon(glyph, 16)}<span class="menu-label">${esc(text)}</span>${shortcut ? `<span class="menu-shortcut" aria-hidden="true">${esc(shortcut)}</span>` : ""}</button>`;
  }).join("");
  menu.addEventListener("contextmenu", event => event.preventDefault());
  menu.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      closeContextMenu(true);
      return;
    }
    const entries = $$<HTMLButtonElement>('[role="menuitem"]:not(:disabled)', menu);
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % entries.length;
    else if (event.key === "ArrowUp") next = (index - 1 + entries.length) % entries.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    else return;
    event.preventDefault();
    entries.forEach((entry, i) => { entry.tabIndex = i === next ? 0 : -1; });
    entries[next]?.focus();
  });
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(e.clientX, innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(e.clientY, innerHeight - bounds.height - 8))}px`;
  const first = menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
  if (first) { first.tabIndex = 0; first.focus({ preventScroll: true }); }
});
svg.addEventListener("keydown", event => {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  const target = (event.target as Element).closest<SVGElement>("[data-device],[data-note],[data-link]") || svg;
  const bounds = (target.querySelector(".device-body") || target).getBoundingClientRect();
  target.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
  }));
});
window.addEventListener("resize", () => closeContextMenu());
window.addEventListener("blur", () => closeContextMenu());
document.addEventListener("wheel", event => {
  if (!(event.target as Element).closest(".mini-menu")) closeContextMenu();
}, { passive: true, capture: true });

document.addEventListener("keydown", (e) => {
  if ($("#dialogs").children.length) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog();
    }
    if (e.key === "Tab") {
      const focusables = $$<HTMLElement>(
        'button,input,select,textarea,a[href],[tabindex="0"]',
        $("#dialogs"),
      ).filter(
        (el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0,
      );
      const first = focusables[0],
        last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  const target = e.target as HTMLElement;
  if (target.matches("input,textarea,select") || target.isContentEditable)
    return;
  // Native controls keep their own Space/Enter/arrow behavior. Canvas nodes
  // are SVG role=button elements and deliberately use the editor shortcuts.
  const mod = e.metaKey || e.ctrlKey,
    key = e.key.toLowerCase();
  if (
    e.defaultPrevented ||
    (!mod && target.closest("button,a[href],[role=separator]"))
  )
    return;
  if (mod && key === "c" && window.getSelection()?.toString()) return;
  if (e.key === " ") {
    e.preventDefault();
    spaceHeld = true;
    svg.style.cursor = "grab";
    return;
  }
  if (mod && ["z", "y", "a", "c", "x", "v", "d", "s"].includes(key)) {
    e.preventDefault();
    if (key === "z") undo(e.shiftKey);
    if (key === "y") undo(true);
    if (key === "a") {
      for (const d of [...sim.lab.devices, ...sim.lab.notes])
        selected.add(d.id);
      dirty = true;
    }
    if (key === "c") copySelection();
    if (key === "x") copySelection(true);
    if (key === "v") pasteSelection();
    if (key === "d") {
      copySelection();
      pasteSelection();
    }
    if (key === "s") exportLab();
    return;
  }
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
    selected.size
  ) {
    e.preventDefault();
    const amount = e.shiftKey ? 200 : 20;
    transaction(() => {
      for (const d of [...sim.lab.devices, ...sim.lab.notes])
        if (
          selected.has(d.id) &&
          !("config" in d ? d.config.features.positionLocked : d.locked)
        ) {
          d.x +=
            (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) *
            amount;
          d.y +=
            (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0) * amount;
        }
    });
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    removeSelection();
  }
  if (e.key === "Escape") {
    selected.clear();
    selectedLink = null;
    setTool("select");
    closeContextMenu();
    dirty = true;
  }
  if (e.key === "F2") {
    e.preventDefault();
    renameDevice();
  }
  if (e.key === "Enter") {
    const node = target.closest<SVGElement>("[data-device]");
    if (node) {
      if (tool === "link") {
        if (linkStart && linkStart !== node.dataset.device) {
          connectDialog(linkStart, node.dataset.device!);
          linkStart = null;
        } else {
          linkStart = node.dataset.device!;
          selectDevice(linkStart);
          dirty = true;
        }
      } else openDevice(node.dataset.device!);
    }
    const cable = target.closest<SVGElement>("[data-link]");
    if (cable) editLink(cable.dataset.link!);
    const note = target.closest<SVGElement>("[data-note]");
    if (note) addNote(undefined, note.dataset.note);
  }
  if (key === "v") setTool("select");
  if (key === "c") setTool("link");
  if (key === "n") setTool("note");
  if (e.key === "+" || e.key === "=") zoom(1.2);
  if (e.key === "-") zoom(1 / 1.2);
  if (e.key === "?") capabilitiesDialog();
});
document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    spaceHeld = false;
    svg.style.cursor = "";
  }
});
window.addEventListener("blur", () => {
  spaceHeld = false;
  drag = null;
});
$("#dock-resize").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  dockMaximized = false;
  const start = e.clientY,
    height = dockHeight;
  const move = (v: PointerEvent) => {
    dockHeight = Math.max(
      130,
      Math.min(dockLimit(), height + start - v.clientY),
    );
    $("#dock").style.height = `${dockHeight}px`;
    $("#dock-resize").setAttribute("aria-valuenow", String(dockHeight));
    dirty = true;
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
});
$("#dock-resize").addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    dockHeight = Math.max(
      130,
      Math.min(
        dockLimit(),
        dockHeight + (e.key === "ArrowUp" ? 20 : -20),
      ),
    );
    $("#dock").style.height = `${dockHeight}px`;
    $("#dock-resize").setAttribute("aria-valuenow", String(dockHeight));
    dirty = true;
  }
});
window.addEventListener("resize", () => { dockHeight = Math.min(dockHeight, dockLimit()); renderDock(); dirty = true; });
window.addEventListener("beforeunload", (e) => {
  // Flush synchronously so even an immediate refresh retains the latest edit.
  // Only block navigation when the browser actually refuses to store changes.
  if (!flushWorkspace()) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("pagehide", () => flushWorkspace());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushWorkspace();
});
sim.subscribe(() => (dirty = true));
let last = performance.now(),
  lastPaint = 0,
  lastTerminalPoll = 0;
function frame(now: number) {
  const delta = Math.max(0, Math.min(100, now - last));
  last = now;
  if (linkActivity.needsPaint()) dirty = true;
  if (playing) {
    try {
      const tick = sim.advance(delta);
      if (tick.budgetExhausted) {
        playing = false;
        dirty = true;
        toast(
          "Simulation paused after a large event burst. Inspect the topology for loops, then reload the lab to resume.",
        );
      }
    } catch (err) {
      playing = false;
      dirty = true;
      toast(`Simulation paused: ${message(err)}. Reload the lab to resume.`);
    }
  }
  if (drag && dirty) { renderTopology(); dirty = false; }
  if (now - lastPaint > 100) {
    if (dirty && !drag) {
      renderTopology();
      renderInspector();
      dirty = false;
    } else if (drag && dirty) {
      renderTopology();
      dirty = false;
    }
    lastPaint = now;
  }
  const localBootConsole = activeDevice && !sessions.get(activeDevice)?.cli.remoteConnected && sim.getDevice(activeDevice)?.runtime.features.iosBoot;
  if ((playing || localBootConsole) && now - lastTerminalPoll >= 1000) {
    lastTerminalPoll = now;
    pollTerminal();
  }
  if (now - lastAutosave >= 1000) {
    lastAutosave = now;
    persistWorkspace();
  }
  requestAnimationFrame(frame);
}
restoreWorkspace();
setupTooltips();
renderTopology();
renderDock();
requestAnimationFrame(frame);
