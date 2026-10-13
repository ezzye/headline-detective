import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceDirection,VOICE_CHARACTERS} from './voice-direction.mjs';
const text='We defend the institutional question. That argument still needs to explain the particular reporting choice and its human cost. We should answer that challenge carefully.';
test('four stock-actor desk personas have distinct pace and style without real identities',()=> {
  const choices=VOICE_CHARACTERS.map((_,deskIndex)=>voiceDirection({text,deskIndex,model:'eleven_flash_v2_5',performance:'theatrical'}));
  assert.equal(new Set(choices.map(c=>c.character)).size,4);assert.equal(new Set(choices.map(c=>c.voice_settings.speed)).size,4);
  assert.equal(new Set(choices.map(c=>c.voice_settings.stability)).size,4);assert.equal(new Set(choices.map(c=>c.voice_settings.style)).size,4);
  choices.forEach(c=>{assert.match(c.text,/<break time="0.45s" \/>/);assert.doesNotMatch(c.text,/\[thoughtful\]|\[curious\]/);});
});
test('v3/v4 semantic direction never contains unsupported SSML; v3 never sets speed',()=> {
  for(const model of ['eleven_v3','eleven_v4','eleven_v4_turbo']) {
    const d=voiceDirection({text,deskIndex:0,model,performance:'theatrical'});assert.match(d.text,/^\[thoughtful\]/);assert.doesNotMatch(d.text,/<break/);
    if(model==='eleven_v3')assert.equal('speed' in d.voice_settings,false);
  }
});
test('calm defaults preserve spoken words and unknown model gets no unsupported tags or markup',()=> {
  const calm=voiceDirection({text,deskIndex:0,model:'eleven_flash_v2_5'});assert.equal(calm.text,text);assert.equal(calm.voice_settings.style,0);
  const unknown=voiceDirection({text,deskIndex:0,model:'test-model',performance:'theatrical'});assert.equal(unknown.text,text);assert.doesNotMatch(unknown.text,/<|\[/);
  const stripped=voiceDirection({text:'[shouting] We <break time="3s" /> answer.',deskIndex:0,model:'eleven_flash_v2_5'});assert.doesNotMatch(stripped.text,/shouting|<break/);
  assert.throws(()=>voiceDirection({text,deskIndex:0,model:'eleven_v3',performance:'other'}),/invalid_performance/);
});
