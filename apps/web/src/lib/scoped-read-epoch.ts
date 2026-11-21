/** One active read per view. An aborted/stale response cannot reappear when
 * the operator changes accounts and then returns to the original account. */
export class ScopedReadEpoch {
 private version=0
 private controller:AbortController|null=null
 constructor(private readonly currentScope:()=>string|null){}
 cancel(){this.version++;this.controller?.abort();this.controller=null}
 begin(scope:string|null){
  this.cancel()
  const version=this.version,controller=new AbortController();this.controller=controller
  return {signal:controller.signal,current:()=>!!scope&&!controller.signal.aborted&&version===this.version&&this.currentScope()===scope}
 }
}
