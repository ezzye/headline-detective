import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import campaigns from './campaigns.json' with { type: 'json' };
import { HOST_VOICE_VERSION, hostClipText } from './host-voice.mjs';

const root = new URL('./assets/host-audio/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const profile = manifest.profile;

test('manifest contains exactly the current deterministic question and feedback scripts', () => {
  assert.equal(manifest.version, HOST_VOICE_VERSION);
  assert.equal(profile.model, 'eleven_v3');
  assert.equal(profile.format, 'mp3_44100_64');
  assert.equal(manifest.clips.length, 90);
  const expected = campaigns.flatMap(campaign => campaign.reasoningChecks.flatMap((check, index, checks) => ['question', 'feedback'].map(part => ({
    caseId: campaign.id, questionId: check.id, part,
    text: hostClipText(check, index, checks.length, part)
  }))));
  const identity = rows => rows.map(({ caseId, questionId, part, text }) => `${caseId}\0${questionId}\0${part}\0${text}`).sort();
  assert.deepEqual(identity(manifest.clips), identity(expected));
  for (const clip of manifest.clips) {
    assert.equal(clip.digest, createHash('sha256').update(JSON.stringify([manifest.version, profile, clip.text])).digest('hex'));
    assert.equal(clip.src, `/assets/host-audio/${clip.digest}.mp3`);
  }
});

test('all referenced MP3 files match manifest byte lengths and hashes', async () => {
  const seen = new Set();
  for (const clip of manifest.clips) {
    if (seen.has(clip.src)) continue;
    seen.add(clip.src);
    const bytes = await readFile(new URL(`${clip.digest}.mp3`, root));
    assert.equal(bytes.length, clip.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.audioSha256);
  }
});
