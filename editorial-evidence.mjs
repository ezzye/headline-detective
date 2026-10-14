const EDITORIAL_TYPES = new Set(['institutional_editorial', 'bylined_opinion', 'owner_statement']);
const CONTENT_BASES = new Set(['publisher_page', 'publisher_index_extract', 'contemporaneous_report']);

const isIsoDate = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validEditorialRecord(record, caseItem) {
  if (!record || !caseItem || typeof record !== 'object' || Array.isArray(record)) return false;
  if (typeof record.id !== 'string' || !/^editorial-[a-z0-9][a-z0-9-]*$/i.test(record.id)) return false;
  if (record.caseId !== caseItem.id || typeof record.outlet !== 'string' || !record.outlet.trim()) return false;
  if (typeof record.title !== 'string' || !record.title.trim() || record.title.length > 180) return false;
  if (!isIsoDate(record.date) || !['in_window', 'aftermath'].includes(record.phase)) return false;
  if (record.phase === 'in_window' && (record.date < caseItem.start || record.date > caseItem.end)) return false;
  if (record.phase === 'aftermath' && record.date <= caseItem.end) return false;
  if (!EDITORIAL_TYPES.has(record.editorialType)) return false;
  if (record.editorialType === 'institutional_editorial' ? record.byline !== null : record.byline !== null && (typeof record.byline !== 'string' || !record.byline.trim())) return false;
  if (!['label', 'summary', 'sourceBasis', 'limit'].every(key => typeof record[key] === 'string' && record[key].trim())) return false;
  if (record.summary.length > 1200 || record.limit.length > 800 || record.sourceBasis.length > 600 || record.label.length > 160) return false;
  if (!CONTENT_BASES.has(record.contentBasis) || !isIsoDate(record.verifiedAt)) return false;
  try { if (new URL(record.url).protocol !== 'https:') return false; } catch { return false; }
  if (record.linkedWrittenRecordId !== null && (typeof record.linkedWrittenRecordId !== 'string'
      || !caseItem.allHeadlines?.some(row => row.id === record.linkedWrittenRecordId))) return false;
  if (!Array.isArray(record.evidenceIds) || !record.evidenceIds.length
      || new Set(record.evidenceIds).size !== record.evidenceIds.length
      || !record.evidenceIds.every(id => caseItem.evidence?.some(e => e.id === id))) return false;
  return true;
}

export function summarizeEditorials(records = []) {
  const unique = [...new Map(records.map(record => [record.id, record])).values()];
  return {
    recordCount: unique.length,
    inWindowCount: unique.filter(record => record.phase === 'in_window').length,
    aftermathCount: unique.filter(record => record.phase === 'aftermath').length,
    institutionalEditorialCount: unique.filter(record => record.editorialType === 'institutional_editorial').length,
    bylinedOpinionCount: unique.filter(record => record.editorialType === 'bylined_opinion').length,
    ownerStatementCount: unique.filter(record => record.editorialType === 'owner_statement').length,
    linkedWrittenRecordCount: new Set(unique.map(record => record.linkedWrittenRecordId).filter(Boolean)).size
  };
}
