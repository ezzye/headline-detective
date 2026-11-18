const topics = [
  ['immigration', 'Immigration'],
  ['reform', 'Reform UK']
];
const sections = [
  ['lead', 'Main news'],
  ['featured', 'Featured'],
  ['video', 'Video']
];
const outletIds = ['bbc', 'itv', 'channel4'];
const gapReasons = {
  missing: 'No archived run',
  failed: 'Capture failed',
  partialLayout: 'Incomplete page layout evidence',
  partialViewport: 'Desktop viewport could not be verified',
  partialVisibility: 'Incomplete evidence of which cards were visible'
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const formatCount = new Intl.NumberFormat('en-GB');
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const slotFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'Europe/London'
});

function dateLabel(date) {
  const value = Date.parse(String(date).slice(0, 10) + 'T12:00:00Z');
  return Number.isFinite(value) ? dateFormat.format(value) : 'Date unavailable';
}

function countLabel(value) {
  return Number.isInteger(value) ? formatCount.format(value) : 'Unknown';
}

function rangeLabel(range) {
  if (!Number.isInteger(range?.min) || !Number.isInteger(range?.max)) return 'Unknown';
  const min = countLabel(range.min);
  return range.min === range.max ? min : `${min}–${countLabel(range.max)}`;
}

function topicRows(outlets, topic) {
  return outletIds.map(id => {
    const outlet = outlets[id];
    const observations = outlet.topics[topic];
    return `<tr><th scope="row">${escapeHtml(outlet.name)}</th><td>${rangeLabel(observations.all)}</td><td>${rangeLabel(observations.firstScreen)}</td></tr>`;
  }).join('');
}

function sectionTables(outlets, topic) {
  return outletIds.map(id => {
    const outlet = outlets[id];
    const observations = outlet.topics[topic].sections;
    const rows = sections.map(([key, section]) => {
      const placement = observations[key];
      const observed = outlet.sectionObservations?.[key];
      if (observed === 0) return `<tr><th scope="row">${section}</th><td colspan="2">Section absent from the archive</td></tr>`;
      const coverage = observed < outlet.observations ? `<small>${countLabel(observed)} of ${countLabel(outlet.observations)} checks</small>` : '';
      return `<tr><th scope="row">${section}${coverage}</th><td>${rangeLabel(placement?.all)}</td><td>${rangeLabel(placement?.firstScreen)}</td></tr>`;
    }).join('');
    return `<table class="since-table"><caption>${escapeHtml(outlet.name)}</caption><thead><tr><th scope="col">Section</th><th scope="col">Anywhere in section</th><th scope="col">On first screen</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
}

function topicPanel(outlets, [id, label]) {
  return `<article class="panel since-topic" aria-labelledby="since-${id}-title">
    <h3 id="since-${id}-title">${label}</h3>
    <table class="since-table" aria-labelledby="since-${id}-title">
      <thead><tr><th scope="col">Outlet</th><th scope="col">Any sampled section</th><th scope="col">On first screen</th></tr></thead>
      <tbody>${topicRows(outlets, id)}</tbody>
    </table>
    <details><summary>${label} by homepage section</summary><p class="quiet">The same check can count in more than one section.</p><div class="since-sections">${sectionTables(outlets, id)}</div></details>
  </article>`;
}

function gapsDetail(gaps, outlets) {
  if (!gaps.length) return '';
  const items = gaps.map(({ slot, reason, outlets: affected }) => {
    const timestamp = Date.parse(slot);
    const label = Number.isFinite(timestamp) ? slotFormat.format(timestamp) : slot;
    const names = (affected ?? []).map(id => outlets[id]?.name).filter(Boolean).join(', ');
    return `<li><time datetime="${escapeHtml(slot)}">${escapeHtml(label)}</time> · ${escapeHtml(gapReasons[reason] ?? reason)}${names ? ` (${escapeHtml(names)})` : ''}</li>`;
  }).join('');
  return `<details class="panel since-detail"><summary>Which scheduled checks are missing or unusable?</summary>
    <p class="quiet">Times are UK local time. Outlets in parentheses are the ones affected by the recorded problem. Each gap excludes the whole check from the three-outlet comparison.</p><ul class="since-gaps">${items}</ul>
  </details>`;
}

export function renderSinceOctober(report) {
  if (!report) return '';
  const { coverage, outlets, methodology, recurringFeatured } = report;
  const {
    startDate, endDate, firstMatched, lastMatched, scheduledSlots, matchedSlots,
    missingSlots, excludedSlots, partialSlots, failedSlots, unscheduledRuns, gaps
  } = coverage;
  const scheduledTimes = coverage.scheduledTimes.map(escapeHtml).join(', ');
  const asOf = Date.parse(coverage.asOf);
  return `<section id="since-16-october" class="since-archive" aria-labelledby="since-title" tabindex="-1">
    <div class="section-head"><div><h2 id="since-title">Since 16 October</h2><p>${dateLabel(startDate)} to ${dateLabel(endDate)}</p></div></div>
    <p class="lede">After the weekly study ended, we began checking the three homepages four times a day. These figures show how often each topic appeared. Judging whether coverage was negative requires a separate review of the wording.</p>
    <div class="since-numbers">
      <div class="metric"><strong>${countLabel(matchedSlots)} of ${countLabel(scheduledSlots)}</strong><span>scheduled checks matched across all three homepages</span></div>
      <div class="metric"><strong>${countLabel(missingSlots)}</strong><span>scheduled checks with no archived run</span></div>
      <div class="metric"><strong>${countLabel(excludedSlots)}</strong><span>excluded scheduled checks · ${countLabel(partialSlots)} partial, ${countLabel(failedSlots)} failed</span></div>
    </div>
    <p class="quiet">Coverage remains unknown for missed and excluded checks.</p>
    <p><strong>Checks out of ${countLabel(matchedSlots)} per outlet.</strong> A check counts once per topic when at least one card qualifies. Ranges go from confirmed checks to the total if all plausible cases qualify.</p>
    <p class="quiet">“Any sampled section” includes recorded cards farther down the page. “On first screen” uses the initial desktop view. Immigration covers stories from any country.</p>
    <div class="since-topics">${topics.map(topic => topicPanel(outlets, topic)).join('')}</div>
    ${recurringFeatured ? `<p class="scope">${escapeHtml(recurringFeatured.outlet)} carried the same ${escapeHtml(recurringFeatured.title)} in Featured at ${countLabel(recurringFeatured.appearances)} matched checks. It was visible on the first screen at ${countLabel(recurringFeatured.firstScreenAppearances)} of those checks.</p>` : ''}
    <details class="panel since-detail since-subset"><summary>See UK-linked immigration only</summary>
      ${topicPanel(outlets, ['immigrationUK', 'UK-linked immigration'])}
    </details>
    ${gapsDetail(gaps, outlets)}
    <details class="panel since-detail"><summary>How the archive counts were made</summary>
      <p>Checks were scheduled for ${scheduledTimes} UK time. Comparable checks span ${dateLabel(firstMatched)} to ${dateLabel(lastMatched)}.</p>
      ${Number.isFinite(asOf) ? `<p>Archive cut-off ${escapeHtml(slotFormat.format(asOf))} UK time.</p>` : ''}
      <p>${countLabel(unscheduledRuns)} extra archived runs took place outside the comparable schedule.</p>
      ${methodology.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
    </details>
    <div class="tools since-tools"><button type="button" id="save-since-data">Download archive counts (JSON)</button></div>
  </section>`;
}
