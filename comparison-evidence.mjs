const KINDS = new Set(['documented_gap', 'institutional_delay', 'coverage_counterexample', 'reported_comparator']);
const VERDICTS = new Set(['documented_non_pickup', 'reporting_observed', 'unmeasured']);
const DATE_PRECISIONS = new Set(['day', 'month', 'year', 'unknown']);
const SOURCE_TYPES = new Set(['official', 'filed_document_copy', 'reported_institutional_response','original_reporting','reported_official_statement']);
const FORMATS = new Set(['article', 'liveblog', 'opinion', 'broadcast_transcript','editorial','analysis','video','liveblog_entry','investigation_package']);
const SOURCE_STATUSES = new Set(['publisher_verified', 'reported_date_only']);

function validDate(value, precision = 'day') {
  if (typeof value !== 'string') return false;
  if (precision === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }
  if (precision === 'month') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
    return true;
  }
  if (precision === 'year') return /^\d{4}$/.test(value);
  return false;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique(values) {
  return new Set(values).size === values.length;
}

function validHttps(value) {
  if (!nonEmpty(value)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function normalizedHostedUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

function validAnchor(anchor) {
  if (!anchor || !nonEmpty(anchor.label) || !nonEmpty(anchor.displayDate)
    || !DATE_PRECISIONS.has(anchor.datePrecision) || anchor.datePrecision === 'unknown') return false;
  const dates = ['eventDate', 'publicDate'].filter(key => anchor[key] != null);
  return dates.length > 0 && dates.every(key => validDate(anchor[key], anchor.datePrecision));
}

function validSource(source) {
  if (!source || !nonEmpty(source.id) || !nonEmpty(source.title) || !validHttps(source.url)
    || !nonEmpty(source.locator) || !nonEmpty(source.summary) || !SOURCE_TYPES.has(source.sourceType)
    || !DATE_PRECISIONS.has(source.datePrecision)) return false;
  if (source.datePrecision === 'unknown') return source.date == null;
  return validDate(source.date, source.datePrecision);
}

function validRecord(record) {
  return !!record && nonEmpty(record.id) && validDate(record.date, 'day')
    && nonEmpty(record.outlet) && nonEmpty(record.headline) && validHttps(record.url)
    && FORMATS.has(record.format) && SOURCE_STATUSES.has(record.sourceStatus)
    && Array.isArray(record.evidenceIds) && record.evidenceIds.length > 0
    && record.evidenceIds.every(nonEmpty);
}

function validWindow(window) {
  if (!window || !nonEmpty(window.id) || !validDate(window.start, 'day') || !validDate(window.end, 'day')
    || ![3, 7].includes(window.daysInclusive) || window.unit !== 'written_articles' || !nonEmpty(window.scopeNote)) return false;
  const days = (Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / 86400000 + 1;
  return days === window.daysInclusive;
}

/** Validate shape, evidence references, date precision, and window arithmetic. */
export function validComparisonBundle(bundle) {
  if (!bundle || !nonEmpty(bundle.id) || !nonEmpty(bundle.title) || !KINDS.has(bundle.kind)
    || !Array.isArray(bundle.relatedCaseIds) || !bundle.relatedCaseIds.length
    || !bundle.relatedCaseIds.every(nonEmpty) || !nonEmpty(bundle.summary) || !validAnchor(bundle.anchor)
    || !Array.isArray(bundle.officialSources) || !Array.isArray(bundle.records) || !Array.isArray(bundle.windows)
    || (!bundle.windows.length && !(bundle.kind === 'documented_gap' && bundle.anchor.datePrecision !== 'day')) || !VERDICTS.has(bundle.coverageVerdict) || bundle.census !== false
    || !Array.isArray(bundle.limits) || !bundle.limits.every(nonEmpty)
    || !Array.isArray(bundle.questions) || !bundle.questions.every(nonEmpty)) return false;

  if (!bundle.officialSources.every(validSource) || !bundle.records.every(validRecord) || !bundle.windows.every(validWindow)) return false;
  const ids = [bundle.id, ...bundle.officialSources.map(x => x.id), ...bundle.records.map(x => x.id), ...bundle.windows.map(x => x.id)];
  if (!unique(ids) || !unique(bundle.relatedCaseIds)) return false;

  const evidenceIds = new Set([...bundle.officialSources, ...bundle.records].map(x => x.id));
  if (!bundle.records.every(record => record.evidenceIds.every(id => evidenceIds.has(id)))) return false;

  // A non-pickup statement must be anchored in an official source, never a search gap.
  if (bundle.coverageVerdict === 'documented_non_pickup'
    && (bundle.kind !== 'documented_gap' || !bundle.officialSources.some(x => x.sourceType === 'official'))) return false;
  if (bundle.coverageVerdict === 'reporting_observed' && bundle.records.length === 0) return false;

  const recordUrls = bundle.records.map(record => normalizedHostedUrl(record.url));
  return recordUrls.every(Boolean);
}

function daysBetween(start, end) {
  const days = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  for (; cursor.valueOf() <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days;
}

/** Summarize recovered rows for one fixed inclusive window; never infer absence from zero rows. */
export function summarizeComparisonWindow(bundle, windowId) {
  if (!validComparisonBundle(bundle)) throw new TypeError('Invalid comparison bundle');
  const window = bundle.windows.find(item => item.id === windowId);
  if (!window) throw new RangeError(`Unknown comparison window: ${windowId}`);

  const inWindow = bundle.records.filter(record => record.date >= window.start && record.date <= window.end);
  const seen = new Set();
  const uniqueRecords = [];
  const duplicateRecordIds = [];
  for (const record of inWindow) {
    const key = normalizedHostedUrl(record.url);
    if (seen.has(key)) duplicateRecordIds.push(record.id);
    else { seen.add(key); uniqueRecords.push(record); }
  }

  const verified = uniqueRecords.filter(record => record.sourceStatus === 'publisher_verified');
  const countFormat = format => verified.filter(record => record.format === format).length;
  const perDay = new Map(daysBetween(window.start, window.end).map(date => [date, 0]));
  for (const record of verified) {
    if (record.format === 'article' || record.format === 'liveblog') {
      perDay.set(record.date, perDay.get(record.date) + 1);
    }
  }
  const days = [...perDay].map(([date, observedWrittenCount]) => ({
    date,
    observedWrittenCount,
    note: observedWrittenCount === 0
      ? 'No recovered written-article row for this date; this does not establish that no article was published.'
      : null,
  }));

  return {
    windowId: window.id,
    start: window.start,
    end: window.end,
    daysInclusive: window.daysInclusive,
    unit: window.unit,
    observedWrittenCount: countFormat('article') + countFormat('liveblog'),
    observedOpinionCount: countFormat('opinion'),
    observedEditorialCount:countFormat('editorial'),observedAnalysisCount:countFormat('analysis'),observedVideoCount:countFormat('video'),observedLiveblogEntryCount:countFormat('liveblog_entry'),observedInvestigationPackageCount:countFormat('investigation_package'),
    observedBroadcastCount: countFormat('broadcast_transcript'),
    reportedDateOnlyExcludedCount: uniqueRecords.filter(record => record.sourceStatus === 'reported_date_only').length,
    duplicateRecordIds,
    days,
    census: false,
    coverageCaveat: 'Observed recovered rows only; this count is not a complete census and does not establish non-publication or explain coverage volume.',
  };
}

