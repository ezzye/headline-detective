// Sequences only prepared clips. A sequence advances on the player's ended event.
export function createHostAutoReader({player,resolve,onState=()=>{}}) {
  let epoch=0, muted=false, part=null, state='idle', activeId=null, waiter=null;
  const emit=(next,nextPart=part)=>{part=nextPart;state=next;onState({part,state:next});};
  const settle=(value)=>{if(waiter){const done=waiter;waiter=null;done(value);}};

  function cancel({stop=true}={}) {
    epoch++; settle('cancelled'); activeId=null;
    if(stop) player.stop();
    emit('idle',null);
  }
  function onPlayerState(event) {
    if(!event||event.id!==activeId)return;
    if(event.state==='playing'||event.state==='loading')emit(event.state);
    else if(event.state==='paused')emit('paused');
    else if(event.state==='ended'){emit('ended');settle('ended');}
    else if(event.state==='error'){emit('error');settle('error');}
    else if(event.state==='idle'){activeId=null;settle('cancelled');emit('idle',null);}
  }
  async function read(parts) {
    cancel();
    const token=epoch;
    if(muted){emit('muted',null);return false;}
    for(const name of parts) {
      if(token!==epoch||muted)return false;
      emit('loading',name);
      let clip;
      try { clip=await resolve(name); }
      catch { if(token===epoch)emit('error',name);return false; }
      if(token!==epoch||muted)return false;
      if(!clip?.digest||!clip?.src){emit('error',name);return false;}
      activeId=clip.digest;
      const done=new Promise(resolveDone=>{waiter=resolveDone;});
      // toggle can synchronously report state (or be re-entered by user code).
      try { await player.toggle(clip); }
      catch { if(token===epoch&&activeId===clip.digest){emit('error',name);settle('error');} }
      if(token!==epoch)return false;
      const snap=player.snapshot?.();
      if(snap?.id===clip.digest&&snap.state==='error')onPlayerState({id:clip.digest,state:'error'});
      if(snap?.id===clip.digest&&snap.state==='paused')onPlayerState({id:clip.digest,state:'paused'});
      const result=await done;
      if(token!==epoch)return false;
      if(result!=='ended'){activeId=null;return false;}
      activeId=null;
    }
    if(token===epoch){emit('ended',null);return true;}
    return false;
  }
  function setMuted(value) {
    muted=Boolean(value);
    if(muted){cancel();emit('muted',null);}
    else emit('idle',null);
  }
  return {read,cancel,setMuted,onPlayerState,snapshot:()=>({muted,part,state})};
}
