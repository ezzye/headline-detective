import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COMPARISON_HOST_VERSION, comparisonIntro, comparisonStory, comparisonLimits, comparisonSegments} from './comparison-host.mjs';

const load = async name => JSON.parse(await readFile(new URL(`./${name}`, import.meta.url), 'utf8'));
const cases = await load('campaigns.json');
const bundles = await load('comparison-bundles.json');

test('comparison host covers every reviewed case and bundle combination deterministically', () => {
  assert.equal(COMPARISON_HOST_VERSION, 'cfj-comparison-host-v1');
  assert.equal(cases.length, 9);
  assert.equal(bundles.length, 6);
  const clips = new Map();
  for (const c of cases) {
    const intro = comparisonIntro(c);
    assert(intro.length >= 200 && intro.length <= 450, `${c.id}: ${intro.length} intro characters`);
    assert.match(intro, new RegExp(c.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(intro, /separate comparison story/i);
    assert.doesNotMatch(intro, /<[^>]+>|&(?:nbsp|amp|quot|lt|gt);/i);
    clips.set(`${c.id}:intro`, intro);
    for (const b of bundles) {
      const segments = comparisonSegments(c, b);
      assert.deepEqual(segments.map(({id, kind}) => ({id, kind})), [
        {id: c.id, kind: 'intro'}, {id: b.id, kind: 'story'}, {id: 'comparison-limits', kind: 'limits'}
      ]);
      assert.equal(segments[0].text, intro);
      assert.equal(segments[1].text, comparisonStory(b));
      assert.equal(segments[2].text, comparisonLimits());
    }
  }
  for (const b of bundles) {
    const story = comparisonStory(b);
    assert(story.startsWith(`${b.title}.`));
    assert(story.includes(b.summary.replace('proof that the university case received disproportionate coverage', 'proof that another case received disproportionate coverage').replace('IICSA recorded', 'The Independent Inquiry into Child Sexual Abuse recorded')));
    assert.doesNotMatch(story, /<[^>]+>|&(?:nbsp|amp|quot|lt|gt);/i);
    clips.set(`${b.id}:story`, story);
  }
  clips.set('comparison-limits', comparisonLimits());
  const unique = [...new Set(clips.values())];
  const total = unique.reduce((sum, text) => sum + text.length, 0);
  const max = Math.max(...unique.map(text => text.length));
  assert.equal(clips.size, 16);
  assert(total < 12_000, `total clip characters: ${total}`);
  assert(max > 0);
  assert.equal(comparisonIntro(cases[0]), comparisonIntro(cases[0]));
  assert.equal(comparisonStory(bundles[0]), comparisonStory(bundles[0]));
  console.log(`comparison voice clips: ${clips.size} unique, ${total} total characters, ${max} maximum clip characters`);
});

test('provider-bound text is cleaned and unknown or malformed records fail closed', () => {
  assert.doesNotMatch(comparisonIntro({...cases[0], title: '<b>Case &amp; context</b>'}), /<[^>]+>|&amp;/i);
  assert.doesNotMatch(comparisonStory({...bundles[0], title: '<b>Title</b>', summary: 'One&nbsp;fact &amp; its limit.'}), /<[^>]+>|&(?:nbsp|amp);/i);
  assert.throws(() => comparisonIntro(null), TypeError);
  assert.throws(() => comparisonIntro({id: 'unknown', title: 'Unknown'}), TypeError);
  assert.throws(() => comparisonIntro({...cases[0], title: ''}), TypeError);
  assert.throws(() => comparisonStory(undefined), TypeError);
  assert.throws(() => comparisonStory({...bundles[0], kind: 'unreviewed'}), TypeError);
  assert.throws(() => comparisonStory({...bundles[0], summary: ''}), TypeError);
});
