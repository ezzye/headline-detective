const ORIGIN='https://codingforjustice.org.uk';
const ROUTES=new Set(['/api/health','/api/session','/api/respond','/api/reveal','/api/story','/api/speak','/api/campaign/session','/api/campaign/respond','/api/campaign/briefing','/api/campaign/reveal','/api/donations/options','/api/donations/status','/api/donations','/api/donations/mine','/api/donations/revoke']);
const SECURITY={'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-robots-tag':'noindex, nofollow','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://upload.wikimedia.org; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"};
const json=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{...SECURITY,'content-type':'application/json','cache-control':'no-store'}});
async function visitorHash(ip,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export default {async fetch(request,env){
 const url=new URL(request.url);if(url.pathname.startsWith('/api/')){
  if(!ROUTES.has(url.pathname)||!['GET','POST'].includes(request.method))return json(404,'not_found');
  const origin=request.headers.get('origin');if(request.method==='POST'&&origin!==ORIGIN)return json(403,'origin_rejected');
  if(request.method==='GET'&&origin&&origin!==ORIGIN)return json(403,'origin_rejected');
  if(!env.CFJ_GATEWAY_URL||!env.CFJ_GATEWAY_TOKEN)return json(503,'ai_temporarily_unavailable');
  const gateway=new URL(env.CFJ_GATEWAY_URL);if(gateway.protocol!=='https:'||!gateway.hostname.endsWith('.lambda-url.eu-west-1.on.aws'))return json(503,'gateway_unavailable');
  const ip=request.headers.get('cf-connecting-ip');if(!ip)return json(503,'edge_identity_unavailable');
  let body='';if(request.method==='POST'){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json(415,'application_json_required');if(Number(request.headers.get('content-length')||0)>16384)return json(413,'body_too_large');body=await request.text();if(new TextEncoder().encode(body).length>16384)return json(413,'body_too_large');}
  const id=request.headers.get('x-request-id');if(id&&!/^[A-Za-z0-9_-]{1,120}$/.test(id))return json(400,'invalid_request_id');
  try{const response=await fetch(new URL(url.pathname,gateway),{method:request.method,headers:{'x-gateway-token':env.CFJ_GATEWAY_TOKEN,origin:ORIGIN,'x-visitor-hash':await visitorHash(ip,env.CFJ_GATEWAY_TOKEN),'content-type':'application/json',...(id?{'x-request-id':id}:{})},...(request.method==='POST'?{body}:{}),redirect:'error',signal:AbortSignal.timeout(88000)});const headers={...SECURITY,'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'};return new Response(response.body,{status:response.status,headers});}catch{return json(503,'ai_temporarily_unavailable');}
 }
 if(!['GET','HEAD'].includes(request.method))return json(405,'method_not_allowed');
 if(url.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{...SECURITY,'content-type':'text/plain'}});
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1),file=FILES[name];if(!file)return json(404,'not_found');
 const bytes=file.encoding==='base64'?Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)):file.content;
 return new Response(request.method==='HEAD'?null:bytes,{headers:{...SECURITY,'content-type':file.type,'cache-control':'no-cache'}});
}};
