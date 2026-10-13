import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const unique = (values) => new Set(values).size === values.length;
const urlIsHttp = (value) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};

test('release dataset has six distinct cases with sourced, identified records', async () => {
  const cases = await readJson('cases.json');
  assert.equal(cases.length, 6, 'the learning release covers six cases');
  assert.ok(unique(cases.map((entry) => entry.id)), 'case IDs are unique');

  for (const entry of cases) {
    assert.ok(entry.id && Array.isArray(entry.articles) && entry.articles.length > 0, `${entry.id} has identified article examples`);
    const articleIds = entry.articles.map((article) => article.id);
    assert.ok(articleIds.every(Boolean), `${entry.id} article IDs are present`);
    assert.ok(unique(articleIds), `${entry.id} article IDs are unique`);
    for (const article of entry.articles) {
      assert.ok(urlIsHttp(article.url), `${entry.id}/${article.id} has an HTTP source URL`);
      assert.ok(article.headline && article.outlet && article.published, `${entry.id}/${article.id} has headline metadata`);
    }
    for (const evidence of entry.evidence ?? []) {
      assert.ok(evidence.id && urlIsHttp(evidence.url), `${entry.id} evidence ${evidence.id} has an identified source URL`);
    }
  }
});

test('dated campaigns preserve continuous windows and totals; aggregates stay undated', async () => {
  const campaigns = await readJson('campaigns.json');
  assert.ok(campaigns.length >= 1);
  assert.ok(unique(campaigns.map((entry) => entry.id)), 'campaign IDs are unique');
  for (const campaign of campaigns) {
    assert.ok(isoDate(campaign.start) && isoDate(campaign.end), `${campaign.id} has a valid declared window`);
    assert.ok(Date.parse(`${campaign.end}T00:00:00Z`) >= Date.parse(`${campaign.start}T00:00:00Z`), `${campaign.id} window is ordered`);
    assert.ok(Array.isArray(campaign.days) && campaign.days.length > 0, `${campaign.id} discloses its day axis`);
    assert.ok(unique(campaign.days), `${campaign.id} day axis has no duplicates`);
    for (const day of campaign.days) assert.ok(isoDate(day), `${campaign.id} has valid day ${day}`);
    assert.equal(campaign.days[0], campaign.start, `${campaign.id} begins on its declared start`);
    assert.equal(campaign.days.at(-1), campaign.end, `${campaign.id} ends on its declared end`);
    for (let index = 1; index < campaign.days.length; index += 1) {
      assert.equal(Date.parse(`${campaign.days[index]}T00:00:00Z`) - Date.parse(`${campaign.days[index - 1]}T00:00:00Z`), 86_400_000, `${campaign.id} day axis is continuous`);
    }
    const evidenceIds = (campaign.evidence ?? []).map((record) => record.id);
    assert.ok(evidenceIds.every(Boolean) && unique(evidenceIds), `${campaign.id} evidence IDs are present and unique`);

    if (campaign.allHeadlines) {
      assert.ok(campaign.allHeadlines.length > 0, `${campaign.id} contains recovered headline records`);
      assert.ok(unique(campaign.allHeadlines.map((row) => row.id)), `${campaign.id} recovered headline IDs are unique`);
      for (const row of campaign.allHeadlines) {
        assert.ok(row.headline && row.outlet && (row.kind || row.nature), `${campaign.id}/${row.id} records headline, outlet and news/comment nature`);
        assert.ok(campaign.days.includes(row.date || row.published), `${campaign.id}/${row.id} falls inside the selected window`);
        assert.ok(urlIsHttp(row.originalURL || row.url || row.verificationSourceURL || row.sourceURL), `${campaign.id}/${row.id} has a source or verification URL`);
      }
    }

    const isAggregate = campaign.countMode === 'aggregate' || campaign.id === 'flack-sun-aggregate';
    for (const outlet of campaign.campaigns ?? []) {
      if (isAggregate) {
        assert.equal(outlet.dailyCounts, null, `${campaign.id}/${outlet.id} does not invent daily counts`);
        continue;
      }
      assert.equal(outlet.dailyCounts?.length, campaign.days.length, `${campaign.id}/${outlet.id} totals align with the day axis`);
      assert.ok(outlet.dailyCounts.every((count) => Number.isInteger(count) && count >= 0), `${campaign.id}/${outlet.id} counts are nonnegative integers`);
      assert.equal(outlet.dailyCounts.reduce((sum, count) => sum + count, 0), outlet.listedCount, `${campaign.id}/${outlet.id} daily total matches its listed count`);
    }
    for (const evidence of campaign.evidence ?? []) {
      assert.ok(evidence.id && urlIsHttp(evidence.url), `${campaign.id} evidence ${evidence.id} has an HTTP source`);
    }
  }
  const flack = campaigns.find((entry) => entry.id === 'flack-sun-aggregate');
  const recoveredFlack = campaigns.find((entry) => entry.id === 'caroline-flack-recovered-campaign');
  if (recoveredFlack) {
    assert.equal(recoveredFlack.allHeadlines.length, 24, 'the audited Flack headline sample retains its recovered row count');
    assert.equal(recoveredFlack.source.corpusCount, 24, 'Flack source count describes the recovered sample');
    assert.equal(recoveredFlack.source.selectedCount, 19, 'the plotted selected outlets retain nineteen dated rows');
    assert.equal(recoveredFlack.campaigns.reduce((sum, outlet) => sum + outlet.listedCount, 0), 19, 'Flack outlet lanes total only the selected dated sample');
    assert.equal(recoveredFlack.allHeadlines.filter((row) => recoveredFlack.campaigns.some(outlet => outlet.id === row.outletId || outlet.outlet === row.outlet)).length, 19, 'selected sample rows are a distinct subset of the 24 recovered records');
    assert.ok(recoveredFlack.days[0] > recoveredFlack.aggregateContext.windowStart, 'Flack plot is bounded to the later dated sample, not the longer aggregate period');
    assert.equal(recoveredFlack.aggregateContext.outlet, 'The Sun');
    assert.equal(recoveredFlack.aggregateContext.count, 99, 'the Guardian-reported count remains in separate context');
    assert.equal(recoveredFlack.aggregateContext.isDailySeries, false);
    assert.equal(recoveredFlack.aggregateContext.isThisSample, false);
    assert.equal(recoveredFlack.days.includes(recoveredFlack.aggregateContext.windowStart), false, 'aggregate period is not plotted as the sample timeline');
  }
});

test('editorial role-play stays ungraded and its paragraph evidence IDs resolve', async () => {
  const campaigns = await readJson('campaigns.json');
  for (const campaign of campaigns) {
    for (const outlet of campaign.campaigns ?? []) {
      const paragraphs = outlet.briefing?.paragraphs ?? [];
      const evidenceIds = new Set((campaign.evidence ?? []).map((record) => record.id));
      const paragraphIds = [];
      for (const [index, paragraph] of paragraphs.entries()) {
        const paragraphId = paragraph.id ?? paragraph.paragraphId ?? paragraph.paragraphID ?? `${campaign.id}:${outlet.id}:paragraph:${index + 1}`;
        paragraphIds.push(paragraphId);
        assert.ok(paragraphId, `${campaign.id}/${outlet.id} paragraph has an ID`);
        assert.ok(Array.isArray(paragraph.evidenceIds), `${paragraphId} carries its source links`);
        for (const id of paragraph.evidenceIds) assert.ok(evidenceIds.has(id), `${paragraphId} references known evidence ${id}`);
        for (const key of Object.keys(paragraph)) assert.doesNotMatch(key, /^(score|points|grade|correct|isCorrect)$/i, `${paragraphId} has no grading field`);
      }
      assert.ok(unique(paragraphIds), `${campaign.id}/${outlet.id} paragraph IDs are unique`);
    }
  }
  const guide = await readFile(path.join(root, 'README.html'), 'utf8');
  assert.match(guide, /fictional[^<]{0,100}(prompt|script)|fictional editorial/i);
  assert.match(guide, /verdicts, ratings and suggested counts are ungraded/i);
});

test('offline image credits match the local files and preserve attribution metadata', async () => {
  const credits = await readJson('assets/media-credits.json');
  assert.ok(Array.isArray(credits.images) && credits.images.length >= 12, 'image set covers the six cases and supporting context');
  assert.ok(unique(credits.images.map((image) => image.id)), 'image credit IDs are unique');
  for (const image of credits.images) {
    assert.ok(image.file?.startsWith('assets/images/'), `${image.id} is stored in the offline image folder`);
    assert.ok(image.author && image.license && image.licenseUrl && urlIsHttp(image.filePage), `${image.id} has author, license and file-page attribution`);
    assert.ok(urlIsHttp(image.imageUrl), `${image.id} records its original image URL`);
    const bytes = await readFile(path.join(root, image.file));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, image.sha256, `${image.id} file hash matches its credit record`);
    assert.equal((await stat(path.join(root, image.file))).size, image.bytes, `${image.id} byte count matches its credit record`);
  }
});
