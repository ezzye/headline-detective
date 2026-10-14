# Headline Detective · Pile-on Jury

An evidence-led game about whether sustained media attention serves the public interest or becomes disproportionate pressure. Six case bundles let players compare dated coverage, hear fictional outlet defences, ask questions and make their own judgments.

[Live game](https://codingforjustice.org.uk/) · [Setup and sharing](README.html) · [Verification status](verification.html) · [Attention guide](attention.html) · [Coverage audit](pileon-coverage-audit.html) · [Jefferies three-day guide](jefferies.html) · [Archive research](research.html)

## The six-step round

1. **Welcome** — choose a case and learn what its numbers count.
2. **Timeline** — replay the written coverage, contributing X posts, counter-speech, editorial positions and documented events on a shared date axis. Their counts remain separate.
3. **Scrutiny** — consider each outlet through the same six criteria: public value, context, framing, care, consistency and transparency. Prompts stay tied to supplied sources and state the record's limits.
4. **Hear** — listen to or read reviewed, first-person outlet defences and ask follow-up questions. These responses are educational role-play, not statements from the real publishers.
5. **Judge** — rate the coverage, give a verdict, suggest a proportionate count and answer five factual checks. Your judgment and suggested count are ungraded.
6. **Reveal** — see source identities, your preserved judgments and five evidence-check results worth two points each; 8/10 wins. The checks test the record's unit, scope, limits and event context.

Volume alone does not establish motive, discrimination or harm. A documented sharing link does not establish coordination, owner instruction or causation.

## Six case bundles

| Case | Retained written records | Window |
| --- | ---: | --- |
| Jason Arday | 90 | 24 July–14 August 2026; cutoff 15:12 BST |
| Caroline Flack | 32 | 12 December 2019–14 February 2020 |
| Raheem Sterling | 15 | 28 May–16 December 2018 |
| Meghan Markle | 10 | 6–23 February 2019 |
| Nicola Bulley | 17 | 8–22 February 2023 |
| Christopher Jefferies | 15 | 30 December 2010–28 November 2011 |

The fixed inventory contains **179 retained written records** and 22 playable outlet desks. Research depth is uneven: Arday accounts for 90 written records, while the five older cases contain 32, 15, 10, 17 and 15. These are recovered samples with different selection rules, not comparable censuses; sample size is not a severity score. Some retained context records are outside the playable desks; Jefferies' long window is not a claim of continuous coverage.

Arday's selected 90 records sit within the qualified NewsCord inventory of 229 distinct substantive written pieces across 15 outlets. The Flack round now uses a dated recovered sample. The separate Guardian analysis of 99 Sun print stories among 387 newspaper stories over 14 August 2019–14 February 2020 remains aggregate context; its mention rule and period differ from the recovered sample, and 99 does not mean 99 negative stories. No daily sequence is inferred from that aggregate.

`campaigns.json` is canonical; case bundles and the embedded game data mirror it. `research.html` documents source checks and recovery gaps. Publication, modification and archive capture times stay distinct. Comparators are outside subject counts.

## Follow the attention trail

The current cross-media supplement contains **23 records**, including **13 X posts**: ten contributing posts across five cases and three counter-speech records. The contributing examples include publisher promotions, a front-page preview, repeated allegations, a radio clip and renewed personal exposure. Their classification records circulation, not a verdict that every post was unjustified.

`spreadLinks` contains six verified promotion, preview, quote, reply or direct-link relationships. The replay shows those connections alongside headlines and seven editorial records. Unsigned leaders and bylined opinion keep different labels; the Flack aftermath is optional and marked. Two editorials already belong to the written inventory and are not counted again.

Original X timestamps, where available, support precise ordering. Present engagement counters retain the 14 October 2026 observation date and cannot reconstruct the original audience or a historical growth curve. Keyworth's unavailable live thread was recovered through a Wayback capture made at 22:55:17 UTC on 28 May 2018. It displays a 28 May publication date with an unknown timezone and a historical snapshot of 887 reposts and 911 likes. Capture time is not publication time.

See `attention.html`, `media-records.csv`, `spread-links.csv` and `editorial-records.csv` for sources and limits. `x-editorial.html` retains the earlier audit with an update notice. `crossmedia.html` describes the earlier broadcast pilot. Programme uploads are not automatically original airtimes; embedded formats and repeat broadcasts stay explicit. Public media players are links, with no autoplay or copying.

No qualifying contributing X post was recovered for Jefferies in this pass. Deleted originals, period-specific engagement sequences, complete repost networks and complete broadcast inventories remain gaps. The AI distinguishes a desk's own publications from external commentators and counter-speech; owner intent is not inferred from an editorial's existence.

## Coverage audit

[Open the standalone coverage audit](pileon-coverage-audit.html). It compares five bounded evidence bundles and separates verified article counts, opinions, date-only records and uncensused gaps. Its Jefferies recovery section confirms the 40-article aggregate but adds no independently verified article records.

## Jefferies three-day guide

[Open the standalone selected-print guide](jefferies.html). It follows eight selected articles across three dates, identifies four supplemental print records separately from the original sample, and distinguishes public event timing from later inquiry findings.

## Accountability after the coverage

Sixteen `accountabilityRecords` across all six cases distinguish announcements, review terms, institutional accounts, reported inquest conclusions, review findings and court judgments. Their dates and `phase` keep later knowledge separate from the original publication windows. Flack’s CPS statement was signed on 28 July 2020 but published on the website on 10 November 2025; the ITV inquest record is reporting, not the original Record of Inquest.

The Markle sequence distinguishes the May 2020 procedural strike-out from the 2021 privacy/copyright merits and remedy rulings. Jefferies includes specified contempt findings, Leveson’s examination of appearance and temperament judgments, and later judicial confirmation of settlements and the police apology. The Mirror editor’s claim of off-record police briefings was disputed by the Chief Constable and unresolved by Leveson; neither secret incriminating information nor its absence is established by that dispute. Criticism of reckless publication does not prove malice. The Bulley review concerns police disclosure; the recovered Ofcom document is a procedural status, not an upheld broadcast breach. Arday’s investigation announcement and welfare terms remain distinct from completed findings, and Chelsea’s Sterling sanctions remain club decisions, not press judgments or criminal convictions.

`attention.html` presents the sources, what each supports and its limits. It also links the two-part ITV Jefferies drama and its production research, with dramatization clearly separated from evidence of real events. Later accountability can inform a retrospective judgment, but does not establish earlier editorial knowledge, the motives of owners, or the justification of every publication.

## Run it locally

Requires Node.js 22 or later. From this folder:

```sh
npm start
```

Then open <http://127.0.0.1:9027/>. No packages need installing. Without provider keys, reviewed outlet defences remain available as text; live questions and speech require provider access.

## Your own provider keys

People using the public GitHub code must supply their own DeepSeek and optional ElevenLabs accounts and keys. Each operator is responsible for provider usage and charges. Copy `.env.example` to a private `.env`, or keep settings in a separate file and start with `HEADLINE_DETECTIVE_ENV_FILE=/absolute/path/private.env npm start`. Private configuration is ignored; do not share it. The example contains placeholders. No provider keys or private configuration belong in the source repository.

The public hosted game uses a separate private server-side provider control layer. Visitors can support access by donating an accepted prepaid API key under the project's consent and usage settings; the donation guide describes provider setup. Do not paste credentials into client-side code or public issues.

## Sharing and checks

Share standalone HTML files for offline review, or share the public source repository. Guides have Save HTML and Share file controls; if native sharing is unavailable, download the HTML and attach it. Source pages and live AI need internet; browser and physical-device verification are distinct from automated checks.

Check `verification.html` and current release records before claiming deployment or full verification. Owner acceptance remains separate. The original comparison prototype is archived as `comparison.html`; it is not one of the current campaign rounds.

The Jefferies recovery audit now includes two full Mail Online pages preserved by Wayback, five dated front-cover references, and eight selected Leveson print packages. These evidence sets are separate: no new page has been individually mapped to the reported 40 settled articles. Publisher-displayed dates are distinct from capture dates; web pages are not automatically additional print articles.
