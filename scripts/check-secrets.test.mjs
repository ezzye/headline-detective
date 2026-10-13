import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findings, scanRepository } from './check-secrets.mjs';

test('placeholder settings and public voice IDs can be shared', () => {
  assert.deepEqual(findings('.env.example', 'DEEPSEEK_API_KEY=your_deepseek_key\nELEVENLABS_VOICE_A=Xb7hH8MSUJpSbSDYk0k2'), []);
});
test('credentials are detected without including their values in findings', () => {
  const secret = 'sk_' + 'a'.repeat(48);
  assert.deepEqual(findings('example.js', secret), ['provider credential']);
  assert.deepEqual(findings('example.js', 'ghp_' + 'b'.repeat(36)), ['GitHub credential']);
  const opaque = 'an-opaque-test-credential';
  assert.deepEqual(findings('example.js', opaque, [opaque]), ['known credential']);
  assert.ok(!JSON.stringify(findings('example.js', secret)).includes(secret));
});
test('private file names are rejected even if empty', () => {
  assert.deepEqual(findings('.env', ''), ['private settings file']);
  assert.deepEqual(findings('.env.local', ''), ['private settings file']);
  assert.deepEqual(findings('private/config.json', ''), ['private file']);
});
test('a clean working file cannot conceal a secret in the index or earlier commits', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'headline-secret-check-'));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'user.email', 'test@example.invalid']);
    const file = path.join(root, 'sample.txt');
    writeFileSync(file, 'sk_' + 'c'.repeat(48));
    git(['add', 'sample.txt']);
    writeFileSync(file, 'clean working copy');
    assert.ok(scanRepository(root).some(x => x.location === 'staged' && x.label === 'provider credential'));
    git(['commit', '-qm', 'Test secret history']);
    git(['add', 'sample.txt']);
    git(['commit', '-qm', 'Clean current file']);
    assert.deepEqual(scanRepository(root), []);
    assert.ok(scanRepository(root, { history: true }).some(x => x.location === 'history' && x.label === 'provider credential'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
