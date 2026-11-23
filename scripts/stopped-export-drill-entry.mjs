import {verifyStoppedExport} from './stopped-export-drill.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
const account='e76a3f504309ca9289d8dfa3ee504502',database='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const apiRoot='https://api.cloudflare.com/client/v4',databasePath=`/accounts/${account}/d1/database/${database}`;
const token=process.env.CLOUDFLARE_API_TOKEN;
async function api(path,body){
 const response=await fetch(apiRoot+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 const value=await response.json();if(!response.ok||value.success!==true)throw Error('Provider read failed');return value.result;
}
async function runtime(){return readStoppedRuntimeSnapshot({read:async path=>{if(!isStoppedRuntimeReadPath(path))throw Error('Unexpected path');return api(path);}});}
function checked(value){if(!value.deploymentStable||!value.deployedBindingsVerified||!value.preparationLockVerified||!value.extraFlagsVerified)throw Error('Stopped runtime evidence required');}
try{
 if(!token)throw Error('Official runner credential required');
 const before=await runtime();checked(before);
 const result=await verifyStoppedExport({
  query:async sql=>{if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('Single read required');return(await api(databasePath+'/query',{sql}))[0]?.results??[];},
  exportDatabase:async()=>{
   let current;
   for(let attempt=0;attempt<6;attempt++){
    const value=await api(databasePath+'/export',{output_format:'polling',dump_options:{compatibility:'d1'},...(current?{current_bookmark:current}:{})});
    if(value?.status==='complete')return value;
    if(value?.status==='error'||typeof value?.at_bookmark!=='string'||!/^[a-f0-9-]{59,64}$/i.test(value.at_bookmark)||current&&current!==value.at_bookmark)throw Error('Export held');
    current=value.at_bookmark;if(attempt<5)await new Promise(resolve=>setTimeout(resolve,2000));
   }
   throw Error('Export not complete within bounded observation');
  },
  download:async url=>{
   // Do not attach Cloudflare or admin credentials to the signed download URL.
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok||!response.body)throw Error('Download held');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024)throw Error('Export too large');chunks.push(value);}}finally{await reader.cancel();}
   return Buffer.concat(chunks).toString('utf8');
  },
 });
 const after=await runtime();checked(after);if(before.deploymentFingerprint!==after.deploymentFingerprint)throw Error('Runtime changed');
 console.log('Stopped export memory drill: '+JSON.stringify({...result,accountId:account,databaseId:database,sourceSha:process.env.GITHUB_SHA,observedAt:new Date().toISOString(),deploymentFingerprint:after.deploymentFingerprint}));
}catch{
 console.error('Stopped export memory drill could not complete; no SQL, download URL or credentials are logged. Inspect this run before retrying.');process.exitCode=1;
}
