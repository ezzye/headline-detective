import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {createLambdaHandler,openSnapshot,sealSnapshot,openAudioCache,sealAudioCache} from './lambda-handler.mjs';
const config=()=>({singleConcurrency:true,publicOrigin:'https://codingforjustice.org.uk',gatewayToken:'synthetic-bridge-token-'.repeat(3),masterKey:randomBytes(32).toString('hex'),env:{...Object.fromEntries(['A','B','C','D'].map(x=>['ELEVENLABS_VOICE_'+x,'stock-'+x]))}});
const event=(c,path,body,method='POST')=>({version:'2.0',rawPath:path,requestContext:{http:{method}},headers:{origin:c.publicOrigin,'x-gateway-token':c.gatewayToken,'x-visitor-hash':'a'.repeat(64),'content-type':'application/json'},body:body===undefined?'':JSON.stringify(body)});
function memory(c,fetchImpl,external=false) {let stored=null,version=0,fail=false,failAudioPut=false,audioGets=0;const saves=[],audioObjects=new Map();return {get stored(){return stored;},set stored(value){stored=value;version=0;},get saves(){return saves;},get audioGets(){return audioGets;},audioObjects,set fail(value){fail=value;},set failAudioPut(value){failAudioPut=value;},handler:createLambdaHandler({loadConfig:async()=>c,loadSnapshot:async()=>stored,saveSnapshot:async(body,{etag})=>{if(fail)throw new Error('S3 unavailable');assert.equal(etag,stored?.etag || null);stored={body,etag:'v'+(++version)};saves.push(openSnapshot(body,Buffer.from(c.masterKey,'hex')));return {etag:stored.etag};},...(external?{audioStorageFactory:({key})=>({get:async hash=>{audioGets++;const blob=audioObjects.get(hash);return blob?openAudioCache(blob,key,hash):null;},put:async(hash,bytes)=>{if(failAudioPut)throw new Error('object storage unavailable');audioObjects.set(hash,sealAudioCache(bytes,key,hash));},delete:async hash=>audioObjects.delete(hash)})}:{}),fetchImpl})};}
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

test('IAM voice preparation uses only reviewed briefings, stays capped and is idempotent',async()=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;const audio=Buffer.from('reviewed-audio');
 const m=memory(c,async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;return {ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>audio.buffer.slice(audio.byteOffset,audio.byteOffset+audio.byteLength)};});
 const request={batchId:'warm-reviewed-2026-10',performance:'theatrical',items:[{caseId:'arday-2026-campaign',campaignIndex:0},{caseId:'arday-2026-campaign',campaignIndex:1}]};
 const first=await m.handler({action:'prepare-reviewed-voice',request});assert.equal(first.status,'running');assert.equal(first.nextIndex,1);assert.equal(first.calls,1);assert(first.characters>0&&first.characters<28000);assert.equal(first.items[0].status,'cached');assert.equal(paid,1);
 const second=await m.handler({action:'prepare-reviewed-voice',request});assert.equal(second.status,'complete');assert.equal(second.calls,2);assert.equal(second.items[1].status,'cached');assert.equal(paid,2,'at most one paid synthesis runs in each Lambda invocation');
 const again=await m.handler({action:'prepare-reviewed-voice',request});assert.deepEqual(again,second);assert.equal(paid,2,'a repeated IAM batch cannot dispatch a second paid call');
 const spoof=event(c,'/api/donations/options',undefined,'GET');spoof.action='prepare-reviewed-voice';spoof.request={...request,batchId:'spoofed-warmup-2026'};assert.equal((await m.handler(spoof)).statusCode,200);assert.equal(paid,2,'HTTP action fields cannot invoke maintenance');
 const oversized=await m.handler({action:'prepare-reviewed-voice',request:{batchId:'too-many-briefings',items:Array.from({length:21},(_,i)=>({caseId:'arday-2026-campaign',campaignIndex:i%4}))}});assert.equal(oversized.statusCode,503);assert.equal(paid,2,'oversized input fails before provider dispatch');
 assert.equal(m.saves.at(-1).state.voiceWarmup.calls,2);assert.equal(m.saves.at(-1).state.voiceWarmup.characters,second.characters);
});

test('uncertain IAM voice reservation pauses for review without an automatic second paid call',async()=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;
 const m=memory(c,async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;throw new Error('provider timeout');});
 const request={batchId:'warm-review-timeout',performance:'theatrical',items:[{caseId:'arday-2026-campaign',campaignIndex:0}]};
 const first=await m.handler({action:'prepare-reviewed-voice',request});assert.equal(first.status,'needs_review');assert.equal(first.calls,1);assert.equal(paid,1);
 const again=await m.handler({action:'prepare-reviewed-voice',request});assert.equal(again.status,'needs_review');assert.equal(again.items[0].status,'needs_review');assert.equal(paid,1);
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

test('fixed briefing audio is separately encrypted, survives a cold start, and is fetched only after ownership checks',async()=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;const audio=Buffer.from('fixed-audio-external');const m=memory(c,async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;return {ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>audio.buffer.slice(audio.byteOffset,audio.byteOffset+audio.byteLength)};},true);
 const s=JSON.parse((await m.handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body),reply=JSON.parse((await m.handler(event(c,'/api/campaign/briefing',{sessionId:s.sessionId,outletId:s.desks[0].outletId}))).body),body={sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:reply.replyId,performance:'theatrical'};
 const first=await m.handler(event(c,'/api/speak',body));assert.equal(first.statusCode,200);assert.equal(paid,1);const key=Object.keys(m.saves.at(-1).state.audioCache)[0],entry=m.saves.at(-1).state.audioCache[key];assert.equal(entry.external,true);assert.equal(entry.result,undefined);assert.equal(m.audioObjects.has(key),true);
 assert.throws(()=>openAudioCache(m.audioObjects.get(key),Buffer.from(c.masterKey,'hex'),'f'.repeat(64)));
 const unauthorized={...event(c,'/api/speak',body),headers:{...event(c,'/api/speak',body).headers,'x-visitor-hash':'b'.repeat(64)}};const before=m.audioGets;assert.equal((await m.handler(unauthorized)).statusCode,403);assert.equal(m.audioGets,before,'unauthorized access never loads the object');
 const again=await m.handler(event(c,'/api/speak',body));assert.equal(again.statusCode,200);assert.equal(again.body,audio.toString('base64'));assert.equal(paid,1);assert.equal(m.audioObjects.size,1);assert.equal(m.audioGets,before+1);
 const hash=key,blob=m.audioObjects.get(hash);m.audioObjects.set(hash,Buffer.from('tampered'));const tampered=await m.handler(event(c,'/api/speak',body));assert.equal(tampered.statusCode,503);assert.equal(paid,1);m.audioObjects.set(hash,blob);
});

test('IAM audio migration moves fixed inline bytes without changing warmup meters',async()=> {
 const c=config(),m=memory(c,async()=>{throw new Error('no provider calls');},true),hash='c'.repeat(64),audio=Buffer.from('already-paid-reviewed-audio'),now=Date.now();
 const state={audioCache:{[hash]:{cacheClass:'fixed',createdAt:now,lastUsedAt:now,dataBytes:audio.length,result:{body:audio.toString('base64')}}},voiceWarmup:{calls:20,characters:27131,batchId:'existing-approved-batch',status:'complete',items:[]},owner:{elevenlabs:{remainingUnits:1234,usedUnits:27131,reservedCalls:20}}};
 m.stored={body:sealSnapshot({state},Buffer.from(c.masterKey,'hex')),etag:'seed'};
 const result=await m.handler({action:'migrate-audio-cache'});assert.deepEqual(result,{migrated:1,bytes:audio.length,remainingInline:0,calls:20,characters:27131});assert.equal(m.audioObjects.size,1);assert.equal(m.saves.at(-1).state.audioCache[hash].result,undefined);assert.equal(m.saves.at(-1).state.voiceWarmup.characters,27131);assert.equal(m.saves.at(-1).state.owner.elevenlabs.remainingUnits,1234);
 assert.equal(openAudioCache(m.audioObjects.get(hash),Buffer.from(c.masterKey,'hex'),hash).toString(),audio.toString());
 const spoof=event(c,'/api/donations/options',undefined,'GET');spoof.action='migrate-audio-cache';assert.equal((await m.handler(spoof)).statusCode,200);
});

test('failed external cache write keeps speech reserved and prevents a second paid synthesis',async()=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;const audio=Buffer.from('synthetic-audio');const m=memory(c,async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;return {ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>audio.buffer.slice(audio.byteOffset,audio.byteOffset+audio.byteLength)};},true);
 const s=JSON.parse((await m.handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body),reply=JSON.parse((await m.handler(event(c,'/api/campaign/briefing',{sessionId:s.sessionId,outletId:s.desks[0].outletId}))).body),request=event(c,'/api/speak',{sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:reply.replyId,performance:'theatrical'});
 m.failAudioPut=true;assert.equal((await m.handler(request)).statusCode,503);assert.equal(paid,1);m.failAudioPut=false;const retry={...request,headers:{...request.headers,'x-request-id':'different-retry-id'}};assert.equal((await m.handler(retry)).statusCode,409);assert.equal(paid,1);
});

test('reserved speech after a crash remains blocked across cold restart without another paid call',async()=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;const m=memory(c,async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;m.fail=true;throw new Error('provider timeout with lost persistence');});
 const s=JSON.parse((await m.handler(event(c,'/api/campaign/session',{caseId:'arday-2026-campaign'}))).body),reply=JSON.parse((await m.handler(event(c,'/api/campaign/briefing',{sessionId:s.sessionId,outletId:s.desks[0].outletId}))).body);
 const request=event(c,'/api/speak',{sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:reply.replyId,performance:'calm'});
 assert.equal((await m.handler(request)).statusCode,503);m.fail=false;
 const repeat={...request,headers:{...request.headers,'x-request-id':'different-retry-id'}};assert.equal((await m.handler(repeat)).statusCode,409);assert.equal(paid,1);
});
