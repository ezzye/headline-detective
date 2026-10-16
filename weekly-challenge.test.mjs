import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { WEEKLY_CHALLENGE, weeklyVoiceClips } from './weekly-challenge.mjs';

const template = await readFile(new URL('./weekly.template.html', import.meta.url), 'utf8');

test('challenge data is evidence bounded and every choice has an explained answer', () => {
  assert.equal(WEEKLY_CHALLENGE.questions.length, 4);
  assert.ok(WEEKLY_CHALLENGE.intro.length > 40);
  assert.ok(WEEKLY_CHALLENGE.outro.length > 40);
  assert.ok(WEEKLY_CHALLENGE.reflectionQuestions.length >= 4);
  for (const question of WEEKLY_CHALLENGE.questions) {
    assert.ok(question.id && question.prompt && question.explanation && question.evidence);
    assert.ok(question.options.length >= 3 && question.options.length <= 3);
    assert.equal(question.options.filter(option => option.value === question.answer).length, 1);
    assert.ok(question.explanation.split(/\s+/).length <= 100);
  }
  const content = JSON.stringify(WEEKLY_CHALLENGE);
  for (const fact of ['32', '53', '40', '15', '11', '5', '14 October 2026', '15 October 2026']) assert.ok(content.includes(fact), `missing required evidence: ${fact}`);
  assert.match(content, /unknown/i);
  assert.match(content, /Featured sidebar/);
  assert.match(content, /lower-page/);
  assert.match(content, /not a full-year trend/);
});

test('voice clip text covers intro, spoken options, feedback, and reflection with stable ids', () => {
  const clips = weeklyVoiceClips();
  assert.deepEqual(clips.map(clip => clip.id), [
    'intro', 'question-matched-pattern', 'feedback-matched-pattern',
    'question-gaps-and-window', 'feedback-gaps-and-window',
    'question-topic-and-framing', 'feedback-topic-and-framing',
    'question-follow-up-window', 'feedback-follow-up-window', 'outro'
  ]);
  assert.equal(clips.find(clip => clip.id === 'intro').text, WEEKLY_CHALLENGE.intro);
  for (const question of WEEKLY_CHALLENGE.questions) {
    const spoken = clips.find(clip => clip.id === `question-${question.id}`).text;
    for (const option of question.options) assert.ok(spoken.includes(option.label));
    assert.ok(clips.find(clip => clip.id === `feedback-${question.id}`).text.includes(question.explanation));
  }
  assert.ok(clips.at(-1).text.includes(WEEKLY_CHALLENGE.reflectionQuestions[0]));
});

test('standalone template focuses on the challenge and keeps audio optional and same-origin', () => {
  assert.match(template, /WEEKLY_CHALLENGE_DATA/);
  assert.match(template, /new URLSearchParams\(location\.search\).*play.*1/);
  assert.match(template, /WEEKLY_VOICE_MANIFEST_DATA/);
  assert.match(template, /clip\.text!==expected\.text/);
  assert.match(template, /source\.origin!==location\.origin/);
  assert.match(template, /aria-pressed/);
  assert.match(template, /cancelAudio\(\).*pagehide|pagehide.*cancelAudio/);
  assert.match(template, /answers\.set\(qIndex,b\.dataset\.answer\)/);
  assert.match(template, /skips\.add\(qIndex\)/);
  assert.match(template, /data-show-answer/);
  assert.match(template, /id="explore-content"/);
});

test('injected weekly scripts remain syntactically valid for standalone rendering', () => {
  const script = template.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const executable = script
    .replace('/* WEEKLY_EVIDENCE_DATA */', 'const EVIDENCE = {};')
    .replace('/* WEEKLY_CHALLENGE_DATA */', 'const CHALLENGE = {};')
    .replace('/* WEEKLY_VOICE_MANIFEST_DATA */', 'const VOICE_MANIFEST = null;');
  assert.doesNotMatch(executable, /WEEKLY_(?:EVIDENCE|CHALLENGE|VOICE_MANIFEST)_DATA/);
  assert.doesNotThrow(() => new vm.Script(executable));
});


test('reveal, answer, and skip each resolve one question without double counting', () => {
  const source = template.match(/function challengeProgress\([\s\S]*?\nfunction paintGame/);
  assert.ok(source);
  const helper = source[0].replace(/\nfunction paintGame$/, '');
  const challengeProgress = vm.runInNewContext(`${helper}; challengeProgress`);
  const questions = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  const answers = new Map(), skips = new Set(), revealed = new Set();
  revealed.add('one');
  assert.deepEqual({ ...challengeProgress(questions, answers, skips, revealed) }, { resolved: 1, revealed: 1 });
  answers.set(0, 'chosen');
  assert.deepEqual({ ...challengeProgress(questions, answers, skips, revealed) }, { resolved: 1, revealed: 0 });
  skips.add(1);
  assert.deepEqual({ ...challengeProgress(questions, answers, skips, revealed) }, { resolved: 2, revealed: 0 });
});

test('voice welcomes into question one, preserves pause position, and warms exact matched clips', () => {
  assert.match(template, /id==='intro'[\s\S]*?playClip\(`question-\$\{CHALLENGE\.questions\[0\]\.id\}`\)/);
  assert.match(template, /activeAudio\.paused\)\{activeAudio\.play\(\)/);
  assert.match(template, /else activeAudio\.pause\(\)/);
  assert.match(template, /clip\.text!==expected\.text/);
  assert.match(template, /audio\.preload='auto';preloadedClips\.set\(id,audio\);audio\.load\(\)/);
  assert.match(template, /function warmAround\(index\)[\s\S]*?warmClip\(`question-\$\{next\.id\}`\)/);
  assert.match(template, /#weekly-challenge \.progress-wrap/);
  assert.match(template, /document\.querySelector\('#question-slot \.feedback'\)\?\.focus\(\)/);
  assert.match(template, /data-question-heading.*?focus\(\)/);
});

