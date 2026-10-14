import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGameServer } from './server.mjs';
import { validFootballCorpus, summarizeFootballEpisode } from './football-framing.mjs';
import { buildFootballContext } from './football-context.mjs';
import campaigns from './campaigns.json' with { type: 'json' };
import football from './football-framing.json' with { type: 'json' };

const setup = () => createGameServer({ port: 0, env: {}, fetchImpl: async () => { throw new Error('unexpected provider call'); }, random: () => 0 });
const request = (app, method, url, body) => new Promise(resolve => {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const req = Readable.from(bytes.length ? [bytes] : []);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1', 'content-type': body === undefined ? 'text/html' : 'application/json' } });
  app.server.emit('request', req, { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(bodyText) { resolve({ status: this.status, headers: this.headers, body: String(bodyText ?? '') }); } });
});
const post = (app, route, body) => request(app, 'POST', route, body);
const json = response => JSON.parse(response.body);
const sessionFor = async (app, caseId) => {
  const response = await post(app, '/api/campaign/session', { caseId });
  assert.equal(response.status, 201, `session should load for ${caseId}: ${response.body}`);
  return json(response);
};

test('release corpus retains nine campaign cases, 209 headlines, and the original seven case counts', async () => {
  assert.equal(campaigns.length, 9);
  const csv = await readFile(new URL('./recovered-headlines.csv', import.meta.url), 'utf8');
  assert.equal(csv.trim().split(/\r?\n/).length - 1, 209);
  const originalCounts = {
    'arday-2026-campaign': [9, 18, 21, 42],
    'caroline-flack-recovered-campaign': [9, 6, 3, 8],
    'sterling-campaign': [9, 3, 2, 1],
    'markle-letter-campaign': [2, 3, 4],
    'bulley-campaign': [5, 8, 4],
    'jefferies-campaign': [7, 2, 4, 2],
    'greenwood-campaign': [7, 4, 4],
  };
  for (const [caseId, counts] of Object.entries(originalCounts)) {
    assert.deepEqual(campaigns.find(item => item.id === caseId)?.campaigns.map(row => row.listedCount), counts, caseId);
  }
});

test('real football corpus passes strict validation and keeps the pre-2022 sample scoped', () => {
  assert.equal(validFootballCorpus(football), true);
  assert.equal(football.episodes.length, 9);
  const dialloEpisode = football.episodes.find(row => row.id === 'football-episode-diallo');
  assert.ok(dialloEpisode);
  assert.ok(dialloEpisode.recordIds.some(id => id.includes('2021')));
  const dialloIds = new Set(dialloEpisode.recordIds);
  const dialloRows = football.records.filter(row => dialloIds.has(row.id));
  assert.ok(dialloRows.every(row => row.date < '2022-01-01' && row.subjectIds.includes('diallo')));
  for (const episode of football.episodes.filter(row => row.id.startsWith('football-episode-greenwood'))) {
    const episodeRecords = episode.recordIds.map(id => football.records.find(row => row.id === id));
    assert.ok(episodeRecords.every(row => !row.subjectIds.includes('diallo')
      || (row.format === 'opinion' && row.subjectIds.includes('greenwood') && row.subjectIds.length > 1)));
    assert.ok(episode.eventIds.every(id => !/diallo/i.test(football.events.find(row => row.id === id).label)));
  }
  const notice = football.events.find(row => row.id === 'football-event-figc-notice');
  assert.equal(notice.date, '2021-02-05');
  assert.match(notice.summary, /Article\s*126/i);
  assert.match(notice.summary, /€48,000/i);
  assert.match(notice.summary, /not a criminal-court conviction/i);
  for (const expected of [
    ['football-football365-2021-02-11', 'pa-diallo-20210211'],
    ['football-sky-sports-2021-02-11', 'pa-diallo-20210211'],
  ]) {
    const row = football.records.find(item => item.id === expected[0]);
    assert.equal(row.storyGroupId, expected[1]);
  }
  const summary = summarizeFootballEpisode(football, dialloEpisode.id);
  assert.equal(summary.records.some(row => row.date >= '2022-01-01'), false);
  const dialloCase = campaigns.find(item => item.id === 'diallo-documents-campaign');
  assert.ok(dialloCase);
  const notes = JSON.stringify(dialloCase);
  assert.match(notes, /(?:12(?:-year-old|\s+years?\s+old|\s+year-old|\s+aged\s+12|\s+age\s+12)|twelve\s+at\s+registration)/i);
  assert.match(notes, /(?:16(?:-year-old|\s+years?\s+old|\s+year-old|\s+aged\s+16|\s+age\s+16)|sixteen\s+at\s+(?:the\s+)?first professional contract)/i);
  assert.match(notes, /not a criminal conviction|not a criminal-court conviction/);
  assert.match(notes, /sport(?:s)? sanction|article 126/);
});

test('all nine campaign sessions expose only reviewed briefings with approved evidence', async () => {
  const app = setup();
  for (const item of campaigns) {
    const session = await sessionFor(app, item.id);
    const approved = new Set(session.evidence.map(row => row.id));
    for (const desk of session.desks) {
      const response = await post(app, '/api/campaign/briefing', { sessionId: session.sessionId, outletId: desk.outletId });
      assert.equal(response.status, 200, `${item.id}/${desk.outletId}: ${response.body}`);
      const briefing = json(response);
      assert.equal(briefing.mode, 'reviewed');
      assert.equal(briefing.kind, 'briefing');
      assert.ok(briefing.paragraphs.length > 0);
      assert.ok(briefing.paragraphs.every(p => p.evidenceIds.length && p.evidenceIds.every(id => approved.has(id))));
    }
  }
});

test('partial release accepts no answers and six unknown scrutiny ratings without inventing a score', async () => {
  const app = setup();
  const item = campaigns.find(row => row.id === 'diallo-documents-campaign');
  const session = await sessionFor(app, item.id);
  const ids = session.desks.map(desk => desk.outletId);
  const criteria = item.scrutinyCriteria.map(row => row.id);
  assert.equal(criteria.length, 6);
  const scrutinyAssessments = Object.fromEntries(ids.map(id => [id, Object.fromEntries(criteria.map(key => [key, 'unknown']))]));
  const body = {
    sessionId: session.sessionId,
    allowPartial: true,
    campaignVerdicts: Object.fromEntries(ids.map(id => [id, null])),
    recommendedCounts: Object.fromEntries(ids.map(id => [id, null])),
    reasoningAnswers: {},
    scrutinyAssessments,
    justification: '',
  };
  const response = await post(app, '/api/campaign/reveal', body);
  assert.equal(response.status, 200, response.body);
  const result = json(response);
  assert.equal(result.reasoningScore, 0);
  assert.equal(result.reasoningTotal, 0);
  assert.equal(result.answeredCount, 0);
  assert.equal(result.reasoningResults.filter(row => !row.answered).length, 5);
  assert.ok(result.reasoningResults.every(row => row.correct === null));
  assert.deepEqual(result.scrutinyAssessments, scrutinyAssessments);
});

test('partial release scores one answered check and explains all five checks', async () => {
  const app = setup();
  const item = campaigns.find(row => row.id === 'diallo-documents-campaign');
  const session = await sessionFor(app, item.id);
  const ids = session.desks.map(desk => desk.outletId);
  const check = item.reasoningChecks[0];
  const response = await post(app, '/api/campaign/reveal', {
    sessionId: session.sessionId, allowPartial: true,
    campaignVerdicts: Object.fromEntries(ids.map(id => [id, null])),
    recommendedCounts: Object.fromEntries(ids.map(id => [id, null])),
    reasoningAnswers: { [check.id]: check.answer }, justification: '',
    scrutinyAssessments: Object.fromEntries(ids.map(id => [id, Object.fromEntries(item.scrutinyCriteria.map(row => [row.id, 'unknown']))])),
  });
  assert.equal(response.status, 200, response.body);
  const result = json(response);
  assert.equal(result.reasoningScore, 2);
  assert.equal(result.reasoningTotal, 2);
  assert.equal(result.answeredCount, 1);
  assert.equal(result.reasoningAvailableTotal, 10);
  assert.equal(result.reasoningResults.length, 5);
  assert.ok(result.reasoningResults.every(row => row.explanation.trim().length > 0));
});

test('partial release still rejects malformed verdicts, unknown answers, and cross-case football episodes', async () => {
  const app = setup();
  const item = campaigns.find(row => row.id === 'diallo-documents-campaign');
  const session = await sessionFor(app, item.id);
  const ids = session.desks.map(desk => desk.outletId);
  const base = {
    sessionId: session.sessionId, allowPartial: true,
    campaignVerdicts: Object.fromEntries(ids.map(id => [id, null])),
    recommendedCounts: Object.fromEntries(ids.map(id => [id, null])),
    reasoningAnswers: {}, justification: '',
    scrutinyAssessments: Object.fromEntries(ids.map(id => [id, Object.fromEntries(item.scrutinyCriteria.map(row => [row.id, 'unknown']))])),
  };
  assert.equal((await post(app, '/api/campaign/reveal', { ...base, campaignVerdicts: {} })).status, 400);
  assert.equal((await post(app, '/api/campaign/reveal', { ...base, reasoningAnswers: { invented: 'yes' } })).status, 400);
  const response = await post(app, '/api/campaign/respond', {
    sessionId: session.sessionId, outletId: session.desks[0].outletId,
    question: 'Summarize the selected football coverage.', footballEpisodeId: 'football-episode-iceland',
  });
  assert.equal(response.status, 400);
});

test('explicit football episode context remains outlet-owned for BBC, Sky PA, Football365, Stretty, and FootballTransfers', async () => {
  const app = setup();
  const sessions = new Map();
  const wanted = [
    ['sterling-campaign', 'BBC Sport', 'football-episode-sterling-2018', 'BBC Sport'],
    ['diallo-documents-campaign', 'Sky News / Sky Sports', 'football-episode-diallo', 'Sky Sports'],
    ['diallo-documents-campaign', 'Football365', 'football-episode-diallo', 'Football365'],
    ['diallo-documents-campaign', 'Stretty News', 'football-episode-diallo', 'Stretty News'],
    ['diallo-documents-campaign', 'FootballTransfers', 'football-episode-diallo', 'FootballTransfers'],
  ];
  for (const [caseId, outlet, episodeId, expected] of wanted) {
    const item = campaigns.find(row => row.id === caseId);
    const desk = item.campaigns.find(row => row.outlet === outlet);
    assert.ok(desk, `${caseId} has ${outlet}`);
    const context = buildFootballContext(football, item, desk, 'Summarize this selected football episode.', episodeId);
    assert.ok(context, `${outlet} receives explicit episode context`);
    assert.ok(context.ownRecords.length > 0, `${outlet} has records of its own`);
    if (expected === 'Sky Sports') assert.ok(context.ownRecords.every(row => /\bSky (?:News|Sports)\b/i.test(row.outlet)));
    else assert.ok(context.ownRecords.every(row => row.outlet === expected));
    assert.ok(context.ownRecords.every(row => !context.comparatorRecords.some(other => other.id === row.id)));

    let session = sessions.get(caseId);
    if (!session) {
      session = await sessionFor(app, caseId);
      sessions.set(caseId, session);
    }
    const bound = app.sessions.get(session.sessionId);
    const outletDesk = session.desks.find(row => bound.campaignByDesk[row.outletId].outlet === outlet);
    assert.ok(outletDesk, `${outlet} is addressable in its active session`);
    const response = await post(app, '/api/campaign/respond', {
      sessionId: session.sessionId, outletId: outletDesk.outletId,
      question: 'Summarize this selected football episode.', footballEpisodeId: episodeId,
    });
    assert.equal(response.status, 200, response.body);
    assert.equal(json(response).mode, 'offline');
    assert.match(json(response).reply, new RegExp(context.ownRecords[0].date));
  }
});
