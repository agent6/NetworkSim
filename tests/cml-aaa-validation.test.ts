import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {replayAAA} from '../scripts/cml/aaa_replay.ts';
import {iosRejected} from '../src/ios-help.ts';
const planBytes=readFileSync(new URL('../scripts/cml/aaa/scenario.json',import.meta.url)),plan=JSON.parse(planBytes.toString()),fixture=JSON.parse(readFileSync(new URL('../scripts/cml/fixtures/aaa-observations.json',import.meta.url),'utf8'));
test('CML AAA vectors replay local, RADIUS and TACACS login, roles, error fallback and real accounting across both dialects',()=>{
 const r=replayAAA(plan);assert.equal(r.status,'passed',JSON.stringify(r.steps.filter(s=>!s.passed)));assert.equal(r.steps.length,42);assert.ok(r.received.some((a:any)=>a.protocol==='radius'&&a.status==='start'));assert.ok(r.received.some((a:any)=>a.protocol==='tacacs'&&a.kind==='commands'));assert.doesNotMatch(JSON.stringify(r.received),/RemotePass42!|LocalOnly42!|LabShared42/);
});
test('Reviewed native AAA evidence preserves all three differences and requires both directions of every AAA protocol',()=>{
 assert.equal(createHash('sha256').update(planBytes).digest('hex'),fixture.planSha256);assert.equal(fixture.native.status,'differences');assert.equal(fixture.native.totalGroups,42);assert.equal(fixture.native.passedGroups,39);assert.deepEqual(fixture.native.differences.map((d:any)=>d.id),['aaa-015','aaa-019','aaa-039']);assert.equal(fixture.native.ownedLabStopped,true);assert.equal(fixture.native.unrelatedLabState,'STARTED');
 assert.equal(fixture.native.captures.length,2);assert.equal(new Set(fixture.native.captures.map((c:any)=>c.sha256)).size,2);
 for(const c of fixture.native.captures){assert.match(c.sha256,/^[0-9a-f]{64}$/);assert.equal(c.passed,true);for(const key of ['radiusRequest','radiusAccept','radiusReject','radiusAccountingRequest','radiusAccountingResponse','tacacsAuthenticateRequest','tacacsAuthenticateReply','tacacsAuthorizeRequest','tacacsAuthorizeReply','tacacsAccountingRequest','tacacsAccountingReply'])assert.ok(c.packets[key]>0,key);}
 assert.deepEqual(Object.values(fixture.native.accountingEvidence),[true,true]);
});
test('Native facility syslog lines are informational output, while actual parser failures remain errors',()=>{
 assert.equal(iosRejected('%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up'),false);assert.equal(iosRejected('%SYS-6-USERLOG: User remote logged in'),false);assert.equal(iosRejected('% Invalid input detected'),true);
});
