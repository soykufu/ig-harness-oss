import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
const SCRIPT='/accounts/e76a3f504309ca9289d8dfa3ee504502/workers/scripts/soykufu-ig-harness-20261119';
const held=reason=>({ok:false,state:'backup_preflight_held',reason,exportAttempted:false,objectWritten:false,backupVerified:false,deploymentAuthorized:false});
export async function inspectBackupPreflight({env,readRuntime,readCode}){
 try{
  if(env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')return held('official_runtime_required');
  const before=await readRuntime();
  if(!before.deploymentStable||!before.deployedBindingsVerified||!before.preparationLockVerified||!before.extraFlagsVerified)return held('runtime_unverified');
  const code=await readCode();if(typeof code!=='string'||!code.length||Buffer.byteLength(code)>20*1024*1024)return held('script_content_unavailable');
  const after=await readRuntime();
  if(!after.deploymentStable||!after.deployedBindingsVerified||!after.preparationLockVerified||!after.extraFlagsVerified||after.deploymentFingerprint!==before.deploymentFingerprint)return held('runtime_changed');
  // A literal is only a diagnostic. It cannot prove that a live handler guards
  // every route, and absence/presence must never authorize storing a DB copy.
  const key=env.IG_DATABASE_BACKUP_KEY;
  return {ok:true,state:'backup_preflight_observed',deploymentFingerprint:after.deploymentFingerprint,scriptSha256:createHash('sha256').update(code).digest('hex'),privateNamespaceLiteralPresent:code.includes('__private_recovery__'),r2DirectPublicAccessDisabled:after.r2DirectPublicAccessDisabled===true,workerProxyExposureVerified:false,backupKeyPresent:typeof key==='string'&&key.length>0,backupKeyFormatValid:typeof key==='string'&&/^[a-fA-F0-9]{64}$/.test(key),exportAttempted:false,objectWritten:false,backupVerified:false,deploymentAuthorized:false};
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
  const text=Buffer.concat(parts).toString('utf8');if(path.endsWith('/content/v2'))return text;
  const json=JSON.parse(text);if(json.success!==true)throw Error('Read failed');return json.result;
 };
 const result=await inspectBackupPreflight({env:process.env,readRuntime:()=>readStoppedRuntimeSnapshot({read}),readCode:()=>read(SCRIPT+'/content/v2')});
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
