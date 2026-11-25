import {pathToFileURL} from 'node:url';

export function inspectVerifyToken(env) {
 const base = {ok:false,state:'verify_token_metadata_held',credentialWritesAttempted:false,networkRequests:0,subscriptionAttempted:false,messagesSent:0};
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_RUN_NUMBER!=='90'||env.GITHUB_RUN_ATTEMPT!=='1')return {...base,reason:'official_single_run_required'};
 const value = env.IG_WEBHOOK_VERIFY_TOKEN;
 const present = typeof value==='string' && value.length>0;
 const formatValid = present && /^[A-Za-z0-9_-]{32,256}$/.test(value);
 return {...base,ok:formatValid,state:formatValid?'verify_token_metadata_verified':'verify_token_metadata_held',present,formatValid,...(!formatValid?{reason:present?'format_unverified':'missing'}:{})};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;try{result=inspectVerifyToken(process.env);}catch{result={ok:false,state:'verify_token_metadata_held',reason:'validation_failed'};}
 console.log(JSON.stringify(result));
 if(!result.ok)process.exitCode=1;
}
