import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {onlinePage} from '../online-page.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=process.argv[2];if(!target)throw Error('Provide an output directory');
const files={};for(const name of ['index.html','weekly.html','archive-recovery.html','weekly-evidence.json','since-october.json','weekly-captures.csv','agenda.html','agenda-evidence.json','football.html','football-framing.json','donate.html','donate-guide.html','justice.html','credits.html','research.html','crossmedia.html','x-editorial.html','attention.html','jefferies.html','greenwood.html','case-evidence.html','representation-research.json','bbc-greenwood-audit.json','bbc-greenwood-audit.csv','coverage-audit.html','comparison-bundles.json','jefferies-recovery.json','comparison-records.csv','jefferies-cover-evidence.csv','jefferies-web-evidence.csv','jefferies-episode-records.csv','accountability-records.csv','spread-links.csv','editorial-records.csv','media-records.csv','privacy.html','README.html','verification.html','assets/media-credits.json','recovered-headlines.json','recovered-headlines.csv','favicon.svg']){files[name]={content:await readFile(path.join(ROOT,name),'utf8'),type:name.endsWith('.svg')?'image/svg+xml':name.endsWith('.json')?'application/json':name.endsWith('.csv')?'text/csv; charset=utf-8':'text/html; charset=utf-8'}}
for(const name of ['arday-2026-campaign','caroline-flack-recovered-campaign','sterling-campaign','markle-letter-campaign','bulley-campaign','jefferies-campaign','greenwood-campaign','greenwood-pre2022-campaign','diallo-documents-campaign'])files['case-bundles/'+name+'.json']={content:await readFile(path.join(ROOT,'case-bundles',name+'.json'),'utf8'),type:'application/json'};
const manifest = JSON.parse(files['assets/media-credits.json'].content);
const cases = JSON.parse(files['index.html'].content.match(/<script id="campaign-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const images = new Map(cases.flatMap(c => c.images || []).map(image => [image.filePage, image]));
const filmPoster=await readFile(path.join(ROOT,'assets/film/coding-for-justice-poster.jpg'));files['assets/film/coding-for-justice-poster.jpg']={type:'image/jpeg',encoding:'base64',content:filmPoster.toString('base64'),etag:'"'+createHash('sha256').update(filmPoster).digest('hex')+'"'};
const hostRoot=path.join(ROOT,'assets/host-audio');
const hostManifest=JSON.parse(await readFile(path.join(hostRoot,'manifest.json'),'utf8'));
if(hostManifest.version!=='cfj-host-v1'||!Array.isArray(hostManifest.clips))throw Error('Invalid host audio manifest');
const comparisonManifest=JSON.parse(await readFile(path.join(hostRoot,'comparison-manifest.json'),'utf8'));
if(comparisonManifest.version!=='cfj-comparison-host-v1'||!Array.isArray(comparisonManifest.clips)||comparisonManifest.clips.length!==16)throw Error('Invalid comparison host audio manifest');
async function embedAudioManifest(name, audioManifest, directory='assets/host-audio'){
 files[`${directory}/${name}`]={content:JSON.stringify(audioManifest),type:'application/json'};
 for(const clip of audioManifest.clips){
  if(!/^[a-f0-9]{64}$/.test(clip.digest)||clip.src!==`/${directory}/${clip.digest}.mp3`||!Number.isInteger(clip.bytes)||clip.bytes<1||!/^[a-f0-9]{64}$/.test(clip.audioSha256))throw Error('Invalid host audio clip metadata');
  const bytes=await readFile(path.join(ROOT,directory,`${clip.digest}.mp3`));
  if(bytes.length!==clip.bytes||createHash('sha256').update(bytes).digest('hex')!==clip.audioSha256)throw Error('Host audio clip integrity mismatch: '+clip.digest);
  const file=`${directory}/${clip.digest}.mp3`;
  files[file]={type:'audio/mpeg',encoding:'base64',content:bytes.toString('base64'),etag:'"'+clip.audioSha256+'"'};
 }
}
await embedAudioManifest('manifest.json',hostManifest);
await embedAudioManifest('comparison-manifest.json',comparisonManifest);
const welcomeManifest=JSON.parse(await readFile(path.join(hostRoot,'welcome-manifest.json'),'utf8'));
if(welcomeManifest.version!=='cfj-host-welcome-v1'||welcomeManifest.clips?.length!==1)throw Error('Invalid welcome manifest');
await embedAudioManifest('welcome-manifest.json',welcomeManifest);
const weeklyManifest=JSON.parse(await readFile(path.join(ROOT,'assets/weekly-audio/manifest.json'),'utf8'));
if(weeklyManifest.version!=='cfj-weekly-host-v1'||weeklyManifest.clips?.length!==16)throw Error('Invalid weekly host manifest');
await embedAudioManifest('manifest.json',weeklyManifest,'assets/weekly-audio');
for(const [name,type] of [['weekly-comparison-v1.mp4','video/mp4'],['weekly-comparison-v1.jpg','image/jpeg'],['weekly-comparison-v1.vtt','text/vtt; charset=utf-8']]){
 const bytes=await readFile(path.join(ROOT,'assets/film',name));
 files[`assets/film/${name}`]={type,encoding:'base64',content:bytes.toString('base64'),etag:'"'+createHash('sha256').update(bytes).digest('hex')+'"'};
}
const online=onlinePage(files['index.html'].content,manifest);
for(const file of Object.values(files))if(!file.etag)file.etag='"'+createHash('sha256').update(file.content).digest('hex')+'"';
// Store shared image bytes once. Reassemble embedded offline pages only when served.
for (const entry of manifest.images) {
  const image = images.get(entry.filePage);
  const prefix = 'data:' + entry.mimeType + ';base64,';
  if (!image?.url.startsWith(prefix)) throw Error('Missing embedded licensed image ' + entry.id);
  files[entry.file] = {type: entry.mimeType, encoding: 'base64', content: image.url.slice(prefix.length), etag: entry.sha256};
}
files['offline.html'] = files['index.html'];
files['index.html'] = {
  type: 'text/html; charset=utf-8', content: online,
  etag: '"' + createHash('sha256').update(online).digest('hex') + '"'
};
const imageReferences = new Map();
for (const entry of manifest.images) {
  const content = files[entry.file].content;
  if (!imageReferences.has(content)) imageReferences.set(content, imageReferences.size);
}
const properties = [];
for (const [name, file] of Object.entries(files)) {
  const {content, ...metadata} = file;
  let property;
  if (imageReferences.has(content)) {
    property = 'content:IMAGES[' + imageReferences.get(content) + ']';
  } else {
    const parts = [];
    let start = 0;
    for (const match of content.matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)/g)) {
      const ref = imageReferences.get(match[1]);
      if (ref === undefined) continue;
      const payloadStart = match.index + match[0].length - match[1].length;
      parts.push(JSON.stringify(content.slice(start, payloadStart)), 'IMAGES[' + ref + ']');
      start = payloadStart + match[1].length;
    }
    if (parts.length) {
      parts.push(JSON.stringify(content.slice(start)));
      property = 'get content(){return [' + parts.join(',') + '].join("")}';
    } else {
      property = 'content:' + JSON.stringify(content);
    }
  }
  properties.push(JSON.stringify(name) + ':{' + JSON.stringify(metadata).slice(1, -1) + ',' + property + '}');
}
const worker = 'const IMAGES=' + JSON.stringify([...imageReferences.keys()]) + ';\nconst FILES={' + properties.join(',') + '};\n'
  + await readFile(path.join(ROOT, 'deploy/edge-worker.mjs'), 'utf8');
await mkdir(path.join(target, 'server'), {recursive: true});
await writeFile(path.join(target, 'server/index.js'), worker);
console.log(JSON.stringify({files:Object.keys(files).length, workerBytes:Buffer.byteLength(worker)}));
