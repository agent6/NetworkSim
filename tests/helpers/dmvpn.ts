import assert from 'node:assert/strict';
import { Simulator } from '../../src/engine.ts';
import { IOSSession } from '../../src/cli.ts';
import type { Device } from '../../src/model.ts';

const g = (n: number) => 'GigabitEthernet0/' + n;
const wan = ['198.51.100.2', '192.0.2.2', '203.0.113.2', '198.19.0.2'];
const gateway = ['198.51.100.1', '192.0.2.1', '203.0.113.1', '198.19.0.1'];
export function command(cli: IOSSession, ...lines: string[]): void {
  for (const line of lines) assert.doesNotMatch(cli.execute(line).join('\n'), /^%/m, line);
}
export interface DmvpnOptions {
  phase3?: boolean; protectedTunnel?: boolean; wrongKey?: boolean; hubOnly?: boolean;
  loopback?: boolean; vrf?: boolean; routing?: boolean | 'ospf'; spokes?: number;
}
export function fixture(options: DmvpnOptions = {}) {
  const sim = new Simulator(24100), isp = sim.addDevice('router', 500, 100), transit = new IOSSession(sim, isp.id);
  command(transit, 'enable', 'conf t', 'hostname ISP');
  if (options.vrf) command(transit, 'vrf definition WAN', 'exit');
  const nodes: { device: Device; cli: IOSSession; nbma: string }[] = [];
  const add = () => {
    const i = nodes.length, device = sim.addDevice('router', i ? 180 + (i - 1) * 320 : 500, i ? 550 : 320), cli = new IOSSession(sim, device.id);
    command(transit, `interface g0/${i}`);
    if (options.vrf) command(transit, 'vrf forwarding WAN');
    command(transit, `ip address ${gateway[i]} 255.255.255.252`, 'no shutdown', 'exit');
    if (options.loopback) command(transit, `ip route ${options.vrf ? 'vrf WAN ' : ''}198.18.${i + 1}.1 255.255.255.255 ${wan[i]}`);
    command(cli, 'enable', 'conf t', `hostname ${i ? 'SPOKE' + i : 'HUB'}`);
    if (options.vrf) command(cli, 'vrf definition WAN', 'exit');
    command(cli, 'interface g0/0');
    if (options.vrf) command(cli, 'vrf forwarding WAN');
    command(cli, `ip address ${wan[i]} 255.255.255.252`, 'no shutdown', 'exit',
      `ip route ${options.vrf ? 'vrf WAN ' : ''}0.0.0.0 0.0.0.0 ${gateway[i]}`,
      'interface loopback0', `ip address 172.16.${i + 1}.1 255.255.255.0`, 'no shutdown', 'exit');
    if (options.loopback) {
      command(cli, 'interface loopback1');
      if (options.vrf) command(cli, 'vrf forwarding WAN');
      command(cli, `ip address 198.18.${i + 1}.1 255.255.255.255`, 'no shutdown', 'exit');
    }
    if (options.protectedTunnel || options.hubOnly) command(cli,
      'crypto isakmp policy 10', 'encryption aes 256', 'hash sha', 'authentication pre-share', 'group 14', 'exit',
      `crypto isakmp key ${options.wrongKey && i === 2 ? 'wrong-key' : 'dmvpn-lab'} address 0.0.0.0`,
      'crypto ipsec transform-set DM-TS esp-aes 256 esp-sha-hmac', 'mode transport', 'exit',
      'crypto ipsec profile DM-IPSEC', 'set transform-set DM-TS', 'set pfs group14',
      'set security-association lifetime seconds 60', 'exit');
    const nbma = options.loopback ? `198.18.${i + 1}.1` : wan[i];
    command(cli, 'interface tunnel0', `ip address 10.10.10.${i + 1} 255.255.255.0`,
      'tunnel source ' + (options.loopback ? 'loopback1' : 'g0/0'), 'tunnel mode gre multipoint', 'tunnel key 123',
      `ip nhrp network-id ${100 + i}`, 'ip nhrp authentication lesson', 'ip nhrp holdtime 30', 'ip mtu 1400');
    if (options.vrf) command(cli, 'tunnel vrf WAN');
    if (i === 0) {
      command(cli, 'ip nhrp map multicast dynamic', 'no ip split-horizon eigrp 100');
      if (options.phase3) command(cli, 'ip nhrp redirect'); else command(cli, 'no ip next-hop-self eigrp 100');
    } else {
      command(cli, `ip nhrp nhs 10.10.10.1 nbma ${nodes[0].nbma}`, `ip nhrp map multicast ${nodes[0].nbma}`);
      if (options.phase3) command(cli, 'ip nhrp shortcut');
    }
    if (options.routing === 'ospf') command(cli, 'ip ospf network point-to-multipoint');
    if (options.protectedTunnel || options.hubOnly && i === 0) command(cli, 'tunnel protection ipsec profile DM-IPSEC');
    command(cli, 'no shutdown', 'exit');
    if (options.routing === 'ospf') command(cli, 'router ospf 100', 'network 10.10.10.0 0.0.0.255 area 0', `network 172.16.${i + 1}.0 0.0.0.255 area 0`, 'exit');
    else if (options.routing !== false) command(cli, 'router eigrp 100', 'network 10.10.10.0 0.0.0.255', `network 172.16.${i + 1}.0 0.0.0.255`, 'exit');
    command(cli, 'end');
    sim.connect({ deviceId: device.id, port: g(0) }, { deviceId: isp.id, port: g(i) });
    const node = { device, cli, nbma }; nodes.push(node); return node;
  };
  for (let i = 0; i <= (options.spokes ?? 2); i++) add();
  sim.advance(8500);
  return { sim, isp, nodes, add };
}
