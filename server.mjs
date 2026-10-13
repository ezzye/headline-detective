import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTLETS = [{ id: 'bbc', name: 'BBC' }, { id: 'guardian', name: 'The Guardian' }, { id: 'daily-mail', name: 'Daily Mail' }, { id: 'reuters', name: 'Reuters' }];
const DESKS = ['Desk A', 'Desk B', 'Desk C', 'Desk D'];
const DESK_FOCUS = ['precision: distinguish claim from evidence', 'context: explain what the article adds and omits', 'impact: describe documented effects without speculation', 'challenge: test what the evidence does and does not support'];
const PUBLIC_INTEREST_FOCUS = ['public-interest editor: weigh the public value of scrutiny and proportionality', 'evidence checker: separate established facts from allegations, inference, and omissions', 'impact reader: examine documented pressure, humiliation, and power without assuming outcomes', 'audience analyst: identify observable invitations to outrage or superiority without claiming actual reader feelings'];
const SESSION_TTL = 30 * 60 * 1000;
const MAX_BODY = 4096;
const MAX_CALLS = 12;
const PROVIDER_URL = 'https://api.deepseek.com/chat/completions';

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function safeEqualOrigin(req, host) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(u.hostname) && u.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}
async function readBody(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) throw Object.assign(new Error('invalid_json'), { status: 400 });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
function shuffled(items, random = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function fixture(caseItem, question = '', article = null, deskIndex = 0) {
  let text;
  if (caseItem.mode === 'public-interest' && article?.reviewNotes) {
    const fields = ['publicValue', 'pressure', 'limit'];
    const note = article.reviewNotes[fields[deskIndex % fields.length]] || article.reviewNotes.limit || caseItem.caseComparisonNote || caseItem.limits;
    text = `AI interpretation: ${note}. ${caseItem.caseComparisonNote || ''}`.trim().slice(0, 380);
  } else text = `AI interpretation: ${caseItem.supportedFinding || caseItem.summary}. ${caseItem.limits || ''}`.trim().slice(0, 380);
  const evidenceIds = (caseItem.evidence || []).slice(0, 2).map(e => e.id).filter(id => typeof id === 'string' && id.trim());
  if (/^\s*In one short sentence\b/i.test(question)) return { reply: `${text.slice(0, 148).replace(/[.!?\s]+$/, '')}. Simulated.`.slice(0, 180), evidenceIds, mode: 'offline' };
  return { reply: `${text} Simulated AI interpretation; source headline unchanged.`, evidenceIds, mode: 'offline' };
}
function speechText(reply) {
  return reply.replace(/^AI interpretation(?:\s*\(Simulated\))?\s*:\s*/i, '')
    .replace(/\s*(?:\(\s*Simulated(?:; source headline unchanged\.)?\s*\)|Simulated\.)\s*$/i, '').trim();
}
function leaksIdentityOrRole(reply, outletNames = []) {
  const aliases = new Set(['BBC', 'BBC News', 'ITV', 'ITV News', 'Sky', 'Sky News', 'The Guardian', 'Guardian', 'Reuters', 'Euronews', 'The Independent', 'Independent', 'PA', 'Associated Press', 'AP', 'The Washington Post', 'Washington Post']);
  for (const name of outletNames) for (const part of String(name).split(/\s*\/\s*/)) if (part.trim()) aliases.add(part.trim());
  const pub = `(?:${[...aliases].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})`;
  const desk = 'Desk [A-D]';
  const selfIdentification = new RegExp(`\\b(?:I am|I\\'m|we are|we\\'re|we at|this is|you are speaking to|our newsroom is|our outlet is)\\s+(?:the )?${pub}\\b`, 'i');
  const mapping = '(?:is|equals|represents|belongs to|maps to|reports for|is from|is run by)';
  const reverseMapping = new RegExp(`\\b${pub}\\s+${mapping}\\s+${desk}\\b`, 'i');
  const deskMapping = new RegExp(`\\b${desk}\\s+${mapping}\\s+(?:the )?${pub}\\b`, 'i');
  return selfIdentification.test(reply) || reverseMapping.test(reply) || deskMapping.test(reply);
}
function validProviderObject(value, approvedIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 450 || !/\bsimulated\b/i.test(value.reply) || !/\bAI interpretation\b/i.test(value.reply) || !Array.isArray(value.evidenceIds) || value.evidenceIds.length < 1 || value.evidenceIds.length > 4) return false;
  if (!value.evidenceIds.every(id => typeof id === 'string' && id.trim() && approvedIds.has(id))) return false;
  return true;
}

export function createGameServer({ port = Number(process.env.PORT || 9027), host = '127.0.0.1', casesPath = path.join(HERE, 'cases.json'), fetchImpl = globalThis.fetch, env = process.env, clock = () => Date.now(), random = Math.random } = {}) {
  const sessions = new Map();
  const voiceCache = new Map();
  const pendingVoices = new Map();
  let voiceCacheBytes = 0, totalVoiceCalls = 0, activeVoiceCalls = 0;
  const voiceKey = env.ELEVENLABS_API_KEY || env.ELEVEN_LABS_API_KEY || env.XI_API_KEY;
  const voiceIds = ['A', 'B', 'C', 'D'].map(suffix => env[`ELEVENLABS_VOICE_${suffix}`]).filter(v => typeof v === 'string' && v.trim());
  const distinctVoicesAvailable = new Set(voiceIds).size;
  const voiceConfigured = Boolean(voiceKey) && voiceIds.length === 4 && distinctVoicesAvailable === 4;
  let activeProviderCalls = 0;
  let casesPromise;
  const loadCases = () => casesPromise ??= readFile(casesPath, 'utf8').then(JSON.parse).then(v => {
    if (!Array.isArray(v)) throw new Error('cases.json must be an array');
    return v;
  });
  const cleanup = () => { const now = clock(); for (const [id, s] of sessions) if (now - s.createdAt >= SESSION_TTL) sessions.delete(id); };
  const server = http.createServer(async (req, res) => {
    const hostHeader = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(hostHeader) || !safeEqualOrigin(req, hostHeader)) return json(res, 403, { error: 'local_origin_only' });
    const pathname = new URL(req.url, `http://${hostHeader}`).pathname;
    try {
      cleanup();
      if (req.method === 'GET' && pathname === '/health') return json(res, 200, { ok: true, configured: Boolean(env.DEEPSEEK_API_KEY), voiceConfigured, distinctVoicesAvailable });
      if (req.method === 'GET' && pathname === '/') {
        const html = await readFile(path.join(HERE, 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); return res.end(html);
      }
      if (req.method === 'POST' && pathname.startsWith('/api/')) {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'application_json_required' });
        const body = await readBody(req);
        const cases = await loadCases();
        if (pathname === '/api/session') {
          if (typeof body.caseId !== 'string' || !cases.some(c => c.id === body.caseId)) return json(res, 404, { error: 'unknown_case' });
          const item = cases.find(c => c.id === body.caseId);
          if (!Array.isArray(item.articles) || item.articles.length !== 4 || item.articles.some(a => !a.id || !a.headline || !a.outlet || !a.url || !a.published || !a.verification || !(item.mode === 'public-interest' ? a.verdict === 'unresolved' && ['publicValue', 'pressure', 'limit'].every(k => typeof a.reviewNotes?.[k] === 'string' && a.reviewNotes[k].trim()) : ['supported', 'concern', 'unresolved'].includes(a.verdict)) || !a.verdictReason)) return json(res, 503, { error: 'case_articles_unavailable' });
          if (item.mode === 'public-interest' && (typeof item.caseComparisonNote !== 'string' || !item.caseComparisonNote.trim() || !Array.isArray(item.reasoningChecks) || item.reasoningChecks.length !== 5 || new Set(item.reasoningChecks.filter(c => c && c.id).map(c => c.id)).size !== 5 || item.reasoningChecks.some(c => !c || typeof c.id !== 'string' || !c.id || !c.prompt || !Array.isArray(c.options) || !c.options.length || c.options.some(o => !o || typeof o.value !== 'string' || typeof o.label !== 'string') || !c.options.some(o => o.value === c.answer) || !c.explanation || !Array.isArray(c.evidenceIds) || c.evidenceIds.some(id => !(item.evidence || []).some(e => e.id === id))))) return json(res, 503, { error: 'case_reasoning_checks_unavailable' });
          const deskRows = DESKS.map((label, i) => ({ outletId: `desk-${String.fromCharCode(97 + i)}`, label }));
          const articles = shuffled(item.articles, random);
          const articleByDesk = Object.fromEntries(deskRows.map((desk, i) => [desk.outletId, articles[i]]));
          if (sessions.size >= 256) return json(res, 503, { error: 'session_capacity_reached' });
          const id = randomUUID();
          sessions.set(id, { createdAt: clock(), caseId: body.caseId, desks: deskRows, articleByDesk, calls: 0, inFlight: 0, controllers: new Set(), revealed: false, storyRevealed: {}, replies: new Map(), voiceCalls: 0, voiceChars: 0, voiceInFlight: 0 });
          return json(res, 201, { sessionId: id, caseId: body.caseId, desks: deskRows.map((d, i) => { const a = articleByDesk[d.outletId]; return { ...d, headline: a.headline, published: a.published, summary: a.summary ?? '', verification: a.verification, note: a.note ?? '', voiceSpeaker: `Analyst ${String.fromCharCode(65 + i)}`, voiceConfigured, ...(item.mode === 'public-interest' ? { ...(typeof a.coverageStage === 'string' ? { coverageStage: a.coverageStage } : {}), ...(typeof a.headlineType === 'string' ? { headlineType: a.headlineType } : {}) } : {}) }; }), label: 'Headlines and summaries are published article records; analyst replies are simulated AI interpretations.' });
        }
        const session = sessions.get(body.sessionId);
        if (!session) return json(res, 404, { error: 'invalid_or_expired_session' });
        if (session.revealed && pathname === '/api/reveal') return json(res, 200, session.revealResult);
        if (session.revealed) return json(res, 409, { error: 'session_already_revealed' });
        if (pathname === '/api/speak') {
          if (!voiceConfigured) return json(res, 503, { error: 'voice_not_configured' });
          const article = session.articleByDesk[body.outletId];
          const deskIndex = session.desks.findIndex(d => d.outletId === body.outletId);
          if (!article || deskIndex < 0) return json(res, 400, { error: 'unknown_outlet' });
          let text;
          if (body.kind === 'headline') text = `Desk ${String.fromCharCode(65 + deskIndex)}. Headline: ${article.headline}`;
          else if (body.kind === 'reply') {
            if (typeof body.replyId !== 'string') return json(res, 400, { error: 'reply_id_required' });
            const saved = session.replies.get(body.replyId);
            if (!saved || saved.outletId !== body.outletId) return json(res, 403, { error: 'reply_not_owned_by_desk' });
            text = speechText(saved.text);
          } else return json(res, 400, { error: 'invalid_speech_kind' });
          if (!text.trim() || text.length > 1200) return json(res, 400, { error: 'invalid_speech_text' });
          const speaker = String.fromCharCode(65 + deskIndex), id = env[`ELEVENLABS_VOICE_${speaker}`];
          const hash = createHash('sha256').update(`${id}\0${text}`).digest('hex');
          const sendAudio = bytes => { res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes); };
          if (voiceCache.has(hash)) { const cached = voiceCache.get(hash); voiceCache.delete(hash); voiceCache.set(hash, cached); return sendAudio(cached); }
          if (pendingVoices.has(hash)) { try { return sendAudio(await pendingVoices.get(hash)); } catch { return json(res, 502, { error: 'voice_provider_unavailable' }); } }
          if (session.voiceCalls >= 8 || session.voiceChars + text.length > 4000) return json(res, 429, { error: 'voice_budget_exceeded' });
          if (session.voiceInFlight >= 2 || activeVoiceCalls >= 8 || totalVoiceCalls >= 100) return json(res, 429, { error: 'voice_capacity_reached' });
          session.voiceCalls++; session.voiceChars += text.length; session.voiceInFlight++; totalVoiceCalls++; activeVoiceCalls++;
          const task = (async () => {
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
            try {
              const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, { method: 'POST', signal: controller.signal, headers: { 'xi-api-key': voiceKey, 'content-type': 'application/json' }, body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5' }) });
              if (!response.ok) throw new Error('voice_provider_unavailable');
              const type = (response.headers?.get?.('content-type') || '').toLowerCase();
              if (!type.startsWith('audio/mpeg') && !type.startsWith('audio/mp3')) throw new Error('voice_invalid_audio');
              const bytes = Buffer.from(await response.arrayBuffer());
              if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('voice_invalid_audio');
              return bytes;
            } finally { clearTimeout(timer); }
          })();
          pendingVoices.set(hash, task);
          try {
            const bytes = await task;
            voiceCache.set(hash, bytes); voiceCacheBytes += bytes.length;
            while (voiceCache.size > 256 || voiceCacheBytes > 32 * 1024 * 1024) { const [oldKey, oldBytes] = voiceCache.entries().next().value; voiceCache.delete(oldKey); voiceCacheBytes -= oldBytes.length; }
            return sendAudio(bytes);
          } catch (err) { return json(res, 502, { error: err?.name === 'AbortError' ? 'voice_timeout' : err?.message === 'voice_invalid_audio' ? 'voice_invalid_audio' : 'voice_provider_unavailable' }); }
          finally { pendingVoices.delete(hash); session.voiceInFlight--; activeVoiceCalls--; }
        }
        if (pathname === '/api/story') {
          const article = session.articleByDesk[body.outletId];
          if (!article) return json(res, 400, { error: 'unknown_outlet' });
          session.storyRevealed[body.outletId] = true;
          return json(res, 200, { outletId: body.outletId, headline: article.headline, published: article.published, outlet: article.outlet, url: article.url, label: 'Authentic published article source; headline shown verbatim.' });
        }
        if (pathname === '/api/respond') {
          if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 400) return json(res, 400, { error: 'invalid_question' });
          if (body.caseId !== session.caseId) return json(res, 409, { error: 'case_locked_for_session' });
          const item = cases.find(c => c.id === session.caseId);
          if (!session.articleByDesk[body.outletId]) return json(res, 400, { error: 'unknown_outlet' });
          if (session.calls >= MAX_CALLS) return json(res, 429, { error: 'session_call_limit' });
          if (session.inFlight >= 4) return json(res, 429, { error: 'session_concurrency_limit' });
          session.calls++;
          session.inFlight++;
          const desk = session.desks.find(d => d.outletId === body.outletId);
          const article = session.articleByDesk[body.outletId];
          const key = env.DEEPSEEK_API_KEY;
          if (!key) { session.inFlight--; const fallback = fixture(item, body.question, article, DESKS.indexOf(desk.label)), replyId = randomUUID(); session.replies.set(replyId, { outletId: desk.outletId, text: fallback.reply }); return json(res, 200, { outletId: desk.outletId, label: desk.label, ...fallback, replyId, reason: 'no_key', simulated: true, remainingCalls: MAX_CALLS - session.calls }); }
          if (activeProviderCalls >= 16) { session.inFlight--; return json(res, 429, { error: 'server_concurrency_limit' }); }
          activeProviderCalls++;
          let mode = 'deepseek', reason;
          try {
            const controller = new AbortController();
            session.controllers.add(controller);
            const timer = setTimeout(() => controller.abort(), 20_000);
            let response;
            try {
              response = await fetchImpl(PROVIDER_URL, { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({
                model: env.DEEPSEEK_MODEL || 'deepseek-flash', response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 320, temperature: 0.4,
                messages: [
                  { role: 'system', content: `You are a helpful, evidence-grounded simulated AI analyst commenting on an authentic fixed article. Never create, rewrite, or paraphrase its headline. The article headline and summary are immutable source material; any response must be clearly labelled AI interpretation. Use concise plain language, explain what is supported, and preserve the case scope and limits. Distinguish evidence about the underlying issue from evidence about this article's framing. Do not invent facts, infer intent, assign blame, reveal publisher identity, or give a final coverage verdict. Desk ${String.fromCharCode(65 + DESKS.indexOf(desk.label))} editorial emphasis: ${item.mode === 'public-interest' ? PUBLIC_INTEREST_FOCUS[DESKS.indexOf(desk.label)] : DESK_FOCUS[DESKS.indexOf(desk.label)]}.${item.mode === 'public-interest' ? ' Weigh public value and proportionality, including repetition, humiliation, power, and stereotypes. Separate legitimate scrutiny from potential harms; allow a mixed assessment. Discuss observable invitations to outrage or superiority, never assert actual reader feelings. Do not claim motives or causal consequences not established by evidence.' : ''} For a one-sentence introductory question, answer concisely in one sentence, ideally <=180 characters including the required wrapper. Otherwise keep reply <=450 characters. Include “AI interpretation” and “Simulated”. Return JSON shaped exactly like {"reply":"...","evidenceIds":["id"]}; use only approved evidence IDs.` },
                  { role: 'user', content: JSON.stringify({ article: { headline: article.headline, published: article.published, summary: article.summary ?? '', verification: article.verification, note: article.note ?? '', ...(item.mode === 'public-interest' ? { reviewNotes: article.reviewNotes } : {}) }, factPacket: { title: item.title, supportedSummary: item.summary, supportedFinding: item.supportedFinding, limits: item.limits, ...(item.mode === 'public-interest' ? { caseComparisonNote: item.caseComparisonNote } : {}), evidence: item.evidence }, question: body.question }) }
                ]
              }) });
            } finally { clearTimeout(timer); session.controllers.delete(controller); }
            if (!response.ok) throw new Error('provider_http_error');
            const payload = await response.json();
            const raw = payload?.choices?.[0]?.message?.content;
            if (typeof raw !== 'string') throw new Error('provider_invalid_json');
            let parsed;
            try { parsed = JSON.parse(raw); } catch { throw new Error('provider_invalid_json'); }
            const allowed = new Set((item.evidence || []).map(e => e.id));
            const isIntro = /^\s*In one short sentence\b/i.test(body.question);
            if (!validProviderObject(parsed, allowed) || (isIntro && parsed.reply.length > 220)) throw new Error('provider_invalid_schema');
            if (leaksIdentityOrRole(parsed.reply, item.articles.map(a => a.outlet))) throw new Error('provider_identity_leak');
            session.inFlight--; activeProviderCalls--;
            if (session.revealed) return json(res, 409, { error: 'session_already_revealed' });
            const replyId = randomUUID(); session.replies.set(replyId, { outletId: desk.outletId, text: parsed.reply });
            return json(res, 200, { outletId: desk.outletId, label: desk.label, reply: parsed.reply, replyId, evidenceIds: parsed.evidenceIds, mode, simulated: true, remainingCalls: MAX_CALLS - session.calls });
          } catch (err) {
            mode = 'offline'; reason = err?.name === 'AbortError' ? 'timeout' : (['provider_invalid_json', 'provider_invalid_schema', 'provider_identity_leak'].includes(err?.message) ? err.message : 'provider_unavailable');
            session.inFlight--; activeProviderCalls--;
            if (session.revealed) return json(res, 409, { error: 'session_already_revealed' });
            const fallback = fixture(item, body.question, article, DESKS.indexOf(desk.label)), replyId = randomUUID(); session.replies.set(replyId, { outletId: desk.outletId, text: fallback.reply });
            return json(res, 200, { outletId: desk.outletId, label: desk.label, ...fallback, replyId, reason, simulated: true, remainingCalls: MAX_CALLS - session.calls });
          }
        }
        if (pathname === '/api/reveal') {
          const currentCase = cases.find(c => c.id === session.caseId);
          if (currentCase?.mode === 'public-interest') {
            const decisions = body.articleVerdicts, assessments = body.assessments, answers = body.reasoningAnswers;
            const ids = session.desks.map(d => d.outletId), checks = currentCase.reasoningChecks;
            const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k));
            if (!exactKeys(decisions, ids) || ids.some(id => !['justified', 'mixed', 'pile-on', 'unclear'].includes(decisions[id]))) return json(res, 400, { error: 'invalid_editorial_judgments' });
            if (!exactKeys(assessments, ids) || ids.some(id => !exactKeys(assessments[id], ['publicValue', 'pressure']) || !['weak', 'some', 'strong', 'unclear'].includes(assessments[id].publicValue) || !['low', 'some', 'high', 'unclear'].includes(assessments[id].pressure))) return json(res, 400, { error: 'invalid_editorial_assessments' });
            const checkIds = checks.map(c => c.id);
            if (!exactKeys(answers, checkIds) || checks.some(c => !c.options.some(o => o.value === answers[c.id]))) return json(res, 400, { error: 'invalid_reasoning_answers' });
            if (typeof body.justification !== 'string' || body.justification.trim().length < 40 || body.justification.length > 600) return json(res, 400, { error: 'invalid_editorial_justification' });
            const reasoningResults = checks.map(c => ({ id: c.id, prompt: c.prompt, correct: answers[c.id] === c.answer, answer: c.answer, explanation: c.explanation, evidenceIds: c.evidenceIds }));
            const reasoningScore = reasoningResults.reduce((sum, r) => sum + (r.correct ? 2 : 0), 0);
            const roles = session.desks.map(d => {
              const article = session.articleByDesk[d.outletId];
              return { outletId: d.outletId, label: d.label, outletName: article.outlet, article: { ...article }, role: 'editorial-judgment', decision: decisions[d.outletId], assessment: { ...assessments[d.outletId] } };
            });
            session.revealed = true;
            for (const controller of session.controllers) controller.abort();
            session.revealResult = { mode: 'public-interest', caseId: session.caseId, roles, justification: body.justification.trim(), reasoningScore, reasoningTotal: 10, reasoningResults, caseComparisonNote: currentCase.caseComparisonNote || '', label: 'Editorial judgments and written reasoning are for discussion; points reflect only the five evidence reasoning checks.' };
            return json(res, 200, session.revealResult);
          }
          const submitted = body.articleVerdicts ?? {};
          if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted) || Object.keys(submitted).length !== 4 || session.desks.some(d => !['supported', 'concern', 'unresolved'].includes(submitted[d.outletId])) || Object.keys(submitted).some(id => !session.articleByDesk[id])) return json(res, 400, { error: 'invalid_article_verdicts' });
          session.revealed = true;
          for (const controller of session.controllers) controller.abort();
          const roles = session.desks.map(d => { const article = session.articleByDesk[d.outletId]; const role = article.verdict === 'concern' ? 'traitor' : article.verdict === 'supported' ? 'faithful' : 'unresolved'; return { outletId: d.outletId, label: d.label, outletName: article.outlet, outlet: article.outlet, article: { ...article }, role }; });
          const articleVerdicts = session.desks.map(d => { const article = session.articleByDesk[d.outletId]; const submittedVerdict = submitted[d.outletId] ?? null; return { outletId: d.outletId, submitted: submittedVerdict, actual: article.verdict, correct: submittedVerdict === null ? null : submittedVerdict === article.verdict, reason: article.verdictReason }; });
          const scored = articleVerdicts.filter(v => v.correct !== null);
          session.revealResult = { caseId: session.caseId, roles, articleVerdicts, coverageCorrect: scored.filter(v => v.correct).length, coverageTotal: 4, label: 'Published article records are authentic; analyst commentary is simulated. Supported means the central claim matches the case evidence, not that the article is a blanket fairness certificate.' };
          return json(res, 200, session.revealResult);
        }
      }
      if (req.method === 'GET' && pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      return json(res, 404, { error: 'not_found' });
    } catch (err) {
      return json(res, err?.status || 500, { error: err?.status ? err.message : 'server_error' });
    }
  });
  return { server, sessions, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address())); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createGameServer();
  app.listen().then(address => console.log(`Faithful to the Facts local prototype: http://${address.address}:${address.port}`)).catch(err => { console.error(`Could not start local server: ${err.message}`); process.exitCode = 1; });
}
