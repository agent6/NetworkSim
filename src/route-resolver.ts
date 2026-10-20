import type { Device, InterfaceConfig, Route } from './model.ts';
import { inSubnet, isIPv6, parseCidr, prefixContains } from './ip.ts';
import { nhrpForwardingOverride } from './nhrp.ts';

type ForwardingRoute = Route & { share?: number; global?: boolean };
export interface ForwardingPath { route: Route; port: string; target: string; weight: number }

function sameTable(a?: string, b?: string): boolean { return (a ?? '') === (b ?? ''); }
function adjacent(config: InterfaceConfig, address: string, device?:Device): boolean {
  if (config.ip && config.mask && inSubnet(address, config.ip, config.mask)) return true;
  if ((config.features.secondaryIps ?? []).some((entry: { ip: string; mask: string }) => inSubnet(address, entry.ip, entry.mask))) return true;
  if (!isIPv6(address)) return false;
  if (prefixContains('fe80::', 10, address)) return !!(config.ipv6.length || config.features.ipv6Enabled);
  return config.ipv6.some(value => {
    try { const prefix = parseCidr(value);const state=device?.runtime.features.staticIPv6Dad?.[config.name]?.[prefix.address]?.state;if(state&&state!=='preferred')return false; return prefixContains(prefix.network, prefix.prefix, address); }
    catch { return false; }
  });
}

/** Expand a route into usable wire adjacencies without sending packets or caching stale state.
 * Each parent keeps its share when recursion fans out into several downstream paths.
 */
export function resolveForwardingPaths(
  device: Device,
  target: string,
  vrf: string | undefined,
  interfaceUp: (port: string) => boolean,
  initialRoutes?: readonly Route[],
  excludedRoute?: Route,
): ForwardingPath[] {
  function visit(address: string, table: string | undefined, ancestors: Set<string>): ForwardingPath[] {
    const key = (table ?? '') + '|' + address;
    if (ancestors.has(key) || ancestors.size >= 16) return [];
    const branch = new Set(ancestors); branch.add(key);
    const candidates = ((ancestors.size === 0 && initialRoutes ? initialRoutes : device.runtime.routes) as ForwardingRoute[]).filter(route =>
      route !== excludedRoute && sameTable(route.vrf, table) && route.ad < 255 &&
      (route.protocol !== 'static' || staticEnabled(device, route)) &&
      (route.share === undefined || (Number.isFinite(route.share) && route.share > 0)) &&
      (prefixContains(route.network, route.prefix, address) || !!route.candidateDefault && !isIPv6(address)),
    ).sort((a, b) => effectivePrefix(b) - effectivePrefix(a) || a.ad - b.ad || a.metric - b.metric);
    function effectivePrefix(route:Route):number {return prefixContains(route.network,route.prefix,address)?route.prefix:0;}

    while (candidates.length) {
      const best = candidates[0];
      const tier = candidates.filter(route => effectivePrefix(route) === effectivePrefix(best) && route.ad === best.ad &&
        (route.metric === best.metric || (route.loadShare && best.loadShare)));
      const paths: ForwardingPath[] = [];
      for (const route of tier) {
        const share = route.share ?? 1;
        if (/^Null\d*$/i.test(route.interface)) { paths.push({ route, port: route.interface, target: address, weight: share }); continue; }
        const nextTable = route.global ? undefined : table;
        if (route.interface) {
          const config = device.config.interfaces[route.interface];
          if (!config || !interfaceUp(route.interface) || !sameTable(config.vrf, nextTable)) continue;
          if (!route.nextHop || adjacent(config, route.nextHop,device)) {
            paths.push({ route, port: route.interface, target: route.nextHop ?? address, weight: share });
            continue;
          }
        }
        if (!route.nextHop) continue;
        const children = visit(route.nextHop, nextTable, branch).filter(child => !route.interface || child.port === route.interface);
        const sum = children.reduce((total, child) => total + child.weight, 0);
        if (sum > 0) for (const child of children) paths.push({ route, port: child.port, target: child.target, weight: share * child.weight / sum });
      }
      if (paths.length) return paths.map(path => {
        const shortcut = nhrpForwardingOverride(device, path.route, address);
        return shortcut ? { ...path, target: shortcut.nextHop } : path;
      });
      for (const route of tier) candidates.splice(candidates.indexOf(route), 1);
    }
    return [];
  }
  return visit(target, vrf, new Set());
}

function staticEnabled(device: Device, route: Route): boolean {
  if (route.ad >= 255 || route.track !== undefined && !device.runtime.features.tracks?.[route.track]?.up) return false;
  const binding = (device.config.features.staticBfd ?? []).find((b: { peer: string; interface: string }) => b.peer === route.nextHop && (!route.interface || b.interface === route.interface));
  if (!binding) return true;
  const config = device.config.interfaces[binding.interface];
  return !(config?.features.bfd || config?.features.bfdTemplate) || (device.runtime.features.bfd ?? []).some((s: { interface: string; peer: string; state: string }) => s.interface === binding.interface && s.peer === binding.peer && s.state === 'UP');
}

export function pruneInactiveStaticRoutes(device:Device,interfaceUp:(port:string)=>boolean):boolean {
  const old=device.runtime.routes;
  let candidates=old.filter(route=>{
    if(route.protocol!=='static')return true;
    if(!staticEnabled(device,route))return false;
    if(route.permanent||/^Null\d*$/i.test(route.interface))return true;
    const table=route.global?undefined:route.vrf;
    return !route.interface||!!device.config.interfaces[route.interface]&&interfaceUp(route.interface)&&sameTable(device.config.interfaces[route.interface].vrf,table);
  });
  for(;;){
    // Recursion must use installed winners, not a backup that the parent itself suppresses.
    device.runtime.routes=installedRoutes(candidates);
    const unresolved=device.runtime.routes.find(route=>{
      if(route.protocol!=='static'||route.permanent||/^Null\d*$/i.test(route.interface))return false;
      const table=route.global?undefined:route.vrf;
      if(route.interface&&(!route.nextHop||adjacent(device.config.interfaces[route.interface],route.nextHop,device)))return false;
      if(!route.nextHop)return true;
      return !resolveForwardingPaths(device,route.nextHop,table,interfaceUp,undefined,route).some(path=>!/^Null/i.test(path.port)&&(!route.interface||path.port===route.interface));
    });
    if(!unresolved)break;
    candidates=candidates.filter(route=>route!==unresolved);
  }
  device.runtime.routes=candidates;
  return old.length!==candidates.length;
}

/** The operational RIB retains the best administrative tier per exact prefix, including eligible variance paths. */
function installedRoutes(routes:readonly Route[]):Route[] {
 const groups=new Map<string,Route[]>();for(const route of routes){const key=[route.vrf??'',route.network,route.prefix].join('|');const rows=groups.get(key)??[];rows.push(route);groups.set(key,rows);}
 return [...groups.values()].flatMap(rows=>{const usable=rows.filter(r=>r.ad<255&&(r.share===undefined||r.share>0));if(!usable.length)return[];const best=[...usable].sort((a,b)=>a.ad-b.ad||a.metric-b.metric)[0];return usable.filter(r=>r.ad===best.ad&&(r.metric===best.metric||r.loadShare&&best.loadShare));});
}
export function selectInstalledRoutes(device:Device):void {device.runtime.routes=installedRoutes(device.runtime.routes);}
