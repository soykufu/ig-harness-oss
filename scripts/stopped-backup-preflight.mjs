import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
const SCRIPT='/accounts/e76a3f504309ca9289d8dfa3ee504502/workers/scripts/soykufu-ig-harness-20261119';
const held=reason=>({ok:false,state:'backup_preflight_held',reason,exportAttempted:false,objectWritten:false,backupVerified:false,deploymentAuthorized:false});
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function summarizeWorkerBundle(bytes,contentType,entrypoint=null){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>20*1024*1024||typeof contentType!=='string'||entrypoint!==null&&!/^[a-zA-Z0-9_./-]{1,200}$/.test(entrypoint))throw Error('Invalid bundle');
 const modules=[];let namespace=false;
 const add=(name,type,data)=>{if(!/^[a-zA-Z0-9_./-]{1,200}$/.test(name)||modules.some(m=>m.name===name))throw Error('Invalid module');const isCode=/(?:javascript|ecmascript)/i.test(type);namespace ||= isCode&&data.includes(Buffer.from('__private_recovery__'));modules.push({name,type,sha256:digest(data)});};
 if(/^multipart\/form-data\b/i.test(contentType)){
  const form=await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();
  for(const [name,value]of form){if(typeof value==='string')add(name,'text/plain',Buffer.from(value));else add(name,value.type,Buffer.from(await value.arrayBuffer()));}
 }else if(/^(?:application|text)\/(?:javascript|ecmascript)\b/i.test(contentType))add(entrypoint||'worker.js',contentType.split(';')[0].toLowerCase(),bytes);
 else throw Error('Unexpected bundle type');
 if(!modules.length||modules.length>100||!modules.some(m=>/(?:javascript|ecmascript)/i.test(m.type))||entrypoint!==null&&!modules.some(m=>m.name===entrypoint))throw Error('Invalid bundle');
 modules.sort((a,b)=>a.name.localeCompare(b.name,'en'));
 return{bundleSha256:digest(JSON.stringify({entrypoint,modules})),privateNamespaceLiteralPresent:namespace,entrypoint,modules};
}
export async function inspectBackupPreflight({env,readRuntime,readCode}){
 try{
  if(env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')return held('official_runtime_required');
  const before=await readRuntime();
  if(!before.deploymentStable||!before.deployedBindingsVerified||!before.preparationLockVerified||!before.extraFlagsVerified)return held('runtime_unverified');
  const code=await readCode();const bundle=typeof code==='string'?await summarizeWorkerBundle(Buffer.from(code),'application/javascript'):code;
  if(!bundle||!Array.isArray(bundle.modules)||!/^[a-f0-9]{64}$/.test(bundle.bundleSha256))return held('script_content_unavailable');
  const after=await readRuntime();
  if(!after.deploymentStable||!after.deployedBindingsVerified||!after.preparationLockVerified||!after.extraFlagsVerified||after.deploymentFingerprint!==before.deploymentFingerprint)return held('runtime_changed');
  // A literal is only a diagnostic. It cannot prove that a live handler guards
  // every route, and absence/presence must never authorize storing a DB copy.
  const key=env.IG_DATABASE_BACKUP_KEY;
  return {ok:true,state:'backup_preflight_observed',deploymentFingerprint:after.deploymentFingerprint,scriptBundleSha256:bundle.bundleSha256,entrypoint:bundle.entrypoint,modules:bundle.modules,privateNamespaceLiteralPresent:bundle.privateNamespaceLiteralPresent,r2DirectPublicAccessDisabled:after.r2DirectPublicAccessDisabled===true,workerProxyExposureVerified:false,backupKeyPresent:typeof key==='string'&&key.length>0,backupKeyFormatValid:typeof key==='string'&&/^[a-fA-F0-9]{64}$/.test(key),exportAttempted:false,objectWritten:false,backupVerified:false,deploymentAuthorized:false};
 }catch{return held('read_failed');}
}
async function main(){
 const token=process.env.CLOUDFLARE_API_TOKEN;
 const read=async path=>{
  if(!token||!isStoppedRuntimeReadPath(path)&&path!==SCRIPT+'/content/v2')throw Error('Read only');
  const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
  if(!r.ok||!r.body)throw Error('Read failed');
  const reader=r.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024)throw Error('Oversize');parts.push(value);}}finally{await reader.cancel();}
  const bytes=Buffer.concat(parts);if(path.endsWith('/content/v2'))return summarizeWorkerBundle(bytes,r.headers.get('content-type'),r.headers.get('cf-entrypoint'));
  const text=bytes.toString('utf8');
  const json=JSON.parse(text);if(json.success!==true)throw Error('Read failed');return json.result;
 };
 const result=await inspectBackupPreflight({env:process.env,readRuntime:()=>readStoppedRuntimeSnapshot({read}),readCode:()=>read(SCRIPT+'/content/v2')});
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
