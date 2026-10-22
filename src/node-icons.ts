import atlas from "./assets/node-icons.png";
import type { DeviceKind } from "./model.ts";

// One flat ImageGen diagram family: gray outlines, transparent interiors and no perspective.
// Equal-size viewports keep the stroke weight consistent across all ten nodes.
const crops: Record<DeviceKind, readonly [number, number, number, number]> = {
  router: [31, 78, 340, 340],
  switch: [380, 80, 340, 340],
  l3switch: [734, 80, 340, 340],
  datacenter: [734, 80, 340, 340],
  poeswitch: [1082, 81, 340, 340],
  pc: [32, 408, 340, 340],
  server: [385, 399, 340, 340],
  wlc: [736, 409, 340, 340],
  ap: [1080, 402, 340, 340],
  laptop: [46, 697, 340, 340],
  phone: [394, 717, 340, 340],
};

export function nodeIcon(name: string, size: number): string | undefined {
  if (!Object.hasOwn(crops, name)) return;
  return `<svg class="node-artwork" width="${size}" height="${size}" viewBox="${crops[name as DeviceKind].join(" ")}" preserveAspectRatio="xMidYMid meet" overflow="hidden" fill="none" aria-hidden="true" focusable="false"><use href="#netsim-art-atlas"/></svg>`;
}

/** Embed the original artwork once so dragging does not reparse image data. */
export function nodeIconDefinitions(): string {
  return `<svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><defs><image id="netsim-art-atlas" href="${atlas}" width="1448" height="1086" preserveAspectRatio="none"/></defs></svg>`;
}
