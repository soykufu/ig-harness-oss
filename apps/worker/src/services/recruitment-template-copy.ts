/** Preserve every approved character. The existing 80/80/20 unit budgets are
 * conservative; never widen a platform limit on an unverified assumption.
 * Grapheme boundaries avoid breaking emoji, flags and combining characters. */
export function recruitmentTemplateCopy(text:string,label:string){
 for(const value of [text,label]){
  for(let i=0;i<value.length;i++){
   const c=value.charCodeAt(i);
   if(c>=0xD800&&c<=0xDBFF){const next=value.charCodeAt(++i);if(!(next>=0xDC00&&next<=0xDFFF))throw Error('Template copy has invalid Unicode');}
   else if(c>=0xDC00&&c<=0xDFFF)throw Error('Template copy has invalid Unicode');
  }
 }
 if(!text.trim()||!label.trim()||text.length>160||label.length>20)throw Error('Template copy exceeds supported limits; review without truncation');
 let title='';
 for(const part of new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)){
  if(title.length+part.segment.length>80)break;title+=part.segment;
 }
 const subtitle=text.slice(title.length);
 if(!title||subtitle.length>80)throw Error('Template copy cannot fit without splitting a character');
 return{title,subtitle:subtitle||undefined,buttonTitle:label};
}
