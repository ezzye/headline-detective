// A prepared, three-part host briefing. No provider requests or automatic replay.
export function createComparisonVoicePlayer({audio,load,onState=()=>{},createURL=b=>URL.createObjectURL(b),revokeURL=u=>URL.revokeObjectURL(u)}) {
  let epoch=0,current=null,urls=[],index=0,state='idle';
  const emit=next=>{state=next;onState({id:current?.id||null,state:next,index,total:urls.length||current?.clips.length||0});};
  function stop(){epoch++;const previous=current;current=null;audio.pause();audio.removeAttribute('src');audio.load();for(const url of urls)revokeURL(url);urls=[];index=0;state='idle';if(previous)onState({id:previous.id,state:'idle',index:0,total:0});}
  async function playPart(token){if(token!==epoch||!current)return;audio.src=urls[index];try{await audio.play();}catch{if(token===epoch)emit('error');}}
  async function toggle(playlist){
    if(!playlist?.id||!Array.isArray(playlist.clips)||!playlist.clips.length)return;
    if(current?.id===playlist.id){if(state==='loading')return;if(!audio.paused){audio.pause();return;}if(urls.length){const token=epoch;if(state==='ended'){index=0;await playPart(token);}else try{await audio.play();}catch{if(token===epoch)emit('error');}return;}}
    stop();current=playlist;const token=epoch;emit('loading');
    try{const blobs=await Promise.all(playlist.clips.map(load));if(token!==epoch)return;urls=blobs.map(createURL);await playPart(token);}catch{if(token===epoch)emit('error');}
  }
  audio.addEventListener('play',()=>{if(current)emit('playing');});
  audio.addEventListener('pause',()=>{if(current&&urls.length&&!audio.ended)emit('paused');});
  audio.addEventListener('ended',()=>{if(!current)return;if(index+1<urls.length){index++;void playPart(epoch);}else emit('ended');});
  audio.addEventListener('error',()=>{if(current)emit('error');});
  return {toggle,stop,snapshot:()=>({id:current?.id||null,state,index,total:urls.length})};
}
