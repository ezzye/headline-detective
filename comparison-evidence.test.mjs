import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeComparisonWindow, validComparisonBundle} from './comparison-evidence.mjs';

const source = (id = 'official-a', date = '2025-02-25') => ({
  id, date, datePrecision: 'day', title: 'Published review', url: 'https://example.org/review',
  locator: 'Executive summary, paragraph 4', summary: 'Documents institutional handling.', sourceType: 'official',
});
const record = (id, date, format = 'article', extra = {}) => ({
  id, date, outlet: 'Example News', headline: `Report ${id}`, url: `https://example.org/${id}`,
  format, sourceStatus: 'publisher_verified', evidenceIds: ['official-a'], ...extra,
});
const bundle = () => ({
  id: 'comparison-a', title: 'Bounded comparison', kind: 'institutional_delay', relatedCaseIds: ['case-a'],
  summary: 'Review documented delayed institutional handling.',
  anchor: {label: 'Review released', eventDate: '2025-02-25', publicDate: '2025-02-25', datePrecision: 'day', displayDate: '25 February 2025'},
  officialSources: [source()], records: [],
  windows: [{id: 'window-3', start: '2025-02-25', end: '2025-02-27', daysInclusive: 3, unit: 'written_articles', scopeNote: 'Three inclusive dates around publication.'}],
  coverageVerdict: 'unmeasured', census: false, limits: ['Search recovery is incomplete.'], questions: ['What coverage is missing?'],
});

test('validates exact inclusive 3- and 7-day date windows', () => {
  const b = bundle();
  assert.equal(validComparisonBundle(b), true);
  b.windows[0] = {...b.windows[0], end: '2025-02-28', daysInclusive: 3};
  assert.equal(validComparisonBundle(b), false);
  b.windows[0] = {...b.windows[0], end: '2025-03-03', daysInclusive: 7};
  assert.equal(validComparisonBundle(b), true);
});

test('rejects impossible dates and imprecise dates where a day is required', () => {
  const b = bundle();
  b.records = [record('r1', '2025-02-30')];
  assert.equal(validComparisonBundle(b), false);
  b.records = [record('r1', '2025-02')];
  assert.equal(validComparisonBundle(b), false);
});

test('unknown source date stays unknown and is never coerced into a numeric or epoch date', () => {
  const b = bundle();
  b.officialSources = [{...source(), date: undefined, datePrecision: 'unknown'}];
  assert.equal(validComparisonBundle(b), true);
  b.officialSources[0].date = '1970-01-01';
  assert.equal(validComparisonBundle(b), false);
});

test('documented non-pickup requires a documented-gap kind and an official source', () => {
  const b = bundle();
  b.coverageVerdict = 'documented_non_pickup';
  assert.equal(validComparisonBundle(b), false);
  b.kind = 'documented_gap';
  assert.equal(validComparisonBundle(b), true);
  b.officialSources = [{...source(), sourceType: 'reported_institutional_response'}];
  assert.equal(validComparisonBundle(b), false);
});

test('repeated capture of one hosted URL is counted once after query and fragment removal', () => {
  const b = bundle();
  b.coverageVerdict = 'reporting_observed';
  b.records = [
    record('r1', '2025-02-25', 'article', {url: 'https://example.org/story?utm_source=a'}),
    record('r2', '2025-02-25', 'article', {url: 'https://example.org/story#top'}),
  ];
  assert.equal(validComparisonBundle(b), true);
  const result = summarizeComparisonWindow(b, 'window-3');
  assert.equal(result.observedWrittenCount, 1);
  assert.deepEqual(result.duplicateRecordIds, ['r2']);
});

test('reported-date-only rows are excluded; opinion and broadcast remain separate units', () => {
  const b = bundle();
  b.coverageVerdict = 'reporting_observed';
  b.records = [
    record('verified', '2025-02-25', 'article'),
    record('reported', '2025-02-26', 'article', {sourceStatus: 'reported_date_only'}),
    record('opinion', '2025-02-26', 'opinion'),
    record('broadcast', '2025-02-27', 'broadcast_transcript'),
  ];
  const result = summarizeComparisonWindow(b, 'window-3');
  assert.equal(result.observedWrittenCount, 1);
  assert.equal(result.observedOpinionCount, 1);
  assert.equal(result.observedBroadcastCount, 1);
  assert.equal(result.reportedDateOnlyExcludedCount, 1);
});

test('returns every inclusive day and explicitly avoids interpreting zero rows as no publication', () => {
  const result = summarizeComparisonWindow(bundle(), 'window-3');
  assert.deepEqual(result.days.map(day => day.date), ['2025-02-25', '2025-02-26', '2025-02-27']);
  assert.equal(result.observedWrittenCount, 0);
  assert.match(result.days[0].note, /does not establish that no article was published/i);
  assert.match(result.coverageCaveat, /not a complete census/i);
});

test('rejects duplicate evidence identifiers and unknown window requests', () => {
  const b = bundle();
  b.records = [record('official-a', '2025-02-25')];
  assert.equal(validComparisonBundle(b), false);
  assert.throws(() => summarizeComparisonWindow(bundle(), 'missing'), RangeError);
});

