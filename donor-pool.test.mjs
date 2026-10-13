import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createDonorPool, DONOR_CONSENT_VERSION } from './donor-pool.mjs';

const key = 'sk-' + 'synthetic-no-provider-calls'.repeat(2);
const consent = { version: DONOR_CONSENT_VERSION, publicVisitorUse:true, ownKey:true, providerBilling:true, noEditorialControl:true };
const wideCaps = { deepseek:{dailyCalls:100,monthlyCalls:100,dailyUnits:10000,monthlyUnits:10000},elevenlabs:{dailyCalls:100,monthlyCalls:100,dailyUnits:10000,monthlyUnits:10000} };
function setup(t, overrides = {}) {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()),'donor-tests-')), storagePath = path.join(dir,'vault.sqlite');
  const masterKey = randomBytes(32); let time = Date.parse('2026-10-13T12:00:00Z');
  const config = { enabled:true,storagePath,masterKey,clock:()=>time,caps:wideCaps,...overrides };
  const pool = createDonorPool(config); t.after(()=>{ pool.close(); rmSync(dir,{recursive:true,force:true}); });
  return { pool,dir,config,setTime:v=>{time=Date.parse(v);} };
}
function donation(pool, extras = {}) { return pool.addDonation({provider:'deepseek',key:key+randomBytes(8).toString('hex'),consent,mode:'capped',maxCallsPerMonth:4,maxUnitsPerMonth:100,expiresAt:'2027-01-01T00:00:00Z',nonce:randomBytes(16).toString('hex'),...extras}); }
function request(pool, maxUnits=30, nonce=randomBytes(16).toString('hex')) { return pool.reserve({provider:'deepseek',maxUnits,nonce}); }
const throws = (fn,code) => assert.throws(fn,e=>e.code===code);

test('disabled pool makes no vault and fails closed', () => {
  const pool=createDonorPool(); assert.equal(pool.status().enabled,false); throws(()=>donation(pool),'pool_disabled');
  throws(()=>createDonorPool({enabled:true,storagePath:'/private/tmp/irrelevant-vault'}),'invalid_master_key');
});
test('strict consent, provider allowlist, key, units and expiry validation', t=> {
  const {pool}=setup(t);
  for(const provider of ['__proto__','https://evil.invalid','other']) throws(()=>donation(pool,{provider}),'invalid_provider');
  throws(()=>donation(pool,{key:'secret\nheader'}),'invalid_key');
  throws(()=>donation(pool,{consent:{...consent,providerBilling:false}}),'consent_required');
  throws(()=>donation(pool,{mode:'unlimited'}),'invalid_mode');
  throws(()=>donation(pool,{maxUnitsPerMonth:0}),'invalid_donor_caps');
  throws(()=>donation(pool,{expiresAt:'invalid'}),'invalid_expiry');
  throws(()=>donation(pool,{endpoint:'https://evil.invalid'}),'invalid_schema');
  donation(pool); throws(()=>request(pool,65537),'invalid_request_units');
  throws(()=>request(pool,1.5),'invalid_request_units');
});
test('vault is encrypted, mode 0600, and status never contains secrets or individual names', t=> {
  const {pool,dir}=setup(t), added=donation(pool);
  const serialized=JSON.stringify(pool.status()); assert(!serialized.includes(key)); assert(!serialized.includes(added.revocationToken)); assert(!serialized.includes('donor_id'));
  for(const file of readdirSync(dir)) { assert.equal(statSync(path.join(dir,file)).mode & 0o777,0o600); const bytes=readFileSync(path.join(dir,file)); assert(!bytes.includes(Buffer.from(key))); assert(!bytes.includes(Buffer.from(added.revocationToken))); }
  assert.equal(pool.status(added.revocationToken).provider,'deepseek');
});
test('duplicate donation and request nonces cannot replay usage or reissue credentials',async t=> {
  const {pool}=setup(t), nonce='a'.repeat(32); donation(pool,{nonce}); throws(()=>donation(pool,{nonce}),'donation_replayed');
  const lease=request(pool,30,'b'.repeat(32)); throws(()=>request(pool,30,'b'.repeat(32)),'request_replayed');
  let called=0; await pool.credentialLease(lease.id,credential=>{ assert(credential.startsWith(key)); called++; });
  await assert.rejects(pool.credentialLease(lease.id,()=>called++),e=>e.code==='lease_already_dispatched'); assert.equal(called,1);
});
test('two pool instances reserve atomically and never overdraw donor units', async t=> {
  const {pool,config}=setup(t); donation(pool,{maxCallsPerMonth:10,maxUnitsPerMonth:100}); const second=createDonorPool(config); t.after(()=>second.close());
  const results=await Promise.all(Array.from({length:20},(_,i)=>Promise.resolve().then(()=>{try{return request(i%2?pool:second,30);}catch(e){return e.code;}})));
  assert.equal(results.filter(x=>typeof x==='object').length,3); assert.equal(pool.status().providers[0].monthlyUnits,90);
});
test('app caps bind all workers and zero budget cannot reserve',t=> {
  const caps=structuredClone(wideCaps); caps.deepseek.dailyUnits=0; const {pool,config}=setup(t,{caps}); donation(pool); throws(()=>request(pool,1),'app_budget_exhausted');
  throws(()=>createDonorPool({...config,caps:wideCaps}),'app_caps_mismatch');
});
test('validated success refunds only unused units; invalid actual units retain reservation',async t=> {
  const {pool}=setup(t); donation(pool); const lease=request(pool,60); await pool.credentialLease(lease.id,()=>{});
  throws(()=>pool.settle(lease.id,61),'invalid_actual_units'); assert.equal(pool.status().providers[0].monthlyUnits,60);
  pool.settle(lease.id,12); assert.equal(pool.status().providers[0].monthlyUnits,12); throws(()=>pool.settle(lease.id,0),'lease_not_inflight');
});
test('revocation stops new reservations and undispatched leases, without aborting an inflight call',async t=> {
  const {pool}=setup(t), added=donation(pool); const inflight=request(pool,30), pending=request(pool,30);
  let finish; const call=pool.credentialLease(inflight.id,()=>new Promise(resolve=>{finish=resolve;})); pool.revoke(added.revocationToken);
  throws(()=>request(pool,1),'pool_unavailable'); await assert.rejects(pool.credentialLease(pending.id,()=>assert.fail()),e=>e.code==='donor_unavailable');
  finish(); await call; pool.settle(inflight.id,5); assert.equal(pool.status(added.revocationToken).status,'revoked');
  throws(()=>pool.revoke(randomBytes(32).toString('base64url')),'invalid_revocation_token');
});
test('expired donors and month-crossing undispatched reservations fail closed',async t=> {
  const {pool,setTime}=setup(t); donation(pool,{expiresAt:'2026-12-01T00:00:00Z',maxUnitsPerMonth:100}); setTime('2026-10-31T23:59:59Z'); const lease=request(pool,80);
  setTime('2026-11-01T00:00:01Z'); await assert.rejects(pool.credentialLease(lease.id,()=>assert.fail()),e=>e.code==='donor_unavailable');
  assert.equal(pool.status().providers[0].monthlyUnits,0); const november=request(pool,90); assert.equal(november.maxUnits,90);
  setTime('2026-12-01T00:00:00Z'); throws(()=>request(pool,1),'pool_unavailable');
});
test('inflight settlement across month rollover stays in original budget period',async t=> {
  const {pool,setTime}=setup(t); donation(pool); setTime('2026-10-31T23:59:59Z'); const lease=request(pool,80); await pool.credentialLease(lease.id,()=>{});
  setTime('2026-11-01T00:00:01Z'); pool.settle(lease.id,10); assert.equal(pool.status().providers[0].monthlyUnits,0); request(pool,100);
});
test('provider timeout charges full reservation and makes no retry',async t=> {
  const {pool}=setup(t); donation(pool); donation(pool); let calls=0;
  await assert.rejects(pool.withProvider({provider:'deepseek',maxUnits:40,nonce:'timeout-test-nonce-123'},()=>{calls++;throw new Error('private-provider-payload '+key);}),e=>e.code==='provider_unavailable' && !e.message.includes(key));
  assert.equal(calls,1); assert.equal(pool.status().providers[0].monthlyUnits,40);
});
test('429 temporarily skips donor; credential rejection pauses donor; swaps stop at two keys',async t=> {
  const {pool,setTime}=setup(t), a=donation(pool), b=donation(pool); let calls=0;
  await assert.rejects(pool.withProvider({provider:'deepseek',maxUnits:20,nonce:'retry-test-nonce-12345'},()=>{calls++;throw {status:429};}),e=>e.code==='provider_unavailable');
  assert.equal(calls,2); assert.equal(pool.status(a.revocationToken).status,'cooldown'); assert.equal(pool.status(b.revocationToken).status,'cooldown');
  assert.equal(pool.status().providers[0].monthlyUnits,40); setTime('2026-10-13T12:02:00Z');
  await assert.rejects(pool.withProvider({provider:'deepseek',maxUnits:10,nonce:'auth-test-nonce-12345'},()=>{throw {status:401};}),e=>e.code==='provider_unavailable');
  assert.equal(pool.status(a.revocationToken).status,'paused'); assert.equal(pool.status(b.revocationToken).status,'paused');
});
test('successful retry has a fresh reservation and no infinite swap or replay',async t=> {
  const {pool}=setup(t); donation(pool); donation(pool); let calls=0; const input={provider:'deepseek',maxUnits:30,nonce:'success-retry-nonce-12345'};
  const value=await pool.withProvider(input,({attempt,info})=>{calls++;assert.equal(info.endpoint,'https://api.deepseek.com/chat/completions'); if(!attempt)throw {status:401};return {actualUnits:4,value:'validated text'};});
  assert.equal(value,'validated text'); assert.equal(calls,2); assert.equal(pool.status().providers[0].monthlyUnits,34);
  await assert.rejects(pool.withProvider(input,()=>assert.fail()),e=>e.code==='request_replayed');
});
test('different process workers cannot over-reserve shared durable database',async t=> {
  const {pool,config}=setup(t); donation(pool,{maxCallsPerMonth:10,maxUnitsPerMonth:100});
  const moduleUrl=new URL('./donor-pool.mjs',import.meta.url).href;
  const code=`import {createDonorPool} from ${JSON.stringify(moduleUrl)}; const p=createDonorPool({enabled:true,storagePath:process.env.TEST_VAULT,masterKey:process.env.TEST_MASTER,clock:()=>Date.parse('2026-10-13T12:00:00Z'),caps:JSON.parse(process.env.TEST_CAPS)});let ok=0;for(let i=0;i<10;i++){try{p.reserve({provider:'deepseek',maxUnits:30,nonce:process.pid+'-process-reserve-'+i});ok++;}catch(e){if(e.code!=='pool_unavailable')throw e;}}p.close();console.log(ok);`;
  const worker=()=>new Promise((resolve,reject)=>{ const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TEST_VAULT:config.storagePath,TEST_MASTER:config.masterKey.toString('hex'),TEST_CAPS:JSON.stringify(wideCaps)}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',exit=>exit?reject(new Error(err)):resolve(Number(out.trim()))); });
  const results=await Promise.all([worker(),worker(),worker()]); assert.equal(results.reduce((a,b)=>a+b,0),3); assert.equal(pool.status().providers[0].monthlyUnits,90);
});
test('durable pending charges survive reopening and wrong master key fails closed',t=> {
  const {pool,config}=setup(t); donation(pool); request(pool,40); const second=createDonorPool(config); assert.equal(second.status().providers[0].monthlyUnits,40); second.close();
  throws(()=>createDonorPool({...config,masterKey:randomBytes(32)}),'wrong_master_key');
});

test('prepaid remaining entitlement is finite lifetime usage and never refreshes at month rollover',async t=> {
  const {pool,setTime}=setup(t);
  const added=pool.addDonation({provider:'deepseek',key,consent,mode:'prepaid_remaining',maxCalls:10,remainingUnits:50,expiresAt:'2027-01-01T00:00:00Z',nonce:'prepaid-donation-nonce-123'});
  assert.equal(added.budgetPeriod,'lifetime'); assert.equal(added.remainingUnits,50);
  const lease=request(pool,40); await pool.credentialLease(lease.id,()=>{}); pool.settle(lease.id,40);
  setTime('2026-11-01T12:00:00Z'); throws(()=>request(pool,11),'pool_unavailable'); request(pool,10);
  assert.equal(pool.status(added.revocationToken).remainingUnits,0);
  setTime('2026-12-01T12:00:00Z'); throws(()=>request(pool,1),'pool_unavailable');
});
test('failed pre-dispatch durability hook prevents fetch and conservatively charges reservation',async t=> {
  const {pool}=setup(t); donation(pool); let fetched=0, finalized=0;
  await assert.rejects(pool.withProvider({provider:'deepseek',maxUnits:30,nonce:'durability-fail-nonce-123'},()=>{fetched++;}, {
    onReserved:async reservation=>{assert.equal(reservation.maxUnits,30); await pool.flush();throw new Error('snapshot unavailable');},
    onSettled:async settlement=>{finalized++;assert.equal(settlement.chargedUnits,30);}
  }),e=>e.code==='durability_unavailable');
  assert.equal(fetched,0); assert.equal(finalized,1); assert.equal(pool.status().providers[0].monthlyUnits,30);
});
test('persistence callbacks bracket provider invocation and checkpoint produces standalone complete SQLite file',async t=> {
  const {pool,config}=setup(t); donation(pool); const events=[];
  const value=await pool.withProvider({provider:'deepseek',maxUnits:30,nonce:'durable-success-nonce-123'},()=>{events.push('fetch');return {actualUnits:5,value:'answer'};},{
    onReserved:async ()=>{events.push('reserve-saved');await pool.flush();},
    onSettled:async ()=>{events.push('settle-saved');await pool.flush();}
  });
  assert.equal(value,'answer'); assert.deepEqual(events,['reserve-saved','fetch','settle-saved']);
  // Verify copying only the checkpointed main database retains usage (S3 snapshots omit WAL).
  const snapshot=path.join(path.dirname(config.storagePath),'snapshot.sqlite');
  const {writeFileSync}=await import('node:fs');writeFileSync(snapshot,readFileSync(config.storagePath),{mode:0o600});
  const restored=createDonorPool({...config,storagePath:snapshot});assert.equal(restored.status().providers[0].monthlyUnits,5);restored.close();
});
test('failed settlement persistence never retries a provider call',async t=> {
  const {pool}=setup(t); donation(pool);let fetched=0;
  await assert.rejects(pool.withProvider({provider:'deepseek',maxUnits:30,nonce:'settle-fail-nonce-12345'},()=>{fetched++;return {actualUnits:5,value:'answer'};},{onSettled:()=>{throw new Error('persist failed');}}),e=>e.code==='durability_unavailable');
  assert.equal(fetched,1);
});

test('same credential cannot multiply its allowance through duplicate active donations', t=> {
  const {pool}=setup(t), added=donation(pool,{key});
  throws(()=>donation(pool,{key}),'key_already_donated');
  request(pool,30);pool.revoke(added.revocationToken);
  throws(()=>donation(pool,{key}),'key_already_donated'); // Pending call may still charge.
});
