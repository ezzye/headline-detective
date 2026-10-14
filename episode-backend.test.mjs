import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createGameServer} from './server.mjs';

function setup({env = {}, fetchImpl = async () => { throw new Error('unexpected provider call'); }} = {}) {
  const app = createGameServer({port: 0, env, fetchImpl, random: () => 0});
  return app;
}
const request = (app, method, url, body) => new Promise(resolve => {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const req = Readable.from(bytes.length ? [bytes] : []);
  Object.assign(req,{method,url,headers:{host:'127.0.0.1','content-type':body === undefined ? 'text/html' : 'application/json'}});
  let status, headers;
  app.server.emit('request',req,{writeHead(code,values){status=code;headers=values;},end(value){resolve({status,headers,body:String(value ?? '')});}});
});
const post = (app, route, body) => request(app, 'POST', route, body);
const getSession = async (app, caseId) => {
  const response = await post(app, '/api/campaign/session', {caseId});
  assert.equal(response.status, 201);
  return JSON.parse(response.body);
};

test('Jefferies episode answer stays desk-specific and treats the later Mirror briefing as unresolved', async t => {
  let captured;
  const app = setup({env:{DEEPSEEK_API_KEY:'test-only'},fetchImpl:async(_url,options)=>{captured=JSON.parse(options.body);throw new Error('mock provider unavailable');}});
  const page = await request(app, 'GET', '/jefferies.html');
  assert.equal(page.status, 200);
  assert.match(page.body, /Three days/i);
  const session = await getSession(app, 'jefferies-campaign');
  const bound = app.sessions.get(session.sessionId);
  const disputedDesk = session.desks.find(desk => bound.campaignByDesk[desk.outletId].outlet === 'Daily Mirror');
  assert.ok(disputedDesk);
  const response = await post(app, '/api/campaign/respond', {sessionId:session.sessionId,outletId:disputedDesk.outletId,
    question:'Across the three days, what did we know about his character and the police briefings?'});
  const result = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(result.mode, 'offline');
  assert.match(result.reply, /\bwe\b/i);
  assert.match(result.reply, /selected print records|selected print row/i);
  assert.match(result.reply, /not establish|not proof|unresolved|collection gap/i);
  assert.match(result.reply, /2012-11-29/);
  assert.doesNotMatch(result.reply, /The Daily Mirror|Daily Mirror newsroom|received police briefings/i);
  assert.ok(captured, 'request used only the local mocked provider');
  const packet = JSON.parse(captured.messages[1].content).trustedCampaign;
  assert.equal(packet.episodeContext.title, 'Three days that built an impression');
  assert.equal(packet.episodeContext.selectedPrintRecords.length > 0, true);
  assert.equal(packet.episodeContext.outletKnowledge.length <= 1, true);
  assert.equal(packet.episodeContext.commonEvents.some(event => event.date === '2010-12-30'), true);
  assert.match(captured.messages[0].content, /disputed briefing and denial remain unresolved/i);
  assert.match(captured.messages[0].content, /later-in-day events cannot be attributed to morning editions/i);
  const briefing = packet.episodeContext.outletKnowledge.find(item => item.knowledgeStatus === 'contested_later_testimony');
  assert.equal(briefing.dateClaimed, '2012-11-29');
  assert.ok(briefing.dateClaimed > packet.episodeContext.window.end);
});

test('another case receives Leveson ethical comparison without a claim of direct findings', async t => {
  let captured;
  const app = setup({env:{DEEPSEEK_API_KEY:'test-only'},fetchImpl:async(_url,options)=>{captured=JSON.parse(options.body);throw new Error('mock provider unavailable');}});
  const session = await getSession(app, 'caroline-flack-recovered-campaign');
  const response = await post(app, '/api/campaign/respond', {sessionId:session.sessionId,outletId:session.desks[0].outletId,
    question:'How should we use Leveson as a comparison in this case?'});
  const result = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(result.mode, 'offline');
  assert.match(result.reply, /\bwe\b/i);
  assert.match(result.reply, /ethical comparison|made no findings/i);
  assert.match(result.reply, /does not prove|not evidence/i);
  const packet = JSON.parse(captured.messages[1].content).trustedCampaign;
  assert.equal(packet.levesonContext.relationship, 'ethical_comparison');
  assert.match(packet.levesonContext.rule, /made no findings about this campaign/i);
  assert.match(captured.messages[0].content, /distinguish direct case findings from an ethical comparison/i);
});
