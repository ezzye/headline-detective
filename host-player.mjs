// One host at a time. Prepared public clips never call a paid speech endpoint.
export function createHostVoicePlayer({audio,load,onState=()=>{},createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}) {
  let epoch=0,current=null,objectURL=null,state='idle';
  const emit=next=>{state=next;onState({id:current?.digest||null,state:next});};
  function stop(){epoch++;const previous=current;current=null;audio.pause();audio.removeAttribute('src');audio.load();if(objectURL)revokeURL(objectURL);objectURL=null;state='idle';if(previous)onState({id:previous.digest,state:'idle'});}
  async function toggle(clip){
    if(!clip?.digest||!clip.src)return;
    if(current?.digest===clip.digest){if(state==='loading')return;if(!audio.paused){audio.pause();return;}if(objectURL){const token=epoch;try{if(audio.ended)audio.currentTime=0;await audio.play();}catch{if(token===epoch)emit('error');}return;}}
    stop();current=clip;const token=epoch;emit('loading');
    try{const blob=await load(clip);if(token!==epoch)return;objectURL=createURL(blob);audio.src=objectURL;await audio.play();if(token!==epoch)return;}
    catch{if(token===epoch)emit('error');}
  }
  audio.addEventListener('play',()=>{if(current)emit('playing');});
  audio.addEventListener('pause',()=>{if(current&&objectURL&&!audio.ended)emit('paused');});
  audio.addEventListener('ended',()=>{if(current)emit('ended');});
  audio.addEventListener('error',()=>{if(current)emit('error');});
  return {toggle,stop,snapshot:()=>({id:current?.digest||null,state})};
}
