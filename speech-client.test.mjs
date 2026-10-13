import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {onlinePage} from './online-page.mjs';
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const context=vm.createContext({Date,Map,Error,Blob});
vm.runInContext(html.split('// SPEECH_MEMORY_CACHE_START')[1].split('// SPEECH_MEMORY_CACHE_END')[0],context);
const create=context.createSpeechMemoryCache;
test('replaying a loaded briefing keeps its server reply and avoids another registration request',async()=>{
  let posted=0,played=0;const saved={replyId:'approved-reply',paragraphs:[{text:'Reviewed script'}]};
  const replay=vm.createContext({live:true,overviewReplies:{desk:saved},$:()=>null,voiceStatus:()=>{},toast:()=>{},post:async()=>{posted++;throw Error('must reuse')},speak:async r=>{assert.equal(r.replyId,saved.replyId);assert.deepEqual(r.paragraphs,saved.paragraphs);played++}});
  vm.runInContext(html.slice(html.indexOf('async function playBriefing('),html.indexOf('\nasync function ask(')),replay);
  await replay.playBriefing({paragraphs:saved.paragraphs},{outletId:'desk'});
  await replay.playBriefing({paragraphs:saved.paragraphs},{outletId:'desk'});
  assert.equal(posted,0);assert.equal(played,2);
});
test('replay and simultaneous clicks reuse one audio request; text/voice/style identities separate buffers',async()=>{
  const cache=create();let requests=0;
  const load=async()=>{requests++;await Promise.resolve();return new Blob(['sound'],{type:'audio/mpeg'})};
  const [a,b]=await Promise.all([cache.get('exact-text-actor-style',load),cache.get('exact-text-actor-style',load)]);
  assert.equal(a,b);assert.equal(await cache.get('exact-text-actor-style',load),a);assert.equal(requests,1);
  for(const key of ['changed-text','changed-voice','changed-style'])await cache.get(key,load);
  assert.equal(requests,4);
});
test('private page memory expires and evicts within byte/entry limits',async()=>{
  let time=0;const cache=create({clock:()=>time,maxBytes:8,maxEntries:2});
  const load=()=>Promise.resolve(new Blob(['1234'],{type:'audio/mpeg'}));
  await cache.get('a',load);await cache.get('b',load);await cache.get('c',load);
  assert.equal(cache.peek('a'),null);assert(cache.peek('b'));time=20*60000;assert.equal(cache.peek('b'),null);assert.equal(cache.peek('c'),null);
});
test('failed or invalid audio is never reused and does not start automatic retries',async()=>{
  const cache=create();let calls=0;
  await assert.rejects(cache.get('bad',async()=>{calls++;throw Error('failed')}));
  assert.equal(calls,1);assert.equal(cache.peek('bad'),null);
  await assert.rejects(cache.get('bad',async()=>{calls++;return new Blob(['json'],{type:'application/json'})}));
  assert.equal(calls,2);assert.equal(cache.peek('bad'),null);
});
test('online page omits all embedded raster bytes while preserving full records and image licences',async()=>{
  const manifest=JSON.parse(await readFile(new URL('./assets/media-credits.json',import.meta.url),'utf8'));
  const online=onlinePage(html,manifest),extract=s=>JSON.parse(s.match(/<script id="campaign-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const source=extract(html),web=extract(online);
  assert.equal(web.length,6);assert.equal(web.reduce((n,c)=>n+c.allHeadlines.length,0),152);
  assert(Buffer.byteLength(online)<Buffer.byteLength(html)*0.15);
  assert.equal(web.flatMap(c=>c.images).length,12);
  for(let c=0;c<web.length;c++)for(let i=0;i<web[c].images.length;i++){
    assert.match(web[c].images[i].url,/^\/assets\/images\//);
    assert.deepEqual({...web[c].images[i],url:source[c].images[i].url},source[c].images[i]);
  }
  assert(source.flatMap(c=>c.images).every(i=>i.url.startsWith('data:image/')));
});
