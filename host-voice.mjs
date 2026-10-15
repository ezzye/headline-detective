// Deterministic, provider-independent scripts for the evidence game host.
export const HOST_VOICE_VERSION = 'cfj-host-v1';

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\[[^\]\n]{1,100}\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function reviewedCheck(check) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) throw new Error('invalid_check');
  const id = cleanText(check.id);
  const prompt = cleanText(check.prompt);
  const explanation = cleanText(check.explanation);
  if (!id || !prompt || !explanation || !Array.isArray(check.options) || check.options.length < 2 || check.options.length > 26) throw new Error('invalid_check');
  const options = check.options.map(option => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error('invalid_check');
    const value = cleanText(option.value);
    const label = cleanText(option.label);
    if (!value || !label) throw new Error('invalid_check');
    return { value, label };
  });
  if (new Set(options.map(option => option.value)).size !== options.length) throw new Error('invalid_check');
  const answer = cleanText(check.answer);
  if (!answer || !options.some(option => option.value === answer)) throw new Error('invalid_check');
  return { id, prompt, explanation, options, answer };
}

function optionLabel(index) {
  return `${String.fromCharCode(65 + index)}.`;
}

export function hostQuestionText(check, index, total) {
  const reviewed = reviewedCheck(check);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) throw new Error('invalid_question_position');
  const choices = reviewed.options.map((option, i) => `${optionLabel(i)} ${option.label}`).join(' ');
  return `Here is what the evidence tells us. Question ${index + 1} of ${total}. ${reviewed.prompt} ${choices}`;
}

export function hostFeedbackText(check) {
  const reviewed = reviewedCheck(check);
  const answerIndex = reviewed.options.findIndex(option => option.value === reviewed.answer);
  return `The correct answer is ${optionLabel(answerIndex)} ${reviewed.options[answerIndex].label}. ${reviewed.explanation}`;
}

export function hostClipText(check, index, total, part) {
  if (part === 'question') return hostQuestionText(check, index, total);
  if (part === 'feedback') return hostFeedbackText(check);
  throw new Error('invalid_part');
}
