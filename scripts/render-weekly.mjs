import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEEKLY_CHALLENGE} from '../weekly-challenge.mjs';
const root=new URL('../',import.meta.url);
const input=process.argv[2]?resolve(process.argv[2]):new URL('weekly-evidence.json',root);
const output=process.argv[3]?resolve(process.argv[3]):new URL('weekly.html',root);
const data=JSON.parse(await readFile(input,'utf8'));
if(!process.argv[2]&&(data.version!=='cfj-weekly-v1-reviewed'||data.weeks.length!==53))throw Error('Expected reviewed 53-week evidence');
const template=await readFile(new URL('weekly.template.html',root),'utf8');
const encoded=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
if(!template.includes('/* WEEKLY_EVIDENCE_DATA */'))throw Error('Evidence marker missing');
let voice={version:'cfj-weekly-host-v1',clips:[]};
try{voice=JSON.parse(await readFile(new URL('assets/weekly-audio/manifest.json',root),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
await writeFile(output,template.replace('/* WEEKLY_EVIDENCE_DATA */',`const EVIDENCE = ${encoded};`).replace('/* WEEKLY_CHALLENGE_DATA */',`const CHALLENGE = ${safe(WEEKLY_CHALLENGE)};`).replace('/* WEEKLY_VOICE_MANIFEST_DATA */',`const VOICE_MANIFEST = ${safe(voice)};`));
console.log(`Rendered ${typeof output==='string'?output:fileURLToPath(output)}`);
