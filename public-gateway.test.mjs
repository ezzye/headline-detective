import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {createPublicGateway} from './public-gateway.mjs';import {DONOR_CONSENT_VERSION} from './donor-pool.mjs';
export const config=()=>({singleConcurrency:true,publicOrigin:'https://codingforjustice.org.uk',gatewayToken:'synthetic-bridge-token-'.repeat(3),env:{...Object.fromEntries(['A','B','C','D'].map(x=>['ELEVENLABS_VOICE_'+x,'stock-'+x]))}});
const headers=c=>({'x-gateway-token':c.gatewayToken,origin:c.publicOrigin,'x-visitor-hash':'a'.repeat(64),'content-type':'application/json'});
const parsed=r=>JSON.parse(r.body);
async function setup(t,extras={}) {const dir=await mkdtemp(path.join(await realpath(tmpdir()),'gateway-tests-')),c=config();let saves=0;const gateway=createPublicGateway({config:c,storagePath:path.join(dir,'vault.sqlite'),masterKey:randomBytes(32),persist:async()=>{saves++;},...extras});t.after(async()=>{gateway.close();await rm(dir,{recursive:true,force:true});});return {gateway,c,saves:()=>saves,call:(route,body,method='POST',extra={})=>gateway.handle({method,path:route,headers:{...headers(c),...extra},body:body===undefined?'':JSON.stringify(body)})};}
const donation=()=>({provider:'deepseek',model:'deepseek-flash',apiKey:'sk-'+randomBytes(24).toString('hex'),mode:'prepaid_remaining',remainingUnits:100000,maxCalls:10,expiresAt:new Date(Date.now()+86400000).toISOString(),consent:true,consentVersion:DONOR_CONSENT_VERSION});
const session=async call=>parsed(await call('/api/campaign/session',{caseId:'arday-2026-campaign'}));
const reply='We defend scrutiny when a documented development adds public understanding, while accepting that a legitimate question does not make every repetition proportionate. Our argument needs to explain the specific information this item contributes. The strongest challenge is that personal exposure can continue after the institutional point has been made. We should examine the documented context and response before defending that choice. The source record allows us to discuss the published reporting and its chronology; it does not establish private editorial motives or a causal account of harm. You are entitled to question our framing and ask what a less intrusive account would lose.';
function providerResult(opts){const req=JSON.parse(opts.body),packet=JSON.parse(req.messages[1].content);return {ok:true,status:200,json:async()=>({usage:{total_tokens:20},choices:[{message:{content:JSON.stringify({reply,evidenceIds:[packet.evidence[0].id]})}}]})};}

test('bridge authentication, exact HTTPS origin, fixed routes, visitor hash and body bounds fail closed',async t=> {
 const {gateway,c,call}=await setup(t);assert.equal((await call('/api/donations/options',undefined,'GET',{'x-gateway-token':'wrong'})).status,403);
 assert.equal((await call('/api/donations/options',undefined,'GET',{origin:'https://evil.invalid'})).status,403);assert.equal((await call('/api/donations/options',undefined,'GET',{'x-visitor-hash':'raw-ip'})).status,403);
 assert.equal((await call('/api/relay',{},'POST')).status,404);assert.equal((await call('/api/respond',undefined,'GET')).status,405);
 assert.equal((await gateway.handle({method:'POST',path:'/api/donations',headers:headers(c),body:'x'.repeat(16385)})).status,413);
 assert.equal((await call('/api/donations',{},'POST',{'content-type':'text/plain'})).status,415);
});
test('public donations enforce exact model, consent and schema; one-time withdrawal token and safe statuses',async t=> {
 const {call}=await setup(t);const bad=donation();bad.model='arbitrary';assert.equal((await call('/api/donations',bad)).status,400);
 const extra=donation();extra.url='https://evil.invalid';assert.equal((await call('/api/donations',extra)).status,400);
 const d=donation(),created=await call('/api/donations',d),out=parsed(created);assert.equal(created.status,201);assert.ok(out.donationId&&out.revocationToken);assert(!created.body.includes(d.apiKey));
 const pub=await call('/api/donations/status',undefined,'GET');assert(!pub.body.includes(out.revocationToken));assert(!pub.body.includes(d.apiKey));
 const mine=parsed(await call('/api/donations/status',{revokeToken:out.revocationToken,donationId:out.donationId}));assert.equal(mine.remainingUnits,100000);
 assert.equal((await call('/api/donations/revoke',{revokeToken:out.revocationToken})).status,200);assert.equal(parsed(await call('/api/donations/status',{revocationToken:out.revocationToken})).status,'revoked');
});
test('donor reservation is durable before paid fetch and depleted pool falls back without leaked provider errors',async t=> {
 const events=[];const {call,gateway}=await setup(t,{persist:async()=>{events.push('save');},fetchImpl:async(url,opts)=>{if(url.endsWith('/user/balance')){assert.equal(events.at(-1),'save');return {ok:true,json:async()=>({is_available:true})};}assert.equal(events.at(-1),'save');events.push('paid');return providerResult(opts);}});
 await call('/api/donations',donation());const s=await session(call);const out=parsed(await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'}));assert.equal(out.mode,'deepseek');assert(events.includes('paid'));assert.equal(gateway.pool.status().providers[0].monthlyUnits,20);
 assert.equal((await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'stolen session'},'POST',{'x-visitor-hash':'b'.repeat(64)})).status,403);
});
test('owner DeepSeek prepaid funding flag permits use with no invented token cap and debits persisted usage',async t=> {
 const c=config();c.env.DEEPSEEK_API_KEY='owner-synthetic';const events=[];const {call,gateway}=await setup(t,{config:c,persist:async()=>events.push('save'),fetchImpl:async(url,opts)=>{if(url.endsWith('/user/balance'))return {ok:true,json:async()=>({is_available:true})};assert.equal(events.at(-1),'save');events.push('paid');return providerResult(opts);}});
 const s=await session(call),out=parsed(await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'}));assert.equal(out.mode,'deepseek');assert.equal(gateway.state.owner.deepseek.usedUnits,20);assert.equal(gateway.state.owner.deepseek.remainingUnits,0);
});
test('unknown owner funding and reservation persistence failure never cause paid calls',async t=> {
 const c=config();c.env.DEEPSEEK_API_KEY='owner-synthetic';let paid=0,failSave=false;
 const {call}=await setup(t,{config:c,persist:async()=>{if(failSave)throw new Error('storage down');},fetchImpl:async(url,opts)=>{if(url.endsWith('/user/balance'))throw new Error('raw-secret-error');paid++;return providerResult(opts);}});
 const s=await session(call);failSave=true;const out=await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'});assert.equal(paid,0);assert(!out.body.includes('raw-secret-error'));assert.equal(out.status,503);
});
test('owner uncertain failure is conservatively charged and never swapped to a donor',async t=> {
 const c=config();c.env.DEEPSEEK_API_KEY='owner-synthetic';let calls=0;const {call,gateway}=await setup(t,{config:c,fetchImpl:async(url)=>{if(url.endsWith('/user/balance'))return {ok:true,json:async()=>({is_available:true})};calls++;throw new Error('timeout including owner-synthetic');}});
 await call('/api/donations',donation());const s=await session(call),out=await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'});assert.equal(calls,1);assert(gateway.state.owner.deepseek.usedUnits>20);assert.equal(gateway.pool.status().providers[0].monthlyCalls,0);assert(!out.body.includes('owner-synthetic'));
});

test('owner insufficient-credit response pauses that key and swaps to a capped donor',async t=> {
 const c=config();c.env.DEEPSEEK_API_KEY='owner-synthetic';let calls=0;const {call,gateway}=await setup(t,{config:c,fetchImpl:async(url,opts)=>{if(url.endsWith('/user/balance'))return {ok:true,json:async()=>({is_available:true})};calls++;if(opts.headers.authorization==='Bearer owner-synthetic')return {ok:false,status:402};return providerResult(opts);}});
 await call('/api/donations',donation());const s=await session(call),out=parsed(await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'}));assert.equal(out.mode,'deepseek');assert.equal(calls,2);assert.equal(gateway.state.owner.deepseek.status,'unavailable');assert.equal(gateway.pool.status().providers[0].monthlyUnits,20);
});
test('ElevenLabs exact remaining credits prohibit overage; depleted local entitlement never refreshes from stale provider report',async t=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice';let time=Date.now(),paid=0;const {call,gateway}=await setup(t,{config:c,clock:()=>time,fetchImpl:async(url)=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:500,character_count:0,can_extend_character_limit:true})};paid++;return {ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>new Uint8Array([1]).buffer};}});
 const s=await session(call),owner=gateway.app.sessions.get(s.sessionId),id='owned-short-reply';owner.replies.set(id,{outletId:s.desks[0].outletId,text:'We speak this owned answer. '.repeat(17)}); // 475 characters after trimming.
 const body={sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:id,performance:'calm'};
 const first=await call('/api/speak',body);assert.equal(first.status,200,JSON.stringify({body:first.body,owner:gateway.state.owner.elevenlabs,paid}));assert.equal(paid,1);assert.equal(gateway.state.owner.elevenlabs.remainingUnits,25);
 time+=61000;owner.replies.set('new-answer',{outletId:s.desks[0].outletId,text:'We cannot use more characters than the remaining prepaid allowance.'});
 assert.equal((await call('/api/speak',{...body,replyId:'new-answer'})).status,502);assert.equal(paid,1);assert.equal(gateway.state.owner.elevenlabs.remainingUnits,25);
});

test('health and donation options expose nonsecret readiness and compatible model/provider fields',async t=> {
 const c=config();c.env.DEEPSEEK_API_KEY='owner-secret-not-public';const {call}=await setup(t,{config:c});
 const health=await call('/api/health',undefined,'GET');assert.equal(health.status,200);assert.equal(parsed(health).enabled,true);assert.equal(parsed(health).models.elevenlabs,'eleven_v3');assert(!health.body.includes(c.env.DEEPSEEK_API_KEY));
 const options=parsed(await call('/api/donations/options',undefined,'GET'));assert.equal(options.enabled,true);assert.deepEqual(options.models,{deepseek:'deepseek-flash',elevenlabs:'eleven_v3'});assert.equal(options.providers.length,2);
});

test('durable audio cache enforces per-item and total stored size, safe headers, and fixed TTL',async t=> {
 const {AUDIO_CACHE_LIMITS}=await import('./public-gateway.mjs');let time=Date.now();const audio=Buffer.alloc(900000,65),entries={};
 for(let i=0;i<30;i++)entries[i.toString(16).padStart(64,'0')]={cacheClass:'dynamic',createdAt:time-1000-i,lastUsedAt:time-1000-i,dataBytes:audio.length,result:{body:audio.toString('base64'),headers:{'set-cookie':'malicious-cookie','location':'https://evil.invalid'}}};
 const tooLarge=Buffer.alloc(AUDIO_CACHE_LIMITS.maxItemBytes+1,66);entries['a'.repeat(64)]={cacheClass:'dynamic',createdAt:time,dataBytes:tooLarge.length,result:{body:tooLarge.toString('base64')}};
 entries['b'.repeat(64)]={cacheClass:'dynamic',createdAt:time-AUDIO_CACHE_LIMITS.ttlMs,dataBytes:1,result:{body:'QQ=='}};
 entries['c'.repeat(64)]={cacheClass:'dynamic',createdAt:time,dataBytes:100,result:{body:'QQ=='}};
 const {gateway}=await setup(t,{clock:()=>time,state:{audioCache:entries}});
 assert.equal(gateway.state.audioCache['a'.repeat(64)],undefined);assert.equal(gateway.state.audioCache['b'.repeat(64)],undefined);assert.equal(gateway.state.audioCache['c'.repeat(64)],undefined);
 assert(gateway.state.audioCacheBytes<=AUDIO_CACHE_LIMITS.maxStoredBytes);assert(Object.keys(gateway.state.audioCache).length<30);
 assert.equal(gateway.state.audioCache[(29).toString(16).padStart(64,'0')],undefined);assert.equal(gateway.state.audioCache[(0).toString(16).padStart(64,'0')].result.headers['set-cookie'],undefined);assert.equal(gateway.state.audioCache[(0).toString(16).padStart(64,'0')].result.headers.location,undefined);assert.equal(gateway.state.audioCache[(0).toString(16).padStart(64,'0')].result.headers['content-type'],'audio/mpeg');
 time+=AUDIO_CACHE_LIMITS.ttlMs;await gateway.save();assert.equal(Object.keys(gateway.state.audioCache).length,0);assert.equal(gateway.state.audioCacheBytes,0);
});

test('approved briefing audio is content-addressed across visitors and survives a cold gateway start',async t=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0,time=Date.now();
 const audio=Buffer.from('approved-briefing-audio');
 const fetchImpl=async(url)=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;return {ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>audio.buffer.slice(audio.byteOffset,audio.byteOffset+audio.byteLength)};};
 let randomCalls=0;const deterministicRandom=()=>{const value=randomCalls<3?0.5:0.99;randomCalls++;return value;};
 const first=await setup(t,{config:c,clock:()=>time,fetchImpl,random:deterministicRandom});
 const original=await session(first.call);assert.deepEqual(original.speechProfile,{model:'eleven_v3',directionVersion:'voice-direction-v1',cacheVersion:'cfj-speech-v2',format:'mp3_44100_64'});const script=parsed(await first.call('/api/campaign/briefing',{sessionId:original.sessionId,outletId:original.desks[0].outletId}));
 const speak=(call,s,reply,visitor,cacheOnly=false,outletId=s.desks[0].outletId)=>call('/api/speak',{sessionId:s.sessionId,outletId,kind:'reply',replyId:reply.replyId,performance:'calm',...(cacheOnly?{cacheOnly:true}:{})},'POST',visitor?{'x-visitor-hash':visitor}:{});
 assert.equal((await speak(first.call,original,script,undefined,true)).status,404);assert.equal(paid,0,'cache-only misses never dispatch paid calls');
 assert.equal((await speak(first.call,original,script)).status,200);assert.equal(paid,1);
 const visitorB='b'.repeat(64),other=await session((route,body)=>first.call(route,body,'POST',{'x-visitor-hash':visitorB}));
 let otherScript,otherOutlet;
 for(const desk of other.desks){const candidate=parsed(await first.call('/api/campaign/briefing',{sessionId:other.sessionId,outletId:desk.outletId},'POST',{'x-visitor-hash':visitorB}));if(candidate.reply===script.reply){otherScript=candidate;otherOutlet=desk.outletId;break;}}
 assert(otherScript,'second session keeps the same reviewed briefing under its shuffled desk assignment');assert.equal((await speak(first.call,other,otherScript,visitorB,false,otherOutlet)).body,audio.toString('base64'));assert.equal(paid,1);
 assert.equal((await speak(first.call,original,script,visitorB)).status,403,'a cache hit still requires session ownership');
 const restartDir=await mkdtemp(path.join(await realpath(tmpdir()),'gateway-restart-'));
 const restored=createPublicGateway({config:c,storagePath:path.join(restartDir,'vault.sqlite'),masterKey:randomBytes(32),state:structuredClone(first.gateway.state),persist:async()=>{},clock:()=>time,fetchImpl,random:deterministicRandom});
 t.after(async()=>{restored.close();await rm(restartDir,{recursive:true,force:true});});
 const visitorC='c'.repeat(64),callC=(route,body,method='POST')=>restored.handle({method,path:route,headers:{...headers(c),'x-visitor-hash':visitorC},body:body===undefined?'':JSON.stringify(body)});
 time+=31*24*60*60*1000;
 const third=await session(callC);let thirdScript,thirdOutlet;
 for(const desk of third.desks){const candidate=parsed(await callC('/api/campaign/briefing',{sessionId:third.sessionId,outletId:desk.outletId}));if(candidate.reply===script.reply){thirdScript=candidate;thirdOutlet=desk.outletId;break;}}
 assert(thirdScript,'cold session keeps the same reviewed briefing under its shuffled desk assignment');
 assert.equal((await speak(callC,third,thirdScript,undefined,true,thirdOutlet)).body,audio.toString('base64'));assert.equal(paid,1,'fixed script survives cold restart and age beyond a month without a provider call');
});

test('cache pressure evicts dynamic audio before fixed reviewed recordings',async t=> {
 const now=Date.now(),audio=Buffer.alloc(1024*1024,65),entries={};
 for(let i=0;i<5;i++)entries[(100+i).toString(16).padStart(64,'0')]={cacheClass:'fixed',createdAt:now-1000-i,lastUsedAt:now-1000-i,dataBytes:audio.length,result:{body:audio.toString('base64')}};
 for(let i=0;i<20;i++)entries[(200+i).toString(16).padStart(64,'0')]={cacheClass:'dynamic',createdAt:now-1000-i,lastUsedAt:now-1000-i,dataBytes:audio.length,result:{body:audio.toString('base64')}};
 const {gateway}=await setup(t,{state:{audioCache:entries}});
 for(let i=0;i<5;i++)assert(gateway.state.audioCache[(100+i).toString(16).padStart(64,'0')]);assert(Object.keys(gateway.state.audioCache).length<25);
});

test('speech cache identity changes with text, voice, model, performance, settings, or dynamic ownership',async()=> {
 const {speechCacheKey}=await import('./public-gateway.mjs');
 const base={text:'A server-saved script.',voiceId:'voice-a',model:'eleven_v3',performance:'calm',voiceSettings:{stability:0.9,similarity_boost:0.75,use_speaker_boost:false},cacheClass:'fixed'};
 const key=value=>speechCacheKey({...base,...value});const original=key({});
 for(const change of [{text:'A changed script.'},{voiceId:'voice-b'},{model:'eleven_flash_v2_5'},{performance:'theatrical'},{voiceSettings:{...base.voiceSettings,stability:0.5}}])assert.notEqual(key(change),original);
 assert.equal(key({visitor:'a'.repeat(64),sessionId:'one',replyId:'first'}),key({visitor:'b'.repeat(64),sessionId:'two',replyId:'second'}),'fixed content is shared independently of session identity');
 const dynamic=value=>speechCacheKey({...base,cacheClass:'dynamic',visitor:'a'.repeat(64),sessionId:'one',outletId:'desk-a',replyId:'reply-1',...value});
 assert.notEqual(dynamic({visitor:'b'.repeat(64)}),dynamic({}));assert.notEqual(dynamic({sessionId:'two'}),dynamic({}));
});

test('failed speech dispatch never creates a durable audio cache entry',async t=> {
 const c=config();c.env.ELEVENLABS_API_KEY='owner-voice-synthetic';let paid=0;
 const {call,gateway}=await setup(t,{config:c,fetchImpl:async url=>{if(url.endsWith('/user/subscription'))return {ok:true,json:async()=>({character_limit:100000,character_count:0})};paid++;return {ok:false,status:503};}});
 const s=await session(call),briefing=parsed(await call('/api/campaign/briefing',{sessionId:s.sessionId,outletId:s.desks[0].outletId}));
 const body={sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:briefing.replyId,performance:'calm'};
 assert.equal((await call('/api/speak',body)).status,502);assert.equal(paid,1);assert.equal(Object.keys(gateway.state.audioCache).length,0);
 assert.equal((await call('/api/speak',body)).status,502);assert.equal(paid,1,'failed result replays without cached audio or another paid call');
});

test('completed legacy speech marker from before durable cache rollout still prevents charging the same retry',async t=> {
 const {createHash}=await import('node:crypto');let paid=0;const {call,gateway}=await setup(t,{fetchImpl:async()=>{paid++;throw new Error('must not call');}});
 const s=await session(call),id='legacy-owned-answer';gateway.app.sessions.get(s.sessionId).replies.set(id,{outletId:s.desks[0].outletId,text:'We defend only this source-bound reply.'});
 const body={sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:id,performance:'calm'};
 const oldId=createHash('sha256').update('a'.repeat(64)+'|/api/speak||'+JSON.stringify(body)).digest('hex');gateway.state.requests[oldId]={createdAt:Date.now(),status:'completed'};
 assert.equal((await call('/api/speak',body)).status,409);assert.equal(paid,0);
});

test('unfunded DeepSeek donor keys pause and at most one alternative is checked without any paid POST',async t=> {
 let reads=0,paid=0;const {call,gateway}=await setup(t,{config:{...config(),donorCaps:{deepseek:{dailyCalls:100,monthlyCalls:1000,dailyUnits:200000,monthlyUnits:1000000},elevenlabs:{dailyCalls:100,monthlyCalls:1000,dailyUnits:30000,monthlyUnits:300000}}},fetchImpl:async(url,opts)=>{if(opts.method==='POST'){paid++;throw new Error('must not pay');}assert.equal(url,'https://api.deepseek.com/user/balance');reads++;assert(gateway.pool.status().providers[0].reservedCalls>0);return {ok:true,json:async()=>({is_available:false})};}});
 const first=parsed(await call('/api/donations',donation())),second=parsed(await call('/api/donations',donation())),s=await session(call);
 const out=parsed(await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'}));
 assert.equal(out.mode,'offline');assert.equal(reads,2);assert.equal(paid,0);assert.equal(gateway.pool.status(first.revocationToken).status,'paused');assert.equal(gateway.pool.status(second.revocationToken).status,'paused');
});

test('unknown or failed DeepSeek donor balance stops paid dispatch without an uncertain key swap',async t=> {
 for(const scenario of ['shape','rate-limit','transport']) await t.test(scenario,async child=>{
  let reads=0,paid=0;const {call,gateway}=await setup(child,{fetchImpl:async(_url,opts)=>{if(opts.method==='POST'){paid++;throw new Error('must not pay');}reads++;if(scenario==='transport')throw new Error('raw private balance failure');if(scenario==='rate-limit')return {ok:false,status:429};return {ok:true,json:async()=>({is_available:'true'})};}});
  const first=parsed(await call('/api/donations',donation()));await call('/api/donations',donation());const s=await session(call),out=await call('/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Why should we care?'});
  assert.equal(parsed(out).mode,'offline');assert.equal(reads,1);assert.equal(paid,0);assert(!out.body.includes('raw private'));assert.equal(gateway.pool.status(first.revocationToken).status,'active');
 });
});
const voiceDonation=()=>({...donation(),provider:'elevenlabs',model:'eleven_v3',apiKey:'synthetic-elevenlabs-'+randomBytes(20).toString('hex')});
async function ownedSpeech(call,gateway) {const s=await session(call),id='preflight-owned-reply';gateway.app.sessions.get(s.sessionId).replies.set(id,{outletId:s.desks[0].outletId,text:'We should explain this editorial choice and its documented limits before defending it.'});return {sessionId:s.sessionId,outletId:s.desks[0].outletId,kind:'reply',replyId:id,performance:'calm'};}

test('ElevenLabs donor insufficient actual prepaid characters rejects overage and pauses the key',async t=> {
 let reads=0,paid=0;const {call,gateway}=await setup(t,{fetchImpl:async(url,opts)=>{if(opts.method==='POST'){paid++;throw new Error('must not pay');}assert.equal(url,'https://api.elevenlabs.io/v1/user/subscription');reads++;return {ok:true,json:async()=>({character_limit:100,character_count:99,can_extend_character_limit:true,allow_character_count_exceeded:true})};}});
 const donor=parsed(await call('/api/donations',voiceDonation())),body=await ownedSpeech(call,gateway),out=await call('/api/speak',body);
 assert.equal(out.status,502);assert.equal(reads,1);assert.equal(paid,0);assert.equal(gateway.pool.status(donor.revocationToken).status,'paused');
});

test('ElevenLabs donor known allowance is checked after durable reservation and before paid dispatch; cached replay makes no reads',async t=> {
 let reads=0,paid=0;const input=voiceDonation(),events=[];const {call,gateway}=await setup(t,{persist:async()=>events.push('save'),fetchImpl:async(url,opts)=>{
  assert.equal(opts.headers['xi-api-key'],input.apiKey);assert.equal(opts.redirect,'error');
  if(opts.method==='GET'){assert.equal(url,'https://api.elevenlabs.io/v1/user/subscription');assert.equal(events.at(-1),'save');assert(gateway.pool.status().providers[1].reservedCalls>0);reads++;return {ok:true,json:async()=>({character_limit:1000,character_count:10})};}
  assert.equal(reads,1);paid++;return {ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
 }});
 await call('/api/donations',input);const body=await ownedSpeech(call,gateway);assert.equal((await call('/api/speak',body)).status,200);assert.equal(paid,1);assert.equal(reads,1);
 assert.equal((await call('/api/speak',body)).status,200);assert.equal(paid,1);assert.equal(reads,1);
});

test('ElevenLabs donor unknown subscription refuses paid use and does not try another key',async t=> {
 let reads=0,paid=0;const {call,gateway}=await setup(t,{fetchImpl:async(_url,opts)=>{if(opts.method==='POST'){paid++;throw new Error('must not pay');}reads++;return {ok:true,json:async()=>({character_limit:1000})};}});
 await call('/api/donations',voiceDonation());await call('/api/donations',voiceDonation());const body=await ownedSpeech(call,gateway);assert.equal((await call('/api/speak',body)).status,502);assert.equal(reads,1);assert.equal(paid,0);
});
