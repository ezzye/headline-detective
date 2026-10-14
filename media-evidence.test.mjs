import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
import {summarizeMedia,validMediaRecord} from './media-evidence.mjs';import {createGameServer} from './server.mjs';
const cases=JSON.parse(await readFile(new URL('./campaigns.json',import.meta.url),'utf8'));
const post=(app,url,body)=>new Promise(resolve=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url,headers:{host:'127.0.0.1','content-type':'application/json'}});let status;app.server.emit('request',req,{writeHead(s){status=s},end(bytes){resolve({status,json:JSON.parse(bytes)})}})});
test('cross-media sample preserves written census boundaries and accounts for linked formats',async()=>{
 assert.equal(cases.reduce((n,c)=>n+c.allHeadlines.length,0),179);const media=cases.flatMap(c=>c.mediaRecords);assert.equal(media.length,10);assert.equal(new Set(media.map(r=>r.id)).size,10);assert.equal(summarizeMedia(media).linkedWrittenFormats,3);
 assert.deepEqual(summarizeMedia(media).categories.map(c=>c.count),[6,2,2]);
 for(const c of cases){assert.equal(c.mediaScope.recordCount,c.mediaRecords.length);assert(c.mediaRecords.every(r=>validMediaRecord(r,c)));const bundle=JSON.parse(await readFile(new URL(`./case-bundles/${c.id}.json`,import.meta.url),'utf8'));assert.deepEqual(bundle.mediaRecords,c.mediaRecords);assert.deepEqual(bundle.mediaScope,c.mediaScope);}
 assert(!media.some(r=>r.date>'2018-12-16'&&r.caseId==='sterling-campaign'));assert(!media.some(r=>r.outlet==='GB News'&&r.caseId==='arday-2026-campaign'));
 const guest=media.find(r=>r.programme==='Last Orders - a spiked podcast');assert.equal(guest.outlet,'Spiked');assert.equal(guest.channel,'podcast');
});
test('a repeated programme remains one source, full duration is not topic time, and current counters retain observation date',()=>{
 const r=cases.flatMap(c=>c.mediaRecords).find(r=>r.outlet==='BBC Radio 4');const summary=summarizeMedia([r,r]);assert.equal(summary.recordCount,1);assert.equal(summary.knownBroadcastSlots,2);assert.deepEqual(r.distributionEvents.map(e=>e.time),['16:30','21:30']);assert.equal(r.duration.totalSeconds,1680);assert.equal(r.duration.topicSeconds,null);assert.match(r.summary,/war reporting/);
 const v=cases.flatMap(c=>c.mediaRecords).find(r=>r.observedMetrics.length);assert.equal(v.date,'2023-02-15');assert.equal(v.dateBasis,'platform_upload_date');assert.equal(v.observedMetrics[0].value,56500);assert.match(v.observedMetrics[0].observedAt,/^2026-10-14/);assert.match(v.observedMetrics[0].scope,/not unique people, campaign-period views/);
});
test('invalid media dates, evidence and invented topic durations fail closed at session creation',async t=>{
 const c=structuredClone(cases.find(c=>c.id==='bulley-campaign')),dir=await mkdtemp(path.join(tmpdir(),'media-guard-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'campaigns.json');
 for(const mutate of [r=>r.date='2023-02-23',r=>r.evidenceIds=['unapproved'],r=>{r.duration.totalSeconds=28;r.duration.topicSeconds=30},r=>r.url='javascript:alert(1)']){
  const item=structuredClone(c);mutate(item.mediaRecords[0]);await writeFile(file,JSON.stringify([item]));const app=createGameServer({env:{},campaignsPath:file});assert.equal((await post(app,'/api/campaign/session',{caseId:item.id})).status,503);
 }
});
test('media Q&A attributes only selected publisher records and distinguishes gaps from absence',async()=>{
 let captured;const app=createGameServer({env:{DEEPSEEK_API_KEY:'synthetic'},random:()=>0,fetchImpl:async(_url,opts)=>{captured=JSON.parse(opts.body);throw Error('synthetic');}}),c=cases.find(c=>c.id==='caroline-flack-recovered-campaign'),s=(await post(app,'/api/campaign/session',{caseId:c.id})).json,state=app.sessions.get(s.sessionId),itv=s.desks.find(d=>state.campaignByDesk[d.outletId].outlet==='ITV News'),other=s.desks.find(d=>d.outletId!==itv.outletId);
 const reply=(await post(app,'/api/campaign/respond',{sessionId:s.sessionId,outletId:itv.outletId,question:'What did the video add beyond the written report?'})).json;
 let packet=JSON.parse(captured.messages[1].content).trustedCampaign;assert.equal(packet.mediaContext.ownRecords.length,2);assert.match(captured.messages[0].content,/Only defend this desk's own chronologicalRecords, selectedDeskRecordDates and mediaContext.ownRecords/);assert(packet.mediaContext.ownRecords.every(r=>r.linkedWrittenRecordId));assert.match(reply.reply,/second format/);assert.doesNotMatch(reply.reply,/ITV/);assert(reply.evidenceIds.every(id=>id.startsWith('media-')));
 const question='Was a foreign state paying for this social media campaign?';const out=(await post(app,'/api/campaign/respond',{sessionId:s.sessionId,outletId:other.outletId,question})).json;packet=JSON.parse(captured.messages[1].content).trustedCampaign;assert.equal(packet.mediaContext.ownRecords.length,0);assert.equal(packet.mediaContext.otherOutletRecordCount,2);assert.match(out.reply,/collection gap, not proof/);assert.match(out.reply,/do not establish who paid/);assert.match(captured.messages[0].content,/Never infer financing, direction or foreign coordination/);assert(!packet.evidence.some(e=>e.id.startsWith('media-')));
});
