import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const campaigns = JSON.parse(await readFile(new URL('./campaigns.json', import.meta.url), 'utf8'));
const item = campaigns[0];
const csv = await readFile(new URL('./campaign-records.csv', import.meta.url), 'utf8');
const records = csv.trim().split(/\r?\n/).slice(1).map(line => {
  const [outlet, published, url] = line.split(',');
  return { outlet, published, url };
});

test('portable campaign data matches API data and all 90 dated audit records', () => {
  const embedded = JSON.parse(html.match(/<script id="campaign-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, campaigns);
  assert.equal(item.days.length, 22);
  assert.equal(item.days[0], '2026-07-24');
  assert.equal(item.days.at(-1), '2026-08-14');
  assert.match(item.endNote, /15:12 BST/);
  assert.equal(records.length, 90);
  assert.equal(new Set(records.map(r => r.url)).size, 90);
  assert.equal(item.source.corpusCount, 229);
  assert.equal(item.source.outletUniverse, 15);
  assert.match(item.source.scopeNote, /lower bounds/);
  for (const c of item.campaigns) {
    const rows = records.filter(r => r.outlet === c.outlet);
    assert.deepEqual(c.dailyCounts, item.days.map(day => rows.filter(r => r.published === day).length));
    assert.equal(c.listedCount, rows.length);
    assert.equal(c.beforeResignationCount, rows.filter(r => r.published < '2026-08-05').length);
    assert.equal(c.afterResignationCount, rows.filter(r => r.published >= '2026-08-05').length);
    for (const e of c.examples) {
      assert.ok(rows.some(r => r.url === e.url && r.published === e.published));
      assert.equal(new URL(e.url).protocol, 'https:');
      assert.ok(e.verification.length > 20);
    }
  }
  assert.deepEqual(item.campaigns.map(c => c.listedCount), [9,18,21,42]);
});

test('offline desks stay distinct and whole-campaign choices never change evidence score', () => {
  const normalizeSource = html.match(/function normalizeOffline\([^\n]+/)[0];
  const normalize = vm.runInNewContext('(' + normalizeSource + ')');
  const desks = item.campaigns.map(normalize);
  assert.equal(new Set(desks.map(d => d.outletId)).size, 4);
  const source = html.match(/function CampaignReveal\(g,item\)\{[\s\S]*?(?=\nwindow.CampaignReveal)/)[0];
  const reveal = vm.runInNewContext('(' + source + ')');
  const game = { desks, verdicts: Object.fromEntries(desks.map(d => [d.outletId, 'justified'])),
    budgets: Object.fromEntries(desks.map(d => [d.outletId, d.listedCount])),
    reasoningAnswers: Object.fromEntries(item.reasoningChecks.map(c => [c.id,c.answer])),
    justification: 'I considered the full window, public interest and archive gaps before judging the volume.' };
  let result = reveal(game, item);
  assert.equal(result.reasoningScore, 10);
  assert.ok(result.roles.every(r => r.decision === 'justified' && r.campaign.outlet === r.outletName));
  for (const d of desks) { game.verdicts[d.outletId] = 'pile-on'; game.budgets[d.outletId] = 0; }
  result = reveal(game, item);
  assert.equal(result.reasoningScore, 10);
  assert.ok(result.roles.every(r => r.decision === 'pile-on' && r.recommendedCount === 0));
  assert.equal('coverageCorrect' in result, false);
  const first = item.reasoningChecks[0];
  game.reasoningAnswers[first.id] = first.options.find(o => o.value !== first.answer).value;
  assert.equal(reveal(game, item).reasoningScore, 8);
});

test('portable game boots offline and can open the timeline and analyst without missing state', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: id === '#campaign-data' ? JSON.stringify(campaigns) : '',
      innerHTML: '', style: {}, dataset: {}, classList: { toggle() {} }, isConnected: true,
      pause() {}, load() {}, removeAttribute() {}, setAttribute() {}, querySelector() { return null; } });
    return nodes.get(id);
  };
  const context = vm.createContext({ document: { querySelector: node, querySelectorAll: () => [],
    documentElement: { outerHTML: html, style: {}, classList: { toggle() {} } } },
    window: {}, location: { protocol: 'file:' }, matchMedia: () => ({ matches: false }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    cancelAnimationFrame() {}, URL, AbortController });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);
  await vm.runInContext('start()', context);
  assert.match(node('#app').innerHTML, /Replay the period/);
  vm.runInContext('go(2)', context);
  assert.match(node('#app').innerHTML, /Hear the campaign read/);
  assert.match(node('#deskview').innerHTML, /Hear this campaign/);
  assert.equal(node('#qremaining').textContent, 3);
});
