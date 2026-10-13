import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from './server.mjs';

const days = Array.from({ length: 22 }, (_, i) => new Date(Date.UTC(2026, 6, 24 + i)).toISOString().slice(0, 10));
const evidence = [{ id: 'ev1', text: 'Verified timeline entry.', url: 'https://example.test/e1', label: 'Timeline' }, { id: 'ev2', text: 'A second verified record.', url: 'https://example.test/e2', label: 'Record' }];
const reasoningChecks = Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, prompt: `Evidence check ${i + 1}?`, options: [{ value: 'supported', label: 'Supported' }, { value: 'unknown', label: 'Not established' }], answer: 'supported', explanation: `Evidence ${i + 1} establishes this.`, evidenceIds: ['ev1'] }));
const campaigns = Array.from({ length: 4 }, (_, n) => {
  const counts = days.map((_, i) => i === 0 ? n + 1 : i === 10 ? n + 2 : i === 14 ? n + 3 : 0);
  return { id: `campaign-${n}`, outlet: `Publisher ${n}`, dailyCounts: counts, listedCount: counts.reduce((a,b) => a+b,0), activeDays: counts.filter(x => x > 0).length, peakDaily: Math.max(...counts), beforeResignationCount: counts.slice(0, 14).reduce((a,b) => a+b,0), afterResignationCount: counts.slice(14).reduce((a,b) => a+b,0), examples: [{ id: `article-${n}`, headline: `Example headline ${n}`, url: `https://publisher${n}.test/article`, published: days[n], verification: 'Verified on source page.' }], reviewNotes: { publicValue: 'Scrutiny may serve public value.', pressure: 'Repeated attention can create pressure.', limit: 'Counts alone do not prove motive or impact.' } };
});
const campaign = { id: 'arday-2026-campaign', title: 'Campaign example', subject: 'Public campaign reporting', start: days[0], end: days.at(-1), endNote: '15:12 BST cutoff on last date', days, source: { name: 'Named archive', url: 'https://example.test/archive', retrieved: '2026-10-13', unit: 'published items', corpusCount: 229, outletUniverse: 15, scopeNote: 'A bounded archive, not a complete account of every publication.' }, events: [{ date: days[14], label: 'Documented resignation event', evidenceId: 'ev1' }], evidence, reasoningChecks, campaigns };

async function setup({ data = campaign, env = {}, fetchImpl, random = () => 0 } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'campaign-server-'));
  const campaignsPath = path.join(dir, 'campaigns.json'); await writeFile(campaignsPath, JSON.stringify([data]));
  const app = createGameServer({ port: 0, campaignsPath, env, fetchImpl, random });
  const address = await app.listen();
  return { app, base: `http://127.0.0.1:${address.port}`, close: async () => { await new Promise(resolve => app.server.close(resolve)); await rm(dir, { recursive: true, force: true }); } };
}
const post = (base, route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function newSession(base, caseId = campaign.id) { const r = await post(base, '/api/campaign/session', { caseId }); assert.equal(r.status, 201); return r.json(); }
function revealBody(s, decision = 'mixed', answers = Object.fromEntries(reasoningChecks.map(c => [c.id, c.answer]))) {
  return { sessionId: s.sessionId, campaignVerdicts: Object.fromEntries(s.desks.map(d => [d.outletId, decision])), recommendedCounts: Object.fromEntries(s.desks.map((d, i) => [d.outletId, i * 2])), reasoningAnswers: answers, justification: 'I weighed the whole-period volume, timing, documented events, and limits in the source before reaching this view.' };
}

test('campaign sessions validate aggregate fields and keep stable publisher bindings anonymous', async t => {
  const g = await setup(); t.after(g.close);
  const first = await newSession(g.base), second = await newSession(g.base);
  assert.deepEqual(first.desks.map(d => d.outletId), ['desk-a','desk-b','desk-c','desk-d']);
  assert.deepEqual(first.desks.map(d => d.listedCount), second.desks.map(d => d.listedCount));
  assert.deepEqual(first.desks.map(d => d.dailyCounts.length), [22,22,22,22]);
  assert.equal(first.desks.some(d => 'outlet' in d || 'id' in d), false);
  assert.equal('name' in first.source, false);
  assert.equal(first.desks[0].examples[0].headline.length > 0, true);
  assert.equal('voiceSpeaker' in first.desks[0], true);
  const state = g.app.sessions.get(first.sessionId);
  assert.deepEqual(first.desks.map(d => d.listedCount), first.desks.map(d => state.campaignByDesk[d.outletId].listedCount));
  assert.equal((await post(g.base, '/api/campaign/session', { caseId: 'unknown' })).status, 404);
  const malformed = structuredClone(campaign); malformed.campaigns[0].listedCount++;
  const bad = await setup({ data: malformed }); t.after(bad.close);
  assert.equal((await post(bad.base, '/api/campaign/session', { caseId: campaign.id })).status, 503);
});

test('real campaign data binds four anonymous 22-day count series and rejects invalid counts', async t => {
  const campaignPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'campaigns.json');
  let all;
  try { all = JSON.parse(await readFile(campaignPath, 'utf8')); }
  catch (err) { if (err?.code === 'ENOENT') { t.skip('campaigns.json has not been added yet'); return; } throw err; }
  const actual = all.find(x => x.id === 'arday-2026-campaign');
  assert.ok(actual, 'campaign dataset contains the requested scenario');
  assert.equal(actual.campaigns.length, 4);
  assert.ok(actual.campaigns.every(x => x.dailyCounts.length === 22 && x.listedCount === x.dailyCounts.reduce((a,b) => a+b,0)));
  const g = await setup({ data: actual }); t.after(g.close);
  const s = await newSession(g.base, actual.id), state = g.app.sessions.get(s.sessionId);
  for (const desk of s.desks) {
    const bound = state.campaignByDesk[desk.outletId];
    assert.equal(desk.listedCount, bound.listedCount);
    assert.deepEqual(desk.dailyCounts, bound.dailyCounts);
    assert.equal(desk.dailyCounts.length, 22);
    assert.equal('outlet' in desk, false);
  }
  const invalid = structuredClone(actual); invalid.campaigns[0].dailyCounts[0]++;
  const bad = await setup({ data: invalid }); t.after(bad.close);
  assert.equal((await post(bad.base, '/api/campaign/session', { caseId: actual.id })).status, 503);
});

test('campaign prompt is aggregate-only, evidence restricted, and provider failure is campaign-specific offline', async t => {
  let captured;
  const g = await setup({ env: { DEEPSEEK_API_KEY: 'test-only' }, fetchImpl: async (_url, opts) => {
    captured = JSON.parse(opts.body);
    assert.match(captured.messages[0].content, /whole-outlet campaign counts/);
    assert.match(captured.messages[0].content, /Do not give any article-level verdict/);
    assert.match(captured.messages[0].content, /Do not presume a high count is bad/);
    assert.match(captured.messages[0].content, /Do not infer motive or causality/);
    assert.doesNotMatch(JSON.stringify(captured), /Publisher [0-3]/);
    throw new Error('fake provider unavailable');
  } }); t.after(g.close);
  const s = await newSession(g.base), desk = s.desks[0];
  const r = await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: desk.outletId, question: 'How should we read the volume?' });
  const result = await r.json();
  assert.equal(r.status, 200); assert.equal(result.mode, 'offline'); assert.equal(result.simulated, true);
  assert.match(result.reply, /active days/); assert.match(result.reply, /new developments could justify volume/);
  assert.equal(result.evidenceIds.every(id => evidence.some(e => e.id === id)), true);
  assert.match(JSON.stringify(captured.messages[1]), /trustedCampaign/);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: campaign.id, outletId: desk.outletId, question: 'article verdict?' })).status, 409);
  assert.equal((await post(g.base, '/api/story', { sessionId: s.sessionId, outletId: desk.outletId })).status, 409);
});

test('campaign reveal validates budgets, leaves decisions and counts unscored, and freezes result', async t => {
  const g = await setup(); t.after(g.close);
  const s = await newSession(g.base), good = revealBody(s, 'justified');
  const invalid = structuredClone(good); invalid.recommendedCounts['desk-a'] = 999999;
  assert.equal((await post(g.base, '/api/campaign/reveal', invalid)).status, 400);
  const a = await (await post(g.base, '/api/campaign/reveal', good)).json();
  assert.equal(a.mode, 'campaign'); assert.equal(a.reasoningScore, 10); assert.equal(a.reasoningTotal, 10);
  assert.ok(a.roles.every(r => r.decision === 'justified'));
  assert.equal(a.roles[0].campaign.outlet, a.roles[0].outletName);
  const badAfter = await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: 'desk-a', question: 'continue?' });
  assert.equal(badAfter.status, 409);
  const again = await (await post(g.base, '/api/campaign/reveal', { ...good, campaignVerdicts: {}, recommendedCounts: {} })).json();
  assert.deepEqual(again, a);

  const other = await newSession(g.base), opposite = revealBody(other, 'pile-on', Object.fromEntries(reasoningChecks.map(c => [c.id, c.id === 'r1' ? 'unknown' : c.answer])));
  opposite.recommendedCounts['desk-a'] = null;
  const b = await (await post(g.base, '/api/campaign/reveal', opposite)).json();
  assert.equal(b.reasoningScore, 8); assert.equal(a.reasoningScore, 10);
  assert.ok(b.roles.every(r => r.decision === 'pile-on'));
  assert.equal(b.roles[0].recommendedCount, null);
  const third = await newSession(g.base), alternate = revealBody(third, 'pile-on');
  alternate.recommendedCounts = Object.fromEntries(third.desks.map(d => [d.outletId, g.app.sessions.get(third.sessionId).campaignByDesk[d.outletId].listedCount * 2]));
  const c = await (await post(g.base, '/api/campaign/reveal', alternate)).json();
  assert.equal(c.reasoningScore, a.reasoningScore, 'opposite campaign judgment has the same evidence score');
  assert.notDeepEqual(c.roles.map(r => r.recommendedCount), a.roles.map(r => r.recommendedCount), 'count budgets do not affect evidence score');
  assert.equal((await post(g.base, '/api/campaign/reveal', { ...revealBody(await newSession(g.base)), justification: 'Too short.' })).status, 400);
});

test('campaign speech accepts owned replies only and rejects headline speech', async t => {
  const env = { ELEVENLABS_API_KEY: 'fake', ...Object.fromEntries(['A','B','C','D'].map(x => [`ELEVENLABS_VOICE_${x}`, `voice-${x}`])) };
  let audioCalls = 0, spoken = '';
  const g = await setup({ env, fetchImpl: async (_url, opts) => { audioCalls++; spoken = JSON.parse(opts.body).text; return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => Uint8Array.from([1,2,3]).buffer }; } }); t.after(g.close);
  const s = await newSession(g.base), desk = s.desks[0];
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'headline' })).status, 400);
  const reply = await (await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: desk.outletId, question: 'Why does timing matter?' })).json();
  assert.ok(reply.replyId);
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: 'desk-b', kind: 'reply', replyId: reply.replyId })).status, 403);
  const spokenResponse = await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'reply', replyId: reply.replyId });
  assert.equal(spokenResponse.status, 200); assert.match(spoken, /22-day record/); assert.doesNotMatch(spoken, /Simulated/); assert.equal(audioCalls, 1);
});
