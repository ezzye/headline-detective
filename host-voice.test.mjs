import test from 'node:test';
import assert from 'node:assert/strict';
import campaigns from './campaigns.json' with { type: 'json' };
import { HOST_VOICE_VERSION, hostQuestionText, hostFeedbackText, hostClipText } from './host-voice.mjs';

const checks = campaigns.flatMap(campaign => campaign.reasoningChecks);

test('scripts every reviewed check from all nine campaigns without leaking its answer', () => {
  assert.equal(campaigns.length, 9);
  assert.equal(checks.length, 45);
  for (const check of checks) {
    const question = hostQuestionText(check, 0, 5);
    const feedback = hostFeedbackText(check);
    assert.match(question, /^Here is what the evidence tells us\. Question 1 of 5\./);
    check.options.forEach((option, i) => assert.ok(question.includes(`${String.fromCharCode(65 + i)}. ${option.label}`)));
    assert.doesNotMatch(question, /correct answer|the answer is/i);
    assert.ok(feedback.includes(`${String.fromCharCode(65 + check.options.findIndex(option => option.value === check.answer))}.`));
    assert.ok(feedback.includes(check.explanation));
    assert.doesNotMatch(`${question} ${feedback}`, /<[^>]*>|\[[^\]]*\]/);
  }
});

test('scripts are deterministic and only the relevant script changes with reviewed content', () => {
  const original = structuredClone(checks[0]);
  const q = hostQuestionText(original, 1, 7);
  const f = hostFeedbackText(original);
  assert.equal(HOST_VOICE_VERSION, 'cfj-host-v1');
  assert.equal(hostQuestionText(original, 1, 7), q);
  assert.equal(hostFeedbackText(original), f);
  const promptChange = { ...original, prompt: `${original.prompt} Please consider the time window.` };
  assert.notEqual(hostQuestionText(promptChange, 1, 7), q);
  assert.equal(hostFeedbackText(promptChange), f);
  const optionChange = structuredClone(original);
  optionChange.options[0].label += ' in the sample';
  assert.notEqual(hostQuestionText(optionChange, 1, 7), q);
  const answerChange = { ...original, answer: original.options.find(option => option.value !== original.answer).value };
  assert.equal(hostQuestionText(answerChange, 1, 7), q);
  assert.notEqual(hostFeedbackText(answerChange), f);
  const explanationChange = { ...original, explanation: `${original.explanation} Check the stated limits.` };
  assert.equal(hostQuestionText(explanationChange, 1, 7), q);
  assert.notEqual(hostFeedbackText(explanationChange), f);
});

test('cleans provider direction markup, validates metadata and routes clip parts', () => {
  const check = { id: 'demo', prompt: '[curious] What <b>counts</b>?', options: [{ value: 'a', label: '[shout] One <i>piece</i>' }, { value: 'b', label: 'A broadcast' }], answer: 'a', explanation: 'It is one [sad] written item.' };
  assert.equal(hostQuestionText(check, 0, 1), 'Here is what the evidence tells us. Question 1 of 1. What counts? A. One piece B. A broadcast');
  assert.equal(hostClipText(check, 0, 1, 'question'), hostQuestionText(check, 0, 1));
  assert.equal(hostClipText(check, 0, 1, 'feedback'), hostFeedbackText(check));
  assert.throws(() => hostClipText(check, 0, 1, 'summary'), /invalid_part/);
  assert.throws(() => hostQuestionText(check, -1, 1), /invalid_question_position/);
  assert.throws(() => hostFeedbackText({ ...check, answer: 'missing' }), /invalid_check/);
  assert.throws(() => hostFeedbackText({ ...check, explanation: ' ' }), /invalid_check/);
});
