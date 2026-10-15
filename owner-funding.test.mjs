import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileElevenAllowance} from './public-gateway.mjs';

const owner=(overrides={})=>({remainingUnits:0,balanceInitialized:false,usedUnits:7,reservedCalls:2,status:'unavailable',manual:true,manualFunded:true,asOf:'manual-note',...overrides});
const balance=(character_limit,character_count,next_character_count_reset_unix)=>({character_limit,character_count,...(next_character_count_reset_unix===undefined?{}:{next_character_count_reset_unix})});

test('first observation initializes unknown balance and keeps existing manual and audit state',()=>{
 const original=owner(),result=reconcileElevenAllowance(original,balance(100,25,2000),1_000_000);
 assert.notEqual(result,original);assert.equal(original.balanceInitialized,false);assert.equal(original.remainingUnits,0);
 assert.equal(result.remainingUnits,75);assert.equal(result.balanceInitialized,true);
 assert.deepEqual(result.allowanceObservation,{limitHighWater:100,periodEnd:2000});
 assert.equal(result.usedUnits,7);assert.equal(result.reservedCalls,2);assert.equal(result.status,'unavailable');assert.equal(result.manual,true);assert.equal(result.manualFunded,true);assert.equal(result.asOf,'manual-note');
});

test('first observation does not increase an already initialized local balance',()=>{
 const result=reconcileElevenAllowance(owner({remainingUnits:30,balanceInitialized:true}),balance(100,25),1_000_000);
 assert.equal(result.remainingUnits,30);
});

test('a higher provider limit adds only its increase and cannot exceed actual allowance',()=>{
 const first=reconcileElevenAllowance(owner({remainingUnits:60,balanceInitialized:true}),balance(100,20),1_000_000);
 assert.equal(first.remainingUnits,60);
 const topped=reconcileElevenAllowance(first,balance(130,20),1_001_000);
 assert.equal(topped.remainingUnits,90);assert.equal(topped.allowanceObservation.limitHighWater,130);
 const capped=reconcileElevenAllowance(topped,balance(150,80),1_002_000);
 assert.equal(capped.remainingUnits,70);assert.equal(capped.allowanceObservation.limitHighWater,150);
});

test('unchanged, receding, rebound limits and lower usage counts cannot refill spent local credits',()=>{
 let current=reconcileElevenAllowance(owner({remainingUnits:40,balanceInitialized:true,allowanceObservation:{limitHighWater:100,periodEnd:2000}}),balance(100,20),1_000_000);
 assert.equal(current.remainingUnits,40);
 current=reconcileElevenAllowance(current,balance(90,0),1_001_000);assert.equal(current.remainingUnits,40);
 current=reconcileElevenAllowance(current,balance(100,0),1_002_000);assert.equal(current.remainingUnits,40);
 current=reconcileElevenAllowance(current,balance(100,70),1_003_000);assert.equal(current.remainingUnits,30,'external consumption reduces local allowance');
 current=reconcileElevenAllowance(current,balance(100,0),1_004_000);assert.equal(current.remainingUnits,30,'a lower provider count cannot replenish locally spent credits');
});

test('an expired period and strictly later reset grant fresh actual allowance; earlier periods cannot roll state back',()=>{
 let current=reconcileElevenAllowance(owner({remainingUnits:5,balanceInitialized:true,allowanceObservation:{limitHighWater:100,periodEnd:2000}}),balance(100,95,2000),2_000_000);
 current=reconcileElevenAllowance(current,balance(50,10,3000),2_000_000);
 assert.equal(current.remainingUnits,40);assert.deepEqual(current.allowanceObservation,{limitHighWater:50,periodEnd:3000});
 assert.throws(()=>reconcileElevenAllowance(current,balance(100,0,2500),2_100_000),{code:'invalid_owner_balance'});
 assert.equal(current.allowanceObservation.periodEnd,3000);assert.equal(current.remainingUnits,40);
});

test('a later reset before the previous period ends does not release fresh credits',()=>{
 const current=owner({remainingUnits:5,balanceInitialized:true,allowanceObservation:{limitHighWater:100,periodEnd:2000}});
 const result=reconcileElevenAllowance(current,balance(200,0,3000),1_999_999);
 assert.equal(result.remainingUnits,5);assert.equal(result.allowanceObservation.periodEnd,2000);
 assert.equal(current.allowanceObservation.periodEnd,2000,'persisted input snapshot is not mutated');
 assert.equal(reconcileElevenAllowance(result,balance(200,0,3000),2_000_000).remainingUnits,200);
});

test('limit and count must be safe nonnegative bounded integers; invalid reads throw without mutation',()=>{
 const original=owner({remainingUnits:12,balanceInitialized:true,allowanceObservation:{limitHighWater:20,periodEnd:2000}});
 for(const bad of [balance(-1,0),balance(1,-1),balance(1.5,0),balance(Number.MAX_SAFE_INTEGER,0),balance(1,2_000_000_000),{character_limit:10},null]) {
  assert.throws(()=>reconcileElevenAllowance(original,bad,2_000_000),{code:'invalid_owner_balance'});
 }
 assert.equal(original.remainingUnits,12);assert.deepEqual(original.allowanceObservation,{limitHighWater:20,periodEnd:2000});
});

test('provider count above limit represents zero actual allowance',()=>{
 const result=reconcileElevenAllowance(owner({remainingUnits:12,balanceInitialized:true}),balance(10,11),1_000_000);
 assert.equal(result.remainingUnits,0);
});
