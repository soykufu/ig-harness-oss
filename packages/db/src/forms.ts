import { jstNow } from './utils.js';
// =============================================================================
// Forms — Survey / questionnaire system (L社 回答フォーム equivalent)
// =============================================================================

export interface Form {
  id: string;
  name: string;
  description: string | null;
  fields: string; // JSON string of FormField[]
  on_submit_tag_id: string | null;
  on_submit_scenario_id: string | null;
  on_submit_message_type: 'text' | 'flex' | null;
  on_submit_message_content: string | null; // supports template variables: {{name}}, {{auth_url:CHANNEL_ID}}, etc.
  save_to_metadata: number;
  is_active: number;
  submit_count: number;
  account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  friend_id: string | null;
  data: string; // JSON string
  created_at: string;
  side_effect_state?:'legacy'|'held';
  replayed?:boolean;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getForms(
  db: D1Database,
  opts: { accountId?: string } = {},
): Promise<Form[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.accountId) {
    conditions.push('account_id = ?');
    binds.push(opts.accountId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(`SELECT * FROM forms ${where} ORDER BY created_at DESC`);
  const result = binds.length > 0
    ? await stmt.bind(...binds).all<Form>()
    : await stmt.all<Form>();
  return result.results;
}

export async function getFormById(db: D1Database, id: string): Promise<Form | null> {
  return db
    .prepare(`SELECT * FROM forms WHERE id = ?`)
    .bind(id)
    .first<Form>();
}

export interface CreateFormInput {
  name: string;
  description?: string | null;
  fields: string; // JSON string
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  saveToMetadata?: boolean;
  /** Owning IG business account (ig_accounts.id). */
  accountId?: string;
}

export async function createForm(db: D1Database, input: CreateFormInput): Promise<Form> {
  const now = jstNow();

  const inserted=await db
    .prepare(
      `INSERT INTO forms
         (name, description, fields, on_submit_tag_id, on_submit_scenario_id,
          on_submit_message_type, on_submit_message_content,
          save_to_metadata, is_active, submit_count, account_id, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?
       WHERE (? IS NULL OR ((? IS NULL OR EXISTS(SELECT 1 FROM tags WHERE id=? AND account_id=?)) AND (? IS NULL OR EXISTS(SELECT 1 FROM scenarios WHERE id=? AND account_id=?)))) RETURNING id`,
    )
    .bind(
      input.name,
      input.description ?? null,
      input.fields,
      input.onSubmitTagId ?? null,
      input.onSubmitScenarioId ?? null,
      input.onSubmitMessageType ?? null,
      input.onSubmitMessageContent ?? null,
      input.saveToMetadata !== false ? 1 : 0,
      input.accountId ?? null,
      now,
      now,input.accountId??null,input.onSubmitTagId??null,input.onSubmitTagId??null,input.accountId??null,input.onSubmitScenarioId??null,input.onSubmitScenarioId??null,input.accountId??null,
    )
    .first<{id:number}>();
  if(!inserted)throw Error('Form insert failed');
  return (await getFormById(db, String(inserted.id)))!;
}

export interface UpdateFormInput {
  name?: string;
  description?: string | null;
  fields?: string;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  saveToMetadata?: boolean;
  isActive?: boolean;
}

export async function updateForm(db:D1Database,id:string,input:UpdateFormInput,opts:{accountId?:string}={}):Promise<Form|null>{
 const mapping={name:'name',description:'description',fields:'fields',onSubmitTagId:'on_submit_tag_id',onSubmitScenarioId:'on_submit_scenario_id',onSubmitMessageType:'on_submit_message_type',onSubmitMessageContent:'on_submit_message_content',saveToMetadata:'save_to_metadata',isActive:'is_active'} as const;
 const set:string[]=[],values:unknown[]=[];
 for(const [key,column]of Object.entries(mapping)){
  const value=input[key as keyof UpdateFormInput];if(value===undefined)continue;
  set.push(column+'=?');values.push(['saveToMetadata','isActive'].includes(key)?value?1:0:value);
 }
 if(!set.length){const row=await getFormById(db,id);return row&&(!opts.accountId||row.account_id===opts.accountId)?row:null;}
 set.push('updated_at=?');values.push(jstNow(),id);
 let scope='';if(opts.accountId){scope+=' AND account_id=?';values.push(opts.accountId);
  for(const [key,table]of [['onSubmitTagId','tags'],['onSubmitScenarioId','scenarios']] as const){
   if(input[key]!==undefined&&input[key]!==null){scope+=` AND EXISTS(SELECT 1 FROM ${table} WHERE id=? AND account_id=forms.account_id)`;values.push(input[key]);}
  }
  if(input.isActive===true){
   // Current references are checked atomically when an existing form reopens;
   // explicit new references are independently checked by the predicates above.
   if(input.onSubmitTagId===undefined)scope+=" AND (on_submit_tag_id IS NULL OR EXISTS(SELECT 1 FROM tags WHERE id=forms.on_submit_tag_id AND account_id=forms.account_id))";
   if(input.onSubmitScenarioId===undefined)scope+=" AND (on_submit_scenario_id IS NULL OR EXISTS(SELECT 1 FROM scenarios WHERE id=forms.on_submit_scenario_id AND account_id=forms.account_id))";
  }
 }
 return db.prepare(`UPDATE forms SET ${set.join(',')} WHERE id=?${scope} RETURNING *`).bind(...values).first<Form>();
}
export async function deleteForm(db:D1Database,id:string,opts:{accountId?:string}={}):Promise<boolean>{
 const row=opts.accountId?await db.prepare('DELETE FROM forms WHERE id=? AND account_id=? RETURNING id').bind(id,opts.accountId).first():await db.prepare('DELETE FROM forms WHERE id=? RETURNING id').bind(id).first();return !!row;
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function getFormSubmissions(
  db: D1Database,
  formId: string,
  opts:{accountId?:string}={},
): Promise<FormSubmission[]> {
  const result = await db
    .prepare(
      `SELECT fs.id,fs.form_id,fs.follower_id AS friend_id,fs.answers AS data,fs.submitted_at AS created_at,fs.side_effect_state, f.name as friend_name FROM form_submissions fs
       JOIN forms form ON form.id=fs.form_id
       LEFT JOIN followers f ON f.id = fs.follower_id AND f.account_id=form.account_id
       WHERE fs.form_id = ? AND (? IS NULL OR (form.account_id=? AND f.account_id=form.account_id)) ORDER BY fs.submitted_at DESC,fs.id DESC`,
    )
    .bind(formId,opts.accountId??null,opts.accountId??null)
    .all<FormSubmission & { friend_name: string | null }>();
  return result.results;
}

export interface CreateFormSubmissionInput {
  formId: string;
  friendId?: string | null;
  data: string; // JSON string
  requestKey?:string;
  requestHash?:string;
}

export async function createFormSubmission(
  db: D1Database,
  input: CreateFormSubmissionInput,
): Promise<FormSubmission> {
  if(!input.friendId)throw Error('An identified respondent is required');
  if((input.requestKey||input.requestHash)&&(!/^[a-f0-9]{64}$/.test(input.requestKey??'')||!/^[a-f0-9]{64}$/.test(input.requestHash??'')))throw Error('Invalid submission identity');
  const now = jstNow();
  const results=await db.batch([
    db.prepare(`INSERT INTO form_submissions(form_id,follower_id,answers,submitted_at,request_key,request_hash,side_effect_state)
      SELECT form.id,f.id,?,?,?,?,? FROM forms form JOIN followers f ON f.account_id=form.account_id
      WHERE form.id=? AND f.id=? AND form.is_active=1
      ON CONFLICT(form_id,request_key) DO NOTHING RETURNING id`).bind(input.data,now,input.requestKey??null,input.requestHash??null,input.requestKey?'held':'legacy',input.formId,input.friendId),
    db.prepare(`UPDATE forms SET submit_count=(SELECT COUNT(*) FROM form_submissions WHERE form_id=?),updated_at=? WHERE id=? AND changes()=1`).bind(input.formId,now,input.formId),
  ]);
  const id=(results[0].results[0] as {id:number}|undefined)?.id;
  if(!id){
    if(input.requestKey){
      const existing=await db.prepare(`SELECT s.id,s.form_id,s.follower_id AS friend_id,s.answers AS data,s.submitted_at AS created_at,s.side_effect_state FROM form_submissions s
        JOIN forms f ON f.id=s.form_id JOIN followers p ON p.id=s.follower_id AND p.account_id=f.account_id
        WHERE s.form_id=? AND s.request_key=? AND s.request_hash=? AND s.follower_id=? AND s.side_effect_state='held' AND f.is_active=1`)
        .bind(input.formId,input.requestKey,input.requestHash,input.friendId).first<FormSubmission>();
      if(existing)return{...existing,replayed:true};
    }
    throw Error('Submission request requires reconciliation');
  }
  const saved=await db.prepare(`SELECT id,form_id,follower_id AS friend_id,answers AS data,submitted_at AS created_at,side_effect_state FROM form_submissions WHERE id=?`).bind(id).first<FormSubmission>();
  if(!saved)throw Error('Submission result requires reconciliation');
  return{...saved,replayed:false};
}
