const STATUSES = new Set(['public_at_time', 'later_testimony', 'contested_later_testimony', 'not_recovered']);
const RETROSPECTIVE = new Set(['later_testimony', 'contested_later_testimony']);

export const isEpisodeDate = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const isHttps = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
const evidenceExists = (ids, caseItem) => Array.isArray(ids) && ids.length > 0
  && new Set(ids).size === ids.length
  && ids.every(id => caseItem.evidence?.some(item => item.id === id));

/** Validate a small, explicitly scoped episode packet against the retained case corpus. */
export function validEpisode(episode, caseItem) {
  if (!episode || typeof episode !== 'object' || Array.isArray(episode) || !caseItem) return false;
  if (typeof episode.id !== 'string' || !/^episode-[a-z0-9][a-z0-9-]*$/i.test(episode.id)) return false;
  if (!isEpisodeDate(episode.start) || !isEpisodeDate(episode.end) || episode.start > episode.end
      || episode.start < caseItem.start || episode.end > caseItem.end) return false;
  if (typeof episode.title !== 'string' || !episode.title.trim()
      || typeof episode.scopeNote !== 'string' || !episode.scopeNote.trim()) return false;
  if (!Array.isArray(episode.recordIds) || !episode.recordIds.length
      || new Set(episode.recordIds).size !== episode.recordIds.length) return false;
  const records = caseItem.allHeadlines ?? [];
  const baseIds = new Set(records.map(row => row.id));
  const supplemental = episode.additionalRecords ?? [];
  if (!Array.isArray(supplemental)) return false;
  const supplementalIds = new Set();
  for (const row of supplemental) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || baseIds.has(row.id)
        || supplementalIds.has(row.id) || !isEpisodeDate(row.date)
        || row.date < episode.start || row.date > episode.end
        || typeof row.outlet !== 'string' || !row.outlet.trim()
        || typeof row.headline !== 'string' || !row.headline.trim()
        || !isHttps(row.sourceURL) || typeof row.sourceLocator !== 'string' || !row.sourceLocator.trim()
        || row.format !== 'print' || row.provenance !== 'witness_statement_list'
        || !evidenceExists(row.evidenceIds, caseItem)) return false;
    supplementalIds.add(row.id);
  }
  const recordMap = new Map([...records, ...supplemental].map(row => [row.id, row]));
  const selected = episode.recordIds.map(id => recordMap.get(id));
  if (selected.some(row => !row || row.date < episode.start || row.date > episode.end)) return false;
  if (episode.contextRecordIds !== undefined) {
    if (!Array.isArray(episode.contextRecordIds) || new Set(episode.contextRecordIds).size !== episode.contextRecordIds.length) return false;
    for (const id of episode.contextRecordIds) {
      const row = records.find(item => item.id === id);
      if (!row || row.date < episode.start || row.date > episode.end) return false;
    }
  }
  const validStatus = status => STATUSES.has(status);
  if (!Array.isArray(episode.knownEvents)) return false;
  for (const event of episode.knownEvents) {
    if (!event || typeof event.id !== 'string' || !event.id.trim()
        || !isEpisodeDate(event.date) || event.date < caseItem.start || event.date > episode.end
        || typeof event.label !== 'string' || !event.label.trim()
        || typeof event.summary !== 'string' || !event.summary.trim()
        || !isHttps(event.url) || !evidenceExists(event.evidenceIds, caseItem)
        || !validStatus(event.knowledgeStatus)) return false;
    if (event.timeDisplay !== undefined && (typeof event.timeDisplay !== 'string' || !event.timeDisplay.trim())) return false;
    if (RETROSPECTIVE.has(event.knowledgeStatus)) {
      if (!isEpisodeDate(event.dateClaimed) || event.dateClaimed <= episode.end) return false;
    } else if (event.dateClaimed !== undefined) return false;
    if (event.claimForDate !== undefined && (typeof event.claimForDate !== 'string' || !event.claimForDate.trim())) return false;
  }
  if (!Array.isArray(episode.outletKnowledge)) return false;
  for (const knowledge of episode.outletKnowledge) {
    if (!knowledge || typeof knowledge.outlet !== 'string' || !knowledge.outlet.trim()
        || typeof knowledge.scope !== 'string' || !knowledge.scope.trim()
        || typeof knowledge.limit !== 'string' || !knowledge.limit.trim()
        || !isHttps(knowledge.sourceURL) || !evidenceExists(knowledge.evidenceIds, caseItem)
        || !validStatus(knowledge.knowledgeStatus)) return false;
    if (RETROSPECTIVE.has(knowledge.knowledgeStatus)) {
      if (!isEpisodeDate(knowledge.dateClaimed) || knowledge.dateClaimed <= episode.end) return false;
    } else if (knowledge.dateClaimed !== undefined) return false;
  }
  return true;
}

export function validLevesonContext(value, caseItem) {
  return !!value && !Array.isArray(value) && isEpisodeDate(value.reportDate)
    && ['direct_case_findings', 'ethical_comparison'].includes(value.relationship)
    && ['summary', 'sourceLocator', 'limit'].every(key => typeof value[key] === 'string' && value[key].trim())
    && isHttps(value.sourceURL) && evidenceExists(value.evidenceIds, caseItem)
    && Array.isArray(value.questions) && value.questions.length > 0
    && value.questions.every(question => typeof question === 'string' && question.trim());
}

function canonicalArticleId(record) {
  // An inquiry exhibit/source URL can host many reproduced headlines; without an
  // original publisher URL it is not a safe article identity, so retain the row ID.
  const url = record.format === 'print' || record.publicationFormat === 'print'
    ? null : (record.originalURL ?? record.canonicalArticleURL);
  if (!url) return record.id;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch { return record.id; }
}

/** Build counts only from selected, distinct case records; zero means no selected row that day. */
export function buildEpisodeTimeline(episode, caseItem) {
  if (!validEpisode(episode, caseItem)) throw new TypeError('Invalid episode evidence packet');
  const byId = new Map([...(caseItem.allHeadlines ?? []), ...(episode.additionalRecords ?? [])].map(row => [row.id, row]));
  const selected = episode.recordIds.map(id => byId.get(id));
  const distinct = new Map();
  for (const row of selected) {
    const key = canonicalArticleId(row);
    const existing = distinct.get(key);
    if (!existing || row.date < existing.date) distinct.set(key, row);
  }
  const records = [...distinct.values()];
  const outletNames = [...new Set([
    ...records.map(row => row.outlet),
    ...episode.outletKnowledge.map(item => item.outlet)
  ])].sort((a, b) => a.localeCompare(b));
  const dates = [];
  const cumulative = new Map(outletNames.map(outlet => [outlet, 0]));
  for (let cursor = Date.parse(`${episode.start}T00:00:00Z`), end = Date.parse(`${episode.end}T00:00:00Z`); cursor <= end; cursor += 86400000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const daily = outletNames.map(outlet => {
      const rows = records.filter(row => row.date === date && row.outlet === outlet);
      const count = rows.length;
      cumulative.set(outlet, cumulative.get(outlet) + count);
      return {outlet, count, cumulativeCount: cumulative.get(outlet), recordIds: rows.map(row => row.id)};
    });
    dates.push({date, outlets: daily});
  }
  const outlets = outletNames.map(outlet => {
    const rows = records.filter(row => row.outlet === outlet);
    return {outlet, count: rows.length, recordIds: rows.map(row => row.id), playable: rows.length > 0};
  });
  return {episodeId: episode.id, dates, outlets, distinctRecordCount: records.length,
    measureNote: 'Counts represent distinct selected records with dates in this episode; a zero is no selected row, not evidence of no coverage.'};
}
