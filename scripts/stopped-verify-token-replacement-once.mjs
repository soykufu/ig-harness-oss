import {pathToFileURL} from 'node:url';
const ACCOUNT='e76a3f504309ca9289d8dfa3ee504502',DATABASE='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const ORIGIN='https://soykufu-ig-harness-20261119.soykufu.workers.dev';
export function verifyReplacementRun(e){
 return e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch'&&e.GITHUB_RUN_NUMBER==='96'&&e.GITHUB_RUN_ATTEMPT==='1'&&e.APPROVED_VERIFY_TOKEN_REPLACEMENT==='saved-note-replacement-only';
}

async function main(){return{ok:false,state:'verify_token_replacement_retired',operation:'saved_note_verification_replacement',consumedRunId:45624136946,credentialWriteAttempted:false,subscriptionAttempted:false,webhookRequestAttempted:false,messagesSent:0};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){console.log(JSON.stringify(await main()));process.exitCode=1;}
