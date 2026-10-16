const ORIGIN='https://codingforjustice.org.uk';
const ROUTES=new Set(['/api/health','/api/session','/api/respond','/api/reveal','/api/story','/api/speak','/api/campaign/session','/api/campaign/respond','/api/campaign/briefing','/api/campaign/reveal','/api/donations/options','/api/donations/status','/api/donations','/api/donations/mine','/api/donations/revoke']);
const SECURITY={'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-robots-tag':'noindex, nofollow','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://upload.wikimedia.org; media-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"};
const json=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{...SECURITY,'content-type':'application/json','cache-control':'no-store'}});
async function visitorHash(ip,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export default {async fetch(request,env){
 env={...env,CFJ_GATEWAY_URL:env.CFJ_GATEWAY_URL||((typeof process!=='undefined')?process.env?.CFJ_GATEWAY_URL:null),CFJ_GATEWAY_TOKEN:env.CFJ_GATEWAY_TOKEN||((typeof process!=='undefined')?process.env?.CFJ_GATEWAY_TOKEN:null)};
 const url=new URL(request.url);if(url.pathname.startsWith('/api/')){
  if(!ROUTES.has(url.pathname)||!['GET','POST'].includes(request.method))return json(404,'not_found');
  const origin=request.headers.get('origin');if(request.method==='POST'&&origin!==ORIGIN)return json(403,'origin_rejected');
  if(request.method==='GET'&&origin&&origin!==ORIGIN)return json(403,'origin_rejected');
  // These are the public gateway's fixed contract, not account balances or
  // credentials. Loading a contribution form needs no private ledger read.
  if(request.method==='GET'&&url.pathname==='/api/donations/options')return new Response(JSON.stringify({enabled:Boolean(env.CFJ_GATEWAY_URL&&env.CFJ_GATEWAY_TOKEN),models:{deepseek:'deepseek-flash',elevenlabs:'eleven_v3'},providers:[{provider:'deepseek',model:'deepseek-flash',unit:'tokens'},{provider:'elevenlabs',model:'eleven_v3',unit:'characters'}],modes:['prepaid_remaining'],consentVersion:'public-provider-pool-v1',withdrawal:'Stops new calls; already dispatched calls may finish. Donations do not buy editorial control.'}),{headers:{...SECURITY,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  if(!env.CFJ_GATEWAY_URL||!env.CFJ_GATEWAY_TOKEN)return json(503,'ai_temporarily_unavailable');
  const gateway=new URL(env.CFJ_GATEWAY_URL);if(gateway.protocol!=='https:'||!gateway.hostname.endsWith('.lambda-url.eu-west-1.on.aws'))return json(503,'gateway_unavailable');
  const ip=request.headers.get('cf-connecting-ip');if(!ip)return json(503,'edge_identity_unavailable');
  let body='';if(request.method==='POST'){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json(415,'application_json_required');if(Number(request.headers.get('content-length')||0)>16384)return json(413,'body_too_large');body=await request.text();if(new TextEncoder().encode(body).length>16384)return json(413,'body_too_large');}
  const id=request.headers.get('x-request-id');if(id&&!/^[A-Za-z0-9_-]{1,120}$/.test(id))return json(400,'invalid_request_id');
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),88000);try{const response=await fetch(new URL(url.pathname,gateway).href,{method:request.method,headers:{'x-gateway-token':env.CFJ_GATEWAY_TOKEN,origin:ORIGIN,'x-visitor-hash':await visitorHash(ip,env.CFJ_GATEWAY_TOKEN),'content-type':'application/json',...(id?{'x-request-id':id}:{})},...(request.method==='POST'?{body}:{}),redirect:'manual',signal:controller.signal});if(response.status>=300&&response.status<400)return json(503,'gateway_redirect_rejected');const headers={...SECURITY,'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'};return new Response(response.body,{status:response.status,headers});}catch{return json(503,'ai_temporarily_unavailable');}finally{clearTimeout(deadline);}
 }
 if(!['GET','HEAD'].includes(request.method))return json(405,'method_not_allowed');
 if(url.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{...SECURITY,'content-type':'text/plain'}});
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1),file=FILES[name];if(!file)return json(404,'not_found');
 const staticHeaders={...SECURITY,'content-type':file.type,'cache-control':/^assets\/(host|weekly)-audio\/[a-f0-9]{64}\.mp3$/.test(name)?'public, max-age=31536000, immutable':name.startsWith('assets/')?'public, max-age=86400':'no-cache',...(file.etag?{etag:file.etag}:{})};
 if(file.etag&&request.headers.get('if-none-match')===file.etag)return new Response(null,{status:304,headers:staticHeaders});
 const bytes=file.encoding==='base64'?Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)):file.content;
 if(file.encoding==='base64'){
  staticHeaders['accept-ranges']='bytes';staticHeaders['content-length']=String(bytes.length);
  const range=request.headers.get('range'),ifRange=request.headers.get('if-range');
  if(request.method==='GET'&&range&&(!ifRange||ifRange===file.etag)){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start,end;
   if(match&&(match[1]||match[2])){start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]));end=match[1]?(match[2]?Number(match[2]):bytes.length-1):bytes.length-1;}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start){staticHeaders['content-range']=`bytes */${bytes.length}`;staticHeaders['content-length']='0';return new Response(null,{status:416,headers:staticHeaders})}
   end=Math.min(end,bytes.length-1);staticHeaders['content-range']=`bytes ${start}-${end}/${bytes.length}`;staticHeaders['content-length']=String(end-start+1);return new Response(bytes.slice(start,end+1),{status:206,headers:staticHeaders});
  }
 }
 return new Response(request.method==='HEAD'?null:bytes,{headers:staticHeaders});
}};
