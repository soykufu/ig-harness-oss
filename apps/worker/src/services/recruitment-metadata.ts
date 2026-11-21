/** Delivery evidence is server-owned. Generic editor/form data must never
 * create, refresh, remove or overwrite an active/suppressed delivery state. */
export function assertPublicMetadataPatch(value:unknown):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.prototype.hasOwnProperty.call(value,'recruitment_delivery'))throw Error('Protected recruitment metadata');
}
