import type {RichMessageBlock,RichMessageContext,CardBlock,GenericTemplateElement,QuickReplyItem} from './types.js';
export const MAX_RICH_MESSAGE_BLOCKS=10;
export type RichAction={type:'text';text:string}|{type:'image';url:string}|{type:'template';elements:GenericTemplateElement[]}|{type:'quick_reply';text:string;replies:QuickReplyItem[]};
/** Pure rendering shared by actual SDK delivery and reviewed-purpose checks. */
export function renderRichActions(recipientId:string,blocks:RichMessageBlock[],context:RichMessageContext={},options:{preserveCopy?:boolean}={}):RichAction[]{
 if(blocks.length>MAX_RICH_MESSAGE_BLOCKS)throw Error(`Rich messages support at most ${MAX_RICH_MESSAGE_BLOCKS} blocks; split larger sequences into scheduled steps`);
 if(!blocks.length)throw Error('Rich message must contain a block');
 const values={IGSID:recipientId,GATE_ID:context.gateId??'',DELIVERY_ID:context.deliveryId??'',REWARD_URL:context.rewardUrl??'',FOLLOWER_USERNAME:context.followerUsername??''};
 const interpolate=(s:string)=>s.replace(/\{\{?\s*(IGSID|GATE_ID|DELIVERY_ID|REWARD_URL|FOLLOWER_USERNAME)\s*\}?\}/g,(_m,key:keyof typeof values)=>values[key]);
 // Strict reviewed flows retain the full expanded copy or reject the entire plan.
 // Budgets intentionally match the existing renderer; this does not infer Meta's
 // Unicode counting or grant a wider transport limit.
 const copy=(raw:string,limit:number)=>{
  const value=interpolate(raw);if(!options.preserveCopy)return value.slice(0,limit);
  if(value.length>limit)throw Error('Rich message copy exceeds supported limits; review without truncation');
  for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw Error('Rich message copy contains invalid Unicode');}else if(code>=0xdc00&&code<=0xdfff)throw Error('Rich message copy contains invalid Unicode');}
  return value;
 };
 const card=(c:Omit<CardBlock,'type'>):GenericTemplateElement=>({title:copy(c.title,80),subtitle:c.subtitle?copy(c.subtitle,80):undefined,image_url:c.image_url?interpolate(c.image_url):undefined,default_action:c.default_url?{type:'web_url',url:interpolate(c.default_url)}:undefined,buttons:c.buttons.map(b=>b.type==='postback'?{type:'postback',title:copy(b.label,20),payload:interpolate(b.payload)}:{type:'web_url',title:copy(b.label,20),url:interpolate(b.url)})});
 return blocks.map(b=>{
  switch(b.type){
   case'text':return{type:'text',text:copy(b.text,1000)};
   case'image':return{type:'image',url:interpolate(b.url)};
   case'card':return{type:'template',elements:[card(b)]};
   case'carousel':return{type:'template',elements:b.cards.map(card)};
   case'quick_replies':return{type:'quick_reply',text:copy(b.text,1000),replies:b.replies.map(r=>({content_type:'text',title:copy(r.label,20),payload:interpolate(r.payload)}))};
   default:throw Error('Unsupported rich block');
  }
 });
}
export function richActionMessage(action:RichAction):unknown{
 switch(action.type){
  case'text':return{text:action.text};
  case'image':return{attachment:{type:'image',payload:{url:action.url}}};
  case'template':return{attachment:{type:'template',payload:{template_type:'generic',elements:action.elements}}};
  case'quick_reply':return{text:action.text,quick_replies:action.replies};
 }
}
