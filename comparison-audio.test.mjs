import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import campaigns from './campaigns.json' with {type:'json'};
import bundles from './comparison-bundles.json' with {type:'json'};
import {COMPARISON_HOST_VERSION, comparisonSegments} from './comparison-host.mjs';

const root=new URL('./assets/host-audio/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('comparison-manifest.json',root),'utf8'));
const questions=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
const identity=clips=>clips.map(({id,kind,text})=>`${id}\0${kind}\0${text}`).sort();

test('comparison manifest exactly matches the current scripts and all 54 case/bundle bindings',()=>{
  assert.equal(manifest.version,COMPARISON_HOST_VERSION);
  assert.equal(manifest.clips.length,16);
  assert.deepEqual(manifest.profile,{...questions.profile,direction:{intro:'[curious]',story:'[thoughtful]',limits:'[thoughtful]'}});
  const expected=campaigns.flatMap(c=>bundles.flatMap(b=>comparisonSegments(c,b))).filter((clip,index,all)=>all.findIndex(x=>x.id===clip.id&&x.kind===clip.kind)===index);
  assert.equal(campaigns.length*bundles.length,54);
  assert.deepEqual(identity(manifest.clips),identity(expected));
  for(const clip of manifest.clips){
    assert.equal(clip.digest,createHash('sha256').update(JSON.stringify([manifest.version,manifest.profile,clip.text])).digest('hex'));
    assert.equal(clip.src,`/assets/host-audio/${clip.digest}.mp3`);
    assert.equal(clip.src,`/assets/host-audio/${clip.digest}.mp3`);
  }
});

test('all comparison MP3s have the manifest byte length and audio hash',async()=>{
  for(const clip of manifest.clips){
    const bytes=await readFile(new URL(`${clip.digest}.mp3`,root));
    assert.equal(bytes.length,clip.bytes,clip.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),clip.audioSha256,clip.id);
  }
});

test('portable browser resolves exact case and comparison scripts without a paid endpoint', async () => {
  const vm=await import('node:vm'),{webcrypto}=await import('node:crypto'),ComparisonHost=await import('./comparison-host.mjs');
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8'),region=html.split('// COMPARISON_VOICE_START')[1].split('// COMPARISON_VOICE_END')[0];
  for(const name of ['comparison-host.mjs','comparison-player.mjs'])assert(region.includes((await readFile(new URL('./'+name,import.meta.url),'utf8')).replaceAll('export ','')));
  assert.doesNotMatch(region,/\/api\/speak|api\.elevenlabs|xi-api-key/);
  const m=JSON.parse(await readFile(new URL('./assets/host-audio/comparison-manifest.json',import.meta.url),'utf8'));
  let active=m;const context=vm.createContext({ComparisonHost,crypto:webcrypto,TextEncoder,comparisonAudioManifest:async()=>active});vm.runInContext(region.match(/async function comparisonPlaylist\([^\n]+/)[0],context);
  const cases=JSON.parse(await readFile(new URL('./campaigns.json',import.meta.url),'utf8')),bundles=JSON.parse(await readFile(new URL('./comparison-bundles.json',import.meta.url),'utf8'));
  for(const c of cases)for(const b of bundles){const p=await context.comparisonPlaylist(c,b,'window');assert.equal(p.clips[0].id,c.id);assert.equal(p.clips[1].id,b.id);assert.equal(p.clips.length,3);}
  await assert.rejects(context.comparisonPlaylist({...cases[0],title:'Changed title'},bundles[0],'window'),/script changed/);
  await assert.rejects(context.comparisonPlaylist(cases[0],{...bundles[0],summary:'Changed summary'},'window'),/script changed/);
  active=structuredClone(m);active.profile.voice_settings.stability=.9;await assert.rejects(context.comparisonPlaylist(cases[0],bundles[0],'window'),/script changed/);
});
