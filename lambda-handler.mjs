import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPublicGateway} from './public-gateway.mjs';

const fail=()=>({statusCode:503,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({error:'gateway_unavailable'}),isBase64Encoded:false});
function master(config) {const value=config.masterKey || config.donorMasterKey;const key=Buffer.isBuffer(value)?Buffer.from(value):typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value)?Buffer.from(value,'hex'):typeof value==='string'?Buffer.from(value,'base64'):Buffer.alloc(0);if(key.length!==32)throw new Error('invalid_master_key');return key;}
export function sealSnapshot(data,key) {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('cfj-private-snapshot-v1'));const content=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);return Buffer.from(JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:content.toString('base64')}));}
export function openSnapshot(bytes,key) {const envelope=JSON.parse(Buffer.from(bytes).toString());if(envelope.version!==1)throw new Error('invalid_snapshot');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAAD(Buffer.from('cfj-private-snapshot-v1'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString());}
export function sealAudioCache(bytes,key,cacheKey) {if(!/^[a-f0-9]{64}$/.test(cacheKey))throw new Error('invalid_audio_key');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('cfj-private-audio-v1:'+cacheKey));const encrypted=Buffer.concat([cipher.update(Buffer.from(bytes)),cipher.final()]);return Buffer.from(JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));}
export function openAudioCache(bytes,key,cacheKey) {if(!/^[a-f0-9]{64}$/.test(cacheKey))throw new Error('invalid_audio_key');const envelope=JSON.parse(Buffer.from(bytes).toString());if(envelope.version!==1)throw new Error('invalid_audio_cache');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAAD(Buffer.from('cfj-private-audio-v1:'+cacheKey));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);}

/** All invocations MUST use the same function with AWS reserved concurrency=1.
 * ETag conditions additionally stop stale snapshot overwrites. No EFS/WAL or
 * multiple-function writers. A conflict fails closed, never retries paid work. */
export function createLambdaHandler({loadConfig,loadSnapshot,saveSnapshot,audioStorageFactory,fetchImpl=globalThis.fetch,clock=Date.now,storageRoot}={}) {
  let running=false;
  return async event=>{
    if(running)return fail();running=true;let gateway,directory,key;
    try {
      const config=await loadConfig();if(config.singleConcurrency!==true)throw new Error('serialized_deployment_required');key=master(config);
      const loaded=await loadSnapshot();let etag=loaded?.etag || null;
      const snapshot=loaded?.body?openSnapshot(loaded.body,key):{state:{}};
      directory=await mkdtemp(path.join(storageRoot || await realpath(tmpdir()),'cfj-private-'));
      const storagePath=path.join(directory,'vault.sqlite');
      if(snapshot.database)await writeFile(storagePath,Buffer.from(snapshot.database,'base64'),{mode:0o600});
      const audioStorage=audioStorageFactory?audioStorageFactory({key,config}):null;
      gateway=createPublicGateway({config,storagePath,masterKey:key,state:snapshot.state || {},audioStorage,fetchImpl,clock,persist:async state=>{
        // pool.flush() is completed by gateway before this callback.
        const bytes=sealSnapshot({version:1,database:(await readFile(storagePath)).toString('base64'),state},key);
        const result=await saveSnapshot(bytes,{etag});if(!result?.etag)throw new Error('snapshot_save_unconfirmed');etag=result.etag;
      }});
      const isHttp=Boolean(event?.requestContext || event?.rawPath || event?.httpMethod || event?.headers);
      if(!isHttp&&event?.action==='update-owner-balance')return await gateway.updateOwnerBalance(event.report || {}); // IAM Invoke only.
      if(!isHttp&&event?.action==='refresh-owner-allowances')return await gateway.refreshOwnerAllowances(); // IAM Invoke only; free balance GETs.
      if(!isHttp&&event?.action==='prepare-reviewed-voice')return await gateway.prepareReviewedVoiceBatch(event.request || {}); // IAM Invoke only; fixed reviewed scripts only.
      if(!isHttp&&event?.action==='migrate-audio-cache')return await gateway.migrateInlineFixedAudio(); // IAM Invoke only; no provider calls.
      if(!isHttp)return fail();
      const method=event.requestContext?.http?.method || event.httpMethod;
      const rawBody=event.body || '';
      if(typeof rawBody!=='string'||Buffer.byteLength(rawBody)>22000)return {statusCode:413,body:JSON.stringify({error:'body_too_large'})};
      const body=event.isBase64Encoded?Buffer.from(rawBody,'base64').toString('utf8'):rawBody;
      const result=await gateway.handle({method,path:event.rawPath || event.path,headers:event.headers || {},body});
      return {statusCode:result.status,headers:result.headers,body:result.body,isBase64Encoded:result.isBase64Encoded};
    }catch{return fail();}
    finally{if(gateway)gateway.close();if(key)key.fill(0);if(directory)await rm(directory,{recursive:true,force:true});running=false;}
  };
}

let productionHandler;
export async function handler(event) {
  if(!productionHandler) {
    if(process.env.CFJ_SINGLE_CONCURRENCY!=='true')return fail();
    try {
      const [{SecretsManagerClient,GetSecretValueCommand},{S3Client,GetObjectCommand,PutObjectCommand,DeleteObjectCommand}]=await Promise.all([import('@aws-sdk/client-secrets-manager'),import('@aws-sdk/client-s3')]);
      const secrets=new SecretsManagerClient({}),s3=new S3Client({}),Bucket=process.env.CFJ_SNAPSHOT_BUCKET,Key=process.env.CFJ_SNAPSHOT_KEY || 'private/snapshot-v1.aes.json';
      const audioPrefix=process.env.CFJ_AUDIO_PREFIX || 'private/audio/';
      if(!Bucket||!process.env.CFJ_SECRET_ID||!/^private\/audio\/[A-Za-z0-9/_-]*$/.test(audioPrefix)||audioPrefix.includes('..'))return fail();
      productionHandler=createLambdaHandler({
        loadConfig:async()=>{const result=await secrets.send(new GetSecretValueCommand({SecretId:process.env.CFJ_SECRET_ID}));const config=JSON.parse(result.SecretString);return {...config,singleConcurrency:true};},
        loadSnapshot:async()=>{try {const result=await s3.send(new GetObjectCommand({Bucket,Key}));return {body:Buffer.from(await result.Body.transformToByteArray()),etag:result.ETag};}catch(e){if(e.name==='NoSuchKey'||e.$metadata?.httpStatusCode===404)return null;throw e;}},
        saveSnapshot:async(body,{etag})=>{const result=await s3.send(new PutObjectCommand({Bucket,Key,Body:body,ContentType:'application/json',ServerSideEncryption:'AES256',...(etag?{IfMatch:etag}:{IfNoneMatch:'*'})}));return {etag:result.ETag};},
        audioStorageFactory:({key})=>({
          get:async hash=>{if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('invalid_audio_key');try{const result=await s3.send(new GetObjectCommand({Bucket,Key:audioPrefix+hash+'.aes'}));return openAudioCache(Buffer.from(await result.Body.transformToByteArray()),key,hash);}catch(e){if(e.name==='NoSuchKey'||e.$metadata?.httpStatusCode===404)return null;throw e;}},
          put:async(hash,bytes)=>{if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('invalid_audio_key');await s3.send(new PutObjectCommand({Bucket,Key:audioPrefix+hash+'.aes',Body:sealAudioCache(bytes,key,hash),ContentType:'application/octet-stream',ServerSideEncryption:'AES256'}));},
          delete:async hash=>{if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('invalid_audio_key');await s3.send(new DeleteObjectCommand({Bucket,Key:audioPrefix+hash+'.aes'}));}
        })
      });
    }catch{return fail();}
  }
  return productionHandler(event);
}
