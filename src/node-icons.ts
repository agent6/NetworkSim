import type {DeviceKind} from './model.ts';

// One diagram family, shared by the palette and canvas. Strokes stay 2px at any zoom.
const arrows='<path d="M12 5v6m-3-3 3-3 3 3M12 19v-6m-3 3 3 3 3-3M5 12h6m-3-3-3 3 3 3M19 12h-6m3-3 3 3-3 3"/>';
const paths:Record<DeviceKind,string>={
 router:'<circle cx="12" cy="12" r="10"/>'+arrows,
 switch:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h14l-3-3m3 3-3 3M19 15H5l3-3m-3 3 3 3"/>',
 l3switch:'<rect x="2" y="2" width="20" height="20" rx="2"/>'+arrows,
 datacenter:'<rect x="2" y="2" width="20" height="17" rx="2"/><path d="M4 22h16M12 5v5m-2-3 2-2 2 2M12 16v-4m-2 2 2 2 2-2M5 10.5h5m-3-2-2 2 2 2M19 10.5h-5m3-2 2 2-2 2"/>',
 poeswitch:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h7l-2-2m2 2-2 2M12 15H5l2-2m-2 2 2 2M18 7l-4 6h4l-3 4"/>',
 pc:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M9 17v4m6-4v4M6 21h12"/>',
 server:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 7h14M9 4.5h.01m3 0h.01m3 0h.01M9 18h6"/>',
 wlc:'<rect x="2" y="15" width="20" height="6" rx="2"/><path d="M6 18h.01m3 0h.01m3 0h.01M5 7a10 10 0 0 1 14 0M8 10a6 6 0 0 1 8 0M11 13h2"/>',
 ap:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M6 9a9 9 0 0 1 12 0M9 12a4.5 4.5 0 0 1 6 0M12 16h.01"/>',
 laptop:'<path d="M5 16V5h14v11M2 20l3-4h14l3 4H2ZM10 18h4"/>',
 phone:'<rect x="3" y="2" width="18" height="20" rx="2"/><rect x="6" y="5" width="4" height="14" rx="2"/><path d="M13 6h5M14 10h.01m3 0h.01m-3 4h.01m3 0h.01m-3 4h.01m3 0h.01"/>',
};
export function nodeIcon(name:string,size:number):string|undefined {
 if(!Object.hasOwn(paths,name))return;
 return `<svg class="node-artwork" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#netsim-node-${name}"/></svg>`;
}
export function nodeIconDefinitions():string {
 return `<svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><defs>${Object.entries(paths).map(([kind,content])=>`<g id="netsim-node-${kind}">${content.replaceAll('/>',' vector-effect="non-scaling-stroke"/>')}</g>`).join('')}</defs></svg>`;
}
