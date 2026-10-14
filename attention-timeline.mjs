const ROLES = new Set(['outlet_promotion', 'allegation_amplification', 'speculation', 'personal_targeting', 'counter_speech', 'context']);
const RELATIONS = new Set(['promotes', 'links_to', 'quotes', 'reposts', 'reports_on', 'replies_to', 'previews']);

const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const addDay = value => new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const urlOkay = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const utcTime = record => record.publishedAtUTC || record.postPublishedAtUTC || record.createdAtUTC || record.timestampUTC || null;

function sourceDateBasis(record, type) {
  if (type === 'headline') return record.publicationDisplay || record.publishedAtUTC ? 'publisher publication date' : 'recorded publication date';
  if (type === 'editorial') return record.sourceBasis || record.contentBasis || 'editorial record date';
  if (type === 'social') return record.dateBasis || 'recorded social publication date';
  return record.dateBasis || 'dated case event';
}

/** Build an evidence-led, daily joint chronology without inferring a causal relationship. */
export function buildAttentionTimeline(caseItem, { includeAftermath = false } = {}) {
  if (!caseItem || !isDate(caseItem.start) || !isDate(caseItem.end) || caseItem.start > caseItem.end) throw new TypeError('caseItem needs valid start and end dates');
  const rows = [];
  for (const record of caseItem.allHeadlines || []) {
    const date = record.date || record.published;
    if (!isDate(date)) continue;
    rows.push({ id: record.id, type: 'headline', date, timeUTC: utcTime(record), title: record.headline || record.title || '', outlet: record.outlet || '', url: record.url || record.sourceURL || record.originalURL || null, role: 'written_report', dateBasis: sourceDateBasis(record, 'headline'), phase: date < caseItem.start || date > caseItem.end ? 'outside_window' : 'in_window', linkedWrittenRecordId: null, evidenceIds: record.evidenceIds || (record.evidenceId ? [record.evidenceId] : []) });
  }
  for (const record of caseItem.editorialRecords || []) {
    if (record.phase === 'aftermath' && !includeAftermath) continue;
    const date = record.date;
    if (!isDate(date)) continue;
    rows.push({ id: record.id, type: 'editorial', date, timeUTC: utcTime(record), title: record.title || record.label || '', outlet: record.outlet || '', url: record.url || null, role: record.editorialType || 'editorial', dateBasis: sourceDateBasis(record, 'editorial'), phase: record.phase || 'in_window', linkedWrittenRecordId: record.linkedWrittenRecordId || null, evidenceIds: record.evidenceIds || [] });
  }
  for (const record of caseItem.mediaRecords || []) {
    if (record.format !== 'social_post') continue;
    const date = record.date;
    if (!isDate(date)) continue;
    // Legacy counter-speech annotations remain legible; all other missing roles stay unclassified.
    const role = record.publicationRole || (record.publicationRelationship === 'counter_speech' ? 'counter_speech' : null);
    rows.push({ id: record.id, type: 'social', date, timeUTC: utcTime(record), title: record.title || record.summary || '', outlet: record.outlet || '', url: record.url || null, role, dateBasis: sourceDateBasis(record, 'social'), phase: date < caseItem.start || date > caseItem.end ? 'outside_window' : 'in_window', linkedWrittenRecordId: record.linkedWrittenRecordId || null, evidenceIds: record.evidenceIds || [] });
  }
  for (const [i, event] of (caseItem.events || []).entries()) {
    if (!isDate(event.date)) continue;
    rows.push({ id: event.id || event.evidenceId || `event-${i + 1}`, type: 'event', date: event.date, title: event.label || event.title || '', outlet: '', url: event.url || null, role: 'event', dateBasis: sourceDateBasis(event, 'event'), phase: event.date < caseItem.start || event.date > caseItem.end ? 'outside_window' : 'in_window', linkedWrittenRecordId: null, evidenceIds: event.evidenceId ? [event.evidenceId] : event.evidenceIds || [] });
  }
  const start = caseItem.start;
  const aftermathEnd = includeAftermath ? rows.filter(row => row.type === 'editorial' && row.phase === 'aftermath').reduce((max, row) => row.date > max ? row.date : max, caseItem.end) : caseItem.end;
  const maxAftermath = new Date(Date.parse(`${caseItem.end}T00:00:00Z`) + 730 * 86_400_000).toISOString().slice(0, 10);
  const end = aftermathEnd > maxAftermath ? maxAftermath : aftermathEnd;
  const visibleRows = rows.filter(row => row.date >= start && row.date <= end);
  const recordById = new Map(visibleRows.map(row => [row.id, row]));
  const links = (caseItem.spreadLinks || []).filter(link => recordById.has(link.fromId) && recordById.has(link.toId) && link.date >= start && link.date <= end).map(link => {
    const from = recordById.get(link.fromId), to = recordById.get(link.toId);
    const hasKnownTimes = [from, to].every(row => row.timeUTC);
    return { ...link, timingNote: from.date === to.date && !hasKnownTimes ? 'Both records share a calendar date; the evidence does not establish their order within that day.' : null };
  });
  const days = [];
  for (let date = start; date <= end; date = addDay(date)) {
    const dayRows = visibleRows.filter(row => row.date === date);
    // UTC publication instants are usable for ordering; same-day unknown-time rows use stable type/id order.
    dayRows.sort((a, b) => {
      const au = a.timeUTC, bu = b.timeUTC;
      if (au && bu && au !== bu) return au.localeCompare(bu);
      return a.type.localeCompare(b.type) || String(a.id).localeCompare(String(b.id));
    });
    const count = predicate => dayRows.filter(predicate).length;
    days.push({ date, writtenCount: count(row => row.type === 'headline'), editorialCount: count(row => row.type === 'editorial'), contributingCount: count(row => row.type === 'social' && ['outlet_promotion', 'allegation_amplification', 'speculation', 'personal_targeting'].includes(row.role)), counterSpeechCount: count(row => row.type === 'social' && row.role === 'counter_speech'), eventCount: count(row => row.type === 'event'), rows: dayRows });
  }
  const counts = {
    written: visibleRows.filter(row => row.type === 'headline').length,
    editorial: visibleRows.filter(row => row.type === 'editorial').length,
    contributing: visibleRows.filter(row => row.type === 'social' && ['outlet_promotion', 'allegation_amplification', 'speculation', 'personal_targeting'].includes(row.role)).length,
    counterSpeech: visibleRows.filter(row => row.type === 'social' && row.role === 'counter_speech').length,
    otherSocial: visibleRows.filter(row => row.type === 'social' && (row.role === 'context' || !row.role)).length,
    events: visibleRows.filter(row => row.type === 'event').length
  };
  return { start, end, days, rows: visibleRows, links, counts: { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) } };
}

/** Strict structural validation for optional, evidence-linked spread edges. */
export function validSpreadLink(link, caseItem) {
  if (!link || !caseItem || typeof link !== 'object' || Array.isArray(link)) return false;
  if (typeof link.id !== 'string' || !/^spread-[a-z0-9][a-z0-9-]*$/i.test(link.id)) return false;
  if (typeof link.fromId !== 'string' || typeof link.toId !== 'string' || link.fromId === link.toId || !RELATIONS.has(link.relation) || !isDate(link.date)) return false;
  if (!urlOkay(link.sourceURL) || typeof link.basis !== 'string' || !link.basis.trim() || typeof link.limit !== 'string' || !link.limit.trim()) return false;
  if (!Array.isArray(link.evidenceIds) || !link.evidenceIds.length || new Set(link.evidenceIds).size !== link.evidenceIds.length || !link.evidenceIds.every(id => caseItem.evidence?.some(item => item.id === id))) return false;
  const records = [...(caseItem.allHeadlines || []), ...(caseItem.editorialRecords || []), ...(caseItem.mediaRecords || []), ...(caseItem.events || []).map((record, i) => ({ ...record, id: record.id || record.evidenceId || `event-${i + 1}` }))];
  const from = records.find(record => record.id === link.fromId);
  const to = records.find(record => record.id === link.toId);
  if (!from || !to) return false;
  const dateOf = record => record.date || record.published;
  const fromDate = dateOf(from), toDate = dateOf(to);
  if (!isDate(fromDate) || !isDate(toDate) || link.date < fromDate || link.date < caseItem.start) return false;
  if (link.relation !== 'previews' && toDate > link.date) return false;
  if (link.date > caseItem.end && (to.phase !== 'aftermath' || link.date > new Date(Date.parse(`${caseItem.end}T00:00:00Z`) + 730 * 86_400_000).toISOString().slice(0, 10))) return false;
  return true;
}
