export const COMPARISON_HOST_VERSION = 'cfj-comparison-host-v1';

const rationales = {
  'arday-2026-campaign': 'Ask what new developments justified sustained scrutiny, and how attention was shared between the individual and institutions.',
  'caroline-flack-recovered-campaign': 'Ask how repeated personal exposure differed from reporting new public-interest developments.',
  'sterling-campaign': 'Ask how framing, wealth and personal choices became repeated news hooks, and what a fair comparison would require.',
  'markle-letter-campaign': 'Ask when public-interest scrutiny intrudes into private life, and what each new story added.',
  'bulley-campaign': 'Ask how an urgent search developed into repeated speculation and personal disclosure.',
  'jefferies-campaign': 'Ask what editors actually knew when suspicion turned into repeated judgments about a person’s character.',
  'greenwood-campaign': 'Keep discontinued criminal proceedings separate from the club’s employment decision. Ask what later developments justified renewed attention.',
  'greenwood-pre2022-campaign': 'Compare the shared conduct with Foden, then ask whether later headlines treated the two players differently.',
  'diallo-documents-campaign': 'Keep the sporting sanction distinct from unproven wider wrongdoing. Ask how framing amplified the story.'
};

const storyQuestions = {
  coverage_counterexample: 'What does this example show about whether scrutiny can occur, and what remains unknown about its overall volume?',
  institutional_delay: 'What does this record show about institutional handling, and what does it leave unknown about public reporting?',
  reported_comparator: 'What can the reports establish, and what further evidence would be needed to compare attention fairly?',
  documented_gap: 'What does the documented gap establish, and what evidence would be needed to explain why it occurred?'
};
const bundleKinds = {
  'comparison-andrew': 'coverage_counterexample',
  'comparison-archer': 'coverage_counterexample',
  'comparison-westwood': 'institutional_delay',
  'comparison-oreilly': 'reported_comparator',
  'comparison-cyril-smith': 'documented_gap',
  'comparison-farage': 'reported_comparator'
};

const clean = value => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Expected non-empty reviewed text');
  return value
    .replace(/\[[^\]\n]{1,100}\]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
};

function requireKnown(item, map, label) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !map[item.id]) {
    throw new TypeError(`Unknown or invalid ${label}`);
  }
}

export function comparisonIntro(caseItem) {
  requireKnown(caseItem, rationales, 'case');
  const title = clean(caseItem.title);
  return `You’re investigating ${title}. ${rationales[caseItem.id]} Now step into a separate comparison story. Its evidence sits outside your main timeline.`;
}

export function comparisonStory(bundle) {
  requireKnown(bundle, bundleKinds, 'comparison bundle');
  if (bundle.kind !== bundleKinds[bundle.id]) throw new TypeError('Unknown or invalid comparison kind');
  const title = clean(bundle.title);
  const summary = clean(bundle.summary).replace('proof that the university case received disproportionate coverage', 'proof that another case received disproportionate coverage').replace('IICSA recorded', 'The Independent Inquiry into Child Sexual Abuse recorded');
  return `${title}. ${summary} ${storyQuestions[bundle.kind]}`;
}

export function comparisonLimits() {
  return 'Use the selected comparison period and sources on the page to check the detail. These records stay outside your main timeline totals. A selected sample cannot measure all coverage or make different cases equivalent. Bring the question back to your case: what justified the attention, and what did repetition add?';
}

export function comparisonSegments(caseItem, bundle) {
  return [
    {id: caseItem?.id, kind: 'intro', text: comparisonIntro(caseItem)},
    {id: bundle?.id, kind: 'story', text: comparisonStory(bundle)},
    {id: 'comparison-limits', kind: 'limits', text: comparisonLimits()}
  ];
}
