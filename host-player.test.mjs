import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostVoicePlayer } from './host-player.mjs';

class FakeAudio {
  paused = true;
  ended = false;
  currentTime = 0;
  src = '';
  listeners = new Map();
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  fire(type) { for (const fn of this.listeners.get(type) || []) fn(); }
  pause() { this.paused = true; this.fire('pause'); }
  async play() { this.paused = false; this.ended = false; this.fire('play'); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.ended = false; }
}
const clip = digest => ({ digest, src: `/assets/host-audio/${digest}.mp3` });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup(loader = async () => new Blob(['audio'])) {
  const audio = new FakeAudio(), loaded = [], revoked = [], states = [];
  const player = createHostVoicePlayer({ audio, load: async value => { loaded.push(value.digest); return loader(value); }, onState: state => states.push(state), createURL: blob => `blob:${blob.size}:${loaded.length}`, revokeURL: url => revoked.push(url) });
  return { audio, player, loaded, revoked, states };
}

test('play, pause, resume, end and replay reuse the loaded clip without another load', async () => {
  const s = setup(), a = clip('a');
  await s.player.toggle(a); assert.equal(s.player.snapshot().state, 'playing');
  s.audio.pause(); assert.equal(s.player.snapshot().state, 'paused');
  await s.player.toggle(a); assert.equal(s.player.snapshot().state, 'playing');
  s.audio.ended = true; s.audio.paused = true; s.audio.fire('ended');
  assert.equal(s.player.snapshot().state, 'ended');
  await s.player.toggle(a); assert.equal(s.audio.currentTime, 0); assert.equal(s.player.snapshot().state, 'playing');
  assert.deepEqual(s.loaded, ['a']);
});

test('switching clips stops current playback and revokes its object URL', async () => {
  const s = setup(), a = clip('a'), b = clip('b');
  await s.player.toggle(a); const oldURL = s.audio.src;
  await s.player.toggle(b);
  assert.deepEqual(s.loaded, ['a', 'b']); assert.deepEqual(s.revoked, [oldURL]);
  assert.equal(s.audio.src, 'blob:5:2'); assert.equal(s.player.snapshot().id, 'b');
});

test('stop during a delayed load prevents the clip from autoplaying', async () => {
  const pending = deferred(), s = setup(() => pending.promise), work = s.player.toggle(clip('late'));
  s.player.stop(); pending.resolve(new Blob(['late'])); await work;
  assert.equal(s.player.snapshot().state, 'idle'); assert.equal(s.audio.src, ''); assert.equal(s.audio.paused, true);
});

test('rapid clip changes allow only the newest pending load to play', async () => {
  const one = deferred(), two = deferred(), s = setup(value => value.digest === 'one' ? one.promise : two.promise);
  const first = s.player.toggle(clip('one')); const second = s.player.toggle(clip('two'));
  two.resolve(new Blob(['two'])); await second; one.resolve(new Blob(['one'])); await first;
  assert.equal(s.player.snapshot().id, 'two'); assert.equal(s.audio.src, 'blob:3:2'); assert.deepEqual(s.loaded, ['one', 'two']);
});

test('load and playback failures report error and retry only after an explicit toggle', async () => {
  let loads = 0; const s = setup(async () => { loads++; if (loads === 1) throw Error('offline'); return new Blob(['ok']); });
  const a = clip('retry'); await s.player.toggle(a); assert.equal(s.player.snapshot().state, 'error');
  assert.equal(loads, 1); await Promise.resolve(); assert.equal(loads, 1);
  await s.player.toggle(a); assert.equal(s.player.snapshot().state, 'playing'); assert.equal(loads, 2);

  let playCount = 0; s.audio.play = async () => { playCount++; if (playCount === 1) throw Error('decode failure'); s.audio.paused = false; s.audio.fire('play'); };
  s.player.stop(); await s.player.toggle(a); assert.equal(s.player.snapshot().state, 'error');
  assert.equal(loads, 3); await Promise.resolve(); assert.equal(loads, 3);
  await s.player.toggle(a); assert.equal(s.player.snapshot().state, 'playing'); assert.equal(loads, 3);
});
