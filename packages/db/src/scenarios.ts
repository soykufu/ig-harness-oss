import { jstNow } from './utils.js';
import { getDeliveryWindowJst, enforceWindow } from './delivery-window.js';
export type ScenarioTriggerType = 'friend_add' | 'tag_added' | 'manual' | 'dm_keyword' | 'comment' | 'follower_add';
export type MessageType = 'text' | 'image' | 'template' | 'quick_reply' | 'flex';
export type FriendScenarioStatus = 'active' | 'paused' | 'completed';

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  trigger_type: ScenarioTriggerType;
  trigger_keyword: string | null;
  trigger_tag_id: string | null;
  line_account_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ScenarioStep {
  id: string;
  scenario_id: string;
  step_order: number;
  delay_minutes: number;
  message_type: MessageType;
  body: string;
  condition_type: string | null;
  condition_value: string | null;
  next_step_on_false: number | null;
  created_at: string;
}

export interface ScenarioWithSteps extends Scenario {
  steps: ScenarioStep[];
}

export interface FriendScenario {
  id: string;
  follower_id: string;
  scenario_id: string;
  current_step: number;
  status: FriendScenarioStatus;
  enrolled_at: string;
  next_step_at: string | null;
  updated_at: string;
}

// ============================================================
// Scenario CRUD
// ============================================================

export type ScenarioWithStepCount = Scenario & { step_count: number };

export async function getScenarios(
  db: D1Database,
  opts: { accountId?: string } = {},
): Promise<ScenarioWithStepCount[]> {
  const where = opts.accountId ? 'WHERE s.account_id = ?' : '';
  const stmt = db.prepare(
    `SELECT s.*, COUNT(ss.id) as step_count
     FROM scenarios s
     LEFT JOIN scenario_steps ss ON s.id = ss.scenario_id
     ${where}
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
  );
  const result = opts.accountId
    ? await stmt.bind(opts.accountId).all<ScenarioWithStepCount>()
    : await stmt.all<ScenarioWithStepCount>();
  return result.results;
}

export async function getScenarioById(
  db: D1Database,
  id: string,
): Promise<ScenarioWithSteps | null> {
  const scenario = await db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>();

  if (!scenario) return null;

  const stepsResult = await db
    .prepare(
      `SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
    )
    .bind(id)
    .all<ScenarioStep>();

  return { ...scenario, steps: stepsResult.results };
}

export interface CreateScenarioInput {
  name: string;
  description?: string | null;
  triggerType: ScenarioTriggerType;
  triggerTagId?: string | null;
  /** Owning IG business account (ig_accounts.id). */
  accountId?: string;
}

export async function createScenario(
  db: D1Database,
  input: CreateScenarioInput,
): Promise<Scenario> {
  const now = jstNow();

  return (await db
    .prepare(
      `INSERT INTO scenarios (name, description, trigger_type, trigger_tag_id, is_active, account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?) RETURNING *`,
    )
    .bind(
      input.name,
      input.description ?? null,
      input.triggerType,
      input.triggerTagId ?? null,
      input.accountId ?? null,
      now,
      now,
    )
    .first<Scenario>())!;
}

export type UpdateScenarioInput = Partial<
  Pick<Scenario, 'name' | 'description' | 'trigger_type' | 'trigger_tag_id' | 'is_active'>
>;

export async function updateScenario(
  db: D1Database,
  id: string,
  updates: UpdateScenarioInput,
): Promise<Scenario | null> {
  const now = jstNow();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.trigger_type !== undefined) {
    fields.push('trigger_type = ?');
    values.push(updates.trigger_type);
  }
  if (updates.trigger_tag_id !== undefined) {
    fields.push('trigger_tag_id = ?');
    values.push(updates.trigger_tag_id);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }

  if (fields.length === 0) {
    return db
      .prepare(`SELECT * FROM scenarios WHERE id = ?`)
      .bind(id)
      .first<Scenario>();
  }

  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  await db
    .prepare(`UPDATE scenarios SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>();
}

export async function deleteScenario(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scenarios WHERE id = ?`).bind(id).run();
}

// ============================================================
// Scenario Steps
// ============================================================

export interface CreateScenarioStepInput {
  scenarioId: string;
  stepOrder: number;
  delayMinutes?: number;
  messageType: MessageType;
  messageContent: string;
  conditionType?: string | null;
  conditionValue?: string | null;
  nextStepOnFalse?: number | null;
}

export async function createScenarioStep(
  db: D1Database,
  input: CreateScenarioStepInput,
): Promise<ScenarioStep> {
  const now = jstNow();

  return (await db
    .prepare(
      `INSERT INTO scenario_steps (scenario_id, step_order, delay_minutes, message_type, body, condition_type, condition_value, next_step_on_false, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      input.scenarioId,
      input.stepOrder,
      input.delayMinutes ?? 0,
      input.messageType,
      input.messageContent,
      input.conditionType ?? null,
      input.conditionValue ?? null,
      input.nextStepOnFalse ?? null,
      now,
    )
    .first<ScenarioStep>())!;
}

export type UpdateScenarioStepInput = Partial<
  Pick<ScenarioStep, 'step_order' | 'delay_minutes' | 'message_type' | 'body' | 'condition_type' | 'condition_value' | 'next_step_on_false'>
>;

export async function updateScenarioStep(
  db: D1Database,
  id: string,
  updates: UpdateScenarioStepInput,
): Promise<ScenarioStep | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.step_order !== undefined) {
    fields.push('step_order = ?');
    values.push(updates.step_order);
  }
  if (updates.delay_minutes !== undefined) {
    fields.push('delay_minutes = ?');
    values.push(updates.delay_minutes);
  }
  if (updates.message_type !== undefined) {
    fields.push('message_type = ?');
    values.push(updates.message_type);
  }
  if (updates.body !== undefined) {
    fields.push('body = ?');
    values.push(updates.body);
  }
  if (updates.condition_type !== undefined) {
    fields.push('condition_type = ?');
    values.push(updates.condition_type);
  }
  if (updates.condition_value !== undefined) {
    fields.push('condition_value = ?');
    values.push(updates.condition_value);
  }
  if (updates.next_step_on_false !== undefined) {
    fields.push('next_step_on_false = ?');
    values.push(updates.next_step_on_false);
  }

  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE scenario_steps SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return db
    .prepare(`SELECT * FROM scenario_steps WHERE id = ?`)
    .bind(id)
    .first<ScenarioStep>();
}

export async function deleteScenarioStep(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scenario_steps WHERE id = ?`).bind(id).run();
}

export async function getScenarioSteps(
  db: D1Database,
  scenarioId: string,
): Promise<ScenarioStep[]> {
  const result = await db
    .prepare(
      `SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
    )
    .bind(scenarioId)
    .all<ScenarioStep>();
  return result.results;
}

// ============================================================
// Friend Scenario Enrollments
// ============================================================

/** A verified worker snapshot; optional only for legacy/manual callers. */
export type RecruitmentEnrollmentGuard={accountId:string;metadata:string;ownerEpoch:string;subjectHash:string};

export async function enrollFriendInScenario(
  db: D1Database,
  // followers.id is INTEGER PRIMARY KEY in SQLite, so callers reading rows
  // directly hand us a number. Other callers (API routes resolving IDs via
  // route params) pass strings. D1 accepts both via `.bind()`.
  friendId: string | number,
  scenarioId: string,
  recruitment?:RecruitmentEnrollmentGuard,
): Promise<FriendScenario> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // Get the first step to calculate next_step_at
  const firstStep = await db
    .prepare(
      `SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC LIMIT 1`,
    )
    .bind(scenarioId)
    .first<{ step_order: number; delay_minutes: number }>();

  if(recruitment){
    const window=firstStep?await getDeliveryWindowJst(db):null;
    const at=Date.now(),hour=new Date(at+9*3600000).getUTCHours();
    if(hour<8||hour>=21)throw Error('Recruitment enrollment requires reconciliation');
    const next=firstStep?enforceWindow(window!,new Date(at+9*3600000+firstStep.delay_minutes*60000)).toISOString().slice(0,-1)+'+09:00':null;
    const eligible=`EXISTS(SELECT 1 FROM followers f JOIN scenarios s ON s.account_id=f.account_id AND s.id=? AND s.is_active=1
      JOIN ig_accounts a ON a.id=f.account_id AND a.is_active=1
      JOIN recruitment_outbound_control c ON c.account_id=f.account_id AND c.owner='harness' AND c.owner_epoch=? AND c.reconciled_at_ms BETWEEN ? AND ?
      WHERE f.id=? AND f.account_id=? AND f.metadata IS ? AND f.messaging_owner='primary'
      AND julianday(f.last_inbound_at)>julianday(?) AND julianday(f.last_inbound_at)<=julianday(?)
      AND json_extract(f.metadata,'$.recruitment_delivery.state')='active'
      AND json_extract(f.metadata,'$.recruitment_delivery.owner_epoch')=c.owner_epoch
      AND json_extract(f.metadata,'$.recruitment_delivery.observed_at_ms') BETWEEN ? AND ?
      AND json_extract(f.metadata,'$.recruitment_delivery.valid_until_ms')>? AND json_extract(f.metadata,'$.recruitment_delivery.valid_until_ms')<=json_extract(f.metadata,'$.recruitment_delivery.observed_at_ms')+300000
      AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
      AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=f.account_id)
      AND NOT EXISTS(SELECT 1 FROM recruitment_inbound_holds WHERE account_id=f.account_id AND subject_hash=?)
      AND NOT EXISTS(SELECT 1 FROM recruitment_outbound_operations WHERE account_id=f.account_id AND (state='uncertain' OR reserved_at_ms>? OR (state='reserved' AND reserved_at_ms<=?)))
      AND NOT EXISTS(SELECT 1 FROM recruitment_gate_followup_operations WHERE account_id=f.account_id AND state='uncertain')
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_cta_operations WHERE account_id=f.account_id AND state='uncertain')
      AND NOT EXISTS(SELECT 1 FROM recruitment_gate_operations WHERE account_id=f.account_id AND state='uncertain')
      AND NOT EXISTS(SELECT 1 FROM comment_rule_jobs WHERE account_id=f.account_id AND public_reply_status IN ('processing','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE g.account_id=f.account_id AND d.end_reason='outcome_unknown'))`;
    const bindings=[scenarioId,recruitment.ownerEpoch,at-60000,at,friendId,recruitment.accountId,recruitment.metadata,new Date(at-86400000).toISOString(),new Date(at).toISOString(),at-300000,at,at,recruitment.subjectHash,at,at-60000];
    const row=await db.prepare(`INSERT INTO follower_scenarios(follower_id,scenario_id,current_step,status,enrolled_at,next_step_at,updated_at)
      SELECT ?,?,0,?,?,?,? WHERE ${eligible} AND NOT EXISTS(SELECT 1 FROM follower_scenarios WHERE follower_id=? AND scenario_id=?) RETURNING *`)
      .bind(friendId,scenarioId,firstStep?'active':'completed',now,next,now,...bindings,friendId,scenarioId).first<FriendScenario>();
    if(row)return row;
    const existing=await db.prepare(`SELECT fs.* FROM follower_scenarios fs WHERE fs.follower_id=? AND fs.scenario_id=? AND ${eligible} ORDER BY fs.id DESC LIMIT 1`).bind(friendId,scenarioId,...bindings).first<FriendScenario>();
    if(existing)return existing;
    throw Error('Recruitment enrollment requires reconciliation');
  }

  // A scenario with no steps is immediately completed — no stuck active enrollment.
  if (!firstStep) {
    await db
      .prepare(
        `INSERT INTO follower_scenarios (follower_id, scenario_id, current_step, status, enrolled_at, next_step_at, updated_at)
         VALUES (?, ?, 0, 'completed', ?, NULL, ?)`,
      )
      .bind(friendId, scenarioId, now, now)
      .run();

    return (await db
      .prepare(`SELECT * FROM follower_scenarios WHERE follower_id = ? AND scenario_id = ? ORDER BY id DESC LIMIT 1`)
      .bind(friendId, scenarioId)
      .first<FriendScenario>())!;
  }

  const rawDate = new Date(Date.now() + 9 * 60 * 60_000 + firstStep.delay_minutes * 60_000);
  // B-06: single configurable window (default 0-24 = always deliver).
  const nextDeliveryAt = enforceWindow(await getDeliveryWindowJst(db), rawDate).toISOString().slice(0, -1) + '+09:00';

  await db
    .prepare(
      `INSERT INTO follower_scenarios (follower_id, scenario_id, current_step, status, enrolled_at, next_step_at, updated_at)
       VALUES (?, ?, 0, 'active', ?, ?, ?)`,
    )
    .bind(friendId, scenarioId, now, nextDeliveryAt, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM follower_scenarios WHERE follower_id = ? AND scenario_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(friendId, scenarioId)
    .first<FriendScenario>())!;
}

export async function getFriendScenariosDueForDelivery(
  db: D1Database,
  now: string,
  accountId?: string,
): Promise<FriendScenario[]> {
  // Fetch all active scenarios with a delivery time, then filter by epoch comparison
  // to handle mixed timestamp formats (Z and +09:00) during migration
  const result = accountId
    ? await db
        .prepare(
          `SELECT fs.* FROM follower_scenarios fs
           INNER JOIN scenarios s ON s.id = fs.scenario_id
           WHERE fs.status = 'active'
             AND fs.next_step_at IS NOT NULL
             AND s.account_id = ?`,
        )
        .bind(accountId)
        .all<FriendScenario>()
    : await db
        .prepare(
          `SELECT * FROM follower_scenarios
           WHERE status = 'active'
             AND next_step_at IS NOT NULL`,
        )
        .all<FriendScenario>();
  const nowMs = new Date(now).getTime();
  return result.results
    .filter((fs) => new Date(fs.next_step_at!).getTime() <= nowMs)
    .sort((a, b) => new Date(a.next_step_at!).getTime() - new Date(b.next_step_at!).getTime());
}

export async function advanceFriendScenario(
  db: D1Database,
  id: string,
  nextStepOrder: number,
  nextDeliveryAt?: string | null,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE follower_scenarios
       SET current_step = ?,
           next_step_at = ?,
           updated_at = ?,
           end_reason = NULL
       WHERE id = ?`,
    )
    .bind(nextStepOrder, nextDeliveryAt ?? null, now, id)
    .run();
}

export async function completeFriendScenario(
  db: D1Database,
  id: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE follower_scenarios
       SET status = 'completed',
           next_step_at = NULL,
           updated_at = ?,
           end_reason = NULL
       WHERE id = ?`,
    )
    .bind(now, id)
    .run();
}
