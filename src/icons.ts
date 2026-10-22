import type { DeviceKind } from "./model.ts";
import { nodeIcon } from "./node-icons.ts";

const ethernetPlug = '<path d="M1.5 10.5h6v1.8c0 .6-.55 2.2-1.1 2.2H2.6c-.55 0-1.1-1.6-1.1-2.2Z" fill="currentColor" stroke="none"/><path d="M2.25 10.5V7h4.5v3.5" stroke-width="1.2"/><path d="M3.2 7.2v1.5m1.3-1.5v1.5m1.3-1.5v1.5" stroke-width=".85"/><path d="M3.6 6.4h1.8V7H3.6Z" fill="currentColor" stroke="none"/>';

const paths: Record<string, string> = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>',
  wlc:'<rect x="2" y="9" width="20" height="12" rx="3"/><path d="M6 15h12M8 5a7 7 0 0 1 8 0M5 2a12 12 0 0 1 14 0"/>',
  ap:'<rect x="5" y="10" width="14" height="11" rx="4"/><path d="M8 6a7 7 0 0 1 8 0M5 3a12 12 0 0 1 14 0M10 15h4"/>',
  laptop:'<path d="M5 9h14v10H5zM2 22h20l-3-3H5zM9 5a5 5 0 0 1 6 0M6 2a10 10 0 0 1 12 0"/>',
  cursor: '<path d="m5 3 14 10-7 1-3 7z"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  link: `<path d="M4.5 13.5V18a3.75 3.75 0 0 0 7.5 0V6a3.75 3.75 0 0 1 7.5 0v6.5" stroke-width="2.5"/>${ethernetPlug}<g transform="translate(24 26.5) rotate(180)">${ethernetPlug}</g>`,
  note: '<path d="M5 3h14v13l-5 5H5zM14 21v-5h5M8 8h8M8 12h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14" transform="translate(0 -2)"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H10a7 7 0 0 0 0 14" transform="translate(0 -2)"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 4v16M16 4v16" stroke-width="3"/>',
  step: '<path d="m4 5 10 7-10 7zM18 5v14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M4 12h16"/>',
  fit: '<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6M8 8h8v8H8z"/>',
  save: '<path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
  folder: '<path d="M3 7V4h7l3 3h8v14H3zM3 10h18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V3M7 8l5-5 5 5M4 16v5h16v-5"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  terminal: '<path d="m5 6 6 6-6 6m8 0h7"/>',
  pulse: '<path d="M2 12h4l3-8 5 16 3-8h5"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  power: '<path d="M12 2v10M6 5a9 9 0 1 0 12 0"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v16c3-2 7-1 10 1 3-2 7-3 10-1V4c-3-1-6-2-10 1v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  copy: '<path d="M8 8h13v13H8zM16 8V3H3v13h5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
};
export const deviceLabels: Record<DeviceKind, string> = {
  wlc:"WLC", ap:"Wireless access point", laptop:"Wireless laptop",
  router: "Router",
  switch: "Layer 2 switch",
  poeswitch: "PoE switch",
  l3switch: "Layer 3 switch",
  datacenter: "DC Switch",
  pc: "Computer",
  server: "Server",
  phone: "VoIP phone",
};
export function icon(name: string, size = 18): string {
  const node = nodeIcon(name, size);
  if (node) return node;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
}
export function escapeHTML(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
