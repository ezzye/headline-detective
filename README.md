# Headline Detective · Pile-on Jury

An evidence-led game about whether sustained media attention serves the public interest or becomes disproportionate pressure. Seven case bundles let players compare dated coverage, hear fictional outlet defences, ask questions and make their own judgments.

[Live game](https://codingforjustice.org.uk/) · [Setup and sharing](README.html) · [Verification status](verification.html) · [Attention guide](attention.html) · [Coverage audit](coverage-audit.html) · [Jefferies three-day guide](jefferies.html) · [Archive research](research.html) · [Studies and case evidence](case-evidence.html)

## The six-step round

1. **Welcome** — choose a case and learn what its numbers count.
2. **Timeline** — replay the written coverage, contributing X posts, counter-speech, editorial positions and documented events on a shared date axis. Their counts remain separate.
3. **Scrutiny** — consider each outlet through the same six criteria: public value, context, framing, care, consistency and transparency. Prompts stay tied to supplied sources and state the record's limits.
4. **Hear** — listen to or read reviewed, first-person outlet defences and ask follow-up questions. These responses are educational role-play, not statements from the real publishers.
5. **Judge** — rate the coverage, give a verdict, suggest a proportionate count and answer five factual checks. Your judgment and suggested count are ungraded.
6. **Reveal** — see source identities, your preserved judgments and five evidence-check results worth two points each; 8/10 wins. The checks test the record's unit, scope, limits and event context.

Volume alone does not establish motive, discrimination or harm. A documented sharing link does not establish coordination, owner instruction or causation.

## Seven case bundles

| Case | Retained written records | Window |
| --- | ---: | --- |
| Jason Arday | 90 | 24 July–14 August 2026; cutoff 15:12 BST |
| Caroline Flack | 32 | 12 December 2019–14 February 2020 |
| Raheem Sterling | 15 | 28 May–16 December 2018 |
| Meghan Markle | 10 | 6–23 February 2019 |
| Nicola Bulley | 17 | 8–22 February 2023 |
| Christopher Jefferies | 15 | 30 December 2010–28 November 2011 |
| Mason Greenwood | 15 | 2 February–1 September 2023 |

The fixed inventory contains **194 retained written records** and 25 playable outlet desks. Research depth is uneven: Arday accounts for 90 written records, while the other six cases contain 32, 15, 10, 17, 15 and 15. These are recovered samples with different selection rules, not comparable censuses; sample size is not a severity score. Some retained context records are outside the playable desks; Jefferies' long window is not a claim of continuous coverage.

Arday's selected 90 records sit within the qualified NewsCord inventory of 229 distinct substantive written pieces across 15 outlets. The Flack round now uses a dated recovered sample. The separate Guardian analysis of 99 Sun print stories among 387 newspaper stories over 14 August 2019–14 February 2020 remains aggregate context; its mention rule and period differ from the recovered sample, and 99 does not mean 99 negative stories. No daily sequence is inferred from that aggregate.

`campaigns.json` is canonical; case bundles and the embedded game data mirror it. `research.html` documents source checks and recovery gaps. Publication, modification and archive capture times stay distinct. Comparators are outside subject counts.

## Follow the attention trail

The current cross-media supplement contains **23 records**, including **13 X posts**: ten contributing posts across five cases and three counter-speech records. The contributing examples include publisher promotions, a front-page preview, repeated allegations, a radio clip and renewed personal exposure. Their classification records circulation, not a verdict that every post was unjustified.

`spreadLinks` contains six verified promotion, preview, quote, reply or direct-link relationships. The replay shows those connections alongside headlines and eight editorial records. Unsigned leaders and bylined opinion keep different labels; the Flack aftermath is optional and marked. Three opinion or editorial pieces already belong to the written inventory and are not counted again.

Original X timestamps, where available, support precise ordering. Present engagement counters retain the 14 October 2026 observation date and cannot reconstruct the original audience or a historical growth curve. Keyworth's unavailable live thread was recovered through a Wayback capture made at 22:55:17 UTC on 28 May 2018. It displays a 28 May publication date with an unknown timezone and a historical snapshot of 887 reposts and 911 likes. Capture time is not publication time.

See `attention.html`, `media-records.csv`, `spread-links.csv` and `editorial-records.csv` for sources and limits. `x-editorial.html` retains the earlier audit with an update notice. `crossmedia.html` describes the earlier broadcast pilot. Programme uploads are not automatically original airtimes; embedded formats and repeat broadcasts stay explicit. Public media players are links, with no autoplay or copying.

No qualifying contributing X post was recovered for Jefferies in this pass. Deleted originals, period-specific engagement sequences, complete repost networks and complete broadcast inventories remain gaps. The AI distinguishes a desk's own publications from external commentators and counter-speech; owner intent is not inferred from an editorial's existence.

## Coverage audit

[Open the standalone coverage audit](coverage-audit.html). It compares six bounded evidence bundles and separates verified article counts, opinions, date-only records and uncensused gaps. Its Jefferies recovery section confirms the 40-article aggregate but adds two recovered Mail webpages whose membership of the settlement set is unverified.

## Jefferies three-day guide

[Open the standalone selected-print guide](jefferies.html). It follows eight selected articles across three dates, identifies four supplemental print records separately from the original sample, and distinguishes public event timing from later inquiry findings.

## Accountability after the coverage

Eighteen `accountabilityRecords` across all seven cases distinguish announcements, review terms, institutional accounts, reported inquest conclusions, review findings and court judgments. Their dates and `phase` keep later knowledge separate from the original publication windows. Flack’s CPS statement was signed on 28 July 2020 but published on the website on 10 November 2025; the ITV inquest record is reporting, not the original Record of Inquest.

The Markle sequence distinguishes the May 2020 procedural strike-out from the 2021 privacy/copyright merits and remedy rulings. Jefferies includes specified contempt findings, Leveson’s examination of appearance and temperament judgments, and later judicial confirmation of settlements and the police apology. The Mirror editor’s claim of off-record police briefings was disputed by the Chief Constable and unresolved by Leveson; neither secret incriminating information nor its absence is established by that dispute. Criticism of reckless publication does not prove malice. The Bulley review concerns police disclosure; the recovered Ofcom document is a procedural status, not an upheld broadcast breach. Arday’s investigation announcement and welfare terms remain distinct from completed findings, and Chelsea’s Sterling sanctions remain club decisions, not press judgments or criminal convictions.

`attention.html` presents the sources, what each supports and its limits. It also links the two-part ITV Jefferies drama and its production research, with dramatization clearly separated from evidence of real events. Later accountability can inform a retrospective judgment, but does not establish earlier editorial knowledge, the motives of owners, or the justification of every publication.

## Run it locally

Requires Node.js 22 or later. From this folder:

```sh
npm start
```

Then open <http://127.0.0.1:9027/>. No packages need installing. Without provider keys, reviewed outlet defences remain available as text. The prepared challenge host recordings work locally without keys; new AI answers and newly generated outlet speech require your own provider access.

## Your own provider keys

People using the public GitHub code must supply their own DeepSeek and optional ElevenLabs accounts and keys. Each operator is responsible for provider usage and charges. Copy `.env.example` to a private `.env`, or keep settings in a separate file and start with `HEADLINE_DETECTIVE_ENV_FILE=/absolute/path/private.env npm start`. Private configuration is ignored; do not share it. The example contains placeholders. No provider keys or private configuration belong in the source repository.

The public hosted game uses a separate private server-side provider control layer. Visitors can support access by donating an accepted prepaid API key under the project's consent and usage settings; the donation guide describes provider setup. Do not paste credentials into client-side code or public issues.

## Prepared challenge host

Every question and reviewed explanation has a prepared ElevenLabs stock-actor recording. The 90 slots across nine cases reuse 60 distinct MP3s. Play, pause, resume and replay are player-controlled; nothing autoplays. The browser prepares the current question, its explanation and the next question from saved public files, with no provider calls. Lookahead is disabled for a reported data-saving or 2G connection. An animated speaker highlight respects reduced motion.

Recordings use a SHA-256 filename bound to the exact approved text, voice, model, direction and settings. A changed script fails closed rather than playing stale speech. The build verifies each audio file against its byte hash. Hashed files have immutable cache headers; a repeat listen needs no paid generation. The standalone HTML keeps written gameplay offline; the full voice bundle is available through the hosted or locally served repository.

The amber comparison factoid also has **Hear the comparison**. Sixteen prepared segments cover all54case/storypairings: a case-specific introduction, the selected story, and questions to bring back to the main case. Allthreeparts load from saved files before speech starts. Pause/resume preserves the part; replay reuses it; changing the case, story or period stops the old briefing. A readable transcript remains available, including offline. Comparison audio uses its own exact-text/settings manifest; it never draws from visitors’ or donors’ provider allowances. Maintainers can manually prepare it with `npm run prepare:comparison`, the server-side ElevenLabs settings and a private `CFJ_COMPARISON_PREPARATION_LEDGER` path; the separate plan is capped at16clips/12,000characters and requires verified prepaid-only allowance.

For maintainers, `npm run prepare:host -- --plan` previews the bounded preparation using `ELEVENLABS_HOST_VOICE_ID` (or the configured voice A). A manual generation also requires `ELEVENLABS_API_KEY` and `CFJ_HOST_PREPARATION_LEDGER` pointing outside the repository. It verifies a finite prepaid-only allowance, reuses exact matching recordings, and stops on a failed or uncertain paid request. Never put real keys in Git, command arguments or browser code. Visitors cannot trigger host generation. Existing donated-key limits and live outlet-response controls are unchanged.

## Sharing and checks

Share standalone HTML files for offline review, or share the public source repository. Guides have Save HTML and Share file controls; if native sharing is unavailable, download the HTML and attach it. Source pages and live AI need internet; browser and physical-device verification are distinct from automated checks.

Check `verification.html` and current release records before claiming deployment or full verification. Owner acceptance remains separate. The original comparison prototype is archived as `comparison.html`; it is not one of the current campaign rounds.

The Jefferies recovery audit now includes two full Mail Online pages preserved by Wayback, five dated front-cover references, and eight selected Leveson print packages. These evidence sets are separate: no new page has been individually mapped to the reported 40 settled articles. Publisher-displayed dates are distinct from capture dates; web pages are not automatically additional print articles.

Greenwood is a seventh playable campaign:15 verified written pieces across three outlet families,2February–1September2023. A separate, overlapping BBC audit records25 page IDs throughApril2026, with live, AV, gossip and audience formats labelled. Later De Zerbi comments and reactions are attributed context. Six event-led comparison bundles include Reform/Farage finance allegations; criticism alone is not treated as a documented pile-on. Neither the game nor its source inventory decides guilt, intent, racial causation or the fairness of every later mention.


The football extension adds two playable rounds (pre-2022 Greenwood and Diallo), giving nine cases with 209 retained written records across 33 desks. `football.html` provides nine bounded timelines and three framing comparisons. Its 58 observations include 15 existing Sterling rows and ten unverified leads; official notices, opinion, overseas context and shared PA copy remain separately labelled. Visitors may reveal outlets early or check individual evidence answers. Partial practice scores use answered questions only. The source and offline game include the answers; this is a teaching aid, not a controlled examination.

The short evidence challenge now presents one question at a time with immediate, source-bound feedback, accessible progress, explicit Next/Skip/Show controls and a completion screen. First answers lock for the round; showing or skipping remains unmarked. Motion is limited to question entry, answer feedback, progress and points, and respects the operating system and in-app reduced-motion preferences. It runs locally without paid provider calls.

### Automatic challenge host

After a visitor enters the game, the first short challenge plays a prepared welcome, then the current question. Selecting or showing an answer reads its explanation; Next question starts the next prepared question. The prominent Host on / Mute control stops current and pending narration for the rest of the visit, until turned on again. Play/pause controls remain available. Browsers that block sound show a Play host recovery button. No sound plays on page arrival.

The welcome and question/feedback clips are immutable public MP3s, cached by their script and voice identity. Visitor playback never invokes ElevenLabs generation. Changing approved scripts requires deliberate recording preparation; stale audio fails closed. Operators who clone the repository still provide their own API keys for AI replies and dynamic voices.

### Automatic owner top-up recovery

The private gateway rechecks owner funding when a provider is needed or the site health endpoint is checked, at most once per minute per provider. A valid provider response can reactivate a key stopped for unavailable funds. No balance check generates text or audio, purchases credit, or changes provider billing settings. An explicit paused or revoked owner state remains stopped.

ElevenLabs observations are persisted with the encrypted ledger. Only an increased reported allowance, or a verified later allowance period after the previous one ended, can add spendable characters; repeated stale usage reports cannot refund durable reservations. The first observation establishes a conservative baseline without raising a previously recorded entitlement. DeepSeek uses its verified prepaid availability flag, with no money-to-token conversion. Failed or malformed checks stay closed. Donor contribution caps and visitor budgets remain in force. The IAM-only refresh-owner-allowances maintenance action performs the same free checks; public health replies contain no balances or keys.


The `/agenda.html` activity examines topic-level news agendas: BBC, ITV and Channel 4 homepage observations around ITV’s October 2026 Reform reporting. `agenda-evidence.json` records the sources, sample boundaries and unknown historical comparison. The standalone page embeds the same evidence for offline sharing. Article publication counts are never treated as homepage prominence; the activity makes no finding of political bias.

### Matched weekly homepage comparison

[Explore the weekly comparison](weekly.html): 53 Thursdays, 16 October 2025–15 October 2026, targeting noon in London. The 159-row register contains 152 recovered/reviewed observations and seven archive gaps. Strict two-hour matching yields 32 three-outlet weeks; the separately labelled same-day sensitivity check yields 40. June–September have no strict matched weeks, so the strict totals cannot establish a full-year trend or the impact of recent investigations.

The main editorial pools differ: BBC shared lead plus visible UK grid, ITV Top Stories, Channel 4 main grid plus editorial Featured cards. Counts are dates with qualifying headline/deck framing, not article publication totals or proof of bias. Crime association, enforcement, harm/protection, Reform conduct, performance, routine politics and the literal word illegal are separate. Lower-page examples do not enter primary counts.

`weekly-evidence.json` includes timestamps, archive URLs, source hashes, reviewed booleans and gap reasons; `weekly-captures.csv` gives one row per planned observation. Public examples are selected paraphrases. Full retained HTML and review notes stay in the owner's working archive rather than republishing newspaper pages. `npm run prepare:weekly` regenerates the standalone page from its template and reviewed data. It makes no provider calls; Save HTML and Share file support offline file sharing.
