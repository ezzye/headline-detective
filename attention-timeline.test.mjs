import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAttentionTimeline, validSpreadLink } from './attention-timeline.mjs';
import { validMediaRecord } from './media-evidence.mjs';

const cases = JSON.parse(await readFile(new URL('./campaigns.json', import.meta.url), 'utf8'));

test('joint timeline keeps written, editorial, social, and event totals separate', () => {
  const c = structuredClone(cases.find(item => item.id === 'sterling-campaign'));
  c.mediaRecords = c.mediaRecords.filter(record => !['outlet_promotion','amplifying_commentary','headline_sharing'].includes(record.publicationRole));
  const post = c.mediaRecords.find(record => record.id === 'media-sterling-lineker');
  post.publicationRole = 'counter_speech';
  const promoted = structuredClone(post);
  promoted.id = 'media-social-promo'; promoted.date = c.start; promoted.publicationRole = 'outlet_promotion'; promoted.publicationRelationship = null;
  c.mediaRecords.push(promoted);
  const timeline = buildAttentionTimeline(c);
  assert.equal(timeline.days.length, 203);
  assert.equal(timeline.counts.written, c.allHeadlines.length);
  assert.equal(timeline.counts.editorial, c.editorialRecords.filter(record => record.phase !== 'aftermath').length);
  assert.equal(timeline.counts.contributing, 1);
  assert.equal(timeline.counts.counterSpeech, c.mediaRecords.filter(record => record.format === 'social_post' && (record.publicationRole === 'counter_speech' || record.publicationRelationship === 'counter_speech')).length);
  assert.equal(timeline.counts.events, c.events.length);
  assert.equal(timeline.counts.total, timeline.rows.length);
  assert.equal(timeline.days[0].rows.find(row => row.id === 'media-social-promo').role, 'outlet_promotion');
  assert.equal(timeline.days[0].contributingCount, 1);
});

test('aftermath is opt-in and extends only through dated aftermath entries', () => {
  const c = structuredClone(cases.find(item => item.id === 'caroline-flack-recovered-campaign'));
  const ordinary = buildAttentionTimeline(c);
  const extended = buildAttentionTimeline(c, { includeAftermath: true });
  assert.equal(ordinary.end, c.end);
  assert(extended.end > c.end);
  assert(extended.rows.some(row => row.phase === 'aftermath'));
  assert.equal(ordinary.rows.some(row => row.phase === 'aftermath'), false);
});

test('spread edges require approved evidence, present records, valid ordering, and HTTPS sources', () => {
  const c = structuredClone(cases.find(item => item.id === 'sterling-campaign'));
  const from = c.allHeadlines[0], to = c.allHeadlines[1];
  const link = { id: 'spread-test', fromId: from.id, toId: to.id, relation: 'reports_on', date: to.date, sourceURL: 'https://example.org/report', evidenceIds: [c.evidence[0].id], basis: 'The report links the two records.', limit: 'Does not measure audience reach.' };
  assert.equal(validSpreadLink(link, c), true);
  assert.equal(validSpreadLink({ ...link, evidenceIds: ['unapproved'] }, c), false);
  assert.equal(validSpreadLink({ ...link, fromId: 'missing' }, c), false);
  assert.equal(validSpreadLink({ ...link, date: '2018-01-01' }, c), false);
  assert.equal(validSpreadLink({ ...link, sourceURL: 'http://example.org/report' }, c), false);
  assert.equal(validSpreadLink({ ...link, relation: 'causes' }, c), false);
  c.mediaRecords.push(
    { id: 'media-reply-newer', date: '2018-05-29', format: 'social_post' },
    { id: 'media-post-older', date: '2018-05-28', format: 'social_post' },
    { id: 'media-target-future', date: '2018-05-30', format: 'social_post' }
  );
  const replyEdge = { ...link, id: 'spread-reply-older', fromId: 'media-reply-newer', toId: 'media-post-older', relation: 'replies_to', date: '2018-05-29' };
  assert.equal(validSpreadLink(replyEdge, c), true, 'a reply may link to an older post');
  assert.equal(validSpreadLink({ ...replyEdge, id: 'spread-reply-future', toId: 'media-target-future' }, c), false, 'only previews may point to a future-dated target');
  const previewFrom = c.mediaRecords.find(record => record.format === 'social_post');
  if (previewFrom) {
    const preview = { ...link, relation: 'previews', fromId: previewFrom.id, toId: to.id, date: previewFrom.date };
    if (previewFrom.date < to.date) assert.equal(validSpreadLink(preview, c), true);
  }
});

test('social role validation is optional for old samples and closed to unknown classifications', () => {
  const c = structuredClone(cases.find(item => item.id === 'bulley-campaign'));
  const post = c.mediaRecords.find(record => record.format === 'social_post');
  assert.equal(validMediaRecord(post, c), true);
  assert.equal(validMediaRecord({ ...post, publicationRole: 'counter_speech' }, c), true);
  assert.equal(validMediaRecord({ ...post, publicationRole: 'bullying' }, c), false);
});

test('retained contributing posts and documented sharing edges remain explicit and valid', () => {
  const timelines = cases.map(c => buildAttentionTimeline(c));
  assert.equal(timelines.reduce((total, t) => total + t.counts.contributing, 0), 10);
  const edges = cases.flatMap(c => (c.spreadLinks || []).map(edge => ({ edge, c })));
  assert.equal(edges.length, 6);
  for (const { edge, c } of edges) assert.equal(validSpreadLink(edge, c), true, edge.id);
  const sterling = cases.find(c => c.id === 'sterling-campaign');
  const recovered = sterling.mediaRecords.find(r => r.id === 'media-sterling-keyworth');
  assert.equal(recovered.contentBasis, 'archived_post');
  assert.equal(recovered.date, '2018-05-28');
  assert.equal(recovered.captureTimestamp, '2018-05-28T22:55:17Z');
  assert.equal(recovered.observedMetrics[0].observationKind, 'archived_capture');
  assert.equal(recovered.observedMetrics[0].value, 887);
  assert.equal(recovered.observedMetrics[1].value, 911);
});
