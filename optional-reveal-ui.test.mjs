import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import vm from'node:vm';
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');const cases=JSON.parse(await readFile(new URL('./campaigns.json',import.meta.url),'utf8'));
const source=name=>html.match(new RegExp('function '+name+'\\([^\\n]+'))[0];
test('individual checks use reviewed answers when the live session omits them, and skipped checks earn no points',()=>{
 const c=cases.find(c=>c.id==='diallo-documents-campaign'),selected=c.reasoningChecks[0],skipped=c.reasoningChecks[1],nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:''});return nodes.get(id)};
 const context=vm.createContext({item:c,checks:c.reasoningChecks.map(({answer,explanation,...r})=>r),answers:{[selected.id]:selected.answer},checkedFeedback:{},$: $,document:{querySelector:$},esc:x=>String(x),evidenceLink:id=>id});
 for(const name of ['reviewedCheck','checkFeedbackHTML','updateCheckProgress','checkOne'])vm.runInContext(source(name),context);
 vm.runInContext(`checkOne('${selected.id}');checkOne('${skipped.id}');`,context);
 assert.match(nodes.get('#check-progress').textContent,/2 \/ 2/);assert.match(nodes.get(`[data-check-feedback="${selected.id}"]`).innerHTML,/Correct · 2 points/);assert.match(nodes.get(`[data-check-feedback="${skipped.id}"]`).innerHTML,/Answer shown · no score/);assert.match(nodes.get(`[data-check-feedback="${skipped.id}"]`).innerHTML,/12/);
});
