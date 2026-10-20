import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulator} from '../src/engine.ts';
import {labSaveStatus, listSaved, saveLocal, saveLocalCopy, saveNamedLocal, saveWorkspace} from '../src/persistence.ts';
import type {LabDocument} from '../src/model.ts';

function storageTest(work: (storage: Storage) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
    key(index: number) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try { work(storage); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function fixture(): LabDocument {
  const sim = new Simulator(619), a = sim.addDevice('router'), b = sim.addDevice('switch');
  a.startupConfig = structuredClone(a.config);
  sim.connect({deviceId: a.id, port: 'GigabitEthernet0/0'}, {deviceId: b.id, port: 'GigabitEthernet0/1'});
  sim.lab.notes.push({id: 'note', x: 30, y: 40, text: 'Keep this note'});
  return sim.serialize();
}

test('first Save names the existing identity; autosave alone never counts as an explicit save', () => storageTest(() => {
  const doc = fixture(), before = structuredClone(doc);
  assert.equal(labSaveStatus(doc), 'unsaved');
  saveWorkspace(doc);
  assert.equal(labSaveStatus(doc), 'unsaved');
  const saved = saveNamedLocal(doc, '  My named lab  ');
  assert.equal(saved.lab.id, doc.lab.id);
  assert.equal(saved.lab.name, 'My named lab');
  assert.deepEqual(doc, before);
  assert.equal(labSaveStatus(saved), 'saved');
  saved.lab.devices[0].config.hostname = 'EDITED';
  assert.equal(labSaveStatus(saved), 'modified');
  saveLocal(saved);
  assert.equal(labSaveStatus(saved), 'saved');
  assert.equal(listSaved().length, 1, 'ordinary saves update rather than copy');
}));

test('save status detects durable topology, running/startup configuration, notes and name edits', () => storageTest(() => {
  const original = fixture();
  saveLocal(original);
  const mutations: Array<(doc: LabDocument) => void> = [
    doc => { doc.lab.name = 'Renamed'; },
    doc => { doc.lab.devices[0].x += 10; },
    doc => { doc.lab.devices[0].powered = false; },
    doc => { doc.lab.devices[0].config.hostname = 'CHANGED'; },
    doc => { doc.lab.devices[0].config.interfaces['GigabitEthernet0/0'].adminUp = true; },
    doc => { doc.lab.devices[0].startupConfig!.hostname = 'SAVED-STARTUP'; },
    doc => { doc.lab.links[0].delay += 5; },
    doc => { doc.lab.notes[0].text = 'Edited note'; },
    doc => { doc.lab.notes.push({id: 'new-note', x: 10, y: 20, text: 'New'}); },
  ];
  for (const mutate of mutations) {
    const current = structuredClone(original);
    mutate(current);
    saveWorkspace(current);
    assert.equal(labSaveStatus(current), 'modified', mutate.toString());
  }
  assert.equal(labSaveStatus(original), 'saved', 'undoing edits back to the saved content is clean');
}));

test('runtime, canvas navigation and property ordering do not create unsaved edits', () => storageTest(() => {
  const original = fixture();
  saveLocal(original);
  const current = {...structuredClone(original), view: {x: 80, y: -150, scale: 1.2}};
  current.lab.devices[0].runtime.logs.push('A simulated message');
  current.lab.devices[0].runtime.features.traffic = {sent: 1000};
  current.lab.devices[0].config.features = Object.fromEntries(Object.entries(current.lab.devices[0].config.features).reverse());
  const before = structuredClone(current);
  assert.equal(labSaveStatus(current), 'saved');
  assert.deepEqual(current, before, 'comparison is read-only');
  const restored = new Simulator();
  restored.load(current);
  restored.advance(1000);
  assert.equal(labSaveStatus(restored.serialize()), 'saved', 'reopening a saved lab retains saved status');
}));

test('DHCP/SLAAC learned addresses and leases are not edits, but manual addressing still is', () => storageTest(() => {
  const sim = new Simulator(613), pc = sim.addDevice('pc');
  const port = pc.config.interfaces.GigabitEthernet0;
  port.features.dhcp = true;
  port.features.ipv6Autoconfig = true;
  port.ipv6 = ['2001:db8:1::10/64'];
  const original = sim.serialize();
  saveLocal(original);
  const current = structuredClone(original), config = current.lab.devices[0].config;
  const p = config.interfaces.GigabitEthernet0;
  p.ip = '192.0.2.50'; p.mask = '255.255.255.0';
  p.features.dhcpLease = {address: p.ip, gateway: '192.0.2.1', dns: ['192.0.2.53'], domain: 'example.test'};
  p.features.leaseExpires = 600000;
  config.defaultGateway = '192.0.2.1'; config.dnsServers = ['192.0.2.53']; config.features.domainName = 'example.test';
  p.ipv6.push('2001:db8:1::20/64');
  p.features.slaacAddresses = ['2001:db8:1::20'];
  const learnedRoute = {network: '::', prefix: 0, interface: p.name, nextHop: 'fe80::1', autoconfig: true};
  config.staticRoutes.push(learnedRoute);
  assert.equal(labSaveStatus(current), 'saved');
  saveLocal(current);
  const reopened = new Simulator();
  reopened.load(current);
  assert.equal(labSaveStatus(reopened.serialize()), 'saved');
  p.ipv6[0] = '2001:db8:1::11/64';
  assert.equal(labSaveStatus(current), 'modified');
  p.ipv6[0] = '2001:db8:1::10/64';
  config.defaultGateway = '192.0.2.254';
  assert.equal(labSaveStatus(current), 'modified');
}));

test('delivered DHCP acquisition and renewal do not make an unchanged saved lab dirty', () => storageTest(() => {
  const sim = new Simulator(617), server = sim.addDevice('server'), pc = sim.addDevice('pc');
  Object.assign(server.config.interfaces.GigabitEthernet0, {ip: '192.0.2.1', mask: '255.255.255.0'});
  server.config.services.dhcp = {
    enabled: true,
    pools: [{name: 'LAN', network: '192.0.2.0', prefix: 24, leaseSeconds: 60,
      gateway: '192.0.2.1', dnsServers: ['192.0.2.53'], domain: 'example.test'}],
    excluded: [{start: '192.0.2.1', end: '192.0.2.9'}],
  };
  sim.connect({deviceId: server.id, port: 'GigabitEthernet0'}, {deviceId: pc.id, port: 'GigabitEthernet0'});
  saveLocal(sim.serialize());
  const lease = sim.requestDHCP(pc.id);
  sim.advance(1000);
  assert.equal(lease.status, 'success', lease.error);
  assert.equal(labSaveStatus(sim.serialize()), 'saved');
  sim.advance(31000);
  assert.equal(labSaveStatus(sim.serialize()), 'saved');
  saveLocal(sim.serialize());
  const restored = new Simulator();
  restored.load(sim.serialize());
  assert.equal(labSaveStatus(restored.serialize()), 'saved');
}));

test('saved identity survives Save as, and a matching name alone does not mean a lab has been saved', () => storageTest(storage => {
  const original = fixture();
  saveLocal(original);
  const copy = saveLocalCopy(original, 'Copy');
  assert.equal(labSaveStatus(original), 'saved');
  assert.equal(labSaveStatus(copy), 'saved');
  const different = structuredClone(copy);
  different.lab.id = 'different-id';
  assert.equal(labSaveStatus(different), 'unsaved');
  storage.removeItem('network-sim.labs.v1');
  assert.equal(labSaveStatus(copy), 'unsaved', 'deleted browser snapshots no longer count as saved');
}));

test('first-save failures and damaged storage cannot mark a lab saved or overwrite another name', () => storageTest(storage => {
  const original = fixture();
  saveNamedLocal(original, 'Existing lab');
  const unsaved = fixture(); unsaved.lab.id = 'never-saved';
  const before = structuredClone(unsaved), savedBefore = storage.getItem('network-sim.labs.v1');
  for (const name of ['', ' '.repeat(3), 'x'.repeat(201), 'existing LAB']) {
    assert.throws(() => saveNamedLocal(unsaved, name), /name/);
    assert.deepEqual(unsaved, before);
    assert.equal(storage.getItem('network-sim.labs.v1'), savedBefore);
  }
  const setItem = storage.setItem;
  storage.setItem = () => { throw Error('Storage quota exceeded'); };
  assert.throws(() => saveNamedLocal(unsaved, 'New name'), /quota/);
  assert.equal(labSaveStatus(unsaved), 'unsaved');
  assert.deepEqual(unsaved, before);
  storage.setItem = setItem;
  storage.setItem('network-sim.labs.v1', 'invalid JSON');
  assert.throws(() => labSaveStatus(original));
  assert.deepEqual(unsaved, before);
}));
