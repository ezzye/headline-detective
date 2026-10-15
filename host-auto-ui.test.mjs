import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';

const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const line=name=>html.split('\n').find(row=>row.startsWith(`function ${name}(`));
const manifest=JSON.parse(await readFile(new URL('./assets/host-audio/welcome-manifest.json',import.meta.url),'utf8'));

test('welcome is an intact prepared file whose identity includes script, voice and direction',async()=>{
  assert.equal(manifest.version,'cfj-host-welcome-v1');
  assert.equal(manifest.clips.length,1);
  const clip=manifest.clips[0];
  assert.equal(clip.digest,createHash('sha256').update(JSON.stringify([manifest.version,manifest.profile,clip.text])).digest('hex'));
  const bytes=await readFile(new URL('.'+clip.src,import.meta.url));
  assert.equal(bytes.length,clip.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),clip.audioSha256);
  assert.equal(manifest.profile.model,'eleven_v3');
  assert.match(manifest.profile.direction,/warmly/);
});

test('welcome validation rejects stale scripts and invalid file paths',async()=>{
  let active=structuredClone(manifest);
  const context=vm.createContext({location:{protocol:'https:'},hostWelcomePromise:null,HOST_WELCOME_VERSION:manifest.version,HOST_WELCOME_TEXT:manifest.clips[0].text,fetch:async()=>({ok:true,json:async()=>active}),AbortSignal,crypto:webcrypto,TextEncoder});
  vm.runInContext(html.split('\n').find(row=>row.startsWith('async function hostWelcomeClip(')),context);
  assert.equal((await context.hostWelcomeClip()).digest,manifest.clips[0].digest);
  context.hostWelcomePromise=null;active.clips[0].text+=' Stale.';
  await assert.rejects(context.hostWelcomeClip(),/script changed/);
  active=structuredClone(manifest);context.hostWelcomePromise=null;active.clips[0].src='/other.mp3';
  await assert.rejects(context.hostWelcomeClip(),/script changed/);
});

function harness(){
  const reads=[],state={index:0,results:{},complete:false},nodes={'[data-host-mute]':{},'[data-host-retry]':{}},buttons=[{}];let muted=false,cancels=0;
  const c=vm.createContext({hostAutomaticArmed:false,hostWelcomeHeard:false,location:{protocol:'https:'},item:{id:'case-a'},automaticHostContext:null,ensureShortChallenge:()=>state,challengeChecks:()=>[{id:'q1'},{id:'q2'}],hostAutoReader:{read:parts=>reads.push(parts),snapshot:()=>({muted}),setMuted:value=>{muted=value;cancels++},cancel:()=>cancels++},hostAudio:{muted:false},paintHostAutomatic(){},primeHostAudio(){},document:{querySelector:selector=>nodes[selector],querySelectorAll:()=>buttons}});
  vm.runInContext(line('readCurrentHost')+'\n'+line('bindHostAutomatic'),c);
  return {c,state,reads,nodes,buttons,get cancels(){return cancels}};
}

test('arrival stays silent; first challenge welcomes then asks, later states read only their part',()=>{
  const h=harness();h.c.readCurrentHost();assert.equal(h.reads.length,0);
  h.c.hostAutomaticArmed=true;h.c.readCurrentHost();assert.deepEqual(Array.from(h.reads[0]),['welcome','question']);
  h.c.hostWelcomeHeard=true;h.state.results.q1={outcome:'correct'};h.c.readCurrentHost();assert.deepEqual(Array.from(h.reads[1]),['feedback']);
  h.state.index=1;h.c.readCurrentHost();assert.deepEqual(Array.from(h.reads[2]),['question']);
  h.state.complete=true;h.c.readCurrentHost();assert.equal(h.reads.length,3);assert.equal(h.cancels,1);
});

test('mute is immediate, cancels pending voice and disables play; unmute reads current state without another welcome',()=>{
  const h=harness();h.c.hostAutomaticArmed=true;h.c.bindHostAutomatic();h.nodes['[data-host-mute]'].onclick();
  assert.equal(h.c.hostAudio.muted,true);assert.equal(h.cancels,1);assert.equal(h.buttons[0].disabled,true);
  h.state.results.q1={outcome:'incorrect'};h.nodes['[data-host-mute]'].onclick();
  assert.equal(h.c.hostAudio.muted,false);assert.equal(h.buttons[0].disabled,false);assert.deepEqual(Array.from(h.reads.at(-1)),['feedback']);
});

test('automatic voice has no visitor generation call and navigation cancels pending playback',()=>{
  const region=html.split('// HOST_VOICE_START')[1].split('// HOST_VOICE_END')[0];
  assert.doesNotMatch(region,/\/api\/speak|api\.elevenlabs|xi-api-key/);
  assert.match(line('stop'),/hostAutoReader.cancel\(\{stop:false\}\)/);
  assert.match(html,/data-host-mute aria-pressed/);
  assert.match(html,/data-host-retry hidden/);
});
