import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const campaigns = JSON.parse(await readFile(new URL('./campaigns.json', import.meta.url), 'utf8'));
const item = campaigns[0];
const flack = campaigns.find(c => c.id === 'caroline-flack-recovered-campaign');
const csv = await readFile(new URL('./campaign-records.csv', import.meta.url), 'utf8');
const records = csv.trim().split(/\r?\n/).slice(1).map(line => {
  const [outlet, published, url] = line.split(',');
  return { outlet, published, url };
});

test('portable campaign data matches API data and Arday dated audit records', () => {
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
  const source = html.match(/function CampaignReveal\(g,c\)\{[\s\S]*?(?=window.CampaignReveal)/)[0];
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

test('portable game boots offline and keeps Flack sample separate from aggregate context', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: id === '#campaign-data' ? JSON.stringify(campaigns) : '',
      innerHTML: '', style: {}, dataset: {}, classList: { toggle() {} }, isConnected: true,
      value: id === '#case-choice' ? item.id : '', addEventListener() {}, pause() {}, load() {}, removeAttribute() {}, setAttribute() {}, querySelector() { return null; } });
    return nodes.get(id);
  };
  const context = vm.createContext({ document: { querySelector: node, querySelectorAll: () => [],
    body: { classList: { remove() {} } }, documentElement: { outerHTML: html, style: {}, classList: { toggle() {} } } },
    window: {}, location: { protocol: 'file:' }, matchMedia: () => ({ matches: false }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    cancelAnimationFrame() {}, URL, AbortController });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);
  await vm.runInContext('start()', context);
  assert.match(node('#app').innerHTML, /Inspect coverage/);
  vm.runInContext('go(2)', context);
  assert.match(node('#app').innerHTML, /Challenge this point/);
  vm.runInContext('go(3)', context);
  assert.match(node('#app').innerHTML, /Read its account and ask follow-ups/);
  assert.match(node('#deskview').innerHTML, /Hear this campaign/);
  await vm.runInContext('hearOverview(desks[0])', context);
  assert.match(node('#deskview').innerHTML, /Read outlet defence/);
  assert.match(node('#deskview').innerHTML, /We would defend reporting/);
  assert.equal(node('#qremaining').textContent, 3);
  vm.runInContext("answers.unit='pieces'; typedQuestionCounts['desk-a']=2; go(0)", context);
  node('#case-choice').value = flack.id;
  await vm.runInContext('start()', context);
  assert.match(node('#app').innerHTML, /recovered dated headline sample/i);
  assert.doesNotMatch(node('#app').innerHTML, /Aggregate window/);
  assert.match(node('#app').innerHTML, /24/);
  assert.match(node('#app').innerHTML, /19/);
  assert.match(node('#app').innerHTML, /class="bar"/);
  assert.equal(vm.runInContext('desks.length',context),4);
  assert.equal(vm.runInContext('Object.keys(answers).length',context),0);
  assert.equal(vm.runInContext("typedQuestionCounts['desk-a']",context),0);
  vm.runInContext('go(2); go(3); go(4)',context);
  assert.match(node('#app').innerHTML, /Five factual checks/);
  assert.match(node('#app').innerHTML, /not available/);
});

test('Arday outlet defences contain sourced first-person scripts and a qualified comparison', () => {
  const approved = new Set(item.evidence.map(e => e.id));
  const scripts = item.campaigns.map(c => c.briefing.paragraphs.map(p => p.text).join('\n\n'));
  assert.equal(new Set(scripts).size, 4);
  assert.match(item.narrationNotice, /not statements/);
  assert.match(item.comparison.limit, /no matched dated inventory/);
  assert.match(item.comparison.coverageClaim, /estimated/);
  for (const c of item.campaigns) {
    const script = c.briefing.paragraphs.map(p => p.text).join('\n\n');
    assert.ok(script.split(/\s+/).length >= 180 && script.length < 4000);
    assert.match(script, /\bwe\b/i);
    assert.doesNotMatch(script, /AI interpretation|active days|Public value:/);
    assert.ok(c.briefing.paragraphs.some(p => p.kind === 'report'));
    assert.ok(c.briefing.paragraphs.some(p => p.kind === 'analysis'));
    for (const p of c.briefing.paragraphs) {
      assert.match(p.text, /[.!?]$/);
      assert.ok(p.evidenceIds.length && p.evidenceIds.every(id => approved.has(id)));
    }
  }
  assert.equal(item.campaigns.reduce((n,c) => n + c.examples.length, 0), 11);
});


test('six playable cases share source-linked criteria and bounded sample rules', () => {
  assert.equal(campaigns.length, 6);
  assert.deepEqual(campaigns.map(c => c.id), [
    'arday-2026-campaign', 'caroline-flack-recovered-campaign', 'sterling-campaign',
    'markle-letter-campaign', 'bulley-campaign', 'jefferies-campaign'
  ]);
  const ids = ['public_value','context','framing','care','consistency','transparency'];
  for (const c of campaigns) {
    assert.equal(c.days.length, (Date.parse(`${c.end}T00:00:00Z`) - Date.parse(`${c.start}T00:00:00Z`)) / 86400000 + 1, `${c.id} has a complete inclusive day axis`);
    assert.equal(c.days[0], c.start); assert.equal(c.days.at(-1), c.end);
    for (let i=1;i<c.days.length;i++) assert.equal(Date.parse(`${c.days[i]}T00:00:00Z`) - Date.parse(`${c.days[i-1]}T00:00:00Z`),86400000,`${c.id} dates are continuous`);
    assert.deepEqual(c.scrutinyCriteria.map(x => x.id), ids);
    const approved = new Set(c.evidence.map(e => e.id));
    for (const d of c.campaigns) {
      assert.deepEqual(d.scrutiny.map(x => x.criterionId), ids);
      for (const row of d.scrutiny) assert.ok(row.evidenceIds.length && row.evidenceIds.every(id => approved.has(id)) && row.limit.length > 20);
      const text = d.briefing.paragraphs.map(p => p.text).join(' ');
      assert.ok(text.length < 4000 && text.split(/\s+/).length >= 180);
      assert.ok(d.briefing.paragraphs.every(p => p.evidenceIds.every(id => approved.has(id))));
      assert.ok(!text.includes(d.outlet));
      assert.equal(d.dailyCounts.length, c.days.length, `${c.id}/${d.id} daily counts align to its window`);
      assert.equal(d.dailyCounts.reduce((sum,n)=>sum+n,0),d.listedCount,`${c.id}/${d.id} daily counts equal selected sample total`);
    }
    const recoveredRows = c.allHeadlines?.length ? c.allHeadlines : c.campaigns.flatMap(d => d.examples || []);
    assert.ok(recoveredRows.length > 0, `${c.id} includes its recovered headline sample`);
    assert.ok(c.source?.corpusCount > 0 && c.source?.selectedCount > 0, `${c.id} declares sample and corpus scope`);
    assert.ok(c.images?.length >= 2 && c.images.every(image => image.url?.startsWith('data:image/')), `${c.id} includes embedded local case images`);
    for (const h of recoveredRows) {
      const headlineId = h.id ?? h.articleId ?? h.headlineId;
      const headlineOutlet = h.outlet ?? h.outletName ?? c.campaigns.find(d => (d.examples||[]).some(row => row === h))?.outlet;
      const headlineDate = h.date ?? h.published;
      assert.ok(headlineId && h.headline && headlineOutlet, `${c.id} headline row has an ID, text and outlet`);
      if (c.allHeadlines?.length) assert.ok(h.kind || h.nature, `${c.id}/${headlineId} identifies news/comment nature`);
      assert.ok(c.days.includes(headlineDate), `${c.id}/${headlineId} publication date falls inside its window`);
      assert.equal(new URL(h.originalURL || h.url || h.verificationSourceURL || h.sourceURL).protocol, 'https:', `${c.id}/${headlineId} retains a source URL`);
    }
  }
  const aggregate = flack.aggregateContext;
  assert.equal(aggregate.outlet,'The Sun'); assert.equal(aggregate.count,99);
  assert.equal(aggregate.windowStart,'2019-08-14'); assert.equal(aggregate.windowEnd,'2020-02-14');
  assert.equal(aggregate.isDailySeries,false); assert.equal(aggregate.isThisSample,false);
  assert.equal(flack.source.corpusCount,24); assert.equal(flack.source.selectedCount,19);
  assert.equal(flack.allHeadlines.length,24);
  assert.equal(flack.campaigns.reduce((n,d)=>n+d.listedCount,0),19);
  assert.ok(!flack.days.some(day => day < aggregate.windowStart), 'sample timeline does not extend the selected plot to the aggregate window');
  assert.notEqual(flack.source.corpusCount,aggregate.count,'dated sample and reported aggregate remain distinct quantities');
});

test('headline identities remain masked until reveal and all six image payloads are embedded', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: id === '#campaign-data' ? JSON.stringify(campaigns) : '', innerHTML:'',style:{},dataset:{},classList:{toggle(){}},isConnected:true,value:flack.id,addEventListener(){},pause(){},load(){},removeAttribute(){},setAttribute(){},querySelector(){return null;} });
    return nodes.get(id);
  };
  const context = vm.createContext({ document:{querySelector:node,querySelectorAll:()=>[],body:{classList:{remove(){}}},documentElement:{outerHTML:html,style:{},classList:{toggle(){}}},createElement:()=>({})},window:{},location:{protocol:'file:'},matchMedia:()=>({matches:false}),setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},cancelAnimationFrame(){},URL,AbortController });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  for (const c of campaigns) {
    assert.ok(c.images.length && c.images.every(image => /^data:image\/(jpeg|png|webp);base64,/.test(image.url)),`${c.id} image assets are embedded as local data URLs`);
  }
  for (const c of campaigns) {
    node('#case-choice').value=c.id;
    await vm.runInContext('start()',context);
    vm.runInContext('lastReveal=false',context);
    const masked=vm.runInContext('headlineTimeline()',context);
    for (const h of c.allHeadlines || []) assert.ok(!masked.includes(` · ${h.outlet} · `),`${c.id}/${h.id} outlet identity is masked before reveal`);
    vm.runInContext('lastReveal=true',context);
    const revealed=vm.runInContext('headlineTimeline()',context);
    for (const h of c.allHeadlines || []) assert.ok(revealed.includes(` · ${h.outlet} · `),`${c.id}/${h.id} source identity is available after reveal`);
  }
});
