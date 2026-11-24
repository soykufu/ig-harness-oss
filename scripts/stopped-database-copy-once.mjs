import {sealDatabaseCopy,openDatabaseCopy} from './stopped-database-envelope.mjs';
/** One authorized copy orchestration; production transports are not provided.
 * Callers must reconcile attempted mutations, never restart this after unknown.
 */
export async function copyStoppedDatabaseOnce({privacyVerified,encryptionKey,metadata,exists,exportAndVerify,put,readback,verifyRestored,checkFinal}){
 const r={ok:false,exportAttempted:false,objectWriteAttempted:false,objectWritten:false,readbackVerified:false,isolatedRestoreVerified:false,rowContentsVerified:false,backupVerified:false,deploymentAuthorized:false};
 let raw,opened;
 try{
  if(privacyVerified!==true||!Buffer.isBuffer(encryptionKey)||encryptionKey.length!==32)throw Error('preconditions');
  sealDatabaseCopy({sql:Buffer.from('preflight only'),metadata,encryptionKey});
  if(await exists())throw Error('existing_copy_requires_reconciliation');
  r.exportAttempted=true;const exported=await exportAndVerify();raw=exported?.sql;
  if(!Buffer.isBuffer(raw)||!raw.length||exported.rowContentsVerified!==true)throw Error('export_not_verified');
  const envelope=sealDatabaseCopy({sql:raw,metadata,encryptionKey});
  r.objectWriteAttempted=true;await put(Buffer.from(JSON.stringify(envelope)));r.objectWritten=true;
  const bytes=await readback();if(!Buffer.isBuffer(bytes)||bytes.length>64*1024*1024)throw Error('readback_invalid');
  opened=openDatabaseCopy({envelope:JSON.parse(bytes.toString('utf8')),encryptionKey,expected:metadata});
  if(!opened.sql.equals(raw))throw Error('readback_changed');r.readbackVerified=true;
  const restored=await verifyRestored(opened.sql);if(restored?.localRestoreVerified!==true||restored.rowContentsVerified!==true)throw Error('restore_not_verified');
  r.isolatedRestoreVerified=true;r.rowContentsVerified=true;
  if(await checkFinal()!==true)throw Error('final_state_changed');
  return{...r,ok:true,backupVerified:true};
 }catch{return{...r,state:'database_copy_held'};}finally{raw?.fill(0);opened?.sql?.fill(0);}
}
