import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGameServer } from './server.mjs';

const testArticles = ['BBC', 'ITV News', 'Sky News', 'The Guardian'].map((outlet, i) => ({ id: `a${i}`, headline: `Authentic headline ${i}`, outlet, url: `https://example.test/${i}`, published: `2020-08-0${i + 1}`, summary: `Published summary ${i}`, verification: 'Verified from article page', note: 'Reported context', verdict: i === 0 ? 'supported' : 'concern', verdictReason: 'Compared with the case evidence.' }));
const reasoningChecks = Array.from({ length: 5 }, (_, i) => ({ id: `check-${i + 1}`, prompt: `Which statement is supported ${i + 1}?`, options: [{ value: 'grounded', label: 'Grounded in the record' }, { value: 'unsupported', label: 'Not established' }], answer: 'grounded', explanation: `Evidence check ${i + 1} is supported.`, evidenceIds: ['e1'] }));
const publicInterestCase = { id: 'case-public', mode: 'public-interest', title: 'Public interest example', summary: 'An example for evidence checks.', caseComparisonNote: 'Compare scrutiny and unnecessary harm.', evidence: [{ id: 'e1', text: 'Evidence one.', url: 'https://example.test/1', label: 'Source one' }, { id: 'e2', text: 'Evidence two.', url: 'https://example.test/2', label: 'Source two' }], reasoningChecks, articles: testArticles.map((a, i) => ({ ...a, id: `pi-${i}`, verdict: 'unresolved', verdictReason: 'No fixed moral key applies.', reviewNotes: { publicValue: `Public value note ${i}.`, pressure: `Pressure note ${i}.`, limit: `Limit note ${i}.` } })) };
const fixture = [{ id: 'case-1', title: 'Example', summary: 'Supported summary.', evidence: [{ id: 'e1', text: 'Evidence one.', url: 'https://example.test/1', label: 'Source one' }, { id: 'e2', text: 'Evidence two.', url: 'https://example.test/2', label: 'Source two' }], supportedFinding: 'Finding', limits: 'Limits', articles: testArticles }, publicInterestCase];
async function setup({ env = {}, fetchImpl, random, casesPath: providedCasesPath } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'faithful-facts-'));
  const casesPath = providedCasesPath || path.join(dir, 'cases.json');
  if (!providedCasesPath) await writeFile(casesPath, JSON.stringify(fixture));
  const app = createGameServer({ port: 0, casesPath, env, fetchImpl, random });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  return { app, base, close: async () => { await new Promise(resolve => app.server.close(resolve)); await rm(dir, { recursive: true, force: true }); } };
}
const post = (base, route, body, extra = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
async function newSession(base, caseId = 'case-1') { const r = await post(base, '/api/session', { caseId }); assert.equal(r.status, 201); return r.json(); }

test('session has no randomized role assignment, hides publisher identity, and health never exposes a key', async t => {
  const g = await setup({ env: { DEEPSEEK_API_KEY: 'never-return-this' }, random: () => 0.25 }); t.after(g.close);
  const health = await (await fetch(`${g.base}/health`)).json();
  assert.deepEqual(health, { ok: true, configured: true, voiceConfigured: false, distinctVoicesAvailable: 0 });
  const s = await newSession(g.base);
  assert.equal(s.desks.length, 4); assert.deepEqual(s.desks.map(d => d.label), ['Desk A', 'Desk B', 'Desk C', 'Desk D']);
  assert.equal(new Set(s.desks.map(d => d.outletId)).size, 4);
  assert.match(s.label, /published article records/);
  assert.equal('outlet' in s.desks[0], false); assert.equal('url' in s.desks[0], false);
  assert.equal('roles' in g.app.sessions.get(s.sessionId), false);
});

test('no key uses tagged offline fixture; unsupported session, case, and outlet are rejected', async t => {
  const g = await setup(); t.after(g.close);
  const s = await newSession(g.base);
  let r = await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: 'What is reported?' });
  const data = await r.json(); assert.equal(data.mode, 'offline'); assert.equal(data.reason, 'no_key'); assert.equal(data.simulated, true); assert.match(data.reply, /Simulated/);
  assert.equal((await post(g.base, '/api/respond', { sessionId: 'bad', caseId: 'case-1', outletId: s.desks[0].outletId, question: 'x' })).status, 404);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'other', outletId: s.desks[0].outletId, question: 'x' })).status, 409);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'bad', outletId: s.desks[0].outletId, question: 'x' })).status, 409);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: 'outsider', question: 'x' })).status, 400);
});

test('article records stay fixed and source identities reveal only by story or final reveal', async t => {
  const g = await setup({ random: () => 0.25 }); t.after(g.close);
  const s = await newSession(g.base);
  const state = g.app.sessions.get(s.sessionId);
  assert.equal(s.desks.length, 4);
  for (const desk of s.desks) {
    const assigned = state.articleByDesk[desk.outletId];
    assert.equal(desk.headline, assigned.headline);
    assert.equal(desk.summary, assigned.summary ?? '');
    assert.equal('outlet' in desk, false); assert.equal('url' in desk, false);
    const story = await (await post(g.base, '/api/story', { sessionId: s.sessionId, outletId: desk.outletId })).json();
    assert.equal(story.outlet, assigned.outlet); assert.equal(story.url, assigned.url); assert.equal(story.headline, assigned.headline);
  }
  const verdicts = Object.fromEntries(state.desks.map(d => [d.outletId, state.articleByDesk[d.outletId].verdict]));
  const reveal = await (await post(g.base, '/api/reveal', { sessionId: s.sessionId, articleVerdicts: verdicts })).json();
  assert.equal(reveal.coverageCorrect, 4); assert.equal(reveal.coverageTotal, 4);
  assert.ok(reveal.roles.every(r => r.article?.url && r.outletName));
  assert.equal((await post(g.base, '/api/story', { sessionId: s.sessionId, outletId: s.desks[0].outletId })).status, 409);
});

test('malformed provider JSON and unapproved evidence reference safely fall back', async t => {
  let call = 0;
  const g = await setup({ env: { DEEPSEEK_API_KEY: 'test-only' }, fetchImpl: async (_url, opts) => {
    assert.equal(_url, 'https://api.deepseek.com/chat/completions');
    const sent = JSON.parse(opts.body); assert.equal(sent.model, 'deepseek-flash'); assert.equal(JSON.stringify(sent).includes('traitorBrief'), false); assert.deepEqual(sent.response_format, { type: 'json_object' }); assert.deepEqual(sent.thinking, { type: 'disabled' }); assert.equal(sent.max_tokens, 320);
    call++; return { ok: true, json: async () => ({ choices: [{ message: { content: call === 1 ? '{bad' : call === 2 ? JSON.stringify({ reply: 'Invented.', evidenceIds: ['not-approved'] }) : call === 3 ? JSON.stringify({ reply: 'I am BBC. Simulated.', evidenceIds: ['e1'] }) : call === 4 ? JSON.stringify({ reply: 'AI interpretation: Simulated, BBC loses the Ahmed equal-pay case.', evidenceIds: ['e1'] }) : call === 5 ? JSON.stringify({ reply: 'AI interpretation: Desk A is BBC. Simulated.', evidenceIds: ['e1'] }) : JSON.stringify({ reply: 'AI interpretation: Desk A is an anonymous desk. Simulated.', evidenceIds: ['e1'] }) } }] }) };
  } }); t.after(g.close);
  const s = await newSession(g.base);
  for (let i = 0; i < 6; i++) { const d = await (await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[i % s.desks.length].outletId, question: 'Tell me more' })).json(); assert.equal(d.mode, (i === 3 || i === 5) ? 'deepseek' : 'offline', `response index ${i}: ${d.reason || d.reply}`); if (i !== 3 && i !== 5) assert.ok(['provider_invalid_json', 'provider_invalid_schema', 'provider_identity_leak'].includes(d.reason)); else assert.equal(d.reason, undefined); assert.equal(d.simulated, true); }
  assert.equal(call, 6);
});

test('host, origin, content type and body limits are enforced', async t => {
  const g = await setup(); t.after(g.close);
  const port = new URL(g.base).port;
  const badHost = await new Promise((resolve, reject) => { const req = http.request({ hostname: '127.0.0.1', port, path: '/health', headers: { host: 'example.com' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); });
  assert.equal(badHost, 403);
  assert.equal((await post(g.base, '/api/session', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`${g.base}/api/session`, { method: 'POST', body: '{}' })).status, 415);
  const huge = await fetch(`${g.base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'x'.repeat(5000) }) });
  assert.equal(huge.status, 413);
});

test('12-call budget and coverage verdict reveal are immutable; responses stop after reveal', async t => {
  const g = await setup(); t.after(g.close);
  const s = await newSession(g.base);
  for (let i = 0; i < 12; i++) assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: `q${i}` })).status, 200);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: '13th' })).status, 429);
  const state = g.app.sessions.get(s.sessionId);
  const verdicts = Object.fromEntries(state.desks.map(d => [d.outletId, state.articleByDesk[d.outletId].verdict]));
  const reveal = await (await post(g.base, '/api/reveal', { sessionId: s.sessionId, articleVerdicts: verdicts })).json();
  assert.equal(reveal.coverageCorrect, 4); assert.equal(reveal.coverageTotal, 4); assert.equal('traitorId' in reveal, false);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: 'after' })).status, 409);
  const again = await (await post(g.base, '/api/reveal', { sessionId: s.sessionId, articleVerdicts: {} })).json();
  assert.deepEqual(again, reveal);
});

test('public-interest offline analysis is article-specific and never assigns an editorial verdict', async t => {
  const g = await setup(); t.after(g.close);
  const s = await newSession(g.base, 'case-public'), state = g.app.sessions.get(s.sessionId);
  for (const [i, desk] of s.desks.entries()) {
    const article = state.articleByDesk[desk.outletId];
    assert.equal(article.verdict, 'unresolved');
    const d = await (await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-public', outletId: desk.outletId, question: 'What should I consider?' })).json();
    const focus = ['publicValue', 'pressure', 'limit'][i % 3];
    assert.ok(d.reply.includes(article.reviewNotes[focus]));
    assert.doesNotMatch(d.reply, /traitor|verdict/i);
  }
});

test('public-interest reveal scores evidence checks only, accepts differing editorial judgments, and freezes', async t => {
  const g = await setup(); t.after(g.close);
  const makeBody = (s, choice, answers = {}) => {
    const ids = s.desks.map(d => d.outletId);
    return { sessionId: s.sessionId, articleVerdicts: Object.fromEntries(ids.map(id => [id, choice])), assessments: Object.fromEntries(ids.map(id => [id, { publicValue: choice === 'justified' ? 'strong' : 'weak', pressure: choice === 'justified' ? 'low' : 'high' }])), reasoningAnswers: Object.fromEntries(reasoningChecks.map(c => [c.id, answers[c.id] ?? 'grounded'])), justification: 'This written rationale weighs public value, pressure, and the limits of the evidence.' };
  };
  const a = await newSession(g.base, 'case-public');
  assert.equal((await post(g.base, '/api/reveal', { ...makeBody(a, 'justified'), articleVerdicts: { ...makeBody(a, 'justified').articleVerdicts, [a.desks[0].outletId]: 'invalid' } })).status, 400);
  const invalidAssessment = makeBody(a, 'justified'); invalidAssessment.assessments[a.desks[0].outletId].pressure = 'extreme';
  assert.equal((await post(g.base, '/api/reveal', invalidAssessment)).status, 400);
  const missingAnswer = makeBody(a, 'justified'); delete missingAnswer.reasoningAnswers['check-5'];
  assert.equal((await post(g.base, '/api/reveal', missingAnswer)).status, 400);
  const missingJustification = makeBody(a, 'justified'); delete missingJustification.justification;
  assert.equal((await post(g.base, '/api/reveal', missingJustification)).status, 400);
  const first = await (await post(g.base, '/api/reveal', makeBody(a, 'justified'))).json();
  assert.equal(first.mode, 'public-interest'); assert.equal(first.reasoningScore, 10); assert.equal(first.reasoningTotal, 10);
  assert.match(first.justification, /weighs public value/);
  assert.equal(first.roles.every(r => r.role === 'editorial-judgment' && r.article.outlet && r.decision === 'justified'), true);
  assert.equal('coverageCorrect' in first, false); assert.equal('traitorId' in first, false);
  const b = await newSession(g.base, 'case-public');
  const second = await (await post(g.base, '/api/reveal', makeBody(b, 'pile-on'))).json();
  assert.equal(second.reasoningScore, 10); assert.ok(second.roles.every(r => r.decision === 'pile-on'));
  const wrong = makeBody(b, 'mixed', { 'check-1': 'unsupported' });
  const c = await newSession(g.base, 'case-public');
  const third = await (await post(g.base, '/api/reveal', { ...wrong, sessionId: c.sessionId })).json();
  assert.equal(third.reasoningScore, 8); assert.equal(third.reasoningResults.find(x => x.id === 'check-1').correct, false);
  const repeated = await (await post(g.base, '/api/reveal', { ...makeBody(c, 'unclear'), reasoningAnswers: {} })).json();
  assert.deepEqual(repeated, third);
});

test('public-interest provider receives balanced editorial and case-comparison guidance', async t => {
  let expectedReviewNotes;
  const g = await setup({ env: { DEEPSEEK_API_KEY: 'test-only' }, fetchImpl: async (_url, opts) => {
    const request = JSON.parse(opts.body), system = request.messages[0].content, user = JSON.parse(request.messages[1].content);
    assert.match(system, /public value and proportionality/); assert.match(system, /allow a mixed assessment/); assert.match(system, /Do not claim motives/); assert.match(system, /public-interest editor|evidence checker|impact reader|audience analyst/);
    assert.deepEqual(user.article.reviewNotes, expectedReviewNotes);
    assert.equal(user.factPacket.caseComparisonNote, publicInterestCase.caseComparisonNote);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'AI interpretation (Simulated): The record supports scrutiny, while its pressure and limits remain relevant.', evidenceIds: ['e1'] }) } }] }) };
  } }); t.after(g.close);
  const s = await newSession(g.base, 'case-public'), desk = s.desks[0];
  expectedReviewNotes = g.app.sessions.get(s.sessionId).articleByDesk[desk.outletId].reviewNotes;
  const result = await (await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-public', outletId: desk.outletId, question: 'What should I weigh?' })).json();
  assert.equal(result.mode, 'deepseek');
});

test('typed questions are bounded and replies are stored for controlled speech', async t => {
  const g = await setup(); t.after(g.close); const s = await newSession(g.base);
  assert.equal((await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: 'x'.repeat(401) })).status, 400);
  const r = await (await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: 'What does the evidence establish?' })).json();
  assert.ok(r.replyId); assert.equal(typeof r.reply, 'string'); assert.equal(r.reply.length <= 450, true);
  const intro = await (await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: 'In one short sentence, what does the evidence show?' })).json();
  assert.ok(intro.reply.length <= 180); assert.match(intro.reply, /Simulated/);
});

test('intro provider accepts abbreviations and wrapper punctuation up to 220 characters', async t => {
  const answer = 'AI interpretation (Simulated): Dr. X. reviewed the record; it supports the finding within the stated limits.';
  const g = await setup({ env: { DEEPSEEK_API_KEY: 'test-only' }, fetchImpl: async (_url, opts) => {
    const payload = JSON.parse(opts.body);
    assert.match(payload.messages[1].content, /In one short sentence/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: answer, evidenceIds: ['e1'] }) } }] }) };
  } }); t.after(g.close);
  const s = await newSession(g.base);
  const reply = await (await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: s.desks[0].outletId, question: 'In one short sentence, what should I know?' })).json();
  assert.equal(reply.mode, 'deepseek'); assert.equal(reply.reply, answer); assert.equal(reply.reply.length <= 220, true);
});

test('ElevenLabs speech uses desk voice, authentic headline or owned reply, cache, and bounded budgets', async t => {
  const env = { ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_MODEL: 'test-model', ...Object.fromEntries(['A','B','C','D'].map(x => [`ELEVENLABS_VOICE_${x}`, `voice-${x}`])) };
  let calls = 0, last;
  const g = await setup({ env, fetchImpl: async (url, opts) => {
    calls++; last = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  } }); t.after(g.close);
  const health = await (await fetch(`${g.base}/health`)).json(); assert.equal(health.voiceConfigured, true); assert.equal(health.distinctVoicesAvailable, 4);
  const s = await newSession(g.base), desk = s.desks[0];
  assert.equal(desk.voiceSpeaker, `Analyst ${desk.label.at(-1)}`); assert.equal(desk.voiceConfigured, true);
  let r = await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'headline' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/mpeg'); assert.equal(calls, 1);
  assert.match(last.url, new RegExp(`/text-to-speech/voice-${desk.label.at(-1)}\\?output_format=mp3_44100_128`));
  assert.equal(last.opts.headers['xi-api-key'], 'test-key'); assert.equal(last.body.model_id, 'test-model'); assert.ok(last.body.text.includes(desk.headline));
  await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'headline' }); assert.equal(calls, 1, 'cached audio does not call provider again');
  const reply = await (await post(g.base, '/api/respond', { sessionId: s.sessionId, caseId: 'case-1', outletId: desk.outletId, question: 'Explain the finding.' })).json();
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: s.desks[1].outletId, kind: 'reply', replyId: reply.replyId })).status, 403);
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'reply', replyId: 'fake' })).status, 403);
  g.app.sessions.get(s.sessionId).replies.set(reply.replyId, { outletId: desk.outletId, text: 'AI interpretation (Simulated): concise spoken text. (Simulated; source headline unchanged.)' });
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'reply', replyId: reply.replyId })).status, 200);
  assert.equal(last.body.text, 'concise spoken text.');
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'reply', replyId: reply.replyId, text: 'arbitrary relay' })).status, 200);
  assert.equal(last.body.text, 'concise spoken text.');
  g.app.sessions.get(s.sessionId).replies.set(reply.replyId, { outletId: desk.outletId, text: 'AI interpretation: Dr. X. confirms the limited finding. Simulated.' });
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'reply', replyId: reply.replyId })).status, 200);
  assert.equal(last.body.text, 'Dr. X. confirms the limited finding.');
  g.app.sessions.get(s.sessionId).replies.set(reply.replyId, { outletId: desk.outletId, text: 'AI interpretation: (Simulated)' });
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: desk.outletId, kind: 'reply', replyId: reply.replyId })).status, 400);
  assert.equal(calls, 3, 'empty cleaned speech is rejected without provider call');
  const state = g.app.sessions.get(s.sessionId); state.voiceCalls = 8;
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: s.desks[2].outletId, kind: 'headline' })).status, 429);
});

test('speech is unavailable without four distinct configured voices and rejects invalid kinds', async t => {
  let called = false;
  const g = await setup({ env: { ELEVENLABS_API_KEY: 'not-a-real-secret', ELEVENLABS_VOICE_A: 'same', ELEVENLABS_VOICE_B: 'same' }, fetchImpl: async () => { called = true; } }); t.after(g.close);
  const s = await newSession(g.base);
  assert.equal((await post(g.base, '/api/speak', { sessionId: s.sessionId, outletId: s.desks[0].outletId, kind: 'headline' })).status, 503);
  assert.equal(called, false);
});


test('public-interest real cases preserve chronology metadata and article binding with non-scored judgments', async t => {
  const casesPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'cases.json');
  const cases = JSON.parse(await (await import('node:fs/promises')).readFile(casesPath, 'utf8'));
  const casesToCheck = cases.filter(item => item.mode === 'public-interest');
  assert.equal(casesToCheck.length, 3);
  const g = await setup({ casesPath }); t.after(g.close);
  for (const [caseIndex, item] of casesToCheck.entries()) {
    const session = await newSession(g.base, item.id), state = g.app.sessions.get(session.sessionId);
    for (const [deskIndex, desk] of session.desks.entries()) {
      const article = state.articleByDesk[desk.outletId];
      assert.equal(desk.headline, article.headline); assert.equal(desk.coverageStage, article.coverageStage); assert.equal(desk.headlineType, article.headlineType);
      const source = await (await post(g.base, '/api/story', { sessionId: session.sessionId, outletId: desk.outletId })).json();
      assert.equal(source.headline, article.headline); assert.equal(source.outlet, article.outlet); assert.equal(source.url, article.url);
    }
    const decision = caseIndex % 2 ? 'justified' : 'pile-on';
    const body = {
      sessionId: session.sessionId,
      articleVerdicts: Object.fromEntries(session.desks.map(d => [d.outletId, decision])),
      assessments: Object.fromEntries(session.desks.map(d => [d.outletId, { publicValue: caseIndex % 2 ? 'strong' : 'weak', pressure: caseIndex % 2 ? 'low' : 'high' }])),
      reasoningAnswers: Object.fromEntries(item.reasoningChecks.map(c => [c.id, c.answer])),
      justification: 'I weighed the public interest against pressure, repetition, timing, and the limits of the article record.'
    };
    const revealed = await (await post(g.base, '/api/reveal', body)).json();
    assert.equal(revealed.reasoningScore, 10); assert.equal(revealed.reasoningTotal, 10);
    assert.equal(revealed.roles.length, 4); assert.ok(revealed.roles.every(r => r.role === 'editorial-judgment' && r.decision === decision));
    for (const role of revealed.roles) assert.equal(role.article.url, state.articleByDesk[role.outletId].url);
    assert.equal('coverageCorrect' in revealed, false);
  }
});

test('all real articles are fixed and analysis remains helpful and evidence-grounded with case-scoped coverage scoring', async t => {
  const casesPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'cases.json');
  const cases = JSON.parse(await (await import('node:fs/promises')).readFile(casesPath, 'utf8'));
  assert.ok(cases.length >= 1);
  assert.ok(cases.every(item => item.articles?.length === 4));
  const g = await setup({ casesPath }); t.after(g.close);
  for (const item of cases.filter(x => x.mode !== 'public-interest')) {
    const session = await newSession(g.base, item.id);
    assert.equal(session.caseId, item.id);
    for (const desk of session.desks) {
      const headline = await (await post(g.base, '/api/respond', { sessionId: session.sessionId, caseId: item.id, outletId: desk.outletId, question: 'Give us your initial headline.' })).json();
      assert.equal(headline.mode, 'offline');
      assert.match(headline.reply, /Simulated/);
      assert.ok(headline.reply.includes(item.supportedFinding), `${item.id} evidence-grounded commentary`);
      const sessionDesk = session.desks.find(x => x.outletId === desk.outletId);
      const boundArticle = g.app.sessions.get(session.sessionId).articleByDesk[desk.outletId];
      assert.equal(sessionDesk.headline, boundArticle.headline);
      const story = await (await post(g.base, '/api/story', { sessionId: session.sessionId, outletId: desk.outletId })).json();
      assert.equal(story.headline, boundArticle.headline); assert.equal(story.url, boundArticle.url); assert.equal(story.outlet, boundArticle.outlet);
      assert.equal('headline' in headline, false);
      assert.match(headline.reply, /AI interpretation|Simulated AI interpretation/);
      assert.equal('outlet' in session.desks.find(x => x.outletId === desk.outletId), false);
      const followup = await (await post(g.base, '/api/respond', { sessionId: session.sessionId, caseId: item.id, outletId: desk.outletId, question: 'What does that finding establish?' })).json();
      assert.match(followup.reply, /Simulated/);
      assert.ok(followup.reply.includes(item.supportedFinding)); assert.ok(followup.reply.includes(item.limits));
    }
    const state = g.app.sessions.get(session.sessionId);
    const verdicts = Object.fromEntries(state.desks.map(d => [d.outletId, state.articleByDesk[d.outletId].verdict]));
    const revealed = await (await post(g.base, '/api/reveal', { sessionId: session.sessionId, articleVerdicts: verdicts })).json();
    assert.equal(revealed.coverageCorrect, 4); assert.equal(revealed.coverageTotal, 4);
    assert.equal(revealed.roles.filter(r => r.role === 'traitor').length, item.articles.filter(a => a.verdict === 'concern').length);
  }
});
