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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?) RETURNING id`,
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
      now,
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

export async function updateForm(
  db: D1Database,
  id: string,
  input: UpdateFormInput,
): Promise<Form | null> {
  const existing = await getFormById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE forms
       SET name = ?,
           description = ?,
           fields = ?,
           on_submit_tag_id = ?,
           on_submit_scenario_id = ?,
           on_submit_message_type = ?,
           on_submit_message_content = ?,
           save_to_metadata = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      'description' in input ? (input.description ?? null) : existing.description,
      input.fields ?? existing.fields,
      'onSubmitTagId' in input ? (input.onSubmitTagId ?? null) : existing.on_submit_tag_id,
      'onSubmitScenarioId' in input
        ? (input.onSubmitScenarioId ?? null)
        : existing.on_submit_scenario_id,
      'onSubmitMessageType' in input
        ? (input.onSubmitMessageType ?? null)
        : existing.on_submit_message_type,
      'onSubmitMessageContent' in input
        ? (input.onSubmitMessageContent ?? null)
        : existing.on_submit_message_content,
      'saveToMetadata' in input
        ? (input.saveToMetadata !== false ? 1 : 0)
        : existing.save_to_metadata,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();

  return getFormById(db, id);
}

export async function deleteForm(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM forms WHERE id = ?`).bind(id).run();
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function getFormSubmissions(
  db: D1Database,
  formId: string,
): Promise<FormSubmission[]> {
  const result = await db
    .prepare(
      `SELECT fs.id,fs.form_id,fs.follower_id AS friend_id,fs.answers AS data,fs.submitted_at AS created_at,fs.side_effect_state, f.name as friend_name FROM form_submissions fs
       LEFT JOIN followers f ON f.id = fs.follower_id
       WHERE fs.form_id = ? ORDER BY fs.submitted_at DESC,fs.id DESC`,
    )
    .bind(formId)
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
