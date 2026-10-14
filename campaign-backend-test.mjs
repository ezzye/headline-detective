import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from './server.mjs';

const days = Array.from({ length: 22 }, (_, i) => new Date(Date.UTC(2026, 6, 24 + i)).toISOString().slice(0, 10));
const evidence = [{ id: 'ev1', text: 'Verified timeline entry.', url: 'https://example.test/e1', label: 'Timeline' }, { id: 'ev2', text: 'A second verified record.', url: 'https://example.test/e2', label: 'Record' }, { id: 'spectator-early', text: 'The approved source ID has an outlet-like substring.', url: 'https://example.test/e3', label: 'Third source' }];
const reasoningChecks = Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, prompt: `Evidence check ${i + 1}?`, options: [{ value: 'supported', label: 'Supported' }, { value: 'unknown', label: 'Not established' }], answer: 'supported', explanation: `Evidence ${i + 1} establishes this.`, evidenceIds: ['ev1'] }));
const campaigns = Array.from({ length: 4 }, (_, n) => {
  const counts = days.map((_, i) => i === 0 ? n + 1 : i === 10 ? n + 2 : i === 14 ? n + 3 : 0);
  return { id: `campaign-${n}`, outlet: `Publisher ${n}`, dailyCounts: counts, listedCount: counts.reduce((a,b) => a+b,0), activeDays: counts.filter(x => x > 0).length, peakDaily: Math.max(...counts), beforeResignationCount: counts.slice(0, 14).reduce((a,b) => a+b,0), afterResignationCount: counts.slice(14).reduce((a,b) => a+b,0), examples: [{ id: `article-${n}`, headline: `Example headline ${n}`, url: `https://publisher${n}.test/article`, published: days[n], verification: 'Verified on source page.' }], reviewNotes: { publicValue: 'Scrutiny may serve public value.', pressure: 'Repeated attention can create pressure.', limit: 'Counts alone do not prove motive or impact.' }, coverageNotes: `Publisher ${n} had a documented sample with caveats.`, briefing: { title: `Reviewed briefing ${n}`, paragraphs: [{ kind: 'report', text: `Publisher ${n} has ${counts.reduce((a,b) => a+b,0)} listed written items in this bounded record.`, evidenceIds: ['ev1'] }, { kind: 'analysis', text: `We defend coverage when documented developments add public understanding, while acknowledging that volume does not establish motive or impact.`, evidenceIds: ['ev2'] }, { kind: 'comparison', text: `We would need a matching dated inventory to justify a comparison of attention between these cases.`, evidenceIds: ['ev1','ev2'] }] } };
});
const campaign = { id: 'arday-2026-campaign', title: 'Campaign example', subject: 'Public campaign reporting', start: days[0], end: days.at(-1), endNote: '15:12 BST cutoff on last date', days, source: { name: 'Named archive', url: 'https://example.test/archive', retrieved: '2026-10-13', unit: 'published items', corpusCount: 229, outletUniverse: 15, scopeNote: 'A bounded archive, not a complete account of every publication.' }, events: [{ date: days[14], label: 'Documented resignation event', evidenceId: 'ev1' }], evidence, reasoningChecks, context: { note: 'Publisher 0 is one anonymous sample.', url: 'https://publisher0.test/context', evidenceIds: ['ev1','spectator-early','publisher-0','ev2'] }, comparison: [{ note: 'Publisher 1 has no matched comparison rate.', publisherId: 'publisher-1', evidenceIds: ['ev2'] }], campaigns };

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

test('campaign prompt voices anonymous outlet-editor role-play and fallback stays evidence-bound', async t => {
  let captured;
  const g = await setup({ env: { DEEPSEEK_API_KEY: 'test-only' }, fetchImpl: async (_url, opts) => {
    captured = JSON.parse(opts.body);
    assert.match(captured.messages[0].content, /first-person defense/);
    assert.match(captured.messages[0].content, /Do not sound like a detached analyst/);
    assert.match(captured.messages[0].content, /Do not sound like a detached analyst, list JSON fields, or recap counts unless the question asks for counts/);
    assert.match(captured.messages[0].content, /Do not invent facts/);
    assert.match(captured.messages[0].content, /Never identify or guess the publisher/);
    assert.doesNotMatch(JSON.stringify(captured), /Publisher [0-3]/);
    throw new Error('fake provider unavailable');
  } }); t.after(g.close);
  const s = await newSession(g.base), desk = s.desks[0];
  const r = await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: desk.outletId, question: 'How should we read the volume?' });
  const result = await r.json();
  assert.equal(r.status, 200); assert.equal(result.mode, 'offline'); assert.equal(result.simulated, true);
  assert.match(result.reply, /\bwe\b/i); assert.equal(result.reply, g.app.sessions.get(s.sessionId).campaignByDesk[desk.outletId].briefing.paragraphs.find(p=>p.kind==='analysis').text);
  assert.equal(result.rolePlayLabel, 'Simulated outlet-editor role-play; not an actual publisher statement.');
  assert.equal(result.evidenceIds.every(id => evidence.some(e => e.id === id)), true);
  assert.match(JSON.stringify(captured.messages[1]), /trustedCampaign/);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: campaign.id, outletId: desk.outletId, question: 'article verdict?' })).status, 409);
  assert.equal((await post(g.base, '/api/story', { sessionId: s.sessionId, outletId: desk.outletId })).status, 409);
});

test('reviewed briefing is desk-bound, cached, provider-free, and fails closed when missing', async t => {
  let providerCalls = 0;
  const g = await setup({ fetchImpl: async () => { providerCalls++; throw new Error('unexpected provider call'); } }); t.after(g.close);
  const s = await newSession(g.base), state = g.app.sessions.get(s.sessionId), titles = [];
  for (const desk of s.desks) {
    const expected = state.campaignByDesk[desk.outletId].briefing;
    const first = await (await post(g.base, '/api/campaign/briefing', { sessionId: s.sessionId, outletId: desk.outletId, reply: 'ignored caller text' })).json();
    const again = await (await post(g.base, '/api/campaign/briefing', { sessionId: s.sessionId, outletId: desk.outletId })).json();
    assert.equal(first.kind, 'briefing'); assert.equal(first.mode, 'reviewed'); assert.equal(first.simulated, true);
    assert.equal(first.title, expected.title); assert.equal(first.reply, expected.paragraphs.map(p => p.text).join('\n\n'));
    assert.deepEqual(first.paragraphs.map(p => p.kind), ['report','analysis','comparison']);
    assert.equal(first.replyId, again.replyId); assert.equal(first.replyId, state.briefingReplies.get(desk.outletId).replyId);
    assert.ok(first.reply.length < 4000); titles.push(first.title);
  }
  assert.equal(new Set(titles).size, 4); assert.equal(providerCalls, 0);
  assert.equal((await post(g.base, '/api/campaign/briefing', { sessionId: s.sessionId, outletId: 'not-a-desk' })).status, 400);
  assert.equal((await post(g.base, '/api/campaign/reveal', revealBody(s))).status, 200);
  assert.equal((await post(g.base, '/api/campaign/briefing', { sessionId: s.sessionId, outletId: s.desks[0].outletId })).status, 409);
  const noBriefing = structuredClone(campaign); delete noBriefing.campaigns[0].briefing;
  const bad = await setup({ data: noBriefing }); t.after(bad.close);
  const noBriefingSession = await newSession(bad.base), badState = bad.app.sessions.get(noBriefingSession.sessionId);
  const missingDesk = noBriefingSession.desks.find(d => !badState.campaignByDesk[d.outletId].briefing);
  assert.equal((await post(bad.base, '/api/campaign/briefing', { sessionId: noBriefingSession.sessionId, outletId: missingDesk.outletId })).status, 503);
  for (const alter of [x => { x.campaigns[0].briefing.paragraphs[0].text = 'x'.repeat(4001); }, x => { x.campaigns[0].briefing.paragraphs[0].evidenceIds = ['unapproved']; }]) {
    const invalid = structuredClone(campaign); alter(invalid);
    const invalidServer = await setup({ data: invalid }); t.after(invalidServer.close);
    const invalidSession = await newSession(invalidServer.base), invalidState = invalidServer.app.sessions.get(invalidSession.sessionId);
    const invalidDesk = invalidSession.desks.find(d => { const b = invalidState.campaignByDesk[d.outletId].briefing; return b.paragraphs[0].text.length > 4000 || b.paragraphs[0].evidenceIds.includes('unapproved'); });
    assert.equal((await post(invalidServer.base, '/api/campaign/briefing', { sessionId: invalidSession.sessionId, outletId: invalidDesk.outletId })).status, 503);
  }
});

test('campaign Q&A accepts long full-sentence replies and rejects unapproved evidence IDs', async t => {
  let requestCount = 0, requestPacket;
  const fullReply = 'As editors in this role-play, we defend coverage of documented developments because those stories can serve public understanding. The reviewed briefing identifies the themes and dates that shaped our editorial choices, including the institutional response and later inquiry. We acknowledge the weak point recorded there: a series of pieces can repeat earlier claims, and not every item is shown to add new information. We can explain why we continued scrutiny when new public developments were documented, while accepting that readers may challenge the pace and balance of our coverage. The supplied comparison supports only its stated scope; we do not infer matched outlet rates or trends. We do not claim that volume proves motive or impact. We defend the choices described in the script while accepting that readers may disagree. Simulated.';
  const g = await setup({ env: { DEEPSEEK_API_KEY: 'fake-only' }, fetchImpl: async (_url, opts) => {
    requestCount++; const request = JSON.parse(opts.body); requestPacket = request;
    const user = JSON.parse(request.messages[1].content);
    assert.equal(request.max_tokens, 750);
    assert.match(request.messages[0].content, /evidenceIds array MUST contain 1 to 4 exact IDs/);
    assert.match(request.messages[0].content, /Only defend this desk.s own chronologicalRecords/);
    assert.match(request.messages[0].content, /first-person defense/);
    assert.match(request.messages[0].content, /Do not sound like a detached analyst/);
    assert.doesNotMatch(JSON.stringify(user), /Publisher [0-3]|publisher[0-3]\.test|campaign-[0-3]|article-[0-3]/i);
    assert.doesNotMatch(JSON.stringify(user), /https?:\/\//i);
    assert.deepEqual(Object.keys(user.trustedCampaign.evidence[0]).sort(), ['id','text']);
    assert.deepEqual(user.trustedCampaign.context.evidenceIds, ['ev1','spectator-early','ev2']);
    assert.deepEqual(user.trustedCampaign.comparison[0].evidenceIds, ['ev2']);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: fullReply, evidenceIds: requestCount === 1 ? ['ev1','ev2'] : ['not-approved'] }) } }] }) };
  } }); t.after(g.close);
  const s = await newSession(g.base), desk = s.desks[0];
  const first = await (await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: desk.outletId, question: 'What does the timeline support?' })).json();
  assert.equal(first.mode, 'deepseek'); assert.equal(first.rolePlayLabel, 'Simulated outlet-editor role-play; not an actual publisher statement.'); assert.ok(first.reply.length <= 2000); assert.ok(first.reply.trim().split(/\s+/).length >= 80); assert.match(first.reply, /\bwe\b/i); assert.deepEqual(first.evidenceIds, ['ev1','ev2']);
  const second = await (await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: desk.outletId, question: 'What does the comparison not show?' })).json();
  assert.equal(second.mode, 'offline'); assert.equal(second.reason, 'provider_invalid_schema'); assert.match(second.reply, /matching dated inventory/); assert.match(second.reply, /\bwe\b/i); assert.equal(requestCount, 2);
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
  assert.equal(spokenResponse.status, 200); assert.match(spoken, /We defend coverage/); assert.doesNotMatch(spoken, /AI interpretation \(Simulated\)/); assert.equal(audioCalls, 1);
});

test('four long reviewed briefing scripts fit the campaign voice budget and caller text is ignored', async t => {
  const data = structuredClone(campaign);
  for (const [i, c] of data.campaigns.entries()) c.briefing = { title: `Long reviewed briefing ${i}`, paragraphs: [{ kind: 'report', text: ('Reviewed evidence supports only the bounded campaign count. ').repeat(30), evidenceIds: ['ev1'] }] };
  const env = { ELEVENLABS_API_KEY: 'fake', ...Object.fromEntries(['A','B','C','D'].map(x => [`ELEVENLABS_VOICE_${x}`, `voice-${x}`])) };
  let audioCalls = 0, spoken = [];
  const g = await setup({ data, env, fetchImpl: async (_url, opts) => { audioCalls++; spoken.push(JSON.parse(opts.body).text); return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => Uint8Array.from([1,2,3]).buffer }; } }); t.after(g.close);
  const s = await newSession(g.base), state = g.app.sessions.get(s.sessionId);
  for (const [i, desk] of s.desks.entries()) {
    const briefing = await (await post(g.base, '/api/campaign/briefing', { sessionId: s.sessionId, outletId: desk.outletId })).json();
    assert.ok(briefing.reply.length > 1200);
    if (i === 0) assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: s.desks[1].outletId, kind: 'reply', replyId: briefing.replyId })).status, 403);
    const audio = await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'reply', replyId: briefing.replyId, text: 'caller supplied arbitrary text' });
    assert.equal(audio.status, 200);
  }
  assert.equal(audioCalls, 4); assert.ok(state.voiceChars > 4000 && state.voiceChars <= 18000);
  assert.ok(spoken.every(text => text.includes('Reviewed evidence supports')));
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: s.desks[0].outletId, kind: 'reply', replyId: 'forged', text: 'arbitrary' })).status, 403);
});

test('aggregate-only campaigns preserve unknown counts and accept variable contiguous windows and outlets', async t => {
  const aggregate = structuredClone(campaign);
  aggregate.id = 'flacksun-aggregate'; aggregate.countMode = 'aggregate'; aggregate.days = [days[0], days[1], days[2]]; aggregate.start = aggregate.days[0]; aggregate.end = aggregate.days.at(-1);
  aggregate.splitEventDate = null; aggregate.splitLabel = null; aggregate.events = [];
  aggregate.source.outletUniverse = null; aggregate.source.corpusCount = 5; aggregate.source.unit = 'selected records';
  aggregate.scrutinyCriteria = [{ id: 'repeat-claims', label: 'Repeated claims', question: 'What did each later item add?' }];
  aggregate.campaigns = [campaign.campaigns[0]].map((x, i) => ({ ...x, id: `sample-${i}`, listedCount: 5, dailyCounts: null, activeDays: null, peakDaily: null, beforeResignationCount: null, afterResignationCount: null,
    examples: [{ ...x.examples[0], id: 'sample-example', published: aggregate.start }],
    scrutiny: [{ criterionId: 'repeat-claims', observation: 'The archive does not map each item to a distinct new development.', question: 'What did later items add?', evidenceIds: ['ev2'], limit: 'The record does not establish that every item repeated earlier claims.' }],
    briefing: { title: 'Aggregate-only record', paragraphs: [{ kind: 'report', text: 'We covered documented developments during this selected period.', evidenceIds: ['ev1'] }, { kind: 'analysis', text: 'We accept that this sample cannot show what each later item added.', evidenceIds: ['ev2'] }, { kind: 'comparison', text: 'We cannot infer a daily pace from a period total.', evidenceIds: ['ev2'] }] }
  }));
  let providerPacket, providerCalls = 0;
  const g = await setup({ data: aggregate, env: { DEEPSEEK_API_KEY: 'test-only' }, fetchImpl: async (_url, options) => { providerCalls++; providerPacket = JSON.parse(options.body); throw new Error('mock unavailable'); } }); t.after(g.close);
  const s = await newSession(g.base, aggregate.id);
  assert.equal(s.countMode, 'aggregate'); assert.equal(s.desks.length, 1); assert.equal(s.source.outletUniverse, null);
  assert.equal(s.days.length, 3); assert.deepEqual(s.desks[0].dailyCounts, null); assert.equal(s.desks[0].listedCount, 5);
  assert.equal(s.desks[0].activeDays, null); assert.equal(s.desks[0].peakDaily, null);
  assert.equal(s.desks[0].beforeResignationCount, null); assert.equal(s.desks[0].afterResignationCount, null);
  assert.deepEqual(s.scrutinyCriteria[0], aggregate.scrutinyCriteria[0]); assert.deepEqual(s.desks[0].scrutiny[0].evidenceIds, ['ev2']);
  const state = g.app.sessions.get(s.sessionId), bound = state.campaignByDesk[s.desks[0].outletId];
  // Unknown criterion IDs are rejected before any provider call. A valid selected ID takes precedence over unrelated question text.
  assert.equal((await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: s.desks[0].outletId, question: 'How do you defend this?', criterionId: 'unknown' })).status, 400);
  assert.equal(providerCalls, 0);
  const reply = await (await post(g.base, '/api/campaign/respond', { sessionId: s.sessionId, outletId: s.desks[0].outletId, question: 'How do you defend this?', criterionId: 'repeat-claims' })).json();
  const packet = JSON.parse(providerPacket.messages[1].content).trustedCampaign;
  assert.equal(packet.countMode, 'aggregate'); assert.equal('dailyCounts' in packet, false); assert.equal('datedCounts' in packet, false); assert.equal('peakDates' in packet, false);
  assert.equal(packet.activeDays, null); assert.equal(packet.peakDaily, null); assert.equal(packet.beforeResignationDateCount, null); assert.equal(packet.onOrAfterResignationDateCount, null);
  assert.equal(packet.selectedScrutiny.criterionId, 'repeat-claims'); assert.deepEqual(packet.selectedScrutiny.evidenceIds, ['ev2']);
  assert.match(reply.reply, /archive does not map each item/); assert.match(reply.reply, /does not establish/);
  assert.deepEqual(reply.evidenceIds, ['ev2']); assert.equal(bound.dailyCounts, null); assert.equal(providerCalls, 1);
  const bad = structuredClone(aggregate); bad.campaigns[0].scrutiny[0].criterionId = 'unbound';
  const invalid = await setup({ data: bad }); t.after(invalid.close);
  assert.equal((await post(invalid.base, '/api/campaign/session', { caseId: bad.id })).status, 503);
  const missing = structuredClone(aggregate); missing.campaigns[0].afterResignationCount = 0;
  const invalidMissing = await setup({ data: missing }); t.after(invalidMissing.close);
  assert.equal((await post(invalidMissing.base, '/api/campaign/session', { caseId: missing.id })).status, 503);
});

test('scrutiny assessments are exact, ungraded, and frozen with the reveal', async t => {
  const scrutinized = structuredClone(campaign);
  scrutinized.scrutinyCriteria = [{ id: 'repeat', label: 'Repetition', question: 'What did later items add?' }];
  for (const c of scrutinized.campaigns) c.scrutiny = [{ criterionId: 'repeat', observation: 'Some entries may revisit an earlier claim.', question: 'What new information did this add?', evidenceIds: ['ev2'], limit: 'The archive does not classify every entry.' }];
  const g = await setup({ data: scrutinized }); t.after(g.close);
  const s = await newSession(g.base), good = revealBody(s);
  good.scrutinyAssessments = Object.fromEntries(s.desks.map(d => [d.outletId, { repeat: 'unknown' }]));
  const malformed = structuredClone(good); malformed.scrutinyAssessments['desk-a'].invented = 'concern';
  assert.equal((await post(g.base, '/api/campaign/reveal', malformed)).status, 400);
  const result = await (await post(g.base, '/api/campaign/reveal', good)).json();
  assert.deepEqual(result.scrutinyAssessments, good.scrutinyAssessments);
  assert.equal(result.reasoningScore, 10);
  const changed = structuredClone(good); changed.scrutinyAssessments['desk-a'].repeat = 'supported';
  assert.deepEqual(await (await post(g.base, '/api/campaign/reveal', changed)).json(), result);
});

test('campaign windows reject gaps and invalid split dates; daily mode does not fabricate missing splits', async t => {
  const noSplit = structuredClone(campaign); noSplit.events = [];
  for (const c of noSplit.campaigns) c.beforeResignationCount = c.afterResignationCount = null;
  const g = await setup({ data: noSplit }); t.after(g.close);
  const s = await newSession(g.base); assert.equal(s.splitEventDate, null);
  const gap = structuredClone(noSplit); gap.days[3] = '2026-07-28';
  const badGap = await setup({ data: gap }); t.after(badGap.close);
  assert.equal((await post(badGap.base, '/api/campaign/session', { caseId: gap.id })).status, 503);
  const badSplit = structuredClone(noSplit); badSplit.splitEventDate = '2026-08-20';
  const badDate = await setup({ data: badSplit }); t.after(badDate.close);
  assert.equal((await post(badDate.base, '/api/campaign/session', { caseId: badSplit.id })).status, 503);
});

test('real recovered Flack timeline keeps separate print aggregate context and six ungraded ratings through reveal', async t => {
  const all = JSON.parse(await readFile(new URL('./campaigns.json', import.meta.url), 'utf8'));
  const actual = all.find(x => x.id === 'caroline-flack-recovered-campaign');
  assert.ok(actual, 'recovered Flack case exists');
  assert.equal(actual.aggregateContext.count, 99);
  assert.equal(actual.aggregateContext.isDailySeries, false);
  assert.equal(actual.aggregateContext.isThisSample, false);
  const g = await setup({ data: actual }); t.after(g.close);
  const s = await newSession(g.base, actual.id), state = g.app.sessions.get(s.sessionId);
  const d = s.desks.find(d => state.campaignByDesk[d.outletId].outlet === 'The Sun');
  assert.ok(d); assert.equal(s.countMode, 'dated-sample'); assert.equal(s.days.length, 65);
  assert.equal(d.listedCount, 8); assert.equal(d.peakDaily, 3);
  assert.equal(d.dailyCounts.reduce((sum,n)=>sum+n,0), d.listedCount);
  assert.equal(s.source.corpusCount, actual.allHeadlines.length);
  assert.notEqual(s.desks.reduce((sum,d)=>sum+d.listedCount,0), actual.aggregateContext.count);
  const bound = state.campaignByDesk[d.outletId];
  const script = await (await post(g.base, '/api/campaign/briefing', { sessionId:s.sessionId,outletId:d.outletId })).json();
  assert.equal(script.mode,'reviewed'); assert.equal(script.paragraphs.length,4); assert.ok(!script.reply.includes(bound.outlet));
  const response = await (await post(g.base,'/api/campaign/respond',{sessionId:s.sessionId,outletId:d.outletId,question:'Please answer the linked question.',criterionId:'care'})).json();
  assert.deepEqual(response.evidenceIds,bound.scrutiny.find(x=>x.criterionId==='care').evidenceIds);
  assert.match(response.reply,/24 December/);
  const ratings=Object.fromEntries(actual.scrutinyCriteria.map(x=>[x.id,x.id==='framing'?'concern':'unknown']));
  const body={sessionId:s.sessionId,campaignVerdicts:Object.fromEntries(s.desks.map(d=>[d.outletId,'unclear'])),recommendedCounts:Object.fromEntries(s.desks.map(d=>[d.outletId,null])),scrutinyAssessments:Object.fromEntries(s.desks.map(d=>[d.outletId,{...ratings}])),reasoningAnswers:Object.fromEntries(actual.reasoningChecks.map(x=>[x.id,x.answer])),justification:'The recovered dated sample supports specific chronology checks. The separate six-month print total cannot stand in for this sample, and I leave overall editorial proportion unresolved.'};
  const result=await (await post(g.base,'/api/campaign/reveal',body)).json();
  assert.equal(result.reasoningScore,10);const sun=result.roles.find(r=>r.outletName==='The Sun');assert.equal(sun.campaign.listedCount,8);assert.equal(sun.campaign.peakDaily,3);
  assert.deepEqual(result.scrutinyAssessments,body.scrutinyAssessments);assert.equal(sun.recommendedCount,null);assert.equal(sun.decision,'unclear');
  assert.deepEqual(await (await post(g.base,'/api/campaign/reveal',{...body,campaignVerdicts:Object.fromEntries(s.desks.map(d=>[d.outletId,'pile-on']))})).json(),result);
});
