import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createGameServer} from './server.mjs';
const all=JSON.parse(await readFile(new URL('./campaigns.json',import.meta.url),'utf8'));
const get=id=>all.find(c=>c.id===id);
const post=(app,url,body)=>new Promise(resolve=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url,headers:{host:'127.0.0.1','content-type':'application/json'}});let status;app.server.emit('request',req,{writeHead(s){status=s},end(bytes){resolve({status,json:JSON.parse(bytes)})}})});
test('archive update reconciles retained and playable totals with canonical bundles',async()=>{
 assert.deepEqual(all.map(c=>c.allHeadlines.length),[90,32,15,10,17,15,15]);
 assert.equal(all.reduce((n,c)=>n+c.allHeadlines.length,0),194);
 assert.equal(all.reduce((n,c)=>n+c.campaigns.length,0),25);
 for(const c of all){const b=JSON.parse(await readFile(new URL(`./case-bundles/${c.id}.json`,import.meta.url),'utf8'));assert.deepEqual(c.allHeadlines,b.allHeadlines);assert.equal(c.source.selectedCount,c.campaigns.reduce((n,d)=>n+d.listedCount,0));for(const event of c.events)assert(c.evidence.some(e=>e.id===event.evidenceId));}
 const csv=await readFile(new URL('./recovered-headlines.csv',import.meta.url),'utf8');assert.equal(csv.trim().split(/\r?\n/).length,195);
});
test('captured versions never add articles or replace publication dates',()=>{
 const c=get('caroline-flack-recovered-campaign'),h=c.allHeadlines.find(r=>r.id==='h21');
 assert.equal(h.outlet,'The Sun');assert.equal(h.date,'2020-02-14');assert.match(h.originalURL,/10963166/);assert.equal(h.captureTimestamp,'2020-02-14T20:52:41Z');assert.equal(h.publicationDisplay,'14 Feb 2020, 12:02');assert.equal(h.modifiedDisplay,'14 Feb 2020, 12:33');assert.match(h.archiveURL,/20200214205241/);
 assert.equal(c.allHeadlines.filter(r=>r.originalURL===h.originalURL).length,1);
 const later=c.allHeadlines.find(r=>r.id==='h36');assert.equal(later.date,'2019-12-17');assert.match(later.captureTimestamp,/^2020-10-30/);
 const sky=get('bulley-campaign').allHeadlines.find(r=>r.id==='bulley-archive-20230214-sky-arrests');assert.equal(sky.date,'2023-02-14');assert.equal(sky.captureTimestamp,'2023-02-16T12:43:42Z');
});
test('BBC publication day respects British timezone and comparator stays outside subject count',()=>{
 const arday=get('arday-2026-campaign');const row=arday.allHeadlines.find(r=>r.publishedAtUTC==='2026-08-07T23:00:05.692Z');assert(row);assert.equal(row.published||row.date,'2026-08-08');assert.equal(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date(row.publishedAtUTC)),'2026-08-08');
 const sterling=get('sterling-campaign');assert.equal(sterling.start,'2018-05-28');assert.equal(sterling.days.length,203);assert(!sterling.allHeadlines.some(r=>/Foden/i.test(r.headline)));assert.match(sterling.comparison.foden.originalURL,/6241313/);
 const markle=get('markle-letter-campaign');assert.equal(markle.source.corpusCount,10);assert.equal(markle.source.selectedCount,9);assert.equal(markle.source.outletUniverse,4);
});
test('all researched outlet packets fit the prepaid request guard and preserve source/version caveats',async()=>{
 let bytes,packet,system;
 const app=createGameServer({env:{DEEPSEEK_API_KEY:'synthetic'},random:()=>0,fetchImpl:async(_url,opts)=>{bytes=Buffer.byteLength(opts.body)+750;const q=JSON.parse(opts.body);packet=JSON.parse(q.messages[1].content).trustedCampaign;system=q.messages[0].content;throw Error('synthetic transport');}});
 for(const c of all){const result=await post(app,'/api/campaign/session',{caseId:c.id});assert.equal(result.status,201);const s=result.json;
  for(const d of s.desks)for(const question of ['What did your further reports add?','How did social posts and editorials spread the allegations?','What did later judgments, inquiries and apologies establish?']){const state=app.sessions.get(s.sessionId);state.conversationByDesk[d.outletId]=Array.from({length:3},()=>({question:'Q'.repeat(400),answer:'A'.repeat(2000),evidenceIds:[c.evidence[0].id]}));bytes=0;await post(app,'/api/campaign/respond',{sessionId:s.sessionId,outletId:d.outletId,question});assert(bytes>0&&bytes<=65536,`${c.id}/${d.outletId} ${bytes}`);assert.match(packet.archiveAndVersionRule,/capture or update is not an additional article/);assert.match(system,/Observe archiveAndVersionRule/);assert(packet.chronologicalRecords.every(r=>r.relationToEvents.length===packet.events.length));}
 }
});
