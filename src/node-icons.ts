import atlas from "./assets/node-icons.png";
import type { DeviceKind } from "./model.ts";

// One ImageGen family, matched to the user's thin gray hardware reference.
// Viewports frame the untouched transparent sprite sheet with a safety margin.
const crops: Record<DeviceKind, readonly [number, number, number, number]> = {
  router: [78, 121, 314, 245],
  switch: [476, 152, 325, 181],
  l3switch: [888, 152, 321, 181],
  poeswitch: [71, 544, 340, 178],
  pc: [489, 486, 299, 308],
  server: [937, 465, 223, 347],
  wlc: [40, 974, 395, 121],
  ap: [512, 895, 270, 263],
  laptop: [876, 852, 354, 301],
};

export function nodeIcon(name: string, size: number): string | undefined {
  if (!Object.hasOwn(crops, name)) return;
  return `<svg class="node-artwork" width="${size}" height="${size}" viewBox="${crops[name as DeviceKind].join(" ")}" preserveAspectRatio="xMidYMid meet" overflow="hidden" fill="none" aria-hidden="true" focusable="false"><use href="#netsim-art-atlas"/></svg>`;
}

/** Embed the original artwork once so dragging does not reparse image data. */
export function nodeIconDefinitions(): string {
  return `<svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><defs><image id="netsim-art-atlas" href="${atlas}" width="1269" height="1239" preserveAspectRatio="none"/></defs></svg>`;
}
