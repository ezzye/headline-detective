import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createGameServer} from './server.mjs';
// Exercise the actual HTTP handler without binding a port in the sandbox.
function post(app,url,body) {
  return new Promise(resolve=>{
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url=url;req.headers={host:'127.0.0.1','content-type':'application/json'};
    let status,headers;const res={writeHead(s,h){status=s;headers=h;},end(bytes){const raw=Buffer.from(bytes || '');resolve({status,headers,raw,json:()=>JSON.parse(raw.toString())});}};
    app.server.emit('request',req,res);
  });
}

test('racial-pattern questions acknowledge research without converting historic crime coverage into guilt or a white-only comparison',async()=>{
 const app=createGameServer({env:{},random:()=>0});
 for(const caseId of ['arday-2026-campaign','sterling-campaign','greenwood-campaign']){
  const session=(await post(app,'/api/campaign/session',{caseId})).json();
  const response=await post(app,'/api/campaign/respond',{sessionId:session.sessionId,outletId:session.desks[0].outletId,question:'Does newsworthy mean repeated scrutiny of rich Black men cannot be biased?'});
  assert.equal(response.status,200);const out=response.json();
  assert.match(out.reply,/A true report can still contribute to an unfair pattern/);
  assert.match(out.reply,/all young men, not white men alone/);
  assert.match(out.reply,/victims were included/);
  assert.match(out.reply,/does not establish a deliberate attempt/);
  assert.ok(out.evidenceIds.every(id=>session.evidence.some(e=>e.id===id)));assert.ok(out.reply.length<=2000);
 }
});
test('live answer packet provides source findings for racial questions and preserves legal status',async()=>{
 let captured;const app=createGameServer({env:{DEEPSEEK_API_KEY:'synthetic'},random:()=>0,fetchImpl:async(_url,opts)=>{captured=JSON.parse(opts.body);throw Error('provider_offline');}});
 const session=(await post(app,'/api/campaign/session',{caseId:'greenwood-campaign'})).json();
 await post(app,'/api/campaign/respond',{sessionId:session.sessionId,outletId:session.desks[0].outletId,question:'Why does a public interest justification excuse racial bias?'});
 const context=JSON.parse(captured.messages[1].content).trustedCampaign;
 assert.match(context.representationResearch.studies[0].finding,/66.9%/);
 assert.match(context.representationResearch.studies[0].limit,/includes Black youth/);
 assert.match(context.legalOutcomeContext.procedure,/no trial/);
 assert.match(captured.messages[0].content,/Structural bias does not require an admission/);
});
