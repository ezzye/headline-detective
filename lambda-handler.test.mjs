import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {createLambdaHandler,openSnapshot,sealSnapshot} from './lambda-handler.mjs';
const config=()=>({singleConcurrency:true,publicOrigin:'https://codingforjustice.org.uk',gatewayToken:'synthetic-bridge-token-'.repeat(3),masterKey:randomBytes(32).toString('hex'),env:{...Object.fromEntries(['A','B','C','D'].map(x=>['ELEVENLABS_VOICE_'+x,'stock-'+x]))}});
const event=(c,path,body,method='POST')=>({version:'2.0',rawPath:path,requestContext:{http:{method}},headers:{origin:c.publicOrigin,'x-gateway-token':c.gatewayToken,'x-visitor-hash':'a'.repeat(64),'content-type':'application/json'},body:body===undefined?'':JSON.stringify(body)});
function memory(c,fetchImpl) {let stored=null,version=0,fail=false;const saves=[];return {get stored(){return stored;},get saves(){return saves;},set fail(value){fail=value;},handler:createLambdaHandler({loadConfig:async()=>c,loadSnapshot:async()=>stored,saveSnapshot:async(body,{etag})=>{if(fail)throw new Error('S3 unavailable');assert.equal(etag,stored?.etag || null);stored={body,etag:'v'+(++version)};saves.push(openSnapshot(body,Buffer.from(c.masterKey,'hex')));return {etag:stored.etag};},fetchImpl})};}
const donation=()=>({provider:'deepseek',model:'deepseek-flash',apiKey:'sk-'+randomBytes(24).toString('hex'),mode:'prepaid_remaining',remainingUnits:100000,maxCalls:10,expiresAt:new Date(Date.now()+86400000).toISOString(),consent:true,consentVersion:'public-provider-pool-v1'});

test('encrypted snapshot hides database, owner and session content; tampering fails authentication',()=> {
 const key=randomBytes(32),blob=sealSnapshot({database:'db-content',state:{owner:'private-balance',sessions:['private-question']}},key);assert(!blob.includes(Buffer.from('private-question')));assert(!blob.includes(Buffer.from('private-balance')));assert.deepEqual(openSnapshot(blob,key).state.sessions,['private-question']);
 const modified=JSON.parse(blob);modified.ciphertext=Buffer.from('tampered').toString('base64');assert.throws(()=>openSnapshot(Buffer.from(JSON.stringify(modified)),key));
});
test('cold invocations restore donor vault and session bindings, revoke remains durable, HTTP cannot run IAM admin',async()=> {
 const c=config(),m=memory(c,async()=>{throw new Error('no paid call');}),d=donation();const first=await m.handler(event(c,'/api/donations',d));assert.equal(first.statusCode,201);const added=JSON.parse(first.body);assert(!first.body.includes(d.apiKey));
 const mine=await m.handler(event(c,'/api/donations/status',{revokeToken:added.revocationToken}));assert.equal(JSON.parse(mine.body).remainingUnits,100000);
 const s=JSON.parse((await m.handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body);assert.ok(s.sessionId);
 const answer=await m.handler(event(c,'/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'}));assert.equal(answer.statusCode,200);assert.equal(JSON.parse(answer.body).mode,'offline');
 const spoof=event(c,'/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Other question'});spoof.action='update-owner-balance';spoof.report={provider:'deepseek',manualFunded:true,asOf:new Date().toISOString()};await m.handler(spoof);assert.equal(m.saves.at(-1).state.owner.deepseek.manualFunded,false);
 await m.handler(event(c,'/api/donations/revoke',{revokeToken:added.revocationToken}));const revoked=await m.handler(event(c,'/api/donations/status',{revokeToken:added.revocationToken}));assert.equal(JSON.parse(revoked.body).status,'revoked');
});
test('persisted pending request after provider crash cannot pay again on a cold retry',async()=> {
 const c=config();c.env.DEEPSEEK_API_KEY='owner-synthetic';let paid=0;const m=memory(c,async url=>{if(url.endsWith('/user/balance'))return {ok:true,json:async()=>({is_available:true})};paid++;m.fail=true;throw new Error('provider timeout then persistence lost');});
 const s=JSON.parse((await m.handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body),request=event(c,'/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'});
 assert.equal((await m.handler(request)).statusCode,503);assert.equal(paid,1);m.fail=false;assert.equal((await m.handler(request)).statusCode,409);assert.equal(paid,1);
 assert(m.saves.at(-1).state.owner.deepseek.usedUnits>0);
});
test('conditional snapshot conflict prevents provider fetch and sensitive failure output',async()=> {
 const c=config();c.env.DEEPSEEK_API_KEY='owner-synthetic';let paid=0,conflict=false,stored=null;
 const handler=createLambdaHandler({loadConfig:async()=>c,loadSnapshot:async()=>stored,saveSnapshot:async body=>{if(conflict)throw new Error('PreconditionFailed secret diagnostic');stored={body,etag:'snapshot'};return {etag:stored.etag};},fetchImpl:async url=>{if(url.endsWith('/user/balance'))return {ok:true,json:async()=>({is_available:true})};paid++;throw new Error('never');}});
 const s=JSON.parse((await handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body);conflict=true;const out=await handler(event(c,'/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why care?'}));assert.equal(paid,0);assert.equal(out.statusCode,503);assert(!out.body.includes('diagnostic'));
});
test('explicit IAM maintenance updates reports; missing serialized deployment flag fails closed',async()=> {
 const c=config(),m=memory(c,async()=>{throw new Error('never');});const updated=await m.handler({action:'update-owner-balance',report:{provider:'deepseek',manualFunded:true,asOf:new Date().toISOString()}});assert.equal(updated.updated,true);assert.equal(m.saves.at(-1).state.owner.deepseek.manualFunded,true);
 const bad=memory({...c,singleConcurrency:false});assert.equal((await bad.handler(event(c,'/api/donations/options',undefined,'GET'))).statusCode,503);
});

test('completed speech survives cold restart and fresh request ID replays encrypted audio without another paid call',async()=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;
 const audio=Buffer.from('synthetic-audio-cold-replay');const m=memory(c,async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;return {ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>audio.buffer.slice(audio.byteOffset,audio.byteOffset+audio.byteLength)};});
 const s=JSON.parse((await m.handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body);
 const reply=JSON.parse((await m.handler(event(c,'/api/campaign/briefing',{sessionId:s.sessionId,outletId:s.desks[0].outletId}))).body);
 const request=event(c,'/api/speak',{sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:reply.replyId,performance:'theatrical'});
 const first=await m.handler(request);assert.equal(first.statusCode,200);assert.equal(first.isBase64Encoded,true);assert.equal(first.body,audio.toString('base64'));assert.equal(paid,1);
 assert(!m.stored.body.includes(Buffer.from(audio.toString('base64')))); // Whole snapshot is AES-GCM encrypted.
 const repeated={...request,headers:{...request.headers,'x-request-id':'fresh-action-id'}};
 const again=await m.handler(repeated);assert.equal(again.statusCode,200);assert.equal(again.body,first.body);assert.equal(again.headers['content-type'],'audio/mpeg');assert.equal(paid,1);
 const theft={...request,headers:{...request.headers,'x-visitor-hash':'b'.repeat(64)}};assert.equal((await m.handler(theft)).statusCode,403);assert.equal(paid,1);
});

test('reserved speech after a crash remains blocked across cold restart without another paid call',async()=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;const m=memory(c,async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;m.fail=true;throw new Error('provider timeout with lost persistence');});
 const s=JSON.parse((await m.handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body),reply=JSON.parse((await m.handler(event(c,'/api/campaign/briefing',{sessionId:s.sessionId,outletId:s.desks[0].outletId}))).body);
 const request=event(c,'/api/speak',{sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:reply.replyId,performance:'calm'});
 assert.equal((await m.handler(request)).statusCode,503);m.fail=false;
 const repeat={...request,headers:{...request.headers,'x-request-id':'different-retry-id'}};assert.equal((await m.handler(repeat)).statusCode,409);assert.equal(paid,1);
});
