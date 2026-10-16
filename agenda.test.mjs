import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('./agenda.html',import.meta.url),'utf8');
const data=JSON.parse(await readFile(new URL('./agenda-evidence.json',import.meta.url),'utf8'));
test('offline activity contains the published evidence exactly, without provider or remote script dependencies',()=>{
 const embedded=JSON.parse(html.match(/const EVIDENCE = ([\s\S]*?);\nconst esc/)[1]);assert.deepEqual(embedded,data);
 assert(!/<script[^>]+src=/.test(html));assert(!/\bfetch\s*\(/.test(html));assert.doesNotThrow(()=>new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
test('historical gaps remain unknown and distinct from observed zeros in narrow current pools',()=>{
 assert.equal(data.archive.before,null);assert.equal(data.archive.after,null);assert.match(data.archive.status,/unknown/i);
 const by=Object.fromEntries(data.observations.map(o=>[o.outlet,o]));
 assert.equal(by['BBC News'].leadCount,12);assert.equal(by['ITV News'].leadCount,7);assert.equal(by['Channel 4 News'].leadCount,11);
 assert.equal(by['ITV News'].reformLead,2);assert.match(by['Channel 4 News'].note,/Featured.*first screen/s);assert.match(by['BBC News'].note,/video playlist/);
 for(const o of data.observations){assert.match(o.captureSha256,/^[a-f0-9]{64}$/);assert(o.reformLead<=o.leadCount);assert.match(o.capturedAt,/UTC/)}
});
test('provenance and corrected primary publication date are retained',()=>{
 const bbc=data.publications.find(p=>p.url.endsWith('cqm26yr42ezko'));assert.match(bbc.date,/16 October 2026, 00:52 BST/);assert.match(bbc.detail,/attributes.*ITV/);
 assert(data.publications.some(p=>p.url.endsWith('cw3dj458re1vo')&&p.date.startsWith('14 October')));
 assert.match(data.summary,/ITV published the footage; BBC and Channel 4 reported/);
 for(const p of data.publications){assert.equal(new URL(p.url).protocol,'https:');assert(p.response);assert(p.type)}
});
