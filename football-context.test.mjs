import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFootballContext, footballFallback } from './football-context.mjs';

function fixture() {
  const records = [
    { id: 'sky-news-pa', subjectIds: ['greenwood', 'foden'], outlet: 'Sky News', headline: 'England duo sent home after Iceland breach', date: '2020-09-07', format: 'article', url: 'https://sky.example/news', sourceStatus: 'publisher_verified', eventId: 'event-iceland', framingNote: 'Shared breach.', limits: 'Selected report.', language: 'en', headlineIsExcerpt: false, storyGroupId: 'pa-wire' },
    { id: 'sky-sports-pa', subjectIds: ['greenwood', 'foden'], outlet: 'Sky Sports', headline: 'Foden and Greenwood excluded after Covid breach', date: '2020-09-07', format: 'article', url: 'https://sky.example/sports', sourceStatus: 'publisher_verified', eventId: 'event-iceland', framingNote: 'Second placement of the same known wire account.', limits: 'Same PA report; not a second independent report.', language: 'en', headlineIsExcerpt: false, storyGroupId: 'pa-wire' },
    { id: 'guardian-joint', subjectIds: ['greenwood', 'foden'], outlet: 'The Guardian / Observer archive', headline: 'The pair were sent home', date: '2020-09-07', format: 'article', url: 'https://guardian.example/joint', sourceStatus: 'publisher_verified', eventId: 'event-iceland', framingNote: 'Independent article; a manager denied the reported account.', limits: 'Sample is bounded.', language: 'en', headlineIsExcerpt: false },
    { id: 'guardian-opinion', subjectIds: ['greenwood'], outlet: 'The Guardian', headline: 'How should England respond?', date: '2020-09-08', format: 'opinion', url: 'https://guardian.example/opinion', sourceStatus: 'publisher_verified', eventId: null, framingNote: 'Opinion is classified separately.', limits: 'Opinion, not news.', language: 'en', headlineIsExcerpt: false },
    { id: 'official-statement', subjectIds: ['foden'], outlet: 'Manchester City FC', headline: 'Club Statement', date: '2020-09-07', format: 'official', url: 'https://city.example/statement', sourceStatus: 'publisher_verified', eventId: 'event-iceland', framingNote: 'Official club statement.', limits: 'Not news reporting.', language: 'en', headlineIsExcerpt: false },
  ];
  const events = [{ id: 'event-iceland', date: '2020-09-07', label: 'FA removes both players from the squad', url: 'https://fa.example/decision', summary: 'The FA described a private-team-area protocol breach.' }];
  const episodes = [{ id: 'football-episode-iceland', title: 'Shared Iceland breach', start: '2020-09-05', end: '2020-09-10', recordIds: records.map(row => row.id), eventIds: ['event-iceland'], scopeNote: 'Selected records only.' }];
  const comparisons = [{ id: 'cmp-iceland', title: 'Iceland breach: paired Foden and Greenwood coverage', leftRecordIds: ['sky-news-pa'], rightRecordIds: ['guardian-joint'], sharedAct: 'Both players were sent home after the protocol breach.', contextDifferences: 'The recovered headlines use a joint-player frame.', questions: ['What does the headline foreground?'], limit: 'The selected headlines cannot establish editorial intent.' }];
  const corpus = { schemaVersion: 1, asOf: '2026-10-14', scopeNote: 'Bounded fixture.', records, events, episodes, comparisons };
  const caseItem = { id: 'greenwood-pre2022-campaign', footballEpisodeIds: ['football-episode-iceland'], evidence: [...records.map(row => ({ id: row.id })), ...events.map(row => ({ id: row.id }))] };
  return { corpus, caseItem, campaign: { outlet: 'Sky News / Sky Sports' } };
}

test('rejects an existing football episode that is outside the selected case', () => {
  const { corpus, caseItem, campaign } = fixture();
  caseItem.footballEpisodeIds = [];
  assert.throws(
    () => buildFootballContext(corpus, caseItem, campaign, 'football comparison', 'football-episode-iceland'),
    error => error.status === 400,
  );
});

test('counts two PA placements as one known news story', () => {
  const { corpus, caseItem, campaign } = fixture();
  const context = buildFootballContext(corpus, caseItem, campaign, 'summarize this episode', 'football-episode-iceland');
  assert.equal(context.ownRecords.length, 2);
  assert.equal(context.ownNewsCount, 1);
  assert.equal(context.ownOpinionCount, 0);
});

test('keeps the selected outlet family separate from Guardian comparator records', () => {
  const { corpus, caseItem, campaign } = fixture();
  const context = buildFootballContext(corpus, caseItem, campaign, 'summarize this episode', 'football-episode-iceland');
  assert.deepEqual(context.ownRecords.map(row => row.outlet), ['Sky News', 'Sky Sports']);
  assert.deepEqual(context.comparatorRecords.map(row => row.outlet).sort(), ['The Guardian', 'The Guardian / Observer archive', 'Manchester City FC'].sort());
  const response = footballFallback(context, { anonymousLabel: 'our outlet' });
  assert.match(response.reply, /our outlet/);
  assert.match(response.reply, /another source's/);
  assert.match(response.reply, /reported claim and a denial are attributed accounts/);
  assert.doesNotMatch(response.reply, /We reported the Guardian|our coverage.*Guardian/i);
});

test('builds an explicit case-evidenced comparison with its limits', () => {
  const { corpus, caseItem, campaign } = fixture();
  const context = buildFootballContext(corpus, caseItem, campaign, 'Compare the Iceland football coverage of Foden and Greenwood');
  assert.deepEqual(context.comparisons.map(row => row.id), ['cmp-iceland']);
  assert.match(context.comparisons[0].contextDifferences, /joint-player frame/);
  assert.ok(context.ownRecords.every(row => row.id === 'sky-news-pa' || row.id === 'sky-sports-pa'));
  assert.ok(context.comparatorRecords.some(row => row.id === 'guardian-joint'));
});

test('does not import 2022-plus records or event context into a football episode', () => {
  const { corpus, caseItem, campaign } = fixture();
  corpus.records.push({ id: 'later-criminal-case', subjectIds: ['greenwood'], outlet: 'Later outlet', headline: 'Later criminal proceedings', date: '2023-02-02', format: 'article', url: 'https://later.example/story', sourceStatus: 'publisher_verified', eventId: 'later-event', framingNote: 'Out of window.', limits: 'Must not enter pre-2022 context.', language: 'en', headlineIsExcerpt: false });
  corpus.events.push({ id: 'later-event', date: '2023-02-02', label: 'Later proceedings', url: 'https://later.example/event', summary: 'Post-2022 event.' });
  corpus.episodes.push({ id: 'football-episode-later', title: 'Later episode', start: '2023-02-02', end: '2023-02-02', recordIds: ['later-criminal-case'], eventIds: ['later-event'], scopeNote: 'Post-window episode.' });
  caseItem.footballEpisodeIds.push('football-episode-later');
  caseItem.evidence.push({ id: 'later-criminal-case' }, { id: 'later-event' });
  assert.equal(buildFootballContext(corpus, caseItem, campaign, 'summarize this episode', 'football-episode-later'), null);
  const comparisonContext = buildFootballContext(corpus, caseItem, campaign, 'compare football coverage');
  assert.ok(comparisonContext);
  assert.ok(comparisonContext.ownRecords.every(row => row.date < '2022-01-01'));
  assert.ok(comparisonContext.comparatorRecords.every(row => row.date < '2022-01-01'));
  assert.ok(!comparisonContext.evidenceIds.includes('later-criminal-case'));
  assert.ok(!comparisonContext.evidenceIds.includes('later-event'));
});

test('returns null without an explicit episode or football comparison question', () => {
  const { corpus, caseItem, campaign } = fixture();
  assert.equal(buildFootballContext(corpus, caseItem, campaign, 'tell me about the players'), null);
});
