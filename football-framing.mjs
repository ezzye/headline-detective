const SUBJECTS = new Set(['sterling', 'greenwood', 'foden', 'diallo']);
const LANGUAGES = new Set(['en', 'it', 'hr', 'pt']);
const FORMATS = new Set(['article', 'opinion', 'official', 'liveblog']);
const STATUSES = new Set(['publisher_verified', 'reported_date_only']);
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && !!x.trim();
const unique = xs => Array.isArray(xs) && new Set(xs).size === xs.length;
const isoDate = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && !Number.isNaN(Date.parse(`${x}T00:00:00Z`))
  && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
const httpsOrNull = x => x === null || (typeof x === 'string' && (() => { try { return new URL(x).protocol === 'https:'; } catch { return false; } })());
function canonicalUrl(value) {
  if (!value) return null;
  let u = new URL(value);
  // Wayback captures are copies of the archived publisher URL, not distinct articles.
  if (/(^|\.)web\.archive\.org$/i.test(u.hostname)) {
    const archived = u.pathname.match(/^\/web\/\d{1,14}[a-z_]*\/(https?:\/\/.*)$/i)?.[1];
    if (archived) { try { u = new URL(archived); } catch { /* retain the wrapper identity */ } }
  }
  u.hash = ''; u.search = '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.href;
}
const inRange = (date, start, end) => date >= start && date <= end;
function allUniqueIds(groups) {
  const ids = groups.flat();
  return ids.every(nonempty) && new Set(ids).size === ids.length;
}

/** Strict structural checks for the bounded football framing corpus. */
export function validFootballCorpus(corpus) {
  if (!isObject(corpus) || corpus.schemaVersion !== 1 || !isoDate(corpus.asOf) || !nonempty(corpus.scopeNote)
    || !Array.isArray(corpus.records) || !Array.isArray(corpus.events) || !Array.isArray(corpus.episodes) || !Array.isArray(corpus.comparisons)) return false;
  for (const r of corpus.records) {
    if (!isObject(r) || !nonempty(r.id) || !Array.isArray(r.subjectIds) || !r.subjectIds.length
      || !r.subjectIds.every(s => SUBJECTS.has(s)) || !nonempty(r.outlet) || !nonempty(r.headline)
      || !isoDate(r.date) || !FORMATS.has(r.format) || !httpsOrNull(r.url)
      || !STATUSES.has(r.sourceStatus) || !(r.eventId === null || nonempty(r.eventId))
      || !nonempty(r.framingNote) || !nonempty(r.limits) || !LANGUAGES.has(r.language) || typeof r.headlineIsExcerpt !== 'boolean'
      || (r.sourceStatus === 'publisher_verified' && !r.url)
      || (r.englishHeadlineTranslation != null && !nonempty(r.englishHeadlineTranslation))
      || (r.storyGroupId != null && !nonempty(r.storyGroupId))
      || (r.sourceCopyGroupNote != null && !nonempty(r.sourceCopyGroupNote))) return false;
  }
  for (const e of corpus.events) if (!isObject(e) || !nonempty(e.id) || !isoDate(e.date) || !nonempty(e.label)
    || !httpsOrNull(e.url) || !nonempty(e.summary)) return false;
  const eventIds = new Set(corpus.events.map(e => e.id));
  if (corpus.records.some(r => r.eventId !== null && !eventIds.has(r.eventId))) return false;
  for (const ep of corpus.episodes) {
    if (!isObject(ep) || !nonempty(ep.id) || !nonempty(ep.title) || !isoDate(ep.start) || !isoDate(ep.end)
      || ep.start > ep.end || ep.end > corpus.asOf || !nonempty(ep.scopeNote)
      || !Array.isArray(ep.recordIds) || !unique(ep.recordIds) || !Array.isArray(ep.eventIds) || !unique(ep.eventIds)) return false;
    const recById = new Map(corpus.records.map(r => [r.id, r]));
    if (!ep.recordIds.every(id => recById.has(id) && inRange(recById.get(id).date, ep.start, ep.end))) return false;
    const evById = new Map(corpus.events.map(e => [e.id, e]));
    if (!ep.eventIds.every(id => evById.has(id) && inRange(evById.get(id).date, ep.start, ep.end))) return false;
  }
  const recordIds = new Set(corpus.records.map(r => r.id));
  for (const c of corpus.comparisons) if (!isObject(c) || !nonempty(c.id) || !nonempty(c.title)
    || !Array.isArray(c.leftRecordIds) || !c.leftRecordIds.length || !unique(c.leftRecordIds)
    || !Array.isArray(c.rightRecordIds) || !c.rightRecordIds.length || !unique(c.rightRecordIds)
    || [...c.leftRecordIds, ...c.rightRecordIds].some(id => !recordIds.has(id))
    || !nonempty(c.sharedAct) || !nonempty(c.contextDifferences) || !Array.isArray(c.questions)
    || !c.questions.length || !c.questions.every(nonempty) || !nonempty(c.limit)) return false;
  if (!allUniqueIds([corpus.records.map(x => x.id), corpus.events.map(x => x.id), corpus.episodes.map(x => x.id), corpus.comparisons.map(x => x.id)])) return false;
  const urls = corpus.records.filter(r => r.url).map(r => canonicalUrl(r.url));
  return new Set(urls).size === urls.length;
}

function daysInclusive(start, end) {
  const out = [];
  for (let t = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`); t <= last; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
function selectedEpisode(corpus, episodeId) {
  if (!validFootballCorpus(corpus)) throw new TypeError('Invalid football framing corpus');
  const ep = corpus.episodes.find(x => x.id === episodeId);
  if (!ep) throw new RangeError(`Unknown football episode: ${episodeId}`);
  return ep;
}
function filtered(corpus, ep, { throughDate = ep.end, outlet, subject } = {}) {
  const end = isoDate(throughDate) ? (throughDate < ep.end ? throughDate : ep.end) : ep.end;
  if (end < ep.start) return { end, records: [], events: [] };
  let records = ep.recordIds.map(id => corpus.records.find(r => r.id === id)).filter(r => r.date <= end);
  if (outlet) records = records.filter(r => r.outlet === outlet);
  if (subject) records = records.filter(r => r.subjectIds.includes(subject));
  return { end, records, events: ep.eventIds.map(id => corpus.events.find(e => e.id === id)).filter(e => e.date <= end) };
}

/** Summarize recovered rows without treating search gaps as proof of non-publication. */
export function summarizeFootballEpisode(corpus, episodeId, options = {}) {
  const ep = selectedEpisode(corpus, episodeId);
  const { end, records, events } = filtered(corpus, ep, options || {});
  const verified = records.filter(r => r.sourceStatus === 'publisher_verified');
  const written = verified.filter(r => r.format === 'article' || r.format === 'liveblog');
  const opinions = verified.filter(r => r.format === 'opinion');
  const officials = verified.filter(r => r.format === 'official');
  const eventIdsByDate = new Map();
  for (const e of events) eventIdsByDate.set(e.date, [...(eventIdsByDate.get(e.date) || []), e.id]);
  let cumulative = 0;
  const dates = daysInclusive(ep.start, end).map(date => {
    const count = written.filter(r => r.date === date).length; cumulative += count;
    return { date, count, cumulative, eventIds: eventIdsByDate.get(date) || [],
      note: count === 0 ? 'No recovered verified written-article row for this date; this does not establish that no article was published.' : null };
  });
  const outlets = [...new Set(records.map(r => r.outlet))].sort((a, b) => a.localeCompare(b));
  const byOutlet = Object.fromEntries(outlets.map(name => { const rows = records.filter(r => r.outlet === name); return [name, {
    totalVerifiedWritten: rows.filter(r => r.sourceStatus === 'publisher_verified' && ['article', 'liveblog'].includes(r.format)).length,
    newsCount: rows.filter(r => r.sourceStatus === 'publisher_verified' && ['article', 'liveblog'].includes(r.format)).length,
    opinionCount: rows.filter(r => r.sourceStatus === 'publisher_verified' && r.format === 'opinion').length,
    officialCount: rows.filter(r => r.sourceStatus === 'publisher_verified' && r.format === 'official').length,
    excludedCount: rows.filter(r => r.sourceStatus !== 'publisher_verified').length,
  }]; }));
  const groups = new Set(written.map(r => r.storyGroupId).filter(nonempty));
  const independentStoryGroups = groups.size;
  const copyNotes = [...new Set([corpus.sourceCopyGroupNote, ...records.map(r => r.sourceCopyGroupNote)].filter(nonempty))];
  return { totalVerifiedWritten: written.length, newsCount: written.length, opinionCount: opinions.length,
    newsPlacementCount: written.length, independentStoryGroups,
    storyGroupCountNote: 'Counts distinct explicitly assigned story groups; records without a group assignment are not assumed to be independent.',
    sourceCopyGroupNote: copyNotes.join(' '),
    officialCount: officials.length, excludedCount: records.filter(r => r.sourceStatus !== 'publisher_verified').length,
    dates, byOutlet, records: records.slice().sort((a, b) => a.date.localeCompare(b.date) || a.outlet.localeCompare(b.outlet) || a.id.localeCompare(b.id)),
    events: events.slice().sort((a, b) => a.date.localeCompare(b.date)), scopeNote: ep.scopeNote,
    start: ep.start, end, episodeId: ep.id, subject: options.subject || null, outlet: options.outlet || null,
    windowContext: `Observed recovered records dated ${ep.start} through ${end}; these counts are not a census and do not explain coverage volume.` };
}

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function chart(summary, ep, allEvents) {
  const axisDates = daysInclusive(ep.start, ep.end), byDate = new Map(summary.dates.map(d => [d.date, d]));
  const values = axisDates.map(date => byDate.get(date) || null), w = 640, h = 164, left = 34, right = 12, top = 18, bottom = 30;
  const iw = w - left - right, ih = h - top - bottom, max = Math.max(1, ...summary.dates.map(x => x.cumulative));
  const x = i => left + (axisDates.length < 2 ? iw / 2 : iw * i / (axisDates.length - 1));
  const y = n => top + ih - ih * n / max;
  const bars = values.map((d, i) => { if (!d) return ''; const bw = Math.max(2, Math.min(16, iw / Math.max(values.length, 1) * .55)); return `<rect x="${x(i) - bw / 2}" y="${y(d.cumulative)}" width="${bw}" height="${top + ih - y(d.cumulative)}" rx="2" fill="#b6eb45" opacity=".78"><title>${esc(d.date)}: ${d.count} recovered verified written record(s), cumulative ${d.cumulative}</title></rect>`; }).join('');
  const markers = allEvents.filter(e => inRange(e.date, ep.start, summary.end)).map(e => { const i = axisDates.indexOf(e.date); if (i < 0) return ''; return `<circle cx="${x(i)}" cy="${top + 5}" r="4" fill="#f1b74b" stroke="#111c2d" stroke-width="1"><title>Event: ${esc(e.label)} (${esc(e.date)})</title></circle>`; }).join('');
  const labels = [0, Math.floor((axisDates.length - 1) / 2), axisDates.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => `<text x="${x(i)}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === axisDates.length - 1 ? 'end' : 'middle'}" fill="#d3dce9" font-size="11">${esc(axisDates[i])}</text>`).join('');
  const points = values.map((d, i) => d ? `${x(i)},${y(d.cumulative)}` : null).filter(Boolean).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="football-chart-title football-chart-desc" preserveAspectRatio="none" style="display:block;width:100%;height:auto;min-width:0"><title id="football-chart-title">Recovered written reporting through the selected date</title><desc id="football-chart-desc">Cumulative publisher-verified article and liveblog records by day. Gold markers show dated events. Counts describe recovered records only.</desc><line x1="${left}" y1="${top + ih}" x2="${w - right}" y2="${top + ih}" stroke="#74849a"/>${bars}<polyline points="${points}" fill="none" stroke="#b6eb45" stroke-width="2"/>${markers}${labels}</svg>`;
}
function recordCard(r) {
  return `<article class="card football-record"><div class="football-meta">${esc(fmtDate(r.date))} · ${esc(r.outlet)} · <strong>${esc(r.format)}</strong> · <strong>${r.sourceStatus === 'publisher_verified' ? 'Publisher verified' : 'Reported date only — excluded from verified counts'}</strong></div><h4>${esc(r.headline)}${r.headlineIsExcerpt ? ' <span class="muted">(partial headline excerpt)</span>' : ''}</h4>${r.englishHeadlineTranslation ? `<p><strong>Our English translation:</strong> ${esc(r.englishHeadlineTranslation)}</p>` : ''}${r.url ? `<p><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open original source</a></p>` : '<p>Original URL not recovered.</p>'}<p>${esc(r.framingNote)}</p><small>${esc(r.limits)}</small></article>`;
}

/** Render a self-contained panel fragment; event handling belongs to the host page. */
export function renderFootballPanel(corpus, { episodeId, throughDate, comparisonId } = {}) {
  if (!validFootballCorpus(corpus)) throw new TypeError('Invalid football framing corpus');
  const ep = corpus.episodes.find(x => x.id === episodeId) || corpus.episodes[0];
  if (!ep) return '<section class="panel card"><p>No football framing episode is available.</p></section>';
  const summary = summarizeFootballEpisode(corpus, ep.id, { throughDate });
  const comparisons = corpus.comparisons;
  const comparison = comparisons.find(x => x.id === comparisonId);
  const episodesOptions = corpus.episodes.map(x => `<option value="${esc(x.id)}"${x.id === ep.id ? ' selected' : ''}>${esc(x.title)}</option>`).join('');
  const comparisonOptions = [`<option value="">Choose a comparison</option>`, ...comparisons.map(x => `<option value="${esc(x.id)}"${x.id === comparison?.id ? ' selected' : ''}>${esc(x.title)}</option>`)].join('');
  const events = ep.eventIds.map(id => corpus.events.find(e => e.id === id));
  const maxDate = summary.end;
  const dates = summary.dates.map(d => `<li><time datetime="${esc(d.date)}">${esc(fmtDate(d.date))}</time>: ${d.count} verified written record(s), ${d.cumulative} cumulative${d.note ? ` <span class="muted">${esc(d.note)}</span>` : ''}</li>`).join('');
  const records = summary.records.map(recordCard).join('') || '<p>No records match this selection. This is a recovery gap, not evidence of no publication.</p>';
  const visibleEvents = events.filter(e => e.date <= maxDate);
  const eventButtons = visibleEvents.map(e => `<button type="button" data-football-event-date="${esc(e.date)}">${esc(fmtDate(e.date))} · ${esc(e.label)}</button>`).join('');
  const eventList = visibleEvents.map(e => `<li><button type="button" data-football-event-date="${esc(e.date)}">${esc(fmtDate(e.date))} · ${esc(e.label)}</button> — ${esc(e.summary)}</li>`).join('');
  let compared = '';
  if (comparison) {
    const side = ids => ids.map(id => corpus.records.find(r => r.id === id)).map(r => `<div class="card"><div class="football-meta">${esc(fmtDate(r.date))} · ${esc(r.outlet)} · ${esc(r.format)} · ${esc(r.sourceStatus)}</div><h4>${esc(r.headline)}${r.headlineIsExcerpt ? ' <span class="muted">(partial headline excerpt)</span>' : ''}</h4>${r.englishHeadlineTranslation ? `<p><strong>Our English translation:</strong> ${esc(r.englishHeadlineTranslation)}</p>` : ''}<p>${esc(r.framingNote)}</p>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open original source</a>` : '<span>Original URL not recovered</span>'}</div>`).join('');
    compared = `<details class="football-comparison"><summary>${esc(comparison.title)} — open paired headlines and context</summary><p>Shared act: ${esc(comparison.sharedAct)}</p><p>Context differences: ${esc(comparison.contextDifferences)}</p><div class="football-pair"><div><h4>First account</h4>${side(comparison.leftRecordIds)}</div><div><h4>Second account</h4>${side(comparison.rightRecordIds)}</div></div><ul>${comparison.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul><p class="muted">${esc(comparison.limit)}</p></details>`;
  }
  const axisDates = daysInclusive(ep.start, ep.end), datesAttr = axisDates.join(',');
  const selectedIndex = Math.max(0, axisDates.indexOf(maxDate));
  const officialDates = summary.records.filter(r => r.sourceStatus === 'publisher_verified' && r.format === 'official')
    .map(r => `<li><time datetime="${esc(r.date)}">${esc(fmtDate(r.date))}</time> · ${esc(r.outlet)} · ${esc(r.headline)}</li>`).join('');
  const paCopies = new Map();
  for (const r of summary.records) if (r.storyGroupId && /^pa(?:$|[-_: ])|press-association/i.test(r.storyGroupId)) paCopies.set(r.storyGroupId, (paCopies.get(r.storyGroupId) || 0) + (r.sourceStatus === 'publisher_verified' && ['article', 'liveblog'].includes(r.format) ? 1 : 0));
  const paCopyWarning = [...paCopies.values()].some(n => n > 1) ? '<p class="football-copy-warning">PA wire Group: these are multiple publisher placements within a known story group, not multiple independent reports.</p>' : '';
  return `<section class="panel card football-panel" aria-labelledby="football-heading"><style>.football-panel{color:#eef3fa;background:#111c2d;border:1px solid #34445c;border-radius:14px;padding:clamp(14px,3vw,22px);min-width:0;overflow:hidden}.football-panel *{box-sizing:border-box}.football-panel h2,.football-panel h3,.football-panel h4{color:inherit;margin:.4em 0}.football-panel p,.football-panel li{line-height:1.5}.football-panel a{color:#c9ef71;overflow-wrap:anywhere}.football-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px;margin:14px 0}.football-controls label{display:grid;gap:6px}.football-controls select,.football-controls input,.football-controls button{font:inherit;color:#eef3fa;background:#19283d;border:1px solid #52647c;border-radius:8px;padding:10px;min-width:0;width:100%}.football-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.football-stat{background:#1b2a40;border-radius:9px;padding:12px;min-width:0}.football-stat strong{display:block;font-size:1.45rem;color:#c3ec67}.football-chart{width:100%;min-width:0}.football-days{padding-left:1.2em;max-height:220px;overflow:auto}.football-record{background:#19283d;border:1px solid #34445c;border-radius:10px;padding:12px;margin:10px 0;overflow-wrap:anywhere}.football-meta,.muted{color:#b5c2d2;font-size:.9em}.football-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.football-pair>div{min-width:0}.football-question{margin-top:14px}.football-question button{width:100%;padding:12px;border-radius:8px;font:inherit;background:#b6eb45;color:#142032;border:0;font-weight:700}.football-event-labels{display:flex;flex-wrap:wrap;gap:6px}.football-event-labels button,.football-events button{width:auto;padding:5px 8px;color:#f4cd78;background:#19283d;border:1px solid #665632;border-radius:7px}.football-copy-warning{padding:10px;border-left:3px solid #f1b74b;background:#302b20;border-radius:5px}@media(max-width:520px){.football-pair{grid-template-columns:1fr}.football-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.football-stat{padding:8px}.football-stat strong{font-size:1.15rem}}</style><h2 id="football-heading">Football reporting: framing and context</h2><p>${esc(summary.windowContext)}</p><div class="football-controls"><label>Episode<select data-football-episode>${episodesOptions}</select></label><label>Through date <input type="range" data-football-date min="0" max="${Math.max(0, axisDates.length - 1)}" value="${selectedIndex}" data-dates="${esc(datesAttr)}" aria-label="Choose the final date in this episode"></label><label>Compare accounts<select data-football-comparison>${comparisonOptions}</select></label></div><div class="football-stats"><div class="football-stat"><strong>${summary.newsPlacementCount}</strong>publisher-verified news/liveblog placements</div><div class="football-stat"><strong>${summary.opinionCount}</strong>publisher-verified opinion records</div><div class="football-stat"><strong>${summary.officialCount}</strong>publisher-verified official statements</div><div class="football-stat"><strong>${summary.excludedCount}</strong>reported-date-only leads excluded from verified counts</div></div>${officialDates ? `<div class="muted"><strong>Official statement dates:</strong><ul>${officialDates}</ul></div>` : ''}<p class="muted">${summary.newsPlacementCount} news placements; ${summary.independentStoryGroups} explicitly identified story groups. ${esc(summary.storyGroupCountNote)}</p>${summary.sourceCopyGroupNote ? `<p class="muted">${esc(summary.sourceCopyGroupNote)}</p>` : ''}${paCopyWarning}<div class="football-chart">${chart(summary, ep, events)}</div><div class="football-event-labels">${visibleEvents.slice(0, 3).map(e => `<button type="button" data-football-event-date="${esc(e.date)}">🟡 ${esc(e.label)} · ${esc(fmtDate(e.date))}</button>`).join('')}</div><p class="muted">Gold markers show dated events; the chart keeps the full episode timeline visible as you change the cutoff. Volume and event timing alone do not establish bias, pile-on or intent.</p><p>${esc(ep.scopeNote)}</p>${eventList ? `<details class="football-events"><summary>Event context (${visibleEvents.length})</summary><ul>${eventList}</ul></details>` : ''}<details><summary>Daily record totals (${summary.dates.length} dates)</summary><ol class="football-days">${dates}</ol></details><details><summary>Full record details (${summary.records.length} records)</summary>${records}</details>${compared}<div class="football-question"><button type="button" data-football-question data-episode-id="${esc(ep.id)}">Question the outlets about this window</button></div></section>`;
}
