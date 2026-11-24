import {pathToFileURL} from 'node:url';
// The one approved export/storage was consumed by #40, run45304780947.
// Production export/download/put transport is retired; pure codec/tests remain.
export function copyExecutionAllowed(){return false;}
export async function main(){return{ok:false,state:'database_copy_execution_retired',consumedRunId:45304780947,exportAttempted:false,objectWriteAttempted:false};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){console.log(JSON.stringify(await main()));process.exitCode=1;}
