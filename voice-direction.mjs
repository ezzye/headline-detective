// Verified 2026-10-13 against official ElevenLabs TTS best-practices/product docs:
// https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices
// https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech
// These are fictional desk performances using configured stock actors, never
// imitations of a real publisher, presenter, subject or victim.
export const VOICE_CHARACTERS = Object.freeze([
  Object.freeze({ label:'Fictional institutional editor', stability:0.62, style:0.12, speed:0.96, tag:'[thoughtful]' }),
  Object.freeze({ label:'Fictional political columnist', stability:0.46, style:0.28, speed:1.04, tag:'[curious]' }),
  Object.freeze({ label:'Fictional tabloid presenter', stability:0.38, style:0.38, speed:1.1, tag:'[curious]' }),
  Object.freeze({ label:'Fictional reflective editor', stability:0.72, style:0.1, speed:0.9, tag:'[thoughtful]' })
]);
export function voiceDirection({text,deskIndex,model,performance='calm'}) {
  if (!['theatrical','calm'].includes(performance)) throw Object.assign(new Error('invalid_performance'),{code:'invalid_performance'});
  if (typeof text!=='string' || !Number.isInteger(deskIndex) || deskIndex<0 || deskIndex>3 || typeof model!=='string') throw new Error('invalid_voice_direction');
  const persona=VOICE_CHARACTERS[deskIndex], expressive=['eleven_v3','eleven_v4','eleven_v4_turbo'].includes(model);
  const ssml=['eleven_flash_v2_5','eleven_flash_v2','eleven_multilingual_v2','eleven_turbo_v2','eleven_turbo_v2_5'].includes(model);
  // Strip provider-control markup from accepted spoken text before adding only
  // server-owned direction. Callers cannot smuggle audio effects into TTS.
  let spoken=text.replace(/\[[^\]\n]{1,100}\]/g,'').replace(/<[^>]*>/g,'').trim();
  const settings={stability:performance==='calm'?Math.min(0.9,persona.stability+0.12):persona.stability,similarity_boost:0.75,use_speaker_boost:true};
  if(model==='eleven_v3') { settings.stability=performance==='calm'?1:deskIndex===2?0:0.5;settings.use_speaker_boost=false; }
  else if(expressive || ssml) { settings.style=performance==='calm'?0:persona.style;settings.speed=performance==='calm'?1:persona.speed; }
  if(performance==='theatrical' && expressive) spoken=`${persona.tag} ${spoken}`;
  else if(performance==='theatrical' && ssml && spoken.length>120) spoken=spoken.replace(/([.!?])\s+(?=[A-Z])/,'$1 <break time="0.45s" /> ');
  return {text:spoken,model_id:model,voice_settings:settings,character:persona.label,performance};
}
