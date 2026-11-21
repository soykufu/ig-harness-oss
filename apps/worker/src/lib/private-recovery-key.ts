/** Reserved for future encrypted recovery records only. Ordinary media routes
 * must neither expose nor delete these keys, even for an authenticated editor.
 * This namespace alone is not proof of encryption or a usable backup. */
export const PRIVATE_RECOVERY_PREFIX='__private_recovery__/';
export function isPrivateRecoveryKey(key:string):boolean{
 const root=PRIVATE_RECOVERY_PREFIX.slice(0,-1);
 for(let i=0;i<4;i++){
  if(key===root||key.startsWith(PRIVATE_RECOVERY_PREFIX))return true;
  try{const decoded=decodeURIComponent(key);if(decoded===key)return false;key=decoded;}catch{return false;}
 }
 return key===root||key.startsWith(PRIVATE_RECOVERY_PREFIX);
}
