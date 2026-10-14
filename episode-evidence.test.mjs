import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEpisodeTimeline, validEpisode, validLevesonContext} from './episode-evidence.mjs';
import {readFile} from 'node:fs/promises';

const caseItem = {
  id: 'mini-case', start: '2010-12-30', end: '2011-01-05',
  evidence: [{id: 'e1'}, {id: 'e2'}],
  allHeadlines: [
    {id: 'a1', date: '2010-12-31', outlet: 'Alpha', headline: 'One', originalURL: 'https://alpha.test/story?print=1'},
    {id: 'a1-copy', date: '2010-12-31', outlet: 'Alpha', headline: 'One duplicate capture', originalURL: 'https://alpha.test/story#top'},
    {id: 'a2', date: '2011-01-01', outlet: 'Alpha', headline: 'Two', originalURL: 'https://alpha.test/two'},
    {id: 'b-outside', date: '2011-01-04', outlet: 'Beta', headline: 'Outside episode', originalURL: 'https://beta.test/outside'}
  ]
};
const episode = {
  id: 'episode-three-days', title: 'A three-day sample', start: '2010-12-31', end: '2011-01-02',
  scopeNote: 'A small dated selection; no selected story on a day does not prove no coverage.',
  recordIds: ['a1', 'a1-copy', 'a2'],
  knownEvents: [{id: 'arrest', date: '2010-12-31', label: 'Arrest', summary: 'Arrest on suspicion; no charge is implied.',
    url: 'https://evidence.test/arrest', evidenceIds: ['e1'], knowledgeStatus: 'public_at_time'}],
  outletKnowledge: [
    {outlet: 'Alpha', scope: 'One outlet’s selected headlines', limit: 'Not a complete archive.', sourceURL: 'https://evidence.test/alpha', evidenceIds: ['e1'], knowledgeStatus: 'public_at_time'},
    {outlet: 'Beta', scope: 'No selected record in these three days', limit: 'Zero is not evidence of no coverage.', sourceURL: 'https://evidence.test/beta', evidenceIds: ['e2'], knowledgeStatus: 'public_at_time'}
  ]
};

test('three-day timeline counts distinct selected records by date and outlet', () => {
  const timeline = buildEpisodeTimeline(episode, caseItem);
  assert.deepEqual(timeline.dates.map(day => day.date), ['2010-12-31', '2011-01-01', '2011-01-02']);
  assert.deepEqual(timeline.dates.map(day => day.outlets.map(({outlet, count, cumulativeCount}) => [outlet, count, cumulativeCount])), [
    [['Alpha', 1, 1], ['Beta', 0, 0]],
    [['Alpha', 1, 2], ['Beta', 0, 0]],
    [['Alpha', 0, 2], ['Beta', 0, 0]]
  ]);
  assert.equal(timeline.distinctRecordCount, 2);
  assert.deepEqual(timeline.outlets.map(({outlet, count, playable}) => [outlet, count, playable]), [['Alpha', 2, true], ['Beta', 0, false]]);
  assert.deepEqual(timeline.dates[0].outlets[0].recordIds, ['a1']);
  assert.match(timeline.measureNote, /not evidence of no coverage/);
});

test('episode validation rejects references outside the case/window and non-HTTPS sources', () => {
  assert.equal(validEpisode(episode, caseItem), true);
  assert.equal(validEpisode({...episode, recordIds: ['missing']}, caseItem), false);
  assert.equal(validEpisode({...episode, recordIds: ['b-outside']}, caseItem), false);
  const badEvent = {...episode, knownEvents: [{...episode.knownEvents[0], url: 'http://evidence.test/arrest'}]};
  assert.equal(validEpisode(badEvent, caseItem), false);
  assert.throws(() => buildEpisodeTimeline(badEvent, caseItem), /Invalid episode/);
});

test('retrospective testimony cannot be labeled known at the time', () => {
  const later = {...episode, knownEvents: [{...episode.knownEvents[0], knowledgeStatus: 'later_testimony', dateClaimed: '2011-01-02'}]};
  assert.equal(validEpisode(later, caseItem), false);
  later.knownEvents[0].dateClaimed = '2011-01-03';
  assert.equal(validEpisode(later, caseItem), true);
  later.knownEvents[0].knowledgeStatus = 'public_at_time';
  assert.equal(validEpisode(later, caseItem), false);
});

test('eight retained records and four validated print supplements form one selected sample', () => {
  const baseRows = Array.from({length: 8}, (_, i) => ({id: `core-${i + 1}`, date: `2010-12-${31 + (i % 1)}`,
    outlet: i < 5 ? 'Paper A' : 'Paper B', headline: `Core headline ${i + 1}`, originalURL: `https://publisher.test/${i + 1}`}));
  // Use a three-day case window, while an unrelated outlet remains outside the episode selection.
  const baseCase = {...caseItem, start: '2010-12-30', end: '2011-01-05', allHeadlines: [
    ...baseRows,
    {id: 'context-warning', date: '2011-01-01', outlet: 'Paper C', headline: 'Contemporaneous warning', originalURL: 'https://publisher.test/warning'},
    {id: 'unselected', date: '2011-01-01', outlet: 'Outside Paper', headline: 'Not in episode', originalURL: 'https://publisher.test/outside'}
  ]};
  const extras = Array.from({length: 4}, (_, i) => ({id: `print-extra-${i + 1}`, date: `2011-01-0${i < 2 ? 1 : 2}`,
    outlet: i < 2 ? 'Paper A' : 'Paper B', headline: `Print headline ${i + 1}`, sourceURL: 'https://evidence.test/witness-statement.pdf',
    sourceLocator: `page ${12 + i}, item ${i + 1}`, format: 'print', provenance: 'witness_statement_list', evidenceIds: ['e1']}));
  const packet = {...episode, start: '2010-12-31', end: '2011-01-02', recordIds: [...baseRows.map(row => row.id), ...extras.map(row => row.id)],
    additionalRecords: extras, contextRecordIds: ['context-warning'], outletKnowledge: []};
  const timeline = buildEpisodeTimeline(packet, baseCase);
  assert.equal(validEpisode(packet, baseCase), true);
  assert.equal(timeline.distinctRecordCount, 12);
  assert.deepEqual(timeline.outlets.map(({outlet, count}) => [outlet, count]), [['Paper A', 7], ['Paper B', 5]]);
  assert.deepEqual(timeline.dates.map(({date}) => date), ['2010-12-31', '2011-01-01', '2011-01-02']);
  assert(!timeline.outlets.some(({outlet}) => outlet === 'Outside Paper' || outlet === 'Paper C'));
});

test('supplemental and contextual records must be unique, referenced, and in bounds', () => {
  const extra = {id: 'print-extra', date: '2011-01-01', outlet: 'Paper A', headline: 'Print headline',
    sourceURL: 'https://evidence.test/witness-statement.pdf', sourceLocator: 'page 13, item 4', format: 'print',
    provenance: 'witness_statement_list', evidenceIds: ['e1']};
  const packet = {...episode, recordIds: ['a1', 'a2', 'print-extra'], additionalRecords: [extra], contextRecordIds: ['b-outside']};
  assert.equal(validEpisode(packet, caseItem), false); // context item falls outside the episode
  packet.contextRecordIds = ['a1'];
  assert.equal(validEpisode(packet, caseItem), true);
  assert.equal(validEpisode({...packet, additionalRecords: [{...extra, id: 'a1'}]}, caseItem), false);
  assert.equal(validEpisode({...packet, additionalRecords: [{...extra, date: '2011-01-03'}]}, caseItem), false);
  assert.equal(validEpisode({...packet, additionalRecords: [{...extra, evidenceIds: ['missing']}]}, caseItem), false);
  assert.equal(validEpisode({...packet, additionalRecords: [{...extra, sourceURL: 'http://evidence.test/file'}]}, caseItem), false);
  assert.equal(validEpisode({...packet, contextRecordIds: ['missing']}, caseItem), false);
});

test('prelude event may precede the episode start, while retrospective claim date must follow it', () => {
  const prelude = {...episode, knownEvents: [{id: 'arrest-prelude', date: caseItem.start, label: 'Arrest', summary: 'Arrest on suspicion.',
    url: 'https://evidence.test/arrest', evidenceIds: ['e1'], knowledgeStatus: 'public_at_time'}]};
  assert.equal(validEpisode(prelude, caseItem), true);
  const contradiction = {...episode, knownEvents: [{...episode.knownEvents[0], knowledgeStatus: 'later_testimony', dateClaimed: episode.end}]};
  assert.equal(validEpisode(contradiction, caseItem), false);
});

test('same publisher article across dates is counted once on its earliest supplied date', () => {
  const rows = [
    {id: 'early', date: '2010-12-31', outlet: 'Alpha', headline: 'Story', originalURL: 'https://alpha.test/story'},
    {id: 'later-capture', date: '2011-01-01', outlet: 'Alpha', headline: 'Story capture', originalURL: 'https://alpha.test/story?view=print'}
  ];
  const item = {...caseItem, allHeadlines: rows};
  const packet = {...episode, recordIds: rows.map(row => row.id), additionalRecords: []};
  const timeline = buildEpisodeTimeline(packet, item);
  assert.equal(timeline.distinctRecordCount, 1);
  assert.deepEqual(timeline.dates.map(day => day.outlets[0].count), [1, 0, 0]);
});

test('real three-day set preserves six titles, eight selected articles and later-knowledge boundaries', async () => {
  const cases = JSON.parse(await readFile(new URL('./campaigns.json', import.meta.url), 'utf8'));
  const c = cases.find(item => item.id === 'jefferies-campaign');
  const trail = buildEpisodeTimeline(c.episode, c);
  assert.equal(trail.distinctRecordCount, 8);
  assert.equal(trail.outlets.length, 6);
  assert.deepEqual(trail.dates.map(day => day.outlets.reduce((sum, row) => sum + row.count, 0)), [5, 2, 1]);
  assert.deepEqual(trail.dates.map(day => day.outlets.reduce((sum, row) => sum + row.cumulativeCount, 0)), [5, 7, 8]);
  assert.equal(c.episode.additionalRecords.length, 4);
  assert.equal(cases.reduce((sum, item) => sum + item.allHeadlines.length, 0), 179);
  const bail = c.allHeadlines.find(row => row.id === 'jefferies-20110101-guardian-bail');
  assert.equal(bail.date, '2011-01-02');
  assert.equal(bail.publishedAtUTC, '2011-01-02T00:39:00Z');
  assert.equal(c.episode.knownEvents.find(row => row.id === 'episode-bail').date, '2011-01-01');
  assert.equal(validEpisode({...c.episode, knownEvents: [...c.episode.knownEvents, {...c.episode.knownEvents[0], date: '2011-01-03'}]}, c), false);
  assert.equal(c.episode.outletKnowledge.filter(row => row.knowledgeStatus === 'not_recovered').length, 4);
  for (const item of cases) {
    assert.equal(validLevesonContext(item.levesonContext, item), true);
    assert.equal(item.levesonContext.relationship, item.id === c.id ? 'direct_case_findings' : 'ethical_comparison');
  }
});
