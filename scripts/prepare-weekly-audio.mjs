// Run manually with server-side credentials. Never called by visitors.
import { readFile, writeFile, mkdir, open, chmod, stat } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weeklyVoiceClips } from '../weekly-challenge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = 'cfj-weekly-host-v1';
const sha = value => createHash('sha256').update(value).digest('hex');
const voiceId = process.env.ELEVENLABS_HOST_VOICE_ID || process.env.ELEVENLABS_VOICE_A;
const profile = {
  voiceId: voiceId || null,
  model: 'eleven_v3',
  format: 'mp3_44100_64',
  voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
  direction: { question: '[curious]', feedback: '[thoughtful]', intro: '[warmly]', outro: '[thoughtful]', film: '[warmly]' }
};

function fail(message) { throw new Error(message); }
function validClips(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array of {id,text} records.`);
  return value.map((clip, i) => {
    if (!clip || typeof clip.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(clip.id) ||
        typeof clip.text !== 'string' || !clip.text.trim() || clip.text.length > 12000) {
      fail(`${label}[${i}] has an invalid id or text.`);
    }
    return { id: clip.id, text: clip.text };
  });
}

const args = process.argv.slice(2);
let film = [];
let filmSeen = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--film-input') {
    if (!args[i + 1] || filmSeen) fail('--film-input requires one JSON file path.');
    filmSeen = true;
    const inputPath = path.resolve(args[++i]);
    film = validClips(JSON.parse(await readFile(inputPath, 'utf8')), 'Film input');
  } else if (args[i] !== '--plan') fail(`Unknown argument: ${args[i]}`);
}
const weekly = validClips(weeklyVoiceClips(), 'Weekly challenge');
const weeklyIds = new Set(weekly.map(c => c.id));
const all = [...weekly, ...film];
if (new Set(all.map(c => c.id)).size !== all.length) fail('Clip IDs must be unique across weekly and film records.');
const kind = id => weeklyIds.has(id) ? id === 'intro' ? 'intro' : id === 'outro' ? 'outro' : /^(question|feedback)-/.exec(id)?.[1] || 'film' : 'film';
const records = all.map(c => {
  const direction = profile.direction[kind(c.id)];
  const spoken = `${direction} ${c.text}`;
  const digest = sha(JSON.stringify([VERSION, profile, spoken, c.text]));
  return { ...c, spoken, digest, src: `/assets/weekly-audio/${digest}.mp3` };
});
const characters = records.reduce((n, c) => n + c.spoken.length, 0);
if (records.length > 16 || characters > 12000) fail('Weekly audio exceeds the 16-call / 12,000-character preparation ceiling.');
const planOnly = args.includes('--plan');
if (planOnly) {
  console.log(JSON.stringify({ plannedClips: records.length, uniqueRecordings: records.length, characters, remainingCharacters: 12000 - characters, remainingCalls: 16 - records.length, paidCalls: 0, providerAccess: false, prepaidRemaining: 'not checked in plan mode' }));
  process.exit(0);
}
if (!voiceId) fail('Set a configured stock host voice ID in the server environment.');
const apiKey = process.env.ELEVENLABS_API_KEY;
const ledgerPath = process.env.CFJ_WEEKLY_PREPARATION_LEDGER;
if (!apiKey || !ledgerPath || !path.isAbsolute(ledgerPath) || path.resolve(ledgerPath).startsWith(ROOT + path.sep)) {
  fail('Private credentials and an absolute private preparation ledger outside the repository are required.');
}

const lockPath = `${ledgerPath}.lock`;
const lock = await open(lockPath, 'wx', 0o600);
await lock.close();
process.on('exit', () => { try { unlinkSync(lockPath); } catch {} });
const folder = path.join(ROOT, 'assets/weekly-audio');
await mkdir(folder, { recursive: true });
let ledger = { version: VERSION, profile, calls: 0, characters: 0, items: {} };
try {
  const info = await stat(ledgerPath);
  if ((info.mode & 0o077) !== 0) fail('The private ledger must have permissions 0600 or stricter.');
  ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  if (ledger.version !== VERSION || JSON.stringify(ledger.profile) !== JSON.stringify(profile)) fail('Weekly audio plan changed; review before starting a new bounded preparation.');
  if (!Number.isSafeInteger(ledger.calls) || !Number.isSafeInteger(ledger.characters) || !ledger.items || typeof ledger.items !== 'object') fail('Private ledger is invalid.');
} catch (e) { if (e.code !== 'ENOENT') throw e; }
let saving = Promise.resolve();
const save = () => {
  const snapshot = JSON.stringify(ledger, null, 2) + '\n';
  return saving = saving.then(async () => { await writeFile(ledgerPath, snapshot, { mode: 0o600 }); await chmod(ledgerPath, 0o600); });
};
let old = { clips: [] };
try { old = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const finished = new Map();
for (const c of records) {
  const known = old.clips?.find(x => x.digest === c.digest) || ledger.items[c.digest];
  if (known?.status === 'reserved' || known?.status === 'uncertain') fail('An earlier paid request has an uncertain result. Review it before retrying.');
  if (known?.audioSha256) {
    try {
      const bytes = await readFile(path.join(ROOT, c.src.slice(1)));
      if (sha(bytes) === known.audioSha256 && bytes.length === known.bytes) finished.set(c.digest, { audioSha256: known.audioSha256, bytes: bytes.length });
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
const pending = records.filter(c => !finished.has(c.digest));
if (pending.length) {
  const sub = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(15000) });
  if (!sub.ok) fail('Cannot verify prepaid allowance.');
  const info = await sub.json();
  const needed = pending.reduce((n, c) => n + c.spoken.length, 0);
  if (info.can_extend_character_limit !== false || !Number.isSafeInteger(info.character_limit) || !Number.isSafeInteger(info.character_count) || info.character_limit - info.character_count < needed) {
    fail('Verified prepaid-only allowance is insufficient; no recordings requested.');
  }
  console.log(JSON.stringify({ plannedClips: records.length, pendingClips: pending.length, characters: needed, prepaidRemaining: info.character_limit - info.character_count }));
}
for (const c of pending) {
  if (ledger.calls >= 16 || ledger.characters + c.spoken.length > 12000) fail('Paid preparation ceiling reached.');
  ledger.calls++; ledger.characters += c.spoken.length;
  ledger.items[c.digest] = { status: 'reserved', characters: c.spoken.length };
  await save();
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${profile.format}`, {
      method: 'POST', headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: c.spoken, model_id: profile.model, voice_settings: profile.voice_settings }), signal: AbortSignal.timeout(65000)
    });
    if (!response.ok || !/^audio\/(mpeg|mp3)/i.test(response.headers.get('content-type') || '')) fail('Provider did not return valid audio.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) fail('Invalid audio length.');
    await writeFile(path.join(ROOT, c.src.slice(1)), bytes);
    const meta = { audioSha256: sha(bytes), bytes: bytes.length };
    finished.set(c.digest, meta);
    ledger.items[c.digest] = { status: 'complete', characters: c.spoken.length, ...meta };
    await save();
    console.log(JSON.stringify({ prepared: finished.size, total: records.length, characters: ledger.characters }));
  } catch {
    ledger.items[c.digest].status = 'uncertain'; await save();
    fail('Preparation stopped after a failed or uncertain paid request. No automatic retry.');
  }
}
if (finished.size !== records.length) fail('Preparation incomplete.');
await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ version: VERSION, profile, clips: records.map(c => ({ id: c.id, text: c.text, digest: c.digest, src: c.src, ...finished.get(c.digest) })) }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'complete', clips: records.length, recordings: finished.size, calls: ledger.calls, characters: ledger.characters, audioBytes: [...finished.values()].reduce((n, c) => n + c.bytes, 0) }));
