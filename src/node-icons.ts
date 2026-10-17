import atlas from "./assets/node-icons.png";
import type { DeviceKind } from "./model.ts";

// One flat ImageGen diagram family: gray outlines, transparent interiors and no perspective.
// Equal-size viewports keep the stroke weight consistent across all nine nodes.
const crops: Record<DeviceKind, readonly [number, number, number, number]> = {
  router: [35, 80, 380, 380],
  switch: [437, 82, 380, 380],
  l3switch: [842, 82, 380, 380],
  poeswitch: [47, 467, 380, 380],
  pc: [437, 464, 380, 380],
  server: [842, 455, 380, 380],
  wlc: [48, 843, 380, 380],
  ap: [437, 836, 380, 380],
  laptop: [848, 815, 380, 380],
};

export function nodeIcon(name: string, size: number): string | undefined {
  if (!Object.hasOwn(crops, name)) return;
  return `<svg class="node-artwork" width="${size}" height="${size}" viewBox="${crops[name as DeviceKind].join(" ")}" preserveAspectRatio="xMidYMid meet" overflow="hidden" fill="none" aria-hidden="true" focusable="false"><use href="#netsim-art-atlas"/></svg>`;
}

/** Embed the original artwork once so dragging does not reparse image data. */
export function nodeIconDefinitions(): string {
  return `<svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><defs><image id="netsim-art-atlas" href="${atlas}" width="1254" height="1254" preserveAspectRatio="none"/></defs></svg>`;
}
