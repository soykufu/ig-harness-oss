import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import {businessSnapshot} from './stopped-migration-apply.mjs';
import {readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {inspectAppWebhook} from './soykufu-app-webhook-readonly.mjs';
const A='e76a3f504309ca9289d8dfa3ee504502',D='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const ORIGIN='https://soykufu-ig-harness-20261119.soykufu.workers.dev';
export const SECRET_BASELINE_FINGERPRINT='9c96599e2e5abdd130ee0be1caa37d2c44bb9b155a6bdde98db36bec14e5937f';
export function maskAllowedAccountColumns(rows,columns){
 if(!Array.isArray(rows)||rows.length!==1||!Array.isArray(columns))throw Error('account_requires_reconciliation');
 const out=structuredClone(rows);for(const name of ['app_secret','updated_at']){const i=columns.findIndex(c=>c.name===name);if(i<0)throw Error('account_schema_unverified');out[0]['t'+i]='allowed_column';out[0]['v'+i]='allowed_column';}return out;
}
export async function installExistingAppSecretOnce({official,snapshot,inspectApp,patch,verifySignature}){
 const r={ok:false,state:'receiving_secret_held',phase:'preflight',credentialWriteAttempted:false,credentialAccepted:false,subscriptionAttempted:false,messagesSent:0};
 try{
  if(!official)throw Error('one_dispatch_required');const before=await snapshot();
  if(before.appSecretEmpty!==true||before.secretEncrypted!==false)throw Error('credential_already_present');
  const app=await inspectApp();if(app?.ok!==true||app.appIdentityVerified!==true||app.listingIncomplete!==false)throw Error('app_unverified');
  const second=await snapshot();if(JSON.stringify(before)!==JSON.stringify(second))throw Error('baseline_changed');
  r.phase='credential_request';r.credentialWriteAttempted=true;if(await patch(before.accountId)!==true)throw Error('credential_write_unknown');r.credentialAccepted=true;
  r.phase='postcheck';const after=await snapshot();const fixed=x=>[x.accountId,x.runtime,x.installation,x.business,x.immutableAccount];
  const stable=JSON.stringify(fixed(before))===JSON.stringify(fixed(after));
  const appAfter=await inspectApp();const appUnchanged=JSON.stringify(app)===JSON.stringify(appAfter);
  if(!stable||!appUnchanged||after.secretEncrypted!==true||after.appSecretEmpty!==false)throw Error('postcheck_failed');
  const signatureVerified=await verifySignature();if(signatureVerified!==true)throw Error('signature_unverified');
  const final=await snapshot();if(JSON.stringify(after)!==JSON.stringify(final))throw Error('postcheck_failed');
  return{...r,ok:true,state:'stopped_receiving_secret_verified',encrypted:true,signatureVerified:true,existingPageTokenUnchanged:true,businessUnchanged:true,configurationUnchanged:true,subscriptionsUnchanged:true,verifyTokenChanged:false};
 }catch(e){return{...r,reason:['one_dispatch_required','credential_already_present','app_unverified','baseline_changed','credential_write_unknown','postcheck_failed','signature_unverified'].includes(e?.message)?e.message:'validation_failed'};}
}
async function json(response){if(!response.ok||!response.body)throw Error('read_failed');const rd=response.body.getReader(),parts=[];let n=0;try{for(;;){const{value,done}=await rd.read();if(done)break;n+=value.byteLength;if(n>16777216)throw Error('read_failed');parts.push(value);}}finally{await rd.cancel();}const v=JSON.parse(Buffer.concat(parts).toString());if(!v||v.error||v.success===false)throw Error('read_failed');return v;}
async function main(){return{ok:false,state:'receiving_secret_retired',consumedRunId:45330744132,credentialWriteAttempted:false};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'receiving_secret_held',phase:'preparation',credentialWriteAttempted:false};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
