import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostAutoReader} from './host-auto-reader.mjs';

class FakePlayer {
  constructor(){this.cb=()=>{};this.current=null;this.state='idle';this.starts=[];this.stops=0;}
  bind(cb){this.cb=cb;}
  toggle(clip){this.current=clip;this.state='playing';this.starts.push(clip.digest);this.cb({id:clip.digest,state:'playing'});}
  stop(){this.stops++;this.current=null;this.state='idle';this.cb({id:null,state:'idle'});}
  snapshot(){return {id:this.current?.digest||null,state:this.state};}
  event(state){this.state=state;this.cb({id:this.current?.digest||null,state});}
  finish(){this.event('ended');this.current=null;this.state='idle';}
}
const clip=name=>({digest:name,src:`cached:${name}`});
const setup=(resolve=async name=>clip(name))=>{
  const player=new FakePlayer(), states=[];
  const reader=createHostAutoReader({player,resolve,onState:value=>states.push(value)});
  player.bind(event=>reader.onPlayerState(event));
  return {player,reader,states};
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('sequences welcome then question only after ended',async()=>{
  const {player,reader}=setup(), run=reader.read(['welcome','question']);
  await tick(); assert.deepEqual(player.starts,['welcome']);
  player.finish(); await tick(); assert.deepEqual(player.starts,['welcome','question']);
  player.finish(); assert.equal(await run,true);
  assert.deepEqual(reader.snapshot(),{muted:false,part:null,state:'ended'});
});

test('replacement feedback interrupts old queue and old ended is ignored',async()=>{
  const {player,reader}=setup(), old=reader.read(['welcome','question']);
  await tick(); const replacement=reader.read(['feedback']); await tick();
  assert.deepEqual(player.starts,['welcome','feedback']);
  player.finish(); assert.equal(await replacement,true); assert.equal(await old,false);
  assert.deepEqual(player.starts,['welcome','feedback']);
});

test('mute during delayed resolve suppresses audio, including late result',async()=>{
  let release; const {player,reader}=setup(()=>new Promise(resolve=>{release=resolve;}));
  const run=reader.read(['welcome']); await tick();
  reader.setMuted(true); release(clip('welcome'));
  assert.equal(await run,false); assert.deepEqual(player.starts,[]);
  assert.equal(reader.snapshot().state,'muted');
});

test('errors stop without retry and pause waits for an explicit resume',async()=>{
  const {player,reader}=setup(), failed=reader.read(['welcome','question']); await tick();
  player.event('error'); assert.equal(await failed,false); assert.deepEqual(player.starts,['welcome']);
  const run=reader.read(['welcome']); await tick(); player.event('paused'); await tick();
  assert.equal(reader.snapshot().state,'paused'); assert.deepEqual(player.starts,['welcome','welcome']);
  player.event('playing'); player.finish(); assert.equal(await run,true);
});

test('cancel without stop lets manual playback take over and settles queue',async()=>{
  const {player,reader}=setup(), run=reader.read(['welcome','question']); await tick();
  const stops=player.stops; reader.cancel({stop:false});
  assert.equal(await run,false); assert.equal(player.stops,stops);
});

test('player stop settles an active wait instead of hanging',async()=>{
  const {player,reader}=setup(), run=reader.read(['welcome']); await tick();
  player.event('idle'); assert.equal(await run,false);
});
