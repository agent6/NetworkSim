import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixture, command } from '../tests/helpers/dmvpn.ts';
import { serializeLabFile, parseLabFile } from '../src/persistence.ts';

const directory = new URL('../examples/dmvpn/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const phase3 of [false, true]) {
  const { sim, nodes, isp } = fixture({ protectedTunnel: true, phase3, spokes: 3 });
  sim.lab.name = `Single-hub protected DMVPN - Phase ${phase3 ? 3 : 2}`;
  sim.lab.notes.push({
    id: 'dmvpn-guide', x: 40, y: 85, locked: true,
    text: `DMVPN Phase ${phase3 ? 3 : 2}\nSingle hub, three dynamic spokes\nISP routes WAN only; EIGRP 100 routes LANs\nOverlay 10.10.10.0/24, GRE key 123\nNHRP auth: lesson; invented PSK: dmvpn-lab\nSPOKE1: ping 172.16.3.1 source 172.16.2.1\nshow dmvpn / show ip nhrp / show ip cef\nIPsec is a logical model, not encryption.`,
  });
  for (const node of nodes) command(node.cli, 'write memory');
  isp.startupConfig = structuredClone(isp.config);
  const contents = serializeLabFile(sim.serialize()), parsed = parseLabFile(contents);
  assert.equal(parsed.lab.devices.length, 5);
  assert.equal(parsed.lab.links.length, 4);
  const file = new URL(`single-hub-phase${phase3 ? 3 : 2}.netsim.yaml`, directory);
  await writeFile(file, contents);
  console.log(fileURLToPath(file));
}
