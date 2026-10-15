import test from 'node:test';
import assert from 'node:assert/strict';
import {createComparisonVoicePlayer} from './comparison-player.mjs';

class FakeAudio {
  paused=true; ended=false; currentTime=0; src=''; listeners=new Map(); playCalls=0; pauseCalls=0; loads=0;
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  fire(type){for(const fn of this.listeners.get(type)||[])fn();}
  pause(){this.pauseCalls++;this.paused=true;this.fire('pause');}
  async play(){this.playCalls++;this.paused=false;this.ended=false;this.fire('play');}
  removeAttribute(name){if(name==='src')this.src='';}
  load(){this.loads++;this.ended=false;}
}
const clip=id=>({id,src:`/${id}.mp3`});
const playlist=(id,...ids)=>({id,clips:ids.map(clip)});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function setup(loader=async value=>new Blob([value.id])){
  const audio=new FakeAudio(),loaded=[],created=[],revoked=[],states=[];
  const player=createComparisonVoicePlayer({audio,load:async value=>{loaded.push(value.id);return loader(value);},onState:state=>states.push(state),createURL:blob=>{const url=`blob:${blob.size}:${created.length}`;created.push(url);return url;},revokeURL:url=>revoked.push(url)});
  return{audio,player,loaded,created,revoked,states};
}

test('three segments advance on ended and replay uses loaded URLs from segment zero',async()=>{
  const s=setup(),p=playlist('brief','intro','story','limits');
  await s.player.toggle(p);assert.equal(s.player.snapshot().index,0);assert.equal(s.audio.src,'blob:5:0');
  s.audio.ended=true;s.audio.paused=true;s.audio.fire('ended');await Promise.resolve();
  assert.equal(s.player.snapshot().index,1);assert.equal(s.audio.src,'blob:5:1');
  s.audio.ended=true;s.audio.paused=true;s.audio.fire('ended');await Promise.resolve();
  assert.equal(s.player.snapshot().index,2);assert.equal(s.audio.src,'blob:6:2');
  s.audio.ended=true;s.audio.paused=true;s.audio.fire('ended');assert.equal(s.player.snapshot().state,'ended');
  await s.player.toggle(p);assert.equal(s.player.snapshot().index,0);assert.equal(s.player.snapshot().state,'playing');
  assert.deepEqual(s.loaded,['intro','story','limits']);assert.equal(s.audio.playCalls,4);
});

test('pause and resume preserve the current part and playback time',async()=>{
  const s=setup(),p=playlist('brief','intro','story','limits');await s.player.toggle(p);
  s.audio.currentTime=12.5;s.audio.pause();assert.equal(s.player.snapshot().state,'paused');
  await s.player.toggle(p);assert.equal(s.player.snapshot().index,0);assert.equal(s.audio.currentTime,12.5);assert.equal(s.audio.src,'blob:5:0');
  s.audio.ended=true;s.audio.paused=true;s.audio.fire('ended');await Promise.resolve();s.audio.currentTime=7;
  s.audio.pause();await s.player.toggle(p);assert.equal(s.player.snapshot().index,1);assert.equal(s.audio.currentTime,7);assert.equal(s.audio.src,'blob:5:1');
  assert.deepEqual(s.loaded,['intro','story','limits']);
});

test('switching or stopping invalidates delayed loads and revokes every created URL',async()=>{
  const late=deferred(),s=setup(x=>x.id==='late'?late.promise:Promise.resolve(new Blob([x.id])));
  const old=s.player.toggle(playlist('old','late','other'));await Promise.resolve();
  const newer=s.player.toggle(playlist('new','fresh'));await newer;late.resolve(new Blob(['late']));await old;
  assert.equal(s.player.snapshot().id,'new');assert.equal(s.audio.src,'blob:5:0');assert.deepEqual(s.loaded,['late','other','fresh']);
  const active=playlist('active','a','b');await s.player.toggle(active);const owned=[...s.created];
  s.player.stop();assert.equal(s.player.snapshot().state,'idle');assert.deepEqual(s.revoked,owned);assert.equal(s.audio.src,'');
});

test('rapid changes and stop prevent stale pending audio from autoplaying',async()=>{
  const a=deferred(),b=deferred(),s=setup(x=>x.id==='a'?a.promise:b.promise);
  const first=s.player.toggle(playlist('a','a')),second=s.player.toggle(playlist('b','b'));
  b.resolve(new Blob(['b']));await second;a.resolve(new Blob(['a']));await first;
  assert.equal(s.player.snapshot().id,'b');assert.equal(s.audio.src,'blob:1:0');assert.equal(s.audio.playCalls,1);
  const pending=deferred(),stopped=setup(()=>pending.promise),work=stopped.player.toggle(playlist('late','x'));
  stopped.player.stop();pending.resolve(new Blob(['x']));await work;
  assert.equal(stopped.player.snapshot().state,'idle');assert.equal(stopped.audio.src,'');assert.equal(stopped.audio.playCalls,0);
});

test('first load, later load and play errors do not trigger automatic retries',async()=>{
  let loads=0;const s=setup(async value=>{loads++;if(loads===1)throw Error('offline');return new Blob([value.id]);});
  const p=playlist('retry','one','two');await s.player.toggle(p);assert.equal(s.player.snapshot().state,'error');
  await Promise.resolve();assert.equal(loads,2);assert.equal(s.audio.src,'');
  await s.player.toggle(p);assert.equal(s.player.snapshot().state,'playing');assert.equal(loads,4);

  const failPlay=setup();failPlay.audio.play=async()=>{failPlay.audio.playCalls++;throw Error('decode');};
  await failPlay.player.toggle(playlist('play','one'));assert.equal(failPlay.player.snapshot().state,'error');
  await Promise.resolve();assert.equal(failPlay.loaded.length,1);assert.equal(failPlay.audio.playCalls,1);
});
