// Standalone Worker-compatible module. No network, deployment, key or DB code.
const ROOT='__private_recovery__',PREFIX=ROOT+'/';
export function reservedRecoveryKey(value){
 if(typeof value!=='string')return true;
 for(let i=0;i<8;i++){
  if(value===ROOT||value.startsWith(PREFIX))return true;
  try{const next=decodeURIComponent(value);if(next===value)return false;value=next;}catch{return true;}
 }
 return true; // Do not accept arbitrarily nested encodings.
}
export function guardRecoveryBucket(bucket){
 if(!bucket||typeof bucket!=='object')throw Error('Recovery namespace protection unavailable');
 return new Proxy(bucket,{get(target,prop){
  const method=Reflect.get(target,prop,target);if(typeof method!=='function')return method;
  if(prop==='list')return async(options)=>{
   if(options?.prefix!==undefined&&reservedRecoveryKey(options.prefix))return{objects:[],delimitedPrefixes:[],truncated:false};
   const result=await method.call(target,options);
   if(!result||!Array.isArray(result.objects))throw Error('Recovery namespace listing unavailable');
   return {...result,objects:result.objects.filter(o=>!reservedRecoveryKey(o?.key)),...(Array.isArray(result.delimitedPrefixes)?{delimitedPrefixes:result.delimitedPrefixes.filter(p=>!reservedRecoveryKey(p))}:{})};
  };
  return (...args)=>{
   const keys=Array.isArray(args[0])?args[0]:[args[0]];
   if(keys.some(reservedRecoveryKey)){
    if(prop==='get'||prop==='head')return Promise.resolve(null);
    throw Error('Recovery namespace operation blocked');
   }
   return method.apply(target,args);
  };
 }});
}
export function wrapRecoveryGuard(original){
 if(!original||typeof original.fetch!=='function')throw Error('Original Worker handler requires reconciliation');
 return new Proxy(original,{get(target,prop){
  if(prop==='fetch')return(request,env,ctx)=>{
   const guarded=guardRecoveryBucket(env.IMAGES);
   const scopedEnv=new Proxy(env,{get(t,p,r){return p==='IMAGES'?guarded:Reflect.get(t,p,r);}});
   return target.fetch.call(target,request,scopedEnv,ctx);
  };
  const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
 }});
}
