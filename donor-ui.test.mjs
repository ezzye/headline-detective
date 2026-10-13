import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('./donate.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
async function page(options) {
  const elements=new Map(),calls=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,textContent:'',innerHTML:'',className:'',events:{},classList:{remove(){}},scrollIntoView(){},addEventListener(name,handler){this.events[name]=handler;}});
    return elements.get(id);
  };
  element('#remaining').value='30000';element('#max-calls').value='25';element('#mode').value='prepaid_remaining';element('#expiry').value=new Date(Date.now()+86400000).toISOString().slice(0,16);
  const context=vm.createContext({document:{querySelector:element,createElement:()=>({click(){}})},location:{href:'https://codingforjustice.org.uk/donate.html',origin:'https://codingforjustice.org.uk'},URL,Blob,Date,Number,Boolean,Array,String,Set,Error,setTimeout,matchMedia:()=>({matches:true}),fetch:async(path,init)=>{
    calls.push({path,init});return {ok:true,status:200,json:async()=>path.endsWith('/options')?options:{donationId:'synthetic-id',revocationToken:'synthetic-private-code'}};
  }});
  vm.runInContext(script,context);await new Promise(resolve=>setImmediate(resolve));
  return {elements,calls,el:element,submit:()=>element('#contribution-form').events.submit({preventDefault(){}})};
}
const options={enabled:true,models:{deepseek:'deepseek-flash',elevenlabs:'eleven_v3'},providers:[{provider:'deepseek',model:'deepseek-flash',unit:'tokens'},{provider:'elevenlabs',model:'eleven_v3',unit:'characters'}],consentVersion:'public-provider-pool-v1'};

test('authoritative provider rows populate both model choices despite models object and submit the gateway schema',async()=>{
  for(const row of options.providers){
    const p=await page(options);assert.equal(p.el('#provider').disabled,false);assert.equal(p.el('#submit').disabled,false);assert.match(p.el('#provider').innerHTML,/value="deepseek"/);assert.match(p.el('#provider').innerHTML,/value="elevenlabs"/);
    p.el('#provider').value=row.provider;p.el('#provider').onchange();assert.equal(p.el('#model').disabled,false);assert(p.el('#model').innerHTML.includes(`value="${row.model}"`));
    p.el('#model').value=row.model;p.el('#api-key').value='synthetic-only-key';p.el('#consent').checked=true;await p.submit();
    assert.equal(p.calls.length,2);const submitted=p.calls[1];assert.equal(submitted.path,'/api/donations');assert.equal(submitted.init.credentials,'same-origin');
    const body=JSON.parse(submitted.init.body);assert.deepEqual(Object.keys(body).sort(),['apiKey','consent','consentVersion','expiresAt','maxCalls','mode','model','provider','remainingUnits']);
    assert.equal(body.provider,row.provider);assert.equal(body.model,row.model);assert.equal(body.apiKey,'synthetic-only-key');assert.equal(body.mode,'prepaid_remaining');assert.equal(body.consentVersion,options.consentVersion);assert.equal(body.consent,true);assert.equal(body.remainingUnits,30000);assert.equal(body.maxCalls,25);assert(Date.parse(body.expiresAt)>Date.now());assert.equal(p.el('#api-key').value,'');
  }
});
test('missing provider rows fail closed and cannot fall back to untrusted models arrays',async()=>{
  const p=await page({enabled:true,models:[{provider:'deepseek',model:'not-authoritative'}],consentVersion:options.consentVersion});assert.equal(p.el('#provider').disabled,true);assert.equal(p.el('#submit').disabled,true);await p.submit();assert.equal(p.calls.length,1);
});
test('forged model and fractional allowance are rejected before sending a key',async()=>{
  const p=await page(options);p.el('#provider').value='deepseek';p.el('#model').value='unapproved-model';p.el('#api-key').value='synthetic-only-key';p.el('#consent').checked=true;await p.submit();assert.equal(p.calls.length,1);assert.match(p.el('#form-status').textContent,/available provider and model/);
  p.el('#model').value='deepseek-flash';p.el('#remaining').value='1.5';await p.submit();assert.equal(p.calls.length,1);assert.match(p.el('#form-status').textContent,/whole usage units/);
});
test('consent assigns provider account auto-topup and overage settings to the donor',()=>{
  assert.match(html,/must disable automatic top-ups and paid overages in my provider account myself/);assert.match(html,/this site does not buy credit or change those account settings/);assert.doesNotMatch(html,/no automatic top-up will occur/);
});

test('hero offers a bounded API key allowance and its CTA targets the actual form',()=>{
  assert.match(html,/<h1>Donate a capped API key\.<\/h1>/);
  assert.match(html,/this page takes no money or card details/);
  assert.match(html,/href="#contribution-form">Donate API key to help the justice project/);
  assert.match(html,/<form id="contribution-form">/);
  assert.match(html,/Maximum shared tokens or characters/);
  assert.match(html,/Your allowance does not renew automatically/);
  assert.doesNotMatch(html,/Fund the work|No automatic top-ups/);
});
