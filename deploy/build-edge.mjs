import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {onlinePage} from '../online-page.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=process.argv[2];if(!target)throw Error('Provide an output directory');
const files={};for(const name of ['index.html','weekly.html','weekly-evidence.json','weekly-captures.csv','agenda.html','agenda-evidence.json','football.html','football-framing.json','donate.html','donate-guide.html','justice.html','credits.html','research.html','crossmedia.html','x-editorial.html','attention.html','jefferies.html','greenwood.html','case-evidence.html','representation-research.json','bbc-greenwood-audit.json','bbc-greenwood-audit.csv','coverage-audit.html','comparison-bundles.json','jefferies-recovery.json','comparison-records.csv','jefferies-cover-evidence.csv','jefferies-web-evidence.csv','jefferies-episode-records.csv','accountability-records.csv','spread-links.csv','editorial-records.csv','media-records.csv','privacy.html','README.html','verification.html','assets/media-credits.json','recovered-headlines.json','recovered-headlines.csv','favicon.svg']){files[name]={content:await readFile(path.join(ROOT,name),'utf8'),type:name.endsWith('.svg')?'image/svg+xml':name.endsWith('.json')?'application/json':name.endsWith('.csv')?'text/csv; charset=utf-8':'text/html; charset=utf-8'}}
for(const name of ['arday-2026-campaign','caroline-flack-recovered-campaign','sterling-campaign','markle-letter-campaign','bulley-campaign','jefferies-campaign','greenwood-campaign','greenwood-pre2022-campaign','diallo-documents-campaign'])files['case-bundles/'+name+'.json']={content:await readFile(path.join(ROOT,'case-bundles',name+'.json'),'utf8'),type:'application/json'};
const manifest=JSON.parse(files['assets/media-credits.json'].content);const cases=JSON.parse(files['index.html'].content.match(/<script id="campaign-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);const mapping={};for(const im of manifest.images){const image=cases.flatMap(c=>c.images||[]).find(x=>x.filePage===im.filePage);if(!image||!image.url.startsWith('data:'+im.mimeType+';base64,'))throw Error('Missing embedded licensed image '+im.id);mapping[im.file]=im.filePage;}
const filmPoster=await readFile(path.join(ROOT,'assets/film/coding-for-justice-poster.jpg'));files['assets/film/coding-for-justice-poster.jpg']={type:'image/jpeg',encoding:'base64',content:filmPoster.toString('base64'),etag:'"'+createHash('sha256').update(filmPoster).digest('hex')+'"'};
const hostRoot=path.join(ROOT,'assets/host-audio');
const hostManifest=JSON.parse(await readFile(path.join(hostRoot,'manifest.json'),'utf8'));
if(hostManifest.version!=='cfj-host-v1'||!Array.isArray(hostManifest.clips))throw Error('Invalid host audio manifest');
const comparisonManifest=JSON.parse(await readFile(path.join(hostRoot,'comparison-manifest.json'),'utf8'));
if(comparisonManifest.version!=='cfj-comparison-host-v1'||!Array.isArray(comparisonManifest.clips)||comparisonManifest.clips.length!==16)throw Error('Invalid comparison host audio manifest');
async function embedAudioManifest(name, audioManifest){
 files[`assets/host-audio/${name}`]={content:JSON.stringify(audioManifest),type:'application/json'};
 for(const clip of audioManifest.clips){
  if(!/^[a-f0-9]{64}$/.test(clip.digest)||clip.src!==`/assets/host-audio/${clip.digest}.mp3`||!Number.isInteger(clip.bytes)||clip.bytes<1||!/^[a-f0-9]{64}$/.test(clip.audioSha256))throw Error('Invalid host audio clip metadata');
  const bytes=await readFile(path.join(hostRoot,`${clip.digest}.mp3`));
  if(bytes.length!==clip.bytes||createHash('sha256').update(bytes).digest('hex')!==clip.audioSha256)throw Error('Host audio clip integrity mismatch: '+clip.digest);
  const file=`assets/host-audio/${clip.digest}.mp3`;
  files[file]={type:'audio/mpeg',encoding:'base64',content:bytes.toString('base64'),etag:'"'+clip.audioSha256+'"'};
 }
}
await embedAudioManifest('manifest.json',hostManifest);
await embedAudioManifest('comparison-manifest.json',comparisonManifest);
const welcomeManifest=JSON.parse(await readFile(path.join(hostRoot,'welcome-manifest.json'),'utf8'));
if(welcomeManifest.version!=='cfj-host-welcome-v1'||welcomeManifest.clips?.length!==1)throw Error('Invalid welcome manifest');
await embedAudioManifest('welcome-manifest.json',welcomeManifest);
const online=onlinePage(files['index.html'].content,manifest);
for(const file of Object.values(files))if(!file.etag)file.etag='"'+createHash('sha256').update(file.content).digest('hex')+'"';
const setup=`const embedded=JSON.parse(FILES['index.html'].content.match(/<script id="campaign-data" type="application\\/json">([\\s\\S]*?)<\\/script>/)[1]).flatMap(c=>c.images||[]);for(const [name,page] of Object.entries(${JSON.stringify(mapping)})){const im=embedded.find(x=>x.filePage===page);FILES[name]={type:im.url.split(';')[0].slice(5),encoding:'base64',content:im.url.slice(im.url.indexOf(',')+1),etag:JSON.parse(FILES['assets/media-credits.json'].content).images.find(x=>x.file===name).sha256}};FILES['offline.html']=FILES['index.html'];FILES['index.html']={type:'text/html; charset=utf-8',content:${JSON.stringify(online)},etag:${JSON.stringify('"'+createHash('sha256').update(online).digest('hex')+'"')}};\n`;
await mkdir(path.join(target,'server'),{recursive:true});await writeFile(path.join(target,'server/index.js'),`const FILES=${JSON.stringify(files)};\n${setup}${await readFile(path.join(ROOT,'deploy/edge-worker.mjs'),'utf8')}`);
console.log(JSON.stringify({files:Object.keys(files).length+manifest.images.length+1,onlineBytes:Buffer.byteLength(online),offlineBytes:Buffer.byteLength(files['index.html'].content),worker:path.join(target,'server/index.js')}));
