import atlas from "./assets/node-icons.png";
import type { DeviceKind } from "./model.ts";

// Each 160px cell holds a transparent device illustration.
const cells: Record<DeviceKind, number> = {
  router: 0, switch: 1, l3switch: 2, poeswitch: 3,
  pc: 4, server: 5, wlc: 6, ap: 7,
  laptop: 8, phone: 9, datacenter: 10,
};

export function nodeIcon(name: string, size: number): string | undefined {
  if (!Object.hasOwn(cells, name)) return;
  const cell = cells[name as DeviceKind];
  return `<svg class="node-artwork" width="${size}" height="${size}" viewBox="${cell % 4 * 160} ${Math.floor(cell / 4) * 160} 160 160" preserveAspectRatio="xMidYMid meet" overflow="hidden" fill="none" aria-hidden="true" focusable="false"><use href="#netsim-art-atlas"/></svg>`;
}

/** Embed the original artwork once so dragging does not reparse image data. */
export function nodeIconDefinitions(): string {
  return `<svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><defs><image id="netsim-art-atlas" href="${atlas}" width="640" height="480" preserveAspectRatio="none"/></defs></svg>`;
}
