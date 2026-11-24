import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{businessSnapshot}from'./stopped-migration-apply.mjs';import{readStoppedInstallationSnapshot}from'./stopped-installation-snapshot.mjs';import{readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath}from'./stopped-runtime-snapshot.mjs';
const A='e76a3f504309ca9289d8dfa3ee504502',D='e55c3b84-ea9a-48fd-a7a3-08253089d295',NAME='soykufu-ig-harness-20261119',W='/accounts/'+A+'/workers/scripts/'+NAME,ORIGIN='https://'+NAME+'.soykufu.workers.dev';
export const APP_ID='2224712165014101',APP_ID_BASELINE='9c96599e2e5abdd130ee0be1caa37d2c44bb9b155a6bdde98db36bec14e5937f';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function appIdSettingsPatch(settings,latestId,deployedId){
 if(!latestId||latestId!==deployedId||!Array.isArray(settings?.bindings)||settings.bindings.some(b=>b.name==='IG_APP_ID'))throw Error('settings_unverified');
 const names=settings.bindings.map(b=>b.name);if(names.some(n=>typeof n!=='string'||!n)||new Set(names).size!==names.length)throw Error('settings_unverified');
 if(!settings.bindings.some(b=>b.name==='OUTBOUND_PREPARATION_LOCK'&&b.type==='plain_text'&&b.text==='1'))throw Error('lock_unverified');
 const annotations=Object.fromEntries(Object.entries(settings.annotations||{}).filter(([k])=>k==='workers/message'||k==='workers/tag'));
 return{bindings:[...names.map(name=>({name,type:'inherit'})),{name:'IG_APP_ID',type:'plain_text',text:APP_ID}],...(Object.keys(annotations).length?{annotations}:{})};
}
export function settingsWithoutGeneratedAnnotations(s){const c=structuredClone(s);if(c.annotations){delete c.annotations['workers/triggered_by'];if(!Object.keys(c.annotations).length)delete c.annotations;}if(Array.isArray(c.bindings))c.bindings.sort((a,b)=>a.name.localeCompare(b.name));const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;return sort(c);}
export async function installReceivingAppIdOnce({official,snapshot,patch,readLiveAppId}){
 const r={ok:false,state:'receiving_app_id_held',phase:'preflight',settingsWriteAttempted:false,settingsAccepted:false,dbChanges:0,secretsChanged:0,subscriptionAttempted:false,messagesSent:0};
 try{if(!official)throw Error('one_dispatch_required');const before=await snapshot(true),payload=appIdSettingsPatch(before.settings,before.latestId,before.deployedId),second=await snapshot(true);if(JSON.stringify(before)!==JSON.stringify(second))throw Error('baseline_changed');
  r.phase='settings_request';r.settingsWriteAttempted=true;if(await patch(payload)!==true)throw Error('settings_unknown');r.settingsAccepted=true;r.phase='postcheck';
  const after=await snapshot(false),expected={...before.settings,bindings:[...before.settings.bindings,{name:'IG_APP_ID',type:'plain_text',text:APP_ID}]};
  if(JSON.stringify(settingsWithoutGeneratedAnnotations(expected))!==JSON.stringify(settingsWithoutGeneratedAnnotations(after.settings))||JSON.stringify(before.business)!==JSON.stringify(after.business)||JSON.stringify(before.installation)!==JSON.stringify(after.installation)||before.codeHash!==after.codeHash||before.assetsHash!==after.assetsHash)throw Error('postcheck_failed');
  if(await readLiveAppId()!==APP_ID)throw Error('app_id_unverified');const final=await snapshot(false);if(JSON.stringify(after)!==JSON.stringify(final))throw Error('postcheck_failed');
  return{...r,ok:true,state:'stopped_receiving_app_id_verified',deploymentFingerprint:after.fingerprint,appIdConfigured:true,existingBindingsPreserved:true,businessUnchanged:true,modulesUnchanged:true,assetsUnchanged:true};
 }catch(e){return{...r,reason:['one_dispatch_required','settings_unverified','lock_unverified','baseline_changed','settings_unknown','postcheck_failed','app_id_unverified'].includes(e?.message)?e.message:'validation_failed'};}
}
async function main(){return{ok:false,state:'receiving_app_id_retired',consumedRunId:45331593999,settingsWriteAttempted:false};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'receiving_app_id_held',phase:'preparation',settingsWriteAttempted:false};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
