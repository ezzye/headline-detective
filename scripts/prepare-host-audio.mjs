// Run manually with server-side environment credentials. Never called by visitors.
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HOST_VOICE_VERSION,hostClipText} from '../host-voice.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const campaigns=JSON.parse(await readFile(path.join(ROOT,'campaigns.json'),'utf8'));
const voiceId=process.env.ELEVENLABS_HOST_VOICE_ID||process.env.ELEVENLABS_VOICE_A;
if(!voiceId)throw Error('Set a configured stock host voice ID in the server environment.');
const profile={voiceId,model:'eleven_v3',format:'mp3_44100_64',voice_settings:{stability:0.5,similarity_boost:0.75,use_speaker_boost:true},direction:{question:'[curious]',feedback:'[thoughtful]'}};
const clips=campaigns.flatMap(c=>c.reasoningChecks.flatMap((check,i)=>['question','feedback'].map(part=>{const text=hostClipText(check,i,c.reasoningChecks.length,part),digest=sha(JSON.stringify([HOST_VOICE_VERSION,profile,text]));return {caseId:c.id,questionId:check.id,part,text,digest,src:`/assets/host-audio/${digest}.mp3`};})));
const unique=[...new Map(clips.map(c=>[c.digest,c])).values()];
const spoken=c=>`${profile.direction[c.part]} ${c.text}`;
const characters=unique.reduce((sum,c)=>sum+spoken(c).length,0);
if(unique.length>90||characters>40000)throw Error('Host preparation exceeds reviewed ceiling.');
console.log(JSON.stringify({plannedClips:clips.length,uniqueRecordings:unique.length,characters,paid:!process.argv.includes('--plan')}));
if(process.argv.includes('--plan'))process.exit(0);
const apiKey=process.env.ELEVENLABS_API_KEY,ledgerPath=process.env.CFJ_HOST_PREPARATION_LEDGER;
if(!apiKey||!ledgerPath||path.resolve(ledgerPath).startsWith(ROOT+path.sep))throw Error('Private credentials and a private preparation ledger outside the repository are required.');
const lockPath=ledgerPath+'.lock';const lock=await open(lockPath,'wx',0o600);process.on('exit',()=>{try{unlinkSync(lockPath);}catch{}});
const folder=path.join(ROOT,'assets/host-audio');await mkdir(folder,{recursive:true});
let ledger={version:HOST_VOICE_VERSION,profile,calls:0,characters:0,items:{}};
try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));if(ledger.version!==HOST_VOICE_VERSION||JSON.stringify(ledger.profile)!==JSON.stringify(profile))throw Error('Host plan changed; review before starting a new bounded preparation.');}catch(e){if(e.code!=='ENOENT')throw e;}
let saving=Promise.resolve();const save=()=>{const snapshot=JSON.stringify(ledger,null,2)+'\n';return saving=saving.then(()=>writeFile(ledgerPath,snapshot));};
let old={clips:[]};try{old=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const finished=new Map();
for(const c of unique){const known=old.clips.find(x=>x.digest===c.digest)||ledger.items[c.digest];if(known?.status==='reserved'||known?.status==='uncertain')throw Error('An earlier paid request has an uncertain result. Review it before retrying.');if(known?.audioSha256){try{const bytes=await readFile(path.join(ROOT,c.src.slice(1)));if(sha(bytes)===known.audioSha256&&bytes.length===known.bytes)finished.set(c.digest,{audioSha256:known.audioSha256,bytes:bytes.length});}catch(e){if(e.code!=='ENOENT')throw e;}}}
const pending=unique.filter(c=>!finished.has(c.digest));
if(pending.length){const sub=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers:{'xi-api-key':apiKey},signal:AbortSignal.timeout(15000)});if(!sub.ok)throw Error('Cannot verify prepaid allowance.');const info=await sub.json();const needed=pending.reduce((sum,c)=>sum+spoken(c).length,0);if(info.can_extend_character_limit!==false||!Number.isSafeInteger(info.character_limit)||!Number.isSafeInteger(info.character_count)||info.character_limit-info.character_count<needed)throw Error('Verified prepaid-only allowance is insufficient; no recordings requested.');}
let failed=false;
async function worker(){while(pending.length&&!failed){const c=pending.shift(),text=spoken(c);if(ledger.calls>=90||ledger.characters+text.length>40000){failed=true;throw Error('Paid preparation ceiling reached.');}ledger.calls++;ledger.characters+=text.length;ledger.items[c.digest]={status:'reserved',characters:text.length};await save();try{const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${profile.format}`,{method:'POST',headers:{'xi-api-key':apiKey,'content-type':'application/json'},body:JSON.stringify({text,model_id:profile.model,voice_settings:profile.voice_settings}),signal:AbortSignal.timeout(65000)});if(!r.ok||!/^audio\/(mpeg|mp3)/i.test(r.headers.get('content-type')||''))throw Error('Provider did not return valid audio.');const bytes=Buffer.from(await r.arrayBuffer());if(!bytes.length||bytes.length>2*1024*1024)throw Error('Invalid audio length.');await writeFile(path.join(ROOT,c.src.slice(1)),bytes);const meta={audioSha256:sha(bytes),bytes:bytes.length};finished.set(c.digest,meta);ledger.items[c.digest]={status:'complete',characters:text.length,...meta};await save();console.log(JSON.stringify({prepared:finished.size,total:unique.length,characters:ledger.characters}));}catch{failed=true;ledger.items[c.digest].status='uncertain';await save();throw Error('Preparation stopped after a failed or uncertain paid request. No automatic retry.');}}}
const outcomes=await Promise.allSettled([worker(),worker()]);if(outcomes.some(x=>x.status==='rejected'))throw Error('Preparation incomplete; preserve the private ledger and review before resuming.');
if(finished.size!==unique.length)throw Error('Preparation incomplete.');
await writeFile(path.join(folder,'manifest.json'),JSON.stringify({version:HOST_VOICE_VERSION,profile,clips:clips.map(c=>({...c,...finished.get(c.digest)}))},null,2)+'\n');
console.log(JSON.stringify({status:'complete',clips:clips.length,recordings:finished.size,calls:ledger.calls,characters:ledger.characters,audioBytes:[...finished.values()].reduce((n,c)=>n+c.bytes,0)}));
