const ACCOUNTABILITY_STATUSES = new Set(['announcement','review_terms','institutional_account','reported_finding','judgment','remedy_order','procedural_status','review_finding','judicial_background']);
export function validAccountabilityRecord(record, item) {
  const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  return !!record && typeof record.id === 'string' && record.id.startsWith('account-') && iso(record.date)
    && (record.publicationDate == null || iso(record.publicationDate))
    && ['decision_date','statement_date','publication_date','meeting_date','report_date'].includes(record.dateBasis)
    && ACCOUNTABILITY_STATUSES.has(record.status)
    && ['title','institution','summary','limit'].every(key => typeof record[key] === 'string' && record[key].trim())
    && typeof record.url === 'string' && /^https:\/\//.test(record.url)
    && record.phase === (record.date > item.end ? 'retrospective' : 'within_window')
    && Array.isArray(record.evidenceIds) && record.evidenceIds.length > 0
    && record.evidenceIds.every(id => (item.evidence || []).some(e => e.id === id));
}
