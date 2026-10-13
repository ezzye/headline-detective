import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

test('portable game and server use the same reviewed case pack', () => {
  const embedded = JSON.parse(html.match(/<script id="case-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, cases);
  assert.equal(cases.filter(c => c.mode === 'public-interest').length, 3);
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  for (const c of cases) for (const a of c.articles) assert.equal(new URL(a.url).protocol, 'https:');
});

test('portable pile-on scoring depends on evidence answers, preserves mixed judgments and source binding', () => {
  const source = html.match(/function offlinePileReveal\(\)\{[\s\S]*?(?=\nfunction pileReveal)/)[0];
  for (const item of cases.filter(c => c.mode === 'public-interest')) {
    const assigned = [...item.articles].reverse();
    const desks = assigned.map((_a, n) => ({ outletId: 'desk-' + n }));
    const articles = Object.fromEntries(desks.map((d, n) => [d.outletId, assigned[n]]));
    const game = { item, desks, articles, votes: Object.fromEntries(desks.map(d => [d.outletId, 'mixed'])),
      assessments: Object.fromEntries(desks.map(d => [d.outletId, { publicValue: 'strong', pressure: 'high' }])),
      reasoningAnswers: Object.fromEntries(item.reasoningChecks.map(c => [c.id, c.answer])),
      justification: 'This test argument is retained for discussion, not treated as an automatic moral truth.' };
    const run = vm.runInNewContext('(' + source + ')', { game });
    let result = run();
    assert.equal(result.reasoningScore, 10);
    assert.equal('coverageCorrect' in result, false);
    assert.ok(result.roles.every((r, n) => r.article.id === assigned[n].id && r.decision === 'mixed'));
    for (const d of desks) game.votes[d.outletId] = 'pile-on';
    assert.equal(run().reasoningScore, 10);
    const first = item.reasoningChecks[0];
    game.reasoningAnswers[first.id] = first.options.find(o => o.value !== first.answer).value;
    assert.equal(run().reasoningScore, 8);
  }
});
