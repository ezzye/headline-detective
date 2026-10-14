import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {summarizeEditorials, validEditorialRecord} from './editorial-evidence.mjs';
import {createGameServer} from './server.mjs';

const campaigns=JSON.parse(await readFile(new URL('./campaigns.json',import.meta.url),'utf8'));
const caseItem=campaigns.find(item=>item.editorialRecords?.length) || campaigns[0];
const outlet=caseItem.campaigns[0].outlet;
const sample=()=>({id:'editorial-test-leader',caseId:caseItem.id,outlet,title:'Editorial on public accountability',date:caseItem.start,phase:'in_window',editorialType:'institutional_editorial',byline:null,label:'Editorial',url:'https://publisher.example/editorial',summary:'The editorial argued that the institution should explain its decision.',sourceBasis:'Publisher page captured with the editorial label.',contentBasis:'publisher_page',verifiedAt:'2026-10-14',linkedWrittenRecordId:caseItem.allHeadlines?.[0]?.id || null,evidenceIds:[caseItem.evidence[0].id],limit:'The page records the published argument, not private owner views.'});
const post=(app,url,body)=>new Promise(resolve=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url,headers:{host:'127.0.0.1','content-type':'application/json'}});let status;app.server.emit('request',req,{writeHead(s){status=s},end(bytes){resolve({status,json:JSON.parse(bytes)})}})});

test('real editorial audit keeps source classes, linked articles and later aftermath distinct',async()=>{
 const all=campaigns.flatMap(c=>c.editorialRecords||[]),summary=summarizeEditorials(all);assert.equal(summary.recordCount,10);assert.equal(summary.institutionalEditorialCount,6);assert.equal(summary.bylinedOpinionCount,4);assert.equal(summary.ownerStatementCount,0);assert.equal(summary.linkedWrittenRecordCount,5);assert.equal(summary.aftermathCount,1);
 for(const c of campaigns){assert(c.editorialRecords.every(r=>validEditorialRecord(r,c)));const bundle=JSON.parse(await readFile(new URL(`./case-bundles/${c.id}.json`,import.meta.url),'utf8'));assert.deepEqual(bundle.editorialRecords,c.editorialRecords);}
 const sterling=campaigns.find(c=>c.id==='sterling-campaign').editorialRecords;assert.equal(sterling.find(r=>r.editorialType==='bylined_opinion').byline,'Dave Kidd');assert.equal(sterling.find(r=>r.editorialType==='institutional_editorial').contentBasis,'contemporaneous_report');const flack=campaigns.find(c=>c.id==='caroline-flack-recovered-campaign');assert(flack.editorialRecords[0].date>flack.end);
});

test('editorial validation rejects bad phases, dates, bylines and unapproved references',()=>{
  const base=sample();assert(validEditorialRecord(base,caseItem));
  for(const mutate of [r=>r.phase='aftermath',r=>{r.phase='aftermath';r.date=caseItem.end},r=>{r.phase='in_window';r.date='1900-01-01'},r=>r.byline='Named Leader',r=>r.evidenceIds=['unapproved'],r=>r.linkedWrittenRecordId='missing-headline',r=>r.url='http://publisher.example/editorial']){
    const record={...base};mutate(record);assert.equal(validEditorialRecord(record,caseItem),false);
  }
  const after={...base,id:'editorial-test-aftermath',date:'2026-08-15',phase:'aftermath'};assert(validEditorialRecord(after,{...caseItem,end:'2026-08-14'}));
});

test('editorial summary separates aftermath and does not inflate written reports for a linked record',()=>{
  const one=sample(),later={...one,id:'editorial-later',phase:'aftermath',date:'2026-08-15'};
  const summary=summarizeEditorials([one,one,later]);assert.equal(summary.recordCount,2);assert.equal(summary.inWindowCount,1);assert.equal(summary.aftermathCount,1);assert.equal(summary.linkedWrittenRecordCount,1);assert.equal(summary.institutionalEditorialCount,2);
});

test('campaign packet contains compact exact-desk editorial evidence and offline reply avoids owner-intent inference',async t=>{
  const item=structuredClone(caseItem), record=sample();record.outlet=item.campaigns[0].outlet;const owner={...record,id:'editorial-owner-statement',editorialType:'owner_statement',byline:null,title:'Public owner statement',date:item.start,evidenceIds:[item.evidence[1].id]};
  item.evidence.push({id:'editorial-other-source',label:'Other publisher editorial',url:'https://other.example/editorial',text:'Other desk record.'});
  item.editorialRecords=[record,owner,{...record,id:'editorial-other',outlet:'A different publisher',evidenceIds:['editorial-other-source']}];
  const dir=await mkdtemp(path.join(tmpdir(),'editorial-guard-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'campaigns.json');await writeFile(file,JSON.stringify([item]));
  let captured;const app=createGameServer({env:{DEEPSEEK_API_KEY:'synthetic'},campaignsPath:file,random:()=>0,fetchImpl:async(_url,opts)=>{captured=JSON.parse(opts.body);throw Error('synthetic');}});
  const session=(await post(app,'/api/campaign/session',{caseId:item.id})).json,state=app.sessions.get(session.sessionId),desk=session.desks.find(d=>state.campaignByDesk[d.outletId].outlet===item.campaigns[0].outlet);
  const reply=(await post(app,'/api/campaign/respond',{sessionId:session.sessionId,outletId:desk.outletId,question:'What does the leader say about the proprietor?'})).json;
  const packet=JSON.parse(captured.messages[1].content).trustedCampaign;
  assert.equal(packet.editorialContext.ownRecords.length,2);assert.deepEqual(Object.keys(packet.editorialContext.ownRecords[0]).sort(),['date','evidenceIds','id','limit','phase','summary','type'].sort());
  assert.equal(packet.editorialContext.ownRecords[0].id,'editorial-test-leader');assert(!packet.evidence.some(e=>e.id==='editorial-other-source'));
  assert.match(captured.messages[0].content,/bylined opinion is not automatically the publisher’s position/);assert.match(captured.messages[0].content,/counter-speech is not this desk’s publication unless the publisher exactly matches/);
  assert.equal(reply.mode,'offline');assert.match(reply.reply,/public owner statement/);assert.match(reply.reply,/not evidence of private owner intent or opinion/);assert.deepEqual(reply.evidenceIds,[item.evidence[1].id]);
});

test('invalid editorial payloads make campaign data fail closed during session creation',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'editorial-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'campaigns.json');
  for(const mutate of [r=>r.date='1900-01-01',r=>r.phase='unknown',r=>r.byline='Someone',r=>r.evidenceIds=['missing']]){
    const item=structuredClone(caseItem);item.editorialRecords=[sample()];mutate(item.editorialRecords[0]);await writeFile(file,JSON.stringify([item]));const app=createGameServer({env:{},campaignsPath:file});assert.equal((await post(app,'/api/campaign/session',{caseId:item.id})).status,503);
  }
});
