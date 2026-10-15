import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChallengeState,
  chooseChallengeAnswer,
  showChallengeAnswer,
  nextChallengeQuestion,
  reviewChallengeQuestion,
  challengeSummary
} from './challenge-game.mjs';

function makeChecks(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    id: `q${index + 1}`,
    prompt: `Question ${index + 1}`,
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' }
    ],
    answer: index % 2 === 0 ? 'yes' : 'no',
    explanation: `Evidence-grounded explanation ${index + 1}`,
    evidenceIds: [`e${index + 1}`]
  }));
}

function answerAndAdvance(state, checks, value) {
  const question = checks[state.index];
  return nextChallengeQuestion(chooseChallengeAnswer(state, checks, question.id, value), checks, {});
}

test('answers settle immediately as correct or incorrect and lock the first selection', () => {
  const checks = makeChecks(2);
  const initial = createChallengeState(checks);
  const correct = chooseChallengeAnswer(initial, checks, 'q1', 'yes');
  assert.deepEqual(correct.results.q1, { answer: 'yes', outcome: 'correct' });
  assert.deepEqual(initial.results, {}, 'the original state is unchanged');

  const repeat = chooseChallengeAnswer(correct, checks, 'q1', 'no');
  assert.strictEqual(repeat, correct, 'settled answers are returned unchanged');
  assert.deepEqual(repeat.results.q1, { answer: 'yes', outcome: 'correct' });

  const advanced = nextChallengeQuestion(correct, checks);
  const wrong = chooseChallengeAnswer(advanced, checks, 'q2', 'yes');
  assert.deepEqual(wrong.results.q2, { answer: 'yes', outcome: 'incorrect' });
});

test('cannot advance an unanswered question unless it is explicitly skipped', () => {
  const checks = makeChecks(2);
  const initial = createChallengeState(checks);
  assert.throws(() => nextChallengeQuestion(initial, checks), /answer|settle|skip/i);

  const skipped = nextChallengeQuestion(initial, checks, { skip: true });
  assert.equal(skipped.index, 1);
  assert.deepEqual(skipped.results.q1, { answer: null, outcome: 'skipped' });
  assert.deepEqual(initial.results, {});
});

test('showing an answer settles the question without marking it correct or incorrect', () => {
  const checks = makeChecks(2);
  const initial = createChallengeState(checks);
  const shown = showChallengeAnswer(initial, checks, 'q1');
  assert.deepEqual(shown.results.q1, { answer: null, outcome: 'shown' });
  assert.equal(challengeSummary(shown, checks).settled, 1);
  assert.equal(challengeSummary(shown, checks).answered, 0);
  assert.equal(challengeSummary(shown, checks).correct, 0);
  assert.deepEqual(initial.results, {});
  assert.equal(nextChallengeQuestion(shown, checks).index, 1);
});

test('five-question sequence completes and scores only answered questions', () => {
  const checks = makeChecks(5);
  let state = createChallengeState(checks);
  const outcomes = ['correct', 'wrong', 'correct', 'skip', 'shown'];

  for (let i = 0; i < outcomes.length; i += 1) {
    const check = checks[state.index];
    if (outcomes[i] === 'skip') {
      state = nextChallengeQuestion(state, checks, { skip: true });
    } else if (outcomes[i] === 'shown') {
      state = nextChallengeQuestion(showChallengeAnswer(state, checks, check.id), checks);
    } else {
      const right = outcomes[i] === 'correct';
      const value = right ? check.answer : (check.answer === 'yes' ? 'no' : 'yes');
      state = nextChallengeQuestion(chooseChallengeAnswer(state, checks, check.id, value), checks);
    }
  }

  assert.equal(state.complete, true);
  assert.deepEqual(state.results, {
    q1: { answer: 'yes', outcome: 'correct' },
    q2: { answer: 'yes', outcome: 'incorrect' },
    q3: { answer: 'yes', outcome: 'correct' },
    q4: { answer: null, outcome: 'skipped' },
    q5: { answer: null, outcome: 'shown' }
  });
  assert.deepEqual(challengeSummary(state, checks), {
    total: 5,
    settled: 5,
    answered: 3,
    correct: 2,
    points: 4,
    possiblePoints: 6,
    percent: 100,
    questionNumber: 5,
    complete: true
  });
});

test('reviewing a settled question preserves its original answer and score', () => {
  const checks = makeChecks(3);
  let state = createChallengeState(checks);
  state = answerAndAdvance(state, checks, 'yes');
  state = answerAndAdvance(state, checks, 'yes'); // q2 is wrong
  const before = challengeSummary(state, checks);

  const reviewed = reviewChallengeQuestion(state, checks, 1);
  assert.equal(reviewed.index, 1);
  assert.equal(reviewed.complete, false);
  const attemptedChange = chooseChallengeAnswer(reviewed, checks, 'q2', 'no');
  assert.strictEqual(attemptedChange, reviewed);
  assert.deepEqual(attemptedChange.results.q2, { answer: 'yes', outcome: 'incorrect' });
  assert.deepEqual(challengeSummary(attemptedChange, checks), { ...before, questionNumber: 2, complete: false });
});

test('rejects invalid answers, stale question IDs, and invalid review indexes', () => {
  const checks = makeChecks(2);
  const initial = createChallengeState(checks);
  assert.throws(() => chooseChallengeAnswer(initial, checks, 'q1', 'maybe'), /answer|option|value/i);
  assert.throws(() => chooseChallengeAnswer(initial, checks, 'q2', 'yes'), /active|current|question/i);
  assert.throws(() => showChallengeAnswer(initial, checks, 'q2'), /active|current|question/i);
  const advanced = nextChallengeQuestion(initial, checks, { skip: true });
  assert.throws(() => chooseChallengeAnswer(advanced, checks, 'q1', 'yes'), /active|current|question/i);
  assert.throws(() => reviewChallengeQuestion(advanced, checks, -1), /index|question/i);
  assert.throws(() => reviewChallengeQuestion(advanced, checks, 2), /index|question/i);
});

test('a new question set starts fresh and input checks are not mutated', () => {
  const checks = makeChecks(2);
  const originalChecks = structuredClone(checks);
  const firstRun = chooseChallengeAnswer(createChallengeState(checks), checks, 'q1', 'yes');
  const secondRun = createChallengeState(checks);

  assert.deepEqual(secondRun, { index: 0, results: {}, complete: false });
  assert.deepEqual(firstRun.results.q1, { answer: 'yes', outcome: 'correct' });
  assert.deepEqual(checks, originalChecks);
});

test('empty question set is complete with a zero-safe summary', () => {
  const checks = [];
  const state = createChallengeState(checks);
  assert.deepEqual(state, { index: 0, results: {}, complete: true });
  assert.deepEqual(challengeSummary(state, checks), {
    total: 0,
    settled: 0,
    answered: 0,
    correct: 0,
    points: 0,
    possiblePoints: 0,
    percent: 0,
    questionNumber: 0,
    complete: true
  });
});
