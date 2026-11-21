import { messagingEligibility } from '../services/messaging-window.js';
import { assertPublicMetadataPatch } from '../services/recruitment-metadata.js';
import { sha256 } from '../lib/security.js';
import { isOutboundPaused } from '../services/human-touch.js';
import { Hono } from 'hono';
import {
  getForms,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  getFormSubmissions,
  createFormSubmission,
  jstNow,
} from '@ig-harness/db';
import { getFriendById, getIgAccountById } from '@ig-harness/db';
import { addTagToFriend, enrollFriendInScenario } from '@ig-harness/db';
import type { Form as DbForm, FormSubmission as DbFormSubmission } from '@ig-harness/db';
import { resolveAccount, getAccountClient } from '../lib/accounts.js';
import type { Env } from '../index.js';

const forms = new Hono<Env>();

function validFormManagementInput(body:{name?:unknown;isActive?:unknown;saveToMetadata?:unknown;fields?:unknown}){
 if(body.name!==undefined&&(typeof body.name!=='string'||!body.name.trim()))return false;
 if(body.isActive!==undefined&&typeof body.isActive!=='boolean')return false;
 if(body.saveToMetadata!==undefined&&typeof body.saveToMetadata!=='boolean')return false;
 if(body.fields!==undefined&&(!Array.isArray(body.fields)||body.fields.some(f=>!f||typeof f!=='object'||typeof f.name!=='string'||!f.name.trim()||typeof f.label!=='string'||!['text','textarea','email','tel','select'].includes(f.type)||(f.required!==undefined&&typeof f.required!=='boolean'))))return false;
 return true;
}

async function ownedFormReferences(db:D1Database,accountId:string,body:{onSubmitTagId?:string|null;onSubmitScenarioId?:string|null}){
 for(const [value,table]of [[body.onSubmitTagId,'tags'],[body.onSubmitScenarioId,'scenarios']] as const){
  if(value!==undefined&&value!==null&&(typeof value!=='string'||!value.trim()||!await db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND account_id=?`).bind(value,accountId).first()))return false;
 }
 return true;
}

function serializeForm(row: DbForm) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    onSubmitTagId: row.on_submit_tag_id,
    onSubmitScenarioId: row.on_submit_scenario_id,
    onSubmitMessageType: row.on_submit_message_type,
    onSubmitMessageContent: row.on_submit_message_content,
    saveToMetadata: Boolean(row.save_to_metadata),
    isActive: Boolean(row.is_active),
    submitCount: row.submit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeSubmission(row: DbFormSubmission & { friend_name?: string | null }) {
  return {
    id: String(row.id),
    formId: String(row.form_id),
    friendId: row.friend_id===null?null:String(row.friend_id),
    friendName: row.friend_name || null,
    data: JSON.parse(row.data || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
    sideEffectsStatus:row.side_effect_state??'legacy',
    replayed:row.replayed??false,
  };
}

// GET /api/forms — list all forms
forms.get('/api/forms', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const items = await getForms(c.env.DB, { accountId: account.id });
    return c.json({ success: true, data: items.map(serializeForm) });
  } catch (err) {
    console.error('GET /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id — get form
forms.get('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    return c.json({ success: true, data: serializeForm(form) });
  } catch (err) {
    console.error('GET /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms — create form
forms.post('/api/forms', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      fields?: unknown[];
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      saveToMetadata?: boolean;
    }>();

    if (!validFormManagementInput(body)||!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    if(!await ownedFormReferences(c.env.DB,account.id,body))return c.json({success:false,error:'フォームのタグ・シナリオを同じアカウントで選び直してください。'},400);
    const form = await createForm(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      fields: JSON.stringify(body.fields ?? []),
      onSubmitTagId: body.onSubmitTagId ?? null,
      onSubmitScenarioId: body.onSubmitScenarioId ?? null,
      onSubmitMessageType: body.onSubmitMessageType ?? null,
      onSubmitMessageContent: body.onSubmitMessageContent ?? null,
      saveToMetadata: body.saveToMetadata,
      accountId: account.id,
    });

    return c.json({ success: true, data: serializeForm(form) }, 201);
  } catch (err) {
    console.error('POST /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/forms/:id — update form
forms.put('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const account=await resolveAccount(c);
    const current=await getFormById(c.env.DB,id);
    if(!account||!current||current.account_id!==account.id)return c.json({success:false,error:'Form not found in account'},404);
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      fields?: unknown[];
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      saveToMetadata?: boolean;
      isActive?: boolean;
    }>();

    if(!validFormManagementInput(body))return c.json({success:false,error:'フォームの入力形式を確認してください。'},400);
    if(!await ownedFormReferences(c.env.DB,account.id,body))return c.json({success:false,error:'フォームのタグ・シナリオを同じアカウントで選び直してください。'},400);
    const updated = await updateForm(c.env.DB, id, {
      name: body.name,
      description: body.description,
      fields: body.fields !== undefined ? JSON.stringify(body.fields) : undefined,
      onSubmitTagId: body.onSubmitTagId,
      onSubmitScenarioId: body.onSubmitScenarioId,
      onSubmitMessageType: body.onSubmitMessageType,
      onSubmitMessageContent: body.onSubmitMessageContent,
      saveToMetadata: body.saveToMetadata,
      isActive: body.isActive,
    },{accountId:account.id});

    if (!updated) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    return c.json({ success: true, data: serializeForm(updated) });
  } catch (err) {
    console.error('PUT /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/forms/:id
forms.delete('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const account=await resolveAccount(c);
    const form = await getFormById(c.env.DB, id);
    if (!form||!account||form.account_id!==account.id) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if(!await deleteForm(c.env.DB,id,{accountId:account.id}))return c.json({success:false,error:'Form changed; reconcile before deleting'},409);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/submissions — list submissions
forms.get('/api/forms/:id/submissions', async (c) => {
  try {
    const id = c.req.param('id');
    const account=await resolveAccount(c);
    const form = await getFormById(c.env.DB, id);
    if (!form||!account||form.account_id!==account.id) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const submissions = await getFormSubmissions(c.env.DB,id,{accountId:account.id});
    return c.json({ success: true, data: submissions.map(serializeSubmission) });
  } catch (err) {
    console.error('GET /api/forms/:id/submissions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/submit — submit form (public)
forms.post('/api/forms/:id/submit', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }

    const body = await c.req.json<{
      lineUserId?: string;
      friendId?: string;
      data?: Record<string, unknown>;
    }>();

    const submissionData = body.data ?? {};
    try{assertPublicMetadataPatch(submissionData);}catch{return c.json({success:false,error:'回答データに変更できない配信状態が含まれています。'},400);}

    // Validate required fields
    const fields = JSON.parse(form.fields || '[]') as Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
    }>;

    for (const field of fields) {
      if (field.required) {
        const val = submissionData[field.name];
        if (val === undefined || val === null || val === '') {
          return c.json(
            { success: false, error: `${field.label} は必須項目です` },
            400,
          );
        }
      }
    }

    // Resolve friend by lineUserId or friendId
    let friendId: string | null = body.friendId ?? null;
    if (!friendId && body.lineUserId && form.account_id) {
      const friend = await c.env.DB.prepare('SELECT id FROM followers WHERE igsid=? AND account_id=?').bind(body.lineUserId,form.account_id).first<{id:number}>();
      if (friend) {
        // followers.id is numeric in SQLite — coerce so downstream string-typed
        // helpers (createFormSubmission, addTagToFriend, ...) get a consistent shape.
        friendId = String(friend.id);
      }
    }
    // Public identity hints cannot move data, tags or enrollment into another
    // account. Resolve before storing the response or running any side effect.
    if(body.friendId||body.lineUserId){
      const target=friendId?await getFriendById(c.env.DB,String(friendId)):null;
      if(!target||!form.account_id||target.account_id!==form.account_id||(body.lineUserId&&target.igsid!==body.lineUserId))return c.json({success:false,error:'回答先を確認できません。'},400);
    }

    if(!friendId)return c.json({success:false,error:'回答者を確認できません。このフォームは既存の求職者に関連づけて回答してください。'},400);

    // Persist using the existing identified-respondent schema.
    const enforced=c.env.RECRUITMENT_LEDGER_ENFORCEMENT==='1';
    let requestKey:string|undefined,requestHash:string|undefined;
    if(enforced){
      const nonce=c.req.header('Idempotency-Key')??'';
      if(!/^[A-Za-z0-9_-]{16,100}$/.test(nonce))return c.json({success:false,error:'安定した受付IDが必要です。新しいIDで再送せず確認してください。'},400);
      requestKey=await sha256(JSON.stringify([form.account_id,String(form.id),nonce]));
      requestHash=await sha256(JSON.stringify([String(friendId),submissionData]));
    }
    let submission:DbFormSubmission;
    try{submission=await createFormSubmission(c.env.DB, {
      formId,
      friendId: friendId || null,
      data: JSON.stringify(submissionData),
      requestKey,requestHash,
    });}catch(error){if(enforced)return c.json({success:false,error:'受付結果の照合が必要です。新しいIDで再送しないでください。'},409);throw error;}
    // A public friendId/IGSID is not authentication. Enforced receipts stay
    // held until signed respondent identity and purpose guards are connected.
    if(enforced)return c.json({success:true,data:{...serializeSubmission(submission),sideEffectsStatus:'held',requiresIdentityVerification:true}},submission.replayed?200:201);

    // Side effects (best-effort, don't fail the request)
    if (friendId) {
      const db = c.env.DB;
      const now = jstNow();

      const sideEffects: Promise<unknown>[] = [];

      // Save response data to friend's metadata
      if (form.save_to_metadata) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend || friend.account_id!==form.account_id) return;
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            // Only authored response fields may become profile metadata.
            const declared=Object.fromEntries(Object.entries(submissionData).filter(([key])=>fields.some(field=>field.name===key)));
            const merged = { ...existing, ...declared };
            await db
              .prepare(`UPDATE followers SET metadata = ?, updated_at = ? WHERE id = ? AND account_id = ? AND metadata IS ?`)
              .bind(JSON.stringify(merged), now, friendId,form.account_id,friend.metadata??null)
              .run();
          })(),
        );
      }

      // Add tag
      if (form.on_submit_tag_id) {
        sideEffects.push(addTagToFriend(db, friendId, form.on_submit_tag_id));
      }

      // Enroll in scenario
      if (form.on_submit_scenario_id) {
        sideEffects.push(enrollFriendInScenario(db, friendId, form.on_submit_scenario_id));
      }

      // Send confirmation message via IG DM
      sideEffects.push(
        (async () => {
          const friend = await getFriendById(db, friendId!);
          if (!friend) return;
          const igsid = friend.igsid;
          if (!igsid) return;
          // Public submits carry no ?account_id= — the form's owning account
          // (not the deploy default) must send the confirmation DM.
          const account = form.account_id
            ? await getIgAccountById(c.env.DB, form.account_id)
            : await resolveAccount(c);
          if (!account) return;
          if (friend.account_id !== account.id || await messagingEligibility(db,friend.id,account.id) !== 'eligible') return;
          // Operator stop switch (U22): confirmations are sends — skip while paused.
          if (await isOutboundPaused(c.env.DB)) return;
          const igClient = await getAccountClient(c.env, c.env.DB, account);

          // Build summary text from answers
          const entries = Object.entries(submissionData as Record<string, unknown>);
          const lines = entries.map(([key, value]) => {
            const field = form.fields ? (JSON.parse(form.fields) as Array<{ name: string; label: string }>).find((f: { name: string }) => f.name === key) : null;
            const label = field?.label || key;
            const val = Array.isArray(value) ? value.join(', ') : (value !== null && value !== undefined && value !== '') ? String(value) : '-';
            return `${label}: ${val}`;
          });

          const summaryText = `Form submitted!\n\n${lines.join('\n')}`;
          await igClient.sendText(igsid, summaryText);

          // If form has a custom on_submit_message, send it
          if (form.on_submit_message_type && form.on_submit_message_content) {
            const { expandVariables } = await import('../services/step-delivery.js');
            const friendData = {
              id: friend!.id,
              display_name: friend!.name,
            };
            const expanded = expandVariables(form.on_submit_message_content, friendData);
            const msgType = form.on_submit_message_type as string;
            let parsed: Record<string,unknown>;
            try { parsed=JSON.parse(expanded); } catch { parsed={text:expanded}; }
            // Parsing failures may fall back to text; network failures must not
            // trigger a second send with a different representation.
            if (msgType==='image' && typeof parsed.url==='string') await igClient.sendImage(igsid,parsed.url);
            else await igClient.sendText(igsid,typeof parsed.text==='string'?parsed.text:expanded);
          }
        })(),
      );

      if (sideEffects.length > 0) {
        const results = await Promise.allSettled(sideEffects);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Form side-effect failed:', r.reason);
        }
      }
    }

    return c.json({ success: true, data: serializeSubmission(submission) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/submit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { forms };
