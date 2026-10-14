import { summarizeFootballEpisode } from './football-framing.mjs';

const CUTOFF = '2022-01-01';
const dateBeforeCutoff = value => typeof value === 'string' && value < CUTOFF;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function outletFamily(campaign) {
  const name = typeof campaign === 'string'
    ? campaign
    : campaign?.outlet ?? campaign?.name ?? campaign?.label ?? '';
  const value = String(name).toLowerCase();
  if(value.includes('bbc'))return {id:'bbc',label:'BBC',matches:outlet=>/^bbc(?: news| sport)?$/i.test(outlet)};
  if (value.includes('sky')) return { id: 'sky', label: 'Sky News / Sky Sports', matches: outlet => /\bsky (?:news|sports)\b/i.test(outlet) };
  if (value.includes('guardian') || value.includes('observer')) return { id: 'guardian', label: 'The Guardian / Observer', matches: outlet => /guardian|observer/i.test(outlet) };
  const normalized=value.replace(/^the /,'');return {id:normalized,label:name,matches:outlet=>String(outlet).toLowerCase().replace(/^the /,'')===normalized};
}

function isExplicitComparison(question) {
  if (typeof question !== 'string') return false;
  const comparison = /\b(compare|comparison|comparative|contrast|contrasting)\b/i.test(question);
  const footballContext = /\b(football|England|Foden|Greenwood|Sterling|Diallo|outlets?|coverage|media|press|selection|Iceland)\b/i.test(question);
  return comparison && footballContext;
}

function uniqueStoryCount(rows, formats) {
  const matching = rows.filter(row => row.sourceStatus === 'publisher_verified' && formats.includes(row.format));
  return new Set(matching.map(row => row.storyGroupId || row.id)).size;
}

function compactRecord(row) {
  return {
    id: row.id,
    date: row.date,
    outlet: row.outlet,
    headline: row.headline,
    format: row.format,
    sourceStatus: row.sourceStatus,
    url: row.url,
    eventId: row.eventId,
    framingNote: row.framingNote,
    limits: row.limits,
    storyGroupId: row.storyGroupId || null,
  };
}

function trustedRows(corpus, episodeIds, evidenceIds) {
  const records = new Map();
  const events = new Map();
  for (const id of episodeIds) {
    const summary = summarizeFootballEpisode(corpus, id);
    for (const row of summary.records) {
      if (evidenceIds.has(row.id) && dateBeforeCutoff(row.date) && row.sourceStatus==='publisher_verified') records.set(row.id, row);
    }
    for (const event of summary.events) {
      if (evidenceIds.has(event.id) && dateBeforeCutoff(event.date)) events.set(event.id, event);
    }
  }
  return { records, events };
}

function shapeComparison(comparison) {
  return {
    id: comparison.id,
    title: comparison.title,
    sharedAct: comparison.sharedAct,
    contextDifferences: comparison.contextDifferences,
    limits: comparison.limit,
  };
}

/** Build bounded football evidence for an explicit case episode or football comparison query. */
export function buildFootballContext(corpus, caseItem, campaign, question, episodeId = null) {
  const caseEpisodes = Array.isArray(caseItem?.footballEpisodeIds) ? caseItem.footballEpisodeIds : [];
  const evidenceIds = new Set((Array.isArray(caseItem?.evidence) ? caseItem.evidence : []).map(row => row?.id).filter(id => typeof id === 'string'));
  const family = outletFamily(campaign);
  if (episodeId != null && (typeof episodeId !== 'string' || !caseEpisodes.includes(episodeId))) {
    throw badRequest('Football episode is not available for this case.');
  }
  if (!family || !caseEpisodes.length || !evidenceIds.size) return null;

  const explicitComparison = isExplicitComparison(question);
  if(episodeId==null&&!explicitComparison&&!/Foden|Diallo|Amad|Iceland|pre.?2022|before.?2022|family.?homes|house.?tour|2020|2021/i.test(question||''))return null;

  const allowedEpisodes = episodeId ? [episodeId] : caseEpisodes;
  let trusted;
  try {
    trusted = trustedRows(corpus, allowedEpisodes, evidenceIds);
  } catch (error) {
    if (episodeId) throw badRequest('Football episode is not available for this case.');
    return null;
  }

  const episodeRecords = [...trusted.records.values()];
  const eligibleComparison = comparison => {
    const ids = [...comparison.leftRecordIds, ...comparison.rightRecordIds];
    return ids.length > 0 && ids.every(id => evidenceIds.has(id) && corpus.records.some(r=>r.id===id&&dateBeforeCutoff(r.date)));
  };
  let comparisons = (Array.isArray(corpus?.comparisons) ? corpus.comparisons : []).filter(eligibleComparison);
  if (explicitComparison && typeof question === 'string') {
    const terms = question.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 3);
    const ranked = comparisons.map(row => ({ row, score: terms.filter(term => `${row.title} ${row.sharedAct} ${row.contextDifferences}`.toLowerCase().includes(term)).length }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    if (ranked.length) comparisons = ranked.slice(0, 3).map(item => item.row);
    else comparisons = [];
  } else {
    const episodeIds = new Set(allowedEpisodes);
    const selectedIds = new Set(episodeRecords.map(row => row.id));
    comparisons = comparisons.filter(row => [...row.leftRecordIds, ...row.rightRecordIds].some(id => selectedIds.has(id))
      && corpus.episodes.some(ep => episodeIds.has(ep.id) && [...ep.recordIds].some(recordId => row.leftRecordIds.includes(recordId) || row.rightRecordIds.includes(recordId))));
  }

  let selectedIds;
  if (explicitComparison && episodeId == null) {
    selectedIds = new Set(comparisons.flatMap(row => [...row.leftRecordIds, ...row.rightRecordIds]));
  } else {
    selectedIds = new Set(episodeRecords.map(row => row.id));
  }

  const relevant = episodeRecords.filter(row => selectedIds.has(row.id));
  const ownRecords = relevant.filter(row => family.matches(row.outlet)).slice(0, 12).map(compactRecord);
  const externalComparators=comparisons.flatMap(c=>[...c.leftRecordIds,...c.rightRecordIds]).map(id=>corpus.records.find(r=>r.id===id)).filter(r=>r&&r.sourceStatus==='publisher_verified'&&!relevant.some(x=>x.id===r.id));
  const comparatorRecords = [...relevant.filter(row => !family.matches(row.outlet)),...externalComparators].slice(0, 8).map(compactRecord);
  if (!ownRecords.length && !comparatorRecords.length) return null;

  const selectedDates = relevant.map(row => row.date).sort();
  const eventIds = new Set(relevant.map(row => row.eventId).filter(Boolean));
  const commonEvents = [...trusted.events.values()].filter(event => eventIds.has(event.id)
    || (selectedDates.length && event.date >= selectedDates[0] && event.date <= selectedDates.at(-1)))
    .sort((a, b) => a.date.localeCompare(b.date)).map(event => ({ id: event.id, date: event.date, label: event.label, summary: event.summary }));
  const selectedEpisodes = (corpus.episodes || []).filter(ep => allowedEpisodes.includes(ep.id));
  const periods = relevant.length
    ? { start: selectedDates[0], end: selectedDates.at(-1) }
    : { start: selectedEpisodes.map(ep => ep.start).sort()[0], end: selectedEpisodes.map(ep => ep.end).sort().at(-1) };

  const rules = [
    'These are selected recovered records, not a census; no recovered item does not establish that none was published.',
    'Own records are limited to the selected publisher or explicitly grouped outlet family; records from other publishers remain contextual comparators.',
    'Only publisher-verified records with evidence IDs attached to this case are eligible, and records/events from 2022 onward are excluded.',
    'News, opinion, and official statements remain distinct. Publisher placements and explicit shared wire groups are distinct; ungrouped records are not assumed independent.',
    'A shared event or different news hook does not prove unequal treatment or editorial intent.',
  ];

  return {
    selectedPeriod:episodeId?{start:selectedEpisodes[0].start,end:selectedEpisodes[0].end}:periods,
    ownOutletFamily: family.label,
    ownRecords,
    ownNewsPlacementCount:ownRecords.filter(r=>['article','liveblog'].includes(r.format)).length,
    knownSharedStoryGroups:[...new Set(ownRecords.map(r=>r.storyGroupId).filter(Boolean))],
    ownNewsCount: uniqueStoryCount(ownRecords, ['article', 'liveblog']),
    ownOpinionCount: uniqueStoryCount(ownRecords, ['opinion']),
    commonEvents,
    comparatorRecords,
    comparisons: comparisons.map(shapeComparison),
    rules,
    evidenceIds: [...new Set([...ownRecords, ...comparatorRecords].map(row => row.id).concat(commonEvents.map(event => event.id)))].filter(id => evidenceIds.has(id)).slice(0, 20),
  };
}

/** Produce an anonymous first-person response that keeps own coverage separate from comparators. */
export function footballFallback(context, { anonymousLabel = 'this outlet' } = {}) {
  if (!context || !Array.isArray(context.ownRecords) || !Array.isArray(context.comparatorRecords)) return { reply: '', evidenceIds: [] };
  const label = String(anonymousLabel || 'this outlet').trim().replace(/[<>]/g, '') || 'this outlet';
  const period = context.selectedPeriod ? `${context.selectedPeriod.start} to ${context.selectedPeriod.end}` : 'the selected period';
  const ownVerified = context.ownRecords.filter(row => row.sourceStatus === 'publisher_verified');
  const ownNews = context.ownNewsPlacementCount??context.ownNewsCount;
  const ownOpinion = context.ownOpinionCount;
  const ownSummary = ownVerified.length
    ? `In our selected records from ${label} (${period}), we found ${ownNews} verified news item${ownNews === 1 ? '' : 's'} and ${ownOpinion} verified opinion item${ownOpinion === 1 ? '' : 's'}.`
    : `We found no verified record from ${label} in this selected window; that is a recovery gap, not proof that none was published.`;
  const firstOwn = ownVerified[0];
  const ownDetail = firstOwn
    ? `Our record is ${firstOwn.format} dated ${firstOwn.date}: “${firstOwn.headline}.” Its limits remain part of the evidence.`
    : '';
  const comparator = context.comparatorRecords.find(row => row.sourceStatus === 'publisher_verified');
  const otherDetail = comparator
    ? `Separately, another source's ${comparator.format} dated ${comparator.date} was “${comparator.headline}.” We treat that as context, not our coverage.`
    : '';
  const allSelectedText = [...context.ownRecords, ...context.comparatorRecords]
    .map(row => `${row.headline || ''} ${row.framingNote || ''} ${row.limits || ''}`).join(' ');
  const uncertainty = /deni(?:ed|es|al)|reject(?:ed|s)?|dismiss(?:ed|es|al)|not true|untrue/i.test(allSelectedText)
    ? 'A reported claim and a denial are attributed accounts; this selected material does not resolve that disagreement.'
    : '';
  const comparison = context.comparisons?.[0];
  const limit = comparison
    ? `${comparison.contextDifferences} ${comparison.limits}`
    : 'The selected records do not establish silence, a causal explanation, or editorial intent.';
  return {
    reply: [ownSummary, ownDetail, otherDetail, uncertainty, limit].filter(Boolean).join(' '),
    evidenceIds: (context.evidenceIds || []).slice(0, 8),
  };
}
