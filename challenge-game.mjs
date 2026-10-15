// A small browser-local teaching round. First choices stay fixed; showing or
// skipping an answer never manufactures a scored attempt.
function checkList(checks) {
  if (!Array.isArray(checks) || new Set(checks.map(c => c?.id)).size !== checks.length
      || checks.some(c => !c || typeof c.id !== 'string' || !c.id
        || !Array.isArray(c.options) || !c.options.length
        || c.options.some(o => typeof o?.value !== 'string' || !o.value)
        || new Set(c.options.map(o => o.value)).size !== c.options.length
        || !c.options.some(o => o.value === c.answer))) throw new TypeError('Invalid reviewed questions');
  return checks;
}

function activeQuestion(state, checks, questionId) {
  checkList(checks);
  const question = checks[state.index];
  if (state.complete || !question || question.id !== questionId) throw new RangeError('This is not the active question');
  return question;
}

function settle(state, questionId, answer, outcome) {
  if (Object.hasOwn(state.results, questionId)) return state;
  return { ...state, results: { ...state.results, [questionId]: { answer, outcome } } };
}

export function createChallengeState(checks) {
  checkList(checks);
  return { index: 0, results: {}, complete: checks.length === 0 };
}

export function chooseChallengeAnswer(state, checks, questionId, value) {
  const question = activeQuestion(state, checks, questionId);
  if (!question.options.some(o => o.value === value)) throw new RangeError('Unknown answer option');
  return settle(state, questionId, value, value === question.answer ? 'correct' : 'incorrect');
}

export function showChallengeAnswer(state, checks, questionId) {
  activeQuestion(state, checks, questionId);
  return settle(state, questionId, null, 'shown');
}

export function nextChallengeQuestion(state, checks, { skip = false } = {}) {
  checkList(checks);
  if (state.complete) return state;
  const question = activeQuestion(state, checks, checks[state.index]?.id);
  let next = state;
  if (!Object.hasOwn(state.results, question.id)) {
    if (!skip) throw new Error('Choose an answer, show it, or skip this question first');
    next = settle(state, question.id, null, 'skipped');
  }
  return state.index === checks.length - 1
    ? { ...next, complete: true }
    : { ...next, index: state.index + 1 };
}

export function reviewChallengeQuestion(state, checks, index) {
  checkList(checks);
  if (!Number.isInteger(index) || index < 0 || index >= checks.length) throw new RangeError('Invalid question index');
  return { ...state, index, complete: false };
}

export function challengeSummary(state, checks) {
  checkList(checks);
  const results = checks.map(c => state.results[c.id]).filter(Boolean);
  const answered = results.filter(r => r.answer !== null).length;
  const correct = results.filter(r => r.outcome === 'correct').length;
  return { total: checks.length, settled: results.length, answered, correct,
    points: correct * 2, possiblePoints: answered * 2,
    percent: checks.length ? Math.round(results.length / checks.length * 100) : 0,
    questionNumber: checks.length ? state.index + 1 : 0, complete: state.complete };
}
