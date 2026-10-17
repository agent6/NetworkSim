import type { Device, InterfaceConfig, Route } from './model.ts';
import { inSubnet, isIPv6, parseCidr, prefixContains } from './ip.ts';

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
): ForwardingPath[] {
  function visit(address: string, table: string | undefined, ancestors: Set<string>): ForwardingPath[] {
    const key = (table ?? '') + '|' + address;
    if (ancestors.has(key) || ancestors.size >= 16) return [];
    const branch = new Set(ancestors); branch.add(key);
    const candidates = ((ancestors.size === 0 && initialRoutes ? initialRoutes : device.runtime.routes) as ForwardingRoute[]).filter(route =>
      sameTable(route.vrf, table) && route.ad < 255 &&
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
        const children = visit(route.nextHop, nextTable, branch);
        const sum = children.reduce((total, child) => total + child.weight, 0);
        if (sum > 0) for (const child of children) paths.push({ route, port: child.port, target: child.target, weight: share * child.weight / sum });
      }
      if (paths.length) return paths;
      for (const route of tier) candidates.splice(candidates.indexOf(route), 1);
    }
    return [];
  }
  return visit(target, vrf, new Set());
}

/** Keep configured permanent routes visible while ordinary unresolved routes leave the RIB. */
export function pruneInactiveStaticRoutes(device:Device,interfaceUp:(port:string)=>boolean):boolean {
  const old=device.runtime.routes;
  device.runtime.routes=old.filter(route=>{if(route.protocol!=='static')return true;if(route.ad>=255)return false;if(route.track!==undefined&&!device.runtime.features.tracks?.[route.track]?.up)return false;if(route.permanent||/^Null\d*$/i.test(route.interface))return true;const binding=(device.config.features.staticBfd??[]).find((b:any)=>b.peer===route.nextHop&&(!route.interface||b.interface===route.interface));if(binding){const config=device.config.interfaces[binding.interface];if((config?.features.bfd||config?.features.bfdTemplate)&&!(device.runtime.features.bfd??[]).some((s:any)=>s.interface===binding.interface&&s.peer===binding.peer&&s.state==='UP'))return false;}const table=route.global?undefined:route.vrf;if(route.interface){const cfg=device.config.interfaces[route.interface];if(!cfg||!interfaceUp(route.interface)||(cfg.vrf??'')!==(table??''))return false;if(!route.nextHop||adjacent(cfg,route.nextHop,device))return true;}if(!route.nextHop)return false;return resolveForwardingPaths(device,route.nextHop,table,interfaceUp).some(path=>path.route!==route&&!/^Null/i.test(path.port));});
  return old.length!==device.runtime.routes.length;
}

/** The operational RIB retains the best administrative tier per exact prefix, including eligible variance paths. */
export function selectInstalledRoutes(device:Device):void {
 const groups=new Map<string,Route[]>();for(const route of device.runtime.routes){const key=[route.vrf??'',route.network,route.prefix].join('|');const rows=groups.get(key)??[];rows.push(route);groups.set(key,rows);}
 device.runtime.routes=[...groups.values()].flatMap(rows=>{const usable=rows.filter(r=>r.ad<255&&(r.share===undefined||r.share>0));if(!usable.length)return[];const best=[...usable].sort((a,b)=>a.ad-b.ad||a.metric-b.metric)[0];return usable.filter(r=>r.ad===best.ad&&(r.metric===best.metric||r.loadShare&&best.loadShare));});
}
