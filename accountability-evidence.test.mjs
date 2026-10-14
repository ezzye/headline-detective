import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validAccountabilityRecord} from './accountability-evidence.mjs';
import {buildAttentionTimeline} from './attention-timeline.mjs';
const cases=JSON.parse(await readFile(new URL('./campaigns.json',import.meta.url),'utf8'));
test('all seven cases have dated, source-backed accountability records without increasing the written sample',()=>{
  assert.equal(cases.reduce((n,c)=>n+c.allHeadlines.length,0),209);
  assert.equal(cases.reduce((n,c)=>n+c.accountabilityRecords.length,0),18);
  for(const c of cases){
    if(!c.id.startsWith('greenwood-pre2022')&&!c.id.startsWith('diallo-documents'))assert(c.accountabilityRecords.length>0,c.id);else assert.equal(c.accountabilityRecords.length,0,'No later ruling fabricated for new early-football sample');
    for(const r of c.accountabilityRecords)assert.equal(validAccountabilityRecord(r,c),true,r.id);
    assert.equal(new Set(c.accountabilityRecords.map(r=>r.id)).size,c.accountabilityRecords.length);
    assert.equal(buildAttentionTimeline(c).rows.some(r=>r.id.startsWith('account-')),false);
  }
});
test('later findings cannot be marked as knowledge within the publication window',()=>{
  const c=cases.find(c=>c.id==='markle-letter-campaign'),r=c.accountabilityRecords[0];
  assert.equal(validAccountabilityRecord({...r,phase:'within_window'},c),false);
  assert.equal(validAccountabilityRecord({...r,status:'all_coverage_illegal'},c),false);
  assert.equal(validAccountabilityRecord({...r,evidenceIds:['missing']},c),false);
  assert.equal(validAccountabilityRecord({...r,date:'2021-02-31'},c),false);
});
test('Markle procedural and merits decisions and Flack statement/publication dates stay separate',()=>{
  const m=cases.find(c=>c.id==='markle-letter-campaign');
  assert.match(m.evidence.find(e=>e.id==='initial-judgment').text,/procedural ruling did not determine/i);
  assert.match(m.context.retrospectiveEvidence[0].text,/did not determine substantive/i);
  assert.equal(m.accountabilityRecords.find(r=>r.id==='account-markle-summary').date,'2021-02-11');
  const f=cases.find(c=>c.id==='caroline-flack-recovered-campaign').accountabilityRecords.find(r=>r.id==='account-flack-cps-inquest');
  assert.equal(f.date,'2020-07-28');assert.equal(f.publicationDate,'2025-11-10');
});
