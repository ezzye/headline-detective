import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {createGameServer} from './server.mjs';
import {validComparisonBundle,summarizeComparisonWindow} from './comparison-evidence.mjs';

const request=(app,url,body)=>new Promise(resolve=>{
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{method:'POST',url,headers:{host:'127.0.0.1','content-type':'application/json'}});
  let status;
  app.server.emit('request',req,{writeHead(code){status=code},end(value){resolve({status,body:JSON.parse(String(value))})}});
});
const session=async(app,caseId='jefferies-campaign')=>{
  const r=await request(app,'/api/campaign/session',{caseId});assert.equal(r.status,201);return r.body;
};
test('canonical comparison samples retain inquiry precision, separate units and incomplete recovery',async()=>{
  const bundles=JSON.parse(await readFile(new URL('./comparison-bundles.json',import.meta.url),'utf8'));
  assert.equal(bundles.length,6);assert(bundles.every(validComparisonBundle));
  const gap=bundles.find(b=>b.id==='comparison-cyril-smith');
  assert.equal(gap.anchor.publicDate,'1979-05');assert.equal(gap.windows.length,0);
  assert.equal(gap.coverageVerdict,'documented_non_pickup');
  const westwood=bundles.find(b=>b.id==='comparison-westwood');
  const summary=summarizeComparisonWindow(westwood,westwood.windows.find(w=>w.daysInclusive===7).id);
  assert.equal(summary.observedWrittenCount,5);assert.equal(summary.observedOpinionCount,1);
  assert.equal(summary.reportedDateOnlyExcludedCount,0);
  const recovery=JSON.parse(await readFile(new URL('./jefferies-recovery.json',import.meta.url),'utf8'));
  assert.equal(recovery.reportedSettlementArticles,40);assert.equal(recovery.coverReferences.length,5);
  assert.equal(recovery.newIndependentlyIdentifiedArticleCount,0);
  assert.equal(recovery.newRecoveredWebPageCount,2);assert.equal(recovery.recoveredWebArticles.length,2);
  assert(recovery.recoveredWebArticles.every(r=>r.membershipIn40==='item_mapping_unavailable'&&r.articleCountInSettlement===null));
  assert.equal(recovery.recoveredWebArticles[1].date,'2011-01-01');assert.match(recovery.recoveredWebArticles[1].archiveCaptureTimestamp,/^2011-01-02/);
  assert.equal(new Set(recovery.recoveredWebArticles.map(r=>r.originalURL)).size,2);
  assert.equal(recovery.coverReferences.filter(r=>r.subjectRole==='arrest_coverage').length,3);
  assert(recovery.coverReferences.every(r=>r.articleCount===null&&r.membershipIn40==='item_mapping_unavailable'));
});
test('comparison reply distinguishes inquiry-documented non-pickup from measured no-coverage',async()=>{
  let captured;
  const app=createGameServer({env:{DEEPSEEK_API_KEY:'test-only'},random:()=>0,fetchImpl:async(_,options)=>{captured=JSON.parse(options.body);throw Error('mock unavailable')}});
  const s=await session(app);const r=await request(app,'/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Does Cyril Smith show something that was not reported nationally?'});
  assert.equal(r.status,200);assert.equal(r.body.mode,'offline');assert.match(r.body.reply,/inquiry|IICSA/);
  assert.match(r.body.reply,/exceptions|Private Eye|New Statesman|national/);assert.match(r.body.reply,/not.*(?:census|claim)|unknown|unresolved/);
  assert(r.body.evidenceIds.includes('comparison-cyril-smith-sample'));
  const packet=JSON.parse(captured.messages[1].content).trustedCampaign;
  assert.equal(packet.comparisonContext.bundles.length,1);
  assert.equal(packet.comparisonContext.bundles[0].windows.length,0);
  assert.equal(packet.comparisonContext.bundles[0].anchor.datePrecision,'month');
  assert.match(captured.messages[0].content,/Cover teasers are not additional independent articles/);
});
test('named comparator cannot become this desk’s own publication or a guilt finding',async()=>{
  let captured;
  const app=createGameServer({env:{DEEPSEEK_API_KEY:'test-only'},random:()=>0,fetchImpl:async(_,options)=>{captured=JSON.parse(options.body);throw Error('mock unavailable')}});
  const s=await session(app,'caroline-flack-recovered-campaign');
  const r=await request(app,'/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Compare this with Prince Andrew. Did the posh receive no reporting?'});
  assert.equal(r.status,200);assert.equal(r.body.mode,'offline');
  const packet=JSON.parse(captured.messages[1].content).trustedCampaign;
  assert.equal(packet.comparisonContext.bundles[0].kind,'coverage_counterexample');
  assert(packet.comparisonContext.bundles[0].limits.some(limit=>/no admission|not.*conviction/i.test(limit)));
  assert.match(packet.comparisonContext.rule,/not this desk/);
  assert.match(r.body.reply,/not a (?:total|complete)|unmeasured|cannot/);
});
test('forty-article questions do not inflate eight selected packages with five cover references',async()=>{
  const app=createGameServer({env:{},random:()=>0});const s=await session(app);
  const r=await request(app,'/api/campaign/respond',{sessionId:s.sessionId,outletId:s.desks[0].outletId,question:'Can the 40 settled articles now be counted by day?'});
  assert.equal(r.status,200);assert.match(r.body.reply,/full article schedule has not been recovered/);
  assert.match(r.body.reply,/not five additional independent articles/);
  assert.match(r.body.reply,/pre-arrest|pre.*arrest/i);
  assert.deepEqual(r.body.evidenceIds,['recovery-settlement-scale','recovery-publisher-dates']);
});
