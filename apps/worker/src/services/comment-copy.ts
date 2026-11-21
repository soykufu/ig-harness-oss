/** One substitution pass. Values are literal data: replacement metacharacters
 * and template-looking content inside a value are never evaluated again. */
export function expandCommentCopy(template:string,values:Partial<Record<'username'|'igsid'|'follower_id',string>>):string{
 return template.replace(/\{\{\s*(username|igsid|follower_id)\s*\}\}/g,(match,key:keyof typeof values)=>Object.prototype.hasOwnProperty.call(values,key)?values[key]!:match);
}
