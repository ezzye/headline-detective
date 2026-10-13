# Headline Detective

A local, five-step media-literacy game using real headlines, DeepSeek analysis and optional ElevenLabs voices.

[Setup and sharing](README.html) · [Verification receipt](verification.html) · [Offline game](index.html)

Requires Node.js 22 or later. No packages to install. Run `npm start`, then open http://127.0.0.1:9027/.

**Bring your own API keys:** anyone downloading this repository must use their own DeepSeek and ElevenLabs accounts and keys for live AI and voices. Provider usage is billed to their own accounts. Without keys, the game offers labelled practice analysis and captions.

Provider keys stay in an ignored local `.env` or an external file selected with `HEADLINE_DETECTIVE_ENV_FILE`. Only placeholders are included. Enable the commit and push checks with `npm run setup:hooks`.

Run `npm test` and `npm run check:secrets` before sharing. Tests use fake providers and make no paid calls.

The cases are a research prototype with explicit sources and provisional curator verdicts. AI players are simulated analysts, not statements from the named publishers.
