import {describe,it,expect,vi,beforeEach} from 'vitest';
import {checkAppWebhook,fixAppWebhook,resolveAppId,APP_SUBSCRIPTION_FIELDS} from '../app-webhook.js';
import {saveTokenDebug} from '../token-debug.js';
const account={id:'acc1',ig_user_id:'111',app_secret:null as string|null};
const env=()=>({IG_APP_ID:'999888',IG_APP_SECRET:'private-app-secret',WORKER_URL:'https://w.example'});
function fixtureDb(){
 const settings=new Map<string,string>();const stmt=(sql:string,p:unknown[])=>({bind:(...v:unknown[])=>stmt(sql,v),first:async()=>settings.has(String(p[0]))?{value:settings.get(String(p[0]))}:null,run:async()=>{if(sql.includes('INTO integration_settings'))settings.set(String(p[0]),String(p[1]));return{meta:{}};}});
 return{settings,db:{prepare:(sql:string)=>stmt(sql,[])} as unknown as D1Database};
}
const row=(patch:Record<string,unknown>={})=>({object:'instagram',callback_url:'https://w.example/webhook',fields:[...APP_SUBSCRIPTION_FIELDS],active:true,...patch});
const reply=(data:unknown,paging?:unknown)=>new Response(JSON.stringify({data,...(paging?{paging}:{})}));
beforeEach(()=>vi.unstubAllGlobals());
describe('app webhook observation',()=>{
 it('uses one GET, header credentials and no redirect; explicit active string fields pass',async()=>{
  const fetch=vi.fn(async()=>reply([row()]));vi.stubGlobal('fetch',fetch);const {db}=fixtureDb();const r=await checkAppWebhook(env(),db,account);
  expect(r.status).toBe('ok');expect(r.callbackMatches).toBe(true);expect(r.missingFields).toEqual([]);expect(fetch).toHaveBeenCalledTimes(1);
  const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://graph.facebook.com/v25.0/999888/subscriptions');expect(options.method).toBe('GET');expect(options.redirect).toBe('error');expect(options.headers).toEqual({Authorization:'Bearer 999888|private-app-secret'});
 });
 it('also accepts named field objects',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply([row({fields:APP_SUBSCRIPTION_FIELDS.map(name=>({name}))})])));expect((await checkAppWebhook(env(),fixtureDb().db,account)).status).toBe('ok');
 });
 for(const [label,rows,status]of [
  ['inactive',[row({active:false})],'fail'],['unknown active',[row({active:undefined})],'unknown'],
  ['wrong callback',[row({callback_url:'https://other.example/webhook'})],'fail'],
  ['incomplete fields',[row({fields:['messages']})],'fail'],
  ['duplicate object',[row(),row()],'unknown'],
  ['page cannot supply missing instagram fields',[row({fields:['messages']}),row({object:'page',fields:APP_SUBSCRIPTION_FIELDS.slice(1)})],'fail'],
  ['page alone is not instagram subscription',[row({object:'page'})],'fail'],
  ['missing subscriptions',[],'fail'],
 ] as const)it(label,async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply(rows)));expect((await checkAppWebhook(env(),fixtureDb().db,account)).status).toBe(status);
 });
 it('pagination stays unknown without following private next links',async()=>{
  const fetch=vi.fn(async()=>reply([row()],{next:'https://foreign.example/private-app-secret'}));vi.stubGlobal('fetch',fetch);const r=await checkAppWebhook(env(),fixtureDb().db,account);
  expect(r.status).toBe('unknown');expect(r.listingIncomplete).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(r)).not.toContain('private-app-secret');
 });
 for(const fields of [undefined,['messages','messages'],['bad field'],[{unknown:'messages'}],['private-app-secret']])it('does not accept malformed fields '+JSON.stringify(fields),async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply([row({fields})])));expect((await checkAppWebhook(env(),fixtureDb().db,account)).status).toBe('unknown');
 });
 it('does not return credential-bearing callback query data',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply([row({callback_url:'https://w.example/webhook?key=private-app-secret'})])));const r=await checkAppWebhook(env(),fixtureDb().db,account);expect(r.status).toBe('fail');expect(JSON.stringify(r)).not.toContain('private-app-secret');
 });
 for(const mode of ['throw','api-error','invalid-data','oversize'])it('does not echo unsafe failure '+mode,async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{if(mode==='throw')throw Error('private-app-secret');if(mode==='api-error')return new Response(JSON.stringify({error:{message:'private-app-secret'}}));if(mode==='invalid-data')return reply({});return new Response('x'.repeat(65537));}));
  const r=await checkAppWebhook(env(),fixtureDb().db,account);expect(r.status).toBe('unknown');expect(JSON.stringify(r)).not.toContain('private-app-secret');
 });
 it('no app credentials is unknown without a request',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const r=await checkAppWebhook({WORKER_URL:'https://w.example'},fixtureDb().db,account);expect(r.status).toBe('unknown');expect(fetch).not.toHaveBeenCalled();
 });
});
describe('Instagram dashboard setup boundary',()=>{
 it('does not POST unsupported subscription or rotate any verify token',async()=>{
  const fetch=vi.fn(async()=>reply([]));vi.stubGlobal('fetch',fetch);const updateAccountVerifyToken=vi.fn();const {db,settings}=fixtureDb();
  const r=await fixAppWebhook(env(),db,account,{updateAccountVerifyToken});expect(r.fixed).toBe(false);expect(r.refused).toBe(true);expect(r.manualSetupRequired).toBe(true);expect(r.verifyTokenGenerated).toBe(false);expect(updateAccountVerifyToken).not.toHaveBeenCalled();expect(settings.size).toBe(0);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('never replaces a foreign callback',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply([row({callback_url:'https://other.example/webhook'})])));const updateAccountVerifyToken=vi.fn();const r=await fixAppWebhook(env(),fixtureDb().db,account,{updateAccountVerifyToken});expect(r.refused).toBe(true);expect(r.foreignUrl).toBe('https://other.example/webhook');expect(updateAccountVerifyToken).not.toHaveBeenCalled();
 });
 it('already healthy observation does not imply a fresh mutation',async()=>{
  const fetch=vi.fn(async()=>reply([row()]));vi.stubGlobal('fetch',fetch);const updateAccountVerifyToken=vi.fn();const r=await fixAppWebhook(env(),fixtureDb().db,account,{updateAccountVerifyToken});expect(r.fixed).toBe(true);expect(r.verifyTokenGenerated).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);expect(updateAccountVerifyToken).not.toHaveBeenCalled();
 });
 it('resolves the same app id from a stored debug observation',async()=>{
  const {db}=fixtureDb();await saveTokenDebug(db,'acc1',{checkedAt:new Date().toISOString(),status:'ok',appId:'555444'});expect(await resolveAppId({IG_APP_SECRET:'s'} as never,db,'acc1')).toBe('555444');
 });
});
