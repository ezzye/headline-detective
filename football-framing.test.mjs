import test from 'node:test';
import assert from 'node:assert/strict';
import { validFootballCorpus, summarizeFootballEpisode, renderFootballPanel } from './football-framing.mjs';

const corpus = () => ({
  schemaVersion: 1, asOf: '2026-10-14', scopeNote: 'Synthetic fixture; observed records only.',
  records: [
    { id: 'r-joint', subjectIds: ['greenwood', 'foden'], outlet: 'Outlet A', headline: 'A & B on the pitch', date: '2026-10-10', format: 'article', url: 'https://news.example/a', sourceStatus: 'publisher_verified', eventId: 'e-match', framingNote: 'Joint record is one article.', limits: 'Selected sample only.', language: 'en', headlineIsExcerpt: false },
    { id: 'r-opinion', subjectIds: ['greenwood'], outlet: 'Outlet B', headline: 'A different view', date: '2026-10-12', format: 'opinion', url: 'https://opinion.example/b', sourceStatus: 'publisher_verified', eventId: null, framingNote: 'Opinion format.', limits: 'Does not represent all coverage.', language: 'en', headlineIsExcerpt: false },
    { id: 'r-official', subjectIds: ['foden'], outlet: 'Club', headline: 'Club statement', date: '2026-10-13', format: 'official', url: 'https://club.example/statement', sourceStatus: 'publisher_verified', eventId: null, framingNote: 'Official statement, distinct from journalism.', limits: 'Statement only.', language: 'en', headlineIsExcerpt: false },
    { id: 'r-lead', subjectIds: ['greenwood'], outlet: 'Outlet A', headline: 'Unverified date-only lead', date: '2026-10-14', format: 'article', url: 'https://news.example/lead', sourceStatus: 'reported_date_only', eventId: null, framingNote: 'Unverified lead.', limits: 'Excluded from verified counts.', language: 'en', headlineIsExcerpt: false },
  ],
  events: [{ id: 'e-match', date: '2026-10-10', label: 'Match', url: 'https://events.example/match', summary: 'Shared public context.' }],
  episodes: [{ id: 'ep-1', title: 'Selected week', start: '2026-10-10', end: '2026-10-14', recordIds: ['r-joint', 'r-opinion', 'r-official', 'r-lead'], eventIds: ['e-match'], scopeNote: 'A bounded selection, not a census.' }],
  comparisons: [{ id: 'cmp-1', title: '<Comparison>', leftRecordIds: ['r-joint'], rightRecordIds: ['r-opinion'], sharedAct: 'The same match', contextDifferences: '<script>distinct contexts</script>', questions: ['What evidence supports each framing?'], limit: 'Small synthetic sample.' }],
});

test('validates schema, ISO dates, HTTPS links, references, window membership and unique IDs', () => {
  const c = corpus(); assert.equal(validFootballCorpus(c), true);
  const badDate = corpus(); badDate.events[0].date = '2026-02-30'; assert.equal(validFootballCorpus(badDate), false);
  const badRef = corpus(); badRef.episodes[0].eventIds.push('missing'); assert.equal(validFootballCorpus(badRef), false);
  const badWindow = corpus(); badWindow.episodes[0].end = '2026-10-13'; assert.equal(validFootballCorpus(badWindow), false);
  const badLink = corpus(); badLink.events[0].url = 'http://events.example/match'; assert.equal(validFootballCorpus(badLink), false);
  const badFormat = corpus(); badFormat.records[0].format = 'podcast'; assert.equal(validFootballCorpus(badFormat), false);
  const duplicateId = corpus(); duplicateId.events[0].id = 'r-joint'; assert.equal(validFootballCorpus(duplicateId), false);
});

test('rejects archived/query variants as duplicate article URL identities', () => {
  const c = corpus();
  c.records.push({ ...c.records[0], id: 'r-archive-copy', headline: 'Archived copy', url: 'https://news.example/a?output=amp#top' });
  c.episodes[0].recordIds.push('r-archive-copy');
  assert.equal(validFootballCorpus(c), false);
});

test('treats Wayback captures as the publisher URL identity', () => {
  const c = corpus();
  c.records[1].url = 'https://web.archive.org/web/20261014200000id_/https://news.example/a';
  assert.equal(validFootballCorpus(c), false);
});

test('accepts original-language headlines, explicit translations, and optional grouped placements', () => {
  const c = corpus();
  c.records[0].language = 'it'; c.records[0].headline = 'Titolo originale molto lungo conservato integralmente: la citazione completa continua oltre venticinque parole senza essere tagliata o parafrasata nel record originale';
  c.records[0].headlineIsExcerpt = true; c.records[0].englishHeadlineTranslation = 'Our clear translation'; c.records[0].storyGroupId = 'pa-story-1';
  const second = { ...c.records[0], id: 'r-wire-copy', outlet: 'Outlet C', url: 'https://other.example/copy', headline: 'Second placement', headlineIsExcerpt: false };
  c.records.push(second); c.episodes[0].recordIds.push(second.id);
  c.records[3].url = null; // A date-only lead may lack a recoverable publisher URL.
  assert.equal(validFootballCorpus(c), true);
  const s = summarizeFootballEpisode(c, 'ep-1');
  assert.equal(s.newsPlacementCount, 2); assert.equal(s.independentStoryGroups, 1);
  const html = renderFootballPanel(c, { episodeId: 'ep-1' });
  assert.match(html, /partial headline excerpt/); assert.match(html, /Our English translation:/);
  const badVerified = corpus(); badVerified.records[0].url = null; assert.equal(validFootballCorpus(badVerified), false);
  const badLanguage = corpus(); badLanguage.records[0].language = 'fr'; assert.equal(validFootballCorpus(badLanguage), false);
});

test('counts a joint mention once, separates opinions and official statements, and excludes unverified leads', () => {
  const c = corpus(); const s = summarizeFootballEpisode(c, 'ep-1');
  assert.equal(s.totalVerifiedWritten, 1); assert.equal(s.newsCount, 1);
  assert.equal(s.opinionCount, 1); assert.equal(s.officialCount, 1); assert.equal(s.excludedCount, 1);
  assert.equal(s.records.filter(r => r.subjectIds.includes('greenwood') && r.subjectIds.includes('foden')).length, 1);
  assert.equal(s.dates.length, 5); assert.equal(s.dates[0].count, 1); assert.equal(s.dates[1].count, 0);
  assert.match(s.dates[1].note, /does not establish that no article was published/);
  assert.equal(s.dates[0].eventIds[0], 'e-match');
  assert.equal(s.byOutlet['Outlet A'].excludedCount, 1);
});

test('through-date, outlet and subject filters scope both records and observed counts', () => {
  const c = corpus();
  const through = summarizeFootballEpisode(c, 'ep-1', { throughDate: '2026-10-12' });
  assert.equal(through.end, '2026-10-12'); assert.equal(through.dates.length, 3); assert.equal(through.excludedCount, 0);
  const outlet = summarizeFootballEpisode(c, 'ep-1', { outlet: 'Outlet A' });
  assert.deepEqual(outlet.records.map(r => r.id), ['r-joint', 'r-lead']);
  const subject = summarizeFootballEpisode(c, 'ep-1', { subject: 'foden' });
  assert.deepEqual(subject.records.map(r => r.id), ['r-joint', 'r-official']);
  assert.throws(() => summarizeFootballEpisode(c, 'absent'), RangeError);
});

test('renders escaped comparison/source content and responsive, accessible phone controls', () => {
  const html = renderFootballPanel(corpus(), { episodeId: 'ep-1', comparisonId: 'cmp-1' });
  assert.match(html, /data-football-episode/); assert.match(html, /type="range" data-football-date/);
  assert.match(html, /data-football-comparison/); assert.match(html, /data-football-question data-episode-id="ep-1"/);
  assert.match(html, /role="img" aria-labelledby=/); assert.match(html, /min-width:0/);
  assert.match(html, /&lt;Comparison&gt;/); assert.match(html, /&lt;script&gt;distinct contexts&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /Publisher verified/);
  assert.match(html, /Reported date only — excluded from verified counts/);
  assert.match(html, /Club/); assert.match(html, /Official statement/);
  assert.match(html, /Official statement dates:<\/strong><ul><li><time datetime="2026-10-13"/);
  assert.match(html, /<details class="football-comparison"><summary>&lt;Comparison&gt; — open paired headlines and context/);
  assert.match(html, /publisher-verified official statements/);
  assert.match(html, /<details><summary>Daily record totals/);
  assert.match(html, /<details><summary>Full record details/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});

test('keeps the full episode slider axis after choosing an early cutoff and exposes event jump buttons', () => {
  const c = corpus();
  const html = renderFootballPanel(c, { episodeId: 'ep-1', throughDate: '2026-10-10' });
  assert.match(html, /data-football-date min="0" max="4" value="0"/);
  assert.match(html, /data-dates="2026-10-10,2026-10-11,2026-10-12,2026-10-13,2026-10-14"/);
  assert.match(html, /data-football-event-date="2026-10-10"/);
  assert.match(html, /<details class="football-events">/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});

test('flags known PA copy placements without claiming that ungrouped rows are independent', () => {
  const c = corpus(); c.records[0].storyGroupId = 'PA';
  const second = { ...c.records[0], id: 'r-pa-copy', outlet: 'Outlet C', url: 'https://other.example/pa-copy' };
  c.records.push(second); c.episodes[0].recordIds.push(second.id);
  const html = renderFootballPanel(c, { episodeId: 'ep-1' });
  assert.match(html, /PA wire Group: these are multiple publisher placements within a known story group, not multiple independent reports/);
  assert.match(html, /not assumed to be independent/);
});
