export const WEEKLY_CHALLENGE = {
  version: '2026-10-16',
  intro: 'Let’s look carefully at what a year of headline snapshots can tell us. You can answer, reveal an answer, or skip any question. The aim is to notice what the evidence supports and where it runs out.',
  questions: [
    {
      id: 'matched-pattern',
      prompt: 'In the 32 strictly matched weeks, migration-topic cards appeared on 15 BBC dates, 11 ITV dates and 5 Channel 4 dates. Reform conduct scrutiny appeared on 1, 2 and 5 dates respectively. What is the fairest reading?',
      options: [
        { value: 'full-year', label: 'These figures describe the whole year and show each outlet’s overall political position.' },
        { value: 'sample-pattern', label: 'They describe different patterns in this matched sample; they do not establish a full-year trend or political position.' },
        { value: 'article-total', label: 'They are totals of all the individual stories published by each outlet.' }
      ],
      answer: 'sample-pattern',
      explanation: 'Each figure counts dates with at least one qualifying card, not stories. The strict pool has 32 matched weeks, not all 53 scheduled weeks. Channel 4’s primary pool includes its Featured sidebar; lower-page items are excluded. These counts describe this sample, not a full-year trend or an outlet’s political position.',
      evidence: 'Strict sample: 32 matched weeks. Migration topic: BBC 15, ITV 11, Channel 4 5 dates. Reform conduct: BBC 1, ITV 2, Channel 4 5 dates. Each is a count of dates with one or more qualifying cards.'
    },
    {
      id: 'gaps-and-window',
      prompt: 'Seven planned captures are missing. The strict comparison has 32 of 53 weeks; a broader same-day check has 40. What should you conclude about the missing weeks?',
      options: [
        { value: 'zero', label: 'Treat them as weeks with zero relevant stories.' },
        { value: 'same-result', label: 'Use the 40-week check as an equivalent replacement for the strict comparison.' },
        { value: 'unknown', label: 'Their contents are unknown; the broader check includes more captures but allows headlines to differ by capture time.' }
      ],
      answer: 'unknown',
      explanation: 'A missing capture cannot show that no relevant item appeared. The strict rule yields 32 matched weeks, not 53. The 40-week same-day check is broader and less comparable: all sources are from the same London date, but headlines may change between capture times.',
      evidence: 'Planned: 53 weeks and 159 captures. Seven observations have no recovered capture within 24 hours. Strict match: 32 weeks. Broader same-day check: 40 weeks.'
    },
    {
      id: 'topic-and-framing',
      prompt: 'A sampled headline concerns a migration-related crime allegation. What does the topic code establish by itself?',
      options: [
        { value: 'hostile', label: 'That the headline uses a hostile frame toward migrants.' },
        { value: 'group', label: 'That migrants as a group are responsible for crime.' },
        { value: 'topic', label: 'That this sampled card covered a migration and crime topic; its framing needs separate review.' }
      ],
      answer: 'topic',
      explanation: 'A topic code describes what a sampled card is about. It does not establish whether the headline is hostile, what evidence supports its claims, or whether an allegation is true. Those questions need a separate look at the wording and source material.',
      evidence: 'The coding separates migration topic, crime or alleged offending, enforcement, harm, and political scrutiny. One card can fit more than one topic; topic coding is not a framing verdict.'
    },
    {
      id: 'follow-up-window',
      prompt: 'ITV first published its investigation on 14 October 2026. The study ends on 15 October, the next scheduled observation. Is there enough evidence here to say the investigation changed later coverage?',
      options: [
        { value: 'yes', label: 'Yes. A next-day observation is enough to show a lasting change.' },
        { value: 'no', label: 'No. There are not yet later post-investigation weeks to compare.' },
        { value: 'summer', label: 'Yes. Coverage captured earlier in summer supplies the missing later weeks.' }
      ],
      answer: 'no',
      explanation: 'The study contains only the following day’s scheduled observation after publication, not later post-investigation weeks. Earlier summer observations cannot stand in for future weeks. We would need separately dated follow-up captures and a suitable comparison window before judging change.',
      evidence: 'Investigation first published: 14 October 2026. Study end: 15 October 2026. Only the following day’s scheduled observation is available; later post-investigation weeks are not.'
    }
  ],
  outro: 'You have reached the end. A careful conclusion can still matter even when it is limited. Keep the sample, the gaps and the wording in view, and stay open to new evidence.',
  reflectionQuestions: [
    'Am I comparing the same period and the same kind of sample?',
    'Am I separating a story’s topic from the way it frames people?',
    'What evidence would change my mind?',
    'What public-interest facts are present, and whose experience might these captures miss?'
  ]
};

export function weeklyVoiceClips() {
  const { intro, questions, outro } = WEEKLY_CHALLENGE;
  return [
    { id: 'intro', text: intro },
    ...questions.flatMap(question => [
      { id: `question-${question.id}`, text: `${question.prompt} ${question.options.map((option, i) => `Option ${i + 1}: ${option.label}`).join('. ')}` },
      { id: `feedback-${question.id}`, text: `The answer is: ${question.options.find(option => option.value === question.answer)?.label ?? ''} ${question.explanation}` }
    ]),
    { id: 'outro', text: `${outro} ${WEEKLY_CHALLENGE.reflectionQuestions.join(' ')}` }
  ];
}
