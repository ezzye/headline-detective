# Headline Detective

A local media-literacy game with two distinct modes: the original article-comparison prototype, and a Jason Arday campaign round. The campaign round examines whole-outlet volume and pacing from 24 July to 14 August 2026; its final date ends at 15:12 BST.

[Setup and sharing](README.html) · [Verification status](verification.html) · [Game](index.html)

## Run it

Requires Node.js 22 or later. From this folder:

```sh
npm start
```

Then open <http://127.0.0.1:9027/>. No packages need installing. Without API keys, the reviewed outlet defences are available as text; live questions and speech require your own provider access.

## Your own provider keys

Live DeepSeek replies and optional ElevenLabs voices require your own provider accounts and keys; each user is responsible for their provider usage and charges. Copy `.env.example` to `.env` and add your private settings, or keep them in a separate file and start with `HEADLINE_DETECTIVE_ENV_FILE=/absolute/path/private.env npm start`. Never share the private file. The example file contains placeholders.

## The Arday campaign round

The four outlets represent BBC News (9 listed pieces), The Guardian (18), The Spectator (21) and The Telegraph (42): 90 listed pieces in total. They are selected from NewsCord’s fixed inventory of 229 items across 15 outlets. The inventory records distinct substantive written pieces; indexing gaps mean counts can be lower bounds. Passing mentions, broadcasts and video-only items are excluded.

Daily totals come from the dated rows in `campaign-records.csv`; that audit contains dates and URLs only. The round includes 10 selected headline examples, not the population used for counting. BBC and Telegraph examples are six-word excerpts because original publisher pages were unavailable to this build. Other example verification notes identify checked publisher pages and possible later headline edits.

Judge the campaign’s amount, pace, timing, and what documented developments could justify further coverage. You may suggest a count for what you consider proportionate. Neither your verdict nor suggested count is automatically graded. Five evidence checks are worth two points each; reach 8/10 to win. The game does not infer motive, intent, or harm from volume alone.

The original comparison prototype is archived separately as [`comparison.html`](comparison.html); it is not the campaign round.

## Sharing and checks

Share the HTML files themselves for private/offline review, or share the public source repository. This project does not publish a playable website. The setup and verification pages have Save HTML and Share file controls; if native file sharing is unavailable, download the HTML and attach it yourself.

Run `npm test` and `npm run check:secrets` before sharing. Tests should use fake providers and make no paid calls. Campaign browser, live-provider, and public-headline verification status is recorded in [verification.html](verification.html).

Each outlet now delivers a reviewed first-person newsreader script of roughly 230–265 words: the events, its coverage and its case for continuing. DeepSeek answers your challenges using the same sourced context. The voices represent fictional editors defending real campaigns; these are not statements made by the publishers. A qualified William O’Reilly comparison is included without treating a columnist’s rough coverage estimate as a matched inventory.
