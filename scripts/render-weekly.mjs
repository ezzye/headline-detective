import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEEKLY_CHALLENGE} from '../weekly-challenge.mjs';
import {renderSinceOctober} from './render-since-october.mjs';
const root=new URL('../',import.meta.url);
const input=process.argv[2]?resolve(process.argv[2]):new URL('weekly-evidence.json',root);
const output=process.argv[3]?resolve(process.argv[3]):new URL('weekly.html',root);
const data=JSON.parse(await readFile(input,'utf8'));
if(!process.argv[2]&&(data.version!=='cfj-weekly-v1-reviewed'||data.weeks.length!==53))throw Error('Expected reviewed 53-week evidence');
const template=await readFile(new URL('weekly.template.html',root),'utf8');
if(!template.includes('/* WEEKLY_EVIDENCE_DATA */'))throw Error('Evidence marker missing');
let voice={version:'cfj-weekly-host-v1',clips:[]};
try{voice=JSON.parse(await readFile(new URL('assets/weekly-audio/manifest.json',root),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
let since=null;
try{since=JSON.parse(await readFile(new URL('since-october.json',root),'utf8'))}catch(e){if(e.code!=='ENOENT'||!process.argv[2])throw e}
const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const replacements=[
  ['/* WEEKLY_EVIDENCE_DATA */',`const EVIDENCE = ${safe(data)};`],
  ['/* WEEKLY_CHALLENGE_DATA */',`const CHALLENGE = ${safe(WEEKLY_CHALLENGE)};`],
  ['/* WEEKLY_VOICE_MANIFEST_DATA */',`const VOICE_MANIFEST = ${safe(voice)};`],
  ['/* WEEKLY_SINCE_DATA */',`const SINCE_OCTOBER = ${safe(since)};`],
  ['<!-- WEEKLY_SINCE_LINK -->',since?'<a href="#since-16-october" id="since-link">Since 16 October</a>':''],
  ['<!-- WEEKLY_SINCE_SECTION -->',renderSinceOctober(since)]
];
let rendered=template;
for(const [marker,content] of replacements){
  if(!rendered.includes(marker))throw Error(`Template marker missing: ${marker}`);
  rendered=rendered.replace(marker,()=>content);
}
await writeFile(output,rendered);
console.log(`Rendered ${typeof output==='string'?output:fileURLToPath(output)}`);
