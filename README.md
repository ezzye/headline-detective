# Headline Detective

A local newsreader game about how outlets cover public controversies. It has two campaign cases with different evidence shapes: a dated article inventory for Jason Arday and an aggregate print-coverage analysis for Caroline Flack. An older four-article comparison prototype remains archived separately.

[Setup and sharing](README.html) · [Verification status](verification.html) · [Game](index.html)

## The six-step round

1. **Welcome** — choose a case and learn what its numbers count.
2. **Timeline** — follow the documented events and the allegation’s status.
3. **Scrutiny** — consider each outlet through the same six criteria: public value, context, framing, care, consistency, and transparency. Prompts stay tied to the supplied sources and state what the record cannot establish.
4. **Hear** — listen to or read a reviewed, first-person editorial defence for the game. These scripts are role-play, not statements from the real publishers.
5. **Judge** — rate the coverage, give a verdict, suggest a proportionate count and answer five factual checks. Those judgments and suggested counts are ungraded.
6. **Reveal** — see the source identities, preserved judgments and five evidence-check results worth two points each; 8/10 wins. The checks test the record’s unit, scope, limits, and event context.

Volume alone does not establish motive, intent, discrimination, or harm. Questions that ask for unsupported dates, trends, or matching comparisons must stay unanswered by the evidence.

## The two campaign cases

### Jason Arday: dated written-article inventory

The 24 July–14 August 2026 window contains 22 calendar dates and ends at 15:12 BST on 14 August. The fixed NewsCord inventory lists 229 distinct substantive written pieces across 15 outlets. This round selects four outlets: BBC News (9), The Guardian (18), The Spectator (21), and The Telegraph (42), for 90 of those listed pieces. The inventory’s indexing coverage is qualified; totals may be lower bounds. It excludes passing mentions, broadcasts, and video-only items.

There are 11 selected headline examples. Three BBC examples were checked against primary BBC pages on 13 October 2026. Telegraph examples are six-word excerpts from the inventory because original pages were unavailable for this build. Examples illustrate the campaign; they are not the population used for the counts.

### Caroline Flack: aggregate print-coverage analysis

The Guardian reports 99 print stories in The Sun among 387 stories across UK national newspapers during 14 August 2019–14 February 2020, a 185-date window. The count includes stories with “Caroline Flack” in the headline or body. Three Guardian journalists classified tone; the article says its analysis is not definitive. It found mixed tone overall, so the 99 should not be treated as 99 negative stories.

This case has no daily counts, peak day, full outlet roster, or item-level inventory in the game. Its example is a reported Sun online Valentine-card story; whether that story appeared in print or belongs to the 99 is unknown. The Flack aggregate counts print stories under the Guardian’s stated mention rule; the Arday case counts distinct substantive written items from a selected inventory. Their methods are not directly comparable.

## Run it

Requires Node.js 22 or later. From this folder:

```sh
npm start
```

Then open <http://127.0.0.1:9027/>. No packages need installing. Without API keys, the reviewed outlet defences are available as text; live questions and speech require your own provider access.

## Your own provider keys

Live DeepSeek replies and optional ElevenLabs voices require your own provider accounts and keys; each user is responsible for their provider usage and charges. Copy `.env.example` to a private `.env` or keep your settings in a separate file and start with `HEADLINE_DETECTIVE_ENV_FILE=/absolute/path/private.env npm start`. The private config is local and ignored; do not share it. The example file contains placeholders. No provider keys or private configuration are included with the shared game.

## Sharing and checks

Share the HTML files themselves for private/offline review, or share the public source repository. This project does not publish a playable website. The setup and verification pages have Save HTML and Share file controls; if native file sharing is unavailable, download the HTML and attach it yourself.

The automated checks pass; owner acceptance remains unreviewed. Check [verification.html](verification.html) for the current status before describing the cases as fully verified.

The original comparison prototype is archived separately as [`comparison.html`](comparison.html); it is not one of the campaign cases.

## Archive evidence update · 14 October 2026

Six case bundles contain 179 retained dated records and 22 playable outlet desks. `research.html` describes the original/archived/official evidence and recovery gaps. Publication, modification and capture times remain distinct; comparator examples are outside subject counts. These are recovered samples, not comparable censuses. No paid provider requests were made for this revision.

## Cross-media pilot · 14 October 2026

`mediaRecords` adds ten observed audiovisual/social source records across four cases without changing179written records. Linked embedded formats, programme repeats, metadata-only verification, whole-programme duration and timestamped current counters are explicit. Original X/Facebook/Instagram/TikTok chains, complete linear-TV inventories and financing/coordination remain gaps. See `crossmedia.html` and `media-records.csv`. Public media players are links, with no autoplay or copying.

### Social posts and editorial positions

The timeline now includes a separate editorial audit and dated X/Twitter evidence. `editorialRecords` distinguishes unsigned institutional leaders, bylined opinion and public owner statements. `phase: aftermath` stays outside the selected window, while `linkedWrittenRecordId` prevents treating an already-counted article as another publication. Three social records document counter-speech, including one original post, its linked thread and a contemporary attributed response. Current counters retain observation dates and are not historical audience estimates. `x-editorial.html`, `editorial-records.csv` and `media-records.csv` carry source links and limits. AI packets keep selected-desk editorials separate from external criticism; no owner intent or coordination is inferred.
